// kagoul-auth.js
// Module auth pour Kagoul — même DB que Taktik, table k_profiles dédiée.
// Demande pseudo + date de naissance. Bloque les utilisateurs de moins de 18 ans.
// Usage: <script type="module" src="./kagoul-auth.js"></script>

// === DEBUG FLAG ===
const dbg = true;
function dbgAlert(label, obj) {
  if (!dbg) return;
  try {
    const safe = JSON.stringify(obj, (k, v) => {
      if (!k) return v;
      if (/access|refresh|token|secret|password|credentials|session/i.test(k)) return '[REDACTED]';
      return v;
    }, 2);
    console.info(`${label}:\n`, safe);
  } catch (e) {
    try { console.info(`${label}: ${String(obj)}`); } catch (e2) { /* ignore */ }
  }
}

// === URL DE REDIRECTION PAR DÉFAUT ===
const KAGOUL_HOME = 'https://kagoul.netlify.app';
const DEFAULT_REDIRECT = KAGOUL_HOME;

// Prefer local supabaseClient.js export, else window.supabase if present
async function getSupabase() {
  try {
    const mod = await import('./scripts/supabaseClient.js');
    if (mod && mod.supabase) {
      dbgAlert('getSupabase - imported module', { hasSupabase: true });
      return mod.supabase;
    }
  } catch (e) {
    try {
      const mod2 = await import('./supabaseClient.js');
      if (mod2 && mod2.supabase) return mod2.supabase;
    } catch (e2) {
      dbgAlert('getSupabase import failed', { error: String(e2) });
    }
  }
  if (typeof window !== 'undefined' && window.supabase) {
    dbgAlert('getSupabase - window.supabase used', { origin: window.location.origin });
    return window.supabase;
  }
  throw new Error('Supabase client introuvable. Ajoute supabaseClient.js ou expose window.supabase.');
}

function getReturnTo() {
  const url = new URL(window.location.href);
  const p   = url.searchParams.get('redirectTo') || url.searchParams.get('returnTo');

  const normalizeTarget = (raw) => {
    if (!raw) return null;
    try {
      const t     = new URL(raw, window.location.origin);
      const lower = (t.pathname || '').toLowerCase();
      if (lower.includes('login') || lower.includes('signin')) return KAGOUL_HOME;
      const allowedOrigins = [window.location.origin, 'https://kagoul.netlify.app'];
      if (allowedOrigins.includes(t.origin)) return t.href;
    } catch (e) {
      if (/login|signin/i.test(raw)) return KAGOUL_HOME;
      return raw;
    }
    return null;
  };

  const fromQuery = normalizeTarget(p);
  if (fromQuery) return fromQuery;
  return KAGOUL_HOME;
}

function showMessage(el, msg, isError = false) {
  if (!el) { alert(msg); return; }
  el.textContent = msg;
  el.style.color = isError ? '#ef4444' : '';
}

/* -------------------------
   ONLINE STATUS — k_profiles
   ------------------------- */
async function setOnlineStatus(supabase, userId, isOnline) {
  if (!supabase || !userId) return;
  try {
    const { error } = await supabase
      .from('k_profiles')
      .update({ is_online: isOnline })
      .eq('user_id', userId);
    if (error) {
      dbgAlert('setOnlineStatus - error', { isOnline, error });
    } else {
      dbgAlert('setOnlineStatus - ok', { userId, isOnline });
    }
  } catch (e) {
    dbgAlert('setOnlineStatus - exception', String(e));
  }
}

/* -------------------------
   HELPERS PSEUDO + DOB
   ------------------------- */
function sanitizePseudo(s) {
  if (!s) return '';
  return s.trim();
}

function isPseudoValid(s) {
  if (!s) return false;
  return s.length >= 3 && s.length <= 32 && /^[\w.\-]+$/.test(s);
}

/**
 * Retourne true si l'utilisateur a au moins 18 ans révolus.
 */
function isAtLeast18(dobString) {
  if (!dobString) return false;
  const dob = new Date(dobString);
  if (isNaN(dob.getTime())) return false;
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 18);
  return dob <= cutoff;
}

