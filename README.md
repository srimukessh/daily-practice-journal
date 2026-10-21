# Daily Practice

> ⛔ **All rights reserved — proprietary. Look, don't copy.**
> This repository is public **only** to showcase the author's work. You are welcome to read it.
> You may **not** copy, reuse, modify, or redistribute any part of it without written
> permission. See [`LICENSE`](LICENSE). © 2026 Kesh Subramanian.

A private, offline-first daily meditation & reflection checklist. Installs like an app on
your iPhone and Mac from a single URL, works with no internet, and syncs your journal across
devices through Supabase.

- **No build step** — plain HTML/CSS/JS.
- **Offline-first** — every edit saves to the device instantly; syncs when back online.
- **Private** — magic-link login; each account sees only its own data (Row Level Security).

---

## What's in the checklist

Morning concentration meditation · morning analytical meditation (with a theme picker) ·
catch the 3/10 · one pause · evening 5–10 min review (five prompts) · Four Opponent Powers
(Regret · Remedy · Resolve · Rejoice) · Śāntideva reading · before-bed line. History tab has
streaks + a calendar. Edit the practice anytime in the `SECTIONS` array at the top of `app.js`.

---

## Setup (~10 minutes, one time)

### 1. Create the Supabase project
1. Go to <https://supabase.com> → **Start your project** → sign in → **New project**.
2. Name it `daily-practice`, pick a region near you, set a database password (any), **Create**.
3. Wait ~1 min for it to provision.

### 2. Create the table
1. Left sidebar → **SQL Editor** → **New query**.
2. Paste the entire contents of [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
   You should see "Success". This creates the `entries` table with per-user security.

### 3. Turn on email magic links
1. Left sidebar → **Authentication** → **Providers** → **Email**.
2. Ensure **Email** is enabled. (Confirm email can stay on.) Save.
   > Supabase's built-in email works out of the box for personal use.

### 4. Get your two keys
1. Left sidebar → **Project Settings** (gear) → **API**.
2. Copy **Project URL** and the **`anon` `public`** key.
3. Open [`config.js`](config.js) in this project and paste them in:
   ```js
   window.APP_CONFIG = {
     SUPABASE_URL: "https://xxxx.supabase.co",
     SUPABASE_ANON_KEY: "eyJhbGci...",
   };
   ```
   > The anon key is **safe to commit / ship** — Row Level Security is what protects the data.

### 5. Try it locally
```bash
cd daily-practice-journal
python3 -m http.server 5173
# open http://localhost:5173
```
Enter your email → click the link Supabase sends → you're in.

### 6. Deploy to Vercel (so your phone can reach it)
1. Push this folder to a GitHub repo (see below), or run `npx vercel` from this folder.
2. In Vercel: **Add New → Project** → import the repo → **Deploy** (no settings needed; it's static).
3. Copy your `https://your-app.vercel.app` URL.
4. Back in **Supabase → Authentication → URL Configuration**, add that URL to
   **Site URL** and **Redirect URLs** so magic links return to the deployed app.

### 7. Install it as an app
- **iPhone (Safari):** open the URL → Share → **Add to Home Screen**.
- **Mac (Chrome/Edge):** open the URL → install icon in the address bar → **Install**.
  (Safari on macOS: File → **Add to Dock**.)

Done. Open it, tick your day, and it syncs everywhere.

---

## Optional: "Speak through your day" (voice → journal)

There are two ways to fill the journal each day:
1. **Tap / type** the checklist directly (works with no setup).
2. **Speak or paste your whole day** — tap the button at the top, talk through the on-screen
   prompts (dictate with Wispr, or type), and OpenAI sorts it into the right boxes. **You review
   a summary before anything is saved.** Captured offline? It queues and organises on reconnect.

This second mode needs a tiny Supabase Edge Function (keeps your OpenAI key server-side):

1. Install the Supabase CLI: `brew install supabase/tap/supabase` (or see their docs).
2. From this folder: `supabase login`, then `supabase link --project-ref <your-ref>`
   (the ref is in your project URL).
3. Set your OpenAI key as a secret:
   ```bash
   supabase secrets set OPENAI_API_KEY=sk-...
   ```
4. Deploy the function:
   ```bash
   supabase functions deploy organise
   ```
That's it — the "Speak / paste your whole day" button now works. Transcription/routing runs on
`gpt-4o-mini`; cost is a fraction of a cent per day. Note: the text you submit is sent to OpenAI.

> The routing schema is generated from the `SECTIONS` array in `app.js`, so if you change the
> checklist the AI follows automatically — no function edit needed.

## Notes
- **Offline-only mode:** if `config.js` is left blank, the app still runs fully — data just
  stays on that one device (no login, no sync, no voice organise). Good for a quick try.
- **Reminders** (Settings tab) are best-effort local notifications: reliable on Mac & Android;
  on iPhone they only fire while the app has been opened recently, so keep a phone alarm as backup.
- **Backup:** Settings → **Export journal (JSON)** downloads everything.
- **Changing the checklist:** edit `SECTIONS` in `app.js`; the storage format adapts automatically.
- **App icons:** regenerate with `python3 scripts/generate_icons.py` (pure stdlib, no deps).
