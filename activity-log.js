/* ============================================================
   ACTIVITY-LOG.JS
   Records what you actually watch/listen to in Together, so a
   later Profile page can show "recently played" and favorites
   without you typing anything in yourself (Phase 3 of 5 leading
   up to Profile).

   Hooks into the same onChannelLoading signal the UI already uses
   for the "Loading…" title / placeholder-hiding — that fires once
   per genuine new video/track load, not on drift-correction
   heartbeats, so normal playback doesn't spam duplicate rows.

   Only runs for signed-in users (needs supabase-client.js's
   currentUser) — nothing is tracked for guests, since there'd be
   no account to attach it to.

   Needs the `activity_log` table — see
   supabase/schema-activity-log.sql for the one-time setup.
   ============================================================ */

async function logActivity(kind, videoId, title){
  if (!currentUser || !supabaseClient) return;
  try{
    const { error } = await supabaseClient.from('activity_log').insert({
      user_id: currentUser.id, kind, video_id: videoId, title, room_code: roomCode || null
    });
    if (error) console.error('Failed to log activity:', error);
  }catch(e){
    console.error('Unexpected error logging activity:', e);
  }
}

window.onChannelLoading = (function(prev){
  return function(ch, videoId){
    if (prev) prev(ch, videoId);
    // The queue always carries the human-readable title for whatever's
    // currently loading (Phase 2) — fall back to the raw id if it's
    // somehow not there yet (e.g. state arrived before the queue sync did).
    const q = (typeof MediaQueues !== 'undefined') ? MediaQueues[ch] : null;
    const title = (q && q.items[0] && q.items[0].videoId === videoId) ? q.items[0].title : videoId;
    logActivity(ch, videoId, title);
  };
})(window.onChannelLoading);

// ---------- Read helpers (for the upcoming Profile page) ----------
async function fetchRecentActivity(kind, limit){
  if (!currentUser || !supabaseClient) return [];
  const { data, error } = await supabaseClient
    .from('activity_log').select('*')
    .eq('user_id', currentUser.id)
    .eq('kind', kind)
    .order('created_at', { ascending:false })
    .limit(limit || 10);
  if (error){ console.error('Failed to fetch recent activity:', error); return []; }
  return data || [];
}

// Same as above, but for someone else's profile (any signed-in user's
// activity is readable — see the RLS policy in the schema file).
async function fetchRecentActivityFor(userId, kind, limit){
  if (!supabaseClient) return [];
  const { data, error } = await supabaseClient
    .from('activity_log').select('*')
    .eq('user_id', userId)
    .eq('kind', kind)
    .order('created_at', { ascending:false })
    .limit(limit || 10);
  if (error){ console.error('Failed to fetch activity:', error); return []; }
  return data || [];
}

// "Favorites" = most-played, aggregated client-side over a recent window.
// Plenty for a friends-scale app — no need for a dedicated SQL view just
// to count rows.
async function fetchTopPlayedFor(userId, kind, limit){
  if (!supabaseClient) return [];
  const { data, error } = await supabaseClient
    .from('activity_log').select('video_id,title')
    .eq('user_id', userId).eq('kind', kind)
    .order('created_at', { ascending:false })
    .limit(200);
  if (error){ console.error('Failed to fetch top played:', error); return []; }
  const counts = {};
  (data || []).forEach(row=>{
    if (!counts[row.video_id]) counts[row.video_id] = { video_id:row.video_id, title:row.title, count:0 };
    counts[row.video_id].count++;
  });
  return Object.values(counts).sort((a,b)=> b.count - a.count).slice(0, limit || 5);
}
