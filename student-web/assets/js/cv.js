/*!
 * ADNSU / ASOIU Career v2 — cv.js
 * CV Mərkəzi: qurma, analiz və vakansiya ilə müqayisə.
 *
 * Analiz tam olaraq brauzerdə, offline işləyir — heç bir mətn serverə göndərilmir.
 * Qiymətləndirmə heuristikdir: struktur, ölçülə bilən nəticələr, fəaliyyət
 * felləri və əlaqə məlumatları yoxlanılır.
 *
 */

/* Ölçülə bilən nəticəni göstərən fəaliyyət felləri (AZ + EN) */
const ACTION_VERBS = [
  'hazırladım', 'layihələndirdim', 'təkmilləşdirdim', 'optimallaşdırdım', 'analiz etdim',
  'idarə etdim', 'koordinasiya etdim', 'qurdum', 'tətbiq etdim', 'azaltdım', 'artırdım',
  'avtomatlaşdırdım', 'test etdim', 'modelləşdirdim', 'hesabladım',
  'designed', 'developed', 'improved', 'optimized', 'analyzed', 'managed', 'led',
  'built', 'implemented', 'reduced', 'increased', 'automated', 'tested', 'modelled'
];

/* CV-də olması gözlənilən bölmələr və onların açar sözləri */
const CV_SECTIONS = [
  { key: 'contact', label: 'Əlaqə məlumatları', words: ['e-mail', 'email', 'e-poçt', '@', 'tel', 'mob', '+994'] },
  { key: 'education', label: 'Təhsil', words: ['təhsil', 'education', 'universitet', 'bakalavr', 'adnsu', 'asoiu', 'gpa'] },
  { key: 'experience', label: 'Təcrübə', words: ['təcrübə', 'experience', 'intern', 'staj', 'iş təcrübəsi', 'praktika'] },
  { key: 'projects', label: 'Layihələr', words: ['layihə', 'project', 'kurs işi', 'diplom'] },
  { key: 'skills', label: 'Bacarıqlar', words: ['bacarıq', 'skills', 'proqram', 'software', 'texniki'] },
  { key: 'languages', label: 'Dillər', words: ['dil', 'language', 'ingilis', 'english', 'ielts', 'toefl'] },
  { key: 'links', label: 'LinkedIn / GitHub', words: ['linkedin', 'github', 'portfolio', 'behance'] }
];

/** Profil məlumatlarından struktur CV obyekti qurur. */
function buildCVFromProfile(p) {
  const education = (p.education || []).length
    ? p.education.map(e => ({
        school: e.university || 'ADNSU',
        program: [e.degreeType, e.faculty, e.specialty, e.specialization].filter(Boolean).join(' · '),
        period: `${e.startYear || ''} – ${e.isCurrent ? 'davam edir' : (e.graduationYear || '')}`,
        note: [e.group ? `Qrup: ${e.group}` : '', e.verified ? 'Təsdiqlənib' : ''].filter(Boolean).join(' · ')
      }))
    : [{
        school: 'Azərbaycan Dövlət Neft və Sənaye Universiteti (ADNSU)',
        program: `${p.faculty || ''} — ${p.major || ''}`,
        period: `${p.startYear || ''} – davam edir`,
        note: p.gpa ? `GPA: ${p.gpa}/100` : ''
      }];
  return {
    name: p.name || '',
    title: p.major ? `${p.major} · ${p.course || ''}. kurs` : '',
    email: p.email || '',
    phone: p.phone || '',
    city: p.city || 'Bakı, Azərbaycan',
    links: [p.linkedin, p.github, p.portfolio].filter(Boolean),
    summary: p.summary || '',
    education,
    experience: p.experience || [],
    projects: p.projects || [],
    skills: p.skills || [],
    languages: p.languages || '',
    certificates: p.certificates || ''
  };
}

/** CV obyektini düz mətnə çevirir — analiz və müqayisə bunun üzərində işləyir. */
function cvToText(cv) {
  const lines = [
    cv.name, cv.title, cv.email, cv.phone, cv.city, ...(cv.links || []),
    'Xülasə', cv.summary,
    'Təhsil', ...(cv.education || []).map(e => `${e.school} ${e.program} ${e.period} ${e.note}`),
    'Təcrübə', ...(cv.experience || []).map(e => `${e.role} ${e.org} ${e.period} ${e.detail}`),
    'Layihələr', ...(cv.projects || []).map(p => `${p.name} ${p.detail}`),
    'Bacarıqlar', (cv.skills || []).join(', '),
    'Dillər', cv.languages,
    'Sertifikatlar', cv.certificates
  ];
  return lines.filter(Boolean).join('\n');
}

