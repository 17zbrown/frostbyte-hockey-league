/* The member's Inbox (alerts, messages and cases in one list, #/you?tab=inbox) and the header's Action Center
   reading of it: moved whole from js/pages/hq.js by the e0 split (2026-11-24); since i3a (2026-11-25) it holds only the
   real Inbox (the member's own notifications). It loads after hq.js and before js/pages/you.js, reads hq.js's pieces
   from S2._hq, and hq.js and you.js reach the functions here through S2._inbox.
   QA core (2026-11-25): the member's own cases (with the official's answers and a reply box) and direct-message
   conversations (with a reply box) join the alerts, read by js/live.js (S2.notifs.mine); every receipt that sends a
   member here is true now. */
(function () {
  "use strict";
  var S2 = window.S2;
  if (!S2 || !S2.page) return;
  var HQ = S2._hq;
  var M = HQ.M, ST = HQ.ST, closeOnLinks = HQ.closeOnLinks, empty = HQ.empty, esc = HQ.esc, head = HQ.head, me = HQ.me,
    plural = HQ.plural, refreshNav = HQ.refreshNav, repaint = HQ.repaint, sheet = HQ.sheet, tabName = HQ.tabName, tag = HQ.tag;
  /* the header's Action Center reads the viewer's cases from the Inbox (header v2): its badge counts answers not yet
     read, its panel lists the newest four with their status */
  function cases(p) { return inbox(p).filter(function (i) { return i.kind === "cases"; }); }
  S2.nav.info.action = function () { var n = cases(me()).filter(function (i) { return !isRead(i); }).length; return { n: n, label: plural(n, "new answer") }; };
  S2.nav.draw.cases = function () {
    var rows = cases(me()).slice(0, 4);
    if (!rows.length) return '<p class="nav-empty">Nothing filed yet. A case you file shows here with its status.</p>';
    return '<ul class="nav-reqs">' + rows.map(function (i) {
      var un = !isRead(i);
      return '<li><a class="nav-req' + (un ? " is-unread" : "") + '" href="#/you?tab=inbox&amp;show=cases"><span class="nav-req-t">' + (un ? '<span class="nav-dot"><span class="sr">New answer: </span></span>' : "") + esc(i.title) + "</span>" +
        '<span class="nav-req-m"><span>' + esc([i.status, i.from === "You" ? "" : i.from, M.ago(i.mins)].filter(Boolean).join(" · ")) + "</span></span></a></li>";
    }).join("") + "</ul>";
  };
  /* ---- Inbox: alerts, messages and cases in one list ---- */
  /* v5.00 swap (f, 2026-11-24): the alerts are the member's own notifications (js/live.js S2.notifs, live over the member's
     channel). QA core (2026-11-25): their cases and conversations join them (S2.notifs.cases and dms, null until read).
     A case is one row: its title, its status and the newest answer; it is unread while an answer from someone else is
     newer than the last time this member opened it on this device (S2.store "inbox.seen"; reading never writes to the
     league). A conversation is one row per member: the newest message, unread while the other member's messages wait
     unread (direct_messages.read_at, which opening it marks through mark_dm_read) */
  var CASE_NAME = { complaint: "Complaint", appeal: "Appeal", trade_request: "Trade request", position_change: "Position change", stats_correction: "Statistics correction", forfeit_appeal: "Forfeit appeal" };
  var CASE_STATUS = { open: ["", "Open"], reviewing: ["warn", "Reviewing"], acknowledged: ["", "Acknowledged"], resolved: ["win", "Resolved"], denied: ["loss", "Denied"] };
  function mins(iso) { return Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)); }
  function uid() { return S2.session && S2.session.profileId; }
  function seen() { return S2.store.get("inbox.seen", {}) || {}; }
  /* when someone other than the member last answered a case: a message in its thread, or the decision on it */
  function answeredAt(c) {
    var t = 0; (c.thread || []).forEach(function (m) { if (m.author_id !== uid()) t = Math.max(t, Date.parse(m.created_at)); });
    if (c.response && (c.status === "resolved" || c.status === "denied")) t = Math.max(t, Date.parse(c.updated_at || c.created_at));
    return t;
  }
  function caseItem(c) {
    var st = CASE_STATUS[c.status] || ["", c.status || "Open"], last = (c.thread || []).slice(-1)[0], at = Math.max(Date.parse(c.created_at), answeredAt(c), last ? Date.parse(last.created_at) : 0);
    var ans = answeredAt(c);
    return { id: "c-" + c.id, kind: "cases", icon: "doc", from: c.route === "manager" ? "Your front office" : "League office", mins: mins(new Date(at).toISOString()),
      title: c.subject || CASE_NAME[c.type] || "Case", body: last ? (last.author_id === uid() ? "You: " : "") + last.body : c.response || c.details || "", status: st[1], tone: st[0],
      read: !ans || ans <= (seen()[c.id] || 0), rec: c };
  }
  function convoItems(dms) {
    var me = uid(), by = {};
    dms.forEach(function (m) { var o = m.sender_id === me ? m.recipient_id : m.sender_id; (by[o] = by[o] || []).push(m); });
    return Object.keys(by).map(function (o) {
      var list = by[o].slice().sort(function (a, b) { return Date.parse(a.created_at) - Date.parse(b.created_at); }), last = list[list.length - 1];
      var waiting = list.filter(function (m) { return m.sender_id === o && !m.read_at; }).length, name = S2.notifs.name(o);
      return { id: "d-" + o, kind: "messages", icon: "people", from: name, mins: mins(last.created_at), title: (last.sender_id === me ? "You: " : "") + last.body,
        body: waiting ? plural(waiting, "new message") : list.length === 1 ? "1 message" : list.length + " messages", read: !waiting, other: o, rec: list };
    });
  }
  function inbox() {
    var now = Date.now(), N = S2.notifs || {};
    return (N.list || []).map(function (n) {
      return { id: "n-" + n.id, kind: "alerts", icon: "bell", from: "League office", mins: Math.max(0, Math.round((now - n.at) / 60000)), title: n.title, body: n.body,
        go: ["Open it", n.route], read: n.read };
    }).concat((N.cases || []).map(caseItem), convoItems(N.dms || []))
      .sort(function (a, b) { return a.mins - b.mins; });   /* newest first, whatever order the channel delivered them in */
  }
  /* read or not: the reader's own choice when they made one (ST.read: opened, or marked all read or unread), else how the
     item arrives. Reading the inbox never writes (header v2: the header's Action Center reads it on every route, and a
     read that recorded arrivals made an updated tab carry one more entry than the snapshot it came from) */
  function isRead(i) { return i.id in ST.read ? !!ST.read[i.id] : !!i.read; }
  var KIND = [["all", "All"], ["alerts", "Alerts"], ["messages", "Messages"], ["cases", "Cases"]];
  function paneInbox(p) {
    return '<div class="hqx-stack"><section class="hqx-block"><div data-w="inboxh">' + inboxHead(p) + "</div>" +
      '<div class="hqx-tools"><div class="seg" id="hqxKind" aria-label="Show">' + KIND.map(function (k) { return '<button data-v="' + k[0] + '" aria-pressed="' + (ST.filter === k[0]) + '">' + k[1] + "</button>"; }).join("") + "</div>" +
      '<span data-w="readall">' + readAllBtn(p) + "</span></div>" +
      /* a message goes to the member the sender picks; a case is the door to the league office (QA functional 2026-11-25:
         "Message the league office" opened a form asking which member to write to) */
      '<div class="hqx-actions"><button class="btn secondary sm" data-flow="message">New message</button><button class="btn secondary sm" data-flow="case">File a case</button></div>' +
      (S2.poolAsks ? S2.poolAsks.html() : "") + '<div data-w="inbox">' + inboxInner(p) + "</div></section></div>";
  }
  /* the unread count: the items on hand, plus the member's unread alerts beyond the page read (the database's exact count,
     S2.notifs.unreadTotal); while that count is unknown and older alerts are left to read, "35+" (QA worst-case 2026-11-25) */
  function unread(p) {
    var N = S2.notifs || {}, n = inbox(p).filter(function (i) { return !isRead(i); }).length, onPage = (N.list || []).filter(function (x) { return !x.read; }).length;
    return { n: n + (N.unreadTotal != null ? Math.max(0, N.unreadTotal - onPage) : 0), plus: N.unreadTotal == null && !!N.more };
  }
  function inboxHead(p) {
    var u = unread(p);
    return head({ k: "Inbox", h: u.n ? (u.plus ? S2.fmt(u.n) + "+ unread items" : plural(u.n, "unread item")) : "All caught up",
      p: "Alerts from the league office, your messages and the answers to your cases, newest first." });
  }
  /* with nothing unread the button turns the other way, so it never presses into nothing; with nothing at all there is no
     button (QA visual 2026-11-25: an empty Inbox offered Mark all unread). The host span stays for the in-place repaint */
  function readAllBtn(p) { var all = inbox(p); if (!all.length) return ""; var any = all.some(function (i) { return !isRead(i); }); return '<button class="btn plain sm" data-act="read-all">' + (any ? "Mark all read" : "Mark all unread") + "</button>"; }
  function paintInbox(p) { repaint("inbox", function () { return inboxInner(p); }); repaint("inboxh", function () { return inboxHead(p); }); repaint("readall", function () { return readAllBtn(p); }); refreshNav(); S2.nav.sync(); }
  function inboxInner(p) {
    if (S2.notifs && S2.notifs.mine) S2.notifs.mine();   /* at most every 30 seconds; the answer repaints this in place */
    var N = S2.notifs || {}, f = ST.filter, list = inbox(p).filter(function (i) { return f === "all" || i.kind === f; });
    var mineToo = f === "all" || f === "messages" || f === "cases";
    /* a failed read is said, never drawn as "nothing here" (fail loud). Try again is given to S2.empty as an action, so it
       is drawn in the page's own furniture (QA round 2 nit: the button was written by hand; the Inbox shows on a member's
       You page and Team HQ, both workspaces, so it stays the app's pill there, and a public page would get the website's) */
    var err = mineToo && N.mineErr ? S2.empty("err", "Your cases and messages could not be read", esc(N.mineErr), { t: "Try again", data: { "inbox-retry": "" } }) : "";
    if (!list.length) {
      if (err) return err;
      if (mineToo && uid() && (N.cases == null || N.dms == null)) return empty("Reading your inbox", "One moment.");
      /* QA visual 2026-11-25: the All filter read "No all right now." */
      return empty("Nothing here", f === "all" ? "No alerts, messages or case answers right now." : "No " + tabName(KIND, f).toLowerCase() + " right now.");
    }
    var older = (f === "all" || f === "alerts") && N.more ? '<div class="hqx-actions"><button type="button" class="btn secondary sm" data-inbox-older>Show older alerts</button></div>' : "";
    return err + '<div class="list hqx-list hqx-inbox">' + list.map(function (i) {
      var unread = !isRead(i);
      return '<button class="row hqx-msg' + (unread ? " is-unread" : "") + '" data-act="msg" data-id="' + i.id + '">' + (unread ? '<span class="hqx-dot"><span class="sr">Unread</span></span>' : '<span class="hqx-dot off" aria-hidden="true"></span>') +
        /* a case's status rides the title line, so the sender keeps its width at 320 ("Officia..." could not say who answered) */
        '<span class="grow"><span class="hqx-msg-top"><span class="hqx-from">' + esc(i.from) + '</span><span class="t-foot hqx-when">' + esc(M.ago(i.mins)) + "</span></span>" +
        '<span class="hqx-msg-tl"><span class="title hqx-msg-t">' + esc(i.title) + "</span>" + (i.status ? tag(i.tone, i.status) : "") + '</span><span class="sub">' + esc(i.body) + "</span></span></button>";
    }).join("") + "</div>" + older;
  }
  /* a case's or a conversation's thread, oldest first, and the box that answers it */
  function threadHtml(i) {
    var me = uid(), rows = i.kind === "cases" ? [{ author_id: me, body: i.rec.details || "", created_at: i.rec.created_at }].concat(i.rec.thread || []) : i.rec;
    /* the kit's grouped list (ui.css .list and .row): who and when above each message, the message in the reading size */
    var line = function (who, at, body) { return '<div class="row"><span class="grow"><span class="sub">' + esc(who) + " · " + esc(M.ago(mins(at))) + '</span><span class="title">' + esc(body) + "</span></span></div>"; };
    var out = rows.filter(function (m) { return m.body; }).map(function (m) { return line(m.author_id === me || m.sender_id === me ? "You" : S2.notifs.name(m.author_id || m.sender_id), m.created_at, m.body); });
    if (i.kind === "cases" && i.rec.response) out.push(line("The decision", i.rec.updated_at || i.rec.created_at, i.rec.response));
    return '<div class="list" role="list" aria-label="The conversation">' + out.join("") + "</div>";
  }
  function replyHtml(i) {
    return '<form class="field" data-inbox-reply="' + esc(i.id) + '" style="margin-top:16px"><label for="ibReply">' + "Reply to " + (i.kind === "cases" ? (i.rec.route === "manager" ? "your front office" : "the league office") : esc(i.from)) + "</label>" +
      '<textarea class="input" id="ibReply" rows="3" maxlength="2000"></textarea>' +
      '<p class="hqx-err t-foot" role="alert" hidden></p><div class="hqx-actions"><button type="submit" class="btn">Send</button></div></form>';
  }
  function openMsg(p, id) {
    var i = inbox(p).filter(function (x) { return x.id === id; })[0]; if (!i) return;
    ST.read[id] = true;
    if (i.kind === "cases") { var sn = seen(); sn[i.rec.id] = Math.max(answeredAt(i.rec), Date.now()); S2.store.set("inbox.seen", sn); }
    paintInbox(p);   /* repaint first (focus kept), so the sheet returns focus to a live row */
    if (i.kind !== "alerts") return openThread(p, i);
    /* an alert's link to the server invite (an https address) opens in a new tab, as the current site's bell does */
    var out = i.go && /^https?:\/\//.test(i.go[1]) ? ' target="_blank" rel="noopener"' : "";
    closeOnLinks(sheet({ title: i.title, html: '<div class="hqx-sheet-msg"><p class="t-foot">' + esc(i.from) + " · " + esc(M.ago(i.mins)) + (i.status ? " · " + esc(i.status) : "") + "</p>" +
      '<p class="t-body">' + esc(i.body) + "</p>" + '<div class="hqx-actions">' + (i.go ? '<a class="btn" href="' + esc(i.go[1]) + '"' + out + " data-close-go>" + esc(i.go[0]) + "</a>" : "") + "</div></div>" }));
  }
  /* a case or a conversation: its thread and a reply that goes through the league's own door (action_messages.insert,
     never a staff-only note; direct_messages.insert), then the thread is read again and repainted in the open sheet */
  function openThread(p, i) {
    var sh = closeOnLinks(sheet({ title: i.kind === "cases" ? i.title : i.from, html: '<div class="hqx-sheet-msg">' + (i.kind === "cases" ? '<p class="t-foot">' + esc(i.from) + (i.status ? " · " + esc(i.status) : "") + "</p>" : "") +
      '<div data-inbox-thread>' + threadHtml(i) + "</div>" + replyHtml(i) + "</div>" }));
    if (i.kind === "messages" && !i.read && S2.write) S2.write("mark_dm_read", { p_other: i.other }).then(function () { return S2.notifs.mine(true); })
      .catch(function (e) { console.error("inbox: the conversation could not be marked read:", e && e.message); });
    return sh;
  }
  /* the Inbox's own buttons, delegated once: Show older alerts, Try again, and a reply */
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-inbox-older], [data-inbox-retry]"); if (!b) return;
    b.disabled = true;
    var run = b.hasAttribute("data-inbox-older") ? S2.notifs.older() : S2.notifs.mine(true);
    Promise.resolve(run).catch(function (er) { S2.toast(er && er.message || "That could not be read. Try again.", "err"); b.disabled = false; });
  });
  document.addEventListener("submit", function (e) {
    var f = e.target.closest("[data-inbox-reply]"); if (!f) return;
    e.preventDefault();
    var id = f.getAttribute("data-inbox-reply"), i = inbox(me()).filter(function (x) { return x.id === id; })[0], ta = S2.$("textarea", f), err = S2.$(".hqx-err", f), btn = S2.$("button[type=submit]", f);
    var txt = (ta.value || "").trim(); if (!i) return;
    if (!txt) { err.textContent = "Write a reply first."; err.hidden = false; ta.focus(); return; }
    btn.disabled = true; err.hidden = true;
    var w = i.kind === "cases" ? S2.write("action_messages.insert", { row: { request_id: i.rec.id, author_id: uid(), body: txt, internal: false } })
      : S2.write("direct_messages.insert", { row: { sender_id: uid(), recipient_id: i.other, body: txt } });
    w.then(function () { return S2.notifs.mine(true); }).then(function () {
      ta.value = ""; btn.disabled = false;
      var now = inbox(me()).filter(function (x) { return x.id === id; })[0], host = f.parentNode && S2.$("[data-inbox-thread]", f.parentNode);
      if (now && host) host.innerHTML = threadHtml(now);
      S2.toast(i.kind === "cases" ? "Reply sent" : "Message sent", "ok");
    }, function (er) { btn.disabled = false; err.textContent = S2.forms ? S2.forms.said(er) : er && er.message || "Not sent. Try again."; err.hidden = false; });
  });
  /* a case or a message just filed shows here at once */
  document.addEventListener("s2:filed", function (e) { var f = e.detail && e.detail.flow; if ((f === "case" || f === "message") && S2.notifs && S2.notifs.mine) S2.notifs.mine(true); });
  /* a new alert, or the bell marking them read, repaints the Inbox widgets in place when the Inbox is on screen (the
     standing rule: never the router, never a page reset) */
  S2.live.on("notifs", function () { if (S2.$('#page [data-w="inbox"]')) paintInbox(me()); else { refreshNav(); S2.nav.sync(); } });
  /* what js/pages/hq.js and js/pages/you.js use from this file, looked up by name when called */
  S2._inbox = { KIND: KIND, inbox: inbox, inboxInner: inboxInner, isRead: isRead, openMsg: openMsg,
    paintInbox: paintInbox, paneInbox: paneInbox };
})();
