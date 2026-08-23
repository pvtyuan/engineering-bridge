# Engineering Bridge

Engineering Bridge 是一个本地 MCP Bridge，让 Chat/LLM 可以监督本机 Codex 或 DSH，并在**明确的本地信任配置**下，把已批准的正式研发任务交给 Codex 完整执行。

当前 fork 的目标版本为 **2.0.0**。V2 保留 V1 的只读监督与 controlled patch，并新增一条独立的 **trusted development** 路径。

## 三条执行路径

### 1. `run_readonly_task`

用于分析、代码定位、Review 和其他不应修改工作区的任务。

- 可选 `executor: "codex" | "dsh"`，默认 Codex。
- Codex 使用 `read-only` / `readOnly` sandbox，网络关闭。
- 不切换分支、不修改文件、不 commit、不 push、不创建 PR。
- 成功轮次进入 `waiting_for_supervisor_review`，由 `control_task` 继续、steer、interrupt 或 accept。

### 2. controlled patch

`generate_controlled_patch` / `refine_controlled_patch` 只读生成完整 diff；`apply_controlled_patch` 只有在精确 `APPLY` 后才由 Bridge 应用经过校验的 patch。

这条路径仍然：

- 不自动 stage、commit、push 或创建 PR；
- `allow_write` 只控制 controlled-patch APPLY；
- managed workspace 可以通过 `authorize_workspace_write` 获得 controlled-write 权限。

### 3. `run_development_task`

用于**已经批准的正式仓库研发任务**。输入固定为：

```json
{
  "workspace_id": "data-agent",
  "work_branch": "feature/example",
  "task_id": "DEV-001"
}
```

Bridge 固定推导：

```text
tasks/DEV-001.md
```

没有自由形式 implementation instruction，也没有 executor 参数；development 固定由 Codex 执行。

Codex 会先收到 Workspace Bootstrap 契约：

1. 验证当前目录是预期 Git 仓库；
2. 切分支前检查 dirty work；存在无关 dirty work 时 `BLOCKED`，不得 stash/reset/clean/discard；
3. 验证本地配置指定的 remote 已存在，不允许新增、删除或改写 remote；
4. 只 fetch 指定 remote 的指定 work branch；
5. 只切换到指定 branch；本地不存在时只允许从精确的 remote branch 创建 tracking branch；
6. 只允许 fast-forward，同步发现 diverged/ahead 等异常时 `BLOCKED`；禁止 reset/rebase/force update；
7. 验证当前 branch 精确匹配；
8. 验证 `tasks/<TASK-ID>.md` 存在；
9. 阅读 `AGENTS.md`、Task Contract 和其中的 Required References；
10. 执行仓库自己的 Preflight，然后按仓库正式研发契约完成实现、测试、报告、commit、push 和 PR 更新。

Bridge 不允许 development task 改变 task、work branch、remote、target branch、credential 或 protected-branch policy；禁止 force push；禁止 merge PR。

## Workspace 配置

`allow_write` 与 `allow_development` 是两条完全独立的权限。

```json
[
  {
    "id": "analysis-only-project",
    "root": "/absolute/path/to/analysis-only-project",
    "allow_write": false
  },
  {
    "id": "trusted-development-project",
    "root": "/absolute/path/to/trusted-development-project",
    "allow_write": false,
    "allow_development": true,
    "development_remote": "origin"
  },
  {
    "kind": "project_root",
    "root": "/absolute/path/to/projects"
  }
]
```

规则：

- `allow_development: true` 只允许出现在手工 `workspaces.json` 配置中；
- 开启 development 时必须同时明确 `development_remote`，不会静默默认成 `origin`；
- `development_remote` 是本机可信配置，不是 MCP 调用参数；
- managed workspace 永远没有 development 权限；
- `authorize_workspace_write` 只影响 controlled patch，不会升级 development 权限；
- MCP 不提供 `authorize_workspace_development`，远程调用方不能自我提权。

## Codex development 安全边界

只读模式保持 V1 行为：

```text
thread sandbox: read-only
turn sandboxPolicy: readOnly
networkAccess: false
```

trusted development 使用：

```text
thread sandbox: danger-full-access
turn sandboxPolicy: externalSandbox
networkAccess: enabled
approvalPolicy: never
```

这里的含义是：**Bridge 不再试图用 Codex 自身 sandbox 限制正式开发，而是把外层可信开发容器/OS sandbox 作为安全边界。** 因此只应该在已经隔离并明确允许 Git/网络操作的开发容器中开启 `allow_development`。

Interactive Codex execution receives configured proxy variables required for Codex model/control-plane connectivity:

```text
HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY
http_proxy https_proxy all_proxy no_proxy
```

Development mode additionally allows Codex to inherit:

```text
SSH_AUTH_SOCK
```

Bridge 仍不会默认转发：

```text
OPENAI_API_KEY
GH_TOKEN
GITHUB_TOKEN
```

Codex 自身认证应通过其 HOME/CODEX_HOME 持久化配置；Git/gh 凭据由外层开发环境负责。

