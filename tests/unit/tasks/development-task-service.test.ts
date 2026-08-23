import assert from "node:assert/strict";
import test from "node:test";

import type { Executor, ExecutorRequest } from "../../../src/executors/executor.js";
import {
  COMPLETION_RECEIPT_CLOSE,
  COMPLETION_RECEIPT_OPEN
} from "../../../src/tasks/development-completion-receipt.js";
import { RegisteredWorkspaceTaskService } from "../../../src/tasks/registered-workspace-task-service.js";
import { RegisteredWorkspaceRegistry } from "../../../src/workspaces/registered-workspace-registry.js";

const ROOT = "/registered/root";

async function waitForReview(service: RegisteredWorkspaceTaskService, taskId: string): Promise<void> {
  while (["queued", "running"].includes(service.taskView(taskId)?.state ?? "")) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function completionOutput(
  taskId: string,
  workBranch: string,
  summary: string,
  headCommit: string,
  outcome: "success" | "blocked" = "success"
): string {
  return `Human summary: ${summary}\n\n${COMPLETION_RECEIPT_OPEN}\n${JSON.stringify({
    protocol_version: 1,
    task_id: taskId,
    work_branch: workBranch,
    outcome,
    summary,
    head_commit: headCommit,
    validations: [{ name: "focused tests", status: "passed" }],
    blockers: outcome === "blocked" ? ["Supervisor review required."] : []
  })}\n${COMPLETION_RECEIPT_CLOSE}`;
}

test("development tasks fix Codex, identity, and development execution mode", async () => {
  const requests: ExecutorRequest[] = [];
  const factoryCalls: Array<{ executor: string; root: string }> = [];
  const executor: Executor = {
    execute: async (request) => {
      requests.push(request);
      return { kind: "completed", output: "done", threadId: "thread-1" };
    }
  };
  const registry = new RegisteredWorkspaceRegistry([
    {
      id: "dev",
      root: ROOT,
      allow_development: true,
      development_remote: "origin"
    }
  ]);
  const service = new RegisteredWorkspaceTaskService(registry, (executorName, root) => {
    factoryCalls.push({ executor: executorName, root });
    return executor;
  });

  const { taskId } = service.startDevelopmentTask({
    workspace_id: "dev",
    work_branch: "feature/example",
    task_id: "DEV-001"
  });
  await waitForReview(service, taskId);

  assert.deepEqual(factoryCalls, [{ executor: "codex", root: ROOT }]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.executionMode, "development");
  assert.equal(requests[0]?.sandbox, undefined);
  assert.equal(requests[0]?.instruction.includes("Remote: origin"), true);
  assert.equal(requests[0]?.instruction.includes("Work branch: feature/example"), true);
  assert.equal(requests[0]?.instruction.includes("Task contract: tasks/DEV-001.md"), true);

  assert.deepEqual(service.taskView(taskId), {
    taskId,
    state: "waiting_for_supervisor_review",
    executor: "codex",
    taskKind: "development",
    workspaceId: "dev",
    workBranch: "feature/example",
    taskContract: "tasks/DEV-001.md",
    evidence: [],
    threadId: "thread-1",
    ready: true,
    review_output: "done",
    completion_receipt: { status: "missing" }
  });
});

test("development task preserves review output and exposes a valid success receipt", async () => {
  const taskIdValue = "DEV-004";
  const branch = "feature/receipt";
  const output = completionOutput(taskIdValue, branch, "Implemented receipt support.", "0123456789abcdef0123456789abcdef01234567");
  const executor: Executor = { execute: async () => ({ kind: "completed", output, threadId: "thread-receipt" }) };
  const registry = new RegisteredWorkspaceRegistry([
    { id: "dev", root: ROOT, allow_development: true, development_remote: "origin" }
  ]);
  const service = new RegisteredWorkspaceTaskService(registry, () => executor);
  const { taskId } = service.startDevelopmentTask({ workspace_id: "dev", work_branch: branch, task_id: taskIdValue });

  await waitForReview(service, taskId);

  assert.deepEqual(service.taskView(taskId)?.completion_receipt, {
    status: "valid",
    receipt: {
      protocol_version: 1,
      task_id: taskIdValue,
      work_branch: branch,
      outcome: "success",
      summary: "Implemented receipt support.",
      head_commit: "0123456789abcdef0123456789abcdef01234567",
      validations: [{ name: "focused tests", status: "passed" }],
      blockers: []
    }
  });
  assert.equal(service.taskView(taskId)?.review_output, output);
  assert.equal(service.taskView(taskId)?.state, "waiting_for_supervisor_review");
});

test("invalid development receipts do not turn a completed Codex turn into a failed task", async () => {
  const invalidOutput = completionOutput("WRONG-TASK", "feature/receipt", "Completed with an invalid identity.", "0123456789abcdef0123456789abcdef01234567");
  const executor: Executor = { execute: async () => ({ kind: "completed", output: invalidOutput }) };
  const registry = new RegisteredWorkspaceRegistry([
    { id: "dev", root: ROOT, allow_development: true, development_remote: "origin" }
  ]);
  const service = new RegisteredWorkspaceTaskService(registry, () => executor);
  const { taskId } = service.startDevelopmentTask({ workspace_id: "dev", work_branch: "feature/receipt", task_id: "DEV-005" });

  await waitForReview(service, taskId);

  assert.equal(service.taskView(taskId)?.state, "waiting_for_supervisor_review");
  assert.deepEqual(service.taskView(taskId)?.completion_receipt, { status: "invalid" });
  assert.equal(service.taskView(taskId)?.review_output, invalidOutput);
});

test("blocked receipts are valid development completion receipts", async () => {
  const taskIdValue = "DEV-006";
  const branch = "feature/blocked-receipt";
  const output = completionOutput(taskIdValue, branch, "Stopped during bootstrap.", "0123456789abcdef0123456789abcdef01234567", "blocked");
  const executor: Executor = { execute: async () => ({ kind: "completed", output }) };
  const registry = new RegisteredWorkspaceRegistry([
    { id: "dev", root: ROOT, allow_development: true, development_remote: "origin" }
  ]);
  const service = new RegisteredWorkspaceTaskService(registry, () => executor);
  const { taskId } = service.startDevelopmentTask({ workspace_id: "dev", work_branch: branch, task_id: taskIdValue });

  await waitForReview(service, taskId);

  assert.equal(service.taskView(taskId)?.state, "waiting_for_supervisor_review");
  assert.equal(service.taskView(taskId)?.completion_receipt?.status, "valid");
  const view = service.taskView(taskId);
  assert.ok(view?.completion_receipt && view.completion_receipt.status === "valid");
  if (view?.completion_receipt?.status === "valid") assert.equal(view.completion_receipt.receipt.outcome, "blocked");
});

test("development continue preserves task identity, mode, and native thread", async () => {
  const requests: ExecutorRequest[] = [];
  const executor: Executor = {
    execute: async (request) => {
      requests.push(request);
      return { kind: "completed", output: "done", threadId: "thread-1" };
    }
  };
  const registry = new RegisteredWorkspaceRegistry([
    {
      id: "dev",
      root: ROOT,
      allow_development: true,
      development_remote: "origin"
    }
  ]);
  const service = new RegisteredWorkspaceTaskService(registry, () => executor);
  const { taskId } = service.startDevelopmentTask({
    workspace_id: "dev",
    work_branch: "fix/example",
    task_id: "DEV-002"
  });
  await waitForReview(service, taskId);

  await service.controlTask(taskId, "continue", "Fix the failing test only.");
  await waitForReview(service, taskId);

  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map(({ executionMode }) => executionMode), ["development", "development"]);
  assert.deepEqual(requests.map(({ threadId }) => threadId), [undefined, "thread-1"]);
  assert.equal(requests[1]?.instruction.includes("SAME approved formal development task"), true);
  assert.equal(requests[1]?.instruction.includes("Remote: origin"), true);
  assert.equal(requests[1]?.instruction.includes("Work branch: fix/example"), true);
  assert.equal(requests[1]?.instruction.includes("Task contract: tasks/DEV-002.md"), true);
  assert.equal(requests[1]?.instruction.includes("Fix the failing test only."), true);
  assert.equal(service.taskView(taskId)?.workBranch, "fix/example");
  assert.equal(service.taskView(taskId)?.taskContract, "tasks/DEV-002.md");
});

