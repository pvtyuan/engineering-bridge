import assert from "node:assert/strict";
import test from "node:test";

import type { Executor, ExecutorEvidence, ExecutorRequest, ExecutorResult } from "../../../src/executors/executor.js";
import {
  COMPLETION_RECEIPT_CLOSE,
  COMPLETION_RECEIPT_OPEN
} from "../../../src/tasks/development-completion-receipt.js";
import { RegisteredWorkspaceTaskService } from "../../../src/tasks/registered-workspace-task-service.js";
import { RegisteredWorkspaceRegistry } from "../../../src/workspaces/registered-workspace-registry.js";

const ROOT = "/registered/root";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function waitForRequest(requests: readonly ExecutorRequest[], count: number): Promise<void> {
  while (requests.length < count) await new Promise<void>((resolve) => setImmediate(resolve));
}

function completionOutput(taskId: string, workBranch: string, summary: string, headCommit: string): string {
  return [
    `Human-readable review: ${summary}`,
    "",
    COMPLETION_RECEIPT_OPEN,
    JSON.stringify({
      protocol_version: 1,
      task_id: taskId,
      work_branch: workBranch,
      outcome: "success",
      summary,
      head_commit: headCommit,
      validations: [{ name: "lifecycle test", status: "passed" }],
      blockers: []
    }),
    COMPLETION_RECEIPT_CLOSE
  ].join("\n");
}

function evidence(id: string): ExecutorEvidence {
  return { id, type: "commandExecution", status: "completed", command: `command-${id}` };
}

function developmentRegistry(): RegisteredWorkspaceRegistry {
  return new RegisteredWorkspaceRegistry([{
    id: "dev",
    root: ROOT,
    allow_development: true,
    development_remote: "origin"
  }]);
}

