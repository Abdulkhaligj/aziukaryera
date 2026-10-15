-- Restore access required by public.is_admin() after notification hardening.
-- Without schema USAGE, admin queries and post-registration hydration fail
-- with "permission denied for schema private" even for valid accounts.

grant usage on schema private to authenticated;
grant execute on function private.is_admin_check() to authenticated;

-- Keep the trigger function server-only.
revoke all on function private.publish_content_notification() from public, anon, authenticated;