test("development continue clears the prior receipt and replaces it with the next completed turn", async () => {
  const taskIdValue = "DEV-007";
  const branch = "feature/multiple-rounds";
  let round = 0;
  const outputs = [
    completionOutput(taskIdValue, branch, "First delivery round.", "0123456789abcdef0123456789abcdef01234567"),
    completionOutput(taskIdValue, branch, "Second delivery round.", "fedcba9876543210fedcba9876543210fedcba98")
  ];
  const requests: ExecutorRequest[] = [];
  const executor: Executor = {
    execute: async (request) => {
      requests.push(request);
      return { kind: "completed", output: outputs[round++]!, threadId: "thread-rounds" };
    }
  };
  const registry = new RegisteredWorkspaceRegistry([
    { id: "dev", root: ROOT, allow_development: true, development_remote: "origin" }
  ]);
  const service = new RegisteredWorkspaceTaskService(registry, () => executor);
  const { taskId } = service.startDevelopmentTask({ workspace_id: "dev", work_branch: branch, task_id: taskIdValue });

  await waitForReview(service, taskId);
  assert.equal(service.taskView(taskId)?.completion_receipt?.status, "valid");

  const queued = await service.controlTask(taskId, "continue", "Address the supervisor review.");
  assert.equal("completion_receipt" in queued, false);
  await waitForReview(service, taskId);

  const view = service.taskView(taskId);
  assert.equal(view?.state, "waiting_for_supervisor_review");
  assert.equal(view?.review_output, outputs[1]);
  assert.ok(view?.completion_receipt && view.completion_receipt.status === "valid");
  if (view?.completion_receipt?.status === "valid") {
    assert.equal(view.completion_receipt.receipt.summary, "Second delivery round.");
    assert.equal(view.completion_receipt.receipt.head_commit, "fedcba9876543210fedcba9876543210fedcba98");
  }
  assert.equal(requests[1]?.threadId, "thread-rounds");
  assert.equal(view?.workBranch, branch);
  assert.equal(view?.taskContract, `tasks/${taskIdValue}.md`);
});

