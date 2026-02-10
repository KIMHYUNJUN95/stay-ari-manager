import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, query, where, onSnapshot, orderBy } from "firebase/firestore";
import { db } from '../firebase';
import { useUser } from '../contexts/UserContext';

// -----------------------------------------------------------------------------
// [CONSTANTS]
// -----------------------------------------------------------------------------
const FIREBASE_FUNCTION_URL = "https://us-central1-my-booking-app-3f0e7.cloudfunctions.net";

const getCountryFlag = (country) => {
  const flags = {
    'JP': '🇯🇵', 'KR': '🇰🇷', 'CN': '🇨🇳', 'TW': '🇹🇼', 'HK': '🇭🇰',
    'US': '🇺🇸', 'GB': '🇬🇧', 'AU': '🇦🇺', 'CA': '🇨🇦', 'SG': '🇸🇬',
    'Japan': '🇯🇵', 'Korea': '🇰🇷', 'China': '🇨🇳', 'Taiwan': '🇹🇼',
    'USA': '🇺🇸', 'United States': '🇺🇸', 'UK': '🇬🇧', 'Australia': '🇦🇺',
  };
  return flags[country] || '🌍';
};

const formatDateTime = (dateStr) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

// -----------------------------------------------------------------------------
// [COMPONENT] MessagesDashboard
// -----------------------------------------------------------------------------
const MessagesDashboard = () => {
  const { companyId, userData } = useUser();
  const [loading, setLoading] = useState(true);
  const [messageThreads, setMessageThreads] = useState([]);
  const [selectedThread, setSelectedThread] = useState(null);
  const [selectedMessages, setSelectedMessages] = useState([]);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all'); // all, unread, today
  const [refreshing, setRefreshing] = useState(false);

  // Firestore 실시간 리스너 - booking_messages 컬렉션에서 읽기
  useEffect(() => {
    if (!companyId) {
      console.warn('⚠️ No companyId for MessagesDashboard');
      setLoading(false);
      return;
    }

    setLoading(true);

    const q = query(
      collection(db, "booking_messages"),
      where("companyId", "==", companyId)
    );

    // 실시간 리스너 설정
    const unsubscribe = onSnapshot(q,
      (snapshot) => {
        const threads = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));

        // Sort by last message time (most recent first)
        threads.sort((a, b) => {
          const timeA = a.lastMessageTime ? new Date(a.lastMessageTime) : new Date(0);
          const timeB = b.lastMessageTime ? new Date(b.lastMessageTime) : new Date(0);
          return timeB - timeA;
        });

        setMessageThreads(threads);
        setLoading(false);
        console.log(`📬 메시지 로드 완료: ${threads.length}개 스레드`);
      },
      (error) => {
        console.error("Failed to load messages:", error);
        setLoading(false);
      }
    );

    // Cleanup listener on unmount
    return () => unsubscribe();
  }, [companyId]);

  // 수동 새로고침 (백엔드 동기화 트리거)
  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      // 백엔드에 동기화 요청 (새로운 API 엔드포인트 필요)
      const response = await fetch(`${FIREBASE_FUNCTION_URL}/triggerMessageSync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId })
      });

      if (response.ok) {
        console.log('✅ 메시지 동기화 트리거 완료');
      } else {
        console.warn('⚠️ 메시지 동기화 트리거 실패');
      }
    } catch (error) {
      console.error("Failed to trigger sync:", error);
    } finally {
      setRefreshing(false);
    }
  };

  const handleSelectThread = async (thread) => {
    setSelectedThread(thread);
    setSelectedMessages(thread.messages || []);
  };

  const handleSendReply = async () => {
    if (!replyText.trim() || !selectedThread) return;

    setSendingReply(true);
    try {
      const response = await fetch(`${FIREBASE_FUNCTION_URL}/sendBookingMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: selectedThread.bookingId,
          message: replyText,
          senderName: userData?.name || 'Staff'
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();

      if (result.success) {
        // Add message to UI immediately
        const newMessage = {
          text: replyText,
          from: 'host',
          time: new Date().toISOString(),
          senderName: userData?.name || 'Staff'
        };

        setSelectedMessages([...selectedMessages, newMessage]);
        setReplyText('');

        // Trigger sync after a delay to get the sent message
        setTimeout(() => {
          handleManualRefresh();
        }, 2000);
      } else {
        throw new Error(result.error || 'Failed to send message');
      }
    } catch (error) {
      console.error("Failed to send message:", error);
      alert('Failed to send message. Please try again.');
    } finally {
      setSendingReply(false);
    }
  };

  // Filter and search
  const filteredThreads = useMemo(() => {
    let filtered = messageThreads;

    // Filter by status
    if (filterStatus === 'unread') {
      filtered = filtered.filter(t => t.hasUnread);
    } else if (filterStatus === 'today') {
      const today = new Date().toISOString().split('T')[0];
      filtered = filtered.filter(t =>
        t.lastMessageTime && t.lastMessageTime.startsWith(today)
      );
    }

    // Search
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(t =>
        t.guestName.toLowerCase().includes(term) ||
        t.building.toLowerCase().includes(term) ||
        t.platform.toLowerCase().includes(term) ||
        t.bookingId.toLowerCase().includes(term)
      );
    }

    return filtered;
  }, [messageThreads, filterStatus, searchTerm]);

  // Stats
  const stats = useMemo(() => {
    const total = messageThreads.length;
    const unread = messageThreads.filter(t => t.hasUnread).length;
    const today = messageThreads.filter(t => {
      const todayStr = new Date().toISOString().split('T')[0];
      return t.lastMessageTime && t.lastMessageTime.startsWith(todayStr);
    }).length;

    return { total, unread, today };
  }, [messageThreads]);

  // Styles (Haru Studio Enterprise Theme)
  const styles = {
    container: {
      padding: '32px',
      background: '#FFFFFF',
      minHeight: '100vh',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '32px',
      flexWrap: 'wrap',
      gap: '16px'
    },
    titleGroup: { display: 'flex', alignItems: 'center', gap: '12px' },
    icon: {
      fontSize: '28px',
      background: '#EEF2FF',
      width: '48px',
      height: '48px',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: '12px',
      color: '#4F46E5'
    },
    title: { fontSize: '24px', fontWeight: '700', color: '#0F172A', margin: 0, letterSpacing: '-0.5px' },
    subtitle: { fontSize: '14px', color: '#64748B', marginTop: '4px', fontWeight: '500' },

    // KPI Cards
    kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '32px' },
    kpiCard: { background: '#F8FAFC', padding: '20px', borderRadius: '16px', border: '1px solid #E2E8F0' },
    kpiLabel: { fontSize: '12px', fontWeight: '600', color: '#64748B', textTransform: 'uppercase', marginBottom: '8px' },
    kpiValue: { fontSize: '24px', fontWeight: '800', color: '#1E293B' },

    // Controls
    controls: { display: 'flex', flexWrap: 'wrap', gap: '16px', marginBottom: '24px', alignItems: 'center' },
    tabGroup: { display: 'flex', background: '#F1F5F9', padding: '4px', borderRadius: '12px', gap: '2px' },
    tab: (active) => ({
      padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: '600',
      border: 'none', cursor: 'pointer', background: active ? '#FFFFFF' : 'transparent',
      color: active ? '#4F46E5' : '#64748B', boxShadow: active ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
      transition: 'all 0.2s'
    }),
    searchInput: {
      padding: '10px 16px', borderRadius: '10px', border: '1px solid #CBD5E1',
      fontSize: '14px', outline: 'none', minWidth: '240px', flex: 1
    },
    refreshBtn: {
      padding: '10px 20px', borderRadius: '10px', border: 'none',
      background: '#4F46E5', color: 'white', fontSize: '14px', fontWeight: '600',
      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px'
    },

    // Layout
    mainLayout: { display: 'grid', gridTemplateColumns: '400px 1fr', gap: '24px', height: 'calc(100vh - 300px)' },

    // Thread List
    threadList: {
      background: '#F8FAFC',
      borderRadius: '16px',
      border: '1px solid #E2E8F0',
      overflow: 'auto',
      maxHeight: '100%'
    },
    threadItem: (selected) => ({
      padding: '16px',
      borderBottom: '1px solid #E2E8F0',
      cursor: 'pointer',
      background: selected ? '#FFFFFF' : 'transparent',
      transition: 'all 0.2s',
      ':hover': { background: '#FFFFFF' }
    }),
    unreadBadge: {
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      background: '#EF4444',
      display: 'inline-block',
      marginRight: '8px'
    },

    // Message View
    messageView: {
      background: '#FFFFFF',
      borderRadius: '16px',
      border: '1px solid #E2E8F0',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    },
    messageHeader: {
      padding: '20px',
      borderBottom: '1px solid #E2E8F0',
      background: '#F8FAFC'
    },
    messagesContainer: {
      flex: 1,
      overflow: 'auto',
      padding: '20px',
      display: 'flex',
      flexDirection: 'column',
      gap: '16px'
    },
    messageBubble: (from) => ({
      maxWidth: '70%',
      padding: '12px 16px',
      borderRadius: '12px',
      alignSelf: from === 'guest' ? 'flex-start' : 'flex-end',
      background: from === 'guest' ? '#F1F5F9' : '#4F46E5',
      color: from === 'guest' ? '#1E293B' : '#FFFFFF'
    }),
    messageTime: {
      fontSize: '11px',
      color: '#94A3B8',
      marginTop: '4px'
    },
    replyBox: {
      padding: '20px',
      borderTop: '1px solid #E2E8F0',
      display: 'flex',
      gap: '12px'
    },
    replyInput: {
      flex: 1,
      padding: '12px 16px',
      borderRadius: '10px',
      border: '1px solid #CBD5E1',
      fontSize: '14px',
      outline: 'none',
      resize: 'none',
      fontFamily: 'inherit'
    },
    sendBtn: {
      padding: '12px 24px',
      borderRadius: '10px',
      border: 'none',
      background: '#4F46E5',
      color: 'white',
      fontSize: '14px',
      fontWeight: '600',
      cursor: 'pointer',
      height: 'fit-content'
    },

    emptyState: {
      textAlign: 'center',
      padding: '60px 20px',
      color: '#64748B'
    }
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.titleGroup}>
          <div style={styles.icon}>💬</div>
          <div>
            <h1 style={styles.title}>Guest Messages</h1>
            <p style={styles.subtitle}>Manage Airbnb, Booking.com & OTA communications</p>
          </div>
        </div>
      </div>

      {/* KPI Section */}
      <div style={styles.kpiGrid}>
        <div style={styles.kpiCard}>
          <div style={styles.kpiLabel}>Total Conversations</div>
          <div style={styles.kpiValue}>{stats.total}</div>
        </div>
        <div style={styles.kpiCard}>
          <div style={styles.kpiLabel}>Unread Messages</div>
          <div style={{ ...styles.kpiValue, color: '#EF4444' }}>{stats.unread}</div>
        </div>
        <div style={styles.kpiCard}>
          <div style={styles.kpiLabel}>Today's Messages</div>
          <div style={{ ...styles.kpiValue, color: '#10B981' }}>{stats.today}</div>
        </div>
      </div>

      {/* Controls */}
      <div style={styles.controls}>
        <div style={styles.tabGroup}>
          <button style={styles.tab(filterStatus === 'all')} onClick={() => setFilterStatus('all')}>All</button>
          <button style={styles.tab(filterStatus === 'unread')} onClick={() => setFilterStatus('unread')}>Unread</button>
          <button style={styles.tab(filterStatus === 'today')} onClick={() => setFilterStatus('today')}>Today</button>
        </div>
        <input
          style={styles.searchInput}
          placeholder="Search by guest name, building, or booking ID..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <button
          style={styles.refreshBtn}
          onClick={handleManualRefresh}
          disabled={refreshing}
        >
          {refreshing ? '⏳ Syncing...' : '🔄 Refresh'}
        </button>
      </div>

      {/* Main Layout */}
      {loading ? (
        <div style={{ ...styles.emptyState, padding: '100px' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⏳</div>
          Loading messages...
        </div>
      ) : filteredThreads.length === 0 ? (
        <div style={styles.emptyState}>
          <div style={{ fontSize: '64px', marginBottom: '16px' }}>📭</div>
          <div style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px' }}>No Messages</div>
          <div style={{ fontSize: '14px' }}>
            {messageThreads.length === 0
              ? 'No OTA bookings with messages found.'
              : 'No messages match your filter criteria.'}
          </div>
        </div>
      ) : (
        <div style={styles.mainLayout}>
          {/* Thread List */}
          <div style={styles.threadList}>
            {filteredThreads.map((thread, idx) => (
              <div
                key={idx}
                style={{
                  ...styles.threadItem(selectedThread?.bookingId === thread.bookingId),
                  ...(selectedThread?.bookingId === thread.bookingId && { background: '#FFFFFF' })
                }}
                onClick={() => handleSelectThread(thread)}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '8px' }}>
                  {thread.hasUnread && <span style={styles.unreadBadge}></span>}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: '600', fontSize: '15px', color: '#1E293B', marginBottom: '4px' }}>
                      {thread.guestName}
                    </div>
                    <div style={{ fontSize: '12px', color: '#64748B', marginBottom: '4px' }}>
                      {getCountryFlag(thread.guestCountry)} {thread.building} {thread.room} • {thread.platform}
                    </div>
                    <div style={{ fontSize: '13px', color: '#334155', marginTop: '8px', lineHeight: '1.4' }}>
                      {thread.lastMessage?.substring(0, 60)}{thread.lastMessage?.length > 60 ? '...' : ''}
                    </div>
                    <div style={{ fontSize: '11px', color: '#94A3B8', marginTop: '6px' }}>
                      {formatDateTime(thread.lastMessageTime)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Message View */}
          <div style={styles.messageView}>
            {!selectedThread ? (
              <div style={{ ...styles.emptyState, margin: 'auto' }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>👈</div>
                <div style={{ fontSize: '16px', fontWeight: '600' }}>Select a conversation</div>
                <div style={{ fontSize: '14px', marginTop: '8px' }}>Choose a guest from the list to view messages</div>
              </div>
            ) : (
              <>
                {/* Message Header */}
                <div style={styles.messageHeader}>
                  <div style={{ fontSize: '18px', fontWeight: '700', color: '#1E293B', marginBottom: '8px' }}>
                    {selectedThread.guestName}
                  </div>
                  <div style={{ fontSize: '13px', color: '#64748B' }}>
                    {getCountryFlag(selectedThread.guestCountry)} {selectedThread.building} {selectedThread.room}
                  </div>
                  <div style={{ fontSize: '12px', color: '#94A3B8', marginTop: '4px' }}>
                    {selectedThread.arrival} ~ {selectedThread.departure} • Booking ID: {selectedThread.bookingId}
                  </div>
                </div>

                {/* Messages */}
                <div style={styles.messagesContainer}>
                  {selectedMessages.length === 0 ? (
                    <div style={{ textAlign: 'center', color: '#94A3B8', margin: 'auto' }}>
                      No messages in this conversation
                    </div>
                  ) : (
                    selectedMessages.map((msg, idx) => (
                      <div key={idx} style={styles.messageBubble(msg.from)}>
                        <div style={{ fontSize: '14px', lineHeight: '1.5' }}>{msg.text}</div>
                        <div style={styles.messageTime}>
                          {msg.from === 'host' && msg.senderName && `${msg.senderName} • `}
                          {formatDateTime(msg.time)}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Reply Box */}
                <div style={styles.replyBox}>
                  <textarea
                    style={styles.replyInput}
                    placeholder="Type your message..."
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    rows={3}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && e.ctrlKey && !sendingReply) {
                        handleSendReply();
                      }
                    }}
                  />
                  <button
                    style={styles.sendBtn}
                    onClick={handleSendReply}
                    disabled={sendingReply || !replyText.trim()}
                  >
                    {sendingReply ? 'Sending...' : 'Send'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MessagesDashboard;
