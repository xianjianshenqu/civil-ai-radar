import {useEffect, useMemo, useState} from 'react';
import {api} from '../services/api.js';
import {downloadText} from '../lib/radar.js';
import {useWatchOrgs} from '../services/useWatchOrgs.js';
import {formatSalesLine, offeringLabel, WATCH_LAYERS} from '../data/orgWatchlist.js';

const layerLabel = id => WATCH_LAYERS.find(l => l.id === id)?.label || id;
const statusNames = {pending: '待复核', approved: '已发布', archived: '已归档', rejected: '已驳回'};
const recordOrigin = a => a.dataOrigin === 'manual' ? '登记' : a.procurement ? '政采' : a.academic ? '论文' : a.dataOrigin === 'collector' ? '采集' : '入库';
const dayOf = a => (typeof a.publishedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.publishedDate) ? a.publishedDate : '');
const byRecency = (a, b) => (dayOf(b) || '').localeCompare(dayOf(a) || '') || (b.firstSeenAt || '').localeCompare(a.firstSeenAt || '');

function RecordRow({item, extraOrgs = []}) {
  const {article, status} = item;
  return <li className="org-record-row">
    <div className="org-record-main">
      <a href={'/detail/' + encodeURIComponent(article.id)} target="_blank" rel="noreferrer">{article.title}</a>
      <p>
        <span className="origin-chip collected">{recordOrigin(article)}</span>
        <span className={`review-priority p-${article.assistScore?.priority || 'P3'}`}>{article.assistScore?.priority || '—'}</span>
        {' '}{statusNames[status] || status} · {dayOf(article) || '日期未披露'} · {article.source}
        {article.procurement?.buyer ? ` · 采购人：${article.procurement.buyer}` : ''}
        {article.procurement?.noticeType ? ` · ${article.procurement.noticeType}` : ''}
      </p>
      {formatSalesLine(article.editorial, extraOrgs) && <p className="review-sales-line">{formatSalesLine(article.editorial, extraOrgs)}</p>}
    </div>
    <a href={article.sourceUrl} target="_blank" rel="noreferrer">原文</a>
  </li>;
}

