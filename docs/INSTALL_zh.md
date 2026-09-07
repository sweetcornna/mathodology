# 安装与更新

使用标准 [skills CLI](https://github.com/vercel-labs/skills)。完整仓库提供 8 个技能、
8 个可选 Claude Code 角色、2 份工作提示词和项目 search MCP 配置，不运行自定义更新器。

## 使用完整仓库

```bash
git clone https://github.com/sweetcornna/mathodology.git
cd mathodology
```

Claude Code 可读取项目技能与角色。Codex 可从当前仓库安装本地技能副本：

```bash
npx -y skills@latest add . --copy --yes --skill '*' --agent codex
```

唯一维护源仍是 `.claude/skills/`，Codex 副本位于忽略跟踪的 `.agents/skills/`。
更新后重启或刷新宿主的技能发现。项目 MCP 配置是否自动读取取决于宿主。

## 安装到已有项目

在目标项目中，选择对应宿主的命令：

```bash
npx -y skills@latest add sweetcornna/mathodology --copy --yes --skill '*' --agent claude-code
npx -y skills@latest add sweetcornna/mathodology --copy --yes --skill '*' --agent codex
```

命令安装技能及其参考资料、样张，不复制根 AGENTS.md、项目角色、工作流或
MCP 配置。不要覆盖目标项目的指引和自定义 MCP 设置。可选角色与工作流可在
检查目标路径冲突后从仓库复制；只把需要的建模指引合入已有项目说明。

确实需要全局安装时，为选定命令增加 `--global`。它会影响其他项目，项目使用
无需此选项；全局安装同样不安装项目角色或 MCP 配置。

## 证据工具

仓库 `.mcp.json` 通过 `uvx` 注册 [free-search-mcp](https://github.com/sweetcornna/free-search-mcp)，
需要环境可使用 uv，并启用本地暂存下载目录。宿主可能需要用户启用服务器。
检索无需密钥，但各底层引擎仍可能不可用；证据技能记录真实覆盖，也可继续
使用内置搜索。

仅安装技能时，可通过宿主 MCP 设置注册服务器。对应 CLI 可用时，标准命令为：

```bash
claude mcp add --transport stdio --env "SEARCH_MCP_DOWNLOAD_DIR=$HOME/.cache/search-mcp/downloads" search -- uvx free-search-mcp
codex mcp add --env "SEARCH_MCP_DOWNLOAD_DIR=$HOME/.cache/search-mcp/downloads" search -- uvx free-search-mcp
```

只执行对应宿主和目标作用域的命令，先检查已有服务器设置，不替换自定义
配置或用户主动关闭的下载功能。仓库不安装 image2 服务；agent 会在绘图时
询问实际工具、已配置接口或手动使用方式。

## 更新和迁移

先备份本地修改。干净的仓库副本使用：

```bash
git status --short
git pull --ff-only
```

无法快进时，不要 reset 或丢弃本地成果。已安装的技能副本应先备份 Mathodology
目录，再用上方命令从选定来源重新安装；对照新技能列表，在备份后移除已经
退休的 Mathodology 条目。其他技能、自定义设置和全局安装不动。只更新本项目
时，不使用会更新所有已装技能的宽泛命令。

本仓库的 Codex 镜像 `.agents/skills/mathodology-*` 需单独备份，再从
`.claude/skills/` 刷新这些条目。源码备份不包含被忽略的镜像。备份中的自定义
内容需明确处理，不把镜像当作另一份维护源。

[备份](BACKUP_zh.md) · [技能](SKILLS_zh.md) · [工作提示词](WORKFLOWS_zh.md)
