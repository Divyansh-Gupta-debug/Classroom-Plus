// // // background.js — GC AI Bookmark & Search
// // // Handles bookmarks + silent background pre-fetch of ALL classes via Classroom API

// // chrome.runtime.onInstalled.addListener(function() {
// //   console.log("GC AI Bookmark & Search installed");
// //   // Kick off a pre-fetch shortly after install
// //   setTimeout(prefetchAllClasses, 3000);
// // });

// // // Re-fetch whenever the extension wakes up (browser start, etc.)
// // chrome.runtime.onStartup.addListener(function() {
// //   setTimeout(prefetchAllClasses, 5000);
// // });

// // // ─── MESSAGE ROUTER ───────────────────────────────────────────────────────────

// // chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {

// //   if (message.type === 'SAVE_BOOKMARK') {
// //     chrome.storage.local.get(['bookmarks'], function(data) {
// //       var bookmarks = data.bookmarks || [];
// //       bookmarks.push(message.payload);
// //       chrome.storage.local.set({ bookmarks: bookmarks }, function() {
// //         sendResponse({ status: "success" });
// //       });
// //     });
// //     return true;
// //   }

// //   if (message.type === 'GET_BOOKMARKS') {
// //     chrome.storage.local.get(['bookmarks'], function(data) {
// //       sendResponse({ bookmarks: data.bookmarks || [] });
// //     });
// //     return true;
// //   }

// //   if (message.type === 'DELETE_BOOKMARK') {
// //     chrome.storage.local.get(['bookmarks'], function(data) {
// //       var bookmarks = (data.bookmarks || []).filter(function(b) {
// //         return b.id !== message.id;
// //       });
// //       chrome.storage.local.set({ bookmarks: bookmarks }, function() {
// //         sendResponse({ status: "success" });
// //       });
// //     });
// //     return true;
// //   }

// //   // Content script asks: "give me cached posts for classId"
// //   if (message.type === 'GET_POST_CACHE') {
// //     var key = 'postcache_' + message.classId;
// //     chrome.storage.local.get([key], function(data) {
// //       sendResponse({ cache: data[key] || null });
// //     });
// //     return true;
// //   }

// //   // Content script asks us to store its DOM-scraped posts into persistent cache
// //   if (message.type === 'SAVE_POST_CACHE') {
// //     var key2 = 'postcache_' + message.classId;
// //     var entry = {
// //       posts: message.posts,
// //       ts: Date.now()
// //     };
// //     chrome.storage.local.set({ [key2]: entry }, function() {
// //       sendResponse({ status: 'ok' });
// //     });
// //     return true;
// //   }

// //   // Content script asks us to pre-fetch all classes right now
// //   if (message.type === 'PREFETCH_ALL') {
// //     prefetchAllClasses();
// //     sendResponse({ status: 'started' });
// //     return true;
// //   }

// //   sendResponse({ status: "received" });
// // });

// // // ─── CLASSROOM API PRE-FETCH ──────────────────────────────────────────────────
// // // Cache TTL: 30 minutes
// // var CACHE_TTL_MS = 30 * 60 * 1000;

// // function prefetchAllClasses() {
// //   getToken(function(token) {
// //     if (!token) return;
// //     fetchCourseList(token, function(courses) {
// //       if (!courses || !courses.length) return;
// //       // Stagger fetches so we don't hammer the API
// //       courses.forEach(function(course, i) {
// //         setTimeout(function() {
// //           prefetchClass(token, course.id, course.name);
// //         }, i * 1200);
// //       });
// //     });
// //   });
// // }

// // function getToken(callback) {
// //   try {
// //     chrome.identity.getAuthToken({ interactive: false }, function(token) {
// //       if (chrome.runtime.lastError || !token) { callback(null); return; }
// //       callback(token);
// //     });
// //   } catch(e) { callback(null); }
// // }

// // function fetchCourseList(token, callback) {
// //   fetch('https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE&pageSize=20', {
// //     headers: { 'Authorization': 'Bearer ' + token }
// //   })
// //   .then(function(r) { return r.json(); })
// //   .then(function(data) { callback(data.courses || []); })
// //   .catch(function() { callback([]); });
// // }

// // function prefetchClass(token, courseId, courseName) {
// //   var key = 'postcache_' + courseId;

// //   chrome.storage.local.get([key], function(data) {
// //     var existing = data[key];
// //     // Skip if we have a fresh cache
// //     if (existing && existing.ts && (Date.now() - existing.ts) < CACHE_TTL_MS) return;

