import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useUser } from '../contexts/UserContext';

// 점검 중일 때 다른 사용자에게 보여줄 화면
function MaintenanceScreen({ message }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 50%, #0F172A 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      {/* Animated background dots */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', opacity: 0.15 }}>
        {[...Array(6)].map((_, i) => (
          <div key={i} style={{
            position: 'absolute',
            width: `${120 + i * 80}px`, height: `${120 + i * 80}px`,
            borderRadius: '50%',
            border: '1px solid #4F46E5',
            top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            animation: `pulse ${2 + i * 0.4}s ease-in-out infinite alternate`,
          }} />
        ))}
      </div>

      <style>{`
        @keyframes pulse { from { opacity: 0.3; transform: translate(-50%,-50%) scale(1); } to { opacity: 0.7; transform: translate(-50%,-50%) scale(1.05); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      <div style={{ position: 'relative', textAlign: 'center', padding: '40px', maxWidth: '520px', animation: 'fadeIn 0.6s ease-out' }}>
        {/* Icon */}
        <div style={{
          width: 80, height: 80, borderRadius: '20px',
          background: 'linear-gradient(135deg, #4F46E5, #7C3AED)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '36px', margin: '0 auto 28px',
          boxShadow: '0 0 40px rgba(79,70,229,0.4)',
        }}>
          🔧
        </div>

        {/* Spinner */}
        <div style={{
          width: 40, height: 40, margin: '0 auto 28px',
          border: '3px solid #1E293B',
          borderTop: '3px solid #4F46E5',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
        }} />

        <h1 style={{ fontSize: '28px', fontWeight: '800', color: '#F8FAFC', margin: '0 0 12px', letterSpacing: '-0.5px' }}>
          Under Maintenance
        </h1>
        <p style={{ fontSize: '16px', color: '#94A3B8', lineHeight: '1.6', margin: '0 0 28px' }}>
          {message || 'We are currently performing scheduled maintenance.\nPlease check back shortly.'}
        </p>

        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '8px',
          padding: '10px 20px', borderRadius: '10px',
          background: 'rgba(79,70,229,0.15)', border: '1px solid rgba(79,70,229,0.3)',
          fontSize: '13px', color: '#818CF8',
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#F59E0B', display: 'inline-block', animation: 'pulse 1s ease-in-out infinite alternate' }} />
          Maintenance in progress
        </div>

        <p style={{ fontSize: '12px', color: '#475569', marginTop: '32px' }}>
          Haru Studio · Property Management System
        </p>
      </div>
    </div>
  );
}

// 점검 상태를 감시하고, 점검 중이면 해당 화면으로 교체
export default function MaintenanceGuard({ children }) {
  const { user, userData, companyId, loading } = useUser();
  const [maintenance, setMaintenance] = useState(null); // null = 로딩중

  useEffect(() => {
    if (!companyId) {
      setMaintenance({ active: false });
      return;
    }
    const ref = doc(db, 'maintenanceMode', companyId);
    return onSnapshot(ref, snap => {
      if (snap.exists()) {
        setMaintenance(snap.data());
      } else {
        setMaintenance({ active: false });
      }
    });
  }, [companyId]);

  // 유저/점검 상태 로딩 중
  if (loading || maintenance === null) return null;

  // 점검 활성 + 본인(점검 시작한 사람)이 아닌 경우 → 점검 화면
  if (maintenance.active && maintenance.startedBy !== user?.uid) {
    return <MaintenanceScreen message={maintenance.message} />;
  }

  return children;
}
