/* ============================================================
   BUDDY.JS — the room's resident companion (client side)

   Buddy's *voice* lives on the server (supabase/functions/ai-buddy). This file gives him
   senses and memory, so he can adapt to each room instead of being the same everywhere:

     1. READ THE ROOM   analyzeVibe() looks at the recent chat and decides if the room is
                        funny, banter-y, hyped, chill, tense or sad.
     2. ROAST DIAL      roastLevel() turns that mood (and how people reacted to Buddy's last
                        few messages) into a 0-3 dial. Sad room = 0, always.
     3. REMEMBER        BuddyMemory keeps short notes Buddy writes about the room (running
                        jokes, tastes, what landed or flopped). Shared with everyone in the
                        room and kept on this device per room code.
     4. REPLY           respondAsAI() assembles all of that, asks the function, and posts the
                        answer as a threaded reply to the message it answers.

   You can wake Buddy by mentioning @Buddy, OR by replying (swipe) to one of his messages.
   ============================================================ */

// ---------- 1. Reading the room ----------
const VIBE_LEX = {
  funny: /\b(l+o+l+|lmao+|lmfao|rofl|ha(?:ha)+|hehe+|funny|hilarious|im dead|i'?m dead|jk|kidding|bruh|joke|joking)\b|[😂🤣😹💀]/giu,
  rude:  /\b(stupid|idiot|dumb|shut ?up|stfu|ugly|trash|garbage|useless|loser|moron|fool|nonsense|bullshit|wtf|crap|sucks?|pathetic|clown|annoying|hate (?:you|this|that)|get lost|who asked|cringe|boring)\b/giu,
  sad:   /\b(sad|crying|cried|cry|depressed|depressing|lonely|heartbroken|broken|hurts?|hurting|stressed|anxious|anxiety|struggling|exhausted|grief|grieving|funeral|passed away|died|death|bad day|rough day|not okay|not ok|feel (?:down|low|empty|alone)|can'?t cope|give up)\b|[😢😞😔💔😥]/giu,
  hype:  /\b(let'?s go+|lets go+|yes+|omg|wow|insane|crazy|fire|amazing|incredible|love (?:this|it)|banger|goat|hyped|pop ?off)\b|!{2,}|[🔥🎉🙌😍🤩]/giu
};
const VIBE_WINDOW = 12;

function countMatches(re, text){ const m = text.match(re); return m ? Math.min(m.length, 2) : 0; }

// messages: [{ text, isAI }] oldest -> newest. Returns { mood, scores }.
function analyzeVibe(messages){
  const people = (messages || []).filter(m => m && !m.isAI && typeof m.text === 'string').slice(-VIBE_WINDOW);
  const scores = { funny:0, rude:0, sad:0, hype:0 };
  people.forEach((m, i)=>{
    const w = 0.5 + 0.5 * (people.length > 1 ? i / (people.length - 1) : 1);   // newer lines count more
    const text = m.text;
    const funny = countMatches(VIBE_LEX.funny, text);
    scores.funny += funny * w;
    let rude = countMatches(VIBE_LEX.rude, text);
    const letters = text.replace(/[^A-Za-z]/g, '');
    if (rude && letters.length >= 6 && letters === letters.toUpperCase()) rude += 1;      // SHOUTING + an insult
    scores.rude += rude * w;
    if (!funny) scores.sad += countMatches(VIBE_LEX.sad, text) * w * 1.2;              // "I died 😂" is a joke, not grief
    scores.hype += countMatches(VIBE_LEX.hype, text) * w;
  });
  let mood = 'chill';
  if (scores.sad >= 0.9) mood = 'sad';                                  // someone's hurting: that always wins
  else if (scores.rude >= 1.2) mood = scores.funny >= 1.0 ? 'banter' : 'rude';
  else if (scores.funny >= 1.5) mood = 'funny';
  else if (scores.hype >= 1.5) mood = 'hyped';
  return { mood, scores: { funny:+scores.funny.toFixed(1), rude:+scores.rude.toFixed(1), sad:+scores.sad.toFixed(1), hype:+scores.hype.toFixed(1) } };
}

// ---------- 2. The roast dial ----------
const BASE_ROAST = { sad:0, chill:1, hyped:1, funny:2, rude:2, banter:3 };
const LIKED_REACTIONS = ['👍','❤️','😂','🔥'];
const DISLIKE_WORDS = /\b(rude|mean|too (?:much|far)|stop it|not funny|chill|ouch|offensive|disrespect\w*|that'?s harsh)\b/i;

// How did people take Buddy's last few messages? (reactions on them, and replies to them)
function computeFeedback(messages){
  const recent = (messages || []).slice(-14);
  const buddyIds = new Set(recent.filter(m => m.isAI).slice(-5).map(m => m.id));
  let liked = 0, disliked = 0;
  recent.forEach(m=>{
    if (m.isAI && buddyIds.has(m.id)){
      Object.entries(m.reactions || {}).forEach(([emoji, ids])=>{
        if (LIKED_REACTIONS.includes(emoji) && Array.isArray(ids)) liked += ids.length;
      });
    }
    if (!m.isAI && m.replyTo && buddyIds.has(m.replyTo.id)){
      if (DISLIKE_WORDS.test(m.text || '')) disliked += 1;
      else if (countMatches(VIBE_LEX.funny, m.text || '') > 0) liked += 1;   // laughed at Buddy's line
    }
  });
  return { liked, disliked };
}

function roastLevel(mood, feedback){
  if (mood === 'sad') return 0;
  let level = BASE_ROAST[mood] ?? 1;
  if (feedback && feedback.liked >= 2) level += 1;        // the room enjoys it: turn it up
  if (feedback && feedback.disliked >= 1) level -= 1;     // someone said it stung: dial it back
  return Math.max(0, Math.min(3, level));
}

// ---------- 3. Room memory ----------
const BUDDY_MAX_NOTES = 12;
const BuddyMemory = {
  notes: [],
  key(){ return 'together_buddy_' + (typeof roomCode !== 'undefined' ? roomCode : ''); },
  clean(s){ return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140); },
  load(){
    try{
      const saved = JSON.parse(localStorage.getItem(this.key()) || 'null');
      this.notes = Array.isArray(saved && saved.notes) ? saved.notes.map(n => this.clean(n)).filter(Boolean).slice(-BUDDY_MAX_NOTES) : [];
    }catch(e){ this.notes = []; }
  },
  save(){ try{ localStorage.setItem(this.key(), JSON.stringify({ v:1, notes:this.notes })); }catch(e){} },
  add(note){
    const clean = this.clean(note);
    if (clean.length < 4) return false;
    if (this.notes.some(n => n.toLowerCase() === clean.toLowerCase())) return false;
    this.notes.push(clean);
    if (this.notes.length > BUDDY_MAX_NOTES) this.notes.shift();
    this.save();
    return true;
  }
};

// Everyone in the room hears the same notes. They arrive from other phones, so they're cleaned
// and capped — and the server treats them as data, never as instructions.
registerHandler('buddy', (fromId, data)=>{
  if (data.action === 'note'){ BuddyMemory.add(data.note); }
  else if (data.action === 'sync' && Array.isArray(data.notes)){ data.notes.slice(0, BUDDY_MAX_NOTES).forEach(n => BuddyMemory.add(n)); }
});
window.onPeerConnected = (function(prev){
  return function(peerId){
    if (prev) prev(peerId);
    if (BuddyMemory.notes.length) sendData(dataConns[peerId], { type:'buddy', action:'sync', notes:BuddyMemory.notes });
  };
})(window.onPeerConnected);

// ---------- 4. Building what Buddy sees ----------
function clipText(s, n){ s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

function recentMessagesForBuddy(limit){
  return Object.values(chatMessages)
    .filter(m => m && !m.deleted && typeof m.text === 'string' && m.text)
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-limit);
}

// Peeks at whichever game panel is open instead of games.js pushing its state here
function getActiveGameSummary(){
  const panels = document.querySelectorAll('.game-panel');
  for (const panel of panels){
    if (panel.style.display === 'block'){
      const label = panel.id.replace('game-', '');
      const prompt = panel.querySelector('.quiz-question, .draft-category');
      return prompt ? `Playing ${label}: "${prompt.textContent.trim()}"` : `Playing ${label}`;
    }
  }
  return null;
}

function buildBuddyContext(opts){
  const msgs = recentMessagesForBuddy(14);
  const vibe = analyzeVibe(msgs);
  const feedback = computeFeedback(msgs);
  const roast = roastLevel(vibe.mood, feedback);
  const nowWatching = YTChannels.video.currentId ? (document.getElementById('input-video-url').value.trim() || YTChannels.video.currentId) : null;
  const nowPlaying = YTChannels.music.currentId ? (document.getElementById('input-music-url').value.trim() || YTChannels.music.currentId) : null;
  const replyTo = opts && opts.replyTo ? opts.replyTo : null;
  return {
    recentMessages: msgs.map(m => `${clipText(m.name, 24)}: ${clipText(m.text, 200)}`).join('\n').slice(-1800),
    nowWatching: nowWatching ? clipText(nowWatching, 120) : null,
    nowPlaying: nowPlaying ? clipText(nowPlaying, 120) : null,
    activeGame: getActiveGameSummary(),
    askedBy: clipText(myName, 24),
    replyingTo: replyTo ? { name: clipText(replyTo.name, 24), text: clipText(replyTo.text, 200), isBuddy: /buddy/i.test(replyTo.name || '') } : null,
    members: Object.keys(participants).map(id => clipText(participants[id].name, 24)).slice(0, 12),
    vibe: { mood: vibe.mood, roast, scores: vibe.scores },
    roomNotes: BuddyMemory.notes.slice(-8)
  };
}

// ---------- 5. Replying ----------
const AI_JOKES = [
  "Why don't scientists trust atoms? Because they make up everything.",
  "I told my WiFi I loved it. It said the connection isn't stable.",
  "Why did the scarecrow win an award? He was outstanding in his field.",
  "I'm reading a book on anti-gravity. It's impossible to put down.",
  "Why don't eggs tell jokes? They'd crack each other up.",
  "Parallel lines have so much in common. It's a shame they'll never meet.",
  "Why did the video call freeze? It saw the WiFi bill."
];
const AI_FILLERS = {
  funny: ["You lot are on form tonight 😄", "Okay, that one earned a point. Carry on."],
  banter: ["I'd roast you all, but I'm clearly outgunned in here 😅", "The way this room argues, I'm just taking notes."],
  hyped: ["This energy is unreal, keep it going! 🎉", "I love a room that's having a good time."],
  rude: ["Easy now, I'm just here for the snacks 🍿", "Deep breaths, everyone. The movie isn't going anywhere."],
  sad: ["I'm here if anyone wants to talk, or just sit and watch something cosy. 💛", "No rush, no pressure. We can just hang out for a bit."],
  chill: ["Ask me for a joke, a movie, or a song, I'm in a generous mood. 🎬🎵", "Quiet in here. Someone say something interesting, I'm bored."]
};
const pick = list => list[Math.floor(Math.random() * list.length)];

function scriptedAIReply(triggerText, mood){
  const lower = String(triggerText || '').toLowerCase();
  if (mood === 'sad') return pick(AI_FILLERS.sad);
  if (/joke/.test(lower)) return pick(AI_JOKES);
  if (/movie|watch/.test(lower)) return `Tonight's pick: 🎬 "${suggestMovie()}". Trust me on this one.`;
  if (/song|music|track/.test(lower)) return `Try this: 🎵 "${suggestSong()}". Put it on and thank me later.`;
  return pick(AI_FILLERS[mood] || AI_FILLERS.chill);
}

let lastBuddyCallAt = 0;
const BUDDY_COOLDOWN_MS = 8000;

// opts.trigger = the message that woke Buddy (he replies underneath it); opts.replyTo = what that message was replying to
async function respondAsAI(triggerText, opts){
  opts = opts || {};
  const now = Date.now();
  if (now - lastBuddyCallAt < BUDDY_COOLDOWN_MS){
    toast('🤖 Buddy needs a sec before you ask again');
    return;
  }
  lastBuddyCallAt = now;

  const message = clipText(String(triggerText || '').replace(/(^|\s)@(ai|buddy)(?=\s|$)/gi, ' ').replace(/\s+/g, ' ').trim() || triggerText, 500);
  const context = buildBuddyContext(opts);
  let reply = null, note = null;
  showBuddyTyping(true);
  try{
    const json = await callAiFunction({ message, context, callerId: myId });
    if (json.error === 'RATE_LIMITED'){
      showBuddyTyping(false);
      toast("🤖 Buddy's getting a lot of requests right now, give it a moment");
      return;
    }
    reply = json.reply;
    note = json.note;
    if (!reply) throw new Error('AI returned an empty reply');
  }catch(e){
    console.error('AI buddy unavailable after retry:', e);
    toast('🤖 Buddy is having a moment, here\'s a quick one instead', 'err');
  }
  showBuddyTyping(false);
  if (!reply) reply = scriptedAIReply(triggerText, context.vibe.mood);
  sendChatMessage('🤖 Buddy', clipText(reply, 400), true, opts.trigger || null);   // threaded under the message he's answering
  if (note && BuddyMemory.add(note)) broadcast({ type:'buddy', action:'note', note: BuddyMemory.notes[BuddyMemory.notes.length - 1] });
}
