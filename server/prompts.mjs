import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

// 提示词外置（2026-09-29，参考 AIHOT industry/prompts 机制）：文件即提示词，
// 正文逐字发送给模型——不要在 .md 里加说明性标题或注释。
// 加载失败直接抛错，绝不静默成空提示词；版本 = 内容 SHA-256 前 10 位，
// 随每次调用写入 model_calls 台账，改稿即可追溯到版本。进程启动读一次，
// 改提示词需重启进程；换提示词会改变逻辑键，机器审核失败退避随之重新计窗。
const dir=path.join(path.dirname(fileURLToPath(import.meta.url)),'prompts');
function load(name){
  const content=readFileSync(path.join(dir,name),'utf8').replace(/\s+$/,'');
  if(!content.trim())throw new Error('提示词文件为空：'+name);
  return {content,version:createHash('sha256').update(content).digest('hex').slice(0,10)};
}
export const reviewPrompt=load('review-system.md');
// 第二次独立评分（双评降方差）：只输出销售价值三字段，判定不一致时保守归「观察」。
export const scorePrompt=load('score-system.md');
export const translatePrompt=load('translate-system.md');
