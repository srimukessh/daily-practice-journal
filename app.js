/* Daily Practice — offline-first PWA.
 * Data flow: every edit writes to localStorage instantly (works offline), marks the
 * day "dirty", and debounces a push to Supabase. On login / "Sync now" we pull remote
 * rows and reconcile by updated_at (last-write-wins). Supabase is optional — with no
 * config the app runs offline-only on this device. */

// ===== Checklist definition (edit here to change the practice) =====
const SECTIONS = [
  {
    title: "Morning",
    items: [
      { id: "intention", label: "Set intention", sleep: true,
        hint: "Take a moment — what do you want to be mindful of today? Log your sleep: under 7h, go easy on alcohol today.",
        notes: [{ id: "intention_note", label: "Today's intention (optional)", ph: "What do I want to be mindful of today?" }] },
      { id: "concentration", label: "Concentration meditation", minutes: true,
        hint: "Focus on the breath. When the mind wanders, notice it and gently return." },
      { id: "analytical", label: "Analytical meditation", minutes: true, routine: true,
        hint: "Bring up a mild example, notice it in the body, understand what you're wanting, and practise tolerating the feeling without needing to act. Tap “Guide me” for a step-by-step routine.",
        select: { id: "analytical_theme", label: "Theme for today",
          options: ["", "Anger", "Being misunderstood", "Unfairness", "Rejection", "Attachment", "Accepting “no”"] },
        notes: [{ id: "analytical_note", label: "What came up (optional)", ph: "What did I notice in the body? What was I wanting?" }] },
    ],
  },
  {
    title: "Through the day",
    items: [
      { id: "catch_310", label: "3/10s & pauses", log: true,
        logPh: "What happened, what you felt / wanted — and if you paused, what you did instead",
        aiHint: "each charged moment — a 3/10 they caught (irritation/fear/defensiveness/anger) and/or a pause where they resisted an urge to act (defend, correct, reply, retaliate, fix)",
        hint: "Notice the charged moments — irritation, fear, defensiveness, anger (your 3/10s) — body first: “What am I feeling? What am I wanting?” And if you caught the urge to defend, correct, reply, retaliate or fix and didn’t act, note that pause too. Add each one through the day." },
    ],
  },
  {
    title: "Evening review",
    items: [
      { id: "review", label: "Evening review",
        hint: "Work through what was hard today — the first three Opponent Powers.",
        notes: [
          { id: "regret", label: "Regret", ph: "What was unhelpful today — what did I do, feel, want?" },
          { id: "remedy", label: "Remedy / reflection", ph: "The antidote — e.g. it's not about me; what actually helps." },
          { id: "resolve", label: "Resolve", ph: "How will I respond differently next time?" },
        ] },
      { id: "rejoice", label: "Rejoice", accent: "warm",
        hint: "The fourth Opponent Power — appreciate what you did well.",
        notes: [{ id: "rejoice_note", label: "What did I handle well today?", ph: "" }] },
      { id: "reading", label: "Reading",
        hint: "Something on emotional regulation / mindfulness. Read slowly; stop when something feels personally important and reflect on it, rather than finishing the chapter.",
        multiselect: { id: "reading_books", label: "Book(s)",
          options: ["Śāntideva — Bodhicaryāvatāra", "Thich Nhat Hanh", "Pema Chödrön", "The Book of Joy"] },
        notes: [{ id: "reading_note", label: "What did you read & learn?", ph: "What book did you read, and what did you learn from it today?" }] },
      { id: "before_bed", label: "Before bed",
        hint: "“Regret the behaviour. Don't hate myself. Learn, practise, repeat.”" },
    ],
  },
];

const ALL_ITEMS = SECTIONS.flatMap((s) => s.items);
const TOTAL_ITEMS = ALL_ITEMS.length;
const SLEEP_MIN = 7; // hours; under this = "go easy on alcohol today"

// ===== Small helpers =====
const $ = (sel) => document.querySelector(sel);
const cfg = window.APP_CONFIG || {};
const SYNC_ON = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);

function ymd(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}
function todayYmd() { return ymd(new Date()); }
function nowIso() { return new Date().toISOString(); }
function prettyDate(ds) {
  const [y, m, d] = ds.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const opts = { weekday: "short", day: "numeric", month: "long" };
  if (ds === todayYmd()) return "Today";
  const yest = ymd(new Date(Date.now() - 864e5));
  if (ds === yest) return "Yesterday";
  return dt.toLocaleDateString(undefined, opts);
}

// ===== Local storage layer =====
const LKEY = (ds) => `dp:entry:${ds}`;
function loadEntry(ds) {
  const raw = localStorage.getItem(LKEY(ds));
  if (raw) {
    try {
      const e = JSON.parse(raw);
      if (!e.logs) e.logs = {};   // back-compat for entries saved before logs existed
      if (!e.mins) e.mins = {};   // back-compat for entries saved before minutes existed
      if (!("routine" in e)) e.routine = null;
      return e;
    } catch (_) {}
  }
  return { checks: {}, notes: {}, logs: {}, mins: {}, routine: null, updated_at: null };
}
function storeEntry(ds, entry) { localStorage.setItem(LKEY(ds), JSON.stringify(entry)); }
function allLocalDates() {
  return Object.keys(localStorage)
    .filter((k) => k.startsWith("dp:entry:"))
    .map((k) => k.slice("dp:entry:".length));
}
function getDirty() { try { return JSON.parse(localStorage.getItem("dp:dirty") || "[]"); } catch (_) { return []; } }
function markDirty(ds) {
  const s = new Set(getDirty()); s.add(ds);
  localStorage.setItem("dp:dirty", JSON.stringify([...s]));
}
function clearDirty(ds) {
  localStorage.setItem("dp:dirty", JSON.stringify(getDirty().filter((d) => d !== ds)));
}

// ===== Completion / streak math =====
function itemDone(item, entry) {
  if (item.log) return (entry.logs[item.id] || []).length > 0;
  if (item.group) return item.group.every((g) => entry.checks[g.id]);
  return !!entry.checks[item.id];
}
function completedCount(entry) { return ALL_ITEMS.filter((it) => itemDone(it, entry)).length; }
function dayScore(entry) { return completedCount(entry) / TOTAL_ITEMS; }
const PRACTISED = 0.5; // a day counts toward a streak at >= 50% complete

function computeStreaks() {
  const scored = {};
  for (const ds of allLocalDates()) scored[ds] = dayScore(loadEntry(ds));
  const totalDays = Object.values(scored).filter((s) => s > 0).length;
  // current streak: walk back from today
  let current = 0;
  for (let i = 0; ; i++) {
    const ds = ymd(new Date(Date.now() - i * 864e5));
    if ((scored[ds] || 0) >= PRACTISED) current++;
    else break;
  }
  // best streak across all recorded days
  const dates = Object.keys(scored).filter((d) => scored[d] >= PRACTISED).sort();
  let best = 0, run = 0, prev = null;
  for (const ds of dates) {
    if (prev && (new Date(ds) - new Date(prev)) === 864e5) run++;
    else run = 1;
    best = Math.max(best, run); prev = ds;
  }
  return { current, best, totalDays };
}

