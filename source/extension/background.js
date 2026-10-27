/* Phalanx service worker (Manifest V3).
 *
 *  - Site scanner: scores every top-level navigation BEFORE the page loads.
 *  - Download inspector: Chrome Safe Browsing verdict + Phalanx file heuristics.
 *  - Collects DOM findings from content.js.
 *  - Light network telemetry (request rate) kept in memory, flushed rarely.
 *  - Syncs with the Phalanx desktop engine (http://127.0.0.1:47821) which owns
 *    settings, long-term history and the dashboard. Works offline and catches up.
 *
 * Performance: all state lives in memory and is written to chrome.storage with a
 * debounce (previously every network request did 3-4 storage reads/writes).
 */
importScripts("lib/intel.js", "lib/edition.js");

const I = self.PhalanxIntel;
const ENGINE = "http://127.0.0.1:47821";
const MAX_EVENTS = 300;
const DEFAULT_CFG = {
  sensitivity: "medium", autoQuarantine: true, notifyStyle: "toast", siteScan: true, downloadScan: true,
  domScan: true, network: "light", theme: "dark", accent: self.PHALANX_EDITION.defaultAccent, size: "normal",
  edition: self.PHALANX_EDITION.name,
};

const S = {
  ready: null,
  cfg: Object.assign({}, DEFAULT_CFG),
  lists: { allow: [], block: [] },
  events: [],
  stats: { sitesScanned: 0, downloadsScanned: 0, domChecks: 0, requests: 0, since: Date.now() },
  series: [],          // [{ts(minute), requests}]
  paused: false,
  engine: { online: false, lastOk: 0, lastTry: 0, version: "" },
  dirty: new Set(),
};

/* ---------------- persistence (debounced) ---------------- */
S.ready = chrome.storage.local.get(["ph_cfg", "ph_lists", "ph_events", "ph_stats", "ph_series", "ph_paused"]).then((r) => {
  if (r.ph_cfg) S.cfg = Object.assign({}, DEFAULT_CFG, r.ph_cfg, { edition: DEFAULT_CFG.edition });
  if (r.ph_lists) S.lists = r.ph_lists;
  if (r.ph_events) S.events = r.ph_events;
  if (r.ph_stats) S.stats = Object.assign(S.stats, r.ph_stats);
  if (r.ph_series) S.series = r.ph_series;
  S.paused = !!r.ph_paused;
  if (S.cfg.network === "off") chrome.webRequest.onCompleted.removeListener(onRequest);
  badge();
});
let saveTimer = null;
const saveKeys = new Set();
function save(...keys) {
  keys.forEach((k) => saveKeys.add(k));
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const out = {};
    for (const k of saveKeys) {
      if (k === "events") out.ph_events = S.events;
      if (k === "stats") out.ph_stats = S.stats;
      if (k === "series") out.ph_series = S.series;
      if (k === "cfg") out.ph_cfg = S.cfg;
      if (k === "lists") out.ph_lists = S.lists;
      if (k === "paused") out.ph_paused = S.paused;
    }
    saveKeys.clear();
    chrome.storage.local.set(out);
  }, 600);
}

/* ---------------- events ---------------- */
function addEvent(ev) {
  S.events.unshift(ev);
  if (S.events.length > MAX_EVENTS) S.events.length = MAX_EVENTS;
  S.dirty.add(ev.id);
  save("events");
  badge();
  scheduleSync(800);
  return ev;
}
function findEvent(id) { return S.events.find((e) => e.id === id); }
function pendingCount() { return S.events.filter((e) => e.status === "pending").length; }
function badge() {
  const n = pendingCount();
  chrome.action.setBadgeBackgroundColor({ color: n ? "#d93a4a" : "#2e7d4f" });
  chrome.action.setBadgeText({ text: S.paused ? "II" : n ? String(Math.min(n, 99)) : "" });
}

/* ---------------- notifications: one small grouped toast, 3 s ---------------- */
let sysCount = 0, sysTimer = null;
async function notify(ev, tabId) {
  if (S.cfg.notifyStyle === "silent") return;
  if (S.cfg.notifyStyle === "toast") {
    try {
      if (tabId == null) {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        tabId = tab && tab.id;
      }
      if (tabId != null) { await chrome.tabs.sendMessage(tabId, { t: "toast", items: [ev] }); return; }
    } catch (e) { /* page without content script (chrome://, error page) -> system fallback */ }
  }
  systemNotify(ev);
}
function systemNotify(ev) {
  sysCount++;
  chrome.notifications.create("phalanx", {
    type: "basic", iconUrl: "icons/icon128.png", priority: 0, silent: true,
    title: sysCount > 1 ? `Phalanx · ${sysCount} new alerts` : "Phalanx alert",
    message: `${ev.title} — ${ev.host || ""} (${ev.severity}, ${ev.score}/100)`,
  });
  clearTimeout(sysTimer);
  sysTimer = setTimeout(() => { chrome.notifications.clear("phalanx"); sysCount = 0; }, 3000);
}
chrome.notifications.onClicked.addListener(() => { chrome.notifications.clear("phalanx"); openApp("/live.html"); });

