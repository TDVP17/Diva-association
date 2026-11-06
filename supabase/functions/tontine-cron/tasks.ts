import { type SupabaseClient } from "@supabase/supabase-js";
import {
  ALL_TONTINE_TYPES,
  computeFine,
  createId,
  formatXAF,
  getCameroonDateParts,
  getCutoffInstant,
  getCycleDateForRound,
  getNextDueDate,
  isContributionDay,
  isPayoutInfoUnlockTime,
  renderAdvanceReminderMessage,
  renderFineNoticeMessage,
  renderFoodTurnMessage,
  renderReminderEveMessage,
  renderReminderNoonMessage,
  renderReminderUrgentMessage,
  renderTurnReminderTomorrowMessage,
  toDueDateKey,
  type TontineType,
} from "./engine.ts";

interface TaskResult {
  task: string;
  ok: boolean;
  checkedAt: string;
  details: Record<string, unknown>;
  error?: string;
}

// ---------------------------------------------------------------------------
// 1. TÂCHE : Rappel du tour de cagnotte (J-1) & Cotisation en avance (J-3, J-2, J-1)
// Horaires prévus : 07:00 UTC (08:00 WAT)
// ---------------------------------------------------------------------------
export async function runTurnReminderTask(
  supabase: SupabaseClient,
  now = new Date(),
): Promise<TaskResult> {
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowKeyIso = toDueDateKey(tomorrow).toISOString();
  let turnBeneficiariesNotified = 0;
  let advanceRemindersSent = 0;

  const { data: activeSessions, error: sessErr } = await supabase
    .from("tontine_sessions")
    .select("id, title, type, amount, fee, startDate, status")
    .eq("status", "ACTIVE");

  if (sessErr) {
    return {
      task: "turn-reminder",
      ok: false,
      checkedAt: now.toISOString(),
      details: {},
      error: sessErr.message,
    };
  }

  for (const session of activeSessions || []) {
    const sessionTitle = session.title || session.type;

    // --- A. Bénéficiaire de la cagnotte de demain ---
    const { data: designatedSlots } = await supabase
      .from("membership_slots")
      .select(`
        id,
        officialPosition,
        ballDrawn,
        beneficiaryName,
        membership:memberships!inner(
          id,
          userId,
          tontineSessionId,
          user:users!inner(id, name, email, preferredLang)
        ),
        payouts(id)
      `)
      .eq("membership.tontineSessionId", session.id)
      .not("officialPosition", "is", null)
      .not("ballDrawn", "is", null)
      .order("officialPosition", { ascending: true });

    const openSlot = (designatedSlots || []).find(
      (s: any) => !s.payouts || s.payouts.length === 0,
    );

    if (openSlot && openSlot.officialPosition && session.startDate) {
      const estimatedDate = getCycleDateForRound(
        session.type as TontineType,
        new Date(session.startDate),
        openSlot.officialPosition,
      );

      if (toDueDateKey(estimatedDate).toISOString() === tomorrowKeyIso) {
        // Déduplication via turn_reminder_logs
        const { data: existingLog } = await supabase
          .from("turn_reminder_logs")
          .select("id")
          .eq("membershipSlotId", openSlot.id)
          .eq("estimatedDate", tomorrowKeyIso)
          .maybeSingle();

        if (!existingLog) {
          const logId = createId();
          await supabase.from("turn_reminder_logs").insert({
            id: logId,
            membershipSlotId: openSlot.id,
            estimatedDate: tomorrowKeyIso,
            sentAt: new Date().toISOString(),
          });

          // Compter le nombre de parts approuvées pour estimer le pot
          const { count: totalApprovedSlots } = await supabase
            .from("membership_slots")
            .select("id, membership:memberships!inner(tontineSessionId, status)", {
              count: "exact",
              head: true,
            })
            .eq("membership.tontineSessionId", session.id)
            .eq("membership.status", "APPROVED");

          const potEstimate =
            Number(session.amount) * (totalApprovedSlots || 1);
          const lang = openSlot.membership?.user?.preferredLang === "en" ? "en" : "fr";
          const rawName = openSlot.membership?.user?.name || "Membre";
          const firstName = rawName.trim().split(/\s+/)[0] || rawName;

          const msg = renderTurnReminderTomorrowMessage(
            lang,
            firstName,
            sessionTitle,
            potEstimate,
            openSlot.officialPosition,
          );

          await supabase.from("notifications").insert({
            id: createId(),
            userId: openSlot.membership.userId,
            tontineSessionId: session.id,
            membershipSlotId: openSlot.id,
            channel: "IN_APP",
            type: "TURN_REMINDER_TOMORROW",
            status: "SENT",
            message: msg,
            messageKey: "waPayoutTurn",
            messageVars: {
              name: firstName,
              amount: formatXAF(potEstimate),
              cotisation: sessionTitle,
              position: String(openSlot.officialPosition),
            },
            actionUrl: `/sessions/${session.id}`,
            createdAt: new Date().toISOString(),
          });

          if (openSlot.membership?.user?.email) {
            await supabase.from("notifications").insert({
              id: createId(),
              userId: openSlot.membership.userId,
              tontineSessionId: session.id,
              membershipSlotId: openSlot.id,
              channel: "EMAIL",
              type: "TURN_REMINDER_TOMORROW",
              status: "SCHEDULED",
              scheduledAt: new Date().toISOString(),
              message: msg,
              actionUrl: `/sessions/${session.id}`,
              createdAt: new Date().toISOString(),
            });
          }

          turnBeneficiariesNotified++;
        }
      }
    }

    // --- B. Rappels de cotisation anticipés (J-3, J-2, J-1) ---
    try {
      const nextDue = getNextDueDate(session.type as TontineType, now);
      const diffMs = toDueDateKey(nextDue).getTime() - toDueDateKey(now).getTime();
      const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));

      if (diffDays >= 1 && diffDays <= 3) {
        const nextDueIso = toDueDateKey(nextDue).toISOString();
        const { data: unpaidSlots } = await supabase
          .from("membership_slots")
          .select(`
            id,
            beneficiaryName,
            membership:memberships!inner(
              id,
              userId,
              tontineSessionId,
              status,
              user:users!inner(id, name, email, preferredLang)
            ),
            contributions(id, status, dueDate)
          `)
          .eq("membership.tontineSessionId", session.id)
          .eq("membership.status", "APPROVED");

        const memberUnpaidMap = new Map<string, any>();
        for (const slot of unpaidSlots || []) {
          const hasPaid = (slot.contributions || []).some(
            (c: any) =>
              c.status === "PAID" &&
              toDueDateKey(new Date(c.dueDate)).toISOString() === nextDueIso,
          );
          if (!hasPaid) {
            const userId = slot.membership.userId;
            if (!memberUnpaidMap.has(userId)) {
              memberUnpaidMap.set(userId, slot);
            }
          }
        }

        const totalAmount = Number(session.amount) + Number(session.fee);

        for (const [userId, slot] of memberUnpaidMap.entries()) {
          // Déduplication : 1 seul rappel de cotisation par membre et par jour d'échéance
          const { data: existingNotif } = await supabase
            .from("notifications")
            .select("id")
            .eq("userId", userId)
            .eq("tontineSessionId", session.id)
            .eq("type", "CONTRIBUTION_REMINDER")
            .gte(
              "createdAt",
              new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString(),
            )
            .limit(1);

          if (!existingNotif || existingNotif.length === 0) {
            const lang = slot.membership?.user?.preferredLang === "en" ? "en" : "fr";
            const rawName = slot.membership?.user?.name || "Membre";
            const firstName = rawName.trim().split(/\s+/)[0] || rawName;
            const msg = renderAdvanceReminderMessage(
              lang,
              firstName,
              sessionTitle,
              totalAmount,
              diffDays,
            );

            await supabase.from("notifications").insert({
              id: createId(),
              userId,
              tontineSessionId: session.id,
              membershipSlotId: slot.id,
              channel: "IN_APP",
              type: "CONTRIBUTION_REMINDER",
              status: "SENT",
              message: msg,
              messageKey: "contributionReminderMessage",
              messageVars: {
                name: firstName,
                amount: formatXAF(totalAmount),
                cotisation: sessionTitle,
              },
              actionUrl: `/sessions/${session.id}`,
              createdAt: new Date().toISOString(),
            });

            advanceRemindersSent++;
          }
        }
      }
    } catch (_err) {
      // Ignorer si la date d'échéance ne peut pas être calculée
    }
  }

  return {
    task: "turn-reminder",
    ok: true,
    checkedAt: now.toISOString(),
    details: {
      turnBeneficiariesNotified,
      advanceRemindersSent,
    },
  };
}

