# Architecture

Engineering Bridge V2 separates three execution paths while reusing one supervisor task lifecycle.

```text
MCP supervisor
   |
   +-- run_readonly_task --------> RegisteredWorkspaceTaskService
   |                                  |
   |                                  +--> Codex(readonly) / DSH(readonly)
   |
   +-- run_development_task -----> RegisteredWorkspaceTaskService
   |                                  |
   |                                  +--> Codex(development)
   |                                         |
   |                                         +--> outer trusted sandbox
   |
   +-- generate/refine patch ----> ControlledPatchService
                                      |
                                      +--> readonly executor
                                      +--> reviewed Bridge APPLY
```

## Workspace registry

Manual workspace configuration is authoritative. A registration may independently grant:

```text
allow_write
    controlled-patch APPLY permission

allow_development + development_remote
    trusted formal-development permission
```

`allow_write` and `allow_development` are deliberately not interchangeable.

Managed workspaces created through onboarding can gain controlled-write permission, but never trusted-development permission. There is no MCP tool that can self-authorize development access.

## Read-only task path

`run_readonly_task` starts an interactive supervised task with Codex or DSH. The TaskService records the selected executor and reuses the existing lifecycle:

```text
queued
  -> running
  -> waiting_for_supervisor_review
  -> completed

or -> failed
```

Codex thread IDs are reused for continuation when available. DSH does not fabricate a resumable thread ID.

## Development task path

`run_development_task` accepts only `workspace_id`, `work_branch`, and `task_id`. The service resolves the locally configured development remote, constructs an immutable development identity, and generates a deterministic bootstrap instruction.

The development identity is:

```text
workspace_id
remote
work_branch
task_id -> tasks/<task_id>.md
executor = codex
executionMode = development
```

The same identity is retained across `continue` and `steer`. The supervisor cannot change remote, branch or task through continuation text.

## Bootstrap boundary

The bootstrap instruction is intentionally procedural rather than embedding repository-specific implementation rules. It verifies clean state, exact remote/branch, fast-forward-only synchronization, Task Contract existence, `AGENTS.md`, Required References and repository Preflight. The repository's own contract remains the source of truth for implementation details.

This avoids duplicating product-development policy inside Engineering Bridge.

## Executor semantic mode

The executor interface carries a Bridge-level semantic mode:

```ts
ExecutionMode = "readonly" | "development"
```

Codex maps that semantic mode to the app-server protocol:

```text
readonly:
  thread sandbox = read-only
  turn policy = readOnly
  network = false

development:
  thread sandbox = danger-full-access
  turn policy = externalSandbox
  network = enabled
```

The development mapping means the outer development container/OS sandbox is the isolation boundary. The Bridge does not attempt to provide a second, incomplete Git sandbox around formal development work.

## Environment ownership

Interactive Codex execution receives the transport environment required for Codex model/control-plane communication:

```text
HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY
http_proxy https_proxy all_proxy no_proxy
```

Trusted development additionally receives:

```text
SSH_AUTH_SOCK
```

High-value API/token variables such as `OPENAI_API_KEY`, `GH_TOKEN`, and `GITHUB_TOKEN` are not forwarded by default. Codex auth is expected through HOME/CODEX_HOME; Git/gh auth is owned by the trusted outer environment.

## Controlled patch path

ControlledPatchService remains structurally separate. Proposal generation is read-only and APPLY is performed by Bridge after validation and explicit confirmation. It does not use the trusted development path and does not commit or push.

## State ownership

Bridge stores temporary supervisor state only: task state, executor, thread id when available, bounded evidence, review output and immutable development identity. It does not mirror a full executor transcript. Codex remains the source of truth for its native thread history.
