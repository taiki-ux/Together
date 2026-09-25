/* ============================================================
   APP.JS
   Boot sequence, screen/mode transitions, settings modal, and
   the lightweight @ai chat companion. Everything DOM-facing that
   isn't specific to one activity lives here.
   ============================================================ */

// ---------- Toast ----------
function toast(msg){
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(()=> el.remove(), 3000);
}

function withTimeout(promise, ms, message){
  return Promise.race([
    promise,
    new Promise((_, reject)=> setTimeout(()=> reject(new Error(message)), ms))
  ]);
}

function shortCode(code){ return code.length > 6 ? code.slice(0,3) + '…' : code; }

function toastSuccess(msg) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast toast-success';
  el.textContent = msg;
  el.style.color = '#2ecc71';
  el.style.fontWeight = 'bold';
  container.appendChild(el);
  setTimeout(()=> el.remove(), 3000);
}

// ---------- Splash: fixed 5s, no skip ----------
(function(){
  const colors = ['#ff6f91','#ffd166','#5ee6d0','#a78bfa'];
  const splash = document.getElementById('screen-splash');
  for (let i=0;i<10;i++){
    const p = document.createElement('div');
    p.className='splash-particle';
    const size = 3+Math.random()*5;
    p.style.width=size+'px'; p.style.height=size+'px';
    p.style.left = (Math.random()*100)+'%';
    p.style.top = (Math.random()*100)+'%';
    p.style.background = colors[i%colors.length];
    p.style.animationDuration = (6+Math.random()*6)+'s';
    p.style.animationDelay = (Math.random()*4)+'s';
    splash.appendChild(p);
  }
  setTimeout(async ()=>{
    splash.style.transition = 'opacity .5s ease';
    splash.style.opacity = '0';
    setTimeout(async ()=>{
      splash.style.display='none';
      const user = await restoreAuthSession();
      if (user && myProfile){
        enterAppAsUser();
      } else {
        showAuthScreen();
      }
    }, 500);
  }, 5000);
})();

// ---------- Auth screen flow ----------
function showAuthScreen() {
  document.getElementById('screen-auth').style.display='flex';
  document.getElementById('screen-landing').style.display='none';
  document.getElementById('screen-room').style.display='none';
}

// ---------- Post-login entry point ---------- 
function enterAppAsUser(){
  // Guard: ensure myProfile exists before accessing
  if (!myProfile) {
    console.error('myProfile is null, cannot enter app');
    showAuthScreen();
    return;
  }
  
  myName = myProfile.username || 'User';
  if (typeof startGlobalPresence === 'function' && currentUser) startGlobalPresence(currentUser.id);
  document.getElementById('screen-auth').style.display='none';
  document.getElementById('screen-landing').style.display='flex';
  document.getElementById('screen-room').style.display='none';
  
  const welcomeEl = document.getElementById('landing-welcome');
  if (welcomeEl) {
    welcomeEl.textContent = `Hey ${myProfile.first_name} — sync a video, put on music, or play a game.`;
  }
  
  const saved = getSavedSession();
  if (saved){
    roomCode = saved.room; isHost = saved.isHost;
    showLandingStatus('Restoring your session…');
    initPeer();
    return;
  }
  const params = new URLSearchParams(location.search);
  const invited = params.get('room');
  if (invited) roomInput.value = invited;
}

// ---------- Global toggles used by other modules ----------
window.autoSyncOn = true;
window.soundOn = true;

// ---------- Landing ----------
const roomInput = document.getElementById('input-roomcode');
function showLandingStatus(msg,isErr){ const el=document.getElementById('landing-status'); if(el){ el.textContent=msg; el.classList.toggle('err',!!isErr);} }

document.getElementById('btn-create').addEventListener('click', ()=>{
  roomCode = generateRoomCode(); isHost = true;
  setLandingLoading(true);
  showLandingStatus('Opening your room…');
  initPeer();
});
document.getElementById('btn-join').addEventListener('click', async ()=>{
  const code = roomInput.value.trim().toLowerCase();
  if (!code){ showLandingStatus("Enter the room code your friend sent you.", true); return; }
  roomCode = code; isHost = false;
  setLandingLoading(true);
  showLandingStatus('Joining…');
  requireApproval = await resolveRequireApproval(code);
  initPeer();
});
function setLandingLoading(loading){
  document.getElementById('btn-create').disabled = loading;
  document.getElementById('btn-join').disabled = loading;
}
window.onPeerError = (msg)=>{ setLandingLoading(false); showLandingStatus(msg, true); };

