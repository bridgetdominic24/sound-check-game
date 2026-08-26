# CLAUDE.md — Sound Check

Sound Check is a multiplayer music industry life simulation game. Solo developer (Bridget), mobile-first, plain-language explanations preferred — low formal coding knowledge, so explain changes simply.

## Architecture

- **Entire game is ONE file**: `index.html` (~30K lines). Vanilla HTML/CSS/JS. No frameworks, no build step.
- **Backend**: Supabase (project `pvxrciebegirmrrrzkor`) — auth, database, storage, edge functions.
- **Deploy**: push to main → Vercel auto-deploys to sound-check-game.vercel.app.
- **AI edge functions** (Claude Haiku): `concept-analysis`, `lyric-generation`, `moderate-content`.

## Critical dev rules

1. **Always run `node --check` on the JS** before considering an edit done (extract script or check syntax carefully — one syntax error kills the whole game).
2. **Never bulk-remove console.logs.** They are intentional debugging.
3. **All overlays must use `_insertOverlay()`** — z-index locked at 200000. Never create ad-hoc overlay divs.
4. **All colors/fonts via CSS variables**: `var(--bg) --surf --card --bord --txt --mut --acc --acc-bg --acc-txt --fd --fb --tsp --ti`. NEVER hardcode colors in new UI.
5. When editing, use small precise replacements with generous surrounding context — the file has many near-duplicate blocks.
6. Prefer small, testable changes. One feature per branch/PR.

## Supabase gotchas

- `players` table has **NO `updated_at` column** — never write to it.
- Use `select('*')`, not named column lists.
- `collab_requests` table is live with RLS.
- Storage buckets: `artist-photos`, `merch-mockups` (merch uses fetch→blob→createObjectURL for CORS).

## Timer architecture (LOCKED — do not redesign)

- `global_timer.current_day` in Supabase is the single source of truth.
- `DAY_MS` = 2 real hours per game day.
- `_dayAdvancing` flag is set synchronously BEFORE any await (prevents re-entry corruption).
- `gameWeekToDate`: Week 1 Day 1 = Jan 1, 2017.
- Song timers, collab timers, and parallel-work slowdown multipliers are locked values — do not change without explicit instruction.

## Themes (6 approved — no others)

Editorial (`ed`), Neon Underground (`neon`), Lo-Fi Warmth (`lofi`), Sketchbook (`sk`), Modern (`modern`), Pastel Dream (`pastel`).

- Themes are `.t-{name}` classes on `#phone`, defined near the top of the CSS.
- Theme cached in localStorage key `sc_theme_cache` to prevent flash on load.
- `brutalist` was removed and redirects to `modern`.
- **Cleanup task**: CSS blocks for removed themes (`t-glam`, `t-retro`, `t-modern-dark`, `t-brutality`, `t-archive`, `t-bubbly`) may still exist in the file — safe to delete when instructed.
- **Goal**: each approved theme gets full per-theme component styling + micro-animations (buttons, cards, hover/press states), not just palette swaps.

## Game systems (built & locked)

- Skills (7): Writing, Singing, Production, Stage Presence, Dance, Performance, Negotiation — with decay + XP.
- Promo campaigns (5 types, weekly processing via `processPromoCampaigns()`).
- Collabs (5 types, negotiation up to 3 rounds).
- Social platforms (fictionalized, locked): Pentagram (IG-like), Rookie (TikTok-like), Y (Twitter-like), Yourtube + Notebook (placeholders).
- Streaming economics: Loopify 42%, Orange 25%, Yourtube 15%, iMusic 7%, Sahara 6%, SoundPuff 5%.
- Finances tab (spreadsheet style), industry news (`_pushArticle()`), Artist Hub website builder.
- Energy cap 120/day, stress decay 2/day, album limit 4/game year.
- Housing tiers, ten approved jobs — locked values.
- NPC world simulation runs in single-player ONLY. **No NPC artists in multiplayer** — only real players (staff NPCs for scouting/legal are fine).

## Current focus: LABEL SYSTEM

Blueprints live in `docs/labels_v2_blueprint.html` and `docs/labels_extra_blueprint.html`. **Implement to match those designs.** Existing partial label code in index.html (~lines 12600–14200) is being extended/replaced.

