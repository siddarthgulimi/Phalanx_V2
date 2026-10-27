/* Phalanx content observer (runs in every top-level http/https page).
 *
 * Performance design (so 30+ tabs stay smooth on modest laptops):
 *  - Starts observing at DOMContentLoaded: the page's own HTML is the baseline,
 *    only things injected AFTER load are inspected.
 *  - MutationObserver callback only collects nodes; the actual inspection runs in
 *    requestIdleCallback slices, i.e. when the page is not busy.
 *  - Only a short list of risky tags/attributes is inspected; layout reads
 *    (getComputedStyle / getBoundingClientRect) are limited to iframes and
 *    top-level overlay candidates.
 *  - Trusted sites (Gmail, Meet, Discord, Netflix...) run a "light" mode that only
 *    checks critical patterns.
 *  - No chrome.storage access here; config arrives once from the service worker.
 *  - Per-page cap on reports + de-duplication.
 */
(function () {
  "use strict";
  if (window.__phalanxLoaded) return;
  window.__phalanxLoaded = true;

  const I = self.PhalanxIntel;
  const MAX_REPORTS = 25;
  const WATCHED_ATTRS = ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onauxclick", "onpointerdown",
    "onanimationstart", "onbeforeunload", "onkeydown", "onkeyup", "oninput", "action", "formaction"];
  const SELECTOR = 'input[type="password" i], script[src], iframe, a[href^="javascript:" i], [onerror], [onload], [onclick], [onmouseover], [onfocus], [onanimationstart]';

  const pageHost = location.hostname.toLowerCase();
  const pageSite = I.siteOf(pageHost);
  const isEngine = I.isLocal(pageHost) && location.port === "47821" && !location.pathname.startsWith("/testlab");
  if (isEngine) return; // never police the Phalanx app itself
  if (I.isLocal(pageHost) && location.pathname.startsWith("/testlab")) document.documentElement.dataset.phalanx = "on";

  let cfg = { sensitivity: "medium", autoQuarantine: true, paused: false, notifyStyle: "toast", lists: { allow: [], block: [] }, theme: "dark" };
  let trusted = false;
  let threshold = 45;
  let reports = 0;
  const reportedKeys = new Set();
  const inspected = new WeakSet();
  const queue = new Set();
  let idleScheduled = false;
  const held = new Map(); // id -> {el, parent, next, style, attr, attrVal}
  const baselineScriptSites = new Set();
  const outbox = [];
  let outboxTimer = null;

  function send(msg) {
    try { return chrome.runtime.sendMessage(msg); } catch (e) { return Promise.resolve(null); }
  }
  function applyCfg(c) {
    cfg = Object.assign(cfg, c || {});
    trusted = I.isTrusted(pageHost, cfg.lists);
    threshold = I.thresholdFor(cfg.sensitivity);
    if (Toast.root) Toast.theme();
  }

  /* ------------------------------------------------------------------ */
  /* Detection                                                           */
  /* ------------------------------------------------------------------ */
  function uid() { return "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function snippet(el) {
    try {
      const clone = el.cloneNode(false);
      return clone.outerHTML.replace(/\s+/g, " ").slice(0, 180);
    } catch (e) { return "<" + (el.tagName || "?").toLowerCase() + ">"; }
  }
  function foreignRisky(host) {
    return host && I.siteOf(host) !== pageSite && !I.isLocal(host) && !I.isBenignThirdParty(host) && !I.isTrusted(host, cfg.lists);
  }
  function coverage(rect) {
    const vp = window.innerWidth * window.innerHeight;
    if (!vp) return 0;
    const w = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
    const hh = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
    return (w * hh) / vp;
  }

  function finding(type, el, extra) {
    const rule = I.DOM_RULES[type];
    if (!rule) return;
    let score = rule.score;
    const signals = [{ id: type, label: rule.title, weight: rule.score }];
    if (extra && extra.bonus) { score = Math.min(100, score + extra.bonus.weight); signals.push(extra.bonus); }
    if (trusted && score < 85) return;                  // light mode on trusted sites
    if (score < threshold || cfg.paused) return;
    const key = type + "|" + ((extra && extra.source) || snippet(el).slice(0, 80));
    if (reportedKeys.has(key) || reports >= MAX_REPORTS) return;
    reportedKeys.add(key);
    reports++;

    const ev = {
      id: uid(), ts: Date.now(), kind: "dom", type, category: "dom",
      title: rule.title, score, severity: I.severityOf(score), signals,
      url: location.href, host: (extra && extra.host) || pageHost, source: (extra && extra.source) || "",
      target: snippet(el), status: "pending",
    };
    if (trusted) signals.push({ id: "trusted_mode", label: "Reported even though the site is trusted (critical pattern)", weight: 0 });
    signals.push({ id: "post_load", label: "Inserted after the page finished loading", weight: 0 });

    const canHold = el && el.isConnected && el !== document.body && el !== document.documentElement;
    if (cfg.autoQuarantine && score >= I.AUTO_QUARANTINE_MIN && canHold) {
      hold(ev.id, el, extra, true);
      ev.status = "auto-quarantined";
    } else if (score >= 45 && canHold && el.tagName !== "SCRIPT") {
      hold(ev.id, el, extra, false); // neutralised until the user decides
    }
    Toast.add(ev);
    outbox.push(ev);
    if (!outboxTimer) outboxTimer = setTimeout(flushOutbox, 250);
  }
  function flushOutbox() {
    outboxTimer = null;
    if (!outbox.length) return;
    send({ t: "dom", events: outbox.splice(0) });
  }

  function hold(id, el, extra, remove) {
    const rec = { el, parent: el.parentNode, next: el.nextSibling, style: el.getAttribute("style"), attr: extra && extra.attr, attrVal: null };
    if (rec.attr) {
      rec.attrVal = el.getAttribute(rec.attr);
      el.removeAttribute(rec.attr);
    } else if (remove) {
      el.remove();
    } else {
      el.style.setProperty("display", "none", "important");
    }
    held.set(id, rec);
  }
  function applyDecision(id, action) {
    const rec = held.get(id);
    if (!rec) return;
    if (action === "resolved") {
      if (rec.attr && rec.attrVal != null) rec.el.setAttribute(rec.attr, rec.attrVal);
      else if (!rec.el.isConnected && rec.parent && rec.el.tagName !== "SCRIPT") {
        try { rec.parent.insertBefore(rec.el, rec.next && rec.next.parentNode === rec.parent ? rec.next : null); } catch (e) { /* ignore */ }
      }
      if (!rec.attr) { if (rec.style == null) rec.el.removeAttribute("style"); else rec.el.setAttribute("style", rec.style); }
      inspected.add(rec.el);
    } else if (action === "quarantined") {
      if (!rec.attr) rec.el.remove();
    }
    held.delete(id);
  }

  function inspectPassword(input) {
    const form = input.form || input.closest("form");
    const box = form || input;
    if (inspected.has(box)) return;
    inspected.add(box);
    const action = form ? (form.getAttribute("action") || "") : "";
    const actionHost = action ? I.hostOf(action, location.href) : "";
    if (actionHost && foreignRisky(actionHost)) {
      return finding("credential_form_foreign", box, { source: form.action, host: actionHost,
        bonus: I.hostRisk(actionHost) ? { id: "risky_dest", label: "Destination host itself looks malicious", weight: 8 } : null });
    }
    // overlay ancestor?
    let n = box, depth = 0;
    while (n && n !== document.body && depth < 8) {
      if (n.nodeType === 1) {
        const cs = getComputedStyle(n);
        if ((cs.position === "fixed" || cs.position === "absolute") && (parseInt(cs.zIndex, 10) || 0) >= 100 &&
            coverage(n.getBoundingClientRect()) > 0.5) {
          return finding("credential_overlay", n, { source: action });
        }
      }
      n = n.parentElement; depth++;
    }
    finding("credential_form_local", box, { source: action });
  }

  function inspectScript(sc) {
    if (inspected.has(sc)) return;
    inspected.add(sc);
    const src = sc.getAttribute("src") || "";
    if (/^(blob|data):/i.test(src)) return finding("script_blob", sc, { source: src.slice(0, 120) });
    const host = I.hostOf(src, location.href);
    if (!host || I.siteOf(host) === pageSite) return;
    if (I.isKnownBad(host)) return finding("script_known_bad", sc, { source: sc.src, host });
    if (I.hostRisk(host) >= 75) return finding("script_suspicious_host", sc, { source: sc.src, host });
    if (!baselineScriptSites.has(I.siteOf(host)) && !I.isBenignThirdParty(host) && !I.isTrusted(host, cfg.lists)) {
      finding("script_third_party", sc, { source: sc.src, host });
    }
  }

  function inspectIframe(fr) {
    if (inspected.has(fr)) return;
    inspected.add(fr);
    const src = fr.getAttribute("src") || "";
    const host = I.hostOf(src, location.href);
    const cs = getComputedStyle(fr);
    const rect = fr.getBoundingClientRect();
    const cov = coverage(rect);
    const opacity = parseFloat(cs.opacity);
    if (cov > 0.3 && opacity < 0.2 && cs.pointerEvents !== "none" && cs.visibility !== "hidden") {
      return finding("clickjack_iframe", fr, { source: fr.src || "(blank frame)", host: host || pageHost });
    }
    if (!foreignRisky(host)) return;
    if ((rect.width <= 6 && rect.height <= 6) || cs.display === "none" || cs.visibility === "hidden" || opacity === 0) {
      return finding("hidden_iframe", fr, { source: fr.src, host,
        bonus: I.hostRisk(host) ? { id: "risky_host", label: "Frame host looks malicious", weight: 20 } : null });
    }
    if (cov > 0.6 && (cs.position === "fixed" || cs.position === "absolute")) {
      finding("overlay_iframe", fr, { source: fr.src, host });
    }
  }

  function inspectHandlers(el) {
    for (const attr of WATCHED_ATTRS) {
      if (!attr.startsWith("on")) continue;
      const v = el.getAttribute(attr);
      if (!v) continue;
      const dangerous = I.DANGEROUS_JS.test(v);
      finding(dangerous ? "handler_dangerous" : "handler_generic", el, { attr, source: attr + '="' + v.slice(0, 100) + '"' });
    }
  }

  function inspectJsLink(a) {
    if (inspected.has(a)) return;
    inspected.add(a);
    const href = a.getAttribute("href") || "";
    if (I.DANGEROUS_JS.test(href)) finding("js_url_dangerous", a, { attr: "href", source: href.slice(0, 120) });
  }

  function inspectOverlay(el) {
    if (trusted || threshold > 25 || inspected.has(el)) return; // only at High sensitivity
    inspected.add(el);
    const cs = getComputedStyle(el);
    if ((cs.position === "fixed" || cs.position === "absolute") && (parseInt(cs.zIndex, 10) || 0) >= 1000 &&
        coverage(el.getBoundingClientRect()) > 0.85) {
      finding("overlay_div", el, { source: "<" + el.tagName.toLowerCase() + "> z-index " + cs.zIndex });
    }
  }

  function inspectRoot(node) {
    if (!node.isConnected) return;
    const tag = node.tagName;
    const list = node.matches(SELECTOR) ? [node] : [];
    if (node.firstElementChild) list.push(...node.querySelectorAll(SELECTOR));
    for (const el of list) {
      if (el.tagName === "INPUT") inspectPassword(el);
      else if (el.tagName === "SCRIPT") inspectScript(el);
      else if (el.tagName === "IFRAME") { inspectIframe(el); if (!trusted) inspectHandlers(el); }
      else if (el.tagName === "A" && /^javascript:/i.test(el.getAttribute("href") || "")) inspectJsLink(el);
      else if (!trusted) inspectHandlers(el);
    }
    if ((tag === "DIV" || tag === "SECTION" || tag === "ASIDE") &&
        (node.parentElement === document.body || node.parentElement === document.documentElement)) inspectOverlay(node);
  }

  function processQueue(deadline) {
    idleScheduled = false;
    for (const node of queue) {
      queue.delete(node);
      try { inspectRoot(node); } catch (e) { /* never break the page */ }
      if (deadline && deadline.timeRemaining() < 2 && queue.size) break;
    }
    if (queue.size) schedule();
  }
  function schedule() {
    if (idleScheduled) return;
    idleScheduled = true;
    if ("requestIdleCallback" in window) requestIdleCallback(processQueue, { timeout: 800 });
    else setTimeout(processQueue, 50);
  }

  function onMutations(muts) {
    if (cfg.paused) return;
    for (const m of muts) {
      if (m.type === "childList") {
        for (const n of m.addedNodes) if (n.nodeType === 1 && n.id !== "phalanx-toast-host") queue.add(n);
      } else if (m.type === "attributes") {
        const el = m.target;
        const a = m.attributeName;
        if (a === "action" || a === "formaction") {
          const form = el.tagName === "FORM" ? el : el.form;
          if (form && form.querySelector('input[type="password" i]')) {
            const host = I.hostOf(el.getAttribute(a) || "", location.href);
            if (foreignRisky(host)) finding("form_hijack", form, { source: el.getAttribute(a), host });
          }
        } else if (!trusted && el.getAttribute(a)) {
          const v = el.getAttribute(a);
          finding(I.DANGEROUS_JS.test(v) ? "handler_dangerous" : "handler_generic", el, { attr: a, source: a + '="' + v.slice(0, 100) + '"' });
        }
      }
    }
    if (queue.size > 4000) queue.clear(); // pathological page: drop rather than freeze
    if (queue.size) schedule();
  }

  function start() {
    document.querySelectorAll("script[src]").forEach((sc) => {
      const h = I.hostOf(sc.src);
      if (h) baselineScriptSites.add(I.siteOf(h));
    });
    new MutationObserver(onMutations).observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: WATCHED_ATTRS,
    });
  }

  /* ------------------------------------------------------------------ */
  /* Compact toast: one small box, grouped, auto-hides after 3 s          */
  /* ------------------------------------------------------------------ */
  const Toast = {
    root: null, host: null, items: [], open: false, hover: false, timer: null,
    build() {
      if (this.root || window.top !== window) return;
      this.host = document.createElement("div");
      this.host.id = "phalanx-toast-host";
      this.host.style.cssText = "all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;";
      this.root = this.host.attachShadow({ mode: "closed" });
      this.root.innerHTML = `<style>
        :host{all:initial}
        .t{font:12.5px/1.4 "Segoe UI",system-ui,sans-serif;width:320px;background:var(--bg);color:var(--fg);border:1px solid var(--bd);
           border-radius:var(--r);box-shadow:0 10px 30px rgba(0,0,0,.28);overflow:hidden;transform:translateY(8px);opacity:0;
           transition:opacity .18s,transform .18s}
        .t.show{opacity:1;transform:none}
        .hd{display:flex;align-items:center;gap:8px;padding:9px 10px;cursor:pointer;user-select:none}
        .lg{color:var(--ac);font-weight:800}
        .tt{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .tt b{font-weight:700}
        .cv{color:var(--dim);transition:transform .15s}
        .open .cv{transform:rotate(180deg)}
        .x{border:0;background:none;color:var(--dim);cursor:pointer;font-size:14px;padding:0 2px}
        .ls{display:none;max-height:260px;overflow:auto;border-top:1px solid var(--bd)}
        .open .ls{display:block}
        .it{display:grid;grid-template-columns:auto 1fr;gap:2px 8px;padding:8px 10px;border-bottom:1px solid var(--bd)}
        .sv{width:8px;height:8px;border-radius:50%;margin-top:5px}
        .nm{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .mt{grid-column:2;color:var(--dim);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        select{grid-column:2;margin-top:4px;font:inherit;font-size:12px;background:var(--in);color:var(--fg);border:1px solid var(--bd);border-radius:6px;padding:3px 6px}
        .done{grid-column:2;font-size:11.5px;color:var(--ac);font-weight:600}
      </style><div class="t"><div class="hd"><span class="lg">◈</span><span class="tt"></span><span class="cv">▾</span><button class="x" title="Dismiss">✕</button></div><div class="ls"></div></div>`;
      const t = this.root.querySelector(".t");
      t.addEventListener("mouseenter", () => { this.hover = true; clearTimeout(this.timer); });
      t.addEventListener("mouseleave", () => { this.hover = false; this.arm(); });
      this.root.querySelector(".hd").addEventListener("click", (e) => {
        if (e.target.classList.contains("x")) return this.hide(true);
        this.open = !this.open; t.classList.toggle("open", this.open); this.arm();
      });
      this.theme();
      (document.body || document.documentElement).appendChild(this.host);
    },
    theme() {
      if (!this.root) return;
      const dark = cfg.theme === "dark" || (cfg.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
      const pink = cfg.edition === "pink";
      const v = pink
        ? (dark ? ["#23171f", "#f1dce6", "#3b2833", "#ff8cc0", "#b394a6", "#150e13"] : ["#ffffff", "#3a2430", "#f1d5e1", "#c93576", "#8a6878", "#fff5f8"])
        : (dark ? ["#0f1511", "#c9e4d1", "#2b4434", "#3ddc84", "#7d9887", "#070908"] : ["#ffffff", "#20251f", "#dcdfd9", "#1d7a46", "#5d665c", "#f3f4f1"]);
      const t = this.root.querySelector(".t");
      ["--bg", "--fg", "--bd", "--ac", "--dim", "--in"].forEach((k, i) => t.style.setProperty(k, v[i]));
      t.style.setProperty("--r", pink ? "14px" : "6px");
    },
    sevColor(s) { return { low: "#8fb4c9", medium: "#f0a63a", high: "#ff7a45", critical: "#ff4d5e" }[s] || "#999"; },
    add(ev) {
      if (cfg.notifyStyle !== "toast" || window.top !== window) return;
      if (this.items.some((x) => x.id === ev.id)) return;
      this.items.unshift(ev);
      if (this.items.length > 12) this.items.length = 12;
      this.build();
      this.render();
      requestAnimationFrame(() => this.root.querySelector(".t").classList.add("show"));
      this.host.style.display = "";
      this.arm();
    },
    status(id, st) {
      const it = this.items.find((x) => x.id === id);
      if (it) { it.status = st; this.render(); }
    },
    render() {
      const pending = this.items.filter((x) => x.status === "pending").length;
      const latest = this.items[0];
      const tt = this.root.querySelector(".tt");
      tt.textContent = "";
      const b = document.createElement("b");
      b.textContent = this.items.length === 1 ? "Phalanx alert" : `Phalanx · ${this.items.length} alerts`;
      tt.append(b, document.createTextNode(" — " + (latest ? latest.title : "")));
      const ls = this.root.querySelector(".ls");
      ls.textContent = "";
      for (const ev of this.items) {
        const row = document.createElement("div"); row.className = "it";
        const dot = document.createElement("span"); dot.className = "sv"; dot.style.background = this.sevColor(ev.severity);
        const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = ev.title;
        const mt = document.createElement("span"); mt.className = "mt"; mt.textContent = `${ev.severity.toUpperCase()} · ${ev.score}/100 · ${ev.host || ""}`;
        row.append(dot, nm, mt);
        if (ev.status === "pending") {
          const sel = document.createElement("select");
          sel.innerHTML = '<option value="">Choose action…</option><option value="resolved">✓ Resolved — it\'s safe</option><option value="quarantined">⛔ Quarantine</option><option value="analysis">🔍 Threat analysis</option>';
          sel.addEventListener("focus", () => { this.hover = true; clearTimeout(this.timer); });
          sel.addEventListener("change", () => {
            if (!sel.value) return;
            const action = sel.value;
            if (action !== "analysis") { ev.status = action; applyDecision(ev.id, action); }
            else ev.status = "analysis";
            send({ t: "decide", id: ev.id, action });
            this.hover = false; this.render(); this.arm();
          });
          row.append(sel);
        } else {
          const d = document.createElement("span"); d.className = "done";
          d.textContent = { resolved: "✓ Resolved", quarantined: "⛔ Quarantined", "auto-quarantined": "⛔ Auto-quarantined", analysis: "🔍 Sent to Threat analysis" }[ev.status] || ev.status;
          row.append(d);
        }
        ls.append(row);
      }
      void pending;
    },
    arm() {
      clearTimeout(this.timer);
      if (this.hover) return;
      this.timer = setTimeout(() => this.hide(false), 3000);
    },
    hide(clear) {
      clearTimeout(this.timer);
      if (!this.root) return;
      const t = this.root.querySelector(".t");
      t.classList.remove("show");
      this.open = false; t.classList.remove("open");
      setTimeout(() => { if (!t.classList.contains("show")) this.host.style.display = "none"; }, 220);
      if (clear) this.items = [];
    },
  };

  /* ------------------------------------------------------------------ */
  /* Wiring                                                              */
  /* ------------------------------------------------------------------ */
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || !msg.t) return;
    if (msg.t === "cfg") applyCfg(msg.cfg);
    else if (msg.t === "toast") (msg.items || []).forEach((ev) => Toast.add(ev));
    else if (msg.t === "apply") { applyDecision(msg.id, msg.action); Toast.status(msg.id, msg.action); }
    else if (msg.t === "status") Toast.status(msg.id, msg.status);
  });

  function boot() {
    Promise.resolve(send({ t: "hello", url: location.href })).then((res) => {
      if (res && res.cfg) applyCfg(res.cfg);
      if (res && res.items) res.items.forEach((ev) => Toast.add(ev));
    }).catch(() => {}).finally(start);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
