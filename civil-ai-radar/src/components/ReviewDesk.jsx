import {useEffect,useState} from 'react';
import {api} from '../services/api.js';
import {SOURCE_TIER_LABELS} from '../lib/scoring.js';
import {SECTORS} from '../lib/topicMatch.js';
import {useWatchOrgs} from '../services/useWatchOrgs.js';
import {BUYER_ROLES, OFFERING_OPTIONS, PRODUCT_OFFERINGS, SALES_STAGES, WATCH_LAYERS, formatSalesLine} from '../data/orgWatchlist.js';

const splitParagraphs = (value) => value.split(/\n\s*\n/).map(p=>p.trim()).filter(Boolean);
const joinParagraphs = (list) => Array.isArray(list) ? list.join('\n\n') : '';
const tierLabel = (article) => SOURCE_TIER_LABELS[article.sourceTier] || SOURCE_TIER_LABELS.t2;

function formFrom(item, reviewer) {
  const ed = item.editorial || {};
  const record = ed.verificationRecord;
  return {
    status: ed.status || 'pending',
    featuredRank: ed.featuredRank || '',
    topicIds: ed.topicIds || item.topicIds || [],
    sector: ed.sector || item.sector,
    scope: ed.scope || item.scope,
    region: ed.region || item.region,
    maturity: ed.maturity || item.maturity,
    layer: ed.layer || item.layer,
    engineeringStage: ed.engineeringStage || item.engineeringStage || '待判断',
    ai: ed.ai || item.ai,
    summary: ed.summary ?? item.summary ?? '',
    implication: ed.implication && !ed.implication.startsWith('待编辑') ? ed.implication : '',
    notes: ed.notes || '',
    reviewer: ed.reviewer || reviewer,
    offerings: ed.offerings || [],
    buyerRole: ed.buyerRole || '未知',
    salesStage: ed.salesStage || '待判断',
    watchOrgId: ed.watchOrgId || '',
    zh: joinParagraphs(ed.reading?.paragraphs?.zh),
    en: joinParagraphs(ed.reading?.paragraphs?.en),
    verify: !!record,
    checkedAt: record?.checkedAt?.slice(0,16) || new Date().toISOString().slice(0,16),
    verifyReviewer: record?.reviewer || reviewer,
    verifyNotes: record?.notes || '',
    references: record?.references?.length ? record.references.map(r=>({title:r.title,url:r.url})) : [{title:'',url:''}],
  };
}

function toggleOffering(current, id) {
  if (id === '不相关') return current.includes('不相关') ? [] : ['不相关'];
  const next = current.filter(item => item !== '不相关');
  return next.includes(id) ? next.filter(item => item !== id) : [...next, id];
}

const emptyIntake = {sourceUrl:'', title:'', sourceLabel:'', sector:'', quote:'', note:'', watchOrgId:'', publishedDate:''};