window.onConnectionStatus = function(state){
     const pill = document.getElementById('entry-conn-status');
        if (!pill) return;
           if (state === 'connected'){ pill.textContent = '🟢'; pill.title = 'Connected'; }
              else if (state === 'reconnecting'){ pill.textContent = '🟡'; pill.title = 'Reconnecting…'; toast('Connection dropped — reconnecting…', 'err'); }
                 else if (state === 'offline'){ pill.textContent = '🔴'; pill.title = 'Disconnected'; toast("You've been disconnected. Try rejoining the room.", 'err'); }
                 };

// ---------- Entry gate (choice-only) ----------
window.onPeerReady = async function(){
  document.getElementById('screen-landing').style.display='none';
  document.getElementById('screen-room').style.display='block';
  document.getElementById('entry-hub').style.display='flex';
  window.scrollTo(0,0);
  document.getElementById('entry-room-code').textContent = shortCode(roomCode);
  document.getElementById('input-rename').value = myName;
  if (typeof loadChatHistory === 'function') await loadChatHistory();
  addSystemMessage(isHost ? `Room created. Share the code "${roomCode}" with your friends.` : `You joined "${roomCode}".`);
  if (typeof autoJoinVoiceIfEnabled === 'function') autoJoinVoiceIfEnabled();
};
document.getElementById('entry-btn-copy').addEventListener('click', copyRoomCode);
document.getElementById('entry-btn-invite').addEventListener('click', copyInviteLink);

const buttonStates = {};

function copyRoomCode(){
  if (buttonStates['copy-in-progress']) return;
  buttonStates['copy-in-progress'] = true;
  
  navigator.clipboard.writeText(roomCode).then(()=>{
    const btn = document.getElementById('entry-btn-copy');
    if (btn){
      const old = btn.textContent;
      btn.textContent = '✓';
      setTimeout(()=>{ btn.textContent = old; buttonStates['copy-in-progress'] = false; }, 1200);
    } else {
      buttonStates['copy-in-progress'] = false;
    }
    toast('Room code copied');
  }).catch(err => {
    console.error('Failed to copy room code:', err);
    buttonStates['copy-in-progress'] = false;
  });
}

function copyInviteLink(){
  const link = `${location.origin}${location.pathname}?room=${roomCode}`;
  navigator.clipboard.writeText(link).then(()=> toast('Invite link copied — anyone who opens it can join straight away')).catch(err => {
    console.error('Failed to copy invite link:', err);
  });
}

function leaveRoom(){
  if (!confirm('Leave the room?')) return;
  clearSession();
  leaveRoomPresence();
  if (peer) peer.destroy();
  location.reload();
}
document.getElementById('entry-btn-leave').addEventListener('click', leaveRoom);

document.querySelectorAll('.hub-card').forEach(c=> c.addEventListener('click', ()=> enterActivity(c.dataset.mode, true)));
document.getElementById('btn-back-to-hub').addEventListener('click', ()=>{
  document.getElementById('activity-shell').style.display='none';
  document.getElementById('entry-hub').style.display='flex';
  window.scrollTo(0,0);
});
document.getElementById('btn-chat-video-call').addEventListener('click', ()=>{
  setMode('talk', false);
  if (!micOn) toggleMic();
  if (!camOn) startCamera();
});
document.getElementById('btn-chat-voice-call').addEventListener('click', ()=> setMode('talk', false));
document.getElementById('btn-chat-menu').addEventListener('click', ()=> toast('More options coming soon'));

let isEnteringActivity = false;

function enterActivity(mode, broadcastIt){
  if (isEnteringActivity) return;
  isEnteringActivity = true;
  
  document.getElementById('entry-hub').style.display='none';
  document.getElementById('activity-shell').style.display='flex';
  window.scrollTo(0,0);
  setMode(mode, broadcastIt);
  
  isEnteringActivity = false;
}

const SHARED_MODES = ['video','music','games']; 

