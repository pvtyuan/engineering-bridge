# DEV-EB-SUPERVISOR-002 — Awaitable task_result + Live Progress Snapshot

## Objective

Extend supervised task observation so ChatGPT Supervisor can efficiently wait for a task to become reviewable during an active turn, while also seeing the latest bounded Codex progress message during execution.

This task is the second implementation slice of the confirmed v2.1.0 — Supervised Task Completion design and builds directly on the accepted `DEV-EB-SUPERVISOR-001` Completion Receipt implementation.

## Trusted Task Identity

- workspace_id: engineering-bridge
- work_branch: feature/task-result-wait-ready
- task_id: DEV-EB-SUPERVISOR-002
- executor: codex

## Baseline / Dependency

This branch is intentionally based on the accepted delivery HEAD of `DEV-EB-SUPERVISOR-001`:

- parent branch: `feature/supervised-completion-receipt`
- accepted parent HEAD: `4782087ff6a0f7846ce37b212de969801c5a2e93`
- parent PR: #2

Do not drop, rewrite, or regress the Completion Receipt behavior implemented by Task 001.

If a PR is opened before PR #2 is merged, use `feature/supervised-completion-receipt` as the temporary PR base so review shows only Task 002 changes. After PR #2 merges, the PR base may be retargeted to `main` without rewriting Task 002 history.

## Required References

Read these before implementation:

- `src/mcp-stdio.ts`
- `src/tasks/registered-workspace-task-service.ts`
- `src/executors/executor.ts`
- `src/executors/codex-executor.ts`
- `src/tasks/development-completion-receipt.ts`
- `src/tasks/development-task-instruction.ts`
- relevant unit tests under `tests/unit/`
- `README.md`
- `RELEASE_NOTES.md`

## Scope

Implement bounded awaitable `task_result` behavior plus a latest-message live progress snapshot. Do not implement server push, durable persistence, or a new MCP tool.

### 1. task_result optional wait parameters

Extend the existing `task_result` MCP tool with backward-compatible optional inputs:

```json
{
  "task_id": "<runtime task id>",
  "wait_for": "ready",
  "timeout_ms": 20000,
  "include_evidence": false
}
```

Requirements:

- `wait_for` currently supports only `"ready"` when present.
- `timeout_ms` is optional and bounded to a maximum of 20000 ms.
- `include_evidence` is optional and defaults to `true` when omitted.
- Calls that provide only `task_id` must preserve the current immediate-return behavior.
- Do not add a new MCP tool.

### 2. Ready semantics

Use the existing controlled-task lifecycle semantics:

- `queued` → `ready: false`
- `running` → `ready: false`
- `waiting_for_supervisor_review` → `ready: true`
- `failed` → `ready: true`
- `completed` → `ready: true`

When `wait_for="ready"` is omitted, return immediately regardless of state.

When `wait_for="ready"` is present:

- if the task is already ready, return immediately;
- otherwise wait until the task becomes ready or timeout expires;
- unknown task handling must remain unchanged and fail/return as the existing MCP contract defines.

### 3. Promise-based waiters, no internal polling loop

Implement an in-memory waiter mechanism in the task-service layer, preferably on `RegisteredWorkspaceTaskService`.

Requirements:

- use Promise-based waiters / notifications;
- do not implement a sleep/poll loop inside Engineering Bridge;
- prevent lost wakeups between state inspection and waiter registration;
- wake relevant waiters when the task transitions to any `ready: true` state;
- clean up waiter registrations on completion, failure, timeout, and normal resolution;
- support multiple concurrent waiters for the same task safely;
- do not leak timers or waiter entries after resolution.

A service API such as `waitForReady(taskId, timeoutMs)` is acceptable.

### 4. Timeout behavior

Timeout is not task failure.

If `wait_for="ready"` times out while the task is still not ready, return the latest task snapshot with:

```json
{
  "ready": false,
  "wait_timeout": true
}
```

Do not:

- change the task state;
- interrupt Codex;
- mark the task failed;
- synthesize a task error.

If the task becomes ready before timeout, omit `wait_timeout` or return it only as `false` if the implementation needs an explicit boolean. Prefer omission on normal completion to keep responses compact.

### 5. Context-efficient evidence control

`include_evidence` controls only the `evidence` field returned by `task_result`.

Requirements:

- omitted → current behavior, include evidence;
- `true` → include evidence;
- `false` → omit `evidence` from the MCP response entirely;
- do not stop collecting internal evidence just because one request asked to omit it;
- Completion Receipt, task identity, state, errors, review output, and live output are independent of `include_evidence`.

Expected Supervisor usage:

1. bounded wait with `include_evidence=false`;
2. once ready, issue one immediate `task_result` with evidence enabled for final review if needed.

### 6. Live progress snapshot

Expose the latest bounded Codex `agentMessage` while a task is queued/running via a new optional field:

```json
{
  "live_output": "Latest Codex agent message snapshot"
}
```

Semantics:

- this is a latest snapshot, not a transcript;
- this is not token streaming;
- this does not introduce server push or streaming MCP;
- it should reflect the most recent non-empty Codex `agentMessage` observed for the current execution round;
- later agent messages replace earlier snapshots;
- use the same or stricter bounded-text policy already used by Codex transport/evidence so `task_result` cannot grow without bound;
- `include_evidence=false` must NOT suppress `live_output`;
- if no agent message has been observed yet, omit `live_output`.

### 7. Executor boundary for live output

The Codex app-server already observes `agentMessage` events. Add only the minimum upward progress seam needed to expose that latest message, for example an optional callback on `ExecutorRequest` such as `onOutput` / `onProgress`.

