import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GZGGZY_COLUMNS, GZGGZY_SEARCH_TIMEOUT_MS, collectGzggzy, gzggzySearchUrl, parseGzggzyList} from '../server/gzggzy.mjs';
import {createCollector} from '../server/collector.mjs';
import {openDatabase} from '../server/database.mjs';
import {sources} from '../server/sources.mjs';

const source = {
  id: 'gzggzy-guangzhou',
  kind: 'gzggzy',
  tier: 't1',
  name: '广州公共资源交易中心（工程建设招标公告）',
  url: 'https://www.gzggzy.cn/',
  articleHosts: ['gzggzy.cn'],
  columns: ['jyywjsgcfwjzzbgg', 'jyywjsgcslswzbgg'],
  keywords: ['智能建造'],
  sector: '施工',
  scope: '国内',
  region: '中国',
};

const NOW = Date.parse('2024-12-26T02:00:00Z');
const column = {path: 'jyywjsgcfwjzzbgg', name: '房屋建筑', noticeType: '招标公告'};
const fixture = readFileSync(new URL('./fixtures/gzggzy-list.html', import.meta.url), 'utf8');

const row = ({href, title, date}) => `<tr><td>1</td><td><a href="${href}" class="title">${title}</a></td><td><span>${date}</span></td></tr>`;
const page = rows => `<table class="table public-table procureBulletin-table"><tbody>${rows}</tbody></table>`;

test('gzggzy search stays on the official column page with a title keyword', () => {
  assert.equal(gzggzySearchUrl('jyywjsgcfwjzzbgg', '智能建造'), 'https://www.gzggzy.cn/jyywjsgcfwjzzbgg/index.jhtml?word=%E6%99%BA%E8%83%BD%E5%BB%BA%E9%80%A0');
  assert.equal(gzggzySearchUrl('jyywjsgcslswzbgg', '智慧水利'), 'https://www.gzggzy.cn/jyywjsgcslswzbgg/index.jhtml?word=%E6%99%BA%E6%85%A7%E6%B0%B4%E5%88%A9');
  assert.equal(GZGGZY_SEARCH_TIMEOUT_MS, 60000);
  assert.equal(GZGGZY_COLUMNS.size, 4);
});

test('gzggzy source is registered against www.gzggzy.cn with four construction columns', () => {
  const registered = sources.find(item => item.id === 'gzggzy-guangzhou');
  assert.equal(registered.kind, 'gzggzy');
  assert.equal(registered.url, 'https://www.gzggzy.cn/');
  const shenzhen = sources.find(item => item.id === 'szggzy-shenzhen');
  assert.deepEqual(registered.columns, [...GZGGZY_COLUMNS.keys()]);
  assert.deepEqual(registered.keywords, shenzhen.keywords);
  assert.equal(registered.disabledReason, undefined);
});

test('saved column page does not invent matches when titles are not civil AI', () => {
  assert.match(fixture, /procureBulletin-table/);
  assert.match(fixture, /1028513\.jhtml/);
  assert.deepEqual(parseGzggzyList(fixture, source, NOW, column), []);
});

test('gzggzy parser keeps civil AI tenders, joins highlight spans, and never verifies', () => {
  const highlighted = "<span class='redtip'></span>智<span class='redtip'></span>能<span class='redtip'></span>建<span class='redtip'></span>造智慧工地数字孪生市政道路工程施工招标公告";
  const [item, ...rest] = parseGzggzyList(page([
    row({href: '/jyywjsgcfwjzzbgg/9001001.jhtml', title: `[JG2026-1001] ${highlighted}`, date: '2024-12-20'}),
    row({href: '/jyywjsgcfwjzzbgg/9001002.jhtml', title: '人工智能实训室设备采购招标公告', date: '2024-12-20'}),
    row({href: '/jyywjsgcfwjzzbgg/9001003.jhtml', title: '[JG2024-1] 老旧智慧工地道路工程施工招标公告', date: '2024-01-02'}),
    row({href: '/jyywjsgcfwjzzbgg/9001004.jhtml', title: '', date: '2024-12-20'}),
    row({href: 'https://example.org/off-host.jhtml', title: '智能建造桥梁工程施工招标公告', date: '2024-12-20'}),
  ].join('')), source, NOW, column);
  assert.equal(rest.length, 0);
  assert.equal(item.sourceUrl, 'https://www.gzggzy.cn/jyywjsgcfwjzzbgg/9001001.jhtml');
  assert.equal(item.title, '[JG2026-1001] 智能建造智慧工地数字孪生市政道路工程施工招标公告');
  assert.equal(item.publishedDate, '2024-12-20');
  assert.equal(item.evidence, '待复核');
  assert.equal(item.dataOrigin, 'collector');
  assert.equal(item.reading.kind, 'procurement-notice');
  assert.match(item.reading.notice, /需回链公告原文确认/);
  assert.match(item.reading.paragraphs.zh.join('\n'), /项目编号：JG2026-1001/);
  assert.match(item.reading.paragraphs.zh.join('\n'), /采购人：摘要未披露/);
  assert.match(item.reading.paragraphs.zh.join('\n'), /工程类别：房屋建筑/);
  assert.equal(item.procurement.buyer, undefined);
  assert.equal(item.procurement.noticeType, '招标公告');
  assert.equal(item.procurement.noticeClass, 'tender');
  assert.equal(item.procurement.region, '广州');
  assert.equal(item.editorial?.salesStage === '可破冰', false);
});

