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
      { id: "concentration", label: "Concentration meditation — 10 min",
        hint: "Focus on the breath. When the mind wanders, notice it and gently return." },
      { id: "analytical", label: "Analytical meditation — 10 min",
        hint: "Bring up a mild example, notice it in the body, understand what you're wanting, and practise tolerating the feeling without needing to act.",
        select: { id: "analytical_theme", label: "Theme for today",
          options: ["", "Anger", "Being misunderstood", "Unfairness", "Rejection", "Attachment", "Accepting “no”"] },
        notes: [{ id: "analytical_note", label: "What came up (optional)", ph: "What did I notice in the body? What was I wanting?" }] },
    ],
  },
  {
    title: "Through the day",
    items: [
      { id: "catch_310", label: "Caught the 3/10", log: true,
        logPh: "A 3/10 you caught — what did you feel / want?",
        hint: "When irritation, fear, defensiveness or anger appears, notice the body first — “What am I feeling? What am I wanting right now?” Add each one through the day. Tap a box and dictate with Wispr." },
      { id: "one_pause", label: "One pause",
        hint: "An urge to defend, correct, persuade, message, retaliate or fix — and I didn't act straight away. I let the discomfort exist.",
        notes: [{ id: "pause_note", label: "The pause (optional)", ph: "What was the urge? What did I do instead?" }] },
    ],
  },
  {
    title: "Evening review",
    items: [
      { id: "review", label: "5–10 min review",
        notes: [
          { id: "review_triggered", label: "What triggered me?", ph: "" },
          { id: "review_felt", label: "What did I feel?", ph: "" },
          { id: "review_did", label: "What did I do?", ph: "" },
          { id: "review_diff", label: "What would I do differently?", ph: "" },
          { id: "review_well", label: "Where did I handle something well?", ph: "" },
        ] },
      { id: "opponent_powers", label: "Four Opponent Powers",
        hint: "Regret what was unhelpful → remedy / reflection → resolve to respond differently → rejoice in what you did well.",
        group: [
          { id: "power_regret", label: "Regret" },
          { id: "power_remedy", label: "Remedy" },
          { id: "power_resolve", label: "Resolve" },
          { id: "power_rejoice", label: "Rejoice" },
        ],
        notes: [{ id: "powers_note", label: "Notes (optional)", ph: "" }] },
      { id: "shantideva", label: "Read Śāntideva — 10–15 min",
        hint: "Read slowly. Stop when something feels personally important and reflect on it, rather than trying to finish the chapter.",
        notes: [{ id: "shantideva_note", label: "What felt important (optional)", ph: "" }] },
      { id: "before_bed", label: "Before bed",
        hint: "“Regret the behaviour. Don't hate myself. Learn, practise, repeat.”" },
    ],
  },
];

const ALL_ITEMS = SECTIONS.flatMap((s) => s.items);
const TOTAL_ITEMS = ALL_ITEMS.length;

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
      return e;
    } catch (_) {}
  }
  return { checks: {}, notes: {}, logs: {}, updated_at: null };
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
  renderProgress(entry);
}

function renderItem(item, entry) {
  const el = document.createElement("div");
  const done = itemDone(item, entry);
  el.className = "item" + (done ? " done" : "");

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
  body.innerHTML = `<div class="item-label">${item.label}</div>` +
    (item.hint ? `<div class="item-hint">${item.hint}</div>` : "");
  head.appendChild(body);
  el.appendChild(head);

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
      row.innerHTML = `<span class="log-time">${hhmm(entryLog.t)}</span><span class="log-text"></span>` +
        `<button class="log-del" aria-label="delete">×</button>`;
      row.querySelector(".log-text").textContent = entryLog.text;
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
  $("#acct-email").textContent = user ? `Signed in as ${user.email}` : (SYNC_ON ? "Not signed in" : "Offline-only mode (Supabase not configured)");
  $("#signout-btn").classList.toggle("hidden", !user);
}

// ===== Reminders (best-effort, local) =====
function getReminders() {
  try { return JSON.parse(localStorage.getItem("dp:reminders")) || { morning: "07:30", evening: "21:00", bed: "22:30", on: false }; }
  catch (_) { return { morning: "07:30", evening: "21:00", bed: "22:30", on: false }; }
}
function saveReminders(r) { localStorage.setItem("dp:reminders", JSON.stringify(r)); }