Build order:
1. Founding flow upgrade (eligibility, startup fees, balance check)
2. Release approvals (label approves signed artists' releases)
3. Advance recoupment + perks with progress
4. Staff hiring (PR, Legal, A&R, Social Media Manager, Marketing Director — tier-locked)
5. Scouting screen with artist archetypes
6. Exit/negotiation flow, bidding wars, label tours, activity feed

Stub functions to replace: `showLabelLoans()`, `showLabelShowcase()`, `showLabelOwnerSettings()` (currently "Coming Soon" alerts).

## Press article & rumor system

- Edge function `generate-article` (Deno/TypeScript) generates AI press articles in outlet voice, runs them through `moderate-content`, inserts with service role key.
- Outlets: Velour (prestige), Room Service (gossip), Chartwell (business/charts), Undertone (discovery), AirTime (mainstream pop).
- Articles are in `industry_articles` table. Clients SELECT only (RLS). Service role inserts.
- `trigger_key` unique index prevents duplicate articles.
- **Rumor hard boundaries (NON-NEGOTIABLE — do not loosen)**:
  - Rumors seed ONLY from real in-game actions (collab accepted, spending event, same-week releases, declined collabs). Never invent from nothing.
  - Never involve real money, romantic partners/cheating, family, health, or anything cruel or targeting a real person.
  - Stat effects are ±1–2% range only (e.g. ±hype/fans, never income or skill).
  - Stored with `type='rumor'`, `target_player_id`, `is_rumor=TRUE`, `expires_week = current_week + 3`.
  - Expired rumors stop showing effects immediately (check `expires_week > GAME.week`).
- **Rumor response mechanic**: targeted player gets a notification, one choice allowed:
  - Deny → 70% expires immediately, 30% one follow-up + effect doubles then expires.
  - Ignore → 80% quiet expiry, 20% one follow-up article.
  - Lean in → +hype now, +stress, rumor runs full course.
  - Choice logged in `response` column on the article row.
- Weekly server-wide cap: 10 generated articles (rumors count toward cap). Past cap, triggers no-op.

## Planned later (do not build unless asked)

K-pop Trainee/Idol path (dice-roll stat creation, birth names only for trainees, training + evaluations, comeback cycles), Fandoms app (bot-generated fan community), Visual stat, three-tier charts, band/groups system, monetization (speed tokens, theme shop), year-end taxes.

## Testing

- Test account: `iriswaeris@gmail.com`, player Bootswidafur.
- Admin reset password: `soundcheck_reset_2024`.
- After merge, Vercel auto-deploys — test on mobile.

- ## Label decision screens (all per docs/label_decisions_blueprint.html)

PRESS STATEMENT:
- Triggered from Daily Inbox "Room Service press request" or any label news event
- Opens editor with: label logo/name header, 4 tone chips (Professional/Warm/Firm/Dismissive), 4 preset openers, editable headline + body textarea, article preview rendering in paper/cream style
- AI draft pre-fills on open (call generate-article edge function with trigger='label_statement', outlet='label_official') — player edits from there
- Publish inserts into articles table as type='statement', outlet='[Label Name] Official', with verified:true flag; RLS allows label owners to insert their own statements
- Effect: rep modifier ±1 depending on tone, rumor expire chance boost

SONG REVIEW (approval queue):
- Shows: song cover gradient + title/artist/genre, quality score bar with breakdown (writing/production/vocals/concept/studio bonus), featured artist card (their fans + roster bonus if applicable), projections grid, week selector, 4 action buttons
- Approve: sets pendingReleases[i].status='approved', triggers processRelease, morale +12
- Schedule: sets status='scheduled', stores chosen week, morale +4
- Send Back: sets status='returned', stores note, morale -10
- Shelve: sets status='shelved', stores to label.shelvedTracks[], morale -5 (can resubmit)

COLLAB COMPARE (collab approval):
- Shows: side-by-side artist cards, compatibility score (genre match + fan overlap + chart form + workload + history + morale), active collab warning if either has concurrent, last 3 songs each with streams, proposed song info, roster bonus call-out
- Approve: fires existing collab flow with roster_bonus:true flag → +15% first week streams, morale +5 each
- Block: morale -6 each, logged in activity feed
- Suggest Different: owner nominates two other roster artists, both get notification

LABEL TIER REQUIREMENTS (for tutorial):
- Indie → Mid-Indie: 500K total roster streams + min 3 artists (auto-upgrades, appears in Activity Feed)
- Mid-Indie → Major Boutique: 5M total roster streams + min 5 artists
- Major Boutique → Global Major: 50M total roster streams + min 10 artists
- Tier perks per upgrade: bigger advance range, more staff slots, higher Velour submission quota (Indie=1/mo, Mid=2/mo, Boutique=3/mo, Global=5/mo + Label Showcase unlock)
