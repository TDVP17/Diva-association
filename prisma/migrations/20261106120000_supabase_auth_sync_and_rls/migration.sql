-- ============================================================================
-- Étape 3a : Synchronisation Supabase Auth (auth.users <-> public.users)
--            + Row Level Security (RLS) & Moindre Privilège sur les 27 tables
-- ============================================================================

-- 1. Colonne de liaison authUserId (UUID de auth.users) + Index de performance RLS
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS "authUserId" UUID;

CREATE UNIQUE INDEX IF NOT EXISTS "users_authUserId_key"
  ON public.users ("authUserId");

CREATE INDEX IF NOT EXISTS users_lower_email_idx
  ON public.users (lower(email));

CREATE INDEX IF NOT EXISTS memberships_session_status_idx
  ON public.memberships ("tontineSessionId", status);

CREATE INDEX IF NOT EXISTS membership_slots_membership_id_idx
  ON public.membership_slots ("membershipId");

CREATE INDEX IF NOT EXISTS contributions_paid_by_user_id_idx
  ON public.contributions ("paidByUserId")
  WHERE "paidByUserId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS chat_messages_sender_id_idx
  ON public.chat_messages ("senderId");

CREATE INDEX IF NOT EXISTS position_swap_requests_requester_id_idx
  ON public.position_swap_requests ("requesterId");

CREATE INDEX IF NOT EXISTS position_swap_requests_target_id_idx
  ON public.position_swap_requests ("targetId");

CREATE INDEX IF NOT EXISTS payouts_membership_slot_id_idx
  ON public.payouts ("membershipSlotId");

-- Backfill immédiat de authUserId pour tous les comptes existants ayant déjà le même email dans auth.users
UPDATE public.users pu
SET
  "authUserId" = au.id,
  "emailVerified" = COALESCE(pu."emailVerified", au.email_confirmed_at)
FROM auth.users au
WHERE pu."authUserId" IS NULL
  AND lower(pu.email) = lower(au.email);

-- ============================================================================
-- 2. Schéma privé `private` (non exposé à PostgREST / Data API)
--    Contient les fonctions d'identité appelées une seule fois par requête via (SELECT ...)
-- ============================================================================
CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role, postgres;

-- Retourne l'identifiant CUID `public.users.id` du membre authentifié (ou NULL s'il est banni / inconnu)
CREATE OR REPLACE FUNCTION private.current_app_user_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.id
  FROM public.users u
  WHERE u."isBanned" = false
    AND (
      u."authUserId" = (SELECT auth.uid())
      OR (
        u."authUserId" IS NULL
        AND lower(u.email) = lower(COALESCE((SELECT auth.jwt() ->> 'email'), ''))
      )
    )
  LIMIT 1;
$$;

-- Retourne le rôle applicatif (`MEMBER`, `ADMIN`, `PRESIDENT`) du membre authentifié non banni
CREATE OR REPLACE FUNCTION private.current_app_user_role()
RETURNS public."Role"
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.role
  FROM public.users u
  WHERE u."isBanned" = false
    AND (
      u."authUserId" = (SELECT auth.uid())
      OR (
        u."authUserId" IS NULL
        AND lower(u.email) = lower(COALESCE((SELECT auth.jwt() ->> 'email'), ''))
      )
    )
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION private.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(private.current_app_user_role() IN ('ADMIN', 'PRESIDENT'), false);
$$;

CREATE OR REPLACE FUNCTION private.is_president()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(private.current_app_user_role() = 'PRESIDENT', false);
$$;

REVOKE ALL ON FUNCTION private.current_app_user_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.current_app_user_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_president() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION private.current_app_user_id() TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION private.current_app_user_role() TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION private.is_admin() TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION private.is_president() TO authenticated, service_role, postgres;

-- ============================================================================
-- 3. Triggers de synchronisation bidirectionnelle auth.users <-> public.users
--    + Protection des colonnes sensibles de public.users
-- ============================================================================

-- 3a. Trigger auth.users -> public.users (lie un membre existant par email ou crée un nouveau profil)
CREATE OR REPLACE FUNCTION private.handle_auth_user_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_existing_id text;
  v_new_id text;
  v_max_seq integer;
  v_member_code text;
  v_display_name text;
  v_avatar_url text;
