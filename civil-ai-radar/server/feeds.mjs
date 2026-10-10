// 公开读取层（2026-09-29，参考 AIHOT publication 层）：RSS、sitemap、robots、
// 详情页 meta 与 /api/articles 共用同一可见性规则（editorial.status!=='rejected'）。
// 这里只做读取与展示，不做精选改写；日期未披露的记录不虚构 pubDate。
import { collapseProcurementDuplicates } from '../src/lib/procurementIdentity.js';
import { scoreArticle, getWatchOrgs } from '../src/lib/scoring.js';
import { applyEditorial } from './review.mjs';

export const SITE_NAME='土木 AI 雷达';
const SITE_DESCRIPTION='土木与基础设施行业的 AI 落地情报：公开订阅采集（待复核）与编辑精选。';

// 公开池上限：已驳回的在 SQL 里先排除，不再占用名额（旧做法先取 1000 行再过滤，超量后旧条目会静默消失）。
export const PUBLIC_POOL_LIMIT=5000;
export function loadPublicArticles(db,limit=PUBLIC_POOL_LIMIT){
  return db.prepare("SELECT data,updated_at FROM articles WHERE json_extract(data,'$.editorial.status') IS NOT 'rejected' ORDER BY updated_at DESC LIMIT ?").all(limit)
    .map(row=>({article:JSON.parse(row.data),updatedAt:row.updated_at}))
    .filter(entry=>entry.article.editorial?.status!=='rejected');
}

// 公开池版本：文章表与翻译缓存的增删改由触发器计数（database.mjs public_version），附加观察名单变化会改变评分。
let unversioned=0;
export function publicPoolVersion(db){
  let n;
  try{n=db.prepare('SELECT n FROM public_version WHERE id=1').get()?.n;}catch{/* 未经 openDatabase 建表的库 */}
  if(n===undefined)return 'unversioned:'+(++unversioned);
  return n+'|'+getWatchOrgs().map(org=>org.id).join(',');
}

// 按公开池版本缓存一次计算结果：浏览器每 30 秒轮询、Agent 接口反复读取时，不再每次解析和评分整个公开池。
export function memoByPublicVersion(db,compute){
  let version=null,value;
  return ()=>{
    const current=publicPoolVersion(db);
    if(current!==version){value=compute();version=current;}
    return value;
  };
}

const esc=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

export function rssXml(entries,origin,builtAt){
  const items=entries.slice(0,50).map(({article})=>{
    const link=origin+'/detail/'+encodeURIComponent(article.id);
    // publishedAt 缺失时如实省略 pubDate（firstSeenAt 是收录时间，不是首次公开）。
    const pubDate=article.publishedAt?`<pubDate>${new Date(article.publishedAt).toUTCString()}</pubDate>`:'';
    const also=(article.procurement?.sources||[]).filter(s=>s.sourceUrl&&s.sourceUrl!==article.sourceUrl).map(s=>s.sourceUrl);
    const description=[article.source,article.summary,article.sourceUrl?'原文：'+article.sourceUrl:'',also.length?'另见：'+also.join(' '):''].filter(Boolean).join('　').slice(0,500);
    return `<item><title>${esc(article.title)}</title><link>${esc(link)}</link><guid isPermaLink="false">${esc(article.id)}</guid>${pubDate}<description>${esc(description)}</description></item>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${esc(SITE_NAME)} · 工程情报</title><link>${esc(origin)}</link><description>${esc(SITE_DESCRIPTION)}</description><lastBuildDate>${new Date(builtAt).toUTCString()}</lastBuildDate>${items}</channel></rss>\n`;
}

export function sitemapXml(entries,origin){
  const urls=entries.slice(0,500).map(({article,updatedAt})=>
    `<url><loc>${esc(origin+'/detail/'+encodeURIComponent(article.id))}</loc><lastmod>${new Date(updatedAt).toISOString()}</lastmod></url>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${esc(origin)}/</loc></url>${urls}</urlset>\n`;
}

export function robotsTxt(origin){
  return `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`;
}

export function detailDescription(article){
  return [article.source,article.summary].filter(Boolean).join('：').slice(0,300)||SITE_DESCRIPTION;
}

// SPA 详情页服务端注入 meta：只注入已存的标题/摘要，不虚构数字、链接或核验状态。
export function injectDetailMeta(html,article,origin){
  if(!article)return html;
  const url=origin+'/detail/'+encodeURIComponent(article.id);
  const tags=[
    `<meta property="og:title" content="${esc(article.title)}">`,
    `<meta property="og:description" content="${esc(detailDescription(article))}">`,
    `<meta property="og:type" content="article">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:site_name" content="${esc(SITE_NAME)}">`,
    `<meta name="description" content="${esc(detailDescription(article))}">`,
    `<link rel="canonical" href="${esc(url)}">`,
  ].join('');
  return html
    .replace(/<title>[\s\S]*?<\/title>/,`<title>${esc(article.title)} · ${esc(SITE_NAME)}</title>`)
    .replace('</head>',tags+'</head>');
}

// 与 /api/articles 同一套公开投影后再合并，已发布和 featuredRank 才能参与主记录选择。
function projectFeedArticle(article){
  const projected=applyEditorial(article);
  const salesScore=scoreArticle(projected);
  return {...projected,salesScore,assistScore:salesScore};
}

function presentFeedEntries(entries){
  const projected=entries.map(entry=>({article:projectFeedArticle(entry.article),updatedAt:entry.updatedAt}));
  const collapsed=collapseProcurementDuplicates(projected.map(entry=>entry.article));
  const updatedAt=new Map(projected.map(entry=>[entry.article.id,entry.updatedAt]));
  return collapsed.map(article=>({article,updatedAt:updatedAt.get(article.id)}));
}

export function createPublicFeeds({db,config,now=Date.now}){
  return {
    // 挂在 Node 服务的 /api 之前：任何模式（含开发）都提供 RSS/sitemap/robots。
    async handler(req,res){
      if(!['GET','HEAD'].includes(req.method))return false;
      const pathname=new URL(req.url,'http://localhost').pathname;
      const send=(body,type)=>{
        res.writeHead(200,{'Content-Type':type,'X-Content-Type-Options':'nosniff','Cache-Control':'public,max-age=600'});
        res.end(req.method==='HEAD'?undefined:body);
        return true;
      };
      if(pathname==='/rss.xml')return send(rssXml(presentFeedEntries(loadPublicArticles(db,50)),config.publicUrl,now()),'application/rss+xml; charset=utf-8');
      if(pathname==='/sitemap.xml')return send(sitemapXml(presentFeedEntries(loadPublicArticles(db,500)),config.publicUrl),'application/xml; charset=utf-8');
      if(pathname==='/robots.txt')return send(robotsTxt(config.publicUrl),'text/plain; charset=utf-8');
      return false;
    },
    // 详情页 meta 注入用：按路径取公开文章（已驳回的与未知 id 一样返回 null，不注入）。
    articleForDetail(pathname){
      const id=decodeURIComponent((pathname.match(/^\/detail\/([^/?#]+)/)||[])[1]||'');
      if(!id)return null;
      const row=db.prepare('SELECT data FROM articles WHERE id=?').get(id);
      if(!row)return null;
      const article=JSON.parse(row.data);
      return article.editorial?.status==='rejected'?null:article;
    },
  };
}
