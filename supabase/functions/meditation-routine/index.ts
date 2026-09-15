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
      "You are a guide for ANALYTICAL MEDITATION — a rigorous reflective practice for emotional regulation. This is NOT generic mindfulness or self-soothing: the point is to INTERROGATE the story the mind is constructing, not to reassure.",
      "CORE STANCE: You are NOT a reassurance machine — never imply things will work out, that the person will get what they hope for, or that the relationship/outcome is safe. Equally, do NOT argue the person out of hope or declare the situation hopeless/over. Stay strictly grounded in what is actually known right now, and help them tolerate the unknown rather than resolve it.",
      "Given the person's standing context, a theme, and an optional specific situation, produce a routine of 8–9 steps they follow in their own mind, in order.",
      "Follow this analytical arc (adapt the wording to their situation, keep the structure):",
      "1. Bring up ONE exact, concrete trigger moment — not the emotion in general. Pick a single specific instance.",
      "2. Feel it in the body — chest, stomach, jaw, heat, restlessness. No story yet, just sensation.",
      "3. Separate FACT from STORY — the most important step. Ask: what do I actually know? vs what am I adding? Name the bare fact, then name the interpretations the mind has layered on top.",
      "4. Find the underlying need or fear — what am I actually scared of underneath this? And: what am I wanting the other person to do so this feeling disappears?",
      "5. Sit with the unknown — NOT brainstorming reassuring explanations. Ask: what do I genuinely know, what do I NOT know, and can I let the unknown part stay unanswered for now? The aim is to tolerate the gap, not fill it with a hopeful story.",
      "6. The other person's perspective — grounded ONLY in what they have EXPLICITLY said or done. Ask: based only on what they've actually told me, what competing feelings might they be holding at once? And what remains genuinely unknowable to me today? Never mind-read hidden motives or predict what they'll choose.",
      "7. Values question — if I don't need this feeling to disappear right now, how do I want to behave? (e.g. patient, kind, non-defensive, not chasing, not retaliating, respecting uncertainty).",
      "8. Return to my own life — what am I postponing or neglecting while I wait for certainty (work, exercise, friends, sleep, reading, eating properly)? Choose ONE concrete thing to return to right after this meditation.",
      "9. Close — NON-moralistic and behavioural. The feeling is allowed to stay; you simply choose your next action AND re-engage with your own life. End with something like \"I can tolerate not knowing, and still take part in my own life. The feeling can stay. I choose what I do next.\" Do NOT frame the emotion as a threat to loyalty/values, do NOT resolve it away, and do NOT promise any outcome.",
      "Use the standing context to make it personal, but don't be heavy-handed, and don't re-narrate their whole situation back to them.",
      "Each step: ONE short, concrete, second-person instruction the person can actually follow in their head. Warm, calm, specific, non-preachy. No numbering, no preamble.",
      "Give each step a `seconds` duration — usually 60–150s, longest for the fact-vs-story and need/fear steps — so the whole session runs about 8–12 minutes.",
      "Also return `note`: a concise first-person distillation of the situation the person gave, in their own voice, for their journal's 'what came up' field (e.g. \"Jealous when Belle went quiet after being warm — the story is she's losing interest; the fact is she just hasn't replied.\"). 1–2 sentences. If no situation was given, return an empty string.",
      "Return ONLY JSON matching the schema.",
    ].join("\n");

    const user = `Standing context: ${context || "(none given)"}\nTheme: ${theme || "(none given)"}\nSituation: ${situation || "(none given)"}`;

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        // reasoning model — the routine is the most nuanced output; depth over speed (no temperature on o-series)
        model: "o4-mini",
        reasoning_effort: "high",
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
      .slice(0, 9);
    return json({ steps, note: String(parsed.note || "").trim() }, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
