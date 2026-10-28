/*!
 * ADNSU / ASOIU Career — mentor-ai.js
 *
 * Mentor dəstəyi səhifəsinə "AI mentor" bölməsi əlavə edir: tələbə istiqamət
 * seçir və dərhal AI məsləhəti alır (AIDA-nın aida-chat backendi; cavablar
 * tələbənin profilindəki fakültə, ixtisas və bacarıqlara əsaslanır). AI
 * kifayət etməsə, sual bir kliklə insan mentora müraciət formasına köçürülür.
 * mentor.js-in özünə toxunmur — yalnız tələbə səhifəsinin HTML-inə bölmə qoşur.
 */
(() => {
  if (typeof MentorUI === 'undefined') return;

  const STARTERS = {
    karyera: ['Mənim ixtisasımla hansı vəzifələrə baxım?', 'Növbəti 6 ayda nəyi öyrənməliyəm?'],
    cv: ['CV-mdə ən çox nəyi düzəltməliyəm?', 'Təcrübəm azdırsa, CV-ni necə doldurum?'],
    'müsahibə': ['İlk müsahibəyə necə hazırlaşım?', '"Özünüz haqqında danışın" sualına necə cavab verim?'],
    texniki: ['İxtisasım üçün hansı proqramları öyrənim?', 'Hansı sertifikatlar dəyərlidir?'],
    startap: ['Layihə ideyamı necə yoxlayım?', 'Layihə üçün komanda üzvlərini necə tapım?'],
    magistr: ['Magistraturaya getməyə dəyərmi?', 'Xaricdə magistr üçün necə hazırlaşım?'],
    'şəbəkələşmə': ['LinkedIn profilimi necə gücləndirim?', 'Sənaye mütəxəssisləri ilə necə əlaqə qurum?']
  };
  const VIEWS = new Set(['jobs', 'events', 'benefits', 'awards', 'cv', 'interview', 'roadmap', 'profile', 'applications']);

  const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const key = () => 'mentor.ai.v1:' + ((typeof Auth !== 'undefined' && Auth.currentUser()?.id) || 'guest');
  const load = () => { try { return JSON.parse(sessionStorage.getItem(key()) || '[]'); } catch { return []; } };
  const save = () => { try { sessionStorage.setItem(key(), JSON.stringify(st.msgs.slice(-30))); } catch { /* gizli rejim */ } };
  const catName = id => (MentorUI.types.find(x => x[0] === id) || [id, id])[1];

  const st = { cat: 'karyera', msgs: null, busy: false, draft: '', owner: '' };
  function ensure() {
    if (st.msgs === null || st.owner !== key()) { st.owner = key(); st.msgs = load(); }
  }

  function bubble(m, i, last) {
    if (m.role === 'user') return `<div class="mai-msg me"><span class="mai-cat">${h(catName(m.cat))}</span><p>${h(m.text)}</p></div>`;
    const links = (m.links || []).filter(l => VIEWS.has(l.target) && document.querySelector(`.rail [data-act="go"][data-view="${l.target}"]`))
      .map(l => `<button type="button" class="mai-link" data-act="go" data-view="${h(l.target)}">${h(l.label || l.target)} →</button>`).join('');
    const chips = last && (m.suggestions || []).length
      ? `<div class="mai-chips">${m.suggestions.map(q => `<button type="button" data-mai="ask" data-q="${h(q)}">${h(q)}</button>`).join('')}</div>` : '';
    return `<div class="mai-msg bot${m.error ? ' err' : ''}">
      <p>${h(m.text).replace(/\n/g, '<br>')}</p>
      ${links || !m.error ? `<div class="mai-actions">${links}${m.error ? '' : `<button type="button" class="mai-handoff" data-mai="handoff" data-i="${i}">İnsan mentora müraciət et →</button>`}</div>` : ''}
    </div>${chips}`;
  }

  function body() {
    ensure();
    const lastBot = st.msgs.map(m => m.role).lastIndexOf('assistant');
    const log = st.msgs.length
      ? st.msgs.map((m, i) => bubble(m, i, i === lastBot && !st.busy)).join('')
      : `<div class="mai-empty"><b>${h(catName(st.cat))} üzrə nə soruşmaq istəyirsən?</b>
          <div class="mai-chips">${(STARTERS[st.cat] || []).map(q => `<button type="button" data-mai="ask" data-q="${h(q)}">${h(q)}</button>`).join('')}</div></div>`;
    return `
      <div class="mai-head">
        <span class="mai-mark" aria-hidden="true">✦</span>
        <div><h2 id="mentor-ai-title">AI mentor — dərhal məsləhət</h2>
          <p>İnsan mentor təyin olunana qədər növbəti addımlarını AI ilə planla. Cavablar profilindəki fakültə, ixtisas və bacarıqlara əsaslanır.</p></div>
        ${st.msgs.length ? '<button type="button" class="btn sm" data-mai="reset">Yeni söhbət</button>' : ''}
      </div>
      <div class="mai-cats" role="group" aria-label="Dəstək istiqaməti">
        ${MentorUI.types.map(([id, n, , ico]) => `<button type="button" data-mai="cat" data-cat="${h(id)}" aria-pressed="${st.cat === id}"><span aria-hidden="true">${ico}</span>${h(n)}</button>`).join('')}
      </div>
      <div class="mai-log" aria-live="polite">${log}${st.busy ? '<div class="mai-msg bot typing" aria-label="AI mentor yazır"><span></span><span></span><span></span></div>' : ''}</div>
      <form class="mai-compose" id="mentor-ai-form">
        <label class="sr-only" for="mentor-ai-input">AI mentora sual</label>
        <textarea id="mentor-ai-input" rows="2" maxlength="700" placeholder="${h(catName(st.cat))} üzrə sualını yaz…">${h(st.draft)}</textarea>
        <button type="submit" class="btn primary" ${st.busy ? 'disabled' : ''}>${st.busy ? 'Yazır…' : 'Soruş'}</button>
      </form>
      <p class="mai-note">AI məsləhəti mentor görüşünü əvəz etmir və səhv edə bilər. Dərin dəstək üçün aşağıdakı formadan insan mentora müraciət et.</p>`;
  }

  const section = () => `<section class="card mentor-ai" id="mentor-ai" aria-labelledby="mentor-ai-title">${body()}</section>`;

  /* Yalnız AI bölməsini yeniləyir — səhifənin qalanı və formadakı yazılar toxunulmaz qalır */
  function paint(focus) {
    const el = document.getElementById('mentor-ai');
    if (!el) return;
    el.innerHTML = body();
    const log = el.querySelector('.mai-log');
    if (log) log.scrollTop = log.scrollHeight;
    if (focus) el.querySelector('#mentor-ai-input')?.focus();
  }

  const base = MentorUI.studentPage.bind(MentorUI);
  MentorUI.studentPage = function () {
    const html = base();
    return html.includes('<div class="mentor-two-col">') ? html.replace('<div class="mentor-two-col">', section() + '<div class="mentor-two-col">') : html + section();
  };

  async function ask(raw) {
    const text = String(raw || '').trim().slice(0, 700);
    if (!text || st.busy) return;
    ensure();
    const history = st.msgs.filter(m => !m.error).slice(-8).map(m => ({ role: m.role, text: m.text }));
    st.msgs.push({ role: 'user', text, cat: st.cat });
    st.busy = true; st.draft = '';
    save(); paint();
    let reply;
    try {
      /* AIDA vidcetindən asılı olmadan birbaşa aida-chat funksiyasına müraciət */
      const askAida = window.AidaChat && window.AidaChat.ask ? window.AidaChat.ask : async (message, hist) => {
        const sb = typeof Backend !== 'undefined' && Backend.init() ? Backend.sb : null;
        if (!sb) throw new Error('offline');
        const { data, error } = await sb.functions.invoke('aida-chat', { body: { message, history: hist } });
        if (error || !data) throw new Error('network');
        return data;
      };
      const data = await askAida(`[Mentor dəstəyi, istiqamət: ${catName(st.cat)}] Tələbə mentordan soruşur: ${text}\nKonkret, addım-addım, ixtisasına uyğun məsləhət ver.`, history);
      reply = data.ok
        ? { role: 'assistant', text: data.reply, links: data.links || [], suggestions: data.suggestions || [], cat: st.cat }
        : { role: 'assistant', text: data.error || 'AI mentor hazırda cavab verə bilmir.', error: true };
    } catch {
      reply = { role: 'assistant', text: 'AI mentor ilə əlaqə alınmadı. İnternet bağlantısını yoxlayıb yenidən yaz.', error: true };
    }
    st.busy = false;
    st.msgs.push(reply);
    save(); paint(true);
  }

  /* AI cavabından sonra sualı insan mentora müraciət formasına köçürür */
  function handoff(i) {
    const reply = st.msgs[i];
    const question = [...st.msgs.slice(0, i)].reverse().find(m => m.role === 'user');
    if (!question) return;
    const f = id => document.getElementById(id);
    if (f('mentor-category')) f('mentor-category').value = question.cat || st.cat;
    if (f('mentor-topic')) f('mentor-topic').value = question.text.length > 140 ? question.text.slice(0, 137) + '…' : question.text.padEnd(5, '.');
    if (f('mentor-details')) {
      const own = `Sualım: ${question.text}`;
      const ai = reply && reply.text ? `\n\nAI mentorun ilkin məsləhəti (mentorun nəzərinə):\n${reply.text}` : '';
      f('mentor-details').value = (own + ai).slice(0, 1800);
    }
    f('mentor-form-box')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    f('mentor-details')?.focus({ preventScroll: true });
    if (typeof toast === 'function') toast('Sual müraciət formasına köçürüldü — yoxlayıb göndər');
  }

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-mai]');
    if (!t || !t.closest('#mentor-ai')) return;
    const act = t.dataset.mai;
    if (act === 'cat') { st.cat = t.dataset.cat; paint(); }
    else if (act === 'ask') ask(t.dataset.q || t.textContent);
    else if (act === 'reset') { st.msgs = []; save(); paint(true); }
    else if (act === 'handoff') handoff(Number(t.dataset.i));
  });
  document.addEventListener('submit', e => {
    if (e.target?.id !== 'mentor-ai-form') return;
    e.preventDefault();
    ask(e.target.querySelector('textarea').value);
  });
  document.addEventListener('input', e => { if (e.target?.id === 'mentor-ai-input') st.draft = e.target.value; });
  document.addEventListener('keydown', e => {
    if (e.target?.id === 'mentor-ai-input' && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      ask(e.target.value);
    }
  });
})();
