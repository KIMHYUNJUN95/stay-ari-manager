// src/components/NewLayout.jsx
// Finova 스타일 새 레이아웃 - 기존 기능 100% 보존

import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { signOut } from "firebase/auth";
import { auth } from '../firebase';
import NotificationBell from './NotificationBell';

// 메뉴 데이터 (App.jsx와 동일하게 유지)
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
  { path: "/ai-assistant", label: "AI Briefing", icon: "cpu" },
];

// SVG 아이콘 컴포넌트
const MenuIcon = ({ name, active }) => {
  const color = active ? '#FFFFFF' : '#6B7280';
  const icons = {
    grid: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
        <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
    chart: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
        <path d="M21 21H4.6c-.56 0-.84 0-1.054-.109a1 1 0 0 1-.437-.437C3 20.24 3 19.96 3 19.4V3" />
        <path d="m7 14 4-4 4 4 6-6" />
      </svg>
    ),
    dollar: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
        <path d="M12 18V6" />
      </svg>
    ),
    book: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
    calendar: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
    bed: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
        <path d="M2 4v16" /><path d="M2 8h18a2 2 0 0 1 2 2v10" />
        <path d="M2 17h20" /><path d="M6 8v9" />
      </svg>
    ),
    trending: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
      </svg>
    ),
    target: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
        <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="2" />
      </svg>
    ),
    globe: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
    door: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
        <path d="M18 20V6a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v14" />
        <path d="M2 20h20" /><path d="M14 12v.01" />
      </svg>
    ),
    sparkle: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
        <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      </svg>
    ),
    link: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    ),
    users: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    cpu: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <rect x="9" y="9" width="6" height="6" />
        <path d="M9 1v3" /><path d="M15 1v3" /><path d="M9 20v3" /><path d="M15 20v3" />
        <path d="M20 9h3" /><path d="M20 14h3" /><path d="M1 9h3" /><path d="M1 14h3" />
      </svg>
    ),
    help: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
    settings: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    )
  };
  return icons[name] || icons.grid;
};

