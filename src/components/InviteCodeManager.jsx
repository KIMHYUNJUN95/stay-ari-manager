import React, { useState, useEffect, useCallback } from 'react';
import { collection, addDoc, query, where, getDocs, updateDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { useUser } from '../contexts/UserContext';

function InviteCodeManager() {
  const { companyId, userData } = useUser();
  const [inviteCodes, setInviteCodes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(null);

  // 기존 초대 코드 불러오기
  const fetchInviteCodes = useCallback(async () => {
    if (!companyId) return;

    setLoading(true);
    try {
      const q = query(
        collection(db, 'inviteCodes'),
        where('companyId', '==', companyId)
      );
      const snapshot = await getDocs(q);
      const codes = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setInviteCodes(codes);
    } catch (error) {
      console.error('Error fetching invite codes:', error);
      alert('Failed to load invite codes');
    }
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    if (companyId) {
      fetchInviteCodes();
    }
  }, [companyId, fetchInviteCodes]);

  // 새로운 초대 코드 생성
  const generateInviteCode = async () => {
    if (!companyId) {
      alert('No company ID found');
      return;
    }

    // Owner만 초대 코드 생성 가능
    if (userData?.role !== 'owner') {
      alert('Only company owners can generate invite codes');
      return;
    }

    setLoading(true);
    try {
      // 랜덤 8자리 코드 생성 (대문자 + 숫자)
      const code = Math.random().toString(36).substring(2, 10).toUpperCase();

      await addDoc(collection(db, 'inviteCodes'), {
        code: code,
        companyId: companyId,
        createdBy: userData.email,
        createdAt: new Date().toISOString(),
        status: 'active',
        usedCount: 0
      });

      alert(`Invite code created: ${code}`);
      fetchInviteCodes();
    } catch (error) {
      console.error('Error creating invite code:', error);
      alert('Failed to create invite code');
    }
    setLoading(false);
  };

  // 초대 코드 비활성화
  const deactivateCode = async (codeId) => {
    if (!window.confirm('Are you sure you want to deactivate this invite code?')) {
      return;
    }

    try {
      await updateDoc(doc(db, 'inviteCodes', codeId), {
        status: 'inactive',
        deactivatedAt: new Date().toISOString()
      });
      fetchInviteCodes();
    } catch (error) {
      console.error('Error deactivating code:', error);
      alert('Failed to deactivate code');
    }
  };

  // 클립보드에 복사
  const copyToClipboard = (code) => {
    navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 2000);
  };

  // Owner가 아니면 접근 불가
  if (userData && userData.role !== 'owner') {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ fontSize: '64px', marginBottom: '20px' }}>🔒</div>
        <h2 style={{ fontSize: '24px', color: '#475569', marginBottom: '12px' }}>Access Restricted</h2>
        <p style={{ fontSize: '16px', color: '#94A3B8' }}>
          Only company owners can manage invite codes.
        </p>
      </div>
    );
  }

  return (
    <div style={{ background: '#FFFFFF', minHeight: '100vh', padding: '32px' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <div>
              <h1 style={{ fontSize: '28px', fontWeight: '700', color: '#1E293B', margin: 0, marginBottom: '8px' }}>
                Team Invite Codes
              </h1>
              <p style={{ fontSize: '14px', color: '#64748B', margin: 0 }}>
                Generate and manage invite codes for your team members
              </p>
            </div>
            <button
              onClick={generateInviteCode}
              disabled={loading}
              style={{
                padding: '14px 24px',
                background: loading ? '#94A3B8' : 'linear-gradient(135deg, #4F46E5 0%, #6366F1 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                fontWeight: '600',
                boxShadow: '0 2px 8px rgba(79, 70, 229, 0.15)',
                transition: 'all 0.2s ease'
              }}
            >
              {loading ? 'Generating...' : '+ Generate Code'}
            </button>
          </div>
        </div>

        {/* Info Box */}
        <div style={{
          padding: '20px',
          background: '#F0F9FF',
          border: '1px solid #BAE6FD',
          borderRadius: '12px',
          marginBottom: '32px'
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <span style={{ fontSize: '24px' }}>💡</span>
            <div>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: '600', color: '#0369A1' }}>
                How it works
              </h3>
              <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: '#475569', lineHeight: '1.6' }}>
                <li>Generate an invite code and share it with your team members</li>
                <li>When they sign up with the code, they'll automatically join your company</li>
                <li>They'll have access to all the same data as you</li>
                <li>You can deactivate codes at any time to prevent new sign-ups</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Codes List */}
        {loading && inviteCodes.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#94A3B8' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>⏳</div>
            <div>Loading invite codes...</div>
          </div>
        ) : inviteCodes.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#94A3B8' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎫</div>
            <div style={{ fontSize: '16px', fontWeight: '600', color: '#475569', marginBottom: '8px' }}>
              No invite codes yet
            </div>
            <div style={{ fontSize: '14px' }}>
              Click "Generate Code" to create your first invite code
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '16px' }}>
            {inviteCodes.map(inviteCode => (
              <div
                key={inviteCode.id}
                style={{
                  background: inviteCode.status === 'active' ? '#FFFFFF' : '#F8FAFC',
                  border: `2px solid ${inviteCode.status === 'active' ? '#4F46E5' : '#E2E8F0'}`,
                  borderRadius: '12px',
                  padding: '20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  opacity: inviteCode.status === 'active' ? 1 : 0.6
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                    <span style={{
                      fontFamily: 'monospace',
                      fontSize: '20px',
                      fontWeight: '700',
                      color: inviteCode.status === 'active' ? '#4F46E5' : '#64748B',
                      letterSpacing: '2px'
                    }}>
                      {inviteCode.code}
                    </span>
                    {inviteCode.status === 'active' ? (
                      <span style={{
                        padding: '4px 12px',
                        background: '#DEF7EC',
                        color: '#047857',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: '600'
                      }}>
                        Active
                      </span>
                    ) : (
                      <span style={{
                        padding: '4px 12px',
                        background: '#FEE2E2',
                        color: '#DC2626',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: '600'
                      }}>
                        Inactive
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '13px', color: '#64748B' }}>
                    Created {new Date(inviteCode.createdAt).toLocaleDateString()} by {inviteCode.createdBy}
                    {inviteCode.usedCount > 0 && ` • Used ${inviteCode.usedCount} time${inviteCode.usedCount !== 1 ? 's' : ''}`}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  {inviteCode.status === 'active' && (
                    <>
                      <button
                        onClick={() => copyToClipboard(inviteCode.code)}
                        style={{
                          padding: '10px 20px',
                          background: copied === inviteCode.code ? '#10B981' : '#F1F5F9',
                          color: copied === inviteCode.code ? 'white' : '#475569',
                          border: 'none',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          fontSize: '13px',
                          fontWeight: '600',
                          transition: 'all 0.2s'
                        }}
                      >
                        {copied === inviteCode.code ? '✓ Copied' : 'Copy'}
                      </button>
                      <button
                        onClick={() => deactivateCode(inviteCode.id)}
                        style={{
                          padding: '10px 20px',
                          background: '#FEF2F2',
                          color: '#DC2626',
                          border: 'none',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          fontSize: '13px',
                          fontWeight: '600',
                          transition: 'all 0.2s'
                        }}
                      >
                        Deactivate
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default InviteCodeManager;
