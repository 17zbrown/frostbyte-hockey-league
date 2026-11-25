/* S2 concept: the header search, grouped and role-aware, with the rulebook in it.
   Commissioner, 2026-11-09: "The main search box should be able to search anything available to the player searching
   based on their league role. This includes showing rulebook items."
   - What may be found is S2.searchIndex (js/model.js), which already gates Team HQ, Staff Desk and Control Center
     entries by S2.has. This file adds one more gate in front of every result: an entry whose address is a workspace the
     role cannot open is dropped, so the search never shows a door the menu hides (S2.WORKSPACES, the gate S2.route uses).
   - The rules are read from S2.RB (js/rulebook.js, the live rulebook; v5.00 swap, one book): every section in force, its
     number, title and text for a short snippet around the match, with the book's tokens filled as the rulebook page fills
     them (S2._league.rbText). Appendix A's shelved text is not offered: a search leads to the rules in force. No second
     copy of the rulebook lives here.
   - Results come in groups (Pages, Players, Clubs, Rules, Workspaces, Games), each word of the query marked; the
     palette's combobox (js/core.js S2.palette) draws them and keeps the arrow keys, Enter and Escape. */
(function () {
  "use strict";
  var S2 = window.S2;
  if (!S2 || !S2.palette) { console.error("js/search.js needs js/core.js first"); return; }
  var GROUPS = [["page", "Pages"], ["player", "Players"], ["club", "Clubs"], ["rule", "Rules"], ["work", "Workspaces"], ["game", "Games"]];
  var CAP = { page: 6, player: 5, club: 4, rule: 6, work: 6, game: 4 };
  var WS_HINT = { "Team HQ": 1, "Staff Desk": 1, "Control Center": 1 };

  /* ---------- the rules, read from the live book (once) ---------- */
  var RULES = null;
  function rules() {
    if (RULES) return RULES;
    var fill = S2._league && S2._league.rbText;
    if (!S2.RB) { console.error("S2 search: js/rulebook.js is not loaded, so rules cannot be searched"); return (RULES = []); }
    if (!fill) { console.error("S2 search: js/pages/league.js is not loaded, so the rulebook's tokens cannot be filled"); return (RULES = []); }
    RULES = [];
    S2.RB.chapters.forEach(function (c) {
      if (!c.shelved) c.sections.forEach(function (s) { RULES.push({ id: s.id, title: s.title, text: s.paragraphs.map(function (p) { return fill(p); }).join(" ") }); });
    });
    if (!RULES.length) console.error("S2 search: S2.RB holds no section in force");
    return RULES;
  }

  /* ---------- matching: every word must appear; marks wrap each word ---------- */
  function words(q) { return q.toLowerCase().split(/\s+/).filter(Boolean); }
  function hits(hay, ws) { hay = hay.toLowerCase(); return ws.every(function (w) { return hay.indexOf(w) >= 0; }); }
  function mark(text, ws) {
    var t = String(text || ""), lt = t.toLowerCase(), spans = [];
    ws.forEach(function (w) { var i = 0, j; while (w && (j = lt.indexOf(w, i)) >= 0) { spans.push([j, j + w.length]); i = j + w.length; } });
    spans.sort(function (a, b) { return a[0] - b[0]; });
    var out = "", at = 0;
    spans.forEach(function (s) { if (s[0] < at) return; out += S2.esc(t.slice(at, s[0])) + "<mark>" + S2.esc(t.slice(s[0], s[1])) + "</mark>"; at = s[1]; });
    return out + S2.esc(t.slice(at));
  }
  /* a short window of the rule's text around the first matched word, cut at word edges */
  function snippet(text, ws) {
    var lt = text.toLowerCase(), i = -1;
    ws.forEach(function (w) { var j = lt.indexOf(w); if (j >= 0 && (i < 0 || j < i)) i = j; });
    if (i < 0) return text.length > 110 ? text.slice(0, text.lastIndexOf(" ", 110)) + "…" : text;
    var a = Math.max(0, text.lastIndexOf(" ", Math.max(0, i - 40))), b = text.indexOf(" ", Math.min(text.length, i + 80));
    if (b < 0) b = text.length;
    return (a > 0 ? "…" : "") + text.slice(a, b).trim() + (b < text.length ? "…" : "");
  }
  function route(href) { var m = /^#\/([^?\/]*)/.exec(href || ""); return m ? m[1] : ""; }
  function open(href) {   /* the same gate S2.route applies: a workspace this role does not hold is never offered */
    var ws = S2.WORKSPACES.filter(function (w) { return w[0] === route(href); })[0];
    return !ws || S2.has(ws[2]);
  }
  function groupOf(x) {
    if (WS_HINT[x.hint]) return "work";
    if (x.icon === "clubs" && /Division/.test(x.hint || "")) return "club";
    if (/^#\/player\//.test(x.href)) return "player";
    if (/^#\/game\//.test(x.href)) return "game";
    return "page";
  }

  /* the grouped results for a query: [{ g, label, items: [{ href, icon, html, sub }] }] */
  S2.search = function (q) {
    var ws = words(q || ""), by = {};
    GROUPS.forEach(function (g) { by[g[0]] = []; });
    var all = (S2.searchIndex ? S2.searchIndex() : []).filter(function (x) { return open(x.href); });
    if (!ws.length) {   /* nothing typed: the pages a role reaches most, as before */
      all.filter(function (x) { return groupOf(x) === "page"; }).slice(0, 8).forEach(function (x) { by.page.push({ href: x.href, icon: x.icon, html: S2.esc(x.label), sub: S2.esc(x.hint || "") }); });
    } else {
      all.forEach(function (x) {
        if (!hits(x.label + " " + (x.kw || "") + " " + (x.hint || ""), ws)) return;
        var g = groupOf(x);
        by[g].push({ href: x.href, icon: x.icon, html: mark(x.label, ws), sub: mark(x.hint || "", ws), first: x.label.toLowerCase().indexOf(ws[0]) === 0 });
      });
      rules().forEach(function (r) {
        if (!hits("rule " + r.id + " " + r.title + " " + r.text, ws)) return;
        var inHead = hits("rule " + r.id + " " + r.title, ws);
        /* v5.00 swap (e6): the whole book has many sections that mention a word in passing, so book order alone buried the
           rule that is about it ("waiver" listed 2.2 to S2.4 and cut S2.5, the waiver rule, at the cap): a rule whose text
           uses the words more often ranks higher */
        var lt = r.text.toLowerCase(), uses = ws.reduce(function (a, w) { return a + lt.split(w).length - 1; }, 0);
        by.rule.push({ href: "#/rulebook?rule=" + r.id, icon: "doc", html: "Rule " + mark(r.id, ws) + " · " + mark(r.title, ws),
          sub: inHead ? S2.esc(snippet(r.text, [])) : mark(snippet(r.text, ws), ws), first: inHead, uses: uses });
      });
      /* a label that starts with the first word comes first in its group, then (rules) the more uses, the index order otherwise */
      Object.keys(by).forEach(function (k) { by[k] = by[k].map(function (x, i) { x.i = i; return x; }).sort(function (a, b) { return (b.first - a.first) || (b.uses || 0) - (a.uses || 0) || a.i - b.i; }); });
    }
    return GROUPS.filter(function (g) { return by[g[0]].length; }).map(function (g) { return { g: g[0], label: g[1], items: by[g[0]].slice(0, CAP[g[0]]) }; });
  };
})();