test('gzggzy parser accepts the apex host and rejects unexpected pages', () => {
  const [item] = parseGzggzyList(page(row({
    href: 'https://gzggzy.cn/jyywjsgcslswzbgg/9002001.jhtml',
    title: '智慧水利数字孪生水库除险加固工程施工招标公告',
    date: '2024-12-18',
  })), source, NOW, {name: '水利水务', noticeType: '招标公告'});
  assert.equal(item.sourceUrl, 'https://gzggzy.cn/jyywjsgcslswzbgg/9002001.jhtml');
  assert.equal(item.procurement.noticeClass, 'tender');
  assert.throws(() => parseGzggzyList('<html><title>403 Forbidden</title><center>WAF</center></html>', source, NOW, column), /结构未识别/);
  assert.deepEqual(parseGzggzyList(page(''), source, NOW, column), []);
});

test('gzggzy collector dedupes across columns and warns per column-keyword', async () => {
  const calls = [];
  const hit = page(row({
    href: '/jyywjsgcfwjzzbgg/9001001.jhtml',
    title: '[JG2026-1001] 智能建造智慧工地道路工程施工招标公告',
    date: '2024-12-20',
  }));
  const articles = await collectGzggzy(source, {
    safeFetch: async url => {
      calls.push(String(url));
      if (String(url).includes('jyywjsgcslswzbgg')) return new Response('blocked', {status: 500});
      return new Response(hit, {headers: {'Content-Type': 'text/html'}});
    },
    boundedText: async response => response.text(),
    now: () => NOW,
  });
  assert.equal(articles.length, 1);
  assert.equal(articles.warnings.length, 1);
  assert.match(articles.warnings[0], /水利水务\/智能建造: Source HTTP 500/);
  assert.deepEqual(calls, [
    'https://www.gzggzy.cn/jyywjsgcfwjzzbgg/index.jhtml?word=%E6%99%BA%E8%83%BD%E5%BB%BA%E9%80%A0',
    'https://www.gzggzy.cn/jyywjsgcslswzbgg/index.jhtml?word=%E6%99%BA%E8%83%BD%E5%BB%BA%E9%80%A0',
  ]);

  await assert.rejects(
    collectGzggzy(source, {
      safeFetch: async () => new Response('blocked', {status: 403}),
      boundedText: async () => '',
      now: () => NOW,
    }),
    /403/,
  );
});

test('gzggzy source runs through the collector after robots check and stores pending-review records', async t => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const gets = [];
  const collector = createCollector({
    db,
    sources: [source],
    now: () => NOW,
    fetchImpl: async (url, options = {}) => {
      const target = String(url);
      gets.push(target);
      assert.equal(options.headers['User-Agent'], 'CivilAIRadar/1.0');
      if (target.endsWith('/robots.txt')) return new Response('404 page', {status: 404});
      if (target.startsWith('https://www.gzggzy.cn/') && target.includes('word=')) {
        return new Response(page(row({
          href: '/jyywjsgcfwjzzbgg/9001001.jhtml',
          title: '智能建造智慧工地道路工程施工招标公告',
          date: '2024-12-20',
        })), {headers: {'Content-Type': 'text/html'}});
      }
      return new Response('not found', {status: 404});
    },
  });
  const result = await collector.run();
  assert.equal(result.results[0].status, 'ok');
  assert.equal(result.results[0].added, 1);
  assert.equal(gets.filter(url => url.includes('/robots.txt')).length, 1);
  assert.equal(gets.filter(url => url.includes('word=')).length, 2);
  const rows = db.prepare('SELECT data FROM articles').all().map(record => JSON.parse(record.data));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sourceId, 'gzggzy-guangzhou');
  assert.equal(rows[0].evidence, '待复核');
  assert.equal(rows[0].sourceUrl, 'https://www.gzggzy.cn/jyywjsgcfwjzzbgg/9001001.jhtml');
});
