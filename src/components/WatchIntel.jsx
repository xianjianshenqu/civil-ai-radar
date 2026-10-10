import {useState} from 'react';
import {api} from '../services/api.js';
import {useWatchOrgs} from '../services/useWatchOrgs.js';
import {BUYER_ROLES, OFFERING_OPTIONS, PRODUCT_OFFERINGS, WATCH_LAYERS} from '../data/orgWatchlist.js';

const layerLabel = id => WATCH_LAYERS.find(l => l.id === id)?.label || id;
const emptyAdd = {name: '', aliases: '', layer: 'unit', isBuyer: true, offerings: [], buyerRole: '工程局'};

// 观察名单与情报分析（管理端）：名单界面化管理、新买家发现、覆盖盲区、信源产出。
// 全部是代码统计与假设线索：关键词频率、命中与评分都不代表单位参与或采购。
export function WatchIntel({cloud}) {
  const admin = Boolean(cloud.user?.isAdmin);
  const {orgs, add, remove} = useWatchOrgs(cloud);
  const [form, setForm] = useState(emptyAdd);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [discoveryDays, setDiscoveryDays] = useState(30);
  const [discovery, setDiscovery] = useState(null);
  const [coverageDays, setCoverageDays] = useState(90);
  const [coverage, setCoverage] = useState(null);
  const [sources, setSources] = useState(null);
  if (!admin) return null;
  const extras = orgs.filter(o => o.id.startsWith('x-'));
  async function submitAdd(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await add({
        name: form.name,
        aliases: form.aliases.split(/[,，、\s]+/).filter(Boolean),
        layer: form.layer,
        isBuyer: form.isBuyer,
        offerings: form.offerings,
        buyerRole: form.buyerRole,
      });
      setMessage(`已加入观察名单：${form.name}。关键词命中立即参与评分，历史记录在下次读取时重新计分；命中仍不代表该单位参与。`);
      setForm(emptyAdd); setFormOpen(false);
    } catch (e2) { setError(e2.message); }
    finally { setBusy(false); }
  }
  async function loadAnalysis(kind) {
    setBusy(true); setError('');
    try {
      if (kind === 'discovery') setDiscovery(await api('/intel/discovery?days=' + discoveryDays));
      if (kind === 'coverage') setCoverage(await api('/intel/coverage?days=' + coverageDays));
      if (kind === 'sources') setSources(await api('/intel/sources'));
    } catch (e2) { setError(e2.message); }
    finally { setBusy(false); }
  }
  function adoptCandidate(name) {
    setForm({...emptyAdd, name});
    setFormOpen(true);
    setMessage('已填入候选单位。请核对全称与层级后保存；加入前建议回链确认其在公开信息中的标准名称。');
  }
  return <section className="utility-panel watch-intel">
    <h2>观察名单与情报分析</h2>
    <p>名单 {orgs.length} 家（界面新增 {extras.length} 家）。关键词命中与频率统计只是评分和发现线索，不代表单位参与或采购。</p>
    {message && <div role="status" className="batch-notice">{message}</div>}
    {error && <div role="alert" className="batch-notice">{error}</div>}
    <details className="intake-panel" open={formOpen}>
      <summary>新增观察单位</summary>
      <form onSubmit={submitAdd}>
        <div className="fields-grid">
          <label>单位全称（必填）<input required minLength={4} maxLength={40} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/></label>
          <label>别名（逗号分隔，可空）<input maxLength={120} placeholder="用于关键词命中，避免与既有单位重叠" value={form.aliases} onChange={e=>setForm(f=>({...f,aliases:e.target.value}))}/></label>
          <label>层级<select value={form.layer} onChange={e=>setForm(f=>({...f,layer:e.target.value}))}>{WATCH_LAYERS.map(l=><option key={l.id} value={l.id}>{l.label}</option>)}</select></label>
          <label>买家角色<select value={form.buyerRole} onChange={e=>setForm(f=>({...f,buyerRole:e.target.value}))}>{BUYER_ROLES.map(r=><option key={r}>{r}</option>)}</select></label>
        </div>
        <label><input type="checkbox" checked={form.isBuyer} onChange={e=>setForm(f=>({...f,isBuyer:e.target.checked}))}/>买家单位（非买家只做市场观察，不能标可破冰）</label>
        <fieldset><legend>主推切口（可空）</legend>{OFFERING_OPTIONS.filter(o=>PRODUCT_OFFERINGS.includes(o.id)).map(o=>
          <label key={o.id}><input type="checkbox" checked={form.offerings.includes(o.id)} onChange={e=>setForm(f=>({...f,offerings:e.target.checked?[...f.offerings,o.id]:f.offerings.filter(id=>id!==o.id)}))}/>{o.label}</label>
        )}</fieldset>
        <div className="action-row"><button disabled={busy}>{busy?'保存中…':'加入观察名单'}</button>{formOpen&&<button type="button" onClick={()=>{setFormOpen(false);setForm(emptyAdd);}}>收起</button>}</div>
      </form>
    </details>
    {extras.length > 0 && <div className="watch-extras">
      <h3>界面新增单位</h3>
      <ul>{extras.map(o=><li key={o.id}><strong>{o.name}</strong> · {layerLabel(o.layer)} · {o.isBuyer?'买家':'非买家'}{o.addedAt?` · ${o.addedAt.slice(0,10)} 加入`:''}<button type="button" disabled={busy} onClick={async()=>{try{await remove(o.id);setMessage('已移除：'+o.name+'。已保存的人工关联不受影响。');}catch(e2){setError(e2.message);}}}>移除</button></li>)}</ul>
    </div>}
    <details className="intake-panel">
      <summary>新买家发现 · 高频出现但不在名单上的单位</summary>
      <p className="intake-note">统计入库文本中的单位名出现频率；这是发现线索，需人工回链确认后再加入名单。</p>
      <div className="review-sales-filters">
        <label>统计窗口<select value={discoveryDays} onChange={e=>setDiscoveryDays(Number(e.target.value))}>{[30,60,90].map(d=><option key={d} value={d}>近 {d} 天</option>)}</select></label>
        <button type="button" disabled={busy} onClick={()=>loadAnalysis('discovery')}>生成分析</button>
      </div>
      {discovery && (discovery.candidates.length ? <table className="intel-table"><thead><tr><th>候选单位</th><th>出现记录</th><th>最近</th><th>样例</th><th></th></tr></thead><tbody>
        {discovery.candidates.map(c=><tr key={c.name}><td>{c.name}</td><td>{c.count} 条</td><td>{c.last||'未披露'}</td><td>{c.samples.map(s=><a key={s.id} href={'/detail/'+encodeURIComponent(s.id)} target="_blank" rel="noreferrer">{s.title.slice(0,18)}…</a>)}</td><td><button type="button" onClick={()=>adoptCandidate(c.name)}>加入观察</button></td></tr>)}
      </tbody></table> : <p>该窗口内没有出现 ≥{discovery.min} 次的未观察单位。</p>)}
    </details>
    <details className="intake-panel">
      <summary>覆盖盲区 · 观察名单零命中单位</summary>
      <p className="intake-note">按当前名单对入库文本重新匹配。零命中可能是单位安静，也可能是你的信源看不见它。</p>
      <div className="review-sales-filters">
        <label>统计窗口<select value={coverageDays} onChange={e=>setCoverageDays(Number(e.target.value))}>{[90,180,365].map(d=><option key={d} value={d}>近 {d} 天</option>)}</select></label>
        <button type="button" disabled={busy} onClick={()=>loadAnalysis('coverage')}>生成分析</button>
      </div>
      {coverage && <><p>{coverage.zeroCount} 家零命中 / 共 {coverage.orgs.length} 家。</p>
        <table className="intel-table"><thead><tr><th>单位</th><th>命中记录</th><th>最近</th></tr></thead><tbody>
          {coverage.orgs.slice(0, 20).map(o=><tr key={o.id}><td>{o.name}</td><td>{o.count?`${o.count} 条`:<strong>零命中</strong>}</td><td>{o.last||'—'}</td></tr>)}
        </tbody></table>{coverage.orgs.length>20&&<p>仅显示命中最少的前 20 家。</p>}</>}
    </details>
    <details className="intake-panel">
      <summary>信源产出 · 哪个来源在贡献 P0/P1 线索</summary>
      <p className="intake-note">基于机器评分快照统计，用于决定扩源优先级，不是核验结果。</p>
      <div className="review-sales-filters"><button type="button" disabled={busy} onClick={()=>loadAnalysis('sources')}>生成统计</button></div>
      {sources && <table className="intel-table"><thead><tr><th>来源</th><th>总数</th><th>P0/P1</th><th>已发布</th><th>归档</th></tr></thead><tbody>
        {sources.sources.map(s=><tr key={s.sourceId}><td>{s.source||s.sourceId}</td><td>{s.total}</td><td>{s.work}</td><td>{s.approved}</td><td>{s.archived}</td></tr>)}
      </tbody></table>}
    </details>
  </section>;
}