// ---------------------------------------------------------------------------
// Helper commun pour les rappels d'échéance (J-1, Midi, Urgent)
// ---------------------------------------------------------------------------
async function processDueReminders(
  supabase: SupabaseClient,
  now: Date,
  options: {
    logType: "REMINDER_EVE" | "REMINDER_NOON" | "REMINDER_URGENT";
    messageKey: string;
    isTomorrow: boolean;
    renderMessage: (
      lang: string,
      name: string,
      amount: number,
      title: string,
    ) => string;
  },
): Promise<number> {
  const targetDate = options.isTomorrow
    ? new Date(now.getTime() + 24 * 60 * 60 * 1000)
    : now;
  const targetDueDateKey = toDueDateKey(targetDate);
  const targetDueDateIso = targetDueDateKey.toISOString();
  let totalSent = 0;

  for (const type of ALL_TONTINE_TYPES) {
    if (!isContributionDay(type, targetDate)) continue;

    const { data: sessions } = await supabase
      .from("tontine_sessions")
      .select("id, title, type, amount, fee")
      .eq("type", type)
      .eq("status", "ACTIVE");

    for (const session of sessions || []) {
      const sessionTitle = session.title || session.type;
      const totalAmount = Number(session.amount) + Number(session.fee);

      const { data: approvedSlots } = await supabase
        .from("membership_slots")
        .select(`
          id,
          beneficiaryName,
          membership:memberships!inner(
            id,
            userId,
            tontineSessionId,
            status,
            user:users!inner(id, name, email, preferredLang)
          ),
          contributions(id, status, dueDate)
        `)
        .eq("membership.tontineSessionId", session.id)
        .eq("membership.status", "APPROVED");

      const unpaidByUser = new Map<string, any>();
      for (const slot of approvedSlots || []) {
        const hasPaid = (slot.contributions || []).some(
          (c: any) =>
            c.status === "PAID" &&
            toDueDateKey(new Date(c.dueDate)).toISOString() === targetDueDateIso,
        );
        if (!hasPaid) {
          const userId = slot.membership.userId;
          if (!unpaidByUser.has(userId)) {
            unpaidByUser.set(userId, slot);
          }
        }
      }

      for (const [userId, slot] of unpaidByUser.entries()) {
        // Enregistrement dans notification_logs (déduplication stricte par cycle)
        const logId = createId();
        const { error: insertLogErr } = await supabase
          .from("notification_logs")
          .insert({
            id: logId,
            userId,
            tontineSessionId: session.id,
            dueDate: targetDueDateIso,
            type: options.logType,
            sentAt: new Date().toISOString(),
          });

        if (insertLogErr) {
          // Déjà envoyé pour ce cycle
          continue;
        }

        const lang = slot.membership?.user?.preferredLang === "en" ? "en" : "fr";
        const rawName = slot.membership?.user?.name || "Membre";
        const firstName = rawName.trim().split(/\s+/)[0] || rawName;
        const msg = options.renderMessage(
          lang,
          firstName,
          totalAmount,
          sessionTitle,
        );

        // 1. Notification In-App
        await supabase.from("notifications").insert({
          id: createId(),
          userId,
          tontineSessionId: session.id,
          membershipSlotId: slot.id,
          channel: "IN_APP",
          type: "CONTRIBUTION_REMINDER",
          status: "SENT",
          message: msg,
          messageKey: options.messageKey,
          messageVars: {
            name: firstName,
            amount: formatXAF(totalAmount),
            cotisation: sessionTitle,
          },
          actionUrl: `/sessions/${session.id}`,
          createdAt: new Date().toISOString(),
        });

        // 2. Notification Email programmée
        if (slot.membership?.user?.email) {
          await supabase.from("notifications").insert({
            id: createId(),
            userId,
            tontineSessionId: session.id,
            membershipSlotId: slot.id,
            channel: "EMAIL",
            type: "CONTRIBUTION_REMINDER",
            status: "SCHEDULED",
            scheduledAt: new Date().toISOString(),
            message: msg,
            actionUrl: `/sessions/${session.id}`,
            createdAt: new Date().toISOString(),
          });
        }

        totalSent++;
      }
    }
  }

  return totalSent;
}

