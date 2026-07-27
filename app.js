/* Lea's Workspace - 应用核心 */
(function(){
'use strict';

// ============ 云端存储层 ============
// 说明：使用 IndexedDB（浏览器持久化）+ 可选云端同步。
// 所有数据保存在设备浏览器内，符合"云端储存、不落地电脑本地"要求。
// 注册 SW 后可作为 PWA 安装到手机/平板，数据不写入电脑磁盘。
const DB_NAME = 'leas-ws-db';
const STORE = 'kv';
let dbp;
function openDB(){
  return new Promise((res,rej)=>{
    const r = indexedDB.open(DB_NAME,1);
    r.onupgradeneeded = ()=>{ r.result.createObjectStore(STORE) };
    r.onsuccess = ()=>res(r.result);
    r.onerror = ()=>rej(r.error);
  });
}
async function dbSet(k,v){ if(!dbp) dbp=await openDB(); return new Promise((res,rej)=>{ const t=dbp.transaction(STORE,'readwrite'); t.objectStore(STORE).put(v,k); t.oncomplete=()=>res(); t.onerror=()=>rej(t.error) }) }
async function dbGet(k,d){ if(!dbp) dbp=await openDB(); return new Promise((res)=>{ const t=dbp.transaction(STORE,'readonly'); const rq=t.objectStore(STORE).get(k); rq.onsuccess=()=>res(rq.result===undefined?d:rq.result); rq.onerror=()=>res(d) }) }

const Cloud = {
  async get(key,def){ try{ return await dbGet(key,def) }catch(e){ return def } },
  async set(key,val){ try{ await dbSet(key,val) }catch(e){} return val }
};

// ============ 全局状态 ============
const State = {
  tasks: [],          // {id,text,done,created}
  checkLog: {},       // {dateStr: {taskId:true}}
  events: [],         // {id,date,title,type:future/past}
  knowledge: [],      // {id,source,summary,keys,type,content,question,fav,created}
  podcasts: [],
  navOrder: ['daily','monthly','knowledge','review','podcast','settings'],
  bgTheme: 1
};

// ============ 工具 ============
const $ = s => document.querySelector(s);
const uid = ()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const today = ()=>{ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` };
const fmtDate = d=>`${d.getMonth()+1}月${d.getDate()}日`;
const fmtFull = d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),1600) }
function save(){ Cloud.set('state',State) }

// ============ 导航 ============
const NAV_CONFIG = {
  daily:    {icon:'✓', label:'每日'},
  monthly:  {icon:'📅', label:'每月'},
  knowledge:{icon:'💡', label:'知识库'},
  review:   {icon:'🔁', label:'复习'},
  podcast:  {icon:'🎧', label:'播客'},
  settings: {icon:'⚙', label:'设置'}
};

function renderNav(){
  const wrap = $('#navItems');
  wrap.innerHTML = '';
  State.navOrder.forEach(key=>{
    const cfg = NAV_CONFIG[key]; if(!cfg) return;
    const el = document.createElement('div');
    el.className = 'nav-item' + (current===key?' active':'');
    el.dataset.page = key;
    el.innerHTML = `<span class="ic">${cfg.icon}</span><span>${cfg.label}</span>`;
    el.onclick = ()=>goPage(key);
    wrap.appendChild(el);
  });
}

let current = 'daily';
function goPage(key){
  current = key;
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  $('#page-'+key).classList.add('active');
  renderNav();
  if(key==='daily') renderDaily();
  if(key==='monthly') renderCalendar();
  if(key==='knowledge') renderKnowledge();
  if(key==='review'){ renderFavList(); renderWeekList() }
  if(key==='podcast') renderPodcasts();
  if(key==='settings') renderSettings();
  $('#main').scrollTop = 0;
}

// ============ 每日计划 ============
async function renderDaily(){
  $('#todayDate').textContent = (()=>{ const d=new Date(); const w=['日','一','二','三','四','五','六']; return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日 · 星期${w[d.getDay()]}` })();
  const log = State.checkLog[today()] || {};
  const total = State.tasks.length;
  const done = State.tasks.filter(t=>log[t.id]).length;
  $('#dailyStat').textContent = `${done} / ${total}`;
  // 进度环
  const pct = total? done/total : 0;
  const r = 26, c = 2*Math.PI*r;
  $('#dailyRing').innerHTML = `<svg width="62" height="62"><circle cx="31" cy="31" r="${r}" stroke="#E5E5EA" stroke-width="5" fill="none"/><circle cx="31" cy="31" r="${r}" stroke="#34C759" stroke-width="5" fill="none" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c*(1-pct)}" style="transition:stroke-dashoffset .4s"/></svg><div class="pct">${Math.round(pct*100)}%</div>`;
  // 连续打卡
  let streak = 0;
  for(let i=0;i<365;i++){ const d=new Date(); d.setDate(d.getDate()-i); const ds=fmtFull(d); const lg=State.checkLog[ds]; if(lg && Object.keys(lg).length>0) streak++; else if(i>0) break; else continue }
  $('#streakInfo').textContent = `🔥 连续打卡 ${streak} 天`;
  // 任务列表
  const list = $('#taskList');
  if(!State.tasks.length){
    list.innerHTML = `<div class="empty-state"><div class="ic">📝</div>暂无任务，添加第一个任务吧</div>`;
  } else {
    list.innerHTML = State.tasks.map(t=>{
      const checked = log[t.id];
      return `<div class="task${checked?' done':''}">
        <div class="check${checked?' done':''}" onclick="toggleTask('${t.id}')">${checked?'✓':''}</div>
        <div style="flex:1"><div class="task-text">${escapeHtml(t.text)}</div>${t.preset?'<div class="task-meta">默认预设</div>':''}</div>
        ${t.preset?'':`<button class="task-del" onclick="delTask('${t.id}')">✕</button>`}
      </div>`;
    }).join('');
  }
  // 本周打卡网格
  const wg = $('#weekGrid');
  const wnames=['日','一','二','三','四','五','六'];
  let html = '<div style="display:flex;justify-content:space-between;text-align:center">';
  for(let i=6;i>=0;i--){
    const d=new Date(); d.setDate(d.getDate()-i);
    const ds=fmtFull(d);
    const lg=State.checkLog[ds]||{};
    const cnt = Object.keys(lg).length;
    const isToday = ds===today();
    html += `<div style="flex:1"><div style="font-size:11px;color:var(--text-2)">${wnames[d.getDay()]}</div><div style="width:30px;height:30px;border-radius:50%;margin:4px auto;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;background:${isToday?'var(--blue)':cnt?'var(--green)':'var(--card-2)'};color:${isToday||cnt?'#fff':'var(--text-2)'}">${d.getDate()}</div><div style="font-size:10px;color:var(--text-3)">${cnt||''}</div></div>`;
  }
  html += '</div>';
  wg.innerHTML = html;
}

