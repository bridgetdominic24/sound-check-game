# CLAUDE.md — Sound Check

Sound Check is a multiplayer music industry life simulation game. Solo developer (Bridget), mobile-first, plain-language explanations preferred — low formal coding knowledge, so explain changes simply.

## Architecture

- **Entire game is ONE file**: `index.html` (~30K lines). Vanilla HTML/CSS/JS. No frameworks, no build step.
- **Backend**: Supabase (project `pvxrciebegirmrrrzkor`) — auth, database, storage, edge functions.
- **Deploy**: push to main → Vercel auto-deploys to sound-check-game.vercel.app.
- **AI edge functions** (Claude Haiku): `concept-analysis`, `lyric-generation`, `moderate-content`, `generate-article`, `generate-fandom-reactions`.

## Critical dev rules

1. **Always run `node --check` on the JS** before considering an edit done.
2. **Never bulk-remove console.logs.** They are intentional debugging.
3. **All overlays must use `_insertOverlay()`** — z-index locked at 200000. Never create ad-hoc overlay divs.
4. **All colors/fonts via CSS variables**: `var(--bg) --surf --card --bord --txt --mut --acc --acc-bg --acc-txt --fd --fb --tsp --ti`. NEVER hardcode colors in new UI.
5. Use small precise replacements with generous surrounding context — the file has many near-duplicate blocks.
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
- Song timers, collab timers, and parallel-work slowdown multipliers are locked — do not change without explicit instruction.

## Themes (7 approved — no others)

Editorial (`ed`), Neon Underground (`neon`), Lo-Fi Warmth (`lofi`), Sketchbook (`sk`), Modern (`modern`), Pastel Dream (`pastel`), Glass (`glass`).

- Themes are `.t-{name}` classes on `#phone`, defined near the top of the CSS.
- Theme cached in localStorage key `sc_theme_cache` to prevent flash on load.
- `brutalist` was removed and redirects to `modern`.
- **Cleanup task**: CSS blocks for removed themes (`t-glam`, `t-retro`, `t-modern-dark`, `t-brutality`, `t-archive`, `t-bubbly`) may still exist — safe to delete when instructed.
- **Goal**: each approved theme gets full per-theme component styling + micro-animations, not just palette swaps.

### Glass theme spec
- Background: real photo (grass + sky) stored in Supabase Storage, referenced by URL.
- Photo blurred via `body::before` pseudo-element: `filter: blur(3px); transform: scale(1.04)` — scale prevents blur edge bleed.
- All panels: `backdrop-filter: blur(14px)` on `rgba(255,255,255,0.22)` backgrounds.
- Glossy highlight on every card: `::after` with `linear-gradient(180deg, rgba(255,255,255,.4), transparent)`.
- Text: dark navy (`#0d1a2a`). Accent: forest green (`#2d8a4e`).
- Blueprint: `docs/glass_theme_light.html`.

## Feature flags (staged release system)

All Wave 2+ features ship in the file from day one but stay hidden behind flags. Flipping a flag in Supabase makes it live instantly for all players — no redeployment, no App Store resubmission.

**One-time Supabase setup:**
```sql
create table config (key text primary key, value jsonb);
insert into config values ('feature_flags', '{
  "fandoms": false, "radio": false, "distributor": false,
  "merch": false, "multi_saves": false, "tours": false,
  "idol_path": false, "groups": false, "charts_v2": false
}');
```

**Load at startup:**
```javascript
async function loadFeatureFlags() {
  const { data } = await supabase.from('config').select('value').eq('key','feature_flags').single();
  GAME.features = data?.value || {};
}
```

**Wrap every new feature:** `if (GAME.features.fandoms) showFandomsButton();`

## Release wave plan

**Wave 1 — Launch:** Core music career: record/release/stream, all 6 streaming platforms, socials (Pentagram/Rookie/Y), press system, housing (6 regions), jobs, training, basic charts, player profiles. All flags off.

**Wave 2 — Labels + Tours:** Full label experience (both sides), basic tours. Flip: `tours: true`, `charts_v2: true`.

