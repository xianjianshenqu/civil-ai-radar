import { useEffect, useRef, useState } from 'react';
import { IconStar, IconBell, IconSearch, IconArrowLeft, IconCopy, IconDownload, IconArrowUpRight, IconBolt, IconList, IconFlame, IconNotebook, IconLayoutGrid, IconChartBar, IconBuildingBridge2, IconDatabase, IconRobot, IconInfoCircle, IconMessageCircle, IconSettings, IconFileText, IconMail } from '@tabler/icons-react';
import { ArticleReader } from './ArticleReader.jsx';
import { SubscribeNudge } from './GuestGuide.jsx';
import { CompactEntry, DateGroupedFeed, Entry, HomeHotPreview, HotEventCard, TopicsDashboard } from './ContentViews.jsx';
import { ProcurementView } from './ProcurementView.jsx';
import { buildHotEvents, defaults, readRoute, filterEntries, localDay, isUpcoming, publishedDay, publishedCaption, formatReport, downloadText, isDetailVisible, featuredSort } from '../lib/radar.js';
import { isHttpUrl } from '../lib/evidence.js';
import { parseBackup, mergeDrafts } from '../lib/backup.js';
import {useAccountWorkspace} from '../services/useAccountWorkspace.js';
import {useLiveRadar} from '../services/useLiveRadar.js';
import {api} from '../services/api.js';
import { LazyPanel, lazyNamed } from './LazyPanel.jsx';
const loadOnlineServices = () => import('./OnlineServices.jsx');
const AccountPanel = lazyNamed(loadOnlineServices, 'AccountPanel');
const CollectorPanel = lazyNamed(loadOnlineServices, 'CollectorPanel');
const ModelSetup = lazyNamed(loadOnlineServices, 'ModelSetup');
import { dailySections, getDailySectionId } from '../data/dailyData.js';
import { REPORT_PERIODS, buildPeriodIndex, groupIndexByMonth, isoWeekKey, periodKey, periodRangeText, periodRowLabel } from '../lib/reportPeriods.js';
import { PRODUCT_OFFERINGS } from '../data/orgWatchlist.js';
import { SECTORS } from '../lib/topicMatch.js';
import { findCollapsedEntry, procurementRecordIds } from '../lib/procurementIdentity.js';
const navs = [
  ['内容', [['今日精选',IconBolt],['全部动态',IconList],['热点榜',IconFlame],['AI 日报',IconNotebook],['主题库',IconLayoutGrid],['收藏',IconStar],['我的关注',IconBell]]],
  ['雷达', [['国内雷达',IconChartBar],['采购公告',IconFileText],['工程案例',IconBuildingBridge2],['数据资产',IconDatabase]]],
  ['更多', [['Agent 中心',IconRobot],['账号与通知',IconBell],['关于',IconInfoCircle],['更新日志',IconList],['反馈',IconMessageCircle],['设置',IconSettings]]]
];
const names=navs.flatMap(g=>g[1].map(n=>n[0]));
const infoViews=['账号与通知','数据资产','Agent 中心','关于','更新日志','反馈','设置'];
const descriptions={'今日精选':'按销售价值自动评分（假设，非核验），含推荐理由','全部动态':'公开池：精选、入库与待复核采集','热点榜':'最多 10 条销售推荐 · 自动评分假设，非实时热度，非核验','AI 日报':'按首次公开日期归档的日 / 周 / 月报告','采购公告':'招标窗口与中标落地 · 多家平台的检索摘要，不是全文','工程案例':'项目试点与已部署案例','Agent 中心':'让 Agent 与工具直接接入本站公开数据；信息源、审核与情报面板也在这里','账号与通知':'邮箱登录、资料同步与通知','设置':'接入自己的大模型（翻译用你自己的 Key）、阅读与资料管理'};
const listValid=v=>Array.isArray(v)&&v.every(x=>typeof x==='string');
function Select({label,value,onChange,options}) {return <label className="field-label">{label}<select value={value} onChange={e=>onChange(e.target.value)}>{options.map(o=><option key={o} value={o}>{o}</option>)}</select></label>;}
function Empty({title='暂无匹配动态',note,onReset,extra}) {return <div className="empty-state"><IconSearch size={24}/><strong>{title}</strong>{note&&<span>{note}</span>}{onReset&&<button type="button" onClick={onReset}>清除筛选</button>}{extra}</div>;}
function Actions({text,name,notify}) {return <div className="action-row"><button onClick={async()=>{try{await navigator.clipboard.writeText(text);notify('已复制，包含摘要、来源与核验状态。');}catch{notify('复制失败，请使用下载按钮保存。');}}}><IconCopy size={16}/>复制内容</button><button onClick={()=>downloadText(text,name+'.md')}><IconDownload size={16}/>下载 Markdown</button><details><summary>查看可复制文本</summary><textarea aria-label="导出文本预览" className="export-preview" readOnly value={text}/></details></div>;}

