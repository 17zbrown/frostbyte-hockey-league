# Chel Gaming — Brand Bible

The canonical reference for how Chel Gaming looks, sounds, and holds together. The public,
visual version of this document lives on the site at **/#/brand**; this file is the source text
behind it. If the two ever disagree, the tokens in `src/live/part1_head.html` win — they are what
actually renders.

---

## 1. Who we are

**Chel Gaming Hockey League** — abbreviated **CGHL** — is a free, community-run competitive
EA Sports NHL league played 6-on-6 in World of Chel. Eight clubs, two divisions, a full season
with live standings, imported box scores, trades, and playoffs.

- **Chel Gaming** is the umbrella brand (the organization). **CGHL** is its flagship league. Written
  in full it is the *Chel Gaming Hockey League*; in running text after first mention, *the league*
  or *CGHL*. Never "Chel Gaming League" — that name is used nowhere and is wrong.
- **"Chel"** is the community's name for EA NHL's 6v6 World of Chel mode. It is the reason the
  league exists and the root of the name; keep it.
- **Mission, in one line:** *The competitive home of 6v6 EA Sports NHL. Run by players, for players.*

**Personality.** Broadcast-grade but player-run. We present the league the way a real sports
property presents itself — clean tables, live standings, box scores, a rulebook — while sounding
like the people who actually play it, not a corporation. Competitive, plainspoken, precise.

We are **not** affiliated with EA Sports, the NHL, Discord, or Twitch. Club names and marks belong
to their owners.

---

## 2. The logo

The mark is a **power mark monogram**: a "C" for Chel whose open mouth is crossed by a short bar —
the "G" of Gaming, and a nod to a play/power button. One shape carries both letters.

### The suite

| Logo | What it is | Use it when |
|---|---|---|
| **Primary badge** | The mark on a near-black rounded tile: light C `#F4F4F0`, chrome crossbar `#FFE500` | The default. Anywhere with a dark or neutral surface — the masthead, the footer, the Discord bot avatar, the share card. |
| **Light mark** | Transparent, ink C `#101519` + gold crossbar `#D9A800` | On any *light* background — a white page, a light email header, print, a light Discord embed. |
| **Light tile** | The light mark on a white tile with a hairline border | The light equivalent of the badge, for avatars and app tiles on light surfaces. |
| **Favicon** | The primary badge at 48px | Browser tabs and bookmarks. |
| **Wordmark lockup** | Mark + `CHEL GAMING` (Archivo 900) over `HOCKEY LEAGUE` (mono eyebrow) | Headers, credits, anywhere the name must appear with the mark. |

**Files** (served at the site root): `favicon.svg`, `logo-light.svg`,
`chel-gaming-logo-1024.png` (dark badge), `chel-gaming-logo-light-1024.png` (transparent light
mark), `chel-gaming-logo-light-tile-1024.png` (light tile), `og.png` (share card).

### Rules

