// Summarise a window of journal entries into wins / struggles / patterns / a suggestion.
// The client sends a compact text digest of the last N days; this returns structured insight.
// Requires a valid Supabase auth JWT (default). Shares the OPENAI_API_KEY secret.
//
// Deploy:  supabase functions deploy summarise

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
    overview: { type: "string" },
    went_well: { type: "array", items: { type: "string" } },
    struggled: { type: "array", items: { type: "string" } },
    patterns: { type: "array", items: { type: "string" } },
    suggestion: { type: "string" },
  },
  required: ["overview", "went_well", "struggled", "patterns", "suggestion"],
  additionalProperties: false,
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const { rangeLabel, digest } = await req.json();
    if (!digest || !String(digest).trim()) return json({ error: "no entries to summarise" }, 400);
    const key = Deno.env.get("OPENAI_API_KEY");
    if (!key) return json({ error: "OPENAI_API_KEY not configured" }, 500);

    const system = [
      "You are reviewing someone's daily emotional-regulation / meditation journal (an analytical + concentration meditation practice, catching '3/10' moments, evening review with Regret/Remedy/Resolve/Rejoice, reading, sleep).",
      `Summarise honestly and supportively across ${rangeLabel || "this period"}.`,
      "Reference their ACTUAL entries — be concrete, not generic. Second person, warm, plain.",
      "went_well / struggled / patterns: 2–4 short bullet points each (patterns = recurring triggers, themes, or habits you notice, e.g. links between sleep and mood, or a repeated trigger).",
      "suggestion: ONE concrete, kind thing to try next.",
      "If there's little data, say so briefly rather than inventing.",
      "Return ONLY JSON matching the schema.",
    ].join("\n");

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.4,
        messages: [{ role: "system", content: system }, { role: "user", content: String(digest) }],
        response_format: { type: "json_schema", json_schema: { name: "summary", strict: true, schema: SCHEMA } },
      }),
    });
    const data = await r.json();
    if (!r.ok) return json({ error: data?.error?.message || "OpenAI request failed" }, 502);
    return json({ result: JSON.parse(data.choices?.[0]?.message?.content || "{}") }, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
