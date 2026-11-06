/**
 * Synchronise tous les comptes `public.users` existants vers `auth.users` (Supabase Auth)
 * sans déconnecter ni modifier les sessions NextAuth ou mots de passe existants :
 *  - Lie les 24 membres Email+Mot de passe déjà présents dans `auth.users` (`authUserId` + `app_metadata`)
 *  - Pré-provisionne les 20 membres Google OAuth dans `auth.users` (`email_confirm: true` + `app_metadata`)
 *    pour que la connexion Google via Supabase Auth rattache automatiquement leur compte existant.
 *
 * Usage :
 *   node --env-file=.env scripts/sync-supabase-auth-users.mjs
 */

import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DB_URL = process.env.DIRECT_URL || process.env.DATABASE_URL;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !DB_URL) {
  console.error("Variables NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / DIRECT_URL manquantes.");
  process.exit(1);
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function fetchAllAuthUsers() {
  const all = [];
  let page = 1;
  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const batch = data?.users ?? [];
    all.push(...batch);
    if (batch.length < 200) break;
    page++;
  }
  return all;
}

const db = new pg.Client({
  connectionString: DB_URL,
  ssl: { rejectUnauthorized: false },
});
await db.connect();

const { rows: publicUsers } = await db.query(`
  SELECT id, "authUserId", email, "emailVerified", name, avatar, image, role, "isBanned"
  FROM public.users
  ORDER BY "createdAt" ASC;
`);

const authUsers = await fetchAllAuthUsers();
const authByEmail = new Map();
for (const au of authUsers) {
  if (au.email) {
    authByEmail.set(au.email.toLowerCase(), au);
  }
}

let linkedExisting = 0;
let createdNewAuth = 0;

for (const u of publicUsers) {
  const emailLower = u.email.trim().toLowerCase();
  const appMeta = {
    app_user_id: u.id,
    role: u.role,
    is_banned: Boolean(u.isBanned),
  };

  let authUser = authByEmail.get(emailLower);

  if (!authUser) {
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: emailLower,
      email_confirm: true,
      user_metadata: {
        full_name: u.name,
        ...(u.image || u.avatar ? { avatar_url: u.image || u.avatar } : {}),
      },
      app_metadata: appMeta,
    });
    if (createErr) {
      throw new Error(`Échec création auth.users pour ${emailLower}: ${createErr.message}`);
    }
    authUser = created.user;
    authByEmail.set(emailLower, authUser);
    createdNewAuth++;
  } else {
    const currentAppMeta = authUser.app_metadata ?? {};
    const needsMetaUpdate =
      currentAppMeta.app_user_id !== u.id ||
      currentAppMeta.role !== u.role ||
      Boolean(currentAppMeta.is_banned) !== Boolean(u.isBanned);

    if (needsMetaUpdate) {
      const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
        app_metadata: { ...currentAppMeta, ...appMeta },
      });
      if (updErr) {
        throw new Error(`Échec mise à jour app_metadata pour ${emailLower}: ${updErr.message}`);
      }
    }
    linkedExisting++;
  }

  if (u.authUserId !== authUser.id) {
    await db.query(
      `UPDATE public.users SET "authUserId" = $1, "emailVerified" = COALESCE("emailVerified", now()) WHERE id = $2`,
      [authUser.id, u.id],
    );
  }
}

const { rows: summary } = await db.query(`
  SELECT
    count(*)::int AS total_public_users,
    count("authUserId")::int AS linked_with_auth_uuid,
    count(*) FILTER (WHERE "authUserId" IS NULL)::int AS unlinked
  FROM public.users;
`);

console.log({
  linkedExisting,
  createdNewAuth,
  ...summary[0],
});

await db.end();

