// ============================================================
// Firebase init
// ============================================================
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const FieldValue = firebase.firestore.FieldValue;
const Timestamp = firebase.firestore.Timestamp;

const FAKE_EMAIL_DOMAIN = "@dailypass.local";
const DAY_MS = 24 * 60 * 60 * 1000;

// ============================================================
// DOM refs
// ============================================================
const authScreen = document.getElementById('authScreen');
const dashScreen = document.getElementById('dashScreen');

const enterForm = document.getElementById('enterForm');
const enterMsg = document.getElementById('enterMsg');

const displayUsername = document.getElementById('displayUsername');
const displayDate = document.getElementById('displayDate');
const seasonDay = document.getElementById('seasonDay');
const pointsTotal = document.getElementById('pointsTotal');
const seasonStatus = document.getElementById('seasonStatus');
const stopsGrid = document.getElementById('stopsGrid');
const refCode = document.getElementById('refCode');
const refCount = document.getElementById('refCount');
const copyRefBtn = document.getElementById('copyRefBtn');
const logoutBtn = document.getElementById('logoutBtn');

let currentUserDoc = null;
let unsubscribeUser = null;
let tickInterval = null;

// ============================================================
// Helpers
// ============================================================
function usernameToEmail(username) {
  return username.trim().toLowerCase() + FAKE_EMAIL_DOMAIN;
}

// No password is ever shown to the user. Instead we derive a stable key
// from the username itself so the same username always maps to the same
// Firebase Auth credential, on any device. NOTE: this means anyone who
// knows a username can enter that account — there is no real lock here,
// by design, since the project asked for username-only entry.
async function deriveKey(username) {
  const data = new TextEncoder().encode('daily-pass-v1::' + username.trim().toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  return 'Pk_' + hex.slice(0, 24);
}

function makeReferralCode(username) {
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  const base = username.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase();
  return (base + rand).slice(0, 8);
}

function todayDateString() {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
  });
}

function seasonInfo() {
  const start = new Date(CAMPAIGN_START + "T00:00:00");
  const now = new Date();
  const diffDays = Math.floor((now - start) / DAY_MS) + 1;
  const dayNumber = Math.min(Math.max(diffDays, 1), CAMPAIGN_DAYS);
  const ended = diffDays > CAMPAIGN_DAYS;
  const notStarted = diffDays < 1;
  return { dayNumber, ended, notStarted };
}

function setMsg(el, text, ok) {
  el.textContent = text;
  el.className = 'form-msg ' + (ok ? 'ok' : 'error');
}

// ============================================================
// Enter (creates the account the first time, logs in every time after)
// ============================================================
enterForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = enterForm.querySelector('button[type=submit]');
  submitBtn.disabled = true;
  setMsg(enterMsg, '', true);

  const usernameRaw = document.getElementById('enterUsername').value.trim();
  const referralInput = document.getElementById('enterReferral').value.trim().toUpperCase();
  const usernameLower = usernameRaw.toLowerCase();

  if (!/^[a-zA-Z0-9_]{3,20}$/.test(usernameRaw)) {
    setMsg(enterMsg, 'Username must be 3-20 letters, numbers, or underscores.', false);
    submitBtn.disabled = false;
    return;
  }

  try {
    const key = await deriveKey(usernameRaw);
    const email = usernameToEmail(usernameRaw);

    // Try logging in first — this covers returning users.
    try {
      await auth.signInWithEmailAndPassword(email, key);
      return; // onAuthStateChanged takes over
    } catch (loginErr) {
      if (loginErr.code !== 'auth/user-not-found' && loginErr.code !== 'auth/invalid-credential') {
        throw loginErr;
      }
      // fall through to account creation for a brand-new username
    }

    // Make sure the username isn't already claimed under a different flow
    const nameDoc = await db.collection('usernames').doc(usernameLower).get();
    if (nameDoc.exists) {
      setMsg(enterMsg, 'That username is taken. Try another.', false);
      submitBtn.disabled = false;
      return;
    }

    // If a referral code was entered, make sure it exists
    let referrerUid = null;
    if (referralInput) {
      const codeDoc = await db.collection('referralCodes').doc(referralInput).get();
      if (!codeDoc.exists) {
        setMsg(enterMsg, 'That referral code was not found.', false);
        submitBtn.disabled = false;
        return;
      }
      referrerUid = codeDoc.data().uid;
    }

    // Create the account
    const cred = await auth.createUserWithEmailAndPassword(email, key);
    const uid = cred.user.uid;
    const code = makeReferralCode(usernameRaw);

    const batch = db.batch();
    batch.set(db.collection('users').doc(uid), {
      username: usernameRaw,
      usernameLower,
      points: 0,
      referralCode: code,
      referredBy: referrerUid,
      referralCount: 0,
      clicks: { s1: null, s2: null, s3: null, s4: null, s5: null },
      createdAt: FieldValue.serverTimestamp()
    });
    batch.set(db.collection('usernames').doc(usernameLower), { uid });
    batch.set(db.collection('referralCodes').doc(code), { uid });
    await batch.commit();

    // Credit the referrer (separate write, allowed by security rules
    // as a bonus-only update on someone else's doc)
    if (referrerUid) {
      const refDocRef = db.collection('users').doc(referrerUid);
      await db.runTransaction(async (tx) => {
        const refSnap = await tx.get(refDocRef);
        if (!refSnap.exists) return;
        const data = refSnap.data();
        tx.update(refDocRef, {
          points: (data.points || 0) + POINTS_PER_REFERRAL,
          referralCount: (data.referralCount || 0) + 1
        });
      });
    }
    // onAuthStateChanged takes over from here
  } catch (err) {
    console.error(err);
    setMsg(enterMsg, err.message || 'Could not enter your pass. Try again.', false);
    submitBtn.disabled = false;
  }
});

