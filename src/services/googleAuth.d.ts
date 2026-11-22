// src/services/googleAuth.d.ts
import { UserCredential } from 'firebase/auth';

export declare function signInWithGoogle(): Promise<UserCredential>;
export declare function signOutFromGoogle(): Promise<void>;
