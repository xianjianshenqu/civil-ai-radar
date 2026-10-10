import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {openDatabase} from '../server/database.mjs';
import {createApp} from '../server/app.mjs';
import {classifyNotice, compareTenderDeadline, deadlineUrgency, extractAmounts, extractDeadline, extractOrgNames, filterKnownOrgs, noticeClassOf, noticeDeadlineDate, parseDeadlineDate, salesHypothesisLabel, shanghaiToday, sortTenderNotices} from '../src/lib/intel.js';
import {sanitizeMachineReview} from '../src/lib/machineReview.js';

test('notice classification splits tender, result and other lanes', () => {
  assert.equal(classifyNotice('中标公告', ''), 'result');
  assert.equal(classifyNotice('成交公告', ''), 'result');
  assert.equal(classifyNotice('招标公告', ''), 'tender');
  assert.equal(classifyNotice('竞争性磋商公告', ''), 'tender');
  assert.equal(classifyNotice('更正公告', ''), 'other');
  assert.equal(classifyNotice('', 'XX项目废标公告'), 'other');
  assert.equal(noticeClassOf({procurement: {noticeClass: 'tender', noticeType: '中标公告'}, title: '中标公告'}), 'tender');
  assert.equal(noticeClassOf({procurement: {noticeType: '中标公告'}, title: '平台中标公告'}), 'result');
  assert.equal(noticeClassOf({procurement: {noticeType: '更正公告'}, title: '更正公告'}), 'other');
  assert.equal(noticeClassOf({procurement: {noticeType: '公开招标公告'}, title: '公开招标公告'}), 'tender');
  assert.equal(noticeClassOf({title: '某项目中标公告解读'}), '');
  assert.equal(noticeClassOf({noticeClass: 'result', title: '热点事件'}), 'result');
  assert.equal(noticeClassOf({noticeClass: 'nope'}), '');
  assert.equal(noticeClassOf(null), '');
});

test('amount and deadline extraction only returns verbatim fragments', () => {
  const text = '预算金额 1,280万元；投标截止时间：2026年10月20日 17:00 递交；中标金额 96.5万元。';
  assert.deepEqual(extractAmounts(text), ['1,280万元', '96.5万元']);
  assert.match(extractDeadline(text), /截止时间：2026年10月20日/);
  assert.deepEqual(extractAmounts('本文没有任何金额信息'), []);
  assert.equal(extractDeadline('会议在 2026年10月20日 召开'), '');
});

test('tender notices sort by parsed deadline, then published date', () => {
  const rows = [
    {id: 'none-new', title: '无日期甲', publishedDate: '2026-09-20'},
    {id: 'far', title: '投标截止时间：2026年11月02日', publishedDate: '2026-09-01'},
    {id: 'near', title: '正文里另有开标时间：2026年12月01日', publishedDate: '2026-08-01', machineReview: {extracted: {deadline: '截止时间：2026年10月08日'}}},
    {id: 'none-old', title: '无日期乙', publishedDate: '2026-09-02'},
    {id: 'mid', title: '开标时间：2026年10月15日', publishedDate: '2026-09-18'},
    {id: 'same-older', title: '投标截止时间：2026年10月08日', publishedDate: '2026-07-01'},
  ];
  const original = rows.map(row => row.id);
  assert.deepEqual(sortTenderNotices(rows).map(row => row.id), ['near', 'same-older', 'mid', 'far', 'none-new', 'none-old']);
  assert.deepEqual(rows.map(row => row.id), original);
  assert.equal(noticeDeadlineDate(rows[2]), '2026-10-08');
  assert.equal(noticeDeadlineDate({title: '投标截止时间：2026年10月20日', machineReview: {extracted: {deadline: '见招标文件'}}}), '2026-10-20');
  assert.equal(parseDeadlineDate('2026年2月31日'), '');
  assert.equal(parseDeadlineDate('截止 3月5日'), '');
  assert.equal(compareTenderDeadline({title: '投标截止时间：2026年10月20日', publishedDate: '2026-09-01'}, {title: '投标截止时间：2026年10月20日', publishedDate: '2026-09-12'}), 1);
  assert.equal(deadlineUrgency('2026-10-03', '2026-10-03'), 'soon');
  assert.equal(deadlineUrgency('2026-10-10', '2026-10-03'), 'soon');
  assert.equal(deadlineUrgency('2026-10-11', '2026-10-03'), '');
  assert.equal(deadlineUrgency('2026-10-02', '2026-10-03'), 'passed');
  assert.equal(deadlineUrgency('2026-10-01', '2026-10-03'), 'passed');
  assert.equal(deadlineUrgency('2026-09-30', '2026-10-03'), '');
  assert.equal(shanghaiToday(new Date('2026-09-24T16:00:00Z')), '2026-09-25');
  assert.equal(shanghaiToday(new Date('2026-09-24T15:30:00Z')), '2026-09-24');
  assert.equal(salesHypothesisLabel({machineReview: {salesVerdict: '重点跟进'}, assistScore: {priority: 'P0'}}), '销售价值·假设 · 重点跟进');
  assert.equal(salesHypothesisLabel({assistScore: {priority: 'P1'}}), '销售价值·假设');
  assert.equal(salesHypothesisLabel({machineReview: {salesVerdict: '已核验'}, assistScore: {priority: 'P2'}}), '销售价值·假设');
  assert.equal(salesHypothesisLabel({}), '');
});

