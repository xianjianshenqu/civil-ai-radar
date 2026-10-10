import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {openDatabase} from '../server/database.mjs';
import {createApp} from '../server/app.mjs';
import {createAgentAccess} from '../server/agentAccess.mjs';
import {createPublicFeeds} from '../server/feeds.mjs';
import {parseCcgpList} from '../server/procurement.mjs';
import {parseSzggzyResponse} from '../server/szggzy.mjs';
import {sanitizeBuyer, collapseProcurementDuplicates, extractProjectCodes, findCollapsedEntry, noticeRoundMarker, noticeTitleCore} from '../src/lib/procurementIdentity.js';
import {defaults, editorialSources, buildHotEvents, filterEntries} from '../src/lib/radar.js';
import {noticeClassOf} from '../src/lib/intel.js';

const SAME = '辽宁生态工程职业学院2026年智慧水利AIoT实训室建设项目招标公告(JH26-210000-39194(LNZC2026-0447))';
const CCGP_URL = 'https://www.ccgp.gov.cn/cggg/dfgg/gkzb/202609/t20260930_27429328.htm';
const GGZY_URL = 'https://www.ggzy.gov.cn/information/deal/html/a/210000/0201/20260930/0021c820346.htm';
const GGZY_URL_2 = 'https://www.ggzy.gov.cn/information/deal/html/a/450000/0202/20260930/0045ce4b374.htm';

function notice(patch = {}) {
  return {
    id: 'feed-a',
    title: SAME,
    source: '中国政府采购网（AI 相关采购公告）',
    sourceUrl: CCGP_URL,
    publishedDate: '2026-09-30',
    firstSeenAt: '2026-09-30T01:00:00.000Z',
    dataOrigin: 'collector',
    procurement: {noticeType: '招标公告', noticeClass: 'tender', buyer: '辽宁生态工程职业学院', region: '辽宁'},
    reading: {paragraphs: {zh: ['采购人：辽宁生态工程职业学院；公告类型：招标公告']}},
    ...patch,
  };
}

test('sanitizeBuyer drops contact names and keeps organization names', () => {
  for (const bad of ['郭老师', '张老师', '李先生', '王女士', '赵小姐', '欧阳工', '李工', '联系人：郭老师', '郭老师（联系人）', '郭老师13800138000']) {
    assert.equal(sanitizeBuyer(bad), '', bad);
  }
  assert.equal(sanitizeBuyer('施工'), '施工');
  for (const ok of ['中建三局', '淮阴工学院', '辽宁生态工程职业学院', '北京广播电视台(本级)', '厦门市健康医疗大数据中心（厦门市医药研究所）', '广东某采购人']) {
    assert.equal(sanitizeBuyer(ok), ok, ok);
  }
  assert.equal(sanitizeBuyer('湖南城建职业技术学院（郭老师）'), '湖南城建职业技术学院');
});

test('ccgp and szggzy parsers do not store a contact name as buyer', () => {
  const ccgp = {
    id: 'ccgp-procurement',
    name: '中国政府采购网（AI 相关采购公告）',
    url: 'https://search.ccgp.gov.cn/bxsearch',
    articleHosts: ['www.ccgp.gov.cn'],
    sector: '施工',
    scope: '国内',
    region: '中国',
  };
  const html = `<ul class="vT-srch-result-list-bid"><li><a href="http://www.ccgp.gov.cn/cggg/dfgg/jzxcs/202609/t20260930_1.htm">湖南城建职业技术学院“智能建造”产教融合实训基地建设项目信息化设备采购项目（第三次）项目竞争性磋商邀请公告</a><p>智能建造实训基地工程竞争性磋商。</p><span>2026.09.30 09:00:00 | 采购人：郭老师 | 代理机构：正茂日升工程咨询有限公司 <br/> <strong> 竞争性磋商 </strong> | 湖南 | </span></li></ul>`;
  const [ccgpItem] = parseCcgpList(html, ccgp, Date.parse('2026-10-01T02:00:00Z'));
  assert.equal(ccgpItem.procurement.buyer, undefined);
  assert.match(ccgpItem.reading.paragraphs.zh.join('\n'), /采购人：摘要未披露/);
  assert.equal(ccgpItem.procurement.agency, '正茂日升工程咨询有限公司');

  const sz = {
    id: 'szggzy-shenzhen',
    name: '深圳公共资源交易中心（AI 相关交易公告）',
    url: 'https://www.szggzy.com/',
    articleHosts: ['www.szggzy.com'],
    sector: '施工',
    scope: '国内',
    region: '中国',
  };
  const payload = JSON.stringify({code: 200, data: {content: [{
    contentId: 1,
    noticeTitle: '智慧水务人工智能调度系统工程竞争性磋商公告',
    noticeTypeName: '竞争性磋商公告',
    releaseTime: '2026-09-25 09:00:02',
    classifyType: '政府采购',
    areaName: '光明区',
    tenderer: '李工',
  }]}});
  const [szItem] = parseSzggzyResponse(payload, sz, Date.parse('2026-09-26T02:00:00Z'));
  assert.equal(szItem.procurement.buyer, undefined);
  assert.match(szItem.reading.paragraphs.zh.join('\n'), /采购人：摘要未披露/);
});

