# 一键安装与更新

Mathodology 使用 `vercel-labs/skills` 提供的开放 `skills` CLI 作为安装器。本仓库不维护自定义包管理器。

## 安装到 Codex 和 Claude Code

在任意目录运行：

```bash
npx -y skills@latest add sweetcornna/mathodology --skill '*' --global --agent codex --agent claude-code --copy --yes
```

这条命令会：

- 从 `github.com/sweetcornna/mathodology` 下载 skills
- 安装全部 7 个 skills
- 目标 agent 为 Codex 和 Claude Code
- 安装到当前用户的全局 skills 目录
- 使用复制模式，不创建 symlink
- 跳过交互确认

安装后重启 Codex 或 Claude Code。

`skills` CLI 安装的是 skill package。若要使用 Claude Code 项目 subagents 和 workflow 模板，请 clone 本仓库，或把 `.claude/agents/` 与 `.claude/workflows/` 复制到目标项目。

## 更新已安装 Skills

只更新 Mathodology skills：

```bash
npx -y skills@latest update -g -y mathodology-whole-project mathodology-agent-pipeline mathodology-dev-test-release mathodology-gateway-api mathodology-project-orientation mathodology-skill-authoring mathodology-web-ui
```

在 Mathodology clone checkout 中使用的完整一键更新器：

```bash
git pull --ff-only && npx -y skills@latest update -g -y mathodology-whole-project mathodology-agent-pipeline mathodology-dev-test-release mathodology-gateway-api mathodology-project-orientation mathodology-skill-authoring mathodology-web-ui
```

如果你依赖 `.claude/agents/` 或 `.claude/workflows/`，请使用完整一键更新器，因为这些项目级文件在 checkout 中，不在全局 skill package 内。

更新所有全局安装的 skills：

```bash
npx -y skills@latest update -g -y
```

更新后重启 Codex 或 Claude Code。

如果你 clone 了本仓库来使用 Claude Code 项目 subagents 和 workflow 模板，上面的完整一键更新器已经会刷新 checkout。只更新 checkout 时运行：

```bash
git pull --ff-only
```

然后把 `.claude/agents/` 和 `.claude/workflows/` 复制到需要使用这些项目级资产的目标项目。

## 只安装到一个 Agent

只安装到 Codex：

```bash
npx -y skills@latest add sweetcornna/mathodology --skill '*' --global --agent codex --copy --yes
```

只安装到 Claude Code：

```bash
npx -y skills@latest add sweetcornna/mathodology --skill '*' --global --agent claude-code --copy --yes
```

## 安装到所有支持的 Agent

只有在你希望把 skills 安装到本机所有支持的 agent 目录时才使用：

```bash
npx -y skills@latest add sweetcornna/mathodology --skill '*' --global --agent '*' --copy --yes
```

## 只列出 Skills，不安装

```bash
npx -y skills@latest add sweetcornna/mathodology --list
```

预期 skills：

- `mathodology-agent-pipeline`
- `mathodology-dev-test-release`
- `mathodology-gateway-api`
- `mathodology-project-orientation`
- `mathodology-skill-authoring`
- `mathodology-web-ui`
- `mathodology-whole-project`

## 验证安装

Codex 全局安装：

```bash
ls ~/.agents/skills | rg '^mathodology-'
```

Claude Code 全局安装：

```bash
ls ~/.claude/skills | rg '^mathodology-'
```

如果目标 skill 已经存在且 update 不够用，先删除再重新安装：

```bash
npx -y skills@latest remove --global --agent codex mathodology-whole-project --yes
npx -y skills@latest add sweetcornna/mathodology --skill mathodology-whole-project --global --agent codex --copy --yes
```

## 要求

- Node.js 和 `npx`
- 能访问 GitHub 和 npm
- 对目标 agent skills 目录有写权限
