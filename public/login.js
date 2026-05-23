// public/login.js
import wsClient from './ws-client.js';

const signinEmail = document.getElementById('signinEmail');
const signinPassword = document.getElementById('signinPassword');
const btnSignin = document.getElementById('btnSignin');
const signinStatus = document.getElementById('signinStatus');

const signupEmail = document.getElementById('signupEmail');
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

  // Optional: listen for global auth.ok event to redirect
  wsClient.on('auth.ok', (msg) => {
    log('Authenticated: ' + (msg.account?.displayName || msg.account?.email));
    // redirect to lobby
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
    const email = (signinEmail?.value || '').trim();
    const password = signinPassword?.value || '';
    if (!email || !password) { setSigninStatus('email & password required', false); return; }
    setSigninStatus('Signing in...', null);
    const res = await wsClient.signin(email, password);
    if (res.ok) {
      setToken();
      setSigninStatus('Signed in', true);
      // auth.ok handler will redirect
    } else {
      setSigninStatus('Sign in failed: ' + (res.reason || 'error'), false);
    }
  });

  btnSignup?.addEventListener('click', async () => {
    const email = (signupEmail?.value || '').trim();
    const password = signupPassword?.value || '';
    const display = (signupDisplay?.value || '').trim() || undefined;
    if (!email || !password) { setSignupStatus('email & password required', false); return; }
    setSignupStatus('Creating account...', null);
    const res = await wsClient.signup(email, password, display);
    if (res.ok) {
      setToken();
      setSignupStatus('Account created', true);
      // auth.ok handler will redirect
    } else {
      setSignupStatus('Sign up failed: ' + (res.reason || 'error'), false);
    }
  });

  btnClearToken?.addEventListener('click', () => {
    wsClient.logout();
    setToken();
    log('Cleared token');
  });
})();