import { useState, useEffect, useRef, useCallback } from 'react';
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useUser } from '../contexts/UserContext';
import { useNavigate } from 'react-router-dom';

// ─────────────────────────────────────────────
// 초기화 지연 (첫 로드 시 기존 메시지로 알람 뜨는 것 방지)
// ─────────────────────────────────────────────
const INIT_DELAY_MS = 3000;

const getInitials = (name = '') =>
  name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '??';

const TOAST_COLORS = {
  dm:        { bg: '#1E293B', accent: '#4F46E5', icon: '💬' },
  broadcast: { bg: '#1E293B', accent: '#7C3AED', icon: '📣' },
  announce:  { bg: '#1E293B', accent: '#059669', icon: '📌' },
  feedback:  { bg: '#1E293B', accent: '#DC2626', icon: '💡' },
};

// ─────────────────────────────────────────────
// Single Toast Item
// ─────────────────────────────────────────────
function ToastItem({ toast, onClose, onClick }) {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const timerRef = useRef(null);
  const c = TOAST_COLORS[toast.type] || TOAST_COLORS.dm;

  useEffect(() => {
    // Slide in
    requestAnimationFrame(() => setVisible(true));
    // Auto dismiss
    timerRef.current = setTimeout(() => dismiss(), 5000);
    return () => clearTimeout(timerRef.current);
  }, []);

  const dismiss = useCallback(() => {
    setLeaving(true);
    setTimeout(() => onClose(toast.id), 350);
  }, [toast.id, onClose]);

  const handleClick = () => {
    dismiss();
    onClick?.(toast);
  };

  return (
    <div
      onClick={handleClick}
      onMouseEnter={() => clearTimeout(timerRef.current)}
      onMouseLeave={() => { timerRef.current = setTimeout(() => dismiss(), 2000); }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        background: c.bg,
        borderLeft: `4px solid ${c.accent}`,
        borderRadius: '14px',
        padding: '12px 16px',
        minWidth: '300px',
        maxWidth: '380px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
        cursor: 'pointer',
        userSelect: 'none',
        transform: visible && !leaving ? 'translateY(0) scale(1)' : 'translateY(80px) scale(0.95)',
        opacity: visible && !leaving ? 1 : 0,
        transition: leaving
          ? 'transform 0.3s ease-in, opacity 0.3s ease-in'
          : 'transform 0.35s cubic-bezier(0.34,1.56,0.64,1), opacity 0.25s ease-out',
        pointerEvents: 'auto',
      }}
    >
      {/* Avatar */}
      <div style={{
        width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
        background: `linear-gradient(135deg, ${c.accent}, ${c.accent}99)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: toast.type === 'broadcast' || toast.type === 'announce' ? '18px' : '14px',
        fontWeight: '700', color: '#fff',
      }}>
        {toast.type === 'broadcast' || toast.type === 'announce'
          ? c.icon
          : getInitials(toast.senderName)}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
          <span style={{ fontSize: '13px', fontWeight: '700', color: '#F8FAFC' }}>
            {toast.title}
          </span>
          <span style={{ fontSize: '11px', color: '#94A3B8', marginLeft: '8px', flexShrink: 0 }}>
            {toast.type === 'dm' ? 'Direct Message' : toast.type === 'broadcast' ? 'All Team' : toast.type === 'announce' ? 'Announcement' : 'Feedback'}
          </span>
        </div>
        <div style={{
          fontSize: '13px', color: '#CBD5E1', lineHeight: '1.4',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {toast.body}
        </div>
      </div>

      {/* Close */}
      <button
        onClick={e => { e.stopPropagation(); dismiss(); }}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', fontSize: '16px', padding: '0 0 0 4px', flexShrink: 0, lineHeight: 1 }}
      >
        ✕
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────
// Toast Container + Logic
// ─────────────────────────────────────────────
export default function TeamToast() {
  const { user, userData, companyId } = useUser();
  const [toasts, setToasts] = useState([]);
  const navigate = useNavigate();
  const readyRef = useRef(false);
  const seenRef = useRef(new Set());

  const push = useCallback((toast) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts(prev => [...prev.slice(-4), { ...toast, id }]); // max 5 stacked
  }, []);

  const remove = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const handleClick = useCallback((toast) => {
    navigate('/team');
  }, [navigate]);

  // Init: mark as ready after delay (skip initial snapshot)
  useEffect(() => {
    if (!companyId || !user?.uid) return;
    const timer = setTimeout(() => { readyRef.current = true; }, INIT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [companyId, user?.uid]);

  // Watch Broadcast messages
  useEffect(() => {
    if (!companyId || !user?.uid) return;
    const q = query(
      collection(db, 'broadcastMessages', companyId, 'messages'),
      orderBy('createdAt', 'desc'), limit(1)
    );
    return onSnapshot(q, snap => {
      if (!readyRef.current) return;
      snap.docChanges().forEach(change => {
        if (change.type !== 'added') return;
        const d = change.doc.data();
        if (d.senderUid === user.uid) return; // 본인 메시지 skip
        if (seenRef.current.has(change.doc.id)) return;
        seenRef.current.add(change.doc.id);
        push({
          type: 'broadcast',
          title: d.senderName || 'Team',
          body: d.text || '',
          senderName: d.senderName,
        });
      });
    });
  }, [companyId, user?.uid, push]);

  // Watch DM messages (conversations I'm part of)
  useEffect(() => {
    if (!companyId || !user?.uid) return;
    const convQ = query(
      collection(db, 'dmConversations'),
      where('companyId', '==', companyId),
      where('participants', 'array-contains', user.uid)
    );
    const unsubConvs = [];

    const unsubMain = onSnapshot(convQ, convSnap => {
      // Unsubscribe old message listeners
      unsubConvs.forEach(fn => fn());
      unsubConvs.length = 0;

      convSnap.docs.forEach(convDoc => {
        const convId = convDoc.id;
        const msgQ = query(
          collection(db, 'dmMessages', convId, 'messages'),
          orderBy('createdAt', 'desc'), limit(1)
        );
        const unsub = onSnapshot(msgQ, msgSnap => {
          if (!readyRef.current) return;
          msgSnap.docChanges().forEach(change => {
            if (change.type !== 'added') return;
            const d = change.doc.data();
            if (d.senderUid === user.uid) return;
            if (seenRef.current.has(change.doc.id)) return;
            seenRef.current.add(change.doc.id);
            push({
              type: 'dm',
              title: d.senderName || 'Someone',
              body: d.text || '',
              senderName: d.senderName,
              convId,
            });
          });
        });
        unsubConvs.push(unsub);
      });
    });

    return () => {
      unsubMain();
      unsubConvs.forEach(fn => fn());
    };
  }, [companyId, user?.uid, push]);

  // Watch Announcements
  useEffect(() => {
    if (!companyId || !user?.uid) return;
    const q = query(
      collection(db, 'announcements'),
      where('companyId', '==', companyId),
      orderBy('createdAt', 'desc'), limit(1)
    );
    return onSnapshot(q, snap => {
      if (!readyRef.current) return;
      snap.docChanges().forEach(change => {
        if (change.type !== 'added') return;
        const d = change.doc.data();
        if (d.authorUid === user.uid) return;
        if (seenRef.current.has(change.doc.id)) return;
        seenRef.current.add(change.doc.id);
        push({
          type: 'announce',
          title: d.title || 'New Announcement',
          body: d.body || '',
          senderName: d.authorName,
        });
      });
    });
  }, [companyId, user?.uid, push]);

  // Watch Feedback comments (only on my own feedback)
  useEffect(() => {
    if (!companyId || !user?.uid) return;
    const q = query(
      collection(db, 'feedback'),
      where('companyId', '==', companyId),
      where('authorUid', '==', user.uid)
    );
    return onSnapshot(q, snap => {
      if (!readyRef.current) return;
      snap.docChanges().forEach(change => {
        if (change.type !== 'modified') return;
        const d = change.doc.data();
        const comments = d.comments || [];
        const last = comments[comments.length - 1];
        if (!last || last.uid === user.uid) return;
        const key = `feedback-${change.doc.id}-${comments.length}`;
        if (seenRef.current.has(key)) return;
        seenRef.current.add(key);
        push({
          type: 'feedback',
          title: last.name || 'Someone',
          body: `Replied to "${d.title}"`,
          senderName: last.name,
        });
      });
    });
  }, [companyId, user?.uid, push]);

  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      alignItems: 'flex-end',
      pointerEvents: 'none',
    }}>
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onClose={remove} onClick={handleClick} />
      ))}
    </div>
  );
}
