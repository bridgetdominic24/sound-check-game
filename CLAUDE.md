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
- 
Five outlets (locked names — never change):
Velour — prestige features, cover stories, long-form artist profiles. Elegant prose.
Room Service — gossip, rumors, concern pieces. Cheeky tabloid voice.
Chartwell — charts, business, data. Dry trade publication voice.
Undertone — new music discovery, unsigned scene, collab culture. Warm indie voice.
AirTime — mainstream radio flavor, heavy rotation coverage. Bright upbeat voice. No real radio system exists yet — AirTime covers big streaming weeks in radio-DJ voice (pure flavor until radio stations are built).
Press rumor rules (HARD LIMITS — never violate):
Rumors seeded ONLY by real in-game player events, never invented
Always PG, never involve real money / partners / family / health / cruelty
Stat effects capped at ±2% per rumor
Rumors expire after 3 game weeks unless fed by player response
Player response options: Deny (70% dies, 30% amplifies) / Ignore (80% quiet, 20% follow-up) / Lean in (+hype, +stress, runs full course)
Room Service → label notification chain:
When a rumor targets a signed artist, edge function inserts TWO notifications after article insert:
Artist: type='press_mention', "Room Service wrote about you"
Label owner: type='press_request', "Room Service is asking about [artist] — issue a statement?"
Both reference the same article_id. No new tables needed.
Press statement (label-owner feature):
Label owner can publish official statements from Daily Inbox press requests
Editor: tone chips (Professional/Warm/Firm/Dismissive), preset openers, editable headline + body
AI pre-drafts via generate-article edge function with trigger='label_statement', outlet='label_official'
Inserts into articles table as type='statement', outlet='[Label Name] Official', verified:true
Effect: rep modifier ±1, rumor expiry chance boost
Label Life systems (all per docs/label_life_blueprint.html)
Artist Morale
Score 0–100 per signed artist, recalculated each game day
Factors: release approved (+12), rejected (−15), promo spent on them (+8), advance recouped (+10), advance high (−6), label contact (+6), no contact 3+ weeks (−8), roster collab this month (+5), no collab 4+ weeks (−4), studio time given (+7), auto-approve on (+3/day)
Below 40: occasional moody social post
Below 20: Room Service rumor fires + exit request notification to label owner
At 0: artist formally requests release (owner can deny, artist goes silent)
Owner actions: Send Gift (−$800 label funds, +8 morale), Give Studio Time (allocates session slot, next recording gets quality bonus), Check In (+6 morale, may surface contract concerns), Spotlight (featured on label page), Auto-Approve toggle
Daily Inbox
Surfaces pending decisions each game day, max 5 per day
Types: release approvals, advance requests, scout applications, roster collab requests, press comment requests
Each shows full context (song info, money amounts, artist stats) before decision
All decisions logged in label activity feed with timestamp
Label Studio
Tiers: Home (free, minimal bonus) → Project ($20K) → Pro ($80K) → Elite ($250K)
Equipment catalog (categories: Recording, Production, Mixing, Mastering, Vibe)
Equipment purchases persist in label data, apply quality bonus to all roster recordings that week
Session slots: Home=1, Project=2, Pro=3, Elite=4 per week
Morale bonus: roster artists get +3 morale each when studio tier upgrades
Equipment budget follows label finances (not player funds)
Roster Collabs
Artists on same label get +15% first-week streams bonus (roster_bonus:true flag)
+5 morale each on approval, −6 morale each if blocked
Owner can Approve / Block / Suggest (suggest sends notification to two artists, they decide; morale +3 each from the ask alone)
Collab compare screen shows: side-by-side fan counts/genres, compatibility score (6 factors), active collab warning, last 3 songs each with streams, proposed song info
Velour Spotlight (label-exclusive)
Unsigned artists CANNOT access — gate check: player must have signedLabel with isOwner OR be signed to a label
Requirements: label tier Established+, artist 50K+ fans, chart entry in last 8 weeks, label rep 4.0+
Submission quota by tier: Indie=1/month, Mid-Indie=2/month, Boutique Major=3/month, Global Major=5/month
Global Major unlocks Label Showcase (full label profile article, not just one artist)
AI-generated article on acceptance (Velour voice), triggers hype +8 + fans +3–5% + label rep +0.5
Rejection includes feedback message ("not enough chart presence" / "label too new") so player knows what to fix
One submission per label per month (not per artist)
Year-End Label Rankings
Runs automatically at game Week 52 each game year
Scoring: chart entries (weighted by peak position) + combined roster streams + label rep + artist fan growth
Triggers four things:
Chartwell publishes AI-generated ranked article (visible all players in news feed)
Velour does "Labels to Watch" for top 3 rising indie labels
"Year in Review" tab in news feed for 4 game weeks
#1 label gets permanent 🏆 badge on their public label page
Ties broken by rep score
Song Review screen (per docs/label_decisions_blueprint.html)
Triggered when roster artist submits release for approval
Shows: song cover + title/genre/format, quality score bar (0–100) with breakdown (writing/production/vocals/concept/studio bonus), featured artist card (their fans + roster bonus if applicable), projections (hype/fan growth/proposed week), week selector
Approve: pendingReleases[i].status='approved', triggers processRelease, morale +12
Schedule: status='scheduled', stores chosen week, morale +4
Send Back: status='returned', stores note field, morale −10
Shelve: status='shelved', stored in label.shelvedTracks[], morale −5, can be resubmitted later
Collab Compare screen (per docs/label_decisions_blueprint.html)
Compatibility score: genre overlap + fan audience overlap + chart form + workload + previous collab history + morale (each weighted)
Active collab warning: if either artist has a concurrent active collab, show orange warning (quality split risk)
Approve fires existing collab flow with roster_bonus:true
Block: morale −6 each, logged in activity feed
Suggest Different: owner nominates two other roster artists, both get notification
Label tier requirements (for tutorial — LOCKED values from code)
Indie → Mid-Indie: 500K total roster streams + minimum 3 artists on roster
Mid-Indie → Major (Boutique): 5M total roster streams + minimum 5 artists
Major (Boutique) → Global Major: 50M total roster streams + minimum 10 artists
Upgrades are automatic — fires when thresholds hit, appears in Activity Feed
Perks per tier: bigger advance range, more staff slots, higher Velour submission quota (see above)
Planned builds (do not build unless asked)
Radio stations: players create their own radio stations, choose song rotations, compete on listener rankings, sell NPC ad slots, other players pay for playlist placement; chart position affects ad pricing. AirTime outlet will cover real station rankings once built.
Fandoms app: bot-generated fan community, separates sim-fans from real players, covers artists/groups/labels
K-pop trainee/idol path: dice-roll character creation, birth names only at trainee stage, company-scheduled training grid, monthly evaluations, debut system, comeback cycles
Festivals: lineup invites, hype payoffs, slot competition — needs design session before build
Distributor system: signed artists get distribution via label; indie artists sign NPC distributor (budget/standard/premium tiers); no distributor = SoundPuff only
Band/groups system: post-launch

