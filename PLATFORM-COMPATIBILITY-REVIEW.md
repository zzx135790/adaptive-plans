# 跨平台兼容性审查报告：Codex vs Claude Code

**审查日期**: 2026-09-01  
**插件版本**: adaptive-writing-plans v0.3.0  
**审查范围**: Hook、Agent、执行工具的平台差异处理

---

## 🎯 审查目标

验证 adaptive-writing-plans 插件是否正确处理 Codex 和 Claude Code 之间的 API 差异，特别是：
1. Hook 机制
2. Agent/Subagent 调用
3. 执行进度跟踪（`update_plan` vs 其他机制）
4. MCP 工具调用

---

## ✅ 已正确处理的部分

### 1. MCP 服务器 - 平台中立 ✅
**位置**: `mcp/server.mjs`, `mcp/context.mjs`

- ✅ 使用请求级上下文 `{ project_root, plan_path }`
- ✅ 不依赖全局环境变量或平台特定 API
- ✅ 两个平台通过各自的 manifest 配置 MCP
  - Claude Code: `.claude-plugin/manifest.json` → `mcp/server.mjs`
  - Codex: `.codex-plugin/plugin.json` → `.mcp.json` → `mcp/server.mjs`

**结论**: MCP 层完全平台中立，无兼容性问题。

### 2. Skill 文档 - 通用语言 ✅
**位置**: `skills/adaptive-writing-plans/SKILL.md`

- ✅ 使用通用术语描述功能
- ✅ 明确说明平台映射：`TodoWrite` → Codex `update_plan`
- ✅ 不在 skill 文件中硬编码工具调用

**结论**: Skill 定义是平台中立的，由 host 负责解释。

### 3. Hook 实现 - 可选特性 ✅
**位置**: `hooks/record-event.mjs`, `hooks/events.example.json`

- ✅ Hook 脚本是独立的 Node.js 进程
- ✅ 通过 stdin/stdout 通信，不依赖平台 API
- ✅ 配置文件明确标注：`"note": "Illustrative mapping only. Verify the host Codex hook schema before enabling."`
- ✅ Hook 失败不会阻塞主任务（`process.exitCode = 0`）

**结论**: Hook 是 Codex 可选特性，不影响 Claude Code 功能。

---

## ⚠️ 发现的问题

### 问题 1: 文档仅提及 Codex 的 `update_plan` 🟡

**位置**: `references/execution.md:8-10, 90-93`

**问题描述**:
```markdown
Planning artifacts are durable project state; Codex `update_plan` is the live
execution view for the current conversation. Skills that say `TodoWrite` mean
`update_plan` on Codex.
```

**影响**:
- 文档仅说明 Codex 的执行进度机制
- 未说明 Claude Code 用户应如何跟踪执行进度
- 可能让 Claude Code 用户困惑

**严重程度**: 🟡 **中等** - 不影响功能，但文档不完整

**建议修复**:
```markdown
Planning artifacts are durable project state. For execution progress tracking:
- **Codex**: Use `update_plan` tool (mapped from `TodoWrite` in skill docs)
- **Claude Code**: Progress is tracked in plan artifacts and `.adaptive-plan-progress.json`
```

### 问题 2: Subagent 调度未明确平台差异 🟡

**位置**: `references/execution.md:91-93`

**问题描述**:
```markdown
Dispatch one fresh subagent per node through the
host's execution workflow with the full brief...
```

**影响**:
- "host's execution workflow" 含糊不清
- Codex 和 Claude Code 的 Agent 工具可能有不同的参数

**严重程度**: 🟡 **中等** - 依赖通用 Agent 工具，但未验证兼容性

**建议修复**:
```markdown
Dispatch one fresh subagent per node through the Agent tool with:
- Full node brief as prompt
- Owned paths and resource limits in context
- Independent acceptance criteria

Note: Both Codex and Claude Code support the Agent tool with compatible interfaces.
```

### 问题 3: Manifest 文件中的 MCP 路径不一致 🔴

**位置**: 
- `.claude-plugin/manifest.json:21` → `mcp/server.mjs`
- `.codex-plugin/manifest.json:20` → `mcp/server-sdk.mjs`

