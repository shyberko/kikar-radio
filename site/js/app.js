import { createGithub } from "./github.js";
import { createRadio } from "./radio.js";
import {
  ERROR_TEXT,
  PLAYLISTS,
  MANAGED_MARKER,
  MANAGED_PREFIX,
  bulletinEdition,
  collapseWs,
  currentHourEdition,
  daysUntil,
  endOfJerusalemDay,
  formatDayMonth,
  formatDuration,
  formatFullDate,
  formatShortDate,
  formatTime,
  hebrewWeekday,
  inboxRangeStart,
  jerusalemParts,
  jerusalemToUtc,
  addCalendarDays,
  nextCron,
  playlistShort,
  swipeDecision,
  toAzuraDay,
  windowEnd,
} from "./pure.js";

const SETTINGS_KEY = "kikar-settings-v1";
const QUEUE_KEY = "kikar-queue-v1";
const DRAFT_KEY = "kikar-ad-draft-v1";
const TABS = [
  { path: "/inbox", label: "בחירה", icon: "inbox" },
  { path: "/air", label: "בשידור", icon: "air" },
  { path: "/playlists", label: "פלייליסטים", icon: "list" },
  { path: "/rules", label: "כללים", icon: "rules" },
  { path: "/ads", label: "פרסומות", icon: "ads" },
];
const WINDOWS = [
  ["today", "היום"],
  ["week", "השבוע"],
  ["month", "החודש"],
];
const DAY_LETTERS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

const $ = (sel) => document.querySelector(sel);
const state = {
  route: { path: "/inbox", q: new URLSearchParams() },
  settings: loadSettings(),
  pending: loadQueue(),
  catalog: { items: [] },
  selections: { schemaVersion: 1, items: {} },
  auto: { schemaVersion: 1, items: {} },
  rules: { schemaVersion: 1, rules: [], seriesMap: {} },
  uploads: { items: {}, lastRun: null },
  runs: { runs: [] },
  bulletin: {},
  control: { paused: false },
  ads: emptyAds(),
  system: { playlists: {} },
  playlists: [],
  np: null,
  npError: false,
  ui: {
    loading: true,
    refreshing: false,
    search: "",
    sheet: null,
    bulk: false,
    selected: new Set(),
    undo: [],
    toastTimer: null,
    menu: false,
    help: false,
    setupStep: 1,
    setupMsg: {},
    playingId: null,
    inflight: null,
    activeRun: null,
    adStep: 1,
    draft: loadDraft(),
    uploadProgress: null,
    focusId: null,
    staleAt: null,
    loadError: "",
    ruleEdit: null,
    pauseChooser: false,
    liveNote: "",
    lastLiveAt: 0,
  },
};

const gh = createGithub(() => state.settings.githubToken || "");
const radio = createRadio(() => state.settings.azuraKey || "", () => state.settings.stationUrl);

