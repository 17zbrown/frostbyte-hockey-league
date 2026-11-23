/* v4.56: members edit and delete their own messages, the office can delete and still read, and message boxes grow.
   node tools/message-edit-delete-v456.test.cjs
   Commissioner, 2026-11-23: "Can you make the text boxes wrap text if the text is longer than the single line box? Can
   you also allow people to edit and delete messages they send in text boxes on the website similar to how discord allows
   you to right click the text on desktop, or hold on mobile and a mini menu pops up with a copy, edit or delete option?"
   Rulings the same day: deleted = gone for members, the office keeps a copy; edited = marked, the office keeps the old
   text; the author only until the filing or application is decided (a direct message any time); "Commissioners and
   staff, but keep the data so other staff and commissioners can still view them."
   Pins the SQL record, the client (the menu, the three threads, the growing boxes, the live updates), the permission
   rules run against the real client code, Rule 1.3 in the rendered book and the changelog entry. */
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const R = (f) => fs.readFileSync(path.join(root, f), "utf8");
let pass = 0, fail = 0;
const A = (name, cond, more) => { if (cond) { pass++; console.log("PASS " + name); } else { fail++; console.log("FAIL " + name + (more ? "  (" + more + ")" : "")); } };
const DASHES = new RegExp("[" + String.fromCharCode(0x2014, 0x2013) + "]");

console.log("1. The database record");
const sql = R("sql/2026-11-23-message-edit-delete-v456.sql");
const fn = (name) => { const m = sql.match(new RegExp("create or replace function public\\." + name + "\\([\\s\\S]*?\\nend \\$function\\$;")); return m ? m[0] : ""; };
const edit = fn("edit_message"), del = fn("delete_message"), notices = fn("_rewrite_message_notices");
A("the header quotes the commissioner and the four rulings",
  /single line box\? Can\n-- you also allow people to edit and delete messages they send in text boxes on the website/.test(sql)
  && /"Gone, office keeps a copy"/.test(sql) && /"Mark it, office keeps old text"/.test(sql) && /"Until it is decided"/.test(sql)
  && /"Commissioners and staff, but keep the data so other staff and commissioners can still view them\."/.test(sql));
A("each message table gains edited_at, deleted_at and deleted_by", ["action_messages", "application_messages", "direct_messages"].every((t) =>
  new RegExp("alter table public\\." + t + "\\n  add column edited_at timestamptz,\\n  add column deleted_at timestamptz,\\n  add column deleted_by uuid references public\\.profiles\\(id\\) on delete set null;").test(sql)));
