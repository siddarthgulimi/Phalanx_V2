(async function () {
  try {
    const me = await App.api("/api/me", { noRedirect: true });
    location.replace(!me.setup ? "/setup.html" : me.authed ? "/dashboard.html" : "/login.html");
  } catch (e) { setTimeout(() => location.reload(), 1500); }
})();
