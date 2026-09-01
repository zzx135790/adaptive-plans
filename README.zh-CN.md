# Adaptive Writing Plans（自适应写作计划）

多阶段不确定性工作的自适应规划工作流 —— 将讨论、已批准的设计和规格说明转化为带有持久项目状态的实施计划。

## 功能特性

- **自适应规划文件夹**：将稳定的方向与后续发现的细节分离
- **多阶段映射**：为不确定的依赖和渐进式波次提供 DAG 拓扑
- **上下文作用域的 MCP**：无全局状态的并发多项目服务
- **宿主中立**：Codex 和 Claude Code 双平台可移植插件
- **Provider 组合**：验证工作流结果，绝不自动安装
- **自动事件钩子**：记录工具完成、上下文压缩和轮次结束到审计日志

## 安装

### 方式 1：官方插件命令（推荐）

#### Claude Code

```bash
# 添加 marketplace
claude plugin marketplace add https://github.com/zzx135790/adaptive-plans.git

# 安装插件
claude plugin install adaptive-writing-plans@adaptive-plans-local
```

插件将自动安装到 `~/.claude/plugins/`，MCP 服务器自动配置。

#### Codex

如果您的主目录包含 `.agents/plugins/marketplace.json`，插件在 `personal` marketplace 中可用：

```bash
# 安装插件
codex plugin add adaptive-writing-plans@personal
```

或者手动编辑 `~/.agents/plugins/marketplace.json` 添加到个人 marketplace：

```json
{
  "name": "personal",
  "plugins": [
    {
      "name": "adaptive-writing-plans",
      "source": {
        "source": "local",
        "path": "./plugins/adaptive-writing-plans"
      },
      "category": "Productivity"
    }
  ]
}
```

然后克隆此仓库到 `~/plugins/adaptive-writing-plans`。

### 方式 2：手动安装（符号链接）

#### Claude Code

```bash
# 克隆仓库
git clone https://github.com/zzx135790/adaptive-plans.git
cd adaptive-plans

# 链接到 Claude Code
ln -s "$(pwd)/plugins/adaptive-writing-plans" ~/.claude/plugins/adaptive-writing-plans
```

在 `~/.claude/settings.json` 中添加 MCP 服务器：

```json
{
  "mcpServers": {
    "adaptive-planning": {
      "command": "node",
      "args": ["~/.claude/plugins/adaptive-writing-plans/mcp/server-sdk.mjs"],
      "tool_timeout_sec": 120
    }
  }
}
```

#### Codex

```bash
# 克隆仓库
git clone https://github.com/zzx135790/adaptive-plans.git
cd adaptive-plans

# 链接到 Codex
ln -s "$(pwd)/plugins/adaptive-writing-plans" ~/.codex/plugins/adaptive-writing-plans
```

Codex 会自动从插件目录发现 MCP 元数据。

## 使用

当需要以下操作时，通过 `/adaptive-writing-plans` 调用技能：

- 将需求讨论转化为实施计划
- 映射具有不确定依赖的多阶段工作
- 在迭代发现细节的同时保持稳定的项目方向

该技能路由到：
- **guide**：需求阻塞时，澄清目标、范围、约束
- **map**：为多阶段或长期工作创建 DAG 拓扑
- **plan**：为单个就绪节点生成叶计划
- **direct**：小型明确任务立即执行

## 事件钩子

插件自动将事件记录到 `events.jsonl`，用于审计追踪和跨会话恢复：

- **Claude Code**：通过 `hooks/hooks.json` 自动配置（无需手动设置）
- **Codex**：需要在 `~/.codex/config.toml` 中手动配置

**记录的事件**：
- 工具完成（成功/失败）
- 上下文压缩
- 轮次结束

详细配置和故障排除请参见 [hooks/README.md](plugins/adaptive-writing-plans/hooks/README.md)。

钩子失败不会阻塞主工作流。

## 从 0.2.x 迁移

**0.3.0 中的破坏性变更：**

1. **MCP 现在是上下文作用域的**：每个工具调用需要 `context: { project_root, plan_path }`。不再使用全局环境变量 `ADAPTIVE_PLAN_ROOT`、`ADAPTIVE_PROJECT_ROOT`。

2. **移除了 Host-sync 适配器**：删除了 `planHostAdapter`、`syncHostAdapter`、`HOST_PROFILES` 和 `npm run host:sync`。请使用插件安装命令代替。

3. **Provider 组合**：`verifyProviderWorkflowOutcome` 从 `host-adapter.mjs` 移动到 `provider-composition.mjs`。需要更改导入路径。

**迁移步骤：**

```bash
# 卸载 0.2.x
rm -rf ~/.claude/skills/adaptive-writing-plans
rm -rf ~/.agents/skills/adaptive-writing-plans

# 按照上述说明安装 0.3.0

# 更新 MCP 配置以使用上下文作用域服务器
# 新的 .mcp.json 格式请参见安装部分
```

## 许可证

MIT

## 版本

0.3.0 — 上下文作用域 MCP、宿主中立打包、Provider 组合