function mountChatInSidebar(){
     const mount = document.getElementById('chat-sidebar-mount');
     if (mount) mount.appendChild(document.getElementById('chat-col'));
}
function mountChatInPage(){
     const mount = document.getElementById('chat-page-mount');
     if (mount) mount.appendChild(document.getElementById('chat-col')); 
}
function setMode(mode, broadcastIt){
     const shell = document.getElementById('activity-shell');
     if (shell && shell.style.display !== 'flex' && !isEnteringActivity) {
         enterActivity(mode, broadcastIt);
         return;
}   
// currentMode only tracks the room's shared activity (Watch/Music/Games) —   
// Chat/Talk/Playlist are personal views layered on top and never broadcast,   
// so navigating to them never interrupts what everyone else is doing.   i
if (SHARED_MODES.includes(mode)) currentMode = mode;    

document.querySelectorAll('.pane').forEach(p=>p.classList.remove('active'));   
const pane = document.getElementById('pane-'+mode);   
if (pane) pane.classList.add('active');
document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active', b.dataset.mode===mode));    

// The sidebar (who's here, quick voice toggle, chat drawer) is redundant on
// Watch/Music/Games now that Chat and Talk are full, dedicated tabs — keep
// it for everywhere else (Chat/Talk/Profile). Toggling a class on room-body
// too so the grid actually reclaims the sidebar's column instead of leaving
// blank space where it used to be.
const sideCol = document.getElementById('side-col');
const roomBody = document.querySelector('.room-body');
const hideSidebar = SHARED_MODES.includes(mode);
if (sideCol) sideCol.style.display = hideSidebar ? 'none' : '';
if (roomBody) roomBody.classList.toggle('no-sidebar', hideSidebar);

if (mode === 'chat'){
     mountChatInPage();
     document.getElementById('chat-col').classList.add('open');
     document.getElementById('chat-toggle-wrap').classList.remove('visible');   
} else {
       mountChatInSidebar();
       document.getElementById('chat-toggle-wrap').classList.add('visible');   
}
const chatActions = document.getElementById('topbar-chat-actions');
if (chatActions) chatActions.classList.toggle('visible', mode === 'chat');
const mainCol = document.getElementById('main-col');
if (mainCol) mainCol.classList.toggle('chat-full-bleed', mode === 'chat');
if (mode === 'video') renderPlaylistList('video', 'playlist-video-list-inline');
if (mode === 'music') renderPlaylistList('music', 'playlist-music-list-inline');
if (mode === 'talk') renderTalkGrid();
placeVideos();
    

if (broadcastIt && SHARED_MODES.includes(mode)) broadcast({type:'mode', mode}); 
// Personal "what am I up to" status — distinct from the shared-mode broadcast
// above (which syncs the ROOM's Watch/Music/Games view), this just tells
// everyone what I'm personally looking at, for the hub presence list.
if (participants[myId]) participants[myId].status = mode;
broadcast({ type:'presence-status', status: mode });
if (typeof renderHubPresence === 'function') renderHubPresence();
}

async function renderPlaylistList(kind, containerId){
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '<p class="hint">Loading…</p>';
  let items = [];
  try{ items = await loadFavorites(kind); }
  catch(e){ console.error('Failed to load favorites:', e); el.innerHTML = '<p class="hint">Couldn\'t load these right now.</p>'; return; }

  if (!items || items.length === 0){ el.innerHTML = '<p class="hint">Nothing saved yet — hit ⭐ next to Load.</p>'; return; }

  el.innerHTML = items.map(it => `
    <div class="playlist-item">
      <img class="playlist-thumb" src="${thumbUrl(it.video_id)}" alt="" loading="lazy">
      <div class="playlist-info">
        <div class="playlist-title" data-title-for="${it.id}">${escapeHtml(isUrlish(it.title) ? 'Loading title…' : it.title)}</div>
        <div class="playlist-sub">${kind === 'music' ? '🎵 Song' : '🎬 Video'}</div>
      </div>
      <span class="playlist-actions">
        <button class="btn btn-secondary btn-sm" data-load="${it.video_id}" data-kind="${kind}" type="button">▶ Play</button>
        <button class="icon-btn" data-remove="${it.id}" data-kind="${kind}" type="button" title="Remove">🗑</button>
      </span>
    </div>
  `).join('');

  el.querySelectorAll('[data-load]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      YTSync.load(btn.dataset.kind, btn.dataset.load);
      setMode(btn.dataset.kind, true);
    });
  });
  el.querySelectorAll('[data-remove]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      try{ await deleteFavorite(btn.dataset.remove); }
      catch(e){ console.error('Failed to remove favorite:', e); toast("Couldn't remove that item", 'err'); return; }
      renderPlaylistList(btn.dataset.kind, containerId);
    });
  });

  // Old saves that only stored a link: look up the real name and fix them
  items.filter(it => isUrlish(it.title)).forEach(async it=>{
    const t = (await fetchVideoTitle(it.video_id)) || 'YouTube video';
    const node = el.querySelector(`[data-title-for="${it.id}"]`);
    if (node) node.textContent = t;
    if (t !== 'YouTube video') updateFavoriteTitle(it.id, t);
  });
}

