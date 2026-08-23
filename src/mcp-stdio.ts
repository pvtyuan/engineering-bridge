#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { isAbsolute, normalize } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { CodexExecutor } from "./executors/codex-executor.js";
import { DshExecutor } from "./executors/dsh-executor.js";
import { VERSION } from "./version.js";
import { CoreError, serializeError } from "./core/errors.js";
import { MAX_TASK_RESULT_WAIT_MS, RegisteredWorkspaceTaskService } from "./tasks/registered-workspace-task-service.js";
import { isSafeTaskId, isSafeWorkBranch } from "./tasks/development-task-instruction.js";
import { ControlledPatchService } from "./tasks/controlled-patch-service.js";
import { ManagedWorkspaceCatalog } from "./workspaces/managed-workspace-catalog.js";
import { RegisteredWorkspaceRegistry } from "./workspaces/registered-workspace-registry.js";
import { WorkspaceOnboardingService } from "./workspaces/workspace-onboarding-service.js";

const WorkspaceEntrySchema = z.object({
  id: z.string().min(1),
  root: z.string().min(1),
  allow_write: z.boolean().optional(),
  allow_development: z.boolean().optional(),
  development_remote: z.string().min(1).optional()
}).strict();

const ProjectRootEntrySchema = z.object({
  kind: z.literal("project_root"),
  root: z.string().min(1)
}).strict();

const WorkspaceConfigSchema = z.array(z.union([WorkspaceEntrySchema, ProjectRootEntrySchema]));
const WorkBranchSchema = z.string().min(1).max(255).refine(isSafeWorkBranch, "Invalid Git work branch.");
const TaskIdSchema = z.string().min(1).refine(isSafeTaskId, "Invalid development task id.");

type WorkspaceEntry = z.infer<typeof WorkspaceEntrySchema>;
type ProjectRootEntry = z.infer<typeof ProjectRootEntrySchema>;

function isProjectRootEntry(entry: WorkspaceEntry | ProjectRootEntry): entry is ProjectRootEntry {
  return "kind" in entry;
}

function jsonContent(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }]
  };
}

function unknownTask() {
  return {
    isError: true,
    ...jsonContent({ error: "UNKNOWN_TASK" })
  };
}

