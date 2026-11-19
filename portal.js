/* Login, company routing and declarative Markdown workspaces. */
/* 侧边栏区块导航依赖即时滚动，否则 navigate 的 scrollTo 与 scrollIntoView 会互相打断。 */
document.documentElement.style.setProperty('scroll-behavior','auto','important');
let platform={chains:[],categories:[],companies:[],news:[]};
let companyId=null,chainId=null,categoryId=null,companyTab='home',testMode='mqtt';
let authMode='login',templateDraft=null,templates={},templateErrors={};
const registeredKey='iot-registered-customers-v1',templateKey='iot-company-templates-v1';
const isAdmin=()=>currentUser?.role==='admin';
const company=()=>platform.companies.find(c=>c.id===companyId);
const companyDevices=()=>devices.filter(d=>d.companyId===companyId && (isAdmin()||d.companyId===currentUser?.companyId));
const warningDevices=()=>companyDevices().filter(d=>d.online&&alarms(deviceScene(d),effective(d)).length);
/* Browser-local device inventory; all mutations stay within the developer's company. */
const inventoryKey='iot-device-inventory-v1';
let baseDevices=[],pendingDeleteId=null;
const canManageDevices=()=>['company_admin','developer'].includes(currentUser?.role)&&currentUser.companyId===companyId&&!!company();
function availableDeviceScenes(ownerId=companyId){
 if(platformBackend)return scenes;
 const owner=platform.companies.find(c=>c.id===ownerId),category=platform.categories.find(c=>c.id===owner?.categoryId);
 const ids=category?.sceneIds||baseDevices.filter(d=>d.companyId===ownerId).map(d=>d.sceneId);
 return scenes.filter(s=>ids.includes(s.id));
}
function normalizeNewDevice(input,ownerId){
 const id=typeof input?.id==='string'?input.id.trim():'',name=typeof input?.name==='string'?input.name.trim():'',location=typeof input?.location==='string'?input.location.trim():'';
 const interval=Number(input?.sampleInterval),s=availableDeviceScenes(ownerId).find(s=>s.id===input?.sceneId);
 if(!/^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$/.test(id))throw new Error('设备 ID 请使用 3–40 位字母、数字、短横线或下划线。');
 if(!name||name.length>40||!location||location.length>80)throw new Error('请填写设备名称（最多 40 字）和安装位置（最多 80 字）。');
 if(!s)throw new Error('请选择本公司业务场景支持的设备类型。');
 if(!Number.isInteger(interval)||interval<1||interval>3600)throw new Error('采样周期应为 1–3600 秒的整数。');
 const d={id,companyId:ownerId,sceneId:s.id,name,location,sampleInterval:interval,online:false,values:Object.fromEntries(s.metrics.map(m=>[m.key,null])),history:Object.fromEntries(s.metrics.map(m=>[m.key,[]])),diagnostics:[{type:'WAITING_FOR_DATA',level:'info',message:'尚未接入数据，请配置实际设备采集。',source:'本地设备登记'}]};
 if(input.mqtt){
  const binding=input.mqtt,row=telemetryCandidate({topic:binding.topic,text:binding.sample});
  if(!row||row.key!==binding.key)throw new Error('MQTT 设备绑定信息无效。');
  d.mqtt={key:row.key,topic:row.topic,sample:row.text};d.metrics=row.metrics;
  d.values=Object.fromEntries(row.metrics.map(m=>[m.key,null]));d.history=Object.fromEntries(row.metrics.map(m=>[m.key,[]]));
  d.diagnostics=[];
 }
 return d;
}
function inventoryState(){
 const raw=readStorage(inventoryKey,{}),added=[],removed=[],ids=new Set(baseDevices.map(d=>d.id.toLowerCase()));
 for(const input of Array.isArray(raw?.added)?raw.added:[]){
  try{const d=normalizeNewDevice(input,input.companyId);if(ids.has(d.id.toLowerCase()))continue;ids.add(d.id.toLowerCase());added.push(d);}catch{}
 }
 for(const row of Array.isArray(raw?.removed)?raw.removed:[]){
  if(!row||removed.some(x=>x.id===row.id))continue;
  if([...baseDevices,...added].some(d=>d.id===row.id&&d.companyId===row.companyId))removed.push({id:row.id,companyId:row.companyId});
 }
 return {added,removed};
}
function reloadInventory(){if(platformBackend){devices=devices.filter(d=>d.provisioned);return;}const registered=devices.filter(d=>d.provisioned);const state=inventoryState(),previous=new Map(devices.map(d=>[d.id,d]));devices=[...baseDevices,...state.added].filter(d=>!state.removed.some(r=>r.id===d.id&&r.companyId===d.companyId));for(const d of devices)if(d.mqtt){const old=previous.get(d.id);if(old?.mqtt?.key===d.mqtt.key){d.history=old.history;d.historyTimes=old.historyTimes;d.lastMessage=old.lastMessage;}applyTelemetry(d,mqttCandidates.get(d.mqtt.key));}devices.push(...registered);}
function saveInventory(state){localStorage.setItem(inventoryKey,JSON.stringify(state));reloadInventory();}
function addCompanyDevice(input){
 if(!canManageDevices())throw new Error('仅本公司客户开发者可以管理设备。');
 const row=mqttCandidates.get(input?.mqttKey);
 if(!mqttFresh(row,Number(input?.sampleInterval)))throw new Error('请先读取 MQTT 设备，并选择最近实际收到上报的设备。');
 const d=normalizeNewDevice({...input,mqtt:{key:row.key,topic:row.topic,sample:row.text}},currentUser.companyId),state=inventoryState();
 if([...baseDevices,...state.added].some(d=>d.mqtt?.key===row.key))throw new Error('该 MQTT 设备已存在，请查看或恢复原设备。');
 if([...baseDevices,...state.added].some(row=>row.id.toLowerCase()===d.id.toLowerCase()))throw new Error('设备 ID 已存在（含已删除设备），请使用新 ID 或恢复原设备。');
 state.added.push(d);saveInventory(state);return devices.find(row=>row.id===d.id);
}
function removeCompanyDevice(id){
 if(!canManageDevices()||!companyDevices().some(d=>d.id===id))throw new Error('只能删除本公司的设备。');
 const state=inventoryState();state.removed.push({id,companyId});saveInventory(state);if(overviewDeviceId===id)overviewDeviceId=null;
}
function restoreCompanyDevice(id){
 if(!canManageDevices())throw new Error('仅本公司客户开发者可以管理设备。');
 const state=inventoryState();if(!state.removed.some(r=>r.id===id&&r.companyId===companyId))throw new Error('未找到本公司已删除的设备。');
 state.removed=state.removed.filter(r=>!(r.id===id&&r.companyId===companyId));saveInventory(state);
}
function deviceManagementPage(){
 if(!canManageDevices())return '';
 if(platformBackend)return provisionedManagementPage();
 const state=inventoryState(),deleted=[...baseDevices,...state.added].filter(d=>state.removed.some(r=>r.id===d.id&&r.companyId===companyId)),pending=companyDevices().find(d=>d.id===pendingDeleteId);
 return heading('COMPANY / DEVICE MANAGEMENT','设备管理',`${safe(company()?.name)} · 添加、删除和维护本公司设备。`,'<button class="secondary" data-route="company">返回工作台</button>')+`<div class="inventory-layout"><section class="panel inventory-form-panel"><h2>发现并添加设备</h2><div id="mqtt-discovery">${mqttDiscoveryHtml()}</div><p id="mqtt-selection" role="status">先选择已上报的设备，再填写归属信息。</p><form id="add-device-form"><input type="hidden" name="mqttKey"><fieldset disabled><label for="new-device-id">设备 ID</label><input id="new-device-id" name="id" required minlength="3" maxlength="40" pattern="[A-Za-z0-9][A-Za-z0-9_-]{2,39}" placeholder="例如 ENV-004"><label for="new-device-name">设备名称</label><input id="new-device-name" name="name" maxlength="40" required placeholder="请输入设备名称"><label for="new-device-scene">设备类型</label><select id="new-device-scene" name="sceneId" required>${availableDeviceScenes().map(s=>`<option value="${safe(s.id)}">${safe(s.name)}</option>`).join('')}</select><label for="new-device-location">安装位置</label><input id="new-device-location" name="location" required maxlength="80" placeholder="例如 4 号猪舍 · 环境采集点 1"><label for="new-device-interval">采样周期（秒）</label><input id="new-device-interval" name="sampleInterval" type="number" min="1" max="3600" step="1" value="30" required><p id="inventory-error" class="error" role="alert"></p><button class="primary" type="submit">添加到本公司</button></fieldset></form><p class="settings-note">监测指标由设备实际上报自动识别；保留消息仅作预览，收到新上报后才能添加。</p></section><div class="inventory-lists"><section class="panel inventory-list-panel"><div class="section-heading"><h2>公司设备 <small>${companyDevices().length} 台</small></h2><button class="secondary" id="export-inventory">导出 JSON</button></div>${pending?`<section class="inventory-confirm" role="alertdialog" aria-label="确认删除设备"><strong>删除 ${safe(effective(pending).name)}？</strong><p>设备将从当前浏览器的监测列表移除，可在下方恢复。</p><button class="danger-button" id="confirm-delete-device">确认删除</button><button class="secondary" id="cancel-delete-device">取消</button></section>`:''}<div class="table-wrap"><table class="inventory-table"><thead><tr><th>设备 / ID</th><th>类型 / 位置</th><th>操作</th></tr></thead><tbody>${companyDevices().map(raw=>{const d=effective(raw);return `<tr><td><strong>${safe(d.name)}</strong><small>${safe(d.id)}</small></td><td>${safe(deviceScene(d)?.name)}<small>${safe(d.location)}</small></td><td><button class="dashboard-text-link" data-device="${safe(d.id)}">配置</button><button class="danger-button" data-delete-device="${safe(d.id)}">删除</button></td></tr>`;}).join('')||'<tr><td colspan="3">暂无设备，请先添加设备。</td></tr>'}</tbody></table></div></section><section class="panel inventory-list-panel"><h2>已删除设备 <small>${deleted.length} 台</small></h2>${deleted.map(d=>`<div class="inventory-deleted"><span>${safe(effective(d).name)}<small>${safe(d.id)}</small></span><button class="secondary" data-restore-device="${safe(d.id)}">恢复设备</button></div>`).join('')||'<p class="muted">暂无已删除设备。</p>'}</section></div></div><p class="settings-note">添加、删除及恢复仅保存于当前浏览器，刷新后保留。导出 devices.json 并替换项目文件、重新部署后，其他浏览器才能读取更新。</p>`;
}
function bindDeviceManagement(){
 if(platformBackend){bindProvisioning();return;}
 const form=document.querySelector('#add-device-form');
 if(view==='device-manage')updateMqttDiscovery();
 if(form)form.onsubmit=event=>{event.preventDefault();try{const fields=new FormData(form);addCompanyDevice(Object.fromEntries(fields));notice='设备已绑定 MQTT，将按实际上报动态更新监测数据。';render();}catch(e){document.querySelector('#inventory-error').textContent=e.message;}};
 document.querySelectorAll('[data-delete-device]').forEach(b=>b.onclick=()=>{if(!canManageDevices())return;pendingDeleteId=b.dataset.deleteDevice;render();document.querySelector('.inventory-confirm')?.scrollIntoView({block:'center'});});
 const confirm=document.querySelector('#confirm-delete-device');if(confirm)confirm.onclick=()=>{try{removeCompanyDevice(pendingDeleteId);pendingDeleteId=null;notice='设备已移除，可在已删除设备中恢复。';render();}catch(e){notice=e.message;render();}};
 const cancel=document.querySelector('#cancel-delete-device');if(cancel)cancel.onclick=()=>{pendingDeleteId=null;render();};
 document.querySelectorAll('[data-restore-device]').forEach(b=>b.onclick=()=>{try{restoreCompanyDevice(b.dataset.restoreDevice);notice='设备已恢复。';render();}catch(e){notice=e.message;render();}});
 const exportButton=document.querySelector('#export-inventory');if(exportButton)exportButton.onclick=()=>{if(canManageDevices())downloadDeviceConfig();};
}

