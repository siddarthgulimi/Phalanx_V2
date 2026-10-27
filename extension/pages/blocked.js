(async function () {
  const q = new URLSearchParams(location.search);
  const id = q.get("id");
  const target = q.get("url") || "";
  const r = await chrome.runtime.sendMessage({ t: "event", id });
  if (r && r.cfg) window.phalanxApplyTheme(r.cfg);
  const ev = r && r.ev;
  let host = "";
  try { host = new URL(target).hostname; } catch (e) {}
  document.getElementById("host").textContent = target || host;
  if (ev) {
    const sev = document.getElementById("sev");
    sev.textContent = ev.severity; sev.className = "chip sev-" + ev.severity;
    document.getElementById("score").textContent = ev.score + " / 100";
    document.getElementById("cat").textContent = ev.title;
    const ul = document.getElementById("reasons");
    (ev.signals || []).forEach((s) => { const li = document.createElement("li"); li.textContent = s.label; ul.append(li); });
  }
  document.getElementById("back").onclick = () => {
    if (history.length > 2) history.go(-2); else location.href = "about:blank";
    setTimeout(() => { location.href = "https://www.google.com/"; }, 400);
  };
  document.getElementById("analyze").onclick = () => chrome.runtime.sendMessage({ t: "decide", id, action: "analysis", from: "blocked" });
  document.getElementById("proceed").onclick = async () => {
    await chrome.runtime.sendMessage({ t: "proceed", id });
    if (target) location.href = target;
  };
})();