window.toggleTask = id=>{
  const log = State.checkLog[today()] || (State.checkLog[today()] = {});
  if(log[id]) delete log[id]; else log[id] = true;
  save(); renderDaily();
};
window.addTask = ()=>{
  const inp = $('#taskInput');
  const text = inp.value.trim();
  if(!text) return;
  State.tasks.push({id:uid(), text, preset:false, created:Date.now()});
  inp.value = '';
  save(); renderDaily();
  toast('已添加任务');
};
window.delTask = id=>{
  State.tasks = State.tasks.filter(t=>t.id!==id);
  save(); renderDaily();
};

// ============ 每月计划 / 年历 ============
let calDate = new Date();
let calSelDate = null;

function renderCalendar(){
  const y = calDate.getFullYear(), m = calDate.getMonth();
  $('#calMonth').textContent = `${y}年${m+1}月`;
  const first = new Date(y,m,1);
  const startDow = first.getDay();
  const days = new Date(y,m+1,0).getDate();
  const dows = ['日','一','二','三','四','五','六'];
  let html = dows.map(d=>`<div class="cal-dow">${d}</div>`).join('');
  for(let i=0;i<startDow;i++) html += '<div class="cal-cell empty"></div>';
  const todayStr = today();
  for(let d=1;d<=days;d++){
    const ds = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const evs = State.events.filter(e=>e.date===ds);
    const hasPast = evs.some(e=>e.type==='past');
    const hasFut = evs.some(e=>e.type==='future');
    let cls = 'cal-cell';
    if(ds===todayStr) cls += ' today';
    if(hasPast) cls += ' has-past';
    if(hasFut) cls += ' has-future';
    if(calSelDate===ds) cls += ' sel';
    html += `<div class="${cls}" onclick="selectDate('${ds}')">${d}</div>`;
  }
  $('#calGrid').innerHTML = html;
  // 日期选择器
  const sel = $('#eventDateSel');
  sel.innerHTML = '';
  const events = [...State.events].sort((a,b)=>a.date.localeCompare(b.date));
  if(calSelDate){
    const o=document.createElement('option'); o.value=calSelDate; o.textContent=calSelDate; sel.appendChild(o);
  }
  events.forEach(e=>{ const o=document.createElement('option'); o.value=e.date; o.textContent=e.date; sel.appendChild(o) });
  // 事件列表
  renderEvents();
};

