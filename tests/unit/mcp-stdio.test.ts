import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const VERSION_MODULE = new URL("../../src/version.js", import.meta.url);

interface ToolResult {
  content: Array<{ type?: string; text?: string } | undefined>;
}

function clientFor(configPath: string, env?: Record<string, string>): { client: Client; transport: StdioClientTransport } {
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(process.cwd(), "dist/src/mcp-stdio.js"), configPath],
    cwd: process.cwd(),
    ...(env === undefined ? {} : { env }),
    stderr: "pipe"
  });
  return { client, transport };
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<{ isError: boolean; body: Record<string, unknown> }> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as ToolResult["content"];
  const text = content[0]?.text ?? "{}";
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    body = { raw: text };
  }
  return { isError: result.isError === true, body: body as Record<string, unknown> };
}

async function waitForTerminal(client: Client, taskId: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const poll = await call(client, "task_result", { task_id: taskId });
    if (poll.body.state !== "queued" && poll.body.state !== "running") return poll.body;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("task did not reach a terminal state");
}

test("MCP publishes the v2 tool surface and shared package version", async () => {
  const { VERSION } = await import(VERSION_MODULE.href) as { VERSION: unknown };
  const packageVersion = (JSON.parse(readFileSync("package.json", "utf8")) as { version: unknown }).version;
  assert.equal(VERSION, packageVersion);

  const configPath = join(mkdtempSync(join(tmpdir(), "engineering-bridge-mcp-")), "workspaces.json");
  writeFileSync(configPath, "[]\n");
  const { client, transport } = clientFor(configPath);

  try {
    await client.connect(transport);
    assert.equal(client.getServerVersion()?.version, VERSION);
    const listed = await client.listTools();
    const names = listed.tools.map(({ name }) => name).sort();
    assert.deepEqual(names, [
      "apply_controlled_patch",
      "authorize_workspace_write",
      "bind_project",
      "control_task",
      "create_project",
      "generate_controlled_patch",
      "refine_controlled_patch",
      "run_development_task",
      "run_readonly_task",
      "task_result"
    ]);
    assert.equal(names.includes("run_task"), false);

    const development = listed.tools.find(({ name }) => name === "run_development_task");
    assert.ok(development);
    const schema = development.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
    assert.deepEqual(Object.keys(schema.properties ?? {}).sort(), ["task_id", "work_branch", "workspace_id"]);
    assert.deepEqual([...(schema.required ?? [])].sort(), ["task_id", "work_branch", "workspace_id"]);
  } finally {
    await client.close();
  }
});

test("run_readonly_task remains asynchronous, defaults to Codex, supports DSH, and rejects unknown executors", async () => {
  const configPath = join(mkdtempSync(join(tmpdir(), "engineering-bridge-readonly-")), "workspaces.json");
  writeFileSync(configPath, "[]\n");
  const { client, transport } = clientFor(configPath);

  try {
    await client.connect(transport);
    for (const argumentsValue of [
      { workspace_id: "missing", instruction: "inspect" },
      { workspace_id: "missing", instruction: "inspect", executor: "codex" },
      { workspace_id: "missing", instruction: "inspect", executor: "dsh" }
    ]) {
      const run = await call(client, "run_readonly_task", argumentsValue);
      assert.equal(run.isError, false);
      assert.equal(typeof run.body.task_id, "string");
      if (typeof run.body.task_id !== "string") continue;
      const view = await waitForTerminal(client, run.body.task_id);
      assert.equal(view.executor, argumentsValue.executor ?? "codex");
      assert.equal("thread_id" in view, false);
      assert.equal(view.task_kind, "readonly");
      assert.deepEqual(view.error, {
        code: "UNKNOWN_WORKSPACE",
        message: "The requested workspace is not registered."
      });
    }

    const unknown = await call(client, "run_readonly_task", {
      workspace_id: "missing",
      instruction: "inspect",
      executor: "unknown"
    });
    assert.equal(unknown.isError, true);
    assert.equal("task_id" in unknown.body, false);
  } finally {
    await client.close();
  }
});

