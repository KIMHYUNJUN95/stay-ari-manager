// src/components/NewLayout.jsx
// iOS-style 모바일 네비게이션 - 하단 탭바 5개 + 더보기 시트

import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { signOut } from "firebase/auth";
import { auth } from '../firebase';
import { useUser } from '../contexts/UserContext';
import NotificationBell from './NotificationBell';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Capacitor } from '@capacitor/core';

// ─── 메뉴 데이터 ────────────────────────────────────────────────────────────────

// PC 사이드바용 (기존 유지)
const MENU_ITEMS = [
  { path: "/", label: "Dashboard", icon: "grid" },
  { path: "/performance", label: "Performance", icon: "chart" },
  { path: "/revenue", label: "Revenue", icon: "dollar" },
  { path: "/sales-log", label: "Revenue Analytics", icon: "book" },
  { path: "/daily-log", label: "Daily Log", icon: "chart" },
  { path: "/calendar", label: "Calendar", icon: "calendar" },
  { path: "/occupancy", label: "Occupancy", icon: "bed" },
  { path: "/occupancy-rate", label: "Occupancy Rate", icon: "trending" },
  { path: "/room-performance", label: "Room Performance", icon: "target" },
  { path: "/country", label: "Country Stats", icon: "globe" },
  { path: "/arrivals", label: "Arrivals/Departures", icon: "door" },
  { path: "/cleaning", label: "Cleaning Schedule", icon: "sparkle" },
  { path: "/room-links", label: "Room Links", icon: "link" },
  { path: "/customers", label: "Customer List", icon: "users" },
  { path: "/reviews", label: "Reviews & Ratings", icon: "star" },
  { path: "/team", label: "Team", icon: "users-cog" },
  { path: "/my-profile", label: "My Profile", icon: "user" },
];

// 모바일 하단 탭바 5개
const MOBILE_NAV_ITEMS = [
  { path: "/", label: "Home", icon: "grid" },
  { path: "/calendar", label: "Calendar", icon: "calendar" },
  { path: "/revenue", label: "Revenue", icon: "dollar" },
  { path: "MORE", label: "More", icon: "more" },
];

// 더보기 시트 메뉴 목록
const MORE_MENU_ITEMS = [
  { path: "/performance", label: "Bookings", icon: "chart" },
  { path: "/occupancy-rate", label: "Occ. Rate", icon: "trending" },
  { path: "/occupancy", label: "Occupancy", icon: "bed" },
  { path: "/sales-log", label: "Rev. Log", icon: "book" },
  { path: "/daily-log", label: "Daily Log", icon: "chart" },
  { path: "/arrivals", label: "Arrivals", icon: "door" },
  { path: "/cleaning", label: "Cleaning", icon: "sparkle" },
  { path: "/room-performance", label: "Room Perf.", icon: "target" },
  { path: "/country", label: "Countries", icon: "globe" },
  { path: "/customers", label: "Customers", icon: "users" },
  { path: "/room-links", label: "Room Links", icon: "link" },
  { path: "/reviews", label: "Reviews", icon: "star" },
  { path: "/price-history", label: "Prices", icon: "chart" },
  { path: "/team", label: "Team", icon: "users-cog" },
  { path: "/my-profile", label: "My Profile", icon: "user" },
];

// 모바일 헤더 타이틀 맵
const MOBILE_PAGE_TITLES = {
  '/': 'Home',
  '/calendar': 'Calendar',
  '/revenue': 'Revenue',
  '/performance': 'Bookings',
  '/occupancy-rate': 'Occupancy Rate',
  '/occupancy': 'Occupancy',
  '/sales-log': 'Revenue Log',
  '/daily-log': 'Daily Log',
  '/arrivals': 'Arrivals',
  '/cleaning': 'Cleaning',
  '/room-performance': 'Room Performance',
  '/country': 'Country Stats',
  '/customers': 'Customers',
  '/room-links': 'Room Links',
  '/reviews': 'Reviews & Ratings',
  '/price-history': 'Price History',
  '/team': 'Team',
  '/my-profile': 'My Profile',
};

