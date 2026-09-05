/* ============================================================

PLAYLISTS.JS

Favorites are per-account (needs sign-in from Settings). Backed

by the favorites table — see supabase/schema.sql for the

table + Row Level Security policy that keeps everyone's list

private to them.

============================================================ */

async function saveFavorite(kind, title, videoId){

if (!currentUser){ toast('Log in from Settings to save favorites ⭐'); return; }

const { error } = await supabaseClient.from('favorites').insert({

user_id: currentUser.id, kind, title, video_id: videoId

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

async function deleteFavorite(id){

if (!supabaseClient) return;

await supabaseClient.from('favorites').delete().eq('id', id);

}