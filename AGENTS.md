# Engineering Bridge Repository Instructions

This file defines repository-local development rules for `pvtyuan/engineering-bridge`.
It is intentionally limited to stable implementation and delivery constraints. Project-wide release state, architecture state, and version pointers are maintained outside this repository in the研发中心 canonical context.

## Task Authority

- For a development task, read `tasks/<task_id>.md` before changing code.
- The Task Contract is authoritative for task-specific scope, acceptance criteria, required references, and non-goals.
- If this file conflicts with an explicit Task Contract requirement, stop and report the conflict instead of silently choosing one.
- Do not invent missing requirements. If a required file, prerequisite, or instruction is unavailable, report the task as blocked before implementation.

## Branch and Delivery Rules

- Use the provided `workspace_id`, `work_branch`, and `task_id` exactly.
- One Task stays on one `work_branch` for its full lifetime.
- A Task may contain multiple commits.
- `control_task(continue)` continues the same Task identity, branch, remote, Task Contract, and PR.
- Push each completed modification round to the same `work_branch`.
- Do not force push.
- Do not merge the PR as part of task execution.
- The branch HEAD at Supervisor accept is the accepted delivery HEAD.

## Implementation Boundaries

- Preserve existing public API compatibility unless the Task Contract explicitly changes it.
- Keep security, workspace isolation, and trusted identity checks intact.
- Do not move task/supervisor lifecycle responsibilities into executor transport code unless the Task Contract explicitly requires that boundary change.
- Do not add new persistence, background push, streaming transport, or public MCP tools unless explicitly required.
- Never expose credentials, tokens, private keys, or other secrets in code, logs, tests, receipts, or reports.

## Validation

Before reporting success, run the repository-defined checks required by the Task Contract. Unless the Task Contract says otherwise, include at least:

```bash
npm run typecheck
npm run build
npm test
git diff --check
```

Do not claim a validation passed unless it actually ran successfully.

## Supervised Development Completion

- A Codex development turn completing does not by itself mean the Task is accepted.
- When the active Task Contract requires a Completion Receipt, preserve the human-readable final summary and emit the required machine-readable receipt exactly as instructed.
- Receipt identity fields must match the trusted `task_id` and `work_branch`.
- If blocked, report the blocker clearly and do not fabricate implementation, validation, commit, push, or PR evidence.

## Repository Hygiene

- Keep changes scoped to the active Task Contract.
- Update repository documentation when the Task Contract requires it.
- Avoid unrelated cleanup or refactors.
- Preserve existing tests unless the task intentionally changes the behavior they verify.
