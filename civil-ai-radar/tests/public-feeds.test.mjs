import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,bumpPublicVersionOnWrite} from '../server/database.mjs';
import {loadPublicArticles,memoByPublicVersion,rssXml,sitemapXml,robotsTxt,injectDetailMeta,createPublicFeeds} from '../server/feeds.mjs';

const BASE_HTML='<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8" /><title>土木 AI 雷达 · 工程情报</title></head><body><div id="root"></div></body></html>';

function insertArticle(db,id,patch={}){
  const article={id,url:'https://example.org/a/'+id,title:'智慧工地 AI 采购公告 '+id,source:'测试源',
    summary:'测试摘要 '+id,publishedAt:'2026-09-01T00:00:00.000Z',firstSeenAt:'2026-09-01T00:00:00.000Z',
    sourceUrl:'https://example.org/a/'+id,dataOrigin:'collector',editorial:{status:'pending'},...patch};
  db.prepare('INSERT INTO articles(id,url,data,content_hash,first_seen,updated_at) VALUES(?,?,?,?,?,?)')
    .run(id,article.url,JSON.stringify(article),'h'+id,Date.parse('2026-09-01T00:00:00Z'),Date.parse('2026-09-02T00:00:00Z'));
  return article;
}

test('public feeds share the /api/articles visibility rule and never expose rejected records',()=>{
  const db=openDatabase(':memory:');
  insertArticle(db,'feed-ok');
  insertArticle(db,'feed-hidden',{editorial:{status:'rejected'}});
  insertArticle(db,'feed-nodate',{title:'智慧工地 & 隧道 AI 公告',publishedAt:null});
  const entries=loadPublicArticles(db,100);
  assert.deepEqual(entries.map(e=>e.article.id).sort(),['feed-nodate','feed-ok']);
  // RSS：转义 &、含已公开条目、无披露日期的条目不虚构 pubDate。
  const rss=rssXml(entries,'https://radar.example',Date.parse('2026-09-07T09:00:00Z'));
  assert.match(rss,/<rss version="2.0">/);
  assert.ok(rss.includes('feed-ok'));
  assert.ok(!rss.includes('feed-hidden'));
  assert.ok(rss.includes('智慧工地 &amp; 隧道'));
  const noDateItem=rss.split('<item>').find(part=>part.includes('feed-nodate'));
  assert.ok(noDateItem && !noDateItem.includes('<pubDate>'));
  assert.ok(rss.split('<item>').find(part=>part.includes('feed-ok')).includes('<pubDate>'));
  // sitemap：首页 + 公开详情页，不含已驳回。
  const sitemap=sitemapXml(entries,'https://radar.example');
  assert.ok(sitemap.includes('<loc>https://radar.example/</loc>'));
  assert.ok(sitemap.includes('/detail/feed-ok'));
  assert.ok(!sitemap.includes('feed-hidden'));
  assert.ok(sitemap.includes('<lastmod>2026-09-02T00:00:00.000Z</lastmod>'));
  assert.equal(robotsTxt('https://radar.example'),'User-agent: *\nAllow: /\n\nSitemap: https://radar.example/sitemap.xml\n');
  db.close();
});

test('detail meta injection uses only stored fields and leaves unknown or rejected records untouched',()=>{
  const db=openDatabase(':memory:');
  insertArticle(db,'feed-meta',{title:'某集团智慧工地采购 & AI 平台'});
  const feeds=createPublicFeeds({db,config:{publicUrl:'https://radar.example'},now:()=>Date.now()});
  const article=feeds.articleForDetail('/detail/feed-meta');
  const html=injectDetailMeta(BASE_HTML,article,'https://radar.example');
  assert.ok(html.includes('<title>某集团智慧工地采购 &amp; AI 平台 · 土木 AI 雷达</title>'));
  assert.ok(html.includes('<meta property="og:title" content="某集团智慧工地采购 &amp; AI 平台">'));
  assert.ok(html.includes('<meta property="og:url" content="https://radar.example/detail/feed-meta">'));
  assert.ok(html.includes('<link rel="canonical" href="https://radar.example/detail/feed-meta">'));
  assert.ok(html.includes('测试源'));
  // 未命中与已驳回的路径都不注入（保持站点默认 head）。
  assert.equal(feeds.articleForDetail('/detail/missing'),null);
  assert.equal(feeds.articleForDetail('/'),null);
  assert.equal(injectDetailMeta(BASE_HTML,null,'https://radar.example'),BASE_HTML);
  db.close();
});

