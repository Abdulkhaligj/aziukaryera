-- Helpers referenced by the row-level policies (src/rest/policies.generated.json).
-- They read the per-request session variables the API sets before every query,
-- the MySQL counterpart of Supabase's request.jwt.claims:
--   @auth_uid        auth.uid()            (ascii_bin, NULL for anon)
--   @auth_role       anon | authenticated | service_role
--   @is_admin        1 when public.current_admin_role() is not null
--   @admin_role      public.current_admin_role()
--   @actor_is_staff  private.actor_is_staff()
--   @jwt_admin_role  auth.jwt() -> 'app_metadata' ->> 'admin_role'

DROP FUNCTION IF EXISTS `owns_company`;
CREATE FUNCTION `owns_company`(c_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin) RETURNS TINYINT(1)
  READS SQL DATA
  RETURN EXISTS (SELECT 1 FROM `companies` WHERE `id` = c_id AND `owner_id` = @auth_uid);

DROP FUNCTION IF EXISTS `app_role`;
CREATE FUNCTION `app_role`() RETURNS VARCHAR(32)
  READS SQL DATA
  RETURN (SELECT `role` FROM `profiles` WHERE `id` = @auth_uid);

DROP FUNCTION IF EXISTS `app_account_active`;
CREATE FUNCTION `app_account_active`() RETURNS TINYINT(1)
  READS SQL DATA
  RETURN COALESCE((SELECT `status` = 'active' FROM `profiles` WHERE `id` = @auth_uid), 0);

-- private.admin_can: the staff role matrix (keep in sync with lib/permissions.ts).
DROP FUNCTION IF EXISTS `admin_can`;
CREATE FUNCTION `admin_can`(p_action VARCHAR(16), p_resource VARCHAR(64)) RETURNS TINYINT(1)
  NO SQL
  RETURN CASE
    WHEN @admin_role IS NULL THEN 0
    WHEN p_resource = 'admins' THEN @admin_role = 'super_admin'
    WHEN p_action = 'select' THEN 1
    WHEN p_action = 'insert' AND p_resource NOT IN ('jobs','companies','events','benefits','benefit_partners','company_awards','ads',
      'site_content','content','students','admins','plan_features') THEN 0
    WHEN p_action = 'update' AND p_resource NOT IN ('jobs','companies','events','benefits','benefit_partners','company_awards',
      'site_content','content','applications','posts','reports','mentor_requests','students','subscriptions','plans','plan_features',
      'subscription_usage','payments','ads','company_partnership_requests','company_interview_slots') THEN 0
    WHEN p_action = 'delete' AND p_resource NOT IN ('jobs','companies','events','benefits','benefit_partners','company_awards',
      'site_content','content','applications','posts','reports','students','subscriptions','payments','ads','cv_documents',
      'interview_sessions','ai_usage','notifications') THEN 0
    WHEN @admin_role IN ('super_admin','manager') THEN 1
    WHEN @admin_role = 'editor' THEN p_action <> 'delete' AND (
      p_resource IN ('jobs','companies','events','benefits','benefit_partners','company_awards','site_content','content')
      OR (p_action = 'update' AND p_resource IN ('applications','posts','reports','mentor_requests')))
    ELSE @admin_role = 'reviewer' AND p_action = 'update' AND p_resource IN ('applications','posts','reports','mentor_requests')
  END;

-- private.can_read_profile: self, staff, or a company the student applied to.
DROP FUNCTION IF EXISTS `can_read_profile`;
CREATE FUNCTION `can_read_profile`(p_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin) RETURNS TINYINT(1)
  READS SQL DATA
  RETURN p_id = @auth_uid OR @is_admin = 1 OR EXISTS (
    SELECT 1 FROM `applications` a JOIN `jobs` j ON j.`id` = a.`job_id`
      JOIN `companies` c ON c.`id` = j.`company_id`
      JOIN `profiles` owner ON owner.`id` = c.`owner_id`
      JOIN `profiles` student ON student.`id` = a.`student_id`
     WHERE a.`student_id` = p_id AND c.`owner_id` = @auth_uid AND c.`status` = 'active'
       AND owner.`status` = 'active' AND owner.`role` = 'company'
       AND student.`status` = 'active' AND student.`role` IN ('student','graduate'));
