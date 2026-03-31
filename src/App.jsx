import React, { useState, useEffect, useCallback } from 'react';
import { HashRouter as Router, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { collection, getDocs, query, where } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';

// ★ 핵심: firebase.js 에서 db, auth 가져오기
import { db, auth } from './firebase';
import { UserProvider, useUser } from './contexts/UserContext';
import { BUILDING_NAMES_EN as _BUILDING_NAMES_EN_CENTRAL, EXCLUDED_BUILDING_UI, ACTIVE_BUILDING_ORDER as _ACTIVE_BUILDING_ORDER } from './constants/buildingData';
import RevenueDashboard from './RevenueDashboard.jsx';
import CleaningDashboard from './components/CleaningDashboard.jsx';
import OccupancyRateDashboard from './components/OccupancyRateDashboard.jsx';
import TodaySummaryDashboard from './components/TodaySummaryDashboard.jsx';
import CountryOccupancyDashboard from './components/CountryOccupancyDashboard.jsx';
import SyncManager from './components/SyncManager.jsx';
import BuildingCalendar from './components/BuildingCalendar.jsx';
import RoomLinksDashboard from './components/RoomLinksDashboard.jsx';
import CustomerListDashboard from './components/CustomerListDashboard.jsx';
import RoomPerformanceDashboard from './components/RoomPerformanceDashboard.jsx';
import PriceChangeHistory from './components/PriceChangeHistory.jsx';
import SalesLog from './components/SalesLog.jsx';
import SalesLogDashboard from './components/SalesLogDashboard.jsx';
import DesignPreview from './components/DesignPreview.jsx';
import NewLayout from './components/NewLayout.jsx';
import ArrivalsAndDeparturesDashboard from './components/ArrivalsAndDeparturesDashboard.jsx';
import MemberManagement from './components/MemberManagement.jsx';
import TeamToast from './components/TeamToast.jsx';
import ReviewsDashboard from './components/ReviewsDashboard.jsx';
import MaintenanceGuard from './components/MaintenanceGuard.jsx';
import MyProfile from './components/MyProfile.jsx';
import LoginScreen from './components/LoginScreen.jsx';

// ★★★ 서버 주소 ★★★
const GET_ARRIVALS_URL = "https://us-central1-my-booking-app-3f0e7.cloudfunctions.net/getTodayArrivals";

// --- [1] 디자인 (Apple Style CSS) ---
// --- [1] 디자인 (Haru Studio Enterprise Theme) ---
// Color Palette:
// Primary: #4F46E5 (Indigo 600)
// Secondary: #64748B (Slate 500)
// Background: #F1F5F9 (Slate 100)
// Surface: #FFFFFF
// Sidebar: #1E293B (Slate 800)

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

  * { box-sizing: border-box; -webkit-font-smoothing: antialiased; }
  body { 
    margin: 0; padding: 0; 
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; 
    background-color: #F1F5F9; 
    color: #1E293B;
    height: 100vh; 
    overflow: hidden; 
  }

  /* 애니메이션 */
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  @keyframes slideUp { from { transform: translateY(10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

  /* 로그인 */
  .login-container { 
    position: fixed; 
    top: 0; 
    left: 0; 
    width: 100vw; 
    height: 100vh; 
    display: flex; 
    justify-content: center; 
    align-items: center; 
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
    z-index: 9999; 
  }
  .login-card { 
    background: white; 
    width: 100%; 
    max-width: 440px; 
    padding: 56px; 
    border-radius: 24px; 
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.1); 
    text-align: center; 
  }
  .login-logo-container {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    margin-bottom: 32px;
  }
  .login-logo { 
    font-size: 48px; 
    font-weight: 800; 
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    letter-spacing: -1px; 
  }
  .login-icon {
    font-size: 36px;
  }
  .login-title { 
    font-size: 28px; 
    font-weight: 700; 
    margin-bottom: 12px; 
    color: #0F172A; 
    letter-spacing: -0.5px;
  }
  .login-subtitle { 
    font-size: 15px; 
    color: #64748B; 
    margin-bottom: 40px; 
    line-height: 1.6;
  }
  .login-divider {
    display: flex;
    align-items: center;
    text-align: center;
    margin: 24px 0;
  }
  .login-divider::before,
  .login-divider::after {
    content: '';
    flex: 1;
    border-bottom: 1px solid #E2E8F0;
  }
  .login-divider span {
    padding: 0 16px;
    color: #94A3B8;
    font-size: 13px;
    font-weight: 500;
  }
  .google-login-btn {
    width: 100%;
    padding: 14px 20px;
    border: 1.5px solid #E2E8F0;
    border-radius: 12px;
    background: white;
    color: #1E293B;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    margin-bottom: 24px;
  }
  .google-login-btn:hover {
    background: #F8FAFC;
    border-color: #CBD5E1;
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  }
  .google-icon {
    width: 20px;
    height: 20px;
  }

  /* 레이아웃 */
  .dashboard-layout { display: flex; height: 100vh; width: 100vw; }
  
  /* 사이드바 */
  .sidebar { 
    width: 260px; 
    background: #1E293B; 
    color: white;
    display: flex; 
    flex-direction: column; 
    justify-content: space-between; 
    z-index: 10; 
    border-right: 1px solid #334155;
  }
  .logo-area { 
    height: 64px;
    display: flex; 
    align-items: center; 
    padding: 0 24px;
    font-size: 18px; 
    font-weight: 700; 
    color: white; 
    border-bottom: 1px solid #334155;
    letter-spacing: -0.5px;
    gap: 8px;
  }
  .nav-menu { padding: 24px 16px; display: flex; flex-direction: column; gap: 4px; }
  .nav-header { 
    font-size: 11px; 
    text-transform: uppercase; 
    letter-spacing: 0.05em; 
    color: #94A3B8; 
    margin: 24px 0 8px 12px; 
    font-weight: 600;
  }
  .nav-item { 
    text-decoration: none; 
    padding: 10px 16px; 
    border-radius: 8px; 
    color: #CBD5E1; 
    font-weight: 500; 
    font-size: 14px; 
    transition: all 0.2s ease; 
    display: flex; 
    align-items: center; 
    gap: 12px; 
    cursor: pointer; 
  }
  .nav-item:hover { background-color: #334155; color: white; }
  .nav-item.active { 
    background-color: #4F46E5; 
    color: white; 
    font-weight: 600;
    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  }
  
  .logout-btn { 
    margin: 16px;
    background: #334155; 
    border: none; 
    padding: 12px; 
    color: #F87171; 
    font-weight: 600; 
    font-size: 14px; 
    cursor: pointer; 
    border-radius: 8px; 
    display: flex; 
    align-items: center; 
    justify-content: center;
    gap: 8px; 
    transition: 0.2s;
  }
  .logout-btn:hover { background-color: #475569; }
  
  .sync-btn { 
    width: 100%; 
    padding: 10px; 
    margin-bottom: 8px; 
    background-color: #334155; 
    border: 1px solid #475569;
    border-radius: 8px; 
    color: white; 
    font-size: 13px;
    font-weight: 600; 
    cursor: pointer; 
    transition: 0.2s; 
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }
  .sync-btn:hover { background-color: #475569; border-color: #64748B; }
  .sync-btn.primary { background-color: #4F46E5; border-color: #4338CA; }
  .sync-btn.primary:hover { background-color: #4338CA; }

  /* 메인 컨텐츠 */
  .main-content { flex: 1; overflow-y: auto; padding: 32px 40px; }
  .dashboard-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; }
  .page-title { font-size: 24px; font-weight: 700; color: #0F172A; letter-spacing: -0.5px; }

  /* 테이블 */
  .table-card { background: white; border-radius: 12px; box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06); margin-bottom: 24px; overflow: hidden; border: 1px solid #E2E8F0; }
  .table-full { width: 100%; border-collapse: collapse; }
  .table-full th { 
    text-align: left; 
    padding: 16px 24px; 
    background: #F8FAFC; 
    font-size: 12px; 
    color: #64748B; 
    font-weight: 600; 
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-bottom: 1px solid #E2E8F0;
  }
  .table-full td { 
    padding: 16px 24px; 
    font-size: 14px; 
    color: #334155;
    border-bottom: 1px solid #F1F5F9; 
  }
  .table-full tr:last-child td { border-bottom: none; }
  .table-full tr:hover td { background-color: #F8FAFC; }

  /* KPI Grid */
  .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 24px; margin-bottom: 32px; }
  .kpi-card { 
    background: white; 
    padding: 24px; 
    border-radius: 12px; 
    box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06); 
    border: 1px solid #E2E8F0;
    display: flex; 
    flex-direction: column; 
    justify-content: center; 
  }
  .kpi-label { font-size: 13px; color: #64748B; font-weight: 600; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em; }
  .kpi-value { font-size: 28px; font-weight: 700; color: #0F172A; letter-spacing: -0.5px; }
  .kpi-sub { font-size: 13px; margin-top: 8px; color: #64748B; display: flex; align-items: center; gap: 4px; }
  .trend-up { color: #10B981; font-weight: 600; }
  .trend-down { color: #EF4444; font-weight: 600; }

  /* 입력폼 */
  .input-card { background: white; padding: 32px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border: 1px solid #E2E8F0; margin-bottom: 24px; }
  .form-label { font-size: 14px; font-weight: 600; margin-bottom: 8px; display: block; color: #334155; }
  .form-input, .form-select { 
    width: 100%; 
    padding: 10px 14px; 
    border-radius: 8px; 
    border: 1px solid #CBD5E1; 
    font-size: 14px; 
    color: #0F172A;
    margin-bottom: 20px; 
    transition: 0.2s;
  }
  .form-input:focus, .form-select:focus { border-color: #4F46E5; outline: none; ring: 2px solid #C7D2FE; }
  
  .btn-primary { 
    width: 100%; 
    padding: 12px; 
    background-color: #4F46E5; 
    border-radius: 8px; 
    border: none; 
    color: white; 
    font-size: 14px; 
    font-weight: 600; 
    cursor: pointer; 
    transition: 0.2s; 
  }
  .btn-primary:hover { background-color: #4338CA; }
  
  /* 차트 카드 */
  .chart-card { background: white; padding: 24px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border: 1px solid #E2E8F0; margin-bottom: 32px; }
  .chart-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
  .chart-title { font-size: 16px; font-weight: 700; color: #0F172A; }
  .chart-subtitle { font-size: 13px; color: #64748B; margin-top: 4px; }
  
  /* Tags & Badges */
  .tag { padding: 4px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; }
  .tag-success { background: #DCFCE7; color: #166534; }
  .tag-warning { background: #FEF3C7; color: #92400E; }
  .tag-error { background: #FEE2E2; color: #991B1B; }
  .tag-blue { background: #DBEAFE; color: #1E40AF; }
  
  /* Platform Labels */
  .pf-airbnb { color: #FF385C; font-weight: 600; }
  .pf-booking { color: #003580; font-weight: 600; }

  /* Common Utilities */
  .flex-center { display: flex; align-items: center; justify-content: center; }
  .flex-between { display: flex; align-items: center; justify-content: space-between; }
  
  /* Modal */
  .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(4px); display: flex; justify-content: center; align-items: center; z-index: 50; }
  .modal-content { background: white; width: 100%; max-width: 520px; border-radius: 16px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04); overflow: hidden; animation: slideUp 0.3s ease-out; }
  .modal-header { padding: 20px 24px; border-bottom: 1px solid #E2E8F0; display: flex; justify-content: space-between; align-items: center; background: #F8FAFC; }
  .modal-title { font-size: 16px; font-weight: 700; color: #0F172A; }
  
  /* 모바일 반응형 */
  /* Mobile Utilities */
  @media (max-width: 768px) {
    .sidebar { display: none; }
    .main-content { padding: 16px; }
    .kpi-grid { grid-template-columns: 1fr; }
    .charts-grid { grid-template-columns: 1fr; }
    
    .desktop-only { display: none !important; }
    .mobile-only { display: block !important; }
    
    /* 모바일에서는 테이블 대신 카드 뷰를 사용하므로 테이블 숨김 처리 가능 */
    .table-responsive { overflow-x: auto; }
  }

  /* -------------------------------------------------------------------------- */
  /* [NEW] Global Responsive System (New Standard) */
  /* -------------------------------------------------------------------------- */
  
  /* 1. Responsive Grid System */
  /* 1. Responsive Grid System */
  .responsive-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 24px;
    width: 100%;
  }

  .responsive-two-column {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
  }

  /* 2. Responsive Table Wrapper */
  .responsive-table-container {
    width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  /* 3. Mobile Card System (Native Look) */
  .mobile-card-list {
    display: none;
    flex-direction: column;
    gap: 16px;
    padding: 4px 0;
  }
  
  .mobile-card-item {
    background: #FFFFFF;
    border: none;
    border-radius: 16px; /* Native roundness */
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.03);
    transition: transform 0.2s cubic-bezier(0.18, 0.89, 0.32, 1.28);
  }
  
  .mobile-card-item:active {
    transform: scale(0.98); /* Native press effect */
    background-color: #F8FAFC;
  }

  .mobile-card-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 14px;
  }
  
  .mobile-label { color: #64748B; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.02em; }
  .mobile-value { color: #1E293B; font-weight: 600; font-size: 15px; }

  /* 4. Common Typography Utilities */
  .text-title { font-size: 20px; font-weight: 700; color: #111827; letter-spacing: -0.5px; }
  .text-subtitle { font-size: 14px; color: #6B7280; margin-top: 4px; }
  
  /* 5. Mobile Override Media Query */
  @media (max-width: 768px) {
    /* Layout Adjustments */
    .dashboard-layout { flex-direction: column; }
    .main-content { 
      padding: 16px; 
      padding-top: calc(16px + env(safe-area-inset-top, 0px));
      padding-bottom: calc(85px + env(safe-area-inset-bottom, 0px)); /* Account for Bottom NavBar */
      width: 100vw; 
      height: 100vh; 
      overflow-x: hidden; 
      overflow-y: auto;
    }
    
    /* Grid Transforms */
    .responsive-grid { grid-template-columns: 1fr; gap: 16px; }
    .responsive-two-column { grid-template-columns: 1fr; gap: 16px; }
    
    /* Table to Card Transformation */
    .pc-table-view { display: none !important; }
    .mobile-card-list { display: flex !important; }

    /* Typography Adjustments */
    .page-title { font-size: 22px; font-weight: 800; }
    .kpi-value { font-size: 28px; }
    
    /* Input/Button Adjustments */
    .btn-primary { width: 100%; justify-content: center; padding: 14px; border-radius: 14px; font-weight: 700; }
    .form-input, .form-select { font-size: 16px; padding: 14px; border-radius: 12px; }
    
    /* Hide Sidebars/Desktop Elements */
    .desktop-only { display: none !important; }
  }
`;

// --- Inject style block ---
const styleSheet = document.createElement("style");
styleSheet.innerText = styles;
document.head.appendChild(styleSheet);

// --------------------------------------------------------------------------
// [IMPORTED COMPONENTS]
// --------------------------------------------------------------------------
// (Imports moved to top of file)

// ==============================
// 건물·객실 데이터 (중앙 관리 — import는 파일 상단)
// ==============================
// App.jsx 전용 객실 데이터 (매출 분석용 — BUILDING_DATA와 다른 형태)
const BUILDING_DATA = {
  "아라키초A": ["201호", "202호", "301호", "302호", "401호", "402호", "501호", "502호", "602호", "701호", "702호"],
  "아라키초B": ["101호", "102호", "201호", "202호", "301호", "302호", "401호", "402호"],
  "다이쿄초": ["B01호", "B02호", "101호", "102호", "201호", "202호", "302호"],
  "가부키초": ["202호", "203호", "302호", "303호", "402호", "403호", "502호", "603호", "802호", "803호"],
  "오쿠보A동": ["오쿠보A"],
  "오쿠보B동": ["오쿠보B"],
  "오쿠보C동": ["오쿠보C"],
  "사노시": ["사노"],
  "다카다노바바": ["201호", "301호", "401호", "501호", "601호", "701호", "801호", "901호"]
};

// ==============================
// 로그인 컴포넌트
// ==============================
// ==============================
// 🔐 New Login Screen Wrapper
// ==============================
// This wrapper ensures we use the new Enterprise Login Screen while keeping prop compatibility
function LoginPage({ incompleteSignup }) {
  return <LoginScreen incompleteSignup={incompleteSignup} />;
}

// ==============================
// 메뉴 데이터 (공통)
// ==============================
const MENU_ITEMS = [
  { path: "/", label: "Today's Summary", icon: "📅", mobileIcon: "📅" },
  { path: "/performance", label: "Bookings", icon: "📊", mobileIcon: "📊" },
  { path: "/revenue", label: "Revenue Dashboard", icon: "💰", mobileIcon: "💰" },
  { path: "/sales-log", label: "Revenue Analytics", icon: "📊", mobileIcon: "📊" },
  { path: "/daily-log", label: "Daily Log", icon: "📈", mobileIcon: "📈" },
  { path: "/calendar", label: "Calendar", icon: "🗓️", mobileIcon: "🗓️" },
  { path: "/occupancy", label: "Occupancy", icon: "🛏️", mobileIcon: "🛏️" },
  { path: "/occupancy-rate", label: "Occupancy Rate", icon: "📈", mobileIcon: "📈" },
  { path: "/room-performance", label: "Room Perf.", icon: "🎯", mobileIcon: "🎯" },
  { path: "/country", label: "Nationality", icon: "🌍", mobileIcon: "🌍" },
  { path: "/arrivals", label: "In/Out", icon: "🚪", mobileIcon: "🚪" },
  { path: "/cleaning", label: "Cleaning", icon: "🧹", mobileIcon: "🧹" },
  { path: "/room-links", label: "Room Links", icon: "🔗", mobileIcon: "🔗" },
  { path: "/customers", label: "Guest List", icon: "👥", mobileIcon: "👥" },
];

// ==============================
// 모바일 헤더 컴포넌트
// ==============================
// eslint-disable-next-line no-unused-vars
function MobileHeader({ onMenuClick, currentPath }) {
  const currentMenu = MENU_ITEMS.find(m => m.path === currentPath);

  return (
    <header className="mobile-header">
      <div className="mobile-header-left">
        <span className="mobile-header-icon">{currentMenu?.icon || "🏨"}</span>
        <span className="mobile-header-title">{currentMenu?.label || "Haru Studio"}</span>
      </div>
      <button className="mobile-menu-btn" onClick={onMenuClick}>
        <span className="hamburger-icon">
          <span></span>
          <span></span>
          <span></span>
        </span>
      </button>
    </header>
  );
}

// ==============================
// 모바일 슬라이드 메뉴 컴포넌트
// ==============================
// eslint-disable-next-line no-unused-vars
function MobileMenu({ isOpen, onClose, onSync, currentPath }) {
  const navigate = useNavigate();

  const handleNavClick = (path) => {
    navigate(path);
    onClose();
  };

  const logout = () => {
    if (window.confirm("로그아웃 하시겠습니까?")) {
      signOut(auth);
    }
  };

  return (
    <>
      {/* 오버레이 */}
      <div
        className={`mobile-menu-overlay ${isOpen ? 'open' : ''}`}
        onClick={onClose}
      />

      {/* 슬라이드 메뉴 */}
      <div className={`mobile-menu-drawer ${isOpen ? 'open' : ''}`}>
        <div className="mobile-menu-header">
          <div className="mobile-menu-logo">
            <span>🏨</span>
            <span>Haru Studio</span>
          </div>
          <button className="mobile-menu-close" onClick={onClose}>×</button>
        </div>

        <div className="mobile-menu-content">
          <nav className="mobile-nav-list">
            {MENU_ITEMS.map((item) => (
              <div
                key={item.path}
                onClick={() => handleNavClick(item.path)}
                className={`mobile-nav-item ${currentPath === item.path ? 'active' : ''}`}
              >
                <span className="mobile-nav-icon">{item.icon}</span>
                <span className="mobile-nav-label">{item.label}</span>
                {currentPath === item.path && <span className="mobile-nav-active-dot" />}
              </div>
            ))}
          </nav>
        </div>

        <div className="mobile-menu-footer">
          <button className="mobile-sync-btn" onClick={() => { onSync(false); onClose(); }}>
            🔄 변경분 Sync
          </button>
          <button className="mobile-sync-btn secondary" onClick={() => { onSync(true); onClose(); }}>
            📦 전체 재대사 (2023~)
          </button>
          <button className="mobile-logout-btn" onClick={logout}>
            🔓 Sign Out
          </button>
        </div>
      </div>
    </>
  );
}

// ==============================
// Sidebar 컴포넌트 (PC 전용)
// ==============================
// eslint-disable-next-line no-unused-vars
function Sidebar({ onSync, syncing }) {
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = location.pathname;

  const logout = () => {
    if (window.confirm("로그아웃 하시겠습니까?")) {
      signOut(auth);
    }
  };

  return (
    <div className="sidebar desktop-only">
      <div>
        <div className="logo-area" style={{ marginBottom: "10px" }}>
          <span>🏨</span> Haru Studio
        </div>
        <div style={{ fontSize: "10px", color: "#FF3B30", paddingLeft: "10px", marginBottom: "30px", fontWeight: "bold" }}>
          v2026.02.02 (ENTERPRISE)
        </div>

        <button className="sync-btn" onClick={() => onSync(false)} disabled={syncing}>
          {syncing ? '⏳ Syncing...' : '🔄 변경분 Sync'}
        </button>
        <button className="sync-btn" onClick={() => onSync(true)} disabled={syncing} style={{ marginTop: '4px', fontSize: '11px', opacity: 0.8 }}>
          📦 전체 재대사 (2023~)
        </button>

        <nav className="nav-menu">
          {MENU_ITEMS.map((item) => (
            <div
              key={item.path}
              onClick={() => navigate(item.path)}
              className={
                "nav-item " + (currentPath === item.path ? "active" : "")
              }
            >
              <span>{item.icon}</span> {item.label}
            </div>
          ))}
        </nav>
      </div>

      <div>
        <button className="logout-btn" onClick={logout}>
          🔓 Sign Out
        </button>
      </div>
    </div>
  );
}

// ==============================
// 상세 모달 (Premium Design)
// ==============================
function DetailModal({ title, data, onClose }) {
  if (!data) return null;

  // Format guest name
  const formatGuestName = (item) => item.guestName || "Guest";

  // Format date nicely
  const formatDate = (dateStr) => {
    if (!dateStr) return "-";
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0, 0, 0, 0.5)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "20px"
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "white",
          borderRadius: "24px",
          width: "100%",
          maxWidth: "520px",
          maxHeight: "85vh",
          overflow: "hidden",
          boxShadow: "0 25px 80px rgba(0, 0, 0, 0.25)"
        }}
      >
        {/* Header */}
        <div style={{
          background: "linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)",
          padding: "24px 28px",
          position: "relative"
        }}>
          <button
            onClick={onClose}
            style={{
              position: "absolute",
              top: "16px",
              right: "16px",
              width: "32px",
              height: "32px",
              borderRadius: "50%",
              border: "none",
              background: "rgba(255,255,255,0.2)",
              color: "white",
              fontSize: "20px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background 0.2s"
            }}
          >
            ×
          </button>
          <h2 style={{
            color: "white",
            fontSize: "20px",
            fontWeight: "700",
            margin: "0 0 8px 0"
          }}>
            Reservation Details
          </h2>
          <p style={{
            color: "rgba(255,255,255,0.85)",
            fontSize: "14px",
            margin: 0
          }}>
            {title}
          </p>
          <div style={{
            display: "flex",
            gap: "12px",
            marginTop: "16px"
          }}>
            <div style={{
              background: "rgba(255,255,255,0.15)",
              padding: "8px 16px",
              borderRadius: "10px",
              color: "white",
              fontSize: "13px",
              fontWeight: "600"
            }}>
              {data.length} Reservation{data.length !== 1 ? 's' : ''}
            </div>
          </div>
        </div>

        {/* Content */}
        <div style={{
          padding: "20px",
          maxHeight: "calc(85vh - 140px)",
          overflowY: "auto"
        }}>
          {data.length === 0 ? (
            <div style={{
              textAlign: "center",
              padding: "40px 20px",
              color: "#9CA3AF"
            }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" strokeWidth="1.5" style={{ marginBottom: "12px" }}>
                <circle cx="12" cy="12" r="10" />
                <path d="M8 15s1.5-2 4-2 4 2 4 2" />
                <line x1="9" y1="9" x2="9.01" y2="9" />
                <line x1="15" y1="9" x2="15.01" y2="9" />
              </svg>
              <p style={{ fontSize: "15px", margin: 0 }}>No reservations found</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {data.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    background: "#F9FAFB",
                    borderRadius: "16px",
                    padding: "18px",
                    border: "1px solid #F3F4F6",
                    transition: "all 0.2s"
                  }}
                >
                  {/* Guest Name & Platform */}
                  <div style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    marginBottom: "14px"
                  }}>
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px"
                    }}>
                      <div style={{
                        width: "36px",
                        height: "36px",
                        borderRadius: "10px",
                        background: item.platform?.toLowerCase().includes('booking')
                          ? "linear-gradient(135deg, #003580 0%, #00224F 100%)"
                          : "linear-gradient(135deg, #FF385C 0%, #E31C5F 100%)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "white",
                        fontSize: "14px",
                        fontWeight: "700"
                      }}>
                        {item.platform?.toLowerCase().includes('booking') ? 'B' : 'A'}
                      </div>
                      <div>
                        <div style={{
                          fontWeight: "600",
                          fontSize: "15px",
                          color: "#111827"
                        }}>
                          {formatGuestName(item)}
                        </div>
                        <div style={{
                          fontSize: "12px",
                          color: "#6B7280"
                        }}>
                          {item.platform || "Unknown Platform"}
                        </div>
                      </div>
                    </div>
                    <span style={{
                      fontSize: "11px",
                      fontWeight: "600",
                      color: "#6B7280",
                      background: "#E5E7EB",
                      padding: "4px 10px",
                      borderRadius: "6px"
                    }}>
                      #{idx + 1}
                    </span>
                  </div>

                  {/* Date Info Grid */}
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "12px"
                  }}>
                    <div style={{
                      background: "white",
                      padding: "12px",
                      borderRadius: "10px",
                      border: "1px solid #E5E7EB"
                    }}>
                      <div style={{
                        fontSize: "11px",
                        color: "#9CA3AF",
                        fontWeight: "500",
                        marginBottom: "4px",
                        textTransform: "uppercase",
                        letterSpacing: "0.5px"
                      }}>
                        Stay Month
                      </div>
                      <div style={{
                        fontSize: "15px",
                        fontWeight: "700",
                        color: "#3B82F6"
                      }}>
                        {item.stayMonth || "-"}
                      </div>
                    </div>
                    <div style={{
                      background: "white",
                      padding: "12px",
                      borderRadius: "10px",
                      border: "1px solid #E5E7EB"
                    }}>
                      <div style={{
                        fontSize: "11px",
                        color: "#9CA3AF",
                        fontWeight: "500",
                        marginBottom: "4px",
                        textTransform: "uppercase",
                        letterSpacing: "0.5px"
                      }}>
                        Booked On
                      </div>
                      <div style={{
                        fontSize: "15px",
                        fontWeight: "600",
                        color: "#374151"
                      }}>
                        {formatDate(item.bookDate || item.date)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "16px 20px",
          borderTop: "1px solid #F3F4F6",
          background: "#FAFAFA"
        }}>
          <button
            onClick={onClose}
            style={{
              width: "100%",
              padding: "14px",
              background: "linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)",
              color: "white",
              border: "none",
              borderRadius: "12px",
              fontSize: "15px",
              fontWeight: "600",
              cursor: "pointer",
              boxShadow: "0 4px 12px rgba(59, 130, 246, 0.3)",
              transition: "all 0.2s"
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ==============================
// 고객 상세 정보 모달
// ==============================
function DeprecatedGuestDetailModal({ guest, onClose }) {
  if (!guest) return null;

  const formatPrice = (price) => {
    if (!price) return "¥0";
    const num = parseFloat(String(price).replace(/[^0-9.-]+/g, ""));
    if (isNaN(num)) return "¥0";
    return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(num);
  };

  const InfoRow = ({ label, value, icon }) => (
    <div style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "14px 0",
      borderBottom: "1px solid #F2F2F7"
    }}>
      <span style={{ color: "#86868B", fontSize: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
        <span>{icon}</span> {label}
      </span>
      <span style={{ fontWeight: "600", fontSize: "14px", color: value ? "#1D1D1F" : "#CCC", maxWidth: "60%", textAlign: "right", wordBreak: "break-word" }}>
        {value || "정보 없음"}
      </span>
    </div>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "480px" }}>
        <div className="modal-header" style={{ borderBottom: "none", paddingBottom: "0" }}>
          <div>
            <div className="modal-title" style={{ fontSize: "22px" }}>고객 상세 정보</div>
            <div style={{ fontSize: "13px", color: "#86868B", marginTop: "4px" }}>{guest.building} {guest.room}</div>
          </div>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        {/* 고객 기본 정보 카드 */}
        <div style={{
          background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
          borderRadius: "16px",
          padding: "20px",
          marginBottom: "20px",
          color: "white"
        }}>
          <div style={{ fontSize: "20px", fontWeight: "700", marginBottom: "8px" }}>
            {guest.guestName || "(이름 없음)"}
          </div>
          <div style={{ display: "flex", gap: "16px", fontSize: "13px", opacity: "0.9" }}>
            <span>성인 {guest.numAdult || 0}명</span>
            <span>아동 {guest.numChild || 0}명</span>
            <span>{guest.platform}</span>
          </div>
        </div>

        {/* 상세 정보 */}
        <div style={{ maxHeight: "350px", overflowY: "auto" }}>
          <InfoRow icon="📧" label="이메일" value={guest.guestEmail} />
          <InfoRow icon="📞" label="전화번호" value={guest.guestPhone} />
          <InfoRow icon="🌍" label="국가" value={guest.guestCountry} />
          <InfoRow icon="🏠" label="주소" value={guest.guestAddress ? `${guest.guestAddress}${guest.guestCity ? `, ${guest.guestCity}` : ""}` : ""} />
          <InfoRow icon="🕐" label="도착 예정 시간" value={guest.arrivalTime} />
          <InfoRow icon="📅" label="체크인" value={guest.arrival} />
          <InfoRow icon="📅" label="체크아웃" value={guest.departure} />
          <InfoRow icon="🌙" label="숙박일수" value={guest.nights ? `${guest.nights}박` : ""} />
          <InfoRow icon="💰" label="총 금액" value={formatPrice(guest.totalPrice || guest.price)} />

          {/* 고객 코멘트 */}
          <div style={{ marginTop: "16px" }}>
            <div style={{ color: "#86868B", fontSize: "14px", marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
              <span>💬</span> 고객 코멘트 / 메모
            </div>
            <div style={{
              background: "#F9F9F9",
              padding: "14px",
              borderRadius: "12px",
              fontSize: "14px",
              color: guest.guestComments ? "#1D1D1F" : "#CCC",
              minHeight: "60px",
              lineHeight: "1.5"
            }}>
              {guest.guestComments || "코멘트 없음"}
            </div>
          </div>
        </div>

        {/* 닫기 버튼 */}
        <button
          onClick={onClose}
          style={{
            width: "100%",
            padding: "14px",
            marginTop: "20px",
            background: "#0071E3",
            color: "white",
            border: "none",
            borderRadius: "12px",
            fontSize: "16px",
            fontWeight: "600",
            cursor: "pointer"
          }}
        >
          닫기
        </button>
      </div>
    </div>
  );
}

// ==============================
// 📊 Performance Dashboard (예약 접수 실적)
// ==============================
function PerformanceDashboard({ targetMonth, setTargetMonth, companyId }) {
  const [viewMode, setViewMode] = useState("confirmed");
  const [data, setData] = useState({ total: 0, buildings: [], platforms: [], roomStats: {}, okuboTotal: 0 });
  const [modalData, setModalData] = useState(null);
  const [modalTitle, setModalTitle] = useState("");

  const fetchData = async () => {
    console.log(`🚀 [VERSION 2026-02-02-Fix-v5] Fetching Dashboard: ${targetMonth}, ${viewMode}`);

    if (!companyId) {
      console.warn('⚠️ No companyId for PerformanceDashboard');
      return;
    }

    // Firestore 쿼리 최적화: status로 먼저 필터링
    // ★ Cancelled 모드: "cancelled"와 "blackout" 둘 다 가져오기 (블락/점검 키워드 포함)
    let q;
    if (viewMode === "cancelled") {
      q = query(
        collection(db, "reservations"),
        where("companyId", "==", companyId),
        where("status", "in", ["cancelled", "blackout"])
      );
    } else {
      q = query(
        collection(db, "reservations"),
        where("companyId", "==", companyId),
        where("status", "==", "confirmed")
      );
    }

    const snapshot = await getDocs(q);
    console.log(`📦 Total ${viewMode} reservations in Firestore: ${snapshot.docs.length}`);

    // 클라이언트에서 날짜 필터링 (중복 제거 없이 모든 데이터 포함)
    const allData = snapshot.docs.map((doc) => doc.data());

    // ★ Helper: 날짜(YYYY-MM) 추출 함수 (String, Timestamp, Date 모두 지원)
    const getYearMonth = (val) => {
      try {
        if (!val) return null;
        if (typeof val === 'string') return val.substring(0, 7);
        if (val.toDate && typeof val.toDate === 'function') { // Firestore Timestamp
          const d = val.toDate();
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          return `${y}-${m}`;
        }
        if (val instanceof Date) {
          const y = val.getFullYear();
          const m = String(val.getMonth() + 1).padStart(2, '0');
          return `${y}-${m}`;
        }
      } catch (e) {
        console.error("Date parsing error:", val, e);
      }
      return null;
    };

    // ★ 디버깅: 1월과 2월 취소 데이터 비교
    if (viewMode === "cancelled" && allData.length > 0) {
      console.log(`🔍 전체 취소 예약: ${allData.length}건`);

      // 1월 샘플
      const data202601 = allData.filter(r => (getYearMonth(r.cancelTime) || getYearMonth(r.modified) || getYearMonth(r.updatedAt)) === '2026-01');
      console.log(`🔍 2026-01월 취소: ${data202601.length}건`);

      // 2월 검색
      const data202602 = allData.filter(r => (getYearMonth(r.cancelTime) || getYearMonth(r.modified) || getYearMonth(r.updatedAt)) === '2026-02');
      console.log(`🔍 2026-02월 취소: ${data202602.length}건`);

      if (data202602.length > 0) {
        console.log(`  2월 샘플 (처음 3건):`);
        data202602.slice(0, 3).forEach((r, idx) => {
          console.log(`    [${idx + 1}] cancelTime: '${r.cancelTime}' modified: '${r.modified}' updatedAt: '${r.updatedAt}' => Parsed: ${getYearMonth(r.cancelTime) || getYearMonth(r.modified) || getYearMonth(r.updatedAt)}`);
        });
      }
    }

    const reservations = allData.filter((r) => {
      // ★ Cancelled 모드: 취소일(cancelTime) 기준으로 필터링
      // ★ Cancelled 모드: 취소일(cancelTime) 기준으로 필터링
      if (viewMode === "cancelled") {
        // [User Request]: 필터링 없애고 다 가져와서 날짜 맞으면 넣어라.
        // 1순위: cancelTime (API 원본)
        // 2순위: modified (수정일)
        // 3순위: updatedAt (시스템 동기화 시간)
        const cVal = getYearMonth(r.cancelTime);
        const mVal = getYearMonth(r.modified);
        const uVal = getYearMonth(r.updatedAt);

        const ym = cVal || mVal || uVal;

        // ★ 날짜가 2026-02와 하나라도 맞으면 무조건 통과
        if (ym === targetMonth) return true;

        // ★ 날짜가 아예 없는 '미아 데이터'도, 혹시 모르니 일단 통과시켜 로그에라도 뜨게 함 (UI상에서는 날짜 없음으로 표시되더라도)
        // 단, 너무 옛날 데이터가 섞이는 걸 막기 위해, targetMonth가 현재 달(2026-02)인 경우에만 미아 데이터 허용
        if (!ym && targetMonth === '2026-02') {
          // console.log(`⚠️ Force Include (No Date): ${r.id}`);
          return true;
        }

        return false;
      }
      // ★ Confirmed 모드: 예약일(bookDate) 기준으로 필터링
      else {
        const bookTime = r.bookDate || r.bookingTime || r.firstNight || '';
        if (bookTime && typeof bookTime === 'string') {
          return bookTime.startsWith(targetMonth);
        }
        return false;
      }
    });

    console.log(`📅 ${targetMonth}월 ${viewMode} 필터링 결과: ${reservations.length}건 (전체: ${allData.length}건)`);

    let total = 0;
    const bCount = {};
    const pCount = { Airbnb: 0, Booking: 0 };
    const rStats = {};

    Object.keys(BUILDING_DATA).forEach((b) => {
      rStats[b] = {};
      BUILDING_DATA[b].forEach((r) => {
        rStats[b][r] = { total: 0, airbnb: 0, booking: 0, airbnbList: [], bookingList: [] };
      });
    });

    reservations.forEach((r) => {
      if (!rStats[r.building]) rStats[r.building] = {};
      if (!rStats[r.building][r.room])
        rStats[r.building][r.room] = { total: 0, airbnb: 0, booking: 0, airbnbList: [], bookingList: [] };

      total++;
      bCount[r.building] = (bCount[r.building] || 0) + 1;

      const platformName = r.platform ? r.platform.toLowerCase() : "";
      if (platformName.includes("booking")) {
        pCount.Booking++;
      } else {
        pCount.Airbnb++;
      }

      rStats[r.building][r.room].total++;

      if (platformName.includes("booking")) {
        rStats[r.building][r.room].booking++;
        rStats[r.building][r.room].bookingList.push(r);
      } else {
        rStats[r.building][r.room].airbnb++;
        rStats[r.building][r.room].airbnbList.push(r);
      }
    });

    const okuboTotal = (bCount["오쿠보A동"] || 0) + (bCount["오쿠보B동"] || 0) + (bCount["오쿠보C동"] || 0);

    const buildingChartData = Object.keys(bCount)
      .map((key) => ({ name: key, count: bCount[key] }))
      .sort((a, b) => b.count - a.count);

    const platformChartData = [
      { name: "Airbnb", value: pCount.Airbnb },
      { name: "Booking", value: pCount.Booking }
    ];

    setData({ total, buildings: buildingChartData, platforms: platformChartData, roomStats: rStats, okuboTotal });
  };

  useEffect(() => {
    if (companyId) {
      fetchData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, targetMonth, viewMode]);

  const handleNumberClick = (title, list) => {
    if (list && list.length > 0) {
      setModalTitle(title);
      setModalData(list);
    }
  };

  const THEME_COLOR = viewMode === "confirmed" ? "#3B82F6" : "#EF4444";
  const THEME_GRADIENT = viewMode === "confirmed"
    ? "linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)"
    : "linear-gradient(135deg, #EF4444 0%, #DC2626 100%)";
  const PIE_COLORS = ["#FF385C", "#003580"];

  const getBuildingEN = (name) => _BUILDING_NAMES_EN_CENTRAL[name] || name;

  // Room name mapping for special cases
  const ROOM_NAMES_EN = {
    "오쿠보A": "Okubo A",
    "오쿠보B": "Okubo B",
    "오쿠보C": "Okubo C",
    "사노": "Sano House"
  };

  const getRoomEN = (room) => {
    if (ROOM_NAMES_EN[room]) return ROOM_NAMES_EN[room];
    if (room?.endsWith('호')) return `Room ${room.replace('호', '')}`;
    return room;
  };

  // Calculate percentages
  const airbnbCount = data.platforms[0]?.value || 0;
  const bookingCount = data.platforms[1]?.value || 0;
  const airbnbPercent = data.total > 0 ? ((airbnbCount / data.total) * 100).toFixed(1) : 0;
  const bookingPercent = data.total > 0 ? ((bookingCount / data.total) * 100).toFixed(1) : 0;

  // Transform building data for chart with English names
  const buildingsEN = data.buildings.map(b => ({
    ...b,
    nameEN: getBuildingEN(b.name)
  }));

  return (
    <div style={{
      padding: "32px",
      background: "linear-gradient(180deg, #F8FAFC 0%, #FFFFFF 100%)",
      minHeight: "100vh"
    }}>
      {/* Premium Header */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        marginBottom: "32px",
        flexWrap: "wrap",
        gap: "20px"
      }}>
        <div>
          <h1 style={{
            fontSize: "32px",
            fontWeight: "800",
            color: "#111827",
            margin: "0 0 8px 0",
            letterSpacing: "-0.5px"
          }}>
            {viewMode === "confirmed" ? "Reservation Performance" : "Cancellation Report"}
          </h1>
          <p style={{
            fontSize: "15px",
            color: "#6B7280",
            margin: 0
          }}>
            {viewMode === "confirmed"
              ? "Track your booking performance across all properties"
              : "Monitor cancellation trends and patterns"}
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
          {/* View Mode Toggle */}
          <div style={{
            display: "flex",
            background: "#F3F4F6",
            borderRadius: "12px",
            padding: "4px",
            gap: "4px"
          }}>
            <button
              onClick={() => setViewMode("confirmed")}
              style={{
                padding: "10px 20px",
                borderRadius: "10px",
                border: "none",
                background: viewMode === "confirmed" ? "white" : "transparent",
                color: viewMode === "confirmed" ? "#3B82F6" : "#6B7280",
                fontWeight: "600",
                fontSize: "14px",
                cursor: "pointer",
                boxShadow: viewMode === "confirmed" ? "0 2px 8px rgba(0,0,0,0.08)" : "none",
                transition: "all 0.2s"
              }}
            >
              Active Bookings
            </button>
            <button
              onClick={() => setViewMode("cancelled")}
              style={{
                padding: "10px 20px",
                borderRadius: "10px",
                border: "none",
                background: viewMode === "cancelled" ? "white" : "transparent",
                color: viewMode === "cancelled" ? "#EF4444" : "#6B7280",
                fontWeight: "600",
                fontSize: "14px",
                cursor: "pointer",
                boxShadow: viewMode === "cancelled" ? "0 2px 8px rgba(0,0,0,0.08)" : "none",
                transition: "all 0.2s"
              }}
            >
              Cancelled
            </button>
          </div>

          {/* Premium Custom Date Picker */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            background: "white",
            padding: "10px 16px",
            borderRadius: "14px",
            border: "1px solid #E5E7EB",
            boxShadow: "0 4px 12px rgba(0,0,0,0.06)"
          }}>
            <div style={{
              width: "40px",
              height: "40px",
              background: THEME_GRADIENT,
              borderRadius: "12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: `0 4px 12px ${viewMode === "confirmed" ? "rgba(59,130,246,0.3)" : "rgba(239,68,68,0.3)"}`
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "11px", color: "#9CA3AF", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Period
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <select
                  value={targetMonth.split('-')[1]}
                  onChange={(e) => {
                    const year = targetMonth.split('-')[0];
                    setTargetMonth(`${year}-${e.target.value}`);
                  }}
                  style={{
                    border: "none",
                    fontSize: "16px",
                    fontWeight: "700",
                    color: "#111827",
                    background: "transparent",
                    cursor: "pointer",
                    outline: "none",
                    padding: "0",
                    appearance: "none",
                    WebkitAppearance: "none"
                  }}
                >
                  <option value="01">01 January</option>
                  <option value="02">02 February</option>
                  <option value="03">03 March</option>
                  <option value="04">04 April</option>
                  <option value="05">05 May</option>
                  <option value="06">06 June</option>
                  <option value="07">07 July</option>
                  <option value="08">08 August</option>
                  <option value="09">09 September</option>
                  <option value="10">10 October</option>
                  <option value="11">11 November</option>
                  <option value="12">12 December</option>
                </select>
                <select
                  value={targetMonth.split('-')[0]}
                  onChange={(e) => {
                    const month = targetMonth.split('-')[1];
                    setTargetMonth(`${e.target.value}-${month}`);
                  }}
                  style={{
                    border: "none",
                    fontSize: "16px",
                    fontWeight: "700",
                    color: "#6B7280",
                    background: "transparent",
                    cursor: "pointer",
                    outline: "none",
                    padding: "0",
                    appearance: "none",
                    WebkitAppearance: "none"
                  }}
                >
                  <option value="2024">2024</option>
                  <option value="2025">2025</option>
                  <option value="2026">2026</option>
                  <option value="2027">2027</option>
                </select>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" style={{ marginLeft: "-4px" }}>
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>

      {modalData && <DetailModal title={modalTitle} data={modalData} onClose={() => setModalData(null)} />}

      {/* Premium KPI Cards */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: "20px",
        marginBottom: "32px"
      }}>
        {/* Total Card */}
        <div style={{
          background: "white",
          borderRadius: "20px",
          padding: "24px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
          border: "1px solid #F3F4F6",
          position: "relative",
          overflow: "hidden"
        }}>
          <div style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "4px",
            background: THEME_GRADIENT
          }} />
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
            <div>
              <p style={{ fontSize: "13px", color: "#6B7280", margin: "0 0 8px 0", fontWeight: "500" }}>
                {viewMode === "confirmed" ? "Total Bookings" : "Total Cancellations"}
              </p>
              <h2 style={{
                fontSize: "42px",
                fontWeight: "800",
                color: "#111827",
                margin: "0 0 8px 0",
                letterSpacing: "-1px"
              }}>
                {data.total}
              </h2>
              <span style={{
                fontSize: "12px",
                color: "#6B7280",
                background: "#F3F4F6",
                padding: "4px 10px",
                borderRadius: "6px",
                fontWeight: "500"
              }}>
                {viewMode === "confirmed" ? "Net Reservations" : "This Period"}
              </span>
            </div>
            <div style={{
              width: "56px",
              height: "56px",
              background: viewMode === "confirmed"
                ? "linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)"
                : "linear-gradient(135deg, #FEF2F2 0%, #FECACA 100%)",
              borderRadius: "16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={THEME_COLOR} strokeWidth="2">
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                <path d="M9 14l2 2 4-4" />
              </svg>
            </div>
          </div>
        </div>

        {/* Airbnb Card */}
        <div style={{
          background: "linear-gradient(135deg, #FFF5F7 0%, #FFF0F3 100%)",
          borderRadius: "20px",
          padding: "24px",
          boxShadow: "0 4px 20px rgba(255, 56, 92, 0.08)",
          border: "1px solid #FECDD3",
          position: "relative",
          overflow: "hidden"
        }}>
          <div style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "4px",
            background: "linear-gradient(135deg, #FF385C 0%, #E31C5F 100%)"
          }} />
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                <div style={{
                  width: "10px",
                  height: "10px",
                  borderRadius: "50%",
                  background: "#FF385C"
                }} />
                <p style={{ fontSize: "13px", color: "#6B7280", margin: 0, fontWeight: "500" }}>Airbnb</p>
              </div>
              <h2 style={{
                fontSize: "42px",
                fontWeight: "800",
                color: "#FF385C",
                margin: "0 0 8px 0",
                letterSpacing: "-1px"
              }}>
                {airbnbCount}
              </h2>
              <span style={{
                fontSize: "13px",
                color: "#FF385C",
                fontWeight: "600"
              }}>
                {airbnbPercent}% of total
              </span>
            </div>
            <div style={{
              width: "56px",
              height: "56px",
              background: "linear-gradient(135deg, #FF385C 0%, #E31C5F 100%)",
              borderRadius: "16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 4px 12px rgba(255, 56, 92, 0.3)"
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="white">
                <path d="M12 2C8.5 2 5.5 4.5 5.5 8c0 2.5 1.5 5 3.5 7.5 1 1.3 2 2.5 3 3.5 1-1 2-2.2 3-3.5 2-2.5 3.5-5 3.5-7.5 0-3.5-3-6-6.5-6z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Booking Card */}
        <div style={{
          background: "linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)",
          borderRadius: "20px",
          padding: "24px",
          boxShadow: "0 4px 20px rgba(0, 53, 128, 0.08)",
          border: "1px solid #BFDBFE",
          position: "relative",
          overflow: "hidden"
        }}>
          <div style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "4px",
            background: "linear-gradient(135deg, #003580 0%, #00224F 100%)"
          }} />
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                <div style={{
                  width: "10px",
                  height: "10px",
                  borderRadius: "50%",
                  background: "#003580"
                }} />
                <p style={{ fontSize: "13px", color: "#6B7280", margin: 0, fontWeight: "500" }}>Booking.com</p>
              </div>
              <h2 style={{
                fontSize: "42px",
                fontWeight: "800",
                color: "#003580",
                margin: "0 0 8px 0",
                letterSpacing: "-1px"
              }}>
                {bookingCount}
              </h2>
              <span style={{
                fontSize: "13px",
                color: "#003580",
                fontWeight: "600"
              }}>
                {bookingPercent}% of total
              </span>
            </div>
            <div style={{
              width: "56px",
              height: "56px",
              background: "linear-gradient(135deg, #003580 0%, #00224F 100%)",
              borderRadius: "16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 4px 12px rgba(0, 53, 128, 0.3)"
            }}>
              <span style={{ color: "white", fontSize: "20px", fontWeight: "800" }}>B.</span>
            </div>
          </div>
        </div>
      </div>

      {/* Charts Section */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1.8fr 1fr",
        gap: "24px",
        marginBottom: "32px"
      }}>
        {/* Building Performance Chart */}
        <div style={{
          background: "white",
          borderRadius: "24px",
          padding: "28px",
          boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
          border: "1px solid #F3F4F6"
        }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "28px"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
              <div style={{
                width: "48px",
                height: "48px",
                background: THEME_GRADIENT,
                borderRadius: "14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: `0 4px 12px ${viewMode === "confirmed" ? "rgba(59,130,246,0.3)" : "rgba(239,68,68,0.3)"}`
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                  <rect x="3" y="3" width="7" height="18" rx="1" />
                  <rect x="14" y="9" width="7" height="12" rx="1" />
                </svg>
              </div>
              <div>
                <h3 style={{ fontSize: "20px", fontWeight: "700", color: "#111827", margin: 0 }}>
                  Property Performance
                </h3>
                <p style={{ fontSize: "14px", color: "#6B7280", margin: "4px 0 0 0" }}>
                  {viewMode === "confirmed" ? "Bookings by building" : "Cancellations by building"}
                </p>
              </div>
            </div>
            <div style={{
              background: "#F3F4F6",
              padding: "8px 16px",
              borderRadius: "10px",
              fontSize: "14px",
              fontWeight: "600",
              color: "#374151"
            }}>
              {data.buildings.length} Properties
            </div>
          </div>
          <ResponsiveContainer width="100%" height={420}>
            <BarChart data={buildingsEN} margin={{ bottom: 100, left: 10, top: 20 }}>
              <defs>
                <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={viewMode === "confirmed" ? "#3B82F6" : "#EF4444"} />
                  <stop offset="100%" stopColor={viewMode === "confirmed" ? "#2563EB" : "#DC2626"} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
              <XAxis
                dataKey="nameEN"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#374151", fontSize: 13, fontWeight: 600 }}
                interval={0}
                angle={-40}
                textAnchor="end"
                height={100}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#9CA3AF", fontSize: 13, fontWeight: 500 }}
                tickFormatter={(val) => {
                  if (val >= 1000) return `${(val / 1000).toFixed(1)}k`;
                  return val;
                }}
              />
              <Tooltip
                cursor={{ fill: "rgba(59, 130, 246, 0.08)" }}
                contentStyle={{
                  background: "white",
                  border: "none",
                  borderRadius: "14px",
                  boxShadow: "0 10px 40px rgba(0,0,0,0.18)",
                  padding: "14px 18px",
                  fontSize: "14px"
                }}
                labelStyle={{ fontWeight: "700", marginBottom: "4px" }}
                formatter={(value) => [`${value} ${viewMode === "confirmed" ? "bookings" : "cancellations"}`, '']}
              />
              <Bar dataKey="count" fill="url(#barGradient)" radius={[10, 10, 0, 0]} barSize={48} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Platform Distribution */}
        <div style={{
          background: "white",
          borderRadius: "20px",
          padding: "24px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
          border: "1px solid #F3F4F6"
        }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            marginBottom: "24px"
          }}>
            <div style={{
              width: "40px",
              height: "40px",
              background: "linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%)",
              borderRadius: "12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2v20" />
                <path d="M2 12h20" />
              </svg>
            </div>
            <div>
              <h3 style={{ fontSize: "16px", fontWeight: "700", color: "#111827", margin: 0 }}>
                Platform Distribution
              </h3>
              <p style={{ fontSize: "12px", color: "#6B7280", margin: "2px 0 0 0" }}>
                Channel breakdown
              </p>
            </div>
          </div>
          <div style={{ position: "relative" }}>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={data.platforms}
                  cx="50%"
                  cy="50%"
                  innerRadius={70}
                  outerRadius={100}
                  paddingAngle={4}
                  dataKey="value"
                  strokeWidth={0}
                >
                  {data.platforms.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={PIE_COLORS[index]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "white",
                    border: "none",
                    borderRadius: "12px",
                    boxShadow: "0 10px 40px rgba(0,0,0,0.15)",
                    padding: "12px 16px"
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            {/* Center text */}
            <div style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              textAlign: "center"
            }}>
              <div style={{ fontSize: "28px", fontWeight: "800", color: "#111827" }}>{data.total}</div>
              <div style={{ fontSize: "12px", color: "#6B7280" }}>Total</div>
            </div>
          </div>
          {/* Legend */}
          <div style={{
            display: "flex",
            justifyContent: "center",
            gap: "24px",
            marginTop: "16px"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{ width: "12px", height: "12px", borderRadius: "4px", background: "#FF385C" }} />
              <span style={{ fontSize: "13px", color: "#374151", fontWeight: "500" }}>Airbnb</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{ width: "12px", height: "12px", borderRadius: "4px", background: "#003580" }} />
              <span style={{ fontSize: "13px", color: "#374151", fontWeight: "500" }}>Booking</span>
            </div>
          </div>
        </div>
      </div>

      {/* Room Stats Tables */}
      {Object.keys(data.roomStats).filter((building) => building !== EXCLUDED_BUILDING_UI).map((building) => {
        const buildingTotal = Object.values(data.roomStats[building]).reduce((sum, r) => sum + r.total, 0);
        if (buildingTotal === 0) return null;
        let shareDenominator = buildingTotal;
        let shareLabel = "Building Share";
        if (building.startsWith("오쿠보")) { shareDenominator = data.okuboTotal; shareLabel = "Okubo Share"; }
        else if (building === "사노시") { shareDenominator = data.total; shareLabel = "Total Share"; }

        return (
          <div key={building} style={{
            background: "white",
            borderRadius: "20px",
            padding: "24px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
            border: "1px solid #F3F4F6",
            marginBottom: "24px"
          }}>
            {/* Building Header */}
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "20px",
              paddingBottom: "16px",
              borderBottom: "1px solid #F3F4F6"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{
                  width: "44px",
                  height: "44px",
                  background: THEME_GRADIENT,
                  borderRadius: "12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: `0 4px 12px ${viewMode === "confirmed" ? "rgba(59,130,246,0.3)" : "rgba(239,68,68,0.3)"}`
                }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                    <polyline points="9 22 9 12 15 12 15 22" />
                  </svg>
                </div>
                <div>
                  <h3 style={{ fontSize: "18px", fontWeight: "700", color: "#111827", margin: 0 }}>
                    {getBuildingEN(building)}
                  </h3>
                  <p style={{ fontSize: "13px", color: "#6B7280", margin: "2px 0 0 0" }}>
                    {buildingTotal} {viewMode === "confirmed" ? "reservations" : "cancellations"}
                  </p>
                </div>
              </div>
              <div style={{
                background: viewMode === "confirmed" ? "#EFF6FF" : "#FEF2F2",
                color: THEME_COLOR,
                padding: "8px 16px",
                borderRadius: "10px",
                fontSize: "14px",
                fontWeight: "700"
              }}>
                {buildingTotal} total
              </div>
            </div>

            {/* Table */}
            <div style={{ overflowX: "auto" }}>
              <table style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "14px"
              }}>
                <thead>
                  <tr style={{ background: "#F9FAFB" }}>
                    <th style={{
                      padding: "14px 16px",
                      textAlign: "left",
                      fontWeight: "600",
                      color: "#374151",
                      borderRadius: "8px 0 0 8px"
                    }}>Room</th>
                    <th style={{ padding: "14px 16px", textAlign: "center", fontWeight: "600", color: "#FF385C" }}>Airbnb</th>
                    <th style={{ padding: "14px 16px", textAlign: "center", fontWeight: "600", color: "#003580" }}>Booking</th>
                    <th style={{ padding: "14px 16px", textAlign: "center", fontWeight: "600", color: "#374151" }}>Total</th>
                    <th style={{
                      padding: "14px 16px",
                      textAlign: "left",
                      fontWeight: "600",
                      color: "#374151",
                      borderRadius: "0 8px 8px 0",
                      minWidth: "180px"
                    }}>{shareLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(data.roomStats[building])
                    .sort((a, b) => data.roomStats[building][b].total - data.roomStats[building][a].total)
                    .map((room, idx) => {
                      const rData = data.roomStats[building][room];
                      const share = shareDenominator === 0 ? 0 : ((rData.total / shareDenominator) * 100);
                      const shareDisplay = share.toFixed(1);
                      return (
                        <tr
                          key={room}
                          style={{
                            borderBottom: "1px solid #F3F4F6",
                            transition: "background 0.2s"
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = "#F9FAFB"}
                          onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                        >
                          <td style={{ padding: "14px 16px", fontWeight: "600", color: "#111827" }}>
                            {getRoomEN(room)}
                          </td>
                          <td style={{ padding: "14px 16px", textAlign: "center" }}>
                            <span
                              onClick={() => handleNumberClick(`${getBuildingEN(building)} ${getRoomEN(room)} - Airbnb`, rData.airbnbList)}
                              style={{
                                color: "#FF385C",
                                fontWeight: "600",
                                cursor: rData.airbnb > 0 ? "pointer" : "default",
                                padding: "4px 12px",
                                borderRadius: "6px",
                                background: rData.airbnb > 0 ? "#FFF5F7" : "transparent",
                                transition: "all 0.2s"
                              }}
                            >
                              {rData.airbnb}
                            </span>
                          </td>
                          <td style={{ padding: "14px 16px", textAlign: "center" }}>
                            <span
                              onClick={() => handleNumberClick(`${getBuildingEN(building)} ${getRoomEN(room)} - Booking`, rData.bookingList)}
                              style={{
                                color: "#003580",
                                fontWeight: "600",
                                cursor: rData.booking > 0 ? "pointer" : "default",
                                padding: "4px 12px",
                                borderRadius: "6px",
                                background: rData.booking > 0 ? "#EFF6FF" : "transparent",
                                transition: "all 0.2s"
                              }}
                            >
                              {rData.booking}
                            </span>
                          </td>
                          <td style={{ padding: "14px 16px", textAlign: "center", fontWeight: "700", color: "#111827" }}>
                            {rData.total}
                          </td>
                          <td style={{ padding: "14px 16px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                              <div style={{
                                flex: 1,
                                height: "8px",
                                background: "#F3F4F6",
                                borderRadius: "4px",
                                overflow: "hidden"
                              }}>
                                <div style={{
                                  width: `${Math.min(share, 100)}%`,
                                  height: "100%",
                                  background: THEME_GRADIENT,
                                  borderRadius: "4px",
                                  transition: "width 0.5s ease"
                                }} />
                              </div>
                              <span style={{
                                fontSize: "13px",
                                fontWeight: "600",
                                color: "#6B7280",
                                minWidth: "45px",
                                textAlign: "right"
                              }}>
                                {shareDisplay}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ==============================
// 🛏️ Occupancy Dashboard (숙박 현황)
// ==============================
// 건물명 영문 매핑
const getBuildingNameEN = (koreanName) => _BUILDING_NAMES_EN_CENTRAL[koreanName] || koreanName;

// 객실명 영문 변환
const getRoomNameEN = (koreanRoom) => {
  if (koreanRoom === "오쿠보A") return "Okubo A";
  if (koreanRoom === "오쿠보B") return "Okubo B";
  if (koreanRoom === "오쿠보C") return "Okubo C";
  if (koreanRoom === "사노") return "Sano";
  return koreanRoom.replace("호", "").replace(/^(\d+)/, "Room $1");
};

function OccupancyDashboard({ targetMonth, setTargetMonth, companyId }) {
  const [data, setData] = useState({ total: 0, buildings: [], platforms: [], roomStats: {}, okuboTotal: 0 });

  const fetchData = async () => {
    if (!companyId) {
      console.warn('⚠️ No companyId for OccupancyDashboard');
      return;
    }
    // 숙박 현황은 'stayMonth' 기준
    const q = query(collection(db, "reservations"), where("companyId", "==", companyId), where("stayMonth", "==", targetMonth), where("status", "==", "confirmed"));
    const snapshot = await getDocs(q);
    let reservations = snapshot.docs.map((doc) => doc.data());
    reservations = reservations.filter((r) => (r.building || "") !== EXCLUDED_BUILDING_UI);

    let total = 0;
    const rStats = {};
    const bCount = {};

    Object.keys(BUILDING_DATA).forEach((b) => {
      if (b === EXCLUDED_BUILDING_UI) return;
      rStats[b] = {};
      BUILDING_DATA[b].forEach((r) => { rStats[b][r] = { total: 0, airbnb: 0, booking: 0 }; });
    });

    reservations.forEach((r) => {
      if (!rStats[r.building]) rStats[r.building] = {};
      if (!rStats[r.building][r.room]) rStats[r.building][r.room] = { total: 0, airbnb: 0, booking: 0 };

      if (rStats[r.building] && rStats[r.building][r.room]) {
        total++;
        bCount[r.building] = (bCount[r.building] || 0) + 1;
        rStats[r.building][r.room].total++;

        const platformName = r.platform ? r.platform.toLowerCase() : "";
        if (platformName.includes("booking")) {
          rStats[r.building][r.room].booking++;
        } else {
          rStats[r.building][r.room].airbnb++;
        }
      }
    });

    const okuboTotal = (bCount["오쿠보A동"] || 0) + (bCount["오쿠보B동"] || 0) + (bCount["오쿠보C동"] || 0);
    setData({ total, buildings: [], platforms: [], roomStats: rStats, okuboTotal });
  };

  useEffect(() => {
    if (companyId) {
      fetchData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, targetMonth]);

  // 플랫폼별 총계 계산
  const airbnbTotal = Object.values(data.roomStats).reduce((sum, building) =>
    sum + Object.values(building).reduce((bSum, room) => bSum + room.airbnb, 0), 0);
  const bookingTotal = Object.values(data.roomStats).reduce((sum, building) =>
    sum + Object.values(building).reduce((bSum, room) => bSum + room.booking, 0), 0);

  return (
    <div style={{ background: "#FFFFFF", minHeight: "100vh", padding: "32px" }}>
      <div style={{ marginBottom: "32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: "28px", fontWeight: "700", color: "#1E293B", margin: 0, marginBottom: "8px" }}>Stay Month Analytics</h1>
          <p style={{ fontSize: "14px", color: "#64748B", margin: 0 }}>Monthly accommodation statistics and platform distribution</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", background: "#F8FAFC", padding: "12px 20px", borderRadius: "12px", border: "1px solid #E2E8F0" }}>
          <span style={{ fontSize: "13px", fontWeight: "600", color: "#475569" }}>Select Month</span>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <select
              value={targetMonth ? targetMonth.split('-')[0] : new Date().getFullYear()}
              onChange={(e) => {
                const year = e.target.value;
                const month = targetMonth ? targetMonth.split('-')[1] : String(new Date().getMonth() + 1).padStart(2, '0');
                setTargetMonth(`${year}-${month}`);
              }}
              style={{ padding: "8px 12px", border: "1px solid #CBD5E1", borderRadius: "8px", fontSize: "14px", fontWeight: "500", color: "#1E293B", background: "white", cursor: "pointer" }}
            >
              {Array.from({ length: 11 }, (_, i) => new Date().getFullYear() - 5 + i).map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
            <select
              value={targetMonth ? targetMonth.split('-')[1] : String(new Date().getMonth() + 1).padStart(2, '0')}
              onChange={(e) => {
                const month = e.target.value;
                const year = targetMonth ? targetMonth.split('-')[0] : new Date().getFullYear();
                setTargetMonth(`${year}-${month}`);
              }}
              style={{ padding: "8px 12px", border: "1px solid #CBD5E1", borderRadius: "8px", fontSize: "14px", fontWeight: "500", color: "#1E293B", background: "white", cursor: "pointer" }}
            >
              <option value="01">1 January</option>
              <option value="02">2 February</option>
              <option value="03">3 March</option>
              <option value="04">4 April</option>
              <option value="05">5 May</option>
              <option value="06">6 June</option>
              <option value="07">7 July</option>
              <option value="08">8 August</option>
              <option value="09">9 September</option>
              <option value="10">10 October</option>
              <option value="11">11 November</option>
              <option value="12">12 December</option>
            </select>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "24px", marginBottom: "32px" }}>
        <div style={{ background: "linear-gradient(135deg, #4F46E5 0%, #6366F1 100%)", borderRadius: "16px", padding: "28px", boxShadow: "0 4px 20px rgba(79, 70, 229, 0.15)", color: "white", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: "-20px", right: "-20px", width: "120px", height: "120px", background: "rgba(255, 255, 255, 0.1)", borderRadius: "50%", filter: "blur(40px)" }} />
          <div style={{ position: "relative", zIndex: 1 }}>
            <div style={{ fontSize: "13px", fontWeight: "600", opacity: 0.9, marginBottom: "12px", letterSpacing: "0.5px", textTransform: "uppercase" }}>Total Stays</div>
            <div style={{ fontSize: "42px", fontWeight: "700", marginBottom: "8px", lineHeight: 1 }}>{data.total}</div>
            <div style={{ fontSize: "13px", opacity: 0.8 }}>Confirmed Reservations</div>
          </div>
        </div>
        <div style={{ background: "#F8FAFC", borderRadius: "16px", padding: "28px", border: "1px solid #E2E8F0" }}>
          <div style={{ fontSize: "13px", fontWeight: "600", color: "#64748B", marginBottom: "12px", letterSpacing: "0.5px", textTransform: "uppercase" }}>Airbnb</div>
          <div style={{ fontSize: "42px", fontWeight: "700", color: "#1E293B", marginBottom: "8px", lineHeight: 1 }}>{airbnbTotal}</div>
          <div style={{ display: "inline-block", background: "#FEE2E2", color: "#DC2626", padding: "4px 12px", borderRadius: "20px", fontSize: "12px", fontWeight: "600" }}>{data.total > 0 ? ((airbnbTotal / data.total * 100).toFixed(1)) : 0}% of total</div>
        </div>
        <div style={{ background: "#F8FAFC", borderRadius: "16px", padding: "28px", border: "1px solid #E2E8F0" }}>
          <div style={{ fontSize: "13px", fontWeight: "600", color: "#64748B", marginBottom: "12px", letterSpacing: "0.5px", textTransform: "uppercase" }}>Booking.com</div>
          <div style={{ fontSize: "42px", fontWeight: "700", color: "#1E293B", marginBottom: "8px", lineHeight: 1 }}>{bookingTotal}</div>
          <div style={{ display: "inline-block", background: "#DBEAFE", color: "#2563EB", padding: "4px 12px", borderRadius: "20px", fontSize: "12px", fontWeight: "600" }}>{data.total > 0 ? ((bookingTotal / data.total * 100).toFixed(1)) : 0}% of total</div>
        </div>
      </div>

      {Object.keys(data.roomStats).filter((building) => building !== EXCLUDED_BUILDING_UI).map((building) => {
        const buildingTotal = Object.values(data.roomStats[building]).reduce((sum, r) => sum + r.total, 0);
        if (buildingTotal === 0) return null;
        let shareDenominator = buildingTotal;
        let shareLabel = "건물내 비중";
        if (building.startsWith("오쿠보")) { shareDenominator = data.okuboTotal; shareLabel = "오쿠보 비중"; }
        else if (building === "사노시") { shareDenominator = data.total; shareLabel = "전체 비중"; }

        return (
          <div key={building} style={{ background: "#F8FAFC", borderRadius: "16px", padding: "28px", marginBottom: "24px", border: "1px solid #E2E8F0" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px", paddingBottom: "16px", borderBottom: "2px solid #E2E8F0" }}>
              <div>
                <h3 style={{ fontSize: "20px", fontWeight: "700", color: "#1E293B", margin: 0, marginBottom: "4px" }}>{getBuildingNameEN(building)}</h3>
                <p style={{ fontSize: "13px", color: "#64748B", margin: 0 }}>Room-level breakdown</p>
              </div>
              <div style={{ background: "linear-gradient(135deg, #4F46E5 0%, #6366F1 100%)", color: "white", padding: "10px 20px", borderRadius: "12px", fontSize: "16px", fontWeight: "700" }}>{buildingTotal}</div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "white", borderBottom: "2px solid #E2E8F0" }}>
                    <th style={{ textAlign: "left", padding: "14px 16px", fontSize: "12px", fontWeight: "700", color: "#64748B", textTransform: "uppercase", letterSpacing: "0.5px" }}>Room</th>
                    <th style={{ textAlign: "center", padding: "14px 16px", fontSize: "12px", fontWeight: "700", color: "#64748B", textTransform: "uppercase", letterSpacing: "0.5px" }}>Airbnb</th>
                    <th style={{ textAlign: "center", padding: "14px 16px", fontSize: "12px", fontWeight: "700", color: "#64748B", textTransform: "uppercase", letterSpacing: "0.5px" }}>Booking</th>
                    <th style={{ textAlign: "center", padding: "14px 16px", fontSize: "12px", fontWeight: "700", color: "#64748B", textTransform: "uppercase", letterSpacing: "0.5px" }}>Total</th>
                    <th style={{ textAlign: "center", padding: "14px 16px", fontSize: "12px", fontWeight: "700", color: "#64748B", textTransform: "uppercase", letterSpacing: "0.5px" }}>{shareLabel === "건물내 비중" ? "Share" : shareLabel === "오쿠보 비중" ? "Okubo %" : "Total %"}</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(data.roomStats[building]).sort((a, b) => data.roomStats[building][b].total - data.roomStats[building][a].total).map((room, idx) => {
                    const rData = data.roomStats[building][room];
                    const share = shareDenominator === 0 ? 0 : ((rData.total / shareDenominator) * 100).toFixed(1);
                    return (
                      <tr key={room} style={{ background: idx % 2 === 0 ? "white" : "#F1F5F9", borderBottom: "1px solid #E2E8F0" }}>
                        <td style={{ textAlign: "left", padding: "16px", fontWeight: "600", fontSize: "14px", color: "#1E293B" }}>{getRoomNameEN(room)}</td>
                        <td style={{ textAlign: "center", padding: "16px" }}><span style={{ background: "#FEE2E2", color: "#DC2626", padding: "6px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: "600" }}>{rData.airbnb}</span></td>
                        <td style={{ textAlign: "center", padding: "16px" }}><span style={{ background: "#DBEAFE", color: "#2563EB", padding: "6px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: "600" }}>{rData.booking}</span></td>
                        <td style={{ textAlign: "center", padding: "16px", fontWeight: "700", fontSize: "15px", color: "#4F46E5" }}>{rData.total}</td>
                        <td style={{ textAlign: "center", padding: "16px", fontSize: "13px", fontWeight: "600", color: "#64748B" }}>{share}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ==============================
// 🚪 ArrivalsDashboard (입/퇴실 대시보드)
// ==============================
const DISPLAY_BUILDING_ORDER = _ACTIVE_BUILDING_ORDER;

// 건물 순서대로 정렬하는 함수
const sortByBuildingOrder = (list) => {
  return [...list].sort((a, b) => {
    const indexA = DISPLAY_BUILDING_ORDER.indexOf(a.building);
    const indexB = DISPLAY_BUILDING_ORDER.indexOf(b.building);
    // 목록에 없는 건물은 맨 뒤로
    const orderA = indexA === -1 ? 999 : indexA;
    const orderB = indexB === -1 ? 999 : indexB;
    return orderA - orderB;
  });
};

// eslint-disable-next-line no-unused-vars
function DeprecatedArrivalsDashboard() {
  const { companyId } = useUser();
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [guestList, setGuestList] = useState([]);
  const [error, setError] = useState("");
  const [selectedGuest, setSelectedGuest] = useState(null);  // 선택된 고객 (모달용)
  const [searchQuery, setSearchQuery] = useState("");  // 고객 이름 검색
  const [searchResults, setSearchResults] = useState([]);  // 검색 결과
  const [showSearchResults, setShowSearchResults] = useState(false);

  const formatPrice = (price) => {
    if (!price) return "¥0";
    const num = parseFloat(String(price).replace(/[^0-9.-]+/g, ""));
    if (isNaN(num)) return "¥0";
    return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(num);
  };

  const getPlatformClass = (platformName) => {
    if (!platformName) return "pf-text-airbnb";
    const name = platformName.toLowerCase();
    if (name.includes("booking")) return "pf-text-booking";
    return "pf-text-airbnb";
  };

  const fetchTodayArrivals = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(GET_ARRIVALS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: selectedDate })
      });
      const result = await response.json();

      console.log("Beds24 Raw Data:", result.data);

      if (result.success && Array.isArray(result.data)) {
        setGuestList((result.data || []).filter(g => g.building !== EXCLUDED_BUILDING_UI));
      } else {
        setGuestList([]);
      }
    } catch (err) {
      console.error(err);
      setError("데이터 통신 오류");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTodayArrivals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  // 고객 이름 검색 함수 (1글자부터 자동 검색)
  const searchGuests = useCallback(async (queryText) => {
    if (!queryText || queryText.trim().length < 1) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    try {
      if (!companyId) {
        console.warn('⚠️ No companyId for guest search');
        return;
      }

      // Firestore에서 모든 confirmed 예약을 가져와서 클라이언트에서 검색
      const q = query(
        collection(db, "reservations"),
        where("companyId", "==", companyId),
        where("status", "==", "confirmed")
      );
      const snapshot = await getDocs(q);
      const allGuests = snapshot.docs.map(doc => doc.data());

      // 이름으로 필터링 (대소문자 무시)
      const searchLower = queryText.toLowerCase();
      const filtered = allGuests.filter(g =>
        g.guestName && g.guestName.toLowerCase().includes(searchLower)
      );

      // 도착일 기준 정렬 (최근 것 먼저)
      filtered.sort((a, b) => {
        if (!a.arrival) return 1;
        if (!b.arrival) return -1;
        return b.arrival.localeCompare(a.arrival);
      });

      setSearchResults(filtered.slice(0, 20)); // 최대 20개
      setShowSearchResults(true);
    } catch (err) {
      console.error("검색 오류:", err);
      setSearchResults([]);
    }
  }, [companyId]);

  // 검색어 변경 시 디바운스 적용
  useEffect(() => {
    const timer = setTimeout(() => {
      searchGuests(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchGuests, searchQuery]);

  // 선택한 날짜의 입실/퇴실 필터링 후 건물 순서대로 정렬
  const todayArrivals = sortByBuildingOrder(guestList.filter(guest => guest.arrival === selectedDate));
  const todayDepartures = sortByBuildingOrder(guestList.filter(guest => guest.departure === selectedDate));

  return (
    <div className="dashboard-content">
      {/* 고객 상세 모달 */}
      {selectedGuest && (
        <DeprecatedGuestDetailModal
          guest={selectedGuest}
          onClose={() => setSelectedGuest(null)}
        />
      )}

      <div className="dashboard-header">
        <h2 className="page-title">🚪 입/퇴실 관리</h2>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {/* 고객 검색 */}
          <div style={{ position: "relative" }}>
            <input
              type="text"
              className="form-input"
              placeholder="🔍 고객 이름 검색..."
              style={{ marginBottom: 0, width: "200px" }}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => searchQuery.length >= 2 && setShowSearchResults(true)}
              onBlur={() => setTimeout(() => setShowSearchResults(false), 200)}
            />
            {/* 검색 결과 드롭다운 */}
            {showSearchResults && searchResults.length > 0 && (
              <div style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                background: "white",
                borderRadius: "12px",
                boxShadow: "0 10px 40px rgba(0,0,0,0.15)",
                zIndex: 1000,
                maxHeight: "300px",
                overflowY: "auto",
                marginTop: "4px"
              }}>
                {searchResults.map((guest, idx) => (
                  <div
                    key={idx}
                    onClick={() => {
                      setSelectedGuest(guest);
                      setShowSearchResults(false);
                      setSearchQuery("");
                    }}
                    style={{
                      padding: "12px 16px",
                      borderBottom: "1px solid #F2F2F7",
                      cursor: "pointer",
                      transition: "background 0.2s"
                    }}
                    onMouseEnter={(e) => e.target.style.background = "#F5F5F7"}
                    onMouseLeave={(e) => e.target.style.background = "white"}
                  >
                    <div style={{ fontWeight: "600", fontSize: "14px" }}>{guest.guestName}</div>
                    <div style={{ fontSize: "12px", color: "#86868B" }}>
                      {guest.building} {guest.room} | {guest.arrival} ~ {guest.departure}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {showSearchResults && searchQuery.length >= 2 && searchResults.length === 0 && (
              <div style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                background: "white",
                borderRadius: "12px",
                boxShadow: "0 10px 40px rgba(0,0,0,0.15)",
                zIndex: 1000,
                padding: "20px",
                textAlign: "center",
                color: "#86868B",
                marginTop: "4px"
              }}>
                검색 결과가 없습니다
              </div>
            )}
          </div>
          <input type="date" className="form-input" style={{ marginBottom: 0, width: "160px", fontWeight: "bold" }} value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
          <button className="btn-primary" style={{ width: "auto", padding: "10px 20px" }} onClick={fetchTodayArrivals}>🔄 새로고침</button>
        </div>
      </div>

      {error && <div style={{ padding: "20px", background: "#FFE5E5", color: "#FF3B30", borderRadius: "12px", marginBottom: "20px" }}>🚨 {error}</div>}

      {loading ? (
        <div style={{ textAlign: "center", padding: "50px", color: "#888" }}>데이터를 불러오는 중입니다...<br /><span style={{ fontSize: '12px' }}>(Beds24 서버 상태에 따라 시간이 걸릴 수 있습니다)</span></div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "30px" }}>

          {/* 입실 (Check-in) */}
          <div className="table-card" style={{ borderTop: "5px solid #0071E3" }}>
            <h3 style={{ margin: "0 0 15px 0", color: "#0071E3", display: "flex", alignItems: "center", gap: "8px" }}>
              📥 입실 예정 (Check-in) <span style={{ background: "#E8F2FF", padding: "4px 8px", borderRadius: "10px", fontSize: "14px" }}>{todayArrivals.length}건</span>
            </h3>
            {todayArrivals.length === 0 ? (
              <p style={{ textAlign: "center", color: "#aaa", padding: "20px" }}>{selectedDate} 입실 예정자가 없습니다.</p>
            ) : (
              <table className="table-full">
                <thead><tr><th>객실</th><th>게스트 이름</th><th>인원</th><th>플랫폼</th><th>숙박 기간</th><th>총 금액</th><th>상태</th></tr></thead>
                <tbody>
                  {todayArrivals.map((g, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: "bold" }}>{g.building} {g.room}</td>
                      <td>
                        <span
                          onClick={() => setSelectedGuest(g)}
                          style={{
                            cursor: "pointer",
                            color: "#0071E3",
                            textDecoration: "underline",
                            fontWeight: "500"
                          }}
                        >
                          {g.guestName || <span style={{ color: '#ccc' }}>(이름없음)</span>}
                        </span>
                      </td>
                      <td style={{ fontSize: "13px" }}>성인 {g.numAdult || 0}, 아동 {g.numChild || 0}</td>
                      <td><span className={getPlatformClass(g.platform)}>{g.platform || "Unknown"}</span></td>
                      <td style={{ fontSize: "13px", color: "#666" }}>{g.arrival} ~ {g.departure}</td>
                      <td style={{ fontWeight: "bold" }}>{formatPrice(g.totalPrice || g.price)}</td>
                      <td><span className="tag-good">입실예정</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* 퇴실 (Check-out) */}
          <div className="table-card" style={{ borderTop: "5px solid #FF3B30" }}>
            <h3 style={{ margin: "0 0 15px 0", color: "#FF3B30", display: "flex", alignItems: "center", gap: "8px" }}>
              📤 퇴실 예정 (Check-out) <span style={{ background: "#FFE5E5", padding: "4px 8px", borderRadius: "10px", fontSize: "14px" }}>{todayDepartures.length}건</span>
            </h3>
            {todayDepartures.length === 0 ? (
              <p style={{ textAlign: "center", color: "#aaa", padding: "20px" }}>{selectedDate} 퇴실 예정자가 없습니다.</p>
            ) : (
              <table className="table-full">
                <thead><tr><th>객실</th><th>게스트 이름</th><th>인원</th><th>체크인 날짜</th><th>플랫폼</th><th>총 금액</th><th>상태</th></tr></thead>
                <tbody>
                  {todayDepartures.map((g, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: "bold" }}>{g.building} {g.room}</td>
                      <td>
                        <span
                          onClick={() => setSelectedGuest(g)}
                          style={{
                            cursor: "pointer",
                            color: "#0071E3",
                            textDecoration: "underline",
                            fontWeight: "500"
                          }}
                        >
                          {g.guestName || <span style={{ color: '#ccc' }}>(이름없음)</span>}
                        </span>
                      </td>
                      <td style={{ fontSize: "13px" }}>성인 {g.numAdult || 0}, 아동 {g.numChild || 0}</td>
                      <td style={{ color: "#0071E3", fontWeight: "600" }}>{g.arrival} (입실일)</td>
                      <td><span className={getPlatformClass(g.platform)}>{g.platform || "Unknown"}</span></td>
                      <td>{formatPrice(g.totalPrice || g.price)}</td>
                      <td><span className="tag-pending">퇴실대기</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

        </div>
      )}
    </div>
  );
}

// ==============================
// PWA 설치 프롬프트 컴포넌트
// ==============================
function InstallPrompt({ onClose }) {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    // 이미 설치된 경우 또는 이미 거절한 경우 표시하지 않음
    const dismissed = localStorage.getItem('pwa-install-dismissed');
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

    if (dismissed || isStandalone) {
      onClose();
      return;
    }

    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowPrompt(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // iOS Safari 등 beforeinstallprompt를 지원하지 않는 브라우저에서도 표시
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOS && !isStandalone) {
      setShowPrompt(true);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, [onClose]);

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setShowPrompt(false);
        onClose();
      }
      setDeferredPrompt(null);
    } else {
      // iOS Safari의 경우 안내 메시지 표시
      alert('iOS에서 설치하려면:\n\n1. 하단의 공유 버튼 (📤)을 탭하세요\n2. "홈 화면에 추가"를 선택하세요');
    }
  };

  const handleDismiss = () => {
    localStorage.setItem('pwa-install-dismissed', 'true');
    setShowPrompt(false);
    onClose();
  };

  if (!showPrompt) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: '100px',
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      color: 'white',
      padding: '16px 24px',
      borderRadius: '16px',
      boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
      maxWidth: '90vw',
      animation: 'slideUp 0.3s ease-out'
    }}>
      <style>{`
        @keyframes slideUp {
          from { transform: translateX(-50%) translateY(100px); opacity: 0; }
          to { transform: translateX(-50%) translateY(0); opacity: 1; }
        }
      `}</style>
      <span style={{ fontSize: '32px' }}>🏨</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: '700', fontSize: '16px', marginBottom: '4px' }}>
          HARU Dashboard 설치
        </div>
        <div style={{ fontSize: '13px', opacity: 0.9 }}>
          앱처럼 바로 접속할 수 있습니다
        </div>
      </div>
      <button
        onClick={handleInstall}
        style={{
          background: 'white',
          color: '#667eea',
          border: 'none',
          padding: '10px 20px',
          borderRadius: '10px',
          fontWeight: '700',
          fontSize: '14px',
          cursor: 'pointer',
          whiteSpace: 'nowrap'
        }}
      >
        설치하기
      </button>
      <button
        onClick={handleDismiss}
        style={{
          background: 'transparent',
          color: 'white',
          border: 'none',
          fontSize: '20px',
          cursor: 'pointer',
          padding: '4px',
          opacity: 0.7
        }}
      >
        ×
      </button>
    </div>
  );
}

// ==============================
// 📱 PWA 설치 배너
// ==============================
function PWAInstallBanner({ onInstall, onDismiss }) {
  return (
    <div style={{
      position: 'fixed',
      bottom: '20px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 10000,
      backgroundColor: '#0071E3',
      color: 'white',
      padding: '16px 24px',
      borderRadius: '16px',
      boxShadow: '0 8px 32px rgba(0, 113, 227, 0.4)',
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
      maxWidth: '90%',
      animation: 'slideUp 0.3s ease-out'
    }}>
      <div style={{ fontSize: '32px' }}>📱</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: '600', fontSize: '15px', marginBottom: '4px' }}>
          홈 화면에 추가하기
        </div>
        <div style={{ fontSize: '13px', opacity: 0.9 }}>
          앱처럼 빠르고 편리하게 사용하세요
        </div>
      </div>
      <button
        onClick={onInstall}
        style={{
          backgroundColor: 'white',
          color: '#0071E3',
          border: 'none',
          padding: '10px 20px',
          borderRadius: '10px',
          fontWeight: '600',
          fontSize: '14px',
          cursor: 'pointer',
          whiteSpace: 'nowrap'
        }}
      >
        설치
      </button>
      <button
        onClick={onDismiss}
        style={{
          backgroundColor: 'transparent',
          color: 'white',
          border: 'none',
          fontSize: '24px',
          cursor: 'pointer',
          padding: '4px',
          opacity: 0.7,
          lineHeight: 1
        }}
      >
        ×
      </button>
    </div>
  );
}

// ==============================
// ⬆️ 위로 가기 버튼 컴포넌트
// ==============================
function ScrollToTopButton() {
  const [showButton, setShowButton] = useState(false);

  useEffect(() => {
    const mainContent = document.querySelector('.main-content');
    if (!mainContent) return;

    const handleScroll = () => {
      setShowButton(mainContent.scrollTop > 300);
    };

    mainContent.addEventListener('scroll', handleScroll);
    return () => mainContent.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    const mainContent = document.querySelector('.main-content');
    if (mainContent) {
      mainContent.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  if (!showButton) return null;

  return (
    <button
      onClick={scrollToTop}
      style={{
        position: 'fixed',
        bottom: '100px',
        right: '30px',
        width: '50px',
        height: '50px',
        borderRadius: '50%',
        background: 'linear-gradient(135deg, #0071E3 0%, #5856D6 100%)',
        color: 'white',
        border: 'none',
        boxShadow: '0 4px 15px rgba(0, 113, 227, 0.4)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '20px',
        zIndex: 999,
        transition: 'all 0.3s ease',
      }}
      onMouseEnter={(e) => {
        e.target.style.transform = 'scale(1.1)';
        e.target.style.boxShadow = '0 6px 20px rgba(0, 113, 227, 0.5)';
      }}
      onMouseLeave={(e) => {
        e.target.style.transform = 'scale(1)';
        e.target.style.boxShadow = '0 4px 15px rgba(0, 113, 227, 0.4)';
      }}
      title="맨 위로 이동"
    >
      ↑
    </button>
  );
}

// ==============================
// AppContent - Router 내부 컴포넌트 (useLocation 사용)
// ==============================
function AppContent({ handleSync, syncing, globalMonth, setGlobalMonth, mobileMenuOpen, setMobileMenuOpen, companyId }) {
  const location = useLocation();
  const currentPath = location.pathname;

  // Design Preview는 독립적인 레이아웃 사용
  if (currentPath === '/design-preview') {
    return <DesignPreview />;
  }

  return (
    <NewLayout onSync={handleSync} syncing={syncing}>
      <TeamToast />
      <Routes>
        <Route path="/" element={<TodaySummaryDashboard />} />
        <Route path="/performance" element={<PerformanceDashboard targetMonth={globalMonth} setTargetMonth={setGlobalMonth} companyId={companyId} />} />
        <Route path="/revenue" element={<RevenueDashboard />} />
        <Route path="/sales-log" element={<SalesLogDashboard />} />
        <Route path="/daily-log" element={<SalesLog />} />
        <Route path="/calendar" element={<BuildingCalendar />} />
        <Route path="/occupancy" element={<OccupancyDashboard targetMonth={globalMonth} setTargetMonth={setGlobalMonth} companyId={companyId} />} />
        <Route path="/occupancy-rate" element={<OccupancyRateDashboard />} />
        <Route path="/room-performance" element={<RoomPerformanceDashboard />} />
        <Route path="/country" element={<CountryOccupancyDashboard />} />
        <Route path="/arrivals" element={<ArrivalsAndDeparturesDashboard />} />
        <Route path="/cleaning" element={<CleaningDashboard />} />
        <Route path="/room-links" element={<RoomLinksDashboard />} />
        <Route path="/customers" element={<CustomerListDashboard />} />
        <Route path="/team" element={<MemberManagement />} />
        <Route path="/my-profile" element={<MyProfile />} />
        <Route path="/price-history" element={<PriceChangeHistory />} />
        <Route path="/reviews" element={<ReviewsDashboard />} />
        <Route path="/design-preview" element={<DesignPreview />} />
      </Routes>

      {/* 위로 가기 버튼 */}
      <ScrollToTopButton />
    </NewLayout>
  );

  /* ============ 기존 레이아웃 (롤백용 - 삭제하지 마세요) ============
  return (
    <div className="dashboard-layout">
      <MobileHeader
        onMenuClick={() => setMobileMenuOpen(true)}
        currentPath={currentPath}
      />
      <MobileMenu
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        onSync={handleSync}
        currentPath={currentPath}
      />
      <Sidebar onSync={handleSync} syncing={syncing} />
      <main className="main-content">
        <Routes>...</Routes>
      </main>
      <ScrollToTopButton />
    </div>
  );
  ============ 기존 레이아웃 끝 ============ */
}

// ==============================
// 🌐 App — 루트 컴포넌트
// ==============================
function App() {
  const { user, userData, companyId, loading } = useUser();
  const [globalMonth, setGlobalMonth] = useState(new Date().toISOString().slice(0, 7));
  const [syncing] = useState(false);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [showInstallPrompt, setShowInstallPrompt] = useState(true);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showPWABanner, setShowPWABanner] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Capacitor Native Integration (Status Bar)
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      StatusBar.setStyle({ style: Style.Light });
      StatusBar.setBackgroundColor({ color: '#4F46E5' }); // Indigo 600 theme color
    }
  }, []);

  const handleSync = () => {
    setSyncModalOpen(true);
  };

  // PWA 설치 핸들러
  const handlePWAInstall = async () => {
    if (!deferredPrompt) return;

    // 설치 프롬프트 표시
    deferredPrompt.prompt();

    // 사용자의 선택 대기
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`PWA 설치 결과: ${outcome}`);

    // 이벤트 초기화
    setDeferredPrompt(null);
    setShowPWABanner(false);
  };

  // PWA 배너 닫기 핸들러
  const handlePWADismiss = () => {
    setShowPWABanner(false);
    // 7일 동안 다시 표시하지 않음
    localStorage.setItem('pwa-install-dismissed', new Date().toISOString());
  };

  // PWA 설치 프롬프트 핸들러
  useEffect(() => {
    const handleBeforeInstallPrompt = (e) => {
      // 브라우저 기본 설치 배너 막기
      e.preventDefault();
      // 나중에 사용하기 위해 이벤트 저장
      setDeferredPrompt(e);

      // 로컬스토리지에서 이전에 닫았는지 확인
      const dismissed = localStorage.getItem('pwa-install-dismissed');
      const dismissedDate = dismissed ? new Date(dismissed) : null;
      const now = new Date();

      // 7일이 지났거나 처음이면 배너 표시
      if (!dismissedDate || (now - dismissedDate) > 7 * 24 * 60 * 60 * 1000) {
        setShowPWABanner(true);
      }
    };

    // 이미 설치되어 있는지 확인
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone
      || document.referrer.includes('android-app://');

    if (!isStandalone) {
      window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  if (loading) return <div style={{ height: "100vh", display: "flex", justifyContent: "center", alignItems: "center" }}>로딩 중...</div>;
  // Show LoginPage if no user OR if user exists but no userData (incomplete signup)
  if (!user || (user && !userData)) return <><style>{styles}</style><LoginPage incompleteSignup={user && !userData} /></>;

  return (
    <>
      <style>{styles}</style>
      {/* PWA 설치 프롬프트 */}
      {showInstallPrompt && (
        <InstallPrompt onClose={() => setShowInstallPrompt(false)} />
      )}
      {/* PWA 설치 배너 */}
      {showPWABanner && (
        <PWAInstallBanner onInstall={handlePWAInstall} onDismiss={handlePWADismiss} />
      )}
      <SyncManager
        isOpen={syncModalOpen}
        onClose={() => setSyncModalOpen(false)}
        onSyncComplete={() => { setSyncModalOpen(false); window.location.reload(); }}
      />
      <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <MaintenanceGuard>
          <AppContent
            handleSync={handleSync}
            syncing={syncing}
            globalMonth={globalMonth}
            setGlobalMonth={setGlobalMonth}
            mobileMenuOpen={mobileMenuOpen}
            setMobileMenuOpen={setMobileMenuOpen}
            companyId={companyId}
          />
        </MaintenanceGuard>
      </Router>
    </>
  );
}

// ==============================
// App Wrapper with UserProvider
// ==============================
function AppWithProvider() {
  return (
    <UserProvider>
      <App />
    </UserProvider>
  );
}

export default AppWithProvider;
