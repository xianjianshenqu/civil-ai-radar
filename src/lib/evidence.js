export function isHttpUrl(value) {
  try { return ['http:','https:'].includes(new URL(value).protocol); } catch { return false; }
}
// A UI verification badge requires a recorded reviewer, time, and specific evidence pages.
// This validates record completeness, not the truth of a source; review remains an editorial responsibility.
export function completeVerification(record) {
  return record?.status === 'verified' && typeof record.reviewer === 'string' && record.reviewer.trim().length > 0
    && typeof record.checkedAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(record.checkedAt) && Number.isFinite(Date.parse(record.checkedAt))
    && Array.isArray(record.references) && record.references.length > 0
    && record.references.every(r => typeof r.title === 'string' && r.title.trim() && isHttpUrl(r.url) && new URL(r.url).pathname !== '/');
}
