# Triage labels

Use these exact tracker labels when a skill names a triage role.

| Role            | Tracker label   | Meaning                                  |
| --------------- | --------------- | ---------------------------------------- |
| needs-triage    | needs-triage    | Maintainer evaluation needed             |
| needs-info      | needs-info      | Waiting for reporter information         |
| ready-for-agent | ready-for-agent | Fully specified for agent implementation |
| ready-for-human | ready-for-human | Requires human implementation            |
| wontfix         | wontfix         | Will not be actioned                     |

These labels complement the existing `kind:*`, `track:*`, `area:*`,
`status:*`, and `wayfinder:*` labels; they do not replace them.

Readiness labels do not override issue ownership, dependencies, or
repository acceptance and review requirements.