/* ---------------- decisions (Resolved / Quarantine / Threat analysis) ---------------- */
async function decide(id, action, by) {
  await S.ready;
  const ev = findEvent(id);
  if (!ev) return { ok: false };
  if (!["resolved", "quarantined", "analysis"].includes(action)) return { ok: false };
  ev.status = action;
  ev.decidedAt = Date.now();
  ev.decidedBy = by || "user";
  S.dirty.add(id);

  if (ev.kind === "dom" && ev.tabId != null && action !== "analysis" && by !== "content") {
    chrome.tabs.sendMessage(ev.tabId, { t: "apply", id, action }).catch(() => {});
  }
  if (ev.kind === "site" && ev.site) {
    if (action === "resolved") {
      S.lists.block = S.lists.block.filter((h) => h !== ev.site);
      if (!S.lists.allow.includes(ev.site)) S.lists.allow.push(ev.site);
      save("lists");
    } else if (action === "quarantined") {
      S.lists.allow = S.lists.allow.filter((h) => h !== ev.site);
      if (!S.lists.block.includes(ev.site)) S.lists.block.push(ev.site);
      save("lists");
      if (ev.tabId != null) {
        chrome.tabs.get(ev.tabId).then((tab) => {
          if (tab && tab.url && I.siteOf(I.hostOf(tab.url)) === ev.site) {
            chrome.tabs.update(ev.tabId, { url: blockedUrl(ev) });
          }
        }).catch(() => {});
      }
    }
  }
  if (ev.kind === "download" && ev.downloadId != null) {
    const [item] = await chrome.downloads.search({ id: ev.downloadId });
    if (item) {
      if (action === "resolved" && item.paused && item.canResume) chrome.downloads.resume(ev.downloadId).catch(() => {});
      if (action === "quarantined") {
        if (item.state === "in_progress") await chrome.downloads.cancel(ev.downloadId).catch(() => {});
        else if (item.state === "complete" && item.exists) await chrome.downloads.removeFile(ev.downloadId).catch(() => {});
        chrome.downloads.erase({ id: ev.downloadId }).catch(() => {});
      }
    }
  }
  if (ev.tabId != null) chrome.tabs.sendMessage(ev.tabId, { t: "status", id, status: action }).catch(() => {});
  save("events", "lists");
  badge();
  if (action === "analysis" && by !== "app") {
    await sync(true);
    openApp("/analysis.html?id=" + encodeURIComponent(id), id);
  } else scheduleSync(300);
  return { ok: true, ev };
}

function blockedUrl(ev) {
  return chrome.runtime.getURL("pages/blocked.html") + "?id=" + encodeURIComponent(ev.id) + "&url=" + encodeURIComponent(ev.url || "");
}

/* ---------------- 1. Site scanner ---------------- */
const recentSite = new Map(); // site -> {id, ts}
chrome.webNavigation.onBeforeNavigate.addListener(async (d) => {
  if (d.frameId !== 0 || !/^https?:/.test(d.url)) return;
  await S.ready;
  if (!S.cfg.siteScan) return;
  const host = I.hostOf(d.url);
  if (I.isLocal(host)) return;
  S.stats.sitesScanned++;
  save("stats");
  const r = I.scoreUrl(d.url, S.lists);
  if (r.category === "blocked") {
    const ev = addEvent(siteEvent(d, r, "auto-quarantined", "Blocked a site you quarantined"));
    chrome.tabs.update(d.tabId, { url: blockedUrl(ev) });
    return;
  }
  if (S.paused || r.score < I.thresholdFor(S.cfg.sensitivity)) return;
  const prev = recentSite.get(r.site);
  if (prev && Date.now() - prev.ts < 5 * 60 * 1000) {
    const pe = findEvent(prev.id);
    if (pe) { pe.tabId = d.tabId; return; }
  }
  const auto = S.cfg.autoQuarantine && r.score >= I.AUTO_QUARANTINE_MIN;
  const ev = addEvent(siteEvent(d, r, auto ? "auto-quarantined" : "pending"));
  recentSite.set(r.site, { id: ev.id, ts: ev.ts });
  if (auto) chrome.tabs.update(d.tabId, { url: blockedUrl(ev) });
  else if (S.cfg.notifyStyle === "system") systemNotify(ev);
  else setTimeout(() => { if (!ev.toasted) systemNotifyIfNoPage(ev); }, 8000);
});
function siteEvent(d, r, status, title) {
  const labels = { piracy: "Piracy / torrent site", phishing: "Possible phishing site", malware: "Known malicious site",
    "suspicious-host": "Suspicious host (raw IP)", redirect: "Hidden-destination link", blocked: "Quarantined site", general: "Risky website" };
  return {
    id: "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ts: Date.now(),
    kind: "site", type: "site_risk", category: r.category, title: title || labels[r.category] || "Risky website",
    score: r.score, severity: I.severityOf(r.score), signals: r.signals, url: d.url, host: r.host, site: r.site,
    source: d.url, target: r.host, status, tabId: d.tabId,
  };
}
async function systemNotifyIfNoPage(ev) {
  // Error pages / unreachable hosts never get a content script; fall back once.
  if (S.cfg.notifyStyle !== "silent") systemNotify(ev);
}

