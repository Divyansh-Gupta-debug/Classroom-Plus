console.log("GC AI Navigator: Active!");

// ─── STATE ────────────────────────────────────────────────────────────────────
var postStore = {};
var currentClassId = null;
var scrollingFor  = null;
var lastUrl = window.location.href;

function getAccountPrefix() {
  var m = window.location.pathname.match(/^\/(u\/\d+)\//);
  return m ? '/' + m[1] : '';
}
function fixUrl(url) {
  if (!url) return url;
  if (/\/u\/\d+\//.test(url)) return url;
  if (url.indexOf('classroom.google.com') === -1) return url;
  var pfx = getAccountPrefix();
  return pfx ? url.replace('classroom.google.com/', 'classroom.google.com' + pfx + '/') : url;
}
function getClassIdFromUrl(url) {
  var m = (url || '').match(/\/c\/([^/?#]+)/);
  return m ? m[1] : null;
}
function makeId() {
  return '_' + Math.random().toString(36).substr(2,9) + '_' + Date.now();
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
function showToast(msg) {
  var old = document.getElementById('gcn-toast'); if (old) old.remove();
  if (!document.body) return;
  var t = document.createElement('div');
  t.id = 'gcn-toast'; t.textContent = String(msg);
  t.style.cssText = 'position:fixed;bottom:28px;right:28px;background:#323232;color:#fff;padding:10px 22px;border-radius:8px;font-size:13px;z-index:999999;box-shadow:0 2px 8px rgba(0,0,0,0.3);font-family:sans-serif;';
  document.body.appendChild(t);
  setTimeout(function(){ if (t.parentNode) t.remove(); }, 3000);
}

// ─── BOOKMARKS ────────────────────────────────────────────────────────────────
function saveBookmark(data) {
  try {
    chrome.runtime.sendMessage({ type:'GET_BOOKMARKS' }, function(res) {
      if (chrome.runtime.lastError) return;
      var all = (res && res.bookmarks) ? res.bookmarks : [];
      if (all.some(function(b){ return b.classId===data.classId && b.title===data.title && b.type===data.type; })) {
        showToast('Already bookmarked!'); return;
      }
      chrome.runtime.sendMessage({ type:'SAVE_BOOKMARK', payload:data }, function() {
        if (!chrome.runtime.lastError) { refreshBookmarkPanel(); showToast('✅ Bookmarked!'); }
      });
    });
  } catch(e) {}
}
function deleteBookmark(id) {
  try {
    chrome.runtime.sendMessage({ type:'DELETE_BOOKMARK', id:id }, function() {
      if (!chrome.runtime.lastError) { refreshBookmarkPanel(); showToast('🗑 Removed'); }
    });
  } catch(e) {}
}
function getAllBookmarks(classId, callback) {
  try {
    chrome.runtime.sendMessage({ type:'GET_BOOKMARKS' }, function(res) {
      if (chrome.runtime.lastError) { callback([]); return; }
      var all = (res && res.bookmarks) ? res.bookmarks : [];
      callback(all.filter(function(b){ return b.classId === classId; }));
    });
  } catch(e) { callback([]); }
}

// ─── SEARCH FUNCTIONS ─────────────────────────────────────────────────────────

function levenshtein(a, b) {
  var m = a.length, n = b.length, dp = [], i, j;
  for (i = 0; i <= m; i++) dp[i] = [i];
  for (j = 0; j <= n; j++) dp[0][j] = j;
  for (i = 1; i <= m; i++)
    for (j = 1; j <= n; j++)
      dp[i][j] = a[i-1]===b[j-1] ? dp[i-1][j-1] : 1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
  return dp[m][n];
}
function stringSimilarity(a, b) {
  if (!a || !b) return 0;
  var maxLen = Math.max(a.length, b.length);
  return maxLen ? (maxLen - levenshtein(a, b)) / maxLen : 1;
}

// Normal search: exact substring only
function semanticMatch(text, query) {
  if (!text || !query) return false;
  return text.toLowerCase().includes(query.toLowerCase().trim());
}

// Smart search: typo tolerance + tight synonyms
var SMART_SYNONYMS = [
  ['grade','grades','mark','marks','score','scores','points','gpa','cgpa','result','results','obtained'],
  ['website','site','link','url','webpage','web page','portal','online','platform'],
  ['assignment','homework','submission','submit','task','due','deliverable'],
  ['exam','examination','test','quiz','viva','assessment','evaluation','paper','mid','final','terminal','midsem','endsem'],
  ['deadline','due date','last date','cutoff','closing date','submission date'],
  ['lecture','class','session','lec','lect'],
  ['notes','material','slides','handout','handouts','resource','resources','reference','reading'],
  ['cancel','cancelled','canceled','postpone','postponed','reschedule','rescheduled','off'],
  ['meeting','meet','zoom','google meet','teams','call','conference'],
  ['doubt','question','query','clarification','help','issue','problem'],
  ['project','report','implementation','demo','presentation'],
  ['pdf','file','document','doc','attachment','ppt','pptx','xlsx'],
  ['video','recording','record','recorded','watch','youtube','lecture recording'],
  ['group','team','pair','partner','partners'],
];

// Returns similarity threshold based on word length:
// short words need stricter match to avoid false positives,
// but we also allow 1-edit distance for words >=4 chars (80% accuracy goal)
function fuzzyThreshold(len) {
  if (len <= 3) return 1.0;   // 3-letter words must match exactly
  if (len === 4) return 0.75; // 1 edit allowed (e.g. "sits"->"site" = 0.75)
  if (len === 5) return 0.80; // 1 edit allowed (e.g. "sits"->"sites" = 0.80)
  return 0.82;                // longer words: up to ~1-2 edits
}

function smartSemanticMatch(text, query) {
  if (!text || !query) return false;
  var t = text.toLowerCase();
  var q = query.toLowerCase().trim();
  var qWords = q.split(/\s+/).filter(function(w){ return w.length >= 3; });
  // Search across more of the text for typo matching, not just title
  var searchText = t.substring(0, 400);
  var textWords = searchText.split(/\W+/).filter(function(w){ return w.length >= 3; });
  var hasTypoMatch = qWords.some(function(qw) {
    if (qw.length < 4) return false; // skip very short words for fuzzy
    var threshold = fuzzyThreshold(qw.length);
    return textWords.some(function(tw) {
      // Must be similar length (within 2 chars) to avoid false matches
      if (Math.abs(tw.length - qw.length) > 2) return false;
      return tw !== qw && stringSimilarity(qw, tw) >= threshold;
    });
  });
  if (hasTypoMatch) return true;
  // Synonym matching: require EXACT word boundary match in query,
  // not substring (prevents "a" matching "assignment", etc.)
  return SMART_SYNONYMS.some(function(group) {
    var queryInGroup = group.some(function(syn) {
      // query must equal the synonym exactly, or the query must contain
      // the synonym as a whole word (not just substring)
      if (q === syn) return true;
      // multi-word synonyms: allow contains
      if (syn.indexOf(' ') !== -1 && q.includes(syn)) return true;
      // single-word synonyms: whole-word match only
      var re = new RegExp('(?:^|\\s)' + syn.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '(?:\\s|$)');
      return re.test(q);
    });
    if (!queryInGroup) return false;
    // Also require the synonym found in text to be a real word match
    return group.some(function(syn) {
      if (syn === q) return false;
      if (syn.indexOf(' ') !== -1) return t.includes(syn);
      var re = new RegExp('(?:^|\\s|[^a-z])' + syn.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '(?:[^a-z]|\\s|$)');
      return re.test(t);
    });
  });
}

// ─── COLLECT POSTS FROM DOM ───────────────────────────────────────────────────
function collectDomPosts(classId) {
  var posts = [];
  var classMarker = '/c/' + classId;
  document.querySelectorAll('.n4xnA').forEach(function(el) {
    if (el.style.display==='none' || el.style.visibility==='hidden') return;
    var text = (el.innerText||'').trim();
    if (text.length < 10) return;
    var bestUrl = null, hasForeignClass = false;
    el.querySelectorAll('a[href]').forEach(function(a) {
      if (!a.href) return;
      if (a.href.includes(classMarker)) { if (!bestUrl) bestUrl = a.href; }
      else if (a.href.includes('/c/')) { hasForeignClass = true; }
    });
    if (hasForeignClass && !bestUrl) return;
    var url = bestUrl || ('https://classroom.google.com' + classMarker);
    posts.push({ classId:classId, text:text, title:text.substring(0,80), url:fixUrl(url), type:'stream', element:el });
  });
  document.querySelectorAll('.cQMaT,.RNmOtb,.asQXV,.zR38ld').forEach(function(el) {
    if (el.style.display==='none') return;
    var text = (el.innerText||'').trim();
    if (text.length < 5) return;
    var a = el.querySelector('a[href]');
    if (a && a.href && a.href.includes('/c/') && !a.href.includes(classMarker)) return;
    var url = (a && a.href) ? a.href : ('https://classroom.google.com' + classMarker);
    posts.push({ classId:classId, text:text, title:text.substring(0,80), url:fixUrl(url), type:'assignment', element:el });
  });
  return posts;
}

function flushAll(newClassId) {
  postStore = {}; scrollingFor = null; currentClassId = newClassId;
}

// ─── BACKGROUND SCROLL ────────────────────────────────────────────────────────
function getStreamScroller() {
  var cs = [document.querySelector('.oBQY9'), document.querySelector('.Aepkob'),
            document.querySelector('.nF0Gb'), document.querySelector('main'), document.documentElement];
  for (var i=0;i<cs.length;i++) if (cs[i] && cs[i].scrollHeight > cs[i].clientHeight+50) return cs[i];
  return document.documentElement;
}

function startScroll(classId) {
  if (scrollingFor === classId) return;
  scrollingFor = classId;
  var scroller = getStreamScroller();
  var userTop = scroller.scrollTop;
  var prev = document.querySelectorAll('.n4xnA').length;
  var streak = 0, ticks = 0;
  var iv = setInterval(function() {
    if (currentClassId !== classId) { clearInterval(iv); scrollingFor = null; return; }
    try {
      scroller = getStreamScroller();
      var cur = document.querySelectorAll('.n4xnA').length;
      if (cur === prev) { streak++; }
      else {
        streak = 0; prev = cur;
        if (!postStore[classId]) postStore[classId] = { posts:[], complete:false };
        postStore[classId].posts = collectDomPosts(classId);
        var panel = document.getElementById('gcn-api-results');
        if (panel && panel.getAttribute('data-class-id') === classId) {
          var qi = document.getElementById('gcn-search-input');
          var fi = document.getElementById('gcn-filter');
          if (qi && qi.value.trim()) renderResults(qi.value.trim(), fi?fi.value:'all', classId);
        }
      }
      if (streak >= 30 || ticks >= 600) {
        clearInterval(iv); scrollingFor = null;
        if (currentClassId !== classId) return;
        if (!postStore[classId]) postStore[classId] = { posts:[], complete:false };
        postStore[classId].posts = collectDomPosts(classId);
        postStore[classId].complete = true;
        scroller.scrollTop = userTop;
        var panel2 = document.getElementById('gcn-api-results');
        if (panel2 && panel2.getAttribute('data-class-id') === classId) {
          var qi2 = document.getElementById('gcn-search-input');
          var fi2 = document.getElementById('gcn-filter');
          if (qi2 && qi2.value.trim()) renderResults(qi2.value.trim(), fi2?fi2.value:'all', classId);
        }
        return;
      }
      scroller.scrollTop = scroller.scrollHeight + 99999;
      requestAnimationFrame(function() { scroller.scrollTop = userTop; });
      ticks++;
    } catch(e){ clearInterval(iv); scrollingFor=null; }
  }, 150);
}

// ─── SEARCH ───────────────────────────────────────────────────────────────────
function doSearch(query, filter) {
  if (!query.trim()) return;
  var classId = currentClassId;
  if (!classId) { showToast('Open a class first'); return; }
  if (!postStore[classId]) postStore[classId] = { posts:[], complete:false };
  var fresh = collectDomPosts(classId);
  if (fresh.length > 0) postStore[classId].posts = fresh;
  renderResults(query, filter, classId);
  if (!postStore[classId].complete && scrollingFor !== classId) startScroll(classId);
}

// ─── SNIPPET HELPER ───────────────────────────────────────────────────────────
function getSnippet(text, query) {
  if (!text) return '';
  var q = query.toLowerCase().trim();
  var idx = text.toLowerCase().indexOf(q);
  var snippet;
  if (idx === -1) {
    snippet = text.substring(0, 200);
  } else {
    var start = Math.max(0, idx - 80);
    var end   = Math.min(text.length, idx + q.length + 120);
    snippet = (start > 0 ? '…' : '') + text.substring(start, end) + (end < text.length ? '…' : '');
  }
  snippet = snippet.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  var re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ')', 'gi');
  snippet = snippet.replace(re, '<mark style="background:#fff176;color:#202124;border-radius:2px;padding:0 1px;">$1</mark>');
  return snippet;
}

// ─── RESULT ITEM BUILDER — shared by normal AND smart results ─────────────────
function buildResultItem(r, i, query, classId, panel, isSmartResult) {
  var item = document.createElement('div');
  item.className = 'gcn-result-item';
  item.style.cssText = 'padding:12px 18px;border-bottom:1px solid #f1f3f4;background:' + (isSmartResult ? '#fffbeb' : '#fff') + ';';
  item.onmouseover = function(){ item.style.background = isSmartResult ? '#fef3c7' : '#f8f9fa'; };
  item.onmouseout  = function(){ item.style.background = isSmartResult ? '#fffbeb' : '#fff'; };

  // Top row: type badge + optional smart badge + number
  var topRow = document.createElement('div');
  topRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:5px;';
  var badge = document.createElement('span');
  badge.textContent = r.type==='stream' ? '💬 Stream' : '📝 Classwork';
  badge.style.cssText = 'font-size:10px;padding:2px 8px;border-radius:8px;font-weight:600;background:' +
    (r.type==='stream' ? '#e8f0fe;color:#1a73e8;' : '#fef7e0;color:#f29900;');
  topRow.appendChild(badge);
  if (isSmartResult) {
    var smartBadge = document.createElement('span');
    smartBadge.textContent = '🧠 smart';
    smartBadge.style.cssText = 'font-size:10px;padding:2px 8px;border-radius:8px;font-weight:600;background:#fef3c7;color:#b45309;';
    topRow.appendChild(smartBadge);
  }
  var num = document.createElement('span');
  num.textContent = '#' + (i + 1);
  num.style.cssText = 'font-size:11px;color:#bdc1c6;';
  topRow.appendChild(num);

  // Title
  var titleEl = document.createElement('div');
  titleEl.textContent = (r.title||r.text||'').substring(0,120);
  titleEl.style.cssText = 'font-size:13px;font-weight:600;color:#202124;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:4px;';
  titleEl.title = r.title||r.text||'';

  // Snippet with highlighted query
  var snippetEl = document.createElement('div');
  snippetEl.style.cssText = 'font-size:12px;color:#5f6368;line-height:1.5;margin-bottom:7px;word-break:break-word;';
  snippetEl.innerHTML = getSnippet(r.text || '', query);

  // Bottom row
  var bottomRow = document.createElement('div');
  bottomRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';
  var dt = document.createElement('span');
  dt.textContent = r.date ? '🗓 ' + r.date : '';
  dt.style.cssText = 'font-size:11px;color:#9aa0a6;';
  var grp = document.createElement('div');
  grp.style.cssText = 'display:flex;gap:6px;';
  var bmBtn = document.createElement('button');
  bmBtn.textContent = '🔖 Save';
  bmBtn.style.cssText = 'font-size:11px;background:#e8f0fe;color:#1a73e8;border:1px solid #1a73e8;padding:3px 10px;border-radius:8px;cursor:pointer;font-weight:600;';
  bmBtn.onclick = function(e) {
    e.stopPropagation();
    saveBookmark({id:makeId(),classId:classId,title:(r.title||r.text||'').substring(0,80),url:r.url,type:r.type,date:r.date||new Date().toLocaleDateString()});
    bmBtn.textContent='✅ Saved'; setTimeout(function(){ bmBtn.textContent='🔖 Save'; }, 2000);
  };
  var goBtn = document.createElement('button');
  goBtn.textContent = '↗ Go to post';
  goBtn.style.cssText = 'font-size:11px;color:#fff;background:#1a73e8;border:none;padding:3px 12px;border-radius:8px;cursor:pointer;font-weight:600;';
  goBtn.onclick = function(e) {
    e.stopPropagation(); panel.remove();
    if (r.element && document.contains(r.element)) {
      r.element.style.outline='3px solid #1a73e8'; r.element.style.boxShadow='0 0 0 5px rgba(26,115,232,0.3)';
      r.element.scrollIntoView({behavior:'smooth',block:'center'});
      setTimeout(function(){ r.element.style.outline=''; r.element.style.boxShadow=''; }, 3000);
    } else { window.location.assign(fixUrl(r.url)); }
  };
  grp.appendChild(bmBtn); grp.appendChild(goBtn);
  bottomRow.appendChild(dt); bottomRow.appendChild(grp);

  item.appendChild(topRow);
  item.appendChild(titleEl);
  item.appendChild(snippetEl);
  item.appendChild(bottomRow);
  return item;
}

// ─── RENDER RESULTS ───────────────────────────────────────────────────────────
function renderResults(query, filter, classId) {
  if (currentClassId !== classId) return;
  var store = postStore[classId];
  var posts = store ? store.posts : [];
  var complete = store ? store.complete : false;

  var results = posts.filter(function(p) {
    if (p.classId !== classId) return false;
    if (filter !== 'all' && p.type !== filter) return false;
    return semanticMatch(p.text, query);
  });

  var old = document.getElementById('gcn-api-results'); if (old) old.remove();
  var panel = document.createElement('div');
  panel.id = 'gcn-api-results';
  panel.setAttribute('data-class-id', classId);
  panel.style.cssText = 'position:fixed;top:56px;left:50%;transform:translateX(-50%);width:580px;max-width:95vw;max-height:75vh;overflow-y:auto;background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.2);z-index:99999;font-family:sans-serif;';

  var debug = document.createElement('div');
  debug.style.cssText = 'background:#f1f8e9;color:#388e3c;font-size:10px;padding:4px 14px;border-bottom:1px solid #c8e6c9;font-family:monospace;';
  debug.textContent = '🔍 Searching class: ' + classId + (complete ? ' ✓ complete' : ' … loading');
  panel.appendChild(debug);

  if (!complete) {
    var banner = document.createElement('div');
    banner.style.cssText = 'background:#e8f0fe;color:#1a73e8;font-size:11px;padding:6px 18px;border-bottom:1px solid #c5d8fb;display:flex;align-items:center;gap:8px;';
    banner.innerHTML = '<span style="display:inline-block;width:10px;height:10px;border:2px solid #1a73e8;border-top-color:transparent;border-radius:50%;animation:gcn-spin 0.6s linear infinite;"></span> Still loading older posts — results will update';
    panel.appendChild(banner);
  }

  var header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid #f1f3f4;position:sticky;top:0;background:#fff;border-radius:12px 12px 0 0;';
  var htitle = document.createElement('span');
  htitle.textContent = results.length > 0 ? results.length+' result(s) for "'+query+'"' : 'No results for "'+query+'"';
  htitle.style.cssText = 'font-size:14px;font-weight:600;color:#202124;';
  var closeBtn = document.createElement('button');
  closeBtn.textContent='✕'; closeBtn.style.cssText='background:#f1f3f4;border:none;border-radius:50%;width:28px;height:28px;cursor:pointer;font-size:13px;color:#5f6368;';
  closeBtn.onclick=function(){ panel.remove(); };
  header.appendChild(htitle); header.appendChild(closeBtn); panel.appendChild(header);

  if (results.length === 0) {
    var empty = document.createElement('div');
    empty.style.cssText='text-align:center;padding:40px 20px;color:#9aa0a6;font-size:13px;';
    empty.innerHTML='<div style="font-size:36px;margin-bottom:10px">🔍</div>Try different keywords or synonyms.';
    var deepSuggest = document.createElement('button');
    deepSuggest.textContent = '📄 Try Deep Search (search inside PDFs)';
    deepSuggest.style.cssText = 'margin-top:12px;padding:8px 18px;background:#ede9fe;color:#6d28d9;border:1.5px solid #6d28d9;border-radius:20px;font-size:12px;cursor:pointer;font-weight:600;';
    deepSuggest.onclick = function() { panel.remove(); doDeepSearch(query); };
    empty.appendChild(document.createElement('br'));
    empty.appendChild(deepSuggest);
    panel.appendChild(empty);
  } else {
    results.forEach(function(r, i) {
      panel.appendChild(buildResultItem(r, i, query, classId, panel, false));
    });
  }

  // Smart results footer
  var smartResults = posts.filter(function(p) {
    if (p.classId !== classId) return false;
    if (filter !== 'all' && p.type !== filter) return false;
    if (semanticMatch(p.text, query)) return false;
    return smartSemanticMatch(p.text, query);
  });

  var footer = document.createElement('div');
  footer.style.cssText = 'padding:14px 18px;border-top:1px solid #f1f3f4;text-align:center;';
  if (smartResults.length > 0) {
    var notSatisfiedBtn = document.createElement('button');
    notSatisfiedBtn.textContent = '🔎 Not satisfied? Show ' + smartResults.length + ' smart result' + (smartResults.length > 1 ? 's' : '') + ' (typos & similar topics)';
    notSatisfiedBtn.style.cssText = 'padding:8px 18px;background:#f8f9fa;color:#1a73e8;border:1.5px solid #1a73e8;border-radius:20px;font-size:12px;cursor:pointer;font-weight:600;transition:background 0.15s;';
    notSatisfiedBtn.onmouseover = function(){ notSatisfiedBtn.style.background='#e8f0fe'; };
    notSatisfiedBtn.onmouseout  = function(){ notSatisfiedBtn.style.background='#f8f9fa'; };
    notSatisfiedBtn.onclick = function() {
      footer.remove();
      var divider = document.createElement('div');
      divider.style.cssText = 'padding:10px 18px 4px;background:#fef7e0;border-top:1px solid #fde68a;border-bottom:1px solid #fde68a;display:flex;align-items:center;gap:8px;';
      divider.innerHTML = '<span style="font-size:13px;">🧠</span><span style="font-size:12px;font-weight:600;color:#b45309;">Smart results — fuzzy matches & similar topics</span>';
      panel.appendChild(divider);
      smartResults.forEach(function(r, i) {
        panel.appendChild(buildResultItem(r, i, query, classId, panel, true));
      });
    };
    footer.appendChild(notSatisfiedBtn);
  } else {
    footer.innerHTML = '<span style="font-size:11px;color:#9aa0a6;">✓ All possible matches shown</span>';
  }
  panel.appendChild(footer);
  document.body.appendChild(panel);
}

// ─── DEEP SEARCH (search inside PDFs & attachments) ──────────────────────────
var deepSearchInProgress = false;

function doDeepSearch(query) {
  if (!query.trim()) return;
  if (deepSearchInProgress) { showToast('Deep search already running...'); return; }
  var classId = currentClassId;
  if (!classId) { showToast('Open a class first'); return; }

  deepSearchInProgress = true;
  var dsBtn = document.getElementById('gcn-deep-search-btn');
  if (dsBtn) { dsBtn.textContent = '⏳ Scanning...'; dsBtn.disabled = true; }

  showToast('🔐 Requesting permission to read files...');

  try {
    chrome.runtime.sendMessage({
      type: 'DEEP_SEARCH',
      classId: classId,
      query: query.trim()
    }, function(res) {
      deepSearchInProgress = false;
      if (dsBtn) { dsBtn.textContent = '📄 Deep Search'; dsBtn.disabled = false; }

      if (chrome.runtime.lastError) {
        showToast('❌ Error: ' + chrome.runtime.lastError.message);
        return;
      }
      if (!res) {
        showToast('❌ No response from background');
        return;
      }
      if (res.error) {
        showToast('❌ ' + res.error);
        return;
      }

      renderDeepSearchResults(query, classId, res);
    });
  } catch(e) {
    deepSearchInProgress = false;
    if (dsBtn) { dsBtn.textContent = '📄 Deep Search'; dsBtn.disabled = false; }
    showToast('❌ ' + e.message);
  }
}

function renderDeepSearchResults(query, classId, response) {
  var results = response.results || [];
  var totalFiles = response.totalFiles || 0;
  var debugLog = response.debug || [];

  // Always log debug info to page console
  if (debugLog.length > 0) {
    console.log('%c[GC Deep Search Debug]', 'color:#6d28d9;font-weight:bold;');
    debugLog.forEach(function(line) { console.log('  ' + line); });
  }

  var old = document.getElementById('gcn-api-results'); if (old) old.remove();
  var panel = document.createElement('div');
  panel.id = 'gcn-api-results';
  panel.setAttribute('data-class-id', classId);
  panel.style.cssText = 'position:fixed;top:56px;left:50%;transform:translateX(-50%);width:620px;max-width:95vw;max-height:80vh;overflow-y:auto;background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.2);z-index:99999;font-family:sans-serif;';

  // Info bar
  var info = document.createElement('div');
  info.style.cssText = 'background:#ede9fe;color:#6d28d9;font-size:11px;padding:6px 18px;border-bottom:1px solid #ddd6fe;display:flex;align-items:center;gap:8px;border-radius:12px 12px 0 0;';
  info.innerHTML = '<span style="font-size:14px;">📄</span> Deep Search — scanned <b>' + totalFiles + '</b> file(s) for "<b>' + query.replace(/</g,'&lt;') + '</b>"';
  panel.appendChild(info);

  // Header
  var header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid #f1f3f4;position:sticky;top:0;background:#fff;z-index:1;';
  var htitle = document.createElement('span');
  htitle.textContent = results.length > 0
    ? '📄 ' + results.length + ' match(es) found inside files'
    : '📄 No matches found inside files';
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
    empty.innerHTML = '<div style="font-size:36px;margin-bottom:10px">📄</div>' +
      (response.message || 'No matches found.') + '<br>' +
      '<span style="font-size:11px;color:#bdc1c6;">Searched PDFs, Docs, Slides attached to stream posts & assignments.</span>';
    if (debugLog.length > 0) {
      var debugEl = document.createElement('div');
      debugEl.style.cssText = 'margin-top:12px;padding:8px;background:#f3f4f6;border-radius:6px;text-align:left;font-size:10px;color:#6b7280;font-family:monospace;max-height:160px;overflow-y:auto;word-break:break-all;';
      debugEl.innerHTML = '<b>Debug log:</b><br>' + debugLog.map(function(l){ return l.replace(/</g,'&lt;'); }).join('<br>');
      empty.appendChild(debugEl);
    }
    panel.appendChild(empty);
  } else {
    results.forEach(function(r, i) {
      var item = document.createElement('div');
      item.style.cssText = 'padding:14px 18px;border-bottom:1px solid #f1f3f4;background:#faf5ff;transition:background 0.15s;';
      item.onmouseover = function() { item.style.background = '#f3e8ff'; };
      item.onmouseout  = function() { item.style.background = '#faf5ff'; };

      // Top row: badges
      var topRow = document.createElement('div');
      topRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';
      var typeBadge = document.createElement('span');
      typeBadge.textContent = r.postType === 'stream' ? '💬 Stream' : r.postType === 'material' ? '📚 Material' : '📝 Classwork';
      typeBadge.style.cssText = 'font-size:10px;padding:2px 8px;border-radius:8px;font-weight:600;' +
        (r.postType === 'stream' ? 'background:#e8f0fe;color:#1a73e8;' : r.postType === 'material' ? 'background:#e8f5e9;color:#2e7d32;' : 'background:#fef7e0;color:#f29900;');
      var deepBadge = document.createElement('span');
      deepBadge.textContent = '📄 PDF match';
      deepBadge.style.cssText = 'font-size:10px;padding:2px 8px;border-radius:8px;font-weight:600;background:#ede9fe;color:#6d28d9;';
      var num = document.createElement('span');
      num.textContent = '#' + (i + 1);
      num.style.cssText = 'font-size:11px;color:#bdc1c6;';
      topRow.appendChild(typeBadge);
      topRow.appendChild(deepBadge);
      topRow.appendChild(num);

      // File name
      var fileNameEl = document.createElement('div');
      fileNameEl.textContent = '📎 ' + r.fileName;
      fileNameEl.style.cssText = 'font-size:13px;font-weight:600;color:#202124;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      fileNameEl.title = r.fileName;

      // Post title
      var postTitleEl = document.createElement('div');
      postTitleEl.textContent = 'From: ' + (r.postTitle || 'Unknown post');
      postTitleEl.style.cssText = 'font-size:11px;color:#9aa0a6;margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

      // Snippet
      var snippetEl = document.createElement('div');
      snippetEl.style.cssText = 'font-size:12px;color:#5f6368;line-height:1.6;margin-bottom:8px;word-break:break-word;background:#fff;padding:8px 12px;border-radius:8px;border:1px solid #e9d5ff;';
      snippetEl.innerHTML = highlightDeepSnippet(r.snippet || '', query);

      // Bottom row: date + buttons
      var bottomRow = document.createElement('div');
      bottomRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';
      var dt = document.createElement('span');
      dt.textContent = r.postDate ? '🗓 ' + r.postDate : '';
      dt.style.cssText = 'font-size:11px;color:#9aa0a6;';
      var btnGrp = document.createElement('div');
      btnGrp.style.cssText = 'display:flex;gap:6px;';

      var openFileBtn = document.createElement('button');
      openFileBtn.textContent = '📄 Open File';
      openFileBtn.style.cssText = 'font-size:11px;background:#ede9fe;color:#6d28d9;border:1px solid #6d28d9;padding:3px 12px;border-radius:8px;cursor:pointer;font-weight:600;';
      openFileBtn.onclick = function(e) { e.stopPropagation(); window.open(r.fileUrl, '_blank'); };

      if (r.postUrl) {
        var goPostBtn = document.createElement('button');
        goPostBtn.textContent = '↗ Go to post';
        goPostBtn.style.cssText = 'font-size:11px;color:#fff;background:#1a73e8;border:none;padding:3px 12px;border-radius:8px;cursor:pointer;font-weight:600;';
        goPostBtn.onclick = function(e) { e.stopPropagation(); window.open(fixUrl(r.postUrl), '_blank'); };
        btnGrp.appendChild(goPostBtn);
      }
      btnGrp.appendChild(openFileBtn);
      bottomRow.appendChild(dt);
      bottomRow.appendChild(btnGrp);

      item.appendChild(topRow);
      item.appendChild(fileNameEl);
      item.appendChild(postTitleEl);
      item.appendChild(snippetEl);
      item.appendChild(bottomRow);
      panel.appendChild(item);
    });
  }

  // Footer
  var footer = document.createElement('div');
  footer.style.cssText = 'padding:12px 18px;border-top:1px solid #f1f3f4;text-align:center;';
  footer.innerHTML = '<span style="font-size:11px;color:#9aa0a6;">Deep Search scanned ' + totalFiles + ' attached file(s) via Google Classroom & Drive APIs</span>';
  panel.appendChild(footer);

  document.body.appendChild(panel);
}

function highlightDeepSnippet(snippet, query) {
  if (!snippet) return '';
  var safe = snippet.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  var words = query.toLowerCase().trim().split(/\s+/).filter(function(w){ return w.length >= 2; });
  words.forEach(function(w) {
    var re = new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ')', 'gi');
    safe = safe.replace(re, '<mark style="background:#ddd6fe;color:#4c1d95;border-radius:2px;padding:0 2px;">$1</mark>');
  });
  return safe;
}
var gcnDark = false;

function initDarkMode() {
  var saved = localStorage.getItem('gcn_dark_mode');
  if (saved !== null) { gcnDark = saved === '1'; }
  else { gcnDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; }
  applyDarkMode();
}

function applyDarkMode() {
  var s = document.getElementById('gcn-dark-style');
  if (!s) { s = document.createElement('style'); s.id = 'gcn-dark-style'; document.head.appendChild(s); }

  s.textContent = gcnDark ? [
    // ── Invert the entire page ─────────────────────────────────────────────────
    'html { filter: invert(1) hue-rotate(180deg) !important; background: #fff !important; }',

    // ── Re-invert images & videos so photos look correct ──────────────────────
    'img, video, canvas, picture { filter: invert(1) hue-rotate(180deg) !important; }',

    // ── Class card title text: invert turns them dark — force back to white ───
    '.YVvGBb, .vwNmF, .oUlnUb, .khuEhb, .ZG0g6, .lXf2hd, .yBSP2 { color: #fff !important; }',

    // ── Re-invert extension UI panels (double-invert = back to normal colours) ─
    '#gcn-nav-group { filter: invert(1) hue-rotate(180deg) !important; }',
    '#gcn-bookmark-panel { filter: invert(1) hue-rotate(180deg) !important; }',
    '#gcn-api-results { filter: invert(1) hue-rotate(180deg) !important; }',
    '#gcn-toast { filter: invert(1) hue-rotate(180deg) !important; }',

    // ── After re-invert, style extension buttons black ─────────────────────────
    '#gcn-dark-toggle { background:#111 !important; color:#fff !important; border:1px solid #444 !important; }',
    '#gcn-bm-nav-btn  { background:#111 !important; color:#fff !important; border:1px solid #444 !important; }',
    '#gcn-search-input { background:#111 !important; color:#fff !important; border:1px solid #444 !important; }',
    '#gcn-filter       { background:#111 !important; color:#fff !important; border:1px solid #444 !important; }',
    '#gcn-clear-btn    { background:#222 !important; color:#ccc !important; }',
    'button.gcn-bm-btn { background:#111 !important; color:#fff !important; border:1px solid #444 !important; }',
    '#gcn-deep-search-btn { background:#2d1b69 !important; color:#c4b5fd !important; border:1px solid #6d28d9 !important; }',
  ].join('\n') : '';

  var toggle = document.getElementById('gcn-dark-toggle');
  if (toggle) toggle.textContent = gcnDark ? '☀️' : '🌙';
}

function toggleDarkMode() {
  gcnDark = !gcnDark;
  localStorage.setItem('gcn_dark_mode', gcnDark ? '1' : '0');
  applyDarkMode();
}

// ─── DARK TOGGLE ──────────────────────────────────────────────────────────────
function injectDarkToggle() {
  if (document.getElementById('gcn-nav-group')) return;
  var group = document.createElement('div');
  group.id = 'gcn-nav-group';
  group.style.cssText = 'position:fixed;top:0;right:120px;height:64px;display:flex;align-items:center;gap:8px;z-index:9000;pointer-events:auto;';
  var darkToggle = document.createElement('button');
  darkToggle.id = 'gcn-dark-toggle';
  darkToggle.title = 'Toggle dark mode';
  darkToggle.textContent = gcnDark ? '☀️' : '🌙';
  darkToggle.style.cssText = 'padding:5px 10px;background:#f1f3f4;color:#202124;border:1px solid #dadce0;border-radius:18px;font-size:14px;cursor:pointer;flex-shrink:0;transition:background 0.15s;line-height:1;';
  darkToggle.onclick = function() { toggleDarkMode(); };
  group.appendChild(darkToggle);
  document.body.appendChild(group);
}

// ─── SEARCH BAR ───────────────────────────────────────────────────────────────
function injectSearchBar() {
  if (document.getElementById('gcn-search-bar')) return;
  if (!document.getElementById('gcn-styles') && document.head) {
    var s = document.createElement('style'); s.id = 'gcn-styles';
    s.textContent = '#gcn-search-input::placeholder{color:#9aa0a6;}#gcn-api-results::-webkit-scrollbar{width:5px;}#gcn-api-results::-webkit-scrollbar-thumb{background:#dadce0;border-radius:4px;}#gcn-bookmark-list::-webkit-scrollbar{width:4px;}#gcn-bookmark-list::-webkit-scrollbar-thumb{background:#dadce0;border-radius:4px;}@keyframes gcn-spin{to{transform:rotate(360deg);}}@keyframes gcn-dropdown{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}';
    document.head.appendChild(s);
  }
  var bar = document.createElement('div'); bar.id='gcn-search-bar'; bar.style.cssText='display:flex;align-items:center;gap:6px;';
  var inp = document.createElement('input'); inp.type='text'; inp.id='gcn-search-input'; inp.placeholder='🔍 Search this class...';
  inp.style.cssText = 'width:180px;padding:5px 12px;border:none;border-radius:18px;font-size:13px;outline:none;background:rgba(0,0,0,0.08);color:#202124;transition:width 0.3s,background 0.3s;';
  inp.onfocus = function(){ inp.style.width='240px'; inp.style.background='#fff'; inp.style.boxShadow='0 1px 4px rgba(0,0,0,0.2)'; };
  inp.onblur  = function(){ if(!inp.value){ inp.style.width='180px'; inp.style.background='rgba(0,0,0,0.08)'; inp.style.boxShadow=''; } };
  var sel = document.createElement('select'); sel.id='gcn-filter';
  sel.style.cssText = 'padding:5px 6px;border:1px solid #dadce0;border-radius:14px;font-size:12px;outline:none;background:#fff;color:#202124;cursor:pointer;';
  [['all','All'],['stream','Stream'],['assignment','Classwork']].forEach(function(o){
    var opt=document.createElement('option'); opt.value=o[0]; opt.textContent=o[1]; sel.appendChild(opt);
  });
  var clr = document.createElement('button'); clr.id='gcn-clear-btn'; clr.textContent='✕';
  clr.style.cssText = 'padding:4px 9px;background:#f1f3f4;color:#5f6368;border:none;border-radius:14px;font-size:12px;cursor:pointer;display:none;';
  clr.onclick = function(){ inp.value=''; clr.style.display='none'; inp.style.width='180px'; inp.style.background='rgba(0,0,0,0.08)'; inp.style.boxShadow=''; var o=document.getElementById('gcn-api-results');if(o)o.remove(); };
  var dbt=null;
  inp.oninput = function(){
    clr.style.display=inp.value?'inline-block':'none';
    var q=inp.value.trim(); if(!q){var o=document.getElementById('gcn-api-results');if(o)o.remove();return;}
    clearTimeout(dbt); dbt=setTimeout(function(){doSearch(q,sel.value);},300);
  };
  sel.onchange = function(){ var q=inp.value.trim(); if(q)doSearch(q,sel.value); };
  inp.onkeydown = function(e){
    if(e.key==='Enter'&&inp.value.trim()){clearTimeout(dbt);doSearch(inp.value.trim(),sel.value);}
    if(e.key==='Escape'){var o=document.getElementById('gcn-api-results');if(o)o.remove();}
  };
  bar.appendChild(inp); bar.appendChild(sel); bar.appendChild(clr);

  // Deep Search button
  var dsBtn = document.createElement('button');
  dsBtn.id = 'gcn-deep-search-btn';
  dsBtn.textContent = '📄 Deep Search';
  dsBtn.title = 'Search inside PDFs & attachments (requires permission)';
  dsBtn.style.cssText = 'padding:5px 12px;background:#ede9fe;color:#6d28d9;border:1px solid #6d28d9;border-radius:18px;font-size:12px;cursor:pointer;font-weight:600;white-space:nowrap;transition:background 0.15s;';
  dsBtn.onmouseover = function() { dsBtn.style.background = '#ddd6fe'; };
  dsBtn.onmouseout  = function() { dsBtn.style.background = '#ede9fe'; };
  dsBtn.onclick = function() {
    var q = inp.value.trim();
    if (!q) { showToast('Type a search query first'); inp.focus(); return; }
    doDeepSearch(q);
  };
  bar.appendChild(dsBtn);

  var group=document.getElementById('gcn-nav-group');
  if(group){group.appendChild(bar);}else{document.body.appendChild(bar);}
}

// ─── BOOKMARK BUTTONS ─────────────────────────────────────────────────────────
function injectStreamBookmarkButtons() {
  var classId=currentClassId; if(!classId) return;
  document.querySelectorAll('.n4xnA').forEach(function(post){
    if(post.querySelector('.gcn-bm-btn')) return;
    var text=(post.innerText||'').trim(); if(text.length<10) return;
    var url=null;
    post.querySelectorAll('a[href]').forEach(function(a){ if(a.href&&a.href.includes('/p/'))url=a.href; });
    if(!url)post.querySelectorAll('a[href]').forEach(function(a){ if(!url&&a.href&&a.href.includes('/c/'))url=a.href; });
    if(!url)url=window.location.href;
    url=fixUrl(url);
    var btn=document.createElement('button'); btn.className='gcn-bm-btn'; btn.textContent='🔖 Bookmark';
    btn.style.cssText='display:inline-block;margin-top:10px;margin-left:4px;padding:5px 14px;background:#e8f0fe;color:#1a73e8;border:1px solid #1a73e8;border-radius:14px;font-size:12px;cursor:pointer;font-weight:600;';
    btn.setAttribute('data-bookmarked','false');
    btn.onclick=function(e){
      e.stopPropagation();
      if(btn.getAttribute('data-bookmarked')==='true'){
        deleteBookmark(btn.getAttribute('data-bm-id')); btn.setAttribute('data-bookmarked','false'); btn.removeAttribute('data-bm-id');
        btn.textContent='🔖 Bookmark'; btn.style.background='#e8f0fe'; btn.style.color='#1a73e8'; btn.style.borderColor='#1a73e8'; return;
      }
      var id=makeId();
      saveBookmark({id:id,classId:classId,title:text.substring(0,80)+(text.length>80?'...':''),fullText:text.substring(0,300),url:url,type:'stream',date:new Date().toLocaleDateString()});
      btn.setAttribute('data-bookmarked','true'); btn.setAttribute('data-bm-id',id);
      btn.textContent='✅ Bookmarked'; btn.style.background='#e6f4ea'; btn.style.color='#34a853'; btn.style.borderColor='#34a853';
    };
    var inner=post.querySelector('.JZicYb')||post.querySelector('.gmNu1d')||post; inner.appendChild(btn);
  });
}
function injectAssignmentBookmarkButtons() {
  var classId=currentClassId; if(!classId) return;
  document.querySelectorAll('.cQMaT,.RNmOtb,.asQXV,.zR38ld').forEach(function(item,i){
    if(item.querySelector('.gcn-bm-btn')) return;
    var te=item.querySelector('h3,h4,.YVvGBb,.vwNmF');
    var title=te?(te.innerText||'').trim():'Assignment '+(i+1);
    var url=window.location.href; var a=item.querySelector('a[href]'); if(a&&a.href)url=a.href; url=fixUrl(url);
    var btn=document.createElement('button'); btn.className='gcn-bm-btn'; btn.textContent='🔖';
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
    if(te)te.appendChild(btn); else item.appendChild(btn);
  });
}

// ─── BOOKMARK PANEL ───────────────────────────────────────────────────────────
function injectBookmarkPanel() {
  var classId=currentClassId; if(!classId) return;
  var ex=document.getElementById('gcn-bookmark-panel');
  if(ex&&ex.getAttribute('data-class-id')!==classId){ex.remove();ex=null;}
  var oldBtn=document.getElementById('gcn-bm-nav-btn');
  if(oldBtn&&oldBtn.getAttribute('data-class-id')!==classId){oldBtn.remove();oldBtn=null;}
  if(document.getElementById('gcn-bm-nav-btn'))return;
  var navBtn=document.createElement('button');
  navBtn.id='gcn-bm-nav-btn'; navBtn.setAttribute('data-class-id',classId); navBtn.title='My Bookmarks';
  navBtn.style.cssText='position:relative;display:flex;align-items:center;gap:5px;padding:5px 12px;background:#f1f3f4;color:#202124;border:1px solid #dadce0;border-radius:18px;font-size:13px;font-weight:600;cursor:pointer;font-family:"Google Sans",Roboto,Arial,sans-serif;transition:background 0.15s;flex-shrink:0;';
  navBtn.innerHTML='🔖 <span id="gcn-bm-nav-count" style="background:#1a73e8;color:#fff;border-radius:10px;font-size:11px;padding:1px 7px;font-weight:700;display:none;">0</span>';
  navBtn.onmouseover=function(){navBtn.style.background='#e8eaed';};
  navBtn.onmouseout=function(){navBtn.style.background=document.getElementById('gcn-bookmark-panel')?'#e8eaed':'#f1f3f4';};
  var group=document.getElementById('gcn-nav-group');
  var searchBar=document.getElementById('gcn-search-bar');
  if(group&&searchBar){group.insertBefore(navBtn,searchBar);}else if(group){group.appendChild(navBtn);}else{document.body.appendChild(navBtn);}
  navBtn.onclick=function(e){
    e.stopPropagation();
    var existing=document.getElementById('gcn-bookmark-panel');
    if(existing){existing.remove();navBtn.style.background='#f1f3f4';return;}
    openBookmarkDropdown(classId,navBtn); navBtn.style.background='#e8eaed';
  };
  refreshNavCount(classId);
}

function refreshNavCount(classId) {
  getAllBookmarks(classId,function(bookmarks){
    var badge=document.getElementById('gcn-bm-nav-count'); if(!badge)return;
    if(bookmarks.length>0){badge.textContent=bookmarks.length;badge.style.display='inline-block';}
    else{badge.style.display='none';}
  });
}

function openBookmarkDropdown(classId,anchorBtn) {
  var existing=document.getElementById('gcn-bookmark-panel'); if(existing)existing.remove();
  var panel=document.createElement('div'); panel.id='gcn-bookmark-panel'; panel.setAttribute('data-class-id',classId);
  panel.style.cssText='position:fixed;top:58px;right:16px;width:340px;max-height:480px;display:flex;flex-direction:column;background:#fff;border:1px solid #dadce0;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,0.18);z-index:99998;font-family:"Google Sans",Roboto,Arial,sans-serif;overflow:hidden;animation:gcn-dropdown 0.18s ease;';
  var hdr=document.createElement('div'); hdr.style.cssText='display:flex;align-items:center;justify-content:space-between;padding:14px 16px 10px;border-bottom:1px solid #f1f3f4;flex-shrink:0;';
  var htitle=document.createElement('span'); htitle.style.cssText='font-size:15px;font-weight:700;color:#202124;'; htitle.textContent='🔖 My Bookmarks';
  var bdg=document.createElement('span'); bdg.id='gcn-count-badge'; bdg.style.cssText='background:#1a73e8;color:#fff;border-radius:10px;font-size:11px;padding:2px 9px;font-weight:700;margin-left:8px;'; bdg.textContent='0';
  var closeX=document.createElement('button'); closeX.textContent='✕'; closeX.style.cssText='background:none;border:none;font-size:16px;color:#9aa0a6;cursor:pointer;padding:2px 6px;margin-left:auto;border-radius:50%;';
  closeX.onclick=function(){panel.remove();anchorBtn.style.background='#f1f3f4';};
  var left=document.createElement('div'); left.style.cssText='display:flex;align-items:center;'; left.appendChild(htitle); left.appendChild(bdg);
  hdr.appendChild(left); hdr.appendChild(closeX); panel.appendChild(hdr);
  var fr=document.createElement('div'); fr.style.cssText='display:flex;gap:6px;padding:10px 16px;border-bottom:1px solid #f1f3f4;flex-shrink:0;';
  var af='all';
  var ld=document.createElement('div'); ld.id='gcn-bookmark-list'; ld.style.cssText='flex:1;overflow-y:auto;padding:4px 0;';
  [['all','All'],['stream','💬 Stream'],['assignment','📝 Classwork']].forEach(function(f){
    var fb=document.createElement('button'); fb.textContent=f[1]; fb.setAttribute('data-filter',f[0]); if(f[0]==='all')fb.setAttribute('data-filter-active','true');
    fb.style.cssText='padding:5px 14px;border:1.5px solid '+(f[0]==='all'?'#1a73e8':'#dadce0')+';border-radius:20px;font-size:12px;cursor:pointer;font-weight:600;background:'+(f[0]==='all'?'#1a73e8':'#fff')+';color:'+(f[0]==='all'?'#fff':'#5f6368')+';transition:all 0.15s;';
    fb.onclick=function(){
      af=f[0]; fr.querySelectorAll('button').forEach(function(b){b.style.background='#fff';b.style.color='#5f6368';b.style.borderColor='#dadce0';b.removeAttribute('data-filter-active');});
      fb.style.background='#1a73e8';fb.style.color='#fff';fb.style.borderColor='#1a73e8';fb.setAttribute('data-filter-active','true');
      loadBookmarkList(ld,af,bdg,classId);
    };
    fr.appendChild(fb);
  });
  panel.appendChild(fr); panel.appendChild(ld);
  document.body.appendChild(panel);
  loadBookmarkList(ld,'all',bdg,classId);
  setTimeout(function(){
    document.addEventListener('click',function outsideClick(e){
      if(!panel.contains(e.target)&&e.target!==anchorBtn&&!anchorBtn.contains(e.target)){
        panel.remove(); anchorBtn.style.background='#f1f3f4';
        document.removeEventListener('click',outsideClick);
      }
    });
  },100);
}

function scrollUntilFound(targetUrl,fullText){
  var scroller=getStreamScroller(); var ticks=0; var fakeB={url:targetUrl,fullText:fullText||''};
  var iv=setInterval(function(){
    ticks++;
    var el=findElementInDom(fakeB);
    if(el){clearInterval(iv);highlightAndScroll(el);return;}
    scroller=getStreamScroller(); scroller.scrollTop=scroller.scrollHeight+99999;
    if(ticks>=150)clearInterval(iv);
  },150);
}

function highlightAndScroll(el){
  el.style.outline='3px solid #1a73e8'; el.style.boxShadow='0 0 0 5px rgba(26,115,232,0.3)';
  el.scrollIntoView({behavior:'smooth',block:'center'});
  setTimeout(function(){el.style.outline='';el.style.boxShadow='';},3000);
}

function findElementInDom(b){
  var targetUrl=fixUrl(b.url); var hasSpecificUrl=targetUrl.includes('/p/');
  var fullText=(b.fullText||b.title||'').trim().toLowerCase(); var found=null;
  document.querySelectorAll('.n4xnA,.cQMaT,.RNmOtb,.asQXV,.zR38ld').forEach(function(el){
    if(found)return;
    el.querySelectorAll('a[href]').forEach(function(a){if(!found&&a.href&&fixUrl(a.href)===targetUrl)found=el;});
    if(!found&&!hasSpecificUrl&&fullText.length>20){
      var elText=(el.innerText||'').trim().toLowerCase();
      if(fullText.length>=30&&elText.includes(fullText.substring(0,60)))found=el;
    }
  });
  return found;
}

function loadBookmarkList(container,filter,badge,classId){
  getAllBookmarks(classId,function(bookmarks){
    var filtered=filter==='all'?bookmarks:bookmarks.filter(function(b){return b.type===filter;});
    if(badge)badge.textContent=String(filtered.length);
    container.innerHTML='';
    if(filtered.length===0){
      var e=document.createElement('div'); e.style.cssText='text-align:center;padding:16px 0;';
      e.innerHTML='<div style="font-size:28px">🔖</div><p style="font-size:12px;color:#9aa0a6;margin:6px 0">No bookmarks yet.<br>Click 🔖 on any post to save.</p>';
      container.appendChild(e); return;
    }
    filtered.forEach(function(b){
      var item=document.createElement('div'); item.style.cssText='padding:8px 4px;border-bottom:1px solid #f1f3f4;position:relative;';
      var tb=document.createElement('span'); tb.textContent=b.type==='stream'?'💬 Stream':'📝 Classwork';
      tb.style.cssText='font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;display:inline-block;margin-bottom:4px;background:'+(b.type==='stream'?'#e8f0fe;color:#1a73e8;':'#fef7e0;color:#f29900;');
      var del=document.createElement('button'); del.textContent='✕'; del.style.cssText='position:absolute;top:6px;right:0;background:#fce8e6;border:none;color:#d93025;cursor:pointer;font-size:11px;border-radius:50%;width:20px;height:20px;padding:0;';
      del.onclick=function(){deleteBookmark(b.id);};
      var te=document.createElement('div'); te.textContent=b.title; te.style.cssText='color:#202124;font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:24px;margin-bottom:4px;'; te.title=b.title;
      var br=document.createElement('div'); br.style.cssText='display:flex;align-items:center;justify-content:space-between;margin-top:4px;';
      var dt=document.createElement('span'); dt.textContent=b.date?'🗓 '+b.date:''; dt.style.cssText='font-size:10px;color:#9aa0a6;';
      var gb=document.createElement('button'); gb.textContent='↗ Go to post'; gb.style.cssText='font-size:11px;color:#fff;background:#1a73e8;border:none;padding:3px 10px;border-radius:8px;cursor:pointer;font-weight:600;';
      gb.onclick=function(e){
        e.preventDefault(); e.stopPropagation();
        var targetUrl=fixUrl(b.url); var fakeB={url:targetUrl,fullText:b.fullText||b.title||''};
        var found=findElementInDom(fakeB);
        if(found){highlightAndScroll(found);return;}
        gb.textContent='⏳ Loading...'; gb.disabled=true;
        var waited=0;
        var waitIv=setInterval(function(){
          waited+=200;
          var el=findElementInDom(fakeB);
          if(el){clearInterval(waitIv);gb.textContent='↗ Go to post';gb.disabled=false;highlightAndScroll(el);return;}
          var store=postStore[currentClassId];
          if(store&&store.complete){clearInterval(waitIv);gb.textContent='↗ Go to post';gb.disabled=false;scrollUntilFound(targetUrl,b.fullText||b.title||'');return;}
          if(waited>30000){clearInterval(waitIv);gb.textContent='↗ Go to post';gb.disabled=false;}
        },200);
      };
      br.appendChild(dt); br.appendChild(gb);
      item.appendChild(del); item.appendChild(tb); item.appendChild(te); item.appendChild(br);
      container.appendChild(item);
    });
  });
}

function refreshBookmarkPanel(){
  var classId=currentClassId;
  var panel=document.getElementById('gcn-bookmark-panel');
  if(panel&&panel.getAttribute('data-class-id')!==classId){panel.remove();panel=null;}
  if(panel){
    var ld=document.getElementById('gcn-bookmark-list'); var bdg=document.getElementById('gcn-count-badge');
    if(ld){var af='all';var ab=panel.querySelector('button[data-filter-active="true"]');if(ab)af=ab.getAttribute('data-filter')||'all';loadBookmarkList(ld,af,bdg,classId);}
  }
  refreshNavCount(classId);
}

// ─── URL CHANGE ───────────────────────────────────────────────────────────────
function checkUrlChange() {
  var current=window.location.href; if(current===lastUrl)return;
  var oldClassId=getClassIdFromUrl(lastUrl); var newClassId=getClassIdFromUrl(current);
  if(oldClassId&&newClassId&&oldClassId!==newClassId){
    var inp=document.getElementById('gcn-search-input');
    if(inp&&inp.value.trim()){sessionStorage.setItem('gcn_pending_query',inp.value.trim());sessionStorage.setItem('gcn_pending_filter',document.getElementById('gcn-filter')?document.getElementById('gcn-filter').value:'all');}
    window.location.href=current; return;
  }
  lastUrl=current; currentClassId=newClassId||currentClassId; flushAll(currentClassId);
  ['gcn-bookmark-panel','gcn-api-results','gcn-search-bar','gcn-bm-nav-btn'].forEach(function(id){var el=document.getElementById(id);if(el)el.remove();});
}

// ─── MAIN LOOP ────────────────────────────────────────────────────────────────
function main() {
  try {
    checkUrlChange();
    injectDarkToggle();
    if(!currentClassId)return;
    injectSearchBar(); injectBookmarkPanel(); injectStreamBookmarkButtons(); injectAssignmentBookmarkButtons();
    if(!postStore[currentClassId]||!postStore[currentClassId].complete){
      if(!postStore[currentClassId])postStore[currentClassId]={posts:[],complete:false};
      startScroll(currentClassId);
    }
  } catch(e){console.warn('[GCN]',e);}
}

function onReady() {
  currentClassId=getClassIdFromUrl(window.location.href); lastUrl=window.location.href;
  initDarkMode();
  var _push=history.pushState.bind(history); var _rep=history.replaceState.bind(history);
  history.pushState=function(){_push.apply(history,arguments);setTimeout(checkUrlChange,100);};
  history.replaceState=function(){_rep.apply(history,arguments);setTimeout(checkUrlChange,100);};
  window.addEventListener('popstate',function(){setTimeout(checkUrlChange,100);});
  try{chrome.runtime.sendMessage({type:'CLEAR_ALL_POST_CACHES'},function(){});}catch(e){}
  setTimeout(function(){
    var q=sessionStorage.getItem('gcn_pending_query'); var f=sessionStorage.getItem('gcn_pending_filter')||'all';
    if(q){
      sessionStorage.removeItem('gcn_pending_query'); sessionStorage.removeItem('gcn_pending_filter');
      var inp=document.getElementById('gcn-search-input'); var sel=document.getElementById('gcn-filter');
      if(inp){inp.value=q;inp.style.width='240px';inp.style.background='#fff';inp.style.color='#202124';if(sel)sel.value=f;var clr=document.getElementById('gcn-clear-btn');if(clr)clr.style.display='inline-block';doSearch(q,f);}
    }
    var scrollUrl=sessionStorage.getItem('gcn_scroll_url'); var scrollText=sessionStorage.getItem('gcn_scroll_text')||'';
    if(scrollUrl){
      sessionStorage.removeItem('gcn_scroll_url'); sessionStorage.removeItem('gcn_scroll_text');
      var fakeB={url:scrollUrl,fullText:scrollText}; var el=findElementInDom(fakeB);
      if(el){highlightAndScroll(el);}else{scrollUntilFound(scrollUrl,scrollText);}
    }
  },2000);
  setInterval(main,2500); main();
}

if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',function(){setTimeout(onReady,1500);});}
else{setTimeout(onReady,1500);}