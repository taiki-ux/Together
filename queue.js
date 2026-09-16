/* ============================================================
   QUEUE.JS
   One queue architecture shared by both channels ('video' and
   'music') — previously this only existed for music. Each item:
   { id, videoId, title, addedBy }. Per channel, also tracks
   votes (up/down per item), a history stack (for Previous),
   shuffle, and repeat ('off' | 'all' | 'one').

   Adding to an empty queue auto-plays it. A track's actual
   playback state still flows through youtube-sync.js's Room
   Playback State (Phase 0) — this module only decides WHAT
   should be loaded next, not how it stays in sync once loaded.

   Same tie-breaking idea as before: whoever's participant id
   sorts first alphabetically is the "queue leader" who's allowed
   to trigger auto-advance/skip-by-vote, so everyone doesn't try
   to advance the queue at once.
   ============================================================ */

const MediaQueues = {
  video: { items:[], votes:{}, history:[], shuffle:false, repeat:'off' },
  music: { items:[], votes:{}, history:[], shuffle:false, repeat:'off' }
};

function isQueueLeader(){
  const ids = Object.keys(participants).sort();
  return ids.length > 0 && ids[0] === myId;
}

function shuffleArray(arr){
  const a = [...arr];
  for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}
function makeTrack(videoId, title){
  return { id:'q'+Date.now()+Math.random().toString(36).slice(2,7), videoId, title, addedBy: myName };
}

function broadcastQueueSync(ch){
  const q = MediaQueues[ch];
  broadcast({ type:'queue', channel:ch, action:'sync',
    items:q.items, votes:q.votes, history:q.history, shuffle:q.shuffle, repeat:q.repeat });
}

// ---------- Core actions ----------
function playNow(ch, videoId, title){
  const q = MediaQueues[ch];
  q.items = [makeTrack(videoId, title)];
  q.votes = {};
  q.history = [];
  renderQueueUI(ch);
  broadcastQueueSync(ch);
  YTSync.load(ch, videoId);
}

function addToQueue(ch, videoId, title){
  const q = MediaQueues[ch];
  const wasEmpty = q.items.length === 0;
  const track = makeTrack(videoId, title);
  q.items.push(track);
  renderQueueUI(ch);
  broadcast({ type:'queue', channel:ch, action:'add', track });
  if (wasEmpty) YTSync.load(ch, track.videoId);
}

function nextTrack(ch){
  const q = MediaQueues[ch];
  if (q.items.length === 0) return;
  const finished = q.items.shift();
  delete q.votes[finished.id];
  q.history.push(finished);
  if (q.items.length === 0 && q.repeat === 'all' && q.history.length){
    q.items = q.shuffle ? shuffleArray(q.history) : [...q.history];
    q.history = [];
  }
  renderQueueUI(ch);
  broadcastQueueSync(ch);
  if (q.items.length) YTSync.load(ch, q.items[0].videoId);
}

function previousTrack(ch){
  const q = MediaQueues[ch];
  if (!q.history.length) return;
  const prev = q.history.pop();
  q.items.unshift(prev);
  renderQueueUI(ch);
  broadcastQueueSync(ch);
  YTSync.load(ch, prev.videoId);
}

function toggleShuffle(ch){
  const q = MediaQueues[ch];
  q.shuffle = !q.shuffle;
  if (q.shuffle && q.items.length > 1) q.items = [q.items[0], ...shuffleArray(q.items.slice(1))];
  renderQueueUI(ch);
  broadcastQueueSync(ch);
}

function toggleRepeat(ch){
  const q = MediaQueues[ch];
  q.repeat = q.repeat === 'off' ? 'all' : (q.repeat === 'all' ? 'one' : 'off');
  renderQueueUI(ch);
  broadcastQueueSync(ch);
}

function voteOnTrack(ch, trackId, choice){
  const q = MediaQueues[ch];
  if (!q.votes[trackId]) q.votes[trackId] = {};
  q.votes[trackId][myId] = choice;
  renderQueueUI(ch);
  broadcast({ type:'queue', channel:ch, action:'vote', trackId, peerId:myId, choice });
  maybeSkipFromVotes(ch, trackId);
}
function maybeSkipFromVotes(ch, trackId){
  const q = MediaQueues[ch];
  if (q.items.length === 0 || q.items[0].id !== trackId) return;
  const votes = q.votes[trackId] || {};
  const downCount = Object.values(votes).filter(v=> v==='down').length;
  const participantCount = Object.keys(participants).length;
  if (downCount > Math.floor(participantCount/2) && isQueueLeader()) nextTrack(ch);
}

// ---------- Remote sync ----------
registerHandler('queue', (fromId, data)=>{
  const q = MediaQueues[data.channel];
  if (!q) return;
  if (data.action === 'add'){
    if (!q.items.find(t=> t.id===data.track.id)) q.items.push(data.track);
    renderQueueUI(data.channel);
  } else if (data.action === 'vote'){
    if (!q.votes[data.trackId]) q.votes[data.trackId] = {};
    q.votes[data.trackId][data.peerId] = data.choice;
    renderQueueUI(data.channel);
  } else if (data.action === 'sync'){
    q.items = data.items || [];
    q.votes = data.votes || {};
    q.history = data.history || [];
    q.shuffle = !!data.shuffle;
    q.repeat = data.repeat || 'off';
    renderQueueUI(data.channel);
  }
});

