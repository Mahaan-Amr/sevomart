ALTER TABLE identity_otp_challenges DROP CONSTRAINT identity_otp_challenges_audience_check;
ALTER TABLE identity_otp_challenges ADD CONSTRAINT identity_otp_challenges_audience_check
  CHECK (audience IN ('PUBLIC', 'PLATFORM_AGENT', 'PASSWORD_RESET'));
