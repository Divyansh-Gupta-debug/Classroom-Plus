console.log("GC AI Navigator: Active!");

// ─── GLOBALS ──────────────────────────────────────────────────────────────────
var lastUrl = window.location.href;
var classCache  = { id: null, posts: [], complete: false };
var scrollingFor = null;
var pageSettledAt = Date.now(); // timestamp of last class switch — DOM not trusted until 1500ms after this

function getAccountPrefix() {
  var m = window.location.pathname.match(/^\/(u\/\d+)\//);
  return m ? '/' + m[1] : '';
}
function fixUrl(url) {
  if (!url) return url;
  if (/\/u\/\d+\//.test(url)) return url;
  if (url.indexOf('classroom.google.com') === -1) return url;
  var prefix = getAccountPrefix();
  if (!prefix) return url;
  return url.replace('classroom.google.com/', 'classroom.google.com' + prefix + '/');
}
function getClassId() {
  var m = window.location.pathname.match(/\/c\/([^\/]+)/);
  return m ? m[1] : null;
}
function makeId() {
  return '_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
function showToast(msg) {
  var old = document.getElementById('gcn-toast');
  if (old) old.remove();
  if (!document.body) return;
  var t = document.createElement('div');
  t.id = 'gcn-toast';
  t.textContent = String(msg);
  t.style.cssText = 'position:fixed;bottom:28px;right:28px;background:#323232;color:#fff;padding:10px 22px;border-radius:8px;font-size:13px;z-index:999999;box-shadow:0 2px 8px rgba(0,0,0,0.3);font-family:sans-serif;';
  document.body.appendChild(t);
  setTimeout(function() { if (t.parentNode) t.remove(); }, 3000);
}

// ─── BOOKMARKS ────────────────────────────────────────────────────────────────
function saveBookmark(data) {
  try {
    chrome.runtime.sendMessage({ type: 'GET_BOOKMARKS' }, function(res) {
      if (chrome.runtime.lastError) return;
      var all = (res && res.bookmarks) ? res.bookmarks : [];
      if (all.some(function(b) { return b.classId === data.classId && b.title === data.title && b.type === data.type; })) {
        showToast('Already bookmarked!'); return;
      }
      chrome.runtime.sendMessage({ type: 'SAVE_BOOKMARK', payload: data }, function() {
        if (!chrome.runtime.lastError) { refreshBookmarkPanel(); showToast('✅ Bookmarked!'); }
      });
    });
  } catch(e) {}
}
function deleteBookmark(id) {
  try {
    chrome.runtime.sendMessage({ type: 'DELETE_BOOKMARK', id: id }, function() {
      if (!chrome.runtime.lastError) { refreshBookmarkPanel(); showToast('🗑 Removed'); }
    });
  } catch(e) {}
}
function getAllBookmarks(callback) {
  try {
    chrome.runtime.sendMessage({ type: 'GET_BOOKMARKS' }, function(res) {
      if (chrome.runtime.lastError) { callback([]); return; }
      var classId = getClassId();
      var all = (res && res.bookmarks) ? res.bookmarks : [];
      callback(all.filter(function(b) { return b.classId === classId; }));
    });
  } catch(e) { callback([]); }
}

// ─── SEMANTIC MATCH ───────────────────────────────────────────────────────────
function semanticMatch(text, query) {
  if (!text || !query) return false;
  text = text.toLowerCase(); query = query.toLowerCase().trim();
  if (text.includes(query)) return true;
  var words = query.split(/\s+/).filter(function(w) { return w.length > 2; });
  if (words.length > 1 && words.every(function(w) { return text.includes(w); })) return true;
  var syns = {
    'assignment':['homework','task','submit','submission','due'],
    'quiz':['test','exam','mcq','questions'],
    'deadline':['due','last date','submit by'],
    'marks':['score','grade','points'],
    'lecture':['class','session','slides','notes','material'],
    'tutorial':['tut','practice','exercise'],
    'announcement':['notice','update','important'],
    'cancel':['cancelled','postponed','rescheduled'],
    'meet':['meeting','zoom','google meet']
  };
  for (var k in syns) {
    var g = syns[k].concat([k]);
    if (g.some(function(s){return query.includes(s)||s.includes(query);})) {
      if (g.some(function(s){return text.includes(s);})) return true;
    }
  }
  return false;
}

// ─── COLLECT DOM POSTS — strict: only posts with a verified link to this classId ──
function collectDomPosts(classId) {
  var posts = [];
  document.querySelectorAll('.n4xnA').forEach(function(el) {
    if (el.style.display === 'none' || el.style.visibility === 'hidden') return;
    var text = (el.innerText || '').trim();
    if (text.length < 10) return;
    // Find a link that explicitly contains this classId
    var url = '';
    el.querySelectorAll('a[href]').forEach(function(a) {
      if (!url && a.href && a.href.includes('/c/' + classId)) url = a.href;
    });
    // No verified link → could be from another class → skip entirely
    if (!url) return;
    posts.push({ classId: classId, text: text, title: text.substring(0,80), url: fixUrl(url), type: 'stream', element: el });
  });
  document.querySelectorAll('.cQMaT,.RNmOtb,.asQXV,.zR38ld').forEach(function(el) {
    if (el.style.display === 'none') return;
    var text = (el.innerText || '').trim();
    if (text.length < 5) return;
    var a = el.querySelector('a[href]');
    // No link, or link to a different class → skip
    if (!a || !a.href || !a.href.includes('/c/' + classId)) return;
    posts.push({ classId: classId, text: text, title: text.substring(0,80), url: fixUrl(a.href), type: 'assignment', element: el });
  });
  return posts;
}

// ─── WIPE CACHE — called on every class switch, no exceptions ─────────────────
function wipeCache() {
  classCache = { id: null, posts: [], complete: false };
  scrollingFor = null;
  pageSettledAt = Date.now(); // DOM is not trustworthy until 1500ms from now
}

// ─── BACKGROUND SCROLL to load all posts into classCache ─────────────────────
function startScroll(classId) {
  if (scrollingFor === classId) return;
  scrollingFor = classId;

  var scroller = getStreamScroller();
  var savedTop = scroller.scrollTop;
  var prev = document.querySelectorAll('.n4xnA').length;
  var streak = 0, ticks = 0;

  function onScroll() { savedTop = scroller.scrollTop; }
  scroller.addEventListener('scroll', onScroll, { passive: true });

  var iv = setInterval(function() {
    // Stop immediately if class changed
    if (getClassId() !== classId || classCache.id !== classId) {
      clearInterval(iv); scrollingFor = null;
      try { scroller.removeEventListener('scroll', onScroll); } catch(e) {}
      return;
    }
    try {
      scroller = getStreamScroller();
      var cur = document.querySelectorAll('.n4xnA').length;
      if (cur === prev) { streak++; } else { streak = 0; prev = cur; injectStreamBookmarkButtons(); }

      if (streak >= 30 || ticks >= 600) {
        clearInterval(iv); scrollingFor = null;
        try { scroller.removeEventListener('scroll', onScroll); } catch(e) {}
        if (getClassId() !== classId || classCache.id !== classId) return;

        // Final collection — validated against classId
        var posts = collectDomPosts(classId);
        classCache.posts = posts;
        classCache.complete = true;
        requestAnimationFrame(function() { scroller.scrollTop = savedTop; });

        // Refresh any open results panel
        var panel = document.getElementById('gcn-api-results');
        if (panel && panel.getAttribute('data-class-id') === classId) {
          var qi = document.getElementById('gcn-search-input');
          var fi = document.getElementById('gcn-filter');
          if (qi && qi.value.trim()) showResults(qi.value.trim(), fi ? fi.value : 'all', classId);
        }
        return;
      }
      scroller.scrollTop = scroller.scrollHeight + 99999;
      requestAnimationFrame(function() { scroller.scrollTop = savedTop; });
      ticks++;
    } catch(e) { clearInterval(iv); scrollingFor = null; }
  }, 150);
}

function getStreamScroller() {
  var c = [
    document.querySelector('.oBQY9'), document.querySelector('.Aepkob'),
    document.querySelector('.nF0Gb'), document.querySelector('main'),
    document.documentElement
  ];
  for (var i = 0; i < c.length; i++) {
    if (c[i] && c[i].scrollHeight > c[i].clientHeight + 50) return c[i];
  }
  return document.documentElement;
}

// ─── SEARCH ───────────────────────────────────────────────────────────────────
function doSearch(query, filter) {
  if (!query.trim()) return;
  var classId = getClassId();
  if (!classId) return;

  // If the page hasn't settled yet after a class switch, the DOM still has old content
  var msSinceSwitch = Date.now() - pageSettledAt;
  if (msSinceSwitch < 1500) {
    var remaining = Math.ceil((1500 - msSinceSwitch) / 1000);
    showToast('⏳ Loading class... try again in ' + remaining + 's');
    return;
  }

  // If cache is for a different class, wipe it first
  if (classCache.id !== classId) wipeCache();

  classCache.id = classId;

  // Fresh DOM sweep — only picks up posts with verified links to this classId
  var fresh = collectDomPosts(classId);
  if (fresh.length > 0) classCache.posts = fresh;

  showResults(query, filter, classId);

  if (!classCache.complete && scrollingFor !== classId) startScroll(classId);
}

function showResults(query, filter, classId) {
  var old = document.getElementById('gcn-api-results');
  if (old) old.remove();

  // Double-check cache belongs to this class
  if (classCache.id !== classId) return;

  var posts = classCache.posts;
  var complete = classCache.complete;

  var results = posts.filter(function(p) {
    if (p.classId !== classId) return false;       // strict class guard
    if (filter !== 'all' && p.type !== filter) return false;
    return semanticMatch(p.text, query);
  });

  var panel = document.createElement('div');
  panel.id = 'gcn-api-results';
  panel.setAttribute('data-class-id', classId);
  panel.style.cssText = 'position:fixed;top:56px;left:50%;transform:translateX(-50%);width:580px;max-width:95vw;max-height:75vh;overflow-y:auto;background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.2);z-index:99999;font-family:sans-serif;';

  if (!complete) {
    var banner = document.createElement('div');
    banner.style.cssText = 'background:#e8f0fe;color:#1a73e8;font-size:11px;padding:6px 18px;border-bottom:1px solid #c5d8fb;display:flex;align-items:center;gap:8px;';
    banner.innerHTML = '<span style="display:inline-block;width:10px;height:10px;border:2px solid #1a73e8;border-top-color:transparent;border-radius:50%;animation:gcn-spin 0.6s linear infinite;"></span> Still loading older posts — results will update automatically';
    panel.appendChild(banner);
  }

  var header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid #f1f3f4;position:sticky;top:0;background:#fff;border-radius:12px 12px 0 0;';
  var htitle = document.createElement('span');
  htitle.textContent = results.length > 0 ? results.length + ' result(s) for "' + query + '"' : 'No results for "' + query + '"';
  htitle.style.cssText = 'font-size:14px;font-weight:600;color:#202124;';
  var closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'background:#f1f3f4;border:none;border-radius:50%;width:28px;height:28px;cursor:pointer;font-size:13px;color:#5f6368;';
  closeBtn.onclick = function() { panel.remove(); };
  header.appendChild(htitle); header.appendChild(closeBtn);
  panel.appendChild(header);

  if (results.length === 0) {
    var empty = document.createElement('div');
    empty.style.cssText = 'text-align:center;padding:40px 20px;color:#9aa0a6;font-size:13px;';
    empty.innerHTML = '<div style="font-size:36px;margin-bottom:10px">🔍</div>Try different keywords or synonyms.';
    panel.appendChild(empty);
  } else {
    results.forEach(function(r, i) {
      var item = document.createElement('div');
      item.style.cssText = 'padding:12px 18px;border-bottom:1px solid #f1f3f4;background:#fff;';
      item.onmouseover = function() { item.style.background='#f8f9fa'; };
      item.onmouseout  = function() { item.style.background='#fff'; };

      var topRow = document.createElement('div');
      topRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';
      var badge = document.createElement('span');
      badge.textContent = r.type === 'stream' ? '💬 Stream' : '📝 Classwork';
      badge.style.cssText = 'font-size:10px;padding:2px 8px;border-radius:8px;font-weight:600;background:' + (r.type==='stream'?'#e8f0fe;color:#1a73e8;':'#fef7e0;color:#f29900;');
      var num = document.createElement('span');
      num.textContent = '#'+(i+1); num.style.cssText = 'font-size:11px;color:#bdc1c6;';
      topRow.appendChild(badge); topRow.appendChild(num);

      var titleEl = document.createElement('div');
      titleEl.textContent = (r.title||r.text||'').substring(0,120);
      titleEl.style.cssText = 'font-size:13px;font-weight:500;color:#202124;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:6px;';
      titleEl.title = r.title||r.text||'';

      var bottomRow = document.createElement('div');
      bottomRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';
      var date = document.createElement('span');
      date.textContent = r.date ? '🗓 '+r.date : ''; date.style.cssText = 'font-size:11px;color:#9aa0a6;';

      var btnGroup = document.createElement('div'); btnGroup.style.cssText = 'display:flex;gap:6px;';

      var bmBtn = document.createElement('button');
      bmBtn.textContent = '🔖 Save';
      bmBtn.style.cssText = 'font-size:11px;background:#e8f0fe;color:#1a73e8;border:1px solid #1a73e8;padding:3px 10px;border-radius:8px;cursor:pointer;font-weight:600;';
      bmBtn.onclick = function(e) {
        e.stopPropagation();
        saveBookmark({ id:makeId(), classId:classId, title:(r.title||r.text||'').substring(0,80), url:r.url, type:r.type, date:r.date||new Date().toLocaleDateString() });
        bmBtn.textContent='✅ Saved'; setTimeout(function(){bmBtn.textContent='🔖 Save';},2000);
      };

      var goBtn = document.createElement('button');
      goBtn.textContent = '↗ Go to post';
      goBtn.style.cssText = 'font-size:11px;color:#fff;background:#1a73e8;border:none;padding:3px 12px;border-radius:8px;cursor:pointer;font-weight:600;';
      goBtn.onclick = function(e) {
        e.stopPropagation(); panel.remove();
        if (r.element && document.contains(r.element)) {
          r.element.style.outline = '3px solid #1a73e8';
          r.element.style.boxShadow = '0 0 0 5px rgba(26,115,232,0.3)';
          r.element.scrollIntoView({ behavior:'smooth', block:'center' });
          setTimeout(function() { r.element.style.outline=''; r.element.style.boxShadow=''; }, 3000);
        } else { window.location.assign(fixUrl(r.url)); }
      };

      btnGroup.appendChild(bmBtn); btnGroup.appendChild(goBtn);
      bottomRow.appendChild(date); bottomRow.appendChild(btnGroup);
      item.appendChild(topRow); item.appendChild(titleEl); item.appendChild(bottomRow);
      panel.appendChild(item);
    });
  }
  document.body.appendChild(panel);
}

// ─── SEARCH BAR ───────────────────────────────────────────────────────────────
function injectSearchBar() {
  if (document.getElementById('gcn-search-bar')) return;
  var nav = document.querySelector('nav.joJglb') || document.querySelector('.joJglb');
  if (!nav) return;

  if (!document.getElementById('gcn-styles') && document.head) {
    var style = document.createElement('style');
    style.id = 'gcn-styles';
    style.textContent =
      '#gcn-search-input::placeholder{color:rgba(255,255,255,0.75);}' +
      '#gcn-search-input:focus::placeholder{color:#9aa0a6;}' +
      '#gcn-api-results::-webkit-scrollbar{width:5px;}' +
      '#gcn-api-results::-webkit-scrollbar-thumb{background:#dadce0;border-radius:4px;}' +
      '@keyframes gcn-spin{to{transform:rotate(360deg);}}';
    document.head.appendChild(style);
  }

  var bar = document.createElement('div');
  bar.id = 'gcn-search-bar';
  bar.style.cssText = 'display:flex;align-items:center;gap:6px;margin-left:auto;padding-right:12px;flex-shrink:0;';

  var inp = document.createElement('input');
  inp.type='text'; inp.id='gcn-search-input'; inp.placeholder='🔍 Search this class...';
  inp.style.cssText='width:200px;padding:6px 14px;border:none;border-radius:20px;font-size:13px;outline:none;background:rgba(255,255,255,0.2);color:#fff;transition:width 0.3s,background 0.3s;';
  inp.onfocus=function(){inp.style.width='280px';inp.style.background='#fff';inp.style.color='#202124';};
  inp.onblur=function(){if(!inp.value){inp.style.width='200px';inp.style.background='rgba(255,255,255,0.2)';inp.style.color='#fff';}};

  var filterSel = document.createElement('select');
  filterSel.id='gcn-filter';
  filterSel.style.cssText='padding:6px 8px;border:none;border-radius:16px;font-size:12px;outline:none;background:rgba(255,255,255,0.2);color:#fff;cursor:pointer;';
  [['all','All'],['stream','Stream'],['assignment','Classwork']].forEach(function(o){
    var opt=document.createElement('option'); opt.value=o[0]; opt.textContent=o[1]; opt.style.color='#202124'; opt.style.background='#fff';
    filterSel.appendChild(opt);
  });

  var clearBtn = document.createElement('button');
  clearBtn.id='gcn-clear-btn'; clearBtn.textContent='✕';
  clearBtn.style.cssText='padding:5px 10px;background:rgba(255,255,255,0.15);color:#fff;border:none;border-radius:16px;font-size:12px;cursor:pointer;display:none;';
  clearBtn.onclick=function(){
    inp.value=''; clearBtn.style.display='none';
    inp.style.width='200px'; inp.style.background='rgba(255,255,255,0.2)'; inp.style.color='#fff';
    var old=document.getElementById('gcn-api-results'); if(old) old.remove();
  };

  var debounce=null;
  inp.oninput=function(){
    clearBtn.style.display=inp.value?'inline-block':'none';
    var q=inp.value.trim();
    if(!q){var old=document.getElementById('gcn-api-results');if(old)old.remove();return;}
    clearTimeout(debounce); debounce=setTimeout(function(){doSearch(q,filterSel.value);},300);
  };
  filterSel.onchange=function(){var q=inp.value.trim();if(q)doSearch(q,filterSel.value);};
  inp.onkeydown=function(e){
    if(e.key==='Enter'&&inp.value.trim()){clearTimeout(debounce);doSearch(inp.value.trim(),filterSel.value);}
    if(e.key==='Escape'){var old=document.getElementById('gcn-api-results');if(old)old.remove();}
  };

  bar.appendChild(inp); bar.appendChild(filterSel); bar.appendChild(clearBtn);
  nav.style.display='flex'; nav.style.alignItems='center';
  nav.appendChild(bar);
}

// ─── BOOKMARK BUTTONS ─────────────────────────────────────────────────────────
function injectStreamBookmarkButtons() {
  var classId=getClassId(); if(!classId) return;
  document.querySelectorAll('.n4xnA').forEach(function(post){
    if(post.querySelector('.gcn-bm-btn')) return;
    var text=(post.innerText||'').trim(); if(text.length<10) return;
    var postUrl=window.location.href;
    post.querySelectorAll('a[href]').forEach(function(a){if(a.href&&a.href.includes('/c/'))postUrl=a.href;});
    postUrl=fixUrl(postUrl);
    var btn=document.createElement('button');
    btn.className='gcn-bm-btn'; btn.textContent='🔖 Bookmark';
    btn.style.cssText='display:inline-block;margin-top:10px;margin-left:4px;padding:5px 14px;background:#e8f0fe;color:#1a73e8;border:1px solid #1a73e8;border-radius:14px;font-size:12px;cursor:pointer;font-weight:600;';
    btn.setAttribute('data-bookmarked','false');
    btn.onclick=function(e){
      e.stopPropagation();
      if(btn.getAttribute('data-bookmarked')==='true'){
        deleteBookmark(btn.getAttribute('data-bm-id')); btn.setAttribute('data-bookmarked','false'); btn.removeAttribute('data-bm-id');
        btn.textContent='🔖 Bookmark'; btn.style.background='#e8f0fe'; btn.style.color='#1a73e8'; btn.style.borderColor='#1a73e8'; return;
      }
      var id=makeId();
      saveBookmark({id:id,classId:classId,title:text.substring(0,80)+(text.length>80?'...':''),url:postUrl,type:'stream',date:new Date().toLocaleDateString()});
      btn.setAttribute('data-bookmarked','true'); btn.setAttribute('data-bm-id',id);
      btn.textContent='✅ Bookmarked'; btn.style.background='#e6f4ea'; btn.style.color='#34a853'; btn.style.borderColor='#34a853';
    };
    var inner=post.querySelector('.JZicYb')||post.querySelector('.gmNu1d')||post;
    inner.appendChild(btn);
  });
}

function injectAssignmentBookmarkButtons() {
  var classId=getClassId(); if(!classId) return;
  document.querySelectorAll('.cQMaT,.RNmOtb,.asQXV,.zR38ld').forEach(function(item,i){
    if(item.querySelector('.gcn-bm-btn')) return;
    var titleEl=item.querySelector('h3,h4,.YVvGBb,.vwNmF');
    var title=titleEl?(titleEl.innerText||'').trim():'Assignment '+(i+1);
    var url=window.location.href;
    var a=item.querySelector('a[href]'); if(a&&a.href) url=a.href; url=fixUrl(url);
    var btn=document.createElement('button');
    btn.className='gcn-bm-btn'; btn.textContent='🔖';
    btn.style.cssText='display:inline-block;margin-left:8px;padding:2px 8px;background:#e8f0fe;color:#1a73e8;border:1px solid #1a73e8;border-radius:10px;font-size:12px;cursor:pointer;';
    btn.setAttribute('data-bookmarked','false');
    btn.onclick=function(e){
      e.stopPropagation();
      if(btn.getAttribute('data-bookmarked')==='true'){
        deleteBookmark(btn.getAttribute('data-bm-id')); btn.setAttribute('data-bookmarked','false'); btn.removeAttribute('data-bm-id');
        btn.textContent='🔖'; btn.style.background='#e8f0fe'; btn.style.color='#1a73e8'; return;
      }
      var id=makeId();
      saveBookmark({id:id,classId:classId,title:title,url:url,type:'assignment',date:new Date().toLocaleDateString()});
      btn.setAttribute('data-bookmarked','true'); btn.setAttribute('data-bm-id',id);
      btn.textContent='✅'; btn.style.background='#e6f4ea'; btn.style.color='#34a853';
    };
    if(titleEl) titleEl.appendChild(btn); else item.appendChild(btn);
  });
}

// ─── BOOKMARK PANEL ───────────────────────────────────────────────────────────
function injectBookmarkPanel() {
  var classId=getClassId(); if(!classId) return;
  var existing=document.getElementById('gcn-bookmark-panel');
  if(existing){
    // Remove if it belongs to a different class
    if(existing.getAttribute('data-class-id')!==classId) existing.remove(); else return;
  }
  var aside=document.querySelector('aside.DXLeqd')||document.querySelector('.DXLeqd')||document.querySelector('.sMNisf')||document.querySelector('aside');
  if(!aside) return;

  var panel=document.createElement('div'); panel.id='gcn-bookmark-panel'; panel.setAttribute('data-class-id',classId);
  panel.style.cssText='background:#fff;border:1px solid #dadce0;border-radius:12px;padding:14px;margin:12px 8px;font-family:sans-serif;box-shadow:0 1px 3px rgba(0,0,0,0.15);';

  var titleRow=document.createElement('div'); titleRow.style.cssText='display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';
  var titleText=document.createElement('span'); titleText.textContent='🔖 My Bookmarks'; titleText.style.cssText='font-size:14px;font-weight:bold;color:#1a73e8;';
  var badge=document.createElement('span'); badge.id='gcn-count-badge'; badge.style.cssText='background:#1a73e8;color:#fff;border-radius:10px;font-size:11px;padding:2px 8px;font-weight:bold;'; badge.textContent='0';
  titleRow.appendChild(titleText); titleRow.appendChild(badge);

  var filterRow=document.createElement('div'); filterRow.style.cssText='margin-bottom:10px;display:flex;gap:6px;flex-wrap:wrap;';
  var activeFilter='all';
  var listDiv=document.createElement('div'); listDiv.id='gcn-bookmark-list'; listDiv.style.cssText='max-height:300px;overflow-y:auto;';

  [['all','All'],['stream','💬 Stream'],['assignment','📝 Classwork']].forEach(function(f){
    var fb=document.createElement('button'); fb.textContent=f[1];
    fb.setAttribute('data-filter',f[0]); if(f[0]==='all') fb.setAttribute('data-filter-active','true');
    fb.style.cssText='padding:4px 12px;border:1px solid #1a73e8;border-radius:12px;font-size:11px;cursor:pointer;font-weight:500;background:'+(f[0]==='all'?'#1a73e8':'#fff')+';color:'+(f[0]==='all'?'#fff':'#1a73e8')+';';
    fb.onclick=function(){
      activeFilter=f[0];
      filterRow.querySelectorAll('button').forEach(function(b){b.style.background='#fff';b.style.color='#1a73e8';b.removeAttribute('data-filter-active');});
      fb.style.background='#1a73e8'; fb.style.color='#fff'; fb.setAttribute('data-filter-active','true');
      loadBookmarkList(listDiv,activeFilter,badge);
    };
    filterRow.appendChild(fb);
  });
  panel.appendChild(titleRow); panel.appendChild(filterRow); panel.appendChild(listDiv);
  aside.appendChild(panel);
  loadBookmarkList(listDiv,'all',badge);
}

function loadBookmarkList(container,filter,badge){
  getAllBookmarks(function(bookmarks){
    var filtered=filter==='all'?bookmarks:bookmarks.filter(function(b){return b.type===filter;});
    if(badge) badge.textContent=String(filtered.length);
    container.innerHTML='';
    if(filtered.length===0){
      var empty=document.createElement('div'); empty.style.cssText='text-align:center;padding:16px 0;';
      empty.innerHTML='<div style="font-size:28px">🔖</div><p style="font-size:12px;color:#9aa0a6;margin:6px 0">No bookmarks yet.<br>Click 🔖 on any post to save.</p>';
      container.appendChild(empty); return;
    }
    filtered.forEach(function(b){
      var item=document.createElement('div'); item.style.cssText='padding:8px 4px;border-bottom:1px solid #f1f3f4;position:relative;';
      var typeBadge=document.createElement('span'); typeBadge.textContent=b.type==='stream'?'💬 Stream':'📝 Classwork';
      typeBadge.style.cssText='font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;display:inline-block;margin-bottom:4px;background:'+(b.type==='stream'?'#e8f0fe;color:#1a73e8;':'#fef7e0;color:#f29900;');
      var del=document.createElement('button'); del.textContent='✕'; del.style.cssText='position:absolute;top:6px;right:0;background:#fce8e6;border:none;color:#d93025;cursor:pointer;font-size:11px;border-radius:50%;width:20px;height:20px;padding:0;';
      del.onclick=function(){deleteBookmark(b.id);};
      var te=document.createElement('div'); te.textContent=b.title; te.style.cssText='color:#202124;font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:24px;margin-bottom:4px;'; te.title=b.title;
      var bottomRow=document.createElement('div'); bottomRow.style.cssText='display:flex;align-items:center;justify-content:space-between;margin-top:4px;';
      var date=document.createElement('span'); date.textContent=b.date?'🗓 '+b.date:''; date.style.cssText='font-size:10px;color:#9aa0a6;';
      var goBtn=document.createElement('button'); goBtn.textContent='↗ Go to post'; goBtn.style.cssText='font-size:11px;color:#fff;background:#1a73e8;border:none;padding:3px 10px;border-radius:8px;cursor:pointer;font-weight:600;';
      goBtn.onclick=function(e){e.preventDefault();e.stopPropagation();window.location.assign(fixUrl(b.url));};
      bottomRow.appendChild(date); bottomRow.appendChild(goBtn);
      item.appendChild(del); item.appendChild(typeBadge); item.appendChild(te); item.appendChild(bottomRow);
      container.appendChild(item);
    });
  });
}

function refreshBookmarkPanel(){
  var panel=document.getElementById('gcn-bookmark-panel');
  if(panel&&panel.getAttribute('data-class-id')!==getClassId()){panel.remove();return;}
  var listDiv=document.getElementById('gcn-bookmark-list');
  var badge=document.getElementById('gcn-count-badge');
  if(!listDiv) return;
  var activeFilter='all';
  if(panel){var ab=panel.querySelector('button[data-filter-active="true"]');if(ab)activeFilter=ab.getAttribute('data-filter')||'all';}
  loadBookmarkList(listDiv,activeFilter,badge);
}

// ─── URL CHANGE — wipes EVERYTHING, no exceptions ─────────────────────────────
function checkUrlChange() {
  var current = window.location.href;
  if (current === lastUrl) return;
  lastUrl = current;

  // Wipe the entire cache — new class, clean slate
  wipeCache();

  // Tear down all injected UI
  ['gcn-bookmark-panel','gcn-api-results','gcn-search-bar'].forEach(function(id){
    var el=document.getElementById(id); if(el) el.remove();
  });
  var inp=document.getElementById('gcn-search-input');
  if(inp){inp.value='';inp.style.width='200px';inp.style.background='rgba(255,255,255,0.2)';inp.style.color='#fff';}
  var cb=document.getElementById('gcn-clear-btn'); if(cb) cb.style.display='none';
}

// ─── MAIN LOOP ────────────────────────────────────────────────────────────────
function main() {
  try {
    checkUrlChange();
    var classId = getClassId();
    if (!classId) return; // not inside a class page — do nothing
    injectSearchBar();
    injectBookmarkPanel();
    injectStreamBookmarkButtons();
    injectAssignmentBookmarkButtons();
  } catch(e) { console.warn('GC Navigator:', e); }
}

function onReady() {
  var _push=history.pushState.bind(history);
  var _replace=history.replaceState.bind(history);
  history.pushState=function(){_push.apply(history,arguments);setTimeout(main,300);};
  history.replaceState=function(){_replace.apply(history,arguments);setTimeout(main,300);};
  window.addEventListener('popstate',function(){setTimeout(main,300);});
  try{chrome.runtime.sendMessage({type:'CLEAR_ALL_POST_CACHES'},function(){});}catch(e){}
  setInterval(main,2500);
  main();
}

if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',function(){setTimeout(onReady,1500);});
}else{
  setTimeout(onReady,1500);
}