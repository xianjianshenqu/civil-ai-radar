import test from 'node:test';
import assert from 'node:assert/strict';
import {CCGP_SEARCH_TIMEOUT_MS, ccgpSearchUrl, collectProcurement, parseCcgpList} from '../server/procurement.mjs';
import {collectorFetchSignal, createCollector} from '../server/collector.mjs';
import {openDatabase} from '../server/database.mjs';

const source = {
  id: 'ccgp-procurement',
  kind: 'ccgp',
  tier: 't1',
  name: '中国政府采购网（AI 相关采购公告）',
  url: 'https://search.ccgp.gov.cn/bxsearch',
  articleHosts: ['www.ccgp.gov.cn'],
  keywords: ['智能建造', '人工智能'],
  sector: '施工',
  scope: '国内',
  region: '中国',
};

const li = ({href, title, snippet, meta}) => `<li><a href="${href}" style="line-height:18px"> ${title} </a><p>${snippet}</p><span>${meta}</span></li>`;
const list = items => `<html><body><ul class="vT-srch-result-list-bid">${items.join('')}</ul></body></html>`;

test('ccgp search URL stays on the documented host', () => {
  const url = new URL(ccgpSearchUrl('智能建造'));
  assert.equal(url.hostname, 'search.ccgp.gov.cn');
  assert.equal(url.protocol, 'https:');
  assert.equal(url.searchParams.get('kw'), '智能建造');
});

test('ccgp list keeps civil AI tenders, upgrades to https, and never verifies', () => {
  const html = list([
    li({
      href: 'http://www.ccgp.gov.cn/cggg/dfgg/zbgg/202609/t20260917_1.htm',
      title: '中建三局智能建造与<font color=red>人工智能</font>知识库系统采购项目招标公告',
      snippet: '一、项目编号：ZB2026-091二、项目名称：智能建造知识库系统三、采购需求：工程设计知识库与智能问答平台。',
      meta: '2026.09.17 11:15:36 | 采购人：中建三局 | 代理机构：湖北某招标有限公司 <br/> <strong style="font-weight:bolder"> 招标公告 </strong> | 湖北 | <strong style="font-weight:bolder"> 信息技术服务</strong>',
    }),
    li({
      href: 'http://www.ccgp.gov.cn/cggg/dfgg/zbgg/202608/t20260801_2.htm',
      title: '某医院<font color=red>人工智能</font>辅助诊断系统采购公告',
      snippet: '医院影像人工智能辅助诊断系统采购。',
      meta: '2026.09.16 09:00:00 | 采购人：某市人民医院 | 代理机构：某代理公司 <br/> <strong> 中标公告 </strong> | 广东 | ',
    }),
    li({
      href: 'http://www.ccgp.gov.cn/cggg/dfgg/zbgg/202501/t20250101_3.htm',
      title: '某公路局智慧工地<font color=red>人工智能</font>监测老旧公告',
      snippet: '智慧工地施工监测。',
      meta: '2026.01.10 09:00:00 | 采购人：某公路局 <br/> <strong> 招标公告 </strong> | 四川 | ',
    }),
    li({
      href: 'http://evil.example/notice.htm',
      title: '智能建造公告（非政采域名）',
      snippet: '智能建造工程。',
      meta: '2026.09.16 09:00:00 | 采购人：某单位 <br/> <strong> 招标公告 </strong> | 北京 | ',
    }),
  ]);
  const [item] = parseCcgpList(html, source, Date.parse('2026-09-18T02:00:00Z'));
  assert.equal(item.sourceUrl, 'https://www.ccgp.gov.cn/cggg/dfgg/zbgg/202609/t20260917_1.htm');
  assert.equal(item.title, '中建三局智能建造与人工智能知识库系统采购项目招标公告');
  assert.equal(item.evidence, '待复核');
  assert.equal(item.dataOrigin, 'collector');
  assert.equal(item.featuredRank, undefined);
  assert.equal(item.reading.kind, 'procurement-notice');
  assert.match(item.reading.paragraphs.zh.join('\n'), /采购人：中建三局/);
  assert.match(item.reading.notice, /需回链公告原文确认/);
  assert.equal(item.procurement.buyer, '中建三局');
  assert.equal(item.procurement.noticeType, '招标公告');
  assert.equal(item.publishedDate, '2026-09-17');
  // P0：买家单位 + 产品切口 + 招标动作；但仍是待复核，不是可破冰。
  assert.equal(item.assistScore.priority, 'P0');
  assert.ok(item.assistScore.offerings.includes('知识库'));
  assert.equal(item.editorial?.salesStage === '可破冰', false);
});