function renderTalkGrid(){
  const grid = document.getElementById('talk-grid');
  if (!grid) return;
  grid.innerHTML = '';
  Object.keys(participants).forEach(id=>{
    const p = participants[id];
    const tile = document.createElement('div'); tile.className = 'talk-tile';
    tile.dataset.id = id;

    const slot = document.createElement('div'); slot.className = 'video-slot';
    tile.appendChild(slot);

    const av = document.createElement('div'); av.className = 'avatar talk-avatar'; av.dataset.peer = id;
    av.style.background = nameColor(p.name || '?'); av.textContent = initials(p.name);
    if (speakingState[id]) av.classList.add('speaking');
    tile.appendChild(av);

    const nm = document.createElement('div'); nm.className = 'talk-name'; nm.textContent = (id === myId ? 'You' : p.name);
    tile.appendChild(nm);

    const micState = document.createElement('div'); micState.className = 'talk-mic-state';
    micState.textContent = p.muted === false ? '🎤 On' : '🔇 Off';
    tile.appendChild(micState);

    grid.appendChild(tile);
  });
  placeVideos();
}
window.onOrbitRender = (function(prev){ return function(){ if (prev) prev(); renderTalkGrid(); }; })(window.onOrbitRender);
window.onRemoteMode = (mode)=> setMode(mode, false);
document.querySelectorAll('.nav-btn').forEach(b=> b.addEventListener('click', ()=>setMode(b.dataset.mode, true)));

function setChatToggleLabel(open){
  const btn = document.getElementById('btn-chat-toggle');
  if (btn) btn.textContent = open ? '✕ Close chat' : '💬 Open chat';
}
document.getElementById('btn-chat-toggle').addEventListener('click', ()=>{
  const chatCol = document.getElementById('chat-col');
  const open = !chatCol.classList.contains('open');
  chatCol.classList.toggle('open', open);
  setChatToggleLabel(open);
});

window.onChannelLoading = (function(prev){
  return function(ch, videoId){
    if (prev) prev(ch, videoId);
    if (ch === 'video'){ const ph = document.getElementById('video-placeholder'); if (ph) ph.style.display='none'; }
  };
})(window.onChannelLoading);

document.getElementById('btn-play-video').addEventListener('click', ()=>YTSync.play('video'));
document.getElementById('btn-pause-video').addEventListener('click', ()=>YTSync.pause('video'));
document.getElementById('btn-sync-video').addEventListener('click', ()=>YTSync.syncToMe('video'));
document.getElementById('btn-seek-video').addEventListener('click', ()=>{
  if (!YTSync.seek('video', document.getElementById('input-seek-video').value)) toast('Enter a time like 1:23 or a number of seconds');
});
document.getElementById('input-seek-video').addEventListener('keydown', e=>{ if(e.key==='Enter') document.getElementById('btn-seek-video').click(); });
document.getElementById('btn-fullscreen').addEventListener('click', async ()=>{
  const frame = document.querySelector('#pane-video .video-frame');
  if (document.fullscreenElement){
    if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock();
    document.exitFullscreen();
  } else {
    try{
      if (frame.requestFullscreen) await frame.requestFullscreen();
      else if (frame.webkitRequestFullscreen) frame.webkitRequestFullscreen();
      if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape').catch(()=>{});
    }catch(err){ console.warn('Fullscreen/rotation error:', err); }
  }
});