/* -------------------------
   MODAL PSEUDO + DOB (Kagoul)
   ------------------------- */
function createKagoulProfileModal() {
  const overlay = document.createElement('div');
  overlay.id = 'kagoulProfileModalOverlay';
  overlay.style = `
    position:fixed; inset:0; display:flex; align-items:center; justify-content:center;
    background:rgba(0,0,0,0.55); z-index:99999; padding:20px;
  `;

  const box = document.createElement('div');
  box.style = `
    width:100%; max-width:420px; background:#ffffff;
    border:1px solid #e6e9ee; color:#0b1220; border-radius:12px; padding:24px;
    box-shadow:0 10px 40px rgba(2,6,23,0.20); font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;
  `;

  box.innerHTML = `
    <h3 style="margin:0 0 6px 0; font-size:18px; font-weight:700; color:#0b1220;">
      Bienvenue sur Kagoul
    </h3>
    <p style="margin:0 0 18px 0; color:#64748b; font-size:13px;">
      Crée ton profil. Tu dois avoir au moins <strong>18 ans</strong> pour accéder à la plateforme.
    </p>

    <label style="display:block; font-size:13px; font-weight:600; color:#334155; margin-bottom:6px;">
      Pseudo
    </label>
    <input id="kPseudoInput" type="text" maxlength="32" placeholder="ex: ton_pseudo"
      style="width:100%; padding:10px; border-radius:8px; border:1px solid #e6e9ee;
             background:#f7f9fc; color:#0b1220; box-sizing:border-box; font-size:14px;" />

    <label style="display:block; font-size:13px; font-weight:600; color:#334155; margin-top:14px; margin-bottom:6px;">
      Date de naissance
    </label>
    <input id="kDobInput" type="date" max=""
      style="width:100%; padding:10px; border-radius:8px; border:1px solid #e6e9ee;
             background:#f7f9fc; color:#0b1220; box-sizing:border-box; font-size:14px;" />

    <div id="kProfileMsg" style="min-height:20px; margin-top:10px; font-size:13px; color:#ef4444;"></div>

    <div style="display:flex; gap:8px; margin-top:16px; justify-content:flex-end;">
      <button id="kProfileCancel"
        style="padding:8px 14px; border-radius:8px; background:#f7f9fc;
               border:1px solid #e6e9ee; color:#475569; font-size:14px; cursor:pointer;">
        Annuler
      </button>
      <button id="kProfileSave"
        style="padding:8px 20px; border-radius:8px; background:#7c3aed;
               border:none; color:#ffffff; font-weight:600; font-size:14px; cursor:pointer;">
        Continuer
      </button>
    </div>
  `;

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const dobInput = box.querySelector('#kDobInput');
  dobInput.max = new Date().toISOString().split('T')[0];

  return {
    overlay,
    input: box.querySelector('#kPseudoInput'),
    dobInput,
    msg: box.querySelector('#kProfileMsg'),
    btnCancel: box.querySelector('#kProfileCancel'),
    btnSave: box.querySelector('#kProfileSave'),
    close() { overlay.remove(); }
  };
}

/* -------------------------
   PROFILE MANAGEMENT — k_profiles
   ------------------------- */
