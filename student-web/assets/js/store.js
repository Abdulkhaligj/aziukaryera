/*!
 * ADNSU / ASOIU Career v2 — store.js
 * Vəziyyətin saxlanması. Demo rejimində localStorage, real quraşdırmada API.
 *
 * Vəziyyət çoxistifadəçilidir: hesablar `users`, profillər `profiles` /
 * `companyProfiles`, hər istifadəçinin öz məlumatı isə `userData` altında
 * saxlanılır. Giriş edildikdə bind() aktiv istifadəçinin qeydlərini
 * state.student / state.company / state.applications kimi qısayollara bağlayır.
 *
 * Bütün məlumat yalnız istifadəçinin öz brauzerində qalır — heç yerə göndərilmir.
 * Backend qoşarkən yalnız load() / save() funksiyalarını dəyişmək kifayətdir.
 *
 */

const STORAGE_KEY = 'asoiu-career-v2';

/* Aktiv istifadəçiyə bağlanan qısayollar — diskə ayrıca yazılmır. */
const ALIAS_KEYS = ['student', 'company', 'applications', 'saved', 'eventRegistrations', 'interview'];

const SEED_USERS = [
  {
    id: 'u-student-demo', role: 'student', name: 'Aylin Məmmədova',
    email: 'aylin.mammadova@asoiu.edu.az', seedPassword: 'Telebe2026',
    createdAt: '2026-09-01', status: 'active'
  },
  {
    id: 'u-company-demo', role: 'company', name: 'SOCAR',
    email: 'careers@socar.az', seedPassword: 'Sirket2026',
    createdAt: '2026-08-20', status: 'active'
  },
  {
    id: 'u-admin-demo', role: 'admin', name: 'ASOIU Karyera Mərkəzi',
    email: 'career@asoiu.edu.az', seedPassword: 'Merkez2026',
    createdAt: '2026-08-01', status: 'active'
  }
];

const DEFAULT_STATE = {
  session: null,
  view: 'dashboard',
  users: SEED_USERS,

  profiles: {
    'u-student-demo': {
      name: 'Aylin Məmmədova',
      email: 'aylin.mammadova@asoiu.edu.az',
      phone: '+994 50 123 45 67',
      city: 'Bakı, Azərbaycan',
      personalEmail: 'aylin.mammadova@example.com',
      accountStatus: 'student',
      alumniVerified: false,
      faculty: 'Kimya Texnologiyaları Fakültəsi',
      major: 'Kimya mühəndisliyi',
      course: 3,
      startYear: 2023,
      gpa: 88,
      skills: ['Aspen HYSYS', 'Process Simulation', 'AutoCAD', 'Excel', 'Python'],
      languages: 'Azərbaycan (Ana dili), İngilis (B2), Rus (B1)',
      certificates: 'AspenTech Process Simulation (2025), HSE Awareness (2025)',
      summary: 'Neft emalı proseslərinin simulyasiyası və enerji optimallaşdırması üzrə ixtisaslaşan III kurs tələbəsi. Kurs layihəsində distillə kolonunun istilik inteqrasiyası ilə enerji sərfini 14% azaltdım.',
      linkedin: 'linkedin.com/in/aylin-mammadova',
      github: '',
      portfolio: '',
      cvReady: true,
      experience: [
        { role: 'Laboratoriya köməkçisi', org: 'ADNSU Neft-kimya kafedrası', period: '2025 — davam edir', detail: 'Katalizator nümunələrinin hazırlanması və analiz nəticələrinin emalı; 40+ test protokolu sənədləşdirdim.' }
      ],
      projects: [
        { name: 'Distillə kolonunun istilik inteqrasiyası', detail: 'Aspen HYSYS-də pinch analizi ilə istilikdəyişdirici şəbəkəsini yenidən qurdum, enerji sərfini 14% azaltdım.' }
      ],
      education: [{
        id: 'edu-bachelor-demo', degreeType: 'Bachelor', university: 'ADNSU',
        faculty: 'Kimya Texnologiyaları Fakültəsi', specialty: 'Kimya mühəndisliyi',
        specialization: '', group: 'K-321', startYear: 2023, graduationYear: 2027,
        isCurrent: true, verified: true
      }]
    }
  },

  companyProfiles: {
    'u-company-demo': {
      id: 'socar',
      name: 'SOCAR',
      sector: 'Neft və qaz',
      contact: 'Nərmin Əliyeva',
      email: 'careers@socar.az',
      about: 'Azərbaycan Respublikasının Dövlət Neft Şirkəti — hasilat, emal və kimya sənayesi.',
      website: 'socar.az'
    }
  },

  userData: {
    'u-student-demo': {
      applications: [
        { jobId: 2, at: '2026-09-10', status: 'Baxılır', note: '' },
        { jobId: 5, at: '2026-09-08', status: 'Müsahibəyə dəvət', note: 'Müsahibə: 22 Sentyabr, 14:00' }
      ],
      saved: [3, 16],
      eventRegistrations: ['e2'],
      interview: null
    },
    'u-company-demo': { applications: [], saved: [], eventRegistrations: [], interview: null },
    'u-admin-demo':   { applications: [], saved: [], eventRegistrations: [], interview: null }
  },

  customJobs: [],
  notifications: [],
  invites: [
    { companyId: 'socar', studentId: 's2', jobId: 1, at: '2026-09-12', status: 'Göndərilib' }
  ],
  approvals: {}     // jobId → 'approved' | 'rejected'
};

