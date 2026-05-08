// // // background.js — GC AI Bookmark & Search
// // // Handles bookmarks + silent background pre-fetch of ALL classes via Classroom API

// Load pdf.js at top level — but note: pdf.js doesn't work in MV3 service workers
// We use a custom PDF parser with DecompressionStream instead
// try { importScripts('pdf.min.js'); } catch(e) {}

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

  // ─── DEEP SEARCH: fetch PDFs from stream attachments, extract text, search ──
  if (message.type === 'DEEP_SEARCH') {
    var dsClassId = message.classId;
    var dsQuery   = (message.query || '').toLowerCase().trim();
    if (!dsClassId || !dsQuery) { sendResponse({ error: 'Missing classId or query' }); return true; }

    // Interactive auth — will prompt user for consent if needed
    chrome.identity.getAuthToken({ interactive: true }, function(token) {
      if (chrome.runtime.lastError || !token) {
        sendResponse({ error: 'Permission denied or login failed: ' + (chrome.runtime.lastError ? chrome.runtime.lastError.message : 'no token') });
        return;
      }

      var debugLog = [];
      debugLog.push('Token obtained (' + token.substring(0, 10) + '...)');
      debugLog.push('URL class ID: ' + dsClassId);

      // The class ID from the URL is often a base64-encoded numeric ID.
      // The Classroom API requires the numeric ID, so we need to resolve it.
      resolveNumericCourseId(token, dsClassId, debugLog).then(function(numericId) {
        debugLog.push('Resolved API course ID: ' + numericId);
        return runDeepSearch(token, numericId, dsQuery, debugLog);
      }).then(function(result) {
        sendResponse(result);
      }).catch(function(err) {
        sendResponse({ error: 'Deep search failed: ' + (err.message || err), debug: debugLog });
      });
    });
    return true;
  }

  sendResponse({ status: 'received' });
});

// Resolve the URL class ID (which may be base64-encoded) to the numeric course ID
function resolveNumericCourseId(token, urlClassId, debugLog) {
  // If it's already numeric, use as-is
  if (/^\d+$/.test(urlClassId)) {
    debugLog.push('Class ID is already numeric');
    return Promise.resolve(urlClassId);
  }

  // Try base64 decoding
  try {
    var decoded = atob(urlClassId);
    if (/^\d+$/.test(decoded)) {
      debugLog.push('Base64 decoded to numeric: ' + decoded);
      return Promise.resolve(decoded);
    }
    debugLog.push('Base64 decoded but not numeric: ' + decoded);
  } catch(e) {
    debugLog.push('Not valid base64: ' + e.message);
  }

  // Fallback: use courses.get API with the URL ID (sometimes works with aliases)
  debugLog.push('Trying courses.get API with URL ID...');
  return fetch('https://classroom.googleapis.com/v1/courses/' + urlClassId, {
    headers: { 'Authorization': 'Bearer ' + token }
  }).then(function(r) {
    if (!r.ok) {
      debugLog.push('courses.get failed: HTTP ' + r.status);
      // Last resort: try listing all courses and matching
      return listAndMatchCourse(token, urlClassId, debugLog);
    }
    return r.json().then(function(course) {
      debugLog.push('courses.get returned id: ' + course.id);
      return course.id;
    });
  });
}

// List active courses and find one whose alternateLink contains the URL class ID
function listAndMatchCourse(token, urlClassId, debugLog) {
  debugLog.push('Listing courses to find match...');
  return fetch('https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE&pageSize=50', {
    headers: { 'Authorization': 'Bearer ' + token }
  }).then(function(r) {
    if (!r.ok) {
      return r.text().then(function(body) {
        debugLog.push('courses.list failed: HTTP ' + r.status + ' - ' + body.substring(0, 200));
        throw new Error('Could not resolve course ID. courses.list HTTP ' + r.status);
      });
    }
    return r.json();
  }).then(function(data) {
    var courses = data.courses || [];
    debugLog.push('Found ' + courses.length + ' active courses');
    for (var i = 0; i < courses.length; i++) {
      var c = courses[i];
      if (c.alternateLink && c.alternateLink.includes(urlClassId)) {
        debugLog.push('Matched course: ' + c.name + ' (id: ' + c.id + ')');
        return c.id;
      }
    }
    // Also try matching by checking if base64(id) == urlClassId
    for (var j = 0; j < courses.length; j++) {
      var c2 = courses[j];
      try {
        if (btoa(c2.id) === urlClassId || btoa(c2.id).replace(/=+$/, '') === urlClassId) {
          debugLog.push('Matched by btoa(id): ' + c2.name + ' (id: ' + c2.id + ')');
          return c2.id;
        }
      } catch(e) {}
    }
    debugLog.push('No course matched URL ID: ' + urlClassId);
    debugLog.push('Available: ' + courses.map(function(c){ return c.name + '=' + c.id; }).join(', '));
    throw new Error('Could not find course matching URL ID: ' + urlClassId);
  });
}

