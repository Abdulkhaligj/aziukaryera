/*!
 * ADNSU Karyera — açıq açılış səhifəsi.
 *
 * Qonaq (hesabsız ziyarətçi) üçün. Məlumat UYDURMA DEYİL — Supabase-dən
 * gəlir: elanlar, şirkətlər, tədbirlər və güzəştlər `anon` rolu üçün açıq
 * oxumaya icazə verilmiş real cədvəllərdir (bax: 0007 migrasiyası).
 * Offline rejimdə data.js-dəki demo məzmun göstərilir.
 *
 */

const Landing = {
  data: null,
  tab: 'jobs',          // jobs | events | perks
  jobFilter: 'Hamısı',
  coSeg: 'hamısı',
  q: '',
  city: '',
  menuOpen: false,
  detail: null,

  /* ---------------------------------------------------------------- *
   * Məlumatın yüklənməsi
   * ---------------------------------------------------------------- */
  async load() {
    const today = new Date().toISOString().slice(0, 10);
    if (Store.mode !== 'supabase') {
      /* Offline: data.js-dəki demo məzmun */
      this.data = {
        jobs: OPPORTUNITIES.filter(j => j.status === 'approved' && j.deadline >= today),
        companies: COMPANIES,
        events: EVENTS.filter(e => e.date >= today),
        benefits: []
      };
      return;
    }
    try {
      const sb = Backend.init() ? Backend.sb : window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
      const [jobs, cos, evs, bens, parts, facs, majs] = await Promise.all([
        sb.from('jobs').select('*').eq('status', 'approved').gte('deadline', today).order('deadline'),
        sb.from('companies').select('*').eq('status', 'active').order('name'),
        sb.from('events').select('*').gte('starts_at', `${today}T00:00:00`).order('starts_at'),
        sb.from('benefits').select('*').eq('active', true),
        sb.from('benefit_partners').select('*'),
        sb.from('faculties').select('*').order('sort_order'),
        sb.from('majors').select('*')
      ]);
      const tax = Adapt.taxonomy(facs.data || [], majs.data || []);
      const nameById = {};
      (cos.data || []).forEach(c => { nameById[c.id] = c.name; });
      const partById = {};
      (parts.data || []).forEach(p => { partById[p.id] = p; });

      this.data = {
        jobs: (jobs.data || []).map(j => Adapt.job(j, tax, nameById)),
        companies: (cos.data || []).map(c => ({
          id: c.id, name: c.name, sector: c.sector || '—', about: c.about || '', city: 'Bakı'
        })),
        events: (evs.data || []).map(e => ({
          id: e.id, title: e.title, type: e.kind || '', date: e.starts_at.slice(0, 10),
          place: e.place || '', seats: e.seats || 0
        })),
        benefits: (bens.data || []).map(b => ({
          title: b.title, discount: b.discount_label || '', description: b.description || '',
          partner: (partById[b.partner_id] || {}).name || '',
          emoji: (partById[b.partner_id] || {}).emoji || '◈'
        }))
      };
    } catch (e) {
      console.warn('Açılış məlumatı yüklənmədi:', e);
      this.data = { jobs: [], companies: [], events: [], benefits: [] };
    }
  },

  /* ---------------------------------------------------------------- *
   * Köməkçilər
   * ---------------------------------------------------------------- */
  grad(seed) {
    const g = [
      'linear-gradient(120deg,#001C80,#2A47D8)', 'linear-gradient(120deg,#123A9E,#5B74E8)',
      'linear-gradient(120deg,#001C80,#0B4FA8)', 'linear-gradient(120deg,#2A47D8,#7B8FF0)',
      'linear-gradient(120deg,#0A2A8C,#3E63E0)', 'linear-gradient(120deg,#001C80,#4A3FB5)'
    ];
    const n = [...String(seed)].reduce((a, c) => a + c.charCodeAt(0), 0);
    return g[n % g.length];
  },

  deadlinePill(iso) {
    const n = daysLeft(iso);
    if (n < 0) return '<span class="lp-pill">Bitib</span>';
    if (n <= 7) return `<span class="lp-pill hot">Son ${n} gün</span>`;
    if (n <= 21) return `<span class="lp-pill warn">${n} gün qalıb</span>`;
    return `<span class="lp-pill">${fmtDate(iso)}-dək</span>`;
  },

  icon: {
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-5.3 7-11a7 7 0 1 0-14 0c0 5.7 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/></svg>',
    bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="3"/><path d="M8.5 7V5.5A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.5 1.5V7"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    ppl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.4"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M17 11.5a3 3 0 1 0-1.6-5.5M18 20a5.6 5.6 0 0 0-2-4"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>'
  },

  detailView() {
    if (!this.detail || !this.data) return '';
    const isJob = this.detail.type === 'job';
    const item = isJob
      ? this.data.jobs.find(x => String(x.id) === String(this.detail.id))
      : this.data.companies.find(x => String(x.id) === String(this.detail.id));
    if (!item) return '';
    const company = isJob ? this.data.companies.find(x => String(x.id) === String(item.companyId)) : item;
    const companyName = isJob ? (item.company || company?.name || 'Şirkət') : item.name;
    const companyJobs = this.data.jobs.filter(j => String(j.companyId) === String(company?.id || item.id));
    return `<div class="lp">
      <header class="lp-head"><div class="wrap row">${logoLockup()}<div class="spacer"></div>
        <button class="b b-outline b-sm" data-lp="detail-back">← Siyahıya qayıt</button>
        <button class="b b-primary b-sm" data-lp="auth">Daxil ol</button></div></header>
      <main class="lp-sec"><div class="wrap" style="max-width:920px">
        <div class="lp-detail-head">
          <span class="lp-logo${companyLogoClass(companyName)}" style="background:${this.grad(companyName)}">${companyMark(companyName)}</span>
          <div><p class="kicker">${isJob ? esc(item.type) : 'Şirkət profili'}</p>
            <h1>${esc(isJob ? item.title : item.name)}</h1>
            <p class="lede">${esc(isJob ? companyName : item.sector)}</p></div>
        </div>
        ${isJob ? `<div class="lp-grid lp-g3" style="margin:24px 0">
            <div class="lp-card"><b>İş rejimi</b><p>${esc(item.mode)}</p></div>
            <div class="lp-card"><b>Məkan</b><p>${esc(item.location)}</p></div>
            <div class="lp-card"><b>Son tarix</b><p>${fmtDate(item.deadline)}</p></div>
          </div>
          <article class="lp-card"><h2>Vakansiya haqqında</h2><p class="lp-desc" style="margin-top:12px">${esc(item.summary || 'Ətraflı məlumat şirkət tərəfindən yenilənəcək.')}</p>
            <div class="lp-pills" style="margin-top:16px">${(item.skills || []).map(x => `<span class="lp-pill">${esc(x)}</span>`).join('')}</div>
            <button class="b b-primary b-lg" style="margin-top:22px" data-lp="auth-register">Müraciət etmək üçün hesab yarat</button></article>`
          : `<article class="lp-card" style="margin-top:24px"><h2>Şirkət haqqında</h2><p class="lp-desc" style="margin-top:12px">${esc(item.about || 'Şirkət profili yenilənir.')}</p></article>
            <section style="margin-top:28px"><h2>Açıq elanlar</h2><div class="lp-grid lp-g3" style="margin-top:16px">
              ${companyJobs.length ? companyJobs.map(j => `<button class="lp-card lp-card-button" data-lp="job" data-id="${esc(j.id)}"><b>${esc(j.title)}</b><span>${esc(j.type)} · ${esc(j.location)}</span></button>`).join('') : '<p>Açıq elan yoxdur.</p>'}
            </div></section>`}
      </div></main></div>`;
  },

  /* ---------------------------------------------------------------- *
   * Render
   * ---------------------------------------------------------------- */
  render() {
    const d = this.data;
    if (!d) return `<div class="lp"><div class="wrap" style="padding:80px 20px;text-align:center;color:var(--muted)">Yüklənir…</div></div>`;
    if (this.detail) return this.detailView();
    const signedIn = Auth.isSignedIn();

    const types = ['Hamısı', 'İş', 'Təcrübə', 'Graduate', 'Könüllülük'];
    const q = this.q.trim().toLowerCase();
    const jobs = d.jobs
      .filter(j => this.jobFilter === 'Hamısı' || j.type === this.jobFilter)
      .filter(j => !this.city || j.location.includes(this.city))
      .filter(j => !q || `${j.title} ${j.company} ${j.type} ${j.location} ${(j.skills || []).join(' ')}`.toLowerCase().includes(q));

    const cities = [...new Set(d.jobs.map(j => j.location.split(' ')[0].replace(/[(),]/g, '')))].filter(Boolean).sort();

    return `<div class="lp">

  <div class="lp-promo"><div class="wrap">
    <span><b>ADNSU Career &amp; Innovation Fair 2026</b> — 24 oktyabr, əsas korpus. Qeydiyyat açıqdır.</span>
    <button class="b b-white" data-lp="${signedIn ? 'dashboard' : 'auth-register'}">${signedIn ? 'Kabinetə qayıt' : 'Hesab yarat'}</button>
  </div></div>

  <header class="lp-head"><div class="wrap row">
    ${logoLockup()}
    <nav class="lp-nav" aria-label="Əsas menyu">
      <button data-lp="scroll" data-to="lp-jobs">Vakansiyalar</button>
      <button data-lp="scroll" data-to="lp-companies">Şirkətlər</button>
      <button data-lp="scroll" data-to="lp-events">Tədbirlər</button>
      <button data-lp="scroll" data-to="lp-perks">Güzəştlər</button>
      <button data-lp="scroll" data-to="lp-how">Necə işləyir</button>
      <button data-lp="scroll" data-to="lp-faq">Suallar</button>
    </nav>
    <div class="right">
      ${signedIn
        ? '<button class="b b-primary b-sm" data-lp="dashboard">Kabinetə qayıt</button>'
        : '<button class="b b-outline b-sm" data-lp="auth">Daxil ol</button><button class="b b-primary b-sm" data-lp="auth-register">Qeydiyyat</button>'}
      <button class="lp-burger" data-lp="menu" aria-label="Menyu" aria-expanded="${this.menuOpen}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
      </button>
    </div>
  </div></header>

  <div class="lp-mob ${this.menuOpen ? 'open' : ''}"><div class="wrap">
    <button data-lp="scroll" data-to="lp-jobs">Vakansiyalar</button>
    <button data-lp="scroll" data-to="lp-companies">Şirkətlər</button>
    <button data-lp="scroll" data-to="lp-events">Tədbirlər</button>
    <button data-lp="scroll" data-to="lp-perks">Güzəştlər</button>
    <button data-lp="scroll" data-to="lp-how">Necə işləyir</button>
    <div style="display:flex;gap:10px;margin-top:10px">
      ${signedIn
        ? '<button class="b b-primary b-block" data-lp="dashboard">Kabinetə qayıt</button>'
        : '<button class="b b-outline b-block" data-lp="auth">Daxil ol</button><button class="b b-primary b-block" data-lp="auth-register">Qeydiyyat</button>'}
    </div>
  </div></div>

  <section class="lp-hero"><div class="wrap lp-hero-grid">
    <div>
      <h1>İxtisasına uyğun <span>karyeranı</span> tap</h1>
      <p class="lede">ADNSU tələbələri üçün iş, təcrübə, graduate proqramları və könüllülük.
        Sistem fakültən, ixtisasın və bacarıqlarına görə hər elana uyğunluq faizi hesablayır —
        özün axtarmırsan, uyğun olan sənə gəlir.</p>

      <form class="lp-search" data-lp="search" role="search">
        <div class="lp-sf">
          ${this.icon.search}
          <input type="search" data-lp-q placeholder="Vəzifə, bacarıq və ya şirkət"
                 value="${esc(this.q)}" autocomplete="off" aria-label="Axtarış">
        </div>
        <div class="lp-sf">
          ${this.icon.pin}
          <select data-lp-city aria-label="Şəhər">
            <option value="">Bütün şəhərlər</option>
            ${cities.map(c => `<option ${c === this.city ? 'selected' : ''}>${esc(c)}</option>`).join('')}
          </select>
        </div>
        <button class="b b-primary" type="submit">Axtar</button>
      </form>

      <div class="lp-cta">
        <button class="b b-primary b-lg" data-lp="auth-register">Pulsuz başla</button>
        <button class="b b-outline b-lg" data-lp="scroll" data-to="lp-companies">Şirkətləri kəşf et</button>
      </div>
    </div>

    <div class="lp-stage">
      <span class="lp-blob" aria-hidden="true"></span>
      ${mascot('wave', { eager: true })}
      <div class="lp-badge one"><b>${d.jobs.length}</b><span>aktiv imkan</span></div>
      <div class="lp-badge two"><b>40/40/20</b><span>uyğunluq formulası</span></div>
    </div>
  </div></section>

  <section class="lp-sec" style="padding-bottom:0"><div class="wrap">
    <div class="center" style="max-width:620px">
      <h2>Səni gözləyən şirkətlər</h2>
      <p class="lede center" style="margin-top:12px">ADNSU tələbələrinə elan verən tərəfdaşlar.</p>
    </div>
    <div class="lp-logos"><div class="lp-track">
      ${d.companies.map(c => `<span class="lp-lgo">
        <span class="m${companyLogoClass(c.name)}" style="background:${this.grad(c.name)}">${companyMark(c.name)}</span>
        <span>${esc(c.name)}</span></span>`).join('')}
    </div></div>
  </div></section>

  <section class="lp-sec" id="lp-jobs"><div class="wrap">
    <div class="lp-sec-top">
      <div><p class="kicker">Vakansiyalar</p><h2>Aktual imkanlar</h2>
        <p class="lede" style="margin-top:10px">Son tarixə görə sıralanıb.</p></div>
    </div>
    <div class="lp-tabs" style="margin-bottom:18px">
      ${types.map(t => `<button class="lp-tab" data-lp="jobfilter" data-v="${esc(t)}"
        aria-selected="${this.jobFilter === t}">${esc(t)}</button>`).join('')}
    </div>
    <p class="lp-count"><b>${jobs.length}</b> elan${q ? ` · «${esc(this.q)}» üzrə` : ''}</p>
    <div class="lp-grid lp-g3">
      ${jobs.length ? jobs.slice(0, 9).map(j => `<article class="lp-card lp-card-click" data-lp="job" data-id="${esc(j.id)}" tabindex="0">
        <div class="lp-top">
          <span class="lp-logo${companyLogoClass(j.company)}" style="background:${this.grad(j.company || j.companyId)}">${companyMark(j.company || '—')}</span>
          <div style="min-width:0">
            <div class="lp-org">${esc(j.company || '')}</div>
            <h3 class="lp-title">${esc(j.title)}</h3>
          </div>
        </div>
        <p class="lp-desc">${esc(j.summary || '')}</p>
        <div class="lp-pills">
          <span class="lp-pill blue">${esc(j.type)}</span>
          ${(j.skills || []).slice(0, 2).map(s => `<span class="lp-pill">${esc(s)}</span>`).join('')}
        </div>
        <div class="lp-meta">
          <span class="i">${this.icon.pin}${esc(j.location)}</span>
          <span class="i">${this.icon.bag}${esc(j.mode)}</span>
          <span style="margin-left:auto">${this.deadlinePill(j.deadline)}</span>
        </div>
      </article>`).join('')
        : `<div class="lp-empty">${mascot('think')}<b>Bu filtrlərə uyğun elan yoxdur</b>Açar sözü qısaldın və ya şəhər filtrini sıfırlayın.</div>`}
    </div>
    ${jobs.length > 9 ? `<div style="margin-top:26px;text-align:center">
      <button class="b b-outline b-lg" data-lp="auth-register">Bütün ${jobs.length} elanı gör — pulsuz qeydiyyat</button>
    </div>` : ''}
  </div></section>

  <section class="lp-sec" style="padding-block:0"><div class="wrap">
    <div class="lp-banner">
      <div>
        <h3>Uyğunluq faizini öz profilində gör</h3>
        <p>Qeydiyyatdan keç, fakültə və bacarıqlarını qeyd et — hər elan sənin üçün
          ayrıca hesablanmış faizlə görünsün.</p>
      </div>
      <button class="b b-white b-lg" data-lp="auth-register">Pulsuz hesab yarat</button>
    </div>
  </div></section>

  <section class="lp-sec" id="lp-companies"><div class="wrap">
    <div class="lp-sec-top">
      <div><p class="kicker">Şirkətlər</p><h2>Tərəfdaş şirkətlər</h2></div>
    </div>
    <div class="lp-grid lp-g4">
      ${d.companies.slice(0, 8).map(c => `<article class="lp-co">
        <div class="lp-cover" style="background:${this.grad(c.name)}"></div>
        <div class="lp-cobody">
          <span class="lp-cologo${companyLogoClass(c.name)}" style="background:${this.grad(c.sector)}">${companyMark(c.name)}</span>
          <div class="lp-coname">${esc(c.name)}</div>
          <p class="lp-desc">${esc(c.about)}</p>
          <div class="lp-pills"><span class="lp-pill">${esc(c.sector)}</span></div>
          <div class="lp-cofoot">
            <span class="fl">${d.jobs.filter(j => j.companyId === c.id).length} açıq elan</span>
            <button class="b b-outline b-sm" data-lp="company" data-id="${esc(c.id)}">Profilə bax</button>
          </div>
        </div>
      </article>`).join('')}
    </div>
  </div></section>

  <section class="lp-sec tint" id="lp-how"><div class="wrap">
    <div class="center" style="max-width:720px;margin-bottom:30px">
      <p class="kicker">Necə işləyir</p>
      <h2>Uyğunluq təsadüfi deyil — hesablanır</h2>
      <p class="lede center" style="margin-top:14px">Hər elan üçün fakültən, ixtisasın və
        bacarıqların ayrıca qiymətləndirilir. Faizin haradan gəldiyini həmişə görürsən.</p>
    </div>
    <div class="lp-feat">
      <div class="lp-f dark">
        <p class="kicker">40 / 40 / 20</p>
        <h3>Uyğunluq formulası</h3>
        <div class="lp-mrow"><span class="n">Fakültə uyğunluğu</span>
          <span class="lp-mbar"><i style="width:100%;background:#fff"></i></span><span class="lp-mpct">40</span></div>
        <div class="lp-mrow"><span class="n">İxtisas uyğunluğu</span>
          <span class="lp-mbar"><i style="width:100%;background:#C9D3F7"></i></span><span class="lp-mpct">40</span></div>
        <div class="lp-mrow"><span class="n">Bacarıqların örtülməsi</span>
          <span class="lp-mbar"><i style="width:50%;background:#DCAB5E"></i></span><span class="lp-mpct">20</span></div>
        <p style="margin-top:12px">Eyni fakültədən fərqli ixtisas 15 bal alır — qohum sahələr sıfır sayılmır.</p>
      </div>
      <div class="lp-f">
        <p class="kicker">CV Mərkəzi</p>
        <h3>CV yarat, yoxlat, vakansiya ilə tutuşdur</h3>
        <p>Profil məlumatından CV hazırlama, PDF ixracı, ATS analizi və yalnız sizin başladığınız zaman işləyən AI məzmun rəyi. Şablonlu qurucu təqdim edilən kodla bu modulun içinə qoşulacaq.</p>
        <div class="lp-pills" style="margin-top:4px">
          <span class="lp-pill blue">Profil → CV</span><span class="lp-pill">ATS</span><span class="lp-pill">PDF</span>
        </div>
      </div>
      <div class="lp-f">
        <p class="kicker">Müsahibə hazırlığı</p>
        <h3>İxtisasına uyğun suallarla məşq et</h3>
        <p>İxtisas, vəzifə və vakansiya təsvirinə uyğun dinamik suallar; AI olmadıqda lokal sual bankı ilə fasiləsiz davam edir.</p>
      </div>
      <div class="lp-f">
        <p class="kicker">Magistr profili</p>
        <h3>Bakalavr və magistr təhsilini birlikdə göstər</h3>
        <p>Magistr tələbəsi kimi ayrıca qeydiyyatdan keç, universitet, fakültə, ixtisaslaşma, qrup və təhsil illərini profilinə əlavə et.</p>
        <div class="lp-pills" style="margin-top:6px">
          <span class="lp-pill blue">Magistr qeydiyyatı</span><span class="lp-pill">Çoxsaylı təhsil</span>
        </div>
      </div>
      <div class="lp-f wide">
        <p class="kicker">Karyera yol xəritəsi</p>
        <h3>I kursdan məzuniyyətə qədər addım-addım</h3>
        <p>Hər mərhələ üçün bacarıqlar, sertifikatlar və konkret addımlar —
          ixtisasına görə fərdiləşdirilmiş.</p>
        <div class="lp-pills" style="margin-top:6px">
          <span class="lp-pill">I–II kurs</span><span class="lp-pill">III kurs</span>
          <span class="lp-pill">IV kurs</span><span class="lp-pill blue">Məzuniyyətdən sonra</span>
        </div>
      </div>
      <div class="lp-f">
        <p class="kicker">Tələbə güzəştləri</p>
        <h3>Teatr, kino, muzey və idman endirimləri</h3>
        <p>QR kodunu göstər, güzəşti yerində al.</p>
      </div>
    </div>
  </div></section>

  <section class="lp-sec" id="lp-pricing"><div class="wrap">
    <div class="center" style="max-width:700px;margin-bottom:30px"><p class="kicker">Şirkət paketləri</p><h2>İşə qəbul tempinizə uyğun plan</h2>
      <p class="lede center" style="margin-top:12px">Tələbələr üçün bütün funksiyalar pulsuzdur. Şirkətlər Free ilə başlayıb ehtiyac olduqda yüksəldə bilər.</p></div>
    <div class="plan-grid">
      ${COMPANY_PLANS.map(plan => `<article class="plan-card ${plan.featured ? 'featured' : ''}">
        ${plan.featured ? '<span class="plan-pop">Ən çox seçilən</span>' : ''}<h3>${esc(plan.name)}</h3>
        <div class="plan-price"><b>$${esc(plan.price)}</b><span>${plan.price === '0' ? 'həmişəlik' : '/ ay'}</span></div>
        <p>${esc(plan.description)}</p><ul>${plan.features.map(x => `<li>✓ ${esc(x)}</li>`).join('')}</ul>
        <button class="b ${plan.featured ? 'b-primary' : 'b-outline'} b-block" data-lp="auth-register">${plan.id === 'free' ? 'Pulsuz başla' : `${esc(plan.name)} seç`}</button>
      </article>`).join('')}
    </div>
  </div></section>

  <section class="lp-sec" id="lp-events"><div class="wrap">
    <div class="lp-sec-top"><div><p class="kicker">Tədbirlər</p><h2>Yaxınlaşan tədbirlər</h2></div></div>
    <div class="lp-grid lp-g3">
      ${d.events.length ? d.events.slice(0, 6).map(e => `<article class="lp-card">
        <div class="lp-top">
          <span class="lp-logo" style="background:${this.grad(e.title)}">${esc(initials(e.title))}</span>
          <div style="min-width:0">
            <div class="lp-org">${esc(e.type)}</div>
            <h3 class="lp-title">${esc(e.title)}</h3>
          </div>
        </div>
        <div class="lp-meta">
          <span class="i">${this.icon.cal}${fmtDate(e.date)}</span>
          <span class="i">${this.icon.pin}${esc(e.place)}</span>
          <button class="b b-outline b-sm" style="margin-left:auto" data-lp="auth">Qeydiyyat</button>
        </div>
      </article>`).join('') : `<div class="lp-empty">${mascot('think')}<b>Hazırda tədbir yoxdur</b>Tezliklə yeniləri elan olunacaq.</div>`}
    </div>
  </div></section>

  ${d.benefits.length ? `<section class="lp-sec tint" id="lp-perks"><div class="wrap">
    <div class="lp-sec-top"><div><p class="kicker">Güzəştlər</p><h2>Tələbə imtiyazları</h2>
      <p class="lede" style="margin-top:10px">ADNSU tələbə statusunla.</p></div></div>
    <div class="lp-grid lp-g3">
      ${d.benefits.slice(0, 6).map(b => `<article class="lp-card">
        <div class="lp-top">
          <span class="lp-logo" style="background:${this.grad(b.partner)}">${esc(b.emoji)}</span>
          <div style="min-width:0">
            <div class="lp-org">${esc(b.partner)}</div>
            <h3 class="lp-title">${esc(b.title)}</h3>
          </div>
        </div>
        <p class="lp-desc">${esc(b.description)}</p>
        <div class="lp-meta">
          <span class="lp-pill blue">${esc(b.discount)}</span>
          <button class="b b-outline b-sm" style="margin-left:auto" data-lp="auth">Kodu al</button>
        </div>
      </article>`).join('')}
    </div>
    <p class="center" style="margin-top:20px;font-size:12.5px;color:var(--muted)">
      Nümunə güzəştlərdir — real istifadədən əvvəl hər partnyorla müqavilə bağlanır.</p>
  </div></section>` : ''}

  <section class="lp-sec" id="lp-faq"><div class="wrap">
    <div class="center" style="max-width:640px;margin-bottom:28px"><h2>Tez-tez verilən suallar</h2></div>
    <div class="lp-faq">
      <details class="lp-qa" open><summary>ADNSU Karyera nədir?</summary>
        <p class="ans">ADNSU tələbələrini iş, təcrübə, graduate proqramları və könüllülük
          imkanları ilə birləşdirən universitet karyera platformasıdır. Fərqi odur ki, elanlar
          sadəcə siyahılanmır — hər tələbə üçün uyğunluq faizi hesablanır.</p></details>
      <details class="lp-qa"><summary>İstifadə pulsuzdur?</summary>
        <p class="ans">Bəli, tələbələr üçün tamamilə pulsuzdur. Ödənişli plan yoxdur —
          platforma universitetin karyera xidmətinin bir hissəsidir.</p></details>
      <details class="lp-qa"><summary>Kim qeydiyyatdan keçə bilər?</summary>
        <p class="ans">Bakalavr və magistr tələbələri universitet e-poçtu (@asoiu.edu.az) ilə
          birbaşa daxil olur. Məzunlar şəxsi e-poçtla qeydiyyatdan keçə və Karyera Mərkəzinin
          yoxlamasından sonra tam giriş əldə edə bilər. Şirkətlər korporativ e-poçtla qeydiyyatdan
          keçir və təsdiqdən sonra elan dərc edir.</p></details>
      <details class="lp-qa"><summary>Uyğunluq faizi necə hesablanır?</summary>
        <p class="ans">Fakültə uyğunluğu 40, ixtisas 40, tələb olunan bacarıqların örtülməsi
          20 bal. Eyni fakültədən fərqli ixtisas 15 bal alır. Profilində faizin hansı hissədən
          gəldiyini ayrıca görürsən.</p></details>
      <details class="lp-qa"><summary>Məlumatlarım kimlə paylaşılır?</summary>
        <p class="ans">Profilini yalnız Karyera Mərkəzi və təsdiqlənmiş şirkət hesabları görür.
          Mesajlarını heç kim — Karyera Mərkəzi də daxil olmaqla — oxuya bilmir.</p></details>
    </div>
  </div></section>

  <footer class="lp-foot"><div class="wrap">
    <div class="lp-foot-grid">
      <div class="about">
        ${logoLockup()}
        <p>ADNSU tələbə və məzunlarını sənaye partnyorları ilə birləşdirən karyera platforması.</p>
      </div>
      <div class="lp-fcol"><h4>Tələbələr</h4><ul>
        <li><button data-lp="auth-register">Pulsuz qeydiyyat</button></li>
        <li><button data-lp="scroll" data-to="lp-jobs">Vakansiyalar</button></li>
        <li><button data-lp="scroll" data-to="lp-events">Tədbirlər</button></li>
        <li><button data-lp="scroll" data-to="lp-perks">Güzəştlər</button></li>
      </ul></div>
      <div class="lp-fcol"><h4>Şirkətlər</h4><ul>
        <li><button data-lp="auth-register">Şirkət hesabı aç</button></li>
        <li><button data-lp="scroll" data-to="lp-companies">Tərəfdaşlar</button></li>
        <li><button data-lp="scroll" data-to="lp-how">Necə işləyir</button></li>
      </ul></div>
      <div class="lp-fcol"><h4>Əlaqə</h4><ul>
        <li><button data-lp="noop">career@asoiu.edu.az</button></li>
        <li><button data-lp="noop">Bakı, Azadlıq pr. 20</button></li>
        <li><button data-lp="scroll" data-to="lp-faq">Suallar</button></li>
      </ul></div>
    </div>
    <div class="lp-legal"><span>© 2026 ADNSU Karyera Mərkəzi</span><span>Məxfilik · İstifadə şərtləri</span></div>
  </div></footer>
</div>`;
  }
};
