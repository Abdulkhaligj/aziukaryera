// Messages shown from a URL parameter (?error=, ?notice=). The URL carries a
// code from this list, never the text itself, so a crafted link cannot show
// its own words inside the panel (audit 2026-11-13, #79).
export const MESSAGES = {
  'login.missing': 'E-poçt və şifrəni yazın.',
  'login.unconfirmed': 'E-poçt ünvanı təsdiqlənməyib. Super Admin ilə əlaqə saxlayın.',
  'login.invalid': 'E-poçt və ya şifrə yanlışdır.',
  'login.forbidden': 'Bu hesabın admin paneldə səlahiyyəti yoxdur.',
  'logout.failed': 'Sessiya bağlanmadı. İnternet bağlantısını yoxlayıb çıxışı yenidən sınayın.',
  'logout.done': 'Sistemdən çıxdınız.',
  'password.current_missing': 'Cari (və ya müvəqqəti) şifrəni daxil edin.',
  'password.too_short': 'Şifrə ən azı 10 simvol olmalıdır.',
  'password.weak': 'Şifrədə ən azı bir hərf və bir rəqəm olmalıdır.',
  'password.mismatch': 'Şifrələr üst-üstə düşmür.',
  'password.current_wrong': 'Cari şifrə yanlışdır.',
  'password.failed': 'Şifrə dəyişmədi. Cari şifrəni və yeni şifrənin əvvəlkindən fərqli olduğunu yoxlayın.',
  'password.updated': 'Şifrəniz yeniləndi.',
  'password.updated_relogin': 'Şifrəniz yeniləndi. Yeni şifrə ilə daxil olun.'
} as const;

export type MessageCode = keyof typeof MESSAGES;

/** The text for a code from the URL, or nothing for anything else. */
export function messageFor(code: unknown): string | undefined {
  return typeof code === 'string' && Object.hasOwn(MESSAGES, code) ? MESSAGES[code as MessageCode] : undefined;
}

/** An e-mail address taken from the URL to prefill the form, if it looks like one. */
export function emailFromQuery(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(value) ? value : undefined;
}