function loadSettings() {
  try {
    return {
      setupDone: false,
      azuraKey: "",
      githubToken: "",
      stationUrl: "https://radiocast.kikar.co.il",
      ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"),
    };
  } catch {
    return { setupDone: false, azuraKey: "", githubToken: "", stationUrl: "https://radiocast.kikar.co.il" };
  }
}
function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}
function loadQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}
function saveQueue() {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(state.pending));
}
function emptyAds() {
  return { schemaVersion: 1, campaigns: [], jingles: { everySongs: 4, enabled: true, playlistId: null, files: [] }, sweepers: { everySongs: 3, enabled: true, playlistId: null, files: [] } };
}
function loadDraft() {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
  } catch {
    return null;
  }
}
function saveDraft(draft) {
  state.ui.draft = draft;
  if (draft) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  else localStorage.removeItem(DRAFT_KEY);
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
function icon(name) {
  const common = 'viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
  const paths = {
    inbox: `<svg ${common}><path d="M4 13h4l1.5 3h5L16 13h4"/><path d="M5 13 7 5h10l2 8v6H5v-6z"/></svg>`,
    air: `<svg ${common}><path d="M5 15a7 7 0 0 1 14 0"/><path d="M8 15a4 4 0 0 1 8 0"/><circle cx="12" cy="16.5" r="1"/></svg>`,
    list: `<svg ${common}><path d="M8 7h11M8 12h11M8 17h11"/><path d="M4 7h.01M4 12h.01M4 17h.01"/></svg>`,
    rules: `<svg ${common}><path d="M12 4v16"/><path d="M12 8h6M12 12H8M12 16h6"/></svg>`,
    ads: `<svg ${common}><path d="M4 10v4h3l5 4V6L7 10H4z"/><path d="M16 9.5a3 3 0 0 1 0 5"/></svg>`,
    play: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7v10l8-5-8-5z" fill="currentColor"/></svg>`,
    pause: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h3v12H8zM13 6h3v12h-3z" fill="currentColor"/></svg>`,
    check: `<svg ${common}><path d="M5 12.5 9.2 17 19 7"/></svg>`,
    more: `<svg ${common}><circle cx="6" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="18" cy="12" r="1" fill="currentColor"/></svg>`,
    menu: `<svg ${common}><path d="M4 7h16M4 12h16M4 17h16"/></svg>`,
    search: `<svg ${common}><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg>`,
  };
  return paths[name] || "";
}
function uid(prefix) {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}
function isNetwork(err) {
  return !navigator.onLine || err?.code === "network" || err?.name === "TypeError";
}
function todayKey(now = new Date()) {
  const p = jerusalemParts(now);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
function knownIds() {
  const ids = new Set();
  for (const row of Object.values(state.system.playlists || {})) if (row?.id) ids.add(Number(row.id));
  for (const campaign of state.ads.campaigns || []) {
    if (campaign.frequencyPlaylistId) ids.add(Number(campaign.frequencyPlaylistId));
    if (campaign.fixedPlaylistId) ids.add(Number(campaign.fixedPlaylistId));
  }
  if (state.ads.jingles?.playlistId) ids.add(Number(state.ads.jingles.playlistId));
  if (state.ads.sweepers?.playlistId) ids.add(Number(state.ads.sweepers.playlistId));
  for (const pl of state.playlists) {
    if (radio.canTouch(pl, ids)) ids.add(Number(pl.id));
  }
  return ids;
}

function parseRoute() {
  const raw = (location.hash || "#/inbox").replace(/^#/, "");
  const [path, qs] = raw.split("?");
  return { path: path || "/inbox", q: new URLSearchParams(qs || "") };
}
function go(path, params) {
  const q = new URLSearchParams(params || {});
  const text = q.toString();
  location.hash = `#${path}${text ? `?${text}` : ""}`;
}
function mergeQuery(patch) {
  const q = new URLSearchParams(state.route.q);
  for (const [k, v] of Object.entries(patch)) {
    if (v == null || v === "") q.delete(k);
    else q.set(k, v);
  }
  go(state.route.path, Object.fromEntries(q.entries()));
}

function itemById(id) {
  return (state.catalog.items || []).find((item) => item.id === id) || null;
}
function defaultsFor(item) {
  const map = state.rules.seriesMap?.[item.seriesSlug] || {};
  return {
    playlistKey: map.playlistKey || (item.feed === "music" ? "music" : "briefs"),
    window: map.window || "week",
    replacePrevious: Boolean(map.replacePrevious),
  };
}
function intentOf(id) {
  const sel = state.selections.items?.[id];
  if (sel) return sel.status === "approved" ? sel : null;
  const auto = state.auto.items?.[id];
  if (!auto) return null;
  return { ...auto, status: "approved", source: "rule", uploadNow: false };
}
function statusOf(item) {
  const sel = state.selections.items?.[item.id];
  if (sel?.status === "skipped") return "skipped";
  if (sel?.status === "approved" || state.auto.items?.[item.id]) return "approved";
  return "new";
}
function seriesList(feed, range) {
  const start = inboxRangeStart(range, new Date());
  const map = new Map();
  for (const item of state.catalog.items || []) {
    if (item.feed !== feed) continue;
    if (new Date(item.pubDate) < start) continue;
    map.set(item.seriesSlug, item.seriesName || item.seriesSlug);
  }
  return [...map.entries()];
}
function filteredItems() {
  const tab = state.route.q.get("tab") || "vod";
  const range = state.route.q.get("range") || "week";
  const status = state.route.q.get("status") || "new";
  const series = (state.route.q.get("series") || "").split(",").filter(Boolean);
  const start = inboxRangeStart(range, new Date());
  return (state.catalog.items || [])
    .filter((item) => item.feed === tab)
    .filter((item) => new Date(item.pubDate) >= start)
    .filter((item) => !series.length || series.includes(item.seriesSlug))
    .filter((item) => statusOf(item) === status)
    .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
}
function newCount() {
  return (state.catalog.items || []).filter((item) => statusOf(item) === "new").length;
}
function queuedIds() {
  const now = new Date();
  const ids = new Set();
  const consider = new Set([...Object.keys(state.selections.items || {}), ...Object.keys(state.auto.items || {})]);
  for (const id of consider) {
    const intent = intentOf(id);
    if (!intent?.windowEnd || new Date(intent.windowEnd) <= now) continue;
    const rec = state.uploads.items?.[id];
    if (!rec || rec.state === "queued" || rec.state === "failed" || rec.state === "expired" || rec.state === "removed" || rec.state === "replaced") {
      if (rec?.state === "failed" && rec.attempts >= 3 && !(intent.retryAt && new Date(intent.retryAt) > new Date(rec.failedAt || 0))) continue;
      ids.add(id);
    }
  }
  return [...ids];
}
function failedCount() {
  return Object.values(state.uploads.items || {}).filter((rec) => rec.state === "failed").length;
}

function say(text) {
  const now = Date.now();
  if (now - state.ui.lastLiveAt < 10000 && text === state.ui.liveNote) return;
  state.ui.lastLiveAt = now;
  state.ui.liveNote = text;
  const node = $("#live");
  if (node) node.textContent = text;
}
function toast(message, actions = []) {
  const host = $("#toast");
  host.innerHTML = `<div class="toast" role="status"><span>${esc(message)}</span>${actions.map((action) => `<button type="button" data-act="${esc(action.act)}">${esc(action.label)}</button>`).join("")}</div>`;
  clearTimeout(state.ui.toastTimer);
  const node = host.querySelector(".toast");
  let left = 8000;
  let tick = Date.now();
  const arm = () => {
    clearTimeout(state.ui.toastTimer);
    state.ui.toastTimer = setTimeout(() => {
      host.innerHTML = "";
    }, left);
  };
  node?.addEventListener("mouseenter", () => clearTimeout(state.ui.toastTimer));
  node?.addEventListener("mouseleave", () => {
    left = Math.max(1200, left - (Date.now() - tick));
    arm();
  });
  node?.addEventListener("focusin", () => clearTimeout(state.ui.toastTimer));
  node?.addEventListener("focusout", () => arm());
  tick = Date.now();
  arm();
}

function pushUndo(entry) {
  state.ui.undo.push({ ...entry, at: Date.now() });
  const recent = state.ui.undo.filter((row) => Date.now() - row.at < 8000 && row.kind === entry.kind);
  const label = recent.length > 1 ? `${recent.length} פריטים ${entry.batchNoun || "עודכנו"}` : entry.label;
  toast(label, [
    { act: "undo", label: "ביטול" },
    ...(entry.changeId ? [{ act: "undo-change", label: "שנה" }] : []),
  ]);
}
function undo() {
  const last = state.ui.undo[state.ui.undo.length - 1];
  if (!last) return;
  const group = [];
  while (state.ui.undo.length && Date.now() - state.ui.undo[state.ui.undo.length - 1].at < 8000 && state.ui.undo[state.ui.undo.length - 1].kind === last.kind) {
    group.push(state.ui.undo.pop());
  }
  for (const entry of group) entry.revert();
  persistTouched(group);
  $("#toast").innerHTML = "";
  render();
}

function selectionRecord(item, overrides) {
  const base = defaultsFor(item);
  const now = new Date();
  const kind = overrides.window || base.window;
  const end = overrides.windowEnd || windowEnd(kind, now, overrides.customEnd);
  return {
    status: "approved",
    playlistKey: overrides.playlistKey || base.playlistKey,
    window: kind,
    windowStart: now.toISOString(),
    windowEnd: end.toISOString(),
    replacePrevious: overrides.replacePrevious ?? base.replacePrevious,
    uploadNow: Boolean(overrides.uploadNow),
    source: "manual",
    ruleId: null,
    updatedAt: now.toISOString(),
    retryAt: overrides.retryAt || null,
  };
}
function rememberSelection(id, next) {
  const prev = state.selections.items[id] ? structuredClone(state.selections.items[id]) : null;
  if (next) state.selections.items[id] = next;
  else delete state.selections.items[id];
  return () => {
    if (prev) state.selections.items[id] = prev;
    else delete state.selections.items[id];
  };
}
function approveItem(item, overrides = {}, label) {
  const revert = rememberSelection(item.id, selectionRecord(item, overrides));
  pushUndo({
    kind: "approve",
    batchNoun: "אושרו",
    label: label || `אושר: ${collapseWs(item.title).slice(0, 42)} · ${formatShortDate(item.pubDate)}`,
    changeId: item.id,
    revert,
  });
  persistSelections();
  if (overrides.uploadNow) dispatchUpload(item.id);
  state.ui.focusId = nextItemId(item.id);
  state.ui.sheet = null;
}
function skipItem(item) {
  const prevDefaults = defaultsFor(item);
  const revert = rememberSelection(item.id, {
    status: "skipped",
    playlistKey: prevDefaults.playlistKey,
    window: prevDefaults.window,
    windowStart: null,
    windowEnd: null,
    replacePrevious: false,
    uploadNow: false,
    source: "manual",
    updatedAt: new Date().toISOString(),
  });
  pushUndo({ kind: "skip", batchNoun: "דולגו", label: `דולג: ${collapseWs(item.title).slice(0, 42)}`, revert });
  persistSelections();
  state.ui.focusId = nextItemId(item.id);
}
function nextItemId(id) {
  const items = filteredItems();
  const index = items.findIndex((item) => item.id === id);
  return items[index + 1]?.id || items[index - 1]?.id || null;
}
function persistSelections() {
  queueWrite("data/selections.json", state.selections, "עדכון בחירות שידור");
}
function persistRules() {
  queueWrite("data/rules.json", state.rules, "עדכון כללי שידור");
}
function persistAds() {
  queueWrite("data/ads.json", state.ads, "עדכון פרסומות");
}
function persistControl() {
  state.control.updatedAt = new Date().toISOString();
  queueWrite("data/bulletin-control.json", state.control, "עדכון מבזק שעתי");
}
function persistTouched(group) {
  const kinds = new Set(group.map((entry) => entry.store));
  if (group.some((entry) => !entry.store) || kinds.has("selections")) persistSelections();
  if (kinds.has("rules")) persistRules();
  if (kinds.has("ads")) persistAds();
  if (kinds.has("control")) persistControl();
}
function upsertQueue(job) {
  state.pending = state.pending.filter((row) => row.dedupeKey !== job.dedupeKey);
  state.pending.push(job);
  saveQueue();
}
function queueWrite(path, body, message) {
  const job = { dedupeKey: `put:${path}`, type: "put", path, body: structuredClone(body), message };
  if (!navigator.onLine || !state.settings.githubToken) {
    if (!state.settings.githubToken) {
      toast("כדי לשמור צריך טוקן GitHub בהגדרות");
      return;
    }
    upsertQueue(job);
    toast("אין חיבור לאינטרנט. הפעולה ממתינה ותישלח כשיחזור.");
    renderBanner();
    return;
  }
  gh.put(path, job.body, message).catch((err) => {
    if (isNetwork(err)) {
      upsertQueue(job);
      toast("אין חיבור לאינטרנט. הפעולה ממתינה ותישלח כשיחזור.");
      renderBanner();
      return;
    }
    toast(err.code === "github" ? ERROR_TEXT.github : err.message || "השמירה נכשלה");
  });
}
async function flushQueue() {
  if (!navigator.onLine || state.ui.flushing || !state.pending.length) return;
  state.ui.flushing = true;
  const jobs = [...state.pending];
  for (const job of jobs) {
    try {
      if (job.type === "put") await gh.put(job.path, job.body, job.message);
      if (job.type === "dispatch") await gh.dispatch(job.workflow, job.inputs);
      state.pending = state.pending.filter((row) => row.dedupeKey !== job.dedupeKey);
      saveQueue();
    } catch (err) {
      if (isNetwork(err)) break;
      toast(err.message || "פעולה ממתינה נכשלה");
      break;
    }
  }
  state.ui.flushing = false;
  if (!state.pending.length) toast("החיבור חזר");
  renderBanner();
}
async function dispatchUpload(itemId) {
  const inputs = { item_id: itemId || "" };
  const job = { dedupeKey: `dispatch:upload:${itemId || "all"}`, type: "dispatch", workflow: "upload.yml", inputs };
  if (!navigator.onLine) {
    upsertQueue(job);
    toast("אין חיבור. ההעלאה תתחיל כשיחזור.");
    return;
  }
  if (state.ui.activeRun) {
    toast("העלאה כבר רצה. פריטים חדשים ייכנסו להרצה הבאה.");
    return;
  }
  try {
    await gh.dispatch("upload.yml", inputs);
    state.ui.inflight = { at: Date.now(), ids: itemId ? [itemId] : queuedIds() };
    toast("ההעלאה התחילה");
    pollRun("upload.yml");
    render();
  } catch (err) {
    if (isNetwork(err)) {
      upsertQueue(job);
      toast("אין חיבור. ההעלאה תתחיל כשיחזור.");
      return;
    }
    toast("לא הצלחנו להפעיל את ההעלאה. בדוק את טוקן GitHub בהגדרות.");
  }
}
async function dispatchBulletin() {
  try {
    await gh.dispatch("bulletin.yml", {});
    toast("בדיקת המבזק התחילה");
    pollRun("bulletin.yml");
  } catch {
    toast("לא הצלחנו להפעיל את ההעלאה. בדוק את טוקן GitHub בהגדרות.");
  }
}
async function pollRun(workflow) {
  const started = Date.now();
  for (let i = 0; i < 40; i++) {
    await new Promise((resolve) => setTimeout(resolve, 8000));
    try {
      const runs = await gh.runs(workflow);
      const run = runs.find((row) => new Date(row.created_at).getTime() >= started - 15000);
      if (!run) continue;
      state.ui.activeRun = run.status !== "completed" ? run : null;
      if (run.status === "completed") {
        state.ui.inflight = null;
        await reloadStatus();
        const failed = run.conclusion !== "success";
        toast(failed ? "ההעלאה הסתיימה עם שגיאה" : "הפריטים עלו לרדיו", failed ? [{ act: "goto-air", label: "הצג" }] : []);
        render();
        return;
      }
      renderTop();
    } catch {
      /* keep polling until the window ends */
    }
  }
  state.ui.activeRun = null;
}

async function loadAll() {
  state.ui.refreshing = state.catalog.items?.length > 0;
  renderTop();
  const files = [
    ["catalog", "data/catalog.json", { items: [] }],
    ["selections", "data/selections.json", { schemaVersion: 1, items: {} }],
    ["auto", "data/auto-approvals.json", { schemaVersion: 1, items: {} }],
    ["rules", "data/rules.json", { schemaVersion: 1, rules: [], seriesMap: {} }],
    ["uploads", "data/status/uploads.json", { items: {}, lastRun: null }],
    ["runs", "data/status/runs.json", { runs: [] }],
    ["bulletin", "data/status/bulletin.json", {}],
    ["control", "data/bulletin-control.json", { paused: false }],
    ["ads", "data/ads.json", emptyAds()],
    ["system", "data/system.json", { playlists: {} }],
  ];
  const errors = [];
  await Promise.all(files.map(async ([key, path, fallback]) => {
    try {
      state[key] = (await gh.read(path)) || fallback;
    } catch (err) {
      errors.push(path);
      state[key] = state[key] || fallback;
    }
  }));
  state.ui.loading = false;
  state.ui.refreshing = false;
  state.ui.staleAt = new Date();
  state.ui.loadError = errors.includes("data/catalog.json") ? "לא הצלחנו לטעון את פיד ה־VOD." : "";
  render();
}
async function reloadStatus() {
  try {
    state.uploads = (await gh.read("data/status/uploads.json")) || state.uploads;
    state.bulletin = (await gh.read("data/status/bulletin.json")) || state.bulletin;
    state.system = (await gh.read("data/system.json")) || state.system;
    state.runs = (await gh.read("data/status/runs.json")) || state.runs;
  } catch {
    /* keep previous */
  }
}
async function refreshNowPlaying() {
  try {
    state.np = await radio.nowPlaying();
    state.npError = false;
  } catch {
    state.npError = true;
  }
  renderTop();
}
async function refreshPlaylists() {
  if (!state.settings.azuraKey) return;
  try {
    state.playlists = await radio.playlists();
  } catch {
    state.playlists = [];
  }
}

function render() {
  const route = state.settings.setupDone ? state.route.path : "/setup";
  document.body.dataset.route = route;
  renderBanner();
  renderTop();
  renderNav();
  const view = $("#view");
  const focus = document.activeElement?.id;
  if (route === "/setup") view.innerHTML = renderSetup();
  else if (route === "/inbox") view.innerHTML = renderInbox();
  else if (route === "/air") view.innerHTML = renderAir();
  else if (route === "/playlists") view.innerHTML = renderPlaylists();
  else if (route === "/rules") view.innerHTML = renderRules();
  else if (route === "/ads") view.innerHTML = renderAds();
  else if (route === "/settings") view.innerHTML = renderSettings();
  else if (route === "/log") view.innerHTML = renderLog();
  else view.innerHTML = renderInbox();
  renderSheet();
  if (focus === "q") $("#q")?.focus();
  const jump = state.ui.focusId && document.querySelector(`[data-card="${CSS.escape(state.ui.focusId)}"] button[data-act="approve"], [data-card="${CSS.escape(state.ui.focusId)}"] h3`);
  if (jump) jump.focus();
  applySearch();
}
function renderBanner() {
  const host = $("#banner");
  const paused = isPaused();
  if (!navigator.onLine) {
    const when = state.ui.staleAt ? formatTime(state.ui.staleAt) : "";
    host.innerHTML = `<div class="banner offline"><span>אין חיבור לאינטרנט. מוצגים נתונים מ־<bdi>${esc(when)}</bdi>. פעולות יישמרו ויישלחו כשהחיבור יחזור.</span></div>`;
    return;
  }
  if (state.pending.length) {
    host.innerHTML = `<div class="banner"><span>${state.pending.length} פעולות ממתינות לחיבור</span></div>`;
    return;
  }
  if (paused) {
    const until = state.control.pauseUntil ? `עד ${formatTime(state.control.pauseUntil)}` : "עד שאחדש";
    host.innerHTML = `<div class="banner"><span>המבזקים השעתיים מושהים ${esc(until)}</span><button class="btn" type="button" data-act="resume-bulletin">חדש עכשיו</button></div>`;
    return;
  }
  host.innerHTML = "";
}
function renderTop() {
  const song = state.np?.now_playing?.song;
  const rawTitle = song?.text || [song?.artist, song?.title].filter(Boolean).join(" — ");
  const title = state.npError ? "הרדיו לא זמין כרגע" : !song ? "טוען…" : /^[0-9a-f-]{8,}/i.test(String(rawTitle).trim()) ? "מתנגן עכשיו" : (rawTitle || "מתנגן עכשיו");
  const listeners = state.np?.listeners?.current;
  const summary = pipelineBadge();
  const bulletinPill = bulletinPillModel();
  $("#top").innerHTML = `
    <div class="np">
      <b><bdi>${esc(title)}</bdi></b>
      <span class="dotline"><i class="dot ${state.npError ? "off" : state.np ? "on" : ""}"></i>${listeners == null ? "" : `${esc(listeners)} מאזינים`}</span>
    </div>
    <button class="pill ${esc(bulletinPill.kind)}" type="button" data-act="goto-bulletin">${esc(bulletinPill.text)}</button>
    <button class="pill ${esc(summary.kind)}" type="button" data-act="pipeline" data-filter="${esc(summary.filter)}">${esc(summary.text)}</button>
    <button class="icon-btn" type="button" data-act="menu" aria-label="תפריט">${icon("menu")}</button>`;
  if (summary.text !== state.ui.lastPipe) {
    state.ui.lastPipe = summary.text;
    say(summary.text);
  }
}
function pipelineBadge() {
  const failed = failedCount();
  const queued = queuedIds().length;
  if (state.ui.inflight || state.ui.activeRun) return { text: "בהעלאה", kind: "warn", filter: "uploading" };
  if (failed) return { text: `${failed} נכשל`, kind: "bad", filter: "failed" };
  if (queued) return { text: `${queued} בתור`, kind: "", filter: "queued" };
  return { text: "הכול מעודכן", kind: "ok", filter: "" };
}
function bulletinPillModel() {
  if (isPaused()) return { text: "מבזקים מושהים", kind: "warn" };
  const note = state.bulletin.note;
  const label = state.bulletin.hour?.label || state.bulletin.active?.label || "";
  if (note === "failed" || state.bulletin.failure) return { text: `מבזק ${label} לא עלה`, kind: "bad" };
  if (state.bulletin.active?.uploadedAt && state.bulletin.active.onAir !== false) return { text: `מבזק ${state.bulletin.active.label} ✓`, kind: "ok" };
  return { text: label ? `מבזק ${label}` : "מבזק שעתי", kind: "" };
}
function renderNav() {
  const failed = failedCount();
  const fresh = newCount();
  $("#rail").innerHTML = `${TABS.map((tab) => {
    const current = state.route.path === tab.path ? 'aria-current="page"' : "";
    const badge = tab.path === "/inbox" && fresh ? `<span class="badge">${fresh}</span>` : tab.path === "/air" && failed ? `<span class="badge dotonly" aria-label="יש כשלון"></span>` : "";
    return `<button class="nav-btn" type="button" data-act="nav" data-path="${tab.path}" ${current}>${icon(tab.icon)}<small>${tab.label}</small>${badge}</button>`;
  }).join("")}<div class="rail-foot"><button class="nav-btn" type="button" data-act="nav" data-path="/settings"><small>הגדרות</small></button></div>`;
  if (state.ui.menu) {
    $("#rail").insertAdjacentHTML("beforeend", `<div class="menu" role="menu"><button type="button" data-act="nav" data-path="/settings">הגדרות</button><button type="button" data-act="nav" data-path="/log">יומן ריצות</button><button type="button" data-act="help">קיצורי מקלדת</button></div>`);
  }
}

function renderSetup() {
  const step = state.ui.setupStep;
  const msg = state.ui.setupMsg[step] || "";
  return `<section class="wizard stack">
    <p class="tiny">שלב ${step} מתוך 3</p>
    <div class="wizard-steps">${[1, 2, 3].map((n) => `<span class="${n <= step ? "on" : ""}"></span>`).join("")}</div>
    ${step === 1 ? `<h1>חיבור לרדיו</h1><p class="muted">המפתח נוצר ב־AzuraCast תחת My API Keys. הוא נשמר רק בדפדפן הזה.</p>
      <label class="field">כתובת התחנה<input id="station-url" dir="ltr" value="${esc(state.settings.stationUrl)}" autocomplete="off"></label>
      <label class="field">מפתח API<input id="azura-key" type="password" dir="ltr" autocomplete="off"></label>
      <p>${esc(msg)}</p>
      <div class="row"><button class="btn" type="button" data-act="toggle-secret" data-target="azura-key">הצג / הסתר</button><button class="btn primary" type="button" data-act="check-radio">בדוק חיבור</button></div>` : ""}
    ${step === 2 ? `<h1>חיבור ל־GitHub</h1><p class="muted">טוקן fine-grained למאגר shyberko/kikar-radio בלבד, עם הרשאת Actions ו־Contents לכתיבה.</p>
      <label class="field">טוקן<input id="github-token" type="password" dir="ltr" autocomplete="off"></label>
      <p>${esc(msg)}</p>
      <div class="row"><button class="btn" type="button" data-act="setup-back">חזרה</button><button class="btn primary" type="button" data-act="check-github">בדוק</button></div>` : ""}
    ${step === 3 ? `<h1>שיוך סדרות לפלייליסטים</h1><p class="muted">אפשר לדלג ולחזור לזה בכללים. ברירת המחדל: VOD למבזקים, מוזיקה למוזיקה, למשך השבוע.</p>
      ${renderSeriesMap()}
      <div class="row"><button class="btn" type="button" data-act="setup-skip">דלג, אעשה אחר כך</button><button class="btn primary" type="button" data-act="setup-finish">סיום</button></div>` : ""}
    <p class="tiny">המפתחות נשמרים רק בדפדפן הזה, במכשיר הזה.</p>
  </section>`;
}
function renderSeriesMap() {
  const series = [];
  const seen = new Set();
  for (const item of state.catalog.items || []) {
    if (seen.has(item.seriesSlug)) continue;
    seen.add(item.seriesSlug);
    series.push(item);
  }
  if (!series.length) return `<p class="muted">עדיין אין סדרות בקטלוג. הן יופיעו אחרי הסריקה.</p>`;
  return series.slice(0, 12).map((item) => `<label class="field">${esc(item.seriesName)}
    <select data-series="${esc(item.seriesSlug)}">
      <option value="briefs">מבזקים</option>
      <option value="music" ${item.feed === "music" ? "selected" : ""}>מוזיקה</option>
    </select></label>`).join("");
}

function renderInbox() {
  if (state.ui.loading) return `<div class="stack"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>`;
  const tab = state.route.q.get("tab") || "vod";
  const range = state.route.q.get("range") || "week";
  const status = state.route.q.get("status") || "new";
  const selectedSeries = new Set((state.route.q.get("series") || "").split(",").filter(Boolean));
  const items = filteredItems();
  const counts = { new: 0, approved: 0, skipped: 0 };
  for (const item of state.catalog.items || []) {
    if (item.feed !== tab) continue;
    if (new Date(item.pubDate) < inboxRangeStart(range, new Date())) continue;
    counts[statusOf(item)] += 1;
  }
  const series = seriesList(tab, range);
  const bulkBar = state.ui.bulk ? `<div class="panel spread"><strong>${state.ui.selected.size} נבחרו</strong><div class="row">
      <button class="btn primary" type="button" data-act="bulk-approve">אשר</button>
      <button class="btn" type="button" data-act="bulk-skip">דלג</button>
      <button class="btn" type="button" data-act="bulk-edit">ערוך הגדרות</button>
      <button class="btn" type="button" data-act="select-all">בחר הכול (${items.length})</button>
      <button class="icon-btn" type="button" data-act="bulk-exit" aria-label="יציאה מבחירה">✕</button>
    </div></div>` : "";
  return `<section class="${state.ui.sheet ? "inbox-open" : ""}">
    ${state.ui.refreshing ? `<div class="progress-top"></div>` : ""}
    ${state.ui.loadError && tab === "vod" ? `<div class="err-inline">${esc(state.ui.loadError)} <button class="btn" type="button" data-act="reload">נסה שוב</button></div>` : ""}
    <div class="filters">
      <div class="spread">
        <div class="seg" role="tablist">${seg("tab", [["vod", "VOD"], ["music", "מוזיקה"]], tab)}</div>
        <div class="row">
          <button class="btn" type="button" data-act="bulk-start">בחר</button>
          <label class="sr" for="q">חיפוש</label>
          <input id="q" placeholder="חיפוש" value="${esc(state.ui.search)}" style="min-height:44px;border-radius:12px;border:1px solid var(--line);padding:0 12px;width:min(220px,46vw)">
        </div>
      </div>
      <div class="chips">${chipRow("range", WINDOWS, range)}${chipRow("status", [["new", `חדשים (${counts.new})`], ["approved", `אושרו (${counts.approved})`], ["skipped", `דולגו (${counts.skipped})`]], status)}</div>
      <div class="chips scroller">
        <button class="chip" type="button" data-act="series-all" aria-pressed="${selectedSeries.size ? "false" : "true"}">הכול</button>
        ${series.map(([slug, name]) => `<button class="chip" type="button" data-act="series" data-slug="${esc(slug)}" aria-pressed="${selectedSeries.has(slug) ? "true" : "false"}">${esc(name)}</button><button class="icon-btn" type="button" data-act="series-menu" data-slug="${esc(slug)}" aria-label="פעולות לסדרה ${esc(name)}">${icon("more")}</button>`).join("")}
      </div>
      <div class="row"><button class="btn" type="button" data-act="skip-old" data-days="3">דלג על פריטים ישנים מ־3 ימים</button>
        <button class="btn" type="button" data-act="skip-old" data-days="7">משבוע</button>
        <button class="btn" type="button" data-act="skip-old" data-days="30">מחודש</button></div>
    </div>
    ${bulkBar}
    <div class="cards" id="cards">${items.length ? items.map(renderCard).join("") : emptyInbox(status, counts)}</div>
  </section>`;
}
function seg(name, options, current) {
  return options.map(([value, label]) => `<button type="button" data-act="q" data-key="${name}" data-value="${value}" aria-pressed="${current === value ? "true" : "false"}">${label}</button>`).join("");
}
function chipRow(name, options, current) {
  return options.map(([value, label]) => `<button class="chip" type="button" data-act="q" data-key="${name}" data-value="${value}" aria-pressed="${current === value ? "true" : "false"}">${label}</button>`).join("");
}
function emptyInbox(status, counts) {
  if (state.ui.loadError) return "";
  const total = counts.new + counts.approved + counts.skipped;
  if (!total) return `<div class="notice"><h2>אין פריטים חדשים</h2><p>פריטים חדשים מה־RSS יופיעו כאן אוטומטית.</p></div>`;
  if (status === "new" && counts.new === 0 && counts.approved + counts.skipped > 0) return `<div class="notice"><h2>סיימת!</h2><p>כל הפריטים טופלו.</p></div>`;
  return `<div class="notice"><h2>אין פריטים שמתאימים לסינון</h2><button class="btn" type="button" data-act="clear-filter">נקה סינון</button></div>`;
}
function renderCard(item) {
  const defs = defaultsFor(item);
  const playing = state.ui.playingId === item.id;
  const byRule = statusOf(item) === "approved" && !state.selections.items[item.id];
  const date = formatShortDate(item.pubDate);
  const search = `${item.title} ${item.seriesName} ${item.description}`;
  return `<div class="swipe" data-id="${esc(item.id)}">
    <div class="under under-approve">אשר ${icon("check")}</div>
    <div class="under under-skip">דלג</div>
    <article class="card ${state.ui.selected.has(item.id) ? "selected" : ""}" data-card="${esc(item.id)}" data-search="${esc(search)}">
      <div class="poster">
        ${item.poster ? `<img src="${esc(item.poster)}" alt="">` : ""}
        <button class="play" type="button" data-act="play" data-id="${esc(item.id)}" aria-label="${playing ? "השהה" : "נגן"}: ${esc(item.title)}">${playing ? icon("pause") : icon("play")}</button>
        <input class="scrub" type="range" min="0" max="100" value="0" data-act="scrub" data-id="${esc(item.id)}" aria-label="מיקום בניגון" aria-valuetext="" ${playing ? "" : "hidden"}>
      </div>
      <div class="card-body" data-act="expand" data-id="${esc(item.id)}">
        <div class="meta"><span class="series">${esc(item.seriesName)}</span><time datetime="${esc(item.pubDate)}">${esc(date)}</time><span>${esc(formatDuration(item.durationSec))}</span>${byRule ? `<span class="series">אושר ע״י כלל</span>` : ""}${state.ui.bulk ? `<span class="check" data-act="toggle-select" data-id="${esc(item.id)}" role="checkbox" aria-checked="${state.ui.selected.has(item.id) ? "true" : "false"}" aria-label="בחר"></span>` : ""}</div>
        <h3>${esc(item.title)}</h3>
        <p class="teaser">${esc(item.description || "")}</p>
        <p class="defaults">יעלה ל: ${esc(playlistShort(defs.playlistKey))} · ${esc(windowName(defs.window))}</p>
        <div class="actions">
          <button class="btn primary grow" type="button" data-act="approve" data-id="${esc(item.id)}" aria-label="אשר: ${esc(item.title)}, ${esc(date)}">אשר</button>
          <button class="btn grow" type="button" data-act="skip" data-id="${esc(item.id)}" aria-label="דלג: ${esc(item.title)}, ${esc(date)}">דלג</button>
          <button class="icon-btn" type="button" data-act="more" data-id="${esc(item.id)}" aria-label="אפשרויות נוספות: ${esc(item.title)}">${icon("more")}</button>
        </div>
      </div>
    </article>
  </div>`;
}
function windowName(kind) {
  return WINDOWS.find(([key]) => key === kind)?.[1] || "השבוע";
}
function applySearch() {
  const q = state.ui.search.trim();
  for (const card of document.querySelectorAll("[data-card]")) {
    const blob = card.dataset.search || "";
    card.parentElement.hidden = Boolean(q) && !blob.includes(q);
  }
}

function renderAir() {
  const rows = airRows();
  const focus = state.route.q.get("focus");
  const shown = focus ? rows.filter((row) => row.kind === focus) : rows;
  return `<section class="stack">
    <div class="spread"><h1>בשידור</h1><p class="tiny">${esc(uploadTimingText())}</p></div>
    ${renderBulletinCard()}
    <div class="row"><button class="btn primary" type="button" data-act="upload-all" ${queuedIds().length ? "" : "disabled"}>${queuedIds().length ? "העלה עכשיו" : "אין פריטים בתור"}</button></div>
    ${shown.length ? shown.map(renderAirRow).join("") : `<div class="notice"><h2>אין כרגע פריטים בתור או בפלייליסטים</h2><button class="btn" type="button" data-act="nav" data-path="/inbox">לבחירת פריטים</button></div>`}
  </section>`;
}
function uploadTimingText() {
  const next = nextCron(new Date(), 5);
  const mins = Math.max(1, Math.round((next.getTime() - Date.now()) / 60000));
  const slot = new Date(next.getTime() - 3600000);
  const last = state.uploads.lastRun?.finishedAt ? new Date(state.uploads.lastRun.finishedAt) : null;
  if (Date.now() - slot.getTime() > 10 * 60000 && (!last || last < slot) && queuedIds().length) {
    return "ההעלאה המתוזמנת מתעכבת. אפשר להעלות עכשיו.";
  }
  return `ההעלאה הבאה בעוד כ־${mins} דק׳`;
}
function airRows() {
  const now = new Date();
  const ids = new Set([...Object.keys(state.uploads.items || {}), ...queuedIds(), ...Object.keys(state.selections.items || {})]);
  const rows = [];
  for (const id of ids) {
    const item = itemById(id);
    const intent = intentOf(id);
    const rec = state.uploads.items?.[id];
    const title = item?.title || rec?.title || id;
    if (state.ui.inflight?.ids?.includes(id)) {
      rows.push({ id, kind: "uploading", title, text: "ממיר ומעלה…", item });
      continue;
    }
    if (rec?.state === "failed") {
      rows.push({ id, kind: "failed", title, text: ERROR_TEXT[rec.errorCode] || ERROR_TEXT.unknown, item, rec });
      continue;
    }
    if (intent && (!rec || ["queued", "expired", "removed", "replaced", "failed"].includes(rec.state))) {
      const end = new Date(intent.windowEnd);
      if (end > now) {
        rows.push({ id, kind: "queued", title, text: uploadTimingText(), item, intent });
        continue;
      }
    }
    if (rec?.state === "active" && intent) {
      const end = new Date(intent.windowEnd);
      const soon = end - now < 86400000;
      rows.push({
        id,
        kind: soon ? "expiring" : "active",
        title,
        text: soon ? `יוסר מהפלייליסט מחר ב־00:00` : `בפלייליסט ״${playlistShort(intent.playlistKey)}״ עד ${formatDayMonth(end)}`,
        item,
        intent,
      });
      continue;
    }
    if (rec && ["expired", "removed", "replaced"].includes(rec.state)) {
      rows.push({ id, kind: "expired", title, text: `הוסר מהפלייליסט${rec.removedAt ? ` ב־${formatShortDate(rec.removedAt)}` : ""} · הקובץ נשמר בשרת`, item, rec });
    }
  }
  const order = { failed: 0, uploading: 1, queued: 2, expiring: 3, active: 4, expired: 5 };
  return rows.sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));
}
function renderAirRow(row) {
  const actions = [];
  if (row.kind === "queued") {
    actions.push(`<button class="btn" type="button" data-act="upload-one" data-id="${esc(row.id)}">העלה עכשיו</button>`);
    actions.push(`<button class="btn" type="button" data-act="unqueue" data-id="${esc(row.id)}">הסר מהתור</button>`);
  }
  if (row.kind === "expiring") actions.push(`<button class="btn" type="button" data-act="extend" data-id="${esc(row.id)}">הארך בשבוע</button>`);
  if (row.kind === "expired") actions.push(`<button class="btn" type="button" data-act="restore" data-id="${esc(row.id)}">החזר לפלייליסט</button>`);
  if (row.kind === "failed") {
    actions.push(`<button class="btn" type="button" data-act="retry" data-id="${esc(row.id)}">נסה שוב</button>`);
    if (row.rec?.errorCode === "auth") actions.push(`<button class="btn" type="button" data-act="nav" data-path="/settings">עדכן מפתח</button>`);
    if (row.rec?.errorCode === "storage") actions.push(`<button class="btn" type="button" data-act="nav" data-path="/air">פתח פריטים שפגו</button>`);
  }
  return `<article class="air-card"><div class="spread"><h3>${esc(row.title)}</h3><span class="tiny">${esc(kindLabel(row.kind))}</span></div><p>${esc(row.text)}</p><div class="row">${actions.join("")}</div></article>`;
}
function kindLabel(kind) {
  return { queued: "בתור להעלאה", uploading: "בהעלאה", active: "בפלייליסט פעיל", expiring: "יפוג בקרוב", expired: "פג", failed: "נכשל" }[kind] || kind;
}
function renderBulletinCard() {
  const b = state.bulletin || {};
  const active = b.active;
  const hour = b.hour || {};
  const paused = isPaused();
  let stateLine = "פעיל · עולה אוטומטית כל שעה לפלייליסט ״מבזק שעתי״";
  if (paused) stateLine = "מושהה";
  else if (b.note === "failed") stateLine = `מהדורת ${b.failure?.label || hour.label || ""} נכשלה בהעלאה`;
  else if (b.sourcePending) stateLine = b.sourceMessage || "כיכר עדיין לא פרסמו את המהדורה. נמשיך לבדוק.";
  const last = active?.uploadedAt ? `בשידור: מהדורת ${active.label} · עלתה ב־${formatTime(active.uploadedAt)} · ${formatDuration(active.durationSec)}` : "עדיין אין מבזק שעלה מהמערכת";
  const nextLabel = nextHourLabel();
  const history = hourDots();
  return `<article class="panel stack" id="bulletin-card">
    <div class="spread"><h2>מבזק חדשות שעתי</h2><button class="switch" type="button" role="switch" aria-pressed="${paused ? "false" : "true"}" data-act="bulletin-switch" aria-label="העלאה אוטומטית"><i></i></button></div>
    <p>${esc(stateLine)}</p>
    <p>${esc(last)}</p>
    ${active?.mediaUrl ? `<button class="btn" type="button" data-act="play-url" data-url="${esc(active.mediaUrl)}" data-id="bulletin">נגן תצוגה מקדימה</button>` : ""}
    <p class="tiny">הבא: מהדורת ${esc(nextLabel)} · צפויה כמה דקות אחרי השעה העגולה</p>
    ${b.alert ? `<div class="err-inline" role="alert">${esc(b.alert)}</div>` : ""}
    ${b.note === "failed" ? `<div class="err-inline" role="alert">${esc(ERROR_TEXT[b.failure?.code] || b.failure?.message || ERROR_TEXT.unknown)} <button class="btn" type="button" data-act="retry-bulletin">נסה שוב</button></div>` : ""}
    ${state.ui.pauseChooser ? renderPauseChooser() : ""}
    <div class="hours" aria-label="12 השעות האחרונות">${history.map((dot) => `<button class="hour ${esc(dot.cls)}" type="button" aria-label="${esc(dot.label)}">${esc(dot.mark)}</button>`).join("")}</div>
  </article>`;
}
function nextHourLabel() {
  const p = jerusalemParts(new Date());
  const hour = (p.hour + 1) % 24;
  return `${String(hour).padStart(2, "0")}:00`;
}
function hourDots() {
  const now = new Date();
  const dots = [];
  for (let i = 11; i >= 0; i--) {
    const t = new Date(now.getTime() - i * 3600000);
    const edition = currentHourEdition(t);
    const row = (state.bulletin.history || []).find((item) => item.label === edition.label && item.editionStart && Math.abs(new Date(item.editionStart) - edition.start) < 120000);
    let cls = "";
    let mark = edition.label.slice(0, 2);
    let label = `${edition.label} אין דיווח`;
    if (row?.uploadedAt && !row.failed) {
      cls = "ok";
      mark = "✓";
      label = `${edition.label} עלתה ב־${formatTime(row.uploadedAt)}`;
    } else if (row?.failed) {
      cls = "bad";
      mark = "✕";
      label = `${edition.label} נכשלה`;
    } else if (isPaused()) {
      cls = "pause";
      mark = "⏸";
      label = `${edition.label} מושהה`;
    }
    dots.push({ cls, mark, label });
  }
  return dots;
}
function renderPauseChooser() {
  return `<fieldset class="stack"><legend>השהיית מבזקים</legend>
    <button class="btn" type="button" data-act="pause-for" data-mode="hour">השהה לשעה</button>
    <button class="btn" type="button" data-act="pause-for" data-mode="morning">עד מחר בבוקר</button>
    <button class="btn" type="button" data-act="pause-for" data-mode="manual">עד שאחדש</button>
    <label class="toggle"><input id="remove-current" type="checkbox"> הסר את המבזק הנוכחי מהשידור</label>
  </fieldset>`;
}
function isPaused() {
  if (!state.control?.paused) return false;
  if (!state.control.pauseUntil || state.control.pauseMode === "manual") return true;
  return new Date(state.control.pauseUntil).getTime() > Date.now();
}

function renderPlaylists() {
  const ids = knownIds();
  const managed = (state.playlists || []).filter((pl) => radio.canTouch(pl, ids));
  const fallback = Object.values(state.system.playlists || {}).filter((row) => row?.name);
  const rows = managed.length ? managed : fallback.map((row) => ({ ...row, is_enabled: true, schedule_items: [], offline: true }));
  return `<section class="stack"><div class="spread"><h1>פלייליסטים</h1></div>
    <p class="tiny">מוצגים רק פלייליסטים שנוצרו על ידי המערכת. הפלייליסט <bdi>election</bdi> לא מופיע כאן ולא משתנה.</p>
    ${rows.length ? rows.map((pl, index) => `<article class="plist" data-pid="${esc(pl.id || "")}">
      <div class="plist-main"><h3>${esc(pl.name)}</h3><p class="tiny">${esc(scheduleLine(pl))}</p>${pl.offline ? `<p class="tiny">הפרטים המלאים יופיעו אחרי חיבור לרדיו</p>` : ""}</div>
      <button class="btn" type="button" data-act="move" data-id="${esc(pl.id || "")}" data-dir="-1" aria-label="הזז למעלה" ${index === 0 ? "disabled" : ""}>למעלה</button>
      <button class="btn" type="button" data-act="move" data-id="${esc(pl.id || "")}" data-dir="1" aria-label="הזז למטה" ${index === rows.length - 1 ? "disabled" : ""}>למטה</button>
      <button class="switch" type="button" role="switch" aria-pressed="${pl.is_enabled !== false ? "true" : "false"}" data-act="toggle-playlist" data-id="${esc(pl.id || "")}" aria-label="הפעלה של ${esc(pl.name)}" ${pl.id ? "" : "disabled"}><i></i></button>
      <button class="handle" type="button" data-act="drag" data-id="${esc(pl.id || "")}" aria-label="גרירה לשינוי סדר">↕</button>
    </article>`).join("") : `<div class="notice"><h2>עדיין אין פלייליסטים של המערכת</h2><p>הם נוצרים בהעלאה הראשונה.</p></div>`}
  </section>`;
}
function scheduleLine(pl) {
  const items = pl.schedule_items || [];
  if (!items.length) {
    if (pl.type === "once_per_hour") return `מתנגן: פעם בשעה, בדקה ${pl.play_per_hour_minute ?? 0}`;
    if (pl.type === "once_per_x_songs") return `מתנגן: כל ${pl.play_per_songs || 0} שירים`;
    if (pl.type === "once_per_x_minutes") return `מתנגן: כל ${pl.play_per_minutes || 0} דקות`;
    return "מתנגן: בכל שעות היממה";
  }
  return `מתנגן: ${items.map((item) => `${daySpan(item.days || [])}, ${codeClock(item.start_time)}–${codeClock(item.end_time)}`).join(" · ")}`;
}
function codeClock(code) {
  const n = Number(code) || 0;
  return `${String(Math.floor(n / 100)).padStart(2, "0")}:${String(n % 100).padStart(2, "0")}`;
}
function daySpan(days) {
  if (!days.length || days.length === 7) return "כל השבוע";
  const js = days.map((day) => (day === 7 ? 0 : day)).sort();
  return js.map((day) => DAY_LETTERS[day]).join(" ");
}

function renderRules() {
  const editing = state.ui.ruleEdit;
  return `<section class="stack"><div class="spread"><h1>כללים</h1><button class="btn primary" type="button" data-act="rule-new">כלל חדש</button></div>
    <article class="rule locked"><h2>כלל מערכת</h2><p>כשמתפרסם מבזק חדשות שעתי → העלה אוטומטית → הוסף לפלייליסט ״מבזק שעתי״ → למשך 60 דקות מהשעה העגולה. אי אפשר למחוק או לערוך את הכלל. הפלייליסט נקבע אוטומטית.</p>
      <label class="toggle"><span>העלאה אוטומטית</span><button class="switch" type="button" role="switch" aria-pressed="${isPaused() ? "false" : "true"}" data-act="bulletin-switch"><i></i></button></label>
    </article>
    ${(state.rules.rules || []).length ? state.rules.rules.map(renderRule).join("") : `<div class="notice"><h2>עדיין אין כללים</h2><p>כלל מאשר פרקים חדשים מסדרה בלי שתצטרך לעשות כלום.</p><button class="btn primary" type="button" data-act="rule-new">צור כלל ראשון</button></div>`}
    ${editing ? renderRuleForm(editing) : ""}
  </section>`;
}
function renderRule(rule) {
  const name = seriesName(rule.seriesSlug);
  const when = rule.updatedAt ? formatShortDate(rule.updatedAt) : "—";
  return `<article class="rule stack"><div class="spread"><p>כשיוצא פרק חדש ב־${esc(name)} → ${rule.action === "auto" ? "אשר אוטומטית" : "הצע לי לאישור"} → הוסף ל־${esc(playlistShort(rule.playlistKey))} → למשך ${esc(windowName(rule.window))}${rule.replacePrevious ? " → והחלף את הפרק הקודם" : ""}</p>
    <button class="switch" type="button" role="switch" aria-pressed="${rule.enabled ? "true" : "false"}" data-act="rule-toggle" data-id="${esc(rule.id)}" aria-label="הפעלת הכלל"><i></i></button></div>
    <p class="tiny">עודכן: ${esc(when)}</p>
    <div class="row"><button class="btn" type="button" data-act="rule-edit" data-id="${esc(rule.id)}">עריכה</button><button class="btn danger" type="button" data-act="rule-delete" data-id="${esc(rule.id)}">מחק</button></div></article>`;
}
function seriesName(slug) {
  return state.catalog.items.find((item) => item.seriesSlug === slug)?.seriesName || slug;
}
function renderRuleForm(rule) {
  const series = [...new Map((state.catalog.items || []).map((item) => [item.seriesSlug, item.seriesName])).entries()];
  const monthAgo = Date.now() - 30 * 86400000;
  const matches = (state.catalog.items || []).filter((item) => item.seriesSlug === rule.seriesSlug && new Date(item.pubDate).getTime() >= monthAgo);
  const conflict = (state.rules.rules || []).find((other) => other.id !== rule.id && other.seriesSlug === rule.seriesSlug && other.enabled);
  return `<form class="panel stack" data-act="rule-form">
    <h2>${rule.id ? "עריכת כלל" : "כלל חדש"}</h2>
    <p>כשיוצא פרק חדש ב־${selectHtml("seriesSlug", series.map(([slug, name]) => [slug, name]), rule.seriesSlug)} → ${selectHtml("action", [["auto", "אשר אוטומטית"], ["suggest", "הצע לי לאישור"]], rule.action || "auto")} → הוסף ל־${selectHtml("playlistKey", [["briefs", "מבזקים"], ["music", "מוזיקה"]], rule.playlistKey || "briefs")} → למשך ${selectHtml("window", WINDOWS, rule.window || "week")}</p>
    <label class="toggle"><input name="replacePrevious" type="checkbox" ${rule.replacePrevious ? "checked" : ""}> החלף את הפרק הקודם</label>
    <p class="tiny">הפרק הקודם מהסדרה יוסר מהפלייליסט כשהחדש יעלה. הקובץ נשמר.</p>
    <p>${matches.length ? `בחודש האחרון הכלל היה תופס ${matches.length} פרקים` : "הכלל לא היה תופס אף פרק בחודש האחרון. כדאי לבדוק את הסדרה."}</p>
    <ul>${matches.slice(0, 5).map((item) => `<li>${esc(item.title)}</li>`).join("")}</ul>
    ${conflict ? `<div class="warn-inline">לסדרה הזו כבר יש כלל. <button class="btn" type="button" data-act="rule-edit" data-id="${esc(conflict.id)}">ערוך אותו</button></div>` : ""}
    <div class="row"><button class="btn primary" type="button" data-act="rule-save" data-enabled="1">שמור והפעל</button><button class="btn" type="button" data-act="rule-save" data-enabled="0">שמור כמושבת</button></div>
    ${waitingCount(rule) ? `<button class="btn" type="button" data-act="rule-apply-waiting">החל גם על ${waitingCount(rule)} פריטים שממתינים</button>` : ""}
  </form>`;
}
function selectHtml(name, options, current) {
  return `<select name="${esc(name)}" aria-label="${esc(name)}">${options.map(([value, label]) => `<option value="${esc(value)}" ${value === current ? "selected" : ""}>${esc(label)}</option>`).join("")}</select>`;
}
function waitingCount(rule) {
  if (!rule?.seriesSlug) return 0;
  return (state.catalog.items || []).filter((item) => item.seriesSlug === rule.seriesSlug && statusOf(item) === "new").length;
}

function renderAds() {
  const tab = state.route.q.get("tab") || "campaigns";
  return `<section class="stack">
    <h1>פרסומות, ג׳ינגלים ומעברונים</h1>
    <div class="seg">${seg("tab", [["campaigns", "קמפיינים"], ["jingles", "ג׳ינגלים"], ["sweepers", "סוויפרים"]], tab)}</div>
    ${tab === "campaigns" ? renderCampaigns() : renderGroup(tab === "jingles" ? "jingles" : "sweepers")}
    ${tab === "campaigns" && state.route.q.get("new") !== "1" ? `<button class="fab" type="button" data-act="campaign-new">+ קמפיין חדש</button>` : ""}
    ${state.route.q.get("new") === "1" ? renderCampaignWizard() : ""}
  </section>`;
}
function campaignPhase(campaign) {
  const today = todayKey();
  if (campaign.draft) return "draft";
  if (today > campaign.endDate) return "ended";
  if (campaign.paused) return "paused";
  if (today < campaign.startDate) return "scheduled";
  return "active";
}
function renderCampaigns() {
  const groups = [
    ["active", "פעיל"],
    ["scheduled", "מתוזמן"],
    ["paused", "מושהה"],
    ["ended", "הסתיים"],
    ["draft", "טיוטות"],
  ];
  const campaigns = state.ads.campaigns || [];
  if (!campaigns.length && !state.ui.draft) {
    return `<div class="notice"><h2>עדיין אין קמפיינים</h2><p>קמפיין משמיע פרסומת בתדירות או בשעות שתבחר, ונכבה לבד בסוף.</p><button class="btn primary" type="button" data-act="campaign-new">צור קמפיין ראשון</button></div>`;
  }
  return groups.map(([key, label]) => {
    const rows = campaigns.filter((campaign) => campaignPhase(campaign) === key);
    if (!rows.length) return "";
    const body = rows.map(renderCampaign).join("");
    if (key === "ended") return `<details><summary>${label} (${rows.length})</summary>${body}</details>`;
    return `<section class="stack"><h2>${label}</h2>${body}</section>`;
  }).join("");
}
function renderCampaign(campaign) {
  const phase = campaignPhase(campaign);
  const left = daysUntil(endOfJerusalemDay(`${campaign.endDate}T12:00:00Z`), new Date());
  let status = "פעיל";
  if (phase === "active") status = left < 2 ? `פעיל · נגמר בעוד ${Math.max(left, 0)} ימים` : `פעיל · נגמר בעוד ${left} ימים`;
  if (phase === "scheduled") status = `מתחיל ב־${formatDayMonth(campaign.startDate)}`;
  if (phase === "paused") status = `מושהה · הקמפיין מסתיים ב־${formatShortDate(campaign.endDate)} גם בהשהיה`;
  if (phase === "ended") status = `הסתיים ב־${formatShortDate(campaign.endDate)} · כובה אוטומטית`;
  const schedule = scheduleSummary(campaign);
  return `<article class="campaign stack"><div class="spread"><h3>${esc(campaign.name)}</h3><span class="tiny">${esc(status)}</span></div>
    <p class="tiny"><bdi>${esc(campaign.startDate)}</bdi> – <bdi>${esc(campaign.endDate)}</bdi></p>
    <p>${esc(schedule)}</p>
    ${campaign.client ? `<p class="tiny">${esc(campaign.client)}</p>` : ""}
    ${campaign.playCount != null ? `<p class="tiny">נוגן ${campaign.playCount} פעמים</p>` : ""}
    ${campaign.uploadError ? `<div class="err-inline" role="alert">הקובץ לא עלה לשרת. הקמפיין לא משודר. <button class="btn" type="button" data-act="campaign-retry" data-id="${esc(campaign.id)}">נסה שוב</button></div>` : ""}
    <div class="row">
      <button class="btn" type="button" data-act="play-url" data-url="${esc(campaign.files?.[0]?.previewUrl || "")}" ${campaign.files?.[0]?.previewUrl ? "" : "disabled"}>נגן</button>
      <button class="switch" type="button" role="switch" aria-pressed="${campaign.paused ? "false" : "true"}" data-act="campaign-pause" data-id="${esc(campaign.id)}" aria-label="השהיית הקמפיין"><i></i></button>
      <button class="icon-btn" type="button" data-act="campaign-menu" data-id="${esc(campaign.id)}" aria-label="פעולות">${icon("more")}</button>
      ${phase === "active" && left < 2 ? `<button class="btn" type="button" data-act="campaign-extend" data-id="${esc(campaign.id)}">הארך</button>` : ""}
      ${phase === "ended" ? `<button class="btn" type="button" data-act="campaign-duplicate" data-id="${esc(campaign.id)}">שכפל</button><button class="btn" type="button" data-act="campaign-extend" data-id="${esc(campaign.id)}">הארך</button>` : ""}
    </div>
    ${state.ui.menuFor === campaign.id ? `<div class="row"><button class="btn" type="button" data-act="campaign-edit" data-id="${esc(campaign.id)}">ערוך</button><button class="btn" type="button" data-act="campaign-duplicate" data-id="${esc(campaign.id)}">שכפל</button><button class="btn" type="button" data-act="campaign-pause" data-id="${esc(campaign.id)}">${campaign.paused ? "חדש" : "השהה"}</button><button class="btn danger" type="button" data-act="campaign-delete" data-id="${esc(campaign.id)}">מחק</button></div>` : ""}
  </article>`;
}
function scheduleSummary(campaign) {
  const parts = [];
  if (campaign.frequencyEvery) parts.push(campaign.frequencyMode === "minutes" ? `כל ${campaign.frequencyEvery} דקות` : `כל ${campaign.frequencyEvery} שירים`);
  if (campaign.fixedTimes?.length) parts.push(`וגם ב־${campaign.fixedTimes.join(", ")}`);
  return parts.join(" · ") || "בלי תזמון";
}
function renderCampaignWizard() {
  const draft = state.ui.draft || blankDraft();
  const step = state.ui.adStep;
  const errors = validateDraft(draft, step, false);
  return `<form class="wizard stack" id="campaign-form">
    <p class="tiny">שלב ${step} מתוך 4</p>
    <div class="wizard-steps">${[1, 2, 3, 4].map((n) => `<span class="${n <= step ? "on" : ""}"></span>`).join("")}</div>
    ${errors.length ? `<div class="summary-errors" role="alert"><strong>יש לתקן:</strong><ul>${errors.map((err) => `<li><a href="#${esc(err.id)}">${esc(err.text)}</a></li>`).join("")}</ul></div>` : ""}
    ${step === 1 ? `<h2>קובץ</h2><div class="drop"><p>גרור לכאן או בחר קובץ</p><input id="ad-file" type="file" accept=".mp3,.wav,.m4a,.aac,.ogg,.flac,audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/ogg,audio/flac"></div>
      <p class="tiny" aria-live="polite">${state.ui.uploadProgress != null ? `מעלה קובץ… ${Math.round(state.ui.uploadProgress * 100)}%` : ""}</p>
      ${(draft.files || []).map((file) => `<p>${esc(file.name)} · ${esc(formatDuration(file.durationSec))}${file.durationSec > 60 ? " · פרסומת ארוכה (מעל 60 שניות)" : ""}</p>`).join("")}
      <label class="field">שם הקמפיין<input id="ad-name" name="name" value="${esc(draft.name || "")}" required></label>
      <label class="field">לקוח (לא חובה)<input id="ad-client" name="client" value="${esc(draft.client || "")}"></label>` : ""}
    ${step === 2 ? `<h2>תאריכים</h2><div class="chips">${[["0", "מהיום"], ["7", "שבוע"], ["14", "שבועיים"], ["30", "חודש"]].map(([days, label]) => `<button class="chip" type="button" data-act="ad-span" data-days="${days}">${label}</button>`).join("")}</div>
      <label class="field">התחלה<input id="ad-start" name="startDate" type="date" value="${esc(draft.startDate || todayKey())}" required></label>
      <label class="field">סיום<input id="ad-end" name="endDate" type="date" value="${esc(draft.endDate || "")}" required></label>
      <p>${draft.endDate ? `${Math.max(0, daysBetween(draft.startDate, draft.endDate))} ימים · נכבה אוטומטית ב־${esc(formatDayMonth(draft.endDate))} ב־23:59` : "צריך תאריך סיום"}</p>` : ""}
    ${step === 3 ? `<h2>תזמון</h2>
      <fieldset><legend>תדירות</legend>
        <label class="toggle"><input id="freq-on" type="checkbox" ${draft.frequencyEvery ? "checked" : ""}> לפי תדירות</label>
        <div class="row"><button class="btn" type="button" data-act="stepper" data-dir="-1" aria-label="פחות">−</button><output id="freq-val">${esc(draft.frequencyEvery || 4)}</output><button class="btn" type="button" data-act="stepper" data-dir="1" aria-label="יותר">+</button>
          <select id="freq-mode"><option value="songs" ${draft.frequencyMode !== "minutes" ? "selected" : ""}>שירים</option><option value="minutes" ${draft.frequencyMode === "minutes" ? "selected" : ""}>דקות</option></select></div>
        ${(draft.frequencyEvery || 4) <= 1 ? `<p class="warn-inline">כל שיר זו תדירות גבוהה מאוד.</p>` : ""}
      </fieldset>
      <fieldset><legend>שעות קבועות</legend>
        <div class="row"><label class="sr" for="fixed-time">שעה</label><input id="fixed-time" type="time"><button class="btn" type="button" data-act="add-time">הוסף שעה</button></div>
        <div class="chips">${(draft.fixedTimes || []).map((time) => `<button class="chip" type="button" data-act="remove-time" data-time="${esc(time)}" aria-pressed="true"><bdi>${esc(time)}</bdi></button>`).join("")}</div>
        <div class="chips">${DAY_LETTERS.map((letter, index) => `<button class="chip" type="button" data-act="toggle-day" data-day="${index}" aria-pressed="${(draft.days || []).includes(index) ? "true" : "false"}">${letter}</button>`).join("")}</div>
        <div class="row"><button class="btn" type="button" data-act="days-preset" data-preset="sun-thu">א׳–ה׳</button><button class="btn" type="button" data-act="days-preset" data-preset="all">כל השבוע</button></div>
        ${conflictNotes(draft)}
      </fieldset>` : ""}
    ${step === 4 ? `<h2>סיכום</h2><p>${esc(draftSentence(draft))}</p>` : ""}
    <div class="row">
      ${step > 1 ? `<button class="btn" type="button" data-act="ad-back">חזרה</button>` : ""}
      ${step < 4 ? `<button class="btn primary" type="button" data-act="ad-next" ${state.ui.uploadProgress != null ? "disabled" : ""}>${state.ui.uploadProgress != null ? "מעלה קובץ…" : "המשך"}</button>` : `<button class="btn primary" type="button" data-act="ad-create">${todayKey() < (draft.startDate || todayKey()) ? "תזמן קמפיין" : "צור קמפיין"}</button>`}
    </div>
  </form>`;
}
function blankDraft() {
  return { id: uid("c"), name: "", client: "", files: [], startDate: todayKey(), endDate: "", frequencyEvery: 4, frequencyMode: "songs", fixedTimes: [], days: [0, 1, 2, 3, 4], paused: false };
}
function validateDraft(draft, step, strict) {
  const errors = [];
  if ((strict || step === 1) && step >= 1 && !(draft.files || []).length) errors.push({ id: "ad-file", text: "צריך קובץ אחד לפחות" });
  if ((strict || step === 1) && step >= 1 && !draft.name) errors.push({ id: "ad-name", text: "צריך שם לקמפיין" });
  if ((strict || step === 2) && step >= 2 && !draft.endDate) errors.push({ id: "ad-end", text: "צריך תאריך סיום" });
  if ((strict || step === 2) && step >= 2 && draft.endDate && draft.startDate && draft.endDate < draft.startDate) errors.push({ id: "ad-end", text: "תאריך הסיום לפני ההתחלה" });
  if ((strict || step === 3) && step >= 3 && !draft.frequencyEvery && !(draft.fixedTimes || []).length) errors.push({ id: "fixed-time", text: "צריך תדירות או שעה קבועה" });
  if ((strict || step === 3) && step >= 3 && !(draft.days || []).length) errors.push({ id: "fixed-time", text: "צריך לבחור ימים" });
  return strict || step === state.ui.adStep ? errors : [];
}
function daysBetween(start, end) {
  if (!start || !end) return 0;
  return Math.round((new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000);
}
function draftSentence(draft) {
  return `${draft.name || "קמפיין"} ישודר ${scheduleSummary(draft)} בין ${draft.startDate || ""} ל־${draft.endDate || ""}, ויכבה לבד בסוף.`;
}
function conflictNotes(draft) {
  const notes = [];
  for (const time of draft.fixedTimes || []) if (time.endsWith(":00")) notes.push(`${time} מתנגש עם המבזק השעתי`);
  for (const other of state.ads.campaigns || []) {
    if (other.id === draft.id || campaignPhase(other) === "ended") continue;
    const overlap = (draft.fixedTimes || []).filter((time) => (other.fixedTimes || []).includes(time));
    if (overlap.length && rangesOverlap(draft, other)) notes.push(`השעות ${overlap.join(", ")} כבר בשימוש בקמפיין ${other.name}`);
  }
  return notes.map((note) => `<p class="warn-inline">${esc(note)}</p>`).join("");
}
function rangesOverlap(a, b) {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}
function readDraftFromForm(draft) {
  const form = $("#campaign-form");
  if (!form) return draft;
  const data = new FormData(form);
  if (data.get("name") != null) draft.name = String(data.get("name") || "");
  if (data.get("client") != null) draft.client = String(data.get("client") || "");
  if (data.get("startDate")) draft.startDate = String(data.get("startDate"));
  if (data.get("endDate")) draft.endDate = String(data.get("endDate"));
  const freq = $("#freq-on");
  if (freq) {
    draft.frequencyEvery = freq.checked ? Number($("#freq-val")?.textContent || draft.frequencyEvery || 4) : 0;
    draft.frequencyMode = $("#freq-mode")?.value || "songs";
  }
  return draft;
}
function renderGroup(key) {
  const group = state.ads[key] || { everySongs: 4, enabled: true, files: [] };
  const label = key === "jingles" ? "ג׳ינגל" : "מעברון";
  const files = group.files || [];
  return `<section class="stack">
    <article class="panel stack"><h2>השמע ${label} כל <bdi id="group-every">${group.everySongs || 4}</bdi> שירים</h2>
      <div class="row"><button class="btn" type="button" data-act="group-every" data-group="${key}" data-dir="-1" aria-label="פחות">−</button><button class="btn" type="button" data-act="group-every" data-group="${key}" data-dir="1" aria-label="יותר">+</button>
        <button class="switch" type="button" role="switch" aria-pressed="${group.enabled !== false ? "true" : "false"}" data-act="group-master" data-group="${key}" aria-label="מתג ראשי"><i></i></button></div>
    </article>
    ${files.length ? files.map((file) => `<article class="jingle-row"><div class="spread"><div><h3>${esc(file.name)}</h3><p class="tiny">${esc(formatDuration(file.durationSec))}</p></div><button class="switch" type="button" role="switch" aria-pressed="${file.enabled !== false ? "true" : "false"}" data-act="group-file" data-group="${key}" data-mid="${esc(file.mediaId)}" aria-label="הפעלת הקובץ"><i></i></button></div></article>`).join("") : `<div class="notice"><h2>עדיין אין ${key === "jingles" ? "ג׳ינגלים" : "מעברונים"}</h2><p>העלאה מהמכשיר נכנסת ישר לשרת הרדיו.</p></div>`}
    ${files.length && files.every((file) => file.enabled === false) ? `<p class="warn-inline">כל הקבצים כבויים, אז שום דבר מהקבוצה לא ישודר.</p>` : ""}
    <label class="btn">העלאת קבצים<input class="sr" type="file" multiple accept=".mp3,.wav,.m4a,.aac,.ogg,.flac,audio/*" data-act="group-upload" data-group="${key}"></label>
  </section>`;
}

function renderSettings() {
  return `<section class="wizard stack"><h1>הגדרות</h1>
    <p>מחובר לרדיו: ${state.settings.azuraKey ? "מפתח שמור במכשיר" : "אין מפתח"}</p>
    <label class="field">כתובת<input id="station-url" dir="ltr" value="${esc(state.settings.stationUrl)}"></label>
    <label class="field">מפתח API חדש (השאר ריק כדי לא להחליף)<input id="azura-key" type="password" dir="ltr" autocomplete="off"></label>
    <label class="field">טוקן GitHub חדש<input id="github-token" type="password" dir="ltr" autocomplete="off"></label>
    <p class="tiny">המפתחות נשמרים רק בדפדפן הזה, במכשיר הזה.</p>
    <p class="tiny">פלייליסט המבזק: ${esc(PLAYLISTS.bulletin.name)}. אי אפשר להפנות אותו לפלייליסט election.</p>
    <div class="row"><button class="btn" type="button" data-act="check-radio">בדוק רדיו</button><button class="btn" type="button" data-act="check-github">בדוק GitHub</button><button class="btn" type="button" data-act="save-settings">שמור</button></div>
    <p>${esc(state.ui.setupMsg[1] || "")} ${esc(state.ui.setupMsg[2] || "")}</p>
    <button class="btn danger" type="button" data-act="disconnect">נתק ומחק מפתחות</button>
    <button class="btn" type="button" data-act="nav" data-path="/log">יומן ריצות</button>
  </section>`;
}
function renderLog() {
  const runs = state.runs.runs || [];
  return `<section class="stack"><h1>יומן ריצות</h1>
    ${runs.length ? runs.map((run) => `<article class="air-card"><div class="spread"><h3>${esc(run.kind || "העלאה")}</h3><span class="tiny">${esc(run.finishedAt ? formatTime(run.finishedAt) : "")}</span></div><p>${run.ok ? "הצליחה" : "הסתיימה עם שגיאות"} · עלו ${run.uploaded || 0} · נכשלו ${run.failed || 0} · הוסרו ${run.removed || 0}</p>${run.runUrl ? `<a href="${esc(run.runUrl)}">ריצה ב־GitHub</a>` : ""}</article>`).join("") : `<p class="muted">עדיין אין ריצות שנשמרו.</p>`}
    <article class="air-card"><h3>מבזק</h3><p class="tiny">בדיקה אחרונה: ${esc(state.bulletin.lastCheck ? formatTime(state.bulletin.lastCheck) : "—")}</p></article>
  </section>`;
}

function renderSheet() {
  const root = $("#sheet-root");
  if (state.ui.help) {
    root.innerHTML = dialog(`<h2>קיצורי מקלדת</h2><ul>
      <li>↓ או J / ↑ או K — פריט הבא / הקודם</li><li>A אשר · S דלג · E חלון · רווח נגן</li>
      <li>X בחירה · Shift+A / Shift+S על המסומנים</li><li>Ctrl או ⌘ ו־Z ביטול · U העלה עכשיו</li>
      <li>/ חיפוש · 1–5 מעבר מסך · ? העזרה הזו</li></ul><button class="btn" type="button" data-act="close-sheet">סגור</button>`);
    focusDialog();
    return;
  }
  const sheet = state.ui.sheet;
  if (!sheet) {
    root.innerHTML = "";
    return;
  }
  const ids = sheet.ids || [];
  const multi = ids.length > 1;
  const item = itemById(ids[0]);
  const defs = item ? defaultsFor(item) : { playlistKey: "briefs", window: "week", replacePrevious: false };
  root.innerHTML = dialog(`<div class="grab"></div><h2>${multi ? `עריכת ${ids.length} פריטים` : esc(item?.title || "")}</h2>
    <form id="sheet-form" class="stack">
      <fieldset><legend>פלייליסט</legend><div class="choices">
        ${multi ? `<label class="choice"><input type="radio" name="playlistKey" value="" checked> ללא שינוי</label>` : ""}
        ${[["briefs", "מבזקים"], ["music", "מוזיקה"]].map(([key, label]) => `<label class="choice"><input type="radio" name="playlistKey" value="${key}" ${!multi && defs.playlistKey === key ? "checked" : ""}> ${label}</label>`).join("")}
      </div></fieldset>
      <fieldset><legend>חלון שידור</legend><div class="chips">
        ${multi ? `<label class="chip"><input type="radio" name="window" value="" checked> ללא שינוי</label>` : ""}
        ${WINDOWS.map(([key, label]) => `<label class="chip"><input type="radio" name="window" value="${key}" ${!multi && defs.window === key ? "checked" : ""}> ${label}</label>`).join("")}
        <label class="chip"><input type="radio" name="window" value="custom"> תאריך מותאם</label>
      </div><label class="field">תאריך סיום<input name="customEnd" type="date"></label>
      <p id="window-end" class="tiny"></p></fieldset>
      <label class="toggle"><input name="replacePrevious" type="checkbox" ${!multi && defs.replacePrevious ? "checked" : ""}> החלף את הפרק הקודם בסדרה</label>
      <fieldset><legend>העלאה</legend>
        <label class="choice"><input type="radio" name="when" value="next" checked> בהעלאה הבאה (${esc(uploadTimingText())})</label>
        <label class="choice"><input type="radio" name="when" value="now"> העלה עכשיו</label>
      </fieldset>
      <button class="btn primary" type="button" data-act="sheet-save">אשר והוסף לתור</button>
    </form>`);
  updateWindowHint();
  focusDialog();
}
function dialog(inner) {
  return `<div class="sheet-backdrop" data-act="sheet-scrim"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title"><div id="sheet-title" class="sr">חלון</div>${inner}</div></div>`;
}
function focusDialog() {
  const dialogNode = document.querySelector(".sheet");
  const focusable = dialogNode?.querySelector("button, input, select, textarea");
  focusable?.focus();
}
function updateWindowHint() {
  const form = $("#sheet-form");
  const node = $("#window-end");
  if (!form || !node) return;
  const kind = new FormData(form).get("window") || "week";
  if (!kind) {
    node.textContent = "ללא שינוי";
    return;
  }
  const end = windowEnd(String(kind), new Date(), new FormData(form).get("customEnd"));
  node.textContent = `בפלייליסט עד ${formatDayMonth(end)}`;
}

function onClick(event) {
  const button = event.target.closest("[data-act]");
  if (!button) return;
  const act = button.dataset.act;
  if (act === "sheet-scrim" && event.target !== button) return;
  const id = button.dataset.id;
  const item = id ? itemById(id) : null;
  if (act === "nav") {
    state.ui.menu = false;
    go(button.dataset.path, button.dataset.path === "/inbox" ? { tab: "vod", range: "week", status: "new" } : {});
  } else if (act === "menu") {
    state.ui.menu = !state.ui.menu;
    renderNav();
  } else if (act === "q") mergeQuery({ [button.dataset.key]: button.dataset.value });
  else if (act === "series") toggleSeries(button.dataset.slug);
  else if (act === "series-all") mergeQuery({ series: "" });
  else if (act === "series-menu") approveSeries(button.dataset.slug);
  else if (act === "approve" && item) approveItem(item);
  else if (act === "skip" && item) skipItem(item);
  else if (act === "more" && item) state.ui.sheet = { ids: [item.id] };
  else if (act === "expand") button.querySelector(".teaser")?.classList.toggle("open");
  else if (act === "play" && item) togglePlay(item.mediaUrl, item.id);
  else if (act === "play-url") togglePlay(button.dataset.url, button.dataset.id || "url");
  else if (act === "bulk-start") state.ui.bulk = true;
  else if (act === "bulk-exit") {
    state.ui.bulk = false;
    state.ui.selected.clear();
  } else if (act === "toggle-select") toggleSelected(id);
  else if (act === "select-all") filteredItems().forEach((row) => state.ui.selected.add(row.id));
  else if (act === "bulk-approve") bulkApply("approve");
  else if (act === "bulk-skip") bulkApply("skip");
  else if (act === "bulk-edit") state.ui.sheet = { ids: [...state.ui.selected] };
  else if (act === "skip-old") skipOlder(Number(button.dataset.days));
  else if (act === "undo") undo();
  else if (act === "undo-change") {
    const last = [...state.ui.undo].reverse().find((entry) => entry.changeId);
    if (last) state.ui.sheet = { ids: [last.changeId] };
  } else if (act === "close-sheet" || act === "sheet-scrim") {
    state.ui.sheet = null;
    state.ui.help = false;
  } else if (act === "sheet-save") saveSheet();
  else if (act === "upload-all") dispatchUpload("");
  else if (act === "upload-one") uploadOne(id);
  else if (act === "unqueue") unqueue(id);
  else if (act === "extend") extend(id);
  else if (act === "restore") restore(id);
  else if (act === "retry") retry(id);
  else if (act === "pipeline") go("/air", button.dataset.filter ? { focus: button.dataset.filter } : {});
  else if (act === "goto-air") go("/air");
  else if (act === "goto-bulletin") {
    go("/air");
    setTimeout(() => $("#bulletin-card")?.scrollIntoView({ block: "start" }), 30);
  } else if (act === "reload") loadAll();
  else if (act === "clear-filter") go("/inbox", { tab: state.route.q.get("tab") || "vod", range: "week", status: "new" });
  else if (act === "help") {
    state.ui.help = true;
    state.ui.menu = false;
  } else if (act === "check-radio") checkRadio();
  else if (act === "check-github") checkGithub();
  else if (act === "setup-back") state.ui.setupStep = 1;
  else if (act === "setup-skip" || act === "setup-finish") finishSetup();
  else if (act === "toggle-secret") {
    const input = document.getElementById(button.dataset.target);
    if (input) input.type = input.type === "password" ? "text" : "password";
    return;
  } else if (act === "save-settings") saveSettingsForm();
  else if (act === "disconnect") disconnect();
  else if (act === "toggle-playlist") togglePlaylist(button.dataset.id);
  else if (act === "move") movePlaylist(button.dataset.id, Number(button.dataset.dir));
  else if (act === "rule-new") state.ui.ruleEdit = { id: "", seriesSlug: state.catalog.items[0]?.seriesSlug || "", action: "auto", playlistKey: "briefs", window: "week", replacePrevious: false, enabled: true };
  else if (act === "rule-edit") state.ui.ruleEdit = { ...(state.rules.rules || []).find((rule) => rule.id === button.dataset.id) };
  else if (act === "rule-toggle") toggleRule(button.dataset.id);
  else if (act === "rule-delete") deleteRule(button.dataset.id);
  else if (act === "rule-save") saveRule(button.dataset.enabled === "1");
  else if (act === "rule-apply-waiting") applyRuleWaiting();
  else if (act === "bulletin-switch") {
    if (isPaused()) resumeBulletin();
    else state.ui.pauseChooser = !state.ui.pauseChooser;
  } else if (act === "pause-for") pauseBulletin(button.dataset.mode);
  else if (act === "resume-bulletin") resumeBulletin();
  else if (act === "retry-bulletin") dispatchBulletin();
  else if (act === "campaign-new") startCampaign();
  else if (act === "ad-next") adNext();
  else if (act === "ad-back") {
    readDraftFromForm(state.ui.draft);
    state.ui.adStep = Math.max(1, state.ui.adStep - 1);
    saveDraft(state.ui.draft);
  } else if (act === "ad-span") setAdSpan(Number(button.dataset.days));
  else if (act === "stepper") stepFrequency(Number(button.dataset.dir));
  else if (act === "add-time") addFixedTime();
  else if (act === "remove-time") {
    state.ui.draft.fixedTimes = (state.ui.draft.fixedTimes || []).filter((time) => time !== button.dataset.time);
    saveDraft(state.ui.draft);
  } else if (act === "toggle-day") toggleDay(Number(button.dataset.day));
  else if (act === "days-preset") {
    state.ui.draft.days = button.dataset.preset === "all" ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4];
    saveDraft(state.ui.draft);
  } else if (act === "ad-create") createCampaign();
  else if (act === "campaign-menu") state.ui.menuFor = state.ui.menuFor === button.dataset.id ? null : button.dataset.id;
  else if (act === "campaign-pause") pauseCampaign(button.dataset.id);
  else if (act === "campaign-delete") deleteCampaign(button.dataset.id);
  else if (act === "campaign-duplicate") duplicateCampaign(button.dataset.id);
  else if (act === "campaign-extend") extendCampaign(button.dataset.id);
  else if (act === "campaign-edit") editCampaign(button.dataset.id);
  else if (act === "group-every") changeGroupEvery(button.dataset.group, Number(button.dataset.dir));
  else if (act === "group-master") toggleGroup(button.dataset.group);
  else if (act === "group-file") toggleGroupFile(button.dataset.group, Number(button.dataset.mid));
  else return;
  if (!["play", "play-url", "toggle-secret", "expand", "scrub"].includes(act)) render();
}
function toggleSeries(slug) {
  const current = new Set((state.route.q.get("series") || "").split(",").filter(Boolean));
  if (current.has(slug)) current.delete(slug);
  else current.add(slug);
  mergeQuery({ series: [...current].join(",") });
}
function approveSeries(slug) {
  const items = filteredItems().filter((item) => item.seriesSlug === slug && statusOf(item) === "new");
  if (!items.length) {
    toast("אין פריטים חדשים בסדרה הזו בסינון הנוכחי");
    return;
  }
  const reverts = items.map((item) => rememberSelection(item.id, selectionRecord(item, {})));
  pushUndo({ kind: "approve", batchNoun: "אושרו", label: `אושרו ${items.length} פריטים מהסדרה`, revert: () => reverts.forEach((fn) => fn()) });
  persistSelections();
}
function bulkApply(kind) {
  const items = [...state.ui.selected].map(itemById).filter(Boolean);
  const reverts = items.map((item) => (kind === "approve" ? rememberSelection(item.id, selectionRecord(item, {})) : skipRecord(item)));
  pushUndo({ kind, batchNoun: kind === "approve" ? "אושרו" : "דולגו", label: `${items.length} פריטים`, revert: () => reverts.forEach((fn) => fn()) });
  persistSelections();
  state.ui.bulk = false;
  state.ui.selected.clear();
}
function skipRecord(item) {
  return rememberSelection(item.id, { status: "skipped", playlistKey: defaultsFor(item).playlistKey, window: "week", updatedAt: new Date().toISOString(), source: "manual" });
}
function toggleSelected(id) {
  if (state.ui.selected.has(id)) state.ui.selected.delete(id);
  else state.ui.selected.add(id);
  state.ui.bulk = true;
}
function skipOlder(days) {
  const cutoff = Date.now() - days * 86400000;
  const items = filteredItems().filter((item) => statusOf(item) === "new" && new Date(item.pubDate).getTime() < cutoff);
  if (!items.length) {
    toast("אין פריטים ישנים בסינון");
    return;
  }
  const reverts = items.map(skipRecord);
  pushUndo({ kind: "skip", batchNoun: "דולגו", label: `דולגו ${items.length} פריטים`, revert: () => reverts.forEach((fn) => fn()) });
  persistSelections();
}
function saveSheet() {
  const form = $("#sheet-form");
  const data = new FormData(form);
  const ids = state.ui.sheet?.ids || [];
  const overrides = {};
  if (data.get("playlistKey")) overrides.playlistKey = String(data.get("playlistKey"));
  if (data.get("window")) overrides.window = String(data.get("window"));
  if (data.get("customEnd")) overrides.customEnd = String(data.get("customEnd"));
  overrides.replacePrevious = data.get("replacePrevious") === "on";
  overrides.uploadNow = data.get("when") === "now";
  const reverts = [];
  for (const id of ids) {
    const item = itemById(id);
    if (!item) continue;
    const prev = state.selections.items[id];
    const base = prev?.status === "approved" ? prev : selectionRecord(item, {});
    const next = { ...base };
    if (overrides.playlistKey) next.playlistKey = overrides.playlistKey;
    if (overrides.window) {
      next.window = overrides.window;
      next.windowEnd = windowEnd(overrides.window, new Date(), overrides.customEnd).toISOString();
    }
    if (form.replacePrevious) next.replacePrevious = overrides.replacePrevious;
    next.uploadNow = overrides.uploadNow;
    next.updatedAt = new Date().toISOString();
    next.status = "approved";
    next.source = "manual";
    reverts.push(rememberSelection(id, next));
    if (overrides.uploadNow) dispatchUpload(id);
  }
  pushUndo({ kind: "approve", batchNoun: "אושרו", label: "הבחירה נשמרה", revert: () => reverts.forEach((fn) => fn()) });
  persistSelections();
  state.ui.sheet = null;
}
function uploadOne(id) {
  const item = itemById(id);
  if (!item) return;
  const current = intentOf(id);
  const next = current ? { ...current, uploadNow: true, retryAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: "approved", source: "manual" } : selectionRecord(item, { uploadNow: true });
  rememberSelection(id, next);
  persistSelections();
  dispatchUpload(id);
}
function unqueue(id) {
  const item = itemById(id);
  if (item) skipItem(item);
}
function extend(id) {
  const item = itemById(id);
  const current = intentOf(id) || (item ? selectionRecord(item, {}) : null);
  if (!current) return;
  const base = new Date(Math.max(Date.now(), new Date(current.windowEnd || Date.now()).getTime()));
  const end = new Date(base.getTime() + 7 * 86400000);
  rememberSelection(id, { ...current, status: "approved", source: "manual", window: "custom", windowEnd: endOfJerusalemDay(end).toISOString(), updatedAt: new Date().toISOString() });
  persistSelections();
  toast("החלון הוארך בשבוע");
}
function restore(id) {
  const item = itemById(id);
  if (!item) return;
  approveItem(item, { window: "week" }, "הוחזר לפלייליסט");
}
function retry(id) {
  const item = itemById(id);
  const current = intentOf(id) || (item ? selectionRecord(item, {}) : null);
  if (!current) return;
  rememberSelection(id, { ...current, status: "approved", source: "manual", uploadNow: true, retryAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  persistSelections();
  dispatchUpload(id);
}

async function checkRadio() {
  const input = $("#azura-key");
  const url = $("#station-url");
  if (input?.value) state.settings.azuraKey = input.value.trim();
  if (url?.value) state.settings.stationUrl = url.value.trim().replace(/\/$/, "");
  try {
    const station = await radio.station();
    state.ui.setupMsg[1] = `מחובר לתחנה: ${station.name || "רדיו כיכר"} ✓`;
    if (state.route.path === "/setup" || !state.settings.setupDone) state.ui.setupStep = 2;
    saveSettings();
  } catch (err) {
    state.ui.setupMsg[1] = err.code === "auth" ? "החיבור נכשל: המפתח לא תקף" : "הכתובת לא נמצאה";
  }
  render();
}
async function checkGithub() {
  const input = $("#github-token");
  if (input?.value) state.settings.githubToken = input.value.trim();
  try {
    const result = await gh.verify();
    if (!result.ok) {
      state.ui.setupMsg[2] = "לטוקן אין הרשאה להפעיל העלאות";
    } else {
      state.ui.setupMsg[2] = "מחובר למאגר ✓";
      state.ui.setupStep = 3;
      saveSettings();
    }
  } catch {
    state.ui.setupMsg[2] = "לטוקן אין הרשאה להפעיל העלאות";
  }
  render();
}
function finishSetup() {
  const selects = document.querySelectorAll("[data-series]");
  state.rules.seriesMap = state.rules.seriesMap || {};
  selects.forEach((select) => {
    state.rules.seriesMap[select.dataset.series] = { playlistKey: select.value, window: "week", replacePrevious: false };
  });
  if (selects.length) persistRules();
  state.settings.setupDone = true;
  saveSettings();
  go("/inbox", { tab: "vod", range: "week", status: "new" });
}
function saveSettingsForm() {
  const url = $("#station-url")?.value?.trim();
  const key = $("#azura-key")?.value?.trim();
  const token = $("#github-token")?.value?.trim();
  if (url) state.settings.stationUrl = url.replace(/\/$/, "");
  if (key) state.settings.azuraKey = key;
  if (token) state.settings.githubToken = token;
  state.settings.setupDone = Boolean(state.settings.azuraKey && state.settings.githubToken);
  saveSettings();
  toast("ההגדרות נשמרו");
  render();
}
function disconnect() {
  const previous = { ...state.settings };
  state.settings = { setupDone: false, azuraKey: "", githubToken: "", stationUrl: "https://radiocast.kikar.co.il" };
  state.pending = [];
  saveSettings();
  saveQueue();
  state.ui.setupStep = 1;
  toast("המפתחות נמחקו מהדפדפן", [{ act: "undo-disconnect", label: "ביטול" }]);
  state.ui.undo.push({
    kind: "settings",
    at: Date.now(),
    revert: () => {
      state.settings = previous;
      saveSettings();
    },
  });
  go("/setup");
}

async function togglePlaylist(id) {
  const pl = state.playlists.find((row) => String(row.id) === String(id));
  if (!pl || !radio.canTouch(pl, knownIds())) {
    toast("הפלייליסט לא מנוהל על ידי המערכת");
    return;
  }
  const next = pl.is_enabled === false;
  pl.is_enabled = next;
  render();
  try {
    await radio.updatePlaylist(pl.id, { ...pl, is_enabled: next });
    toast(next ? `״${pl.name}״ הופעל` : `״${pl.name}״ כובה`, [{ act: "toggle-playlist", label: "ביטול" }]);
  } catch {
    pl.is_enabled = !next;
    toast(`לא הצלחנו לשנות את ״${pl.name}״. נסה שוב.`);
    render();
  }
}
async function movePlaylist(id, dir) {
  const ids = knownIds();
  const rows = state.playlists.filter((pl) => radio.canTouch(pl, ids));
  const index = rows.findIndex((pl) => String(pl.id) === String(id));
  const swap = index + dir;
  if (index < 0 || swap < 0 || swap >= rows.length) return;
  const a = rows[index];
  const b = rows[swap];
  const weight = a.weight;
  a.weight = b.weight;
  b.weight = weight;
  state.playlists = [...state.playlists];
  try {
    await radio.updatePlaylist(a.id, { ...a });
    await radio.updatePlaylist(b.id, { ...b });
  } catch {
    toast("לא הצלחנו לשנות את הסדר");
  }
  render();
}

function toggleRule(id) {
  const rule = (state.rules.rules || []).find((row) => row.id === id);
  if (!rule) return;
  rule.enabled = !rule.enabled;
  persistRules();
  toast(rule.enabled ? "הכלל הופעל" : "הכלל כובה");
}
function deleteRule(id) {
  const prev = structuredClone(state.rules.rules);
  state.rules.rules = (state.rules.rules || []).filter((rule) => rule.id !== id);
  pushUndo({ kind: "rules", store: "rules", label: "הכלל נמחק", revert: () => { state.rules.rules = prev; } });
  persistRules();
}
function saveRule(enabled) {
  const form = document.querySelector("[data-act='rule-form']");
  const data = new FormData(form);
  const rule = {
    ...(state.ui.ruleEdit || {}),
    id: state.ui.ruleEdit?.id || uid("r"),
    seriesSlug: String(data.get("seriesSlug") || ""),
    action: String(data.get("action") || "auto"),
    playlistKey: String(data.get("playlistKey") || "briefs"),
    window: String(data.get("window") || "week"),
    replacePrevious: data.get("replacePrevious") === "on",
    enabled,
    updatedAt: new Date().toISOString(),
  };
  const rules = state.rules.rules || [];
  const index = rules.findIndex((row) => row.id === rule.id);
  if (index >= 0) rules[index] = rule;
  else rules.push(rule);
  state.rules.rules = rules;
  state.ui.ruleEdit = null;
  persistRules();
  const name = seriesName(rule.seriesSlug);
  toast(rule.action === "auto" && rule.enabled ? `הכלל נשמר. פרקים חדשים מ״${name}״ יאושרו אוטומטית.` : "הכלל נשמר");
}
function applyRuleWaiting() {
  const rule = state.ui.ruleEdit;
  if (!rule) return;
  const items = (state.catalog.items || []).filter((item) => item.seriesSlug === rule.seriesSlug && statusOf(item) === "new");
  items.forEach((item) => rememberSelection(item.id, selectionRecord(item, { playlistKey: rule.playlistKey, window: rule.window, replacePrevious: rule.replacePrevious })));
  persistSelections();
  toast(`הוחלו ${items.length} פריטים`);
}
function pauseBulletin(mode) {
  const removeCurrent = $("#remove-current")?.checked || false;
  let pauseUntil = null;
  if (mode === "hour") pauseUntil = new Date(Date.now() + 3600000).toISOString();
  if (mode === "morning") {
    const p = jerusalemParts(new Date());
    let target = jerusalemToUtc(p.year, p.month, p.day, 7, 0, 0);
    if (target <= new Date()) {
      const next = addCalendarDays(p.year, p.month, p.day, 1);
      target = jerusalemToUtc(next.year, next.month, next.day, 7, 0, 0);
    }
    pauseUntil = target.toISOString();
  }
  state.control = { ...state.control, paused: true, pauseMode: mode, pauseUntil, removeCurrent, schemaVersion: 1 };
  state.ui.pauseChooser = false;
  persistControl();
}
function resumeBulletin() {
  state.control = { ...state.control, paused: false, pauseUntil: null, pauseMode: null, removeCurrent: false };
  state.ui.pauseChooser = false;
  persistControl();
  dispatchBulletin();
}

function startCampaign() {
  const draft = state.ui.draft || blankDraft();
  state.ui.draft = draft;
  state.ui.adStep = 1;
  saveDraft(draft);
  go("/ads", { tab: "campaigns", new: "1" });
}
function captureDraft() {
  state.ui.draft = readDraftFromForm(state.ui.draft || blankDraft());
  saveDraft(state.ui.draft);
  return state.ui.draft;
}
function adNext() {
  const draft = captureDraft();
  const errors = validateDraft(draft, state.ui.adStep, true);
  if (errors.length) {
    toast(errors[0].text);
    return;
  }
  state.ui.adStep = Math.min(4, state.ui.adStep + 1);
}
function setAdSpan(days) {
  const draft = captureDraft();
  draft.startDate = todayKey();
  const p = jerusalemParts(new Date());
  const end = addCalendarDays(p.year, p.month, p.day, days);
  draft.endDate = `${end.year}-${String(end.month).padStart(2, "0")}-${String(end.day).padStart(2, "0")}`;
  saveDraft(draft);
  render();
}
function stepFrequency(dir) {
  const draft = captureDraft();
  draft.frequencyEvery = Math.max(1, Math.min(30, (draft.frequencyEvery || 4) + dir));
  saveDraft(draft);
  render();
}
function addFixedTime() {
  const value = $("#fixed-time")?.value;
  if (!value) return;
  const draft = captureDraft();
  draft.fixedTimes = [...new Set([...(draft.fixedTimes || []), value])].sort();
  saveDraft(draft);
  render();
}
function toggleDay(day) {
  const draft = captureDraft();
  const days = new Set(draft.days || []);
  if (days.has(day)) days.delete(day);
  else days.add(day);
  draft.days = [...days].sort();
  saveDraft(draft);
  render();
}
async function onAdFile(file) {
  const draft = captureDraft();
  if (!/audio\/|mpeg|wav|mp4|aac|ogg|flac/i.test(file.type) && !/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name)) {
    toast("הפורמט לא נתמך. אפשר MP3, WAV, M4A, AAC, OGG או FLAC.");
    return;
  }
  const durationSec = await fileDuration(file);
  state.ui.uploadProgress = 0;
  render();
  try {
    const base64 = await fileToBase64(file);
    const safe = file.name.replace(/[^\w.\-\u0590-\u05FF]+/g, "_").slice(0, 80);
    const path = `ads/${draft.id}/${safe}`;
    const media = await radio.uploadBase64(path, base64, (ratio) => {
      state.ui.uploadProgress = ratio;
      const node = document.querySelector("[aria-live='polite']");
      if (node) node.textContent = `מעלה קובץ… ${Math.round(ratio * 100)}%`;
    });
    draft.files = [...(draft.files || []), { name: file.name, path: media?.path || path, mediaId: media?.id, durationSec, previewUrl: URL.createObjectURL(file) }];
    if (!draft.name) draft.name = file.name.replace(/\.[^.]+$/, "");
    saveDraft(draft);
    toast("הקובץ עלה לשרת");
  } catch (err) {
    draft.uploadError = true;
    toast("הקובץ לא עלה לשרת. הקמפיין לא משודר.");
    if (isNetwork(err)) toast("ההעלאה תמשיך כשהחיבור יחזור");
  } finally {
    state.ui.uploadProgress = null;
    render();
  }
}
function fileDuration(file) {
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.src = URL.createObjectURL(file);
    audio.onloadedmetadata = () => resolve(Number.isFinite(audio.duration) ? Math.round(audio.duration) : null);
    audio.onerror = () => resolve(null);
  });
}
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
async function createCampaign() {
  const draft = captureDraft();
  const errors = validateDraft(draft, 4, true);
  if (errors.length) {
    toast(errors[0].text);
    return;
  }
  if (!state.settings.azuraKey) {
    toast("כדי ליצור קמפיין צריך מפתח רדיו");
    return;
  }
  try {
    const ids = knownIds();
    const playlistIds = await ensureCampaignPlaylists(draft);
    for (const file of draft.files || []) {
      if (!file.mediaId) continue;
      const desired = [...ids, ...playlistIds].filter((value, index, all) => all.indexOf(value) === index);
      const managed = new Set([...ids, ...playlistIds]);
      await radio.setFilePlaylists(file.mediaId, playlistIds.filter((pid) => managed.has(Number(pid))), managed);
      void desired;
    }
    const campaign = { ...draft, ...playlistIdsMap(draft, playlistIds), draft: false, createdAt: new Date().toISOString(), uploadError: false };
    state.ads.campaigns = [campaign, ...(state.ads.campaigns || []).filter((row) => row.id !== campaign.id)];
    persistAds();
    saveDraft(null);
    state.ui.adStep = 1;
    toast(todayKey() < campaign.startDate ? "הקמפיין תוזמן" : "הקמפיין נוצר");
    go("/ads", { tab: "campaigns" });
    refreshPlaylists();
  } catch (err) {
    toast(err.code === "auth" ? ERROR_TEXT.auth : "הקובץ לא עלה לשרת. הקמפיין לא משודר.");
  }
}
function playlistIdsMap(draft, ids) {
  const map = { frequencyPlaylistId: null, fixedPlaylistId: null };
  let cursor = 0;
  if (draft.frequencyEvery) map.frequencyPlaylistId = ids[cursor++] || null;
  if (draft.fixedTimes?.length) map.fixedPlaylistId = ids[cursor++] || null;
  return map;
}
async function ensureCampaignPlaylists(draft) {
  const ids = [];
  const days = (draft.days || []).map(toAzuraDay);
  const range = { start_date: draft.startDate, end_date: draft.endDate, days };
  const base = {
    description: `${MANAGED_MARKER} ads:${draft.id}`,
    source: "songs",
    order: "sequential",
    include_in_requests: false,
    include_in_on_demand: false,
    avoid_duplicates: true,
    is_jingle: false,
    is_enabled: !draft.paused && !(todayKey() > draft.endDate),
    backend_options: [],
  };
  const name = `כיכר אוטו – פרסומת – ${String(draft.name).slice(0, 40)}`;
  if (draft.frequencyEvery) {
    const created = await radio.createPlaylist({
      ...base,
      name,
      type: draft.frequencyMode === "minutes" ? "once_per_x_minutes" : "once_per_x_songs",
      play_per_songs: draft.frequencyMode === "minutes" ? 0 : Number(draft.frequencyEvery),
      play_per_minutes: draft.frequencyMode === "minutes" ? Number(draft.frequencyEvery) : 0,
      play_per_hour_minute: 0,
      weight: 4,
      schedule_items: [{ start_time: 0, end_time: 2359, ...range }],
    });
    ids.push(created.id);
  }
  if (draft.fixedTimes?.length) {
    const created = await radio.createPlaylist({
      ...base,
      name: `${name} · שעות`.slice(0, 80),
      type: "default",
      play_per_songs: 0,
      play_per_minutes: 0,
      play_per_hour_minute: 0,
      weight: 8,
      backend_options: ["interrupt", "single_track"],
      schedule_items: draft.fixedTimes.map((time) => {
        const [h, m] = time.split(":").map(Number);
        const start = h * 100 + m;
        const endMinutes = h * 60 + m + 8;
        const end = Math.min(2359, Math.floor(endMinutes / 60) * 100 + (endMinutes % 60));
        return { start_time: start, end_time: end, ...range };
      }),
    });
    ids.push(created.id);
  }
  return ids;
}
async function pauseCampaign(id) {
  const campaign = (state.ads.campaigns || []).find((row) => row.id === id);
  if (!campaign) return;
  campaign.paused = !campaign.paused;
  persistAds();
  for (const pid of [campaign.frequencyPlaylistId, campaign.fixedPlaylistId]) {
    if (!pid) continue;
    const pl = state.playlists.find((row) => Number(row.id) === Number(pid));
    if (pl && radio.canTouch(pl, knownIds())) await radio.updatePlaylist(pid, { ...pl, is_enabled: !campaign.paused }).catch(() => toast("לא הצלחנו לעדכן את הפלייליסט"));
  }
}
function deleteCampaign(id) {
  const campaign = (state.ads.campaigns || []).find((row) => row.id === id);
  if (!campaign) return;
  const prev = structuredClone(state.ads.campaigns);
  state.ads.campaigns = state.ads.campaigns.filter((row) => row.id !== id);
  persistAds();
  const timer = setTimeout(async () => {
    for (const pid of [campaign.frequencyPlaylistId, campaign.fixedPlaylistId]) {
      const pl = state.playlists.find((row) => Number(row.id) === Number(pid));
      if (pl && radio.canTouch(pl, knownIds())) await radio.deletePlaylist(pid).catch(() => {});
    }
  }, 8000);
  pushUndo({
    kind: "ads",
    store: "ads",
    label: "הקמפיין נמחק",
    revert: () => {
      clearTimeout(timer);
      state.ads.campaigns = prev;
    },
  });
}
function duplicateCampaign(id) {
  const campaign = (state.ads.campaigns || []).find((row) => row.id === id);
  if (!campaign) return;
  state.ui.draft = { ...structuredClone(campaign), id: uid("c"), name: `${campaign.name} (עותק)`, frequencyPlaylistId: null, fixedPlaylistId: null, paused: false };
  state.ui.adStep = 4;
  saveDraft(state.ui.draft);
  go("/ads", { tab: "campaigns", new: "1" });
}
function extendCampaign(id) {
  const campaign = (state.ads.campaigns || []).find((row) => row.id === id);
  if (!campaign) return;
  const p = jerusalemParts(campaign.endDate);
  const next = addCalendarDays(p.year, p.month, p.day, 7);
  campaign.endDate = `${next.year}-${String(next.month).padStart(2, "0")}-${String(next.day).padStart(2, "0")}`;
  campaign.paused = false;
  persistAds();
  toast("הקמפיין הוארך בשבוע");
}
function editCampaign(id) {
  const campaign = (state.ads.campaigns || []).find((row) => row.id === id);
  if (!campaign) return;
  state.ui.draft = structuredClone(campaign);
  state.ui.adStep = 1;
  saveDraft(state.ui.draft);
  go("/ads", { tab: "campaigns", new: "1" });
}
async function changeGroupEvery(group, dir) {
  const bucket = state.ads[group];
  bucket.everySongs = Math.max(1, (bucket.everySongs || 4) + dir);
  persistAds();
  if (bucket.playlistId) {
    const pl = state.playlists.find((row) => Number(row.id) === Number(bucket.playlistId));
    if (pl && radio.canTouch(pl, knownIds())) await radio.updatePlaylist(pl.id, { ...pl, play_per_songs: bucket.everySongs, type: "once_per_x_songs" }).catch(() => toast("לא הצלחנו לעדכן תדירות"));
  }
}
async function toggleGroup(group) {
  const bucket = state.ads[group];
  bucket.enabled = bucket.enabled === false;
  persistAds();
  if (bucket.playlistId) {
    const pl = state.playlists.find((row) => Number(row.id) === Number(bucket.playlistId));
    if (pl && radio.canTouch(pl, knownIds())) await radio.updatePlaylist(pl.id, { ...pl, is_enabled: bucket.enabled }).catch(() => toast("לא הצלחנו לעדכן"));
  }
}
async function toggleGroupFile(group, mediaId) {
  const bucket = state.ads[group];
  const file = (bucket.files || []).find((row) => Number(row.mediaId) === Number(mediaId));
  if (!file) return;
  file.enabled = file.enabled === false;
  persistAds();
  if (!bucket.playlistId) return;
  const desired = file.enabled === false ? [] : [Number(bucket.playlistId)];
  await radio.setFilePlaylists(mediaId, desired, knownIds()).catch(() => toast("לא הצלחנו לעדכן את הקובץ"));
}
async function onGroupFiles(group, files) {
  const bucket = state.ads[group];
  const label = group === "jingles" ? "ג׳ינגלים" : "מעברונים";
  if (!bucket.playlistId) {
    const created = await radio.createPlaylist({
      name: `כיכר אוטו – ${label}`,
      description: `${MANAGED_MARKER} ${group}`,
      type: "once_per_x_songs",
      source: "songs",
      order: "shuffle",
      is_enabled: bucket.enabled !== false,
      is_jingle: true,
      play_per_songs: bucket.everySongs || 4,
      play_per_minutes: 0,
      play_per_hour_minute: 0,
      weight: 2,
      include_in_requests: false,
      include_in_on_demand: false,
      avoid_duplicates: true,
      backend_options: [],
      schedule_items: [],
    });
    bucket.playlistId = created.id;
  }
  for (const file of files) {
    try {
      const base64 = await fileToBase64(file);
      const safe = file.name.replace(/[^\w.\-\u0590-\u05FF]+/g, "_").slice(0, 80);
      const uploaded = await radio.uploadBase64(`${group}/${safe}`, base64, () => {});
      const durationSec = await fileDuration(file);
      bucket.files = [...(bucket.files || []), { name: file.name, mediaId: uploaded.id, path: uploaded.path, durationSec, enabled: true }];
      await radio.setFilePlaylists(uploaded.id, [Number(bucket.playlistId)], knownIds());
    } catch {
      toast("הקובץ לא עלה לשרת.");
    }
  }
  persistAds();
  render();
}

