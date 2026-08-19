# Trusted Development

Trusted development is the V2 execution path for an already-approved repository Task Contract. It is intentionally separate from read-only supervision and controlled patch application.

## Public contract

`run_development_task` accepts exactly:

```json
{
  "workspace_id": "data-agent",
  "work_branch": "feature/example",
  "task_id": "DEV-001"
}
```

The task contract path is derived as `tasks/<task_id>.md`. There is no free-form implementation instruction and no executor selector; Codex is fixed for this path.

## Local authorization

A manual workspace must explicitly opt in:

```json
{
  "id": "data-agent",
  "root": "/workspaces/data-agent",
  "allow_development": true,
  "development_remote": "origin"
}
```

`development_remote` is trusted local configuration and is never supplied by the remote MCP caller. Managed workspaces cannot receive development authorization. `authorize_workspace_write` only grants controlled-patch APPLY permission and never changes development authorization.

## Workspace Bootstrap

Before implementation, Codex is instructed to:

1. verify the current working directory is the expected Git repository;
2. inspect dirty state before any branch change;
3. stop as `BLOCKED` if unrelated dirty work exists; never stash/reset/clean/discard it;
4. verify the configured remote already exists; never add/remove/rewrite remotes;
5. fetch only the exact approved work branch from that exact remote;
6. switch only to the exact work branch; create a local branch only from the exact remote branch when necessary;
7. synchronize fast-forward only; stop on divergence rather than reset/rebase/force-update;
8. verify the exact current branch and the derived Task Contract path;
9. read `AGENTS.md`, the Task Contract, and every Required Reference;
10. execute the repository's own Preflight and formal development workflow.

The identity is immutable across `continue` and `steer`: workspace, remote, branch and Task Contract do not change. Force-push and PR merge are prohibited.

## Codex wire mapping

Read-only mode remains:

```text
thread sandbox = read-only
turn sandboxPolicy = readOnly
networkAccess = false
approvalPolicy = never
```

Development mode maps to:

```text
thread sandbox = danger-full-access
turn sandboxPolicy = externalSandbox
networkAccess = enabled
approvalPolicy = never
```

This delegates isolation to the outer trusted development container or OS sandbox. `danger-full-access` is therefore only safe when the Bridge itself runs inside a deliberately constrained development environment.

## Environment forwarding

For explicit interactive Codex tasks, both read-only and development execution forward the configured proxy variables required by the Codex process to reach its model/control-plane services:

```text
HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY
http_proxy https_proxy all_proxy no_proxy
```

These transport variables do not change the read-only task sandbox: read-only turns still use `readOnly` with task network access disabled.

Development execution additionally forwards:

```text
SSH_AUTH_SOCK
```

so Git operations can use an SSH agent when the outer development environment intentionally provides one.

The Bridge still does not forward `OPENAI_API_KEY`, `GH_TOKEN` or `GITHUB_TOKEN` by default. Codex authentication should come from its HOME/CODEX_HOME state; Git/gh authentication is owned by the outer development environment.

Legacy executor calls that do not opt into an explicit interactive execution mode keep the original minimal base environment rather than inheriting transport/development variables implicitly.

## Supervisor result metadata

Development task views include:

```json
{
  "task_kind": "development",
  "workspace_id": "data-agent",
  "work_branch": "feature/example",
  "task_contract": "tasks/DEV-001.md"
}
```

The existing queued/running/waiting_for_supervisor_review/completed/failed lifecycle is reused. There is no second state machine and no duplicated transcript store.
