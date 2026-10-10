import {useEffect, useState} from 'react';
import {api} from '../services/api.js';
import {buildAgentPipeline} from '../lib/agentPipeline.js';

function roleOf(user) {
  if (user?.isAdmin) return 'admin';
  if (user) return 'member';
  return 'guest';
}

export function AgentPipelineView({model, onRetry, onLogin}) {
  if (!model) return null;
  return <section className="agent-pipeline" aria-label="Agent 流水线状态">
    <div className="agent-pipeline-head"><h3>Agent 流水线状态</h3>{onRetry && <button type="button" onClick={onRetry}>刷新</button>}</div>
    {model.banners.map((banner, index) => <div key={`${banner.tone}-${index}`} role={banner.tone === 'error' ? 'alert' : 'status'} className={'batch-notice' + (banner.tone === 'error' ? ' agent-pipeline-error' : '')}>{banner.text}</div>)}
    <div className="agent-pipeline-grid">{model.lanes.map(item => <article key={item.id} data-lane={item.id} data-state={item.state}><h4>{item.title}<span className={'agent-pipeline-state ' + item.state}>{item.label}</span></h4><p>{item.summary}</p></article>)}</div>
    {model.showLogin && onLogin && <div className="action-row"><button type="button" onClick={onLogin}>去登录</button></div>}
  </section>;
}

export function AgentPipelineCard({cloud, onLogin}) {
  const role = roleOf(cloud?.user);
  const [reloadKey, setReloadKey] = useState(0);
  const [health, setHealth] = useState(null);
  const [collectorStatus, setCollectorStatus] = useState(null);
  const [modelConfig, setModelConfig] = useState(null);
  const [healthError, setHealthError] = useState('');
  const [detailErrors, setDetailErrors] = useState([]);
  const [pending, setPending] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setPending(true);
    if (role !== 'admin') { setCollectorStatus(null); setModelConfig(null); setDetailErrors([]); }
    (async () => {
      let nextHealth = null;
      let nextHealthError = '';
      try { nextHealth = await api('/health'); }
      catch (error) { nextHealthError = error?.message || '健康检查失败，请稍后重试。'; }
      let nextStatus = null;
      let nextModel = null;
      const nextDetailErrors = [];
      if (role === 'admin') {
        const [statusResult, modelResult] = await Promise.allSettled([api('/collector/status'), api('/model-config')]);
        if (statusResult.status === 'fulfilled') nextStatus = statusResult.value;
        else nextDetailErrors.push(`采集状态读取失败：${statusResult.reason?.message || '请稍后重试。'}`);
        if (modelResult.status === 'fulfilled') nextModel = modelResult.value;
        else nextDetailErrors.push(`模型设置读取失败：${modelResult.reason?.message || '请稍后重试。'}`);
      }
      if (cancelled) return;
      setHealth(nextHealth);
      setHealthError(nextHealthError);
      setCollectorStatus(nextStatus);
      setModelConfig(nextModel);
      setDetailErrors(nextDetailErrors);
      setPending(false);
    })();
    return () => { cancelled = true; };
  }, [role, reloadKey]);
  const model = buildAgentPipeline({role, health, collectorStatus, modelConfig, healthError, detailErrors});
  const waitingForFirstPaint = role === 'admin'
    ? !collectorStatus && !modelConfig && !detailErrors.length && !healthError
    : !health && !healthError;
  if (pending && waitingForFirstPaint) {
    return <section className="agent-pipeline" aria-label="Agent 流水线状态" aria-busy="true"><h3>Agent 流水线状态</h3><p role="status">正在读取流水线状态…</p></section>;
  }
  return <AgentPipelineView model={model} onRetry={() => setReloadKey(key => key + 1)} onLogin={onLogin}/>;
}