const NewLayout = ({ children, onSync, syncing }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = location.pathname;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const mainRef = React.useRef(null);
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      if (mainRef.current) {
        setShowScrollTop(mainRef.current.scrollTop > 300);
      }
    };

    const mainElement = mainRef.current;
    if (mainElement) {
      mainElement.addEventListener('scroll', handleScroll);
    }
    return () => {
      if (mainElement) {
        mainElement.removeEventListener('scroll', handleScroll);
      }
    };
  }, []);

  const scrollToTop = () => {
    if (mainRef.current) {
      mainRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const logout = () => {
    if (window.confirm("Are you sure you want to logout?")) {
      signOut(auth);
    }
  };

  const currentMenu = MENU_ITEMS.find(m => m.path === currentPath);

  return (
    <div style={styles.container}>
      {/* 모바일 헤더 */}
      {isMobile && (
        <header style={styles.mobileHeader}>
          <div style={styles.mobileHeaderLeft}>
            <svg width="30" height="30" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
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
            <span style={styles.mobileHeaderTitle}>{currentMenu?.label || 'Haru Studio'}</span>
          </div>
          <button style={styles.mobileMenuBtn} onClick={() => setMobileMenuOpen(true)}>
            <div style={styles.hamburger}>
              <span style={styles.hamburgerLine}></span>
              <span style={styles.hamburgerLine}></span>
              <span style={styles.hamburgerLine}></span>
            </div>
          </button>
        </header>
      )}

      {/* 모바일 메뉴 오버레이 */}
      {mobileMenuOpen && (
        <div style={styles.mobileOverlay} onClick={() => setMobileMenuOpen(false)} />
      )}

      {/* 모바일 슬라이드 메뉴 */}
      <div style={{
        ...styles.mobileDrawer,
        right: mobileMenuOpen ? '0' : '-100%'
      }}>
        <div style={styles.mobileDrawerHeader}>
          <div style={styles.mobileDrawerLogo}>
            <svg width="36" height="36" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
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
            <span style={{ fontWeight: '700', fontSize: '18px' }}>Haru Studio</span>
          </div>
          <button style={styles.mobileCloseBtn} onClick={() => setMobileMenuOpen(false)}>×</button>
        </div>
        <div style={styles.mobileDrawerContent}>
          {MENU_ITEMS.map((item) => (
            <button
              key={item.path}
              style={{
                ...styles.mobileNavItem,
                ...(currentPath === item.path ? styles.mobileNavItemActive : {})
              }}
              onClick={() => { navigate(item.path); setMobileMenuOpen(false); }}
            >
              <MenuIcon name={item.icon} active={currentPath === item.path} />
              <span style={{
                ...styles.mobileNavLabel,
                ...(currentPath === item.path ? { color: '#3B82F6', fontWeight: '600' } : {})
              }}>{item.label}</span>
              {currentPath === item.path && <span style={styles.mobileActiveDot}></span>}
            </button>
          ))}
        </div>
        <div style={styles.mobileDrawerFooter}>
          <button
            style={{
              ...styles.mobileSyncBtn,
              ...(syncing ? styles.syncBtnDisabled : {})
            }}
            onClick={() => { onSync(false); setMobileMenuOpen(false); }}
            disabled={syncing}
          >
            <div style={styles.syncBtnContent}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={syncing ? styles.spinIcon : {}}>
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 12c0-4.4 3.6-8 8-8 3.3 0 6.2 2 7.4 5M22 12c0 4.4-3.6 8-8 8-3.3 0-6.2-2-7.4-5" />
              </svg>
              <span>Quick Sync</span>
            </div>
          </button>
          <button
            style={{
              ...styles.mobileSyncBtn,
              ...styles.mobileSyncBtnSecondary,
              ...(syncing ? styles.syncBtnDisabled : {})
            }}
            onClick={() => { onSync(true); setMobileMenuOpen(false); }}
            disabled={syncing}
          >
            <div style={styles.syncBtnContent}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
              <span>Full History Sync</span>
            </div>
          </button>
          <button style={styles.mobileLogoutBtn} onClick={logout}>
            🔓 Logout
          </button>
        </div>
      </div>

      {/* PC 사이드바 */}
      {!isMobile && (
        <aside style={styles.sidebar}>
          {/* 로고 */}
          <div style={styles.logoSection}>
            <div style={styles.logoIcon}>
              <svg width="42" height="42" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                {/* 지구본 - 더 선명한 대비 */}
                <circle cx="24" cy="24" r="15" fill="#111827" />

                {/* 대륙들 - 더 밝고 선명하게 */}
                <path d="M14 18c1-2 4-3 6-2s3 2 4 1c1.5-1.5 3 0 3.5 1.5s-1 3-2.5 3.5c-2 0.5-4-1-5.5-0.5s-2.5 2-4 1.5S13 20 14 18z" fill="#9CA3AF" />
                <path d="M28 14c2-1 5 0 6 2s0 4-1 5-3 0-4-1-2-2-1.5-4S26 15 28 14z" fill="#9CA3AF" />
                <path d="M18 28c1-1 3-0.5 4 0.5s1 3 0 4-3 1-4-0.5S17 29 18 28z" fill="#9CA3AF" />
                <path d="M30 26c1.5-0.5 3 0.5 3.5 2s-0.5 3-2 3-2.5-1.5-2.5-3S28.5 26.5 30 26z" fill="#9CA3AF" />

                {/* 위도/경도 그리드 - 선명도 조절 */}
                <ellipse cx="24" cy="24" rx="15" ry="5" stroke="#4B5563" strokeWidth="0.5" fill="none" opacity="0.6" />
                <ellipse cx="24" cy="24" rx="5" ry="15" stroke="#4B5563" strokeWidth="0.5" fill="none" opacity="0.6" />

                {/* 지구본 테두리 - 글로우 효과 느낌 */}
                <circle cx="24" cy="24" r="15" stroke="#374151" strokeWidth="1" fill="none" />

                {/* 비행기 궤도 - 더 다이나믹하게 */}
                <path d="M6 30 Q10 42 24 42 Q38 42 42 30" stroke="#10B981" strokeWidth="1" fill="none" opacity="0.4" strokeDasharray="2 2" />

                {/* 비행기 (크기 키우고 지구본과 분리) */}
                <g transform="translate(4, 8) rotate(-30, 10, 10)">
                  {/* 비행기 그림자 (살짝 아래) */}
                  <path d="M2 11 L7 9 L16 10 L19 11 L16 12 L7 13 L2 11Z" fill="#000000" opacity="0.2" />
                  {/* 비행기 본체 - 흰색으로 강조 */}
                  <path d="M2 10 L7 8 L16 9 L19 10 L16 11 L7 12 L2 10Z" fill="#FFFFFF" />
                  {/* 주날개 */}
                  <path d="M8 10 L4 3 L7 3 L11 9 Z" fill="#FFFFFF" />
                  <path d="M8 10 L4 17 L7 17 L11 11 Z" fill="#FFFFFF" />
                  {/* 꼬리날개 */}
                  <path d="M15 10 L17 6 L18.5 6 L16.5 9.5 Z" fill="#FFFFFF" />
                  <path d="M15 10 L17 14 L18.5 14 L16.5 10.5 Z" fill="#FFFFFF" />
                  {/* 수직꼬리 */}
                  <path d="M16 10 L18.5 5 L17.5 5 L16 9 Z" fill="#FFFFFF" />
                </g>
              </svg>
            </div>
            <div style={styles.logoTextContainer}>
              <span style={styles.logoText}>Haru Studio</span>
            </div>
          </div>

          {/* 동기화 버튼 */}
          <div style={styles.syncSection}>
            <button
              style={{
                ...styles.syncBtn,
                ...(syncing ? styles.syncBtnDisabled : {})
              }}
              onClick={() => onSync(false)}
              disabled={syncing}
            >
              <div style={styles.syncBtnContent}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={syncing ? styles.spinIcon : {}}>
                  <path d="M21.5 2v6h-6M2.5 22v-6h6M2 12c0-4.4 3.6-8 8-8 3.3 0 6.2 2 7.4 5M22 12c0 4.4-3.6 8-8 8-3.3 0-6.2-2-7.4-5" />
                </svg>
                <span>Quick Sync</span>
              </div>
            </button>
            <button
              style={{
                ...styles.syncBtnSecondary,
                ...(syncing ? styles.syncBtnDisabled : {})
              }}
              onClick={() => onSync(true)}
              disabled={syncing}
            >
              <div style={styles.syncBtnContent}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                  <line x1="12" y1="22.08" x2="12" y2="12" />
                </svg>
                <span>Full History Sync</span>
              </div>
            </button>
          </div>

          {/* 메뉴 */}
          <nav style={styles.nav}>
            <p style={styles.menuLabel}>Menu</p>
            {MENU_ITEMS.slice(0, 10).map(item => (
              <button
                key={item.path}
                style={{
                  ...styles.menuItem,
                  ...(currentPath === item.path ? styles.menuItemActive : {})
                }}
                onClick={() => navigate(item.path)}
              >
                <MenuIcon name={item.icon} active={currentPath === item.path} />
                <span style={{
                  ...styles.menuText,
                  ...(currentPath === item.path ? styles.menuTextActive : {})
                }}>{item.label}</span>
              </button>
            ))}

            <p style={{ ...styles.menuLabel, marginTop: '24px' }}>Tools</p>
            {MENU_ITEMS.slice(10).map(item => (
              <button
                key={item.path}
                style={{
                  ...styles.menuItem,
                  ...(currentPath === item.path ? styles.menuItemActive : {})
                }}
                onClick={() => navigate(item.path)}
              >
                <MenuIcon name={item.icon} active={currentPath === item.path} />
                <span style={{
                  ...styles.menuText,
                  ...(currentPath === item.path ? styles.menuTextActive : {})
                }}>{item.label}</span>
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

      {/* 메인 콘텐츠 */}
      <main
        ref={mainRef}
        style={{
          ...styles.main,
          marginLeft: isMobile ? '0' : '260px',
          paddingTop: isMobile ? 'calc(56px + env(safe-area-inset-top, 0px))' : '0'
        }}>
        {/* PC 헤더 */}
        {!isMobile && (
          <header style={styles.header}>
            <div style={styles.headerLeft}>
              <input type="text" placeholder="Search..." style={styles.headerSearch} />
              <svg style={styles.headerSearchIcon} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <div style={styles.headerRight}>
              <NotificationBell />
              <div style={styles.userSection}>
                <div style={styles.userInfo}>
                  <span style={styles.userName}>Admin</span>
                  <span style={styles.userRole}>Manager</span>
                </div>
                <div style={styles.userAvatar}>
                  <span style={{ fontSize: '20px' }}>👤</span>
                </div>
              </div>
            </div>
          </header>
        )}

        {/* 페이지 콘텐츠 */}
        <div style={styles.content}>
          {children}
        </div>

        {/* Scroll To Top Button */}
        <button
          onClick={scrollToTop}
          style={{
            position: 'fixed',
            bottom: '30px',
            right: '30px',
            width: '50px',
            height: '50px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)',
            color: 'white',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 8px 16px rgba(37, 99, 235, 0.3)',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            opacity: showScrollTop ? 1 : 0,
            transform: showScrollTop ? 'translateY(0) scale(1)' : 'translateY(20px) scale(0.8)',
            pointerEvents: showScrollTop ? 'auto' : 'none',
            zIndex: 999
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-4px) scale(1.05)';
            e.currentTarget.style.boxShadow = '0 12px 20px rgba(37, 99, 235, 0.4)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0) scale(1)';
            e.currentTarget.style.boxShadow = '0 8px 16px rgba(37, 99, 235, 0.3)';
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </button>
      </main>
    </div>
  );
};

// 스타일
const styles = {
  container: {
    display: 'flex',
    minHeight: '100vh',
    backgroundColor: '#F9FAFB',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif'
  },

  // 사이드바
  sidebar: {
    width: '260px',
    backgroundColor: '#FFFFFF',
    borderRight: '1px solid #E5E7EB',
    display: 'flex',
    flexDirection: 'column',
    padding: '20px 16px',
    position: 'fixed',
    height: '100vh',
    overflowY: 'auto',
    zIndex: 100
  },
  logoSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '20px',
    paddingLeft: '8px'
  },
  logoIcon: {
    width: '40px',
    height: '40px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  logoTextContainer: {
    display: 'flex',
    flexDirection: 'column'
  },
  logoText: {
    fontSize: '18px',
    fontWeight: '700',
    color: '#1F2937',
    letterSpacing: '-0.3px'
  },
  searchSection: {
    marginBottom: '16px'
  },
  sidebarSearch: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    backgroundColor: '#F3F4F6',
    borderRadius: '10px',
    padding: '10px 14px'
  },
  sidebarSearchInput: {
    border: 'none',
    outline: 'none',
    backgroundColor: 'transparent',
    fontSize: '14px',
    color: '#1F2937',
    width: '100%'
  },
  syncSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    marginBottom: '24px',
    padding: '0 4px'
  },
  syncBtn: {
    padding: '12px 16px',
    backgroundColor: '#1F2937',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '12px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  syncBtnSecondary: {
    padding: '10px 16px',
    backgroundColor: '#F3F4F6',
    color: '#4B5563',
    border: '1px solid #E5E7EB',
    borderRadius: '12px',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  syncBtnDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed',
    boxShadow: 'none'
  },
  syncBtnContent: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  spinIcon: {
    animation: 'spin 2s linear infinite'
  },
  nav: {
    flex: 1
  },
  menuLabel: {
    fontSize: '11px',
    fontWeight: '600',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '12px',
    paddingLeft: '12px'
  },
  menuItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    width: '100%',
    padding: '11px 12px',
    border: 'none',
    backgroundColor: 'transparent',
    borderRadius: '10px',
    cursor: 'pointer',
    marginBottom: '2px',
    transition: 'all 0.2s'
  },
  menuItemActive: {
    backgroundColor: '#1F2937'
  },
  menuText: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#4B5563',
    textAlign: 'left'
  },
  menuTextActive: {
    color: '#FFFFFF'
  },
  promoBanner: {
    backgroundColor: '#F0FDF4',
    borderRadius: '16px',
    padding: '16px',
    marginTop: '16px',
    position: 'relative',
    overflow: 'hidden'
  },
  promoIcon: {
    fontSize: '28px',
    marginBottom: '8px'
  },
  promoTitle: {
    fontSize: '12px',
    color: '#1F2937',
    lineHeight: '1.5',
    marginBottom: '12px'
  },
  promoButton: {
    backgroundColor: '#10B981',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '8px',
    padding: '8px 16px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  promoDecoration: {
    position: 'absolute',
    right: '-20px',
    bottom: '-20px',
    width: '60px',
    height: '60px',
    backgroundColor: '#86EFAC',
    borderRadius: '50%',
    opacity: '0.5'
  },
  logoutSection: {
    marginTop: 'auto',
    paddingTop: '16px'
  },
  logoutDivider: {
    height: '1px',
    background: 'linear-gradient(90deg, transparent 0%, #E5E7EB 50%, transparent 100%)',
    marginBottom: '16px'
  },
  logoutButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    width: '100%',
    padding: '12px 14px',
    border: '1px solid #FEE2E2',
    backgroundColor: '#FEF2F2',
    borderRadius: '12px',
    cursor: 'pointer',
    transition: 'all 0.2s ease'
  },
  logoutIconWrap: {
    width: '32px',
    height: '32px',
    borderRadius: '8px',
    backgroundColor: '#FEE2E2',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#EF4444'
  },
  logoutText: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#DC2626'
  },

  // 메인
  main: {
    flex: 1,
    height: '100vh',
    backgroundColor: '#F9FAFB',
    overflow: 'auto',
    display: 'block'
  },

  // 헤더
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 32px',
    backgroundColor: '#FFFFFF',
    borderBottom: '1px solid #E5E7EB',
    position: 'sticky',
    top: 0,
    zIndex: 50
  },
  headerLeft: {
    position: 'relative',
    flex: 1,
    maxWidth: '400px'
  },
  headerSearch: {
    width: '100%',
    padding: '12px 16px 12px 44px',
    border: '1px solid #E5E7EB',
    borderRadius: '10px',
    fontSize: '14px',
    outline: 'none',
    backgroundColor: '#FFFFFF'
  },
  headerSearchIcon: {
    position: 'absolute',
    left: '16px',
    top: '50%',
    transform: 'translateY(-50%)'
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px'
  },
  headerIcon: {
    width: '40px',
    height: '40px',
    border: 'none',
    backgroundColor: 'transparent',
    borderRadius: '10px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative'
  },
  notificationDot: {
    position: 'absolute',
    top: '8px',
    right: '8px',
    width: '8px',
    height: '8px',
    backgroundColor: '#EF4444',
    borderRadius: '50%'
  },
  userSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    paddingLeft: '16px',
    borderLeft: '1px solid #E5E7EB'
  },
  userInfo: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end'
  },
  userName: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#1F2937'
  },
  userRole: {
    fontSize: '12px',
    color: '#6B7280'
  },
  userAvatar: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    backgroundColor: '#E5E7EB',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },

  // 콘텐츠
  content: {
    padding: '24px 32px',
    flex: 1,
    overflowX: 'auto', // 가로 스크롤 허용 (테이블 등 대응)
    overflowY: 'auto'  // 세로 스크롤 허용
  },

  // 모바일 헤더
  mobileHeader: {
    display: 'flex',
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    height: 'calc(56px + env(safe-area-inset-top, 0px))',
    paddingTop: 'env(safe-area-inset-top, 0px)',
    background: 'rgba(255,255,255,0.95)',
    backdropFilter: 'saturate(180%) blur(20px)',
    WebkitBackdropFilter: 'saturate(180%) blur(20px)',
    borderBottom: '1px solid rgba(0,0,0,0.08)',
    zIndex: 1000,
    paddingLeft: '16px',
    paddingRight: '16px',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  mobileHeaderLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px'
  },
  mobileHeaderIcon: {
    fontSize: '24px'
  },
  mobileHeaderTitle: {
    fontSize: '17px',
    fontWeight: '600',
    color: '#1F2937'
  },
  mobileMenuBtn: {
    width: '44px',
    height: '44px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  hamburger: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
    width: '22px'
  },
  hamburgerLine: {
    display: 'block',
    width: '100%',
    height: '2px',
    background: '#1F2937',
    borderRadius: '2px'
  },

  // 모바일 오버레이
  mobileOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.5)',
    zIndex: 9998
  },

  // 모바일 드로어
  mobileDrawer: {
    position: 'fixed',
    top: 0,
    right: '-100%',
    width: '85%',
    maxWidth: '320px',
    height: '100vh',
    background: '#FFFFFF',
    zIndex: 9999,
    transition: 'right 0.3s ease',
    boxShadow: '-10px 0 40px rgba(0,0,0,0.15)',
    display: 'flex',
    flexDirection: 'column'
  },
  mobileDrawerHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '20px',
    borderBottom: '1px solid #F2F2F7',
    paddingTop: 'max(20px, env(safe-area-inset-top))'
  },
  mobileDrawerLogo: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px'
  },
  mobileCloseBtn: {
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    background: '#F2F2F7',
    border: 'none',
    fontSize: '24px',
    color: '#86868B',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  mobileDrawerContent: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px 0'
  },
  mobileNavItem: {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    padding: '14px 20px',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    position: 'relative',
    gap: '12px'
  },
  mobileNavItemActive: {
    background: 'linear-gradient(90deg, rgba(59,130,246,0.1) 0%, transparent 100%)'
  },
  mobileNavLabel: {
    fontSize: '15px',
    fontWeight: '500',
    color: '#1F2937'
  },
  mobileActiveDot: {
    position: 'absolute',
    right: '20px',
    width: '8px',
    height: '8px',
    background: '#3B82F6',
    borderRadius: '50%'
  },
  mobileDrawerFooter: {
    padding: '20px',
    borderTop: '1px solid #F2F2F7',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    paddingBottom: 'max(20px, env(safe-area-inset-bottom))'
  },
  mobileSyncBtn: {
    width: '100%',
    padding: '14px',
    borderRadius: '12px',
    border: 'none',
    background: '#3B82F6',
    color: 'white',
    fontSize: '15px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  mobileSyncBtnSecondary: {
    background: '#E5E7EB',
    color: '#1F2937'
  },
  mobileLogoutBtn: {
    width: '100%',
    padding: '14px',
    borderRadius: '12px',
    border: 'none',
    background: '#FEE2E2',
    color: '#EF4444',
    fontSize: '15px',
    fontWeight: '600',
    cursor: 'pointer'
  }
};

export default NewLayout;
