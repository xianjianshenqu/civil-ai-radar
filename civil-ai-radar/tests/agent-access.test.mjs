import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {openDatabase} from '../server/database.mjs';
import {createAgentAccess} from '../server/agentAccess.mjs';

const NOW = Date.parse('2026-09-30T02:00:00Z'); // 上海日历日 2026-09-30
const RECENT = '2026-09-29T00:00:00.000Z';
const OLD = '2026-08-21T00:00:00.000Z';

function insertArticle(db, id, patch = {}) {
  const article = {id, url: 'https://example.org/a/' + id, title: '智慧工地 AI 采购公告 ' + id, source: '测试源',
    summary: '测试摘要 ' + id, publishedAt: RECENT, firstSeenAt: RECENT,
    sourceUrl: 'https://example.org/a/' + id, dataOrigin: 'collector', editorial: {status: 'pending'}, ...patch};
  db.prepare('INSERT INTO articles(id,url,data,content_hash,first_seen,updated_at) VALUES(?,?,?,?,?,?)')
    .run(id, article.url, JSON.stringify(article), 'h' + id, Date.parse(RECENT), Date.parse(RECENT) + 60000);
  return article;
}

function seed(db) {
  insertArticle(db, 'feat-1', {
    title: '某集团智慧工地 AI 平台中标公告 feat-1', summary: '摘要 feat-1',
    editorial: {status: 'approved', featuredRank: 2, summary: '编辑摘要 feat-1', watchOrgId: 'o-1', salesStage: '接触中', eventId: 'ev-abc'},
    machineReview: {summary: '机器整理 feat-1', implication: '销售启示 feat-1'},
  });
  insertArticle(db, 'feat-2', {
    title: '某集团智慧工地 AI 平台公示 feat-2', publishedAt: RECENT,
    editorial: {status: 'approved', featuredRank: 1, summary: '编辑摘要 feat-2', eventId: 'ev-abc'},
  });
  insertArticle(db, 'old-1', {
    title: '隧道智能巡检试点 old-1', publishedAt: OLD, firstSeenAt: OLD,
    editorial: {status: 'approved', featuredRank: 3, summary: '编辑摘要 old-1'},
  });
  insertArticle(db, 'pend-1', {
    title: '广东省某单位物业管理服务成交公告', summary: '成交金额 320万元，中标单位未披露。',
    editorial: {status: 'pending'},
    procurement: {noticeType: '成交公告', buyer: '广东某采购人', region: '广东'},
  });
  insertArticle(db, 'rej-1', {editorial: {status: 'rejected'}});
}

function makeRes() {
  return {status: 0, headers: {}, body: '', writeHead(status, headers = {}) { this.status = status; this.headers = headers; }, end(chunk) { this.body = chunk ?? ''; }};
}
function makeAgent(db, overrides = {}) {
  return createAgentAccess({db, config: {publicUrl: 'https://radar.example', production: false}, now: () => NOW, ...overrides});
}
async function call(agent, method, url, headers = {}, payload = null) {
  const res = makeRes();
  const bodyText = payload === null ? '' : typeof payload === 'string' ? payload : JSON.stringify(payload);
  const req = Readable.from(bodyText ? [bodyText] : []);
  req.method = method;
  req.url = url;
  // Node 会把入站头名统一转小写，mock 保持一致。
  req.headers = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  req.socket = {remoteAddress: '127.0.0.1'};
  await agent.handler(req, res);
  return res;
}
const mcpBody = (agent, payload) => call(agent, 'POST', '/api/mcp', {'Content-Type': 'application/json'}, payload).then(res => ({res, json: JSON.parse(res.body)}));