function registeredUsers(){
 const rows=readStorage(registeredKey,[]);
 return Array.isArray(rows)?rows.filter(u=>u&&typeof u.username==='string'&&platform.companies.some(c=>c.id===u.companyId)&&!users.some(v=>v.username===u.username||v.id===u.id)).map(u=>({...u,role:'customer'})):[];
}
function allUsers(){return [...users,...registeredUsers()];}
function normalizeUser(u){return {...u,role:validRole(u.role)};}
function logo(){return `<span class="brand-mark">${icon('environment')}</span><span class="brand-name">供应链物联网平台</span>`;}
function heading(kicker,title,description,extra=''){return `<div class="page-heading"><div><div class="eyebrow">${kicker}</div><h1 tabindex="-1">${title}</h1><p>${description}</p></div>${extra}</div>`;}
function navigate(next){view=next;notice='';templateDraft=null;render();window.scrollTo(0,0);if(next==='organization'&&canOrganize())refreshOrganizationView();}
function openCompany(id){
 const c=platform.companies.find(c=>c.id===id);
 if(!c||(!isAdmin()&&id!==currentUser?.companyId))return;
 companyId=id;categoryId=c.categoryId;chainId=platform.categories.find(x=>x.id===categoryId)?.chainId;companyTab='home';navigate('company');
}
function openDevice(id){
 const d=companyDevices().find(d=>d.id===id);if(!d)return;
 deviceId=d.id;sceneId=d.sceneId;navigate('detail');
}
function openAdminDevice(id){
 if(!isAdmin())return;const d=devices.find(d=>d.id===id);
 if(!d||!platform.companies.some(c=>c.id===d.companyId))return;
 openCompany(d.companyId);openDevice(d.id);
}
function openWarnings(){const list=warningDevices();if(list.length===1)return openDevice(list[0].id);navigate('alerts');}
function parseTemplate(raw){
 const blocks=[...raw.matchAll(/```dashboard\s*\n([\s\S]*?)```/g)];
 if(blocks.length!==1)throw new Error('需要且只能有一个 dashboard JSON 配置块。');
 let cfg;try{cfg=JSON.parse(blocks[0][1]);}catch{throw new Error('dashboard 配置必须是有效的 JSON。');}
 if(!cfg||Array.isArray(cfg)||typeof cfg!=='object')throw new Error('dashboard 必须是配置对象。');
 if(typeof cfg.title!=='string'||!cfg.title.trim()||typeof cfg.subtitle!=='string')throw new Error('请填写 title 和 subtitle 字符串。');
 if(!['green','blue','purple','orange'].includes(cfg.accent))throw new Error('accent 支持 green、blue、purple、orange。');
 if(!Array.isArray(cfg.widgets)||cfg.widgets.some(w=>!['total','online','alerts'].includes(w))||new Set(cfg.widgets).size!==cfg.widgets.length)throw new Error('widgets 仅支持不重复的 total、online、alerts。');
 if(typeof cfg.showDevices!=='boolean')throw new Error('showDevices 必须为 true 或 false。');
 return {config:cfg,body:raw.replace(blocks[0][0],'').trim()};
}
function markdown(raw){
 const inline=t=>safe(t).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
 let list=false,html='';
 for(const line of raw.split('\n')){
  if(line.startsWith('- ')){if(!list){html+='<ul>';list=true;}html+=`<li>${inline(line.slice(2))}</li>`;continue;}
  if(list){html+='</ul>';list=false;}
  const h=line.match(/^(#{1,3})\s+(.+)$/);
  if(h){const level=h[1].length+1;html+=`<h${level}>${inline(h[2])}</h${level}>`;}
  else if(line.trim())html+=`<p>${inline(line)}</p>`;
 }
 return html+(list?'</ul>':'');
}
function rawTemplate(id){const saved=readStorage(templateKey,{});return typeof saved[id]==='string'?saved[id]:templates[id];}
function workspaceTemplate(){if(platformBackend&&typeof templates[companyId]==='string')return parseTemplate(templates[companyId]);if(platformBackend)return {config:{title:company()?.name||'公司工作台',subtitle:'设备与运行状态',accent:'blue',widgets:['total','online','alerts'],showDevices:true},body:''};const raw=rawTemplate(companyId);if(typeof raw!=='string')throw new Error(templateErrors[companyId]||'未找到公司 Markdown 配置。');return parseTemplate(raw);}
function authFormFields(){
 const register=authMode==='register',reset=authMode==='reset';
 if(reset)return `<form id="auth-form" data-mode="reset"><label for="username">手机号</label><input id="username" name="username" placeholder="请输入您的手机号" autocomplete="tel" inputmode="numeric" pattern="1[3-9][0-9]{9}" minlength="11" maxlength="11" required><label for="reset-code">短信验证码</label><div class="code-row"><input id="reset-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6 位验证码" required><button type="button" class="secondary code-button" id="send-reset-code">获取验证码</button></div><p class="settings-note" id="auth-code-hint">验证码将发送到该手机号绑定的账号，5 分钟内有效。</p><label for="password">新密码</label><input id="password" name="password" type="password" autocomplete="new-password" placeholder="至少 12 位密码" minlength="12" maxlength="100" required><label for="confirm-password">确认新密码</label><input id="confirm-password" type="password" autocomplete="new-password" placeholder="请再次输入新密码" minlength="12" maxlength="100" required><p id="auth-error" class="error" role="alert">${safe(notice)}</p><button class="primary login-submit" type="submit">重置密码 ${icon('arrow')}</button><p class="auth-extra"><button type="button" class="link-button" data-auth="login">返回登录</button></p></form>`;
 return `<form id="auth-form">${register?'<label for="display-name">姓名</label><input id="display-name" name="displayName" placeholder="请输入姓名" maxlength="30" required>':''}<label for="username">账号</label><input id="username" name="username" placeholder="请输入账号" autocomplete="username" minlength="3" maxlength="40" required>${register?`<label for="register-phone">手机号</label><input id="register-phone" name="phone" inputmode="numeric" autocomplete="tel" pattern="1[3-9][0-9]{9}" maxlength="11" placeholder="请输入您的手机号" required>${platformBackend?`<label for="register-code">短信验证码</label><div class="code-row"><input id="register-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6 位验证码" required><button type="button" class="secondary code-button" id="send-register-code">获取验证码</button></div><p class="settings-note" id="register-code-hint">验证码将发送到该手机号，5 分钟内有效。</p>`:''}`:''}<label for="password">密码</label><div class="password-wrap"><input id="password" name="password" type="password" placeholder="${register?(platformBackend?'至少 12 位密码':'至少 6 位密码'):'请输入密码'}" autocomplete="${register?'new-password':'current-password'}" ${register?`minlength="${platformBackend?12:6}"`:''} maxlength="100" required><button type="button" id="toggle-password" aria-label="显示密码">${icon('eye')}</button></div>${register?`${platformBackend?'<label for="register-invite">公司邀请码</label><input id="register-invite" name="inviteCode" autocomplete="off" maxlength="128" placeholder="请输入公司管理员提供的邀请码" required>':`<label for="register-company">所属公司</label><select id="register-company" name="companyId" required>${platform.companies.map(c=>`<option value="${safe(c.id)}">${safe(c.name)}</option>`).join('')}</select>`}<label for="confirm-password">确认密码</label><input id="confirm-password" type="password" autocomplete="new-password" placeholder="请再次输入密码" required>`:''}${!register&&platformBackend?'<p class="auth-extra"><button type="button" class="link-button" id="forgot-password">忘记密码？</button></p>':''}<p id="auth-error" class="error" role="alert">${safe(notice)}</p><button class="primary login-submit" type="submit">${register?'注册并进入公司':'登录平台'} ${icon('arrow')}</button></form>`;
}
function accountPage(){
 const register=authMode==='register';
 const reset=authMode==='reset';
 const isAuthTab=authMode==='login'||authMode==='register';
 const decoSvg=`<svg class="deco-ring deco-ring-1" viewBox="0 0 600 600" aria-hidden="true"><circle cx="300" cy="300" r="290" fill="none" stroke="#ccd6e0" stroke-width="1" stroke-dasharray="6 8"/><circle cx="300" cy="300" r="250" fill="none" stroke="#dbe3eb" stroke-width="1"/><circle cx="300" cy="300" r="210" fill="none" stroke="#c5d0db" stroke-width="1" stroke-dasharray="3 5"/></svg>
<svg class="deco-ring deco-ring-2" viewBox="0 0 420 420" aria-hidden="true"><circle cx="210" cy="210" r="200" fill="none" stroke="#b9c7d3" stroke-width="1.2"/><circle cx="210" cy="210" r="170" fill="none" stroke="#ccd6e0" stroke-width="1"/><circle cx="210" cy="210" r="140" fill="none" stroke="#dde4eb" stroke-width="1" stroke-dasharray="2 4"/></svg>
<svg class="deco-ring deco-ring-3" viewBox="0 0 280 280" aria-hidden="true"><circle cx="140" cy="140" r="130" fill="none" stroke="#cdd6e0" stroke-width="1"/><circle cx="140" cy="140" r="100" fill="none" stroke="#e0e6ec" stroke-width="1"/></svg>
<svg class="deco-gear" viewBox="0 0 220 220" aria-hidden="true"><g fill="none" stroke="#a8b8c8" stroke-width="1.2"><circle cx="110" cy="110" r="86"/><circle cx="110" cy="110" r="62"/><circle cx="110" cy="110" r="40"/><g stroke-linecap="round">${[...Array(16)].map((_,i)=>{const a=i*22.5*Math.PI/180,x1=110+Math.cos(a)*72,y1=110+Math.sin(a)*72,x2=110+Math.cos(a)*98,y2=110+Math.sin(a)*98;return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`}).join('')}</g></g></svg>
<svg class="deco-dots deco-dots-grid" viewBox="0 0 200 120" aria-hidden="true">${[...Array(60)].map((_,i)=>{const x=(i%10)*20+10,y=Math.floor(i/10)*20+10,r=.8+(i%4)*.3;return `<circle cx="${x}" cy="${y}" r="${r}" fill="#c8d4df"/>`}).join('')}</svg>
<div class="deco-globe">
<svg viewBox="0 0 260 260" aria-hidden="true"><defs><radialGradient id="globeGrad2" cx="38%" cy="35%" r="62%"><stop offset="0%" stop-color="#ffffff"/><stop offset="35%" stop-color="#eaf1f8"/><stop offset="75%" stop-color="#c4d3e0"/><stop offset="100%" stop-color="#a5b6c7"/></radialGradient><clipPath id="globeClip2"><circle cx="130" cy="130" r="108"/></clipPath></defs><circle cx="130" cy="130" r="108" fill="url(#globeGrad2)" stroke="#9fb3c5" stroke-width="1.5"/><g clip-path="url(#globeClip2)" fill="none" stroke="#8fa3b4" stroke-width=".7" opacity=".5"><ellipse cx="130" cy="130" rx="108" ry="40"/><ellipse cx="130" cy="130" rx="108" ry="70"/><ellipse cx="130" cy="130" rx="108" ry="22"/><line x1="22" y1="130" x2="238" y2="130"/><path d="M130 22 Q178 72 130 130 Q82 188 130 238"/><path d="M130 22 Q82 72 130 130 Q178 188 130 238"/><path d="M22 82 Q130 92 238 82"/><path d="M22 178 Q130 168 238 178"/></g><circle cx="130" cy="130" r="108" fill="none" stroke="#ffffff" stroke-width="3" opacity=".3"/></svg>
</div>`;
 return `<main class="login portal-login">
<section class="login-col login-col-left">
 <div class="login-left-top">
  <a class="login-brand-top" href="./">${logo()}<span>物联空间</span></a>
  <h1>供应链<br>物联网平台</h1>
  <p>Supply Chain IoT Platform · 让每一台设备，都有清晰的脉络</p>
 </div>
 <div class="login-left-deco">${decoSvg}</div>
</section>
<section class="login-col login-col-right">
 <div class="login-form-wrap">
  <h2>${reset?'重置密码':register?'注册账号':'用户登录'}</h2>
  ${reset?`<p class="muted">通过账号绑定的手机号验证身份，重新设置登录密码。</p>`:''}
  ${isAuthTab?'<div class="auth-switch"><button data-auth="login" class="'+(!register?'active':'')+'">登录</button><button data-auth="register" class="'+(register?'active':'')+'">注册</button></div>':''}
  ${authFormFields()}
  ${register&&platformBackend?'<p class="settings-note">公司与身份由邀请码确定，平台管理员不开放注册。</p>':''}
 </div>
 <footer class="login-foot"><span>物联空间 · 供应链物联网平台</span><span>${platformBackend?'平台服务已连接':'演示模式'}</span></footer>
