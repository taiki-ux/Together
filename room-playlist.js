/* ============================================================
   ROOM-PLAYLIST.JS
   The playlist belongs to the ROOM:
     - 📌 Save (Watch / Music) adds the current video or song to this room's playlist.
     - Everyone in the room sees it, live (peer-to-peer, like the queue) — so guests and late
       joiners see it too without touching the database.
     - Signed-in people also load the room's saved playlist when they enter (a room you
       reopen later still has it), and each save is stored against the SAVER, so it shows up
       on their profile. Leave the room and you no longer see it — only the saver keeps it.
   One row per (song, saver); the room list shows each song once with everyone who saved it.
   Needs supabase/schema-room-playlist.sql for the database part; without it the room
   playlist still works live, it just isn't remembered.

   Favourites (the ❤ on queue items) are a separate, personal thing — see playlists.js.
   ============================================================ */

const RoomPlaylist = { items: [], onChange: null, reset(){ this.items = []; } };
const RP_MAX_ITEMS = 300;

function rpNotify(){ if (typeof RoomPlaylist.onChange === 'function') RoomPlaylist.onChange(); }
function rpNewId(){
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// Items also arrive from other people's phones — check their shape before they touch the DOM.
function rpValid(it){
  return !!it && isSafeId(it.id) && (it.kind === 'video' || it.kind === 'music') && isValidVideoId(it.videoId)
    && typeof it.title === 'string' && typeof it.savedByName === 'string'
    && (it.savedBy == null || isSafeId(it.savedBy));
}
function rpClean(it){
  return { id: it.id, kind: it.kind, videoId: it.videoId, title: it.title.slice(0, 200),
    savedBy: it.savedBy || null, savedByName: it.savedByName.slice(0, 40) || 'Someone',
    createdAt: Number(it.createdAt) || Date.now() };
}
function rpAdd(it){
  if (!rpValid(it) || RoomPlaylist.items.length >= RP_MAX_ITEMS) return false;
  if (RoomPlaylist.items.some(x => x.id === it.id)) return false;
  RoomPlaylist.items.push(rpClean(it));
  return true;
}
function rpFromRow(r){
  return { id: r.id, kind: r.kind, videoId: r.video_id, title: r.title, savedBy: r.saved_by,
    savedByName: r.saved_by_name || 'Someone', createdAt: Date.parse(r.created_at) || Date.now() };
}

function rpMine(){ return currentUser ? RoomPlaylist.items.filter(i => i.savedBy === currentUser.id) : []; }
// The room list shows each song once, with everyone who saved it
function rpGroups(kind){
  const byVideo = new Map();
  RoomPlaylist.items.filter(i => i.kind === kind).sort((a, b) => a.createdAt - b.createdAt).forEach(i=>{
    if (!byVideo.has(i.videoId)) byVideo.set(i.videoId, { kind, videoId: i.videoId, title: i.title, rows: [] });
    byVideo.get(i.videoId).rows.push(i);
  });
  return [...byVideo.values()];
}
function rpRowMine(group){ return currentUser ? (group.rows.find(r => r.savedBy === currentUser.id) || null) : null; }

// ---------- Database (signed-in people only) ----------
async function rpLoadFromDb(){
  if (!currentUser || !supabaseClient || !roomCode) return;
  try{
    const { data, error } = await supabaseClient.rpc('room_playlist_for', { code: roomCode });
    if (error){ console.warn('Room playlist not loaded (is schema-room-playlist.sql installed?):', error.message); return; }
    let changed = false;
    (data || []).forEach(r=>{ if (rpAdd(rpFromRow(r))) changed = true; });
    if (changed) rpNotify();
  }catch(e){ console.warn('Room playlist load failed:', e); }
}

// 📌 Save — guests are asked to sign up instead (nothing is stored for them)
async function rpSave(kind){
  if (!requireAccount('save songs and videos to the room playlist')) return;
  const c = YTChannels[kind];
  if (!c || !c.currentId){ toast(kind === 'music' ? 'Load a track first' : 'Load a video first'); return; }
  const videoId = c.currentId;
  if (rpMine().some(i => i.kind === kind && i.videoId === videoId)){ toast('You already saved that one 📌'); return; }

  const title = await resolveTitle(kind, videoId);
  const item = { id: rpNewId(), kind, videoId, title, savedBy: currentUser.id, savedByName: myName, createdAt: Date.now() };
  rpAdd(item);
  rpNotify();
  broadcast({ type: 'rplist', action: 'add', item });
  toast('Saved to the room playlist 📌');

  // Also remember it against the saver, so it's on their profile
  const { error } = await supabaseClient.from('room_playlist').insert({
    id: item.id, room_code: roomCode, kind, video_id: videoId, title, saved_by: currentUser.id, saved_by_name: myName
  });
  if (error && error.code !== '23505'){
    console.warn('Could not store the saved item:', error.message);
    toast("Saved for this room, but it couldn't be added to your profile yet");
  }
}

// Remove one of MY saves (from the room list or from my profile)
async function rpRemoveMine(id){
  const it = RoomPlaylist.items.find(i => i.id === id);
  if (it){
    if (!currentUser || it.savedBy !== currentUser.id) return false;
    RoomPlaylist.items = RoomPlaylist.items.filter(i => i.id !== id);
    rpNotify();
    broadcast({ type: 'rplist', action: 'remove', id });
  }
  if (currentUser && supabaseClient){
    const { error } = await supabaseClient.from('room_playlist').delete().eq('id', id);
    if (error){ console.warn('Could not remove the saved item:', error.message); toast("Couldn't remove that right now", 'err'); return false; }
  }
  return true;
}

// My saves across every room, newest first (for the Profile page)
async function rpFetchMine(limit){
  if (!currentUser || !supabaseClient) return [];
  const { data, error } = await supabaseClient.from('room_playlist').select('*')
    .eq('saved_by', currentUser.id).order('created_at', { ascending: false }).limit(limit || 60);
  if (error){ console.warn('Could not load your saved items:', error.message); return []; }
  const rows = data || [];
  const names = {};
  const codes = [...new Set(rows.map(r => r.room_code))];
  if (codes.length){
    try{
      const { data: rooms } = await supabaseClient.from('rooms').select('code,name').in('code', codes);
      (rooms || []).forEach(r => { names[r.code] = r.name; });
    }catch(e){}
  }
  return rows.map(r => ({ ...rpFromRow(r), roomCode: r.room_code, roomName: names[r.room_code] || null }));
}

// ---------- Live sync with the people in the room ----------
registerHandler('rplist', (fromId, data)=>{
  const sender = participants[fromId];
  if (data.action === 'add'){
    const it = data.item;
    if (!rpValid(it)) return;
    if (it.savedBy && (!sender || sender.userId !== it.savedBy)) return;   // you can only add as yourself
    if (rpAdd(it)) rpNotify();
  } else if (data.action === 'remove'){
    const it = RoomPlaylist.items.find(i => i.id === data.id);
    if (!it) return;
    if (it.savedBy && (!sender || sender.userId !== it.savedBy)) return;   // only the saver can remove it
    RoomPlaylist.items = RoomPlaylist.items.filter(i => i.id !== data.id);
    rpNotify();
  } else if (data.action === 'sync'){
    if (!Array.isArray(data.items)) return;
    let changed = false;
    data.items.slice(0, RP_MAX_ITEMS).forEach(it=>{ if (rpAdd(it)) changed = true; });
    if (changed) rpNotify();
  }
});

// Anyone arriving gets the playlist as it stands (guests rely on this — they never read the database)
window.onPeerConnected = (function(prev){
  return function(peerId){
    if (prev) prev(peerId);
    if (RoomPlaylist.items.length) sendData(dataConns[peerId], { type: 'rplist', action: 'sync', items: RoomPlaylist.items });
  };
})(window.onPeerConnected);
