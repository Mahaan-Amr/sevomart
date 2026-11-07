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
