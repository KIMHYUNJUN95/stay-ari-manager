import React, { useState, useEffect, useRef } from 'react';
import { doc, getDoc, updateDoc, collection, query, where, getDocs, increment } from 'firebase/firestore';
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import { useUser } from '../contexts/UserContext';

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

const MyProfile = () => {
  const { user, userData, companyId } = useUser();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [activeTab, setActiveTab] = useState('personal'); // personal, company, password
  const [profileImage, setProfileImage] = useState('');
  const [previewImage, setPreviewImage] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const fileInputRef = useRef(null);

  // Personal Info
  const [personalInfo, setPersonalInfo] = useState({
    fullName: '',
    phone: '',
    country: 'South Korea',
    timezone: 'Asia/Seoul'
  });

  // Company Info
  const [companyInfo, setCompanyInfo] = useState({
    name: '',
    registrationNumber: '',
    address: '',
    propertyType: 'Hotel',
    numberOfRooms: ''
  });

  // Password Change
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  // Join Company
  const [inviteCode, setInviteCode] = useState('');
  const [validatingCode, setValidatingCode] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [newCompanyInfo, setNewCompanyInfo] = useState(null);

  // Load user and company data
  useEffect(() => {
    const loadData = async () => {
      if (!user || !userData) {
        console.log('⚠️ MyProfile: No user or userData');
        return;
      }

      console.log('🔍 MyProfile: Loading profile data...');
      console.log('   User ID:', user.uid);
      console.log('   Email:', userData.email);
      console.log('   CompanyId:', companyId);

      setLoading(true);
      try {
        // Load personal info
        const personalData = {
          fullName: userData.fullName || '',
          phone: userData.phone || '',
          country: userData.country || 'South Korea',
          timezone: userData.timezone || 'Asia/Seoul'
        };
        setPersonalInfo(personalData);
        setProfileImage(userData.profileImage || '');
        console.log('✅ Personal info loaded:', personalData);
        console.log('✅ Profile image:', userData.profileImage || 'No image');

        // Load company info
        if (companyId) {
          const companyDoc = await getDoc(doc(db, 'companies', companyId));
          if (companyDoc.exists()) {
            const data = companyDoc.data();
            const companyData = {
              name: data.name || '',
              registrationNumber: data.registrationNumber || '',
              address: data.address || '',
              propertyType: data.propertyType || 'Hotel',
              numberOfRooms: data.numberOfRooms || ''
            };
            setCompanyInfo(companyData);
            console.log('✅ Company info loaded:', companyData);
          } else {
            console.warn('⚠️ Company document not found:', companyId);
          }
        } else {
          console.warn('⚠️ No companyId');
        }
      } catch (err) {
        console.error('❌ Error loading profile:', err);
        setError('Failed to load profile data');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [user, userData, companyId]);

  // Save Personal Info
  const handleSavePersonal = async () => {
    if (!user) return;

    console.log('💾 Saving personal info...');
    console.log('   Data:', personalInfo);

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const updateData = {
        fullName: personalInfo.fullName,
        phone: personalInfo.phone,
        country: personalInfo.country,
        timezone: personalInfo.timezone,
        updatedAt: new Date().toISOString()
      };

      await updateDoc(doc(db, 'users', user.uid), updateData);
      console.log('✅ Personal info saved successfully');

      setSuccess('✅ Personal information updated successfully!');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      console.error('❌ Error updating personal info:', err);
      setError('Failed to update personal information');
    } finally {
      setSaving(false);
    }
  };

  // Save Company Info
  const handleSaveCompany = async () => {
    if (!companyId) {
      console.error('❌ No companyId');
      setError('No company associated with this account');
      return;
    }

    if (userData?.role !== 'owner') {
      console.error('❌ User is not owner, role:', userData?.role);
      setError('Only company owners can update company information');
      return;
    }

    console.log('💾 Saving company info...');
    console.log('   CompanyId:', companyId);
    console.log('   Data:', companyInfo);

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const updateData = {
        name: companyInfo.name,
        registrationNumber: companyInfo.registrationNumber,
        address: companyInfo.address,
        propertyType: companyInfo.propertyType,
        numberOfRooms: parseInt(companyInfo.numberOfRooms) || 0,
        updatedAt: new Date().toISOString()
      };

      await updateDoc(doc(db, 'companies', companyId), updateData);
      console.log('✅ Company info saved successfully');
      console.log('   Updated data:', updateData);

      setSuccess('✅ Company information updated successfully!');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      console.error('❌ Error updating company info:', err);
      setError('Failed to update company information');
    } finally {
      setSaving(false);
    }
  };

  // Handle file selection (creates preview)
  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (!file) {
      console.log('📸 No file selected');
      return;
    }

    // Check file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      setError('Image size must be less than 2MB');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }

    // Check file type
    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }

    console.log('📸 File selected:', file.name);
    console.log('   File size:', (file.size / 1024).toFixed(2), 'KB');

    // Store file and create preview
    setSelectedFile(file);
    setError('');

    const reader = new FileReader();
    reader.onloadend = () => {
      setPreviewImage(reader.result);
    };
    reader.readAsDataURL(file);
  };

  // Confirm and upload the selected image
  const handleConfirmUpload = async () => {
    if (!selectedFile) {
      console.error('❌ No file selected');
      return;
    }

    console.log('📸 Uploading profile image...');
    console.log('   File name:', selectedFile.name);
    setUploading(true);
    setError('');
    setSuccess('');

    try {
      // Sanitize filename (handle Korean and special characters)
      const timestamp = Date.now();
      const sanitizedFileName = selectedFile.name.replace(/[^a-zA-Z0-9.]/g, '_');
      const fileName = `${timestamp}_${sanitizedFileName}`;

      // Upload to Firebase Storage
      const storageRef = ref(storage, `profileImages/${user.uid}/${fileName}`);

      console.log('📤 Uploading to:', `profileImages/${user.uid}/${fileName}`);

      await uploadBytes(storageRef, selectedFile);
      const downloadURL = await getDownloadURL(storageRef);

      console.log('✅ Image uploaded:', downloadURL);

      // Update user document
      await updateDoc(doc(db, 'users', user.uid), {
        profileImage: downloadURL,
        updatedAt: new Date().toISOString()
      });

      setProfileImage(downloadURL);
      setPreviewImage(null);
      setSelectedFile(null);
      setSuccess('✅ Profile image updated successfully!');
      setTimeout(() => setSuccess(''), 3000);

      console.log('✅ Profile image saved to Firestore');

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (err) {
      console.error('❌ Error uploading image:', err);
      console.error('   Error code:', err.code);
      console.error('   Error message:', err.message);

      if (err.code === 'storage/unauthorized') {
        setError('❌ Permission denied. Please configure Firebase Storage Rules.');
      } else {
        setError(`❌ Failed to upload image: ${err.message}`);
      }

      // Reset states on error
      setPreviewImage(null);
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } finally {
      setUploading(false);
    }
  };

  // Cancel image selection
  const handleCancelImage = () => {
    setPreviewImage(null);
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    console.log('📸 Image selection cancelled');
  };

  // Remove Profile Image
  const handleRemoveImage = async () => {
    if (!window.confirm('Remove profile image?')) return;

    console.log('🗑️ Removing profile image...');
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      await updateDoc(doc(db, 'users', user.uid), {
        profileImage: '',
        updatedAt: new Date().toISOString()
      });

      setProfileImage('');
      setSuccess('✅ Profile image removed successfully!');
      setTimeout(() => setSuccess(''), 3000);

      console.log('✅ Profile image removed');
    } catch (err) {
      console.error('❌ Error removing image:', err);
      setError('Failed to remove image');
    } finally {
      setSaving(false);
    }
  };

  // Change Password
  const handleChangePassword = async () => {
    if (!passwordData.currentPassword || !passwordData.newPassword || !passwordData.confirmPassword) {
      setError('Please fill in all password fields');
      return;
    }

    if (passwordData.newPassword.length < 6) {
      setError('New password must be at least 6 characters');
      return;
    }

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      // Re-authenticate user
      const credential = EmailAuthProvider.credential(
        user.email,
        passwordData.currentPassword
      );
      await reauthenticateWithCredential(user, credential);

      // Update password
      await updatePassword(user, passwordData.newPassword);

      setSuccess('✅ Password changed successfully!');
      setPasswordData({
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
      });
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      console.error('Error changing password:', err);
      if (err.code === 'auth/wrong-password') {
        setError('Current password is incorrect');
      } else {
        setError('Failed to change password');
      }
    } finally {
      setSaving(false);
    }
  };

  // Validate Invite Code
  const validateInviteCode = async () => {
    if (!inviteCode || inviteCode.trim().length !== 8) {
      setError('Invite code must be 8 characters');
      return;
    }

    setValidatingCode(true);
    setError('');
    setSuccess('');

    try {
      // Find invite code in Firestore
      const q = query(
        collection(db, 'inviteCodes'),
        where('code', '==', inviteCode.trim().toUpperCase()),
        where('status', '==', 'active')
      );

      const snapshot = await getDocs(q);

      if (snapshot.empty) {
        setError('Invalid or inactive invite code');
        setValidatingCode(false);
        return;
      }

      const inviteData = snapshot.docs[0].data();
      const inviteCodeId = snapshot.docs[0].id;

      // Check if user is already in this company
      if (inviteData.companyId === companyId) {
        setError('You are already a member of this company');
        setValidatingCode(false);
        return;
      }

      // Get company details for confirmation
      const companyDoc = await getDoc(doc(db, 'companies', inviteData.companyId));

      if (!companyDoc.exists()) {
        setError('Company associated with this code does not exist');
        setValidatingCode(false);
        return;
      }

      setNewCompanyInfo({
        ...companyDoc.data(),
        id: inviteData.companyId,
        inviteCodeId: inviteCodeId,
        role: 'member' // Force role to member
      });

      setShowConfirmModal(true);

    } catch (err) {
      console.error('Error validating invite code:', err);
      setError('Failed to validate invite code');
    } finally {
      setValidatingCode(false);
    }
  };

  // Handle Join Company
  const handleJoinCompany = async () => {
    if (!newCompanyInfo || !user) return;

    setSaving(true);
    setError('');

    try {
      // 1. Update User Document
      await updateDoc(doc(db, 'users', user.uid), {
        companyId: newCompanyInfo.id,
        role: 'member', // Always demote to member when joining new company
        updatedAt: new Date().toISOString()
      });

      // 2. Update Invite Code usage count
      await updateDoc(doc(db, 'inviteCodes', newCompanyInfo.inviteCodeId), {
        usedCount: increment(1),
        lastUsedAt: new Date().toISOString()
      });

      setSuccess(`🎉 Successfully joined ${newCompanyInfo.name}!`);
      setShowConfirmModal(false);
      setInviteCode('');
      setNewCompanyInfo(null);

      // Reload page to refresh all data and contexts
      setTimeout(() => {
        window.location.reload();
      }, 1500);

    } catch (err) {
      console.error('Error joining company:', err);
      setError('Failed to join company. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={{ textAlign: 'center', padding: '60px', color: '#94A3B8' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⏳</div>
          <div>Loading profile...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>My Profile</h1>
        <p style={styles.subtitle}>
          {userData?.email} • {userData?.role === 'owner' ? 'Owner' : 'Member'}
        </p>
      </div>

      {/* Tabs */}
      <div style={styles.tabs}>
        <button
          style={{
            ...styles.tab,
            ...(activeTab === 'personal' ? styles.tabActive : {})
          }}
          onClick={() => setActiveTab('personal')}
        >
          👤 Personal Info
        </button>
        <button
          style={{
            ...styles.tab,
            ...(activeTab === 'company' ? styles.tabActive : {})
          }}
          onClick={() => setActiveTab('company')}
        >
          🏢 Company Info
        </button>
        <button
          style={{
            ...styles.tab,
            ...(activeTab === 'password' ? styles.tabActive : {})
          }}
          onClick={() => setActiveTab('password')}
        >
          🔒 Password
        </button>
        <button
          style={{
            ...styles.tab,
            ...(activeTab === 'join' ? styles.tabActive : {})
          }}
          onClick={() => setActiveTab('join')}
        >
          💼 Join Company
        </button>
      </div>

      {/* Messages */}
      {error && (
        <div style={styles.errorBox}>
          {error}
        </div>
      )}

      {success && (
        <div style={styles.successBox}>
          {success}
        </div>
      )}

      {/* Personal Info Tab */}
      {activeTab === 'personal' && (
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Personal Information</h3>

          {/* Profile Image Upload */}
          <div style={styles.imageSection}>
            <label style={styles.label}>Profile Image</label>
            <div style={styles.imageContainer}>
              <div style={styles.imagePreview}>
                {previewImage ? (
                  <img src={previewImage} alt="Preview" style={styles.previewImage} />
                ) : profileImage ? (
                  <img src={profileImage} alt="Profile" style={styles.previewImage} />
                ) : (
                  <div style={styles.placeholderIcon}>
                    <span style={{ fontSize: '48px' }}>👤</span>
                  </div>
                )}
              </div>
              <div style={styles.imageButtons}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                />
                {!previewImage ? (
                  <>
                    <button
                      style={styles.uploadButton}
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                    >
                      {uploading ? '⏳ Uploading...' : '📸 Upload Image'}
                    </button>
                    {profileImage && (
                      <button
                        style={styles.removeButton}
                        onClick={handleRemoveImage}
                        disabled={saving}
                      >
                        🗑️ Remove
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <button
                      style={styles.uploadButton}
                      onClick={handleConfirmUpload}
                      disabled={uploading}
                    >
                      {uploading ? '⏳ Uploading...' : '✓ Confirm Upload'}
                    </button>
                    <button
                      style={styles.cancelButton}
                      onClick={handleCancelImage}
                      disabled={uploading}
                    >
                      ✕ Cancel
                    </button>
                  </>
                )}
              </div>
              <p style={styles.imageHint}>Max 2MB • JPG, PNG, GIF</p>
            </div>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Full Name</label>
            <input
              style={styles.input}
              value={personalInfo.fullName}
              onChange={(e) => setPersonalInfo({ ...personalInfo, fullName: e.target.value })}
              placeholder="Your full name"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Phone Number</label>
            <input
              style={styles.input}
              type="tel"
              value={personalInfo.phone}
              onChange={(e) => setPersonalInfo({ ...personalInfo, phone: e.target.value })}
              placeholder="Phone number"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Country</label>
            <select
              style={styles.select}
              value={personalInfo.country}
              onChange={(e) => setPersonalInfo({ ...personalInfo, country: e.target.value })}
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
              value={personalInfo.timezone}
              onChange={(e) => setPersonalInfo({ ...personalInfo, timezone: e.target.value })}
            >
              {TIMEZONES.map(tz => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </div>

          <button
            style={styles.saveButton}
            onClick={handleSavePersonal}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Personal Info'}
          </button>
        </div>
      )}

      {/* Company Info Tab */}
      {activeTab === 'company' && (
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Company Information</h3>

          {userData?.role !== 'owner' ? (
            <div style={styles.infoBox}>
              <span style={{ fontSize: '32px', marginBottom: '12px' }}>ℹ️</span>
              <p style={{ margin: 0, color: '#475569' }}>
                Only company owners can edit company information.
              </p>
            </div>
          ) : (
            <>
              <div style={styles.formGroup}>
                <label style={styles.label}>Company Name</label>
                <input
                  style={styles.input}
                  value={companyInfo.name}
                  onChange={(e) => setCompanyInfo({ ...companyInfo, name: e.target.value })}
                  placeholder="Company or property name"
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Business Registration Number</label>
                <input
                  style={styles.input}
                  value={companyInfo.registrationNumber}
                  onChange={(e) => setCompanyInfo({ ...companyInfo, registrationNumber: e.target.value })}
                  placeholder="Registration number"
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Address</label>
                <input
                  style={styles.input}
                  value={companyInfo.address}
                  onChange={(e) => setCompanyInfo({ ...companyInfo, address: e.target.value })}
                  placeholder="Business address"
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Property Type</label>
                <select
                  style={styles.select}
                  value={companyInfo.propertyType}
                  onChange={(e) => setCompanyInfo({ ...companyInfo, propertyType: e.target.value })}
                >
                  {PROPERTY_TYPES.map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Number of Rooms</label>
                <input
                  style={styles.input}
                  type="number"
                  value={companyInfo.numberOfRooms}
                  onChange={(e) => setCompanyInfo({ ...companyInfo, numberOfRooms: e.target.value })}
                  placeholder="Total rooms"
                />
              </div>

              <button
                style={styles.saveButton}
                onClick={handleSaveCompany}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save Company Info'}
              </button>
            </>
          )}
        </div>
      )}

      {/* Password Tab */}
      {activeTab === 'password' && (
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Change Password</h3>

          <div style={styles.formGroup}>
            <label style={styles.label}>Current Password</label>
            <input
              style={styles.input}
              type="password"
              value={passwordData.currentPassword}
              onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
              placeholder="Enter current password"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>New Password</label>
            <input
              style={styles.input}
              type="password"
              value={passwordData.newPassword}
              onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
              placeholder="Enter new password (min. 6 characters)"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Confirm New Password</label>
            <input
              style={styles.input}
              type="password"
              value={passwordData.confirmPassword}
              onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
              placeholder="Confirm new password"
            />
          </div>

          <button
            style={styles.saveButton}
            onClick={handleChangePassword}
            disabled={saving}
          >
            {saving ? 'Changing...' : 'Change Password'}
          </button>
        </div>
      )}

      {/* Join Company Tab */}
      {activeTab === 'join' && (
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>Join Another Company</h3>

          <div style={{
            background: '#FEF2F2',
            border: '1px solid #FECACA',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '24px'
          }}>
            <h4 style={{ margin: '0 0 8px 0', color: '#B91C1C', display: 'flex', alignItems: 'center', gap: '8px' }}>
              ⚠️ Warning
            </h4>
            <p style={{ margin: 0, color: '#7F1D1D', fontSize: '14px', lineHeight: '1.6' }}>
              Joining a new company will change your workspace instantly.<br />
              • You will <strong>lose access</strong> to your current company's data.<br />
              • Your role will be set to <strong>member</strong> in the new company.<br />
              {userData?.role === 'owner' && (
                <strong style={{ display: 'block', marginTop: '8px', color: '#DC2626' }}>
                  Since you are currently an OWNER, please ensure you have transferred ownership or no longer need to manage this company.
                </strong>
              )}
            </p>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Invite Code</label>
            <div style={{ display: 'flex', gap: '12px' }}>
              <input
                style={{ ...styles.input, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '2px' }}
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                placeholder="ENTER-CODE"
                maxLength={8}
              />
              <button
                style={{
                  ...styles.saveButton,
                  width: 'auto',
                  marginTop: 0,
                  background: validateInviteCode ? '#4F46E5' : '#94A3B8',
                  opacity: (!inviteCode || inviteCode.length !== 8) ? 0.6 : 1
                }}
                onClick={validateInviteCode}
                disabled={validatingCode || !inviteCode || inviteCode.length !== 8}
              >
                {validatingCode ? 'Checking...' : 'Verify'}
              </button>
            </div>
            <p style={{ fontSize: '13px', color: '#64748B', marginTop: '8px' }}>
              Enter the 8-character invite code shared by your company admin.
            </p>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirmModal && newCompanyInfo && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: 'white',
            borderRadius: '16px',
            padding: '32px',
            maxWidth: '400px',
            width: '90%',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px', textAlign: 'center' }}>🏢</div>
            <h3 style={{ fontSize: '20px', fontWeight: '700', textAlign: 'center', marginBottom: '12px', color: '#1E293B' }}>
              Join {newCompanyInfo.name}?
            </h3>

            <div style={{ background: '#F8FAFC', padding: '16px', borderRadius: '12px', marginBottom: '24px' }}>
              <div style={{ marginBottom: '8px', fontSize: '14px', color: '#64748B' }}>
                <span style={{ display: 'block', fontSize: '12px', marginBottom: '2px' }}>Current Company</span>
                <strong style={{ color: '#0F172A' }}>{companyInfo.name || 'Unknown'}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}>⬇️</div>
              <div style={{ fontSize: '14px', color: '#64748B' }}>
                <span style={{ display: 'block', fontSize: '12px', marginBottom: '2px' }}>New Company</span>
                <strong style={{ color: '#4F46E5', fontSize: '16px' }}>{newCompanyInfo.name}</strong>
              </div>
            </div>

            <p style={{ fontSize: '14px', color: '#475569', textAlign: 'center', marginBottom: '24px', lineHeight: '1.5' }}>
              Are you sure you want to switch companies? This action cannot be undone immediately.
            </p>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={() => setShowConfirmModal(false)}
                style={{
                  flex: 1,
                  padding: '12px',
                  border: '1px solid #E2E8F0',
                  background: 'white',
                  borderRadius: '10px',
                  fontSize: '14px',
                  fontWeight: '600',
                  color: '#64748B',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleJoinCompany}
                disabled={saving}
                style={{
                  flex: 1,
                  padding: '12px',
                  border: 'none',
                  background: '#4F46E5',
                  borderRadius: '10px',
                  fontSize: '14px',
                  fontWeight: '600',
                  color: 'white',
                  cursor: 'pointer'
                }}
              >
                {saving ? 'Joining...' : 'Confirm Join'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    padding: '32px',
    maxWidth: '900px',
    margin: '0 auto',
    background: '#F8FAFC',
    minHeight: '100vh'
  },
  header: {
    marginBottom: '32px'
  },
  title: {
    fontSize: '32px',
    fontWeight: '700',
    color: '#1E293B',
    margin: '0 0 8px 0'
  },
  subtitle: {
    fontSize: '14px',
    color: '#64748B',
    margin: 0
  },
  tabs: {
    display: 'flex',
    gap: '8px',
    marginBottom: '24px',
    borderBottom: '2px solid #E2E8F0',
    paddingBottom: '0'
  },
  tab: {
    padding: '12px 20px',
    background: 'transparent',
    border: 'none',
    borderBottom: '3px solid transparent',
    fontSize: '14px',
    fontWeight: '600',
    color: '#64748B',
    cursor: 'pointer',
    transition: 'all 0.2s',
    marginBottom: '-2px'
  },
  tabActive: {
    color: '#4F46E5',
    borderBottomColor: '#4F46E5'
  },
  card: {
    background: '#FFFFFF',
    borderRadius: '16px',
    padding: '32px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)'
  },
  cardTitle: {
    fontSize: '20px',
    fontWeight: '600',
    color: '#1E293B',
    margin: '0 0 24px 0'
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
  saveButton: {
    width: '100%',
    padding: '14px',
    background: 'linear-gradient(135deg, #4F46E5 0%, #6366F1 100%)',
    border: 'none',
    borderRadius: '10px',
    color: '#FFFFFF',
    fontSize: '15px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'transform 0.2s, box-shadow 0.2s',
    boxShadow: '0 4px 12px rgba(79, 70, 229, 0.3)',
    marginTop: '8px'
  },
  errorBox: {
    padding: '14px 18px',
    background: '#FEF2F2',
    border: '1px solid #FECACA',
    borderRadius: '10px',
    color: '#DC2626',
    fontSize: '14px',
    marginBottom: '20px'
  },
  successBox: {
    padding: '14px 18px',
    background: '#F0FDF4',
    border: '1px solid #BBF7D0',
    borderRadius: '10px',
    color: '#16A34A',
    fontSize: '14px',
    marginBottom: '20px'
  },
  infoBox: {
    padding: '24px',
    background: '#F0F9FF',
    border: '1px solid #BAE6FD',
    borderRadius: '12px',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center'
  },
  imageSection: {
    marginBottom: '32px',
    paddingBottom: '32px',
    borderBottom: '2px solid #E2E8F0'
  },
  imageContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px'
  },
  imagePreview: {
    width: '120px',
    height: '120px',
    borderRadius: '50%',
    overflow: 'hidden',
    border: '4px solid #E2E8F0',
    background: '#F8FAFC',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  previewImage: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  placeholderIcon: {
    color: '#94A3B8'
  },
  imageButtons: {
    display: 'flex',
    gap: '12px'
  },
  uploadButton: {
    padding: '10px 20px',
    background: 'linear-gradient(135deg, #4F46E5 0%, #6366F1 100%)',
    border: 'none',
    borderRadius: '8px',
    color: '#FFFFFF',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s',
    boxShadow: '0 2px 8px rgba(79, 70, 229, 0.2)'
  },
  removeButton: {
    padding: '10px 20px',
    background: '#FEF2F2',
    border: '1px solid #FECACA',
    borderRadius: '8px',
    color: '#DC2626',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  cancelButton: {
    padding: '10px 20px',
    background: '#F3F4F6',
    border: '1px solid #D1D5DB',
    borderRadius: '8px',
    color: '#6B7280',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  imageHint: {
    fontSize: '12px',
    color: '#94A3B8',
    margin: 0
  }
};

export default MyProfile;