// ===== App state =====
let currentDs = todayYmd();
let calCursor = new Date();
let sb = null;         // supabase client
let user = null;
let pushTimer = null;
let userContext = "";  // standing note (e.g. "going through a breakup") — feeds meditation routines

// ===== Rendering: checklist =====
const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 6"/></svg>';

function renderChecklist() {
  const entry = loadEntry(currentDs);
  const root = $("#checklist");
  root.innerHTML = "";
  for (const section of SECTIONS) {
    const sec = document.createElement("div");
    sec.className = "section";
    sec.innerHTML = `<div class="section-title">${section.title}</div>`;
    for (const item of section.items) {
      sec.appendChild(renderItem(item, entry));
    }
    root.appendChild(sec);
  }
  // size editable log entries to their content (they're in the DOM now)
  root.querySelectorAll(".log-text").forEach(autoGrow);
  renderProgress(entry);
}

function renderItem(item, entry) {
  const el = document.createElement("div");
  const done = itemDone(item, entry);
  el.className = "item" + (done ? " done" : "") + (item.accent ? " item-" + item.accent : "");

  const head = document.createElement("div");
  head.className = "item-head";

  if (!item.group && !item.log) {
    const box = document.createElement("button");
    box.className = "check" + (entry.checks[item.id] ? " on" : "");
    box.innerHTML = CHECK_SVG;
    box.setAttribute("aria-label", "toggle " + item.label);
    box.onclick = () => { toggleCheck(item.id); };
    head.appendChild(box);
  }

  const body = document.createElement("div");
  body.className = "item-body";
  body.innerHTML =
    `<div class="item-labelrow"><span class="item-label">${item.label}</span>` +
    (item.hint ? `<button class="info-btn" aria-label="what to do">i</button>` : "") + `</div>` +
    (item.hint ? `<div class="item-hint hidden">${item.hint}</div>` : "");
  const info = body.querySelector(".info-btn");
  if (info) {
    const hintEl = body.querySelector(".item-hint");
    info.onclick = () => { hintEl.classList.toggle("hidden"); info.classList.toggle("open"); };
  }
  head.appendChild(body);

  // minutes: a number-only box on the right (e.g. how long you meditated)
  if (item.minutes) {
    const m = document.createElement("div");
    m.className = "mins";
    m.innerHTML = `<input type="number" min="0" max="600" inputmode="numeric" class="mins-input" aria-label="minutes" /><span class="mins-unit">min</span>`;
    const inp = m.querySelector("input");
    inp.value = entry.mins[item.id] || "";
    inp.addEventListener("input", (e) => setMin(item.id, e.target.value));
    head.appendChild(m);
  }

  // sleep: hours-slept box (right) + a live "go easy on alcohol" flag
  if (item.sleep) {
    const s = document.createElement("div");
    s.className = "mins";
    s.innerHTML = `<input type="number" min="0" max="24" step="0.5" inputmode="decimal" class="mins-input" aria-label="hours slept" /><span class="mins-unit">h sleep</span>`;
    const inp = s.querySelector("input");
    inp.value = entry.mins.sleep || "";
    head.appendChild(s);
    el.appendChild(head);
    const flag = document.createElement("div");
    flag.className = "sleep-flag";
    el.appendChild(flag);
    const paint = (v) => {
      const n = parseFloat(v);
      if (v === "" || isNaN(n)) { flag.textContent = ""; flag.className = "sleep-flag"; }
      else if (n < SLEEP_MIN) { flag.textContent = `😴 Under ${SLEEP_MIN}h — go easy on alcohol today.`; flag.className = "sleep-flag low"; }
      else { flag.textContent = `✓ Rested (${n}h).`; flag.className = "sleep-flag ok"; }
    };
    paint(inp.value);
    inp.addEventListener("input", (e) => { setMin("sleep", e.target.value); paint(e.target.value); });
  } else {
    el.appendChild(head);
  }

  // theme select
  if (item.select) {
    const wrap = document.createElement("div");
    wrap.className = "note";
    const sel = `<label>${item.select.label}</label><select data-note="${item.select.id}">` +
      item.select.options.map((o) =>
        `<option value="${o}" ${entry.notes[item.select.id] === o ? "selected" : ""}>${o || "— pick a theme —"}</option>`).join("") +
      `</select>`;
    wrap.innerHTML = sel;
    wrap.querySelector("select").onchange = (e) => setNote(item.select.id, e.target.value);
    el.appendChild(wrap);
  }

  // multi-select chips (e.g. which book(s) you read)
  if (item.multiselect) {
    const ms = item.multiselect;
    const sel = new Set(entry.notes[ms.id] || []);
    const wrap = document.createElement("div");
    wrap.className = "note";
    wrap.innerHTML = `<label>${ms.label}</label>`;
    const chips = document.createElement("div");
    chips.className = "sub-checks";
    for (const o of ms.options) {
      const c = document.createElement("button");
      c.className = "chip" + (sel.has(o) ? " on" : "");
      c.textContent = o;
      c.onclick = () => toggleMulti(ms.id, o);
      chips.appendChild(c);
    }
    wrap.appendChild(chips);
    el.appendChild(wrap);
  }

  // guided routine (analytical meditation): generate + step through
  if (item.routine) {
    const r = document.createElement("div");
    r.className = "routine-row";
    const rt = entry.routine;
    if (rt && rt.steps && rt.steps.length) {
      const done = (rt.done || []).filter(Boolean).length;
      r.innerHTML = `<button class="routine-btn">▶ Continue routine (${done}/${rt.steps.length})</button>` +
        `<button class="routine-new" aria-label="new routine">↻</button>`;
      r.querySelector(".routine-btn").onclick = () => openRoutineView(item);
      r.querySelector(".routine-new").onclick = () => openRoutineInput(item);
    } else {
      r.innerHTML = `<button class="routine-btn">🧭 Guide me through it</button>`;
      r.querySelector(".routine-btn").onclick = () => openRoutineInput(item);
    }
    el.appendChild(r);
  }

  // sub-check chips (opponent powers)
  if (item.group) {
    const chips = document.createElement("div");
    chips.className = "sub-checks";
    for (const g of item.group) {
      const c = document.createElement("button");
      c.className = "chip" + (entry.checks[g.id] ? " on" : "");
      c.textContent = g.label;
      c.onclick = () => toggleCheck(g.id);
      chips.appendChild(c);
    }
    el.appendChild(chips);
  }

  // running log (e.g. 3/10s caught through the day)
  if (item.log) {
    const list = entry.logs[item.id] || [];
    const wrap = document.createElement("div");
    wrap.className = "log";
    const ul = document.createElement("div");
    ul.className = "log-list";
    list.forEach((entryLog, idx) => {
      const row = document.createElement("div");
      row.className = "log-row";
      row.innerHTML = `<span class="log-time">${hhmm(entryLog.t)}</span><textarea class="log-text" rows="1"></textarea>` +
        `<button class="log-del" aria-label="delete">×</button>`;
      const lt = row.querySelector(".log-text");
      lt.value = entryLog.text;
      lt.addEventListener("input", (e) => { editLog(item.id, idx, e.target.value); autoGrow(e.target); });
      row.querySelector(".log-del").onclick = () => removeLog(item.id, idx);
      ul.appendChild(row);
    });
    const add = document.createElement("div");
    add.className = "log-add";
    add.innerHTML = `<input type="text" class="log-input" placeholder="${item.logPh || "Add one…"}" ` +
      `enterkeyhint="done" />` + `<button class="log-add-btn">Add</button>`;
    const input = add.querySelector(".log-input");
    const submit = () => { addLog(item.id, input.value); };
    add.querySelector(".log-add-btn").onclick = submit;
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
    wrap.appendChild(ul);
    wrap.appendChild(add);
    el.appendChild(wrap);
  }

  // text notes
  if (item.notes) {
    for (const n of item.notes) {
      const wrap = document.createElement("div");
      wrap.className = "note";
      wrap.innerHTML = `<label>${n.label}</label><textarea rows="2" data-note="${n.id}" placeholder="${n.ph || ""}"></textarea>`;
      const ta = wrap.querySelector("textarea");
      ta.value = entry.notes[n.id] || "";
      ta.addEventListener("input", (e) => setNote(n.id, e.target.value, /*silent*/ true));
      ta.addEventListener("blur", () => renderProgress(loadEntry(currentDs)));
      el.appendChild(wrap);
    }
  }
  return el;
}

