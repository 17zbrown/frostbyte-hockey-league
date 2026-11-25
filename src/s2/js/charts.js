/* CGHL Season 2 concept: charts. Hand-built SVG in the grammar of Apple Health and Swift Charts: thin gridlines,
   rounded marks, one accent series plus a quiet comparison, values you can SCRUB with a finger or the arrow keys.
   Every chart renders as a string, then S2.charts.hydrate(root) wires interaction and the one entrance motion. */
(function () {
  "use strict";
  var S2 = window.S2, C = S2.charts = {}, uid = 0, binders = {}, redraws = {};
  /* a chart with nothing to draw says so quietly instead of throwing (review 2026-10-19: empty lines, sparks and funnels threw) */
  function empty(o) { return '<figure class="chart c-empty" style="margin:0"><p class="t-foot" style="margin:0;padding:18px 0">' + S2.esc(o && o.empty || "Nothing to chart yet.") + "</p></figure>"; }
  function num(v) { return v != null && isFinite(v); }
  function id() { return "c" + (++uid); }
  function nice(max) { if (max <= 0) return 1; var p = Math.pow(10, Math.floor(Math.log10(max))), m = max / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; }
  function path(pts) {   /* smooth monotone-ish curve through points (Catmull-Rom to Bezier, tension .5) */
    if (pts.length < 2) return "";
    var d = "M" + pts[0][0].toFixed(1) + "," + pts[0][1].toFixed(1);
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      var c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6, c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      var lo = Math.min(p1[1], p2[1]), hi = Math.max(p1[1], p2[1]);   /* clamp control points so the curve never overshoots the data */
      c1y = Math.max(lo, Math.min(hi, c1y)); c2y = Math.max(lo, Math.min(hi, c2y));
      d += "C" + c1x.toFixed(1) + "," + c1y.toFixed(1) + " " + c2x.toFixed(1) + "," + c2y.toFixed(1) + " " + p2[0].toFixed(1) + "," + p2[1].toFixed(1);
    }
    return d;
  }

  /* ---- line / area with scrubbing. series: [{name, values:[n], color?, dashed?}], labels: [x labels] ---- */
  /* o.w and o.h are a first guess and the height in px: the kit redraws a line, bar or scatter chart at the width it really
     gets (C.hydrate), so 11px labels stay 11px from a phone to a desktop and after a rotation. o.labels is read at scrub
     time, so a page may swap in longer labels for the readout after drawing; the axis keeps the labels it was drawn with. */
  C.line = function (o) { return line(o, o.labels || [], o.w || 640); };
  function line(o, axis, W) {
    var k = id(), H = o.h || 220, pad = { l: 8, r: 40, t: 14, b: 26 }, iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    var all = []; (o.series || []).forEach(function (s) { all = all.concat((s.values || []).filter(num)); });
    if (!all.length || !axis.length) return empty(o);
    /* negative values get a floor below zero instead of falling out of the plot onto the content underneath */
    var min = Math.min.apply(null, all), lo = o.min != null ? o.min : min < 0 ? -nice(-min) : 0, hi = Math.max(lo + 1, nice(Math.max.apply(null, all.concat([lo + 1]))));
    var base = Math.max(lo, 0);
    var n = axis.length, xs = function (i) { return pad.l + (n === 1 ? iw / 2 : i * iw / (n - 1)); }, ys = function (v) { return pad.t + ih - (v - lo) / (hi - lo) * ih; };
    var grid = [0, .5, 1].map(function (f) { var v = lo + (hi - lo) * f, y = ys(v);
      return '<line x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + y + '" y2="' + y + '" stroke="var(--separator)" stroke-width="1"' + (f ? ' stroke-dasharray="2 4"' : "") + "/>" +
        '<text x="' + (W - pad.r + 8) + '" y="' + (y + 4) + '" font-size="11" fill="var(--muted)" font-family="var(--font-num)">' + S2.fmt(v, o.dec || 0) + (o.suf || "") + "</text>"; }).join("");
    var step = Math.max(1, Math.ceil(n / (o.ticks || 6)));
    var xl = axis.map(function (l, i) { return i % step && i !== n - 1 ? "" : '<text x="' + xs(i) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="11" fill="var(--muted)">' + S2.esc(l) + "</text>"; }).join("");
    var marks = o.series.map(function (s, si) {
      var pts = (s.values || []).map(function (v, i) { return num(v) ? [xs(i), ys(v)] : null; }).filter(Boolean);
      var col = s.color || (si ? "var(--chart-b)" : "var(--chart-a)"), d = path(pts);
      if (!pts.length) return "";
      if (pts.length === 1) return '<circle cx="' + pts[0][0].toFixed(1) + '" cy="' + pts[0][1].toFixed(1) + '" r="4" fill="' + col + '"/>';   /* one game: a point, not an empty path */
      var area = (o.area && si === 0) ? '<path d="' + d + "L" + pts[pts.length - 1][0].toFixed(1) + "," + ys(base).toFixed(1) + "L" + pts[0][0].toFixed(1) + "," + ys(base).toFixed(1) + 'Z" fill="url(#g' + k + ')" class="c-area"/>' : "";
      return area + '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="' + (si ? 2 : 2.75) + '" stroke-linecap="round" stroke-linejoin="round"' +
        (s.dashed ? ' stroke-dasharray="4 5"' : ' class="c-draw"') + "/>";
    }).join("");
    binders[k] = function (svg) { scrub(svg, o, xs, ys, n, W, H, pad); };
    redraws[k] = function (w) { return line(o, axis, w); };
    return '<figure class="chart" style="margin:0"><svg id="' + k + '" data-chart="' + k + '" viewBox="0 0 ' + W + " " + H + '" width="100%" role="img" aria-label="' + S2.esc(o.label || "Line chart") + '" tabindex="0" style="touch-action:pan-y;overflow:visible">' +
      '<defs><linearGradient id="g' + k + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--chart-a)" stop-opacity=".22"/><stop offset="1" stop-color="var(--chart-a)" stop-opacity="0"/></linearGradient></defs>' +
      grid + xl + marks + '<g class="c-cursor" style="opacity:0;transition:opacity 120ms ease"><line y1="' + pad.t + '" y2="' + (pad.t + ih) + '" stroke="var(--ink)" stroke-opacity=".25" stroke-width="1"/>' +
      o.series.map(function (s, si) { return '<circle r="5" fill="var(--surface)" stroke="' + (s.color || (si ? "var(--chart-b)" : "var(--chart-a)")) + '" stroke-width="2.5" data-s="' + si + '"/>'; }).join("") +
      "</g></svg>" + '<figcaption class="c-read t-foot" aria-live="polite" style="min-height:1.4em;margin-top:6px">' + S2.esc(o.hint || "Drag across the chart to read each point.") + "</figcaption></figure>";
  }
  function scrub(svg, o, xs, ys, n, W, H, pad) {
    var cur = S2.$(".c-cursor", svg), read = svg.parentNode.querySelector(".c-read"), idx = -1;
    function show(i) {
      i = Math.max(0, Math.min(n - 1, i)); if (i === idx) return; idx = i;
      var x = xs(i); S2.$("line", cur).setAttribute("x1", x); S2.$("line", cur).setAttribute("x2", x); cur.style.opacity = "1";
      S2.$$("circle", cur).forEach(function (c) { var s = o.series[+c.dataset.s], v = s.values[i]; if (!num(v)) { c.style.display = "none"; return; } c.style.display = ""; c.setAttribute("cx", x); c.setAttribute("cy", ys(v)); });
      read.innerHTML = "<b style='color:var(--ink)'>" + S2.esc(o.labels[i]) + "</b> · " + o.series.map(function (s) { return S2.esc(s.name) + " <span class='num' style='color:var(--ink)'>" + S2.fmt(s.values[i], o.dec || 0) + (o.suf || "") + "</span>"; }).join(" · ");
    }
    function at(e) { var r = svg.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * W; return Math.round((x - pad.l) / ((W - pad.l - pad.r) / Math.max(1, n - 1))); }
    svg.addEventListener("pointerdown", function (e) { svg.setPointerCapture(e.pointerId); show(at(e)); });
    svg.addEventListener("pointermove", function (e) { if (e.pointerType === "mouse" || e.buttons) show(at(e)); });
    svg.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse") { cur.style.opacity = "0"; idx = -1; } });
    svg.addEventListener("keydown", function (e) { if (e.key === "ArrowRight") { show(idx < 0 ? 0 : idx + 1); e.preventDefault(); } if (e.key === "ArrowLeft") { show(idx < 0 ? n - 1 : idx - 1); e.preventDefault(); } });
  }

  /* ---- bars (rounded tops). values:[n], labels:[s], highlight index, compare (dashed reference line) ---- */
  C.bars = function (o) { return bars(o, o.w || 640); };
  function bars(o, W) {
    var k = id(), H = o.h || 200, pad = { l: 4, r: 4, t: 18, b: 24 }, vals = (o.values || []).map(function (v) { return num(v) ? v : 0; }), n = vals.length, iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    if (!n) return empty(o);
    var hi = nice(Math.max.apply(null, vals.concat([o.ref || 0, 1]))), bw = Math.min(28, iw / n * .62), gap = iw / n;
    var step = Math.ceil(n / Math.max(1, Math.floor(iw / 36)));   /* print as many labels as fit, about one per 36px */
    var out = vals.map(function (v, i) {
      var h = Math.max(2, v / hi * ih), x = pad.l + i * gap + (gap - bw) / 2, y = pad.t + ih - h, hot = o.hot == null ? true : o.hot === i, neg = o.colorBy && o.colorBy(v, i);
      var fill = neg || (hot ? "var(--chart-a)" : "color-mix(in srgb, var(--chart-a) 30%, var(--fill))");
      return '<g><rect class="c-bar" style="transform-origin:' + (x + bw / 2) + "px " + (pad.t + ih) + 'px;--d:' + Math.round(i / n * 240) + 'ms" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="' + Math.min(6, bw / 2) + '" fill="' + fill + '"><title>' + S2.esc((o.labels && o.labels[i] || "") + ": " + S2.fmt(v, o.dec || 0) + (o.suf || "")) + "</title></rect>" +
        (o.labels && o.labels[i] != null && i % step === 0 ? '<text x="' + (x + bw / 2) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="11" fill="var(--muted)">' + S2.esc(o.labels[i]) + "</text>" : "") +
        (n <= 12 && o.showValues ? '<text x="' + (x + bw / 2) + '" y="' + (y - 5) + '" text-anchor="middle" font-size="11" font-family="var(--font-num)" fill="var(--ink-2)">' + S2.fmt(v, o.dec || 0) + "</text>" : "") + "</g>";
    }).join("");
    var ref = o.ref != null ? '<line x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + (pad.t + ih - o.ref / hi * ih) + '" y2="' + (pad.t + ih - o.ref / hi * ih) + '" stroke="var(--ink)" stroke-opacity=".35" stroke-dasharray="3 4"/>' +
      '<text x="' + (W - pad.r) + '" y="' + (pad.t + ih - o.ref / hi * ih - 5) + '" text-anchor="end" font-size="11" fill="var(--muted)">' + S2.esc(o.refLabel || "League avg") + "</text>" : "";
    redraws[k] = function (w) { return bars(o, w); };
    return '<svg data-chart="' + k + '" viewBox="0 0 ' + W + " " + H + '" width="100%" role="img" aria-label="' + S2.esc(o.label || "Bar chart") + '" style="overflow:visible">' +
      '<line x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + (pad.t + ih) + '" y2="' + (pad.t + ih) + '" stroke="var(--separator)"/>' + out + ref + "</svg>";
  }

  /* ---- activity rings (Apple Fitness): rings:[{value 0..1, color, label, text}] ---- */
  C.rings = function (o) {
    var size = o.size || 156, sw = o.stroke || 15, gap = 3, cx = size / 2;
    var arcs = o.rings.map(function (r, i) {
      var rad = cx - sw / 2 - i * (sw + gap), c = 2 * Math.PI * rad, v = Math.max(0, Math.min(1, +r.value || 0));
      return '<circle cx="' + cx + '" cy="' + cx + '" r="' + rad + '" fill="none" stroke="' + r.color + '" stroke-opacity=".18" stroke-width="' + sw + '"/>' +
        '<circle class="c-ring" cx="' + cx + '" cy="' + cx + '" r="' + rad + '" fill="none" stroke="' + r.color + '" stroke-width="' + sw + '" stroke-linecap="round" ' +
        'style="--len:' + c.toFixed(1) + ";--off:" + (c * (1 - v)).toFixed(1) + ";stroke-dasharray:" + c.toFixed(1) + ";stroke-dashoffset:" + (c * (1 - v)).toFixed(1) + '" transform="rotate(-90 ' + cx + " " + cx + ')"><title>' + S2.esc(r.label + ": " + r.text) + "</title></circle>";
    }).join("");
    return '<svg viewBox="0 0 ' + size + " " + size + '" width="' + size + '" height="' + size + '" role="img" aria-label="' + S2.esc(o.label || o.rings.map(function (r) { return r.label + " " + r.text; }).join(", ")) + '">' + arcs + "</svg>";
  };

  /* ---- radar: axes:[label], a:[0..1], b:[0..1] reference ---- */
  C.radar = function (o) {
    var S = o.size || 280, cx = S / 2, cy = S / 2 + 4, R = S / 2 - 46, n = o.axes.length;
    function pt(i, v) { var a = -Math.PI / 2 + i * 2 * Math.PI / n; return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v]; }
    var rings = [.25, .5, .75, 1].map(function (f) { return '<polygon points="' + o.axes.map(function (_, i) { return pt(i, f).join(","); }).join(" ") + '" fill="' + (f === 1 ? "var(--fill-2)" : "none") + '" stroke="var(--separator)" stroke-width="1"/>'; }).join("");
    var spokes = o.axes.map(function (_, i) { var p = pt(i, 1); return '<line x1="' + cx + '" y1="' + cy + '" x2="' + p[0] + '" y2="' + p[1] + '" stroke="var(--separator)"/>'; }).join("");
    var labels = o.axes.map(function (a, i) { var p = pt(i, 1.2); return '<text x="' + p[0] + '" y="' + (p[1] + 4) + '" text-anchor="middle" font-size="11.5" font-weight="600" fill="var(--ink-2)">' + S2.esc(a) + "</text>"; }).join("");
    var poly = function (vals, cls, fill, stroke, dash) { return '<polygon class="' + cls + '" style="transform-origin:' + cx + "px " + cy + 'px" points="' + vals.map(function (v, i) { return pt(i, Math.max(.04, v)).join(","); }).join(" ") + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="2" stroke-linejoin="round"' + (dash ? ' stroke-dasharray="4 4"' : "") + "/>"; };
    return '<svg viewBox="0 0 ' + S + " " + (S + 6) + '" width="100%" style="max-width:' + S + 'px;margin:auto" role="img" aria-label="' + S2.esc(o.label || "Radar") + '">' + rings + spokes +
      (o.b ? poly(o.b, "", "none", "var(--chart-b)", true) : "") + poly(o.a, "c-radar", "color-mix(in srgb, var(--chart-a) 22%, transparent)", "var(--chart-a)") + labels + "</svg>";
  };

  /* (the percentile bar, C.pctBar, had no caller and was removed 2026-10-20 when ranks replaced percentiles: M.rank) */

  /* ---- sparkline ---- */
  C.spark = function (values, o) {
    values = (values || []).filter(num); if (!values.length) return "";
    o = o || {}; var W = o.w || 120, H = o.h || 34, lo = Math.min.apply(null, values), hi = Math.max.apply(null, values), r = hi - lo || 1;
    var pts = values.map(function (v, i) { return [2 + i * (W - 4) / Math.max(1, values.length - 1), H - 3 - (v - lo) / r * (H - 6)]; });
    var last = pts[pts.length - 1];
    return '<svg viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" aria-hidden="true"><path d="' + path(pts) + '" fill="none" stroke="' + (o.color || "var(--chart-a)") + '" stroke-width="2" stroke-linecap="round"/><circle cx="' + last[0] + '" cy="' + last[1] + '" r="2.8" fill="' + (o.color || "var(--chart-a)") + '"/></svg>';
  };

  /* ---- cohort heatmap: rows:[{label, size, cells:[0..1 or null]}], cols:[labels] ---- */
  C.heat = function (o) {
    var cell = function (v) {
      if (v == null) return '<td style="background:transparent"></td>';
      /* the text color is chosen from the background that actually renders (C.ink), in every theme and finish */
      return '<td class="c-heat" title="' + S2.pct(v, 0) + '" style="background:color-mix(in srgb, var(--chart-a) ' + Math.round(8 + v * 82) + '%, var(--surface));color:var(--ink)' +
        ';text-align:center;padding:9px 4px;border-radius:6px;font:600 .75rem/1 var(--font-num)">' + Math.round(v * 100) + "</td>";
    };
    return '<div class="tbl-wrap"><table style="border-collapse:separate;border-spacing:3px;width:100%;font-variant-numeric:tabular-nums" aria-label="' + S2.esc(o.label || "Retention") + '"><thead><tr><th class="t-cap" style="text-align:left;padding:4px">' + S2.esc(o.rowHead || "Cohort") + '</th><th class="t-cap" style="padding:4px">Size</th>' +
      o.cols.map(function (c) { return '<th class="t-cap" style="padding:4px;text-align:center">' + S2.esc(c) + "</th>"; }).join("") + "</tr></thead><tbody>" +
      o.rows.map(function (r) { return '<tr><td class="t-foot" style="white-space:nowrap;padding:4px 8px 4px 4px;color:var(--ink-2)">' + S2.esc(r.label) + '</td><td class="num t-foot" style="text-align:center">' + r.size + "</td>" + r.cells.map(cell).join("") + "</tr>"; }).join("") +
      "</tbody></table></div>";
  };

  /* ---- funnel: steps:[{label, value}] ---- */
  C.funnel = function (steps) {
    if (!steps || !steps.length) return "";
    var top = steps[0].value || 1;
    return '<div style="display:grid;gap:10px">' + steps.map(function (s, i) {
      var w = Math.max(3, s.value / top * 100), conv = i ? s.value / (steps[i - 1].value || 1) : null;
      return '<div style="display:grid;gap:5px"><div style="display:flex;justify-content:space-between;gap:8px"><span class="t-sub" style="color:var(--ink-2)">' + S2.esc(s.label) + '</span><span class="num" style="font-weight:600">' + S2.fmt(s.value) +
        (conv != null ? ' <span class="t-foot">' + S2.pct(conv, 0) + " of previous</span>" : "") + '</span></div><div style="height:12px;border-radius:6px;background:var(--fill)"><div class="c-pct" style="--p:' + w + '%;width:var(--p);height:100%;border-radius:6px;background:var(--chart-a);opacity:' + (1 - i * .12) + '"></div></div></div>';
    }).join("") + "</div>";
  };

  /* ---- scatter: points:[{x,y,label,href,hi}], axis labels; median crosshair splits four play styles ---- */
  C.scatter = function (o) { return scatter(o, o.w || 560); };
  function scatter(o, W) {
    if (!o.points || !o.points.length) return empty(o);
    var k = id(), H = o.h || 360, pad = { l: 40, r: 14, t: 14, b: 36 }, iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    var xmax = nice(Math.max.apply(null, o.points.map(function (p) { return p.x; }).concat([1]))), ymax = nice(Math.max.apply(null, o.points.map(function (p) { return p.y; }).concat([1])));
    var X = function (v) { return pad.l + v / xmax * iw; }, Y = function (v) { return pad.t + ih - v / ymax * ih; };
    var mx = o.mx != null ? X(o.mx) : null, my = o.my != null ? Y(o.my) : null;
    var dots = o.points.map(function (p, i) {
      return '<a href="' + S2.esc(p.href || "#") + '" aria-label="' + S2.esc(p.label + ": " + p.x + ", " + p.y) + '"><circle class="c-dot" style="--d:' + (i * 8) + 'ms" cx="' + X(p.x).toFixed(1) + '" cy="' + Y(p.y).toFixed(1) + '" r="' + (p.hi ? 7 : 5) + '" fill="' + (p.hi ? "var(--chart-a)" : "color-mix(in srgb, var(--chart-a) 38%, var(--surface))") + '" stroke="var(--surface)" stroke-width="1.5"><title>' + S2.esc(p.label) + "</title></circle>" +
        (p.hi ? '<text x="' + (X(p.x) + 10) + '" y="' + (Y(p.y) + 4) + '" font-size="12" font-weight="600" fill="var(--ink)">' + S2.esc(p.label) + "</text>" : "") + "</a>";
    }).join("");
    var quad = (mx != null && my != null) ? '<line x1="' + mx + '" x2="' + mx + '" y1="' + pad.t + '" y2="' + (pad.t + ih) + '" stroke="var(--separator)" stroke-dasharray="3 4"/><line x1="' + pad.l + '" x2="' + (pad.l + iw) + '" y1="' + my + '" y2="' + my + '" stroke="var(--separator)" stroke-dasharray="3 4"/>' +
      (o.quads || []).map(function (q, i) { var qx = i % 2 ? pad.l + iw - 6 : pad.l + 6, qy = i < 2 ? pad.t + 14 : pad.t + ih - 8; return '<text x="' + qx + '" y="' + qy + '" text-anchor="' + (i % 2 ? "end" : "start") + '" font-size="11" font-weight="600" fill="var(--muted)">' + S2.esc(q) + "</text>"; }).join("") : "";
    redraws[k] = function (w) { return scatter(o, w); };
    return '<svg data-chart="' + k + '" viewBox="0 0 ' + W + " " + H + '" width="100%" role="img" aria-label="' + S2.esc(o.label || "Scatter") + '" style="overflow:visible">' +
      '<line x1="' + pad.l + '" x2="' + (pad.l + iw) + '" y1="' + (pad.t + ih) + '" y2="' + (pad.t + ih) + '" stroke="var(--separator)"/><line x1="' + pad.l + '" x2="' + pad.l + '" y1="' + pad.t + '" y2="' + (pad.t + ih) + '" stroke="var(--separator)"/>' + quad +
      '<text x="' + (pad.l + iw / 2) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="12" fill="var(--muted)">' + S2.esc(o.xLabel) + '</text><text transform="translate(12 ' + (pad.t + ih / 2) + ') rotate(-90)" text-anchor="middle" font-size="12" fill="var(--muted)">' + S2.esc(o.yLabel) + "</text>" + dots + "</svg>";
  }

  /* ---- donut: parts:[{label, value, color}] ---- */
  C.donut = function (parts, o) {
    o = o || {}; var S = o.size || 132, sw = o.stroke || 16, r = S / 2 - sw / 2, c = 2 * Math.PI * r, tot = parts.reduce(function (a, p) { return a + p.value; }, 0) || 1, acc = 0;
    var segs = parts.map(function (p) { var len = p.value / tot * c, seg = '<circle cx="' + S / 2 + '" cy="' + S / 2 + '" r="' + r + '" fill="none" stroke="' + p.color + '" stroke-width="' + sw + '" stroke-dasharray="' + Math.max(0, len - 2).toFixed(1) + " " + c.toFixed(1) + '" stroke-dashoffset="' + (-acc).toFixed(1) + '" transform="rotate(-90 ' + S / 2 + " " + S / 2 + ')"><title>' + S2.esc(p.label + ": " + p.value) + "</title></circle>"; acc += len; return seg; }).join("");
    return '<svg viewBox="0 0 ' + S + " " + S + '" width="' + S + '" height="' + S + '" role="img" aria-label="' + S2.esc(parts.map(function (p) { return p.label + " " + p.value; }).join(", ")) + '">' + segs +
      (o.center ? '<text x="50%" y="50%" dy=".35em" text-anchor="middle" font-size="22" font-weight="600" font-family="var(--font-num)" fill="var(--ink)">' + S2.esc(o.center) + "</text>" : "") + "</svg>";
  };

  /* heat cells: dark or light text by the luminance of the rendered background. 0.179 is where black and white text have
     equal contrast, so either side clears 4.5:1. Runs on hydrate and again from S2.applyLook. */
  function lum(css) {
    var m = String(css).match(/-?[\d.]+(e-?\d+)?/gi); if (!m || m.length < 3) return null;
    var unit = /^color\(srgb/.test(css) ? 1 : 255;
    var c = m.slice(0, 3).map(function (v) { v = Math.max(0, Math.min(1, +v / unit)); return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  C.ink = function (root) {
    S2.$$(".c-heat", root).forEach(function (td) { var L = lum(getComputedStyle(td).backgroundColor); if (L != null) td.style.color = L > 0.179 ? "var(--on-light)" : "var(--on-dark)"; });
  };

  /* the kit owns chart width: a chart drawn at a guessed width is redrawn at the width it really has, once on hydrate and
     again when its box changes by more than 8% (a rotation, a resized window). Redraws replace the svg only, without
     replaying the entrance. */
  function off(svg) {   /* the width to redraw at, or 0 when the drawing already fits */
    var W = svg.viewBox && svg.viewBox.baseVal ? svg.viewBox.baseVal.width : 0, w = Math.round(svg.getBoundingClientRect().width);
    return svg._redraw && svg.isConnected && w && W && Math.abs(w - W) / W > 0.08 ? w : 0;
  }
  function realign(list) {   /* measure every chart first, then redraw, so a page of charts lays out once */
    list.map(function (svg) { return [svg, off(svg)]; }).forEach(function (x) { if (x[1]) redrawAt(x[0], x[1]); });
  }
  function redrawAt(svg, w) {
    var t = document.createElement("template"); t.innerHTML = svg._redraw(w);
    var nu = t.content.querySelector("svg[data-chart]"); if (!nu) return svg;
    var had = document.activeElement === svg;
    svg.parentNode.replaceChild(nu, svg); sizes.unobserve(svg);
    bind(nu); if (had) nu.focus({ preventScroll: true });
  }
  var pending = [], ptimer = 0;
  var sizes = new ResizeObserver(function (entries) {
    entries.forEach(function (e) { if (!e.target.isConnected) sizes.unobserve(e.target); else if (pending.indexOf(e.target) < 0) pending.push(e.target); });
    clearTimeout(ptimer); ptimer = setTimeout(function () { var p = pending; pending = []; realign(p); }, 120);
  });
  function bind(svg) {
    var k = svg.dataset.chart, b = binders[k];
    if (b) { b(svg); delete binders[k]; }
    if (redraws[k]) { svg._redraw = redraws[k]; delete redraws[k]; sizes.observe(svg); }
  }

  /* entrance: lines draw in, bars grow from their baseline, rings close, radar breathes out. Once per page. Staggers are
     capped at 240ms so a busy dashboard settles in well under a second (Emil's frequency rule). QA motion 2026-11-25: the
     durations now keep that promise (a ring took 1100ms and a percent bar about 1.04s with its stagger); every one ends by
     about 600ms, the longest stagger included. A soft repaint finishes them at once (S2.settle) */
  C.hydrate = function (root) {
    var fresh = S2.$$("[data-chart]", root).filter(function (svg) { return binders[svg.dataset.chart] || redraws[svg.dataset.chart]; });
    fresh.forEach(bind);
    realign(fresh);
    C.ink(root);
    if (S2.reduce.matches) return;
    var ease = "cubic-bezier(0.23, 1, 0.32, 1)", delay = function (el, i) { return Math.min(240, parseInt(el.style.getPropertyValue("--d")) || 0); };
    S2.$$(".c-draw", root).forEach(function (p) { var L = p.getTotalLength ? p.getTotalLength() : 0; if (!L) return;
      p.animate([{ strokeDasharray: L, strokeDashoffset: L }, { strokeDasharray: L, strokeDashoffset: 0 }], { duration: 500, easing: ease }); });
    S2.$$(".c-area", root).forEach(function (p) { p.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: 120, easing: "ease-out", fill: "backwards" }); });
    S2.$$(".c-bar", root).forEach(function (b) { b.animate([{ transform: "scaleY(0.02)" }, { transform: "scaleY(1)" }], { duration: 400, delay: delay(b), easing: ease, fill: "backwards" }); });
    S2.$$(".c-ring", root).forEach(function (r) { var L = r.style.getPropertyValue("--len"), off = r.style.getPropertyValue("--off");
      r.animate([{ strokeDashoffset: L }, { strokeDashoffset: off }], { duration: 600, easing: ease }); });
    S2.$$(".c-radar", root).forEach(function (p) { p.animate([{ transform: "scale(.6)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], { duration: 400, easing: ease }); });
    /* percent bars reveal with a clip, not a width animation, so no frame forces layout */
    S2.$$(".c-pct", root).forEach(function (b, i) { var rad = getComputedStyle(b).borderTopRightRadius || "0px";
      b.animate([{ clipPath: "inset(0 100% 0 0 round " + rad + ")" }, { clipPath: "inset(0 0 0 0 round " + rad + ")" }], { duration: 450, delay: Math.min(i, 8) * 24, easing: ease, fill: "backwards" }); });
    S2.$$(".c-dot", root).forEach(function (d) { d.animate([{ opacity: 0, transform: "scale(.6)" }, { opacity: 1, transform: "scale(1)" }], { duration: 420, delay: delay(d), easing: ease, fill: "backwards" }); d.style.transformBox = "fill-box"; d.style.transformOrigin = "center"; });
  };
})();
