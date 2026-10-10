import path from 'node:path';

function normalizeHost(host) {
  return String(host||'').replace(/^\[|\]$/g,'').toLowerCase();
}
function isBlockedTranslationHost(host) {
  const h=normalizeHost(host);
  if(!h||h==='0.0.0.0'||h==='::')return true;
  if(h==='metadata.google.internal'||h.endsWith('.internal'))return true;
  if(h==='169.254.169.254'||/^169\.254\./.test(h))return true;
  return false;
}
function isLoopbackHost(host) {
  const h=normalizeHost(host);
  return h==='127.0.0.1'||h==='localhost'||h==='::1';
}
function isPrivateIpv4(host) {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(normalizeHost(host));
}
function isRawIp(host) {
  const h=normalizeHost(host);
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(h) || (h.includes(':') && !h.includes('.'));
}

export function isAllowedTranslationUrl(value, production=false) {
  let u;
  try {u=new URL(value);} catch {return false;}
  if(u.username||u.password||u.protocol!=='https:'&&u.protocol!=='http:')return false;
  const host=u.hostname;
  if(isBlockedTranslationHost(host))return false;
  if(u.protocol==='https:'){
    // Never POST article text or API keys to a raw IP (loopback, link-local, metadata).
    if(isRawIp(host))return false;
    if(/^(translate|libretranslate)$/i.test(host))return true;
    if(host.includes('.'))return true;
    return !production;
  }
  if(isLoopbackHost(host)||isPrivateIpv4(host))return true;
  // Docker sidecar names stay on the private compose network.
  return /^(translate|libretranslate)$/i.test(host) || (!production && /^[a-z0-9-]+$/i.test(host) && !host.includes('.'));
}