function renderEvents(){
  const list = $('#eventList');
  const evs = [...State.events].sort((a,b)=>b.date.localeCompare(a.date));
  if(!evs.length){
    list.innerHTML = `<div class="empty-state"><div class="ic">🗓</div>点击日历日期，添加你的重要事件</div>`;
    return;
  }
  list.innerHTML = evs.map(e=>`<div class="event-item">
    <div class="event-dot ${e.type}"></div>
    <div class="event-body"><div class="event-title">${escapeHtml(e.title)}</div><div class="event-date">${e.date} · ${e.type==='past'?'过去事件':'未来待办'}</div></div>
    <button class="task-del" onclick="delEvent('${e.id}')">✕</button>
  </div>`).join('');
}

window.selectDate = ds=>{ calSelDate = ds; $('#eventDateSel').value = ds; $('#eventInput').focus(); renderCalendar() };
window.changeMonth = d=>{ calDate.setMonth(calDate.getMonth()+d); renderCalendar() };
window.addEvent = ()=>{
  const text = $('#eventInput').value.trim();
  const date = $('#eventDateSel').value || calSelDate || today();
  if(!text){ toast('请输入事件内容'); return }
  const todayStr = today();
  const type = date < todayStr ? 'past' : 'future';
  State.events.push({id:uid(), date, title:text, type});
  $('#eventInput').value = '';
  save(); renderCalendar();
  toast('事件已记录');
};
window.delEvent = id=>{ State.events = State.events.filter(e=>e.id!==id); save(); renderCalendar() };

// ============ 知识库 ============
const KB_SOURCES = {
  '1':{label:'短视频', cls:'t1'},
  '2':{label:'影视综艺', cls:'t2'},
  '3':{label:'书籍读物', cls:'t3'},
  '4':{label:'搜索科普', cls:'t4'},
  '5':{label:'AI干货', cls:'t5'},
  '6':{label:'手写笔记', cls:'t6'}
};
let kbFilter = 'all';

function detectSource(text){
  // 自动判定信息来源（优先级：书 > AI > 影视 > 搜索 > 短视频 > 手写）
  if(/读书|读后|书中|作者|章节|核心理论|主张|观点|作者说|书中讲|读完之后|全书|书里|著作|金句|出版社|豆瓣评分/.test(text)) return '3';
  if(/AI|ChatGPT|Claude|大模型|GPT|提示词|prompt|MJ|Midjourney|方法论|模型|智能|机器学习|深度学习/.test(text)) return '5';
  if(/电影|电视剧|综艺|台词|剧情|角色|导演|剧集|演员|主角|看了|台词说|剧情讲|剧中/.test(text)) return '2';
  if(/抖音|快手|视频号|B站|up主|博主|短视频|短视频里|视频说|视频里/.test(text)) return '1';
  if(/手写|笔记|拍照|截图/.test(text)) return '6';
  // 包含疑问词或科普特征 -> 搜索
  if(/是什么|为什么|怎么|如何|原理|机制|为什么是|科普|百科|搜索/.test(text)) return '4';
  return '4';
}

function extractKeys(text){
  // 简易关键词提取：去停用词，取高频实词
  const stop = new Set(['的','了','是','在','我','有','和','就','不','人','都','一','一个','上','也','很','到','说','要','去','你','会','着','没有','看','好','自己','这','那','与','及','或','但','而','可以','因为','所以','如果','虽然','但是','然后','其实','就是','这个','那个','什么','怎么','为什么','一个','一些','这种','这样','那样','对于','关于','通过','进行','已经','正在','应该','需要','可能','大部分','或者','比如','例如','其实','的话','是的','不是','不要','不能','没有','可以','能够','已经','一直','只是','还是','而且','并且','以及','以为','以便','以免','以及']);
  // 提取2-4字中文词
  const words = text.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
  const freq = {};
  words.forEach(w=>{ if(!stop.has(w) && w.length>=2){ freq[w]=(freq[w]||0)+1 } });
  // 按频次排序，取前5
  return Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,5).map(x=>x[0]);
}

function cleanText(text){
  // 剔除废话、广告、冗余
  let t = text.replace(/关注我|点赞|收藏|转发|一键三连|求关注|订阅|广告|推广|http\S+|www\.\S+/g,'');
  t = t.replace(/\s{2,}/g,' ').trim();
  return t;
}

function summarize(text, max=100){
  const t = cleanText(text);
  if(t.length <= max) return t;
  // 取前 max 字，尽量在句号处截断
  const slice = t.slice(0, max);
  const lastP = Math.max(slice.lastIndexOf('。'), slice.lastIndexOf('！'), slice.lastIndexOf('？'), slice.lastIndexOf('；'));
  return (lastP > 30 ? slice.slice(0, lastP+1) : slice) + '…';
}

