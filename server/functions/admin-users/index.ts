import { readLimitedJson } from "../_shared/limits.ts";
import { createClient } from "../_shared/client.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ManagedResource = "students" | "master_students" | "alumni" | "admins";
type AdminAccessRole = "super_admin" | "manager" | "editor" | "reviewer";
type RequestBody = {
  action?: "invite" | "create" | "update" | "delete" | "reset_password" | "change_password";
  password?: string;
  current_password?: string;
  resource?: ManagedResource;
  id?: string;
  full_name?: string;
  email?: string;
  personal_email?: string;
  phone?: string;
  city?: string;
  faculty_id?: string;
  major_id?: string;
  course?: number | string;
  gpa?: number | string;
  status?: "pending" | "active" | "rejected";
  alumni_verified?: boolean | string;
  admin_role?: AdminAccessRole;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalNumber(value: unknown) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/* Müvəqqəti şifrə: 12 simvol, oxunaqlı (0/O, 1/l yoxdur), hərf və rəqəm mütləq var. */
function tempPassword() {
  const letters = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const all = letters + digits;
  const bytes = crypto.getRandomValues(new Uint32Array(12));
  const chars = Array.from(bytes, (b) => all[b % all.length]);
  chars[0] = letters[bytes[0] % letters.length];
  chars[11] = digits[bytes[11] % digits.length];
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8).join("")}`;
}

function resourceIdentity(resource: ManagedResource) {
  if (resource === "master_students") return { role: "student", accountStatus: "master_student" };
  if (resource === "alumni") return { role: "graduate", accountStatus: "alumni" };
  if (resource === "admins") return { role: "admin", accountStatus: "staff" };
  return { role: "student", accountStatus: "student" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const url = Deno.env.get("API_URL");
  const anonKey = Deno.env.get("ANON_KEY");
  const serviceKey = Deno.env.get("SERVICE_ROLE_KEY");
  const authorization = req.headers.get("authorization") || "";
  if (!url || !anonKey || !serviceKey || !authorization) return json({ ok: false, error: "İcazə yoxdur" }, 401);

  const sessionClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await sessionClient.auth.getUser(authorization.replace(/^Bearer\s+/i, ""));
  const actor = authData.user;
  const actorRole = actor?.app_metadata?.admin_role as AdminAccessRole | undefined;
  if (authError || !actor || !actorRole) return json({ ok: false, error: "İcazə yoxdur" }, 401);

  const { data: actorProfile } = await service.from("profiles").select("role,status,admin_role").eq("id", actor.id).maybeSingle();
  if (actorProfile?.role !== "admin" || actorProfile?.status !== "active" || actorProfile?.admin_role !== actorRole || !["super_admin", "manager", "editor", "reviewer"].includes(actorRole)) return json({ ok: false, error: "Admin hesabı aktiv deyil" }, 403);

  let body: RequestBody;
  try { body = await readLimitedJson(req); } catch { return json({ ok: false, error: "Yanlış sorğu" }, 400); }
  const action = body.action;
  const resource = body.resource;

  // Durable intent precedes Auth mutations, which cannot share a transaction
  // with the database audit. Never record passwords or raw request bodies.
  async function audit(actionName: string, resourceName: string, targetId: string | null, title: string) {
    const { error } = await service.from("admin_audit_logs").insert({ title, resource: resourceName, resource_id: targetId,
      action: actionName, actor_id: actor!.id, actor_name: clean(actor!.user_metadata?.full_name) || actor!.email || "Admin" });
    return !error;
  }
  if (action === "change_password") {
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < 10 || password.length > 128 || !/[A-Za-zƏəÇçĞğIıİiÖöŞşÜü]/.test(password) || !/\d/.test(password))
      return json({ ok: false, error: "Şifrə 10–128 simvol, hərf və rəqəm olmalıdır." }, 400);
    if (!await audit("change-password-intent", "admins", actor.id, "Şifrə dəyişikliyi başladıldı"))
      return json({ ok: false, error: "Audit qeydi saxlanmadı; əməliyyat dayandırıldı." }, 503);
    // This client only has a bearer header, not an SDK refresh-token session.
    // Use the authenticated user endpoint (never Admin updateUserById(password))
    // so Auth applies the normal same-password and session security checks.
    try {
      const changed = await fetch(`${url}/auth/v1/user`, {
        method: "PUT", headers: { Authorization: authorization, apikey: anonKey, "Content-Type": "application/json" },
        // The API checks the current password itself (audit 2026-11-13, #14).
        body: JSON.stringify({ password, current_password: typeof body.current_password === "string" ? body.current_password : "" }),
        signal: AbortSignal.timeout(12500), redirect: "error",
      });
      const changedUser = await readLimitedJson(changed, 131072);
      if (changed.status === 400 && changedUser?.error_code === "invalid_credentials") return json({ ok: false, error: "Cari şifrə yanlışdır." }, 400);
      if (!changed.ok || changedUser?.id !== actor.id) return json({ ok: false, error: "Şifrə dəyişmədi; fərqli yeni şifrə seçin." }, 400);
    } catch {
      return json({ ok: false, error: "Şifrə dəyişikliyi təsdiqlənmədi; yenidən cəhd edin." }, 503);
    }
    const { error: metadataError } = await service.auth.admin.updateUserById(actor.id, {
      app_metadata: { must_change_password: false },
    });
    if (metadataError) return json({ ok: false, error: "Şifrə yeniləndi, giriş tələbi götürülmədi. Yenidən cəhd edin." }, 503);
    if (!await audit("change-password", "admins", actor.id, "Şifrə dəyişdirildi"))
      return json({ ok: false, error: "Şifrə yeniləndi, yekun audit qeydi saxlanmadı." }, 503);
    return json({ ok: true });
  }
  if (actor.app_metadata?.must_change_password === true) return json({ ok: false, error: "Əvvəlcə şifrənizi dəyişin." }, 403);
  if (!action || !resource || !["students", "master_students", "alumni", "admins"].includes(resource)) {
    return json({ ok: false, error: "Naməlum əməliyyat" }, 400);
  }
  if (resource === "admins" && actorRole !== "super_admin") return json({ ok: false, error: "Admin hesablarını yalnız Super Admin idarə edə bilər" }, 403);
  if (resource !== "admins" && !["super_admin", "manager"].includes(actorRole)) return json({ ok: false, error: "İcazə yoxdur" }, 403);

  if (!["create", "invite", "update", "delete", "reset_password"].includes(action)) return json({ ok: false, error: "Naməlum əməliyyat" }, 400);
  if (!await audit(`${action}-intent`, resource, null, "İnzibati hesab əməliyyatı başladıldı"))
    return json({ ok: false, error: "Audit qeydi saxlanmadı; əməliyyat dayandırıldı." }, 503);

  const identity = resourceIdentity(resource);
  const profileData = {
    full_name: clean(body.full_name),
    email: clean(body.email).toLowerCase(),
    personal_email: clean(body.personal_email) || null,
    phone: clean(body.phone),
    city: clean(body.city) || "Bakı, Azərbaycan",
    faculty_id: clean(body.faculty_id) || null,
    major_id: clean(body.major_id) || null,
    course: optionalNumber(body.course),
    gpa: optionalNumber(body.gpa),
    status: clean(body.status) || "active",
    account_status: identity.accountStatus,
    alumni_verified: body.alumni_verified === true || body.alumni_verified === "true",
    admin_role: resource === "admins" ? (body.admin_role || "reviewer") : null,
  };

  if (action === "create") {
    if (!profileData.full_name || !profileData.email) return json({ ok: false, error: "Ad və e-poçt məcburidir" }, 400);
    if (resource === "admins") {
      const { count } = await service.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin").eq("status", "active");
      if ((count || 0) >= 5) return json({ ok: false, error: "Admin giriş limiti dolub (maksimum 5 aktiv hesab)" }, 409);
    }
    const password = tempPassword();
    const { data: created, error: createError } = await service.auth.admin.createUser({
      email: profileData.email,
      password,
      email_confirm: true,
      user_metadata: {
        role: resource === "alumni" || resource === "admins" ? "alumni" : "student",
        account_status: resource === "master_students" ? "master_student" : resource === "alumni" || resource === "admins" ? "alumni" : "student",
        full_name: profileData.full_name,
      },
      app_metadata: resource === "admins" ? { admin_role: profileData.admin_role, must_change_password: true } : {},
    });
    if (createError || !created.user) {
      const message = createError?.message || "Hesab yaradılmadı";
      return json({ ok: false, error: /already|registered|exists/i.test(message) ? "Bu e-poçt ilə hesab artıq var" : message }, 400);
    }
    const { error: profileError } = await service.from("profiles").update({ ...profileData, role: identity.role }).eq("id", created.user.id);
    if (profileError) {
      await service.auth.admin.deleteUser(created.user.id);
      return json({ ok: false, error: profileError.message }, 400);
    }
    if ((await service.from("admin_audit_logs").insert({ title: `${profileData.full_name} hesabı yaradıldı`, resource, resource_id: created.user.id, action: "create-user", actor_id: actor.id, actor_name: clean(actor.user_metadata?.full_name) || actor.email || "Admin" })).error) return json({ ok: false, error: "Əməliyyat icra edildi, yekun audit qeydi saxlanmadı." }, 503);
    /* Şifrə yalnız bu cavabda bir dəfə qaytarılır, heç yerdə saxlanmır. */
    return json({ ok: true, id: created.user.id, email: profileData.email, temporaryPassword: password }, 201);
  }

  if (action === "invite") {
    if (!profileData.full_name || !profileData.email) return json({ ok: false, error: "Ad və e-poçt məcburidir" }, 400);
    if (resource === "admins") {
      const { count } = await service.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin").eq("status", "active");
      if ((count || 0) >= 5) return json({ ok: false, error: "Admin giriş limiti dolub (maksimum 5 aktiv hesab)" }, 409);
    }

    const inviteMetadata = {
      role: resource === "alumni" || resource === "admins" ? "alumni" : "student",
      account_status: resource === "master_students" ? "master_student" : resource === "alumni" || resource === "admins" ? "alumni" : "student",
      full_name: profileData.full_name,
    };
    const redirectTo = Deno.env.get("PUBLIC_SITE_URL");
    if (!redirectTo || !/^https:\/\//i.test(redirectTo)) return json({ ok: false, error: "PUBLIC_SITE_URL konfiqurasiya olunmayıb." }, 503);
    const { data: invited, error: inviteError } = await service.auth.admin.inviteUserByEmail(profileData.email, { data: inviteMetadata, redirectTo });
    if (inviteError || !invited.user) return json({ ok: false, error: inviteError?.message || "Dəvət göndərilmədi" }, 400);

    if (resource === "admins") {
      const { error: authRoleError } = await service.auth.admin.updateUserById(invited.user.id, {
        app_metadata: { admin_role: profileData.admin_role },
      });
      if (authRoleError) {
        await service.auth.admin.deleteUser(invited.user.id);
        return json({ ok: false, error: authRoleError.message }, 400);
      }
    }

    const { error: profileError } = await service.from("profiles").update({ ...profileData, role: identity.role }).eq("id", invited.user.id);
    if (profileError) {
      await service.auth.admin.deleteUser(invited.user.id);
      return json({ ok: false, error: profileError.message }, 400);
    }
    if ((await service.from("admin_audit_logs").insert({ title: `${profileData.full_name} dəvət edildi`, resource, resource_id: invited.user.id, action: "invite", actor_id: actor.id, actor_name: clean(actor.user_metadata?.full_name) || actor.email || "Admin" })).error) return json({ ok: false, error: "Əməliyyat icra edildi, yekun audit qeydi saxlanmadı." }, 503);
    return json({ ok: true, id: invited.user.id, invited: true }, 201);
  }

  const id = clean(body.id);
  if (!id) return json({ ok: false, error: "İstifadəçi ID-si yoxdur" }, 400);
  if (id === actor.id && action === "delete") return json({ ok: false, error: "Öz admin hesabınızı silə bilməzsiniz" }, 409);

  const { data: target } = await service.from("profiles").select("role,email,full_name,status,admin_role").eq("id", id).maybeSingle();
  if (!target) return json({ ok: false, error: "İstifadəçi tapılmadı" }, 404);
  // The account must belong to the section the request comes from: a company
  // account (or any other role) cannot be reset, edited or converted from here.
  if (target.role !== identity.role) return json({ ok: false, error: "Bu hesab bu bölmədə idarə olunmur" }, 403);
  if (target.role === "admin" && actorRole !== "super_admin") return json({ ok: false, error: "Admin hesablarını yalnız Super Admin idarə edə bilər" }, 403);

  // Only the fields the request sends are changed.
  const has = (key: keyof RequestBody) => Object.hasOwn(body, key);
  const demotes = has("admin_role") && body.admin_role !== target.admin_role;
  const blocks = has("status") && clean(body.status) !== "active";

  if (id === actor.id && action === "update" && (demotes || blocks)) {
    return json({ ok: false, error: "Öz rolunuzu və ya statusunuzu dəyişə bilməzsiniz" }, 409);
  }
  // The last active super admin cannot be demoted, blocked or deleted.
  if (target.admin_role === "super_admin" && target.status === "active" && (action === "delete" || (action === "update" && (demotes || blocks)))) {
    const { count } = await service.from("profiles").select("id", { count: "exact", head: true })
      .eq("role", "admin").eq("status", "active").eq("admin_role", "super_admin").neq("id", id);
    if (!count) return json({ ok: false, error: "Sonuncu aktiv Super Admin hesabı dəyişdirilə və ya silinə bilməz" }, 409);
  }

  if (action === "reset_password") {
    const { data: targetAuth } = await service.auth.admin.getUserById(id);
    if (!targetAuth.user) return json({ ok: false, error: "Auth istifadəçisi tapılmadı" }, 404);
    const password = tempPassword();
    // #32: every reset password is temporary: the next sign-in asks for a new
    // one, the person's sessions end, and they are told the password was reset.
    const { error } = await service.auth.admin.updateUserById(id, {
      password,
      app_metadata: { must_change_password: true },
    });
    if (error) return json({ ok: false, error: error.message }, 400);
    await service.from("notifications").insert({ profile_id: id, kind: "password_reset", title: "Şifrəniz sıfırlandı",
      body: "Karyera Mərkəzi hesabınız üçün müvəqqəti şifrə təyin etdi. Növbəti girişdə yeni şifrə qurun. Bunu siz istəməmisinizsə, Karyera Mərkəzinə yazın.", link: "profile" });
    if ((await service.from("admin_audit_logs").insert({ title: `${target.full_name || target.email} üçün şifrə sıfırlandı`, resource, resource_id: id, action: "reset-password", actor_id: actor.id, actor_name: clean(actor.user_metadata?.full_name) || actor.email || "Admin" })).error) return json({ ok: false, error: "Əməliyyat icra edildi, yekun audit qeydi saxlanmadı." }, 503);
    return json({ ok: true, email: target.email, temporaryPassword: password });
  }

  if (action === "delete") {
    const { error } = await service.auth.admin.deleteUser(id);
    if (error) return json({ ok: false, error: error.message }, 400);
    if ((await service.from("admin_audit_logs").insert({ title: `${target.full_name || target.email} silindi`, resource, resource_id: null, action: "delete-user", actor_id: actor.id, actor_name: clean(actor.user_metadata?.full_name) || actor.email || "Admin" })).error) return json({ ok: false, error: "Əməliyyat icra edildi, yekun audit qeydi saxlanmadı." }, 503);
    return json({ ok: true });
  }

  if (action === "update") {
    const patch: Record<string, unknown> = { account_status: identity.accountStatus };
    if (has("full_name")) patch.full_name = profileData.full_name;
    if (has("email") && profileData.email) patch.email = profileData.email;
    if (has("personal_email")) patch.personal_email = profileData.personal_email;
    if (has("phone")) patch.phone = profileData.phone;
    if (has("city")) patch.city = profileData.city;
    if (has("faculty_id")) patch.faculty_id = profileData.faculty_id;
    if (has("major_id")) patch.major_id = profileData.major_id;
    if (has("course")) patch.course = profileData.course;
    if (has("gpa")) patch.gpa = profileData.gpa;
    if (has("status")) patch.status = profileData.status;
    if (has("alumni_verified")) patch.alumni_verified = profileData.alumni_verified;
    if (resource === "admins" && has("admin_role")) patch.admin_role = profileData.admin_role;

    const { data: targetAuth } = await service.auth.admin.getUserById(id);
    if (!targetAuth.user) return json({ ok: false, error: "Auth istifadəçisi tapılmadı" }, 404);
    const authUpdate: Record<string, unknown> = {};
    if (has("full_name") && profileData.full_name) authUpdate.user_metadata = { ...targetAuth.user.user_metadata, full_name: profileData.full_name };
    if (patch.email && patch.email !== targetAuth.user.email) authUpdate.email = patch.email;
    if (resource === "admins" && has("admin_role")) authUpdate.app_metadata = { admin_role: profileData.admin_role };
    if (Object.keys(authUpdate).length) {
      const { error: authUpdateError } = await service.auth.admin.updateUserById(id, authUpdate as never);
      if (authUpdateError) return json({ ok: false, error: authUpdateError.message }, 400);
    }
    const { error: profileUpdateError } = await service.from("profiles").update(patch).eq("id", id);
    if (profileUpdateError) return json({ ok: false, error: profileUpdateError.message }, 400);
    if ((await service.from("admin_audit_logs").insert({ title: `${(patch.full_name as string) || target.full_name} yeniləndi`, resource, resource_id: id, action: "update-user", actor_id: actor.id, actor_name: clean(actor.user_metadata?.full_name) || actor.email || "Admin" })).error) return json({ ok: false, error: "Əməliyyat icra edildi, yekun audit qeydi saxlanmadı." }, 503);
    return json({ ok: true });
  }

  return json({ ok: false, error: "Naməlum əməliyyat" }, 400);
});
