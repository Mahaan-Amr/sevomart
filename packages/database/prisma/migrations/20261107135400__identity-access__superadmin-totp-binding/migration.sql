ALTER TABLE identity_platform_superadmins ADD COLUMN generation_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE identity_totp_action_proofs ADD COLUMN superadmin_generation_id uuid;
ALTER TABLE identity_totp_action_proofs ADD CONSTRAINT identity_totp_proof_single_authority CHECK (permission_grant_id IS NULL OR superadmin_generation_id IS NULL);
ALTER TABLE identity_totp_recovery_approvals ALTER COLUMN permission_grant_id DROP NOT NULL;
ALTER TABLE identity_totp_recovery_approvals ADD COLUMN superadmin_generation_id uuid;
ALTER TABLE identity_totp_recovery_approvals ADD CONSTRAINT identity_totp_approval_single_authority CHECK ((permission_grant_id IS NULL) <> (superadmin_generation_id IS NULL));
