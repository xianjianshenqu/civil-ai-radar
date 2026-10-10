import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../server/database.mjs';
import {createCollector} from '../server/collector.mjs';
import {createScheduler,collectionSchedule} from '../server/scheduler.mjs';
import {configFromEnv} from '../server/config.mjs';
test('daily collection persists across restarts and catches up once after downtime',async()=>{
  const db=openDatabase(':memory:');let time=1000;
  const config=configFromEnv({});const now=()=>time;
  const collector=createCollector({db,sources:[],now});
  let scheduler=createScheduler({db,collector,config,now});
  try{
    assert.equal(config.intervalMs,86400000);
    assert.equal(await scheduler.tick(),true);
    scheduler=createScheduler({db,collector,config,now});
    assert.equal(await scheduler.tick(),false);
    assert.equal(collectionSchedule({db,config,now}).nextRunAt,86401000);
    time+=86400000;assert.equal(await scheduler.tick(),true);
    time+=3*86400000;assert.equal(await scheduler.tick(),true);
    assert.equal(await scheduler.tick(),false);
    config.collectorEnabled=false;time+=86400000;
    assert.equal(await scheduler.tick(),false);
    assert.equal(collectionSchedule({db,config,now}).nextRunAt,null);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM runs').get().n,3);
  }finally{db.close();}
});
test('interrupted runs are closed honestly and retried on recovery',async()=>{
  const db=openDatabase(':memory:');const now=()=>1000;const config=configFromEnv({});
  db.prepare('INSERT INTO runs(id,started_at) VALUES(?,?)').run('interrupted',900);
  const collector=createCollector({db,sources:[],now});
  const scheduler=createScheduler({db,collector,config,now});
  try{assert.equal(await scheduler.tick(),true);assert.match(db.prepare('SELECT results FROM runs WHERE id=?').get('interrupted').results,/服务中断/);}finally{db.close();}
});
test('slow collection cannot overlap another timer tick',async()=>{
  const db=openDatabase(':memory:');let release;
  const collector={running:false,run:()=>new Promise(r=>{release=r;})};
  const scheduler=createScheduler({db,collector,config:configFromEnv({})});
  try{const first=scheduler.tick();assert.equal(await scheduler.tick(),false);release();assert.equal(await first,true);}finally{db.close();}
});
test('invalid collection intervals fail startup instead of silently disabling scheduling',()=>{
  for(const value of ['NaN','0','-1','Infinity'])assert.throws(()=>configFromEnv({COLLECT_INTERVAL_MINUTES:value}));
});

test('failing sources back off, recover and are scheduled per source',async()=>{
  const db=openDatabase(':memory:');let time=1000;const now=()=>time;
  const failing={id:'bad-feed',name:'Bad Feed',url:'https://bad.example/feed',tier:'t2'};
  const okSource={id:'ok-feed',name:'OK Feed',url:'https://ok.example/feed',tier:'t2'};
  const okXml='<rss><channel></channel></rss>';
  const config=configFromEnv({});
  const collector=createCollector({db,sources:[failing,okSource],intervalMs:config.intervalMs,now,
    fetchImpl:async url=>{
      if(String(url).includes('bad.example'))return new Response('',{status:503});
      if(url.endsWith('/robots.txt'))return new Response('User-agent: *\nAllow: /');
      return new Response(okXml,{headers:{'Content-Type':'application/rss+xml'}});
    }});
  const scheduler=createScheduler({db,collector,config,now});
  try{
    assert.equal(await scheduler.tick(),true); // 首轮：两个源都到期
    let bad=db.prepare('SELECT fail_count,next_attempt FROM sources WHERE id=?').get('bad-feed');
    assert.equal(bad.fail_count,1);assert.equal(bad.next_attempt,time+60*60000); // 第一级退避 60 分钟
    const ok=db.prepare('SELECT fail_count,next_attempt FROM sources WHERE id=?').get('ok-feed');
    assert.equal(ok.fail_count,0);assert.equal(ok.next_attempt,time+config.intervalMs); // 成功排常规周期
    // 59 分钟后：还没到期，不跑。
    time+=59*60000;assert.equal(await scheduler.tick(),false);
    // 再过 1 分钟：失败源到期重试（再次失败 → 二级退避 120 分钟）。
    time+=60*1000+1;assert.equal(await scheduler.tick(),true);
    bad=db.prepare('SELECT fail_count,next_attempt FROM sources WHERE id=?').get('bad-feed');
    assert.equal(bad.fail_count,2);assert.equal(bad.next_attempt,time+120*60000);
  }finally{db.close();}
});