test('ccgp parser rejects unrecognized pages instead of inventing results', () => {
  assert.throws(() => parseCcgpList('<html>风控验证页</html>', source), /结构未识别/);
  assert.deepEqual(parseCcgpList('<ul class="vT-srch-result-list-bid"></ul>', source, Date.now()), []);
});

test('ccgp collector merges keywords after robots check and stores records', async t => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const searched = [];
  const collector = createCollector({
    db,
    sources: [source],
    now: () => Date.parse('2026-09-18T02:00:00Z'),
    fetchImpl: async url => {
      const target = String(url);
      searched.push(target);
      if (target.endsWith('/robots.txt')) return new Response('Sorry, Page Not Found', {headers: {'Content-Type': 'text/html'}});
      if (target.startsWith('https://search.ccgp.gov.cn/bxsearch')) {
        const kw = new URL(target).searchParams.get('kw');
        const item = kw === '智能建造'
          ? li({
              href: 'http://www.ccgp.gov.cn/cggg/dfgg/zbgg/202609/t20260917_1.htm',
              title: '智能建造知识库系统采购项目招标公告',
              snippet: '工程设计智能建造知识库采购。',
              meta: '2026.09.17 11:15:36 | 采购人：中建三局 <br/> <strong> 招标公告 </strong> | 湖北 | ',
            })
          : li({
              href: 'http://www.ccgp.gov.cn/cggg/dfgg/zbgg/202609/t20260917_9.htm',
              title: '同一批智能建造与人工智能公告（重复线索）',
              snippet: '智能建造知识库采购，同一条公告在不同关键词下重复出现。',
              meta: '2026.09.17 11:15:36 | 采购人：中建三局 <br/> <strong> 招标公告 </strong> | 湖北 | ',
            });
        return new Response(list([item]), {headers: {'Content-Type': 'text/html; charset=utf-8'}});
      }
      return new Response('not found', {status: 404});
    },
  });
  const result = await collector.run();
  assert.equal(result.results[0].status, 'ok');
  assert.equal(result.results[0].added, 2);
  assert.ok(searched.some(u => u.includes('kw=')));
  const rows = db.prepare('SELECT data FROM articles').all().map(r => JSON.parse(r.data));
  assert.ok(rows.every(r => r.dataOrigin === 'collector' && r.evidence === '待复核'));
  assert.ok(rows.every(r => r.sourceUrl.startsWith('https://www.ccgp.gov.cn/')));
});

test('ccgp source failure is reported honestly when all keywords fail', async () => {
  await assert.rejects(
    collectProcurement(source, {
      safeFetch: async () => new Response('blocked', {status: 403}),
      boundedText: async r => '',
      now: () => Date.now(),
    }),
    /403/,
  );
});

const tender = li({
  href: 'http://www.ccgp.gov.cn/cggg/dfgg/zbgg/202609/t20260917_1.htm',
  title: '智能建造知识库系统采购项目招标公告',
  snippet: '工程设计智能建造知识库采购。',
  meta: '2026.09.17 11:15:36 | 采购人：中建三局 <br/> <strong> 招标公告 </strong> | 湖北 | ',
});
const timeoutError = () => new DOMException('The operation was aborted due to timeout', 'TimeoutError');

test('ccgp search uses its own timeout instead of the shared 20s signal', async () => {
  assert.ok(CCGP_SEARCH_TIMEOUT_MS >= 45000 && CCGP_SEARCH_TIMEOUT_MS <= 90000);
  const own = new AbortController().signal;
  assert.equal(collectorFetchSignal({signal: own, timeoutMs: 20000}), own);
  const short = collectorFetchSignal({timeoutMs: 30});
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(short.aborted, true);
  assert.equal(short.reason?.name, 'TimeoutError');
  const calls = [];
  await collectProcurement(source, {
    timeoutMs: 40,
    now: Date.parse('2026-09-18T02:00:00Z'),
    boundedText: async response => response.text(),
    safeFetch: async (url, options) => {
      calls.push({url, signal: options.signal, timeoutMs: options.timeoutMs});
      assert.equal(options.timeoutMs, 40);
      assert.ok(options.signal);
      assert.equal(new URL(url).hostname, 'search.ccgp.gov.cn');
      return new Response(list([]), {status: 200});
    },
  });
  assert.equal(calls.length, source.keywords.length);
  assert.equal(new Set(calls.map(call => call.signal)).size, calls.length);
});