document.getElementById('btn-play-music').addEventListener('click', ()=>YTSync.play('music'));
document.getElementById('btn-pause-music').addEventListener('click', ()=>YTSync.pause('music'));
document.getElementById('btn-sync-music').addEventListener('click', ()=>YTSync.syncToMe('music'));
document.getElementById('btn-seek-music').addEventListener('click', ()=>{
  if (!YTSync.seek('music', document.getElementById('input-seek-music').value)) toast('Enter a time like 1:23 or a number of seconds');
});
document.getElementById('input-seek-music').addEventListener('keydown', e=>{ if(e.key==='Enter') document.getElementById('btn-seek-music').click(); });
document.getElementById('btn-pick-local').addEventListener('click', ()=> document.getElementById('input-local-file').click());
document.getElementById('input-local-file').addEventListener('change', function(){
  if (this.files && this.files[0]) musicPlayLocalFile(this.files[0]);
});

async function toggleMic(){
     if (typeof pushToTalkOn !== 'undefined' && pushToTalkOn) return; // press/hold owns mic state in this mode
     if (!micOn){
         try{
            if (!localStream){ localStream = await acquireMicStream(); attachSpeakingDetector(localStream, myId); }
            localStream.getAudioTracks().forEach(t=> t.enabled = true);
            micOn = true;
            updateMicButtonsUI(true);
            Object.keys(dataConns).forEach(id=> maybeCallPeer(id));
            broadcast({ type:'mic', muted:false });
           }catch(e){
            console.error('Mic access failed:', e);
            const reason = e.name === 'NotAllowedError' ? 'Microphone permission was denied.'
                 : e.name === 'NotFoundError' ? 'No microphone was found on this device.'
                 : `Couldn't access your microphone (${e.message || e.name || 'unknown error'}).`;
            toast(reason, 'err');
           }
       } else {
         micOn = false;
         if (localStream) localStream.getAudioTracks().forEach(t=> t.enabled = false);
         updateMicButtonsUI(false);
         broadcast({ type:'mic', muted:true });
       }
} 

function updateMicButtonsUI(on){
     const ptt = (typeof pushToTalkOn !== 'undefined' && pushToTalkOn);
     const sidebarBtn = document.getElementById('btn-mic');
     if (sidebarBtn){
           sidebarBtn.textContent = ptt ? (localStream ? (on ? '🎤 Talking…' : '🎤 Hold to talk') : '🎤 Join voice') : (on ? '🔇 Leave voice' : '🎤 Join voice');
           sidebarBtn.classList.toggle('btn-secondary', !on);
           sidebarBtn.classList.toggle('btn-ghost', on);
      }
     const talkBtn = document.getElementById('btn-mic-talk');
     if (talkBtn){
           talkBtn.textContent = ptt ? (localStream ? (on ? '🎤 Talking…' : '🎤 Hold to talk') : '🎤 Join voice') : (on ? '🔇 Leave voice' : '🎤 Join voice');
           talkBtn.classList.toggle('on', on);
      } 
} 

