/*!
 * ADNSU / ASOIU Career v2 — auth.js
 * Autentifikasiya: qeydiyyat, giriş, sessiya və rol nəzarəti.
 *
 * ŞİFRƏLƏR AÇIQ MƏTNLƏ SAXLANMIR. Hər hesab üçün təsadüfi salt yaradılır və
 * şifrə PBKDF2-SHA256 (120 000 iterasiya) ilə hashlənir. Yalnız salt və hash
 * saxlanılır — şifrənin özü heç yerdə qalmır.
 *
 * DİQQƏT: bu, brauzer tərəfli demo autentifikasiyadır. Bütün məlumat
 * istifadəçinin öz cihazındadır, ona görə bu qat *məxfilik* təmin edir,
 * *təhlükəsizlik* yox — cihaza çıxışı olan biri saxlanmış datanı oxuya bilər.
 * Real quraşdırmada giriş universitetin SSO-su ilə serverdə aparılmalıdır
 * (bax: README.md → «Backend qoşmaq»).
 *
 */

const UNI_DOMAIN = 'asoiu.edu.az';
const PBKDF2_ITERATIONS = 120000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

const ROLE_NAMES = {
  student: 'Tələbə',
  company: 'Şirkət',
  admin: 'Karyera Mərkəzi'
};

