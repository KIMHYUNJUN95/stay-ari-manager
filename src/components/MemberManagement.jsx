import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  collection, query, where, onSnapshot, addDoc, updateDoc, doc,
  getDocs, orderBy, serverTimestamp, arrayUnion, getDoc, deleteDoc, limit,
  setDoc
} from 'firebase/firestore';
import { db } from '../firebase';
import { useUser } from '../contexts/UserContext';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────
const ROLE_CONFIG = {
  owner:   { label: 'Owner',   color: '#7C3AED', bg: '#F5F3FF', icon: '👑' },
  manager: { label: 'Manager', color: '#0369A1', bg: '#F0F9FF', icon: '🔧' },
  staff:   { label: 'Staff',   color: '#059669', bg: '#ECFDF5', icon: '🧹' },
  viewer:  { label: 'Viewer',  color: '#64748B', bg: '#F8FAFC', icon: '👁'  },
};

const FEEDBACK_TYPES = {
  bug:        { label: 'Bug Report',       icon: '🐛', color: '#DC2626', bg: '#FEF2F2' },
  suggestion: { label: 'Feature Request',  icon: '💡', color: '#D97706', bg: '#FFFBEB' },
  general:    { label: 'General Feedback', icon: '📣', color: '#2563EB', bg: '#EFF6FF' },
  urgent:     { label: 'Urgent Issue',     icon: '🚨', color: '#DC2626', bg: '#FEF2F2' },
};

const FEEDBACK_STATUS = {
  open:       { label: 'Open',       color: '#DC2626', bg: '#FEF2F2' },
  reviewing:  { label: 'Reviewing',  color: '#D97706', bg: '#FFFBEB' },
  resolved:   { label: 'Resolved',   color: '#059669', bg: '#ECFDF5' },
};

const TABS = ['Members', 'Invite Codes', 'Messages', 'Feedback', 'Announcements', 'Activity Log', '🔧 Maintenance'];

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
const getInitials = (name = '') =>
  name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '??';

