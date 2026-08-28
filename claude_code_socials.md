# Claude Code Prompt — Social Platforms Redesign

## Overview
Rebuild the create post / social post system across Pentagram, Rookie, and Y. Each platform has its own create screen and feed. The key new element across all platforms is a **Post Type selector** that determines what game systems fire after posting.

---

## General rules
- All UI chrome uses SVG icons — no emoji in nav bars, action buttons, or headers
- Emoji are only used in: post type chip labels, story/post content (placeholder art), artist avatars
- All colours via CSS variables so theme adapts automatically
- Use `_insertOverlay()` with z-index: 200000

---

## Post Type system (all platforms)

Post types split into two buckets shown in the create screen:

**Career types** (trigger game systems on post):
- 🎨 Concept Photos → `generate-fandom-reactions` edge function fires with photo/caption; era speculation + fashion posts seed in fandom; Hype +3
- 🎵 New Music → fandom hype posts fire; stream goal thread seeds; AirTime may cover; Hype +5
- 📣 Announcement → fandom discussion thread starts; press outlets may cover; Hype +4
- 🎬 BTS → fan aesthetic posts seed; fan appreciation posts; Hype +2
- 💅 New Look → fashion commentary floods fandom; era speculation threads; Hype +2
- 🤝 Collab Tease → collab wishlist posts in both fandoms; Hype +3

**Personal types** (no game mechanics, fan comments only):
- 🔥 Hyped / 💭 Reflective / 😂 Funny / 📷 Throwback / 💬 Real Talk

When a Career type is selected, show a "Game effects on post" preview card listing what will fire. When Personal type selected, hide the card.

Save `post_type` to the `posts` Supabase table. On Career post submit, call `generate-fandom-reactions` edge function with `{ post_id, post_type, caption, artist_id, photo_urls[] }`.

---

## PENTAGRAM (Instagram-style)

### Feed
- White/light background (#FAFAFA), black text, Instagram blue (#0095F6)
- Story rings use the Instagram gradient: `linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)`
- Stories are tappable — full-screen overlay with segmented progress bar (4 seconds per slide), auto-advance, tap left to go back, tap right to go forward, reply field at bottom
- Posts support carousels (up to 10 slides) — dot indicators at bottom, slide counter top-right (e.g. "1/3"), tap right side of image to advance

### Music in post header (IMPORTANT — matches real Instagram)
Music appears in the **post header**, below the username, NOT as a sticker on the image.
Format: small spinning music note SVG icon + "[song name] • [artist]" (truncated to fit)

```html
<!-- Post header structure -->
<div class="post-head">
  <div class="avatar">...</div>
  <div class="info">
    <b>username ✓</b>
    <!-- Music line — shown when song is tagged -->
    <div class="music-line">
      <svg><!-- spinning music note --></svg>
      Song Name • Artist Name
    </div>
  </div>
  <button><!-- three dots --></button>
</div>
```

CSS for music line:
```css
.music-line {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  color: #262626;
  margin-top: 2px;
  max-width: 220px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.music-line svg { animation: spin 3s linear infinite; flex-shrink: 0; }
```

### Create post screen
- Media zone: tap to add up to 10 photos/GIFs, multi-select from gallery
- Caption textarea with @mention support
- Post Type selector (Career / Personal buckets with game effect preview)
- "Add Music" meta row → opens music picker sheet
  - Music picker shows: "Your Songs" (from player's catalog), "Trending in Game" (top charting songs)
  - Selecting a song shows a header preview card: "Preview — how it will appear on post" showing the post header with the spinning music note line
  - Selected music info stored in post object as `{ song_id, song_name, artist_name }`
- Tag People meta row
- Location meta row
- Add GIF meta row

### Actions (SVG icons only)
Heart (like), speech bubble (comment), paper plane (share), bookmark (save)

---

## ROOKIE (TikTok-style)

### Feed
- Pure black (#000), TikTok red (#FE2C55), teal (#25F4EE)
- Full-screen card with gradient overlay, right-side action buttons, bottom artist/caption info
- Spinning disc for sound indicator at bottom

### Create post screen (SIMPLIFIED — no tabs)
- Preview area (photo/video placeholder) with format options: Photo / Video / Concept
- Description textarea with @mention support
- **Sound** section — NOT a plain text input. Shows a tappable row with a spinning disc icon displaying the selected sound (or "Add a sound"). Tapping opens the sounds picker sheet:
  - Sheet shows: "Your Songs" + "Trending in Game" (same data as Pentagram music picker)
  - Selecting a sound updates the picker row
- Post Type chips with game effect preview (same system as Pentagram, adapted for dark background)
- "Allow comments" toggle
- "Followers only" toggle

### Actions (SVG icons, white on black)
Heart, speech bubble, share/upload arrow

---

## Y (Twitter/X-style)

### Feed
- Pure black (#000), X border (#2F3336), light text (#E7E9EA), blue (#1D9BF0)
- Tweets show vibe badge (post type pill) when Career type was selected
- @mentions in tweet text shown in blue

### Reposts (must work)
- Repost icon (two rotating arrows SVG)
- Tapping toggles repost state: icon turns green (#00BA7C), count increments by 1
- Tapping again un-reposts: icon goes back to grey, count decrements
- State tracked per tweet independently

### Replies
- Tapping reply icon opens a reply sheet from the bottom
- Reply sheet shows: "Replying to @handle", first 50 chars of original tweet, compose textarea, image attach icon, post button

### Compose screen
- Character counter ring (SVG circle, drains as user types, turns yellow <50 chars, red <20)
- Up to 4 concept image slots (tap image icon to add, × to remove each)
- Post Type chips with game effect preview
- Action bar: image icon, GIF icon, poll icon, location icon
- **Music note icon is present but GREYED OUT and disabled** — song tagging not available on Y. Show a tooltip "Not available on Y" on tap.

### NO song/music picker on Y — only on Pentagram and Rookie.

---

## Shared data model

```javascript
// Post object sent to Supabase
{
  platform: 'pentagram' | 'rookie' | 'y',
  player_id: GAME.playerId,
  caption: string,
  post_type: 'concept' | 'music' | 'announce' | 'bts' | 'look' | 'collab' | 'hyped' | 'reflective' | 'funny' | 'throwback' | 'realtalk',
  is_career_post: boolean,
  media_urls: string[],          // Supabase Storage URLs
  tagged_song_id: string | null, // null if no song tagged
  tagged_song_name: string | null,
  location: string | null,
  tagged_players: string[],      // player_ids
  created_at: timestamp
}
```

After insert, if `is_career_post === true`, call `generate-fandom-reactions` edge function with the post data. Apply hype stat change from the post type immediately.
