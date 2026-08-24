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

Issue 84 verification (2026-08-24): the multivariant `product` migration relaxes
legacy one-variant constraints and adds variant identity, immutable snapshot and SKU
history storage without removing existing rows; it needs no compatibility window and
uses a forward fix if deployment must be corrected. `docker compose up --build
--wait` applied all 22 migrations and brought API, Web, and worker to healthy state;
native `pnpm dev` reported no pending migrations and brought Web, API, and worker to
ready state.

The platform outbox envelope-version migration is a forward compatibility fix for
databases that applied the original outbox migration before `envelope_version` was
added. It preserves existing events, backfills envelope version `1`, and is a no-op
for fresh databases that already contain the required column.
