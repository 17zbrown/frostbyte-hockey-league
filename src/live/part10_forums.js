/* ================================================================
   FORUMS — boards, threads, replies.

   Reading is public; posting needs a Discord sign-in. Every write goes
   through a SECURITY DEFINER RPC (forum_thread_create / forum_post_create
   / forum_*_edit / forum_moderate) — the tables carry no INSERT or UPDATE
   policy at all, so nothing here is trusted to enforce a rule. What the UI
   does is hide controls a member can't use and say plainly why.

   Bodies are USER TEXT rendered into HTML, so CG.forumBody escapes first
   and only then linkifies http(s) — the one thing a scouting-Discord board
   guarantees is a page full of links people typed themselves.
   ================================================================ */

CG.FORUM_ICON = { general:"msg", questions:"flag", scouting:"search", strategy:"grid", feedback:"doc" };

/* ---------------------------------------------------------------- *
 * Safe body rendering: walk the RAW text, escape every span of it,
 * and emit an anchor only for a run that starts with http:// or
 * https://. Nothing user-typed is ever concatenated unescaped, so a
 * pasted "<script>", a javascript: URL, or a protocol-relative
 * //evil.com can only ever come out as text.
 *
 * Matching on the raw text rather than the escaped text matters: an
 * earlier version escaped first, which meant the trailing-punctuation
 * trim below chewed the ";" off the end of the escaper's own entities.
 * "<https://discord.gg/x>" — the standard no-embed form people paste —
 * came out as a dead link ending in "&amp;gt" with a stray ";" after it.
 * ---------------------------------------------------------------- */
CG.forumBody = function(text){
  var raw = String(text == null ? "" : text), out = "", last = 0;
  var re = /https?:\/\/[^\s<]+/gi, m;
  while ((m = re.exec(raw)) !== null){
    var url = m[0], trail = "";
    /* Don't swallow trailing punctuation into the link. > " ' are in here because of
       how people actually paste invites: <https://discord.gg/x> is Discord's own
       no-embed form, and quoting one is just as common — leaving the bracket on the
       end produces a link that looks right and 404s. A trailing & is never meant
       to be part of the URL either. */
    var p = /[.,;:!?)\]>"'&]+$/.exec(url);
    if (p){ trail = p[0]; url = url.slice(0, -trail.length); }
    out += esc(raw.slice(last, m.index));
    var label = url.length > 62 ? url.slice(0, 60) + "…" : url;
    out += '<a href="'+esc(url)+'" target="_blank" rel="noopener nofollow ugc" class="fx-link">'+esc(label)+'</a>';
    out += esc(trail);
    last = m.index + m[0].length;
  }
  out += esc(raw.slice(last));
  /* safe to split now: esc() leaves newlines alone and no anchor can contain one */
  return out.split(/\n{2,}/).map(function(para){
    return '<p>'+para.replace(/\n/g,"<br>")+'</p>';
  }).join("");
};

/* Both composers agree on what a post is, so editing can't blank something
   creating it would have refused. Returns an error string, or "" if it's fine. */
CG.forumValidate = function(title, body){
  if (title !== null && String(title).trim().length < 4) return "Give the thread a title first — at least a few words.";
  if (!String(body||"").trim()) return "Write something in the post.";
  return "";
};

/* Our RPCs raise messages written for members ("This board is read-only."), and
   PostgREST tags those P0001. Anything else is plumbing — a member should never
   read "permission denied for function forum_board_list". */
CG.forumErr = function(err, fallback){
  if (err && err.code === "P0001" && err.message) return err.message;
  if (err){ try { console.warn("[forums]", err); } catch(e){} }
  return fallback;
};