// Run the actual deep search once we have the numeric course ID
function runDeepSearch(token, courseId, query, debugLog) {
  var announcementsP = fetchWithDebug(
    'https://classroom.googleapis.com/v1/courses/' + courseId + '/announcements?pageSize=100',
    token, 'announcements', debugLog, 'Announcements'
  );
  var courseworkP = fetchWithDebug(
    'https://classroom.googleapis.com/v1/courses/' + courseId + '/courseWork?pageSize=100',
    token, 'courseWork', debugLog, 'CourseWork'
  );
  var materialsP = fetchWithDebug(
    'https://classroom.googleapis.com/v1/courses/' + courseId + '/courseWorkMaterials?pageSize=100',
    token, 'courseWorkMaterial', debugLog, 'Materials'
  );

  return Promise.all([announcementsP, courseworkP, materialsP]).then(function(results) {
    var announcements = results[0] || [];
    var coursework    = results[1] || [];
    var materials     = results[2] || [];

    debugLog.push('--- Results: ' + announcements.length + ' announcements, ' +
      coursework.length + ' coursework, ' + materials.length + ' materials');

    var fileTasks = [];

    function extractDriveFiles(materialsArr, postTitle, postUrl, postDate, postType) {
      if (!materialsArr || !Array.isArray(materialsArr)) return;
      materialsArr.forEach(function(mat) {
        var df = null;
        if (mat.driveFile && mat.driveFile.driveFile) {
          df = mat.driveFile.driveFile;
        } else if (mat.driveFile && mat.driveFile.id) {
          df = mat.driveFile;
        }
        if (df && df.id) {
          fileTasks.push({
            fileId: df.id,
            fileName: df.title || df.name || 'Untitled',
            mimeType: df.mimeType || '',
            postTitle: postTitle,
            postUrl: postUrl,
            postDate: postDate,
            postType: postType
          });
        }
      });
    }

    announcements.forEach(function(a) {
      extractDriveFiles(a.materials,
        (a.text || '').substring(0, 80),
        a.alternateLink || '',
        a.creationTime ? new Date(a.creationTime).toLocaleDateString() : '',
        'stream');
    });

    coursework.forEach(function(cw) {
      extractDriveFiles(cw.materials,
        (cw.title || '').substring(0, 80),
        cw.alternateLink || '',
        cw.creationTime ? new Date(cw.creationTime).toLocaleDateString() : '',
        'assignment');
    });

    materials.forEach(function(m) {
      extractDriveFiles(m.materials,
        (m.title || '').substring(0, 80),
        m.alternateLink || '',
        m.creationTime ? new Date(m.creationTime).toLocaleDateString() : '',
        'material');
    });

    debugLog.push('Drive files found: ' + fileTasks.length);
    if (fileTasks.length > 0) {
      debugLog.push('Files: ' + fileTasks.map(function(f){ return f.fileName; }).join(', '));
    }

    if (announcements.length === 0 && coursework.length === 0 && materials.length === 0) {
      return {
        results: [],
        totalFiles: 0,
        debug: debugLog,
        message: 'API returned 0 items from all endpoints. This usually means the OAuth token lacks proper scopes or the course ID is wrong.'
      };
    }

    if (fileTasks.length === 0) {
      return {
        results: [],
        totalFiles: 0,
        debug: debugLog,
        message: 'Found ' + announcements.length + ' announcements, ' + coursework.length + ' assignments, ' + materials.length + ' materials — but none had Drive file attachments.'
      };
    }

    // Extract text from each file — only process first 5 to show debug, then rest
    var extractPromises = fileTasks.map(function(ft) {
      return extractFileText(token, ft.fileId, ft.mimeType, debugLog).then(function(text) {
        ft.extractedText = text || '';
        debugLog.push('Extracted ' + ft.extractedText.length + ' chars from ' + ft.fileName);
        return ft;
      }).catch(function(e) {
        ft.extractedText = '';
        debugLog.push('FAILED to extract from ' + ft.fileName + ': ' + (e.message || e));
        return ft;
      });
    });

    return Promise.all(extractPromises).then(function(filesWithText) {
      var deepResults = [];
      filesWithText.forEach(function(ft) {
        if (!ft.extractedText) return;
        var textLower = ft.extractedText.toLowerCase();
        var qWords = query.split(/\s+/).filter(function(w) { return w.length >= 2; });
        var allMatch = qWords.length > 0 && qWords.every(function(qw) {
          return textLower.indexOf(qw) !== -1;
        });
        var fullMatch = textLower.indexOf(query) !== -1;

        if (allMatch || fullMatch) {
          var matchIdx = textLower.indexOf(query);
          if (matchIdx === -1) matchIdx = textLower.indexOf(qWords[0]);
          var snippetStart = Math.max(0, matchIdx - 100);
          var snippetEnd   = Math.min(ft.extractedText.length, matchIdx + query.length + 200);
          var snippet = (snippetStart > 0 ? '…' : '') +
                        ft.extractedText.substring(snippetStart, snippetEnd).trim() +
                        (snippetEnd < ft.extractedText.length ? '…' : '');

          deepResults.push({
            fileName: ft.fileName,
            fileId: ft.fileId,
            postTitle: ft.postTitle,
            postUrl: ft.postUrl,
            postDate: ft.postDate,
            postType: ft.postType,
            snippet: snippet,
            fileUrl: 'https://drive.google.com/file/d/' + ft.fileId + '/view'
          });
        }
      });

      return {
        results: deepResults,
        totalFiles: fileTasks.length,
        debug: debugLog,
        message: deepResults.length > 0
          ? 'Found matches in ' + deepResults.length + ' file(s) out of ' + fileTasks.length + ' scanned.'
          : 'No matches found in ' + fileTasks.length + ' file(s).'
      };
    });
  });
}

