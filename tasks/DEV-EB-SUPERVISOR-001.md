# DEV-EB-SUPERVISOR-001 — Completion Receipt Protocol

## Objective

Add a structured completion receipt protocol for trusted development tasks so that Engineering Bridge exposes both the human-readable Codex final output and a machine-readable receipt for ChatGPT Supervisor review.

This task is the first implementation slice of the confirmed v2.1.0 — Supervised Task Completion design.

## Trusted Task Identity

- workspace_id: engineering-bridge
- work_branch: feature/supervised-completion-receipt
- task_id: DEV-EB-SUPERVISOR-001
- executor: codex

## Required References

Read these before implementation:

- `src/tasks/development-task-instruction.ts`
- `src/tasks/registered-workspace-task-service.ts`
- `src/mcp-stdio.ts`
- `src/executors/codex-executor.ts`
- relevant unit tests under `tests/`
- `README.md`
- `RELEASE_NOTES.md`

## Scope

Implement only Completion Receipt Protocol support. Do not implement task-result long polling in this task.

### 1. Development instruction protocol

Extend trusted development start/continue instructions so Codex is required to finish a completed development turn with a machine-readable receipt block after the human-readable summary.

Use a stable delimiter such as:

```text
<engineering_bridge_receipt>
{...json...}
</engineering_bridge_receipt>
```

The receipt payload must use protocol version 1 and include:

- `protocol_version`: `1`
- `task_id`
- `work_branch`
- `outcome`: `success | blocked`
- `summary`
- `head_commit` when available
- `pr_url` when available
- `report_path` when applicable
- `validations`: array of `{ name, status }`
- `blockers`: array of strings

`head_commit` means the current work-branch HEAD for the latest delivery round. Do not use the term `final_commit`.

### 2. Parser and validation

Add a focused module, preferably `src/tasks/development-completion-receipt.ts`, that owns:

- receipt TypeScript types
- parsing from Codex final output
- validation
- status classification: `valid | missing | invalid`

Validation must at minimum verify:

- JSON is syntactically valid
- required fields are present
- `protocol_version === 1`
- `task_id` equals the trusted task identity
- `work_branch` equals the trusted task identity

Do not turn receipt parse/validation failure into execution failure.

### 3. Task runtime state

For development tasks, when Codex returns a completed turn:

- preserve the full original final message as `review_output`
- parse and store the latest completion receipt separately
- expose receipt state in `ControlledTaskView`
- expose it through `task_result`

Required shape:

```json
{
  "completion_receipt": {
    "status": "valid | missing | invalid",
    "receipt": { }
  }
}
```

For `missing` or `invalid`, omit `receipt` if there is no validated payload. It is acceptable to expose a safe validation reason if useful, but do not leak credentials or raw internal exceptions.

### 4. Continue semantics

`control_task(action="continue")` must retain the same:

- `workspace_id`
- `remote`
- `work_branch`
- `task_id`
- Task Contract
- PR branch identity

A Task may contain multiple commits.

Before starting the next development turn, clear the previous current completion receipt so `task_result` while the new turn is queued/running cannot accidentally present the previous round as the current completion state.

The next completed turn replaces it with the new receipt.

Do not force-push. Continue using the same work branch and PR.

### 5. Executor boundary

Do not move this protocol into Codex transport/runtime responsibilities.

`CodexExecutor` should remain responsible for Codex app-server protocol, final agent message, thread id, and execution evidence. Completion Receipt is a trusted development-task protocol owned above the executor layer.

Avoid modifying `src/executors/codex-executor.ts` unless a small compatibility change is strictly necessary. If it is changed, explain why in the task report.

### 6. Backward compatibility

- Read-only tasks must remain unchanged.
- Existing controlled-patch flows must remain unchanged.
- Public MCP tool count must remain exactly 10.
- Existing `run_development_task`, `task_result`, and `control_task` inputs must remain compatible.
- Do not add long-poll parameters in this task; that belongs to `DEV-EB-SUPERVISOR-002`.

## Non-Goals

Do not implement:

- server-initiated async push back into ChatGPT
- durable task persistence
- Task Event Store / Completion Outbox
- new MCP tools
- Git runtime state machine duplication
- force push
- PR merge
- `task_result(wait_for=ready)` or timeout/waiter behavior

## Tests

Add or update tests covering at minimum:

- valid receipt parsing
- missing receipt
- malformed JSON receipt
- wrong `task_id`
- wrong `work_branch`
- unsupported protocol version
- `outcome=success`
- `outcome=blocked`
- development `task_result` exposes `review_output` plus `completion_receipt`
- receipt failure does not make task state `failed`
- continue clears prior current receipt
- second completed turn exposes the new receipt
- read-only regression
- controlled-patch regression where relevant
- exactly 10 public MCP tools regression

Run the repository-defined checks, including at least:

```bash
npm run typecheck
npm test
```

## Acceptance Criteria

PASS only if all of the following are true:

1. Completed development turns can return a structured protocol-v1 Completion Receipt.
2. Human-readable Codex final output remains available unchanged for Supervisor review.
3. Receipt is classified as `valid`, `missing`, or `invalid` without converting a successful Codex turn into task failure.
4. Trusted `task_id` and `work_branch` identity are validated.
5. `task_result` exposes the current completion receipt for development tasks.
6. `continue` preserves the same Task/branch identity and clears stale receipt state before the next turn.
7. Multiple commits on the same Task branch are permitted; no force push is introduced.
8. CodexExecutor responsibilities remain unchanged in substance.
9. Public MCP tool count remains exactly 10.
10. Typecheck and tests pass.

## Delivery

Implement on `feature/supervised-completion-receipt`.

A single Task may contain multiple commits. Push all commits to the same branch and create or update one PR targeting `main`.

Do not merge the PR.

At completion, report:

- implementation summary
- changed files
- test results
- current `head_commit`
- PR URL
- any blockers
- the protocol-v1 Completion Receipt block
