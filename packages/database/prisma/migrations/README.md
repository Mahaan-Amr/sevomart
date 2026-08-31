# Migration ownership

Migration directories use `YYYYMMDDHHMMSS__<module>__<change>` and are owned by the
module named in the directory. One open Issue may change a module's schema at a time.
Cross-module foreign keys and direct reads are not allowed; identifiers from another
module are stored as scalar references and resolved through its public contract.

`platform` owns shared infrastructure migrations such as the outbox and consumer
receipts. This owner does not introduce another product-domain module.

Every pull request that adds a migration must state the owning module, rollback or
forward-fix plan, and whether a compatibility window is required.

The same `prisma migrate deploy` command applies migrations in both supported local
paths. A migration change must be verified once with `docker compose up --build
--wait` and once with `pnpm dev`; record those checks in the pull request. The seller
application migration owned by `identity-access` is additive, needs no compatibility
window, and uses a forward fix if deployment must be corrected.

Issue 79 verification (2026-08-24): Compose built all four application images, applied
all ten migrations, and reached healthy status; native `pnpm dev` reported no pending
migrations and brought Web, API, and worker to ready state.

Issue 80 verification (2026-08-24): the additive `product`, `inventory`, and `media`
migrations need no compatibility window and use a forward fix if deployment must be
corrected. `docker compose up --build --wait` applied all 21 migrations and brought
API, Web, and worker to healthy status; native `pnpm dev` reported no pending
migrations and brought API, Web, and worker to ready state.

Issue 86 adds the orders-owned guest cart tables and partial unique index for one
active cart per identity. The migration is additive, needs no compatibility window,
and uses a forward fix if deployment must be corrected. It stores only hashed cart
access secrets; prices and availability remain authoritative in their owner modules.
`docker compose up --build --wait` applied all 24 migrations and reached healthy
status; native `pnpm dev` reported no pending migrations and brought Web, API, and
worker to ready state.

Issue 84 verification (2026-08-24): the multivariant `product` migration relaxes
legacy one-variant constraints and adds variant identity, immutable snapshot and SKU
history storage without removing existing rows; it needs no compatibility window and
uses a forward fix if deployment must be corrected. `docker compose up --build
--wait` applied all 22 migrations and brought API, Web, and worker to healthy state;
native `pnpm dev` reported no pending migrations and brought Web, API, and worker to
ready state.

Issue 85 verification (2026-08-24): the `product` lifecycle migration extends the
existing state check with `UNPUBLISHED` and adds an append-only state-transition
audit without rewriting product or publication rows. It needs no compatibility
window and uses a forward fix if deployment must be corrected. `docker compose up
--build --wait` applied all 27 migrations and brought API, Web, and worker to healthy
state; native `pnpm dev` reported no pending migrations and brought API, Web, and
worker to ready state.

Issue 87 additively extends the orders-owned cart snapshot with reviewed product and
store terms, and adds versioned saved-address, idempotency, and PII-free audit
tables. Follow-up orders migrations add `IN_PROGRESS | COMPLETED` leases to cart and
saved-address idempotency records. Existing carts remain readable through
conservative review defaults. No compatibility window is required; deployment
corrections use a forward fix. `docker compose up --build --wait` found all 27
migrations, applied the pending cart-lease migration, and brought API, Web, and
worker to healthy status. Native `pnpm dev` found all 27 migrations with none
pending and brought API, Web, and worker to ready state.

Issue 88 adds inventory-owned expiring reservations and orders-owned checkout,
immutable snapshot and idempotency tables. Both migrations are additive, require no
compatibility window and use a forward fix if deployment must be corrected.
`docker compose up --build --wait` found all 33 migrations, applied the reservation
and checkout migrations, and brought API, Web, worker, PostgreSQL and MinIO to
healthy status. Native `pnpm dev` found all 33 migrations with none pending and
brought Web, API and worker to ready state.

Issue 89 adds inventory-owned payment holds, orders-owned paid/review transitions,
and payments-owned direct-attempt, callback-deduplication and audit tables. The
three migrations are additive, require no compatibility window and use a forward
fix if deployment must be corrected. The existing-database upgrade recognized all
36 migrations and applied only these three payment-flow migrations successfully;
the Compose and native paths use the same `prisma migrate deploy` history.

Issue 90 additively adds the payment reconciliation schedule, the narrowly scoped
platform payment-review permission and durable operational alerts. It requires no
compatibility window and uses a forward fix if deployment must be corrected. A
fresh isolated deployment applied all 40 migrations, including the latest discovery
migration from `main`, and the 13 payment recovery integration scenarios passed on
PostgreSQL without partial order, inventory or outbox effects.

Issue 114 removes the published cross-module foreign key from
`payment_attempts.order_id` with a payments-owned forward migration. The UUID remains
a required, indexed scalar reference whose existence and payable state are resolved
through the versioned orders contract inside the existing payment transaction. The
change is compatible with the current runtime, needs no compatibility window and can
be safely applied when the constraint is already absent. The architecture checker
tracks foreign-key additions and removals across the complete SQL migration history
so a later migration cannot restore a cross-producer constraint.