test('org name extraction keeps real institutes and drops junk', () => {
  const names = extractOrgNames('近日湘北水利建设集团有限公司与中铁第五勘察设计院集团有限公司签约，我公司和某监理公司参与，清华大学协办');
  assert.ok(names.includes('湘北水利建设集团有限公司'));
  assert.ok(names.includes('中铁第五勘察设计院集团有限公司'));
  assert.ok(!names.some(n => /我公司|清华|大学/.test(n)));
  assert.deepEqual(filterKnownOrgs(['中建三局集团有限公司', '湘北水利建设集团有限公司'], ['中建三局']), ['湘北水利建设集团有限公司']);
});

test('machine extraction sanitization drops invented values and falls back to rules', () => {
  const article = {
    title: '某局智慧工地平台采购项目中标 96.5万元',
    summary: '由中国政府采购网检索结果发现的线索。',
    reading: {paragraphs: {zh: ['开标时间为 2026年10月20日。']}},
  };
  const score = {total: 60, offerings: ['知识库'], watchOrgs: [], salesStage: '待判断', priority: 'P1'};
  const raw = {
    summary: '某局智慧工地平台采购项目。',
    implication: '买家信号，待复核。',
    salesValue: 70, salesVerdict: '观察', verdictReason: '有明确采购人。',
    extracted: {
      amounts: ['96.5万元', '9999万元'],
      deadline: '开标时间为 2026年10月20日',
      clientOrgs: ['不存在的单位集团有限公司'],
    },
  };
  const clean = sanitizeMachineReview(raw, score, article);
  assert.deepEqual(clean.extracted.amounts, ['96.5万元']);
  assert.match(clean.extracted.deadline, /2026年10月20日/);
  assert.deepEqual(clean.extracted.clientOrgs, []);
  const rules = sanitizeMachineReview({summary: '', implication: ''}, score, article);
  assert.deepEqual(rules.extracted.amounts, ['96.5万元']);
  assert.equal(rules.extracted.basis, 'rules');
});

async function fixture(t) {
  const db = openDatabase(':memory:');
  const config = {production: false, publicUrl: 'http://127.0.0.1', port: 0, mailMode: 'local', adminEmails: ['admin@example.test'], feedbackTo: 'admin@example.test', collectorEnabled: true, intervalMs: 3600000};
  const app = createApp({db, config, sources: [], now: () => Date.parse('2026-09-19T09:00:00Z')});
  const server = createServer(app.handler);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  config.port = server.address().port;
  const origin = `http://127.0.0.1:${config.port}`;
  config.publicUrl = origin;
  t.after(async () => {await new Promise(r => server.close(r)); db.close();});
  async function request(path, {method = 'GET', data, cookie} = {}) {
    const response = await fetch(origin + '/api' + path, {method, headers: {Origin: origin, ...(cookie ? {Cookie: cookie} : {}), ...(data ? {'Content-Type': 'application/json'} : {})}, body: data ? JSON.stringify(data) : undefined});
    const text = await response.text();
    return {status: response.status, data: text ? JSON.parse(text) : null, cookie: response.headers.get('set-cookie')?.split(';')[0]};
  }
  const sent = await request('/auth/request', {method: 'POST', data: {email: 'admin@example.test'}});
  const payload = JSON.parse(db.prepare('SELECT payload FROM outbox WHERE id=?').get(sent.data.challengeId).payload);
  const verify = await request('/auth/verify', {method: 'POST', data: {challengeId: sent.data.challengeId, code: payload.text.match(/\d{6}/)[0]}});
  return {app, db, request, admin: {cookie: verify.cookie}};
}