test('v1 items share the public visibility rule and never leak editorial-only fields', async () => {
  const db = openDatabase(':memory:');
  seed(db);
  const agent = makeAgent(db);
  const featured = JSON.parse((await call(agent, 'GET', '/api/v1/items')).body);
  // 默认精选池：approved+featuredRank 的三条可见；pending 与 rejected 不可见。
  assert.deepEqual(featured.items.map(i => i.id).sort(), ['feat-1', 'feat-2', 'old-1']);
  const all = JSON.parse((await call(agent, 'GET', '/api/v1/items?mode=all')).body);
  assert.ok(all.items.some(i => i.id === 'pend-1'));
  assert.ok(!all.items.some(i => i.id === 'rej-1'));
  const pend = all.items.find(i => i.id === 'pend-1');
  assert.equal(pend.reviewStatus, 'pending');
  assert.equal(pend.evidence, '待复核');
  const feat = featured.items.find(i => i.id === 'feat-1');
  // 白名单字段：编辑摘要生效；人工销售标签（watchOrgId/salesStage）与内部 editorial 对象不出现。
  assert.equal(feat.summary, '编辑摘要 feat-1');
  assert.ok(!('editorial' in feat) && !('salesStage' in feat) && !('watchOrgId' in feat));
  assert.equal(feat.featured, true);
  assert.equal(feat.detailUrl, 'https://radar.example/detail/feat-1');
  assert.ok(feat.salesScore.total > 0);
  assert.ok(Array.isArray(feat.topicIds));
  db.close();
});

test('v1 validates params, clamps limit and answers 405 for writes', async () => {
  const db = openDatabase(':memory:');
  seed(db);
  const agent = makeAgent(db);
  const badMode = await call(agent, 'GET', '/api/v1/items?mode=nope');
  assert.equal(badMode.status, 400);
  assert.match(badMode.headers['Content-Type'], /application\/problem\+json/);
  assert.equal(JSON.parse(badMode.body).status, 400);
  assert.equal((await call(agent, 'GET', '/api/v1/items?window=nope')).status, 400);
  assert.equal((await call(agent, 'GET', '/api/v1/items?limit=abc')).status, 400);
  const clamped = JSON.parse((await call(agent, 'GET', '/api/v1/items?limit=500')).body);
  assert.ok(clamped.items.length <= 100);
  const del = await call(agent, 'DELETE', '/api/v1/items');
  assert.equal(del.status, 405);
  assert.equal(del.headers.Allow, 'GET, HEAD, OPTIONS');
  db.close();
});

test('v1 supports ETag/304 and CORS preflight', async () => {
  const db = openDatabase(':memory:');
  seed(db);
  const agent = makeAgent(db);
  const first = await call(agent, 'GET', '/api/v1/hotspots');
  assert.equal(first.headers['Access-Control-Allow-Origin'], '*');
  const etag = first.headers.ETag;
  assert.ok(etag);
  const cached = await call(agent, 'GET', '/api/v1/hotspots', {'If-None-Match': etag});
  assert.equal(cached.status, 304);
  assert.equal(cached.body, '');
  const preflight = await call(agent, 'OPTIONS', '/api/v1/items');
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers['Access-Control-Allow-Origin'], '*');
  db.close();
});

test('v1 rate limit returns 429 with Retry-After and Problem JSON', async () => {
  const db = openDatabase(':memory:');
  seed(db);
  const agent = makeAgent(db, {limits: {v1: [2, 60000], mcp: [60, 60000]}});
  assert.equal((await call(agent, 'GET', '/api/v1/items')).status, 200);
  assert.equal((await call(agent, 'GET', '/api/v1/items')).status, 200);
  const third = await call(agent, 'GET', '/api/v1/items');
  assert.equal(third.status, 429);
  assert.ok(Number(third.headers['Retry-After']) >= 1);
  assert.match(JSON.parse(third.body).detail, /退避|重试/);
  db.close();
});

test('v1 hotspots group by eventId, stay capped and label themselves as hypotheses', async () => {
  const db = openDatabase(':memory:');
  seed(db);
  const agent = makeAgent(db);
  const data = JSON.parse((await call(agent, 'GET', '/api/v1/hotspots')).body);
  assert.equal(data.events.length, 2); // ev-abc 组 + old-1 单条
  const group = data.events.find(e => e.itemCount === 2);
  assert.ok(group);
  assert.equal(group.id, 'ev-abc');
  assert.equal(group.evidence, '待复核'); // 批量发布不写核验记录，证据等级保持待复核
  assert.match(data.note, /不是实时热度/);
  assert.ok(data.events.every(e => e.noticeClass === null && e.noticeClassLabel === null));
  const windowed = JSON.parse((await call(agent, 'GET', '/api/v1/hotspots?window=7')).body);
  assert.ok(!windowed.events.some(e => e.title.includes('old-1')));
  db.close();
});

