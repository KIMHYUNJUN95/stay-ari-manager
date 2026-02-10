import React, { useState } from 'react';
import { doc, setDoc, collection, addDoc, query, where, getDocs, updateDoc, increment } from 'firebase/firestore';
import { db } from '../firebase';

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

const GoogleSignUpForm = ({ googleUser, onSuccess, onCancel }) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Form data (Google/Phone info is pre-filled)
  const [formData, setFormData] = useState({
    // From Google/Phone (read-only)
    fullName: googleUser.displayName || '',
    email: googleUser.email || '',
    profileImage: googleUser.photoURL || '',

    // User input required (auto-filled for phone users)
    phone: googleUser.phoneNumber || '',
    country: 'South Korea',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul',

    // Company setup
    joinMethod: 'invite', // 'invite' or 'create'
    inviteCode: '',

    // If creating new company
    businessName: '',
    registrationNumber: '',
    address: '',
    propertyType: 'Hotel',
    numberOfRooms: '',

    // Terms
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
        // For phone users, check fullName
        if (googleUser.phoneNumber && !formData.fullName.trim()) {
          setError('Please enter your full name');
          return false;
        }
        // For Google users, check phone
        if (!googleUser.phoneNumber && !formData.phone.trim()) {
          setError('Please enter your phone number');
          return false;
        }
        if (!formData.country) {
          setError('Please select your country');
          return false;
        }
        return true;

      case 2:
        if (formData.joinMethod === 'invite') {
          if (!formData.inviteCode.trim()) {
            setError('Please enter an invite code or choose to create a new company');
            return false;
          }
        } else if (formData.joinMethod === 'create') {
          if (!formData.businessName.trim()) {
            setError('Please enter your business name');
            return false;
          }
        }
        return true;

      case 3:
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
      setCurrentStep(prev => Math.min(prev + 1, 3));
      setError('');
    }
  };

  const handlePrevious = () => {
    setCurrentStep(prev => Math.max(prev - 1, 1));
    setError('');
  };

  const handleSubmit = async () => {
    if (!validateStep(3)) return;

    setLoading(true);
    setError('');

    try {
      const userId = googleUser.uid;
      let companyId;
      let userRole;
      let inviteCodeId = null;

      // Check join method
      if (formData.joinMethod === 'invite') {
        // Join existing company via invite code
        const inviteCodeQuery = query(
          collection(db, 'inviteCodes'),
          where('code', '==', formData.inviteCode.trim())
        );
        const inviteCodeSnap = await getDocs(inviteCodeQuery);

        if (inviteCodeSnap.empty) {
          setError('Invalid invite code. Please check and try again.');
          setLoading(false);
          return;
        }

        const inviteCodeData = inviteCodeSnap.docs[0].data();
        inviteCodeId = inviteCodeSnap.docs[0].id;

        if (inviteCodeData.status !== 'active') {
          setError('This invite code is no longer active.');
          setLoading(false);
          return;
        }

        companyId = inviteCodeData.companyId;
        userRole = 'member';

        console.log(`✅ Google user joining existing company: ${companyId}`);

      } else {
        // Create new company
        const companyRef = await addDoc(collection(db, 'companies'), {
          name: formData.businessName,
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

        console.log(`✅ New company created for Google user: ${companyId}`);
      }

      // Determine auth provider
      const authProvider = googleUser.phoneNumber ? 'phone' : 'google';

      // Create user document
      await setDoc(doc(db, 'users', userId), {
        fullName: formData.fullName,
        email: formData.email || '', // Empty string if phone user
        phone: formData.phone,
        phoneNumber: googleUser.phoneNumber || '', // Store phone number for phone auth users
        country: formData.country,
        companyId: companyId,
        role: userRole,
        profileImage: formData.profileImage,
        timezone: formData.timezone,
        authProvider: authProvider,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      console.log(`✅ ${authProvider} user document created`);

      // Update invite code usage if used
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
      console.error('❌ Google sign up error:', err);
      setError('Failed to complete sign up. Please try again.');
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
          <h2 style={styles.title}>Complete Your Profile</h2>
          <p style={styles.subtitle}>Step {currentStep} of 3</p>
        </div>

        {/* Progress Bar */}
        <div style={styles.progressBar}>
          <div style={{ ...styles.progressFill, width: `${(currentStep / 3) * 100}%` }} />
        </div>

        {/* Error Message */}
        {error && (
          <div style={styles.errorBox}>
            <span style={styles.errorIcon}>⚠️</span>
            {error}
          </div>
        )}

        {/* Step 1: Personal Info from Google + Additional */}
        {currentStep === 1 && (
          <div style={styles.stepContainer}>
            <h3 style={styles.stepTitle}>📱 Contact Information</h3>

            {/* Google/Phone Info (Read-only) */}
            {googleUser.phoneNumber ? (
              // Phone authentication user
              <div style={styles.googleInfoBox}>
                <p style={styles.googleInfoLabel}>✅ From your phone authentication:</p>
                <div style={styles.googleInfoItem}>
                  <span style={{ fontSize: '32px' }}>📱</span>
                  <div>
                    <div style={styles.googleName}>Phone Verified</div>
                    <div style={styles.googleEmail}>{googleUser.phoneNumber}</div>
                  </div>
                </div>
              </div>
            ) : (
              // Google authentication user
              <div style={styles.googleInfoBox}>
                <p style={styles.googleInfoLabel}>✅ From your Google account:</p>
                <div style={styles.googleInfoItem}>
                  {formData.profileImage && (
                    <img
                      src={formData.profileImage}
                      alt="Profile"
                      style={styles.googleAvatar}
                    />
                  )}
                  <div>
                    <div style={styles.googleName}>{formData.fullName}</div>
                    <div style={styles.googleEmail}>{formData.email}</div>
                  </div>
                </div>
              </div>
            )}

            {!googleUser.phoneNumber && (
              <div style={styles.formGroup}>
                <label style={styles.label}>Phone Number *</label>
                <input
                  style={styles.input}
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => updateField('phone', e.target.value)}
                  placeholder="e.g., +81 80-1234-5678"
                />
              </div>
            )}

            {googleUser.phoneNumber && (
              <div style={styles.formGroup}>
                <label style={styles.label}>Full Name *</label>
                <input
                  style={styles.input}
                  type="text"
                  value={formData.fullName}
                  onChange={(e) => updateField('fullName', e.target.value)}
                  placeholder="Enter your full name"
                />
              </div>
            )}

            <div style={styles.formGroup}>
              <label style={styles.label}>Country *</label>
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

            <div style={styles.formGroup}>
              <label style={styles.label}>Timezone</label>
              <select
                style={styles.select}
                value={formData.timezone}
                onChange={(e) => updateField('timezone', e.target.value)}
              >
                {TIMEZONES.map(tz => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Step 2: Company Setup */}
        {currentStep === 2 && (
          <div style={styles.stepContainer}>
            <h3 style={styles.stepTitle}>🏢 Company Setup</h3>

            <div style={styles.joinMethodContainer}>
              <label style={styles.radioLabel}>
                <input
                  type="radio"
                  name="joinMethod"
                  checked={formData.joinMethod === 'invite'}
                  onChange={() => updateField('joinMethod', 'invite')}
                  style={styles.radio}
                />
                <span style={styles.radioText}>
                  <strong>Join Existing Company</strong>
                  <br />
                  <small style={styles.radioSubtext}>Use an invite code to join your team</small>
                </span>
              </label>

              <label style={styles.radioLabel}>
                <input
                  type="radio"
                  name="joinMethod"
                  checked={formData.joinMethod === 'create'}
                  onChange={() => updateField('joinMethod', 'create')}
                  style={styles.radio}
                />
                <span style={styles.radioText}>
                  <strong>Create New Company</strong>
                  <br />
                  <small style={styles.radioSubtext}>Set up your own property</small>
                </span>
              </label>
            </div>

            {formData.joinMethod === 'invite' ? (
              <div style={styles.formGroup}>
                <label style={styles.label}>Invite Code *</label>
                <input
                  style={styles.input}
                  type="text"
                  value={formData.inviteCode}
                  onChange={(e) => updateField('inviteCode', e.target.value.toUpperCase())}
                  placeholder="Enter your invite code"
                />
                <p style={styles.hint}>Ask your team owner for an invite code</p>
              </div>
            ) : (
              <>
                <div style={styles.formGroup}>
                  <label style={styles.label}>Business Name *</label>
                  <input
                    style={styles.input}
                    type="text"
                    value={formData.businessName}
                    onChange={(e) => updateField('businessName', e.target.value)}
                    placeholder="e.g., HARU Tokyo Hotel"
                  />
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Registration Number (Optional)</label>
                  <input
                    style={styles.input}
                    type="text"
                    value={formData.registrationNumber}
                    onChange={(e) => updateField('registrationNumber', e.target.value)}
                    placeholder="Business registration number"
                  />
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Address (Optional)</label>
                  <input
                    style={styles.input}
                    type="text"
                    value={formData.address}
                    onChange={(e) => updateField('address', e.target.value)}
                    placeholder="Business address"
                  />
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Property Type</label>
                  <select
                    style={styles.select}
                    value={formData.propertyType}
                    onChange={(e) => updateField('propertyType', e.target.value)}
                  >
                    {PROPERTY_TYPES.map(type => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Number of Rooms (Optional)</label>
                  <input
                    style={styles.input}
                    type="number"
                    value={formData.numberOfRooms}
                    onChange={(e) => updateField('numberOfRooms', e.target.value)}
                    placeholder="Total number of rooms"
                  />
                </div>
              </>
            )}
          </div>
        )}

        {/* Step 3: Terms */}
        {currentStep === 3 && (
          <div style={styles.stepContainer}>
            <h3 style={styles.stepTitle}>📋 Terms & Conditions</h3>

            <div style={styles.summaryBox}>
              <h4 style={styles.summaryTitle}>Summary</h4>
              <div style={styles.summaryItem}>
                <span style={styles.summaryLabel}>Name:</span>
                <span>{formData.fullName}</span>
              </div>
              <div style={styles.summaryItem}>
                <span style={styles.summaryLabel}>Email:</span>
                <span>{formData.email}</span>
              </div>
              <div style={styles.summaryItem}>
                <span style={styles.summaryLabel}>Phone:</span>
                <span>{formData.phone}</span>
              </div>
              <div style={styles.summaryItem}>
                <span style={styles.summaryLabel}>Country:</span>
                <span>{formData.country}</span>
              </div>
              <div style={styles.summaryItem}>
                <span style={styles.summaryLabel}>Setup:</span>
                <span>
                  {formData.joinMethod === 'invite'
                    ? `Join via code: ${formData.inviteCode}`
                    : `Create: ${formData.businessName}`}
                </span>
              </div>
            </div>

            <label style={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={formData.agreeTerms}
                onChange={(e) => updateField('agreeTerms', e.target.checked)}
                style={styles.checkbox}
              />
              <span style={styles.checkboxText}>
                I agree to the <strong>Terms of Service</strong> and <strong>Privacy Policy</strong>
              </span>
            </label>
          </div>
        )}

        {/* Navigation Buttons */}
        <div style={styles.buttonContainer}>
          {currentStep > 1 && (
            <button
              style={styles.secondaryButton}
              onClick={handlePrevious}
              disabled={loading}
            >
              ← Previous
            </button>
          )}

          {currentStep < 3 ? (
            <button
              style={styles.primaryButton}
              onClick={handleNext}
              disabled={loading}
            >
              Next →
            </button>
          ) : (
            <button
              style={styles.primaryButton}
              onClick={handleSubmit}
              disabled={loading}
            >
              {loading ? 'Creating Account...' : 'Complete Sign Up'}
            </button>
          )}
        </div>

        {/* Cancel Link */}
        <div style={styles.cancelContainer}>
          <button
            style={styles.cancelButton}
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </button>
        </div>
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
    maxWidth: '600px',
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
    color: '#94A3B8',
    margin: 0
  },
  progressBar: {
    height: '6px',
    background: '#E2E8F0',
    borderRadius: '10px',
    overflow: 'hidden',
    marginBottom: '32px'
  },
  progressFill: {
    height: '100%',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    transition: 'width 0.3s ease'
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
  stepContainer: {
    marginBottom: '32px'
  },
  stepTitle: {
    fontSize: '20px',
    fontWeight: '600',
    color: '#1E293B',
    marginBottom: '24px'
  },
  googleInfoBox: {
    background: '#F0F9FF',
    border: '2px solid #BAE6FD',
    borderRadius: '12px',
    padding: '16px',
    marginBottom: '24px'
  },
  googleInfoLabel: {
    fontSize: '13px',
    color: '#0369A1',
    fontWeight: '600',
    margin: '0 0 12px 0'
  },
  googleInfoItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  googleAvatar: {
    width: '48px',
    height: '48px',
    borderRadius: '50%',
    border: '2px solid #BAE6FD'
  },
  googleName: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#1E293B'
  },
  googleEmail: {
    fontSize: '14px',
    color: '#64748B'
  },
  formGroup: {
    marginBottom: '20px'
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
    padding: '12px 16px',
    border: '1.5px solid #E2E8F0',
    borderRadius: '10px',
    fontSize: '15px',
    outline: 'none',
    transition: 'border-color 0.2s',
    fontFamily: 'inherit',
    boxSizing: 'border-box'
  },
  select: {
    width: '100%',
    padding: '12px 16px',
    border: '1.5px solid #E2E8F0',
    borderRadius: '10px',
    fontSize: '15px',
    outline: 'none',
    transition: 'border-color 0.2s',
    fontFamily: 'inherit',
    background: '#FFFFFF',
    cursor: 'pointer',
    boxSizing: 'border-box'
  },
  hint: {
    fontSize: '12px',
    color: '#94A3B8',
    marginTop: '6px'
  },
  joinMethodContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    marginBottom: '24px'
  },
  radioLabel: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    padding: '16px',
    border: '2px solid #E2E8F0',
    borderRadius: '12px',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  radio: {
    marginTop: '4px',
    cursor: 'pointer'
  },
  radioText: {
    flex: 1,
    color: '#1E293B'
  },
  radioSubtext: {
    color: '#64748B'
  },
  summaryBox: {
    background: '#F8FAFC',
    border: '1px solid #E2E8F0',
    borderRadius: '12px',
    padding: '20px',
    marginBottom: '24px'
  },
  summaryTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#1E293B',
    marginBottom: '16px'
  },
  summaryItem: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '8px 0',
    borderBottom: '1px solid #E2E8F0',
    fontSize: '14px'
  },
  summaryLabel: {
    fontWeight: '600',
    color: '#64748B'
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    cursor: 'pointer'
  },
  checkbox: {
    marginTop: '4px',
    cursor: 'pointer'
  },
  checkboxText: {
    fontSize: '14px',
    color: '#475569',
    lineHeight: '1.6'
  },
  buttonContainer: {
    display: 'flex',
    gap: '12px',
    marginTop: '32px'
  },
  primaryButton: {
    flex: 1,
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
    flex: 1,
    padding: '14px',
    background: '#F1F5F9',
    border: 'none',
    borderRadius: '12px',
    color: '#475569',
    fontSize: '15px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'transform 0.2s'
  },
  cancelContainer: {
    textAlign: 'center',
    marginTop: '16px'
  },
  cancelButton: {
    background: 'none',
    border: 'none',
    color: '#64748B',
    fontSize: '14px',
    cursor: 'pointer',
    textDecoration: 'underline'
  }
};

export default GoogleSignUpForm;
