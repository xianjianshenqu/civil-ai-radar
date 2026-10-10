import test from 'node:test';
import assert from 'node:assert/strict';
import {GGZY_SEARCH_TIMEOUT_MS, collectGgzy, ggzySearchBody, ggzySearchUrl, parseGgzyResponse} from '../server/ggzy.mjs';
import {createCollector} from '../server/collector.mjs';
import {openDatabase} from '../server/database.mjs';

const source = {
  id: 'ggzy-national',
  kind: 'ggzy',
  tier: 't1',
  name: '全国公共资源交易平台（AI 相关交易公告）',
  url: 'https://www.ggzy.gov.cn/',
  keywords: ['智能建造'],
  sector: '施工',
  scope: '国内',
  region: '中国',
};

const NOW = Date.parse('2026-09-26T02:00:00Z');

const record = (over = {}) => ({
  id: '0042d6ca2d8c1aa242ceaab629803b0b45ad',
  publishTime: '2026-09-25',
  deadline: null,
  transactionSourcesPlatformText: '湖北省政府采购网',
  businessTypeText: '政府采购',
  informationType: '0203',
  informationTypeText: '采购合同',
  province: '420000',
  provinceText: '湖北省',
  title: '某设计院智能建造知识库平台建设项目采购合同公告',
  url: '/information/deal/html/a/420000/0203/20260925/0042d6ca2d8c1aa242ceaab629803b0b45ad.html',
  ...over,
});
const payload = records => JSON.stringify({code: 200, message: 'success', data: {records, total: records.length, size: 20, current: 1, pages: 1}});

test('ggzy search request stays on the documented host with a 30-day window', () => {
  assert.equal(ggzySearchUrl(), 'https://www.ggzy.gov.cn/information/pubTradingInfo/getTradList');
  const body = new URLSearchParams(ggzySearchBody('智能建造', NOW));
  assert.equal(body.get('FINDTXT'), '智能建造');
  assert.equal(body.get('SOURCE_TYPE'), '1');
  assert.equal(body.get('DEAL_TIME'), '02');
  assert.equal(body.get('TIMEBEGIN'), '2026-08-28');
  assert.equal(body.get('TIMEEND'), '2026-09-26');
  assert.equal(body.get('PAGENUMBER'), '1');
});

test('ggzy parser keeps civil AI notices and never verifies', () => {
  const [item, ...rest] = parseGgzyResponse(payload([
    record(),
    record({id: 'x2', title: '某医院人工智能实训室设备采购公告', url: '/information/deal/html/a/420000/0203/20260926/x2.html'}), // 非土木工程，滤除
    record({id: 'x3', title: '老旧智能建造公告', publishTime: '2026-01-10', url: '/information/deal/html/a/420000/0203/20260110/x3.html'}), // 超出窗口
    record({id: 'x4', url: ''}), // 无链接，跳过
  ]), source, NOW);
  assert.equal(rest.length, 0);
  assert.equal(item.sourceUrl, 'https://www.ggzy.gov.cn/information/deal/html/a/420000/0203/20260925/0042d6ca2d8c1aa242ceaab629803b0b45ad.html');
  assert.equal(item.publishedDate, '2026-09-25');
  assert.equal(item.evidence, '待复核');
  assert.equal(item.dataOrigin, 'collector');
  assert.equal(item.reading.kind, 'procurement-notice');
  assert.match(item.reading.notice, /需回链公告原文确认/);
  assert.match(item.reading.paragraphs.zh.join('\n'), /来源平台：湖北省政府采购网/);
  assert.equal(item.procurement.region, '湖北省');
  assert.equal(item.procurement.noticeType, '采购合同');
  assert.equal(item.procurement.noticeClass, 'other');
  assert.equal(item.editorial?.salesStage === '可破冰', false);
});

test('ggzy parser rejects unexpected payloads instead of inventing results', () => {
  assert.throws(() => parseGgzyResponse('风控验证页', source, NOW), /JSON/);
  assert.throws(() => parseGgzyResponse(JSON.stringify({code: 500, message: 'error'}), source, NOW), /结构未识别/);
  assert.deepEqual(parseGgzyResponse(payload([]), source, NOW), []);
});

test('ggzy collector merges keywords, warns on single failure, fails only when all fail', async () => {
  const calls = [];
  const articles = await collectGgzy({...source, keywords: ['智能建造', '智慧工地']}, {
    safeFetch: async (url, options = {}) => {
      const body = decodeURIComponent(String(options.body));
      calls.push(body);
      if (body.includes('智慧工地')) return new Response('boom', {status: 502});
      return new Response(payload([record()]), {headers: {'Content-Type': 'application/json'}});
    },
    boundedText: async r => r.text(),
    now: () => NOW,
  });
  assert.equal(articles.length, 1);
  assert.equal(articles.warnings.length, 1);
  assert.match(articles.warnings[0], /智慧工地: Source HTTP 502/);
  assert.equal(calls.length, 2);
  assert.equal(GGZY_SEARCH_TIMEOUT_MS, 60000);

  await assert.rejects(
    collectGgzy(source, {
      safeFetch: async () => new Response('blocked', {status: 403}),
      boundedText: async r => '',
      now: () => NOW,
    }),
    /403/,
  );
});

test('ggzy source runs through the collector after robots check and stores pending-review records', async t => {
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
      if (target === 'https://www.ggzy.gov.cn/information/pubTradingInfo/getTradList') {
        assert.equal(options.method, 'POST');
        posts.push(String(options.body));
        return new Response(payload([record()]), {headers: {'Content-Type': 'application/json'}});
      }
      return new Response('not found', {status: 404});
    },
  });
  const result = await collector.run();
  assert.equal(result.results[0].status, 'ok');
  assert.equal(result.results[0].added, 1);
  assert.equal(posts.length, 1);
  assert.ok(posts[0].includes('FINDTXT='));
  const rows = db.prepare('SELECT data FROM articles').all().map(r => JSON.parse(r.data));
  assert.ok(rows.every(r => r.sourceId === 'ggzy-national' && r.evidence === '待复核' && r.sourceUrl.startsWith('https://www.ggzy.gov.cn/')));
});
