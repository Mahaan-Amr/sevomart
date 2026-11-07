CREATE TABLE identity_password_admission (
  id smallint PRIMARY KEY CHECK (id = 1),
  attempts integer NOT NULL,
  window_started_at timestamptz(3) NOT NULL
);
INSERT INTO identity_password_admission (id, attempts, window_started_at) VALUES (1, 0, now());
CREATE INDEX identity_password_attempts_window_idx ON identity_password_attempts (window_started_at);
