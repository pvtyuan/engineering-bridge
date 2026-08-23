# DEV-EB-SUPERVISOR-003 — Supervised Lifecycle Integration

## Objective

Integrate and validate the complete supervised development-task lifecycle built by `DEV-EB-SUPERVISOR-001` and `DEV-EB-SUPERVISOR-002`.

This task must prove that Completion Receipt, awaitable `task_result`, `live_output`, `continue`, and `accept` work together as one coherent lifecycle without changing task identity, branch identity, or the public 10-tool MCP surface.

This is the third implementation slice of the confirmed v2.1.0 — Supervised Task Completion design.

## Trusted Task Identity

- workspace_id: engineering-bridge
- work_branch: feature/supervised-task-lifecycle
- task_id: DEV-EB-SUPERVISOR-003
- executor: codex

## Baseline / Dependency

This branch is intentionally based on the accepted delivery HEAD of `DEV-EB-SUPERVISOR-002`:

- parent branch: `feature/task-result-wait-ready`
- accepted parent HEAD: `960b4a4e07ab57982c638d083d5c00609cb70146`
- parent PR: #3
- grandparent task: `DEV-EB-SUPERVISOR-001`
- grandparent accepted HEAD: `4782087ff6a0f7846ce37b212de969801c5a2e93`
- grandparent PR: #2

Do not drop, rewrite, or regress Task 001 Completion Receipt behavior or Task 002 awaitable task-result / live-output behavior.

If a PR is opened before PR #3 is merged, use `feature/task-result-wait-ready` as the temporary PR base so review shows only Task 003 changes. After parent PRs merge, retarget the Task 003 PR toward the newest integrated base without rewriting Task 003 history or force-pushing.

## Required References

Read these before implementation:

- `tasks/DEV-EB-SUPERVISOR-001.md`
- `tasks/DEV-EB-SUPERVISOR-002.md`
- `src/tasks/registered-workspace-task-service.ts`
- `src/tasks/development-completion-receipt.ts`
- `src/tasks/development-task-instruction.ts`
- `src/executors/executor.ts`
- `src/executors/codex-executor.ts`
- `src/mcp-stdio.ts`
- relevant tests under `tests/unit/`
- `README.md`
- `README.en.md`
- `docs/tools.md`
- `RELEASE_NOTES.md`

## Scope

Focus on lifecycle integration, regression coverage, and canonical repository documentation. Do not introduce a new protocol family, durable persistence, server push, or a new MCP tool.

### 1. End-to-end supervised lifecycle integration test

Add integration-level test coverage for this lifecycle:

```text
run_development_task
  -> queued/running
  -> task_result(wait_for=ready)
  -> waiting_for_supervisor_review
  -> Supervisor decision
      -> control_task(continue)
          -> queued/running
          -> new live_output / evidence
          -> waiting_for_supervisor_review
          -> newest Completion Receipt
      -> control_task(accept)
          -> completed
```

The test must validate the lifecycle as one sequence rather than only isolated method behavior.

### 2. Identity invariants across continue

For one development task, verify that `control_task(action="continue")` preserves all trusted identity:

- same runtime task id;
- same `workspace_id`;
- same `work_branch`;
- same Task Contract path;
- same configured remote;
- same Codex thread when the executor provides a reusable thread id;
- same logical development task identity.

Do not create a new runtime task for a continuation round.

### 3. Multiple commits / same branch / same PR model

Validate and document the intended delivery semantics:

- one Task has one `work_branch`;
- one Task may produce multiple commits;
- continuation rounds remain on the same branch;
- continuation rounds use the same PR;
- no force push;
- the branch HEAD at Supervisor `accept` is the accepted delivery HEAD.

Repository tests do not need to perform a real GitHub merge, but lifecycle documentation and mocks/fixtures must reflect this model accurately.

### 4. Completion Receipt lifecycle semantics

Verify Task 001 behavior across multiple review rounds:

