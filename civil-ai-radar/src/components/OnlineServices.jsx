import {useEffect,useState} from 'react';
import {api} from '../services/api.js';
import {downloadText} from '../lib/radar.js';
import {RegisterBenefits} from './GuestGuide.jsx';
import {AgentPipelineCard} from './AgentPipelineCard.jsx';
import {AgentAccess} from './AgentAccess.jsx';
import {LazyPanel, lazyNamed} from './LazyPanel.jsx';
import {SECTORS} from '../lib/topicMatch.js';
import {SOURCE_TIER_LABELS} from '../lib/scoring.js';
// 审核台与情报视图只对管理员有内容，单独分包，访客和普通账号打开 Agent 中心时不下载。
const ReviewDesk = lazyNamed(() => import('./ReviewDesk.jsx'), 'ReviewDesk');
const WatchIntel = lazyNamed(() => import('./WatchIntel.jsx'), 'WatchIntel');
const OrgDossier = lazyNamed(() => import('./OrgDossier.jsx'), 'OrgDossier');
const formatTime=value=>value?new Date(value).toLocaleString('zh-CN'):'尚无记录';
const deliveryNames={local:'已写入本地测试信箱',sent:'邮件服务已接收',retry:'等待重试',pending:'等待投递',failed:'投递失败',sending:'正在投递',cancelled:'已取消'};
const kindNames={digest:'动态通知',test:'测试通知',feedback:'反馈投递'};
export function AccountPanel({cloud}) {
  const [health,setHealth]=useState(null),[email,setEmail]=useState(''),[challenge,setChallenge]=useState(null),[code,setCode]=useState('');
  const [message,setMessage]=useState(''),[busy,setBusy]=useState(false),[loginMail,setLoginMail]=useState(null);
  const [settings,setSettings]=useState(null),[history,setHistory]=useState([]),[mailbox,setMailbox]=useState([]);
  async function refresh(){try{const h=await api('/health');setHealth(h);if(cloud.user){setSettings(await api('/notifications'));setHistory((await api('/notifications/history')).messages);if(h.mailMode==='local')setMailbox((await api('/dev/mailbox')).messages);}}catch(error){setMessage(error.message);}}
  useEffect(()=>{setSettings(null);setHistory([]);setMailbox([]);refresh();},[cloud.user?.id]);
  async function act(fn){setBusy(true);setMessage('');try{await fn();}catch(error){setMessage(error.message);}finally{setBusy(false);}}
  return <section className="utility-panel online-services"><h2>{cloud.user?'账号与通知':'登录'}</h2>
    <p>{cloud.user?'资料同步与邮件通知。':'用邮箱收取验证码后进入；注册即登录，同一邮箱下次直接续用。'}</p>
    {health?.mailMode==='local'&&<div className="batch-notice">本地测试：邮件不对外发送。使用 name@example.test；管理员为 admin@example.test。</div>}
    {message&&<div role="status" className="batch-notice">{message}</div>}
    {!cloud.user?<div><RegisterBenefits/><form onSubmit={e=>{e.preventDefault();act(async()=>{const result=await api('/auth/request',{method:'POST',data:{email}});setChallenge(result);setCode('');setLoginMail(null);setMessage(result.local?'验证码已进入本地测试信箱。':'验证码已提交邮件服务，请查收。');});}}><label htmlFor="account-email">邮箱</label><input id="account-email" type="email" autoComplete="email" required placeholder={health?.mailMode==='local'?'admin@example.test':'name@company.com'} value={email} onChange={e=>setEmail(e.target.value)}/><button disabled={busy}>获取验证码</button></form>
      {challenge&&<form onSubmit={e=>{e.preventDefault();act(async()=>{await cloud.verify(challenge.challengeId,code);setChallenge(null);setLoginMail(null);setMessage('登录成功。');});}}><label htmlFor="account-code">6 位验证码</label><input id="account-code" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" maxLength={6} value={code} onChange={e=>setCode(e.target.value)}/><button disabled={busy}>验证并登录</button>
        {challenge.local&&<button type="button" onClick={()=>act(async()=>setLoginMail(await api('/dev/login-mail?challengeId='+encodeURIComponent(challenge.challengeId))))}>打开本地验证码邮件</button>}{loginMail&&<pre className="mail-preview">{loginMail.text}</pre>}</form>}
    </div>:<div><div className="management-tools"><strong>{cloud.user.email}{cloud.user.isAdmin?' · 管理员':''}</strong><span role="status">{cloud.status}</span><button disabled={busy||cloud.dirty} onClick={()=>act(()=>cloud.logout())}>退出账号</button></div>
      <div className="action-row"><button onClick={()=>{cloud.importGuest();setMessage('已将未登录资料合并到当前账号，等待同步。');}}>导入本机离线资料</button><button onClick={cloud.retry}>重试同步</button><button onClick={()=>downloadText(JSON.stringify(cloud.document,null,2),'账号资料备份.json','application/json')}>导出当前资料</button></div>
      {cloud.conflict&&<div className="batch-notice" role="alert"><p>另一设备修改了资料。当前本机更改仍保留，请选择处理方式；可先导出备份。</p><button onClick={()=>cloud.resolveConflict('remote')}>使用服务器版本</button><button onClick={()=>cloud.resolveConflict('local')}>用本机版本覆盖服务器</button></div>}
      {settings&&<form onSubmit={e=>{e.preventDefault();act(async()=>{setSettings(await api('/notifications',{method:'PUT',data:settings}));setMessage('通知偏好已保存。启用后仅通知此后的新增或更新线索。');await refresh();});}}><h2>邮件通知</h2><label><input type="checkbox" checked={settings.enabled} onChange={e=>setSettings(s=>({...s,enabled:e.target.checked}))}/>订阅新增／更新线索邮件</label><label>发送频率<select value={settings.frequency} onChange={e=>setSettings(s=>({...s,frequency:e.target.value}))}><option value="hourly">最多每小时一次</option><option value="daily">最多每天一次</option></select></label><fieldset><legend>关注领域（不选表示全部）</legend>{SECTORS.map(sector=><label key={sector}><input type="checkbox" checked={settings.sectors.includes(sector)} onChange={e=>setSettings(s=>({...s,sectors:e.target.checked?[...s.sectors,sector]:s.sectors.filter(x=>x!==sector)}))}/>{sector}</label>)}</fieldset><label>标题关键词<input maxLength={100} value={settings.keyword} onChange={e=>setSettings(s=>({...s,keyword:e.target.value}))} placeholder="可选，例如：BIM"/></label><button disabled={busy}>保存通知偏好</button></form>}
      <div className="action-row"><button disabled={busy} onClick={()=>act(async()=>{const result=await api('/notifications/test',{method:'POST',data:{}});setMessage(deliveryNames[result.status]||result.status);await refresh();})}>发送测试通知到本人邮箱</button><button disabled={busy} onClick={()=>act(refresh)}>刷新投递记录</button></div>
      <h3>最近投递记录</h3>{history.length?<ul>{history.map(m=><li key={m.id}>{formatTime(m.created_at)} · {kindNames[m.kind]||m.kind} · {deliveryNames[m.status]||m.status}{m.error&&<span> · {m.error}</span>}{['retry','failed'].includes(m.status)&&<button onClick={()=>act(async()=>{await api('/notifications/retry',{method:'POST',data:{id:m.id}});await refresh();})}>重试</button>}</li>)}</ul>:<p>暂无投递记录。</p>}
      {health?.mailMode==='local'&&<div><h3>本地通知测试信箱</h3>{mailbox.map(m=><details key={m.id}><summary>{m.subject} · {formatTime(m.created_at)}</summary><pre className="mail-preview">{m.text}</pre></details>)}</div>}
    </div>}
    {cloud.error&&<div className="batch-notice" role="alert">{cloud.error}<button onClick={cloud.reload}>重新连接</button></div>}
  </section>;
}
const modelSourceNames={settings:'界面设置',env:'环境变量',none:'未配置'};
// 供应商预设只负责预填 OpenAI 兼容地址和控制台入口；模型列表由后台实时拉取，不内置模型名。
// 控制台链接 2026-09-19 逐个核实：Z.ai 旧 /manage/apikey 已 404，Kimi/MiniMax 已迁移新域名，OpenAI 需国际网络。
const MODEL_PROVIDERS=[
  {id:'bigmodel',name:'智谱 BigModel',base:'https://open.bigmodel.cn/api/paas/v4',mark:'智',color:'#3D5AF0',keyUrl:'https://open.bigmodel.cn/usercenter/apikeys',hint:'国内直连，OpenAI 兼容'},
  {id:'zai',name:'Z.ai',base:'https://api.z.ai/api/paas/v4',mark:'Z',color:'#1F2937',keyUrl:'https://z.ai/manage-apikey/apikey-list',hint:'智谱海外平台'},
  {id:'kimi',name:'Kimi（月之暗面）',base:'https://api.moonshot.cn/v1',mark:'K',color:'#23324A',keyUrl:'https://platform.kimi.com/console/api-keys',hint:'长上下文，适合整理长文'},
  {id:'deepseek',name:'DeepSeek',base:'https://api.deepseek.com',mark:'D',color:'#4D6BFE',keyUrl:'https://platform.deepseek.com/api_keys',hint:'性价比高'},
  {id:'minimax',name:'MiniMax',base:'https://api.minimax.cn/v1',mark:'M',color:'#C7432F',keyUrl:'https://platform.minimax.cn/console/access?tab=api-keys',hint:'国内平台 minimax.cn'},
  {id:'bailian',name:'阿里云百炼',base:'https://dashscope.aliyuncs.com/compatible-mode/v1',mark:'百',color:'#FF6A00',keyUrl:'https://bailian.console.aliyun.com/?apiKey=1#/api-key',hint:'通义系列兼容模式'},
  {id:'openai',name:'OpenAI',base:'https://api.openai.com/v1',mark:'O',color:'#10A37F',keyUrl:'https://platform.openai.com/api-keys',hint:'GPT 系列 · 需国际网络'},
  {id:'custom',name:'自定义供应商',base:'',mark:'＋',color:'#126b73',keyUrl:'',hint:'任意 OpenAI 兼容地址（HTTPS 或内网）'},
];
export function ModelSetup({cloud,onLogin}) {
  const admin=Boolean(cloud.user?.isAdmin);
  const signedIn=Boolean(cloud.user);
  // 管理员继续管理站点全局接口（后台自动翻译、机器审核）；普通用户管理自己的接口（本人的文章翻译）。
  const base=admin?'/model-config':'/my-model-config';
  const [info,setInfo]=useState(null),[pick,setPick]=useState(null),[form,setForm]=useState({url:'',key:'',model:''}),[models,setModels]=useState(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[reveal,setReveal]=useState(null),[usage,setUsage]=useState(null);
  async function refresh(){if(!signedIn)return;try{const data=await api(base);setInfo(data);}catch(e){setMessage(e.message);}
    if(admin){try{setUsage(await api(base+'/usage?days=30'));}catch{/* 台账读取失败不阻塞设置页 */}}}
  useEffect(()=>{refresh();},[signedIn,base]);
  useEffect(()=>{if(!admin||!info?.review?.running)return;const timer=setInterval(refresh,4000);return()=>clearInterval(timer);},[admin,info?.review?.running]);
  async function act(fn){setBusy(true);try{await fn();}catch(e){setMessage(e.message);}finally{setBusy(false);}}
  async function toggleReveal(){if(reveal){setReveal(null);return;}await act(async()=>{setReveal(await api(base+'/reveal'));});}
  function openProvider(p){setPick(p);setForm({url:p.base?p.base+'/chat/completions':'',key:'',model:''});setModels(null);setReveal(null);setMessage('');}
  if(!signedIn)return <section className="utility-panel" aria-label="大模型接入"><h2>大模型接入</h2><p>登录后接入你自己的大模型 API：文章翻译只消耗你自己的额度，不使用站长的 Key。</p>{onLogin&&<button type="button" onClick={onLogin}>去登录</button>}</section>;
  const lastRun=info?.review?.lastRun;
  const matched=info?.url?MODEL_PROVIDERS.find(p=>p.base&&info.url.startsWith(p.base)):null;
  // 已有生效 Key 且表单地址未改动时，Key 留空即沿用，不必每次重贴。
  const keyKept=Boolean(pick&&info?.keySet&&form.url&&form.url===info.url);
  return <section className="utility-panel" aria-label="大模型接入"><h2>大模型接入{admin?'':'（我的接口）'}</h2>
    {!admin&&<p>文章翻译调用你在这里保存的接口，只消耗你自己的 API 额度；Key 仅保存在你自己的账号下，不参与站点后台任务。</p>}
    {pick?<div className="model-form">
      <button type="button" className="provider-back" onClick={()=>{setPick(null);setModels(null);setReveal(null);setMessage('');}}>← 返回供应商列表</button>
      <div className="provider-head"><span className="provider-mark" style={{background:pick.color}}>{pick.mark}</span><div><h3>{pick.name}</h3><p>{pick.hint}</p></div></div>
      {message&&<div role="status" className="batch-notice">{message}</div>}
      <form onSubmit={e=>{e.preventDefault();act(async()=>{const payload={url:form.url,model:form.model,...(form.key?{key:form.key}:{})};const result=await api(base+'/test',{method:'POST',data:payload});const data=await api(base,{method:'PUT',data:payload});setInfo(d=>({...d,...data}));setPick(null);setModels(null);setReveal(null);setMessage(admin?'连接测试通过，已保存并启用模型 '+(form.model||result.model)+'。机器审核与自动翻译将调用该模型。':'连接测试通过，已保存并启用模型 '+(form.model||result.model)+'。你阅读时的文章翻译将使用自己的 Key。');});}}>
        <div className="form-field"><span className="form-label">接口地址<small>OpenAI 兼容 · 已自动填入，可修改</small></span><input type="url" required value={form.url} onChange={e=>setForm(f=>({...f,url:e.target.value}))}/></div>
        <div className="form-field"><span className="form-label">API Key{keyKept?<small>已保存 {info.keyMasked}，{reveal?<><code>{reveal.key}</code></>:<button type="button" className="link-btn" onClick={toggleReveal}>查看</button>} · 留空继续使用</small>:<small>只需输入一次，保存后可随时查看，无需重复粘贴</small>}{pick.keyUrl&&<a href={pick.keyUrl} target="_blank" rel="noreferrer">获取 API Key ↗</a>}</span><input type="password" autoComplete="off" required={!keyKept} placeholder={keyKept?'留空则继续使用已保存的 Key':'粘贴供应商的 API Key'} value={form.key} onChange={e=>setForm(f=>({...f,key:e.target.value}))}/></div>
        <div className="form-field"><span className="form-label">模型{models?<small>已获取 {models.length} 个，点击选择</small>:<small>粘贴 Key 后可拉取列表，或直接手动输入</small>}{models&&<button type="button" className="link-btn" onClick={()=>{setModels(null);setMessage('');}}>改为手动输入</button>}</span>
          {models?<div className="model-list" role="listbox" aria-label="可选模型">{models.map(m=><button type="button" key={m} role="option" aria-selected={form.model===m} className={'model-option'+(form.model===m?' selected':'')} onClick={()=>setForm(f=>({...f,model:m}))}><span>{m}</span>{form.model===m&&<span className="model-check" aria-hidden>✓</span>}</button>)}</div>
          :<span className="model-field"><input list="provider-models" required value={form.model} onChange={e=>setForm(f=>({...f,model:e.target.value}))} placeholder="例如 glm-4.9 / deepseek-chat"/><datalist id="provider-models">{(models||[]).map(m=><option key={m} value={m}/>)}</datalist><button type="button" disabled={busy||(!form.key&&!keyKept)||!form.url} onClick={()=>act(async()=>{const result=await api(base+'/models',{method:'POST',data:{baseUrl:form.url.replace(/\/chat\/completions\/?$/,''),...(form.key?{key:form.key}:{})}});setModels(result.models);if(!form.model)setForm(f=>({...f,model:result.models[0]}));setMessage(`已获取 ${result.models.length} 个可用模型，请选择一个。`);})}>获取模型列表</button></span>}
        </div>
        <div className="action-row"><button type="submit" className="primary" disabled={busy||!form.url||(!form.key&&!keyKept)}>测试连接并保存</button></div>
      </form>
    </div>:<div>
      {info?(info.enabled?<div className="provider-current"><span className="provider-mark" style={{background:matched?.color||'#0b7379'}}>{matched?.mark||'✓'}</span><div><strong>当前接入：{matched?matched.name:'自定义'} · 模型 {info.model}</strong><p>Key {reveal?reveal.key:info.keyMasked}{reveal?<button type="button" className="link-btn" onClick={toggleReveal}>隐藏</button>:<button type="button" className="link-btn" onClick={toggleReveal}>查看</button>}（地址：{modelSourceNames[info.source.url]}，Key：{modelSourceNames[info.source.key]}）。{admin?'用于采集后 P0/P1 条目的「机器整理」草稿、后台自动翻译与管理员本人的翻译；输出保持待复核，不写已核验或可破冰。':'用于你阅读时的文章翻译（机器翻译，待校对），只消耗你自己的额度。'}</p></div></div>
        :<p>{admin?'尚未接入大模型 · 机器审核为规则模式。选择一个供应商，粘贴 API Key 即可完成接入。':'尚未接入你自己的大模型。选择一个供应商、粘贴你的 API Key 后，文章翻译即可使用你自己的额度。'}</p>):<p>正在读取设置…</p>}
      {admin&&info?.review?.running&&<p role="status">正在补跑机器审核…</p>}
      {admin&&lastRun&&<p>上次补跑：{new Date(lastRun.at).toLocaleString('zh-CN')} · 归档 {lastRun.report.archived}，机器整理 {lastRun.report.extracted}，AI 归档低价值 {lastRun.report.autoArchived||0}，恢复 {lastRun.report.reopened||0}，失败 {lastRun.report.failed}，跳过 {lastRun.report.skipped}{lastRun.report.throttled?`，失败退避 ${lastRun.report.throttled}`:''}{lastRun.report.budgetBlocked?`，超预算回落规则 ${lastRun.report.budgetBlocked}`:''}。</p>}
      {admin&&usage&&<div className="model-usage"><h3>模型调用台账（近 {usage.days} 天）</h3>
        <p>近 24 小时：站点后台 {usage.last24.site} 次{info?.automation?.dailyModelCallCap?`（上限 ${info.automation.dailyModelCallCap}，超限后自动翻译与机器审核暂停，人工阅读翻译不受影响）`:'（未设上限）'}，用户自有 Key {usage.last24.user} 次。台账只记成败、耗时与 token 用量，不存对话内容。</p>
        {usage.totals?.length?<table className="user-table"><thead><tr><th>用途｜作用域</th><th>调用</th><th>失败</th><th>tokens</th></tr></thead><tbody>{usage.totals.map(t=><tr key={t.purpose+'｜'+t.scope}><td>{t.purpose}｜{t.scope==='site'?'站点':'用户'}</td><td>{t.calls}</td><td>{t.failures}</td><td>{t.tokens}</td></tr>)}</tbody></table>:<p>暂无调用记录。</p>}
        {usage.recentFailures?.length>0&&<details><summary>最近失败 {usage.recentFailures.length} 次</summary><ul>{usage.recentFailures.map((f,i)=><li key={i}>{new Date(f.at).toLocaleString('zh-CN')} · {f.purpose} · {f.httpStatus?('HTTP '+f.httpStatus):''} {f.error}</li>)}</ul></details>}
      </div>}
      {admin&&info?.enabled&&<div className="action-row"><label className="automation-toggle"><input type="checkbox" disabled={busy} checked={!!info.automation?.autoArchiveLow} onChange={e=>act(async()=>{const data=await api(base,{method:'PUT',data:{automation:{autoArchiveLow:e.target.checked}}});setInfo(d=>({...d,...data}));setMessage(e.target.checked?'已开启：AI 判定低价值的线索自动归档，公开可见与待复核状态不变，可在审核台恢复。':'已关闭：所有 P0/P1 线索保留在审核台。');})}/>AI 预审自动化：低销售价值线索自动归档</label><label className="automation-toggle"><input type="checkbox" disabled={busy} checked={info.automation?.useModelTranslation!==false} onChange={e=>act(async()=>{const data=await api(base,{method:'PUT',data:{automation:{useModelTranslation:e.target.checked}}});setInfo(d=>({...d,...data}));setMessage(e.target.checked?'已开启：未连接自建翻译服务时，复用此模型自动翻译新采集条目（机器翻译，待校对）。':'已关闭：翻译仅在自建翻译服务连接时进行。');})}/>自动翻译：无自建服务时复用此模型翻译采集条目</label><label className="automation-toggle"><input type="checkbox" disabled={busy} checked={info.automation?.dualScoring!==false} onChange={e=>act(async()=>{const data=await api(base,{method:'PUT',data:{automation:{dualScoring:e.target.checked}}});setInfo(d=>({...d,...data}));setMessage(e.target.checked?'已开启双次独立评分：销售价值由两次独立调用取均值，分档不一致时保守归观察。':'已关闭双次独立评分：回到单次评分，省一半审核调用。');await refresh();})}/>双次独立评分：降低销售价值评分方差（多一次调用）</label><label className="automation-toggle">每日调用上限<input type="number" min="0" max="100000" disabled={busy} defaultValue={info.automation?.dailyModelCallCap ?? 500} onBlur={e=>{const value=Number(e.target.value);if(value===(info.automation?.dailyModelCallCap ?? 500))return;act(async()=>{const data=await api(base,{method:'PUT',data:{automation:{dailyModelCallCap:value}}});setInfo(d=>({...d,...data}));setMessage(value===0?'已取消每日调用上限。':'已设置站点 Key 近 24 小时调用上限 '+value+' 次：超限后后台自动翻译与机器审核暂停并如实计数，人工阅读翻译不受影响。');await refresh();});}}/>（0 为不限）</label><button type="button" disabled={busy||info.review?.running} onClick={()=>act(async()=>{const result=await api(base+'/backfill',{method:'POST',data:{}});setMessage(result.started?'已开始补跑机器审核，完成后此处显示结果。':'已有补跑任务在进行中。');await refresh();})}>立即补跑机器审核</button>{(info.overrides?.url||info.overrides?.key||info.overrides?.model)&&<button type="button" disabled={busy} onClick={()=>act(async()=>{const data=await api(base,{method:'PUT',data:{url:'',key:'',model:''}});setInfo(d=>({...d,...data}));setMessage('已清除界面设置，恢复环境变量默认。');})}>恢复默认</button>}</div>}
      {!admin&&info?.keySet&&<div className="action-row"><button type="button" disabled={busy} onClick={()=>act(async()=>{const data=await api(base,{method:'PUT',data:{url:'',key:'',model:''}});setInfo(d=>({...d,...data}));setMessage('已清除我的接口；再次翻译前需重新保存。');})}>清除我的接口</button></div>}
      {message&&<div role="status" className="batch-notice">{message}</div>}
      <h3>选择供应商</h3>
      <div className="provider-grid">{MODEL_PROVIDERS.map(p=><button type="button" key={p.id} className="provider-card" onClick={()=>openProvider(p)}><span className="provider-mark" style={{background:p.color}}>{p.mark}</span><span className="provider-name">{p.name}<small>{p.hint}</small></span><span className="provider-chevron" aria-hidden>›</span></button>)}</div>
    </div>}
  </section>;
}
// Agent 中心分页（2026-09-30）：默认「接入」是面向所有人的公开接入指南（AIHOT /agent 式），
// 信息源、审核台、情报与用户保留原有管理员运维能力，作为其中的分页。
const AGENT_TABS=[['接入','Agent 接入'],['采集','采集与信息源'],['审核','审核台'],['情报','情报与用户']];
export function CollectorPanel({cloud,onLogin,tab,onTab}) {
  const active=AGENT_TABS.some(([key])=>key===tab)?tab:'接入';
  const [status,setStatus]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function refresh(){try{setStatus(await api('/collector/status'));setError('');}catch(e){setError(e.message);}}
  useEffect(()=>{if(active==='采集')refresh();const timer=setInterval(()=>{if(active==='采集')refresh();},10000);return()=>clearInterval(timer);},[active]);
  async function run(){setBusy(true);setError('');try{await api('/collector/run',{method:'POST',data:{}});window.dispatchEvent(new Event('radar-collected'));}catch(e){setError(e.message);}finally{setBusy(false);refresh();}}
  async function toggle(id,enabled){try{await api('/collector/source',{method:'PUT',data:{id,enabled}});await refresh();}catch(e){setError(e.message);}}
  const tabBar=<nav className="agent-tabs" role="tablist" aria-label="Agent 中心分页">{AGENT_TABS.map(([key,label])=><button key={key} type="button" role="tab" aria-selected={active===key} className={active===key?'selected':''} onClick={()=>onTab&&onTab(key)}>{label}</button>)}</nav>;
  if(active==='接入')return <section className="utility-panel online-services"><AgentPipelineCard cloud={cloud} onLogin={onLogin}/>{tabBar}<AgentAccess/></section>;
  // 审核台与情报面板的组件对非管理员一律不渲染；分页里给出可读的权限提示，不留空页。
  if((active==='审核'||active==='情报')&&!cloud.user?.isAdmin)return <section className="utility-panel online-services">{tabBar}<div role="status" className="batch-notice"><p>{active==='审核'?'审核台仅管理员可用：登录管理员账号后可批量发布、驳回与登记线索。':'情报工具仅管理员可用：登录管理员账号后可管理观察名单、查看发现分析与注册用户。'}</p><button type="button" onClick={onLogin}>去登录</button></div></section>;
  if(active==='审核')return <section className="utility-panel online-services">{tabBar}<LazyPanel key="review" inline><ReviewDesk cloud={cloud} onChanged={()=>window.dispatchEvent(new Event('radar-collected'))}/></LazyPanel></section>;
  if(active==='情报')return <section className="utility-panel online-services">{tabBar}<LazyPanel key="intel" inline><WatchIntel cloud={cloud}/><UserAccounts cloud={cloud}/><OrgDossier cloud={cloud}/></LazyPanel></section>;
  return <section className="utility-panel online-services">{tabBar}<h2>自动采集任务</h2><p>自动采集公开订阅源和国内学术元数据，结果待复核。</p>
    {!status&&!error&&<div role="status" className="batch-notice">正在读取采集状态…</div>}
    {error&&!status&&<div role="alert" className="batch-notice"><p>{error}</p><p>可稍后重试，或检查登录与网络。</p><button type="button" onClick={refresh}>重新加载</button></div>}
    {error&&status&&<div role="alert" className="batch-notice">{error}</div>}
    {status&&<><p>{status.enabled?`后台运行期间每源常规周期 ${status.intervalMinutes >= 60 ? `${status.intervalMinutes / 60} 小时` : `${status.intervalMinutes} 分钟`}采集一次；失败的源按 60/120/240/360 分钟自动退避重试。`:'定时采集已关闭。'} {status.running?'当前正在采集。':'当前空闲。'}</p><p>下次计划：{status.enabled?formatTime(status.nextRunAt):'已关闭'}（各源独立排期，取最早到期者）。后台需持续运行；休眠或关机后暂停，恢复后补抓；新源首次导入一次最多入库 30 条。</p><p>{status.translation&&(status.translation.enabled??true)?'已连接翻译服务，新采集将自动生成中英对照（机器翻译，待校对）。':'未连接翻译服务，新采集仅保留原文语言。'}{status.modelReview&&(status.modelReview.enabled?` 大模型机器审核已启用（模型 ${status.modelReview.model}）。`:' 大模型未配置，机器审核为规则模式。')}</p><div className="action-row"><button disabled={!cloud.user?.isAdmin||busy||status.running} onClick={run}>{busy?'正在采集…':'立即采集一次'}</button><button onClick={refresh}>刷新采集状态</button>{!cloud.user&&<button type="button" onClick={onLogin}>去登录</button>}</div>{!cloud.user?.isAdmin&&<p>{cloud.user?'当前账号无管理员权限：立即采集、来源开关与审核台仅管理员可用。':'审核台与采集开关需要管理员账号登录。'}</p>}
    <div className="source-cards">{status.sources.map(source=><article key={source.id}><h3>{source.name}</h3>{SOURCE_TIER_LABELS[source.tier]&&<p>{SOURCE_TIER_LABELS[source.tier]}</p>}<a href={source.url} target="_blank" rel="noreferrer">{source.kind==='crossref'||source.kind==='openalex'?'学术元数据接口':source.kind==='ccgp'?'政府采购公开检索':source.kind==='ggzy'||source.kind==='szggzy'||source.kind==='gzggzy'?'公开交易公告检索':'公开订阅源'}</a><p>最近尝试：{formatTime(source.last_attempt)}</p><p>最近成功：{formatTime(source.last_success)}</p>{source.next_attempt?<p>下次尝试：{formatTime(source.next_attempt)}{source.fail_count>0?`（连续失败 ${source.fail_count} 次，自动退避重试）`:''}</p>:source.fail_count>0?<p>连续失败 {source.fail_count} 次，自动退避重试。</p>:''}{source.disabledReason&&<p>{source.disabledReason}</p>}{source.error&&<p className="error-text">{source.error}</p>}<label><input type="checkbox" disabled={!cloud.user?.isAdmin||status.running||!!source.disabledReason} checked={!!source.enabled} onChange={e=>toggle(source.id,e.target.checked)}/>启用此来源</label></article>)}</div>
    <h3>采集运行记录</h3>{status.runs.map(run=><details key={run.id}><summary>{formatTime(run.started_at)} · {run.finished_at?'已结束':'运行中'}</summary><ul>{run.results?.map(r=><li key={r.source}>{r.source} · {r.status==='error'?r.error:`新增 ${r.added||0}，更新 ${r.updated||0}`}{r.warnings?.length?` · 部分关键词未取回：${r.warnings.join('；')}`:''}</li>)}</ul></details>)}
    {status.review&&<p>待复核 {status.review.pending} 条，已发布 {status.review.approved} 条，已驳回 {status.review.rejected} 条。</p>}
    </>}
  </section>;
}
// 注册用户面板：仅管理员渲染（非管理员组件直接不挂载，接口也是 403）。
// 只展示注册元数据：邮箱、身份、注册时间、活跃会话、是否自备翻译 Key；不含任何会话令牌或 Key 内容。
export function UserAccounts({cloud}) {
  const admin=Boolean(cloud.user?.isAdmin);
  const [users,setUsers]=useState(null),[error,setError]=useState('');
  async function refresh(){try{setUsers(await api('/users'));setError('');}catch(e){setError(e.message);}}
  useEffect(()=>{if(admin)refresh();},[admin]);
  if(!admin)return null;
  const list=users?.users||[];
  return <section className="utility-panel user-accounts" aria-label="注册用户"><h2>注册用户</h2>
    <p>共 {list.length} 个账号（管理员 {list.filter(u=>u.isAdmin).length} 个）。邮箱验证码自助注册；会话有效期 7 天，「活跃会话」表示近一周内登录。仅注册元数据，不含任何 Key 内容。</p>
    {error&&<div role="alert" className="batch-notice">{error}</div>}
    {users?(list.length?<table className="user-table"><thead><tr><th>邮箱</th><th>身份</th><th>注册时间</th><th>活跃会话</th><th>会话有效期至</th><th>自备翻译 Key</th></tr></thead><tbody>{list.map(u=><tr key={u.email}><td>{u.email}</td><td>{u.isAdmin?'管理员':'普通用户'}</td><td>{formatTime(u.createdAt)}</td><td>{u.activeSessions}</td><td>{u.sessionUntil?formatTime(u.sessionUntil):'—'}</td><td>{u.ownModelKey?'已接入':'未接入'}</td></tr>)}</tbody></table>:<p>暂无注册用户。</p>):<p>正在读取…</p>}
    <div className="action-row"><button onClick={refresh}>刷新列表</button></div>
  </section>;
}
