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
import { db } from '../firebase';

// ---- Tests ----

export function watchTests(cb) {
  const q = query(collection(db, 'tests'), orderBy('updatedAt', 'desc'));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export async function getTest(id) {
  const snap = await getDoc(doc(db, 'tests', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
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

export function watchRun(id, cb) {
  return onSnapshot(doc(db, 'runs', id), (snap) =>
    cb(snap.exists() ? { id: snap.id, ...snap.data() } : null),
  );
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

export { doc, setDoc };
