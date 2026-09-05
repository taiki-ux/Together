/* ============================================================

SUPABASE-CLIENT.JS

One shared Supabase client (Auth + Postgres + Realtime).

============================================================ */

let supabaseClient = null;

let currentUser = null;

let myProfile = null; // {id, first_name, last_name, username}

try {

if (!window?.supabase) throw new Error('window.supabase is not available');

supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

window.supabaseClient = supabaseClient;

const { data: authListener } = supabaseClient.auth.onAuthStateChange((event, session) => {

if (event === 'SIGNED_OUT') {

  currentUser = null;

  myProfile = null;

  if (typeof window.onSignedOut === 'function') window.onSignedOut();

  return;

}



currentUser = session?.user ?? null;

if (currentUser) {

  loadMyProfile().catch((err) => console.error('Failed to load profile after auth change:', err));

}

if (typeof window.onAuthChange === 'function') window.onAuthChange(currentUser);

});

} catch (e) {

console.error('Supabase failed to initialize:', e);

}

async function restoreAuthSession() {

if (!supabaseClient) return null;

try {

const { data: { session }, error } = await supabaseClient.auth.getSession();

if (error) {

  console.error('getSession error:', error);

  return null;

}

currentUser = session?.user || null;

if (currentUser) await loadMyProfile();

return currentUser;

} catch (err) {

console.error('Unexpected error in restoreAuthSession:', err);

return null;

}

}

async function loadMyProfile(retries = 5) {

if (!currentUser) { myProfile = null; return null; }

if (!supabaseClient) { myProfile = null; return null; }

try {

const { data, error } = await supabaseClient

  .from('profiles')

  .select('*')

  .eq('id', currentUser.id)

  .single();



if (error) {

  // Profile trigger may not have fired yet

  if ((error.code === 'PGRST116' || error.code === '406') && retries > 0) {

    console.warn(`Profile not found yet, retrying (${retries} left)...`);

    await new Promise(resolve => setTimeout(resolve, 800));

    return loadMyProfile(retries - 1);

  }

  

  // If profile truly doesn't exist after retries, create a minimal one

  if (retries === 0 && error.code === 'PGRST116') {

    console.warn('Creating fallback profile after trigger failed');

    return createFallbackProfile(currentUser);

  }

  

  console.error('Failed to load profile:', error);

  myProfile = null;

  return null;

}



myProfile = data;

return myProfile;

} catch (err) {

console.error('Unexpected error loading profile:', err);

myProfile = null;

return null;

}

}

async function createFallbackProfile(user) {

if (!supabaseClient || !user) return null;

try {

const { data, error } = await supabaseClient

  .from('profiles')

  .insert({

    id: user.id,

    first_name: user.user_metadata?.first_name || '',

    last_name: user.user_metadata?.last_name || '',

    username: user.user_metadata?.username || 'user_' + user.id.substring(0, 8)

  })

  .select()

  .single();



if (error) {

  console.error('Failed to create fallback profile:', error);

  return null;

}



myProfile = data;

return myProfile;

} catch (err) {

console.error('Unexpected error in createFallbackProfile:', err);

return null;

}

}

async function signUpWithProfile({ firstName, lastName, username, email, password }) {

if (!supabaseClient) return { error: { message: "Account service isn't available right now." } };

try {

const result = await supabaseClient.auth.signUp({

  email,

  password,

  options: { 

    data: { 

      first_name: firstName || '', 

      last_name: lastName || '', 

      username: username || 'user_' + Math.random().toString(36).slice(2, 8)

    } 

  }

});



if (result?.error) {

  console.error('Sign-up error:', result.error);

  return result;

}



const session = result?.data?.session;

if (session?.user) {

  currentUser = session.user;

  await loadMyProfile().catch(err => console.error('Failed to load profile after signUp:', err));

}



return result;

} catch (err) {

console.error('Unexpected signUp error:', err);

return { error: err };

}

}

async function signUpWithEmail(email, password) {

if (!supabaseClient) return { error: { message: "Account service isn't available right now." } };

try {

const result = await supabaseClient.auth.signUp({

  email,

  password,

  options: { 

    data: { 

      username: 'user_' + Math.random().toString(36).slice(2, 8),

      first_name: '',

      last_name: ''

    } 

  }

});



if (result?.error) {

  console.error('Sign-up error:', result.error);

  return result;

}



if (result?.data?.session) {

  currentUser = result.data.session.user;

  await loadMyProfile().catch(err => console.error('Failed to load profile after signUp:', err));

}



return result;

} catch (err) {

console.error('Unexpected signUp error:', err);

return { error: err };

}

}

async function signInWithEmail(email, password) {

if (!supabaseClient) return { error: { message: "Account service isn't available right now." } };

try {

const result = await supabaseClient.auth.signInWithPassword({ email, password });



if (result?.error) {

  console.error('Sign-in error:', result.error);

  return result;

}



if (result?.data?.session) {

  currentUser = result.data.session.user;

  await loadMyProfile().catch(err => console.error('Failed to load profile after signIn:', err));

}

return result;

} catch (err) {

console.error('Unexpected signIn error:', err);

return { error: err };

}

}

async function signOutUser() {

if (!supabaseClient) return { error: { message: "Account service isn't available right now." } };

try {

const { error } = await supabaseClient.auth.signOut();

if (error) {

  console.error('Failed to sign out:', error);

  return { error };

}



myProfile = null;

currentUser = null;

return { ok: true };

} catch (err) {

console.error('Unexpected signOut error:', err);

return { error: err };

}

}

// Expose state and functions

window.__supabase = window.__supabase || {};

window.__supabase.client = supabaseClient;

window.__supabase.currentUser = () => currentUser;

window.__supabase.myProfile = () => myProfile;

window.supabaseClient = supabaseClient;

window.restoreAuthSession = restoreAuthSession;

window.loadMyProfile = loadMyProfile;

window.signUpWithProfile = signUpWithProfile;

window.signUpWithEmail = signUpWithEmail;

window.signInWithEmail = signInWithEmail;

window.signOutUser = signOutUser;