export function OrgDossier({cloud}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [layer, setLayer] = useState('all');
  const [q, setQ] = useState('');
  const [orgId, setOrgId] = useState('');
  const {orgs: watchOrgs} = useWatchOrgs(cloud);
  const orgById = useMemo(() => Object.fromEntries(watchOrgs.map(o => [o.id, o])), [watchOrgs]);
  const extraOrgs = useMemo(() => watchOrgs.filter(o => o.id.startsWith('x-')), [watchOrgs]);
  useEffect(() => {
    if (!open || !cloud.user?.isAdmin || rows) return;
    api('/review/articles?status=all').then(data => setRows(data.articles)).catch(e => setError(e.message));
  }, [open, cloud.user?.isAdmin, rows]);

  const stats = useMemo(() => {
    const map = new Map(watchOrgs.map(o => [o.id, {tagged: [], matched: [], last: ''}]));
    for (const item of rows || []) {
      if (item.status === 'rejected') continue;
      const article = item.article;
      const taggedId = article.editorial?.watchOrgId;
      const hit = new Set();
      if (taggedId && map.has(taggedId)) hit.add(taggedId);
      for (const w of article.assistScore?.watchOrgs || []) if (map.has(w.id)) hit.add(w.id);
      for (const id of hit) {
        const bucket = map.get(id);
        if (id === taggedId) bucket.tagged.push(item); else bucket.matched.push(item);
        const day = dayOf(article);
        if (day && day > bucket.last) bucket.last = day;
      }
    }
    return map;
  }, [rows, watchOrgs]);

  if (!cloud.user?.isAdmin) return null;
  const org = orgId ? orgById[orgId] : null;
  const selected = orgId ? stats.get(orgId) : null;
  const filtered = watchOrgs.filter(o => (layer === 'all' || o.layer === layer) && (!q.trim() || o.name.includes(q.trim()) || o.aliases?.some(a => a.includes(q.trim()))));
  const exportOrg = () => {
    if (!org || !selected) return;
    const lines = [
      `# 单位档案 · ${org.name}`,
      `${layerLabel(org.layer)} · ${org.buyerRole} · ${org.isBuyer ? '买家单位' : '非买家（市场观察）'}`,
      `主推切口：${org.offerings.map(offeringLabel).join('、')}${org.secondary.length ? `；次要：${org.secondary.map(offeringLabel).join('、')}` : ''}`,
      '',
      `以下为站点内部档案；关键词命中只是评分线索，不等于该单位参与。`,
      `## 人工确认关联（${selected.tagged.length}）`,
      ...selected.tagged.map(({article}) => `- [${dayOf(article) || '日期未披露'}] ${article.title}（${recordOrigin(article)}） ${article.sourceUrl}`),
      '',
      `## 关键词命中（${selected.matched.length}，待回链确认）`,
      ...selected.matched.map(({article}) => `- [${dayOf(article) || '日期未披露'}] ${article.title}（${recordOrigin(article)}） ${article.sourceUrl}`),
    ];
    downloadText(lines.join('\n'), `单位档案-${org.name}.md`);
  };
  return <section className="org-dossier">
    <h2>观察单位档案</h2>
    <p>按单位聚合政采、论文、订阅与人工登记线索。人工确认关联是编辑判断；关键词命中只是评分线索，不等于该单位参与。</p>
    {!open ? <button type="button" onClick={()=>setOpen(true)}>打开单位档案</button> : error ? <div role="alert" className="batch-notice">{error}</div> : !rows ? <p>正在载入档案…</p> : <>
      <div className="review-sales-filters">
        <label>单位类型<select value={layer} onChange={e=>setLayer(e.target.value)}>
          <option value="all">全部</option>
          {WATCH_LAYERS.map(l=><option key={l.id} value={l.id}>{l.label}</option>)}
        </select></label>
        <label>搜索单位<input placeholder="单位名称或别名" value={q} onChange={e=>setQ(e.target.value)}/></label>
      </div>
      <div className="org-dossier-layout">
        <div className="org-list">
          {WATCH_LAYERS.filter(l => layer === 'all' || l.id === layer).map(l => {
            const items = filtered.filter(o => o.layer === l.id);
            if (!items.length) return null;
            return <div key={l.id}><h3>{l.label}</h3>{items.map(o => {
              const s = stats.get(o.id);
              return <button type="button" key={o.id} className={'org-card' + (orgId === o.id ? ' selected' : '')} onClick={()=>setOrgId(o.id)}>
                <strong>{o.name}</strong>
                <span>{s.tagged.length + s.matched.length ? `${s.tagged.length + s.matched.length} 条记录${s.last ? ` · 最近 ${s.last}` : ''}` : '尚无记录'}</span>
                {!o.isBuyer && <small>非买家</small>}
              </button>;
            })}</div>;
          })}
        </div>
        {org && selected ? <div className="org-detail">
          <div className="org-detail-head">
            <div>
              <h3>{org.name}</h3>
              <p>{layerLabel(org.layer)} · {org.buyerRole} · {org.isBuyer ? '买家单位' : '非买家（市场观察）'}</p>
              <p>主推切口：{org.offerings.map(offeringLabel).join('、')}{org.secondary.length ? `；次要：${org.secondary.map(offeringLabel).join('、')}` : ''}</p>
            </div>
            <div className="action-row"><button type="button" onClick={exportOrg}>导出拜访简报</button><button type="button" onClick={()=>setOrgId('')}>收起</button></div>
          </div>
          <h4>人工确认关联 · {selected.tagged.length} 条</h4>
          {selected.tagged.length ? <ul className="org-record-list">{selected.tagged.slice().sort((a,b)=>byRecency(a.article,b.article)).map(item=><RecordRow key={item.article.id} item={item} extraOrgs={extraOrgs}/>)}</ul> : <p>尚无人工确认关联。可在审核条目上指定观察单位后在此汇总。</p>}
          <h4>关键词命中 · {selected.matched.length} 条 · 待回链确认</h4>
          {selected.matched.length ? <ul className="org-record-list">{selected.matched.slice().sort((a,b)=>byRecency(a.article,b.article)).map(item=><RecordRow key={item.article.id} item={item} extraOrgs={extraOrgs}/>)}</ul> : <p>暂无关键词命中记录。</p>}
        </div> : <p className="org-detail-empty">选择左侧单位查看档案。</p>}
      </div>
    </>}
  </section>;
}
