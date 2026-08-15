// Supabase Edge Function: transcribe an uploaded audio blob via OpenAI Whisper.
// Used by the offline voice-note flow — the browser records audio (works with no signal),
// stores it locally, and posts it here on reconnect to get text back, which then goes to
// the `organise` function. Shares the project's OPENAI_API_KEY secret.
//
// Deploy:  supabase functions deploy transcribe
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
    const key = Deno.env.get("OPENAI_API_KEY");
    if (!key) return json({ error: "OPENAI_API_KEY not configured on the function" }, 500);

    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) return json({ error: "no audio file" }, 400);

    const oa = new FormData();
    oa.append("file", file, file.name || "audio.webm");
    oa.append("model", "whisper-1");
    oa.append("response_format", "json");

    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: oa,
    });
    const data = await r.json();
    if (!r.ok) return json({ error: data?.error?.message || "transcription failed" }, 502);

    return json({ text: data.text || "" }, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
