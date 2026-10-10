import {useState,useEffect} from 'react';
import {entries as seedEntries,batchDate as seedBatchDate,mergeCollected} from '../lib/radar.js';
import {api} from './api.js';
export function useLiveRadar(){
  const [live,setLive]=useState({articles:[],updatedAt:null,status:'连接采集后台…'});
  const [collection,setCollection]=useState(null);
  useEffect(()=>{
    let active=true,busy=false,pending=false;
    const refresh=async()=>{
      if(busy){pending=true;return;}
      busy=true;
      do {
        pending=false;
        const results=await Promise.allSettled([api('/articles'),api('/collector/status')]);
        if(active){
          const [articles,status]=results;
          if(articles.status==='fulfilled')setLive({...articles.value,status:'已连接采集后台 · 每 30 秒自动更新'});
          else setLive(s=>({...s,status:'采集后台未连接，内容暂未同步'}));
          setCollection(status.status==='fulfilled'?status.value:null);
        }
      } while(active && pending);
      busy=false;
    };
    const onVisible=()=>{if(document.visibilityState==='visible')refresh();};
    refresh();const timer=setInterval(refresh,30000);
    window.addEventListener('radar-collected',refresh);
    window.addEventListener('focus',refresh);
    window.addEventListener('online',refresh);
    document.addEventListener('visibilitychange',onVisible);
    return()=>{active=false;clearInterval(timer);window.removeEventListener('radar-collected',refresh);window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh);document.removeEventListener('visibilitychange',onVisible);};
  },[]);
  return {...mergeCollected(seedEntries,seedBatchDate,live.articles),liveStatus:live.status,collection};
}
