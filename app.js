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
      { id: "concentration", label: "Concentration meditation", minutes: true,
        hint: "Focus on the breath. When the mind wanders, notice it and gently return." },
      { id: "analytical", label: "Analytical meditation", minutes: true,
        hint: "Bring up a mild example, notice it in the body, understand what you're wanting, and practise tolerating the feeling without needing to act.",
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
      { id: "reading", label: "Reading",
        hint: "Something on emotional regulation / mindfulness. Read slowly; stop when something feels personally important and reflect on it, rather than finishing the chapter.",
        select: { id: "reading_book", label: "Book",
          options: ["", "Śāntideva — Bodhicaryāvatāra", "Thich Nhat Hanh", "Pema Chödrön", "The Book of Joy", "Other"] },
        notes: [{ id: "reading_note", label: "What landed (optional)", ph: "What felt personally important?" }] },
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
      if (!e.mins) e.mins = {};   // back-compat for entries saved before minutes existed
      return e;
    } catch (_) {}
  }
  return { checks: {}, notes: {}, logs: {}, mins: {}, updated_at: null };
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
  // size editable log entries to their content (they're in the DOM now)
  root.querySelectorAll(".log-text").forEach(autoGrow);
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
        data: { checks: e.checks, notes: e.notes, logs: e.logs || {}, mins: e.mins || {} },
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
        storeEntry(ds, { checks: row.data.checks || {}, notes: row.data.notes || {}, logs: row.data.logs || {}, mins: row.data.mins || {}, updated_at: row.updated_at });
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
  "Morning — did you do the 10-minute concentration meditation?",
  "The analytical meditation: which theme (anger, being misunderstood, unfairness, rejection, attachment, accepting “no”), and what came up in the body?",
  "Through the day — any 3/10s you caught? For each: what happened, what did you feel, what did you want? Did you manage a pause?",
  "Evening review: what triggered you? What did you feel? What did you do? What would you do differently? Where did you handle something well?",
  "Four Opponent Powers: what do you regret, what's the remedy or reflection, what will you resolve, what do you rejoice in?",
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
      else edited[id] = ctrl.value.trim();
    });
    mergeResult(ds, edited); renderChecklist(); close(); toast("Added to your journal");
  };
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
    if (!document.hidden) { scheduleReminders(); if (user) pullAll(); }
  });
}

// ===== Boot =====
(async function boot() {
  bindEvents();
  setDate(todayYmd());
  // test hook (harmless; only active with ?__test in the URL) — set before async auth so tests don't race it
  if (location.search.includes("__test")) {
    window.__t = { buildAiSpec, mergeResult, summariseResult, loadEntry, ALL_ITEMS, SPEAKING_SCRIPT, openSpeak, transcribeBlob, showReview };
  }
  await initAuth();
  scheduleReminders();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch((e) => console.warn("SW reg failed", e));
  }
})();