BEGIN
  IF NEW.email IS NULL OR btrim(NEW.email) = '' THEN
    RETURN NEW;
  END IF;

  v_avatar_url := COALESCE(
    NULLIF(btrim(NEW.raw_user_meta_data ->> 'avatar_url'), ''),
    NULLIF(btrim(NEW.raw_user_meta_data ->> 'picture'), '')
  );

  SELECT u.id INTO v_existing_id
  FROM public.users u
  WHERE u."authUserId" = NEW.id
     OR lower(u.email) = lower(btrim(NEW.email))
  ORDER BY (u."authUserId" = NEW.id) DESC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.users
    SET
      "authUserId" = NEW.id,
      "emailVerified" = COALESCE("emailVerified", NEW.email_confirmed_at),
      image = COALESCE(image, v_avatar_url)
    WHERE id = v_existing_id
      AND (
        "authUserId" IS DISTINCT FROM NEW.id
        OR ("emailVerified" IS NULL AND NEW.email_confirmed_at IS NOT NULL)
        OR (image IS NULL AND v_avatar_url IS NOT NULL)
      );
  ELSE
    v_new_id := 'c' || substr(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 24);

    SELECT COALESCE(MAX((substring(u."memberCode" FROM '^DIVA([0-9]+)$'))::integer), 0)
      INTO v_max_seq
    FROM public.users u
    WHERE u."memberCode" ~ '^DIVA[0-9]+$';

    v_member_code := 'DIVA' || lpad((v_max_seq + 1)::text, 4, '0');

    v_display_name := COALESCE(
      NULLIF(btrim(NEW.raw_user_meta_data ->> 'full_name'), ''),
      NULLIF(btrim(NEW.raw_user_meta_data ->> 'name'), ''),
      split_part(btrim(NEW.email), '@', 1)
    );

    INSERT INTO public.users (
      id,
      "authUserId",
      email,
      "emailVerified",
      name,
      image,
      role,
      "memberCode",
      "isBanned",
      "createdAt"
    ) VALUES (
      v_new_id,
      NEW.id,
      lower(btrim(NEW.email)),
      NEW.email_confirmed_at,
      v_display_name,
      v_avatar_url,
      'MEMBER',
      v_member_code,
      false,
      now()
    )
    ON CONFLICT (email) DO UPDATE
    SET
      "authUserId" = EXCLUDED."authUserId",
      "emailVerified" = COALESCE(public.users."emailVerified", EXCLUDED."emailVerified");
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_or_updated ON auth.users;
CREATE TRIGGER on_auth_user_created_or_updated
  AFTER INSERT OR UPDATE OF email, email_confirmed_at, raw_user_meta_data
  ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION private.handle_auth_user_sync();

