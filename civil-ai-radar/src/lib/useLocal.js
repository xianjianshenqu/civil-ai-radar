import {useState,useEffect} from 'react';
export function useLocal(key, fallback, validate = v => typeof v === 'object' && v !== null && !Array.isArray(v)) {
  const [error,setError]=useState('');
  const [value,setValue]=useState(()=>{try {const v=JSON.parse(localStorage.getItem(key)); return validate(v)?v:fallback;} catch {return fallback;}});
  useEffect(()=>{try {localStorage.setItem(key,JSON.stringify(value)); setError('');} catch {setError('浏览器存储不可用，当前更改仅保留在本次页面中。请导出备份。');}},[key,value]);
  return [value,setValue,error];
}
