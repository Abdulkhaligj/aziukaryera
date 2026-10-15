/*!
 * ADNSU / ASOIU Career v2 — config.js
 *
 * Supabase konfiqurasiyası. Bu iki dəyər ictimaidir — publishable key
 * brauzerə göndərilmək üçün nəzərdə tutulub və RLS ilə qorunur.
 * (Service role açarını BURAYA HEÇ VAXT YAZMAYIN.)
 *
 * SUPABASE_URL boş qalsa, platforma avtomatik olaraq offline demo rejimində
 * işləyir: məlumat localStorage-də saxlanılır, auth isə brauzer tərəfli olur.
 * Bu, artifact və ya internetsiz nümayiş üçün lazımdır.
 *
 */

const SUPABASE_URL = 'https://ttfsbgbhyomfheglefkn.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_aVM-oMg1JHO-gZ-C9Np3cA_sygbgtRV';

/* Fakültə/ixtisas id-ləri bazadakı arayış cədvəlləri ilə eynidir. */
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
