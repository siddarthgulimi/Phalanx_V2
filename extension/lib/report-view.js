/* Renders a PhalanxAnalyst report into a container.
 * All page-derived strings go through textContent (never innerHTML):
 * event data originates from web pages and must be treated as hostile. */
(function (root) {
  "use strict";

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === "class") el.className = attrs[k];
      else if (k === "text") el.textContent = attrs[k];
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), attrs[k]);
      else el.setAttribute(k, attrs[k]);
    }
    for (const kid of kids.flat(Infinity)) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const SVGNS = "http://www.w3.org/2000/svg";
  function s(tag, attrs) {
    const el = document.createElementNS(SVGNS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  function gauge(score, sev) {
    // 240° arc gauge, 0..100
    const svg = s("svg", { viewBox: "0 0 120 120", class: "rv-gauge", role: "img", "aria-label": `Risk score ${score} of 100` });
    const cx = 60, cy = 62, r = 46, start = 150, sweep = 240;
    const pt = (deg) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)];
    const arc = (a0, a1) => {
      const [x0, y0] = pt(a0), [x1, y1] = pt(a1);
      return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
    };
    svg.append(s("path", { d: arc(start, start + sweep), fill: "none", stroke: "var(--bg-inset)", "stroke-width": 10, "stroke-linecap": "round" }));
    const v = Math.max(1, Math.min(100, score));
    svg.append(s("path", { d: arc(start, start + (sweep * v) / 100), fill: "none", stroke: `var(--sev-${sev})`, "stroke-width": 10, "stroke-linecap": "round" }));
    const t1 = s("text", { x: 60, y: 62, "text-anchor": "middle", "font-size": 30, "font-weight": 700, fill: "var(--text-strong)", "font-family": "var(--font-mono)" });
    t1.textContent = String(score);
    const t2 = s("text", { x: 60, y: 82, "text-anchor": "middle", "font-size": 10, fill: "var(--text-dim)", "font-family": "var(--font-mono)" });
    t2.textContent = "/ 100 RISK";
    svg.append(t1, t2);
    return svg;
  }

  function render(container, ev, opts) {
    opts = opts || {};
    container.textContent = "";
    const A = root.PhalanxAnalyst.analyze(ev);
    if (!A) { container.append(h("div", { class: "empty" }, h("b", { text: "No threat selected" }))); return; }

    const scale = h("div", { class: "rv-scale" },
      A.scale.map((b) => h("div", { class: (A.band === b ? "on " : "") + "sev-" + b.label.toLowerCase() },
        h("b", { text: b.label }), `${b.from}–${b.to}`)));

    const hero = h("div", { class: "card rv-hero" },
      gauge(A.score, A.severity),
      h("div", null,
        h("div", { class: "row", style: "gap:8px;flex-wrap:wrap" },
          h("span", { class: "chip sev-" + A.severity, text: A.severity }),
          h("span", { class: "chip plain st-" + (ev.status || "pending"), text: (ev.status || "pending").replace("-", " ") }),
          h("span", { class: "label", text: A.name })),
        h("h2", { text: A.title }),
        h("p", { class: "rv-verdict", text: A.verdict }),
        scale,
        h("p", { class: "dim", style: "margin:6px 0 0;font-size:.86em", text: A.band.label + ": " + A.band.text })));

    const actions = opts.onAction ? h("div", { class: "row", style: "flex-wrap:wrap" },
      h("button", { class: "btn primary", onclick: () => opts.onAction("quarantined") }, "⛔ Quarantine"),
      h("button", { class: "btn", onclick: () => opts.onAction("resolved") }, "✓ Mark resolved (safe)"),
      opts.extra || null) : null;

    const explain = h("div", { class: "card" },
      h("h3", { text: "What is this?" }), h("p", { style: "margin:0 0 8px", text: A.what }),
      h("h3", { text: "How does the attack work?" }), h("p", { style: "margin:0 0 8px", text: A.how }),
      h("h3", { text: "What could happen?" }), h("p", { style: "margin:0", text: A.impact }));

    const src = h("div", { class: "card" }, h("h3", { text: "Where did it come from?" }),
      h("dl", { class: "rv-kv" }, A.source.map((r) => [h("dt", { text: r.label }), h("dd", { text: r.value })])));

    const maxW = Math.max(1, ...A.signals.map((x) => x.weight));
    const sig = h("div", { class: "card" }, h("h3", { text: "Why it was flagged — evidence & weight" }),
      A.signals.length ? h("div", { class: "rv-bars" }, A.signals.map((x) =>
        h("div", { class: "rv-bar" }, h("span", { text: x.label }), h("span", { class: "w", text: "+" + x.weight }),
          h("div", { class: "track" }, h("div", { class: "fill", style: `width:${Math.round((x.weight / maxW) * 100)}%` })))))
        : h("p", { class: "dim", text: "No individual signals recorded." }),
      h("p", { class: "dim", style: "margin:10px 0 0;font-size:.84em", text: "Score = sum of the weights above, capped at 100." }));

    const recs = h("div", { class: "card" }, h("h3", { text: "Recommended steps" }), h("ol", null, A.recommendations.map((r) => h("li", { text: r }))));
    const after = h("div", { class: "card" }, h("h3", { text: "What happens after quarantine?" }), h("ul", null, A.afterQuarantine.map((r) => h("li", { text: r }))));
    const brief = A.brief ? h("div", { class: "card rv-brief" }, h("h3", { text: A.brief.title }), h("ul", null, A.brief.points.map((r) => h("li", { text: r })))) : null;

    container.append(h("div", { class: "rv" }, hero, actions, h("div", { class: "rv-grid" }, explain, src), sig,
      h("div", { class: "rv-grid" }, recs, after), brief));
  }

  root.PhalanxReportView = { render, h, gauge };
})(window);