test('identical cross-source notices collapse to one primary and keep every source url', () => {
  const ccgp = notice({id: 'ccgp', salesScore: {total: 40}});
  const ggzy = notice({
    id: 'ggzy',
    source: '全国公共资源交易平台（AI 相关交易公告）',
    sourceUrl: GGZY_URL,
    firstSeenAt: '2026-09-30T02:00:00.000Z',
    salesScore: {total: 70, featured: true},
    procurement: {noticeType: '采购/资审公告', region: '辽宁'},
  });
  const ggzyAgain = notice({
    id: 'ggzy-2',
    source: '全国公共资源交易平台（AI 相关交易公告）',
    sourceUrl: GGZY_URL_2,
    firstSeenAt: '2026-09-30T03:00:00.000Z',
    salesScore: {total: 10},
    procurement: {noticeType: '中标公告', noticeClass: 'result'},
    title: SAME,
  });
  const [merged] = collapseProcurementDuplicates([ggzy, ccgp, ggzyAgain]);
  assert.equal(collapseProcurementDuplicates([ggzy, ccgp, ggzyAgain]).length, 1);
  // 分数更高的全国平台记录留作主来源，政采网上的采购人补到这条上。
  assert.equal(merged.id, 'ggzy');
  assert.equal(merged.procurement.buyer, '辽宁生态工程职业学院');
  assert.deepEqual(merged.procurement.sources.map(s => s.sourceUrl), [GGZY_URL, CCGP_URL, GGZY_URL_2]);
  assert.equal(ggzy.procurement.buyer, undefined);
  assert.equal(ccgp.procurement.sources, undefined);
  const sources = editorialSources(merged);
  assert.ok(sources.some(s => s.url === GGZY_URL && s.type === '入库来源'));
  assert.ok(sources.some(s => s.url === CCGP_URL && s.type === '公告来源'));
  const events = buildHotEvents([{...merged, featuredRank: 1, salesScore: {total: 70, featured: true}}]);
  assert.equal(events.length, 1);
  assert.equal(events[0].sources.length, 3);
  assert.equal(events[0].noticeClass, 'tender');
  assert.equal(noticeClassOf(events[0]), 'tender');
  assert.equal(noticeClassOf(merged), 'tender');
});

