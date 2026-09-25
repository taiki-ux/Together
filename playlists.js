/* ============================================================
   PLAYLISTS.JS
   Favorites are per-account. Backed by the `favorites` table.
   Shows real titles + thumbnails (not raw links).
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

async function saveFavorite(kind, title, videoId){
  if (!currentUser){ toast('Log in from Settings to save favorites ⭐'); return; }
  const { data: existing } = await supabaseClient
    .from('favorites').select('id').eq('kind', kind).eq('video_id', videoId).limit(1);
  if (existing && existing.length){ toast('Already in your playlist ⭐'); return; }
  const realTitle = await resolveTitle(kind, videoId);
  const { error } = await supabaseClient.from('favorites').insert({
    user_id: currentUser.id, kind, title: realTitle, video_id: videoId
  });
  if (error){ console.error(error); toast("Couldn't save — try again"); }
  else toast('Saved to your playlist ⭐');
}
async function loadFavorites(kind){
  if (!currentUser || !supabaseClient) return [];
  const { data, error } = await supabaseClient
    .from('favorites').select('*').eq('kind', kind).order('created_at', { ascending:false });
  if (error){ console.error(error); return []; }
  return data || [];
}
async function updateFavoriteTitle(id, title){
  if (!supabaseClient) return;
  try{ await supabaseClient.from('favorites').update({ title }).eq('id', id); }catch(e){}
}
async function deleteFavorite(id){
  if (!supabaseClient) return;
  await supabaseClient.from('favorites').delete().eq('id', id);
}
