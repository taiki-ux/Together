/* ============================================================
   CONFIG.JS
   The Supabase URL + anon key are DESIGNED to be public/client-side —
   they're meaningless without the Row Level Security policies in
   supabase/schema.sql, which are what actually control access.
   The Gemini key is NOT here and never should be — it lives only as
   a server-side secret behind supabase/functions/ai-buddy. See
   supabase/README.md for the one-time setup.
   ============================================================ */
const SUPABASE_URL = 'https://jeeqbiavdxidlitufnhf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImplZXFiaWF2ZHhpZGxpdHVmbmhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyMTk3NzcsImV4cCI6MjEwMzc5NTc3N30.BMgFxwJ9A8NZKLQy159dk-VmiqmWyKnIl2o3w50OTjQ';
const AI_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/ai-buddy`;