function emailList(value) {
  return String(value||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
}

export function configFromEnv(env=process.env) {
  const production=env.NODE_ENV==='production';
  const publicUrl=env.PUBLIC_URL || (production?'':'http://127.0.0.1:5173');
  if (!publicUrl || (production && !publicUrl.startsWith('https://'))) throw new Error('Production requires HTTPS PUBLIC_URL');
  const mailMode=env.MAIL_MODE || (production?'resend':'local');
  if (!['local','resend','smtp'].includes(mailMode)) throw new Error('MAIL_MODE must be local, resend or smtp');
  if (production && !env.MAIL_FROM) throw new Error('Production requires MAIL_FROM');
  if (production && (!env.AUTH_SECRET || env.AUTH_SECRET.length<32)) throw new Error('Production requires a strong AUTH_SECRET (32+ characters)');
  if (production && mailMode!=='resend' && mailMode!=='smtp') throw new Error('Production requires a real mail provider (MAIL_MODE=resend or smtp)');
  if (mailMode==='resend' && production && !env.RESEND_API_KEY) throw new Error('Production requires RESEND_API_KEY for MAIL_MODE=resend');
  if (mailMode==='smtp'){
    const smtpPort=Number(env.SMTP_PORT || 465);
    if(!env.SMTP_HOST || !Number.isInteger(smtpPort) || smtpPort<1 || smtpPort>65535) throw new Error('MAIL_MODE=smtp requires SMTP_HOST and a valid SMTP_PORT');
    if(production && (!env.SMTP_USER || !env.SMTP_PASS)) throw new Error('Production requires SMTP_USER and SMTP_PASS for MAIL_MODE=smtp');
    if(env.SMTP_REPLY_TO && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.SMTP_REPLY_TO)) throw new Error('SMTP_REPLY_TO must be a valid email');
  }
  const adminEmails=emailList(env.ADMIN_EMAILS || (production?'':'admin@example.test'));
  if(production && !adminEmails.length) throw new Error('Production requires ADMIN_EMAILS');
  if(production && adminEmails.some(e=>e.endsWith('@example.test'))) throw new Error('Production ADMIN_EMAILS cannot use @example.test');
  const intervalMinutes=Number(env.COLLECT_INTERVAL_MINUTES || 1440);
  if(!Number.isFinite(intervalMinutes)||intervalMinutes<1||intervalMinutes>43200)throw new Error('COLLECT_INTERVAL_MINUTES must be between 1 and 43200');
  const translationUrl=env.TRANSLATION_URL||'';
  if(translationUrl && !isAllowedTranslationUrl(translationUrl, production)) throw new Error('TRANSLATION_URL requires HTTPS or a private/local HTTP translator');
  const feedbackTo=(env.FEEDBACK_TO||'').trim().toLowerCase() || adminEmails[0] || '';
  if(feedbackTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(feedbackTo)) throw new Error('FEEDBACK_TO must be a valid email');
  if(production && feedbackTo.endsWith('@example.test')) throw new Error('Production FEEDBACK_TO cannot use @example.test');
  if(production && !env.DATABASE_PATH) throw new Error('Production requires DATABASE_PATH on persistent disk');
  const reviewModelUrl=env.REVIEW_MODEL_URL || (env.OPENAI_API_KEY ? 'https://api.openai.com/v1/chat/completions' : '');
  const reviewModelKey=env.REVIEW_MODEL_KEY || env.OPENAI_API_KEY || '';
  if(reviewModelUrl && !isAllowedTranslationUrl(reviewModelUrl, production)) throw new Error('REVIEW_MODEL_URL requires HTTPS or a private/local HTTP endpoint');
  const academicMailto=(env.ACADEMIC_MAILTO||env.MAIL_FROM||'').trim().toLowerCase();
  const politeMailto=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(academicMailto) && !academicMailto.endsWith('@example.test') ? academicMailto : (adminEmails.find(e=>!e.endsWith('@example.test'))||'');
  const backupKeep=Number(env.DB_BACKUP_KEEP ?? 7);
  if(!Number.isInteger(backupKeep)||backupKeep<0||backupKeep>365)throw new Error('DB_BACKUP_KEEP must be an integer between 0 and 365');
  const smtpPort=Number(env.SMTP_PORT || 465);
  const smtp=mailMode==='smtp'?{host:env.SMTP_HOST,port:smtpPort,secure:env.SMTP_SECURE==='true'||smtpPort===465,user:env.SMTP_USER||'',pass:env.SMTP_PASS||'',replyTo:env.SMTP_REPLY_TO||''}:null;
  return {production,publicUrl:new URL(publicUrl).origin,host:env.API_HOST || '127.0.0.1',port:Number(env.API_PORT || 8791),
    database:env.DATABASE_PATH || path.resolve('.runtime/radar.sqlite'),backupKeep,
    backupDir:env.DB_BACKUP_DIR || path.join(path.dirname(env.DATABASE_PATH || path.resolve('.runtime/radar.sqlite')),'backups'),mailMode,mailFrom:env.MAIL_FROM,smtp,
    resendKey:env.RESEND_API_KEY,authSecret:env.AUTH_SECRET,translationUrl,translationKey:env.TRANSLATION_API_KEY,
    reviewModelUrl,reviewModelKey,reviewModel:env.REVIEW_MODEL || 'gpt-4o-mini',academicMailto:politeMailto,
    adminEmails,feedbackTo,collectorEnabled:env.COLLECTOR_ENABLED!=='false',intervalMs:intervalMinutes*60000};
}

function isIpLiteral(value) {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value) || (/^[0-9a-fA-F:]+$/.test(value) && value.includes(':'));
}

export function clientIp(req,config) {
  const socket=req.socket?.remoteAddress || '0.0.0.0';
  if(!config.production) return socket;
  // Caddy appends the TCP client as the rightmost hop. The leftmost values are client-controlled.
  const hops=String(req.headers['x-forwarded-for']||'').split(',').map(x=>x.trim()).filter(Boolean);
  const candidate=hops.at(-1) || String(req.headers['x-real-ip']||'').trim();
  return isIpLiteral(candidate)?candidate:socket;
}
