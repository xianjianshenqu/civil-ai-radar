import {extractAmounts, NOTICE_CLASS_LABELS, deadlineUrgency, noticeClassOf, noticeDeadline, noticeDeadlineDate, salesHypothesisLabel, shanghaiToday, sortTenderNotices, URGENCY_LABELS} from '../lib/intel.js';

// 采购公告分道：招标公告=可行动窗口，中标/成交=落地事实，更正等单独观察。
// 摘要来自多家公开交易/采购平台的检索或栏目列表，不是公告全文；
// 中标只反映摘要里显示的结果，不构成核验。
const CLASS_ORDER = ['tender', 'result', 'other'];

function noticeChipClass(noticeClass) {
  if (noticeClass === 'tender') return 'notice-chip tender';
  if (noticeClass === 'result') return 'notice-chip result';
  return 'notice-chip other';
}

function ProcurementRow({item, onOpenDetail, today}) {
  const text = [item.title, item.summary, ...(item.reading?.paragraphs?.zh || [])].join('\n');
  const amounts = extractAmounts(text, 2);
  const deadline = noticeDeadline(item);
  const info = item.procurement || {};
  const noticeClass = noticeClassOf(item);
  const urgency = noticeClass === 'tender' ? deadlineUrgency(noticeDeadlineDate(item), today) : '';
  const hypothesis = salesHypothesisLabel(item);
  const sourceLabel = item.source || item.sourceId;
  const altSources = (info.sources || []).filter(s => s.sourceUrl && s.sourceUrl !== item.sourceUrl);
  return <li className="procurement-row" data-entry-id={item.id}>
    <div className="procurement-main">
      <button type="button" className="procurement-title" onClick={()=>onOpenDetail(item.id)}>{item.title}</button>
      <p>
        <span className={noticeChipClass(noticeClass)}>{NOTICE_CLASS_LABELS[noticeClass]}</span>
        {info.noticeType && <span className="origin-chip collected">{info.noticeType}</span>}
        {sourceLabel ? <span className="origin-chip collected">{sourceLabel}</span> : null}
        {altSources.length > 0 && <span>另见 {altSources.map(s => <a key={s.sourceUrl} href={s.sourceUrl} target="_blank" rel="noreferrer">{s.source}</a>)}</span>}
        {info.buyer && <span>采购人：{info.buyer}</span>}
        {info.region && <span> · {info.region}</span>}
        <span> · {item.publishedDate || '日期未披露'}</span>
        {item.assistScore?.priority && <span className={`review-priority p-${item.assistScore.priority}`}>{item.assistScore.priority}</span>}
        {hypothesis && <span className={`notice-chip sales-hypothesis v-${{['重点跟进']:'high',['观察']:'mid',['低价值']:'low'}[item.machineReview?.salesVerdict] || 'plain'}`} title="预审分档，未经人工核验">{hypothesis}</span>}
        {amounts.length > 0 && <span className="notice-extract"> · 原文金额：{amounts.join('、')}</span>}
        {deadline && <span className="notice-extract"> · 截止：{deadline}</span>}
        {urgency && <span className={`notice-chip urgency urgency-${urgency}`}>{URGENCY_LABELS[urgency]}</span>}
      </p>
    </div>
    <a href={item.sourceUrl} target="_blank" rel="noreferrer">原文</a>
  </li>;
}

export function ProcurementView({entries, notice, setNotice, onOpenDetail}) {
  const pool = entries.filter(e => e.procurement);
  const today = shanghaiToday();
  const tabs = [['全部', `全部 ${pool.length}`], ...CLASS_ORDER.map(key => [key, `${NOTICE_CLASS_LABELS[key]} ${pool.filter(e => noticeClassOf(e) === key).length}`])];
  const groups = notice === '全部' ? CLASS_ORDER : [notice];
  return <section className="procurement-view">
    <div className="time-tabs origin-tabs" role="tablist" aria-label="公告分道">
      {tabs.map(([key, label]) => <button key={key} aria-pressed={notice === key} className={notice === key ? 'selected' : ''} onClick={()=>setNotice(key)}>{label}</button>)}
    </div>
    <p className="intake-note">公告摘要来自多家公开交易与采购平台的检索或栏目列表（政采网、全国/深圳/广州公共资源等），不是公告全文；金额与截止时间为原文截取，需回链确认。</p>
    {!pool.length ? <div className="empty-state"><strong>当前筛选下没有采购公告</strong></div> : groups.map(group => {
      const rows = pool.filter(e => noticeClassOf(e) === group);
      if (!rows.length) return null;
      const ordered = group === 'tender' ? sortTenderNotices(rows) : rows;
      return <section className="daily-section" key={group}>
        <h2>{NOTICE_CLASS_LABELS[group]} <small>({ordered.length})</small></h2>
        <ul className="procurement-list">{ordered.map(e => <ProcurementRow key={e.id} item={e} today={today} onOpenDetail={onOpenDetail}/>)}</ul>
      </section>;
    })}
  </section>;
}
