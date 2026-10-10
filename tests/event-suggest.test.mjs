import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../server/database.mjs';
import {titleSimilarity,buildEventSuggester,titleTokens} from '../src/lib/eventSuggest.js';
import {createReview} from '../server/review.mjs';

test('title similarity separates same-project variants from unrelated titles',()=>{
  // 同一项目的招标与更正公告：共享项目名 bigram，相似度应过线。
  const a='某新城智慧工地人工智能平台采购项目招标公告';
  const b='某新城智慧工地人工智能平台采购项目更正公告';
  assert.ok(titleSimilarity(a,b)>=0.55);
  // 无关标题：词面几乎不重叠。
  const c='全球人工智能大会发布年度趋势报告';
  assert.ok(titleSimilarity(a,c)<0.55);
  // 拉丁词 + 编号共享也能召回（英文项目名场景）。
  assert.ok(titleSimilarity('Smart Bridge AI Tender 2026-11','Smart Bridge AI Tender Correction 2026-11')>=0.55);
  assert.deepEqual(titleTokens('AI 42'),['w:ai','w:42']);
});

test('suggester excludes self, same URL and already-grouped records, and caps results',()=>{
  const pool=[
    {id:'a1',title:'某新城智慧工地人工智能平台采购项目招标公告',sourceUrl:'https://x.example/1'},
    {id:'a2',title:'某新城智慧工地人工智能平台采购项目更正公告',sourceUrl:'https://x.example/2'},
    {id:'a3',title:'某新城智慧工地人工智能平台采购项目答疑澄清',sourceUrl:'https://x.example/3'},
    {id:'a4',title:'某新城智慧工地人工智能平台采购项目中标公示',sourceUrl:'https://x.example/4'},
    {id:'a5',title:'全球人工智能大会发布年度趋势报告',sourceUrl:'https://x.example/5'},
    {id:'dup',title:'某新城智慧工地人工智能平台采购项目招标公告',sourceUrl:'https://x.example/1'},
  ];
  const suggest=buildEventSuggester(pool);
  const hits=suggest({id:'a1',title:pool[0].title,sourceUrl:'https://x.example/1'});
  assert.ok(hits.length>0&&hits.length<=3);
  assert.ok(hits.every(hit=>hit.id!=='a1'&&hit.id!=='dup'&&hit.id!=='a5'));
  assert.ok(hits.every(hit=>hit.score>=0.55));
  // 已在同一事件组的候选不再重复提示。
  const grouped=buildEventSuggester(pool.map(item=>item.id==='a2'?{...item,eventId:'ev-x'}:item));
  const hits2=grouped({id:'a1',title:pool[0].title,sourceUrl:'https://x.example/1',editorial:{eventId:'ev-x'}});
  assert.ok(hits2.every(hit=>hit.id!=='a2'));
});

test('review list carries eventHint and merge/clear write editorial.eventId only',async()=>{
  const db=openDatabase(':memory:');
  const now=Date.now;
  const review=createReview({db,now,watchlist:null});
  const insert=(id,title,url)=>db.prepare('INSERT INTO articles(id,url,data,content_hash,first_seen,updated_at) VALUES(?,?,?,?,?,?)')
    .run(id,url,JSON.stringify({id,url,sourceUrl:url,title,source:'测试源',summary:'摘要',sector:'施工',editorial:{status:'pending'}}),'h'+id,now(),now());
  insert('r1','某新城智慧工地人工智能平台采购项目招标公告','https://x.example/1');
  insert('r2','某新城智慧工地人工智能平台采购项目更正公告','https://x.example/2');
  const pending=review.list('pending');
  const entry=pending.articles.find(item=>item.id==='r1');
  assert.ok(entry.eventHint&&entry.eventHint.some(hit=>hit.id==='r2'));
  // 人工合并：只写 eventId 与备注，不改 status/ reviewer。
  const merged=review.mergeEvents({ids:['r1','r2']},'admin@example.test');
  assert.equal(merged.action,'merge');assert.match(merged.eventId,/^ev-/);
  const after=review.list('pending');
  assert.equal(after.articles.find(item=>item.id==='r1').article.editorial.eventId,merged.eventId);
  assert.equal(after.articles.find(item=>item.id==='r1').article.editorial.status,'pending');
  // 合并后同组候选不再互相提示。
  const hints=after.articles.find(item=>item.id==='r1').eventHint;
  assert.ok(!hints||!hints.some(hit=>hit.id==='r2'));
  // 公开读层透出 eventId（pending 分支）。
  assert.equal(after.articles.find(item=>item.id==='r1').public.eventId,merged.eventId);
  // 解除。
  const cleared=review.mergeEvents({ids:['r1','r2'],action:'clear'},'admin@example.test');
  assert.equal(cleared.action,'clear');
  const final=review.list('pending');
  assert.equal(final.articles.find(item=>item.id==='r1').article.editorial.eventId,null);
  assert.throws(()=>review.mergeEvents({ids:['r1']},'a@example.test'),/至少需要两条/);
  db.close();
});