**Between Wave 2–3 — Multi-saves:** Up to 3 save slots per account. UI change only, no flag needed.

**Wave 3 — The Scene:** Fandoms app, radio stations, distributors, merch. Flip: `fandoms: true`, `radio: true`, `distributor: true`.

**Wave 4 — Groups & Idol Path:** Full idol experience, groups, K-idol path, group charts. Flip: `idol_path: true`, `groups: true`.

## Game systems (built & locked)

- Skills (7): Writing, Singing, Production, Stage Presence, Dance, Performance, Negotiation — with decay + XP.
- Promo campaigns (5 types, weekly processing via `processPromoCampaigns()`).
- Collabs (5 types, negotiation up to 3 rounds).
- Social platforms (fictionalized, locked): Pentagram (IG-like), Rookie (TikTok-like), Y (Twitter-like), Yourtube + Notebook (placeholders).
- Streaming economics: Loopify 42%, Orange 25%, Yourtube 15%, iMusic 7%, Sahara 6%, SoundPuff 5%.
- Finances tab (spreadsheet style), industry news (`_pushArticle()`), Artist Hub website builder.
- Energy cap 120/day, stress decay 2/day, album limit 4/game year.
- Housing tiers, ten approved jobs — locked values.
- NPC world simulation runs in single-player ONLY. No NPC artists in multiplayer — only real players.

## Charts system (Wave 2 — flag: charts_v2)

Four chart types. The in-game chart authority is **The Dial** (working name, not locked). Chartwell (the press outlet) *reports on* The Dial — Chartwell is not the chart publisher.

### The Dial 50 — all-format combined
Formula: Streams 45% + Sales 30% + Airplay 25% = score in points (not raw numbers).
Each entry: rank, movement (▲▼ NEW =), 5-bar sparkline, points, weekly delta, status tags (Peak / Climbing / Falling / New).
Tap any entry → slide-up detail with factor breakdown bars + week-by-week history.

### Streams 100
Raw plays across all 6 platforms. Weighted: Loopify 45%, Orange 25%, others 30%. Daily updates.

### Sales 50
Paid downloads, iMusic purchases, album bundles. One purchase = one unit. Completely separate from streams. Gold badge at 500K all-time units, Platinum at 1M.

### Airplay 40
Sources before Wave 3 radio launch:
- Loopify algorithmic playlist add = 50 pts/week
- Orange algorithmic add = 35 pts/week
- Other platform adds = 20 pts/week each
- AirTime article mention = 100 pts one-time
- Promo spend feeds algorithmic discovery → playlist adds → airplay points

Wave 3 adds: radio station spin = 10 pts, paid placement = 25 pts.

