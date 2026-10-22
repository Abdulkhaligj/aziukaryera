/*!
 * ADNSU / ASOIU Career v2 — app.js
 * Router, üç kabinet (Tələbə · Şirkət · Karyera Mərkəzi) və bütün görünüşlər.
 */

/* ================================================================ *
 * Köməkçilər
 * ================================================================ */
const AZ_MONTHS = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'İyn', 'İyl', 'Avq', 'Sen', 'Okt', 'Noy', 'Dek'];
const TODAY = new Date();

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getDate()} ${AZ_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
function daysLeft(iso) {
  return Math.ceil((new Date(iso) - TODAY) / 86400000);
}
function initials(name) {
  return String(name || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

const COMPANY_LOGOS = Object.freeze({
  'abb': 'assets/logos/abb.png',
  'abb bank': 'assets/logos/abb.png',
  'azerconnect group': 'assets/logos/azerconnect.png',
  'azercosmos': 'assets/logos/azercosmos.png',
  'azərenerji': 'assets/logos/azerenerji.png',
  'azərişıq': 'assets/logos/azerishiq.png',
  'bakcell': 'assets/logos/bakcell.png',
  'baku steel company': 'assets/logos/baku-steel-company.png',
  'bp': 'assets/logos/bp.png',
  'bp azerbaijan': 'assets/logos/bp.png',
  'bos shelf': 'assets/logos/bos-shelf.png',
  'ey': 'assets/logos/ey-azerbaijan.png',
  'ey azerbaijan': 'assets/logos/ey-azerbaijan.png',
  'halliburton': 'assets/logos/halliburton.svg',
  'kapital bank': 'assets/logos/kapital-bank.png',
  'pasha technology': 'assets/logos/pasha-technology.png',
  'paşa technology': 'assets/logos/pasha-technology.png',
  'pwc': 'assets/logos/pwc-azerbaijan.png',
  'pwc azerbaijan': 'assets/logos/pwc-azerbaijan.png',
  'slb': 'assets/logos/slb.png',
  'socar': 'assets/logos/socar.png',
  'socar polymer': 'assets/logos/socar-polymer.png',
  'totalenergies': 'assets/logos/totalenergies.png',
  'total energies': 'assets/logos/totalenergies.png'
});

function companyLogoPath(name) {
  const key = String(name || '').trim().toLocaleLowerCase('az-AZ');
  return COMPANY_LOGOS[key] || '';
}

function companyMark(name) {
  const src = companyLogoPath(name);
  if (!src) return esc(initials(name));
  return `<img class="company-logo-img" src="${esc(src)}" alt="" aria-hidden="true"
    loading="lazy" decoding="async">`;
}

function companyLogoClass(name) {
  return companyLogoPath(name) ? ' has-company-logo' : '';
}
function typeClass(t) {
  return { 'İş': 't-is', 'Təcrübə': 't-tecrube', 'Graduate': 't-graduate', 'Könüllülük': 't-konullu' }[t] || 't-is';
}
function pct(n, d) { return d ? Math.round((n / d) * 100) : 0; }

/**
 * Şirkət məlumatı: əvvəlcə statik kataloq, sonra platformada qeydiyyatdan
 * keçmiş şirkət hesabları. Həmişə obyekt qaytarır.
 */
function companyOf(id) {
  if (!id) return { name: '—', sector: '', city: '' };
  if (COMPANY_BY_ID[id]) return COMPANY_BY_ID[id];
  const profiles = (Store.state && Store.state.companyProfiles) || {};
  const found = Object.values(profiles).find(c => c && c.id === id);
  return found || { name: String(id), sector: '', city: '' };
}

/** Elanlarda adı keçən bütün şirkətlər (statik + qeydiyyatdan keçmiş). */
function allCompanies() {
  const profiles = Object.values((Store.state && Store.state.companyProfiles) || {});
  const extra = profiles.filter(c => c && c.id && !COMPANY_BY_ID[c.id]);
  return [...COMPANIES, ...extra];
}

const COMPANY_PLANS = [
  { id: 'free', name: 'Free', price: '0', description: 'Yeni tərəfdaşlar üçün', features: [
    'Şirkət profili, loqo və təsvir', 'Eyni anda 1 aktiv vakansiya', 'Əsas vakansiya paylaşımı',
    'Tələbə müraciətlərini qəbul etmə', 'Əsas müraciətçi siyahısı və dashboard', 'Əsas analitika',
    'Şəbəkədə məhdud mətn paylaşımı', 'Seçilmiş tədbirlərdə iştirak'
  ] },
  { id: 'pro', name: 'Pro', price: '24.99', featured: true, description: 'Daimi işə qəbul üçün', features: [
    'Free paketdəki bütün imkanlar', '10 aktiv vakansiya', 'Təcrübə və graduate proqramları',
    'Qabaqcıl müraciətçi idarəetməsi', 'Namizəd axtarışı və Talent Pool', 'AI uyğunluq və CV sıralaması',
    'Təsdiqlənmiş şirkət nişanı', 'Ayda 2 önə çıxarılan elan', 'Qabaqcıl analitika',
    'Şəkil və sənədli şəbəkə paylaşımları', 'Saxlanmış namizədlər, qeydlər və pipeline', 'Uyğun məlumat ixracı'
  ] },
  { id: 'business', name: 'Business', price: '49.99', description: 'Böyük işəgötürənlər üçün', features: [
    'Pro paketdəki bütün imkanlar', 'Limitsiz vakansiya və təcrübə elanları', 'Geniş namizəd bazası və filtrlər',
    'AI namizəd sıralaması və uyğunluğu', 'Prioritet yerləşdirmə', 'Ayda 10 önə çıxarılan elan',
    'Kütləvi mesajlaşma və namizəd etiketləri', 'Qabaqcıl Talent Pool və analitika',
    'Premium şirkət səhifəsi və xüsusi brendləmə', 'Komanda üzvləri və çoxsaylı recruiter',
    'Tədbir, kampaniya və Karyera Yarmarkası prioriteti', 'Prioritet təsdiq nişanı və dəstək'
  ] }
];

function currentCompanyPlan() {
  return Store.state && Store.state.subscription && (Store.state.subscription.plan_id || Store.state.subscription.plans?.id || Store.state.subscription.plans?.slug) || 'free';
}

function companyCanUse(feature) {
  const plan = currentCompanyPlan();
  if (feature === 'candidate_search' || feature === 'ai_candidate_matching' || feature === 'ai_cv_ranking') return plan === 'pro' || plan === 'business';
  if (feature === 'bulk_messaging' || feature === 'premium_branding') return plan === 'business';
  return true;
}

/* ================================================================ *
 * Loqo — ASOIU Karyera Mərkəzi markası
 * ================================================================ */
function logoMark() {
  return `<span class="logo-mark"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor"
    stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M18.6 13.3v-2.1a3 3 0 0 1 3-3h4.8a3 3 0 0 1 3 3v2.1"/>
    <path d="M33.4 13.3H10.6a3 3 0 0 0-3 3v19a3 3 0 0 0 3 3h23.2a3 3 0 0 0 3-3v-6.4"/>
    <path d="M13.6 32.4 21 25l5 4.6 11.4-11.9"/>
    <circle cx="13.6" cy="32.4" r="2.7" fill="currentColor" stroke="none"/>
    <circle cx="21" cy="25" r="2.7" fill="currentColor" stroke="none"/>
    <path d="M31.6 17.7h6.6v6.6"/>
  </svg></span>`;
}
/**
 * Maskot şəkli. Dekorativdir — ekran oxuyucudan gizlədilir,
 * məna daşıyan mətn həmişə yanında olur.
 */
function mascot(pose, opts = {}) {
  /* width/height nisbəti verilir ki, şəkil yüklənənə qədər yer tutsun
     və səhifə sıçramasın (CLS). Əsl ölçü CSS ilə təyin olunur. */
  const eager = opts.eager ? 'eager' : 'lazy';
  return `<img class="mascot ${opts.cls || ''}" src="assets/img/mascot-${pose}.webp"
    width="560" height="700" alt="" aria-hidden="true"
    loading="${eager}" decoding="async" fetchpriority="${opts.eager ? 'high' : 'auto'}">`;
}

/* Şifrə sahəsindəki göz ikonu — açıq və bağlı vəziyyət CSS ilə seçilir. */
function eyeIcon() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path class="eye-open" d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/>
    <circle class="eye-open" cx="12" cy="12" r="2.8"/>
    <path class="eye-off" d="M3 3l18 18"/>
  </svg>`;
}

function logoLockup() {
  return `<a class="logo" href="#" data-act="home">
    ${logoMark()}
    <span class="logo-rule"></span>
    <span class="logo-text">
      <b>ASOIU</b>
      <span>Karyera Mərkəzi</span>
      <small>Career Center</small>
    </span>
  </a>`;
}

function notificationGlyph(kind) {
  if (/event/.test(kind || '')) return '◷';
  if (/internship|job|vacancy|graduate|volunteer/.test(kind || '')) return '▥';
  if (/post|content/.test(kind || '')) return '◍';
  if (/application|interview/.test(kind || '')) return '✓';
  if (/benefit/.test(kind || '')) return '★';
  return '•';
}

function notificationTime(value) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  if (minutes < 1) return 'indi';
  if (minutes < 60) return `${minutes} dəq əvvəl`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} saat əvvəl`;
  return fmtDate(value);
}

function notificationCenter() {
  const rows = (Store.state && Store.state.notifications) || [];
  const unread = rows.filter(item => !item.readAt).length;
  return `<div class="notification-center">
    <button class="notification-bell" data-act="notifications-toggle" aria-label="Bildirişlər"
      aria-expanded="${UI.notificationsOpen}"><span aria-hidden="true">♢</span>${unread ? `<b>${unread > 99 ? '99+' : unread}</b>` : ''}</button>
    ${UI.notificationsOpen ? `<section class="notification-pop" aria-label="Bildirişlər">
      <header><div><span class="eyebrow">Bildirişlər</span><strong>${unread ? `${unread} yeni bildiriş` : 'Yeni bildiriş yoxdur'}</strong></div>
        ${unread ? '<button class="linkbtn" data-act="notifications-read-all">Hamısını oxundu et</button>' : ''}</header>
      <div class="notification-list">${rows.length ? rows.slice(0, 30).map(item => `
        <button class="notification-item ${item.readAt ? '' : 'unread'}" data-act="notification-open" data-id="${esc(item.id)}">
          <span class="notification-kind">${notificationGlyph(item.kind)}</span>
          <span><b>${esc(item.title)}</b>${item.body ? `<em>${esc(item.body)}</em>` : ''}<small>${esc(notificationTime(item.createdAt))}</small></span>
        </button>`).join('') : '<div class="notification-empty">Hələ bildiriş yoxdur.</div>'}</div>
    </section>` : ''}
  </div>`;
}

/* ================================================================ *
 * Naviqasiya
 * ================================================================ */
const STUDENT_NAV_ICONS = {"dashboard":"<rect x=\"3\" y=\"3\" width=\"7\" height=\"7\" rx=\"1.4\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"7\" rx=\"1.4\"/><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\" rx=\"1.4\"/><rect x=\"14\" y=\"14\" width=\"7\" height=\"7\" rx=\"1.4\"/>","jobs":"<rect x=\"3\" y=\"7\" width=\"18\" height=\"14\" rx=\"2\"/><path d=\"M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18\"/>","applications":"<path d=\"m21 3-7.6 18-3.5-7.9L2 9.6 21 3Z\"/><path d=\"M9.9 13.1 21 3\"/>","events":"<rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M16 3v4M8 3v4M3 10h18\"/>","cv":"<path d=\"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z\"/><path d=\"M14 2v6h6M8 13h8M8 17h6\"/>","interview":"<path d=\"M21 11.5a8.5 8.5 0 0 1-8.5 8.5 9 9 0 0 1-4-.9L3 21l1.9-5.2A8.5 8.5 0 1 1 21 11.5Z\"/><path d=\"M8 11h8M8 14.5h5\"/>","roadmap":"<circle cx=\"6\" cy=\"19\" r=\"2\"/><path d=\"M9 19h7a4 4 0 0 0 0-8H8a4 4 0 0 1 0-8h7\"/><path d=\"m12 1 3 2-3 2\"/>","network":"<circle cx=\"9\" cy=\"8\" r=\"3\"/><path d=\"M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 5v1\"/>","benefits":"<rect x=\"3\" y=\"9\" width=\"18\" height=\"12\" rx=\"2\"/><path d=\"M12 9v12M3 13h18M12 9H8a3 3 0 1 1 3-3c.7 1.5 1 3 1 3ZM12 9h4a3 3 0 1 0-3-3c-.7 1.5-1 3-1 3Z\"/>","profile":"<circle cx=\"12\" cy=\"8\" r=\"4\"/><path d=\"M4 21v-2a8 8 0 0 1 16 0v2\"/>","menu":"<path d=\"M4 6h16M4 12h16M4 18h16\"/>","panel":"<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><path d=\"M9 3v18M15 9l-3 3 3 3\"/>","close":"<path d=\"M5 5l14 14M19 5 5 19\"/>"};
function studentNavIcon(id) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (STUDENT_NAV_ICONS[id] || STUDENT_NAV_ICONS.dashboard) + '</svg>';
}

const NAV = {
  student: [
    { group: 'Əsas' },
    { id: 'dashboard',    label: 'İcmal',                ico: '⌂' },
    { id: 'jobs',         label: 'Vakansiyalar',         ico: '◎' },
    { id: 'applications', label: 'Müraciətlərim',        ico: '▤' },
    { id: 'events',       label: 'Tədbirlər',            ico: '◷' },
    { group: 'Karyera alətləri' },
    { id: 'cv',           label: 'AI CV Studio',          ico: '▥' },
    { id: 'interview',    label: 'Müsahibə hazırlığı',    ico: '◐' },
    { id: 'roadmap',      label: 'Karyera xəritəm',       ico: '◭' },
    { group: 'İcma və imkanlar' },
    { id: 'network',      label: 'Şəbəkə',               ico: '◍' },
    { id: 'benefits',     label: 'Tələbə güzəştləri',     ico: '★' },
    { group: 'Hesab' },
    { id: 'profile',      label: 'Profil və ayarlar',    ico: '☰' }
  ],
  company: [
    { group: 'İşə qəbul' },
    { id: 'dashboard',  label: 'Ana səhifə',       ico: '⌂' },
    { id: 'vacancies',  label: 'Vakansiyalarım',   ico: '▤' },
    { id: 'post',       label: 'Vakansiya yarat',  ico: '＋' },
    { id: 'applications', label: 'Müraciətlər',    ico: '▥' },
    { group: 'Namizədlər' },
    { id: 'candidates', label: 'Namizəd uyğunluğu', ico: '◎' },
    { id: 'search',     label: 'Namizəd axtarışı',  ico: '⌕' },
    { id: 'invites',    label: 'Müsahibə dəvətləri', ico: '◐' },
    { group: 'Şirkət' },
    { id: 'profile',    label: 'Şirkət profili',    ico: '☰' },
    { id: 'subscription', label: 'Paket və limitlər', ico: '◇' }
  ],
  admin: [
    { group: 'İdarəetmə' },
    { id: 'dashboard', label: 'Ana səhifə',      ico: '⌂' },
    { id: 'approvals', label: 'Elan təsdiqi',    ico: '✓' },
    { id: 'students',  label: 'Tələbələr',       ico: '☰' },
    { id: 'companies', label: 'Şirkətlər',       ico: '▤' },
    { id: 'events',    label: 'Tədbirlər',       ico: '◷' },
    { id: 'redeem',    label: 'QR təsdiqi',      ico: '✓' },
    { group: 'Hesabatlar' },
    { id: 'analytics', label: 'Analitika',       ico: '◭' },
    { id: 'reports',   label: 'Hesabatlar',      ico: '▥' },
    { group: 'Hesab' },
    { id: 'profile',   label: 'Profil və hesab', ico: '☰' }
  ]
};

/* Rol adları auth.js-dəki ROLE_NAMES-dən gəlir. */

/* ================================================================ *
 * Ümumi komponentlər
 * ================================================================ */
function meterHTML(r, opts = {}) {
  const band = matchBand(r.score);
  return `<div class="match">
    <div class="match-top">
      <span class="match-pct">${r.score}%</span>
      <span class="match-band ${band.tone}">${band.label}</span>
    </div>
    <div class="meter ${opts.lg ? 'lg' : ''}" role="img"
         aria-label="Uyğunluq ${r.score} faiz: fakültə ${r.faculty}, ixtisas ${r.major}, bacarıqlar ${r.skills} bal">
      <i class="s-fac" style="width:${r.faculty}%"></i>
      <i class="s-maj" style="width:${r.major}%"></i>
      <i class="s-skl" style="width:${r.skills}%"></i>
    </div>
    ${opts.key ? meterKey(r) : ''}
  </div>`;
}

function meterKey(r) {
  return `<div class="meter-key">
    <span><i style="background:var(--seg-faculty)"></i>Fakültə <b>${r.faculty}/40</b></span>
    <span><i style="background:var(--seg-major)"></i>İxtisas <b>${r.major}/40</b></span>
    <span><i style="background:var(--seg-skill)"></i>Bacarıq <b>${r.skills}/20</b></span>
  </div>`;
}

function jobCard(job, report, opts = {}) {
  const c = companyOf(job.companyId);
  const dl = daysLeft(job.deadline);
  const applied = Store.isApplied(job.id);
  const savedOn = Store.state.saved.includes(Number(job.id));
  return `<article class="job ${opts.top ? 'top' : ''}">
    <div class="job-head">
      <div class="brandbox${companyLogoClass(c.name)}">${companyMark(c.name)}</div>
      <div class="job-title">
        <div class="row tight" style="margin-bottom:4px">
          <span class="badge-type ${typeClass(job.type)}">${esc(job.type)}</span>
          ${job.status === 'pending' ? '<span class="chip warn mono">TƏSDİQ GÖZLƏYİR</span>' : ''}
        </div>
        <h3>${esc(job.title)}</h3>
        <div class="org">${esc(c.name)} · ${esc(job.location)}</div>
      </div>
      ${report ? `<div class="job-match">${meterHTML(report)}</div>` : ''}
    </div>

    <div class="job-meta">
      <span>▦ ${esc(job.mode)}</span>
      <span>◷ ${esc(job.duration)}</span>
      <span>₼ ${esc(job.pay)}</span>
      <span class="${dl <= 7 ? 'mono' : ''}" style="${dl <= 7 ? 'color:var(--bad)' : ''}">
        ⌛ Son tarix ${fmtDate(job.deadline)}${dl >= 0 ? ` (${dl} gün)` : ' (bitib)'}
      </span>
    </div>

    ${report ? `<div class="skillrow">
      ${job.skills.map(s => `<span class="sk ${report.matched.includes(s) ? 'hit' : 'gap'}">${report.matched.includes(s) ? '✓ ' : ''}${esc(s)}</span>`).join('')}
    </div>` : `<div class="skillrow">${job.skills.map(s => `<span class="sk">${esc(s)}</span>`).join('')}</div>`}

    ${report && report.blockers.length ? `<div class="note warn"><span class="m">!</span><span>${report.blockers.map(esc).join(' · ')}</span></div>` : ''}

    ${opts.footer !== undefined ? opts.footer : `<div class="job-foot">
      <button class="btn sm" data-act="job-detail" data-id="${job.id}">Ətraflı</button>
      ${applied
        ? `<span class="chip good">✓ Müraciət edilib</span>`
        : `<button class="btn sm primary" data-act="apply" data-id="${job.id}">Müraciət et</button>`}
      <div class="spacer"></div>
      <button class="btn sm ghost" data-act="save" data-id="${job.id}">${savedOn ? '★ Seçilmişlərdə' : '☆ Yadda saxla'}</button>
    </div>`}
  </article>`;
}

function emptyState(title, sub, action) {
  return `<div class="empty">${mascot('think')}<b>${esc(title)}</b><span>${esc(sub)}</span>${action || ''}</div>`;
}

function barRow(label, value, max, tone = '') {
  return `<div class="rm-line" style="grid-template-columns:minmax(0,1fr) 120px 42px;align-items:center">
    <span style="color:var(--ink-2);font-size:12.5px">${esc(label)}</span>
    <span class="bar"><i class="${tone}" style="width:${max ? Math.round((value / max) * 100) : 0}%"></i></span>
    <span class="num" style="text-align:right;font-size:12px">${value}</span>
  </div>`;
}

/* ================================================================ *
 * TƏLƏBƏ KABİNETİ
 * ================================================================ */
function viewStudentDashboard() {
  const s = Store.state.student;
  const jobs = Store.allJobs();
  const ranked = rankOpportunities(jobs, s);
  const comp = profileCompleteness(s);
  const gaps = skillGap(jobs, s, 5);
  const apps = Store.state.applications;
  const soon = jobs.filter(j => daysLeft(j.deadline) >= 0 && daysLeft(j.deadline) <= 21 && j.status !== 'pending')
    .sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, 4);

  const best = ranked[0] ? ranked[0].report.score : 0;

  return `
  <div class="welcome">
    <div class="welcome-text">
      <div class="eyebrow" style="color:#A7B6EE">Tələbə kabineti</div>
      <h2>Salam, ${esc(s.name.split(' ')[0])}</h2>
      <p>${s.faculty ? `${esc(s.major)} · ${esc(s.course)}. kurs · ${esc(s.faculty)}`
                     : 'Fakültənizi seçin ki, uyğunluq hesablana bilsin.'}</p>
      <div class="welcome-stats">
        <div><b>${best}%</b><span>ən yüksək uyğunluq</span></div>
        <div><b>${ranked.filter(r => r.report.score >= 65).length}</b><span>güclü imkan</span></div>
        <div><b>${apps.length}</b><span>müraciət</span></div>
        <div><b>${comp.percent}%</b><span>profil tamlığı</span></div>
      </div>
    </div>
    ${mascot('celebrate', { eager: true })}
  </div>

  <div class="page-head">
    <div>
      <h1>Bu gün nə edək?</h1>
      <p>İxtisasına uyğun imkanlar, CV və müsahibə hazırlığı — hamısı bir yerdə.</p>
    </div>
    <button class="btn primary" data-act="go" data-view="jobs">Sənə uyğun imkanlar →</button>
  </div>

  <div class="tiles">
    <div class="tile accent">
      <span class="k">Ən yüksək uyğunluq</span>
      <span class="v">${ranked[0] ? ranked[0].report.score + '%' : '—'}</span>
      <span class="s">${ranked[0] ? esc(ranked[0].job.title) : 'Profili doldurun'}</span>
    </div>
    <div class="tile">
      <span class="k">65%+ uyğun elan</span>
      <span class="v">${ranked.filter(r => r.report.score >= 65).length}</span>
      <span class="s">cəmi ${jobs.filter(j => j.status !== 'pending').length} aktiv elandan</span>
    </div>
    <div class="tile">
      <span class="k">Müraciətlər</span>
      <span class="v">${apps.length}</span>
      <span class="s">${apps.filter(a => a.status.includes('Müsahibə')).length} müsahibə dəvəti</span>
    </div>
    <div class="tile">
      <span class="k">Profil tamlığı</span>
      <span class="v">${comp.percent}%</span>
      <span class="s">${comp.missing.length ? esc(comp.missing.length + ' sahə boşdur') : 'Profil tamdır'}</span>
    </div>
  </div>

  <div class="grid side section">
    <div>
      <div class="section-head">
        <h2>Sənə uyğun imkanlar</h2>
        <span class="hint">İxtisasa görə avtomatik sıralanıb</span>
      </div>
      <div class="joblist">
        ${ranked.slice(0, 4).map((r, i) => jobCard(r.job, r.report, { top: i === 0 })).join('')}
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn" data-act="go" data-view="jobs">Bütün ${ranked.length} imkana bax →</button>
      </div>
    </div>

    <div class="stack">
      <div class="card">
        <div class="eyebrow">Uyğunluq necə hesablanır</div>
        <h2 style="font-size:15px;margin:6px 0 10px">40 / 40 / 20</h2>
        ${meterKey({ faculty: 40, major: 40, skills: 20 })}
        <p style="color:var(--muted);font-size:12px;margin:12px 0 0">
          Fakültə və ixtisas uyğunluğu balın 80%-ni, tələb olunan bacarıqların örtülməsi
          isə qalan 20%-ni təşkil edir. Eyni fakültədən fərqli ixtisas 15 bal alır.
        </p>
      </div>

      ${comp.percent < 100 ? `<div class="card">
        <div class="eyebrow">Profili gücləndir</div>
        <h2 style="font-size:15px;margin:6px 0 10px">${comp.percent}% tamdır</h2>
        <span class="bar"><i class="${comp.percent >= 80 ? 'good' : 'warn'}" style="width:${comp.percent}%"></i></span>
        <div class="stack tight" style="margin-top:12px">
          ${comp.missing.slice(0, 4).map(m => `<div class="row tight" style="font-size:12.5px;color:var(--ink-2)">
            <span class="status-dot idle"></span>${esc(m)}</div>`).join('')}
        </div>
        <button class="btn sm block" style="margin-top:12px" data-act="go" data-view="profile">Profili tamamla</button>
      </div>` : ''}

      ${gaps.length ? `<div class="card">
        <div class="eyebrow">Ən çox tələb olunan çatışmayan bacarıqlar</div>
        <div class="stack tight" style="margin-top:10px">
          ${gaps.map(g => barRow(g.skill, g.count, gaps[0].count)).join('')}
        </div>
        <p style="color:var(--muted);font-size:11.5px;margin:10px 0 0">
          Öz fakültən üzrə elanlarda neçə dəfə tələb olunduğuna görə.
        </p>
      </div>` : ''}

      <div class="card">
        <div class="eyebrow">Yaxınlaşan son tarixlər</div>
        <div class="stack tight" style="margin-top:10px">
          ${soon.map(j => {
            const d = daysLeft(j.deadline);
            return `<div class="row tight" style="justify-content:space-between;font-size:12.5px">
              <span style="min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(j.title)}</span>
              <span class="chip ${d <= 7 ? 'bad' : 'line'} mono">${d} gün</span></div>`;
          }).join('')}
        </div>
      </div>
    </div>
  </div>`;
}

function viewJobs() {
  const s = Store.state.student;
  const f = UI.jobFilter;
  let ranked = rankOpportunities(Store.allJobs(), s);

  if (f.type !== 'Hamısı') ranked = ranked.filter(r => r.job.type === f.type);
  if (f.min > 0) ranked = ranked.filter(r => r.report.score >= f.min);
  if (f.savedOnly) ranked = ranked.filter(r => Store.state.saved.includes(Number(r.job.id)));
  if (f.q) {
    const q = f.q.toLowerCase();
    ranked = ranked.filter(r => {
      const c = companyOf(r.job.companyId);
      return `${r.job.title} ${c.name} ${r.job.skills.join(' ')} ${r.job.location}`.toLowerCase().includes(q);
    });
  }

  const types = ['Hamısı', 'İş', 'Təcrübə', 'Graduate', 'Könüllülük'];
  return `
  <div class="page-head">
    <div>
      <div class="eyebrow">Smart Jobs</div>
      <h1>Sənə uyğun imkanlar</h1>
      <p>Elanlar fakültən, ixtisasın və bacarıqlarına görə avtomatik sıralanır.</p>
    </div>
  </div>

  <div class="card" style="padding:14px;margin-bottom:16px">
    <div class="row">
      <div class="searchbar">
        <span class="ico">⌕</span>
        <input type="search" id="job-q" placeholder="Vəzifə, şirkət, bacarıq…" value="${esc(f.q)}" data-act="filter-q">
      </div>
      <div class="field" style="width:170px">
        <label class="sr-only" for="job-min">Minimum uyğunluq</label>
        <select id="job-min" data-act="filter-min">
          ${[0, 45, 65, 85].map(v => `<option value="${v}" ${f.min === v ? 'selected' : ''}>
            ${v === 0 ? 'Bütün uyğunluqlar' : v + '%+ uyğunluq'}</option>`).join('')}
        </select>
      </div>
      <button class="btn ${f.savedOnly ? 'primary' : ''}" data-act="filter-saved">★ Seçilmişlər</button>
    </div>
    <div class="pills" style="margin-top:10px">
      ${types.map(t => `<button data-act="filter-type" data-type="${esc(t)}" aria-pressed="${f.type === t}">${esc(t)}</button>`).join('')}
    </div>
  </div>

  <div class="row" style="justify-content:space-between;margin-bottom:10px">
    <span class="eyebrow">${ranked.length} nəticə</span>
    <span class="meter-key">
      <span><i style="background:var(--seg-faculty)"></i>Fakültə</span>
      <span><i style="background:var(--seg-major)"></i>İxtisas</span>
      <span><i style="background:var(--seg-skill)"></i>Bacarıq</span>
    </span>
  </div>

  <div class="joblist">
    ${ranked.length
      ? ranked.map((r, i) => jobCard(r.job, r.report, { top: i === 0 && f.min === 0 && !f.q })).join('')
      : emptyState('Uyğun elan tapılmadı', 'Filtrləri yumşaldın və ya profilinizə yeni bacarıq əlavə edin.',
          '<button class="btn sm" data-act="go" data-view="profile">Profilə keç</button>')}
  </div>`;
}

