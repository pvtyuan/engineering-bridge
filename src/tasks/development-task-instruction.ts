export interface DevelopmentTaskIdentity {
  readonly remote: string;
  readonly workBranch: string;
  readonly taskId: string;
}

export function taskContractPath(taskId: string): string {
  return `tasks/${taskId}.md`;
}

export function isSafeTaskId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value) && !value.includes("..");
}

export function isSafeRemoteName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value) && !value.includes("..");
}

export function isSafeWorkBranch(value: string): boolean {
  if (value.length === 0 || value.length > 255 || value === "@" || value.startsWith("-")) return false;
  if (value.startsWith("/") || value.endsWith("/") || value.includes("//")) return false;
  if (value.includes("..") || value.includes("@{") || value.includes("\\")) return false;
  if (/[\x00-\x20\x7f~^:?*\[]/u.test(value)) return false;
  const segments = value.split("/");
  return segments.every((segment) =>
    segment.length > 0 &&
    !segment.startsWith(".") &&
    !segment.endsWith(".") &&
    !segment.endsWith(".lock")
  );
}

export function buildDevelopmentStartInstruction(identity: DevelopmentTaskIdentity): string {
  const taskPath = taskContractPath(identity.taskId);
  return `You are executing one approved formal development task.

Trusted execution identity:
Remote: ${identity.remote}
Work branch: ${identity.workBranch}
Task contract: ${taskPath}

Perform Workspace Bootstrap before implementation:
1. Verify the current working directory is the expected Git repository.
2. Inspect the working tree before changing branches. If unrelated dirty work exists, STOP and report BLOCKED. Never stash, reset, clean, discard, or overwrite unrelated work.
3. Verify the configured remote "${identity.remote}" already exists. Never add, remove, or rewrite remotes.
4. Fetch only the exact work branch "${identity.workBranch}" from remote "${identity.remote}".
5. Switch to the exact work branch. If no local branch exists, create a tracking branch only from "${identity.remote}/${identity.workBranch}".
6. If the local branch and remote branch have diverged, STOP and report BLOCKED. Never reset, rebase, or force-update divergent work. Fast-forward only when safe.
7. Verify the current branch exactly equals "${identity.workBranch}".
8. Verify "${taskPath}" exists on that branch.
9. Read AGENTS.md, then read "${taskPath}", then read every Required Reference named by that Task Contract.
10. Run the repository-defined Preflight and continue only when it passes.

After Bootstrap and Preflight, execute the repository's formal development contract completely. Follow AGENTS.md and the Task Contract for implementation, tests, documentation/reporting, commit, push, PR creation/update, and STOP conditions.

Never change the task, work branch, configured remote, target branch, credentials, or protected-branch policy. Never force push. Never merge the PR.`;
}

export function buildDevelopmentContinuationInstruction(
  identity: DevelopmentTaskIdentity,
  supervisorInstruction: string
): string {
  const taskPath = taskContractPath(identity.taskId);
  return `Continue the SAME approved formal development task.

Trusted execution identity remains unchanged:
Remote: ${identity.remote}
Work branch: ${identity.workBranch}
Task contract: ${taskPath}

Before continuing, verify you are still on the exact work branch and that the Task Contract still matches this identity. Do not change the task, branch, remote, credentials, target branch, or protected-branch policy. Never force push or merge the PR.

Supervisor feedback/instruction:
${supervisorInstruction}

Continue according to AGENTS.md and the Task Contract. If implementation evidence changes, update the report as required, then commit and push fixes to the same branch/PR.`;
}

export function buildDevelopmentSteerInstruction(
  identity: DevelopmentTaskIdentity,
  supervisorInstruction: string
): string {
  return `For the SAME approved development task (${identity.taskId}) on ${identity.remote}/${identity.workBranch}: ${supervisorInstruction}\nDo not change task, branch, remote, credentials, target branch, or protected-branch policy.`;
}
