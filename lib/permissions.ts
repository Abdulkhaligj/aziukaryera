import type { AdminRole, ResourceKey } from '@/lib/types';

/*
 * Role permissions, shared by the API routes (enforcement) and the UI (which
 * buttons to show). The database treats every admin role the same (is_admin),
 * so this table is where the roles actually differ.
 *
 * super_admin — everything, including staff accounts and the platform reset
 * manager     — all content, people and commerce; delete
 * editor      — create and edit content; moderate; no delete, people or commerce
 * reviewer    — read everything; update applications, reports and post moderation
 */
export type Action = 'create' | 'edit' | 'delete';

const content = new Set<ResourceKey>(['jobs', 'pending_jobs', 'companies', 'events', 'benefits', 'awards', 'content']);
const moderation = new Set<ResourceKey>(['applications', 'network', 'reports', 'mentor_requests']);
const people = new Set<ResourceKey>(['students', 'master_students', 'alumni']);
const commerce = new Set<ResourceKey>(['subscriptions', 'plans', 'payments', 'ads']);
const records = new Set<ResourceKey>(['cv_analytics', 'interview_analytics', 'ai_usage', 'notifications']);

/* What can exist at all, independent of the role */
const creatable = new Set<ResourceKey>(['jobs', 'companies', 'events', 'benefits', 'awards', 'ads', 'content', 'students', 'master_students', 'alumni', 'admins']);
const editable = new Set<ResourceKey>([...content, ...moderation, ...people, ...commerce, 'admins']);
const removable = new Set<ResourceKey>([...content, 'applications', 'network', 'reports', ...people, 'subscriptions', 'payments', 'ads', ...records, 'admins']);

export function can(role: AdminRole | string, action: Action, resource: ResourceKey): boolean {
  const allowed = action === 'create' ? creatable : action === 'edit' ? editable : removable;
  if (!allowed.has(resource)) return false;
  if (resource === 'admins') return role === 'super_admin';
  if (role === 'super_admin' || role === 'manager') return true;
  if (role === 'editor') {
    if (action === 'delete') return false;
    return content.has(resource) || (action === 'edit' && moderation.has(resource));
  }
  if (role === 'reviewer') return action === 'edit' && moderation.has(resource);
  return false;
}

export const roleLabels: Record<AdminRole, string> = {
  super_admin: 'Super Admin',
  manager: 'Menecer',
  editor: 'Redaktor',
  reviewer: 'Yoxlayıcı'
};

export const roleDescriptions: Record<AdminRole, string> = {
  super_admin: 'Bütün bölmələr, əməkdaş hesabları və sistem nəzarəti',
  manager: 'Bütün məzmun, istifadəçilər və ödənişlər; silmə hüququ',
  editor: 'Elan, şirkət, tədbir, güzəşt və məzmun əlavə/redaktə; moderasiya',
  reviewer: 'Hər şeyə baxış; müraciət, şikayət və paylaşım moderasiyası'
};
