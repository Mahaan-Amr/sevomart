# Migration ownership

Migration directories use `YYYYMMDDHHMMSS__<module>__<change>` and are owned by the
module named in the directory. One open Issue may change a module's schema at a time.
Cross-module foreign keys and direct reads are not allowed; identifiers from another
module are stored as scalar references and resolved through its public contract.

Every pull request that adds a migration must state the owning module, rollback or
forward-fix plan, and whether a compatibility window is required.
