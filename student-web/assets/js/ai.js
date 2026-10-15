/* ADNSU Career AI client.
 * Model credentials are never exposed in the browser. Requests are sent to the
 * Supabase Edge Function, which can use Gemini or Groq and return a safe,
 * structured response. Every caller keeps a deterministic local fallback.
 */

const CareerAI = {
  async request(task, payload) {
    if (!Backend.init() || !Backend.sb) {
      return { ok: false, fallback: true, error: 'AI xidməti hazırda əlçatan deyil.' };
    }
    try {
      const { data, error } = await Backend.sb.functions.invoke('career-ai', {
        body: { task, payload, locale: 'az' }
      });
      if (error) throw error;
      if (!data || data.ok === false) {
        return { ok: false, fallback: true, error: data?.error || 'AI cavabı alınmadı.' };
      }
      return { ok: true, provider: data.provider, result: data.result };
    } catch (error) {
      return {
        ok: false,
        fallback: true,
        error: Backend.translate(error?.message || 'AI xidməti hazırda əlçatan deyil.')
      };
    }
  },

  cvAnalyze(text, job) {
    return this.request('cv_analyze', { text, job });
  },

  cvRewrite(text, targetRole) {
    return this.request('cv_rewrite', { text, targetRole });
  },

  jobMatch(profile, job, deterministicScore) {
    return this.request('job_match_explain', { profile, job, deterministicScore });
  },

  interviewQuestions(context) {
    return this.request('interview_questions', context);
  },

  interviewEvaluate(context) {
    return this.request('interview_evaluate', context);
  }
};