// Fetch a single Classroom API endpoint with full error reporting
function fetchWithDebug(url, token, field, debugLog, label) {
  debugLog.push('Fetching ' + label + ': ' + url);
  return fetch(url, {
    headers: { 'Authorization': 'Bearer ' + token }
  })
  .then(function(r) {
    debugLog.push(label + ' HTTP ' + r.status);
    if (!r.ok) {
      return r.text().then(function(body) {
        debugLog.push(label + ' ERROR body: ' + body.substring(0, 300));
        return [];
      });
    }
    return r.json().then(function(data) {
      var items = data[field] || [];
      debugLog.push(label + ': ' + items.length + ' items' +
        (data.nextPageToken ? ' (has more pages)' : '') +
        ' | response keys: ' + Object.keys(data).join(','));
      // If field not found, log what keys ARE in the response
      if (items.length === 0 && Object.keys(data).length > 0) {
        debugLog.push(label + ' full response: ' + JSON.stringify(data).substring(0, 400));
      }
      return items;
    });
  })
  .catch(function(e) {
    debugLog.push(label + ' FETCH ERROR: ' + (e.message || e));
    return [];
  });
}

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

function fetchCourseWorkMaterials(token, courseId) {
  return fetchPaged(
    'https://classroom.googleapis.com/v1/courses/' + courseId + '/courseWorkMaterials?pageSize=100&orderBy=updateTime%20desc',
    token, 'courseWorkMaterial', 3
  ).catch(function() { return []; }); // graceful fail if API not enabled
}

