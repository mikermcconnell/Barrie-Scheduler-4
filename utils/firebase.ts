/// <reference types="vite/client" />
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyAXyQdMS-4wlwiL2r1zGLpKfkQzJhaGr58",
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "barrie-scheduler-7844a.firebaseapp.com",
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "barrie-scheduler-7844a",
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "barrie-scheduler-7844a.firebasestorage.app",
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "456781729862",
    appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:456781729862:web:6e9797875549bc90daba47",
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-MBMBBD4EMV"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

export default app;
