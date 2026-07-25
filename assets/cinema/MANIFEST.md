# Cinematic asset library — generated 2026-07-22 / 2026-07-25 (Higgsfield)

Status: the 2026-07-22 homepage set is **generated and preserved,
currently unwired** (the commissioner chose UI motion over photographic
environments there). The 2026-07-25 additions below **are wired** — they
carry the player-profile redesign (hero backdrop, empty-state, pickup box
score).

## Wired — player profile (added 2026-07-25, Higgsfield soul_location)
| File | Where it's used | Prompt intent |
|---|---|---|
| profile-hero-21x9.jpg | Player-profile hero band backdrop (heavy charcoal scrim over it) | Rink-level dark arena, cool light sweep lower-left, one warm amber accent on the boards, deep negative space |
| fresh-ice-16x9.jpg | Player-profile "no games yet" empty state ("Fresh sheet / Yet to take a shift") | Pristine untouched sheet of ice under cool light, dark top for the headline — a blank slate |
| ice-macro-21x9.jpg *(reused)* | Pickup box-score page (`#/pickup/:id`) hero backdrop | (existing) close-up dark rink ice with skate marks |

## Homepage set (2026-07-22, unwired)

All stills: Higgsfield `soul_location` (text-only prompts, no reference
media, no people, no third-party marks). Video: Bytedance `seedance1_5`
image-to-video from hero-arena-21x9. Generated under the league's own
Higgsfield account; outputs are original synthetic media.

| File | Purpose (intended) | Size | Alt text |
|---|---|---|---|
| hero-arena-21x9.jpg | Homepage hero environment, desktop; poster for the loop | 198K | Empty dark hockey arena at rink level under cool broadcast lights |
| hero-arena-loop.mp4 | 8s muted ambient hero loop (1080p 21:9), poster = the jpg | see file | Slow drift across an empty dark hockey arena |
| hero-mobile-3x4.jpg | Homepage hero, portrait crop for phones | 104K | Empty dark hockey arena, vertical composition |
| tunnel-16x9.jpg | Dark panel background (dashboard stage) | 93K | Arena service tunnel opening onto bright ice |
| ice-macro-21x9.jpg | Section/panel texture | 149K | Close-up of dark rink ice with skate marks and light reflections |
| trophy-16x9.jpg | Awards page hero environment | 76K | Single spotlight beam on an empty presentation stage |
| draft-16x9.jpg | Draft-night environment | 143K | Dark broadcast stage with sweeping colored spotlights |
| playoff-16x9.jpg | Playoff atmosphere band | 148K | Rink-level haze and light beams with faint red goal-light glow |
| lights-21x9.jpg | Records/news band | 112K | Arena roof lights cutting beams through haze, from below |

Job ids: 8897f8c9 (hero), e7ca4757 (tunnel), 82a74d88 (ice), 03b00dea
(trophy), af0308b5 (draft), 0b1ce43d (playoff), 53a8ebbf (mobile),
afcdcd90 (lights), 0493dee2 (loop video).

## Still to generate (prompt library, when wanted)
- 3D Chel Gaming puck turntable (glTF or video loop) — needs the real
  mark as reference media
- Frost/ice-particle transition overlays (transparent WebM)
- Goal-light score transition sweep
- Per-club environment tints (8 variants of the hero graded toward each
  club color)
