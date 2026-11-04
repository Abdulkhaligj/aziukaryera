/* Approved profile photos inside avatar circles marked data-avatar-id: the
 * header chip, network posts and comments, and employer candidate views.
 * Initials stay as the fallback while a photo loads or when there is none. */
(() => {
  'use strict';
  const root = document.getElementById('root');
  if (!root || typeof Backend === 'undefined') return;
  const TTL = 45 * 60 * 1000;
  const cache = new Map();
  let queued = false;
  let loading = false;
  window.CareerSession.subscribe(() => cache.clear());

  function signedIn() {
    try { return !!Auth.currentUser() && Store.mode === 'supabase' && Backend.init() && !!Backend.sb; }
    catch { return false; }
  }
  function fresh(id) {
    const entry = cache.get(id);
    return entry && Date.now() - entry.at < TTL;
  }
  async function load(ids) {
    const want = ids.filter(id => !fresh(id)).slice(0, 500);
    if (!want.length || loading) return false;
    const scope = window.CareerSession.capture();
    if (!scope) return false;
    loading = true;
    try {
      const { data, error } = await Backend.sb.rpc('profile_avatar_paths', { p_ids: want });
      if (!window.CareerSession.matches(scope)) return false;
      if (error) {
        // Retry these ids in a minute instead of on every render.
        const retryAt = Date.now() - TTL + 60000;
        want.forEach(id => cache.set(id, { url: null, at: retryAt }));
        return false;
      }
      const rows = (data || []).filter(row => row.avatar_path);
      let signed = [];
      if (rows.length) {
        const result = await Backend.sb.storage.from('avatars')
          .createSignedUrls(rows.map(row => row.avatar_path), 3600);
        if (!window.CareerSession.matches(scope)) return false;
        signed = result.data || [];
      }
      const urlByPath = new Map(signed.filter(s => s.signedUrl && !s.error).map(s => [s.path, s.signedUrl]));
      const at = Date.now();
      want.forEach(id => cache.set(id, { url: null, at }));
      rows.forEach(row => cache.set(row.id, { url: urlByPath.get(row.avatar_path) || null, at }));
      return true;
    } catch {
      const retryAt = Date.now() - TTL + 60000;
      want.forEach(id => cache.set(id, { url: null, at: retryAt }));
      return false;
    }
    finally { loading = false; }
  }
  function apply() {
    root.querySelectorAll('[data-avatar-id]').forEach(el => {
      const url = cache.get(el.dataset.avatarId)?.url;
      if (!url || el.dataset.avatarSrc === url) return;
      const img = document.createElement('img');
      img.className = 'profile-photo';
      img.alt = '';
      img.decoding = 'async';
      img.src = url;
      el.dataset.avatarSrc = url;
      el.classList.add('has-photo');
      el.replaceChildren(img);
    });
  }
  function visibleIds() {
    return [...new Set([...root.querySelectorAll('[data-avatar-id]')]
      .map(el => el.dataset.avatarId).filter(Boolean))];
  }
  function scan() {
    // Cached photos go in before paint; only unknown ids wait for the network.
    apply();
    if (queued) return;
    queued = true;
    setTimeout(async () => {
      queued = false;
      if (!signedIn()) return;
      const ids = visibleIds();
      if (!ids.some(id => !fresh(id))) return;
      if (await load(ids)) apply();
      if (visibleIds().some(id => !fresh(id))) setTimeout(scan, 1500);
    }, 60);
  }
  new MutationObserver(scan).observe(root, { childList: true, subtree: true });
  window.ProfilePhotos = {
    refresh(id) { if (id) cache.delete(id); scan(); }
  };
  scan();
})();
