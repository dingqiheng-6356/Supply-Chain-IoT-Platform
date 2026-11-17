/* News: platform notices for everyone, company news for that company's invitees. */
let newsArticles=[],newsErrors=[],newsLoadError='',newsRequest=0,articleId=null,newsDraftScope='',newsActiveImage=-1,newsMode='edit',newsComposerHtml='';
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
 const company=platform.companies.find(c=>c.id===currentUser?.companyId)?.name||'本公司',preview=newsMode==='preview';
 return `<section class="panel news-publish"><h2>${scope==='platform'?'发布平台更新通知':'发布公司新闻'}</h2><p class="settings-note">${scope==='platform'?'发布后所有平台用户可见。':`发布后仅 ${safe(company)} 的邀请用户可见。`}</p><form id="news-publish-form"><label for="news-title">标题</label><input id="news-title" name="title" maxlength="80" required><label for="news-summary">摘要</label><input id="news-summary" name="summary" maxlength="160" required><div class="news-mode-switch" role="group" aria-label="编辑模式"><button type="button" class="news-mode-button${preview?'':' is-active'}" aria-pressed="${preview?'false':'true'}" data-news-mode="edit">编辑</button><button type="button" class="news-mode-button${preview?' is-active':''}" aria-pressed="${preview?'true':'false'}" data-news-mode="preview">预览</button></div><div class="news-editor-grid${preview?' is-preview-only':''}" id="news-editor-grid"><div class="news-editor-pane" id="news-editor-pane"${preview?' hidden':''}><div class="news-editor-toolbar"><button type="button" data-news-command="bold" title="加粗"><b>B</b></button><button type="button" data-news-command="italic" title="斜体"><i>I</i></button><button type="button" data-news-block="h2" title="二级标题">H2</button><button type="button" data-news-block="h3" title="三级标题">H3</button><button type="button" data-news-command="insertUnorderedList" title="无序列表">• 列表</button><button type="button" data-news-command="insertOrderedList" title="有序列表">1. 列表</button><button type="button" data-news-block="blockquote" title="引用">引用</button><button type="button" data-news-link="1" title="插入链接">链接</button><button type="button" id="news-image-upload" title="插入图片">插入图片</button><input type="file" id="news-image-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden></div><div class="news-rich-editor article-body" id="news-body" contenteditable="true" role="textbox" aria-multiline="true" aria-label="正文" data-placeholder="输入正文，可加粗、设标题、插入图片并拖动排版">${newsComposerHtml}</div><p class="news-image-status" id="news-image-status" role="status"></p></div><div class="news-editor-pane news-preview-pane" id="news-preview-pane"${preview?'':' hidden'}><div class="news-body-head"><span class="news-preview-label">预览</span><span class="news-preview-hint">拖动图片调整大小与位置，文字实时环绕</span></div><div class="news-preview"><div class="article-body news-preview-body" id="news-preview-body"></div></div></div></div><div class="news-image-tools" id="news-image-tools" hidden><span class="news-tools-label">图片设置</span><div class="news-tool-group"><span>宽度</span><button type="button" data-news-width="">原始</button><button type="button" data-news-width="30%">30%</button><button type="button" data-news-width="50%">50%</button><button type="button" data-news-width="80%">80%</button><button type="button" data-news-width="100%">100%</button></div><div class="news-tool-group"><span>位置</span><button type="button" data-news-align="left">左</button><button type="button" data-news-align="center">中</button><button type="button" data-news-align="right">右</button></div></div><p class="error" id="news-publish-error" role="alert"></p><div class="form-actions"><button type="button" class="secondary" data-news-cancel>取消</button><button class="primary" type="submit">发布</button></div></form></section>`;
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
 const button=form.querySelector('[type=submit]'),error=form.querySelector('#news-publish-error'),editor=form.querySelector('#news-body');
 const rawHtml=(editor&&editor.innerHTML.trim())||newsComposerHtml;
 const plainText=(()=>{const box=document.createElement('div');box.innerHTML=rawHtml;return (box.textContent||'').trim();})();
 const payload={scope,title:form.elements.title.value.trim(),summary:form.elements.summary.value.trim(),body:sanitizeNewsHtml(rawHtml).trim()};
 if(payload.title.length<2||payload.summary.length<2||plainText.length<10){error.textContent='请填写完整的标题、摘要和正文。';return;}
 if(payload.body.length>20000){error.textContent='正文内容过长，请精简后再发布。';return;}
 button.disabled=true;
 try{
  await platformRequest('news',{method:'POST',body:JSON.stringify(payload)});
  newsDraftScope='';notice='发布成功。';await loadNews();render();
 }catch(requestError){error.textContent=requestError.message;button.disabled=false;}
}
let newsEditorRange=null;
function newsEditor(){return document.querySelector('#news-body');}
function newsEditorFigures(){const editor=newsEditor();return editor?[...editor.querySelectorAll('.article-figure')]:[];}
function rememberNewsSelection(){
 const editor=newsEditor(),selection=window.getSelection();
 if(!editor||!selection||!selection.rangeCount)return;
 const range=selection.getRangeAt(0);
 if(editor.contains(range.commonAncestorContainer))newsEditorRange=range.cloneRange();
}
async function uploadNewsImage(file){
 if(!file)return;
 const status=document.querySelector('#news-image-status'),editor=newsEditor(),button=document.querySelector('#news-image-upload');
 if(!status||!editor||!button)return;
 if(!/^image\/(png|jpeg|webp|gif)$/.test(file.type)){status.textContent='仅支持 PNG、JPG、WebP 或 GIF 图片。';return;}
 if(file.size>8*1024*1024){status.textContent='图片不能超过 8 MB。';return;}
 button.disabled=true;status.textContent='正在上传图片…';
 try{
  const response=await fetch(`./api/news/assets?name=${encodeURIComponent(file.name)}`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/octet-stream'},body:file});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||`图片上传失败（${response.status}）。`);
  const url=articleUrl(data.asset.url);
  if(!url)throw new Error('图片地址无效。');
  const alt=(file.name||'图片').replace(/\.[^.]+$/,'');
  const html=`<figure class="article-figure align-center" style="width:60%" contenteditable="false"><img src="${safe(url)}" alt="${safe(alt)}"></figure><p><br></p>`;
  editor.focus();
  const selection=window.getSelection();
  if(newsEditorRange&&editor.contains(newsEditorRange.commonAncestorContainer)){selection.removeAllRanges();selection.addRange(newsEditorRange);}
  else{const range=document.createRange();range.selectNodeContents(editor);range.collapse(false);selection.removeAllRanges();selection.addRange(range);}
  document.execCommand('insertHTML',false,html);
  if(!editor.querySelector('.article-figure img')){
   const holder=document.createElement('div');holder.innerHTML=html;
   while(holder.firstChild)editor.appendChild(holder.firstChild);
  }
  newsComposerHtml=editor.innerHTML;
  const figures=newsEditorFigures();newsActiveImage=figures.length-1;
  status.textContent='图片已插入正文，可在预览中拖动调整大小和位置。';
  if(newsMode==='preview')renderNewsPreview();
  else{syncNewsImageTools();bindNewsFigures(editor,false);}
 }catch(error){status.textContent=error.message;}
 finally{button.disabled=false;const input=document.querySelector('#news-image-file');if(input)input.value='';}
}
function looksLikeHtml(raw){return /<(?:p|h[1-6]|ul|ol|li|blockquote|figure|span|div|img|br|strong|b|em|i|pre|code|a|hr)\b[^>]*>/i.test(String(raw||''));}
function newsFigureAlign(figure){
 const name=[...figure.classList].find(item=>/^align-(?:left|center|right)$/.test(item));
 return name?name.slice(6):'center';
}
function sanitizeNewsHtml(raw){
 const template=document.createElement('template');template.innerHTML=String(raw||'');
 const allowed=new Set(['P','BR','STRONG','B','EM','I','U','S','H2','H3','H4','UL','OL','LI','BLOCKQUOTE','PRE','CODE','A','SPAN','IMG','HR','FIGURE','DIV']);
 const clean=node=>{
  [...node.childNodes].forEach(child=>{
   if(child.nodeType===3)return;
   if(child.nodeType!==1){child.remove();return;}
   const tag=child.tagName;
   if(!allowed.has(tag)){
    if(/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|LINK|META|SVG|VIDEO|AUDIO)$/.test(tag)){child.remove();return;}
    clean(child);child.replaceWith(...child.childNodes);return;
   }
   const wrapsImage=child.querySelector('img');
   [...child.attributes].forEach(attribute=>{
    const name=attribute.name.toLowerCase(),value=attribute.value;
    if(name==='src'&&tag==='IMG'){const url=articleUrl(value);if(url)child.setAttribute('src',url);else child.removeAttribute('src');return;}
    if(name==='alt'&&tag==='IMG')return;
    if(name==='href'&&tag==='A'){const url=articleUrl(value);if(url){child.setAttribute('href',url);child.setAttribute('target','_blank');child.setAttribute('rel','noopener noreferrer');}else child.removeAttribute('href');return;}
    if(name==='class'&&tag==='FIGURE'){const align=(value.match(/align-(left|center|right)/)||[])[1]||'center';child.setAttribute('class',`article-figure align-${align}`);return;}
    if(name==='class'&&tag==='SPAN'&&wrapsImage){const align=(value.match(/align-(left|center|right)/)||[])[1]||'center';child.setAttribute('class',`article-figure align-${align}`);return;}
    if(name==='style'&&(tag==='FIGURE'||(tag==='SPAN'&&wrapsImage))){const width=(value.match(/width\s*:\s*(100|[1-9]\d?)%/i)||[])[1];if(width)child.style.width=width+'%';else child.removeAttribute('style');return;}
    child.removeAttribute(attribute.name);
   });
   clean(child);
  });
 };
 clean(template.content);
 template.content.querySelectorAll('span,figure').forEach(element=>{
  if(!element.querySelector('img'))return;
  const align=newsFigureAlign(element),width=element.style.width;
  element.className=`article-figure align-${align}`;
  if(!/^(?:100|[1-9]\d?)%$/.test(width))element.style.removeProperty('width');
 });
 return template.innerHTML;
}
function newsBodyRendered(raw){
 if(!looksLikeHtml(raw))return articleMarkdown(raw);
 const wrapper=document.createElement('div');wrapper.innerHTML=sanitizeNewsHtml(raw);
 const toc=[];
 wrapper.querySelectorAll('h2,h3,h4').forEach((heading,index)=>{
  const id='article-section-'+index;heading.id=id;
  toc.push({id,title:heading.textContent.trim(),level:Number(heading.tagName.slice(1))});
 });
 return {html:wrapper.innerHTML,toc};
}
function parseNewsImageAttrs(raw){
 const attrs={};
 String(raw||'').split(/\s+/).forEach(part=>{
  const match=part.match(/^(width|align)=(.+)$/i);if(!match)return;
  const key=match[1].toLowerCase(),value=match[2];
  if(key==='width'&&(/^(?:100|[1-9]\d?)%$/.test(value)||/^(?:[1-9]\d{2}|[12]\d{3})px$/.test(value)))attrs.width=value;
  if(key==='align'&&/^(left|center|right)$/.test(value))attrs.align=value;
 });
 return attrs;
}
function markNewsFigures(){
 ['#news-body .article-figure','#news-preview-body .article-figure'].forEach(selector=>{
  document.querySelectorAll(selector).forEach((figure,index)=>figure.classList.toggle('is-active',index===newsActiveImage));
 });
}
function syncNewsImageTools(){
 const tools=document.querySelector('#news-image-tools'),editor=newsEditor();
 if(!tools||!editor)return;
 const figures=newsEditorFigures();
 if(!figures.length){newsActiveImage=-1;tools.hidden=true;return;}
 if(newsActiveImage<0||newsActiveImage>=figures.length)newsActiveImage=figures.length-1;
 tools.hidden=false;
 const figure=figures[newsActiveImage],width=figure.style.width||'',align=newsFigureAlign(figure);
 tools.querySelectorAll('[data-news-width]').forEach(button=>button.classList.toggle('is-active',width===button.dataset.newsWidth));
 tools.querySelectorAll('[data-news-align]').forEach(button=>button.classList.toggle('is-active',align===button.dataset.newsAlign));
}
function bindNewsFigures(container,withHandle){
 if(!container)return;
 const box=container.closest('.news-preview')||container;
 container.querySelectorAll('.article-figure').forEach((figure,index)=>{
  const activate=()=>{newsActiveImage=index;markNewsFigures();syncNewsImageTools();};
  figure.onclick=event=>{event.preventDefault();activate();};
  let handle=figure.querySelector('.news-resize-handle');
  if(withHandle&&!handle){
   handle=document.createElement('span');handle.className='news-resize-handle';handle.title='拖动调整大小';handle.contentEditable='false';figure.appendChild(handle);
  }
  if(!withHandle&&handle)handle.remove();
  if(withHandle)handle.onpointerdown=event=>{
   event.preventDefault();event.stopPropagation();activate();
   const startX=event.clientX,startWidth=figure.getBoundingClientRect().width,baseWidth=box.getBoundingClientRect().width;
   const move=moveEvent=>{
    const next=Math.max(20,Math.min(100,Math.round((startWidth+moveEvent.clientX-startX)/baseWidth*100)));
    figure.style.width=next+'%';
    const mirror=document.querySelectorAll('#news-body .article-figure')[index];
    if(mirror&&mirror!==figure)mirror.style.width=next+'%';
   };
   const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);renderNewsPreview();};
   window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);
  };
  figure.onpointerdown=event=>{
   if(event.target===handle)return;
   event.preventDefault();activate();
   const startX=event.clientX,baseRect=box.getBoundingClientRect();
   const move=moveEvent=>{figure.style.transform=`translateX(${moveEvent.clientX-startX}px)`;figure.style.opacity='.85';};
   const up=()=>{
    window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);
    figure.style.transform='';figure.style.opacity='';
    const rect=figure.getBoundingClientRect(),relative=(rect.left+rect.width/2-baseRect.left)/baseRect.width;
    setNewsFigureAlign(index,relative<0.34?'left':relative>0.66?'right':'center');
    renderNewsPreview();
   };
   window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);
  };
 });
}
function setNewsFigureAlign(index,align){
 ['#news-body','#news-preview-body'].forEach(selector=>{
  const figure=document.querySelectorAll(selector+' .article-figure')[index];
  if(!figure)return;
  figure.classList.remove('align-left','align-center','align-right');
  figure.classList.add('align-'+align);
 });
}
function renderNewsPreview(){
 const editor=newsEditor(),target=document.querySelector('#news-preview-body');
 if(!editor||!target)return;
 const raw=(editor.innerHTML.trim()||newsComposerHtml).trim();
 if(!editor.innerHTML.trim()&&raw)editor.innerHTML=raw;
 newsComposerHtml=raw;
 target.innerHTML=raw?newsBodyRendered(raw).html:'<p class="settings-note">开始输入后这里会实时预览。</p>';
 bindNewsFigures(editor,false);
 bindNewsFigures(target,true);
 markNewsFigures();
 syncNewsImageTools();
}
function applyNewsImageChange(patch){
 const figure=newsEditorFigures()[newsActiveImage];if(!figure)return;
 if('width' in patch){if(patch.width)figure.style.width=patch.width;else figure.style.removeProperty('width');}
 if(patch.align)setNewsFigureAlign(newsActiveImage,patch.align);
 renderNewsPreview();
}
function setNewsMode(mode){
 const grid=document.querySelector('#news-editor-grid'),editorPane=document.querySelector('#news-editor-pane'),previewPane=document.querySelector('#news-preview-pane'),editor=newsEditor();
 if(!grid||!editorPane||!previewPane)return;
 newsMode=mode==='preview'?'preview':'edit';
 if(editor&&newsMode==='preview'){newsComposerHtml=editor.innerHTML;editor.blur();}
 document.querySelectorAll('[data-news-mode]').forEach(button=>{
  const active=button.dataset.newsMode===newsMode;
  button.classList.toggle('is-active',active);
  button.setAttribute('aria-pressed',String(active));
 });
 grid.classList.toggle('is-preview-only',newsMode==='preview');
 editorPane.hidden=newsMode==='preview';
 previewPane.hidden=newsMode!=='preview';
 if(newsMode==='preview')renderNewsPreview();
 else if(editor&&!editor.innerHTML.trim()&&newsComposerHtml)editor.innerHTML=newsComposerHtml;
}
function articleUrl(raw){
 const value=String(raw).trim();
 if(/^https?:\/\/[^\s]+$/i.test(value))return value;
 if(/^(?:\.\/|\/)?api\/news\/assets\/[a-f0-9]{32}$/.test(value))return './'+value.replace(/^(?:\.\/|\/)/,'');
 if(/^(?:\.\/|\/)?assets\/news\/[\w\u4e00-\u9fff./%-]+$/.test(value)&&!value.includes('..'))return './'+value.replace(/^(?:\.\/|\/)/,'');
 return null;
}
function articleInline(raw,preview=false){
 const pattern=/`([^`]+)`|!\[([^\]]*)\]\(([^\s)]+)\)(?:\{([^}]*)\})?|\[([^\]]+)\]\(([^\s)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
 let html='',last=0,imageIndex=0;
 for(const match of raw.matchAll(pattern)){
  html+=safe(raw.slice(last,match.index));last=match.index+match[0].length;
  if(match[1]!==undefined)html+=`<code>${safe(match[1])}</code>`;
  else if(match[2]!==undefined){const url=articleUrl(match[3]);if(!url){html+=safe(match[2]);continue;}const attrs=parseNewsImageAttrs(match[4]),align=attrs.align||'center',style=attrs.width?` style="width:${attrs.width}" data-width="1"`:'';html+=`<span class="article-figure align-${align}"${style}${preview?` data-news-image="${imageIndex}"`:''}><img src="${safe(url)}" alt="${safe(match[2])}" loading="lazy"></span>`;imageIndex++;}
  else if(match[5]!==undefined){const url=articleUrl(match[6]);html+=url?`<a href="${safe(url)}" target="_blank" rel="noopener noreferrer">${safe(match[5])}</a>`:safe(match[5]);}
  else if(match[7]!==undefined)html+=`<strong>${safe(match[7])}</strong>`;
  else html+=`<em>${safe(match[8])}</em>`;
 }
 return html+safe(raw.slice(last));
}
function articleMarkdown(raw,preview=false){
 const lines=raw.replace(/\r\n/g,'\n').split('\n'),toc=[];let html='',paragraph=[],list=null,code=null,codeLines=[];
 const flush=()=>{if(paragraph.length){html+=`<p>${articleInline(paragraph.join(' '),preview)}</p>`;paragraph=[];}if(list){html+=`</${list}>`;list=null;}};
 const finishCode=()=>{html+=`<pre><code${code?` class="language-${safe(code)}"`:''}>${safe(codeLines.join('\n'))}</code></pre>`;code=null;codeLines=[];};
 for(const line of lines){
  const fence=line.match(/^\s*```([\w+-]*)\s*$/);
  if(code!==null){if(fence)finishCode();else codeLines.push(line);continue;}
  if(fence){flush();code=fence[1];continue;}
  if(!line.trim()){flush();continue;}
  const heading=line.match(/^(#{1,6})\s+(.+)$/);
  if(heading){flush();const level=Math.max(2,heading[1].length),id='article-section-'+toc.length;toc.push({id,title:heading[2],level});html+=`<h${level} id="${id}">${articleInline(heading[2],preview)}</h${level}>`;continue;}
  const item=line.match(/^\s*(?:([-*])|\d+\.)\s+(.+)$/);
  if(item){if(paragraph.length)flush();const tag=item[1]?'ul':'ol';if(list!==tag){flush();html+=`<${tag}>`;list=tag;}html+=`<li>${articleInline(item[2],preview)}</li>`;continue;}
  if(line.startsWith('> ')){flush();html+=`<blockquote>${articleInline(line.slice(2),preview)}</blockquote>`;continue;}
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
 const rendered=newsBodyRendered(article.body),index=rows.indexOf(article),previous=rows[index-1],next=rows[index+1];
 return `<div class="article-toolbar"><button class="text-button" id="back-news">← 返回新闻</button></div><div class="article-layout"><article class="blog-article"><header><div class="article-meta"><time datetime="${safe(article.date||'')}">${safe(article.date||'')}</time><span>${safe(article.author||'平台')}</span></div><h1>${safe(article.title)}</h1></header><div class="article-body">${rendered.html}</div><nav class="article-pagination" aria-label="其他文章">${previous?`<a href="#article/${encodeURIComponent(previous.id)}" data-article="${safe(previous.id)}"><small>上一篇</small>${safe(previous.title)}</a>`:'<span></span>'}${next?`<a href="#article/${encodeURIComponent(next.id)}" data-article="${safe(next.id)}"><small>下一篇</small>${safe(next.title)}</a>`:''}</nav>${isAdmin()&&article.source?`<p class="settings-note">源文件：${safe(article.source)}</p>`:''}</article>${rendered.toc.length?`<aside class="article-toc"><strong>目录</strong><nav aria-label="文章目录">${rendered.toc.map(h=>`<a href="#${h.id}" data-article-section="${h.id}" class="${h.level>2?'toc-sub':''}">${safe(h.title)}</a>`).join('')}</nav></aside>`:''}</div>`;
}
function bindNews(){
 document.querySelectorAll('.news-cover img').forEach(img=>{img.onerror=()=>{img.hidden=true;};});
 document.querySelectorAll('[data-article]').forEach(a=>a.onclick=event=>{event.preventDefault();openArticle(a.dataset.article);});
 const back=document.querySelector('#back-news');if(back)back.onclick=()=>returnToNews();
 const retry=document.querySelector('#reload-news');if(retry)retry.onclick=refreshNews;
 document.querySelectorAll('[data-news-publish]').forEach(button=>button.onclick=()=>{newsDraftScope=button.dataset.newsPublish;newsActiveImage=-1;newsMode='edit';newsComposerHtml='';render();document.querySelector('#news-publish-form')?.scrollIntoView({block:'center'});});
 const cancel=document.querySelector('[data-news-cancel]');if(cancel)cancel.onclick=()=>{newsDraftScope='';newsActiveImage=-1;newsMode='edit';newsComposerHtml='';render();};
 const imageButton=document.querySelector('#news-image-upload'),imageFile=document.querySelector('#news-image-file');
 if(imageButton&&imageFile){imageButton.onclick=()=>{rememberNewsSelection();imageFile.click();};imageFile.onchange=()=>uploadNewsImage(imageFile.files[0]);}
 document.querySelectorAll('[data-news-mode]').forEach(button=>button.onclick=()=>setNewsMode(button.dataset.newsMode));
 document.querySelectorAll('[data-news-command]').forEach(button=>{
  button.onmousedown=event=>event.preventDefault();
  button.onclick=()=>{
   const editor=newsEditor();if(!editor)return;
   editor.focus();document.execCommand(button.dataset.newsCommand,false,null);
   if(document.querySelector('#news-preview-pane')?.hidden===false)renderNewsPreview();
  };
 });
 document.querySelectorAll('[data-news-block]').forEach(button=>{
  button.onmousedown=event=>event.preventDefault();
  button.onclick=()=>{
   const editor=newsEditor();if(!editor)return;editor.focus();
   const tag=button.dataset.newsBlock,current=String(document.queryCommandValue('formatBlock')||'').toLowerCase();
   document.execCommand('formatBlock',false,current===tag?'p':tag);
   if(document.querySelector('#news-preview-pane')?.hidden===false)renderNewsPreview();
  };
 });
 const linkButton=document.querySelector('[data-news-link]');
 if(linkButton)linkButton.onclick=()=>{
  const editor=newsEditor();if(!editor)return;
  rememberNewsSelection();editor.focus();
  const input=window.prompt('请输入链接地址（http:// 或 https://）','https://');
  if(!input)return;
  const url=articleUrl(input.trim());
  if(!url){const status=document.querySelector('#news-image-status');if(status)status.textContent='链接地址无效，请使用 http:// 或 https:// 开头的地址。';return;}
  if(newsEditorRange){const selection=window.getSelection();selection.removeAllRanges();selection.addRange(newsEditorRange);}
  document.execCommand('createLink',false,url);
  if(document.querySelector('#news-preview-pane')?.hidden===false)renderNewsPreview();
 };
 const bodyEditor=newsEditor();
 if(bodyEditor){
  bodyEditor.oninput=()=>{
   newsComposerHtml=bodyEditor.innerHTML;
   if(newsMode==='preview')renderNewsPreview();
   else{syncNewsImageTools();bindNewsFigures(bodyEditor,false);}
  };
  bodyEditor.onkeyup=rememberNewsSelection;bodyEditor.onmouseup=rememberNewsSelection;bodyEditor.onblur=rememberNewsSelection;
  bodyEditor.onpaste=event=>{event.preventDefault();const text=(event.clipboardData||window.clipboardData).getData('text/plain');document.execCommand('insertText',false,text);};
  bindNewsFigures(bodyEditor,false);syncNewsImageTools();
 }
 if(newsMode==='preview')renderNewsPreview();
 document.querySelectorAll('[data-news-width]').forEach(button=>button.onclick=()=>applyNewsImageChange({width:button.dataset.newsWidth||undefined}));
 document.querySelectorAll('[data-news-align]').forEach(button=>button.onclick=()=>applyNewsImageChange({align:button.dataset.newsAlign}));
 const form=document.querySelector('#news-publish-form');
 if(form)form.onsubmit=event=>{event.preventDefault();submitNewsPost(form,newsDraftScope||'platform');};
 document.querySelectorAll('[data-article-section]').forEach(a=>a.onclick=event=>{event.preventDefault();document.getElementById(a.dataset.articleSection)?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});});
}