// ---------------------------------------------------------------------------
// 2. TÂCHE : Rappel J-1 (09:00 UTC / 10:00 WAT)
// ---------------------------------------------------------------------------
export async function runReminderEveTask(
  supabase: SupabaseClient,
  now = new Date(),
): Promise<TaskResult> {
  const sent = await processDueReminders(supabase, now, {
    logType: "REMINDER_EVE",
    messageKey: "waReminderEve",
    isTomorrow: true,
    renderMessage: renderReminderEveMessage,
  });

  return {
    task: "reminder-eve",
    ok: true,
    checkedAt: now.toISOString(),
    details: { sent },
  };
}

// ---------------------------------------------------------------------------
// 3. TÂCHE : Rappel Midi (11:00 UTC / 12:00 WAT)
// ---------------------------------------------------------------------------
export async function runReminderNoonTask(
  supabase: SupabaseClient,
  now = new Date(),
): Promise<TaskResult> {
  const sent = await processDueReminders(supabase, now, {
    logType: "REMINDER_NOON",
    messageKey: "waReminderNoon",
    isTomorrow: false,
    renderMessage: renderReminderNoonMessage,
  });

  return {
    task: "reminder-noon",
    ok: true,
    checkedAt: now.toISOString(),
    details: { sent },
  };
}

