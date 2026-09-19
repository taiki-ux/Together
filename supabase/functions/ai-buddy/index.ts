// Together — ai-buddy Edge Function
// Deploy: supabase functions deploy ai-buddy --no-verify-jwt
// Secret:  supabase secrets set GEMINI_API_KEY=your_real_key_here

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`;

const CHAT_SYSTEM_PROMPT = "You are Buddy, a friendly, fun, joke-telling companion inside a watch-party app called Together, used by friends/couples/family hanging out remotely. Keep replies short — 1 to 3 sentences, casual and warm, a little playful. You can tell jokes and recommend a movie or a song when asked. If room context is given below, use it to make your reply feel like it's actually paying attention to the room — don't just repeat the context back verbatim.";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Best-effort per-caller rate limit — in-memory, so it resets whenever this
// function instance cold-starts (Supabase doesn't guarantee it stays warm).
// Not airtight against someone hitting the endpoint directly with the anon
// key, but it stops the normal case of one person mashing @Buddy in chat.
const RATE_LIMIT_MS = 8000;
const recentCalls = new Map(); // callerId -> last call timestamp
function isRateLimited(callerId){
  if (!callerId) return false; // no id supplied — don't block, just skip enforcement
  const now = Date.now();
  const last = recentCalls.get(callerId);
  if (last && now - last < RATE_LIMIT_MS) return true;
  recentCalls.set(callerId, now);
  if (recentCalls.size > 500) recentCalls.clear(); // crude cap so memory doesn't grow unbounded
  return false;
}

function stripCodeFence(text){
  return text.replace(/^```json\s*/i, "").replace(/^```\s*/,"").replace(/```\s*$/,"").trim();
}

async function callGemini(contents, generationConfig){
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents, generationConfig }),
  });
  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error("No reply from Gemini: " + JSON.stringify(json).slice(0, 300));
  return text;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY secret not set");
    const body = await req.json();

    if (isRateLimited(body.callerId)) {
      return new Response(JSON.stringify({ reply: null, trivia: null, error: "RATE_LIMITED" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.mode === "trivia") {
      const asked = Array.isArray(body.askedQuestions) ? body.askedQuestions : [];
      const prompt = `Generate ONE fresh multiple-choice trivia question for a casual group of friends hanging out. Respond with STRICT JSON only — no markdown, no code fences, no commentary — in exactly this shape: {"question":"...", "choices":["...","...","...","..."], "correctIndex":0}. correctIndex is the 0-based index of the correct choice. Keep it fun and general-knowledge level, not obscure. Do NOT repeat or closely resemble any of these already-asked questions: ${JSON.stringify(asked)}`;
      const text = await callGemini(
        [{ parts: [{ text: prompt }] }],
        { maxOutputTokens: 220, temperature: 1.0 }
      );
      const parsed = JSON.parse(stripCodeFence(text));
      if (!parsed.question || !Array.isArray(parsed.choices) || parsed.choices.length !== 4 || typeof parsed.correctIndex !== "number") {
        throw new Error("Malformed trivia JSON from Gemini");
      }
      return new Response(JSON.stringify({ trivia: parsed }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.mode === "guess") {
      const category = ["movie", "song", "character"].includes(body.category) ? body.category : "movie";
      const categoryLabel = { movie: "movie", song: "song", character: "fictional character" }[category];
      const asked = Array.isArray(body.askedPrompts) ? body.askedPrompts : [];
      const prompt = `Write ONE multiple-choice "guess the ${categoryLabel}" round for a casual group of friends. Pick a well-known ${categoryLabel}, then write a short ORIGINAL clue (2-3 sentences) describing it in your own words — plot, vibe, era, genre, personality, whatever fits. Do NOT quote lyrics, dialogue, or any copyrighted text verbatim, and don't name it in the clue. Then give 4 short answer choices (the real one plus 3 plausible wrong ones). Respond with STRICT JSON only — no markdown, no code fences, no commentary — in exactly this shape: {"clue":"...", "choices":["...","...","...","..."], "correctIndex":0}. Do NOT repeat or closely resemble any of these already-used clues: ${JSON.stringify(asked)}`;
      const text = await callGemini(
        [{ parts: [{ text: prompt }] }],
        { maxOutputTokens: 260, temperature: 1.0 }
      );
      const parsed = JSON.parse(stripCodeFence(text));
      if (!parsed.clue || !Array.isArray(parsed.choices) || parsed.choices.length !== 4 || typeof parsed.correctIndex !== "number") {
        throw new Error("Malformed guess JSON from Gemini");
      }
      return new Response(JSON.stringify({ guess: parsed }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Default: chat mode
    const { message, context } = body;
    if (!message || typeof message !== "string") throw new Error("Missing message");

    let contextBlock = "";
    if (context) {
      if (context.nowWatching) contextBlock += `They're currently watching: ${context.nowWatching}\n`;
      if (context.nowPlaying) contextBlock += `They're currently listening to: ${context.nowPlaying}\n`;
      if (context.recentMessages) contextBlock += `Recent chat in the room:\n${context.recentMessages}\n`;
      if (context.activeGame) contextBlock += `They're currently playing: ${context.activeGame}\n`;
    }
    const systemPrompt = contextBlock
      ? `${CHAT_SYSTEM_PROMPT}\n\nRoom context:\n${contextBlock}`
      : CHAT_SYSTEM_PROMPT;

    const res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: message }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
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
    return new Response(JSON.stringify({ reply: null, trivia: null, error: String(err) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});