# 一键安装与更新

Mathodology 使用 `vercel-labs/skills` 提供的开放 `skills` CLI 作为安装器。本仓库不维护自定义包管理器。

安装有两种作用域：

- **项目级（推荐）**：只安装到当前文件夹，不触碰其他项目和用户级目录。
- **全局**：安装到当前用户的 agent 目录，影响本机所有项目。

## 项目级安装（只部署到当前文件夹）

在目标项目根目录运行。一条命令把 Mathodology 的全部内容——8 个 skills、9 个 Claude Code subagents、2 个竞赛 workflow 模板——只部署到该文件夹：

```bash
npx -y skills@latest add sweetcornna/mathodology --copy --yes --skill '*' --agent claude-code && curl -fsSL https://github.com/sweetcornna/mathodology/archive/refs/heads/main.tar.gz | tar -xz --strip-components=1 'mathodology-main/.claude/agents' 'mathodology-main/.claude/workflows'
```

它创建的所有文件都在当前文件夹内：

- `./.claude/skills/mathodology-*` — 8 个 skills（复制模式，无 symlink）
- `./.claude/agents/mathodology-*.md` — 9 个项目 subagents
- `./.claude/workflows/mathodology-*.md` — 2 个 workflow 模板
- `./skills-lock.json` — `skills` CLI 的项目 lockfile

不会写入 `~/.claude/`、`~/.agents/` 或任何其他项目。

只要 skills、不要 subagents 和 workflow 模板时，去掉后半段：

```bash
npx -y skills@latest add sweetcornna/mathodology --copy --yes --skill '*' --agent claude-code
```

Codex 的项目级安装目标是 `./.agents/skills/`：

```bash
npx -y skills@latest add sweetcornna/mathodology --copy --yes --skill '*' --agent codex
```

安装后在该项目里重启 Claude Code（或 Codex）。

### 更新项目级安装

在项目根目录运行：

```bash
npx -y skills@latest update --project --yes
```

subagents 和 workflow 模板的刷新：重新运行安装命令里 `curl ... | tar ...` 的后半段。

### 验证项目级安装

```bash
ls .claude/skills | rg '^mathodology-'
ls .claude/agents .claude/workflows
```

### 移除项目级安装

项目级文件是纯复制，直接在项目内定向删除即可：

```bash
rm -rf .claude/skills/mathodology-* .claude/agents/mathodology-*.md .claude/workflows/mathodology-*.md
```

如果 `skills-lock.json` 只包含 Mathodology 条目，也可以一并删除。

## 全局安装（影响本机所有项目）

在任意目录运行：

```bash
npx -y skills@latest add sweetcornna/mathodology --global --copy --yes --skill '*' --agent codex claude-code
```

这条命令会：

- 从 `github.com/sweetcornna/mathodology` 下载 skills
- 安装全部 8 个 skills
- 目标 agent 为 Codex 和 Claude Code
- 安装到当前用户的全局 skills 目录
- 使用复制模式，不创建 symlink
- 跳过交互确认

安装后重启 Codex 或 Claude Code。

`skills` CLI 安装的是 skill package。若要使用 Claude Code 项目 subagents 和 workflow 模板，请使用上面的项目级安装，或从 checkout 把 `.claude/agents/` 与 `.claude/workflows/` 复制到目标项目。

查看 CLI 帮助：

```bash
npx -y skills@latest --help
```

不要把 `skills add <repo> --help` 当成帮助命令使用。当前 `skills` CLI 版本可能会把这种形式当成安装命令，并生成项目本地 `.agents/` 和 `skills-lock.json` 文件。

### 更新全局安装

只更新 Mathodology skills：

```bash
npx -y skills@latest update --global --yes mathodology-whole-project mathodology-agent-pipeline mathodology-award-gates mathodology-dev-test-release mathodology-gateway-api mathodology-project-orientation mathodology-skill-authoring mathodology-web-ui
```

更新所有全局安装的 skills：

```bash
npx -y skills@latest update --global --yes
```

更新后重启 Codex 或 Claude Code。

### 验证全局安装

Codex：

```bash
ls ~/.agents/skills | rg '^mathodology-'
```

Claude Code：

```bash
ls ~/.claude/skills | rg '^mathodology-'
```

如果目标 skill 已经存在且 update 不够用，先删除再重新安装：

```bash
npx -y skills@latest remove --global --yes --skill mathodology-whole-project --agent codex
npx -y skills@latest add sweetcornna/mathodology --global --copy --yes --skill mathodology-whole-project --agent codex
```

## 其他目标

全局安装到本机所有支持的 agent 目录：

```bash
npx -y skills@latest add sweetcornna/mathodology --global --copy --all
```

只列出 skills，不安装：

```bash
npx -y skills@latest add sweetcornna/mathodology --list
```

预期 skills：

- `mathodology-agent-pipeline`
- `mathodology-award-gates`
- `mathodology-dev-test-release`
- `mathodology-gateway-api`
- `mathodology-project-orientation`
- `mathodology-skill-authoring`
- `mathodology-web-ui`
- `mathodology-whole-project`

## 要求

- Node.js 和 `npx`
- 项目级安装的 subagents/workflows 半段需要 `curl` 和 `tar`
- 能访问 GitHub 和 npm
- 对目标 skills 目录有写权限