## MCP 工具

V2 一共提供 10 个工具：

```text
run_readonly_task
run_development_task
task_result
control_task
bind_project
create_project
authorize_workspace_write
generate_controlled_patch
refine_controlled_patch
apply_controlled_patch
```

V2 **不保留 `run_task` alias**，这是有意的 breaking change：工具名本身就是给 LLM 的路由 metadata，必须明确区分只读任务和正式开发任务。

## 安装与运行

需要 Node.js 22+，以及你实际使用的本机执行器 CLI。

```sh
npm ci
npm run build
npm test
```

STDIO 启动：

```sh
node dist/src/mcp-stdio.js /absolute/path/to/workspaces.json
```

Codex 必须能从 Bridge 进程的 `PATH` 找到；development 模式还要求外层环境已经正确准备 Git remote、SSH/gh 凭据和所需代理。

## Supervisor 状态

`task_result` 对 development task 额外返回：

```json
{
  "task_kind": "development",
  "workspace_id": "data-agent",
  "work_branch": "feature/example",
  "task_contract": "tasks/DEV-001.md"
}
```

`continue` 和 `steer` 都会保留相同 task/branch/remote identity。Codex 原生 thread id 在存在时继续复用；Bridge 不维护第二份 transcript 事实源。

`task_result` 默认立即返回。需要在一次调用中等待任务可 review 时，可传 `wait_for: "ready"`，并用 `timeout_ms` 指定不超过 20 秒的上限；省略 `timeout_ms` 时使用 20 秒。超时返回最新快照并带有 `wait_timeout: true`，不会改变任务状态或中断 Codex。`include_evidence` 默认是 `true`，设为 `false` 只会省略 `evidence`。

执行中的交互任务还可返回 `live_output`，它是最新一条有界的 Codex `agentMessage` 快照，不是 transcript 或 token streaming。`continue` 开始新一轮时会清除上一轮的 `live_output`；完成后的 `review_output` 仍是最终人工 review 的权威文本。

Completed development turns also preserve the unchanged Codex final message as `review_output` and expose a separate Completion Receipt state:

```json
{
  "completion_receipt": {
    "status": "valid",
    "receipt": {
      "protocol_version": 1,
      "task_id": "DEV-001",
      "work_branch": "feature/example",
      "outcome": "success",
      "summary": "Implemented the approved change.",
      "validations": [],
      "blockers": []
    }
  }
}
```

Receipts use the `<engineering_bridge_receipt>` delimiter block and are classified as `valid`, `missing`, or `invalid`. A missing or invalid receipt does not turn a completed Codex turn into a failed task. Continuing a development task clears the previous round's current receipt until the next completed turn replaces it.

### 监督式正式任务生命周期

Codex 完成一个 turn **不等于 Task 已完成**。成功轮次先进入 `waiting_for_supervisor_review`，这是 Supervisor 检查 `review_output`、Completion Receipt、`live_output` 和 evidence 的 review gate；只有 `control_task(action="accept")` 才会把同一个 runtime task 置为 `completed`。

`control_task(action="continue")` 开始同一 Task 的新 delivery round：runtime task id、workspace、配置的 remote、work branch、Task Contract、逻辑 Task 身份和可复用的 Codex thread 保持不变。上一轮的 current receipt、live snapshot 和 evidence 会先清除，新一轮产生的新快照和最新 receipt 会替换它们。一个 Task 可以在同一 branch 上产生多个 commit；所有 continuation round 使用同一个 PR，不 force-push，Supervisor accept 时的 branch HEAD 是 accepted delivery HEAD。

`task_result(wait_for="ready")` 只在一次调用内等待 bounded 的 20 秒；超时返回最新的 non-ready snapshot 和 `wait_timeout: true`，不会修改 Task 或中断 Codex。`include_evidence: false` 只省略该次响应的 evidence，不影响 receipt、identity、review output 或 `live_output`。`live_output` 始终是最新的有界 Codex `agentMessage` 快照，不是 transcript、token streaming 或 server push。

v2.1.0 的 Active-Turn Supervisor 只保证当前 assistant turn 仍在进行时的 MCP 等待；assistant turn 已结束后，Engineering Bridge 不承诺能够唤醒 ChatGPT 对话。runtime task 和 waiter 状态仍保存在内存中，进程重启后可能丢失。Completion Receipt 是在 Bridge task-service 层按可信 `task_id` 和 `work_branch` 校验的 review metadata，不是 Codex transport 的权限授予。

## 文档

- [工具参考](docs/tools.md)
- [架构](docs/architecture.md)
- [安全设计](docs/security.md)
- [威胁模型](docs/threat-model.md)
- [Trusted Development 设计](docs/trusted-development.md)
- [Security Policy](SECURITY.md)
- [Release Notes](RELEASE_NOTES.md)

> 重要：trusted development 的安全性依赖外层开发环境。不要在包含不希望 Codex 访问的宿主机密钥、Tunnel control-plane token 或其他高价值秘密的同一安全域内直接开启 development 权限。
