import {useEffect,useRef,useState} from 'react';
import {api} from './api.js';
import {parseBackup} from '../lib/backup.js';
import {accountCacheKey, emptyDocument, guestKeys as keys, mergeGuest, reloadErrorPatch} from '../lib/workspace.js';
function guest(){const value=emptyDocument();for(const [field,key] of Object.entries(keys)){try{const stored=localStorage.getItem(key);if(stored)value[field]=JSON.parse(stored);}catch{/* keep fallback */}}try{return parseBackup(JSON.stringify(value));}catch{return emptyDocument();}}
function accountCache(id){try{return JSON.parse(localStorage.getItem(accountCacheKey(id)));}catch{return null;}}
export function useAccountWorkspace(){
  const [state,setState]=useState(()=>({user:null,document:guest(),revision:0,dirty:false,ready:false,status:'连接中',error:'',conflict:null}));
  const ref=useRef(state);ref.current=state;
  const epoch=useRef(0);
  async function reload(){
    const generation=++epoch.current;setState(s=>({...s,ready:false,status:'连接中'}));
    let session;
    try{
      const {user}=await api('/auth/me');
      session=user;
      if(!user){if(epoch.current===generation)setState({user:null,document:guest(),revision:0,dirty:false,ready:true,status:'离线资料',error:'',conflict:null});return;}
      const remote=await api('/workspace');if(epoch.current!==generation)return;if(remote.userId!==user.id){await reload();return;}
      const cache=accountCache(user.id);let document=remote.data || emptyDocument(),dirty=false,conflict=null;
      if(cache?.dirty){try{document=parseBackup(JSON.stringify(cache.document));dirty=true;if(cache.revision!==remote.revision)conflict=remote;}catch{/* discard invalid cache */}}
      setState({user,document,revision:remote.revision,dirty,ready:true,status:conflict?'同步冲突':dirty?'等待同步':'已同步',error:'',conflict});
    }catch(error){if(epoch.current!==generation)return;
      let fallback=null;
      if(session){const cache=accountCache(session.id);if(cache?.document){try{fallback=parseBackup(JSON.stringify(cache.document));}catch{fallback=emptyDocument();}}}
      setState(s=>reloadErrorPatch(s,error,guest(),session,fallback));
    }
  }
  useEffect(()=>{reload();return()=>{epoch.current++;};},[]);
  useEffect(()=>{
    if(!state.ready)return;
    try{
      if(state.user)localStorage.setItem(accountCacheKey(state.user.id),JSON.stringify({document:state.document,revision:state.revision,dirty:state.dirty}));
      else for(const [field,key] of Object.entries(keys))localStorage.setItem(key,JSON.stringify(state.document[field]));
    }catch{setState(s=>s.error==='本机存储不可用，请导出资料备份。'?s:{...s,error:'本机存储不可用，请导出资料备份。'});}
  },[state.document,state.user,state.revision,state.dirty,state.ready]);
  useEffect(()=>{
    if(!state.ready||!state.user||!state.dirty||state.conflict)return;
    const controller=new AbortController(),snapshot=JSON.stringify(state.document),userId=state.user.id;
    const timer=setTimeout(async()=>{
      try{
        const result=await api('/workspace',{method:'PUT',data:{userId,revision:state.revision,data:state.document},signal:controller.signal});
        setState(s=>s.user?.id!==userId?s:{...s,revision:result.revision,dirty:JSON.stringify(s.document)!==snapshot,status:JSON.stringify(s.document)!==snapshot?'等待同步':'已同步',error:''});
      }catch(error){if(error.name==='AbortError')return;
        if(error.status===401||error.status===403){reload();return;}
        setState(s=>s.user?.id!==userId?s:{...s,status:error.status===409?'同步冲突':'同步暂停',conflict:error.status===409?error.result:s.conflict,error:error.message});
      }
    },700);
    return()=>{clearTimeout(timer);controller.abort();};
  },[state.document,state.revision,state.ready,state.user,state.dirty,state.conflict]);
  useEffect(()=>{
    const refresh=async()=>{const current=ref.current;if(!current.user||!current.ready||current.dirty||current.conflict)return;
      try{const remote=await api('/workspace');if(remote.userId!==current.user.id){reload();return;}setState(s=>s.user?.id!==current.user.id||s.dirty||remote.revision<=s.revision?s:{...s,document:remote.data||emptyDocument(),revision:remote.revision,status:'已同步'});}catch(error){if(error.status===401||error.status===403)reload();}
    };
    const timer=setInterval(refresh,15000);window.addEventListener('focus',refresh);return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);};
  },[]);
  const setters=Object.fromEntries(Object.keys(keys).map(field=>['set'+field[0].toUpperCase()+field.slice(1),value=>setState(s=>!s.ready?s:{...s,document:{...s.document,[field]:typeof value==='function'?value(s.document[field]):value},dirty:!!s.user,status:s.user?'等待同步':'离线资料'})]));
  async function verify(challengeId,code){setState(s=>({...s,ready:false}));try{await api('/auth/verify',{method:'POST',data:{challengeId,code}});await reload();}catch(error){setState(s=>({...s,ready:true}));throw error;}}
  async function logout(){
    if(ref.current.dirty)throw new Error('资料尚未同步，请等待同步完成或先处理冲突。');
    const id=ref.current.user?.id;
    setState(s=>({...s,ready:false}));
    try{
      await api('/auth/logout',{method:'POST',data:{}});
      if(id)try{localStorage.removeItem(accountCacheKey(id));}catch{/* ignore */}
      await reload();
    }catch(error){setState(s=>({...s,ready:true}));throw error;}
  }
  function importGuest(){const local=guest();setState(s=>!s.user?s:{...s,dirty:true,status:'等待同步',document:mergeGuest(s.document,local)});}
  function resolveConflict(choice){setState(s=>!s.conflict?s:{...s,document:choice==='remote'?(s.conflict.data||emptyDocument()):s.document,revision:s.conflict.revision,dirty:choice==='local',conflict:null,status:choice==='local'?'等待同步':'已同步',error:''});}
  return {...state,...setters,reload,verify,logout,importGuest,resolveConflict,retry:()=>setState(s=>({...s,document:{...s.document},error:''}))};
}
