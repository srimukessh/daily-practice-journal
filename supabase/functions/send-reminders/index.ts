// Scheduled Web Push sender. Called by pg_cron every 5 minutes. For each stored
// subscription it works out the user's LOCAL time and, if a reminder falls in the
// current 5-minute window, sends a push. Not JWT-gated (cron calls it) — protected
// by the x-cron-secret header instead.
//
// Query params (with the secret) for testing:
//   ?dry=1            → don't send, just report what WOULD fire
//   ?force=morning    → send that reminder to every enabled sub right now (test delivery)
//
// Deploy:  supabase functions deploy send-reminders --no-verify-jwt

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const WINDOW_MIN = 5;
const MESSAGES: Record<string, string> = {
  morning: "Morning practice — set your intention, then concentration + analytical meditation.",
  evening: "Evening review — Regret, Remedy, Resolve. Then Rejoice in what you did well.",
  bed: "Before bed — regret the behaviour, not yourself. Learn, practise, repeat.",
};

function localMinutes(tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz || "UTC", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const h = +(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const m = +(parts.find((p) => p.type === "minute")?.value ?? "0");
  return h * 60 + m;
}
function hmToMinutes(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm || "");
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return new Response("forbidden", { status: 403 });
  }

  const dry = url.searchParams.get("dry") === "1";
  const force = url.searchParams.get("force"); // "morning" | "evening" | "bed"

  webpush.setVapidDetails(
    Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com",
    Deno.env.get("VAPID_PUBLIC_KEY")!,
    Deno.env.get("VAPID_PRIVATE_KEY")!,
  );

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: subs, error } = await supabase
    .from("push_subscriptions").select("*").eq("enabled", true);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  const report: unknown[] = [];
  let sent = 0;

  for (const row of subs ?? []) {
    const nowMin = localMinutes(row.tz);
    const windowStart = nowMin - (nowMin % WINDOW_MIN);
    const rem = row.reminders || {};
    const due: string[] = [];
    for (const key of ["morning", "evening", "bed"]) {
      if (force) { if (key === force) due.push(key); continue; }
      const t = hmToMinutes(rem[key]);
      if (t != null && t >= windowStart && t < windowStart + WINDOW_MIN) due.push(key);
    }
    if (!due.length) continue;

    for (const key of due) {
      report.push({ endpoint: (row.endpoint || "").slice(-12), tz: row.tz, localMin: nowMin, fire: key });
      if (dry) continue;
      try {
        await webpush.sendNotification(row.subscription, JSON.stringify({ title: "Daily Practice", body: MESSAGES[key] }));
        sent++;
      } catch (e: any) {
        const code = e?.statusCode;
        if (code === 404 || code === 410) {
          await supabase.from("push_subscriptions").delete().eq("endpoint", row.endpoint);
        }
      }
    }
  }

  return new Response(JSON.stringify({ dry, force, checked: subs?.length ?? 0, sent, report }), {
    headers: { "Content-Type": "application/json" },
  });
});
