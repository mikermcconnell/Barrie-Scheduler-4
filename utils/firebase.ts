import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
    apiKey: "AIzaSyAXyQdMS-4wlwiL2r1zGLpKfkQzJhaGr58",
    authDomain: "barrie-scheduler-7844a.firebaseapp.com",
    projectId: "barrie-scheduler-7844a",
    storageBucket: "barrie-scheduler-7844a.firebasestorage.app",
    messagingSenderId: "456781729862",
    appId: "1:456781729862:web:6e9797875549bc90daba47",
    measurementId: "G-MBMBBD4EMV"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

export default app;
