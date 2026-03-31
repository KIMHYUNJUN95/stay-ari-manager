import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { User, Lock, ArrowRight, Smartphone, AlertCircle } from 'lucide-react';
import { signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut } from "firebase/auth";
import { auth, db } from '../firebase';
import { doc, getDoc } from "firebase/firestore";
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Capacitor } from '@capacitor/core';
import PhoneSignIn from './PhoneSignIn';
import GoogleSignUpForm from './GoogleSignUpForm';
import SignUpForm from './SignUpForm';

const LoginScreen = ({ incompleteSignup }) => {
    const [email, setEmail] = useState("");
    const [pw, setPw] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(incompleteSignup ? "Account setup incomplete." : "");
    const [showPhoneSignIn, setShowPhoneSignIn] = useState(false);
    const [showGoogleSignUp, setShowGoogleSignUp] = useState(false);
    const [showSignUp, setShowSignUp] = useState(false);
    const [googleUser, setGoogleUser] = useState(null);

    // Focus states for micro-interactions
    const [focusedField, setFocusedField] = useState(null);

    // Haptic Helper
    const triggerHaptic = async (type = 'light') => {
        if (!Capacitor.isNativePlatform()) return;
        try {
            if (type === 'light') await Haptics.impact({ style: ImpactStyle.Light });
            if (type === 'medium') await Haptics.impact({ style: ImpactStyle.Medium });
            if (type === 'success') await Haptics.notification({ type: NotificationType.Success });
            if (type === 'error') await Haptics.notification({ type: NotificationType.Error });
        } catch (e) { console.warn('Haptic error', e); }
    };

    const handleLogin = async (e) => {
        if (e) e.preventDefault();
        if (!email || !pw) {
            setError("Please fill in all fields");
            triggerHaptic('error');
            return;
        }

        triggerHaptic('medium');
        setLoading(true);
        setError("");

        try {
            await signInWithEmailAndPassword(auth, email, pw);
            triggerHaptic('success');
            // Login success is handled by onAuthStateChanged in App.jsx
        } catch (err) {
            console.error(err);
            setError("Invalid credentials or network error");
            triggerHaptic('error');
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleLogin = async () => {
        triggerHaptic('medium');
        setLoading(true);
        setError("");

        try {
            const provider = new GoogleAuthProvider();
            const result = await signInWithPopup(auth, provider);
            const user = result.user;

            // Check Firestore
            const userDocRef = doc(db, 'users', user.uid);
            const userDocSnap = await getDoc(userDocRef);

            if (userDocSnap.exists()) {
                triggerHaptic('success');
            } else {
                triggerHaptic('light');
                setGoogleUser({
                    uid: user.uid,
                    email: user.email,
                    displayName: user.displayName,
                    photoURL: user.photoURL
                });
                setShowGoogleSignUp(true);
            }
        } catch (err) {
            console.error('Google login error:', err);
            setError("Google Sign-In failed");
            triggerHaptic('error');
        } finally {
            setLoading(false);
        }
    };

    // Sub-Flows
    if (showPhoneSignIn) return <PhoneSignIn onBack={() => setShowPhoneSignIn(false)} />;
    if (showGoogleSignUp && googleUser) return <GoogleSignUpForm googleUser={googleUser} onSuccess={() => { setShowGoogleSignUp(false); setGoogleUser(null); }} onCancel={() => { setShowGoogleSignUp(false); setGoogleUser(null); signOut(auth); }} />;
    if (showSignUp) return <SignUpForm onSuccess={() => setShowSignUp(false)} onBackToLogin={() => setShowSignUp(false)} />;

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            overflow: 'hidden',
            background: 'linear-gradient(135deg, #4F46E5 0%, #0F172A 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", sans-serif'
        }}>

            {/* Ambient Background Elements */}
            <div style={{ position: 'absolute', top: '-10%', left: '-10%', width: '60%', height: '60%', background: 'rgba(99, 102, 241, 0.2)', filter: 'blur(100px)', borderRadius: '50%' }} />
            <div style={{ position: 'absolute', bottom: '-10%', right: '-10%', width: '60%', height: '60%', background: 'rgba(168, 85, 247, 0.2)', filter: 'blur(100px)', borderRadius: '50%' }} />

            <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                style={{
                    position: 'relative',
                    zIndex: 10,
                    width: '100%',
                    maxWidth: '400px',
                    padding: '24px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center'
                }}
            >
                {/* Brand Logo */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '40px' }}>
                    <motion.div
                        animate={{ y: [0, -8, 0] }}
                        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                        style={{
                            width: '80px', height: '80px',
                            background: 'rgba(255, 255, 255, 0.1)',
                            backdropFilter: 'blur(20px)',
                            borderRadius: '24px',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
                            border: '1px solid rgba(255, 255, 255, 0.2)',
                            marginBottom: '20px',
                            fontSize: '36px'
                        }}
                    >
                        🌍
                    </motion.div>
                    <h1 style={{ fontSize: '28px', fontWeight: '800', color: 'white', letterSpacing: '-0.5px', margin: 0 }}>Haru Studio</h1>
                    <p style={{ color: '#A5B4FC', marginTop: '8px', fontSize: '13px', fontWeight: '600', letterSpacing: '1px', textTransform: 'uppercase', opacity: 0.9 }}>Enterprise Edition</p>
                </div>

                {/* Login Card */}
                <div style={{
                    width: '100%',
                    background: 'rgba(255, 255, 255, 0.1)',
                    backdropFilter: 'blur(24px)',
                    borderRadius: '24px',
                    padding: '24px',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    boxShadow: '0 20px 40px rgba(0, 0, 0, 0.2)'
                }}>

                    {/* Email Input */}
                    <div style={{ marginBottom: '16px', position: 'relative' }}>
                        <div style={{
                            position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)',
                            color: focusedField === 'email' ? 'white' : 'rgba(255,255,255,0.5)', transition: 'color 0.2s'
                        }}>
                            <User size={20} />
                        </div>
                        <input
                            type="email"
                            placeholder="Email Address"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            onFocus={() => setFocusedField('email')}
                            onBlur={() => setFocusedField(null)}
                            style={{
                                width: '100%',
                                height: '56px',
                                padding: '0 16px 0 50px',
                                background: focusedField === 'email' ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                                border: focusedField === 'email' ? '1px solid rgba(255, 255, 255, 0.5)' : '1px solid rgba(255, 255, 255, 0.1)',
                                borderRadius: '16px',
                                color: 'white',
                                fontSize: '16px',
                                outline: 'none',
                                transition: 'all 0.2s ease'
                            }}
                        />
                    </div>

                    {/* Password Input */}
                    <div style={{ marginBottom: '24px', position: 'relative' }}>
                        <div style={{
                            position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)',
                            color: focusedField === 'pw' ? 'white' : 'rgba(255,255,255,0.5)', transition: 'color 0.2s'
                        }}>
                            <Lock size={20} />
                        </div>
                        <input
                            type="password"
                            placeholder="Password"
                            value={pw}
                            onChange={(e) => setPw(e.target.value)}
                            onFocus={() => setFocusedField('pw')}
                            onBlur={() => setFocusedField(null)}
                            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                            style={{
                                width: '100%',
                                height: '56px',
                                padding: '0 16px 0 50px',
                                background: focusedField === 'pw' ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                                border: focusedField === 'pw' ? '1px solid rgba(255, 255, 255, 0.5)' : '1px solid rgba(255, 255, 255, 0.1)',
                                borderRadius: '16px',
                                color: 'white',
                                fontSize: '16px',
                                outline: 'none',
                                transition: 'all 0.2s ease'
                            }}
                        />
                    </div>

                    {error && (
                        <motion.div
                            initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
                            style={{
                                marginBottom: '20px', padding: '12px', borderRadius: '12px',
                                background: 'rgba(239, 68, 68, 0.2)', border: '1px solid rgba(239, 68, 68, 0.3)',
                                color: '#FECACA', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px'
                            }}
                        >
                            <AlertCircle size={16} /> {error}
                        </motion.div>
                    )}

                    {/* Login Button */}
                    <motion.button
                        whileTap={{ scale: 0.96 }}
                        onClick={handleLogin}
                        disabled={loading}
                        style={{
                            width: '100%',
                            height: '56px',
                            border: 'none',
                            borderRadius: '16px',
                            background: loading ? 'rgba(255,255,255,0.2)' : 'white',
                            color: loading ? 'rgba(255,255,255,0.6)' : '#4F46E5',
                            fontSize: '16px',
                            fontWeight: '700',
                            cursor: loading ? 'not-allowed' : 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                            marginBottom: '24px'
                        }}
                    >
                        {loading ? 'Authenticating...' : (
                            <>
                                Sign In <ArrowRight size={20} />
                            </>
                        )}
                    </motion.button>

                    {/* Social Login Options */}
                    <div style={{ display: 'flex', gap: '12px' }}>
                        <motion.button
                            whileTap={{ scale: 0.96 }}
                            onClick={handleGoogleLogin}
                            style={{
                                flex: 1,
                                height: '48px',
                                borderRadius: '12px',
                                border: '1px solid rgba(255, 255, 255, 0.2)',
                                background: 'rgba(255, 255, 255, 0.05)',
                                color: 'white',
                                fontSize: '14px',
                                fontWeight: '600',
                                cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
                            }}
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                            </svg>
                            Google
                        </motion.button>

                        <motion.button
                            whileTap={{ scale: 0.96 }}
                            onClick={() => setShowPhoneSignIn(true)}
                            style={{
                                flex: 1,
                                height: '48px',
                                borderRadius: '12px',
                                border: '1px solid rgba(255, 255, 255, 0.2)',
                                background: 'rgba(255, 255, 255, 0.05)',
                                color: 'white',
                                fontSize: '14px',
                                fontWeight: '600',
                                cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
                            }}
                        >
                            <Smartphone size={18} />
                            Phone
                        </motion.button>
                    </div>
                </div>

                {/* Footer Actions */}
                <div style={{ marginTop: '32px', display: 'flex', gap: '24px' }}>
                    <span onClick={() => { setShowSignUp(true); setError(""); }} style={{ color: 'rgba(255,255,255,0.7)', fontSize: '13px', cursor: 'pointer', fontWeight: '500' }}>Create Account</span>
                    <span style={{ color: 'rgba(255,255,255,0.3)' }}>|</span>
                    <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '13px', cursor: 'pointer', fontWeight: '500' }}>Forgot Password?</span>
                </div>

            </motion.div>
        </div>
    );
};

export default LoginScreen;
