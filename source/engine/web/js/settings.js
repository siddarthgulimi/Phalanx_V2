(async function () {
  const content = await App.boot("settings", "Settings", "Everything that controls the engine and the browser extension, in one place");
  if (!content) return;
  const $ = (id) => document.getElementById(id);
  const ED = App.edition;

  // accent options depend on the edition (Original: green/amber, Pink: rose/lavender)
  $("accentSeg").innerHTML = ED.accents.map(([v, l]) => `<button data-v="${v}">${l}</button>`).join("");
  $("edDesc").textContent = `${ED.label} edition palette.`;

  const I = window.PhalanxIntel;
  const rows = [
    ["Fake login form sending passwords to another site", 92], ["Script from a known-malicious host", 95], ["Clickjacking (invisible frame)", 85],
    ["Phishing / brand look-alike website", 70], ["Disguised executable (.pdf.exe)", 80], ["Piracy / torrent website", 55],
    ["Hidden frame loading a foreign site", 55], ["Raw-IP website over HTTP", 45], ["New third-party script", 30], ["Full-screen pop-up overlay", 25],
  ];
  $("sensTable").innerHTML = `<thead><tr><th>Example</th><th class="num">Score</th><th class="num">Low</th><th class="num">Medium</th><th class="num">High</th></tr></thead><tbody>${
    rows.map(([l, s]) => `<tr><td>${l}</td><td class="num">${s}</td>${["low", "medium", "high"].map((k) => `<td class="num" style="color:${s >= I.thresholdFor(k) ? "var(--ok)" : "var(--text-dim)"}">${s >= I.thresholdFor(k) ? "✓ alert" : "—"}</td>`).join("")}</tr>`).join("")
  }<tr><td class="dim">Alert threshold</td><td></td><td class="num mono">≥70</td><td class="num mono">≥45</td><td class="num mono">≥20</td></tr></tbody>`;

  function paint(s) {
    document.querySelectorAll(".seg[data-key]").forEach((seg) => {
      const k = seg.dataset.key;
      let v = s[k];
      if (k === "accent" && !v) v = ED.defaultAccent;
      seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", String(b.dataset.v) === String(v)));
    });
    document.querySelectorAll("input[type=checkbox][data-key]").forEach((c) => (c.checked = !!s[c.dataset.key]));
    const e = App.state.engine;
    $("engineInfo").textContent = `Engine RAM ≈ ${e.memMB.toFixed(1)} MB · up ${Math.round(App.state.uptime / 60)} min · PID ${e.pid}. The extension keeps state in memory and writes to disk at most every few seconds.`;
  }
  async function save(patch) {
    const s = await App.api("/api/settings", { body: patch });
    App.settings = App.state.settings = s;
    App.applyTheme(s);
    paint(s);
    App.toast("Saved — the extension picks this up within seconds");
  }
  document.querySelectorAll(".seg[data-key]").forEach((seg) => seg.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    let v = b.dataset.v;
    if (seg.dataset.key === "historyDays") v = +v;
    save({ [seg.dataset.key]: v });
  }));
  document.querySelectorAll("input[type=checkbox][data-key]").forEach((c) => c.addEventListener("change", () => save({ [c.dataset.key]: c.checked })));

  // lists
  function paintList(id, items, list) {
    const box = $(id);
    box.innerHTML = items.length ? "" : '<div class="dim" style="font-size:.85em">None yet.</div>';
    items.forEach((site) => {
      const r = document.createElement("div");
      r.className = "row";
      r.style.cssText = "padding:5px 0;border-bottom:1px solid var(--border)";
      r.innerHTML = `<span class="mono grow ellipsis">${App.esc(site)}</span>`;
      const x = document.createElement("button"); x.className = "btn ghost sm"; x.textContent = "Remove";
      x.onclick = async () => lists(await App.api("/api/lists", { body: { list, op: "remove", site } }));
      r.append(x);
      box.append(r);
    });
  }
  function lists(l) { paintList("allowList", l.allow, "allow"); paintList("blockList", l.block, "block"); }
  lists(await App.api("/api/lists"));
  for (const [f, inp, list] of [["allowForm", "allowIn", "allow"], ["blockForm", "blockIn", "block"]]) {
    $(f).addEventListener("submit", async (e) => {
      e.preventDefault();
      let v = $(inp).value.trim().toLowerCase();
      try { if (v.includes("/")) v = new URL(v.includes("://") ? v : "https://" + v).hostname; } catch (er) { /* keep */ }
      v = v.replace(/^www\./, "");
      if (!v) return;
      lists(await App.api("/api/lists", { body: { list, op: "add", site: v } }));
      $(inp).value = "";
    });
  }

  // storage
  async function cache() {
    const c = await App.api("/api/cache");
    $("dataDir").textContent = c.dataDir;
    $("defDir").textContent = c.dataDir === c.defaultDir ? "This is the default location (next to Phalanx.exe)." : "Default: " + c.defaultDir;
    $("browse").hidden = !c.canBrowse;
    $("cacheRows").innerHTML = c.parts.map((p) => `<tr><td>${p.clearable ? `<input type="checkbox" class="cpart" value="${p.key}" checked />` : ""}</td>
      <td><b style="color:var(--text-strong)">${p.label}</b><div class="dim" style="font-size:.84em">${p.desc}</div></td><td class="num">${App.bytes(p.bytes)}</td></tr>`).join("");
    $("cacheTotal").textContent = "Total on disk: " + App.bytes(c.total);
  }
  cache();
  $("openData").onclick = () => App.api("/api/open", { body: { target: "data-folder" } });
  $("browse").onclick = async () => { try { const r = await App.api("/api/cache/browse", { body: {} }); $("newDir").value = r.path; } catch (e) { if (e.message !== "cancelled") App.toast(e.message, true); } };
  $("moveDir").onclick = async () => {
    const p = $("newDir").value.trim();
    if (!p) return App.toast("Type or browse to a folder first", true);
    try { await App.api("/api/cache/location", { body: { path: p } }); App.toast("Data moved to " + p); $("newDir").value = ""; cache(); } catch (e) { App.toast(e.message, true); }
  };
  $("resetDir").onclick = async () => { try { await App.api("/api/cache/location", { body: { reset: true } }); App.toast("Back to the default folder"); cache(); } catch (e) { App.toast(e.message, true); } };
  $("clearCache").onclick = async () => {
    const targets = Array.from(document.querySelectorAll(".cpart:checked")).map((c) => c.value);
    if ($("clearExt").checked) targets.push("extension");
    if (!targets.length) return App.toast("Select something to clear", true);
    const r = await App.api("/api/cache/clear", { body: { targets } });
    App.toast("Cache cleared — freed " + App.bytes(Math.max(0, r.freed)));
    cache();
  };

  // account
  const me = await App.api("/api/me");
  $("nameIn").value = me.name || "";
  $("passDesc").textContent = me.hasPass ? "A passcode is set. Leave 'New' empty to remove it." : "No passcode — anyone using this PC can open Phalanx.";
  $("nameForm").addEventListener("submit", async (e) => { e.preventDefault(); await App.api("/api/profile", { body: { name: $("nameIn").value } }); App.toast("Name saved"); App.refreshState(); });
  $("passForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await App.api("/api/profile", { body: { changePass: true, current: $("curPass").value, passcode: $("newPass").value } }); App.toast("Passcode updated"); $("curPass").value = $("newPass").value = ""; }
    catch (er) { App.toast(er.message, true); }
  });
  $("clearHist").onclick = async () => {
    if (!confirm("Delete ALL threat history? This cannot be undone.")) return;
    await App.api("/api/history/clear", { body: {} });
    App.toast("History cleared");
  };

  paint(App.state.settings);
  if (location.hash) setTimeout(() => document.querySelector(location.hash)?.scrollIntoView(), 50);
  App.on((w) => { if (w === "settings") paint(App.state.settings); });
})();
