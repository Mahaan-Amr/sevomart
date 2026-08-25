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

The platform outbox envelope-version migration is a forward compatibility fix for
databases that applied the original outbox migration before `envelope_version` was
added. It preserves existing events, backfills envelope version `1`, and is a no-op
for fresh databases that already contain the required column.