CG.forumAgo = function(iso){
  var t = Date.parse(iso); if (!isFinite(t)) return "";
  var s = Math.max(0, (Date.now()-t)/1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s/60)+"m ago";
  if (s < 86400) return Math.floor(s/3600)+"h ago";
  if (s < 86400*7) return Math.floor(s/86400)+"d ago";
  return CG.fmtDay(t);
};
CG.forumIsOffice = function(){ var r = CG.role(); return r==="staff" || r==="commish"; };
CG.forumMe = function(){ return (CG.auth && CG.auth.user && CG.auth.user.id) || null; };
/* the badge next to a name — the office is worth marking so answers carry weight */
CG.forumRoleChip = function(role){
  if (role==="commissioner") return '<span class="chip chip-chrome" style="font-size:9px">COMMISSIONER</span>';
  if (role==="staff") return '<span class="chip" style="font-size:9px">STAFF</span>';
  return "";
};
CG.forumSignedOutNote = function(what){
  return '<div class="note" style="margin:0"><span class="caption">'+
    'Sign in with Discord to '+esc(what)+'. It takes ten seconds and also gets you into the server. '+
    '<a href="#/signin" style="font-weight:700;border-bottom:2px solid var(--chrome)">Sign in</a></span></div>';
};

/* ---------------------------------------------------------------- *
 * #/forums — the board index
 * ---------------------------------------------------------------- */
CG.ROUTES.forums = function(){
  var head = CG.pageHead("The lounge","Forums",
    "Talk shop with the league — ask a question, post your scouting Discord, or argue about lines. "+
    "Anyone can read; sign in with Discord to post.");
  return head + '<div class="shell" style="padding-bottom:44px"><div id="fxBoards">'+
    '<p class="caption">Loading the boards…</p></div></div>';
};
CG.AFTER.forums = function(){
  var host = document.getElementById("fxBoards");
  if (!host || !CG.sb) return;
  CG.sb.rpc("forum_board_list").then(function(r){
    if (r.error){
      host.innerHTML = '<div class="card"><div class="card-b"><p class="caption" style="color:var(--red-ink)">'+
        '<b>Couldn’t load the forums.</b> '+esc(CG.forumErr(r.error,"Something went wrong at our end."))+
        ' Reload and try again.</p></div></div>';
      return;
    }
    var boards = r.data || [];
    if (!boards.length){
      host.innerHTML = '<div class="empty"><div class="e-art">'+CG.ic("msg",22)+'</div><b>No boards yet</b>'+
        '<p>The boards aren’t open yet. They’ll show up here the moment the league office adds them — '+
        'say hello in Discord in the meantime.</p></div>';
      return;
    }
    host.innerHTML = '<div class="stack" style="gap:12px">'+boards.map(function(b){
      /* own-property only: a board slugged "constructor" would otherwise sail past
         the || fallback and put the string "undefined" in the page */
      var icon = Object.prototype.hasOwnProperty.call(CG.FORUM_ICON, b.slug) ? CG.FORUM_ICON[b.slug] : "msg";
      return '<a class="card raise fx-board" href="#/forum/'+esc(b.slug)+'" aria-label="'+esc(b.name)+'">'+
        '<div class="card-b" style="display:flex;gap:14px;align-items:flex-start">'+
          '<span class="nf-ic" style="flex:none">'+CG.ic(icon,17)+'</span>'+
          '<span style="flex:1;min-width:0">'+
            '<h2 class="fx-h" style="font-size:17px">'+esc(b.name)+
              (b.locked?' <span class="chip" style="font-size:9px">READ-ONLY</span>':"")+'</h2>'+
            '<span class="caption" style="display:block;margin-top:3px">'+esc(b.description||"")+'</span>'+
            (b.lastTitle
              ? '<span class="caption fx-txt" style="display:block;margin-top:7px;color:var(--steel)">'+
                  'Latest: <b>'+esc(b.lastTitle)+'</b> · '+esc(CG.forumAgo(b.lastAt))+'</span>'
              : '<span class="caption" style="display:block;margin-top:7px;color:var(--steel-2)">No threads yet — start the first one.</span>')+
          '</span>'+
          '<span style="flex:none;text-align:right">'+
            '<b class="num" style="font-family:var(--f-disp);font-size:20px">'+(b.threads|0)+'</b>'+
            '<span class="caption" style="display:block">thread'+((b.threads|0)===1?"":"s")+'</span>'+
            '<span class="caption" style="display:block;color:var(--steel-2)">'+(b.posts|0)+' repl'+((b.posts|0)===1?"y":"ies")+'</span>'+
          '</span>'+
        '</div></a>';
    }).join("")+'</div>'+
    '<p class="caption" style="margin-top:18px">Keep it civil — the rulebook’s conduct chapter applies here too, and staff moderate these boards.</p>';
  });
};

