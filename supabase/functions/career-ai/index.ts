import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type AIRequest = { task?: string; payload?: Record<string, unknown>; locale?: string };

const schemas: Record<string, string> = {
  cv_analyze: `Return {"summary":string,"strengths":string[],"improvements":string[],"keywords":string[],"rewrites":[{"before":string,"after":string}]}. Analyze the CV for clarity, ATS readability, measurable impact and relevance. Never invent experience.`,
  cv_rewrite: `Return {"summary":string,"improvements":string[],"rewritten_summary":string,"rewritten_bullets":string[]}. Preserve facts and never invent achievements or numbers.`,
  job_match_explain: `Return {"summary":string,"strengths":string[],"improvements":string[],"keywords":string[]}. Explain the deterministic score without changing it. Do not rank people by sensitive traits.`,
  interview_questions: `Return {"questions":[{"question":string,"hint":string,"category":string}]}. Generate the requested number of distinct questions for the candidate's major, role, company and interview type. Mix behavioral and technical questions when requested.`,
  interview_evaluate: `Return {"summary":string,"strengths":string[],"improvements":string[],"sample_answers":string[]}. Give constructive feedback based only on the supplied answers. Do not alter the deterministic score.`,
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function userIdFromJwt(req: Request) {
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch { return null; }
}

function safeJson(text: string) {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(cleaned); } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("AI response was not valid JSON");
  }
}

async function logUsage(req: Request, task: string, provider: string, model: string, input: number, output: number, success: boolean, errorCode?: string) {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return;
  await fetch(`${url}/rest/v1/ai_usage`, {
    method: "POST",
    headers: { apikey: key, authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ profile_id: userIdFromJwt(req), task, provider, model, input_chars: input, output_chars: output, success, error_code: errorCode || null }),
  }).catch(() => undefined);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return response({ ok: false, error: "Method not allowed" }, 405);

  let body: AIRequest;
  try { body = await req.json(); } catch { return response({ ok: false, error: "Invalid JSON" }, 400); }
  const task = String(body.task || "");
  if (!schemas[task]) return response({ ok: false, error: "Unsupported AI task" }, 400);

  const payloadText = JSON.stringify(body.payload || {}).slice(0, 24000);
  const locale = body.locale === "en" ? "English" : "Azerbaijani";
  const prompt = `You are the ADNSU Career Center assistant. Respond only with valid JSON. Language: ${locale}. ${schemas[task]}\nINPUT:\n${payloadText}`;
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  const groqKey = Deno.env.get("GROQ_API_KEY");

  if (!geminiKey && !groqKey) {
    await logUsage(req, task, "none", "none", payloadText.length, 0, false, "not_configured");
    return response({ ok: false, error: "AI provayder açarı hələ konfiqurasiya edilməyib." }, 503);
  }

  let provider = "gemini";
  let model = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";
  try {
    let text = "";
    if (geminiKey) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.25, responseMimeType: "application/json", maxOutputTokens: 2600 },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || "Gemini request failed");
      text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } else {
      provider = "groq";
      model = Deno.env.get("GROQ_MODEL") || "llama-3.3-70b-versatile";
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${groqKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, temperature: 0.25, max_completion_tokens: 2600, response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt }] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || "Groq request failed");
      text = data?.choices?.[0]?.message?.content || "";
    }
    const result = safeJson(text);
    await logUsage(req, task, provider, model, payloadText.length, text.length, true);
    return response({ ok: true, provider, model, result });
  } catch (error) {
    await logUsage(req, task, provider, model, payloadText.length, 0, false, "provider_error");
    return response({ ok: false, error: error instanceof Error ? error.message : "AI request failed" }, 502);
  }
});
