# Security Policy

Engineering Bridge V2 supports both low-privilege supervision and explicitly authorized trusted development. Security reports should state which mode is involved.

## Supported security modes

### Read-only supervision

`run_readonly_task` is intended to avoid workspace mutation. Codex runs read-only with network disabled; DSH remains read-only. Controlled patch proposal generation is also read-only.

### Controlled patch APPLY

`allow_write` and `authorize_workspace_write` govern only the reviewed `apply_controlled_patch` path. Exact confirmation and patch validation remain required. This permission does not authorize Git development operations.

### Trusted development

`run_development_task` may make real repository changes, run commands with network access, commit and push the approved work branch, and create/update its PR according to repository policy.

Trusted development must be explicitly enabled in local manual configuration with both:

```json
{
  "allow_development": true,
  "development_remote": "origin"
}
```

It cannot be enabled by an MCP caller or through managed-workspace onboarding.

## Security boundary

Development Codex uses `danger-full-access` plus `externalSandbox` with network enabled. The surrounding development container or OS sandbox is therefore the isolation boundary.

Do not run trusted development in an environment containing secrets or host resources that Codex is not intended to access. In particular, prefer keeping remote-control/tunnel credentials outside the development container while allowing only the Git/Codex credentials intentionally needed for development.

## Credential handling

Development mode may inherit proxy variables and `SSH_AUTH_SOCK`. Engineering Bridge does not default-forward `OPENAI_API_KEY`, `GH_TOKEN`, or `GITHUB_TOKEN` to Codex.

This does not protect secrets stored in readable files, HOME/CODEX_HOME, SSH configuration, credential helpers, mounted volumes or agent-accessible identities. Operators must design the outer environment accordingly.

## Repository integrity controls

The trusted development bootstrap instructs Codex to fail closed on unknown dirty work or branch divergence, use the exact configured remote and work branch, synchronize fast-forward only, read the exact Task Contract and repository instructions, avoid force push, and never merge the PR.

Repository-side branch protection/rulesets and CI are still the authoritative enforcement controls and should not be disabled merely because the Bridge provides these instructions.

## Reporting a vulnerability

Please include:

- affected Engineering Bridge version/commit;
- execution path (`run_readonly_task`, controlled patch, or `run_development_task`);
- workspace configuration relevant to the issue, with secrets removed;
- whether the issue crosses the documented outer-sandbox boundary;
- reproduction steps and expected/actual behavior.

Do not include live credentials, private source code, tunnel tokens, API keys or unrelated user data in a public report.
