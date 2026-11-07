ALTER TABLE identity_platform_password_recoveries
  ADD COLUMN permission_grant_id uuid,
  ADD COLUMN superadmin_generation_id uuid;
