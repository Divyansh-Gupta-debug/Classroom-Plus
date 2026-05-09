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

// ─── LOCAL SEMANTIC SEARCH ENGINE ─────────────────────────────────────────────
// Client-side search with: stemming, synonym expansion, TF-IDF ranking,
// proximity scoring, fuzzy matching, n-gram overlap. No API needed.

// ── PORTER STEMMER (simplified for academic English) ──────────────────────────
var STEM_CACHE = {};
function stem(word) {
  if (!word || word.length < 3) return word;
  if (STEM_CACHE[word]) return STEM_CACHE[word];
  var w = word.toLowerCase();
  // Step 1: plurals and past tenses
  if (w.endsWith('ies') && w.length > 4) w = w.slice(0, -3) + 'y';
  else if (w.endsWith('sses')) w = w.slice(0, -2);
  else if (w.endsWith('ness')) w = w.slice(0, -4);
  else if (w.endsWith('ment') && w.length > 5) w = w.slice(0, -4);
  else if (w.endsWith('ing') && w.length > 5) {
    w = w.slice(0, -3);
    if (w.endsWith('t') && w.endsWith('tt')) w = w.slice(0, -1);
  }
  else if (w.endsWith('tion')) w = w.slice(0, -4) + 't';
  else if (w.endsWith('sion')) w = w.slice(0, -4) + 'd';
  else if (w.endsWith('ation') && w.length > 6) w = w.slice(0, -5) + 'e';
  else if (w.endsWith('ated') && w.length > 5) w = w.slice(0, -1);
  else if (w.endsWith('ment') && w.length > 5) w = w.slice(0, -4);
  else if (w.endsWith('ness') && w.length > 5) w = w.slice(0, -4);
  else if (w.endsWith('able') && w.length > 5) w = w.slice(0, -4);
  else if (w.endsWith('ible') && w.length > 5) w = w.slice(0, -4);
  else if (w.endsWith('ally') && w.length > 5) w = w.slice(0, -4);
  else if (w.endsWith('ful')) w = w.slice(0, -3);
  else if (w.endsWith('ous') && w.length > 4) w = w.slice(0, -3);
  else if (w.endsWith('ive') && w.length > 4) w = w.slice(0, -3);
  else if (w.endsWith('ed') && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('ly') && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('er') && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('es') && w.length > 3) w = w.slice(0, -2);
  else if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) w = w.slice(0, -1);
  STEM_CACHE[word] = w;
  return w;
}

// ── STOP WORDS (skip these in scoring) ────────────────────────────────────────
var STOP_WORDS = {};
'a an the is are was were be been being have has had do does did will would shall should may might can could and but or nor for yet so at by from in into of on to with as if then than that this these those it its he she they we you i me my our your his her them'.split(' ').forEach(function(w) { STOP_WORDS[w] = true; });

// ── SYNONYM MAP (expanded academic vocabulary) ───────────────────────────────
var SYNONYM_GROUPS = [
  // Grades & evaluation
  ['grade','grades','mark','marks','score','scores','points','gpa','cgpa','sgpa','result','results','obtained','grading','graded','rubric','evaluation','evaluated','performance','percentile','percentage','percent'],
  // Exams
  ['exam','exams','examination','examinations','test','tests','quiz','quizzes','viva','assessment','assessments','evaluation','paper','papers','mid','midterm','midsem','mid-sem','final','finals','endsem','end-sem','end sem','terminal','prelim','prelims','re-exam','reexam','backlog','supplementary','supp'],
  // Assignments & homework
  ['assignment','assignments','homework','hw','submission','submissions','submit','submitted','submitting','task','tasks','deliverable','deliverables','exercise','exercises','problem set','pset','worksheet','lab report','lab'],
  // Deadlines
  ['deadline','deadlines','due date','due','last date','cutoff','cut-off','closing date','submission date','extended','extension','late submission','penalty'],
  // Lectures & classes
  ['lecture','lectures','lec','lect','class','classes','session','sessions','tutorial','tutorials','tut','seminar','seminars','workshop','workshops','lab','labs','practical','practicals'],
  // Notes & materials
  ['notes','note','material','materials','slides','slide','handout','handouts','resource','resources','reference','references','reading','readings','textbook','book','books','pdf','ppt','doc','chapter','unit','module','syllabus','curriculum'],
  // Cancellation & schedule changes
  ['cancel','cancelled','canceled','cancellation','postpone','postponed','postponement','reschedule','rescheduled','rescheduling','defer','deferred','off','holiday','no class','suspended','delay','delayed'],
  // Meetings & communication
  ['meeting','meetings','meet','zoom','google meet','teams','call','conference','webinar','office hours','consultation','discussion','doubt session','doubt clearing'],
  // Questions & help
  ['doubt','doubts','question','questions','query','queries','clarification','help','issue','issues','problem','problems','confusion','stuck','error','bug','fix'],
  // Projects & reports
  ['project','projects','report','reports','implementation','demo','demonstration','presentation','presentations','thesis','dissertation','research','paper','poster','prototype','capstone','mini project','major project'],
  // Files & documents
  ['pdf','file','files','document','documents','doc','docx','attachment','attachments','ppt','pptx','xlsx','spreadsheet','csv','zip','upload','uploaded','download','shared'],
  // Videos & recordings
  ['video','videos','recording','recordings','record','recorded','watch','youtube','lecture recording','replay','stream','live','webcast','tutorial video'],
  // Groups & teams
  ['group','groups','team','teams','pair','partner','partners','member','members','teammate','teammates','collaboration','collaborative','group project','team project'],
  // Website & links
  ['website','websites','site','sites','link','links','url','urls','webpage','web page','portal','online','platform','login','access','dashboard'],
  // Attendance
  ['attendance','absent','absent','present','proxy','roll call','roll number','register','registered','enrollment','enrolled'],
  // Fees & payments
  ['fee','fees','payment','paid','pay','scholarship','stipend','financial','reimbursement','refund'],
  // Schedule & timetable
  ['schedule','timetable','time table','calendar','planner','slot','slots','timing','timings','weekday','weekend','morning','afternoon','evening'],
  // Faculty & staff
  ['professor','prof','teacher','instructor','faculty','sir','maam','madam','dr','ta','teaching assistant','mentor','advisor','coordinator','hod','dean'],
  // Results & outcomes
  ['pass','passed','fail','failed','clear','cleared','qualify','qualified','eligible','eligibility','criteria','requirement','requirements','prerequisite','prerequisites'],
  // Communication
  ['email','mail','message','notification','notice','announcement','announcements','circular','memo','update','updates','reminder','alert','info','information'],
  // Programming & CS
  ['code','coding','program','programming','algorithm','data structure','database','sql','python','java','javascript','cpp','c++','html','css','api','git','github','repository','repo','debug','compile','runtime','syntax'],
  // Lab & practical
  ['lab','laboratory','experiment','practical','viva','observation','procedure','apparatus','setup','simulation','demo'],
  // Placements & career
  ['placement','placements','internship','internships','job','jobs','career','company','companies','recruit','recruitment','interview','interviews','resume','cv','offer','package','ctc','stipend'],
  // Semester & academic terms
  ['semester','sem','term','quarter','year','academic year','session','batch','section','division','branch','department','dept','course','courses','subject','subjects','elective','electives','minor','major','credit','credits','cgpa','sgpa'],
  // Important / urgent
  ['important','urgent','mandatory','compulsory','required','optional','necessary','must','critical','essential','priority','asap','immediately','compulsory'],
];

