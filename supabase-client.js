/* ============================================================
   SUPABASE-CLIENT.JS
   One shared Supabase client (Auth + Postgres + Realtime). Auth
   is optional — the app works anonymously for room/voice/video/
   games exactly as before. Signing in only unlocks playlists.
   ============================================================ */

let supabaseClient = null;
let currentUser = null;

try{
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  window.supabaseClient = supabaseClient; // used by peer-manager.js's presence discovery
  supabaseClient.auth.onAuthStateChange((event, session)=>{
    currentUser = session?.user || null;
    if (window.onAuthChange) window.onAuthChange(currentUser);
  });
}catch(e){
  console.error('Supabase failed to initialize:', e);
}

async function restoreAuthSession(){
  if (!supabaseClient) return null;
  const { data:{session} } = await supabaseClient.auth.getSession();
  currentUser = session?.user || null;
  return currentUser;
}
async function signUpWithEmail(email, password){
  if (!supabaseClient) return { error:{message:"Account service isn't available right now."} };
  return supabaseClient.auth.signUp({ email, password });
}
async function signInWithEmail(email, password){
  if (!supabaseClient) return { error:{message:"Account service isn't available right now."} };
  return supabaseClient.auth.signInWithPassword({ email, password });
}
async function signOutUser(){
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
}
