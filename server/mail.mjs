import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';

export function smtpTransportOptions(smtp){
  return {host:smtp.host,port:smtp.port,secure:smtp.secure,requireTLS:!smtp.secure,
    auth:{user:smtp.user,pass:smtp.pass},
    connectionTimeout:15000,greetingTimeout:15000,socketTimeout:20000};
}

async function smtpSendWithConfig(payload,smtp){
  const transport=nodemailer.createTransport(smtpTransportOptions(smtp));
  try {
    const info=await transport.sendMail({from:payload.from,to:payload.to,subject:payload.subject,text:payload.text,...(smtp.replyTo?{replyTo:smtp.replyTo}:{})});
    return {id:info.messageId||''};
  } finally { transport.close(); }
}

export function createMailer({db,config,fetchImpl=fetch,smtpSend=smtpSendWithConfig,now=Date.now}) {
  function enqueue({id=randomUUID(),userId=null,kind,to,subject,text}) {
    db.prepare('INSERT OR IGNORE INTO outbox(id,user_id,kind,to_email,payload,status,next_attempt,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(id,userId,kind,to,JSON.stringify({from:config.mailFrom,to:[to],subject,text}),'pending',now(),now());
    return id;
  }
  async function deliver(id) {
    const row=db.prepare('SELECT * FROM outbox WHERE id=?').get(id);
    if(!row || !['pending','retry'].includes(row.status))return;
    if(row.kind==='login' && now()-row.created_at>10*60000){db.prepare("UPDATE outbox SET status='expired' WHERE id=?").run(id);return;}
    db.prepare("UPDATE outbox SET status='sending',attempts=attempts+1 WHERE id=?").run(id);
    try {
      if(config.mailMode==='local') {
        if(config.production || !row.to_email.endsWith('@example.test'))throw new Error('Local mail only supports example.test');
        db.prepare("UPDATE outbox SET status='local',sent_at=? WHERE id=?").run(now(),id);return;
      }
      if(config.mailMode==='smtp') {
        if(!config.smtp || !config.smtp.host)throw new Error('Email service not configured');
        let payload;try{payload=JSON.parse(row.payload);}catch{throw new Error('Malformed outbox payload');}
        const info=await smtpSend(payload,config.smtp);
        db.prepare("UPDATE outbox SET status='sent',sent_at=?,provider_id=?,error=NULL WHERE id=?").run(now(),String(info.id||''),id);
        if(row.kind==='login')scrubLogin(id);
        return;
      }
      if(!config.resendKey || !config.mailFrom)throw new Error('Email service not configured');
      const response=await fetchImpl('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(15000),
        headers:{Authorization:`Bearer ${config.resendKey}`,'Content-Type':'application/json','Idempotency-Key':id},body:row.payload});
      if(!response.ok)throw new Error(`Mail provider HTTP ${response.status}`);
      const result=await response.json();
      db.prepare("UPDATE outbox SET status='sent',sent_at=?,provider_id=?,error=NULL WHERE id=?").run(now(),String(result.id || ''),id);
      if(row.kind==='login')scrubLogin(id);
    } catch(error) {
      const exhausted=row.attempts+1>=5;
      db.prepare('UPDATE outbox SET status=?,next_attempt=?,error=? WHERE id=?').run(exhausted?'failed':'retry',now()+Math.min(3600000,60000*2**row.attempts),error.message,id);
    }
  }
  function scrubLogin(id) {
    const row=db.prepare("SELECT payload FROM outbox WHERE id=? AND kind='login'").get(id);
    if(!row)return;
    let payload;try{payload=JSON.parse(row.payload);}catch{return;}
    payload.text=String(payload.text||'').replace(/\b\d{6}\b/g,'******');
    db.prepare('UPDATE outbox SET payload=? WHERE id=?').run(JSON.stringify(payload),id);
  }
  async function flush() {
    for(const row of db.prepare("SELECT id FROM outbox WHERE status IN ('pending','retry') AND next_attempt<=? ORDER BY created_at LIMIT 30").all(now()))await deliver(row.id);
  }
  return {enqueue,deliver,flush};
}
