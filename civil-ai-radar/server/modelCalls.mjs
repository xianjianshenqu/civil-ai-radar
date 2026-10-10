import {hash} from './auth.mjs';

// 付费模型调用台账（2026-09-29，参考 AIHOT receipts 机制的简版落地）：
// 机器审核与模型翻译的每次 chat/completions 都记一行——成败、HTTP 状态、
// token 用量、耗时、所用模型与提示词版本。逻辑键 = 用途+目标+模型+提示词
// 版本（+翻译批次内容）的哈希，用于失败退避判断“同一个调用”近期是否已试过。
// 自建 LibreTranslate 是站内算力不是计费 API，不入账。
export const REVIEW_FAILURE_RETRY_MS=24*3600000;
const DAY_MS=24*3600000;

export function createModelCalls({db,now=Date.now}){
  db.exec(`CREATE TABLE IF NOT EXISTS model_calls(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at INTEGER NOT NULL,
    purpose TEXT NOT NULL,
    scope TEXT NOT NULL,
    model TEXT,
    prompt_version TEXT,
    logical_key TEXT NOT NULL,
    target TEXT,
    ok INTEGER NOT NULL,
    http_status INTEGER,
    error TEXT,
    duration_ms INTEGER,
    usage TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_model_calls_logical ON model_calls(logical_key,created_at);
  CREATE INDEX IF NOT EXISTS idx_model_calls_scope_time ON model_calls(scope,created_at);`);
  function record(entry){
    db.prepare('INSERT INTO model_calls(created_at,purpose,scope,model,prompt_version,logical_key,target,ok,http_status,error,duration_ms,usage) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(now(),entry.purpose,entry.scope,entry.model||null,entry.promptVersion||null,entry.logicalKey,entry.target||null,entry.ok?1:0,
        Number.isInteger(entry.httpStatus)?entry.httpStatus:null,
        entry.error?String(entry.error).slice(0,300):null,
        Number.isFinite(entry.durationMs)?Math.round(entry.durationMs):null,
        entry.usage&&typeof entry.usage==='object'?JSON.stringify(entry.usage):null);
  }
  return {
    key:parts=>hash(JSON.stringify(parts)),
    // 同一逻辑调用失败后 24 小时内不再重复付费重试（重启/全量补跑也不重放）。
    failedRecently(logicalKey,withinMs=REVIEW_FAILURE_RETRY_MS){
      return db.prepare('SELECT 1 FROM model_calls WHERE logical_key=? AND ok=0 AND created_at>? LIMIT 1').get(logicalKey,now()-withinMs)!==undefined;
    },
    // 预算熔断（简版）：只数站点作用域的付费调用；用户自己的 Key 花自己的额度，不设上限。
    siteCallsLast24h(){
      return db.prepare("SELECT COUNT(*) AS n FROM model_calls WHERE scope='site' AND created_at>?").get(now()-DAY_MS).n;
    },
    overBudget(cap){
      return Number.isInteger(cap)&&cap>0&&this.siteCallsLast24h()>=cap;
    },
    // 统一记账包装：run() 抛错时记录失败并原样上抛，由调用方决定兜底与用户提示。
    async track(entry,run){
      const started=now();
      try{
        const result=await run();
        record({...entry,ok:true,durationMs:now()-started,usage:result?.usage});
        return result;
      }catch(error){
        record({...entry,ok:false,durationMs:now()-started,httpStatus:error?.httpStatus,error:error?.message||String(error?.name||'unknown')});
        throw error;
      }
    },
    summary(days=30){
      const since=now()-days*86400000;
      const rows=db.prepare('SELECT created_at,purpose,scope,model,ok,http_status,error,usage FROM model_calls WHERE created_at>=? ORDER BY id').all(since);
      const grouped=new Map();
      for(const row of rows){
        let usage={};
        try{usage=row.usage?JSON.parse(row.usage):{};}catch{usage={};}
        const key=row.purpose+'｜'+row.scope;
        const item=grouped.get(key)||{purpose:row.purpose,scope:row.scope,calls:0,failures:0,tokens:0};
        item.calls++;if(!row.ok)item.failures++;item.tokens+=Number(usage.total_tokens)||0;
        grouped.set(key,item);
      }
      const recentFailures=rows.filter(row=>!row.ok).slice(-10).reverse()
        .map(row=>({at:new Date(row.created_at).toISOString(),purpose:row.purpose,scope:row.scope,model:row.model||null,httpStatus:row.http_status||null,error:row.error||null}));
      const last24={
        site:db.prepare("SELECT COUNT(*) AS n FROM model_calls WHERE scope='site' AND created_at>?").get(now()-DAY_MS).n,
        user:db.prepare("SELECT COUNT(*) AS n FROM model_calls WHERE scope!='site' AND created_at>?").get(now()-DAY_MS).n,
      };
      return {days,totals:[...grouped.values()],recentFailures,last24};
    },
  };
}
