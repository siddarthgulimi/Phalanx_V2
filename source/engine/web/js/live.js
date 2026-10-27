(async function () {
  const content = await App.boot("live", "Live threats", "Decide what happens to each alert — nothing is lost, everything stays in History");
  if (!content) return;
  const $ = (id) => document.getElementById(id);
  let kind = "";

  function card(ev) {
    const d = document.createElement("div");
    d.className = "threat";
    const sig = (ev.signals || []).filter((s) => s.weight > 0).slice(0, 3).map((s) => s.label).join(" · ");
    d.innerHTML = `<span class="bar" style="background:var(--sev-${ev.severity})"></span>
      <div><div class="ttl">${App.esc(ev.title)}</div>
        <div class="meta"><span>${App.kind(ev.kind)}</span><span class="mono">${App.esc(ev.host || "")}</span><span>${App.ago(ev.ts)}</span></div></div>
      <div class="act"><div class="row">${App.sev(ev.severity)}<span class="score-pill">${ev.score}/100</span></div></div>
      <div class="why">${App.esc(sig || "")}</div>`;
    const act = d.querySelector(".act");
    act.append(App.actionSelect(ev, render));
    const a = document.createElement("a");
    a.href = "/analysis.html?id=" + encodeURIComponent(ev.id);
    a.textContent = "Details →";
    a.style.fontSize = ".85em";
    act.append(a);
    return d;
  }

  async function render() {
    const q = "&kind=" + encodeURIComponent(kind);
    const [pending, recent] = await Promise.all([
      App.api("/api/events?status=pending" + q),
      App.api("/api/events?limit=60" + q),
    ]);
    const box = $("pending");
    box.textContent = "";
    $("pendTitle").textContent = pending.length ? `Waiting for your decision (${pending.length})` : "Waiting for your decision";
    if (!pending.length) box.innerHTML = '<div class="card empty"><b>Nothing waiting ✓</b>New alerts appear here instantly. High & critical threats are auto-quarantined when that setting is on.</div>';
    pending.forEach((ev) => box.append(card(ev)));

    const done = recent.filter((e) => e.status !== "pending").slice(0, 12);
    const h = $("handled");
    if (!done.length) { h.innerHTML = '<div class="empty">No handled alerts yet.</div>'; return; }
    h.innerHTML = `<table class="tbl"><thead><tr><th>When</th><th>Threat</th><th>Source</th><th>Severity</th><th>Outcome</th></tr></thead><tbody>${
      done.map((ev) => `<tr><td class="dim">${App.ago(ev.ts)}</td><td><a href="/analysis.html?id=${encodeURIComponent(ev.id)}">${App.esc(ev.title)}</a></td><td class="mono">${App.esc(ev.host || "")}</td><td>${App.sev(ev.severity)}</td><td>${App.status(ev.status)}</td></tr>`).join("")
    }</tbody></table>`;
  }

  $("kindSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    kind = b.dataset.k;
    $("kindSeg").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    render();
  });
  async function bulk(filter, action, label) {
    const list = (await App.api("/api/events?status=pending&kind=" + encodeURIComponent(kind))).filter(filter);
    if (!list.length) return App.toast("Nothing to " + label);
    if (!confirm(`${label} ${list.length} alert(s)?`)) return;
    for (const ev of list) await App.api("/api/event?id=" + encodeURIComponent(ev.id), { body: { action } });
    App.toast(`${list.length} alert(s) updated`);
    render();
  }
  $("resolveLow").onclick = () => bulk((e) => e.severity === "low", "resolved", "Resolve");
  $("quarHigh").onclick = () => bulk((e) => e.severity === "high" || e.severity === "critical", "quarantined", "Quarantine");
  render();
  App.on(render);
})();
