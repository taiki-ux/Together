/* ============================================================
   PLAYLISTS.JS — Favourites + video title helpers

   ❤ Favourites are personal and permanent: tap the heart under any video or song in the
   queue and it's saved to YOUR account (`favorites` table) and shown on your profile.
   They are NOT the room playlist (📌 — see room-playlist.js), which belongs to a room.

   Guests can't save favourites (they're asked to sign up instead). Everyone signed in can
   see each other's favourites on profiles — see supabase/schema-favourites.sql.
   ============================================================ */

const titleCache = {};

function thumbUrl(videoId){ return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`; }
function isUrlish(t){ return !t || /^https?:\/\//i.test(t) || /^www\./i.test(t) || /youtu\.?be/i.test(t); }

async function fetchVideoTitle(videoId){
  if (titleCache[videoId]) return titleCache[videoId];
  try{
    const url = 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + videoId);
    const res = await withTimeout(fetch(url), 6000, 'Title lookup timed out');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    if (j.title){ titleCache[videoId] = j.title; return j.title; }
  }catch(e){ console.warn('Could not fetch title for', videoId, e.message); }
  return null;
}

// Prefer the title the player already knows; fall back to a lookup.
async function resolveTitle(kind, videoId){
  try{
    const ch = YTChannels[kind];
    if (ch && ch.player && ch.currentId === videoId && ch.player.getVideoData){
      const t = ch.player.getVideoData().title;
      if (t) return t;
    }
  }catch(e){}
  return (await fetchVideoTitle(videoId)) || 'YouTube video';
}

// ---------- My favourites ----------
const Favourites = { rows: [], onChange: null };
const favBusy = new Set();       // one tap at a time per video, so a double-tap can't save twice

function favNotify(){ if (typeof Favourites.onChange === 'function') Favourites.onChange(); }
function isFavourite(kind, videoId){ return Favourites.rows.some(r => r.kind === kind && r.video_id === videoId); }

// Loaded when a signed-in person enters a room, so the hearts in the queue show the right state
async function loadMyFavourites(){
  if (!currentUser || !supabaseClient) return;
  const { data, error } = await supabaseClient.from('favorites').select('*')
    .eq('user_id', currentUser.id).order('created_at', { ascending:false });
  if (error){ console.warn('Could not load favourites:', error.message); return; }
  Favourites.rows = data || [];
  favNotify();
}

// Anyone's favourites (for a profile). Needs schema-favourites.sql to read other people's.
async function fetchFavouritesFor(userId, limit){
  if (!supabaseClient || !userId) return [];
  const { data, error } = await supabaseClient.from('favorites').select('*')
    .eq('user_id', userId).order('created_at', { ascending:false }).limit(limit || 40);
  if (error){ console.warn('Could not load favourites:', error.message); return []; }
  return data || [];
}

// The heart: add or remove. The heart changes instantly; the database catches up (and is undone on failure).
async function toggleFavourite(kind, videoId, title){
  if (!requireAccount('save favourites')) return;
  if (!isValidVideoId(videoId)) return;
  const key = kind + ':' + videoId;
  if (favBusy.has(key)) return;
  favBusy.add(key);
  try{
    const existing = Favourites.rows.find(r => r.kind === kind && r.video_id === videoId);
    if (existing){
      Favourites.rows = Favourites.rows.filter(r => r !== existing);
      favNotify();
      const { error } = await supabaseClient.from('favorites').delete().eq('id', existing.id);
      if (error){
        Favourites.rows.unshift(existing); favNotify();
        console.warn('Could not remove favourite:', error.message);
        toast("Couldn't remove that favourite — try again", 'err');
      } else toast('Removed from your favourites');
      return;
    }
    const pending = { id: null, user_id: currentUser.id, kind, video_id: videoId,
      title: isUrlish(title) ? 'Saving…' : title, created_at: new Date().toISOString() };
    Favourites.rows.unshift(pending);
    favNotify();
    const realTitle = isUrlish(title) ? await resolveTitle(kind, videoId) : title;
    const { data, error } = await supabaseClient.from('favorites')
      .insert({ user_id: currentUser.id, kind, title: realTitle, video_id: videoId }).select().single();
    if (error && error.code === '23505'){          // already saved (e.g. on another device) — just sync up
      Favourites.rows = Favourites.rows.filter(r => r !== pending);
      await loadMyFavourites();
      toast('Already in your favourites ❤️');
    } else if (error){
      Favourites.rows = Favourites.rows.filter(r => r !== pending); favNotify();
      console.warn('Could not save favourite:', error.message);
      toast("Couldn't save that favourite — try again", 'err');
    } else {
      Object.assign(pending, data);
      favNotify();
      toast('Added to your favourites ❤️');
    }
  }finally{
    favBusy.delete(key);
  }
}

async function removeFavouriteById(id){
  if (!supabaseClient || !currentUser) return false;
  const { error } = await supabaseClient.from('favorites').delete().eq('id', id);
  if (error){ console.warn('Could not remove favourite:', error.message); toast("Couldn't remove that right now", 'err'); return false; }
  Favourites.rows = Favourites.rows.filter(r => r.id !== id);
  favNotify();
  return true;
}
async function updateFavouriteTitle(id, title){
  if (!supabaseClient) return;
  try{ await supabaseClient.from('favorites').update({ title }).eq('id', id); }catch(e){}
}
