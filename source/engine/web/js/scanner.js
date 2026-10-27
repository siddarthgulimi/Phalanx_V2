(async function () {
  const content = await App.boot("scanner", "Site scanner", "On-demand checks for links and files");
  if (!content) return;
  const $ = (id) => document.getElementById(id);
  const I = window.PhalanxIntel;
  let lists = await App.api("/api/lists");
  const VERDICT = { info: "Looks safe", low: "Probably fine — minor warning signs", medium: "Suspicious — be careful", high: "Dangerous — avoid", critical: "Dangerous — avoid" };

  function result(box, r, title, kindLabel, cat) {
    box.textContent = "";
    const card = document.createElement("div");
    card.className = "card";
    const sev = r.severity;
    const g = PhalanxReportView.gauge(r.score, sev === "info" ? "low" : sev);
    const head = document.createElement("div");
    head.className = "rv-hero";
    head.append(g);
    const right = document.createElement("div");
    right.innerHTML = `<div class="row" style="gap:8px;flex-wrap:wrap">${App.sev(sev === "info" ? "low" : sev)}${r.trusted ? '<span class="chip plain st-resolved">Trusted service</span>' : ""}<span class="label">${App.esc(kindLabel)}</span></div>
      <h2 style="margin:6px 0 2px;word-break:break-all">${App.esc(title)}</h2><p class="rv-verdict" style="font-weight:600;color:var(--sev-${sev === "info" ? "low" : sev})">${VERDICT[sev]}</p>
      <p class="dim" style="margin:4px 0 0;font-size:.88em">Sensitivity is <b>${App.state.settings.sensitivity}</b>: Phalanx alerts at score ≥ ${I.thresholdFor(App.state.settings.sensitivity)}. ${r.score >= I.thresholdFor(App.state.settings.sensitivity) ? "This would raise an alert." : "This would not raise an alert."}</p>`;
    head.append(right);
    card.append(head);
    const sig = r.signals.filter((s) => s.weight > 0);
    const list = document.createElement("div");
    list.style.marginTop = "14px";
    list.innerHTML = sig.length
      ? `<h3>Why</h3><div class="rv-bars">${sig.sort((a, b) => b.weight - a.weight).map((s) => `<div class="rv-bar"><span>${App.esc(s.label)}</span><span class="w">+${s.weight}</span><div class="track"><div class="fill" style="width:${Math.min(100, s.weight)}%"></div></div></div>`).join("")}</div>`
      : `<p class="dim" style="margin:0">${r.trusted ? "This is a well-known legitimate service (or one you trusted), so Phalanx does not flag it." : "No warning signs found."}</p>`;
    card.append(list);
    const brief = cat && PhalanxAnalyst.BRIEFS[cat];
    if (brief) {
      const b = document.createElement("div");
      b.className = "card rv-brief";
      b.style.marginTop = "14px";
      b.innerHTML = `<h3>${App.esc(brief.title)}</h3><ul style="margin:0;padding-left:20px">${brief.points.map((p) => `<li style="margin:4px 0">${App.esc(p)}</li>`).join("")}</ul>`;
      card.append(b);
    }
    if (r.site && !r.trusted && r.score > 0) {
      const row = document.createElement("div");
      row.className = "row";
      row.style.marginTop = "12px";
      const t = document.createElement("button"); t.className = "btn sm"; t.textContent = "✓ Trust " + r.site;
      t.onclick = async () => { lists = await App.api("/api/lists", { body: { list: "allow", op: "add", site: r.site } }); App.toast(r.site + " added to trusted sites"); };
      const bl = document.createElement("button"); bl.className = "btn sm danger"; bl.textContent = "⛔ Block " + r.site;
      bl.onclick = async () => { lists = await App.api("/api/lists", { body: { list: "block", op: "add", site: r.site } }); App.toast(r.site + " will be blocked in your browser"); };
      row.append(t, bl);
      card.append(row);
    }
    box.append(card);
  }

  function scanUrl(u) {
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    const r = I.scoreUrl(u, lists);
    if (r.skipped) return App.toast("That doesn't look like a web address", true);
    result($("urlResult"), r, r.host, "Website check", r.category);
  }
  $("urlForm").addEventListener("submit", (e) => { e.preventDefault(); scanUrl($("url").value.trim()); });
  document.querySelectorAll(".ex").forEach((b) => b.addEventListener("click", () => { $("url").value = b.dataset.u; scanUrl(b.dataset.u); }));
  $("fileForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const r = I.scoreDownload({ filename: $("fname").value.trim(), url: $("fsrc").value.trim() || "" }, lists);
    result($("fileResult"), r, r.filename, "File check", r.category === "download" ? null : r.category);
  });
  $("openLab2").onclick = async () => { await App.api("/api/open", { body: { target: "testlab" } }); App.toast("Test lab opened in your browser"); };
})();