test('v1 hotspots expose procurement notice class and leave other events unlabeled', async () => {
  const db = openDatabase(':memory:');
  insertArticle(db, 'hot-award', {
    title: '天津交通职业学院人工智能应用平台中标公告',
    editorial: {status: 'approved', featuredRank: 1},
    procurement: {noticeType: '中标公告', noticeClass: 'result', buyer: '天津交通职业学院'},
  });
  insertArticle(db, 'hot-open', {
    title: '北京市基于大模型的政务咨询场景运营服务公开招标公告',
    editorial: {status: 'approved', featuredRank: 2},
    procurement: {noticeType: '公开招标公告', noticeClass: 'tender'},
  });
  insertArticle(db, 'hot-fix', {
    title: '天津交通职业学院人工智能应用平台更正公告',
    editorial: {status: 'approved', featuredRank: 3},
    procurement: {noticeType: '更正公告'},
  });
  insertArticle(db, 'hot-news', {
    title: '某项目中标公告解读',
    editorial: {status: 'approved', featuredRank: 4, summary: '编辑摘要'},
  });
  const agent = makeAgent(db);
  const data = JSON.parse((await call(agent, 'GET', '/api/v1/hotspot')).body);
  const byId = Object.fromEntries(data.events.map(e => [e.id, e]));
  assert.equal(byId['hot-award'].noticeClass, 'result');
  assert.equal(byId['hot-award'].noticeClassLabel, '中标落地');
  assert.equal(byId['hot-open'].noticeClass, 'tender');
  assert.equal(byId['hot-open'].noticeClassLabel, '招标窗口');
  assert.equal(byId['hot-fix'].noticeClass, 'other');
  assert.equal(byId['hot-fix'].noticeClassLabel, '更正与其他');
  assert.equal(byId['hot-news'].noticeClass, null);
  assert.equal(byId['hot-news'].noticeClassLabel, null);
  assert.match(data.note, /不是实时热度/);
  const openapi = JSON.parse((await call(agent, 'GET', '/api/v1/openapi.json')).body);
  const props = openapi.paths['/api/v1/hotspots'].get.responses['200'].content['application/json'].schema.properties.events.items.properties;
  assert.deepEqual(props.noticeClass.enum, ['tender', 'result', 'other', null]);
  assert.deepEqual(props.noticeClassLabel.enum, ['招标窗口', '中标落地', '更正与其他', null]);
  assert.equal(
    openapi.paths['/api/v1/hotspot'].get.responses['200'].description,
    openapi.paths['/api/v1/hotspots'].get.responses['200'].description,
  );
  const mcp = await mcpBody(agent, {jsonrpc: '2.0', id: 9, method: 'tools/call', params: {name: 'radar_get_hotspots', arguments: {}}});
  assert.match(mcp.json.result.content[0].text, /\[招标窗口\]/);
  assert.match(mcp.json.result.content[0].text, /\[中标落地\]/);
  assert.match(mcp.json.result.content[0].text, /\[更正与其他\]/);
  db.close();
});

test('v1 procurement derives notice class and extracts literal amounts', async () => {
  const db = openDatabase(':memory:');
  seed(db);
  const agent = makeAgent(db);
  const data = JSON.parse((await call(agent, 'GET', '/api/v1/procurement')).body);
  assert.equal(data.count, 1);
  const row = data.items[0];
  assert.equal(row.id, 'pend-1');
  assert.equal(row.noticeClass, 'result'); // 成交公告 → classifyNotice 兜底
  assert.equal(row.noticeClassLabel, '中标落地');
  assert.equal(row.buyer, '广东某采购人');
  assert.deepEqual(row.amounts, ['320万元']);
  assert.match(data.note, /不是公告全文/);
  const tender = JSON.parse((await call(agent, 'GET', '/api/v1/procurement?noticeClass=tender')).body);
  assert.equal(tender.count, 0);
  db.close();
});