test('feeds handler serves rss/sitemap/robots and passes through everything else',async()=>{
  const db=openDatabase(':memory:');
  insertArticle(db,'feed-svc');
  const feeds=createPublicFeeds({db,config:{publicUrl:'https://radar.example'},now:()=>Date.parse('2026-09-07T09:00:00Z')});
  async function serve(url,method='GET'){
    const captured={};
    const res={writeHead(status,headers){captured.status=status;captured.headers=headers;},end(body){captured.body=body;}};
    const handled=await feeds.handler({url,method},res);
    return {handled,captured};
  }
  const rss=await serve('/rss.xml');
  assert.equal(rss.handled,true);assert.equal(rss.captured.status,200);
  assert.match(rss.captured.headers['Content-Type'],/application\/rss\+xml/);
  assert.ok(rss.captured.body.includes('feed-svc'));
  const sitemap=await serve('/sitemap.xml?x=1');
  assert.equal(sitemap.handled,true);assert.match(sitemap.captured.headers['Content-Type'],/application\/xml/);
  const robots=await serve('/robots.txt');
  assert.equal(robots.handled,true);assert.match(robots.captured.headers['Content-Type'],/text\/plain/);
  const other=await serve('/detail/feed-svc');
  assert.equal(other.handled,false);
  const post=await serve('/rss.xml','POST');
  assert.equal(post.handled,false);
  db.close();
});

test('rejected records do not use up the public pool limit',()=>{
  const db=openDatabase(':memory:');
  insertArticle(db,'pool-old');
  // 更新时间更晚的已驳回记录排在前面，旧做法先取 N 行再过滤会把 pool-old 挤出公开池。
  const later=db.prepare('INSERT INTO articles(id,url,data,content_hash,first_seen,updated_at) VALUES(?,?,?,?,?,?)');
  for(let i=0;i<3;i++)later.run('pool-rejected-'+i,'https://example.org/r/'+i,JSON.stringify({id:'pool-rejected-'+i,editorial:{status:'rejected'}}),'r'+i,1,Date.parse('2026-09-05T00:00:00Z')+i);
  assert.deepEqual(loadPublicArticles(db,2).map(e=>e.article.id),['pool-old']);
  db.close();
});

test('public pool cache reuses the result until articles or translations change',()=>{
  const db=openDatabase(':memory:');
  insertArticle(db,'memo-a');
  let runs=0;
  const pool=memoByPublicVersion(db,()=>{runs++;return loadPublicArticles(db).map(e=>e.article.id);});
  assert.deepEqual(pool(),['memo-a']);
  assert.deepEqual(pool(),['memo-a']);
  assert.equal(runs,1);
  // 同一毫秒内的改写也要失效：版本号由触发器计数，不依赖 updated_at。
  db.prepare('UPDATE articles SET data=? WHERE id=?').run(JSON.stringify({id:'memo-a',editorial:{status:'rejected'}}),'memo-a');
  assert.deepEqual(pool(),[]);
  assert.equal(runs,2);
  db.exec('CREATE TABLE IF NOT EXISTS translations (cache_key TEXT PRIMARY KEY, reading TEXT NOT NULL, created_at INTEGER NOT NULL)');
  bumpPublicVersionOnWrite(db,'translations');
  pool();assert.equal(runs,2);
  db.prepare('INSERT INTO translations VALUES(?,?,?)').run('k','{}',1);
  pool();assert.equal(runs,3);
  db.close();
});
