// 主题自动匹配与领域推断：纯代码发现，用于把采集记录归入主题库和领域。
// 关键词命中只代表主题相关性，不代表该企业或项目实际参与；人工归类优先。
import { civilAiTopics } from '../data/topicsData.js';

export const SECTORS = ['交通', '水利', '电力', '石化', '新能源', '施工'];

const SECTOR_PATTERNS = [
  ['新能源', /新能源|风电|光伏|储能|抽水蓄能|核电|风光基地/i],
  ['电力', /电网|电厂|电站|变电站|输电|配电|变电|电力|电缆/i],
  ['水利', /水利|水库|大坝|流域|灌区|水文|水务|水电|防汛|堤防/i],
  ['交通', /铁路|公路|桥梁|隧道|轨道交通|地铁|机场|港口|航道|交通|高速/i],
  ['石化', /石化|炼化|油气|油田|化工|管道|乙烯|炼油|危化/i],
];

const MAX_TOPICS = 4;
const MIN_KEYWORD_LENGTH = 2;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function keywordPattern(keyword) {
  const escaped = escapeRegExp(keyword);
  if (/^[A-Za-z0-9]{2,12}$/.test(keyword)) return new RegExp(`\\b${escaped}\\b`, 'i');
  return new RegExp(escaped, 'i');
}

// 按主题 matchedKeywords 命中排序取前几个；同一段文字只算一次，避免同义词重复占位。
export function matchTopics(text) {
  const haystack = String(text || '');
  if (!haystack) return [];
  const hits = [];
  const used = [];
  for (const topic of civilAiTopics) {
    const keywords = (topic.matchedKeywords || []).filter(k => typeof k === 'string' && k.trim().length >= MIN_KEYWORD_LENGTH);
    for (const keyword of keywords) {
      const found = haystack.match(keywordPattern(keyword.trim()));
      if (!found || found.index == null) continue;
      const start = found.index;
      const end = start + found[0].length;
      if (used.some(span => start < span.end && end > span.start)) continue;
      used.push({start, end});
      hits.push({id: topic.id, keyword, length: keyword.length});
      break;
    }
  }
  hits.sort((a, b) => b.length - a.length);
  return hits.slice(0, MAX_TOPICS).map(hit => hit.id);
}

export function guessSector(text) {
  const haystack = String(text || '');
  for (const [sector, pattern] of SECTOR_PATTERNS) {
    if (pattern.test(haystack)) return sector;
  }
  return '';
}
