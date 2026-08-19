# Engineering Bridge User Guide

## Overview

Engineering Bridge is a local MCP bridge that connects ChatGPT supervision with controlled local execution.

The system provides three execution paths:

1. Read-only task execution
2. Controlled patch workflow
3. Trusted development execution

Trusted development is intentionally separate from read-only execution. It requires explicit workspace authorization and a fixed task identity.

## Architecture

```
ChatGPT
  |
  | MCP
  v
Engineering Bridge
  |
  +-- run_readonly_task
  |
  +-- controlled patch
  |
  +-- run_development_task
          |
          v
       Local workspace
          |
          v
        Codex
```

## MCP Tools

### run_readonly_task

Use for inspection, analysis, debugging, and non-modifying tasks.

Characteristics:

- read-only sandbox
- no development branch switching
- no commit/push lifecycle

Example:

```
run_readonly_task(
  workspace_id="data-agent",
  instruction="Analyze current OpenMetadata integration implementation"
)
```

## Trusted Development

Use `run_development_task` only when a formal development task exists.

Required inputs:

- workspace_id
- work_branch
- task_id

Example:

```
run_development_task(
  workspace_id="data-agent",
  work_branch="feature/example",
  task_id="DEV-001"
)
```

Before coding, Engineering Bridge requires:

1. Verify workspace identity
2. Verify Git remote
3. Fetch the exact branch
4. Switch only to that branch
5. Read AGENTS.md
6. Read the task contract
7. Execute repository preflight

## Development Safety Rules

Trusted development does not allow:

- changing remote configuration
- changing target branch
- force push
- merging pull requests
- bypassing protected branches
- changing task identity

If workspace state is unexpected, execution stops and reports blocked.

## Task Lifecycle

Typical flow:

```
Create task branch
        |
        v
Create task contract
        |
        v
ChatGPT starts development task
        |
        v
Codex implements
        |
        v
Tests + commit + push
        |
        v
Pull Request
        |
        v
CI validation
        |
        v
Human review and merge
```

## Troubleshooting

### Task cannot start

Check:

- workspace exists
- workspace has development authorization
- branch name is valid
- task contract exists

### Codex stops during bootstrap

Common reasons:

- dirty unrelated changes
- branch divergence
- missing task contract
- missing required references

Resolve the repository state manually, then restart the task.