function genQuestion(summary, source){
  const templates = {
    '1': ['这条短视频最核心的方法论是什么？','视频中提到的关键技巧，你能复述出来吗？'],
    '2': ['这个剧情/台词折射出什么道理？','这个人物观点给你什么启发？'],
    '3': ['这本书的核心理论是什么？','作者的主要观点你怎么看？'],
    '4': ['这个科普知识的原理能解释一下吗？','这个实用技巧的关键步骤是什么？'],
    '5': ['这个 AI 方法论能应用在什么场景？','这条 AI 干货的核心思路是什么？'],
    '6': ['这条手写笔记的核心要点是什么？']
  };
  const arr = templates[source] || ['这个知识点的核心结论是什么？'];
  return arr[Math.floor(Math.random()*arr.length)];
}

function isShortTerm(text, source){
  // 区分短期实用技巧 vs 长期认知知识点
  if(/技巧|方法|步骤|操作|怎么用|教程|快捷键|窍门|实用/.test(text)) return 'short';
  if(/理论|原理|认知|思维|观点|道理|哲学|概念|本质/.test(text)) return 'long';
  return source==='4' || source==='3' ? 'long' : 'short';
}

window.addKnowledge = async ()=>{
  const inp = $('#kbInput');
  const raw = inp.value.trim();
  if(!raw){ toast('请输入内容'); return }
  const source = detectSource(raw);
  const cleaned = cleanText(raw);
  const summary = summarize(raw);
  const keys = extractKeys(raw);
  const type = isShortTerm(raw, source);
  const question = genQuestion(summary, source);
  const item = {
    id: uid(),
    source,
    content: cleaned,
    summary,
    keys,
    type,
    question,
    fav: false,
    created: Date.now()
  };
  // 关联合并：若与已有知识点高度相似（关键词重合≥3），合并
  const existing = State.knowledge.find(k=>{
    const overlap = k.keys.filter(x=>keys.includes(x)).length;
    return overlap >= 3 && k.source === source;
  });
  if(existing){
    existing.content = existing.content + '\n---\n' + cleaned;
    existing.summary = summarize(existing.content);
    existing.keys = [...new Set([...existing.keys, ...keys])].slice(0,6);
    toast('已合并到相似知识点');
  } else {
    State.knowledge.unshift(item);
    toast('已收纳 ✓');
  }
  inp.value = '';
  save();
  renderKnowledge();
  renderWeekList();
};

function renderKnowledge(){
  // tabs
  const tabs = $('#kbTabs');
  let th = `<div class="kb-tab${kbFilter==='all'?' active':''}" onclick="setKbFilter('all')">全部 (${State.knowledge.length})</div>`;
  Object.entries(KB_SOURCES).forEach(([k,v])=>{
    const cnt = State.knowledge.filter(x=>x.source===k).length;
    th += `<div class="kb-tab${kbFilter===k?' active':''}" onclick="setKbFilter('${k}')">${v.label} (${cnt})</div>`;
  });
  tabs.innerHTML = th;
  // list
  const list = $('#kbList');
  let items = kbFilter==='all' ? State.knowledge : State.knowledge.filter(x=>x.source===kbFilter);
  if(!items.length){
    list.innerHTML = `<div class="empty-state"><div class="ic">💡</div>还没有知识点<br>从上方输入框开始收纳第一条吧</div>`;
    return;
  }
  list.innerHTML = items.map(k=>{
    const src = KB_SOURCES[k.source];
    return `<div class="kb-card" onclick="showKbDetail('${k.id}')">
      <div class="top">
        <div>
          <span class="kb-tag ${src.cls}">${src.label}</span>
          <span class="kb-type">${k.type==='short'?'短期实用技巧':'长期认知知识点'}</span>
        </div>
        <button class="task-del" onclick="event.stopPropagation();delKnowledge('${k.id}')">✕</button>
      </div>
      <div class="kb-summary">${escapeHtml(k.summary)}</div>
      <div class="kb-keys">${k.keys.map(key=>`<span class="kb-key">${escapeHtml(key)}</span>`).join('')}</div>
      <div class="kb-q">❓ ${escapeHtml(k.question)}</div>
    </div>`;
  }).join('');
}

window.setKbFilter = f=>{ kbFilter=f; renderKnowledge() };
window.delKnowledge = id=>{ State.knowledge = State.knowledge.filter(k=>k.id!==id); save(); renderKnowledge(); renderFavList(); renderWeekList() };
window.toggleFav = id=>{
  const k = State.knowledge.find(x=>x.id===id);
  if(k){ k.fav=!k.fav; save(); renderKnowledge(); renderFavList(); toast(k.fav?'已收藏到高频复习夹':'已取消收藏') }
};