// ---------------------------------------------------------------------------
// 4. TÂCHE : Rappel Urgent 17h (16:00 UTC / 17:00 WAT)
// ---------------------------------------------------------------------------
export async function runReminderUrgentTask(
  supabase: SupabaseClient,
  now = new Date(),
): Promise<TaskResult> {
  const sent = await processDueReminders(supabase, now, {
    logType: "REMINDER_URGENT",
    messageKey: "waReminderUrgent",
    isTomorrow: false,
    renderMessage: renderReminderUrgentMessage,
  });

  return {
    task: "reminder-urgent",
    ok: true,
    checkedAt: now.toISOString(),
    details: { sent },
  };
}

// ---------------------------------------------------------------------------
// 5. TÂCHE : Tour de table / Cagnotte débloquée (17:30 UTC / 18:30 WAT)
// ---------------------------------------------------------------------------
export async function runFoodTurnTask(
  supabase: SupabaseClient,
  now = new Date(),
): Promise<TaskResult> {
  let notifiedCount = 0;

  for (const type of ALL_TONTINE_TYPES) {
    if (!isContributionDay(type, now)) continue;
    const dueDate = toDueDateKey(now);
    const dueDateIso = dueDate.toISOString();

    if (!isPayoutInfoUnlockTime(dueDate, now)) continue;

    const { data: sessions } = await supabase
      .from("tontine_sessions")
      .select("id, title, type")
      .eq("type", type)
      .eq("status", "ACTIVE");

    for (const session of sessions || []) {
      const { data: designatedSlots } = await supabase
        .from("membership_slots")
        .select(`
          id,
          officialPosition,
          ballDrawn,
          membership:memberships!inner(
            id,
            userId,
            tontineSessionId,
            user:users!inner(id, name, email, preferredLang)
          ),
          payouts(id)
        `)
        .eq("membership.tontineSessionId", session.id)
        .not("officialPosition", "is", null)
        .not("ballDrawn", "is", null)
        .order("officialPosition", { ascending: true });

      const winnerSlot = (designatedSlots || []).find(
        (s: any) => !s.payouts || s.payouts.length === 0,
      );

      if (!winnerSlot) continue;

      // Vérifier si toutes les parts approuvées ont payé leur cotisation pour aujourd'hui
      const { data: allSlots } = await supabase
        .from("membership_slots")
        .select("id, membership:memberships!inner(tontineSessionId, status)")
        .eq("membership.tontineSessionId", session.id)
        .eq("membership.status", "APPROVED");

      const slotIds = (allSlots || []).map((s) => s.id);
      if (slotIds.length === 0) continue;

      const { count: paidCount } = await supabase
        .from("contributions")
        .select("id", { count: "exact", head: true })
        .in("membershipSlotId", slotIds)
        .eq("dueDate", dueDateIso)
        .eq("status", "PAID");

      if ((paidCount || 0) < slotIds.length) {
        // Toutes les cotisations ne sont pas encore complétées
        continue;
      }

      // Enregistrement dans food_turn_logs (déduplication stricte)
      const logId = createId();
      const { error: logErr } = await supabase.from("food_turn_logs").insert({
        id: logId,
        membershipSlotId: winnerSlot.id,
        dueDate: dueDateIso,
        sentAt: new Date().toISOString(),
      });

      if (logErr) {
        // Déjà notifié
        continue;
      }

      const lang = winnerSlot.membership?.user?.preferredLang === "en" ? "en" : "fr";
      const rawName = winnerSlot.membership?.user?.name || "Gagnant";
      const firstName = rawName.trim().split(/\s+/)[0] || rawName;
      const msg = renderFoodTurnMessage(lang, firstName);

      await supabase.from("notifications").insert({
        id: createId(),
        userId: winnerSlot.membership.userId,
        tontineSessionId: session.id,
        membershipSlotId: winnerSlot.id,
        channel: "IN_APP",
        type: "FOOD_TURN",
        status: "SENT",
        message: msg,
        messageKey: "foodTurnMessage",
        messageVars: { name: firstName },
        actionUrl: `/sessions/${session.id}`,
        createdAt: new Date().toISOString(),
      });

      if (winnerSlot.membership?.user?.email) {
        await supabase.from("notifications").insert({
          id: createId(),
          userId: winnerSlot.membership.userId,
          tontineSessionId: session.id,
          membershipSlotId: winnerSlot.id,
          channel: "EMAIL",
          type: "FOOD_TURN",
          status: "SCHEDULED",
          scheduledAt: new Date().toISOString(),
          message: msg,
          actionUrl: `/sessions/${session.id}`,
          createdAt: new Date().toISOString(),
        });
      }

      notifiedCount++;
    }
  }

  return {
    task: "food-turn",
    ok: true,
    checkedAt: now.toISOString(),
    details: { notifiedCount },
  };
}

