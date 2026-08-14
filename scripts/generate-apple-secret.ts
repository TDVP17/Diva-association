/**
 * Generates the ES256 JWT that Apple requires as `AUTH_APPLE_SECRET`.
 * Apple caps the token lifetime at 6 months, so re-run this and update
 * the env var whenever it's about to expire.
 *
 * Usage:
 *   APPLE_TEAM_ID=... APPLE_KEY_ID=... APPLE_CLIENT_ID=... APPLE_PRIVATE_KEY_PATH=./AuthKey_XXXX.p8 \
 *     npx tsx scripts/generate-apple-secret.ts
 */
import { readFileSync } from "node:fs";
import { SignJWT, importPKCS8 } from "jose";

async function main() {
  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_KEY_ID;
  const clientId = process.env.APPLE_CLIENT_ID;
  const privateKeyPath = process.env.APPLE_PRIVATE_KEY_PATH;

  if (!teamId || !keyId || !clientId || !privateKeyPath) {
    console.error(
      "Missing required env vars: APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_CLIENT_ID, APPLE_PRIVATE_KEY_PATH",
    );
    process.exitCode = 1;
    return;
  }

  const pkcs8 = readFileSync(privateKeyPath, "utf8");
  const privateKey = await importPKCS8(pkcs8, "ES256");

  const sixMonthsInSeconds = 60 * 60 * 24 * 180;
  const now = Math.floor(Date.now() / 1000);

  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt(now)
    .setExpirationTime(now + sixMonthsInSeconds)
    .setAudience("https://appleid.apple.com")
    .setSubject(clientId)
    .sign(privateKey);

  console.log("\nAUTH_APPLE_SECRET=" + jwt + "\n");
  console.log("Expires:", new Date((now + sixMonthsInSeconds) * 1000).toISOString());
}

main();