const timeAgo = (ts) => {
  if (!ts) return '';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  const diff = Math.floor((Date.now() - d) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const isOnline = (m) => {
  // isOnline: set true on login/heartbeat, false on tab close/logout
  if (m?.isOnline === true) return true;
  // fallback: lastSeen within 2min (in case isOnline field not yet set)
  const ts = m?.lastSeen || m?.lastLoginAt;
  if (!ts) return false;
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return Date.now() - d < 2 * 60 * 1000;
};

// ─────────────────────────────────────────────
// SHARED STYLES
// ─────────────────────────────────────────────
const S = {
  page: { padding: '32px', background: '#FFFFFF', minHeight: '100vh', fontFamily: 'Inter, system-ui, sans-serif' },
  pageHeader: { marginBottom: '28px' },
  pageTitle: { fontSize: '24px', fontWeight: '700', color: '#0F172A', margin: 0, letterSpacing: '-0.4px' },
  pageSubtitle: { fontSize: '14px', color: '#64748B', marginTop: '4px' },
  tabBar: { display: 'flex', gap: '4px', background: '#F1F5F9', padding: '4px', borderRadius: '12px', marginBottom: '28px', width: 'fit-content' },
  tab: (active) => ({
    padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: '600', border: 'none',
    cursor: 'pointer', background: active ? '#FFFFFF' : 'transparent',
    color: active ? '#4F46E5' : '#64748B',
    boxShadow: active ? '0 1px 3px rgba(0,0,0,0.08)' : 'none', transition: 'all 0.15s',
  }),
  card: { background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '16px', padding: '20px' },
  btn: (variant = 'primary') => ({
    padding: '9px 18px', borderRadius: '10px', border: 'none', cursor: 'pointer',
    fontSize: '13px', fontWeight: '600', transition: 'all 0.15s',
    ...(variant === 'primary' && { background: '#4F46E5', color: '#fff' }),
    ...(variant === 'ghost' && { background: '#F1F5F9', color: '#475569' }),
    ...(variant === 'danger' && { background: '#FEF2F2', color: '#DC2626' }),
    ...(variant === 'success' && { background: '#ECFDF5', color: '#059669' }),
  }),
  badge: (color, bg) => ({
    display: 'inline-flex', alignItems: 'center', gap: '4px',
    padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '600',
    color, background: bg, border: `1px solid ${color}22`,
  }),
  input: {
    padding: '10px 14px', borderRadius: '10px', border: '1px solid #CBD5E1',
    fontSize: '14px', outline: 'none', width: '100%', boxSizing: 'border-box',
    fontFamily: 'inherit',
  },
  avatar: (size = 40) => ({
    width: size, height: size, borderRadius: '50%',
    background: 'linear-gradient(135deg, #4F46E5, #7C3AED)',
    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: size * 0.35, fontWeight: '700', flexShrink: 0,
  }),
  emptyState: { textAlign: 'center', padding: '60px 20px', color: '#94A3B8' },
};

// ─────────────────────────────────────────────
// TAB 1: MEMBERS
// ─────────────────────────────────────────────
function TabMembers({ companyId, currentUser, userData }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [changingRole, setChangingRole] = useState(null);

  useEffect(() => {
    if (!companyId) return;
    const q = query(collection(db, 'users'), where('companyId', '==', companyId));
    const unsub = onSnapshot(q, snap => {
      setMembers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return unsub;
  }, [companyId]);

  const isOwner = userData?.role === 'owner';

  const filtered = useMemo(() => {
    let list = members;
    if (roleFilter !== 'all') list = list.filter(m => m.role === roleFilter);
    if (search.trim()) {
      const t = search.toLowerCase();
      list = list.filter(m =>
        (m.displayName || m.name || '').toLowerCase().includes(t) ||
        (m.email || '').toLowerCase().includes(t)
      );
    }
    return list.sort((a, b) => {
      const order = { owner: 0, manager: 1, staff: 2, viewer: 3 };
      return (order[a.role] ?? 9) - (order[b.role] ?? 9);
    });
  }, [members, search, roleFilter]);

  const handleRoleChange = async (memberId, newRole) => {
    if (!isOwner || memberId === currentUser?.uid) return;
    await updateDoc(doc(db, 'users', memberId), { role: newRole });
    setChangingRole(null);
    // Log activity
    await addDoc(collection(db, 'activityLogs'), {
      companyId, uid: currentUser.uid,
      userName: userData?.displayName || userData?.name || currentUser.email,
      action: 'ROLE_CHANGED',
      detail: `Changed member role to ${newRole}`,
      createdAt: serverTimestamp(),
    });
  };

  const handleRemove = async (member) => {
    if (!isOwner || member.id === currentUser?.uid) return;
    if (!window.confirm(`Remove ${member.displayName || member.email} from the team?`)) return;
    await updateDoc(doc(db, 'users', member.id), { companyId: null, role: null, removedAt: serverTimestamp() });
    await addDoc(collection(db, 'activityLogs'), {
      companyId, uid: currentUser.uid,
      userName: userData?.displayName || userData?.name || currentUser.email,
      action: 'MEMBER_REMOVED',
      detail: `Removed member: ${member.displayName || member.email}`,
      createdAt: serverTimestamp(),
    });
  };

  if (loading) return <div style={S.emptyState}>⏳ Loading members...</div>;

  return (
    <div>
      {/* Controls */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <input style={{ ...S.input, maxWidth: '260px' }} placeholder="Search members..." value={search} onChange={e => setSearch(e.target.value)} />
        <select style={{ ...S.input, width: 'auto' }} value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
          <option value="all">All Roles</option>
          {Object.entries(ROLE_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
        </select>
        <div style={{ marginLeft: 'auto', fontSize: '13px', color: '#64748B', alignSelf: 'center' }}>
          {filtered.length} member{filtered.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Table */}
      <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: '16px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
              {['Member', 'Role', 'Status', 'Joined', 'Last Active', 'Actions'].map(h => (
                <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((m, i) => {
              const role = ROLE_CONFIG[m.role] || ROLE_CONFIG.viewer;
              const name = m.displayName || m.name || m.email || 'Unknown';
              const online = isOnline(m);
              const isSelf = m.id === currentUser?.uid;
              return (
                <tr key={m.id} style={{ borderBottom: i < filtered.length - 1 ? '1px solid #F1F5F9' : 'none', background: isSelf ? '#FAFAFF' : '#fff' }}>
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ position: 'relative' }}>
                        {m.photoURL
                          ? <img src={m.photoURL} alt={name} style={{ ...S.avatar(38), objectFit: 'cover' }} />
                          : <div style={S.avatar(38)}>{getInitials(name)}</div>
                        }
                        <div style={{ position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderRadius: '50%', background: online ? '#10B981' : '#CBD5E1', border: '2px solid #fff' }} />
                      </div>
                      <div>
                        <div style={{ fontWeight: '600', fontSize: '14px', color: '#1E293B' }}>
                          {name} {isSelf && <span style={{ fontSize: '11px', color: '#94A3B8' }}>(You)</span>}
                        </div>
                        <div style={{ fontSize: '12px', color: '#64748B' }}>{m.email}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    {isOwner && !isSelf && changingRole === m.id ? (
                      <select
                        defaultValue={m.role}
                        autoFocus
                        onChange={e => handleRoleChange(m.id, e.target.value)}
                        onBlur={() => setChangingRole(null)}
                        style={{ ...S.input, width: 'auto', padding: '6px 10px', fontSize: '13px' }}
                      >
                        {Object.entries(ROLE_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                      </select>
                    ) : (
                      <span
                        style={{ ...S.badge(role.color, role.bg), cursor: isOwner && !isSelf ? 'pointer' : 'default' }}
                        onClick={() => isOwner && !isSelf && setChangingRole(m.id)}
                        title={isOwner && !isSelf ? 'Click to change role' : ''}
                      >
                        {role.icon} {role.label}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: online ? '#059669' : '#94A3B8' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: online ? '#10B981' : '#CBD5E1', display: 'inline-block' }} />
                      {online ? 'Online' : 'Offline'}
                    </span>
                  </td>
                  <td style={{ padding: '14px 16px', fontSize: '13px', color: '#64748B' }}>
                    {m.joinedAt ? new Date(m.joinedAt?.toDate ? m.joinedAt.toDate() : m.joinedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                  </td>
                  <td style={{ padding: '14px 16px', fontSize: '13px', color: '#64748B' }}>
                    {m.lastLoginAt ? timeAgo(m.lastLoginAt) : '—'}
                  </td>
                  <td style={{ padding: '14px 16px' }}>
                    {isOwner && !isSelf && (
                      <button style={S.btn('danger')} onClick={() => handleRemove(m)}>Remove</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <div style={S.emptyState}>👥 No members found</div>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// TAB 2: INVITE CODES
// ─────────────────────────────────────────────
function TabInviteCodes({ companyId, currentUser, userData }) {
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ targetRole: 'staff', maxUses: '1', expiresIn: '7' });
  const [copied, setCopied] = useState(null);
  const isOwner = userData?.role === 'owner';

  useEffect(() => {
    if (!companyId) return;
    const q = query(collection(db, 'inviteCodes'), where('companyId', '==', companyId), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setCodes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return unsub;
  }, [companyId]);

  const generateCode = async () => {
    if (!isOwner) return;
    setCreating(true);
    const code = Math.random().toString(36).substring(2, 10).toUpperCase();
    const expiresAt = form.expiresIn !== 'never'
      ? new Date(Date.now() + parseInt(form.expiresIn) * 86400000)
      : null;
    await addDoc(collection(db, 'inviteCodes'), {
      code, companyId,
      targetRole: form.targetRole,
      maxUses: form.maxUses === 'unlimited' ? null : parseInt(form.maxUses),
      expiresAt,
      createdBy: userData?.displayName || userData?.name || currentUser.email,
      createdAt: serverTimestamp(),
      status: 'active',
      usedCount: 0,
      usedBy: [],
    });
    setShowForm(false);
    setCreating(false);
  };

  const deactivate = async (id) => {
    if (!window.confirm('Deactivate this invite code?')) return;
    await updateDoc(doc(db, 'inviteCodes', id), { status: 'inactive' });
  };

  const copyLink = (code) => {
    const url = `${window.location.origin}?invite=${code}`;
    navigator.clipboard.writeText(url);
    setCopied(code);
    setTimeout(() => setCopied(null), 2000);
  };

  if (!isOwner) return (
    <div style={S.emptyState}>
      <div style={{ fontSize: '48px', marginBottom: '12px' }}>🔒</div>
      <div style={{ fontWeight: '600', color: '#475569' }}>Owner access only</div>
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div style={{ fontSize: '14px', color: '#64748B' }}>{codes.filter(c => c.status === 'active').length} active codes</div>
        <button style={S.btn('primary')} onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ Generate Code'}
        </button>
      </div>

      {/* Create Form */}
      {showForm && (
        <div style={{ ...S.card, marginBottom: '20px', background: '#FAFAFF', border: '1px solid #C7D2FE' }}>
          <div style={{ fontWeight: '600', color: '#1E293B', marginBottom: '16px' }}>New Invite Code</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '16px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: '600', color: '#64748B', display: 'block', marginBottom: '6px' }}>ROLE</label>
              <select style={S.input} value={form.targetRole} onChange={e => setForm(f => ({ ...f, targetRole: e.target.value }))}>
                {Object.entries(ROLE_CONFIG).filter(([k]) => k !== 'owner').map(([k, v]) => (
                  <option key={k} value={k}>{v.icon} {v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: '600', color: '#64748B', display: 'block', marginBottom: '6px' }}>MAX USES</label>
              <select style={S.input} value={form.maxUses} onChange={e => setForm(f => ({ ...f, maxUses: e.target.value }))}>
                <option value="1">1 time (single use)</option>
                <option value="5">5 times</option>
                <option value="10">10 times</option>
                <option value="unlimited">Unlimited</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: '600', color: '#64748B', display: 'block', marginBottom: '6px' }}>EXPIRES IN</label>
              <select style={S.input} value={form.expiresIn} onChange={e => setForm(f => ({ ...f, expiresIn: e.target.value }))}>
                <option value="1">1 day</option>
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="never">Never</option>
              </select>
            </div>
          </div>
          <button style={{ ...S.btn('primary'), opacity: creating ? 0.6 : 1 }} onClick={generateCode} disabled={creating}>
            {creating ? 'Generating...' : 'Generate Code'}
          </button>
        </div>
      )}

      {/* Codes list */}
      {loading ? <div style={S.emptyState}>⏳ Loading...</div> : codes.length === 0 ? (
        <div style={S.emptyState}>🎫 No invite codes yet. Generate one above.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {codes.map(c => {
            const role = ROLE_CONFIG[c.targetRole] || ROLE_CONFIG.staff;
            const expired = c.expiresAt && new Date(c.expiresAt?.toDate ? c.expiresAt.toDate() : c.expiresAt) < new Date();
            const active = c.status === 'active' && !expired;
            return (
              <div key={c.id} style={{ background: active ? '#fff' : '#F8FAFC', border: `1.5px solid ${active ? '#4F46E5' : '#E2E8F0'}`, borderRadius: '12px', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '16px', opacity: active ? 1 : 0.6 }}>
                <div style={{ fontFamily: 'monospace', fontSize: '20px', fontWeight: '700', color: active ? '#4F46E5' : '#94A3B8', letterSpacing: '3px', minWidth: '100px' }}>{c.code}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                    <span style={S.badge(role.color, role.bg)}>{role.icon} {role.label}</span>
                    <span style={S.badge(active ? '#059669' : '#64748B', active ? '#ECFDF5' : '#F1F5F9')}>{active ? 'Active' : expired ? 'Expired' : 'Inactive'}</span>
                    {c.maxUses !== null && <span style={S.badge('#64748B', '#F8FAFC')}>Used {c.usedCount || 0}/{c.maxUses}</span>}
                    {c.maxUses === null && <span style={S.badge('#64748B', '#F8FAFC')}>Unlimited</span>}
                  </div>
                  <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                    Created by {c.createdBy} • {c.expiresAt ? `Expires ${new Date(c.expiresAt?.toDate ? c.expiresAt.toDate() : c.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'No expiry'}
                  </div>
                  {c.usedBy?.length > 0 && (
                    <div style={{ fontSize: '11px', color: '#64748B', marginTop: '4px' }}>
                      Used by: {c.usedBy.map(u => u.email).join(', ')}
                    </div>
                  )}
                </div>
                {active && (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button style={S.btn('ghost')} onClick={() => copyLink(c.code)}>
                      {copied === c.code ? '✓ Copied' : 'Copy Link'}
                    </button>
                    <button style={S.btn('danger')} onClick={() => deactivate(c.id)}>Deactivate</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// TAB 3: MESSAGES (DM + Broadcast)
// ─────────────────────────────────────────────
function TabMessages({ companyId, currentUser, userData }) {
  const [members, setMembers] = useState([]);
  const [selectedConv, setSelectedConv] = useState('broadcast'); // 'broadcast' | uid
  const [dmConversations, setDmConversations] = useState([]);
  const [messages, setMessages] = useState([]);
  const [broadcastMessages, setBroadcastMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);
  const myName = userData?.displayName || userData?.name || currentUser?.email || 'Me';

  // Load members
  useEffect(() => {
    if (!companyId) return;
    const q = query(collection(db, 'users'), where('companyId', '==', companyId));
    return onSnapshot(q, snap => setMembers(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, [companyId]);

  // Load DM conversations for current user
  useEffect(() => {
    if (!companyId || !currentUser?.uid) return;
    const q = query(
      collection(db, 'dmConversations'),
      where('companyId', '==', companyId),
      where('participants', 'array-contains', currentUser.uid)
    );
    return onSnapshot(q, snap => setDmConversations(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, [companyId, currentUser?.uid]);

  // Load messages based on selected conversation
  useEffect(() => {
    if (!companyId) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });

    if (selectedConv === 'broadcast') {
      const q = query(
        collection(db, 'broadcastMessages', companyId, 'messages'),
        orderBy('createdAt', 'asc'), limit(100)
      );
      return onSnapshot(q, snap => {
        setBroadcastMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      });
    } else {
      const convId = getDmConvId(currentUser.uid, selectedConv);
      const q = query(
        collection(db, 'dmMessages', convId, 'messages'),
        orderBy('createdAt', 'asc'), limit(100)
      );
      return onSnapshot(q, snap => {
        setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        // Mark as read
        snap.docs.forEach(d => {
          if (!(d.data().readBy || []).includes(currentUser.uid)) {
            updateDoc(d.ref, { readBy: arrayUnion(currentUser.uid) });
          }
        });
      });
    }
  }, [selectedConv, companyId, currentUser?.uid]);

  useEffect(() => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }, [messages, broadcastMessages]);

  const getDmConvId = (uid1, uid2) => [uid1, uid2].sort().join('_');

  const startDm = async (targetUid) => {
    const convId = getDmConvId(currentUser.uid, targetUid);
    const existing = await getDoc(doc(db, 'dmConversations', convId));
    if (!existing.exists()) {
      await addDoc(collection(db, 'dmConversations'), {
        companyId,
        participants: [currentUser.uid, targetUid],
        lastMessage: '',
        lastMessageAt: serverTimestamp(),
        unreadCount: { [currentUser.uid]: 0, [targetUid]: 0 },
      });
    }
    setSelectedConv(targetUid);
  };

  const sendMessage = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    const payload = {
      senderUid: currentUser.uid,
      senderName: myName,
      senderRole: userData?.role || 'staff',
      text: text.trim(),
      createdAt: serverTimestamp(),
      readBy: [currentUser.uid],
    };

    if (selectedConv === 'broadcast') {
      await addDoc(collection(db, 'broadcastMessages', companyId, 'messages'), payload);
      // Log
      await addDoc(collection(db, 'activityLogs'), {
        companyId, uid: currentUser.uid, userName: myName,
        action: 'BROADCAST_SENT', detail: text.trim().substring(0, 80),
        createdAt: serverTimestamp(),
      });
    } else {
      const convId = getDmConvId(currentUser.uid, selectedConv);
      await addDoc(collection(db, 'dmMessages', convId, 'messages'), payload);
      // Update conversation metadata
      const convRef = query(collection(db, 'dmConversations'), where('participants', 'array-contains', currentUser.uid));
      const snap = await getDocs(convRef);
      snap.docs.forEach(d => {
        if (d.data().participants.includes(selectedConv)) {
          updateDoc(d.ref, { lastMessage: text.trim(), lastMessageAt: serverTimestamp() });
        }
      });
    }
    setText('');
    setSending(false);
  };

  const currentMessages = selectedConv === 'broadcast' ? broadcastMessages : messages;
  const otherMember = selectedConv !== 'broadcast' ? members.find(m => m.id === selectedConv) : null;
  const otherMembers = members.filter(m => m.id !== currentUser?.uid);

  // Count unread DMs
  const unreadDm = (uid) => {
    const convId = getDmConvId(currentUser.uid, uid);
    const conv = dmConversations.find(c => c.id === convId || (c.participants?.includes(currentUser.uid) && c.participants?.includes(uid)));
    return conv?.unreadCount?.[currentUser.uid] || 0;
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: '0', height: 'calc(100vh - 320px)', border: '1px solid #E2E8F0', borderRadius: '16px', overflow: 'hidden' }}>
      {/* Left: Conversation List */}
      <div style={{ background: '#F8FAFC', borderRight: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column' }}>
        {/* Broadcast */}
        <div
          onClick={() => setSelectedConv('broadcast')}
          style={{ padding: '14px 16px', cursor: 'pointer', background: selectedConv === 'broadcast' ? '#EEF2FF' : 'transparent', borderBottom: '1px solid #E2E8F0' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'linear-gradient(135deg, #4F46E5, #7C3AED)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>📣</div>
            <div>
              <div style={{ fontWeight: '700', fontSize: '14px', color: '#1E293B' }}>All Team</div>
              <div style={{ fontSize: '11px', color: '#64748B' }}>Broadcast channel</div>
            </div>
          </div>
        </div>

        {/* DM section */}
        <div style={{ padding: '10px 16px 6px', fontSize: '11px', fontWeight: '700', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
          Direct Messages
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {otherMembers.map(m => {
            const name = m.displayName || m.name || m.email;
            const online = isOnline(m);
            const unread = unreadDm(m.id);
            return (
              <div
                key={m.id}
                onClick={() => startDm(m.id)}
                style={{ padding: '10px 16px', cursor: 'pointer', background: selectedConv === m.id ? '#EEF2FF' : 'transparent', display: 'flex', alignItems: 'center', gap: '10px' }}
              >
                <div style={{ position: 'relative' }}>
                  <div style={S.avatar(34)}>{getInitials(name)}</div>
                  <div style={{ position: 'absolute', bottom: 0, right: 0, width: 9, height: 9, borderRadius: '50%', background: online ? '#10B981' : '#CBD5E1', border: '2px solid #F8FAFC' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: '600', fontSize: '13px', color: '#1E293B', display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                    {unread > 0 && <span style={{ background: '#4F46E5', color: '#fff', borderRadius: '10px', padding: '1px 6px', fontSize: '11px', fontWeight: '700', flexShrink: 0 }}>{unread}</span>}
                  </div>
                  <div style={{ fontSize: '11px', color: '#94A3B8' }}>{ROLE_CONFIG[m.role]?.label || 'Member'}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right: Chat Area */}
      <div style={{ display: 'flex', flexDirection: 'column', background: '#fff' }}>
        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #E2E8F0', background: '#F8FAFC', display: 'flex', alignItems: 'center', gap: '12px' }}>
          {selectedConv === 'broadcast' ? (
            <>
              <div style={{ fontSize: '22px' }}>📣</div>
              <div>
                <div style={{ fontWeight: '700', fontSize: '15px', color: '#1E293B' }}>All Team</div>
                <div style={{ fontSize: '12px', color: '#64748B' }}>{members.length} members</div>
              </div>
            </>
          ) : (
            <>
              <div style={{ position: 'relative' }}>
                <div style={S.avatar(38)}>{getInitials(otherMember?.displayName || otherMember?.name || '')}</div>
                <div style={{ position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderRadius: '50%', background: isOnline(otherMember) ? '#10B981' : '#CBD5E1', border: '2px solid #F8FAFC' }} />
              </div>
              <div>
                <div style={{ fontWeight: '700', fontSize: '15px', color: '#1E293B' }}>{otherMember?.displayName || otherMember?.name || otherMember?.email}</div>
                <div style={{ fontSize: '12px', color: '#64748B' }}>{ROLE_CONFIG[otherMember?.role]?.label || 'Member'} · {isOnline(otherMember) ? '🟢 Online' : '⚫ Offline'}</div>
              </div>
            </>
          )}
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {currentMessages.length === 0 && (
            <div style={{ ...S.emptyState, margin: 'auto' }}>
              <div style={{ fontSize: '40px', marginBottom: '8px' }}>💬</div>
              <div>No messages yet. Say something!</div>
            </div>
          )}
          {currentMessages.map((msg) => {
            const isMine = msg.senderUid === currentUser?.uid;
            const readCount = (msg.readBy || []).length;
            const totalMembers = members.length;
            return (
              <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isMine ? 'flex-end' : 'flex-start' }}>
                {!isMine && <div style={{ fontSize: '11px', color: '#94A3B8', marginBottom: '3px', paddingLeft: '4px' }}>{msg.senderName} · {ROLE_CONFIG[msg.senderRole]?.label || ''}</div>}
                <div style={{ maxWidth: '65%', padding: '10px 14px', borderRadius: isMine ? '14px 14px 4px 14px' : '14px 14px 14px 4px', background: isMine ? '#4F46E5' : '#F1F5F9', color: isMine ? '#fff' : '#1E293B', fontSize: '14px', lineHeight: '1.5' }}>
                  {msg.text}
                </div>
                <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '3px', paddingLeft: '4px', paddingRight: '4px' }}>
                  {msg.createdAt ? timeAgo(msg.createdAt) : ''}
                  {isMine && selectedConv === 'broadcast' && ` · Read by ${readCount}/${totalMembers}`}
                  {isMine && selectedConv !== 'broadcast' && readCount > 1 && ' · ✓ Read'}
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid #E2E8F0', display: 'flex', gap: '10px' }}>
          <textarea
            style={{ ...S.input, flex: 1, resize: 'none', height: '42px', lineHeight: '1.4', padding: '10px 14px' }}
            placeholder={selectedConv === 'broadcast' ? 'Send a message to all team members...' : `Message ${otherMember?.displayName || otherMember?.name || ''}...`}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            rows={1}
          />
          <button style={{ ...S.btn('primary'), height: '42px', whiteSpace: 'nowrap', opacity: (!text.trim() || sending) ? 0.5 : 1 }} onClick={sendMessage} disabled={!text.trim() || sending}>
            {sending ? '...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// TAB 4: FEEDBACK & REPORTS
// ─────────────────────────────────────────────
function TabFeedback({ companyId, currentUser, userData }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ type: 'bug', title: '', body: '' });
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState(null);
  const [comment, setComment] = useState('');
  const isManager = ['owner', 'manager'].includes(userData?.role);
  const myName = userData?.displayName || userData?.name || currentUser?.email || 'Me';

  useEffect(() => {
    if (!companyId) return;
    const q = query(collection(db, 'feedback'), where('companyId', '==', companyId), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return unsub;
  }, [companyId]);

  const submit = async () => {
    if (!form.title.trim() || !form.body.trim()) return;
    setSubmitting(true);
    await addDoc(collection(db, 'feedback'), {
      companyId, ...form,
      authorUid: currentUser.uid,
      authorName: myName,
      status: 'open',
      comments: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setForm({ type: 'bug', title: '', body: '' });
    setShowForm(false);
    setSubmitting(false);
  };

  const changeStatus = async (id, status) => {
    await updateDoc(doc(db, 'feedback', id), { status, updatedAt: serverTimestamp() });
    if (selected?.id === id) setSelected(prev => ({ ...prev, status }));
  };

  const addComment = async () => {
    if (!comment.trim() || !selected) return;
    const newComment = { uid: currentUser.uid, name: myName, text: comment.trim(), createdAt: new Date().toISOString() };
    await updateDoc(doc(db, 'feedback', selected.id), {
      comments: arrayUnion(newComment),
      updatedAt: serverTimestamp(),
    });
    setComment('');
    setSelected(prev => ({ ...prev, comments: [...(prev.comments || []), newComment] }));
  };

  if (loading) return <div style={S.emptyState}>⏳ Loading...</div>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 380px' : '1fr', gap: '20px' }}>
      {/* List */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div style={{ fontSize: '14px', color: '#64748B' }}>{items.filter(i => i.status === 'open').length} open · {items.length} total</div>
          <button style={S.btn('primary')} onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancel' : '+ New Report'}</button>
        </div>

        {showForm && (
          <div style={{ ...S.card, marginBottom: '16px', background: '#FAFAFF', border: '1px solid #C7D2FE' }}>
            <select style={{ ...S.input, marginBottom: '10px' }} value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
              {Object.entries(FEEDBACK_TYPES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
            </select>
            <input style={{ ...S.input, marginBottom: '10px' }} placeholder="Title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            <textarea style={{ ...S.input, height: '80px', resize: 'vertical', marginBottom: '10px' }} placeholder="Describe the issue or feedback in detail..." value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} />
            <button style={{ ...S.btn('primary'), opacity: submitting ? 0.6 : 1 }} onClick={submit} disabled={submitting}>{submitting ? 'Submitting...' : 'Submit'}</button>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {items.length === 0 ? <div style={S.emptyState}>🐛 No feedback yet. Submit the first one!</div> : items.map(item => {
            const ft = FEEDBACK_TYPES[item.type] || FEEDBACK_TYPES.general;
            const fs = FEEDBACK_STATUS[item.status] || FEEDBACK_STATUS.open;
            return (
              <div key={item.id} onClick={() => setSelected(selected?.id === item.id ? null : item)}
                style={{ background: '#fff', border: `1.5px solid ${selected?.id === item.id ? '#4F46E5' : '#E2E8F0'}`, borderRadius: '12px', padding: '14px 16px', cursor: 'pointer', transition: 'border-color 0.15s' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <span style={S.badge(ft.color, ft.bg)}>{ft.icon} {ft.label}</span>
                  <span style={S.badge(fs.color, fs.bg)}>{fs.label}</span>
                  {(item.comments || []).length > 0 && <span style={{ fontSize: '12px', color: '#94A3B8' }}>💬 {item.comments.length}</span>}
                </div>
                <div style={{ fontWeight: '600', fontSize: '14px', color: '#1E293B', marginBottom: '2px' }}>{item.title}</div>
                <div style={{ fontSize: '12px', color: '#94A3B8' }}>{item.authorName} · {item.createdAt ? timeAgo(item.createdAt) : ''}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detail Panel */}
      {selected && (
        <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: '16px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px', maxHeight: '70vh', overflow: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={S.badge(FEEDBACK_TYPES[selected.type]?.color, FEEDBACK_TYPES[selected.type]?.bg)}>{FEEDBACK_TYPES[selected.type]?.icon} {FEEDBACK_TYPES[selected.type]?.label}</span>
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', fontSize: '18px' }} onClick={() => setSelected(null)}>✕</button>
          </div>
          <div style={{ fontWeight: '700', fontSize: '16px', color: '#1E293B' }}>{selected.title}</div>
          <div style={{ fontSize: '14px', color: '#475569', lineHeight: '1.6' }}>{selected.body}</div>
          <div style={{ fontSize: '12px', color: '#94A3B8' }}>By {selected.authorName} · {selected.createdAt ? timeAgo(selected.createdAt) : ''}</div>

          {isManager && (
            <div style={{ display: 'flex', gap: '8px' }}>
              {['open', 'reviewing', 'resolved'].map(s => (
                <button key={s} style={{ ...S.btn(selected.status === s ? 'primary' : 'ghost'), padding: '6px 12px', fontSize: '12px', opacity: selected.status === s ? 1 : 0.7 }}
                  onClick={() => changeStatus(selected.id, s)}>
                  {FEEDBACK_STATUS[s].label}
                </button>
              ))}
            </div>
          )}

          <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: '12px' }}>
            <div style={{ fontWeight: '600', fontSize: '13px', color: '#475569', marginBottom: '10px' }}>Comments ({(selected.comments || []).length})</div>
            {(selected.comments || []).map((c, i) => (
              <div key={i} style={{ marginBottom: '10px' }}>
                <div style={{ fontSize: '12px', fontWeight: '600', color: '#475569' }}>{c.name}</div>
                <div style={{ fontSize: '13px', color: '#1E293B', lineHeight: '1.5' }}>{c.text}</div>
                <div style={{ fontSize: '11px', color: '#94A3B8' }}>{timeAgo(c.createdAt)}</div>
              </div>
            ))}
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <input style={{ ...S.input, flex: 1 }} placeholder="Add a comment..." value={comment} onChange={e => setComment(e.target.value)} onKeyDown={e => e.key === 'Enter' && addComment()} />
              <button style={S.btn('primary')} onClick={addComment}>Send</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// TAB 5: ANNOUNCEMENTS
// ─────────────────────────────────────────────
function TabAnnouncements({ companyId, currentUser, userData }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', body: '', isPinned: false });
  const [submitting, setSubmitting] = useState(false);
  const [members, setMembers] = useState([]);
  const isOwner = userData?.role === 'owner';
  const myName = userData?.displayName || userData?.name || currentUser?.email || 'Me';

  useEffect(() => {
    if (!companyId) return;
    const q = query(collection(db, 'announcements'), where('companyId', '==', companyId), orderBy('createdAt', 'desc'));
    return onSnapshot(q, snap => {
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    const q = query(collection(db, 'users'), where('companyId', '==', companyId));
    return onSnapshot(q, snap => setMembers(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, [companyId]);

  // Mark as read
  useEffect(() => {
    if (!currentUser?.uid || items.length === 0) return;
    items.forEach(item => {
      if (!(item.readBy || []).includes(currentUser.uid)) {
        updateDoc(doc(db, 'announcements', item.id), { readBy: arrayUnion(currentUser.uid) });
      }
    });
  }, [items, currentUser?.uid]);

  const post = async () => {
    if (!form.title.trim() || !form.body.trim()) return;
    setSubmitting(true);
    await addDoc(collection(db, 'announcements'), {
      companyId, ...form,
      authorUid: currentUser.uid,
      authorName: myName,
      readBy: [currentUser.uid],
      createdAt: serverTimestamp(),
    });
    setForm({ title: '', body: '', isPinned: false });
    setShowForm(false);
    setSubmitting(false);
  };

  const togglePin = async (id, current) => {
    await updateDoc(doc(db, 'announcements', id), { isPinned: !current });
  };

  const sorted = [...items].sort((a, b) => (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0));

  if (loading) return <div style={S.emptyState}>⏳ Loading...</div>;

  return (
    <div>
      {isOwner && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
          <button style={S.btn('primary')} onClick={() => setShowForm(!showForm)}>{showForm ? 'Cancel' : '+ New Announcement'}</button>
        </div>
      )}

      {showForm && isOwner && (
        <div style={{ ...S.card, marginBottom: '16px', background: '#FAFAFF', border: '1px solid #C7D2FE' }}>
          <input style={{ ...S.input, marginBottom: '10px' }} placeholder="Announcement title..." value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          <textarea style={{ ...S.input, height: '100px', resize: 'vertical', marginBottom: '10px' }} placeholder="Write your announcement..." value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#475569', cursor: 'pointer' }}>
              <input type="checkbox" checked={form.isPinned} onChange={e => setForm(f => ({ ...f, isPinned: e.target.checked }))} />
              📌 Pin this announcement
            </label>
            <button style={{ ...S.btn('primary'), opacity: submitting ? 0.6 : 1 }} onClick={post} disabled={submitting}>{submitting ? 'Posting...' : 'Post'}</button>
          </div>
        </div>
      )}

      {sorted.length === 0 ? (
        <div style={S.emptyState}>📣 No announcements yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {sorted.map(item => {
            const readCount = (item.readBy || []).length;
            const isRead = (item.readBy || []).includes(currentUser?.uid);
            return (
              <div key={item.id} style={{ background: '#fff', border: `1.5px solid ${item.isPinned ? '#4F46E5' : '#E2E8F0'}`, borderRadius: '12px', padding: '18px 20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      {item.isPinned && <span style={{ fontSize: '14px' }}>📌</span>}
                      {!isRead && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4F46E5', display: 'inline-block' }} />}
                      <span style={{ fontWeight: '700', fontSize: '15px', color: '#1E293B' }}>{item.title}</span>
                    </div>
                    <div style={{ fontSize: '14px', color: '#475569', lineHeight: '1.6', marginBottom: '10px' }}>{item.body}</div>
                    <div style={{ fontSize: '12px', color: '#94A3B8', display: 'flex', gap: '16px' }}>
                      <span>{item.authorName} · {item.createdAt ? timeAgo(item.createdAt) : ''}</span>
                      <span>👁 Read by {readCount}/{members.length}</span>
                    </div>
                  </div>
                  {isOwner && (
                    <button style={{ ...S.btn('ghost'), fontSize: '12px', padding: '6px 12px', whiteSpace: 'nowrap' }} onClick={() => togglePin(item.id, item.isPinned)}>
                      {item.isPinned ? 'Unpin' : '📌 Pin'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// TAB 6: ACTIVITY LOG
// ─────────────────────────────────────────────
const ACTION_LABELS = {
  ROLE_CHANGED:    { label: 'Role Changed',    icon: '🔄', color: '#7C3AED' },
  MEMBER_REMOVED:  { label: 'Member Removed',  icon: '🚫', color: '#DC2626' },
  SYNC_QUICK:      { label: 'Quick Sync',       icon: '⚡', color: '#0369A1' },
  SYNC_FULL:       { label: 'Full Sync',        icon: '🔄', color: '#0369A1' },
  MESSAGE_SENT:    { label: 'Message Sent',     icon: '💬', color: '#059669' },
  BROADCAST_SENT:  { label: 'Broadcast Sent',   icon: '📣', color: '#059669' },
  FEEDBACK_POSTED: { label: 'Feedback Posted',  icon: '📋', color: '#D97706' },
};

function TabActivityLog({ companyId, currentUser, userData }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState([]);
  const [filterUser, setFilterUser] = useState('all');
  const [filterAction, setFilterAction] = useState('all');
  const isManager = ['owner', 'manager'].includes(userData?.role);

  useEffect(() => {
    if (!companyId) return;
    const q = query(collection(db, 'activityLogs'), where('companyId', '==', companyId), orderBy('createdAt', 'desc'), limit(200));
    return onSnapshot(q, snap => {
      setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    const q = query(collection(db, 'users'), where('companyId', '==', companyId));
    return onSnapshot(q, snap => setMembers(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, [companyId]);

  if (!isManager) return (
    <div style={S.emptyState}>
      <div style={{ fontSize: '48px', marginBottom: '12px' }}>🔒</div>
      <div style={{ fontWeight: '600', color: '#475569' }}>Manager access required</div>
    </div>
  );

  const filtered = logs.filter(l => {
    if (filterUser !== 'all' && l.uid !== filterUser) return false;
    if (filterAction !== 'all' && l.action !== filterAction) return false;
    return true;
  });

  if (loading) return <div style={S.emptyState}>⏳ Loading activity log...</div>;

  return (
    <div>
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <select style={{ ...S.input, width: 'auto' }} value={filterUser} onChange={e => setFilterUser(e.target.value)}>
          <option value="all">All Members</option>
          {members.map(m => <option key={m.id} value={m.id}>{m.displayName || m.name || m.email}</option>)}
        </select>
        <select style={{ ...S.input, width: 'auto' }} value={filterAction} onChange={e => setFilterAction(e.target.value)}>
          <option value="all">All Actions</option>
          {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
        </select>
        <div style={{ marginLeft: 'auto', fontSize: '13px', color: '#64748B', alignSelf: 'center' }}>{filtered.length} events</div>
      </div>

      {filtered.length === 0 ? (
        <div style={S.emptyState}>📋 No activity logged yet.</div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: '16px', overflow: 'hidden' }}>
          {filtered.map((log, i) => {
            const action = ACTION_LABELS[log.action] || { label: log.action, icon: '•', color: '#64748B' };
            return (
              <div key={log.id} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '12px 18px', borderBottom: i < filtered.length - 1 ? '1px solid #F1F5F9' : 'none', background: i % 2 === 0 ? '#fff' : '#FAFAFA' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: `${action.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', flexShrink: 0 }}>
                  {action.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', color: '#1E293B' }}>
                    <span style={{ fontWeight: '600' }}>{log.userName}</span>
                    {' · '}
                    <span style={{ color: action.color, fontWeight: '600' }}>{action.label}</span>
                    {log.detail && <span style={{ color: '#64748B' }}> — {log.detail}</span>}
                  </div>
                </div>
                <div style={{ fontSize: '12px', color: '#94A3B8', flexShrink: 0 }}>
                  {log.createdAt ? timeAgo(log.createdAt) : ''}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// TAB 7: MAINTENANCE MODE
// ─────────────────────────────────────────────
function TabMaintenance({ companyId, currentUser, userData }) {
  const [status, setStatus] = useState(null); // Firestore 상태
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  // 점검 상태 실시간 감지
  useEffect(() => {
    if (!companyId) return;
    const ref = doc(db, 'maintenanceMode', companyId);
    return onSnapshot(ref, snap => {
      if (snap.exists()) {
        const d = snap.data();
        setStatus(d);
        if (!d.active) setMessage(d.message || '');
      } else {
        setStatus({ active: false, message: '' });
      }
    });
  }, [companyId]);

  // owner만 접근 가능
  if (userData?.role !== 'owner') {
    return (
      <div style={S.emptyState}>
        <div style={{ fontSize: '48px', marginBottom: '12px' }}>🔒</div>
        <div style={{ fontWeight: '600', color: '#475569' }}>Owner access only</div>
      </div>
    );
  }

  const isActive = status?.active === true;

  const startMaintenance = async () => {
    if (!message.trim()) { alert('Please enter a maintenance message first.'); return; }
    if (!window.confirm('Start maintenance mode? All other users will be blocked immediately.')) return;
    setSaving(true);
    await setDoc(doc(db, 'maintenanceMode', companyId), {
      active: true,
      message: message.trim(),
      startedAt: serverTimestamp(),
      startedBy: currentUser.uid,
      startedByName: userData?.displayName || userData?.name || currentUser.email,
    });
    setSaving(false);
  };

  const endMaintenance = async () => {
    if (!window.confirm('End maintenance mode? All users will regain access.')) return;
    setSaving(true);
    await setDoc(doc(db, 'maintenanceMode', companyId), {
      active: false,
      message: status?.message || '',
      endedAt: serverTimestamp(),
      startedBy: null,
    });
    setSaving(false);
  };

  return (
    <div style={{ maxWidth: '640px' }}>
      {/* Status Banner */}
      <div style={{
        padding: '20px 24px',
        borderRadius: '16px',
        marginBottom: '28px',
        background: isActive
          ? 'linear-gradient(135deg, #FEF2F2, #FFF7ED)'
          : 'linear-gradient(135deg, #F0FDF4, #ECFDF5)',
        border: `2px solid ${isActive ? '#FCA5A5' : '#6EE7B7'}`,
        display: 'flex', alignItems: 'center', gap: '16px',
      }}>
        <div style={{
          width: 52, height: 52, borderRadius: '14px', flexShrink: 0,
          background: isActive ? 'linear-gradient(135deg, #DC2626, #EF4444)' : 'linear-gradient(135deg, #059669, #10B981)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px',
          boxShadow: `0 4px 12px ${isActive ? 'rgba(220,38,38,0.3)' : 'rgba(5,150,105,0.3)'}`,
        }}>
          {isActive ? '🔴' : '🟢'}
        </div>
        <div>
          <div style={{ fontWeight: '800', fontSize: '18px', color: isActive ? '#DC2626' : '#059669', marginBottom: '2px' }}>
            {isActive ? 'Maintenance Mode Active' : 'System Operational'}
          </div>
          <div style={{ fontSize: '13px', color: isActive ? '#EF4444' : '#059669', opacity: 0.8 }}>
            {isActive
              ? `Started by ${status?.startedByName || 'you'} · All other users are blocked`
              : 'All users have normal access'}
          </div>
        </div>
      </div>

      {/* Message Input */}
      <div style={{ marginBottom: '20px' }}>
        <label style={{ display: 'block', fontSize: '13px', fontWeight: '700', color: '#475569', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Maintenance Message
          <span style={{ fontWeight: '400', textTransform: 'none', marginLeft: '8px', color: '#94A3B8' }}>
            (shown to blocked users)
          </span>
        </label>
        <textarea
          style={{ ...S.input, height: '110px', resize: 'vertical', fontSize: '14px', lineHeight: '1.6' }}
          placeholder={`e.g. We're performing scheduled maintenance to improve system performance.\nExpected completion: 30 minutes.`}
          value={message}
          onChange={e => setMessage(e.target.value)}
          disabled={isActive}
        />
        {isActive && (
          <div style={{ fontSize: '12px', color: '#94A3B8', marginTop: '6px' }}>
            End maintenance to edit the message.
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: '12px' }}>
        {!isActive ? (
          <button
            onClick={startMaintenance}
            disabled={saving || !message.trim()}
            style={{
              padding: '12px 28px', borderRadius: '12px', border: 'none', cursor: saving || !message.trim() ? 'not-allowed' : 'pointer',
              background: saving || !message.trim() ? '#E2E8F0' : 'linear-gradient(135deg, #DC2626, #EF4444)',
              color: saving || !message.trim() ? '#94A3B8' : '#fff',
              fontSize: '14px', fontWeight: '700',
              boxShadow: !saving && message.trim() ? '0 4px 12px rgba(220,38,38,0.3)' : 'none',
              transition: 'all 0.2s',
            }}
          >
            {saving ? '⏳ Starting...' : '🔴 Start Maintenance'}
          </button>
        ) : (
          <button
            onClick={endMaintenance}
            disabled={saving}
            style={{
              padding: '12px 28px', borderRadius: '12px', border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
              background: saving ? '#E2E8F0' : 'linear-gradient(135deg, #059669, #10B981)',
              color: saving ? '#94A3B8' : '#fff',
              fontSize: '14px', fontWeight: '700',
              boxShadow: !saving ? '0 4px 12px rgba(5,150,105,0.3)' : 'none',
              transition: 'all 0.2s',
            }}
          >
            {saving ? '⏳ Ending...' : '🟢 End Maintenance'}
          </button>
        )}
      </div>

      {/* Info Box */}
      <div style={{ marginTop: '32px', padding: '16px 20px', background: '#F8FAFC', borderRadius: '12px', border: '1px solid #E2E8F0' }}>
        <div style={{ fontWeight: '600', fontSize: '13px', color: '#475569', marginBottom: '10px' }}>How it works</div>
        <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '13px', color: '#64748B', lineHeight: '1.8' }}>
          <li>When activated, <strong>only you</strong> can access the system</li>
          <li>All other users see the maintenance screen with your message</li>
          <li>Takes effect <strong>instantly</strong> — even users already logged in get blocked</li>
          <li>You remain fully operational during maintenance</li>
          <li>Click <strong>"End Maintenance"</strong> to restore access for everyone</li>
        </ul>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────
export default function MemberManagement() {
  const { user, userData, companyId } = useUser();
  const [activeTab, setActiveTab] = useState(0);

  if (!user || !companyId) {
    return (
      <div style={{ ...S.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={S.emptyState}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>🔒</div>
          <div style={{ fontWeight: '600', color: '#475569' }}>Please log in to access team management.</div>
        </div>
      </div>
    );
  }

  const tabProps = { companyId, currentUser: user, userData };

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.pageHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: 48, height: 48, borderRadius: '12px', background: '#EEF2FF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px' }}>👥</div>
          <div>
            <h1 style={S.pageTitle}>Team Management</h1>
            <p style={S.pageSubtitle}>Manage your team members, messages, and company activity</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={S.tabBar}>
        {TABS.map((tab, i) => {
          // Maintenance 탭은 owner만 표시
          if (i === 6 && userData?.role !== 'owner') return null;
          return <button key={tab} style={S.tab(activeTab === i)} onClick={() => setActiveTab(i)}>{tab}</button>;
        })}
      </div>

      {/* Content */}
      {activeTab === 0 && <TabMembers {...tabProps} />}
      {activeTab === 1 && <TabInviteCodes {...tabProps} />}
      {activeTab === 2 && <TabMessages {...tabProps} />}
      {activeTab === 3 && <TabFeedback {...tabProps} />}
      {activeTab === 4 && <TabAnnouncements {...tabProps} />}
      {activeTab === 5 && <TabActivityLog {...tabProps} />}
      {activeTab === 6 && userData?.role === 'owner' && <TabMaintenance {...tabProps} />}
    </div>
  );
}
