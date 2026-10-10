import { randomBytes, randomInt, randomUUID, createHash, createHmac, timingSafeEqual } from 'node:crypto';
export const hash=value=>createHash('sha256').update(value).digest('hex');
export class HttpError extends Error { constructor(status,message){super(message);this.status=status;} }
export function createAuth({db,config,mailer,now=Date.now}) {
  let secret=config.authSecret || db.prepare("SELECT value FROM meta WHERE key='auth-secret'").get()?.value;
  if(!secret){secret=randomBytes(48).toString('hex');db.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run('auth-secret',secret);}
  const digest=(id,code)=>createHmac('sha256',secret).update(id+':'+code).digest('hex');
  function limit(key,max,period) {
    const row=db.prepare('SELECT * FROM limits WHERE key=?').get(key);
    if(!row || row.reset_at<=now()){db.prepare('INSERT OR REPLACE INTO limits VALUES(?,?,?)').run(key,1,now()+period);return;}
    if(row.count>=max)throw new HttpError(429,'操作过于频繁，请稍后再试。');
    db.prepare('UPDATE limits SET count=count+1 WHERE key=?').run(key);
  }
  async function requestCode(email,ip) {
    if(typeof email!=='string'||email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new HttpError(400,'请输入有效邮箱。');
    email=email.trim().toLowerCase();
    if(config.mailMode==='local'&&!email.endsWith('@example.test'))throw new HttpError(503,'当前是本地测试模式，请使用 name@example.test；正式邮箱需先配置发信服务。');
    if(config.production&&email.endsWith('@example.test'))throw new HttpError(400,'测试账号不能用于正式服务。');
    limit('mail-ip:'+ip,10,3600000);limit('mail-email:'+hash(email),1,60000);
    const id=randomUUID(),code=String(randomInt(0,1000000)).padStart(6,'0');
    db.prepare('UPDATE challenges SET used=1 WHERE email=?').run(email);
    db.prepare('INSERT INTO challenges(id,email,code_hash,expires) VALUES(?,?,?,?)').run(id,email,digest(id,code),now()+10*60000);
    mailer.enqueue({id,kind:'login',to:email,subject:'土木 AI 雷达登录验证码',text:`验证码：${code}\n10 分钟内有效，仅可使用一次。若非本人操作，请忽略。`});
    await mailer.deliver(id);
    const delivery=db.prepare('SELECT status FROM outbox WHERE id=?').get(id);
    if(!['local','sent'].includes(delivery.status))throw new HttpError(503,'验证码投递失败，请稍后重试。');
    return {challengeId:id,local:config.mailMode==='local',expiresIn:600};
  }
  function verify(id,code,ip) {
    limit('verify-ip:'+ip,30,3600000);
    const challenge=typeof id==='string'?db.prepare('SELECT * FROM challenges WHERE id=?').get(id):null;
    if(!challenge || challenge.used || challenge.expires<=now() || challenge.attempts>=5 || typeof code!=='string' || !/^\d{6}$/.test(code))throw new HttpError(400,'验证码无效或已过期，请重新获取。');
    db.prepare('UPDATE challenges SET attempts=attempts+1 WHERE id=?').run(id);
    if(!timingSafeEqual(Buffer.from(challenge.code_hash,'hex'),Buffer.from(digest(id,code),'hex')))throw new HttpError(400,'验证码错误。');
    db.prepare('UPDATE challenges SET used=1 WHERE id=?').run(id);
    db.prepare('INSERT OR IGNORE INTO users(id,email,created_at) VALUES(?,?,?)').run(randomUUID(),challenge.email,now());
    const user=db.prepare('SELECT * FROM users WHERE email=?').get(challenge.email);
    const token=randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token),user.id,now()+7*86400000);
    return {token,user:{id:user.id,email:user.email,isAdmin:config.adminEmails.includes(user.email)}};
  }
  function session(cookie='') {
    const token=cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith('radar_session='))?.slice(14);
    if(!token)return null;
    const row=db.prepare('SELECT u.id,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>?').get(hash(token),now());
    return row?{...row,isAdmin:config.adminEmails.includes(row.email)}:null;
  }
  function logout(cookie='') {const token=cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith('radar_session='))?.slice(14);if(token)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token));}
  function cookie(token,clear=false){return `radar_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${clear?0:604800}${config.production?'; Secure':''}`;}
  return {requestCode,verify,session,logout,cookie,limit,secret};
}