async function callAiFunction(payload, attempt){
  attempt = attempt || 1;
  try{
    const res = await fetch(AI_FUNCTION_URL, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${SUPABASE_ANON_KEY}`, 'apikey':SUPABASE_ANON_KEY },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`AI service responded with HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    return json;
  }catch(e){
    if (attempt === 1){
      console.warn('AI call failed once, retrying:', e.message);
      await new Promise(r=> setTimeout(r, 800));
      return callAiFunction(payload, 2);
    }
    throw e;
  }
}


document.getElementById('btn-mic').addEventListener('click', toggleMic);
document.getElementById('btn-mic-talk').addEventListener('click', toggleMic);

const AI_JOKES = [
  "Why don't scientists trust atoms? Because they make up everything.",
  "I told my WiFi I loved it. It said the connection isn't stable.",
  "Why did the scarecrow win an award? He was outstanding in his field.",
  "I'm reading a book on anti-gravity. It's impossible to put down.",
  "Why don't eggs tell jokes? They'd crack each other up.",
  "I used to be a banker, but I lost interest.",
  "Parallel lines have so much in common. It's a shame they'll never meet.",
  "Why did the video call freeze? It saw the WiFi bill."
];
const AI_FILLERS = [
  "Haha, love the energy in here! 🎉",
  "I'm just a lightweight joke-bot for now — ask me for a joke, a movie, or a song! 🎬🎵",
  "Ha! Okay okay, carry on 😄",
  "That's the spirit! Someone say the word 'joke' if you want one 👀"
];
function buildRoomContext(){
  const recentMessages = recentChatLog.slice(-8).map(m=> `${m.name}: ${m.text}`).join('\n');
  const nowWatching = YTChannels.video.currentId ? (document.getElementById('input-video-url').value.trim() || YTChannels.video.currentId) : null;
  const nowPlaying = YTChannels.music.currentId ? (document.getElementById('input-music-url').value.trim() || YTChannels.music.currentId) : null;
  return { recentMessages, nowWatching, nowPlaying, activeGame: getActiveGameSummary() };
}

// Peeks at whichever .game-panel is currently visible instead of games.js
// having to push its state here — keeps the game files untouched.
function getActiveGameSummary(){
  const panels = document.querySelectorAll('.game-panel');
  for (const panel of panels){
    if (panel.style.display === 'block'){
      const label = panel.id.replace('game-','');
      const prompt = panel.querySelector('.quiz-question, .draft-category');
      return prompt ? `Playing ${label}: "${prompt.textContent.trim()}"` : `Playing ${label}`;
    }
  }
  return null;
}

let lastBuddyCallAt = 0;
const BUDDY_COOLDOWN_MS = 8000;

async function respondAsAI(triggerText){
  const now = Date.now();
  if (now - lastBuddyCallAt < BUDDY_COOLDOWN_MS){
    toast('🤖 Buddy needs a sec before you ask again');
    return;
  }
  lastBuddyCallAt = now;

  let reply = null;
  showBuddyTyping(true);
  try{
    const json = await callAiFunction({ message: triggerText, context: buildRoomContext(), callerId: myId });
    if (json.error === 'RATE_LIMITED'){
      showBuddyTyping(false);
      toast("🤖 Buddy's getting a lot of requests right now — give it a moment");
      return;
    }
    reply = json.reply;
    if (!reply) throw new Error('AI returned an empty reply');
  }catch(e){
    console.error('AI buddy unavailable after retry:', e);
    toast(`🤖 AI is offline right now (${e.message}) — using a scripted reply instead`, 'err');
  }
  showBuddyTyping(false);
  if (!reply) reply = scriptedAIReply(triggerText);
  sendChatMessage('🤖 Buddy', reply, true);
}

function scriptedAIReply(triggerText){
  const lower = triggerText.toLowerCase();
  if (/joke/.test(lower)) return AI_JOKES[Math.floor(Math.random()*AI_JOKES.length)];
  if (/movie|watch/.test(lower)) return `Tonight's pick: 🎬 "${suggestMovie()}" — trust me on this one.`;
  if (/song|music|track/.test(lower)) return `Try this: 🎵 "${suggestSong()}" — put it on and thank me later.`;
  return AI_FILLERS[Math.floor(Math.random()*AI_FILLERS.length)];
}

// ---------- Reactions ----------
function spawnFloatingReaction(pane, emoji){
  const layer = document.getElementById('reaction-layer-' + pane);
  if (!layer) return;
  const bubble = document.createElement('div');
  bubble.className = 'reaction-bubble';
  bubble.textContent = emoji;
  bubble.style.left = (20 + Math.random()*60) + '%';
  layer.appendChild(bubble);
  setTimeout(()=> bubble.remove(), 2600);
}
function sendReaction(emoji){
  const pane = (currentMode === 'music') ? 'music' : 'video';
  spawnFloatingReaction(pane, emoji);
  broadcast({ type:'reaction', emoji });
}
registerHandler('reaction', (fromId, data)=>{
  // Shows wherever the receiver is currently looking, if that's Watch or Music —
  // otherwise there's no visible spot for it right now, so it's just skipped.
  if (currentMode === 'video' || currentMode === 'music'){
    spawnFloatingReaction(currentMode, data.emoji);
  }
});
document.querySelectorAll('.reaction-btn').forEach(btn=>{
  btn.addEventListener('click', ()=> sendReaction(btn.dataset.emoji));
});


window.onChatReceived = function(){ playChime(); };
function playChime(){
  if (!window.soundOn) return;
  try{
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type='sine'; o.frequency.value=740;
    g.gain.setValueAtTime(0.001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime+0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime+0.28);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime+0.3);
  }catch(e){}
}

