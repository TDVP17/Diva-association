/**
 * Script de test réel à 100 FCFA pour l'Edge Function Supabase `fapshi-pay`.
 *
 * Commandes :
 *   1) Préparer les données isolées de test (100 FCFA, verrouillées aux vrais membres) :
 *      node --env-file=.env scripts/test-fapshi-edge-100.mjs setup
 *
 *   2) Tester un paiement normal (100 FCFA + 3 FCFA frais = 103 FCFA) :
 *      node --env-file=.env scripts/test-fapshi-edge-100.mjs pay-normal 6XXXXXXXX
 *
 *   3) Tester un paiement pour un proche (100 FCFA + 3 FCFA frais = 103 FCFA) :
 *      node --env-file=.env scripts/test-fapshi-edge-100.mjs pay-proche 6XXXXXXXX
 *
 *   4) Tester la sécurité et le règlement du webhook Fapshi sur un transId :
 *      node --env-file=.env scripts/test-fapshi-edge-100.mjs test-webhook <TRANS_ID>
 *
 *   5) Nettoyer toutes les données de test après validation :
 *      node --env-file=.env scripts/test-fapshi-edge-100.mjs cleanup
 */

import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FAPSHI_WEBHOOK_SECRET = process.env.FAPSHI_WEBHOOK_SECRET;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Variables NEXT_PUBLIC_SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY manquantes dans .env");
  process.exit(1);
}

const EDGE_BASE_URL = `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/fapshi-pay`;

const TEST_SESSION_ID = "ctest_edge_fapshi_100fcfa";
const TEST_MEMBER_EMAIL = "test-edge-membre@divaasso.local";
const TEST_RELATIVE_EMAIL = "test-edge-proche@divaasso.local";
const TEST_PASSWORD = "TestEdgeFapshi!2026#Diva";
const TEST_SLOT_SELF_ID = "ctest_slot_normal_100fcfa";
const TEST_SLOT_REL_ID = "ctest_slot_proche_100fcfa";
const TEST_MEMBERSHIP_ID = "ctest_memb_edge_100fcfa";

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function createId() {
  return "c" + Date.now().toString(36) + crypto.randomBytes(8).toString("hex").slice(0, 14);
}

async function ensureTestUser(email, name) {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  let authUser = list?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());

  if (!authUser) {
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { name },
    });
    if (error) throw error;
    authUser = created.user;
  } else {
    await admin.auth.admin.updateUserById(authUser.id, {
      password: TEST_PASSWORD,
      email_confirm: true,
    });
  }

  const { data: existingDb } = await admin
    .from("users")
    .select("id, email")
    .ilike("email", email)
    .maybeSingle();

  if (existingDb) return existingDb.id;

  const newId = createId();
  const { error: insErr } = await admin.from("users").insert({
    id: newId,
    email,
    name,
    role: "MEMBER",
    preferredLang: "fr",
    isBanned: false,
    emailVerified: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  });
  if (insErr) throw insErr;
  return newId;
}

async function signInAndGetToken(email) {
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });
  if (error || !data.session?.access_token) {
    throw new Error(`Échec connexion test (${email}): ${error?.message}`);
  }
  return data.session.access_token;
}

async function runSetup() {
  console.log("Configuration de l'environnement de test 100 FCFA...");
  const memberUserId = await ensureTestUser(TEST_MEMBER_EMAIL, "Test Membre Edge 100F");
  const relativeUserId = await ensureTestUser(TEST_RELATIVE_EMAIL, "Test Proche Edge 100F");

  const nowIso = new Date().toISOString();
  // Session verrouillée (lockedAt + maxSlots=2 déjà remplis) pour qu'aucun vrai membre ne puisse rejoindre
  await admin.from("tontine_sessions").upsert({
    id: TEST_SESSION_ID,
    title: "[TEST TECHNIQUE 100F]",
    description: "Session temporaire de test Edge Function Fapshi 100 FCFA",
    type: "HEBDO_SUNDAY",
    amount: 100,
    fee: 0,
    status: "ACTIVE",
    startDate: nowIso,
    limitTime: "18:30",
    maxSlots: 2,
    isPaused: false,
    lockedAt: nowIso,
  });

  await admin.from("memberships").upsert({
    id: TEST_MEMBERSHIP_ID,
    userId: memberUserId,
    tontineSessionId: TEST_SESSION_ID,
    status: "APPROVED",
    slotCount: 2,
    joinedAt: nowIso,
  });

  await admin.from("membership_slots").upsert([
    {
      id: TEST_SLOT_SELF_ID,
      membershipId: TEST_MEMBERSHIP_ID,
      beneficiaryName: "Part Test Normal 100F",
      officialPosition: 1,
      ballDrawn: 1,
      createdAt: nowIso,
    },
    {
      id: TEST_SLOT_REL_ID,
      membershipId: TEST_MEMBERSHIP_ID,
      beneficiaryName: "Part Test Proche 100F",
      officialPosition: 2,
      ballDrawn: 2,
      createdAt: nowIso,
    },
  ]);

  // Réinitialise d'éventuelles contributions de tests précédents sur ces 2 parts
  await admin
    .from("contributions")
    .delete()
    .in("membershipSlotId", [TEST_SLOT_SELF_ID, TEST_SLOT_REL_ID]);

  console.log("\n✅ Environnement de test 100 FCFA prêt !");
  console.log(`- Edge Function URL : ${EDGE_BASE_URL}`);
  console.log(`- Webhook URL Fapshi : ${EDGE_BASE_URL}/webhook`);
  console.log(`- Compte Membre ID  : ${memberUserId}`);
  console.log(`- Compte Proche ID  : ${relativeUserId}`);
  console.log("\nProchaines étapes :");
  console.log("  node --env-file=.env scripts/test-fapshi-edge-100.mjs pay-normal 6XXXXXXXX");
  console.log("  node --env-file=.env scripts/test-fapshi-edge-100.mjs pay-proche 6XXXXXXXX");
}