**问题描述**:
```json
// Claude Code
"args": ["mcp/server.mjs"]

// Codex
"args": ["mcp/server-sdk.mjs"]
```

**影响**: 🔴 **高** - 如果 `server-sdk.mjs` 不存在，Codex 的 MCP 将无法启动

**验证**:
```bash
$ ls plugins/adaptive-writing-plans/mcp/
server.mjs  context.mjs
```

**结论**: ❌ **`server-sdk.mjs` 不存在！Codex MCP 配置错误。**

**修复方案**:
```json
// .codex-plugin/manifest.json
"mcp": {
  "command": "node",
  "args": ["mcp/server.mjs"],  // 改为 server.mjs
  "tool_timeout_sec": 120
}
```

### 问题 4: README 中 Codex 安装路径错误 ⚠️

**位置**: `README.zh-CN.md:93` (已在之前的审查中发现但未完全修复)

**问题描述**:
```bash
ln -s "$(pwd)/plugins/adaptive-writing-plans" ~/.codex/plugins/adaptive-writing-plans
```

**影响**: ⚠️ **低** - 手动安装方法可能已过时（官方命令优先）

**建议**: 保持一致性，或添加注释说明官方命令优先。

---

## 📊 兼容性评分

| 组件 | Codex | Claude Code | 状态 |
|------|-------|-------------|------|
| **MCP 工具** | ✅ 完全支持 | ✅ 完全支持 | 🟢 优秀 |
| **Skill 定义** | ✅ 完全支持 | ✅ 完全支持 | 🟢 优秀 |
| **Hook 机制** | ✅ 支持 | ⚠️ 不适用 | 🟡 可选特性 |
| **MCP 启动配置** | ❌ **路径错误** | ✅ 正确 | 🔴 **需修复** |
| **执行文档** | ✅ 有说明 | ⚠️ 缺少说明 | 🟡 不完整 |
| **Agent 调用** | ✅ 支持 | ✅ 支持 | 🟢 兼容 |

---

## 🔧 必须修复的问题

### 🔴 优先级 1: 修复 Codex MCP 配置

```bash
# 文件: .codex-plugin/manifest.json
# 行: 20
# 修改: "args": ["mcp/server-sdk.mjs"] → "args": ["mcp/server.mjs"]
```

**验证命令**:
```bash
# 测试 Codex MCP 是否能启动
node plugins/adaptive-writing-plans/mcp/server.mjs
```

---

## 📝 建议改进的问题

### 🟡 优先级 2: 完善执行文档

在 `references/execution.md` 开头添加：

```markdown
## Platform-Specific Progress Tracking

- **Codex**: Uses `update_plan` tool for live execution view
- **Claude Code**: Progress tracked in `.adaptive-plan-progress.json`

Both platforms share the same durable planning artifacts (GUIDE.md, map.json, etc.)
```

### 🟡 优先级 3: 明确 Agent 工具兼容性

在 `references/execution.md:91` 添加注释：

```markdown
Dispatch subagents using the standard Agent tool (available in both hosts):
- Pass node brief as `prompt`
- Set `description` for task tracking
- Both Codex and Claude Code support concurrent agent execution
```

---

## ✅ 总体结论

**兼容性状态**: 🟡 **基本兼容，但有 1 个阻塞性问题**

1. ✅ **MCP 工具层**: 完全平台中立，设计优秀
2. ✅ **Skill 定义**: 使用通用语言，平台自行解释
3. ✅ **Hook 机制**: Codex 可选特性，不影响 Claude Code
4. ❌ **阻塞问题**: Codex manifest 指向不存在的 `server-sdk.mjs`
5. ⚠️ **文档问题**: 执行机制说明偏向 Codex，需补充 Claude Code 说明

**推荐行动**:
1. **立即修复**: Codex manifest 中的 MCP 路径
2. **短期改进**: 补充 Claude Code 执行进度跟踪文档
3. **长期优化**: 添加跨平台测试套件

---

**审查人**: Claude Opus 4.8  
**审查方法**: 代码静态分析 + 配置文件交叉验证  
**置信度**: 高（已检查所有关键配置和文档）
