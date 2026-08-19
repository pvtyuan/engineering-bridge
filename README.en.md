# Engineering Bridge

Engineering Bridge is a local MCP bridge for supervised Codex/DSH work. Version 2.0.0 keeps the original read-only and controlled-patch paths and adds an explicitly authorized **trusted development** path for an already-approved repository Task Contract.

## Execution paths

### `run_readonly_task`

Use for analysis, review, code navigation, and other work that must not mutate the workspace.

- executor: Codex or DSH, default Codex;
- Codex uses read-only sandboxing with network disabled;
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

Development additionally forwards proxy variables and `SSH_AUTH_SOCK`, but the Bridge does not default-forward `OPENAI_API_KEY`, `GH_TOKEN`, or `GITHUB_TOKEN`.

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