## Press system — 5 outlets (LOCKED, never add or remove)

### Outlets

VELOUR
- Voice: elegant, measured, editorial. Reads like a prestige print magazine.
- Covers: artist profiles, cover stories, long-form career features, label showcases, debut spotlights, Velour Spotlight (label-exclusive features). Congratulatory in tone — Velour doesn't write negatively.
- Auto-triggers: first chart #1, crossing 50K fans, signing to a major label, Penthouse move-in (if signed/label owner), label-submitted Spotlight, Year-End label showcase for top 3 labels.
- Effect: Hype +8, Fans +3–5%, Label rep +0.5 on feature. Most prestigious article type in the game.
- Unsigned artists CANNOT receive a Velour Spotlight — gate check required.

ROOM SERVICE
- Voice: cheeky tabloid. Gossipy, dramatic, uses ellipses and air quotes. Speculative but never cruel.
- Covers: rumors, morale speculation ("sources say…"), artist drama, label tension, lifestyle observations.
- Auto-triggers: artist stress ≥ 85 (rumor about burnout), artist morale < 20 (exit rumor), missed rent 2+ weeks, Room Service rumor response = "Lean in" (follow-up piece), label owner sends rumor after press request.
- Player response options when targeted: Deny (70% rumor dies, 30% amplifies), Ignore (80% quiet expiry, 20% follow-up), Lean in (hype +6, stress +4, rumor runs full course).
- Rumor rules (HARD — never break): seeded only by real player events, always PG, never mention real money/family/health/cruelty, stat effect capped at ±2%, expires in 3 game weeks unless fed.
- When a signed artist is targeted: edge function inserts notification to artist (type='press_mention') AND label owner (type='press_request') after article insert.

CHARTWELL
- Voice: dry, data-forward trade publication. Factual. Treats music like a business story.
- Covers: chart entries and movements, streaming milestones, label rankings, business deals, The Dial chart weekly round-up, Year-End rankings, Chartwell Hall of Records entries.
- Auto-triggers: any song entering the chart, song hitting #1, song crossing 1M / 5M / 10M streams, label tier upgrade, Year-End label rankings (Week 52), new Hall of Records entry set.
- Effect: no direct hype boost, but increases label and artist credibility (rep +0.1–0.3 depending on milestone size).
- Chartwell also publishes all-time records and career milestones in the Hall of Records section — separate from the weekly chart coverage.

UNDERTONE
- Voice: warm indie music blog. Enthusiastic but thoughtful. Discovers artists before they blow up.
- Covers: debut coverage, new-artist profiles, collab spotlights, genre movement pieces, unsigned artist discovery, "ones to watch" features.
- Auto-triggers: player's very first song release (debut piece), first collab published, song charting for the first time, player reaches 1K fans (discovery piece), unsigned artist with strong SoundPuff presence.
- Effect: Hype +4, Fans +1–2%, small rep boost. More valuable early-career than later.
- Undertone won't cover an artist who already has 100K+ fans — they've moved past Undertone's scope.

AIRTIME
- Voice: bright, upbeat, radio-DJ energy. Enthusiastic. Talks about momentum and heavy rotation.
- Covers: streaming milestone achievements, chart movement framing ("this one's everywhere right now"), mainstream crossover moments, playlist milestone coverage, radio station listener rankings (once radio is built).
- Auto-triggers: song crosses 500K streams in a week, song holds top 10 for 3+ consecutive weeks, label signing announcement, artist reaches 25K fans.
- Effect: Hype +5. Currently flavor only for radio coverage until the radio station system is built. Once radio launches, AirTime covers real station rankings.
- Note: AirTime has no real radio system yet. Its radio-adjacent language is intentional — it sets up the world for when radio stations are built in Wave 3.

### Shared rules (all outlets)
- All articles are AI-generated via the generate-article Supabase edge function
- Each outlet has its own system prompt defining voice, tone, and what it will/won't cover
- Articles insert into the articles table with outlet, type, artist_id, effect fields
- Effects (hype, fans, rep) are applied on insert via database trigger or edge function
- Players see articles in the news feed, sorted by timestamp
- Global articles (Year-End, Hall of Records) are visible to all players
- Artist-specific articles only visible to that artist and their label (if signed)
