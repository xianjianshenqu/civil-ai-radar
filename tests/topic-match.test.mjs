import test from 'node:test';
import assert from 'node:assert/strict';
import {SECTORS, guessSector, matchTopics} from '../src/lib/topicMatch.js';
import {defaults, filterEntries} from '../src/lib/radar.js';
import {matchWatchOrgs, scoreArticle} from '../src/lib/scoring.js';
import {normalizeEntry} from '../src/lib/radar.js';
import {parseCcgpList} from '../server/procurement.mjs';

const ccgpSource = {
  id: 'ccgp-procurement', kind: 'ccgp', tier: 't1',
  name: '中国政府采购网（AI 相关采购公告）',
  url: 'https://search.ccgp.gov.cn/bxsearch',
  articleHosts: ['www.ccgp.gov.cn'],
  sector: '施工', scope: '国内', region: '中国',
};

test('sector list covers the six focus industries', () => {
  assert.deepEqual(SECTORS, ['交通', '水利', '电力', '石化', '新能源', '施工']);
});

test('guessSector classifies new-industry records and falls back honestly', () => {
  assert.equal(guessSector('输电线路无人机智能巡检项目'), '电力');
  assert.equal(guessSector('光伏电站智能运维采购'), '新能源');
  assert.equal(guessSector('抽水蓄能电站智能建造'), '新能源');
  assert.equal(guessSector('炼化装置数字孪生平台采购'), '石化');
  assert.equal(guessSector('水库大坝安全监测'), '水利');
  assert.equal(guessSector('城市轨道交通智能监测'), '交通');
  assert.equal(guessSector('与工程领域无关的文本'), '');
});

test('matchTopics maps records into topic library by keyword', () => {
  const petro = matchTopics('中石化炼化装置数字孪生与智能工厂平台采购公告');
  assert.ok(petro.includes('petro-digital-engineering'));
  const power = matchTopics('变电站无人机巡检与带电作业机器人采购');
  assert.ok(power.includes('smart-power-inspection'));
  const renewable = matchTopics('国家电投沙漠戈壁荒漠风电光伏基地智能建造送出工程');
  assert.ok(renewable.includes('wind-solar-base-construction'));
  assert.ok(renewable.includes('energy-giants-renewable'));
  assert.equal(matchTopics('餐饮行业营销系统采购').length, 0);
  assert.ok(matchTopics('铁路盾构智能选线与安全视觉监测基坑').length <= 4);
});

test('normalizeEntry attaches auto topic ids without touching editorial ones', () => {
  const entry = normalizeEntry({id:'t-1', title:'中石化智能炼厂数字孪生采购', summary:'石化炼化装置数字孪生。', source:'中国政府采购网', sourceUrl:'https://www.ccgp.gov.cn/cggg/a.htm', dataOrigin:'collector', scope:'国内', sector:'石化', evidence:'待复核', publishedDate:'2026-09-18'}, false);
  assert.ok(entry.autoTopicIds.includes('petro-digital-engineering'));
  assert.ok(entry.topicIds.includes('petro-digital-engineering'));
  assert.ok(normalizeEntry({id:'t-2', title:'演示条目', isDemo:true, summary:'', publishedDate:'2026-09-01'}, true).autoTopicIds.length === 0);
});

test('giant watchlist matches companies but not universities named after them', () => {
  const company = matchWatchOrgs('中石化工程建设有限公司发布智能工厂平台');
  assert.ok(company.some(org => org.id === 'g-sinopec'));
  const petrochina = matchWatchOrgs('中国石油天然气集团数智化转型');
  assert.ok(petrochina.some(org => org.id === 'g-petrochina'));
  const university = matchWatchOrgs('中国石油大学（北京）人工智能钻井论文，作者：中国石油大学');
  assert.equal(university.some(org => org.id === 'g-petrochina'), false);
  const grid = matchWatchOrgs('国家电网有限公司输电线路智能巡检');
  assert.ok(grid.some(org => org.id === 'g-sgcc'));
});

test('expanded engineering keywords admit petrochemical and renewable AI records', () => {
  const petro = scoreArticle({title:'炼化装置智能巡检与数字孪生采购', summary:'石化企业智能工厂。', sourceTier:'t1'});
  const solar = scoreArticle({title:'光伏电站智能运维平台采购', summary:'新能源场站。', sourceTier:'t1'});
  assert.ok(petro.total > 0 && petro.priority);
  assert.ok(solar.total > 0);
});

test('ccgp records get sector inferred from the announcement text', () => {
  const html = `<ul class="vT-srch-result-list-bid"><li><a href="http://www.ccgp.gov.cn/cggg/x/202609/t1.htm">输变电工程变电站无人机智能巡检服务采购公告</a><p>变电站无人机智能巡检。</p><span>2026.09.18 09:00:00 | 采购人：某省电力公司 <br/> <strong> 招标公告 </strong> | 江苏 | </span></li></ul>`;
  const [item] = parseCcgpList(html, ccgpSource, Date.parse('2026-09-18T02:00:00Z'));
  assert.equal(item.sector, '电力');
  assert.ok(item.assistScore.total > 0);
});

test('product-line offering signals are recognized for scoring and filtering', () => {
  const translation = scoreArticle({title:'某设计院海外工程项目翻译服务与多语言交付平台采购', summary:'一带一路境外项目英文招标文件翻译。', sourceTier:'t1'});
  assert.ok(translation.offerings.includes('翻译'));
  const knowledge = scoreArticle({title:'智能问答与知识管理平台建设采购公告', summary:'工程规范库与条文检索。', sourceTier:'t1'});
  assert.ok(knowledge.offerings.includes('知识库'));
  const qto = scoreArticle({title:'造价软件与清单编制系统升级采购', summary:'工程量清单智能编制。', sourceTier:'t1'});
  assert.ok(qto.offerings.includes('算量'));
});
test('public pool filters leads by auto-detected offering', () => {
  const list = [
    {id:'k1',title:'知识管理平台采购',summary:'企业知识库智能问答。',sector:'施工',scope:'国内',evidence:'待复核',publishedDate:'2026-09-18',dataOrigin:'collector'},
    {id:'t1',title:'海外项目翻译服务采购',summary:'境外工程多语言翻译。',sector:'施工',scope:'国内',evidence:'待复核',publishedDate:'2026-09-18',dataOrigin:'collector'},
  ].map(e => normalizeEntry(e, false));
  const kb = filterEntries(list, {...defaults, nav:'全部动态', offering:'知识库'});
  const tr = filterEntries(list, {...defaults, nav:'全部动态', offering:'翻译'});
  assert.deepEqual(kb.map(e=>e.id), ['k1']);
  assert.deepEqual(tr.map(e=>e.id), ['t1']);
  assert.equal(filterEntries(list, {...defaults, nav:'全部动态', offering:'全部'}).length, 2);
});