test('project code merges a title that dropped the code, and does not merge different notices', () => {
  const coded = notice({id: 'coded'});
  const bare = notice({
    id: 'bare',
    title: '辽宁生态工程职业学院2026年智慧水利AIoT实训室建设项目招标公告',
    sourceUrl: 'https://www.ccgp.gov.cn/cggg/dfgg/gkzb/202609/t20260930_bare.htm',
    procurement: {noticeType: '招标公告', noticeClass: 'tender'},
  });
  assert.equal(collapseProcurementDuplicates([coded, bare]).length, 1);

  const line = notice({id: 'line', title: '人工智能与新型电力系统产教融合一体化平台设备更新项目-新型电力系统（第二批采购—潼南校区输电线路实训基地）建设项目(CQS26A04019)中标（成交）结果公告', procurement: {noticeType: '中标公告', noticeClass: 'result'}, sourceUrl: 'https://www.ccgp.gov.cn/cggg/a/line.htm'});
  const cable = notice({id: 'cable', title: '人工智能与新型电力系统产教融合一体化平台设备更新项目-新型电力系统（第二批采购-潼南校区电缆综合实训基地）建设项目(CQS26A04020)中标（成交）结果公告', procurement: {noticeType: '中标公告', noticeClass: 'result'}, sourceUrl: 'https://www.ccgp.gov.cn/cggg/a/cable.htm'});
  assert.equal(collapseProcurementDuplicates([line, cable]).length, 2);
  assert.ok(extractProjectCodes(line).has('CQS26A04019'));
  assert.ok(extractProjectCodes(cable).has('CQS26A04020'));

  const tender = notice({id: 'tender', title: '智慧工地平台升级改造项目(LNZC2026-0447)招标公告', procurement: {noticeType: '招标公告', noticeClass: 'tender'}, sourceUrl: 'https://www.ccgp.gov.cn/cggg/a/tender.htm'});
  const result = notice({id: 'result', title: '智慧工地平台升级改造项目(LNZC2026-0447)中标结果公告', procurement: {noticeType: '中标公告', noticeClass: 'result'}, sourceUrl: 'https://www.ggzy.gov.cn/information/deal/html/a/result.htm'});
  assert.equal(collapseProcurementDuplicates([tender, result]).length, 2);

  const second = notice({id: 'second', title: '实训基地建设项目（第二次）招标公告(LNZC2026-0447)', procurement: {noticeType: '招标公告'}, sourceUrl: 'https://www.ccgp.gov.cn/cggg/a/2.htm'});
  const third = notice({id: 'third', title: '实训基地建设项目（第三次）招标公告(LNZC2026-0447)', procurement: {noticeType: '招标公告'}, sourceUrl: 'https://www.ccgp.gov.cn/cggg/a/3.htm'});
  assert.equal(collapseProcurementDuplicates([second, third]).length, 2);

  const pack1 = notice({id: 'p1', title: '数智化语言实训室设备采购项目结果公告（采购包1）(LNZC2026-0999)', procurement: {noticeType: '中标公告'}, sourceUrl: 'https://www.ccgp.gov.cn/cggg/a/p1.htm'});
  const pack2 = notice({id: 'p2', title: '数智化语言实训室设备采购项目结果公告（采购包2）(LNZC2026-0999)', procurement: {noticeType: '中标公告'}, sourceUrl: 'https://www.ccgp.gov.cn/cggg/a/p2.htm'});
  assert.equal(collapseProcurementDuplicates([pack1, pack2]).length, 2);

  const labeled = notice({
    id: 'labeled',
    title: '辽宁生态工程职业学院智慧水利平台招标公告（项目编号：LNZC2026-0447）',
    sourceUrl: 'https://www.ccgp.gov.cn/cggg/a/labeled.htm',
    procurement: {noticeType: '招标公告', noticeClass: 'tender'},
  });
  const unlabeled = notice({
    id: 'unlabeled',
    title: '辽宁生态工程职业学院智慧水利平台招标公告',
    sourceUrl: 'https://www.ggzy.gov.cn/information/deal/html/a/unlabeled.htm',
    procurement: {noticeType: '招标公告', noticeClass: 'tender'},
  });
  assert.equal(noticeTitleCore(labeled.title), noticeTitleCore(unlabeled.title));
  assert.equal(collapseProcurementDuplicates([labeled, unlabeled]).length, 1);

  const arabic = notice({id: 'round-2', title: '实训基地建设项目（第2次）招标公告(LNZC2026-0447)', sourceUrl: 'https://www.ccgp.gov.cn/cggg/a/round2.htm', procurement: {noticeType: '招标公告', noticeClass: 'tender'}});
  const chinese = notice({id: 'round-er', title: '实训基地建设项目（第二次）招标公告(LNZC2026-0447)', sourceUrl: 'https://www.ggzy.gov.cn/information/deal/html/a/round-er.htm', procurement: {noticeType: '招标公告', noticeClass: 'tender'}});
  const thirdArabic = notice({id: 'round-3', title: '实训基地建设项目（第3次）招标公告(LNZC2026-0447)', sourceUrl: 'https://www.ccgp.gov.cn/cggg/a/round3.htm', procurement: {noticeType: '招标公告', noticeClass: 'tender'}});
  assert.equal(noticeRoundMarker(arabic.title), '2');
  assert.equal(noticeRoundMarker(chinese.title), '2');
  assert.equal(noticeRoundMarker(thirdArabic.title), '3');
  assert.equal(collapseProcurementDuplicates([arabic, chinese]).length, 1);
  assert.equal(collapseProcurementDuplicates([arabic, thirdArabic]).length, 2);

  const journal = {id: 'paper', title: SAME, sourceUrl: 'https://doi.org/10.1000/example', dataOrigin: 'collector'};
  const kept = collapseProcurementDuplicates([journal, notice({id: 'only'})]);
  assert.deepEqual(kept.map(item => item.id).sort(), ['only', 'paper']);
});