-- 3b. Trigger public.users -> auth.users.raw_app_meta_data (métadonnées serveur sécurisées)
CREATE OR REPLACE FUNCTION private.handle_public_user_sync_to_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_patch jsonb;
BEGIN
  IF NEW."authUserId" IS NULL THEN
    RETURN NEW;
  END IF;

  v_patch := jsonb_build_object(
    'app_user_id', NEW.id,
    'role', NEW.role::text,
    'is_banned', NEW."isBanned"
  );

  UPDATE auth.users
  SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || v_patch
  WHERE id = NEW."authUserId"
    AND (
      COALESCE(raw_app_meta_data ->> 'app_user_id', '') IS DISTINCT FROM NEW.id
      OR COALESCE(raw_app_meta_data ->> 'role', '') IS DISTINCT FROM NEW.role::text
      OR COALESCE((raw_app_meta_data ->> 'is_banned')::boolean, false) IS DISTINCT FROM NEW."isBanned"
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_public_user_sync_to_auth ON public.users;
CREATE TRIGGER on_public_user_sync_to_auth
  AFTER INSERT OR UPDATE OF "authUserId", role, "isBanned"
  ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION private.handle_public_user_sync_to_auth();

-- 3c. Trigger de protection des colonnes sensibles de public.users contre toute escalade côté client
CREATE OR REPLACE FUNCTION private.protect_user_sensitive_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF current_user = 'authenticated' AND NOT private.is_admin() THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.role IS DISTINCT FROM OLD.role
       OR NEW."isBanned" IS DISTINCT FROM OLD."isBanned"
       OR NEW."bannedAt" IS DISTINCT FROM OLD."bannedAt"
       OR NEW."bannedReason" IS DISTINCT FROM OLD."bannedReason"
       OR NEW."memberCode" IS DISTINCT FROM OLD."memberCode"
       OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW."authUserId" IS DISTINCT FROM OLD."authUserId"
    THEN
      RAISE EXCEPTION 'Forbidden modification of protected user columns'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_protect_sensitive_columns ON public.users;
CREATE TRIGGER users_protect_sensitive_columns
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION private.protect_user_sensitive_columns();

-- ============================================================================
-- 4. Fonctions RPC sécurisées (sans exposition d'emails / téléphones / GPS)
-- ============================================================================

-- Recherche d'un membre par code DIVAxxxx pour "Contribuer pour un proche"
CREATE OR REPLACE FUNCTION public.lookup_member_by_code(p_code text)
RETURNS TABLE (
  user_id text,
  member_name text,
  member_code text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.id, u.name, u."memberCode"
  FROM public.users u
  WHERE (SELECT private.current_app_user_id()) IS NOT NULL
    AND u."isBanned" = false
    AND u."memberCode" IS NOT NULL
    AND upper(u."memberCode") = upper(btrim(COALESCE(p_code, '')))
  LIMIT 1;
$$;

-- Liste minimale des administrateurs du support client (sans email ni téléphone)
CREATE OR REPLACE FUNCTION public.list_support_admins()
RETURNS TABLE (
  id text,
  name text,
  avatar text,
  image text,
  role public."Role"
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.id, u.name, u.avatar, u.image, u.role
  FROM public.users u
  WHERE (SELECT private.current_app_user_id()) IS NOT NULL
    AND u."isBanned" = false
    AND u.role IN ('ADMIN', 'PRESIDENT')
  ORDER BY u."createdAt" ASC;
$$;

-- Noms d'affichage des membres approuvés d'une session (pour ordre de bouffe / échange de position)
CREATE OR REPLACE FUNCTION public.list_session_roster_names(p_session_id text)
RETURNS TABLE (
  user_id text,
  name text,
  avatar text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT DISTINCT u.id, u.name, COALESCE(u.avatar, u.image) AS avatar
  FROM public.memberships m
  JOIN public.users u ON u.id = m."userId"
  WHERE (SELECT private.current_app_user_id()) IS NOT NULL
    AND m."tontineSessionId" = p_session_id
    AND m.status = 'APPROVED';
$$;

REVOKE ALL ON FUNCTION public.lookup_member_by_code(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_support_admins() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_session_roster_names(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.lookup_member_by_code(text) TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.list_support_admins() TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.list_session_roster_names(text) TO authenticated, service_role, postgres;

-- ============================================================================
-- 5. Moindre privilège sur les tables publiques (REVOKE PUBLIC & anon)
-- ============================================================================
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated;

-- Tables strictement internes / serveur : aucun accès client direct (ni anon ni authenticated)
REVOKE ALL ON TABLE
  public._prisma_migrations,
  public.accounts,
  public.sessions,
  public.verification_tokens,
  public.otp_challenges,
  public.notification_logs,
  public.food_turn_logs,
  public.turn_reminder_logs
FROM authenticated;

-- Droits minimaux précis pour le rôle `authenticated` (filtrés par RLS ci-dessous)
GRANT SELECT ON TABLE
  public.audit_logs,
  public.transaction_archives,
  public.payment_attempts,
  public.bulk_payments
TO authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE
  public.association_rules,
  public.fallback_payment_configs,
  public.kyc_verifications,
  public.position_swap_requests,
  public.payouts
TO authenticated;

GRANT SELECT, UPDATE, DELETE ON TABLE
  public.users
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.saved_payment_methods,
  public.push_subscriptions,
  public.tontine_sessions,
  public.memberships,
  public.membership_slots,
  public.contributions,
  public.fines,
  public.chat_messages,
  public.notifications
TO authenticated;

-- ============================================================================
-- 6. Activation de RLS sur les 27 tables de `public`
-- ============================================================================
ALTER TABLE public._prisma_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.association_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bulk_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fallback_payment_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.food_turn_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otp_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.position_swap_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tontine_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_archives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.turn_reminder_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verification_tokens ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 7. Politiques RLS par table (TO authenticated, fonctions cachées via SELECT)
-- ============================================================================

-- ---- audit_logs (lecture seule ADMIN / PRESIDENT) ----
DROP POLICY IF EXISTS audit_logs_select_admin ON public.audit_logs;
CREATE POLICY audit_logs_select_admin ON public.audit_logs
  FOR SELECT TO authenticated
  USING ((SELECT private.is_admin()));

-- ---- association_rules ----
DROP POLICY IF EXISTS association_rules_select_auth ON public.association_rules;
CREATE POLICY association_rules_select_auth ON public.association_rules
  FOR SELECT TO authenticated
  USING ((SELECT private.current_app_user_id()) IS NOT NULL);

DROP POLICY IF EXISTS association_rules_insert_admin ON public.association_rules;
CREATE POLICY association_rules_insert_admin ON public.association_rules
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_admin()));

DROP POLICY IF EXISTS association_rules_update_admin ON public.association_rules;
CREATE POLICY association_rules_update_admin ON public.association_rules
  FOR UPDATE TO authenticated
  USING ((SELECT private.is_admin()))
  WITH CHECK ((SELECT private.is_admin()));

-- ---- fallback_payment_configs ----
DROP POLICY IF EXISTS fallback_payment_configs_select_auth ON public.fallback_payment_configs;
CREATE POLICY fallback_payment_configs_select_auth ON public.fallback_payment_configs
  FOR SELECT TO authenticated
  USING ((SELECT private.current_app_user_id()) IS NOT NULL);

DROP POLICY IF EXISTS fallback_payment_configs_insert_admin ON public.fallback_payment_configs;
CREATE POLICY fallback_payment_configs_insert_admin ON public.fallback_payment_configs
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_admin()));

DROP POLICY IF EXISTS fallback_payment_configs_update_admin ON public.fallback_payment_configs;
CREATE POLICY fallback_payment_configs_update_admin ON public.fallback_payment_configs
  FOR UPDATE TO authenticated
  USING ((SELECT private.is_admin()))
  WITH CHECK ((SELECT private.is_admin()));

-- ---- users ----
DROP POLICY IF EXISTS users_select_self_or_admin ON public.users;
CREATE POLICY users_select_self_or_admin ON public.users
  FOR SELECT TO authenticated
  USING (
    id = (SELECT private.current_app_user_id())
    OR (SELECT private.is_admin())
  );

DROP POLICY IF EXISTS users_update_self_or_admin ON public.users;
CREATE POLICY users_update_self_or_admin ON public.users
  FOR UPDATE TO authenticated
  USING (
    id = (SELECT private.current_app_user_id())
    OR (SELECT private.is_admin())
  )
  WITH CHECK (
    (SELECT private.is_admin())
    OR (
      id = (SELECT private.current_app_user_id())
      AND role = (SELECT private.current_app_user_role())
      AND "isBanned" = false
    )
  );

DROP POLICY IF EXISTS users_delete_admin ON public.users;
CREATE POLICY users_delete_admin ON public.users
  FOR DELETE TO authenticated
  USING ((SELECT private.is_admin()));

-- ---- saved_payment_methods ----
DROP POLICY IF EXISTS saved_payment_methods_select_own ON public.saved_payment_methods;
CREATE POLICY saved_payment_methods_select_own ON public.saved_payment_methods
  FOR SELECT TO authenticated
  USING ("userId" = (SELECT private.current_app_user_id()));

DROP POLICY IF EXISTS saved_payment_methods_insert_own ON public.saved_payment_methods;
CREATE POLICY saved_payment_methods_insert_own ON public.saved_payment_methods
  FOR INSERT TO authenticated
  WITH CHECK ("userId" = (SELECT private.current_app_user_id()));

DROP POLICY IF EXISTS saved_payment_methods_update_own ON public.saved_payment_methods;
CREATE POLICY saved_payment_methods_update_own ON public.saved_payment_methods
  FOR UPDATE TO authenticated
  USING ("userId" = (SELECT private.current_app_user_id()))
  WITH CHECK ("userId" = (SELECT private.current_app_user_id()));

DROP POLICY IF EXISTS saved_payment_methods_delete_own ON public.saved_payment_methods;
CREATE POLICY saved_payment_methods_delete_own ON public.saved_payment_methods
  FOR DELETE TO authenticated
  USING ("userId" = (SELECT private.current_app_user_id()));

-- ---- push_subscriptions ----
DROP POLICY IF EXISTS push_subscriptions_select_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_select_own ON public.push_subscriptions
  FOR SELECT TO authenticated
  USING ("userId" = (SELECT private.current_app_user_id()));

DROP POLICY IF EXISTS push_subscriptions_insert_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_insert_own ON public.push_subscriptions
  FOR INSERT TO authenticated
  WITH CHECK ("userId" = (SELECT private.current_app_user_id()));

DROP POLICY IF EXISTS push_subscriptions_update_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_update_own ON public.push_subscriptions
  FOR UPDATE TO authenticated
  USING ("userId" = (SELECT private.current_app_user_id()))
  WITH CHECK ("userId" = (SELECT private.current_app_user_id()));

DROP POLICY IF EXISTS push_subscriptions_delete_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_delete_own ON public.push_subscriptions
  FOR DELETE TO authenticated
  USING ("userId" = (SELECT private.current_app_user_id()));

-- ---- transaction_archives ----
DROP POLICY IF EXISTS transaction_archives_select_own_or_admin ON public.transaction_archives;
CREATE POLICY transaction_archives_select_own_or_admin ON public.transaction_archives
  FOR SELECT TO authenticated
  USING (
    "userId" = (SELECT private.current_app_user_id())
    OR (SELECT private.is_admin())
  );

-- ---- tontine_sessions ----
DROP POLICY IF EXISTS tontine_sessions_select_auth ON public.tontine_sessions;
CREATE POLICY tontine_sessions_select_auth ON public.tontine_sessions
  FOR SELECT TO authenticated
  USING ((SELECT private.current_app_user_id()) IS NOT NULL);

DROP POLICY IF EXISTS tontine_sessions_insert_admin ON public.tontine_sessions;
CREATE POLICY tontine_sessions_insert_admin ON public.tontine_sessions
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_admin()));

DROP POLICY IF EXISTS tontine_sessions_update_admin ON public.tontine_sessions;
CREATE POLICY tontine_sessions_update_admin ON public.tontine_sessions
  FOR UPDATE TO authenticated
  USING ((SELECT private.is_admin()))
  WITH CHECK ((SELECT private.is_admin()));

DROP POLICY IF EXISTS tontine_sessions_delete_admin ON public.tontine_sessions;
CREATE POLICY tontine_sessions_delete_admin ON public.tontine_sessions
  FOR DELETE TO authenticated
  USING ((SELECT private.is_admin()));

-- ---- memberships ----
DROP POLICY IF EXISTS memberships_select_visible ON public.memberships;
CREATE POLICY memberships_select_visible ON public.memberships
  FOR SELECT TO authenticated
  USING (
    (SELECT private.current_app_user_id()) IS NOT NULL
    AND (
      "userId" = (SELECT private.current_app_user_id())
      OR status = 'APPROVED'
      OR (SELECT private.is_admin())
    )
  );

DROP POLICY IF EXISTS memberships_insert_self_or_admin ON public.memberships;
CREATE POLICY memberships_insert_self_or_admin ON public.memberships
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT private.is_admin())
    OR (
      "userId" = (SELECT private.current_app_user_id())
      AND status = 'PENDING'
    )
  );

