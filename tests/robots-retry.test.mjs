import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../server/database.mjs';
import {createCollector, isTransientRobotsFailure, ROBOTS_RETRY_WAIT_MS} from '../server/collector.mjs';

const FEED='<rss><channel></channel></rss>';
const SOURCE={id:'gzggzy-guangzhou',name:'广州公共资源交易中心',url:'https://www.gzggzy.cn/jyywjsgcfwjzzbgg/index.jhtml',tier:'t1'};

async function collect(robotsForSeen) {
  const db=openDatabase(':memory:');
  const waits=[];
  const calls=[];
  const collector=createCollector({
    db,sources:[SOURCE],now:()=>1000,intervalMs:86400000,
    sleep:async ms=>{waits.push(ms);},
    fetchImpl:async url=>{
      const target=String(url);
      calls.push(target);
      if(target.endsWith('/robots.txt'))return robotsForSeen(calls.filter(item=>item.endsWith('/robots.txt')).length);
      return new Response(FEED,{headers:{'Content-Type':'application/rss+xml'}});
    },
  });
  try{
    const result=await collector.run();
    const row=db.prepare('SELECT error,fail_count,last_success FROM sources WHERE id=?').get(SOURCE.id);
    return {result,row,waits,calls};
  }finally{db.close();}
}

const allow=()=>new Response('User-agent: *\nAllow: /\n');
const robotsCalls=calls=>calls.filter(url=>url.endsWith('/robots.txt')).length;
const feedCalls=calls=>calls.filter(url=>!url.endsWith('/robots.txt')).length;

test('transient robots statuses are retried once and then succeed',async()=>{
  for(const status of [502,503,504]){
    const seen=collect(n=>n===1?new Response('gateway',{status}):allow());
    const {row,waits,calls}=await seen;
    assert.equal(robotsCalls(calls),2,String(status));
    assert.equal(feedCalls(calls),1,String(status));
    assert.deepEqual(waits,[ROBOTS_RETRY_WAIT_MS]);
    assert.equal(row.error,null);
    assert.equal(row.fail_count,0);
    assert.equal(row.last_success,1000);
  }
});

test('a second gateway failure still fails the source and does not fetch the list',async()=>{
  const {row,waits,calls}=await collect(()=>new Response('unavailable',{status:503}));
  assert.equal(robotsCalls(calls),2);
  assert.equal(feedCalls(calls),0);
  assert.deepEqual(waits,[ROBOTS_RETRY_WAIT_MS]);
  assert.match(row.error,/Cannot check robots.txt: HTTP 503/);
  assert.equal(row.fail_count,1);
});

test('timeout and reset are retried once; a hard error is not',async()=>{
  const timeout=await collect(n=>{
    if(n===1)throw new DOMException('The operation was aborted due to timeout','TimeoutError');
    return allow();
  });
  assert.equal(robotsCalls(timeout.calls),2);
  assert.equal(timeout.row.error,null);
  assert.deepEqual(timeout.waits,[ROBOTS_RETRY_WAIT_MS]);

  const reset=await collect(n=>{
    if(n===1){const error=new TypeError('fetch failed');error.cause={code:'ECONNRESET'};throw error;}
    return allow();
  });
  assert.equal(reset.row.error,null);
  assert.equal(robotsCalls(reset.calls),2);

  const aborted=await collect(()=>{throw new DOMException('The operation was aborted','AbortError');});
  assert.equal(robotsCalls(aborted.calls),2);
  assert.match(aborted.row.error,/aborted/);
  assert.equal(aborted.waits.length,1);

  const hard=await collect(()=>{throw new TypeError('certificate has expired');});
  assert.equal(robotsCalls(hard.calls),1);
  assert.deepEqual(hard.waits,[]);
  assert.match(hard.row.error,/certificate/);
});

test('404 stays unrestricted and is not retried',async()=>{
  const {row,waits,calls}=await collect(()=>new Response('missing',{status:404}));
  assert.equal(robotsCalls(calls),1);
  assert.equal(feedCalls(calls),1);
  assert.deepEqual(waits,[]);
  assert.equal(row.error,null);
});

test('403 and 500 are not retried',async()=>{
  for(const status of [403,500]){
    const {row,waits,calls}=await collect(()=>new Response('no',{status}));
    assert.equal(robotsCalls(calls),1,String(status));
    assert.equal(feedCalls(calls),0,String(status));
    assert.deepEqual(waits,[]);
    assert.match(row.error,new RegExp(`HTTP ${status}`));
  }
});

test('an explicit disallow is never bypassed, including after one transient retry',async()=>{
  const direct=await collect(()=>new Response('User-agent: *\nDisallow: /\n'));
  assert.equal(robotsCalls(direct.calls),1);
  assert.equal(feedCalls(direct.calls),0);
  assert.deepEqual(direct.waits,[]);
  assert.match(direct.row.error,/disallows automated collection/);

  const afterGateway=await collect(n=>n===1?new Response('gateway',{status:502}):new Response('User-agent: *\nDisallow: /\n'));
  assert.equal(robotsCalls(afterGateway.calls),2);
  assert.equal(feedCalls(afterGateway.calls),0);
  assert.deepEqual(afterGateway.waits,[ROBOTS_RETRY_WAIT_MS]);
  assert.match(afterGateway.row.error,/disallows automated collection/);
});

test('a redirect is not treated as a transient robots failure',async()=>{
  const {row,waits,calls}=await collect(()=>new Response('',{status:302,headers:{location:'https://example.com/robots.txt'}}));
  assert.equal(robotsCalls(calls),1);
  assert.deepEqual(waits,[]);
  assert.match(row.error,/redirect requires operator review/);
});

test('transient classifier only matches abort, timeout, and short network failures',()=>{
  assert.equal(isTransientRobotsFailure(new DOMException('timeout','TimeoutError')),true);
  assert.equal(isTransientRobotsFailure(new DOMException('aborted','AbortError')),true);
  const wrapped=new TypeError('fetch failed');
  wrapped.cause={code:'UND_ERR_HEADERS_TIMEOUT'};
  assert.equal(isTransientRobotsFailure(wrapped),true);
  const dns=new TypeError('fetch failed');
  dns.cause={code:'ENOTFOUND'};
  assert.equal(isTransientRobotsFailure(dns),false);
  assert.equal(isTransientRobotsFailure(new Error('Source disallows automated collection in robots.txt')),false);
  assert.equal(isTransientRobotsFailure(null),false);
});
