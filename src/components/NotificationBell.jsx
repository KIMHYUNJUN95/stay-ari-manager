import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../hooks/useNotifications';

/**
 * NotificationBell Component
 *
 * Displays notification bell icon with unread count badge
 * Dropdown menu shows recent notifications with glassmorphism design
 */
const NotificationBell = () => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const navigate = useNavigate();

  const {
    notifications,
    unreadCount,
    isLoading,
    lastSyncTime,
    markAsRead,
    markAllAsRead,
    clearAll,
    forceSync
  } = useNotifications();

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Format timestamp for display
  const formatTime = (timestamp) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    // Format actual date (Year/Month/Day)
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const actualDate = `${year}/${month}/${day}`;

    // Relative time + actual date
    let relativeTime = '';
    if (minutes < 1) relativeTime = 'Just now';
    else if (minutes < 60) relativeTime = `${minutes}m ago`;
    else if (hours < 24) relativeTime = `${hours}h ago`;
    else relativeTime = `${days}d ago`;

    return `${relativeTime} · ${actualDate}`;
  };

  // Format last sync time
  const formatLastSync = () => {
    if (!lastSyncTime) return 'Never';
    return formatTime(lastSyncTime);
  };

  // Handle notification click
  const handleNotificationClick = (notification) => {
    markAsRead(notification.id);
    if (notification.linkTo) {
      // Navigate with guest name as search parameter
      const searchParam = notification.guestName ? `?search=${encodeURIComponent(notification.guestName)}` : '';
      navigate(`${notification.linkTo}${searchParam}`);
      setIsOpen(false);
    }
  };

  // Handle mark all as read
  const handleMarkAllAsRead = () => {
    markAllAsRead();
  };

  // Handle clear all
  const handleClearAll = () => {
    if (window.confirm('Are you sure you want to clear all notifications?')) {
      clearAll();
    }
  };

  // Get notification icon
  const getNotificationIcon = (type) => {
    switch (type) {
      case 'NEW':
        return '✨';
      case 'CANCEL':
        return '❌';
      case 'MODIFY':
        return '📝';
      default:
        return '🔔';
    }
  };

  return (
    <div style={styles.container} ref={dropdownRef}>
      {/* Bell Icon Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={styles.bellButton}
        aria-label="Notifications"
      >
        {/* Bell Icon SVG */}
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ color: '#64748B' }}
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>

        {/* Unread Count Badge */}
        {unreadCount > 0 && (
          <div style={styles.badge}>
            <span style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</span>
          </div>
        )}

        {/* Loading Indicator */}
        {isLoading && (
          <div style={styles.loadingIndicator}>
            <div style={styles.loadingSpinner}></div>
          </div>
        )}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div style={styles.dropdown}>
          {/* Header */}
          <div style={styles.dropdownHeader}>
            <div>
              <h3 style={styles.dropdownTitle}>Notifications</h3>
              <p style={styles.dropdownSubtitle}>
                Last sync: {formatLastSync()}
              </p>
            </div>
            <button
              onClick={forceSync}
              style={styles.syncButton}
              disabled={isLoading}
              title="Force sync now"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  animation: isLoading ? 'spin 1s linear infinite' : 'none'
                }}
              >
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>
          </div>

          {/* Notifications List */}
          <div style={styles.notificationsList}>
            {notifications.length === 0 ? (
              <div style={styles.emptyState}>
                <div style={styles.emptyIcon}>🔔</div>
                <p style={styles.emptyText}>No notifications yet</p>
                <p style={styles.emptySubtext}>
                  You'll be notified of any reservation changes
                </p>
              </div>
            ) : (
              notifications.map((notification) => (
                <div
                  key={notification.id}
                  onClick={() => handleNotificationClick(notification)}
                  style={{
                    ...styles.notificationItem,
                    ...(notification.isRead ? styles.notificationItemRead : {})
                  }}
                >
                  <div style={styles.notificationIcon}>
                    {getNotificationIcon(notification.type)}
                  </div>
                  <div style={styles.notificationContent}>
                    <p style={styles.notificationMessage}>{notification.message}</p>
                    <p style={styles.notificationTime}>{formatTime(notification.timestamp)}</p>
                  </div>
                  {!notification.isRead && <div style={styles.unreadDot}></div>}
                </div>
              ))
            )}
          </div>

          {/* Footer Actions */}
          {notifications.length > 0 && (
            <div style={styles.dropdownFooter}>
              <button onClick={handleMarkAllAsRead} style={styles.footerButton}>
                Mark all read
              </button>
              <div style={styles.footerDivider}></div>
              <button onClick={handleClearAll} style={{ ...styles.footerButton, color: '#EF4444' }}>
                Clear all
              </button>
            </div>
          )}
        </div>
      )}

      {/* Add keyframe animation for spinner */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
};