test('equal scores keep the copy that already has a buyer, and approved copy outranks a higher score', () => {
  const pending = notice({id: 'pending', salesScore: {total: 90}, procurement: {noticeType: '招标公告'}, sourceUrl: GGZY_URL, source: '全国公共资源交易平台（AI 相关交易公告）'});
  const approved = notice({id: 'approved', salesScore: {total: 10}, reviewed: true, reviewStatus: 'approved', featuredRank: 2});
  assert.equal(collapseProcurementDuplicates([pending, approved])[0].id, 'approved');

  const plain = notice({id: 'plain', salesScore: {total: 10}, procurement: {noticeType: '招标公告'}, sourceUrl: GGZY_URL});
  const withBuyer = notice({id: 'buyer', salesScore: {total: 10}});
  assert.equal(collapseProcurementDuplicates([plain, withBuyer])[0].id, 'buyer');
});

test('display copy blanks a stored contact buyer without rewriting the stored object', () => {
  const stored = notice({
    id: 'contact',
    title: '湖南城建职业技术学院“智能建造”产教融合实训基地建设项目信息化设备采购项目（第三次）项目竞争性磋商邀请公告',
    procurement: {buyer: '郭老师', agency: '正茂日升工程咨询有限公司', noticeType: '竞争性磋商', region: '湖南'},
    reading: {paragraphs: {zh: ['智能建造实训基地工程。', '采购人：郭老师；代理机构：正茂日升工程咨询有限公司；公告类型：竞争性磋商']}},
  });
  const [shown] = collapseProcurementDuplicates([stored]);
  assert.equal(stored.procurement.buyer, '郭老师');
  assert.equal(shown.procurement.buyer, undefined);
  assert.match(shown.reading.paragraphs.zh[1], /采购人：摘要未披露/);
  assert.match(stored.reading.paragraphs.zh[1], /采购人：郭老师/);
  assert.equal(shown.procurement.agency, '正茂日升工程咨询有限公司');
});

function insertArticle(db, article) {
  db.prepare('INSERT INTO articles(id,url,data,content_hash,first_seen,updated_at) VALUES(?,?,?,?,?,?)')
    .run(article.id, article.sourceUrl, JSON.stringify(article), 'h-' + article.id, Date.parse(article.firstSeenAt), Date.parse(article.firstSeenAt));
}

