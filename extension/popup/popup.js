/* Phalanx toolbar popup — compact status + grouped notification dropdown. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const ACTIONS = '<option value="">Choose action…</option><option value="resolved">✓ Resolved — it\'s safe</option><option value="quarantined">⛔ Quarantine</option><option value="analysis">🔍 Threat analysis</option>';
  const STATUS = { resolved: "✓ Resolved", quarantined: "⛔ Quarantined", "auto-quarantined": "⛔ Auto-quarantined", analysis: "🔍 Under analysis" };
  let open = false;
  let busy = false; // don't re-render while a dropdown is focused

  function ago(ts) {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return s + "s";
    if (s < 3600) return Math.round(s / 60) + "m";
    if (s < 86400) return Math.round(s / 3600) + "h";
    return Math.round(s / 86400) + "d";
  }

  function spark(series) {
    const svg = $("spark");
    const now = Math.floor(Date.now() / 60000) * 60000;
    const pts = [];
    for (let i = 29; i >= 0; i--) {
      const ts = now - i * 60000;
      const b = series.find((x) => x.ts === ts);
      pts.push(b ? b.requests : 0);
    }
    const max = Math.max(5, ...pts);
    const xy = pts.map((v, i) => [(i / 29) * 300, 37 - (v / max) * 33]);
    const line = xy.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
    svg.innerHTML =
      `<path d="${line} L300 40 L0 40 Z" fill="var(--accent-soft)"/>` +
      `<path d="${line}" fill="none" stroke="var(--accent)" stroke-width="1.6" vector-effect="non-scaling-stroke"/>`;
    $("netRate").textContent = pts[pts.length - 1] + " req/min";
  }

  function renderAlerts(events) {
    const list = $("alertList");
    list.textContent = "";
    const recent = events.slice(0, 25);
    if (!recent.length) {
      list.innerHTML = '<div class="empty"><b>All clear</b>No alerts yet. Phalanx is watching quietly.</div>';
      return;
    }
    for (const ev of recent) {
      const row = document.createElement("div");
      row.className = "al";
      const sv = document.createElement("span"); sv.className = "sv sev-" + ev.severity;
      const t = document.createElement("span"); t.className = "t"; t.textContent = ev.title;
      const tm = document.createElement("span"); tm.className = "tm"; tm.textContent = ago(ev.ts);
      const m = document.createElement("span"); m.className = "m";
      m.textContent = `${ev.severity.toUpperCase()} · ${ev.score}/100 · ${ev.host || ""}`;
      row.append(sv, t, tm, m);
      if (ev.status === "pending") {
        const sel = document.createElement("select");
        sel.innerHTML = ACTIONS;
        sel.addEventListener("focus", () => (busy = true));
        sel.addEventListener("blur", () => (busy = false));
        sel.addEventListener("change", async () => {
          if (!sel.value) return;
          sel.disabled = true;
          await chrome.runtime.sendMessage({ t: "decide", id: ev.id, action: sel.value, from: "popup" });
          busy = false;
          refresh();
        });
        row.append(sel);
      } else {
        const st = document.createElement("span");
        st.className = "st st-" + ev.status;
        st.textContent = STATUS[ev.status] || ev.status;
        row.append(st);
      }
      list.append(row);
    }
  }

  async function refresh() {
    if (busy) return;
    const s = await chrome.runtime.sendMessage({ t: "popup" });
    if (!s) return;
    window.phalanxApplyTheme(s.cfg);
    const pending = s.pending;
    $("kPending").textContent = pending;
    $("kPending").classList.toggle("hot", pending > 0);
    $("kQuar").textContent = s.events.filter((e) => /quarantined/.test(e.status)).length;
    $("kSites").textContent = s.stats.sitesScanned;
    $("kDl").textContent = s.stats.downloadsScanned;
    $("alertCount").textContent = pending ? pending + " pending" : s.events.length;
    $("alertCount").classList.toggle("hot", pending > 0);

    const sens = { low: "Low", medium: "Medium", high: "High" }[s.cfg.sensitivity] || "Medium";
    $("protToggle").checked = !s.paused;
    document.querySelector(".protect").classList.toggle("paused", s.paused);
    $("protTitle").textContent = s.paused ? "Protection paused" : "Protection active";
    $("protSub").textContent = `Sensitivity: ${sens} · Auto-quarantine ${s.cfg.autoQuarantine ? "on" : "off"}`;

    $("engineDot").className = "dot " + (s.engine.online ? "on" : "off");
    $("engineTxt").textContent = s.engine.online ? "App connected" : "App offline";

    if (!open && pending > 0 && !refresh.autoOpened) { refresh.autoOpened = true; setOpen(true); }
    renderAlerts(s.events);
    spark(s.series);
  }

  function setOpen(v) {
    open = v;
    document.querySelector(".alerts").classList.toggle("open", v);
    $("alertsHead").setAttribute("aria-expanded", String(v));
  }

  $("alertsHead").addEventListener("click", () => setOpen(!open));
  $("protToggle").addEventListener("change", async (e) => {
    await chrome.runtime.sendMessage({ t: "setPaused", paused: !e.target.checked });
    refresh();
  });
  $("clearDone").addEventListener("click", async () => { await chrome.runtime.sendMessage({ t: "clearDone" }); refresh(); });
  $("openApp").addEventListener("click", async () => {
    const r = await chrome.runtime.sendMessage({ t: "openApp", path: "/" });
    if (r && r.ok) return window.close();
    const hint = $("hint");
    hint.hidden = false;
    hint.textContent = "The Phalanx desktop app isn't running. Launching it… (allow the 'Open Phalanx?' prompt). If nothing happens, start Phalanx from the Start menu or desktop.";
    const tab = await chrome.tabs.create({ url: "phalanx://open", active: true });
    setTimeout(() => chrome.tabs.remove(tab.id).catch(() => {}), 6000);
  });

  refresh();
  setInterval(refresh, 2000);
})();
