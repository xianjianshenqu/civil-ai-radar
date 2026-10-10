// 附加观察名单：界面新增的观察单位存 meta 表，与 src/data/orgWatchlist.js 静态名单合并参与
// 关键词计分与新买家统计。静态名单仍是基线；这里只保存运营人工添加的单位，可随时移除。
// 关键词命中仍然只是评分线索：新增观察单位不代表该单位参与任何项目，也不写「已核验」。
import { hash, HttpError } from './auth.mjs';
import { setWatchOrgExtras, getWatchOrgs } from '../src/lib/scoring.js';
import { BUYER_ROLES, PRODUCT_OFFERINGS, WATCH_LAYERS } from '../src/data/orgWatchlist.js';

const META_KEY = 'watchlist.extraOrgs';
const MAX_EXTRAS = 60;

function readExtras(db) {
  const row = db.prepare('SELECT value FROM meta WHERE key=?').get(META_KEY);
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function writeExtras(db, list) {
  db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(META_KEY, JSON.stringify(list));
}
function aliasOverlap(name, aliases, orgs) {
  const own = [name, ...aliases].filter(Boolean);
  for (const org of orgs) {
    for (const alias of [org.name, ...(org.aliases || [])]) {
      if (!alias || alias.length < 2) continue;
      if (own.some(item => item.includes(alias) || alias.includes(item))) return org;
    }
  }
  return null;
}

export function createWatchlist({db, now = Date.now}) {
  function extras() { return readExtras(db); }
  function list() { return getWatchOrgs(); }
  function apply() { setWatchOrgExtras(extras()); }
  function add(input, user) {
    const name = typeof input?.name === 'string' ? input.name.trim() : '';
    if (name.length < 4 || name.length > 40) throw new HttpError(400, '单位全称需为 4–40 个字符。');
    const aliases = (Array.isArray(input?.aliases) ? input.aliases : [])
      .map(a => typeof a === 'string' ? a.trim() : '')
      .filter(a => a.length >= 2 && a.length <= 30)
      .slice(0, 6);
    const layer = WATCH_LAYERS.find(l => l.id === input?.layer)?.id;
    if (!layer) throw new HttpError(400, '观察层级无效。');
    const isBuyer = Boolean(input?.isBuyer);
    const buyerRole = BUYER_ROLES.includes(input?.buyerRole) ? input.buyerRole : '未知';
    const offerings = (Array.isArray(input?.offerings) ? input.offerings : [])
      .filter(id => PRODUCT_OFFERINGS.includes(id))
      .slice(0, 5);
    const current = extras();
    if (current.length >= MAX_EXTRAS) throw new HttpError(400, `附加观察单位已达上限（${MAX_EXTRAS}）。`);
    const conflict = aliasOverlap(name, aliases, [...list()]);
    if (conflict) throw new HttpError(409, `与既有观察单位「${conflict.name}」名称重叠，请直接使用既有单位或改用更全的名称。`);
    const org = {
      id: 'x-' + hash(name + String(now())).slice(0, 12),
      name, aliases, layer, isBuyer, buyerRole,
      offerings, secondary: [],
      addedAt: new Date(now()).toISOString(),
      addedBy: user || '',
    };
    writeExtras(db, [...current, org]);
    apply();
    return org;
  }
  function remove(id) {
    if (typeof id !== 'string' || !id.startsWith('x-')) throw new HttpError(400, '静态名单单位需在代码名单中维护；这里只能移除界面新增的附加单位。');
    const current = extras();
    if (!current.some(o => o.id === id)) throw new HttpError(404, '找不到这个附加观察单位。');
    writeExtras(db, current.filter(o => o.id !== id));
    apply();
  }
  apply();
  return {list, extras, add, remove, apply};
}