- first completed Codex round can produce a valid Completion Receipt;
- entering `waiting_for_supervisor_review` exposes that round's `review_output` and parsed receipt;
- `continue` clears the previous round's current receipt before the next run;
- the next completed round replaces the current receipt with the newest receipt;
- the latest receipt represents the latest delivery round only;
- `accept` preserves the current receipt and current review output in the completed task view;
- an invalid or missing receipt does not itself transform the execution into a task failure;
- trusted `task_id` and `work_branch` validation remains enforced by the receipt parser.

Do not add a receipt event store or historical receipt list in v2.1.0.

### 5. Awaitable task_result lifecycle semantics

Verify Task 002 behavior inside the supervised lifecycle:

- `task_result({task_id})` remains immediate;
- `wait_for="ready"` waits only while `ready=false`;
- `waiting_for_supervisor_review`, `failed`, and `completed` are ready states;
- timeout returns the latest non-ready snapshot with `wait_timeout=true` and does not mutate task state;
- readiness transitions wake waiters without polling loops;
- multiple waiters remain safe;
- waiter/timer cleanup remains correct;
- `include_evidence=false` suppresses only the evidence field;
- after a ready result, an immediate result can still retrieve evidence when requested.

### 6. live_output lifecycle semantics

Verify `live_output` as part of the same multi-round flow:

- latest non-empty Codex `agentMessage` is exposed while present;
- `live_output` is bounded;
- newer messages replace older snapshots;
- `include_evidence=false` does not suppress `live_output`;
- `continue` clears stale live output before the next execution round;
- next-round messages create a new live-output snapshot;
- `live_output` never replaces `review_output` as the authoritative completed-turn human-readable output.

Do not introduce transcript persistence, token streaming, SSE, WebSocket, or server-initiated push.

### 7. Failure / interrupt lifecycle regression

Cover at minimum:

- executor failure transitions to `failed` and is immediately ready;
- interrupt retains existing safe `partial_output` / error semantics;
- waiters are released on failure;
- no stale receipt from a prior reviewed round is presented as the current round after a continuation failure;
- no stale live output from a prior round survives `continue` before new progress is emitted.

### 8. steer regression

Verify current steer behavior remains compatible:

- steer is allowed only for a running interactive task according to existing rules;
- steer does not change trusted task identity;
- steer does not create a second runtime task;
- steer does not change branch or Task Contract identity.

Do not redesign steer in this task.

### 9. Public MCP API regression

The public MCP surface must remain exactly 10 tools.

Validate that existing tools remain compatible:

1. `run_readonly_task`
2. `run_development_task`
3. `task_result`
4. `control_task`
5. `bind_project`
6. `create_project`
7. `authorize_workspace_write`
8. `generate_controlled_patch`
9. `refine_controlled_patch`
10. `apply_controlled_patch`

Do not add an 11th tool.

### 10. Read-only and controlled-patch regression

Keep non-development workflows green:

- read-only task execution;
- read-only task result behavior;
- controlled patch generation;
- controlled patch refinement;
- controlled patch apply behavior;
- existing safety / write authorization behavior.

Do not broaden development semantics into these paths unnecessarily.

### 11. Documentation integration

Update canonical repository documentation so a maintainer can understand the completed v2.1.0 supervised lifecycle without reconstructing it from Task Contracts.

At minimum review/update where appropriate:

- `README.md`
- `README.en.md`
- `docs/tools.md`
- `RELEASE_NOTES.md`

Document:

- `Codex completed != Task completed`;
- `waiting_for_supervisor_review` as the review gate;
- Supervisor `continue` and `accept` semantics;
- Completion Receipt purpose and trust boundary;
- `task_result(wait_for="ready")` and bounded timeout behavior;
- `include_evidence` behavior;
- `live_output` semantics and limitations;
- same-task / same-branch / same-PR continuation model;
- Active-Turn Supervisor limitation: v2.1.0 does not promise that Engineering Bridge can wake a ChatGPT conversation after the assistant turn has already ended;
- runtime task/waiter state remains in-memory in v2.1.0 and may be lost on process restart.

