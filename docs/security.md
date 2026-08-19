# Security Design

Engineering Bridge V2 has two materially different security modes and one controlled-apply path. They must not be conflated.

## Read-only supervision

`run_readonly_task` preserves the original low-privilege model:

- workspace must be pre-registered;
- Codex runs with `read-only` thread sandbox;
- turn policy is `readOnly` with network disabled;
- DSH remains read-only;
- proxy and SSH agent environment variables are not inherited by Codex readonly mode;
- the task cannot intentionally modify the workspace, commit, push, or create a PR.

This is a process-level policy, not an OS-level confidentiality boundary: a process running as the same OS user may still read files the OS permits.

## Controlled patch

Controlled patch remains an explicit review-before-write mechanism.

`allow_write` means only: the workspace may receive a validated `apply_controlled_patch` after exact `APPLY` confirmation. It does not grant Git development authority, network access, commit/push permission, or development-task eligibility.

Managed workspaces may receive `allow_write` through `authorize_workspace_write` after exact `AUTHORIZE` confirmation.

## Trusted development

`run_development_task` is intentionally more privileged. It is designed for a formal repository Task Contract whose implementation is expected to modify files, run project tools, use Git, push the approved work branch and create/update a PR.

Development permission is local-only configuration:

```json
{
  "id": "project",
  "root": "/workspaces/project",
  "allow_development": true,
  "development_remote": "origin"
}
```

Security properties:

- only manual workspaces may enable it;
- `development_remote` is mandatory and trusted local configuration;
- the MCP caller cannot supply or modify the remote;
- managed workspaces cannot be upgraded into development workspaces;
- `authorize_workspace_write` never affects development permission;
- there is no MCP development-authorization tool.

## Immutable task identity

A development task fixes:

```text
workspace_id
remote
work_branch
task_id
tasks/<task_id>.md
executor=codex
```

`continue` and `steer` preserve that identity. Supervisor feedback can refine implementation, but cannot redirect the task to another branch/remote/Task Contract.

## Bootstrap fail-closed rules

The generated bootstrap instruction requires Codex to stop rather than repair unknown repository state:

- unrelated dirty work -> `BLOCKED`;
- configured remote missing -> `BLOCKED`;
- local/remote divergence -> `BLOCKED`;
- Task Contract missing -> `BLOCKED`;
- repository Preflight failure -> `BLOCKED`.

It explicitly prohibits stash/reset/clean/discard of unrelated work, remote rewrites, rebase/reset as synchronization, force push, and PR merge.

## Outer sandbox assumption

Development Codex maps to:

```text
thread sandbox = danger-full-access
turn sandboxPolicy = externalSandbox
networkAccess = enabled
approvalPolicy = never
```

Therefore the **outer development container or OS sandbox is the actual security boundary**. Enabling trusted development directly in a broad host environment grants Codex whatever that host user/container can access.

Recommended deployment topology keeps tunnel/control-plane secrets outside the development sandbox when possible:

```text
host / control plane
  tunnel client + tunnel credential

trusted dev container
  Engineering Bridge
  Codex
  workspace
  Git/Codex development credentials
```

## Environment forwarding

Readonly Codex receives the minimal base allowlist.

Development additionally receives:

```text
HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY
http_proxy https_proxy all_proxy no_proxy
SSH_AUTH_SOCK
```

Bridge does not default-forward:

```text
OPENAI_API_KEY
GH_TOKEN
GITHUB_TOKEN
```

This is deliberate defense in depth. It does not make the container secret-free: credentials stored in HOME, CODEX_HOME, `~/.ssh`, `~/.config/gh`, mounted files, agent sockets or other readable locations remain available according to OS permissions.

## Input validation

`task_id` accepts a conservative filename-safe token and is always mapped under `tasks/`.

`work_branch` rejects control/whitespace characters and dangerous Git-ref constructs including `..`, `@{`, backslash, leading `-`, malformed segments and unsupported ref syntax.

These values are passed as task data to Codex, not interpolated into a shell command by Bridge. Executor processes are started with `shell: false` and task instructions travel over app-server stdin.

## Residual risk

Trusted development is intentionally capable of making real repository changes. A malicious or compromised Task Contract, repository instruction file, dependency script, CLI, Git hook, SSH configuration, credential helper or upstream endpoint can influence execution. The outer sandbox and repository governance remain essential controls.
