/* Server-owned company administration. Never infer grants from browser storage. */
let companyScenes=[],companyMembers=[],organizationError='',deviceSceneFilter='';
const isCompanyAdmin=()=>currentUser?.role==='company_admin';
const canDiagnose=()=>['company_admin','developer'].includes(currentUser?.role);
const canOrganize=()=>platformBackend&&(isAdmin()||isCompanyAdmin());
async function refreshWorkspace(){
 const userId=currentUser?.id;
 const result=await platformRequest('workspace');
 const members=currentUser?.role==='company_admin'?(await platformRequest('company/members')).members:[];
 if(currentUser?.id!==userId)return;
 platform=result.platform;companyScenes=result.companyScenes;companyMembers=members;
}
function sceneOptions(selected=''){
 return '<option value="">未分组</option>'+companyScenes.filter(s=>s.company===companyId).map(s=>`<option value="${safe(s.id)}" ${s.id===selected?'selected':''}>${safe(s.name)}</option>`).join('');
}
function organizationPage(){
 if(!canOrganize())return '';
 if(isAdmin()){
  const selectedChain=platform.chains.find(c=>c.id===chainId),categories=platform.categories.filter(c=>c.chainId===chainId);
  const companies=platform.companies.filter(company=>categories.some(category=>category.id===company.categoryId));
  const selector=`<section class="panel"><label>当前供应链<select id="organization-chain"><option value="">请选择供应链</option>${platform.chains.map(c=>`<option value="${safe(c.id)}" ${c.id===chainId?'selected':''}>${safe(c.name)}</option>`).join('')}</select></label><p class="settings-note">公司与管理员的创建范围仅包含当前供应链。</p></section>`;
  if(!selectedChain)return heading('PLATFORM / COMPANIES','公司与管理员','先选择供应链，再创建该链下的公司和公司管理员。')+selector;
  return heading('PLATFORM / COMPANIES','公司与管理员',`${safe(selectedChain.name)} · 创建公司，并为公司指定独立的管理员。`)+selector+`<div class="inventory-layout"><section class="panel"><h2>创建公司</h2><form id="create-company-form" class="settings-form"><label>业务场景<select name="categoryId" required>${categories.map(c=>`<option value="${safe(c.id)}">${safe(c.name)}</option>`).join('')}</select></label><label>公司名称<input name="name" maxlength="40" required></label><button class="primary" ${categories.length?'':'disabled'}>创建公司</button></form><h2>指定公司管理员</h2><form id="create-company-admin-form" class="settings-form"><label>公司<select name="companyId" required>${companies.map(c=>`<option value="${safe(c.id)}">${safe(c.name)}</option>`).join('')}</select></label><label>姓名<input name="name" maxlength="40" required></label><label>账号<input name="username" pattern="[A-Za-z0-9_.-]{3,40}" required></label><label>初始密码<input name="password" type="password" minlength="12" maxlength="100" autocomplete="new-password" required></label><button class="primary" ${companies.length?'':'disabled'}>创建公司管理员</button></form></section><section class="panel"><h2>${safe(selectedChain.name)} · 公司列表</h2>${companies.map(c=>`<div class="inventory-deleted"><strong>${safe(c.name)}</strong><small>${safe(platform.categories.find(category=>category.id===c.categoryId)?.name||'未分类')}</small><button class="secondary" data-company="${safe(c.id)}">查看工作台</button></div>`).join('')||'<p>当前供应链尚未创建公司。</p>'}</section></div><p id="organization-error" class="error" role="alert">${safe(organizationError)}</p>`;
 }
 return heading('COMPANY / ADMINISTRATION','公司管理','管理公司场景、生成邀请码，并分配客户可查看的设备。')+`<p id="organization-error" class="error" role="alert">${safe(organizationError)}</p><div class="inventory-layout"><div><section class="panel"><h2>邀请成员</h2><form id="invite-member-form" class="settings-form"><label>邀请身份<select name="role"><option value="customer">公司客户</option><option value="developer">客户开发者</option></select></label><button class="primary">生成邀请码</button></form><p>邀请码有效期 7 天，仅可使用一次。</p><p id="invite-result" role="status"></p></section><section class="panel"><h2>自定义场景</h2><form id="create-scene-form" class="settings-form"><label>场景名称<input name="name" maxlength="40" required placeholder="例如：一号温室、冷链仓库"></label><button class="primary">添加场景</button></form>${companyScenes.filter(s=>s.company===companyId).map(s=>`<form class="scene-edit-form settings-form"><input type="hidden" name="id" value="${safe(s.id)}"><label>场景名称<input name="name" value="${safe(s.name)}" maxlength="40" required></label><div><button class="secondary">保存名称</button> <button type="button" class="danger-button" data-delete-scene="${safe(s.id)}">删除</button></div></form>`).join('')||'<p>尚未创建场景。</p>'}</section></div><section class="panel"><h2>成员与设备权限</h2><p>客户仅能查看勾选的设备；开发者与公司管理员可查看本公司全部设备。</p>${companyMembers.map(m=>`<section class="member-permissions"><h3>${safe(m.name)} <small>${safe(m.username)} · ${safe(roles[m.role]?.label)}</small></h3>${m.role==='customer'?`<form class="device-grants-form settings-form"><input type="hidden" name="userId" value="${safe(m.id)}">${serverDevices.filter(d=>d.companyId===companyId&&!d.deleted).map(d=>`<label class="grant-option"><input type="checkbox" name="deviceIds" value="${safe(d.id)}" ${m.deviceIds.includes(d.id)?'checked':''}>${safe(d.name)} <small>${safe(d.id)}</small></label>`).join('')||'<p>请先创建设备。</p>'}<button class="secondary">保存设备分配</button></form>`:''}</section>`).join('')}</section></div>`;
}
function bindOrganization(){
 if(!canOrganize())return;
 const chainSelect=document.querySelector('#organization-chain');
 if(chainSelect)chainSelect.onchange=()=>{chainId=chainSelect.value||null;categoryId=null;companyId=null;organizationError='';render();};
 const bindForm=(selector,path,prepare=fields=>Object.fromEntries(fields),after)=>{
  document.querySelectorAll(selector).forEach(form=>form.onsubmit=async event=>{
   event.preventDefault();const button=form.querySelector('button');button.disabled=true;
   try{
    const result=await platformRequest(path,{method:'POST',body:JSON.stringify(prepare(new FormData(form)))});
    if(after){after(result);return;}
    await refreshWorkspace();await refreshRegistry();organizationError='';notice='已保存到服务器。';render();
   }catch(error){organizationError=error.message;const target=document.querySelector('#organization-error');if(target)target.textContent=error.message;}
   finally{button.disabled=false;}
  });
 };
 bindForm('#create-company-form','companies');
 bindForm('#create-company-admin-form','company-admins');
 bindForm('#create-scene-form','company/scenes');bindForm('.scene-edit-form','company/scenes');
 bindForm('#invite-member-form','company/invites',undefined,result=>{
  document.querySelector('#invite-result').textContent=`邀请码：${result.inviteCode}（7 天内可注册一次，请复制后交给受邀人）`;
 });
 bindForm('.device-grants-form','company/assignments',fields=>({userId:fields.get('userId'),deviceIds:fields.getAll('deviceIds')}));
 document.querySelectorAll('[data-delete-scene]').forEach(button=>button.onclick=async()=>{
  if(!window.confirm('删除此场景？有关联设备时需要先调整设备场景。'))return;
  try{await platformRequest('company/scenes/delete',{method:'POST',body:JSON.stringify({id:button.dataset.deleteScene})});await refreshWorkspace();organizationError='';render();}
  catch(error){organizationError=error.message;document.querySelector('#organization-error').textContent=error.message;}
 });
}
function serverPlatformPage(){
 const health=platformHealth();
 const chainCards=platform.chains.map(chain=>{
  const categories=platform.categories.filter(category=>category.chainId===chain.id),companies=platform.companies.filter(company=>categories.some(category=>category.id===company.categoryId));
  return navigationCard({title:chain.name,description:chain.description,iconName:chain.icon,color:chain.color,attr:`data-chain="${safe(chain.id)}"`,meta:`${categories.length} 个业务场景 · ${companies.length} 家公司`});
 }).join('');
 return heading('PLATFORM / OPERATIONS','平台管理总览','选择供应链进入对应业务空间，或按链管理公司与公司管理员。','<button class="primary" data-route="organization">公司与管理员</button>')+`<div class="admin-metrics">${[['接入公司',platform.companies.length],['设备总数',health.total],['在线设备',health.online],['预警设备',health.warning]].map(([label,value])=>`<section class="admin-metric blue"><span>${label}</span><strong>${value}</strong></section>`).join('')}</div><section class="panel"><div class="section-heading"><div><span class="dashboard-kicker">SUPPLY CHAINS</span><h2>选择供应链</h2></div></div><div class="portal-grid">${chainCards}</div></section><section class="panel"><h2>公司工作空间</h2><div class="portal-grid">${platform.companies.map(c=>navigationCard({title:c.name,description:'查看公司设备与运行状态',iconName:'users',attr:`data-company="${safe(c.id)}"`,meta:`${companyScenes.filter(s=>s.company===c.id).length} 个自定义场景 · ${devices.filter(d=>d.companyId===c.id).length} 台设备`})).join('')||'<p>请先创建公司并指定公司管理员。</p>'}</div></section>`;
}

async function refreshOrganizationView(){
 const userId=currentUser?.id;
 try{await refreshWorkspace();await refreshRegistry();organizationError='';}
 catch(error){if(currentUser?.id===userId)organizationError=error.message;}
 if(currentUser?.id===userId&&view==='organization')render();
}
