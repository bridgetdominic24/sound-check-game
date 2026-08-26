-- Migration: press article generation system (v2)
-- Adds trigger_key dedup column, generated flag, inserted_at timestamp,
-- rumor columns (target_player_id, expires_week, response, is_rumor),
-- and locks down industry_articles RLS so clients cannot insert directly.
--
-- Run this in the Supabase SQL editor for project pvxrciebegirmrrrzkor.

-- ── 1. Add core article-generation columns ────────────────────────────────────

ALTER TABLE public.industry_articles
  ADD COLUMN IF NOT EXISTS trigger_key      TEXT,
  ADD COLUMN IF NOT EXISTS generated        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS inserted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ── 2. Add rumor columns ──────────────────────────────────────────────────────
--  target_player_id  — UUID of the player the rumor is about (nullable for normal articles)
--  expires_week      — in-game week after which this rumor stops having effects
--  response          — the player's chosen response: 'deny' | 'ignore' | 'lean_in' (null = unanswered)
--  is_rumor          — true for rumor rows so they can be filtered separately

ALTER TABLE public.industry_articles
  ADD COLUMN IF NOT EXISTS target_player_id TEXT,
  ADD COLUMN IF NOT EXISTS expires_week     INTEGER,
  ADD COLUMN IF NOT EXISTS response         TEXT,
  ADD COLUMN IF NOT EXISTS is_rumor         BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 3. Unique constraint on trigger_key (NULLs are not considered equal,
--       so hand-crafted articles with trigger_key = NULL can coexist freely)
CREATE UNIQUE INDEX IF NOT EXISTS idx_industry_articles_trigger_key
  ON public.industry_articles (trigger_key)
  WHERE trigger_key IS NOT NULL;

-- ── 4. Index to efficiently query active rumors for a player ─────────────────
CREATE INDEX IF NOT EXISTS idx_industry_articles_rumor_target
  ON public.industry_articles (target_player_id, expires_week)
  WHERE is_rumor = TRUE;

-- ── 5. RLS — clients may SELECT, never INSERT/UPDATE/DELETE
--       The edge function uses the service role key and bypasses RLS entirely.

ALTER TABLE public.industry_articles ENABLE ROW LEVEL SECURITY;

-- Drop any old permissive policies that allowed client writes
DROP POLICY IF EXISTS "allow_all"            ON public.industry_articles;
DROP POLICY IF EXISTS "Allow all operations" ON public.industry_articles;

-- Read-only for authenticated users
CREATE POLICY "articles_select_authenticated"
  ON public.industry_articles
  FOR SELECT
  TO authenticated
  USING (true);

-- Anon users can also read (for leaderboards / public feed)
CREATE POLICY "articles_select_anon"
  ON public.industry_articles
  FOR SELECT
  TO anon
  USING (true);

-- Allow authenticated users to update only the 'response' column on articles
-- that target them (so the rumor-response mechanic can log the player's choice).
-- The edge function still handles all inserts via service role.
CREATE POLICY "articles_update_own_response"
  ON public.industry_articles
  FOR UPDATE
  TO authenticated
  USING  (target_player_id = auth.uid()::text AND is_rumor = TRUE)
  WITH CHECK (target_player_id = auth.uid()::text AND is_rumor = TRUE);

-- No INSERT/DELETE from client — edge function uses service role only.
-- (Service role bypasses RLS — no policy needed for it.)
