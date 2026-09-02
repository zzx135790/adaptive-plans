# Adaptive Planning Governance

Adaptive Planning Governance is an optional layer for projects that need
controls beyond ordinary implementation planning. It turns evolving work into
a visible DAG without turning every experiment into a production project and
keeps four states separate:

- project-owned architecture memory;
- plan-owned topology and execution gates;
- revisioned root and child design decisions;
- an explicit engineering posture that defines when the work is done.

`map.json`, project `architecture.json`, and `design.json` are independent
canonical records. Their Markdown files are generated views.

## Request Context

The bundled MCP server is stateless across projects. Every `tools/call` and
`resources/read` request must include `context.project_root` as an absolute
path. Set the optional project-relative `context.plan_path` when addressing one
plan folder. Startup working directories, root flags, and root environment
variables do not select project state.

## Optional Hooks

Hooks are disabled by default and are not declared in either plugin manifest.
To enable append-only audit recording, explicitly install the configuration at
`optional-hooks/hooks.json`. See `optional-hooks/README.md` for host examples.

## Workflow

```text
project architecture snapshot
          |
          v
N-000 bootstrap -> intent + posture + Design Gate -> complete DAG
                                                     |
                                         ready leaf node + exact refs
                                                     |
                                      child design when material
                                                     |
                                      leaf plan -> implementation
                                                     |
                               diff evidence -> architecture refresh
                                                     |
                                            completion check
```

Root design chooses module responsibilities, dependency direction, and broad
interfaces. Material module/relation/task designs are created only when their
leaf inputs are current, then implementation proceeds leaf-first. A private,
contract-preserving choice may stay inline.

Every map starts with visible control node `N-000`. Its only job is to create
and verify the plan folder, canonical map, generated views, node briefs, event
log, architecture link, posture, and required design state. `N-000` must be
visible in the DAG and artifact index before product nodes are released.

## Terminal Contract

Show the whole workflow without opening each artifact:

```bash
node scripts/adaptive-plan.mjs overview --root <plan-folder>
```

The overview includes the full ASCII DAG, blockers, posture and scope budgets,
provider lifecycle, binding diagnostics, pending approval brief, and complete
artifact index. Approval is requested from that bounded terminal summary and
is bound to the exact content, posture, and brief hashes. `DESIGN.md` remains an
audit view, not the approval UI.

## Engineering Posture

Profiles are different definitions of done, not a maturity ladder:

| Posture | Required completion evidence |
|---|---|
| `spike` | bounded question answered; result validity |
| `experiment` | hypothesis; measurement validity; reproduction instructions |
| `reusable_internal` | stable local contract; compatibility evidence; integration tests |
| `production` | operational ownership; security assessment; migration and rollback; reliability evidence |

Possible future reuse never promotes a profile. Promotion is an explicit,
hash-bound operation that stops execution and reopens design and architecture
synchronization.

## Migration And Recovery

Migration is always previewed first:

```bash
node scripts/adaptive-plan.mjs migrate --root <plan-folder>
node scripts/adaptive-plan.mjs migrate --root <plan-folder> --apply --expected-hash <proposal-hash>
node scripts/adaptive-plan.mjs migrate --root <plan-folder> --recover <migration-id> --expected-current-hash <map-hash>
```

The preview is read-only and includes source/target hashes, changed paths, and
a full preservation manifest. Apply stores byte-exact recovery material before
canonical writes. Flat design history is converted only with `--include-design`
and an explicit authoritative PostureRef; historical approvals become evidence,
not authority for the new hash.

## Skill Composition

Installed design and planning skills are composed through a versioned
`CompositionContract`. Direct reuse keeps the provider workflow intact. A thin
adapter may only translate envelopes and verify expected persistence. Missing
dependencies, digest drift, failed invocation, or unwritten expected artifacts
stay visible; the plugin does not silently reimplement the provider.

Governance maps also expose behavior-level skill routing. For each substantive
behavior, the host model selects from skill names and descriptions visible in
the current session and records one ordered `selected_skill` or named Ada
fallback, the purpose and selection reason, and at most two rejected
alternatives. `MAP.md`, node briefs, and `adaptive-plan overview` render that
decision. The plugin does not scan or install skills or maintain a persistent
skill catalog; its deterministic code only validates, stores, and renders the
host's semantic choice. Route replacements record old route, new route, and
reason in `override_reason`.

The engineering default is to trust standard libraries, mature dependencies,
and repository-verified operations. Wrappers, guards, alternate
implementations, and repeated checks require task evidence. Mandatory
safety-floor claims additionally require scoped provenance and a complete,
minimal `safety_case`; otherwise they remain deferred as
`missing_safety_case`.

## Verification

```bash
npm test
node scripts/doctor.mjs --root .
node scripts/validate-plan.mjs --root <plan-folder> --strict
node scripts/completion-check.mjs --root <plan-folder>
```

Detailed lifecycle rules live under
`skills/adaptive-planning-governance/references/`.