const player = () => $("#player");
function togglePlay(url, id) {
  if (!url) return;
  const node = player();
  if (state.ui.playingId === id && !node.paused) {
    node.pause();
    state.ui.playingId = null;
    render();
    return;
  }
  node.src = url;
  state.ui.playingId = id;
  node.play().catch(() => toast("לא הצלחנו לנגן את הקובץ"));
  render();
}
function bindAudio() {
  const node = player();
  node.addEventListener("timeupdate", () => {
    const scrub = document.querySelector(`.scrub[data-id="${CSS.escape(state.ui.playingId || "")}"]`);
    if (!scrub || !node.duration) return;
    scrub.hidden = false;
    scrub.value = String(Math.round((node.currentTime / node.duration) * 100));
    scrub.setAttribute("aria-valuetext", `${formatDuration(node.currentTime)} מתוך ${formatDuration(node.duration)}`);
  });
  node.addEventListener("ended", () => {
    state.ui.playingId = null;
    render();
  });
}

let swipe = null;
let pressTimer = null;
function bindPointers() {
  document.addEventListener("pointerdown", (event) => {
    const card = event.target.closest(".swipe");
    if (!card || state.ui.bulk || event.target.closest("button, input, a, select")) return;
    swipe = { id: card.dataset.id, x: event.clientX, y: event.clientY, t: Date.now(), dx: 0, fired: false };
    pressTimer = setTimeout(() => {
      if (!swipe || Math.abs(swipe.dx) > 8) return;
      state.ui.bulk = true;
      state.ui.selected.add(swipe.id);
      swipe.fired = true;
      render();
    }, 550);
  });
  document.addEventListener("pointermove", (event) => {
    if (!swipe || state.ui.bulk) return;
    swipe.dx = event.clientX - swipe.x;
    const dy = event.clientY - swipe.y;
    if (Math.abs(dy) > Math.abs(swipe.dx) && Math.abs(swipe.dx) < 16) return;
    const el = document.querySelector(`.swipe[data-id="${CSS.escape(swipe.id)}"] .card`);
    const host = el?.parentElement;
    if (!el || !host) return;
    el.style.transform = `translateX(${swipe.dx}px)`;
    host.dataset.reveal = swipeDecision(swipe.dx) || "";
    const threshold = host.offsetWidth * 0.4;
    if (Math.abs(swipe.dx) > threshold && !swipe.buzzed) {
      swipe.buzzed = true;
      navigator.vibrate?.(12);
      host.dataset.bold = "1";
    }
  });
  document.addEventListener("pointerup", (event) => {
    clearTimeout(pressTimer);
    if (!swipe) return;
    const current = swipe;
    swipe = null;
    const host = document.querySelector(`.swipe[data-id="${CSS.escape(current.id)}"]`);
    const card = host?.querySelector(".card");
    if (!host || !card) return;
    const width = host.offsetWidth || 1;
    const dt = Math.max(1, Date.now() - current.t);
    const flick = Math.abs(current.dx) > 64 && Math.abs(current.dx) / dt > 0.5;
    const commit = Math.abs(current.dx) > width * 0.4 || flick;
    card.style.transform = "";
    if (!commit || current.fired) return;
    const decision = swipeDecision(current.dx);
    const item = itemById(current.id);
    if (!item || !decision) return;
    current.fired = true;
    if (decision === "approve") approveItem(item);
    else skipItem(item);
    render();
    event.preventDefault();
  });
}