test('public procurement API returns one row and still stores every source', async () => {
  const db = openDatabase(':memory:');
  const ccgp = notice({
    id: 'feed-ccgp',
    publishedAt: '2026-09-29T00:00:00.000Z',
    publishedDate: '2026-09-29',
    firstSeenAt: '2026-09-29T00:00:00.000Z',
    editorial: {status: 'approved', featuredRank: 1},
    summary: '智慧水利实训室招标。',
  });
  const ggzy = notice({
    id: 'feed-ggzy',
    source: '全国公共资源交易平台（AI 相关交易公告）',
    sourceUrl: GGZY_URL,
    publishedAt: '2026-09-29T00:00:00.000Z',
    publishedDate: '2026-09-29',
    firstSeenAt: '2026-09-29T01:00:00.000Z',
    editorial: {status: 'approved', featuredRank: 3},
    procurement: {noticeType: '采购/资审公告', region: '辽宁'},
    summary: '智慧水利实训室招标。',
  });
  const other = notice({
    id: 'feed-other',
    title: '另一条智慧工地人工智能监测工程招标公告',
    sourceUrl: 'https://www.ccgp.gov.cn/cggg/dfgg/gkzb/202609/t20260929_other.htm',
    publishedAt: '2026-09-29T00:00:00.000Z',
    publishedDate: '2026-09-29',
    firstSeenAt: '2026-09-29T02:00:00.000Z',
    editorial: {status: 'pending'},
    procurement: {noticeType: '招标公告', buyer: '郭老师', region: '湖南'},
    reading: {paragraphs: {zh: ['采购人：郭老师；公告类型：招标公告']}},
  });
  insertArticle(db, ccgp);
  insertArticle(db, ggzy);
  insertArticle(db, other);
  const agent = createAgentAccess({db, config: {publicUrl: 'https://radar.example', production: false}, now: () => Date.parse('2026-09-30T02:00:00Z')});
  const res = {status: 0, headers: {}, body: '', writeHead(status, headers = {}) { this.status = status; this.headers = headers; }, end(chunk) { this.body = chunk ?? ''; }};
  const req = Readable.from([]);
  req.method = 'GET';
  req.url = '/api/v1/procurements?window=30d&limit=200';
  req.headers = {};
  req.socket = {remoteAddress: '127.0.0.1'};
  await agent.handler(req, res);
  const data = JSON.parse(res.body);
  assert.equal(res.status, 200);
  assert.equal(data.count, 2);
  const merged = data.items.find(item => item.title === SAME);
  assert.equal(merged.buyer, '辽宁生态工程职业学院');
  assert.equal(merged.sources.length, 2);
  assert.ok(merged.sources.some(s => s.sourceUrl === CCGP_URL));
  assert.ok(merged.sources.some(s => s.sourceUrl === GGZY_URL));
  const contact = data.items.find(item => item.id === 'feed-other');
  assert.equal(contact.buyer, null);
  const hot = {status: 0, headers: {}, body: '', writeHead(status, headers = {}) { this.status = status; this.headers = headers; }, end(chunk) { this.body = chunk ?? ''; }};
  const hotReq = Readable.from([]);
  hotReq.method = 'GET';
  hotReq.url = '/api/v1/hotspots?window=all';
  hotReq.headers = {};
  hotReq.socket = {remoteAddress: '127.0.0.1'};
  await agent.handler(hotReq, hot);
  const hotspots = JSON.parse(hot.body);
  const event = hotspots.events.find(item => item.title === SAME);
  assert.ok(event);
  assert.equal(hotspots.events.filter(item => item.title === SAME).length, 1);
  assert.ok(event.sources.some(s => s.url === CCGP_URL));
  assert.ok(event.sources.some(s => s.url === GGZY_URL));
  assert.equal(event.noticeClass, 'tender');
  assert.equal(event.noticeClassLabel, '招标窗口');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM articles').get().n, 3);
  const droppedId = merged.id === 'feed-ccgp' ? 'feed-ggzy' : 'feed-ccgp';
  const hidden = {status: 0, headers: {}, body: '', writeHead(status, headers = {}) { this.status = status; this.headers = headers; }, end(chunk) { this.body = chunk ?? ''; }};
  const hiddenReq = Readable.from([]);
  hiddenReq.method = 'GET';
  hiddenReq.url = '/api/v1/items/' + droppedId;
  hiddenReq.headers = {};
  hiddenReq.socket = {remoteAddress: '127.0.0.1'};
  await agent.handler(hiddenReq, hidden);
  assert.equal(hidden.status, 200);
  const alias = JSON.parse(hidden.body);
  assert.equal(alias.id, merged.id);
  assert.notEqual(alias.id, droppedId);
  assert.ok(alias.procurement.sources.some(source => source.id === droppedId));
  assert.equal(findCollapsedEntry([{id: merged.id, procurement: alias.procurement}], droppedId).id, merged.id);
  db.close();
});

test('a saved or followed copy id still resolves to the collapsed primary', () => {
  const primary = {
    id: 'keep',
    procurement: {sources: [
      {id: 'keep', source: '中国政府采购网（AI 相关采购公告）', sourceUrl: CCGP_URL},
      {id: 'drop', source: '全国公共资源交易平台（AI 相关交易公告）', sourceUrl: GGZY_URL},
    ]},
  };
  assert.equal(findCollapsedEntry([primary], 'drop').id, 'keep');
  assert.deepEqual(filterEntries([primary], {...defaults, nav: '收藏'}, {saved: ['drop']}).map(item => item.id), ['keep']);
  assert.deepEqual(filterEntries([primary], {...defaults, nav: '我的关注'}, {followed: ['drop']}).map(item => item.id), ['keep']);
  assert.deepEqual(filterEntries([primary], {...defaults, nav: '收藏'}, {saved: ['other']}), []);
});