function openSettings(){
  document.getElementById('settings-overlay').style.display='flex';
  document.getElementById('settings-account-desc').textContent = `${myProfile.first_name} ${myProfile.last_name} · @${myProfile.username}`;
  populateMicSelect();
}
document.getElementById('btn-settings-close').addEventListener('click', ()=>{ document.getElementById('settings-overlay').style.display='none'; });
document.getElementById('settings-overlay').addEventListener('click', e=>{ if (e.target.id==='settings-overlay') e.currentTarget.style.display='none'; });

document.getElementById('btn-rename-save').addEventListener('click', ()=>{
  const newName = document.getElementById('input-rename').value.trim();
  if (!newName || newName===myName) return;
  myName = newName;
  participants[myId].name = myName;
  renderOrbit();
  broadcast({type:'rename', name:myName});
  addSystemMessage(`You are now known as "${myName}"`);
});
document.getElementById('toggle-sound').addEventListener('click', function(){ window.soundOn=!window.soundOn; this.classList.toggle('on',window.soundOn); });
document.getElementById('toggle-autosync').addEventListener('click', function(){ window.autoSyncOn=!window.autoSyncOn; this.classList.toggle('on',window.autoSyncOn); });

async function populateMicSelect(){
  try{
    const sel = document.getElementById('select-mic');
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter(d=>d.kind==='audioinput');
    sel.innerHTML = '';
    mics.forEach((d, i) => {
      const option = document.createElement('option');
      option.value = d.deviceId;
      option.textContent = d.label || ('Microphone ' + (i + 1));
      sel.appendChild(option);
    });
  }catch(e){ console.error('Failed to populate microphone list:', e); }
}
document.getElementById('select-mic').addEventListener('change', async function(){
  const deviceId = this.value; if (!deviceId) return;
  try{
    const newStream = await acquireMicStream(deviceId);
    if (localStream) localStream.getTracks().forEach(t=>t.stop());
    localStream = newStream;
    localStream.getAudioTracks().forEach(t=>t.enabled=micOn);
    attachSpeakingDetector(localStream, myId);
    const newTrack = localStream.getAudioTracks()[0];
    Object.values(mediaConns).forEach(call=>{
      const pc = call.peerConnection;
      if (!pc) return;
      const sender = pc.getSenders().find(s=>s.track && s.track.kind==='audio');
      if (sender) sender.replaceTrack(newTrack);
    });
  }catch(e){ alert("Couldn't switch microphone."); console.error('Microphone switch error:', e); }
});

// ---------- Account (Supabase Auth) ----------
document.getElementById('btn-settings-logout').addEventListener('click', async ()=>{
  await signOutUser();
  location.reload();
});
window.onAuthChange = function(user){
  if (user){
    if (document.getElementById('screen-auth').style.display !== 'none') enterAppAsUser();
  } else if (document.getElementById('screen-room').style.display !== 'none'){
    location.reload();
  }
};

function refreshAccountPanel(user){
  const out = document.getElementById('account-signed-out');
  const inn = document.getElementById('account-signed-in');
  if (user){
    out.style.display='none'; inn.style.display='block';
    document.getElementById('account-email').textContent = user.email;
  } else {
    out.style.display='block'; inn.style.display='none';
  }
}

// Auth screen - Sign up with full profile
document.getElementById('btn-signup').addEventListener('click', async function(e){
  e.preventDefault();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const firstName = document.getElementById('signup-first').value.trim();
  const lastName = document.getElementById('signup-last').value.trim();
  const username = document.getElementById('signup-username').value.trim();
  
  if (!email || !password || !firstName || !lastName || !username) {
    showAuthStatus('Fill in all fields.', true);
    return;
  }
  
  showAuthStatus('Creating account…');
  const { error } = await signUpWithProfile({ firstName, lastName, username, email, password });
  if (error) {
    showAuthStatus(error.message || 'Sign-up failed', true);
  } else {
    showAuthStatus('✓ Registration successful! Welcome to Together!', false);
    setTimeout(() => {
      document.getElementById('signup-first').value = '';
      document.getElementById('signup-last').value = '';
      document.getElementById('signup-username').value = '';
      document.getElementById('signup-email').value = '';
      document.getElementById('signup-password').value = '';
    }, 1500);
  }
});