/* ---------------- 2. Download inspector ---------------- */
const dlEvent = new Map(); // downloadId -> eventId
const dlSeen = new Set();
async function inspectDownload(item) {
  await S.ready;
  if (!S.cfg.downloadScan) return;
  if (!dlSeen.has(item.id)) { dlSeen.add(item.id); S.stats.downloadsScanned++; save("stats"); }
  const r = I.scoreDownload({ filename: item.filename, url: item.finalUrl || item.url, referrer: item.referrer, danger: item.danger, mime: item.mime }, S.lists);
  if (S.paused || r.score < I.thresholdFor(S.cfg.sensitivity)) return;
  const existingId = dlEvent.get(item.id);
  const existing = existingId && findEvent(existingId);
  if (existing) {
    if (r.score > existing.score) {
      Object.assign(existing, { score: r.score, severity: I.severityOf(r.score), signals: r.signals, target: r.filename, category: r.category });
      S.dirty.add(existing.id); save("events");
    }
    return;
  }
  const auto = S.cfg.autoQuarantine && r.score >= I.AUTO_QUARANTINE_MIN;
  const ev = addEvent({
    id: "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ts: Date.now(),
    kind: "download", type: "download_risk", category: r.category, title: "Risky download: " + r.filename,
    score: r.score, severity: I.severityOf(r.score), signals: r.signals, url: item.referrer || item.url,
    host: r.host, site: r.site, source: item.finalUrl || item.url, target: r.filename,
    status: auto ? "auto-quarantined" : "pending", downloadId: item.id,
  });
  dlEvent.set(item.id, ev.id);
  if (auto) {
    if (item.state === "in_progress") chrome.downloads.cancel(item.id).catch(() => {});
    else chrome.downloads.removeFile(item.id).catch(() => {});
  } else if (item.state === "in_progress") {
    chrome.downloads.pause(item.id).catch(() => {}); // held until you choose
  }
  notify(ev);
}
chrome.downloads.onCreated.addListener(inspectDownload);
chrome.downloads.onChanged.addListener((delta) => {
  if (delta.filename || delta.danger) chrome.downloads.search({ id: delta.id }).then(([it]) => it && inspectDownload(it));
});

/* ---------------- 3. Network telemetry (in memory) ---------------- */
function onRequest(d) {
  if (d.url.startsWith(ENGINE)) return;
  S.stats.requests++;
  const m = Math.floor(Date.now() / 60000) * 60000;
  let last = S.series[S.series.length - 1];
  if (!last || last.ts !== m) { last = { ts: m, requests: 0 }; S.series.push(last); if (S.series.length > 90) S.series.shift(); }
  last.requests++;
  if (!netTimer) netTimer = setTimeout(() => { netTimer = null; save("series", "stats"); }, 15000);
}
let netTimer = null;
chrome.webRequest.onCompleted.addListener(onRequest, { urls: ["http://*/*", "https://*/*"] });

