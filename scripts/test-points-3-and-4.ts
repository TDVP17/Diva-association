import dotenv from "dotenv";
dotenv.config();

// Ensure local Node process uses DIRECT_URL (port 5432) for stable pooler connection
if (process.env.DIRECT_URL) {
  process.env.DATABASE_URL = process.env.DIRECT_URL;
}

import { Client } from "pg";
import {
  checkIpIsBlocked,
  recordFailedLoginAttempt,
  isAppLocked,
  setAppLocked,
} from "../src/lib/security";
import { initiateSlotPayment } from "../src/lib/initiate-slot-payment";

async function runTests() {
  console.log("=================================================");
  console.log("🛡️  TESTS POINTS 3 & 4 : ANTI-BRUTE-FORCE & BOUTON PANIQUE");
  console.log("=================================================\n");

  const pgClient = new Client({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await pgClient.connect();

  let allPassed = true;
  const testIp = `192.168.10.${Math.floor(Math.random() * 800) + 100}`;
  const testTargetEmail = "hacker-test@fakeattacker.com";

  // -------------------------------------------------------------
  // POINT 3 : TESTS ANTI-BRUTE-FORCE & ALERTES ADMIN
  // -------------------------------------------------------------
  console.log("--- POINT 3.1 : TEST ÉCHEC 1 (Enregistrement du log de sécurité) ---");
  const fail1 = await recordFailedLoginAttempt({
    emailEssaye: testTargetEmail,
    ip: testIp,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AttackBot/1.0",
    country: "Cameroun (Douala)",
  });
  console.log(`  Tentative 1 -> Échecs comptabilisés : ${fail1.failuresCount}, Bloqué : ${fail1.blocked}`);
  if (fail1.failuresCount === 1 && !fail1.blocked) {
    console.log("  ✅ Échec 1 enregistré sans blocage prématuré.");
  } else {
    console.error("  ❌ Échec inattendu sur tentative 1.");
    allPassed = false;
  }

  console.log("\n--- POINT 3.2 : TEST ÉCHEC 2 (Alerte immédiate email à l'admin) ---");
  const fail2 = await recordFailedLoginAttempt({
    emailEssaye: testTargetEmail,
    ip: testIp,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AttackBot/1.0",
    country: "Cameroun (Douala)",
  });
  console.log(`  Tentative 2 -> Échecs comptabilisés : ${fail2.failuresCount}, Bloqué : ${fail2.blocked}`);

  // Vérifie si le log d'alerte admin a été écrit
  const alertLogRes = await pgClient.query(`
    SELECT * FROM security_logs 
    WHERE type = 'admin_alert_sent' AND ip = $1
    ORDER BY created_at DESC LIMIT 1;
  `, [testIp]);

  if (alertLogRes.rows.length > 0) {
    console.log(`  ✅ [ALERTE EMAIL ENVOYÉE] Alerte expédiée à l'admin pour l'IP ${testIp} et l'email ${testTargetEmail}`);
    console.log(`     Détails log :`, alertLogRes.rows[0].details);
  } else {
    console.error("  ❌ Le log admin_alert_sent est introuvable après 2 échecs.");
    allPassed = false;
  }

  console.log("\n--- POINT 3.3 : TEST ÉCHECS 3, 4 et 5 (Blocage IP 30 minutes) ---");
  await recordFailedLoginAttempt({ emailEssaye: testTargetEmail, ip: testIp, userAgent: "AttackBot/1.0", country: "Cameroun" });
  await recordFailedLoginAttempt({ emailEssaye: testTargetEmail, ip: testIp, userAgent: "AttackBot/1.0", country: "Cameroun" });
  const fail5 = await recordFailedLoginAttempt({ emailEssaye: testTargetEmail, ip: testIp, userAgent: "AttackBot/1.0", country: "Cameroun" });
  
  console.log(`  Tentative 5 -> Échecs comptabilisés : ${fail5.failuresCount}, Bloqué : ${fail5.blocked}`);

  // Vérifie la fonction checkIpIsBlocked
  const blockCheck = await checkIpIsBlocked(testIp);
  console.log(`  checkIpIsBlocked(${testIp}) -> isBlocked: ${blockCheck.isBlocked}, remainingMinutes: ${blockCheck.remainingMinutes} min`);

  if (fail5.blocked && blockCheck.isBlocked && blockCheck.remainingMinutes > 0) {
    console.log(`  ✅ [BLOCAGE IP CONFIRMÉ] L'IP ${testIp} est bloquée pour 30 minutes.`);
  } else {
    console.error("  ❌ Échec du blocage IP après 5 tentatives.");
    allPassed = false;
  }

  // -------------------------------------------------------------
  // POINT 4 : TESTS DU BOUTON PANIQUE (VERROUILLAGE TOTAL)
  // -------------------------------------------------------------
  console.log("\n=================================================");
  console.log("--- POINT 4.1 : ACTIVATION DU BOUTON PANIQUE ---");
  const lockResult = await setAppLocked({
    isLocked: true,
    adminEmail: "divaasso17@gmail.com",
    reason: "Test automatique de blindage de sécurité - Bouton Panique",
  });
  console.log("  Résultat setAppLocked(true) :", lockResult);

  const isLockedNow = await isAppLocked();
  console.log(`  isAppLocked() = ${isLockedNow}`);

  if (isLockedNow) {
    console.log("  ✅ [VERROUILLAGE ACTIF] app_settings.is_locked est à TRUE.");
  } else {
    console.error("  ❌ app_settings.is_locked n'est pas à true.");
    allPassed = false;
  }

  console.log("\n--- POINT 4.2 : TEST REJET PAIEMENT CÔTÉ SERVEUR PENDANT LE VERROUILLAGE ---");
  // Recherche un slot actif
  const sampleSlot = await pgClient.query(`
    SELECT ms.id, ms."beneficiaryName"
    FROM membership_slots ms
    JOIN memberships m ON ms."membershipId" = m.id
    WHERE m.status = 'APPROVED'
    LIMIT 1;
  `);

  if (sampleSlot.rows.length > 0) {
    const slotId = sampleSlot.rows[0].id;
    const paymentAttempt = await initiateSlotPayment(slotId, "670000000");
    console.log("  Tentative de paiement alors que l'application est verrouillée :", paymentAttempt);

    if (!paymentAttempt.ok && (paymentAttempt as { status?: number }).status === 423) {
      console.log("  ✅ [PAIEMENT BLOQUÉ 100%] Le paiement a été rejeté avec HTTP 423 Locked !");
      console.log(`     Message d'erreur : "${paymentAttempt.error}"`);
    } else {
      console.error("  ❌ Le paiement n'a pas été rejeté correctement pendant le verrouillage :", paymentAttempt);
      allPassed = false;
    }
  }

  console.log("\n--- POINT 4.3 : DÉVERROUILLAGE DE L'APPLICATION ---");
  const unlockResult = await setAppLocked({
    isLocked: false,
    adminEmail: "divaasso17@gmail.com",
    reason: "Fin du test de blindage",
  });
  console.log("  Résultat setAppLocked(false) :", unlockResult);

  const isLockedAfter = await isAppLocked();
  console.log(`  isAppLocked() après déverrouillage = ${isLockedAfter}`);

  if (!isLockedAfter) {
    console.log("  ✅ [DÉVERROUILLAGE RÉUSSI] La plateforme est revenue à l'état déverrouillé.");
  } else {
    console.error("  ❌ L'application est toujours verrouillée.");
    allPassed = false;
  }

  // Nettoyage des logs de test
  await pgClient.query(`DELETE FROM security_logs WHERE ip = $1;`, [testIp]);
  await pgClient.end();

  console.log("\n=================================================");
  if (allPassed) {
    console.log("🎉 TOUS LES TESTS DES POINTS 3 & 4 ONT RÉUSSI À 100% !");
  } else {
    console.error("❌ CERTAINS TESTS ONT ÉCHOUÉ.");
  }
  console.log("=================================================");
}

runTests().catch(console.error);
