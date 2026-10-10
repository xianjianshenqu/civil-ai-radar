# 信源与采集合规说明

本项目的采集器只读取公开信息，并且刻意保持「摘要级」边界：订阅源取条目摘要，公告检索只存标题／链接／日期／采购人／公告类型，不抓取公告正文全文，正文阅读引导用户回到原站。所有自动结果一律待复核。

## 采集原则

- 每次运行先请求目标站 `robots.txt`：明确 Disallow 则该源失败；HTTP 404 视为无限制；超时／5xx／连接重置等瞬时故障短暂等待后重试一次，仍失败才标记该源失败。
- 仅 HTTPS；UA 为 `CivilAIRadar/1.0`；不跟随未审核的跳转。
- 公告检索类（ccgp / ggzy / szggzy / gzggzy）每个关键词独立 60 秒超时，单关键词失败只记 warning，全部失败才标 error。
- 按规范化原文链接去重；带 ETag / Last-Modified 条件请求。
- 时间窗：72 小时内首见的记录计入收录日，更早的回填保留原发布日；未知发布日期保持「未披露」。
- 每个信源独立调度：失败按 60/120/240/360 分钟退避，成功后恢复常规间隔；从未成功过的源首次导入每轮最多 30 条。

## 已接入的信源

以 `server/sources.mjs` 为准，按类型分四类：

- **RSS / Atom / RDF 订阅**：中新网（即时／国内／财经）、科学网、中国工程院院刊 Engineering 与中国工程科学、MDPI 期刊（Buildings / Infrastructures / IIC）、Frontiers in Built Environment、Nature 土木学科、ScienceDaily、Construction Dive、Global Construction Review、Construction Management、buildingSMART、Trimble Newsroom、Autodesk Construction 等。
- **政府采购检索（ccgp）**：`search.ccgp.gov.cn`，17 个 AI×土木关键词（智能建造、智慧工地、大模型、数字孪生、智能巡检、知识管理、翻译服务等）。
- **公共资源交易（ggzy / szggzy / gzggzy）**：全国公共资源交易平台聚合各省；深圳公共资源交易中心（政采 + 建设工程频道）；广州公共资源交易中心（房屋建筑／市政／交通／水利水务四个工程建设栏目）。
- **学术 API**：Crossref（仅核实过 ISSN 的国内土木期刊）与 OpenAlex（country=CN + 土木主题 ID），存摘要级元数据并链接 `doi.org`，记录保持待复核、不自动进入精选。

## 明确不采与原因

以下结论来自实测，状态可能随时间变化，重新核验前不要直接加回：

- **robots 明确禁止**：ASCE Library 的 feed 接口（`/action/showFeed` 被 Disallow）、中铁鲁班商务网、中石化易派客、中国招标投标公共服务平台。
- **领域不符**：arXiv cs.CE 属计算工程研究，不是土木行业 AI 落地情报。
- **无可用公开订阅**：多数央企总部、部委、Bentley（原 feed 失效）、ICE（403）、FHWA；不为它们编造 URL。
- **政采云系（zcy）JS SPA**：接口带签名与风控，不建议采集；地方政采公告实际已同步进 ccgp 中央检索，无需逐城直采。
- **网络可达性**：部分省级政采站对机房 IP 屏蔽（连接超时），不同网络环境结论不同，以你部署环境实测为准；全国平台对各省覆盖不全且有延迟，重要地区建议直采当地交易平台。
- **微信公众号**：无合规公开 feed，线索通过管理端人工登记（intake）录入，不抓页面、不代填字段。

## 新增信源的要求

1. 先核验：HTTPS 可达、robots.txt 允许（404 视为允许）、从部署网络实际可访问。
2. RSS 类需要真正的 XML 输出；检索类需要无需登录／签名的公开接口。
3. 在源码与 PR 中记录验证日期与实测结论；失败与禁用要在界面上如实展示原因，不静默跳过。
