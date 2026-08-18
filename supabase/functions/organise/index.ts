// Supabase Edge Function: turn a spoken/typed daily brain-dump into structured journal
// fields via OpenAI. Keeps your OpenAI key server-side (set as a function secret).
// The client sends the JSON schema + field guide, so app.js stays the single source of truth.
//
// Deploy:  supabase functions deploy organise
// Secret:  supabase secrets set OPENAI_API_KEY=sk-...
//
// Requires a valid Supabase auth JWT (default) — only signed-in users can call it.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const { transcript, schema, guide, dateLabel } = await req.json();
    if (!transcript || !schema) return json({ error: "missing transcript or schema" }, 400);

    const key = Deno.env.get("OPENAI_API_KEY");
    if (!key) return json({ error: "OPENAI_API_KEY not configured on the function" }, 500);

    const system = [
      "You convert a person's spoken daily meditation/reflection journal into structured fields.",
      dateLabel ? `The entry is for: ${dateLabel}.` : "",
      "Rules:",
      "- Only fill a field if the person clearly refers to it. Otherwise use null.",
      "- Do NOT invent content. Booleans: true only if they clearly did the thing; else null.",
      "- For text fields, use the person's own words, lightly cleaned up. Keep it first-person.",
      "- For list fields (3/10s, pauses), write each entry as a COMPLETE sentence including the situation, the feeling (including body sensations), and the underlying want — never a single word.",
      "- Capture body sensations and what they were wanting in the most relevant field.",
      "- Return ONLY JSON matching the provided schema.",
      "",
      "Fields:",
      guide || "",
    ].join("\n");

    const body = {
      model: "gpt-4o",
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: String(transcript) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "daily_journal", strict: true, schema },
      },
    };

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) return json({ error: data?.error?.message || "OpenAI request failed" }, 502);

    const content = data?.choices?.[0]?.message?.content || "{}";
    return json({ result: JSON.parse(content) }, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