DROP POLICY IF EXISTS memberships_update_self_or_admin ON public.memberships;
CREATE POLICY memberships_update_self_or_admin ON public.memberships
  FOR UPDATE TO authenticated
  USING (
    "userId" = (SELECT private.current_app_user_id())
    OR (SELECT private.is_admin())
  )
  WITH CHECK (
    (SELECT private.is_admin())
    OR "userId" = (SELECT private.current_app_user_id())
  );

DROP POLICY IF EXISTS memberships_delete_admin ON public.memberships;
CREATE POLICY memberships_delete_admin ON public.memberships
  FOR DELETE TO authenticated
  USING ((SELECT private.is_admin()));

-- ---- membership_slots ----
DROP POLICY IF EXISTS membership_slots_select_visible ON public.membership_slots;
CREATE POLICY membership_slots_select_visible ON public.membership_slots
  FOR SELECT TO authenticated
  USING (
    (SELECT private.current_app_user_id()) IS NOT NULL
    AND (
      (SELECT private.is_admin())
      OR EXISTS (
        SELECT 1
        FROM public.memberships m
        WHERE m.id = membership_slots."membershipId"
          AND (
            m."userId" = (SELECT private.current_app_user_id())
            OR m.status = 'APPROVED'
          )
      )
    )
  );

