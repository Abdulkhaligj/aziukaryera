/* AIDA — ADNSU Karyera assistant.
 * Uses the existing aida-chat Supabase Edge Function. No model keys in browser.
 * Chat history is kept only in memory during this page session. */
(() => {
  'use strict';
  if (document.getElementById('aida-assistant')) return;
  const icon = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="6" width="16" height="13" rx="4"/><path d="M12 3v3M8 12h.01M16 12h.01M9 16h6"/></svg>';
  const cross = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 5l14 14M19 5 5 19"/></svg>';
  const sendIcon = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="m22 2-7 20-4-9-9-4zM22 2 11 13"/></svg>';
  const host = document.createElement('aside');
  host.id = 'aida-assistant';
  host.className = 'aida-widget';
  host.setAttribute('aria-label', 'AIDA karyera köməkçisi');
  host.innerHTML = [
    '<button type="button" class="aida-launch" aria-expanded="false" aria-controls="aida-panel" aria-label="AIDA AI köməkçisini aç">',
       '<span class="aida-launch-symbol">',icon,'</span><span class="aida-launch-copy"><b>AIDA</b><small>AI köməkçi</small></span>',
    '</button>',
    '<section id="aida-panel" class="aida-panel" role="dialog" aria-label="AIDA — AI karyera köməkçisi" hidden>',
      '<header class="aida-header"><span class="aida-avatar">',icon,'</span>',
        '<div><strong>AIDA</strong><small>ADNSU Karyera · AI köməkçi</small></div>',
        '<button class="aida-close" type="button" aria-label="AIDA çatını bağla">',cross,'</button>',
      '</header>',
      '<div class="aida-chat" role="log" aria-live="polite" aria-relevant="additions text">',
        '<div class="aida-msg aida-bot"><span class="aida-bubble">Salam! Mən AIDA. Vakansiya, CV, müsahibə və ADNSU Karyera ilə bağlı suallarında kömək edə bilərəm.</span></div>',
      '</div>',
      '<div class="aida-extras"><div class="aida-suggestions">',
        '<button type="button" data-aida-question="CV-mi necə yaxşılaşdıra bilərəm?">CV tövsiyələri</button>',
        '<button type="button" data-aida-question="Mənə uyğun vakansiyaları necə tapa bilərəm?">Vakansiyalar</button>',
        '<button type="button" data-aida-question="Müsahibəyə necə hazırlaşım?">Müsahibə</button>',
      '</div></div>',
      '<form class="aida-form"><label for="aida-input" class="aida-sr">AIDA-ya sualın</label>',
        '<textarea id="aida-input" rows="1" maxlength="800" placeholder="Sualını yaz..." aria-label="AIDA-ya mesaj yaz"></textarea>',
        '<button type="submit" class="aida-send" aria-label="Mesajı AIDA-ya göndər">',sendIcon,'</button>',
      '</form>',
      '<p class="aida-disclaimer">AI səhv edə bilər. Şifrə və şəxsi kod paylaşma.</p>',
    '</section>'
  ].join('');
  document.body.appendChild(host);

  const launch = host.querySelector('.aida-launch');
  const panel = host.querySelector('.aida-panel');
  const close = host.querySelector('.aida-close');
  const form = host.querySelector('.aida-form');
  const input = host.querySelector('#aida-input');
  const log = host.querySelector('.aida-chat');
  const extras = host.querySelector('.aida-suggestions');
  const submit = host.querySelector('.aida-send');
  const messages = [];
  let busy = false;

  function open() {
    panel.hidden = false;
    launch.setAttribute('aria-expanded','true');
    launch.setAttribute('aria-label','AIDA AI çatını bağla');
    host.classList.add('is-open');
    input.focus();
  }
  function hide() {
    panel.hidden = true;
    launch.setAttribute('aria-expanded','false');
    launch.setAttribute('aria-label','AIDA AI köməkçisini aç');
    host.classList.remove('is-open');
    launch.focus();
  }
  launch.addEventListener('click', () => panel.hidden ? open() : hide());
  close.addEventListener('click', hide);
  document.addEventListener('click', event => {
    if (event.target.closest('[data-aida-open]')) { event.preventDefault(); open(); }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) { event.stopPropagation(); hide(); }
  });

  function message(role, value) {
    const row = document.createElement('div');
    row.className = 'aida-msg ' + (role === 'user' ? 'aida-user' : 'aida-bot');
    const bubble = document.createElement('span');
    bubble.className = 'aida-bubble';
    bubble.textContent = value;
    row.appendChild(bubble);
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
    return row;
  }
  function setExtras(suggestions, links) {
    extras.replaceChildren();
    (Array.isArray(links) ? links : []).slice(0,2).forEach(link => {
      const allowed = ['jobs','events','benefits','awards','cv','interview','roadmap','profile','applications','register','faq'];
      if (!link || !allowed.includes(link.target)) return;
      const button = document.createElement('button');
      button.type='button';
      button.className='aida-link';
      button.dataset.aidaLink=link.target;
      button.textContent=String(link.label || 'Bölməyə keç').slice(0,55);
      extras.appendChild(button);
    });
    (Array.isArray(suggestions) ? suggestions : []).slice(0,3).forEach(question => {
      if (!String(question).trim()) return;
      const button = document.createElement('button');
      button.type='button';
      button.dataset.aidaQuestion=String(question).slice(0,800);
      button.textContent=String(question).slice(0,65);
      extras.appendChild(button);
    });
  }

  function openSection(target) {
    if (target === 'register') {
      const button = document.querySelector('[data-lp="auth-register"], [data-act="auth-tab"][data-tab="register"]');
      if (button) { hide(); button.click(); }
      return;
    }
    const viewName = target === 'jobs' ? 'jobs' : target === 'benefits' ? 'benefits' : target;
    const nav = Array.from(document.querySelectorAll('.rail a[data-view]')).find(x => x.dataset.view === viewName);
    if (nav) { hide(); nav.click(); return; }
    const ids = {jobs:'lp-jobs',events:'lp-events',benefits:'lp-perks',awards:'lp-awards',faq:'lp-faq'};
    const section = ids[target] && document.getElementById(ids[target]);
    if (section) { hide(); section.scrollIntoView({behavior:'smooth',block:'start'}); return; }
    const auth = document.querySelector('[data-lp="auth"], [data-act="auth-open"]');
    if (auth) { hide(); auth.click(); }
  }

  async function send(question) {
    const text = String(question || '').trim().slice(0,800);
    if (!text || busy) return;
    const history = messages.slice(-10);
    message('user',text);
    messages.push({role:'user',text});
    input.value = '';
    busy=true;
    submit.disabled=true;
    extras.replaceChildren();
    const waiting=message('assistant','AIDA cavab hazırlayır…');
    waiting.classList.add('aida-waiting');
    try {
      if (typeof Backend === 'undefined' || !Backend.init() || !Backend.sb || !Backend.sb.functions)
        throw new Error('connection unavailable');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 24000);
      let response;
      try {
        response = await Backend.sb.functions.invoke('aida-chat', {
          body: {message:text,history},
          signal:controller.signal
        });
      } finally { clearTimeout(timer); }
      if (response.error) throw response.error;
      const result=response.data;
      if (!result || result.ok !== true || !String(result.reply || '').trim())
        throw new Error(result && result.error ? result.error : 'AI cavabı alınmadı');
      const reply=String(result.reply).slice(0,2500);
      waiting.querySelector('.aida-bubble').textContent=reply;
      messages.push({role:'assistant',text:reply});
      setExtras(result.suggestions,result.links);
    } catch (error) {
      const detail=String(error && error.message || '');
      const notice=/limit|dolub/i.test(detail) ? detail : 'AIDA hazırda cavab verə bilmir. Yenidən yoxlayın və ya career@asoiu.edu.az ünvanına müraciət edin.';
      waiting.querySelector('.aida-bubble').textContent=notice;
    } finally {
      waiting.classList.remove('aida-waiting');
      busy=false;
      submit.disabled=false;
      log.scrollTop=log.scrollHeight;
      if (!panel.hidden) input.focus();
    }
  }
  form.addEventListener('submit', event => {event.preventDefault();send(input.value);});
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {event.preventDefault();send(input.value);}
  });
  extras.addEventListener('click', event => {
    const button=event.target.closest('button');
    if (!button) return;
    if (button.dataset.aidaQuestion) send(button.dataset.aidaQuestion);
    else if (button.dataset.aidaLink) openSection(button.dataset.aidaLink);
  });
})();