Requirements:

- `CodexExecutor` remains responsible only for Codex app-server transport/runtime concerns, final agent message, thread id, evidence, and forwarding progress events;
- Completion Receipt parsing remains above the executor layer exactly as implemented by Task 001;
- do not move Supervisor lifecycle logic into `CodexExecutor`;
- read-only and controlled-patch paths must remain compatible.

### 8. Task runtime state for live output

Store the latest live output on the interactive task record for the current round.

Requirements:

- expose it through `ControlledTaskView` and `task_result` while present;
- when `control_task(action="continue")` starts a new round, clear the previous round's `live_output` before queueing the next execution;
- the next round replaces it as new agent messages arrive;
- `review_output` remains the authoritative human-readable final output for a completed development turn;
- `live_output` must not replace `review_output`;
- Completion Receipt behavior from Task 001 must remain unchanged;
- interrupted/failed behavior must preserve existing `partial_output` / `error` semantics.

### 9. MCP response behavior

Examples:

Running wait timeout:

```json
{
  "task_id": "<runtime id>",
  "state": "running",
  "ready": false,
  "wait_timeout": true,
  "live_output": "Running tests..."
}
```

Ready result:

```json
{
  "task_id": "<runtime id>",
  "state": "waiting_for_supervisor_review",
  "ready": true,
  "review_output": "...",
  "completion_receipt": {
    "status": "valid",
    "receipt": {}
  }
}
```

The exact object may contain the existing identity/thread/error fields. Preserve backward compatibility.

### 10. Public API and compatibility constraints

- Public MCP tool count must remain exactly 10.
- Do not add a new tool for wait or progress.
- Existing `run_development_task`, `run_readonly_task`, `control_task`, and controlled-patch inputs remain unchanged.
- Existing Task 001 Completion Receipt output remains unchanged.
- A legacy `task_result({ task_id })` call must retain immediate semantics.
- Do not introduce persistence or change the current in-memory task runtime model.

## Non-Goals

Do not implement:

- server-initiated async push into an ended ChatGPT conversation;
- SSE/WebSocket/streaming MCP;
- token-by-token Codex streaming;
- full Codex transcript storage;
- durable task persistence;
- Task Event Store / Completion Outbox;
- a new MCP tool;
- PR merge automation;
- task-result wait durations above 20 seconds per MCP request.

## Tests

Add or update tests covering at minimum:

### Awaitable task_result

- legacy immediate `task_result({ task_id })` behavior remains unchanged;
- already-ready task returns immediately with `wait_for="ready"`;
- queued/running task resolves when transitioning to `waiting_for_supervisor_review`;
- failed task is considered ready;
- completed task is considered ready;
- timeout returns the latest snapshot with `ready=false` and `wait_timeout=true`;
- timeout does not alter task state;
- no lost wakeup if readiness changes around waiter registration;
- multiple waiters on the same task resolve correctly;
- waiter/timer cleanup after ready resolution;
- waiter/timer cleanup after timeout;
- `timeout_ms > 20000` is rejected by the MCP schema or validation layer;
- invalid `wait_for` value is rejected;
- `include_evidence` defaults to true;
- `include_evidence=false` omits evidence only.

### Live progress snapshot

- running task with no agent message omits `live_output`;
- first agent message exposes bounded `live_output`;
- later agent message replaces the previous live snapshot;
- overlong agent message is bounded/truncated;
- `include_evidence=false` still exposes `live_output`;
- `continue` clears the previous round's `live_output` before the next run;
- next-round agent messages populate a new live snapshot;
- final `review_output` remains unchanged and authoritative;
- Completion Receipt parsing/exposure from Task 001 still works.

### Regression

- read-only tasks continue to work;
- controlled-patch flows continue to work where relevant;
- steer/interrupt behavior remains compatible;
- public MCP tool count remains exactly 10;
- Task 001 receipt tests remain green.

Run repository-defined checks including at least:

```bash
npm run typecheck
npm run build
npm test
```

Also run:

```bash
git diff --check
```

## Acceptance Criteria

PASS only if all of the following are true:

1. `task_result` accepts optional `wait_for="ready"`, `timeout_ms`, and `include_evidence` without breaking legacy callers.
2. Ready-state waiting is Promise/event based, not an internal polling loop.
3. Lost wakeups are prevented and waiters/timers are cleaned up.
4. Timeout returns a non-failing latest snapshot with `wait_timeout=true`.
5. `include_evidence=false` removes only evidence from the response.
6. Running tasks can expose the latest bounded Codex `agentMessage` as `live_output`.
7. `live_output` is latest-snapshot only, not transcript or token streaming.
8. `continue` clears stale live output before the next round.
9. `review_output` and Completion Receipt semantics from Task 001 remain unchanged.
10. CodexExecutor responsibilities remain unchanged in substance except for the minimal progress callback/seam.
11. Public MCP tool count remains exactly 10.
12. Typecheck, build, tests, and `git diff --check` pass.

## Delivery

Implement on `feature/task-result-wait-ready`.

This task is stacked on the accepted Task 001 branch. Before PR #2 is merged, create/update the Task 002 PR against `feature/supervised-completion-receipt` so its diff contains only Task 002 changes. After PR #2 merges, retarget Task 002 PR to `main` without force-pushing or rewriting history.

A single Task may contain multiple commits. Push all Task 002 commits to the same branch and use one PR for the task.

Do not force push. Do not merge the PR.

At completion, report:

- implementation summary;
- changed files;
- wait/readiness design notes;
- live-output design notes;
- test results;
- current `head_commit`;
- PR URL;
- blockers;
- protocol-v1 Completion Receipt block.
