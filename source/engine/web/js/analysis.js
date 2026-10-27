(async function () {
  const content = await App.boot("analysis", "Threat analysis", "Plain-language breakdown: what it is, where it came from, how serious it is, and what to do");
  if (!content) return;
  const $ = (id) => document.getElementById(id);
  let scope = "analysis";
  let current = new URLSearchParams(location.search).get("id");

  function runAnalyst() {
    // The analysis itself is instant; the step strip shows which stages ran.
    const steps = document.querySelectorAll("#analyst .check");
    steps.forEach((s) => { s.className = "check run"; s.querySelector(".ic").textContent = ""; });
    steps.forEach((s, i) => setTimeout(() => { s.className = "check ok"; s.querySelector(".ic").textContent = "✓"; }, 140 * (i + 1)));
  }

  async function list() {
    let items = scope === "analysis" ? await App.api("/api/events?status=analysis") : await App.api("/api/events?limit=80");
    if (scope === "analysis" && !items.length && !list.switched) {
      list.switched = true; // nothing queued: show recent threats instead of an empty page
      scope = "all";
      $("scopeSeg").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.s === "all"));
      items = await App.api("/api/events?limit=80");
    }
    const box = $("list");
    box.textContent = "";
    if (!items.length) {
      box.innerHTML = scope === "analysis"
        ? '<div class="empty"><b>Nothing under analysis</b>Pick "Threat analysis" on any alert to move it here.</div>'
        : '<div class="empty">No events yet.</div>';
    }
    if (!current && items[0]) current = items[0].id;
    for (const ev of items) {
      const d = document.createElement("div");
      d.className = "list-item" + (ev.id === current ? " on" : "");
      d.innerHTML = `<span class="dot" style="background:var(--sev-${App.esc(ev.severity)});margin-top:7px"></span><span class="t">${App.esc(ev.title)}</span><span class="mono dim" style="font-size:.8em">${ev.score}</span><span class="m">${App.kind(ev.kind)} · ${App.esc(ev.host || "")} · ${App.ago(ev.ts)}</span>`;
      d.onclick = () => { current = ev.id; history.replaceState(null, "", "?id=" + encodeURIComponent(ev.id)); list(); show(); };
      box.append(d);
    }
  }

  async function show() {
    const box = $("report");
    if (!current) {
      box.innerHTML = '<div class="card empty"><b>Select a threat</b>Choose an item on the left, or send one here from Live threats.</div>';
      document.querySelectorAll("#analyst .check").forEach((s) => (s.className = "check"));
      return;
    }
    let ev;
    try { ev = await App.api("/api/event?id=" + encodeURIComponent(current)); } catch (e) { box.innerHTML = '<div class="card empty"><b>Threat not found</b>It may not have synced yet — wait a few seconds.</div>'; return; }
    runAnalyst();
    const back = ev.status === "analysis" ? (() => { const b = document.createElement("button"); b.className = "btn ghost"; b.textContent = "↩ Back to live threats"; b.onclick = () => act("pending"); return b; })() : null;
    PhalanxReportView.render(box, ev, { onAction: act, extra: back });
  }
  async function act(action) {
    try { await App.decide(current, action); } catch (e) { return App.toast(e.message, true); }
    list(); show();
  }

  $("scopeSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    scope = b.dataset.s;
    $("scopeSeg").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    list();
  });
  await list();
  show();
  App.on((what) => { if (what === "events") list(); });
})();
