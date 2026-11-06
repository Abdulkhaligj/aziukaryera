// Triggers on storage.objects (private.avatar_new_generation and
// private.avatar_generation_guard): an avatar path is used once, and a path a
// profile points to cannot be replaced or deleted by its owner.
import { insertOnce, one } from '../../db.ts';
import { DbRuleError } from '../../errors.ts';
import { before } from '../pipeline.ts';

before('storage_objects', 'security_avatar_new_generation', ['insert'], async (env, row) => {
  if (row.bucket_id !== 'avatars') return;
  const claimed = await insertOnce(env.tx, 'INSERT INTO private_avatar_generations (path, object_id) VALUES (?, ?)', [row.name, row.id]);
  if (!claimed) throw new DbRuleError('Avatar generation keys cannot be reused; upload a new random path', '23505');
});

// current_setting('role'): the request role, which SECURITY DEFINER does not change.
before('storage_objects', 'security_avatar_generation', ['update', 'delete'], async (env, _row, old) => {
  if ((env.ctx.role !== 'authenticated' && env.ctx.role !== 'anon') || old!.bucket_id !== 'avatars') return;
  const profile = await one(env.tx, `SELECT id FROM profiles WHERE avatar_path = ? COLLATE utf8mb4_bin OR avatar_pending_path = ? COLLATE utf8mb4_bin
     LIMIT 1 FOR UPDATE`, [old!.name, old!.name]);
  if (profile) throw new DbRuleError('A referenced avatar generation is immutable', '42501');
});
