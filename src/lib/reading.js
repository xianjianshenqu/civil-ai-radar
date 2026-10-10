import { articleReadings } from '../data/articleReadings.js';

export const READING_KIND_LABELS = {
  editorial: '编辑整理',
  'feed-summary': '订阅源摘要',
  'feed-content': '订阅源正文',
  'academic-abstract': '论文摘要',
  'procurement-notice': '政采公告摘要',
  'manual-clip': '人工摘录',
  missing: '尚未收录',
};

export function getReading(item) {
  return item.reading || articleReadings[item.id] || {kind:'missing',originalLanguage:null,paragraphs:{}};
}
export function readingKindLabel(kind) {
  return READING_KIND_LABELS[kind] || READING_KIND_LABELS.missing;
}
export function readingText(item,reading,mode) {
  const langs=mode==='both'?['zh','en']:[mode];
  return [item.title, '正文 · '+readingKindLabel(reading.kind),
    ...langs.flatMap(lang=>['',lang==='zh'?'中文':'English',...(reading.paragraphs[lang]||['该语言版本尚未提供。'])]),
    '',reading.translationLabel||'',reading.notice||'',`来源：${item.source}`,`原文：${item.sourceUrl||'未提供'}`,`核验状态：${item.evidence}`].filter(v=>v!==undefined).join('\n');
}