test("development task_result exposes review_output and the completion receipt", async () => {
  const root = mkdtempSync(join(tmpdir(), "engineering-bridge-development-receipt-root-"));
  const configDir = mkdtempSync(join(tmpdir(), "engineering-bridge-development-receipt-config-"));
  const fakeBin = mkdtempSync(join(tmpdir(), "engineering-bridge-development-receipt-bin-"));
  const configPath = join(configDir, "workspaces.json");
  const taskId = "DEV-MCP-001";
  const workBranch = "feature/mcp-receipt";
  const reviewOutput = [
    "Codex human-readable summary.",
    "",
    "<engineering_bridge_receipt>",
    JSON.stringify({
      protocol_version: 1,
      task_id: taskId,
      work_branch: workBranch,
      outcome: "success",
      summary: "Completed the MCP receipt round.",
      validations: [{ name: "focused test", status: "passed" }],
      blockers: []
    }),
    "</engineering_bridge_receipt>"
  ].join("\n");
  const fakeCodex = join(fakeBin, "codex");
  writeFileSync(fakeCodex, `#!/usr/bin/env node
import { createInterface } from "node:readline";

const output = ${JSON.stringify(reviewOutput)};
const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  let result = {};
  if (message.method === "thread/start") result = { thread: { id: "thread-mcp-receipt" } };
  if (message.method === "turn/start") result = { turn: { id: "turn-mcp-receipt" } };
  process.stdout.write(JSON.stringify({ id: message.id, result }) + "\\n");
  if (message.method === "turn/start") {
    process.stdout.write(JSON.stringify({ method: "item/completed", params: { item: { id: "message-mcp-receipt", type: "agentMessage", text: output } } }) + "\\n");
    process.stdout.write(JSON.stringify({ method: "turn/completed", params: { threadId: "thread-mcp-receipt", turn: { id: "turn-mcp-receipt", status: "completed" } } }) + "\\n");
  }
});
`);
  chmodSync(fakeCodex, 0o755);
  writeFileSync(configPath, `${JSON.stringify([
    { id: "dev", root, allow_development: true, development_remote: "origin" }
  ], null, 2)}\n`);
  const { client, transport } = clientFor(configPath, {
    PATH: `${fakeBin}:${process.env.PATH ?? ""}`
  });

  try {
    await client.connect(transport);
    const run = await call(client, "run_development_task", {
      workspace_id: "dev",
      work_branch: workBranch,
      task_id: taskId
    });
    assert.equal(run.isError, false);
    assert.equal(typeof run.body.task_id, "string");
    if (typeof run.body.task_id !== "string") return;

    const view = await waitForTerminal(client, run.body.task_id);
    assert.equal(view.state, "waiting_for_supervisor_review");
    assert.equal(view.review_output, reviewOutput);
    assert.equal(view.live_output, reviewOutput);
    assert.deepEqual(view.evidence, []);
    assert.deepEqual(view.completion_receipt, {
      status: "valid",
      receipt: {
        protocol_version: 1,
        task_id: taskId,
        work_branch: workBranch,
        outcome: "success",
        summary: "Completed the MCP receipt round.",
        validations: [{ name: "focused test", status: "passed" }],
        blockers: []
      }
    });

    const readyWithoutEvidence = await call(client, "task_result", {
      task_id: run.body.task_id,
      wait_for: "ready",
      timeout_ms: 1,
      include_evidence: false
    });
    assert.equal(readyWithoutEvidence.isError, false);
    assert.equal(readyWithoutEvidence.body.ready, true);
    assert.equal("evidence" in readyWithoutEvidence.body, false);
    assert.equal(readyWithoutEvidence.body.live_output, reviewOutput);
  } finally {
    await client.close();
  }
});

test("task_result validates bounded ready waits and wait_for values", async () => {
  const configPath = join(mkdtempSync(join(tmpdir(), "engineering-bridge-task-result-schema-")), "workspaces.json");
  writeFileSync(configPath, "[]\n");
  const { client, transport } = clientFor(configPath);

  try {
    await client.connect(transport);
    const invalidTimeout = await call(client, "task_result", { task_id: "unknown", timeout_ms: 20_001 });
    assert.equal(invalidTimeout.isError, true);
    const invalidWaitFor = await call(client, "task_result", { task_id: "unknown", wait_for: "running" });
    assert.equal(invalidWaitFor.isError, true);
  } finally {
    await client.close();
  }
});

