// public/login.js
import wsClient from './ws-client.js';

const signinEmail = document.getElementById('signinUsername');
const signinPassword = document.getElementById('signinPassword');
const btnSignin = document.getElementById('btnSignin');
const signinStatus = document.getElementById('signinStatus');

const signupEmail = document.getElementById('signupUsername');
const signupPassword = document.getElementById('signupPassword');
const signupDisplay = document.getElementById('signupDisplay');
const btnSignup = document.getElementById('btnSignup');
const signupStatus = document.getElementById('signupStatus');

const tokenPreview = document.getElementById('tokenPreview');
const btnClearToken = document.getElementById('btnClearToken');
const logEl = document.getElementById('log');

function log(msg) { if (logEl) logEl.textContent = new Date().toLocaleTimeString() + ' ' + msg + '\n' + logEl.textContent; }
function setSigninStatus(msg, ok) { if (!signinStatus) return; signinStatus.textContent = msg; signinStatus.className = ok ? 'status good' : 'status bad'; }
function setSignupStatus(msg, ok) { if (!signupStatus) return; signupStatus.textContent = msg; signupStatus.className = ok ? 'status good' : 'status bad'; }
function setToken() { if (!tokenPreview) return; tokenPreview.textContent = wsClient.getToken() ? wsClient.getToken().slice(0,12)+'…' : 'none'; }

(async function init() {
  // Connect (this will auto-send a stored token if present)
  await wsClient.connect();
  setToken();

  // Optional: listen for global auth.ok event and redirect to lobby
  wsClient.on('auth.ok', (msg) => {
    log('Authenticated: ' + (msg.account?.displayName || msg.account?.username));
    setSigninStatus('Signed in as ' + (msg.account?.displayName || msg.account?.username), true);
    setSignupStatus('Signed in as ' + (msg.account?.displayName || msg.account?.username), true);
    // always redirect on auth.ok (auto-auth now returns to lobby)
    window.location.href = '/lobby.html';
  });

  wsClient.on('auth.fail', (msg) => {
    log('Auth failed: ' + (msg.reason || 'unknown'));
    if (msg.reason === 'invalid_or_expired') {
      localStorage.removeItem('sessionToken');
      setToken();
    }
  });

  btnSignin?.addEventListener('click', async () => {
    const username = (signinEmail?.value || '').trim();
    const password = signinPassword?.value || '';
    if (!username || !password) { setSigninStatus('username & password required', false); return; }
    setSigninStatus('Signing in...', null);
    const res = await wsClient.signin(username, password);
    if (res.ok) {
      setToken();
      setSigninStatus('Signed in', true);
      // auth.ok handler will redirect
    } else {
      setSigninStatus('Sign in failed: ' + (res.reason || 'error'), false);
    }
  });

  btnSigninClear?.addEventListener('click', () => {
    if (signinEmail) signinEmail.value = '';
    if (signinPassword) signinPassword.value = '';
    if (signinStatus) {
      signinStatus.textContent = '';
      signinStatus.className = 'status';
    }
  });

  btnSignup?.addEventListener('click', async () => {
    const username = (signupEmail?.value || '').trim();
    const password = signupPassword?.value || '';
    const display = (signupDisplay?.value || '').trim() || undefined;
    if (!username || !password) { setSignupStatus('username & password required', false); return; }
    if (!/^[A-Za-z0-9]+$/.test(username)) { setSignupStatus('Username must be alphanumeric only', false); return; }
    setSignupStatus('Creating account...', null);
    const res = await wsClient.signup(username, password, display);
    if (res.ok) {
      setToken();
      setSignupStatus('Account created', true);
      // auth.ok handler will redirect
    } else {
      setSignupStatus('Sign up failed: ' + (res.reason || 'error'), false);
    }
  });

  btnSignupClear?.addEventListener('click', () => {
    if (signupEmail) signupEmail.value = '';
    if (signupPassword) signupPassword.value = '';
    if (signupDisplay) signupDisplay.value = '';
    if (signupStatus) {
      signupStatus.textContent = '';
      signupStatus.className = 'status';
    }
  });

  btnClearToken?.addEventListener('click', () => {
    wsClient.logout();
    setToken();
    log('Cleared token');
  });
})();