/*!
 * ADNSU Karyera — fast authenticated startup.
 * One RLS-preserving Supabase RPC instead of 16 authenticated REST queries.
 * Neither account permissions nor stored data are changed.
 * Deleting this include restores the prior Backend.loadAll implementation.
 */
(() => {
  'use strict';
  if (typeof Backend === 'undefined' || typeof Backend.loadAll !== 'function') return;

  const oldLoadAll = Backend.loadAll.bind(Backend);

  Backend.loadAll = async function () {
    if (!this.init()) {
      return { ok: false, error: 'Giriş xidməti əlçatan deyil. Yenidən cəhd edin.' };
    }
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8500);
    try {
      const { data, error } = await this.sb.rpc('career_bootstrap_v1')
        .abortSignal(controller.signal);

      if (error) {
        // Allow older backend deployments to continue working temporarily.
        if (['PGRST202', '42883'].includes(error.code)) return oldLoadAll();
        console.warn('[ADNSU] Fast bootstrap failed:', error.code || error.message);
        return {
          ok: false,
          error: 'Kabinet məlumatları alınmadı. İnternet bağlantısını yoxlayıb yenidən daxil olun.'
        };
      }

      const payload = typeof data === 'string' ? JSON.parse(data) : data;
      if (!payload || !payload.profile || !payload.uid) {
        return { ok: false, error: 'İstifadəçi profili yüklənmədi. Hesabın aktiv olduğunu yoxlayın.' };
      }

      const requiredArrays = [
        'faculties', 'majors', 'education', 'candidates', 'companies', 'jobs',
        'applications', 'saved', 'invites', 'events', 'eventRegistrations',
        'notifications', 'broadcasts', 'broadcastReads'
      ];
      if (requiredArrays.some(key => !Array.isArray(payload[key]))) {
        console.error('[ADNSU] Unexpected career bootstrap response shape');
        return { ok: false, error: 'Kabinet məlumatlarının formatı yenilənir. Səhifəni təzələyin.' };
      }

      const ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started);
      console.info('[ADNSU] Kabinet məlumatları yükləndi:', ms + 'ms');
      return { ...payload, ok: true };
    } catch (error) {
      console.warn('[ADNSU] Fast bootstrap network error:', error?.message || error);
      return {
        ok: false,
        error: controller.signal.aborted
          ? 'Server cavabı gecikdi. Yenidən cəhd edin.'
          : 'Kabinet məlumatlarına qoşulmaq mümkün olmadı. Yenidən cəhd edin.'
      };
    } finally {
      clearTimeout(timer);
    }
  };
})();