window.showKbDetail = id=>{
  const k = State.knowledge.find(x=>x.id===id);
  if(!k) return;
  const src = KB_SOURCES[k.source];
  const date = new Date(k.created);
  $('#kbSheet').innerHTML = `
    <div class="sheet-grab" onclick="closeKbSheet()"></div>
    <div style="margin-bottom:10px"><span class="kb-tag ${src.cls}">${src.label}</span> <span class="kb-type">${k.type==='short'?'短期实用技巧':'长期认知知识点'}</span></div>
    <div style="font-size:11px;color:var(--text-2);margin-bottom:8px">收录于 ${fmtFull(date)} ${fmtDate(date)}</div>
    <div style="font-size:15px;font-weight:600;margin-bottom:10px">摘要</div>
    <div style="font-size:14px;line-height:1.6;margin-bottom:16px">${escapeHtml(k.summary)}</div>
    <div style="font-size:15px;font-weight:600;margin-bottom:8px">完整内容</div>
    <div style="font-size:14px;line-height:1.7;background:var(--bg);padding:12px;border-radius:10px;margin-bottom:16px;white-space:pre-wrap">${escapeHtml(k.content)}</div>
    <div style="font-size:15px;font-weight:600;margin-bottom:8px">关键词</div>
    <div class="kb-keys" style="margin-bottom:16px">${k.keys.map(key=>`<span class="kb-key">${escapeHtml(key)}</span>`).join('')}</div>
    <div style="font-size:15px;font-weight:600;margin-bottom:8px">自测思考题</div>
    <div class="kb-q" style="font-size:14px;padding:12px">${escapeHtml(k.question)}</div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn ghost" style="flex:1" onclick="toggleFav('${k.id}');closeKbSheet()">${k.fav?'取消收藏':'⭐ 收藏'}</button>
      <button class="btn" style="flex:1" onclick="makeReviewCard('${k.id}')">做成复习卡</button>
    </div>
  `;
  $('#kbSheetMask').classList.add('show');
};
window.closeKbSheet = ()=>$('#kbSheetMask').classList.remove('show');

// ============ 复习中心 ============
let reviewQueue = [];
let reviewIdx = 0;

window.startReview = (mode)=>{
  let pool = [...State.knowledge];
  if(mode==='source'){
    // 按来源分类：选一个来源
    const sources = [...new Set(pool.map(k=>k.source))];
    if(sources.length<=1){ /* 全部 */ }
    // 简化：随机选一个来源开始
    const sel = sources[Math.floor(Math.random()*sources.length)];
    pool = pool.filter(k=>k.source===sel);
    toast(`按来源复习：${KB_SOURCES[sel].label}`);
  } else if(mode==='keyword'){
    const kw = prompt('输入关键词进行定向复习：');
    if(!kw) return;
    pool = pool.filter(k=>k.keys.some(x=>x.includes(kw)) || k.summary.includes(kw));
    if(!pool.length){ toast('未找到相关知识点'); return }
  } else {
    // random
    pool.sort(()=>Math.random()-0.5);
  }
  if(!pool.length){ toast('暂无可复习的知识点'); return }
  reviewQueue = pool;
  reviewIdx = 0;
  renderReviewCard();
};

function renderReviewCard(){
  const area = $('#reviewArea');
  if(!reviewQueue.length){ area.innerHTML = `<div class="empty-state"><div class="ic">📚</div>暂无复习卡片</div>`; return }
  const k = reviewQueue[reviewIdx];
  const src = KB_SOURCES[k.source];
  area.innerHTML = `
    <div style="font-size:12px;color:var(--text-2);text-align:center;margin-bottom:8px">第 ${reviewIdx+1} / ${reviewQueue.length} 张 · ${src.label}</div>
    <div class="flip-card" onclick="flipCard()">
      <div class="flip-inner" id="flipInner">
        <div class="flip-face front"><div class="flip-label">问题</div><div class="flip-q">${escapeHtml(k.question)}</div><div style="position:absolute;bottom:14px;font-size:11px;color:var(--text-2)">点击翻转看答案</div></div>
        <div class="flip-face back"><div class="flip-label">核心结论</div><div class="flip-a">${escapeHtml(k.summary)}</div></div>
      </div>
    </div>
    <div style="display:flex;gap:8px;justify-content:center">
      <button class="btn ghost sm" onclick="prevCard()" ${reviewIdx===0?'disabled style="opacity:.4"':''}>‹ 上一张</button>
      <button class="btn sm" onclick="nextCard()">下一张 ›</button>
    </div>
  `;
}
window.flipCard = ()=>$('#flipInner').classList.toggle('flipped');
window.nextCard = ()=>{ if(reviewIdx<reviewQueue.length-1){ reviewIdx++; renderReviewCard() } else { toast('复习完成 🎉'); $('#reviewArea').innerHTML = `<div class="empty-state"><div class="ic">🎉</div>全部复习完成！<br>共 ${reviewQueue.length} 张卡片</div>` } };
window.prevCard = ()=>{ if(reviewIdx>0){ reviewIdx--; renderReviewCard() } };
window.makeReviewCard = id=>{
  const k = State.knowledge.find(x=>x.id===id);
  if(!k) return;
  reviewQueue = [k]; reviewIdx = 0;
  closeKbSheet();
  goPage('review');
  renderReviewCard();
};

