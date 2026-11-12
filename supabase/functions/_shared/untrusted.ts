// Text written by users reaches the AI models only as data (prompt injection).
// Three layers, used together by the AI functions:
//  1. The rules go to the model as its system instruction; user text never
//     shares a message with them.
//  2. User text is fenced in a tag with a random id. The author cannot guess
//     the id, so the text cannot close the block and continue as instructions.
//  3. Phrases that try to override the model's rules, or that write the very
//     field the model is asked to decide, are caught before the model sees them.

export function fence(label: string, text: string) {
  const tag = `${label}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  return { tag, block: `<${tag}>\n${text}\n</${tag}>` };
}

const OVERRIDE: RegExp[] = [
  // "ignore all previous instructions", "disregard the above rules", "forget your instructions"
  /\b(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+)?(?:of\s+)?(?:the\s+|your\s+|my\s+)?(?:previous|prior|above|earlier|preceding|system|original)\s+(?:\w+\s+)?(?:instructions?|prompts?|rules|messages?)\b/iu,
  /\b(?:ignore|disregard|forget)\s+(?:your|these|those)\s+(?:instructions?|prompts?)\b/iu,
  /\b(?:ignore|disregard)\s+(?:everything|all)\s+(?:above|before|previously)\b/iu,
  /\bnew\s+(?:system\s+)?instructions?\s*:/iu,
  // Fake role or instruction tags
  /<\/?\s*(?:system|instructions?|prompt|assistant)\s*>/iu,
  // The fields the models decide: moderation verdict and candidate score
  /["']\s*(?:verdict|ai_score)\s*["']\s*:/iu,
  // Azerbaijani: "əvvəlki təlimatları unut", "bütün qaydaları nəzərə alma"
  /(?:əvvəlki|öncəki|yuxarıdakı|bütün)\s+(?:\p{L}+\s+)?(?:təlimat|göstəriş|qayda)\p{L}*\s+(?:\p{L}+\s+)?(?:unut(?:un)?|nəzərə\s+alma(?:yın)?|ignor\s+et(?:in)?|məhəl\s+qoyma(?:yın)?)(?!\p{L})/iu,
  // Turkish: "önceki talimatları unut", "tüm kuralları yok say"
  /(?:önceki|yukarıdaki|tüm|bütün)\s+(?:\p{L}+\s+)?(?:talimat|kural|komut)\p{L}*\s+(?:\p{L}+\s+)?(?:unut(?:un)?|yok\s+say(?:ın)?|görmezden\s+gel(?:in)?)(?!\p{L})/iu,
  // Russian: "игнорируй все предыдущие инструкции", "забудь правила"
  /(?:игнорируй|проигнорируй|забудь|не\s+обращай\s+внимания\s+на)\s+(?:\p{L}+\s+){0,3}(?:инструкци|указани|промпт|правил)\p{L}*/iu,
];

// Hidden characters and look-alike letters do not hide a phrase.
function normalize(text: string) {
  return text.normalize("NFKC").replace(/[\u{00AD}\u{200B}-\u{200D}\u{2060}\u{FEFF}]/gu, "").replace(/\s+/g, " ");
}

export function looksLikeInjection(text: string): boolean {
  const flat = normalize(text);
  return OVERRIDE.some((pattern) => pattern.test(flat));
}
