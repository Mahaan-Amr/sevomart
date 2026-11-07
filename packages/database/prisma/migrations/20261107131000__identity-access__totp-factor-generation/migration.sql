ALTER TABLE identity_totp_factors ADD COLUMN generation_id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE identity_totp_action_proofs ADD COLUMN factor_generation_id UUID;
ALTER TABLE identity_totp_recovery_approvals ADD COLUMN factor_generation_id UUID;
