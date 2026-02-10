import React, { useState, useEffect } from 'react';
import { RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import GoogleSignUpForm from './GoogleSignUpForm';

const PhoneSignIn = ({ onBack }) => {
  const [step, setStep] = useState(1); // 1: phone input, 2: code input, 3: signup
  const [phoneNumber, setPhoneNumber] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [confirmationResult, setConfirmationResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [newUser, setNewUser] = useState(null);

  useEffect(() => {
    // Setup reCAPTCHA
    if (!window.recaptchaVerifier) {
      window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
        size: 'invisible',
        callback: () => {
          console.log('✅ reCAPTCHA solved');
        },
        'expired-callback': () => {
          console.log('⚠️ reCAPTCHA expired');
          setError('Verification expired. Please try again.');
        }
      });
    }

    return () => {
      if (window.recaptchaVerifier) {
        window.recaptchaVerifier.clear();
        window.recaptchaVerifier = null;
      }
    };
  }, []);

  // Show signup form for new users
  if (step === 3 && newUser) {
    return (
      <GoogleSignUpForm
        googleUser={newUser}
        onSuccess={() => {
          setStep(1);
          setNewUser(null);
        }}
        onCancel={() => {
          setStep(1);
          setNewUser(null);
          // Note: Don't sign out here as phone auth is already complete
        }}
      />
    );
  }

  const formatPhoneNumber = (phone) => {
    // Remove all non-digits
    let cleaned = phone.replace(/\D/g, '');

    // If starts with 0, replace with +81 (Japan)
    if (cleaned.startsWith('0')) {
      cleaned = '81' + cleaned.substring(1);
    }

    // If doesn't start with +, add it
    if (!cleaned.startsWith('+')) {
      cleaned = '+' + cleaned;
    } else if (cleaned.startsWith('+')) {
      cleaned = cleaned.substring(1);
    }

    return '+' + cleaned;
  };

  const handleSendCode = async () => {
    if (!phoneNumber.trim()) {
      setError('Please enter your phone number');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const formattedPhone = formatPhoneNumber(phoneNumber);
      console.log('📱 Sending SMS to:', formattedPhone);

      const appVerifier = window.recaptchaVerifier;
      const result = await signInWithPhoneNumber(auth, formattedPhone, appVerifier);

      setConfirmationResult(result);
      setStep(2);
      console.log('✅ SMS sent successfully');

    } catch (err) {
      console.error('❌ Error sending SMS:', err);

      if (err.code === 'auth/invalid-phone-number') {
        setError('Invalid phone number format');
      } else if (err.code === 'auth/too-many-requests') {
        setError('Too many requests. Please try again later.');
      } else if (err.code === 'auth/quota-exceeded') {
        setError('SMS quota exceeded. Please try again tomorrow.');
      } else {
        setError('Failed to send SMS. Please try again.');
      }

      // Reset reCAPTCHA
      if (window.recaptchaVerifier) {
        window.recaptchaVerifier.clear();
        window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
          size: 'invisible'
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!verificationCode.trim()) {
      setError('Please enter the verification code');
      return;
    }

    setLoading(true);
    setError('');

    try {
      console.log('🔐 Verifying code...');
      const result = await confirmationResult.confirm(verificationCode);
      const user = result.user;

      console.log('✅ Phone authentication successful:', user.phoneNumber);

      // Check if user document exists in Firestore
      const userDocRef = doc(db, 'users', user.uid);
      const userDocSnap = await getDoc(userDocRef);

      if (userDocSnap.exists()) {
        // Existing user - login complete
        console.log('✅ Existing phone user - logging in');
        // onAuthStateChanged will handle redirect
      } else {
        // New user - show signup form
        console.log('🆕 New phone user - showing sign up form');
        setNewUser({
          uid: user.uid,
          phoneNumber: user.phoneNumber,
          displayName: '',
          email: '',
          photoURL: ''
        });
        setStep(3);
      }
    } catch (err) {
      console.error('❌ Error verifying code:', err);

      if (err.code === 'auth/invalid-verification-code') {
        setError('Invalid verification code. Please try again.');
      } else if (err.code === 'auth/code-expired') {
        setError('Code expired. Please request a new code.');
        setStep(1);
      } else {
        setError('Verification failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.logoContainer}>
            <span style={styles.icon}>🌍</span>
            <span style={styles.logo}>HARU Studio</span>
            <span style={styles.icon}>✈️</span>
          </div>
          <h2 style={styles.title}>
            {step === 1 ? 'Phone Sign In' : 'Verify Code'}
          </h2>
          <p style={styles.subtitle}>
            {step === 1
              ? 'Enter your phone number to receive a verification code'
              : 'Enter the 6-digit code sent to your phone'}
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div style={styles.errorBox}>
            <span style={styles.errorIcon}>⚠️</span>
            {error}
          </div>
        )}

        {/* Step 1: Phone Number Input */}
        {step === 1 && (
          <div style={styles.formContainer}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Phone Number</label>
              <input
                style={styles.input}
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+81 80-1234-5678 or 080-1234-5678"
                disabled={loading}
                onKeyDown={(e) => e.key === 'Enter' && handleSendCode()}
              />
              <p style={styles.hint}>
                Format: +81 80-1234-5678 or 080-1234-5678
              </p>
            </div>

            <button
              style={styles.primaryButton}
              onClick={handleSendCode}
              disabled={loading}
            >
              {loading ? 'Sending...' : 'Send Verification Code'}
            </button>

            <button
              style={styles.secondaryButton}
              onClick={onBack}
              disabled={loading}
            >
              ← Back to Login
            </button>
          </div>
        )}

        {/* Step 2: Verification Code Input */}
        {step === 2 && (
          <div style={styles.formContainer}>
            <div style={styles.phoneDisplay}>
              <span style={styles.phoneIcon}>📱</span>
              <span style={styles.phoneText}>SMS sent to {phoneNumber}</span>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Verification Code</label>
              <input
                style={styles.codeInput}
                type="text"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                maxLength={6}
                disabled={loading}
                onKeyDown={(e) => e.key === 'Enter' && handleVerifyCode()}
                autoFocus
              />
              <p style={styles.hint}>
                Enter the 6-digit code from SMS
              </p>
            </div>

            <button
              style={styles.primaryButton}
              onClick={handleVerifyCode}
              disabled={loading || verificationCode.length !== 6}
            >
              {loading ? 'Verifying...' : 'Verify Code'}
            </button>

            <button
              style={styles.secondaryButton}
              onClick={() => {
                setStep(1);
                setVerificationCode('');
                setError('');
              }}
              disabled={loading}
            >
              ← Change Phone Number
            </button>
          </div>
        )}

        {/* reCAPTCHA container */}
        <div id="recaptcha-container"></div>
      </div>
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    padding: '20px'
  },
  card: {
    background: '#FFFFFF',
    borderRadius: '20px',
    padding: '40px',
    width: '100%',
    maxWidth: '500px',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)'
  },
  header: {
    textAlign: 'center',
    marginBottom: '32px'
  },
  logoContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    marginBottom: '16px'
  },
  icon: {
    fontSize: '32px'
  },
  logo: {
    fontSize: '28px',
    fontWeight: '700',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text'
  },
  title: {
    fontSize: '28px',
    fontWeight: '700',
    color: '#1E293B',
    margin: '0 0 8px 0'
  },
  subtitle: {
    fontSize: '14px',
    color: '#64748B',
    margin: 0,
    lineHeight: '1.6'
  },
  errorBox: {
    padding: '14px 18px',
    background: '#FEF2F2',
    border: '1px solid #FECACA',
    borderRadius: '10px',
    color: '#DC2626',
    fontSize: '14px',
    marginBottom: '20px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  errorIcon: {
    fontSize: '18px'
  },
  formContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  },
  formGroup: {
    marginBottom: '8px'
  },
  label: {
    display: 'block',
    fontSize: '14px',
    fontWeight: '600',
    color: '#475569',
    marginBottom: '8px'
  },
  input: {
    width: '100%',
    padding: '14px 16px',
    border: '1.5px solid #E2E8F0',
    borderRadius: '10px',
    fontSize: '16px',
    outline: 'none',
    transition: 'border-color 0.2s',
    fontFamily: 'inherit',
    boxSizing: 'border-box'
  },
  codeInput: {
    width: '100%',
    padding: '20px 16px',
    border: '2px solid #E2E8F0',
    borderRadius: '12px',
    fontSize: '32px',
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: '8px',
    outline: 'none',
    transition: 'border-color 0.2s',
    fontFamily: 'monospace',
    boxSizing: 'border-box'
  },
  hint: {
    fontSize: '12px',
    color: '#94A3B8',
    marginTop: '6px',
    margin: '6px 0 0 0'
  },
  phoneDisplay: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '12px',
    background: '#F0F9FF',
    border: '1px solid #BAE6FD',
    borderRadius: '10px',
    marginBottom: '8px'
  },
  phoneIcon: {
    fontSize: '20px'
  },
  phoneText: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#0369A1'
  },
  primaryButton: {
    width: '100%',
    padding: '14px',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    border: 'none',
    borderRadius: '12px',
    color: '#FFFFFF',
    fontSize: '15px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'transform 0.2s',
    boxShadow: '0 4px 12px rgba(102, 126, 234, 0.4)'
  },
  secondaryButton: {
    width: '100%',
    padding: '14px',
    background: '#F1F5F9',
    border: 'none',
    borderRadius: '12px',
    color: '#475569',
    fontSize: '15px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'transform 0.2s'
  }
};

export default PhoneSignIn;
