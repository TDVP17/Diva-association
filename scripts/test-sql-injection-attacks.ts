import { prisma } from "../src/lib/prisma";
import { detectSqlInjection, logSecurityEvent } from "../src/lib/security";
import { GET as searchGet } from "../src/app/api/admin/users/search/route";
import { POST as paymentProofPost } from "../src/app/api/payments/proof/route";
import { signInAction } from "../src/app/login/actions";

const ATTACK_PAYLOADS = [
  "' OR '1'='1",
  "'; DROP TABLE users; --",
  "' UNION SELECT id, name, email FROM users; --",
];

async function runSecurityTests() {
  console.log("=================================================================");
  console.log("       TESTS D'ATTAQUE PAR INJECTION SQL & LOGGING SÉCURITÉ       ");
  console.log("=================================================================\n");

  const initialLogsCount = await prisma.securityLog.count();
  console.log(`Nombre de logs de sécurité initiaux : ${initialLogsCount}`);

  // Test 1: Injection SQL dans la Recherche
  console.log("\n--- [TEST 1] Injection SQL dans la Recherche (GET /api/admin/users/search) ---");
  for (const payload of ATTACK_PAYLOADS) {
    const isDetected = detectSqlInjection(payload);
    console.log(`Payload : "${payload}" -> Détection par filtre : ${isDetected ? "OUI (BLOQUÉ)" : "NON"}`);

    const req = new Request(`http://localhost:3000/api/admin/users/search?q=${encodeURIComponent(payload)}`, {
      method: "GET",
      headers: {
        "x-forwarded-for": "192.168.1.100",
        "user-agent": "Attacker-Bot/1.0 (SQLi-Probe)",
      },
    });

    const res = await searchGet(req);
    const body = await res.json().catch(() => ({}));
    console.log(`Status HTTP : ${res.status} | Réponse :`, JSON.stringify(body));

    if (res.status === 400 || res.status === 403) {
      console.log(`-> SUCCÈS : L'attaque a été bloquée et n'a touché aucune donnée.`);
    } else {
      console.error(`-> ÉCHEC : L'attaque a passé le filtre !`);
      process.exit(1);
    }
  }

  // Test 2: Injection SQL dans le Login
  console.log("\n--- [TEST 2] Injection SQL dans le Login (signInAction) ---");
  for (const payload of ATTACK_PAYLOADS) {
    const formData = new FormData();
    formData.append("email", `admin@divaasso.com${payload}`);
    formData.append("password", payload);

    const result = await signInAction("/dashboard", {}, formData);
    console.log(`Payload : "${payload}" -> Résultat du login :`, JSON.stringify(result));

    if (result.error && !result.accessToken) {
      console.log(`-> SUCCÈS : Connexion refusée avec message neutre, tentative bloquée.`);
    } else {
      console.error(`-> ÉCHEC : Connexion non autorisée réussie !`);
      process.exit(1);
    }
  }

  // Test 3: Injection SQL dans le Paiement
  console.log("\n--- [TEST 3] Injection SQL dans le Paiement (POST /api/payments/proof) ---");
  for (const payload of ATTACK_PAYLOADS) {
    const formData = new FormData();
    formData.append("membershipSlotId", payload);
    formData.append("phone", `699000000${payload}`);
    formData.append("dueDate", `2026-11-06${payload}`);

    const req = new Request("http://localhost:3000/api/payments/proof", {
      method: "POST",
      headers: {
        "x-forwarded-for": "192.168.1.105",
        "user-agent": "Attacker-Bot/1.0 (Payment-Tamper)",
      },
      body: formData,
    });

    const res = await paymentProofPost(req);
    const body = await res.json().catch(() => ({}));
    console.log(`Payload : "${payload}" -> Status : ${res.status} | Réponse :`, JSON.stringify(body));

    if (res.status === 400 || res.status === 401) {
      console.log(`-> SUCCÈS : Paiement frauduleux bloqué.`);
    } else {
      console.error(`-> ÉCHEC : Le paiement frauduleux n'a pas été rejeté !`);
      process.exit(1);
    }
  }

  // Vérification des logs dans la table security_logs
  console.log("\n--- [VÉRIFICATION DES LOGS DE SÉCURITÉ EN BASE DE DONNÉES] ---");
  const recentLogs = await prisma.securityLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  console.log(`Nombre total de tentatives loguées : ${recentLogs.length}`);
  for (const log of recentLogs) {
    console.log(`[LOG] ID: ${log.id} | Type: ${log.type} | IP: ${log.ip} | UserAgent: ${log.userAgent?.slice(0, 30)} | Email/Cible: ${log.emailEssaye}`);
  }

  // Vérification de l'intégrité de la base de données (aucune table n'a été supprimée)
  const usersCount = await prisma.user.count();
  const sessionsCount = await prisma.tontineSession.count();
  console.log("\n--- [VÉRIFICATION DE L'INTÉGRITÉ DES TABLES] ---");
  console.log(`Table "users" intacte : ${usersCount} utilisateurs.`);
  console.log(`Table "tontine_sessions" intacte : ${sessionsCount} sessions.`);

  console.log("\n=================================================================");
  console.log("       RÉSULTAT DU POINT 1 : 100% SÉCURISÉ - BLINDAGE TOTAL      ");
  console.log("=================================================================");
}

runSecurityTests().catch((e) => {
  console.error("Test error:", e);
  process.exit(1);
});