// //     console.log('GC Prefetch: loading', courseName);

// //     // Fetch announcements + coursework in parallel
// //     Promise.all([
// //       fetchAnnouncements(token, courseId),
// //       fetchCoursework(token, courseId)
// //     ]).then(function(results) {
// //       var announcements = results[0];
// //       var coursework   = results[1];

// //       var posts = [];

// //       announcements.forEach(function(a) {
// //         posts.push({
// //           text: (a.text || '').trim(),
// //           title: (a.text || '').substring(0, 80),
// //           url: a.alternateLink || ('https://classroom.google.com/c/' + courseId),
// //           date: a.creationTime ? new Date(a.creationTime).toLocaleDateString() : '',
// //           type: 'stream'
// //         });
// //       });

// //       coursework.forEach(function(cw) {
// //         var text = [cw.title, cw.description].filter(Boolean).join(' ');
// //         posts.push({
// //           text: text,
// //           title: (cw.title || '').substring(0, 80),
// //           url: cw.alternateLink || ('https://classroom.google.com/c/' + courseId),
// //           date: cw.creationTime ? new Date(cw.creationTime).toLocaleDateString() : '',
// //           type: 'assignment'
// //         });
// //       });

// //       var entry = { posts: posts, ts: Date.now(), source: 'api' };
// //       chrome.storage.local.set({ [key]: entry }, function() {
// //         console.log('GC Prefetch: cached', posts.length, 'posts for', courseName);
// //       });
// //     });
// //   });
// // }

// // function fetchAnnouncements(token, courseId) {
// //   // Paginate up to 3 pages (300 announcements)
// //   return fetchPaged(
// //     'https://classroom.googleapis.com/v1/courses/' + courseId + '/announcements?pageSize=100&orderBy=updateTime%20desc',
// //     token,
// //     'announcements',
// //     3
// //   );
// // }

// // function fetchCoursework(token, courseId) {
// //   return fetchPaged(
// //     'https://classroom.googleapis.com/v1/courses/' + courseId + '/courseWork?pageSize=100&orderBy=updateTime%20desc',
// //     token,
// //     'courseWork',
// //     3
// //   );
// // }

// // function fetchPaged(url, token, field, maxPages) {
// //   var results = [];
// //   var page = 0;

// //   function next(pageToken) {
// //     if (page >= maxPages) return Promise.resolve(results);
// //     page++;
// //     var u = url + (pageToken ? '&pageToken=' + pageToken : '');
// //     return fetch(u, { headers: { 'Authorization': 'Bearer ' + token } })
// //       .then(function(r) { return r.json(); })
// //       .then(function(data) {
// //         var items = data[field] || [];
// //         results = results.concat(items);
// //         if (data.nextPageToken && items.length > 0) {
// //           return next(data.nextPageToken);
// //         }
// //         return results;
// //       })
// //       .catch(function() { return results; });
// //   }

// //   return next(null);
// // }

// // background.js — GC AI Bookmark & Search
// // Handles bookmarks + silent background pre-fetch of ALL classes via Classroom API

// chrome.runtime.onInstalled.addListener(function() {
//   console.log("GC AI Bookmark & Search installed");
//   // Kick off a pre-fetch shortly after install
//   setTimeout(prefetchAllClasses, 3000);
// });

// // Re-fetch whenever the extension wakes up (browser start, etc.)
// chrome.runtime.onStartup.addListener(function() {
//   setTimeout(prefetchAllClasses, 5000);
// });

// // ─── MESSAGE ROUTER ───────────────────────────────────────────────────────────

// chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {

//   if (message.type === 'SAVE_BOOKMARK') {
//     chrome.storage.local.get(['bookmarks'], function(data) {
//       var bookmarks = data.bookmarks || [];
//       bookmarks.push(message.payload);
//       chrome.storage.local.set({ bookmarks: bookmarks }, function() {
//         sendResponse({ status: "success" });
//       });
//     });
//     return true;
//   }

//   if (message.type === 'GET_BOOKMARKS') {
//     chrome.storage.local.get(['bookmarks'], function(data) {
//       sendResponse({ bookmarks: data.bookmarks || [] });
//     });
//     return true;
//   }