test("development steer wraps supervisor feedback with immutable identity", async () => {
  let steered = "";
  let resolveExecution!: (value: { kind: "completed"; output: string; threadId: string }) => void;
  const execution = new Promise<{ kind: "completed"; output: string; threadId: string }>((resolve) => {
    resolveExecution = resolve;
  });
  const executor: Executor = {
    execute: async () => execution,
    steer: async (instruction) => { steered = instruction; }
  };
  const registry = new RegisteredWorkspaceRegistry([
    {
      id: "dev",
      root: ROOT,
      allow_development: true,
      development_remote: "origin"
    }
  ]);
  const service = new RegisteredWorkspaceTaskService(registry, () => executor);
  const { taskId } = service.startDevelopmentTask({
    workspace_id: "dev",
    work_branch: "feature/example",
    task_id: "DEV-003"
  });

  while (service.taskView(taskId)?.state !== "running") {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  await service.controlTask(taskId, "steer", "Do not touch documentation yet.");
  assert.equal(steered.includes("DEV-003"), true);
  assert.equal(steered.includes("origin/feature/example"), true);
  assert.equal(steered.includes("Do not touch documentation yet."), true);
  assert.equal(steered.includes("Do not change task, branch, remote"), true);

  resolveExecution({ kind: "completed", output: "done", threadId: "thread-1" });
  await waitForReview(service, taskId);
});