/**
 * CV mətnini qiymətləndirir.
 * @returns {{score:number, sections:Array, findings:Array, stats:object}}
 */
function analyzeCV(text) {
  const raw = String(text || '');
  const low = raw.toLowerCase();
  const words = raw.split(/\s+/).filter(Boolean);
  const bullets = (raw.match(/^\s*[-•*–]/gm) || []).length;
  const numbers = (raw.match(/\d+\s*(%|faiz|ay|il|saat|AZN|kq|kW|MW|bar|°C)/gi) || []).length;
  const verbs = ACTION_VERBS.filter(v => low.includes(v)).length;

  const sections = CV_SECTIONS.map(s => ({
    label: s.label,
    key: s.key,
    found: s.words.some(w => low.includes(w))
  }));
  const foundCount = sections.filter(s => s.found).length;

  /* Bal bölgüsü: struktur 45 · məzmun 35 · ölçü 20 */
  let score = 0;
  score += Math.round((foundCount / CV_SECTIONS.length) * 45);
  score += Math.min(verbs * 4, 16);
  score += Math.min(bullets * 2, 10);
  score += numbers >= 3 ? 9 : numbers * 3;
  if (words.length >= 180 && words.length <= 650) score += 12;
  else if (words.length >= 100) score += 6;
  if (/(linkedin|github)/.test(low)) score += 8;
  score = Math.max(0, Math.min(100, score));

  const findings = [];
  sections.filter(s => !s.found).forEach(s =>
    findings.push({ tone: 'bad', text: `«${s.label}» bölməsi tapılmadı — əlavə edin.` })
  );
  if (numbers < 3) findings.push({ tone: 'warn', text: 'Nəticələri rəqəmlə göstərin: «istehsal itkisini 12% azaltdım» kimi.' });
  else findings.push({ tone: 'good', text: `${numbers} ölçülə bilən nəticə tapıldı — güclü tərəf.` });
  if (verbs < 3) findings.push({ tone: 'warn', text: 'Fəaliyyət felləri azdır. «İştirak etdim» əvəzinə «modelləşdirdim / optimallaşdırdım» yazın.' });
  else findings.push({ tone: 'good', text: `${verbs} fəaliyyət feli işlədilib.` });
  if (words.length < 180) findings.push({ tone: 'warn', text: `CV qısadır (${words.length} söz). Tələbə CV-si üçün 250–450 söz optimaldır.` });
  else if (words.length > 650) findings.push({ tone: 'warn', text: `CV uzundur (${words.length} söz). Bir səhifəyə sığdırın.` });
  else findings.push({ tone: 'good', text: `Həcm optimaldır (${words.length} söz).` });
  if (bullets < 4) findings.push({ tone: 'warn', text: 'Bənd (bullet) işarələri az istifadə olunub — oxunaqlılığı azaldır.' });
  if (!/(linkedin|github)/.test(low)) findings.push({ tone: 'warn', text: 'LinkedIn və ya GitHub linki əlavə edin.' });

  return {
    score,
    sections,
    findings,
    stats: { words: words.length, bullets, numbers, verbs, sections: foundCount }
  };
}

/**
 * CV mətnini konkret vakansiya ilə müqayisə edir (ATS məntiqi).
 * @returns {{score:number, hits:string[], gaps:string[], titleHit:boolean}}
 */
function compareCVtoJob(text, job) {
  const low = String(text || '').toLowerCase();
  const keywords = [
    ...(job.skills || []),
    ...job.title.split(/[\s/&]+/).filter(w => w.length > 3),
    ...(job.requirements || []).flatMap(r => r.split(/[\s,]+/).filter(w => w.length > 5))
  ];
  const unique = [...new Set(keywords.map(k => k.trim()).filter(Boolean))];

  const hits = [], gaps = [];
  unique.forEach(k => (low.includes(k.toLowerCase()) ? hits : gaps).push(k));

  const skillHits = (job.skills || []).filter(s => low.includes(s.toLowerCase()));
  const titleHit = job.title.toLowerCase().split(/\s+/).some(w => w.length > 4 && low.includes(w));

  /* Tələb olunan bacarıqlar 70%, digər açar sözlər 20%, vəzifə adı 10% */
  const skillPart = (job.skills || []).length ? (skillHits.length / job.skills.length) * 70 : 70;
  const otherPart = unique.length ? (hits.length / unique.length) * 20 : 20;
  const titlePart = titleHit ? 10 : 0;

  return {
    score: Math.round(Math.min(100, skillPart + otherPart + titlePart)),
    hits: [...new Set(hits)].slice(0, 14),
    gaps: [...new Set(gaps)].slice(0, 14),
    skillHits,
    skillGaps: (job.skills || []).filter(s => !low.includes(s.toLowerCase())),
    titleHit
  };
}
