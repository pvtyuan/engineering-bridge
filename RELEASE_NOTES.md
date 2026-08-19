# Release Notes

## 2.0.0 — Trusted Development

V2 introduces an explicitly authorized formal-development path while preserving the read-only and controlled-patch security models.

### Breaking MCP change

- `run_task` is removed.
- `run_readonly_task` replaces the old generic supervised task entry point.
- `run_development_task(workspace_id, work_branch, task_id)` is added.
- The public MCP surface now contains 10 tools.

The old name is intentionally not kept as an alias because tool metadata is part of supervisor routing: a generic `run_task` name would blur the distinction between analysis and privileged development.

### Trusted development authorization

Manual workspace entries may add:

```json
{
  "allow_development": true,
  "development_remote": "origin"
}
```

`development_remote` is mandatory when development is enabled. Managed workspaces cannot receive development permission, and `authorize_workspace_write` remains limited to controlled-patch APPLY.

### Formal Task Contract handoff

`run_development_task` fixes an immutable identity consisting of workspace, locally configured remote, work branch, task id and `tasks/<task-id>.md`. Development is Codex-only.

The generated bootstrap contract requires clean-state inspection, exact remote/branch fetch and switch, fast-forward-only synchronization, Task Contract and `AGENTS.md` loading, Required References, repository Preflight, fail-closed behavior on unknown dirty/diverged state, no force push and no PR merge.

`continue` and `steer` retain the same identity and native Codex thread when available.

### Codex execution policy

Readonly behavior remains read-only with network disabled.

Development uses:

```text
thread sandbox: danger-full-access
turn sandboxPolicy: externalSandbox
networkAccess: enabled
approvalPolicy: never
```

The outer development container/OS sandbox is therefore the security boundary for formal development.

Development additionally forwards proxy variables and `SSH_AUTH_SOCK`. `OPENAI_API_KEY`, `GH_TOKEN` and `GITHUB_TOKEN` remain outside the default Codex environment allowlist.

### Tests and docs

V2 adds coverage for:

- exact MCP tool surface and removal of `run_task`;
- development workspace authorization and managed-workspace non-escalation;
- branch/task/remote validation;
- bootstrap contract content;
- development task identity across continue/steer;
- Codex `danger-full-access` + `externalSandbox` wire mapping;
- development environment forwarding and token stripping;
- readonly regression behavior.

Documentation was rewritten around the three execution paths: read-only supervision, controlled patch, and trusted development.

## Previous upstream history

This fork was based on the upstream V1.2.1 line. Consult the upstream repository/tags for detailed V1 release history.
