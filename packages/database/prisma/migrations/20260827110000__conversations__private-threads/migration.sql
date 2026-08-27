CREATE TABLE conversation_threads (
  id uuid PRIMARY KEY,
  buyer_identity_id uuid NOT NULL,
  seller_identity_id uuid NOT NULL,
  store_id uuid NOT NULL,
  context_kind varchar(16) NOT NULL CHECK (context_kind IN ('STORE', 'PRODUCT', 'ORDER')),
  context_reference_id uuid NOT NULL,
  context jsonb NOT NULL,
  version integer NOT NULL DEFAULT 0,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CHECK (buyer_identity_id <> seller_identity_id),
  UNIQUE (buyer_identity_id, seller_identity_id, store_id, context_kind, context_reference_id)
);
CREATE INDEX conversation_threads_buyer_updated ON conversation_threads (buyer_identity_id, updated_at DESC, id DESC);
CREATE INDEX conversation_threads_seller_updated ON conversation_threads (seller_identity_id, updated_at DESC, id DESC);
CREATE TABLE conversation_idempotency (
  scope varchar(128) NOT NULL,
  key varchar(200) NOT NULL,
  request_hash char(64) NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);
CREATE TABLE conversation_audits (
  id uuid PRIMARY KEY,
  identity_id uuid,
  conversation_id uuid,
  operation varchar(48) NOT NULL,
  outcome varchar(48) NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE TABLE conversation_messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,
  sender_role varchar(8) NOT NULL CHECK (sender_role IN ('BUYER', 'SELLER')),
  content jsonb NOT NULL,
  created_at timestamptz(3) NOT NULL
);
CREATE INDEX conversation_messages_order ON conversation_messages (conversation_id, created_at DESC, id DESC);
CREATE TABLE conversation_snapshots (
  id uuid PRIMARY KEY,
  identity_id uuid NOT NULL,
  operation varchar(16) NOT NULL CHECK (operation IN ('THREADS', 'MESSAGES')),
  conversation_id uuid,
  expires_at timestamptz(3) NOT NULL
);
CREATE INDEX conversation_snapshots_expiry ON conversation_snapshots (expires_at);
CREATE TABLE conversation_snapshot_entries (
  snapshot_id uuid NOT NULL REFERENCES conversation_snapshots(id) ON DELETE CASCADE,
  item_id uuid NOT NULL,
  sort_at timestamptz(3) NOT NULL,
  PRIMARY KEY (snapshot_id, item_id)
);
CREATE INDEX conversation_snapshot_entries_order ON conversation_snapshot_entries (snapshot_id, sort_at DESC, item_id DESC);
