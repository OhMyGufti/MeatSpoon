// src/services/googleAuth.native.ts
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import {
  GoogleAuthProvider,
  signInWithCredential,
  signOut,
  UserCredential,
} from 'firebase/auth';
import { auth } from './firebase';

export const GOOGLE_WEB_CLIENT_ID =
  '35614474326-gcvog04g7sprjhld2b8cgva47t2ui62h.apps.googleusercontent.com';

let isConfigured = false;

function ensureGoogleSigninConfigured(): void {
  if (isConfigured) return;
  GoogleSignin.configure({
    webClientId: GOOGLE_WEB_CLIENT_ID,
  });
  isConfigured = true;
}

// Configure immediately on module load (wrapped in try/catch so initialization never crashes)
try {
  ensureGoogleSigninConfigured();
} catch (err) {
  console.warn('GoogleSignin.configure deferred:', err);
}

export async function signInWithGoogle(): Promise<UserCredential> {
  ensureGoogleSigninConfigured();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  const response = await GoogleSignin.signIn();
  const anyResponse = response as unknown as {
    type?: string;
    data?: { idToken?: string | null } | null;
    idToken?: string | null;
  };

  if (anyResponse?.type === 'cancelled') {
    const cancelError = new Error('Google Sign-In was cancelled by the user.');
    (cancelError as Error & { code?: string }).code = 'auth/cancelled';
    throw cancelError;
  }

  const idToken = anyResponse?.data?.idToken ?? anyResponse?.idToken;
  if (!idToken) {
    throw new Error('No ID token returned from Google Sign-In.');
  }

  const credential = GoogleAuthProvider.credential(idToken);
  return await signInWithCredential(auth, credential);
}

export async function signOutFromGoogle(): Promise<void> {
  try {
    ensureGoogleSigninConfigured();
    await GoogleSignin.signOut();
  } catch (err) {
    console.warn('GoogleSignin native signOut warning:', err);
  }
  await signOut(auth);
}
