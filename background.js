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

    // Extract text from each file
    var extractPromises = fileTasks.map(function(ft) {
      return extractFileText(token, ft.fileId, ft.mimeType).then(function(text) {
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
// Strategy:
//   Google Docs/Slides/Sheets → export as plain text
//   PDFs → copy as Google Doc via Drive API (Drive does OCR), then export as text, then delete the copy
//   Text files → download directly
function extractFileText(token, fileId, mimeType) {
  // Google Docs, Slides, Sheets → export as text
  if (mimeType === 'application/vnd.google-apps.document' ||
      mimeType === 'application/vnd.google-apps.presentation' ||
      mimeType === 'application/vnd.google-apps.spreadsheet') {
    var exportUrl = 'https://www.googleapis.com/drive/v3/files/' + fileId + '/export?mimeType=text/plain';
    return fetch(exportUrl, { headers: { 'Authorization': 'Bearer ' + token } })
      .then(function(r) {
        if (!r.ok) { console.log('GC Deep: export failed for', fileId, r.status); return ''; }
        return r.text();
      })
      .then(function(text) { return (text || '').substring(0, 50000); })
      .catch(function(e) { console.log('GC Deep: export error', fileId, e); return ''; });
  }

  // For non-native files: check metadata first
  var metaUrl = 'https://www.googleapis.com/drive/v3/files/' + fileId + '?fields=mimeType,size,name';
  return fetch(metaUrl, { headers: { 'Authorization': 'Bearer ' + token } })
    .then(function(r) { return r.json(); })
    .then(function(meta) {
      var actualMime = meta.mimeType || mimeType || '';
      console.log('GC Deep: file', fileId, meta.name, actualMime, 'size:', meta.size);

      // Google-native types we missed above
      if (actualMime.startsWith('application/vnd.google-apps.')) {
        var expUrl = 'https://www.googleapis.com/drive/v3/files/' + fileId + '/export?mimeType=text/plain';
        return fetch(expUrl, { headers: { 'Authorization': 'Bearer ' + token } })
          .then(function(r) { return r.ok ? r.text() : ''; })
          .then(function(t) { return (t || '').substring(0, 50000); });
      }

      // For PDFs: Use Google Drive's "copy as Google Doc" trick
      // This leverages Google's server-side OCR/text extraction
      if (actualMime === 'application/pdf') {
        return extractPdfViaGoogleDoc(token, fileId, meta.name || 'file');
      }

      // Skip files > 10MB
      var fileSize = parseInt(meta.size || '0', 10);
      if (fileSize > 10 * 1024 * 1024) return '';

      // For text-like files: download directly
      if (actualMime.startsWith('text/') ||
          actualMime === 'application/json' ||
          actualMime === 'application/xml' ||
          actualMime === 'application/csv') {
        var dlUrl = 'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media';
        return fetch(dlUrl, { headers: { 'Authorization': 'Bearer ' + token } })
          .then(function(r) { return r.ok ? r.text() : ''; })
          .then(function(t) { return (t || '').substring(0, 50000); });
      }

      return '';
    })
    .catch(function(e) { console.log('GC Deep: metadata error', fileId, e); return ''; });
}

// Convert PDF to Google Doc (server-side), export as text, then delete the temp doc.
// This is the most reliable way to extract text from PDFs in a service worker
// because Google does the heavy lifting (handles compressed streams, fonts, OCR, etc.)
function extractPdfViaGoogleDoc(token, fileId, fileName) {
  // Step 1: Copy the PDF as a Google Doc
  var copyUrl = 'https://www.googleapis.com/drive/v3/files/' + fileId + '/copy';
  return fetch(copyUrl, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: '_gcn_temp_' + fileName,
      mimeType: 'application/vnd.google-apps.document'
    })
  })
  .then(function(r) {
    if (!r.ok) {
      console.log('GC Deep: copy-as-doc failed', fileId, r.status);
      // Fallback: try raw download + basic extraction
      return { fallback: true };
    }
    return r.json();
  })
  .then(function(copyData) {
    if (copyData.fallback) {
      return extractPdfRawFallback(token, fileId);
    }

    var tempDocId = copyData.id;
    if (!tempDocId) {
      console.log('GC Deep: no doc ID from copy', copyData);
      return extractPdfRawFallback(token, fileId);
    }

    // Step 2: Export the Google Doc as plain text
    var expUrl = 'https://www.googleapis.com/drive/v3/files/' + tempDocId + '/export?mimeType=text/plain';
    return fetch(expUrl, { headers: { 'Authorization': 'Bearer ' + token } })
      .then(function(r) { return r.ok ? r.text() : ''; })
      .then(function(text) {
        // Step 3: Delete the temp doc (fire and forget)
        fetch('https://www.googleapis.com/drive/v3/files/' + tempDocId, {
          method: 'DELETE',
          headers: { 'Authorization': 'Bearer ' + token }
        }).catch(function() {}); // ignore delete errors

        console.log('GC Deep: extracted', (text || '').length, 'chars from PDF', fileId);
        return (text || '').substring(0, 50000);
      });
  })
  .catch(function(e) {
    console.log('GC Deep: PDF extraction error', fileId, e);
    return extractPdfRawFallback(token, fileId);
  });
}

// Fallback: download raw PDF bytes and do basic text extraction
// Works for PDFs with uncompressed text streams
function extractPdfRawFallback(token, fileId) {
  var dlUrl = 'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media';
  return fetch(dlUrl, { headers: { 'Authorization': 'Bearer ' + token } })
    .then(function(r) {
      if (!r.ok) return '';
      return r.arrayBuffer();
    })
    .then(function(buf) {
      if (!buf) return '';
      return extractTextFromPdfBuffer(buf);
    })
    .catch(function() { return ''; });
}

// Basic PDF text extractor — reads stream objects and pulls out text between BT/ET blocks.
// Only works for uncompressed text streams (fallback if Google Doc conversion fails).
function extractTextFromPdfBuffer(buffer) {
  try {
    var bytes = new Uint8Array(buffer);
    var text = '';
    var limit = Math.min(bytes.length, 5 * 1024 * 1024);
    var raw = '';
    var chunkSize = 65536;
    for (var offset = 0; offset < limit; offset += chunkSize) {
      var end = Math.min(offset + chunkSize, limit);
      var chunk = bytes.subarray(offset, end);
      for (var i = 0; i < chunk.length; i++) {
        raw += String.fromCharCode(chunk[i]);
      }
    }

    // Method 1: Extract text from parenthesized strings in BT..ET blocks
    var btMatches = raw.match(/BT[\s\S]*?ET/g) || [];
    btMatches.forEach(function(block) {
      var textParts = block.match(/\(([^)]*)\)/g) || [];
      textParts.forEach(function(part) {
        var inner = part.substring(1, part.length - 1);
        inner = inner.replace(/\\n/g, '\n').replace(/\\r/g, '\r')
                     .replace(/\\t/g, '\t').replace(/\\\(/g, '(')
                     .replace(/\\\)/g, ')').replace(/\\\\/g, '\\');
        text += inner + ' ';
      });
      text += '\n';
    });

    // Method 2: If BT/ET extraction got very little, try raw string extraction
    if (text.trim().length < 50) {
      var altParts = raw.match(/\(([^)]{2,})\)/g) || [];
      var altText = '';
      altParts.forEach(function(part) {
        var inner = part.substring(1, part.length - 1);
        if (/^[\x20-\x7E\s]{2,}$/.test(inner)) {
          altText += inner + ' ';
        }
      });
      if (altText.trim().length > text.trim().length) {
        text = altText;
      }
    }

    text = text.replace(/\s+/g, ' ').trim();
    console.log('GC Deep: raw fallback extracted', text.length, 'chars');
    return text;
  } catch(e) {
    return '';
  }
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