DROP POLICY IF EXISTS membership_slots_insert_own_or_admin ON public.membership_slots;
CREATE POLICY membership_slots_insert_own_or_admin ON public.membership_slots
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT private.is_admin())
    OR EXISTS (
      SELECT 1
      FROM public.memberships m
      WHERE m.id = membership_slots."membershipId"
        AND m."userId" = (SELECT private.current_app_user_id())
        AND m.status = 'APPROVED'
        AND membership_slots."officialPosition" IS NULL
        AND membership_slots."ballDrawn" IS NULL
    )
  );

DROP POLICY IF EXISTS membership_slots_update_own_or_admin ON public.membership_slots;
CREATE POLICY membership_slots_update_own_or_admin ON public.membership_slots
  FOR UPDATE TO authenticated
  USING (
    (SELECT private.is_admin())
    OR EXISTS (
      SELECT 1
      FROM public.memberships m
      WHERE m.id = membership_slots."membershipId"
        AND m."userId" = (SELECT private.current_app_user_id())
    )
  )
  WITH CHECK (
    (SELECT private.is_admin())
    OR EXISTS (
      SELECT 1
      FROM public.memberships m
      WHERE m.id = membership_slots."membershipId"
        AND m."userId" = (SELECT private.current_app_user_id())
    )
  );