const Store = {
  state: null,

  /**
   * 'supabase' — real backend: sessiya serverdə, data RLS ilə qorunur.
   * 'local'    — offline demo: localStorage + brauzer tərəfli auth.
   * Rejim boot zamanı əlçatanlıq yoxlamasına görə təyin olunur (app.js).
   */
  mode: 'local',
  tax: null,        // fakültə/ixtisas taksonomiyası (Supabase rejimində)

  /* ---------------------------------------------------------------- *
   * Supabase rejimi — serverdən gələn məlumatın yerləşdirilməsi
   * ---------------------------------------------------------------- */

  /**
   * Backend.loadAll() nəticəsini v2-nin gözlədiyi quruluşa çevirib
   * state-ə yerləşdirir. Render kodu bundan sonra sinxron işləyir.
   */
  hydrate(p) {
    const tax = Adapt.taxonomy(p.faculties, p.majors);
    this.tax = tax;

    /* Qlobal taksonomiya obyektlərini serverdən gələnlə əvəz edirik. */
    Object.keys(FACULTIES).forEach(k => delete FACULTIES[k]);
    Object.assign(FACULTIES, tax.tree);
    Object.keys(MAJOR_FIELD).forEach(k => delete MAJOR_FIELD[k]);
    Object.assign(MAJOR_FIELD, tax.fieldOf);

    const companyNameById = {};
    p.companies.forEach(c => { companyNameById[c.id] = c.name; });

    /* Şirkət kataloqu */
    COMPANIES.length = 0;
    p.companies.forEach(c => COMPANIES.push({
      id: c.id, name: c.name, sector: c.sector || '',
      size: '—', city: 'Bakı', about: c.about || '',
      email: c.email || '', contact: c.contact || '', status: c.status
    }));
    Object.keys(COMPANY_BY_ID).forEach(k => delete COMPANY_BY_ID[k]);
    COMPANIES.forEach(c => { COMPANY_BY_ID[c.id] = c; });

    /* Elanlar */
    OPPORTUNITIES.length = 0;
    p.jobs.forEach(j => OPPORTUNITIES.push(Adapt.job(j, tax, companyNameById)));

    /* Tədbirlər */
    EVENTS.length = 0;
    p.events.forEach(e => {
      const d = new Date(e.starts_at);
      EVENTS.push({
        id: e.id, title: e.title, type: e.kind || '',
        date: e.starts_at.slice(0, 10),
        time: d.toISOString().slice(11, 16),
        place: e.place || '', seats: e.seats || 0,
        registered: 0
      });
    });

    /* Sessiya və profil */
    const role = p.profile.role === 'admin' ? 'admin'
               : p.profile.role === 'company' ? 'company' : 'student';

    /* Namizəd bazası yalnız paket hüququ olan şirkətlərə RLS vasitəsilə gəlir.
       Statik demo namizədləri real rejimdə heç vaxt göstərilmir. */
    STUDENT_POOL.length = 0;
    if (role === 'company') (p.candidates || []).forEach(candidate => STUDENT_POOL.push({
      id: candidate.id,
      name: candidate.full_name || 'Namizəd',
      faculty: tax.facultyNameById[candidate.faculty_id] || '',
      major: tax.majorNameById[candidate.major_id] || '',
      course: candidate.course || 1,
      gpa: candidate.gpa == null ? 0 : Number(candidate.gpa),
      skills: candidate.skills || [],
      summary: candidate.summary || '',
      accountStatus: candidate.account_status || 'student'
    }));

    this.state.users = [{
      id: p.uid, role, name: p.profile.full_name || p.email,
      email: p.email, status: p.profile.status,
      createdAt: (p.profile.created_at || '').slice(0, 10)
    }];
    this.state.session = { userId: p.uid, at: new Date().toISOString() };
    const hydratedProfile = Adapt.profileFromDb(p.profile, tax);
    hydratedProfile.education = (p.education || []).map(e => ({
      id: e.id,
      degreeType: e.degree_type,
      university: e.university,
      faculty: e.faculty || '',
      specialty: e.specialty || '',
      specialization: e.specialization || '',
      group: e.group_name || '',
      startYear: e.start_year,
      graduationYear: e.graduation_year,
      isCurrent: !!e.is_current,
      verified: !!e.verified
    }));
    this.state.profiles = { [p.uid]: hydratedProfile };

    const myCompany = p.companies.find(c => c.owner_id === p.uid);
    this.state.companyProfiles = myCompany ? {
      [p.uid]: {
        id: myCompany.id, name: myCompany.name, sector: myCompany.sector || '',
        contact: myCompany.contact || '', email: myCompany.email || '',
        about: myCompany.about || '', website: myCompany.website || ''
      }
    } : {};

    const jobTitleById = {};
    p.jobs.forEach(j => { jobTitleById[j.id] = j.title; });

    this.state.userData = {
      [p.uid]: {
        applications: p.applications
          .filter(a => role === 'company' || a.student_id === p.uid)
          .map(a => Adapt.application(a, jobTitleById)),
        saved: p.saved,
        eventRegistrations: p.eventRegistrations,
        interview: null
      }
    };
    this.state.subscription = p.subscription || null;
    this.state.notifications = Adapt.notifications(p.notifications, p.broadcasts, p.broadcastReads);
    this.state.invites = p.invites.map(i => ({
      companyId: i.company_id, studentId: i.student_id, jobId: i.job_id,
      at: (i.created_at || '').slice(0, 10), status: i.status
    }));
    this.state.customJobs = [];
    this.state.approvals = {};
    this.bind();
  },

  /* ---------------------------------------------------------------- *
   * Yükləmə və saxlama
   * ---------------------------------------------------------------- */

  load() {
    let saved = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) saved = JSON.parse(raw);
    } catch (e) {
      /* Məxfi rejim və ya bloklanmış sayt datası — standart vəziyyətlə davam edirik. */
    }
    this.state = saved
      ? deepMerge(structuredClone(DEFAULT_STATE), saved)
      : structuredClone(DEFAULT_STATE);
    this.bind();
    return this.state;
  },

  save() {
    /* Supabase rejimində həqiqət mənbəyi bazadır — localStorage-ə yazmırıq. */
    if (this.mode === 'supabase') return;
    try {
      const out = {};
      Object.keys(this.state).forEach(k => {
        if (!ALIAS_KEYS.includes(k)) out[k] = this.state[k];
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
    } catch (e) { /* yaddaş əlçatan deyil — sessiya daxilində davam edir */ }
  },

  /**
   * localStorage həqiqətənmi yazılabiləndir? Məxfi rejimdə və ya sayt datası
   * bloklananda yazma səssizcə itir — bu halda offline qeydiyyat səhifə
   * yenilənəndən sonra yox olur, ona görə istifadəçini xəbərdar edirik.
   */
  checkPersistence() {
    try {
      localStorage.setItem(STORAGE_KEY + '-probe', '1');
      localStorage.removeItem(STORAGE_KEY + '-probe');
      this.persistent = true;
    } catch (e) {
      this.persistent = false;
    }
    return this.persistent;
  },

  reset() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    this.state = structuredClone(DEFAULT_STATE);
    this.bind();
    return this.state;
  },

  /**
   * Aktiv istifadəçinin qeydlərini qısayollara bağlayır.
   * Qısayollar eyni obyektə istinad edir, ona görə onların üzərindəki
   * dəyişiklik avtomatik olaraq profiles / userData daxilində də qalır.
   */
  bind() {
    const s = this.state;
    const uid = s.session ? s.session.userId : null;

    if (!uid) {
      ALIAS_KEYS.forEach(k => { s[k] = null; });
      s.applications = [];
      s.saved = [];
      s.eventRegistrations = [];
      return;
    }
    if (!s.userData[uid]) s.userData[uid] = this.newUserData();
    const bucket = s.userData[uid];

    s.student = s.profiles[uid] || null;
    s.company = s.companyProfiles[uid] || null;
    s.applications = bucket.applications;
    s.saved = bucket.saved;
    s.eventRegistrations = bucket.eventRegistrations;
    s.interview = bucket.interview;
  },

  /** Qısayol massivi əvəz olunanda əsl qeydi də yeniləyir. */
  syncBucket(key, value) {
    const uid = this.state.session && this.state.session.userId;
    if (!uid) return;
    this.state[key] = value;
    this.state.userData[uid][key] = value;
  },

  /* ---------------------------------------------------------------- *
   * Yeni qeydlər
   * ---------------------------------------------------------------- */

  newUserData() {
    return { applications: [], saved: [], eventRegistrations: [], interview: null };
  },

  newStudentProfile(p) {
    return {
      name: p.name || '', email: p.email || '', phone: '', city: 'Bakı, Azərbaycan',
      personalEmail: '', accountStatus: 'student', alumniVerified: false,
      faculty: p.faculty || Object.keys(FACULTIES)[0],
      major: p.major || FACULTIES[Object.keys(FACULTIES)[0]][0],
      course: p.course || 1,
      startYear: new Date().getFullYear() - ((p.course || 1) - 1),
      gpa: '', skills: [], languages: 'Azərbaycan (Ana dili)', certificates: '',
      summary: '', linkedin: '', github: '', portfolio: '', cvReady: false,
      experience: [], projects: [],
      education: [{
        id: 'local-' + Date.now().toString(36), degreeType: 'Bachelor', university: 'ADNSU',
        faculty: p.faculty || '', specialty: p.major || '', specialization: '', group: '',
        startYear: new Date().getFullYear() - ((p.course || 1) - 1),
        graduationYear: new Date().getFullYear() + (5 - (p.course || 1)),
        isCurrent: true, verified: false
      }]
    };
  },

  newCompanyProfile(p) {
    return {
      id: 'co-' + Date.now().toString(36),
      name: p.name || '', sector: p.sector || 'Digər',
      contact: p.contact || '', email: p.email || '',
      about: '', website: ''
    };
  },

  /* ---------------------------------------------------------------- *
   * Elanlar
   * ---------------------------------------------------------------- */

  /* Bütün elanlar = statik data + şirkətlərin yaratdıqları, admin qərarları tətbiq olunmuş */
  allJobs() {
    const custom = this.state.customJobs || [];
    return [...OPPORTUNITIES, ...custom].map(j => {
      const decision = this.state.approvals[j.id];
      return decision ? { ...j, status: decision } : j;
    }).filter(j => j.status !== 'rejected');
  },

  jobById(id) {
    return this.allJobs().find(j => String(j.id) === String(id));
  },

  isApplied(jobId) {
    return (this.state.applications || []).some(a => String(a.jobId) === String(jobId));
  },

  /**
   * Write-through köməkçisi: yerli vəziyyət dərhal yenilənir (optimistik),
   * Supabase rejimində isə sorğu arxa planda göndərilir. Xəta olarsa
   * geri qaytarılır və istifadəçiyə bildirilir.
   */
  remote(fn, rollback) {
    if (this.mode !== 'supabase') return;
    Promise.resolve(fn()).then(res => {
      if (res && res.ok === false) {
        if (rollback) rollback();
        if (typeof toast === 'function') toast(res.error || 'Əməliyyat alınmadı');
        if (typeof render === 'function') render();
      }
    }).catch(e => {
      if (rollback) rollback();
      if (typeof toast === 'function') toast('Şəbəkə xətası — dəyişiklik saxlanmadı');
      if (typeof render === 'function') render();
    });
  },

  apply(jobId, note = '') {
    if (this.isApplied(jobId)) return false;
    const key = this.mode === 'supabase' ? String(jobId) : Number(jobId);
    this.state.applications.unshift({
      jobId: key,
      at: new Date().toISOString().slice(0, 10),
      status: 'Göndərildi',
      note
    });
    this.save();
    this.remote(
      () => Backend.apply(jobId, note),
      () => this.syncBucket('applications',
        this.state.applications.filter(a => String(a.jobId) !== String(jobId)))
    );
    return true;
  },

  withdraw(jobId) {
    const removed = this.state.applications.filter(a => String(a.jobId) === String(jobId));
    this.syncBucket('applications',
      this.state.applications.filter(a => String(a.jobId) !== String(jobId)));
    this.save();
    this.remote(
      () => Backend.withdraw(jobId),
      () => this.syncBucket('applications', removed.concat(this.state.applications))
    );
  },

  toggleSave(jobId) {
    const id = this.mode === 'supabase' ? String(jobId) : Number(jobId);
    const i = this.state.saved.findIndex(x => String(x) === String(jobId));
    const wasOn = i >= 0;
    if (wasOn) this.state.saved.splice(i, 1); else this.state.saved.push(id);
    this.save();
    this.remote(
      () => Backend.toggleSave(jobId, !wasOn),
      () => {
        const j = this.state.saved.findIndex(x => String(x) === String(jobId));
        if (wasOn && j < 0) this.state.saved.push(id);
        else if (!wasOn && j >= 0) this.state.saved.splice(j, 1);
      }
    );
  },

  /** Profil dəyişikliyi — Supabase rejimində bazaya yazılır. */
  pushProfile() {
    if (this.mode !== 'supabase' || !this.state.student) return;
    this.remote(() => Backend.updateProfile(Adapt.profileToDb(this.state.student, this.tax)));
  },

  pushCompany() {
    if (this.mode !== 'supabase' || !this.state.company) return;
    this.remote(() => Backend.updateCompany(this.state.company.id, {
      name: this.state.company.name, sector: this.state.company.sector,
      contact: this.state.company.contact, email: this.state.company.email,
      website: this.state.company.website, about: this.state.company.about
    }));
  },

  setInterview(iv) {
    const uid = this.state.session && this.state.session.userId;
    this.state.interview = iv;
    if (uid) this.state.userData[uid].interview = iv;
    this.save();
  },

  nextJobId() {
    return Math.max(0, ...this.allJobs().map(j => Number(j.id) || 0)) + 1;
  },

  /** Aktiv şirkət hesabının elanları. */
  companyJobs() {
    const co = this.state.company;
    if (!co) return [];
    return this.allJobs().filter(j => j.companyId === co.id);
  }
};

/* Saxlanmış vəziyyəti standart sxemlə birləşdirir (yeni sahələr əlavə olunanda lazımdır). */
function deepMerge(base, patch) {
  if (Array.isArray(patch)) return patch;
  if (patch && typeof patch === 'object') {
    const out = { ...base };
    Object.keys(patch).forEach(k => {
      out[k] = (base && typeof base[k] === 'object' && base[k] !== null && !Array.isArray(base[k]))
        ? deepMerge(base[k], patch[k])
        : patch[k];
    });
    return out;
  }
  return patch === undefined ? base : patch;
}