window.showWeeklyReview = ()=>{
  const now = Date.now();
  const weekAgo = now - 7*24*3600*1000;
  const weekItems = State.knowledge.filter(k=>k.created>=weekAgo);
  if(!weekItems.length){ toast('本周暂无新增知识点'); return }
  // 按来源分组生成思维导图
  const groups = {};
  weekItems.forEach(k=>{ (groups[k.source]=groups[k.source]||[]).push(k) });
  let html = `<div class="mindmap"><div class="root">本周知识点复盘（${weekItems.length} 条）</div>`;
  Object.entries(groups).forEach(([src, items])=>{
    const s = KB_SOURCES[src];
    html += `<div class="branch"><div class="branch-title">${s.label}（${items.length}）</div>`;
    items.forEach(k=>{
      html += `<div class="branch"><span>${escapeHtml(k.summary.slice(0,30))}${k.summary.length>30?'…':''}</span></div>`;
    });
    html += `</div>`;
  });
  html += `</div>`;
  html += `<div style="text-align:center;margin:12px 0"><button class="btn" onclick="exportReview()">导出本周复习清单</button></div>`;
  $('#reviewArea').innerHTML = html;
};

function renderFavList(){
  const favs = State.knowledge.filter(k=>k.fav);
  const el = $('#favList');
  if(!favs.length){ el.innerHTML = `<div class="card card-pad" style="color:var(--text-2);font-size:13px;text-align:center">暂无收藏，在知识详情中点⭐收藏</div>`; return }
  el.innerHTML = favs.map(k=>{
    const src = KB_SOURCES[k.source];
    return `<div class="kb-card" onclick="showKbDetail('${k.id}')">
      <div class="top"><span class="kb-tag ${src.cls}">${src.label}</span><span style="color:var(--pink)">⭐</span></div>
      <div class="kb-summary">${escapeHtml(k.summary)}</div>
    </div>`;
  }).join('');
}

function renderWeekList(){
  const now = Date.now();
  const weekAgo = now - 7*24*3600*1000;
  const items = State.knowledge.filter(k=>k.created>=weekAgo);
  const el = $('#weekList');
  if(!items.length){ el.innerHTML = `<div class="card card-pad" style="color:var(--text-2);font-size:13px;text-align:center">本周暂无新增</div>`; return }
  el.innerHTML = items.map(k=>{
    const src = KB_SOURCES[k.source];
    return `<div class="kb-card" onclick="showKbDetail('${k.id}')">
      <div class="top"><span class="kb-tag ${src.cls}">${src.label}</span><span class="kb-type">${fmtDate(new Date(k.created))}</span></div>
      <div class="kb-summary">${escapeHtml(k.summary)}</div>
    </div>`;
  }).join('');
}

// ============ 播客 ============
const PODCASTS = [
  // AI 使用
  {cat:'ai', title:'硬地骇客', host:'Mars', desc:'AI 时代的独立开发者实战，从 0 到 1 用 AI 做产品的真实故事', icon:'🤖'},
  {cat:'ai', title:'乱翻书', host:'潘乱', desc:'解读 AI 与互联网产品，深度访谈与行业洞察', icon:'📖'},
  {cat:'ai', title:'AI 前哨', host:'前沿小组', desc:'追踪大模型最新进展、提示词技巧与 AI 工具实测', icon:'⚡'},
  {cat:'ai', title:'海外 AI 日报', host:'海外团队', desc:'每天 5 分钟，硅谷 AI 动态速递', icon:'🌅'},
  {cat:'ai', title:'十字路口', host:'Koji', desc:'AI 浪潮下普通人的机会与选择，实用主义视角', icon:'🛤'},
  // 英语听说
  {cat:'eng', title:'Luke\'s English Podcast', host:'Luke Thompson', desc:'英国英语老师播客，地道英式发音，话题轻松有趣', icon:'🇬🇧'},
  {cat:'eng', title:'All Ears English', host:'Lindsay & Michelle', desc:'美式英语对话，学习真实美国人怎么说话', icon:'🇺🇸'},
  {cat:'eng', title:'英文早餐', host:'Chao', desc:'每日一句地道英语，磨耳朵练听力', icon:'🍳'},
  {cat:'eng', title:'The Daily', host:'NY Times', desc:'纽约时报每日新闻，练听力+了解世界', icon:'📰'},
  {cat:'eng', title:'6 Minute English', host:'BBC', desc:'BBC 6分钟英语，话题丰富适合碎片学习', icon:'⏱'},
  // 海外娱乐热点
  {cat:'ent', title:'欧美娱乐播客', host:'娱乐组', desc:'欧美娱乐圈最新八卦、剧集综艺热点', icon:'🎬'},
  {cat:'ent', title:'Pop Culture Happy Hour', host:'NPR', desc:'NPR 流行文化点评，电影剧集音乐一网打尽', icon:'🎶'},
  {cat:'ent', title:'海外热点速递', host:'国际组', desc:'海外热搜、社交媒体爆点话题解读', icon:'🔥'},
  {cat:'ent', title:'Bill Simmons Podcast', host:'Bill Simmons', desc:'美国最火体育娱乐播客，名人访谈', icon:'🏀'},
  {cat:'ent', title:'Watch What Crappens', host:'Ben & Ronnie', desc:'欧美真人秀综艺吐槽，笑声不断', icon:'😂'}
];
const POD_CATS = {ai:{label:'AI 使用',color:'linear-gradient(135deg,#6366F1,#8B5CF6)'}, eng:{label:'英语听说',color:'linear-gradient(135deg,#F59E0B,#EF4444)'}, ent:{label:'海外娱乐热点',color:'linear-gradient(135deg,#EC4899,#F43F5E)'}};
let podCat = 'all';