// Build a fast lookup: word → list of synonym words
var SYNONYM_LOOKUP = {};
SYNONYM_GROUPS.forEach(function(group) {
  group.forEach(function(term) {
    var key = term.toLowerCase();
    if (!SYNONYM_LOOKUP[key]) SYNONYM_LOOKUP[key] = [];
    group.forEach(function(syn) {
      if (syn !== term) SYNONYM_LOOKUP[key].push(syn.toLowerCase());
    });
  });
});

// ── ACRONYM EXPANSION ─────────────────────────────────────────────────────────
var ACRONYMS = {
  'ml': ['machine learning'], 'ai': ['artificial intelligence'], 'dl': ['deep learning'],
  'nn': ['neural network','neural networks'], 'cnn': ['convolutional neural network'],
  'rnn': ['recurrent neural network'], 'nlp': ['natural language processing'],
  'cv': ['computer vision','curriculum vitae'], 'os': ['operating system','operating systems'],
  'dbms': ['database management system'], 'dsa': ['data structures and algorithms','data structure'],
  'oop': ['object oriented programming'], 'oops': ['object oriented programming'],
  'cn': ['computer networks','computer network'], 'se': ['software engineering'],
  'hci': ['human computer interaction'], 'iot': ['internet of things'],
  'aws': ['amazon web services'], 'gcp': ['google cloud platform'],
  'ui': ['user interface'], 'ux': ['user experience'],
  'qa': ['quality assurance','question answer'], 'ci': ['continuous integration'],
  'cd': ['continuous deployment','continuous delivery'],
  'api': ['application programming interface'],
  'sdk': ['software development kit'], 'ide': ['integrated development environment'],
  'vcs': ['version control system'], 'orm': ['object relational mapping'],
  'rest': ['representational state transfer'], 'http': ['hypertext transfer protocol'],
  'tcp': ['transmission control protocol'], 'ip': ['internet protocol'],
  'dns': ['domain name system'], 'ssh': ['secure shell'],
  'hw': ['homework','hardware'], 'sw': ['software'],
  'ta': ['teaching assistant'], 'ra': ['research assistant'],
  'phd': ['doctorate','doctoral'], 'mtech': ['masters','master of technology'],
  'btech': ['bachelors','bachelor of technology'],
  'ppt': ['powerpoint','presentation'], 'doc': ['document','word'],
  'lec': ['lecture'], 'tut': ['tutorial'],
};

// ── TOKENIZER ─────────────────────────────────────────────────────────────────
function tokenize(text) {
  if (!text) return [];
  return text.toLowerCase()
    .replace(/[-_\/\\]/g, ' ')       // normalize separators
    .replace(/[^a-z0-9\s]/g, ' ')    // remove punctuation
    .split(/\s+/)
    .filter(function(w) { return w.length >= 2; });
}

function tokenizeWithStems(text) {
  var tokens = tokenize(text);
  var result = [];
  tokens.forEach(function(t) {
    result.push(t);
    var s = stem(t);
    if (s !== t) result.push(s);
  });
  return result;
}

// ── TF-IDF ENGINE ─────────────────────────────────────────────────────────────
// Tracks document frequency across all posts for IDF weighting
var idfCache = {};
var idfTotalDocs = 0;

function buildIdfIndex(posts) {
  var df = {};  // document frequency: how many posts contain each term
  var n = posts.length;
  posts.forEach(function(p) {
    var seen = {};
    var tokens = tokenize(p.text || '');
    tokens.forEach(function(t) {
      var s = stem(t);
      if (!seen[s]) { df[s] = (df[s] || 0) + 1; seen[s] = true; }
      if (!seen[t]) { df[t] = (df[t] || 0) + 1; seen[t] = true; }
    });
  });
  idfCache = df;
  idfTotalDocs = n;
}

function idf(term) {
  var docFreq = idfCache[term] || idfCache[stem(term)] || 0;
  if (docFreq === 0) return 1;
  return Math.log(1 + idfTotalDocs / docFreq);
}

