/*!
 * ADNSU / ASOIU Career v2 — interview.js
 * Müsahibə simulyatoru: sual seçimi və cavabların qiymətləndirilməsi.
 *
 * Qiymətləndirmə offline heuristikdir — cavabın strukturu, texniki
 * terminologiyası, uzunluğu və özünəinam siqnalları ölçülür. Nəticə
 * məsləhət xarakterlidir, real müsahibə qiyməti deyil.
 *
 */

const INTERVIEW_TYPES = {
  'HR': ['hr'],
  'Texniki': ['technical'],
  'Technical + HR': ['technical', 'hr'],
  'Davranış (Behavioral)': ['behavioral'],
  'Tam dəst (HR + Texniki + Davranış)': ['hr', 'technical', 'behavioral'],
  'İngilis dili': ['english']
};

/** STAR strukturunun siqnalları */
const STAR_MARKERS = ['vəziyyət', 'situasiya', 'tapşırıq', 'məqsəd', 'addım', 'etdim', 'nəticə', 'nəticədə', 'sonda', 'beləliklə'];
/** Özünəinam zəiflədən ifadələr */
const HEDGES = ['bilmirəm', 'bəlkə', 'deyəsən', 'yəqin ki', 'çox əmin deyiləm', 'heç vaxt etməmişəm', 'düşünürəm ki bəlkə'];
/** Struktur bağlayıcıları */
const CONNECTORS = ['birincisi', 'ikincisi', 'əvvəlcə', 'sonra', 'daha sonra', 'nəhayət', 'çünki', 'ona görə', 'məsələn', 'nümunə'];

/**
 * Müsahibə dəsti hazırlayır.
 * @param {object} opts { companyId, role, type, field, count }
 */
