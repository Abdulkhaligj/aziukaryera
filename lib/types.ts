export type Status = 'Aktiv' | 'Qaralama' | 'Bitib' | 'Yoxlamada';
export type ResourceKey =
  | 'jobs' | 'pending_jobs' | 'companies' | 'events' | 'benefits' | 'awards' | 'ads' | 'applications'
  | 'students' | 'master_students' | 'alumni' | 'mentor_requests'
  | 'network' | 'reports' | 'moderation_logs' | 'subscriptions' | 'plans' | 'payments'
  | 'cv_analytics' | 'interview_analytics' | 'ai_usage'
  | 'notifications' | 'content' | 'admins' | 'audit_logs';

export type AdminRow = {
  id: string;
  title: string;
  subtitle: string;
  status: Status;
  meta: string;
  updatedAt: string;
  fields?: Record<string, string | number | boolean | null>;
  /* Siyahıda göstəriləcək şəkil: profil şəkli (imzalı link) və ya şirkət loqosu */
  avatar?: string;
  avatarKind?: 'photo' | 'logo';
};

export type AdminRole = 'super_admin' | 'manager' | 'editor' | 'reviewer';

/* Formalarda seçim siyahıları üçün arayış məlumatı */
export type Lookups = {
  faculties: { id: string; name: string }[];
  majors: { id: string; name: string; faculty_id: string }[];
};
