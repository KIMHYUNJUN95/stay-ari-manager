// src/components/DesignPreview.jsx
// Finova 스타일 대시보드 - 대기업 수준 퀄리티

import React, { useState, useEffect, useCallback } from 'react';
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from '../firebase';
import { useUser } from '../contexts/UserContext';

import { ACTIVE_BUILDING_ORDER as BUILDING_ORDER } from '../constants/buildingData';

const DesignPreview = () => {
  const { companyId } = useUser();
  const [activeMenu, setActiveMenu] = useState('dashboard');
  const [stats, setStats] = useState({
    totalRevenue: 0,
    lastMonthRevenue: 0,
    totalReservations: 0,
    lastMonthReservations: 0,
    occupancyRate: 78.5,
    lastMonthOccupancy: 74.2,
    avgPrice: 0,
    lastMonthAvgPrice: 0
  });
  const [buildingStats, setBuildingStats] = useState([]);
  const [platformStats, setPlatformStats] = useState({ airbnb: 0, booking: 0 });
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      if (!companyId) {
        console.warn('⚠️ No companyId for DesignPreview');
        return;
      }

      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth();
      const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
      const lastMonthStr = `${month === 0 ? year - 1 : year}-${String(month === 0 ? 12 : month).padStart(2, '0')}`;

      // 이번 달 예약
      const q1 = query(
        collection(db, "reservations"),
        where("companyId", "==", companyId),
        where("stayMonth", "==", monthStr),
        where("status", "==", "confirmed")
      );
      const snapshot1 = await getDocs(q1);
      const thisMonthRes = snapshot1.docs.map(d => d.data());

      // 지난 달 예약
      const q2 = query(
        collection(db, "reservations"),
        where("companyId", "==", companyId),
        where("stayMonth", "==", lastMonthStr),
        where("status", "==", "confirmed")
      );
      const snapshot2 = await getDocs(q2);
      const lastMonthRes = snapshot2.docs.map(d => d.data());

      // 통계 계산
      const thisRevenue = thisMonthRes.reduce((sum, r) => sum + (parseFloat(r.totalPrice) || 0), 0);
      const lastRevenue = lastMonthRes.reduce((sum, r) => sum + (parseFloat(r.totalPrice) || 0), 0);
      const thisAvg = thisMonthRes.length > 0 ? thisRevenue / thisMonthRes.length : 0;
      const lastAvg = lastMonthRes.length > 0 ? lastRevenue / lastMonthRes.length : 0;

      // 플랫폼별 통계
      let airbnbCount = 0, bookingCount = 0;
      thisMonthRes.forEach(r => {
        const platform = (r.platform || '').toLowerCase();
        if (platform.includes('booking')) bookingCount++;
        else airbnbCount++;
      });

      setStats({
        totalRevenue: thisRevenue,
        lastMonthRevenue: lastRevenue,
        totalReservations: thisMonthRes.length,
        lastMonthReservations: lastMonthRes.length,
        occupancyRate: 78.5,
        lastMonthOccupancy: 74.2,
        avgPrice: thisAvg,
        lastMonthAvgPrice: lastAvg
      });

      setPlatformStats({ airbnb: airbnbCount, booking: bookingCount });

      // 건물별 통계
      const bStats = BUILDING_ORDER.map(building => {
        const bRes = thisMonthRes.filter(r => r.building === building);
        const revenue = bRes.reduce((sum, r) => sum + (parseFloat(r.totalPrice) || 0), 0);
        const avgSpend = bRes.length > 0 ? revenue / bRes.length : 0;
        return {
          name: building,
          reservations: bRes.length,
          revenue,
          avgSpend,
          status: bRes.length >= 10 ? 'Active' : bRes.length >= 5 ? 'Good' : 'Low'
        };
      }).filter(b => b.reservations > 0).sort((a, b) => b.revenue - a.revenue);

      setBuildingStats(bStats);
    } catch (error) {
      console.error("Error:", error);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const formatPrice = (price) => `¥${Math.round(price).toLocaleString()}`;
  
  const getChangePercent = (current, previous) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100);
  };

  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.loadingSpinner}>
          <div style={styles.spinner}></div>
          <p style={styles.loadingText}>Loading Dashboard...</p>
        </div>
      </div>
    );
  }

  const revenueChange = getChangePercent(stats.totalRevenue, stats.lastMonthRevenue);
  const reservationChange = getChangePercent(stats.totalReservations, stats.lastMonthReservations);
  const occupancyChange = getChangePercent(stats.occupancyRate, stats.lastMonthOccupancy);
  const avgPriceChange = getChangePercent(stats.avgPrice, stats.lastMonthAvgPrice);

  return (
    <div style={styles.container}>
      {/* 사이드바 */}
      <aside style={styles.sidebar}>
        {/* 로고 */}
        <div style={styles.logoSection}>
          <div style={styles.logoIcon}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="#10B981" strokeWidth="2"/>
              <path d="M8 12l2 2 4-4" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span style={styles.logoText}>BookingPro</span>
        </div>

        {/* 검색 */}
        <div style={styles.searchSection}>
          <div style={styles.sidebarSearch}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input type="text" placeholder="Search..." style={styles.sidebarSearchInput} />
          </div>
        </div>

        {/* 메뉴 */}
        <nav style={styles.nav}>
          <p style={styles.menuLabel}>Menu</p>
          
          {[
            { id: 'dashboard', icon: 'grid', label: 'Dashboard' },
            { id: 'performance', icon: 'chart', label: 'Performance' },
            { id: 'statistics', icon: 'bar', label: 'Statistics' },
            { id: 'analytics', icon: 'pie', label: 'Analytics' },
            { id: 'payments', icon: 'card', label: 'Payments', badge: 3 },
          ].map(item => (
            <button
              key={item.id}
              style={{
                ...styles.menuItem,
                ...(activeMenu === item.id ? styles.menuItemActive : {})
              }}
              onClick={() => setActiveMenu(item.id)}
            >
              <MenuIcon name={item.icon} active={activeMenu === item.id} />
              <span style={{
                ...styles.menuText,
                ...(activeMenu === item.id ? styles.menuTextActive : {})
              }}>{item.label}</span>
              {item.badge && (
                <span style={styles.badge}>{item.badge}</span>
              )}
            </button>
          ))}

          <p style={{...styles.menuLabel, marginTop: '24px'}}>Support</p>
          
          {[
            { id: 'help', icon: 'help', label: 'Help' },
            { id: 'settings', icon: 'settings', label: 'Settings' },
          ].map(item => (
            <button
              key={item.id}
              style={{
                ...styles.menuItem,
                ...(activeMenu === item.id ? styles.menuItemActive : {})
              }}
              onClick={() => setActiveMenu(item.id)}
            >
              <MenuIcon name={item.icon} active={activeMenu === item.id} />
              <span style={{
                ...styles.menuText,
                ...(activeMenu === item.id ? styles.menuTextActive : {})
              }}>{item.label}</span>
            </button>
          ))}
        </nav>

        {/* 프로모션 배너 */}
        <div style={styles.promoBanner}>
          <div style={styles.promoIconWrapper}>
            <span style={styles.promoIcon}>💰</span>
          </div>
          <div style={styles.promoContent}>
            <p style={styles.promoTitle}>Build future wealth with smart financial steps today.</p>
            <button style={styles.promoButton}>Start Now</button>
          </div>
          <div style={styles.promoDecoration}></div>
        </div>

        {/* 로그아웃 */}
        <button style={styles.logoutButton}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          <span style={styles.logoutText}>Logout</span>
        </button>
      </aside>

      {/* 메인 콘텐츠 */}
      <main style={styles.main}>
        {/* 헤더 */}
        <header style={styles.header}>
          <div style={styles.headerLeft}>
            <input type="text" placeholder="Search..." style={styles.headerSearch} />
            <svg style={styles.headerSearchIcon} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </div>
          <div style={styles.headerRight}>
            <button style={styles.headerIcon}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
            </button>
            <button style={styles.headerIcon}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
              <span style={styles.notificationDot}></span>
            </button>
            <div style={styles.userSection}>
              <div style={styles.userInfo}>
                <span style={styles.userName}>Admin User</span>
                <span style={styles.userRole}>Property Manager</span>
              </div>
              <div style={styles.userAvatar}>
                <img src="https://i.pravatar.cc/40?img=68" alt="avatar" style={styles.avatarImg} />
              </div>
            </div>
          </div>
        </header>

        {/* 콘텐츠 영역 */}
        <div style={styles.content}>
          {/* KPI 카드 섹션 */}
          <div style={styles.kpiGrid}>
            {/* Revenue Card */}
            <div style={styles.kpiCard}>
              <div style={styles.kpiHeader}>
                <span style={styles.kpiLabel}>Revenue Achieved</span>
                <button style={styles.kpiMore}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2">
                    <circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>
                  </svg>
                </button>
              </div>
              <div style={styles.kpiBody}>
                <div style={styles.kpiValue}>
                  <span style={styles.kpiAmount}>{formatPrice(stats.totalRevenue)}</span>
                  <span style={styles.kpiTarget}>/{formatPrice(stats.totalRevenue * 1.2)}</span>
                </div>
                <div style={styles.kpiMiniChart}>
                  <MiniAreaChart color="#3B82F6" percentage={75} />
                </div>
              </div>
              <div style={styles.kpiFooter}>
                <span style={{
                  ...styles.kpiChange,
                  color: revenueChange >= 0 ? '#10B981' : '#EF4444'
                }}>
                  {revenueChange >= 0 ? '+' : ''}{revenueChange}%
                </span>
                <span style={styles.kpiPeriod}>From last month</span>
              </div>
            </div>

            {/* Occupancy Rate Card */}
            <div style={styles.kpiCard}>
              <div style={styles.kpiHeader}>
                <span style={styles.kpiLabel}>Occupancy Rate (%)</span>
                <button style={styles.kpiMore}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2">
                    <circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>
                  </svg>
                </button>
              </div>
              <div style={styles.kpiBody}>
                <div style={styles.kpiValue}>
                  <span style={styles.kpiAmount}>{stats.occupancyRate.toFixed(0)}</span>
                  <span style={styles.kpiTarget}>/100</span>
                </div>
                <div style={styles.kpiMiniChart}>
                  <MiniGauge percentage={stats.occupancyRate} color="#F59E0B" />
                </div>
              </div>
              <div style={styles.kpiFooter}>
                <span style={{
                  ...styles.kpiChange,
                  color: occupancyChange >= 0 ? '#10B981' : '#EF4444'
                }}>
                  {occupancyChange >= 0 ? '+' : ''}{occupancyChange}%
                </span>
                <span style={styles.kpiPeriod}>From last month</span>
              </div>
            </div>

            {/* Reservations Card */}
            <div style={styles.kpiCard}>
              <div style={styles.kpiHeader}>
                <span style={styles.kpiLabel}>Total Reservations</span>
                <button style={styles.kpiMore}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2">
                    <circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>
                  </svg>
                </button>
              </div>
              <div style={styles.kpiBody}>
                <div style={styles.kpiValue}>
                  <span style={styles.kpiAmount}>{stats.totalReservations}</span>
                  <span style={styles.kpiTarget}>/{Math.round(stats.totalReservations * 1.15)}</span>
                </div>
                <div style={styles.kpiMiniChart}>
                  <MiniAreaChart color="#10B981" percentage={85} />
                </div>
              </div>
              <div style={styles.kpiFooter}>
                <span style={{
                  ...styles.kpiChange,
                  color: reservationChange >= 0 ? '#10B981' : '#EF4444'
                }}>
                  {reservationChange >= 0 ? '+' : ''}{reservationChange}%
                </span>
                <span style={styles.kpiPeriod}>From last month</span>
              </div>
            </div>

            {/* Avg Price Card */}
            <div style={styles.kpiCard}>
              <div style={styles.kpiHeader}>
                <span style={styles.kpiLabel}>Avg. Price (¥)</span>
                <button style={styles.kpiMore}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2">
                    <circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>
                  </svg>
                </button>
              </div>
              <div style={styles.kpiBody}>
                <div style={styles.kpiValue}>
                  <span style={styles.kpiAmount}>{formatPrice(stats.avgPrice)}</span>
                  <span style={styles.kpiTarget}>/{formatPrice(stats.avgPrice * 1.1)}</span>
                </div>
                <div style={styles.kpiMiniChart}>
                  <MiniGauge percentage={65} color="#8B5CF6" />
                </div>
              </div>
              <div style={styles.kpiFooter}>
                <span style={{
                  ...styles.kpiChange,
                  color: avgPriceChange >= 0 ? '#10B981' : '#EF4444'
                }}>
                  {avgPriceChange >= 0 ? '+' : ''}{avgPriceChange}%
                </span>
                <span style={styles.kpiPeriod}>From last month</span>
              </div>
            </div>
          </div>

          {/* 차트 & 테이블 섹션 */}
          <div style={styles.mainGrid}>
            {/* 왼쪽 컬럼 */}
            <div style={styles.leftColumn}>
              {/* Performance Summary */}
              <div style={styles.chartCard}>
                <div style={styles.chartHeader}>
                  <h3 style={styles.chartTitle}>Performance Summary</h3>
                  <div style={styles.chartLegend}>
                    <span style={styles.legendItem}>
                      <span style={{...styles.legendDot, background: 'linear-gradient(180deg, #3B82F6 0%, #1E40AF 100%)'}}></span>
                      Revenue
                    </span>
                    <span style={styles.legendItem}>
                      <span style={{...styles.legendDot, background: '#E5E7EB'}}></span>
                      Expenses
                    </span>
                    <span style={{...styles.legendItem, color: '#EF4444'}}>Profit / Loss</span>
                    <select style={styles.chartSelect}>
                      <option>Weekly</option>
                      <option>Monthly</option>
                    </select>
                  </div>
                </div>
                <div style={styles.chartBody}>
                  <BarChart data={buildingStats} />
                </div>
              </div>

              {/* Top Buildings Table */}
              <div style={styles.tableCard}>
                <div style={styles.tableHeader}>
                  <h3 style={styles.tableTitle}>Top Buildings</h3>
                  <select style={styles.chartSelect}>
                    <option>Monthly</option>
                    <option>Weekly</option>
                  </select>
                </div>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Building Name</th>
                      <th style={styles.th}>Total Revenue</th>
                      <th style={styles.th}>Avg. Spend</th>
                      <th style={styles.th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buildingStats.slice(0, 4).map((building, index) => (
                      <tr key={building.name} style={styles.tr}>
                        <td style={styles.td}>
                          <span style={styles.buildingName}>{building.name}</span>
                        </td>
                        <td style={styles.td}>{formatPrice(building.revenue)}</td>
                        <td style={styles.td}>{formatPrice(building.avgSpend)}/mo</td>
                        <td style={styles.td}>
                          <span style={{
                            ...styles.statusBadge,
                            backgroundColor: building.status === 'Active' ? '#D1FAE5' : building.status === 'Good' ? '#FEF3C7' : '#FEE2E2',
                            color: building.status === 'Active' ? '#059669' : building.status === 'Good' ? '#D97706' : '#DC2626'
                          }}>
                            {building.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 오른쪽 컬럼 */}
            <div style={styles.rightColumn}>
              {/* Platform Distribution */}
              <div style={styles.sideCard}>
                <div style={styles.sideCardHeader}>
                  <h3 style={styles.sideCardTitle}>Platform Distribution</h3>
                  <button style={styles.kpiMore}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2">
                      <circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>
                    </svg>
                  </button>
                </div>
                <div style={styles.donutContainer}>
                  <DonutChart airbnb={platformStats.airbnb} booking={platformStats.booking} />
                </div>
                <div style={styles.platformLegend}>
                  <div style={styles.platformItem}>
                    <span style={{...styles.platformDot, backgroundColor: '#FF5A5F'}}></span>
                    <span style={styles.platformName}>Airbnb</span>
                    <span style={styles.platformValue}>{formatPrice(stats.totalRevenue * 0.6)} ({Math.round(platformStats.airbnb / (platformStats.airbnb + platformStats.booking || 1) * 100)}%)</span>
                  </div>
                  <div style={styles.platformItem}>
                    <span style={{...styles.platformDot, backgroundColor: '#003580'}}></span>
                    <span style={styles.platformName}>Booking.com</span>
                    <span style={styles.platformValue}>{formatPrice(stats.totalRevenue * 0.4)} ({Math.round(platformStats.booking / (platformStats.airbnb + platformStats.booking || 1) * 100)}%)</span>
                  </div>
                </div>
              </div>

              {/* Monthly Goal */}
              <div style={styles.sideCard}>
                <div style={styles.sideCardHeader}>
                  <h3 style={styles.sideCardTitle}>Monthly Goal Progress</h3>
                  <button style={styles.kpiMore}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2">
                      <path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/>
                    </svg>
                  </button>
                </div>
                <div style={styles.goalList}>
                  <div style={styles.goalItem}>
                    <div style={styles.goalIcon}>📊</div>
                    <div style={styles.goalInfo}>
                      <span style={styles.goalLabel}>Monthly Revenue Goal</span>
                      <div style={styles.goalProgress}>
                        <div style={{...styles.goalBar, width: '75%', backgroundColor: '#3B82F6'}}></div>
                      </div>
                    </div>
                    <span style={styles.goalPercent}>75%</span>
                  </div>
                  <div style={styles.goalItem}>
                    <div style={styles.goalIcon}>🎯</div>
                    <div style={styles.goalInfo}>
                      <span style={styles.goalLabel}>Occupancy Target</span>
                      <div style={styles.goalProgress}>
                        <div style={{...styles.goalBar, width: '85%', backgroundColor: '#10B981'}}></div>
                      </div>
                    </div>
                    <span style={styles.goalPercent}>85%</span>
                  </div>
                  <div style={styles.goalItem}>
                    <div style={styles.goalIcon}>⭐</div>
                    <div style={styles.goalInfo}>
                      <span style={styles.goalLabel}>Review Score</span>
                      <div style={styles.goalProgress}>
                        <div style={{...styles.goalBar, width: '92%', backgroundColor: '#F59E0B'}}></div>
                      </div>
                    </div>
                    <span style={styles.goalPercent}>92%</span>
                  </div>
                </div>
                <div style={styles.goalSummary}>
                  <p style={styles.goalSummaryText}>
                    Target: <strong>{formatPrice(stats.totalRevenue * 1.2)}</strong> to hit monthly goal.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

// 메뉴 아이콘 컴포넌트
const MenuIcon = ({ name, active }) => {
  const color = active ? '#FFFFFF' : '#6B7280';
  const icons = {
    grid: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
        <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
        <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
      </svg>
    ),
    chart: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
        <path d="M21 21H4.6c-.56 0-.84 0-1.054-.109a1 1 0 0 1-.437-.437C3 20.24 3 19.96 3 19.4V3"/>
        <path d="m7 14 4-4 4 4 6-6"/>
      </svg>
    ),
    bar: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
        <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
      </svg>
    ),
    pie: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
        <path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>
      </svg>
    ),
    card: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
        <rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>
      </svg>
    ),
    help: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
        <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    ),
    settings: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
        <circle cx="12" cy="12" r="3"/><path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
      </svg>
    )
  };
  return icons[name] || null;
};