function renderProgress(entry) {
  const done = completedCount(entry);
  const pct = Math.round((done / TOTAL_ITEMS) * 100);
  $("#progress-fill").style.width = pct + "%";
  $("#progress-text").textContent = `${done}/${TOTAL_ITEMS}`;
}

// ===== Mutations =====
function mutate(fn) {
  const entry = loadEntry(currentDs);
  fn(entry);
  entry.updated_at = nowIso();
  storeEntry(currentDs, entry);
  markDirty(currentDs);
  schedulePush();
  return entry;
}
function toggleCheck(id) {
  mutate((e) => { e.checks[id] = !e.checks[id]; });
  renderChecklist();
}
function setNote(id, val, silent) {
  mutate((e) => { e.notes[id] = val; });
  if (!silent) renderChecklist();
}
function setMin(id, val) {
  mutate((e) => { if (val === "" || val == null) delete e.mins[id]; else e.mins[id] = String(val); });
}
function toggleMulti(id, val) {
  mutate((e) => {
    const set = new Set(e.notes[id] || []);
    set.has(val) ? set.delete(val) : set.add(val);
    e.notes[id] = [...set];
  });
  renderChecklist();
}
function addLog(id, text) {
  const t = (text || "").trim();
  if (!t) return;
  mutate((e) => { (e.logs[id] = e.logs[id] || []).push({ t: nowIso(), text: t }); });
  renderChecklist();
}
function removeLog(id, idx) {
  mutate((e) => { if (e.logs[id]) e.logs[id].splice(idx, 1); });
  renderChecklist();
}
function editLog(id, idx, text) {
  mutate((e) => { if (e.logs[id] && e.logs[id][idx]) e.logs[id][idx].text = text; });
}
function autoGrow(el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }
function hhmm(iso) {
  try { return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }); }
  catch (_) { return ""; }
}

// ===== Views / tabs =====
function switchView(view) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  ["checklist", "calendar", "settings"].forEach((v) =>
    $("#view-" + v).classList.toggle("hidden", v !== view));
  if (view === "calendar") renderCalendar();
  if (view === "settings") renderSettings();
}

function setDate(ds) {
  currentDs = ds;
  $("#date-label").textContent = prettyDate(ds);
  renderChecklist();
  switchView("checklist");
}

// ===== Calendar =====
function renderCalendar() {
  const { current, best, totalDays } = computeStreaks();
  $("#streak-current").textContent = current;
  $("#streak-best").textContent = best;
  $("#streak-total").textContent = totalDays;

  const y = calCursor.getFullYear(), m = calCursor.getMonth();
  $("#cal-title").textContent = calCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const cal = $("#calendar");
  cal.innerHTML = "";
  ["S", "M", "T", "W", "T", "F", "S"].forEach((d) => {
    const h = document.createElement("div"); h.className = "cal-dow"; h.textContent = d; cal.appendChild(h);
  });
  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  for (let i = 0; i < first; i++) {
    const e = document.createElement("div"); e.className = "cal-cell empty"; cal.appendChild(e);
  }
  for (let d = 1; d <= days; d++) {
    const ds = ymd(new Date(y, m, d));
    const score = dayScore(loadEntry(ds));
    const cell = document.createElement("button");
    cell.className = "cal-cell" + (ds === todayYmd() ? " today" : "");
    const pct = Math.round(score * 100);
    cell.innerHTML = (score > 0 ? `<div class="cal-ring" style="--pct:${pct}%"></div>` : "") + `<span>${d}</span>`;
    cell.onclick = () => setDate(ds);
    cal.appendChild(cell);
  }
}

// ===== Settings =====
function renderSettings() {
  const r = getReminders();
  $("#rem-morning").value = r.morning;
  $("#rem-evening").value = r.evening;
  $("#rem-bed").value = r.bed;
  const btn = $("#enable-notifs");
  const denied = ("Notification" in window) && Notification.permission === "denied";
  btn.disabled = false; btn.onclick = null;
  if (!pushSupported()) { btn.textContent = "Not supported on this browser"; btn.disabled = true; }
  else if (denied) { btn.textContent = "Notifications blocked — allow in browser settings"; btn.disabled = true; }
  else if (r.on) { btn.textContent = "Turn reminders off"; btn.onclick = disablePush; }
  else { btn.textContent = "Enable reminders"; btn.onclick = enablePush; }
  const ctx = $("#context"); if (ctx) ctx.value = userContext;
  $("#acct-email").textContent = user ? `Signed in as ${user.email}` : (SYNC_ON ? "Not signed in" : "Offline-only mode (Supabase not configured)");
  $("#signout-btn").classList.toggle("hidden", !user);
}

