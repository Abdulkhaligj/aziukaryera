export type Status = 'Aktiv' | 'Qaralama' | 'Bitib' | 'Yoxlamada';
export type ResourceKey = 'jobs' | 'companies' | 'events' | 'benefits' | 'applications' | 'students' | 'content' | 'admins' | 'audit_logs';

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
