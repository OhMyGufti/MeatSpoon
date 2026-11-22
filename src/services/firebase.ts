// src/services/firebase.ts
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp, getApps, getApp } from 'firebase/app';
import * as firebaseAuth from 'firebase/auth';
import {
  Auth,
  getAuth,
  initializeAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithCredential,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  Persistence,
  User,
} from 'firebase/auth';
import { doc, getDoc, getFirestore, setDoc } from 'firebase/firestore';
import { LocalBackupPayload } from '../types/schedule';

const firebaseConfig = {
  apiKey: "AIzaSyDggnSCd2N6DEpy6ooBkg2bGRZ77wmKLlI",
  authDomain: "meatspooncal.firebaseapp.com",
  projectId: "meatspooncal",
  storageBucket: "meatspooncal.firebasestorage.app",
  messagingSenderId: "35614474326",
  appId: "1:35614474326:web:3c8d4750cb32872ecabbf7",
  measurementId: "G-02KHXP7E4W"
};

// Safely access getReactNativePersistence from firebase/auth (exported in the RN bundle at runtime,
// while omitted from default browser .d.ts declarations).
const getReactNativePersistence = (
  firebaseAuth as unknown as {
    getReactNativePersistence?: (storage: typeof AsyncStorage) => Persistence;
  }
).getReactNativePersistence;

export const app =
  getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const auth: Auth = (() => {
  if (Platform.OS === 'web') {
    return getAuth(app);
  }
  try {
    if (typeof getReactNativePersistence === 'function') {
      return initializeAuth(app, {
        persistence: getReactNativePersistence(AsyncStorage),
      });
    }
    return initializeAuth(app);
  } catch {
    // Fallback if Auth was already initialized (e.g. Fast Refresh)
    return getAuth(app);
  }
})();

export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

export {
  onAuthStateChanged,
  signInWithPopup,
  signInWithCredential,
  firebaseSignOut,
  GoogleAuthProvider,
};
export type { User };

/**
 * Fetches the user's cloud schedule document at `users/{uid}` in Firestore.
 * Returns `null` if the document does not exist yet.
 */
export async function fetchUserScheduleFromCloud(
  uid: string
): Promise<Partial<LocalBackupPayload> | null> {
  const userDocRef = doc(db, 'users', uid);
  const snapshot = await getDoc(userDocRef);
  if (!snapshot.exists()) {
    return null;
  }
  return snapshot.data() as Partial<LocalBackupPayload>;
}

/**
 * Saves the user's complete schedule & settings payload to `users/{uid}` in Firestore
 * using the exact Export/Import JSON structure plus an `updatedAt` ISO timestamp.
 */
export async function saveUserScheduleToCloud(
  uid: string,
  payload: LocalBackupPayload
): Promise<void> {
  const nowISO = new Date().toISOString();
  // Strip any undefined fields via JSON serialization so Firestore setDoc never rejects optional fields
  const sanitized = JSON.parse(
    JSON.stringify({
      ...payload,
      exportedAt: payload.exportedAt || nowISO,
      updatedAt: nowISO,
    })
  );
  const userDocRef = doc(db, 'users', uid);
  await setDoc(userDocRef, sanitized);
}