test("integrates development review, continue, and accept on one task with current-round evidence", async () => {
  const taskIdValue = "DEV-EB-SUPERVISOR-003-INTEGRATED";
  const workBranch = "feature/supervised-task-lifecycle";
  const firstRound = deferred<ExecutorResult>();
  const secondRound = deferred<ExecutorResult>();
  const requests: ExecutorRequest[] = [];
  let round = 0;
  const firstEvidence = evidence("first-round");
  const secondEvidence = evidence("second-round");
  const executor: Executor = {
    execute: async (request) => {
      requests.push(request);
      if (round === 0) {
        request.onOutput?.("First-round Codex progress");
        request.onEvidence?.([firstEvidence]);
        round += 1;
        return firstRound.promise;
      }
      request.onOutput?.("Second-round Codex progress");
      request.onEvidence?.([secondEvidence]);
      round += 1;
      return secondRound.promise;
    }
  };
  const service = new RegisteredWorkspaceTaskService(developmentRegistry(), () => executor);

  const { taskId: runtimeTaskId } = service.startDevelopmentTask({
    workspace_id: "dev",
    work_branch: workBranch,
    task_id: taskIdValue
  });
  assert.equal(service.taskView(runtimeTaskId)?.state, "queued");

  const firstWaiter = service.waitForReady(runtimeTaskId, 1_000);
  const secondFirstRoundWaiter = service.waitForReady(runtimeTaskId, 1_000);
  await waitForRequest(requests, 1);
  assert.equal(service.taskView(runtimeTaskId)?.state, "running");
  assert.equal(service.taskView(runtimeTaskId)?.live_output, "First-round Codex progress");
  assert.deepEqual(service.taskView(runtimeTaskId)?.evidence, [firstEvidence]);

  const firstOutput = completionOutput(taskIdValue, workBranch, "First delivery round.", "first-head");
  firstRound.resolve({ kind: "completed", output: firstOutput, threadId: "thread-supervised" });
  const [firstView, firstViewFromSecondWaiter] = await Promise.all([firstWaiter, secondFirstRoundWaiter]);
  assert.deepEqual(firstViewFromSecondWaiter, firstView);
  assert.equal(firstView?.taskId, runtimeTaskId);
  assert.equal(firstView?.state, "waiting_for_supervisor_review");
  assert.equal(firstView?.ready, true);
  assert.equal(firstView?.workspaceId, "dev");
  assert.equal(firstView?.workBranch, workBranch);
  assert.equal(firstView?.taskContract, `tasks/${taskIdValue}.md`);
  assert.equal(firstView?.threadId, "thread-supervised");
  assert.equal(firstView?.review_output, firstOutput);
  assert.equal(firstView?.live_output, "First-round Codex progress");
  assert.deepEqual(firstView?.evidence, [firstEvidence]);
  assert.equal(firstView?.completion_receipt?.status, "valid");
  if (firstView?.completion_receipt?.status === "valid") {
    assert.equal(firstView.completion_receipt.receipt.summary, "First delivery round.");
    assert.equal(firstView.completion_receipt.receipt.head_commit, "first-head");
  }
  assert.equal(requests[0]?.executionMode, "development");
  assert.equal(requests[0]?.threadId, undefined);
  assert.equal(requests[0]?.instruction.includes("Remote: origin"), true);
  assert.equal(requests[0]?.instruction.includes(`Work branch: ${workBranch}`), true);
  assert.equal(requests[0]?.instruction.includes(`Task contract: tasks/${taskIdValue}.md`), true);

  const queued = await service.controlTask(runtimeTaskId, "continue", "Address the first review.");
  assert.equal(queued.taskId, runtimeTaskId);
  assert.equal(queued.state, "queued");
  assert.equal(queued.workspaceId, "dev");
  assert.equal(queued.workBranch, workBranch);
  assert.equal(queued.taskContract, `tasks/${taskIdValue}.md`);
  assert.equal("completion_receipt" in queued, false);
  assert.equal("live_output" in queued, false);
  assert.deepEqual(queued.evidence, []);

  const secondWaiter = service.waitForReady(runtimeTaskId, 1_000);
  await waitForRequest(requests, 2);
  assert.equal(service.taskView(runtimeTaskId)?.state, "running");
  assert.equal(service.taskView(runtimeTaskId)?.live_output, "Second-round Codex progress");
  assert.deepEqual(service.taskView(runtimeTaskId)?.evidence, [secondEvidence]);

  const secondOutput = completionOutput(taskIdValue, workBranch, "Second delivery round.", "second-head");
  secondRound.resolve({ kind: "completed", output: secondOutput, threadId: "thread-supervised" });
  const secondView = await secondWaiter;
  assert.equal(secondView?.taskId, runtimeTaskId);
  assert.equal(secondView?.state, "waiting_for_supervisor_review");
  assert.equal(secondView?.workspaceId, "dev");
  assert.equal(secondView?.workBranch, workBranch);
  assert.equal(secondView?.taskContract, `tasks/${taskIdValue}.md`);
  assert.equal(secondView?.threadId, "thread-supervised");
  assert.equal(secondView?.review_output, secondOutput);
  assert.equal(secondView?.live_output, "Second-round Codex progress");
  assert.deepEqual(secondView?.evidence, [secondEvidence]);
  assert.equal(secondView?.completion_receipt?.status, "valid");
  if (secondView?.completion_receipt?.status === "valid") {
    assert.equal(secondView.completion_receipt.receipt.summary, "Second delivery round.");
    assert.equal(secondView.completion_receipt.receipt.head_commit, "second-head");
  }
  assert.equal(requests.length, 2);
  assert.equal(requests[1]?.executionMode, "development");
  assert.equal(requests[1]?.threadId, "thread-supervised");
  assert.equal(requests[1]?.instruction.includes("Remote: origin"), true);
  assert.equal(requests[1]?.instruction.includes(`Work branch: ${workBranch}`), true);
  assert.equal(requests[1]?.instruction.includes(`Task contract: tasks/${taskIdValue}.md`), true);
  assert.equal(requests[1]?.instruction.includes("Address the first review."), true);

  const accepted = await service.controlTask(runtimeTaskId, "accept");
  assert.equal(accepted.taskId, runtimeTaskId);
  assert.equal(accepted.state, "completed");
  assert.equal(accepted.ready, true);
  assert.equal(accepted.output, secondOutput);
  assert.equal(accepted.review_output, secondOutput);
  assert.equal(accepted.workspaceId, "dev");
  assert.equal(accepted.workBranch, workBranch);
  assert.equal(accepted.taskContract, `tasks/${taskIdValue}.md`);
  assert.equal(accepted.threadId, "thread-supervised");
  assert.equal(accepted.live_output, "Second-round Codex progress");
  assert.deepEqual(accepted.evidence, [secondEvidence]);
  assert.equal(accepted.completion_receipt?.status, "valid");
  if (accepted.completion_receipt?.status === "valid") {
    assert.equal(accepted.completion_receipt.receipt.head_commit, "second-head");
  }
});