- **Clear space:** keep free space around the mark equal to at least the tile's corner radius
  (about ¼ of the mark's height). Nothing crowds it.
- **Minimum size:** 24px for the favicon; 20px in dense UI. Below that the crossbar closes up.
- **Background match is the whole point.** The chrome-yellow crossbar is ~1.07:1 on white — it
  *vanishes*. Use the light mark on light, the badge on dark. Never the chrome mark on white.
- **Never** recolor the C or crossbar off-palette, stretch or skew the mark, rotate it, add a drop
  shadow / glow / outline / gradient, box the transparent mark in an unapproved tile, or place the
  badge on a busy or low-contrast photo.

---

## 3. Color

A confident neutral base, **one** disciplined accent, and semantic status colors that never
double as decoration.

### Neutrals
| Token | Hex (light) | Role |
|---|---|---|
| `--ink` | `#101519` | Primary text and marks |
| `--ink-2` / `--ink-3` | `#1A2127` / `#242D34` | Softer body text, long copy |
| `--steel` | `#5C6B75` | Secondary text, captions, eyebrows |
| `--line` / `--line-soft` | `#E3E6DF` / `#EDEFE9` | Borders, hairlines |
| `--ice` | `#F5F6F2` | Page ground |
| `--paper` | `#FFFFFF` | Cards, raised surfaces |
| `--bc` | `#101519` | **Broadcast surface** — constant in both themes; the dark bands, the ticker, the hero |

### Accent — use it sparingly
| Token | Hex | Role |
|---|---|---|
| `--chrome` | `#FFE500` | **The** accent. The eyebrow tick, the primary CTA, the live pulse. One accent moment per view. |
| `--chrome-deep` | `#E5C900` | Chrome that needs a little more weight |
| `--gold` | `#D9A800` | The accent deepened to hold on white — the light-logo crossbar. Constant in both themes. |

Energy comes from composition, type, and this single accent — never from a gradient.

### Semantic — status, not decoration
| Token | Hex | Role |
|---|---|---|
| `--green` / `--green-ink` | `#1F9D58` / `#177A44` | Win, live, positive |
| `--red` / `--red-ink` | `#C63A32` / `#B5342D` | Loss, danger, destructive |
| `--amber-ink` | `#8A6D00` | Warning / needs attention |

**The fill-vs-ink rule.** `--red` / `--green` are **fills** — light text sits on them, so they stay
dark in both themes. The `--*-ink` values are the **text/mark** colors and flip per theme. Never use
a fill token as a foreground; it cannot clear 4.5:1 on both a light and a dark surface at once.

**Contrast floor is WCAG AA** — 4.5:1 for body text, 3:1 for large text — in both themes. Not
aspirational; enforced.

---

## 4. Typography

Three faces, each with a job. Loaded from Google Fonts with `display: swap` and system fallbacks.

- **Archivo** — *display / headings.* Weights 400–900. Tight tracking (`-.02em`), balanced wrapping,
  line-height `1.05`. Confident and broadcast-like. This is the voice of a headline.
- **IBM Plex Sans** — *body.* Weights 400 / 500 / 600. Generous line-height (~1.6). Clean, legible,
  never the whole system on its own.
- **IBM Plex Mono** — *data & labels.* Weights 400 / 500 / 600. Eyebrows, stat readouts, codes,
  timestamps. Everything that is a *number* uses tabular figures (`font-variant-numeric: tabular-nums`)
  so columns line up.

### The scale
| Class | Size | Use |
|---|---|---|
| `.h-page` | `clamp(28–42px)`, 800 | Page title |
| `.h-sec` | `clamp(21–27px)`, 800 | Section heading |
| `.h-card` | `16.5px`, 700 | Card / block title |
| `.lede` | `clamp(15.5–17.5px)`, steel | Standfirst under a title, ≤ 62ch |
| body | ~15px | Running text |
| `.small` | `13px` | Dense UI |
| `.caption` | `12px`, steel | Metadata |
| `.eyebrow` | `11px` mono, `.2em`, uppercase, steel | Kicker above a title |

**The eyebrow tick.** `.eyebrow.chr` prefixes the kicker with a small chrome bar (`26×9px`). It is
the site's signature structural device — a broadcast lower-third cue. Use it to open a titled
section; don't scatter it.

---

## 5. Voice & tone

Write from the reader's side of the screen.

- **Plain and specific.** Name things how players say them — *club*, not "franchise entity";
  *the league office*, not "admin backend". Say the concrete thing.
- **Active voice.** A control says exactly what it does ("Register to play", then "Registered").
- **Errors help.** Explain what went wrong and how to fix it — no apologies, no vagueness.
- **Numbers only when real.** Never a decorative stat block. If a figure shows, it is sourced.
- **No hype.** No "Transform your game", no "Why choose us", no interchangeable SaaS filler.

| Don't | Do |
|---|---|
| "Unlock your competitive journey today!" | "Register to play — sign-ups close the Monday before the draft." |
| "An error occurred." | "Couldn't save — your sign-in expired. Sign out and back in, then retry." |
| "96 players and counting 🔥" | "Eight clubs. Rosters fill through the draft." |
| "Admin backend" | "Control Center" · "the league office" |

---

## 6. UI language

Recurring components carry consistent meaning, so a member learns the system once.

- **Buttons.** `.btn-chrome` = the one primary action on a view. `.btn-ink` = a strong secondary.
  `.btn-ghost` = tertiary / low-stakes. One chrome button per view, at most.
- **Chips.** Small, rounded status pills. `.chip-chrome` = highlighted; `.chip-win` (green) /
  `.chip-loss` (red) = outcome; `.chip-warn` (amber) = needs attention. A chip states a fact, it
  isn't a button.
- **Cards.** `--paper` surface, `1.5px --line` border, `--r-m` radius. `.card.raise` lifts on hover
  for things you can open.
- **Icons.** A single thin inline stroke set (`CG.ic`), used sparingly. **No emoji** in headings,
  section titles, or UI chrome.
- **Motion.** Restrained and purposeful — the ticker, a hover lift, one page-load reveal. Never
  decorative. Always honor `prefers-reduced-motion`.

---

## 7. In the wild

- **Discord.** The bot avatar is the primary badge. Automated posts are plain, factual, and never
  ping a whole role for information. Staff rooms and the league office read as the same voice as the
  site. Channel topics say who a room is for.
- **Social / share card (`og.png`).** Dark broadcast ground, the wordmark, one line of context, the
  domain. It carries no game-version number, so it never expires.
- **The one-accent rule, everywhere.** Chrome yellow is a spotlight. If everything is highlighted,
  nothing is. One accent moment per surface.

---

*Maintained alongside the design tokens in `src/live/part1_head.html`. Change a token, update this
file and the /#/brand page in the same commit.*