/* ---------------------------------------------------------------- *
 * #/forum/:slug — one board's threads + the composer
 * ---------------------------------------------------------------- */
/* A route can't borrow another route's markup — the router picks the AFTER hook by
   route NAME, so returning the forums page here would render its "Loading the
   boards…" placeholder and then never run CG.AFTER.forums to fill it. Redirect. */
CG.fxRedirect = function(){
  setTimeout(function(){ location.replace("#/forums"); }, 0);
  return '<div class="shell" style="padding:40px 0"><p class="caption">Taking you to the forums…</p></div>';
};
CG.ROUTES.forum = function(slug){
  if (!slug) return CG.fxRedirect();
  return '<section class="sec-tight"><div class="shell">'+
      '<a class="sec-link" href="#/forums">'+CG.ic("back",14)+' All boards</a>'+
      '<div id="fxBoardHead" style="margin-top:10px"></div>'+
    '</div></section>'+
    '<div class="shell" style="padding-bottom:44px"><div id="fxThreads"><p class="caption">Loading…</p></div></div>';
};
CG.AFTER.forum = function(slug){
  var head = document.getElementById("fxBoardHead"), host = document.getElementById("fxThreads");
  if (!host || !CG.sb || !slug) return;
  CG._fxBoard = slug;
  CG.sb.rpc("forum_thread_list", { p_board: slug }).then(function(r){
    if (r.error){
      host.innerHTML = '<div class="card"><div class="card-b"><p class="caption" style="color:var(--red-ink)">'+
        '<b>Couldn’t load this board.</b> '+esc(CG.forumErr(r.error,"Something went wrong at our end."))+
        ' Reload and try again, or go '+
        '<a href="#/forums" style="font-weight:700;border-bottom:2px solid var(--chrome)">back to the forums</a>.</p></div></div>';
      return;
    }
    var d = r.data || {}, b = d.board, threads = (d.threads||[]);
    if (!b){
      head.innerHTML = '';
      host.innerHTML = '<div class="empty"><div class="e-art">'+CG.ic("msg",22)+'</div><b>No such board</b>'+
        '<p>It may have been renamed. <a href="#/forums" style="font-weight:700;border-bottom:2px solid var(--chrome)">Back to the forums</a>.</p></div>';
      return;
    }
    var office = CG.forumIsOffice(), signedIn = !!CG.forumMe();
    var canPost = signedIn && (!b.locked || office);
    head.innerHTML = '<h1 class="h-page">'+esc(b.name)+'</h1>'+
      '<p class="lede" style="margin-top:8px">'+esc(b.description||"")+'</p>';

    /* office moderation is visible; a member only ever sees their own tools */
    var rows = threads.filter(function(t){ return !t.deleted || office; }).map(function(t){
      return '<div class="card fx-thread'+(t.deleted?" fx-gone":"")+'" style="margin-bottom:10px">'+
        '<div class="card-b" style="display:flex;gap:12px;align-items:flex-start">'+
          '<span style="flex:1;min-width:0">'+
            '<h2 class="fx-h" style="display:flex;gap:7px;align-items:center;flex-wrap:wrap;font-size:16px">'+
              (t.pinned?'<span class="chip chip-chrome" style="font-size:9px">PINNED</span>':"")+
              (t.locked?'<span class="chip" style="font-size:9px">'+CG.ic("lock",10)+' LOCKED</span>':"")+
              (t.deleted?'<span class="chip chip-loss" style="font-size:9px">REMOVED</span>':"")+
              '<a href="#/thread?id='+esc(t.id)+'" style="font-weight:700">'+esc(t.title)+'</a>'+
            '</h2>'+
            '<span class="caption fx-txt" style="display:block;margin-top:5px">'+esc(t.excerpt||"")+(String(t.excerpt||"").length>=160?"…":"")+'</span>'+
            '<span class="caption" style="display:block;margin-top:7px;color:var(--steel-2)">'+
              esc(t.author)+' '+CG.forumRoleChip(t.authorRole)+' · started '+esc(CG.forumAgo(t.createdAt))+
              ' · last activity '+esc(CG.forumAgo(t.lastAt))+'</span>'+
          '</span>'+
          '<span style="flex:none;text-align:right">'+
            '<b class="num" style="font-family:var(--f-disp);font-size:18px">'+(t.replies|0)+'</b>'+
            '<span class="caption" style="display:block">repl'+((t.replies|0)===1?"y":"ies")+'</span></span>'+
        '</div></div>';
    }).join("");

    /* Read-only is a property of the board, not of who's looking at it — test the
       lock BEFORE the sign-in, or a signed-out visitor gets invited to start a
       thread on a board that would refuse them the moment they came back. */
    var readOnly = b.locked && !office;
    host.innerHTML =
      (canPost
        ? '<div class="card" style="margin-bottom:18px"><div class="card-h"><h2 class="fx-h" style="font-size:14px;font-weight:800;letter-spacing:.02em;text-transform:uppercase">Start a thread</h2>'+
            (b.locked?'<span class="chip chip-chrome" style="font-size:9px">STAFF ONLY</span>':"")+'</div>'+
          '<div class="card-b">'+
            '<label class="fld"><span>Title</span><input id="fxTitle" maxlength="140" placeholder="Say it in a line — e.g. “LW looking for a club, PS5, evenings ET”"></label>'+
            '<label class="fld"><span>Post</span><textarea id="fxBody" rows="5" maxlength="8000" placeholder="Links are welcome — paste your scouting Discord invite and tell people what you’re after."></textarea></label>'+
            '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">'+
              '<button class="btn btn-chrome" id="fxNew">Post thread</button>'+
              '<span class="caption">Posting as <b>'+esc(((CG.auth.profile||{}).gamertag)||"you")+'</b>.</span>'+
            '</div>'+
          '</div></div>'
        : (readOnly
            ? '<div class="note" style="margin-bottom:18px"><span class="caption">This board is read-only — the league office posts here.</span></div>'
            : '<div style="margin-bottom:18px">'+CG.forumSignedOutNote("start a thread or reply")+'</div>'))+
      (rows || '<div class="empty"><div class="e-art">'+CG.ic("msg",22)+'</div><b>No threads here yet</b>'+
        '<p>'+(readOnly ? "Nothing posted here yet — check back soon."
                        : canPost ? "Be the first — say hello or ask what you came to ask."
                                  : "Nothing here yet. Sign in and it could be your thread.")+'</p></div>');

    var btn = document.getElementById("fxNew");
    if (btn) btn.addEventListener("click", function(){
      var title = (document.getElementById("fxTitle").value||"").trim();
      var body  = (document.getElementById("fxBody").value||"").trim();
      var bad = CG.forumValidate(title, body);
      if (bad){ CG.toast(bad,"err"); return; }
      btn.disabled = true;
      CG.sb.rpc("forum_thread_create", { p_board: slug, p_title: title, p_body: body }).then(function(rr){
        btn.disabled = false;
        if (rr.error){ CG.toast(CG.forumErr(rr.error,"Couldn’t post that — try again."),"err"); return; }
        CG.toast("Posted","ok");
        location.hash = "#/thread?id="+rr.data;
      });
    });
  });
};

