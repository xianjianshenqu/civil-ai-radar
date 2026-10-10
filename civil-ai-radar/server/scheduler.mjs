// 每源独立调度（2026-09-29，参考 AIHOT per-source 调度）：sources.next_attempt 决定谁到期，
// 调度器只跑到期源；失败源的退避由 collector 写入 next_attempt。数据库里没有启用的源时
// （空 sources 列表），回退全局周期：上次 run + intervalMs，保持停机补抓一次的语义。
export function collectionSchedule({db,config,now=Date.now}) {
  const enabledSources=db.prepare('SELECT COUNT(*) AS n FROM sources WHERE enabled=1').get().n;
  let nextRunAt=null;
  if(config.collectorEnabled){
    if(enabledSources>0){
      // 未排期（next_attempt 为 NULL，如新导入的源）即刻到期，展示口径与 tick 的到期判定一致。
      const row=db.prepare('SELECT MIN(next_attempt) AS t,SUM(next_attempt IS NULL) AS unscheduled FROM sources WHERE enabled=1').get();
      nextRunAt=row.unscheduled?now():(row.t??now());
    }else{
      const latest=db.prepare('SELECT started_at FROM runs ORDER BY started_at DESC LIMIT 1').get();
      nextRunAt=latest?latest.started_at+config.intervalMs:now();
    }
  }
  return {enabled:config.collectorEnabled,intervalMinutes:config.intervalMs/60000,nextRunAt};
}
export function createScheduler({db,collector,config,now=Date.now}) {
  // An interrupted process cannot still own a run in this single-process deployment.
  let interrupted=!!db.prepare("UPDATE runs SET finished_at=?,results=? WHERE finished_at IS NULL").run(now(),JSON.stringify([{source:'scheduler',status:'error',error:'上次服务中断，采集未完成；恢复后重新检查。'}])).changes;
  let busy=false;
  return {async tick(){
    if(busy||collector.running||!config.collectorEnabled)return false;
    const enabledSources=db.prepare('SELECT COUNT(*) AS n FROM sources WHERE enabled=1').get().n;
    let only=null,due;
    if(enabledSources>0){
      const rows=db.prepare('SELECT id FROM sources WHERE enabled=1 AND (next_attempt IS NULL OR next_attempt<=?)').all(now());
      only=rows.length?rows.map(row=>row.id):null;
      due=Boolean(only);
    }else{
      due=now()>=collectionSchedule({db,config,now}).nextRunAt;
    }
    if(!interrupted&&!due)return false;
    busy=true;
    try{await collector.run(only?{only}:{});interrupted=false;return true;}finally{busy=false;}
  }};
}