export function App(){
  const [route,setRoute]=useState(readRoute);
  const [path,setPath]=useState(window.location.pathname);
  // 返回定位：进入详情前记住列表浏览位置（所点条目锚点 + 偏移 + 滚动像素），返回时按锚点恢复；
  // 阅读期间新采集条目会插到列表上方，纯像素恢复会漂移，所以优先对齐所点的那一行。
  const scrollMemory=useRef(null);
  const prevPath=useRef(null);
  const entryAnchorEls=eid=>[...document.querySelectorAll(`[data-entry-id="${CSS.escape(eid)}"]`)];
  const {entries,batchDate,liveStatus,collectedCount,collectedEntries,collection}=useLiveRadar();
  const cloud=useAccountWorkspace();
  const {saved,followed,notes,seen,prefs,feedback}=cloud.document;
  const {setSaved,setFollowed,setNotes,setSeen,setPrefs,setFeedback}=cloud;
  function revisionSeen(list){return Object.fromEntries(list.map(id=>[id,findCollapsedEntry(entries,id)?.revision || '']));}
  const [toast,setToast]=useState('');
  useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),5000);return()=>clearTimeout(t);},[toast]);
  // 游客本地资料达到一定量后，提示一次“仅存本浏览器”，可关闭且不再打扰。
  const [guestNudge,setGuestNudge]=useState(false);
  useEffect(()=>{
    if(cloud.user||!cloud.ready)return;
    let dismissed=false;try{dismissed=localStorage.getItem('civil-ai-radar-guest-nudge-v1')==='1';}catch{}
    if(!dismissed&&saved.length+followed.length>=2)setGuestNudge(true);
  },[cloud.user,cloud.ready,saved.length,followed.length]);
  useEffect(()=>{const listener=()=>{setRoute(readRoute());setPath(window.location.pathname);};window.addEventListener('popstate',listener);return()=>window.removeEventListener('popstate',listener);},[]);
  // 详情 → 列表的返回：恢复到离开时的浏览位置；没有记录（如直接打开详情链接再返回）则回列表顶部。
  useEffect(()=>{
    const from=prevPath.current;prevPath.current=path;
    if(path!=='/'||!from||!from.startsWith('/detail/'))return;
    const mem=scrollMemory.current;
    if(!mem||mem.url!==window.location.pathname+window.location.search){window.scrollTo(0,0);return;}
    scrollMemory.current=null;
    const raf=requestAnimationFrame(()=>{
      const els=mem.id?entryAnchorEls(mem.id):[];
      const el=els[mem.dupIndex]||els[0]||null;
      const top=el?el.getBoundingClientRect().top+window.scrollY-mem.offset:mem.y;
      window.scrollTo(0,Math.max(0,Math.round(top)));
    });
    return()=>cancelAnimationFrame(raf);
  },[path]);
  const nav=names.includes(route.nav)?route.nav:'今日精选';
  const detailMatch=path.match(/^\/detail\/([^/]+)\/?$/);
  let id;try{id=detailMatch?decodeURIComponent(detailMatch[1]):null;}catch{id=null;}
  const detailItem=id?findCollapsedEntry(entries,id):null;
  const detailIds=detailItem?procurementRecordIds(detailItem):[];
  const detailSaved=detailIds.some(key=>saved.includes(key));
  const detailFollowed=detailIds.some(key=>followed.includes(key));
  const detailNoteKey=detailIds.find(key=>notes[key])||id;
  const detailNote=detailNoteKey?notes[detailNoteKey]:undefined;
  const missing=path!=='/'&&!isDetailVisible(detailItem, route.demo);
  useEffect(()=>{document.title=`${(!missing && detailItem?.title) || nav} · 土木 AI 雷达`;},[nav,detailItem,missing]);
  const update=(patch,{pathname=window.location.pathname,replace=false}={})=>{
    const next={...route,...patch}; const p=new URLSearchParams();
    Object.entries(next).forEach(([k,v])=>{if(v && v!==defaults[k])p.set(k,v);});
    const query=p.toString(); window.history[replace?'replaceState':'pushState']({},'',pathname+(query?'?'+query:''));setRoute(next);setPath(pathname);
  };
  const selectNav=n=>{scrollMemory.current=null;update({nav:n,topic:'',category:'all',window:'all',date:'',group:'全部',sort:'销售评分',origin:'全部',period:'daily',agent:'接入'},{pathname:'/'});window.scrollTo(0,0);};
  const clear=()=>update({...defaults,nav,demo:route.demo});
  const openDetail=eid=>{
    const els=entryAnchorEls(eid);
    const el=els.find(el=>{const r=el.getBoundingClientRect();return r.bottom>0&&r.top<window.innerHeight;})||els[0]||null;
    if(el)scrollMemory.current={url:window.location.pathname+window.location.search,id:eid,dupIndex:els.indexOf(el),offset:Math.round(el.getBoundingClientRect().top),y:Math.round(window.scrollY)};
    update({},{pathname:'/detail/'+encodeURIComponent(eid)});
    const opened=findCollapsedEntry(entries,eid);
    if(opened&&procurementRecordIds(opened).some(key=>followed.includes(key)))setSeen(s=>({...s,[eid]:opened.revision}));
    window.scrollTo(0,0);
  };
  const toggleSaved=eid=>{
    if(!cloud.ready){setToast('账号服务连接中，请稍后再收藏。');return;}
    const entry=findCollapsedEntry(entries,eid)||{id:eid};
    const ids=procurementRecordIds(entry);
    const active=ids.some(key=>saved.includes(key));
    setSaved(v=>active?v.filter(key=>!ids.includes(key)):[...v,entry.id]);
    setToast(active?'已取消收藏；笔记仍保留。':'已收藏，可在收藏页分组并记录笔记。');
  };
  const toggleFollow=eid=>{
    if(!cloud.ready){setToast('账号服务连接中，请稍后再关注。');return;}
    const entry=findCollapsedEntry(entries,eid)||{id:eid};
    const ids=procurementRecordIds(entry);
    const active=ids.some(key=>followed.includes(key));
    if(active){setFollowed(v=>v.filter(key=>!ids.includes(key)));setToast('已取消关注。');return;}
    setFollowed(v=>[...v,entry.id]);
    setSeen(v=>({...v,[entry.id]:entry.revision||''}));
    setToast('已关注，后续数据变化会在“我的关注”中标记。');
  };
  const hasUpdate=e=>procurementRecordIds(e).some(key=>followed.includes(key)&&seen[key]!==e.revision);
  let visible=filterEntries(entries,{...route,nav,q:nav==='主题库'?'':route.q},{saved,followed});
  if(nav==='收藏'&&route.group!=='全部')visible=visible.filter(e=>((procurementRecordIds(e).map(key=>notes[key]).find(Boolean))?.group||'未分组')===route.group);
  const collectedVisibleIds=new Set(filterEntries(collectedEntries,{...route,nav:'全部动态'},{saved,followed}).map(e=>e.id));
  const latestCollected=collectedEntries.filter(e=>collectedVisibleIds.has(e.id))
    .slice().sort((a,b)=>Date.parse(b.firstSeenAt||0)-Date.parse(a.firstSeenAt||0)||(b.timelineSort||0)-(a.timelineSort||0));
  const lastRun=collection?.runs?.[0];
  const dates=[...new Set(entries.filter(e=>route.demo==='yes'||!e.isDemo).map(publishedDay).filter(Boolean))].sort().reverse();
  const dailyDate=route.date||dates[0]||localDay();
  const rootEntries=entries.filter(e=>route.demo==='yes'||!e.isDemo);
  const storageError=cloud.error;
  const patchNote=(eid,patch)=>setNotes(v=>({...v,[eid]:{...v[eid],...patch}}));
  const cardSaved=e=>procurementRecordIds(e).some(key=>saved.includes(key));
  const card=e=><Entry key={e.id} item={e} isSaved={cardSaved(e)} onToggleSave={toggleSaved} onOpenDetail={openDetail}/>;
  const compact=e=><CompactEntry key={e.id} item={e} isSaved={cardSaved(e)} onToggleSave={toggleSaved} onOpenDetail={openDetail}/>;
  const hotEvents=nav==='热点榜'
    ? buildHotEvents(visible)
    : nav==='今日精选' ? buildHotEvents(filterEntries(entries,{...route,nav:'热点榜',q:'',window:'all'},{saved,followed})) : [];
  const backup=()=>downloadText(JSON.stringify({version:1,saved,followed,notes,seen,prefs,feedback},null,2),'civil-radar-backup.json','application/json');
  const restore=async file=>{if(!file)return;try{if(file.size>2000000)throw new Error();const v=parseBackup(await file.text());
    setSaved(x=>[...new Set([...x,...v.saved])]);
    setFollowed(x=>[...new Set([...x,...v.followed])]);
    setNotes(x=>({...v.notes,...x}));
    setSeen(x=>({...v.seen,...x}));
    setFeedback(x=>mergeDrafts(x,v.feedback||[]));
    if(v.prefs)setPrefs(v.prefs);
    setToast('已合并收藏、关注、笔记和反馈草稿，并恢复阅读设置；现有同条目笔记保留。');
  }catch{setToast('导入失败：请选择有效的土木雷达 JSON 备份（不超过 2 MB）。');}};
  return <div className={'app-shell'+(prefs.large?' large-reading':'')}>
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    <aside className="sidebar"><div className="brand"><img src="/assets/radar-mark.png" alt="土木 AI 雷达标志"/><div className="brand-name">土木 AI 雷达</div><div className="brand-subtitle">Civil Intelligence</div></div>
      <nav className="sidebar-nav" aria-label="主导航">{navs.map(([group,items])=><div className="nav-group" key={group}><p>{group}</p>{items.map(([label,Icon])=>{const shown=label==='账号与通知'&&!cloud.user?'登录':label;return <button type="button" key={label} aria-label={shown} aria-current={!detailItem&&nav===label?'page':undefined} className={'nav-item '+(!detailItem&&nav===label?'active':'')} onClick={()=>selectNav(label)}><Icon size={18}/><span>{shown}</span>{label==='我的关注'&&entries.some(hasUpdate)&&<span className="update-dot">有更新</span>}</button>;})}</div>)}</nav>
      {!cloud.user&&<div className="sidebar-subscribe"><div className="side-sub-head"><IconMail size={14}/>订阅推送</div><p>登录后按领域／关键词接收新线索邮件。</p><button type="button" onClick={()=>selectNav('账号与通知')}>去登录</button></div>}
      <div className="sidebar-footer"><button type="button" className="footer-action" onClick={()=>selectNav('账号与通知')}>{cloud.user?`${cloud.user.email} · ${cloud.status}`:'未登录 · 点此登录'}</button></div>
    </aside>
    <main id="main-content" className="main-panel" tabIndex={-1}>
      {!cloud.ready&&<div role="status" className="batch-notice">正在连接账号服务…</div>}{cloud.user&&<div className="sync-banner">账号资料：{cloud.status} <button onClick={()=>selectNav('账号与通知')}>管理账号与通知</button></div>}{toast&&<div className="app-notice" role="status">{toast}</div>}{storageError&&<div className="app-notice warning" role="alert">{storageError}</div>}
      {guestNudge&&!cloud.user&&<div className="app-notice guest-nudge" role="status"><span>收藏与关注目前只保存在本浏览器；登录后同步到账号、换设备不丢，并可订阅邮件推送。</span><span className="nudge-actions"><button type="button" onClick={()=>selectNav('账号与通知')}>去登录</button><button type="button" className="nudge-dismiss" onClick={()=>{setGuestNudge(false);try{localStorage.setItem('civil-ai-radar-guest-nudge-v1','1');}catch{/* 存储不可用时下次访问再提示 */}}}>知道了</button></span></div>}
      {missing?<Empty title="未找到这条动态，链接可能已失效" onReset={()=>selectNav('全部动态')}/>:detailItem?<Detail batchDate={batchDate} key={detailItem.id} item={detailItem} saved={detailSaved} followed={detailFollowed} toggleSaved={()=>toggleSaved(detailItem.id)} toggleFollow={()=>toggleFollow(detailItem.id)} onBack={()=>update({},{pathname:'/'})} notify={setToast} note={detailNote} patchNote={p=>patchNote(detailNoteKey,p)} user={cloud.user} onLogin={()=>selectNav('账号与通知')} onSettings={()=>selectNav('设置')}/>:<>
      <header className="page-header"><div><div className="eyebrow">数据批次：{batchDate} · 今日：{localDay()}</div><h1>{nav==='账号与通知'&&!cloud.user?'登录':nav}</h1>{descriptions[nav]&&<p>{descriptions[nav]}</p>}</div>{!infoViews.includes(nav)&&<label className="search-box"><IconSearch size={19}/><input aria-label="搜索动态、主题或机构" placeholder="搜索主题、项目、公司、技术…" value={route.q} onChange={e=>update({q:e.target.value},{replace:true})}/>{route.q&&<button aria-label="清除搜索" onClick={()=>update({q:''})}>×</button>}</label>}</header>
      <div className="batch-notice">{liveStatus} · 实时收录 {collectedCount} 条。 <label><input type="checkbox" checked={route.demo==='yes'} onChange={e=>update({demo:e.target.checked?'yes':'no'})}/>显示演示数据</label></div>
      {nav==='账号与通知'?<LazyPanel key="account"><AccountPanel cloud={cloud}/></LazyPanel>:nav==='Agent 中心'?<LazyPanel key="agent"><CollectorPanel cloud={cloud} onLogin={()=>selectNav('账号与通知')} tab={route.agent} onTab={agent=>update({agent},{replace:true})}/></LazyPanel>:infoViews.includes(nav)?<InfoView nav={nav} rootEntries={rootEntries} backup={backup} restore={restore} prefs={prefs} setPrefs={setPrefs} feedback={feedback} setFeedback={setFeedback} notify={setToast} cloud={cloud} onLogin={()=>selectNav('账号与通知')}/>:<>
      <section className="filter-row" aria-label="领域与时间筛选"><div className="sector-tabs">{['全部',...SECTORS].map(s=><button key={s} aria-pressed={route.sector===s} className={route.sector===s?'selected':''} onClick={()=>update({sector:s})}>{s}</button>)}</div>{nav!=='热点榜'&&<div className="time-tabs">{['新公开','新发生'].map(s=><button key={s} aria-pressed={route.time===s} className={route.time===s?'selected':''} onClick={()=>update({time:s})}>{s}</button>)}</div>}</section>
      {nav==='全部动态'&&<div className="time-tabs origin-tabs" role="tablist" aria-label="内容来源">{['全部','精选','采集','登记','入库'].map(s=><button key={s} aria-pressed={route.origin===s} className={route.origin===s?'selected':''} onClick={()=>update({origin:s})}>{s}</button>)}</div>}
      <details className="advanced-filters"><summary>更多筛选 · 地区、切口、阶段、成熟度、证据与日期</summary><div className="fields-grid">
        <Select label="地区" value={route.scope} onChange={scope=>update({scope})} options={['全部','国内','海外']}/>
        <Select label="业务切口（自动识别的销售假设）" value={route.offering} onChange={offering=>update({offering})} options={['全部',...PRODUCT_OFFERINGS]}/>
        <Select label="工程阶段" value={route.stage} onChange={stage=>update({stage})} options={['全部',...new Set(entries.map(e=>e.engineeringStage).filter(Boolean))]}/>
        <Select label="成熟度" value={route.maturity} onChange={maturity=>update({maturity})} options={['全部',...new Set(entries.map(e=>e.maturity))]}/>
        <Select label="核验状态" value={route.evidence} onChange={evidence=>update({evidence})} options={['全部','已核验','待复核','演示数据']}/>
        <label className="field-label">首次公开起始日<input type="date" value={route.from} onChange={e=>update({from:e.target.value})}/></label><label className="field-label">首次公开截止日<input type="date" value={route.to} onChange={e=>update({to:e.target.value})}/></label>
      </div></details>
      <div className="result-bar"><span aria-live="polite">{nav==='今日精选'?`${visible.length} 条销售精选 · ${latestCollected.length} 条待复核采集`:nav==='热点榜'?`${hotEvents.length} 条销售推荐`: `${visible.length} 条匹配动态`}</span><button onClick={clear}>清除筛选</button></div>
      {route.from&&route.to&&route.from>route.to?<div role="alert" className="batch-notice">起始日不能晚于截止日，请调整日期。</div>:null}
      {nav==='主题库'?<TopicsDashboard allEntries={visible} saved={saved} toggleSaved={toggleSaved} onOpenDetail={openDetail} searchQuery={route.q} activeSector={route.sector} selectedCat={route.category} setSelectedCat={category=>update({category})} selectedTopicId={route.topic} setSelectedTopicId={topic=>update({topic:topic||''})}/>
      :nav==='AI 日报'?<ReportView entries={visible} archive={rootEntries} period={REPORT_PERIODS.some(p=>p.id===route.period)?route.period:'daily'} setPeriod={period=>update({period})} date={dailyDate} setDate={date=>update({date})} card={card} notify={setToast} user={cloud.user} onLogin={()=>selectNav('账号与通知')}/>
      :nav==='热点榜'?<Ranking events={hotEvents} window={route.window} setWindow={window=>update({window})} sort={route.sort} setSort={sort=>update({sort})} onOpenDetail={openDetail} onBrowse={selectNav}/>
      :nav==='采购公告'?<ProcurementView entries={visible} notice={route.notice} setNotice={notice=>update({notice})} onOpenDetail={openDetail}/>
      :<>
        {nav==='今日精选'&&<HomeHotPreview events={hotEvents} onOpenDetail={openDetail} onViewAll={()=>selectNav('热点榜')}/>}
        {nav==='今日精选'&&<section className="daily-section" aria-label="最新收录">
          <div className="management-tools"><h2>最新收录</h2><button onClick={()=>selectNav('全部动态')}>查看全部动态</button></div>
          {lastRun&&<p role="status">最近采集：{new Date(lastRun.started_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}（北京时间） · {!lastRun.finished_at?'正在采集':lastRun.results?.some(r=>r.status==='error')?'存在来源失败，请查看 Agent 中心':lastRun.results?.length?'采集成功':'没有启用的来源'}{lastRun.finished_at&&` · 新增 ${lastRun.results?.reduce((n,r)=>n+(r.added||0),0)||0} 条，更新 ${lastRun.results?.reduce((n,r)=>n+(r.updated||0),0)||0} 条`}</p>}
          {latestCollected.length?<div className="compact-feed">{latestCollected.slice(0,3).map(compact)}</div>:<p>{collectedCount?'当前筛选下没有自动采集内容。':'暂无已同步的自动采集内容。'}</p>}
        </section>}
        {nav==='收藏'&&<div className="management-tools"><Select label="收藏分组" value={route.group} onChange={group=>update({group})} options={['全部',...new Set(saved.map(id=>notes[id]?.group||'未分组'))]}/><Actions text={formatReport(visible)+'\n\n'+visible.map(e=>`【${e.title}】\n分组：${notes[e.id]?.group||'未分组'}\n笔记：${notes[e.id]?.text||'无'}`).join('\n\n')} name="土木雷达收藏" notify={setToast}/></div>}
        {nav==='我的关注'&&<div className="management-tools"><span>{entries.filter(hasUpdate).length} 条关注内容有变化</span><button onClick={()=>{setSeen(v=>({...v,...revisionSeen(followed)}));setToast('关注内容已全部标记为已读。');}}>全部标为已读</button></div>}
        {!visible.length?<Empty onReset={clear}/>:nav==='全部动态'?<DateGroupedFeed entries={visible} className="compact-feed" renderItem={compact}/>:nav==='今日精选'?<DateGroupedFeed entries={visible} className="timeline-list" renderItem={card}/>:<div className="timeline-list">{visible.map(e=><div key={e.id}>{isUpcoming(e)&&<div className="upcoming-label">即将发生 · {e.eventDate}</div>}{nav==='我的关注'&&<div className="result-bar"><span>{hasUpdate(e)?'有更新':'已读'}</span><button onClick={()=>toggleFollow(e.id)}>取消关注</button></div>}{card(e)}{nav==='收藏'&&<NoteEditor note={notes[e.id]} onChange={p=>patchNote(e.id,p)} id={e.id}/>}</div>)}</div>}
      </>}
      </>}
      </>}
      {/* 部署在中国内地的站点需在此补充自己的 ICP 备案号并链接 https://beian.miit.gov.cn/ */}
      <footer className="site-footer"><span>土木 AI 雷达</span></footer>
    </main>
  </div>;
}