// Styles
const styles = {
  container: {
    position: 'relative',
    display: 'inline-block'
  },

  bellButton: {
    position: 'relative',
    padding: '8px',
    background: 'transparent',
    border: 'none',
    borderRadius: '12px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease',
    outline: 'none'
  },

  badge: {
    position: 'absolute',
    top: '4px',
    right: '4px',
    background: 'linear-gradient(135deg, #EF4444 0%, #DC2626 100%)',
    borderRadius: '10px',
    minWidth: '18px',
    height: '18px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 5px',
    boxShadow: '0 2px 8px rgba(239, 68, 68, 0.4)'
  },

  badgeText: {
    color: '#FFFFFF',
    fontSize: '10px',
    fontWeight: '700',
    lineHeight: '1'
  },

  loadingIndicator: {
    position: 'absolute',
    bottom: '4px',
    right: '4px',
    width: '8px',
    height: '8px'
  },

  loadingSpinner: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: '#10B981',
    animation: 'pulse 1.5s ease-in-out infinite'
  },

  dropdown: {
    position: 'absolute',
    top: 'calc(100% + 8px)',
    right: '0',
    width: '380px',
    maxWidth: '90vw',
    background: 'rgba(255, 255, 255, 0.95)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    borderRadius: '16px',
    boxShadow: '0 10px 40px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08)',
    border: '1px solid rgba(226, 232, 240, 0.8)',
    overflow: 'hidden',
    zIndex: 1000,
    animation: 'slideDown 0.2s ease-out'
  },

  dropdownHeader: {
    padding: '16px 20px',
    borderBottom: '1px solid #E2E8F0',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: 'rgba(248, 250, 252, 0.5)'
  },

  dropdownTitle: {
    margin: '0',
    fontSize: '16px',
    fontWeight: '700',
    color: '#1E293B',
    letterSpacing: '-0.3px'
  },

  dropdownSubtitle: {
    margin: '4px 0 0 0',
    fontSize: '12px',
    color: '#64748B'
  },

  syncButton: {
    padding: '6px',
    background: 'transparent',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#64748B',
    transition: 'all 0.2s ease',
    outline: 'none'
  },

  notificationsList: {
    maxHeight: '400px',
    overflowY: 'auto',
    padding: '8px'
  },

  notificationItem: {
    display: 'flex',
    alignItems: 'flex-start',
    padding: '12px',
    borderRadius: '12px',
    marginBottom: '4px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    position: 'relative',
    background: '#FFFFFF'
  },

  notificationItemRead: {
    opacity: '0.6',
    background: 'rgba(248, 250, 252, 0.5)'
  },

  notificationIcon: {
    fontSize: '20px',
    marginRight: '12px',
    flexShrink: 0
  },

  notificationContent: {
    flex: '1',
    minWidth: '0'
  },

  notificationMessage: {
    margin: '0 0 4px 0',
    fontSize: '14px',
    fontWeight: '500',
    color: '#1E293B',
    lineHeight: '1.4',
    wordBreak: 'break-word'
  },

  notificationTime: {
    margin: '0',
    fontSize: '12px',
    color: '#94A3B8'
  },

  unreadDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: '#3B82F6',
    flexShrink: 0,
    marginLeft: '8px',
    marginTop: '6px'
  },

  emptyState: {
    padding: '40px 20px',
    textAlign: 'center'
  },

  emptyIcon: {
    fontSize: '48px',
    marginBottom: '12px',
    opacity: '0.5'
  },

  emptyText: {
    margin: '0 0 4px 0',
    fontSize: '14px',
    fontWeight: '600',
    color: '#64748B'
  },

  emptySubtext: {
    margin: '0',
    fontSize: '12px',
    color: '#94A3B8'
  },

  dropdownFooter: {
    display: 'flex',
    borderTop: '1px solid #E2E8F0',
    background: 'rgba(248, 250, 252, 0.5)'
  },

  footerButton: {
    flex: '1',
    padding: '12px',
    background: 'transparent',
    border: 'none',
    fontSize: '13px',
    fontWeight: '600',
    color: '#4F46E5',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    outline: 'none'
  },

  footerDivider: {
    width: '1px',
    background: '#E2E8F0'
  }
};

export default NotificationBell;