// 미니 에어리어 차트
const MiniAreaChart = ({ color, percentage }) => (
  <svg width="80" height="40" viewBox="0 0 80 40">
    <defs>
      <linearGradient id={`gradient-${color}`} x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor={color} stopOpacity="0.3"/>
        <stop offset="100%" stopColor={color} stopOpacity="0"/>
      </linearGradient>
    </defs>
    <path
      d={`M0,35 Q10,${35 - percentage * 0.3} 20,${30 - percentage * 0.2} T40,${25 - percentage * 0.15} T60,${20 - percentage * 0.1} T80,${15 - percentage * 0.05} V40 H0 Z`}
      fill={`url(#gradient-${color})`}
    />
    <path
      d={`M0,35 Q10,${35 - percentage * 0.3} 20,${30 - percentage * 0.2} T40,${25 - percentage * 0.15} T60,${20 - percentage * 0.1} T80,${15 - percentage * 0.05}`}
      fill="none"
      stroke={color}
      strokeWidth="2"
    />
  </svg>
);

// 미니 게이지 차트
const MiniGauge = ({ percentage, color }) => {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;
  
  return (
    <svg width="50" height="50" viewBox="0 0 50 50">
      <circle cx="25" cy="25" r={radius} fill="none" stroke="#E5E7EB" strokeWidth="4"/>
      <circle
        cx="25" cy="25" r={radius}
        fill="none" stroke={color} strokeWidth="4"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 25 25)"
      />
      <text x="25" y="29" textAnchor="middle" fontSize="12" fontWeight="600" fill="#1F2937">
        {percentage}%
      </text>
    </svg>
  );
};