async function main(): Promise<void> {
  if (process.argv.length !== 3) {
    throw new Error("Usage: node dist/src/mcp-stdio.js /absolute/path/to/workspaces.json");
  }

  const configPath = process.argv[2];
  if (configPath === undefined) throw new Error("Workspace configuration path is required.");
  const parsed = WorkspaceConfigSchema.parse(JSON.parse(await readFile(configPath, "utf8")));
  const workspaceEntries = parsed.filter((entry): entry is WorkspaceEntry => !isProjectRootEntry(entry));
  const projectRootEntries = parsed.filter(isProjectRootEntry);
  for (const entry of projectRootEntries) {
    if (!isAbsolute(entry.root) || normalize(entry.root) !== entry.root) {
      throw new CoreError("WORKSPACE_BOUNDARY_VIOLATION");
    }
  }
  const registry = new RegisteredWorkspaceRegistry(workspaceEntries);
  const catalog = new ManagedWorkspaceCatalog(`${configPath}.managed-workspaces.json`);
  await catalog.load();
  for (const entry of catalog.entries()) {
    try {
      registry.registerManaged(entry.id, entry.root, entry.allowWrite);
    } catch {
      // A manual or earlier managed registration already owns the id or root.
    }
  }
  const onboarding = new WorkspaceOnboardingService(
    registry,
    catalog,
    projectRootEntries.map(({ root }) => root)
  );
  const service = new RegisteredWorkspaceTaskService(
    registry,
    (executor, workspaceRoot) => {
      switch (executor) {
        case "codex": return new CodexExecutor(workspaceRoot);
        case "dsh": return new DshExecutor(workspaceRoot);
      }
    }
  );
  const controlledPatches = new ControlledPatchService(
    registry,
    service,
    undefined,
    `${configPath}.controlled-patches.json`
  );
  await controlledPatches.load();
  const server = new McpServer({ name: "engineering-bridge", version: VERSION });

  server.registerTool("run_readonly_task", {
    description: "Run a supervised read-only analysis/review task with Codex or DSH. This tool cannot modify files, switch branches, commit, push, or create PRs. For an approved formal implementation task, use run_development_task instead.",
    inputSchema: {
      workspace_id: z.string().min(1),
      instruction: z.string().min(1),
      executor: z.enum(["codex", "dsh"]).optional().default("codex")
    }
  }, ({ workspace_id, instruction, executor }) => {
    const { taskId } = service.startReadonlyTask({ workspace_id, instruction, executor });
    return jsonContent({ task_id: taskId });
  });

  server.registerTool("run_development_task", {
    description: "Run one approved formal development Task Contract with Codex. The exact workspace, work branch, and task id are fixed for the task lifetime. This may fetch/switch the approved branch, modify files, run tests, update reports/docs, commit, push, and create/update the task PR. Local workspaces.json must explicitly grant allow_development and bind development_remote; this MCP server cannot self-authorize development access.",
    inputSchema: {
      workspace_id: z.string().min(1),
      work_branch: WorkBranchSchema,
      task_id: TaskIdSchema
    }
  }, ({ workspace_id, work_branch, task_id }) => {
    try {
      const { taskId } = service.startDevelopmentTask({ workspace_id, work_branch, task_id });
      return jsonContent({ task_id: taskId });
    } catch (error) {
      return { isError: true, ...jsonContent({ error: serializeError(error) }) };
    }
  });

  server.registerTool("task_result", {
    description: "Retrieve supervised task state, completed/review output, evidence, safe errors, and development identity when applicable. This tool is read-only.",
    inputSchema: {
      task_id: z.string(),
      wait_for: z.literal("ready").optional(),
      timeout_ms: z.number().int().min(0).max(MAX_TASK_RESULT_WAIT_MS).optional(),
      include_evidence: z.boolean().optional().default(true)
    }
  }, async ({ task_id, wait_for, timeout_ms, include_evidence }) => {
    let view = service.taskView(task_id);
    if (view === undefined) return unknownTask();
    let waitTimeout = false;
    if (wait_for === "ready" && view.ready !== true) {
      view = await service.waitForReady(task_id, timeout_ms ?? MAX_TASK_RESULT_WAIT_MS);
      if (view === undefined) return unknownTask();
      waitTimeout = view.ready !== true;
    }
    return jsonContent({
      task_id: view.taskId,
      state: view.state,
      executor: view.executor,
      task_kind: view.taskKind ?? "readonly",
      ...(view.workspaceId === undefined ? {} : { workspace_id: view.workspaceId }),
      ...(view.workBranch === undefined ? {} : { work_branch: view.workBranch }),
      ...(view.taskContract === undefined ? {} : { task_contract: view.taskContract }),
      ...(view.threadId === undefined ? {} : { thread_id: view.threadId }),
      ready: view.ready,
      ...(waitTimeout ? { wait_timeout: true } : {}),
      ...(view.output === undefined ? {} : { output: view.output }),
      ...(view.review_output === undefined ? {} : { review_output: view.review_output }),
      ...(view.completion_receipt === undefined ? {} : { completion_receipt: view.completion_receipt }),
      ...(view.partial_output === undefined ? {} : { partial_output: view.partial_output }),
      ...(view.live_output === undefined ? {} : { live_output: view.live_output }),
      ...(include_evidence ? { evidence: view.evidence } : {}),
      ...(view.error === undefined ? {} : { error: view.error })
    });
  });

  server.registerTool("control_task", {
    description: "Steer or interrupt a running task, continue a reviewed task, or accept reviewed output. Development tasks retain the same workspace/branch/task/remote identity across continue and steer.",
    inputSchema: {
      task_id: z.string(),
      action: z.enum(["continue", "steer", "interrupt", "accept"]),
      instruction: z.string().optional()
    }
  }, async ({ task_id, action, instruction }) => {
    if (service.taskView(task_id) === undefined) return unknownTask();
    try {
      const view = await service.controlTask(task_id, action, instruction);
      return jsonContent({ task_id: view.taskId, state: view.state });
    } catch (error) {
      return { isError: true, ...jsonContent({ error: serializeError(error) }) };
    }
  });

  server.registerTool("bind_project", {
    description: "Register an existing local project directory as a read-only managed workspace. The path must already exist inside a configured project_root and the call requires exact BIND confirmation. Managed workspaces cannot gain trusted development permission through MCP.",
    inputSchema: {
      project_path: z.string().min(1),
      confirmation: z.literal("BIND")
    }
  }, async ({ project_path }) => {
    try {
      return jsonContent(await onboarding.bind({ project_path }));
    } catch (error) {
      return { isError: true, ...jsonContent({ error: serializeError(error) }) };
    }
  });

  server.registerTool("create_project", {
    description: "Create a new empty Git project directory inside a configured project_root and register it as a read-only managed workspace. The call requires exact CREATE confirmation; only mkdir and git init are performed. Managed workspaces cannot gain trusted development permission through MCP.",
    inputSchema: {
      parent: z.string().min(1),
      name: z.string().min(1),
      confirmation: z.literal("CREATE")
    }
  }, async ({ parent, name }) => {
    try {
      return jsonContent(await onboarding.create({ parent, name }));
    } catch (error) {
      return { isError: true, ...jsonContent({ error: serializeError(error) }) };
    }
  });

  server.registerTool("authorize_workspace_write", {
    description: "Grant persistent controlled-patch APPLY authorization to a managed workspace after exact AUTHORIZE confirmation. This does not grant trusted development access. Manual workspaces remain authoritative through workspaces.json. run_readonly_task always stays read-only.",
    inputSchema: {
      workspace_id: z.string().min(1),
      confirmation: z.literal("AUTHORIZE")
    }
  }, async ({ workspace_id }) => {
    try {
      return jsonContent(await onboarding.authorizeWrite(workspace_id));
    } catch (error) {
      return { isError: true, ...jsonContent({ error: serializeError(error) }) };
    }
  });

  server.registerTool("generate_controlled_patch", {
    description: "Generate a read-only patch proposal for review in any registered Git workspace. Use this for explicitly reviewed patch APPLY workflows, not for a formal repository development Task with an existing work branch and Task Contract; use run_development_task for that.",
    inputSchema: {
      workspace_id: z.string().min(1),
      change_request: z.string().min(1),
      executor: z.enum(["codex", "dsh"]).optional().default("codex")
    }
  }, async ({ workspace_id, change_request, executor }) => {
    try {
      const proposal = await controlledPatches.generate({ workspace_id, change_request, executor });
      return jsonContent({ task_id: proposal.taskId, base_head: proposal.baseHead });
    } catch (error) {
      return { isError: true, ...jsonContent({ error: serializeError(error) }) };
    }
  });

  server.registerTool("refine_controlled_patch", {
    description: "Refine a completed retained patch proposal into a new complete read-only proposal against the same base HEAD.",
    inputSchema: {
      patch_task_id: z.string().min(1),
      change_request: z.string().min(1),
      executor: z.enum(["codex", "dsh"]).optional().default("codex")
    }
  }, async ({ patch_task_id, change_request, executor }) => {
    try {
      const proposal = await controlledPatches.refine({ patch_task_id, change_request, executor });
      return jsonContent({ task_id: proposal.taskId, base_head: proposal.baseHead });
    } catch (error) {
      return { isError: true, ...jsonContent({ error: serializeError(error) }) };
    }
  });

  server.registerTool("apply_controlled_patch", {
    description: "Apply one reviewed patch proposal after exact APPLY confirmation. This can modify validated tracked text files or add absent 100644 text files, but never stages, commits, pushes, or grants development authorization.",
    inputSchema: {
      patch_task_id: z.string().min(1),
      confirmation: z.literal("APPLY")
    }
  }, async ({ patch_task_id, confirmation }) => jsonContent(
    await controlledPatches.apply({ patch_task_id, confirmation })
  ));

  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Failed to start engineering-bridge.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
