/*!
 * ADNSU Career — şirkətlər üçün Talent Pool, namizəd müqayisəsi,
 * müsahibə təqvimi və universitetlə əməkdaşlıq.
 * Backend RLS is authoritative; browser filtering is presentation only.
 */
const EmployerTools = {
  ui: {
    q: '', faculty: 'all', major: 'all', course: 'all', gpa: 'all',
    skill: 'all', order: 'match', job: 'all', compare: [],
    month: new Date().getUTCFullYear() * 12 + new Date().getUTCMonth(),
    selectedDay: '', busy: false, error: ''
  },
  appointments: [],
  partnerships: [],
  loaded: { calendar: false, partnerships: false, adminPartnerships: false },
  userId: null,

  applications() {
    const owned = new Set(Store.companyJobs().map(job => String(job.id)));
    return (Store.state.applications || []).filter(a => owned.has(String(a.jobId)) && a.id);
  },
  resetSession() {
    const uid = Store.state.session?.userId || '';
    if (this.userId === uid) return;
    this.userId = uid;
    this.appointments = [];
    this.partnerships = [];
    this.loaded = { calendar: false, partnerships: false, adminPartnerships: false };
    this.ui.compare = [];
    this.ui.error = '';
  },
  async load(section, force = false) {
    this.resetSession();
    if (!force && this.loaded[section]) return;
    this.ui.busy = true;
    this.ui.error = '';
    const isCalendar = section === 'calendar';
    let result;
    try {
      result = Store.mode === 'supabase'
        ? await (isCalendar ? Backend.employerListInterviews() : Backend.employerListPartnerships())
        : { ok: true, rows: isCalendar
          ? (Store.state.demoInterviewSlots || [])
          : (Store.state.demoPartnershipRequests || []) };
    } catch (error) {
      result = { ok:false, error:String(error?.message || 'Bağlantı xətası') };
    }
    this.ui.busy = false;
    if (!result.ok) this.ui.error = result.error || 'Məlumatları yükləmək mümkün olmadı.';
    else {
      if (isCalendar) this.appointments = result.rows;
      else this.partnerships = result.rows;
      this.loaded[section] = true;
    }
    if (Store.state.view === section || (section === 'adminPartnerships' && Store.state.view === 'partnerships-admin'))
      render();
  },
  afterNavigate(view) {
    if (view === 'calendar') this.load('calendar');
    if (view === 'partnerships') this.load('partnerships');
    if (view === 'partnerships-admin') this.load('adminPartnerships');
  },

  stamp(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return '—';
    return d.toLocaleString('az-AZ', {timeZone:'Asia/Baku',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  },
  dayKey(iso) {
    if (!iso) return '';
    const parts = new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Baku',year:'numeric',month:'2-digit',day:'2-digit'})
      .formatToParts(new Date(iso));
    const p = Object.fromEntries(parts.map(x => [x.type,x.value]));
    return p.year+'-'+p.month+'-'+p.day;
  },
  fullName(studentId) {
    const item = STUDENT_POOL.find(student => String(student.id) === String(studentId));
    return item?.name || 'Namizəd';
  },
  jobTitle(applicationId) {
    const app = this.applications().find(item => String(item.id) === String(applicationId));
    return app?.jobTitle || (app && Store.jobById(app.jobId)?.title) || 'Vakansiya';
  }
};

Object.assign(Backend, {
  async employerListInterviews() {
    if (!this.init()) return {ok:false,error:'Server bağlantısı yoxdur.'};
    const {data,error} = await this.sb.from('company_interview_slots').select('*')
      .order('starts_at',{ascending:true}).limit(500);
    return error ? {ok:false,error:this.translate(error.message)} : {ok:true,rows:data||[]};
  },
  async employerScheduleInterview(fields) {
    if (!this.init()) return {ok:false,error:'Server bağlantısı yoxdur.'};
    const {data,error} = await this.sb.from('company_interview_slots')
      .insert(fields).select().single();
    return error ? {ok:false,error:this.translate(error.message)} : {ok:true,row:data};
  },
  async employerSetInterviewStatus(id,status) {
    if (!this.init()) return {ok:false,error:'Server bağlantısı yoxdur.'};
    const {error} = await this.sb.from('company_interview_slots').update({status}).eq('id',id);
    return error ? {ok:false,error:this.translate(error.message)} : {ok:true};
  },
  async employerListPartnerships() {
    if (!this.init()) return {ok:false,error:'Server bağlantısı yoxdur.'};
    const {data,error} = await this.sb.from('company_partnership_requests').select('*')
      .order('created_at',{ascending:false}).limit(500);
    return error ? {ok:false,error:this.translate(error.message)} : {ok:true,rows:data||[]};
  },
  async employerCreatePartnership(fields) {
    if (!this.init()) return {ok:false,error:'Server bağlantısı yoxdur.'};
    const {data,error} = await this.sb.from('company_partnership_requests')
      .insert(fields).select().single();
    return error ? {ok:false,error:this.translate(error.message)} : {ok:true,row:data};
  },
  async employerReviewPartnership(id,fields) {
    if (!this.init()) return {ok:false,error:'Server bağlantısı yoxdur.'};
    const {error} = await this.sb.from('company_partnership_requests').update(fields).eq('id',id);
    return error ? {ok:false,error:this.translate(error.message)} : {ok:true};
  }
});

const EMP_PARTNERSHIP_CATEGORIES = {
  career_day:'Karyera günü', workshop:'Workshop / təlim',
  campus_visit:'Müəssisə ziyarəti', internship:'Təcrübə proqramı',
  capstone:'Diplom / real layihə', guest_lecture:'Qonaq mühazirə',
  other:'Digər əməkdaşlıq'
};
const EMP_PARTNERSHIP_STATUS = {
  submitted:'Göndərilib', reviewing:'Baxılır',
  approved:'Təsdiqlənib', rejected:'İmtina', completed:'Tamamlanıb'
};
const EMP_INTERVIEW_STATUS = {
  scheduled:'Planlaşdırılıb', completed:'Tamamlanıb', cancelled:'Ləğv edilib'
};

function viewEmployerTalentPool() {
  EmployerTools.resetSession();
  if (!companyCanUse('candidate_search')) return '<div class="page-head"><div><h1>Talent Pool</h1><p>Namizəd bazasında qabaqcıl axtarış üçün aktiv Pro və ya Business paketi tələb olunur.</p></div></div>' +
    emptyState('Namizəd bazasına giriş bağlıdır','Paketlərə baxaraq namizəd axtarışını aktivləşdirə bilərsiniz.','<button class="btn primary" data-act="go" data-view="subscription">Paketlərə bax</button>');
  const f=EmployerTools.ui;
  const pool=STUDENT_POOL.slice();
  const faculties=[...new Set(pool.map(s=>s.faculty).filter(Boolean))].sort();
  const majors=[...new Set(pool.filter(s=>f.faculty==='all'||s.faculty===f.faculty).map(s=>s.major).filter(Boolean))].sort();
  const skills=[...new Set(pool.flatMap(s=>s.skills||[]).filter(Boolean))].sort();
  let list=pool.filter(s=>{
    if (f.q && !(String(s.name)+' '+String(s.major)+' '+(s.skills||[]).join(' ')).toLocaleLowerCase('az-AZ').includes(f.q.toLocaleLowerCase('az-AZ'))) return false;
    if (f.faculty!=='all'&&s.faculty!==f.faculty) return false;
    if (f.major!=='all'&&s.major!==f.major) return false;
    if (f.course!=='all'&&Number(s.course)!==Number(f.course)) return false;
    if (f.gpa!=='all'&&Number(s.gpa)<Number(f.gpa)) return false;
    if (f.skill!=='all'&&!(s.skills||[]).includes(f.skill)) return false;
    return true;
  });
  const job=Store.companyJobs().find(j=>String(j.id)===String(f.job));
  if (f.order==='gpa') list.sort((a,b)=>Number(b.gpa)-Number(a.gpa));
  else if (f.order==='course') list.sort((a,b)=>Number(b.course)-Number(a.course));
  else if (f.order==='name') list.sort((a,b)=>String(a.name).localeCompare(String(b.name),'az'));
  else if(job) list.sort((a,b)=>matchReport(job,b).score-matchReport(job,a).score);
  else list.sort((a,b)=>Number(b.gpa)-Number(a.gpa));
  const options=(items,value,defaultText)=>'<option value="all">'+defaultText+'</option>'+
    items.map(x=>'<option value="'+esc(x)+'"'+(String(value)===String(x)?' selected':'')+'>'+esc(x)+'</option>').join('');
  return '<div class="page-head"><div><div class="eyebrow">Şirkət · Talent Pool</div><h1>Geniş namizəd axtarışı</h1>'+
    '<p>Bacarıq, ixtisas, fakültə, kurs və akademik göstəricilər əsasında seçim edin.</p></div>'+
    '<button class="btn" data-act="em-filter-reset">Filtrləri təmizlə</button></div>'+
    '<div class="card em-filter-panel"><div class="em-filter-grid">'+
    '<div class="field"><label for="em-q">Axtarış</label><input id="em-q" data-em-filter="q" type="search" value="'+esc(f.q)+'" placeholder="Ad, ixtisas və ya bacarıq"></div>'+
    '<div class="field"><label>Fakültə</label><select data-em-filter="faculty">'+options(faculties,f.faculty,'Bütün fakültələr')+'</select></div>'+
    '<div class="field"><label>İxtisas</label><select data-em-filter="major">'+options(majors,f.major,'Bütün ixtisaslar')+'</select></div>'+
    '<div class="field"><label>Kurs</label><select data-em-filter="course">'+options([1,2,3,4],f.course,'Bütün kurslar')+'</select></div>'+
    '<div class="field"><label>Minimum GPA</label><select data-em-filter="gpa">'+options([60,70,80,90],f.gpa,'İstənilən GPA')+'</select></div>'+
    '<div class="field"><label>Bacarıq</label><select data-em-filter="skill">'+options(skills,f.skill,'Bütün bacarıqlar')+'</select></div>'+
    '<div class="field"><label>Uyğunluq üçün vakansiya</label><select data-em-filter="job">'+
      options(Store.companyJobs().map(j=>String(j.id)),f.job,'Seçilməyib').replace(/>([^<]+)<\/option>/g,(full,id)=>{
        const v=Store.companyJobs().find(j=>String(j.id)===id);
        return '>'+esc(v?.title||id)+'</option>';
      })+'</select></div>'+
    '<div class="field"><label>Sıralama</label><select data-em-filter="order">'+
      [['match','Uyğunluq / GPA'],['gpa','Ən yüksək GPA'],['course','Ən yuxarı kurs'],['name','Ada görə']].map(item=>'<option value="'+item[0]+'"'+(f.order===item[0]?' selected':'')+'>'+item[1]+'</option>').join('')+
    '</select></div></div></div>'+
    '<div class="section-head"><h2>'+list.length+' uyğun namizəd</h2><span class="hint">Yalnız səlahiyyətiniz çatan profillər</span></div>'+
    (list.length?'<div class="grid c3">'+list.slice(0,100).map(s=>{
      const report=job?matchReport(job,s):null;
      return '<article class="card em-candidate-card"><div class="row" style="gap:10px"><div class="brandbox">'+esc(initials(s.name))+'</div>'+
      '<div><b>'+esc(s.name)+'</b><div class="em-muted">'+esc(s.major||'İxtisas göstərilməyib')+'</div></div></div>'+
      '<div class="em-muted">'+esc(s.faculty||'')+' · '+esc(s.course||'—')+'. kurs · GPA '+esc(s.gpa||'—')+'</div>'+
      '<div class="skillrow">'+(s.skills||[]).slice(0,5).map(t=>'<span class="sk">'+esc(t)+'</span>').join('')+'</div>'+
      (report?'<div class="em-score">'+(report.eligible?'Uyğunluq':'Şərtləri tam ödəmir')+': <b>'+report.score+'%</b></div>':'')+
      '<div class="em-muted">Namizədlə əlaqə üçün müvafiq vakansiyaya dəvət göndərin.</div></article>';
    }).join('')+'</div>':emptyState('Namizəd tapılmadı','Filtrləri dəyişdirərək yenidən yoxlayın.'))+
    '<p class="em-privacy">Şirkətlər yalnız bazanın icazə verdiyi məlumatları görə bilir. Tələbələrin şəxsi CV faylları avtomatik açılmır.</p>';
}

function viewEmployerComparison() {
  EmployerTools.resetSession();
  const apps=EmployerTools.applications();
  const selected=EmployerTools.ui.compare;
  const own=apps.filter(a=>selected.includes(String(a.id))).slice(0,3);
  return '<div class="page-head"><div><div class="eyebrow">Şirkət · seçim alətləri</div><h1>Namizədlərin CV/profil müqayisəsi</h1>'+
    '<p>Yalnız sizin vakansiyalarınıza müraciət edən namizədlərdən 2–3 nəfər seçin.</p></div></div>'+
    '<div class="em-compare-layout"><section class="card em-panel"><h2>Müraciət edənlər</h2>'+
    '<p class="em-muted">Müqayisə: '+selected.length+'/3 nəfər seçilib</p>'+
    (apps.length?'<div class="em-select-list">'+apps.map(a=>{
      const student=STUDENT_POOL.find(s=>String(s.id)===String(a.studentId));
      return '<label class="em-select-row"><input type="checkbox" data-em-compare="'+esc(a.id)+'"'+(selected.includes(String(a.id))?' checked':'')+
        (selected.length>=3&&!selected.includes(String(a.id))?' disabled':'')+'>'+
        '<span><b>'+esc(student?.name||'Namizəd')+'</b><small>'+esc(Store.jobById(a.jobId)?.title||a.jobTitle||'Vakansiya')+'</small></span></label>';
    }).join('')+'</div>': '<div class="em-empty">Şirkətinizin vakansiyalarına müraciət daxil olduqda namizədləri burada müqayisə edə bilərsiniz.</div>')+
    '</section><section class="card em-panel"><h2>Yan-yana müqayisə</h2>'+
    (own.length<2?'<div class="em-empty">Müqayisə üçün ən azı 2 namizəd seçin.</div>':
      '<div class="em-compare-scroll"><table class="em-compare-table"><thead><tr><th>Göstərici</th>'+
      own.map(a=>'<th>'+esc(EmployerTools.fullName(a.studentId))+'</th>').join('')+'</tr></thead><tbody>'+
      [
        ['Müraciət edilən vakansiya',a=>Store.jobById(a.jobId)?.title||a.jobTitle||'—'],
        ['Fakültə',a=>STUDENT_POOL.find(s=>String(s.id)===String(a.studentId))?.faculty||'Məlumat yoxdur'],
        ['İxtisas',a=>STUDENT_POOL.find(s=>String(s.id)===String(a.studentId))?.major||'Məlumat yoxdur'],
        ['Kurs',a=>STUDENT_POOL.find(s=>String(s.id)===String(a.studentId))?.course||'—'],
        ['GPA',a=>STUDENT_POOL.find(s=>String(s.id)===String(a.studentId))?.gpa||'—'],
        ['Bacarıqlar',a=>(STUDENT_POOL.find(s=>String(s.id)===String(a.studentId))?.skills||[]).join(', ')||'—'],
        ['Vakansiyaya uyğunluq',a=>{
          const p=STUDENT_POOL.find(s=>String(s.id)===String(a.studentId)),j=Store.jobById(a.jobId);
          return p&&j?matchReport(j,p).score+'%':'—';
        }],
        ['Müraciətin mərhələsi',a=>a.status||'—']
      ].map(row=>'<tr><th>'+row[0]+'</th>'+own.map(a=>'<td>'+esc(row[1](a))+'</td>').join('')+'</tr>').join('')+
      '</tbody></table></div>')+
    '<p class="em-privacy">Müqayisə tələbələrin müraciət zamanı işəgötürənə açılan profil göstəricilərinə əsaslanır. PDF CV fayllarının məzmunu oxunmur və heç bir namizəd barədə avtomatik qərar verilmir.</p></section></div>';
}

function viewEmployerCalendar() {
  EmployerTools.resetSession();
  const em=EmployerTools;
  const y=Math.floor(em.ui.month/12),m=em.ui.month%12;
  const monthStart=new Date(Date.UTC(y,m,1));
  const title=monthStart.toLocaleString('az-AZ',{month:'long',year:'numeric',timeZone:'UTC'});
  const first=(monthStart.getUTCDay()+6)%7;
  const days=new Date(Date.UTC(y,m+1,0)).getUTCDate();
  const appointments=em.appointments.filter(row=>em.applications().some(a=>String(a.id)===String(row.application_id)));
  const onDay=new Map();
  appointments.forEach(slot=>{
    const d=em.dayKey(slot.starts_at);
    if(!onDay.has(d))onDay.set(d,[]);
    onDay.get(d).push(slot);
  });
  let cells='';
  for(let i=0;i<first;i++)cells+='<div class="em-day muted"></div>';
  for(let d=1;d<=days;d++){
    const key=y+'-'+String(m+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    const items=onDay.get(key)||[];
    cells+='<button type="button" class="em-day'+(em.ui.selectedDay===key?' selected':'')+'" data-em-day="'+key+'"><b>'+d+'</b>'+
      items.slice(0,2).map(item=>'<small class="'+(item.status==='cancelled'?'cancelled':'')+'">'+esc(em.stamp(item.starts_at).slice(-5))+' · '+esc(em.fullName(em.applications().find(a=>String(a.id)===String(item.application_id))?.studentId))+'</small>').join('')+
      (items.length>2?'<small>+'+(items.length-2)+' daha</small>':'')+'</button>';
  }
  const options=em.applications().map(a=>'<option value="'+esc(a.id)+'">'+esc(em.fullName(a.studentId))+' — '+esc(Store.jobById(a.jobId)?.title||a.jobTitle||'Vakansiya')+'</option>').join('');
  return '<div class="page-head"><div><div class="eyebrow">Şirkət · Interview Scheduler</div><h1>Müsahibə təqvimi</h1>'+
    '<p>Vakansiyanıza müraciət etmiş namizəd üçün görüş vaxtı təyin edin. Bildiriş tələbəyə göndərilir.</p></div>'+
    '<button class="btn" data-em-refresh="calendar">Yenilə</button></div>'+
    (em.ui.error?'<div class="note warn">'+esc(em.ui.error)+'</div>':'')+
    (Store.mode!=='supabase'?'<div class="note">Demo rejimi: vaxtlar yalnız bu brauzerdə saxlanılır, bildiriş göndərilmir.</div>':'')+
    '<div class="em-calendar-layout"><section class="card em-panel"><div class="em-calendar-toolbar">'+
      '<h2>'+esc(title)+'</h2><div class="row tight"><button class="btn sm" data-em-month="-1" aria-label="Əvvəlki ay">←</button>'+
      '<button class="btn sm" data-em-month="1" aria-label="Sonrakı ay">→</button></div></div>'+
      '<div class="em-calendar-week">'+['B.e','Ç.a','Ç','C.a','C','Ş','B'].map(d=>'<b>'+d+'</b>').join('')+'</div>'+
      '<div class="em-calendar-days">'+cells+'</div></section>'+
    '<section class="card em-panel"><h2>Yeni müsahibə</h2><p class="em-muted">Bütün vaxtlar Bakı saatı (UTC+4) ilə göstərilir.</p>'+
    (!options?'<div class="em-empty">Vaxt təyin etmək üçün əvvəlcə vakansiyanıza müraciət daxil olmalıdır.</div>':
      '<form data-em-form="interview" class="em-form">'+
      '<label>Namizəd / vakansiya<select name="application_id" required>'+options+'</select></label>'+
      '<div class="em-form-two"><label>Tarix<input name="date" type="date" required value="'+esc(em.ui.selectedDay||'')+'"></label>'+
      '<label>Saat<input name="time" type="time" value="10:00" required></label></div>'+
      '<div class="em-form-two"><label>Müddət<select name="duration_minutes">'+[30,45,60,90].map(n=>'<option value="'+n+'"'+(n===45?' selected':'')+'>'+n+' dəq</option>').join('')+'</select></label>'+
      '<label>Format<select name="meeting_mode"><option value="on_site">Əyani</option><option value="online">Onlayn</option><option value="phone">Telefon</option></select></label></div>'+
      '<label>Məkan<input name="location" maxlength="300" placeholder="Bakı, ofis / ünvan"></label>'+
      '<label>Görüş linki (onlayn)<input name="meeting_url" type="url" placeholder="https://..." maxlength="1000"></label>'+
      '<label>Qısa qeyd<textarea name="notes" maxlength="2000" rows="2" placeholder="Namizədə göndəriləcək qeydlər"></textarea></label>'+
      '<button class="btn primary block" type="submit"'+(em.ui.busy?' disabled':'')+'>Müsahibəni təyin et</button></form>')+
    '</section></div>'+
    '<section class="section"><div class="section-head"><h2>Təyin edilmiş görüşlər</h2><span class="hint">'+appointments.length+' qeyd</span></div>'+
    (appointments.length?'<div class="table-wrap"><table><thead><tr><th>Vaxt</th><th>Namizəd</th><th>Vakansiya</th><th>Format</th><th>Status</th><th></th></tr></thead><tbody>'+
      appointments.map(slot=>{
        const a=em.applications().find(item=>String(item.id)===String(slot.application_id));
        return '<tr><td>'+esc(em.stamp(slot.starts_at))+'</td><td>'+esc(em.fullName(a?.studentId))+'</td>'+
          '<td>'+esc(em.jobTitle(slot.application_id))+'</td><td>'+esc(({on_site:'Əyani',online:'Onlayn',phone:'Telefon'})[slot.meeting_mode]||slot.meeting_mode)+'</td>'+
          '<td><span class="chip '+(slot.status==='scheduled'?'good':'line')+'">'+esc(EMP_INTERVIEW_STATUS[slot.status]||slot.status)+'</span></td>'+
          '<td>'+(slot.status==='scheduled'?
            '<button class="btn sm" data-em-interview-status="completed" data-id="'+esc(slot.id)+'">Tamamla</button> '+
            '<button class="btn sm danger" data-em-interview-status="cancelled" data-id="'+esc(slot.id)+'">Ləğv et</button>':'')+'</td></tr>';
      }).join('')+'</tbody></table></div>':emptyState('Təqvim boşdur','Müraciət edən namizədlərə müsahibə vaxtı təyin edin.'))+'</section>';
}

function viewEmployerPartnerships() {
  EmployerTools.resetSession();
  const em=EmployerTools, co=Store.state.company||{};
  const rows=em.partnerships.filter(r=>String(r.company_id)===String(co.id));
  return '<div class="page-head"><div><div class="eyebrow">ADNSU · sənaye əməkdaşlığı</div><h1>Universitetlə əməkdaşlıq</h1>'+
    '<p>Karyera günü, seminar, təcrübə proqramı və real layihə təkliflərini Karyera Mərkəzinə göndərin.</p></div>'+
    '<button class="btn" data-em-refresh="partnerships">Yenilə</button></div>'+
    (em.ui.error?'<div class="note warn">'+esc(em.ui.error)+'</div>':'')+
    (Store.mode!=='supabase'?'<div class="note">Demo rejimi: sorğular yalnız brauzerdə saxlanılır və universitetə göndərilmir.</div>':'')+
    '<div class="em-calendar-layout"><section class="card em-panel"><h2>Yeni əməkdaşlıq təklifi</h2>'+
    '<form data-em-form="partnership" class="em-form">'+
    '<label>Əməkdaşlıq növü<select name="category" required>'+Object.entries(EMP_PARTNERSHIP_CATEGORIES).map(row=>'<option value="'+row[0]+'">'+esc(row[1])+'</option>').join('')+'</select></label>'+
    '<label>Təklifin adı<input name="title" minlength="5" maxlength="160" required placeholder="Mühəndislik təcrübə proqramı"></label>'+
    '<label>Ətraflı məlumat<textarea name="details" minlength="20" maxlength="4000" rows="6" required placeholder="Məqsəd, iştirakçılar, gözlənilən nəticə və təşkilati ehtiyaclar"></textarea></label>'+
    '<label>Üstünlük verilən tarix (istəyə bağlı)<input type="date" name="preferred_date"></label>'+
    '<label>Əlaqə e-poçtu<input type="email" maxlength="200" name="contact_email" required value="'+esc(co.email||'')+'"></label>'+
    '<button class="btn primary block" type="submit"'+(em.ui.busy?' disabled':'')+'>Müraciəti göndər →</button></form></section>'+
    '<section class="card em-panel"><h2>Müraciətləriniz</h2>'+
    (rows.length?'<div class="em-requests">'+rows.map(r=>'<article class="em-request"><div class="row" style="justify-content:space-between;align-items:flex-start;gap:10px">'+
      '<b>'+esc(r.title)+'</b><span class="chip '+(r.status==='approved'?'good':r.status==='rejected'?'warn':'line')+'">'+
      esc(EMP_PARTNERSHIP_STATUS[r.status]||r.status)+'</span></div><div class="em-muted">'+
      esc(EMP_PARTNERSHIP_CATEGORIES[r.category]||r.category)+' · '+esc(em.stamp(r.created_at))+'</div>'+
      '<p>'+esc(r.details)+'</p>'+
      (r.admin_note?'<div class="note">'+esc(r.admin_note)+'</div>':'')+'</article>').join('')+'</div>':
      '<div class="em-empty">'+(em.ui.busy?'Müraciətlər yüklənir…':'Hələ müraciət göndərilməyib.')+'</div>')+
    '</section></div>';
}

function viewEmployerAdminPartnerships() {
  EmployerTools.resetSession();
  const em=EmployerTools, rows=em.partnerships;
  return '<div class="page-head"><div><div class="eyebrow">Karyera Mərkəzi · əməkdaşlıq</div><h1>Şirkət əməkdaşlıq sorğuları</h1>'+
    '<p>Şirkətlərin göndərdiyi təklifləri qiymətləndirin və statuslarını yeniləyin.</p></div>'+
    '<button class="btn" data-em-refresh="adminPartnerships">Yenilə</button></div>'+
    (em.ui.error?'<div class="note warn">'+esc(em.ui.error)+'</div>':'')+
    (rows.length?'<div class="em-requests">'+rows.map(r=>{
      const company=companyOf(r.company_id);
      return '<article class="card em-panel em-request"><div class="row" style="justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><div>'+
        '<div class="eyebrow">'+esc(company.name||'Şirkət')+' · '+esc(EMP_PARTNERSHIP_CATEGORIES[r.category]||r.category)+'</div><h2>'+esc(r.title)+'</h2>'+
        '<div class="em-muted">'+esc(r.contact_email)+' · '+esc(em.stamp(r.created_at))+
          (r.preferred_date?' · Təklif olunan tarix: '+esc(r.preferred_date):'')+'</div></div>'+
        '<span class="chip">'+esc(EMP_PARTNERSHIP_STATUS[r.status]||r.status)+'</span></div><p>'+esc(r.details)+'</p>'+
        '<form data-em-form="review" data-id="'+esc(r.id)+'" class="em-form">'+
          '<div class="em-form-two"><label>Status<select name="status">'+Object.entries(EMP_PARTNERSHIP_STATUS).map(x=>
            '<option value="'+x[0]+'"'+(r.status===x[0]?' selected':'')+'>'+esc(x[1])+'</option>').join('')+'</select></label>'+
          '<label>Admin qeydi<input name="admin_note" maxlength="2000" value="'+esc(r.admin_note||'')+'"></label></div>'+
          '<button class="btn sm primary" type="submit">Qərarı saxla</button></form></article>';
    }).join('')+'</div>':emptyState('Sorğu yoxdur','Şirkətlər təklif göndərdikdə burada görünəcək.')) ;
}

document.addEventListener('change',e=>{
  const el=e.target;
  if(el.dataset.emFilter){
    const key=el.dataset.emFilter;
    EmployerTools.ui[key]=el.value;
    if(key==='faculty') EmployerTools.ui.major='all';
    render();
  }
  if(el.dataset.emCompare){
    const id=String(el.dataset.emCompare);
    const selected=EmployerTools.ui.compare;
    if(el.checked&&!selected.includes(id)&&selected.length<3)selected.push(id);
    if(!el.checked)EmployerTools.ui.compare=selected.filter(x=>x!==id);
    render();
  }
});
document.addEventListener('input',e=>{
  if(e.target.dataset.emFilter!=='q')return;
  EmployerTools.ui.q=e.target.value;
  if(typeof renderKeepFocus==='function')renderKeepFocus('em-q');
  else render();
});
document.addEventListener('click',async e=>{
  const node=e.target.closest('[data-em-refresh],[data-em-month],[data-em-day],[data-em-filter-reset],[data-em-interview-status]');
  if(!node)return;
  if(node.dataset.emRefresh){
    await EmployerTools.load(node.dataset.emRefresh,true);
    return;
  }
  if(node.dataset.emMonth){
    EmployerTools.ui.month+=Number(node.dataset.emMonth);
    render();
    return;
  }
  if(node.dataset.emDay){
    EmployerTools.ui.selectedDay=node.dataset.emDay;
    render();
    return;
  }
  if(node.hasAttribute('data-em-filter-reset')){
    const f=EmployerTools.ui;
    Object.assign(f,{q:'',faculty:'all',major:'all',course:'all',gpa:'all',skill:'all',job:'all',order:'match'});
    render();
    return;
  }
  if(node.dataset.emInterviewStatus){
    if(EmployerTools.ui.busy)return;
    EmployerTools.ui.busy=true;
    const id=node.dataset.id, status=node.dataset.emInterviewStatus;
    let res;
    if(Store.mode==='supabase')res=await Backend.employerSetInterviewStatus(id,status);
    else {
      const row=EmployerTools.appointments.find(r=>String(r.id)===String(id));
      if(row)row.status=status;
      Store.state.demoInterviewSlots=EmployerTools.appointments;
      Store.save();
      res={ok:true};
    }
    EmployerTools.ui.busy=false;
    if(!res.ok)toast(res.error||'Status saxlanmadı');
    else {toast('Müsahibə statusu yeniləndi'); await EmployerTools.load('calendar',true);}
    render();
  }
});

document.addEventListener('submit',async e=>{
  const form=e.target.closest('[data-em-form]');
  if(!form)return;
  e.preventDefault();
  if(EmployerTools.ui.busy)return;
  const action=form.dataset.emForm, f=new FormData(form), v=k=>String(f.get(k)||'').trim();
  EmployerTools.ui.busy=true;
  let result={ok:false,error:'Əməliyyat tamamlanmadı.'};
  try{
    if(action==='interview'){
      if(!EmployerTools.applications().some(a=>String(a.id)===v('application_id')))throw new Error('Namizəd müraciəti tapılmadı.');
      const dt=v('date')+'T'+v('time')+':00+04:00';
      const when=new Date(dt);
      if(!v('date')||!v('time')||!Number.isFinite(when.getTime())||when<=new Date())throw new Error('Gələcək tarix və vaxt seçin.');
      const url=v('meeting_url');
      if(url&&!/^https:\/\/[^ ]+$/i.test(url))throw new Error('Görüş linki https:// ilə başlamalıdır.');
      const payload={application_id:v('application_id'),starts_at:when.toISOString(),
        duration_minutes:Number(v('duration_minutes'))||45,meeting_mode:v('meeting_mode'),
        location:v('location'),meeting_url:url,notes:v('notes')};
      if(Store.mode==='supabase')result=await Backend.employerScheduleInterview(payload);
      else{
        const row={...payload,id:'demo-'+Date.now(),status:'scheduled',created_at:new Date().toISOString()};
        Store.state.demoInterviewSlots=[...(Store.state.demoInterviewSlots||[]),row];
        Store.save(); result={ok:true,row};
      }
      if(result.ok)await EmployerTools.load('calendar',true);
    }else if(action==='partnership'){
      const company=Store.state.company;
      if(!company?.id)throw new Error('Şirkət profili tapılmadı.');
      const payload={company_id:company.id,category:v('category'),title:v('title'),details:v('details'),
        preferred_date:v('preferred_date')||null,contact_email:v('contact_email')};
      if(payload.title.length<5||payload.details.length<20)throw new Error('Başlıq və təklifin təsvirini tam yazın.');
      if(Store.mode==='supabase')result=await Backend.employerCreatePartnership(payload);
      else{
        const row={...payload,id:'demo-'+Date.now(),status:'submitted',admin_note:'',created_at:new Date().toISOString()};
        Store.state.demoPartnershipRequests=[...(Store.state.demoPartnershipRequests||[]),row];
        Store.save();result={ok:true,row};
      }
      if(result.ok){form.reset();await EmployerTools.load('partnerships',true);}
    }else if(action==='review'){
      const payload={status:v('status'),admin_note:v('admin_note')};
      if(Store.mode==='supabase')result=await Backend.employerReviewPartnership(form.dataset.id,payload);
      else{
        const row=EmployerTools.partnerships.find(r=>String(r.id)===form.dataset.id);
        if(row)Object.assign(row,payload);
        Store.state.demoPartnershipRequests=EmployerTools.partnerships;
        Store.save();result={ok:true};
      }
      if(result.ok)await EmployerTools.load('adminPartnerships',true);
    }
  }catch(error){result={ok:false,error:String(error.message||error)};}
  EmployerTools.ui.busy=false;
  if(result.ok)toast(action==='interview'?'Müsahibə vaxtı təyin edildi':action==='partnership'?'Müraciət Karyera Mərkəzinə göndərildi':'Qərar saxlanıldı');
  else toast(result.error||'Əməliyyat alınmadı');
  render();
});