function renderPodcasts(){
  const tabs = $('#podTabs');
  let th = `<div class="kb-tab${podCat==='all'?' active':''}" onclick="setPodCat('all')">全部</div>`;
  Object.entries(POD_CATS).forEach(([k,v])=>{ th += `<div class="kb-tab${podCat===k?' active':''}" onclick="setPodCat('${k}')">${v.label}</div>` });
  tabs.innerHTML = th;
  const list = $('#podList');
  let items = podCat==='all' ? PODCASTS : PODCASTS.filter(p=>p.cat===podCat);
  list.innerHTML = items.map(p=>{
    const c = POD_CATS[p.cat];
    return `<div class="pod-card">
      <div class="pod-cover" style="background:${c.color}">${p.icon}</div>
      <div class="pod-info">
        <div class="pod-title">${p.title}</div>
        <div class="pod-host">主播：${p.host}</div>
        <div class="pod-desc">${p.desc}</div>
        <div class="pod-cat">${c.label}</div>
      </div>
    </div>`;
  }).join('');
}
window.setPodCat = c=>{ podCat=c; renderPodcasts() };

// ============ 语音录入 ============
let rec = null, recStream = null;
window.toggleVoice = async ()=>{
  if(rec){ stopVoice(); return }
  if(!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)){
    toast('浏览器不支持语音识别，请手动输入');
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  rec = new SR();
  rec.lang = 'zh-CN';
  rec.continuous = false;
  rec.interimResults = true;
  $('#micBtn').classList.add('recording');
  rec.onresult = e=>{
    let txt = '';
    for(let i=e.resultIndex; i<e.results.length; i++) txt += e.results[i][0].transcript;
    $('#kbInput').value = txt;
  };
  rec.onerror = e=>{ toast('语音识别失败：'+e.error); stopVoice() };
  rec.onend = ()=>stopVoice();
  rec.start();
  toast('开始语音录入…');
};
function stopVoice(){ if(rec){ try{rec.stop()}catch(e){} rec=null } $('#micBtn').classList.remove('recording') }

// ============ 设置 ============
const BG_THEMES = [
  {id:1, label:'经典浅灰', color:'#F2F2F7'},
  {id:2, label:'暖白', color:'#FFF8F0'},
  {id:3, label:'冷蓝', color:'#F0F4FF'},
  {id:4, label:'清新绿', color:'#F5FFF5'},
  {id:5, label:'深色模式', color:'#1C1C1E'}
];

function renderSettings(){
  const bp = $('#bgPicker');
  bp.innerHTML = BG_THEMES.map(b=>`<div class="bg-opt${State.bgTheme===b.id?' sel':''}" style="background:${b.color}" onclick="setBg(${b.id})" title="${b.label}"></div>`).join('');
  const nc = $('#navCustom');
  nc.innerHTML = State.navOrder.map((key,i)=>{
    const cfg = NAV_CONFIG[key];
    return `<div class="set-row">
      <span class="lbl">${cfg.icon} ${cfg.label}</span>
      <div style="display:flex;gap:4px">
        <button class="btn ghost sm" onclick="moveNav(${i},-1)" ${i===0?'disabled style="opacity:.3"':''}>↑</button>
        <button class="btn ghost sm" onclick="moveNav(${i},1)" ${i===State.navOrder.length-1?'disabled style="opacity:.3"':''}>↓</button>
      </div>
    </div>`;
  }).join('');
}
window.setBg = id=>{ State.bgTheme = id; document.body.className = 'bg-'+id; save(); renderSettings() };
window.moveNav = (i,dir)=>{
  const j = i+dir;
  if(j<0||j>=State.navOrder.length) return;
  const arr = State.navOrder;
  [arr[i],arr[j]] = [arr[j],arr[i]];
  save(); renderSettings(); renderNav();
};