### Chartwell Hall of Records
All-time records (most streams single, fastest climb, most weeks at #1), historic firsts, career retrospectives. Year-end Song of the Year at Week 52. Getting a Chartwell Hall feature is prestigious — not a weekly thing.
Blueprint: `docs/charts_v2.html`.

## Current focus: LABEL SYSTEM

Blueprints: `docs/labels_v2_blueprint.html` and `docs/labels_extra_blueprint.html`. Existing partial label code in index.html (~lines 12600–14200) is being extended/replaced.

Build order:
1. Founding flow upgrade (eligibility, startup fees, balance check)
2. Release approvals (label approves signed artists' releases)
3. Advance recoupment + perks with progress
4. Staff hiring (PR, Legal, A&R, Social Media Manager, Marketing Director — tier-locked)
5. Scouting screen with artist archetypes
6. Exit/negotiation flow, bidding wars, label tours, activity feed

Stub functions to replace: `showLabelLoans()`, `showLabelShowcase()`, `showLabelOwnerSettings()` (currently "Coming Soon" alerts).

## Press system — 5 outlets (LOCKED, never add or remove)

**VELOUR** — Voice: elegant, measured, prestige print magazine. Congratulatory only — never writes negatively.
Covers: profiles, cover stories, label showcases, Velour Spotlight (label-exclusive).
Auto-triggers: first #1, 50K fans, major label signing, Penthouse move-in (if signed/owner), label Spotlight submission, Year-End showcase.
Effect: Hype +8, Fans +3–5%, Label rep +0.5. Unsigned artists CANNOT receive Velour Spotlight — gate check required.

**ROOM SERVICE** — Voice: cheeky tabloid. Gossipy, dramatic, ellipses and air quotes. Speculative but never cruel.
Covers: rumors, morale speculation, artist drama, label tension.
Auto-triggers: stress ≥ 85, morale < 20, missed rent 2+ weeks, "Lean in" response, label owner press request.
Player response options: Deny (70% dies, 30% amplifies) / Ignore (80% quiet, 20% follow-up) / Lean in (hype +6, stress +4, runs full course).
When a signed artist is targeted: insert notification to artist (type='press_mention') AND label owner (type='press_request') after article insert.

**CHARTWELL** — Voice: dry, data-forward trade publication. Factual.
Covers: chart entries/movements, streaming milestones, label rankings, The Dial weekly round-up, Year-End rankings, Hall of Records.
Auto-triggers: chart entry, #1, 1M/5M/10M streams, label tier upgrade, Week 52.
Effect: rep +0.1–0.3. Also publishes all-time records in Hall of Records — separate from weekly coverage.

**UNDERTONE** — Voice: warm indie blog. Enthusiastic, discovers artists early.
Covers: debuts, new-artist profiles, collab spotlights, genre movement, unsigned discovery.
Auto-triggers: first release, first collab, first chart entry, 1K fans.
Effect: Hype +4, Fans +1–2%. Won't cover artists with 100K+ fans.

**AIRTIME** — Voice: bright radio-DJ energy. Talks about momentum and heavy rotation.
Covers: streaming milestones, chart momentum, mainstream crossover, playlist coverage. Radio rankings once radio is built (Wave 3).
Auto-triggers: 500K streams/week, top 10 for 3+ weeks, label signing, 25K fans.
Effect: Hype +5. Flavor only until radio stations built.

### Shared press rules
- All articles generated via `generate-article` edge function. Each outlet has its own system prompt.
- Articles insert into `articles` table with outlet, type, artist_id, effect fields. Effects applied on insert.
- Global articles (Year-End, Hall of Records) visible to all players. Artist-specific visible to artist + their label only.
- Weekly server-wide cap: 10 generated articles (rumors count). Past cap → no-op.

### Rumor hard limits (NON-NEGOTIABLE — never loosen)
- Seeded ONLY from real in-game player events. Never invented.
- Always PG. Never involve real money, partners, family, health, cruelty.
- Stat effects capped at ±2%.
- Expire after 3 game weeks unless fed by player response.
- Stored with `type='rumor'`, `is_rumor=TRUE`, `expires_week = current_week + 3`.

## AI rate limiting

Every edge function that calls the AI checks usage first.

```sql
create table ai_usage (
  player_id text, date date,
  articles_generated int default 0,
  fandom_posts_generated int default 0,
  primary key (player_id, date)
);
```

Check before every AI call, upsert after. Daily caps: **5 articles/player, 10 fandom posts/player**. Rows auto-expire by date.

## Fandoms app (Wave 3 — flag: fandoms)

Separate in-game platform. Bot-generated fan community seeded from real game events.

### Edge function: `generate-fandom-reactions`
Fires on `post_create` Supabase trigger. Calls Claude Haiku → generates 3–5 realistic fan posts → inserts into `fandom_posts` table with artist_id, trigger_post_id, generated fan name/handle, content, post_type, created_at.

Trigger → reaction type:
- Outfit/concept post → fashion commentary + era speculation
- New song release → hype + stream goal post
- Chart entry → celebration + milestone tracker
- Chart #1 → celebration avalanche + rival fan visit
- Room Service rumor → defense posts + drama threads
- Collab announcement → wishlist + excitement
- Tour booking → setlist speculation

### Post types in fandom feed
Naming vote (live tallies), stream goal tracker (progress bar), artist reply (player responds — purple inset card), era analysis thread, song ranking poll (visual bars), fan art with attachment, birthday event from mods, beef post from rival fan, collab wishlist, rumor defense, label appreciation, fashion/aesthetic era thread, setlist speculation, "what song made you a fan" weekly prompt, fan project call, discography ranking mega-thread.

### Fandom naming milestone
Before 25K fans: bot fans speculate and vote (displayed as "name pending…"). At 25K: player names it officially or lets fans vote.

Blueprint: `docs/fandom_v2.html`.

## Release flow redesign

Three screens replacing the current release flow. Reference: `docs/release_flow.html` — study before coding.

**Screen 1 — Cover Art:**
Remove the emoji grid entirely. Default cover is a CSS vinyl disc graphic (conic-gradient rainbow disc, silver centre, hole) on a gradient using `--acc-bg` and `--bg`. Five colour theme chips change the default gradient. Upload is single-file only (`multiple` NOT set). On upload: image fills the cover square, upload zone hidden, small "Replace" button appears overlaid.

**Screen 2 — Release Concept (optional):**
Player uploads up to 3 concept photos. One `<input type="file" accept="image/*" multiple>` — if >3 selected, take first 3 and toast "Only the first 3 photos were used." Each filled slot shows a real thumbnail preview. Label as "Fan reactions · preview" — do NOT use the word "AI" or robot emoji anywhere on this screen. Use 🎨 palette emoji. Both skip options go to Screen 3.

**Screen 3 — Review & Release:**
Blurred cover art hero (~260px tall, `filter: blur(20px)`, `transform: scale(1.08)` to prevent edge bleed, gradient fade into `--bg`). Cover square centred on hero. Song title in Georgia serif. Release type + track count in small uppercase. Concept status banner (green if added, muted if skipped). Track list with quality score. Tappable release timing card that expands a Mon–Sun day-picker. Buttons: "🚀 Release Now" (primary) and "📅 Schedule Release" (outlined).

All colours via CSS variables — flow adapts to active theme automatically. Use `_insertOverlay()`, z-index: 200000. Do not touch underlying release logic.

## Game Hub (standalone arcade — Wave 1)

Separate section. Games are self-contained, not embedded in career actions. Players earn coins.
Blueprint: `docs/game_hub.html`.

### Coin economy
- Coins are **entirely in-game currency**. Never represent real money.
- Suggested conversion: **10 coins = $1,000 in-game** (TBD).
- Tipping: players send coins to other artists → converts to in-game cash.
- **Coins buy**: Lyric Snap boost slot (feature your song in daily rotation), game hub tournament entry, minor profile decoration (temporary badges — NOT themes or major cosmetics).
- **Coins do NOT buy**: themes, profile borders, avatar frames, premium backgrounds — those are real money only.

### Games
**Rhythm Rush** — 3-lane note tapper, score attack, combo multiplier. Requires audio file in Supabase Storage to function properly — do not build without audio. Up to 120 coins/game.

**Lyric Snap — Player Lyrics Daily Drop:** Each real-life day at a set time, pulls 10 player songs from the database, blanks one word per lyric, players guess. Correct = coins for guesser + small hype bump for the featured artist. Artists spend coins to boost their song into the daily rotation.
*Real artist mode: NOT BEING BUILT. Copyrighted lyrics require a license.*

**Rap Beef** — card-based bar battle vs bot. 4 cards per hand (Fire/Slick/Shade/Truth, each with atk/def stats). HP bars. Win = 100 coins.

**DJ Spin** — two spinning platters, tap STOP to land needle in groove zone. Both must land for full points. 8 rounds. Up to 80 coins/game.

**Word Mix** — 7 letters in a circle, tap to build words. Required word slots at top. Bonus words earn extra. 3-minute timer. Pangram (7-letter, all letters used) = 100 coins. Daily challenge pangram = 500 coins (one per player per day). All puzzles themed around music industry vocabulary.
Blueprint: `docs/word_mix.html`.

## Label decision screens (per docs/label_decisions_blueprint.html)

**PRESS STATEMENT:** Triggered from Daily Inbox. Editor with tone chips (Professional/Warm/Firm/Dismissive), preset openers, editable headline + body, article preview in paper/cream style. Draft pre-fills via generate-article edge function (trigger='label_statement', outlet='label_official'). Inserts as type='statement', verified:true. Effect: rep ±1, rumor expiry chance boost.

**SONG REVIEW:** Shows song cover + quality score bar (writing/production/vocals/concept/studio bonus), featured artist card, projections, week selector. Approve (morale +12) / Schedule (morale +4) / Send Back (morale −10) / Shelve (morale −5, resubmittable).

**COLLAB COMPARE:** Side-by-side artist cards, compatibility score (genre overlap + fan overlap + chart form + workload + history + morale), active collab warning, last 3 songs each, proposed song info. Approve (roster_bonus:true, +15% first-week streams, morale +5 each) / Block (morale −6 each) / Suggest Different (nominates two other roster artists).

## Label tier requirements (LOCKED)

- Indie → Mid-Indie: 500K total roster streams + min 3 artists.
- Mid-Indie → Major Boutique: 5M total roster streams + min 5 artists.
- Major Boutique → Global Major: 50M total roster streams + min 10 artists.
- Auto-upgrades, Activity Feed notification. Velour quotas: Indie=1/mo, Mid=2/mo, Boutique=3/mo, Global=5/mo + Label Showcase unlock.

## Label Life systems (per docs/label_life_blueprint.html)

**Artist Morale** — 0–100, recalculated each game day.
Factors: release approved (+12), rejected (−15), promo spent (+8), advance recouped (+10), advance high (−6), label contact (+6), no contact 3+ weeks (−8), roster collab this month (+5), no collab 4+ weeks (−4), studio time given (+7), auto-approve on (+3/day).
Below 40: moody social post. Below 20: Room Service rumor + exit request. At 0: formal release request.
Owner actions: Send Gift (−$800, +8 morale), Give Studio Time (quality bonus), Check In (+6), Spotlight, Auto-Approve toggle.

**Daily Inbox** — max 5 decisions/game day: release approvals, advance requests, scout applications, roster collab requests, press comment requests. All logged in activity feed.

**Label Studio** — Home (free) → Project ($20K) → Pro ($80K) → Elite ($250K). Equipment categories: Recording, Production, Mixing, Mastering, Vibe. Session slots: 1/2/3/4. Morale +3 per roster artist on tier upgrade.

**Roster Collabs** — +15% first-week streams (roster_bonus:true), +5 morale each on approval, −6 each if blocked.

**Velour Spotlight (label-exclusive)** — Gate check: must have signedLabel isOwner OR be signed. Requirements: Established+ tier, 50K+ fans, chart entry in last 8 weeks, rep 4.0+. One submission per label per month. On acceptance: hype +8, fans +3–5%, label rep +0.5. Rejection includes specific feedback.

**Year-End Label Rankings** — Week 52, auto. Scoring: chart entries (weighted by peak) + combined roster streams + label rep + fan growth. Fires: Chartwell ranked article, Velour "Labels to Watch" top 3, "Year in Review" tab for 4 game weeks, 🏆 badge for #1 label.

## Housing (LOCKED values)

Energy per tier: [−10, −5, 0, +2, +5].
Creativity per tier: [−10, −8, −5, −2, 0].
Regional multipliers: NA×1.0, Europe×1.4, Africa×0.45, Asia×0.9, SA×0.6, Oceania×1.15.
Penthouse Velour trigger: if signedLabel or ownedLabel exists on move-in, fire `_pushArticle` with `GAME.penthouseVelourFired` guard flag.

## Planned later (do not build unless asked)

- K-pop Trainee/Idol path (dice-roll stat creation, birth names only, training + evaluations, comeback cycles, group system).
- Radio stations: players create stations, choose rotations, compete on listeners, sell NPC ad slots.
- Festivals: lineup invites, hype payoffs, slot competition.
- Distributor system: signed via labe
