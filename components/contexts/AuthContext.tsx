import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import {
    User,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPopup,
    signOut as firebaseSignOut,
    sendPasswordResetEmail,
    getIdTokenResult
} from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { auth, googleProvider } from '../../utils/firebase';
import { db } from '../../utils/firebase';
import { getDevAuthConfig } from '../../utils/dev/devAuth';

const LOCAL_AUTH_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

const getCurrentHostname = (): string => (
    typeof window === 'undefined' ? '' : window.location.hostname.toLowerCase()
);

export const isBlockedProductionDevEmail = (
    email: string | null | undefined,
    hostname = getCurrentHostname(),
): boolean => {
    const normalizedEmail = email?.trim().toLowerCase() ?? '';
    const normalizedHost = hostname.trim().toLowerCase();
    return (
        !LOCAL_AUTH_HOSTS.has(normalizedHost) &&
        normalizedEmail.startsWith('codex.dev.') &&
        normalizedEmail.endsWith('@example.com')
    );
};

interface AuthContextType {
    user: User | null;
    loading: boolean;
    signIn: (email: string, password: string) => Promise<void>;
    signUp: (email: string, password: string) => Promise<void>;
    signInWithGoogle: () => Promise<void>;
    signOut: () => Promise<void>;
    resetPassword: (email: string) => Promise<void>;
    signInWithDevAccess: () => Promise<void>;
    hasDevAccess: boolean;
    devAccessLabel: string | null;
    isGlobalAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = (): AuthContextType => {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};

interface AuthProviderProps {
    children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [isGlobalAdmin, setIsGlobalAdmin] = useState(false);
    const devAuth = getDevAuthConfig();

    /**
     * Ensure user document exists in Firestore with teamId field
     */
    const ensureUserDocument = async (user: User) => {
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
            // Create user document with default values
            await setDoc(userRef, {
                email: user.email,
                displayName: user.displayName || user.email?.split('@')[0] || 'User',
                teamId: null,
                createdAt: new Date()
            });
        }
    };

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user) {
                if (isBlockedProductionDevEmail(user.email)) {
                    console.warn('Blocked a local dev test account from using production.');
                    setIsGlobalAdmin(false);
                    setUser(null);
                    setLoading(false);
                    await firebaseSignOut(auth).catch((error) => {
                        console.error('Error signing out blocked dev test account:', error);
                    });
                    return;
                }

                // Ensure user document exists in Firestore
                try {
                    await ensureUserDocument(user);
                    const token = await getIdTokenResult(user);
                    setIsGlobalAdmin(
                        token.claims.schedulerAdmin === true ||
                        token.claims.admin === true ||
                        token.claims.globalAdmin === true
                    );
                } catch (error) {
                    console.error('Error ensuring user document:', error);
                    setIsGlobalAdmin(false);
                }
            } else {
                setIsGlobalAdmin(false);
            }
            setUser(user);
            setLoading(false);
        });
        return unsubscribe;
    }, []);

    useEffect(() => {
        if (!devAuth.enabled || !devAuth.autoLogin || user || loading) return;

        void signInWithEmailAndPassword(auth, devAuth.email!, devAuth.password!).catch((error) => {
            console.error('Failed to auto sign in with dev access:', error);
        });
    }, [devAuth.autoLogin, devAuth.email, devAuth.enabled, devAuth.password, loading, user]);

    const signIn = async (email: string, password: string) => {
        if (isBlockedProductionDevEmail(email)) {
            throw new Error('This local dev test account is not allowed on production.');
        }
        await signInWithEmailAndPassword(auth, email, password);
    };

    const signUp = async (email: string, password: string) => {
        await createUserWithEmailAndPassword(auth, email, password);
    };

    const signInWithGoogle = async () => {
        await signInWithPopup(auth, googleProvider);
    };

    const signOut = async () => {
        await firebaseSignOut(auth);
    };

    const resetPassword = async (email: string) => {
        await sendPasswordResetEmail(auth, email);
    };

    const signInWithDevAccess = async () => {
        if (!devAuth.enabled || !devAuth.email || !devAuth.password) {
            throw new Error('Dev access is not configured for this local environment.');
        }
        await signInWithEmailAndPassword(auth, devAuth.email, devAuth.password);
    };

    const value: AuthContextType = {
        user,
        loading,
        signIn,
        signUp,
        signInWithGoogle,
        signOut,
        resetPassword,
        signInWithDevAccess,
        hasDevAccess: devAuth.enabled,
        devAccessLabel: devAuth.enabled ? devAuth.label : null,
        isGlobalAdmin,
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};
