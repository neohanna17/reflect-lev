import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { isLoginComponentName } from './schema';

const FEEDBACK_NOTIFY_URL =
  import.meta.env.VITE_FEEDBACK_NOTIFY_URL || '/.netlify/functions/notify-feedback';

// ---- Tests ----

export function watchTests(cb) {
  const q = query(collection(db, 'tests'), orderBy('updatedAt', 'desc'));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export async function getTest(id) {
  const snap = await getDoc(doc(db, 'tests', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// One-shot "give me an example to show" helpers used by the product tour to
// drill into a real test editor / run detail. Return null when none exist yet.
export async function getFirstTestId() {
  const snap = await getDocs(
    query(collection(db, 'tests'), orderBy('updatedAt', 'desc'), limit(1)),
  );
  return snap.empty ? null : snap.docs[0].id;
}

export async function createTest(data) {
  const ref = await addDoc(collection(db, 'tests'), {
    name: data.name || 'Untitled test',
    description: data.description || '',
    module: data.module || '',
    startUrl: data.startUrl || '',
    steps: data.steps || [],
    tags: data.tags || [],
    status: 'active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: data.createdBy || null,
  });
  return ref.id;
}

export async function saveTest(id, data) {
  await updateDoc(doc(db, 'tests', id), { ...data, updatedAt: serverTimestamp() });
}

export async function deleteTest(id) {
  await deleteDoc(doc(db, 'tests', id));
}

// ---- Runs ----

const toMs = (t) => (t?.toMillis ? t.toMillis() : t?.seconds ? t.seconds * 1000 : 0);

export function watchRunsForTest(testId, cb, max = 25) {
  // No orderBy here so we don't need a composite Firestore index; we sort by
  // start time on the client instead.
  const q = query(collection(db, 'runs'), where('testId', '==', testId), limit(50));
  return onSnapshot(q, (snap) => {
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => toMs(b.startedAt) - toMs(a.startedAt));
    cb(rows.slice(0, max));
  });
}

export function watchRecentRuns(cb, max = 50) {
  const q = query(collection(db, 'runs'), orderBy('startedAt', 'desc'), limit(max));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export async function getFirstRunId() {
  const snap = await getDocs(
    query(collection(db, 'runs'), orderBy('startedAt', 'desc'), limit(1)),
  );
  return snap.empty ? null : snap.docs[0].id;
}

export function watchRun(id, cb) {
  return onSnapshot(doc(db, 'runs', id), (snap) =>
    cb(snap.exists() ? { id: snap.id, ...snap.data() } : null),
  );
}

// Delete a run document. Stored artifacts (video/trace/screenshots) under the
// runs/{id}/ Storage prefix are reaped by the runner's retention sweep.
export async function deleteRun(id) {
  await deleteDoc(doc(db, 'runs', id));
}

// Enqueue a run document. The GitHub Actions runner picks up "queued" runs
// (or is targeted directly by id) and updates this doc as it progresses.
export async function enqueueRun(test, triggeredBy, opts = {}) {
  const ref = await addDoc(collection(db, 'runs'), {
    testId: test.id,
    testName: test.name,
    status: 'queued',
    startedAt: serverTimestamp(),
    finishedAt: null,
    triggeredBy: triggeredBy || 'dashboard',
    updateBaselines: !!opts.updateBaselines,
    fromStep: Number.isInteger(opts.fromStep) ? opts.fromStep : null,
    toStep: Number.isInteger(opts.toStep) ? opts.toStep : null,
    setupComponentId: opts.setupComponentId || null,
    setupComponentIds: opts.setupComponentIds || null,
    teardownComponentIds: opts.teardownComponentIds || null,
    // When launched as part of a suite, every run in the batch shares one
    // suiteRunId so the dashboard can show a single pass/fail for the suite.
    suiteId: opts.suiteId || null,
    suiteRunId: opts.suiteRunId || null,
    suiteName: opts.suiteName || null,
    steps: [],
    durationMs: 0,
    browser: 'chromium',
    error: null,
  });
  return ref.id;
}

// ---- Membership ----

export async function isMember(uid) {
  if (!uid) return false;
  try {
    const snap = await getDoc(doc(db, 'members', uid));
    return snap.exists();
  } catch {
    return false;
  }
}

// ---- Suites ----

export function watchSuites(cb) {
  const q = query(collection(db, 'suites'), orderBy('name'));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export async function createSuite(data) {
  const ref = await addDoc(collection(db, 'suites'), {
    name: data.name || 'Untitled suite',
    testIds: data.testIds || [],
    schedule: data.schedule || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function saveSuite(id, data) {
  await updateDoc(doc(db, 'suites', id), { ...data, updatedAt: serverTimestamp() });
}

export async function deleteSuite(id) {
  await deleteDoc(doc(db, 'suites', id));
}

// ---- Reusable components ----
// A component is a named, saved sequence of steps that can be dropped into any
// test as a single step. The runner expands it at run time.

export function watchComponents(cb) {
  const q = query(collection(db, 'components'), orderBy('name'));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

// Find the reusable component that represents logging in (matched by name), so
// new tests can be seeded with it as their first step. Returns the component
// doc or null.
export async function getLoginComponent() {
  const snap = await getDocs(collection(db, 'components'));
  const comps = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return comps.find((c) => isLoginComponentName(c.name)) || null;
}

export async function getComponent(id) {
  const snap = await getDoc(doc(db, 'components', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function createComponent(data) {
  const ref = await addDoc(collection(db, 'components'), {
    name: data.name || 'Untitled component',
    description: data.description || '',
    steps: data.steps || [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function saveComponent(id, data) {
  await updateDoc(doc(db, 'components', id), { ...data, updatedAt: serverTimestamp() });
}

export async function deleteComponent(id) {
  await deleteDoc(doc(db, 'components', id));
}

// ---- Feature feedback ----
// Notes / feature requests / change requests colleagues leave for the admin to
// act on. Newest first.

export function watchFeedback(cb) {
  const q = query(collection(db, 'feedback'), orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export async function createFeedback(data) {
  const ref = await addDoc(collection(db, 'feedback'), {
    title: data.title || '',
    category: data.category || 'Feature request',
    details: data.details || '',
    status: 'new',
    authorEmail: data.authorEmail || null,
    authorName: data.authorName || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  // Fire-and-forget Discord ping. The feedback is already saved above, so a
  // webhook hiccup must never make submitting fail — swallow any error.
  notifyFeedbackDiscord({
    title: data.title || '',
    category: data.category || 'Feature request',
    details: data.details || '',
    authorName: data.authorName || null,
    authorEmail: data.authorEmail || null,
  });
  return ref.id;
}

async function notifyFeedbackDiscord(payload) {
  try {
    const user = auth.currentUser;
    const idToken = user ? await user.getIdToken() : null;
    await fetch(FEEDBACK_NOTIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch {
    /* notification is best-effort; ignore failures */
  }
}

// Fire a celebratory Discord ping when a feature request is marked Done so the
// requester knows it shipped. Best-effort — never blocks the status update.
export function notifyFeedbackDone(item) {
  notifyFeedbackDiscord({
    type: 'done',
    title: item?.title || '',
    category: item?.category || 'Feature request',
    details: item?.details || '',
    comment: item?.comment || '',
  });
}

export async function saveFeedback(id, data) {
  await updateDoc(doc(db, 'feedback', id), { ...data, updatedAt: serverTimestamp() });
}

export async function deleteFeedback(id) {
  await deleteDoc(doc(db, 'feedback', id));
}

// ---- Presence ----
// A lightweight "who's online" signal. Each signed-in member maintains one
// presence/{uid} doc with a heartbeat timestamp and the page they're on, so
// everyone can see who else is working and avoid editing the same thing.

export function setPresence(user, path) {
  if (!user) return Promise.resolve();
  return setDoc(
    doc(db, 'presence', user.uid),
    {
      uid: user.uid,
      name: user.displayName || null,
      email: user.email || null,
      photoURL: user.photoURL || null,
      path: path || '/',
      lastActive: serverTimestamp(),
    },
    { merge: true },
  ).catch(() => {});
}

export function clearPresence(uid) {
  if (!uid) return Promise.resolve();
  return deleteDoc(doc(db, 'presence', uid)).catch(() => {});
}

export function watchPresence(cb) {
  return onSnapshot(
    collection(db, 'presence'),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => cb([]), // swallow permission errors (e.g. rules not published yet)
  );
}

// ---- QA Plan task statuses ----
// The plan content (modules + tasks) is static (see qaPlan.js). Only each
// task's status is dynamic and shared across the team, stored one doc per
// task in `qaStatus/{taskId}`. Tasks with no doc default to "in testing".

export function watchQaStatus(cb) {
  return onSnapshot(
    collection(db, 'qaStatus'),
    (snap) => {
      const map = {};
      snap.docs.forEach((d) => (map[d.id] = d.data()));
      cb(map);
    },
    () => cb({}), // degrade gracefully if rules aren't published yet
  );
}

export function setQaStatus(taskId, status, user) {
  return setDoc(
    doc(db, 'qaStatus', taskId),
    {
      status,
      updatedAt: serverTimestamp(),
      updatedBy: user?.displayName || user?.email || null,
    },
    { merge: true },
  );
}

export { doc, setDoc };
