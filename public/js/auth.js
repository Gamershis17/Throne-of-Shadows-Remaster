// ============================================================
// auth.js — login / register / guest view wiring.
// ============================================================
import { api } from './api.js?v=20260930ar';
import { sanitizeGuestName, loadGuest, clearGuest } from './guest.js?v=20260930ar';

export const Auth = {
  onAuthed: null,
  onGuest: null,

  init({ onAuthed, onGuest }) {
    this.onAuthed = onAuthed;
    this.onGuest = onGuest;
    // Idempotent: boot() binds the form immediately (the auth screen renders
    // from static HTML before the server gate finishes) and showAuthView()
    // binds again once the gate completes.
    if (this._bound) return;
    this._bound = true;

    // Null-safe DOM helpers: a missing auth node must degrade to an unwired
    // (but non-crashing) screen — a throw here bricks login entirely.
    const $id = (id) => document.getElementById(id) || null;
    const val = (id) => { const el = $id(id); return el ? String(el.value || '') : ''; };
    const on = (id, evt, fn) => { const el = $id(id); if (el) el.addEventListener(evt, fn); };

    const tabLogin = $id('auth-tab-login');
    const tabRegister = $id('auth-tab-register');
    const loginForm = $id('login-form');
    const registerForm = $id('register-form');
    const errBox = $id('auth-error');

    const showError = (msg) => {
      if (!errBox) return;
      errBox.textContent = msg || '';
      errBox.classList.toggle('hidden', !msg);
    };
    const setBusy = (busy) => {
      for (const b of document.querySelectorAll('.auth-form button[type="submit"]')) {
        b.disabled = busy;
        b.classList.toggle('busy', busy);
      }
    };

    const switchTab = (which) => {
      const isLogin = which === 'login';
      if (tabLogin) tabLogin.classList.toggle('active', isLogin);
      if (tabRegister) tabRegister.classList.toggle('active', !isLogin);
      if (loginForm) loginForm.classList.toggle('hidden', !isLogin);
      if (registerForm) registerForm.classList.toggle('hidden', isLogin);
      showError('');
    };
    on('auth-tab-login', 'click', () => switchTab('login'));
    on('auth-tab-register', 'click', () => switchTab('register'));

    if (loginForm) loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      showError('');
      const username = val('login-username').trim();
      const password = val('login-password');
      if (!username || !password) return showError('Enter your username and password.');
      setBusy(true);
      try {
        const { user } = await api.login(username, password);
        this.onAuthed && this.onAuthed(user);
      } catch (err) {
        showError(err.message || 'Login failed.');
      } finally {
        setBusy(false);
      }
    });

    if (registerForm) registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      showError('');
      const username = val('reg-username').trim();
      const password = val('reg-password');
      const confirm = val('reg-password2');
      if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
        return showError('Username: 3–20 chars, letters/numbers/underscore.');
      }
      if (password.length < 8) return showError('Password must be at least 8 characters.');
      if (password !== confirm) return showError('Passwords do not match.');
      setBusy(true);
      try {
        const { user } = await api.register(username, password);
        this.onAuthed && this.onAuthed(user);
      } catch (err) {
        showError(err.message || 'Registration failed.');
      } finally {
        setBusy(false);
      }
    });

    // ---------------- guest mode ----------------
    // Guests play locally with no account: zero server calls.
    const guestNameInput = $id('guest-name');
    const guestStart = $id('guest-start');
    const guestContinue = $id('guest-continue');
    const startGuest = (name) => {
      this.onGuest && this.onGuest(sanitizeGuestName(name));
    };
    const existing = loadGuest();
    if (existing) {
      const contName = $id('guest-continue-name');
      if (contName) contName.textContent = existing.name;
      if (guestContinue) guestContinue.classList.remove('hidden');
      if (guestStart) guestStart.classList.add('hidden');
      on('guest-continue-btn', 'click', () => {
        startGuest(existing.name);
      });
      on('guest-fresh-btn', 'click', () => {
        clearGuest();
        if (guestContinue) guestContinue.classList.add('hidden');
        if (guestStart) guestStart.classList.remove('hidden');
      });
    }
    on('guest-play-btn', 'click', () => {
      startGuest(guestNameInput ? guestNameInput.value : '');
    });
    if (guestNameInput) guestNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') startGuest(guestNameInput.value);
    });
  },
};
