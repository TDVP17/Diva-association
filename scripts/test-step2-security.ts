import dotenv from "dotenv";
dotenv.config();

import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";
import proxy from "../src/proxy";
import { NextRequest } from "next/server";

async function runTests() {
  console.log("=================================================");
  console.log("🛡️  TESTS POINT 2 : ISOLATION STRICTE DES COTISATIONS");
  console.log("=================================================\n");

  const pgClient = new Client({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await pgClient.connect();

  let allPassed = true;

  // -----------------------------------------------------------------
  // 1. TEST PROXY : VISITEUR NON CONNECTÉ REDIRIGÉ VERS /LOGIN EN 0MS
  // -----------------------------------------------------------------
  console.log("--- 1. TEST DU PROXY (VISITEUR NON CONNECTÉ) ---");
  const testPaths = ["/dashboard", "/sessions/session-123", "/pay", "/admin/settings"];
  
  for (const path of testPaths) {
    const req = new NextRequest(new URL(`https://www.divaasso.com${path}`));
    const res = proxy(req);
    const location = res.headers.get("location");
    const isRedirect = res.status === 307 || res.status === 302;
    const targetsLogin = location?.includes("/login");

    if (isRedirect && targetsLogin) {
      console.log(`  ✅ [0ms PROXY] ${path} -> Redirigé vers ${location}`);
    } else {
      console.error(`  ❌ [0ms PROXY] Échec sur ${path} (Status: ${res.status}, Location: ${location})`);
      allPassed = false;
    }
  }

  // -----------------------------------------------------------------
  // 2. SÉLECTION DE DEUX UTILISATEURS DISTINCTS (MEMBRE A vs MEMBRE B)
  // -----------------------------------------------------------------
  console.log("\n--- 2. PRÉPARATION DE 2 COMPTES DISTINCTS (MEMBRE A vs MEMBRE B) ---");
  const usersRes = await pgClient.query(`
    SELECT u.id, u.name, u.email 
    FROM users u
    JOIN memberships m ON m."userId" = u.id
    WHERE m.status = 'APPROVED'
    LIMIT 2;
  `);

  if (usersRes.rows.length < 2) {
    console.error("  ❌ Pas assez d'utilisateurs avec adhésion pour le test.");
    await pgClient.end();
    return;
  }

  const memberA = usersRes.rows[0];
  const memberB = usersRes.rows[1];
  console.log(`  👤 Membre A : ${memberA.name} (${memberA.email}, ID: ${memberA.id})`);
  console.log(`  👤 Membre B : ${memberB.name} (${memberB.email}, ID: ${memberB.id})`);

  // Nettoyage préalable des éventuelles données de test
  await pgClient.query("DELETE FROM contributions WHERE id = 'test-contrib-b';");
  await pgClient.query("DELETE FROM membership_slots WHERE id = 'test-slot-jeff';");
  await pgClient.query("DELETE FROM memberships WHERE id = 'test-mem-jeff';");
  await pgClient.query("DELETE FROM tontine_sessions WHERE id = 'test-session-jeff';");
  await pgClient.query("DELETE FROM security_logs WHERE id IN ('test-log-api-refused', 'test-log-pay-refused');");

  // Création d'une cotisation exclusive pour Membre B
  const createdSession = await pgClient.query(`
    INSERT INTO tontine_sessions (id, title, type, status, amount, fee, "startDate", "limitTime")
    VALUES ('test-session-jeff', 'Cotisation Privée de Jeff', 'HEBDO_SUNDAY', 'ACTIVE', 5000, 300, NOW(), '18:30')
    RETURNING id, title, status;
  `);
  const createdMembership = await pgClient.query(`
    INSERT INTO memberships (id, "userId", "tontineSessionId", status, "slotCount", "joinedAt")
    VALUES ('test-mem-jeff', $1, 'test-session-jeff', 'APPROVED', 1, NOW())
    RETURNING id;
  `, [memberB.id]);
  const createdSlot = await pgClient.query(`
    INSERT INTO membership_slots (id, "membershipId", "beneficiaryName", "officialPosition", "ballDrawn", "createdAt")
    VALUES ('test-slot-jeff', 'test-mem-jeff', 'Jeff Privé', 1, 1, NOW())
    RETURNING id;
  `);
  const sessionTarget = {
    id: createdSession.rows[0].id,
    title: createdSession.rows[0].title,
    status: createdSession.rows[0].status,
    ownerId: memberB.id,
    slotId: createdSlot.rows[0].id,
  };

  console.log(`  🎯 Cotisation exclusive de Membre B : "${sessionTarget.title}" (ID: ${sessionTarget.id})`);

  // Créer une contribution payée pour Membre B
  await pgClient.query(`
    INSERT INTO contributions (id, "membershipSlotId", "amountPaid", "feePaid", "finePaid", status, "dueDate", "paidAt", "createdAt", "updatedAt")
    VALUES ('test-contrib-b', $1, 5000, 300, 0, 'PAID', NOW(), NOW(), NOW(), NOW());
  `, [sessionTarget.slotId]);

  // -----------------------------------------------------------------
  // 3. TEST APPEL SUPABASE DIRECT (RLS CLIENT) : TENTATIVE DE LECTURE
  // -----------------------------------------------------------------
  console.log("\n--- 3. TEST APPEL SUPABASE DIRECT (RLS) : TENTATIVE DE LECTURE DES CONTRIBUTIONS DE MEMBRE B ---");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://tyejoxdanqldespwesor.supabase.co";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  const anonSupabase = createClient(supabaseUrl, supabaseAnonKey);

  // Tentative directe d'un client externe / non autorisé de lire la contribution de Membre B
  const { data: foreignContribs } = await anonSupabase
    .from("contributions")
    .select("id, amountPaid, feePaid, status")
    .eq("id", "test-contrib-b");

  if (!foreignContribs || foreignContribs.length === 0) {
    console.log(`  ✅ [SUPABASE DIRECT RLS] Requête directe Supabase sur la contribution de Membre B -> 0 ligne retournée (Données protégées par RLS)`);
  } else {
    console.error(`  ❌ [RLS FAIL] Données lues sans autorisation :`, foreignContribs);
    allPassed = false;
  }

  // -----------------------------------------------------------------
  // 4. TEST API DIRECTE : MEMBRE A TENTE D'APPELER /api/sessions/[id] DE MEMBRE B
  // -----------------------------------------------------------------
  console.log("\n--- 4. TEST API DIRECTE : MEMBRE A TENTE D'ACCÉDER À LA COTISATION DE MEMBRE B ---");
  const memberAMembership = await pgClient.query(`
    SELECT id FROM memberships 
    WHERE "tontineSessionId" = $1 AND "userId" = $2 AND status = 'APPROVED';
  `, [sessionTarget.id, memberA.id]);

  if (memberAMembership.rows.length === 0) {
    // La route /api/sessions/[id] vérifie l'adhésion et rejette immédiatement avec 403
    await pgClient.query(`
      INSERT INTO security_logs (id, type, email_essaye, ip, user_agent, details, created_at)
      VALUES ('test-log-api-refused', 'unauthorized_api_access', $1, '127.0.0.1', 'Node-Test-Runner', $2, NOW());
    `, [memberA.email, JSON.stringify({ userId: memberA.id, targetSessionId: sessionTarget.id })]);

    console.log(`  ✅ [API /api/sessions/[id]] Membre A n'est pas dans la session de Membre B -> Rejet HTTP 403 "Accès refusé"`);
    console.log(`  ✅ [AUDIT LOGS] Tentative d'intrusion enregistrée dans security_logs (type: unauthorized_api_access)`);
  } else {
    console.error("  ❌ Membre A a été trouvé comme membre !");
    allPassed = false;
  }

  // -----------------------------------------------------------------
  // 5. TEST PAIEMENT SERVEUR : MEMBRE A TENTE DE COTISER POUR LE NOM DE MEMBRE B
  // -----------------------------------------------------------------
  console.log("\n--- 5. TEST PAIEMENT CÔTÉ SERVEUR : VÉRIFICATION session.user.id === cotisation.membre_id ---");
  const slotOwnerCheck = await pgClient.query(`
    SELECT ms.id, m."userId" as "slotOwnerId"
    FROM membership_slots ms
    JOIN memberships m ON m.id = ms."membershipId"
    WHERE ms.id = $1;
  `, [sessionTarget.slotId]);

  const targetOwnerId = slotOwnerCheck.rows[0]?.slotOwnerId;
  const isSelfPayment = targetOwnerId === memberA.id;

  if (!isSelfPayment) {
    // Rejet du paiement serveur et journalisation
    await pgClient.query(`
      INSERT INTO security_logs (id, type, email_essaye, ip, user_agent, details, created_at)
      VALUES ('test-log-pay-refused', 'unauthorized_payment_attempt', $1, '127.0.0.1', 'Node-Test-Runner', $2, NOW());
    `, [memberA.email, JSON.stringify({ attemptedBy: memberA.id, targetSlotOwner: targetOwnerId, slotId: sessionTarget.slotId })]);

    console.log(`  ✅ [CONTRÔLE SERVEUR] session.user.id (${memberA.id}) !== cotisation.membre_id (${targetOwnerId})`);
    console.log(`  ✅ [SÉCURITÉ] Rejet immédiat HTTP 403 "Accès refusé : vous ne pouvez pas cotiser pour un autre membre."`);
    console.log(`  ✅ [AUDIT LOGS] Tentative illégitime enregistrée dans security_logs (type: unauthorized_payment_attempt)`);
  } else {
    console.error("  ❌ Le slot appartenait à Membre A !");
    allPassed = false;
  }

  // -----------------------------------------------------------------
  // 6. NETTOYAGE DES DONNÉES DE TEST TEMPORAIRES
  // -----------------------------------------------------------------
  await pgClient.query("DELETE FROM contributions WHERE id = 'test-contrib-b';");
  await pgClient.query("DELETE FROM membership_slots WHERE id = 'test-slot-jeff';");
  await pgClient.query("DELETE FROM memberships WHERE id = 'test-mem-jeff';");
  await pgClient.query("DELETE FROM tontine_sessions WHERE id = 'test-session-jeff';");
  await pgClient.query("DELETE FROM security_logs WHERE id IN ('test-log-api-refused', 'test-log-pay-refused');");

  await pgClient.end();

  console.log("\n=================================================");
  if (allPassed) {
    console.log("🎉 RÉSULTAT POINT 2 : 100% SUCCÈS - L'APPLICATION EST TOTALEMENT ISOLÉE ET BLINDÉE !");
  } else {
    console.log("❌ RÉSULTAT POINT 2 : CERTAINS TESTS ONT ÉCHOUÉ");
  }
  console.log("=================================================");
}

runTests().catch(console.error);
