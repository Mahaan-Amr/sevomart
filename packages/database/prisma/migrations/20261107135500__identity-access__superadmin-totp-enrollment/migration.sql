ALTER TABLE identity_totp_bootstrap_authorizations ADD COLUMN superadmin_generation_id uuid;
ALTER TABLE identity_totp_factors ADD COLUMN enrollment_superadmin_generation_id uuid;
ALTER TABLE identity_platform_superadmin_audit DROP CONSTRAINT identity_platform_superadmin_audit_action_check;
ALTER TABLE identity_platform_superadmin_audit ADD CONSTRAINT identity_platform_superadmin_audit_action_check CHECK (action IN ('GRANTED', 'REVOKED', 'RECOVERED', 'TOTP_ENROLLMENT_AUTHORIZED'));
ALTER TABLE identity_platform_superadmin_audit DROP CONSTRAINT identity_platform_superadmin_audit_actor_check;
ALTER TABLE identity_platform_superadmin_audit ADD CONSTRAINT identity_platform_superadmin_audit_actor_check CHECK ((actor_kind = 'SUPERADMIN' AND actor_identity_id IS NOT NULL AND action IN ('GRANTED', 'REVOKED')) OR (actor_kind = 'OWNER_RECOVERY' AND actor_identity_id IS NULL AND action IN ('RECOVERED', 'TOTP_ENROLLMENT_AUTHORIZED')));