// 막대 차트
const BarChart = ({ data }) => {
  const maxRevenue = Math.max(...data.map(d => d.revenue), 1);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', height: '200px', padding: '20px 0' }}>
      {days.map((day, index) => {
        const item = data[index] || { revenue: Math.random() * maxRevenue * 0.8 };
        const height = (item.revenue / maxRevenue) * 150 || Math.random() * 100 + 50;
        const change = Math.round((Math.random() - 0.5) * 20);
        
        return (
          <div key={day} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
            <div style={{ position: 'relative' }}>
              {change !== 0 && (
                <span style={{
                  position: 'absolute',
                  top: '-24px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  fontSize: '11px',
                  fontWeight: '600',
                  color: change > 0 ? '#10B981' : '#EF4444',
                  whiteSpace: 'nowrap'
                }}>
                  {change > 0 ? '+' : ''}{change}%
                </span>
              )}
              <div style={{
                width: '40px',
                height: `${height}px`,
                background: 'linear-gradient(180deg, #60A5FA 0%, #2563EB 100%)',
                borderRadius: '6px 6px 0 0',
                position: 'relative'
              }}>
                <div style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: '30%',
                  backgroundColor: '#E5E7EB',
                  borderRadius: '0 0 0 0'
                }}/>
              </div>
            </div>
            <span style={{ fontSize: '12px', color: '#6B7280' }}>{day}</span>
          </div>
        );
      })}
    </div>
  );
};

