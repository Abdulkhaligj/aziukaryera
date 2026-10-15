/*!
 * ADNSU / ASOIU Career v2 — backend.js
 * Supabase data qatı.
 *
 * DİZAYN QƏRARI: render kodu sinxron qalır.
 * Giriş anında bütün lazımi məlumat bir dəfə `Store.state`-ə yüklənir
 * (`Backend.loadAll`), mutasiyalar isə write-through olur: əvvəlcə Supabase-ə
 * yazılır, uğurlu olarsa yerli vəziyyət yenilənir. Beləcə v2-nin bütün
 * görünüşləri (`app.js`) dəyişmədən işləyir.
 *
 * Təhlükəsizlik: burada heç bir icazə yoxlanışı YOXDUR və olmamalıdır.
 * Kim nəyi görə və dəyişə bilər — bunu Postgres-dəki RLS siyasətləri həll edir
 * (bax: supabase/migrations/0001_init.sql). Bu fayl sadəcə sorğu göndərir;
 * icazəsiz sorğu bazadan boş nəticə və ya xəta ilə qayıdır.
 *
 */

const Backend = {
  sb: null,

  /* ---------------------------------------------------------------- *
   * Başlanğıc
   * ---------------------------------------------------------------- */

  available() {
    return USE_SUPABASE && typeof window !== 'undefined' && !!window.supabase;
  },

  init() {
    if (!this.available()) return false;
    if (this.sb) return true;
    this.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    return true;
  },

  /* ---------------------------------------------------------------- *
   * Autentifikasiya
   * ---------------------------------------------------------------- */

  async getSession() {
    if (!this.init()) return null;
    const { data } = await this.sb.auth.getSession();
    return data.session || null;
  },

  async signIn(email, password) {
    if (!this.init()) return { ok: false, error: 'Supabase konfiqurasiya olunmayıb.' };
    const { data, error } = await this.sb.auth.signInWithPassword({
      email: String(email).trim().toLowerCase(),
      password
    });
    if (error) return { ok: false, field: 'password', error: this.translate(error.message) };
    return { ok: true, session: data.session };
  },

  async signInWithMagicLink(email) {
    if (!this.init()) return { ok: false, error: 'Giriş xidməti hazır deyil.' };
    const value = String(email || '').trim().toLowerCase();
    if (!value.endsWith('@' + UNI_DOMAIN)) {
      return { ok: false, error: `Şifrəsiz universitet girişi üçün @${UNI_DOMAIN} e-poçtu yazın.` };
    }
    const { error } = await this.sb.auth.signInWithOtp({
      email: value,
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}${window.location.pathname}` }
    });
    return error ? { ok: false, error: this.translate(error.message) } : { ok: true };
  },

  /**
   * Qeydiyyat. Rol `options.data`-ya yazılsa da, ona ETİBAR EDİLMİR —
   * baza trigger-i (`handle_new_user`) rolu özü təyin edir və e-poçt
   * domenini yoxlayır. Buradakı dəyər yalnız "nə istədiyini" bildirir.
   */
  async signUp(p) {
    if (!this.init()) return { ok: false, error: 'Supabase konfiqurasiya olunmayıb.' };
    const { data, error } = await this.sb.auth.signUp({
      email: String(p.email).trim().toLowerCase(),
      password: p.password,
      options: {
        emailRedirectTo: `${window.location.origin}${window.location.pathname}`,
        data: {
          role: p.role,
          account_status: p.role === 'master_student' ? 'master_student' : p.role === 'alumni' ? 'alumni' : 'student',
          full_name: p.name,
          phone: p.phone,
          avatar_url: p.avatarUrl,
          university: p.university,
          faculty_name: p.faculty,
          major_name: p.major,
          group_name: p.groupName,
          bachelor_start_year: p.bachelorStartYear,
          bachelor_end_year: p.bachelorEndYear,
          master_university: p.masterUniversity,
          master_faculty: p.masterFaculty,
          master_specialty: p.masterSpecialty,
          master_specialization: p.masterSpecialization,
          master_group: p.masterGroup,
          master_start_year: p.masterStartYear,
          master_end_year: p.masterEndYear,
          company_name: p.role === 'company' ? p.name : undefined,
          sector: p.sector,
          website: p.website,
          company_size: p.companySize,
          address: p.address,
          logo_url: p.logoUrl,
          description: p.description,
          contact_name: p.contact,
          contact_position: p.contactPosition,
          contact_email: p.contactEmail,
          contact_phone: p.contactPhone,
          plan_id: p.role === 'company' ? (p.plan || 'free') : undefined
        }
      }
    });
    if (error) return { ok: false, error: this.translate(error.message) };

    /* E-poçt təsdiqi açıqdırsa, session null gəlir. */
    if (!data.session) {
      return { ok: true, needsConfirmation: true, email: p.email };
    }
    /* Akademik sahələr Auth.registerRemote-də yazılır — taksonomiya
       yalnız sessiya yarandıqdan sonra oxunabilir olur. */
    return { ok: true, session: data.session };
  },

  /**
   * Hansı OAuth provayderləri aktivdir? Supabase bunu açıq endpoint-də verir.
   * Beləcə sönülü provayderin düyməsini ümumiyyətlə göstərmirik —
   * istifadəçi işləməyən düyməyə basmır.
   */
  async providers() {
    if (!USE_SUPABASE) return {};
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
        headers: { apikey: SUPABASE_PUBLISHABLE_KEY }
      });
      if (!res.ok) return {};
      const j = await res.json();
      return j.external || {};
    } catch (e) { return {}; }
  },

  /**
   * Google ilə giriş. Universitet hesabı tələb olunur — `hd` parametri
   * Google-a yalnız @asoiu.edu.az hesablarını göstərməyi tövsiyə edir,
   * əsl məcburiyyət isə bazadakı trigger-dədir (klient tərəfə etibar edilmir).
   */
  async signInWithGoogle() {
    if (!this.init()) return { ok: false, error: 'Supabase konfiqurasiya olunmayıb.' };
    const { error } = await this.sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}${window.location.pathname}`,
        queryParams: { hd: UNI_DOMAIN, prompt: 'select_account' }
      }
    });
    /* Uğurlu halda brauzer Google-a yönləndirilir — bu sətrə qayıtmır. */
    return error ? { ok: false, error: this.translate(error.message) } : { ok: true };
  },

  /** Microsoft 365 / Entra ID ilə universitet girişi. */
  async signInWithAzure() {
    if (!this.init()) return { ok: false, error: 'Supabase konfiqurasiya olunmayıb.' };
    const { error } = await this.sb.auth.signInWithOAuth({
      provider: 'azure',
      options: {
        redirectTo: `${window.location.origin}${window.location.pathname}`,
        scopes: 'email',
        queryParams: { prompt: 'select_account' }
      }
    });
    return error ? { ok: false, error: this.translate(error.message) } : { ok: true };
  },

  /**
   * Google-dan qayıdan zaman URL-də xəta ola bilər (məs. universitet
   * hesabı deyil). Onu oxuyub ünvanı təmizləyirik.
   */
  readOAuthError() {
    try {
      const hash = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
      const query = new URLSearchParams(window.location.search);
      const code = hash.get('error') || query.get('error');
      if (!code) return null;
      const desc = hash.get('error_description') || query.get('error_description') || code;
      history.replaceState(null, '', window.location.pathname);
      return this.translate(decodeURIComponent(desc.replace(/\+/g, ' ')));
    } catch (e) { return null; }
  },

  async signOut() {
    if (!this.init()) return;
    await this.sb.auth.signOut();
  },

  async resetPassword(email) {
    if (!this.init()) return { ok: false, error: 'Supabase konfiqurasiya olunmayıb.' };
    const { error } = await this.sb.auth.resetPasswordForEmail(
      String(email).trim().toLowerCase(),
      { redirectTo: `${window.location.origin}${window.location.pathname}` }
    );
    return error ? { ok: false, error: this.translate(error.message) } : { ok: true };
  },

  async changePassword(newPassword) {
    if (!this.init()) return { ok: false, error: 'Supabase konfiqurasiya olunmayıb.' };
    const { error } = await this.sb.auth.updateUser({ password: newPassword });
    return error ? { ok: false, error: this.translate(error.message) } : { ok: true };
  },

  /**
   * Supabase xəta mətnlərinin Azərbaycan dilinə çevrilməsi.
   *
   * Qeyd: Supabase qeydiyyat trigger-indəki hər hansı xətanı eyni ümumi
   * «Database error saving new user» mətni ilə örtür — əsl səbəbi göstərmir.
   * Bizim halda bunun praktiki olaraq yeganə səbəbi e-poçt domeninin
   * universitetə aid olmamasıdır, ona görə istifadəçiyə məhz bunu deyirik.
   */
  translate(msg) {
    const m = String(msg || '');
    if (/Invalid login credentials/i.test(m)) return 'E-poçt və ya şifrə yanlışdır.';
    if (/Email not confirmed/i.test(m)) {
      return 'E-poçt ünvanınız hələ təsdiqlənməyib — poçtunuzdakı təsdiq linkinə klikləyin.';
    }
    if (/User already registered|already been registered/i.test(m)) {
      return 'Bu e-poçt ilə hesab artıq mövcuddur. Giriş edin və ya şifrəni bərpa edin.';
    }
    if (/Database error saving new user|unexpected_failure/i.test(m)) {
      return 'Qeydiyyat alınmadı. Tələbə hesabı üçün universitet e-poçtu (@' + UNI_DOMAIN + ') tələb olunur.';
    }
    if (/email_address_invalid|Email address .* is invalid/i.test(m)) {
      return 'Bu e-poçt ünvanı qəbul edilmədi. Mövcud və işlək bir ünvan yazın.';
    }
    if (/Password should be at least|weak.?password/i.test(m)) return 'Şifrə ən azı 8 simvol olmalıdır.';
    if (/asoiu\.edu\.az/i.test(m)) return 'Tələbə qeydiyyatı üçün @asoiu.edu.az e-poçtu tələb olunur.';
    if (/over_email_send_rate_limit|rate limit|too many requests|429/i.test(m)) {
      return 'E-poçt göndərmə limitinə çatıldı. Bir saat gözləyin və ya Supabase-də öz SMTP serverinizi qoşun.';
    }
    if (/duplicate key/i.test(m)) return 'Bu qeyd artıq mövcuddur.';
    if (/row-level security|insufficient_privilege|icazəsi yoxdur/i.test(m)) {
      return 'Bu əməliyyat üçün icazəniz yoxdur.';
    }
    if (/Failed to fetch|NetworkError/i.test(m)) {
      return 'Serverə qoşulmaq alınmadı. İnternet bağlantınızı yoxlayın.';
    }
    if (/yalnız universitet hesabı|Google ilə giriş yalnız/i.test(m)) {
      return `Google ilə giriş yalnız universitet hesabı (@${UNI_DOMAIN}) ilə mümkündür. ` +
             `Şəxsi Gmail ilə deyil, ADNSU hesabınızla daxil olun.`;
    }
    if (/provider is not enabled|Unsupported provider/i.test(m)) {
      return 'Google ilə giriş hələ aktivləşdirilməyib. Karyera Mərkəzi ilə əlaqə saxlayın.';
    }
    if (/access_denied|cancel/i.test(m)) return 'Google girişi ləğv edildi.';
    return m;
  },

  /** Təsdiq e-poçtunu yenidən göndərir. */
  async resendConfirmation(email) {
    if (!this.init()) return { ok: false, error: 'Supabase konfiqurasiya olunmayıb.' };
    const { error } = await this.sb.auth.resend({
      type: 'signup',
      email: String(email).trim().toLowerCase(),
      options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}` }
    });
    return error ? { ok: false, error: this.translate(error.message) } : { ok: true };
  },

  /* ---------------------------------------------------------------- *
   * Arayış və məzmun yüklənməsi
   * ---------------------------------------------------------------- */

  /** Bütün lazımi məlumatı bir dəfəyə yükləyib Store.state-ə yerləşdirir. */
  async loadAll() {
    if (!this.init()) return { ok: false, error: 'Supabase konfiqurasiya olunmayıb.' };

    const session = await this.getSession();
    if (!session) return { ok: false, error: 'Sessiya yoxdur.' };
    const uid = session.user.id;

    const [fac, maj, profile, education, candidates, companies, jobs, apps, saved, invites, events, regs, subscription, notifications, broadcasts, broadcastReads] = await Promise.all([
      this.sb.from('faculties').select('*').order('sort_order'),
      this.sb.from('majors').select('*'),
      this.sb.from('profiles').select('*').eq('id', uid).single(),
      this.sb.from('education').select('*').eq('profile_id', uid).order('start_year', { ascending: false }),
      this.sb.from('profiles').select('id,full_name,role,status,faculty_id,major_id,course,gpa,skills,summary,account_status').in('role', ['student', 'graduate']).eq('status', 'active'),
      this.sb.from('companies').select('*'),
      this.sb.from('jobs').select('*'),
      this.sb.from('applications').select('*'),
      this.sb.from('saved_jobs').select('job_id'),
      this.sb.from('invites').select('*'),
      this.sb.from('events').select('*').order('starts_at'),
      this.sb.from('event_registrations').select('event_id'),
      this.sb.from('subscriptions').select('*, plans(*)').maybeSingle(),
      this.sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(100),
      this.sb.from('broadcast_notifications').select('*').order('created_at', { ascending: false }).limit(100),
      this.sb.from('broadcast_notification_reads').select('broadcast_id,read_at')
    ]);

    const err = [fac, maj, profile, education, candidates, companies, jobs, apps, saved, invites, events, regs, notifications, broadcasts, broadcastReads]
      .find(r => r.error);
    if (err) return { ok: false, error: this.translate(err.error.message) };

    return {
      ok: true,
      uid,
      email: session.user.email,
      faculties: fac.data,
      majors: maj.data,
      profile: profile.data,
      education: education.data || [],
      candidates: candidates.data || [],
      companies: companies.data,
      jobs: jobs.data,
      applications: apps.data,
      saved: saved.data.map(r => r.job_id),
      invites: invites.data,
      events: events.data,
      eventRegistrations: regs.data.map(r => r.event_id),
      subscription: subscription.error ? null : subscription.data,
      notifications: notifications.data || [],
      broadcasts: broadcasts.data || [],
      broadcastReads: broadcastReads.data || []
    };
  },

  /* ---------------------------------------------------------------- *
   * Bildirişlər — şəxsi qeydlər + miqyaslana bilən ümumi yayımlar
   * ---------------------------------------------------------------- */

  async notificationsFeed(limit = 100) {
    if (!this.init()) return { ok: false, rows: [] };
    const [personal, broadcasts, reads] = await Promise.all([
      this.sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(limit),
      this.sb.from('broadcast_notifications').select('*').order('created_at', { ascending: false }).limit(limit),
      this.sb.from('broadcast_notification_reads').select('broadcast_id,read_at')
    ]);
    const bad = [personal, broadcasts, reads].find(result => result.error);
    if (bad) return { ok: false, rows: [], error: this.translate(bad.error.message) };
    return { ok: true, rows: Adapt.notifications(personal.data || [], broadcasts.data || [], reads.data || []) };
  },

  async markNotificationRead(item) {
    if (!this.init() || !item) return { ok: false };
    const session = await this.getSession();
    if (!session) return { ok: false, error: 'Sessiya yoxdur.' };
    const now = new Date().toISOString();
    const query = item.source === 'broadcast'
      ? this.sb.from('broadcast_notification_reads').upsert({
          broadcast_id: item.rawId, profile_id: session.user.id, read_at: now
        }, { onConflict: 'broadcast_id,profile_id' })
      : this.sb.from('notifications').update({ read_at: now }).eq('id', item.rawId);
    const { error } = await query;
    return error ? { ok: false, error: this.translate(error.message) } : { ok: true, readAt: now };
  },

  async markAllNotificationsRead(items) {
    const unread = (items || []).filter(item => !item.readAt);
    const results = await Promise.all(unread.map(item => this.markNotificationRead(item)));
    const failed = results.find(result => !result.ok);
    return failed || { ok: true, readAt: new Date().toISOString() };
  },

  subscribeNotifications(onChange) {
    if (!this.init()) return null;
    this.unsubscribeNotifications();
    this.notificationChannel = this.sb.channel('career-notifications-' + Date.now())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'broadcast_notifications' }, onChange)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, onChange)
      .subscribe();
    return this.notificationChannel;
  },

  unsubscribeNotifications() {
    if (this.sb && this.notificationChannel) this.sb.removeChannel(this.notificationChannel);
    this.notificationChannel = null;
  },

  /* ---------------------------------------------------------------- *
   * Profil
   * ---------------------------------------------------------------- */

  async updateProfile(patch) {
    if (!this.init()) return { ok: false };
    const session = await this.getSession();
    if (!session) return { ok: false, error: 'Sessiya yoxdur.' };

    /* role və status klientdən göndərilmir — baza onsuz da bloklayır,
       amma lazımsız xətanın qarşısını almaq üçün burada da təmizləyirik. */
    const clean = { ...patch };
    delete clean.role; delete clean.status; delete clean.id; delete clean.email;

    const { error } = await this.sb.from('profiles').update(clean).eq('id', session.user.id);
    return error ? { ok: false, error: this.translate(error.message) } : { ok: true };
  },

  async updateCompany(companyId, patch) {
    if (!this.init()) return { ok: false };
    const clean = { ...patch };
    delete clean.status; delete clean.id; delete clean.owner_id;
    const { error } = await this.sb.from('companies').update(clean).eq('id', companyId);
    return error ? { ok: false, error: this.translate(error.message) } : { ok: true };
  },

  async addEducation(entry) {
    if (!this.init()) return { ok: false };
    const session = await this.getSession();
    const { data, error } = await this.sb.from('education')
      .insert({ ...entry, profile_id: session.user.id }).select().single();
    return error ? { ok: false, error: this.translate(error.message) } : { ok: true, row: data };
  },

  async updateEducation(id, patch) {
    if (!this.init()) return { ok: false };
    const { error } = await this.sb.from('education').update(patch).eq('id', id);
    return error ? { ok: false, error: this.translate(error.message) } : { ok: true };
  },

  async deleteEducation(id) {
    if (!this.init()) return { ok: false };
    const { error } = await this.sb.from('education').delete().eq('id', id);
    return error ? { ok: false, error: this.translate(error.message) } : { ok: true };
  },

  /* ---------------------------------------------------------------- *
   * CV və müsahibə tarixçəsi
   * CV-nin tam mətni bazaya yazılmır; yalnız nəticə və AI rəyi saxlanır.
   * ---------------------------------------------------------------- */

  async saveCVAnalysis({ title = 'CV analizi', score, feedback = null }) {
    if (!this.init()) return { ok: false };
    const session = await this.getSession();
    if (!session) return { ok: false, error: 'Sessiya yoxdur.' };
    const { data, error } = await this.sb.from('cv_documents').insert({
      profile_id: session.user.id,
      title,
      source_text: null,
      ats_score: Number.isFinite(Number(score)) ? Number(score) : null,
      ai_feedback: feedback
    }).select('id').single();
    return error ? { ok: false, error: this.translate(error.message) } : { ok: true, row: data };
  },

  async saveInterviewSession(input) {
    if (!this.init()) return { ok: false };
    const session = await this.getSession();
    if (!session) return { ok: false, error: 'Sessiya yoxdur.' };
    const { data, error } = await this.sb.from('interview_sessions').insert({
      profile_id: session.user.id,
      company_id: input.companyId || null,
      job_id: input.jobId || null,
      target_role: input.role || 'Müsahibə',
      interview_type: input.type || 'Ümumi',
      major: input.major || null,
      questions: input.questions || [],
      answers: input.answers || [],
      score: Number.isFinite(Number(input.result?.total)) ? Number(input.result.total) : null,
      deterministic_result: input.result || null,
      ai_feedback: input.aiResult || null,
      completed_at: new Date().toISOString()
    }).select('id').single();
    return error ? { ok: false, error: this.translate(error.message) } : { ok: true, row: data };
  },

  /* ---------------------------------------------------------------- *
   * Müraciətlər və seçilmişlər
   * ---------------------------------------------------------------- */

  async apply(jobId, note) {
    if (!this.init()) return { ok: false };
    const session = await this.getSession();
    const { data, error } = await this.sb.from('applications')
      .insert({ job_id: jobId, student_id: session.user.id, note: note || '' })
      .select().single();
    return error ? { ok: false, error: this.translate(error.message) } : { ok: true, row: data };
  },

  async withdraw(jobId) {
    if (!this.init()) return { ok: false };
    const session = await this.getSession();
    const { error } = await this.sb.from('applications').delete()
      .eq('job_id', jobId).eq('student_id', session.user.id);
    return error ? { ok: false, error: this.translate(error.message) } : { ok: true };
  },

  async setApplicationStatus(applicationId, status) {
    if (!this.init()) return { ok: false };
    const { error } = await this.sb.from('applications')
      .update({ status }).eq('id', applicationId);
    return error ? { ok: false, error: this.translate(error.message) } : { ok: true };
  },

  async toggleSave(jobId, on) {
    if (!this.init()) return { ok: false };
    const session = await this.getSession();
    const q = on
      ? this.sb.from('saved_jobs').insert({ job_id: jobId, student_id: session.user.id })
      : this.sb.from('saved_jobs').delete().eq('job_id', jobId).eq('student_id', session.user.id);
    const { error } = await q;
    return error ? { ok: false, error: this.translate(error.message) } : { ok: true };
  },

  /* ---------------------------------------------------------------- *
   * Şirkət əməliyyatları
   * ---------------------------------------------------------------- */

  async createJob(job) {
    if (!this.init()) return { ok: false };
    const { data, error } = await this.sb.from('jobs')
      .insert({ ...job, status: 'pending_approval' }).select().single();
    return error ? { ok: false, error: this.translate(error.message) } : { ok: true, row: data };
  },

  async invite(companyId, studentId, jobId) {
    if (!this.init()) return { ok: false };
    const { data, error } = await this.sb.from('invites')
      .insert({ company_id: companyId, student_id: studentId, job_id: jobId })
      .select().single();
    return error ? { ok: false, error: this.translate(error.message) } : { ok: true, row: data };
  },

  async cancelInvite(companyId, studentId, jobId) {
    if (!this.init()) return { ok: false };
    const { error } = await this.sb.from('invites').delete()
      .eq('company_id', companyId).eq('student_id', studentId).eq('job_id', jobId);
    return error ? { ok: false, error: this.translate(error.message) } : { ok: true };
  },

  /* ---------------------------------------------------------------- *
   * Karyera Mərkəzi əməliyyatları
   * Bunlar yalnız admin rolunda keçir — yoxlama RLS-dədir.
   * ---------------------------------------------------------------- */

  async setJobStatus(jobId, status) {
    if (!this.init()) return { ok: false };
    const session = await this.getSession();
    const patch = { status };
    if (status === 'approved') {
      patch.approved_at = new Date().toISOString();
      patch.approved_by = session.user.id;
    }
    const { error } = await this.sb.from('jobs').update(patch).eq('id', jobId);
    return error ? { ok: false, error: this.translate(error.message) } : { ok: true };
  },

  async setCompanyStatus(companyId, status) {
    if (!this.init()) return { ok: false };
    const { error } = await this.sb.from('companies').update({ status }).eq('id', companyId);
    return error ? { ok: false, error: this.translate(error.message) } : { ok: true };
  },

  /** Admin: bütün profillər (RLS yalnız admin üçün icazə verir). */
  async allProfiles() {
    if (!this.init()) return { ok: false, rows: [] };
    const { data, error } = await this.sb.from('profiles').select('*');
    return error ? { ok: false, rows: [], error: this.translate(error.message) } : { ok: true, rows: data };
  },

  /* ---------------------------------------------------------------- *
   * Tədbirlər
   * ---------------------------------------------------------------- */

  async registerForEvent(eventId) {
    if (!this.init()) return { ok: false };
    const session = await this.getSession();
    const { error } = await this.sb.from('event_registrations')
      .insert({ event_id: eventId, profile_id: session.user.id });
    return error ? { ok: false, error: this.translate(error.message) } : { ok: true };
  },

  /* ---------------------------------------------------------------- *
   * Peşəkar şəbəkə — paylaşımlar, bəyənmələr, şərhlər
   * ---------------------------------------------------------------- */

  async feed(limit = 30) {
    if (!this.init()) return { ok: false, rows: [] };
    const [posts, likes, saves, comments, profiles] = await Promise.all([
      this.sb.from('posts').select('*').order('created_at', { ascending: false }).limit(limit),
      this.sb.from('post_likes').select('post_id, profile_id'),
      this.sb.from('post_saves').select('post_id, profile_id'),
      this.sb.from('post_comments').select('*').order('created_at'),
      this.sb.from('profiles').select('id, full_name, role, faculty_id, major_id')
    ]);
    const bad = [posts, likes, saves, comments, profiles].find(r => r.error);
    if (bad) return { ok: false, rows: [], error: this.translate(bad.error.message) };

    const who = {};
    profiles.data.forEach(p => { who[p.id] = p; });
    const session = await this.getSession();
    const me = session ? session.user.id : null;

    return {
      ok: true,
      rows: posts.data.map(p => ({
        id: p.id,
        authorId: p.author_id,
        author: (who[p.author_id] || {}).full_name || 'Naməlum',
        authorRole: (who[p.author_id] || {}).role || 'student',
        authorFaculty: (who[p.author_id] || {}).faculty_id || '',
        authorMajor: (who[p.author_id] || {}).major_id || '',
        body: p.body,
        kind: p.kind || 'general',
        tags: p.tags || [],
        linkUrl: p.link_url || '',
        attachmentUrl: p.attachment_url || '',
        at: p.created_at,
        likes: likes.data.filter(l => l.post_id === p.id).length,
        likedByMe: likes.data.some(l => l.post_id === p.id && l.profile_id === me),
        savedByMe: saves.data.some(s => s.post_id === p.id && s.profile_id === me),
        comments: comments.data.filter(c => c.post_id === p.id).map(c => ({
          id: c.id, body: c.body, at: c.created_at,
          author: (who[c.author_id] || {}).full_name || 'Naməlum',
          authorId: c.author_id
        }))
      }))
    };
  },

  async createPost(input) {
    if (!this.init()) return { ok: false };
    const session = await this.getSession();
    const post = typeof input === 'string' ? { body: input } : input;
    const { data, error } = await this.sb.from('posts')
      .insert({
        author_id: session.user.id,
        body: post.body,
        kind: post.kind || 'general',
        tags: post.tags || [],
        link_url: post.linkUrl || null,
        attachment_url: post.attachmentUrl || null
      }).select().single();
    return error ? { ok: false, error: this.translate(error.message) } : { ok: true, row: data };
  },

  async deletePost(id) {
    if (!this.init()) return { ok: false };
    const { error } = await this.sb.from('posts').delete().eq('id', id);
    return error ? { ok: false, error: this.translate(error.message) } : { ok: true };
  },

  async toggleLike(postId, on) {
    if (!this.init()) return { ok: false };
    const session = await this.getSession();
    const q = on
      ? this.sb.from('post_likes').insert({ post_id: postId, profile_id: session.user.id })
      : this.sb.from('post_likes').delete().eq('post_id', postId).eq('profile_id', session.user.id);
    const { error } = await q;
    return error ? { ok: false, error: this.translate(error.message) } : { ok: true };
  },

  async togglePostSave(postId, on) {
    if (!this.init()) return { ok: false };
    const session = await this.getSession();
    const q = on
      ? this.sb.from('post_saves').insert({ post_id: postId, profile_id: session.user.id })
      : this.sb.from('post_saves').delete().eq('post_id', postId).eq('profile_id', session.user.id);
    const { error } = await q;
    return error ? { ok: false, error: this.translate(error.message) } : { ok: true };
  },

  async reportPost(postId, reason) {
    if (!this.init()) return { ok: false };
    const session = await this.getSession();
    const { error } = await this.sb.from('reports').insert({
      reporter_id: session.user.id,
      target_type: 'post',
      target_id: postId,
      reason: reason || 'Uyğunsuz məzmun'
    });
    return error ? { ok: false, error: this.translate(error.message) } : { ok: true };
  },

  async selectCompanyPlan(planId) {
    if (!this.init()) return { ok: false };
    const session = await this.getSession();
    const { data, error } = await this.sb.rpc('select_company_plan', { p_plan_id: planId });
    return error ? { ok: false, error: this.translate(error.message) } : { ok: true, row: data, userId: session.user.id };
  },

  async addComment(postId, body) {
    if (!this.init()) return { ok: false };
    const session = await this.getSession();
    const { data, error } = await this.sb.from('post_comments')
      .insert({ post_id: postId, author_id: session.user.id, body }).select().single();
    return error ? { ok: false, error: this.translate(error.message) } : { ok: true, row: data };
  },

  /* ---------------------------------------------------------------- *
   * Tələbə güzəştləri və QR
   * ---------------------------------------------------------------- */

  async benefits() {
    if (!this.init()) return { ok: false, rows: [] };
    const [partners, offers, claims] = await Promise.all([
      this.sb.from('benefit_partners').select('*').order('name'),
      this.sb.from('benefits').select('*').eq('active', true),
      this.sb.from('benefit_claims').select('*').order('claimed_at', { ascending: false })
    ]);
    const bad = [partners, offers, claims].find(r => r.error);
    if (bad) return { ok: false, rows: [], error: this.translate(bad.error.message) };

    const byId = {};
    partners.data.forEach(p => { byId[p.id] = p; });
    return {
      ok: true,
      partners: partners.data,
      rows: offers.data.map(o => ({
        id: o.id,
        title: o.title,
        description: o.description || '',
        discount: o.discount_label || '',
        terms: o.terms || '',
        validTo: o.valid_to,
        partner: (byId[o.partner_id] || {}).name || '',
        category: (byId[o.partner_id] || {}).category || '',
        emoji: (byId[o.partner_id] || {}).emoji || '◈'
      })),
      claims: claims.data
    };
  },

  /** Güzəşt kodu alır — kod serverdə yaradılır, klient onu təyin edə bilmir. */
  async claimBenefit(benefitId) {
    if (!this.init()) return { ok: false };
    const { data, error } = await this.sb.rpc('claim_benefit', { p_benefit: benefitId });
    return error ? { ok: false, error: this.translate(error.message) } : { ok: true, row: data };
  },

  /** Partnyor / Karyera Mərkəzi kodu təsdiqləyir. */
  async redeemCode(code) {
    if (!this.init()) return { ok: false };
    const { data, error } = await this.sb.rpc('redeem_benefit_code', { p_code: code });
    if (error) return { ok: false, error: this.translate(error.message) };
    return { ok: true, row: Array.isArray(data) ? data[0] : data };
  },

  /* ---------------------------------------------------------------- *
   * Serverdəki uyğunluq funksiyası
   * Yerli match.js ilə eyni formuladır; böyük datada SQL tərəfi sürətlidir.
   * ---------------------------------------------------------------- */

  async rankedJobs() {
    if (!this.init()) return { ok: false, rows: [] };
    const { data, error } = await this.sb.rpc('ranked_jobs_for');
    return error ? { ok: false, rows: [], error: this.translate(error.message) } : { ok: true, rows: data };
  }
};

/* ==================================================================== *
 * Baza sətirlərini v2-nin gözlədiyi formaya çevirən adapterlər
 * ==================================================================== */

const JOB_TYPE_LABEL = { is: 'İş', tecrube: 'Təcrübə', graduate: 'Graduate', konullu: 'Könüllülük' };
const JOB_TYPE_DB    = { 'İş': 'is', 'Təcrübə': 'tecrube', 'Graduate': 'graduate', 'Könüllülük': 'konullu' };
const APP_STATUS_LABEL = {
  gonderildi: 'Göndərildi', baxilir: 'Baxılır', musahibe: 'Müsahibəyə dəvət',
  teklif: 'Təklif', imtina: 'İmtina', geri_goturuldu: 'Geri götürüldü',
  applied: 'Göndərildi', under_review: 'Baxılır', shortlisted: 'Qısa siyahı',
  interview: 'Müsahibə', offer: 'Təklif', rejected: 'İmtina', hired: 'İşə qəbul'
};

const Adapt = {
  notifications(personal, broadcasts, reads) {
    const readByBroadcast = new Map((reads || []).map(row => [String(row.broadcast_id), row.read_at]));
    const own = (personal || []).map(row => ({
      id: `personal:${row.id}`, rawId: row.id, source: 'personal', kind: row.kind,
      title: row.title, body: row.body || '', link: row.link || 'dashboard',
      readAt: row.read_at || null, createdAt: row.created_at
    }));
    const shared = (broadcasts || []).map(row => ({
      id: `broadcast:${row.id}`, rawId: row.id, source: 'broadcast', kind: row.kind,
      title: row.title, body: row.body || '', link: row.link || 'dashboard',
      readAt: readByBroadcast.get(String(row.id)) || null, createdAt: row.created_at
    }));
    return [...own, ...shared].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  },

  /** faculties + majors sətirlərindən FACULTIES/MAJOR_FIELD quruluşunu yaradır. */
  taxonomy(faculties, majors) {
    const byId = {};
    const tree = {};
    const fieldOf = {};
    const majorIdByName = {};
    const facultyIdByName = {};

    faculties.forEach(f => { byId[f.id] = f.name; tree[f.name] = []; facultyIdByName[f.name] = f.id; });
    majors.forEach(m => {
      const fname = byId[m.faculty_id];
      if (!fname) return;
      tree[fname].push(m.name);
      fieldOf[m.name] = m.field;
      majorIdByName[m.name] = m.id;
    });
    return { tree, fieldOf, majorIdByName, facultyIdByName, facultyNameById: byId,
             majorNameById: majors.reduce((a, m) => (a[m.id] = m.name, a), {}) };
  },

  /** jobs sətrini v2 elan obyektinə çevirir. */
  job(row, tax, companyNameById) {
    return {
      id: row.id,
      companyId: row.company_id,
      company: companyNameById[row.company_id] || '',
      title: row.title,
      type: JOB_TYPE_LABEL[row.type] || row.type,
      mode: row.mode,
      location: row.location,
      deadline: row.deadline,
      duration: row.duration,
      pay: row.pay,
      faculties: (row.faculty_ids || []).map(id => tax.facultyNameById[id]).filter(Boolean),
      majors: (row.major_ids || []).map(id => tax.majorNameById[id]).filter(Boolean),
      skills: row.skills || [],
      minCourse: row.min_course || 1,
      minGPA: Number(row.min_gpa) || 0,
      status: row.status === 'pending_approval' || row.status === 'changes_requested' ? 'pending'
        : row.status === 'published' ? 'approved' : row.status,
      postedAt: (row.created_at || '').slice(0, 10),
      summary: row.summary || '',
      duties: row.duties || [],
      requirements: row.requirements || []
    };
  },

  /** v2 profil obyektini baza sütunlarına çevirir. */
  profileToDb(p, tax) {
    return {
      full_name: p.name,
      account_status: p.accountStatus || 'student',
      personal_email: p.personalEmail || null,
      phone: p.phone,
      city: p.city,
      faculty_id: tax.facultyIdByName[p.faculty] || null,
      major_id: tax.majorIdByName[p.major] || null,
      course: Number(p.course) || null,
      gpa: p.gpa === '' || p.gpa == null ? null : Number(p.gpa),
      skills: p.skills || [],
      languages: p.languages,
      certificates: p.certificates,
      summary: p.summary,
      linkedin: p.linkedin,
      github: p.github,
      portfolio: p.portfolio
    };
  },

  /** baza profilini v2 formasına çevirir. */
  profileFromDb(row, tax) {
    return {
      name: row.full_name || '',
      email: row.email || '',
      personalEmail: row.personal_email || '',
      accountStatus: row.account_status || (row.role === 'graduate' ? 'graduate' : 'student'),
      alumniVerified: !!row.alumni_verified,
      phone: row.phone || '',
      city: row.city || 'Bakı, Azərbaycan',
      /* Fakültə seçilməyibsə BOŞ qalır — susmaya görə birinci fakültəni
         qoymaq yanlış uyğunluq faizləri göstərərdi. */
      faculty: tax.facultyNameById[row.faculty_id] || '',
      major: tax.majorNameById[row.major_id] || '',
      course: row.course || 1,
      startYear: row.start_year || new Date().getFullYear(),
      gpa: row.gpa == null ? '' : Number(row.gpa),
      skills: row.skills || [],
      languages: row.languages || '',
      certificates: row.certificates || '',
      summary: row.summary || '',
      linkedin: row.linkedin || '',
      github: row.github || '',
      portfolio: row.portfolio || '',
      cvReady: !!row.cv_url,
      education: [],
      experience: [],
      projects: []
    };
  },

  application(row, jobTitleById) {
    return {
      id: row.id,
      jobId: row.job_id,
      jobTitle: jobTitleById[row.job_id] || '',
      studentId: row.student_id,
      at: (row.created_at || '').slice(0, 10),
      status: APP_STATUS_LABEL[row.status] || row.status,
      statusKey: row.status,
      note: row.note || ''
    };
  },

  jobTypeToDb(label) { return JOB_TYPE_DB[label] || 'is'; }
};
