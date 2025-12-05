import React, { useState } from 'react';
import { useAuth } from './AuthContext';
import { X, Mail, Lock, User, Loader2, AlertCircle } from 'lucide-react';

interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
    const { signIn, signUp, signInWithGoogle, resetPassword } = useAuth();
    const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccessMessage('');
        setLoading(true);

        try {
            if (mode === 'signin') {
                await signIn(email, password);
                onClose();
            } else if (mode === 'signup') {
                if (password !== confirmPassword) {
                    setError('Passwords do not match');
                    setLoading(false);
                    return;
                }
                if (password.length < 6) {
                    setError('Password must be at least 6 characters');
                    setLoading(false);
                    return;
                }
                await signUp(email, password);
                onClose();
            } else if (mode === 'reset') {
                await resetPassword(email);
                setSuccessMessage('Password reset email sent! Check your inbox.');
            }
        } catch (err: any) {
            let message = 'An error occurred';
            if (err.code === 'auth/user-not-found') {
                message = 'No account found with this email';
            } else if (err.code === 'auth/wrong-password') {
                message = 'Incorrect password';
            } else if (err.code === 'auth/email-already-in-use') {
                message = 'An account with this email already exists';
            } else if (err.code === 'auth/invalid-email') {
                message = 'Invalid email address';
            } else if (err.code === 'auth/weak-password') {
                message = 'Password is too weak';
            } else if (err.message) {
                message = err.message;
            }
            setError(message);
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleSignIn = async () => {
        setError('');
        setLoading(true);
        try {
            await signInWithGoogle();
            onClose();
        } catch (err: any) {
            setError(err.message || 'Failed to sign in with Google');
        } finally {
            setLoading(false);
        }
    };

    const switchMode = (newMode: 'signin' | 'signup' | 'reset') => {
        setMode(newMode);
        setError('');
        setSuccessMessage('');
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-300">
                {/* Header */}
                <div className="bg-gradient-to-r from-brand-green to-emerald-500 px-6 py-8 text-white relative">
                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 p-2 hover:bg-white/20 rounded-xl transition-colors"
                    >
                        <X size={20} />
                    </button>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="bg-white/20 p-2 rounded-xl">
                            <User size={24} />
                        </div>
                        <h2 className="text-2xl font-extrabold">
                            {mode === 'signin' ? 'Welcome Back' : mode === 'signup' ? 'Create Account' : 'Reset Password'}
                        </h2>
                    </div>
                    <p className="text-white/80 font-medium">
                        {mode === 'signin'
                            ? 'Sign in to access your schedules'
                            : mode === 'signup'
                                ? 'Start managing your transit schedules'
                                : 'We\'ll send you a reset link'}
                    </p>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    {error && (
                        <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl flex items-center gap-2 text-sm font-medium">
                            <AlertCircle size={18} />
                            {error}
                        </div>
                    )}

                    {successMessage && (
                        <div className="bg-green-50 text-green-600 px-4 py-3 rounded-xl text-sm font-medium">
                            {successMessage}
                        </div>
                    )}

                    {/* Email Input */}
                    <div className="relative">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                        <input
                            type="email"
                            placeholder="Email address"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            className="w-full pl-12 pr-4 py-3 bg-gray-50 border-2 border-gray-200 rounded-xl focus:border-brand-green focus:bg-white outline-none transition-all font-medium"
                        />
                    </div>

                    {/* Password Input (not for reset) */}
                    {mode !== 'reset' && (
                        <div className="relative">
                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                            <input
                                type="password"
                                placeholder="Password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                className="w-full pl-12 pr-4 py-3 bg-gray-50 border-2 border-gray-200 rounded-xl focus:border-brand-green focus:bg-white outline-none transition-all font-medium"
                            />
                        </div>
                    )}

                    {/* Confirm Password (signup only) */}
                    {mode === 'signup' && (
                        <div className="relative">
                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                            <input
                                type="password"
                                placeholder="Confirm password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                required
                                className="w-full pl-12 pr-4 py-3 bg-gray-50 border-2 border-gray-200 rounded-xl focus:border-brand-green focus:bg-white outline-none transition-all font-medium"
                            />
                        </div>
                    )}

                    {/* Submit Button */}
                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-brand-green hover:bg-emerald-600 text-white font-bold py-3 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {loading && <Loader2 className="animate-spin" size={20} />}
                        {mode === 'signin' ? 'Sign In' : mode === 'signup' ? 'Create Account' : 'Send Reset Link'}
                    </button>

                    {/* Mode Switchers */}
                    <div className="text-center pt-2 space-y-2">
                        {mode === 'signin' && (
                            <>
                                <button
                                    type="button"
                                    onClick={() => switchMode('reset')}
                                    className="text-sm text-gray-500 hover:text-brand-green font-medium"
                                >
                                    Forgot your password?
                                </button>
                                <p className="text-gray-500 font-medium">
                                    Don't have an account?{' '}
                                    <button
                                        type="button"
                                        onClick={() => switchMode('signup')}
                                        className="text-brand-green hover:underline font-bold"
                                    >
                                        Sign up
                                    </button>
                                </p>
                            </>
                        )}
                        {mode === 'signup' && (
                            <p className="text-gray-500 font-medium">
                                Already have an account?{' '}
                                <button
                                    type="button"
                                    onClick={() => switchMode('signin')}
                                    className="text-brand-green hover:underline font-bold"
                                >
                                    Sign in
                                </button>
                            </p>
                        )}
                        {mode === 'reset' && (
                            <button
                                type="button"
                                onClick={() => switchMode('signin')}
                                className="text-brand-green hover:underline font-bold"
                            >
                                Back to sign in
                            </button>
                        )}
                    </div>
                </form>
            </div>
        </div>
    );
};
