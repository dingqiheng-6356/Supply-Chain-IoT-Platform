/* News: platform notices for everyone, company news for that company's invitees. */
let newsArticles=[],newsErrors=[],newsLoadError='',newsRequest=0,articleId=null,newsDraftScope='';
function newsArticleScope(article){return article.scope||(article.companyId?'company':'platform');}
function visibleNews(){
 if(platformBackend)return newsArticles;
 if(isAdmin()&&!companyId)return newsArticles;
 const scope=isAdmin()?companyId:currentUser?.companyId;
 return newsArticles.filter(article=>newsArticleScope(article)==='platform'||(Boolean(scope)&&article.companyId===scope));
}
async function loadNews(){
 const request=++newsRequest;
 try{
  let articles=[],errors=[];
  if(platformBackend){
   const company=isAdmin()&&companyId?`?company=${encodeURIComponent(companyId)}`:'';
   const data=await platformRequest(`news${company}`);
   articles=Array.isArray(data.posts)?data.posts:[];
  }else{
   const data=await readJson('./news-index.json');
   if(!Array.isArray(data.articles))throw new Error('文章索引格式无效。');
   articles=data.articles;errors=Array.isArray(data.errors)?data.errors:[];
  }
  if(request!==newsRequest)return;
  newsArticles=articles.filter(a=>a&&typeof a.id==='string'&&typeof a.title==='string'&&typeof a.body==='string').map(a=>({...a,scope:newsArticleScope(a)}));
  newsErrors=errors;newsLoadError='';
 }catch(error){if(request===newsRequest)newsLoadError=error.message;}
}
async function refreshNews(){await loadNews();if(currentUser&&(view==='news'||view==='article'||(view==='company'&&companyTab==='news')))render();}
function newsCover(article){
 const image=articleUrl(article.image||'');
 return image?`<div class="news-cover"><img src="${safe(image)}" alt="${safe(article.title)}" loading="lazy"><span class="news-cover-fallback" aria-hidden="true">${icon('device')}<span>供应链物联网平台</span></span></div>`:`<div class="news-cover news-cover-default" aria-hidden="true"><span class="cover-orbit"></span>${icon('device')}<span>供应链物联网平台</span></div>`;
}
function newsCard(article){
 const label=newsArticleScope(article)==='platform'?'平台更新通知':platform.companies.find(c=>c.id===article.companyId)?.name||'公司新闻';
 return `<article class="blog-list-item news-card"><div class="news-card-copy"><div class="article-meta"><time datetime="${safe(article.date||'')}">${safe(article.date||'')}</time><span>${safe(label)}</span></div><h2><a href="#article/${encodeURIComponent(article.id)}" data-article="${safe(article.id)}">${safe(article.title)}</a></h2><p>${safe(article.summary)}</p><a class="article-read" href="#article/${encodeURIComponent(article.id)}" data-article="${safe(article.id)}">阅读全文 ${icon('arrow')}</a></div><a class="news-cover-link" href="#article/${encodeURIComponent(article.id)}" data-article="${safe(article.id)}" aria-label="阅读：${safe(article.title)}">${newsCover(article)}</a></article>`;
}
function newsPublishButton(scope){
 return `<button class="primary" id="news-publish" data-news-publish="${scope}">${scope==='platform'?'发布平台更新通知':'发布公司新闻'}</button>`;
}
function newsPublishForm(scope){
 const company=platform.companies.find(c=>c.id===currentUser?.companyId)?.name||'本公司';
 return `<section class="panel news-publish"><h2>${scope==='platform'?'发布平台更新通知':'发布公司新闻'}</h2><p class="settings-note">${scope==='platform'?'发布后所有平台用户可见。':`发布后仅 ${safe(company)} 的邀请用户可见。`}</p><form id="news-publish-form"><label for="news-title">标题</label><input id="news-title" name="title" maxlength="80" required><label for="news-summary">摘要</label><input id="news-summary" name="summary" maxlength="160" required><div class="news-body-head"><label for="news-body">正文（支持 Markdown，可插入图片）</label><button type="button" class="secondary" id="news-image-upload">插入图片</button><input type="file" id="news-image-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden></div><textarea id="news-body" name="body" rows="8" maxlength="8000" required></textarea><p class="news-image-status" id="news-image-status" role="status"></p><p class="error" id="news-publish-error" role="alert"></p><div class="form-actions"><button type="button" class="secondary" data-news-cancel>取消</button><button class="primary" type="submit">发布</button></div></form></section>`;
}
function newsSection(kind,rows,action,companyName){
 const platform=kind==='platform',title=platform?'平台更新通知':'公司新闻';
 const description=platform?'由平台开发者发布，所有平台用户都可以看到。':`由公司管理者发布，仅 ${safe(companyName||'本公司')} 的邀请用户可见。`;
 return `<section class="news-section" id="news-${kind}"><div class="news-section-head"><div><span class="dashboard-kicker">${platform?'PLATFORM UPDATE':'COMPANY NEWS'}</span><h2>${title}</h2><p class="settings-note">${description}</p></div>${action||''}</div><div class="blog-list news-card-list">${rows.map(newsCard).join('')||`<div class="blog-empty">暂无${title}</div>`}</div></section>`;
}
function newsListPage(){
 const rows=visibleNews(),platformRows=rows.filter(a=>newsArticleScope(a)==='platform'),companyRows=rows.filter(a=>newsArticleScope(a)==='company');
 const canPlatform=isAdmin(),canCompany=currentUser?.role==='company_admin'&&Boolean(currentUser?.companyId);
 const companyName=platform.companies.find(c=>c.id===(companyId||currentUser?.companyId))?.name||'本公司';
 return heading('NEWS','新闻',isAdmin()?'平台更新通知与公司新闻':'平台更新通知与本公司新闻')+
  `${newsLoadError?`<div class="offline-note">文章加载失败：${safe(newsLoadError)} <button class="text-button" id="reload-news">重试</button></div>`:''}`+
  `${isAdmin()&&newsErrors.length?`<div class="offline-note">${newsErrors.map(safe).join('<br>')}</div>`:''}`+
  (newsDraftScope==='platform'&&canPlatform?newsPublishForm('platform'):'')+
  (newsDraftScope==='company'&&canCompany?newsPublishForm('company'):'')+
  newsSection('platform',platformRows,canPlatform&&newsDraftScope!=='platform'?newsPublishButton('platform'):'')+
  (isAdmin()?'':newsSection('company',companyRows,canCompany&&newsDraftScope!=='company'?newsPublishButton('company'):'',companyName))+
  (!platformBackend?'<p class="settings-note">静态演示模式仅展示预置文章；平台服务启动后可以在页面内发布。</p>':'');
}
async function submitNewsPost(form,scope){
 const button=form.querySelector('[type=submit]'),error=form.querySelector('#news-publish-error');
 const payload={scope,title:form.elements.title.value.trim(),summary:form.elements.summary.value.trim(),body:form.elements.body.value.trim()};
 if(payload.title.length<2||payload.summary.length<2||payload.body.length<10){error.textContent='请填写完整的标题、摘要和正文。';return;}
 button.disabled=true;
 try{
  await platformRequest('news',{method:'POST',body:JSON.stringify(payload)});
  newsDraftScope='';notice='发布成功。';await loadNews();render();
 }catch(requestError){error.textContent=requestError.message;button.disabled=false;}
}
async function uploadNewsImage(file){
 if(!file)return;
 const status=document.querySelector('#news-image-status'),textarea=document.querySelector('#news-body'),button=document.querySelector('#news-image-upload');
 if(!status||!textarea||!button)return;
 if(!/^image\/(png|jpeg|webp|gif)$/.test(file.type)){status.textContent='仅支持 PNG、JPG、WebP 或 GIF 图片。';return;}
 if(file.size>8*1024*1024){status.textContent='图片不能超过 8 MB。';return;}
 button.disabled=true;status.textContent='正在上传图片…';
 try{
  const response=await fetch(`./api/news/assets?name=${encodeURIComponent(file.name)}`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/octet-stream'},body:file});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||`图片上传失败（${response.status}）。`);
  const alt=(file.name||'图片').replace(/\.[^.]+$/,''),markdown=`\n\n![${alt}](${data.asset.url})\n\n`;
  const start=textarea.selectionStart??textarea.value.length,end=textarea.selectionEnd??textarea.value.length;
  textarea.value=textarea.value.slice(0,start)+markdown+textarea.value.slice(end);
  textarea.focus();textarea.selectionStart=textarea.selectionEnd=start+markdown.length;
  status.textContent='图片已插入正文，可继续编辑或发布。';
 }catch(error){status.textContent=error.message;}
 finally{button.disabled=false;const input=document.querySelector('#news-image-file');if(input)input.value='';}
}
function articleUrl(raw){
 const value=String(raw).trim();
 if(/^https?:\/\/[^\s]+$/i.test(value))return value;
 if(/^(?:\.\/|\/)?api\/news\/assets\/[a-f0-9]{32}$/.test(value))return './'+value.replace(/^(?:\.\/|\/)/,'');
 if(/^(?:\.\/|\/)?assets\/news\/[\w\u4e00-\u9fff./%-]+$/.test(value)&&!value.includes('..'))return './'+value.replace(/^(?:\.\/|\/)/,'');
 return null;
}
function articleInline(raw){
 const pattern=/`([^`]+)`|!\[([^\]]*)\]\(([^\s)]+)\)|\[([^\]]+)\]\(([^\s)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
 let html='',last=0;
 for(const match of raw.matchAll(pattern)){
  html+=safe(raw.slice(last,match.index));last=match.index+match[0].length;
  if(match[1]!==undefined)html+=`<code>${safe(match[1])}</code>`;
  else if(match[2]!==undefined){const url=articleUrl(match[3]);html+=url?`<img src="${safe(url)}" alt="${safe(match[2])}" loading="lazy">`:safe(match[2]);}
  else if(match[4]!==undefined){const url=articleUrl(match[5]);html+=url?`<a href="${safe(url)}" target="_blank" rel="noopener noreferrer">${safe(match[4])}</a>`:safe(match[4]);}
  else if(match[6]!==undefined)html+=`<strong>${safe(match[6])}</strong>`;
  else html+=`<em>${safe(match[7])}</em>`;
 }
 return html+safe(raw.slice(last));
}
function articleMarkdown(raw){
 const lines=raw.replace(/\r\n/g,'\n').split('\n'),toc=[];let html='',paragraph=[],list=null,code=null,codeLines=[];
 const flush=()=>{if(paragraph.length){html+=`<p>${articleInline(paragraph.join(' '))}</p>`;paragraph=[];}if(list){html+=`</${list}>`;list=null;}};
 const finishCode=()=>{html+=`<pre><code${code?` class="language-${safe(code)}"`:''}>${safe(codeLines.join('\n'))}</code></pre>`;code=null;codeLines=[];};
 for(const line of lines){
  const fence=line.match(/^\s*```([\w+-]*)\s*$/);
  if(code!==null){if(fence)finishCode();else codeLines.push(line);continue;}
  if(fence){flush();code=fence[1];continue;}
  if(!line.trim()){flush();continue;}
  const heading=line.match(/^(#{1,6})\s+(.+)$/);
  if(heading){flush();const level=Math.max(2,heading[1].length),id='article-section-'+toc.length;toc.push({id,title:heading[2],level});html+=`<h${level} id="${id}">${articleInline(heading[2])}</h${level}>`;continue;}
  const item=line.match(/^\s*(?:([-*])|\d+\.)\s+(.+)$/);
  if(item){if(paragraph.length)flush();const tag=item[1]?'ul':'ol';if(list!==tag){flush();html+=`<${tag}>`;list=tag;}html+=`<li>${articleInline(item[2])}</li>`;continue;}
  if(line.startsWith('> ')){flush();html+=`<blockquote>${articleInline(line.slice(2))}</blockquote>`;continue;}
  if(/^\s*(?:---+|\*\*\*+)\s*$/.test(line)){flush();html+='<hr>';continue;}
  if(list)flush();paragraph.push(line);
 }
 flush();if(code!==null)finishCode();return {html,toc};
}
function openArticle(id,push=true){
 const article=visibleNews().find(a=>a.id===id);if(!article)return;
 articleId=id;view='article';companyTab='news';notice='';
 if(push)history.pushState(null,'','#article/'+encodeURIComponent(id));
 render();window.scrollTo({top:0,behavior:'instant'});
}
function returnToNews(push=true){
 companyTab='news';view=isAdmin()&&!companyId?'news':'company';
 if(push)history.pushState(null,'','#news');render();window.scrollTo({top:0,behavior:'instant'});
}
function routeArticleHash(){
 if(!currentUser)return;
 if(location.hash.startsWith('#article/')){
  let id;try{id=decodeURIComponent(location.hash.slice(9));}catch{return;}
  if(visibleNews().some(a=>a.id===id))openArticle(id,false);
  else {articleId=id;view='article';render();}
 }else if(location.hash==='#news'||view==='article')returnToNews(false);
}
function articlePage(){
 const rows=visibleNews(),article=rows.find(a=>a.id===articleId);
 if(!article)return heading('NEWS','文章不可用','文章不存在，或不属于当前公司。','<button class="secondary" id="back-news">返回新闻</button>');
 const rendered=articleMarkdown(article.body),index=rows.indexOf(article),previous=rows[index-1],next=rows[index+1];
 return `<div class="article-toolbar"><button class="text-button" id="back-news">← 返回新闻</button></div><div class="article-layout"><article class="blog-article"><header><div class="article-meta"><time datetime="${safe(article.date||'')}">${safe(article.date||'')}</time><span>${safe(article.author||'平台')}</span></div><h1>${safe(article.title)}</h1></header><div class="article-body">${rendered.html}</div><nav class="article-pagination" aria-label="其他文章">${previous?`<a href="#article/${encodeURIComponent(previous.id)}" data-article="${safe(previous.id)}"><small>上一篇</small>${safe(previous.title)}</a>`:'<span></span>'}${next?`<a href="#article/${encodeURIComponent(next.id)}" data-article="${safe(next.id)}"><small>下一篇</small>${safe(next.title)}</a>`:''}</nav>${isAdmin()&&article.source?`<p class="settings-note">源文件：${safe(article.source)}</p>`:''}</article>${rendered.toc.length?`<aside class="article-toc"><strong>目录</strong><nav aria-label="文章目录">${rendered.toc.map(h=>`<a href="#${h.id}" data-article-section="${h.id}" class="${h.level>2?'toc-sub':''}">${safe(h.title)}</a>`).join('')}</nav></aside>`:''}</div>`;
}
function bindNews(){
 document.querySelectorAll('.news-cover img').forEach(img=>{img.onerror=()=>{img.hidden=true;};});
 document.querySelectorAll('[data-article]').forEach(a=>a.onclick=event=>{event.preventDefault();openArticle(a.dataset.article);});
 const back=document.querySelector('#back-news');if(back)back.onclick=()=>returnToNews();
 const retry=document.querySelector('#reload-news');if(retry)retry.onclick=refreshNews;
 document.querySelectorAll('[data-news-publish]').forEach(button=>button.onclick=()=>{newsDraftScope=button.dataset.newsPublish;render();document.querySelector('#news-publish-form')?.scrollIntoView({block:'center'});});
 const cancel=document.querySelector('[data-news-cancel]');if(cancel)cancel.onclick=()=>{newsDraftScope='';render();};
 const imageButton=document.querySelector('#news-image-upload'),imageFile=document.querySelector('#news-image-file');
 if(imageButton&&imageFile){imageButton.onclick=()=>imageFile.click();imageFile.onchange=()=>uploadNewsImage(imageFile.files[0]);}
 const form=document.querySelector('#news-publish-form');
 if(form)form.onsubmit=event=>{event.preventDefault();submitNewsPost(form,newsDraftScope||'platform');};
 document.querySelectorAll('[data-article-section]').forEach(a=>a.onclick=event=>{event.preventDefault();document.getElementById(a.dataset.articleSection)?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});});
}
