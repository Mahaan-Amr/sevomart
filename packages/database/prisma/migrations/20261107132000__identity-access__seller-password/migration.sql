CREATE TABLE identity_seller_passwords (
  identity_id uuid PRIMARY KEY REFERENCES identity_identities(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  changed_at timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE identity_password_attempts (
  mobile varchar(11) PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 0,
  window_started_at timestamptz(3) NOT NULL
);
