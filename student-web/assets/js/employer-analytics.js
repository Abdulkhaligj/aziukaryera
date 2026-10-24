/*!
 * ADNSU Career — şirkətlər üçün işə qəbul analitikası.
 * Yalnız şirkətin artıq icazəsi olan vakansiyalar və müraciətlər hesablanır.
 * Əlavə backend sorğusu, namizəd məlumatının ixracı və ya demo rəqəmlər yoxdur.
 */
function employerAnalyticsStage(application) {
  const value = String(application.statusKey || application.status || '').trim().toLocaleLowerCase('az-AZ');
  const known = {
    applied: 'applied', gonderildi: 'applied', 'göndərildi': 'applied',
    under_review: 'under_review', baxilir: 'under_review', 'baxılır': 'under_review',
    shortlisted: 'shortlisted', 'qısa siyahı': 'shortlisted',
    interview: 'interview', musahibe: 'interview', 'müsahibəyə dəvət': 'interview',
    offer: 'offer', teklif: 'offer', 'təklif': 'offer',
    hired: 'hired', 'işə qəbul': 'hired',
    rejected: 'rejected', imtina: 'rejected', 'imtina': 'rejected',
    withdrawn: 'withdrawn', geri_goturuldu: 'withdrawn', 'geri götürülüb': 'withdrawn'
  };
  return known[value] || 'other';
}

function employerAnalyticsModel() {
  const jobs = Store.companyJobs();
  const jobIds = new Set(jobs.map(job => String(job.id)));
  const applications = (Store.state.applications || [])
    .filter(application => jobIds.has(String(application.jobId)));
  const stages = [
    { key: 'applied', label: 'Yeni müraciət' },
    { key: 'under_review', label: 'Baxış mərhələsi' },
    { key: 'shortlisted', label: 'Qısa siyahı' },
    { key: 'interview', label: 'Müsahibə' },
    { key: 'offer', label: 'İş təklifi' },
    { key: 'hired', label: 'İşə qəbul' },
    { key: 'rejected', label: 'İmtina' },
    { key: 'withdrawn', label: 'Geri götürülüb' }
  ].map(stage => ({
    ...stage,
    count: applications.filter(application => employerAnalyticsStage(application) === stage.key).length
  }));

  const now = Date.now();
  const last30 = applications.filter(application => {
    const timestamp = Date.parse(application.at || '');
    return Number.isFinite(timestamp) && timestamp <= now && timestamp >= now - 30 * 86400000;
  }).length;
  const interview = stages.find(stage => stage.key === 'interview').count;
  const hired = stages.find(stage => stage.key === 'hired').count;
  const pending = jobs.filter(job => job.status === 'pending' || job.status === 'pending_approval').length;
  const active = jobs.filter(job => job.status === 'approved' || job.status === 'published').length;
  const perJob = jobs.map(job => {
    const list = applications.filter(application => String(application.jobId) === String(job.id));
    const interviewCount = list.filter(application => employerAnalyticsStage(application) === 'interview').length;
    const hireCount = list.filter(application => employerAnalyticsStage(application) === 'hired').length;
    return { job, total: list.length, interview: interviewCount, hired: hireCount };
  }).sort((a, b) => b.total - a.total);

  const skills = new Map();
  jobs.forEach(job => (job.skills || []).forEach(raw => {
    const skill = String(raw || '').trim();
    if (!skill) return;
    const key = skill.toLocaleLowerCase('az-AZ');
    const current = skills.get(key) || { label: skill, count: 0 };
    current.count += 1;
    skills.set(key, current);
  }));

  const company = Store.state.company || {};
  const profileFields = ['name', 'sector', 'contact', 'email', 'website', 'about'];
  const completed = profileFields.filter(key => String(company[key] || '').trim()).length;
  return {
    jobs, applications, stages, perJob, last30, interview, hired, pending, active,
    skills: [...skills.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, 6),
    profileProgress: Math.round(completed / profileFields.length * 100)
  };
}