// Extract text from a Google Drive file.
function extractFileText(token, fileId, mimeType, debugLog) {
  // Google Docs, Slides, Sheets → export as text
  if (mimeType === 'application/vnd.google-apps.document' ||
      mimeType === 'application/vnd.google-apps.presentation' ||
      mimeType === 'application/vnd.google-apps.spreadsheet') {
    var exportUrl = 'https://www.googleapis.com/drive/v3/files/' + fileId + '/export?mimeType=text/plain';
    return fetch(exportUrl, { headers: { 'Authorization': 'Bearer ' + token } })
      .then(function(r) {
        if (!r.ok) { debugLog.push('EXPORT FAIL ' + fileId + ' HTTP ' + r.status); return ''; }
        return r.text();
      })
      .then(function(text) { return (text || '').substring(0, 50000); })
      .catch(function(e) { debugLog.push('EXPORT ERR ' + fileId + ': ' + e.message); return ''; });
  }

  // For non-native files: check metadata first
  var metaUrl = 'https://www.googleapis.com/drive/v3/files/' + fileId + '?fields=mimeType,size,name';
  return fetch(metaUrl, { headers: { 'Authorization': 'Bearer ' + token } })
    .then(function(r) {
      if (!r.ok) {
        debugLog.push('META FAIL ' + fileId + ' HTTP ' + r.status);
        return r.text().then(function(body) {
          debugLog.push('META BODY: ' + body.substring(0, 200));
          return null;
        });
      }
      return r.json();
    })
    .then(function(meta) {
      if (!meta) return '';
      var actualMime = meta.mimeType || mimeType || '';
      debugLog.push('FILE ' + (meta.name || fileId) + ' mime=' + actualMime + ' size=' + (meta.size || '?'));

      // Google-native types
      if (actualMime.startsWith('application/vnd.google-apps.')) {
        var expUrl = 'https://www.googleapis.com/drive/v3/files/' + fileId + '/export?mimeType=text/plain';
        return fetch(expUrl, { headers: { 'Authorization': 'Bearer ' + token } })
          .then(function(r) {
            if (!r.ok) { debugLog.push('GEXPORT FAIL ' + fileId + ' HTTP ' + r.status); return ''; }
            return r.text();
          })
          .then(function(t) { return (t || '').substring(0, 50000); });
      }

      // Skip files > 15MB
      var fileSize = parseInt(meta.size || '0', 10);
      if (fileSize > 15 * 1024 * 1024) {
        debugLog.push('SKIP too large: ' + fileSize);
        return '';
      }

      // Download the raw file
      var dlUrl = 'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media';
      return fetch(dlUrl, { headers: { 'Authorization': 'Bearer ' + token } })
        .then(function(r) {
          if (!r.ok) {
            debugLog.push('DOWNLOAD FAIL ' + fileId + ' HTTP ' + r.status);
            return r.text().then(function(body) {
              debugLog.push('DL BODY: ' + body.substring(0, 200));
              return '';
            });
          }
          debugLog.push('DOWNLOAD OK ' + (meta.name || fileId));

          // For PDFs: extract text
          if (actualMime === 'application/pdf') {
            return r.arrayBuffer().then(async function(buf) {
              debugLog.push('PDF buffer size: ' + buf.byteLength + ' bytes');
              return await extractTextWithPdfJs(buf, debugLog);
            });
          }

          // For text-like files
          if (actualMime.startsWith('text/') ||
              actualMime === 'application/json' ||
              actualMime === 'application/xml' ||
              actualMime === 'application/csv') {
            return r.text();
          }

          return '';
        })
        .then(function(t) { return (t || '').substring(0, 50000); });
    })
    .catch(function(e) { debugLog.push('EXTRACT ERR ' + fileId + ': ' + (e.message || e)); return ''; });
}

// ─── Custom PDF Text Extractor using DecompressionStream API ───────────────
// Works in service workers (no document needed). Handles FlateDecode streams.

function extractTextWithPdfJs(arrayBuffer, debugLog) {
  return extractPdfText(arrayBuffer, debugLog);
}

async function extractPdfText(arrayBuffer, debugLog) {
  try {
    var bytes = new Uint8Array(arrayBuffer);
    var allText = '';

    // Find all stream objects and decompress FlateDecode streams
    var streamRegex = /stream\r?\n/g;
    var endStreamRegex = /\r?\nendstream/g;
    var raw = bytesToLatin1(bytes);

    // Find all FlateDecode streams
    var streamCount = 0;
    var decompressedCount = 0;
    var match;
    
    // Collect stream positions
    var streams = [];
    streamRegex.lastIndex = 0;
    while ((match = streamRegex.exec(raw)) !== null) {
      var streamStart = match.index + match[0].length;
      // Find the matching endstream
      endStreamRegex.lastIndex = streamStart;
      var endMatch = endStreamRegex.exec(raw);
      if (endMatch) {
        streams.push({ start: streamStart, end: endMatch.index });
        streamCount++;
      }
    }

    debugLog.push('Found ' + streamCount + ' streams in PDF');

    // Look back from each stream to check if it uses FlateDecode
    for (var s = 0; s < streams.length; s++) {
      var st = streams[s];
      // Look at the object header before this stream (up to 500 chars back)
      var headerStart = Math.max(0, st.start - 500);
      var header = raw.substring(headerStart, st.start);
      
      var streamBytes = bytes.slice(st.start, st.end);
      var text = '';

      if (header.indexOf('/FlateDecode') !== -1) {
        // Decompress with DecompressionStream API
        try {
          var decompressed = await decompressFlate(streamBytes);
          text = extractTextFromContent(decompressed);
          if (text.length > 0) decompressedCount++;
        } catch(e) {
          // Not all FlateDecode streams contain text, skip silently
        }
      } else {
        // Uncompressed stream — try direct text extraction
        text = extractTextFromContent(bytesToLatin1Bytes(streamBytes));
      }

      if (text.trim().length > 0) {
        allText += text + '\n';
      }
    }

    debugLog.push('Decompressed ' + decompressedCount + ' streams, extracted ' + allText.length + ' chars');
    return allText.trim();
  } catch(e) {
    debugLog.push('PDF parse error: ' + (e.message || e));
    return '';
  }
}