test('watchlist extras join scoring, batch intake reports per-line results, intel endpoints answer', async t => {
  const {app, db, request, admin} = await fixture(t);
  assert.equal((await request('/watchlist')).status, 401);
  const added = await request('/watchlist', {method: 'POST', cookie: admin.cookie, data: {name: '某某省交通规划设计院', aliases: ['省交规院'], layer: 'unit', isBuyer: true, offerings: ['知识库'], buyerRole: '设计院'}});
  assert.equal(added.status, 200);
  const addedOrg = added.data.orgs.find(o => o.name === '某某省交通规划设计院');
  assert.ok(addedOrg && addedOrg.id.startsWith('x-'));
  assert.equal((await request('/watchlist', {method: 'POST', cookie: admin.cookie, data: {name: '某某省交通规划设计院', layer: 'unit'}})).status, 409);

  // 单条登记：正文点名新增观察单位 → 公开列表的即时计分应命中该单位。
  const one = await request('/intake', {method: 'POST', cookie: admin.cookie, data: {sourceUrl: 'https://example.org/a1', title: '省交规院上线知识库试点', quote: '某某省交通规划设计院推进智能问答知识库落地。'}});
  assert.equal(one.status, 200);
  const articles = (await request('/articles')).data.articles;
  const scored = articles.find(a => a.title === '省交规院上线知识库试点');
  assert.ok(scored.assistScore.watchOrgs.some(w => w.id === addedOrg.id), 'extras must join watch-org scoring at read time');

  // 批量登记：两条有效 + 一条重复链接，逐条返回结果。
  const batch = await request('/intake', {method: 'POST', cookie: admin.cookie, data: {items: [
    {sourceUrl: 'https://example.org/b1', title: '湘北水利建设集团智慧工地纪实', quote: '湘北水利建设集团有限公司推进智慧工地。'},
    {sourceUrl: 'https://example.org/b2', title: '湘北水利建设集团再签数智化协议', quote: '湘北水利建设集团有限公司与厂商合作数智化转型。'},
    {sourceUrl: 'https://example.org/a1', title: '重复链接应失败'},
    {sourceUrl: 'notaurl', title: '缺链接应失败'},
  ]}});
  assert.equal(batch.status, 200);
  assert.deepEqual(batch.data.results.map(r => r.ok), [true, true, false, false]);
  assert.match(batch.data.results[2].error, /已入库/);

  const discovery = await request('/intel/discovery?days=30', {cookie: admin.cookie});
  assert.equal(discovery.status, 200);
  const candidate = discovery.data.candidates.find(c => c.name === '湘北水利建设集团有限公司');
  assert.ok(candidate && candidate.count >= 2, 'high-frequency non-watchlist org should surface');

  const coverage = await request('/intel/coverage?days=90', {cookie: admin.cookie});
  assert.equal(coverage.status, 200);
  const covered = coverage.data.orgs.find(o => o.id === addedOrg.id);
  assert.ok(covered && covered.count >= 1);
  assert.equal(typeof coverage.data.zeroCount, 'number');

  const sources = await request('/intel/sources', {cookie: admin.cookie});
  assert.equal(sources.status, 200);
  assert.ok(sources.data.sources.some(s => s.sourceId === 'manual-intake' && s.total >= 3));

  const removed = await request('/watchlist', {method: 'DELETE', cookie: admin.cookie, data: {id: addedOrg.id}});
  assert.equal(removed.status, 200);
  assert.ok(!removed.data.orgs.some(o => o.id === addedOrg.id));
  assert.equal((await request('/watchlist', {method: 'DELETE', cookie: admin.cookie, data: {id: 'g-cscec'}})).status, 400);
});
