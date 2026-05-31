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

export function watchRunsForTest(testId, cb, max = 25) {
  const q = query(
    collection(db, 'runs'),
    where('testId', '==', testId),
    orderBy('startedAt', 'desc'),
    limit(max),
  );
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
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
export async function enqueueRun(test, triggeredBy) {
  const ref = await addDoc(collection(db, 'runs'), {
    testId: test.id,
    testName: test.name,
    status: 'queued',
    startedAt: serverTimestamp(),
    finishedAt: null,
    triggeredBy: triggeredBy || 'dashboard',
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

export { doc, setDoc };
