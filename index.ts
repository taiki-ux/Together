// Together — ai-buddy Edge Function
// Deploy: supabase functions deploy ai-buddy
// Secret:  supabase secrets set GEMINI_API_KEY=your_real_key_here
// The key lives only here, server-side — it never ships to the browser.

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

const SYSTEM_PROMPT = "You are Buddy, a friendly, fun, joke-telling companion inside a watch-party app called Together, used by friends/couples/family hanging out remotely. Keep replies short — 1 to 3 sentences, casual and warm, a little playful. You can tell jokes and recommend a movie or a song when asked.";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY secret not set");
    const { message } = await req.json();
    if (!message || typeof message !== "string") throw new Error("Missing message");

    const res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: message }] }],
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig: { maxOutputTokens: 120, temperature: 0.9 },
      }),
    });
    const json = await res.json();
    const reply = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!reply) throw new Error("No reply from Gemini: " + JSON.stringify(json).slice(0, 300));

    return new Response(JSON.stringify({ reply }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    // Return 200 with a fallback flag so the client can gracefully fall back
    // to its offline scripted jokes instead of showing a broken chat bubble.
    return new Response(JSON.stringify({ reply: null, error: String(err) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