async function watchRealtimeSettlement(transId) {
  console.log(`\n⏳ En attente de validation USSD sur votre téléphone (transId: ${transId})...`);
  console.log("   (Écoute Supabase Realtime en direct — 0 polling !)");

  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return new Promise((resolve) => {
    const timeout = setTimeout(async () => {
      console.log("\n⚠️ 75s écoulées sans webhook : vérification directe via GET /status...");
      const r = await fetch(`${EDGE_BASE_URL}/status?transId=${encodeURIComponent(transId)}`);
      const b = await r.json().catch(() => ({}));
      console.log("Réponse GET /status :", b);
      await anon.removeAllChannels();
      resolve(b);
    }, 75_000);

    const ch = anon
      .channel(`test-watch:${transId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "payment_attempts",
          filter: `transId=eq.${transId}`,
        },
        async (payload) => {
          const status = payload.new?.status;
          console.log(`\n🔔 Événement Realtime reçu sur payment_attempts ! Nouveau statut = ${status}`);
          if (status && status !== "PENDING") {
            clearTimeout(timeout);
            await anon.removeAllChannels();
            resolve(payload.new);
          }
        },
      )
      .subscribe();
  });
}

async function runPayment(mode, phone) {
  if (!phone) {
    console.error("Veuillez fournir votre numéro Mobile Money / Orange Money : ex. 677123456");
    process.exit(1);
  }

  const { data: existingSession } = await admin
    .from("tontine_sessions")
    .select("id")
    .eq("id", TEST_SESSION_ID)
    .maybeSingle();
  if (!existingSession) {
    await runSetup();
  }

  const isRelative = mode === "relative";
  const email = isRelative ? TEST_RELATIVE_EMAIL : TEST_MEMBER_EMAIL;
  const slotId = isRelative ? TEST_SLOT_REL_ID : TEST_SLOT_SELF_ID;
  const endpoint = isRelative ? `${EDGE_BASE_URL}/relative` : `${EDGE_BASE_URL}/initiate`;

  console.log(`1. Authentification Supabase Auth (${email})...`);
  const token = await signInAndGetToken(email);

  console.log(`2. Vérification du devis via POST ${EDGE_BASE_URL}/quote...`);
  const quoteRes = await fetch(`${EDGE_BASE_URL}/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ membershipSlotId: slotId }),
  });
  const quote = await quoteRes.json();
  console.log("   Devis reçu :", quote);

  console.log(`3. Appel POST ${endpoint} (montant débité : ${quote.totalCharged} FCFA)...`);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      membershipSlotId: slotId,
      phone,
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    console.error(`❌ Erreur HTTP ${res.status} :`, body);
    process.exit(1);
  }

  console.log("✅ Push USSD envoyé avec succès ! Réponse Edge Function :", body);
  if (body.link) {
    console.log(`🔗 Lien de paiement Fapshi (si Direct Pay désactivé) : ${body.link}`);
  }

  await watchRealtimeSettlement(body.transId);

  const { data: contrib } = await admin
    .from("contributions")
    .select("id, status, amountPaid, paidByUserId, fapshiTxRef, receiptPdfUrl")
    .eq("membershipSlotId", slotId)
    .maybeSingle();
  console.log("\n📊 État final de la contribution en base :", contrib);
}

async function runWebhookTest(transId) {
  if (!transId) {
    console.error("Usage : node --env-file=.env scripts/test-fapshi-edge-100.mjs test-webhook <TRANS_ID>");
    process.exit(1);
  }

  console.log("1. Test sécurité : envoi d'un FAUX secret x-wh-secret (doit renvoyer 401)...");
  const badRes = await fetch(`${EDGE_BASE_URL}/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-wh-secret": "invalid_secret_test",
    },
    body: JSON.stringify({ transId }),
  });
  console.log(`   Résultat faux secret : HTTP ${badRes.status} (attendu: 401)`);

  console.log("2. Test webhook authentique avec FAPSHI_WEBHOOK_SECRET...");
  const goodRes = await fetch(`${EDGE_BASE_URL}/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-wh-secret": FAPSHI_WEBHOOK_SECRET || "",
    },
    body: JSON.stringify({ transId }),
  });
  const goodBody = await goodRes.json().catch(() => null);
  console.log(`   Résultat vrai secret : HTTP ${goodRes.status}`, goodBody);
}

async function runCleanup() {
  console.log("Nettoyage des données de test 100 FCFA...");
  await admin
    .from("audit_logs")
    .delete()
    .in("targetId", [TEST_SLOT_SELF_ID, TEST_SLOT_REL_ID]);
  await admin.from("tontine_sessions").delete().eq("id", TEST_SESSION_ID);

  for (const email of [TEST_MEMBER_EMAIL, TEST_RELATIVE_EMAIL]) {
    await admin.from("users").delete().ilike("email", email);
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const found = list?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) {
      await admin.auth.admin.deleteUser(found.id);
    }
  }
  console.log("✅ Nettoyage terminé ! Aucune trace de test restante en base.");
}

const [cmd, arg] = process.argv.slice(2);
switch (cmd) {
  case "setup":
    await runSetup();
    break;
  case "pay-normal":
    await runPayment("normal", arg);
    break;
  case "pay-proche":
    await runPayment("relative", arg);
    break;
  case "test-webhook":
    await runWebhookTest(arg);
    break;
  case "cleanup":
    await runCleanup();
    break;
  default:
    console.log("Commandes disponibles : setup | pay-normal <tel> | pay-proche <tel> | test-webhook <transId> | cleanup");
}

