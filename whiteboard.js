/* Free-form livestock showcase boards: editor, persistence, sharing and public display. */
const whiteboardStorageKey='livestock-whiteboards-v1';
const wbState={boards:null,current:null,selected:null,zoom:1,fit:1,dirty:false,history:[],future:[],public:false,token:'',runtimeDevices:[],observer:null,timer:null,dropPosition:null};
const wbClone=value=>JSON.parse(JSON.stringify(value));
const wbId=()=>`el-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
const wbCanEdit=()=>['company_admin','developer'].includes(currentUser?.role);
function wbLocalBoards(){const rows=readStorage(whiteboardStorageKey,[]);return Array.isArray(rows)?rows:[];}
function wbSaveLocalBoards(rows){localStorage.setItem(whiteboardStorageKey,JSON.stringify(rows));}
function wbDefaultDocument(title='牧业链 · 智慧养殖展示'){
 const shape=(id,x,y,width,height,color,z=1,radius=24,opacity=1)=>({id,type:'shape',x,y,width,height,rotation:0,z,props:{color,radius,opacity}});
 const text=(id,content,x,y,width,height,fontSize,color,z=5,extra={})=>({id,type:'text',x,y,width,height,rotation:0,z,props:{content,fontSize,color,fontWeight:600,align:'left',opacity:1,...extra}});
 return {version:1,title,canvas:{width:1600,height:900,background:'#071b18',backgroundEnd:'#103d32',grid:true},elements:[
  shape('bg-orb',1120,-180,620,620,'#1d6b4f',0,310,.28),shape('left-glow',-170,610,540,390,'#2a7a59',0,195,.18),
  text('eyebrow','M U Y U A N  /  S M A R T  L I V E S T O C K',82,62,850,50,20,'#79dbb1',6,{fontWeight:500}),
  text('main-title','让养殖环境，清晰可见',78,126,930,100,58,'#f2f8ed',6,{fontWeight:700}),
  text('subtitle','牧源养殖 · 环境感知 · 实时预警 · 数字展示',82,234,850,55,24,'#a9c8bc',6,{fontWeight:400}),
  shape('model-card',920,112,590,550,'#0d2b25',2,38,.88),
  {id:'device-model',type:'model',x:986,y:178,width:458,height:390,rotation:0,z:4,props:{src:'./assets/models/device.glb',autoRotate:true,opacity:1}},
  text('model-caption','ENVIRONMENTAL SENSOR  /  3D DIGITAL TWIN',990,592,470,36,15,'#80a99a',6,{align:'center',fontWeight:500}),
  shape('metric-card-1',80,366,390,210,'#10372e',3,28,.96),shape('metric-card-2',80,602,390,210,'#10372e',3,28,.96),
  text('metric-label-1','01 号猪舍 · 温度',112,396,310,40,20,'#b5cec3',6,{fontWeight:500}),
  text('metric-value-1','25.6 ℃',108,448,330,88,58,'#eff9df',6,{deviceId:'ENV-001',metric:'temperature',fontWeight:700}),
  text('metric-label-2','01 号猪舍 · 湿度',112,632,310,40,20,'#b5cec3',6,{fontWeight:500}),
  text('metric-value-2','62.4 %',108,684,330,88,58,'#eff9df',6,{deviceId:'ENV-001',metric:'humidity',fontWeight:700}),
  shape('ammonia-card',510,366,350,446,'#d5f16d',3,28,.96),
  text('ammonia-label','氨气浓度监测',544,402,280,44,21,'#233a27',6,{fontWeight:600}),
  text('ammonia-value','8.2 ppm',538,474,290,90,54,'#102a20',6,{deviceId:'ENV-001',metric:'ammonia',fontWeight:700}),
  text('ammonia-note','实时感知\n安心养殖',544,630,250,100,27,'#294c34',6,{fontWeight:600}),
  text('footer-brand','牧业供应链物联网平台',82,842,600,32,16,'#8daf9f',6,{fontWeight:500}),
  text('footer-status','●  DATA CONNECTED  /  数据持续感知',1030,842,480,32,15,'#8edbb5',6,{align:'right',fontWeight:500})
 ]};
}
function wbBlankDocument(title='空白展示白板'){return {version:1,title,canvas:{width:1600,height:900,background:'#ffffff',backgroundEnd:'#ffffff',grid:true},elements:[]};}
function wbNewElement(type,position={}){
 const base={id:wbId(),type,x:position.x??610,y:position.y??330,width:320,height:180,rotation:0,z:Math.min(1000,wbState.current.document.elements.length+10),props:{opacity:1}};
 if(type==='text')return {...base,width:420,height:110,props:{...base.props,content:'双击属性面板编辑文字',fontSize:38,color:'#17382c',fontWeight:600,align:'left'}};
 if(type==='metric'){const dev=companyDevices()[0];return {...base,width:460,height:220,props:{...base.props,deviceId:dev?.id||'',metric:'temperature',theme:'cyan',showValue:true,showChart:true}};}
 if(type==='shape')return {...base,props:{...base.props,color:'#2d8c67',radius:24}};
 if(type==='background')return {...base,width:1600,height:900,props:{...base.props,color:'#0a1f1a',gradient:true,pattern:'grid',opacity:.3}};
 if(type==='image')return {...base,width:480,height:300,props:{...base.props,src:position.src,fit:'cover',alt:'展示图片'}};
 if(type==='video')return {...base,width:520,height:300,props:{...base.props,src:position.src,autoplay:true,loop:true}};
 return {...base,width:460,height:400,props:{...base.props,src:position.src||'./assets/models/device.glb',autoRotate:true}};
}
function wbAssetUrl(src){if(typeof src!=='string')return '';if(!/^(https?:\/\/|\.\/assets\/|\/api\/whiteboards\/assets\/|data:(?:image|video)\/|data:(?:model\/gltf-binary|application\/octet-stream);)/.test(src))return '';if(wbState.public&&src.startsWith('/api/whiteboards/assets/'))return `${src}?token=${encodeURIComponent(wbState.token)}`;return src;}
function wbMetric(el){const p=el.props||{},list=wbState.public?wbState.runtimeDevices:devices,d=list.find(d=>d.id===p.deviceId);if(!d||!p.metric)return null;const value=d.values?.[p.metric];if(!Number.isFinite(value))return '—';const scene=typeof deviceScene==='function'?deviceScene(d):scenes.find(s=>s.id===d.sceneId),metric=scene?.metrics?.find(m=>m.key===p.metric);return `${value}${metric?.unit?' '+metric.unit:''}`;}
function wbMetricData(el){const p=el.props||{},list=wbState.public?wbState.runtimeDevices:devices,d=list.find(d=>d.id===p.deviceId);if(!d||!p.metric)return null;const scene=typeof deviceScene==='function'?deviceScene(d):scenes.find(s=>s.id===d.sceneId),metric=scene?.metrics?.find(m=>m.key===p.metric);const history=(d.history?.[p.metric]||[]).slice(-20),values=[...history];const cur=d.values?.[p.metric];if(Number.isFinite(cur))values.push(cur);return {value:cur,unit:metric?.unit||'',name:metric?.name||p.metric,deviceName:d.name||'',values,min:metric?.min,max:metric?.max};}
function wbMetricChart(el,width,height){const data=wbMetricData(el);if(!data)return '<div class="wb-metric-empty">请在右侧选择设备与指标</div>';const p=el.props||{},themes={cyan:{line:'#22d3ee',glow:'rgba(34,211,238,.5)',text:'#67e8f9'},green:{line:'#4ade80',glow:'rgba(74,222,128,.5)',text:'#86efac'},amber:{line:'#fbbf24',glow:'rgba(251,191,36,.5)',text:'#fde68a'},red:{line:'#f87171',glow:'rgba(248,113,113,.5)',text:'#fecaca'}};const t=themes[p.theme]||themes.cyan;const vals=data.values.filter(v=>Number.isFinite(v));if(!vals.length)return `<div class="wb-metric-empty">${data.deviceName} · ${data.name}<br>等待数据接入…</div>`;const pad=8,min=Math.min(...vals),max=Math.max(...vals),range=max-min||1,chartW=width-pad*2,chartH=height-pad*2-40;const points=vals.map((v,i)=>`${pad+(i/Math.max(1,vals.length-1))*chartW},${pad+chartH-(v-min)/range*chartH}`).join(' ');const areaPath=`M${pad},${pad+chartH} L${points.split(' ').join(' L')} L${pad+chartW},${pad+chartH} Z`;const valStr=Number.isFinite(data.value)?data.value.toFixed(1):'—',showValue=p.showValue!==false,showChart=p.showChart!==false;const chartHtml=showChart?`<svg class="wb-metric-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"><defs><linearGradient id="g-${el.id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${t.line}" stop-opacity=".35"/><stop offset="100%" stop-color="${t.line}" stop-opacity="0"/></linearGradient><filter id="f-${el.id}"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>${[0,.25,.5,.75,1].map(g=>`<line x1="${pad}" y1="${pad+chartH*g}" x2="${pad+chartW}" y2="${pad+chartH*g}" stroke="rgba(255,255,255,.06)" stroke-width="1"/>`).join('')}<path d="${areaPath}" fill="url(#g-${el.id})"/><polyline points="${points}" fill="none" stroke="${t.line}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" filter="url(#f-${el.id})"/></svg>`:'';return `${chartHtml}<div class="wb-metric-head"><span class="wb-metric-name">${safe(data.deviceName)} · ${safe(data.name)}</span><span class="wb-metric-dot" style="background:${t.line}"></span></div>${showValue?`<div class="wb-metric-value" style="color:${t.text};text-shadow:0 0 18px ${t.glow}">${valStr}<small>${safe(data.unit)}</small></div>`:''}`;}
function wbTextContent(el){if(el.type==='metric')return wbMetric(el)??'—';return wbMetric(el)??el.props.content??'';}
function wbElementHtml(el,editing=false){
 const p=el.props||{},opacity=Number.isFinite(p.opacity)?p.opacity:1,style=`left:${el.x}px;top:${el.y}px;width:${el.width}px;height:${el.height}px;transform:rotate(${el.rotation||0}deg);z-index:${el.z||1};opacity:${opacity}`;
 let body='';
 if(el.type==='text'){const align=['left','center','right'].includes(p.align)?p.align:'left',weight=Number(p.fontWeight)||600,size=Math.max(8,Math.min(180,Number(p.fontSize)||32)),color=/^#[0-9a-f]{6}$/i.test(p.color)?p.color:'#f2f8ed';body=`<div class="wb-text" data-live-value="${safe(el.id)}" style="font-size:${size}px;color:${color};font-weight:${weight};text-align:${align}">${safe(wbTextContent(el))}</div>`;}
 if(el.type==='shape'){const color=/^#[0-9a-f]{6}$/i.test(p.color)?p.color:'#2d8c67',radius=Math.max(0,Math.min(400,Number(p.radius)||0));body=`<div class="wb-shape" style="background:${color};border-radius:${radius}px"></div>`;}
 if(el.type==='background'){const color=/^#[0-9a-f]{6}$/i.test(p.color)?p.color:'#0a1f1a',pat=p.pattern||'none';const bg=p.gradient!==false?`linear-gradient(135deg,${color},${p.colorEnd||'#14352a'})`:color;const overlay=pat==='grid'?'<div class="wb-bg-grid"></div>':pat==='dots'?'<div class="wb-bg-dots"></div>':pat==='circuit'?'<div class="wb-bg-circuit"></div>':'';body=`<div class="wb-background" style="background:${bg}">${overlay}</div>`;}
 if(el.type==='metric'){body=`<div class="wb-metric-card" data-live-value="${safe(el.id)}">${wbMetricChart(el,el.width,el.height)}</div>`;}
 if(el.type==='image'){const src=wbAssetUrl(p.src);body=src?`<img src="${safe(src)}" alt="${safe(p.alt||'展示图片')}" draggable="false" style="object-fit:${p.fit==='contain'?'contain':'cover'}">`:'<div class="wb-media-empty">图片资源不可用</div>';}
 if(el.type==='video'){const src=wbAssetUrl(p.src);body=src?`<video src="${safe(src)}" ${editing?'':'controls'} ${p.autoplay!==false?'autoplay':''} ${p.loop!==false?'loop':''} muted playsinline></video>`:'<div class="wb-media-empty">视频资源不可用</div>';}
 if(el.type==='model'){const src=wbAssetUrl(p.src);body=src?`<canvas data-3d-src="${safe(src)}" data-src="${safe(src)}" data-auto-rotate="${p.autoRotate!==false}" aria-label="可旋转缩放的三维设备模型"></canvas><span class="wb-model-hint">3D · 拖动旋转 / 滚轮缩放</span>`:'<div class="wb-media-empty">三维模型不可用</div>';}
 const handles=editing&&wbState.selected===el.id?`<span class="wb-move-handle" data-wb-move title="拖动此条移动组件">⋮⋮ 拖动移动</span><span class="wb-rotate" data-wb-rotate title="旋转"></span><span class="wb-delete-btn" data-wb-delete-inline title="删除组件">×</span>${['nw','n','ne','e','se','s','sw','w'].map(h=>`<i class="wb-handle wb-${h}" data-wb-handle="${h}"></i>`).join('')}${p.locked?'<span class="wb-lock">已锁定</span>':''}`:'';
 return `<div class="wb-element wb-type-${el.type}${editing&&wbState.selected===el.id?' selected':''}${p.locked?' locked':''}" data-element-id="${safe(el.id)}" style="${style}">${body}${handles}</div>`;
}
function wbCanvasHtml(editing=false){const doc=wbState.current.document,c=doc.canvas;return `<div id="${editing?'wb-canvas':'wb-public-canvas'}" class="wb-canvas${c.grid&&editing?' show-grid':''}" style="background:linear-gradient(135deg,${safe(c.background)},${safe(c.backgroundEnd)})">${doc.elements.slice().sort((a,b)=>a.z-b.z).map(el=>wbElementHtml(el,editing)).join('')}</div>`;}
/* ===== 数据展示：先选设备，再展示该设备信息与各指标折线图（近 2 天 + 实时增量） ===== */
const showcaseState={charts:[],observer:null,timer:null,baseByKey:new Map(),loadingKey:''};
let showcaseDeviceId=null,showcaseMetricKeys=[],showcaseMetricOwner='',showcaseNewKey='';
const SHOWCASE_COLORS=['#386f52','#547ee8','#2aa198','#d98e32','#7c6bd6','#c96a8a','#4e7a4c','#e03131'];
const SHOWCASE_PIE_COLORS=['#386f52','#547ee8','#2aa198','#d98e32','#7c6bd6','#c96a8a','#4e7a4c','#e03131','#3f8fa8','#b5651d','#6b7280','#a3559a'];
const SHOWCASE_TYPES={line:'折线',bar:'柱状',pie:'饼图'};
const SHOWCASE_TYPE_ORDER=['line','bar','pie'];
const showcaseChartTypes=new Map();
function showcaseChartType(deviceId,metricKey){return showcaseChartTypes.get(`${deviceId}|${metricKey}`)||'line';}
const SHOWCASE_SLOTS=48;
// 固定 48 个整点：当前小时作为最后一个横坐标，往前推 48 小时
function showcaseWindowStart(){const d=new Date();d.setMinutes(0,0,0);return d.getTime()-(SHOWCASE_SLOTS-1)*3600000;}
function showcaseSlotLabels(start){const labels=[];for(let i=0;i<SHOWCASE_SLOTS;i++)labels.push(showcaseAxisLabel(start+i*3600000));return labels;}
// 横坐标格式：日-两位小时，例如 24-07 表示 24 日 7 时
function showcaseAxisLabel(value){const d=new Date(value);return `${d.getDate()}-${String(d.getHours()).padStart(2,'0')}`;}
// 从后端拉取该设备 48 小时窗口（当前小时往前推 2 天）的历史读数（接口单页最多 20000 条，自动翻页）
async function showcaseFetchHistory(deviceId){
 const end=Math.floor(Date.now()/1000),start=Math.floor(showcaseWindowStart()/1000);
 let before=null,all=[];
 for(let page=0;page<20;page++){
  const q=`./api/devices/${encodeURIComponent(deviceId)}/history?start=${start}&end=${end}&limit=8000${before?`&before=${before}`:''}`;
  let res;try{res=await fetch(q,{credentials:'same-origin',cache:'no-store'});}catch{break;}
  if(!res.ok)break;
  let json;try{json=await res.json();}catch{break;}
  const rows=json.readings||[];
  all=all.concat(rows);
  before=json.nextBefore;
  if(!before)break;
  const oldest=rows.length?rows[rows.length-1].received:null;
  if(oldest!=null&&oldest<=start)break;
  if(all.length>=60000)break;
 }
 return all.sort((a,b)=>a.received-b.received);
}
// 整点聚合：同一小时内的采样取平均，收敛为「该小时」一个点，横坐标只落在整点
function showcaseHourly(points){
 const buckets=new Map();
 for(const [t,v] of points){const h=Math.floor(t/3600000)*3600000;const arr=buckets.get(h);if(arr)arr.push(v);else buckets.set(h,[v]);}
 return [...buckets.entries()].map(([h,arr])=>[h,Math.round(arr.reduce((a,b)=>a+b,0)/arr.length*10)/10]).sort((a,b)=>a[0]-b[0]);
}
// 用 parseTelemetry 归一化原始报文别名（温度→temperature 等），按指标构建时间序列
function showcaseBuildBase(readings,metrics){
 const base=Object.create(null);for(const m of metrics)base[m.key]=[];
 for(const r of readings){
  const parsed=typeof parseTelemetry==='function'?parseTelemetry(r.payload):null;
  const p=parsed&&parsed.values;if(!p)continue;
  const t=r.received*1000;
  for(const m of metrics){const v=p[m.key];if(Number.isFinite(v))base[m.key].push([t,v]);}
 }
 for(const m of metrics)base[m.key]=showcaseHourly(base[m.key]);
 return base;
}
// 虚拟数据：缺失整点暂用平滑模拟值填充（按 设备+指标+绝对小时 确定性生成，刷新不跳变，真实数据到达后自动替换）
function showcaseHash(str){let h=2166136261;for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0)/4294967295;}
function showcaseMockValue(metric,deviceId,hourTs){
 const hasRange=Number.isFinite(metric.min)&&Number.isFinite(metric.max)&&metric.max>metric.min;
 const lo=hasRange?metric.min:0,hi=hasRange?metric.max:100;
 const mid=(lo+hi)/2,amp=(hi-lo)*0.3;
 const hourOfDay=new Date(hourTs).getHours();
 const wave=Math.sin((hourOfDay+1)/4.2)*0.65+Math.sin((hourOfDay+1)/1.7)*0.2;
 const noise=(showcaseHash(`${deviceId}:${metric.key}:${hourTs}`)*2-1)*0.35;
 const v=Math.max(lo,Math.min(hi,mid+amp*(wave+noise*0.5)));
 return Math.round(v*10)/10;
}
function showcaseLivePoints(d,metric){
 const vals=d.history?.[metric.key]||[],times=d.historyTimes?.[metric.key]||[],out=[];
 vals.forEach((v,i)=>{if(!Number.isFinite(v))return;const t=times[i]?new Date(times[i]).getTime():Date.now()-(vals.length-1-i)*30000;out.push([t,v]);});
 return out;
}
function showcaseDevicePicker(){
 const list=companyDevices();
 return `<div class="showcase-root" id="showcase-root"><header class="showcase-head"><div><span class="showcase-kicker">REALTIME / TELEMETRY</span><h1>数据展示</h1><p>选择一台设备，查看它近 2 天的监测数据走势与实时更新</p></div><div class="showcase-meta"><span>${list.length} 台设备</span></div></header><div class="showcase-device-grid">${list.map(raw=>{const d=effective(raw),s=deviceScene(d),n=s?alarms(s,d).length:0;return `<button class="showcase-device-card" data-showcase-device="${safe(d.id)}"><div class="showcase-device-top"><strong>${safe(d.name)}</strong><span class="showcase-device-status ${d.online?'on':'off'}">${d.online?'● 在线':'● 离线'}</span></div><p>${safe(d.location||d.id)} · ${s?s.metrics.length:0} 项监测指标</p>${n?`<span class="showcase-device-alarm">${n} 项数据异常</span>`:'<span class="showcase-device-ok">数据正常</span>'}<span class="showcase-device-enter">查看数据 ${icon('arrow')}</span></button>`;}).join('')||'<p class="dashboard-empty">本公司暂无设备，请先接入设备。</p>'}</div></div>`;
}
function showcaseDevicePage(d){
 const s=deviceScene(d),metrics=s?s.metrics:[];
 const selected=showcaseMetricKeys.map(key=>metrics.find(m=>m.key===key)).filter(Boolean);
 return `<div class="showcase-root" id="showcase-root"><header class="showcase-head"><div><button class="showcase-back" id="showcase-back">${icon('arrow')} 返回设备列表</button><h1>${safe(d.name)}</h1><p>${safe(d.location||d.id)} · <span class="showcase-device-status ${d.online?'on':'off'}">${d.online?'● 在线':'● 离线'}</span> · ${metrics.length} 项监测指标 · 近 48 小时 · 缺失整点暂用模拟数据（真实数据到达后自动替换）</p></div><div class="showcase-meta"><button class="secondary" id="showcase-present">⛶ 全屏演示</button><button class="secondary" id="showcase-refresh">↻ 刷新数据</button><span class="showcase-updated">更新于 ${new Date().toLocaleTimeString('zh-CN',{hour12:false})}</span></div></header>${metrics.length?`<div class="showcase-metric-tabs" role="group" aria-label="选择要展示的数据">${metrics.map(m=>{const cur=d.values[m.key],on=showcaseMetricKeys.includes(m.key);return `<button type="button" class="showcase-metric-tab${on?' active':''}" data-showcase-metric="${safe(m.key)}" aria-pressed="${on}">${icon(m.icon)}<span>${safe(m.name)}</span><b>${Number.isFinite(cur)?safe(cur):'—'}<small>${safe(m.unit||'')}</small></b>${on?'<i class="showcase-metric-check">✓</i>':''}</button>`;}).join('')}</div>${selected.length?`<div class="showcase-grid">${selected.map(m=>{const v=d.values[m.key],type=showcaseChartType(d.id,m.key),fresh=m.key===showcaseNewKey;return `<section class="showcase-card"><div class="showcase-card-head"><div class="showcase-card-label"><span class="showcase-card-title">${icon(m.icon)} ${safe(m.name)}</span><button type="button" class="showcase-card-switch" data-showcase-switch="${safe(m.key)}" title="切换图表类型">${SHOWCASE_TYPES[type]}</button></div><span class="showcase-card-now">${Number.isFinite(v)?safe(v):'—'} <small>${safe(m.unit||'')}</small></span></div><div class="showcase-chart${fresh?' is-new':''}" id="showcase-chart-${safe(m.key)}" data-metric="${safe(m.key)}" data-chart-type="${type}"></div></section>`;}).join('')}</div>`:'<p class="dashboard-empty">请点击上方指标，选择要展示的数据。</p>'}`:'<p class="dashboard-empty">等待设备首次上报后显示指标。</p>'}</div>`;
}
function showcasePage(){
 const raw=companyDevices().find(d=>d.id===showcaseDeviceId);
 if(!raw){showcaseDeviceId=null;return showcaseDevicePicker();}
 if(showcaseMetricOwner!==raw.id){showcaseMetricOwner=raw.id;showcaseMetricKeys=[];showcaseNewKey='';}
 const scene=deviceScene(raw);
 if(!showcaseMetricKeys.length&&scene?.metrics?.length){showcaseMetricKeys=[scene.metrics[0].key];showcaseNewKey=scene.metrics[0].key;}
 return showcaseDevicePage(effective(raw));
}
function showcaseOption(metric,color,type,min,max){
 type=type||'line';
 const hasRange=Number.isFinite(min)&&Number.isFinite(max);
 if(type==='pie'){
  return {animation:false,
   tooltip:{trigger:'item',backgroundColor:'#ffffff',borderColor:'#dfe5df',textStyle:{color:'#23332a',fontSize:12},
    formatter:p=>`${p.name}<br/>均值 ${p.value} ${metric.unit||''}（${p.percent}%）`},
   series:[{name:metric.name,type:'pie',roseType:'radius',radius:['14%','72%'],center:['50%','52%'],
    itemStyle:{borderColor:'#ffffff',borderWidth:2},avoidLabelOverlap:true,
    label:{show:true,color:'#5c6b60',fontSize:10,formatter:p=>p.value!=null?`${p.name} ${p.value}`:''},
    labelLine:{length:6,length2:8,lineStyle:{color:'#cdd6cd'}},
    data:[]}]};
 }
 return {animation:false,
  grid:{left:52,right:48,top:20,bottom:56},
  tooltip:{trigger:'axis',axisPointer:{type:type==='bar'?'shadow':'line',lineStyle:{color:'#386f52',opacity:.4}},
   backgroundColor:'#ffffff',borderColor:'#dfe5df',textStyle:{color:'#23332a',fontSize:12},
   formatter:params=>{const list=(Array.isArray(params)?params:[params]).filter(p=>Number.isFinite(p.value));if(!list.length)return '';const hit=list[0],bad=hasRange&&(hit.value<min||hit.value>max),tone=bad?'#e03131':'#23332a';const dot=`<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${bad?'#e03131':color};margin-right:6px"></span>`;return `<div style="color:${tone}">${hit.axisValue}<br/>${dot}${metric.name}：${hit.value} ${metric.unit||''}${bad?' <b>（超出范围）</b>':''}</div>`;}},
  xAxis:{type:'category',boundaryGap:type==='bar',data:showcaseSlotLabels(showcaseWindowStart()),axisLine:{lineStyle:{color:'#cdd6cd'}},axisLabel:{color:'#7a8a7d',fontSize:10,rotate:45,interval:0,hideOverlap:false,showMinLabel:true,showMaxLabel:true},splitLine:{show:false}},
  yAxis:{type:'value',scale:true,axisLabel:{color:'#7a8a7d',fontSize:11},splitLine:{lineStyle:{color:'#eef2ee'}}},
  series:[type==='bar'
   ?{name:metric.name,type:'bar',barMaxWidth:14,itemStyle:{color,borderRadius:[4,4,0,0]},data:[]}
   :{name:metric.name,type:'line',smooth:true,smoothMonotone:'x',showSymbol:false,symbol:'circle',symbolSize:7,data:[],lineStyle:{width:2.5,color},itemStyle:{color},areaStyle:{opacity:.08,color}},
   type==='bar'?null:{name:`${metric.name}异常`,type:'line',showSymbol:true,symbol:'circle',symbolSize:9,data:[],lineStyle:{width:0,opacity:0},itemStyle:{color:'#e03131',borderColor:'#ffffff',borderWidth:1.5},z:5}].filter(Boolean)};
}
function disposeShowcase(){
 clearInterval(showcaseState.timer);showcaseState.timer=null;
 showcaseState.observer?.disconnect();showcaseState.observer=null;
 for(const c of showcaseState.charts)try{c.dispose();}catch{}
 showcaseState.charts=[];showcaseState.loadingKey='';
 if(document.body.classList.contains('showcase-presenting'))setShowcasePresent(false);
}
// 全屏演示：铺满整个屏幕，类似 PPT 放映
function setShowcasePresent(on){
 document.body.classList.toggle('showcase-presenting',on);
 const btn=document.querySelector('#showcase-present');
 if(btn)btn.textContent=on?'✕ 退出演示':'⛶ 全屏演示';
 if(on){
  const el=document.documentElement;
  if(el.requestFullscreen)el.requestFullscreen().catch(()=>{});
 }else if(document.fullscreenElement){
  document.exitFullscreen().catch(()=>{});
 }
 setTimeout(()=>{for(const c of showcaseState.charts)try{c.resize();}catch{}},80);
}
document.addEventListener('fullscreenchange',()=>{
 if(!document.fullscreenElement&&document.body.classList.contains('showcase-presenting'))setShowcasePresent(false);
});
// 合并「近 2 天历史 + 内存中最新实时点」，仅在有新点时才 setOption，无动画不闪烁
function showcaseSync(){
 const raw=companyDevices().find(x=>x.id===showcaseDeviceId);
 if(!raw||!window.echarts)return;
 const d=effective(raw),s=deviceScene(d),metrics=s?s.metrics:[];
 const base=showcaseState.baseByKey.get(raw.id);
 const start=showcaseWindowStart(),labels=showcaseSlotLabels(start);
 metrics.forEach(m=>{
  const el=document.querySelector(`#showcase-chart-${CSS.escape(m.key)}`);if(!el)return;
  const chart=echarts.getInstanceByDom(el);if(!chart)return;
  // 历史已是整点均值；实时点按整点聚合后补充历史尚未覆盖的小时
  const byHour=new Map();
  for(const [h,val] of ((base&&base[m.key])||[]))byHour.set(h,val);
  for(const [h,val] of showcaseHourly(showcaseLivePoints(d,m)))if(!byHour.has(h))byHour.set(h,val);
  // 映射到固定 48 个槽位，缺失的小时留空（折线断开，不伪造数据）
  const values=new Array(SHOWCASE_SLOTS).fill(null);
  for(let i=0;i<SHOWCASE_SLOTS;i++){const val=byHour.get(start+i*3600000);if(Number.isFinite(val))values[i]=val;}
  // 整个 48 小时窗口的缺失整点都用虚拟数据补齐；后续真实整点数据到达后自动覆盖
  const cfg=typeof metricConfig==='function'?metricConfig(s,d,m):m;
  for(let i=0;i<SHOWCASE_SLOTS;i++)if(values[i]===null)values[i]=showcaseMockValue(cfg,raw.id,start+i*3600000);
  const v=d.values[m.key],card=el.closest('.showcase-card'),now=card?.querySelector('.showcase-card-now');
  if(now&&Number.isFinite(v)&&now.childNodes[0])now.childNodes[0].nodeValue=`${safe(v)} `; // 当前值只改文本
  const tabVal=document.querySelector(`[data-showcase-metric="${CSS.escape(m.key)}"] b`);
  if(tabVal&&Number.isFinite(v)&&tabVal.childNodes[0])tabVal.childNodes[0].nodeValue=`${safe(v)} `; // 指标标签数值同步
  const type=el.dataset.chartType||'line';
  const stamp=`${type}|${start}|${values.join(',')}`;
  if(el.dataset.stamp===stamp)return; // 无新数据或未切换类型，图表保持不动
  el.dataset.stamp=stamp;
  if(type==='pie'){
   // 饼图：48 个整点按 4 小时一段聚合为 12 个扇区，显示各时段均值占比；超出阈值的时段标红
   const slices=[];
   for(let b=0;b<12;b++){
    const seg=values.slice(b*4,b*4+4).filter(Number.isFinite);
    if(!seg.length)continue;
    const ts=start+b*4*3600000,avg=Math.round(seg.reduce((a,c)=>a+c,0)/seg.length*10)/10;
    const bad=Number.isFinite(cfg.min)&&Number.isFinite(cfg.max)&&(avg<cfg.min||avg>cfg.max);
    slices.push({name:`${showcaseAxisLabel(ts)}~${String((new Date(ts).getHours()+3)%24).padStart(2,'0')}`,value:avg,bad});
   }
   chart.setOption({series:[{data:slices.map((s,i)=>({name:s.name,value:s.value,itemStyle:{color:s.bad?'#e03131':SHOWCASE_PIE_COLORS[i%SHOWCASE_PIE_COLORS.length]}}))}]});
   return;
  }
  const hasRange=Number.isFinite(cfg.min)&&Number.isFinite(cfg.max);
  const isOut=val=>hasRange&&Number.isFinite(val)&&(val<cfg.min||val>cfg.max);
  if(type==='bar'){
   const base=chart.getOption()?.series?.[0]?.itemStyle?.color||'#386f52';
   chart.setOption({xAxis:{boundaryGap:true,data:labels},series:[{data:values.map(val=>({value:val,itemStyle:{color:isOut(val)?'#e03131':base}}))}]});
   return;
  }
  // 折线：底层保持完整连续折线，异常数据点单独用红色圆点标出
  const normal=values.map(val=>Number.isFinite(val)?val:null),alert=new Array(SHOWCASE_SLOTS).fill(null);
  for(let i=0;i<SHOWCASE_SLOTS;i++){
   const val=values[i];
   if(Number.isFinite(val)&&isOut(val))alert[i]=val;
  }
  chart.setOption({xAxis:{boundaryGap:false,data:labels},series:[{data:normal},{data:alert}]});
 });
}
function bindShowcase(){
 const root=document.querySelector('#showcase-root');if(!root){disposeShowcase();return;}
 const raw=companyDevices().find(x=>x.id===showcaseDeviceId);
 if(!raw){ // 设备选择页
  disposeShowcase();
  root.querySelectorAll('[data-showcase-device]').forEach(b=>b.onclick=()=>{showcaseDeviceId=b.dataset.showcaseDevice;render();});
  return;
 }
 const back=document.querySelector('#showcase-back');if(back)back.onclick=()=>{showcaseDeviceId=null;disposeShowcase();render();};
 const present=document.querySelector('#showcase-present');
 if(present){present.textContent=document.body.classList.contains('showcase-presenting')?'✕ 退出演示':'⛶ 全屏演示';present.onclick=()=>setShowcasePresent(!document.body.classList.contains('showcase-presenting'));}
 const refresh=document.querySelector('#showcase-refresh');if(refresh)refresh.onclick=()=>{showcaseState.baseByKey.delete(raw.id);disposeShowcase();render();};
 // 点击指标：已选则移除，未选则追加到下方并播放 1 秒正向展开动画
 root.querySelectorAll('[data-showcase-metric]').forEach(tab=>tab.onclick=()=>{
  const key=tab.dataset.showcaseMetric,index=showcaseMetricKeys.indexOf(key);
  if(index>=0){showcaseMetricKeys.splice(index,1);showcaseNewKey='';}
  else{showcaseMetricKeys.push(key);showcaseNewKey=key;}
  const presenting=document.body.classList.contains('showcase-presenting');
  disposeShowcase();render();if(presenting)setShowcasePresent(true);
 });
 const first=root.querySelector('.showcase-chart');
 // 已初始化（render(true) patch 保留容器）则跳过，绝不自动重绘
 if(first&&window.echarts&&echarts.getInstanceByDom(first)&&showcaseState.charts.length)return;
 disposeShowcase();
 if(!window.echarts){root.querySelectorAll('.showcase-chart').forEach(el=>{el.innerHTML='<p class="showcase-fallback">图表库加载失败，请检查网络后刷新页面。</p>';});return;}
 const d=effective(raw),s=deviceScene(d),metrics=s?s.metrics:[];
 metrics.forEach((m,idx)=>{
  const el=document.querySelector(`#showcase-chart-${CSS.escape(m.key)}`);if(!el)return;
  const color=SHOWCASE_COLORS[idx%SHOWCASE_COLORS.length];
  const cfg=typeof metricConfig==='function'?metricConfig(s,d,m):m;
  const chart=echarts.init(el);chart.setOption(showcaseOption(m,color,showcaseChartType(raw.id,m.key),cfg.min,cfg.max));showcaseState.charts.push(chart);
  const sw=root.querySelector(`[data-showcase-switch="${CSS.escape(m.key)}"]`);
  if(sw)sw.onclick=()=>{
   const key=`${raw.id}|${m.key}`,cur=showcaseChartType(raw.id,m.key),next=SHOWCASE_TYPE_ORDER[(SHOWCASE_TYPE_ORDER.indexOf(cur)+1)%SHOWCASE_TYPE_ORDER.length];
   showcaseChartTypes.set(key,next);
   el.dataset.chartType=next;el.dataset.stamp='';
   sw.textContent=SHOWCASE_TYPES[next];
   chart.setOption(showcaseOption(m,color,next,cfg.min,cfg.max),true);
   showcaseSync();
  };
 });
 // 展开动画只播放一次，避免后续重绘重播
 const freshChart=root.querySelector('.showcase-chart.is-new');
 if(freshChart)setTimeout(()=>freshChart.classList.remove('is-new'),1100);
 showcaseState.observer=new ResizeObserver(()=>{for(const c of showcaseState.charts)try{c.resize();}catch{}});
 showcaseState.observer.observe(root);
 clearInterval(showcaseState.timer);
 showcaseState.timer=setInterval(()=>{if(view!=='whiteboards'){disposeShowcase();return;}showcaseSync();},1500);
 showcaseSync(); // 先用内存实时点立即出图
 // 异步加载近 2 天历史；未加载完成前先用内存中的实时点画图，加载完再补齐
 if(showcaseState.loadingKey!==raw.id&&!showcaseState.baseByKey.has(raw.id)){
  showcaseState.loadingKey=raw.id;
  (async()=>{
   const readings=await showcaseFetchHistory(raw.id);
   if(view!=='whiteboards'||showcaseDeviceId!==raw.id)return;
   showcaseState.baseByKey.set(raw.id,showcaseBuildBase(readings,metrics));
   showcaseSync();
  })();
 }else{
  showcaseSync();
 }
}
function whiteboardListPage(){
 const boards=wbState.boards;
 return heading('SHOWCASE / FREEFORM WHITEBOARD','展示白板','把设备、数据与品牌内容自由编排成专属展示页，一键分享到大屏。',wbCanEdit()?'<div class="wb-create-menu"><button class="primary" id="wb-create">＋ 新建白板 ▾</button><div class="wb-create-dropdown" id="wb-create-dropdown"><button data-wb-create-template>使用牧业示例模板</button><button data-wb-create-blank>从空白画布开始</button></div></div>':'')+
 `<section class="wb-intro"><div><span class="wb-intro-icon">✦</span><div><strong>不只是看板，更是你的数字展厅</strong><p>自由画布 · 图片 / 视频 / 3D 模型 · 实时指标 · 自适应公开分享</p></div></div><span>1600 × 900 逻辑画布</span></section>
 <div class="wb-board-grid">${boards===null?'<div class="wb-loading">正在读取白板…</div>':boards.length?boards.map(b=>`<article class="wb-board-card"><button class="wb-board-preview" data-wb-open="${safe(b.id)}"><span class="wb-mini-canvas"><i></i><i></i><i></i><b>3D</b></span><span class="wb-board-open">打开白板 ${icon('arrow')}</span></button><div class="wb-board-info"><div><h2>${safe(b.title)}</h2><p>${b.updated?new Date(b.updated*1000).toLocaleString('zh-CN',{hour12:false}):'本地演示白板'} · ${b.shareToken?'已开启分享':'未公开'}</p></div><span class="badge ${b.shareToken?'green':'gray'}">${b.shareToken?'公开':'私有'}</span></div><div class="wb-board-actions"><button class="secondary" data-wb-open="${safe(b.id)}">${wbCanEdit()?'编辑':'查看'}</button>${wbCanEdit()?`<button class="secondary" data-wb-duplicate="${safe(b.id)}">复制</button><button class="secondary" data-wb-blank="${safe(b.id)}">清空内容</button><button class="text-button danger-text" data-wb-delete="${safe(b.id)}">删除</button>`:''}</div></article>`).join(''):`<section class="wb-empty"><span>✦</span><h2>创建第一块牧业展示白板</h2><p>已准备好温湿氨气、设备三维模型与品牌排版示例。</p>${wbCanEdit()?'<div class="wb-create-options"><button class="primary" id="wb-create-empty">使用牧业示例模板</button><button class="secondary" id="wb-create-blank">从空白画布开始</button></div>':'<p>本公司还没有已创建的白板。</p>'}</section>`}</div>`;
}
function wbEditorPage(){
 if(!wbState.current)return whiteboardListPage();
 const readonly=!wbCanEdit(),doc=wbState.current.document;
 return `<div class="wb-editor${readonly?' is-readonly':''}"><header class="wb-editor-top"><button class="icon-button" data-route="whiteboards" aria-label="返回白板列表">${icon('arrow')}</button><div class="wb-title-wrap"><span class="wb-live-dot"></span><input id="wb-title" value="${safe(wbState.current.title)}" maxlength="80" ${readonly?'disabled':''} aria-label="白板名称"><small id="wb-save-state">${readonly?'只读预览':wbState.dirty?'有未保存修改':'所有更改已保存'}</small></div><div class="wb-editor-actions">${!readonly?'<button class="secondary" id="wb-undo" title="撤销">↶</button><button class="secondary" id="wb-redo" title="重做">↷</button>':''}<button class="secondary" id="wb-preview">${icon('eye')} 全屏预览</button>${!readonly?`<button class="secondary" id="wb-share">${icon('arrow')} 分享</button><button class="primary" id="wb-save">保存白板</button>`:''}</div></header>
 <div class="wb-editor-body">${!readonly?`<aside class="wb-toolbox"><div class="wb-panel-title"><span>组件库</span><small>点击或拖入画布</small></div>${[['text','T','文字'],['metric','📈','实时指标'],['shape','■','色块'],['background','🖼','背景'],['image','▧','图片'],['video','▶','视频'],['model','◇','3D 设备模型']].map(([type,symbol,label])=>`<button class="wb-component" draggable="true" data-wb-add="${type}"><span>${symbol}</span>${label}<i>＋</i></button>`).join('')}<div class="wb-toolbox-tip">拖动画布组件调整位置<br>使用手柄缩放、旋转与微调</div><input id="wb-file" class="wb-file-input" type="file" tabindex="-1" aria-label="上传白板资源"></aside>`:''}
 <section class="wb-stage"><div class="wb-stage-tools"><span>${readonly?'展示预览':'自由画布'} <i></i> ${doc.elements.length} 个组件</span><div>${!readonly?'<button id="wb-clear" title="清空全部组件" class="danger-text">🗑 清空</button>':''}${!readonly?'<button id="wb-grid" class="active" title="网格吸附"># 网格</button>':''}<button id="wb-zoom-out">−</button><strong id="wb-zoom-label">${Math.round(wbState.zoom*100)}%</strong><button id="wb-zoom-in">＋</button><button id="wb-zoom-fit">适应</button></div></div><div class="wb-viewport" id="wb-viewport"><div class="wb-scaler" id="wb-scaler">${wbCanvasHtml(true)}</div></div></section>
 ${!readonly?'<aside class="wb-inspector" id="wb-inspector"></aside>':''}</div><div id="wb-toast" class="wb-toast" role="status"></div><div id="wb-modal"></div></div>`;
}
function wbToast(message){const el=document.querySelector('#wb-toast');if(!el)return;el.textContent=message;el.classList.add('show');clearTimeout(el._timer);el._timer=setTimeout(()=>el.classList.remove('show'),2600);}
function wbMarkDirty(){wbState.dirty=true;const label=document.querySelector('#wb-save-state');if(label)label.textContent='有未保存修改';}
function wbPushHistory(document=wbState.current.document){wbState.history.push(wbClone(document));if(wbState.history.length>50)wbState.history.shift();wbState.future=[];}
function wbMutate(fn){wbPushHistory();fn();wbMarkDirty();wbRenderCanvas();wbRenderInspector();}
function wbRenderCanvas(){const canvas=document.querySelector('#wb-canvas');if(!canvas)return;const doc=wbState.current.document;canvas.style.background=`linear-gradient(135deg,${doc.canvas.background},${doc.canvas.backgroundEnd})`;canvas.classList.toggle('show-grid',doc.canvas.grid!==false);canvas.innerHTML=doc.elements.slice().sort((a,b)=>a.z-b.z).map(el=>wbElementHtml(el,true)).join('');mountDevice3D(canvas);wbBindElements();}
function wbSelected(){return wbState.current?.document.elements.find(e=>e.id===wbState.selected);}
function wbNumberField(label,key,value,min,max,step=1){return `<label>${label}<input data-wb-prop="${key}" type="number" value="${Number(value)||0}" min="${min}" max="${max}" step="${step}"></label>`;}
function wbRenderInspector(){
 const panel=document.querySelector('#wb-inspector');if(!panel)return;const el=wbSelected(),doc=wbState.current.document;
 if(!el){panel.innerHTML=`<div class="wb-panel-title"><span>画布设置</span><small>1600 × 900</small></div><div class="wb-property-group"><label>背景主色<div class="wb-color"><input id="wb-bg" type="color" value="${safe(doc.canvas.background)}"><code>${safe(doc.canvas.background)}</code></div></label><label>背景渐变色<div class="wb-color"><input id="wb-bg-end" type="color" value="${safe(doc.canvas.backgroundEnd)}"><code>${safe(doc.canvas.backgroundEnd)}</code></div></label><label class="wb-check"><input id="wb-grid-toggle" type="checkbox" ${doc.canvas.grid!==false?'checked':''}> 显示网格并吸附</label></div><div class="wb-help">选择组件后可编辑内容、位置、尺寸、层级与配色。方向键微调，Shift + 方向键移动 10 px。</div>`;wbBindCanvasProps();return;}
 const p=el.props||{},common=`<div class="wb-position-grid">${wbNumberField('X','x',el.x,-4000,8000)}${wbNumberField('Y','y',el.y,-4000,8000)}${wbNumberField('宽','width',el.width,8,4000)}${wbNumberField('高','height',el.height,8,4000)}${wbNumberField('旋转','rotation',el.rotation||0,-360,360)}${wbNumberField('层级','z',el.z||1,0,10000)}</div><label>不透明度 <span>${Math.round((p.opacity??1)*100)}%</span><input data-wb-style-prop="opacity" type="range" min="0.05" max="1" step="0.05" value="${p.opacity??1}"></label>`;
 let specific='';
 if(el.type==='text')specific=`<label>文字内容<textarea data-wb-content rows="4" maxlength="1000">${safe(p.content||'')}</textarea></label><div class="wb-position-grid"><label>字号<input data-wb-style-prop="fontSize" type="number" min="8" max="180" value="${p.fontSize||32}"></label><label>字重<select data-wb-style-prop="fontWeight"><option value="400" ${p.fontWeight==400?'selected':''}>常规</option><option value="600" ${p.fontWeight==600?'selected':''}> semibold</option><option value="700" ${p.fontWeight==700?'selected':''}>粗体</option></select></label></div><label>文字颜色<div class="wb-color"><input data-wb-style-prop="color" type="color" value="${safe(p.color||'#f2f8ed')}"><code>${safe(p.color||'#f2f8ed')}</code></div></label><label>对齐<select data-wb-style-prop="align"><option value="left" ${p.align==='left'?'selected':''}>左对齐</option><option value="center" ${p.align==='center'?'selected':''}>居中</option><option value="right" ${p.align==='right'?'selected':''}>右对齐</option></select></label>`;
 if(el.type==='metric'){const dev=companyDevices().find(d=>d.id===p.deviceId),scene=dev?deviceScene(dev):null,metrics=scene?.metrics||[];specific=`<div class="wb-binding"><strong>实时数据源</strong><label>设备<select data-wb-bind="deviceId"><option value="">请选择设备</option>${companyDevices().map(d=>`<option value="${safe(d.id)}" ${p.deviceId===d.id?'selected':''}>${safe(effective(d).name)} · ${safe(d.id)}</option>`).join('')}</select></label><label>指标<select data-wb-bind="metric"><option value="">请选择指标</option>${metrics.map(m=>`<option value="${safe(m.key)}" ${p.metric===m.key?'selected':''}>${safe(m.name)} (${safe(m.unit||'')})</option>`).join('')}</select></label></div><label>主题配色<select data-wb-style-prop="theme"><option value="cyan" ${p.theme==='cyan'?'selected':''}>科技青</option><option value="green" ${p.theme==='green'?'selected':''}>生态绿</option><option value="amber" ${p.theme==='amber'?'selected':''}>警示橙</option><option value="red" ${p.theme==='red'?'selected':''}>危险红</option></select></label><label class="wb-check"><input data-wb-style-prop="showValue" type="checkbox" ${p.showValue!==false?'checked':''}> 显示数值</label><label class="wb-check"><input data-wb-style-prop="showChart" type="checkbox" ${p.showChart!==false?'checked':''}> 显示折线图</label><p class="wb-help">数据来自设备实时上报，折线图展示最近 20 个采样点。</p>`;}
 if(el.type==='shape')specific=`<label>色块颜色<div class="wb-color"><input data-wb-style-prop="color" type="color" value="${safe(p.color||'#2d8c67')}"><code>${safe(p.color||'#2d8c67')}</code></div></label><label>圆角 <span>${p.radius||0}px</span><input data-wb-style-prop="radius" type="range" min="0" max="400" value="${p.radius||0}"></label>`;
 if(el.type==='background')specific=`<label>背景主色<div class="wb-color"><input data-wb-style-prop="color" type="color" value="${safe(p.color||'#0a1f1a')}"><code>${safe(p.color||'#0a1f1a')}</code></div></label><label class="wb-check"><input data-wb-style-prop="gradient" type="checkbox" ${p.gradient!==false?'checked':''}> 启用渐变</label><label>渐变结束色<div class="wb-color"><input data-wb-style-prop="colorEnd" type="color" value="${safe(p.colorEnd||'#14352a')}"><code>${safe(p.colorEnd||'#14352a')}</code></div></label><label>装饰图案<select data-wb-style-prop="pattern"><option value="none" ${p.pattern==='none'?'selected':''}>无</option><option value="grid" ${p.pattern==='grid'?'selected':''}>科技网格</option><option value="dots" ${p.pattern==='dots'?'selected':''}>点阵</option><option value="circuit" ${p.pattern==='circuit'?'selected':''}>电路板</option></select></label>`;
 if(el.type==='model')specific=`<label class="wb-check"><input data-wb-style-prop="autoRotate" type="checkbox" ${p.autoRotate!==false?'checked':''}> 自动旋转展示</label><button class="secondary wb-upload-replace" data-wb-upload="model">替换 GLB 模型</button><p class="wb-help">GLB 可完整保存材质与网格；展示时拖动旋转、滚轮缩放。</p>`;
 if(el.type==='image')specific=`<label>替代文字<input data-wb-alt value="${safe(p.alt||'')}" maxlength="100"></label><label>填充方式<select data-wb-style-prop="fit"><option value="cover" ${p.fit!=='contain'?'selected':''}>裁切填满</option><option value="contain" ${p.fit==='contain'?'selected':''}>完整包含</option></select></label><button class="secondary wb-upload-replace" data-wb-upload="image">替换图片</button>`;
 if(el.type==='video')specific=`<label class="wb-check"><input data-wb-style-prop="autoplay" type="checkbox" ${p.autoplay!==false?'checked':''}> 自动播放（静音）</label><label class="wb-check"><input data-wb-style-prop="loop" type="checkbox" ${p.loop!==false?'checked':''}> 循环播放</label><button class="secondary wb-upload-replace" data-wb-upload="video">替换视频</button>`;
 const typeLabels={text:'文字',metric:'实时指标',shape:'色块',background:'背景',image:'图片',video:'视频',model:'三维模型'},typeIcons={text:'T',metric:'📈',shape:'■',background:'🖼',image:'▧',video:'▶',model:'◇'};
 const layers=doc.elements.slice().sort((a,b)=>b.z-a.z).map(item=>`<button data-wb-layer="${safe(item.id)}" class="${item.id===el.id?'active':''}"><span>${typeIcons[item.type]||'?'}</span><em>${safe(item.type==='metric'?(wbMetricData(item)?.name||'指标'):item.props?.content?.split('\n')[0]||typeLabels[item.type]||item.type)}</em>${item.id===el.id?'●':''}</button>`).join('');
 panel.innerHTML=`<div class="wb-panel-title"><span>${typeLabels[el.type]||el.type}属性</span><button id="wb-close-props">×</button></div><div class="wb-property-group">${specific}${common}</div><div class="wb-layer-actions"><button id="wb-front" title="置顶">⇧ 置顶</button><button id="wb-up" title="上移一层">↑</button><button id="wb-down" title="下移一层">↓</button><button id="wb-back" title="置底">⇩ 置底</button></div><div class="wb-layer-actions"><button id="wb-lock">${p.locked?'解锁组件':'锁定组件'}</button><button id="wb-duplicate-el">复制组件</button><button id="wb-delete-el" class="danger-text">删除</button></div><div class="wb-layers"><div class="wb-panel-title"><span>图层</span><small>${doc.elements.length}</small></div>${layers}</div>`;
 wbBindInspector();
}
function wbBindCanvasProps(){
 const on=(id,fn)=>{const el=document.querySelector(id);if(el)el.onchange=()=>wbMutate(fn);};on('#wb-bg',()=>wbState.current.document.canvas.background=document.querySelector('#wb-bg').value);on('#wb-bg-end',()=>wbState.current.document.canvas.backgroundEnd=document.querySelector('#wb-bg-end').value);on('#wb-grid-toggle',()=>wbState.current.document.canvas.grid=document.querySelector('#wb-grid-toggle').checked);
}
function wbBindInspector(){
 const el=wbSelected();if(!el)return;const p=el.props;
 document.querySelectorAll('[data-wb-prop]').forEach(input=>input.onchange=()=>wbMutate(()=>{el[input.dataset.wbProp]=Number(input.value);}));
 document.querySelectorAll('[data-wb-style-prop]').forEach(input=>input.onchange=()=>wbMutate(()=>{p[input.dataset.wbStyleProp]=input.type==='checkbox'?input.checked:input.type==='number'||input.type==='range'?Number(input.value):input.value;}));
 const content=document.querySelector('[data-wb-content]');if(content)content.onchange=()=>wbMutate(()=>{p.content=content.value;});
 const alt=document.querySelector('[data-wb-alt]');if(alt)alt.onchange=()=>wbMutate(()=>{p.alt=alt.value;});
 document.querySelectorAll('[data-wb-bind]').forEach(select=>select.onchange=()=>wbMutate(()=>{p[select.dataset.wbBind]=select.value;if(select.dataset.wbBind==='deviceId'){delete p.metric;}}));
 document.querySelectorAll('[data-wb-upload]').forEach(button=>button.onclick=()=>wbChooseFile(button.dataset.wbUpload,true));
 const on=(id,fn)=>{const node=document.querySelector(id);if(node)node.onclick=fn;};on('#wb-close-props',()=>{wbState.selected=null;wbRenderCanvas();wbRenderInspector();});
 on('#wb-front',()=>wbMutate(()=>{el.z=Math.max(...wbState.current.document.elements.map(e=>e.z))+1;}));on('#wb-back',()=>wbMutate(()=>{el.z=Math.min(...wbState.current.document.elements.map(e=>e.z))-1<0?0:Math.min(...wbState.current.document.elements.map(e=>e.z))-1;}));
 on('#wb-up',()=>wbMutate(()=>{el.z=Math.min(10000,el.z+1);}));on('#wb-down',()=>wbMutate(()=>{el.z=Math.max(0,el.z-1);}));
 on('#wb-lock',()=>wbMutate(()=>{p.locked=!p.locked;}));on('#wb-delete-el',()=>wbMutate(()=>{wbState.current.document.elements=wbState.current.document.elements.filter(e=>e.id!==el.id);wbState.selected=null;}));
 on('#wb-duplicate-el',()=>{const copy=wbClone(el);copy.id=wbId();copy.x+=30;copy.y+=30;copy.z=Math.max(...wbState.current.document.elements.map(e=>e.z))+1;wbMutate(()=>{wbState.current.document.elements.push(copy);wbState.selected=copy.id;});});
 document.querySelectorAll('[data-wb-layer]').forEach(button=>button.onclick=()=>{wbState.selected=button.dataset.wbLayer;wbRenderCanvas();wbRenderInspector();});
}
function wbFitCanvas(){const viewport=document.querySelector('#wb-viewport'),canvas=document.querySelector('#wb-canvas'),scaler=document.querySelector('#wb-scaler');if(!viewport||!canvas||!scaler)return;wbState.fit=Math.max(.05,Math.min((viewport.clientWidth-28)/1600,(viewport.clientHeight-28)/900));const scale=wbState.fit*wbState.zoom;scaler.style.width=`${1600*scale}px`;scaler.style.height=`${900*scale}px`;canvas.style.transform=`scale(${scale})`;const label=document.querySelector('#wb-zoom-label');if(label)label.textContent=`${Math.round(wbState.zoom*100)}%`;}
function wbPoint(event){const canvas=document.querySelector('#wb-canvas'),rect=canvas.getBoundingClientRect();return {x:(event.clientX-rect.left)/(rect.width/1600),y:(event.clientY-rect.top)/(rect.height/900)};}
function wbBindElements(){
 if(!wbCanEdit())return;
 const isControl=target=>target.closest('[data-wb-handle],[data-wb-rotate],[data-wb-delete-inline]');
 const is3DCanvas=target=>target.closest('canvas[data-3d-src]');
 document.querySelectorAll('#wb-canvas .wb-element').forEach(node=>{
  node.onpointerdown=event=>{
   if(isControl(event.target))return;
   const el=wbState.current.document.elements.find(e=>e.id===node.dataset.elementId);if(!el)return;
   const fromMoveHandle=!!event.target.closest('[data-wb-move]');
   // For 3D models, only the move handle can drag; canvas is for rotation.
   if(!fromMoveHandle&&is3DCanvas(event.target))return;
   if(el.props.locked)return;
   // Select on first click; if already selected, set up for potential cycle-on-click.
   const wasSelected=wbState.selected===el.id;
   if(!wasSelected){wbState.selected=el.id;wbRenderCanvas();wbRenderInspector();}
   const dragNode=wasSelected?node:document.querySelector(`#wb-canvas [data-element-id="${CSS.escape(el.id)}"]`);
   if(!dragNode)return;
   event.preventDefault();dragNode.setPointerCapture(event.pointerId);
   const start=wbPoint(event),origin={x:el.x,y:el.y},before=wbClone(wbState.current.document);
   let moved=false,threshold=4;
   dragNode.classList.add('dragging');
   dragNode.onpointermove=move=>{
    if(!dragNode.hasPointerCapture(move.pointerId))return;
    const point=wbPoint(move);
    if(Math.abs(point.x-start.x)>threshold||Math.abs(point.y-start.y)>threshold)moved=true;
    const snap=wbState.current.document.canvas.grid!==false?10:1;
    el.x=Math.round((origin.x+point.x-start.x)/snap)*snap;
    el.y=Math.round((origin.y+point.y-start.y)/snap)*snap;
    dragNode.style.left=`${el.x}px`;dragNode.style.top=`${el.y}px`;
    wbMarkDirty();
   };
   dragNode.onpointerup=dragNode.onpointercancel=()=>{
    dragNode.classList.remove('dragging');
    dragNode.onpointermove=dragNode.onpointerup=dragNode.onpointercancel=null;
    if(moved){if(el.x!==origin.x||el.y!==origin.y){wbPushHistory(before);wbRenderInspector();}}
    else if(wasSelected){
     // Pure click on already-selected element: cycle to element below (if any).
     const point=wbPoint(event);
     const under=wbState.current.document.elements.filter(e=>e.id!==el.id&&point.x>=e.x&&point.x<=e.x+e.width&&point.y>=e.y&&point.y<=e.y+e.height).sort((a,b)=>b.z-a.z);
     if(under.length){wbState.selected=under[0].id;wbRenderCanvas();wbRenderInspector();}
    }
   };
  };
 });
 document.querySelectorAll('#wb-canvas [data-wb-delete-inline]').forEach(btn=>btn.onclick=event=>{event.stopPropagation();event.preventDefault();const node=btn.closest('.wb-element');const el=wbState.current?.document.elements.find(e=>e.id===node?.dataset.elementId);if(!el)return;wbMutate(()=>{wbState.current.document.elements=wbState.current.document.elements.filter(e=>e.id!==el.id);wbState.selected=null;});});
 document.querySelectorAll('#wb-canvas [data-wb-handle]').forEach(handle=>handle.onpointerdown=event=>{
  event.preventDefault();event.stopPropagation();const el=wbSelected();if(!el||el.props.locked)return;handle.setPointerCapture(event.pointerId);const direction=handle.dataset.wbHandle,start=wbPoint(event),origin={x:el.x,y:el.y,width:el.width,height:el.height},before=wbClone(wbState.current.document),node=handle.closest('.wb-element');
  handle.onpointermove=move=>{const p=wbPoint(move),dx=p.x-start.x,dy=p.y-start.y;if(direction.includes('e'))el.width=Math.max(20,origin.width+dx);if(direction.includes('s'))el.height=Math.max(20,origin.height+dy);if(direction.includes('w')){el.width=Math.max(20,origin.width-dx);el.x=origin.x+origin.width-el.width;}if(direction.includes('n')){el.height=Math.max(20,origin.height-dy);el.y=origin.y+origin.height-el.height;}node.style.left=`${el.x}px`;node.style.top=`${el.y}px`;node.style.width=`${el.width}px`;node.style.height=`${el.height}px`;wbMarkDirty();};
  handle.onpointerup=handle.onpointercancel=()=>{handle.onpointermove=handle.onpointerup=handle.onpointercancel=null;wbPushHistory(before);wbRenderInspector();};
 });
 const rotate=document.querySelector('#wb-canvas [data-wb-rotate]');if(rotate)rotate.onpointerdown=event=>{event.preventDefault();event.stopPropagation();const el=wbSelected(),node=rotate.closest('.wb-element'),rect=node.getBoundingClientRect(),cx=rect.left+rect.width/2,cy=rect.top+rect.height/2,before=wbClone(wbState.current.document);rotate.setPointerCapture(event.pointerId);rotate.onpointermove=move=>{el.rotation=Math.round(Math.atan2(move.clientY-cy,move.clientX-cx)*180/Math.PI+90);node.style.transform=`rotate(${el.rotation}deg)`;wbMarkDirty();};rotate.onpointerup=()=>{rotate.onpointermove=rotate.onpointerup=null;wbPushHistory(before);wbRenderInspector();};};
 const canvas=document.querySelector('#wb-canvas');canvas.onpointerdown=event=>{if(event.target===canvas){wbState.selected=null;wbRenderCanvas();wbRenderInspector();}};canvas.ondragover=event=>event.preventDefault();canvas.ondrop=event=>{event.preventDefault();const type=event.dataTransfer.getData('application/x-livestock-board');if(!type)return;wbState.dropPosition=wbPoint(event);if(['image','video'].includes(type))wbChooseFile(type,false);else wbAddElement(type);};
}
function wbAddElement(type,src){if(!wbCanEdit())return;const pos=wbState.dropPosition||{};wbMutate(()=>{const el=wbNewElement(type,{...pos,src});wbState.current.document.elements.push(el);wbState.selected=el.id;});wbState.dropPosition=null;}
function wbChooseFile(type,replace=false){const input=document.querySelector('#wb-file');if(!input)return;input.accept=type==='image'?'image/png,image/jpeg,image/webp,image/gif':type==='video'?'video/mp4,video/webm':'.glb';input.onchange=async()=>{const file=input.files[0];input.value='';if(!file)return;try{wbToast('正在上传资源…');const src=await wbUploadAsset(file);if(replace&&wbSelected())wbMutate(()=>{wbSelected().props.src=src;});else wbAddElement(type,src);wbToast('资源已添加');}catch(error){wbToast(error.message);}};input.click();}
async function wbUploadAsset(file){
 if(!platformBackend){if(file.size>8*1024*1024)throw new Error('静态演示模式单个资源最大 8 MB。');return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('资源读取失败。'));reader.readAsDataURL(file);});}
 const response=await fetch(`./api/whiteboards/assets?name=${encodeURIComponent(file.name)}`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':file.type||'application/octet-stream'},body:file});const data=await response.json();if(!response.ok)throw new Error(data.error||'资源上传失败。');return data.asset.url;
}
async function wbLoadList(force=false){if(wbState.boards!==null&&!force)return;try{if(platformBackend){wbState.boards=(await platformRequest('whiteboards')).boards;}else wbState.boards=wbLocalBoards();if(view==='whiteboards')render();}catch(error){wbState.boards=[];if(view==='whiteboards'){notice=error.message;render();}}}
async function wbGetBoard(id){if(platformBackend)return (await platformRequest(`whiteboards/${encodeURIComponent(id)}`)).board;const board=wbLocalBoards().find(b=>b.id===id);if(!board)throw new Error('白板不存在。');return wbClone(board);}
async function wbOpen(id){try{const board=await wbGetBoard(id);wbState.current=board;wbState.selected=null;wbState.dirty=false;wbState.history=[];wbState.future=[];wbState.zoom=1;view='whiteboard-editor';render();window.scrollTo(0,0);}catch(error){notice=error.message;render();}}
function wbCreate(blank=false){wbState.current={id:null,title:blank?'空白展示白板':'牧业链 · 智慧养殖展示',document:blank?wbBlankDocument():wbDefaultDocument(),shareToken:null};wbState.selected=null;wbState.dirty=true;wbState.history=[];wbState.zoom=1;view='whiteboard-editor';render();}
function wbClearCanvas(){if(!wbState.current||!wbState.current.document.elements.length)return;if(!window.confirm('确定清空画布上的所有组件？此操作可撤销。'))return;wbMutate(()=>{wbState.current.document.elements=[];wbState.selected=null;});wbToast('画布已清空，可从左侧组件库添加内容');}
async function wbSave(showToast=true){if(!wbCanEdit()||!wbState.current)return null;const title=document.querySelector('#wb-title')?.value.trim()||wbState.current.title;if(!title)throw new Error('请输入白板名称。');wbState.current.title=title;wbState.current.document.title=title;let saved;if(platformBackend){saved=(await platformRequest('whiteboards',{method:'POST',body:JSON.stringify({id:wbState.current.id,title,document:wbState.current.document})})).board;}else{saved={...wbClone(wbState.current),id:wbState.current.id||`board-local-${Date.now().toString(36)}`,updated:Date.now()/1000};const rows=wbLocalBoards(),index=rows.findIndex(b=>b.id===saved.id);if(index>=0)rows[index]=saved;else rows.unshift(saved);wbSaveLocalBoards(rows);}wbState.current=saved;wbState.dirty=false;wbState.boards=null;const label=document.querySelector('#wb-save-state');if(label)label.textContent='所有更改已保存';if(showToast)wbToast('白板已保存，可随时分享展示');return saved;}
async function wbDelete(id){if(!window.confirm('确定删除这块白板？公开分享链接也会失效。'))return;try{if(platformBackend)await platformRequest(`whiteboards/${encodeURIComponent(id)}/delete`,{method:'POST',body:'{}'});else wbSaveLocalBoards(wbLocalBoards().filter(b=>b.id!==id));wbState.boards=null;notice='白板已删除。';await wbLoadList(true);}catch(error){notice=error.message;render();}}
async function wbDuplicate(id){try{const board=await wbGetBoard(id);board.id=null;board.title=`${board.title} · 副本`;board.document.title=board.title;board.shareToken=null;wbState.current=board;wbState.dirty=true;wbState.history=[];view='whiteboard-editor';render();}catch(error){wbToast(error.message);}}
async function wbBlankBoard(id){if(!window.confirm('确定清空该白板的所有内容？将保留白板本身，可重新编辑。'))return;try{const board=await wbGetBoard(id);board.document=wbBlankDocument(board.title);board.document.title=board.title;wbState.current=board;wbState.dirty=true;wbState.history=[];view='whiteboard-editor';render();wbToast('已清空内容，从空白画布开始');}catch(error){wbToast(error.message);}}
async function wbShare(){
 try{
  let saved=await wbSave(false),token=saved.shareToken;
  if(!token){
   if(platformBackend)saved=(await platformRequest(`whiteboards/${encodeURIComponent(saved.id)}/share`,{method:'POST',body:JSON.stringify({enabled:true})})).board;
   else{const bytes=new Uint8Array(24);crypto.getRandomValues(bytes);saved.shareToken=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');const rows=wbLocalBoards(),index=rows.findIndex(b=>b.id===saved.id);rows[index]=saved;wbSaveLocalBoards(rows);}
   token=saved.shareToken;
  }
  wbState.current=saved;wbState.boards=null;
  const url=`${location.origin}${location.pathname}?showcase=${encodeURIComponent(token)}`,modal=document.querySelector('#wb-modal');
  modal.innerHTML=`<div class="wb-modal-backdrop"><section class="wb-share-dialog"><button class="wb-modal-close" aria-label="关闭">×</button><span class="wb-share-symbol">↗</span><h2>展示页面已公开</h2><p>任何获得链接的人都能查看，无需登录。链接只包含展示内容与绑定的实时指标。</p><div class="wb-share-url"><input readonly value="${safe(url)}" id="wb-share-link"><button class="primary" id="wb-copy-link">复制链接</button></div><div class="wb-share-actions"><button class="secondary" id="wb-open-share">打开公开页</button><button class="text-button danger-text" id="wb-revoke-share">取消公开分享</button><button class="text-button" id="wb-close-share">完成</button></div></section></div>`;
  const close=()=>{modal.innerHTML='';};modal.querySelector('.wb-modal-close').onclick=close;modal.querySelector('#wb-close-share').onclick=close;modal.querySelector('#wb-open-share').onclick=()=>window.open(url,'_blank','noopener');modal.querySelector('#wb-revoke-share').onclick=wbRevokeShare;
  modal.querySelector('#wb-copy-link').onclick=async()=>{try{await navigator.clipboard.writeText(url);wbToast('链接已复制');}catch{modal.querySelector('#wb-share-link').select();document.execCommand('copy');}};
 }catch(error){wbToast(error.message);}
}
async function wbRevokeShare(){
 if(!wbState.current?.shareToken||!window.confirm('确定取消公开分享？原链接将立即失效。'))return;
 try{
  let saved;if(platformBackend)saved=(await platformRequest(`whiteboards/${encodeURIComponent(wbState.current.id)}/share`,{method:'POST',body:JSON.stringify({enabled:false})})).board;
  else{saved={...wbClone(wbState.current),shareToken:null};const rows=wbLocalBoards(),index=rows.findIndex(b=>b.id===saved.id);if(index>=0)rows[index]=saved;wbSaveLocalBoards(rows);}
  wbState.current=saved;wbState.boards=null;document.querySelector('#wb-modal').innerHTML='';wbToast('公开分享已取消，原链接已失效');
 }catch(error){wbToast(error.message);}
}
function wbPreview(){const modal=document.querySelector('#wb-modal');modal.innerHTML=`<div class="wb-full-preview"><header><strong>${safe(wbState.current.title)}</strong><button class="secondary" id="wb-close-preview">退出全屏预览 ×</button></header><div class="wb-preview-viewport" id="wb-preview-viewport"><div class="wb-preview-scaler" id="wb-preview-scaler">${wbCanvasHtml(false).replace('wb-public-canvas','wb-preview-canvas')}</div></div></div>`;const fit=()=>{const viewport=document.querySelector('#wb-preview-viewport'),canvas=document.querySelector('#wb-preview-canvas'),scaler=document.querySelector('#wb-preview-scaler');if(!viewport||!canvas)return;const scale=Math.min(viewport.clientWidth/1600,viewport.clientHeight/900);scaler.style.width=`${1600*scale}px`;scaler.style.height=`${900*scale}px`;canvas.style.transform=`scale(${scale})`;};fit();wbState.previewObserver?.disconnect();wbState.previewObserver=new ResizeObserver(fit);wbState.previewObserver.observe(document.querySelector('#wb-preview-viewport'));mountDevice3D(modal);document.querySelector('#wb-close-preview').onclick=()=>{wbState.previewObserver?.disconnect();modal.innerHTML='';};}
function wbUndo(){if(!wbState.history.length)return;wbState.future.push(wbClone(wbState.current.document));wbState.current.document=wbState.history.pop();wbState.selected=null;wbMarkDirty();wbRenderCanvas();wbRenderInspector();}
function wbRedo(){if(!wbState.future.length)return;wbState.history.push(wbClone(wbState.current.document));wbState.current.document=wbState.future.pop();wbState.selected=null;wbMarkDirty();wbRenderCanvas();wbRenderInspector();}
function bindWhiteboard(){
 wbState.observer?.disconnect();if(view!=='whiteboards')disposeShowcase();if(view==='whiteboards'){bindShowcase();return;}
 if(view!=='whiteboard-editor'||!wbState.current)return;wbRenderInspector();wbFitCanvas();mountDevice3D(document.querySelector('#wb-canvas'));wbBindElements();wbState.observer=new ResizeObserver(wbFitCanvas);wbState.observer.observe(document.querySelector('#wb-viewport'));
 document.querySelectorAll('[data-wb-add]').forEach(button=>{button.onclick=()=>{if(['image','video'].includes(button.dataset.wbAdd))wbChooseFile(button.dataset.wbAdd,false);else wbAddElement(button.dataset.wbAdd);};button.ondragstart=event=>event.dataTransfer.setData('application/x-livestock-board',button.dataset.wbAdd);});
 const on=(id,fn)=>{const el=document.querySelector(id);if(el)el.onclick=fn;};on('#wb-save',()=>wbSave().catch(error=>wbToast(error.message)));on('#wb-share',wbShare);on('#wb-preview',wbPreview);on('#wb-undo',wbUndo);on('#wb-redo',wbRedo);on('#wb-clear',wbClearCanvas);on('#wb-zoom-in',()=>{wbState.zoom=Math.min(2.5,wbState.zoom+.1);wbFitCanvas();});on('#wb-zoom-out',()=>{wbState.zoom=Math.max(.25,wbState.zoom-.1);wbFitCanvas();});on('#wb-zoom-fit',()=>{wbState.zoom=1;wbFitCanvas();});on('#wb-grid',()=>wbMutate(()=>wbState.current.document.canvas.grid=!wbState.current.document.canvas.grid));
 const title=document.querySelector('#wb-title');if(title)title.oninput=()=>{wbState.current.title=title.value;wbMarkDirty();};
 document.onkeydown=event=>{if(view!=='whiteboard-editor'||!wbCanEdit()||event.target.closest('input,textarea,select'))return;const el=wbSelected();if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();wbSave().catch(e=>wbToast(e.message));return;}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();event.shiftKey?wbRedo():wbUndo();return;}if(!el||el.props.locked)return;if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();wbMutate(()=>{const n=event.shiftKey?10:1;if(event.key==='ArrowLeft')el.x-=n;if(event.key==='ArrowRight')el.x+=n;if(event.key==='ArrowUp')el.y-=n;if(event.key==='ArrowDown')el.y+=n;});}if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();wbMutate(()=>{wbState.current.document.elements=wbState.current.document.elements.filter(e=>e.id!==el.id);wbState.selected=null;});}};
}
function wbPublicDevices(rows){return rows.map(raw=>{const d={...raw,mqtt:true,values:{},history:{},online:false};let last=0;for(const reading of raw.readings||[]){const parsed=parseTelemetry(reading.payload);if(!parsed.metrics.length)continue;applyTelemetry(d,{...parsed,time:new Date(reading.received*1000).toISOString(),sequence:reading.sequence,retained:false});last=reading.received;}d.online=!!last&&Date.now()-last*1000<Math.max(15000,(raw.sampleInterval||30)*3000);return d;});}
function wbPublicFit(){const viewport=document.querySelector('#wb-public-viewport'),canvas=document.querySelector('#wb-public-canvas'),scaler=document.querySelector('#wb-public-scaler');if(!viewport||!canvas||!scaler)return;const scale=Math.min(viewport.clientWidth/1600,viewport.clientHeight/900);scaler.style.width=`${1600*scale}px`;scaler.style.height=`${900*scale}px`;canvas.style.transform=`scale(${scale})`;}
function wbRenderPublic(){app.innerHTML=`<main class="wb-public"><header><a class="wb-public-brand" href="./"><span>${icon('environment')}</span><div><strong>牧源养殖</strong><small>LIVESTOCK · DIGITAL SHOWCASE</small></div></a><div class="wb-public-title"><i></i>${safe(wbState.current.title)}</div><span class="wb-public-live">● LIVE DISPLAY</span></header><div class="wb-public-viewport" id="wb-public-viewport"><div class="wb-public-scaler" id="wb-public-scaler">${wbCanvasHtml(false)}</div></div><footer><span>牧业供应链物联网平台 · 数据驱动每一次生长</span><span>自适应展示 · ${new Date().toLocaleDateString('zh-CN')}</span></footer></main>`;wbState.public=true;wbPublicFit();mountDevice3D(app);wbState.observer=new ResizeObserver(wbPublicFit);wbState.observer.observe(document.querySelector('#wb-public-viewport'));}
function wbRefreshLiveNodes(){
 const doc=wbState.current?.document;if(!doc)return;
 for(const el of doc.elements){
  if(el.type!=='text'&&el.type!=='metric')continue;
  const node=document.querySelector(`[data-live-value="${CSS.escape(el.id)}"]`);if(!node)continue;
  if(el.type==='metric')node.innerHTML=wbMetricChart(el,el.width,el.height);
  else node.textContent=wbTextContent(el);
 }
}
async function wbRefreshPublic(){if(!wbState.public||!platformBackend)return;try{const board=(await platformRequest(`whiteboards/public/${encodeURIComponent(wbState.token)}`)).board;wbState.runtimeDevices=wbPublicDevices(board.devices);if(typeof liveReapply==='function')liveReapply();wbRefreshLiveNodes();}catch{}}
async function initPublicWhiteboard(token){
 wbState.public=true;wbState.token=token;app.innerHTML='<main class="wb-public-loading"><span></span><h1>正在连接数字展厅</h1><p>加载展示页面与实时设备数据…</p></main>';
 try{let board;if(platformBackend){board=(await platformRequest(`whiteboards/public/${encodeURIComponent(token)}`)).board;wbState.runtimeDevices=wbPublicDevices(board.devices);}else{board=wbLocalBoards().find(b=>b.shareToken===token);if(!board)throw new Error('展示链接无效或已取消分享。');const data=await readJson('./devices.json');devices=data.devices;scenes=data.scenes;wbState.runtimeDevices=devices;}wbState.current=board;wbRenderPublic();clearInterval(wbState.timer);wbState.timer=setInterval(platformBackend?wbRefreshPublic:()=>{if(!document.hidden)wbRefreshLiveNodes();},platformBackend?5000:1500);}catch(error){app.innerHTML=`<main class="wb-public-loading"><span>!</span><h1>展示页面不可用</h1><p>${safe(error.message)}</p><a class="primary" href="./">返回平台首页</a></main>`;}
}
