# Adaptive Plans

Adaptive Plans 面向依赖、证据和范围会随执行逐步明确的工作，提供自适应规划工作流。

`adaptive-writing-plans` 是精简核心：对于清晰且范围有限的工作，优先直接执行；只有在协调收益明确时才进入 guide、map 或 plan；当存在两个或更多安全且相互独立的节点时并行派发。它优先选择宿主中可见的技能；没有合适技能时才使用受限的 Ada fallback。

`adaptive-planning-governance` 是独立的可选插件，适合需要治理控制的团队。安装核心不会安装治理插件。

所有工作都保留四项不可降低的安全底线：限制失控的资源成本、结果无效时明确失败、防止凭据泄露、防止破坏性数据丢失。生命周期 hooks 默认禁用。

## 安装

### Claude Code

```bash
claude plugin marketplace add https://github.com/zzx135790/adaptive-plans.git
claude plugin install adaptive-writing-plans@adaptive-plans-local
# 可选：需要治理控制时单独安装。
claude plugin install adaptive-planning-governance@adaptive-plans-local
```

更新 marketplace 和已安装插件：

```bash
claude plugin marketplace update adaptive-plans-local
claude plugin update adaptive-writing-plans@adaptive-plans-local
claude plugin update adaptive-planning-governance@adaptive-plans-local
```

### Codex

```bash
codex plugin marketplace add https://github.com/zzx135790/adaptive-plans.git --ref v0.5.0
codex plugin add adaptive-writing-plans@adaptive-plans-local
# 可选：需要治理控制时单独安装。
codex plugin add adaptive-planning-governance@adaptive-plans-local
```

刷新 Git marketplace：

```bash
codex plugin marketplace upgrade adaptive-plans-local
```

安装或更新后，请新开一个 Claude Code 或 Codex 会话，使技能和配置生效。

## 使用

在需要实施规划时调用 `adaptive-writing-plans`。它会先直接执行小型明确任务；只有多个依赖阶段需要协调时才创建 map；当有两个安全且相互独立的节点时，明确采用并行派发。

计划会根据当前会话可见的 skill 名称和描述，把会改变执行方式或产物的实质行为显式绑定到 skill，例如 `诊断失败 -> systematic-debugging`、`审阅论文 -> academic-paper-review`。没有匹配项时显示具名 Ada fallback；不会扫描、安装或猜测隐藏 skill。Direct 任务只在开工前显示一行绑定，不创建计划文件。

默认信任标准库、成熟依赖和仓库中已有验证记录的操作。只有观察到失败、版本或契约冲突、或者明确安全边界时，才增加局部验证；否则不自动添加 wrapper、guard、自建替代实现或重复检查。

## 许可证

MIT