// ── SCORING ENGINE ────────────────────────────────────────────────────────────
// Scores a post against a query. Returns { score, matchType, matchedTerms }
function scorePost(post, query) {
  var text = (post.text || '').toLowerCase();
  var q = query.toLowerCase().trim();
  if (!text || !q) return { score: 0, matchType: 'none', matchedTerms: [] };

  var score = 0;
  var matchType = 'none';
  var matchedTerms = [];

  // Normalize text variants
  var textNorm = text.replace(/[-_]/g, ' ');
  var textCompact = text.replace(/[-_\s]/g, '');
  var qNorm = q.replace(/[-_]/g, ' ');
  var qCompact = q.replace(/[-_\s]/g, '');

  // ── Signal 1: EXACT PHRASE MATCH (highest weight) ──────────────────────
  if (text.includes(q)) {
    score += 100;
    matchType = 'exact';
    matchedTerms.push(q);
  } else if (textNorm.includes(qNorm)) {
    score += 90;
    matchType = 'exact';
    matchedTerms.push(q);
  } else if (textCompact.includes(qCompact)) {
    score += 85;
    matchType = 'exact';
    matchedTerms.push(q);
  }

  // ── Signal 2: ALL QUERY WORDS PRESENT (AND match) ─────────────────────
  var qWords = q.split(/\s+/).filter(function(w) { return w.length >= 2 && !STOP_WORDS[w]; });
  var qStems = qWords.map(function(w) { return stem(w); });
  var textTokens = tokenize(text);
  var textStems = textTokens.map(function(t) { return stem(t); });
  var textStemSet = {};
  textStems.forEach(function(s) { textStemSet[s] = true; });
  textTokens.forEach(function(t) { textStemSet[t] = true; });

  if (qWords.length > 1 && matchType !== 'exact') {
    var allPresent = qStems.every(function(qs) { return textStemSet[qs]; });
    if (allPresent) {
      score += 70;
      matchType = matchType || 'all_words';
      matchedTerms = matchedTerms.concat(qWords);
    }
  }

  // ── Signal 3: STEM MATCHING with TF-IDF weighting ─────────────────────
  var stemScore = 0;
  var stemMatches = 0;
  qStems.forEach(function(qs) {
    if (textStemSet[qs]) {
      stemMatches++;
      stemScore += idf(qs) * 5; // rare words score higher
      if (matchedTerms.indexOf(qs) === -1) matchedTerms.push(qs);
    }
  });
  if (stemMatches > 0 && matchType === 'none') matchType = 'stem';
  score += stemScore;

  // ── Signal 4: SYNONYM MATCHING ────────────────────────────────────────
  var synScore = 0;
  qWords.forEach(function(qw) {
    // Check direct synonym lookup
    var synonyms = SYNONYM_LOOKUP[qw] || [];
    // Also check stemmed form
    var stemmedSyns = SYNONYM_LOOKUP[stem(qw)] || [];
    var allSyns = synonyms.concat(stemmedSyns);

    // Check acronym expansions
    if (ACRONYMS[qw]) allSyns = allSyns.concat(ACRONYMS[qw]);

    allSyns.forEach(function(syn) {
      var synTokens = syn.split(/\s+/);
      // Multi-word synonym: check if all words present
      if (synTokens.length > 1) {
        var allFound = synTokens.every(function(st) {
          return textStemSet[st] || textStemSet[stem(st)];
        });
        if (allFound) {
          synScore += 40;
          if (matchedTerms.indexOf(syn) === -1) matchedTerms.push(syn);
        }
      } else {
        if (textStemSet[syn] || textStemSet[stem(syn)]) {
          synScore += 30;
          if (matchedTerms.indexOf(syn) === -1) matchedTerms.push(syn);
        }
      }
    });
  });
  if (synScore > 0 && matchType === 'none') matchType = 'synonym';
  score += synScore;

  // ── Signal 5: PROXIMITY SCORING (words near each other score higher) ──
  if (qWords.length > 1 && score > 0) {
    var positions = {};
    textTokens.forEach(function(t, idx) {
      var s = stem(t);
      qStems.forEach(function(qs) {
        if (t === qs || s === qs) {
          if (!positions[qs]) positions[qs] = [];
          positions[qs].push(idx);
        }
      });
    });
    var posKeys = Object.keys(positions);
    if (posKeys.length >= 2) {
      // Find minimum span containing one occurrence of each query term
      var minSpan = textTokens.length;
      posKeys.forEach(function(k1) {
        posKeys.forEach(function(k2) {
          if (k1 === k2) return;
          positions[k1].forEach(function(p1) {
            positions[k2].forEach(function(p2) {
              var span = Math.abs(p1 - p2);
              if (span < minSpan) minSpan = span;
            });
          });
        });
      });
      // Closer = higher bonus (max 20 points if adjacent)
      if (minSpan <= 30) {
        score += Math.max(0, 20 - minSpan);
      }
    }
  }

  // ── Signal 6: FUZZY / TYPO TOLERANCE ──────────────────────────────────
  if (score === 0 && qWords.length > 0) {
    var fuzzyScore = 0;
    qWords.forEach(function(qw) {
      if (qw.length < 3) return;
      // Check first 300 chars (title area) for fuzzy matches
      var titleTokens = tokenize(text.substring(0, 300));
      titleTokens.forEach(function(tw) {
        if (tw.length < 3) return;
        var sim = stringSimilarity(qw, tw);
        if (sim >= 0.78 && tw !== qw) {
          fuzzyScore += sim * 15;
          if (matchedTerms.indexOf(tw + '≈' + qw) === -1) matchedTerms.push(tw + '≈' + qw);
        }
      });
    });
    if (fuzzyScore > 0) matchType = 'fuzzy';
    score += fuzzyScore;
  }

  // ── Signal 7: N-GRAM OVERLAP (catches partial word matches) ───────────
  if (score === 0 && q.length >= 4) {
    var qGrams = getNgrams(q, 3);
    var tGrams = getNgrams(text.substring(0, 500), 3);
    var overlap = 0;
    qGrams.forEach(function(g) { if (tGrams.indexOf(g) !== -1) overlap++; });
    var ngramScore = (overlap / qGrams.length) * 20;
    if (ngramScore >= 10) {
      score += ngramScore;
      if (matchType === 'none') matchType = 'ngram';
    }
  }

  // ── Title boost: matches in first 80 chars score higher ───────────────
  if (score > 0) {
    var titleText = text.substring(0, 80);
    qWords.forEach(function(qw) {
      if (titleText.includes(qw) || titleText.includes(stem(qw))) {
        score += 15;
      }
    });
  }

  return { score: score, matchType: matchType, matchedTerms: matchedTerms };
}

