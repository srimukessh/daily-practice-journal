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
function localDate(tz: string): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}
const SLEEP_MIN = 7;

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

  const ALCOHOL_UNTIL = 23 * 60; // 11pm local — last alcohol nudge
  const ALCOHOL_MSG = `Under ${SLEEP_MIN}h of sleep today — go easy on the alcohol tonight. 🌙`;

  for (const row of subs ?? []) {
    const nowMin = localMinutes(row.tz);
    const windowStart = nowMin - (nowMin % WINDOW_MIN);
    const inWindow = (t: number | null) => t != null && t >= windowStart && t < windowStart + WINDOW_MIN;
    const rem = row.reminders || {};

    // standard morning/evening/bed reminders due in this window
    const due: string[] = [];
    for (const key of ["morning", "evening", "bed"]) {
      if (force) { if (key === force) due.push(key); continue; }
      if (inWindow(hmToMinutes(rem[key]))) due.push(key);
    }

    // hourly alcohol repeat: on the hour after the evening reminder, up to 11pm local
    const eMin = hmToMinutes(rem.evening);
    let alcoholRepeat = force === "alcohol";
    if (eMin != null && !force) {
      for (let t = eMin + 60; t <= ALCOHOL_UNTIL; t += 60) { if (inWindow(t)) { alcoholRepeat = true; break; } }
    }

    if (!due.length && !alcoholRepeat) continue;

    // fetch today's sleep once if it matters
    let sleep = NaN;
    if (due.includes("evening") || alcoholRepeat) {
      const { data: ent } = await supabase.from("entries")
        .select("data").eq("user_id", row.user_id).eq("entry_date", localDate(row.tz)).maybeSingle();
      sleep = parseFloat(ent?.data?.mins?.sleep);
    }
    const lowSleep = !isNaN(sleep) && sleep < SLEEP_MIN;

    const toSend: { key: string; body: string }[] = [];
    for (const key of due) {
      let body = MESSAGES[key];
      if (key === "evening" && lowSleep) {
        body = `Evening review — Regret, Remedy, Resolve, then Rejoice. You slept under ${SLEEP_MIN}h — go easy on the alcohol tonight. 🌙`;
      }
      toSend.push({ key, body });
    }
    // add the hourly alcohol nudge (skip if the evening reminder is already firing this window)
    if (alcoholRepeat && !due.includes("evening") && lowSleep) {
      toSend.push({ key: "alcohol", body: ALCOHOL_MSG });
    }

    for (const { key, body } of toSend) {
      report.push({ endpoint: (row.endpoint || "").slice(-12), tz: row.tz, localMin: nowMin, fire: key });
      if (dry) continue;
      try {
        await webpush.sendNotification(row.subscription, JSON.stringify({ title: "Daily Practice", body }));
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
