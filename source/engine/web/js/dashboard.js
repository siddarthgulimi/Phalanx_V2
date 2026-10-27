(async function () {
  const content = await App.boot("dashboard", "Dashboard", "Live overview of what Phalanx is protecting you from");
  if (!content) return;
  const $ = (id) => document.getElementById(id);

  function posture(s) {
    const st = s.settings;
    const pending = s.totals.status.pending || 0;
    const sensPts = { low: 5, medium: 12, high: 15 }[st.sensitivity] || 10;
    const items = [
      [s.ext.online, 25, "Browser extension connected", s.ext.online ? "Live data is flowing from your browser" : "Install / enable the extension, then open your browser"],
      [!s.ext.paused, 15, "Protection running", s.ext.paused ? "Protection is paused in the extension popup" : "Not paused"],
      [st.autoQuarantine, 15, "Auto-quarantine", st.autoQuarantine ? "High & critical threats are stopped instantly" : "Turn on in Settings → Protection"],
      [st.sensitivity !== "low", sensPts, "Detection sensitivity: " + st.sensitivity, st.sensitivity === "low" ? "Low only reports severe threats" : "Good coverage"],
      [st.siteScan && st.downloadScan && st.domScan, 30, "All scanners enabled", "Site, download and page monitors"],
    ];
    let score = items.reduce((a, [ok, w]) => a + (ok ? w : 0), 0);
    if (st.sensitivity !== "low") score = Math.min(100, score);
    score = Math.max(0, score - Math.min(15, pending * 3));
    items.push([pending === 0, 0, pending ? `${pending} threat${pending > 1 ? "s" : ""} waiting for your decision` : "No pending threats", pending ? "Open Live threats to decide" : "Nothing needs your attention"]);
    const sev = score >= 85 ? "low" : score >= 60 ? "medium" : "critical";
    const g = PhalanxReportView.gauge(score, sev);
    g.setAttribute("aria-label", "Protection score " + score);
    g.querySelector("text:last-of-type").textContent = "/ 100 SAFE";
    $("postureGauge").replaceChildren(g);
    $("postureLabel").textContent = score >= 85 ? "Well protected" : score >= 60 ? "Partly protected" : "At risk";
    $("postureList").innerHTML = items.map(([ok, , t, d]) =>
      `<div class="check ${ok ? "ok" : "warn"}"><span class="ic">${ok ? "✓" : "!"}</span><div><div style="font-weight:600;color:var(--text-strong)">${App.esc(t)}</div><div class="dim" style="font-size:.82em">${App.esc(d)}</div></div></div>`).join("");
  }

  function kpis(s) {
    const x = s.ext.stats || {};
    const st = s.totals.status;
    const quar = (st.quarantined || 0) + (st["auto-quarantined"] || 0);
    const k = [
      ["Threats today", s.totals.today, `${s.totals.all} in history`],
      ["Waiting for you", st.pending || 0, "pending decisions", (st.pending || 0) > 0],
      ["Quarantined", quar, `${st.resolved || 0} marked safe`],
      ["Sites scanned", x.sitesScanned || 0, "before they loaded"],
      ["Downloads checked", x.downloadsScanned || 0, "files inspected"],
    ];
    $("kpis").innerHTML = k.map(([l, v, sub, hot]) => `<div class="kpi ${hot ? "hot" : ""}"><div class="v">${v}</div><div class="k">${l}</div><div class="s">${sub}</div></div>`).join("");
  }

  async function render() {
    const s = App.state;
    posture(s);
    kpis(s);
    const now = new Date();
    Charts.bars($("hourChart"), s.hours.map((v, i) => {
      const h = new Date(now.getTime() - (23 - i) * 3600000);
      const lab = h.getHours().toString().padStart(2, "0") + ":00";
      return { label: lab, short: i === 23 ? "now" : lab, value: v };
    }), { height: 130, label: "Detections per hour" });

    const series = s.ext.series || [];
    const m = Math.floor(Date.now() / 60000) * 60000;
    const pts = [];
    for (let i = 59; i >= 0; i--) {
      const ts = m - i * 60000;
      const b = series.find((x) => x.ts === ts);
      pts.push({ label: new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), value: b ? b.requests : 0 });
    }
    Charts.line($("netChart"), pts, { height: 160, unit: "req/min", label: "Requests per minute" });
    $("netNow").textContent = s.ext.online ? pts[pts.length - 1].value + " req/min now" : "extension offline";

    const sv = s.totals.severity;
    Charts.donut($("sevChart"), ["critical", "high", "medium", "low"].map((k) => ({ label: k[0].toUpperCase() + k.slice(1), value: sv[k] || 0, color: Charts.SEV_COLORS[k] })),
      { centerLabel: "threats" });
    const kd = s.totals.kind;
    Charts.hbars($("kindChart"), [
      { label: "Page tampering (injected forms, scripts, overlays)", value: kd.dom || 0, color: "var(--chart-1)" },
      { label: "Risky websites (phishing, piracy, suspicious hosts)", value: kd.site || 0, color: "var(--chart-2)" },
      { label: "Risky downloads", value: kd.download || 0, color: "var(--chart-3)" },
    ]);
    Charts.hbars($("topHosts"), s.topHosts.map((h) => ({ label: h.k, value: h.v, color: "var(--sev-high)" })), { empty: "No risky sources yet — that's good." });

    const recent = await App.api("/api/events?limit=8");
    const box = $("recent");
    box.textContent = "";
    if (!recent.length) {
      box.innerHTML = '<div class="empty"><b>No detections yet</b>Browse normally — or open the Test lab (left menu) to see Phalanx in action.</div>';
      return;
    }
    const tbl = document.createElement("table");
    tbl.className = "tbl";
    tbl.innerHTML = "<thead><tr><th>When</th><th>Threat</th><th>Source</th><th>Severity</th><th>Status</th><th></th></tr></thead><tbody></tbody>";
    for (const ev of recent) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="dim" style="white-space:nowrap">${App.ago(ev.ts)}</td><td><a href="/analysis.html?id=${encodeURIComponent(ev.id)}">${App.esc(ev.title)}</a><div class="dim" style="font-size:.82em">${App.kind(ev.kind)}</div></td>
        <td class="mono ellipsis" style="max-width:220px">${App.esc(ev.host || "")}</td><td>${App.sev(ev.severity)} <span class="score-pill">${ev.score}</span></td><td>${App.status(ev.status)}</td><td class="act"></td>`;
      if (ev.status === "pending") tr.querySelector(".act").append(App.actionSelect(ev, render));
      tbl.tBodies[0].append(tr);
    }
    box.append(tbl);
  }
  render();
  App.on(render);
  let w = window.innerWidth;
  window.addEventListener("resize", () => { if (Math.abs(window.innerWidth - w) > 40) { w = window.innerWidth; render(); } });
})();
