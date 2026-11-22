// src/services/googleAuth.web.ts
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  UserCredential,
} from 'firebase/auth';
import { auth } from './firebase';

export async function signInWithGoogle(): Promise<UserCredential> {
  const provider = new GoogleAuthProvider();
  return await signInWithPopup(auth, provider);
}

export async function signOutFromGoogle(): Promise<void> {
  await signOut(auth);
}
