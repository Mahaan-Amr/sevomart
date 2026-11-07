CREATE TABLE identity_platform_passwords (
  identity_id uuid PRIMARY KEY REFERENCES identity_identities(id) ON DELETE CASCADE,
  username varchar(100) NOT NULL UNIQUE CHECK (username = lower(username)),
  email varchar(254) UNIQUE CHECK (email = lower(email)),
  password_hash text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE identity_sessions ADD COLUMN platform_auth_method varchar(16);
CREATE TABLE identity_platform_password_attempts (
  identifier_hash char(64) PRIMARY KEY,
  attempts integer NOT NULL,
  window_started_at timestamptz NOT NULL
);