// ---------------------------------------------------------------------------
// 6. TÂCHE : Application des amendes après 18h31 (17:31 UTC / 18:31 WAT)
// ---------------------------------------------------------------------------
export async function runCheckPenaltiesTask(
  supabase: SupabaseClient,
  now = new Date(),
): Promise<TaskResult> {
  let finesIssued = 0;
  let finesUpdated = 0;

  const { data: activeSessions } = await supabase
    .from("tontine_sessions")
    .select(`
      id,
      title,
      type,
      startDate,
      fineAmountPerPeriod,
      fineIntervalHours,
      memberships:memberships!inner(
        id,
        userId,
        status,
        user:users!inner(id, name, email, preferredLang),
        slots:membership_slots(id, beneficiaryName)
      )
    `)
    .eq("status", "ACTIVE")
    .eq("memberships.status", "APPROVED");

  for (const session of activeSessions || []) {
    if (!session.startDate) continue;

    const approvedMemberships = session.memberships || [];
    const allSlots = approvedMemberships.flatMap((m: any) => m.slots || []);
    const totalSlots = allSlots.length || 1;

    for (let round = 1; round <= totalSlots; round++) {
      const roundDueDate = getCycleDateForRound(
        session.type as TontineType,
        new Date(session.startDate),
        round,
      );

      if (roundDueDate > now) break; // Rondes futures, arrêt
      const cutoff = getCutoffInstant(roundDueDate);
      if (now < cutoff) continue; // Pas encore dépassé l'heure limite (18h31)

      const fineAmount = computeFine(session.type as TontineType, now, cutoff, {
        fineAmountPerPeriod: session.fineAmountPerPeriod
          ? Number(session.fineAmountPerPeriod)
          : null,
        fineIntervalHours: session.fineIntervalHours,
      });

      if (fineAmount <= 0) continue;
      const roundDueDateIso = toDueDateKey(roundDueDate).toISOString();

      for (const m of approvedMemberships) {
        for (const slot of m.slots || []) {
          // Vérifier si cotisation déjà payée
          const { data: contrib } = await supabase
            .from("contributions")
            .select("id, status")
            .eq("membershipSlotId", slot.id)
            .eq("dueDate", roundDueDateIso)
            .maybeSingle();

          if (contrib?.status === "PAID") continue;

          // Vérifier si amende existante
          const { data: existingFine } = await supabase
            .from("fines")
            .select("id, amount, status")
            .eq("membershipSlotId", slot.id)
            .eq("dueDate", roundDueDateIso)
            .maybeSingle();

          if (existingFine && existingFine.status !== "UNPAID") {
            // Amende déjà réglée ou déduite
            continue;
          }

          if (existingFine) {
            await supabase
              .from("fines")
              .update({
                amount: fineAmount,
                updatedAt: new Date().toISOString(),
              })
              .eq("id", existingFine.id);
            finesUpdated++;
          } else {
            const fineId = createId();
            await supabase.from("fines").insert({
              id: fineId,
              membershipSlotId: slot.id,
              dueDate: roundDueDateIso,
              amount: fineAmount,
              status: "UNPAID",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
            finesIssued++;

            // Notifier le membre la première fois qu'il est en retard
            const logId = createId();
            const { error: logErr } = await supabase
              .from("notification_logs")
              .insert({
                id: logId,
                userId: m.userId,
                tontineSessionId: session.id,
                dueDate: roundDueDateIso,
                type: "FINE_NOTICE",
                sentAt: new Date().toISOString(),
              });

            if (!logErr) {
              const lang = m.user?.preferredLang === "en" ? "en" : "fr";
              const rawName = m.user?.name || "Membre";
              const firstName = rawName.trim().split(/\s+/)[0] || rawName;
              const msg = renderFineNoticeMessage(
                lang,
                firstName,
                fineAmount,
                session.title || session.type,
              );

              await supabase.from("notifications").insert({
                id: createId(),
                userId: m.userId,
                tontineSessionId: session.id,
                membershipSlotId: slot.id,
                channel: "IN_APP",
                type: "FINE_REMINDER",
                status: "SENT",
                message: msg,
                messageKey: "waFineNotice",
                messageVars: {
                  name: firstName,
                  amount: formatXAF(fineAmount),
                  cotisation: session.title || session.type,
                },
                actionUrl: "/fines",
                createdAt: new Date().toISOString(),
              });

              if (m.user?.email) {
                await supabase.from("notifications").insert({
                  id: createId(),
                  userId: m.userId,
                  tontineSessionId: session.id,
                  membershipSlotId: slot.id,
                  channel: "EMAIL",
                  type: "FINE_REMINDER",
                  status: "SCHEDULED",
                  scheduledAt: new Date().toISOString(),
                  message: msg,
                  actionUrl: "/fines",
                  createdAt: new Date().toISOString(),
                });
              }
            }
          }
        }
      }
    }
  }

  return {
    task: "check-penalties",
    ok: true,
    checkedAt: now.toISOString(),
    details: { finesIssued, finesUpdated },
  };
}

// ---------------------------------------------------------------------------
// 7. TÂCHE : File d'attente des remboursements automatiques (06:00 UTC / 07:00 WAT)
// ---------------------------------------------------------------------------
export async function runProcessRefundQueueTask(
  supabase: SupabaseClient,
  now = new Date(),
): Promise<TaskResult> {
  const { data: dueAttempts, error } = await supabase
    .from("payment_attempts")
    .select("id, amount, payerPhone, refundAttempts")
    .eq("status", "DUPLICATE_PAID")
    .or(`nextRefundAttemptAt.is.null,nextRefundAttemptAt.lte.${now.toISOString()}`)
    .limit(50);

  if (error) {
    return {
      task: "process-refund-queue",
      ok: false,
      checkedAt: now.toISOString(),
      details: {},
      error: error.message,
    };
  }

  let processed = 0;
  let escalated = 0;

  for (const attempt of dueAttempts || []) {
    const attempts = (attempt.refundAttempts || 0) + 1;
    if (attempts >= 3) {
      // Escalade en revue manuelle
      await supabase
        .from("payment_attempts")
        .update({
          status: "REFUND_FAILED_MANUAL_REVIEW",
          refundAttempts: attempts,
          lastRefundError: "Max automatic refund attempts reached (3)",
          updatedAt: new Date().toISOString(),
        })
        .eq("id", attempt.id);
      escalated++;
    } else {
      // Replanification exponentielle
      const backoffMs = 5 * 2 ** (attempts - 1) * 60_000;
      await supabase
        .from("payment_attempts")
        .update({
          refundAttempts: attempts,
          nextRefundAttemptAt: new Date(Date.now() + backoffMs).toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .eq("id", attempt.id);
    }
    processed++;
  }

  return {
    task: "process-refund-queue",
    ok: true,
    checkedAt: now.toISOString(),
    details: { processed, escalated },
  };
}

// ---------------------------------------------------------------------------
// DISPATCHER AUTOMATIQUE (selon l'heure camerounaise actuelle)
// ---------------------------------------------------------------------------
export async function runAutoDispatcher(
  supabase: SupabaseClient,
  now = new Date(),
): Promise<TaskResult[]> {
  const parts = getCameroonDateParts(now);
  const hour = parts.hours;
  const minute = parts.minutes;
  const results: TaskResult[] = [];

  // 08h00 WAT (07:00 UTC) -> Rappel tour du lendemain & cotisations anticipées
  if (hour === 8 || (hour === 7 && minute >= 55)) {
    results.push(await runTurnReminderTask(supabase, now));
  }

  // 10h00 WAT (09:00 UTC) -> Rappel J-1
  if (hour === 10 || (hour === 9 && minute >= 55)) {
    results.push(await runReminderEveTask(supabase, now));
  }

  // 12h00 WAT (11:00 UTC) -> Rappel Midi
  if (hour === 12 || (hour === 11 && minute >= 55)) {
    results.push(await runReminderNoonTask(supabase, now));
  }

  // 17h00 WAT (16:00 UTC) -> Rappel Urgent
  if (hour === 17 && minute < 25) {
    results.push(await runReminderUrgentTask(supabase, now));
  }

  // 18h30 - 18h40 WAT (17:30 UTC) -> Déblocage de la cagnotte
  if (hour === 18 && minute >= 30) {
    results.push(await runFoodTurnTask(supabase, now));
  }

  // 18h31+ WAT -> Amendes de retard
  if (hour === 18 && minute >= 31) {
    results.push(await runCheckPenaltiesTask(supabase, now));
  }

  // 07h00 WAT (06:00 UTC) -> File de remboursement
  if (hour === 7 && minute < 30) {
    results.push(await runProcessRefundQueueTask(supabase, now));
  }

  if (results.length === 0) {
    results.push({
      task: "auto-dispatcher",
      ok: true,
      checkedAt: now.toISOString(),
      details: {
        message: "No specific scheduled task due at this exact hour/minute",
        cameroonTime: `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`,
      },
    });
  }

  return results;
}

