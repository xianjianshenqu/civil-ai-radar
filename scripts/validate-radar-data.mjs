import assert from "node:assert/strict";
import { dailyRadarEntries } from "../src/data/generatedRadarEntries.js";

const requiredFields = [
  "id", "time", "sector", "region", "scope", "source", "layer", "title", "summary",
  "quote", "eventDate", "publishedDate", "eventSort", "publishSort", "ai", "maturity",
  "evidence", "implication", "sourceUrl",
];
const allowedSectors = new Set(["交通", "水利", "电力", "施工"]);
const ids = new Set();

for (const item of dailyRadarEntries) {
  for (const field of requiredFields) assert.ok(item[field] !== undefined && item[field] !== "", `${item.id || "未命名条目"} 缺少 ${field}`);
  assert.ok(allowedSectors.has(item.sector), `${item.id} 的 sector 必须是既定领域之一`);
  assert.match(item.evidence, /^(S|A|B)级证据$/, `${item.id} 的 evidence 格式不正确`);
  assert.ok(Number.isInteger(item.eventSort) && Number.isInteger(item.publishSort), `${item.id} 的双时间轴排序字段不正确`);
  assert.doesNotThrow(() => new URL(item.sourceUrl), `${item.id} 的来源链接无效`);
  assert.ok(!ids.has(item.id), `存在重复 ID：${item.id}`);
  ids.add(item.id);
}

console.log(`土木 AI 雷达数据校验通过：${dailyRadarEntries.length} 条每日入库动态。`);
