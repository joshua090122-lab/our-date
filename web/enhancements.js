(() => {
'use strict';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const catName = {restaurant:'음식점',cafe:'카페',activity:'놀 곳'};
let toastTimer, installPrompt, recordData = [], operationBusy = false;
const dayKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const readPrefs = () => {try{return JSON.parse(localStorage.getItem('our-date.preferences.v2')||'{}')}catch{return {}}};
function toast(text) {$('odToast').textContent=text;$('odToast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('odToast').hidden=true,4200);}
function showDialog(id){$(id).showModal();$(id).classList.add('active');trackModalOpen(id);}
function closeDialog(id){
 if(operationBusy){toast('진행 중인 작업이 끝나면 닫아 주세요.');return Promise.resolve(false);}
 const willPop=!handlingModalPop&&history.state?.ourDateModal===id;
 return new Promise(resolve=>{
  if(willPop)window.addEventListener('popstate',()=>resolve(true),{once:true});
  $(id).close();$(id).classList.remove('active');trackModalClose(id);
  if(!willPop)resolve(true);
 });
}
modalCloseFunctions.odSettings=()=>closeDialog('odSettings');
modalCloseFunctions.odRecords=()=>closeDialog('odRecords');
function status(){
 const mode=OurDateStore.mode;
 $('modeText').textContent=mode==='cloud'?(navigator.onLine?'둘이 함께 저장 · 화면 이동 시 불러오기':'인터넷 연결 없음 · 공유 기록 저장 불가'):'이 기기에 저장 · 정기적으로 백업해 주세요';
 $('modeBar').classList.toggle('offline',!navigator.onLine);
 const p=readPrefs();
 $('heroTitle').textContent=p.names?`${p.names}의 다음 하루`:'함께할 다음 하루';
 let days=0;
 if(/^\d{4}-\d{2}-\d{2}$/.test(p.firstDay||'')) {const a=new Date(`${p.firstDay}T00:00:00`);const n=new Date();days=Math.round((Date.UTC(n.getFullYear(),n.getMonth(),n.getDate())-Date.UTC(a.getFullYear(),a.getMonth(),a.getDate()))/86400000)+1;}
 $('heroEyebrow').textContent=days>0?`TOGETHER, DAY ${days.toLocaleString()}`:'A LITTLE PLAN, A LOVELY DAY';
 $('heroDescription').textContent=days>0?`함께한 ${days.toLocaleString()}일, 오늘도 하나의 추억으로.`:'가고 싶은 곳부터, 기억하고 싶은 순간까지.';
}
function renderAgenda(){
 status();
 const month=`${viewingMonth.getFullYear()}-${String(viewingMonth.getMonth()+1).padStart(2,'0')}`;
 const entries=Object.entries(appData).filter(([key,val])=>key.startsWith(month)&&hasDateContent(val)).sort(([a],[b])=>a.localeCompare(b));
 $('agendaCount').textContent=`${entries.length}일의 기록`;
 if(!entries.length){$('agendaList').innerHTML='<div class="empty-state"><div class="empty-heart">♡</div><strong>아직 비어 있는 우리의 날들</strong><p>달력에서 날짜를 골라보세요.<br>작은 약속 하나부터 시작해요.</p></div>';}
 else {$('agendaList').replaceChildren(...entries.map(([date,data])=>{
  const b=document.createElement('button');b.type='button';b.className='agenda-card';
  const n=Object.values(data.places||{}).reduce((s,a)=>s+a.length,0);const weekday=new Date(`${date}T12:00:00`).toLocaleDateString('ko-KR',{weekday:'short'});
  b.innerHTML=`<span class="agenda-date">${Number(date.slice(-2))}<small>${esc(weekday)}요일</small></span><span class="agenda-copy"><strong>${esc((data.memo||'우리의 데이트').split('\n')[0])}</strong><span>${esc([data.startTime?data.startTime.slice(0,5):'시간 미정',n?`후보 ${n}곳`:'장소를 골라봐요'].join(' · '))}</span></span><span>↗</span>`;
  b.onclick=()=>openKey(date);return b;
 }));}
 document.querySelectorAll('.calendar-day').forEach(b=>b.setAttribute('aria-label',`${month}-${String(b.textContent).padStart(2,'0')}${b.classList.contains('has-content')?', 기록 있음':''}`));
}
function openKey(key){const [y,m,d]=key.split('-').map(Number);return openDate(y,m-1,d);}
async function currentMonth(){if(operationBusy)return;viewingMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1);try{await loadMonthData();renderCalendar();}catch(e){toast(e.message);}}
async function refresh(){if(operationBusy)return;try{await loadMonthData();renderCalendar();await refreshStorageUsage();toast('최신 기록을 불러왔어요.');}catch(e){toast(e.message);}}
function openSettings(){
 const s=OurDateStore.getSettings(),p=readPrefs();
 $('serverUrl').value=s.supabaseUrl||'';$('publicKey').value=s.publishableKey||'';$('pairKey').value=s.pairKey||'';$('kakaoKey').value=s.kakaoKey||'';
 $('coupleNames').value=p.names||'';$('firstDay').value=p.firstDay||'';
 document.querySelector(`input[name="odMode"][value="${OurDateStore.mode}"]`).checked=true;
 $('connectionStatus').textContent='';$('backupStatus').textContent='';
 const last=localStorage.getItem('our-date.last-backup.v2');$('lastBackup').textContent=last?`마지막 백업: ${new Date(last).toLocaleString('ko-KR')}`:'아직 이 기기에서 만든 백업이 없어요.';
 $('promoteButton').hidden=OurDateStore.mode!=='cloud';
 showDialog('odSettings');
}
function savePreferences(){
 const names=$('coupleNames').value.trim();const firstDay=$('firstDay').value;
 if(firstDay&&firstDay>dayKey(new Date())){toast('처음 만난 날은 오늘 이전 날짜로 선택해 주세요.');return;}
 localStorage.setItem('our-date.preferences.v2',JSON.stringify({names,firstDay}));status();toast('우리의 기념일을 저장했어요.');
}
async function saveConnection(){
 if(operationBusy)return;
 operationBusy=true;
 for(const id of ['backupButton','restoreButton','saveConnection','promoteButton'])$(id).disabled=true;
 const mode=document.querySelector('input[name="odMode"]:checked').value;
 const next={mode,supabaseUrl:$('serverUrl').value.trim(),publishableKey:$('publicKey').value.trim(),pairKey:$('pairKey').value.trim(),kakaoKey:$('kakaoKey').value.trim()};
 const old=OurDateStore.getSettings();
 $('saveConnection').disabled=true;$('connectionStatus').textContent='설정을 확인하고 있어요…';
 try{
  await OurDateStore.saveSettings(next);
  if(mode==='cloud'){const r=await OurDateStore.client.rpc('get_storage_usage_cache',{p_bucket_id:'place-images'});if(r.error)throw new Error(r.error.message||'공유 서버 연결을 확인해 주세요.');}
  $('connectionStatus').textContent='연결 확인 완료. 화면을 새로 열어요. 기기 기록은 그대로 보관됩니다.';
  location.reload();
 }catch(e){await OurDateStore.saveSettings(old);$('connectionStatus').textContent=e.message;}
 finally{operationBusy=false;for(const id of ['backupButton','restoreButton','saveConnection','promoteButton'])$(id).disabled=false;}
}
function download(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
async function busy(task){if(operationBusy)return;operationBusy=true;for(const id of ['backupButton','restoreButton','saveConnection','promoteButton'])$(id).disabled=true;try{await task();}catch(e){$('backupStatus').textContent=e.message;}finally{operationBusy=false;for(const id of ['backupButton','restoreButton','saveConnection','promoteButton'])$(id).disabled=false;}}
async function backup(){await busy(async()=>{
 $('backupStatus').textContent='날짜와 장소, 사진 파일을 모으고 있어요. 완료될 때까지 앱을 열어 두세요.';
 const data=await OurDateStore.exportBackup();
 download(new Blob([JSON.stringify(data)],{type:'application/json'}),`Our-Date-backup-${dayKey(new Date())}.json`);
 localStorage.setItem('our-date.last-backup.v2',new Date().toISOString());
 $('backupStatus').textContent=`백업 파일을 만들었어요. 날짜 ${data.tables.dates.length}개 · 장소 ${data.tables.places.length}개 · 사진 ${data.photos.length}개. 다운로드한 파일을 별도 위치에도 보관해 주세요.`;
 });}
async function restore(file){if(!file)return;if(!confirm(`${OurDateStore.mode==='cloud'?'공유 서버':'이 기기'}의 비어 있는 저장 공간에 이 백업을 복원할까요? 기존 기록이 있으면 중단됩니다.`))return;
 await busy(async()=>{ $('backupStatus').textContent='백업을 확인하고 복원하는 중이에요…';if(OurDateStore.mode==='cloud')await OurDateStore.restoreBackupToCloud(file);else await OurDateStore.importBackup(file);await loadMonthData();renderCalendar();await refreshStorageUsage();$('backupStatus').textContent='복원이 완료됐어요. 달력에서 기록과 사진을 확인해 주세요.';});}
async function promote(){if(!confirm('이 기기에 남아 있는 기록과 사진을 현재 연결된 빈 공유 서버로 복사할까요? 기기 원본은 유지됩니다.'))return;await busy(async()=>{$('backupStatus').textContent='기기 기록과 사진을 서버로 복사하고 있어요…';await OurDateStore.promoteLocalToCloud();await loadMonthData();renderCalendar();await refreshStorageUsage();$('backupStatus').textContent='공유 서버에 복사했어요. 상대방 기기에서도 새로고침해 확인해 주세요.';});}
async function openRecords(){
 showDialog('odRecords');$('recordSearch').value='';$('recordResults').textContent='기록을 불러오고 있어요…';$('recordSummary').textContent='';
 try{const [dates,places,images]=await Promise.all(['dates','places','place_images'].map(t=>OurDateStore.readAllRows(t)));
 recordData=dates.map(d=>({...d,places:places.filter(p=>p.date_id===d.id),images:images.filter(i=>places.some(p=>p.date_id===d.id&&p.id===i.place_id))})).filter(d=>d.memo||d.start_time||d.end_time||d.places.length).sort((a,b)=>b.date.localeCompare(a.date));renderRecords();}
 catch(e){$('recordResults').textContent=e.message;}
}
function renderRecords(){
 const q=$('recordSearch').value.trim().toLowerCase();
 const list=recordData.filter(d=>`${d.date} ${d.memo||''} ${d.places.map(p=>[p.name,p.address,p.memo].join(' ')).join(' ')}`.toLowerCase().includes(q));
 $('recordSummary').textContent=`${list.length}일의 기록 · 전체 ${recordData.length}일`;
 if(!list.length){$('recordResults').innerHTML='<div class="empty-state"><div class="empty-heart">⌕</div><strong>아직 찾은 기록이 없어요</strong><p>다른 검색어를 입력하거나 첫 약속을 남겨보세요.</p></div>';return;}
 $('recordResults').replaceChildren(...list.map(d=>{
  const b=document.createElement('button');b.type='button';b.className='record-result';
  b.innerHTML=`<div class="result-date">${esc(d.date)} · ${esc(new Date(d.date+'T12:00:00').toLocaleDateString('ko-KR',{weekday:'long'}))}</div><strong>${esc(d.memo?.split('\n')[0]||d.places[0]?.name||'우리의 데이트')}</strong><p>${esc(d.places.map(p=>p.name).join(' · ')||'장소는 천천히 골라봐요.')}</p><div class="record-meta"><span>장소 ${d.places.length}곳</span><span>사진 ${d.images.length}개</span>${d.start_time?`<span>${esc(d.start_time.slice(0,5))}</span>`:''}</div>`;
  b.onclick=async()=>{if(await closeDialog('odRecords'))openKey(d.date);};return b;
 }));
}
function icsEscape(v){return String(v||'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');}
function foldLine(line){const encoder=new TextEncoder();let lines=[],part='',size=0;for(const ch of line){const n=encoder.encode(ch).length;if(size+n>73){lines.push(part);part=' ';size=1;}part+=ch;size+=n;}lines.push(part);return lines.join('\r\n');}
async function exportCalendar(){
 try{await saveDateInfo(false);const d=appData[selectedDate];if(!d)return;
 const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');const date=selectedDate.replace(/-/g,'');
 const rows=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Our Date//KO','CALSCALE:GREGORIAN','BEGIN:VEVENT',`UID:our-date-${d.id||selectedDate}@local`,`DTSTAMP:${stamp}`];
 if(d.startTime){rows.push(`DTSTART:${date}T${d.startTime.slice(0,5).replace(':','')}00`);let end=d.endTime;let endDate=date;if(end&&end<=d.startTime){const n=new Date(selectedDate+'T12:00:00');n.setDate(n.getDate()+1);endDate=dayKey(n).replace(/-/g,'');}if(end)rows.push(`DTEND:${endDate}T${end.slice(0,5).replace(':','')}00`);}
 else {rows.push(`DTSTART;VALUE=DATE:${date}`);const n=new Date(selectedDate+'T12:00:00');n.setDate(n.getDate()+1);rows.push(`DTEND;VALUE=DATE:${dayKey(n).replace(/-/g,'')}`);}
 const places=Object.entries(d.places).flatMap(([cat,list])=>list.map(p=>`${catName[cat]}: ${p.name}${p.address?' ('+p.address+')':''}`));
 rows.push(`SUMMARY:${icsEscape((d.memo||'Our Date').split('\n')[0].slice(0,100))}`,`DESCRIPTION:${icsEscape([d.memo,...places].filter(Boolean).join('\n'))}`,'END:VEVENT','END:VCALENDAR');
 download(new Blob([rows.map(foldLine).join('\r\n')+'\r\n'],{type:'text/calendar;charset=utf-8'}),`Our-Date-${selectedDate}.ics`);toast('휴대폰 달력에 가져올 일정 파일을 만들었어요.');
 }catch(e){toast(e.message);}
}
function install(){if(!installPrompt){toast('브라우저 메뉴에서 홈 화면에 추가를 선택해 주세요.');return;}installPrompt.prompt();installPrompt=null;$('installButton').style.display='none';}
function setupMap(){
 const key=OurDateStore.getSettings().kakaoKey;
 if(!key){document.querySelector('.place-search-help').textContent='장소를 직접 입력할 수 있어요. 앱 설정에 Kakao JavaScript 키를 넣으면 장소검색과 지도를 사용할 수 있어요.';return;}
 const script=document.createElement('script');script.src=`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&libraries=services&autoload=false`;
 script.onload=()=>{if(window.kakao?.maps)kakao.maps.load(()=>window.dispatchEvent(new Event('ourdate-map-ready')));};script.onerror=()=>console.warn('지도 연결을 확인해 주세요.');document.head.appendChild(script);
}
window.OD={openSettings,closeDialog,openRecords,savePreferences,saveConnection,backup,promote,refresh,currentMonth,install,openToday:()=>openKey(dayKey(new Date())),generateKey(){ $('pairKey').value=OurDateStore.generatePairKey();$('pairKey').type='text';toast('새 코드예요. 먼저 설치 SQL에 같은 코드를 등록해 주세요.');},toggleKey(){ $('pairKey').type=$('pairKey').type==='password'?'text':'password';},exportCalendar};
const originalRender=renderCalendar;renderCalendar=function(...args){const v=originalRender(...args);renderAgenda();return v;};
const originalStorage=renderStorageUsage;renderStorageUsage=function(usage){originalStorage(usage);if(OurDateStore.mode==='local'){$('storageUsageValue').textContent=formatStorageBytes(Number(usage?.total_bytes||0));$('storagePhotoCount').textContent=`사진 ${Number(usage?.photo_count||0)}개 · 이 기기에 보관`;$('storageUsageFill').style.width='0%';}};
const actions=document.createElement('div');actions.className='od-date-actions';actions.innerHTML='<button type="button" class="od-text-button" onclick="OD.exportCalendar()">휴대폰 달력에 추가 ↗</button>';$('saveDateButton').after(actions);
$('recordSearch').addEventListener('input',renderRecords);
$('restoreFile').addEventListener('change',e=>{restore(e.target.files[0]);e.target.value='';});
window.addEventListener('online',status);window.addEventListener('offline',status);
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('installButton').style.display='inline-flex';});
for(const d of document.querySelectorAll('dialog')){d.addEventListener('click',e=>{if(e.target===d&&e.clientX>=0){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeDialog(d.id);}});d.addEventListener('cancel',e=>{e.preventDefault();closeDialog(d.id);});}
for(const b of document.querySelectorAll('.back-button'))b.setAttribute('aria-label','이전 화면');
for(const [sel,label] of [['.image-viewer-close','사진 닫기'],['.image-viewer-prev','이전 사진'],['.image-viewer-next','다음 사진']])document.querySelector(sel)?.setAttribute('aria-label',label);
for(const label of document.querySelectorAll('.form-group>label')){const input=label.parentElement.querySelector('input:not([type="hidden"]),textarea');if(input?.id)label.htmlFor=input.id;}
const navs=document.querySelectorAll('.month-controller>button');navs[0]?.setAttribute('aria-label','이전 달');navs[navs.length-1]?.setAttribute('aria-label','다음 달');
window.addEventListener('beforeunload',e=>{if(operationBusy){e.preventDefault();e.returnValue='';}});
if('serviceWorker' in navigator){let updateRequested=false;const hadController=!!navigator.serviceWorker.controller;navigator.serviceWorker.ready.then(reg=>{
 const offer=()=>{if(!reg.waiting)return;const b=document.createElement('button');b.className='mode-link';b.textContent='새 버전 적용';b.onclick=()=>{if(operationBusy)return;if(confirm('작성 중인 내용을 저장했나요? 새 버전을 적용하면 화면이 다시 열려요.')){updateRequested=true;reg.waiting.postMessage('ACTIVATE_UPDATE');}};$('modeBar').appendChild(b);};
 offer();reg.addEventListener('updatefound',()=>reg.installing?.addEventListener('statechange',offer));
 });let once=false;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!once&&navigator.serviceWorker.controller){once=true;if(hadController||updateRequested)location.reload();}});}
const renderMapOriginal=renderDateMap;
renderDateMap=function(...args){
 if(window.kakao?.maps && typeof window.kakao.maps.Map!=='function'){
  $('dateMap').innerHTML='<div class="empty-state">지도를 준비하고 있어요…</div>';renderDateMapPlaceList(getAllPlacesForSelectedDate());return;
 }
 if(!OurDateStore.getSettings().kakaoKey){$('dateMap').innerHTML='<div class="empty-state"><strong>지도 연결이 아직 없어요</strong><p>설정에 Kakao JavaScript 키를 입력하면<br>후보들의 위치를 함께 볼 수 있어요.</p></div>';renderDateMapPlaceList(getAllPlacesForSelectedDate());return;}
 return renderMapOriginal(...args);
};
window.addEventListener('ourdate-map-ready',()=>{if($('mapScreen').classList.contains('active'))renderDateMap();});
setupMap();renderAgenda();
})();
