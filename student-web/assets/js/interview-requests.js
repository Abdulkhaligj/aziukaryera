/*!
 * ADNSU Career – bidirectional interview requests (students -> employers).
 * Additive SPA extension: does not overwrite original app.js, HR calendar, CV,
 * vacancies, applications or company portal design. Server RLS/RPC enforce roles.
 */
(() => {
  'use strict';
  if (typeof NAV === 'undefined' || typeof VIEWS === 'undefined' ||
      typeof Backend === 'undefined' || typeof Store === 'undefined' ||
      typeof Auth === 'undefined') return;

  const client = {
    rows: [],
    slots: [],
    dbApplications: [],
    names: {},
    loaded: false,
    loading: false,
    saving: false,
    error: '',
    identity: '',
    calendarApplication: null,
    reset() {
      const current=String(Store.state?.session?.userId || Auth.currentUser()?.id || '');
      if (current===this.identity) return;
      this.identity=current;
      this.rows=[]; this.slots=[]; this.dbApplications=[]; this.names={};
      this.loaded=false; this.loading=false; this.saving=false;
      this.error=''; this.calendarApplication=null;
    },
    async load(force=false) {
      this.reset();
      if (this.loading || (!force && this.loaded)) return;
      if (Store.mode !== 'supabase' || !Backend.init()) {
        this.error='Serverə bağlı hesab tələb olunur. Demo rejimində sorğu göndərilmir.';
        this.loaded=true; this.repaint(); return;
      }
      this.loading=true; this.error=''; this.repaint();
      try {
        // Read both data sources. Company-created interviews may not have had a
        // student-originated request; RLS protects all three queries.
        const [requests,slots,applications]=await Promise.all([
          Backend.sb.from('interview_requests')
            .select('id,application_id,student_id,company_id,status,message,reply_note,scheduled_slot_id,created_at,updated_at')
            .order('created_at',{ascending:false}).limit(200),
          Backend.sb.from('company_interview_slots')
            .select('id,application_id,starts_at,duration_minutes,meeting_mode,location,meeting_url,notes,status,created_at')
            .order('starts_at',{ascending:false}).limit(250),
          Backend.sb.from('applications')
            .select('id,job_id,student_id,status,created_at')
            .order('created_at',{ascending:false}).limit(250)
        ]);
        if(requests.error)throw requests.error;
        if(slots.error)throw slots.error;
        if(applications.error)throw applications.error;
        const latestApplications=applications.data||[];
        const names={};
        if(Auth.currentUser()?.role==='company') {
          const ids=[...new Set(latestApplications.map(a=>a.student_id).filter(Boolean))];
          if(ids.length) {
            const profiles=await Backend.sb.from('profiles').select('id,full_name').in('id',ids.slice(0,200));
            if(profiles.error)throw profiles.error;
            (profiles.data||[]).forEach(profile=>{names[String(profile.id)]=profile.full_name||'Namizəd';});
          }
        }
        this.rows=requests.data||[];
        this.slots=slots.data||[];
        this.dbApplications=latestApplications;
        this.names=names;
        this.loaded=true;
      } catch(error) {
        this.error=Backend.translate?.(error.message)||error.message||'Sorğular yüklənmədi.';
      } finally { this.loading=false; this.repaint(); }
    },
    repaint() {
      const view=Store.state?.view;
      if (['interview-requests','interview-inbox'].includes(view) && typeof render==='function') render();
    },
    async rpc(name,fields) {
      if (this.saving || Store.mode!=='supabase' || !Backend.init()) return;
      this.saving=true; this.error=''; this.repaint();
      try {
        const {error}=await Backend.sb.rpc(name,fields);
        if(error) throw error;
        if(typeof toast==='function') toast('Müsahibə sorğusu yeniləndi');
        this.loaded=false;
        this.saving=false;
        await this.load(true);
        if (typeof Backend.notificationsFeed==='function') {
          const note=await Backend.notificationsFeed();
          if(note.ok && Array.isArray(note.rows)) {
            Store.state.notifications=note.rows;
            this.repaint();
          }
        }
      } catch(error) {
        this.error=Backend.translate?.(error.message)||error.message||'Əməliyyat tamamlanmadı.';
        if(typeof toast==='function') toast(this.error);
      } finally { this.saving=false; this.repaint(); }
    },
    ownedApplications() {
      const role=Auth.currentUser()?.role;
      const uid=String(Store.state?.session?.userId||Auth.currentUser()?.id||'');
      const cached=Store.state?.applications||[];
      // DB/RLS is authoritative after loading; stale cached application lists
      // must never hide appointments created after the last app bootstrap.
      const live=this.dbApplications.map(row=>{
        const local=cached.find(a=>String(a.id)===String(row.id))||{};
        return {...local,id:row.id,jobId:row.job_id,studentId:row.student_id,
          status:local.status||row.status,at:local.at||row.created_at};
      });
      const available=this.loaded ? live : cached;
      if(role==='student')return available.filter(a=>a.id && String(a.studentId)===uid);
      if(role==='company') {
        const ownedJobs=new Set((typeof Store.companyJobs==='function'?Store.companyJobs():[])
          .map(j=>String(j.id)));
        return available.filter(a=>a.id && (this.loaded ||
          ownedJobs.has(String(a.jobId))));
      }
      return [];
    }
  };

  const escapeHTML = input => typeof esc==='function'?esc(String(input??'')):String(input??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const E=escapeHTML;
  const statuses={
    pending:['Cavab gözlənilir','warn'],
    accepted:['Qəbul edildi','good'],
    declined:['İmtina edildi','bad'],
    scheduled:['Görüş təyin olundu','good'],
    cancelled:['Ləğv edilib','line']
  };
  const chip = status => {
    const [label,tone]=statuses[status]||[status||'—','line'];
    return '<span class="chip '+tone+'">'+E(label)+'</span>';
  };
  const heading=(label,title,caption)=>'<div class="page-head"><div><div class="eyebrow">'+label+'</div><h1>'+title+'</h1><p>'+caption+'</p></div><button type="button" class="btn" data-ir-refresh="1" aria-label="Sorğuları yenilə">Yenilə</button></div>';
  const note=()=>{
    if(client.error) return '<div class="note warn" role="alert">'+E(client.error)+'</div>';
    if(client.loading) return '<div class="note">Məlumatlar yüklənir…</div>';
    if(Store.mode!=='supabase')return '<div class="note warn">Müsahibə sorğuları yalnız giriş edilmiş real hesabla işləyir.</div>';
    return '';
  };
  const jobName=a=>E(Store.jobById(a?.jobId)?.title||a?.jobTitle||'Vakansiya');
  const companyName=a=>{
    const job=Store.jobById(a?.jobId);
    return E(job && typeof companyOf==='function' ? companyOf(job.companyId)?.name : 'Şirkət');
  };
  const displayDate=iso=>iso?new Date(iso).toLocaleString('az-AZ',{timeZone:'Asia/Baku',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
  const slotsFor=applicationId=>client.slots.filter(slot=>String(slot.application_id)===String(applicationId));
  const hasScheduled=slots=>slots.some(slot=>slot.status==='scheduled');
  const effectiveStatus=(request,slots)=>hasScheduled(slots)?'scheduled':(request?.status||null);
  const appointmentDetails=slots=>{
    if(!slots.length)return '';
    const mode={on_site:'Əyani',online:'Onlayn',phone:'Telefon'};
    const labels={scheduled:'Planlaşdırılıb',completed:'Tamamlanıb',cancelled:'Ləğv edilib'};
    return '<section class="ir-appointments" aria-label="Görüş məlumatları">'+
      '<h3>Görüş məlumatları <small>('+slots.length+' görüş)</small></h3>'+
      slots.slice().sort((a,b)=>new Date(b.starts_at)-new Date(a.starts_at)).map((slot,i)=>{
        let secureLink='';
        try {
          const url=new URL(slot.meeting_url||'');
          if(url.protocol==='https:')secureLink='<a class="ir-meeting-link" href="'+E(url.href)+'" target="_blank" rel="noopener noreferrer">Görüş linkini aç ↗</a>';
        }catch(_error){/* Do not render invalid or unsafe links. */}
        const details=[
          ['Tarix və saat',displayDate(slot.starts_at)],
          ['Müddət',String(slot.duration_minutes||45)+' dəqiqə'],
          ['Format',mode[slot.meeting_mode]||slot.meeting_mode||'—'],
          ['Məkan',slot.location||'Göstərilməyib'],
          ['Status',labels[slot.status]||slot.status||'—']
        ];
        return '<article class="ir-appointment">'+
          '<div class="ir-appointment-head"><strong>Görüş '+(slots.length-i)+'</strong><span class="chip '+(slot.status==='scheduled'?'good':'line')+'">'+E(labels[slot.status]||slot.status||'—')+'</span></div>'+
          '<dl class="ir-details">'+details.map(([label,value])=>'<div><dt>'+E(label)+'</dt><dd>'+E(value)+'</dd></div>').join('')+'</dl>'+
          (slot.meeting_mode==='online' && secureLink?'<div class="ir-slot-link">'+secureLink+'</div>':'')+
          (slot.meeting_mode==='online'&&!secureLink?'<div class="ir-help">Onlayn görüş linki hələ daxil edilməyib.</div>':'')+
          (slot.notes?'<div class="ir-notes"><b>Görüş qeydi:</b> '+E(slot.notes)+'</div>':'')+
          '</article>';
      }).join('')+'</section>';
  };
  const summary=()=>{
    const keys=['pending','accepted','scheduled','declined'];
    const current=client.rows.map(r=>({...r,status:effectiveStatus(r,slotsFor(r.application_id))}));
    // Also count appointments initiated directly by companies, with no request.
    const requests=new Set(current.map(r=>String(r.application_id)));
    client.slots.filter(s=>!requests.has(String(s.application_id))).forEach(s=>{
      if(!requests.has(String(s.application_id))) {
        requests.add(String(s.application_id));
        current.push({status:'scheduled'});
      }
    });
    return '<div class="ir-metrics">'+keys.map(k=>'<div class="card ir-tile"><span>'+E(statuses[k][0])+'</span><b>'+current.filter(x=>x.status===k).length+'</b></div>').join('')+'</div>';
  };

  function studentView() {
    client.reset();
    const applications=client.ownedApplications();
    const byApp=new Map(client.rows.map(row=>[String(row.application_id),row]));
    return heading('Tələbə · Karyera','Müsahibə sorğularım','Müraciət etdiyiniz vakansiyalar üçün şirkətdən müsahibə istəyə bilərsiniz.')+note()+summary()+
      (!applications.length?'<div class="card ir-panel"><h2>Aktiv müraciət yoxdur</h2><p>Əvvəl vakansiyaya müraciət edin.</p><button class="btn primary" data-act="go" data-view="jobs">Vakansiyalara bax</button></div>':
        '<div class="ir-list">'+applications.map(a=>{
          const existing=byApp.get(String(a.id));
          const appointments=slotsFor(a.id);
          const currentStatus=effectiveStatus(existing,appointments);
          const canRequest=(!existing||['declined','cancelled'].includes(existing.status))&&!hasScheduled(appointments);
          return '<article class="card ir-panel">'+
            '<div class="ir-top"><div><div class="eyebrow">'+companyName(a)+'</div><h2>'+jobName(a)+'</h2>'+
            '<p>Vakansiya üzrə müraciət · '+E(a.status||'')+'</p></div>'+
            (currentStatus?chip(currentStatus):'<span class="chip line">Sorğu göndərilməyib</span>')+'</div>'+
            (existing?.reply_note?'<p class="ir-reply"><b>Şirkətin cavabı:</b> '+E(existing.reply_note)+'</p>':'')+
            appointmentDetails(appointments)+
            (currentStatus==='scheduled'?'<p class="ir-success">Təyin edilmiş görüşlərin tam məlumatları yuxarıda göstərilib.</p>':'')+
            (canRequest && Store.mode==='supabase'?'<form data-ir-form="student" class="ir-form">'+
              '<input type="hidden" name="application_id" value="'+E(a.id)+'">'+
              '<label for="ir-'+E(a.id)+'">Şirkətə mesaj (istəyə bağlı)</label>'+
              '<textarea id="ir-'+E(a.id)+'" name="message" maxlength="1000" rows="3" placeholder="Bu vəzifə üzrə müsahibədə iştirak etmək istərdim."></textarea>'+
              '<button type="submit" class="btn primary"'+(client.saving?' disabled':'')+'>Müsahibə sorğusu göndər</button></form>':'')+
            (existing && ['pending','accepted'].includes(existing.status)?'<div class="ir-actions"><button type="button" class="btn sm danger" data-ir-cancel="'+E(existing.id)+'"'+(client.saving?' disabled':'')+'>Sorğunu geri götür</button></div>':'')+
            '</article>';
        }).join('')+'</div>');
  }

  function companyView() {
    client.reset();
    const owned=new Map(client.ownedApplications().map(a=>[String(a.id),a]));
    const companyId=Store.state?.company?.id;
    // A calendar entry can be created without a student-originated request.
    // Show those meetings too, while relying on the server's SELECT RLS.
    const byApp=new Map(client.rows
      .filter(row=>String(row.company_id)===String(companyId))
      .map(row=>[String(row.application_id),row]));
    client.slots.forEach(slot=>{
      const key=String(slot.application_id),a=owned.get(key);
      if(a&&!byApp.has(key)) {
        byApp.set(key,{id:null,application_id:slot.application_id,
          student_id:a.studentId,company_id:companyId,status:'scheduled',
          message:'',reply_note:'',created_at:slot.created_at});
      }
    });
    const rows=[...byApp.values()].sort((a,b)=>
      new Date(b.updated_at||b.created_at||0)-new Date(a.updated_at||a.created_at||0));
    const stats=()=>{
      const keys=['pending','accepted','scheduled','declined'];
      return '<div class="ir-metrics">'+keys.map(k=>
        '<div class="card ir-tile"><span>'+E(statuses[k][0])+'</span><b>'+
        rows.filter(row=>effectiveStatus(row,slotsFor(row.application_id))===k).length+
        '</b></div>').join('')+'</div>';
    };
    return heading('Şirkət · HR kabineti','Müsahibə sorğuları və görüşlər',
      'Namizəd sorğularını cavablandırın və təqvimdə planlaşdırılmış bütün görüşlərin məlumatlarına baxın.')+
      note()+stats()+
      (!rows.length?'<div class="card ir-panel"><h2>Hələ müsahibə sorğusu və ya görüş yoxdur</h2>'+
        '<p>Şirkətə göndərilən sorğular və təqvimdə yaradılan görüşlər burada görünəcək.</p>'+
        '<button type="button" class="btn sm" data-act="go" data-view="calendar">Müsahibə təqvimi</button></div>':
        '<div class="ir-list">'+rows.map(row=>{
          const a=owned.get(String(row.application_id));
          const student=(typeof STUDENT_POOL!=='undefined'&&STUDENT_POOL.find(x=>
            String(x.id)===String(row.student_id)))||{};
          const name=client.names[String(row.student_id)]||student.name||'Namizəd';
          const appointments=slotsFor(row.application_id);
          const currentStatus=effectiveStatus(row,appointments);
          return '<article class="card ir-panel">'+
            '<div class="ir-top"><div><div class="eyebrow">Namizəd · '+
              E(displayDate(row.created_at))+'</div>'+
              '<h2>'+E(name)+'</h2><p>'+jobName(a)+'</p></div>'+
              chip(currentStatus)+'</div>'+
            (row.message?'<blockquote class="ir-student-message">'+E(row.message)+'</blockquote>':'')+
            (row.reply_note?'<p class="ir-reply"><b>HR qeydi:</b> '+E(row.reply_note)+'</p>':'')+
            appointmentDetails(appointments)+
            (row.id && row.status==='pending' && !hasScheduled(appointments)?
              '<form class="ir-form" data-ir-form="respond">'+
              '<input type="hidden" name="request_id" value="'+E(row.id)+'">'+
              '<label>Namizədə cavab (istəyə bağlı)</label>'+
              '<textarea name="reply_note" maxlength="1000" rows="2" placeholder="Namizədə qısa məlumat"></textarea>'+
              '<div class="ir-actions"><button type="submit" name="decision" value="accepted" class="btn primary"'+(client.saving?' disabled':'')+'>Sorğunu qəbul et</button>'+
              '<button type="submit" name="decision" value="declined" class="btn danger"'+(client.saving?' disabled':'')+'>İmtina et</button></div></form>':'')+
            (currentStatus==='accepted'?
              '<div class="ir-actions"><button type="button" class="btn primary" data-ir-calendar="'+
              E(row.application_id)+'">Təqvimdə vaxt təyin et</button></div>':'')+
            (currentStatus==='scheduled'?
              '<div class="ir-actions"><button type="button" class="btn sm" data-act="go" data-view="calendar">Təqvimə keç</button></div>':'')+
            '</article>';
        }).join('')+'</div>');
  }

  function addNav(role,anchor,id,label,ico) {
    if(!NAV[role] || NAV[role].some(x=>x.id===id))return;
    const index=NAV[role].findIndex(x=>x.id===anchor);
    NAV[role].splice(index<0?NAV[role].length:index+1,0,{id,label,ico});
  }
  addNav('student','applications','interview-requests','Müsahibə sorğularım','◷');
  addNav('company','invites','interview-inbox','Müsahibə sorğuları','✉');
  VIEWS.student['interview-requests']=studentView;
  VIEWS.company['interview-inbox']=companyView;

  // Make new flow discoverable from the existing pages without rewriting them.
  if(typeof VIEWS.student.applications==='function') {
    const old=VIEWS.student.applications;
    VIEWS.student.applications=function(){
      return old()+ '<div class="ir-inline-promo"><div><strong>Şirkətdən müsahibə istəyin</strong><p>Müraciət etdiyiniz vakansiya üzrə müsahibə sorğusu göndərə bilərsiniz.</p></div>'+
        '<button type="button" class="btn sm primary" data-act="go" data-view="interview-requests">Sorğularım</button></div>';
    };
  }
  if(typeof VIEWS.company.invites==='function') {
    const old=VIEWS.company.invites;
    VIEWS.company.invites=function(){
      return old()+ '<div class="ir-inline-promo"><div><strong>Tələbələrdən gələn sorğular</strong><p>Tələbənin təşəbbüsü ilə göndərilən görüş istəklərinə baxın.</p></div>'+
      '<button type="button" class="btn sm primary" data-act="go" data-view="interview-inbox">Sorğuları aç</button></div>';
    };
  }

  // Existing calendar schedules interviews by application_id. Prefill selected
  // request's application without touching its form handler or sending extra data.
  if(typeof VIEWS.company.calendar==='function'){
    const old=VIEWS.company.calendar;
    VIEWS.company.calendar=function(){
      let html=old();
      const id=client.calendarApplication;
      if(id && /^[0-9a-f-]{36}$/i.test(id)) {
        html=html.replace('value="'+id+'"','value="'+id+'" selected');
      }
      return html;
    };
  }

  const menuIcons={
    'interview-requests':'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/><path d="m9 16 2 2 4-4"/>',
    'interview-inbox':'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="m2 8 10 6 10-6"/><path d="M16 3l2-2 2 2"/>'
  };
  function drawIcons(){
    const root=document.getElementById('root'); if(!root)return;
    root.querySelectorAll('.rail a[data-view]').forEach(link=>{
      const name=link.dataset.view,slot=link.querySelector('.ico');
      if(!slot||!menuIcons[name]||slot.dataset.irIcon===name)return;
      slot.innerHTML='<svg class="adnsu-svg-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+menuIcons[name]+'</svg>';
      slot.dataset.irIcon=name;slot.dataset.svgIcon=name;
    });
  }
  const root=document.getElementById('root');
  if(root){new MutationObserver(drawIcons).observe(root,{childList:true});drawIcons();}

  document.addEventListener('click',async event=>{
    const nav=event.target.closest('[data-act="go"][data-view]');
    if(nav && ['interview-requests','interview-inbox'].includes(nav.dataset.view)){
      Promise.resolve().then(()=>client.load(true));
    }
    if(event.target.closest('[data-act="notification-open"]')){
      Promise.resolve().then(()=>{
        if(['interview-requests','interview-inbox'].includes(Store.state?.view))client.load(true);
      });
    }
    if(event.target.closest('[data-ir-refresh]')){client.load(true);return;}
    const cancel=event.target.closest('[data-ir-cancel]');
    if(cancel){
      if(!window.confirm('Müsahibə sorğusunu geri götürmək istəyirsiniz?'))return;
      await client.rpc('cancel_interview_request',{p_request_id:cancel.dataset.irCancel});
      return;
    }
    const calendar=event.target.closest('[data-ir-calendar]');
    if(calendar){
      const appId=String(calendar.dataset.irCalendar||'');
      if(!client.ownedApplications().some(a=>String(a.id)===appId))return;
      client.calendarApplication=appId;
      Store.state.view='calendar';Store.save();render();window.scrollTo(0,0);
      if(typeof EmployerTools!=='undefined')EmployerTools.afterNavigate('calendar');
    }
  });

  // Use the native submitter to distinguish accept/decline on a single form.
  document.addEventListener('submit',async event=>{
    const form=event.target.closest('[data-ir-form]');
    if(!form)return;
    event.preventDefault();
    if(client.saving)return;
    const data=new FormData(form),val=name=>String(data.get(name)||'').trim();
    if(form.dataset.irForm==='student'){
      const applicationId=val('application_id');
      if(!client.ownedApplications().some(a=>String(a.id)===applicationId))return;
      await client.rpc('create_interview_request',{p_application_id:applicationId,p_message:val('message')});
    } else if(form.dataset.irForm==='respond'){
      const choice=event.submitter?.value;
      if(!['accepted','declined'].includes(choice))return;
      await client.rpc('respond_interview_request',{
        p_request_id:val('request_id'),p_decision:choice,p_reply_note:val('reply_note')
      });
    }
  });
  window.addEventListener('load',()=>setTimeout(()=>{
    if(['interview-requests','interview-inbox'].includes(Store.state?.view))client.load(true);
  },1700),{once:true});
})();