DROP POLICY IF EXISTS membership_slots_delete_admin ON public.membership_slots;
CREATE POLICY membership_slots_delete_admin ON public.membership_slots
  FOR DELETE TO authenticated
  USING ((SELECT private.is_admin()));

-- ---- position_swap_requests ----
DROP POLICY IF EXISTS position_swap_requests_select_participant_or_admin ON public.position_swap_requests;
CREATE POLICY position_swap_requests_select_participant_or_admin ON public.position_swap_requests
  FOR SELECT TO authenticated
  USING (
    "requesterId" = (SELECT private.current_app_user_id())
    OR "targetId" = (SELECT private.current_app_user_id())
    OR (SELECT private.is_admin())
  );

DROP POLICY IF EXISTS position_swap_requests_insert_requester ON public.position_swap_requests;
CREATE POLICY position_swap_requests_insert_requester ON public.position_swap_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    "requesterId" = (SELECT private.current_app_user_id())
    AND status = 'PENDING_MEMBERSHIP'
  );

DROP POLICY IF EXISTS position_swap_requests_update_target_or_admin ON public.position_swap_requests;
CREATE POLICY position_swap_requests_update_target_or_admin ON public.position_swap_requests
  FOR UPDATE TO authenticated
  USING (
    "targetId" = (SELECT private.current_app_user_id())
    OR (SELECT private.is_admin())
  )
  WITH CHECK (
    (SELECT private.is_admin())
    OR (
      "targetId" = (SELECT private.current_app_user_id())
      AND status IN ('PENDING_ADMIN', 'REJECTED')
    )
  );

-- ---- kyc_verifications ----
DROP POLICY IF EXISTS kyc_verifications_select_own_or_admin ON public.kyc_verifications;
CREATE POLICY kyc_verifications_select_own_or_admin ON public.kyc_verifications
  FOR SELECT TO authenticated
  USING (
    "userId" = (SELECT private.current_app_user_id())
    OR (SELECT private.is_admin())
  );

DROP POLICY IF EXISTS kyc_verifications_insert_own ON public.kyc_verifications;
CREATE POLICY kyc_verifications_insert_own ON public.kyc_verifications
  FOR INSERT TO authenticated
  WITH CHECK (
    "userId" = (SELECT private.current_app_user_id())
    AND status = 'PENDING'
  );

DROP POLICY IF EXISTS kyc_verifications_update_own_or_admin ON public.kyc_verifications;
CREATE POLICY kyc_verifications_update_own_or_admin ON public.kyc_verifications
  FOR UPDATE TO authenticated
  USING (
    "userId" = (SELECT private.current_app_user_id())
    OR (SELECT private.is_admin())
  )
  WITH CHECK (
    (SELECT private.is_admin())
    OR (
      "userId" = (SELECT private.current_app_user_id())
      AND status = 'PENDING'
    )
  );