async function ensureProfile(supabase, user) {
  if (!user) return null;

  try {
    const { data: profile, error: selErr } = await supabase
      .from('k_profiles')
      .select('id,pseudo,user_id,dob')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    dbgAlert('ensureProfile - select k_profiles', { profile, selErr });

    if (selErr) {
      console.warn('Erreur lecture k_profiles', selErr);
    } else if (profile && profile.pseudo && profile.dob) {
      if (!isAtLeast18(profile.dob)) {
        await handleUnderageAccess(supabase, user);
        return null;
      }
      if (!user.user_metadata?.username) {
        try { await supabase.auth.updateUser({ data: { username: profile.pseudo } }); } catch (e) { dbgAlert('ensureProfile - updateUser failed', String(e)); }
      }
      await setOnlineStatus(supabase, user.id, true);
      return profile.id;
    }
  } catch (e) {
    console.warn('Erreur verification profile', e);
    dbgAlert('ensureProfile - select exception', String(e));
  }

  // Pas de profil complet → afficher le modal de création
  const modal = createKagoulProfileModal();
  modal.input.focus();

  const stop = () => {
    try { modal.close(); } catch (e) {}
  };

  modal.btnCancel.addEventListener('click', () => {
    stop();
    location.href = getReturnTo();
  });

  modal.btnSave.addEventListener('click', async () => {
    const raw = sanitizePseudo(modal.input.value);
    const dob  = modal.dobInput.value;

    if (!isPseudoValid(raw)) {
      showMessage(modal.msg, 'Pseudo invalide — 3 à 32 caractères (lettres, chiffres, _ . -).', true);
      return;
    }

    if (!dob) {
      showMessage(modal.msg, 'Renseigne ta date de naissance.', true);
      return;
    }

    if (!isAtLeast18(dob)) {
      showMessage(modal.msg, 'Tu dois avoir au moins 18 ans pour accéder à Kagoul.', true);
      modal.dobInput.style.borderColor = '#ef4444';
      return;
    }

    modal.btnSave.disabled = true;
    const prevSaveText = modal.btnSave.textContent;
    modal.btnSave.textContent = 'Enregistrement...';
    showMessage(modal.msg, 'Vérification...', false);

    try {
      const { data: upsertData, error: upsertErr } = await supabase
        .from('k_profiles')
        .upsert({ user_id: user.id, pseudo: raw, dob }, { onConflict: 'user_id' })
        .select('id,pseudo,user_id,dob')
        .maybeSingle();

      dbgAlert('ensureProfile - upsert k_profiles', { upsertData, upsertErr });

      if (!upsertErr && upsertData?.id) {
        try { await supabase.auth.updateUser({ data: { username: raw } }); } catch (e) { dbgAlert('ensureProfile - updateUser after upsert error', String(e)); }
        await setOnlineStatus(supabase, user.id, true);
        showMessage(modal.msg, 'Profil enregistré — redirection...', false);
        setTimeout(() => { stop(); location.href = getReturnTo(); }, 300);
        return upsertData.id;
      }

      const errMsg     = upsertErr?.message  || '';
      const errDetails = upsertErr?.details  || '';
      const errCode    = upsertErr?.code     || '';
      const fullErr    = errMsg + ' ' + errDetails;

      if (errCode === '23514' || /k_profiles_min_age|check_violation/i.test(fullErr)) {
        showMessage(modal.msg, 'Ta date de naissance indique que tu as moins de 18 ans. Accès refusé.', true);
        modal.dobInput.style.borderColor = '#ef4444';
        modal.btnSave.disabled = false;
        modal.btnSave.textContent = prevSaveText;
        return null;
      }

      const isPgUnique = errCode === '23505' || /duplicate key|unique constraint/i.test(fullErr);

      if (isPgUnique && (/k_profiles_pseudo_unique|pseudo/i.test(fullErr))) {
        showMessage(modal.msg, 'Ce pseudo est déjà pris — choisis-en un autre.', true);
        modal.btnSave.disabled = false;
        modal.btnSave.textContent = prevSaveText;
        return null;
      }

      if (isPgUnique && (/k_profiles_user_id|user_id/i.test(fullErr))) {
        const { data: updAfter, error: updAfterErr } = await supabase
          .from('k_profiles')
          .update({ pseudo: raw, dob })
          .eq('user_id', user.id)
          .select('id,pseudo,user_id,dob')
          .maybeSingle();

        dbgAlert('ensureProfile - update after upsert duplicate', { updAfter, updAfterErr });

        if (updAfter && updAfter.id) {
          try { await supabase.auth.updateUser({ data: { username: raw } }); } catch (e) { dbgAlert('ensureProfile - updateUser after retry error', String(e)); }
          await setOnlineStatus(supabase, user.id, true);
          showMessage(modal.msg, 'Profil enregistré — redirection...', false);
          setTimeout(() => { stop(); location.href = getReturnTo(); }, 300);
          return updAfter.id;
        }
      }

      showMessage(modal.msg, 'Échec enregistrement — réessaye.', true);
      modal.btnSave.disabled = false;
      modal.btnSave.textContent = prevSaveText;
      return null;

    } catch (e) {
      console.error('Erreur during profile save', e);
      dbgAlert('ensureProfile - unexpected error', String(e));
      showMessage(modal.msg, 'Erreur inattendue — réessaye.', true);
      modal.btnSave.disabled = false;
      modal.btnSave.textContent = prevSaveText;
      return null;
    }
  });

  modal.input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') modal.dobInput.focus(); });
  modal.dobInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') modal.btnSave.click(); });
}

