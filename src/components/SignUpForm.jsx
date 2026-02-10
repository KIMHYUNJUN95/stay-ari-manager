import React, { useState } from 'react';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, collection, addDoc, query, where, getDocs, updateDoc, increment } from 'firebase/firestore';
import { auth, db } from '../firebase';

// Country list
const COUNTRIES = [
  'South Korea', 'Japan', 'China', 'Taiwan', 'Hong Kong',
  'United States', 'United Kingdom', 'Canada', 'Australia',
  'Singapore', 'Thailand', 'Vietnam', 'Philippines', 'Malaysia',
  'Indonesia', 'India', 'Germany', 'France', 'Spain', 'Italy'
].sort();

// Property types
const PROPERTY_TYPES = [
  'Hotel', 'Hostel', 'Guesthouse', 'Apartment', 'Resort', 'Motel', 'Other'
];

// Timezones
const TIMEZONES = [
  'Asia/Seoul', 'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Taipei',
  'Asia/Hong_Kong', 'Asia/Singapore', 'America/New_York',
  'America/Los_Angeles', 'Europe/London', 'Australia/Sydney'
];

const SignUpForm = ({ onSuccess, onBackToLogin }) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Form data
  const [formData, setFormData] = useState({
    // Step 1: Basic
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    inviteCode: '',  // 초대 코드 (선택사항)

    // Step 2: Contact
    phone: '',
    country: 'South Korea',

    // Step 3: Business (Optional)
    businessName: '',
    registrationNumber: '',
    address: '',
    propertyType: 'Hotel',
    numberOfRooms: '',

    // Step 4: Additional
    profileImage: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul',
    agreeTerms: false
  });

  const updateField = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setError('');
  };

  // Validation for each step
  const validateStep = (step) => {
    switch (step) {
      case 1:
        if (!formData.fullName.trim()) {
          setError('Please enter your full name');
          return false;
        }
        if (!formData.email.trim()) {
          setError('Please enter your email');
          return false;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
          setError('Please enter a valid email address');
          return false;
        }
        if (!formData.password) {
          setError('Please enter a password');
          return false;
        }
        if (formData.password.length < 6) {
          setError('Password must be at least 6 characters');
          return false;
        }
        if (formData.password !== formData.confirmPassword) {
          setError('Passwords do not match');
          return false;
        }
        return true;

      case 2:
        if (!formData.phone.trim()) {
          setError('Please enter your phone number');
          return false;
        }
        if (!formData.country) {
          setError('Please select your country');
          return false;
        }
        return true;

      case 3:
        // Optional step - always valid
        return true;

      case 4:
        if (!formData.agreeTerms) {
          setError('Please agree to the Terms of Service and Privacy Policy');
          return false;
        }
        return true;

      default:
        return true;
    }
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep(prev => Math.min(prev + 1, 4));
      setError('');
    }
  };

  const handlePrevious = () => {
    setCurrentStep(prev => Math.max(prev - 1, 1));
    setError('');
  };

  const handleSubmit = async () => {
    if (!validateStep(4)) return;

    setLoading(true);
    setError('');

    try {
      // 1. Create Firebase Auth user
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        formData.email,
        formData.password
      );
      const userId = userCredential.user.uid;

      let companyId;
      let userRole;
      let inviteCodeId = null;

      // 2. Check if invite code is provided
      if (formData.inviteCode && formData.inviteCode.trim() !== '') {
        const inviteCodeQuery = query(
          collection(db, 'inviteCodes'),
          where('code', '==', formData.inviteCode.trim())
        );
        const inviteCodeSnap = await getDocs(inviteCodeQuery);

        if (inviteCodeSnap.empty) {
          setError('Invalid invite code. Please check and try again, or sign up without an invite code.');
          setLoading(false);
          return;
        }

        const inviteCodeData = inviteCodeSnap.docs[0].data();
        inviteCodeId = inviteCodeSnap.docs[0].id;

        // 초대 코드가 활성화되어 있는지 확인
        if (inviteCodeData.status !== 'active') {
          setError('This invite code is no longer active.');
          setLoading(false);
          return;
        }

        // 초대 코드의 companyId 사용
        companyId = inviteCodeData.companyId;
        userRole = 'member';

        console.log(`✅ User joining existing company via invite code: ${companyId}`);

      } else {
        // 초대 코드가 없으면 새로운 회사 생성
        const companyRef = await addDoc(collection(db, 'companies'), {
          name: formData.businessName || `${formData.fullName}'s Company`,
          registrationNumber: formData.registrationNumber || '',
          address: formData.address || '',
          propertyType: formData.propertyType,
          numberOfRooms: parseInt(formData.numberOfRooms) || 0,
          ownerId: userId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });

        companyId = companyRef.id;
        userRole = 'owner';

        console.log(`✅ New company created: ${companyId}`);
      }

      // 3. Create user document
      await setDoc(doc(db, 'users', userId), {
        fullName: formData.fullName,
        email: formData.email,
        phone: formData.phone,
        country: formData.country,
        companyId: companyId,
        role: userRole,
        profileImage: formData.profileImage || '',
        timezone: formData.timezone,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      // 4. Update invite code usage if used
      if (inviteCodeId) {
        await updateDoc(doc(db, 'inviteCodes', inviteCodeId), {
          usedCount: increment(1),
          lastUsedAt: new Date().toISOString()
        });
        console.log('✅ Invite code usage updated');
      }

      // Success
      if (onSuccess) onSuccess();

    } catch (err) {
      console.error('Sign up error:', err);
      setError(getErrorMessage(err.code));
    } finally {
      setLoading(false);
    }
  };

  const getErrorMessage = (code) => {
    switch (code) {
      case 'auth/email-already-in-use':
        return 'This email is already registered';
      case 'auth/invalid-email':
        return 'Invalid email address';
      case 'auth/weak-password':
        return 'Password should be at least 6 characters';
      default:
        return 'Sign up failed. Please try again';
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
          <h2 style={styles.title}>Create Your Account</h2>
          <p style={styles.subtitle}>Step {currentStep} of 4</p>
        </div>

        {/* Progress Bar */}
        <div style={styles.progressContainer}>
          <div style={{
            ...styles.progressBar,
            width: `${(currentStep / 4) * 100}%`
          }}></div>
        </div>

        {/* Form Steps */}
        <div style={styles.formContainer}>
          {currentStep === 1 && (
            <div style={styles.stepContainer}>
              <h3 style={styles.stepTitle}>Basic Information</h3>

              <input
                style={styles.input}
                placeholder="Full Name"
                value={formData.fullName}
                onChange={(e) => updateField('fullName', e.target.value)}
              />

              <input
                style={styles.input}
                type="email"
                placeholder="Email Address"
                value={formData.email}
                onChange={(e) => updateField('email', e.target.value)}
              />

              <input
                style={styles.input}
                type="password"
                placeholder="Password (min. 6 characters)"
                value={formData.password}
                onChange={(e) => updateField('password', e.target.value)}
              />

              <input
                style={styles.input}
                type="password"
                placeholder="Confirm Password"
                value={formData.confirmPassword}
                onChange={(e) => updateField('confirmPassword', e.target.value)}
              />

              {/* 초대 코드 입력 (선택사항) */}
              <div style={{ marginTop: '20px', padding: '16px', background: '#F0F9FF', border: '1.5px solid #BAE6FD', borderRadius: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '20px' }}>🎫</span>
                  <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: '#0369A1' }}>Have an invite code?</h4>
                </div>
                <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: '#475569' }}>
                  Join your team by entering the invite code (optional)
                </p>
                <input
                  style={{...styles.input, marginBottom: 0, background: 'white'}}
                  placeholder="Enter invite code (optional)"
                  value={formData.inviteCode}
                  onChange={(e) => updateField('inviteCode', e.target.value.trim())}
                />
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div style={styles.stepContainer}>
              <h3 style={styles.stepTitle}>Contact Information</h3>

              <input
                style={styles.input}
                type="tel"
                placeholder="Phone Number"
                value={formData.phone}
                onChange={(e) => updateField('phone', e.target.value)}
              />

              <select
                style={styles.select}
                value={formData.country}
                onChange={(e) => updateField('country', e.target.value)}
              >
                {COUNTRIES.map(country => (
                  <option key={country} value={country}>{country}</option>
                ))}
              </select>
            </div>
          )}

          {currentStep === 3 && (
            <div style={styles.stepContainer}>
              <h3 style={styles.stepTitle}>Business Information (Optional)</h3>
              <p style={styles.stepDescription}>
                You can skip this step and add details later
              </p>

              <input
                style={styles.input}
                placeholder="Business/Property Name"
                value={formData.businessName}
                onChange={(e) => updateField('businessName', e.target.value)}
              />

              <input
                style={styles.input}
                placeholder="Business Registration Number"
                value={formData.registrationNumber}
                onChange={(e) => updateField('registrationNumber', e.target.value)}
              />

              <input
                style={styles.input}
                placeholder="Address"
                value={formData.address}
                onChange={(e) => updateField('address', e.target.value)}
              />

              <select
                style={styles.select}
                value={formData.propertyType}
                onChange={(e) => updateField('propertyType', e.target.value)}
              >
                {PROPERTY_TYPES.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>

              <input
                style={styles.input}
                type="number"
                placeholder="Number of Rooms"
                value={formData.numberOfRooms}
                onChange={(e) => updateField('numberOfRooms', e.target.value)}
              />
            </div>
          )}

          {currentStep === 4 && (
            <div style={styles.stepContainer}>
              <h3 style={styles.stepTitle}>Complete Your Profile</h3>

              <select
                style={styles.select}
                value={formData.timezone}
                onChange={(e) => updateField('timezone', e.target.value)}
              >
                {TIMEZONES.map(tz => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>

              <label style={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={formData.agreeTerms}
                  onChange={(e) => updateField('agreeTerms', e.target.checked)}
                  style={styles.checkbox}
                />
                <span>
                  I agree to the <span style={styles.link}>Terms of Service</span> and{' '}
                  <span style={styles.link}>Privacy Policy</span>
                </span>
              </label>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div style={styles.errorBox}>
              {error}
            </div>
          )}

          {/* Buttons */}
          <div style={styles.buttonContainer}>
            {currentStep > 1 && (
              <button
                style={styles.secondaryButton}
                onClick={handlePrevious}
                disabled={loading}
              >
                Previous
              </button>
            )}

            {currentStep < 4 ? (
              <button
                style={styles.primaryButton}
                onClick={handleNext}
                disabled={loading}
              >
                Next
              </button>
            ) : (
              <button
                style={styles.primaryButton}
                onClick={handleSubmit}
                disabled={loading}
              >
                {loading ? 'Creating Account...' : 'Create Account'}
              </button>
            )}
          </div>

          {/* Back to Login */}
          <p style={styles.footerText}>
            Already have an account?{' '}
            <span style={styles.link} onClick={onBackToLogin}>
              Sign In
            </span>
          </p>
        </div>
      </div>
    </div>
  );
};

const styles = {
  container: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100vw',
    height: '100vh',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    zIndex: 9999
  },

  card: {
    background: '#FFFFFF',
    width: '100%',
    maxWidth: '520px',
    borderRadius: '24px',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
    overflow: 'hidden'
  },

  header: {
    padding: '40px 40px 20px 40px',
    textAlign: 'center',
    background: '#F8FAFC'
  },

  logoContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    marginBottom: '20px'
  },

  icon: {
    fontSize: '32px'
  },

  logo: {
    fontSize: '36px',
    fontWeight: '800',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    letterSpacing: '-1px'
  },

  title: {
    fontSize: '24px',
    fontWeight: '700',
    color: '#1E293B',
    margin: '0 0 8px 0'
  },

  subtitle: {
    fontSize: '14px',
    color: '#64748B',
    margin: 0
  },

  progressContainer: {
    width: '100%',
    height: '4px',
    background: '#E2E8F0',
    position: 'relative'
  },

  progressBar: {
    height: '100%',
    background: 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)',
    transition: 'width 0.3s ease'
  },

  formContainer: {
    padding: '40px'
  },

  stepContainer: {
    marginBottom: '24px'
  },

  stepTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#1E293B',
    margin: '0 0 8px 0'
  },

  stepDescription: {
    fontSize: '13px',
    color: '#64748B',
    margin: '0 0 20px 0'
  },

  input: {
    width: '100%',
    padding: '14px 16px',
    border: '1.5px solid #E2E8F0',
    borderRadius: '10px',
    fontSize: '15px',
    marginBottom: '12px',
    outline: 'none',
    transition: 'border-color 0.2s',
    fontFamily: 'inherit',
    boxSizing: 'border-box'
  },

  select: {
    width: '100%',
    padding: '14px 16px',
    border: '1.5px solid #E2E8F0',
    borderRadius: '10px',
    fontSize: '15px',
    marginBottom: '12px',
    outline: 'none',
    transition: 'border-color 0.2s',
    fontFamily: 'inherit',
    background: '#FFFFFF',
    cursor: 'pointer',
    boxSizing: 'border-box'
  },

  checkboxLabel: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    fontSize: '14px',
    color: '#475569',
    marginTop: '20px',
    cursor: 'pointer'
  },

  checkbox: {
    marginTop: '3px',
    cursor: 'pointer',
    width: '16px',
    height: '16px'
  },

  link: {
    color: '#4F46E5',
    fontWeight: '600',
    cursor: 'pointer',
    textDecoration: 'underline'
  },

  errorBox: {
    padding: '12px 16px',
    background: '#FEF2F2',
    border: '1px solid #FECACA',
    borderRadius: '8px',
    color: '#EF4444',
    fontSize: '14px',
    marginBottom: '20px'
  },

  buttonContainer: {
    display: 'flex',
    gap: '12px',
    marginTop: '24px'
  },

  primaryButton: {
    flex: 1,
    padding: '14px',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    border: 'none',
    borderRadius: '10px',
    color: '#FFFFFF',
    fontSize: '15px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'transform 0.2s, box-shadow 0.2s',
    boxShadow: '0 4px 12px rgba(102, 126, 234, 0.4)'
  },

  secondaryButton: {
    flex: 1,
    padding: '14px',
    background: '#F1F5F9',
    border: 'none',
    borderRadius: '10px',
    color: '#475569',
    fontSize: '15px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'background 0.2s'
  },

  footerText: {
    textAlign: 'center',
    marginTop: '24px',
    fontSize: '14px',
    color: '#64748B'
  }
};

export default SignUpForm;
