# Together — Supabase setup (one-time)

Your `config.js` already has your project URL + anon key wired in. Three things left, all done from your Supabase dashboard or CLI:

## 1. Create the favorites table (2 minutes)
Dashboard → **SQL Editor** → New query → paste the contents of `schema.sql` → **Run**.
That's it — accounts and playlists work after this.

## 2. Turn on email sign-up (1 minute)
Dashboard → **Authentication** → **Providers** → make sure **Email** is enabled.
By default Supabase requires email confirmation — for a casual friend-group app you can
turn that off under **Authentication → Settings → Email Auth → "Confirm email"** so people
can sign up and start playing immediately. Your call.

## 3. Deploy the AI buddy function (5 minutes, needs the Supabase CLI)
```bash
npm install -g supabase
supabase login
supabase link --project-ref jeeqbiavdxidlitufnhf
supabase secrets set GEMINI_API_KEY=your_real_gemini_key_here
supabase functions deploy ai-buddy --no-verify-jwt
```
Get a real Gemini key from **https://aistudio.google.com/apikey** if the one you have
doesn't start with `AIzaSy` — that prefix is how you can tell it's the right kind of key.

Until this is deployed, `@ai` in chat automatically falls back to the offline scripted
jokes/recommendations — nothing breaks, it just won't be "real" Gemini yet.

## About Spotify
Full Spotify playback needs their Web Playback SDK, which only works for listeners with
**Spotify Premium** — since you don't have Premium to test against, I haven't wired actual
playback. What I *can* do without Premium: detect a pasted Spotify link and show an
"open in Spotify" button so people can still share tracks — just not synced, in-app playback.
Say the word if you want that added.

## Hosting
Push this whole folder to a GitHub repo → **Settings → Pages** → deploy from the `main`
branch. That's your entire frontend, live and free. Supabase (already set up above) is
your entire backend — no separate server to run or pay for.




AIzaSyBJ413biFEFK4uHJAmi1aqsJED8vWfMJoQ