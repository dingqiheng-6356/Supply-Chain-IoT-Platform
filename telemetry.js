/* MQTT discovery uses received messages, never synthetic readings or IP scans. */
const mqttCandidates=new Map();
let mqttSelected='',mqttCursor=0,mqttTimer=null,mqttController=null,mqttSession='',mqttStatus='等待连接本地 MQTT 接收服务';
const deviceScene=d=>{
 const base=scenes.find(s=>s.id===d?.sceneId)||(d?.typeName?{id:d.sceneId||'custom',name:d.typeName,color:'blue',icon:'device',metrics:[...(d.metrics||[])]}:undefined);
 if(!d?.mqtt)return base;
 return {...base,metrics:(d.metrics||[]).map(metric=>{
  const configured=base?.metrics?.find(item=>item.key===metric.key);
  return {...configured,...metric,min:configured?.min,max:configured?.max};
 })};
};
const mqttFresh=(row,interval=30)=>!!row&&!row.retained&&Number.isFinite(Date.parse(row.time))&&Date.now()-Date.parse(row.time)<Math.max(15000,interval*3000);
function parseTelemetry(text){
 const metrics=[],values=Object.create(null);
 const aliases={temperature:['temperature','温度','℃'],temp:['temperature','温度','℃'],'温度':['temperature','温度','℃'],humidity:['humidity','湿度','%'],'湿度':['humidity','湿度','%'],ammonia:['ammonia','氨气浓度','ppm'],nh3:['ammonia','氨气浓度','ppm'],'氨气':['ammonia','氨气浓度','ppm'],'氨气浓度':['ammonia','氨气浓度','ppm']};
 function add(label,input,unit=''){
  label=String(label).trim();if(!label||label.length>40||metrics.length>=32)return;
  const match=String(input).trim().match(/^([-+]?(?:\d+(?:\.\d*)?|\.\d+))\s*([^\d\s,，;；:]*)$/);
  if(!match||!Number.isFinite(Number(match[1])))return;
  const known=aliases[label.toLowerCase()],key=known?.[0]||`field_${Array.from(label).map(c=>c.codePointAt(0).toString(16)).join('_')}`;
  if(Object.hasOwn(values,key))return;
  unit=String(unit||match[2]||known?.[2]||'').slice(0,20).replace(/％/g,'%').replace(/^°\s*c$/i,'℃');
  if(/^oc$/i.test(unit))return;
  metrics.push({key,name:known?.[1]||label,unit,icon:known?.[0]||'device'});values[key]=Number(match[1]);
 }
 let payload;try{payload=JSON.parse(text);}catch{}
 if(payload&&typeof payload==='object'&&!Array.isArray(payload)){
  const fields=payload.metrics||payload.data||payload.values||payload;
  if(fields&&typeof fields==='object'&&!Array.isArray(fields))for(const [label,value] of Object.entries(fields)){
   if(['id','deviceId','device_id','name','timestamp','time','online','status'].includes(label))continue;
   if(value&&typeof value==='object'&&!Array.isArray(value))add(label,value.value,value.unit);
   else if(typeof value==='number'||typeof value==='string')add(label,value);
  }
 }else{
  const pattern=/([\p{L}_][\p{L}\p{N}_ /-]{0,39}?)\s*[:：=]?\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+))\s*(°\s*[CF]|℃|[%％]|[a-zA-Zμµ/³]+)?/gu;
  for(const match of String(text).matchAll(pattern))add(match[1],match[2],match[3]);
 }
 const id=payload?.deviceId??payload?.device_id??payload?.id;
 return {metrics,values,identity:typeof id==='string'||typeof id==='number'?String(id).slice(0,128):'',name:typeof payload?.name==='string'?payload.name.slice(0,40):''};
}
function telemetryCandidate(line){
 if(typeof line?.topic!=='string'||!line.topic||typeof line.text!=='string')return null;
 const parsed=parseTelemetry(line.text);if(!parsed.metrics.length)return null;
 return {...parsed,topic:line.topic,key:JSON.stringify([line.topic,parsed.identity]),time:line.time,retained:!!line.retained,text:line.text};
}
function applyTelemetry(d,row){
 if(!d.mqtt)return;
 d.online=mqttFresh(row,d.sampleInterval);
 if(!row)return;
 d.metrics=row.metrics;d.values={...row.values};d.lastSeen=row.time;
 d.history||={};d.historyTimes||={};
 for(const m of row.metrics){
  if(d.lastMessage!==row.sequence){
   const history=d.history[m.key]||[],times=history.map((_,i)=>d.historyTimes[m.key]?.[i]??null);
   d.history[m.key]=[...history,row.values[m.key]].slice(-30);
   d.historyTimes[m.key]=[...times,row.time||null].slice(-30);
  }
 }
 d.lastMessage=row.sequence;
}
function receiveTelemetry(data){
 if(data.total<mqttCursor){mqttCursor=0;mqttCandidates.clear();for(const d of devices)if(d.mqtt)d.online=false;return;}
 for(const line of data.lines){
  const row=telemetryCandidate(line);if(!row)continue;
  row.sequence=line.id;for(const d of devices)if(d.mqtt?.key===row.key)applyTelemetry(d,row);mqttCandidates.delete(row.key);mqttCandidates.set(row.key,row);
  if(mqttCandidates.size>500)mqttCandidates.delete(mqttCandidates.keys().next().value);
 }
 mqttCursor=data.total;
 for(const d of devices)if(d.mqtt)applyTelemetry(d,data.status==='connected'?mqttCandidates.get(d.mqtt.key):null);
}
function mqttDiscoveryHtml(){
 return `<p role="status">${safe(mqttStatus)}</p><p class="settings-note">监听设备上报，收到可识别的指标后才可添加。请选择设备预览字段。</p>${[...mqttCandidates.values()].map(row=>`<button type="button" class="secondary mqtt-candidate" data-mqtt-candidate="${safe(row.key)}" ${mqttFresh(row)?'':'disabled'}><strong>${safe(row.name||row.identity||row.topic)}</strong><small>${safe(row.topic)} · ${mqttFresh(row)?'最近收到上报':'保留消息或已超时，等待新上报'}</small>${row.metrics.map(m=>`<span>${safe(m.name)}：${safe(row.values[m.key])} ${safe(m.unit)}</span>`).join('')}</button><details><summary>原始上报</summary><pre>${safe(row.text)}</pre></details>`).join('')||'<p class="muted">尚未发现设备，等待设备向订阅的 Topic 上报…</p>'}`;
}
function updateMqttDiscovery(){
 const panel=document.querySelector('#mqtt-discovery');if(!panel)return;
 panel.innerHTML=mqttDiscoveryHtml();
 panel.querySelectorAll('[data-mqtt-candidate]').forEach(button=>button.onclick=()=>{
  mqttSelected=button.dataset.mqttCandidate;const row=mqttCandidates.get(mqttSelected);
  const form=document.querySelector('#add-device-form');form.querySelector('fieldset').disabled=false;
  form.elements.mqttKey.value=mqttSelected;
  const identity=row.identity||row.topic.split('/').at(-1);
  form.elements.id.value=/^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$/.test(identity)?identity:'';
  form.elements.name.value=row.name||row.identity||'MQTT 采集设备';
  document.querySelector('#mqtt-selection').textContent=`已选择：${row.identity||row.topic}，识别到 ${row.metrics.map(m=>m.name).join('、')}`;
 });
}
function syncMqttPolling(){
 const active=!platformBackend&&!!currentUser&&['company','detail','alerts','device-manage'].includes(view)&&(canManageDevices()&&view==='device-manage'||companyDevices().some(d=>d.mqtt));
 const session=active?`${currentUser.id}:${companyId}`:'';
 if(session===mqttSession)return;
 clearTimeout(mqttTimer);mqttTimer=null;mqttController?.abort();mqttSession=session;
 // A new user/company must discover devices again; never reuse another session's selection.
 mqttCandidates.clear();mqttSelected='';mqttCursor=0;
 if(!session)return;
 async function poll(){
  if(mqttSession!==session)return;
  const controller=new AbortController();mqttController=controller;
  const timeout=setTimeout(()=>controller.abort(),5000);
  try{
   const response=await fetch(`./api/messages?source=mqtt&after=${mqttCursor}`,{cache:'no-store',signal:controller.signal});
   if(!response.ok)throw new Error('无法读取 MQTT，请使用本地 serial_server.py 服务，并配置局域网 Broker 和订阅 Topic。');
   const data=await response.json();if(!Array.isArray(data.lines)||!Number.isFinite(data.total))throw new Error('MQTT 接收格式不正确。');
   if(mqttSession!==session)return;
   receiveTelemetry(data);mqttStatus=data.status==='connected'?`正在监听 ${data.host}:${data.port} · ${data.topic}`:data.error||'正在连接 / 订阅 MQTT…';
  }catch(error){
   if(mqttSession!==session)return;
   mqttStatus=error.name==='AbortError'?'MQTT 接收超时，正在重试…':error.message;
   for(const d of devices)if(d.mqtt)d.online=false;
  }finally{
   clearTimeout(timeout);
   if(mqttSession===session){
    updateMqttDiscovery();
    // Preserve edits and focus while the background subscription continues.
    if(view!=='device-manage'&&!document.activeElement?.closest('input,select,textarea'))render(true);
    mqttTimer=setTimeout(poll,1500);
   }
  }
 }
 poll();
}
/* ===== 实时演示数据：真实上报优先，未被真实数据覆盖的演示设备持续平滑变化 ===== */
const liveStore=new Map();
let liveTimer=null;
function liveDemoBase(d){
 if(typeof baseDevices==='undefined'||!Array.isArray(baseDevices))return null;
 return baseDevices.find(row=>row.id===d?.id)||null;
}
function liveRealFresh(d){
 const seen=Date.parse(d?.lastSeen||'');
 return !!d?.provisioned&&Number.isFinite(seen)&&Date.now()-seen<60000;
}
function liveShouldSimulate(d){
 if(!d)return false;
 if(d.demo===true)return d.demoOnline!==false&&!liveRealFresh(d);
 const base=liveDemoBase(d);
 if(base)return base.online!==false&&!liveRealFresh(d);
 return !d.provisioned&&!d.mqtt&&d.online===true;
}
function liveApply(d){
 if(d.online!==true)d.online=true;
 const saved=liveStore.get(d.id);
 if(!saved)return;
 for(const key of Object.keys(saved.values))d.values[key]=saved.values[key];
 for(const key of Object.keys(saved.history)){
  d.history[key]=[...saved.history[key]];
  d.historyTimes[key]=[...(saved.historyTimes[key]||[])];
 }
}
function liveDevices(){
 const list=[];
 if(typeof devices!=='undefined'&&Array.isArray(devices))list.push(...devices);
 if(typeof wbState!=='undefined'&&wbState.public&&Array.isArray(wbState.runtimeDevices)&&wbState.runtimeDevices!==devices)list.push(...wbState.runtimeDevices);
 return list;
}
function liveReapply(){for(const d of liveDevices())if(liveShouldSimulate(d))liveApply(d);}
function liveSeedTimes(d,metric,now){
 const history=d.history?.[metric.key]||[];
 d.historyTimes||={};
 if(d.historyTimes[metric.key]?.length===history.length)return;
 d.historyTimes[metric.key]=history.map((_,index)=>new Date(now-(history.length-1-index)*Math.max(5,d.sampleInterval||30)*1000).toISOString());
}
function liveAdvance(d){
 const scene=deviceScene(d);if(!scene)return;
 const now=Date.now();
 for(const metric of scene.metrics){
  const config=metricConfig(scene,d,metric),current=d.values?.[metric.key];
  if(!Number.isFinite(current))continue;
  d.liveBase||={};
  if(!Number.isFinite(d.liveBase[metric.key])){d.liveBase[metric.key]=current;liveSeedTimes(d,metric,now);}
  const span=Number.isFinite(config.max)&&Number.isFinite(config.min)?Math.max(1,config.max-config.min):Math.max(1,Math.abs(current)*0.2);
  const drift=(d.liveBase[metric.key]-current)*0.06;
  const noise=span*(0.008+Math.random()*0.022)*(Math.random()<0.5?-1:1);
  let next=current+drift+noise;
  const low=Number.isFinite(config.min)?config.min-span*0.12:current-span;
  const high=Number.isFinite(config.max)?config.max+span*0.12:current+span;
  next=Math.min(high,Math.max(low,next));
  next=Math.round(next*10)/10;
  const history=d.history?.[metric.key]||[],times=history.map((_,index)=>d.historyTimes?.[metric.key]?.[index]??null);
  d.values[metric.key]=next;
  d.history||={};d.historyTimes||={};
  d.history[metric.key]=[...history,next].slice(-60);
  d.historyTimes[metric.key]=[...times,new Date(now).toISOString()].slice(-60);
 }
}
function livePersist(d){
 const history={},historyTimes={};
 for(const key of Object.keys(d.history||{})){history[key]=[...d.history[key]];historyTimes[key]=[...(d.historyTimes?.[key]||[])];}
 liveStore.set(d.id,{values:{...d.values},history,historyTimes});
}
function liveTick(){
 if(typeof currentUser!=='undefined'&&!currentUser&&!(typeof wbState!=='undefined'&&wbState.public))return;
 let changed=false;
 for(const d of liveDevices()){
  if(liveShouldSimulate(d)){liveApply(d);liveAdvance(d);livePersist(d);changed=true;}
  else if(liveStore.has(d.id))liveStore.delete(d.id);
 }
 if(changed&&typeof refreshLiveView==='function')refreshLiveView();
}
function startLiveTelemetry(){if(!liveTimer)liveTimer=setInterval(liveTick,1500);}
startLiveTelemetry();