// Auth screen - Log in
document.getElementById('btn-login').addEventListener('click', async function(e){
     e.preventDefault();
     const email = document.getElementById('login-email').value.trim();
     const password = document.getElementById('login-password').value;
     if (!email || !password){ showAuthStatus('Enter an email and password.', true); return; }
     showAuthStatus('Logging in…');
     try{
           const { error } = await withTimeout(signInWithEmail(email, password), 15000, "That's taking too long — check your connection and try again.");
           if (error) showAuthStatus(error.message, true);
           // success case: window.onAuthChange fires and calls enterAppAsUser() itself
     }catch(err){
           showAuthStatus(err.message || 'Something went wrong logging in.', true);
    }
});

function showAuthStatus(msg, isErr){
  const el = document.getElementById('auth-status');
  if (el) {
    el.textContent = msg; 
    el.style.color = isErr ? 'var(--coral)' : '#2ecc71';
    el.style.fontWeight = isErr ? 'normal' : 'bold';
  }
}

// Auth tab switching
document.querySelectorAll('.auth-tab').forEach(btn => {
  btn.addEventListener('click', function() {
    const tab = this.dataset.tab;
    document.querySelectorAll('.auth-tab').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    document.getElementById('auth-login').style.display = tab === 'login' ? 'block' : 'none';
    document.getElementById('auth-signup').style.display = tab === 'signup' ? 'block' : 'none';
    document.getElementById('auth-status').textContent = '';
  });
});

// ---------- Save to playlist ----------
document.getElementById('btn-save-video').addEventListener('click', ()=>{
  const c = YTChannels.video;
  if (!c.currentId){ toast('Load a video first'); return; }
  const title = document.getElementById('input-video-url').value.trim() || c.currentId;
  saveFavorite('video', title, c.currentId);
});
document.getElementById('btn-save-music').addEventListener('click', ()=>{
  const c = YTChannels.music;
  if (!c.currentId){ toast('Load a track first'); return; }
  const title = document.getElementById('input-music-url').value.trim() || c.currentId;
  saveFavorite('music', title, c.currentId);
});

// Logout from landing page
const landingLogout = document.getElementById('btn-landing-logout');
if (landingLogout) {
  landingLogout.addEventListener('click', async ()=>{
    await signOutUser();
    showAuthScreen();
    toast('Logged out');
  });
}

document.getElementById('btn-stop-video').addEventListener('click', ()=> YTSync.stop('video'));
document.getElementById('btn-stop-music').addEventListener('click', ()=>{
  YTSync.stop('music');
  const a = document.getElementById('local-audio-player'); // also stops a file playing just for you
  if (a && a.style.display !== 'none'){ a.pause(); a.currentTime = 0; }
});


// ---------- Entry hub: 3-line menu ----------
const entryMenu = document.getElementById('entry-menu');
const entryMenuToggle = document.getElementById('entry-menu-toggle');
function setEntryMenu(open){
  entryMenu.style.display = open ? 'flex' : 'none';
  entryMenuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}
entryMenuToggle.addEventListener('click', e=>{
  e.stopPropagation();
  setEntryMenu(entryMenu.style.display === 'none');
});
// any item closes the menu (their own click handlers still run)
entryMenu.querySelectorAll('.menu-item').forEach(b=> b.addEventListener('click', ()=> setEntryMenu(false)));
// tap anywhere else to close
document.addEventListener('click', e=>{
  if (!e.target.closest('.entry-menu-wrap')) setEntryMenu(false);
});

document.getElementById('entry-btn-settings').addEventListener('click', openSettings);

// ---------- Profile popup ----------
document.getElementById('entry-btn-profile').addEventListener('click', ()=>{
  if (!myProfile) return;
  const full = `${myProfile.first_name || ''} ${myProfile.last_name || ''}`.trim();
  const av = document.getElementById('profile-avatar');
  av.textContent = initials(full || myProfile.username);
  av.style.background = nameColor(myProfile.username || full || '?');
  document.getElementById('profile-fullname').textContent = full || myProfile.username;
  document.getElementById('profile-username').textContent = '@' + myProfile.username;
  document.getElementById('profile-email').textContent = (currentUser && currentUser.email) || '';
  document.getElementById('profile-overlay').style.display = 'flex';
});
document.getElementById('btn-profile-close').addEventListener('click', ()=>{
  document.getElementById('profile-overlay').style.display = 'none';
});
document.getElementById('profile-overlay').addEventListener('click', e=>{
  if (e.target.id === 'profile-overlay') e.currentTarget.style.display = 'none';
});

