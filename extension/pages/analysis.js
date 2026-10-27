(async function () {
  const id = new URLSearchParams(location.search).get("id");
  async function load() {
    const r = await chrome.runtime.sendMessage({ t: "event", id });
    if (r && r.cfg) window.phalanxApplyTheme(r.cfg);
    window.PhalanxReportView.render(document.getElementById("report"), r && r.ev, {
      onAction: async (action) => { await chrome.runtime.sendMessage({ t: "decide", id, action, from: "page" }); load(); },
    });
  }
  load();
})();