/* ---------------- messages ---------------- */
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    await S.ready;
    const tabId = sender.tab && sender.tab.id;
    switch (msg && msg.t) {
      case "hello": {
        const host = I.hostOf(msg.url || "");
        const items = S.events.filter((e) => e.kind === "site" && e.status === "pending" && e.host === host && Date.now() - e.ts < 120000);
        items.forEach((e) => { e.toasted = true; e.tabId = tabId; });
        return reply({ cfg: pubCfg(), items: S.cfg.notifyStyle === "toast" ? items : [] });
      }
      case "dom": {
        S.stats.domChecks += msg.events.length;
        for (const ev of msg.events) {
          ev.tabId = tabId; ev.site = I.siteOf(I.hostOf(ev.url));
          addEvent(ev);
          if (S.cfg.notifyStyle === "system") systemNotify(ev);
        }
        return reply({ ok: true });
      }
      case "decide": return reply(await decide(msg.id, msg.action, msg.from || "content"));
      case "popup": {
        if (Date.now() - S.engine.lastTry > 4000) sync(true);
        return reply({ events: S.events.slice(0, 40), stats: S.stats, series: S.series.slice(-30), cfg: pubCfg(), paused: S.paused,
          engine: S.engine, pending: pendingCount() });
      }
      case "event": return reply({ ev: findEvent(msg.id) || null, cfg: pubCfg() });
      case "setPaused": S.paused = !!msg.paused; save("paused"); badge(); scheduleSync(100); return reply({ paused: S.paused });
      case "openApp": return reply(await openApp(msg.path || "/"));
      case "proceed": { // from the blocked page: trust & continue
        await decide(msg.id, "resolved", "user");
        return reply({ ok: true });
      }
      case "clearDone": S.events = S.events.filter((e) => e.status === "pending"); save("events"); badge(); return reply({ ok: true });
    }
    reply({});
  })();
  return true;
});
function pubCfg() { return Object.assign({}, S.cfg, { paused: S.paused, lists: S.lists }); }

/* ---------------- desktop engine link ---------------- */
let syncTimer = null, syncing = null, lastSync = 0;
function scheduleSync(ms) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => sync(false), ms || 1000);
}
async function sync(force) {
  if (syncing) return syncing;
  if (!force && Date.now() - lastSync < 2500) return scheduleSync(2600);
  syncing = (async () => {
    await S.ready;
    lastSync = Date.now();
    S.engine.lastTry = Date.now();
    const out = S.events.filter((e) => S.dirty.has(e.id));
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 3000);
    try {
      const res = await fetch(ENGINE + "/api/ext/sync", {
        method: "POST", signal: ctl.signal, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: chrome.runtime.getManifest().version, edition: DEFAULT_CFG.edition, paused: S.paused,
          stats: S.stats, series: S.series.slice(-60), events: out.map(strip), lists: S.lists }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      out.forEach((e) => S.dirty.delete(e.id));
      S.engine = { online: true, lastOk: Date.now(), lastTry: Date.now(), version: data.version || "" };
      if (data.settings) applySettings(data.settings);
      if (data.lists) { S.lists = { allow: data.lists.allow || [], block: data.lists.block || [] }; save("lists"); }
      for (const c of data.commands || []) {
        if (c.type === "decide") await decide(c.id, c.action, "app");
        if (c.type === "clearCache") { S.events = S.events.filter((e) => e.status === "pending"); S.series = []; save("events", "series"); badge(); }
      }
    } catch (e) {
      S.engine.online = false;
    } finally {
      clearTimeout(to);
      syncing = null;
    }
  })();
  return syncing;
}
function strip(e) { const c = Object.assign({}, e); delete c.toasted; return c; }
function applySettings(s) {
  const before = JSON.stringify(S.cfg);
  const next = Object.assign({}, S.cfg);
  for (const k of Object.keys(DEFAULT_CFG)) if (s[k] !== undefined && k !== "edition") next[k] = s[k];
  if (JSON.stringify(next) === before) return;
  const netChanged = next.network !== S.cfg.network;
  S.cfg = next;
  save("cfg");
  if (netChanged) {
    if (S.cfg.network === "off") chrome.webRequest.onCompleted.removeListener(onRequest);
    else if (!chrome.webRequest.onCompleted.hasListener(onRequest)) chrome.webRequest.onCompleted.addListener(onRequest, { urls: ["http://*/*", "https://*/*"] });
  }
  // push new config to open tabs (only on change)
  chrome.tabs.query({ url: ["http://*/*", "https://*/*"] }).then((tabs) => {
    for (const t of tabs) chrome.tabs.sendMessage(t.id, { t: "cfg", cfg: pubCfg() }).catch(() => {});
  });
}

async function openApp(path, eventId) {
  await sync(true);
  if (S.engine.online) {
    try {
      await fetch(ENGINE + "/api/ext/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
      return { ok: true, via: "engine" };
    } catch (e) { /* fall through */ }
  }
  // Engine not running: show the built-in fallback analysis, or offer to launch the app.
  if (eventId) {
    chrome.tabs.create({ url: chrome.runtime.getURL("pages/analysis.html") + "?id=" + encodeURIComponent(eventId) });
    return { ok: true, via: "fallback" };
  }
  return { ok: false, offline: true };
}

/* ---------------- lifecycle ---------------- */
chrome.alarms.create("phalanx-sync", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "phalanx-sync") sync(true); });
chrome.runtime.onInstalled.addListener(() => { S.ready.then(() => { badge(); sync(true); }); });
chrome.runtime.onStartup.addListener(() => sync(true));