test('rss and sitemap list a duplicate procurement notice once and keep the stored row', async () => {
  const db = openDatabase(':memory:');
  insertArticle(db, notice({id: 'feed-ccgp', firstSeenAt: '2026-09-29T00:00:00.000Z', editorial: {status: 'pending'}}));
  insertArticle(db, notice({
    id: 'feed-ggzy',
    source: '全国公共资源交易平台（AI 相关交易公告）',
    sourceUrl: GGZY_URL,
    firstSeenAt: '2026-09-29T01:00:00.000Z',
    editorial: {status: 'pending'},
    procurement: {noticeType: '采购/资审公告', region: '辽宁'},
  }));
  const feeds = createPublicFeeds({db, config: {publicUrl: 'https://radar.example'}, now: () => Date.parse('2026-09-30T02:00:00Z')});
  async function serve(url) {
    const captured = {};
    const res = {writeHead(status, headers) { captured.status = status; captured.headers = headers; }, end(body) { captured.body = body; }};
    await feeds.handler({url, method: 'GET'}, res);
    return captured.body;
  }
  const rss = await serve('/rss.xml');
  assert.equal(rss.split('<item>').length - 1, 1);
  assert.match(rss, /另见：/);
  assert.ok(rss.includes(CCGP_URL) || rss.includes(GGZY_URL));
  assert.ok(rss.includes(CCGP_URL) && rss.includes(GGZY_URL));
  const sitemap = await serve('/sitemap.xml');
  const locs = sitemap.match(/\/detail\/feed-[a-z0-9-]+/g) || [];
  assert.equal(locs.length, 1);
  assert.ok(feeds.articleForDetail('/detail/feed-ggzy'));
  assert.ok(feeds.articleForDetail('/detail/feed-ccgp'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM articles').get().n, 2);
  db.close();
});

test('rss selects the approved duplicate instead of an earlier pending copy', async () => {
  const db = openDatabase(':memory:');
  insertArticle(db, notice({
    id: 'feed-pending',
    firstSeenAt: '2026-09-29T00:00:00.000Z',
    editorial: {status: 'pending'},
  }));
  insertArticle(db, notice({
    id: 'feed-approved',
    source: '全国公共资源交易平台（AI 相关交易公告）',
    sourceUrl: GGZY_URL,
    firstSeenAt: '2026-09-29T03:00:00.000Z',
    editorial: {status: 'approved'},
    procurement: {noticeType: '采购/资审公告', region: '辽宁'},
  }));
  const feeds = createPublicFeeds({db, config: {publicUrl: 'https://radar.example'}, now: () => Date.parse('2026-09-30T02:00:00Z')});
  const captured = {};
  const res = {writeHead(status, headers) { captured.status = status; captured.headers = headers; }, end(body) { captured.body = body; }};
  await feeds.handler({url: '/rss.xml', method: 'GET'}, res);
  assert.equal(captured.body.split('<item>').length - 1, 1);
  assert.match(captured.body, /<guid[^>]*>feed-approved<\/guid>/);
  assert.doesNotMatch(captured.body, /<guid[^>]*>feed-pending<\/guid>/);
  const sitemap = {};
  const siteRes = {writeHead() {}, end(body) { sitemap.body = body; }};
  await feeds.handler({url: '/sitemap.xml', method: 'GET'}, siteRes);
  assert.match(sitemap.body, /\/detail\/feed-approved/);
  assert.doesNotMatch(sitemap.body, /\/detail\/feed-pending/);
  db.close();
});

test('GET /api/articles collapses procurement duplicates and leaves the database unchanged', async t => {
  const db = openDatabase(':memory:');
  const config = {production: false, publicUrl: 'http://127.0.0.1', port: 0, mailMode: 'local', adminEmails: ['admin@example.test'], feedbackTo: 'admin@example.test', collectorEnabled: false, intervalMs: 3600000};
  const app = createApp({db, config, sources: [], now: () => Date.parse('2026-10-05T02:00:00Z'), fetchImpl: async () => new Response('User-agent: *\nAllow: /')});
  const server = createServer(app.handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  config.port = server.address().port;
  config.publicUrl = `http://127.0.0.1:${config.port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  insertArticle(db, notice({id: 'feed-ccgp', firstSeenAt: '2026-09-30T00:00:00.000Z', editorial: {status: 'pending'}}));
  insertArticle(db, notice({
    id: 'feed-ggzy',
    source: '全国公共资源交易平台（AI 相关交易公告）',
    sourceUrl: GGZY_URL,
    firstSeenAt: '2026-09-30T01:00:00.000Z',
    editorial: {status: 'pending'},
    procurement: {noticeType: '采购/资审公告'},
  }));
  const response = await fetch(config.publicUrl + '/api/articles', {headers: {Origin: config.publicUrl}});
  assert.equal(response.status, 200);
  const body = await response.json();
  const rows = body.articles.filter(item => item.title === SAME);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].procurement.buyer, '辽宁生态工程职业学院');
  assert.equal(rows[0].procurement.sources.length, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM articles').get().n, 2);
  assert.equal(JSON.parse(db.prepare('SELECT data FROM articles WHERE id=?').get('feed-ggzy').data).procurement.buyer, undefined);
});