// 도넛 차트
const DonutChart = ({ airbnb, booking }) => {
  const total = airbnb + booking || 1;
  const airbnbPercent = (airbnb / total) * 100;
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  
  return (
    <svg width="160" height="160" viewBox="0 0 160 160">
      {/* Booking.com */}
      <circle
        cx="80" cy="80" r={radius}
        fill="none" stroke="#003580" strokeWidth="20"
        strokeDasharray={circumference}
        strokeDashoffset={0}
        transform="rotate(-90 80 80)"
      />
      {/* Airbnb */}
      <circle
        cx="80" cy="80" r={radius}
        fill="none" stroke="#FF5A5F" strokeWidth="20"
        strokeDasharray={`${(airbnbPercent / 100) * circumference} ${circumference}`}
        strokeDashoffset={0}
        transform="rotate(-90 80 80)"
      />
      {/* Center text */}
      <text x="80" y="75" textAnchor="middle" fontSize="20" fontWeight="700" fill="#1F2937">
        {total}
      </text>
      <text x="80" y="95" textAnchor="middle" fontSize="12" fill="#6B7280">
        Total
      </text>
    </svg>
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
  
  // 로딩
  loadingContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    backgroundColor: '#F9FAFB'
  },
  loadingSpinner: {
    textAlign: 'center'
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '3px solid #E5E7EB',
    borderTop: '3px solid #3B82F6',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    margin: '0 auto 16px'
  },
  loadingText: {
    color: '#6B7280',
    fontSize: '14px'
  },

  // 사이드바
  sidebar: {
    width: '260px',
    backgroundColor: '#FFFFFF',
    borderRight: '1px solid #E5E7EB',
    display: 'flex',
    flexDirection: 'column',
    padding: '24px 16px',
    position: 'fixed',
    height: '100vh',
    overflowY: 'auto'
  },
  logoSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '24px',
    paddingLeft: '8px'
  },
  logoIcon: {
    width: '36px',
    height: '36px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  logoText: {
    fontSize: '20px',
    fontWeight: '700',
    color: '#1F2937'
  },
  searchSection: {
    marginBottom: '24px'
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
  nav: {
    flex: 1
  },
  menuLabel: {
    fontSize: '12px',
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
    padding: '12px',
    border: 'none',
    backgroundColor: 'transparent',
    borderRadius: '10px',
    cursor: 'pointer',
    marginBottom: '4px',
    transition: 'all 0.2s'
  },
  menuItemActive: {
    backgroundColor: '#1F2937'
  },
  menuText: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#4B5563',
    flex: 1,
    textAlign: 'left'
  },
  menuTextActive: {
    color: '#FFFFFF'
  },
  badge: {
    backgroundColor: '#10B981',
    color: '#FFFFFF',
    fontSize: '11px',
    fontWeight: '600',
    padding: '2px 8px',
    borderRadius: '10px'
  },
  promoBanner: {
    backgroundColor: '#F0FDF4',
    borderRadius: '16px',
    padding: '20px',
    marginTop: '24px',
    position: 'relative',
    overflow: 'hidden'
  },
  promoIconWrapper: {
    marginBottom: '12px'
  },
  promoIcon: {
    fontSize: '32px'
  },
  promoContent: {},
  promoTitle: {
    fontSize: '13px',
    color: '#1F2937',
    lineHeight: '1.5',
    marginBottom: '16px'
  },
  promoButton: {
    backgroundColor: '#10B981',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '8px',
    padding: '10px 20px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  promoDecoration: {
    position: 'absolute',
    right: '-20px',
    bottom: '-20px',
    width: '80px',
    height: '80px',
    backgroundColor: '#86EFAC',
    borderRadius: '50%',
    opacity: '0.5'
  },
  logoutButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px',
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    marginTop: '16px'
  },
  logoutText: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#EF4444'
  },

  // 메인
  main: {
    flex: 1,
    marginLeft: '260px'
  },

  // 헤더
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 32px',
    backgroundColor: '#FFFFFF',
    borderBottom: '1px solid #E5E7EB'
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
    overflow: 'hidden'
  },
  avatarImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },

  // 콘텐츠
  content: {
    padding: '24px 32px'
  },

  // KPI 그리드
  kpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '20px',
    marginBottom: '24px'
  },
  kpiCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: '16px',
    padding: '20px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
  },
  kpiHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px'
  },
  kpiLabel: {
    fontSize: '13px',
    color: '#6B7280',
    fontWeight: '500'
  },
  kpiMore: {
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    padding: '4px'
  },
  kpiBody: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px'
  },
  kpiValue: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '4px'
  },
  kpiAmount: {
    fontSize: '24px',
    fontWeight: '700',
    color: '#1F2937'
  },
  kpiTarget: {
    fontSize: '14px',
    color: '#9CA3AF'
  },
  kpiMiniChart: {},
  kpiFooter: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  kpiChange: {
    fontSize: '13px',
    fontWeight: '600'
  },
  kpiPeriod: {
    fontSize: '12px',
    color: '#9CA3AF'
  },

  // 메인 그리드
  mainGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 340px',
    gap: '24px'
  },
  leftColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px'
  },
  rightColumn: {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px'
  },

  // 차트 카드
  chartCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: '16px',
    padding: '24px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
  },
  chartHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px'
  },
  chartTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#1F2937',
    margin: 0
  },
  chartLegend: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px'
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    color: '#6B7280'
  },
  legendDot: {
    width: '10px',
    height: '10px',
    borderRadius: '3px'
  },
  chartSelect: {
    padding: '6px 12px',
    border: '1px solid #E5E7EB',
    borderRadius: '8px',
    fontSize: '12px',
    color: '#6B7280',
    backgroundColor: '#FFFFFF',
    cursor: 'pointer'
  },
  chartBody: {},

  // 테이블
  tableCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: '16px',
    padding: '24px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
  },
  tableHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px'
  },
  tableTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#1F2937',
    margin: 0
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse'
  },
  th: {
    textAlign: 'left',
    padding: '12px 16px',
    fontSize: '12px',
    fontWeight: '600',
    color: '#6B7280',
    borderBottom: '1px solid #E5E7EB'
  },
  tr: {
    borderBottom: '1px solid #F3F4F6'
  },
  td: {
    padding: '16px',
    fontSize: '14px',
    color: '#1F2937'
  },
  buildingName: {
    fontWeight: '500'
  },
  statusBadge: {
    padding: '4px 12px',
    borderRadius: '20px',
    fontSize: '12px',
    fontWeight: '500'
  },

  // 사이드 카드
  sideCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: '16px',
    padding: '24px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
  },
  sideCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px'
  },
  sideCardTitle: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#1F2937',
    margin: 0
  },
  donutContainer: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '20px'
  },
  platformLegend: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  platformItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px'
  },
  platformDot: {
    width: '12px',
    height: '12px',
    borderRadius: '4px'
  },
  platformName: {
    fontSize: '13px',
    color: '#6B7280',
    flex: 1
  },
  platformValue: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#1F2937'
  },
  goalList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  },
  goalItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  goalIcon: {
    width: '40px',
    height: '40px',
    backgroundColor: '#F3F4F6',
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '18px'
  },
  goalInfo: {
    flex: 1
  },
  goalLabel: {
    fontSize: '13px',
    color: '#6B7280',
    marginBottom: '6px',
    display: 'block'
  },
  goalProgress: {
    height: '6px',
    backgroundColor: '#E5E7EB',
    borderRadius: '3px',
    overflow: 'hidden'
  },
  goalBar: {
    height: '100%',
    borderRadius: '3px'
  },
  goalPercent: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#1F2937'
  },
  goalSummary: {
    marginTop: '20px',
    padding: '16px',
    backgroundColor: '#F9FAFB',
    borderRadius: '10px'
  },
  goalSummaryText: {
    fontSize: '13px',
    color: '#6B7280',
    margin: 0
  }
};

export default DesignPreview;