/* ---------------------------------------------------------------- *
 * #/thread?id= — one conversation
 * ---------------------------------------------------------------- */
CG.ROUTES.thread = function(param, qs){
  var id = (qs && qs.id) || param || "";
  if (!id) return CG.fxRedirect();
  return '<section class="sec-tight"><div class="shell"><div id="fxCrumb"></div></div></section>'+
    '<div class="shell" style="padding-bottom:44px"><div id="fxThread"><p class="caption">Loading…</p></div></div>';
};
CG.AFTER.thread = function(param, qs){
  var id = (qs && qs.id) || param || "";
  var host = document.getElementById("fxThread"), crumb = document.getElementById("fxCrumb");
  if (!host || !CG.sb || !id) return;

  function render(done){
    CG.sb.rpc("forum_thread_get", { p_thread: id }).then(function(r){
      if (r.error){
        host.innerHTML = '<div class="card"><div class="card-b"><p class="caption" style="color:var(--red-ink)">'+
          '<b>Couldn’t load this thread.</b> '+esc(CG.forumErr(r.error,"Something went wrong at our end."))+
          ' Reload and try again, or go '+
          '<a href="#/forums" style="font-weight:700;border-bottom:2px solid var(--chrome)">back to the forums</a>.</p></div></div>';
        return;
      }
      var d = r.data || {}, t = d.thread, posts = d.posts || [];
      if (!t){
        crumb.innerHTML = '<a class="sec-link" href="#/forums">'+CG.ic("back",14)+' All boards</a>';
        host.innerHTML = '<div class="empty"><div class="e-art">'+CG.ic("msg",22)+'</div><b>That thread isn’t here</b>'+
          '<p>It may have been removed. <a href="#/forums" style="font-weight:700;border-bottom:2px solid var(--chrome)">Back to the forums</a>.</p></div>';
        return;
      }
      var office = CG.forumIsOffice(), me = CG.forumMe();
      /* the server redacts a removed thread down to its breadcrumb for anyone
         outside the office, so a missing title means "redacted", not "broken" —
         belt on the role check in case the cached client role ever runs ahead */
      if (t.deleted && (!office || t.title == null)){
        crumb.innerHTML = '<a class="sec-link" href="#/forum/'+esc(t.boardSlug)+'">'+CG.ic("back",14)+' '+esc(t.boardName)+'</a>';
        host.innerHTML = '<div class="empty"><div class="e-art">'+CG.ic("flag",22)+'</div><b>This thread was removed</b>'+
          '<p>The league office took it down. If you think that was a mistake, open a case in your Action Center.</p></div>';
        return;
      }
      crumb.innerHTML = '<a class="sec-link" href="#/forum/'+esc(t.boardSlug)+'">'+CG.ic("back",14)+' '+esc(t.boardName)+'</a>'+
        '<h1 class="h-page fx-txt" style="margin-top:10px">'+
          (t.pinned?'<span class="chip chip-chrome" style="font-size:10px;vertical-align:middle">PINNED</span> ':"")+
          (t.locked?'<span class="chip" style="font-size:10px;vertical-align:middle">'+CG.ic("lock",10)+' LOCKED</span> ':"")+
          (t.deleted?'<span class="chip chip-loss" style="font-size:10px;vertical-align:middle">REMOVED</span> ':"")+
          esc(t.title)+'</h1>';

      function tools(kind, pid, authorId, isDeleted){
        var mine = me && authorId === me, bits = [];
        if (!mine && !office) return "";
        if (!isDeleted) bits.push('<button class="btn btn-ghost btn-sm" data-fx-edit="'+kind+'" data-fx-id="'+esc(pid)+'">Edit</button>');
        if (!isDeleted) bits.push('<button class="btn btn-ghost btn-sm" data-fx-mod="delete" data-fx-kind="'+kind+'" data-fx-id="'+esc(pid)+'">Remove</button>');
        if (isDeleted && office) bits.push('<button class="btn btn-ghost btn-sm" data-fx-mod="restore" data-fx-kind="'+kind+'" data-fx-id="'+esc(pid)+'">Restore</button>');
        return '<span style="display:inline-flex;gap:6px;flex-wrap:wrap">'+bits.join("")+'</span>';
      }

      var opener =
        '<div class="card" style="margin-bottom:14px"><div class="card-b">'+
          '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px">'+
            '<b style="font-family:var(--f-disp)">'+esc(t.author)+'</b>'+CG.forumRoleChip(t.authorRole)+
            '<span class="caption">'+esc(CG.forumAgo(t.createdAt))+(t.editedAt?" · edited":"")+'</span>'+
            '<span style="margin-left:auto;display:inline-flex;gap:6px;flex-wrap:wrap">'+
              (office?'<button class="btn btn-ghost btn-sm" data-fx-mod="'+(t.pinned?"unpin":"pin")+'" data-fx-kind="thread" data-fx-id="'+esc(t.id)+'">'+(t.pinned?"Unpin":"Pin")+'</button>'+
                      '<button class="btn btn-ghost btn-sm" data-fx-mod="'+(t.locked?"unlock":"lock")+'" data-fx-kind="thread" data-fx-id="'+esc(t.id)+'">'+(t.locked?"Unlock":"Lock")+'</button>':"")+
              tools("thread", t.id, t.authorId, t.deleted)+
            '</span>'+
          '</div>'+
          '<div class="fx-body" id="fxOpener">'+CG.forumBody(t.body)+'</div>'+
        '</div></div>';

      var replies = posts.map(function(p){
        if (p.deleted && !office){
          return '<div class="card fx-gone" style="margin-bottom:10px"><div class="card-b">'+
            '<span class="caption">This reply was removed.</span></div></div>';
        }
        return '<div class="card'+(p.deleted?" fx-gone":"")+'" style="margin-bottom:10px"><div class="card-b">'+
          '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px">'+
            '<b style="font-family:var(--f-disp)">'+esc(p.author)+'</b>'+CG.forumRoleChip(p.authorRole)+
            '<span class="caption">'+esc(CG.forumAgo(p.createdAt))+(p.editedAt?" · edited":"")+'</span>'+
            (p.deleted?'<span class="chip chip-loss" style="font-size:9px">REMOVED</span>':"")+
            '<span style="margin-left:auto">'+tools("post", p.id, p.authorId, p.deleted)+'</span>'+
          '</div>'+
          '<div class="fx-body" data-fx-post="'+esc(p.id)+'">'+(p.body==null?'<p class="caption">(removed)</p>':CG.forumBody(p.body))+'</div>'+
        '</div></div>';
      }).join("");

      /* Locked first, sign-in second: a locked thread is locked for a signed-out
         reader too, and telling them to sign in "to reply" would be a lie. A
         read-only board locks its threads the same way — forum_post_create
         enforces both, so the UI has to describe both. */
      var shut = (t.locked || t.boardLocked) && !office, composer;
      if (shut) composer = '<div class="note"><span class="caption">'+CG.ic("lock",12)+' '+
        (t.locked ? 'This thread is locked — the league office closed it to new replies.'
                  : 'This board is read-only — the league office posts here.')+'</span></div>';
      else if (!me) composer = CG.forumSignedOutNote("reply to this thread");
      else composer =
        '<div class="card"><div class="card-b">'+
          '<label class="fld"><span>Reply</span><textarea id="fxReply" rows="4" maxlength="8000" placeholder="Add to the conversation…"></textarea></label>'+
          '<button class="btn btn-chrome" id="fxSend">Post reply</button>'+
        '</div></div>';

      /* the header counts what a reader can actually see; a removed reply leaves a
         tombstone but must not make the count disagree with the board index */
      var live = posts.filter(function(p){ return !p.deleted; }).length;

      /* render() is re-entered by every write, and it replaces the whole subtree —
         carry the half-typed reply and the caret across, or moderating a thread
         silently eats whatever the moderator was in the middle of writing. */
      var draftEl = document.getElementById("fxReply");
      var draft = draftEl ? draftEl.value : "";
      var hadFocus = draftEl && document.activeElement === draftEl;

      host.innerHTML = opener +
        (live ? '<div class="rinkrule-lite caption" style="margin:16px 0 10px">'+live+' repl'+(live===1?"y":"ies")+'</div>' : "")+
        replies + '<div style="margin-top:16px">'+composer+'</div>';

      var send = document.getElementById("fxSend"), reply = document.getElementById("fxReply");
      if (reply && draft){
        reply.value = draft;
        if (hadFocus){ try { reply.focus(); reply.setSelectionRange(draft.length, draft.length); } catch(e){} }
      }
      if (send) send.addEventListener("click", function(){
        var body = (document.getElementById("fxReply").value||"").trim();
        if (!body){ CG.toast("Write something first","err"); return; }
        send.disabled = true;
        CG.sb.rpc("forum_post_create", { p_thread: id, p_body: body }).then(function(rr){
          send.disabled = false;
          if (rr.error){ CG.toast(CG.forumErr(rr.error,"Couldn’t post that — try again."),"err"); return; }
          CG.toast("Replied","ok");
          var box0 = document.getElementById("fxReply");
          if (box0) box0.value = "";                       /* posted — don't carry it over */
          render(function(){
            var box = document.getElementById("fxReply");
            if (box) try { box.focus(); } catch(e){}
          });
        });
      });

      host.querySelectorAll("[data-fx-mod]").forEach(function(btn){
        btn.addEventListener("click", function(){
          var el = this;
          var action = el.getAttribute("data-fx-mod"), kind = el.getAttribute("data-fx-kind"), pid = el.getAttribute("data-fx-id");
          var go = function(){
            /* Pin then Lock in quick succession would otherwise fire two writes and
               two reloads whose answers can land out of order, leaving the buttons
               labelled for a state the server has already moved past. */
            if (el.disabled) return;
            el.disabled = true;
            CG.sb.rpc("forum_moderate", { p_kind: kind, p_id: pid, p_action: action }).then(function(rr){
              el.disabled = false;
              if (rr.error){ CG.toast(CG.forumErr(rr.error,"Couldn’t do that — try again."),"err"); return; }
              CG.toast("Done","ok");
              if (action==="delete" && kind==="thread" && !CG.forumIsOffice()) location.hash = "#/forum/"+t.boardSlug;
              /* put focus back on the equivalent control in the rebuilt DOM, so a
                 keyboard user isn't dumped at the top of the page after every action */
              else render(function(){
                var again = host.querySelector('[data-fx-id="'+pid+'"]');
                if (again) try { again.focus(); } catch(e){}
              });
            });
          };
          if (action==="delete") CG.confirm("Remove this "+(kind==="thread"?"thread":"reply")+"?",
            "It stops being visible to members. The league office can restore it.", "Remove", go);
          else go();
        });
      });

      host.querySelectorAll("[data-fx-edit]").forEach(function(btn){
        btn.addEventListener("click", function(){
          var kind = this.getAttribute("data-fx-edit"), pid = this.getAttribute("data-fx-id");
          var cur = kind==="thread" ? t.body : (posts.find(function(x){ return x.id===pid; })||{}).body || "";
          CG.modal("Edit "+(kind==="thread"?"thread":"reply"),
            (kind==="thread"?'<label class="fld"><span>Title</span><input id="fxeTitle" maxlength="140" value="'+esc(t.title)+'"></label>':"")+
            '<label class="fld"><span>Post</span><textarea id="fxeBody" rows="6" maxlength="8000">'+esc(cur)+'</textarea></label>',
            '<button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-chrome" id="fxeGo">Save</button>');
          var go = document.getElementById("fxeGo");
          if (!go) return;
          go.addEventListener("click", function(){
            var body = (document.getElementById("fxeBody").value||"").trim();
            var title = kind==="thread" ? (document.getElementById("fxeTitle").value||"").trim() : null;
            /* the same rule the composer applies — editing must not be a way to
               blank a post that couldn't have been created blank */
            var bad = CG.forumValidate(title, body);
            if (bad){ CG.toast(bad,"err"); return; }
            var b = this; b.disabled = true;
            var call = kind==="thread"
              ? CG.sb.rpc("forum_thread_edit", { p_thread: pid, p_title: title, p_body: body })
              : CG.sb.rpc("forum_post_edit", { p_post: pid, p_body: body });
            call.then(function(rr){
              b.disabled = false;
              if (rr.error){ CG.toast(CG.forumErr(rr.error,"Couldn’t save that — try again."),"err"); return; }
              if (CG.closeOverlay) CG.closeOverlay();
              CG.toast("Saved","ok");
              render(function(){
                var again = host.querySelector('[data-fx-id="'+pid+'"]');
                if (again) try { again.focus(); } catch(e){}
              });
            });
          });
        });
      });

      if (typeof done === "function") done();
    });
  }
  render();
};