/* -------------------------
   ACCÈS MINEUR — Déconnexion + message
   ------------------------- */
async function handleUnderageAccess(supabase, user) {
  dbgAlert('handleUnderageAccess - user under 18, signing out', { userId: user?.id });

  try {
    await supabase.from('k_profiles').delete().eq('user_id', user.id);
  } catch (e) {
    dbgAlert('handleUnderageAccess - delete k_profiles failed', String(e));
  }

  try { await supabase.auth.signOut(); } catch (e) { dbgAlert('handleUnderageAccess - signOut failed', String(e)); }

  document.body.innerHTML = `
    <div style="
      min-height:100vh; display:flex; align-items:center; justify-content:center;
      background:#f7f9fc; font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif; padding:20px;
    ">
      <div style="
        max-width:400px; width:100%; text-align:center;
        background:#fff; border:1px solid #e6e9ee; border-radius:12px;
        padding:32px 24px; box-shadow:0 4px 24px rgba(2,6,23,0.08);
      ">
        <div style="font-size:48px; margin-bottom:16px;">🔞</div>
        <h1 style="font-size:20px; font-weight:700; color:#0b1220; margin:0 0 10px;">Accès refusé</h1>
        <p style="color:#64748b; font-size:14px; line-height:1.6; margin:0;">
          Kagoul est une plateforme réservée aux personnes ayant au moins
          <strong style="color:#0b1220;">18 ans</strong>.
          Tu ne peux pas accéder à ce contenu.
        </p>
      </div>
    </div>
  `;
}

/* -------------------------
   AUTH MODAL (LOGIN / SIGNUP / GOOGLE)
   ------------------------- */
