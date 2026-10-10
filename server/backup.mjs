// SQLite 每日在线备份：账号、同步数据、人工审核记录、模型配置都只在这一个库里。
// 用 VACUUM INTO 生成一致的独立副本（不需停服），按北京时间每天一份，只保留最近 keep 份。
// 备份与主库在同一块持久盘上：防误删、坏迁移和库损坏；防整盘丢失仍需把 backups 目录另行拷走。
import { mkdirSync, readdirSync, rmSync, renameSync, existsSync, chmodSync, statSync } from 'node:fs';
import path from 'node:path';
import { chinaDay } from '../src/lib/timeline.js';

const NAME=/^radar-\d{4}-\d{2}-\d{2}\.sqlite$/;

export function createBackups({db,config,now=Date.now}){
  const dir=config.backupDir,keep=config.backupKeep;
  const enabled=Boolean(dir)&&keep>0&&config.database!==':memory:';
  function list(){
    if(!existsSync(dir))return [];
    return readdirSync(dir).filter(name=>NAME.test(name)).sort();
  }
  // 当天已有备份则跳过；返回本次备份的结果，未执行返回 null。
  function runDaily(){
    if(!enabled)return null;
    const target=path.join(dir,`radar-${chinaDay(new Date(now()))}.sqlite`);
    if(existsSync(target))return null;
    mkdirSync(dir,{recursive:true,mode:0o700});
    // 先写临时文件再改名：中途失败不会留下看似完整的当天备份。
    const partial=target+'.partial';
    rmSync(partial,{force:true});
    db.prepare('VACUUM INTO ?').run(partial);
    chmodSync(partial,0o600);
    renameSync(partial,target);
    for(const name of list().slice(0,-keep))rmSync(path.join(dir,name),{force:true});
    return {file:target,bytes:statSync(target).size,kept:list().length};
  }
  return {enabled,runDaily,list};
}
