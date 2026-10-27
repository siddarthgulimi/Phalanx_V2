/* Tiny dependency-free SVG charts with hover tooltips.
 * Thin marks, rounded data ends, 2px gaps, recessive axes, one axis only. */
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  let tip;
  function tipEl() {
    if (!tip) { tip = document.createElement("div"); tip.className = "tip"; document.body.append(tip); }
    return tip;
  }
  function showTip(html, x, y) {
    const t = tipEl();
    t.innerHTML = html;
    t.style.display = "block";
    const w = t.offsetWidth;
    t.style.left = Math.min(window.innerWidth - w - 8, x + 12) + "px";
    t.style.top = y - 36 + "px";
  }
  function hideTip() { if (tip) tip.style.display = "none"; }
  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.append(e);
    return e;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function niceMax(v) {
    if (v <= 4) return 4;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
    return v;
  }
  function roundedTop(x, y, w, h, r) {
    r = Math.min(r, w / 2, h);
    if (h <= 0) return "";
    return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
  }

  /** Vertical bars. data: [{label, value, color?, tip?}] */
  function bars(host, data, opts) {
    opts = opts || {};
    host.innerHTML = "";
    host.classList.add("chart");
    const W = host.clientWidth || 600, H = opts.height || 180, padL = 30, padB = 22, padT = 8;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": opts.label || "bar chart" }, host);
    const max = niceMax(Math.max(1, ...data.map((d) => d.value)));
    const iw = W - padL - 4, ih = H - padB - padT;
    for (let i = 0; i <= 2; i++) {
      const y = padT + ih - (ih * i) / 2;
      el("line", { x1: padL, x2: W - 4, y1: y, y2: y, stroke: "var(--grid)", "stroke-width": 1 }, svg);
      const t = el("text", { x: padL - 6, y: y + 3.5, "text-anchor": "end" }, svg); t.textContent = Math.round((max * i) / 2);
    }
    const n = data.length || 1, slot = iw / n, bw = Math.max(2, Math.min(34, slot - 2));
    const every = Math.ceil(n / Math.max(1, Math.floor(iw / 46)));
    data.forEach((d, i) => {
      const h = (d.value / max) * ih;
      const x = padL + i * slot + (slot - bw) / 2;
      if (h > 0) el("path", { d: roundedTop(x, padT + ih - h, bw, h, 4), fill: d.color || opts.color || "var(--chart-1)" }, svg);
      const hit = el("rect", { x: padL + i * slot, y: padT, width: slot, height: ih, fill: "transparent" }, svg);
      hit.addEventListener("mousemove", (e) => showTip(d.tip || `<span class="dim">${esc(d.label)}</span> <b>${d.value}</b>`, e.clientX, e.clientY));
      hit.addEventListener("mouseleave", hideTip);
      if ((n - 1 - i) % every === 0) {
        const t = el("text", { x: padL + i * slot + slot / 2, y: H - 6, "text-anchor": "middle" }, svg); t.textContent = d.short || d.label;
      }
    });
    el("line", { x1: padL, x2: W - 4, y1: padT + ih, y2: padT + ih, stroke: "var(--border-strong)", "stroke-width": 1 }, svg);
  }

  /** Line/area chart with crosshair. points: [{label, value}] */
  function line(host, pts, opts) {
    opts = opts || {};
    host.innerHTML = "";
    host.classList.add("chart");
    const W = host.clientWidth || 600, H = opts.height || 170, padL = 34, padB = 22, padT = 10;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": opts.label || "line chart" }, host);
    const max = niceMax(Math.max(1, ...pts.map((p) => p.value)));
    const iw = W - padL - 6, ih = H - padB - padT;
    for (let i = 0; i <= 2; i++) {
      const y = padT + ih - (ih * i) / 2;
      el("line", { x1: padL, x2: W - 6, y1: y, y2: y, stroke: "var(--grid)" }, svg);
      const t = el("text", { x: padL - 6, y: y + 3.5, "text-anchor": "end" }, svg); t.textContent = Math.round((max * i) / 2);
    }
    const n = Math.max(2, pts.length);
    const X = (i) => padL + (iw * i) / (n - 1), Y = (v) => padT + ih - (v / max) * ih;
    const d = pts.map((p, i) => (i ? "L" : "M") + X(i).toFixed(1) + "," + Y(p.value).toFixed(1)).join(" ");
    const color = opts.color || "var(--chart-1)";
    if (pts.length) {
      el("path", { d: d + ` L${X(pts.length - 1)},${padT + ih} L${X(0)},${padT + ih} Z`, fill: color, opacity: 0.12 }, svg);
      el("path", { d, fill: "none", stroke: color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
    }
    [0, Math.floor((pts.length - 1) / 2), pts.length - 1].forEach((i) => {
      if (!pts[i]) return;
      const t = el("text", { x: X(i), y: H - 6, "text-anchor": i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle" }, svg); t.textContent = pts[i].label;
    });
    const cross = el("line", { y1: padT, y2: padT + ih, stroke: "var(--text-dim)", "stroke-dasharray": "3 3", visibility: "hidden" }, svg);
    const dot = el("circle", { r: 4.5, fill: color, stroke: "var(--panel)", "stroke-width": 2, visibility: "hidden" }, svg);
    const hit = el("rect", { x: padL, y: padT, width: iw, height: ih, fill: "transparent" }, svg);
    hit.addEventListener("mousemove", (e) => {
      const r = svg.getBoundingClientRect();
      const sx = ((e.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(pts.length - 1, Math.round(((sx - padL) / iw) * (n - 1))));
      const p = pts[i];
      if (!p) return;
      cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i)); cross.setAttribute("visibility", "visible");
      dot.setAttribute("cx", X(i)); dot.setAttribute("cy", Y(p.value)); dot.setAttribute("visibility", "visible");
      showTip(`<span class="dim">${esc(p.label)}</span> <b>${p.value}</b> ${esc(opts.unit || "")}`, e.clientX, e.clientY);
    });
    hit.addEventListener("mouseleave", () => { hideTip(); cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); });
  }

  /** Donut with legend. items: [{label, value, color}] */
  function donut(host, items, opts) {
    opts = opts || {};
    host.innerHTML = "";
    host.classList.add("chart");
    const total = items.reduce((a, b) => a + b.value, 0);
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;align-items:center;gap:18px;flex-wrap:wrap";
    host.append(wrap);
    const S = opts.size || 150, R = S / 2 - 8, r0 = R - 16;
    const svg = el("svg", { viewBox: `0 0 ${S} ${S}`, width: S, height: S, style: `width:${S}px;flex:none`, role: "img", "aria-label": opts.label || "donut chart" });
    wrap.append(svg);
    const cx = S / 2, cy = S / 2;
    if (!total) el("circle", { cx, cy, r: (R + r0) / 2, fill: "none", stroke: "var(--bg-inset)", "stroke-width": R - r0 }, svg);
    let a = -Math.PI / 2;
    const gap = items.filter((i) => i.value).length > 1 ? 0.03 : 0;
    items.forEach((it) => {
      if (!it.value) return;
      const sweep = (it.value / total) * Math.PI * 2;
      const a0 = a + gap / 2, a1 = a + sweep - gap / 2;
      a += sweep;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (rr, ang) => `${cx + rr * Math.cos(ang)},${cy + rr * Math.sin(ang)}`;
      const d = sweep >= Math.PI * 2 - 0.001
        ? `M${cx - R},${cy} A${R},${R} 0 1 1 ${cx + R},${cy} A${R},${R} 0 1 1 ${cx - R},${cy} M${cx - r0},${cy} A${r0},${r0} 0 1 0 ${cx + r0},${cy} A${r0},${r0} 0 1 0 ${cx - r0},${cy} Z`
        : `M${p(R, a0)} A${R},${R} 0 ${large} 1 ${p(R, a1)} L${p(r0, a1)} A${r0},${r0} 0 ${large} 0 ${p(r0, a0)} Z`;
      const path = el("path", { d, fill: it.color, "fill-rule": "evenodd" }, svg);
      path.addEventListener("mousemove", (e) => showTip(`<span class="dim">${esc(it.label)}</span> <b>${it.value}</b> (${Math.round((it.value / total) * 100)}%)`, e.clientX, e.clientY));
      path.addEventListener("mouseleave", hideTip);
    });
    const t1 = el("text", { x: cx, y: cy + 4, "text-anchor": "middle", style: "font-size:22px;font-weight:700;fill:var(--text-strong)" }, svg);
    t1.textContent = opts.center != null ? opts.center : total;
    const t2 = el("text", { x: cx, y: cy + 20, "text-anchor": "middle" }, svg);
    t2.textContent = opts.centerLabel || "total";
    const lg = document.createElement("div");
    lg.className = "legend";
    lg.style.cssText = "flex-direction:column;gap:6px;margin:0";
    lg.innerHTML = items.map((i) => `<span><i style="background:${i.color}"></i>${esc(i.label)} <b>${i.value}</b></span>`).join("");
    wrap.append(lg);
  }

  /** Horizontal bars. items: [{label, value, color?}] */
  function hbars(host, items, opts) {
    opts = opts || {};
    host.innerHTML = "";
    const max = Math.max(1, ...items.map((i) => i.value));
    if (!items.length) { host.innerHTML = `<div class="empty">${opts.empty || "No data yet"}</div>`; return; }
    host.innerHTML = items.map((i) => `
      <div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 10px;margin:8px 0">
        <span class="ellipsis" title="${esc(i.label)}">${esc(i.label)}</span><b class="mono" style="color:var(--text-strong)">${i.value}</b>
        <div style="grid-column:1/-1;height:6px;border-radius:4px;background:var(--bg-inset)"><div style="height:100%;width:${Math.max(2, (i.value / max) * 100)}%;border-radius:4px;background:${i.color || "var(--chart-1)"}"></div></div>
      </div>`).join("");
  }

  const SEV_COLORS = { critical: "var(--sev-critical)", high: "var(--sev-high)", medium: "var(--sev-medium)", low: "var(--sev-low)", info: "var(--sev-info)" };
  window.Charts = { bars, line, donut, hbars, SEV_COLORS, hideTip };
})();