function getNgrams(text, n) {
  var grams = [];
  var t = text.replace(/\s+/g, ' ');
  for (var i = 0; i <= t.length - n; i++) {
    grams.push(t.substring(i, i + n));
  }
  return grams;
}

// ── LEVENSHTEIN (kept from original) ──────────────────────────────────────────
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

// ── LEGACY COMPAT: semanticMatch (used by other parts of the code) ───────────
function semanticMatch(text, query) {
  if (!text || !query) return false;
  var result = scorePost({ text: text }, query);
  return result.score >= 10;
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
  var userScrolling = false;
  var scrollTimer = null;

  // Detect if user is manually scrolling
  function onUserScroll() { userScrolling = true; clearTimeout(scrollTimer); scrollTimer = setTimeout(function(){ userScrolling = false; }, 500); }
  window.addEventListener('wheel', onUserScroll, { passive: true });
  window.addEventListener('touchmove', onUserScroll, { passive: true });

  var iv = setInterval(function() {
    if (currentClassId !== classId) { clearInterval(iv); scrollingFor = null; cleanup(); return; }
    // Pause if user is scrolling
    if (userScrolling) return;
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
        if (currentClassId !== classId) { cleanup(); return; }
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
        cleanup();
        return;
      }
      scroller.scrollTop = scroller.scrollHeight + 99999;
      requestAnimationFrame(function() { scroller.scrollTop = userTop; });
      ticks++;
    } catch(e){ clearInterval(iv); scrollingFor=null; cleanup(); }
  }, 150);

  function cleanup() {
    window.removeEventListener('wheel', onUserScroll);
    window.removeEventListener('touchmove', onUserScroll);
  }
}

// ─── SEARCH ───────────────────────────────────────────────────────────────────
function doSearch(query, filter) {
  if (!query.trim()) return;
  var classId = currentClassId;
  if (!classId) { showToast('Open a class first'); return; }
  if (!postStore[classId]) postStore[classId] = { posts:[], complete:false };

  // Always collect what's visible on screen right now
  var visible = collectDomPosts(classId);
  var existing = postStore[classId].posts;
  var seenTexts = {};
  existing.forEach(function(p) {
    var k = (p.text||'').substring(0,50).toLowerCase();
    if (k.length > 10) seenTexts[k] = true;
  });
  visible.forEach(function(p) {
    var k = (p.text||'').substring(0,50).toLowerCase();
    if (k.length > 10 && !seenTexts[k]) { existing.push(p); seenTexts[k] = true; }
  });
  postStore[classId].posts = existing;

  // Show results immediately
  renderResults(query, filter, classId);

  // Fetch from API if not done yet
  if (!postStore[classId].complete && !postStore[classId].fetching) {
    postStore[classId].fetching = true;
    chrome.runtime.sendMessage({ type: 'FETCH_ALL_POSTS', classId: classId }, function(res) {
      postStore[classId].fetching = false;
      if (chrome.runtime.lastError || !res || currentClassId !== classId) return;

      var apiPosts = [];
      (res.announcements || []).forEach(function(a) {
        apiPosts.push({ classId:classId, text:(a.text||'').trim(), title:(a.text||'').substring(0,80), url:a.alternateLink||'', type:'stream', date:a.creationTime?new Date(a.creationTime).toLocaleDateString():'', element:null });
      });
      (res.coursework || []).forEach(function(cw) {
        apiPosts.push({ classId:classId, text:((cw.title||'')+' '+(cw.description||'')).trim(), title:(cw.title||'').substring(0,80), url:cw.alternateLink||'', type:'assignment', date:cw.creationTime?new Date(cw.creationTime).toLocaleDateString():'', element:null });
      });
      (res.materials || []).forEach(function(m) {
        apiPosts.push({ classId:classId, text:((m.title||'')+' '+(m.description||'')).trim(), title:(m.title||'').substring(0,80), url:m.alternateLink||'', type:'assignment', date:m.creationTime?new Date(m.creationTime).toLocaleDateString():'', element:null });
      });

      apiPosts.forEach(function(p) {
        var k = (p.text||'').substring(0,50).toLowerCase();
        if (k.length > 10 && !seenTexts[k]) { existing.push(p); seenTexts[k] = true; }
      });
      postStore[classId].posts = existing;
      postStore[classId].complete = true;

      var inp = document.getElementById('gcn-search-input');
      var fil = document.getElementById('gcn-filter');
      if (inp && inp.value.trim() && currentClassId === classId) {
        renderResults(inp.value.trim(), fil?fil.value:'all', classId);
      }
    });
  }
}

// Find a DOM element that matches the post text
function findElementByText(text) {
  if (!text || text.length < 10) return null;
  var snippet = text.substring(0, 50).toLowerCase();
  var found = null;
  document.querySelectorAll('.n4xnA,.cQMaT,.RNmOtb,.asQXV,.zR38ld').forEach(function(el) {
    if (found) return;
    if ((el.innerText || '').toLowerCase().includes(snippet)) found = el;
  });
  return found;
}