### 12. v2.1.0 release preparation only

Prepare repository-facing documentation/tests so the codebase is ready for the real external MCP E2E and later v2.1.0 release process.

Do NOT in this task:

- change the Google Drive `Current version` pointer;
- claim v2.1.0 is released;
- create the `ai-dev/v2.1.0` canonical snapshot;
- perform the final real ChatGPT -> Secure MCP Tunnel -> Engineering Bridge -> Codex -> GitHub E2E;
- merge PRs automatically.

The real external E2E is a separate post-implementation acceptance step performed after Task 003 is reviewed/accepted and the integrated code is deployed/reloaded.

## Non-Goals

Do not implement:

- durable task persistence;
- Task Event Store;
- Completion Outbox;
- asynchronous server push to an ended ChatGPT conversation;
- SSE/WebSocket/streaming MCP;
- token-by-token Codex streaming;
- full transcript storage;
- new MCP tools;
- automatic PR merge;
- automatic version release;
- receipt history storage;
- branch rewriting or force push.

## Tests

Add or update tests covering at minimum:

### Integrated lifecycle

- start development task -> running -> waiting_for_supervisor_review;
- first review output and first valid receipt visible;
- continue preserves the same runtime task id and trusted identity;
- continue clears previous receipt and live output before the next round;
- second execution round populates new live output;
- second completion exposes new review output and newest receipt;
- accept transitions the same runtime task to `completed`;
- completed view preserves the accepted latest receipt/output.

### Awaitable result integration

- waiter created while running resolves on `waiting_for_supervisor_review`;
- waiter created during continuation resolves on second review state;
- wait timeout is non-mutating;
- failed and completed states are ready;
- evidence omission is request-local only;
- no waiter/timer leaks.

### Identity and control integration

- same `workspace_id` across continue;
- same `work_branch` across continue;
- same Task Contract across continue;
- same runtime task id across continue;
- same thread id when supplied by executor;
- steer retains identity;
- interrupt retains expected failure/partial-output semantics.

### Regression

- Completion Receipt valid/missing/invalid tests remain green;
- live-output tests remain green;
- read-only tasks remain green;
- controlled-patch flows remain green;
- public MCP tool count remains exactly 10.

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

1. A single integrated test demonstrates `run -> wait/review -> continue -> wait/review -> accept -> completed` on one runtime task.
2. Continue preserves the same runtime task, workspace, branch, Task Contract, and applicable thread identity.
3. Completion Receipt is current-round state: cleared on continue and replaced by the newest completed round.
4. `live_output` is cleared on continue and repopulated by the next round.
5. Awaitable `task_result` integrates correctly with both first-run and continuation readiness transitions.
6. Timeout remains non-mutating and waiter/timer cleanup is verified.
7. Failure/interrupt/steer behavior remains compatible.
8. Read-only and controlled-patch regressions remain green.
9. Public MCP tool count remains exactly 10.
10. Repository docs explain the full supervised lifecycle and its v2.1.0 limitations.
11. No persistence/server-push/new-tool/release behavior is introduced.
12. Typecheck, build, tests, and `git diff --check` pass.

## Delivery

Implement on `feature/supervised-task-lifecycle`.

This task is stacked on the accepted Task 002 branch. Before PR #3 is merged, create/update the Task 003 PR against `feature/task-result-wait-ready` so its diff contains only Task 003 changes. As parent PRs merge, retarget the Task 003 PR toward the newest integrated base without force-pushing or rewriting history.

A single Task may contain multiple commits. Push all Task 003 commits to the same branch and use one PR for the task.

Do not force push. Do not merge the PR.

At completion, report:

- implementation summary;
- changed files;
- integrated lifecycle design notes;
- identity-preservation evidence;
- Completion Receipt multi-round behavior;
- awaitable task_result / live_output integration notes;
- regression results;
- current `head_commit`;
- PR URL;
- blockers;
- protocol-v1 Completion Receipt block.
