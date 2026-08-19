import assert from "node:assert/strict";
import test from "node:test";

import type { Executor, ExecutorRequest } from "../../../src/executors/executor.js";
import { RegisteredWorkspaceTaskService } from "../../../src/tasks/registered-workspace-task-service.js";
import { RegisteredWorkspaceRegistry } from "../../../src/workspaces/registered-workspace-registry.js";

const ROOT = "/registered/root";

async function waitForReview(service: RegisteredWorkspaceTaskService, taskId: string): Promise<void> {
  while (["queued", "running"].includes(service.taskView(taskId)?.state ?? "")) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
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
    review_output: "done"
  });
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
