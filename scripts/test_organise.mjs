// Local validation of the OpenAI "organise" path — no Supabase needed.
// Mirrors what supabase/functions/organise/index.ts does, using the same schema shape
// buildAiSpec() produces in app.js. Reads OPENAI_API_KEY from ../.env.
//
// Run:  node scripts/test_organise.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, "..", ".env");
let key = process.env.OPENAI_API_KEY;
try {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*OPENAI_API_KEY\s*=\s*(.+?)\s*$/);
    if (m) key = m[1].replace(/^["']|["']$/g, "");
  }
} catch (_) { /* fall back to process env */ }
if (!key) { console.error("No OPENAI_API_KEY found in .env or environment."); process.exit(1); }

const THEMES = ["Anger", "Being misunderstood", "Unfairness", "Rejection", "Attachment", "Accepting “no”"];
const bool = { type: ["boolean", "null"] };
const str = { type: ["string", "null"] };
const arr = { type: ["array", "null"], items: { type: "string" } };

// Same field set as app.js buildAiSpec()
const properties = {
  concentration: bool,
  analytical: bool,
  analytical_theme: { type: ["string", "null"], enum: [...THEMES, null] },
  analytical_note: str,
  catch_310: arr,
  one_pause: arr,
  review: bool,
  review_triggered: str, review_felt: str, review_did: str, review_diff: str, review_well: str,
  power_regret: bool, power_remedy: bool, power_resolve: bool, power_rejoice: bool, powers_note: str,
  shantideva: bool, shantideva_note: str,
  before_bed: bool,
};
const schema = { type: "object", properties, required: Object.keys(properties), additionalProperties: false };

const guide = `
concentration/analytical/review/shantideva/before_bed (boolean): did they do it? null if not mentioned.
power_regret/power_remedy/power_resolve/power_rejoice (boolean): did they express that Opponent Power?
analytical_theme: one of ${THEMES.join(", ")}, or null.
analytical_note (string): what came up in the analytical meditation — body sensations noticed AND what they realised they were wanting. e.g. "Tightness in my chest; I realised I wanted to be seen as competent."
catch_310 (array of strings): each distinct 3/10 (irritation/fear/defensiveness/anger) they caught. Each entry ONE full first-person sentence: the situation + what they felt (incl. in the body) + what they were wanting. e.g. "Someone cut me off in traffic — flash of anger, I wanted respect."
one_pause (array of strings): each time they resisted an urge to act. Each entry a full first-person sentence: the urge + what they did instead. e.g. "Wanted to fire back on a Slack thread, but I let it sit and went for a walk."
review_triggered/review_felt/review_did/review_diff/review_well (string): the five evening-review answers, in their own words.
powers_note/shantideva_note (string): any extra reflection. null if not mentioned.`.trim();

const transcript = `Alright so this morning I did my ten minute concentration meditation on the breath, that went okay.
Then the analytical meditation — my theme was being misunderstood. I noticed this tightness in my chest and I realised I just wanted to be seen as competent.
During the day I caught a couple of 3 out of 10s. One was when someone cut me off in traffic, I felt a flash of anger and I wanted respect. Another one, a slack message annoyed me and I felt defensive, I wanted to be right.
I managed one pause — I had the urge to fire back a reply on that slack thread but I didn't, I let it sit and went for a walk instead.
Evening review: what triggered me was the slack thing. I felt defensive and a bit small. What I did was pause and not react. Next time I'd like to breathe before reading it fully. I handled the traffic one well actually, I let it go quickly.
On the four opponent powers — I regret snapping internally, the remedy is remembering it's not about me, I resolve to pause before replying, and I rejoice that I actually managed the pause today.
I didn't get to Shantideva today. And before bed, just, regret the behaviour not myself.`;

const body = {
  model: "gpt-4o-mini",
  temperature: 0.2,
  messages: [
    { role: "system", content: "You convert a spoken daily meditation/reflection journal into structured fields. Only fill a field if clearly referenced; else null. Don't invent. Use the person's own words, first-person, lightly cleaned up. For list fields (3/10s, pauses) write each entry as a COMPLETE sentence including the situation, the feeling (including body sensations), and the underlying want — never a single word. Capture body sensations and what they were wanting in the most relevant note field. Return ONLY JSON matching the schema.\n\nFields:\n" + guide },
    { role: "user", content: transcript },
  ],
  response_format: { type: "json_schema", json_schema: { name: "daily_journal", strict: true, schema } },
};

console.log("Calling OpenAI (gpt-4o-mini, structured outputs)…\n");
const r = await fetch("https://api.openai.com/v1/chat/completions", {
  method: "POST",
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const data = await r.json();
if (!r.ok) { console.error("OpenAI error:", data?.error?.message || data); process.exit(1); }

const result = JSON.parse(data.choices[0].message.content);
console.log("=== Routed into journal fields ===\n");
console.log(JSON.stringify(result, null, 2));
console.log("\n=== Quick read ===");
console.log("theme:", result.analytical_theme);
console.log("3/10s caught:", (result.catch_310 || []).length);
console.log("pauses:", (result.one_pause || []).length);
console.log("opponent powers ticked:", ["power_regret","power_remedy","power_resolve","power_rejoice"].filter(k => result[k]).join(", "));
console.log("shantideva:", result.shantideva, "(expected false/null — wasn't done)");
console.log("\ntokens:", data.usage?.total_tokens, "→ ~$" + ((data.usage?.total_tokens || 0) / 1e6 * 0.3).toFixed(5), "at gpt-4o-mini blended");