function createAuthModal() {
  const overlay = document.createElement('div');
  overlay.id = 'authModalOverlay';
  overlay.style = `
    position:fixed; inset:0; display:flex; align-items:center; justify-content:center;
    background:rgba(0,0,0,0.55); z-index:99998; padding:20px;
  `;

  const box = document.createElement('div');
  box.style = `
    width:100%; max-width:520px; background:#fff; color:#0b1220; border-radius:12px; padding:18px;
    box-shadow:0 10px 40px rgba(2,6,23,0.3); font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;
  `;

  box.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
      <h2 style="margin:0; font-size:18px;">Se connecter / Créer un compte</h2>
      <button id="authClose" aria-label="Fermer"
        style="background:transparent;border:none;font-size:18px;cursor:pointer;color:#64748b;">✕</button>
    </div>

    <div style="margin-top:12px; display:flex; gap:8px;">
      <button id="tabLogin"
        style="flex:1; padding:8px; border-radius:8px; border:1px solid #e6e9ee; background:#f7f9fc;
               cursor:pointer; font-family:inherit; font-size:13px; font-weight:500;">
        Connexion
      </button>
      <button id="tabSignup"
        style="flex:1; padding:8px; border-radius:8px; border:1px solid #e6e9ee; background:#fff;
               cursor:pointer; font-family:inherit; font-size:13px; font-weight:500;">
        Inscription
      </button>
    </div>

    <div id="authContent" style="margin-top:14px;">
      <!-- Pane connexion -->
      <div id="loginPane">
        <label style="display:block; font-size:13px; font-weight:600; color:#334155;">Email</label>
        <input id="loginEmail" type="email" placeholder="you@example.com"
          style="width:100%; padding:10px; border-radius:8px; border:1px solid #e6e9ee;
                 margin-top:6px; box-sizing:border-box; font-size:14px;" />
        <label style="display:block; font-size:13px; font-weight:600; color:#334155; margin-top:10px;">
          Mot de passe
        </label>
        <input id="loginPass" type="password" placeholder="Mot de passe"
          style="width:100%; padding:10px; border-radius:8px; border:1px solid #e6e9ee;
                 margin-top:6px; box-sizing:border-box; font-size:14px;" />
        <div id="loginMsg" style="min-height:18px; margin-top:8px; font-size:13px; color:#ef4444;"></div>
        <div style="margin-top:12px; display:flex; gap:8px;">
          <button id="loginBtn"
            style="flex:1; padding:10px; border-radius:8px; background:#7c3aed; color:#fff;
                   border:none; font-weight:600; font-size:14px; cursor:pointer; font-family:inherit;">
            Se connecter
          </button>
          <button id="googleLoginBtn"
            style="flex:0 0 48px; border-radius:8px; border:1px solid #e6e9ee;
                   background:#fff; cursor:pointer;" title="Se connecter avec Google">
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google"
              style="width:20px;height:20px;display:block;margin:auto;" />
          </button>
        </div>
      </div>

      <!-- Pane inscription -->
      <div id="signupPane" style="display:none;">
        <label style="display:block; font-size:13px; font-weight:600; color:#334155;">Email</label>
        <input id="signupEmail" type="email" placeholder="you@example.com"
          style="width:100%; padding:10px; border-radius:8px; border:1px solid #e6e9ee;
                 margin-top:6px; box-sizing:border-box; font-size:14px;" />
        <label style="display:block; font-size:13px; font-weight:600; color:#334155; margin-top:10px;">
          Mot de passe
        </label>
        <input id="signupPass" type="password" placeholder="Mot de passe (min 6 caractères)"
          style="width:100%; padding:10px; border-radius:8px; border:1px solid #e6e9ee;
                 margin-top:6px; box-sizing:border-box; font-size:14px;" />
        <div id="signupMsg" style="min-height:18px; margin-top:8px; font-size:13px; color:#ef4444;"></div>
        <div style="margin-top:12px; display:flex; gap:8px;">
          <button id="signupBtn"
            style="flex:1; padding:10px; border-radius:8px; background:#7c3aed; color:#fff;
                   border:none; font-weight:600; font-size:14px; cursor:pointer; font-family:inherit;">
            Créer un compte
          </button>
          <button id="googleSignupBtn"
            style="flex:0 0 48px; border-radius:8px; border:1px solid #e6e9ee;
                   background:#fff; cursor:pointer;" title="S'inscrire avec Google">
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google"
              style="width:20px;height:20px;display:block;margin:auto;" />
          </button>
        </div>
      </div>
    </div>

    <p style="margin-top:10px; font-size:12px; color:#94a3b8; line-height:1.5;">
      En utilisant Google tu seras redirigé vers la page d'authentification.
      Après connexion tu reviendras ici.
    </p>
  `;

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  return {
    overlay, box,
    tabLogin:        box.querySelector('#tabLogin'),
    tabSignup:       box.querySelector('#tabSignup'),
    loginPane:       box.querySelector('#loginPane'),
    signupPane:      box.querySelector('#signupPane'),
    loginEmail:      box.querySelector('#loginEmail'),
    loginPass:       box.querySelector('#loginPass'),
    loginBtn:        box.querySelector('#loginBtn'),
    loginMsg:        box.querySelector('#loginMsg'),
    signupEmail:     box.querySelector('#signupEmail'),
    signupPass:      box.querySelector('#signupPass'),
    signupBtn:       box.querySelector('#signupBtn'),
    signupMsg:       box.querySelector('#signupMsg'),
    googleLoginBtn:  box.querySelector('#googleLoginBtn'),
    googleSignupBtn: box.querySelector('#googleSignupBtn'),
    closeBtn:        box.querySelector('#authClose'),
    close() { overlay.remove(); }
  };
}

function wireAuthModal(supabase, modal) {
  function showLoginTab() {
    modal.loginPane.style.display    = '';
    modal.signupPane.style.display   = 'none';
    modal.tabLogin.style.background  = '#f7f9fc';
    modal.tabLogin.style.color       = '#7c3aed';
    modal.tabLogin.style.borderColor = '#7c3aed';
    modal.tabSignup.style.background = '#fff';
    modal.tabSignup.style.color      = '#475569';
    modal.tabSignup.style.borderColor= '#e6e9ee';
  }
  function showSignupTab() {
    modal.loginPane.style.display    = 'none';
    modal.signupPane.style.display   = '';
    modal.tabSignup.style.background = '#f7f9fc';
    modal.tabSignup.style.color      = '#7c3aed';
    modal.tabSignup.style.borderColor= '#7c3aed';
    modal.tabLogin.style.background  = '#fff';
    modal.tabLogin.style.color       = '#475569';
    modal.tabLogin.style.borderColor = '#e6e9ee';
  }

  modal.tabLogin.addEventListener('click', () => {
    showLoginTab();
    setTimeout(() => modal.loginEmail && modal.loginEmail.focus(), 40);
  });
  modal.tabSignup.addEventListener('click', () => {
    showSignupTab();
    setTimeout(() => modal.signupEmail && modal.signupEmail.focus(), 40);
  });

  modal.closeBtn.addEventListener('click', () => modal.close());
  modal.overlay.addEventListener('click', (ev) => { if (ev.target === modal.overlay) modal.close(); });

  // Fermer avec Echap
  const onKeydown = (ev) => { if (ev.key === 'Escape') { modal.close(); document.removeEventListener('keydown', onKeydown); } };
  document.addEventListener('keydown', onKeydown);

  function showInline(msgEl, msg, isErr = true) {
    if (!msgEl) { if (isErr) alert(msg); else console.info(msg); return; }
    msgEl.textContent = msg;
    msgEl.style.color = isErr ? '#ef4444' : '#0f766e';
  }

  // LOGIN
  modal.loginBtn.addEventListener('click', async (ev) => {
    ev.preventDefault();
    const email    = modal.loginEmail.value?.trim();
    const password = modal.loginPass.value ?? '';
    if (!email || !password) { showInline(modal.loginMsg, 'Email et mot de passe requis.'); return; }

    modal.loginBtn.disabled = true;
    const prev = modal.loginBtn.textContent;
    modal.loginBtn.textContent = 'Connexion...';
    showInline(modal.loginMsg, '', false);

    try {
      const res = await supabase.auth.signInWithPassword({ email, password });
      dbgAlert('signInWithPassword result', res);

      if (res.error) {
        showInline(modal.loginMsg, res.error.message || 'Erreur connexion.');
        return;
      }

      const user = res.data?.user ?? null;
      if (user) {
        await ensureProfile(supabase, user);
        modal.close();
        location.href = getReturnTo();
        return;
      }

      const ures = await supabase.auth.getUser();
      const u = ures?.data?.user ?? null;
      if (u) { await ensureProfile(supabase, u); modal.close(); location.href = getReturnTo(); return; }
      showInline(modal.loginMsg, 'Connexion réussie (attente session).', false);

    } catch (e) {
      console.error('signIn exception', e);
      dbgAlert('signInWithPassword - exception', String(e));
      showInline(modal.loginMsg, 'Erreur réseau. Réessaye.');
    } finally {
      modal.loginBtn.disabled = false;
      modal.loginBtn.textContent = prev;
    }
  });

  // SIGNUP
  modal.signupBtn.addEventListener('click', async (ev) => {
    ev.preventDefault();
    const email    = modal.signupEmail.value?.trim();
    const password = modal.signupPass.value ?? '';
    if (!email || !password) { showInline(modal.signupMsg, 'Email et mot de passe requis.'); return; }
    if (password.length < 6) { showInline(modal.signupMsg, 'Mot de passe trop court (min 6 caractères).'); return; }

    modal.signupBtn.disabled = true;
    const prev = modal.signupBtn.textContent;
    modal.signupBtn.textContent = 'Création...';
    showInline(modal.signupMsg, '', false);

    try {
      const res = await supabase.auth.signUp({ email, password, options: {} });
      dbgAlert('signUp result', res);

      if (res.error) {
        showInline(modal.signupMsg, res.error.message || 'Erreur création compte.');
        return;
      }

      const user = res.data?.user ?? null;
      if (user) {
        await ensureProfile(supabase, user);
        modal.close();
        location.href = getReturnTo();
        return;
      }
      showInline(modal.signupMsg, 'Inscription OK — vérifie ton email pour confirmer le compte si demandé.', false);

    } catch (e) {
      console.error('signUp exception', e);
      dbgAlert('signUp - exception', String(e));
      showInline(modal.signupMsg, 'Erreur réseau. Réessaye.');
    } finally {
      modal.signupBtn.disabled = false;
      modal.signupBtn.textContent = prev;
    }
  });

  // GOOGLE OAuth
  async function startGoogleFlow() {
    try {
      const redirectTo = KAGOUL_HOME;
      dbgAlert('google signInWithOAuth - redirectTo', { redirectTo });
      await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
    } catch (e) {
      console.error('Erreur OAuth', e);
      dbgAlert('signInWithOAuth - exception', String(e));
      showInline(modal.loginMsg, 'Impossible de lancer Google Sign-in.');
    }
  }
  modal.googleLoginBtn.addEventListener('click',  (e) => { e.preventDefault(); startGoogleFlow(); });
  modal.googleSignupBtn.addEventListener('click', (e) => { e.preventDefault(); startGoogleFlow(); });

  [modal.loginEmail, modal.loginPass].forEach(inp => {
    inp && inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') modal.loginBtn.click(); });
  });
  [modal.signupEmail, modal.signupPass].forEach(inp => {
    inp && inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') modal.signupBtn.click(); });
  });
}

/* -------------------------
   INITIALIZATION
   ------------------------- */
async function init() {
  let supabase = null;
  try {
    supabase = await getSupabase();
  } catch (e) {
    console.warn('supabaseClient.js non trouvé — mode demo', e);
  }

  function bindOpeners() {
    /**
     * openAuthModal(mode?)
     * @param {string} mode  'login' (défaut) ou 'signup'
     */
    window.openAuthModal = async function openAuthModal(mode = 'login') {
      // Éviter les doublons
      if (document.getElementById('authModalOverlay')) return;

      try {
        const client = supabase ?? (typeof window !== 'undefined' && window.supabase ? window.supabase : null);
        if (!client) {
          alert('Impossible d\'initialiser l\'auth (client Supabase manquant).');
          return;
        }
        const modal = createAuthModal();
        wireAuthModal(client, modal);

        // Sélectionner le bon onglet selon le mode demandé
        if (mode === 'signup') {
          modal.tabSignup.click();
        } else {
          modal.tabLogin.click();
        }
      } catch (err) {
        console.error('openAuthModal error', err);
      }
    };

    document.removeEventListener('kagoul:open-auth-modal', window.openAuthModal);
    document.addEventListener('kagoul:open-auth-modal', (e) => {
      window.openAuthModal(e?.detail?.mode);
    });
  }

  bindOpeners();

  try {
    if (supabase) await attachLegacyHandlersIfPresent(supabase);
  } catch (e) {
    console.warn('attachLegacyHandlersIfPresent failed', e);
  }

  try {
    if (!supabase) return;

    const sessionRes = await supabase.auth.getSession();
    dbgAlert('init - getSession', sessionRes);
    const session = sessionRes?.data?.session ?? null;
    const user    = session?.user ?? null;

    supabase.auth.onAuthStateChange((event, sess) => {
      dbgAlert('onAuthStateChange', { event, sess });
      const u = sess?.user ?? null;

      if (event === 'SIGNED_IN' && u) {
        setTimeout(() => {
          ensureProfile(supabase, u).catch(console.error);
        }, 200);
      }

      if (event === 'SIGNED_OUT') {
        const prevUser = session?.user ?? null;
        const uid = prevUser?.id ?? null;
        if (uid) setOnlineStatus(supabase, uid, false).catch(console.error);
      }
    });

    if (user) {
      await ensureProfile(supabase, user);
    }

    // Marquer offline à la fermeture
    window.addEventListener('beforeunload', () => {
      if (user?.id) {
        try {
          const url = supabase.supabaseUrl + '/rest/v1/k_profiles?user_id=eq.' + encodeURIComponent(user.id);
          const payload = JSON.stringify({ is_online: false });
          const headers = {
            'Content-Type': 'application/json',
            'apikey': supabase.supabaseKey,
            'Authorization': 'Bearer ' + supabase.supabaseKey,
            'Prefer': 'return=minimal',
            'X-HTTP-Method-Override': 'PATCH',
          };
          const blob = new Blob([payload], { type: 'application/json' });
          if (!navigator.sendBeacon(url, blob)) {
            const xhr = new XMLHttpRequest();
            xhr.open('PATCH', url, false);
            Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
            xhr.send(payload);
          }
        } catch (e) {
          dbgAlert('beforeunload setOnlineStatus - exception', String(e));
        }
      }
    });

  } catch (e) {
    console.warn('Erreur initialisation kagoul-auth.js', e);
    dbgAlert('init - exception', String(e));
  }
}

/* -------------------------
   LEGACY: handlers pour pages avec formulaires inline
   ------------------------- */
async function attachLegacyHandlersIfPresent(supabase) {
  try {
    const loginEmail  = document.getElementById('loginEmail');
    const loginPass   = document.getElementById('loginPass');
    const loginBtn    = document.getElementById('loginBtn');
    const signupEmail = document.getElementById('signupEmail');
    const signupPass  = document.getElementById('signupPass');
    const signupBtn   = document.getElementById('signupBtn');
    const googleBtn   = document.getElementById('googleBtn');

    if (loginBtn && loginEmail && loginPass) {
      loginBtn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        const email    = loginEmail.value?.trim();
        const password = loginPass.value ?? '';
        if (!email || !password) { alert('Email et mot de passe requis.'); return; }
        loginBtn.disabled = true;
        const prev = loginBtn.textContent;
        loginBtn.textContent = 'Connexion...';
        try {
          const res = await supabase.auth.signInWithPassword({ email, password });
          dbgAlert('signInWithPassword result (legacy)', res);
          if (res.error) { alert(res.error.message || 'Erreur connexion.'); return; }
          const user = res.data?.user ?? null;
          if (user) { await ensureProfile(supabase, user); location.href = getReturnTo(); }
        } catch (e) {
          console.error(e); alert('Erreur réseau — réessaye.');
        } finally {
          loginBtn.disabled = false; loginBtn.textContent = prev;
        }
      });
    }

    if (signupBtn && signupEmail && signupPass) {
      signupBtn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        const email    = signupEmail.value?.trim();
        const password = signupPass.value ?? '';
        if (!email || !password) { alert('Email et mot de passe requis.'); return; }
        signupBtn.disabled = true;
        const prev = signupBtn.textContent;
        signupBtn.textContent = 'Création...';
        try {
          const res = await supabase.auth.signUp({ email, password, options: {} });
          dbgAlert('signUp result (legacy)', res);
          if (res.error) { alert(res.error.message || 'Erreur création compte.'); return; }
          const user = res.data?.user ?? null;
          if (user) { await ensureProfile(supabase, user); location.href = getReturnTo(); }
          else alert('Inscription OK — vérifie ton email pour confirmer le compte si requis.');
        } catch (e) {
          console.error(e); alert('Erreur réseau — réessaye.');
        } finally {
          signupBtn.disabled = false; signupBtn.textContent = prev;
        }
      });
    }

    if (googleBtn) {
      googleBtn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: KAGOUL_HOME } });
      });
    }
  } catch (e) {
    console.warn('attachLegacyHandlersIfPresent error', e);
  }
}

// Kick off
init().catch(e => {
  console.error('kagoul-auth init error', e);
  dbgAlert('kagoul-auth init error', String(e));
});
