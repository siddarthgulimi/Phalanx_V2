(async function () {
  const content = await App.boot("history", "History & reports", "Every threat Phalanx has seen — searchable, exportable, never silently deleted");
  if (!content) return;
  const $ = (id) => document.getElementById(id);
  const PAGE = 50;
  let page = 0, data = [], tab = new URLSearchParams(location.search).get("tab") === "report" ? "report" : "history";

  function query() {
    const p = new URLSearchParams();
    const days = +$("range").value;
    if (days) p.set("since", Date.now() - days * 86400000);
    for (const [k, id] of [["q", "q"], ["kind", "kind"], ["severity", "sev"], ["status", "status"]]) if ($(id).value) p.set(k, $(id).value);
    return p;
  }

  async function load() {
    data = await App.api("/api/events?" + query().toString());
    page = 0;
    tab === "report" ? report() : table();
  }

  function table() {
    const rows = data.slice(page * PAGE, page * PAGE + PAGE);
    $("count").textContent = data.length ? `${page * PAGE + 1}–${page * PAGE + rows.length} of ${data.length}` : "";
    $("prev").disabled = page === 0;
    $("next").disabled = (page + 1) * PAGE >= data.length;
    if (!data.length) { $("tbl").innerHTML = '<div class="empty"><b>No threats match</b>Try a wider date range or clear the filters.</div>'; return; }
    $("tbl").innerHTML = `<table class="tbl"><thead><tr><th>Time</th><th>Threat</th><th>Type</th><th>Source</th><th class="num">Score</th><th>Severity</th><th>Outcome</th></tr></thead><tbody>${
      rows.map((ev) => `<tr><td class="dim" style="white-space:nowrap">${App.time(ev.ts)}</td>
        <td><a href="/analysis.html?id=${encodeURIComponent(ev.id)}">${App.esc(ev.title)}</a></td><td>${App.kind(ev.kind)}</td>
        <td class="mono ellipsis" style="max-width:240px" title="${App.esc(ev.url || "")}">${App.esc(ev.host || "")}</td>
        <td class="num">${ev.score}</td><td>${App.sev(ev.severity)}</td><td>${App.status(ev.status)}</td></tr>`).join("")
    }</tbody></table>`;
  }

  function count(arr, key) { const m = {}; arr.forEach((e) => { const k = typeof key === "function" ? key(e) : e[key]; if (k) m[k] = (m[k] || 0) + 1; }); return m; }

  function report() {
    const days = +$("range").value;
    const label = { 1: "last 24 hours", 7: "last 7 days", 30: "last 30 days", 0: "all time" }[days];
    $("repTitle").textContent = "Security report — " + label;
    $("repSub").textContent = `Generated ${new Date().toLocaleString()} for ${App.state.profile || "you"} · Phalanx ${App.state.version}`;
    const st = count(data, "status");
    const sev = count(data, "severity");
    const quar = (st.quarantined || 0) + (st["auto-quarantined"] || 0);
    const serious = (sev.critical || 0) + (sev.high || 0);
    const handled = data.length ? Math.round(((data.length - (st.pending || 0)) / data.length) * 100) : 100;
    const grade = serious === 0 ? "Low risk period" : serious < 5 ? "Moderate risk period" : "High risk period";
    $("repGrade").textContent = grade;
    $("repKpis").innerHTML = [
      ["Threats detected", data.length], ["High / critical", serious], ["Quarantined", quar], ["Marked safe", st.resolved || 0], ["Handled", handled + "%"],
    ].map(([k, v]) => `<div class="kpi"><div class="v">${v}</div><div class="k">${k}</div></div>`).join("");

    const n = days === 1 ? 24 : days || 30;
    const unit = days === 1 ? 3600000 : 86400000;
    const buckets = [];
    const end = days === 1 ? Math.floor(Date.now() / unit) * unit : new Date().setHours(0, 0, 0, 0);
    for (let i = n - 1; i >= 0; i--) {
      const start = end - i * unit;
      const v = data.filter((e) => e.ts >= start && e.ts < start + unit).length;
      const d = new Date(start);
      const lab = days === 1 ? d.getHours().toString().padStart(2, "0") + ":00" : d.toLocaleDateString([], { month: "short", day: "numeric" });
      buckets.push({ label: lab, value: v });
    }
    Charts.bars($("repDays"), buckets, { height: 160 });
    Charts.donut($("repSev"), ["critical", "high", "medium", "low"].map((k) => ({ label: k[0].toUpperCase() + k.slice(1), value: sev[k] || 0, color: Charts.SEV_COLORS[k] })), { centerLabel: "threats" });
    const CAT = { dom: "Page tampering", piracy: "Piracy / torrent", phishing: "Phishing / impersonation", malware: "Malware", "suspicious-host": "Suspicious host", redirect: "Hidden redirect", download: "Risky download", blocked: "Blocked site", general: "Risky website" };
    const cat = count(data, (e) => CAT[e.category] || CAT[e.kind] || e.category);
    Charts.hbars($("repCat"), Object.entries(cat).sort((a, b) => b[1] - a[1]).map(([k, v], i) => ({ label: k, value: v, color: ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"][i % 3] })));
    Charts.hbars($("repOut"), [
      { label: "Auto-quarantined (instant)", value: st["auto-quarantined"] || 0, color: "var(--sev-high)" },
      { label: "Quarantined by you", value: st.quarantined || 0, color: "var(--sev-medium)" },
      { label: "Marked safe (resolved)", value: st.resolved || 0, color: "var(--ok)" },
      { label: "Under analysis", value: st.analysis || 0, color: "var(--accent-2)" },
      { label: "Still pending", value: st.pending || 0, color: "var(--sev-low)" },
    ]);
    const hosts = count(data, (e) => e.site || e.host);
    Charts.hbars($("repHosts"), Object.entries(hosts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => ({ label: k, value: v, color: "var(--sev-high)" })));

    const recs = [];
    if (!data.length) recs.push("No threats in this period. Keep the extension enabled and your browser updated.");
    if (st.pending) recs.push(`${st.pending} alert(s) are still waiting for a decision — review them in Live threats.`);
    if (cat["Piracy / torrent"]) recs.push(`You visited ${cat["Piracy / torrent"]} piracy/torrent site(s). These are a leading source of malware — prefer official stores and legal streaming.`);
    if (cat["Phishing / impersonation"]) recs.push("Phishing-style addresses were detected. Always check the real domain before signing in and enable 2-step verification.");
    if (cat["Risky download"] || cat["Malware"]) recs.push("Risky downloads were seen. Run a Windows Security full scan if you opened any of them.");
    if (cat["Page tampering"]) recs.push("Pages were modified after loading. Review your browser extensions and remove ones you don't use.");
    if (serious >= 5) recs.push("Many high-severity events: consider raising sensitivity and keeping auto-quarantine on.");
    if (!App.state.settings.autoQuarantine) recs.push("Auto-quarantine is off — high & critical threats wait for you instead of being stopped instantly.");
    $("repRecs").innerHTML = recs.map((r) => `<li style="margin:6px 0">${App.esc(r)}</li>`).join("");

    const top = data.slice().sort((a, b) => b.score - a.score).slice(0, 8);
    $("repTop").innerHTML = top.length ? `<table class="tbl"><thead><tr><th>Threat</th><th>Source</th><th class="num">Score</th><th>Outcome</th><th>When</th></tr></thead><tbody>${
      top.map((ev) => `<tr><td><a href="/analysis.html?id=${encodeURIComponent(ev.id)}">${App.esc(ev.title)}</a></td><td class="mono">${App.esc(ev.host || "")}</td><td class="num">${ev.score}</td><td>${App.status(ev.status)}</td><td class="dim">${App.time(ev.ts)}</td></tr>`).join("")
    }</tbody></table>` : '<div class="empty">Nothing to show.</div>';
  }

  function setTab(t) {
    tab = t;
    $("tabs").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
    $("historyTab").hidden = t !== "history";
    $("reportTab").hidden = t !== "report";
    t === "report" ? report() : table();
  }
  $("tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setTab(b.dataset.t); });
  ["range", "kind", "sev", "status"].forEach((id) => $(id).addEventListener("change", load));
  let qt; $("q").addEventListener("input", () => { clearTimeout(qt); qt = setTimeout(load, 250); });
  $("prev").onclick = () => { page--; table(); };
  $("next").onclick = () => { page++; table(); };
  $("csv").onclick = () => { location.href = "/api/export?format=csv&" + query().toString(); };
  $("json").onclick = () => { location.href = "/api/export?format=json&" + query().toString(); };
  $("print").onclick = () => { setTab("report"); setTimeout(() => window.print(), 300); };
  setTab(tab);
  await load();
  App.on((w) => { if (w === "events") load(); });
})();
