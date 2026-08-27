# Issue tracker: GitHub

Track work in GitHub Issues for Mahaan-Amr/sevomart using the `gh` CLI.
Repository specifications remain in `docs/specs/`; link tickets to the
relevant specification or decision.

Follow the root `AGENTS.md` rules for ownership, acceptance criteria,
coordination, review, and publishing changes. Reference issues in human
prose by title and link.

## Common operations

Run commands from the repository so `gh` infers the remote.

- Publish a ticket: `gh issue create --title "..." --body-file <file>`
- Fetch a ticket and discussion: `gh issue view <number> --comments`
- Read workflow state:
  `gh issue view <number> --json title,url,state,labels,assignees,body`
- List work:
  `gh issue list --state open --json number,title,url,labels,assignees`
- Comment: `gh issue comment <number> --body-file <file>`
- Apply or remove labels:
  `gh issue edit <number> --add-label "..." --remove-label "..."`
- Close completed work: `gh issue close <number> --comment "..."`

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Wayfinder

Read the relevant map in `docs/wayfinder/` and any linked GitHub map
issue. Preserve the existing map and decision history.

For GitHub-hosted maps, use `wayfinder:map` and link child tickets through
native sub-issues where available; otherwise use a linked task list.
Use the ticket-type labels defined in `AGENTS.md`.

Use native GitHub issue dependencies for blockers. If unavailable,
record explicit linked blockers in the ticket body. Check whether the
blocking issues are still open; a stale status label alone is not proof
that work is blocked.

Choose frontier work from the map's open, unassigned, unblocked tickets.
Claim it before other ticket writes with:
`gh issue edit <number> --add-assignee "@me"`.
An issue already assigned to the current developer is already claimed;
do not take over another developer's issue.

Resolve decision tickets using the final-comment, closure, and map-update
sequence in `AGENTS.md`. For implementation tickets, complete their
acceptance criteria and required review before closure.