</section>
</main>`;
}
function dashboardCards(){
 const list=companyDevices(),warnings=warningDevices();
 const data={total:['device','设备总数',list.length],online:['check','在线设备',list.filter(d=>d.online).length],alerts:['bell','告警设备',warnings.length]};
 const cfg=workspaceTemplate().config;
 return `<div class="ov-metrics company-stats">${cfg.widgets.map(w=>{const [i,label,n]=data[w];const tag=w==='alerts'?'button':'div';return `<${tag} class="ov-metric ov-metric-${w}" ${w==='alerts'?'type="button" id="warning-devices" aria-label="查看告警设备"':''}><span class="ov-metric-label">${label}</span><strong>${n}<small>台</small></strong><span class="ov-metric-icon">${icon(i)}</span></${tag}>`;}).join('')}</div>`;
}
function deviceCards(list){return `<div class="device-grid">${list.map(raw=>{const d=effective(raw),s=deviceScene(d),[label,color]=status(s,d);return `<button class="device-card" data-device="${safe(d.id)}"><div class="card-top"><span class="project-symbol ${s.color}">${icon('device')}</span><span class="badge ${color}"><i class="dot"></i>${label}</span></div><span class="device-code">${safe(d.id)}</span><h2>${safe(d.name)}</h2><p>${safe(d.location)}</p><div class="device-sensors">${s.metrics.map(m=>`<span class="${alarms(s,d).some(a=>a.key===m.key)&&d.online?'warning-metric':''}">${safe(m.name)}</span>`).join('')}</div><div class="device-readings">${s.metrics.map(m=>`<div class="${d.online&&alarms(s,d).some(a=>a.key===m.key)?'reading-alert':''}"><small>${safe(m.name)}</small><strong>${Number.isFinite(d.values[m.key])?safe(d.values[m.key]):'—'}<em>${safe(m.unit)}</em></strong></div>`).join('')}</div>${!d.online?`<span class="last-reading-note">${d.mqtt?'离线 / 等待新上报 · 最后接收值':'离线 · 最后一次模拟采样'}</span>`:''}<div class="device-action"><span>查看传感器数据</span>${icon('arrow')}</div></button>`;}).join('')}</div>`;}
function workspaceSparkline(metric,d){
 const rawValues=d.history?.[metric.key]||[],rawTimes=d.historyTimes?.[metric.key]||[];
 const samples=rawValues.map((value,i)=>({value,time:rawTimes[i]})).filter(s=>Number.isFinite(s.value));
 if(!samples.length)return '<div class="spark-empty">暂无历史采样</div>';
 const lo=Math.min(...samples.map(s=>s.value)),range=Math.max(...samples.map(s=>s.value))-lo||1;
 const x=i=>10+i*300/Math.max(1,samples.length-1),y=v=>82-(v-lo)/range*58;
 const points=samples.map((s,i)=>`${x(i)},${y(s.value)}`).join(' ');
 const gid='spark-'+String(metric.key).replace(/[^A-Za-z0-9_-]/g,'');
 const dots=samples.map((s,i)=>{
  const label=`${metric.name}：${s.value}${metric.unit?' '+metric.unit:''}`,time=sampleTimeLabel(s.time);
  const tipX=Math.min(184,Math.max(4,x(i)-56)),tipY=Math.max(2,y(s.value)-46);
  return `<g class="spark-point"><circle cx="${x(i)}" cy="${y(s.value)}" r="9" fill="transparent"/><circle cx="${x(i)}" cy="${y(s.value)}" r="2.6" fill="currentColor"/><g class="spark-tip" transform="translate(${tipX},${tipY})"><rect width="132" height="38" rx="7"/><text x="9" y="15">${safe(label)}</text><text x="9" y="30">${safe(time)}</text></g></g>`;
 }).join('');
 return `<svg class="spark-chart" viewBox="0 0 320 92" role="group" aria-label="${safe(metric.name)}最近 ${samples.length} 次采样趋势"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".22"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs><polygon points="${samples.map((s,i)=>x(i)+','+y(s.value)).join(' ')} 310,92 10,92" fill="url(#${gid})"/><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${dots}</svg>`;
}
let overviewDeviceId=null;
function consoleHealthPanel(){
 const list=companyDevices(),warnings=warningDevices(),offline=list.filter(d=>!d.online),total=list.length,healthy=Math.max(0,total-warnings.length-offline.length);
 const green=total?healthy/total*100:0,amber=total?(healthy+warnings.length)/total*100:0;
 return `<section class="insight-panel ov-health"><div class="ov-card-head"><div><span class="ov-kicker">DEVICE STATUS</span><h2>设备状态分布</h2></div></div><div class="ov-ring-wrap"><div class="health-ring ov-ring" style="--healthy:${green}%;--warning:${amber}%" role="img" aria-label="${healthy} 台正常，${warnings.length} 台告警，${offline.length} 台离线"><div><strong>${total}</strong><span>设备总数</span></div></div></div><div class="health-legend ov-legend">${[['normal','运行正常',healthy],['warn','在线告警',warnings.length],['off','设备离线',offline.length]].map(([cls,label,n])=>`<div><span><i class="${cls}"></i>${label}</span><strong>${n}<small> 台</small></strong></div>`).join('')}</div><p class="health-foot">${total?`设备在线率：${Math.round((total-offline.length)/total*100)}%`:'暂无设备数据'}</p></section>`;
}
function consoleSamplingPanel(){
 const list=companyDevices();
 const raw=list.find(d=>d.id===overviewDeviceId)||list.find(d=>d.online)||list[0],d=raw?effective(raw):null,s=d?deviceScene(d):null;
 const head=`<div class="ov-card-head"><div><span class="ov-kicker">SENSOR OVERVIEW</span><h2>采样数据概览</h2></div>${d?`<label class="ov-select"><span class="sr-only">概览设备</span><select id="overview-device">${list.map(row=>`<option value="${safe(row.id)}" ${row.id===d.id?'selected':''}>${safe(effective(row).name)}</option>`).join('')}</select></label>`:''}</div>`;
 if(!d)return `<section class="insight-panel ov-sampling">${head}<p class="dashboard-empty">尚未配置监测设备</p></section>`;
 if(!s||!s.metrics.length)return `<section class="insight-panel ov-sampling">${head}<p class="dashboard-empty">等待设备首次上报后显示指标</p></section>`;
 return `<section class="insight-panel ov-sampling">${head}<div class="ov-sampling-grid">${s.metrics.map(m=>{const warning=d.online&&alarms(s,d).some(a=>a.key===m.key),value=d.values[m.key],count=(d.history?.[m.key]||[]).filter(Number.isFinite).length;return `<div class="sampling-metric ${warning?'is-alert':''}"><div class="ov-metric-main"><span class="ov-metric-name">${icon(m.icon)} ${safe(m.name)}</span><div class="ov-reading"><strong>${Number.isFinite(value)?safe(value):'—'}</strong><small>${safe(m.unit)}</small></div><span class="ov-sample-note">最近 ${count} 次${d.mqtt?'实际':'模拟'}采样</span></div><div class="ov-metric-chart">${workspaceSparkline(m,d)}</div></div>`;}).join('')}</div><button class="dashboard-text-link" data-device="${safe(d.id)}">查看设备详情 ${icon('arrow')}</button></section>`;
}
function companyInsights(){return `<div class="insight-grid">${consoleSamplingPanel()}${consoleHealthPanel()}</div>`;}
function companyAttention(){
 const list=companyDevices(),attention=list.filter(d=>!d.online||alarms(deviceScene(d),effective(d)).length);
 const articles=visibleNews().slice(0,2);
 return `<div class="dashboard-bottom"><section class="insight-panel attention-panel" id="console-alerts"><div class="insight-heading"><div><span class="dashboard-kicker">NEEDS ATTENTION</span><h2>需要关注 <small>${attention.length}</small></h2></div>${icon('bell')}</div>${attention.map(raw=>{const d=effective(raw),s=deviceScene(d);return `<button class="attention-row" data-device="${safe(d.id)}"><span class="attention-symbol ${d.online?'warn':'off'}">${icon(d.online?'bell':'device')}</span><span><strong>${safe(d.name)}</strong><small>${d.online?alarms(s,d).map(m=>safe(m.name)+'超出范围').join('、'):'设备离线 · 请检查供电与网络'}</small></span>${icon('arrow')}</button>`;}).join('')||'<p class="dashboard-empty">'+icon('check')+' 当前没有预警或离线设备</p>'}</section><section class="insight-panel dashboard-news"><div class="insight-heading"><div><span class="dashboard-kicker">LATEST NEWS</span><h2>公司与平台动态</h2></div><button class="dashboard-text-link" data-tab="news">全部新闻 ${icon('arrow')}</button></div>${articles.map(a=>`<a class="dashboard-news-item" href="#article/${encodeURIComponent(a.id)}" data-article="${safe(a.id)}"><time>${safe(a.date)}</time><strong>${safe(a.title)}</strong>${icon('arrow')}</a>`).join('')||'<p class="dashboard-empty">暂无最新动态</p>'}</section></div>`;
}
function consoleDeviceRows(query=''){
 const rows=companyDevices().filter(raw=>{const d=effective(raw);return (!platformBackend||!deviceSceneFilter||d.workspaceSceneId===deviceSceneFilter)&&[d.name,d.id,d.location].join(' ').toLowerCase().includes(query.trim().toLowerCase());});
 return rows.map(raw=>{const d=effective(raw),s=deviceScene(d),[label,color]=status(s,d);return `<tr><td><button class="ov-device-name" data-device="${safe(d.id)}">${icon('device')} ${safe(d.name)}</button></td><td><code>${safe(d.id)}</code></td><td><span class="badge ${color}"><i></i>${label}</span></td><td>${safe(d.location)}${platformBackend?`<small>${safe(companyScenes.find(s=>s.id===d.workspaceSceneId)?.name||'未分组')}</small>`:''}</td><td><button class="ov-view-link" data-device="${safe(d.id)}">查看 ${icon('arrow')}</button></td></tr>`;}).join('')||'<tr><td colspan="5" class="console-no-results">未找到匹配设备</td></tr>';
}
let amapLoader=null,amapConfigCache=null,deviceMapInstance=null,deviceMapContainer=null,deviceMapMarkers=[],deviceMapInfo=null,deviceMapCenter=null;
function resolveAmapConfig(){
 if(amapConfigCache)return Promise.resolve(amapConfigCache);
 const merge=extra=>{amapConfigCache={...((platform&&platform.map)||{}),...(extra||{})};return amapConfigCache;};
 if(typeof platformBackend==='undefined'||!platformBackend)return Promise.resolve(merge());
 return fetch('./api/map/config',{cache:'no-store',credentials:'same-origin'}).then(response=>response.ok?response.json():{}).then(merge).catch(()=>merge());
}
function loadAMap(cfg){
 if(window.AMap)return Promise.resolve(window.AMap);
 if(amapLoader)return amapLoader;
 if(typeof cfg.securityCode==='string'&&cfg.securityCode.trim())window._AMapSecurityConfig={securityJsCode:cfg.securityCode.trim()};
 amapLoader=new Promise((resolve,reject)=>{
  const script=document.createElement('script');
  script.async=true;
  script.src='https://webapi.amap.com/maps?v=2.0&key='+encodeURIComponent(String(cfg.key||'').trim())+'&plugin=AMap.Scale';
  script.onload=()=>window.AMap?resolve(window.AMap):reject(new Error('高德地图加载失败，请检查 Key 是否有效。'));
  script.onerror=()=>{amapLoader=null;reject(new Error('高德地图脚本加载失败，请检查网络或 Key 配置。'));};
  document.head.appendChild(script);
 });
 return amapLoader;
}
function disposeDeviceMap(){
 if(deviceMapInstance){try{deviceMapInstance.clearMap();}catch(error){}deviceMapInstance.destroy();}
 deviceMapInstance=null;deviceMapContainer=null;deviceMapMarkers=[];deviceMapInfo=null;deviceMapCenter=null;
}
function deviceMapPoint(device,index,center){
 const lng=Number(device.lng),lat=Number(device.lat);
 if(Number.isFinite(lng)&&Number.isFinite(lat))return [lng,lat];
 const angle=(index%8)/8*Math.PI*2,radius=0.0014+Math.floor(index/8)*0.0011;
 return [center[0]+Math.sin(angle)*radius,center[1]+Math.cos(angle)*radius];
}
function deviceMapMarkerList(list,center,infoWindow){
 return list.map((raw,index)=>{
  const d=effective(raw),[label,color]=status(deviceScene(d),d);
  const pin=document.createElement('button');
  pin.type='button';pin.className='map-pin '+color;pin.title=d.name+' · '+label;
  pin.innerHTML='<i></i><span>'+safe(d.name)+'</span>';
  const position=deviceMapPoint(d,index,center);
  pin.addEventListener('click',()=>{
   const readings=(d.metrics||[]).slice(0,2).map(m=>`<span>${safe(m.name)} <b>${Number.isFinite(d.values?.[m.key])?safe(d.values[m.key]):'—'}</b> ${safe(m.unit)}</span>`).join('');
   infoWindow.setContent(`<div class="ov-map-pop"><strong>${safe(d.name)}</strong><small>${safe(d.location)}</small><p>${readings||'<span>暂无实时读数</span>'}</p><button type="button" data-map-device="${safe(d.id)}">查看设备</button></div>`);
   infoWindow.open(deviceMapInstance,position);
   setTimeout(()=>{const action=document.querySelector('.ov-map-pop [data-map-device]');if(action)action.onclick=()=>openDevice(d.id);},0);
  });
  return new AMap.Marker({position,content:pin,anchor:'center'});
 });
}
function syncDeviceMapMarkers(){
 if(!deviceMapInstance||!deviceMapContainer||!deviceMapInfo)return;
 try{deviceMapInstance.remove(deviceMapMarkers);}catch(error){}
 deviceMapMarkers=deviceMapMarkerList(companyDevices(),deviceMapCenter,deviceMapInfo);
 deviceMapContainer.dataset.mapState=deviceMapMarkers.length?'ready':'empty';
 if(deviceMapMarkers.length)deviceMapInstance.add(deviceMapMarkers);
}
function bindDeviceMap(){
 const container=document.querySelector('#device-map');
 if(!container)return;
 if(deviceMapInstance&&deviceMapContainer===container){syncDeviceMapMarkers();return;}
 disposeDeviceMap();
 const list=companyDevices();
 resolveAmapConfig().then(cfg=>{
  if(!document.body.contains(container))return;
  if(!cfg||typeof cfg.key!=='string'||!cfg.key.trim()){container.dataset.mapState='error';container.innerHTML='<div class="device-map-status">未配置高德地图 Key：请设置环境变量 AMAP_KEY（可选 AMAP_SECURITY_CODE）后重启服务，刷新页面即可显示真实地图。</div>';return;}
  return loadAMap(cfg).then(AMap=>{
   if(!document.body.contains(container))return;
   const center=Array.isArray(cfg.center)&&cfg.center.length===2?cfg.center:[116.397477,39.908692];
   deviceMapInstance=new AMap.Map(container,{center,zoom:cfg.zoom||16,viewMode:'2D',mapStyle:'amap://styles/whitesmoke',resizeEnable:true});
   deviceMapInstance.addControl(new AMap.Scale());
   deviceMapInfo=new AMap.InfoWindow({offset:new AMap.Pixel(0,-16),closeWhenClickMap:true});
   deviceMapContainer=container;deviceMapCenter=center;
   deviceMapMarkers=deviceMapMarkerList(list,center,deviceMapInfo);
   container.querySelector('.device-map-status')?.remove();
   container.dataset.mapState=deviceMapMarkers.length?'ready':'empty';
   if(deviceMapMarkers.length){deviceMapInstance.add(deviceMapMarkers);deviceMapInstance.setFitView(deviceMapMarkers,false,[70,45,45,45]);}
  });
 }).catch(error=>{if(!document.body.contains(container))return;container.dataset.mapState='error';container.innerHTML='<div class="device-map-status">'+safe(error.message)+'</div>';});
}
function consoleDeviceArea(){
 const list=companyDevices();
 return `<div class="ov-lower-grid" id="dashboard-devices"><section class="insight-panel ov-map-panel"><div class="ov-card-head"><div><span class="ov-kicker">SITE MAP</span><h2>采集点分布</h2></div><span class="ov-count">${list.length} 个设备</span></div><div class="device-map ov-device-map" id="device-map" data-map-state="loading"><span class="device-map-status">正在加载高德地图…</span></div><div class="site-legend ov-site-legend"><span><i class="normal"></i>正常</span><span><i class="warn"></i>告警</span><span><i class="off"></i>离线</span></div><p class="device-map-note">地图数据 © 高德地图 · 缺少坐标时在公司中心周边示意</p></section><section class="insight-panel ov-table-panel"><div class="ov-card-head"><div><span class="ov-kicker">DEVICE LIST</span><h2>设备列表</h2></div><div class="ov-table-tools">${platformBackend?`<label class="ov-select ov-scene"><span class="sr-only">场景筛选</span><select id="console-scene-filter"><option value="">全部场景</option>${companyScenes.filter(s=>s.company===companyId).map(s=>`<option value="${safe(s.id)}" ${s.id===deviceSceneFilter?'selected':''}>${safe(s.name)}</option>`).join('')}</select></label>`:''}<label class="table-search">${icon('eye')}<input type="search" id="console-device-search" aria-label="搜索设备" placeholder="搜索名称 / ID / 位置"></label></div></div><div class="table-wrap ov-table-wrap"><table class="ov-table"><thead><tr><th>设备名称</th><th>设备 ID</th><th>状态</th><th>位置</th><th>操作</th></tr></thead><tbody id="console-device-rows">${consoleDeviceRows()}</tbody></table></div><div class="console-table-footer"><span>仅显示 ${safe(company()?.name)} 的设备</span><span>共 ${list.length} 台</span></div></section></div>`;
}
function consoleQuickActions(){return `<section class="insight-panel ov-quick"><div class="ov-card-head"><div><span class="ov-kicker">SHORTCUTS</span><h2>快捷操作</h2></div></div><div class="ov-quick-grid">${[['devices','device','查看设备'],['monitor','grid','数据监测'],['alerts','bell','查看告警']].map(([section,i,text])=>`<button type="button" data-console-section="${section}"><span>${icon(i)}</span>${text}</button>`).join('')}<button type="button" data-tab="news"><span>${icon('chat')}</span>公告新闻</button></div></section>`;}
function myDevicesPage(){const none=companyDevices().length===0?'<p class="settings-note">当前没有分配给你的设备，请联系公司管理员分配。</p>':'';return heading('MY DEVICES','我的设备',`${safe(company()?.name)} · 仅显示你有权访问的设备。`,'<button class="secondary" data-tab="home">返回工作台</button>')+none+`<div class="company-dashboard cockpit-dashboard ov-dash">${consoleDeviceArea()}</div>`;}
function developerConsoleHome(){
 const list=companyDevices(),online=list.filter(d=>d.online),pending=list.filter(d=>!d.lastSeen),offline=list.filter(d=>d.lastSeen&&!d.online);
 const info=platformInfo||{},host=info.mqttHost||'未配置',port=info.mqttPort||'—';
 const rows=[...pending,...offline,...online].map(d=>{
  const [label,color]=d.online?['在线','green']:d.lastSeen?['离线','gray']:['待激活','blue'];
  return `<tr><td><strong>${safe(d.name)}</strong><small>${safe(d.id)}</small></td><td>${safe(deviceScene(d)?.name)}<small>${safe(d.location)}</small></td><td><span class="badge ${color}">${label}</span></td><td>${d.lastSeen?safe(new Date(d.lastSeen).toLocaleString('zh-CN')):'尚未上报'}</td><td><button class="dashboard-text-link" data-device="${safe(d.id)}">查看</button></td></tr>`;
 }).join('')||'<tr><td colspan="5">暂无设备，请先创建设备并接入。</td></tr>';
 return `${canManageDevices()?`<div class="inventory-toolbar"><span>设备接入与配置</span><button class="primary" data-route="device-manage">进入设备接入</button></div>`:''}<div class="company-dashboard cockpit-dashboard ov-dash"><header class="ov-hero"><span class="ov-eyebrow">客户开发者 · DEVICE ONBOARDING</span><h1>设备接入工作台</h1><p>${safe(company()?.name)} · 共 ${list.length} 台设备，${pending.length} 台待激活，${online.length} 台在线</p></header><div class="ov-dev-home"><div class="ov-dev-main"><section class="insight-panel"><div class="ov-card-head"><div><span class="ov-kicker">GET STARTED</span><h2>设备接入流程</h2></div><button class="dashboard-text-link" data-route="device-manage">进入设备接入 ${icon('arrow')}</button></div><div class="access-flow"><span><b>1</b>创建设备</span><i>→</i><span><b>2</b>下载配置并烧录</span><i>→</i><span><b>3</b>联网自动上报</span></div><p class="settings-note">设备创建后自动归属本公司；密钥只在创建或重置时显示一次，请及时下载 secrets.h。</p></section><section class="insight-panel"><div class="ov-card-head"><div><span class="ov-kicker">CONNECTION STATUS</span><h2>设备接入状态</h2></div><div class="ov-table-tools"><span class="badge blue">待激活 ${pending.length}</span><span class="badge green">在线 ${online.length}</span><span class="badge gray">离线 ${offline.length}</span></div></div><div class="table-wrap ov-table-wrap"><table class="ov-table"><thead><tr><th>设备名称</th><th>类型 / 位置</th><th>状态</th><th>最近上报</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div></section></div><div class="ov-dev-side"><section class="insight-panel"><div class="ov-card-head"><div><span class="ov-kicker">MQTT ACCESS</span><h2>MQTT 接入参数</h2></div><span class="badge ${info.broker==='running'?'green':'gray'}">${info.broker==='running'?'运行中':'未启用'}</span></div><dl class="device-info">${[['服务器',`${host}:${port}`],['备用地址',info.mqttFallbackHost||'—'],['协议',info.mqttTls?'MQTT over TLS':'MQTT 3.1.1'],['上报 Topic','rd/devices/<设备ID>/telemetry']].map(([k,v])=>`<div><dt>${k}</dt><dd${k==='上报 Topic'?' class="ov-dev-topic"':''}>${safe(v)}</dd></div>`).join('')}</dl><p class="settings-note">每台设备使用独立的设备 ID、用户名与密钥，Topic 按设备隔离。</p></section><section class="insight-panel"><div class="ov-card-head"><div><span class="ov-kicker">CREDENTIALS</span><h2>密钥与接入配置</h2></div></div><p class="settings-note">设备密钥仅创建或重置时显示一次；下载 secrets.h 后填入 Wi-Fi 名称和密码即可烧录。</p><div class="settings-actions"><button class="primary" data-route="device-manage">管理接入配置</button><button class="secondary" data-console-section="monitor">查看数据监测</button></div></section></div></div></div>`;
}
function customerConsoleHome(t){
 if(currentUser?.role==='developer')return developerConsoleHome();
 const news=visibleNews().slice(0,2);
 const category=platform.categories.find(c=>c.id===company()?.categoryId)?.name||'公司空间';
 const subtitle=[company()?.name,t.config.subtitle||'温湿度氨气实时监测与运营闭环'].filter(Boolean).join(' - ');
 return `${canManageDevices()?'<div class="inventory-toolbar"><span>公司设备维护</span><button class="primary" data-route="device-manage">管理设备 · 添加 / 删除</button></div>':''}<div class="company-dashboard cockpit-dashboard ov-dash"><header class="ov-hero"><span class="ov-eyebrow">${safe(category)} · 运营概览</span><h1>你好，${safe(currentUser.name)}</h1><p>${safe(subtitle)}</p></header>${dashboardCards()}<div class="ov-main"><div class="ov-left"><div class="console-analytics ov-health-slot" id="console-monitor" data-layout="ov">${consoleHealthPanel()}</div></div><div class="ov-center"><div id="console-sampling">${consoleSamplingPanel()}</div></div><div class="ov-right">${consoleQuickActions()}</div></div>${t.config.showDevices?consoleDeviceArea():''}<div class="console-bottom-grid ov-bottom"><section class="insight-panel ov-news"><div class="ov-card-head"><div><span class="ov-kicker">LATEST NEWS</span><h2>平台与公司动态</h2></div><button class="dashboard-text-link" data-tab="news">全部新闻 ${icon('arrow')}</button></div>${news.map(a=>`<a class="dashboard-news-item" href="#article/${encodeURIComponent(a.id)}" data-article="${safe(a.id)}"><time>${safe(a.date)}</time><strong>${safe(a.title)}</strong>${icon('arrow')}</a>`).join('')||'<p class="dashboard-empty">暂无新闻</p>'}</section><section class="insight-panel console-notes ov-notes"><div class="ov-card-head"><div><span class="ov-kicker">OPERATIONS</span><h2>运营提示</h2></div></div>${markdown(t.body)}</section></div><p class="console-data-note">${icon('help')} ${platformBackend?'仅显示你有权访问的设备；监测值来自设备实际采样上报。':'当前读数、历史曲线及在线状态来自公司 JSON 模拟数据。'}</p></div>`;
}
function companyHome(){
 try{const t=workspaceTemplate();if(!isAdmin())return customerConsoleHome(t);const list=companyDevices(),warningCount=warningDevices().length,online=list.filter(d=>d.online).length;return `<div class="company-dashboard"><section class="dashboard-welcome accent-${t.config.accent}"><div class="welcome-copy"><span class="welcome-eyebrow">${safe(platform.categories.find(c=>c.id===company()?.categoryId)?.name||'公司空间')} / 设备监测工作台</span><h1>${safe(company()?.name)} · 设备管理</h1><p>查看公司设备、定位异常，统一维护监测页面配置。</p><div class="welcome-actions">${t.config.showDevices?'<button data-scroll-devices>查看公司设备 '+icon('arrow')+'</button>':''}${isAdmin()&&!platformBackend?'<button class="welcome-outline" data-route="template">'+icon('code')+' 配置页面</button>':'<span>'+icon('shield')+' '+safe(roles[currentUser.role].label)+'专属工作空间</span>'}</div></div><div class="welcome-status"><div class="welcome-radar">${icon('device')}<i></i><i></i></div><div><span>运行概况</span><strong>${warningCount?'有 '+warningCount+' 台设备需要关注':online<list.length?'有离线设备待检查':list.length?'在线设备运行正常':'等待添加监测设备'}</strong><small>${online} 台在线 / ${list.length} 台设备 · ${platformBackend?'实际采样':'模拟快照'}</small></div></div></section>`+dashboardCards()+`<div id="console-monitor">`+companyInsights()+`</div>`+`${t.config.showDevices?'<div class="section-heading dashboard-devices-heading" id="dashboard-devices"><div><span class="dashboard-kicker">COMPANY DEVICES</span><h2>公司设备</h2></div><span class="device-count">'+list.length+' 台设备 · 点击查看详情</span></div>'+deviceCards(list):''}`+companyAttention()+`<section class="panel markdown-panel dashboard-notes">${markdown(t.body)}</section></div>`;}catch(e){return heading('COMPANY / CONFIGURATION',safe(company()?.name||'公司空间'),'公司页面配置暂不可用。')+`<div class="offline-note">${safe(e.message)}</div>${isAdmin()?'<button class="primary" data-route="template">修复 Markdown 配置</button>':''}`;}
}
function newsPage(){return newsListPage();}
function profilePage(){return heading('ACCOUNT / PROFILE','我的','查看账号身份与所属公司。')+`<section class="panel profile-card"><span class="profile-avatar">${safe(currentUser.name?.slice(0,1)||'用')}</span><h2>${safe(currentUser.name)}</h2><span class="badge ${roles[currentUser.role].color}">${roles[currentUser.role].label}</span><dl class="device-info">${[['姓名',currentUser.name],['账号',currentUser.username],['公司',isAdmin()?'平台管理员（跨公司管理）':platform.companies.find(c=>c.id===currentUser.companyId)?.name||'未分配'],['设备数',isAdmin()?devices.length:companyDevices().length],['身份',roles[currentUser.role].label]].map(([k,v])=>`<div><dt>${k}</dt><dd>${safe(v)}</dd></div>`).join('')}</dl><button class="secondary" id="profile-logout">退出登录 ${icon('logout')}</button></section>${typeof accountPasswordPanel==='function'?accountPasswordPanel():''}${typeof accountPhonePanel==='function'?accountPhonePanel():''}`;}
function navigationCard({title,description,iconName,color='blue',attr,meta=''}){return `<button class="portal-card" ${attr}><span class="portal-card-icon ${color}">${icon(iconName)}</span><span class="portal-card-body"><strong>${safe(title)}</strong><span>${safe(description)}</span><small>${safe(meta)}</small></span><span class="portal-card-arrow">${icon('arrow')}</span></button>`;}
function platformHealth(list=devices){
 const offline=list.filter(d=>!d.online).length;
 const warning=list.filter(d=>d.online&&alarms(deviceScene(d),effective(d)).length).length;
 return {total:list.length,online:list.length-offline,offline,warning,normal:list.length-offline-warning};
}
function platformPage(){
 if(platformBackend)return serverPlatformPage();
 const h=platformHealth(),attention=devices.filter(d=>!d.online||alarms(deviceScene(d),effective(d)).length);
 return `<div class="admin-dashboard"><section class="admin-hero"><div><span class="admin-kicker">PLATFORM / OPERATIONS</span><h1>平台管理总览</h1><p>供应链物联网平台</p><div class="admin-hero-tags"><span>${icon('shield')} 跨公司管理</span><span>${platform.chains.length} 条产业链 · ${platform.categories.length} 个业务场景</span></div></div><div class="admin-network" aria-hidden="true"><span>${icon('grid')}</span><i>${icon('environment')}</i><i>${icon('power')}</i><i>${icon('device')}</i></div></section><div class="admin-metrics">${[['users','接入公司',platform.companies.length,'家','按产业与场景独立管理','blue'],['device','设备总数',h.total,'台',h.normal+' 台正常运行','purple'],['check','在线设备',h.online,'台',(h.total?Math.round(h.online/h.total*100):0)+'% 在线率','green'],['bell','待关注设备',attention.length,'台',h.warning+' 台预警 · '+h.offline+' 台离线','orange']].map(([i,label,n,unit,note,color])=>`<section class="admin-metric ${color}"><span class="feature-icon ${color}">${icon(i)}</span><span>${label}</span><strong>${n}<small>${unit}</small></strong><p>${note}</p></section>`).join('')}</div><div class="admin-section-title"><div><span class="admin-kicker">INDUSTRY SPACES</span><h2>产业工作空间</h2></div><button class="secondary" data-route="tests">${icon('code')} 设备接入测试</button></div><div class="admin-industries">${platform.chains.map(c=>{const categories=platform.categories.filter(x=>x.chainId===c.id),companies=platform.companies.filter(x=>categories.some(k=>k.id===x.categoryId)),rows=devices.filter(d=>companies.some(k=>k.id===d.companyId)),health=platformHealth(rows);return `<button class="admin-industry ${safe(c.color)}" data-chain="${safe(c.id)}"><div class="admin-industry-top"><span class="feature-icon ${safe(c.color)}">${icon(c.icon)}</span><span>${companies.length} 家公司 / ${rows.length} 台设备</span>${c.status==='building'?'<span class="badge blue">建设中</span>':''}${icon('arrow')}</div><h3>${safe(c.name)}</h3><p>${safe(c.description)}</p><div class="admin-category-tags">${categories.map(k=>`<span>${safe(k.name)}</span>`).join('')}</div><div class="admin-status-track" aria-hidden="true"><i style="width:${rows.length?health.normal/rows.length*100:0}%"></i><i style="width:${rows.length?health.warning/rows.length*100:0}%"></i><i style="width:${rows.length?health.offline/rows.length*100:0}%"></i></div><small>正常 ${health.normal} · 预警 ${health.warning} · 离线 ${health.offline}</small></button>`;}).join('')}</div><div class="admin-management-grid"><section class="admin-panel"><div class="admin-section-title"><h2>公司管理</h2><span>${platform.companies.length} 家公司</span></div><div class="table-wrap"><table class="admin-company-table"><thead><tr><th>公司 / 场景</th><th>设备</th><th>运行状态</th><th>管理</th></tr></thead><tbody>${platform.companies.map(c=>{const h=platformHealth(devices.filter(d=>d.companyId===c.id));return `<tr><td><button data-company="${safe(c.id)}">${safe(c.name)}</button><small>${safe(platform.categories.find(k=>k.id===c.categoryId)?.name||'未分类')}</small></td><td>${h.total} 台</td><td><span class="admin-table-state ${h.warning||h.offline?'attention':'healthy'}">${h.warning||h.offline?h.warning+' 预警 / '+h.offline+' 离线':'运行正常'}</span></td><td><button class="dashboard-text-link" data-company="${safe(c.id)}">管理 ${icon('arrow')}</button></td></tr>`;}).join('')}</tbody></table></div></section><section class="admin-panel admin-attention"><div class="admin-section-title"><h2>待关注设备</h2><span>${attention.length} 台</span></div>${attention.map(raw=>{const d=effective(raw),c=platform.companies.find(c=>c.id===d.companyId);return `<button class="admin-alert" data-admin-device="${safe(d.id)}"><span class="feature-icon ${d.online?'orange':'blue'}">${icon(d.online?'bell':'device')}</span><span><strong>${safe(d.name)}</strong><small>${safe(c?.name||'未分配公司')} · ${d.online?'指标超出范围':'设备离线'}</small></span>${icon('arrow')}</button>`;}).join('')||'<p class="dashboard-empty">当前设备无异常</p>'}</section></div><p class="admin-data-note">统计来自当前 JSON 演示数据；点击异常设备可直接查看详情。</p></div>`;
}

function currentChain(){return platform.chains.find(c=>c.id===chainId)||platform.chains.find(c=>c.id==='livestock')||platform.chains[0];}
function chainSwitcher(){
 const c=chainId?platform.chains.find(x=>x.id===chainId):null,cats=platform.categories.filter(k=>k.chainId===c?.id);
 return `<div class="chain-switcher"><span class="feature-icon ${safe(c?.color||'green')}">${icon(c?.icon||'grid')}</span><span><small>当前供应链</small><strong>${safe(c?.name||'未选择')}</strong><em>${c?`${cats.length} 个业务场景`:'选择后进入工作台'}</em></span><button data-route="chains">${c?'切换':'选择'}</button></div>`;
}
function chainPickerPage(){
 return heading('SUPPLY CHAIN / SELECT','选择供应链','平台已接入多条供应链，选择你要进入的模块，查看该链下的公司与设备。')+
 `<div class="chain-picker">${platform.chains.map(c=>{
  const online=c.status!=='building',cats=platform.categories.filter(k=>k.chainId===c.id),companies=platform.companies.filter(x=>cats.some(k=>k.id===x.categoryId)),own=companies.some(x=>x.id===currentUser?.companyId);
  return `<button class="chain-card${online?'':' is-building'}" ${online?`data-chain-enter="${safe(c.id)}"`:'disabled aria-disabled="true"'}>
   <span class="chain-card-icon ${safe(c.color||'green')}">${icon(c.icon)}</span>
   <span class="chain-card-body"><span class="chain-card-kicker">${online?'AVAILABLE':'COMING SOON'}</span><strong>${safe(c.name)}</strong><p>${safe(c.description)}</p><span class="chain-card-meta">${online?`${cats.length} 个业务场景 · ${companies.length} 家公司${own?' · 包含你所在的公司':''}`:'模块建设中，敬请期待'}</span></span>
   <span class="badge ${online?'green':'blue'}">${online?'进入':'建设中'}</span>
  </button>`;}).join('')}</div>
 <p class="settings-note">${icon('shield')} 仅可进入已开通的供应链；切换后会回到该链的工作台首页。</p>`;
}
function chainPage(){const c=platform.chains.find(c=>c.id===chainId);if(c&&c.status==='building')return heading('SUPPLY CHAIN / CATEGORIES',safe(c.name),safe(c.description),'<button class="secondary" data-route="platform">返回平台</button>')+`<section class="panel"><span class="feature-icon blue">${icon(c.icon)}</span><h2>该供应链模块建设中</h2><p>业务场景、公司与设备正在接入，完成后可在此管理。</p><button class="secondary" data-route="platform">返回平台总览</button></section>`;return heading('SUPPLY CHAIN / CATEGORIES',safe(c?.name),'选择业务场景，进入公司管理。','<button class="secondary" data-route="platform">返回平台</button>')+`<div class="portal-grid">${platform.categories.filter(x=>x.chainId===chainId).map(x=>navigationCard({title:x.name,description:'查看所属公司及其设备工作台',iconName:x.icon,color:c?.color,attr:`data-category="${x.id}"`,meta:platform.companies.filter(v=>v.categoryId===x.id).length+' 家公司'})).join('')}</div>`;}
function companiesPage(){const category=platform.categories.find(c=>c.id===categoryId);return heading('SCENARIO / COMPANIES',safe(category?.name),'选择公司，进入专属监测页面。','<button class="secondary" data-route="chain">返回产业链</button>')+`<div class="portal-grid">${platform.companies.filter(c=>c.categoryId===categoryId).map(c=>navigationCard({title:c.name,description:c.description,iconName:'users',color:'green',attr:`data-company="${c.id}"`,meta:devices.filter(d=>d.companyId===c.id).length+' 台设备 · Markdown 配置页面'})).join('')}</div>`;}
function testsPage(){return heading('PLATFORM / TESTING','测试','USB 采集与本地联网测试独立于公司业务。','<button class="secondary" data-route="platform">返回平台</button>')+`<div class="portal-grid">${navigationCard({title:'USB 测试',description:'按行显示本机串口接收到的原始信息。',iconName:'device',attr:'data-route="usb"',meta:'/dev/ttyUSB0 · 9600 baud'})}${navigationCard({title:'本地联网测试',description:'订阅本机 MQTT Broker，接收 WiFi 设备消息。',iconName:'code',color:'green',attr:'data-route="mqtt"',meta:'MQTT · 1883 · rd-web/test/#'})}</div><p class="settings-note">测试需通过本地 Python 接收服务打开。GitHub Pages 仅提供静态公司页面，不会模拟测试连接成功。</p>`;}
function templatePage(){const raw=templateDraft??rawTemplate(companyId)??'';return heading('ADMIN / MARKDOWN CONFIGURATION','公司页面配置',`${safe(company()?.name)} · 编辑 Markdown，自动生成首页统计与设备布局。`,'<button class="secondary" data-route="company">返回公司</button>')+`<section class="panel template-panel"><div class="section-heading"><h2>Markdown 页面源文件</h2><span class="muted small">${safe(company()?.template)}</span></div><label class="sr-only" for="template-editor">Markdown 配置</label><textarea id="template-editor" spellcheck="false">${safe(raw)}</textarea><p id="template-error" class="error" role="alert"></p><div class="template-actions"><button class="primary" id="save-template">保存并生成首页</button><button class="secondary" id="preview-template">预览</button><button class="secondary" id="download-template">导出 .md</button><button class="text-button" id="reset-template">恢复文件配置</button></div><p class="settings-note">保存仅影响当前浏览器；导出并替换上方 .md 文件后，重新部署可让其他浏览器读取。</p></section><section class="panel markdown-panel" id="template-preview"><p class="muted">点击预览检查配置和正文。</p></section>`;}
let monitorDeviceId=null,monitorRange=86400,alertDeviceFilter='',alertLevelFilter='';
const monitorRanges=[[3600,'近 1 小时'],[86400,'近 24 小时'],[604800,'近 7 天']];
function selectedMonitorDevice(){
 const list=companyDevices();
 return list.find(d=>d.id===monitorDeviceId)||list.find(d=>d.online)||list[0]||null;
}
function monitorSnapshot(d){
 const cutoff=Date.now()-monitorRange*1000,history={},historyTimes={};
 for(const m of deviceScene(d).metrics){
  const rows=(d.history?.[m.key]||[]).map((value,i)=>({value,time:d.historyTimes?.[m.key]?.[i]})).filter(row=>Number.isFinite(row.value));
  const timed=rows.some(row=>row.time&&Number.isFinite(new Date(row.time).getTime()));
  const selected=timed?rows.filter(row=>row.time&&Number.isFinite(new Date(row.time).getTime())&&new Date(row.time).getTime()>=cutoff):rows;
  history[m.key]=selected.map(row=>row.value);historyTimes[m.key]=selected.map(row=>row.time);
 }
 return {...d,history,historyTimes};
}
function updateMonitorHistory(query){
 const results=document.querySelector('#monitor-history-results');
 if(results&&query){results.innerHTML=historyResults(query);bindHistoryMore();}
}
function renderMonitor(){
 const raw=selectedMonitorDevice();monitorDeviceId=raw?.id||null;
 const top=heading('COMPANY / DATA MONITORING','数据监测',`${safe(company()?.name)} · 查看实时采样与历史趋势`,'<button class="secondary" data-route="company">返回概览</button>');
 if(!raw)return top+'<section class="panel read-only-panel"><span class="feature-icon blue">'+icon('device')+'</span><h2>暂无可监测设备</h2><p>添加设备并收到有效上报后，这里会显示采样曲线。</p></section>';
 const d=effective(raw),s=deviceScene(d),snapshot=monitorSnapshot(d),[label,color]=status(s,d),warnings=alarms(s,d);
 const query=historyQuery?.deviceId===d.id&&historyQuery?.userId===currentUser.id&&historyQuery?.range===monitorRange?historyQuery:null;
 return `<div class="monitor-page">${top}<section class="panel monitor-controls"><label for="monitor-device">监测设备<select id="monitor-device">${companyDevices().map(row=>`<option value="${safe(row.id)}" ${row.id===d.id?'selected':''}>${safe(effective(row).name)} · ${safe(row.id)}</option>`).join('')}</select></label><div class="monitor-range" role="group" aria-label="历史时间范围">${monitorRanges.map(([seconds,text])=>`<button class="secondary ${seconds===monitorRange?'active':''}" data-monitor-range="${seconds}" aria-pressed="${seconds===monitorRange}">${text}</button>`).join('')}</div></section><div class="monitor-summary"><div><span>设备状态</span><strong><span class="badge ${color}">${label}</span></strong></div><div><span>安装位置</span><strong>${safe(d.location)}</strong></div><div><span>采样周期</span><strong>${safe(d.sampleInterval)} 秒 / 次</strong></div><div><span>异常指标</span><strong class="${warnings.length?'alert-text':''}">${d.online?warnings.length+' 项':'设备离线'}</strong></div></div><section class="panel monitor-live-panel"><div class="section-heading"><div><h2>实时采样曲线</h2><p>${safe(d.name)} · ${monitorRanges.find(([seconds])=>seconds===monitorRange)?.[1]}</p></div><span class="muted small">${d.online?'随设备上报持续更新':'设备离线 · 显示已有采样'}</span></div><div class="monitor-chart-grid">${s.metrics.map(m=>{const c=metricConfig(s,d,m),value=d.values[m.key],warning=d.online&&warnings.some(row=>row.key===m.key),count=(snapshot.history[m.key]||[]).length;return `<article class="monitor-chart-card ${warning?'is-alert':''}"><div class="monitor-chart-title"><span>${icon(m.icon)} ${safe(m.name)}</span><span class="badge ${warning?'orange':d.online?'green':'gray'}">${warning?'超出范围':d.online?'正常':'历史值'}</span></div><strong class="monitor-current ${warning?'alert-text':''}">${Number.isFinite(value)?safe(value):'—'}<small>${safe(m.unit)}</small></strong><p>${Number.isFinite(c.min)&&Number.isFinite(c.max)?`正常范围 ${safe(c.min)}–${safe(c.max)} ${safe(m.unit)}`:'尚未配置告警阈值'} · ${count} 个采样点</p>${trend(m,snapshot)}</article>`;}).join('')}</div></section>${platformBackend&&d.provisioned?`<section class="panel history-panel monitor-history"><div class="section-heading"><div><h2>历史数据</h2><p>服务器接收时间 · ${monitorRanges.find(([seconds])=>seconds===monitorRange)?.[1]}</p></div><span class="muted small">每页 200 条</span></div><div id="monitor-history-results" aria-live="polite">${query?historyResults(query):'<p class="muted">正在读取历史数据…</p>'}</div></section>`:'<p class="settings-note">静态演示显示设备已有的最近采样；启动平台服务后可查询服务器历史记录。</p>'}</div>`;
}
function startMonitorHistory(){
 if(!platformBackend||view!=='monitor')return;
 const raw=selectedMonitorDevice();if(!raw?.provisioned)return;
 const end=Date.now()/1000;
 historyQuery={userId:currentUser.id,deviceId:raw.id,range:monitorRange,start:end-monitorRange,end,readings:[],cursor:null};
 updateMonitorHistory(historyQuery);fetchHistory(historyQuery);
}
function bindMonitor(){
 const select=document.querySelector('#monitor-device');
 if(select)select.onchange=()=>{monitorDeviceId=select.value;historyQuery=null;historyRequest++;render();startMonitorHistory();};
 document.querySelectorAll('[data-monitor-range]').forEach(button=>button.onclick=()=>{monitorRange=Number(button.dataset.monitorRange);historyQuery=null;historyRequest++;render();startMonitorHistory();});
}
function alertCenterEntries(){
 const rows=[];
 for(const raw of companyDevices()){
  const d=effective(raw),s=deviceScene(d),active=(Array.isArray(d.alertWorkflows)?d.alertWorkflows:[]).filter(row=>row.status==='processing');
  if(!d.online){
   rows.push({deviceId:d.id,name:d.name,location:d.location,level:'critical',levelLabel:'严重',kind:d.provisioned&&!d.lastSeen?'设备待激活':'设备离线',detail:'请检查设备供电、网络连接与数据上报状态。',value:'—',unit:'',range:'',status:d.provisioned&&!d.lastSeen?'待激活':'待处理'});
   continue;
  }
  const warnings=alarms(s,d),keys=[...new Set([...warnings.map(m=>m.key),...active.map(row=>row.metric)])];
  for(const key of keys){
   const m=s.metrics.find(row=>row.key===key)||{key,name:key,unit:''},warning=warnings.some(row=>row.key===key),workflow=active.find(row=>row.metric===key),c=metricConfig(s,d,m),value=d.values[key];
   rows.push({deviceId:d.id,name:d.name,location:d.location,level:'warning',levelLabel:'预警',kind:warning?`${m.name}超出范围`:`${m.name}恢复待复核`,detail:warning?'当前读数已超出设备配置的正常范围。':'指标已恢复到配置范围，等待管理员或开发者复核闭环。',value:Number.isFinite(value)?value:'—',unit:m.unit||'',range:Number.isFinite(c.min)&&Number.isFinite(c.max)?`正常范围 ${c.min}–${c.max} ${m.unit||''}`:'',status:workflow?'处理中':'待处理'});
  }
 }
 return rows;
}
function renderAlerts(){
 const all=alertCenterEntries();
 if(alertDeviceFilter&&!companyDevices().some(d=>d.id===alertDeviceFilter))alertDeviceFilter='';
 const rows=all.filter(row=>(!alertDeviceFilter||row.deviceId===alertDeviceFilter)&&(!alertLevelFilter||row.level===alertLevelFilter)),processing=all.filter(row=>row.status==='处理中').length,critical=all.filter(row=>row.level==='critical').length;
 return `<div class="alert-center-page">${heading('COMPANY / ALERT CENTER','告警中心',`${safe(company()?.name)} · 统一查看设备离线与指标异常`,'<button class="secondary" data-route="company">返回概览</button>')}<div class="alert-center-stats">${[['当前告警',all.length,'bell'],['严重',critical,'device'],['预警',all.length-critical,'environment'],['处理中',processing,'task']].map(([label,value,iconName])=>`<section class="panel"><span>${icon(iconName)} ${label}</span><strong>${value}<small> 项</small></strong></section>`).join('')}</div><section class="panel alert-center-panel"><div class="alert-center-filters"><label for="alert-device-filter">设备<select id="alert-device-filter"><option value="">全部设备</option>${companyDevices().map(raw=>{const d=effective(raw);return `<option value="${safe(d.id)}" ${d.id===alertDeviceFilter?'selected':''}>${safe(d.name)} · ${safe(d.id)}</option>`;}).join('')}</select></label><label for="alert-level-filter">告警级别<select id="alert-level-filter"><option value="">全部级别</option><option value="critical" ${alertLevelFilter==='critical'?'selected':''}>严重</option><option value="warning" ${alertLevelFilter==='warning'?'selected':''}>预警</option></select></label><span>筛选出 ${rows.length} 项</span></div><div class="alert-center-list">${rows.map(row=>`<article class="alert-center-row ${row.level}"><span class="alert-center-symbol">${icon(row.level==='critical'?'device':'bell')}</span><div class="alert-center-copy"><div><span class="badge ${row.level==='critical'?'red':'orange'}">${row.levelLabel}</span><span class="badge ${row.status==='处理中'?'blue':row.status==='待激活'?'gray':'orange'}">${row.status}</span></div><h3>${safe(row.kind)}</h3><p>${safe(row.detail)}</p><small>${safe(row.name)} · ${safe(row.deviceId)} · ${safe(row.location)}</small></div><div class="alert-center-reading"><strong>${safe(row.value)}<small>${safe(row.unit)}</small></strong><span>${safe(row.range)}</span></div><button class="secondary" data-device="${safe(row.deviceId)}">查看设备 ${icon('arrow')}</button></article>`).join('')||`<div class="alert-center-empty">${icon(all.length?'eye':'check')}<h2>${all.length?'没有符合筛选条件的告警':'当前没有告警'}</h2><p>${all.length?'请调整设备或告警级别筛选。':'所有设备在线，监测指标均在配置范围内。'}</p></div>`}</div></section><p class="settings-note">点击“查看设备”可查看实时读数、处理告警并完成复核闭环。</p></div>`;
}
/* Background telemetry updates reuse DOM nodes so entrance animations and drafts stay intact. */
function liveNodeKey(node){
 if(node.nodeType!==1)return String(node.nodeType);
 return [node.namespaceURI,node.localName,node.id||node.getAttribute('data-live-key')||node.getAttribute('data-device')||node.classList[0]||''].join(':');
}
function patchLiveNode(current,next){
 if(current.nodeType!==1){if(current.nodeValue!==next.nodeValue)current.nodeValue=next.nodeValue;return;}
 if(current.id==='device-map')return;
 // Keep field drafts and caret, but let telemetry update review gating and hints.
 if(current.matches('input,textarea,select')){
  if(next.hasAttribute('disabled'))current.setAttribute('disabled','');else current.removeAttribute('disabled');
  return;
 }
 for(const attr of [...current.attributes])if(!next.hasAttribute(attr.name)){
  if(attr.name!=='class'||!current.classList.contains('will-reveal'))current.removeAttribute(attr.name);
 }
 for(const attr of next.attributes){
  let value=attr.value;
  if(attr.name==='class')for(const name of ['will-reveal','is-visible'])if(current.classList.contains(name)&&!next.classList.contains(name))value+=' '+name;
  if(current.getAttribute(attr.name)!==value)current.setAttribute(attr.name,value);
 }
 patchLiveChildren(current,next);
}
function patchLiveChildren(current,next){
 const previous=[...current.childNodes],used=new Set();let cursor=current.firstChild;
 for(const desired of next.childNodes){
  const key=liveNodeKey(desired),existing=previous.find(node=>!used.has(node)&&liveNodeKey(node)===key);
  const node=existing||desired.cloneNode(true);
  if(existing){used.add(existing);patchLiveNode(existing,desired);}
  if(node!==cursor)current.insertBefore(node,cursor);
  cursor=node.nextSibling;
 }
 for(const node of previous)if(!used.has(node))node.remove();
}
function updateWorkspaceHtml(html,live){
 if(!live){app.innerHTML=html;return;}
 const template=document.createElement('template');template.innerHTML=html;
 patchLiveChildren(app,template.content);
}
function render(live=false){
 stopSerialPolling();
 if(!live)disposeDeviceMap();
 if(!currentUser)syncMqttPolling();
 if(!currentUser){app.innerHTML=accountPage();bindAuth();return;}
 if(!isAdmin()){
  companyId=currentUser.companyId;
  if(!company()){notice='账号尚未分配有效公司，请联系平台管理员分配公司。';view='unassigned';}
  else if(!['chains','company','detail','monitor','alerts','profile','article','device-manage','my-devices','organization','whiteboards','whiteboard-editor'].includes(view))view='company';
 }
 if(!isAdmin()&&!chainId&&view!=='chains'&&view!=='unassigned'){view='chains';notice='请先选择供应链，选择后才能进入工作台。';}
 if(view==='device-manage'&&!canManageDevices())view=isAdmin()?'platform':'company';
 if(view==='detail'&&!companyDevices().some(d=>d.id===deviceId)){view='company';notice='设备不属于当前公司，已返回公司首页。';}
 if(platformBackend&&view==='template')view='company';
 if(view==='organization'&&!canOrganize())view=isAdmin()?'platform':'company';
 const r=roles[currentUser.role],c=company();
 const labels={organization:'组织管理','my-devices':'我的设备','device-manage':currentUser?.role==='developer'?'设备接入':'设备管理',platform:'供应链物联网平台',chains:'选择供应链',chain:platform.chains.find(x=>x.id===chainId)?.name,companies:platform.categories.find(x=>x.id===categoryId)?.name,company:c?.name,detail:effective(device()||{}).name,monitor:'数据监测',alerts:'告警中心',profile:'我的',template:'页面配置',tests:'测试',usb:'USB 测试',mqtt:'本地联网测试',news:'新闻',article:'文章',whiteboards:'展示白板','whiteboard-editor':'白板编辑器',unassigned:'公司待分配'};
 const adminNav=[['platform','grid','平台总览'],['whiteboards','eye','展示白板'],['tests','code','测试'],['news','chat','新闻'],['profile','users','我的']];
 if(platformBackend)adminNav.splice(1,0,['organization','users','公司与管理员']);
 const companyNav=[['home','grid','首页'],['news','chat','新闻'],['profile','users','我的']];
 const consoleNav=[['overview','grid','概览'],['devices','device',canManageDevices()?(currentUser?.role==='developer'?'设备接入':'设备管理'):'我的设备'],['monitor','task','数据监测'],['alerts','bell','告警中心'],['showcase','eye','展示白板']];
 if(isCompanyAdmin()&&platformBackend)consoleNav.push(['organization','users','公司管理']);
 const chainLocked=!isAdmin()&&!chainId;
 const nav=chainLocked?'':isAdmin()?adminNav.map(([v,i,t])=>`<button class="nav-item ${view===v?'active':''}" data-route="${v}" aria-label="${t}" title="${t}">${icon(i)}<span>${t}</span></button>`).join(''):consoleNav.map(([section,i,t])=>{
  const route=section==='devices'&&!canManageDevices()?'my-devices':'';
  const active=((view==='company'&&companyTab==='home'&&section==='overview')||(view==='device-manage'&&section==='devices')||(view==='my-devices'&&section==='devices')||(view==='monitor'&&section==='monitor')||(view==='alerts'&&section==='alerts')||(view==='organization'&&section==='organization')||(['whiteboards','whiteboard-editor'].includes(view)&&section==='showcase'))?'active':'';
  return `<button class="nav-item ${active}" ${route?`data-route="${route}"`:`data-console-section="${section}"`} aria-label="${t}" title="${t}">${icon(i)}<span>${t}</span></button>`;
 }).join('')+companyNav.filter(([v])=>v!=='home').map(([v,i,t])=>`<button class="nav-item ${(v==='profile'?view==='profile':view==='company'&&companyTab===v)?'active':''}" data-tab="${v}" aria-label="${t}" title="${t}">${icon(i)}<span>${t}</span></button>`).join('');
 let body;
 if(view==='chains')body=chainPickerPage();else if(view==='organization')body=organizationPage();else if(view==='whiteboards')body=whiteboardListPage();else if(view==='whiteboard-editor')body=wbEditorPage();else if(view==='device-manage')body=deviceManagementPage();else if(view==='my-devices')body=myDevicesPage();else if(view==='platform')body=platformPage();else if(view==='chain')body=chainPage();else if(view==='companies')body=companiesPage();else if(view==='tests')body=testsPage();else if(view==='news')body=newsListPage();else if(view==='article')body=articlePage();else if(view==='profile')body=profilePage();else if(view==='template')body=templatePage();else if(['usb','mqtt'].includes(view))body=renderSerialTest();else if(view==='detail')body=renderDetail();else if(view==='monitor')body=renderMonitor();else if(view==='alerts')body=renderAlerts();else if(view==='unassigned')body='<div class="offline-note">'+safe(notice)+'</div>';else body=companyTab==='news'?newsPage():companyHome();
 const tabs=['company','detail','alerts','article'].includes(view)&&c?`<div class="company-topline"><div><span class="company-initial">${safe(c?.name?.slice(0,1)||'公')}</span><strong>${safe(c?.name)}</strong></div><nav aria-label="公司页面">${companyNav.map(([v,i,t])=>`<button data-tab="${v}" class="${(view==='company'&&companyTab===v)||(view==='article'&&v==='news')?'active':''}">${icon(i)}${t}</button>`).join('')}</nav></div>`:'';
 if(!['detail','alerts'].includes(view))alertDrafts.clear();
 const focusedDraft=document.activeElement?.dataset?.draftKey,caretPos=document.activeElement?.selectionStart;
 updateWorkspaceHtml(`<div class="workspace ${!isAdmin()?'customer-console':'admin-console'}"><aside class="sidebar"><a href="./" class="brand">${logo()}</a><div class="workspace-label">${isAdmin()?'平台管理':'公司工作空间'} <span>${isAdmin()?'ADMIN':'WORKSPACE'}</span></div>${isAdmin()?'':chainSwitcher()}${chainLocked?'<p class="chain-lock-note">'+icon('shield')+' 先选择一条供应链，之后才能进入工作台。</p>':''}<nav aria-label="主导航">${nav}</nav><div class="sidebar-bottom"><div class="help-card"><span class="help-icon">${icon('shield')}</span><strong>${isAdmin()?'统一管理，独立配置':'专属空间，清晰可见'}</strong><p>${isAdmin()?'管理公司与公司管理员，查看平台运行情况。':'查看本公司设备与预警，让每一项数据有迹可循。'}</p><span class="badge ${r.color}">${r.label}</span></div><div class="sidebar-user"><span class="user-avatar">${safe(currentUser.name?.slice(0,1)||'用')}</span><div><strong>${safe(currentUser.name)}</strong><small>${r.label}</small></div><button class="icon-button" id="logout" aria-label="退出登录" title="退出登录">${icon('logout')}</button></div></div></aside><div class="main-shell"><header class="topbar">${!isAdmin()&&!chainLocked?`<div class="console-header-search">${icon('eye')}<input id="console-global-search" type="search" aria-label="搜索公司设备" placeholder="搜索设备、设备 ID、位置…"></div><div class="console-header-meta"><span>仅本公司数据</span><button class="icon-button" data-console-section="alerts" aria-label="查看告警中心">${icon('bell')}${warningDevices().length?'<i></i>':''}</button><button class="console-account" data-tab="profile"><span>${safe(currentUser.name?.slice(0,1)||'用')}</span>${safe(currentUser.name)}</button></div>`:''}<div class="legacy-breadcrumb"><button class="crumb-button" data-route="${isAdmin()?'platform':'chains'}">${isAdmin()?'平台管理':safe(chainId?currentChain()?.name:'供应链')}</button><span class="slash">/</span><strong>${safe(labels[view]||'工作台')}</strong></div><div class="topbar-right"><span class="environment"><i></i> ${platformBackend?'平台服务':(['usb','mqtt'].includes(view)||companyDevices().some(d=>d.mqtt)?'MQTT / 本地接收':'演示空间')}</span><span class="badge ${r.color}">${icon('shield')}${r.label}</span></div></header><main class="main-content">${notice&&view!=='unassigned'?`<div class="notice" role="status">${safe(notice)}</div>`:''}${tabs}${body}<footer class="main-footer"><span>物联空间 · 连接供应链的每一环</span><span>${platformBackend?'设备与配置由服务器统一管理，监测值来自实际接收的上报':(['usb','mqtt'].includes(view)||companyDevices().some(d=>d.mqtt)?'MQTT 设备显示实际接收值；其他设备为演示快照':'公司设备数据为演示快照')}</span></footer></main></div></div>`,live);
 bindPortal();bindWhiteboard();bindOrganization();bindDeviceManagement();bindNews();if(typeof bindPlatformFeatures==='function')bindPlatformFeatures();if(!live)bindExperience();syncMqttPolling();syncRegistryPolling();if(['usb','mqtt'].includes(view))startSerialPolling();if(focusedDraft){const field=document.querySelector(`[data-draft-key="${CSS.escape(focusedDraft)}"]`);if(field){field.focus();if(Number.isInteger(caretPos))try{field.setSelectionRange(caretPos,caretPos);}catch(error){}}}
}
async function readJson(path){const response=await fetch(path,{cache:'no-store'});if(!response.ok)throw new Error(`无法读取 ${path}（${response.status}）`);return response.json();}
async function passwordHash(text){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
function enterUser(user){
 currentUser=normalizeUser(user);sessionStorage.setItem('workspace-user',currentUser.id);notice='';organizationError='';deviceSceneFilter='';companyTab='home';companyId=currentUser.companyId||null;
 categoryId=company()?.categoryId||null;
 if(isAdmin()){view='platform';chainId=null;}
 else{chainId=null;view='chains';}
 render();window.scrollTo({top:0,behavior:'instant'});
}
async function logout(){if(platformBackend)await platformRequest('logout',{method:'POST',body:'{}'}).catch(()=>{});resetRegistry();if(typeof historyQuery!=='undefined'){historyQuery=null;historyRequest++;}stopSerialPolling();sessionStorage.removeItem('workspace-user');currentUser=null;companyId=null;chainId=null;deviceId=null;companyMembers=[];companyScenes=[];organizationError='';notice='';authMode='login';render();window.scrollTo({top:0,behavior:'instant'});}
function bindAuth(){
 document.querySelectorAll('[data-auth]').forEach(b=>b.onclick=()=>{authMode=b.dataset.auth;notice='';render();});
 const toggle=document.querySelector('#toggle-password');
 if(toggle)toggle.onclick=e=>{const p=document.querySelector('#password');p.type=p.type==='password'?'text':'password';e.currentTarget.setAttribute('aria-label',p.type==='password'?'显示密码':'隐藏密码');};
 const forgot=document.querySelector('#forgot-password');
 if(forgot)forgot.onclick=()=>{authMode='reset';notice='';render();};
 const sendReset=document.querySelector('#send-reset-code');
 if(sendReset)sendReset.onclick=async()=>{
  const hint=document.querySelector('#auth-code-hint'),phone=document.querySelector('#username').value.trim();
  if(!/^1[3-9]\d{9}$/.test(phone)){const target=document.querySelector('#auth-error');if(target)target.textContent='请输入有效的 11 位手机号。';return;}
  sendReset.disabled=true;let remain=60;sendReset.textContent='60 秒后重试';
  const timer=setInterval(()=>{remain-=1;if(!document.querySelector('#send-reset-code')){clearInterval(timer);return;}if(remain<=0){clearInterval(timer);sendReset.disabled=false;sendReset.textContent='重新获取';return;}sendReset.textContent=`${remain} 秒后重试`;},1000);
  try{const result=await platformRequest('auth/reset/code',{method:'POST',body:JSON.stringify({phone})});
   if(hint)hint.textContent=result.debugCode?`演示验证码：${result.debugCode}（未配置短信服务，已输出到服务端日志）`:(result.delivered?`验证码已发送至 ${result.phone||'该手机号'}，5 分钟内有效。`:(result.message||'若该手机号已绑定账号，验证码已发送。'));
  }catch(error){const target=document.querySelector('#auth-error');if(target)target.textContent=error.message;clearInterval(timer);sendReset.disabled=false;sendReset.textContent='获取验证码';}
 };
 const sendRegister=document.querySelector('#send-register-code');
 if(sendRegister)sendRegister.onclick=async()=>{
  const hint=document.querySelector('#register-code-hint'),phone=document.querySelector('#register-phone').value.trim();
  if(!/^1[3-9]\d{9}$/.test(phone)){const target=document.querySelector('#auth-error');if(target)target.textContent='请输入有效的 11 位手机号。';return;}
  sendRegister.disabled=true;let remain=60;sendRegister.textContent='60 秒后重试';
  const timer=setInterval(()=>{remain-=1;if(!document.querySelector('#send-register-code')){clearInterval(timer);return;}if(remain<=0){clearInterval(timer);sendRegister.disabled=false;sendRegister.textContent='重新获取';return;}sendRegister.textContent=`${remain} 秒后重试`;},1000);
  try{const result=await platformRequest('auth/register/code',{method:'POST',body:JSON.stringify({phone})});
   if(hint)hint.textContent=result.debugCode?`演示验证码：${result.debugCode}（未配置短信服务，已输出到服务端日志）`:`验证码已发送至 ${result.phone||'该手机号'}，5 分钟内有效。`;
  }catch(error){const target=document.querySelector('#auth-error');if(target)target.textContent=error.message;clearInterval(timer);sendRegister.disabled=false;sendRegister.textContent='获取验证码';}
 };
 document.querySelector('#auth-form').onsubmit=async e=>{
  e.preventDefault();const form=e.currentTarget,button=form.querySelector('[type=submit]');button.disabled=true;
  try{
   if(!platformBackend)users=(await readJson('./users.json')).users.map(normalizeUser);
   const username=form.elements.username.value.trim(),password=form.elements.password.value,hash=platformBackend?'':await passwordHash(password);
   if(authMode==='reset'){
    if(!platformBackend)throw new Error('短信重置密码仅在平台服务可用时开放。');
    if(password!==document.querySelector('#confirm-password').value)throw new Error('两次输入的新密码不一致。');
    const result=await platformRequest('auth/reset/confirm',{method:'POST',body:JSON.stringify({phone:username,code:form.elements.code.value.trim(),newPassword:password})});
    authMode='login';notice=result.message||'密码已重置，请使用新密码登录。';render();return;
   }
   if(authMode==='login'){
    if(platformBackend){const {user}=await platformRequest('login',{method:'POST',body:JSON.stringify({username,password})});resetRegistry();await refreshBeforeEnter(user);routeArticleHash();return;}
    const user=allUsers().find(u=>u.username===username&&u.passwordHash===hash);if(!user)throw new Error('账号或密码错误。');enterUser(user);routeArticleHash();
   }else{
    if(platformBackend){
     if(password!==document.querySelector('#confirm-password').value)throw new Error('两次输入的密码不一致。');
     const {user}=await platformRequest('register',{method:'POST',body:JSON.stringify({username,password,name:form.elements.displayName.value.trim(),inviteCode:form.elements.inviteCode.value.trim(),phone:form.elements.phone.value.trim(),code:form.elements.code.value.trim()})});
     resetRegistry();await refreshBeforeEnter(user);routeArticleHash();return;
    }
    const name=form.elements.displayName.value.trim(),assigned=form.elements.companyId.value;
    if(username.length<3||username.length>40||!name||password.length<6)throw new Error('请填写姓名、3–40 位账号和至少 6 位密码。');
    if(password!==document.querySelector('#confirm-password').value)throw new Error('两次输入的密码不一致。');
    if(!platform.companies.some(c=>c.id===assigned))throw new Error('请选择有效公司。');
    if(allUsers().some(u=>u.username===username))throw new Error('该账号已存在。');
    const user={id:'local-'+crypto.randomUUID(),username,name,passwordHash:hash,role:'customer',companyId:assigned};
    localStorage.setItem(registeredKey,JSON.stringify([...registeredUsers(),user]));enterUser(user);routeArticleHash();
   }
  }catch(error){const target=document.querySelector('#auth-error');if(target)target.textContent=error.message;}finally{button.disabled=false;}
 };
}
function bindPortal(){
 const on=(selector,fn)=>{const el=document.querySelector(selector);if(el)el.onclick=fn;};
 document.querySelectorAll('[data-route]').forEach(b=>b.onclick=()=>{
  const next=b.dataset.route;if(!isAdmin()&&!['chains','company','profile','whiteboards','whiteboard-editor','my-devices'].includes(next)&&!(next==='device-manage'&&canManageDevices()))return;
  if(next==='device-manage')pendingDeleteId=null;
  if(['usb','mqtt'].includes(next)){testMode=next;serialPaused=false;serialCursor=0;serialLines=[];serialDropped=false;serialState={source:next==='usb'?'serial':'mqtt',device:'/dev/ttyUSB0',baudrate:9600,host:'127.0.0.1',port:1883,topic:'rd-web/test/#',total:0,status:'connecting',error:''};}
  if(next==='news'){companyId=null;navigate('news');refreshNews();return;}if(next==='company')companyTab='home';navigate(next);
 });
 document.querySelectorAll('[data-chain]').forEach(b=>b.onclick=()=>{if(isAdmin()){chainId=b.dataset.chain;navigate('chain');}});
 document.querySelectorAll('[data-chain-enter]').forEach(b=>b.onclick=()=>{
  const c=platform.chains.find(x=>x.id===b.dataset.chainEnter);if(!c)return;
  if(c.status==='building'){notice=`${c.name}模块建设中，敬请期待。`;render();return;}
  const cats=platform.categories.filter(k=>k.chainId===c.id),own=platform.companies.find(x=>x.id===currentUser.companyId);
  if(own&&!cats.some(k=>k.id===own.categoryId)){notice=`当前账号所属公司暂未开通${c.name}，请联系平台管理员。`;render();return;}
  chainId=c.id;
  if(own){categoryId=own.categoryId;companyId=own.id;}
  companyTab='home';notice='';navigate('company');
 });
 document.querySelectorAll('[data-category]').forEach(b=>b.onclick=()=>{if(isAdmin()){categoryId=b.dataset.category;navigate('companies');}});
 document.querySelectorAll('[data-admin-device]').forEach(b=>b.onclick=()=>openAdminDevice(b.dataset.adminDevice));
 document.querySelectorAll('[data-company]').forEach(b=>b.onclick=()=>openCompany(b.dataset.company));
 document.querySelectorAll('[data-device]').forEach(b=>b.onclick=()=>openDevice(b.dataset.device));
 document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{companyTab=b.dataset.tab;navigate(companyTab==='profile'?'profile':'company');if(companyTab==='news')refreshNews();});
 document.querySelectorAll('[data-console-section]').forEach(button=>button.onclick=()=>{
  const section=button.dataset.consoleSection;
  if(section==='showcase'){navigate('whiteboards');return;}
  if(section==='organization'&&canOrganize()){navigate('organization');return;}
  if(section==='devices'){if(canManageDevices()){pendingDeleteId=null;navigate('device-manage');}else{navigate('my-devices');}return;}
  if(section==='monitor'){navigate('monitor');startMonitorHistory();return;}
  if(section==='alerts'){navigate('alerts');return;}
  const needsHome=view!=='company'||companyTab!=='home';companyTab='home';if(needsHome)navigate('company');
  if(view!=='company'||companyTab!=='home')return;
  const target=section==='devices'?'#dashboard-devices':null;
  if(target){const el=document.querySelector(target);if(el){el.scrollIntoView({block:'start',behavior:'instant'});return;}}
  window.scrollTo({top:0});
 });
 bindMonitor();
 const alertDevice=document.querySelector('#alert-device-filter');if(alertDevice)alertDevice.onchange=()=>{alertDeviceFilter=alertDevice.value;render();};
 const alertLevel=document.querySelector('#alert-level-filter');if(alertLevel)alertLevel.onchange=()=>{alertLevelFilter=alertLevel.value;render();};
 const bindRowButtons=()=>document.querySelectorAll('#console-device-rows [data-device]').forEach(b=>b.onclick=()=>openDevice(b.dataset.device));
 const searchDevices=query=>{const rows=document.querySelector('#console-device-rows');if(rows){rows.innerHTML=consoleDeviceRows(query);bindRowButtons();}};
 const sceneFilter=document.querySelector('#console-scene-filter');if(sceneFilter)sceneFilter.onchange=()=>{deviceSceneFilter=sceneFilter.value;searchDevices(document.querySelector('#console-device-search')?.value||'');};
 const tableSearch=document.querySelector('#console-device-search');if(tableSearch)tableSearch.oninput=()=>searchDevices(tableSearch.value);
 bindDeviceMap();
 const globalSearch=document.querySelector('#console-global-search');if(globalSearch)globalSearch.onkeydown=event=>{if(event.key!=='Enter')return;event.preventDefault();const query=globalSearch.value,needsHome=view!=='company'||companyTab!=='home';companyTab='home';if(needsHome)navigate('company');const input=document.querySelector('#console-device-search');if(input){input.value=query;searchDevices(query);input.scrollIntoView({block:'center'});input.focus();}};
 on('#logout',logout);on('#profile-logout',logout);on('#warning-devices',openWarnings);on('#back-devices',()=>{companyTab='home';navigate('company');});
 const overview=document.querySelector('#overview-device');if(overview)overview.onchange=()=>{overviewDeviceId=overview.value;render();};
 on('[data-scroll-devices]',()=>document.querySelector('#dashboard-devices')?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}));
 const settings=document.querySelector('#settings-form');if(settings)settings.onsubmit=saveSettings;
 document.querySelectorAll('.alert-handle-form').forEach(form=>form.onsubmit=event=>submitAlertWorkflow(event,'handle'));
 document.querySelectorAll('.alert-review-form').forEach(form=>form.onsubmit=event=>submitAlertWorkflow(event,'review'));
 on('#reset-settings',()=>{if(!canEdit()||device()?.provisioned)return;const overrides=readStorage(storageKey,{});delete overrides[deviceId];localStorage.setItem(storageKey,JSON.stringify(overrides));notice='已恢复设备默认配置。';render();});on('#export-config',exportConfig);
 on('#pause-serial',()=>{serialPaused=!serialPaused;document.querySelector('#pause-serial').textContent=serialPaused?'继续显示':'暂停显示';startSerialPolling();});
 on('#clear-serial',()=>{serialLines=[];serialDropped=false;updateSerialPanel();});on('#retry-serial',()=>{serialPaused=false;document.querySelector('#pause-serial').textContent='暂停显示';startSerialPolling();});
 function editTemplate(action){
  if(!isAdmin()||!company())return;
  try{
   const raw=document.querySelector('#template-editor').value,t=parseTemplate(raw);templateDraft=raw;
   document.querySelector('#template-error').textContent='';
   if(action==='preview'){document.querySelector('#template-preview').innerHTML=`<h2>${safe(t.config.title)}</h2><p>${safe(t.config.subtitle)}</p><p>统计组件：${t.config.widgets.map(safe).join(' / ')} · 设备列表：${t.config.showDevices?'显示':'隐藏'}</p>`+markdown(t.body);}
   if(action==='save'){const overrides=readStorage(templateKey,{});overrides[companyId]=raw;localStorage.setItem(templateKey,JSON.stringify(overrides));companyTab='home';view='company';notice='公司页面已由 Markdown 生成并保存到当前浏览器。';render();}
   if(action==='download'){const url=URL.createObjectURL(new Blob([raw],{type:'text/markdown;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=companyId+'.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  }catch(error){document.querySelector('#template-error').textContent=error.message;}
 }
 on('#preview-template',()=>editTemplate('preview'));on('#save-template',()=>editTemplate('save'));on('#download-template',()=>editTemplate('download'));
 on('#reset-template',()=>{if(!isAdmin())return;const overrides=readStorage(templateKey,{});delete overrides[companyId];localStorage.setItem(templateKey,JSON.stringify(overrides));templateDraft=null;render();});
}
/* ===== 实时刷新：只替换数据节点，保留表单输入、地图与滚动位置 ===== */
function bindLiveDeviceButtons(scope){
 (scope||document).querySelectorAll('[data-device]').forEach(button=>button.onclick=()=>openDevice(button.dataset.device));
}
function refreshSensorCards(s,d){
 const warnings=alarms(s,d);
 document.querySelectorAll('.sensor-grid .sensor-card').forEach(card=>{
  const key=String(card.dataset.liveKey||'').replace('metric-',''),m=s.metrics.find(row=>row.key===key);if(!m)return;
  const value=d.values?.[key],warning=d.online&&warnings.some(row=>row.key===key);
  card.classList.toggle('sensor-warning',!!warning);
  const valueBox=card.querySelector('.sensor-value');if(valueBox)valueBox.innerHTML=`${Number.isFinite(value)?safe(value):'—'}<small>${safe(m.unit)}</small>`;
  const badge=card.querySelector('.sensor-title .badge');if(badge){badge.className='badge '+(!Number.isFinite(value)?'gray':!d.online?'gray':warning?'orange':'green');badge.textContent=!Number.isFinite(value)?'待接入':!d.online?'历史值':warning?'超出范围':'正常';}
  const svg=card.querySelector('svg.trend-chart');if(svg)svg.outerHTML=trend(m,d);
  const caption=card.querySelectorAll('.chart-caption span');if(caption[1])caption[1].textContent=Number.isFinite(value)?'最新':'待接入';
 });
}
function refreshAlertWorkflowPanel(s,d){
 const current=document.querySelector('#alert-workflow'),html=alertWorkflowPanel(s,d);
 if(!html){current?.remove();return;}
 const template=document.createElement('template');template.innerHTML=html;
 const next=template.content.firstElementChild;
 if(current)current.replaceWith(next);else document.querySelector('.detail-grid')?.before(next);
 document.querySelectorAll('.alert-handle-form').forEach(form=>form.onsubmit=event=>submitAlertWorkflow(event,'handle'));
 document.querySelectorAll('.alert-review-form').forEach(form=>form.onsubmit=event=>submitAlertWorkflow(event,'review'));
}
function refreshMonitorLive(){
 const raw=selectedMonitorDevice();if(!raw)return;
 const d=effective(raw),s=deviceScene(d),snapshot=monitorSnapshot(d),warnings=alarms(s,d),[label,color]=status(s,d);
 const summary=document.querySelector('.monitor-summary');
 if(summary){
  const badge=summary.querySelector('.badge');if(badge){badge.className='badge '+color;badge.textContent=label;}
  const values=summary.querySelectorAll(':scope > div > strong');
  if(values[3]){values[3].textContent=d.online?warnings.length+' 项':'设备离线';values[3].className=warnings.length?'alert-text':'';}
 }
 document.querySelectorAll('.monitor-chart-grid .monitor-chart-card').forEach((card,index)=>{
  const m=s.metrics[index];if(!m)return;
  const warning=d.online&&warnings.some(row=>row.key===m.key),value=d.values?.[m.key];
  card.classList.toggle('is-alert',!!warning);
  const current=card.querySelector('.monitor-current');
  if(current){current.innerHTML=`${Number.isFinite(value)?safe(value):'—'}<small>${safe(m.unit)}</small>`;current.className='monitor-current'+(warning?' alert-text':'');}
  const badge=card.querySelector('.monitor-chart-title .badge');
  if(badge){badge.className='badge '+(warning?'orange':d.online?'green':'gray');badge.textContent=warning?'超出范围':d.online?'正常':'历史值';}
  const svg=card.querySelector('svg.trend-chart');if(svg)svg.outerHTML=trend(m,snapshot);
 });
}
function refreshLiveView(){
 if(!currentUser)return;
 if(view==='whiteboard-editor'){if(typeof wbRefreshLiveNodes==='function')wbRefreshLiveNodes();return;}
 if(view==='company'&&companyTab==='home'){
  const stats=document.querySelector('.company-stats');
  if(stats){try{const box=document.createElement('div');box.innerHTML=dashboardCards();stats.replaceWith(box.firstElementChild);const warning=document.querySelector('#warning-devices');if(warning)warning.onclick=openWarnings;}catch{}}
  const monitor=document.querySelector('#console-monitor');
  if(monitor){
   if(monitor.dataset.layout==='ov'){
    monitor.innerHTML=consoleHealthPanel();
    const sampling=document.querySelector('#console-sampling');if(sampling)sampling.innerHTML=consoleSamplingPanel();
    bindLiveDeviceButtons(monitor);
    const overview=document.querySelector('#overview-device');if(overview)overview.onchange=()=>{overviewDeviceId=overview.value;render();};
   }else{
    monitor.innerHTML=companyInsights();bindLiveDeviceButtons(monitor);
    const overview=monitor.querySelector('#overview-device');if(overview)overview.onchange=()=>{overviewDeviceId=overview.value;render();};
   }
  }
  const grid=document.querySelector('.device-grid');
  if(grid){const box=document.createElement('div');box.innerHTML=deviceCards(companyDevices());grid.replaceWith(box.firstElementChild);bindLiveDeviceButtons(box);}
  const rows=document.querySelector('#console-device-rows');
  if(rows){rows.innerHTML=consoleDeviceRows(document.querySelector('#console-device-search')?.value||'');bindLiveDeviceButtons(rows);}
  return;
 }
 if(view==='detail'){
  const s=scene(),d=effective(device());if(!s||!d)return;
  refreshSensorCards(s,d);
  const statusBadge=document.querySelector('.page-heading [data-live-status]');
  if(statusBadge){const [label,color]=status(s,d);statusBadge.className='badge '+color;statusBadge.textContent=label;}
  refreshAlertWorkflowPanel(s,d);
  return;
 }
 if(view==='monitor'){refreshMonitorLive();return;}
 if(view==='alerts'||(view==='platform'&&isAdmin()))render(true);
}
async function init(){
 try{
  await detectPlatform();
  const results=await Promise.all([platformBackend?Promise.resolve({users:[]}):readJson('./users.json'),readJson('./devices.json'),readJson('./platform.json')]);
  users=results[0].users.map(normalizeUser);scenes=results[1].scenes;baseDevices=results[1].devices;platform=results[2];reloadInventory();
  const showcase=new URLSearchParams(location.search).get('showcase');if(showcase){await initPublicWhiteboard(showcase);return;}
  await Promise.all(platform.companies.map(async c=>{try{if(!/^content\/companies\/[a-z0-9-]+\.md$/.test(c.template))throw new Error('公司模板路径无效。');const r=await fetch('./'+c.template,{cache:'no-store'});if(!r.ok)throw new Error(`无法读取 ${c.template}`);templates[c.id]=await r.text();}catch(error){templateErrors[c.id]=error.message;}}));
  await loadNews();window.addEventListener('hashchange',routeArticleHash);
  let u;if(platformBackend){try{u=(await platformRequest('session')).user;await refreshBeforeEnter(u,false);}catch{sessionStorage.removeItem('workspace-user');currentUser=null;}}else{const saved=sessionStorage.getItem('workspace-user');u=allUsers().find(u=>u.id===saved);}if(u){enterUser(u);routeArticleHash();}else render();
 }catch(error){app.innerHTML=`<main class="load-error"><h1>页面加载失败</h1><p>${safe(error.message)}</p><p>请通过本地预览服务或 GitHub Pages 打开。</p><button class="primary" onclick="location.reload()">重试</button></main>`;}
}
init();
