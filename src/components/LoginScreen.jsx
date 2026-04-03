import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Mail, Lock, ArrowRight, Smartphone, AlertCircle, Building2 } from 'lucide-react';
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
    const [focusedField, setFocusedField] = useState(null);

    const triggerHaptic = async (type = 'light') => {
        if (!Capacitor.isNativePlatform()) return;
        try {
            if (type === 'light') await Haptics.impact({ style: ImpactStyle.Light });
            if (type === 'medium') await Haptics.impact({ style: ImpactStyle.Medium });
            if (type === 'success') await Haptics.notification({ type: NotificationType.Success });
            if (type === 'error') await Haptics.notification({ type: NotificationType.Error });
        } catch (e) {
            console.warn('Haptic error', e);
        }
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

    if (showPhoneSignIn) {
        return <PhoneSignIn onBack={() => setShowPhoneSignIn(false)} />;
    }

    if (showGoogleSignUp && googleUser) {
        return (
            <GoogleSignUpForm
                googleUser={googleUser}
                onSuccess={() => {
                    setShowGoogleSignUp(false);
                    setGoogleUser(null);
                }}
                onCancel={() => {
                    setShowGoogleSignUp(false);
                    setGoogleUser(null);
                    signOut(auth);
                }}
            />
        );
    }

    if (showSignUp) {
        return (
            <SignUpForm
                onSuccess={() => setShowSignUp(false)}
                onBackToLogin={() => setShowSignUp(false)}
            />
        );
    }

    const inputBaseStyle = {
        width: '100%',
        height: '58px',
        padding: '0 56px 0 18px',
        borderRadius: '18px',
        border: '1px solid #E2E8F0',
        background: '#F8FAFC',
        color: '#0F172A',
        fontSize: '15px',
        fontWeight: '500',
        outline: 'none',
        transition: 'all 0.2s ease'
    };

    return (
        <div style={{
            minHeight: '100vh',
            background: '#F1F5F9',
            color: '#0F172A',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
        }}>
            <style>{`
                .haru-login-shell {
                    min-height: 100vh;
                    display: flex;
                    flex-direction: column;
                }
                .haru-login-main {
                    flex: 1;
                    display: flex;
                    min-height: 100vh;
                }
                .haru-login-brand {
                    flex: 1 1 50%;
                    background:
                        radial-gradient(circle at top right, rgba(79, 70, 229, 0.18), transparent 32%),
                        radial-gradient(circle at bottom left, rgba(99, 102, 241, 0.12), transparent 26%),
                        linear-gradient(180deg, #1E293B 0%, #0F172A 100%);
                    color: white;
                    padding: 48px 56px;
                    position: relative;
                    overflow: hidden;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .haru-login-form-side {
                    flex: 1 1 50%;
                    background:
                        radial-gradient(circle at top right, rgba(79, 70, 229, 0.06), transparent 24%),
                        #F1F5F9;
                    padding: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    position: relative;
                }
                .haru-login-card {
                    width: 100%;
                    max-width: 500px;
                    background: rgba(255, 255, 255, 0.92);
                    backdrop-filter: blur(12px);
                    border: 1px solid rgba(255, 255, 255, 0.85);
                    border-radius: 36px;
                    box-shadow: 0 24px 60px rgba(15, 23, 42, 0.10);
                    padding: 42px;
                    position: relative;
                    z-index: 2;
                }
                .haru-login-field::placeholder {
                    color: #94A3B8;
                }
                .haru-login-field:focus {
                    background: #FFFFFF;
                    border-color: rgba(79, 70, 229, 0.28);
                    box-shadow: 0 0 0 4px rgba(79, 70, 229, 0.10);
                }
                .haru-login-action:hover {
                    transform: translateY(-1px);
                    box-shadow: 0 12px 24px rgba(79, 70, 229, 0.22);
                }
                .haru-login-alt:hover {
                    background: #EEF2FF;
                    border-color: rgba(79, 70, 229, 0.18);
                }
                @media (max-width: 1024px) {
                    .haru-login-main {
                        flex-direction: column;
                    }
                    .haru-login-brand {
                        min-height: 320px;
                        padding: 36px 28px;
                    }
                    .haru-login-form-side {
                        padding: 24px 18px 32px;
                    }
                    .haru-login-card {
                        max-width: 100%;
                        padding: 30px 22px;
                        border-radius: 28px;
                    }
                }
                @media (max-width: 640px) {
                    .haru-login-brand {
                        min-height: 280px;
                    }
                    .haru-login-card {
                        padding: 26px 18px;
                        border-radius: 24px;
                    }
                }
            `}</style>
            <div className="haru-login-shell">
                <main className="haru-login-main">
                    <section className="haru-login-brand">
                        <motion.div
                            initial={{ opacity: 0, x: -24 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.55, ease: "easeOut" }}
                            style={{
                                width: '100%',
                                maxWidth: '520px',
                                position: 'relative',
                                zIndex: 2
                            }}
                        >
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '18px',
                                marginBottom: '36px'
                            }}>
                                <div style={{
                                    width: '68px',
                                    height: '68px',
                                    borderRadius: '22px',
                                    background: 'rgba(255,255,255,0.10)',
                                    border: '1px solid rgba(255,255,255,0.16)',
                                    boxShadow: '0 18px 40px rgba(15, 23, 42, 0.25)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}>
                                    <span style={{
                                        fontSize: '30px',
                                        fontWeight: '800',
                                        letterSpacing: '-1px',
                                        color: 'white'
                                    }}>
                                        H
                                    </span>
                                </div>
                                <div>
                                    <h1 style={{
                                        margin: 0,
                                        fontSize: '34px',
                                        lineHeight: 1.05,
                                        letterSpacing: '-1px',
                                        fontWeight: '800'
                                    }}>
                                        Haru Studio
                                    </h1>
                                    <p style={{
                                        margin: '8px 0 0',
                                        fontSize: '12px',
                                        letterSpacing: '0.14em',
                                        textTransform: 'uppercase',
                                        color: 'rgba(226, 232, 240, 0.78)',
                                        fontWeight: '700'
                                    }}>
                                        Property Management System
                                    </p>
                                </div>
                            </div>

                            <div style={{
                                width: '72px',
                                height: '2px',
                                background: 'linear-gradient(90deg, rgba(255,255,255,0.8), rgba(255,255,255,0))',
                                marginBottom: '28px'
                            }} />

                            <h2 style={{
                                margin: 0,
                                maxWidth: '460px',
                                fontSize: '42px',
                                lineHeight: 1.12,
                                letterSpacing: '-1.6px',
                                fontWeight: '800'
                            }}>
                                Control bookings, pricing, and operations from one reliable workspace.
                            </h2>

                            <p style={{
                                margin: '20px 0 0',
                                maxWidth: '430px',
                                fontSize: '16px',
                                lineHeight: 1.8,
                                color: 'rgba(226, 232, 240, 0.82)',
                                fontWeight: '500'
                            }}>
                                Log in to manage reservations, pricing updates, occupancy signals, and team workflows across your properties.
                            </p>

                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                                gap: '14px',
                                marginTop: '36px'
                            }}>
                                {[
                                    "Real-time booking sync",
                                    "Beds24 pricing control",
                                    "Gap-night min stay handling",
                                    "Multi-property dashboard"
                                ].map((item) => (
                                    <div key={item} style={{
                                        padding: '16px 18px',
                                        borderRadius: '18px',
                                        background: 'rgba(255,255,255,0.06)',
                                        border: '1px solid rgba(255,255,255,0.10)',
                                        color: 'rgba(248, 250, 252, 0.92)',
                                        fontSize: '13px',
                                        fontWeight: '700',
                                        lineHeight: 1.5
                                    }}>
                                        {item}
                                    </div>
                                ))}
                            </div>

                            <div style={{
                                position: 'absolute',
                                left: 0,
                                bottom: '-70px',
                                width: '220px',
                                height: '220px',
                                background: 'rgba(79, 70, 229, 0.20)',
                                filter: 'blur(80px)',
                                borderRadius: '50%'
                            }} />
                        </motion.div>
                    </section>

                    <section className="haru-login-form-side">
                        <div style={{
                            position: 'absolute',
                            top: '10%',
                            right: '-4%',
                            width: '240px',
                            height: '240px',
                            background: 'rgba(79, 70, 229, 0.10)',
                            filter: 'blur(72px)',
                            borderRadius: '50%'
                        }} />

                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.55, delay: 0.12, ease: "easeOut" }}
                            className="haru-login-card"
                        >
                            <div style={{ marginBottom: '34px' }}>
                                <div style={{
                                    width: '52px',
                                    height: '52px',
                                    borderRadius: '18px',
                                    background: 'linear-gradient(135deg, rgba(79, 70, 229, 0.12), rgba(79, 70, 229, 0.04))',
                                    border: '1px solid rgba(79, 70, 229, 0.12)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    marginBottom: '18px'
                                }}>
                                    <Building2 size={24} color="#4F46E5" />
                                </div>
                                <h2 style={{
                                    margin: 0,
                                    color: '#0F172A',
                                    fontSize: '32px',
                                    lineHeight: 1.1,
                                    fontWeight: '800',
                                    letterSpacing: '-1px'
                                }}>
                                    Welcome back
                                </h2>
                                <p style={{
                                    margin: '10px 0 0',
                                    fontSize: '15px',
                                    lineHeight: 1.7,
                                    color: '#64748B',
                                    fontWeight: '500'
                                }}>
                                    Sign in to access your properties, pricing controls, and operational insights.
                                </p>
                            </div>

                            <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                                <div>
                                    <label htmlFor="login-email" style={{
                                        display: 'block',
                                        marginBottom: '8px',
                                        fontSize: '11px',
                                        fontWeight: '800',
                                        letterSpacing: '0.16em',
                                        textTransform: 'uppercase',
                                        color: '#64748B'
                                    }}>
                                        Email Address
                                    </label>
                                    <div style={{ position: 'relative' }}>
                                        <input
                                            id="login-email"
                                            className="haru-login-field"
                                            type="email"
                                            placeholder="name@company.com"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            onFocus={() => setFocusedField('email')}
                                            onBlur={() => setFocusedField(null)}
                                            style={{
                                                ...inputBaseStyle,
                                                borderColor: focusedField === 'email' ? 'rgba(79, 70, 229, 0.28)' : '#E2E8F0',
                                                background: focusedField === 'email' ? '#FFFFFF' : '#F8FAFC'
                                            }}
                                        />
                                        <Mail
                                            size={18}
                                            style={{
                                                position: 'absolute',
                                                right: '18px',
                                                top: '50%',
                                                transform: 'translateY(-50%)',
                                                color: focusedField === 'email' ? '#4F46E5' : '#94A3B8',
                                                transition: 'color 0.2s ease'
                                            }}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <div style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        marginBottom: '8px'
                                    }}>
                                        <label htmlFor="login-password" style={{
                                            fontSize: '11px',
                                            fontWeight: '800',
                                            letterSpacing: '0.16em',
                                            textTransform: 'uppercase',
                                            color: '#64748B'
                                        }}>
                                            Password
                                        </label>
                                        <span style={{
                                            fontSize: '12px',
                                            color: '#4F46E5',
                                            fontWeight: '700',
                                            opacity: 0.9
                                        }}>
                                            Contact admin for reset
                                        </span>
                                    </div>
                                    <div style={{ position: 'relative' }}>
                                        <input
                                            id="login-password"
                                            className="haru-login-field"
                                            type="password"
                                            placeholder="Enter your password"
                                            value={pw}
                                            onChange={(e) => setPw(e.target.value)}
                                            onFocus={() => setFocusedField('pw')}
                                            onBlur={() => setFocusedField(null)}
                                            onKeyDown={(e) => e.key === 'Enter' && handleLogin(e)}
                                            style={{
                                                ...inputBaseStyle,
                                                borderColor: focusedField === 'pw' ? 'rgba(79, 70, 229, 0.28)' : '#E2E8F0',
                                                background: focusedField === 'pw' ? '#FFFFFF' : '#F8FAFC'
                                            }}
                                        />
                                        <Lock
                                            size={18}
                                            style={{
                                                position: 'absolute',
                                                right: '18px',
                                                top: '50%',
                                                transform: 'translateY(-50%)',
                                                color: focusedField === 'pw' ? '#4F46E5' : '#94A3B8',
                                                transition: 'color 0.2s ease'
                                            }}
                                        />
                                    </div>
                                </div>

                                {error && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -8 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '10px',
                                            padding: '14px 16px',
                                            borderRadius: '16px',
                                            background: '#FEF2F2',
                                            border: '1px solid #FECACA',
                                            color: '#B91C1C',
                                            fontSize: '13px',
                                            fontWeight: '600'
                                        }}
                                    >
                                        <AlertCircle size={16} />
                                        <span>{error}</span>
                                    </motion.div>
                                )}

                                <motion.button
                                    whileTap={{ scale: 0.985 }}
                                    type="submit"
                                    disabled={loading}
                                    className="haru-login-action"
                                    style={{
                                        width: '100%',
                                        height: '58px',
                                        border: 'none',
                                        borderRadius: '18px',
                                        background: loading ? '#A5B4FC' : '#4F46E5',
                                        color: 'white',
                                        cursor: loading ? 'not-allowed' : 'pointer',
                                        boxShadow: '0 16px 30px rgba(79, 70, 229, 0.18)',
                                        fontSize: '16px',
                                        fontWeight: '800',
                                        letterSpacing: '-0.2px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '10px',
                                        transition: 'all 0.2s ease',
                                        marginTop: '2px'
                                    }}
                                >
                                    {loading ? 'Authenticating...' : (
                                        <>
                                            Sign In
                                            <ArrowRight size={18} />
                                        </>
                                    )}
                                </motion.button>
                            </form>

                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                                margin: '28px 0 24px'
                            }}>
                                <div style={{ flex: 1, height: '1px', background: '#E2E8F0' }} />
                                <span style={{
                                    fontSize: '10px',
                                    fontWeight: '800',
                                    letterSpacing: '0.18em',
                                    textTransform: 'uppercase',
                                    color: '#94A3B8'
                                }}>
                                    Or continue with
                                </span>
                                <div style={{ flex: 1, height: '1px', background: '#E2E8F0' }} />
                            </div>

                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                                gap: '12px'
                            }}>
                                <motion.button
                                    whileTap={{ scale: 0.985 }}
                                    type="button"
                                    disabled={loading}
                                    onClick={handleGoogleLogin}
                                    className="haru-login-alt"
                                    style={{
                                        minHeight: '54px',
                                        borderRadius: '18px',
                                        border: '1px solid #E2E8F0',
                                        background: '#FFFFFF',
                                        color: '#0F172A',
                                        fontSize: '14px',
                                        fontWeight: '800',
                                        cursor: loading ? 'not-allowed' : 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '10px',
                                        transition: 'all 0.2s ease'
                                    }}
                                >
                                    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                                    </svg>
                                    Google
                                </motion.button>

                                <motion.button
                                    whileTap={{ scale: 0.985 }}
                                    type="button"
                                    disabled={loading}
                                    onClick={() => setShowPhoneSignIn(true)}
                                    className="haru-login-alt"
                                    style={{
                                        minHeight: '54px',
                                        borderRadius: '18px',
                                        border: '1px solid #E2E8F0',
                                        background: '#FFFFFF',
                                        color: '#0F172A',
                                        fontSize: '14px',
                                        fontWeight: '800',
                                        cursor: loading ? 'not-allowed' : 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '10px',
                                        transition: 'all 0.2s ease'
                                    }}
                                >
                                    <Smartphone size={17} />
                                    Phone
                                </motion.button>
                            </div>

                            <div style={{
                                marginTop: '28px',
                                paddingTop: '22px',
                                borderTop: '1px solid #E2E8F0',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '16px',
                                flexWrap: 'wrap'
                            }}>
                                <span style={{
                                    fontSize: '13px',
                                    color: '#64748B',
                                    fontWeight: '600'
                                }}>
                                    New to Haru Studio?
                                </span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowSignUp(true);
                                        setError("");
                                    }}
                                    style={{
                                        border: 'none',
                                        background: 'transparent',
                                        color: '#4F46E5',
                                        fontSize: '13px',
                                        fontWeight: '800',
                                        cursor: 'pointer',
                                        padding: 0
                                    }}
                                >
                                    Create account
                                </button>
                            </div>
                        </motion.div>
                    </section>
                </main>
            </div>
        </div>
    );
};

export default LoginScreen;
