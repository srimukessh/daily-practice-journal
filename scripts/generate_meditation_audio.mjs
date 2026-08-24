// One-time generation of guided-meditation audio via ElevenLabs.
// Voice cues (TTS) + ambient background loops (sound effects) + soft bells.
// Reads ELEVENLABS_API_KEY from ../.env. Saves mp3s under ../audio/.
//
// Run:  node scripts/generate_meditation_audio.mjs
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
let key = process.env.ELEVENLABS_API_KEY;
try {
  for (const line of readFileSync(join(root, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*ELEVENLABS_API_KEY\s*=\s*(.+?)\s*$/);
    if (m) key = m[1].replace(/^["']|["']$/g, "");
  }
} catch (_) {}
if (!key) { console.error("No ELEVENLABS_API_KEY"); process.exit(1); }

// a calm, soft voice ("Charlotte"); high stability + slight slowdown = unhurried, peaceful
const VOICE = "XB0fDUnXU5powFXDhCwa";
const VOICE_SETTINGS = { stability: 0.9, similarity_boost: 0.7, style: 0.0, use_speaker_boost: true, speed: 0.9 };

// Phase cues (short, spoken at each breath phase, synced to the circle), pattern
// announcements (spoken once per pattern), and framing lines.
const CUES = {
  in: "Breathe in…",
  hold: "And hold…",
  out: "And gently… breathe out…",
  a_warmup: "Let's begin, gently. Breathe in… for four. And a long breath out… for eight.",
  a_box: "Now, box breathing. In for four… hold for four… out for four… and hold for four.",
  a_478: "A calming breath now. In for four… hold for seven… and a long, slow breath out, for eight.",
  a_coherent: "In for six… and out for six. Let it become a smooth, steady rhythm.",
  a_balance: "In for four… hold for four… and out for six.",
  f_begin: "Let's begin. Settle in… and when you're ready, gently let your eyes close.",
  f_mindful: "For the next few minutes… be aware of everything around you… and everything within you. Let your breath be the anchor.",
  f_closing: "Beautiful. Let your breath return… to its own, natural rhythm.",
  f_end: "Gently open your eyes when you're ready… and carry this calm with you.",
};

const BG = {
  rain: "gentle steady rain, soft and constant, calm ambient, seamless loop, no thunder",
  ocean: "calm ocean waves gently lapping on a shore, soft ambient, seamless loop",
  spiritual: "soft ambient meditation drone with a distant singing bowl, warm and calm, seamless loop",
};
const BELL = { bell: "a single soft Tibetan singing bowl chime, gentle, resonant" };

async function tts(text) {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: VOICE_SETTINGS }),
  });
  if (!r.ok) throw new Error(`TTS ${r.status}: ${await r.text()}`);
  return Buffer.from(await r.arrayBuffer());
}
async function sfx(prompt, seconds) {
  const r = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ text: prompt, duration_seconds: seconds, loop: true }),
  });
  if (!r.ok) throw new Error(`SFX ${r.status}: ${await r.text()}`);
  return Buffer.from(await r.arrayBuffer());
}

mkdirSync(join(root, "audio/voice"), { recursive: true });
mkdirSync(join(root, "audio/bg"), { recursive: true });
mkdirSync(join(root, "audio/bell"), { recursive: true });

for (const [name, text] of Object.entries(CUES)) {
  const buf = await tts(text);
  writeFileSync(join(root, `audio/voice/${name}.mp3`), buf);
  console.log(`voice/${name}.mp3  ${buf.length} bytes`);
}
for (const [name, prompt] of Object.entries(BG)) {
  const buf = await sfx(prompt, 22);
  writeFileSync(join(root, `audio/bg/${name}.mp3`), buf);
  console.log(`bg/${name}.mp3  ${buf.length} bytes`);
}
for (const [name, prompt] of Object.entries(BELL)) {
  const buf = await sfx(prompt, 4);
  writeFileSync(join(root, `audio/bell/${name}.mp3`), buf);
  console.log(`bell/${name}.mp3  ${buf.length} bytes`);
}
console.log("done.");
