CREATE TABLE problem_disputes (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL UNIQUE,
  buyer_identity_id uuid NOT NULL,
  store_id uuid NOT NULL,
  status varchar(32) NOT NULL CHECK (status IN (
    'AWAITING_SELLER_RESPONSE', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED'
  )),
  category varchar(40) NOT NULL,
  opened_at timestamptz(3) NOT NULL,
  deadline_kind varchar(32),
  deadline_at timestamptz(3),
  contributions jsonb NOT NULL CHECK (jsonb_typeof(contributions) = 'array'),
  outcome jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz(3) NOT NULL
);
CREATE INDEX problem_disputes_buyer_opened_idx
  ON problem_disputes (buyer_identity_id, opened_at DESC);
CREATE INDEX problem_disputes_store_opened_idx
  ON problem_disputes (store_id, opened_at DESC);
CREATE INDEX problem_disputes_queue_idx
  ON problem_disputes (status, deadline_at, opened_at DESC);

CREATE TABLE problem_dispute_audits (
  id uuid PRIMARY KEY,
  dispute_id uuid NOT NULL,
  action varchar(16) NOT NULL,
  actor_kind varchar(24) NOT NULL,
  actor_identity_id uuid NOT NULL,
  from_status varchar(32),
  to_status varchar(32) NOT NULL,
  reason_code varchar(48) NOT NULL,
  evidence_count integer NOT NULL CHECK (evidence_count BETWEEN 0 AND 10),
  correlation_id uuid NOT NULL,
  occurred_at timestamptz(3) NOT NULL
);
CREATE INDEX problem_dispute_audits_dispute_occurred_idx
  ON problem_dispute_audits (dispute_id, occurred_at);

CREATE TABLE problem_violation_cases (
  id uuid PRIMARY KEY,
  type varchar(40) NOT NULL,
  source_kind varchar(24) NOT NULL,
  source_reference_id uuid NOT NULL,
  status varchar(24) NOT NULL CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED')),
  opened_at timestamptz(3) NOT NULL,
  deadline_at timestamptz(3),
  next_action_code varchar(32) NOT NULL,
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'array'),
  action_reason_codes varchar(48)[] NOT NULL DEFAULT '{}'
);
CREATE INDEX problem_violation_cases_queue_idx
  ON problem_violation_cases (status, opened_at DESC);

CREATE TABLE problem_violation_audits (
  id uuid PRIMARY KEY,
  violation_case_id uuid NOT NULL,
  actor_identity_id uuid NOT NULL,
  action varchar(32) NOT NULL,
  status varchar(24) NOT NULL,
  reason_code varchar(32) NOT NULL,
  evidence_count integer NOT NULL CHECK (evidence_count BETWEEN 0 AND 20),
  correlation_id uuid NOT NULL,
  occurred_at timestamptz(3) NOT NULL
);
CREATE INDEX problem_violation_audits_case_occurred_idx
  ON problem_violation_audits (violation_case_id, occurred_at);

CREATE TABLE problem_follow_up_idempotency_records (
  operation varchar(32) NOT NULL,
  actor_id uuid NOT NULL,
  key varchar(200) NOT NULL,
  request_hash char(64) NOT NULL,
  response_json jsonb NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (operation, actor_id, key)
);

CREATE FUNCTION reject_problem_follow_up_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'problem follow-up audit is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER problem_dispute_audits_append_only
  BEFORE UPDATE OR DELETE ON problem_dispute_audits
  FOR EACH ROW EXECUTE FUNCTION reject_problem_follow_up_audit_mutation();
CREATE TRIGGER problem_violation_audits_append_only
  BEFORE UPDATE OR DELETE ON problem_violation_audits
  FOR EACH ROW EXECUTE FUNCTION reject_problem_follow_up_audit_mutation();
