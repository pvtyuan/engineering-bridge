# MCP Tool Reference

Engineering Bridge V2 exposes 10 MCP tools. The names are intentionally explicit so the supervisor can route read-only work, formal development work, and controlled patch work correctly.

## `run_readonly_task`

Input:

```json
{
  "workspace_id": "example",
  "instruction": "inspect the authentication flow",
  "executor": "codex"
}
```

`executor` is optional and may be `codex` or `dsh`; default is `codex`.

Use for analysis, review, investigation and other work that must not modify the workspace. Codex runs read-only with network disabled.

## `run_development_task`

Input:

```json
{
  "workspace_id": "example",
  "work_branch": "feature/example",
  "task_id": "DEV-001"
}
```

Use only for an approved formal repository task. The tool is Codex-only and derives `tasks/DEV-001.md`. The local workspace must explicitly set `allow_development: true` and `development_remote`.

The tool fixes workspace/remote/branch/task identity for the task lifetime. It may modify files, run tests, update reports/docs, commit, push, and create/update the task PR according to the repository's `AGENTS.md` and Task Contract. It must not force-push or merge the PR.

## `task_result`

Input:

```json
{
  "task_id": "...",
  "wait_for": "ready",
  "timeout_ms": 20000,
  "include_evidence": false
}
```

With only `task_id`, the tool preserves its legacy immediate-return behavior. When `wait_for` is `"ready"`, it waits for a ready state (`waiting_for_supervisor_review`, `failed`, or `completed`) and uses a maximum 20-second timeout by default. A timeout returns the latest snapshot with `ready: false` and `wait_timeout: true`; it does not change task state or interrupt execution.

`include_evidence` defaults to `true`. Set it to `false` to omit only `evidence`; identity, errors, review output, and `live_output` remain available. While an interactive task is queued or running, `live_output` contains the latest bounded non-empty Codex agent message, not a transcript.

Returns task state, executor, readiness, evidence, output/review output or safe error. Development tasks additionally return `task_kind`, `workspace_id`, `work_branch`, and `task_contract`.

## Supervised development lifecycle

Codex completing a turn is not Task acceptance. A completed development turn enters `waiting_for_supervisor_review`, where the Supervisor reviews the unchanged `review_output`, current-round Completion Receipt, bounded `live_output`, and evidence. `control_task(action="accept")` then completes that same runtime task; `control_task(action="continue")` starts another round on the same runtime task, workspace, configured remote, work branch, Task Contract, logical Task, and reusable Codex thread when available.

Each continuation clears the previous current receipt, live snapshot, and evidence before queueing the next round. The next round supplies the current snapshots and newest receipt. A Task may make multiple commits on its one work branch and continuation rounds use the same PR; the accepted branch HEAD is the delivery HEAD, with no force-push or automatic merge.

The ready wait is Promise/event based and bounded to 20 seconds per MCP request. `waiting_for_supervisor_review`, `failed`, and `completed` are ready states. A timeout returns the latest non-ready snapshot with `wait_timeout: true` and does not mutate or interrupt the task. `include_evidence: false` suppresses only the response's evidence field, while `live_output` remains the latest bounded non-empty `agentMessage` snapshot. It is not transcript persistence, token streaming, or server push.

The Active-Turn Supervisor limitation remains: Engineering Bridge can serve a bounded MCP wait while the assistant turn is active, but does not promise to wake a ChatGPT conversation after the assistant turn ends. Runtime task and waiter state are in-memory and may be lost on process restart. A Completion Receipt is Bridge-validated review metadata for the trusted task id and work branch, not an authorization mechanism.

## `control_task`

Input:

```json
{
  "task_id": "...",
  "action": "continue",
  "instruction": "address the review finding"
}
```

Actions: `continue`, `steer`, `interrupt`, `accept`.

For development tasks, `continue` and `steer` preserve the exact original workspace/remote/branch/task identity.

## `bind_project`

Registers an existing directory inside a configured `project_root` as a managed workspace after exact `BIND` confirmation. Managed workspaces are read-only by default and cannot receive trusted development permission through MCP.

## `create_project`

Creates an empty Git project under a configured `project_root` after exact `CREATE` confirmation and registers it as a managed workspace. It does not grant trusted development permission.

## `authorize_workspace_write`

After exact `AUTHORIZE`, grants a managed workspace permission for controlled-patch APPLY. This permission is unrelated to trusted development and never enables `run_development_task`.

## `generate_controlled_patch`

Generates a complete read-only patch proposal. Optional executor: Codex or DSH. Use this for review-before-APPLY patch workflows, not for a formal Task Contract with a work branch.

## `refine_controlled_patch`

Creates a new complete patch proposal from a retained completed proposal while preserving its base HEAD.

## `apply_controlled_patch`

After exact `APPLY`, validates and applies one retained patch proposal. It never stages, commits, pushes, creates PRs, or changes development authorization.

## Removed V1 name

`run_task` was removed in V2 and is not retained as an alias. `run_readonly_task` is the replacement for the old generic supervised task entry point; formal implementation is routed to `run_development_task`.
