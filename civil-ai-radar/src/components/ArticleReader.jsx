import {useEffect,useRef,useState} from 'react';
import {IconLanguage,IconCopy,IconDownload,IconArrowUpRight,IconFileText} from '@tabler/icons-react';
import {getReading,readingKindLabel,readingText} from '../lib/reading.js';
import {downloadText} from '../lib/radar.js';
import {api} from '../services/api.js';

export function ArticleReader({item,notify,user,onLogin,onSettings}) {
  const source=getReading(item);
  const [translated,setTranslated]=useState(null);
  const [mode,setMode]=useState('zh');
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState(null);
  const controller=useRef(null);
  // A refreshed source invalidates any translation of the previous text.
  const signature=JSON.stringify(source);
  useEffect(()=>{setTranslated(null);setError(null);setLoading(false);return()=>controller.current?.abort();},[signature]);
  const reading=translated?.signature===signature?translated.reading:source;
  const missing=reading.kind==='missing';
  const wanted=mode==='both'?['zh','en']:[mode];
  const missingLang=wanted.find(lang=>!reading.paragraphs[lang]?.length);
  async function translate() {
    if(loading||!missingLang)return;
    controller.current=new AbortController();setLoading(true);setError(null);
    try {
      const result=await api('/articles/translate',{method:'POST',data:{id:item.id,target:missingLang},signal:controller.current.signal});
      setTranslated({signature,reading:result.reading});
    }catch(e){if(e.name!=='AbortError')setError({message:e.message,status:e.status});}
    finally {setLoading(false);}
  }
  const label=readingKindLabel(reading.kind);
  const max=Math.max(...wanted.map(lang=>reading.paragraphs[lang]?.length||0));
  return <section className="article-reader" aria-labelledby="reading-title" id="article-body">
    <div className="reader-toolbar"><h2 id="reading-title"><IconFileText size={18}/>正文 <span>· {label}</span></h2>
      <div className="reading-languages" role="group" aria-label="正文语言切换">{[['zh','中文'],['en','English'],['both','中英对照']].map(([key,label])=><button type="button" key={key} aria-pressed={mode===key} onClick={()=>{setMode(key);setError(null);}}>{label}</button>)}</div>
    </div>
    <p className="reader-caption">{reading.kind==='editorial'?'本站编辑整理；英文为 AI 译文，并非原文。':reading.kind==='academic-abstract'?'登记元数据中的论文摘要，不是出版社全文。':missing?'全文请查看来源。':'订阅源内容，可能非全文。'} {reading.translationLabel&&reading.kind!=='editorial'?reading.translationLabel:''}</p>
    {reading.notice&&<details className="reading-notice"><summary>来源说明</summary><p>{reading.notice}</p></details>}
    {missing?<div className="reading-empty"><IconFileText size={28}/><h3>正文暂未收录</h3></div>:<>
      {missingLang&&<div className="translation-state" role="status"><IconLanguage size={20}/><div><strong>{missingLang==='zh'?'中文译文尚未生成':'English translation is not available yet'}</strong>
        {!user?<div className="translate-guide"><strong>登录后可翻译全文</strong><p>登录并在 设置 → 大模型接入 保存你自己的 API Key 后即可翻译，只消耗你自己的额度；站点 Key 不为访客阅读付费。也可直接切换语言阅读原文。</p></div>
        :<><p>可请求翻译，或切换至{reading.originalLanguage==='en'?' English':'中文'}阅读。</p>{error&&<p className="translation-error" role="alert">{error.message}</p>}{error?.status===503&&onSettings&&<div className="translate-guide"><button type="button" onClick={onSettings}>去设置 → 大模型接入</button></div>}</>}
      </div>{!user?(onLogin&&<button type="button" onClick={onLogin}>去登录后翻译</button>):<button disabled={loading} onClick={translate}>{loading?'翻译中…':error?'重试翻译':'翻译为'+(missingLang==='zh'?'中文':'英文')}</button>}</div>}
      <div className={'reading-prose '+(mode==='both'?'bilingual':'')} aria-busy={loading}>{Array.from({length:max},(_,i)=><div className="reading-paragraph-pair" key={i}>{wanted.map(lang=>reading.paragraphs[lang]?.[i]&&<div key={lang} lang={lang==='zh'?'zh-CN':'en'}>{mode==='both'&&<span className="paragraph-language">{lang==='zh'?'中文':'ENGLISH'}</span>}<p>{reading.paragraphs[lang][i]}</p></div>)}</div>)}</div>
    </>}
    <footer className="reader-footer"><span>来源：{item.source}</span>{item.sourceUrl&&<a href={item.sourceUrl} target="_blank" rel="noreferrer">阅读来源全文 <IconArrowUpRight size={15}/></a>}</footer>
    {!missing&&<div className="reader-export"><button onClick={async()=>{try{await navigator.clipboard.writeText(readingText(item,reading,mode));notify('已复制当前语言正文及来源。');}catch{notify('复制失败，请使用下载正文。');}}}><IconCopy size={15}/>复制正文</button><button onClick={()=>downloadText(readingText(item,reading,mode),item.id+'-'+mode+'.md')}><IconDownload size={15}/>下载正文</button></div>}
  </section>;
}
