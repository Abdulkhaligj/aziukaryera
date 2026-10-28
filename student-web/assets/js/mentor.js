/* ADNSU Mentor dəstəyi — ayrıca modul, mövcud AI/şəkil/giriş koduna toxunmur. */
var MentorUI = {
  rows: [], loading: false, busy: false, loadedFor: '', error: '', filter: 'all',
  types: [
    ['karyera','Karyera istiqaməti','Peşə yolu və iş seçimi','◭'],
    ['cv','CV və portfolio','CV, LinkedIn və layihələr','▤'],
    ['müsahibə','Müsahibə hazırlığı','HR və texniki müsahibələr','◉'],
    ['texniki','Texniki bacarıqlar','Mühəndislik və IT istiqamətləri','⚙'],
    ['startap','Startap və layihələr','İdeyadan prototipə qədər','✦'],
    ['magistr','Magistr və təhsil','İxtisaslaşma və akademik inkişaf','▥'],
    ['şəbəkələşmə','Şəbəkələşmə','Peşəkar əlaqələr','◎']
  ],
  statuses: {pending:'Yeni müraciət',in_review:'Baxılır',matched:'Mentor təyin edilib',completed:'Tamamlanıb',cancelled:'Bağlanıb'},
  h(s){return esc(String(s??''));},
  async load(force=false) {
    const user=Auth.currentUser(), role=Auth.role();
    if(!user||!['student','admin'].includes(role))return;
    const key=role+':'+user.id;
    if(this.loading||(!force&&this.loadedFor===key))return;
    this.loading=true;this.error='';
    try{
      if(Store.mode!=='supabase'||!Backend.sb)throw Error('Müraciətlər üçün server bağlantısı tələb olunur.');
      const {data,error}=await Backend.sb.from('mentor_requests')
        .select('id,student_id,category,topic,details,format,preferred_time,status,mentor_name,admin_note,created_at,updated_at')
        .order('created_at',{ascending:false}).limit(150);
      if(error)throw Error(error.message);
      this.rows=data||[];this.loadedFor=key;
    }catch(e){this.error=e.message||'Müraciətləri yükləmək mümkün olmadı.';}
    finally{this.loading=false;if(Store.state.view==='mentor'&&Auth.currentUser())render();}
  },
  page(admin=false){
    const u=Auth.currentUser(),key=(admin?'admin':'student')+':'+(u?.id||'');
    if(!this.loading&&!this.error&&this.loadedFor!==key)Promise.resolve().then(()=>this.load());
    return admin?this.adminPage():this.studentPage();
  },
  feedback(){return this.loading?'<div class="mentor-note" role="status">Müraciətlər yüklənir…</div>':
    this.error?'<div class="note warn" role="alert">'+this.h(this.error)+' <button class="btn sm" data-mentor-act="refresh">Yenidən yoxla</button></div>':'';},
  studentPage(){
    return `<div class="mentor-page">
      <section class="mentor-hero"><div class="eyebrow">ADNSU Karyera Mərkəzi · Fərdi inkişaf</div>
      <h1>Mentor dəstəyi</h1><p>Karyera, CV, müsahibə, texniki inkişaf və layihələrlə bağlı dəstək istə.
      Müraciətlər Karyera Mərkəzi tərəfindən nəzərdən keçirilir.</p>
      <span class="mentor-hero-chip">7 dəstək istiqaməti</span></section>
      <div class="mentor-heading"><div><h2>Hansı mövzuda dəstək lazımdır?</h2><p>İstiqamət seçdikdən sonra məqsədini ətraflı yaz.</p></div></div>
      <div class="mentor-types">${this.types.map(([id,n,d,ico])=>`<button type="button" class="mentor-type" data-mentor-act="choose" data-category="${this.h(id)}"><span class="mentor-ico">${ico}</span><b>${this.h(n)}</b><small>${this.h(d)}</small></button>`).join('')}</div>
      <div class="mentor-two-col"><section class="card mentor-form-box" id="mentor-form-box">
      <h2>Mentorluq üçün müraciət et</h2><p>Müraciət pulsuzdur. Mentor və görüş vaxtı sonradan müəyyən olunur.</p>
      <form id="mentor-request-form" class="mentor-form">
       <div class="field"><label for="mentor-category">Dəstək istiqaməti</label><select id="mentor-category" name="category" required>
        ${this.types.map(([id,n])=>`<option value="${this.h(id)}">${this.h(n)}</option>`).join('')}</select></div>
       <div class="field"><label for="mentor-topic">Müraciətin mövzusu</label><input id="mentor-topic" name="topic" type="text" minlength="5" maxlength="140" required placeholder="Məsələn, ilk təcrübə proqramına hazırlıq"></div>
       <div class="field"><label for="mentor-details">Nə üçün kömək lazımdır?</label><textarea id="mentor-details" name="details" rows="5" minlength="15" maxlength="1800" required placeholder="Çətinliklərini və görüşdən gözləntilərini izah et."></textarea></div>
       <div class="mentor-grid2"><div class="field"><label for="mentor-format">Görüş formatı</label><select id="mentor-format" name="format">
         <option value="either">Fərqi yoxdur</option><option value="online">Onlayn</option><option value="in_person">Əyani</option>
       </select></div><div class="field"><label for="mentor-time">Uyğun vaxt (istəyə bağlı)</label><input id="mentor-time" name="preferred_time" maxlength="180" placeholder="Həftəiçi günortadan sonra"></div></div>
       <div class="mentor-actions"><small>Məlumatını yalnız sən və səlahiyyətli mərkəz əməkdaşları görür.</small>
         <button type="submit" class="btn primary" ${this.busy?'disabled':''}>${this.busy?'Göndərilir…':'Müraciəti göndər →'}</button></div>
      </form></section><aside class="mentor-aside">
      <div class="card"><h3>Proses necə işləyir?</h3><ol>
        <li><b>İstiqaməti seç</b><small>Dəstək mövzunu müəyyən et.</small></li>
        <li><b>Müraciəti göndər</b><small>Ehtiyacını və uyğun vaxtlarını yaz.</small></li>
        <li><b>Mərkəz baxır</b><small>Uyğun mentor müəyyənləşdirilir.</small></li>
        <li><b>Görüş təsdiqlənir</b><small>Mentor və növbəti addımları izləyirsən.</small></li>
      </ol></div><div class="card mentor-tip"><b>Vacib məlumat</b><p>Müraciətin göndərilməsi avtomatik görüş rezervasiyası deyil.</p></div>
      </aside></div>
      <div class="mentor-heading"><h2>Müraciətlərim</h2><button type="button" class="btn sm" data-mentor-act="refresh">↻ Yenilə</button></div>
      ${this.feedback()}
      ${!this.loading&&!this.error&&!this.rows.length?'<div class="mentor-empty"><b>Hələ müraciət yoxdur</b><span>Yuxarıdakı formanı dolduraraq ilk müraciətini göndər.</span></div>':''}
      <div class="mentor-list">${this.rows.map(x=>this.card(x,false)).join('')}</div></div>`;
  },
  card(r,admin) {
    const cat=this.types.find(x=>x[0]===r.category)?.[1]||r.category;
    const when=new Date(r.created_at).toLocaleDateString('az-AZ',{year:'numeric',month:'short',day:'numeric'});
    const id=this.h(r.id);
    return `<article class="mentor-request"><div class="mentor-card-head"><span class="mentor-tag">${this.h(cat)}</span>
      <span class="mentor-badge mentor-badge-${this.h(r.status)}">${this.h(this.statuses[r.status]||r.status)}</span></div>
      <h3>${this.h(r.topic)}</h3><p>${this.h(r.details)}</p>
      <div class="mentor-meta"><span>${this.h(when)}</span><span>${r.format==='online'?'Onlayn':r.format==='in_person'?'Əyani':'Format sərbəst'}</span>
      ${r.preferred_time?'<span>'+this.h(r.preferred_time)+'</span>':''}</div>
      ${r.mentor_name?'<div class="mentor-assigned"><b>Mentor:</b> '+this.h(r.mentor_name)+'</div>':''}
      ${r.admin_note?'<div class="mentor-assigned"><b>Karyera Mərkəzinin qeydi:</b> '+this.h(r.admin_note)+'</div>':''}
      ${admin?`<div class="mentor-admin-controls"><div class="mentor-grid2">
      <div class="field"><label for="mentor-status-${id}">Status</label><select id="mentor-status-${id}">${Object.entries(this.statuses).map(([s,l])=>`<option value="${s}" ${r.status===s?'selected':''}>${this.h(l)}</option>`).join('')}</select></div>
      <div class="field"><label for="mentor-name-${id}">Təyin edilən mentor</label><input id="mentor-name-${id}" maxlength="120" value="${this.h(r.mentor_name)}" placeholder="Mentorun adı"></div></div>
      <div class="field"><label for="mentor-note-${id}">Tələbə üçün qeyd</label><textarea id="mentor-note-${id}" maxlength="1200" rows="2">${this.h(r.admin_note)}</textarea></div>
      <button class="btn sm primary" data-mentor-act="save" data-id="${id}">Yadda saxla</button></div>`:''}</article>`;
  },
  adminPage(){
    const rows=this.filter==='all'?this.rows:this.rows.filter(x=>x.status===this.filter);
    return `<div class="mentor-page"><div class="page-head"><div><div class="eyebrow">Karyera Mərkəzi · İdarəetmə</div><h1>Mentor müraciətləri</h1>
      <p>Tələbələrin sorğularını nəzərdən keçir və mentor təyinatını qeyd et.</p></div></div>
      <div class="mentor-summary"><div><span>Ümumi müraciət</span><b>${this.rows.length}</b></div>
      <div><span>Baxılır</span><b>${this.rows.filter(x=>x.status==='in_review').length}</b></div>
      <div><span>Mentor təyin edilib</span><b>${this.rows.filter(x=>x.status==='matched').length}</b></div></div>
      <div class="mentor-heading"><div class="pills">${[['all','Hamısı'],...Object.entries(this.statuses)].map(([id,n])=>`<button data-mentor-act="filter" data-filter="${id}" aria-pressed="${this.filter===id}">${this.h(n)}</button>`).join('')}</div>
      <button class="btn sm" data-mentor-act="refresh">↻ Yenilə</button></div>
      ${this.feedback()}${!this.loading&&!this.error&&!rows.length?'<div class="mentor-empty"><b>Müraciət tapılmadı</b></div>':''}
      <div class="mentor-list">${rows.map(x=>this.card(x,true)).join('')}</div></div>`;
  },
  async send(form){
    if(this.busy)return;
    const v=Object.fromEntries(new FormData(form).entries());
    const p={category:String(v.category||''),topic:String(v.topic||'').trim(),details:String(v.details||'').trim(),
      format:String(v.format||'either'),preferred_time:String(v.preferred_time||'').trim()};
    if(!this.types.some(x=>x[0]===p.category)||p.topic.length<5||p.topic.length>140||p.details.length<15||p.details.length>1800||p.preferred_time.length>180){
      toast('Müraciət məlumatlarını yoxla.');return;
    }
    if(Store.mode!=='supabase'||!Backend.sb){toast('Serverə qoşulma tələb olunur.');return;}
    this.busy=true;form.querySelector('[type="submit"]').disabled=true;
    try{
      const {data:{user},error:authError}=await Backend.sb.auth.getUser();
      if(authError||!user)throw Error('Sessiyanı yenilə və yenidən daxil ol.');
      const {data,error}=await Backend.sb.from('mentor_requests').insert({...p,student_id:user.id}).select().single();
      if(error)throw Error(error.message);
      this.rows.unshift(data);this.error='';toast('Mentor müraciətin göndərildi.');render();
    }catch(e){toast('Müraciət alınmadı: '+(e.message||'Xəta'));}
    finally{this.busy=false;const b=document.querySelector('#mentor-request-form [type="submit"]');if(b)b.disabled=false;}
  },
  async save(id){
    if(this.busy||Auth.role()!=='admin'||Store.mode!=='supabase')return;
    const el=k=>document.getElementById('mentor-'+k+'-'+id);
    const status=el('status')?.value,mentor_name=String(el('name')?.value||'').trim(),admin_note=String(el('note')?.value||'').trim();
    if(!this.statuses[status]||mentor_name.length>120||admin_note.length>1200){toast('Məlumatlar düzgün deyil.');return;}
    if(status==='matched'&&!mentor_name){toast('Mentor təyin edilib statusu üçün mentor adı lazımdır.');return;}
    this.busy=true;
    try{
      const {data,error}=await Backend.sb.from('mentor_requests').update({status,mentor_name,admin_note,updated_at:new Date().toISOString()}).eq('id',id).select().single();
      if(error)throw Error(error.message);
      const i=this.rows.findIndex(r=>r.id===id);if(i>=0)this.rows[i]=data;
      toast('Müraciət yeniləndi.');render();
    }catch(e){toast('Yeniləmə alınmadı: '+(e.message||'Xəta'));}
    finally{this.busy=false;}
  }
};
function viewMentorSupport(){return MentorUI.page(false);}
function viewMentorAdmin(){return MentorUI.page(true);}
document.addEventListener('submit',e=>{if(e.target?.id==='mentor-request-form'){e.preventDefault();MentorUI.send(e.target);}});
document.addEventListener('click',e=>{
 const t=e.target.closest('[data-mentor-act]');if(!t)return;
 if(t.dataset.mentorAct==='choose'){
   const f=document.getElementById('mentor-category');if(f)f.value=t.dataset.category;
   document.getElementById('mentor-form-box')?.scrollIntoView({behavior:'smooth',block:'start'});
   document.getElementById('mentor-topic')?.focus({preventScroll:true});
 }
 if(t.dataset.mentorAct==='refresh'){MentorUI.loadedFor='';MentorUI.error='';MentorUI.load(true);}
 if(t.dataset.mentorAct==='filter'){MentorUI.filter=t.dataset.filter;render();}
 if(t.dataset.mentorAct==='save')MentorUI.save(t.dataset.id);
});
/* Yalnız yeni marşrutlar; mövcud app.js, AI və profil foto kodu dəyişmir. */
if(typeof NAV!=='undefined'&&typeof VIEWS!=='undefined'){
 if(!NAV.student.some(x=>x.id==='mentor')){const i=NAV.student.findIndex(x=>x.id==='roadmap');NAV.student.splice(i>=0?i+1:NAV.student.length,0,{id:'mentor',label:'Mentor dəstəyi',ico:'◉'});}
 if(!NAV.admin.some(x=>x.id==='mentor')){const pos=NAV.admin.findIndex(x=>x.id==='events');NAV.admin.splice(pos>=0?pos+1:NAV.admin.length,0,{id:'mentor',label:'Mentor müraciətləri',ico:'◉'});}
 VIEWS.student.mentor=viewMentorSupport;VIEWS.admin.mentor=viewMentorAdmin;
}
