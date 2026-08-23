# Engineering Bridge

Engineering Bridge is a local MCP bridge for supervised Codex/DSH work. Version 2.0.0 keeps the original read-only and controlled-patch paths and adds an explicitly authorized **trusted development** path for an already-approved repository Task Contract.

## Execution paths

### `run_readonly_task`

Use for analysis, review, code navigation, and other work that must not mutate the workspace.

- executor: Codex or DSH, default Codex;
- Codex uses read-only sandboxing with network disabled;
- interactive Codex inherits configured proxy transport variables required for model/control-plane connectivity, without granting task network access;
- no branch switching, file mutation, commit, push, or PR creation;
- successful turns enter `waiting_for_supervisor_review` and can be continued, steered, interrupted, or accepted.

### Controlled patch

`generate_controlled_patch` and `refine_controlled_patch` produce complete read-only patch proposals. `apply_controlled_patch` applies a validated proposal only after exact `APPLY` confirmation.

`allow_write` and `authorize_workspace_write` govern this path only. Controlled patch does not commit or push.

### `run_development_task`

Use only for a formal development task that has already been approved in the repository.

```json
{
  "workspace_id": "data-agent",
  "work_branch": "feature/example",
  "task_id": "DEV-001"
}
```

The Bridge derives `tasks/DEV-001.md`. There is no free-form implementation prompt and no executor selector; development is fixed to Codex.

The bootstrap contract requires Codex to verify the exact repository, inspect dirty state before switching branches, use the exact locally configured remote and work branch, synchronize fast-forward only, verify the Task Contract, read `AGENTS.md` and Required References, run repository Preflight, and then follow the repository's own formal development workflow. Unknown dirty work or branch divergence must fail closed as `BLOCKED`.

Force push and PR merge are prohibited by the development contract.

## Workspace authorization

`allow_write` and `allow_development` are separate permissions.

```json
[
  {
    "id": "trusted-development-project",
    "root": "/absolute/path/to/project",
    "allow_write": false,
    "allow_development": true,
    "development_remote": "origin"
  }
]
```

Rules:

- trusted development is available only to manual `workspaces.json` registrations;
- `development_remote` is mandatory when development is enabled;
- the remote is trusted local configuration, never an MCP input;
- managed workspaces cannot gain development permission;
- `authorize_workspace_write` never grants development permission;
- there is no MCP tool for self-authorizing development.

## Codex security mapping

Readonly:

```text
thread sandbox = read-only
turn sandboxPolicy = readOnly
networkAccess = false
```

Development:

```text
thread sandbox = danger-full-access
turn sandboxPolicy = externalSandbox
networkAccess = enabled
approvalPolicy = never
```

Trusted development therefore delegates isolation to the surrounding development container or OS sandbox. Do not enable it in a broad host environment containing resources Codex should not access.

For interactive Codex execution, both read-only and development tasks inherit configured proxy transport variables:

```text
HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY
http_proxy https_proxy all_proxy no_proxy
```

Development additionally inherits `SSH_AUTH_SOCK`. The Bridge does not default-forward `OPENAI_API_KEY`, `GH_TOKEN`, or `GITHUB_TOKEN`.

## MCP tools

V2 exposes exactly 10 tools:

```text
run_readonly_task
run_development_task
task_result
control_task
bind_project
create_project
authorize_workspace_write
generate_controlled_patch
refine_controlled_patch
apply_controlled_patch
```

`run_task` is intentionally removed rather than retained as an alias, because the tool name itself is routing metadata for the supervisor.

## Supervisor result metadata

`task_result` remains immediate when called with only `task_id`. Pass `wait_for: "ready"` to await a reviewable state, with an optional `timeout_ms` capped at 20 seconds (20 seconds by default). A timeout returns `ready: false` and `wait_timeout: true` without changing or interrupting the task. `include_evidence` defaults to `true`; setting it to `false` omits only `evidence`.

Interactive tasks can expose `live_output`, the latest bounded non-empty Codex `agentMessage` snapshot. It is not a transcript or token stream, and `continue` clears it before the next execution round. `review_output` remains the authoritative completed-turn output.

## Supervised development lifecycle

Codex completing a turn does **not** mean the Task is complete. A successful turn first enters `waiting_for_supervisor_review`, the review gate where the Supervisor inspects the unchanged `review_output`, the current Completion Receipt, bounded `live_output`, and evidence. Only `control_task(action="accept")` moves that same runtime task to `completed`.

`control_task(action="continue")` starts another delivery round for the same Task. The runtime task id, workspace, configured remote, work branch, Task Contract, logical Task identity, and reusable Codex thread remain fixed. The current receipt, live snapshot, and evidence are cleared before the next round; the next round's snapshots and newest receipt replace them. One Task may produce multiple commits on one branch, all continuation rounds use the same PR, force-push is forbidden, and the branch HEAD at Supervisor accept is the accepted delivery HEAD.

`task_result({ wait_for: "ready" })` waits only within one bounded request (20 seconds maximum). A timeout returns the latest non-ready snapshot with `wait_timeout: true` without changing task state or interrupting Codex. `include_evidence: false` omits only evidence for that response; receipt, identity, review output, and `live_output` remain independent. `live_output` is only the latest bounded Codex `agentMessage` snapshot—not a transcript, token stream, or server push.

The v2.1.0 Active-Turn Supervisor limitation is intentional: while the assistant turn is active, MCP can await a ready transition, but Engineering Bridge does not promise to wake a ChatGPT conversation after that assistant turn has already ended. Runtime task and waiter state are in-memory and may be lost on process restart. Completion Receipts are review metadata parsed and identity-validated by the Bridge task-service layer; they do not grant executor permissions.

## Build and test

Requires Node.js 22+.

```sh
npm ci
npm run build
npm test
```

Run the STDIO MCP server with:

```sh
node dist/src/mcp-stdio.js /absolute/path/to/workspaces.json
```

See [tools](docs/tools.md), [architecture](docs/architecture.md), [security](docs/security.md), [threat model](docs/threat-model.md), and [trusted development](docs/trusted-development.md).