//   if (message.type === 'DELETE_BOOKMARK') {
//     chrome.storage.local.get(['bookmarks'], function(data) {
//       var bookmarks = (data.bookmarks || []).filter(function(b) {
//         return b.id !== message.id;
//       });
//       chrome.storage.local.set({ bookmarks: bookmarks }, function() {
//         sendResponse({ status: "success" });
//       });
//     });
//     return true;
//   }

//   // Content script asks: "give me cached posts for classId"
//   if (message.type === 'GET_POST_CACHE') {
//     var key = 'postcache_' + message.classId;
//     chrome.storage.local.get([key], function(data) {
//       sendResponse({ cache: data[key] || null });
//     });
//     return true;
//   }

//   // Content script asks us to clear the cache for a specific class (on navigation away)
//   if (message.type === 'CLEAR_POST_CACHE') {
//     var clearKey = 'postcache_' + message.classId;
//     chrome.storage.local.remove([clearKey], function() {
//       sendResponse({ status: 'cleared' });
//     });
//     return true;
//   }

//   // Content script asks us to store its DOM-scraped posts into persistent cache
//   if (message.type === 'SAVE_POST_CACHE') {
//     var key2 = 'postcache_' + message.classId;
//     var entry = {
//       posts: message.posts,
//       ts: Date.now()
//     };
//     chrome.storage.local.set({ [key2]: entry }, function() {
//       sendResponse({ status: 'ok' });
//     });
//     return true;
//   }

//   // Content script asks us to pre-fetch all classes right now
//   if (message.type === 'PREFETCH_ALL') {
//     prefetchAllClasses();
//     sendResponse({ status: 'started' });
//     return true;
//   }

//   sendResponse({ status: "received" });
// });

// // ─── CLASSROOM API PRE-FETCH ──────────────────────────────────────────────────
// // Cache TTL: 30 minutes
// var CACHE_TTL_MS = 30 * 60 * 1000;

// function prefetchAllClasses() {
//   getToken(function(token) {
//     if (!token) return;
//     fetchCourseList(token, function(courses) {
//       if (!courses || !courses.length) return;
//       // Stagger fetches so we don't hammer the API
//       courses.forEach(function(course, i) {
//         setTimeout(function() {
//           prefetchClass(token, course.id, course.name);
//         }, i * 1200);
//       });
//     });
//   });
// }

// function getToken(callback) {
//   try {
//     chrome.identity.getAuthToken({ interactive: false }, function(token) {
//       if (chrome.runtime.lastError || !token) { callback(null); return; }
//       callback(token);
//     });
//   } catch(e) { callback(null); }
// }

// function fetchCourseList(token, callback) {
//   fetch('https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE&pageSize=20', {
//     headers: { 'Authorization': 'Bearer ' + token }
//   })
//   .then(function(r) { return r.json(); })
//   .then(function(data) { callback(data.courses || []); })
//   .catch(function() { callback([]); });
// }

// function prefetchClass(token, courseId, courseName) {
//   var key = 'postcache_' + courseId;

//   chrome.storage.local.get([key], function(data) {
//     var existing = data[key];
//     // Skip if we have a fresh cache
//     if (existing && existing.ts && (Date.now() - existing.ts) < CACHE_TTL_MS) return;

//     console.log('GC Prefetch: loading', courseName);

//     // Fetch announcements + coursework in parallel
//     Promise.all([
//       fetchAnnouncements(token, courseId),
//       fetchCoursework(token, courseId)
//     ]).then(function(results) {
//       var announcements = results[0];
//       var coursework   = results[1];

//       var posts = [];

//       announcements.forEach(function(a) {
//         posts.push({
//           classId: courseId,
//           text: (a.text || '').trim(),
//           title: (a.text || '').substring(0, 80),
//           url: a.alternateLink || ('https://classroom.google.com/c/' + courseId),
//           date: a.creationTime ? new Date(a.creationTime).toLocaleDateString() : '',
//           type: 'stream'
//         });
//       });

//       coursework.forEach(function(cw) {
//         var text = [cw.title, cw.description].filter(Boolean).join(' ');
//         posts.push({
//           classId: courseId,
//           text: text,
//           title: (cw.title || '').substring(0, 80),
//           url: cw.alternateLink || ('https://classroom.google.com/c/' + courseId),
//           date: cw.creationTime ? new Date(cw.creationTime).toLocaleDateString() : '',
//           type: 'assignment'
//         });
//       });