// ===== Reminders via Web Push (fire even when the app is closed) =====
const VAPID_PUBLIC = "BKlNxufxX0qgEpZS6aNR8OIL5Mhf4TIrFNEoCFJ9T8CDcuhj6oa4_KZIsg9Mj4oUyCNVTj8A5q0xvJdU1etPZaM";
function getReminders() {
  try { return JSON.parse(localStorage.getItem("dp:reminders")) || { morning: "07:30", evening: "21:00", bed: "22:30", on: false }; }
  catch (_) { return { morning: "07:30", evening: "21:00", bed: "22:30", on: false }; }
}
function saveReminders(r) { localStorage.setItem("dp:reminders", JSON.stringify(r)); }
function pushSupported() { return ("serviceWorker" in navigator) && ("PushManager" in window) && ("Notification" in window); }

function urlBase64ToUint8Array(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const s = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(s), arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
async function currentPushSub() {
  if (!pushSupported()) return null;
  try { const reg = await navigator.serviceWorker.ready; return await reg.pushManager.getSubscription(); } catch (_) { return null; }
}
async function saveSubscription(sub, enabled) {
  if (!sb || !user || !sub) return;
  const j = sub.toJSON();
  const r = getReminders();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  await sb.from("push_subscriptions").upsert({
    user_id: user.id, endpoint: j.endpoint, subscription: j,
    reminders: { morning: r.morning, evening: r.evening, bed: r.bed },
    tz, enabled, updated_at: nowIso(),
  }, { onConflict: "endpoint" });
}
async function enablePush() {
  if (!pushSupported()) return toast("Notifications aren't supported here");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") { renderSettings(); return toast("Notifications blocked"); }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try { sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) }); }
    catch (e) { console.warn("subscribe failed", e); return toast("Couldn't enable push"); }
  }
  await saveSubscription(sub, true);
  const r = getReminders(); r.on = true; saveReminders(r);
  renderSettings(); toast("Reminders on ✓");
}
async function disablePush() {
  const sub = await currentPushSub();
  if (sub) await saveSubscription(sub, false);
  const r = getReminders(); r.on = false; saveReminders(r);
  renderSettings(); toast("Reminders off");
}
async function syncReminderTimes() {
  if (!getReminders().on) return;
  const sub = await currentPushSub();
  if (sub) await saveSubscription(sub, true);
}

// ===== Standing user context (personalises analytical-meditation routines) =====
async function loadContext() {
  if (!sb || !user) return;
  try {
    const { data } = await sb.from("profiles").select("context").eq("user_id", user.id).maybeSingle();
    userContext = (data && data.context) || "";
    const ta = $("#context"); if (ta) ta.value = userContext;
  } catch (_) {}
}
async function saveContext(text) {
  userContext = text;
  if (!sb || !user) return;
  try { await sb.from("profiles").upsert({ user_id: user.id, context: text, updated_at: nowIso() }, { onConflict: "user_id" }); } catch (_) {}
}

// ===== Sync (Supabase) =====
function setSyncState(txt) { $("#sync-state").textContent = txt; }

function schedulePush() {
  if (!sb || !user) { setSyncState(navigator.onLine ? "not signed in" : "offline"); return; }
  clearTimeout(pushTimer);
  setSyncState("saving…");
  pushTimer = setTimeout(pushDirty, 800);
}

async function pushDirty() {
  if (!sb || !user || !navigator.onLine) { setSyncState(navigator.onLine ? "not signed in" : "offline — saved on device"); return; }
  const dirty = getDirty();
  if (!dirty.length) { setSyncState("synced"); return; }
  try {
    for (const ds of dirty) {
      const e = loadEntry(ds);
      const { error } = await sb.from("entries").upsert({
        user_id: user.id, entry_date: ds,
        data: { checks: e.checks, notes: e.notes, logs: e.logs || {}, mins: e.mins || {}, routine: e.routine || null },
        updated_at: e.updated_at || nowIso(),
      }, { onConflict: "user_id,entry_date" });
      if (error) throw error;
      clearDirty(ds);
    }
    setSyncState("synced");
  } catch (err) {
    console.warn("push failed", err);
    setSyncState("will retry");
  }
}

async function pullAll() {
  if (!sb || !user || !navigator.onLine) return;
  setSyncState("syncing…");
  try {
    const { data, error } = await sb.from("entries").select("entry_date, data, updated_at").eq("user_id", user.id);
    if (error) throw error;
    for (const row of data) {
      const ds = row.entry_date;
      const local = loadEntry(ds);
      const remoteTime = row.updated_at ? Date.parse(row.updated_at) : 0;
      const localTime = local.updated_at ? Date.parse(local.updated_at) : 0;
      if (remoteTime >= localTime) {
        storeEntry(ds, { checks: row.data.checks || {}, notes: row.data.notes || {}, logs: row.data.logs || {}, mins: row.data.mins || {}, routine: row.data.routine || null, updated_at: row.updated_at });
      }
    }
    setSyncState("synced");
    renderChecklist();
  } catch (err) {
    console.warn("pull failed", err);
    setSyncState("offline — saved on device");
  }
}

async function syncNow() { await pushDirty(); await pullAll(); toast("Synced"); }

// ===== Auth =====
async function initAuth() {
  if (!SYNC_ON) { // offline-only mode
    $("#auth").classList.add("hidden");
    $("#app").classList.remove("hidden");
    setSyncState("offline-only");
    return;
  }
  sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const { data: { session } } = await sb.auth.getSession();
  if (session) onSignedIn(session.user);
  else showAuth();

  sb.auth.onAuthStateChange((_evt, sess) => {
    if (sess) onSignedIn(sess.user);
    else showAuth();
  });
}
function showAuth() {
  user = null;
  $("#app").classList.add("hidden");
  $("#auth").classList.remove("hidden");
}
function onSignedIn(u) {
  user = u;
  $("#auth").classList.add("hidden");
  $("#app").classList.remove("hidden");
  // clean the magic-link tokens out of the URL
  if (location.hash.includes("access_token") || location.search.includes("code=")) {
    history.replaceState(null, "", location.pathname);
  }
  setDate(todayYmd());
  pullAll();
  pushDirty();
  processPending();
  processPendingRecordings();
  loadContext();
}

// ===== Toast =====
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 1800);
}

