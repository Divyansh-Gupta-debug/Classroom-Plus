var keyInput = document.getElementById('api-key');
var status = document.getElementById('api-status');

chrome.storage.local.get('gemini_api_key', function(d) {
  if (d.gemini_api_key) {
    keyInput.value = d.gemini_api_key;
    if (status) { status.textContent = '✅ Key saved'; status.style.color = '#34a853'; }
  }
});

var st;
keyInput.addEventListener('input', function() {
  clearTimeout(st);
  st = setTimeout(function() {
    var k = keyInput.value.trim();
    if (k) {
      chrome.storage.local.set({ gemini_api_key: k }, function() {
        if (status) { status.textContent = '✅ Key saved'; status.style.color = '#34a853'; }
      });
    } else {
      chrome.storage.local.remove('gemini_api_key', function() {
        if (status) { status.textContent = 'Key removed'; status.style.color = '#f29900'; }
      });
    }
  }, 500);
});