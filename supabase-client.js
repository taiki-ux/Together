/* ============================================================
   SUPABASE-CLIENT.JS
   One shared Supabase client (Auth + Postgres + Realtime).
   ============================================================ */

// A password-reset email link lands here with a login token in the URL. Note that now (before
// supabase-js tidies the URL) so the app can show "choose a new password" instead of logging
// the person straight in. An expired/used link comes back with error_code in the URL instead.
window.__recoveryPending = /[#&]type=recovery(&|$)/.test(location.hash);
if (/[#&]error_code=/.test(location.hash)){
  window.__authLinkError = true;
  try{ history.replaceState(null, '', location.pathname + location.search); }catch(e){}
}

let supabaseClient = null;
let currentUser = null;
let myProfile = null; // {id, first_name, last_name, username}

try {
  if (!window?.supabase) throw new Error('window.supabase is not available');
function createSafeStorage(){
  try{
    const testKey = '__together_storage_test__';
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    return window.localStorage;
  }catch(e){
    console.warn('localStorage is blocked (tracking prevention?) — sessions will only last this tab, you\'ll need to log in again after closing it.');
    const mem = {};
    return {
      getItem: (k)=> (k in mem ? mem[k] : null),
      setItem: (k,v)=> { mem[k]=v; },
      removeItem: (k)=> { delete mem[k]; }
    };
  }
}
supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storage: createSafeStorage(), persistSession: true, autoRefreshToken: true }
});
  window.supabaseClient = supabaseClient;

supabaseClient.auth.onAuthStateChange(async (event, session) => {
     if (event === 'SIGNED_OUT') {
          currentUser = null;
          myProfile = null;
          if (typeof window.onSignedOut === 'function') window.onSignedOut();
          return;
}   
currentUser = session?.user ?? null;   
if (currentUser) {
       try{ await loadMyProfile(); }
        catch(err){ console.error('Failed to load profile after auth change:', err); }
         }
if (event === 'PASSWORD_RECOVERY'){            // they followed a reset link: ask for a new password first
  window.__recoveryPending = true;
  if (typeof window.onPasswordRecovery === 'function') window.onPasswordRecovery();
  return;
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

// Asks the database whether a nickname is free (needs supabase/schema-username.sql).
// Returns true / false, or null when it can't tell (function not installed, offline) —
// callers treat null as "don't block", and the database's own unique rule still protects us.
async function checkUsernameAvailable(username) {
  if (!supabaseClient) return null;
  try {
    const { data, error } = await supabaseClient.rpc('username_available', { name: username });
    if (error) return null;
    return data === true;
  } catch (err) {
    return null;
  }
}

// Sends the reset email. Supabase answers the same whether or not the address has an account
// (so nobody can use this to find out who's registered). The link must point back at an
// address on the Redirect URLs list in Supabase -> Authentication -> URL Configuration.
async function requestPasswordReset(email) {
  if (!supabaseClient) return { error: { message: "Account service isn't available right now." } };
  try {
    return await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  } catch (err) {
    console.error('Unexpected password-reset error:', err);
    return { error: err };
  }
}

// Used on the "choose a new password" screen (the reset link has already signed them in).
async function setNewPassword(password) {
  if (!supabaseClient) return { error: { message: "Account service isn't available right now." } };
  try {
    return await supabaseClient.auth.updateUser({ password });
  } catch (err) {
    console.error('Unexpected update-password error:', err);
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
window.supabaseClient = supabaseClient;
window.restoreAuthSession = restoreAuthSession;
window.loadMyProfile = loadMyProfile;
window.signUpWithProfile = signUpWithProfile;
window.signInWithEmail = signInWithEmail;
window.requestPasswordReset = requestPasswordReset;
window.setNewPassword = setNewPassword;
window.checkUsernameAvailable = checkUsernameAvailable;
window.signOutUser = signOutUser;