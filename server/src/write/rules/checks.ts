// CHECK constraints MySQL rejects because their columns carry FK actions
// (schema-followups.md). Same name and message as the Postgres error.
import { DbRuleError } from '../../errors.ts';
import { constraint } from '../pipeline.ts';
import type { Row } from '../../db.ts';

function check(tableName: string, name: string, holds: (row: Row) => boolean) {
  constraint(tableName, name, ['insert', 'update'], (_env, row) => {
    if (!holds(row)) throw new DbRuleError(`new row for relation "${tableName}" violates check constraint "${name}"`, '23514');
  });
}

// NULL operands pass a CHECK, as in SQL.
const differ = (a: unknown, b: unknown) => a == null || b == null || a !== b;
check('connections', 'connections_check', r => differ(r.requester_id, r.addressee_id));
check('messages', 'messages_check', r => differ(r.sender_id, r.recipient_id));
check('follows', 'follows_check', r => [r.followed_profile_id, r.followed_company_id].filter(v => v != null).length === 1);