// ─── SVG 아이콘 ─────────────────────────────────────────────────────────────────

const MenuIcon = ({ name, active, size = 22 }) => {
  const color = active ? '#007AFF' : '#8E8E93';
  const icons = {
    grid: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8">
        <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
    chart: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8">
        <path d="M21 21H4.6c-.56 0-.84 0-1.054-.109a1 1 0 0 1-.437-.437C3 20.24 3 19.96 3 19.4V3" />
        <path d="m7 14 4-4 4 4 6-6" />
      </svg>
    ),
    dollar: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8">
        <circle cx="12" cy="12" r="10" />
        <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
        <path d="M12 18V6" />
      </svg>
    ),
    book: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
    calendar: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
    bed: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8">
        <path d="M2 4v16" /><path d="M2 8h18a2 2 0 0 1 2 2v10" />
        <path d="M2 17h20" /><path d="M6 8v9" />
      </svg>
    ),
    trending: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
      </svg>
    ),
    target: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8">
        <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="2" />
      </svg>
    ),
    globe: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
    door: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8">
        <path d="M18 20V6a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v14" />
        <path d="M2 20h20" /><path d="M14 12v.01" />
      </svg>
    ),
    sparkle: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8">
        <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      </svg>
    ),
    link: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    ),
    users: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    'users-cog': (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <circle cx="19" cy="11" r="2" />
        <path d="M19 8v1m0 4v1m-2.5-3.5.866.5m3.268 1.5.866.5M16.5 12.5l.866-.5m3.268-1.5.866-.5" />
      </svg>
    ),
    user: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8">
        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
    cpu: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8">
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <rect x="9" y="9" width="6" height="6" />
        <path d="M9 1v3" /><path d="M15 1v3" /><path d="M9 20v3" /><path d="M15 20v3" />
        <path d="M20 9h3" /><path d="M20 14h3" /><path d="M1 9h3" /><path d="M1 14h3" />
      </svg>
    ),
    message: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
    more: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <circle cx="6.5" cy="7" r="2" fill={color} />
        <circle cx="17.5" cy="7" r="2" fill={color} />
        <circle cx="6.5" cy="17" r="2" fill={color} />
        <circle cx="17.5" cy="17" r="2" fill={color} />
      </svg>
    ),
    settings: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
    star: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
    ),
  };
  return icons[name] || icons.grid;
};

// ─── 더보기 Bottom Sheet ─────────────────────────────────────────────────────────