-- ---- contributions ----
DROP POLICY IF EXISTS contributions_select_own_payer_or_admin ON public.contributions;
CREATE POLICY contributions_select_own_payer_or_admin ON public.contributions
  FOR SELECT TO authenticated
  USING (
    (SELECT private.is_admin())
    OR "paidByUserId" = (SELECT private.current_app_user_id())
    OR EXISTS (
      SELECT 1
      FROM public.membership_slots ms
      JOIN public.memberships m ON m.id = ms."membershipId"
      WHERE ms.id = contributions."membershipSlotId"
        AND m."userId" = (SELECT private.current_app_user_id())
    )
  );

DROP POLICY IF EXISTS contributions_insert_admin ON public.contributions;
CREATE POLICY contributions_insert_admin ON public.contributions
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_admin()));

DROP POLICY IF EXISTS contributions_update_admin ON public.contributions;
CREATE POLICY contributions_update_admin ON public.contributions
  FOR UPDATE TO authenticated
  USING ((SELECT private.is_admin()))
  WITH CHECK ((SELECT private.is_admin()));

DROP POLICY IF EXISTS contributions_delete_admin ON public.contributions;
CREATE POLICY contributions_delete_admin ON public.contributions
  FOR DELETE TO authenticated
  USING ((SELECT private.is_admin()));

-- ---- fines ----
DROP POLICY IF EXISTS fines_select_own_or_admin ON public.fines;
CREATE POLICY fines_select_own_or_admin ON public.fines
  FOR SELECT TO authenticated
  USING (
    (SELECT private.is_admin())
    OR EXISTS (
      SELECT 1
      FROM public.membership_slots ms
      JOIN public.memberships m ON m.id = ms."membershipId"
      WHERE ms.id = fines."membershipSlotId"
        AND m."userId" = (SELECT private.current_app_user_id())
    )
  );

DROP POLICY IF EXISTS fines_insert_admin ON public.fines;
CREATE POLICY fines_insert_admin ON public.fines
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_admin()));

DROP POLICY IF EXISTS fines_update_admin ON public.fines;
CREATE POLICY fines_update_admin ON public.fines
  FOR UPDATE TO authenticated
  USING ((SELECT private.is_admin()))
  WITH CHECK ((SELECT private.is_admin()));

DROP POLICY IF EXISTS fines_delete_admin ON public.fines;
CREATE POLICY fines_delete_admin ON public.fines
  FOR DELETE TO authenticated
  USING ((SELECT private.is_admin()));

-- ---- bulk_payments ----
DROP POLICY IF EXISTS bulk_payments_select_own_or_admin ON public.bulk_payments;
CREATE POLICY bulk_payments_select_own_or_admin ON public.bulk_payments
  FOR SELECT TO authenticated
  USING (
    "userId" = (SELECT private.current_app_user_id())
    OR (SELECT private.is_admin())
  );

-- ---- payment_attempts ----
DROP POLICY IF EXISTS payment_attempts_select_own_or_admin ON public.payment_attempts;
CREATE POLICY payment_attempts_select_own_or_admin ON public.payment_attempts
  FOR SELECT TO authenticated
  USING (
    (SELECT private.is_admin())
    OR (
      "bulkPaymentId" IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.bulk_payments bp
        WHERE bp.id = payment_attempts."bulkPaymentId"
          AND bp."userId" = (SELECT private.current_app_user_id())
      )
    )
    OR (
      "contributionId" IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.contributions c
        LEFT JOIN public.membership_slots ms ON ms.id = c."membershipSlotId"
        LEFT JOIN public.memberships m ON m.id = ms."membershipId"
        WHERE c.id = payment_attempts."contributionId"
          AND (
            c."paidByUserId" = (SELECT private.current_app_user_id())
            OR m."userId" = (SELECT private.current_app_user_id())
          )
      )
    )
    OR (
      "fineId" IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.fines f
        JOIN public.membership_slots ms ON ms.id = f."membershipSlotId"
        JOIN public.memberships m ON m.id = ms."membershipId"
        WHERE f.id = payment_attempts."fineId"
          AND m."userId" = (SELECT private.current_app_user_id())
      )
    )
  );

-- ---- payouts ----
DROP POLICY IF EXISTS payouts_select_own_or_admin ON public.payouts;
CREATE POLICY payouts_select_own_or_admin ON public.payouts
  FOR SELECT TO authenticated
  USING (
    (SELECT private.is_admin())
    OR EXISTS (
      SELECT 1
      FROM public.membership_slots ms
      JOIN public.memberships m ON m.id = ms."membershipId"
      WHERE ms.id = payouts."membershipSlotId"
        AND m."userId" = (SELECT private.current_app_user_id())
    )
  );

