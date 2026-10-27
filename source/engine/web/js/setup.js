(async function () {
  const $ = (id) => document.getElementById(id);
  App.presence();
  const me = await App.api("/api/me", { noRedirect: true });
  if (me.setup) return location.replace(me.authed ? "/dashboard.html" : "/login.html");
  const ok = (k) => { const c = document.querySelector(`[data-c="${k}"]`); c.className = "check ok"; c.querySelector(".ic").textContent = "✓"; };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // These are real checks: engine answered /api/ping, the shared libraries loaded.
  const ping = await App.api("/api/ping", { noRedirect: true });
  ok("engine"); await wait(250);
  ok("data"); await wait(250);
  if (window.PhalanxIntel && PhalanxIntel.lists.TRUSTED.size > 50) ok("intel");
  await wait(250);
  if (window.PhalanxAnalyst) ok("analyst");
  document.querySelector("#s1 .label").textContent = `Step 1 · Engine ready (v${ping.version}, ${ping.edition} edition)`;
  $("s2").hidden = false;
  $("name").focus();

  $("s2").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await App.api("/api/setup", { body: { name: $("name").value.trim(), passcode: $("pass").value }, noRedirect: true }); }
    catch (er) { return App.toast(er.message, true); }
    $("s2").hidden = true;
    $("s3").hidden = false;
    poll();
  });
  async function poll() {
    try {
      const s = await App.api("/api/state", { noRedirect: true });
      if (s.ext.online) {
        $("extCheck").className = "check ok";
        $("extCheck").querySelector(".ic").textContent = "✓";
        $("extTxt").textContent = "Extension connected (v" + s.ext.version + ") — you're protected.";
        return;
      }
    } catch (e) { /* keep waiting */ }
    setTimeout(poll, 3000);
  }
  $("openExt").onclick = async () => { try { await App.api("/api/open", { body: { target: "extension-folder" } }); } catch (e) { App.toast(e.message, true); } };
  $("copy").onclick = async () => { try { await navigator.clipboard.writeText("chrome://extensions"); App.toast("Copied"); } catch (e) { App.toast("Type chrome://extensions in your browser"); } };
  $("finish").onclick = $("skip").onclick = () => location.replace("/dashboard.html");
})();
