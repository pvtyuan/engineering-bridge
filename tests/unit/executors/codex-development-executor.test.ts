import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";

import { isId } from "../../../src/core/ids.js";
import { CodexExecutor } from "../../../src/executors/codex-executor.js";
import type { ProcessStarter } from "../../../src/executors/codex-executor.js";

const TASK_ID_VALUE = "550e8400-e29b-41d4-a716-446655440000";
if (!isId(TASK_ID_VALUE)) throw new Error("Test task ID must be a UUID v4.");
const TASK_ID = TASK_ID_VALUE;
const ROOT = "/trusted/workspace";

interface Invocation {
  executable: string;
  args: readonly string[];
  options: SpawnOptionsWithoutStdio;
  stdin: string;
}

function starter(invocations: Invocation[]): ProcessStarter {
  return (executable, args, options) => {
    const child = new EventEmitter();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const invocation: Invocation = { executable, args: [...args], options, stdin: "" };
    const stdin = new Writable({
      write(chunk, _encoding, callback) {
        invocation.stdin += chunk.toString();
        const message = JSON.parse(chunk.toString()) as { id?: number; method: string };
        if (message.id !== undefined) {
          let result: unknown = {};
          if (message.method === "thread/start") result = { thread: { id: "thread-1" } };
          if (message.method === "turn/start") result = { turn: { id: "turn-1" } };
          queueMicrotask(() => {
            stdout.write(`${JSON.stringify({ id: message.id, result })}\n`);
            if (message.method === "turn/start") {
              stdout.write(`${JSON.stringify({ method: "item/completed", params: { item: { id: "message-1", type: "agentMessage", text: "done" } } })}\n`);
              stdout.write(`${JSON.stringify({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } } })}\n`);
            }
          });
        }
        callback();
      }
    });
    invocations.push(invocation);
    Object.assign(child, {
      stdin,
      stdout,
      stderr,
      killed: false,
      kill() { this.killed = true; return true; }
    });
    return child as unknown as ChildProcessWithoutNullStreams;
  };
}

test("development uses danger-full-access thread mode and externalSandbox network access", async () => {
  const invocations: Invocation[] = [];
  const hostEnvironment = {
    PATH: "/bin",
    HOME: "/home/test",
    CODEX_HOME: "/codex/test",
    HTTP_PROXY: "http://proxy:7890",
    HTTPS_PROXY: "http://proxy:7890",
    ALL_PROXY: "socks5://proxy:7891",
    NO_PROXY: "localhost,127.0.0.1",
    http_proxy: "http://lower:7890",
    https_proxy: "http://lower:7890",
    all_proxy: "socks5://lower:7891",
    no_proxy: "localhost",
    SSH_AUTH_SOCK: "/tmp/ssh-agent.sock",
    OPENAI_API_KEY: "secret-openai",
    GH_TOKEN: "secret-gh",
    GITHUB_TOKEN: "secret-github"
  };
  const executor = new CodexExecutor(ROOT, starter(invocations), hostEnvironment);

  const result = await executor.execute({
    taskId: TASK_ID,
    instruction: "implement approved task",
    executionMode: "development"
  });
  assert.equal(result.kind, "completed");
  assert.equal(invocations.length, 1);
  const invocation = invocations[0];
  assert.ok(invocation);
  assert.equal(invocation.options.shell, false);
  assert.deepEqual(invocation.args, ["app-server", "--stdio"]);
  assert.deepEqual(invocation.options.env, {
    PATH: "/bin",
    HOME: "/home/test",
    CODEX_HOME: "/codex/test",
    HTTP_PROXY: "http://proxy:7890",
    HTTPS_PROXY: "http://proxy:7890",
    ALL_PROXY: "socks5://proxy:7891",
    NO_PROXY: "localhost,127.0.0.1",
    http_proxy: "http://lower:7890",
    https_proxy: "http://lower:7890",
    all_proxy: "socks5://lower:7891",
    no_proxy: "localhost",
    SSH_AUTH_SOCK: "/tmp/ssh-agent.sock"
  });
  assert.equal("OPENAI_API_KEY" in (invocation.options.env ?? {}), false);
  assert.equal("GH_TOKEN" in (invocation.options.env ?? {}), false);
  assert.equal("GITHUB_TOKEN" in (invocation.options.env ?? {}), false);

  const messages = invocation.stdin.trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(messages[2], {
    id: 2,
    method: "thread/start",
    params: {
      cwd: ROOT,
      approvalPolicy: "never",
      sandbox: "danger-full-access"
    }
  });
  assert.deepEqual(messages[3], {
    id: 3,
    method: "turn/start",
    params: {
      threadId: "thread-1",
      input: [{ type: "text", text: "implement approved task" }],
      cwd: ROOT,
      approvalPolicy: "never",
      sandboxPolicy: {
        type: "externalSandbox",
        networkAccess: "enabled"
      }
    }
  });
  assert.equal(invocation.args.includes("implement approved task"), false);
});

test("readonly execution inherits Codex transport proxy but not SSH or host credentials", async () => {
  const invocations: Invocation[] = [];
  const executor = new CodexExecutor(ROOT, starter(invocations), {
    PATH: "/bin",
    HOME: "/home/test",
    HTTP_PROXY: "http://proxy:7890",
    HTTPS_PROXY: "http://proxy:7890",
    ALL_PROXY: "socks5://proxy:7891",
    NO_PROXY: "localhost,127.0.0.1",
    http_proxy: "http://lower:7890",
    https_proxy: "http://lower:7890",
    all_proxy: "socks5://lower:7891",
    no_proxy: "localhost",
    SSH_AUTH_SOCK: "secret-ssh",
    OPENAI_API_KEY: "secret-openai",
    GH_TOKEN: "secret-gh",
    GITHUB_TOKEN: "secret-github"
  });

  await executor.execute({ taskId: TASK_ID, instruction: "inspect", executionMode: "readonly" });
  assert.deepEqual(invocations[0]?.options.env, {
    PATH: "/bin",
    HOME: "/home/test",
    HTTP_PROXY: "http://proxy:7890",
    HTTPS_PROXY: "http://proxy:7890",
    ALL_PROXY: "socks5://proxy:7891",
    NO_PROXY: "localhost,127.0.0.1",
    http_proxy: "http://lower:7890",
    https_proxy: "http://lower:7890",
    all_proxy: "socks5://lower:7891",
    no_proxy: "localhost"
  });
  const env = invocations[0]?.options.env ?? {};
  assert.equal("SSH_AUTH_SOCK" in env, false);
  assert.equal("OPENAI_API_KEY" in env, false);
  assert.equal("GH_TOKEN" in env, false);
  assert.equal("GITHUB_TOKEN" in env, false);

  const messages = invocations[0]?.stdin.trim().split("\n").map((line) => JSON.parse(line)) ?? [];
  assert.deepEqual(messages[2]?.params?.sandbox, "read-only");
  assert.deepEqual(messages[3]?.params?.sandboxPolicy, {
    type: "readOnly",
    networkAccess: false
  });
});
