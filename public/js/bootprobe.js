// Temporary boot diagnostic probe (CSP-safe classic script).
// Logs boot milestones into #bootprobe so they can be read without DevTools.
(function () {
  function log(msg) {
    try {
      var el = document.getElementById('bootprobe');
      if (!el) {
        el = document.createElement('div');
        el.id = 'bootprobe';
        el.setAttribute('style', 'position:fixed;left:0;bottom:0;z-index:99999;max-width:100%;background:#000;color:#0f0;font:10px/1.4 monospace;white-space:pre-wrap;padding:4px;pointer-events:none;');
        (document.body || document.documentElement).appendChild(el);
      }
      el.textContent += '[' + new Date().toISOString().slice(11, 23) + '] ' + msg + '\n';
    } catch (e) {}
  }
  window.__bootprobe = log;
  log('probe: classic script executed, readyState=' + document.readyState);
  document.addEventListener('DOMContentLoaded', function () { log('probe: DOMContentLoaded'); });
  window.addEventListener('load', function () { log('probe: window load'); });
  window.addEventListener('error', function (e) {
    log('probe: window.onerror: ' + (e.message || e.type) + ' @ ' + (e.filename || '') + ':' + (e.lineno || ''));
  }, true);
})();