function NoteEditor({note={},onChange,id}) {return <div className="note-editor"><label htmlFor={'group-'+id}>收藏分组<input id={'group-'+id} placeholder="未分组，例如：项目参考" value={note.group||''} maxLength={40} onChange={e=>onChange({group:e.target.value})}/></label><label htmlFor={'note-'+id}>我的笔记<textarea id={'note-'+id} placeholder="记录与项目的关联、待确认的问题…" value={note.text||''} maxLength={5000} onChange={e=>onChange({text:e.target.value})}/></label><small>自动保存；登录后同步到账号</small></div>;}
function Detail({batchDate,item,saved,followed,toggleSaved,toggleFollow,onBack,notify,note,patchNote,user,onLogin,onSettings}) {
  const report=formatReport([item]);
  const verifiedMetrics = item.verificationRecord && Array.isArray(item.metrics) ? item.metrics.filter(m=>m.label&&m.value&&isHttpUrl(m.sourceUrl)&&item.verificationRecord.references.some(r=>r.url===m.sourceUrl)) : [];
  return <div className="detail-page improved-detail reading-detail"><button className="back-list-btn" onClick={onBack}><IconArrowLeft size={16}/>返回动态列表</button>
    <header className="detail-hero"><div className="hero-content-col"><div className="chips"><span>{item.evidence}</span><span>{item.sector}</span><span>{isUpcoming(item)?'即将发生':item.maturity}</span></div><h1 className="detail-hero-title">{item.title}</h1><p>{item.source} · {item.region} · {item.engineeringStage||'阶段未披露'}</p><p>事件：{item.eventDate}　{publishedCaption(item)}</p></div>
    <div className="detail-hero-actions">{item.sourceUrl&&<a className="detail-primary-jump-btn" href={item.sourceUrl} target="_blank" rel="noreferrer">查看入库原文<IconArrowUpRight size={16}/></a>}<button aria-pressed={saved} onClick={toggleSaved}><IconStar size={16}/>{saved?'已收藏':'收藏'}</button><button aria-pressed={followed} onClick={toggleFollow}><IconBell size={16}/>{followed?'已关注':'持续关注'}</button><button onClick={async()=>{try{await navigator.clipboard.writeText(window.location.href);notify('已复制详情链接；本地预览地址仅在本机可访问。');}catch{notify('复制失败，可以从浏览器地址栏复制链接。');}}}>复制详情链接</button></div></header>
    <div className="batch-notice">{item.verification} 数据批次：{batchDate}。</div>
    {!user&&<div className="detail-guest-hint"><span>收藏、关注与笔记当前仅存本浏览器；登录后同步到账号，并可订阅领域／关键词邮件推送。</span><button type="button" onClick={onLogin}>去登录</button></div>}
    {item.dataOrigin!=='collector'||item.reviewed?<section className="reading-guide" id="article-guide"><div className="reading-eyebrow"><IconBolt size={16}/><h2>导读</h2></div><p>{item.summary}</p></section>:item.machineReview?.summary||item.machineReview?.implication?<section className="reading-guide" id="article-guide"><div className="reading-eyebrow"><IconBolt size={16}/><h2>机器整理</h2></div><p>{item.machineReview.summary||item.summary}</p>{item.machineReview.note?<p>{item.machineReview.note}</p>:null}</section>:item.salesScore?.reason?<section className="reading-guide" id="article-guide"><div className="reading-eyebrow"><IconBolt size={16}/><h2>自动评分理由</h2></div><p>{item.salesScore.reason}</p></section>:null}
    <div className="detail-layout"><article className="detail-main"><ArticleReader item={item} notify={notify} user={user} onLogin={onLogin} onSettings={onSettings}/>
    <section className="detail-section"><h2>工程判断</h2><dl className="decision-grid"><div><dt>适用场景</dt><dd>{item.sector} · {item.engineeringStage||item.layer}</dd></div><div><dt>落地阶段</dt><dd>{item.maturity}</dd></div><div><dt>数据与部署条件</dt><dd>{item.deploymentRequirements||'未披露，需向发布方确认。'}</dd></div><div><dt>量化效果与限制</dt><dd>{verifiedMetrics.length ? verifiedMetrics.map((m,i)=><p key={i}>{m.label}：{m.value} · <a href={m.sourceUrl} target="_blank" rel="noreferrer">查看指标证据</a>{m.limitations?` · ${m.limitations}`:''}</p>) : '暂无可追溯的量化证据。'}</dd></div></dl>{(item.dataOrigin!=='collector'||item.reviewed)&&item.implication&&!String(item.implication).startsWith('待编辑')?<><h3>工程启示 · 编辑分析</h3><p className="paragraph-text">{item.implication}</p></>:item.machineReview?.implication?<><h3>销售启示 · 机器整理</h3><p className="paragraph-text">{item.machineReview.implication}</p></>:item.salesScore?.reason?<><h3>销售评分</h3><p className="paragraph-text">{item.salesScore.reason}</p></>:null}</section>
    <section className="detail-section" id="article-evidence"><h2>来源与核验记录</h2><p>来源：{item.source}</p><p>核验状态：{item.evidence}；逐项复核时间：{item.verificationRecord?.checkedAt||'未记录'}。</p>{item.verificationRecord&&<div><p>复核人：{item.verificationRecord.reviewer}</p><p>{item.verificationRecord.notes}</p><ul>{item.verificationRecord.references.map(r=><li key={r.url}><a href={r.url} target="_blank" rel="noreferrer">{r.title}</a></li>)}</ul></div>}{item.sourceUrl?<a className="wrapping-link" href={item.sourceUrl} target="_blank" rel="noreferrer">{item.sourceUrl}</a>:<p>该演示条目不提供可引用的原文链接。</p>}{item.procurement?.sources?.length>1&&<ul>{item.procurement.sources.filter(s=>s.sourceUrl&&s.sourceUrl!==item.sourceUrl).map(s=><li key={s.sourceUrl}><a className="wrapping-link" href={s.sourceUrl} target="_blank" rel="noreferrer">{s.source}</a></li>)}</ul>}</section>
    {(item.procurement||item.machineReview?.extracted)?<section className="detail-section"><h2>公告要素与机器提取</h2>
      {item.procurement&&<dl className="decision-grid">
        <div><dt>公告类型</dt><dd>{item.procurement.noticeType||'摘要未披露'}{item.procurement.noticeClass?` · ${({tender:'招标窗口',result:'中标落地',other:'更正与其他'})[item.procurement.noticeClass]}`:''}</dd></div>
        <div><dt>采购人</dt><dd>{item.procurement.buyer||'摘要未披露'}</dd></div>
        {item.procurement.agency&&<div><dt>代理机构</dt><dd>{item.procurement.agency}</dd></div>}
        {item.procurement.region&&<div><dt>地区</dt><dd>{item.procurement.region}</dd></div>}
      </dl>}
      {(()=>{const ex=item.machineReview?.extracted;if(!ex)return null;const bits=[ex.amounts?.length?`金额线索：${ex.amounts.join('、')}`:'',ex.deadline?`截止时间：${ex.deadline}`:'',ex.clientOrgs?.length?`提及单位：${ex.clientOrgs.join('、')}（待回链确认，不代表参与）`:''].filter(Boolean);return bits.length?<p className="paragraph-text">{bits.join('；')}。均为原文截取的机器提取，待复核。</p>:null;})()}
    </section>:null}
    <Actions text={report} name={'土木雷达-'+item.id} notify={notify}/>
    {saved&&<NoteEditor note={note} onChange={patchNote} id={item.id}/>}
    {!user&&<div className="detail-guest-footer"><span>登录后可跨设备同步收藏与笔记，并订阅领域线索邮件推送。</span><button type="button" onClick={onLogin}>注册 / 登录</button></div>}</article>
    <aside className="detail-aside"><section className="detail-side-card reading-aid"><h3>标签</h3><div className="chips">{[...new Set([item.sector,item.ai,item.layer])].map(tag=><span key={tag}>#{tag}</span>)}</div><hr/><h3>本篇导航</h3><nav aria-label="本篇导航">{(item.dataOrigin!=='collector'||item.reviewed)&&<a href="#article-guide">导读</a>}<a href="#article-body">正文与翻译</a><a href="#article-evidence">来源与核验</a></nav></section></aside></div>
  </div>;
}
function ReportView({entries,archive,period,setPeriod,date,setDate,card,notify,user,onLogin}) {
  const index=buildPeriodIndex(period,archive,featuredSort);
  const activeKey=periodKey(period,date);
  const pos=index.findIndex(p=>p.key===activeKey);
  const monthGroups=groupIndexByMonth(index,period);
  const report=entries.filter(e=>periodKey(period,publishedDay(e))===activeKey)
    .sort((a,b)=>publishedDay(b).localeCompare(publishedDay(a))||(b.timelineSort||b.publishSort||0)-(a.timelineSort||a.publishSort||0));
  const meta=period==='weekly'?{label:'周报',word:'本周',prev:'上一周',next:'下一周'}:period==='monthly'?{label:'月报',word:'本月',prev:'上个月',next:'下个月'}:{label:'日报',word:'这一天',prev:'前一日',next:'后一日'};
  const bigNow=period==='weekly'?isoWeekKey(date):period==='monthly'?`${Number(date.slice(5,7))}月`:`${Number(date.slice(8,10))}`;
  const topNow=period==='monthly'?`${date.slice(0,4)}年`:`${date.slice(0,4)}年${Number(date.slice(5,7))}月`;
  const collected=report.filter(e=>e.dataOrigin==='collector').length;
  const verified=report.filter(e=>e.evidence==='已核验').length;
  const rangeText=periodRangeText(period,date);
  return <section className="report-view" aria-label={`AI ${meta.label}`}>
    <div className="report-layout">
      <aside className="report-history" aria-label={`${meta.label}历史`}>
        <div className="report-switch" role="tablist" aria-label="切换日报、周报、月报">
          {REPORT_PERIODS.map(p=><button key={p.id} type="button" role="tab" aria-selected={p.id===period} className={p.id===period?'on':''} onClick={()=>setPeriod(p.id)}>{p.label}</button>)}
        </div>
        <div className="report-current" aria-hidden="true"><span>{topNow}</span><strong>{bigNow}</strong></div>
        <div className="report-history-list">
          {monthGroups.map(g=><div key={g.label}>
            <p className="report-month-label">{g.label}</p>
            {g.rows.map(row=><button key={row.key} type="button" className={'report-history-item'+(row.key===activeKey?' on':'')} aria-current={row.key===activeKey?'date':undefined} onClick={()=>setDate(row.anchor)}><span className="rh-date">{periodRowLabel(period,row)}</span><span className="rh-title">{row.lead?.title||'（无标题）'}</span><span className="rh-count">{row.count} 条</span></button>)}
          </div>)}
          {!monthGroups.length&&<p className="report-history-empty">暂无已归档内容</p>}
        </div>
        <p className="report-history-note">按首次公开日期归档；未披露公开日期的条目不参与。</p>
      </aside>
      <div className="report-body">
        <header className="report-header">
          <p className="report-eyebrow"><IconNotebook size={15}/>AI {meta.label}{rangeText&&<span className="re-date">{rangeText}</span>}</p>
          <h2>{report.length?`${meta.word}的 ${report.length} 条土木 AI 动态`:`${meta.word}暂无入库动态`}</h2>
          {!!report.length&&<p className="report-header-meta">采集 {collected} 条 · 已核验 {verified} 条 · 其余待复核</p>}
        </header>
        <Actions text={formatReport(report,`土木 AI ${meta.label} · ${rangeText}`)} name={`土木AI${meta.label}-${activeKey||date}`} notify={notify}/>
        {!user&&<SubscribeNudge onLogin={onLogin}/>}
        {report.length?dailySections.map(sec=>{const group=report.filter(e=>getDailySectionId(e)===sec.id);return group.length?<section className="daily-section" key={sec.id}><h2><i className="sec-dot" style={{background:sec.color}}/>{sec.number} · {sec.title} <small>({group.length})</small></h2><div className="timeline-list">{group.map(card)}</div></section>:null;}):<Empty title="本期没有符合筛选的入库内容"/>}
        <nav className="report-pager" aria-label={`${meta.label}前后期`}>
          <button type="button" disabled={pos<0||pos>=index.length-1} onClick={()=>setDate(index[pos+1].anchor)}>← {meta.prev}</button>
          <span>共 {index.length} 期</span>
          <button type="button" disabled={pos<=0} onClick={()=>setDate(index[pos-1].anchor)}>{meta.next} →</button>
        </nav>
      </div>
    </div>
  </section>;
}
function Ranking({events,window,setWindow,sort,setSort,onOpenDetail,onBrowse}) {
  const list=events.slice().sort((a,b)=>sort==='最新公开'?b.publishSort-a.publishSort:featuredSort(a,b));
  return <section className="hot-radar-view">
    <div className="hot-radar-banner">
      <div className="hot-banner-left">
        <span className="hot-now-badge editorial">销售推荐</span>
        <span className="hot-banner-stat">最多 10 条事件</span>
        <span className="hot-banner-sub">销售价值自动评分（假设，非实时热度，非核验）</span>
      </div>
      <div className="hot-banner-right">
        <Select label="排序依据" value={sort} onChange={setSort} options={['销售评分','最新公开']}/>
        <label className="field-label">公开时间窗口<select value={window} onChange={e=>setWindow(e.target.value)}><option value="2">近两个自然日</option><option value="7">近七个自然日</option><option value="all">本批次全部</option></select></label>
      </div>
    </div>
    {list.length?<div className="hot-ranking-list">{list.map((event,i)=><HotEventCard key={event.id} event={event} rank={i+1} onOpenDetail={onOpenDetail}/>)}</div>:<Empty title="所选时间窗口没有销售推荐事件" note="这里按销售价值自动评分（假设，非实时热度，非核验）。可到采购公告看招标线索，或到全部动态浏览公开池。" onReset={()=>setWindow('all')} extra={onBrowse&&<div className="empty-actions"><button type="button" onClick={()=>onBrowse('采购公告')}>看招标线索</button><button type="button" onClick={()=>onBrowse('全部动态')}>看全部动态</button></div>}/>}
  </section>;
}
function InfoView({nav,rootEntries,backup,restore,prefs,setPrefs,feedback,setFeedback,notify,cloud,onLogin}) {
  const [draft,setDraft]=useState('');
  const [health,setHealth]=useState(null);
  const [sending,setSending]=useState(false);
  useEffect(()=>{api('/health').then(setHealth).catch(()=>setHealth(null));},[]);
  if(nav==='设置')return <><LazyPanel><ModelSetup cloud={cloud} onLogin={onLogin}/></LazyPanel><section className="utility-panel"><h2>阅读与资料管理</h2><label><input type="checkbox" checked={!!prefs.large} onChange={e=>setPrefs(v=>({...v,large:e.target.checked}))}/>使用较大正文字号</label><h3>本地备份</h3><p>游客资料仅存于当前浏览器；登录后可同步。导入会合并资料并恢复备份中的阅读设置。</p><div className="action-row"><button onClick={backup}>导出个人资料备份</button><label className="file-input-label">导入并合并备份<input aria-label="导入个人资料备份" type="file" accept=".json,application/json" onChange={e=>{restore(e.target.files?.[0]);e.target.value='';}}/></label></div></section></>;
  if(nav==='反馈'){
    const labels={draft:'未发送草稿',queued:'已提交，等待投递',sent:health?.local?'已写入管理员测试信箱':'已提交邮件服务',failed:'投递失败',local:'已写入管理员测试信箱'};
    return <section className="utility-panel"><h2>反馈</h2><p>{health?.feedback?(health.local?'提交后写入管理员测试信箱，不对外发信。':'提交后发送至站点管理员。'):'当前无法投递，填写后仅保存本机草稿。'}</p><form onSubmit={async e=>{e.preventDefault();if(!draft.trim()||sending)return;const item={id:Date.now(),date:localDay(),text:draft.trim(),status:'draft'};setSending(true);try{if(health?.feedback){const result=await api('/feedback',{method:'POST',data:{text:item.text,page:window.location.pathname+window.location.search}});item.status=['sent','local'].includes(result.status)?'sent':result.status;item.deliveryId=result.id;notify(item.status==='sent'?(health.local?'已写入管理员测试信箱。':'已提交邮件服务。'):'已提交，等待投递。');}else notify('当前无法投递，已保存为本机草稿。');}catch(err){notify(err.message+' 已保存为本机草稿。');}finally{setFeedback(v=>[item,...v]);setDraft('');setSending(false);}}}><label htmlFor="feedback-draft">问题或建议</label><textarea id="feedback-draft" required maxLength={5000} value={draft} onChange={e=>setDraft(e.target.value)} placeholder="描述遇到的问题、对应页面和期望行为"/><button disabled={!draft.trim()||sending}>{sending?'提交中…':health?.feedback?'发送反馈':'保存草稿'}</button></form>{feedback.map(f=><article className="feedback-item" key={f.id}><small>{f.date} · {labels[f.status]||'未发送草稿'}</small><p>{f.text}</p><Actions text={f.text} name={'反馈-'+f.id} notify={notify}/></article>)}</section>;
  }
  if(nav==='数据资产')return <section className="utility-panel"><h2>入库数据概览</h2><p>当前范围共 {rootEntries.length} 条，其中演示 {rootEntries.filter(e=>e.isDemo).length} 条。导出内容包含待复核记录。</p><div className="fields-grid">{SECTORS.map(s=><div className="stat-card" key={s}><strong>{rootEntries.filter(e=>e.sector===s).length}</strong><span>{s}</span></div>)}</div><div className="action-row"><button onClick={()=>downloadText(JSON.stringify(rootEntries.map(({revision,...e})=>e),null,2),'雷达入库数据.json','application/json')}>导出当前范围 JSON</button><button onClick={()=>downloadText(formatReport(rootEntries),'雷达入库资料.md')}>导出资料 Markdown</button></div><h3>数据质量</h3><p>公开日期未披露：{rootEntries.filter(e=>!publishedDay(e)).length} 条。</p></section>;
  if(nav==='更新日志')return <section className="utility-panel"><h2>本次功能更新</h2><ul><li>Agent 中心改版为四页：「Agent 接入」是公开的接入指南（Agent Skill、MCP、RSS、REST API v1 四条匿名只读路径，含安装提示词、工具列表与使用规则），「采集与信息源」「审核台」「情报与用户」保留原有运维面板。新增 /api/v1 匿名只读接口（公开池、热点榜、日/周/月报、采购公告、单条详情）、/api/mcp MCP 服务器（6 个工具）与 /llms.txt、Agent Skill 安装包；可见性与网站公开池一致，已驳回内容不可见，自动评分仍是假设不是核验。</li><li>Agent 流水线状态：Agent 中心顶部汇总自动采集、机器审核与自动翻译。未登录和普通账号只看公开健康检查，并提示登录管理员查看下次计划与补跑计数；管理员可看最近采集成败、模型名和上次补跑计数。</li><li>列表返回定位：在全部动态、今日精选、采购公告、热点榜、AI 日报、主题库等列表打开详情后，用页面返回按钮或浏览器后退都会回到离开时正在浏览的位置（按所点条目对齐），不再回到列表开头。</li><li>游客登录引导：登录页列出注册后可用的三件事（邮件订阅、账号同步、自有 Key 翻译）；侧栏、AI 日报与详情页提供订阅入口；游客收藏／关注后提示资料仅存本浏览器；未登录时的翻译提示改为「登录并配置自己 Key」的引导。所有引导登录后自动消失。</li><li>注册用户面板（仅管理员可见）：Agent 中心新增注册账号列表——邮箱、身份、注册时间、近一周活跃会话、是否已接入自己的翻译 Key；普通用户不显示该面板，接口同样仅管理员可访问。</li><li>大模型接入按账号隔离：每个登录用户在设置页保存自己的 API Key，文章翻译只消耗自己的额度，不再共用站长接口；站长的全局接口仅用于后台自动翻译与机器审核。未接入自己的接口时，翻译会提示先到设置页保存，而不是回落站长 Key。</li><li>AI 日报改版为日 / 周 / 月报告：左侧可切换日报、周报、月报并按月浏览往期（每期标注条数与当期最高分条目），右侧报头汇总本期条数、采集与核验状态，底部支持前后期翻页；归档口径仍为首次公开日期，未披露日期的条目不参与归档。</li><li>采购公告分道：新增「采购公告」视图，按招标窗口／中标落地／更正分组，行内显示采购人、公告类型与原文截取的金额、截止时间。</li><li>机器提取：机器整理同时从原文截取金额、截止时间与提及单位（模型改写或推测一律丢弃并回退规则版），详情页与审核台可见，均标注待复核。</li><li>观察名单界面化管理：Agent 中心可新增/移除观察单位，立即参与关键词计分；新买家发现按出现频率提示名单外高频单位，可一键填入。</li><li>覆盖盲区与信源产出：统计观察名单零命中单位与各来源的 P0/P1 贡献，用于决定扩源优先级；统计是机器口径，不是核验。</li><li>批量登记：登记线索支持逐行粘贴「链接｜标题｜来源｜日期｜观察单位｜摘录｜说明」，适合回填获奖名单、示范工程公示等历史清单；单条失败不影响其余。</li><li>招聘动作词计入评分：单位招聘 AI 相关岗位的新闻按高动作信号计分。</li><li>设置页新增大模型接入：选择供应商、粘贴 API Key、拉取模型列表即可启用；机器审核自动调用，输出保持待复核，可破冰与已核验仍需人工。</li><li>AI 销售价值预审：机器整理同时给出 0–100 销售价值分与三档判定，低价值线索自动归档（可在审核台恢复），审核台按销售价值排序，人工处理永远优先。</li><li>主题库自动归集：采集与登记记录按主题关键词自动归入对应专题，主题卡与详情区分为编辑归类与关键词自动匹配（自动匹配不代表企业参与）。</li><li>领域扩展至交通、水利、电力、石化、新能源、施工六大方向：筛选、审核、通知与数据统计全部同步。</li><li>自动评分不是核验，也不是实时热度；未做网页全文抓取或机构级订阅。</li><li>隔离演示数据；核验、量化效果和来源均需可追溯记录。</li></ul></section>;
  return <section className="utility-panel"><h2>关于土木 AI 雷达</h2><p>帮助工程人员发现、整理并追踪土木与人工智能交叉领域的信息。</p><h3>如何使用</h3><ol><li>检索或筛选工程领域，查看事件摘要与原始出处。</li><li>区分预告、研究、试点和已部署；阅读核验状态。</li><li>收藏后分组写笔记，关注后在新批次中查看变化。</li><li>按日期导出日报，或备份个人资料。</li></ol><h3>来源与证据</h3><p>待复核条目尚缺完整核验记录。演示数据不作为事实引用；工程启示为编辑分析或自动评分理由。</p><h3>当前能力边界</h3><p>采集、账号同步与邮件见对应页面。今日精选与热点榜按销售价值自动评分，不是实时热度，也不等于已核验。关注绑定具体条目，不自动订阅同一机构的新事件。采集保留订阅源正文或摘要，不抓取网页全文。</p></section>;
}