//       var entry = { posts: posts, ts: Date.now(), source: 'api' };
//       chrome.storage.local.set({ [key]: entry }, function() {
//         console.log('GC Prefetch: cached', posts.length, 'posts for', courseName);
//       });
//     });
//   });
// }

// function fetchAnnouncements(token, courseId) {
//   // Paginate up to 3 pages (300 announcements)
//   return fetchPaged(
//     'https://classroom.googleapis.com/v1/courses/' + courseId + '/announcements?pageSize=100&orderBy=updateTime%20desc',
//     token,
//     'announcements',
//     3
//   );
// }

// function fetchCoursework(token, courseId) {
//   return fetchPaged(
//     'https://classroom.googleapis.com/v1/courses/' + courseId + '/courseWork?pageSize=100&orderBy=updateTime%20desc',
//     token,
//     'courseWork',
//     3
//   );
// }

// function fetchPaged(url, token, field, maxPages) {
//   var results = [];
//   var page = 0;

//   function next(pageToken) {
//     if (page >= maxPages) return Promise.resolve(results);
//     page++;
//     var u = url + (pageToken ? '&pageToken=' + pageToken : '');
//     return fetch(u, { headers: { 'Authorization': 'Bearer ' + token } })
//       .then(function(r) { return r.json(); })
//       .then(function(data) {
//         var items = data[field] || [];
//         results = results.concat(items);
//         if (data.nextPageToken && items.length > 0) {
//           return next(data.nextPageToken);
//         }
//         return results;
//       })
//       .catch(function() { return results; });
//   }

//   return next(null);
// }

chrome.runtime.onInstalled.addListener(function() {
  console.log("GC AI Bookmark & Search installed");
  // Purge any stale/cross-class post caches left by old versions
  purgeStalePostCaches(function() {});
});

chrome.runtime.onStartup.addListener(function() {
  purgeStalePostCaches(function() {});
});

// Remove all postcache_* entries that contain posts missing a classId field.
// These were written by an old version of the extension and cause cross-class search pollution.
function purgeStalePostCaches(callback) {
  chrome.storage.local.get(null, function(allData) {
    if (chrome.runtime.lastError) { if (callback) callback(); return; }
    var keysToRemove = [];
    Object.keys(allData).forEach(function(key) {
      if (!key.startsWith('postcache_')) return;
      var entry = allData[key];
      if (!entry || !Array.isArray(entry.posts)) { keysToRemove.push(key); return; }
      var expectedClassId = key.replace('postcache_', '');
      var hasStale = entry.posts.some(function(p) {
        return !p.classId || p.classId !== expectedClassId;
      });
      if (hasStale) keysToRemove.push(key);
    });
    if (keysToRemove.length > 0) {
      console.log('GC: purging stale caches:', keysToRemove);
      chrome.storage.local.remove(keysToRemove, function() { if (callback) callback(); });
    } else {
      if (callback) callback();
    }
  });
}

// ─── MESSAGE ROUTER ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {

  if (message.type === 'SAVE_BOOKMARK') {
    chrome.storage.local.get(['bookmarks'], function(data) {
      var bookmarks = data.bookmarks || [];
      bookmarks.push(message.payload);
      chrome.storage.local.set({ bookmarks: bookmarks }, function() {
        sendResponse({ status: 'success' });
      });
    });
    return true;
  }

  if (message.type === 'GET_BOOKMARKS') {
    chrome.storage.local.get(['bookmarks'], function(data) {
      sendResponse({ bookmarks: data.bookmarks || [] });
    });
    return true;
  }

  if (message.type === 'DELETE_BOOKMARK') {
    chrome.storage.local.get(['bookmarks'], function(data) {
      var bookmarks = (data.bookmarks || []).filter(function(b) {
        return b.id !== message.id;
      });
      chrome.storage.local.set({ bookmarks: bookmarks }, function() {
        sendResponse({ status: 'success' });
      });
    });
    return true;
  }

  if (message.type === 'GET_POST_CACHE') {
    var key = 'postcache_' + message.classId;
    chrome.storage.local.get([key], function(data) {
      sendResponse({ cache: data[key] || null });
    });
    return true;
  }

  if (message.type === 'CLEAR_POST_CACHE') {
    var clearKey = 'postcache_' + message.classId;
    chrome.storage.local.remove([clearKey], function() {
      sendResponse({ status: 'cleared' });
    });
    return true;
  }

  // Nuke ALL postcache_* keys — called by content script on first load to clear stale data
  if (message.type === 'CLEAR_ALL_POST_CACHES') {
    purgeStalePostCaches(function() {
      sendResponse({ status: 'done' });
    });
    return true;
  }

  if (message.type === 'SAVE_POST_CACHE') {
    var key2 = 'postcache_' + message.classId;
    var entry = { posts: message.posts, ts: Date.now() };
    chrome.storage.local.set({ [key2]: entry }, function() {
      sendResponse({ status: 'ok' });
    });
    return true;
  }

  if (message.type === 'PREFETCH_ALL') {
    // API prefetch disabled — it caused cross-class search pollution by pre-loading
    // all courses into storage before the user ever visits them.
    sendResponse({ status: 'disabled' });
    return true;
  }

  sendResponse({ status: 'received' });
});

