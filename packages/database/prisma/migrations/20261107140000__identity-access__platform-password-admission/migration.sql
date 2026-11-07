CREATE TABLE identity_platform_password_admission (
 id smallint PRIMARY KEY CHECK (id = 1),
 attempts integer NOT NULL,
 window_started_at timestamptz NOT NULL
);
INSERT INTO identity_platform_password_admission (id, attempts, window_started_at) VALUES (1, 0, now());
