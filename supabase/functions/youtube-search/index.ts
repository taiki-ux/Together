// Together — youtube-search Edge Function
// Deploy: supabase functions deploy youtube-search --no-verify-jwt
// Secret:  supabase secrets set YOUTUBE_API_KEY=your_real_key_here
//
// Proxies the YouTube Data API v3 so the key never reaches the browser —
// same reasoning as ai-buddy. Client sends { query }, gets back
// { results: [...] } or { results: [], error: "..." } — always HTTP 200,
// matching ai-buddy's convention of surfacing errors in the body.

const YOUTUBE_API_KEY = Deno.env.get("YOUTUBE_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!YOUTUBE_API_KEY) throw new Error("YOUTUBE_API_KEY secret not set");

    const body = await req.json();
    const query = body?.query;
    if (!query || typeof query !== "string" || !query.trim()) {
      throw new Error("Missing search query");
    }

    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("type", "video");
    url.searchParams.set("maxResults", "8");
    url.searchParams.set("q", query.trim());
    url.searchParams.set("key", YOUTUBE_API_KEY);

    const ytRes = await fetch(url.toString());
    const data = await ytRes.json();
    if (!ytRes.ok) {
      throw new Error(data?.error?.message || `YouTube API responded with HTTP ${ytRes.status}`);
    }

    const results = (data.items || [])
      .filter((item) => item.id?.videoId)
      .map((item) => ({
        videoId: item.id.videoId,
        title: item.snippet?.title || "Untitled",
        channelTitle: item.snippet?.channelTitle || "",
        thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || "",
      }));

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ results: [], error: String(err) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