test("continuation failure cannot expose the prior receipt or live/evidence snapshots", async () => {
  const taskIdValue = "DEV-EB-SUPERVISOR-003-FAILURE";
  const workBranch = "feature/supervised-task-lifecycle";
  const firstRound = deferred<ExecutorResult>();
  const secondRound = deferred<ExecutorResult>();
  const requests: ExecutorRequest[] = [];
  let round = 0;
  const priorEvidence = evidence("prior-round");
  const executor: Executor = {
    execute: async (request) => {
      requests.push(request);
      if (round === 0) {
        request.onOutput?.("Prior-round progress");
        request.onEvidence?.([priorEvidence]);
        round += 1;
        return firstRound.promise;
      }
      round += 1;
      return secondRound.promise;
    }
  };
  const service = new RegisteredWorkspaceTaskService(developmentRegistry(), () => executor);
  const { taskId: runtimeTaskId } = service.startDevelopmentTask({
    workspace_id: "dev",
    work_branch: workBranch,
    task_id: taskIdValue
  });

  const firstWaiter = service.waitForReady(runtimeTaskId, 1_000);
  await waitForRequest(requests, 1);
  firstRound.resolve({
    kind: "completed",
    output: completionOutput(taskIdValue, workBranch, "Prior delivery round.", "prior-head"),
    threadId: "thread-failure"
  });
  const firstView = await firstWaiter;
  assert.equal(firstView?.state, "waiting_for_supervisor_review");
  assert.equal(firstView?.completion_receipt?.status, "valid");
  assert.equal(firstView?.live_output, "Prior-round progress");
  assert.deepEqual(firstView?.evidence, [priorEvidence]);

  const queued = await service.controlTask(runtimeTaskId, "continue", "The next round should fail.");
  assert.equal(queued.state, "queued");
  assert.equal("completion_receipt" in queued, false);
  assert.equal("live_output" in queued, false);
  assert.deepEqual(queued.evidence, []);

  const failureWaiter = service.waitForReady(runtimeTaskId, 1_000);
  await waitForRequest(requests, 2);
  secondRound.resolve({
    kind: "failed",
    threadId: "thread-failure",
    evidence: [],
    error: { code: "CODEX_EXECUTION_FAILED", message: "Codex execution failed." }
  });
  const failed = await failureWaiter;

  assert.equal(failed?.taskId, runtimeTaskId);
  assert.equal(failed?.state, "failed");
  assert.equal(failed?.ready, true);
  assert.equal(failed?.workspaceId, "dev");
  assert.equal(failed?.workBranch, workBranch);
  assert.equal(failed?.taskContract, `tasks/${taskIdValue}.md`);
  assert.equal(failed?.threadId, "thread-failure");
  assert.equal("completion_receipt" in (failed ?? {}), false);
  assert.equal("review_output" in (failed ?? {}), false);
  assert.equal("live_output" in (failed ?? {}), false);
  assert.deepEqual(failed?.evidence, []);
  assert.deepEqual(failed?.error, {
    code: "CODEX_EXECUTION_FAILED",
    message: "Codex execution failed."
  });
  assert.equal((service as unknown as { readyWaiters: Map<unknown, unknown> }).readyWaiters.size, 0);
});
