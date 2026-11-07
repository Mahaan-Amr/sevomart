-- Run as a trusted database administrator. This creates no login and must be
-- followed by a separate, owner-only credential provisioning process.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sevo_superadmin_recovery') THEN
    CREATE ROLE sevo_superadmin_recovery NOLOGIN;
  END IF;
END;
$$;
GRANT USAGE ON SCHEMA public TO sevo_superadmin_recovery;
REVOKE ALL ON public.identity_identities, public.identity_platform_superadmins,
  public.identity_platform_superadmin_audit,
  public.identity_platform_superadmin_recovery_idempotency FROM sevo_superadmin_recovery;
REVOKE SELECT (id, status) ON public.identity_identities FROM sevo_superadmin_recovery;
REVOKE UPDATE (granted_at, revoked_at, generation_id) ON public.identity_platform_superadmins FROM sevo_superadmin_recovery;
DROP FUNCTION IF EXISTS public.identity_recovery_lock_active_target(uuid);

CREATE OR REPLACE FUNCTION public.identity_recover_superadmin(target_id uuid, recovery_reason text, recovery_key uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  normalized text;
  payload_hash text;
  previous_hash text;
BEGIN
  IF NOT coalesce(pg_has_role(session_user, to_regrole('sevo_superadmin_recovery'), 'member'), false) THEN
    RAISE EXCEPTION 'recovery authority required';
  END IF;
  recovery_reason := btrim(recovery_reason);
  normalized := regexp_replace(translate(recovery_reason, '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'), '[[:space:]‌-]+', '', 'g');
  IF target_id IS NULL OR recovery_key IS NULL OR length(recovery_reason) NOT BETWEEN 10 AND 1000
     OR length(regexp_replace(normalized, '[^0-9]', '', 'g')) >= 10 OR recovery_reason ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}' THEN
    RAISE EXCEPTION 'invalid recovery input';
  END IF;
  payload_hash := encode(sha256(convert_to(jsonb_build_object('identityId', target_id, 'reason', recovery_reason)::text, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtext('identity_platform_superadmins'));
  SELECT r.payload_hash INTO previous_hash FROM public.identity_platform_superadmin_recovery_idempotency r WHERE r.key = recovery_key::text;
  IF FOUND THEN
    IF previous_hash <> payload_hash OR NOT EXISTS (
      SELECT 1 FROM public.identity_platform_superadmins a JOIN public.identity_identities i ON i.id = a.identity_id AND i.status = 'ACTIVE'
      WHERE a.identity_id = target_id AND a.revoked_at IS NULL
    ) THEN RAISE EXCEPTION 'recovery replay conflict'; END IF;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.identity_platform_superadmins a JOIN public.identity_identities i ON i.id = a.identity_id AND i.status = 'ACTIVE' WHERE a.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'active superadmin exists';
  END IF;
  PERFORM id FROM public.identity_identities WHERE id = target_id AND status = 'ACTIVE' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'target unavailable'; END IF;
  INSERT INTO public.identity_platform_superadmins (identity_id, granted_at, revoked_at)
    VALUES (target_id, now(), null) ON CONFLICT (identity_id) DO UPDATE
    SET granted_at = now(), revoked_at = null, generation_id = gen_random_uuid();
  INSERT INTO public.identity_platform_superadmin_audit (id, actor_identity_id, actor_kind, subject_identity_id, action, reason, correlation_id)
    VALUES (gen_random_uuid(), null, 'OWNER_RECOVERY', target_id, 'RECOVERED', recovery_reason, gen_random_uuid());
  INSERT INTO public.identity_platform_superadmin_recovery_idempotency (key, payload_hash, response)
    VALUES (recovery_key::text, payload_hash, jsonb_build_object('status', 'RECOVERED'));
END;
$$;
REVOKE ALL ON FUNCTION public.identity_recover_superadmin(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.identity_recover_superadmin(uuid, text, uuid) TO sevo_superadmin_recovery;

CREATE OR REPLACE FUNCTION public.identity_authorize_superadmin_totp(target_id uuid, authorization_reason text, authorization_key uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  normalized text;
  payload_hash text;
  previous_hash text;
  role_generation uuid;
BEGIN
  IF NOT coalesce(pg_has_role(session_user, to_regrole('sevo_superadmin_recovery'), 'member'), false) THEN
    RAISE EXCEPTION 'recovery authority required';
  END IF;
  authorization_reason := btrim(authorization_reason);
  normalized := regexp_replace(translate(authorization_reason, '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'), '[[:space:]‌-]+', '', 'g');
  IF target_id IS NULL OR authorization_key IS NULL OR length(authorization_reason) NOT BETWEEN 10 AND 1000
     OR length(regexp_replace(normalized, '[^0-9]', '', 'g')) >= 10 OR authorization_reason ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}' THEN
    RAISE EXCEPTION 'invalid authorization input';
  END IF;
  payload_hash := encode(sha256(convert_to(jsonb_build_object('action', 'TOTP_ENROLLMENT', 'identityId', target_id, 'reason', authorization_reason)::text, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(hashtext('identity_platform_superadmins'));
  SELECT a.generation_id INTO role_generation FROM public.identity_platform_superadmins a JOIN public.identity_identities i ON i.id = a.identity_id AND i.status = 'ACTIVE' WHERE a.identity_id = target_id AND a.revoked_at IS NULL FOR SHARE OF a, i;
  IF NOT FOUND THEN RAISE EXCEPTION 'active superadmin required'; END IF;
  SELECT r.payload_hash INTO previous_hash FROM public.identity_platform_superadmin_recovery_idempotency r WHERE r.key = authorization_key::text;
  IF FOUND THEN
    IF previous_hash <> payload_hash OR NOT EXISTS (SELECT 1 FROM public.identity_totp_bootstrap_authorizations b WHERE b.identity_id = target_id AND b.superadmin_generation_id = role_generation AND b.consumed_at IS NULL AND b.expires_at > clock_timestamp()) THEN
      RAISE EXCEPTION 'authorization replay conflict';
    END IF;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.identity_totp_factors WHERE identity_id = target_id) THEN RAISE EXCEPTION 'factor already exists'; END IF;
  INSERT INTO public.identity_totp_bootstrap_authorizations (identity_id, expires_at, consumed_at, superadmin_generation_id)
    VALUES (target_id, clock_timestamp() + interval '10 minutes', null, role_generation)
    ON CONFLICT (identity_id) DO UPDATE SET expires_at = EXCLUDED.expires_at, consumed_at = null, superadmin_generation_id = EXCLUDED.superadmin_generation_id
    WHERE public.identity_totp_bootstrap_authorizations.consumed_at IS NOT NULL OR public.identity_totp_bootstrap_authorizations.expires_at <= clock_timestamp() OR public.identity_totp_bootstrap_authorizations.superadmin_generation_id IS DISTINCT FROM role_generation;
  IF NOT FOUND THEN RAISE EXCEPTION 'authorization already exists'; END IF;
  INSERT INTO public.identity_platform_superadmin_audit (id, actor_identity_id, actor_kind, subject_identity_id, action, reason, correlation_id)
    VALUES (gen_random_uuid(), null, 'OWNER_RECOVERY', target_id, 'TOTP_ENROLLMENT_AUTHORIZED', authorization_reason, gen_random_uuid());
  INSERT INTO public.identity_platform_superadmin_recovery_idempotency (key, payload_hash, response)
    VALUES (authorization_key::text, payload_hash, jsonb_build_object('status', 'AUTHORIZED'));
END;
$$;
REVOKE ALL ON FUNCTION public.identity_authorize_superadmin_totp(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.identity_authorize_superadmin_totp(uuid, text, uuid) TO sevo_superadmin_recovery;

-- Owner-only password recovery also works when a previously registered TOTP factor is lost.
REVOKE ALL ON public.identity_platform_passwords, public.identity_sessions FROM sevo_superadmin_recovery;
CREATE OR REPLACE FUNCTION public.identity_owner_recover_platform_password(target_id uuid, login_name text, login_email text, encoded_password text, recovery_reason text, recovery_key uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE normalized text;
BEGIN
  IF NOT coalesce(pg_has_role(session_user, to_regrole('sevo_superadmin_recovery'), 'member'), false) THEN RAISE EXCEPTION 'recovery authority required'; END IF;
  login_name := lower(btrim(login_name));
  login_email := nullif(lower(btrim(login_email)), '');
  recovery_reason := btrim(recovery_reason);
  normalized := regexp_replace(translate(recovery_reason, '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'), '[[:space:]‌-]+', '', 'g');
  IF target_id IS NULL OR recovery_key IS NULL OR login_name !~ '^[a-z][a-z0-9._-]{2,99}$' OR (login_email IS NOT NULL AND (length(login_email) > 254 OR login_email !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$')) OR encoded_password !~ '^scrypt\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$' OR length(recovery_reason) NOT BETWEEN 10 AND 1000 OR length(regexp_replace(normalized, '[^0-9]', '', 'g')) >= 10 OR recovery_reason ~* '[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}' THEN RAISE EXCEPTION 'invalid recovery input'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('identity_platform_superadmins'));
  PERFORM pg_advisory_xact_lock(hashtextextended(target_id::text, 301));
  PERFORM i.id FROM public.identity_identities i JOIN public.identity_platform_superadmins a ON a.identity_id = i.id AND a.revoked_at IS NULL WHERE i.id = target_id AND i.status = 'ACTIVE' FOR SHARE OF i, a;
  IF NOT FOUND THEN RAISE EXCEPTION 'active target superadmin required'; END IF;
  IF EXISTS (SELECT 1 FROM public.identity_platform_superadmin_recovery_idempotency WHERE key = recovery_key::text) THEN RAISE EXCEPTION 'recovery replay rejected'; END IF;
  IF EXISTS (SELECT 1 FROM public.identity_platform_passwords p LEFT JOIN public.identity_login_methods m ON m.identity_id = p.identity_id AND m.kind = 'MOBILE' WHERE p.identity_id <> target_id AND (p.username IN (login_name, login_email) OR p.email IN (login_name, login_email) OR m.mobile IN (login_name, login_email))) THEN RAISE EXCEPTION 'identifier unavailable'; END IF;
  INSERT INTO public.identity_platform_passwords (identity_id, username, email, password_hash) VALUES (target_id, login_name, login_email, encoded_password) ON CONFLICT (identity_id) DO UPDATE SET username = EXCLUDED.username, email = EXCLUDED.email, password_hash = EXCLUDED.password_hash, changed_at = clock_timestamp();
  UPDATE public.identity_sessions SET revoked_at = clock_timestamp() WHERE identity_id = target_id AND audience = 'PLATFORM_AGENT' AND revoked_at IS NULL;
  INSERT INTO public.identity_platform_superadmin_audit (id, actor_identity_id, actor_kind, subject_identity_id, action, reason, correlation_id) VALUES (gen_random_uuid(), null, 'OWNER_RECOVERY', target_id, 'PASSWORD_RECOVERED', recovery_reason, gen_random_uuid());
  INSERT INTO public.identity_platform_superadmin_recovery_idempotency (key, payload_hash, response) VALUES (recovery_key::text, encode(sha256(convert_to(target_id::text, 'UTF8')), 'hex'), jsonb_build_object('status', 'PASSWORD_RECOVERED'));
END;
$$;
REVOKE ALL ON FUNCTION public.identity_owner_recover_platform_password(uuid, text, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.identity_owner_recover_platform_password(uuid, text, text, text, text, uuid) TO sevo_superadmin_recovery;