function viewApplications() {
  const apps = Store.state.applications;
  const s = Store.state.student;
  return `
  <div class="page-head">
    <div>
      <div class="eyebrow">Tələbə kabineti</div>
      <h1>Müraciətlərim</h1>
      <p>Göndərdiyiniz müraciətlərin statusu və müsahibə dəvətləri.</p>
    </div>
  </div>

  ${apps.length ? `<div class="table-wrap">
    <table>
      <thead><tr>
        <th>Vəzifə</th><th>Şirkət</th><th>Tarix</th><th class="num">Uyğunluq</th><th>Status</th><th></th>
      </tr></thead>
      <tbody>
        ${apps.map(a => {
          const job = Store.jobById(a.jobId);
          if (!job) return '';
          const c = companyOf(job.companyId);
          const r = matchReport(job, s);
          const tone = a.status.includes('Müsahibə') ? 'good' : a.status.includes('İmtina') ? 'bad' : 'warn';
          return `<tr>
            <td><div class="who"><b>${esc(job.title)}</b><small>${esc(job.type)} · ${esc(job.location)}</small></div></td>
            <td>${esc(c.name || '')}</td>
            <td class="num">${fmtDate(a.at)}</td>
            <td class="num">${r.score}%</td>
            <td><span class="chip ${tone}">${esc(a.status)}</span>
              ${a.note ? `<div style="color:var(--muted);font-size:11.5px;margin-top:3px">${esc(a.note)}</div>` : ''}</td>
            <td><button class="btn sm danger" data-act="withdraw" data-id="${job.id}">Geri götür</button></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>` : emptyState('Hələ müraciət etməmisiniz', 'Sizə uyğun elanları nəzərdən keçirin.',
      '<button class="btn sm primary" data-act="go" data-view="jobs">İmkanlara bax</button>')}

  <div class="section">
    <div class="section-head"><h2>Seçilmiş elanlar</h2><span class="hint">${Store.state.saved.length} elan</span></div>
    <div class="joblist">
      ${Store.state.saved.length
        ? Store.state.saved.map(id => {
            const j = Store.jobById(id);
            return j ? jobCard(j, matchReport(j, s)) : '';
          }).join('')
        : emptyState('Seçilmiş elan yoxdur', 'Elanları ★ düyməsi ilə yadda saxlayın.')}
    </div>
  </div>`;
}

function educationModal() {
  openModal(`<div class="modal-head"><div>
      <div class="eyebrow">Education</div><h2 style="margin-top:6px">Təhsil əlavə et</h2></div>
      <button class="icon-btn" data-act="close-modal" aria-label="Bağla">×</button></div>
    <div class="stack">
      <div class="grid c2">
        <div class="field"><label for="edu-degree">Dərəcə</label><select id="edu-degree">
          <option>Bachelor</option><option>Master</option><option>PhD</option><option>Other</option>
        </select></div>
        <div class="field"><label for="edu-uni">Universitet</label><input id="edu-uni" value="ADNSU"></div>
        <div class="field"><label for="edu-faculty">Fakültə</label><input id="edu-faculty" placeholder="Fakültə"></div>
        <div class="field"><label for="edu-specialty">İxtisas</label><input id="edu-specialty" placeholder="İxtisas"></div>
        <div class="field"><label for="edu-specialization">İxtisaslaşma</label><input id="edu-specialization" placeholder="Magistr ixtisaslaşması"></div>
        <div class="field"><label for="edu-group">Qrup</label><input id="edu-group" placeholder="M-101"></div>
        <div class="field"><label for="edu-start">Başlama ili</label><input id="edu-start" type="number" min="1970" max="2100" value="${new Date().getFullYear()}"></div>
        <div class="field"><label for="edu-grad">Məzuniyyət ili</label><input id="edu-grad" type="number" min="1970" max="2100" value="${new Date().getFullYear() + 2}"></div>
      </div>
      <label class="check"><input id="edu-current" type="checkbox" checked> Hazırda burada təhsil alıram</label>
      <button type="button" class="btn primary block" data-act="education-save">Təhsili yadda saxla</button>
    </div>`);
}

function viewProfile() {
  const s = Store.state.student;
  const comp = profileCompleteness(s);
  const field = MAJOR_FIELD[s.major] || 'mexanika';
  const suggestions = (SKILL_SUGGESTIONS[field] || []).filter(x => !s.skills.includes(x)).slice(0, 10);

  return `
  <div class="page-head">
    <div>
      <div class="eyebrow">ADNSU Professional Profile</div>
      <h1>Profil</h1>
      <p>Bakalavr, magistr və məzun məlumatlarınızı bir profildə saxlayın. Dəqiq profil daha düzgün vakansiya və şəbəkə tövsiyələri verir.</p>
    </div>
    <div class="card" style="padding:12px 16px;min-width:210px">
      <div class="eyebrow">Profil tamlığı</div>
      <div class="row tight" style="margin:4px 0 6px"><span class="num" style="font-size:22px;font-weight:700">${comp.percent}%</span></div>
      <span class="bar"><i class="${comp.percent >= 80 ? 'good' : 'warn'}" style="width:${comp.percent}%"></i></span>
    </div>
  </div>

  <div class="grid side">
    <div class="stack">
      <div class="card pad-lg">
        <h2 style="font-size:15px;margin-bottom:14px">Şəxsi məlumatlar</h2>
        <div class="grid c2">
          <div class="field"><label for="p-name">Ad və soyad</label>
            <input id="p-name" type="text" value="${esc(s.name)}" data-bind="name"></div>
          <div class="field"><label for="p-email">Universitet e-poçtu</label>
            <input id="p-email" type="email" value="${esc(s.email)}" readonly aria-readonly="true" placeholder="ad.soyad@asoiu.edu.az"></div>
          <div class="field"><label for="p-personal-email">Şəxsi e-poçt</label>
            <input id="p-personal-email" type="email" value="${esc(s.personalEmail || '')}" data-bind="personalEmail" placeholder="ad.soyad@gmail.com">
            <span class="help">Məzun olduqdan sonra hesabınızı bərpa etmək üçün.</span></div>
          <div class="field"><label for="p-status">Təhsil statusu</label>
            <select id="p-status" data-bind="accountStatus">
              ${[['student','Tələbə'],['master_student','Magistr tələbəsi'],['graduate','Məzun'],['alumni','Alumni']]
                .map(([v,l]) => `<option value="${v}" ${s.accountStatus === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select></div>
          <div class="field"><label for="p-phone">Telefon</label>
            <input id="p-phone" type="tel" value="${esc(s.phone)}" data-bind="phone"></div>
          <div class="field"><label for="p-city">Şəhər</label>
            <input id="p-city" type="text" value="${esc(s.city)}" data-bind="city"></div>
        </div>
      </div>

      <div class="card pad-lg">
        <div class="row" style="justify-content:space-between;align-items:flex-start">
          <div><h2 style="font-size:15px;margin:0 0 5px">Təhsil</h2>
            <p style="color:var(--muted);font-size:12px;margin:0">Bakalavr, magistr, PhD və digər təhsil qeydlərini ayrıca əlavə edin.</p></div>
          <button class="btn sm primary" data-act="education-open">+ Təhsil əlavə et</button>
        </div>
        <div class="education-list">
          ${(s.education || []).map(e => `<article class="education-item">
            <div>
              <div class="row tight"><span class="chip line">${esc(e.degreeType)}</span>
                ${e.verified ? '<span class="chip good">✓ Təsdiqlənib</span>' : ''}
                ${e.isCurrent ? '<span class="chip warn">Davam edir</span>' : ''}</div>
              <h3>${esc(e.university || 'Universitet')}</h3>
              <p>${esc([e.faculty, e.specialty, e.specialization].filter(Boolean).join(' · '))}</p>
              <small>${esc(e.group ? `Qrup ${e.group} · ` : '')}${esc(e.startYear || '—')}–${esc(e.isCurrent ? 'davam edir' : (e.graduationYear || '—'))}</small>
            </div>
            <button class="btn sm ghost" data-act="education-delete" data-id="${esc(e.id)}" aria-label="Təhsil qeydini sil">Sil</button>
          </article>`).join('') || '<div class="empty"><b>Təhsil qeydi yoxdur</b><span>Uyğunluq və CV üçün ən azı bir qeyd əlavə edin.</span></div>'}
        </div>
      </div>

      <div class="card pad-lg">
        <h2 style="font-size:15px;margin-bottom:14px">Akademik məlumatlar</h2>
        <div class="grid c2">
          <div class="field"><label for="p-faculty">Fakültə</label>
            <select id="p-faculty" data-bind="faculty">
              ${!s.faculty ? '<option value="" selected disabled>— Fakültəni seçin —</option>' : ''}
              ${Object.keys(FACULTIES).map(f => `<option ${f === s.faculty ? 'selected' : ''}>${esc(f)}</option>`).join('')}
            </select>
            ${!s.faculty ? '<span class="help" style="color:var(--bad)">Uyğunluq hesablaması üçün mütləqdir.</span>' : ''}</div>
          <div class="field"><label for="p-major">İxtisas</label>
            <select id="p-major" data-bind="major" ${!s.faculty ? 'disabled' : ''}>
              ${!s.major ? '<option value="" selected disabled>— Əvvəlcə fakültə seçin —</option>' : ''}
              ${(FACULTIES[s.faculty] || []).map(m => `<option ${m === s.major ? 'selected' : ''}>${esc(m)}</option>`).join('')}
            </select></div>
          <div class="field"><label for="p-course">Kurs</label>
            <select id="p-course" data-bind="course">
              ${[1, 2, 3, 4].map(c => `<option value="${c}" ${Number(s.course) === c ? 'selected' : ''}>${c}. kurs</option>`).join('')}
            </select></div>
          <div class="field"><label for="p-gpa">GPA (100 ballıq)</label>
            <input id="p-gpa" type="number" min="0" max="100" value="${esc(s.gpa)}" data-bind="gpa">
            <span class="help">Elanların minimum GPA şərti bu dəyərlə tutuşdurulur.</span></div>
        </div>
      </div>

      <div class="card pad-lg">
        <h2 style="font-size:15px;margin-bottom:6px">Bacarıqlar</h2>
        <p style="color:var(--muted);font-size:12px;margin:0 0 12px">Uyğunluq balının 20 balı buradan gəlir.</p>
        <div class="taglist">
          ${s.skills.map(sk => `<span class="tag">${esc(sk)}
            <button data-act="skill-remove" data-skill="${esc(sk)}" aria-label="${esc(sk)} sil">×</button></span>`).join('')
            || '<span style="color:var(--muted);font-size:12.5px">Hələ bacarıq əlavə edilməyib.</span>'}
        </div>
        <div class="row" style="margin-top:12px">
          <div class="searchbar" style="max-width:300px">
            <span class="ico">＋</span>
            <input type="text" id="skill-input" placeholder="Yeni bacarıq yazıb Enter basın" data-act="skill-input">
          </div>
        </div>
        ${suggestions.length ? `<div style="margin-top:12px">
          <div class="eyebrow" style="margin-bottom:7px">${esc(s.major)} üçün təklif olunanlar</div>
          <div class="skillpick">
            ${suggestions.map(x => `<button data-act="skill-add" data-skill="${esc(x)}">+ ${esc(x)}</button>`).join('')}
          </div></div>` : ''}
      </div>

      <div class="card pad-lg">
        <h2 style="font-size:15px;margin-bottom:14px">Dillər, sertifikatlar və linklər</h2>
        <div class="stack">
          <div class="field"><label for="p-lang">Dillər</label>
            <input id="p-lang" type="text" value="${esc(s.languages)}" data-bind="languages"
              placeholder="Azərbaycan (Ana dili), İngilis (B2)…"></div>
          <div class="field"><label for="p-cert">Sertifikatlar</label>
            <input id="p-cert" type="text" value="${esc(s.certificates)}" data-bind="certificates"></div>
          <div class="grid c3">
            <div class="field"><label for="p-li">LinkedIn</label>
              <input id="p-li" type="text" value="${esc(s.linkedin)}" data-bind="linkedin" placeholder="linkedin.com/in/…"></div>
            <div class="field"><label for="p-gh">GitHub</label>
              <input id="p-gh" type="text" value="${esc(s.github)}" data-bind="github" placeholder="github.com/…"></div>
            <div class="field"><label for="p-pf">Portfolio</label>
              <input id="p-pf" type="text" value="${esc(s.portfolio)}" data-bind="portfolio"></div>
          </div>
          <div class="field"><label for="p-sum">Qısa xülasə</label>
            <textarea id="p-sum" data-bind="summary" placeholder="2–3 cümlə: ixtisasınız, əsas layihəniz, hədəfiniz.">${esc(s.summary)}</textarea></div>
        </div>
      </div>
    </div>

    <div class="stack">
      <div class="card">
        <div class="eyebrow">Profil dəyişikliyinin təsiri</div>
        <h2 style="font-size:15px;margin:6px 0 12px">Ən yaxşı 3 uyğunluq</h2>
        <div class="stack tight">
          ${rankOpportunities(Store.allJobs(), s).slice(0, 3).map(r => `
            <div style="padding:9px 0;border-top:1px solid var(--line)">
              <div style="font-size:12.5px;font-weight:600">${esc(r.job.title)}</div>
              <div style="color:var(--muted);font-size:11.5px;margin-bottom:6px">${esc((companyOf(r.job.companyId)).name || '')}</div>
              ${meterHTML(r.report)}
            </div>`).join('')}
        </div>
      </div>

      ${comp.missing.length ? `<div class="card">
        <div class="eyebrow">Tamamlanmamış sahələr</div>
        <div class="stack tight" style="margin-top:10px">
          ${comp.missing.map(m => `<div class="row tight" style="font-size:12.5px;color:var(--ink-2)">
            <span class="status-dot bad"></span>${esc(m)}</div>`).join('')}
        </div>
      </div>` : `<div class="note good"><span class="m">✓</span><span>Profil tamdır. Şirkət axtarışlarında görünürsünüz.</span></div>`}

      ${accountCard()}
      ${passwordCard()}

      <div class="note"><span class="m">ⓘ</span><span>Universitet hesabınızla təsdiqləndikdən sonra “Verified ADNSU Alumni” statusu məzun profilinizdə qalır.</span></div>
    </div>
  </div>`;
}

/* ---------------------------- CV Mərkəzi ---------------------------- */
function viewCV() {
  const tabs = [
    ['build', 'CV yarat'],
    ['designer', 'Şablonlu qurucu'],
    ['upload', 'CV yüklə'],
    ['analyze', 'CV-ni analiz et'],
    ['compare', 'Vakansiya ilə müqayisə']
  ];
  return `
  <div class="page-head">
    <div>
      <div class="eyebrow">CV Center</div>
      <h1>CV Mərkəzi</h1>
      <p>CV yaradın, ATS uyğunluğunu yoxlayın və AI ilə xülasə, təcrübə bəndləri və vakansiyaya uyğun açar sözlər hazırlayın.</p>
    </div>
  </div>
  <div class="pills no-print" style="margin-bottom:16px">
    ${tabs.map(([id, l]) => `<button data-act="cv-tab" data-tab="${id}" aria-pressed="${UI.cvTab === id}">${esc(l)}</button>`).join('')}
  </div>
  ${UI.cvTab === 'build' ? cvBuild()
    : UI.cvTab === 'designer' ? cvDesigner()
    : UI.cvTab === 'upload' ? cvUpload()
    : UI.cvTab === 'analyze' ? cvAnalyze()
    : cvCompare()}`;
}

/* ------------------- Şablonlu CV qurucusu ------------------- */
function cvDesignerPayload(student) {
  const s = student || {};
  const splitLines = value => String(value || '').split(/[,;\n]/).map(x => x.trim()).filter(Boolean);
  return {
    name: s.name || '',
    photo: s.avatarUrl || null,
    contact: {
      phone: s.phone || '', email: s.email || '', location: s.city || 'Bakı, Azərbaycan',
      linkedin: s.linkedin || '', website: s.portfolio || s.github || ''
    },
    summary: {
      tagline: s.summary || '', bullets: [], skills: Array.isArray(s.skills) ? s.skills : []
    },
    experience: (s.experience || []).map(item => ({
      title: item.role || '', company: item.org || '', location: '',
      start: item.period || '', end: '', summary: '', bullets: splitLines(item.detail)
    })),
    education: (s.education || []).map(item => ({
      degree: [item.degreeType, item.specialty, item.specialization].filter(Boolean).join(' · '),
      school: item.university || 'ADNSU', location: 'Bakı, Azərbaycan',
      date: [item.startYear, item.isCurrent ? 'davam edir' : item.graduationYear].filter(Boolean).join(' — '),
      honors: item.group ? `Qrup: ${item.group}` : ''
    })),
    certifications: splitLines(s.certificates).map(name => ({ name, org: '', date: '' })),
    projects: (s.projects || []).map(item => ({ name: item.name || '', description: item.detail || '', bullets: [] })),
    awards: []
  };
}

function cvDesigner() {
  const s = Store.state.student;
  const ready = !!(s && s.name);
  if (ready) {
    try {
      localStorage.setItem('asoiu-cv-profile-data', JSON.stringify(cvDesignerPayload(s)));
    } catch (e) { /* yaddaş bağlıdırsa qurucu boş açılır */ }
  }
  return `<div class="card cv-designer-head">
    <div>
      <div class="eyebrow">ASOIU CV Studio · 12 peşəkar şablon</div>
      <h2>CV-ni burada redaktə edin, Word və ya PDF kimi endirin</h2>
      <p>Profil və bakalavr/magistr təhsil məlumatlarınız qurucuya avtomatik ötürülür. Qaralama yalnız sizin brauzerinizdə saxlanılır.</p>
    </div>
    <div class="row">
      ${ready ? '<span class="chip good">✓ Profil məlumatları əlavə edildi</span>' : '<span class="chip warn">Profil boşdur — məlumatları qurucuda yazın</span>'}
      <a class="btn primary" href="cv-builder.html" target="_blank" rel="noopener">Tam ekranda aç ↗</a>
    </div>
  </div>
  <div class="cv-builder-wrap">
    <iframe id="cv-builder-frame" class="cv-builder-frame" src="cv-builder.html?embed=1"
      title="ASOIU şablonlu CV qurucusu" loading="eager"
      sandbox="allow-scripts allow-same-origin allow-downloads allow-modals allow-forms"></iframe>
  </div>`;
}

function cvBuild() {
  const s = Store.state.student;
  const cv = buildCVFromProfile(s);
  return `<div class="grid side">
    <div class="stack">
      <div class="card">
        <div class="row" style="justify-content:space-between">
          <div><div class="eyebrow">Önizləmə</div>
            <h2 style="font-size:15px;margin-top:4px">Profilinizdən avtomatik qurulub</h2></div>
          <button class="btn primary no-print" data-act="cv-print">⎙ PDF kimi saxla</button>
        </div>
      </div>
      <div class="cvsheet" id="cv-sheet">
        <h2>${esc(cv.name || 'Ad Soyad')}</h2>
        <div class="cv-role">${esc(cv.title)}</div>
        <div class="cv-contact">
          ${[cv.email, cv.phone, cv.city, ...cv.links].filter(Boolean).map(x => `<span>${esc(x)}</span>`).join('')}
        </div>
        ${cv.summary ? `<h3>Xülasə</h3><p style="margin:0">${esc(cv.summary)}</p>` : ''}
        <h3>Təhsil</h3>
        ${cv.education.map(e => `<div class="cv-item">
          <b>${esc(e.school)}</b>
          <div class="meta">${esc(e.program)} · ${esc(e.period)}${e.note ? ' · ' + esc(e.note) : ''}</div>
        </div>`).join('')}
        ${cv.experience.length ? `<h3>Təcrübə</h3>${cv.experience.map(e => `<div class="cv-item">
          <b>${esc(e.role)}</b><div class="meta">${esc(e.org)} · ${esc(e.period)}</div>
          <p>${esc(e.detail)}</p></div>`).join('')}` : ''}
        ${cv.projects.length ? `<h3>Layihələr</h3>${cv.projects.map(p => `<div class="cv-item">
          <b>${esc(p.name)}</b><p>${esc(p.detail)}</p></div>`).join('')}` : ''}
        <h3>Bacarıqlar</h3>
        <div class="cv-skills">${cv.skills.map(x => `<span>${esc(x)}</span>`).join('')}</div>
        ${cv.languages ? `<h3>Dillər</h3><p style="margin:0">${esc(cv.languages)}</p>` : ''}
        ${cv.certificates ? `<h3>Sertifikatlar</h3><p style="margin:0">${esc(cv.certificates)}</p>` : ''}
      </div>
    </div>

    <div class="stack no-print">
      <div class="card">
        <div class="eyebrow">Təcrübə əlavə et</div>
        <div class="stack tight" style="margin-top:10px">
          <div class="field"><label for="x-role">Vəzifə</label><input id="x-role" type="text" placeholder="Laboratoriya köməkçisi"></div>
          <div class="field"><label for="x-org">Təşkilat</label><input id="x-org" type="text" placeholder="SOCAR"></div>
          <div class="field"><label for="x-period">Dövr</label><input id="x-period" type="text" placeholder="İyun 2026 – Avqust 2026"></div>
          <div class="field"><label for="x-detail">Nəticə (rəqəmlə)</label>
            <textarea id="x-detail" placeholder="Nasos təmir dövrünü 18% qısaltdım…"></textarea></div>
          <button class="btn primary" data-act="cv-add-exp">Əlavə et</button>
        </div>
      </div>
      <div class="card">
        <div class="eyebrow">Layihə əlavə et</div>
        <div class="stack tight" style="margin-top:10px">
          <div class="field"><label for="x-pname">Layihə adı</label><input id="x-pname" type="text"></div>
          <div class="field"><label for="x-pdetail">Təsvir</label><textarea id="x-pdetail"></textarea></div>
          <button class="btn primary" data-act="cv-add-proj">Əlavə et</button>
        </div>
      </div>
      <div class="note"><span class="m">ⓘ</span><span>«PDF kimi saxla» brauzerin çap pəncərəsini açır — hədəf olaraq «PDF-ə saxla» seçin.</span></div>
    </div>
  </div>`;
}

function cvUpload() {
  return `<div class="grid side">
    <div class="card pad-lg">
      <div class="eyebrow">CV mətnini yapışdırın</div>
      <h2 style="font-size:15px;margin:6px 0 4px">Mövcud CV-nizi buraya köçürün</h2>
      <p style="color:var(--muted);font-size:12.5px;margin:0 0 12px">
        PDF və ya DOCX faylınızı açıb mətni seçin (Ctrl+A → Ctrl+C) və aşağıya yapışdırın.
        Mətn yalnız başladığınız analiz üçün istifadə olunur və CV-nin tam mətni bazada saxlanmır.
      </p>
      <div class="field">
        <label for="cv-text" class="sr-only">CV mətni</label>
        <textarea id="cv-text" style="min-height:280px" data-act="cv-text"
          placeholder="Ad Soyad&#10;aylin@asoiu.edu.az | +994 …&#10;&#10;TƏHSİL&#10;ADNSU, Kimya mühəndisliyi…">${esc(UI.cvText)}</textarea>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn primary" data-act="cv-analyze-now">Analiz et →</button>
        <button class="btn" data-act="cv-use-profile">Profilimdən doldur</button>
      </div>
    </div>
    <div class="stack">
      <div class="card">
        <div class="eyebrow">Nə yoxlanılır</div>
        <div class="stack tight" style="margin-top:10px;font-size:12.5px;color:var(--ink-2)">
          ${CV_SECTIONS.map(x => `<div class="row tight"><span class="status-dot idle"></span>${esc(x.label)}</div>`).join('')}
          <div class="row tight"><span class="status-dot idle"></span>Ölçülə bilən nəticələr</div>
          <div class="row tight"><span class="status-dot idle"></span>Fəaliyyət felləri</div>
          <div class="row tight"><span class="status-dot idle"></span>Həcm balansı</div>
        </div>
      </div>
    </div>
  </div>`;
}

function cvAnalyze() {
  const text = UI.cvText || cvToText(buildCVFromProfile(Store.state.student));
  const a = analyzeCV(text);
  const tone = a.score >= 75 ? 'good' : a.score >= 50 ? 'warn' : 'bad';
  return `<div class="grid side">
    <div class="stack">
      <div class="card pad-lg">
        <div class="row" style="justify-content:space-between;align-items:flex-start">
          <div>
            <div class="eyebrow">CV bal hesabatı</div>
            <div class="bigscore" style="margin-top:8px"><b style="color:var(--${tone})">${a.score}</b><span>/ 100</span></div>
          </div>
          <div style="text-align:right">
            <div class="eyebrow">Söz sayı</div>
            <div class="num" style="font-size:20px;font-weight:600">${a.stats.words}</div>
          </div>
        </div>
        <span class="bar" style="margin-top:14px"><i class="${tone}" style="width:${a.score}%"></i></span>
        <p style="color:var(--muted);font-size:12px;margin:10px 0 0">
          Struktur 45 bal · Məzmun 35 bal · Ölçülə bilən nəticə və linklər 20 bal.
        </p>
      </div>

      <div class="card pad-lg">
        <h2 style="font-size:15px;margin-bottom:12px">Tövsiyələr</h2>
        <div class="stack tight">
          ${a.findings.map(f => `<div class="note ${f.tone}">
            <span class="m">${f.tone === 'good' ? '✓' : f.tone === 'warn' ? '!' : '×'}</span>
            <span>${esc(f.text)}</span></div>`).join('')}
        </div>
      </div>
    </div>

    <div class="stack">
      <div class="card ai-panel">
        <div class="row" style="align-items:flex-start">
          <div><div class="eyebrow">AI karyera köməkçisi</div>
            <h2 style="font-size:15px;margin:5px 0 4px">Məzmunu peşəkarlaşdır</h2>
            <p style="color:var(--muted);font-size:12px;margin:0">Xülasə, təcrübə bəndləri və açar sözlər üzrə fərdi rəy alın.</p></div>
        </div>
        <button class="btn primary block" style="margin-top:12px" data-act="cv-ai-analyze" ${UI.aiBusy ? 'disabled' : ''}>
          ${UI.aiBusy ? 'AI analiz edir…' : 'AI ilə dərin analiz et'}</button>
        ${UI.aiCvResult ? renderAIResult(UI.aiCvResult) : ''}
      </div>
      <div class="card">
        <div class="eyebrow">Bölmə yoxlaması</div>
        <div class="stack tight" style="margin-top:10px">
          ${a.sections.map(sec => `<div class="row tight" style="font-size:12.5px;justify-content:space-between">
            <span style="color:var(--ink-2)">${esc(sec.label)}</span>
            <span class="chip ${sec.found ? 'good' : 'bad'}">${sec.found ? 'var' : 'yoxdur'}</span>
          </div>`).join('')}
        </div>
      </div>
      <div class="card">
        <div class="eyebrow">Ölçülər</div>
        <dl class="kv" style="margin-top:10px">
          <dt>Bənd işarəsi</dt><dd class="num">${a.stats.bullets}</dd>
          <dt>Rəqəmli nəticə</dt><dd class="num">${a.stats.numbers}</dd>
          <dt>Fəaliyyət feli</dt><dd class="num">${a.stats.verbs}</dd>
          <dt>Tapılan bölmə</dt><dd class="num">${a.stats.sections}/${CV_SECTIONS.length}</dd>
        </dl>
      </div>
      <button class="btn block" data-act="cv-tab" data-tab="upload">Mətni dəyiş</button>
    </div>
  </div>`;
}

function renderAIResult(result) {
  if (!result) return '';
  if (typeof result === 'string') return `<div class="ai-result"><p>${esc(result)}</p></div>`;
  const summary = result.summary || result.overview || result.feedback || '';
  const strengths = result.strengths || result.good || [];
  const improvements = result.improvements || result.recommendations || result.actions || [];
  const keywords = result.keywords || result.missing_keywords || [];
  return `<div class="ai-result">
    ${summary ? `<p>${esc(summary)}</p>` : ''}
    ${strengths.length ? `<h4>Güclü tərəflər</h4><ul>${strengths.map(x => `<li>${esc(typeof x === 'string' ? x : x.text || x.title)}</li>`).join('')}</ul>` : ''}
    ${improvements.length ? `<h4>Təkmilləşdirmələr</h4><ul>${improvements.map(x => `<li>${esc(typeof x === 'string' ? x : x.text || x.title)}</li>`).join('')}</ul>` : ''}
    ${keywords.length ? `<div class="skillrow">${keywords.map(x => `<span class="sk">${esc(x)}</span>`).join('')}</div>` : ''}
  </div>`;
}

function cvCompare() {
  const s = Store.state.student;
  const jobs = Store.allJobs().filter(j => j.status !== 'pending');
  const jobId = UI.compareJob || (rankOpportunities(jobs, s)[0] || {}).job?.id || jobs[0].id;
  const job = Store.jobById(jobId);
  const text = UI.cvText || cvToText(buildCVFromProfile(s));
  const cmp = compareCVtoJob(text, job);
  const rep = matchReport(job, s);
  const tone = cmp.score >= 75 ? 'good' : cmp.score >= 50 ? 'warn' : 'bad';
  const c = companyOf(job.companyId);

  return `<div class="grid side">
    <div class="stack">
      <div class="card">
        <div class="field">
          <label for="cmp-job">Vakansiya seçin</label>
          <select id="cmp-job" data-act="cmp-job">
            ${jobs.map(j => `<option value="${j.id}" ${String(j.id) === String(jobId) ? 'selected' : ''}>
              ${esc((companyOf(j.companyId)).name || '')} — ${esc(j.title)}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="card pad-lg">
        <div class="grid c2" style="gap:20px">
          <div>
            <div class="eyebrow">CV → vakansiya uyğunluğu</div>
            <div class="bigscore" style="margin-top:8px"><b style="color:var(--${tone})">${cmp.score}</b><span>/ 100</span></div>
            <span class="bar" style="margin-top:10px"><i class="${tone}" style="width:${cmp.score}%"></i></span>
            <p style="color:var(--muted);font-size:11.5px;margin:8px 0 0">Mətndəki açar sözlərə görə (ATS məntiqi).</p>
          </div>
          <div>
            <div class="eyebrow">Profil → vakansiya uyğunluğu</div>
            <div style="margin-top:8px">${meterHTML(rep, { lg: true, key: true })}</div>
            <p style="color:var(--muted);font-size:11.5px;margin:8px 0 0">Fakültə, ixtisas və bacarıqlara görə.</p>
          </div>
        </div>
      </div>

      <div class="card pad-lg">
        <h2 style="font-size:15px;margin-bottom:6px">${esc(job.title)}</h2>
        <p style="color:var(--muted);font-size:12.5px;margin:0 0 14px">${esc(c.name)} · ${esc(job.summary)}</p>
        <div class="eyebrow" style="margin-bottom:7px">Tələb olunan bacarıqlar</div>
        <div class="skillrow">
          ${job.skills.map(sk => `<span class="sk ${cmp.skillHits.includes(sk) ? 'hit' : 'gap'}">
            ${cmp.skillHits.includes(sk) ? '✓ ' : '× '}${esc(sk)}</span>`).join('')}
        </div>
        ${cmp.skillGaps.length ? `<div class="note warn" style="margin-top:14px"><span class="m">!</span>
          <span>CV-nizdə tapılmayan tələblər: <b>${cmp.skillGaps.map(esc).join(', ')}</b>.
          Bu bacarıqlara sahibsinizsə, onları CV mətnində açıq şəkildə adlandırın.</span></div>`
          : `<div class="note good" style="margin-top:14px"><span class="m">✓</span>
          <span>Bütün tələb olunan bacarıqlar CV mətnində keçir.</span></div>`}
      </div>
    </div>

    <div class="stack">
      <div class="card">
        <div class="eyebrow">CV-də tapılan açar sözlər</div>
        <div class="skillrow" style="margin-top:10px">
          ${cmp.hits.length ? cmp.hits.map(h => `<span class="sk hit">${esc(h)}</span>`).join('')
            : '<span style="color:var(--muted);font-size:12.5px">Heç biri tapılmadı.</span>'}
        </div>
      </div>
      <div class="card">
        <div class="eyebrow">Çatışmayan açar sözlər</div>
        <div class="skillrow" style="margin-top:10px">
          ${cmp.gaps.length ? cmp.gaps.map(h => `<span class="sk gap">${esc(h)}</span>`).join('')
            : '<span style="color:var(--muted);font-size:12.5px">Yoxdur.</span>'}
        </div>
      </div>
      ${!Store.isApplied(job.id) ? `<button class="btn primary block" data-act="apply" data-id="${job.id}">Bu vakansiyaya müraciət et</button>`
        : '<div class="note good"><span class="m">✓</span><span>Bu vakansiyaya müraciət etmisiniz.</span></div>'}
    </div>
  </div>`;
}

/* ------------------------- Müsahibə hazırlığı ------------------------- */
function viewInterview() {
  const s = Store.state.student;
  const iv = Store.state.interview;
  if (iv && iv.done) return interviewResult(iv);
  if (iv) return interviewRun(iv);

  const jobs = Store.allJobs().filter(j => j.status !== 'pending');
  const companies = [...new Set(jobs.map(j => j.companyId))].map(id => companyOf(id)).filter(Boolean);

  return `
  <div class="page-head">
    <div class="mascot-inline">
      ${mascot('thumbsup')}
      <div>
      <div class="eyebrow">Interview Prep</div>
      <h1>Müsahibə simulyatoru</h1>
      <p>Şirkət, vəzifə və müsahibə tipini seçin — sistem sizin ixtisasınıza uyğun suallar verəcək,
         cavablarınızı isə beş ölçü üzrə qiymətləndirəcək.</p>
      </div>
    </div>
  </div>

  <div class="grid side">
    <div class="card pad-lg">
      <div class="grid c2">
        <div class="field"><label for="iv-company">Şirkət</label>
          <select id="iv-company">${companies.map(c => `<option value="${c.id}" ${c.id === 'socar' ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="iv-role">Vəzifə</label>
          <input id="iv-role" type="text" value="${esc(rankOpportunities(jobs, s)[0]?.job.title || 'Mechanical Engineer')}"></div>
        <div class="field"><label for="iv-type">Müsahibə tipi</label>
          <select id="iv-type">
            <option value="Quick Interview">Sürətli müsahibə</option>
            <option value="Technical">Texniki müsahibə</option>
            <option value="HR">HR müsahibəsi</option>
            <option value="Technical + HR" selected>Tam sınaq müsahibəsi</option>
          </select></div>
        <div class="field"><label for="iv-count">Sual sayı</label>
          <select id="iv-count">${[4, 6, 8, 10].map(n => `<option ${n === 6 ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      </div>
      <div class="field" style="margin-top:12px"><label for="iv-description">Vakansiya təsviri (istəyə bağlı)</label>
        <textarea id="iv-description" placeholder="Tələbləri bura yapışdırın — AI sualları həmin vakansiyaya uyğunlaşdırsın."></textarea></div>
      <div class="note" style="margin-top:16px"><span class="m">ⓘ</span>
        <span>Texniki suallar <b>${esc(s.major)}</b> ixtisası üzrə sual bankından seçilir.</span></div>
      <button class="btn primary block" style="margin-top:16px" data-act="iv-start">Müsahibəyə başla →</button>
    </div>

    <div class="stack">
      <div class="card">
        <div class="eyebrow">Qiymətləndirmə ölçüləri</div>
        <div class="stack tight" style="margin-top:10px;font-size:12.5px;color:var(--ink-2)">
          <div class="row tight" style="justify-content:space-between"><span>Ünsiyyət</span><span class="num">25 bal</span></div>
          <div class="row tight" style="justify-content:space-between"><span>Texniki bilik</span><span class="num">30 bal</span></div>
          <div class="row tight" style="justify-content:space-between"><span>Cavab strukturu</span><span class="num">20 bal</span></div>
          <div class="row tight" style="justify-content:space-between"><span>Özünəinam</span><span class="num">15 bal</span></div>
          <div class="row tight" style="justify-content:space-between"><span>İngilis dili</span><span class="num">10 bal</span></div>
        </div>
      </div>
      <div class="note"><span class="m">ⓘ</span><span>AI xidməti əlçatan olmadıqda sistem şəffaf lokal qiymətləndirmə ilə davam edir. Nəticə hazırlıq məqsədlidir.</span></div>
    </div>
  </div>`;
}

function interviewRun(iv) {
  const c = companyOf(iv.companyId);
  return `
  <div class="page-head">
    <div>
      <div class="eyebrow">${esc(c.name)} · ${esc(iv.type)}</div>
      <h1>${esc(iv.role)}</h1>
      <p>Hər suala 3–5 cümlə ilə cavab verin. Tamamlanan sınağın nəticəsi şəxsi hazırlıq tarixçənizdə saxlanır.</p>
    </div>
    <button class="btn danger" data-act="iv-cancel">Ləğv et</button>
  </div>

  <div class="stack">
    ${iv.questions.map((q, i) => `<div class="q-card">
      <div class="q-head">
        <span class="q-num">${String(i + 1).padStart(2, '0')}</span>
        <h3>${esc(q.q)}</h3>
        <span class="chip mono">${esc(q.group)}</span>
      </div>
      <div class="q-hint">${esc(q.hint)}</div>
      <div class="field">
        <label class="sr-only" for="ans-${i}">Cavab ${i + 1}</label>
        <textarea id="ans-${i}" data-act="iv-answer" data-i="${i}"
          placeholder="Cavabınızı yazın…">${esc(iv.answers[i] || '')}</textarea>
      </div>
    </div>`).join('')}
  </div>

  <div class="row" style="margin-top:18px">
    <button class="btn primary" data-act="iv-finish">Cavabları qiymətləndir →</button>
    <span style="color:var(--muted);font-size:12.5px">
      ${iv.answers.filter(a => a && a.trim().split(/\s+/).length >= 5).length}/${iv.questions.length} sual cavablandırılıb
    </span>
  </div>`;
}

function interviewResult(iv) {
  const res = iv.result;
  const c = companyOf(iv.companyId);
  const tone = res.total >= 80 ? 'good' : res.total >= 60 ? 'warn' : 'bad';
  return `
  <div class="page-head">
    <div>
      <div class="eyebrow">Nəticə · ${esc(c.name)} · ${esc(iv.role)}</div>
      <h1>Müsahibə hesabatı</h1>
    </div>
    <div class="row">
      <button class="btn" data-act="iv-review">Cavablara qayıt</button>
      <button class="btn primary" data-act="iv-new">Yeni müsahibə</button>
    </div>
  </div>

  <div class="grid side">
    <div class="stack">
      <div class="card pad-lg">
        <div class="row" style="justify-content:space-between;align-items:flex-start">
          <div>
            <div class="eyebrow">Interview Score</div>
            <div class="bigscore" style="margin-top:8px"><b style="color:var(--${tone})">${res.total}</b><span>/ 100</span></div>
            <div class="chip ${tone}" style="margin-top:10px">${esc(res.band)}</div>
          </div>
          <div style="text-align:right">
            <div class="eyebrow">Cavablandırılıb</div>
            <div class="num" style="font-size:20px;font-weight:600">${res.answeredCount}/${iv.questions.length}</div>
          </div>
        </div>
      </div>
      ${iv.aiResult ? `<div class="card ai-panel"><div class="eyebrow">AI müsahibə rəyi</div>${renderAIResult(iv.aiResult)}</div>` : ''}

      <div class="card pad-lg">
        <h2 style="font-size:15px;margin-bottom:14px">Ölçülər üzrə</h2>
        <div class="scorelist">
          ${Object.entries(res.dims).map(([k, v]) => `<div class="scoreline">
            <span>${esc(DIM_LABELS[k])}</span>
            <span class="bar"><i class="${v >= 7.5 ? 'good' : v >= 5 ? 'warn' : 'bad'}" style="width:${v * 10}%"></i></span>
            <span class="v">${v}/10</span>
          </div>`).join('')}
        </div>
      </div>

      <div class="card pad-lg">
        <h2 style="font-size:15px;margin-bottom:12px">Sual-sual baxış</h2>
        <div class="stack tight">
          ${res.rows.map((r, i) => `<div style="padding:10px 0;border-top:1px solid var(--line)">
            <div class="row tight" style="justify-content:space-between;align-items:flex-start">
              <span style="font-size:12.5px;font-weight:600;flex:1;min-width:0">${String(i + 1).padStart(2, '0')}. ${esc(r.q.q)}</span>
              <span class="chip ${!r.score.answered ? 'bad' : r.score.technical >= 7 ? 'good' : 'warn'}">
                ${r.score.answered ? 'Texniki ' + r.score.technical + '/10' : 'cavabsız'}</span>
            </div>
            ${r.score.note ? `<div style="color:var(--muted);font-size:11.5px;margin-top:4px">→ ${esc(r.score.note)}</div>` : ''}
          </div>`).join('')}
        </div>
      </div>
    </div>

    <div class="stack">
      <div class="card">
        <div class="eyebrow">Növbəti addımlar</div>
        <div class="stack tight" style="margin-top:10px">
          ${res.tips.map(t => `<div class="note warn"><span class="m">→</span><span>${esc(t)}</span></div>`).join('')
            || '<div class="note good"><span class="m">✓</span><span>Cavablar güclüdür. Vaxt məhdudiyyəti ilə təkrarlayın.</span></div>'}
        </div>
      </div>
      <div class="card">
        <div class="eyebrow">Tövsiyə olunan tədbir</div>
        <div style="margin-top:8px">
          <b style="font-size:13px">Mock Interview Marathon</b>
          <div style="color:var(--muted);font-size:12px">3 Oktyabr · Karyera Mərkəzi</div>
          <button class="btn sm block" style="margin-top:10px" data-act="go" data-view="events">Tədbirlərə bax</button>
        </div>
      </div>
    </div>
  </div>`;
}

/* ------------------------ Karyera yol xəritəsi ------------------------ */
function viewRoadmap() {
  const s = Store.state.student;
  const field = MAJOR_FIELD[s.major] || 'mexanika';
  const rm = ROADMAP_TEMPLATES[field];
  const course = Number(s.course) || 1;
  const stageIndex = course <= 2 ? 0 : course === 3 ? 1 : 2;
  const gaps = skillGap(Store.allJobs(), s, 6);

  return `
  <div class="page-head">
    <div class="mascot-inline">
      ${mascot('walk')}
      <div>
        <div class="eyebrow">Career Roadmap · ${esc(s.major)}</div>
        <h1>Karyera yol xəritəsi</h1>
        <p>Hədəf: <b>${esc(rm.goal)}</b>. Mərhələlər kursunuza görə işarələnib.</p>
      </div>
    </div>
  </div>

  <div class="grid side">
    <div class="card pad-lg">
      <div class="roadmap">
        ${rm.stages.map((st, i) => {
          const state = i < stageIndex ? 'done' : i === stageIndex ? 'now' : '';
          const have = st.skills.filter(x => s.skills.includes(x));
          return `<div class="rm-stage ${state}">
            <div class="rm-when">
              <b>${esc(st.term)}</b>
              <small>${i < stageIndex ? 'keçilib' : i === stageIndex ? 'hazırkı mərhələ' : 'qarşıda'}</small>
            </div>
            <div class="rm-body">
              <h4>${esc(st.focus)}</h4>
              <div class="rm-line"><span>Bacarıqlar</span>
                <div class="skillrow">${st.skills.map(x => `<span class="sk ${have.includes(x) ? 'hit' : ''}">${have.includes(x) ? '✓ ' : ''}${esc(x)}</span>`).join('')}</div>
              </div>
              <div class="rm-line"><span>Addımlar</span>
                <ul>${st.actions.map(a => `<li>${esc(a)}</li>`).join('')}</ul>
              </div>
              ${st.certs.length ? `<div class="rm-line"><span>Sertifikatlar</span>
                <div class="skillrow">${st.certs.map(x => `<span class="sk">${esc(x)}</span>`).join('')}</div></div>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>

    <div class="stack">
      <div class="card">
        <div class="eyebrow">Sənin üçün prioritet bacarıqlar</div>
        <p style="color:var(--muted);font-size:11.5px;margin:6px 0 10px">
          ${esc(s.faculty)} üzrə aktiv elanlarda ən çox tələb olunan, amma profilində olmayanlar.
        </p>
        <div class="stack tight">
          ${gaps.length ? gaps.map(g => barRow(g.skill, g.count, gaps[0].count, 'warn')).join('')
            : '<span style="color:var(--muted);font-size:12.5px">Bütün tələb olunan bacarıqlar profilinizdədir.</span>'}
        </div>
        <button class="btn sm block" style="margin-top:12px" data-act="go" data-view="profile">Profilə əlavə et</button>
      </div>

      <div class="card">
        <div class="eyebrow">Bu mərhələdə müraciət edə biləcəyin</div>
        <div class="stack tight" style="margin-top:10px">
          ${rankOpportunities(Store.allJobs(), s).filter(r => r.report.eligible).slice(0, 3).map(r => `
            <div style="padding:8px 0;border-top:1px solid var(--line)">
              <div style="font-size:12.5px;font-weight:600">${esc(r.job.title)}</div>
              <div style="color:var(--muted);font-size:11.5px">${esc((companyOf(r.job.companyId)).name)} · ${r.report.score}% uyğun</div>
            </div>`).join('')}
        </div>
      </div>
    </div>
  </div>`;
}

/* ----------------------------- Tədbirlər ----------------------------- */
function viewEvents() {
  const regs = Store.state.eventRegistrations;
  return `
  <div class="page-head">
    <div>
      <div class="eyebrow">Karyera tədbirləri</div>
      <h1>Tədbirlər</h1>
      <p>Karyera yarmarkaları, infosessiyalar, emalatxanalar və mock interview seansları.</p>
    </div>
  </div>
  <div class="grid c2">
    ${EVENTS.map(e => {
      const full = e.registered >= e.seats;
      const on = regs.includes(e.id);
      const d = new Date(e.date);
      return `<div class="card">
        <div class="row" style="align-items:flex-start;gap:14px">
          <div style="text-align:center;flex:none;background:var(--brand-soft);border-radius:var(--r-sm);padding:8px 12px;min-width:62px">
            <div class="num" style="font-size:22px;font-weight:700;color:var(--brand);line-height:1">${d.getDate()}</div>
            <div class="eyebrow" style="color:var(--brand)">${AZ_MONTHS[d.getMonth()]}</div>
          </div>
          <div style="flex:1;min-width:0">
            <span class="chip mono line">${esc(e.type)}</span>
            <h3 style="font-size:14.5px;margin:7px 0 4px">${esc(e.title)}</h3>
            <div style="color:var(--muted);font-size:12px">${esc(e.time)} · ${esc(e.place)}</div>
          </div>
        </div>
        <div style="margin-top:14px">
          <div class="row tight" style="justify-content:space-between;font-size:11.5px;color:var(--muted);margin-bottom:5px">
            <span>${e.registered}/${e.seats} yer dolub</span><span class="num">${pct(e.registered, e.seats)}%</span>
          </div>
          <span class="bar"><i class="${full ? 'bad' : pct(e.registered, e.seats) > 80 ? 'warn' : 'good'}"
            style="width:${pct(e.registered, e.seats)}%"></i></span>
        </div>
        <div class="row" style="margin-top:14px">
          ${on ? '<span class="chip good">✓ Qeydiyyatdan keçmisiniz</span>'
            : full ? '<span class="chip bad">Yerlər dolub</span>'
            : `<button class="btn sm primary" data-act="event-reg" data-id="${e.id}">Qeydiyyatdan keç</button>`}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

/* ================================================================ *
 * ŞƏBƏKƏ — universitetdaxili feed
 * ================================================================ */
function timeAgo(iso) {
  const d = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (d < 60) return 'indicə';
  if (d < 3600) return `${Math.floor(d / 60)} dəq əvvəl`;
  if (d < 86400) return `${Math.floor(d / 3600)} saat əvvəl`;
  if (d < 604800) return `${Math.floor(d / 86400)} gün əvvəl`;
  return fmtDate(iso.slice(0, 10));
}

const ROLE_CHIP = { student: 'Tələbə', graduate: 'Məzun', company: 'Şirkət', admin: 'Karyera Mərkəzi' };
const POST_KIND_LABEL = {
  general: 'Paylaşım', project: 'Layihə', startup: 'Startup', job: 'Vakansiya',
  event: 'Tədbir', achievement: 'Nailiyyət', certificate: 'Sertifikat', question: 'Sual',
  collaboration: 'Əməkdaşlıq'
};

function viewNetwork() {
  const st = Store.state;
  const me = Auth.currentUser();
  const feed = UI.feed;
  const myFaculty = Store.tax?.facultyIdByName?.[st.student?.faculty] || '';
  const myMajor = Store.tax?.majorIdByName?.[st.student?.major] || '';
  const filteredFeed = (feed || []).filter(p => {
    if (UI.feedFilter === 'all') return true;
    if (UI.feedFilter === 'faculty') return p.authorFaculty === myFaculty;
    if (UI.feedFilter === 'major') return p.authorMajor === myMajor;
    return p.kind === UI.feedFilter;
  });

  if (Store.mode !== 'supabase') {
    return `<div class="page-head"><div><div class="eyebrow">Şəbəkə</div><h1>Peşəkar şəbəkə</h1></div></div>
      ${emptyState('Şəbəkə serverə qoşulmağı tələb edir',
        'Məlumat bazası müvəqqəti əlçatan deyil. Bir qədər sonra yenidən yoxlayın.')}`;
  }

  return `
  <div class="page-head">
    <div><div class="eyebrow">Network</div><h1>Peşəkar şəbəkə</h1>
      <p>ADNSU tələbələri, məzunları və tərəfdaş şirkətlərin paylaşımları.</p></div>
    <button class="btn" data-act="feed-reload">↻ Yenilə</button>
  </div>

  <div class="grid side">
    <div class="stack">
      <div class="network-filters" aria-label="Şəbəkə filtrləri">
        ${[['all','Hamısı'],['faculty','Fakültəm'],['major','İxtisasım'],['project','Layihələr'],['startup','Startup'],['job','Vakansiyalar'],['event','Tədbirlər'],['achievement','Nailiyyətlər']]
          .map(([v,l]) => `<button data-act="feed-filter" data-filter="${v}" aria-pressed="${UI.feedFilter === v}">${l}</button>`).join('')}
      </div>
      <div class="card pad-lg">
        <div class="row" style="gap:12px;align-items:flex-start">
          <span class="avatar" style="width:38px;height:38px;flex:none">${esc(initials(me.name))}</span>
          <div style="flex:1;min-width:0">
            <div class="field">
              <label class="sr-only" for="post-body">Paylaşım</label>
              <textarea id="post-body" data-act="post-body" style="min-height:74px"
                placeholder="Nə ilə bölüşmək istəyirsən? Təcrübə, layihə, sual, uğur…">${esc(UI.postDraft)}</textarea>
            </div>
            <div class="grid c2" style="margin-top:9px">
              <div class="field"><label for="post-kind">Paylaşım tipi</label><select id="post-kind" data-act="post-kind">
                ${Object.entries(POST_KIND_LABEL).map(([v,l]) => `<option value="${v}" ${UI.postKind === v ? 'selected' : ''}>${l}</option>`).join('')}
              </select></div>
              <div class="field"><label for="post-link">Link (istəyə bağlı)</label><input id="post-link" type="url" data-act="post-link" value="${esc(UI.postLink)}" placeholder="https://..."></div>
            </div>
            <div class="row" style="margin-top:10px">
              <span style="color:var(--muted);font-size:11.5px">${UI.postDraft.length}/4000</span>
              <div class="spacer"></div>
              <button class="btn primary sm" data-act="post-create"
                ${UI.postDraft.trim().length < 2 ? 'disabled' : ''}>Paylaş</button>
            </div>
          </div>
        </div>
      </div>

      ${feed === null ? '<div class="empty"><b>Yüklənir…</b></div>'
        : filteredFeed.length === 0 ? emptyState('Bu filtrdə paylaşım yoxdur', 'Başqa filtr seçin və ya ilk paylaşımı siz edin.')
        : filteredFeed.map(p => `<article class="post">
            <div class="post-head">
              <span class="avatar">${esc(initials(p.author))}</span>
              <div class="who">
                <b>${esc(p.author)}</b>
                <small>${esc(ROLE_CHIP[p.authorRole] || '')} · ${esc(timeAgo(p.at))}</small>
              </div>
              ${p.authorId === me.id || me.role === 'admin'
                ? `<button class="btn sm ghost" data-act="post-delete" data-id="${esc(p.id)}">Sil</button>` : ''}
            </div>
            <div class="post-kind">${esc(POST_KIND_LABEL[p.kind] || 'Paylaşım')}</div>
            <p class="post-body">${esc(p.body).replace(/\n/g, '<br>')}</p>
            ${p.linkUrl ? `<a class="post-link" href="${esc(p.linkUrl)}" target="_blank" rel="noopener noreferrer">${esc(p.linkUrl)} ↗</a>` : ''}
            ${p.tags?.length ? `<div class="skillrow">${p.tags.map(tag => `<span class="sk">#${esc(tag)}</span>`).join('')}</div>` : ''}
            <div class="post-foot">
              <button class="post-act ${p.likedByMe ? 'on' : ''}" data-act="post-like"
                data-id="${esc(p.id)}" data-on="${p.likedByMe ? '0' : '1'}">
                ${p.likedByMe ? '♥' : '♡'} ${p.likes}
              </button>
              <button class="post-act" data-act="post-comments" data-id="${esc(p.id)}">
                ▤ ${p.comments.length} şərh
              </button>
              <button class="post-act ${p.savedByMe ? 'on' : ''}" data-act="post-save" data-id="${esc(p.id)}" data-on="${p.savedByMe ? '0' : '1'}">${p.savedByMe ? '★ Saxlanılıb' : '☆ Saxla'}</button>
              ${p.authorId !== me.id ? `<button class="post-act" data-act="post-report" data-id="${esc(p.id)}">! Şikayət et</button>` : ''}
            </div>
            ${UI.openComments === p.id ? `<div class="post-comments">
              ${p.comments.map(c => `<div class="comment">
                <span class="avatar sm">${esc(initials(c.author))}</span>
                <div><b>${esc(c.author)}</b> <small>${esc(timeAgo(c.at))}</small>
                  <p>${esc(c.body)}</p></div>
              </div>`).join('')}
              <div class="row" style="margin-top:8px">
                <input type="text" id="comment-${esc(p.id)}" placeholder="Şərh yaz…"
                  data-act="comment-input" data-id="${esc(p.id)}">
                <button class="btn sm" data-act="comment-send" data-id="${esc(p.id)}">Göndər</button>
              </div>
            </div>` : ''}
          </article>`).join('')}
    </div>

    <div class="stack">
      <div class="card">
        <div class="eyebrow">Şəbəkə qaydaları</div>
        <div class="stack tight" style="margin-top:10px;font-size:12.5px;color:var(--ink-2)">
          <div>Paylaşımlar bütün universitet daxilində görünür.</div>
          <div>Öz paylaşımınızı istənilən vaxt silə bilərsiniz.</div>
          <div>Mesajlaşma şəxsidir — Karyera Mərkəzi də onu görmür.</div>
        </div>
      </div>
      <div class="note"><span class="m">ⓘ</span><span>Mesajlaşma və bağlantı sorğuları
        növbəti mərhələdədir — baza hazırdır, interfeys yazılır.</span></div>
    </div>
  </div>`;
}

/* ================================================================ *
 * TƏLƏBƏ GÜZƏŞTLƏRİ və QR
 * ================================================================ */
function viewBenefits() {
  const data = UI.benefits;

  if (Store.mode !== 'supabase') {
    return `<div class="page-head"><div><div class="eyebrow">Güzəştlər</div><h1>Tələbə güzəştləri</h1></div></div>
      ${emptyState('Güzəştlər serverə qoşulmağı tələb edir',
        'QR kodları yalnız real bazada yaradıla bilər. Saytı hostda açın.')}`;
  }
  if (data === null) {
    return `<div class="page-head"><div><h1>Tələbə güzəştləri</h1></div></div>
      <div class="empty"><b>Yüklənir…</b></div>`;
  }

  const cats = ['Hamısı', ...new Set(data.rows.map(r => r.category).filter(Boolean))];
  const list = UI.benefitCat === 'Hamısı' ? data.rows : data.rows.filter(r => r.category === UI.benefitCat);
  const myClaims = data.claims || [];

  return `
  <div class="page-head">
    <div><div class="eyebrow">Student benefits</div><h1>Tələbə güzəştləri</h1>
      <p>ADNSU tələbə statusunuzla teatr, kino, muzey və digər məkanlarda endirim.</p></div>
  </div>

  <div class="note warn" style="margin-bottom:16px"><span class="m">!</span>
    <span><b>Nümunə məlumat.</b> Məkan adları realdır, güzəşt şərtləri isə nümunədir —
    real istifadədən əvvəl hər partnyorla müqavilə bağlanmalıdır.</span></div>

  <div class="pills" style="margin-bottom:16px">
    ${cats.map(c => `<button data-act="benefit-cat" data-cat="${esc(c)}"
      aria-pressed="${UI.benefitCat === c}">${esc(c)}</button>`).join('')}
  </div>

  <div class="grid c3">
    ${list.map(b => {
      const claim = myClaims.find(c => c.benefit_id === b.id && !c.redeemed_at
        && new Date(c.expires_at) > new Date());
      const used = myClaims.find(c => c.benefit_id === b.id && c.redeemed_at);
      return `<div class="card benefit">
        <div class="row" style="gap:11px;align-items:flex-start">
          <span class="benefit-mark">${esc(b.emoji)}</span>
          <div style="flex:1;min-width:0">
            <span class="chip mono line">${esc(b.category)}</span>
            <h3 style="font-size:14px;margin:7px 0 3px">${esc(b.title)}</h3>
            <div style="color:var(--muted);font-size:12px">${esc(b.partner)}</div>
          </div>
        </div>
        <div class="benefit-off">${esc(b.discount)}</div>
        <p style="color:var(--ink-2);font-size:12.5px;margin:0 0 10px">${esc(b.description)}</p>
        ${b.terms ? `<div style="color:var(--muted);font-size:11px;margin-bottom:12px">${esc(b.terms)}</div>` : ''}
        ${claim
          ? `<button class="btn sm block primary" data-act="benefit-qr" data-code="${esc(claim.code)}"
               data-title="${esc(b.title)}" data-partner="${esc(b.partner)}">QR kodu göstər</button>`
          : used
            ? '<span class="chip good" style="width:100%;justify-content:center">✓ İstifadə olunub</span>'
            : `<button class="btn sm block" data-act="benefit-claim" data-id="${esc(b.id)}">Güzəşt al</button>`}
      </div>`;
    }).join('') || emptyState('Bu kateqoriyada güzəşt yoxdur', 'Başqa kateqoriyanı seçin.')}
  </div>`;
}

/* Karyera Mərkəzi / partnyor — QR təsdiqi */
function viewRedeem() {
  const r = UI.redeemResult;
  const tone = !r ? '' : r.status === 'tesdiqlendi' ? 'good'
    : r.status === 'istifade_olunub' ? 'warn' : 'bad';
  const label = {
    tesdiqlendi: '✓ Təsdiqləndi — güzəşt tətbiq edilə bilər',
    istifade_olunub: '! Bu kod artıq istifadə olunub',
    muddeti_bitib: '× Kodun müddəti bitib',
    tapilmadi: '× Belə kod yoxdur'
  };
  return `
  <div class="page-head">
    <div><div class="eyebrow">QR təsdiqi</div><h1>Güzəşt kodunu yoxla</h1>
      <p>Tələbənin göstərdiyi kodu daxil edin. Təsdiq bir dəfəlikdir — kod sonra istifadə olunmuş sayılır.</p></div>
  </div>

  <div class="grid side">
    <div class="card pad-lg">
      <div class="field">
        <label for="redeem-code">Kod</label>
        <input id="redeem-code" type="text" placeholder="ASOIU-XXXXXXXXXX"
          class="mono" style="font-size:18px;letter-spacing:.08em" autocomplete="off">
      </div>
      <button class="btn primary block" style="margin-top:14px" data-act="redeem-go">Yoxla və təsdiqlə</button>

      ${r ? `<div class="note ${tone}" style="margin-top:18px">
        <span class="m">${tone === 'good' ? '✓' : tone === 'warn' ? '!' : '×'}</span>
        <span><b>${esc(label[r.status] || r.status)}</b>
        ${r.student_name ? `<br>Tələbə: <b>${esc(r.student_name)}</b> · ${esc(r.faculty || '—')}` : ''}
        ${r.benefit ? `<br>Güzəşt: ${esc(r.benefit)} — ${esc(r.partner || '')}` : ''}
        ${r.redeemed_at ? `<br>Vaxt: ${esc(String(r.redeemed_at).slice(0, 16).replace('T', ' '))}` : ''}
        </span></div>` : ''}
    </div>

    <div class="card">
      <div class="eyebrow">Necə işləyir</div>
      <div class="stack tight" style="margin-top:10px;font-size:12.5px;color:var(--ink-2)">
        <div class="row tight"><span class="status-dot good"></span>Tələbə platformada güzəşt alır</div>
        <div class="row tight"><span class="status-dot good"></span>Ona unikal QR kod verilir</div>
        <div class="row tight"><span class="status-dot good"></span>Məkanda kod bir dəfə təsdiqlənir</div>
      </div>
      <p style="color:var(--muted);font-size:11.5px;margin:12px 0 0">
        Tələbə öz kodunu təsdiqləyə bilmir — bu, bazada bloklanıb.
      </p>
    </div>
  </div>`;
}

/* ================================================================ *
 * ŞİRKƏT KABİNETİ
 * ================================================================ */
function ownJobs() {
  return Store.companyJobs();
}

/** Aktiv şirkət hesabının göndərdiyi dəvətlər. */
function ownInvites() {
  const co = Store.state.company;
  if (!co) return [];
  return Store.state.invites.filter(i => i.companyId === co.id);
}

function viewCompanyDashboard() {
  const jobs = ownJobs();
  const co = Store.state.company;
  const pool = STUDENT_POOL;
  const best = jobs.map(j => ({ job: j, top: rankCandidates(pool, j)[0] })).filter(x => x.top);
  const avg = best.length ? Math.round(best.reduce((s, x) => s + x.top.report.score, 0) / best.length) : 0;
  const myApps = Store.state.applications.filter(a => {
    const j = Store.jobById(a.jobId); return j && j.companyId === co.id;
  });

  return `
  <div class="page-head">
    <div>
      <div class="eyebrow">Şirkət kabineti</div>
      <h1>${esc(co.name)}</h1>
      <p>${esc(co.sector)} · ${jobs.length} elan · ADNSU tələbə bazasına çıxış</p>
    </div>
    <button class="btn primary" data-act="go" data-view="post">＋ Vakansiya yarat</button>
  </div>

  <div class="tiles">
    <div class="tile"><span class="k">Aktiv elanlar</span><span class="v">${jobs.filter(j => j.status === 'approved').length}</span>
      <span class="s">${jobs.filter(j => j.status === 'pending').length} təsdiq gözləyir</span></div>
    <div class="tile accent"><span class="k">Ən yüksək namizəd uyğunluğu</span>
      <span class="v">${best.length ? Math.max(...best.map(b => b.top.report.score)) + '%' : '—'}</span>
      <span class="s">${pool.length} tələbə bazasından</span></div>
    <div class="tile"><span class="k">Orta uyğunluq</span><span class="v">${avg}%</span>
      <span class="s">elan üzrə ən yaxşı namizəd</span></div>
    <div class="tile"><span class="k">Müraciətlər</span><span class="v">${myApps.length}</span>
      <span class="s">${Store.state.invites.length} dəvət göndərilib</span></div>
  </div>

  <div class="section">
    <div class="section-head"><h2>Elanlarınız üzrə ən uyğun namizədlər</h2>
      <span class="hint">Fakültə · ixtisas · bacarıq üzrə avtomatik</span></div>
    <div class="stack">
      ${best.slice(0, 3).map(({ job, top }) => `<div class="card">
        <div class="row" style="justify-content:space-between;align-items:flex-start">
          <div style="min-width:0">
            <span class="badge-type ${typeClass(job.type)}">${esc(job.type)}</span>
            <h3 style="font-size:14.5px;margin:7px 0 2px">${esc(job.title)}</h3>
            <div style="color:var(--muted);font-size:12px">Son tarix ${fmtDate(job.deadline)}</div>
          </div>
          <button class="btn sm" data-act="cand-job" data-id="${job.id}">Bütün namizədlər →</button>
        </div>
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--line)">
          <div class="row" style="justify-content:space-between;align-items:center;gap:14px">
            <div style="min-width:0">
              <b style="font-size:13px">${esc(top.student.name)}</b>
              <div style="color:var(--muted);font-size:11.5px">${esc(top.student.major)} · ${top.student.course}. kurs · GPA ${top.student.gpa}</div>
            </div>
            <div style="width:170px;flex:none">${meterHTML(top.report)}</div>
          </div>
        </div>
      </div>`).join('') || emptyState('Hələ elanınız yoxdur', 'İlk vakansiyanı yaradın.',
        '<button class="btn sm primary" data-act="go" data-view="post">Vakansiya yarat</button>')}
    </div>
  </div>`;
}

function viewVacancies() {
  const jobs = ownJobs();
  return `
  <div class="page-head">
    <div><div class="eyebrow">Şirkət kabineti</div><h1>Vakansiyalarım</h1>
      <p>Karyera Mərkəzi təsdiqindən sonra elan tələbələrə görünür.</p></div>
    <button class="btn primary" data-act="go" data-view="post">＋ Yeni elan</button>
  </div>
  ${jobs.length ? `<div class="table-wrap"><table>
    <thead><tr><th>Vəzifə</th><th>Tip</th><th>Hədəf fakültə</th><th class="num">Namizəd 65%+</th><th>Son tarix</th><th>Status</th><th></th></tr></thead>
    <tbody>${jobs.map(j => {
      const strong = rankCandidates(STUDENT_POOL, j, { min: 65 }).length;
      return `<tr>
        <td><div class="who"><b>${esc(j.title)}</b><small>${esc(j.location)} · ${esc(j.mode)}</small></div></td>
        <td><span class="badge-type ${typeClass(j.type)}">${esc(j.type)}</span></td>
        <td style="max-width:240px;font-size:12px;color:var(--muted)">${esc(j.faculties.length > 2 ? j.faculties.length + ' fakültə' : j.faculties.join(', '))}</td>
        <td class="num">${strong}</td>
        <td class="num">${fmtDate(j.deadline)}</td>
        <td>${j.status === 'pending' ? '<span class="chip warn">Təsdiq gözləyir</span>' : '<span class="chip good">Dərc olunub</span>'}</td>
        <td><button class="btn sm" data-act="cand-job" data-id="${j.id}">Namizədlər</button></td>
      </tr>`;
    }).join('')}</tbody></table></div>`
    : emptyState('Elan yoxdur', 'İlk vakansiyanı yaradın.')}`;
}

function viewPost() {
  const co = Store.state.company;
  return `
  <div class="page-head">
    <div><div class="eyebrow">Şirkət kabineti</div><h1>Vakansiya yarat</h1>
      <p>Hədəf fakültə və ixtisasları seçin — sistem elanı yalnız uyğun tələbələrə yüksək faizlə göstərəcək.</p></div>
  </div>
  <div class="grid side">
    <div class="card pad-lg">
      <div class="stack">
        <div class="grid c2">
          <div class="field"><label for="v-title">Vəzifə adı</label>
            <input id="v-title" type="text" placeholder="Mechanical Engineering Intern"></div>
          <div class="field"><label for="v-type">Tip</label>
            <select id="v-type"><option>Təcrübə</option><option>İş</option><option>Graduate</option><option>Könüllülük</option></select></div>
          <div class="field"><label for="v-location">Yer</label><input id="v-location" type="text" value="Bakı"></div>
          <div class="field"><label for="v-mode">Format</label>
            <select id="v-mode"><option>Əyani</option><option>Hibrid</option><option>Uzaqdan</option></select></div>
          <div class="field"><label for="v-duration">Müddət</label><input id="v-duration" type="text" placeholder="3 ay"></div>
          <div class="field"><label for="v-department">Departament</label><input id="v-department" type="text" placeholder="Mühəndislik"></div>
          <div class="field"><label for="v-deadline">Son müraciət tarixi</label>
            <input id="v-deadline" type="date" value="2026-11-30"></div>
          <div class="field"><label for="v-course">Minimum kurs</label>
            <select id="v-course">${[1, 2, 3, 4].map(c => `<option value="${c}" ${c === 3 ? 'selected' : ''}>${c}. kurs</option>`).join('')}</select></div>
          <div class="field"><label for="v-experience">Təcrübə səviyyəsi</label><select id="v-experience"><option>Təcrübə tələb olunmur</option><option>Başlanğıc</option><option>1–3 il</option><option>3–5 il</option><option>5+ il</option></select></div>
          <div class="field"><label for="v-positions">Yer sayı</label><input id="v-positions" type="number" min="1" value="1"></div>
        </div>

        <div class="grid c3"><div class="field"><label for="v-salary-min">Minimum əmək haqqı</label><input id="v-salary-min" type="number" min="0" placeholder="600"></div><div class="field"><label for="v-salary-max">Maksimum əmək haqqı</label><input id="v-salary-max" type="number" min="0" placeholder="1000"></div><div class="field"><label for="v-currency">Valyuta</label><select id="v-currency"><option>AZN</option><option>USD</option><option>EUR</option></select></div></div>
        <label class="check"><input id="v-salary-visible" type="checkbox"><span>Əmək haqqını tələbələrə göstər</span></label>

        <div class="field"><label for="v-faculty">Hədəf fakültə</label>
          <select id="v-faculty">${Object.keys(FACULTIES).map(f => `<option>${esc(f)}</option>`).join('')}</select>
          <span class="help">Uyğunluq balının 40 balı buradan gəlir.</span></div>

        <div class="field"><label for="v-majors">Hədəf ixtisaslar</label>
          <select id="v-majors" multiple size="5">${ALL_MAJORS.map(m => `<option>${esc(m)}</option>`).join('')}</select>
          <span class="help">Ctrl / Cmd ilə bir neçəsini seçin. 40 bal.</span></div>

        <div class="field"><label for="v-skills">Tələb olunan bacarıqlar</label>
          <input id="v-skills" type="text" placeholder="SolidWorks, AutoCAD, Mechanical Design">
          <span class="help">Vergüllə ayırın. 20 bal — örtülmə nisbətinə görə hesablanır.</span></div>

        <div class="field"><label for="v-preferred-skills">Üstünlük verilən bacarıqlar</label><input id="v-preferred-skills" type="text" placeholder="Power BI, İngilis dili"><span class="help">Vergüllə ayırın.</span></div>

        <div class="field"><label for="v-summary">Vakansiya təsviri</label><textarea id="v-summary" required></textarea></div>
        <div class="grid c2"><div class="field"><label for="v-duties">Öhdəliklər</label><textarea id="v-duties" placeholder="Hər öhdəliyi yeni sətirdə yazın"></textarea></div><div class="field"><label for="v-requirements">Tələblər</label><textarea id="v-requirements" placeholder="Hər tələbi yeni sətirdə yazın"></textarea></div></div>
        <div class="field"><label for="v-application-method">Müraciət üsulu</label><select id="v-application-method"><option value="platform">Platforma üzərindən</option><option value="external">Xarici keçid</option><option value="email">E-poçt</option></select></div>
        <div class="field"><label for="v-application-url">Müraciət keçidi / e-poçt (istəyə bağlı)</label><input id="v-application-url" type="text" placeholder="https://... və ya careers@sirket.az"></div>

        <button class="btn primary" data-act="v-create">Elanı təsdiqə göndər →</button>
      </div>
    </div>

    <div class="stack">
      <div class="card">
        <div class="eyebrow">Elanınız kimə göstəriləcək</div>
        <p style="color:var(--muted);font-size:12.5px;margin:8px 0 0">
          Sistem hər tələbə üçün elanı ayrıca qiymətləndirir: hədəf fakültə uyğunluğu 40,
          ixtisas 40, tələb olunan bacarıqların örtülməsi 20 bal. Tələbə elanı öz
          «Sənə uyğun imkanlar» siyahısında bu faizlə görür.
        </p>
        <div style="margin-top:14px">${meterKey({ faculty: 40, major: 40, skills: 20 })}</div>
      </div>
      <div class="note"><span class="m">ⓘ</span><span>Yeni elan «təsdiq gözləyir» statusu ilə yaradılır və Karyera Mərkəzi kabinetində təsdiqlənməlidir.</span></div>
    </div>
  </div>`;
}

function viewCandidates() {
  if (!companyCanUse('candidate_search')) return `<div class="page-head"><div><div class="eyebrow">Namizəd bazası</div><h1>Namizəd uyğunluğu</h1><p>Bu bölmə Pro və Business paketlərində açılır.</p></div></div>${emptyState('Paket yeniləməsi tələb olunur', 'Namizəd bazası, AI uyğunluğu və CV sıralaması Free paketə daxil deyil.', '<button class="btn primary" data-act="go" data-view="subscription">Paketlərə bax →</button>')}`;
  const jobs = ownJobs().filter(j => j.status === 'approved');
  if (!jobs.length) return `<div class="page-head"><div><h1>Namizəd uyğunluğu</h1></div></div>
    ${emptyState('Təsdiqlənmiş elan yoxdur', 'Namizədləri görmək üçün əvvəlcə elan yaradın və təsdiq gözləyin.')}`;

  const jobId = UI.candJob && jobs.some(j => String(j.id) === String(UI.candJob)) ? UI.candJob : jobs[0].id;
  const job = Store.jobById(jobId);
  const ranked = rankCandidates(STUDENT_POOL, job, { min: UI.candMin });
  const applied = Store.state.applications.filter(a => String(a.jobId) === String(jobId));

  return `
  <div class="page-head">
    <div><div class="eyebrow">Candidate matching</div><h1>Namizəd uyğunluğu</h1>
      <p>Tələbə bazası seçilmiş elana görə avtomatik sıralanır.</p></div>
  </div>

  <div class="card" style="padding:14px;margin-bottom:16px">
    <div class="row">
      <div class="field" style="flex:1;min-width:220px">
        <label for="cand-job" class="sr-only">Elan</label>
        <select id="cand-job" data-act="cand-select">
          ${jobs.map(j => `<option value="${j.id}" ${String(j.id) === String(jobId) ? 'selected' : ''}>${esc(j.title)}</option>`).join('')}
        </select>
      </div>
      <div class="field" style="width:170px">
        <label for="cand-min" class="sr-only">Minimum uyğunluq</label>
        <select id="cand-min" data-act="cand-min">
          ${[0, 45, 65, 85].map(v => `<option value="${v}" ${UI.candMin === v ? 'selected' : ''}>
            ${v === 0 ? 'Bütün namizədlər' : v + '%+ uyğunluq'}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="row tight" style="margin-top:10px">
      <span class="eyebrow">Tələb olunan:</span>
      ${job.skills.map(s => `<span class="chip mono line">${esc(s)}</span>`).join('')}
    </div>
  </div>

  ${applied.length ? `<div class="note good" style="margin-bottom:14px"><span class="m">✓</span>
    <span><b>${applied.length}</b> tələbə bu elana platforma üzərindən müraciət edib.</span></div>` : ''}

  <div class="table-wrap">
    <table>
      <thead><tr><th>Namizəd</th><th>İxtisas</th><th class="num">Kurs</th><th class="num">GPA</th>
        <th style="width:180px">Uyğunluq</th><th>Üst-üstə düşən bacarıqlar</th><th></th></tr></thead>
      <tbody>
        ${ranked.map(({ student, report }) => {
          const invited = ownInvites().some(i => i.studentId === student.id && String(i.jobId) === String(jobId));
          return `<tr>
            <td><div class="who"><b>${esc(student.name)}</b><small>${esc(student.faculty)}</small></div></td>
            <td style="font-size:12.5px">${esc(student.major)}</td>
            <td class="num">${student.course}</td>
            <td class="num">${student.gpa}</td>
            <td>${meterHTML(report)}</td>
            <td><div class="skillrow">${report.matched.map(s => `<span class="sk hit">${esc(s)}</span>`).join('') || '<span style="color:var(--muted);font-size:11.5px">—</span>'}</div></td>
            <td>${invited ? '<span class="chip good">Dəvət edilib</span>'
              : `<button class="btn sm primary" data-act="invite" data-sid="${student.id}" data-id="${jobId}">Dəvət et</button>`}</td>
          </tr>`;
        }).join('') || '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:26px">Bu filtrə uyğun namizəd yoxdur.</td></tr>'}
      </tbody>
    </table>
  </div>`;
}

function viewCompanyApplications() {
  const rows = Store.state.applications || [];
  const labels = { applied: 'Müraciət edib', under_review: 'Baxılır', shortlisted: 'Qısa siyahı', interview: 'Müsahibə', offer: 'Təklif', rejected: 'İmtina', hired: 'İşə qəbul', gonderildi: 'Müraciət edib', baxilir: 'Baxılır', musahibe: 'Müsahibə', teklif: 'Təklif', imtina: 'İmtina', geri_goturuldu: 'Geri götürülüb' };
  return `<div class="page-head"><div><div class="eyebrow">Şirkət kabineti</div><h1>Müraciətlər</h1><p>Namizədləri mərhələlər üzrə idarə edin. Dəyişiklik tələbəyə bildiriş kimi gedir.</p></div></div>
    ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Namizəd</th><th>Vakansiya</th><th>İxtisas</th><th>Mərhələ</th><th>Tarix</th></tr></thead><tbody>${rows.map(application => {
      const student = STUDENT_POOL.find(item => String(item.id) === String(application.studentId));
      const job = Store.jobById(application.jobId);
      return `<tr><td><div class="who"><b>${esc(student?.name || 'Namizəd')}</b><small>${esc(student?.faculty || '')}</small></div></td><td>${esc(job?.title || application.jobTitle || 'Vakansiya')}</td><td>${esc(student?.major || '—')}</td><td><select data-act="company-app-status" data-id="${esc(application.id)}">${Object.entries(labels).filter(([key]) => !['gonderildi','baxilir','musahibe','teklif','imtina'].includes(key)).map(([key,label]) => `<option value="${key}" ${application.statusKey === key ? 'selected' : ''}>${label}</option>`).join('')}</select></td><td class="num">${fmtDate(application.at)}</td></tr>`;
    }).join('')}</tbody></table></div>` : emptyState('Hələ müraciət yoxdur', 'Tələbələr vakansiyalarınıza müraciət etdikdə burada görünəcək.')}`;
}

function viewSearch() {
  if (!companyCanUse('candidate_search')) return `<div class="page-head"><div><div class="eyebrow">Candidate search</div><h1>Namizəd axtarışı</h1><p>Bu bölmə Pro və Business paketlərində açılır.</p></div></div>${emptyState('Namizəd bazası bağlıdır', 'Free paket namizəd bazasına çıxış vermir.', '<button class="btn primary" data-act="go" data-view="subscription">Paketi yüksəlt →</button>')}`;
  const f = UI.search;
  let list = STUDENT_POOL.slice();
  if (f.faculty !== 'Hamısı') list = list.filter(s => s.faculty === f.faculty);
  if (f.minGPA) list = list.filter(s => s.gpa >= f.minGPA);
  if (f.course !== 0) list = list.filter(s => s.course === f.course);
  if (f.q) {
    const q = f.q.toLowerCase();
    list = list.filter(s => `${s.name} ${s.major} ${s.skills.join(' ')}`.toLowerCase().includes(q));
  }

  return `
  <div class="page-head">
    <div><div class="eyebrow">Candidate search</div><h1>Namizəd axtarışı</h1>
      <p>ADNSU tələbə bazasında bacarıq, fakültə, kurs və GPA üzrə axtarış.</p></div>
  </div>

  <div class="card" style="padding:14px;margin-bottom:16px">
    <div class="row">
      <div class="searchbar"><span class="ico">⌕</span>
        <input type="search" id="s-q" placeholder="Ad, ixtisas və ya bacarıq…" value="${esc(f.q)}" data-act="s-q"></div>
      <div class="field" style="min-width:230px;flex:1">
        <label for="s-fac" class="sr-only">Fakültə</label>
        <select id="s-fac" data-act="s-fac">
          <option>Hamısı</option>
          ${Object.keys(FACULTIES).map(x => `<option ${x === f.faculty ? 'selected' : ''}>${esc(x)}</option>`).join('')}
        </select>
      </div>
      <div class="field" style="width:130px"><label for="s-course" class="sr-only">Kurs</label>
        <select id="s-course" data-act="s-course">
          <option value="0">Bütün kurslar</option>
          ${[1, 2, 3, 4].map(c => `<option value="${c}" ${f.course === c ? 'selected' : ''}>${c}. kurs</option>`).join('')}
        </select></div>
      <div class="field" style="width:130px"><label for="s-gpa" class="sr-only">Minimum GPA</label>
        <select id="s-gpa" data-act="s-gpa">
          ${[0, 71, 81, 86].map(v => `<option value="${v}" ${f.minGPA === v ? 'selected' : ''}>${v === 0 ? 'Bütün GPA' : 'GPA ' + v + '+'}</option>`).join('')}
        </select></div>
    </div>
  </div>

  <div class="eyebrow" style="margin-bottom:10px">${list.length} tələbə</div>
  <div class="grid c3">
    ${list.map(s => `<div class="card">
      <div class="row" style="gap:11px;align-items:flex-start">
        <div class="brandbox">${esc(initials(s.name))}</div>
        <div style="flex:1;min-width:0">
          <b style="font-size:13.5px">${esc(s.name)}</b>
          <div style="color:var(--muted);font-size:11.5px;margin-top:2px">${esc(s.major)}</div>
          <div style="color:var(--muted);font-size:11.5px">${s.course}. kurs · GPA ${s.gpa}</div>
        </div>
      </div>
      <div class="skillrow" style="margin-top:12px">
        ${s.skills.slice(0, 4).map(x => `<span class="sk">${esc(x)}</span>`).join('')}
      </div>
      <div style="color:var(--muted);font-size:11.5px;margin-top:10px">${esc(s.languages)}</div>
    </div>`).join('') || emptyState('Nəticə yoxdur', 'Axtarış şərtlərini yumşaldın.')}
  </div>`;
}

function viewInvites() {
  const inv = ownInvites();
  return `
  <div class="page-head">
    <div><div class="eyebrow">Şirkət kabineti</div><h1>Müsahibə dəvətləri</h1>
      <p>Göndərdiyiniz dəvətlər və onların statusu.</p></div>
  </div>
  ${inv.length ? `<div class="table-wrap"><table>
    <thead><tr><th>Namizəd</th><th>Vəzifə</th><th class="num">Uyğunluq</th><th>Göndərilib</th><th>Status</th><th></th></tr></thead>
    <tbody>${inv.map(i => {
      const st = STUDENT_POOL.find(s => s.id === i.studentId);
      const job = Store.jobById(i.jobId);
      if (!st || !job) return '';
      const r = matchReport(job, st);
      return `<tr>
        <td><div class="who"><b>${esc(st.name)}</b><small>${esc(st.major)} · ${st.course}. kurs</small></div></td>
        <td style="font-size:12.5px">${esc(job.title)}</td>
        <td class="num">${r.score}%</td>
        <td class="num">${fmtDate(i.at)}</td>
        <td><span class="chip warn">${esc(i.status)}</span></td>
        <td><button class="btn sm danger" data-act="invite-cancel"
             data-sid="${esc(i.studentId)}" data-id="${esc(i.jobId)}">Ləğv et</button></td>
      </tr>`;
    }).join('')}</tbody></table></div>`
    : emptyState('Dəvət göndərilməyib', 'Namizəd uyğunluğu səhifəsindən dəvət göndərin.',
        '<button class="btn sm primary" data-act="go" data-view="candidates">Namizədlərə keç</button>')}`;
}

function viewCompanyProfile() {
  const co = Store.state.company;
  return `
  <div class="page-head">
    <div><div class="eyebrow">Company profile</div><h1>Şirkət profili</h1>
      <p>Bu məlumat elanlarınızda və tələbə axtarışlarında görünür.</p></div>
  </div>
  <div class="grid side">
    <div class="card pad-lg">
      <div class="grid c2">
        <div class="field"><label for="c-name">Şirkət adı</label><input id="c-name" type="text" value="${esc(co.name)}" data-cbind="name"></div>
        <div class="field"><label for="c-sector">Sektor</label><input id="c-sector" type="text" value="${esc(co.sector)}" data-cbind="sector"></div>
        <div class="field"><label for="c-contact">Əlaqəli şəxs</label><input id="c-contact" type="text" value="${esc(co.contact)}" data-cbind="contact"></div>
        <div class="field"><label for="c-email">E-poçt</label><input id="c-email" type="email" value="${esc(co.email)}" data-cbind="email"></div>
        <div class="field"><label for="c-web">Veb sayt</label><input id="c-web" type="text" value="${esc(co.website)}" data-cbind="website"></div>
      </div>
      <div class="field" style="margin-top:12px"><label for="c-about">Haqqında</label>
        <textarea id="c-about" data-cbind="about">${esc(co.about)}</textarea></div>
    </div>
    <div class="stack">
      ${accountCard()}
      ${passwordCard()}
    </div>
  </div>`;
}

function viewSubscription() {
  const current = Store.state.subscription?.plans?.slug || Store.state.subscription?.plan_id || 'free';
  return `<div class="page-head"><div><div class="eyebrow">Employer plans</div><h1>Paket və limitlər</h1>
    <p>Şirkətinizin işə qəbul ehtiyacına uyğun planı seçin. Ödəniş provayderi qoşulanadək Pro və Business seçimləri admin təsdiqinə göndərilir.</p></div></div>
    <div class="plan-grid">${COMPANY_PLANS.map(plan => `<article class="card pad-lg plan-card ${plan.featured ? 'featured' : ''}">
      ${plan.featured ? '<span class="chip good">Ən çox seçilən</span>' : '<span class="chip line">Paket</span>'}
      <h2 style="font-size:19px;margin:14px 0 4px">${plan.name}</h2><p style="color:var(--muted);margin:0">${plan.description}</p>
      <div class="plan-price">${plan.price} AZN<small> / ay</small></div>
      <ul class="plan-list">${plan.features.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
      ${current === plan.id
        ? '<button class="btn block" disabled>Hazırkı paket</button>'
        : `<button class="btn ${plan.featured ? 'primary' : ''} block" data-act="plan-select" data-plan="${plan.id}">${plan.id === 'free' ? 'Free plana keç' : 'Sorğu göndər'}</button>`}
    </article>`).join('')}</div>
    <div class="note" style="margin-top:16px"><span class="m">ⓘ</span><span>Aktiv limitlər server tərəfində yoxlanılır və Karyera Mərkəzi tərəfindən idarə olunur.</span></div>`;
}

/* ---------------------- Hesab və şifrə (hər iki rol) ---------------------- */
function accountCard() {
  const u = Auth.currentUser();
  if (!u) return '';
  return `<div class="card">
    <div class="eyebrow">Hesab</div>
    <dl class="kv" style="margin-top:10px">
      <dt>E-poçt</dt><dd>${esc(u.email)}</dd>
      <dt>Rol</dt><dd>${esc(ROLE_NAMES[u.role])}</dd>
      <dt>Status</dt><dd><span class="chip ${u.status === 'pending' ? 'warn' : 'good'}">
        ${u.status === 'pending' ? 'Təsdiq gözləyir' : 'Aktiv'}</span></dd>
      <dt>Qeydiyyat</dt><dd>${fmtDate(u.createdAt)}</dd>
    </dl>
    <button class="btn sm block" style="margin-top:14px" data-act="logout">⏻ Çıxış</button>
  </div>`;
}

function passwordCard() {
  return `<div class="card">
    <div class="eyebrow">Şifrəni dəyiş</div>
    ${UI.pwMsg ? `<div class="note ${UI.pwMsg.tone}" style="margin-top:10px">
      <span class="m">${UI.pwMsg.tone === 'good' ? '✓' : '×'}</span><span>${esc(UI.pwMsg.text)}</span></div>` : ''}
    <div class="stack tight" style="margin-top:10px">
      <div class="field"><label for="pw-cur">Cari şifrə</label>
        <input id="pw-cur" type="password" autocomplete="current-password"></div>
      <div class="field"><label for="pw-new">Yeni şifrə</label>
        <input id="pw-new" type="password" autocomplete="new-password">
        <span class="help">Hərf və rəqəm daxil olmaqla ən azı 8 simvol.</span></div>
      <div class="field"><label for="pw-new2">Yeni şifrənin təkrarı</label>
        <input id="pw-new2" type="password" autocomplete="new-password"></div>
      <button class="btn primary" data-act="change-password">Şifrəni yenilə</button>
    </div>
  </div>`;
}

/* ================================================================ *
 * KARYERA MƏRKƏZİ (ADMIN)
 * ================================================================ */
function facultyStats() {
  const jobs = Store.allJobs().filter(j => j.status === 'approved');
  return Object.keys(FACULTIES).map(f => ({
    faculty: f,
    jobs: jobs.filter(j => j.faculties.includes(f)).length,
    students: STUDENT_POOL.filter(s => s.faculty === f).length
  })).sort((a, b) => b.jobs - a.jobs);
}

function skillDemand(limit = 8) {
  const m = new Map();
  Store.allJobs().filter(j => j.status === 'approved')
    .forEach(j => j.skills.forEach(s => m.set(s, (m.get(s) || 0) + 1)));
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function viewAdminDashboard() {
  const jobs = Store.allJobs();
  const pending = jobs.filter(j => j.status === 'pending');
  const fs = facultyStats();
  const maxJobs = Math.max(...fs.map(x => x.jobs), 1);
  const types = ['İş', 'Təcrübə', 'Graduate', 'Könüllülük'].map(t => [t, jobs.filter(j => j.type === t && j.status === 'approved').length]);
  const demand = skillDemand(6);
  const demandMax = demand.length ? demand[0][1] : 1;

  return `
  <div class="page-head">
    <div><div class="eyebrow">Karyera Mərkəzi</div><h1>İdarəetmə paneli</h1>
      <p>Platformanın ümumi vəziyyəti, təsdiq gözləyən elanlar və fakültə üzrə əhatə.</p></div>
    ${pending.length ? `<button class="btn primary" data-act="go" data-view="approvals">
      ${pending.length} elan təsdiq gözləyir →</button>` : ''}
  </div>

  <div class="tiles">
    <div class="tile"><span class="k">Qeydiyyatlı tələbə</span><span class="v">${STUDENT_POOL.length}</span><span class="s">namizəd bazası</span></div>
    <div class="tile"><span class="k">Tərəfdaş şirkət</span><span class="v">${allCompanies().length}</span><span class="s">${[...new Set(allCompanies().map(c => c.sector))].length} sektor</span></div>
    <div class="tile"><span class="k">Aktiv elan</span><span class="v">${jobs.filter(j => j.status === 'approved').length}</span>
      <span class="s">${jobs.filter(j => j.status === 'approved' && daysLeft(j.deadline) <= 14 && daysLeft(j.deadline) >= 0).length} elanın son tarixi yaxındır</span></div>
    <div class="tile ${pending.length ? 'accent' : ''}"><span class="k">Təsdiq gözləyir</span><span class="v">${pending.length}</span>
      <span class="s">${pending.length ? 'baxış tələb olunur' : 'növbə boşdur'}</span></div>
  </div>

  <div class="grid c2 section">
    <div class="card pad-lg">
      <div class="section-head"><h2>Fakültə üzrə elan əhatəsi</h2></div>
      <div class="stack tight">
        ${fs.map(x => barRow(x.faculty.replace(' fakültəsi', ''), x.jobs, maxJobs)).join('')}
      </div>
      <p style="color:var(--muted);font-size:11.5px;margin:12px 0 0">
        Hər fakültəni hədəfləyən aktiv elanların sayı. Aşağı göstərici həmin fakültə üçün
        yeni tərəfdaşlıq tələb olunduğunu bildirir.
      </p>
    </div>

    <div class="card pad-lg">
      <div class="section-head"><h2>Elan tipləri</h2></div>
      <div class="stack tight">
        ${types.map(([t, n]) => barRow(t, n, Math.max(...types.map(x => x[1]), 1))).join('')}
      </div>
      <div class="section-head" style="margin-top:22px"><h2 style="font-size:14px">Ən çox tələb olunan bacarıqlar</h2></div>
      <div class="stack tight">
        ${demand.map(([s, n]) => barRow(s, n, demandMax, 'warn')).join('')}
      </div>
    </div>
  </div>`;
}

function viewApprovals() {
  const pending = Store.allJobs().filter(j => j.status === 'pending');
  const pendingAccounts = Auth.pendingCompanyRows();
  return `
  <div class="page-head">
    <div><div class="eyebrow">Job approval</div><h1>Təsdiq növbəsi</h1>
      <p>Şirkət hesabları və elanlar tələbələrə görünməzdən əvvəl burada yoxlanılır.</p></div>
  </div>

  ${pendingAccounts.length ? `<div class="section" style="margin-top:0">
    <div class="section-head"><h2>Şirkət hesabları</h2>
      <span class="hint">${pendingAccounts.length} hesab təsdiq gözləyir</span></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Şirkət</th><th>Əlaqəli şəxs</th><th>E-poçt</th><th>Qeydiyyat</th><th></th></tr></thead>
      <tbody>${pendingAccounts.map(u => {
        return `<tr>
          <td><div class="row tight">
            <span class="brandbox" style="width:30px;height:30px;font-size:11px">${esc(initials(u.name))}</span>
            <div class="who"><b>${esc(u.name)}</b><small>${esc(u.sector || '—')}</small></div></div></td>
          <td style="font-size:12.5px">${esc(u.contact || '—')}</td>
          <td style="font-size:12.5px">${esc(u.email)}</td>
          <td class="num">${u.createdAt ? fmtDate(u.createdAt) : '—'}</td>
          <td><div class="row tight">
            <button class="btn sm primary" data-act="account-approve" data-uid="${esc(u.id)}">✓ Təsdiqlə</button>
            <button class="btn sm danger" data-act="account-reject" data-uid="${esc(u.id)}">× İmtina</button>
          </div></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
  </div>

  <div class="section-head" style="margin-top:32px"><h2>Elanlar</h2></div>` : ''}
  ${pending.length ? `<div class="joblist">
    ${pending.map(j => jobCard(j, null, {
      footer: `<div class="job-foot">
        <button class="btn sm primary" data-act="approve" data-id="${j.id}">✓ Təsdiqlə və dərc et</button>
        <button class="btn sm danger" data-act="reject" data-id="${j.id}">× İmtina</button>
        <div class="spacer"></div>
        <span style="color:var(--muted);font-size:11.5px">
          ${esc((companyOf(j.companyId)).name || '')} göndərib · ${fmtDate(j.postedAt)}
        </span>
      </div>`
    })).join('')}
  </div>` : emptyState('Növbə boşdur', 'Təsdiq gözləyən elan yoxdur.')}`;
}

function viewAdminStudents() {
  const fs = facultyStats();
  return `
  <div class="page-head">
    <div><div class="eyebrow">Karyera Mərkəzi</div><h1>Tələbələr</h1>
      <p>Qeydiyyatlı profillər və onların ən yüksək uyğunluq göstəriciləri.</p></div>
  </div>
  <div class="table-wrap"><table>
    <thead><tr><th>Tələbə</th><th>Fakültə</th><th>İxtisas</th><th class="num">Kurs</th><th class="num">GPA</th>
      <th class="num">Bacarıq</th><th style="width:170px">Ən yaxşı uyğunluq</th></tr></thead>
    <tbody>${STUDENT_POOL.map(s => {
      const best = rankOpportunities(Store.allJobs(), s)[0];
      return `<tr>
        <td><b>${esc(s.name)}</b></td>
        <td style="font-size:12px;color:var(--muted)">${esc(s.faculty.replace(' fakültəsi', ''))}</td>
        <td style="font-size:12.5px">${esc(s.major)}</td>
        <td class="num">${s.course}</td>
        <td class="num">${s.gpa}</td>
        <td class="num">${s.skills.length}</td>
        <td>${best ? meterHTML(best.report) : '—'}</td>
      </tr>`;
    }).join('')}</tbody></table></div>

  <div class="section">
    <div class="section-head"><h2>Fakültə üzrə bölgü</h2></div>
    <div class="card pad-lg"><div class="stack tight">
      ${fs.map(x => barRow(x.faculty.replace(' fakültəsi', ''), x.students, Math.max(...fs.map(y => y.students), 1))).join('')}
    </div></div>
  </div>`;
}

function viewAdminCompanies() {
  const jobs = Store.allJobs();
  return `
  <div class="page-head">
    <div><div class="eyebrow">Karyera Mərkəzi</div><h1>Şirkətlər</h1>
      <p>Tərəfdaş şirkətlər və onların platformadakı fəallığı.</p></div>
  </div>
  <div class="table-wrap"><table>
    <thead><tr><th>Şirkət</th><th>Sektor</th><th>Şəhər</th><th class="num">Aktiv elan</th><th class="num">Təsdiq gözləyən</th><th>Haqqında</th></tr></thead>
    <tbody>${allCompanies().map(c => {
      const mine = jobs.filter(j => j.companyId === c.id);
      return `<tr>
        <td><div class="row tight"><span class="brandbox" style="width:30px;height:30px;font-size:11px">${esc(initials(c.name))}</span>
          <b>${esc(c.name)}</b></div></td>
        <td style="font-size:12.5px">${esc(c.sector)}</td>
        <td style="font-size:12.5px;color:var(--muted)">${esc(c.city)}</td>
        <td class="num">${mine.filter(j => j.status === 'approved').length}</td>
        <td class="num">${mine.filter(j => j.status === 'pending').length}</td>
        <td style="font-size:11.5px;color:var(--muted);max-width:280px">${esc(c.about)}</td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
}

function viewAdminEvents() {
  return `
  <div class="page-head">
    <div><div class="eyebrow">Karyera Mərkəzi</div><h1>Tədbirlər</h1>
      <p>Qeydiyyat dinamikası və yer doluluğu.</p></div>
  </div>
  <div class="table-wrap"><table>
    <thead><tr><th>Tədbir</th><th>Tip</th><th>Tarix</th><th>Yer</th><th style="width:170px">Doluluq</th><th class="num">Qeydiyyat</th></tr></thead>
    <tbody>${EVENTS.map(e => `<tr>
      <td><b style="font-size:13px">${esc(e.title)}</b></td>
      <td><span class="chip mono line">${esc(e.type)}</span></td>
      <td class="num">${fmtDate(e.date)}</td>
      <td style="font-size:12.5px;color:var(--muted)">${esc(e.place)}</td>
      <td><span class="bar"><i class="${e.registered >= e.seats ? 'bad' : pct(e.registered, e.seats) > 80 ? 'warn' : 'good'}"
        style="width:${pct(e.registered, e.seats)}%"></i></span></td>
      <td class="num">${e.registered}/${e.seats}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

function viewAnalytics() {
  const jobs = Store.allJobs().filter(j => j.status === 'approved');
  const fs = facultyStats();
  const maxJobs = Math.max(...fs.map(x => x.jobs), 1);
  const demand = skillDemand(10);
  const demandMax = demand.length ? demand[0][1] : 1;

  /* Hər tələbə üçün ən yaxşı uyğunluq — platformanın əsl keyfiyyət göstəricisi */
  const bests = STUDENT_POOL.map(s => {
    const r = rankOpportunities(jobs, s)[0];
    return { student: s, score: r ? r.report.score : 0 };
  });
  const avgBest = Math.round(bests.reduce((a, b) => a + b.score, 0) / bests.length);
  const covered = bests.filter(b => b.score >= 65).length;
  const bands = [
    ['85–100% (çox yüksək)', bests.filter(b => b.score >= 85).length, 'good'],
    ['65–84% (yüksək)', bests.filter(b => b.score >= 65 && b.score < 85).length, 'good'],
    ['45–64% (orta)', bests.filter(b => b.score >= 45 && b.score < 65).length, 'warn'],
    ['0–44% (aşağı)', bests.filter(b => b.score < 45).length, 'bad']
  ];

  return `
  <div class="page-head">
    <div><div class="eyebrow">Analytics</div><h1>Analitika</h1>
      <p>Platformanın əsas sualı: hər tələbə üçün ən azı bir güclü uyğunluq varmı?</p></div>
  </div>

  <div class="tiles">
    <div class="tile accent"><span class="k">Orta ən yaxşı uyğunluq</span><span class="v">${avgBest}%</span>
      <span class="s">tələbə başına</span></div>
    <div class="tile"><span class="k">Güclü uyğunluğu olan tələbə</span><span class="v">${pct(covered, bests.length)}%</span>
      <span class="s">${covered}/${bests.length} tələbə 65%+</span></div>
    <div class="tile"><span class="k">Elan / tələbə nisbəti</span><span class="v">${(jobs.length / STUDENT_POOL.length).toFixed(1)}</span>
      <span class="s">${jobs.length} elan · ${STUDENT_POOL.length} tələbə</span></div>
    <div class="tile"><span class="k">Əhatəsiz fakültə</span><span class="v">${fs.filter(x => x.jobs === 0).length}</span>
      <span class="s">heç bir elanla hədəflənməyən</span></div>
  </div>

  <div class="grid c2 section">
    <div class="card pad-lg">
      <div class="section-head"><h2>Tələbələrin ən yaxşı uyğunluq bölgüsü</h2></div>
      <div class="stack tight">
        ${bands.map(([l, n, tone]) => barRow(l, n, Math.max(...bands.map(b => b[1]), 1), tone)).join('')}
      </div>
      <p style="color:var(--muted);font-size:11.5px;margin:12px 0 0">
        «Aşağı» qrupdakı tələbələr üçün ya elan çatışmır, ya da profilləri natamamdır.
      </p>
    </div>

    <div class="card pad-lg">
      <div class="section-head"><h2>Fakültə üzrə elan əhatəsi</h2></div>
      <div class="stack tight">
        ${fs.map(x => barRow(x.faculty.replace(' fakültəsi', ''), x.jobs, maxJobs, x.jobs === 0 ? 'bad' : '')).join('')}
      </div>
    </div>
  </div>

  <div class="card pad-lg section">
    <div class="section-head"><h2>Bazarın tələb etdiyi bacarıqlar</h2>
      <span class="hint">Tədris proqramının yenilənməsi üçün siqnal</span></div>
    <div class="grid c2">
      <div class="stack tight">${demand.slice(0, 5).map(([s, n]) => barRow(s, n, demandMax, 'warn')).join('')}</div>
      <div class="stack tight">${demand.slice(5).map(([s, n]) => barRow(s, n, demandMax, 'warn')).join('')}</div>
    </div>
  </div>`;
}

function viewReports() {
  const jobs = Store.allJobs().filter(j => j.status === 'approved');
  const fs = facultyStats();
  const bests = STUDENT_POOL.map(s => {
    const r = rankOpportunities(jobs, s)[0];
    return { s, best: r ? r.report.score : 0, title: r ? r.job.title : '—' };
  });
  const avgBest = Math.round(bests.reduce((a, b) => a + b.best, 0) / bests.length);

  const lines = [
    'ASOIU KARYERA MƏRKƏZİ — SEMESTR HESABATI',
    `Hazırlanma tarixi: ${fmtDate(TODAY.toISOString().slice(0, 10))}`,
    '',
    '1. ÜMUMİ GÖSTƏRİCİLƏR',
    `   Qeydiyyatlı tələbə:      ${STUDENT_POOL.length}`,
    `   Tərəfdaş şirkət:         ${allCompanies().length}`,
    `   Aktiv elan:              ${jobs.length}`,
    `   Təsdiq gözləyən elan:    ${Store.allJobs().filter(j => j.status === 'pending').length}`,
    `   Tədbir:                  ${EVENTS.length}`,
    `   Orta ən yaxşı uyğunluq:  ${avgBest}%`,
    '',
    '2. FAKÜLTƏ ÜZRƏ ELAN ƏHATƏSİ',
    ...fs.map(x => `   ${x.faculty.padEnd(52, '.')} ${String(x.jobs).padStart(3)} elan · ${x.students} tələbə`),
    '',
    '3. ELAN TİPLƏRİ',
    ...['İş', 'Təcrübə', 'Graduate', 'Könüllülük'].map(t =>
      `   ${t.padEnd(52, '.')} ${String(jobs.filter(j => j.type === t).length).padStart(3)}`),
    '',
    '4. ƏN ÇOX TƏLƏB OLUNAN BACARIQLAR',
    ...skillDemand(8).map(([s, n]) => `   ${s.padEnd(52, '.')} ${String(n).padStart(3)} elanda`),
    '',
    '5. TƏDBİR DOLULUĞU',
    ...EVENTS.map(e => `   ${e.title.slice(0, 50).padEnd(52, '.')} ${e.registered}/${e.seats} (${pct(e.registered, e.seats)}%)`),
    '',
    '6. TÖVSİYƏLƏR',
    ...(fs.filter(x => x.jobs < 3).length
      ? fs.filter(x => x.jobs < 3).map(x => `   - ${x.faculty}: elan sayı azdır, yeni tərəfdaşlıq tələb olunur.`)
      : ['   - Bütün fakültələr kifayət qədər elanla əhatə olunub.']),
    `   - Bazar ${skillDemand(3).map(x => x[0]).join(', ')} bacarıqlarını ən çox tələb edir; tədris proqramında nəzərə alınsın.`
  ];
  const report = lines.join('\n');

  return `
  <div class="page-head">
    <div><div class="eyebrow">Reports</div><h1>Hesabatlar</h1>
      <p>Rektorluq və fakültələr üçün semestr hesabatı. Rəqəmlər platformadakı canlı məlumatdan hesablanır.</p></div>
    <div class="row">
      <button class="btn" data-act="report-copy">⧉ Kopyala</button>
      <button class="btn primary" data-act="cv-print">⎙ Çap et</button>
    </div>
  </div>
  <div class="cvsheet" style="max-width:820px">
    <pre class="mono" id="report-text" style="margin:0;font-size:11.5px;line-height:1.75;white-space:pre-wrap;color:#17233d">${esc(report)}</pre>
  </div>`;
}

function viewAdminAccount() {
  const users = Store.state.users;
  const byRole = r => users.filter(u => u.role === r).length;
  return `
  <div class="page-head">
    <div><div class="eyebrow">Karyera Mərkəzi</div><h1>Profil və hesab</h1>
      <p>Platformadakı hesablar və öz giriş məlumatlarınız.</p></div>
  </div>

  <div class="tiles" style="margin-bottom:22px">
    <div class="tile"><span class="k">Tələbə hesabı</span><span class="v">${byRole('student')}</span>
      <span class="s">qeydiyyatdan keçmiş</span></div>
    <div class="tile"><span class="k">Şirkət hesabı</span><span class="v">${byRole('company')}</span>
      <span class="s">${Auth.pendingCompanies().length} təsdiq gözləyir</span></div>
    <div class="tile"><span class="k">Admin hesabı</span><span class="v">${byRole('admin')}</span>
      <span class="s">Karyera Mərkəzi</span></div>
    <div class="tile"><span class="k">Cəmi</span><span class="v">${users.length}</span>
      <span class="s">aktiv hesab</span></div>
  </div>

  <div class="grid side">
    <div class="table-wrap"><table>
      <thead><tr><th>Hesab</th><th>E-poçt</th><th>Rol</th><th>Status</th><th>Qeydiyyat</th></tr></thead>
      <tbody>${users.map(u => `<tr>
        <td><div class="row tight">
          <span class="brandbox" style="width:30px;height:30px;font-size:11px">${esc(initials(u.name))}</span>
          <b>${esc(u.name)}</b></div></td>
        <td style="font-size:12.5px">${esc(u.email)}</td>
        <td><span class="chip line">${esc(ROLE_NAMES[u.role])}</span></td>
        <td><span class="chip ${u.status === 'active' ? 'good' : u.status === 'pending' ? 'warn' : 'bad'}">
          ${u.status === 'active' ? 'Aktiv' : u.status === 'pending' ? 'Gözləyir' : 'İmtina'}</span></td>
        <td class="num">${fmtDate(u.createdAt)}</td>
      </tr>`).join('')}</tbody>
    </table></div>

    <div class="stack">
      ${accountCard()}
      ${passwordCard()}
      <div class="note"><span class="m">ⓘ</span><span>Şifrələr PBKDF2-SHA256 (120 000 iterasiya)
        ilə hashlənir və açıq mətnlə saxlanmır.</span></div>
    </div>
  </div>`;
}

/* ================================================================ *
 * GİRİŞ / QEYDİYYAT EKRANI
 * ================================================================ */
function authScreen() {
  const err = UI.auth.error;
  const busy = UI.auth.busy;
  const tab = UI.auth.tab;

  return `
  <div class="auth">
    <aside class="auth-brand">
      <div class="auth-brand-top">
        ${logoLockup()}
        <button type="button" class="auth-back" data-lp="home">← Ana səhifə</button>
      </div>
      <div class="auth-brand-mid">
        <h1>İxtisasına uyğun karyeranı bir platformada tap.</h1>
        <p>ADNSU tələbələri üçün iş, təcrübə, graduate proqramları və könüllülük imkanları —
           fakültənə, ixtisasına və bacarıqlarına görə avtomatik uyğunlaşdırılmış.</p>
        <dl class="auth-facts">
          <div><dt>${OPPORTUNITIES.filter(o => o.status === 'approved').length}</dt><dd>aktiv imkan</dd></div>
          <div><dt>${COMPANIES.length}</dt><dd>tərəfdaş şirkət</dd></div>
          <div><dt>40/40/20</dt><dd>uyğunluq formulası</dd></div>
        </dl>
      </div>
      <div class="auth-brand-foot">
        <div class="mascot-inline">
          ${mascot('wave', { eager: true })}
          <span>ADNSU Karyera köməkçisi sənə uyğun imkanları tapmaqda kömək edir.</span>
        </div>
      </div>
    </aside>

    <main class="auth-panel">
      <div class="auth-card ${tab === 'register' && UI.auth.intent ? 'auth-card-wide' : ''}">
        <div class="auth-tabs" role="tablist">
          <button role="tab" aria-selected="${tab === 'login'}" data-act="auth-tab" data-tab="login">Giriş</button>
          <button role="tab" aria-selected="${tab === 'register'}" data-act="auth-tab" data-tab="register">Qeydiyyat</button>
        </div>

        ${!Auth.available() ? `<div class="note bad" style="margin-bottom:16px"><span class="m">×</span>
          <span>Bu brauzer Web Crypto API-ni dəstəkləmir. Giriş üçün müasir brauzer və ya
          <b>https</b> bağlantısı lazımdır.</span></div>` : ''}

        ${UI.auth.notice ? `<div class="note good" style="margin-bottom:16px"><span class="m">✓</span><span>${esc(UI.auth.notice)}</span></div>` : ''}
        ${err ? `<div class="note bad" style="margin-bottom:16px"><span class="m">×</span><span>${esc(err)}</span></div>` : ''}

        ${Store.mode === 'supabase'
          ? (tab === 'login' ? authLoginForm(busy) : authRegisterForm(busy))
          : `<div class="empty"><b>Giriş xidməti müvəqqəti əlçatan deyil</b><span>Məlumat bazası yenidən aktiv olduqda burada daxil ola biləcəksiniz.</span><button class="btn" type="button" onclick="location.reload()">Yenidən yoxla</button></div>`}
      </div>
    </main>
  </div>`;
}

/* Universitet SSO düymələri aktiv provayderə görə göstərilir. */
function ssoButtons(busy) {
  if (Store.mode !== 'supabase') return '';
  const buttons = [];
  if (UI.providers.google === true) buttons.push(`
    <button type="button" class="btn-google" data-act="google" ${busy ? 'disabled' : ''}>
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24s.92 7.54 2.56 10.78l7.97-6.19z"/>
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
      </svg><span>ADNSU Google hesabı ilə daxil ol</span>
    </button>`);
  if (UI.providers.azure === true) buttons.push(`
    <button type="button" class="btn-google" data-act="azure" ${busy ? 'disabled' : ''}>
      <span style="font-weight:800;color:#0078d4">M</span><span>ADNSU Microsoft hesabı ilə daxil ol</span>
    </button>`);
  if (!buttons.length) return '';
  return `
    ${buttons.join('')}
    <div class="auth-or"><span>və ya</span></div>`;
}

function authLoginForm(busy) {
  return `<form class="stack" data-act="login-form" novalidate>
    <h2 class="auth-h">Hesabınıza daxil olun</h2>
    <p class="auth-sub">Rolunuz hesaba görə avtomatik təyin olunur.</p>

    ${ssoButtons(busy)}

    <div class="field">
      <label for="li-email">E-poçt</label>
      <input id="li-email" name="email" type="email" autocomplete="username"
             placeholder="ad.soyad@asoiu.edu.az" value="${esc(UI.auth.email)}" required>
    </div>
    <div class="field">
      <label for="li-password">Şifrə</label>
      <div class="pw-wrap">
        <input id="li-password" name="password" type="password" autocomplete="current-password"
               placeholder="Şifrənizi yazın" value="${esc(UI.auth.password)}" required>
        <button type="button" class="pw-toggle" data-act="pw-toggle" data-for="li-password"
                aria-label="Şifrəni göstər">${eyeIcon()}</button>
      </div>
    </div>

    <button class="btn primary block" type="submit" ${busy ? 'disabled' : ''}>
      ${busy ? 'Yoxlanılır…' : 'Daxil ol →'}
    </button>
    <button class="btn block" type="button" data-act="magic-link" ${busy ? 'disabled' : ''}>
      Universitet e-poçtu ilə şifrəsiz giriş
    </button>

    ${(UI.auth.notice || /təsdiqlənməyib/i.test(UI.auth.error || '')) && Store.mode === 'supabase'
      ? `<button type="button" class="btn block" data-act="resend-confirm">
           ↻ Təsdiq e-poçtunu yenidən göndər
         </button>` : ''}

    <div class="auth-alt">
      <button type="button" class="linkbtn" data-act="forgot">Şifrəni unutmusunuz?</button>
      <span>Hesabınız yoxdur? <button type="button" class="linkbtn" data-act="auth-tab" data-tab="register">Qeydiyyatdan keçin</button></span>
    </div>
  </form>`;
}

function authRegisterFormLegacy(busy) {
  const role = UI.auth.role;
  const isLearner = ['student', 'master_student', 'alumni'].includes(role);
  const faculty = UI.auth.faculty || Object.keys(FACULTIES)[0];
  const st = Auth.strength(UI.auth.password);

  return `<form class="stack" data-act="register-form" novalidate>
    <h2 class="auth-h">Yeni hesab yaradın</h2>
    <p class="auth-sub">Karyera Mərkəzi hesabları universitet tərəfindən yaradılır.</p>

    ${isLearner ? ssoButtons(busy) : ''}

    <div class="field">
      <label>Hesab tipi</label>
      <div class="pills">
        <button type="button" data-act="auth-role" data-role="student" aria-pressed="${role === 'student'}">Tələbə</button>
        <button type="button" data-act="auth-role" data-role="master_student" aria-pressed="${role === 'master_student'}">Magistr</button>
        <button type="button" data-act="auth-role" data-role="alumni" aria-pressed="${role === 'alumni'}">Məzun</button>
        <button type="button" data-act="auth-role" data-role="company" aria-pressed="${role === 'company'}">Şirkət</button>
      </div>
    </div>

    ${isLearner ? `
      <div class="field">
        <label for="rg-name">Ad və soyad</label>
        <input id="rg-name" name="name" type="text" autocomplete="name" placeholder="Aylin Məmmədova" value="${esc(UI.auth.name)}" required>
      </div>
      <div class="field">
        <label for="rg-email">${role === 'alumni' ? 'E-poçt' : 'Universitet e-poçtu'}</label>
        <input id="rg-email" name="email" type="email" autocomplete="username"
               placeholder="${role === 'alumni' ? 'ad.soyad@email.com' : 'ad.soyad@asoiu.edu.az'}" value="${esc(UI.auth.email)}" required>
        <span class="help">${role === 'alumni' ? 'Universitet e-poçtu olmayan məzun hesabları Karyera Mərkəzi tərəfindən təsdiqlənir.' : `Yalnız <b>@${UNI_DOMAIN}</b> ünvanları qəbul olunur.`}</span>
      </div>
      <div class="grid c2">
        <div class="field">
          <label for="rg-faculty">Fakültə</label>
          <select id="rg-faculty" name="faculty" data-act="auth-faculty">
            ${Object.keys(FACULTIES).map(f => `<option ${f === faculty ? 'selected' : ''}>${esc(f)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="rg-major">İxtisas</label>
          <select id="rg-major" name="major">
            ${(FACULTIES[faculty] || []).map(m => `<option ${m === UI.auth.major ? 'selected' : ''}>${esc(m)}</option>`).join('')}
          </select>
        </div>
      </div>
      ${role !== 'alumni' ? `<div class="field" style="max-width:180px">
        <label for="rg-course">Kurs</label>
        <select id="rg-course" name="course">
          ${(role === 'master_student' ? [1, 2] : [1, 2, 3, 4]).map(c => `<option value="${c}" ${Number(UI.auth.course) === c ? 'selected' : ''}>${c}. kurs</option>`).join('')}
        </select>
      </div>` : '<input type="hidden" name="course" value="4">'}
      ${role === 'master_student' ? '<div class="note"><span class="m">ⓘ</span><span>Profil yarandıqdan sonra “Təhsil əlavə et” bölməsində magistr universiteti, fakültə, ixtisas və qrupu ayrıca qeyd edə bilərsiniz.</span></div>' : ''}
    ` : `
      <div class="field">
        <label for="rg-name">Şirkət adı</label>
        <input id="rg-name" name="name" type="text" placeholder="SOCAR" value="${esc(UI.auth.name)}" required>
      </div>
      <div class="grid c2">
        <div class="field">
          <label for="rg-contact">Əlaqəli şəxs</label>
          <input id="rg-contact" name="contact" type="text" placeholder="Ad Soyad" value="${esc(UI.auth.contact)}" required>
        </div>
        <div class="field">
          <label for="rg-sector">Sektor</label>
          <select id="rg-sector" name="sector">
            ${[...new Set(COMPANIES.map(c => c.sector))].concat('Digər').map(s =>
              `<option ${s === UI.auth.sector ? 'selected' : ''}>${esc(s)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="field">
        <label for="rg-email">Korporativ e-poçt</label>
        <input id="rg-email" name="email" type="email" autocomplete="username"
               placeholder="careers@sirket.az" value="${esc(UI.auth.email)}" required>
      </div>
      <div class="note warn"><span class="m">!</span>
        <span>Şirkət hesabları Karyera Mərkəzinin təsdiqindən sonra elan dərc edə bilir.
        Təsdiqə qədər kabinetə daxil ola, namizədləri görə bilərsiniz.</span></div>
      <div class="field"><label>Başlanğıc paket</label><div class="pills">
        ${[['free','Free · 0 AZN'],['pro','Pro · 24.99 AZN'],['business','Business · 49.99 AZN']].map(([v,l]) =>
          `<button type="button" data-act="auth-plan" data-plan="${v}" aria-pressed="${UI.auth.plan === v}">${l}</button>`).join('')}
      </div><span class="help">Ödəniş sistemi qoşulana qədər seçim sorğu kimi saxlanılır; ödəniş tutulmur.</span></div>
    `}

    <div class="field">
      <label for="rg-password">Şifrə</label>
      <div class="pw-wrap">
        <input id="rg-password" name="password" type="password" autocomplete="new-password"
               placeholder="Ən azı 8 simvol" value="${esc(UI.auth.password)}" data-act="pw-strength" required>
        <button type="button" class="pw-toggle" data-act="pw-toggle" data-for="rg-password"
                aria-label="Şifrəni göstər">${eyeIcon()}</button>
      </div>
      <div class="pw-foot">
        <div class="pw-meter" aria-hidden="true">
          ${[0, 1, 2, 3].map(i => `<i class="${UI.auth.password && i < st.level ? 'on l' + st.level : ''}"></i>`).join('')}
        </div>
        <span class="pw-label">${UI.auth.password ? esc(st.label) : 'Hərf və rəqəm, ən azı 8 simvol'}</span>
      </div>
    </div>

    <div class="field">
      <label for="rg-password2">Şifrənin təkrarı</label>
      <div class="pw-wrap">
        <input id="rg-password2" name="password2" type="password" autocomplete="new-password"
               placeholder="Şifrəni bir daha yazın" value="${esc(UI.auth.password2)}" data-act="pw-confirm" required>
        <button type="button" class="pw-toggle" data-act="pw-toggle" data-for="rg-password2"
                aria-label="Şifrəni göstər">${eyeIcon()}</button>
      </div>
      <span class="pw-match" id="pw-match"></span>
    </div>

    <label class="check">
      <input type="checkbox" name="terms" ${UI.auth.terms ? 'checked' : ''} data-act="auth-terms">
      <span>Məlumatlarımın ADNSU Karyera Mərkəzi tərəfindən karyera dəstəyi məqsədilə
        emalına razıyam.</span>
    </label>

    <button class="btn primary block" type="submit" ${busy ? 'disabled' : ''}>
      ${busy ? 'Hesab yaradılır…' : 'Hesab yarat →'}
    </button>

    <div class="auth-alt">
      <span>Artıq hesabınız var? <button type="button" class="linkbtn" data-act="auth-tab" data-tab="login">Daxil olun</button></span>
    </div>
  </form>`;
}

function authRegisterForm(busy) {
  if (!UI.auth.intent) return `<div class="stack registration-choice">
    <div><h2 class="auth-h">Necə qeydiyyatdan keçmək istəyirsiniz?</h2>
      <p class="auth-sub">Tələbə və şirkət üçün ayrı, təhlükəsiz qeydiyyat axını.</p></div>
    <div class="account-choice-grid">
      <button type="button" data-act="auth-account" data-account="learner"><span class="account-choice-icon">◎</span><b>Tələbə kimi qeydiyyat</b><small>Bakalavr, magistr və məzun hesabları</small><em>Davam et →</em></button>
      <button type="button" data-act="auth-account" data-account="company"><span class="account-choice-icon">▣</span><b>Şirkət kimi qeydiyyat</b><small>Free, Pro və Business paketləri</small><em>Davam et →</em></button>
    </div>
    <div class="auth-alt"><span>Artıq hesabınız var? <button type="button" class="linkbtn" data-act="auth-tab" data-tab="login">Daxil olun</button></span></div>
  </div>`;

  const isLearner = UI.auth.intent === 'learner';
  const level = UI.auth.educationLevel || 'bachelor';
  const role = isLearner ? (level === 'master' ? 'master_student' : level === 'graduate' ? 'alumni' : 'student') : 'company';
  const faculty = UI.auth.faculty || Object.keys(FACULTIES)[0];
  const st = Auth.strength(UI.auth.password);
  const passwordFields = `<div class="grid c2"><div class="field"><label for="rg-password">Şifrə</label><div class="pw-wrap">
      <input id="rg-password" name="password" type="password" autocomplete="new-password" placeholder="Ən azı 8 simvol" value="${esc(UI.auth.password)}" data-act="pw-strength" required>
      <button type="button" class="pw-toggle" data-act="pw-toggle" data-for="rg-password" aria-label="Şifrəni göstər">${eyeIcon()}</button></div>
      <div class="pw-foot"><div class="pw-meter" aria-hidden="true">${[0,1,2,3].map(i => `<i class="${UI.auth.password && i < st.level ? 'on l' + st.level : ''}"></i>`).join('')}</div><span class="pw-label">${UI.auth.password ? esc(st.label) : 'Hərf və rəqəm, ən azı 8 simvol'}</span></div></div>
    <div class="field"><label for="rg-password2">Şifrənin təkrarı</label><div class="pw-wrap">
      <input id="rg-password2" name="password2" type="password" autocomplete="new-password" placeholder="Şifrəni bir daha yazın" value="${esc(UI.auth.password2)}" data-act="pw-confirm" required>
      <button type="button" class="pw-toggle" data-act="pw-toggle" data-for="rg-password2" aria-label="Şifrəni göstər">${eyeIcon()}</button></div><span class="pw-match" id="pw-match"></span></div></div>`;

  const learnerFields = `<div class="grid c2">
      <div class="field"><label>Ad</label><input name="firstName" autocomplete="given-name" value="${esc(UI.auth.firstName)}" required></div>
      <div class="field"><label>Soyad</label><input name="lastName" autocomplete="family-name" value="${esc(UI.auth.lastName)}" required></div></div>
    <div class="grid c2"><div class="field"><label>${role === 'alumni' ? 'E-poçt' : 'Universitet e-poçtu'}</label><input name="email" type="email" autocomplete="username" placeholder="${role === 'alumni' ? 'ad.soyad@email.com' : 'ad.soyad@asoiu.edu.az'}" value="${esc(UI.auth.email)}" required><span class="help">${role === 'alumni' ? 'Şəxsi e-poçtla məzun hesabı admin təsdiqinə düşür.' : `Yalnız <b>@${UNI_DOMAIN}</b> ünvanı qəbul olunur.`}</span></div>
      <div class="field"><label>Telefon</label><input name="phone" type="tel" autocomplete="tel" placeholder="+994 50 000 00 00" value="${esc(UI.auth.phone)}" required></div></div>
    <div class="grid c2"><div class="field"><label>Təhsil səviyyəsi</label><select name="educationLevel" data-act="auth-education-level"><option value="bachelor" ${level === 'bachelor' ? 'selected' : ''}>Bakalavr</option><option value="master" ${level === 'master' ? 'selected' : ''}>Magistr</option><option value="graduate" ${level === 'graduate' ? 'selected' : ''}>Məzun / Alumni</option></select></div>
      <div class="field"><label>Profil şəkli (istəyə bağlı)</label><input name="avatarUrl" type="url" placeholder="https://..." value="${esc(UI.auth.avatarUrl)}"><span class="help">Şəkil linkini profilinizdən sonra da əlavə edə bilərsiniz.</span></div></div>
    <div class="field"><label>Bakalavr universiteti</label><input name="university" value="${esc(UI.auth.university)}" required></div>
    <div class="grid c2"><div class="field"><label>Bakalavr fakültəsi</label><select name="faculty" data-act="auth-faculty">${Object.keys(FACULTIES).map(f => `<option ${f === faculty ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select></div>
      <div class="field"><label>Bakalavr ixtisası</label><select name="major">${(FACULTIES[faculty] || []).map(m => `<option ${m === UI.auth.major ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></div></div>
    <div class="grid c2"><div class="field"><label>Qrup</label><input name="groupName" value="${esc(UI.auth.groupName)}" placeholder="məsələn, 642.21"></div>
      ${role !== 'alumni' ? `<div class="field"><label>Cari kurs</label><select name="course">${(role === 'master_student' ? [1,2] : [1,2,3,4]).map(c => `<option value="${c}" ${Number(UI.auth.course) === c ? 'selected' : ''}>${c}. kurs</option>`).join('')}</select></div>` : '<input type="hidden" name="course" value="4"><div></div>'}</div>
    <div class="grid c2"><div class="field"><label>Bakalavr başlama ili</label><input name="bachelorStartYear" type="number" min="1950" max="2100" value="${esc(UI.auth.bachelorStartYear)}"></div><div class="field"><label>Bakalavr bitirmə ili</label><input name="bachelorEndYear" type="number" min="1950" max="2100" value="${esc(UI.auth.bachelorEndYear)}"></div></div>
    ${level === 'master' ? `<section class="registration-section"><div><b>Magistr təhsili</b><span>Bakalavr məlumatı ayrıca saxlanılır və silinmir.</span></div>
      <div class="field"><label>Magistr universiteti</label><input name="masterUniversity" value="${esc(UI.auth.masterUniversity)}" required></div>
      <div class="grid c2"><div class="field"><label>Magistr fakültəsi</label><input name="masterFaculty" value="${esc(UI.auth.masterFaculty)}" required></div><div class="field"><label>Magistr ixtisası</label><input name="masterSpecialty" value="${esc(UI.auth.masterSpecialty)}" required></div></div>
      <div class="grid c2"><div class="field"><label>İxtisaslaşma</label><input name="masterSpecialization" value="${esc(UI.auth.masterSpecialization)}"></div><div class="field"><label>Magistr qrupu</label><input name="masterGroup" value="${esc(UI.auth.masterGroup)}"></div></div>
      <div class="grid c2"><div class="field"><label>Başlama ili</label><input name="masterStartYear" type="number" min="1950" max="2100" value="${esc(UI.auth.masterStartYear)}" required></div><div class="field"><label>Bitirmə ili</label><input name="masterEndYear" type="number" min="1950" max="2100" value="${esc(UI.auth.masterEndYear)}"></div></div></section>` : ''}`;

  const companyFields = `<div class="field"><label>Şirkət adı</label><input name="name" value="${esc(UI.auth.name)}" placeholder="SOCAR" required></div>
    <div class="grid c2"><div class="field"><label>Korporativ e-poçt</label><input name="email" type="email" autocomplete="username" value="${esc(UI.auth.email)}" placeholder="careers@sirket.az" required></div><div class="field"><label>Telefon</label><input name="phone" type="tel" value="${esc(UI.auth.phone)}" required></div></div>
    <div class="grid c2"><div class="field"><label>Vebsayt</label><input name="website" type="url" value="${esc(UI.auth.website)}" placeholder="https://sirket.az"></div><div class="field"><label>Sektor</label><select name="sector">${[...new Set(COMPANIES.map(c => c.sector))].concat('Digər').map(s => `<option ${s === UI.auth.sector ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div></div>
    <div class="grid c2"><div class="field"><label>Şirkət ölçüsü</label><select name="companySize">${['1–10','11–50','51–200','201–1000','1000+'].map(v => `<option ${v === UI.auth.companySize ? 'selected' : ''}>${v}</option>`).join('')}</select></div><div class="field"><label>Ünvan</label><input name="address" value="${esc(UI.auth.address)}" required></div></div>
    <div class="grid c2"><div class="field"><label>Loqo linki</label><input name="logoUrl" type="url" value="${esc(UI.auth.logoUrl)}" placeholder="https://..."></div><div class="field"><label>Qısa şirkət təsviri</label><textarea name="description" maxlength="500">${esc(UI.auth.description)}</textarea></div></div>
    <section class="registration-section"><div><b>Əlaqəli şəxs</b><span>Admin təsdiqi və rəsmi əlaqə üçün.</span></div><div class="grid c2"><div class="field"><label>Ad və soyad</label><input name="contact" value="${esc(UI.auth.contact)}" required></div><div class="field"><label>Vəzifə</label><input name="contactPosition" value="${esc(UI.auth.contactPosition)}" required></div></div><div class="grid c2"><div class="field"><label>E-poçt</label><input name="contactEmail" type="email" value="${esc(UI.auth.contactEmail)}" required></div><div class="field"><label>Telefon</label><input name="contactPhone" type="tel" value="${esc(UI.auth.contactPhone)}" required></div></div></section>
    <div class="note warn"><span class="m">!</span><span>Şirkət hesabı və hər yeni vakansiya ayrıca admin təsdiqindən keçir.</span></div>
    <div class="field"><label>Başlanğıc paket</label><div class="registration-plans">${COMPANY_PLANS.map(plan => `<button type="button" data-act="auth-plan" data-plan="${plan.id}" aria-pressed="${UI.auth.plan === plan.id}"><span>${plan.name}</span><b>${plan.price} AZN<small>/ ay</small></b><em>${plan.features.slice(0,3).join(' · ')}</em></button>`).join('')}</div><span class="help">Ödəniş provayderi qoşulana qədər Pro və Business seçimi admin təsdiqinə göndərilir.</span></div>`;

  return `<form class="stack" data-act="register-form" novalidate><div class="registration-head"><div><h2 class="auth-h">${isLearner ? 'Tələbə qeydiyyatı' : 'Şirkət qeydiyyatı'}</h2><p class="auth-sub">${isLearner ? 'Təhsil məlumatlarınız ayrıca saxlanılır.' : 'Şirkət məlumatları admin tərəfindən yoxlanılır.'}</p></div><button type="button" class="linkbtn" data-act="auth-account-back">Hesab növünü dəyiş</button></div>
    ${isLearner ? ssoButtons(busy) : ''}${isLearner ? learnerFields : companyFields}${passwordFields}
    <label class="check"><input type="checkbox" name="terms" ${UI.auth.terms ? 'checked' : ''} data-act="auth-terms"><span>Məlumatlarımın ADNSU Karyera Mərkəzi tərəfindən platformanın fəaliyyəti üçün emalına razıyam.</span></label>
    <button class="btn primary block" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Hesab yaradılır…' : 'Hesab yarat →'}</button>
    <div class="auth-alt"><span>Artıq hesabınız var? <button type="button" class="linkbtn" data-act="auth-tab" data-tab="login">Daxil olun</button></span></div></form>`;
}

/* ================================================================ *
 * Router
 * ================================================================ */
const VIEWS = {
  student: {
    dashboard: viewStudentDashboard, jobs: viewJobs, applications: viewApplications,
    profile: viewProfile, cv: viewCV, interview: viewInterview, roadmap: viewRoadmap, events: viewEvents,
    network: viewNetwork, benefits: viewBenefits
  },
  company: {
    dashboard: viewCompanyDashboard, vacancies: viewVacancies, post: viewPost,
    applications: viewCompanyApplications, candidates: viewCandidates, search: viewSearch, invites: viewInvites, profile: viewCompanyProfile,
    subscription: viewSubscription
  },
  admin: {
    dashboard: viewAdminDashboard, approvals: viewApprovals, students: viewAdminStudents,
    companies: viewAdminCompanies, events: viewAdminEvents, analytics: viewAnalytics,
    reports: viewReports, profile: viewAdminAccount, redeem: viewRedeem
  }
};

/* Sessiya daxili interfeys vəziyyəti (saxlanılmır) */
const UI = {
  jobFilter: { q: '', type: 'Hamısı', min: 0, savedOnly: false },
  search: { q: '', faculty: 'Hamısı', course: 0, minGPA: 0 },
  cvTab: 'build',
  cvText: '',
  compareJob: null,
  candJob: null,
  candMin: 45,
  theme: null,
  booting: true,
  publicView: 'landing',
  studentSidebarCollapsed: (() => { try { return localStorage.getItem('asoiu-student-rail-compact') === '1'; } catch (e) { return false; } })(),
  studentMenuOpen: false,
  providers: {},
  userMenu: false,
  notificationsOpen: false,
  feed: null, feedFilter: 'all', postDraft: '', postKind: 'general', postLink: '', openComments: null,
  aiBusy: false, aiCvResult: null, aiInterviewResult: null, aiJobBusy: null, aiJobResults: {},
  benefits: null, benefitCat: 'Hamısı', redeemResult: null,
  pwMsg: null,
  auth: {
    tab: 'login', intent: '', role: 'student', educationLevel: 'bachelor', busy: false, error: '', notice: '',
    email: '', password: '', password2: '', name: '', firstName: '', lastName: '', phone: '', avatarUrl: '',
    contact: '', contactPosition: '', contactEmail: '', contactPhone: '', sector: '', website: '', companySize: '1–10',
    address: '', logoUrl: '', description: '', faculty: '', major: '', course: 1, groupName: '',
    university: 'Azərbaycan Dövlət Neft və Sənaye Universiteti', bachelorStartYear: '', bachelorEndYear: '',
    masterUniversity: '', masterFaculty: '', masterSpecialty: '', masterSpecialization: '', masterGroup: '', masterStartYear: '', masterEndYear: '',
    plan: 'free', terms: false
  }
};

function resetAuthForm(keep = {}) {
  UI.auth = {
    tab: 'login', intent: '', role: 'student', educationLevel: 'bachelor', busy: false, error: '', notice: '',
    email: '', password: '', password2: '', name: '', firstName: '', lastName: '', phone: '', avatarUrl: '',
    contact: '', contactPosition: '', contactEmail: '', contactPhone: '', sector: '', website: '', companySize: '1–10',
    address: '', logoUrl: '', description: '', faculty: '', major: '', course: 1, groupName: '',
    university: 'Azərbaycan Dövlət Neft və Sənaye Universiteti', bachelorStartYear: '', bachelorEndYear: '',
    masterUniversity: '', masterFaculty: '', masterSpecialty: '', masterSpecialization: '', masterGroup: '', masterStartYear: '', masterEndYear: '',
    plan: 'free', terms: false,
    ...keep
  };
}

function navCounts(role, id) {
  const s = Store.state;
  if (role === 'student') {
    if (id === 'applications') return s.applications.length || '';
    if (id === 'jobs') return rankOpportunities(Store.allJobs(), s.student, { min: 65 }).length || '';
  }
  if (role === 'company') {
    if (id === 'vacancies') return ownJobs().length || '';
    if (id === 'applications') return s.applications.length || '';
    if (id === 'invites') return ownInvites().length || '';
  }
  if (role === 'admin') {
    if (id === 'approvals') return Store.allJobs().filter(j => j.status === 'pending').length || '';
  }
  return '';
}

function render() {
  const st = Store.state;
  const root = document.getElementById('root');

  /* Rejim təyin olunana qədər forma göstərilmir — bax: init(). */
  if (UI.booting) {
    root.innerHTML = `<div class="boot">
      ${logoMark()}
      <p>Yüklənir…</p>
    </div>`;
    return;
  }

  /* Açıq ana səhifə həm qonaqlar, həm də sessiyası açıq istifadəçilər üçün
     əlçatandır. Sessiya silinmir; istifadəçi kabinetə geri qayıda bilər. */
  const user = Auth.currentUser();
  if (UI.publicView === 'landing') {
    root.innerHTML = Landing.render();
    return;
  }

  if (!user) {
    root.innerHTML = authScreen();
    const first = root.querySelector('input:not([type="checkbox"])');
    if (first && !UI.auth.email) first.focus();
    return;
  }

  const role = user.role;
  const view = VIEWS[role][st.view] ? st.view : 'dashboard';
  st.view = view;
  const pendingCo = role === 'company' && user.status === 'pending';

  root.innerHTML = `
    <header class="topbar${role === 'student' ? ' student-topbar' : ''}">
      ${role === 'student' ? `<button type="button" class="student-menu-trigger" data-act="student-menu" aria-label="Menyunu aç" aria-controls="student-navigation" aria-expanded="${UI.studentMenuOpen}">${studentNavIcon('menu')}</button>` : ''}
      ${logoLockup()}
      <div class="topbar-spacer"></div>
      <button class="topbar-home" data-act="home" aria-label="Ana səhifəyə keç">
        <span aria-hidden="true">⌂</span><b>Ana səhifə</b>
      </button>
      ${notificationCenter()}
      <div class="usermenu">
        <button class="userchip" data-act="user-menu" aria-expanded="${UI.userMenu}">
          <span class="avatar">${esc(initials(user.name))}</span>
          <span class="who">
            <b>${esc(user.name)}</b>
            <small>${esc(ROLE_NAMES[role])}${pendingCo ? ' · təsdiq gözləyir' : ''}</small>
          </span>
          <span class="caret" aria-hidden="true">▾</span>
        </button>
        ${UI.userMenu ? `<div class="usermenu-pop" role="menu">
          <div class="usermenu-head">
            <b>${esc(user.name)}</b>
            <small>${esc(user.email)}</small>
            <span class="chip ${user.status === 'pending' ? 'warn' : 'good'}">${esc(ROLE_NAMES[role])}${user.status === 'pending' ? ' · gözləyir' : ''}</span>
          </div>
          ${VIEWS[role].profile ? '<button role="menuitem" data-act="go" data-view="profile">☰ Profil və hesab</button>' : ''}
          <button role="menuitem" data-act="theme">◐ Açıq / tünd tema</button>
          <button role="menuitem" class="danger" data-act="logout">⏻ Çıxış</button>
        </div>` : ''}
      </div>
    </header>

    <div class="shell${role === 'student' ? (' student-shell' + (UI.studentSidebarCollapsed ? ' is-collapsed' : '') + (UI.studentMenuOpen ? ' is-mobile-open' : '')) : ''}">
      <nav class="rail${role === 'student' ? ' student-rail' : ''}" ${role === 'student' ? 'id="student-navigation"' : ''} aria-label="Bölmələr">
        ${role === 'student' ? `<div class="student-rail-header">
          <span class="student-rail-symbol" aria-hidden="true">${studentNavIcon('dashboard')}</span>
          <span class="student-rail-identity"><b>Karyera menyusu</b><small>ADNSU tələbə kabineti</small></span>
          <button type="button" class="student-rail-collapse" data-act="student-sidebar-collapse" aria-label="${UI.studentSidebarCollapsed ? 'Menyunu genişləndir' : 'Menyunu yığ'}" aria-expanded="${!UI.studentSidebarCollapsed}" title="${UI.studentSidebarCollapsed ? 'Menyunu genişləndir' : 'Menyunu yığ'}">${studentNavIcon('panel')}</button>
          <button type="button" class="student-rail-close" data-act="student-menu-close" aria-label="Menyunu bağla">${studentNavIcon('close')}</button>
        </div>` : ''}
        ${NAV[role].map(item => item.group
          ? `<div class="rail-group" title="${esc(item.group)}"><span>${esc(item.group)}</span></div>`
          : `<a href="#${item.id}" data-act="go" data-view="${item.id}" title="${esc(item.label)}" aria-label="${esc(item.label)}" ${view === item.id ? 'aria-current="page"' : ''}>
              <span class="ico" aria-hidden="true">${role === 'student' ? studentNavIcon(item.id) : item.ico}</span><span class="nav-label">${esc(item.label)}</span>
              ${navCounts(role, item.id) ? `<span class="count">${navCounts(role, item.id)}</span>` : ''}
            </a>`).join('')}
      </nav>
      ${role === 'student' ? '<button type="button" class="student-rail-backdrop" data-act="student-menu-close" aria-label="Menyunu bağla"></button>' : ''}

      <main class="main" id="main">
        ${pendingCo ? `<div class="note warn" style="margin-bottom:18px"><span class="m">!</span>
          <span><b>Hesabınız Karyera Mərkəzinin təsdiqini gözləyir.</b>
          Namizədləri görə və vakansiya hazırlaya bilərsiniz, lakin elanlar təsdiqdən
          sonra tələbələrə görünəcək.</span></div>` : ''}
        ${role === 'student' && user.status === 'pending' ? `<div class="note warn" style="margin-bottom:18px"><span class="m">!</span>
          <span><b>Məzun hesabınız təsdiq gözləyir.</b> Vakansiya və tədbirləri görə bilərsiniz;
          müraciət və paylaşım funksiyaları Karyera Mərkəzi təsdiqindən sonra açılacaq.</span></div>` : ''}
        ${role === 'student' && st.student && !st.student.faculty ? `
          <div class="note bad" style="margin-bottom:18px"><span class="m">!</span>
          <span><b>Fakültə və ixtisasınız seçilməyib.</b> Uyğunluq faizi bunlar olmadan
          hesablana bilmir — bütün elanlar aşağı faizlə görünəcək.
          <button class="linkbtn" data-act="go" data-view="profile"
            style="margin-left:4px">Profildə tamamlayın →</button></span></div>` : ''}
        ${VIEWS[role][view]()}
        <footer class="foot">
          <span>ASOIU Karyera Mərkəzi · Career Center</span>
          <span>·</span>
          <span>${esc(user.email)} kimi daxil olmusunuz</span>
        </footer>
      </main>
    </div>

    <div class="modal-back" id="modal" hidden></div>
    <div class="toast" id="toast" hidden></div>`;
}

/* ================================================================ *
 * Hadisələr
 * ================================================================ */
let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.innerHTML = `<span>✓</span><span>${esc(msg)}</span>`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

function openModal(html) {
  const m = document.getElementById('modal');
  m.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  m.hidden = false;
}
function closeModal() {
  const m = document.getElementById('modal');
  if (m) { m.hidden = true; m.innerHTML = ''; }
}

function jobDetailModal(id) {
  const job = Store.jobById(id);
  if (!job) return;
  const c = companyOf(job.companyId);
  const r = matchReport(job, Store.state.student);
  const aiResult = UI.aiJobResults[String(job.id)];
  openModal(`
    <div class="modal-head">
      <div class="brandbox${companyLogoClass(c.name)}">${companyMark(c.name)}</div>
      <div style="flex:1;min-width:0">
        <span class="badge-type ${typeClass(job.type)}">${esc(job.type)}</span>
        <h2 style="margin-top:7px">${esc(job.title)}</h2>
        <div style="color:var(--muted);font-size:12.5px">${esc(c.name)} · ${esc(job.location)} · ${esc(job.mode)}</div>
      </div>
      <button class="icon-btn" data-act="close-modal" aria-label="Bağla">×</button>
    </div>

    <div class="card quiet" style="margin-bottom:16px">
      ${meterHTML(r, { lg: true, key: true })}
      <div style="margin-top:12px">
        <div class="eyebrow">Niyə uyğundur?</div>
        <div style="margin-top:6px;font-size:12px;color:var(--ink-2)">${r.reasons.map(esc).join(' · ')}</div>
      </div>
      <div style="margin-top:12px">
        <div class="eyebrow">Nə çatışmır?</div>
        <div class="skillrow" style="margin-top:6px">${r.missing.length
          ? r.missing.map(x => `<span class="sk gap">${esc(x)}</span>`).join('')
          : '<span class="chip good">Əsas açar sözlər tamdır</span>'}</div>
      </div>
      <button class="btn sm" style="margin-top:14px" data-act="job-ai-explain" data-id="${job.id}"
        ${UI.aiJobBusy === String(job.id) ? 'disabled' : ''}>${UI.aiJobBusy === String(job.id) ? 'AI təhlil edir…' : 'AI ilə dərin izah et'}</button>
      ${aiResult ? `<div class="ai-panel" style="margin-top:12px">${renderAIResult(aiResult)}</div>` : ''}
    </div>

    <p style="margin:0 0 16px;color:var(--ink-2)">${esc(job.summary)}</p>

    <dl class="kv" style="margin-bottom:16px">
      <dt>Müddət</dt><dd>${esc(job.duration)}</dd>
      <dt>Təqaüd</dt><dd>${esc(job.pay)}</dd>
      <dt>Son tarix</dt><dd>${fmtDate(job.deadline)}</dd>
      <dt>Minimum kurs</dt><dd>${job.minCourse}. kurs</dd>
      <dt>Minimum GPA</dt><dd>${job.minGPA || '—'}</dd>
    </dl>

    <div class="eyebrow" style="margin-bottom:7px">Vəzifə öhdəlikləri</div>
    <ul style="margin:0 0 16px;padding-left:18px;font-size:13px;color:var(--ink-2)">
      ${job.duties.map(d => `<li>${esc(d)}</li>`).join('')}
    </ul>

    <div class="eyebrow" style="margin-bottom:7px">Tələblər</div>
    <ul style="margin:0 0 16px;padding-left:18px;font-size:13px;color:var(--ink-2)">
      ${job.requirements.map(d => `<li>${esc(d)}</li>`).join('')}
    </ul>

    <div class="eyebrow" style="margin-bottom:7px">Bacarıqlar</div>
    <div class="skillrow" style="margin-bottom:18px">
      ${job.skills.map(s => `<span class="sk ${r.matched.includes(s) ? 'hit' : 'gap'}">${r.matched.includes(s) ? '✓ ' : ''}${esc(s)}</span>`).join('')}
    </div>

    ${r.blockers.length ? `<div class="note warn" style="margin-bottom:14px"><span class="m">!</span>
      <span>${r.blockers.map(esc).join(' · ')} — müraciət edə bilərsiniz, amma şərtlər tam ödənmir.</span></div>` : ''}

    <div class="row">
      ${Store.isApplied(job.id) ? '<span class="chip good">✓ Müraciət edilib</span>'
        : `<button class="btn primary" data-act="apply" data-id="${job.id}">Müraciət et</button>`}
      <button class="btn" data-act="close-modal">Bağla</button>
    </div>`);
}

function applyModal(id) {
  const job = Store.jobById(id);
  if (!job) return;
  const s = Store.state.student;
  const c = companyOf(job.companyId);
  const r = matchReport(job, s);
  openModal(`
    <div class="modal-head">
      <div style="flex:1">
        <div class="eyebrow">Sürətli müraciət</div>
        <h2 style="margin-top:6px">${esc(job.title)}</h2>
        <div style="color:var(--muted);font-size:12.5px">${esc(c.name)}</div>
      </div>
      <button class="icon-btn" data-act="close-modal" aria-label="Bağla">×</button>
    </div>
    <div class="card quiet" style="margin-bottom:16px">${meterHTML(r, { lg: true, key: true })}</div>
    <dl class="kv" style="margin-bottom:16px">
      <dt>Ad və soyad</dt><dd>${esc(s.name)}</dd>
      <dt>E-poçt</dt><dd>${esc(s.email)}</dd>
      <dt>İxtisas</dt><dd>${esc(s.major)} · ${esc(s.course)}. kurs</dd>
      <dt>CV</dt><dd>Profildən avtomatik qurulmuş CV</dd>
    </dl>
    <div class="field" style="margin-bottom:16px">
      <label for="apply-note">Motivasiya qeydi (istəyə bağlı)</label>
      <textarea id="apply-note" placeholder="Niyə bu vəzifəyə uyğun olduğunuzu 2–3 cümlə ilə yazın."></textarea>
    </div>
    <div class="row">
      <button class="btn primary" data-act="apply-confirm" data-id="${job.id}">Müraciəti göndər →</button>
      <button class="btn" data-act="close-modal">İmtina</button>
    </div>
    <p style="color:var(--muted);font-size:11px;margin:14px 0 0">
      Müraciət təsdiqləndikdən sonra şirkətin namizəd panelində görünəcək.
    </p>`);
}

function setTheme(t) {
  UI.theme = t;
  if (t) document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
  try { localStorage.setItem('asoiu-theme', t || ''); } catch (e) { /* ignore */ }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && UI.studentMenuOpen) {
    UI.studentMenuOpen = false;
    render();
    document.querySelector('.student-menu-trigger')?.focus();
  }
});

document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  const S = Store.state;

  const rerender = () => render();

  switch (act) {
    case 'student-sidebar-collapse': {
      e.preventDefault();
      UI.studentSidebarCollapsed = !UI.studentSidebarCollapsed;
      try { localStorage.setItem('asoiu-student-rail-compact', UI.studentSidebarCollapsed ? '1' : '0'); } catch (error) { /* storage may be disabled */ }
      rerender();
      break;
    }
    case 'student-menu': {
      e.preventDefault();
      UI.studentMenuOpen = !UI.studentMenuOpen;
      rerender();
      if (UI.studentMenuOpen) document.querySelector('.student-rail a[data-act="go"]')?.focus();
      break;
    }
    case 'student-menu-close': {
      e.preventDefault();
      UI.studentMenuOpen = false;
      rerender();
      document.querySelector('.student-menu-trigger')?.focus();
      break;
    }
    case 'home':
      e.preventDefault();
      UI.publicView = 'landing';
      Landing.detail = null;
      Landing.load().then(rerender);
      rerender();
      window.scrollTo(0, 0);
      break;
    case 'notifications-toggle':
      UI.notificationsOpen = !UI.notificationsOpen;
      UI.userMenu = false;
      rerender();
      break;
    case 'notification-open': {
      const item = (S.notifications || []).find(row => row.id === t.dataset.id);
      if (!item) break;
      item.readAt = item.readAt || new Date().toISOString();
      UI.notificationsOpen = false;
      const role = Auth.role();
      if (item.link && VIEWS[role] && VIEWS[role][item.link]) S.view = item.link;
      rerender();
      if (Store.mode === 'supabase') Backend.markNotificationRead(item).then(result => {
        if (!result.ok) refreshNotifications(false);
      });
      break;
    }
    case 'notifications-read-all': {
      const items = S.notifications || [];
      const unreadItems = items.filter(item => !item.readAt).map(item => ({ ...item }));
      const now = new Date().toISOString();
      items.forEach(item => { if (!item.readAt) item.readAt = now; });
      rerender();
      if (Store.mode === 'supabase') Backend.markAllNotificationsRead(unreadItems).then(result => {
        if (!result.ok) { toast(result.error || 'Bildirişlər yenilənmədi'); refreshNotifications(false); }
      });
      break;
    }
    case 'go': {
      e.preventDefault(); UI.userMenu = false; UI.notificationsOpen = false; UI.pwMsg = null; UI.studentMenuOpen = false;
      S.view = t.dataset.view; Store.save(); rerender(); window.scrollTo(0, 0);
      /* Şəbəkə və güzəştlər serverdən gəlir — ilk açılışda yüklənir. */
      if (S.view === 'network'  && UI.feed === null)     loadFeed();
      if (S.view === 'benefits' && UI.benefits === null) loadBenefits();
      break;
    }
    case 'theme': {
      const cur = document.documentElement.getAttribute('data-theme');
      const isDark = cur ? cur === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
      setTheme(isDark ? 'light' : 'dark');
      UI.userMenu = false;
      rerender();
      break;
    }
    /* ---------------- Şəbəkə ---------------- */
    case 'feed-reload': UI.feed = null; rerender(); loadFeed(); break;
    case 'feed-filter': UI.feedFilter = t.dataset.filter || 'all'; rerender(); break;
    case 'post-create': {
      const body = UI.postDraft.trim();
      if (body.length < 2) break;
      const post = {
        body,
        kind: UI.postKind,
        linkUrl: UI.postLink.trim(),
        tags: [...new Set((body.match(/#[\p{L}\p{N}_-]+/gu) || []).map(x => x.slice(1).toLocaleLowerCase('az-AZ')))].slice(0, 8)
      };
      UI.postDraft = ''; UI.postLink = ''; UI.postKind = 'general';
      Backend.createPost(post).then(res => {
        if (!res.ok) { toast(res.error || 'Paylaşım alınmadı'); return; }
        toast('Paylaşıldı'); loadFeed();
      });
      rerender();
      break;
    }
    case 'post-delete':
      if (UI.feed) UI.feed = UI.feed.filter(p => p.id !== t.dataset.id);
      rerender();
      Backend.deletePost(t.dataset.id).then(res => {
        if (!res.ok) { toast(res.error || 'Silinmədi'); loadFeed(); } else toast('Paylaşım silindi');
      });
      break;
    case 'post-like': {
      const on = t.dataset.on === '1';
      const p = UI.feed && UI.feed.find(x => x.id === t.dataset.id);
      if (p) { p.likedByMe = on; p.likes += on ? 1 : -1; rerender(); }
      Backend.toggleLike(t.dataset.id, on).then(res => { if (!res.ok) loadFeed(); });
      break;
    }
    case 'post-save': {
      const on = t.dataset.on === '1';
      const p = UI.feed && UI.feed.find(x => x.id === t.dataset.id);
      if (p) { p.savedByMe = on; rerender(); }
      Backend.togglePostSave(t.dataset.id, on).then(res => {
        if (!res.ok) { toast(res.error || 'Saxlanılmadı'); loadFeed(); }
        else toast(on ? 'Paylaşım saxlanıldı' : 'Saxlanılanlardan çıxarıldı');
      });
      break;
    }
    case 'post-report':
      Backend.reportPost(t.dataset.id, 'Uyğunsuz və ya yanlış məzmun').then(res => {
        toast(res.ok ? 'Şikayət moderasiyaya göndərildi' : (res.error || 'Şikayət göndərilmədi'));
      });
      break;
    case 'post-comments':
      UI.openComments = UI.openComments === t.dataset.id ? null : t.dataset.id;
      rerender(); break;
    case 'comment-send': {
      const el = document.getElementById('comment-' + t.dataset.id);
      const body = el ? el.value.trim() : '';
      if (!body) break;
      el.value = '';
      Backend.addComment(t.dataset.id, body).then(res => {
        if (!res.ok) { toast(res.error || 'Şərh əlavə olunmadı'); return; }
        loadFeed();
      });
      break;
    }

    /* ---------------- Güzəştlər ---------------- */
    case 'benefit-cat': UI.benefitCat = t.dataset.cat; rerender(); break;
    case 'benefit-claim':
      Backend.claimBenefit(t.dataset.id).then(res => {
        if (!res.ok) { toast(res.error || 'Güzəşt alınmadı'); return; }
        toast('Güzəşt kodunuz hazırdır'); loadBenefits();
      });
      break;
    case 'benefit-qr':
      showQR(t.dataset.code, t.dataset.title, t.dataset.partner);
      break;
    case 'redeem-go': {
      const el = document.getElementById('redeem-code');
      const code = el ? el.value.trim() : '';
      if (!code) { toast('Kodu daxil edin'); break; }
      Backend.redeemCode(code).then(res => {
        if (!res.ok) { toast(res.error || 'Yoxlama alınmadı'); return; }
        UI.redeemResult = res.row;
        rerender();
      });
      break;
    }

    /* ---------------- Autentifikasiya ---------------- */
    case 'user-menu': UI.userMenu = !UI.userMenu; rerender(); break;
    case 'logout':
      stopNotificationUpdates();
      try {
        localStorage.removeItem('asoiu-cv-profile-data');
        localStorage.removeItem('asoiu-cv-builder-draft');
      } catch (e) { /* yaddaş bağlıdırsa davam et */ }
      Auth.logout(); UI.userMenu = false; UI.cvText = ''; UI.pwMsg = null;
      resetAuthForm(); UI.publicView = 'landing';
      Landing.detail = null;
      Landing.load().then(rerender);
      rerender(); toast('Sistemdən çıxdınız');
      break;
    case 'auth-tab':
      captureAuthForm();
      UI.auth.tab = t.dataset.tab; UI.auth.error = '';
      UI.auth.password = ''; UI.auth.password2 = '';
      rerender(); break;
    case 'auth-account':
      UI.auth.intent = t.dataset.account;
      UI.auth.role = t.dataset.account === 'company' ? 'company' : 'student';
      UI.auth.error = '';
      if (t.dataset.account === 'learner') UI.auth.faculty = UI.auth.faculty || Object.keys(FACULTIES)[0];
      rerender(); break;
    case 'auth-account-back':
      captureAuthForm(); UI.auth.intent = ''; UI.auth.error = ''; rerender(); break;
    case 'auth-education-level':
      captureAuthForm();
      UI.auth.educationLevel = t.value;
      UI.auth.role = t.value === 'master' ? 'master_student' : t.value === 'graduate' ? 'alumni' : 'student';
      UI.auth.course = t.value === 'graduate' ? 4 : 1;
      rerender(); break;
    case 'auth-role':
      captureAuthForm();
      UI.auth.role = t.dataset.role; UI.auth.error = '';
      if (['student', 'master_student', 'alumni'].includes(t.dataset.role)) {
        UI.auth.faculty = UI.auth.faculty || Object.keys(FACULTIES)[0];
      }
      rerender(); break;
    case 'auth-plan':
      captureAuthForm(); UI.auth.plan = t.dataset.plan || 'free'; rerender(); break;
    case 'google': {
      UI.auth.busy = true; UI.auth.error = ''; rerender();
      Backend.signInWithGoogle().then(res => {
        /* Uğurlu halda səhifə Google-a yönləndirilir və bura qayıtmır. */
        if (!res.ok) { UI.auth.busy = false; UI.auth.error = res.error; rerender(); }
      });
      break;
    }
    case 'azure': {
      UI.auth.busy = true; UI.auth.error = ''; rerender();
      Backend.signInWithAzure().then(res => {
        if (!res.ok) { UI.auth.busy = false; UI.auth.error = res.error; rerender(); }
      });
      break;
    }
    case 'magic-link': {
      captureAuthForm();
      if (!UI.auth.email) { UI.auth.error = 'Universitet e-poçtunuzu yazın.'; rerender(); break; }
      UI.auth.busy = true; UI.auth.error = ''; rerender();
      Backend.signInWithMagicLink(UI.auth.email).then(res => {
        UI.auth.busy = false;
        if (res.ok) UI.auth.notice = 'Təhlükəsiz giriş linki universitet e-poçtunuza göndərildi.';
        else UI.auth.error = res.error;
        rerender();
      });
      break;
    }
    case 'pw-toggle': {
      const inp = document.getElementById(t.dataset.for);
      if (!inp) break;
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      t.setAttribute('aria-pressed', String(show));
      t.setAttribute('aria-label', show ? 'Şifrəni gizlət' : 'Şifrəni göstər');
      inp.focus();
      break;
    }
    case 'resend-confirm': {
      captureAuthForm();
      const em = UI.auth.email;
      if (!em) { toast('Əvvəlcə e-poçt ünvanınızı yazın'); break; }
      Backend.resendConfirmation(em).then(res => {
        if (res.ok) { UI.auth.notice = `Təsdiq linki ${em} ünvanına yenidən göndərildi.`; UI.auth.error = ''; }
        else { UI.auth.error = res.error; UI.auth.notice = ''; }
        rerender();
      });
      break;
    }
    case 'forgot':
      openModal(`<div class="modal-head"><div style="flex:1">
          <div class="eyebrow">Şifrənin bərpası</div>
          <h2 style="margin-top:6px">Şifrəni unutmusunuz?</h2></div>
          <button class="icon-btn" data-act="close-modal" aria-label="Bağla">×</button></div>
        <p style="color:var(--ink-2);margin:0 0 14px">Hesabınıza bağlı e-poçtu yazın. Təhlükəsiz şifrə yeniləmə linki həmin ünvana göndəriləcək.</p>
        <div class="field"><label for="reset-email">E-poçt</label><input id="reset-email" type="email" value="${esc(UI.auth.email)}" placeholder="ad.soyad@asoiu.edu.az"></div>
        <div class="row" style="margin-top:18px"><button class="btn primary" data-act="reset-password">Linki göndər</button><button class="btn" data-act="close-modal">Bağla</button></div>`);
      break;
    case 'reset-password': {
      const email = (document.getElementById('reset-email') || {}).value || '';
      if (!email) { toast('E-poçt ünvanını yazın'); break; }
      Backend.resetPassword(email).then(res => {
        if (!res.ok) { toast(res.error || 'Link göndərilmədi'); return; }
        closeModal(); toast('Şifrə yeniləmə linki göndərildi');
      });
      break;
    }
    case 'change-password': {
      const g = id => (document.getElementById(id) || {}).value || '';
      Auth.changePassword(g('pw-cur'), g('pw-new'), g('pw-new2')).then(res => {
        UI.pwMsg = res.ok
          ? { tone: 'good', text: 'Şifrəniz yeniləndi.' }
          : { tone: 'bad', text: res.error };
        rerender();
        if (res.ok) toast('Şifrə yeniləndi');
      });
      break;
    }
    case 'account-approve':
      Auth.setCompanyStatus(t.dataset.uid, 'active'); rerender(); toast('Şirkət hesabı təsdiqləndi'); break;
    case 'account-reject':
      Auth.setCompanyStatus(t.dataset.uid, 'rejected'); rerender(); toast('Şirkət hesabına imtina verildi'); break;

    /* Elanlar */
    case 'job-detail': jobDetailModal(t.dataset.id); break;
    case 'job-ai-explain': {
      const job = Store.jobById(t.dataset.id);
      if (!job) break;
      const student = S.student;
      const report = matchReport(job, student);
      UI.aiJobBusy = String(job.id);
      jobDetailModal(job.id);
      CareerAI.jobMatch({
        faculty: student.faculty,
        major: student.major,
        skills: student.skills,
        summary: student.summary,
        experience: student.experience
      }, job, report).then(res => {
        UI.aiJobBusy = null;
        if (res.ok) {
          UI.aiJobResults[String(job.id)] = res.result;
          toast('AI uyğunluq izahı hazırdır');
        } else {
          toast('AI xidməti əlçatan deyil — şəffaf 40/40/20 hesabatı göstərilir');
        }
        jobDetailModal(job.id);
      });
      break;
    }
    case 'apply': applyModal(t.dataset.id); break;
    case 'apply-confirm': {
      const note = document.getElementById('apply-note');
      Store.apply(t.dataset.id, note ? note.value.trim() : '');
      closeModal(); rerender();
      toast('Müraciətiniz göndərildi');
      break;
    }
    case 'withdraw': Store.withdraw(t.dataset.id); rerender(); toast('Müraciət geri götürüldü'); break;
    case 'save': Store.toggleSave(t.dataset.id); rerender(); break;
    case 'close-modal': closeModal(); break;

    /* Filtrlər */
    case 'filter-type': UI.jobFilter.type = t.dataset.type; rerender(); break;
    case 'filter-saved': UI.jobFilter.savedOnly = !UI.jobFilter.savedOnly; rerender(); break;

    /* Profil bacarıqları */
    case 'skill-add':
      if (!S.student.skills.includes(t.dataset.skill)) S.student.skills.push(t.dataset.skill);
      Store.save(); Store.pushProfile(); rerender(); break;
    case 'skill-remove':
      S.student.skills = S.student.skills.filter(x => x !== t.dataset.skill);
      Store.save(); Store.pushProfile(); rerender(); break;
    case 'education-open':
      educationModal(); break;
    case 'education-save': {
      const g = id => (document.getElementById(id) || {}).value || '';
      const entry = {
        id: 'local-' + Date.now().toString(36),
        degreeType: g('edu-degree'), university: g('edu-uni').trim(),
        faculty: g('edu-faculty').trim(), specialty: g('edu-specialty').trim(),
        specialization: g('edu-specialization').trim(), group: g('edu-group').trim(),
        startYear: Number(g('edu-start')) || null, graduationYear: Number(g('edu-grad')) || null,
        isCurrent: !!document.getElementById('edu-current')?.checked, verified: false
      };
      if (!entry.university || !entry.specialty) { toast('Universitet və ixtisası yazın'); break; }
      const finish = row => {
        if (row?.id) entry.id = row.id;
        S.student.education = [...(S.student.education || []), entry];
        closeModal(); Store.save(); rerender(); toast('Təhsil əlavə edildi');
      };
      if (Store.mode === 'supabase') {
        Backend.addEducation({
          degree_type: entry.degreeType, university: entry.university, faculty: entry.faculty,
          specialty: entry.specialty, specialization: entry.specialization,
          group_name: entry.group, start_year: entry.startYear, graduation_year: entry.graduationYear,
          is_current: entry.isCurrent
        }).then(res => res.ok ? finish(res.row) : toast(res.error || 'Təhsil əlavə edilmədi'));
      } else finish();
      break;
    }
    case 'education-delete': {
      const remove = () => {
        S.student.education = (S.student.education || []).filter(e => String(e.id) !== String(t.dataset.id));
        Store.save(); rerender(); toast('Təhsil qeydi silindi');
      };
      if (Store.mode === 'supabase') Backend.deleteEducation(t.dataset.id).then(res => res.ok ? remove() : toast(res.error));
      else remove();
      break;
    }

    /* CV */
    case 'cv-tab': UI.cvTab = t.dataset.tab; rerender(); window.scrollTo(0, 0); break;
    case 'cv-print': window.print(); break;
    case 'cv-analyze-now': {
      UI.cvTab = 'analyze';
      const text = UI.cvText || cvToText(buildCVFromProfile(S.student));
      const analysis = analyzeCV(text);
      if (Store.mode === 'supabase') {
        Backend.saveCVAnalysis({ score: analysis.score }).then(res => {
          if (!res.ok) console.warn('CV nəticəsi saxlanmadı:', res.error);
        });
      }
      rerender(); window.scrollTo(0, 0); break;
    }
    case 'cv-use-profile':
      UI.cvText = cvToText(buildCVFromProfile(S.student)); rerender();
      toast('Profil məlumatları yükləndi'); break;
    case 'cv-ai-analyze': {
      const text = UI.cvText || cvToText(buildCVFromProfile(S.student));
      if (text.trim().length < 80) { toast('AI analizi üçün CV mətnini tamamlayın'); break; }
      UI.aiBusy = true; UI.aiCvResult = null; rerender();
      CareerAI.cvAnalyze(text, UI.compareJob ? Store.jobById(UI.compareJob) : null).then(res => {
        UI.aiBusy = false;
        if (!res.ok) { toast(res.error || 'AI xidməti müvəqqəti əlçatan deyil'); rerender(); return; }
        UI.aiCvResult = res.result;
        if (Store.mode === 'supabase') {
          const score = analyzeCV(text).score;
          Backend.saveCVAnalysis({ title: 'AI CV analizi', score, feedback: res.result }).then(saved => {
            if (!saved.ok) console.warn('AI CV nəticəsi saxlanmadı:', saved.error);
          });
        }
        rerender(); toast('AI analizi tamamlandı');
      });
      break;
    }
    case 'cv-add-exp': {
      const g = id => (document.getElementById(id) || {}).value || '';
      if (!g('x-role')) { toast('Vəzifə adını yazın'); break; }
      S.student.experience.push({ role: g('x-role'), org: g('x-org'), period: g('x-period'), detail: g('x-detail') });
      Store.save(); rerender(); toast('Təcrübə əlavə edildi'); break;
    }
    case 'cv-add-proj': {
      const g = id => (document.getElementById(id) || {}).value || '';
      if (!g('x-pname')) { toast('Layihə adını yazın'); break; }
      S.student.projects.push({ name: g('x-pname'), detail: g('x-pdetail') });
      Store.save(); rerender(); toast('Layihə əlavə edildi'); break;
    }

    /* Müsahibə */
    case 'iv-start': {
      const g = id => (document.getElementById(id) || {}).value || '';
      const field = MAJOR_FIELD[S.student.major] || 'mexanika';
      const count = Number(g('iv-count')) || 6;
      const context = {
        companyId: g('iv-company'), company: companyOf(g('iv-company')).name,
        role: g('iv-role'), type: g('iv-type'), count,
        major: S.student.major, faculty: S.student.faculty, skills: S.student.skills,
        description: g('iv-description')
      };
      const qs = buildInterview({ type: context.type, field, count });
      Store.setInterview({ ...context, questions: qs, answers: new Array(qs.length).fill(''), done: false, aiLoading: true });
      rerender(); window.scrollTo(0, 0);
      CareerAI.interviewQuestions(context).then(res => {
        const iv = Store.state.interview;
        if (!iv || iv.done) return;
        iv.aiLoading = false;
        if (res.ok && Array.isArray(res.result?.questions) && res.result.questions.length) {
          iv.questions = res.result.questions.slice(0, count).map((item, i) => typeof item === 'string'
            ? { q: item, hint: 'Cavabı konkret nümunə və nəticə ilə əsaslandırın.', group: context.type }
            : { q: item.question || item.q || `Sual ${i + 1}`, hint: item.hint || 'Konkret nümunə göstərin.', group: item.category || item.group || context.type });
          iv.answers = new Array(iv.questions.length).fill('');
          Store.save(); render(); toast('Suallar ixtisas və vakansiyaya uyğunlaşdırıldı');
        } else Store.save();
      });
      break;
    }
    case 'iv-cancel': Store.setInterview(null); rerender(); break;
    case 'iv-finish': {
      const iv = S.interview;
      iv.result = scoreInterview(iv.questions, iv.answers, S.student.skills);
      iv.done = true; iv.aiLoading = true; Store.save(); rerender(); window.scrollTo(0, 0);
      toast(`Nəticə: ${iv.result.total}/100`);
      CareerAI.interviewEvaluate({
        major: S.student.major, faculty: S.student.faculty, role: iv.role, type: iv.type,
        questions: iv.questions, answers: iv.answers, deterministicResult: iv.result
      }).then(res => {
        if (!S.interview) return;
        S.interview.aiLoading = false;
        if (res.ok) S.interview.aiResult = res.result;
        Store.save();
        if (Store.mode === 'supabase') {
          Backend.saveInterviewSession({ ...S.interview, major: S.student.major }).then(saved => {
            if (!saved.ok) console.warn('Müsahibə nəticəsi saxlanmadı:', saved.error);
          });
        }
        render();
      });
      break;
    }
    case 'iv-review': S.interview.done = false; Store.save(); rerender(); window.scrollTo(0, 0); break;
    case 'iv-new': Store.setInterview(null); rerender(); break;

    /* Tədbirlər */
    case 'event-reg':
      if (!S.eventRegistrations.includes(t.dataset.id)) S.eventRegistrations.push(t.dataset.id);
      Store.save(); Store.remote(() => Backend.registerForEvent(t.dataset.id));
      rerender(); toast('Qeydiyyat tamamlandı'); break;

    /* Şirkət */
    case 'plan-select':
      Backend.selectCompanyPlan(t.dataset.plan).then(res => {
        if (!res.ok) { toast(res.error || 'Paket sorğusu göndərilmədi'); return; }
        Store.state.subscription = { plan_id: t.dataset.plan, status: t.dataset.plan === 'free' ? 'active' : 'pending', plans: { slug: t.dataset.plan } };
        rerender(); toast(t.dataset.plan === 'free' ? 'Free paket aktivdir' : 'Paket sorğusu adminə göndərildi');
      });
      break;
    case 'v-create': {
      const g = id => (document.getElementById(id) || {}).value || '';
      if (!g('v-title')) { toast('Vəzifə adını yazın'); break; }
      const majors = [...(document.getElementById('v-majors') || { selectedOptions: [] }).selectedOptions].map(o => o.value);

      if (Store.mode === 'supabase') {
        const tax = Store.tax;
        Backend.createJob({
          company_id: S.company.id,
          title: g('v-title'),
          type: Adapt.jobTypeToDb(g('v-type')),
          mode: g('v-mode'),
          location: g('v-location') || 'Bakı',
          deadline: g('v-deadline') || '2026-12-31',
          duration: g('v-duration') || '',
          pay: g('v-pay') || '',
          faculty_ids: [tax.facultyIdByName[g('v-faculty')]].filter(Boolean),
          major_ids: majors.map(m => tax.majorIdByName[m]).filter(Boolean),
          skills: g('v-skills').split(',').map(x => x.trim()).filter(Boolean),
          min_course: Number(g('v-course')) || 1,
          min_gpa: 0,
          summary: g('v-summary') || '',
          department: g('v-department') || '',
          preferred_skills: g('v-preferred-skills').split(',').map(x => x.trim()).filter(Boolean),
          experience_level: g('v-experience') || 'Təcrübə tələb olunmur',
          salary_min: g('v-salary-min') ? Number(g('v-salary-min')) : null,
          salary_max: g('v-salary-max') ? Number(g('v-salary-max')) : null,
          currency: g('v-currency') || 'AZN',
          salary_visible: !!(document.getElementById('v-salary-visible') || {}).checked,
          positions: Number(g('v-positions')) || 1,
          application_method: g('v-application-method') || 'platform',
          application_url: g('v-application-url') || null,
          duties: g('v-duties').split('\n').map(x => x.trim()).filter(Boolean),
          requirements: g('v-requirements').split('\n').map(x => x.trim()).filter(Boolean)
        }).then(res => {
          if (!res.ok) { toast(res.error || 'Elan yaradılmadı'); return; }
          OPPORTUNITIES.push(Adapt.job(res.row, Store.tax,
            COMPANIES.reduce((a, c) => (a[c.id] = c.name, a), {})));
          S.view = 'vacancies'; render();
          toast('Elan Karyera Mərkəzinin təsdiqinə göndərildi');
        });
        break;
      }

      S.customJobs.push({
        id: Store.nextJobId(), companyId: S.company.id, title: g('v-title'), type: g('v-type'),
        mode: g('v-mode'), location: g('v-location') || 'Bakı', deadline: g('v-deadline') || '2026-12-31',
        duration: g('v-duration') || '—', pay: [g('v-salary-min'), g('v-salary-max')].filter(Boolean).join('–') || '—',
        faculties: [g('v-faculty')], majors,
        skills: g('v-skills').split(',').map(x => x.trim()).filter(Boolean),
        minCourse: Number(g('v-course')) || 1, minGPA: 0, status: 'pending',
        postedAt: TODAY.toISOString().slice(0, 10),
        summary: g('v-summary') || 'Təsvir əlavə olunmayıb.', duties: [], requirements: []
      });
      Store.save(); S.view = 'vacancies'; rerender();
      toast('Elan Karyera Mərkəzinin təsdiqinə göndərildi'); break;
    }
    case 'cand-job': S.view = 'candidates'; UI.candJob = t.dataset.id; UI.candMin = 0; rerender(); window.scrollTo(0, 0); break;
    case 'invite':
      S.invites.push({ companyId: S.company.id, studentId: t.dataset.sid, jobId: Number(t.dataset.id),
        at: TODAY.toISOString().slice(0, 10), status: 'Göndərilib' });
      Store.save(); Store.remote(() => Backend.invite(S.company.id, t.dataset.sid, t.dataset.id));
      rerender(); toast('Müsahibə dəvəti göndərildi'); break;
    case 'invite-cancel':
      S.invites = S.invites.filter(i => !(i.companyId === S.company.id
        && i.studentId === t.dataset.sid && String(i.jobId) === String(t.dataset.id)));
      Store.save(); Store.remote(() => Backend.cancelInvite(S.company.id, t.dataset.sid, t.dataset.id));
      rerender(); toast('Dəvət ləğv edildi'); break;

    /* Admin */
    case 'approve':
      S.approvals[t.dataset.id] = 'approved'; Store.save();
      Store.remote(() => Backend.setJobStatus(t.dataset.id, 'approved'));
      rerender(); toast('Elan təsdiqləndi və dərc olundu'); break;
    case 'reject':
      S.approvals[t.dataset.id] = 'rejected'; Store.save();
      Store.remote(() => Backend.setJobStatus(t.dataset.id, 'rejected'));
      rerender(); toast('Elan imtina edildi'); break;
    case 'report-copy': {
      const el = document.getElementById('report-text');
      if (el && navigator.clipboard) {
        navigator.clipboard.writeText(el.textContent).then(
          () => toast('Hesabat panoya kopyalandı'),
          () => toast('Kopyalamaq alınmadı — mətni seçib əl ilə kopyalayın')
        );
      }
      break;
    }
  }
});

/* ================================================================ *
 * Açıq ana səhifənin hadisələri
 * ================================================================ */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-lp]');
  if (!t) return;

  const openDashboard = () => {
    UI.publicView = 'app';
    Landing.menuOpen = false;
    Landing.detail = null;
    if (Auth.isSignedIn()) {
      Store.state.view = 'dashboard';
      Store.save();
      render();
    } else {
      UI.publicView = 'auth';
      UI.auth.tab = 'login';
      render();
    }
    window.scrollTo(0, 0);
  };

  switch (t.dataset.lp) {
    case 'auth':
      if (Auth.isSignedIn()) { openDashboard(); break; }
      UI.publicView = 'auth'; UI.auth.tab = 'login'; render(); window.scrollTo(0, 0); break;
    case 'auth-register':
      if (Auth.isSignedIn()) { openDashboard(); break; }
      UI.publicView = 'auth'; UI.auth.tab = 'register'; render(); window.scrollTo(0, 0); break;
    case 'dashboard': openDashboard(); break;
    case 'home':
      UI.publicView = 'landing'; Landing.detail = null;
      Landing.load().then(render); render(); window.scrollTo(0, 0); break;
    case 'menu': Landing.menuOpen = !Landing.menuOpen; render(); break;
    case 'scroll': {
      Landing.menuOpen = false;
      const el = document.getElementById(t.dataset.to);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else {
        render();
        const next = document.getElementById(t.dataset.to);
        if (next) next.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      break;
    }
    case 'jobfilter':
      Landing.jobFilter = t.dataset.v; render();
      document.getElementById('lp-jobs')?.scrollIntoView({ block: 'start' });
      break;
    case 'job':
      Landing.detail = { type: 'job', id: t.dataset.id }; render(); window.scrollTo(0, 0); break;
    case 'company':
      Landing.detail = { type: 'company', id: t.dataset.id }; render(); window.scrollTo(0, 0); break;
    case 'detail-back':
      Landing.detail = null; render(); window.scrollTo(0, 0); break;
    case 'noop': break;
  }
});

document.addEventListener('submit', e => {
  const form = e.target.closest('[data-lp="search"]');
  if (!form) return;
  e.preventDefault();
  Landing.q = form.querySelector('[data-lp-q]')?.value || '';
  Landing.city = form.querySelector('[data-lp-city]')?.value || '';
  render();
  document.getElementById('lp-jobs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* Modal fonuna klik · istifadəçi menyusundan kənara klik */
document.addEventListener('click', e => {
  if (e.target.id === 'modal') closeModal();
  if (UI.userMenu && !e.target.closest('.usermenu')) { UI.userMenu = false; render(); }
  if (UI.notificationsOpen && !e.target.closest('.notification-center')) { UI.notificationsOpen = false; render(); }
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  closeModal();
  if (UI.userMenu) { UI.userMenu = false; render(); }
  if (UI.notificationsOpen) { UI.notificationsOpen = false; render(); }
});

/* ================================================================ *
 * Giriş / qeydiyyat formaları
 * ================================================================ */

/* ================================================================ *
 * Şəbəkə, güzəştlər və bildirişlərin yüklənməsi
 * Render sinxron qalır: data gələndə UI-ya yazılır və yenidən çəkilir.
 * ================================================================ */
let notificationPollTimer = null;
let knownUnreadNotifications = 0;

async function refreshNotifications(announceNew = false) {
  if (Store.mode !== 'supabase' || !Auth.isSignedIn()) return;
  const result = await Backend.notificationsFeed();
  if (!result.ok) return;
  const nextUnread = result.rows.filter(item => !item.readAt).length;
  const hasNew = announceNew && nextUnread > knownUnreadNotifications;
  Store.state.notifications = result.rows;
  knownUnreadNotifications = nextUnread;
  render();
  if (hasNew) toast('Yeni bildirişiniz var');
}

function startNotificationUpdates() {
  if (Store.mode !== 'supabase' || !Auth.isSignedIn()) return;
  stopNotificationUpdates();
  knownUnreadNotifications = ((Store.state.notifications || []).filter(item => !item.readAt)).length;
  Backend.subscribeNotifications(() => refreshNotifications(true));
  notificationPollTimer = setInterval(() => refreshNotifications(true), 60000);
}

function stopNotificationUpdates() {
  if (notificationPollTimer) clearInterval(notificationPollTimer);
  notificationPollTimer = null;
  Backend.unsubscribeNotifications();
}

function loadFeed() {
  if (Store.mode !== 'supabase') { UI.feed = []; render(); return; }
  Backend.feed().then(res => {
    UI.feed = res.ok ? res.rows : [];
    if (!res.ok && res.error) toast(res.error);
    render();
  });
}

function loadBenefits() {
  if (Store.mode !== 'supabase') { UI.benefits = { rows: [], claims: [], partners: [] }; render(); return; }
  Backend.benefits().then(res => {
    UI.benefits = res.ok ? res : { rows: [], claims: [], partners: [] };
    if (!res.ok && res.error) toast(res.error);
    render();
  });
}

/** QR kodu modal pəncərədə göstərir. Kitabxana cdnjs-dən yüklənir. */
function showQR(code, title, partner) {
  openModal(`
    <div class="modal-head">
      <div style="flex:1">
        <div class="eyebrow">Güzəşt kodu</div>
        <h2 style="margin-top:6px">${esc(title)}</h2>
        <div style="color:var(--muted);font-size:12.5px">${esc(partner)}</div>
      </div>
      <button class="icon-btn" data-act="close-modal" aria-label="Bağla">×</button>
    </div>
    <div class="qr-box"><div id="qr-target">Yüklənir…</div></div>
    <div class="qr-code mono">${esc(code)}</div>
    <p style="color:var(--muted);font-size:12px;text-align:center;margin:12px 0 0">
      Bu kodu məkanda göstərin. Təsdiq bir dəfəlikdir.
    </p>
    <div class="row" style="margin-top:16px"><button class="btn block" data-act="close-modal">Bağla</button></div>`);

  const draw = () => {
    const el = document.getElementById('qr-target');
    if (!el || !window.QRCode) return;
    el.textContent = '';
    new window.QRCode(el, { text: code, width: 190, height: 190, correctLevel: window.QRCode.CorrectLevel.M });
  };
  if (window.QRCode) { draw(); return; }
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
  s.onload = draw;
  s.onerror = () => {
    const el = document.getElementById('qr-target');
    if (el) el.textContent = 'QR şəkli yüklənmədi — aşağıdakı kodu əl ilə göstərin.';
  };
  document.head.appendChild(s);
}

/** İki şifrə sahəsinin uyğunluğunu canlı göstərir (tam render olmadan). */
function paintPasswordMatch() {
  const out = document.getElementById('pw-match');
  if (!out) return;
  const a = (document.getElementById('rg-password') || {}).value || '';
  const b = (document.getElementById('rg-password2') || {}).value || '';
  if (!b) { out.textContent = ''; out.className = 'pw-match'; return; }
  const ok = a === b;
  out.textContent = ok ? '✓ Şifrələr uyğundur' : '× Şifrələr üst-üstə düşmür';
  out.className = 'pw-match ' + (ok ? 'ok' : 'bad');
}

/* Profil/şirkət dəyişiklikləri hər klavişdə deyil, yazma dayandıqdan sonra göndərilir. */
const pushTimers = {};
function schedulePush(what) {
  if (Store.mode !== 'supabase') return;
  clearTimeout(pushTimers[what]);
  pushTimers[what] = setTimeout(() => {
    if (what === 'profile') Store.pushProfile(); else Store.pushCompany();
  }, 700);
}

/** Formadakı cari dəyərləri UI.auth-a köçürür ki, render zamanı itməsin. */
function captureAuthForm() {
  const form = document.querySelector('[data-act="login-form"], [data-act="register-form"]');
  if (!form) return;
  const g = n => { const el = form.elements[n]; return el ? el.value : ''; };
  Object.assign(UI.auth, {
    email: g('email'), password: g('password'), password2: g('password2'),
    name: g('name') || [g('firstName'), g('lastName')].filter(Boolean).join(' '),
    firstName: g('firstName'), lastName: g('lastName'), phone: g('phone'), avatarUrl: g('avatarUrl'),
    contact: g('contact'), contactPosition: g('contactPosition'), contactEmail: g('contactEmail'), contactPhone: g('contactPhone'),
    sector: g('sector'), website: g('website'), companySize: g('companySize'), address: g('address'), logoUrl: g('logoUrl'), description: g('description'),
    faculty: g('faculty') || UI.auth.faculty, major: g('major'),
    course: g('course') || UI.auth.course, groupName: g('groupName'), university: g('university') || UI.auth.university,
    educationLevel: g('educationLevel') || UI.auth.educationLevel,
    bachelorStartYear: g('bachelorStartYear'), bachelorEndYear: g('bachelorEndYear'),
    masterUniversity: g('masterUniversity'), masterFaculty: g('masterFaculty'), masterSpecialty: g('masterSpecialty'),
    masterSpecialization: g('masterSpecialization'), masterGroup: g('masterGroup'),
    masterStartYear: g('masterStartYear'), masterEndYear: g('masterEndYear'),
    plan: UI.auth.plan || 'free'
  });
  UI.auth.role = UI.auth.intent === 'company' ? 'company'
    : UI.auth.educationLevel === 'master' ? 'master_student'
      : UI.auth.educationLevel === 'graduate' ? 'alumni' : 'student';
  const terms = form.elements['terms'];
  if (terms) UI.auth.terms = terms.checked;
}

document.addEventListener('submit', e => {
  const form = e.target;
  const act = form.dataset.act;
  if (act !== 'login-form' && act !== 'register-form') return;
  e.preventDefault();
  if (UI.auth.busy) return;

  captureAuthForm();
  UI.auth.busy = true;
  UI.auth.error = '';
  render();

  const done = res => {
    UI.auth.busy = false;
    if (res.ok) {
      const name = (res.user.name || res.user.email).split(' ')[0];
      resetAuthForm();
      UI.cvText = '';
      UI.publicView = 'app';
      render();
      window.scrollTo(0, 0);
      toast(act === 'login-form' ? `Xoş gəldiniz, ${name}` : 'Hesabınız yaradıldı');
      if (Store.mode === 'supabase') startNotificationUpdates();
    } else if (res.confirmation) {
      /* E-poçt təsdiqi gözlənilir — giriş tabına qaytarırıq. */
      const email = UI.auth.email;
      resetAuthForm({ tab: 'login', email });
      UI.auth.notice = res.error;
      render();
    } else {
      UI.auth.error = res.error;
      render();
      const target = res.field && document.querySelector(`[name="${res.field}"]`);
      if (target) target.focus();
    }
  };

  const remote = Store.mode === 'supabase';

  if (act === 'login-form') {
    (remote ? Auth.loginRemote(UI.auth.email, UI.auth.password)
            : Auth.login(UI.auth.email, UI.auth.password)).then(done);
  } else {
    if (!UI.auth.terms) {
      UI.auth.busy = false;
      UI.auth.error = 'Davam etmək üçün məlumatların emalına razılıq verin.';
      render();
      return;
    }
    (remote ? Auth.registerRemote({ ...UI.auth })
            : Auth.register({ ...UI.auth })).then(done);
  }
});

/* Mətn və seçim sahələri */
document.addEventListener('input', e => {
  const el = e.target;
  const S = Store.state;

  /* Qeydiyyat formasında şifrə gücü — tam render olmadan yenilənir */
  if (el.dataset.act === 'pw-strength') {
    UI.auth.password = el.value;
    const field = el.closest('.field');
    const bars = field && field.querySelector('.pw-meter');
    const label = field && field.querySelector('.pw-label');
    const st = Auth.strength(el.value);
    if (bars) [...bars.children].forEach((b, i) => {
      b.className = el.value && i < st.level ? 'on l' + st.level : '';
    });
    if (label) label.textContent = el.value ? st.label : 'Hərf və rəqəm, ən azı 8 simvol';
    paintPasswordMatch();
    return;
  }
  if (el.dataset.act === 'pw-confirm') {
    UI.auth.password2 = el.value;
    paintPasswordMatch();
    return;
  }
  /* Fakültə dəyişəndə ixtisas siyahısı yenilənməlidir */
  if (el.dataset.act === 'auth-faculty') {
    captureAuthForm();
    UI.auth.faculty = el.value;
    UI.auth.major = (FACULTIES[el.value] || [])[0] || '';
    render();
    return;
  }
  if (el.dataset.act === 'auth-terms') { UI.auth.terms = el.checked; return; }
  if (el.dataset.act === 'auth-education-level') {
    captureAuthForm();
    UI.auth.educationLevel = el.value;
    UI.auth.role = el.value === 'master' ? 'master_student' : el.value === 'graduate' ? 'alumni' : 'student';
    UI.auth.course = el.value === 'graduate' ? 4 : 1;
    render(); return;
  }
  if (el.dataset.act === 'post-body') {
    UI.postDraft = el.value;
    const b = document.querySelector('[data-act="post-create"]');
    if (b) b.disabled = el.value.trim().length < 2;
    return;
  }

  if (el.dataset.bind) {
    S.student[el.dataset.bind] = el.type === 'number' ? Number(el.value) : el.value;
    if (el.dataset.bind === 'faculty') {
      S.student.major = FACULTIES[el.value][0];
      Store.save(); schedulePush('profile'); render(); return;
    }
    Store.save();
    schedulePush('profile');
    /* Uyğunluq paneli dərhal yenilənsin — yalnız seçim sahələrində tam render */
    if (el.tagName === 'SELECT') render();
    return;
  }
  if (el.dataset.cbind) {
    S.company[el.dataset.cbind] = el.value;
    Store.save(); schedulePush('company');
    return;
  }

  switch (el.dataset.act) {
    case 'filter-q': UI.jobFilter.q = el.value; renderKeepFocus('job-q'); break;
    case 'filter-min': UI.jobFilter.min = Number(el.value); render(); break;
    case 'post-body': UI.postDraft = el.value.slice(0, 4000); break;
    case 'post-kind': UI.postKind = el.value; break;
    case 'post-link': UI.postLink = el.value; break;
    case 'cv-text': UI.cvText = el.value; break;
    case 'cmp-job': UI.compareJob = el.value; render(); break;
    case 'cand-select': UI.candJob = el.value; render(); break;
    case 'cand-min': UI.candMin = Number(el.value); render(); break;
    case 'company-app-status': {
      const application = S.applications.find(item => String(item.id) === String(el.dataset.id));
      if (application) {
        application.statusKey = el.value;
        application.status = ({ applied:'Göndərildi',under_review:'Baxılır',shortlisted:'Qısa siyahı',interview:'Müsahibəyə dəvət',offer:'Təklif',rejected:'İmtina',hired:'İşə qəbul' })[el.value] || el.value;
        Backend.setApplicationStatus(application.id, el.value).then(result => { if (!result.ok) toast(result.error || 'Mərhələ yenilənmədi'); else toast('Müraciət mərhələsi yeniləndi'); });
      }
      break;
    }
    case 's-q': UI.search.q = el.value; renderKeepFocus('s-q'); break;
    case 's-fac': UI.search.faculty = el.value; render(); break;
    case 's-course': UI.search.course = Number(el.value); render(); break;
    case 's-gpa': UI.search.minGPA = Number(el.value); render(); break;
    case 'iv-answer': Store.state.interview.answers[Number(el.dataset.i)] = el.value; break;
  }
});

/* Axtarış sahələrində fokus və kursor mövqeyini qoruyur */
function renderKeepFocus(id) {
  const old = document.getElementById(id);
  const pos = old ? old.selectionStart : null;
  render();
  const now = document.getElementById(id);
  if (now) {
    now.focus();
    if (pos !== null) { try { now.setSelectionRange(pos, pos); } catch (e) { /* search input */ } }
  }
}

/* Enter ilə bacarıq əlavəsi */
document.addEventListener('keydown', e => {
  if (e.target.dataset.act === 'skill-input' && e.key === 'Enter') {
    e.preventDefault();
    const v = e.target.value.trim();
    if (v && !Store.state.student.skills.includes(v)) {
      Store.state.student.skills.push(v);
      Store.save(); render(); toast(`«${v}» əlavə edildi`);
    }
  }
});

/* Müsahibə cavabları itməsin — hər dəyişiklikdə saxlanır */
document.addEventListener('change', () => {
  if (Store.state.interview) Store.save();
});

/* ================================================================ *
 * Başlanğıc
 * ================================================================ */
/**
 * Supabase əlçatandırmı? Şəbəkə bloklanıbsa (məs. artifact mühiti) və ya
 * layihə söndürülübsə, offline demo rejiminə keçirik.
 */
async function probeBackend() {
  if (!Backend.available()) return false;
  try {
    const ctrl = new AbortController();
    /* 2.5 saniyə: sağlam bağlantı üçün kifayətdir, zəif bağlantıda isə
       istifadəçini yükləmə ekranında uzun saxlamır — offline rejimə keçirik. */
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/faculties?select=id&limit=1`, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
      signal: ctrl.signal
    });
    clearTimeout(timer);
    return res.ok;
  } catch (e) {
    /* file:// üzərindən açılanda brauzer bu sorğunu bloklayır — bu normaldır,
       platforma offline demo rejimində işləyir. */
    return false;
  }
}

(async function init() {
  try {
    const t = localStorage.getItem('asoiu-theme');
    if (t) document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* ignore */ }

  Store.load();

  /*
   * ÖNƏMLİ: rejim forma istifadəyə açılmazdan ƏVVƏL təyin olunmalıdır.
   * Əks halda qeydiyyat hələ `local` rejimdə gedir, yoxlama bitəndən sonra
   * rejim `supabase`-ə keçir və giriş artıq serverdə axtarılır — hesab
   * "yoxa çıxmış" kimi görünür. Ona görə əvvəlcə yükləmə ekranı göstəririk.
   */
  UI.booting = true;
  render();

  const online = await probeBackend();
  Store.mode = online ? 'supabase' : 'local';
  if (online) UI.providers = await Backend.providers();

  if (online) {
    /* Google-dan qayıdış xətası varsa (məs. universitet hesabı deyil),
       onu ünvandan oxuyub istifadəçiyə göstəririk. */
    const oauthErr = Backend.readOAuthError();
    if (oauthErr) { UI.auth.error = oauthErr; UI.publicView = 'auth'; }
    try {
      await Auth.restoreRemote();          // səhifə yenilənəndə sessiyanı bərpa et
    } catch (e) {
      console.warn('Sessiya bərpası alınmadı:', e);
    }
  } else {
    try {
      await Auth.ensureSeededPasswords();  // offline demo hesablarını hazırla
    } catch (e) {
      console.warn('Şifrə hashlənməsi alınmadı:', e);
    }
    Store.checkPersistence();
  }

  if (Auth.isSignedIn()) {
    UI.publicView = 'app';
  } else if (UI.publicView !== 'auth') {
    try { await Landing.load(); } catch (e) { console.warn('Ana səhifə məlumatları yüklənmədi:', e); }
  }

  UI.booting = false;
  render();
  if (online && Auth.isSignedIn()) startNotificationUpdates();
})();
