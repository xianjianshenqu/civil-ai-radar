const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStringList = v => Array.isArray(v) && v.every(x => typeof x === 'string');
export function parseBackup(text) {
  const v = JSON.parse(text);
  if (v.version !== 1 || !isStringList(v.saved) || !isStringList(v.followed) || !isRecord(v.notes)) throw new Error('Invalid backup');
  if (Object.values(v.notes).some(n => !isRecord(n) || (n.text !== undefined && typeof n.text !== 'string') || (n.group !== undefined && typeof n.group !== 'string'))) throw new Error('Invalid notes');
  if (v.seen !== undefined && (!isRecord(v.seen) || Object.values(v.seen).some(x => typeof x !== 'string'))) throw new Error('Invalid read history');
  if (v.prefs !== undefined && (!isRecord(v.prefs) || typeof v.prefs.large !== 'boolean')) throw new Error('Invalid preferences');
  if (v.feedback !== undefined && (!Array.isArray(v.feedback) || v.feedback.some(x => !isRecord(x) || typeof x.id !== 'number' || typeof x.text !== 'string' || typeof x.date !== 'string' || (x.status !== undefined && !['draft','queued','sent','failed','local'].includes(x.status)) || (x.deliveryId !== undefined && typeof x.deliveryId !== 'string')))) throw new Error('Invalid drafts');
  return v;
}
export function mergeDrafts(current, imported) {
  return [...current,...imported.filter(x => !current.some(y => y.id === x.id))];
}
