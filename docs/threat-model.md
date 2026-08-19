# Threat Model

This document describes the V2 threat model for Engineering Bridge, including trusted development.

## Assets

Relevant assets include:

- source code and uncommitted work in registered workspaces;
- Git branch state and remote configuration;
- repository governance such as protected branches and PR review;
- Codex authentication state;
- Git/SSH/gh credentials available to the development environment;
- proxy configuration and network reachability;
- local MCP/tunnel credentials outside the Bridge when applicable.

## Trust boundaries

### MCP caller -> Bridge

The MCP caller is allowed to choose registered IDs and tool inputs, but it must not be able to create new filesystem trust roots or grant itself development authority.

Controls:

- workspace roots come from local configuration/onboarding boundaries;
- development remote comes only from local manual configuration;
- no `authorize_workspace_development` tool exists;
- branch/task identifiers use conservative validation.

### Bridge -> executor

Readonly tasks are low privilege. Development tasks are deliberately high privilege.

Controls common to Codex execution:

- `shell: false`;
- user/task instruction travels over app-server stdin rather than argv;
- fixed Codex app-server invocation;
- bounded evidence returned to supervisor.

Readonly controls:

- read-only sandbox;
- network disabled;
- minimal environment allowlist.

Development controls:

- immutable task identity;
- deterministic bootstrap contract;
- outer sandbox explicitly designated as the isolation boundary;
- proxy/SSH agent forwarding limited to development mode;
- common API/token variables not forwarded by default.

### Development sandbox -> host/control plane

This is the most important V2 boundary. `externalSandbox` means Codex can exercise permissions granted by the surrounding development container/OS environment.

Do not place control-plane tunnel credentials or unrelated host secrets inside that sandbox unless Codex is intentionally allowed to use them.

## Threats and mitigations

### MCP caller tries to self-escalate

Mitigation: managed workspaces can gain controlled-write only; development permission is manual local configuration and cannot be changed through MCP.

### Caller redirects a task to another remote or branch

Mitigation: remote is not a tool argument. Branch and Task Contract identity are fixed when the task starts and reused for continue/steer.

### Dirty local work is overwritten

Mitigation: bootstrap requires dirty-state inspection before branch change and mandates `BLOCKED` for unrelated changes. It explicitly forbids stash/reset/clean/discard as an automatic repair strategy.

### Local branch divergence is silently destroyed

Mitigation: synchronization is fast-forward only. Rebase/reset/force-update are prohibited by the development contract.

### Prompt injection in repository files changes the target

Residual risk remains because Codex must read repository instructions. Mitigation is to pin the immutable outer identity (workspace/remote/branch/task) and prohibit changes to it even if repository content asks otherwise. Repository governance and outer sandbox controls remain necessary.

### Task path traversal

Mitigation: `task_id` is a conservative token and the Bridge derives `tasks/<task_id>.md`; slash/path traversal values are rejected.

### Git-ref injection

Mitigation: work branches reject whitespace/control characters and dangerous ref constructs. Bridge does not interpolate them into shell commands.

### Secret leakage through inherited environment

Mitigation: development forwards only the base allowlist plus proxy variables and `SSH_AUTH_SOCK`; `OPENAI_API_KEY`, `GH_TOKEN`, and `GITHUB_TOKEN` are not forwarded by default.

Residual risk: secrets readable from HOME, mounted files, SSH agent, credential helpers, Codex state, repository files or other OS-readable paths remain available to the development process.

### Network exfiltration

Readonly tasks have network disabled. Development tasks intentionally have network enabled because dependency access and Git push may require it. The outer sandbox/network policy must therefore restrict destinations when stronger control is needed.

### Force push or merge bypasses governance

Mitigation: bootstrap/development continuation explicitly prohibit force push and PR merge. Protected-branch/ruleset enforcement should remain the hard external control.

## Out of scope guarantees

Engineering Bridge does not claim that trusted development is safe on an unrestricted host. It does not implement kernel-level isolation, network egress filtering, secret scanning, branch protection, GitHub authorization policy, dependency sandboxing or malware detection. Those controls belong to the surrounding development environment and repository platform.