// New joiners get both channels' current queue state.
window.onPeerConnected = (function(prev){
  return function(peerId){
    if (prev) prev(peerId);
    ['video','music'].forEach(ch=>{
      const q = MediaQueues[ch];
      sendData(dataConns[peerId], { type:'queue', channel:ch, action:'sync',
        items:q.items, votes:q.votes, history:q.history, shuffle:q.shuffle, repeat:q.repeat });
    });
  };
})(window.onPeerConnected);

// Auto-advance when a track ends (YT state 0 = ENDED) — repeat-aware, one leader only.
window.onChannelStateChange = (function(prev){
  return function(ch, ytState){
    if (prev) prev(ch, ytState);
    if (ytState !== 0 || !isQueueLeader()) return;
    const q = MediaQueues[ch];
    if (q.repeat === 'one' && q.items.length){ YTSync.load(ch, q.items[0].videoId); return; }
    nextTrack(ch);
  };
})(window.onChannelStateChange);

// ---------- Rendering ----------
function renderQueueUI(ch){
  const el = document.getElementById('queue-list-' + ch);
  if (el){
    const q = MediaQueues[ch];
    if (q.items.length === 0){
      el.innerHTML = '<p class="queue-empty">Nothing queued — search or add something to get started.</p>';
    } else {
      el.innerHTML = q.items.map((t,i)=>{
        const votes = q.votes[t.id] || {};
        const upCount = Object.values(votes).filter(v=>v==='up').length;
        const downCount = Object.values(votes).filter(v=>v==='down').length;
        const myVote = votes[myId];
        return `
          <div class="queue-item ${i===0?'now-playing':''}">
            <div class="queue-item-info">
              <div class="title">${i===0?'▶ ':''}${escapeHtml(t.title)}</div>
              <div class="added-by">added by ${escapeHtml(t.addedBy)}</div>
            </div>
            <div class="queue-votes">
              <button class="vote-btn ${myVote==='up'?'voted':''}" data-vote-ch="${ch}" data-vote-track="${t.id}" data-vote-choice="up" type="button">👍 ${upCount}</button>
              <button class="vote-btn ${myVote==='down'?'voted':''}" data-vote-ch="${ch}" data-vote-track="${t.id}" data-vote-choice="down" type="button">👎 ${downCount}</button>
            </div>
          </div>
        `;
      }).join('');
      el.querySelectorAll('[data-vote-track]').forEach(btn=>{
        btn.addEventListener('click', ()=> voteOnTrack(btn.dataset.voteCh, btn.dataset.voteTrack, btn.dataset.voteChoice));
      });
    }
  }
  updateQueueControlsUI(ch);
}

function updateQueueControlsUI(ch){
  const q = MediaQueues[ch];
  const prevBtn = document.getElementById('btn-queue-prev-'+ch);
  const nextBtn = document.getElementById('btn-queue-next-'+ch);
  const shuffleBtn = document.getElementById('btn-queue-shuffle-'+ch);
  const repeatBtn = document.getElementById('btn-queue-repeat-'+ch);
  if (prevBtn) prevBtn.disabled = q.history.length === 0;
  if (nextBtn) nextBtn.disabled = q.items.length === 0;
  if (shuffleBtn) shuffleBtn.classList.toggle('on', q.shuffle);
  if (repeatBtn){
    repeatBtn.classList.toggle('on', q.repeat !== 'off');
    repeatBtn.textContent = q.repeat === 'one' ? '🔂' : '🔁';
    repeatBtn.title = q.repeat === 'one' ? 'Repeat: one track' : (q.repeat === 'all' ? 'Repeat: whole queue' : 'Repeat: off');
  }
}

// ---------- Wiring: header controls + paste-row Play now / Queue ----------
['video','music'].forEach(ch=>{
  const prevBtn = document.getElementById('btn-queue-prev-'+ch);
  const nextBtn = document.getElementById('btn-queue-next-'+ch);
  const shuffleBtn = document.getElementById('btn-queue-shuffle-'+ch);
  const repeatBtn = document.getElementById('btn-queue-repeat-'+ch);
  if (prevBtn) prevBtn.addEventListener('click', ()=> previousTrack(ch));
  if (nextBtn) nextBtn.addEventListener('click', ()=> nextTrack(ch));
  if (shuffleBtn) shuffleBtn.addEventListener('click', ()=> toggleShuffle(ch));
  if (repeatBtn) repeatBtn.addEventListener('click', ()=> toggleRepeat(ch));

  const loadBtn = document.getElementById('btn-load-'+ch);
  const queueAddBtn = document.getElementById('btn-queue-add-'+ch);
  const urlInput = document.getElementById('input-'+ch+'-url');

  if (loadBtn && urlInput){
    loadBtn.addEventListener('click', ()=>{
      const raw = urlInput.value;
      if (ch === 'music' && isSpotifyLink(raw)){
        toast("Spotify sync needs sign-in, which isn't built yet — paste a YouTube link for now, or play a file from your device below.");
        return;
      }
      const id = extractVideoId(raw);
      if (!id){ toast("Couldn't find a video in that link — paste a full YouTube URL or ID"); return; }
      playNow(ch, id, raw.trim() || id);
    });
  }
  if (queueAddBtn && urlInput){
    queueAddBtn.addEventListener('click', ()=>{
      const raw = urlInput.value.trim();
      const id = extractVideoId(raw);
      if (!id){ toast("Couldn't find a video in that link", 'err'); return; }
      addToQueue(ch, id, raw || id);
      urlInput.value = '';
      toast('Added to queue 🎶', 'ok');
    });
  }

  renderQueueUI(ch);
});
