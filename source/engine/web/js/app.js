/* Phalanx app shell: sidebar, auth, theme, API, live updates, helpers. */
(function () {
  "use strict";

  const ICONS = {
    dashboard: '<path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-4H4zM14 4v4h6V4z"/>',
    live: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    analysis: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2M8.5 11h5M11 8.5v5"/>',
    history: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    scanner: '<path d="M12 3 4 6v6c0 4.4 3.4 8 8 9 4.6-1 8-4.6 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    lab: '<path d="M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3"/><path d="M7 15h10"/>',
    out: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
    power: '<path d="M12 3v8M6.3 7a8 8 0 1 0 11.4 0"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  };
  const NAV = [
    ["dashboard", "Dashboard", "/dashboard.html"],
    ["live", "Live threats", "/live.html"],
    ["analysis", "Threat analysis", "/analysis.html"],
    ["history", "History & reports", "/history.html"],
    ["scanner", "Site scanner", "/scanner.html"],
    ["settings", "Settings", "/settings.html"],
    ["about", "About", "/about.html"],
  ];
  const icon = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;

  const App = {
    state: null,
    settings: null,
    listeners: [],
    edition: window.PHALANX_EDITION,

    async api(path, opts) {
      opts = opts || {};
      const init = { method: opts.method || (opts.body ? "POST" : "GET"), headers: {}, credentials: "same-origin" };
      if (opts.body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(opts.body); }
      const r = await fetch(path, init);
      if (r.status === 401 && !opts.noRedirect) { location.href = "/login.html"; throw new Error("auth"); }
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Request failed (" + r.status + ")");
      return data;
    },

    on(fn) { this.listeners.push(fn); },

    toast(msg, err) {
      const t = document.createElement("div");
      t.className = "app-toast" + (err ? " err" : "");
      t.textContent = msg;
      document.body.append(t);
      setTimeout(() => t.classList.add("hide"), 2800);
      setTimeout(() => t.remove(), 3100);
    },

    applyTheme(s) {
      window.phalanxApplyTheme(s);
      try { localStorage.setItem("phx-theme", JSON.stringify({ theme: s.theme, accent: s.accent, size: s.size })); } catch (e) { /* ignore */ }
      const btn = document.getElementById("themeQuick");
      if (btn) btn.innerHTML = icon(document.documentElement.dataset.theme === "dark" ? "sun" : "moon");
    },

    async refreshState() {
      this.state = await this.api("/api/state");
      this.settings = this.state.settings;
      this.applyTheme(this.settings);
      this.paintSide();
      return this.state;
    },

    paintSide() {
      const s = this.state;
      if (!s) return;
      const pending = s.totals.status.pending || 0;
      const an = s.totals.status.analysis || 0;
      const b1 = document.querySelector('[data-badge="live"]');
      const b2 = document.querySelector('[data-badge="analysis"]');
      if (b1) b1.textContent = pending || "";
      if (b2) b2.textContent = an || "";
      const ext = document.getElementById("sideExt");
      if (ext) ext.innerHTML = `<span class="dot ${s.ext.online ? "on" : "off"}"></span>Extension <b>${s.ext.online ? (s.ext.paused ? "paused" : "connected") : "offline"}</b>`;
      const eng = document.getElementById("sideEng");
      if (eng) eng.innerHTML = `<span class="dot on"></span>Engine <b>running</b> · ${s.engine.memMB.toFixed(0)} MB`;
      const u = document.getElementById("sideUser");
      if (u) u.textContent = s.profile || "Operator";
      const av = document.getElementById("sideAvatar");
      if (av) av.textContent = (s.profile || "?").trim().charAt(0).toUpperCase();
    },

    shell(page, title, subtitle) {
      const main = document.getElementById("page");
      const shell = document.createElement("div");
      shell.className = "shell";
      shell.innerHTML = `
        <aside class="side">
          <div class="side-brand"><span class="glyph"></span><div><b>Phalanx</b><small>${this.edition.label} edition · v2.0</small></div></div>
          <nav class="nav">
            ${NAV.map(([k, label, href]) => `<a href="${href}" class="${k === page ? "on" : ""}">${icon(k)}<span>${label}</span><span class="badge" data-badge="${k}"></span></a>`).join("")}
            <div class="nav-sep"></div>
            <a href="#" id="openLab">${icon("lab")}<span>Test lab ↗</span></a>
          </nav>
          <div class="side-foot">
            <div class="stat-line" id="sideEng"></div>
            <div class="stat-line" id="sideExt"></div>
            <div class="user"><span class="avatar" id="sideAvatar">?</span><span class="grow ellipsis" id="sideUser"></span>
              <button class="btn ghost sm" id="signOut" title="Sign out">${icon("out").replace("<svg", '<svg width="16" height="16" style="stroke:currentColor;fill:none;stroke-width:1.8"')}</button>
              <button class="btn ghost sm" id="quitApp" title="Quit Phalanx engine">${icon("power").replace("<svg", '<svg width="16" height="16" style="stroke:currentColor;fill:none;stroke-width:1.8"')}</button>
            </div>
          </div>
        </aside>
        <section class="main">
          <header class="topbar">
            <div class="grow"><h1>${title}</h1>${subtitle ? `<p>${subtitle}</p>` : ""}</div>
            <div class="no-print row" id="topActions"></div>
            <button class="btn ghost no-print" id="themeQuick" title="Switch light / dark"></button>
          </header>
          <div class="content" id="content"></div>
        </section>`;
      main.replaceWith(shell);
      const content = shell.querySelector("#content");
      content.append(...Array.from(main.childNodes));
      shell.querySelectorAll(".nav svg, #themeQuick svg").forEach(() => {});
      document.getElementById("themeQuick").addEventListener("click", async () => {
        const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        this.settings = await this.api("/api/settings", { body: { theme: next } });
        this.applyTheme(this.settings);
      });
      document.getElementById("openLab").addEventListener("click", async (e) => {
        e.preventDefault();
        await this.api("/api/open", { body: { target: "testlab" } });
        this.toast("Test lab opened in your normal browser (where the extension is installed).");
      });
      document.getElementById("signOut").addEventListener("click", async () => {
        await this.api("/api/logout", { body: {} });
        location.href = "/login.html";
      });
      document.getElementById("quitApp").addEventListener("click", async () => {
        if (!confirm("Quit the Phalanx engine? The browser extension keeps protecting you and will sync when you start Phalanx again.")) return;
        await this.api("/api/quit", { body: {} });
        document.body.innerHTML = '<div class="center"><div class="card"><h2>Phalanx engine stopped</h2><p class="dim">You can close this window. The extension keeps working and syncs next time.</p></div></div>';
        setTimeout(() => window.close(), 800);
      });
      const btn = document.getElementById("themeQuick");
      btn.innerHTML = icon(document.documentElement.dataset.theme === "dark" ? "sun" : "moon");
      return content;
    },

    presence() { try { new EventSource("/api/presence"); } catch (e) { /* ignore */ } },

    stream() {
      let es;
      const connect = () => {
        es = new EventSource("/api/stream");
        let t = null;
        es.addEventListener("update", (e) => {
          clearTimeout(t);
          t = setTimeout(async () => {
            if (e.data !== "tick" || Date.now() - (this._lastTick || 0) > 10000) {
              this._lastTick = Date.now();
              try { await this.refreshState(); } catch (err) { return; }
              this.listeners.forEach((fn) => fn(e.data));
            }
          }, 250);
        });
        es.onerror = () => { es.close(); setTimeout(connect, 3000); };
      };
      connect();
    },

    async boot(page, title, subtitle) {
      const me = await this.api("/api/me", { noRedirect: true });
      if (!me.setup) { location.href = "/setup.html"; return null; }
      if (!me.authed) { location.href = "/login.html"; return null; }
      const content = this.shell(page, title, subtitle);
      await this.refreshState();
      this.stream();
      return content;
    },

    /* ---------- formatting helpers ---------- */
    esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); },
    ago(ts) {
      const s = Math.round((Date.now() - ts) / 1000);
      if (s < 60) return s + "s ago";
      if (s < 3600) return Math.round(s / 60) + " min ago";
      if (s < 86400) return Math.round(s / 3600) + " h ago";
      return Math.round(s / 86400) + " d ago";
    },
    time(ts) { return new Date(ts).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); },
    bytes(n) {
      if (n < 1024) return n + " B";
      if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
      if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
      return (n / 1073741824).toFixed(2) + " GB";
    },
    sev(s) { return `<span class="chip sev-${this.esc(s)}">${this.esc(s)}</span>`; },
    status(s) {
      const L = { pending: "Pending", resolved: "Resolved", quarantined: "Quarantined", "auto-quarantined": "Auto-quarantined", analysis: "Under analysis" };
      return `<span class="chip plain st-${this.esc(s)}">${L[s] || this.esc(s)}</span>`;
    },
    kind(k) { return { dom: "Page tampering", site: "Risky website", download: "Download" }[k] || k; },

    actionSelect(ev, onDone) {
      const sel = document.createElement("select");
      sel.innerHTML = '<option value="">Choose action…</option><option value="resolved">✓ Resolved — it\'s safe</option><option value="quarantined">⛔ Quarantine</option>' +
        (ev.status === "analysis" ? '<option value="pending">↩ Back to live threats</option>' : '<option value="analysis">🔍 Threat analysis</option>');
      sel.addEventListener("change", async () => {
        const action = sel.value;
        if (!action) return;
        sel.disabled = true;
        try {
          await this.decide(ev.id, action);
          if (action === "analysis") { location.href = "/analysis.html?id=" + encodeURIComponent(ev.id); return; }
          if (onDone) onDone(action);
        } catch (e) { this.toast(e.message, true); sel.disabled = false; }
      });
      return sel;
    },
    async decide(id, action) {
      const r = await this.api("/api/event?id=" + encodeURIComponent(id), { body: { action } });
      const msg = { resolved: "Marked as resolved", quarantined: "Quarantined — the browser applies it within a few seconds", analysis: "Moved to Threat analysis", pending: "Moved back to live threats" }[action];
      this.toast(msg);
      return r;
    },
  };

  window.App = App;
})();
