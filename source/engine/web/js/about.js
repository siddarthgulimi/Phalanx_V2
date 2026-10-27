(async function () {
  const content = await App.boot("about", "About Phalanx", "What it does, how it works, and who built it");
  if (!content) return;
  const $ = (id) => document.getElementById(id);
  const I = window.PhalanxIntel;

  /* ---- Credits: edit these two lines to change the credited project ---- */
  const CREDITS = {
    author: "Siddharth Gulumi",
    repo: "", // e.g. "https://github.com/<user>/<dom-interceptor-repo>"  (paste the public repository link here)
  };

  $("ramKpi").textContent = "~" + Math.max(8, Math.round(App.state.engine.memMB));

  /* ---------- architecture diagram ---------- */
  const NS = "http://www.w3.org/2000/svg";
  function s(tag, a, parent, text) {
    const e = document.createElementNS(NS, tag);
    for (const k in a) e.setAttribute(k, a[k]);
    if (text != null) e.textContent = text;
    if (parent) parent.append(e);
    return e;
  }
  const svg = s("svg", { viewBox: "0 -26 1000 356", role: "img", "aria-label": "Phalanx architecture: web page, browser extension, desktop engine, you", style: "width:100%;height:auto;display:block" });
  const defs = s("defs", {}, svg);
  const mk = s("marker", { id: "arr", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, defs);
  s("path", { d: "M0,0 L10,5 L0,10 z", fill: "var(--text-dim)" }, mk);

  const tip = document.createElement("div");
  tip.className = "tip";
  document.body.append(tip);
  function box(x, y, w, h, title, sub, items, desc) {
    const g = s("g", { style: "cursor:default" }, svg);
    s("rect", { x, y, width: w, height: h, rx: 10, fill: "var(--panel-2)", stroke: "var(--border-strong)" }, g);
    s("rect", { x, y, width: w, height: 4, rx: 2, fill: "var(--accent)" }, g);
    s("text", { x: x + 14, y: y + 28, fill: "var(--text-strong)", "font-weight": 700, "font-size": 15, "font-family": "var(--font-ui)" }, g, title);
    if (sub) s("text", { x: x + 14, y: y + 46, fill: "var(--text-dim)", "font-size": 11.5, "font-family": "var(--font-ui)" }, g, sub);
    (items || []).forEach((it, i) => {
      const yy = y + 62 + i * 38;
      s("rect", { x: x + 12, y: yy, width: w - 24, height: 30, rx: 6, fill: "var(--bg-inset)", stroke: "var(--border)" }, g);
      s("circle", { cx: x + 26, cy: yy + 15, r: 4, fill: it[1] || "var(--accent)" }, g);
      s("text", { x: x + 38, y: yy + 19.5, fill: "var(--text)", "font-size": 12.5, "font-family": "var(--font-ui)" }, g, it[0]);
    });
    g.addEventListener("mousemove", (e) => { tip.textContent = desc; tip.style.display = "block"; tip.style.whiteSpace = "normal"; tip.style.maxWidth = "280px"; tip.style.left = Math.min(innerWidth - 300, e.clientX + 14) + "px"; tip.style.top = e.clientY + 14 + "px"; });
    g.addEventListener("mouseleave", () => (tip.style.display = "none"));
  }
  function arrow(x1, y1, x2, y2, label, dy) {
    s("path", { d: `M${x1},${y1} L${x2},${y2}`, stroke: "var(--text-dim)", "stroke-width": 1.6, fill: "none", "marker-end": "url(#arr)" }, svg);
    if (label) s("text", { x: (x1 + x2) / 2, y: (y1 + y2) / 2 + (dy || -8), "text-anchor": "middle", fill: "var(--text-dim)", "font-size": 11, "font-family": "var(--font-mono)" }, svg, label);
  }
  box(10, 70, 170, 190, "Web page", "what you browse", [["Website address", "var(--chart-2)"], ["Downloads", "var(--chart-3)"], ["Injected code", "var(--sev-high)"]],
    "Anything the internet sends you: the address you open, files you download, and code that a compromised page or ad injects after loading.");
  box(240, 40, 250, 250, "Browser extension", "layer 1 · runs inside Chrome / Edge", [["Site scanner — before load"], ["Download inspector"], ["Page (DOM) monitor"], ["3-second grouped alert", "var(--sev-medium)"], ["Resolved · Quarantine · Analysis", "var(--accent-2)"]],
    "Lightweight extension. Scores websites before they load, checks downloads, watches pages for injected forms/scripts/frames, shows one small alert and applies your decision.");
  box(560, 40, 220, 250, "Phalanx.exe engine", "layer 2 · desktop app", [["History store (disk)"], ["Phalanx Analyst"], ["Settings & site lists"], ["Cache folder manager"], ["Reports & export"]],
    "Small native program on your PC. Keeps full history, explains every threat, owns settings and the cache folder, and serves this app window. Talks to the extension only over 127.0.0.1.");
  box(840, 70, 150, 190, "You", "layer 3 · decisions", [["Dashboard"], ["Live threats"], ["History & reports"]],
    "You stay in control: every alert can be resolved, quarantined or sent to Threat analysis — from the page, the toolbar popup, or this app.");
  arrow(180, 140, 238, 140, "observes", -8);
  arrow(490, 120, 558, 120, "events", -8);
  arrow(558, 210, 490, 210, "settings", 16);
  arrow(780, 140, 838, 140, "live", -8);
  arrow(838, 200, 780, 200, "choices", 16);
  s("path", { d: "M365,40 C365,6 915,6 915,68", stroke: "var(--sev-medium)", "stroke-width": 1.6, fill: "none", "stroke-dasharray": "5 4", "marker-end": "url(#arr)" }, svg);
  s("text", { x: 640, y: -8, "text-anchor": "middle", fill: "var(--sev-medium)", "font-size": 11.5, "font-family": "var(--font-mono)" }, svg, "instant in-page alert (3 s)");
  s("text", { x: 500, y: 322, "text-anchor": "middle", fill: "var(--text-dim)", "font-size": 11.5, "font-family": "var(--font-ui)" }, svg,
    "Nothing leaves your computer: the extension and the engine talk over 127.0.0.1 only.");
  $("arch").append(svg);

  /* ---------- risk scale ---------- */
  const scale = document.createElementNS(NS, "svg");
  scale.setAttribute("viewBox", "0 0 500 92");
  scale.style.cssText = "width:100%;height:auto;display:block";
  const bands = [[0, 20, "info", "Info"], [20, 45, "low", "Low"], [45, 70, "medium", "Medium"], [70, 90, "high", "High"], [90, 100, "critical", "Crit."]];
  const X = (v) => 10 + v * 4.8;
  bands.forEach(([a, b, k, l]) => {
    s("rect", { x: X(a) + 1, y: 30, width: X(b) - X(a) - 2, height: 18, rx: 4, fill: `var(--sev-${k})`, opacity: 0.85 }, scale);
    s("text", { x: (X(a) + X(b)) / 2, y: 64, "text-anchor": "middle", fill: "var(--text-dim)", "font-size": 11, "font-family": "var(--font-mono)" }, scale, l);
  });
  [["Low", 70], ["Medium", 45], ["High", 20]].forEach(([l, v], i) => {
    s("line", { x1: X(v), x2: X(v), y1: 22 - i * 0, y2: 52, stroke: "var(--text-strong)", "stroke-width": 1.5 }, scale);
    s("text", { x: X(v), y: 16, "text-anchor": "middle", fill: "var(--text-strong)", "font-size": 10.5, "font-family": "var(--font-ui)" }, scale, l + " ≥" + v);
  });
  [0, 50, 100].forEach((v) => s("text", { x: X(v), y: 84, "text-anchor": "middle", fill: "var(--text-dim)", "font-size": 10, "font-family": "var(--font-mono)" }, scale, v));
  $("scale").append(scale);
  $("scaleTbl").innerHTML = `<thead><tr><th>Band</th><th>Score</th><th>Meaning</th></tr></thead><tbody>${
    PhalanxAnalyst.SCALE.map((b) => `<tr><td><span class="chip sev-${b.label.toLowerCase()}">${b.label}</span></td><td class="mono">${b.from}–${b.to}</td><td>${b.text}</td></tr>`).join("")}</tbody>`;

  /* ---------- detection table ---------- */
  const R = I.DOM_RULES;
  const rows = [
    ["Page", R.credential_form_foreign.title, R.credential_form_foreign.score],
    ["Page", R.form_hijack.title, R.form_hijack.score],
    ["Page", R.clickjack_iframe.title, R.clickjack_iframe.score],
    ["Page", R.credential_overlay.title, R.credential_overlay.score],
    ["Page", R.script_known_bad.title, R.script_known_bad.score],
    ["Page", R.script_suspicious_host.title, R.script_suspicious_host.score],
    ["Page", R.handler_dangerous.title, R.handler_dangerous.score],
    ["Page", R.hidden_iframe.title, R.hidden_iframe.score],
    ["Website", "Fake brand login (e.g. paypal-secure-login.tk)", 100],
    ["Website", "Piracy / torrent site (e.g. The Pirate Bay)", 55],
    ["Website", "Raw IP address over HTTP", 45],
    ["Download", "Disguised executable (invoice.pdf.exe)", 80],
    ["Download", "Cracked software from a piracy site", 68],
    ["Download", "Safe Browsing: known malware", 95],
    ["Page", R.script_third_party.title, R.script_third_party.score],
    ["Page", R.overlay_div.title, R.overlay_div.score],
  ];
  $("detectTbl").innerHTML = `<thead><tr><th>Layer</th><th>Threat</th><th class="num">Score</th><th>Severity</th><th class="num">Low</th><th class="num">Medium</th><th class="num">High</th></tr></thead><tbody>${
    rows.map(([layer, t, sc]) => `<tr><td class="dim">${layer}</td><td>${App.esc(t)}</td><td class="num">${sc}</td><td>${App.sev(I.severityOf(sc))}</td>${
      ["low", "medium", "high"].map((k) => `<td class="num" style="color:${sc >= I.thresholdFor(k) ? "var(--ok)" : "var(--text-dim)"}">${sc >= I.thresholdFor(k) ? "✓" : "—"}</td>`).join("")}</tr>`).join("")
  }</tbody>`;

  /* ---------- decision flow ---------- */
  $("flow").innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;align-items:stretch">
      ${[
        ["1 · Detect", "Score ≥ your sensitivity threshold.", "var(--accent)"],
        ["2 · Contain", "High/critical + auto-quarantine → stopped instantly. Others are held (hidden element, paused download).", "var(--sev-high)"],
        ["3 · Alert", "One compact box on the page, grouped, gone after 3 s. Also in the toolbar popup and this app.", "var(--sev-medium)"],
        ["4 · You decide", "Pick one of three options from the drop-down.", "var(--accent-2)"],
      ].map(([t, d, c]) => `<div class="card" style="border-top:3px solid ${c}"><b style="color:var(--text-strong)">${t}</b><p class="dim" style="margin:6px 0 0;font-size:.9em">${d}</p></div>`).join("")}
    </div>
    <div class="grid g3" style="margin-top:12px">
      <div class="card"><span class="chip plain st-resolved">✓ Resolved</span><p style="margin:8px 0 0;font-size:.92em">It's safe. The element is restored / the download continues / the site is added to your trusted list.</p></div>
      <div class="card"><span class="chip plain st-quarantined">⛔ Quarantine</span><p style="margin:8px 0 0;font-size:.92em">Removed for good: element deleted, download cancelled or file deleted, site blocked on future visits.</p></div>
      <div class="card"><span class="chip plain st-analysis">🔍 Threat analysis</span><p style="margin:8px 0 0;font-size:.92em">Moves it to the Analysis page: severity gauge, where it came from, evidence, recommendations and what to do next.</p></div>
    </div>`;

  /* ---------- credits ---------- */
  $("edLabel").textContent = App.edition.label + " edition · v" + App.state.version;
  $("credAvatar").textContent = CREDITS.author.charAt(0);
  $("credName").textContent = CREDITS.author;
  $("credRole").textContent = "Creator of the original DOM Interceptor";
  $("credText").textContent = `Phalanx builds on the DOM Interceptor concept created by ${CREDITS.author}: watching a page's DOM with a MutationObserver to catch code injected after load. Phalanx 2.0 adds site and download scanning, a desktop engine, threat analysis and reporting.`;
  const links = $("credLinks");
  if (CREDITS.repo) {
    const a = document.createElement("button");
    a.className = "btn primary";
    a.textContent = "View the original repository on GitHub ↗";
    a.onclick = () => App.api("/api/open", { body: { target: "url", url: CREDITS.repo } });
    links.append(a);
    const code = document.createElement("span");
    code.className = "code";
    code.textContent = CREDITS.repo.replace("https://", "");
    links.append(code);
  } else {
    links.innerHTML = '<span class="dim">Repository link coming soon.</span>';
  }
  $("timeline").innerHTML = `<table class="tbl"><thead><tr><th>Version</th><th>What it added</th></tr></thead><tbody>
    <tr><td class="mono">DOM Interceptor</td><td>MutationObserver-based detection of injected DOM content (original project by ${App.esc(CREDITS.author)}).</td></tr>
    <tr><td class="mono">Phalanx 1.0</td><td>Chrome extension with credential-form, script and overlay detection, Safe Browsing download check, dashboard window.</td></tr>
    <tr><td class="mono">Phalanx 2.0</td><td>Desktop engine (Phalanx.exe), unified 0–100 scoring, working Low/Medium/High sensitivity, trusted-site list, piracy &amp; phishing detection, 3-second grouped alerts, Resolved / Quarantine / Threat analysis, history &amp; reports, cache folder control, test lab.</td></tr>
  </tbody></table>`;

  $("openExt").onclick = async () => { try { await App.api("/api/open", { body: { target: "extension-folder" } }); } catch (e) { App.toast(e.message, true); } };
  $("copyExt").onclick = async () => { try { await navigator.clipboard.writeText("chrome://extensions"); App.toast("Copied — paste it into your browser's address bar"); } catch (e) { App.toast("Type chrome://extensions in your browser's address bar"); } };
})();