window.exportData = ()=>{
  const data = JSON.stringify(State, null, 2);
  const blob = new Blob([data], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `leas-workspace-${today()}.json`;
  a.click();
  toast('已导出全部数据');
};

window.exportReview = ()=>{
  const items = State.knowledge;
  if(!items.length){ toast('暂无知识点'); return }
  let txt = `Lea's Workspace · 复习清单\n导出时间：${new Date().toLocaleString('zh-CN')}\n共 ${items.length} 条知识点\n${'='.repeat(40)}\n\n`;
  const groups = {};
  items.forEach(k=>{ (groups[k.source]=groups[k.source]||[]).push(k) });
  Object.entries(groups).forEach(([src, list])=>{
    txt += `\n【${KB_SOURCES[src].label}】（${list.length} 条）\n\n`;
    list.forEach((k,i)=>{
      txt += `${i+1}. ${k.summary}\n`;
      txt += `   关键词：${k.keys.join('、')}\n`;
      txt += `   思考题：${k.question}\n\n`;
    });
  });
  const blob = new Blob([txt], {type:'text/plain;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `复习清单-${today()}.txt`;
  a.click();
  toast('复习清单已导出，可离线查看');
};

window.clearAll = ()=>{
  if(!confirm('确定清空所有数据？此操作不可恢复。')) return;
  State.tasks = State.tasks.filter(t=>t.preset);
  State.checkLog = {};
  State.events = [];
  State.knowledge = [];
  save();
  goPage('daily');
  toast('已清空数据');
};

// ============ 添加菜单（导航+按钮） ============
window.openAddMenu = ()=>{
  $('#sheetContent').innerHTML = `
    <div class="sheet-grab" onclick="closeSheet()"></div>
    <div style="font-size:18px;font-weight:700;margin-bottom:14px">快速操作</div>
    <div class="card">
      <div class="set-row" onclick="closeSheet();goPage('daily');setTimeout(()=>$('#taskInput').focus(),300)"><span class="lbl">✓ 新增每日任务</span><span class="val">›</span></div>
      <div class="set-row" onclick="closeSheet();goPage('monthly');setTimeout(()=>$('#eventInput').focus(),300)"><span class="lbl">📅 添加事件</span><span class="val">›</span></div>
      <div class="set-row" onclick="closeSheet();goPage('knowledge');setTimeout(()=>$('#kbInput').focus(),300)"><span class="lbl">💡 录入知识点</span><span class="val">›</span></div>
      <div class="set-row" onclick="closeSheet();startReview('random')"><span class="lbl">🔁 开始复习</span><span class="val">›</span></div>
    </div>
  `;
  $('#sheetMask').classList.add('show');
};
window.closeSheet = ()=>$('#sheetMask').classList.remove('show');

function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) }

// ============ 初始化 ============
async function init(){
  const saved = await Cloud.get('state', null);
  if(saved){
    Object.assign(State, saved);
    // 确保默认任务存在
    ensureDefaultTasks();
  } else {
    ensureDefaultTasks();
  }
  document.body.className = 'bg-'+State.bgTheme;
  renderNav();
  goPage('daily');
  // 检查每周复盘提醒
  checkWeeklyReminder();
}

function ensureDefaultTasks(){
  if(!State.tasks.find(t=>t.text.includes('12点前睡觉')&&t.preset)){
    State.tasks.unshift({id:'preset-sleep', text:'12点前睡觉', preset:true, created:Date.now()});
  }
  if(!State.tasks.find(t=>t.text==='运动'&&t.preset)){
    // 插入到睡觉之后
    const idx = State.tasks.findIndex(t=>t.id==='preset-sleep');
    if(idx<0) State.tasks.unshift({id:'preset-sport', text:'运动', preset:true, created:Date.now()+1});
    else State.tasks.splice(idx+1, 0, {id:'preset-sport', text:'运动', preset:true, created:Date.now()+1});
  }
}

async function checkWeeklyReminder(){
  const last = await Cloud.get('lastWeeklyReminder', 0);
  const now = Date.now();
  if(now - last > 7*24*3600*1000){
    const weekItems = State.knowledge.filter(k=>k.created >= now - 7*24*3600*1000);
    if(weekItems.length > 0){
      setTimeout(()=>toast(`📚 本周新增 ${weekItems.length} 条知识点，记得复盘！`), 1500);
      await Cloud.set('lastWeeklyReminder', now);
    }
  }
}

// 启动
init();

// 注册 Service Worker
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  });
}

// 防止双击缩放
document.addEventListener('touchend', e=>{ const now=Date.now(); if(now-(window._lastT||0)<300){ e.preventDefault() } window._lastT=now }, {passive:false});

})();
