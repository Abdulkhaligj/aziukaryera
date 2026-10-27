/*!
 * ADNSU Career - runtime backend compatibility.
 * The deployed 20261024 app.js expects avatar, ads and awards methods absent
 * from the deployed backend.js. Restore those methods using existing Supabase
 * tables/functions, never exposing private records or bypassing RLS.
 */
(() => {
  'use strict';
  if (typeof Backend === 'undefined') return;
  const client = () => {
    if (!Backend.init()) return null;
    return Backend.sb;
  };
  const errorMessage = e => String(e?.message || 'Əməliyyat alınmadı. Yenidən cəhd edin.');

  if (typeof Backend.myAvatar !== 'function') {
    Backend.myAvatar = async function () {
      const uid = typeof Store !== 'undefined' ? Store.state?.session?.userId : null;
      if (!uid) return { ok: false };
      const sb = client();
      if (!sb) return { ok: false, uid };
      try {
        const { data, error } = await sb.from('profiles')
          .select('avatar_path,avatar_pending_path,avatar_reason,avatar_url')
          .eq('id', uid).maybeSingle();
        if (error || !data) return { ok: false, uid };
        let src = data.avatar_url || '';
        if (data.avatar_path) {
          const signed = await sb.storage.from('avatars').createSignedUrl(data.avatar_path, 3600);
          if (!signed.error) src = signed.data?.signedUrl || src;
        }
        return {
          ok: true, uid, src, pendingPath: data.avatar_pending_path || '',
          reason: data.avatar_reason || ''
        };
      } catch (error) {
        console.warn('[ADNSU] Profil şəklinin yüklənməsi alınmadı:', errorMessage(error));
        return { ok: false, uid };
      }
    };
  }

  if (typeof Backend.activeAds !== 'function') {
    Backend.activeAds = async function (placement) {
      const sb = client();
      if (!sb) return [];
      try {
        const { data, error } = await sb.rpc('active_ads', { p_placement: placement || null });
        if (error) { console.warn('[ADNSU] Reklam sorğusu:', error.message); return []; }
        return Array.isArray(data) ? data : [];
      } catch { return []; }
    };
  }

  if (typeof Backend.trackAd !== 'function') {
    Backend.trackAd = async function (id, kind) {
      const sb = client();
      if (!sb || !id || !['view', 'click'].includes(kind)) return { ok: false };
      const { error } = await sb.rpc('ad_track', { p_id: id, p_kind: kind });
      return { ok: !error };
    };
  }

  if (typeof Backend.awards !== 'function') {
    Backend.awards = async function () {
      const sb = client();
      if (!sb) return { ok: false, rows: [] };
      const { data, error } = await sb.from('company_awards')
        .select('*').order('year', { ascending: false });
      return { ok: !error, rows: data || [], error: errorMessage(error) };
    };
  }

  if (typeof Backend.saveAward !== 'function') {
    Backend.saveAward = async function (fields) {
      const sb = client();
      if (!sb) return { ok: false, error: 'Serverə qoşulmaq mümkün olmadı.' };
      const { data, error } = await sb.from('company_awards')
        .insert(fields).select().single();
      return { ok: !error, row: data, error: errorMessage(error) };
    };
  }

  if (typeof Backend.updateAward !== 'function') {
    Backend.updateAward = async function (id, fields) {
      const sb = client();
      if (!sb) return { ok: false };
      const { data, error } = await sb.from('company_awards')
        .update(fields).eq('id', id).select().single();
      return { ok: !error, row: data, error: errorMessage(error) };
    };
  }

  if (typeof Backend.deleteAward !== 'function') {
    Backend.deleteAward = async function (id) {
      const sb = client();
      if (!sb) return { ok: false };
      const { error } = await sb.from('company_awards').delete().eq('id', id);
      return { ok: !error, error: errorMessage(error) };
    };
  }

  if (typeof Backend.uploadAvatar !== 'function') {
    Backend.uploadAvatar = async function (blob) {
      const uid = Store.state?.session?.userId;
      const sb = client();
      if (!uid || !sb || !(blob instanceof Blob)) {
        return { ok: false, error: 'Profil şəkli yükləmək mümkün olmadı.' };
      }
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      const randomId = [...bytes].map(n => n.toString(16).padStart(2, '0')).join('');
      const extension = blob.type === 'image/jpeg' ? 'jpg' : 'webp';
      const path = uid + '/' + randomId + '.' + extension;
      try {
        const upload = await sb.storage.from('avatars').upload(path, blob, {
          cacheControl: '3600', upsert: false, contentType: blob.type || 'image/webp'
        });
        if (upload.error) return { ok: false, error: errorMessage(upload.error) };
        const response = await sb.rpc('avatar_submit', { p_path: path });
        if (response.error) {
          await sb.storage.from('avatars').remove([path]).catch(() => {});
          return { ok: false, error: errorMessage(response.error) };
        }
        return { ok: true, pending: true };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    };
  }

  if (typeof Backend.removeAvatar !== 'function') {
    Backend.removeAvatar = async function () {
      const sb = client();
      if (!sb) return { ok: false, error: 'Serverə qoşulmaq mümkün olmadı.' };
      const { data, error } = await sb.rpc('avatar_remove');
      if (error) return { ok: false, error: errorMessage(error) };
      if (Array.isArray(data?.files) && data.files.length) {
        await sb.storage.from('avatars').remove(data.files).catch(() => {});
      }
      return { ok: true };
    };
  }
})();