// ─── CLASSROOM API PRE-FETCH ──────────────────────────────────────────────────

var CACHE_TTL_MS = 30 * 60 * 1000;

function prefetchAllClasses() {
  getToken(function(token) {
    if (!token) return;
    fetchCourseList(token, function(courses) {
      if (!courses || !courses.length) return;
      courses.forEach(function(course, i) {
        setTimeout(function() {
          prefetchClass(token, course.id, course.name);
        }, i * 1200);
      });
    });
  });
}

function getToken(callback) {
  try {
    chrome.identity.getAuthToken({ interactive: false }, function(token) {
      if (chrome.runtime.lastError || !token) { callback(null); return; }
      callback(token);
    });
  } catch(e) { callback(null); }
}

function fetchCourseList(token, callback) {
  fetch('https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE&pageSize=20', {
    headers: { 'Authorization': 'Bearer ' + token }
  })
  .then(function(r) { return r.json(); })
  .then(function(data) { callback(data.courses || []); })
  .catch(function() { callback([]); });
}

function prefetchClass(token, courseId, courseName) {
  var key = 'postcache_' + courseId;
  chrome.storage.local.get([key], function(data) {
    var existing = data[key];
    if (existing && existing.ts && (Date.now() - existing.ts) < CACHE_TTL_MS) return;

    console.log('GC Prefetch: loading', courseName);

    Promise.all([
      fetchAnnouncements(token, courseId),
      fetchCoursework(token, courseId)
    ]).then(function(results) {
      var announcements = results[0];
      var coursework = results[1];
      var posts = [];

      announcements.forEach(function(a) {
        posts.push({
          classId: courseId,
          text: (a.text || '').trim(),
          title: (a.text || '').substring(0, 80),
          url: a.alternateLink || ('https://classroom.google.com/c/' + courseId),
          date: a.creationTime ? new Date(a.creationTime).toLocaleDateString() : '',
          type: 'stream'
        });
      });

      coursework.forEach(function(cw) {
        var text = [cw.title, cw.description].filter(Boolean).join(' ');
        posts.push({
          classId: courseId,
          text: text,
          title: (cw.title || '').substring(0, 80),
          url: cw.alternateLink || ('https://classroom.google.com/c/' + courseId),
          date: cw.creationTime ? new Date(cw.creationTime).toLocaleDateString() : '',
          type: 'assignment'
        });
      });

      chrome.storage.local.set({ [key]: { posts: posts, ts: Date.now(), source: 'api' } }, function() {
        console.log('GC Prefetch: cached', posts.length, 'posts for', courseName);
      });
    });
  });
}

function fetchAnnouncements(token, courseId) {
  return fetchPaged(
    'https://classroom.googleapis.com/v1/courses/' + courseId + '/announcements?pageSize=100&orderBy=updateTime%20desc',
    token, 'announcements', 3
  );
}

function fetchCoursework(token, courseId) {
  return fetchPaged(
    'https://classroom.googleapis.com/v1/courses/' + courseId + '/courseWork?pageSize=100&orderBy=updateTime%20desc',
    token, 'courseWork', 3
  );
}

function fetchPaged(url, token, field, maxPages) {
  var results = [];
  var page = 0;

  function next(pageToken) {
    if (page >= maxPages) return Promise.resolve(results);
    page++;
    var u = url + (pageToken ? '&pageToken=' + pageToken : '');
    return fetch(u, { headers: { 'Authorization': 'Bearer ' + token } })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var items = data[field] || [];
        results = results.concat(items);
        if (data.nextPageToken && items.length > 0) return next(data.nextPageToken);
        return results;
      })
      .catch(function() { return results; });
  }

  return next(null);
}