# 一键安装与更新

Mathodology 使用 `vercel-labs/skills` 提供的开放 `skills` CLI 作为安装器。本仓库不维护自定义包管理器。

证据相关工作还会用到免 API key 的 `search` MCP server —— **[free-search-mcp](https://github.com/sweetcornna/free-search-mcp)**。仓库自带 `.mcp.json`，下面的项目级命令会把它和 skills 一起装好，无需手动配置 MCP，细节见[证据检索用的 Search MCP](#证据检索用的-search-mcp)。

安装有两种作用域：

- **项目级（推荐）**：只安装到当前文件夹，不触碰其他项目和用户级目录。
- **全局**：安装到当前用户的 agent 目录，影响本机所有项目。

## 项目级安装（只部署到当前文件夹）

在目标项目根目录运行。一条命令把 Mathodology 的全部内容——9 个 skills、9 个 Claude Code subagents、2 个竞赛 workflow 模板、项目级 `search` MCP 配置——只部署到该文件夹。已有的 `.mcp.json` 不会被动：

```bash
npx -y skills@latest add sweetcornna/mathodology --copy --yes --skill '*' --agent claude-code && curl -fsSL https://github.com/sweetcornna/mathodology/archive/refs/heads/main.tar.gz | tar -xz --strip-components=1 'mathodology-main/.claude/agents' 'mathodology-main/.claude/workflows' && { [ -f .mcp.json ] || curl -fsSL https://raw.githubusercontent.com/sweetcornna/mathodology/main/.mcp.json -o .mcp.json; }
```

它创建的所有文件都在当前文件夹内：

- `./.claude/skills/mathodology-*` — 9 个 skills（复制模式，无 symlink）
- `./.claude/agents/mathodology-*.md` — 9 个项目 subagents
- `./.claude/workflows/mathodology-*.md` — 2 个 workflow 模板
- `./.mcp.json` — `search` MCP server 注册；仅当项目还没有 `.mcp.json` 时写入
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

在项目根目录运行。一条命令刷新 skills、subagents 和 workflow 模板，并且仅当项目还没有 `.mcp.json` 时才写入：

```bash
npx -y skills@latest update --project --yes && curl -fsSL https://github.com/sweetcornna/mathodology/archive/refs/heads/main.tar.gz | tar -xz --strip-components=1 'mathodology-main/.claude/agents' 'mathodology-main/.claude/workflows' && { [ -f .mcp.json ] || curl -fsSL https://raw.githubusercontent.com/sweetcornna/mathodology/main/.mcp.json -o .mcp.json; }
```

更新不会重写已存在的 `.mcp.json`，所以自带 MCP 配置的项目不会被悄悄塞进新 server。若你的配置里还没有 `search` 条目，用 `claude mcp add search -- uvx free-search-mcp` 补上。MCP server 本身的更新是独立的，见[证据检索用的 Search MCP](#证据检索用的-search-mcp)。

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

如果 `skills-lock.json` 只包含 Mathodology 条目，也可以一并删除。若 `.mcp.json` 是这次安装创建的，且该项目没有别的 MCP server，也可以一并删除。

## 全局安装（影响本机所有项目）

在任意目录运行：

```bash
npx -y skills@latest add sweetcornna/mathodology --global --copy --yes --skill '*' --agent codex claude-code
```

这条命令会：

- 从 `github.com/sweetcornna/mathodology` 下载 skills
- 安装全部 9 个 skills
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
npx -y skills@latest update --global --yes mathodology-whole-project mathodology-agent-pipeline mathodology-award-gates mathodology-dev-test-release mathodology-evidence-search mathodology-gateway-api mathodology-project-orientation mathodology-skill-authoring mathodology-web-ui
```

更新所有全局安装的 skills：

```bash
npx -y skills@latest update --global --yes
```

更新后重启 Codex 或 Claude Code。

### 验证全局安装

Codex：

```bash
ls ~/.codex/skills | rg '^mathodology-'
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
- `mathodology-evidence-search`
- `mathodology-gateway-api`
- `mathodology-project-orientation`
- `mathodology-skill-authoring`
- `mathodology-web-ui`
- `mathodology-whole-project`

## 证据检索用的 Search MCP

`mathodology-evidence-search` 的证据采集与引用核验协议依赖一个名为 `search` 的 MCP server
（[free-search-mcp](https://github.com/sweetcornna/free-search-mcp)）：无需 API key 的多引擎
网页检索、页面与 PDF 阅读、出版方元数据抽取，以及到文献和数据集数据库的分类路由
（arXiv、OpenAlex、Crossref、PubMed、Zenodo）。

克隆下来无需任何配置：仓库自带 `.mcp.json`，在项目作用域注册该 server，第一次打开这个
文件夹时 Claude Code 会提示是否启用 `search`，确认一次即可用。唯一前提是 `PATH` 里有
`uv`；包本身首次运行时从 PyPI 拉取：

```bash
uv --version
```

一键 skills 安装不会把 `.mcp.json` 复制到目标项目，在那边用一条命令注册即可。Claude Code：

```bash
claude mcp add search -- uvx free-search-mcp
```

Codex：

```bash
codex mcp add search -- uvx free-search-mcp
```

确认 server 可连通后重启客户端：

```bash
claude mcp list
```

`uvx` 用的是缓存里已有的版本，所以在新版本发布前用过 `free-search-mcp` 的机器会一直停在旧版。
用一条命令刷新——`--help` 会立即退出，下次启动 server 就是刚缓存下来的版本：

```bash
uvx free-search-mcp@latest --help
```

想换成本地 checkout 或带 key 的引擎组合时，用同一个 server 名字在 local 作用域注册——
local 作用域会覆盖项目的 `.mcp.json`。浏览器渲染类引擎还需要装一次 Chromium；不装时
HTTP 检索和抓取照常可用。

该 server 是可选项。缺少 `mcp__search__*` 工具时，evidence researcher 会回退到
`WebSearch`/`WebFetch`，并在 handoff 里记录 `search_backend: builtin`，critic 会把它作为
文献覆盖度下降报告出来。

## 要求

- Node.js 和 `npx`
- 证据检索用的 `search` MCP server 需要 `uv`（可选；没有它 skills 照常安装）
- 项目级安装的 subagents/workflows 半段需要 `curl` 和 `tar`
- 能访问 GitHub 和 npm
- 对目标 skills 目录有写权限
