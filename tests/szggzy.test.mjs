import test from 'node:test';
import assert from 'node:assert/strict';
import {SZGGZY_SEARCH_TIMEOUT_MS, collectSzggzy, parseSzggzyResponse, szggzyRequestBody, szggzySearchUrl} from '../server/szggzy.mjs';
import {createCollector} from '../server/collector.mjs';
import {openDatabase} from '../server/database.mjs';

const source = {
  id: 'szggzy-shenzhen',
  kind: 'szggzy',
  tier: 't1',
  name: '深圳公共资源交易中心（AI 相关交易公告）',
  url: 'https://www.szggzy.com/',
  channels: [2850, 2851],
  keywords: ['智能建造'],
  sector: '施工',
  scope: '国内',
  region: '中国',
};

const NOW = Date.parse('2026-09-26T02:00:00Z');

const record = (over = {}) => ({
  appNoticeTypeName: '招标公告',
  areaName: '光明区',
  channelId: 2851,
  classifyType: '建设工程',
  contentId: 20662897,
  id: 20662897,
  linkTo: '',
  noticeTitle: '智能控制器智能制造基地场地平整工程施工',
  noticeType: '招标公告',
  projectRegion: '光明区',
  publishTime: '2026-09-25 09:00:02',
  releaseTime: '2026-09-25 09:00:02',
  tenderer: '深圳市光明区建筑工务署',
  ...over,
});
const payload = (records, code = 200) => JSON.stringify({code, message: 'success', data: {content: records, totalElements: records.length, size: 10, empty: !records.length}});

test('szggzy request targets the documented endpoint with title keyword and channel', () => {
  assert.equal(szggzySearchUrl(), 'https://www.szggzy.com/cms/api/v1/trade/content/page');
  const body = JSON.parse(szggzyRequestBody('智能建造', 2850));
  assert.equal(body.title, '智能建造');
  assert.equal(body.channelId, 2850);
  assert.equal(body.siteId, 1);
  assert.equal(body.page, 0);
  assert.equal(SZGGZY_SEARCH_TIMEOUT_MS, 60000);
});

test('szggzy parser keeps civil AI tenders with in-site detail links', () => {
  const [item, ...rest] = parseSzggzyResponse(payload([
    record(),
    record({contentId: 20660001, id: 20660001, noticeTitle: '人工智能实训室设备采购项目', classifyType: '政府采购', noticeType: '中标公告', appNoticeTypeName: '中标公告', tenderer: '', purchaseMan: ''}), // 非土木工程，滤除
    record({contentId: 20660002, id: 20660002, releaseTime: '2026-01-05 09:00:02', publishTime: '2026-01-05 09:00:02'}), // 超出窗口
    record({contentId: 20660003, id: 20660003, noticeTitle: ''}), // 无标题，跳过
  ]), source, NOW);
  assert.equal(rest.length, 0);
  assert.equal(item.sourceUrl, 'https://www.szggzy.com/jygg/details.html?contentId=20662897');
  assert.equal(item.title, '智能控制器智能制造基地场地平整工程施工');
  assert.equal(item.publishedDate, '2026-09-25');
  assert.equal(item.evidence, '待复核');
  assert.equal(item.dataOrigin, 'collector');
  assert.equal(item.reading.kind, 'procurement-notice');
  assert.match(item.reading.notice, /需回链公告原文确认/);
  assert.match(item.reading.paragraphs.zh.join('\n'), /招标人：深圳市光明区建筑工务署/);
  assert.equal(item.procurement.buyer, '深圳市光明区建筑工务署');
  assert.equal(item.procurement.noticeType, '招标公告');
  assert.equal(item.procurement.noticeClass, 'tender');
  assert.equal(item.procurement.region, '光明区');
  assert.equal(item.editorial?.salesStage === '可破冰', false);
});