// ===== Export =====
function exportJson() {
  const out = {};
  for (const ds of allLocalDates().sort()) out[ds] = loadEntry(ds);
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `daily-practice-${todayYmd()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ===== "Speak through your day" — brain-dump → OpenAI → fields =====
// A read-aloud guide so you know what to cover while dictating (with Wispr) or typing.
const SPEAKING_SCRIPT = [
  "Morning intention — what do you want to be mindful of today?",
  "Concentration meditation — did you do it, and for how many minutes?",
  "Analytical meditation: which theme (anger, being misunderstood, unfairness, rejection, attachment, accepting “no”), how many minutes, and what came up in the body?",
  "Through the day — any 3/10s you caught? For each: what happened, what did you feel, what did you want? Any pauses where you didn't act on an urge?",
  "Evening review — Regret: what was unhelpful today? Remedy: the antidote / reflection. Resolve: how will you respond differently?",
  "Rejoice: what did you handle well today?",
  "Did you read anything on emotional regulation / mindfulness (Śāntideva, Thich Nhat Hanh…)? Which book, and anything that landed?",
  "Anything for before bed?",
];

// Build the JSON schema + field guide the model routes into, straight from SECTIONS
// (single source of truth — edit the checklist and this follows automatically).
function buildAiSpec() {
  const props = {}, guide = [];
  for (const it of ALL_ITEMS) {
    if (!it.group && !it.log) {
      props[it.id] = { type: ["boolean", "null"] };
      guide.push(`${it.id} (boolean): did they do “${it.label}”? null if not mentioned.`);
    }
    if (it.group) for (const g of it.group) {
      props[g.id] = { type: ["boolean", "null"] };
      guide.push(`${g.id} (boolean): Opponent Power “${g.label}” — did they express it? null if not.`);
    }
    if (it.select) {
      const opts = it.select.options.filter(Boolean);
      props[it.select.id] = { type: ["string", "null"], enum: [...opts, null] };
      guide.push(`${it.select.id} (one of: ${opts.join(", ")}, or null): ${it.select.label} for “${it.label}”. Pick the closest option; use "Other" if named but not listed.`);
    }
    if (it.multiselect) {
      props[it.multiselect.id] = { type: ["array", "null"], items: { type: "string", enum: it.multiselect.options } };
      guide.push(`${it.multiselect.id} (array from: ${it.multiselect.options.join(", ")}, or null): which of these they read.`);
    }
    if (it.notes) for (const n of it.notes) {
      props[n.id] = { type: ["string", "null"] };
      guide.push(`${n.id} (string or null): ${n.label}. Their own words, first-person, including any body sensations and what they were wanting. null if not mentioned.`);
    }
    if (it.log) {
      props[it.id] = { type: ["array", "null"], items: { type: "string" } };
      const what = it.aiHint || `each distinct “${it.label}” moment`;
      guide.push(`${it.id} (array of strings or null): ${what}. One entry per moment, each ONE full first-person sentence — the situation + what they felt (incl. body sensations) + what they were wanting (and for a pause, what they did instead). Never a single word.`);
    }
    if (it.minutes) {
      props[it.id + "_min"] = { type: ["integer", "null"] };
      guide.push(`${it.id}_min (integer or null): how many minutes of “${it.label}” they did, if stated.`);
    }
    if (it.sleep) {
      props["sleep_hours"] = { type: ["number", "null"] };
      guide.push(`sleep_hours (number or null): how many hours they slept last night, if stated.`);
    }
  }
  return {
    schema: { type: "object", properties: props, required: Object.keys(props), additionalProperties: false },
    guide: guide.join("\n"),
  };
}

// Merge model output into a day, non-destructively: ticks (never un-ticks) checks,
// fills the theme, appends to notes, and appends new 3/10s.
function mergeResult(ds, result) {
  const e = loadEntry(ds);
  for (const it of ALL_ITEMS) {
    if (!it.group && !it.log && result[it.id] === true) e.checks[it.id] = true;
    if (it.group) for (const g of it.group) if (result[g.id] === true) e.checks[g.id] = true;
    if (it.select && result[it.select.id]) e.notes[it.select.id] = result[it.select.id];
    if (it.multiselect && Array.isArray(result[it.multiselect.id]) && result[it.multiselect.id].length) {
      const set = new Set(e.notes[it.multiselect.id] || []);
      result[it.multiselect.id].forEach((x) => set.add(x));
      e.notes[it.multiselect.id] = [...set];
    }
    if (it.notes) for (const n of it.notes) {
      const v = result[n.id];
      if (v && String(v).trim()) {
        const cur = (e.notes[n.id] || "").trim();
        e.notes[n.id] = cur ? cur + "\n" + String(v).trim() : String(v).trim();
      }
    }
    if (it.log && Array.isArray(result[it.id])) {
      for (const s of result[it.id]) if (s && s.trim()) (e.logs[it.id] = e.logs[it.id] || []).push({ t: nowIso(), text: s.trim() });
    }
    if (it.minutes) {
      const mv = result[it.id + "_min"];
      if (mv !== null && mv !== undefined && mv !== "") e.mins[it.id] = String(mv);
    }
    if (it.sleep) {
      const sv = result["sleep_hours"];
      if (sv !== null && sv !== undefined && sv !== "") e.mins.sleep = String(sv);
    }
  }
  e.updated_at = nowIso();
  storeEntry(ds, e); markDirty(ds); schedulePush();
}

// Human-readable summary of what a result will change (for the review card).
function summariseResult(result) {
  const lines = [];
  const ticks = ALL_ITEMS.flatMap((it) =>
    it.group ? it.group.filter((g) => result[g.id] === true).map((g) => g.label)
             : (!it.log && result[it.id] === true ? [it.label] : []));
  if (ticks.length) lines.push({ h: "Will tick", b: ticks.join(" · ") });
  for (const it of ALL_ITEMS) {
    if (it.select && result[it.select.id]) lines.push({ h: it.select.label, b: result[it.select.id] });
    if (it.notes) for (const n of it.notes) if (result[n.id] && String(result[n.id]).trim())
      lines.push({ h: n.label, b: String(result[n.id]).trim() });
    if (it.log && Array.isArray(result[it.id]) && result[it.id].length)
      lines.push({ h: it.label, b: result[it.id].map((s) => "• " + s).join("\n") });
  }
  return lines;
}

// Offline queue — dumps captured with no signal, organised on reconnect.
function getPending() { try { return JSON.parse(localStorage.getItem("dp:pending") || "[]"); } catch (_) { return []; } }
function queueDump(ds, text) {
  const q = getPending(); q.push({ ds, text });
  localStorage.setItem("dp:pending", JSON.stringify(q));
}
function setPending(q) { localStorage.setItem("dp:pending", JSON.stringify(q)); }

async function organise(ds, transcript) {
  if (!sb || !user) throw new Error("not signed in");
  const { schema, guide } = buildAiSpec();
  const { data, error } = await sb.functions.invoke("organise", {
    body: { transcript, schema, guide, dateLabel: prettyDate(ds) },
  });
  if (error) throw error;
  if (data && data.error) throw new Error(data.error);
  return data.result;
}

async function processPending() {
  if (!sb || !user || !navigator.onLine) return;
  const q = getPending();
  if (!q.length) return;
  const left = [];
  for (const item of q) {
    try {
      const result = await organise(item.ds, item.text);
      mergeResult(item.ds, result);
      toast(`Organised your ${prettyDate(item.ds)} notes`);
    } catch (_) { left.push(item); }
  }
  setPending(left);
  renderChecklist();
}

// ===== Offline voice notes (audio recorded with no signal → transcribed on reconnect) =====
// Audio blobs are too big for localStorage, so they live in IndexedDB.
const IDB_NAME = "dp-audio", IDB_STORE = "recordings";
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE, { keyPath: "id", autoIncrement: true });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbAdd(rec) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).add(rec);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}
async function idbAll() {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const out = [];
    const cur = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).openCursor();
    cur.onsuccess = () => { const c = cur.result; if (c) { out.push({ key: c.key, ...c.value }); c.continue(); } else res(out); };
    cur.onerror = () => rej(cur.error);
  });
}
async function idbDelete(key) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}

function pickAudioMime() {
  const cands = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/aac", "audio/ogg;codecs=opus"];
  for (const c of cands) if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) return c;
  return "";
}
function mimeExt(mime) {
  if (!mime) return "webm";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("aac")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

async function transcribeBlob(blob, mime) {
  if (!sb || !user) throw new Error("not signed in");
  const form = new FormData();
  form.append("file", blob, "note." + mimeExt(mime || blob.type));
  const { data, error } = await sb.functions.invoke("transcribe", { body: form });
  if (error) throw error;
  if (data && data.error) throw new Error(data.error);
  return data.text || "";
}

// On reconnect/login: transcribe each stored voice note, organise it, merge (non-destructive), drop it.
async function processPendingRecordings() {
  if (!sb || !user || !navigator.onLine) return;
  let recs;
  try { recs = await idbAll(); } catch (_) { return; }
  for (const r of recs) {
    try {
      const text = await transcribeBlob(r.blob, r.mime);
      if (text.trim()) { mergeResult(r.ds, await organise(r.ds, text)); }
      await idbDelete(r.key);
      toast(`Organised your voice note from ${prettyDate(r.ds)}`);
    } catch (_) { /* keep for next retry */ }
  }
  renderChecklist();
}

// ===== Overlays =====
function buildOverlay(inner) {
  const root = $("#overlay-root");
  const ov = document.createElement("div");
  ov.className = "overlay";
  ov.innerHTML = `<div class="sheet">${inner}</div>`;
  ov.addEventListener("click", (e) => { if (e.target === ov) ov.remove(); });
  root.appendChild(ov);
  return ov;
}

function openSpeak() {
  if (!SYNC_ON) return toast("Add Supabase + OpenAI to enable this (see README)");
  const script = SPEAKING_SCRIPT.map((s) => `<li>${s}</li>`).join("");
  const ov = buildOverlay(`
    <div class="sheet-head"><h2>Speak / paste your day</h2><button class="sheet-x" aria-label="close">×</button></div>
    <p class="sheet-sub">Record here, dictate with Wispr, or type. I'll sort it into the right boxes — you review before it's saved. Recording works offline; it transcribes when you're back online.</p>
    <ol class="script">${script}</ol>
    <div class="rec-row"><button class="rec-btn" id="rec-btn">🎙️ Record</button><span class="rec-time" id="rec-time"></span></div>
    <textarea id="dump" rows="6" placeholder="…or dictate with Wispr / type here"></textarea>
    <div class="sheet-actions">
      <button class="secondary-btn" id="dump-cancel">Cancel</button>
      <button class="primary-btn" id="dump-go">Organise into journal</button>
    </div>`);
  ov.querySelector(".sheet-x").onclick = () => ov.remove();
  ov.querySelector("#dump-cancel").onclick = () => ov.remove();
  attachRecorder(ov);
  ov.querySelector("#dump-go").onclick = async () => {
    const text = ov.querySelector("#dump").value.trim();
    if (!text) return toast("Nothing to organise yet");
    ov.remove();
    if (!navigator.onLine || !user) { queueDump(currentDs, text); return toast("Saved — will organise when online"); }
    const load = buildOverlay(`<div class="loading"><div class="spinner"></div><p>Organising your day…</p></div>`);
    try {
      const result = await organise(currentDs, text);
      load.remove();
      showReview(currentDs, result);
    } catch (err) {
      load.remove();
      queueDump(currentDs, text);
      toast("Couldn't reach AI — saved, will retry when online");
      console.warn("organise failed", err);
    }
  };
  setTimeout(() => ov.querySelector("#dump").focus(), 50);
}

// Wire the 🎙️ Record button inside the speak overlay.
function attachRecorder(ov) {
  const recBtn = ov.querySelector("#rec-btn");
  const recTime = ov.querySelector("#rec-time");
  if (!recBtn) return;
  if (!(navigator.mediaDevices && window.MediaRecorder)) { recBtn.style.display = "none"; return; }

  let rec = null, chunks = [], timer = null, secs = 0, mime = "";

  async function start() {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (_) { return toast("Microphone permission needed"); }
    mime = pickAudioMime();
    rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    mime = rec.mimeType || mime;
    chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(timer);
      recBtn.classList.remove("recording"); recBtn.textContent = "🎙️ Record";
      await handle(new Blob(chunks, { type: mime || "audio/webm" }));
    };
    rec.start();
    secs = 0; recTime.textContent = "0:00";
    recBtn.textContent = "⏹ Stop"; recBtn.classList.add("recording");
    timer = setInterval(() => { secs++; recTime.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`; }, 1000);
  }

  async function handle(blob) {
    // Offline (or signed out): stash the audio; it transcribes + organises on reconnect.
    if (!navigator.onLine || !user) {
      try { await idbAdd({ ds: currentDs, mime: blob.type, blob, created: nowIso() }); } catch (_) {}
      ov.remove();
      return toast("Voice note saved — will organise when back online");
    }
    // Online: transcribe now and drop the text into the box for you to review + Organise.
    recBtn.disabled = true; recTime.textContent = "transcribing…";
    try {
      const text = await transcribeBlob(blob, blob.type);
      const ta = ov.querySelector("#dump");
      ta.value = ta.value.trim() ? ta.value.trim() + "\n" + text : text;
      recTime.textContent = "✓ transcribed — review & Organise";
    } catch (_) {
      try { await idbAdd({ ds: currentDs, mime: blob.type, blob, created: nowIso() }); } catch (_) {}
      recTime.textContent = "saved for later";
      toast("Couldn't transcribe now — saved, will retry when online");
    } finally { recBtn.disabled = false; }
  }

  recBtn.onclick = () => { (rec && rec.state === "recording") ? rec.stop() : start(); };
}