test('v1 dailies index, latest and by-date reports follow the published-day archive rule', async () => {
  const db = openDatabase(':memory:');
  seed(db);
  const agent = makeAgent(db);
  const index = JSON.parse((await call(agent, 'GET', '/api/v1/dailies')).body);
  assert.equal(index.period, 'daily');
  assert.equal(index.count, 2); // 2026-09-29 与 2026-08-21 两个日期桶
  const latest = JSON.parse((await call(agent, 'GET', '/api/v1/dailies/latest')).body);
  assert.equal(latest.anchor, '2026-09-29');
  assert.ok(latest.items.some(i => i.id === 'feat-1'));
  const byDate = JSON.parse((await call(agent, 'GET', '/api/v1/dailies/2026-08-21')).body);
  assert.ok(byDate.items.some(i => i.id === 'old-1'));
  const missing = await call(agent, 'GET', '/api/v1/dailies/2000-01-01');
  assert.equal(missing.status, 404);
  const weekly = JSON.parse((await call(agent, 'GET', '/api/v1/dailies?period=weekly')).body);
  assert.ok(weekly.periods.length >= 1);
  db.close();
});

test('v1 short-path aliases match the canonical endpoints', async () => {
  const db = openDatabase(':memory:');
  seed(db);
  const agent = makeAgent(db);
  const latest = await call(agent, 'GET', '/api/v1/dailies/latest');
  const daily = await call(agent, 'GET', '/api/v1/daily');
  assert.equal(daily.status, 200);
  assert.equal(daily.status, latest.status);
  assert.equal(daily.body, latest.body);
  const weekly = await call(agent, 'GET', '/api/v1/daily?period=weekly');
  assert.equal(weekly.status, 200);
  assert.equal(weekly.body, (await call(agent, 'GET', '/api/v1/dailies/latest?period=weekly')).body);
  const hotspots = await call(agent, 'GET', '/api/v1/hotspots?window=7');
  const hotspot = await call(agent, 'GET', '/api/v1/hotspot?window=7');
  assert.equal(hotspot.status, 200);
  assert.equal(hotspot.body, hotspots.body);
  const procurement = await call(agent, 'GET', '/api/v1/procurement?noticeClass=tender');
  const procurements = await call(agent, 'GET', '/api/v1/procurements?noticeClass=tender');
  assert.equal(procurements.status, 200);
  assert.equal(procurements.body, procurement.body);
  const root = JSON.parse((await call(agent, 'GET', '/api/v1')).body);
  assert.deepEqual(root.aliases, {
    '/api/v1/daily': '/api/v1/dailies/latest',
    '/api/v1/hotspot': '/api/v1/hotspots',
    '/api/v1/procurements': '/api/v1/procurement',
  });
  for (const path of Object.keys(root.aliases)) assert.ok(root.endpoints.includes(path));
  const openapi = JSON.parse((await call(agent, 'GET', '/api/v1/openapi.json')).body);
  assert.equal(openapi.paths['/api/v1/daily'].get.deprecated, true);
  assert.equal(openapi.paths['/api/v1/hotspot'].get.deprecated, true);
  assert.equal(openapi.paths['/api/v1/procurements'].get.deprecated, true);
  const llms = (await call(agent, 'GET', '/llms.txt')).body;
  assert.match(llms, /\/api\/v1\/daily(?!s)/);
  assert.match(llms, /\/api\/v1\/hotspot(?!s)/);
  assert.match(llms, /\/api\/v1\/procurements/);
  const skill = (await call(agent, 'GET', '/skills/civil-radar/SKILL.md')).body;
  assert.match(skill, /\/api\/v1\/daily(?!s)/);
  assert.match(skill, /\/api\/v1\/hotspot(?!s)/);
  assert.match(skill, /\/api\/v1\/procurements/);
  db.close();
});

test('v1 item detail exposes machine review honestly and 404s hidden records', async () => {
  const db = openDatabase(':memory:');
  seed(db);
  const agent = makeAgent(db);
  const item = JSON.parse((await call(agent, 'GET', '/api/v1/items/feat-1')).body);
  assert.equal(item.machineReview.summary, '机器整理 feat-1');
  assert.equal(item.machineReview.implication, '销售启示 feat-1');
  assert.ok(!('salesStage' in item) && !('watchOrgId' in item));
  assert.equal((await call(agent, 'GET', '/api/v1/items/rej-1')).status, 404);
  assert.equal((await call(agent, 'GET', '/api/v1/items/never-seen')).status, 404);
  db.close();
});

