import { randomBytes } from 'node:crypto';
import { hash, HttpError } from './auth.mjs';
import { SECTORS as SECTOR_LIST } from '../src/lib/topicMatch.js';
export function createNotifications({db,config,mailer,now=Date.now}) {
  function settings(userId){const row=db.prepare('SELECT data FROM subscriptions WHERE user_id=?').get(userId);return row?JSON.parse(row.data):{enabled:false,frequency:'daily',sectors:[],keyword:''};}
  function save(userId,input){
    if(typeof input.enabled!=='boolean'||!['hourly','daily'].includes(input.frequency)||!Array.isArray(input.sectors)||!input.sectors.every(s=>SECTOR_LIST.includes(s))||typeof input.keyword!=='string'||input.keyword.length>100)throw new HttpError(400,'通知设置格式不正确。');
    const data={enabled:input.enabled,frequency:input.frequency,sectors:[...new Set(input.sectors)],keyword:input.keyword.trim()};
    const previous=db.prepare('SELECT * FROM subscriptions WHERE user_id=?').get(userId);
    const since=previous&&JSON.parse(previous.data).enabled?previous.since:now();
    const token=randomBytes(32).toString('base64url');
    db.prepare("INSERT INTO subscriptions(user_id,data,since,last_sent,unsubscribe_hash) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,since=excluded.since,cursor_id=CASE WHEN subscriptions.since=excluded.since THEN subscriptions.cursor_id ELSE '' END,last_sent=CASE WHEN subscriptions.since=excluded.since THEN subscriptions.last_sent ELSE 0 END").run(userId,JSON.stringify(data),since,0,hash(token));
    // An opt-out or preference change cancels unsent digests; queued messages never bypass current consent.
    db.prepare("UPDATE outbox SET status='cancelled' WHERE user_id=? AND kind='digest' AND status IN ('pending','retry')").run(userId);
    return data;
  }
  function unsubscribe(token){const row=db.prepare('SELECT s.user_id,s.data FROM unsubscribe_tokens t JOIN subscriptions s ON s.user_id=t.user_id WHERE t.hash=?').get(hash(token));if(!row)throw new HttpError(400,'退订链接无效。');save(row.user_id,{...JSON.parse(row.data),enabled:false});}
  async function queueDigests(){
    for(const row of db.prepare('SELECT s.*,u.email FROM subscriptions s JOIN users u ON u.id=s.user_id').all()){
      const setting=JSON.parse(row.data);if(!setting.enabled)continue;
      const interval=setting.frequency==='hourly'?3600000:86400000;
      if(row.last_sent&&now()-row.last_sent<interval)continue;
      if(db.prepare("SELECT id FROM outbox WHERE user_id=? AND kind='digest' AND status IN ('pending','retry','sending')").get(row.user_id))continue;
      const page=db.prepare('SELECT * FROM articles WHERE updated_at>? OR (updated_at=? AND id>?) ORDER BY updated_at ASC,id ASC LIMIT 200').all(row.since,row.since,row.cursor_id);
      const changes=[];let boundary=null;
      for(const article of page){
        boundary=article;const e=JSON.parse(article.data);
        if((!setting.sectors.length||setting.sectors.includes(e.sector))&&(!setting.keyword||(e.title+' '+e.summary).toLowerCase().includes(setting.keyword.toLowerCase())))changes.push(article);
        if(changes.length===20)break;
      }
      if(!changes.length){if(boundary)db.prepare('UPDATE subscriptions SET since=?,cursor_id=? WHERE user_id=?').run(boundary.updated_at,boundary.id,row.user_id);continue;}
      const until=boundary.updated_at,token=randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO unsubscribe_tokens VALUES(?,?)').run(hash(token),row.user_id);
      const body=['土木 AI 雷达 · 新增／更新线索','以下内容来自自动采集，尚待复核。',...changes.flatMap(r=>{const e=JSON.parse(r.data);return ['',e.title,`公开日期：${e.publishedDate}；事件日期：未披露`,e.sourceUrl];}),'',`管理通知：${config.publicUrl}/?nav=${encodeURIComponent('账号与通知')}`,`退订：${config.publicUrl}/api/notifications/unsubscribe?token=${token}`].join('\n');
      const id='digest-'+hash(row.user_id+':'+until+':'+boundary.id+':'+row.since+':'+row.cursor_id).slice(0,32);
      mailer.enqueue({id,userId:row.user_id,kind:'digest',to:row.email,subject:`土木 AI 雷达：${changes.length} 条待复核线索`,text:body});
      // Advance only the queued batch boundary; retries reuse an immutable payload and idempotency key.
      db.prepare('UPDATE subscriptions SET since=?,cursor_id=?,last_sent=? WHERE user_id=?').run(until,boundary.id,now(),row.user_id);
    }
  }
  async function test(user){const id=mailer.enqueue({userId:user.id,kind:'test',to:user.email,subject:'土木 AI 雷达通知测试',text:'这是一封由你主动触发的通知测试。没有改变订阅设置。'});await mailer.deliver(id);return {id,status:db.prepare('SELECT status FROM outbox WHERE id=?').get(id).status};}
  return {settings,save,unsubscribe,queueDigests,test};
}