// Editable review: every field the AI filled is shown as an editable control.
// Toggle off a wrongly-ticked item; fix any wording; then Apply what you edited.
function showReview(ds, result) {
  // collect ticked checks (toggleable) and editable text fields
  const checks = [], fields = [];
  for (const it of ALL_ITEMS) {
    if (!it.group && !it.log && result[it.id] === true) checks.push({ id: it.id, label: it.label });
    if (it.group) for (const g of it.group) if (result[g.id] === true) checks.push({ id: g.id, label: g.label });
    if (it.select && result[it.select.id]) fields.push({ kind: "select", id: it.select.id, label: it.select.label, value: result[it.select.id], options: it.select.options });
    if (it.notes) for (const n of it.notes) if (result[n.id] && String(result[n.id]).trim())
      fields.push({ kind: "note", id: n.id, label: n.label, value: String(result[n.id]).trim() });
    if (it.log && Array.isArray(result[it.id]) && result[it.id].length)
      fields.push({ kind: "log", id: it.id, label: it.label + " (one per line)", value: result[it.id].join("\n") });
    if (it.minutes && result[it.id + "_min"] != null && result[it.id + "_min"] !== "")
      fields.push({ kind: "min", id: it.id + "_min", label: it.label + " (minutes)", value: String(result[it.id + "_min"]) });
    if (it.sleep && result["sleep_hours"] != null && result["sleep_hours"] !== "")
      fields.push({ kind: "min", id: "sleep_hours", label: "Hours slept", value: String(result["sleep_hours"]) });
    if (it.multiselect && Array.isArray(result[it.multiselect.id]) && result[it.multiselect.id].length)
      fields.push({ kind: "csv", id: it.multiselect.id, label: it.multiselect.label, value: result[it.multiselect.id].join(", ") });
  }

  const hasAny = checks.length || fields.length;
  const checksHtml = checks.length
    ? `<div class="rev-checks">${checks.map((c) => `<button class="chip on" data-check="${c.id}"></button>`).join("")}</div>` : "";
  const fieldsHtml = fields.map((f, i) => {
    if (f.kind === "select") {
      const opts = f.options.map((o) => `<option value="${o}">${o || "— none —"}</option>`).join("");
      return `<div class="rev-row"><label class="rev-h"></label><select data-field="${f.id}" data-kind="select">${opts}</select></div>`;
    }
    if (f.kind === "min") {
      return `<div class="rev-row"><label class="rev-h"></label><input type="number" min="0" max="600" data-field="${f.id}" data-kind="min" class="rev-min" /></div>`;
    }
    if (f.kind === "csv") {
      return `<div class="rev-row"><label class="rev-h"></label><input type="text" data-field="${f.id}" data-kind="csv" class="rev-min" style="width:100%" /></div>`;
    }
    const rows = f.kind === "log" ? Math.min(6, (f.value.split("\n").length + 1)) : 3;
    return `<div class="rev-row"><label class="rev-h"></label><textarea data-field="${f.id}" data-kind="${f.kind}" rows="${rows}"></textarea></div>`;
  }).join("");

  const ov = buildOverlay(`
    <div class="sheet-head"><h2>Here's what I understood</h2><button class="sheet-x" aria-label="close">×</button></div>
    ${hasAny ? `<p class="sheet-sub">Tap a tag to remove it, and edit any text. Then apply.</p>${checksHtml}<div class="review">${fieldsHtml}</div>`
             : `<p class="sheet-sub">I couldn't pull anything structured from that. Try adding more detail.</p>`}
    <div class="sheet-actions">
      <button class="secondary-btn" id="rev-discard">Discard</button>
      <button class="primary-btn" id="rev-apply">Apply to ${prettyDate(ds)}</button>
    </div>`);

  // fill values as text (avoids HTML injection from the transcript)
  ov.querySelectorAll("[data-check]").forEach((c, i) => { c.textContent = checks[i].label; });
  ov.querySelectorAll(".rev-row").forEach((row, i) => {
    row.querySelector(".rev-h").textContent = fields[i].label;
    const ctrl = row.querySelector("[data-field]");
    ctrl.value = fields[i].value;
  });
  ov.querySelectorAll("[data-check]").forEach((c) => { c.onclick = () => c.classList.toggle("on"); });

  const close = () => ov.remove();
  ov.querySelector(".sheet-x").onclick = close;
  ov.querySelector("#rev-discard").onclick = close;
  ov.querySelector("#rev-apply").onclick = () => {
    const edited = {};
    ov.querySelectorAll("[data-check].on").forEach((c) => { edited[c.dataset.check] = true; });
    ov.querySelectorAll("[data-field]").forEach((ctrl) => {
      const id = ctrl.dataset.field;
      if (ctrl.dataset.kind === "log") edited[id] = ctrl.value.split("\n").map((s) => s.trim()).filter(Boolean);
      else if (ctrl.dataset.kind === "csv") edited[id] = ctrl.value.split(",").map((s) => s.trim()).filter(Boolean);
      else edited[id] = ctrl.value.trim();
    });
    mergeResult(ds, edited); renderChecklist(); close(); toast("Added to your journal");
  };
}

// ===== Analytical-meditation guided routine =====
function saveRoutine(routine) {
  const e = loadEntry(currentDs);
  e.routine = routine; e.updated_at = nowIso();
  storeEntry(currentDs, e); markDirty(currentDs); schedulePush();
}

function openRoutineInput(item) {
  if (!SYNC_ON) return toast("Add Supabase + OpenAI to enable this");
  const entry = loadEntry(currentDs);
  const themes = item.select ? item.select.options.filter(Boolean) : [];
  const cur = entry.notes[item.select?.id] || "";
  const opts = ['<option value="">— pick a theme —</option>']
    .concat(themes.map((o) => `<option ${o === cur ? "selected" : ""}>${o}</option>`)).join("");
  const ov = buildOverlay(`
    <div class="sheet-head"><h2>Guide my meditation</h2><button class="sheet-x" aria-label="close">×</button></div>
    <p class="sheet-sub">Pick a theme and, if you like, what's on your mind. I'll make a short step-by-step routine${userContext ? " using your context" : ""}.</p>
    <label class="rev-h">Theme</label>
    <select id="rt-theme">${opts}</select>
    <label class="rev-h" style="margin-top:12px;display:block">What happened / what's on your mind (optional)</label>
    <textarea id="rt-sit" rows="3" placeholder="e.g. a friend cancelled again and I felt rejected"></textarea>
    <div class="sheet-actions">
      <button class="secondary-btn" id="rt-cancel">Cancel</button>
      <button class="primary-btn" id="rt-go">Generate routine</button>
    </div>`);
  ov.querySelector(".sheet-x").onclick = () => ov.remove();
  ov.querySelector("#rt-cancel").onclick = () => ov.remove();
  ov.querySelector("#rt-go").onclick = async () => {
    if (!navigator.onLine || !user) return toast("Needs internet to generate");
    const theme = ov.querySelector("#rt-theme").value;
    const situation = ov.querySelector("#rt-sit").value.trim();
    if (item.select && theme) setNote(item.select.id, theme);
    ov.remove();
    const load = buildOverlay(`<div class="loading"><div class="spinner"></div><p>Building your routine…</p></div>`);
    try {
      const { data, error } = await sb.functions.invoke("meditation-routine", { body: { theme, situation, context: userContext } });
      if (error) throw error;
      if (!data || data.error || !(data.steps && data.steps.length)) throw new Error(data && data.error ? data.error : "no steps");
      load.remove();
      saveRoutine({ theme, situation, steps: data.steps, done: data.steps.map(() => false), ts: nowIso() });
      openRoutineView(item);
    } catch (e) { load.remove(); toast("Couldn't generate routine"); console.warn("routine failed", e); }
  };
  setTimeout(() => ov.querySelector("#rt-sit").focus(), 50);
}

function openRoutineView(item) {
  const rt = loadEntry(currentDs).routine;
  if (!rt || !(rt.steps && rt.steps.length)) return openRoutineInput(item);
  const stepsHtml = rt.steps.map((_, i) =>
    `<button class="step" data-i="${i}"><span class="step-num">${i + 1}</span><span class="step-text"></span><span class="step-tick">✓</span></button>`).join("");
  const sub = [rt.theme, rt.situation].filter(Boolean).join(" · ");
  const ov = buildOverlay(`
    <div class="sheet-head"><h2>Analytical meditation</h2><button class="sheet-x" aria-label="close">×</button></div>
    ${sub ? `<p class="sheet-sub"></p>` : ""}
    <div class="steps">${stepsHtml}</div>
    <div class="sheet-actions">
      <button class="secondary-btn" id="rt-close">Close</button>
      <button class="secondary-btn" id="rt-regen">New routine</button>
    </div>`);
  if (sub) ov.querySelector(".sheet-sub").textContent = sub;
  const steps = ov.querySelectorAll(".step");
  steps.forEach((btn, i) => {
    btn.querySelector(".step-text").textContent = rt.steps[i];
    btn.classList.toggle("done", !!rt.done[i]);
    btn.onclick = () => {
      rt.done[i] = !rt.done[i];
      btn.classList.toggle("done", rt.done[i]);
      saveRoutine(rt);
      if (rt.done.every(Boolean)) {
        const e = loadEntry(currentDs); e.checks[item.id] = true; e.updated_at = nowIso();
        storeEntry(currentDs, e); markDirty(currentDs); schedulePush();
        toast("Meditation complete ✓");
      }
    };
  });
  const close = () => { ov.remove(); renderChecklist(); };
  ov.querySelector(".sheet-x").onclick = close;
  ov.querySelector("#rt-close").onclick = close;
  ov.querySelector("#rt-regen").onclick = () => { ov.remove(); openRoutineInput(item); };
}

// ===== Wire up UI =====
function bindEvents() {
  document.querySelectorAll(".tab").forEach((t) => t.onclick = () => switchView(t.dataset.view));
  $("#prev-day").onclick = () => setDate(ymd(new Date(new Date(currentDs) - 864e5)));
  $("#next-day").onclick = () => setDate(ymd(new Date(new Date(currentDs).getTime() + 864e5)));
  $("#today-btn").onclick = () => setDate(todayYmd());
  $("#date-label").onclick = () => setDate(todayYmd());
  $("#cal-prev").onclick = () => { calCursor.setMonth(calCursor.getMonth() - 1); renderCalendar(); };
  $("#cal-next").onclick = () => { calCursor.setMonth(calCursor.getMonth() + 1); renderCalendar(); };

  $("#speak-btn").onclick = openSpeak;
  $("#export-btn").onclick = exportJson;
  $("#sync-now").onclick = syncNow;
  $("#context").addEventListener("input", (e) => { userContext = e.target.value; });
  $("#context").addEventListener("blur", (e) => saveContext(e.target.value.trim()));
  $("#signout-btn").onclick = async () => { if (sb) await sb.auth.signOut(); location.reload(); };

  ["morning", "evening", "bed"].forEach((k) => {
    $("#rem-" + k).onchange = (e) => {
      const r = getReminders(); r[k] = e.target.value; saveReminders(r); syncReminderTimes();
    };
  });
  // #enable-notifs click handler is set in renderSettings (toggles enable/disable)

  // auth form — email + password (works inside the installed PWA; no email/magic-link needed).
  // Tries to sign in; if the account doesn't exist yet, creates it with that password.
  $("#auth-form").onsubmit = async (e) => {
    e.preventDefault();
    if (!sb) return;
    const email = $("#email").value.trim();
    const password = $("#password").value;
    const btn = $("#auth-btn"), msg = $("#auth-msg");
    btn.disabled = true; msg.textContent = "Signing in…";
    try {
      let { error } = await sb.auth.signInWithPassword({ email, password });
      if (error && /invalid login credentials/i.test(error.message)) {
        // no such account (or wrong password) — try to create it
        msg.textContent = "Creating your account…";
        const up = await sb.auth.signUp({ email, password });
        if (up.error) {
          msg.textContent = /already registered/i.test(up.error.message)
            ? "Wrong password for this email — try again."
            : "Error: " + up.error.message;
          return;
        }
        // no session back = either an existing account (wrong password) or confirmation required
        if (!up.data.session) { msg.textContent = "Check your password and try again."; return; }
        error = null;
      } else if (error) {
        msg.textContent = "Error: " + error.message; return;
      }
      msg.textContent = "";
      // onAuthStateChange handles showing the app
    } finally {
      btn.disabled = false;
    }
  };

  // connectivity + lifecycle
  window.addEventListener("online", () => { setSyncState("syncing…"); pushDirty().then(pullAll).then(processPending).then(processPendingRecordings); });
  window.addEventListener("offline", () => setSyncState("offline — saved on device"));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && user) pullAll();
  });
}

// ===== Boot =====
(async function boot() {
  bindEvents();
  setDate(todayYmd());
  // test hook (harmless; only active with ?__test in the URL) — set before async auth so tests don't race it
  if (location.search.includes("__test")) {
    window.__t = { buildAiSpec, mergeResult, summariseResult, loadEntry, ALL_ITEMS, SPEAKING_SCRIPT, openSpeak, transcribeBlob, showReview, saveRoutine, openRoutineView, openRoutineInput };
  }
  await initAuth();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch((e) => console.warn("SW reg failed", e));
  }
})();