// ============================================================
// Log out
// ============================================================
logoutBtn.addEventListener('click', () => auth.signOut());

// ============================================================
// Auth state -> show the right screen
// ============================================================
auth.onAuthStateChanged((user) => {
  if (unsubscribeUser) { unsubscribeUser(); unsubscribeUser = null; }
  if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }

  enterForm.querySelector('button[type=submit]').disabled = false;

  if (user) {
    authScreen.classList.add('hidden');
    dashScreen.classList.remove('hidden');
    displayDate.textContent = todayDateString();

    unsubscribeUser = db.collection('users').doc(user.uid)
      .onSnapshot((snap) => {
        if (!snap.exists) return;
        currentUserDoc = { id: user.uid, ...snap.data() };
        renderDashboard();
      });

    if (!tickInterval) {
      tickInterval = setInterval(() => { if (currentUserDoc) renderStops(); }, 1000);
    }
  } else {
    dashScreen.classList.add('hidden');
    authScreen.classList.remove('hidden');
    currentUserDoc = null;
  }
});

// ============================================================
// Dashboard rendering
// ============================================================
function renderDashboard() {
  if (!currentUserDoc) return;
  displayUsername.textContent = currentUserDoc.username;
  pointsTotal.textContent = currentUserDoc.points ?? 0;
  refCode.textContent = currentUserDoc.referralCode || '——————';
  refCount.textContent = currentUserDoc.referralCount ?? 0;

  const { dayNumber, ended, notStarted } = seasonInfo();
  seasonDay.textContent = dayNumber;

  if (notStarted) {
    seasonStatus.textContent = `The season hasn't started yet. Come back on ${CAMPAIGN_START}.`;
    seasonStatus.classList.add('ended');
  } else if (ended) {
    seasonStatus.textContent = `This 30-day season has ended. Thanks for playing!`;
    seasonStatus.classList.add('ended');
  } else {
    seasonStatus.textContent = `Day ${dayNumber} of ${CAMPAIGN_DAYS} — tap each stop once every 24 hours to earn points.`;
    seasonStatus.classList.remove('ended');
  }

  renderStops();
}

function renderStops() {
  if (!currentUserDoc) return;
  const { ended, notStarted } = seasonInfo();
  const seasonActive = !ended && !notStarted;
  const clicks = currentUserDoc.clicks || {};

  stopsGrid.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const key = 's' + i;
    const lastClicked = clicks[key];
    const lastMs = lastClicked ? lastClicked.toMillis() : 0;
    const remaining = lastMs ? (lastMs + DAY_MS) - Date.now() : 0;
    const onCooldown = remaining > 0;

    const card = document.createElement('div');
    card.className = 'stop-card' + (lastMs ? ' punched' : '');
    card.setAttribute('data-idx', i);

    const name = document.createElement('div');
    name.className = 'stop-name';
    name.textContent = STOP_LABELS[i - 1] || ('Stop ' + i);

    const punch = document.createElement('div');
    punch.className = 'punch-mark';
    punch.textContent = '✓';

    const topRow = document.createElement('div');
    topRow.style.display = 'flex';
    topRow.style.justifyContent = 'space-between';
    topRow.style.alignItems = 'center';
    topRow.appendChild(name);
    topRow.appendChild(punch);

    const btn = document.createElement('button');
    btn.className = 'stop-btn';
    if (!seasonActive) {
      btn.textContent = notStarted ? 'Not started' : 'Season ended';
      btn.disabled = true;
    } else if (onCooldown) {
      btn.textContent = 'Visited';
      btn.disabled = true;
    } else {
      btn.textContent = `Visit +${POINTS_PER_STOP} pts`;
      btn.disabled = false;
      btn.addEventListener('click', () => handleStopClick(i, key));
    }

    card.appendChild(topRow);
    card.appendChild(btn);

    if (onCooldown && seasonActive) {
      const cd = document.createElement('div');
      cd.className = 'cooldown';
      cd.textContent = formatRemaining(remaining);
      card.appendChild(cd);
    }

    stopsGrid.appendChild(card);
  }
}

function formatRemaining(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return `Next in ${h}:${m}:${s}`;
}

// ============================================================
// Handling a stop click
// ============================================================
async function handleStopClick(stopNumber, key) {
  const { ended, notStarted } = seasonInfo();
  if (ended || notStarted) return;

  const url = STOP_URLS[stopNumber - 1];
  const userRef = db.collection('users').doc(currentUserDoc.id);

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      const data = snap.data();
      const last = data.clicks ? data.clicks[key] : null;
      const lastMs = last ? last.toMillis() : 0;
      if (lastMs && (Date.now() - lastMs) < DAY_MS) {
        throw new Error('cooldown');
      }
      tx.update(userRef, {
        points: (data.points || 0) + POINTS_PER_STOP,
        [`clicks.${key}`]: FieldValue.serverTimestamp()
      });
    });
    window.open(url, '_blank', 'noopener');
  } catch (err) {
    if (err.message !== 'cooldown') console.error(err);
    renderStops();
  }
}

// ============================================================
// Copy referral code
// ============================================================
copyRefBtn.addEventListener('click', async () => {
  if (!currentUserDoc || !currentUserDoc.referralCode) return;
  try {
    await navigator.clipboard.writeText(currentUserDoc.referralCode);
    copyRefBtn.textContent = 'Copied!';
    setTimeout(() => { copyRefBtn.textContent = 'Copy'; }, 1500);
  } catch {
    // clipboard blocked — no-op, code is already visible on screen
  }
});
