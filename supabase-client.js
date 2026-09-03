/* ============================================================
   SUPABASE-CLIENT.JS
   One shared Supabase client (Auth + Postgres + Realtime).
   Improvements:
   - Properly handle auth state changes (SIGNED_IN, SIGNED_OUT, token refreshes)
   - Normalize RPC results for username availability
   - Add try/catch and consistent logging for network calls
   - Ensure local state (currentUser / myProfile) is updated where appropriate
   - Keep window.supabaseClient for backward compatibility (used by peer-manager.js)
   ============================================================ */

let supabaseClient = null;
let currentUser = null;
let myProfile = null; // {id, first_name, last_name, username}

try {
  if (!window?.supabase) throw new Error('window.supabase is not available');
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  // Expose client for other legacy code that relies on a global (peer-manager.js)
  window.supabaseClient = supabaseClient;

  // Keep a reference to the listener so it can be removed if necessary later
  const { data: authListener } = supabaseClient.auth.onAuthStateChange((event, session) => {
    // Handle sign-out explicitly
    if (event === 'SIGNED_OUT') {
      currentUser = null;
      myProfile = null;
      if (typeof window.onSignedOut === 'function') window.onSignedOut();
      return;
    }

    // For SIGNED_IN, TOKEN_REFRESHED, USER_UPDATED, etc. update local state.
    // The callback may be called in various situations; use provided session when available.
    currentUser = session?.user ?? null;
    if (currentUser) {
      // don't await inside the handler (listener is sync); kick off profile load
      loadMyProfile().catch((err) => console.error('Failed to load profile after auth change:', err));
    }
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

async function loadMyProfile() {
  if (!currentUser) { myProfile = null; return null; }
  if (!supabaseClient) { myProfile = null; return null; }
  try {
    const { data, error } = await supabaseClient
      .from('profiles')
      .select('*')
      .eq('id', currentUser.id)
      .single();

    if (error) {
      // When using .single(), a 406 or 404 may indicate not found
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

/**
 * Normalize various possible RPC return shapes to a boolean "available".
 * The username_available RPC is expected to return a boolean (true when available).
 * We defensively handle scalar booleans, single-row arrays, or objects.
 */
function _normalizeRpcBoolean(data) {
  if (data === null || data === undefined) return null;
  if (typeof data === 'boolean') return data;
  if (Array.isArray(data) && data.length > 0) {
    const v = data[0];
    if (typeof v === 'boolean') return v;
    if (typeof v === 'object' && v !== null) {
      // pick first boolean-like property if present
      for (const key of Object.keys(v)) {
        if (typeof v[key] === 'boolean') return v[key];
      }
    }
  }
  if (typeof data === 'object') {
    for (const key of Object.keys(data)) {
      if (typeof data[key] === 'boolean') return data[key];
    }
  }
  return null; // unknown shape
}

async function isUsernameTaken(username) {
  if (!supabaseClient) return false; // fail open; DB constraint is the final guard
  try {
    const { data, error } = await supabaseClient.rpc('username_available', { check_username: username });
    if (error) {
      console.error('username_available rpc error:', error);
      return false; // fail open
    }

    const available = _normalizeRpcBoolean(data);
    if (available === null) {
      // unexpected shape; log and fail open
      console.warn('username_available returned unexpected shape:', data);
      return false;
    }

    // return true when the username is taken
    return available === false;
  } catch (err) {
    console.error('Unexpected error in isUsernameTaken:', err);
    return false; // fail open
  }
}

async function signUpWithProfile({ firstName, lastName, username, email, password }) {
  if (!supabaseClient) return { error: { message: "Account service isn't available right now." } };
  try {
    const result = await supabaseClient.auth.signUp({
      email,
      password,
      options: { data: { first_name: firstName, last_name: lastName, username } }
    });

    // If Supabase returned a session, update local state
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

async function signInWithEmail(email, password) {
  if (!supabaseClient) return { error: { message: "Account service isn't available right now." } };
  try {
    const result = await supabaseClient.auth.signInWithPassword({ email, password });
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
      // Do NOT clear local state if signOut failed to avoid hiding the real auth state.
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

// Expose state and functions for other modules / UI code that expect globals.
window.__supabase = window.__supabase || {};
window.__supabase.client = supabaseClient;
window.__supabase.currentUser = () => currentUser;
window.__supabase.myProfile = () => myProfile;

// Keep existing global names for compatibility
window.supabaseClient = supabaseClient;
window.restoreAuthSession = restoreAuthSession;
window.loadMyProfile = loadMyProfile;
window.isUsernameTaken = isUsernameTaken;
window.signUpWithProfile = signUpWithProfile;
window.signInWithEmail = signInWithEmail;
window.signOutUser = signOutUser;