test('llms.txt and the Agent Skill package are served with version-consistent content', async () => {
  const db = openDatabase(':memory:');
  seed(db);
  const agent = makeAgent(db);
  const llms = await call(agent, 'GET', '/llms.txt');
  assert.equal(llms.status, 200);
  assert.match(llms.body, /\/api\/mcp/);
  assert.match(llms.body, /\/api\/v1\/items/);
  const skill = await call(agent, 'GET', '/skills/civil-radar/SKILL.md');
  assert.match(skill.body, /^---\nname: civil-ai-radar/);
  const readme = await call(agent, 'GET', '/skills/civil-radar/README.md');
  assert.match(readme.body, /civil-ai-radar/);
  const root = JSON.parse((await call(agent, 'GET', '/api/v1')).body);
  assert.ok(root.endpoints.includes('/api/mcp'));
  const openapi = JSON.parse((await call(agent, 'GET', '/api/v1/openapi.json')).body);
  assert.equal(openapi.openapi, '3.1.0');
  assert.ok(openapi.paths['/api/v1/items']);
  db.close();
});

test('MCP handshake: initialize, notifications, tools/list', async () => {
  const db = openDatabase(':memory:');
  seed(db);
  const agent = makeAgent(db);
  const init = await mcpBody(agent, {jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'test', version: '0'}}});
  assert.equal(init.res.status, 200);
  assert.equal(init.json.result.protocolVersion, '2025-06-18');
  assert.equal(init.json.result.serverInfo.name, 'civil-ai-radar');
  const notified = await call(agent, 'POST', '/api/mcp', {}, {jsonrpc: '2.0', method: 'notifications/initialized'});
  assert.equal(notified.status, 202);
  const tools = await mcpBody(agent, {jsonrpc: '2.0', id: 2, method: 'tools/list'});
  assert.equal(tools.json.result.tools.length, 6);
  assert.ok(tools.json.result.tools.every(t => t.name.startsWith('radar_') && t.inputSchema.type === 'object'));
  db.close();
});

test('MCP tools/call returns text + JSON and reports tool errors as results', async () => {
  const db = openDatabase(':memory:');
  seed(db);
  const agent = makeAgent(db);
  const latest = await mcpBody(agent, {jsonrpc: '2.0', id: 3, method: 'tools/call', params: {name: 'radar_get_latest', arguments: {mode: 'featured', limit: 5}}});
  const [summary, json] = latest.json.result.content;
  assert.ok(!latest.json.result.isError);
  assert.match(summary.text, /精选/);
  assert.match(summary.text, /feat-1/);
  const latestData = JSON.parse(json.text);
  assert.equal(latestData.items.length, 3);
  assert.ok(latestData.items.some(i => i.id === 'feat-2'));
  const search = await mcpBody(agent, {jsonrpc: '2.0', id: 4, method: 'tools/call', params: {name: 'radar_search', arguments: {q: '隧道'}}});
  assert.match(search.json.result.content[0].text, /old-1/);
  const badArgs = await mcpBody(agent, {jsonrpc: '2.0', id: 5, method: 'tools/call', params: {name: 'radar_search', arguments: {}}});
  assert.equal(badArgs.json.result.isError, true);
  const unknownTool = await mcpBody(agent, {jsonrpc: '2.0', id: 6, method: 'tools/call', params: {name: 'radar_get_all_secrets', arguments: {}}});
  assert.equal(unknownTool.json.result.isError, true);
  const daily = await mcpBody(agent, {jsonrpc: '2.0', id: 7, method: 'tools/call', params: {name: 'radar_get_daily', arguments: {}}});
  assert.match(daily.json.result.content[0].text, /日报/);
  db.close();
});

test('MCP rejects protocol violations without touching the app layer', async () => {
  const db = openDatabase(':memory:');
  seed(db);
  const agent = makeAgent(db);
  const bad = await call(agent, 'POST', '/api/mcp', {}, '{not json');
  assert.equal(JSON.parse(bad.body).error.code, -32700);
  const batch = await call(agent, 'POST', '/api/mcp', {}, [{jsonrpc: '2.0', id: 1, method: 'tools/list'}]);
  assert.equal(JSON.parse(batch.body).error.code, -32600);
  const missing = await mcpBody(agent, {jsonrpc: '2.0', id: 8, method: 'no/such/method'});
  assert.equal(missing.json.error.code, -32601);
  const get = await call(agent, 'GET', '/api/mcp');
  assert.equal(get.status, 405);
  const preflight = await call(agent, 'OPTIONS', '/api/mcp');
  assert.equal(preflight.status, 204);
  db.close();
});