test("task_result returns a non-ready timeout snapshot without evidence", async () => {
  const root = mkdtempSync(join(tmpdir(), "engineering-bridge-task-result-timeout-root-"));
  const configDir = mkdtempSync(join(tmpdir(), "engineering-bridge-task-result-timeout-config-"));
  const fakeBin = mkdtempSync(join(tmpdir(), "engineering-bridge-task-result-timeout-bin-"));
  const configPath = join(configDir, "workspaces.json");
  const fakeCodex = join(fakeBin, "codex");
  writeFileSync(fakeCodex, `#!/usr/bin/env node
import { createInterface } from "node:readline";

const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  let result = {};
  if (message.method === "thread/start") result = { thread: { id: "thread-timeout" } };
  if (message.method === "turn/start") result = { turn: { id: "turn-timeout" } };
  process.stdout.write(JSON.stringify({ id: message.id, result }) + "\\n");
});
`);
  chmodSync(fakeCodex, 0o755);
  writeFileSync(configPath, `${JSON.stringify([{ id: "known", root }], null, 2)}\n`);
  const { client, transport } = clientFor(configPath, {
    PATH: `${fakeBin}:${process.env.PATH ?? ""}`
  });

  try {
    await client.connect(transport);
    const run = await call(client, "run_readonly_task", { workspace_id: "known", instruction: "hold" });
    assert.equal(run.isError, false);
    assert.equal(typeof run.body.task_id, "string");
    if (typeof run.body.task_id !== "string") return;

    let running: { isError: boolean; body: Record<string, unknown> } | undefined;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const result = await call(client, "task_result", { task_id: run.body.task_id });
      if (result.body.state === "running") {
        running = result;
        break;
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    assert.equal(running?.body.state, "running");

    const timedOut = await call(client, "task_result", {
      task_id: run.body.task_id,
      wait_for: "ready",
      timeout_ms: 5,
      include_evidence: false
    });
    assert.equal(timedOut.isError, false);
    assert.equal(timedOut.body.state, "running");
    assert.equal(timedOut.body.ready, false);
    assert.equal(timedOut.body.wait_timeout, true);
    assert.equal("evidence" in timedOut.body, false);
  } finally {
    await client.close();
  }
});

test("run_development_task fails closed unless manual local configuration grants development access", async () => {
  const root = mkdtempSync(join(tmpdir(), "engineering-bridge-development-root-"));
  const configDir = mkdtempSync(join(tmpdir(), "engineering-bridge-development-config-"));
  const configPath = join(configDir, "workspaces.json");
  writeFileSync(configPath, `${JSON.stringify([
    { id: "readonly", root },
    { kind: "project_root", root: configDir }
  ], null, 2)}\n`);
  const { client, transport } = clientFor(configPath);

  try {
    await client.connect(transport);
    const denied = await call(client, "run_development_task", {
      workspace_id: "readonly",
      work_branch: "feature/example",
      task_id: "DEV-001"
    });
    assert.equal(denied.isError, true);
    assert.deepEqual(denied.body, {
      error: {
        code: "WORKSPACE_PRECONDITION_FAILED",
        message: "The workspace preconditions were not met."
      }
    });

    const invalidBranch = await call(client, "run_development_task", {
      workspace_id: "readonly",
      work_branch: "../main",
      task_id: "DEV-001"
    });
    assert.equal(invalidBranch.isError, true);
    assert.equal("task_id" in invalidBranch.body, false);

    const invalidTask = await call(client, "run_development_task", {
      workspace_id: "readonly",
      work_branch: "feature/example",
      task_id: "../DEV-001"
    });
    assert.equal(invalidTask.isError, true);
    assert.equal("task_id" in invalidTask.body, false);

    const managedProject = join(configDir, "managed-project");
    mkdirSync(managedProject);
    const bound = await call(client, "bind_project", {
      project_path: managedProject,
      confirmation: "BIND"
    });
    const workspaceId = bound.body.workspace_id;
    assert.equal(typeof workspaceId, "string");
    if (typeof workspaceId !== "string") return;

    const authorized = await call(client, "authorize_workspace_write", {
      workspace_id: workspaceId,
      confirmation: "AUTHORIZE"
    });
    assert.equal(authorized.isError, false);

    const stillDenied = await call(client, "run_development_task", {
      workspace_id: workspaceId,
      work_branch: "feature/example",
      task_id: "DEV-001"
    });
    assert.equal(stillDenied.isError, true);
    assert.deepEqual(stillDenied.body, {
      error: {
        code: "WORKSPACE_PRECONDITION_FAILED",
        message: "The workspace preconditions were not met."
      }
    });
  } finally {
    await client.close();
  }
});

test("startup rejects invalid trusted-development configuration", async () => {
  for (const registration of [
    { id: "dev", root: "/tmp/dev", allow_development: true },
    { id: "dev", root: "/tmp/dev", allow_development: false, development_remote: "origin" },
    { id: "dev", root: "/tmp/dev", allow_development: true, development_remote: "bad remote" },
    { id: "dev", root: "/tmp/dev", allow_development: true, development_remote: "remote..name" }
  ]) {
    const configPath = join(mkdtempSync(join(tmpdir(), "engineering-bridge-invalid-dev-")), "workspaces.json");
    writeFileSync(configPath, `${JSON.stringify([registration], null, 2)}\n`);
    const { client, transport } = clientFor(configPath);
    await assert.rejects(client.connect(transport));
    await client.close();
  }
});
