-- Migration: press article generation system
-- Adds trigger_key dedup column, generated flag, inserted_at timestamp,
-- and locks down industry_articles RLS so clients cannot insert directly.
--
-- Run this in the Supabase SQL editor for project pvxrciebegirmrrrzkor.

-- ── 1. Add new columns ────────────────────────────────────────────────────────

ALTER TABLE public.industry_articles
  ADD COLUMN IF NOT EXISTS trigger_key  TEXT,
  ADD COLUMN IF NOT EXISTS generated    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS inserted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ── 2. Unique constraint on trigger_key (NULLs are not considered equal,
--       so hand-crafted articles with trigger_key = NULL can coexist freely)
CREATE UNIQUE INDEX IF NOT EXISTS idx_industry_articles_trigger_key
  ON public.industry_articles (trigger_key)
  WHERE trigger_key IS NOT NULL;

-- ── 3. RLS — clients may SELECT, never INSERT/UPDATE/DELETE
--       The edge function uses the service role key and bypasses RLS entirely.

ALTER TABLE public.industry_articles ENABLE ROW LEVEL SECURITY;

-- Drop any old permissive policies that allowed client writes
DROP POLICY IF EXISTS "allow_all" ON public.industry_articles;
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

-- No INSERT/UPDATE/DELETE from client — edge function uses service role only.
-- (Service role bypasses RLS — no policy needed for it.)