function viewEmployerAnalytics() {
  const stats = employerAnalyticsModel();
  const total = stats.applications.length;
  const conversion = total ? Math.round(stats.hired / total * 100) : 0;
  const stageMax = Math.max(1, ...stats.stages.map(stage => stage.count));
  const advanced = companyCanUse('candidate_search');

  const statTiles = [
    ['Bütün müraciətlər', total, 'Yalnız sizin vakansiyalar'],
    ['Son 30 gündə', stats.last30, 'Yeni müraciət sayı'],
    ['Müsahibə mərhələsi', stats.interview, 'Hazırkı status'],
    ['İşə qəbul', stats.hired, total ? conversion + '% · ümumi müraciətlərə nisbət' : 'Hələ nəticə yoxdur']
  ];

  return '<div class="page-head"><div><div class="eyebrow">Şirkət kabineti · HR Insights</div>' +
    '<h1>İşə qəbul analitikası</h1>' +
    '<p>Vakansiyalarınızın nəticələrini, namizəd mərhələlərini və işə qəbul göstəricilərini izləyin.</p></div>' +
    '<button class="btn primary" data-act="go" data-view="post">＋ Yeni vakansiya</button></div>' +
    '<div class="em-analytics-summary">' +
      statTiles.map(item =>
        '<article class="em-metric card"><span>' + esc(item[0]) + '</span>' +
        '<strong>' + item[1] + '</strong><small>' + esc(item[2]) + '</small></article>'
      ).join('') +
    '</div>' +
    '<section class="em-recruitment-grid">' +
      '<article class="card em-panel"><div class="em-panel-head"><div>' +
        '<div class="eyebrow">Müraciət prosesi</div><h2>Mərhələlər üzrə cari bölgü</h2>' +
        '<p>Hər müraciət yalnız hazırkı mərhələsində sayılır.</p></div>' +
        '<button class="btn sm" data-act="go" data-view="applications">Müraciətlərə bax →</button></div>' +
        (total ? '<div class="em-funnel">' + stats.stages.map(stage =>
          '<div class="em-stage"><div class="em-stage-label"><span>' + esc(stage.label) +
          '</span><b>' + stage.count + '</b></div>' +
          '<div class="em-track" role="progressbar" aria-label="' + esc(stage.label) +
          '" aria-valuemin="0" aria-valuemax="' + stageMax +
          '" aria-valuenow="' + stage.count + '">' +
          '<span style="width:' + Math.round(stage.count / stageMax * 100) + '%"></span></div></div>'
        ).join('') + '</div>' :
          '<div class="em-empty">Hələ müraciət yoxdur. İlk vakansiyanızı paylaşdıqdan sonra mərhələlər burada görünəcək.</div>') +
      '</article>' +
      '<aside class="card em-panel em-side">' +
        '<div class="eyebrow">Şirkət hesabı</div><h2>İdarəetmə icmalı</h2>' +
        '<div class="em-side-row"><span>Dərc olunan vakansiyalar</span><b>' + stats.active + '</b></div>' +
        '<div class="em-side-row"><span>Təsdiq gözləyən elanlar</span><b>' + stats.pending + '</b></div>' +
        '<div class="em-side-row"><span>Profil tamamlanması</span><b>' + stats.profileProgress + '%</b></div>' +
        '<div class="em-track em-profile-track"><span style="width:' + stats.profileProgress + '%"></span></div>' +
        '<div class="em-side-actions">' +
          '<button class="btn sm" data-act="go" data-view="profile">Profili tamamla</button>' +
          '<button class="btn sm" data-act="go" data-view="vacancies">Vakansiyalarım</button></div>' +
      '</aside></section>' +
    '<section class="section"><div class="section-head"><h2>Vakansiyalar üzrə nəticələr</h2>' +
      '<span class="hint">Müraciətlər və işə qəbul göstəriciləri</span></div>' +
      (stats.perJob.length ? '<div class="table-wrap"><table><thead><tr>' +
      '<th>Vakansiya</th><th>Status</th><th class="num">Müraciət</th>' +
      '<th class="num">Müsahibə</th><th class="num">İşə qəbul</th></tr></thead><tbody>' +
      stats.perJob.map(row =>
        '<tr><td><div class="who"><b>' + esc(row.job.title) + '</b>' +
        '<small>Son tarix: ' + esc(fmtDate(row.job.deadline)) + '</small></div></td>' +
        '<td><span class="chip ' +
          (row.job.status === 'approved' || row.job.status === 'published' ? 'good' : 'warn') + '">' +
          (row.job.status === 'approved' || row.job.status === 'published' ? 'Dərc olunub' : 'Təsdiq gözləyir') +
        '</span></td><td class="num">' + row.total + '</td><td class="num">' + row.interview +
        '</td><td class="num">' + row.hired + '</td></tr>'
      ).join('') + '</tbody></table></div>' :
      '<div class="card em-empty">Hələ vakansiya yaradılmayıb. Yeni vakansiya əlavə etdikdə nəticələri burada görə bilərsiniz.</div>') +
    '</section>' +
    '<section class="section"><div class="section-head"><h2>Vakansiyalarda tələb olunan bacarıqlar</h2>' +
      '<span class="hint">Şirkətinizin elanlarına əsasən</span></div>' +
      (advanced
        ? (stats.skills.length ? '<div class="card em-panel"><div class="em-skills">' +
          stats.skills.map(skill => '<div class="em-skill"><b>' + esc(skill.label) +
            '</b><span>' + skill.count + ' vakansiya</span></div>').join('') +
          '</div></div>' : '<div class="card em-empty">Vakansiyalara tələb olunan bacarıqları əlavə etdikdə burada görünəcək.</div>')
        : '<div class="card em-upgrade"><div><b>Geniş HR analitikası</b>' +
          '<p>Pro və Business paketlərində tələb olunan bacarıqlar və Talent Pool analitikası açılır.</p></div>' +
          '<button class="btn primary sm" data-act="go" data-view="subscription">Paketlərə bax</button></div>') +
    '</section>' +
    '<p class="em-data-note">Hesabat yalnız şirkətinizin mövcud vakansiya və müraciət məlumatlarından hesablanır. ' +
    'Burada süni statistika, digər şirkətlərə aid məlumat və gizli tələbə profilləri göstərilmir.</p>';
}