const MoreBottomSheet = ({ open, onClose, onNavigate, onSync, syncing, onLogout, currentPath }) => {
  const haptic = () => {
    if (Capacitor.isNativePlatform()) Haptics.impact({ style: ImpactStyle.Light });
  };

  const handleNav = (path) => {
    haptic();
    onClose();
    setTimeout(() => onNavigate(path), 80);
  };

  return (
    <>
      {/* 오버레이 */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.45)',
          zIndex: 9997,
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.25s ease',
        }}
      />

      {/* 시트 */}
      <div style={{
        position: 'fixed',
        bottom: 0, left: 0, right: 0,
        background: '#F2F2F7',
        borderRadius: '20px 20px 0 0',
        zIndex: 9998,
        transform: open ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform 0.38s cubic-bezier(0.32, 0.72, 0, 1)',
        maxHeight: '85vh',
        display: 'flex',
        flexDirection: 'column',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
        boxShadow: '0 -4px 24px rgba(0,0,0,0.12)',
      }}>
        {/* 드래그 핸들 */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 0' }}>
          <div style={{ width: '36px', height: '4px', background: '#C7C7CC', borderRadius: '2px' }} />
        </div>

        {/* 헤더 */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '12px 20px 16px',
        }}>
          <span style={{ fontSize: '20px', fontWeight: '700', color: '#1C1C1E', letterSpacing: '-0.3px' }}>
            More
          </span>
          <button
            onClick={onClose}
            style={{
              width: '30px', height: '30px', borderRadius: '50%',
              background: '#E5E5EA', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '15px', color: '#6C6C70', fontWeight: '600',
            }}
          >✕</button>
        </div>

        {/* 스크롤 영역 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px', WebkitOverflowScrolling: 'touch' }}>

          {/* 동기화 버튼 */}
          <div style={{ marginBottom: '20px' }}>
            <button
              onClick={() => { haptic(); onSync(); onClose(); }}
              disabled={syncing}
              style={{
                width: '100%', padding: '14px', background: syncing ? '#AEAEB2' : '#1C1C1E',
                color: '#fff', border: 'none', borderRadius: '14px',
                fontSize: '14px', fontWeight: '600', cursor: syncing ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 12c0-4.4 3.6-8 8-8 3.3 0 6.2 2 7.4 5M22 12c0 4.4-3.6 8-8 8-3.3 0-6.2-2-7.4-5" />
              </svg>
              Data Sync
            </button>
          </div>

          {/* 메뉴 그리드 4열 */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '10px',
            marginBottom: '20px',
          }}>
            {MORE_MENU_ITEMS.map(item => {
              const isActive = currentPath === item.path;
              return (
                <button
                  key={item.path}
                  onClick={() => handleNav(item.path)}
                  style={{
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', gap: '7px',
                    background: isActive ? '#E8F0FE' : '#FFFFFF',
                    border: isActive ? '1.5px solid #007AFF' : '1.5px solid transparent',
                    borderRadius: '16px', padding: '14px 6px',
                    cursor: 'pointer', transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{
                    width: '44px', height: '44px', borderRadius: '12px',
                    background: isActive ? '#007AFF' : '#F2F2F7',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <MenuIcon name={item.icon} active={isActive} size={20} />
                  </div>
                  <span style={{
                    fontSize: '11px', fontWeight: isActive ? '600' : '500',
                    color: isActive ? '#007AFF' : '#3C3C43',
                    textAlign: 'center', lineHeight: '1.3',
                  }}>{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* 구분선 */}
          <div style={{ height: '1px', background: '#C6C6C8', margin: '0 0 16px' }} />

          {/* 로그아웃 */}
          <button
            onClick={() => { haptic(); onLogout(); }}
            style={{
              width: '100%', padding: '16px', background: '#FFFFFF',
              color: '#FF3B30', border: 'none', borderRadius: '14px',
              fontSize: '16px', fontWeight: '600', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              marginBottom: '8px',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Sign Out
          </button>
        </div>
      </div>
    </>
  );
};

// ─── 모바일 하단 탭바 ────────────────────────────────────────────────────────────

const MobileNavBar = ({ currentPath, onNavigate, onMoreOpen, unreadCount = 0 }) => {
  const isMoreActive = MORE_MENU_ITEMS.some(item => item.path === currentPath);

  const handleTap = (path) => {
    if (Capacitor.isNativePlatform()) Haptics.impact({ style: ImpactStyle.Light });
    if (path === 'MORE') {
      onMoreOpen();
    } else {
      onNavigate(path);
    }
  };

  return (
    <nav style={styles.mobileNavBar}>
      {MOBILE_NAV_ITEMS.map((item) => {
        const isActive = item.path === 'MORE'
          ? isMoreActive
          : currentPath === item.path;

        return (
          <button
            key={item.path}
            style={{ ...styles.mobileTab }}
            onClick={() => handleTap(item.path)}
            onTouchStart={(e) => { e.currentTarget.style.opacity = '0.6'; }}
            onTouchEnd={(e) => { e.currentTarget.style.opacity = '1'; }}
          >
            {/* 아이콘 + 뱃지 */}
            <div style={{ position: 'relative', marginBottom: '3px' }}>
              <MenuIcon name={item.icon} active={isActive} size={24} />
              {item.badge && unreadCount > 0 && (
                <span style={styles.tabBadge}>
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </div>
            <span style={{
              ...styles.mobileTabLabel,
              color: isActive ? '#007AFF' : '#8E8E93',
              fontWeight: isActive ? '600' : '500',
            }}>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
};

// ─── 메인 레이아웃 ───────────────────────────────────────────────────────────────

const NewLayout = ({ children, onSync, syncing }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = location.pathname;
  const { userData } = useUser();
  const [moreOpen, setMoreOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const mainRef = React.useRef(null);
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      if (mainRef.current) setShowScrollTop(mainRef.current.scrollTop > 300);
    };
    const el = mainRef.current;
    if (el) el.addEventListener('scroll', handleScroll);
    return () => { if (el) el.removeEventListener('scroll', handleScroll); };
  }, []);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 페이지 이동 시 더보기 시트 닫기
  useEffect(() => { setMoreOpen(false); }, [currentPath]);

  const logout = () => {
    if (window.confirm('Sign out?')) signOut(auth);
  };

  const scrollToTop = () => {
    if (mainRef.current) mainRef.current.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const pageTitle = MOBILE_PAGE_TITLES[currentPath] || 'Haru Studio';

  return (
    <div style={styles.container}>

      {/* ── 모바일 헤더 (iOS 스타일) ── */}
      {isMobile && (
        <header style={styles.mobileHeader}>
          {/* 왼쪽: 로고 */}
          <div style={styles.mobileHeaderLogo}>
            <svg width="28" height="28" viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="24" r="15" fill="#111827" />
              <path d="M14 18c1-2 4-3 6-2s3 2 4 1c1.5-1.5 3 0 3.5 1.5s-1 3-2.5 3.5c-2 0.5-4-1-5.5-0.5s-2.5 2-4 1.5S13 20 14 18z" fill="#9CA3AF" />
              <path d="M28 14c2-1 5 0 6 2s0 4-1 5-3 0-4-1-2-2-1.5-4S26 15 28 14z" fill="#9CA3AF" />
              <circle cx="24" cy="24" r="15" stroke="#374151" strokeWidth="1" fill="none" />
              <g transform="translate(4, 8) rotate(-30, 10, 10)">
                <path d="M2 10 L7 8 L16 9 L19 10 L16 11 L7 12 L2 10Z" fill="#FFFFFF" />
                <path d="M8 10 L4 3 L7 3 L11 9 Z" fill="#FFFFFF" />
                <path d="M8 10 L4 17 L7 17 L11 11 Z" fill="#FFFFFF" />
              </g>
            </svg>
          </div>

          {/* 가운데: 페이지 타이틀 (절대 중앙) */}
          <span style={styles.mobileHeaderTitle}>{pageTitle}</span>

          {/* 오른쪽: 알림벨 */}
          <div style={styles.mobileHeaderRight}>
            <NotificationBell />
          </div>
        </header>
      )}

      {/* ── 더보기 Bottom Sheet ── */}
      {isMobile && (
        <MoreBottomSheet
          open={moreOpen}
          onClose={() => setMoreOpen(false)}
          onNavigate={(path) => navigate(path)}
          onSync={onSync}
          syncing={syncing}
          onLogout={logout}
          currentPath={currentPath}
        />
      )}

      {/* ── PC 사이드바 ── */}
      {!isMobile && (
        <aside style={styles.sidebar}>
          {/* 로고 */}
          <div style={styles.logoSection}>
            <div style={styles.logoIcon}>
              <svg width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden="true">
                <rect x="2.5" y="2.5" width="39" height="39" rx="11" fill="#F7F4EC" stroke="#14284B" strokeWidth="2.5" />
                <path d="M15 12.5V31.5" stroke="#14284B" strokeWidth="3.6" strokeLinecap="round" />
                <path d="M29 12.5V31.5" stroke="#14284B" strokeWidth="3.6" strokeLinecap="round" />
                <path d="M15 22H29" stroke="#14284B" strokeWidth="3.6" strokeLinecap="round" />
              </svg>
            </div>
            <div style={styles.logoTextContainer}>
              <span style={styles.logoText}>Haru Studio</span>
              <span style={styles.logoSubtext}>Property Management System</span>
            </div>
          </div>

          {/* 동기화 버튼 */}
          <div style={styles.syncSection}>
            <button
              style={{ ...styles.syncBtn, ...(syncing ? styles.syncBtnDisabled : {}), width: '100%' }}
              onClick={() => onSync()}
              disabled={syncing}
            >
              <div style={styles.syncBtnContent}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={syncing ? styles.spinIcon : {}}>
                  <path d="M21.5 2v6h-6M2.5 22v-6h6M2 12c0-4.4 3.6-8 8-8 3.3 0 6.2 2 7.4 5M22 12c0 4.4-3.6 8-8 8-3.3 0-6.2-2-7.4-5" />
                </svg>
                <span>Data Sync</span>
              </div>
            </button>
          </div>

          {/* 메뉴 */}
          <nav style={styles.nav}>
            <p style={styles.menuLabel}>Menu</p>
            {MENU_ITEMS.slice(0, 10).map(item => (
              <button
                key={item.path}
                style={{ ...styles.menuItem, ...(currentPath === item.path ? styles.menuItemActive : {}) }}
                onClick={() => navigate(item.path)}
              >
                <MenuIcon name={item.icon} active={currentPath === item.path} size={18} />
                <span style={{ ...styles.menuText, ...(currentPath === item.path ? styles.menuTextActive : {}) }}>
                  {item.label}
                </span>
              </button>
            ))}
            <p style={{ ...styles.menuLabel, marginTop: '24px' }}>Tools</p>
            {MENU_ITEMS.slice(10).map(item => (
              <button
                key={item.path}
                style={{ ...styles.menuItem, ...(currentPath === item.path ? styles.menuItemActive : {}) }}
                onClick={() => navigate(item.path)}
              >
                <MenuIcon name={item.icon} active={currentPath === item.path} size={18} />
                <span style={{ ...styles.menuText, ...(currentPath === item.path ? styles.menuTextActive : {}) }}>
                  {item.label}
                </span>
              </button>
            ))}
          </nav>

          {/* 로그아웃 */}
          <div style={styles.logoutSection}>
            <div style={styles.logoutDivider}></div>
            <button style={styles.logoutButton} onClick={logout}>
              <div style={styles.logoutIconWrap}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </div>
              <span style={styles.logoutText}>Sign Out</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" style={{ marginLeft: 'auto' }}>
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        </aside>
      )}

      {/* ── 메인 콘텐츠 ── */}
      <main
        ref={mainRef}
        style={{
          ...styles.main,
          marginLeft: isMobile ? '0' : '260px',
          paddingTop: isMobile ? 'calc(56px + env(safe-area-inset-top, 0px))' : '0',
          paddingBottom: isMobile ? 'calc(72px + env(safe-area-inset-bottom, 0px))' : '0',
        }}
      >
        {/* PC 헤더 */}
        {!isMobile && (
          <header style={styles.header}>
            <div style={styles.headerLeft}>
              <input type="text" placeholder="Search..." style={styles.headerSearch} autoComplete="off" />
              <svg style={styles.headerSearchIcon} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <div style={styles.headerRight}>
              <NotificationBell />
              <div style={styles.userSection} onClick={() => navigate('/my-profile')} title="Go to My Profile">
                <div style={styles.userInfo}>
                  <span style={styles.userName}>{userData?.fullName || 'User'}</span>
                  <span style={styles.userRole}>{userData?.role === 'owner' ? 'Owner' : 'Member'}</span>
                </div>
                <div style={styles.userAvatar}>
                  {userData?.profileImage ? (
                    <img src={userData.profileImage} alt="Profile" style={styles.userAvatarImage} />
                  ) : (
                    <span style={{ fontSize: '20px' }}>👤</span>
                  )}
                </div>
              </div>
            </div>
          </header>
        )}

        {/* 페이지 콘텐츠 */}
        <div style={{
          ...styles.content,
          padding: isMobile ? '12px 14px' : '24px 32px',
        }}>
          {children}
        </div>

        {/* 모바일 하단 탭바 */}
        {isMobile && (
          <MobileNavBar
            currentPath={currentPath}
            onNavigate={(path) => navigate(path)}
            onMoreOpen={() => setMoreOpen(true)}
          />
        )}

        {/* 위로 스크롤 버튼 - PC 전용 */}
        {!isMobile && (
          <button
            onClick={scrollToTop}
            style={{
              position: 'fixed',
              bottom: '30px', right: '30px',
              width: '44px', height: '44px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)',
              color: 'white', border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(37,99,235,0.35)',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              opacity: showScrollTop ? 1 : 0,
              transform: showScrollTop ? 'translateY(0) scale(1)' : 'translateY(20px) scale(0.8)',
              pointerEvents: showScrollTop ? 'auto' : 'none',
              zIndex: 999,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </button>
        )}
      </main>
    </div>
  );
};

// ─── 스타일 ──────────────────────────────────────────────────────────────────────

const styles = {
  container: {
    display: 'flex',
    minHeight: '100vh',
    backgroundColor: '#F9FAFB',
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", "Segoe UI", Roboto, sans-serif',
  },

  // PC 사이드바
  sidebar: {
    width: '260px', backgroundColor: '#FFFFFF',
    borderRight: '1px solid #E5E7EB',
    display: 'flex', flexDirection: 'column',
    padding: '20px 16px',
    position: 'fixed', height: '100vh',
    overflowY: 'auto', zIndex: 100,
  },
  logoSection: {
    display: 'flex', alignItems: 'center', gap: '14px',
    marginBottom: '20px', paddingLeft: '8px',
  },
  logoIcon: { width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  logoTextContainer: { display: 'flex', flexDirection: 'column' },
  logoText: { fontSize: '16px', fontWeight: '700', color: '#14284B', letterSpacing: '-0.4px', lineHeight: 1.1 },
  logoSubtext: { fontSize: '11px', fontWeight: '500', color: '#6B7280', letterSpacing: '-0.1px', marginTop: '4px' },
  syncSection: { display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '24px', padding: '0 4px' },
  syncBtn: {
    padding: '12px 16px', backgroundColor: '#1F2937', color: '#FFFFFF',
    border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: '600',
    cursor: 'pointer', transition: 'all 0.2s',
    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  syncBtnSecondary: {
    padding: '10px 16px', backgroundColor: '#F3F4F6', color: '#4B5563',
    border: '1px solid #E5E7EB', borderRadius: '12px', fontSize: '13px', fontWeight: '500',
    cursor: 'pointer', transition: 'all 0.2s ease',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  syncBtnDisabled: { opacity: 0.5, cursor: 'not-allowed', boxShadow: 'none' },
  syncBtnContent: { display: 'flex', alignItems: 'center', gap: '8px' },
  spinIcon: { animation: 'spin 1.5s linear infinite' },
  nav: { flex: 1 },
  menuLabel: {
    fontSize: '11px', fontWeight: '600', color: '#9CA3AF',
    textTransform: 'uppercase', letterSpacing: '0.5px',
    marginBottom: '12px', paddingLeft: '12px',
  },
  menuItem: {
    display: 'flex', alignItems: 'center', gap: '12px',
    width: '100%', padding: '11px 12px', border: 'none',
    backgroundColor: 'transparent', borderRadius: '10px',
    cursor: 'pointer', marginBottom: '2px', transition: 'all 0.2s',
  },
  menuItemActive: { backgroundColor: '#1F2937' },
  menuText: { fontSize: '14px', fontWeight: '500', color: '#4B5563', textAlign: 'left' },
  menuTextActive: { color: '#FFFFFF' },
  logoutSection: { marginTop: 'auto', paddingTop: '16px' },
  logoutDivider: {
    height: '1px',
    background: 'linear-gradient(90deg, transparent 0%, #E5E7EB 50%, transparent 100%)',
    marginBottom: '16px',
  },
  logoutButton: {
    display: 'flex', alignItems: 'center', gap: '12px',
    width: '100%', padding: '12px 14px',
    border: '1px solid #FEE2E2', backgroundColor: '#FEF2F2',
    borderRadius: '12px', cursor: 'pointer', transition: 'all 0.2s ease',
  },
  logoutIconWrap: {
    width: '32px', height: '32px', borderRadius: '8px',
    backgroundColor: '#FEE2E2', display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#EF4444',
  },
  logoutText: { fontSize: '14px', fontWeight: '600', color: '#DC2626' },

  // PC 메인
  main: {
    flex: 1, height: '100vh', backgroundColor: '#F9FAFB',
    overflow: 'auto', display: 'block',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '16px 32px', backgroundColor: '#FFFFFF',
    borderBottom: '1px solid #E5E7EB',
    position: 'sticky', top: 0, zIndex: 50,
  },
  headerLeft: { position: 'relative', flex: 1, maxWidth: '400px' },
  headerSearch: {
    width: '100%', padding: '12px 16px 12px 44px',
    border: '1px solid #E5E7EB', borderRadius: '10px',
    fontSize: '14px', outline: 'none', backgroundColor: '#FFFFFF',
  },
  headerSearchIcon: { position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)' },
  headerRight: { display: 'flex', alignItems: 'center', gap: '16px' },
  userSection: {
    display: 'flex', alignItems: 'center', gap: '12px',
    paddingLeft: '16px', borderLeft: '1px solid #E5E7EB',
    cursor: 'pointer', transition: 'all 0.2s ease',
  },
  userInfo: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end' },
  userName: { fontSize: '14px', fontWeight: '600', color: '#1F2937' },
  userRole: { fontSize: '12px', color: '#6B7280' },
  userAvatar: {
    width: '40px', height: '40px', borderRadius: '50%',
    backgroundColor: '#E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  userAvatarImage: { width: '100%', height: '100%', objectFit: 'cover' },
  content: { flex: 1 },

  // 모바일 헤더 (iOS 스타일)
  mobileHeader: {
    position: 'fixed', top: 0, left: 0, right: 0,
    height: 'calc(56px + env(safe-area-inset-top, 0px))',
    paddingTop: 'env(safe-area-inset-top, 0px)',
    background: 'rgba(255,255,255,0.92)',
    backdropFilter: 'saturate(180%) blur(20px)',
    WebkitBackdropFilter: 'saturate(180%) blur(20px)',
    borderBottom: '0.5px solid rgba(0,0,0,0.15)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: '16px',
    paddingRight: '16px',
  },
  mobileHeaderLogo: {
    width: '40px', display: 'flex', alignItems: 'center',
  },
  mobileHeaderTitle: {
    position: 'absolute',
    left: '50%', transform: 'translateX(-50%)',
    fontSize: '17px', fontWeight: '600', color: '#1C1C1E',
    letterSpacing: '-0.2px',
    whiteSpace: 'nowrap',
  },
  mobileHeaderRight: {
    width: '40px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
  },

  // 모바일 하단 탭바
  mobileNavBar: {
    position: 'fixed', bottom: 0, left: 0, right: 0,
    height: 'calc(56px + env(safe-area-inset-bottom, 0px))',
    backgroundColor: 'rgba(249,249,249,0.94)',
    backdropFilter: 'saturate(180%) blur(20px)',
    WebkitBackdropFilter: 'saturate(180%) blur(20px)',
    borderTop: '0.5px solid rgba(0,0,0,0.15)',
    display: 'flex', justifyContent: 'space-around', alignItems: 'flex-start',
    paddingTop: '8px',
    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
    zIndex: 1000,
  },
  mobileTab: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    gap: '2px', background: 'none', border: 'none',
    width: '20%', padding: '0', cursor: 'pointer',
    transition: 'opacity 0.1s ease',
    WebkitTapHighlightColor: 'transparent',
  },
  mobileTabLabel: {
    fontSize: '10px', letterSpacing: '-0.1px',
  },

  // 메시지 뱃지
  tabBadge: {
    position: 'absolute', top: '-4px', right: '-8px',
    background: '#FF3B30', color: '#fff',
    fontSize: '10px', fontWeight: '700',
    borderRadius: '10px', minWidth: '16px', height: '16px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '0 4px', lineHeight: '1',
    border: '1.5px solid #F9F9F9',
  },
};

export default NewLayout;
