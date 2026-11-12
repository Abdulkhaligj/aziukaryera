/* Public deployment configuration only; never put service-role or secret keys here.
 * Set the URL/key below to YOUR test project, or provide window.CAREER_CONFIG
 * before this file loads. An unconfigured/offline backend fails closed.
 * To run an intentional offline demo, explicitly set demoMode: true.
 */
const CAREER_CONFIG = window.CAREER_CONFIG || {
  apiUrl: '',
  apiKey: '',
  demoMode: false
};
const API_URL = String(CAREER_CONFIG.apiUrl || '').replace(/\/$/, '');
const API_KEY = String(CAREER_CONFIG.apiKey || '');
const CAREER_DEMO_MODE = CAREER_CONFIG.demoMode === true;
const USE_BACKEND = !CAREER_DEMO_MODE && Boolean(API_URL && API_KEY);
