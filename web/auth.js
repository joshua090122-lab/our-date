/* Passwords are verified only by /api/auth. The remembered credential is an HttpOnly cookie. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let token = '', unlockedOnce = false, pending = false, checkedAt = 0, resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  function busy(value) {
    pending = value;
    $('entrySubmit').disabled=value; $('entryPassword').disabled=value; $('entryRetry').disabled=value;
  }
  function lock(message) {
    token=''; document.body.classList.add('is-locked'); $('entryGate').hidden=false;
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    document.querySelector('.app').inert=true;
    $('entryStatus').textContent=message; $('entryRetry').hidden=false;
  }
  async function request(method='GET', password) {
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),15000);
    try {
      const response=await fetch('/api/auth',{method,credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,
        headers:method==='GET'?{}:{'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify({password})}:method==='DELETE'?{body:'{}'}:{})});
      let result;try{result=await response.json();}catch(e){if(e.name==='AbortError')throw e;throw Error('입장 화면을 준비하지 못했어요. 앱 배포가 완료됐는지 확인해 주세요.');}
      if(!response.ok){const error=Error(result.message||'잠시 후 다시 시도해 주세요.');error.status=response.status;throw error;}
      return result;
    }catch(e){if(e.name==='AbortError')throw Error('서버 응답이 늦어지고 있어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');if(e instanceof TypeError)throw Error('인터넷에 연결하지 못했어요. 연결을 확인하고 다시 시도해 주세요.');throw e;}
    finally{clearTimeout(timer);}
  }
  function unlock(value) {
    if(!/^[a-f0-9]{64}$/.test(value||''))throw Error('입장 상태를 확인하지 못했어요. 다시 시도해 주세요.');
    token=value;checkedAt=Date.now();
    // Remove obsolete connection credentials, while retaining old records and anniversary migration data.
    try{localStorage.removeItem('our-date.settings.v2');}catch(_){}
    if(unlockedOnce&&document.body.classList.contains('is-locked')){location.reload();return;}
    unlockedOnce=true;$('entryPassword').value='';$('entryGate').hidden=true;
    document.body.classList.remove('is-locked');document.querySelector('.app').inert=false;
    resolveReady();window.dispatchEvent(new Event('our-date-session-resumed'));
  }
  async function resume(force=false) {
    if(pending||(!force&&Date.now()-checkedAt<60000))return;
    busy(true);
    if(!token)$('entryStatus').textContent='입장 상태를 확인하고 있어요…';
    try{unlock((await request()).token);}
    catch(e){if(e.status===401||!token)lock(e.message);else $('modeText').textContent='입장 상태 확인이 지연되고 있어요 · 인터넷 연결을 확인해 주세요.';}
    finally{busy(false);}
  }
  $('entryForm').addEventListener('submit',async e=>{
    e.preventDefault();if(pending)return;busy(true);$('entryRetry').hidden=true;
    $('entryStatus').textContent='비밀번호를 확인하고 있어요…';
    const password=$('entryPassword').value;
    try{unlock((await request('POST',password)).token);}
    catch(error){lock(error.message);}
    finally{busy(false);}
  });
  $('entryRetry').addEventListener('click',()=>resume(true));
  window.addEventListener('our-date-session-check',()=>resume(true));
  window.addEventListener('focus',()=>resume());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)resume();});
  setInterval(()=>{if(!document.hidden)resume();},5*60*1000);
  window.OurDateGate={get token(){return token;},ready,resume,async logout(){await request('DELETE');token='';location.reload();}};
  document.querySelector('.app').inert=true;
  resume(true);
})();
