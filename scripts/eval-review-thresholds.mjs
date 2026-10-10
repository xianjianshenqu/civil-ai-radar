#!/usr/bin/env node
// 用复核台的人工判定回放机器评分，扫描门槛输出混淆矩阵（2026-09-29，
// 参考 AIHOT SelectBench 思路的离线版）：已发布=正例、已驳回=负例，
// 对 machineReview.salesValue 扫 0–100 门槛，对代码评分 P 级做交叉表。
// 纯读库回放，不发起任何模型调用。口径提醒：approved 含“批量发布”（不改
// 证据级），人工判定反映“值得公开与否”，与“销售价值”不完全同义——
// 结果只用于校准分档线参考，不构成改线的依据本身。
import path from 'node:path';
import { openDatabase } from '../server/database.mjs';
import { scoreArticle } from '../src/lib/scoring.js';

const dbPath=process.env.DATABASE_PATH||path.resolve('.runtime/radar.sqlite');
const db=openDatabase(dbPath);
const all=db.prepare('SELECT data FROM articles').all().map(row=>JSON.parse(row.data));
const labeled=all.filter(a=>['approved','rejected'].includes(a.editorial?.status)&&a.machineReview?.status==='ready');
const approvedCount=labeled.filter(a=>a.editorial.status==='approved').length;
const modelScored=labeled.filter(a=>a.machineReview.model&&a.machineReview.model!=='rules').length;
console.log(`数据库：${dbPath}`);
console.log(`样本：${labeled.length} 条人工判定（已发布 ${approvedCount} / 已驳回 ${labeled.length-approvedCount}），其中 ${modelScored} 条为模型评分、其余为规则分档。`);
if(!labeled.length){console.log('暂无带人工判定的机器评分记录，无法回放。');db.close();process.exit(0);}
if(labeled.length<20)console.log('⚠ 样本量过小，以下数字仅作参考，不足以下结论。');
console.log('\nsalesValue ≥ 门槛 → 预测“值得跟进” 的人工判定回放：');
console.log('门槛 | 命中已发布 | 误报已驳回 | 漏报已发布 | 精确率 | 召回率');
for(let threshold=0;threshold<=100;threshold+=5){
  const over=a=>(a.machineReview.salesValue??0)>=threshold;
  const tp=labeled.filter(a=>a.editorial.status==='approved'&&over(a)).length;
  const fp=labeled.filter(a=>a.editorial.status==='rejected'&&over(a)).length;
  const fn=approvedCount-tp;
  const precision=tp+fp?Math.round(100*tp/(tp+fp)):0;
  const recall=approvedCount?Math.round(100*tp/approvedCount):0;
  console.log(String(threshold).padStart(4)+' | '+String(tp).padStart(8)+' | '+String(fp).padStart(8)+' | '+String(fn).padStart(8)+' | '+String(precision).padStart(5)+'% | '+String(recall).padStart(5)+'%');
}
const byPriority={};
for(const article of labeled){
  const priority=scoreArticle(article).priority;
  byPriority[priority]=byPriority[priority]||{approved:0,rejected:0};
  byPriority[priority][article.editorial.status]++;
}
console.log('\n代码评分 P 级 × 人工判定交叉表（work 列表只列 P0/P1 的分案是否合理）：');
for(const priority of ['P0','P1','P2','P3']){
  const row=byPriority[priority]||{approved:0,rejected:0};
  console.log(`${priority}：已发布 ${row.approved} / 已驳回 ${row.rejected}`);
}
db.close();
