# CI Architecture Completion Gate

Use this reference when a repository adopts project architecture memory as a
required pull-request check.

Copy `assets/ci/adaptive-architecture-check.yml` into the repository workflow
directory and adjust `ADAPTIVE_PLAN_CLI` to the repository's pinned plugin/CLI
location. Keep `fetch-depth: 0`; the check needs both pull-request revisions.

Each pull request maintains
`docs/architecture/adaptive/changes/current-impact.json` (or a repository-chosen
equivalent) containing the exact baseline architecture hash and changed paths.
The artifact must contain either:

- `no_contract_change` plus concrete validation evidence; or
- `contract_delta` plus the applied delta reference and explicit approval.

The command recomputes `git diff --name-only <base> <head>`, compares it with the
artifact, and fails for missing/unmapped paths, ambiguous ownership, stale
architecture hashes, absent evidence, unapproved contract deltas, or path-set
mismatches.

Configure the `adaptive-architecture` job as a required branch-protection check.
CI verifies coverage and evidence consistency; it does not claim to prove the
semantic correctness of a human architecture decision.