test('one timed-out ccgp keyword stays a warning and the rest are kept', async () => {
  const calls = [];
  const articles = await collectProcurement(source, {
    timeoutMs: 40,
    now: Date.parse('2026-09-18T02:00:00Z'),
    boundedText: async response => response.text(),
    safeFetch: (url, options) => {
      const kw = new URL(url).searchParams.get('kw');
      calls.push(kw);
      if (kw === '智能建造') {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('hung past the ccgp signal')), 500);
          options.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(timeoutError());
          });
        });
      }
      return new Response(list([tender]), {status: 200});
    },
  });
  assert.deepEqual(calls, ['智能建造', '人工智能']);
  assert.equal(articles.length, 1);
  assert.equal(articles[0].procurement.buyer, '中建三局');
  assert.equal(articles[0].sourceUrl, 'https://www.ccgp.gov.cn/cggg/dfgg/zbgg/202609/t20260917_1.htm');
  assert.deepEqual(articles.warnings, ['智能建造: The operation was aborted due to timeout']);
});

test('a keyword with no matches still counts as success when another keyword times out', async () => {
  const articles = await collectProcurement(source, {
    now: Date.parse('2026-09-18T02:00:00Z'),
    boundedText: async response => response.text(),
    safeFetch: async url => {
      const kw = new URL(url).searchParams.get('kw');
      if (kw === '智能建造') throw timeoutError();
      return new Response(list([]), {status: 200});
    },
  });
  assert.equal(articles.length, 0);
  assert.deepEqual(articles.warnings, ['智能建造: The operation was aborted due to timeout']);
});

test('ccgp source fails only when every keyword times out', async () => {
  await assert.rejects(
    collectProcurement(source, {
      timeoutMs: 30,
      boundedText: async response => response.text(),
      safeFetch: (url, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(timeoutError()));
      }),
    }),
    /智能建造: The operation was aborted due to timeout.*人工智能: The operation was aborted due to timeout/,
  );
});

test('collector keeps ccgp successful after a partial keyword timeout', async t => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const signals = [];
  const hosts = [];
  const collector = createCollector({
    db,
    sources: [source],
    now: () => Date.parse('2026-09-18T02:00:00Z'),
    fetchImpl: async (url, init) => {
      const target = String(url);
      hosts.push(new URL(target).hostname);
      if (target.endsWith('/robots.txt')) return new Response('Sorry, Page Not Found', {status: 200});
      if (target.startsWith('https://search.ccgp.gov.cn/bxsearch')) {
        signals.push(init.signal);
        const kw = new URL(target).searchParams.get('kw');
        if (kw === '智能建造') throw timeoutError();
        return new Response(list([tender]), {headers: {'Content-Type': 'text/html; charset=utf-8'}});
      }
      return new Response('not found', {status: 404});
    },
  });
  const result = await collector.run();
  assert.equal(result.results[0].status, 'ok');
  assert.equal(result.results[0].added, 1);
  assert.deepEqual(result.results[0].warnings, ['智能建造: The operation was aborted due to timeout']);
  assert.equal(signals.length, 2);
  assert.notEqual(signals[0], signals[1]);
  assert.ok(signals.every(signal => signal && signal.aborted === false));
  assert.deepEqual([...new Set(hosts)], ['search.ccgp.gov.cn']);
  const row = db.prepare('SELECT last_success, error FROM sources WHERE id=?').get(source.id);
  assert.equal(row.last_success, Date.parse('2026-09-18T02:00:00Z'));
  assert.equal(row.error, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM articles').get().n, 1);
});

test('collector marks ccgp failed only after every keyword times out', async t => {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const collector = createCollector({
    db,
    sources: [source],
    now: () => Date.parse('2026-09-18T02:00:00Z'),
    fetchImpl: async url => {
      const target = String(url);
      if (target.endsWith('/robots.txt')) return new Response('Sorry, Page Not Found', {status: 200});
      if (target.startsWith('https://search.ccgp.gov.cn/bxsearch')) throw timeoutError();
      return new Response('not found', {status: 404});
    },
  });
  const result = await collector.run();
  assert.equal(result.results[0].status, 'error');
  assert.match(result.results[0].error, /智能建造: The operation was aborted due to timeout/);
  assert.match(result.results[0].error, /人工智能: The operation was aborted due to timeout/);
  const row = db.prepare('SELECT last_success, error FROM sources WHERE id=?').get(source.id);
  assert.equal(row.last_success, null);
  assert.match(row.error, /The operation was aborted due to timeout/);
});
