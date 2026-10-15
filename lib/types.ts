export type Status = 'Aktiv' | 'Qaralama' | 'Bitib' | 'Yoxlamada';
export type ResourceKey =
  | 'jobs' | 'pending_jobs' | 'companies' | 'events' | 'benefits' | 'applications'
  | 'students' | 'master_students' | 'alumni'
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
};

export type AdminRole = 'super_admin' | 'manager' | 'editor' | 'reviewer';
