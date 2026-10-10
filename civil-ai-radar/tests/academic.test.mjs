import test from 'node:test';
import assert from 'node:assert/strict';
import {doiHref,openAlexHref,parseCrossrefWorks,parseOpenAlexWorks,uninvertAbstract,crossrefUrl,openAlexUrl} from '../server/academic.mjs';
import {createCollector} from '../server/collector.mjs';
import {openDatabase} from '../server/database.mjs';
import {scoreArticle} from '../src/lib/scoring.js';
import {readingKindLabel} from '../src/lib/reading.js';

const source = {
  id: 'crossref-cn-civil',
  kind: 'crossref',
  name: '国内土木期刊（Crossref）',
  url: 'https://api.crossref.org/works',
  articleHosts: ['doi.org'],
  tier: 't1',
  sector: '施工',
  scope: '国内',
  region: '中国',
  issns: [{issn: '0559-9350', name: '水利学报'}],
};
const openalex = {
  id: 'openalex-cn-civil',
  kind: 'openalex',
  name: 'OpenAlex 国内土木论文',
  url: 'https://api.openalex.org/works',
  articleHosts: ['doi.org', 'openalex.org'],
  country: 'CN',
  topics: ['T11006'],
  tier: 't1',
  sector: '施工',
  scope: '国内',
  region: '中国',
};

test('DOI links stay on doi.org and reject other hosts', () => {
  assert.equal(doiHref('10.3724/j.slxb.20260033'), 'https://doi.org/10.3724/j.slxb.20260033');
  assert.equal(doiHref('https://doi.org/10.3724/j.slxb.20260033'), 'https://doi.org/10.3724/j.slxb.20260033');
  assert.equal(doiHref('https://evil.example/10.3724/j.slxb.20260033'), null);
  assert.equal(openAlexHref('https://openalex.org/W1234567890'), 'https://openalex.org/W1234567890');
  assert.equal(openAlexHref('javascript:alert(1)'), null);
});

test('Crossref keeps civil AI papers, drops generic science, and never verifies', () => {
  const [item] = parseCrossrefWorks({
    message: {items: [
      {
        DOI: '10.3724/j.slxb.20260033',
        title: ['Digital twin hydrosphere for hydraulic engineering'],
        abstract: '<jats:p>Artificial intelligence and a digital twin of a reservoir.</jats:p>',
        'container-title': ['水利学报'],
        issued: {'date-parts': [[2026, 9, 1]]},
        author: [{affiliation: [{name: '中铁第四勘察设计院集团有限公司'}]}],
      },
      {DOI: '10.1000/generic-chem', title: ['A generic chemistry catalyst paper'], issued: {'date-parts': [[2026, 1, 1]]}},
    ]},
  }, source, Date.parse('2026-09-17T12:00:00Z'));
  assert.equal(item.sourceUrl, 'https://doi.org/10.3724/j.slxb.20260033');
  assert.equal(item.source, '水利学报');
  assert.equal(item.reading.kind, 'academic-abstract');
  assert.equal(item.academic, true);
  assert.equal(item.evidence, '待复核');
  assert.equal(item.featuredRank, undefined);
  assert.equal(item.layer, '研究');
  assert.equal(item.publishedDate, '2026-09-01');
  assert.equal(item.assistScore.featured, false);
  assert.match(item.reading.paragraphs.en.join(''), /中铁第四勘察设计院/);
  assert.match(item.reading.notice, /不是采购/);
  assert.equal(parseCrossrefWorks({message: {items: [{DOI: '10.1000/x', title: ['Chemistry only']}]}}, source).length, 0);
});

test('OpenAlex uses inverted abstracts, prefers DOI, and skips non-civil AI', () => {
  const abstract = uninvertAbstract({Digital: [0], twin: [1], tunnel: [2], inspection: [3], 'with': [4], 'machine': [5], learning: [6]});
  assert.equal(abstract, 'Digital twin tunnel inspection with machine learning');
  const [item] = parseOpenAlexWorks({
    results: [{
      id: 'https://openalex.org/W999',
      doi: 'https://doi.org/10.1016/j.undsp.2026.05.004',
      display_name: 'Vision-driven dynamic tunnel digital twin',
      publication_date: '2026-09-10',
      abstract_inverted_index: {Vision: [0], driven: [1], tunnel: [2], 'digital': [3], twin: [4]},
      primary_location: {source: {display_name: 'Underground Space'}},
      authorships: [{institutions: [{display_name: 'China Communications Construction Company (China)', country_code: 'CN'}]}],
    }, {
      id: 'https://openalex.org/W1',
      doi: 'https://doi.org/10.1000/language-class',
      display_name: 'English classroom anxiety and generative AI',
      publication_date: '2026-09-10',
    }],
  }, openalex, Date.parse('2026-09-17T12:00:00Z'));
  assert.equal(item.sourceUrl, 'https://doi.org/10.1016/j.undsp.2026.05.004');
  assert.equal(item.source, 'Underground Space');
  assert.equal(item.academic, true);
  assert.equal(item.assistScore.featured, false);
  assert.equal(item.evidence, '待复核');
});

test('academic query URLs stay on the documented API hosts', () => {
  assert.match(crossrefUrl('0559-9350', '2026-08-18'), /^https:\/\/api\.crossref\.org\/works\?/);
  assert.match(crossrefUrl('0559-9350', '2026-08-18'), /issn%3A0559-9350/);
  const url = openAlexUrl(openalex, '2026-08-18', 'ops@radar.example');
  assert.match(url, /^https:\/\/api\.openalex.org\/works\?/);
  assert.match(url, /mailto=ops%40radar.example/);
  assert.match(url, /country_code%3ACN/);
});

test('academic papers do not auto-enter 今日精选 even with a watchlist affiliation', () => {
  const score = scoreArticle({
    title: '智能建造知识库与数字孪生',
    summary: '中建三局设计院试验。',
    academic: true,
    layer: '研究',
    sourceId: 'openalex-cn-civil',
    sourceTier: 't1',
  });
  assert.equal(score.research, true);
  assert.equal(score.featured, false);
  assert.equal(score.suggestFeatured, false);
});

test('academic collector stores DOI records after robots check and does not scrape HTML', async t => {
  const seen = [];
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  const collector = createCollector({
    db,
    sources: [source],
    now: () => Date.parse('2026-09-17T12:00:00Z'),
    mailto: 'ops@radar.example',
    fetchImpl: async (url) => {
      seen.push(String(url));
      if (String(url).endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /');
      if (String(url).includes('api.crossref.org/works')) {
        return Response.json({message: {items: [{
          DOI: '10.3724/j.slxb.20260033',
          title: ['Digital twin hydrosphere for hydraulic engineering'],
          abstract: 'Artificial intelligence digital twin of a reservoir.',
          'container-title': ['水利学报'],
          issued: {'date-parts': [[2026, 9, 1]]},
        }]}});
      }
      return new Response('html', {status: 404});
    },
  });
  const result = await collector.run();
  assert.equal(result.results[0].status, 'ok');
  assert.equal(result.results[0].added, 1);
  assert.equal(seen.some(url => url.includes('doi.org')), false);
  const article = JSON.parse(db.prepare('SELECT data FROM articles').get().data);
  assert.equal(article.reading.kind, 'academic-abstract');
  assert.equal(article.academic, true);
  assert.equal(article.evidence, '待复核');
  assert.equal(readingKindLabel(article.reading.kind), '论文摘要');
});
