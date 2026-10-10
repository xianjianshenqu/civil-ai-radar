import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFeed,feedParagraphs} from '../server/collector.mjs';
import {openDatabase} from '../server/database.mjs';
import {createTranslator,isRealTranslation,batches} from '../server/translation.mjs';
import {getReading,readingText} from '../src/lib/reading.js';
import {dailyRadarEntries} from '../src/data/generatedRadarEntries.js';
import {hash} from '../server/auth.mjs';
const source={url:'https://example.org/feed',name:'Test',sector:'施工'};
test('every current editorial record has aligned bilingual paragraphs and honest attribution',()=>{
  for(const item of dailyRadarEntries){const reading=getReading(item);assert.equal(reading.kind,'editorial');assert.equal(reading.paragraphs.zh.length,reading.paragraphs.en.length);assert.ok(reading.paragraphs.zh.length>1);assert.match(readingText(item,reading,'both'),/AI 译文/);assert.ok(readingText(item,reading,'both').includes(item.sourceUrl));}
  assert.equal(getReading({id:'missing'}).kind,'missing');
});
test('RSS content is plain text, separate from a feed summary and never fabricated',()=>{
  const item=body=>`<rss><channel><item><title>AI in construction</title><link>https://example.org/item</link>${body}</item></channel></rss>`;
  const [full]=parseFeed(item('<content:encoded><![CDATA[<p>First paragraph.</p><script>evil()</script><p>Second &amp; third.</p>]]></content:encoded>'),source);
  assert.deepEqual(full.reading.paragraphs.en,['First paragraph.','Second & third.']);assert.equal(full.reading.kind,'feed-content');
  const [summary]=parseFeed(item('<description>Only a summary.</description>'),source);assert.equal(summary.reading.kind,'feed-summary');
  assert.equal(parseFeed(item(''),source)[0].reading,undefined);
  assert.deepEqual(feedParagraphs('<p>中文正文</p><iframe>hidden</iframe>'),['中文正文']);
});
test('translation uses stored public text, caches results and invalidates on content changes',async t=>{
  const db=openDatabase(':memory:');t.after(()=>db.close());let calls=0;
  const reading={kind:'feed-content',originalLanguage:'en',paragraphs:{en:['AI for construction.','Human review.']}};
  db.prepare('INSERT INTO articles VALUES(?,?,?,?,?,?)').run('a','https://example.org/a',JSON.stringify({reading}),'x',1,1);
  const translator=createTranslator({db,config:{translationUrl:'https://translate.example/translate'},fetchImpl:async(url,opts)=>{
    calls++;const body=JSON.parse(opts.body);assert.equal(body.format,'text');assert.equal(body.source,'en');assert.equal(body.target,'zh');assert.equal(body.q[0],reading.paragraphs.en[0]);return Response.json({translatedText:['工程人工智能。','人工复核。']});
  }});
  const result=await translator.translate('a','zh');assert.deepEqual(result.reading.paragraphs.zh,['工程人工智能。','人工复核。']);assert.equal(result.reading.paragraphs.en[1],'Human review.');
  await translator.translate('a','zh');assert.equal(calls,1);
  reading.paragraphs.en[0]='Updated AI for construction.';db.prepare('UPDATE articles SET data=? WHERE id=?').run(JSON.stringify({reading}),'a');await translator.translate('a','zh');assert.equal(calls,2);
  await assert.rejects(translator.translate('a','fr'),e=>e.status===400);await assert.rejects(translator.translate('absent','zh'),e=>e.status===404);
});
test('unconfigured or failed translation is explicit and never cached as a success',async t=>{
  const db=openDatabase(':memory:');t.after(()=>db.close());const reading={kind:'feed-summary',originalLanguage:'zh',paragraphs:{zh:['现场人工智能。']}};
  db.prepare('INSERT INTO articles VALUES(?,?,?,?,?,?)').run('a','https://example.org/a',JSON.stringify({reading}),'x',1,1);
  const off=createTranslator({db,config:{}});await assert.rejects(off.translate('a','en'),e=>e.status===503);assert.deepEqual((await off.translate('a','zh')).reading,reading);
  const failed=createTranslator({db,config:{translationUrl:'https://translate.example'},fetchImpl:async()=>Response.json({translatedText:[]})});await assert.rejects(failed.translate('a','en'),e=>e.status===502);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM translations').get().n,0);
});
test('cached translation is attached to public articles and collection fill skips missing bodies',async t=>{
  const db=openDatabase(':memory:');t.after(()=>db.close());
  const reading={kind:'feed-summary',originalLanguage:'en',paragraphs:{en:['AI for construction.']}};
  db.prepare('INSERT INTO articles VALUES(?,?,?,?,?,?)').run('a','https://example.org/a',JSON.stringify({id:'a',reading}),'x',1,1);
  db.prepare('INSERT INTO articles VALUES(?,?,?,?,?,?)').run('b','https://example.org/b',JSON.stringify({id:'b'}),'x',1,1);
  db.prepare('INSERT INTO articles VALUES(?,?,?,?,?,?)').run('c','https://example.org/c',JSON.stringify({id:'c',reading,editorial:{reading:{kind:'editorial',originalLanguage:'zh',paragraphs:{zh:['编辑稿。']}}}}),'x',1,1);
  const translator=createTranslator({db,config:{translationUrl:'https://translate.example/translate'},fetchImpl:async()=>Response.json({translatedText:['工程人工智能。']})});
  assert.deepEqual(await translator.translateMany(['a','b','c','missing']),{translated:1,skipped:3,failed:0});
  const attached=translator.overlay({id:'a',reading});
  assert.deepEqual(attached.reading.paragraphs.zh,['工程人工智能。']);
  assert.equal(translator.overlay({id:'b'}).reading,undefined);
});
test('echo and mock prefixes are not cached or shown as Chinese',async t=>{
  const db=openDatabase(':memory:');t.after(()=>db.close());
  const reading={kind:'feed-content',originalLanguage:'en',paragraphs:{en:['AI for construction.']}};
  db.prepare('INSERT INTO articles VALUES(?,?,?,?,?,?)').run('a','https://example.org/a',JSON.stringify({id:'a',reading}),'x',1,1);
  const echo=createTranslator({db,config:{translationUrl:'https://translate.example/translate'},fetchImpl:async()=>Response.json({translatedText:['【译】AI for construction.']})});
  await assert.rejects(echo.translate('a','zh'),e=>e.status===502);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM translations').get().n,0);
  const fake={...reading,paragraphs:{...reading.paragraphs,zh:['【译】AI for construction.']},translationLabel:'机器翻译 · 待校对'};
  db.prepare('INSERT INTO translations VALUES(?,?,?)').run(hash(JSON.stringify(['a',reading,'zh'])),JSON.stringify(fake),1);
  const overlay=echo.overlay({id:'a',reading});
  assert.equal(overlay.reading.paragraphs.zh,undefined);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM translations').get().n,0);
  assert.equal(isRealTranslation('en','zh',['Hello.'],['你好。']),true);
  assert.equal(isRealTranslation('en','zh',['Hello.'],['【译】Hello.']),false);
  assert.equal(batches(['a'.repeat(3000),'b'.repeat(3000)],4000).length,2);
});
test('long articles are translated in batches and still require real target text',async t=>{
  const db=openDatabase(':memory:');t.after(()=>db.close());let calls=0;
  const en=['AI for construction. '.repeat(200),'Human review of models. '.repeat(200)];
  const reading={kind:'feed-content',originalLanguage:'en',paragraphs:{en}};
  db.prepare('INSERT INTO articles VALUES(?,?,?,?,?,?)').run('a','https://example.org/a',JSON.stringify({reading}),'x',1,1);
  const translator=createTranslator({db,config:{translationUrl:'https://translate.example/translate'},fetchImpl:async(url,opts)=>{
    calls++;const body=JSON.parse(opts.body);assert.equal(Array.isArray(body.q),true);assert.equal(body.q.length,1);
    return Response.json({translatedText:body.q.map(()=>'工程人工智能人工复核。')});
  }});
  const result=await translator.translate('a','zh');
  assert.equal(calls,2);
  assert.equal(result.reading.paragraphs.zh.length,2);
  assert.match(result.reading.paragraphs.zh[0],/工程/);
});
