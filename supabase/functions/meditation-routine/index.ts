// Generate a short analytical-meditation routine (≤6 steps) for a theme / situation.
// Used by the "Guide me" button on the Analytical meditation item.
// Requires a valid Supabase auth JWT (default). Shares the OPENAI_API_KEY secret.
//
// Deploy:  supabase functions deploy meditation-routine

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const SCHEMA = {
  type: "object",
  properties: {
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: { text: { type: "string" }, seconds: { type: "integer" } },
        required: ["text", "seconds"],
        additionalProperties: false,
      },
    },
    note: { type: "string" },
  },
  required: ["steps", "note"],
  additionalProperties: false,
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const { theme, situation, context } = await req.json();
    const key = Deno.env.get("OPENAI_API_KEY");
    if (!key) return json({ error: "OPENAI_API_KEY not configured" }, 500);

    const system = [
      "You are a guide for ANALYTICAL MEDITATION — a short reflective practice for emotional regulation (Buddhist-style, but plain and non-preachy).",
      "Given the person's standing context, a theme, and an optional specific situation, produce a routine of 5–6 steps they follow in their own mind, in order.",
      "Ground the steps in this arc: bring up a concrete but mild example; notice where the feeling sits in the body; ask what you're actually wanting underneath; consider the other side's view; see that you can be okay even if it doesn't change; practise letting the feeling be there without acting on it; close with a breath or a resolve.",
      "Use the standing context to make it personal (e.g. if they're going through a breakup, speak to that), but don't be heavy-handed.",
      "Each step: ONE short, concrete, second-person instruction (e.g. \"Bring the moment to mind and let yourself feel the sting.\"). Warm, calm, specific. No numbering, no preamble.",
      "Give each step a `seconds` duration to sit with it — usually 30–120s, longer for the deeper middle steps — so the whole session runs about 4–7 minutes.",
      "Also return `note`: a concise first-person distillation of the situation the person gave, in their own voice, for their journal's 'what came up' field (e.g. \"Sad about Bell leaving this evening — noticing how much I'm clinging.\"). 1–2 sentences. If no situation was given, return an empty string.",
      "Return ONLY JSON matching the schema.",
    ].join("\n");

    const user = `Standing context: ${context || "(none given)"}\nTheme: ${theme || "(none given)"}\nSituation: ${situation || "(none given)"}`;

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.6,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        response_format: { type: "json_schema", json_schema: { name: "routine", strict: true, schema: SCHEMA } },
      }),
    });
    const data = await r.json();
    if (!r.ok) return json({ error: data?.error?.message || "OpenAI request failed" }, 502);
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");
    const steps = (parsed.steps || [])
      .map((s: any) => ({ text: String(s.text || "").trim(), seconds: Math.max(15, Math.min(300, Number(s.seconds) || 60)) }))
      .filter((s: any) => s.text)
      .slice(0, 6);
    return json({ steps, note: String(parsed.note || "").trim() }, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
