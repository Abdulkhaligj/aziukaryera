/* Public deployment configuration only; never put service-role or secret keys here.
 * Set the URL/key below to YOUR test project, or provide window.CAREER_CONFIG
 * before this file loads. An unconfigured/offline backend fails closed.
 * To run an intentional offline demo, explicitly set demoMode: true.
 */
const CAREER_CONFIG = window.CAREER_CONFIG || {
  supabaseUrl: '',
  supabasePublishableKey: '',
  demoMode: false
};
const SUPABASE_URL = String(CAREER_CONFIG.supabaseUrl || '').replace(/\/$/, '');
const SUPABASE_PUBLISHABLE_KEY = String(CAREER_CONFIG.supabasePublishableKey || '');
const CAREER_DEMO_MODE = CAREER_CONFIG.demoMode === true;
const USE_SUPABASE = !CAREER_DEMO_MODE && Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
