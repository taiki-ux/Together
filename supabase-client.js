/* ============================================================
   SUPABASE-CLIENT.JS
   One shared Supabase client (Auth + Postgres + Realtime).
   Step 1: accounts are mandatory — myName comes from the signed-in
   profile's nickname, not a typed field on the landing screen.
   ============================================================ */

let supabaseClient = null;
let currentUser = null;
let myProfile = null; // {id, first_name, last_name, username}

try{
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  window.supabaseClient = supabaseClient; // used by peer-manager.js's presence discovery
  supabaseClient.auth.onAuthStateChange((event)=>{
    if (event === 'SIGNED_OUT'){
      currentUser = null; myProfile = null;
      if (window.onSignedOut) window.onSignedOut();
    }
  });
}catch(e){
  console.error('Supabase failed to initialize:', e);
}

async function restoreAuthSession(){
  if (!supabaseClient) return null;
  const { data:{session} } = await supabaseClient.auth.getSession();
  currentUser = session?.user || null;
  if (currentUser) await loadMyProfile();
  return currentUser;
}

async function loadMyProfile(){
  if (!currentUser){ myProfile = null; return null; }
  const { data, error } = await supabaseClient.from('profiles').select('*').eq('id', currentUser.id).single();
  if (error){ console.error('Failed to load profile:', error); myProfile = null; return null; }
  myProfile = data;
  return myProfile;
}

async function isUsernameTaken(username){
  if (!supabaseClient) return false;
  const { data, error } = await supabaseClient.rpc('username_available', { check_username: username });
  if (error){ console.error(error); return false; } // fail open — the DB unique constraint is the real guarantee
  return data === false;
}

async function signUpWithProfile({ firstName, lastName, username, email, password }){
  if (!supabaseClient) return { error:{ message:"Account service isn't available right now." } };
  return supabaseClient.auth.signUp({
    email, password,
    options: { data: { first_name: firstName, last_name: lastName, username } }
  });
}

async function signInWithEmail(email, password){
  if (!supabaseClient) return { error:{ message:"Account service isn't available right now." } };
  const result = await supabaseClient.auth.signInWithPassword({ email, password });
  if (result.data?.session){ currentUser = result.data.session.user; await loadMyProfile(); }
  return result;
}

async function signOutUser(){
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
  myProfile = null; currentUser = null;
}
