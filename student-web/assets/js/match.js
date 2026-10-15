/*!
 * ADNSU / ASOIU Career v2 — match.js
 * Uyğunluq mühərriki. Platformanın əsas fərqləndirici funksiyası.
 *
 *   Fakültə     40 bal
 *   İxtisas     40 bal  (eyni fakültədən fərqli ixtisas → 15 bal)
 *   Bacarıqlar  20 bal  (tələb olunan bacarıqların örtülmə nisbətinə görə)
 *   ────────────────────
 *   Ümumi      100 bal
 *
 */

const WEIGHTS = { faculty: 40, major: 40, majorRelated: 15, skills: 20 };

/** Bacarıq adlarını müqayisə üçün normallaşdırır. */
function normSkill(s) {
  return String(s || '').toLowerCase().replace(/[\s._/-]+/g, '');
}

/**
 * Elan ilə tələbə profili arasında tam uyğunluq hesabatı.
 * @returns {{score:number, faculty:number, major:number, skills:number,
 *            matched:string[], missing:string[], reasons:string[], eligible:boolean, blockers:string[]}}
 */
function matchReport(job, student) {
  const report = {
    score: 0, faculty: 0, major: 0, skills: 0,
    matched: [], missing: [], reasons: [], blockers: [], eligible: true
  };
  if (!job || !student) return report;

  const facultyList = job.faculties || [];
  const majorList = job.majors || [];

  /* 1. Fakültə ------------------------------------------------------- */
  if (facultyList.length === 0 || facultyList.includes(student.faculty)) {
    report.faculty = WEIGHTS.faculty;
    report.reasons.push('Fakültə uyğundur');
  } else {
    report.reasons.push('Fakültə hədəf siyahısında deyil');
  }

  /* 2. İxtisas ------------------------------------------------------- */
  if (majorList.length === 0) {
    // Bütün ixtisaslara açıq elan (məs. könüllülük) — ixtisas balı tam verilir.
    report.major = WEIGHTS.major;
    report.reasons.push('Bütün ixtisaslara açıqdır');
  } else if (majorList.includes(student.major)) {
    report.major = WEIGHTS.major;
    report.reasons.push('İxtisas birbaşa uyğundur');
  } else if (facultyList.includes(student.faculty)) {
    // Eyni fakültə, fərqli ixtisas → qismən uyğunluq.
    report.major = WEIGHTS.majorRelated;
    report.reasons.push('Qohum ixtisas (eyni fakültə)');
  } else {
    report.reasons.push('İxtisas uyğun gəlmir');
  }

  /* 3. Bacarıqlar ---------------------------------------------------- */
  const required = job.skills || [];
  const mine = new Set((student.skills || []).map(normSkill));
  if (required.length === 0) {
    report.skills = WEIGHTS.skills;
  } else {
    required.forEach(r => (mine.has(normSkill(r)) ? report.matched : report.missing).push(r));
    report.skills = Math.round((report.matched.length / required.length) * WEIGHTS.skills);
    if (report.matched.length) report.reasons.push(`${report.matched.length}/${required.length} bacarıq üst-üstə düşür`);
  }

  report.score = Math.min(100, report.faculty + report.major + report.skills);

  /* 4. Formal şərtlər — bala təsir etmir, ayrıca xəbərdarlıq kimi göstərilir */
  if (job.minCourse && Number(student.course) && Number(student.course) < job.minCourse) {
    report.eligible = false;
    report.blockers.push(`Minimum ${job.minCourse}. kurs tələb olunur`);
  }
  if (job.minGPA && Number(student.gpa) && Number(student.gpa) < job.minGPA) {
    report.eligible = false;
    report.blockers.push(`Minimum GPA ${job.minGPA} tələb olunur`);
  }
  return report;
}

/**
 * Spesifikasiyadakı sadə formula — sənədləşmə və test üçün saxlanılır.
 * matchReport() bunun daha dəqiq (nisbətə görə hesablayan) variantıdır.
 */
function matchScore(job, student) {
  return matchReport(job, student).score;
}

/** Elanları tələbəyə görə sıralayır. */
function rankOpportunities(jobs, student, opts = {}) {
  const min = opts.min ?? 0;
  return jobs
    .filter(j => j.status !== 'pending')
    .map(j => ({ job: j, report: matchReport(j, student) }))
    .filter(x => x.report.score >= min)
    .sort((a, b) => b.report.score - a.report.score || a.job.deadline.localeCompare(b.job.deadline));
}

/** Namizədləri elana görə sıralayır (şirkət kabineti). */
function rankCandidates(students, job, opts = {}) {
  const min = opts.min ?? 0;
  return students
    .map(s => ({ student: s, report: matchReport(job, s) }))
    .filter(x => x.report.score >= min)
    .sort((a, b) => b.report.score - a.report.score || b.student.gpa - a.student.gpa);
}

/**
 * Tələbənin hədəf sahədə ən çox rast gəlinən çatışmayan bacarıqlarını qaytarır.
 * Yol xəritəsi və CV tövsiyələri bunu istifadə edir.
 */
function skillGap(jobs, student, limit = 6) {
  const counter = new Map();
  jobs.filter(j => j.status !== 'pending').forEach(job => {
    const r = matchReport(job, student);
    if (r.faculty === 0) return;                 // yalnız öz sahəsindəki elanlar
    r.missing.forEach(s => counter.set(s, (counter.get(s) || 0) + 1));
  });
  return [...counter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([skill, count]) => ({ skill, count }));
}

/** Uyğunluq səviyyəsinin etiketi və semantik rəng açarı. */
function matchBand(score) {
  if (score >= 85) return { label: 'Çox yüksək', tone: 'good' };
  if (score >= 65) return { label: 'Yüksək', tone: 'good' };
  if (score >= 45) return { label: 'Orta', tone: 'warn' };
  return { label: 'Aşağı', tone: 'bad' };
}

/** Profil tamlığı — 0–100. */
function profileCompleteness(p) {
  const checks = [
    ['Ad və soyad', !!p.name],
    ['Fakültə', !!p.faculty],
    ['İxtisas', !!p.major],
    ['Kurs', !!p.course],
    ['GPA', !!p.gpa],
    ['Bacarıqlar (min. 3)', (p.skills || []).length >= 3],
    ['Dillər', !!p.languages],
    ['Sertifikatlar', !!p.certificates],
    ['E-poçt', !!p.email],
    ['LinkedIn', !!p.linkedin],
    ['GitHub / Portfolio', !!(p.github || p.portfolio)],
    ['CV', !!p.cvReady]
  ];
  const done = checks.filter(c => c[1]).length;
  return {
    percent: Math.round((done / checks.length) * 100),
    missing: checks.filter(c => !c[1]).map(c => c[0])
  };
}
