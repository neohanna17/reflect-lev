import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

// Credentials come from one of:
//   FIREBASE_SERVICE_ACCOUNT  – the service-account JSON as a string (CI secret)
//   GOOGLE_APPLICATION_CREDENTIALS – path to a JSON key file (local dev)
function credential() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    const json = raw.trim().startsWith('{') ? JSON.parse(raw) : JSON.parse(Buffer.from(raw, 'base64').toString());
    return cert(json);
  }
  return applicationDefault();
}

const bucketName =
  process.env.FIREBASE_STORAGE_BUCKET ||
  (process.env.FIREBASE_PROJECT_ID
    ? `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`
    : undefined);

initializeApp({
  credential: credential(),
  storageBucket: bucketName,
});

export const db = getFirestore();
export const bucket = bucketName ? getStorage().bucket() : null;