DROP POLICY IF EXISTS payouts_insert_own_or_admin ON public.payouts;
CREATE POLICY payouts_insert_own_or_admin ON public.payouts
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT private.is_admin())
    OR (
      status = 'DETAILS_SUBMITTED'
      AND EXISTS (
        SELECT 1
        FROM public.membership_slots ms
        JOIN public.memberships m ON m.id = ms."membershipId"
        WHERE ms.id = payouts."membershipSlotId"
          AND m."userId" = (SELECT private.current_app_user_id())
      )
    )
  );

DROP POLICY IF EXISTS payouts_update_own_or_admin ON public.payouts;
CREATE POLICY payouts_update_own_or_admin ON public.payouts
  FOR UPDATE TO authenticated
  USING (
    (SELECT private.is_admin())
    OR EXISTS (
      SELECT 1
      FROM public.membership_slots ms
      JOIN public.memberships m ON m.id = ms."membershipId"
      WHERE ms.id = payouts."membershipSlotId"
        AND m."userId" = (SELECT private.current_app_user_id())
    )
  )
  WITH CHECK (
    (SELECT private.is_admin())
    OR EXISTS (
      SELECT 1
      FROM public.membership_slots ms
      JOIN public.memberships m ON m.id = ms."membershipId"
      WHERE ms.id = payouts."membershipSlotId"
        AND m."userId" = (SELECT private.current_app_user_id())
    )
  );

-- ---- chat_messages ----
DROP POLICY IF EXISTS chat_messages_select_participant_or_admin ON public.chat_messages;
CREATE POLICY chat_messages_select_participant_or_admin ON public.chat_messages
  FOR SELECT TO authenticated
  USING (
    "senderId" = (SELECT private.current_app_user_id())
    OR "receiverId" = (SELECT private.current_app_user_id())
    OR (SELECT private.is_admin())
  );

DROP POLICY IF EXISTS chat_messages_insert_sender ON public.chat_messages;
CREATE POLICY chat_messages_insert_sender ON public.chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    "senderId" = (SELECT private.current_app_user_id())
    AND (
      (SELECT private.is_admin())
      OR EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.id = chat_messages."receiverId"
          AND u.role IN ('ADMIN', 'PRESIDENT')
      )
    )
  );

DROP POLICY IF EXISTS chat_messages_update_receiver_or_admin ON public.chat_messages;
CREATE POLICY chat_messages_update_receiver_or_admin ON public.chat_messages
  FOR UPDATE TO authenticated
  USING (
    "receiverId" = (SELECT private.current_app_user_id())
    OR (SELECT private.is_admin())
  )
  WITH CHECK (
    "receiverId" = (SELECT private.current_app_user_id())
    OR (SELECT private.is_admin())
  );

DROP POLICY IF EXISTS chat_messages_delete_sender_or_admin ON public.chat_messages;
CREATE POLICY chat_messages_delete_sender_or_admin ON public.chat_messages
  FOR DELETE TO authenticated
  USING (
    "senderId" = (SELECT private.current_app_user_id())
    OR (SELECT private.is_admin())
  );

-- ---- notifications ----
DROP POLICY IF EXISTS notifications_select_own_or_admin ON public.notifications;
CREATE POLICY notifications_select_own_or_admin ON public.notifications
  FOR SELECT TO authenticated
  USING (
    "userId" = (SELECT private.current_app_user_id())
    OR (SELECT private.is_admin())
  );

DROP POLICY IF EXISTS notifications_insert_admin ON public.notifications;
CREATE POLICY notifications_insert_admin ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_admin()));

DROP POLICY IF EXISTS notifications_update_own_or_admin ON public.notifications;
CREATE POLICY notifications_update_own_or_admin ON public.notifications
  FOR UPDATE TO authenticated
  USING (
    "userId" = (SELECT private.current_app_user_id())
    OR (SELECT private.is_admin())
  )
  WITH CHECK (
    "userId" = (SELECT private.current_app_user_id())
    OR (SELECT private.is_admin())
  );

DROP POLICY IF EXISTS notifications_delete_own_or_admin ON public.notifications;
CREATE POLICY notifications_delete_own_or_admin ON public.notifications
  FOR DELETE TO authenticated
  USING (
    "userId" = (SELECT private.current_app_user_id())
    OR (SELECT private.is_admin())
  );

