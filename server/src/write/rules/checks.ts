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

// Links people click and images the pages load must be web URLs (audit
// 2026-11-12; event images already have events_image_url_https in the
// schema). In Postgres these are NOT VALID checks: existing rows are
// checked the next time they are written, exactly as here. [^[:space:]] is
// glibc's iswspace set (ASCII whitespace and the Unicode space separators
// except the no-break ones).
const WEB = /^https?:\/\/[^\t\n\v\f\r \u{1680}\u{2000}-\u{2006}\u{2008}-\u{200a}\u{2028}\u{2029}\u{205f}\u{3000}]+$/iu;
const HTTPS = /^https:\/\/[^\t\n\v\f\r \u{1680}\u{2000}-\u{2006}\u{2008}-\u{200a}\u{2028}\u{2029}\u{205f}\u{3000}]+$/iu;
const link = (pattern: RegExp, column: string) => (r: Row) => r[column] == null || r[column] === '' || pattern.test(String(r[column]));
check('jobs', 'jobs_application_url_web', link(WEB, 'application_url'));
check('posts', 'posts_link_url_web', link(WEB, 'link_url'));
check('companies', 'companies_website_web', link(WEB, 'website'));
check('companies', 'companies_logo_url_web', link(HTTPS, 'logo_url'));
check('companies', 'companies_cover_url_web', link(HTTPS, 'cover_url'));
check('benefit_partners', 'benefit_partners_website_web', link(WEB, 'website'));
