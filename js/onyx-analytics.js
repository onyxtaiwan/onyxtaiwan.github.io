/*
 * ONYX analytics (Google Analytics 4).
 * - Off until GA_ID is set in js/onyx-config.js (e.g. "G-XXXXXXXXXX").
 * - Visitors whose time zone is in Europe (EU / UK rules) see a small consent bar; nothing is recorded until they accept.
 *   Everyone else is measured without a bar.
 * - window.onyxTrack(name, params) sends an event; clicks on WhatsApp links are sent as "whatsapp_click".
 */
(function () {
  var cfg = window.ONYX_SETTINGS || {}, id = String(cfg.GA_ID || '').trim();
  var queue = [];
  window.onyxTrack = function (name, params) { if (window.gtag && window.__onyxGa) window.gtag('event', name, params || {}); else queue.push([name, params || {}]); };
  if (!/^G-[A-Z0-9]+$/.test(id)) return;

  var KEY = 'onyx-consent';
  function stored() { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
  function store(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  function inEurope() {
    var tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
    return /^Europe\//.test(tz) || /^Atlantic\/(Canary|Madeira|Azores|Reykjavik|Faroe)$/.test(tz);
  }
  function load() {
    if (window.__onyxGa) return;
    window.__onyxGa = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', id);
    var s = document.createElement('script'); s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
    document.head.appendChild(s);
    queue.splice(0).forEach(function (e) { window.gtag('event', e[0], e[1]); });
  }
  function bar() {
    var b = document.createElement('div');
    b.id = 'onyx-consent';
    b.setAttribute('role', 'region'); b.setAttribute('aria-label', 'Cookie consent');
    b.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:300;background:#151515;color:#eee;border-top:1px solid #333;' +
      'padding:12px max(16px,env(safe-area-inset-right,0px)) calc(12px + env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px));' +
      'display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:center;font:14px/1.4 Inter,system-ui,sans-serif';
    b.innerHTML = '<span>We use cookies to measure site traffic.</span>' +
      '<button type="button" data-c="yes" style="background:#d4af37;color:#111;border:0;border-radius:6px;padding:8px 16px;font-weight:700;cursor:pointer">Accept</button>' +
      '<button type="button" data-c="no" style="background:none;color:#eee;border:1px solid #555;border-radius:6px;padding:8px 16px;cursor:pointer">Decline</button>';
    b.addEventListener('click', function (e) {
      var c = e.target && e.target.getAttribute && e.target.getAttribute('data-c'); if (!c) return;
      store(c === 'yes' ? 'granted' : 'denied'); b.remove(); if (c === 'yes') load();
    });
    document.body.appendChild(b);
  }

  // WhatsApp clicks anywhere on the page
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href*="wa.me/"]') : null;
    if (a) window.onyxTrack('whatsapp_click', { link_url: a.href.split('?')[0], page_path: location.pathname });
  }, true);

  var c = stored();
  if (!inEurope() || c === 'granted') load();
  else if (c !== 'denied') { if (document.body) bar(); else document.addEventListener('DOMContentLoaded', bar); }
})();