const Auth = {
  /* ---------------------------------------------------------------- *
   * Kriptoqrafiya
   * ---------------------------------------------------------------- */

  /** Web Crypto əlçatandırmı? file:// və https:// üzərində bəli. */
  available() {
    return typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.deriveBits === 'function';
  },

  newSalt() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  },

  async hash(password, saltHex) {
    const enc = new TextEncoder();
    const salt = new Uint8Array((saltHex.match(/../g) || []).map(h => parseInt(h, 16)));
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, key, 256);
    return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
  },

  /** Vaxta görə sabit müqayisə — hash uzunluqları bərabərdir. */
  safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  },

  /* ---------------------------------------------------------------- *
   * Sessiya
   * ---------------------------------------------------------------- */

  currentUser() {
    const s = Store.state;
    if (!s || !s.session) return null;
    return s.users.find(u => u.id === s.session.userId) || null;
  },

  role() {
    const u = this.currentUser();
    return u ? u.role : null;
  },

  isSignedIn() {
    return !!this.currentUser();
  },

  logout() {
    if (Store.mode === 'supabase') Backend.signOut();
    Store.state.session = null;
    Store.state.view = 'dashboard';
    Store.bind();
    Store.save();
  },

  /* ---------------------------------------------------------------- *
   * Supabase rejimi
   * Rol, e-poçt domeni və icazələr SERVERDƏ yoxlanılır — aşağıdakı
   * yoxlamalar yalnız istifadəçiyə tez geri bildirim vermək üçündür.
   * ---------------------------------------------------------------- */

  async loginRemote(email, password) {
    const emailErr = this.validateEmail(email, null);
    if (emailErr) return { ok: false, field: 'email', error: emailErr };

    const res = await Backend.signIn(email, password);
    if (!res.ok) return res;

    const payload = await Backend.loadAll();
    if (!payload.ok) return { ok: false, error: payload.error };
    Store.hydrate(payload);
    return { ok: true, user: this.currentUser() };
  },

  async registerRemote(p) {
    const role = ['company', 'master_student', 'alumni'].includes(p.role) ? p.role : 'student';
    const isCompany = role === 'company';
    const isLearner = !isCompany;
    if (!String(p.name || '').trim()) {
      return { ok: false, field: isCompany ? 'name' : 'firstName', error: isCompany ? 'Şirkət adını yazın.' : 'Ad və soyadınızı yazın.' };
    }
    if (isLearner && (!String(p.firstName || '').trim() || !String(p.lastName || '').trim())) {
      return { ok: false, field: !String(p.firstName || '').trim() ? 'firstName' : 'lastName', error: 'Ad və soyadı ayrıca yazın.' };
    }
    const emailErr = this.validateEmail(p.email, role);
    if (emailErr) return { ok: false, field: 'email', error: emailErr };
    const pwErr = this.validatePassword(p.password);
    if (pwErr) return { ok: false, field: 'password', error: pwErr };
    if (p.password !== p.password2) {
      return { ok: false, field: 'password2', error: 'Şifrələr üst-üstə düşmür.' };
    }
    if (isCompany && !String(p.contact || '').trim()) {
      return { ok: false, field: 'contact', error: 'Əlaqəli şəxsin adını yazın.' };
    }
    if (!String(p.phone || '').trim()) return { ok: false, field: 'phone', error: 'Telefon nömrəsini yazın.' };
    if (isCompany && (!String(p.contactPosition || '').trim() || !String(p.contactEmail || '').trim() || !String(p.contactPhone || '').trim())) {
      return { ok: false, field: 'contactPosition', error: 'Əlaqəli şəxsin vəzifə, e-poçt və telefon məlumatlarını tamamlayın.' };
    }
    if (role === 'master_student' && (!String(p.masterUniversity || '').trim() || !String(p.masterSpecialty || '').trim())) {
      return { ok: false, field: 'masterUniversity', error: 'Magistr universiteti və ixtisasını tamamlayın.' };
    }

    /*
     * Fakültə/ixtisas id-ləri yalnız bazadan gəlir, arayış cədvəlləri isə
     * `authenticated` rolu üçün açıqdır — yəni qeydiyyatdan ƏVVƏL oxuna bilmir.
     * Ona görə seçimi ad kimi saxlayır, sessiya yarandıqdan sonra id-yə çevirib
     * profilə yazırıq. (Əvvəl bu addım yox idi və fakültə boş qalırdı.)
     */
    const res = await Backend.signUp({ ...p, role });
    if (!res.ok) return res;

    if (res.needsConfirmation) {
      return { ok: false, confirmation: true, error:
        `Hesab yaradıldı. ${res.email} ünvanına təsdiq linki göndərildi — ` +
        `linkə klikləyib geri qayıdın və daxil olun. Fakültə seçiminizi ilk ` +
        `girişdən sonra profildə tamamlayın.` };
    }

    const payload = await Backend.loadAll();
    if (!payload.ok) return { ok: false, error: payload.error };
    Store.hydrate(payload);

    /* İndi taksonomiya əlçatandır — akademik sahələri yazırıq. */
    if (isLearner) {
      const tax = Store.tax || {};
      const patch = {
        faculty_id: (tax.facultyIdByName || {})[p.faculty] || null,
        major_id: (tax.majorIdByName || {})[p.major] || null,
        course: Number(p.course) || 1,
        phone: p.phone || '',
        university: p.university || 'Azərbaycan Dövlət Neft və Sənaye Universiteti',
        group_name: p.groupName || '',
        avatar_url: p.avatarUrl || null,
        account_status: role === 'master_student' ? 'master_student' : role === 'alumni' ? 'alumni' : 'student',
        personal_email: role === 'alumni' && !String(p.email).toLowerCase().endsWith('@' + UNI_DOMAIN) ? p.email : null
      };
      const upd = await Backend.updateProfile(patch);
      if (upd.ok && Store.state.student) {
        Store.state.student.faculty = p.faculty;
        Store.state.student.major = p.major;
        Store.state.student.course = patch.course;
      }
    }
    return { ok: true, user: this.currentUser() };
  },

  /** Mövcud Supabase sessiyasını bərpa edir (səhifə yenilənəndə). */
  async restoreRemote() {
    const session = await Backend.getSession();
    if (!session) return false;
    const payload = await Backend.loadAll();
    if (!payload.ok) return false;
    Store.hydrate(payload);
    return true;
  },

  /* ---------------------------------------------------------------- *
   * Doğrulama
   * ---------------------------------------------------------------- */

  validateEmail(email, role) {
    const e = String(email || '').trim().toLowerCase();
    if (!e) return 'E-poçt ünvanını yazın.';
    if (!EMAIL_RE.test(e)) return 'E-poçt ünvanı düzgün formatda deyil.';
    if (['student', 'master_student'].includes(role) && !e.endsWith('@' + UNI_DOMAIN)) {
      return `Tələbə qeydiyyatı üçün universitet e-poçtu tələb olunur (@${UNI_DOMAIN}).`;
    }
    return null;
  },

  validatePassword(pw) {
    const p = String(pw || '');
    if (p.length < 8) return 'Şifrə ən azı 8 simvol olmalıdır.';
    if (!/[a-zəçğıöşüA-ZƏÇĞIÖŞÜ]/.test(p)) return 'Şifrədə ən azı bir hərf olmalıdır.';
    if (!/\d/.test(p)) return 'Şifrədə ən azı bir rəqəm olmalıdır.';
    return null;
  },

  /** Şifrənin gücü — qeydiyyat formasında göstərici üçün. 0–4 */
  strength(pw) {
    const p = String(pw || '');
    let s = 0;
    if (p.length >= 8) s++;
    if (p.length >= 12) s++;
    if (/[a-zəçğıöşü]/.test(p) && /[A-ZƏÇĞIÖŞÜ]/.test(p)) s++;
    if (/\d/.test(p) && /[^\w\s]/.test(p)) s++;
    const labels = ['Çox zəif', 'Zəif', 'Orta', 'Güclü', 'Çox güclü'];
    return { level: s, label: labels[s] };
  },

  findByEmail(email) {
    const e = String(email || '').trim().toLowerCase();
    return Store.state.users.find(u => u.email.toLowerCase() === e) || null;
  },

  /* ---------------------------------------------------------------- *
   * Qeydiyyat və giriş
   * ---------------------------------------------------------------- */

  /**
   * @param {object} p { role, name, email, password, password2, ...rol xüsusi sahələr }
   * @returns {Promise<{ok:boolean, error?:string, field?:string, user?:object}>}
   */
  async register(p) {
    if (!this.available()) {
      return { ok: false, error: 'Bu brauzer Web Crypto dəstəkləmir — qeydiyyat mümkün deyil.' };
    }
    const role = p.role === 'company' ? 'company' : 'student';

    if (!String(p.name || '').trim()) {
      return { ok: false, field: 'name', error: role === 'company' ? 'Şirkət adını yazın.' : 'Ad və soyadınızı yazın.' };
    }
    const emailErr = this.validateEmail(p.email, role);
    if (emailErr) return { ok: false, field: 'email', error: emailErr };
    if (this.findByEmail(p.email)) {
      return { ok: false, field: 'email', error: 'Bu e-poçt ilə hesab artıq mövcuddur. Giriş edin.' };
    }
    const pwErr = this.validatePassword(p.password);
    if (pwErr) return { ok: false, field: 'password', error: pwErr };
    if (p.password !== p.password2) {
      return { ok: false, field: 'password2', error: 'Şifrələr üst-üstə düşmür.' };
    }
    if (role === 'student') {
      if (!p.faculty) return { ok: false, field: 'faculty', error: 'Fakültəni seçin.' };
      if (!p.major) return { ok: false, field: 'major', error: 'İxtisası seçin.' };
    }
    if (role === 'company' && !String(p.contact || '').trim()) {
      return { ok: false, field: 'contact', error: 'Əlaqəli şəxsin adını yazın.' };
    }

    const salt = this.newSalt();
    const passwordHash = await this.hash(p.password, salt);
    const id = `u-${role}-${Date.now().toString(36)}`;

    const user = {
      id,
      role,
      name: String(p.name).trim(),
      email: String(p.email).trim().toLowerCase(),
      salt,
      passwordHash,
      createdAt: new Date().toISOString().slice(0, 10),
      /* Şirkət hesabları Karyera Mərkəzinin təsdiqinə düşür. */
      status: role === 'company' ? 'pending' : 'active'
    };
    Store.state.users.push(user);

    if (role === 'student') {
      Store.state.profiles[id] = Store.newStudentProfile({
        name: user.name,
        email: user.email,
        faculty: p.faculty,
        major: p.major,
        course: Number(p.course) || 1
      });
    } else {
      Store.state.companyProfiles[id] = Store.newCompanyProfile({
        name: user.name,
        email: user.email,
        contact: String(p.contact).trim(),
        sector: p.sector || 'Digər'
      });
    }
    Store.state.userData[id] = Store.newUserData();

    this.startSession(user);
    return { ok: true, user };
  },

  /**
   * @returns {Promise<{ok:boolean, error?:string, field?:string, user?:object}>}
   */
  async login(email, password) {
    if (!this.available()) {
      return { ok: false, error: 'Bu brauzer Web Crypto dəstəkləmir — giriş mümkün deyil.' };
    }
    const user = this.findByEmail(email);
    /* Hesab tapılmasa da eyni mesaj — mövcud e-poçtları aşkar etməmək üçün. */
    const generic = { ok: false, field: 'password', error: 'E-poçt və ya şifrə yanlışdır.' };
    if (!user) {
      /* Vaxt fərqi ilə hesabın varlığını bildirməmək üçün yenə də hash hesablayırıq. */
      await this.hash(String(password || ''), this.newSalt());
      return generic;
    }
    const candidate = await this.hash(String(password || ''), user.salt);
    if (!this.safeEqual(candidate, user.passwordHash)) return generic;

    this.startSession(user);
    return { ok: true, user };
  },

  startSession(user) {
    Store.state.session = { userId: user.id, at: new Date().toISOString() };
    Store.state.view = 'dashboard';
    Store.bind();
    Store.save();
  },

  /** Şifrə dəyişmə — profil səhifəsindən. */
  async changePassword(currentPw, newPw, newPw2) {
    const user = this.currentUser();
    if (!user) return { ok: false, error: 'Sessiya tapılmadı.' };

    const pwErr0 = this.validatePassword(newPw);
    if (pwErr0) return { ok: false, field: 'new', error: pwErr0 };
    if (newPw !== newPw2) return { ok: false, field: 'new2', error: 'Yeni şifrələr üst-üstə düşmür.' };

    if (Store.mode === 'supabase') {
      /* Supabase cari şifrəni yenidən yoxlamır — əvvəlcə onu təsdiqləyirik. */
      const verify = await Backend.signIn(user.email, currentPw);
      if (!verify.ok) return { ok: false, field: 'current', error: 'Cari şifrə yanlışdır.' };
      return await Backend.changePassword(newPw);
    }

    const check = await this.hash(String(currentPw || ''), user.salt);
    if (!this.safeEqual(check, user.passwordHash)) {
      return { ok: false, field: 'current', error: 'Cari şifrə yanlışdır.' };
    }
    const pwErr = this.validatePassword(newPw);
    if (pwErr) return { ok: false, field: 'new', error: pwErr };
    if (newPw !== newPw2) return { ok: false, field: 'new2', error: 'Yeni şifrələr üst-üstə düşmür.' };

    user.salt = this.newSalt();
    user.passwordHash = await this.hash(newPw, user.salt);
    Store.save();
    return { ok: true };
  },

  /* ---------------------------------------------------------------- *
   * Şirkət hesablarının təsdiqi (Karyera Mərkəzi)
   * ---------------------------------------------------------------- */

  pendingCompanies() {
    return Store.state.users.filter(u => u.role === 'company' && u.status === 'pending');
  },

  setCompanyStatus(userId, status) {
    const u = Store.state.users.find(x => x.id === userId);
    if (u) { u.status = status; Store.save(); }

    if (Store.mode === 'supabase') {
      /* Supabase rejimində userId əslində companies.id-dir (bax: viewApprovals). */
      Store.remote(() => Backend.setCompanyStatus(userId, status));
    }
  },

  /** Supabase rejimində təsdiq gözləyən şirkətlər companies cədvəlindən gəlir. */
  pendingCompanyRows() {
    if (Store.mode !== 'supabase') {
      return this.pendingCompanies().map(u => ({
        id: u.id, name: u.name, email: u.email, createdAt: u.createdAt,
        sector: (Store.state.companyProfiles[u.id] || {}).sector || '',
        contact: (Store.state.companyProfiles[u.id] || {}).contact || ''
      }));
    }
    return COMPANIES
      .filter(c => c.status === 'pending')
      .map(c => ({ id: c.id, name: c.name, email: c.email || '', createdAt: '',
                   sector: c.sector || '', contact: c.contact || '' }));
  },

  /**
   * İlk yüklənmədə demo hesablarının şifrələrini hashləyir.
   * Seed hesabları repoda açıq mətnlə gəlir ki, hər kəs sınaya bilsin;
   * ilk açılışda dərhal hashlənir və açıq mətn silinir.
   */
  async ensureSeededPasswords() {
    if (!this.available()) return;
    let changed = false;
    for (const u of Store.state.users) {
      if (u.seedPassword) {
        u.salt = this.newSalt();
        u.passwordHash = await this.hash(u.seedPassword, u.salt);
        delete u.seedPassword;
        changed = true;
      }
    }
    if (changed) Store.save();
  }
};

/* Sınaq üçün demo hesabları — giriş ekranında bir kliklə doldurulur. */
const DEMO_ACCOUNTS = [
  { role: 'student', email: 'aylin.mammadova@asoiu.edu.az', password: 'Telebe2026', label: 'Tələbə kabineti' },
  { role: 'company', email: 'careers@socar.az',             password: 'Sirket2026', label: 'Şirkət kabineti' },
  { role: 'admin',   email: 'career@asoiu.edu.az',          password: 'Merkez2026', label: 'Karyera Mərkəzi' }
];
