# Release Notes

## Unreleased — Supervised Lifecycle Integration

- Integrated the `run_development_task -> task_result(wait_for="ready") -> waiting_for_supervisor_review -> continue/accept` lifecycle on one runtime Task.
- `Codex completed` remains distinct from Task acceptance; Supervisor `accept` preserves the latest review output and current Completion Receipt.
- Continuation rounds keep the same workspace, configured remote, work branch, Task Contract, logical Task, PR, and reusable Codex thread when available; multiple commits are allowed and force-push/automatic merge remain prohibited.
- Each continuation starts a fresh current-round receipt, live-output snapshot, and evidence view. `task_result` waits remain bounded and non-mutating on timeout, while `include_evidence` remains request-local.
- `live_output` remains a bounded latest-message snapshot rather than transcript storage, token streaming, or server push.
- v2.1.0 still does not promise waking a ChatGPT conversation after its assistant turn ends, and in-memory task/waiter state may be lost on process restart.
- This is release preparation only; v2.1.0 is not claimed released and no external MCP E2E, canonical snapshot, version pointer update, or PR merge is performed here.

## Unreleased — Awaitable task_result and Live Progress

- `task_result` accepts bounded `wait_for: "ready"` waits with timeout snapshots while preserving legacy immediate calls.
- `include_evidence: false` omits only evidence from the response.
- Interactive tasks expose the latest bounded Codex agent message as `live_output`; continuing a task clears the prior round's snapshot.

## Unreleased — Supervised Completion Receipt

- Trusted development instructions require a protocol-v1 Completion Receipt after the human-readable final summary.
- `task_result` exposes the receipt classification separately from the unchanged `review_output`; missing or invalid receipts do not fail a completed turn.
- Continuing a development task preserves its identity and clears the previous round's current receipt before the next turn.

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