// Scroll down progressively to find a post, then highlight it
function scrollToPost(text, url, query) {
  var scroller = getStreamScroller();
  var searchSnippets = [];

  // Build multiple search strings to match against DOM
  if (text && text.length >= 15) searchSnippets.push(text.substring(0, 60).toLowerCase());
  if (text && text.length >= 30) searchSnippets.push(text.substring(0, 30).toLowerCase());
  if (url) {
    // Extract post ID from URL if possible
    var postIdMatch = url.match(/\/p\/([^/?#]+)/);
    if (postIdMatch) searchSnippets.push(postIdMatch[1]);
  }

  if (searchSnippets.length === 0) {
    window.location.href = fixUrl(url);
    return;
  }

  var ticks = 0;
  var scrollStep = 600; // pixels per step

  var iv = setInterval(function() {
    ticks++;

    // Check all post elements on page
    var found = null;
    document.querySelectorAll('.n4xnA,.cQMaT,.RNmOtb,.asQXV,.zR38ld').forEach(function(el) {
      if (found) return;
      var elText = (el.innerText || '').toLowerCase();
      for (var s = 0; s < searchSnippets.length; s++) {
        if (elText.includes(searchSnippets[s])) { found = el; return; }
      }
      // Also check href links inside the element
      if (url) {
        el.querySelectorAll('a[href]').forEach(function(a) {
          if (!found && a.href && fixUrl(a.href) === fixUrl(url)) found = el;
        });
      }
    });

    if (found) {
      clearInterval(iv);
      found.style.outline = '3px solid #1a73e8';
      found.style.boxShadow = '0 0 0 5px rgba(26,115,232,0.3)';
      found.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (query) highlightKeywordInElement(found, query);
      setTimeout(function() { found.style.outline = ''; found.style.boxShadow = ''; }, 5000);
      return;
    }

    // Give up after ~30 seconds or if we've reached the bottom
    if (ticks > 150 || (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 50)) {
      clearInterval(iv);
      // Fallback: navigate to the post URL
      if (url) window.location.href = fixUrl(url);
      return;
    }

    // Scroll down one step
    scroller.scrollBy({ top: scrollStep, behavior: 'auto' });
  }, 200);
}

// ─── HIGHLIGHT KEYWORD IN DOM ELEMENT ─────────────────────────────────────────
function highlightKeywordInElement(el, query) {
  var q = query.toLowerCase().trim();
  if (!q) return;
  var marks = [];
  var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
  var textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  textNodes.forEach(function(node) {
    var text = node.nodeValue;
    var idx = text.toLowerCase().indexOf(q);
    if (idx === -1) return;
    var parent = node.parentNode;
    if (!parent) return;
    var frag = document.createDocumentFragment();
    if (idx > 0) frag.appendChild(document.createTextNode(text.substring(0, idx)));
    var mark = document.createElement('mark');
    mark.className = 'gcn-highlight';
    mark.style.cssText = 'background:#fff176;color:#202124;border-radius:3px;padding:1px 3px;box-shadow:0 0 0 2px #fff176;';
    mark.textContent = text.substring(idx, idx + q.length);
    frag.appendChild(mark);
    marks.push(mark);
    if (idx + q.length < text.length) frag.appendChild(document.createTextNode(text.substring(idx + q.length)));
    parent.replaceChild(frag, node);
  });

  if (marks.length > 0) marks[0].scrollIntoView({ behavior: 'smooth', block: 'center' });

  setTimeout(function() {
    marks.forEach(function(m) {
      if (m.parentNode) m.parentNode.replaceChild(document.createTextNode(m.textContent), m);
    });
    el.normalize();
  }, 6000);
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

  var titleEl = document.createElement('div');
  titleEl.textContent = (r.title||r.text||'').substring(0,120);
  titleEl.style.cssText = 'font-size:13px;font-weight:600;color:#202124;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:4px;';
  titleEl.title = r.title||r.text||'';

  var snippetEl = document.createElement('div');
  snippetEl.style.cssText = 'font-size:12px;color:#5f6368;line-height:1.5;margin-bottom:7px;word-break:break-word;';
  snippetEl.innerHTML = getSnippet(r.text || '', query);

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
    window.open(fixUrl(r.url), '_blank');
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

  // Build IDF index for TF-IDF scoring
  buildIdfIndex(posts);

  // Score every post
  var scored = [];
  var seen = {};
  posts.forEach(function(p) {
    if (p.classId !== classId) return;
    if (filter !== 'all' && p.type !== filter) return;
    var key = (p.text || '').substring(0, 80) + '|' + p.type;
    if (seen[key]) return;
    seen[key] = true;
    var result = scorePost(p, query);
    if (result.score >= 10) {
      scored.push({ post: p, score: result.score, matchType: result.matchType, matchedTerms: result.matchedTerms });
    }
  });

  // Sort by score descending
  scored.sort(function(a, b) { return b.score - a.score; });

  // Split into exact matches (score >= 70) and smart matches (score < 70)
  var exactResults = scored.filter(function(s) { return s.score >= 70; });
  var smartResults = scored.filter(function(s) { return s.score < 70 && s.score >= 10; });

  var totalResults = scored.length;

  var old = document.getElementById('gcn-api-results'); if (old) old.remove();
  var panel = document.createElement('div');
  panel.id = 'gcn-api-results';
  panel.setAttribute('data-class-id', classId);
  panel.style.cssText = 'position:fixed;top:56px;left:50%;transform:translateX(-50%);width:580px;max-width:95vw;max-height:75vh;overflow-y:auto;background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.2);z-index:99999;font-family:sans-serif;';

  var debug = document.createElement('div');
  debug.style.cssText = 'background:#f1f8e9;color:#388e3c;font-size:10px;padding:4px 14px;border-bottom:1px solid #c8e6c9;font-family:monospace;';
  debug.textContent = '🔍 Searching class: ' + classId + (complete ? ' ✓ complete' : ' … loading') + ' | ' + posts.length + ' posts indexed';
  panel.appendChild(debug);

  if (!complete) {
    var banner = document.createElement('div');
    banner.style.cssText = 'background:#e8f0fe;color:#1a73e8;font-size:11px;padding:6px 18px;border-bottom:1px solid #c5d8fb;display:flex;align-items:center;gap:8px;';
    banner.innerHTML = '<span style="display:inline-block;width:10px;height:10px;border:2px solid #1a73e8;border-top-color:transparent;border-radius:50%;animation:gcn-spin 0.6s linear infinite;"></span> Still loading older posts — results will update';
    panel.appendChild(banner);
  }

  var header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid #f1f3f4;position:sticky;top:0;background:#fff;border-radius:12px 12px 0 0;z-index:1;';
  var htitle = document.createElement('span');
  htitle.textContent = totalResults > 0 ? totalResults + ' result(s) for "' + query + '"' : 'No results for "' + query + '"';
  htitle.style.cssText = 'font-size:14px;font-weight:600;color:#202124;';
  var closeBtn = document.createElement('button');
  closeBtn.textContent = '✕'; closeBtn.style.cssText = 'background:#f1f3f4;border:none;border-radius:50%;width:28px;height:28px;cursor:pointer;font-size:13px;color:#5f6368;';
  closeBtn.onclick = function() { panel.remove(); };
  header.appendChild(htitle); header.appendChild(closeBtn); panel.appendChild(header);

  if (totalResults === 0) {
    var empty = document.createElement('div');
    empty.style.cssText = 'text-align:center;padding:40px 20px;color:#9aa0a6;font-size:13px;';
    empty.innerHTML = '<div style="font-size:36px;margin-bottom:10px">🔍</div>Try different keywords or synonyms.';
    var deepSuggest = document.createElement('button');
    deepSuggest.textContent = '📄 Try Deep Search';
    deepSuggest.style.cssText = 'margin-top:12px;padding:8px 18px;background:#ede9fe;color:#6d28d9;border:1.5px solid #6d28d9;border-radius:20px;font-size:12px;cursor:pointer;font-weight:600;';
    deepSuggest.onclick = function() {
      panel.remove();
      var toggle = document.getElementById('gcn-deep-search-toggle');
      if (toggle && !toggle.checked) { toggle.checked = true; toggle.dispatchEvent(new Event('change')); }
      else { doDeepSearch(query); }
    };
    empty.appendChild(document.createElement('br'));
    empty.appendChild(deepSuggest);
    panel.appendChild(empty);
  } else {
    // Render exact matches
    if (exactResults.length > 0) {
      exactResults.forEach(function(s, i) {
        panel.appendChild(buildResultItem(s.post, i, query, classId, panel, false));
      });
    }

    // Render smart matches with divider
    if (smartResults.length > 0) {
      var divider = document.createElement('div');
      divider.style.cssText = 'padding:10px 18px 4px;background:#e8f5e9;border-top:2px solid #66bb6a;border-bottom:1px solid #a5d6a7;display:flex;align-items:center;gap:8px;';
      var matchLabels = [];
      smartResults.forEach(function(s) {
        s.matchedTerms.forEach(function(t) {
          if (matchLabels.indexOf(t) === -1 && matchLabels.length < 5) matchLabels.push(t);
        });
      });
      divider.innerHTML = '<span style="font-size:13px;">🧠</span><span style="font-size:12px;font-weight:600;color:#2e7d32;">' +
        smartResults.length + ' smart result' + (smartResults.length > 1 ? 's' : '') +
        (matchLabels.length > 0 ? ' — matched: "' + matchLabels.join('", "') + '"' : '') + '</span>';
      panel.appendChild(divider);

      smartResults.forEach(function(s, i) {
        var matchLabel = s.matchType;
        if (s.matchType === 'synonym') matchLabel = s.matchedTerms[0] || 'synonym';
        else if (s.matchType === 'stem') matchLabel = 'stem: ' + (s.matchedTerms[0] || '');
        else if (s.matchType === 'fuzzy') matchLabel = 'typo fix';
        var item = buildResultItem(s.post, exactResults.length + i, query, classId, panel, true);
        // Update the smart badge text
        var smartBadge = item.querySelector('span[style*="fef3c7"]');
        if (smartBadge) {
          smartBadge.textContent = '🧠 ' + matchLabel;
          smartBadge.style.cssText = 'font-size:10px;padding:2px 8px;border-radius:8px;font-weight:600;background:#e8f5e9;color:#2e7d32;';
        }
        item.style.background = '#f0faf0';
        item.onmouseover = function() { item.style.background = '#e8f5e9'; };
        item.onmouseout = function() { item.style.background = '#f0faf0'; };
        panel.appendChild(item);
      });
    }
  }

  var footer = document.createElement('div');
  footer.style.cssText = 'padding:14px 18px;border-top:1px solid #f1f3f4;text-align:center;';
  var engineInfo = exactResults.length + ' exact';
  if (smartResults.length > 0) engineInfo += ' + ' + smartResults.length + ' smart (synonyms, stems, fuzzy)';
  footer.innerHTML = '<span style="font-size:11px;color:#9aa0a6;">🧠 Semantic search: ' + engineInfo + ' | No API needed</span>';
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
  showToast('📄 Deep searching inside PDFs...');

  try {
    chrome.runtime.sendMessage({
      type: 'DEEP_SEARCH',
      classId: classId,
      query: query.trim()
    }, function(res) {
      deepSearchInProgress = false;

      if (chrome.runtime.lastError) {
        showToast('❌ Error: ' + chrome.runtime.lastError.message);
        return;
      }
      if (!res) { showToast('❌ No response from background'); return; }
      if (res.error) { showToast('❌ ' + res.error); return; }

      renderDeepSearchResults(query, classId, res);
    });
  } catch(e) {
    deepSearchInProgress = false;
    showToast('❌ ' + e.message);
  }
}

function renderDeepSearchResults(query, classId, response) {
  var results = response.results || [];
  var totalFiles = response.totalFiles || 0;
  var debugLog = response.debug || [];

  if (debugLog.length > 0) {
    console.log('%c[GC Deep Search Debug]', 'color:#6d28d9;font-weight:bold;');
    debugLog.forEach(function(line) { console.log('  ' + line); });
  }

  var old = document.getElementById('gcn-api-results'); if (old) old.remove();
  var panel = document.createElement('div');
  panel.id = 'gcn-api-results';
  panel.setAttribute('data-class-id', classId);
  panel.style.cssText = 'position:fixed;top:56px;left:50%;transform:translateX(-50%);width:620px;max-width:95vw;max-height:80vh;overflow-y:auto;background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.2);z-index:99999;font-family:sans-serif;';

  var info = document.createElement('div');
  info.style.cssText = 'background:#ede9fe;color:#6d28d9;font-size:11px;padding:6px 18px;border-bottom:1px solid #ddd6fe;display:flex;align-items:center;gap:8px;border-radius:12px 12px 0 0;';
  info.innerHTML = '<span style="font-size:14px;">📄</span> Deep Search — scanned <b>' + totalFiles + '</b> file(s) for "<b>' + query.replace(/</g,'&lt;') + '</b>"';
  panel.appendChild(info);

  var header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid #f1f3f4;position:sticky;top:0;background:#fff;z-index:1;';
  var htitle = document.createElement('span');
  htitle.textContent = results.length > 0 ? '📄 ' + results.length + ' match(es) found inside files' : '📄 No matches found inside files';
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
      'No matches found in ' + totalFiles + ' file(s).<br>' +
      '<span style="font-size:11px;color:#bdc1c6;">Searched PDFs, Docs, Slides attached to stream posts & assignments.</span>';
    panel.appendChild(empty);
  } else {
    results.forEach(function(r, i) {
      var item = document.createElement('div');
      item.style.cssText = 'padding:14px 18px;border-bottom:1px solid #f1f3f4;background:#faf5ff;transition:background 0.15s;';
      item.onmouseover = function() { item.style.background = '#f3e8ff'; };
      item.onmouseout  = function() { item.style.background = '#faf5ff'; };

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
      topRow.appendChild(typeBadge); topRow.appendChild(deepBadge); topRow.appendChild(num);

      var fileNameEl = document.createElement('div');
      fileNameEl.textContent = '📎 ' + r.fileName;
      fileNameEl.style.cssText = 'font-size:13px;font-weight:600;color:#202124;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

      var postTitleEl = document.createElement('div');
      postTitleEl.textContent = 'From: ' + (r.postTitle || 'Unknown post');
      postTitleEl.style.cssText = 'font-size:11px;color:#9aa0a6;margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

      var snippetEl = document.createElement('div');
      snippetEl.style.cssText = 'font-size:12px;color:#5f6368;line-height:1.6;margin-bottom:8px;word-break:break-word;background:#fff;padding:8px 12px;border-radius:8px;border:1px solid #e9d5ff;';
      snippetEl.innerHTML = highlightDeepSnippet(r.snippet || '', query);

      var bottomRow = document.createElement('div');
      bottomRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';
      var dtEl = document.createElement('span');
      dtEl.textContent = r.postDate ? '🗓 ' + r.postDate : '';
      dtEl.style.cssText = 'font-size:11px;color:#9aa0a6;';
      var btnGrp = document.createElement('div');
      btnGrp.style.cssText = 'display:flex;gap:6px;';

      var openFileBtn = document.createElement('button');
      openFileBtn.textContent = '🔍 Open & Find';
      openFileBtn.style.cssText = 'font-size:11px;background:#ede9fe;color:#6d28d9;border:1px solid #6d28d9;padding:3px 12px;border-radius:8px;cursor:pointer;font-weight:600;';
      openFileBtn.onclick = function(e) {
        e.stopPropagation();
        window.open('https://drive.google.com/file/d/' + r.fileId + '/view', '_blank');
        showToast('📄 Use Ctrl+F in the PDF to find "' + query + '"');
      };

      if (r.postUrl) {
        var goPostBtn = document.createElement('button');
        goPostBtn.textContent = '↗ Go to post';
        goPostBtn.style.cssText = 'font-size:11px;color:#fff;background:#1a73e8;border:none;padding:3px 12px;border-radius:8px;cursor:pointer;font-weight:600;';
        goPostBtn.onclick = function(e) { e.stopPropagation(); window.open(fixUrl(r.postUrl), '_blank'); };
        btnGrp.appendChild(goPostBtn);
      }
      btnGrp.appendChild(openFileBtn);
      bottomRow.appendChild(dtEl); bottomRow.appendChild(btnGrp);

      item.appendChild(topRow); item.appendChild(fileNameEl); item.appendChild(postTitleEl);
      item.appendChild(snippetEl); item.appendChild(bottomRow);
      panel.appendChild(item);
    });
  }

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

// ─── DARK MODE — full page CSS invert (from new code) ─────────────────────────
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
    'html { filter: invert(1) hue-rotate(180deg) !important; background: #fff !important; }',
    'img, video, canvas, picture { filter: invert(1) hue-rotate(180deg) !important; }',
    '.YVvGBb, .vwNmF, .oUlnUb, .khuEhb, .ZG0g6, .lXf2hd, .yBSP2 { color: #fff !important; }',
    '#gcn-nav-group { filter: invert(1) hue-rotate(180deg) !important; }',
    '#gcn-bookmark-panel { filter: invert(1) hue-rotate(180deg) !important; }',
    '#gcn-api-results { filter: invert(1) hue-rotate(180deg) !important; }',
    '#gcn-toast { filter: invert(1) hue-rotate(180deg) !important; }',
    '#gcn-dark-toggle { background:#111 !important; color:#fff !important; border:1px solid #444 !important; }',
    '#gcn-bm-nav-btn  { background:#111 !important; color:#fff !important; border:1px solid #444 !important; }',
    '#gcn-search-input { background:#111 !important; color:#fff !important; border:1px solid #444 !important; }',
    '#gcn-filter       { background:#111 !important; color:#fff !important; border:1px solid #444 !important; }',
    '#gcn-clear-btn    { background:#222 !important; color:#ccc !important; }',
    'button.gcn-bm-btn { background:#111 !important; color:#fff !important; border:1px solid #444 !important; }',
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
  inp.setAttribute('autocomplete', 'off');
  inp.setAttribute('autocorrect', 'off');
  inp.setAttribute('spellcheck', 'false');
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
    var q=inp.value.trim();
    if(!q){var o=document.getElementById('gcn-api-results');if(o)o.remove();return;}
    clearTimeout(dbt); dbt=setTimeout(function(){doSearch(q,sel.value);},300);
  };
  sel.onchange = function(){ var q=inp.value.trim(); if(q)doSearch(q,sel.value); };
  inp.onkeydown = function(e){
    if(e.key==='Enter'&&inp.value.trim()){
      clearTimeout(dbt);
      var q = inp.value.trim();
      var toggle = document.getElementById('gcn-deep-search-toggle');
      if (toggle && toggle.checked) { doDeepSearch(q); }
      else { doSearch(q,sel.value); }
    }
    if(e.key==='Escape'){var o=document.getElementById('gcn-api-results');if(o)o.remove();}
  };
  bar.appendChild(inp); bar.appendChild(sel); bar.appendChild(clr);

  // Deep Search toggle
  var dsToggleWrap = document.createElement('label');
  dsToggleWrap.id = 'gcn-deep-search-toggle-wrap';
  dsToggleWrap.title = 'Deep Search — search inside PDFs';
  dsToggleWrap.style.cssText = 'display:flex;align-items:center;cursor:pointer;user-select:none;flex-shrink:0;';
  var dsToggle = document.createElement('input');
  dsToggle.type = 'checkbox'; dsToggle.id = 'gcn-deep-search-toggle'; dsToggle.style.cssText = 'display:none;';
  var dsSlider = document.createElement('span'); dsSlider.id = 'gcn-ds-slider';
  dsSlider.style.cssText = 'width:28px;height:16px;background:#999;border-radius:8px;position:relative;display:inline-block;transition:background 0.2s;';
  dsSlider.innerHTML = '<span style="position:absolute;top:2px;left:2px;width:12px;height:12px;background:#fff;border-radius:50%;transition:transform 0.2s;box-shadow:0 1px 2px rgba(0,0,0,0.3);"></span>';
  dsToggle.onchange = function() {
    var knob = dsSlider.querySelector('span');
    if (dsToggle.checked) {
      dsSlider.style.background = '#6d28d9'; knob.style.transform = 'translateX(12px)';
      var q = inp.value.trim(); if (q) doDeepSearch(q);
    } else {
      dsSlider.style.background = '#999'; knob.style.transform = 'translateX(0)';
      var q2 = inp.value.trim(); if (q2) doSearch(q2, sel.value);
    }
  };
  dsToggleWrap.appendChild(dsToggle); dsToggleWrap.appendChild(dsSlider);
  bar.appendChild(dsToggleWrap);

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
  var userTop=scroller.scrollTop;
  var iv=setInterval(function(){
    ticks++;
    var el=findElementInDom(fakeB);
    if(el){clearInterval(iv);highlightAndScroll(el);return;}
    scroller=getStreamScroller(); scroller.scrollTop=scroller.scrollHeight+99999;
    // After scrolling enough, scroll back to user position and try URL as fallback
    if(ticks>=100){
      clearInterval(iv);
      scroller.scrollTop=userTop;
      if(targetUrl&&targetUrl.includes('/c/')){
        window.open(fixUrl(targetUrl),'_blank');
        showToast('📌 Post opened in new tab');
      } else {
        showToast('❌ Could not find the bookmarked post');
      }
    }
  },150);
}

function highlightAndScroll(el){
  el.style.outline='3px solid #1a73e8'; el.style.boxShadow='0 0 0 5px rgba(26,115,232,0.3)';
  el.scrollIntoView({behavior:'smooth',block:'center'});
  setTimeout(function(){el.style.outline='';el.style.boxShadow='';},3000);
}

function findElementInDom(b){
  var targetUrl=fixUrl(b.url); var hasSpecificUrl=targetUrl.includes('/p/');
  var fullText=(b.fullText||b.title||'').trim().toLowerCase();
  var found=null;
  var bestScore=0;
  var bestEl=null;

  document.querySelectorAll('.n4xnA,.cQMaT,.RNmOtb,.asQXV,.zR38ld').forEach(function(el){
    if(found)return;

    // Method 1: Exact URL match (strongest signal)
    el.querySelectorAll('a[href]').forEach(function(a){
      if(!found&&a.href){
        var fixedHref=fixUrl(a.href);
        if(fixedHref===targetUrl) found=el;
        // Also try matching just the post ID part
        if(!found&&hasSpecificUrl){
          var targetPostId=targetUrl.match(/\/p\/([^/?#]+)/);
          var elPostId=fixedHref.match(/\/p\/([^/?#]+)/);
          if(targetPostId&&elPostId&&targetPostId[1]===elPostId[1]) found=el;
        }
      }
    });
    if(found)return;

    // Method 2: Text-based matching using the scoring engine
    if(fullText.length>10){
      var elText=(el.innerText||'').trim();
      if(elText.length<10)return;
      var elTextLower=elText.toLowerCase();

      // Direct substring match (original logic but both directions)
      if(fullText.length>=30&&elTextLower.includes(fullText.substring(0,60))){found=el;return;}
      if(fullText.length>=20&&elTextLower.includes(fullText.substring(0,40))){found=el;return;}
      // Reverse: element text found in bookmark text
      var elSnippet=elTextLower.substring(0,60);
      if(elSnippet.length>=30&&fullText.includes(elSnippet)){found=el;return;}

      // Semantic scoring — find best match across all elements
      var score=scorePost({text:elText},fullText);
      if(score.score>bestScore&&score.score>=50){
        bestScore=score.score;
        bestEl=el;
      }
    }
  });

  return found||bestEl;
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
        var targetUrl=fixUrl(b.url);
        if(targetUrl) window.open(targetUrl,'_blank');
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
    // Passively collect visible DOM posts (no forced scrolling)
    if(!postStore[currentClassId]) postStore[currentClassId]={posts:[],complete:false};
    var visible = collectDomPosts(currentClassId);
    if (visible.length > 0) {
      // Merge with existing: keep old posts, add new visible ones
      var existing = postStore[currentClassId].posts;
      var seenTexts = {};
      existing.forEach(function(p) {
        var k = (p.text||'').substring(0,50).toLowerCase();
        if (k.length > 10) seenTexts[k] = true;
      });
      visible.forEach(function(p) {
        var k = (p.text||'').substring(0,50).toLowerCase();
        if (k.length > 10 && !seenTexts[k]) {
          existing.push(p);
          seenTexts[k] = true;
        } else if (k.length > 10 && seenTexts[k]) {
          // Update element reference for existing post
          for (var i = 0; i < existing.length; i++) {
            if ((existing[i].text||'').substring(0,50).toLowerCase() === k && !existing[i].element && p.element) {
              existing[i].element = p.element;
              break;
            }
          }
        }
      });
      postStore[currentClassId].posts = existing;
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