function buildInterview(opts) {
  const groups = INTERVIEW_TYPES[opts.type] || ['hr'];
  const field = opts.field || 'mexanika';
  const perGroup = Math.max(2, Math.ceil((opts.count || 6) / groups.length));
  const set = [];

  groups.forEach(g => {
    const bank = g === 'technical' ? (INTERVIEW_BANK[field] || []) : (INTERVIEW_BANK[g] || []);
    const label = g === 'technical' ? 'Texniki' : g === 'hr' ? 'HR' : g === 'behavioral' ? 'Davranış' : 'English';
    shuffle([...bank]).slice(0, perGroup).forEach(item =>
      set.push({ ...item, group: label, technical: g === 'technical' || g === 'english' })
    );
  });

  return set.slice(0, opts.count || 6).map((q, i) => ({ ...q, index: i + 1 }));
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Bir cavabı qiymətləndirir.
 * @returns {{communication, technical, confidence, structure, english, note}} hər biri 0–10
 */
function scoreAnswer(answer, question, studentSkills = []) {
  const text = String(answer || '').trim();
  const low = text.toLowerCase();
  const words = text.split(/\s+/).filter(Boolean).length;

  if (words < 5) {
    return { communication: 0, technical: 0, confidence: 0, structure: 0, english: 0, answered: false, note: 'Cavab verilməyib' };
  }

  /* Ünsiyyət — həcm balansı və cümlə quruluşu */
  const sentences = (text.match(/[.!?]+/g) || []).length || 1;
  const avgSentence = words / sentences;
  let communication = 4;
  if (words >= 40 && words <= 220) communication += 3;
  else if (words >= 20) communication += 1.5;
  if (avgSentence >= 8 && avgSentence <= 26) communication += 2;
  if (sentences >= 3) communication += 1;

  /* Struktur — bağlayıcılar və STAR siqnalları */
  const connectors = CONNECTORS.filter(c => low.includes(c)).length;
  const star = STAR_MARKERS.filter(c => low.includes(c)).length;
  let structure = 3 + Math.min(connectors * 1.4, 4) + Math.min(star * 0.8, 3);

  /* Texniki — sahə terminləri, rəqəmlər, öz bacarıqlarının adlandırılması */
  const numbers = (text.match(/\d/g) || []).length;
  const skillMentions = studentSkills.filter(s => low.includes(String(s).toLowerCase())).length;
  const termHits = (question.hint || '').toLowerCase().split(/[\s,.:—]+/)
    .filter(w => w.length > 4).filter(w => low.includes(w)).length;
  let technical = question.technical ? 2.5 : 4;
  technical += Math.min(termHits * 1.2, 3.5);
  technical += Math.min(skillMentions * 1.2, 2);
  technical += numbers > 0 ? 1.5 : 0;
  if (words > 60) technical += 0.8;

  /* Özünəinam — tərəddüd ifadələrinin olmaması */
  const hedges = HEDGES.filter(h => low.includes(h)).length;
  let confidence = 8 - hedges * 2.2;
  if (/(bacarıram|təcrübəm var|həyata keçirdim|nail oldum|öhdəsindən gəldim)/.test(low)) confidence += 1.5;
  if (words < 25) confidence -= 1.5;

  /* İngilis dili — yalnız latın əlifbalı, AZ-spesifik hərfsiz cavablarda ölçülür */
  const azLetters = (text.match(/[əğıöşçüİ]/gi) || []).length;
  const isEnglish = azLetters / Math.max(text.length, 1) < 0.01;
  let english = isEnglish ? 6 + Math.min(words / 40, 3) : 5;
  if (isEnglish && /\b(because|therefore|however|which|result|team|project)\b/i.test(text)) english += 1;

  const clamp = n => Math.max(0, Math.min(10, Math.round(n * 10) / 10));
  const res = {
    communication: clamp(communication),
    technical: clamp(technical),
    confidence: clamp(confidence),
    structure: clamp(structure),
    english: clamp(english),
    answered: true
  };

  /* Ən zəif ölçü üzrə konkret tövsiyə */
  const weakest = Object.entries({
    communication: res.communication, technical: res.technical,
    confidence: res.confidence, structure: res.structure
  }).sort((a, b) => a[1] - b[1])[0][0];
  res.note = {
    communication: 'Cavabı 3–4 tam cümləyə genişləndirin, çox qısa kəsməyin.',
    technical: 'Konkret alət, termin və ya rəqəm adlandırın (məs. «HYSYS-də material balansı»).',
    confidence: 'Tərəddüd ifadələrini («bəlkə», «deyəsən») çıxarın, birbaşa iddia qurun.',
    structure: 'STAR sxemi ilə danışın: Situasiya → Tapşırıq → Addım → Nəticə.'
  }[weakest];
  return res;
}

/** Bütün cavabları toplayıb yekun hesabat qurur. */
function scoreInterview(questions, answers, studentSkills = []) {
  const rows = questions.map((q, i) => ({ q, score: scoreAnswer(answers[i], q, studentSkills) }));
  const answered = rows.filter(r => r.score.answered);
  const dims = ['communication', 'technical', 'confidence', 'structure', 'english'];

  const avg = {};
  dims.forEach(d => {
    avg[d] = answered.length
      ? Math.round((answered.reduce((s, r) => s + r.score[d], 0) / answered.length) * 10) / 10
      : 0;
  });

  /* Yekun bal: ünsiyyət 25 · texniki 30 · özünəinam 15 · struktur 20 · ingilis 10 */
  const total = Math.round(
    avg.communication * 2.5 + avg.technical * 3 + avg.confidence * 1.5 +
    avg.structure * 2 + avg.english * 1
  );

  const tips = [...new Set(answered.map(r => r.score.note).filter(Boolean))].slice(0, 3);
  if (answered.length < questions.length) {
    tips.unshift(`${questions.length - answered.length} sual cavabsız qaldı — real müsahibədə hər suala cavab verin.`);
  }

  return {
    total: Math.max(0, Math.min(100, total)),
    dims: avg,
    rows,
    answeredCount: answered.length,
    tips,
    band: total >= 80 ? 'Hazırsınız' : total >= 60 ? 'Yaxşı, amma məşq lazımdır' : 'Ciddi hazırlıq tələb olunur'
  };
}

const DIM_LABELS = {
  communication: 'Ünsiyyət',
  technical: 'Texniki bilik',
  confidence: 'Özünəinam',
  structure: 'Cavab strukturu',
  english: 'İngilis dili'
};
