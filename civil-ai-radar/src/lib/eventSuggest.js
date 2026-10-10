// 疑似同一事件建议（2026-09-29，参考 AIHOT 事件聚簇的「召回 → 人工确认」结构，降级为词面相似）：
// 只在复核台给「待人工确认」提示，绝不自动写 eventId——词面相似不能证明同一事件，
// 与观察名单「关键词命中 = 待回链确认」同一口径；采纳动作由管理员显式完成。
export const EVENT_SUGGEST_MIN = 0.55;
export const EVENT_SUGGEST_SHARED = 3;
export const EVENT_SUGGEST_POOL_DAYS = 14;
export const EVENT_SUGGEST_LIMIT = 3;

// 标题分词：拉丁字母/数字按词，中文按二元组（bigram）。
export function titleTokens(title) {
  const text = String(title || '').toLowerCase();
  const out = [];
  for (const match of text.matchAll(/[a-z0-9]+/g)) out.push('w:' + match[0]);
  const cjk = text.replace(/[^\u3400-\u9fff]/g, '');
  for (let i = 0; i + 1 < cjk.length; i++) out.push('b:' + cjk.slice(i, i + 2));
  return out;
}

function tokenCounts(title) {
  const counts = new Map();
  for (const token of titleTokens(title)) counts.set(token, (counts.get(token) || 0) + 1);
  return counts;
}

function cosine(a, b) {
  let dot = 0;
  let shared = 0;
  for (const [token, count] of a) {
    const other = b.get(token);
    if (other) { dot += count * other; shared += 1; }
  }
  if (!dot) return {score: 0, shared: 0};
  let normA = 0, normB = 0;
  for (const count of a.values()) normA += count * count;
  for (const count of b.values()) normB += count * count;
  return {score: dot / (Math.sqrt(normA) * Math.sqrt(normB)), shared};
}

export function titleSimilarity(a, b) {
  return cosine(tokenCounts(a), tokenCounts(b)).score;
}

// 预先建好候选池向量，复核台列表一次计算多篇文章的建议。
export function buildEventSuggester(pool) {
  const vectors = (Array.isArray(pool) ? pool : [])
    .filter(item => item && item.id && item.title)
    .map(item => ({item, vector: tokenCounts(item.title)}));
  return function suggest(article, limit = EVENT_SUGGEST_LIMIT) {
    const vector = tokenCounts(article.title);
    if (!vector.size) return [];
    const ownEvent = article.editorial?.eventId || null;
    const hits = [];
    for (const {item, vector: candidate} of vectors) {
      if (item.id === article.id) continue;
      if (item.sourceUrl && item.sourceUrl === article.sourceUrl) continue;
      if (ownEvent && item.eventId && ownEvent === item.eventId) continue;
      const {score, shared} = cosine(vector, candidate);
      if (score >= EVENT_SUGGEST_MIN && shared >= EVENT_SUGGEST_SHARED) {
        hits.push({
          id: item.id,
          title: item.title,
          score: Math.round(score * 100) / 100,
          ...(item.source ? {source: item.source} : {}),
          ...(item.publishedDate ? {publishedDate: item.publishedDate} : {}),
        });
      }
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  };
}
