/* Applies the last-used theme instantly to avoid a flash before settings load. */
(function () {
  var s = { theme: "dark", accent: "", size: "normal" };
  try { var c = JSON.parse(localStorage.getItem("phx-theme") || "null"); if (c) s = c; } catch (e) { /* storage unavailable */ }
  window.phalanxApplyTheme(s);
})();
