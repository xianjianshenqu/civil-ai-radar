import {useState} from 'react';
import {IconCheck} from '@tabler/icons-react';
import {AGENT_VERSION} from '../lib/agentVersion.js';

// Agent 接入指南（2026-09-30，参考 AIHOT /agent）：公开页，四条匿名只读接入路径。
// 端点契约与 server/agentAccess.mjs 一一对应；文案保持「接口能什么/不能什么」一次说清。
function CodeBlock({label, text}) {
  const [copied, setCopied] = useState(false);
  return <div className="code-block">
    <div className="code-block-head"><span>{label}</span><button type="button" onClick={async()=>{try{await navigator.clipboard.writeText(text);setCopied(true);setTimeout(()=>setCopied(false),2000);}catch{/* 剪贴板不可用时手动选择复制 */}}}>{copied?'已复制':'复制'}</button></div>
    <pre><code>{text}</code></pre>
  </div>;
}
const ENDPOINT_ROWS=[
  ['/api/v1/items','公开池条目。mode=featured（默认，今日精选池）|all（全部公开池）；window=24h|7d|30d|all；limit≤100；q=关键词（≤64 字）'],
  ['/api/v1/hotspots','热点榜：销售推荐事件 ≤10 条；window=2|7|all（自然日）。自动评分，非实时热度'],
  ['/api/v1/hotspot','短路径别名，行为同 /api/v1/hotspots'],
  ['/api/v1/dailies','日 / 周 / 月报索引；period=daily|weekly|monthly。按首次公开日期归档'],
  ['/api/v1/dailies/latest','最新一期报告内容'],
  ['/api/v1/daily','短路径别名，行为同 /api/v1/dailies/latest（支持同样的 period）'],
  ['/api/v1/dailies/{date}','按日期取报告（周期内任一天均可）'],
  ['/api/v1/procurement','采购公告摘要；noticeClass=tender|result|other|all，window=7d|30d|all。检索摘要，不是公告全文'],
  ['/api/v1/procurements','短路径别名，行为同 /api/v1/procurement'],
  ['/api/v1/items/{id}','单条详情：含机器整理、阅读段落与核验记录（若有）。ID 只能来自列表接口'],
  ['/api/v1/openapi.json','OpenAPI 3.1 机器可读契约'],
];
const MCP_TOOL_ROWS=[
  ['radar_get_latest','最新动态（默认精选池，可切全部公开池）'],
  ['radar_search','关键词搜索全部公开池'],
  ['radar_get_hotspots','热点榜（销售推荐 ≤10 条）'],
  ['radar_get_procurement','采购公告（招标窗口 / 中标落地 / 更正与其他）'],
  ['radar_get_daily','AI 日报 / 周报 / 月报'],
  ['radar_get_item','按 ID 读单条公开记录详情'],
];
const ACCESS_TABS=[['skill','Agent Skill'],['mcp','MCP'],['rss','RSS'],['api','REST API v1']];
export function AgentAccess() {
  const origin=window.location.origin;
  const [tab,setTab]=useState('skill');
  const base=origin;
  return <section className="agent-access" aria-label="Agent 接入指南">
    <div className="agent-access-hero">
      <h2>让 Agent 直接使用土木 AI 雷达</h2>
      <p>四条接入路径全部匿名只读、无需 API Key：Agent Skill、MCP、RSS、REST API v1。接口只读公开池，可见性与网站一致；条目含摘要与来源链接，全文请走原文出处。</p>
      <div className="agent-chips"><span>匿名只读</span><span>REST API v1</span><span>MCP</span><span>Skill {AGENT_VERSION}</span><span>RSS 全量公开池</span></div>
      <div className="agent-resources">
        <a href="/llms.txt" target="_blank" rel="noreferrer">llms.txt</a>
        <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer">OpenAPI 3.1</a>
        <a href="/skills/civil-radar/SKILL.md" target="_blank" rel="noreferrer">SKILL.md</a>
        <a href="/rss.xml" target="_blank" rel="noreferrer">RSS</a>
      </div>
    </div>
    <div className="agent-access-tabs" role="tablist" aria-label="接入方式">
      {ACCESS_TABS.map(([key,label])=><button key={key} type="button" role="tab" aria-selected={tab===key} className={tab===key?'selected':''} onClick={()=>setTab(key)}>{label}</button>)}
    </div>
    {tab==='skill'&&<div role="tabpanel" aria-label="Agent Skill">
      <p>适合 Claude Code、Codex 等支持 Agent Skills 的编码 Agent：把本站查询能力装成技能，随时问「最近的智慧工地招标」「今天的土木 AI 精选」。</p>
      <h3>三步安装</h3>
      <ol className="agent-note-list">
        <li>把下面的安装提示词发给你的 Agent；</li>
        <li>安装完成后开一个新会话（技能在新会话生效）；</li>
        <li>问它「今天的土木 AI 精选有哪些？」验证。</li>
      </ol>
      <CodeBlock label="安装提示词" text={`请安装土木 AI 雷达 Skill：先读取 ${base}/skills/civil-radar/README.md，按其中的说明把 SKILL.md 安装到本环境的技能目录，然后告诉我安装结果。`}/>
      <CodeBlock label="手动安装（Claude Code 个人技能目录）" text={`mkdir -p ~/.claude/skills/civil-ai-radar\ncurl -fsSL ${base}/skills/civil-radar/SKILL.md -o ~/.claude/skills/civil-ai-radar/SKILL.md`}/>
      <h3>成功的样子</h3>
      <p>Agent 调用 /api/v1/items 返回带来源链接的条目列表，并如实标注「待复核」；而不是凭训练记忆回答。更新时把更新提示词再发一次即可：</p>
      <CodeBlock label="更新提示词" text={`请把土木 AI 雷达 Skill 更新到最新版：重新读取 ${base}/skills/civil-radar/SKILL.md 并覆盖本地文件。`}/>
    </div>}
    {tab==='mcp'&&<div role="tabpanel" aria-label="MCP">
      <p>MCP 客户端（Claude Code、Codex、Cursor、Claude Desktop 等）用 Streamable HTTP 直连本站，无需任何 Key 或登录。</p>
      <CodeBlock label="MCP 端点" text={`${base}/api/mcp`}/>
      <CodeBlock label="通用配置" text={`{\n  "mcpServers": {\n    "civil-ai-radar": {\n      "type": "http",\n      "url": "${base}/api/mcp"\n    }\n  }\n}`}/>
      <CodeBlock label="Claude Code" text={`claude mcp add --transport http civil-ai-radar ${base}/api/mcp`}/>
      <CodeBlock label="Codex" text={`codex mcp add civil-ai-radar --url ${base}/api/mcp`}/>
      <CodeBlock label="Cursor（mcp.json）" text={`{\n  "mcpServers": {\n    "civil-ai-radar": {\n      "url": "${base}/api/mcp"\n    }\n  }\n}`}/>
      <p>Cursor Settings → MCP，或写入项目 <code>.cursor/mcp.json</code>。</p>
      <h3>工具一览</h3>
      <table className="agent-endpoint-table"><tbody>{MCP_TOOL_ROWS.map(([name,desc])=><tr key={name}><td><code>{name}</code></td><td>{desc}</td></tr>)}</tbody></table>
      <p>验证：让 Agent「用 civil-ai-radar 查一下最近的智慧工地招标」。工具以 tools/list 实时返回为准，未列出的工具不存在；条目 ID 只能来自工具返回，不要自行构造。</p>
    </div>}
    {tab==='rss'&&<div role="tabpanel" aria-label="RSS">
      <p>阅读器与自动化工具的最低成本路径：最新 50 条公开动态（精选与采集）。</p>
      <CodeBlock label="订阅地址" text={`${base}/rss.xml`}/>
      <h3>契约</h3>
      <ul className="agent-note-list">
        <li>支持 ETag / 304，建议轮询间隔 ≥30 分钟；</li>
        <li>公开日期未披露的条目不写 pubDate——收录时间不是首次公开时间；</li>
        <li>正文不在 RSS 里，读全文走条目的原文链接。</li>
      </ul>
    </div>}
    {tab==='api'&&<div role="tabpanel" aria-label="REST API v1">
      <p>GET 即用，支持跨域与 ETag 缓存；完整参数见 OpenAPI 契约。</p>
      <CodeBlock label="第一个请求" text={`curl -fsSL "${base}/api/v1/items?mode=featured&limit=5"`}/>
      <table className="agent-endpoint-table"><tbody>{ENDPOINT_ROWS.map(([path,desc])=><tr key={path}><td><code>GET {path}</code></td><td>{desc}</td></tr>)}</tbody></table>
      <h3>需要知道的事实</h3>
      <ul className="agent-note-list">
        <li>默认精选池；<code>mode=all</code> 返回全部公开池（含待复核采集）；</li>
        <li>条目含摘要与来源，不含正文；读全文走 <code>sourceUrl</code>；</li>
        <li>已驳回内容接口层不可见；待复核条目 <code>reviewStatus=pending</code>，引用时如实标注；</li>
        <li><code>salesScore</code> 是代码计算的自动评分假设（reason 即「自动评分理由」），不是核验、不是实时热度；</li>
        <li>每 IP 每分钟 120 次；429 时按 <code>Retry-After</code> 退避，并请做客户端缓存（≥5 分钟）；</li>
        <li>没有推送通道是刻意的：轮询 + 缓存即可，错误以 Problem JSON 返回。</li>
      </ul>
    </div>}
    <div className="agent-columns">
      <section aria-label="做得到"><h4>做得到</h4><ul>
        <li>匿名读取公开池、热点榜、采购公告与日 / 周 / 月报；</li>
        <li>单条详情含机器整理与中英阅读段落（若有）；</li>
        <li>跨域浏览器调用、ETag / 304 缓存。</li>
      </ul></section>
      <section aria-label="暂时做不到"><h4>暂时做不到</h4><ul>
        <li>写入、收藏、关注与订阅——那是网站账号功能，不在接口层；</li>
        <li>条目正文全文——请走 sourceUrl 读发布方原文；</li>
        <li>实时热度或推送通道；</li>
        <li>证明某单位参与了某项目——关键词命中与评分都不是证据。</li>
      </ul></section>
    </div>
    <h3>使用规则</h3>
    <ul className="agent-note-list">
      <li><strong>用途许可：</strong>个人学习、内部业务参考与公益使用免费；用于对外商业产品、公开镜像或批量再分发前，请先通过站点「反馈」页联系站长获得书面授权。</li>
      <li><strong>速率与稳定性：</strong>无 SLA；接口面向 Agent 设计，请配合缓存轮询。</li>
      <li><strong>契约：</strong>字段只增不改；破坏性变更会在本页公告。引用本站数据请保留来源链接，引用自动评分时注明「未经人工核验」。</li>
    </ul>
    <p className="agent-version"><IconCheck size={14}/> 以上端点与 MCP 工具同源生效；本页由站点自动生成，版本 {AGENT_VERSION}。</p>
  </section>;
}
