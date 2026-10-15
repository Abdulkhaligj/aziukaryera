import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ManagedResource = "students" | "master_students" | "alumni" | "admins";
type AdminAccessRole = "super_admin" | "manager" | "editor" | "reviewer";
type RequestBody = {
  action?: "invite" | "update" | "delete";
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

function resourceIdentity(resource: ManagedResource) {
  if (resource === "master_students") return { role: "student", accountStatus: "master_student" };
  if (resource === "alumni") return { role: "graduate", accountStatus: "alumni" };
  if (resource === "admins") return { role: "admin", accountStatus: "staff" };
  return { role: "student", accountStatus: "student" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = req.headers.get("authorization") || "";
  if (!url || !anonKey || !serviceKey || !authorization) return json({ ok: false, error: "İcazə yoxdur" }, 401);

  const sessionClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await sessionClient.auth.getUser(authorization.replace(/^Bearer\s+/i, ""));
  const actor = authData.user;
  const actorRole = actor?.app_metadata?.admin_role as AdminAccessRole | undefined;
  if (authError || !actor || !actorRole) return json({ ok: false, error: "İcazə yoxdur" }, 401);

  const { data: actorProfile } = await service.from("profiles").select("role,status").eq("id", actor.id).maybeSingle();
  if (actorProfile?.role !== "admin" || actorProfile?.status !== "active") return json({ ok: false, error: "Admin hesabı aktiv deyil" }, 403);

  let body: RequestBody;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Yanlış sorğu" }, 400); }
  const action = body.action;
  const resource = body.resource;
  if (!action || !resource || !["students", "master_students", "alumni", "admins"].includes(resource)) {
    return json({ ok: false, error: "Naməlum əməliyyat" }, 400);
  }
  if (resource === "admins" && actorRole !== "super_admin") return json({ ok: false, error: "Admin hesablarını yalnız Super Admin idarə edə bilər" }, 403);
  if (resource !== "admins" && !["super_admin", "manager"].includes(actorRole)) return json({ ok: false, error: "İcazə yoxdur" }, 403);

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
    const redirectTo = Deno.env.get("PUBLIC_SITE_URL") || "https://asoiu-career.vercel.app/";
    const { data: invited, error: inviteError } = await service.auth.admin.inviteUserByEmail(profileData.email, { data: inviteMetadata, redirectTo });
    if (inviteError || !invited.user) return json({ ok: false, error: inviteError?.message || "Dəvət göndərilmədi" }, 400);

    if (resource === "admins") {
      const { error: authRoleError } = await service.auth.admin.updateUserById(invited.user.id, {
        app_metadata: { ...invited.user.app_metadata, admin_role: profileData.admin_role },
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
    await service.from("admin_audit_logs").insert({ title: `${profileData.full_name} dəvət edildi`, resource, resource_id: invited.user.id, action: "invite", actor_id: actor.id, actor_name: clean(actor.user_metadata?.full_name) || actor.email || "Admin" });
    return json({ ok: true, id: invited.user.id, invited: true }, 201);
  }

  const id = clean(body.id);
  if (!id) return json({ ok: false, error: "İstifadəçi ID-si yoxdur" }, 400);
  if (id === actor.id && action === "delete") return json({ ok: false, error: "Öz admin hesabınızı silə bilməzsiniz" }, 409);

  const { data: target } = await service.from("profiles").select("role,email,full_name").eq("id", id).maybeSingle();
  if (!target) return json({ ok: false, error: "İstifadəçi tapılmadı" }, 404);
  if (target.role === "admin" && actorRole !== "super_admin") return json({ ok: false, error: "Admin hesablarını yalnız Super Admin idarə edə bilər" }, 403);

  if (action === "delete") {
    const { error } = await service.auth.admin.deleteUser(id);
    if (error) return json({ ok: false, error: error.message }, 400);
    await service.from("admin_audit_logs").insert({ title: `${target.full_name || target.email} silindi`, resource, resource_id: null, action: "delete-user", actor_id: actor.id, actor_name: clean(actor.user_metadata?.full_name) || actor.email || "Admin" });
    return json({ ok: true });
  }

  if (action === "update") {
    const { data: targetAuth } = await service.auth.admin.getUserById(id);
    if (!targetAuth.user) return json({ ok: false, error: "Auth istifadəçisi tapılmadı" }, 404);
    const authUpdate: Record<string, unknown> = {
      user_metadata: { ...targetAuth.user.user_metadata, full_name: profileData.full_name },
    };
    if (profileData.email && profileData.email !== targetAuth.user.email) authUpdate.email = profileData.email;
    if (resource === "admins") authUpdate.app_metadata = { ...targetAuth.user.app_metadata, admin_role: profileData.admin_role };
    const { error: authUpdateError } = await service.auth.admin.updateUserById(id, authUpdate as never);
    if (authUpdateError) return json({ ok: false, error: authUpdateError.message }, 400);
    const { error: profileUpdateError } = await service.from("profiles").update({ ...profileData, role: identity.role }).eq("id", id);
    if (profileUpdateError) return json({ ok: false, error: profileUpdateError.message }, 400);
    await service.from("admin_audit_logs").insert({ title: `${profileData.full_name || target.full_name} yeniləndi`, resource, resource_id: id, action: "update-user", actor_id: actor.id, actor_name: clean(actor.user_metadata?.full_name) || actor.email || "Admin" });
    return json({ ok: true });
  }

  return json({ ok: false, error: "Naməlum əməliyyat" }, 400);
});
