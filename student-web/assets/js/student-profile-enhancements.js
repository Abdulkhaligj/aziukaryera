/* Student-only Mentor and profile image upload. All other routes untouched. */
(() => {
  'use strict';
  const root = document.getElementById('root');
  if (!root) return;
  const photo = {userId:null,last:0,pending:false,url:null,loading:false};
  function student() {
    try {
      const me = Auth.currentUser();
      return me && me.role === 'student' && Store.state.student ? me : null;
    } catch {return null;}
  }
  function notify(message,failed) {
    const el=root.querySelector('[data-profile-photo-status]');
    if (el) {el.textContent=message;el.classList.toggle('error',!!failed);}
  }
  function avatarCard() {
    const el=document.createElement('div');
    el.className='card pad-lg student-photo-card';
    el.dataset.studentPhoto='1';
    el.innerHTML=[
      '<div class="student-photo-preview" data-photo-preview aria-label="Profil şəklinin önizləməsi">',
      '<span class="student-photo-fallback" aria-hidden="true">Şəkil</span></div>',
      '<div class="student-photo-details"><h2>Profil şəkli</h2>',
      '<p>JPG, PNG və ya WebP şəkil seçin. Şəkil yoxlamadan sonra profilinizdə görünəcək.</p>',
      '<label class="btn sm primary student-photo-label" for="student-photo-input">Şəkil seç və yüklə</label>',
      '<input id="student-photo-input" data-photo-input type="file" accept="image/jpeg,image/png,image/webp">',
      '<small role="status" aria-live="polite" data-profile-photo-status></small>',
      '</div>'
    ].join('');
    return el;
  }
  function mentorCard() {
    const el=document.createElement('section');
    el.className='card pad-lg student-mentor-card';
    el.dataset.studentMentor='1';
    el.innerHTML=[
      '<div class="student-mentor-emblem" aria-hidden="true">',
      '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8">',
      '<circle cx="12" cy="8" r="3"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></svg></div>',
      '<div class="student-mentor-content"><div class="eyebrow">ADNSU Karyera Mərkəzi</div>',
      '<h2>Mentor dəstəyi</h2>',
      '<p>CV və LinkedIn, müsahibə hazırlığı, iş və təcrübə axtarışı, şəxsi karyera planı.</p>',
      '</div>',
      '<a class="btn primary student-mentor-button" href="mailto:career@asoiu.edu.az?subject=ADNSU%20Mentor%20d%C9%99st%C9%99yi">',
      'Mentora müraciət et</a>'
    ].join('');
    return el;
  }
  function picture(url,pending) {
    const display=root.querySelector('[data-photo-preview]');
    if (!display) return;
    display.replaceChildren();
    if (!url) {
      const fallback=document.createElement('span');
      fallback.className='student-photo-fallback';fallback.textContent='Şəkil';
      display.append(fallback);return;
    }
    const img=document.createElement('img');img.src=url;img.alt='Profil şəkliniz';
    img.decoding='async';display.append(img);
    if (pending) {
      const badge=document.createElement('span');
      badge.className='student-photo-pending';badge.textContent='Yoxlanılır';
      display.append(badge);
    } else {
      root.querySelectorAll('.userchip .avatar').forEach(el=>{
        const thumb=document.createElement('img');
        thumb.alt='';thumb.src=url;el.replaceChildren(thumb);
      });
    }
  }
  async function signed(path) {
    if (!path) return null;
    const {data,error}=await Backend.sb.storage.from('avatars').createSignedUrl(path,3600);
    return error ? null : data.signedUrl;
  }
  async function readCurrent() {
    const me=student();
    if (!me || !Backend.init() || !Backend.sb || photo.loading) return;
    if (photo.userId===me.id && Date.now()-photo.last<90000) {
      picture(photo.url,photo.pending);
      return;
    }
    photo.loading=true;
    try {
      const {data,error}=await Backend.sb.from('profiles')
        .select('avatar_path,avatar_pending_path,avatar_reason').eq('id',me.id).single();
      if (error) throw error;
      photo.userId=me.id;photo.pending=!!data.avatar_pending_path;
      photo.url=await signed(data.avatar_pending_path || data.avatar_path);
      photo.last=Date.now();picture(photo.url,photo.pending);
      if (photo.pending) notify('Şəkil yoxlamadadır; təsdiqlənəndə profilinizdə görünəcək.');
      else if (data.avatar_reason) notify(String(data.avatar_reason),true);
    } catch {notify('Foto məlumatını oxumaq mümkün olmadı. Bir daha yoxlayın.',true);}
    finally {photo.loading=false;}
  }
  async function toWebp(file) {
    const image=new Image();
    const url=URL.createObjectURL(file);
    try {
      await new Promise((resolve,reject)=>{
        image.onload=resolve;image.onerror=()=>reject(Error('Şəkil açıla bilmədi.'));
        image.src=url;
      });
      const scale=Math.min(1,600/Math.max(image.naturalWidth,image.naturalHeight));
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
      canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
      const ctx=canvas.getContext('2d');
      if (!ctx) throw Error('Şəkil emalı mümkün olmadı.');
      ctx.drawImage(image,0,0,canvas.width,canvas.height);
      return await new Promise((resolve,reject)=>
        canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Şəkil çevrilmədi.')),'image/webp',.82));
    } finally {URL.revokeObjectURL(url);}
  }
  async function upload(file,input) {
    const me=student();
    if (!me || !Backend.init() || !Backend.sb) {notify('Şəkil yükləmək üçün daxil olun.',true);return;}
    if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>6*1024*1024) {
      notify('JPG, PNG və ya WebP seçin (maksimum 6 MB).',true);return;
    }
    input.disabled=true;notify('Şəkil yüklənir…');
    try {
      const blob=await toWebp(file);
      const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);
      const path=me.id+'/'+Array.from(bytes,v=>v.toString(16).padStart(2,'0')).join('')+'.webp';
      const response=await Backend.sb.storage.from('avatars').upload(path,blob,{contentType:'image/webp',upsert:false});
      if (response.error) throw response.error;
      const result=await Backend.sb.rpc('avatar_submit',{p_path:path});
      if (result.error || result.data?.status!=='pending') throw result.error || Error('Yoxlama sorğusu qəbul edilmədi.');
      photo.userId=me.id;photo.url=await signed(path);photo.pending=true;photo.last=Date.now();
      picture(photo.url,true);
      notify('Şəkil uğurla yükləndi, yoxlamadadır. Təsdiq olunduqdan sonra göstəriləcək.');
    } catch(error) {notify('Yükləmə xətası: '+String(error?.message||'Yenidən yoxlayın.'),true);}
    finally {input.disabled=false;input.value='';}
  }
  function draw() {
    const me=student();
    if (!me) {photo.userId=null;photo.last=0;return;}
    const pageHead=root.querySelector('.page-head');
    if (!pageHead) return;
    const view=Store.state.view;
    if ((view==='dashboard'||view==='profile') && !root.querySelector('[data-student-mentor]'))
      pageHead.insertAdjacentElement('afterend',mentorCard());
    if (view==='profile' && root.querySelector('#p-name') && !root.querySelector('[data-student-photo]')) {
      const card=root.querySelector('#p-name').closest('.card');
      if (card) {card.insertAdjacentElement('beforebegin',avatarCard());readCurrent();}
    }
  }
  root.addEventListener('change',event=>{
    if (event.target.matches('[data-photo-input]') && event.target.files?.[0])
      upload(event.target.files[0],event.target);
  });
  new MutationObserver(draw).observe(root,{childList:true});
  draw();
})();