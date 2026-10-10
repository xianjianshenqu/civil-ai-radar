# 土木 AI 雷达（Civil AI Radar）

面向土木与基础设施行业的 AI 落地情报与采购线索雷达：自动采集公开信源（行业媒体、期刊、政府采购与公共资源交易平台），用可解释的销售价值评分辅助人工复核，提供中英双语阅读、日报／周报／月报、采购公告分道视图，并通过匿名只读的 REST API / MCP / RSS 对外输出，供 AI Agent 与其他系统接入。

本目录是 [SWK-Skill](../README.md) 仓库中的一个项目。

## 功能特性

- **多源采集**：RSS 2.0 / Atom / RSS 1.0 (RDF) 订阅；中国政府采购网（ccgp）检索、全国公共资源交易平台（ggzy）、深圳／广州交易中心等公告源；Crossref / OpenAlex 学术接口。robots.txt 合规检查、每关键词独立超时、按源失败退避与补抓。详见 [docs/COLLECTORS.md](docs/COLLECTORS.md)。
- **人工复核红线**：机器输出永不写「已核验」「可破冰」「编辑置顶」；一切自动采集结果默认待复核，人工审核台支持 P0–P3 分级、批量发布／驳回、驳回可恢复。
- **双通道评分**：规则评分 + 大模型独立复评（可选、可关），P0–P3 分级、低价值自动归档、每日调用上限与付费调用台账。
- **翻译**：自托管 LibreTranslate 或任意 OpenAI 兼容模型；站点级配置与用户自带 Key 双通道，译文标注「机器翻译 · 待校对」。
- **阅读与情报视图**：AI 日报／周报／月报、热点榜（销售价值排序，非实时热度）、采购公告（招标窗口／中标落地／更正与其他）、跨来源重复公告合并、主题库与领域筛选。
- **账号体系**：邮箱验证码登录、SQLite 存储、每日数据库备份；收藏／关注／笔记登录后同步，未登录保存在浏览器本地。
- **Agent 接入层**：`/api/v1` 匿名只读 REST（含 OpenAPI 文档）、`/api/mcp` Streamable HTTP、`/llms.txt` 与 Skill 包、`/rss.xml` 与 `/sitemap.xml`；限流 + ETag 缓存。
- **部署**：Docker Compose 一键部署（Caddy 自动 HTTPS 独立模式，或接入已有 nginx／宝塔的反代模式）。

## 快速开始（本地开发）

需要 Node.js 22+（建议 24+，使用内置 `node:sqlite`）。在本目录内执行：

```bash
cd civil-ai-radar
npm install

# 终端 1：前端 http://127.0.0.1:5173
npm run dev

# 终端 2：后端 http://127.0.0.1:8791
npm run dev:api
```

本地后端默认 `MAIL_MODE=local`：用 `admin@example.test`（或任意 `名字@example.test`）登录，验证码进入本地测试收件箱，仅在页面内查看。管理员登录后可在「Agent 中心」管理采集与信源。

可选本地机器翻译（Argos Translate）：`npm run dev:translate` 后设置 `TRANSLATION_URL=http://127.0.0.1:5001/translate`。

## 测试与构建

在本目录内执行：

```bash
npm run test:all          # 全部单元测试（后端、采集器、评分、Agent 层等）
npm run test:radar-data   # 演示数据结构校验
npm run build             # 生产构建 + Sites 静态包
npm run test:sites        # Sites 静态 worker 测试
npm run eval:thresholds   # 用人工审核结论回放评分阈值（只读）
```

CI 在仓库根的 [.github/workflows/ci.yml](../.github/workflows/ci.yml) 同时运行上述 Node 检查与同仓库 `enterprise-business-proposal` 技能的 Python 测试。

## 生产部署

见 [BACKEND-SETUP.md](BACKEND-SETUP.md) 与 `.env.production.example`。要点：

1. 复制 `.env.production.example` 为 `.env.production`，填好域名、管理员邮箱与发信服务（SMTP 或 Resend）。
2. `./scripts/deploy-remote.sh root@服务器IP`（独立服务器，Caddy 自动 HTTPS）或加 `--proxy`（与已有站点共用服务器，radar 只监听 `127.0.0.1:8791`）。
3. 上线后在「设置」页填大模型 API Key（密钥只存服务器数据库，不随部署迁移）。

部署在中国内地需完成 ICP 备案并在页脚（`src/components/RadarApp.jsx` 的 `.site-footer`）挂自己的备案号。

## 数据边界与产品原则

这个项目刻意保持以下红线，贡献代码时请不要破坏：

- **机器不冒充人**：自动评分、机器整理、模型摘要都是假设与线索，永不写「已核验」「可破冰」「编辑置顶」，采集条目保持待复核。
- **词频不等于事实**：关键词或名单命中只是计分线索，绝不构成某单位参与某项目的证据；主题与观察名单的自动匹配只代表主题相关。
- **不虚构**：未知日期保持「未披露」，缺失指标不编造，不抓取正文全文（公告类只存检索结果摘要），不生成假热度／假引用。
- **个人数据边界**：收藏、关注、笔记在未连接账号同步时只存浏览器本地；本地测试邮箱不用于生产身份验证。

## Agent 接入

任何 AI Agent 可匿名只读接入本站公开池（以你部署的域名为 base URL）：

| 通道 | 路径 |
| --- | --- |
| REST API v1（含 OpenAPI） | `/api/v1/openapi.json`、`/api/v1/items`、`/api/v1/hotspots`、`/api/v1/procurement`、`/api/v1/dailies` |
| MCP（Streamable HTTP） | `/api/mcp`，工具含 `radar_get_latest` / `radar_search` / `radar_get_item` 等 |
| LLM 站点说明 | `/llms.txt` |
| Agent Skill 包 | `/skills/civil-radar/SKILL.md`（由服务端动态输出，部署后即可安装） |
| 订阅 | `/rss.xml`、`/sitemap.xml` |

匿名只读、按 IP 限流；不含任何人工销售标注或非公开字段。

## 目录结构

```
src/            React + Vite 前端（components/ 视图、lib/ 业务逻辑、data/ 演示数据）
server/         Node 后端（采集器 collector/procurement/ggzy/…、审核 review、翻译 translation、
                机器审阅 machineReview、账号 auth、Agent 接入层 agentAccess、feeds）
worker/         Sites 静态演示版（不含后台功能，见 .openai/hosting.json）
scripts/        部署、本地翻译、数据校验与阈值回放脚本
tests/          node --test 单元测试
docs/           信源与采集合规说明
```

## 演示数据说明

`src/data/` 下的动态、精读与主题为演示内容（默认隐藏、明确标注演示）；`src/data/orgWatchlist.js` 是示例观察名单，仅用于展示数据结构与计分链路，请按自身业务整表替换。首次采集运行会以真实公开数据逐步填充站点。

## 许可证

[MIT](../LICENSE)。
