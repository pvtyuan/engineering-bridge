import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPLETION_RECEIPT_CLOSE,
  COMPLETION_RECEIPT_OPEN,
  parseCompletionReceipt
} from "../../../src/tasks/development-completion-receipt.js";

const identity = { taskId: "DEV-001", workBranch: "feature/example" };

function output(payload: unknown): string {
  return `Human-readable summary\n\n${COMPLETION_RECEIPT_OPEN}\n${typeof payload === "string" ? payload : JSON.stringify(payload)}\n${COMPLETION_RECEIPT_CLOSE}`;
}

function receipt(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    protocol_version: 1,
    task_id: identity.taskId,
    work_branch: identity.workBranch,
    outcome: "success",
    summary: "Completed the approved change.",
    head_commit: "0123456789abcdef0123456789abcdef01234567",
    pr_url: "https://github.com/example/project/pull/1",
    report_path: "tasks/DEV-001-report.md",
    validations: [
      { name: "npm run typecheck", status: "passed" },
      { name: "npm test", status: "passed" }
    ],
    blockers: [],
    ...overrides
  };
}

test("parses and normalizes a valid protocol-v1 completion receipt", () => {
  const result = parseCompletionReceipt(output({ ...receipt(), credential: "do-not-expose" }), identity);

  assert.deepEqual(result, {
    status: "valid",
    receipt: {
      protocol_version: 1,
      task_id: "DEV-001",
      work_branch: "feature/example",
      outcome: "success",
      summary: "Completed the approved change.",
      head_commit: "0123456789abcdef0123456789abcdef01234567",
      pr_url: "https://github.com/example/project/pull/1",
      report_path: "tasks/DEV-001-report.md",
      validations: [
        { name: "npm run typecheck", status: "passed" },
        { name: "npm test", status: "passed" }
      ],
      blockers: []
    }
  });
});

test("classifies a missing receipt", () => {
  assert.deepEqual(parseCompletionReceipt("Human-readable summary only.", identity), { status: "missing" });
});

test("classifies malformed JSON, identity mismatches, and unsupported protocol versions as invalid", () => {
  assert.deepEqual(parseCompletionReceipt(output('{"protocol_version":1,'), identity), { status: "invalid" });
  assert.deepEqual(parseCompletionReceipt(output(receipt({ task_id: "DEV-999" })), identity), { status: "invalid" });
  assert.deepEqual(parseCompletionReceipt(output(receipt({ work_branch: "main" })), identity), { status: "invalid" });
  assert.deepEqual(parseCompletionReceipt(output(receipt({ protocol_version: 2 })), identity), { status: "invalid" });
});

test("supports a blocked outcome with blockers", () => {
  const result = parseCompletionReceipt(output(receipt({
    outcome: "blocked",
    summary: "Stopped before implementation.",
    head_commit: undefined,
    blockers: ["The worktree contained unrelated changes."]
  })), identity);

  assert.deepEqual(result, {
    status: "valid",
    receipt: {
      protocol_version: 1,
      task_id: "DEV-001",
      work_branch: "feature/example",
      outcome: "blocked",
      summary: "Stopped before implementation.",
      pr_url: "https://github.com/example/project/pull/1",
      report_path: "tasks/DEV-001-report.md",
      validations: [
        { name: "npm run typecheck", status: "passed" },
        { name: "npm test", status: "passed" }
      ],
      blockers: ["The worktree contained unrelated changes."]
    }
  });
});

test("uses the latest receipt block in a final message", () => {
  const first = output(receipt({ summary: "First round." }));
  const second = output(receipt({ summary: "Second round.", head_commit: "fedcba9876543210fedcba9876543210fedcba98" }));
  const result = parseCompletionReceipt(`${first}\n${second}`, identity);

  assert.equal(result.status, "valid");
  if (result.status === "valid") {
    assert.equal(result.receipt.summary, "Second round.");
    assert.equal(result.receipt.head_commit, "fedcba9876543210fedcba9876543210fedcba98");
  }
});

test("classifies an unmatched delimiter as invalid", () => {
  assert.deepEqual(parseCompletionReceipt(`${COMPLETION_RECEIPT_OPEN}{}`, identity), { status: "invalid" });
  assert.deepEqual(parseCompletionReceipt(`text${COMPLETION_RECEIPT_CLOSE}`, identity), { status: "invalid" });
});
