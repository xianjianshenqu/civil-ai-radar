export async function api(path,{method='GET',data,signal}={}) {
  const response=await fetch('/api'+path,{method,credentials:'same-origin',signal,headers:data?{'Content-Type':'application/json'}:undefined,body:data?JSON.stringify(data):undefined});
  let result;try{result=await response.json();}catch{throw new Error('后台暂不可用，请稍后重试。');}
  if(!response.ok){const error=new Error(result.error || '请求失败');error.status=response.status;error.result=result;throw error;}
  return result;
}
