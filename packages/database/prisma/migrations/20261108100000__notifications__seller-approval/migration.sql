CREATE TABLE notifications_seller_approval (
  event_id UUID PRIMARY KEY,
  application_id UUID NOT NULL,
  state VARCHAR(24) NOT NULL DEFAULT 'READY',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notifications_seller_approval_state_check CHECK
    (state IN ('READY', 'UNKNOWN', 'NO_RECIPIENT', 'SIMULATED_ACCEPTED', 'SIMULATED_FAILED'))
);
