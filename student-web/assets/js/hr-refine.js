/*!
 * ADNSU Karyera — şirkət kabineti HR təkmilləşdirməsi.
 * Yalnız mövcud VIEWS.company səthini genişləndirir. Əsas app.js,
 * tələbə profilləri, CV məlumatları, server sorğuları dəyişdirilmir.
 */
(() => {
  'use strict';

  const icons = Object.freeze({
    invites: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="m3 7 9 6 9-6"/><path d="m15 15 2 2 4-4"/>',
    'hr-analytics': '<path d="M3 21h18"/><rect x="5" y="12" width="3.5" height="7" rx=".8"/><rect x="10.5" y="8" width="3.5" height="11" rx=".8"/><rect x="16" y="4" width="3.5" height="15" rx=".8"/>',
    'talent-pool': '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2"/><path d="M16 5a3 3 0 0 1 0 6M21 20v-2a6 6 0 0 0-4-5.66"/>',
    compare: '<rect x="3" y="4" width="7" height="16" rx="1.3"/><rect x="14" y="4" width="7" height="16" rx="1.3"/><path d="M6 8h1M6 12h1M17 8h1M17 12h1"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/><circle cx="12" cy="15" r="3"/><path d="M12 13v2l1.3.8"/>',
    partnerships: '<path d="m2 10 5-6 5 3 5-3 5 6-4 4-2-1-5 5-3-2-2 1-4-4z"/><path d="m8 12 4 3m0-8 3 3"/>'
  });
  const svg = icon => '<svg xmlns="http://www.w3.org/2000/svg" class="adnsu-svg-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + icons[icon] + '</svg>';

  const root = document.getElementById('root');
  const drawIcons = () => {
    if (!root) return;
    root.querySelectorAll('.rail a[data-view]').forEach(link => {
      const name=link.dataset.view, icon=icons[name], target=link.querySelector('.ico');
      if (!icon || !target || (target.dataset.hrIcon === name && target.querySelector('svg'))) return;
      target.innerHTML = svg(name);
      target.dataset.hrIcon = name;
      target.dataset.svgIcon = name;
    });
  };
  if (root) {
    // Existing navigation-icons.js observer executes first. This observer
    // only observes direct root children; changing nested SVG never loops.
    new MutationObserver(drawIcons).observe(root,{childList:true});
    drawIcons();
  }

  if (typeof VIEWS === 'undefined' || !VIEWS.company) return;
  const views=VIEWS.company;
  const statusCard = (label,number,note) =>
    '<article class="hr-ux-stat"><span>'+label+'</span><strong>'+Number(number||0)+'</strong><small>'+note+'</small></article>';
  const section = (heading,intro,cards,footer) =>
    '<section class="hr-ux-panel" aria-label="'+heading+'"><div class="hr-ux-heading"><div><h2>'+heading+'</h2><p>'+intro+'</p></div></div>'+
    '<div class="hr-ux-stats">'+cards+'</div>'+(footer||'')+'</section>';
  const goButton=(view,label)=>'<button type="button" class="btn sm" data-act="go" data-view="'+view+'">'+label+'</button>';

  if (typeof views.invites === 'function') {
    const previous=views.invites;
    views.invites=function() {
      const original=previous();
      const invites = typeof ownInvites === 'function' ? ownInvites() : [];
      const approved=invites.filter(x=>x.status==='accepted').length;
      const rejected=invites.filter(x=>x.status==='declined').length;
      const cancelled=invites.filter(x=>x.status==='cancelled').length;
      const awaiting=invites.length-approved-rejected-cancelled;
      return original+section('Dəvətlərin vəziyyəti','Namizədlərə göndərilən dəvətlərin aktual statusu.',
        statusCard('Göndərilən',invites.length,'Ümumi dəvət')+
        statusCard('Cavab gözləyən',awaiting,'Hələ yekunlaşmayıb')+
        statusCard('Qəbul edilən',approved,'Müsbət cavab')+
        statusCard('İmtina',rejected,'Mənfi cavab'),
        '<div class="hr-ux-actions">'+goButton('calendar','Müsahibə vaxtı təyin et')+goButton('candidates','Namizədlərə bax')+'</div>');
    };
  }

  if (typeof views['hr-analytics'] === 'function') {
    const previous=views['hr-analytics'];
    views['hr-analytics']=function() {
      return previous()+
        '<section class="hr-ux-panel"><div class="hr-ux-heading"><div><h2>HR əməliyyatları</h2>'+
        '<p>Müraciətləri araşdırın, görüşləri planlaşdırın və uyğun namizədləri müqayisə edin. Göstəricilər yalnız şirkətinizin giriş icazəsi olan məlumatlara əsaslanır.</p></div></div>'+
        '<div class="hr-ux-actions">'+goButton('applications','Müraciətləri idarə et')+
        goButton('talent-pool','Talent Pool')+goButton('compare','Namizədləri müqayisə et')+
        goButton('calendar','Müsahibə təqvimi')+'</div></section>';
    };
  }

  if (typeof views.partnerships === 'function') {
    const previous=views.partnerships;
    views.partnerships=function() {
      let original=previous();
      const today=bakuDate();
      original=original.replace('type="date" name="preferred_date"', 'type="date" min="'+today+'" name="preferred_date"');
      const company=Store.state.company||{};
      const list=(EmployerTools.partnerships||[]).filter(x=>String(x.company_id)===String(company.id));
      const reviewing=list.filter(x=>['submitted','reviewing'].includes(x.status)).length;
      const approved=list.filter(x=>x.status==='approved').length;
      const finished=list.filter(x=>x.status==='completed').length;
      return original+
        section('Əməkdaşlığın gedişatı','Təklif universitet tərəfindən qiymətləndiriləndə status burada yenilənəcək.',
          statusCard('Ümumi təklif',list.length,'Göndərilən sorğular')+
          statusCard('Baxışdadır',reviewing,'Cavab gözləyir')+
          statusCard('Təsdiqlənib',approved,'Razılaşdırılıb')+
          statusCard('Tamamlanıb',finished,'Həyata keçirilib'),
          '<div class="hr-ux-note">Təklifin təsvirində məqsədi, tələbə sayını, fakültələri, gözlənilən nəticəni və əlaqə şəxsini qeyd etməyiniz tövsiyə olunur. Göndərilən təklif avtomatik təsdiq sayılmır.</div>');
    };
  }

  if (typeof views.calendar === 'function') {
    const previous=views.calendar;
    views.calendar=function() {
      let original=previous();
      const months=['Yanvar','Fevral','Mart','Aprel','May','İyun','İyul','Avqust','Sentyabr','Oktyabr','Noyabr','Dekabr'];
      // Some browsers render Azerbaijani month names as "2026 M10".
      original=original.replace(/<h2>(\d{4}) M(\d{1,2})<\/h2>/g,(_,year,month)=>
        '<h2>'+months[Number(month)-1]+' '+year+'</h2>');
      original=original.replace('name="date" type="date" required','name="date" type="date" min="'+bakuDate()+'" required');
      const ownedIds=new Set(EmployerTools.applications().map(x=>String(x.id)));
      const slots=(EmployerTools.appointments||[]).filter(x=>ownedIds.has(String(x.application_id)));
      const forthcoming=slots.filter(x=>x.status==='scheduled'&&new Date(x.starts_at)>new Date()).length;
      const finished=slots.filter(x=>x.status==='completed').length;
      const cancelled=slots.filter(x=>x.status==='cancelled').length;
      return original+section('Görüşlərin icmalı','Bütün görüş vaxtları Bakı vaxtı ilə göstərilir.',
        statusCard('Görüşlər',slots.length,'Ümumi təqvim')+
        statusCard('Qarşıdakı',forthcoming,'Planlaşdırılıb')+
        statusCard('Tamamlanıb',finished,'Başa çatıb')+
        statusCard('Ləğv edilib',cancelled,'Aktiv deyil'),
        '<div class="hr-ux-actions">'+goButton('invites','Müsahibə dəvətləri')+goButton('applications','Namizəd müraciətləri')+'</div>');
    };
  }

  function bakuDate(){
    const parts = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Baku',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const get = key => parts.find(p=>p.type===key)?.value||'';
    return get('year')+'-'+get('month')+'-'+get('day');
  }
})();