A("the nonempty checks allow an emptied row only once it is deleted",
  /add constraint am_nonempty check \(deleted_at is not null or /.test(sql) && /add constraint dm_body_or_media check \(deleted_at is not null or /.test(sql)
  && /add constraint direct_messages_body_check check \(length\(btrim\(coalesce\(body, ''\)\)\) <= 2000\n    and \(deleted_at is not null or /.test(sql));
A("a message is born unedited and undeleted (insert guard on all three)",
  /new\.edited_at := null; new\.deleted_at := null; new\.deleted_by := null;/.test(sql)
  && (sql.match(/create trigger trg_message_insert_clean before insert on public\.(action|application|direct)_messages/g) || []).length === 3);
A("the history is RLS, office read only, and never a direct message's",
  /create table public\.message_history \(/.test(sql) && /alter table public\.message_history enable row level security;/.test(sql)
  && /revoke all on public\.message_history from public, anon, authenticated;/.test(sql) && /grant select on public\.message_history to authenticated;/.test(sql)
  && /using \(source <> 'direct' and \(public\.is_staff\(\) or public\.is_commissioner\(\)\)\);/.test(sql));
A("edit: only the author, only while open, never a deleted or emptied message, old text to the history",
  /if v_author <> v_uid or not v_sees then\n    raise exception 'NOT_AUTHORIZED: you can edit only your own messages\.'/.test(edit)
  && /raise exception 'LOCKED: this has been decided, so its messages stand as the record/.test(edit) && /raise exception 'GONE: that message was deleted\.'/.test(edit)
  && /raise exception 'EMPTY: a message needs some text\. Delete it instead\.'/.test(edit)
  && /values \(p_source, p_id, 'edit', v_old, v_uid\);/.test(edit) && /set body = v_body, edited_at = v_now where id = p_id;/.test(edit));
A("open means a filing not resolved or denied, an application still pending; a direct message always",
  /r\.status not in \('resolved', 'denied'\)/.test(edit) && (edit.match(/a\.status = 'pending'/g) || []).length === 3
  && /select m\.sender_id, m\.body, m\.deleted_at, m\.created_at, m\.media_path is not null, true, true/.test(edit));
A("delete: the author while open, or the office; a staff member never on their own filing or application",
  /if not \(v_mod or \(v_author = v_uid and v_open\)\) then/.test(del)
  && /public\.is_commissioner\(\) or \(public\.is_staff\(\) and r\.profile_id is distinct from v_uid\n\s+and r\.target_profile_id is distinct from v_uid\)/.test(del)
  && /public\.is_commissioner\(\) or \(public\.is_staff\(\) and not public\.owns_application\(m\.app_type, m\.application_id\)\)/.test(del)
  && /\(v_uid in \(m\.sender_id, m\.recipient_id\)\), false,/.test(del));
A("delete keeps the whole message in the history, then empties the row and marks it",
  del.indexOf("insert into public.message_history") < del.indexOf("update public.action_messages")
  && /values \(p_source, p_id, 'delete', v_old, v_detail \|\| jsonb_build_object\('author_id', v_author\), v_uid\);/.test(del)
  && /set body = null, attachments = '\{\}', deleted_at = v_now, deleted_by = v_uid/.test(del)
  && /set body = '', media_path = null, media_type = null, deleted_at = v_now, deleted_by = v_uid/.test(del));
A("the bell preview follows the message, matched by type, timestamp and its own text",
  /v_new := case when p_new is null then 'A message was deleted\.'/.test(notices)
  && /where n\.type = v_type and n\.created_at = p_created and right\(n\.body, length\(v_old\)\) = v_old;/.test(notices)
  && /perform public\._rewrite_message_notices\(p_source, v_created, v_old, v_body\);/.test(edit) && /perform public\._rewrite_message_notices\(p_source, v_created, v_old, null\);/.test(del));
A("grants: members call the two doors; the preview writer and the insert guard are internal",
  /grant execute on function public\.edit_message\(text, uuid, text\) to authenticated;/.test(sql) && /grant execute on function public\.delete_message\(text, uuid\) to authenticated;/.test(sql)
  && /revoke all on function public\._rewrite_message_notices\(text, timestamptz, text, text\) from public, anon, authenticated;/.test(sql)
  && /revoke all on function public\._message_insert_clean\(\) from public, anon, authenticated;/.test(sql));
A("the self-checks raise on a missing column, guard, a write policy, a duplicate door, a grant or an open history",
  ["is missing a column", "has no insert guard", "has an UPDATE or DELETE policy", "expected exactly one edit_message and one delete_message", "a grant is wrong", "message_history must be RLS, office read only"].every((t) => sql.indexOf(t) >= 0));
A("the rehearsal and the apply are recorded", /Result: REHEARSAL OK: T1 T2 T3 T4 T5 T6 T7 T8 T9/.test(sql)
  && /Applied as migration v456_message_edit_delete; tools\/sql\/grant-audit\.sql/.test(sql));
A("the grant audit lists the two new client RPCs", /unnest\(array\['edit_message','delete_message',/.test(R("tools/sql/grant-audit.sql")));
A("the record has no dashes", !DASHES.test(sql));

console.log("\n2. The client");
const live = R("src/live/part_live.js"), head = R("src/live/part1_head.html"), ui = R("src/live/part4_ui.js");
A("one menu: right-click, a 450ms hold on touch, the Menu key or Shift+F10",
  /document\.addEventListener\("contextmenu", function\(e\)\{/.test(live) && /if \(e\.pointerType !== "touch"\) return;/.test(live)
  && /CG\.msgMenuOpen\(row, x, y, false\);\n    \}, 450\) \};/.test(live) && /e\.key==="ContextMenu" \|\| \(e\.shiftKey && e\.key==="F10"\)/.test(live));
A("...a hold that turns into a scroll is not a hold", /if \(msgPress && \(Math\.abs\(e\.clientX - msgPress\.x\) > 10 \|\| Math\.abs\(e\.clientY - msgPress\.y\) > 10\)\) msgPressEnd\(\);/.test(live)
  && /document\.addEventListener\("pointercancel", msgPressEnd, \{ passive:true \}\);/.test(live));
A("...links, media and text boxes keep the browser's own menu", /t\.closest\("a,video,img,textarea,input,button,\.msg-edit"\)/.test(live));
A("...Copy, Edit and Delete, the last two only where the row allows them",
  /data-mm="copy">'\+CG\.ic\("copy",15\)\+'Copy text/.test(live) && /row\.hasAttribute\("data-msg-edit"\) \? '<button type="button" role="menuitem" data-mm="edit">/.test(live)
  && /row\.hasAttribute\("data-msg-del"\) \? '<button type="button" role="menuitem" class="danger" data-mm="delete">/.test(live));
A("...keyboard: arrows move, Escape closes and returns focus, it opens at once when opened from the keyboard",
  /e\.key==="ArrowDown" \|\| e\.key==="ArrowUp"/.test(live) && /if \(f && f\.row && f\.row\.isConnected\) f\.row\.focus\(\{ preventScroll:true \}\);/.test(live)
  && /menu\.className = "msg-menu"\+\(byKeyboard \? " instant" : ""\);/.test(live));
A("...the menu stays inside the viewport", /top = Math\.max\(pad, Math\.min\(top, window\.innerHeight - h - pad\)\);/.test(live));
A("the two writers are the RPCs, and their errors read as sentences",
  /CG\.sb\.rpc\("edit_message", \{ p_source:src, p_id:id, p_body:next \}\)/.test(live) && /CG\.sb\.rpc\("delete_message", \{ p_source:src, p_id:id \}\)/.test(live)
  && /return \/\^\[A-Z_\]\+: \/\.test\(s\) \? s\.slice\(s\.indexOf\(": "\)\+2\)/.test(live));
A("delete asks first, and says the office keeps a copy", /CG\.confirm\("Delete this message\?", why, "Delete"/.test(live) && /The league office keeps a copy\./.test(live));
A("all three threads draw each message through CG.msgRow, so one change repaints one row",
  /return divider \+ CG\.msgRow\("direct", m, CG\.dmBubble\);/.test(live) && /msgs\.map\(function\(m\)\{ return CG\.msgRow\("application", m, row\); \}\)/.test(live)
  && /shownMsgs\.map\(function\(m\)\{ return CG\.msgRow\("action", m, function\(m\)\{/.test(live) && /if \(html\) row\.outerHTML = html; else row\.remove\(\);/.test(live));
A("a deleted message is gone for members; the office sees a marker it can open",
  /if \(src==="direct" \|\| !CG\.msgOffice\(\)\) return "";/.test(live) && /Message deleted by '\+esc\(by\)\+/.test(live)
  && /CG\._dm\.msgs = \(r\.data\|\|\[\]\)\.filter\(function\(m\)\{ return !m\.deleted_at; \}\);/.test(live) && /return !have\[m\.id\] && !m\.deleted_at;/.test(live));
A("(edited) for everyone; for the office it opens the history", /title="See what it said before">\(edited\)<\/button>/.test(live)
  && /CG\.sb\.from\("message_history"\)\.select\("kind,body,detail,changed_by,changed_at"\)/.test(live));
A("application threads read the id and the change marks, and see an edit in the fingerprint",
  (live.match(/"id,app_type,application_id,sender_id,body,created_at,edited_at,deleted_at,deleted_by, sender:/g) || []).length === 2
  && /var fp = rows\.length \+ "\|" \+ \(rows\.length \? rows\[0\]\.created_at : ""\) \+ "\|" \+ marked;/.test(live));
A("each caller says whether the application is open and whose it is",
  /\{office:false, status:CG\.auth\.ownerApp\.status, mine:true\}/.test(live) && /\{office:false, status:app\.status, mine:true\}/.test(live)
  && /\{office:false, status:a\.status, mine:true\}/.test(live) && /\{office:true, status:a\.status,\n    mine: /.test(live));
A("live: an edit or delete on any of the three repaints in place", [
    /table:"direct_messages",filter:"recipient_id=eq\."\+me\},function\(payload\)\{\n        CG\.msgApplyUpdate\("direct", payload && payload\.new\);/,
    /table:"application_messages" \}, function\(payload\)\{\n        CG\.msgApplyUpdate\("application", payload && payload\.new\);/,
    /table:"action_messages" \}, function\(payload\)\{\n        CG\.msgApplyUpdate\("action", payload && payload\.new\);/].every((re) => re.test(live)));
A("the message boxes grow: application chat, Action Center reply, direct message, vote reason",
  /<textarea class="grow" rows="1" enterkeyhint="send" data-appchat-input=/.test(live) && /<textarea class="grow" rows="1" enterkeyhint="send" data-reply-for=/.test(live)
  && /<textarea id="dmInput" class="grow" rows="1" enterkeyhint="send"/.test(live) && /<textarea id="appVoteNote" class="grow" rows="1"/.test(live)
  && !/<input data-appchat-input=/.test(live) && !/<input data-reply-for=/.test(live) && !/<input id="appVoteNote"/.test(live));
A("...Enter sends and Shift+Enter starts a line, never mid-composition", /CG\.enterSends = function\(e\)\{ return e\.key==="Enter" && !e\.shiftKey && !e\.isComposing; \};/.test(live)
  && (live.match(/if \(!CG\.enterSends\(e\)\) return;/g) || []).length === 2);
A("...sized by field-sizing where the browser has it, by CG.growTa elsewhere",
  /textarea\.grow\{resize:none;overflow-y:auto;max-height:220px;line-height:1\.45;field-sizing:content\}/.test(head)
  && /CG\._fieldSizing = typeof CSS !== "undefined" && !!CSS\.supports && CSS\.supports\("field-sizing", "content"\);/.test(live));
A("the menu's motion: 140ms ease-out from the corner, none from the keyboard, opacity only with reduced motion",
  /@starting-style\{\.msg-menu\{opacity:0;transform:scale\(\.96\)\}\}/.test(head) && /\.msg-menu\.instant\{transition:none\}/.test(head)
  && /@media \(prefers-reduced-motion:reduce\)\{\.msg-menu\{transition:opacity 140ms ease\}\}/.test(head));
A("on touch, holding a message selects nothing and shows no callout; hover is gated", /@media \(pointer:coarse\)\{\[data-msg\]\{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none\}/.test(head)
  && /@media \(hover:hover\) and \(pointer:fine\)\{\.msg-menu button:hover/.test(head));
A("direct messages stack on a phone (the thread had ninety-odd pixels)", /@media \(max-width:720px\)\{\.dm-grid\{grid-template-columns:1fr;min-height:0\}/.test(head)
  && /'<div class="grid dm-grid">'\+/.test(live) && !/grid-template-columns:280px 1fr;gap:0;min-height:520px">/.test(live));
A("three icons for the menu", /  copy:'<rect/.test(ui) && /  pen:'<path/.test(ui) && /  trash:'<path/.test(ui));

console.log("\n3. The permission rules, run against the client code");
{
  const s = live.indexOf("CG.msgPerms = function"), e = live.indexOf("\n};\n", s) + 3;
  const CG = { auth: { user: { id: "me" } } };
  new Function("CG", live.slice(s, e))(CG);
  const P = (src, m, ctx) => { const p = CG.msgPerms(src, m, ctx); return (p.edit ? "E" : "-") + (p.del ? "D" : "-"); };
  A("my direct message: edit and delete; theirs: nothing", P("direct", { sender_id: "me" }) === "ED" && P("direct", { sender_id: "them" }) === "--");
  A("my filing message while open: both; once decided: nothing", P("action", { author_id: "me" }, { open: true }) === "ED" && P("action", { author_id: "me" }, { open: false }) === "--");
  A("the office on another member's message: delete only, open or decided", P("application", { sender_id: "them" }, { open: true, mod: true }) === "-D"
    && P("action", { author_id: "them" }, { open: false, mod: true }) === "-D");
  A("nobody moderates a direct message, and a deleted message offers nothing", P("direct", { sender_id: "them" }, { mod: true }) === "--"
    && P("direct", { sender_id: "me", deleted_at: "2026-11-23" }) === "--");
}

console.log("\n4. The rulebook and the changelog");
{
  const CG = {}; new Function("CG", R("src/live/part3_content.js"))(CG);
  const rb = CG.CONTENT.rulebook, r13 = rb.chapters[1].sections.find((x) => x.id === "1.3");
  const p = (r13 && r13.paragraphs[4]) || "";
  A("Rule 1.3 states who may change a message and until when", /may be edited or deleted by the member who sent them\. A direct message may be changed at any time\./.test(p)
    && /may be changed by its author only until that filing or application is decided; from then on it stands as the record\./.test(p));
  A("...the marks, the office's power and its limit, and the copy kept", /An edited message is marked as edited, and a deleted message is removed from the conversation for its members\./.test(p)
    && /save that a staff member shall not do so on a filing they made or in which they are named, or on their own application\./.test(p)
    && /The league office keeps the earlier text of every edited message and the whole of every deleted message/.test(p)
    && /is kept in the league’s records and is not shown to anyone on the website\./.test(p));
  A("...in the rendered book", fs.existsSync(path.join(root, "index.html")) ? R("index.html").indexOf("may be changed by its author only until that filing or application is decided") >= 0 : true);
  A("...no dashes, no gendered pronouns", !DASHES.test(p) && !/ - /.test(p) && !/\b(he|his|him|she|her|hers)\b/i.test(p));
  const e = rb.changelog.find((c) => c.version === "4.56") || {};   /* by version: a later release takes changelog[0] */
  const t = JSON.stringify(e);
  A("the changelog has its 4.56 entry", e.dateIso === "2026-11-23" && typeof e.summary === "string" && Array.isArray(e.items) && e.items.length > 0);
  A("...naming the menu, the time limit, the office's copy and Rule 1.3", /right.click/i.test(t) && /hold/i.test(t) && /decided/.test(t) && /copy/.test(t) && /Rule 1\.3/.test(t));
  A("...with no dashes, no gendered pronouns, no code identifiers", !DASHES.test(t) && !/ - /.test(t) && !/\b(he|his|him|she|her|hers)\b/i.test(t)
    && !/edit_message|delete_message|message_history|msgMenu|textarea/.test(t));
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