Issue 132 additively adds the inventory-owned idempotency scope, an optional
private audit note and explicit operation plus previous/next revision fields for
seller inventory adjustments. Existing adjustment rows are backfilled from their
authoritative `revision` (`previous = revision - 1`, `next = revision`) without
changing quantities, actors, reasons or timestamps; levels and reservations are
unchanged. No compatibility window is required and deployment corrections use a
forward migration. The 45-migration history was verified through both
`docker compose up --build --wait` and `pnpm dev` startup on 2026-08-29.

[Build: create a safe demo and QA runtime and orchestrator](https://github.com/Mahaan-Amr/sevomart/issues/126)
additively creates the platform-owned managed-data target fingerprint and versioned
demo-manifest receipt. Existing product data is not read or changed, no compatibility
window is required, and deployment corrections use a forward migration. Both supported
startup paths continue to use the same `prisma migrate deploy` history; their smoke
evidence is recorded in the delivery note for the Issue. The
`platform_data_environment` and `platform_seed_manifest_receipts` tables are registered
to the `platform` infrastructure owner in the canonical ownership registry.

The platform outbox envelope-version migration is a forward compatibility fix for
databases that applied the original outbox migration before `envelope_version` was
added. It preserves existing events, backfills envelope version `1`, and is a no-op
for fresh databases that already contain the required column.

Issue 139 adds six content-owned tables: sales content, product links, the latest
product-state projection, purchase experience, idempotency and audit, after
`20260827120000__conversations__send-claims`. References to store, product, media,
identity and order-item identifiers remain scalar; the only foreign key stays within
the content aggregate. The migration is additive, needs no compatibility window and
uses a forward fix if deployment must be corrected. Both supported runtime paths use
the same `prisma migrate deploy` history; verification evidence is recorded on the
Issue handoff.

Issue 127 additively introduces identity-access-owned responsibility and
case-scoped sensitive-access aggregates, command idempotency and immutable audit.
The existing platform-permission table remains the live compatibility projection
used by current authorizers and is updated atomically with each responsibility
activation or revocation. The migration needs no compatibility window and uses a
forward migration for corrections. Sensitive values are never copied into audit or
outbox payloads; every reveal is re-authorized inside the caller's transaction.

The identity-access-owned follow-up migration
`20260830113000__identity-access__audit-unresolved-sensitive-attempts` preserves the
attempted grant identifier while making the resolved grant relationship explicit and
nullable. It backfills existing audit rows under an exclusive lock in one transaction,
temporarily disables the append-only trigger only inside that transaction, and restores
the trigger before commit. Failed deployment rolls back the schema, backfill and trigger
state together; deployed corrections therefore use another forward migration. The
change is additive for the published v1 audit page and needs no compatibility window.
Docker and native startup continue to apply the same `prisma migrate deploy` history;
their Issue 127 follow-up verification is recorded in the delivery note.

Issue 136 additively creates the orders-owned
`order_fulfillment_status_projections` and `order_sensitive_access_audit` tables after
`20260830130000__identity-access__emergency-access-lifecycle`. It records only the
seller actor, store/order scope, a closed reason code, a required SHA-256 reason
fingerprint, correlation and time; delivery details and free-text reasons are never
copied into audit, logs or events. The table is append-only and uses scalar references
at module boundaries. The projection consumes only versioned fulfillment events and
contains order ID, status, version, accepted event ID and time. No compatibility window
is needed; deployed corrections use a forward migration. Docker and native startup
apply the same migration history. On 2026-08-31, native startup applied all 55
migrations to an isolated database and API, Web and worker readiness checks returned
healthy. The local Compose build was interrupted before runtime by repeated
`registry.npmjs.org` `ECONNRESET` failures; container CI remains the required Docker
verification before merge.

Issue 128 additively extends the identity-access access aggregate with the incident,
review deadline and immutable post-incident review facts needed for the emergency
access lifecycle, plus the rejection timestamp and unresolved emergency-attempt facts.
Post-incident review attempts are stored in a separate append-only history; a later
independent review links to, rather than overwrites, a single-human review.
Existing responsibility and sensitive grants remain unchanged. A rejected request
keeps the approved state-machine vocabulary and is fenced by its separate timestamp;
unresolved emergency audit rows keep the attempted kind and incident without a false
grant foreign key. The migration needs no compatibility window and deployment
corrections use a forward migration.

Issue 186 additively gives every orders-owned `order_items` row a stable unique UUID
and publishes the authoritative confirmed-purchase eligibility read for content.
Existing rows are backfilled, new rows use a database default, and no cross-module
foreign key or private order snapshot is exposed. No compatibility window is needed;
deployment corrections use a forward-fix migration. Docker and native both apply the
same `prisma migrate deploy` history.

Issue 134 additively creates fulfillment-owned order state, immutable timeline and
idempotency tables after
`20260830113000__identity-access__audit-unresolved-sensitive-attempts`. The order
identifier and seller-confirmed store identifier remain scalar cross-module
references; the only foreign key is internal to fulfillment. Existing orders are
handed off by the versioned outbox event, so no
backfill or compatibility window is required. Corrections use a forward migration,
and Docker and native continue to apply the same `prisma migrate deploy` history.