// 批量登记解析：每行一条，竖线分隔「链接｜标题｜来源｜日期｜观察单位全称｜摘录｜说明」，仅前两段必填。
function parseBatchLines(text, orgs) {
  return String(text || '').split(/\n+/).map(line => line.trim()).filter(Boolean).map((line, index) => {
    const parts = line.split(/[｜|]/).map(p => p.trim());
    const [sourceUrl, title, sourceLabel, publishedDate, watchOrgName, quote, note] = parts;
    if (!/^https?:\/\//.test(sourceUrl || '')) return {index, error: '第 ' + (index + 1) + ' 行缺少 http(s) 开头的链接。'};
    if (!title) return {index, error: '第 ' + (index + 1) + ' 行缺少标题。'};
    const org = watchOrgName ? orgs.find(o => o.name === watchOrgName || (o.aliases || []).includes(watchOrgName)) : null;
    const item = {sourceUrl, title, ...(sourceLabel ? {sourceLabel} : {}), ...(publishedDate ? {publishedDate} : {}), ...(quote ? {quote} : {}), ...(note ? {note} : {}), ...(org ? {watchOrgId: org.id} : {})};
    return {index, item, orgMiss: Boolean(watchOrgName) && !org};
  });
}

function IntakeForm({onDone, orgs}) {
  const [mode,setMode]=useState('single');
  const [form,setForm]=useState(emptyIntake);
  const [batchText,setBatchText]=useState('');
  const [results,setResults]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const batchItems=parseBatchLines(batchText, orgs);
  async function submit(e) {
    e.preventDefault();
    if(busy)return;
    setBusy(true);setError('');setMessage('');
    try {
      await api('/intake',{method:'POST',data:form});
      setMessage('已登记为待复核线索，可在下方列表和单位档案中查看。');
      setForm(emptyIntake);
      onDone?.();
    } catch(err){setError(err.message);}
    finally{setBusy(false);}
  }
  async function submitBatch(e) {
    e.preventDefault();
    if(busy)return;
    const items=batchItems.filter(x=>x.item).map(x=>x.item);
    if(!items.length){setError('请先按格式粘贴至少一条线索。');return;}
    setBusy(true);setError('');setMessage('');setResults(null);
    try {
      const data=await api('/intake',{method:'POST',data:{items}});
      setResults(data.results);
      const ok=data.results.filter(r=>r.ok).length;
      setMessage(`批量登记完成：成功 ${ok} 条，失败 ${data.results.length-ok} 条。`);
      if(ok){setBatchText('');onDone?.();}
    } catch(err){setError(err.message);}
    finally{setBusy(false);}
  }
  return <details className="intake-panel">
    <summary>登记线索 · 微信公众号、单位官网等无订阅源渠道</summary>
    <div className="review-tabs">
      <button type="button" aria-pressed={mode==='single'} className={mode==='single'?'selected':''} onClick={()=>setMode('single')}>单条登记</button>
      <button type="button" aria-pressed={mode==='batch'} className={mode==='batch'?'selected':''} onClick={()=>setMode('batch')}>批量粘贴</button>
    </div>
    <p className="intake-note">系统不抓取网页，只保存你填写的链接、标题、摘录和说明；登记即进入待复核，不代表已核验。</p>
    {error&&<div role="alert" className="batch-notice">{error}</div>}
    {message&&<div role="status" className="batch-notice">{message}</div>}
    {mode==='single'?<form onSubmit={submit}>
      <div className="fields-grid">
        <label>原文链接（必填）<input type="url" required placeholder="https://mp.weixin.qq.com/s/…" value={form.sourceUrl} onChange={e=>setForm(s=>({...s,sourceUrl:e.target.value}))}/></label>
        <label>线索标题（必填）<input required maxLength={300} value={form.title} onChange={e=>setForm(s=>({...s,title:e.target.value}))}/></label>
        <label>来源名称（可空，如：中建三局公众号）<input maxLength={80} value={form.sourceLabel} onChange={e=>setForm(s=>({...s,sourceLabel:e.target.value}))}/></label>
        <label>领域（可空，默认按内容推断）<select value={form.sector} onChange={e=>setForm(s=>({...s,sector:e.target.value}))}>
          <option value="">自动推断</option>
          {SECTORS.map(v=><option key={v} value={v}>{v}</option>)}
        </select></label>
        <label>公开日期（可空）<input type="date" value={form.publishedDate} onChange={e=>setForm(s=>({...s,publishedDate:e.target.value}))}/></label>
        <label>观察单位（原文未点名则留空）<select value={form.watchOrgId} onChange={e=>setForm(s=>({...s,watchOrgId:e.target.value}))}>
          <option value="">未指定</option>
          {WATCH_LAYERS.map(layer=><optgroup key={layer.id} label={layer.label}>{orgs.filter(item=>item.layer===layer.id).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>)}
        </select></label>
      </div>
      <label>原文摘录（可空，建议保留关键句）<textarea maxLength={2000} value={form.quote} onChange={e=>setForm(s=>({...s,quote:e.target.value}))}/></label>
      <label>登记说明（背景、口径、下一步）<textarea maxLength={2000} value={form.note} onChange={e=>setForm(s=>({...s,note:e.target.value}))}/></label>
      <button disabled={busy}>{busy?'登记中…':'登记待复核线索'}</button>
    </form>:<form onSubmit={submitBatch}>
      <p className="intake-note">每行一条，用「｜」分隔：<code>链接｜标题｜来源｜日期｜观察单位全称｜摘录｜说明</code>；只有链接和标题必填，观察单位需与名单全称一致。适合回填获奖名单、示范工程公示等历史清单。</p>
      <textarea rows={8} placeholder={'https://mp.weixin.qq.com/s/…｜某局智慧工地试点纪实｜某局公众号｜2026-09-10｜中建三局｜摘录关键句…｜…'} value={batchText} onChange={e=>setBatchText(e.target.value)}/>
      <p>{batchItems.length?`已识别 ${batchItems.filter(x=>x.item).length} 条有效行${batchItems.some(x=>x.orgMiss)?`，其中 ${batchItems.filter(x=>x.orgMiss).length} 行的观察单位未匹配名单（将不指定）`:''}。`:'粘贴后此处显示解析结果。'}</p>
      {batchItems.filter(x=>x.error).map(x=><p key={x.index} className="error-text">{x.error}</p>)}
      <button disabled={busy||!batchItems.some(x=>x.item)}>{busy?'登记中…':`登记 ${batchItems.filter(x=>x.item).length} 条待复核线索`}</button>
      {results&&<div className="batch-results"><strong>逐条结果</strong><ul>{results.map(r=><li key={r.index}>{r.ok?`✓ ${r.title}`:`✗ 第 ${r.index+1} 行：${r.error}`}</li>)}</ul></div>}
    </form>}
  </details>;
}

export function ReviewDesk({cloud,onChanged}) {
  const [status,setStatus]=useState('work');
  const [offeringFilter,setOfferingFilter]=useState('全部');
  const [stageFilter,setStageFilter]=useState('全部');
  const [data,setData]=useState(null);
  const [open,setOpen]=useState('');
  const [form,setForm]=useState(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [selected,setSelected]=useState(()=>new Set());
  const [batchResult,setBatchResult]=useState(null);
  const {orgs}=useWatchOrgs(cloud);
  const orgById=id=>orgs.find(item=>item.id===id);
  const extraOrgs=orgs.filter(item=>item.id.startsWith('x-'));
  const reviewer=cloud.user?.email || '';
  async function load(next=status) {
    try {setData(await api('/review/articles?status='+encodeURIComponent(next)));setError('');}
    catch(e){setError(e.message);}
  }
  useEffect(()=>{if(cloud.user?.isAdmin)load(status);},[cloud.user?.isAdmin,status]);
  function edit(item){setOpen(item.id);setForm(formFrom(item,reviewer));}
  function toggleSelect(id,checked){setSelected(prev=>{const next=new Set(prev);if(checked)next.add(id);else next.delete(id);return next;});}
  async function batchRun(action) {
    const ids=[...selected];
    if(!ids.length||busy)return;
    const label=action==='approved'?'批量发布':'批量驳回并隐藏';
    if(!window.confirm(`确定${label}选中的 ${ids.length} 条记录？批量发布只改人工审核状态，不写核验记录；驳回的记录从公开列表隐藏，可在已驳回栏恢复。`))return;
    setBusy(true);setError('');setBatchResult(null);
    try {
      const data=await api('/review/batch',{method:'POST',data:{ids,action}});
      setBatchResult(data.results);
      setSelected(new Set());
      await load(status);
      onChanged?.();
    } catch(e){setError(e.message);}
    finally{setBusy(false);}
  }
  function adoptMachine(article) {
    const m=article.machineReview;
    if(!m)return;
    setForm(s=>({
      ...s,
      summary:m.summary||s.summary,
      implication:m.implication||s.implication,
      offerings:m.offerings?.length?m.offerings:s.offerings,
      maturity:m.maturity||s.maturity,
      engineeringStage:m.engineeringStage||s.engineeringStage,
      salesStage:m.salesStage && m.salesStage!=='可破冰'?m.salesStage:s.salesStage,
    }));
  }
  // 事件合并只写 eventId、不改核验状态；词面相似建议必须经人工确认才能走到这里。
  async function mergeEvent(ids,clear) {
    if(!ids.length||busy)return;
    if(!clear&&!window.confirm('把选中的记录合并为同一事件？词面相似只是提示，请先确认确属同一项目/事件；合并只写事件组编号，不改核验状态。'))return;
    setBusy(true);setError('');
    try {
      await api('/review/event',{method:'POST',data:{ids,action:clear?'clear':'merge'}});
      await load(status);
      onChanged?.();
    } catch(e){setError(e.message);}
    finally{setBusy(false);}
  }
  async function save(nextStatus) {
    if(!form||!open)return;
    setBusy(true);setError('');
    try {
      const payload={id:open,status:nextStatus,reviewer:form.reviewer,notes:form.notes,featuredRank:form.featuredRank===''?null:Number(form.featuredRank),topicIds:form.topicIds,sector:form.sector,scope:form.scope,region:form.region,maturity:form.maturity,layer:form.layer,engineeringStage:form.engineeringStage,ai:form.ai,summary:form.summary,implication:form.implication,offerings:form.offerings,buyerRole:form.buyerRole,salesStage:form.salesStage,watchOrgId:form.watchOrgId};
      const zh=splitParagraphs(form.zh);
      if(zh.length)payload.reading={zh,en:splitParagraphs(form.en)};
      if(form.verify){
        const references=form.references.filter(r=>r.title.trim()&&r.url.trim());
        payload.verificationRecord={status:'verified',reviewer:form.verifyReviewer,checkedAt:form.checkedAt.length===16?form.checkedAt+':00+08:00':form.checkedAt,notes:form.verifyNotes,references};
      }
      await api('/review/article',{method:'PUT',data:payload});
      setOpen('');setForm(null);
      await load(status);
      onChanged?.();
    } catch(e){setError(e.message);}
    finally{setBusy(false);}
  }
  if(!cloud.user?.isAdmin)return null;
  const counts=data?.counts || {pending:0,approved:0,rejected:0,archived:0,work:0};
  const selectable=status==='work'||status==='pending';
  const batchFails=batchResult?batchResult.filter(r=>!r.ok):[];
  const hintOrg=form?orgById(form.watchOrgId):null;
  const visible=(data?.articles||[]).filter(({article})=>{
    const ed=article.editorial||{};
    if(offeringFilter==='未填' && (ed.offerings||[]).length)return false;
    if(offeringFilter!=='全部' && offeringFilter!=='未填' && !(ed.offerings||[]).includes(offeringFilter))return false;
    if(stageFilter!=='全部' && (ed.salesStage||'待判断')!==stageFilter)return false;
    return true;
  });
  return <div className="review-desk">
    <h2>编辑审核台</h2>
    <p>按 AI 销售价值排序（机器判定，销售假设，非核验）。低价值线索由 AI 预审自动归档，可在归档栏恢复；人工处理永远优先于机器分案。核验记录仍需回链原文。</p>
    <IntakeForm onDone={()=>load(status)} orgs={orgs}/>
    {error&&<div role="alert" className="batch-notice">{error}</div>}
    <div className="review-tabs">{[['work','待办'],['pending','待复核'],['archived','已归档'],['approved','已发布'],['rejected','已驳回']].map(([id,label])=>
      <button key={id} type="button" aria-pressed={status===id} className={status===id?'selected':''} onClick={()=>{setStatus(id);setOpen('');setSelected(new Set());setBatchResult(null);}}>{label} {counts[id]||0}</button>
    )}</div>
    <div className="review-sales-filters">
      <label>业务切口<select value={offeringFilter} onChange={e=>setOfferingFilter(e.target.value)}>
        <option>全部</option><option>未填</option>
        {PRODUCT_OFFERINGS.concat('不相关').map(id=><option key={id} value={id}>{id}</option>)}
      </select></label>
        <label>销售阶段<select value={stageFilter} onChange={e=>setStageFilter(e.target.value)}>
          <option>全部</option>
          {SALES_STAGES.map(id=><option key={id}>{id}</option>)}
        </select></label>
      </div>
      {selectable&&!!data?.articles?.length&&<div className="review-batch-bar">
        <label><input type="checkbox" checked={visible.length>0&&visible.every(({article})=>selected.has(article.id))} onChange={e=>setSelected(e.target.checked?new Set(visible.map(({article})=>article.id)):new Set())}/>全选{(offeringFilter!=='全部'||stageFilter!=='全部')?'（当前筛选结果）':''}</label>
        <span className="review-batch-count">已选 {selected.size} 条</span>
        <button type="button" disabled={busy||!selected.size} onClick={()=>batchRun('approved')}>批量发布</button>
        <button type="button" disabled={busy||!selected.size} onClick={()=>batchRun('rejected')}>批量驳回并隐藏</button>
      </div>}
      {batchResult&&<div role="status" className="batch-notice">批量操作完成：成功 {batchResult.length-batchFails.length} 条，失败 {batchFails.length} 条。{batchFails.length>0&&<ul>{batchFails.map(r=><li key={r.id||r.index}>✗ {r.title||r.id}：{r.error}</li>)}</ul>}</div>}
    {!data?.articles?.length?<p>{status==='work'?'没有 P0/P1 待办。P3 已归档，可在归档栏查看。':'这一栏暂无记录。'}</p>:!visible.length?<p>没有同时满足这两个销售标签的记录。</p>:visible.map(item=>{
      const article=item.article;
      const salesLine=formatSalesLine(article.editorial, extraOrgs);
      const priority=article.assistScore?.priority;
      const extracted=article.machineReview?.extracted;
      const extractedBits=extracted?[
        extracted.amounts?.length?`金额 ${extracted.amounts.join('、')}`:'',
        extracted.deadline?`截止 ${extracted.deadline}`:'',
        extracted.clientOrgs?.length?`提及单位 ${extracted.clientOrgs.join('、')}（待回链确认）`:'',
      ].filter(Boolean).join('；'):'';
      return (
      <article className="review-card" key={article.id}>
        <div className="review-card-head">
          {selectable&&<input type="checkbox" className="review-select" aria-label="选择此条批量处理" checked={selected.has(article.id)} onChange={e=>toggleSelect(article.id,e.target.checked)}/>}
          <div>
            <strong>{article.title}</strong>
            <p>{priority?<span className={`review-priority p-${priority}`}>{priority}</span>:null}{article.machineReview?.salesValue!=null&&<span className={'review-verdict v-'+({['重点跟进']:'high',['观察']:'mid',['低价值']:'low'}[article.machineReview.salesVerdict]||'mid')}>AI 销售价值 {article.machineReview.salesValue} · {article.machineReview.salesVerdict}</span>} {article.source} · {tierLabel(article)} · {article.sector} · {article.scope} · {article.publishedDate}{article.procurement?.noticeType?` · ${article.procurement.noticeType}`:''}</p>
            <p className="review-sales-line">{salesLine||'销售标签未填'}</p>
            {article.assistScore&&<p className="review-assist">{article.assistScore.suggestFeatured?'已达自动推荐线 · ':'未达自动推荐线 · '}{priority} · 销售分 {article.assistScore.total} · 前沿 {article.assistScore.frontier}（切口 {article.assistScore.dimensions.offering} · 买家 {article.assistScore.dimensions.buyer} · 动作 {article.assistScore.dimensions.action} · 信源 {article.assistScore.dimensions.source} · 时效 {article.assistScore.dimensions.freshness}）。{article.assistScore.reason}</p>}
            {article.machineReview?.implication&&<p className="review-machine">机器整理：{article.machineReview.implication}{article.machineReview.needsHuman?' · 需人工回链':''}</p>}
            {article.machineReview?.verdictReason&&<p className="review-verdict-reason">AI 分档理由：{article.machineReview.verdictReason}{article.machineReview.scoreCalls&&<span>（两次独立评分 {article.machineReview.scoreCalls.join('/')}）</span>}</p>}
            {extractedBits&&<p className="review-machine">机器提取（原文截取，待复核）：{extractedBits}。</p>}
            {item.eventHint?.length>0&&<p className="review-machine">疑似同一事件（词面相似，待人工确认）：{item.eventHint.map(h=><button type="button" key={h.id} className="link-btn" disabled={busy} onClick={()=>mergeEvent([article.id,h.id])}>{h.title}{h.publishedDate&&h.publishedDate!=='未披露'?`（${h.publishedDate}）`:''}（相似 {Math.round(h.score*100)}%）</button>)}</p>}
            {article.editorial?.eventId&&<p className="review-machine">已并入事件组 {article.editorial.eventId}（人工确认）<button type="button" className="link-btn" disabled={busy} onClick={()=>mergeEvent([article.id],true)}>解除</button></p>}
          </div>
          <a href={article.sourceUrl} target="_blank" rel="noreferrer">原文</a>
        </div>
        {open===article.id&&form?<form onSubmit={e=>{e.preventDefault();save(form.status);}}>
          <fieldset className="review-sales">
            <legend>销售标签</legend>
            <div className="fields-grid">
              <label>观察单位（原文未点名则留空）<select value={form.watchOrgId} onChange={e=>setForm(s=>({...s,watchOrgId:e.target.value}))}>
                <option value="">未指定</option>
                {WATCH_LAYERS.map(layer=><optgroup key={layer.id} label={layer.label}>{orgs.filter(item=>item.layer===layer.id).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>)}
              </select></label>
              <label>买家角色<select value={form.buyerRole} onChange={e=>setForm(s=>({...s,buyerRole:e.target.value}))}>{BUYER_ROLES.map(id=><option key={id}>{id}</option>)}</select></label>
              <label>销售阶段<select value={form.salesStage} onChange={e=>setForm(s=>({...s,salesStage:e.target.value}))}>{SALES_STAGES.map(id=><option key={id}>{id}</option>)}</select></label>
            </div>
            <fieldset><legend>业务切口</legend>{OFFERING_OPTIONS.map(item=>
              <label key={item.id}><input type="checkbox" checked={form.offerings.includes(item.id)} onChange={()=>setForm(s=>({...s,offerings:toggleOffering(s.offerings,item.id)}))}/>{item.id}<span> {item.label}</span></label>
            )}</fieldset>
            {hintOrg&&<p className="review-sales-hint">该单位观察切口：主推 {hintOrg.offerings.join('、')}{hintOrg.secondary.length?`；次要 ${hintOrg.secondary.join('、')}`:''}。建议角色 {hintOrg.buyerRole}。{hintOrg.isBuyer?'':'不是买家，不要标可破冰。'}采集器不会代填。</p>}
            {hintOrg&&<button type="button" onClick={()=>setForm(s=>({...s,offerings:hintOrg.offerings,buyerRole:hintOrg.buyerRole,salesStage:hintOrg.isBuyer?s.salesStage:'仅市场观察'}))}>采用该单位主推切口</button>}
          </fieldset>
          <div className="fields-grid">
            <label>领域<select value={form.sector} onChange={e=>setForm(s=>({...s,sector:e.target.value}))}>{SECTORS.map(v=><option key={v}>{v}</option>)}</select></label>
            <label>范围<select value={form.scope} onChange={e=>setForm(s=>({...s,scope:e.target.value}))}>{['国内','海外'].map(v=><option key={v}>{v}</option>)}</select></label>
            <label>地区<input value={form.region} onChange={e=>setForm(s=>({...s,region:e.target.value}))}/></label>
            <label>成熟度<select value={form.maturity} onChange={e=>setForm(s=>({...s,maturity:e.target.value}))}>{['待判断','预告','研究','试点','已部署','已发布'].map(v=><option key={v}>{v}</option>)}</select></label>
            <label>类型<select value={form.layer} onChange={e=>setForm(s=>({...s,layer:e.target.value}))}>{['自动采集','项目落地','行业活动','研究'].map(v=><option key={v}>{v}</option>)}</select></label>
            <label>工程阶段<select value={form.engineeringStage} onChange={e=>setForm(s=>({...s,engineeringStage:e.target.value}))}>{['待判断','勘察设计','智慧施工','运行维护','防灾与水利','水利数字孪生'].map(v=><option key={v}>{v}</option>)}</select></label>
            <label>精选排序（可空；留空则按销售价值自动排序，填入后仅作为置顶参考）<input type="number" min="1" max="20" value={form.featuredRank} onChange={e=>setForm(s=>({...s,featuredRank:e.target.value}))}/></label>
            <label>技术方向<input value={form.ai} onChange={e=>setForm(s=>({...s,ai:e.target.value}))}/></label>
          </div>
          <label>摘要<textarea value={form.summary} onChange={e=>setForm(s=>({...s,summary:e.target.value}))}/></label>
          <label>工程启示<textarea value={form.implication} onChange={e=>setForm(s=>({...s,implication:e.target.value}))}/></label>
          {article.machineReview?.status==='ready'&&<button type="button" onClick={()=>adoptMachine(article)}>采用机器导读</button>}
          <fieldset><legend>主题</legend>{(data.topics||[]).map(t=><label key={t.id}><input type="checkbox" checked={form.topicIds.includes(t.id)} onChange={e=>setForm(s=>({...s,topicIds:e.target.checked?[...s.topicIds,t.id]:s.topicIds.filter(id=>id!==t.id)}))}/>{t.name}</label>)}</fieldset>
          <label>中文整理稿（空行分段）<textarea value={form.zh} onChange={e=>setForm(s=>({...s,zh:e.target.value}))}/></label>
          <label>英文对照（可空，段数需一致）<textarea value={form.en} onChange={e=>setForm(s=>({...s,en:e.target.value}))}/></label>
          <label><input type="checkbox" checked={form.verify} onChange={e=>setForm(s=>({...s,verify:e.target.checked}))}/>写入完整核验记录（将显示为已核验）</label>
          {form.verify&&<>
            <label>核验人<input value={form.verifyReviewer} onChange={e=>setForm(s=>({...s,verifyReviewer:e.target.value}))}/></label>
            <label>核验时间<input type="datetime-local" value={form.checkedAt} onChange={e=>setForm(s=>({...s,checkedAt:e.target.value}))}/></label>
            <label>核验说明<textarea value={form.verifyNotes} onChange={e=>setForm(s=>({...s,verifyNotes:e.target.value}))}/></label>
            {form.references.map((r,i)=><div className="fields-grid" key={i}>
              <label>证据标题<input value={r.title} onChange={e=>setForm(s=>({...s,references:s.references.map((x,n)=>n===i?{...x,title:e.target.value}:x)}))}/></label>
              <label>证据链接<input value={r.url} onChange={e=>setForm(s=>({...s,references:s.references.map((x,n)=>n===i?{...x,url:e.target.value}:x)}))}/></label>
            </div>)}
            <button type="button" onClick={()=>setForm(s=>({...s,references:[...s.references,{title:'',url:''}]}))}>增加证据</button>
          </>}
          <label>内部备注<textarea value={form.notes} onChange={e=>setForm(s=>({...s,notes:e.target.value}))}/></label>
          <div className="action-row">
            <button type="button" disabled={busy} onClick={()=>save('pending')}>保存为待复核</button>
            <button type="button" disabled={busy} onClick={()=>save('archived')}>归档观察</button>
            <button type="button" disabled={busy} onClick={()=>save('approved')}>发布</button>
            <button type="button" disabled={busy} onClick={()=>save('rejected')}>驳回并隐藏</button>
            <button type="button" onClick={()=>{setOpen('');setForm(null);}}>取消</button>
          </div>
        </form>:<button type="button" onClick={()=>edit(article)}>审核此条</button>}
      </article>
      );
    })}
  </div>;
}