test('szggzy parser labels procurement-channel buyers as 采购人', () => {
  const [item] = parseSzggzyResponse(payload([
    record({channelId: 2850, classifyType: '政府采购', noticeType: '竞争性磋商公告', tenderer: '', purchaseMan: '深圳市某区水务局', noticeTitle: '智慧水务人工智能调度系统工程竞争性磋商公告', contentId: 20661001, id: 20661001}),
  ]), source, NOW);
  assert.equal(item.procurement.buyer, '深圳市某区水务局');
  assert.match(item.reading.paragraphs.zh.join('\n'), /采购人：深圳市某区水务局/);
  assert.equal(item.procurement.noticeClass, 'tender');
});

test('szggzy parser maps code notice types to their display names', () => {
  // 实测：意向公开类记录 noticeType='N51'，noticeTypeName/appNoticeTypeName='采购意向公开'。
  const [item] = parseSzggzyResponse(payload([
    record({contentId: 20662001, id: 20662001, noticeType: 'N51', noticeTypeName: '采购意向公开', appNoticeTypeName: '采购意向公开', rank1NoticeTypeName: '提前公示', noticeTitle: '深圳市某区智慧水利数字孪生平台采购意向公开', tenderer: '', purchaseMan: '深圳市某区水务局', classifyType: '政府采购'}),
  ]), source, NOW);
  assert.equal(item.procurement.noticeType, '采购意向公开');
  assert.match(item.reading.paragraphs.zh.join('\n'), /公告类型：采购意向公开/);
  assert.equal(item.procurement.noticeClass, 'tender');
});

test('szggzy parser rejects unexpected payloads instead of inventing results', () => {
  assert.throws(() => parseSzggzyResponse('风控验证页', source, NOW), /JSON/);
  assert.throws(() => parseSzggzyResponse(payload([], 102), source, NOW), /结构未识别/);
  assert.deepEqual(parseSzggzyResponse(payload([]), source, NOW), []);
});

test('szggzy collector dedupes across channels and warns per channel-keyword', async () => {
  const calls = [];
  const articles = await collectSzggzy(source, {
    safeFetch: async (url, options = {}) => {
      const body = JSON.parse(String(options.body));
      calls.push(body.channelId);
      if (body.channelId === 2850) return new Response('boom', {status: 500});
      return new Response(payload([record()]), {headers: {'Content-Type': 'application/json'}});
    },
    boundedText: async r => r.text(),
    now: () => NOW,
  });
  assert.equal(articles.length, 1);
  assert.equal(articles.warnings.length, 1);
  assert.match(articles.warnings[0], /政府采购\/智能建造: Source HTTP 500/);
  assert.deepEqual(calls, [2850, 2851]);

  await assert.rejects(
    collectSzggzy({...source, channels: [2851]}, {
      safeFetch: async () => new Response('blocked', {status: 403}),
      boundedText: async r => '',
      now: () => NOW,
    }),
    /403/,
  );
});

test('szggzy source runs through the collector after robots check and stores pending-review records', async t => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const posts = [];
  const collector = createCollector({
    db,
    sources: [source],
    now: () => NOW,
    fetchImpl: async (url, options = {}) => {
      const target = String(url);
      if (target.endsWith('/robots.txt')) return new Response('404 page', {status: 404});
      if (target === 'https://www.szggzy.com/cms/api/v1/trade/content/page') {
        assert.equal(options.method, 'POST');
        posts.push(JSON.parse(String(options.body)));
        return new Response(payload([record()]), {headers: {'Content-Type': 'application/json'}});
      }
      return new Response('not found', {status: 404});
    },
  });
  const result = await collector.run();
  assert.equal(result.results[0].status, 'ok');
  // 两个频道命中同一 contentId，按 URL 去重后只入库一条。
  assert.equal(result.results[0].added, 1);
  assert.deepEqual(posts.map(p => p.channelId), [2850, 2851]);
  const rows = db.prepare('SELECT data FROM articles').all().map(r => JSON.parse(r.data));
  assert.ok(rows.every(r => r.sourceId === 'szggzy-shenzhen' && r.evidence === '待复核' && r.sourceUrl.startsWith('https://www.szggzy.com/jygg/details.html')));
});