function bindKeys() {
  document.addEventListener("keydown", (event) => {
    const typing = event.target.closest("input, textarea, select");
    if (event.key === "Escape") {
      state.ui.sheet = null;
      state.ui.help = false;
      state.ui.bulk = false;
      state.ui.menu = false;
      render();
      return;
    }
    if (typing) return;
    const code = event.code;
    if ((event.metaKey || event.ctrlKey) && code === "KeyZ") {
      event.preventDefault();
      undo();
      return;
    }
    if (code === "Digit1") go("/inbox", { tab: state.route.q.get("tab") || "vod", range: "week", status: "new" });
    if (code === "Digit2") go("/air");
    if (code === "Digit3") go("/playlists");
    if (code === "Digit4") go("/rules");
    if (code === "Digit5") go("/ads", { tab: "campaigns" });
    if (event.key === "?") {
      state.ui.help = true;
      render();
      return;
    }
    if (code === "Slash") {
      event.preventDefault();
      $("#q")?.focus();
      return;
    }
    if (state.route.path !== "/inbox") return;
    const items = filteredItems();
    let index = Math.max(0, items.findIndex((item) => item.id === state.ui.focusId));
    if (code === "ArrowDown" || code === "KeyJ") index = Math.min(items.length - 1, index + 1);
    if (code === "ArrowUp" || code === "KeyK") index = Math.max(0, index - 1);
    if (code === "ArrowDown" || code === "KeyJ" || code === "ArrowUp" || code === "KeyK") {
      state.ui.focusId = items[index]?.id || null;
      render();
      return;
    }
    const item = items[index];
    if (!item) return;
    if (code === "KeyA" && event.shiftKey) bulkApply("approve");
    else if (code === "KeyS" && event.shiftKey) bulkApply("skip");
    else if (code === "KeyA") approveItem(item);
    else if (code === "KeyS") skipItem(item);
    else if (code === "KeyE") state.ui.sheet = { ids: [item.id] };
    else if (code === "KeyX") toggleSelected(item.id);
    else if (code === "KeyU") uploadOne(item.id);
    else if (code === "Space") {
      event.preventDefault();
      togglePlay(item.mediaUrl, item.id);
      return;
    } else return;
    render();
  });
}