let reminderTimers = [];
function scheduleReminders() {
  reminderTimers.forEach(clearTimeout); reminderTimers = [];
  const r = getReminders();
  if (!r.on || !("Notification" in window) || Notification.permission !== "granted") return;
  const plan = [
    { t: r.morning, msg: "Morning practice: concentration + analytical meditation." },
    { t: r.evening, msg: "Evening review: what triggered me today? Four Opponent Powers." },
    { t: r.bed, msg: "Before bed: regret the behaviour, don't hate myself. Learn, practise, repeat." },
  ];
  for (const p of plan) {
    if (!p.t) continue;
    const [hh, mm] = p.t.split(":").map(Number);
    const next = new Date();
    next.setHours(hh, mm, 0, 0);
    if (next <= new Date()) next.setDate(next.getDate() + 1);
    const delay = next - new Date();
    if (delay < 2147483647) { // setTimeout max ~24.8 days
      reminderTimers.push(setTimeout(() => {
        new Notification("Daily Practice", { body: p.msg, icon: "icons/icon-192.png" });
        scheduleReminders();
      }, delay));
    }
  }
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
        data: { checks: e.checks, notes: e.notes, logs: e.logs || {} },
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
        storeEntry(ds, { checks: row.data.checks || {}, notes: row.data.notes || {}, logs: row.data.logs || {}, updated_at: row.updated_at });
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

// ===== Wire up UI =====
function bindEvents() {
  document.querySelectorAll(".tab").forEach((t) => t.onclick = () => switchView(t.dataset.view));
  $("#prev-day").onclick = () => setDate(ymd(new Date(new Date(currentDs) - 864e5)));
  $("#next-day").onclick = () => setDate(ymd(new Date(new Date(currentDs).getTime() + 864e5)));
  $("#today-btn").onclick = () => setDate(todayYmd());
  $("#date-label").onclick = () => setDate(todayYmd());
  $("#cal-prev").onclick = () => { calCursor.setMonth(calCursor.getMonth() - 1); renderCalendar(); };
  $("#cal-next").onclick = () => { calCursor.setMonth(calCursor.getMonth() + 1); renderCalendar(); };

  $("#export-btn").onclick = exportJson;
  $("#sync-now").onclick = syncNow;
  $("#signout-btn").onclick = async () => { if (sb) await sb.auth.signOut(); location.reload(); };

  ["morning", "evening", "bed"].forEach((k) => {
    $("#rem-" + k).onchange = (e) => {
      const r = getReminders(); r[k] = e.target.value; saveReminders(r); scheduleReminders();
    };
  });
  $("#enable-notifs").onclick = async () => {
    if (!("Notification" in window)) return toast("Notifications not supported here");
    const perm = await Notification.requestPermission();
    if (perm === "granted") {
      const r = getReminders(); r.on = true; saveReminders(r); scheduleReminders();
      toast("Reminders on");
      new Notification("Daily Practice", { body: "Reminders enabled — you're set.", icon: "icons/icon-192.png" });
    } else toast("Notifications blocked");
  };

  // auth form
  $("#auth-form").onsubmit = async (e) => {
    e.preventDefault();
    if (!sb) return;
    const email = $("#email").value.trim();
    const btn = $("#auth-btn");
    btn.disabled = true; $("#auth-msg").textContent = "Sending…";
    const { error } = await sb.auth.signInWithOtp({
      email, options: { emailRedirectTo: location.origin + location.pathname },
    });
    btn.disabled = false;
    $("#auth-msg").textContent = error ? ("Error: " + error.message) : "Check your email for the sign-in link.";
  };

  // connectivity + lifecycle
  window.addEventListener("online", () => { setSyncState("syncing…"); pushDirty().then(pullAll); });
  window.addEventListener("offline", () => setSyncState("offline — saved on device"));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { scheduleReminders(); if (user) pullAll(); }
  });
}

// ===== Boot =====
(async function boot() {
  bindEvents();
  setDate(todayYmd());
  await initAuth();
  scheduleReminders();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch((e) => console.warn("SW reg failed", e));
  }
})();
