/* Interface language: Azerbaijani (as written), English or Russian.
 *
 * The pages are written in Azerbaijani. This layer replaces the interface
 * text on screen with the chosen language, from window.I18N_DICT[lang]
 * ({ "Azerbaijani text": "translation" }, assets/js/i18n-dict.js). Keys with
 * {0}, {1}… match text that has values in it ("{0} elan" ↔ "5 elan"). Text
 * joined with " · " or " — " is translated piece by piece. What people wrote
 * (names, job titles, posts) is not in the dictionaries and stays as written.
 *
 * Every text node and attribute keeps its Azerbaijani original, so switching
 * the language back and forth loses nothing. New and changed content is
 * translated by a MutationObserver before the browser paints it.
 * Elements marked translate="no" or .notranslate are left alone.
 */
(function () {
  'use strict';
  var LANGS = ['az', 'en', 'ru'];
  var STORE = 'asoiu-lang';
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  var SKIP = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 1, CODE: 1, PRE: 1, TEMPLATE: 1 };
  var LETTER = /[A-Za-zƏəŞşÇçĞğİıÖöÜü]/;
  var SEP = /( · | — | – | \| | • | → )/;

  var lang = initial();
  var exact = new Map();
  var patterns = [];
  var loadedFor = null;
  // The dictionaries (~280 KB) are fetched only for English and Russian, with
  // the same ?v= as this file.
  var me = document.currentScript;
  var DICT_URL = me && me.src ? me.src.replace(/i18n\.js(\?[^#]*)?$/, 'i18n-dict.js$1') : 'assets/js/i18n-dict.js';
  var dictWaiters = null;
  function withDict(done) {
    if (window.I18N_DICT) return done();
    if (dictWaiters) return dictWaiters.push(done);
    dictWaiters = [done];
    var s = document.createElement('script');
    s.src = DICT_URL;
    s.onload = function () { var w = dictWaiters; dictWaiters = null; w.forEach(function (f) { f(); }); };
    s.onerror = function () { dictWaiters = null; };
    document.head.appendChild(s);
  }
  var origText = new WeakMap();   // text node → Azerbaijani original
  var lastText = new WeakMap();   // text node → what this layer wrote last
  var origAttr = new WeakMap();   // element → { attribute: original }
  var lastAttr = new WeakMap();   // element → { attribute: what this layer wrote }
  // Sentences with inline markup whose word order changes ("İxtisasına uyğun
  // <span>karyeranı</span> tap" → "Find a <span>career</span> that fits your
  // major"): the dictionary key names the inline elements <0>…</0>, <1>…</1>.
  var INLINE = { B: 1, STRONG: 1, SPAN: 1, EM: 1, I: 1, A: 1, SMALL: 1, U: 1, MARK: 1, BR: 1 };
  var mixedExact = new Map();
  var mixedPatterns = [];
  var mixedOrig = new WeakMap();  // element → its original children (clones)
  var mixedDone = new WeakSet();  // elements this layer rebuilt

  function initial() {
    try {
      var saved = localStorage.getItem(STORE);
      if (LANGS.indexOf(saved) >= 0) return saved;
      // Picked in the CV builder before the site had a language switch.
      var cv = localStorage.getItem('rg_lang');
      if (LANGS.indexOf(cv) >= 0) return cv;
    } catch (e) { /* storage blocked */ }
    return 'az';
  }

  var norm = function (s) { return String(s).replace(/\s+/g, ' ').trim(); };
  var escapeRx = function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };

  function load() {
    if (loadedFor === lang || (lang !== 'az' && !window.I18N_DICT)) return;
    loadedFor = lang;
    exact = new Map();
    patterns = [];
    mixedExact = new Map();
    mixedPatterns = [];
    var dict = (window.I18N_DICT || {})[lang] || {};
    Object.keys(dict).forEach(function (az) {
      var key = norm(az), tr = dict[az];
      if (!tr) return;
      if (/<\d+>|<br>/.test(key)) {
        if (!/\{\d+\}/.test(key)) { mixedExact.set(key, tr); return; }
        var slots = [];
        var rx = key.split(/(\{\d+\})/).map(function (part) {
          var m = /^\{(\d+)\}$/.exec(part);
          if (m) { slots.push(Number(m[1])); return '(.+?)'; }
          return escapeRx(part);
        }).join('');
        mixedPatterns.push({ rx: new RegExp('^' + rx + '$'), order: slots, tr: tr });
        return;
      }
      if (/\{\d+\}/.test(key)) {
        var order = [];
        var body = key.split(/(\{\d+\})/).map(function (part) {
          var m = /^\{(\d+)\}$/.exec(part);
          if (m) { order.push(Number(m[1])); return '(.+?)'; }
          return escapeRx(part);
        }).join('');
        patterns.push({ rx: new RegExp('^' + body + '$'), order: order, tr: tr, fixed: key.replace(/\{\d+\}/g, '').length });
      } else {
        exact.set(key, tr);
      }
    });
    // The most specific pattern (most fixed text) wins.
    patterns.sort(function (a, b) { return b.fixed - a.fixed; });
  }

  // Month names in dates ("2 Okt 2026", "26 noyabr", "noyabr 2026").
  var AZ_MONTHS = [
    ['Yan', 'Yanvar'], ['Fev', 'Fevral'], ['Mar', 'Mart'], ['Apr', 'Aprel'], ['May', 'May'], ['İyn', 'İyun'],
    ['İyl', 'İyul'], ['Avq', 'Avqust'], ['Sen', 'Sentyabr'], ['Okt', 'Oktyabr'], ['Noy', 'Noyabr'], ['Dek', 'Dekabr']
  ];
  var MONTHS = {
    en: { short: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      long: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] },
    ru: { short: ['янв.', 'фев.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сен.', 'окт.', 'ноя.', 'дек.'],
      // after a day number (genitive), and on its own (a calendar title)
      long: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
      alone: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'] }
  };
  var monthIndex = {};
  AZ_MONTHS.forEach(function (pair, i) {
    [pair[0], pair[1]].forEach(function (name, longForm) {
      [name, name.toLowerCase(), name.replace('İ', 'I'), name.replace('İ', 'i')].forEach(function (v) { monthIndex[v] = { i: i, long: !!longForm }; });
    });
  });
  var monthWord = '(' + Object.keys(monthIndex).sort(function (a, b) { return b.length - a.length; }).map(escapeRx).join('|') + ')';
  var DAY_MONTH = new RegExp('(\\d{1,2})\\.? ' + monthWord + '(?![A-Za-zƏəŞşÇçĞğİıÖöÜü])', 'g');
  var MONTH_YEAR = new RegExp('^' + monthWord + ',? (\\d{4})$');

  function localizeDates(s) {
    var names = MONTHS[lang];
    if (!names) return s;
    var out = s.replace(DAY_MONTH, function (_, day, word) {
      var m = monthIndex[word];
      return day + ' ' + (m.long ? names.long[m.i] : names.short[m.i]);
    });
    var my = MONTH_YEAR.exec(out);
    if (my && monthIndex[my[1]]) out = (names.alone || names.long)[monthIndex[my[1]].i] + ' ' + my[2];
    return out;
  }

  /** One piece of text: exact, then without end punctuation, then a pattern
   *  (whose values are translated too: "Son tarix {0}" with "2 Okt 2026 (bitib)"). */
  function piece(s, depth) {
    if (exact.has(s)) return exact.get(s);
    var m = /^(.*?)([:.!?…]+)$/.exec(s);
    if (m && m[1] && exact.has(m[1])) return exact.get(m[1]) + m[2];
    // A leading icon ("▦ Əyani", "◷ 2 həftə"): the words after it.
    var icon = /^([^0-9A-Za-zƏəŞşÇçĞğİıÖöÜü«“"'(]+)(\S.*)$/.exec(s);
    if (icon && (depth || 0) < 3) { var rest = piece(icon[2], (depth || 0) + 1); if (rest !== null) return icon[1] + rest; }
    for (var i = 0; i < patterns.length; i++) {
      var p = patterns[i], hit = p.rx.exec(s);
      if (!hit) continue;
      var values = {};
      p.order.forEach(function (n, k) { values[n] = value(hit[k + 1], (depth || 0) + 1); });
      return p.tr.replace(/\{(\d+)\}/g, function (_, n) { return values[n] !== undefined ? values[n] : ''; });
    }
    return null;
  }
  function value(v, depth) {
    if (depth > 3) return v;
    var t = piece(v, depth);
    return t !== null ? t : localizeDates(v);
  }

  /** The translation of a whole text, or null when nothing in it is known. */
  function lookup(s) {
    if (!s || !LETTER.test(s)) return null;
    var t = piece(s);
    if (t !== null) return t;
    if (SEP.test(s)) {
      var changed = false;
      var parts = s.split(SEP).map(function (part, i) {
        if (i % 2) return part;
        var p = part.trim() ? piece(part.trim()) : null;
        if (p === null) return part;
        changed = true;
        return part.replace(part.trim(), p);
      });
      if (changed) return parts.join('');
    }
    var colon = s.indexOf(': ');
    if (colon > 0 && colon < 60) {
      var label = piece(s.slice(0, colon));
      if (label !== null) { var rest = s.slice(colon + 2); return label + ': ' + (lookup(rest) || rest); }
    }
    return null;
  }

  /** Text as shown, with its own leading and trailing spaces kept. */
  function translateString(src) {
    if (lang === 'az' || typeof src !== 'string') return src;
    load();
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(src);
    var core = norm(m[2]);
    var t = lookup(core);
    if (t === null && /\S[ \t]*\n\s*\S/.test(m[2])) {
      // Text kept on several lines (a report) and not known as a whole: line by line.
      var lines = src.split('\n'), parts = lines.map(translateString);
      if (parts.some(function (p, i) { return p !== lines[i]; })) return parts.join('\n');
    }
    if (t === null) { var d = localizeDates(core); if (d !== core) t = d; }
    return t === null ? src : m[1] + t + m[3];
  }

  /** "text <0>inline</0> text" for an element of text and plain inline
   *  elements, or null. */
  function mixedKey(el) {
    var kids = el.childNodes, parts = [], n = 0, text = false, inline = false;
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k.nodeType === 3) { if (LETTER.test(k.data)) text = true; parts.push(k.data); }
      else if (k.nodeType === 1 && INLINE[k.tagName] && !k.children.length) {
        inline = true;
        parts.push(k.tagName === 'BR' ? '<br>' : '<' + n + '>' + k.textContent + '</' + (n++) + '>');
      } else if (k.nodeType !== 8) return null;
    }
    return text && inline ? norm(parts.join('')) : null;
  }

  function mixedTranslation(key) {
    if (mixedExact.has(key)) return mixedExact.get(key);
    for (var i = 0; i < mixedPatterns.length; i++) {
      var p = mixedPatterns[i], hit = p.rx.exec(key);
      if (!hit) continue;
      var values = {};
      p.order.forEach(function (n, k) { values[n] = value(hit[k + 1], 1); });
      return p.tr.replace(/\{(\d+)\}/g, function (_, n) { return values[n] !== undefined ? values[n] : ''; });
    }
    return null;
  }

  /** Rebuilds the element from the translation, reusing its own inline
   *  elements (their classes and links) in the new order. */
  function applyMixed(el, tr) {
    var source = mixedOrig.get(el);
    if (!source) {
      source = Array.prototype.map.call(el.childNodes, function (c) { return c.cloneNode(true); });
      mixedOrig.set(el, source);
    }
    var inline = source.filter(function (c) { return c.nodeType === 1 && c.tagName !== 'BR'; });
    var frag = document.createDocumentFragment();
    var rx = /<(\d+)>([\s\S]*?)<\/\1>|<br>/g, last = 0, m;
    while ((m = rx.exec(tr))) {
      if (m.index > last) frag.appendChild(document.createTextNode(tr.slice(last, m.index)));
      if (m[0] === '<br>') frag.appendChild(document.createElement('br'));
      else {
        var copy = inline[Number(m[1])] ? inline[Number(m[1])].cloneNode(false) : document.createElement('span');
        copy.textContent = m[2];
        frag.appendChild(copy);
      }
      last = rx.lastIndex;
    }
    if (last < tr.length) frag.appendChild(document.createTextNode(tr.slice(last)));
    mixedDone.add(el);
    el.replaceChildren(frag);
  }

  function restoreMixed(el) {
    var source = mixedOrig.get(el);
    mixedDone.delete(el);
    if (source) el.replaceChildren.apply(el, source.map(function (c) { return c.cloneNode(true); }));
  }

  /** For an element about to be walked: true when it was rebuilt as a whole
   *  (its children need no further work). */
  function doMixed(el) {
    if (mixedDone.has(el)) {
      if (lang === 'az' || !mixedOrig.has(el)) { restoreMixed(el); return false; }
      restoreMixed(el);
    }
    if (lang === 'az' || !(mixedExact.size || mixedPatterns.length)) return false;
    var key = mixedKey(el);
    var tr = key && mixedTranslation(key);
    if (!tr) return false;
    applyMixed(el, tr);
    return true;
  }

  function inMixed(node) {
    var p = node && node.parentElement;
    return !!p && (mixedDone.has(p) || (!!p.parentElement && mixedDone.has(p.parentElement)));
  }

  function skipped(el) {
    for (var e = el; e && e.nodeType === 1; e = e.parentElement) {
      if (SKIP[e.tagName] || e.isContentEditable) return true;
      if (e.getAttribute('translate') === 'no' || (e.classList && e.classList.contains('notranslate'))) return true;
    }
    return false;
  }

  function doText(n) {
    var cur = n.data;
    if (lastText.get(n) !== cur) origText.set(n, cur);   // the page wrote new text
    var src = origText.get(n);
    if (!src || !LETTER.test(src)) return;
    var out = translateString(src);
    if (out !== cur) n.data = out;
    lastText.set(n, out);
  }

  function doAttrs(el) {
    var o = origAttr.get(el) || {}, w = lastAttr.get(el) || {};
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      if (!el.hasAttribute(a)) continue;
      var cur = el.getAttribute(a);
      if (w[a] !== cur) o[a] = cur;
      var out = translateString(o[a]);
      if (out !== cur) el.setAttribute(a, out);
      w[a] = out;
    }
    origAttr.set(el, o); lastAttr.set(el, w);
  }

  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { if (!inMixed(root) && !skipped(root.parentElement)) doText(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1 && (skipped(root) || inMixed(root))) return;
    if (root.nodeType === 1) { doAttrs(root); if (doMixed(root)) return; }
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (node.nodeType === 1) {
          if (SKIP[node.tagName] || node.getAttribute('translate') === 'no' || node.classList.contains('notranslate') || node.isContentEditable) return NodeFilter.FILTER_REJECT;
          if (doMixed(node)) { doAttrs(node); return NodeFilter.FILTER_REJECT; }
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    for (var node = tw.nextNode(); node; node = tw.nextNode()) {
      if (node.nodeType === 3) doText(node); else doAttrs(node);
    }
  }

  var observer = new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.type === 'characterData') { if (!inMixed(r.target) && !skipped(r.target.parentElement)) doText(r.target); }
      else if (r.type === 'attributes') { if (!skipped(r.target)) doAttrs(r.target); }
      else for (var k = 0; k < r.addedNodes.length; k++) walk(r.addedNodes[k]);
    }
  });

  var observing = false;
  function observe() {
    if (observing) return;
    observing = true;
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  // In Azerbaijani nothing needs doing until another language is picked.
  function start() {
    if (lang === 'az') return;
    walk(document.documentElement);
    observe();
  }

  function markSwitchers() {
    var buttons = document.querySelectorAll('.lang-switch [data-lang]');
    for (var i = 0; i < buttons.length; i++) buttons[i].setAttribute('aria-pressed', String(buttons[i].getAttribute('data-lang') === lang));
  }

  function set(next) {
    if (LANGS.indexOf(next) < 0 || next === lang) return;
    lang = next;
    try {
      localStorage.setItem(STORE, lang);
      localStorage.setItem('rg_lang', lang);   // the CV builder follows the site
    } catch (e) { /* storage blocked */ }
    document.documentElement.lang = lang;
    markSwitchers();
    withDict(function () {
      if (lang !== next) return;   // another language was picked meanwhile
      apply();
    });
  }

  function apply() {
    load();
    walk(document.documentElement);
    observe();
    var frame = document.querySelector('.cv-builder-frame');
    try { if (frame && frame.contentWindow && frame.contentWindow.RG_APPLY_LANG) frame.contentWindow.RG_APPLY_LANG(lang); } catch (e) { /* other origin */ }
    document.dispatchEvent(new CustomEvent('i18n:change', { detail: lang }));
  }

  // Messages in alert/confirm/prompt dialogs.
  ['alert', 'confirm', 'prompt'].forEach(function (name) {
    var original = window[name];
    if (typeof original !== 'function') return;
    window[name] = function (message) {
      var args = Array.prototype.slice.call(arguments);
      args[0] = translateString(message);
      return original.apply(window, args);
    };
  });

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.lang-switch [data-lang]');
    if (!b) return;
    e.preventDefault();
    set(b.getAttribute('data-lang'));
  });

  window.I18n = {
    get lang() { return lang; },
    set: set,
    /** A string in the current language (for code that builds text itself). */
    t: translateString,
    /** The language buttons; the current one is pressed. */
    switcher: function (extraClass) {
      return '<div class="lang-switch notranslate' + (extraClass ? ' ' + extraClass : '') + '" role="group" aria-label="Dil / Language / Язык">' +
        LANGS.map(function (l) { return '<button type="button" data-lang="' + l + '" aria-pressed="' + (l === lang) + '">' + l.toUpperCase() + '</button>'; }).join('') + '</div>';
    },
    /** Text on screen that has no translation yet (for checking the dictionaries). */
    missing: function () {
      var out = new Set();
      var tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (var n = tw.nextNode(); n; n = tw.nextNode()) {
        if (skipped(n.parentElement)) continue;
        var s = norm(origText.get(n) || n.data);
        if (s && /[ƏəŞşÇçĞğİıÖöÜü]|\b(və|ilə|üçün)\b/.test(s) && lookup(s) === null) out.add(s);
      }
      return Array.from(out);
    }
  };

  document.documentElement.lang = lang;
  if (lang !== 'az' && !window.I18N_DICT) {
    // This file loads in <head>: the dictionaries are written in right after
    // it, so they run before the page body exists and nothing shows in Azerbaijani.
    if (document.readyState === 'loading') document.write('<script src="' + DICT_URL.replace(/"/g, '&quot;') + '"><\/script>');
    else withDict(apply);
  }
  // In another language, text added while the page loads is translated at once.
  if (lang !== 'az') observe();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
