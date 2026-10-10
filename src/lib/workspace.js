import {mergeDrafts} from './backup.js';
export const guestKeys={saved:'civil-ai-radar-saved',followed:'civil-ai-radar-followed',notes:'civil-ai-radar-notes-v1',seen:'civil-ai-radar-seen-v1',prefs:'civil-ai-radar-prefs-v1',feedback:'civil-ai-radar-feedback-v1'};
export const emptyDocument=()=>({version:1,saved:[],followed:[],notes:{},seen:{},prefs:{large:false},feedback:[]});
export function accountCacheKey(id){return 'radar-account-v1:'+id;}
export function mergeGuest(account, local) {
  return {
    ...account,
    saved:[...new Set([...(account.saved||[]),...(local.saved||[])])],
    followed:[...new Set([...(account.followed||[]),...(local.followed||[])])],
    notes:{...(local.notes||{}),...(account.notes||{})},
    seen:{...(local.seen||{}),...(account.seen||{})},
    prefs:{large:Boolean(account.prefs?.large || local.prefs?.large)},
    feedback:mergeDrafts(account.feedback||[], local.feedback||[]),
  };
}
export function reloadErrorPatch(state, error, guestDocument, session, fallbackDocument) {
  if (error?.status === 401 || error?.status === 403) {
    return {user:null, document:guestDocument, revision:0, dirty:false, ready:true, status:'离线资料', error:'', conflict:null};
  }
  const user = session || state.user;
  if (!user) {
    return {user:null, document:guestDocument, revision:0, dirty:false, ready:true, status:'离线资料', error:error.message, conflict:null};
  }
  if (state.user?.id === user.id) {
    return {...state, user, ready:true, status:'同步暂停', error:error.message};
  }
  return {user, document:fallbackDocument || emptyDocument(), revision:0, dirty:false, ready:true, status:'同步暂停', error:error.message, conflict:null};
}