function bindForms() {
  document.addEventListener("input", (event) => {
    if (event.target.id === "q") {
      state.ui.search = event.target.value;
      applySearch();
    }
    if (event.target.closest("#sheet-form")) updateWindowHint();
    if (event.target.closest("#campaign-form")) {
      captureDraft();
    }
  });
  document.addEventListener("change", async (event) => {
    if (event.target.id === "ad-file" && event.target.files?.[0]) await onAdFile(event.target.files[0]);
    if (event.target.dataset.act === "group-upload") await onGroupFiles(event.target.dataset.group, [...event.target.files]);
    if (event.target.dataset.act === "scrub") {
      const node = player();
      if (node.duration) node.currentTime = (Number(event.target.value) / 100) * node.duration;
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Tab" || !document.querySelector(".sheet")) return;
    const dialogNode = document.querySelector(".sheet");
    const items = [...dialogNode.querySelectorAll("button, input, select, textarea, a")].filter((el) => !el.disabled);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

async function boot() {
  state.route = parseRoute();
  bindAudio();
  bindPointers();
  bindKeys();
  bindForms();
  document.body.addEventListener("click", onClick);
  window.addEventListener("hashchange", () => {
    state.route = parseRoute();
    state.ui.sheet = null;
    if (state.route.path === "/playlists" || state.route.path === "/ads") refreshPlaylists();
    render();
  });
  window.addEventListener("online", flushQueue);
  window.addEventListener("offline", () => {
    renderBanner();
  });
  if (!state.settings.setupDone && state.route.path !== "/setup") go("/setup");
  render();
  await loadAll();
  refreshNowPlaying();
  refreshPlaylists();
  flushQueue();
  setInterval(refreshNowPlaying, 30000);
  setInterval(() => {
    if (navigator.onLine) loadAll();
  }, 60000);
  if (state.bulletin.note === "failed") {
    const alert = document.createElement("div");
    alert.className = "sr";
    alert.setAttribute("role", "alert");
    alert.textContent = state.bulletin.failure?.message || "מבזק לא עלה";
    document.body.appendChild(alert);
  }
}

boot().catch((err) => {
  $("#view").textContent = err?.message || "משהו השתבש בטעינה";
});
