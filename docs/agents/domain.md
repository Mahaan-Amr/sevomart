# Domain docs

This monorepo uses a shared, single-context documentation layout.
This describes document organization, not a change to module boundaries.

## Before exploring

Follow the prerequisite reading rules in the root `AGENTS.md`, then read
the architecture decisions relevant to the work.

- `CONTEXT.md`: canonical product terminology and domain definitions.
- `docs/architecture/decisions/`: shared architecture decision records.
- `docs/specs/`: feature specifications linked by implementation tickets.
- `docs/wayfinder/`: decision maps and their recorded outcomes.
- `docs/product/design-system.md`: mandatory product design baseline.

Keep these existing locations. This setup does not introduce
`CONTEXT-MAP.md`, per-package glossaries, or a second ADR directory.

## Vocabulary and decisions

Use the terminology in `CONTEXT.md` in issues, proposals, hypotheses,
and tests. If a needed concept is missing, investigate whether it is
an existing concept before proposing a domain-modeling update.

Surface conflicts with an approved decision explicitly and obtain a new
decision before changing it. Shared documentation does not merge module
ownership or authorize cross-module contract changes.
