import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDevelopmentContinuationInstruction,
  buildDevelopmentStartInstruction,
  isSafeRemoteName,
  isSafeTaskId,
  isSafeWorkBranch,
  taskContractPath
} from "../../../src/tasks/development-task-instruction.js";

test("task ids are conservative tokens and cannot escape tasks/", () => {
  for (const value of ["DEV-001", "DEV_QUERY.001", "A1"]) assert.equal(isSafeTaskId(value), true);
  for (const value of ["", "../DEV-001", "DEV/001", "DEV 001", "DEV\n001", "DEV..001", ".DEV"]) {
    assert.equal(isSafeTaskId(value), false, value);
  }
  assert.equal(taskContractPath("DEV-001"), "tasks/DEV-001.md");
});

test("remote names and work branches reject dangerous Git syntax", () => {
  for (const value of ["origin", "github-data-agent", "upstream_1"]) assert.equal(isSafeRemoteName(value), true);
  for (const value of ["", "bad remote", "../origin", "remote..name", "origin/main"]) {
    assert.equal(isSafeRemoteName(value), false, value);
  }

  for (const value of ["feature/example", "fix/DEV-001", "planning/recover"]) {
    assert.equal(isSafeWorkBranch(value), true, value);
  }
  for (const value of [
    "", "-main", "/main", "main/", "feature//x", "feature/../main", "feature/@{1}",
    "feature\\x", "feature x", "feature:x", ".hidden/x", "feature/x.lock"
  ]) {
    assert.equal(isSafeWorkBranch(value), false, value);
  }
});

test("bootstrap instruction fixes exact identity and fail-closed Git behavior", () => {
  const instruction = buildDevelopmentStartInstruction({
    remote: "origin",
    workBranch: "feature/example",
    taskId: "DEV-001"
  });
  for (const required of [
    "Remote: origin",
    "Work branch: feature/example",
    "Task contract: tasks/DEV-001.md",
    "unrelated dirty work exists, STOP and report BLOCKED",
    "Never stash, reset, clean, discard",
    "Fetch only the exact work branch",
    "Fast-forward only when safe",
    "Read AGENTS.md",
    "Required Reference",
    "Never force push",
    "Never merge the PR"
  ]) {
    assert.equal(instruction.includes(required), true, required);
  }
});

test("continuation keeps immutable identity and carries only supervisor feedback as the delta", () => {
  const instruction = buildDevelopmentContinuationInstruction(
    { remote: "origin", workBranch: "fix/example", taskId: "DEV-002" },
    "Fix the CI failure."
  );
  assert.equal(instruction.includes("SAME approved formal development task"), true);
  assert.equal(instruction.includes("Remote: origin"), true);
  assert.equal(instruction.includes("Work branch: fix/example"), true);
  assert.equal(instruction.includes("Task contract: tasks/DEV-002.md"), true);
  assert.equal(instruction.includes("Fix the CI failure."), true);
  assert.equal(instruction.includes("Do not change the task, branch, remote"), true);
});
