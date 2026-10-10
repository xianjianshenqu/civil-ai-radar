# SWK-Skill

SWK（思沃克）的 AI 项目与 Agent Skill 合集。一个内容一个文件夹，各文件夹自带说明，可独立使用。

| 文件夹 | 类型 | 说明 |
| --- | --- | --- |
| [civil-ai-radar/](civil-ai-radar/) | 可部署的完整项目 | 土木 AI 雷达：自动采集行业资讯与采购公告、销售价值评分、人工复核、中英双语阅读、日报／周报／月报，匿名只读 REST / MCP / RSS 对外输出 |
| [enterprise-business-proposal/](enterprise-business-proposal/SKILL.md) | Agent Skill | 企业商务方案制作／审查：`create`、`review/audit`、`review/revise` 三种模式，区分事实／假设／待确认信息，附报价算术校验脚本 |

## Agent Skill：enterprise-business-proposal

帮助销售和售前人员快速制作、审查和优化 To B 企业商务方案，面向大中型企业、国企、央企和复杂决策链客户。它不是法律合同生成器、完整投标文件系统、消费级报价工具或融资商业计划书工具。

安装（使用开源 [Skills CLI](https://github.com/vercel-labs/skills)；安装第三方 Skill 前应先检查来源和文件内容）：

```text
# 交互式安装（不确定平台时）
npx skills add xianjianshenqu/swk-skill -g

# 安装到 Claude Code
npx skills add xianjianshenqu/swk-skill --skill enterprise-business-proposal -g -a claude-code -y --copy

# 安装到 Codex
npx skills add xianjianshenqu/swk-skill --skill enterprise-business-proposal -g -a codex -y --copy

# 同时安装到 Codex、Claude Code、Gemini CLI 和 CodeBuddy
npx skills add xianjianshenqu/swk-skill --skill enterprise-business-proposal -g -a codex -a claude-code -a gemini-cli -a codebuddy -y --copy
```

手动安装：下载本仓库，把 [`enterprise-business-proposal/`](enterprise-business-proposal/) 目录复制到对应平台的技能目录（如 `~/.claude/skills/`、`~/.codex/skills/`）。技能自带单元测试与示例报价（Python 3.10+）：`python3 -m unittest discover -s enterprise-business-proposal/tests`。

该 Skill 最初发布于 [enterprise-business-proposal-skill](https://github.com/xianjianshenqu/enterprise-business-proposal-skill)（已归档），历史 Release 安装包仍可在旧仓库下载；后续更新只在本仓库进行。

## civil-ai-radar（土木 AI 雷达）

完整的项目说明、本地开发、测试、Docker 部署与数据边界见 [civil-ai-radar/README.md](civil-ai-radar/README.md)。部署实例还内置一个由服务端动态输出的 `civil-radar` 查询技能（`/skills/civil-radar/SKILL.md`），详见项目 README 的「Agent 接入」。

## 许可证

[MIT](LICENSE)。`enterprise-business-proposal/` 内附带该 Skill 的原始版权声明（MIT，© 2026 广州思沃克科技有限公司）。
