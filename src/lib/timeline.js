// Collection timeline: slow sources collected within 72h still count as "today".
// Historical backfill (>72h late) stays on the original publication day.
// Unknown publication dates stay unknown; firstSeenAt is only 收录时间.

export const BACKFILL_MS = 72 * 3600 * 1000;

export function chinaDay(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(+date)) return '';
  return new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Shanghai'}).format(date);
}

export function timelineFields(item) {
  const publishedMs = Date.parse(item.publishedAt);
  const discoveredMs = Date.parse(item.firstSeenAt);
  let at = null;
  let kind = 'published';
  if (!Number.isFinite(publishedMs) && Number.isFinite(discoveredMs)) {
    at = item.firstSeenAt;
    kind = 'discovered';
  } else if (Number.isFinite(publishedMs) && !Number.isFinite(discoveredMs)) {
    at = item.publishedAt;
    kind = 'published';
  } else if (Number.isFinite(publishedMs) && Number.isFinite(discoveredMs)) {
    if (discoveredMs - publishedMs > BACKFILL_MS) {
      at = item.publishedAt;
      kind = 'backfill';
    } else {
      at = item.firstSeenAt;
      kind = 'discovered';
    }
  }
  const timelineDay = at ? chinaDay(at) : '';
  const timelineSort = timelineDay ? Number(timelineDay.replaceAll('-', '')) * 10000 : 0;
  return {timelineAt: at, timelineDay, timelineKind: kind, timelineSort};
}
