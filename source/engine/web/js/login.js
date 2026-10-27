(async function () {
  const $ = (id) => document.getElementById(id);
  App.presence();
  const me = await App.api("/api/me", { noRedirect: true });
  if (!me.setup) return location.replace("/setup.html");
  if (me.authed) return location.replace("/dashboard.html");
  $("hi").textContent = "Welcome back, " + me.name;
  $("av").textContent = me.name.charAt(0).toUpperCase();
  if (!me.hasPass) {
    $("pass").hidden = true;
    $("sub").textContent = "No passcode is set for this profile.";
    $("go").textContent = "Continue";
  } else $("pass").focus();
  $("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await App.api("/api/login", { body: { passcode: $("pass").value }, noRedirect: true });
      location.replace("/dashboard.html");
    } catch (er) { $("msg").textContent = er.message; $("msg").style.color = "var(--sev-critical)"; $("pass").select(); }
  });
})();