// Decompress a FlateDecode (zlib/deflate) stream using DecompressionStream API
async function decompressFlate(compressedBytes) {
  // FlateDecode in PDF is raw deflate (RFC 1951), but sometimes zlib-wrapped
  // Try raw deflate first, then zlib
  for (var format of ['deflate-raw', 'deflate']) {
    try {
      var ds = new DecompressionStream(format);
      var writer = ds.writable.getWriter();
      var reader = ds.readable.getReader();
      
      writer.write(compressedBytes);
      writer.close();
      
      var chunks = [];
      while (true) {
        var result = await reader.read();
        if (result.done) break;
        chunks.push(result.value);
      }
      
      // Concatenate chunks
      var totalLen = 0;
      for (var c = 0; c < chunks.length; c++) totalLen += chunks[c].length;
      var out = new Uint8Array(totalLen);
      var offset = 0;
      for (var c2 = 0; c2 < chunks.length; c2++) {
        out.set(chunks[c2], offset);
        offset += chunks[c2].length;
      }
      
      return bytesToLatin1Bytes(out);
    } catch(e) {
      // Try next format
    }
  }
  throw new Error('Decompression failed');
}

// Extract readable text from a PDF content stream (BT/ET blocks, Tj/TJ operators)
function extractTextFromContent(content) {
  var text = '';
  
  // Method 1: Extract from BT...ET blocks
  var btBlocks = content.match(/BT[\s\S]*?ET/g) || [];
  for (var b = 0; b < btBlocks.length; b++) {
    var block = btBlocks[b];
    
    // Handle TJ operator: [(text) kerning (text) ...] TJ
    var tjArrays = block.match(/\[([^\]]*)\]\s*TJ/g) || [];
    for (var t = 0; t < tjArrays.length; t++) {
      var parts = tjArrays[t].match(/\(([^)]*)\)/g) || [];
      for (var p = 0; p < parts.length; p++) {
        text += unescapePdfString(parts[p].substring(1, parts[p].length - 1));
      }
    }
    
    // Handle Tj operator: (text) Tj
    var tjSingle = block.match(/\(([^)]*)\)\s*Tj/g) || [];
    for (var ts = 0; ts < tjSingle.length; ts++) {
      var innerMatch = tjSingle[ts].match(/\(([^)]*)\)/);
      if (innerMatch) {
        text += unescapePdfString(innerMatch[1]);
      }
    }
    
    // Handle ' and " operators (text with line break)
    var tjQuote = block.match(/\(([^)]*)\)\s*['"]/g) || [];
    for (var tq = 0; tq < tjQuote.length; tq++) {
      var qMatch = tjQuote[tq].match(/\(([^)]*)\)/);
      if (qMatch) {
        text += unescapePdfString(qMatch[1]) + '\n';
      }
    }
    
    text += ' ';
  }
  
  // Method 2: If BT/ET got nothing, try raw parenthesized string extraction
  if (text.trim().length < 5) {
    var rawStrings = content.match(/\(([^)]{2,})\)/g) || [];
    var rawText = '';
    for (var r = 0; r < rawStrings.length; r++) {
      var inner = rawStrings[r].substring(1, rawStrings[r].length - 1);
      // Only keep strings that look like readable text
      if (/^[\x20-\x7E\u00A0-\u00FF\s]{2,}$/.test(inner)) {
        rawText += inner + ' ';
      }
    }
    if (rawText.length > text.length) text = rawText;
  }
  
  return text;
}

function unescapePdfString(s) {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\\(\d{1,3})/g, function(m, oct) {
      return String.fromCharCode(parseInt(oct, 8));
    });
}

// Convert Uint8Array to a string using Latin-1 (preserves byte values)
// Uses TextDecoder for performance
function bytesToLatin1(bytes) {
  try {
    // TextDecoder with latin1/iso-8859-1 is fastest and preserves byte values
    var decoder = new TextDecoder('iso-8859-1');
    return decoder.decode(bytes);
  } catch(e) {
    // Fallback: manual conversion with small chunks
    var result = '';
    for (var i = 0; i < bytes.length; i++) {
      result += String.fromCharCode(bytes[i]);
    }
    return result;
  }
}

function bytesToLatin1Bytes(bytes) {
  return bytesToLatin1(bytes);
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