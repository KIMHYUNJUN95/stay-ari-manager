// src/components/TodaySummaryDashboard.jsx
// 대기업 수준 메인 대시보드 - 각 기능과 100% 데이터 일치

import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from '../firebase';
import { useUser } from '../contexts/UserContext';

// 건물 이름 영어 매핑 (Performance Dashboard와 동일)
const BUILDING_NAMES_EN = {
  "아라키초A": "Arakicho A",
  "아라키초B": "Arakicho B",
  "다이쿄초": "Daikyocho",
  "가부키초": "Kabukicho",
  "다카다노바바": "Takadanobaba",
  "오쿠보A동": "Okubo A",
  "오쿠보B동": "Okubo B",
  "오쿠보C동": "Okubo C",
  "사노시": "Sano"
};

const getBuildingEN = (name) => BUILDING_NAMES_EN[name] || name;

// 각 건물의 객실 수 (OccupancyRateDashboard와 동일)
const BUILDING_ROOMS = {
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

// ★ 다이쿄초 매각일 (2025-01-25 마지막 운영일)
const DAIKYO_SOLD_DATE = "2026-01-26";

// 예약된 날짜들을 Set으로 계산 (겹침 제거) - OccupancyRateDashboard와 동일
// ★ 베드24 기준: arrival ~ departure 전날까지 점유됨
const getOccupiedDaysSet = (reservations, monthStart, monthEnd) => {
  const occupiedDates = new Set();

  reservations.forEach(r => {
    const resStart = new Date(Math.max(new Date(r.arrival), new Date(monthStart)));
    const resEnd = new Date(r.departure);
    resEnd.setDate(resEnd.getDate() - 1); // departure 전날까지만

    const actualEnd = resEnd > new Date(monthEnd) ? new Date(monthEnd) : resEnd;

    if (resStart <= actualEnd) {
      const current = new Date(resStart);
      while (current <= actualEnd) {
        occupiedDates.add(current.toISOString().slice(0, 10));
        current.setDate(current.getDate() + 1);
      }
    }
  });

  return occupiedDates.size;
};

// 날짜 파싱 (Revenue Dashboard와 동일)
const parseLocalDate = (dateStr) => {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const TodaySummaryDashboard = () => {
  const { companyId } = useUser();
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  
  // ===== 매출 데이터 (Revenue Dashboard Monthly 모드와 동일) =====
  const [revenueData, setRevenueData] = useState({
    currentMonth: 0,      // 이번 달 매출
    lastMonth: 0          // 지난 달 매출
  });

  // ===== 예약 접수 데이터 (Performance Dashboard와 동일) =====
  const [performanceData, setPerformanceData] = useState({
    total: 0,             // 이번 달 예약 접수 건수
    lastMonthTotal: 0,    // 지난 달 예약 접수 건수
    buildings: [],        // 건물별 예약 수
    platforms: { airbnb: 0, booking: 0 },
    platformRevenue: { airbnb: 0, booking: 0 }
  });

  // ===== 숙박 현황 데이터 (Occupancy Dashboard와 동일) =====
  const [occupancyData, setOccupancyData] = useState({
    currentRate: 0,       // 이번 달 가동률 (사노시 제외)
    lastMonthRate: 0,     // 지난 달 가동률 (사노시 제외)
    totalNights: 0,       // 이번 달 총 숙박 일수
    totalSlots: 0         // 이번 달 총 객실×일수
  });

  // ===== 오늘 활동 =====
  const [todayActivity, setTodayActivity] = useState({
    checkins: 0,
    checkouts: 0,
    newBookings: 0
  });

  // ===== 평균 숙박 일수 (이번 달 체크인 확정, 사노시 제외) =====
  const [avgStayData, setAvgStayData] = useState({
    avgNights: 0,
    totalBookings: 0,
    lastMonthAvg: 0
  });

  // ===== Quick Calendar =====
  const [selectedCalendarBuilding, setSelectedCalendarBuilding] = useState("아라키초A");
  const [calendarReservations, setCalendarReservations] = useState([]);

  useEffect(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    
    // 현재 월 범위
    const currentMonthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    const currentMonthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const currentMonthEnd = `${year}-${String(month + 1).padStart(2, '0')}-${new Date(year, month + 1, 0).getDate()}`;
    
    // 지난 월 범위
    const lastMonthYear = month === 0 ? year - 1 : year;
    const lastMonthNum = month === 0 ? 12 : month;
    const lastMonthStr = `${lastMonthYear}-${String(lastMonthNum).padStart(2, '0')}`;
    const lastMonthStart = `${lastMonthYear}-${String(lastMonthNum).padStart(2, '0')}-01`;
    const lastMonthEnd = `${lastMonthYear}-${String(lastMonthNum).padStart(2, '0')}-${new Date(lastMonthYear, lastMonthNum, 0).getDate()}`;
    
    // 오늘 날짜
    const today = `${year}-${String(month + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    
    // 총 객실 수
    const TOTAL_ROOMS = 57;
    const daysInCurrentMonth = new Date(year, month + 1, 0).getDate();
    const daysInLastMonth = new Date(lastMonthYear, lastMonthNum, 0).getDate();

    // ============================================================
    // 🔴 실시간 리스너: confirmed 예약 전체
    // ============================================================
    if (!companyId) {
      console.warn('⚠️ No companyId for TodaySummaryDashboard');
      setLoading(false);
      return;
    }

    const mainQuery = query(
      collection(db, "reservations"),
      where("companyId", "==", companyId),
      where("status", "==", "confirmed")
    );

    const unsubscribeMain = onSnapshot(mainQuery, (snapshot) => {
      const allReservations = snapshot.docs.map(d => d.data());
      console.log(`📊 Dashboard: ${allReservations.length}건 confirmed 예약 로드됨`);

      // ========================================
      // 1️⃣ 매출 계산 (Revenue Dashboard Monthly 로직) + 플랫폼별 동시 집계
      // ========================================
      let currentMonthRevenue = 0;
      let lastMonthRevenue = 0;
      let platformRevenueAirbnb = 0;
      let platformRevenueBooking = 0;

      const currentStart = parseLocalDate(currentMonthStart);
      const currentEnd = parseLocalDate(currentMonthEnd);
      const lastStart = parseLocalDate(lastMonthStart);
      const lastEnd = parseLocalDate(lastMonthEnd);

      allReservations.forEach(doc => {
        if (!doc.arrival || !doc.departure) return;

        const totalPrice = Number(doc.totalPrice || doc.price) || 0;
        const arrivalDate = parseLocalDate(doc.arrival);
        const departureDate = parseLocalDate(doc.departure);
        
        if (!arrivalDate || !departureDate) return;
        
        const totalNights = Math.floor((departureDate - arrivalDate) / (1000 * 60 * 60 * 24));
        if (totalNights <= 0) return;

        const pricePerNight = totalPrice / totalNights;
        const platformName = (doc.platform || '').toLowerCase();

        // 현재 월 overlap 매출 계산
        if (departureDate > currentStart && arrivalDate <= currentEnd) {
          const overlapStart = new Date(Math.max(arrivalDate, currentStart));
          const overlapEndDate = new Date(departureDate);
          overlapEndDate.setDate(overlapEndDate.getDate() - 1);
          const overlapEnd = new Date(Math.min(overlapEndDate, currentEnd));
          
          if (overlapStart <= overlapEnd) {
            const overlapNights = Math.floor((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24)) + 1;
            const monthlyRevenue = pricePerNight * overlapNights;
            currentMonthRevenue += monthlyRevenue;
            
            // ★ 플랫폼별 매출 동시 집계
            if (platformName.includes('booking')) {
              platformRevenueBooking += monthlyRevenue;
            } else {
              platformRevenueAirbnb += monthlyRevenue;
            }
          }
        }

        // 지난 월 overlap 매출 계산
        if (departureDate > lastStart && arrivalDate <= lastEnd) {
          const overlapStart = new Date(Math.max(arrivalDate, lastStart));
          const overlapEndDate = new Date(departureDate);
          overlapEndDate.setDate(overlapEndDate.getDate() - 1);
          const overlapEnd = new Date(Math.min(overlapEndDate, lastEnd));
          
          if (overlapStart <= overlapEnd) {
            const overlapNights = Math.floor((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24)) + 1;
            lastMonthRevenue += pricePerNight * overlapNights;
          }
        }
      });

      // ★ 플랫폼별 매출 반올림 (Monthly Revenue와 합계 일치하도록)
      const totalPlatformRevenue = platformRevenueAirbnb + platformRevenueBooking;
      const roundedTotal = Math.round(currentMonthRevenue);
      const roundedAirbnb = Math.round(platformRevenueAirbnb);
      const roundedBooking = roundedTotal - roundedAirbnb; // 차이 보정

      setRevenueData({
        currentMonth: roundedTotal,
        lastMonth: Math.round(lastMonthRevenue)
      });

      // performanceData에 platformRevenue 저장 (나중에 사용)
      const calculatedPlatformRevenue = { 
        airbnb: roundedAirbnb, 
        booking: roundedBooking 
      };

      // ========================================
      // 2️⃣ 예약 접수 실적 (Performance Dashboard 로직)
      // bookDate 기준, 중복 제거
      // ========================================
      const currentMonthBookings = allReservations.filter(r => {
        const bookTime = r.bookDate || r.firstNight || '';
        return bookTime && typeof bookTime === 'string' && bookTime.startsWith(currentMonthStr);
      });

      const lastMonthBookings = allReservations.filter(r => {
        const bookTime = r.bookDate || r.firstNight || '';
        return bookTime && typeof bookTime === 'string' && bookTime.startsWith(lastMonthStr);
      });

      // 중복 제거 (Performance Dashboard와 동일)
      const deduplicateBookings = (bookings) => {
        const uniqueMap = new Map();
        bookings.forEach(r => {
          const key = r.bookId || r.refNum || `${r.guestName}_${r.firstNight}`;
          if (!uniqueMap.has(key)) {
            uniqueMap.set(key, r);
          }
        });
        return Array.from(uniqueMap.values());
      };

      const uniqueCurrentBookings = deduplicateBookings(currentMonthBookings);
      const uniqueLastBookings = deduplicateBookings(lastMonthBookings);

      // 건물별 통계 (예약 접수 기준)
      const buildingCount = {};
      const platformCount = { airbnb: 0, booking: 0 };

      uniqueCurrentBookings.forEach(r => {
        const building = r.building || "Unknown";
        buildingCount[building] = (buildingCount[building] || 0) + 1;

        const platformName = (r.platform || '').toLowerCase();
        
        if (platformName.includes('booking')) {
          platformCount.booking++;
        } else {
          platformCount.airbnb++;
        }
      });

      // ★ 플랫폼별 매출은 위 1️⃣에서 이미 계산됨 (calculatedPlatformRevenue)

      const buildingStats = Object.entries(buildingCount)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);

      setPerformanceData({
        total: uniqueCurrentBookings.length,
        lastMonthTotal: uniqueLastBookings.length,
        buildings: buildingStats,
        platforms: platformCount,
        platformRevenue: calculatedPlatformRevenue
      });

      // ========================================
      // 3️⃣ 가동률 계산 (OccupancyRateDashboard와 100% 동일한 로직)
      // ★ 사노시 제외, 실제 점유 날짜 Set 계산
      // ========================================
      let currentOccupiedDays = 0;
      let currentAvailableDays = 0;
      let lastOccupiedDays = 0;
      let lastAvailableDays = 0;

      Object.keys(BUILDING_ROOMS).forEach(building => {
        // ★ 사노시는 전체 가동률 계산에서 제외 (독채 + 다른 업체 운영)
        if (building === "사노시") return;

        const rooms = BUILDING_ROOMS[building];
        rooms.forEach(room => {
          // 현재 월 가동률 계산
          // ★ 다이쿄초: bookDate가 1/26 이후인 예약만 제외 (1/25 이전 예약은 모두 포함)
          const currentRoomReservations = allReservations.filter(r => {
            const bookDate = r.bookDate || r.arrival;
            return r.building === building &&
              r.room === room &&
              r.arrival <= currentMonthEnd &&
              r.departure >= currentMonthStart &&
              !(building === "다이쿄초" && bookDate >= DAIKYO_SOLD_DATE);
          });
          currentOccupiedDays += getOccupiedDaysSet(currentRoomReservations, currentMonthStart, currentMonthEnd);
          currentAvailableDays += daysInCurrentMonth;

          // 지난 월 가동률 계산
          // ★ 다이쿄초: bookDate가 1/26 이후인 예약만 제외 (1/25 이전 예약은 모두 포함)
          const lastRoomReservations = allReservations.filter(r => {
            const bookDate = r.bookDate || r.arrival;
            return r.building === building &&
              r.room === room &&
              r.arrival <= lastMonthEnd &&
              r.departure >= lastMonthStart &&
              !(building === "다이쿄초" && bookDate >= DAIKYO_SOLD_DATE);
          });
          lastOccupiedDays += getOccupiedDaysSet(lastRoomReservations, lastMonthStart, lastMonthEnd);
          lastAvailableDays += daysInLastMonth;
        });
      });

      const currentOccupancy = currentAvailableDays > 0 ? (currentOccupiedDays / currentAvailableDays * 100) : 0;
      const lastOccupancy = lastAvailableDays > 0 ? (lastOccupiedDays / lastAvailableDays * 100) : 0;

      setOccupancyData({
        currentRate: parseFloat(currentOccupancy.toFixed(1)),
        lastMonthRate: parseFloat(lastOccupancy.toFixed(1)),
        totalNights: currentOccupiedDays,
        totalSlots: currentAvailableDays
      });

      // ========================================
      // 4️⃣ 오늘 활동
      // ========================================
      const todayCheckins = allReservations.filter(r => r.arrival === today).length;
      const todayCheckouts = allReservations.filter(r => r.departure === today).length;
      const todayNewBookings = allReservations.filter(r => r.bookDate === today).length;

      setTodayActivity({
        checkins: todayCheckins,
        checkouts: todayCheckouts,
        newBookings: todayNewBookings
      });

      // ========================================
      // 5️⃣ 평균 숙박 일수 (이번 달 체크인 확정, 사노시 제외, 0엔 제외)
      // ========================================
      // 이번 달 체크인 + 사노시 제외 + 다이쿄초 bookDate 1/26 이후 제외 + 0엔 수기예약 제외
      const thisMonthCheckins = allReservations.filter(r => {
        const bookDate = r.bookDate || r.arrival;
        return r.arrival &&
          r.arrival.startsWith(currentMonthStr) &&
          r.building !== "사노시" &&
          !(r.building === "다이쿄초" && bookDate >= DAIKYO_SOLD_DATE) &&
          Number(r.totalPrice || r.price || 0) > 0;
      });

      // 지난 달 체크인 + 사노시 제외 + 다이쿄초 bookDate 1/26 이후 제외 + 0엔 수기예약 제외
      const lastMonthCheckins = allReservations.filter(r => {
        const bookDate = r.bookDate || r.arrival;
        return r.arrival &&
          r.arrival.startsWith(lastMonthStr) &&
          r.building !== "사노시" &&
          !(r.building === "다이쿄초" && bookDate >= DAIKYO_SOLD_DATE) &&
          Number(r.totalPrice || r.price || 0) > 0;
      });

      // 이번 달 평균 숙박 일수
      const thisMonthNightsSum = thisMonthCheckins.reduce((sum, r) => 
        sum + Number(r.nights || 0), 0
      );
      const thisMonthAvgNights = thisMonthCheckins.length > 0 
        ? thisMonthNightsSum / thisMonthCheckins.length 
        : 0;

      // 지난 달 평균 숙박 일수
      const lastMonthNightsSum = lastMonthCheckins.reduce((sum, r) => 
        sum + Number(r.nights || 0), 0
      );
      const lastMonthAvgNights = lastMonthCheckins.length > 0 
        ? lastMonthNightsSum / lastMonthCheckins.length 
        : 0;

      setAvgStayData({
        avgNights: parseFloat(thisMonthAvgNights.toFixed(1)),
        totalBookings: thisMonthCheckins.length,
        lastMonthAvg: parseFloat(lastMonthAvgNights.toFixed(1))
      });

      // ========================================
      // 6️⃣ Quick Calendar 데이터 (이번 달 예약)
      // ========================================
      const calendarData = allReservations.filter(r => 
        r.arrival && r.departure &&
        r.arrival <= currentMonthEnd &&
        r.departure >= currentMonthStart
      );
      setCalendarReservations(calendarData);

      setLastUpdate(new Date());
      setLoading(false);
    });

    return () => {
      unsubscribeMain();
    };
  }, [companyId]);

  // ========================================
  // 유틸리티 함수
  // ========================================
  const formatPrice = (price) => `¥${Math.round(price).toLocaleString()}`;
  
  const getChangePercent = (current, previous) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100);
  };

  const revenueChange = getChangePercent(revenueData.currentMonth, revenueData.lastMonth);
  const reservationChange = getChangePercent(performanceData.total, performanceData.lastMonthTotal);
  const occupancyChange = getChangePercent(occupancyData.currentRate, occupancyData.lastMonthRate);
  const avgStayChange = getChangePercent(avgStayData.avgNights, avgStayData.lastMonthAvg);

  // ========================================
  // 로딩 화면
  // ========================================
  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.spinner}></div>
        <p style={styles.loadingText}>Loading Real-time Dashboard...</p>
      </div>
    );
  }

  // ========================================
  // 메인 렌더링
  // ========================================
  return (
    <div style={styles.dashboard}>
      {/* 실시간 인디케이터 */}
      <div style={styles.liveIndicator}>
        <div style={styles.liveIndicatorInner}>
          <div style={styles.liveDot}></div>
          <span style={styles.liveText}>Live</span>
          <span style={styles.liveUpdate}>
            Last sync: {lastUpdate ? lastUpdate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--:--'}
          </span>
        </div>
      </div>

      {/* KPI 카드 */}
      <div style={styles.kpiGrid}>
        {/* 1. 매출 (Revenue Dashboard Monthly와 동일) */}
        <div style={styles.kpiCard}>
          <div style={styles.kpiHeader}>
            <div style={styles.kpiIconWrap}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2">
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
              </svg>
            </div>
            <span style={styles.kpiLabel}>Monthly Revenue</span>
          </div>
          <div style={styles.kpiBody}>
            <span style={styles.kpiAmount}>{formatPrice(revenueData.currentMonth)}</span>
          </div>
          <div style={styles.kpiFooter}>
            <span style={{
              ...styles.kpiChange,
              color: revenueChange >= 0 ? '#10B981' : '#EF4444'
            }}>
              {revenueChange >= 0 ? '↑' : '↓'} {Math.abs(revenueChange)}%
            </span>
            <span style={styles.kpiPeriod}>vs Last Month ({formatPrice(revenueData.lastMonth)})</span>
          </div>
          <div style={styles.kpiSource}>= Revenue Dashboard (Monthly)</div>
        </div>

        {/* 2. 예약 접수 건수 (Performance Dashboard와 동일) */}
        <div style={styles.kpiCard}>
          <div style={styles.kpiHeader}>
            <div style={{...styles.kpiIconWrap, backgroundColor: '#D1FAE5'}}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14,2 14,8 20,8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
            </div>
            <span style={styles.kpiLabel}>Bookings Received</span>
          </div>
          <div style={styles.kpiBody}>
            <span style={styles.kpiAmount}>{performanceData.total}</span>
            <span style={styles.kpiUnit}>reservations</span>
          </div>
          <div style={styles.kpiFooter}>
            <span style={{
              ...styles.kpiChange,
              color: reservationChange >= 0 ? '#10B981' : '#EF4444'
            }}>
              {reservationChange >= 0 ? '↑' : '↓'} {Math.abs(reservationChange)}%
            </span>
            <span style={styles.kpiPeriod}>vs Last Month ({performanceData.lastMonthTotal})</span>
          </div>
          <div style={styles.kpiSource}>= Performance Dashboard</div>
        </div>

        {/* 3. 가동률 */}
        <div style={styles.kpiCard}>
          <div style={styles.kpiHeader}>
            <div style={{...styles.kpiIconWrap, backgroundColor: '#FEF3C7'}}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                <polyline points="9,22 9,12 15,12 15,22"/>
              </svg>
            </div>
            <span style={styles.kpiLabel}>Occupancy Rate</span>
          </div>
          <div style={styles.kpiBody}>
            <span style={styles.kpiAmount}>{occupancyData.currentRate.toFixed(1)}%</span>
          </div>
          <div style={styles.kpiFooter}>
            <span style={{
              ...styles.kpiChange,
              color: occupancyChange >= 0 ? '#10B981' : '#EF4444'
            }}>
              {occupancyChange >= 0 ? '↑' : '↓'} {Math.abs(occupancyChange).toFixed(1)}%
            </span>
            <span style={styles.kpiPeriod}>vs Last Month ({occupancyData.lastMonthRate.toFixed(1)}%)</span>
          </div>
          <div style={styles.kpiSource}>= {occupancyData.totalNights} nights / {occupancyData.totalSlots || 0} slots (excl. Sano)</div>
        </div>

        {/* 4. 평균 숙박 일수 (이번 달 체크인 확정, 사노시 제외) */}
        <div style={styles.kpiCard}>
          <div style={styles.kpiHeader}>
            <div style={{...styles.kpiIconWrap, backgroundColor: '#EDE9FE'}}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth="2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
            </div>
            <span style={styles.kpiLabel}>Avg. Stay Length</span>
          </div>
          <div style={styles.kpiBody}>
            <span style={styles.kpiAmount}>{avgStayData.avgNights}</span>
            <span style={styles.kpiUnit}>nights</span>
          </div>
          <div style={styles.kpiFooter}>
            <span style={{
              ...styles.kpiChange,
              color: avgStayChange >= 0 ? '#10B981' : '#EF4444'
            }}>
              {avgStayChange >= 0 ? '↑' : '↓'} {Math.abs(avgStayChange)}%
            </span>
            <span style={styles.kpiPeriod}>vs Last Month ({avgStayData.lastMonthAvg} nights)</span>
          </div>
          <div style={styles.kpiSource}>= {avgStayData.totalBookings} check-ins (excl. Sano)</div>
        </div>
      </div>

      {/* 메인 그리드 */}
      <div style={styles.mainGrid}>
        {/* 왼쪽: 건물별 + 테이블 */}
        <div style={styles.leftColumn}>
          {/* 건물별 예약 그래프 (Performance Dashboard와 동일 데이터) */}
          <div style={styles.chartCard}>
            <div style={styles.chartHeader}>
              <h3 style={styles.chartTitle}>Building Performance</h3>
              <span style={styles.chartSubtitle}>= Performance Dashboard Data</span>
            </div>
            <div style={styles.barChartContainer}>
              {performanceData.buildings.slice(0, 8).map((building, idx) => {
                const maxCount = Math.max(...performanceData.buildings.map(b => b.count), 1);
                const percentage = (building.count / maxCount) * 100;
                
                return (
                  <div key={building.name} style={styles.barRow}>
                    <div style={styles.barLabel}>{getBuildingEN(building.name)}</div>
                    <div style={styles.barTrack}>
                      <div style={{
                        ...styles.barFill,
                        width: `${percentage}%`,
                        background: idx < 3 
                          ? 'linear-gradient(90deg, #3B82F6 0%, #1D4ED8 100%)'
                          : 'linear-gradient(90deg, #60A5FA 0%, #3B82F6 100%)'
                      }}></div>
                    </div>
                    <div style={styles.barValue}>{building.count}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quick Calendar */}
          <div style={styles.tableCard}>
            <div style={styles.tableHeader}>
              <h3 style={styles.tableTitle}>📅 Quick Calendar</h3>
              <span style={styles.chartSubtitle}>
                {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </span>
            </div>
            
            {/* 건물 선택 버튼 */}
            <div style={styles.buildingButtons}>
              {Object.keys(BUILDING_ROOMS).filter(b => b !== "사노시").map(building => (
                <button
                  key={building}
                  onClick={() => setSelectedCalendarBuilding(building)}
                  style={{
                    ...styles.buildingBtn,
                    backgroundColor: selectedCalendarBuilding === building ? '#3B82F6' : '#F3F4F6',
                    color: selectedCalendarBuilding === building ? '#FFFFFF' : '#374151'
                  }}
                >
                  {getBuildingEN(building)}
                </button>
              ))}
            </div>

            {/* 미니 캘린더 */}
            <MiniCalendar 
              building={selectedCalendarBuilding}
              reservations={calendarReservations}
              rooms={BUILDING_ROOMS[selectedCalendarBuilding] || []}
            />
          </div>
        </div>

        {/* 오른쪽: 플랫폼 + 오늘 활동 */}
        <div style={styles.rightColumn}>
          {/* 플랫폼 분포 (Performance Dashboard와 동일 데이터) */}
          <div style={styles.sideCard}>
            <div style={styles.sideCardHeader}>
              <h3 style={styles.sideCardTitle}>Platform Distribution</h3>
              <span style={styles.chartSubtitle}>= Performance Data</span>
            </div>
            <div style={styles.donutContainer}>
              <DonutChart 
                airbnb={performanceData.platforms.airbnb} 
                booking={performanceData.platforms.booking}
                total={performanceData.total}
              />
            </div>
            <div style={styles.platformLegend}>
              <div style={styles.platformItem}>
                <span style={{...styles.platformDot, backgroundColor: '#FF5A5F'}}></span>
                <span style={styles.platformName}>Airbnb</span>
                <span style={styles.platformValue}>
                  {performanceData.platforms.airbnb} ({performanceData.total > 0 ? Math.round(performanceData.platforms.airbnb / performanceData.total * 100) : 0}%)
                </span>
              </div>
              <div style={styles.platformItem}>
                <span style={{...styles.platformDot, backgroundColor: '#003580'}}></span>
                <span style={styles.platformName}>Booking.com</span>
                <span style={styles.platformValue}>
                  {performanceData.platforms.booking} ({performanceData.total > 0 ? Math.round(performanceData.platforms.booking / performanceData.total * 100) : 0}%)
                </span>
              </div>
            </div>
          </div>

          {/* 오늘 활동 */}
          <div style={styles.sideCard}>
            <div style={styles.sideCardHeader}>
              <h3 style={styles.sideCardTitle}>Today's Activity</h3>
              <span style={styles.todayDate}>
                {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            </div>
            <div style={styles.todayGrid}>
              <div style={styles.todayItem}>
                <div style={{...styles.todayIcon, backgroundColor: '#D1FAE5'}}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                    <polyline points="16,17 21,12 16,7"/>
                    <line x1="21" y1="12" x2="9" y2="12"/>
                  </svg>
                </div>
                <div style={styles.todayInfo}>
                  <span style={styles.todayLabel}>Check-in</span>
                  <span style={styles.todayValue}>{todayActivity.checkins}</span>
                </div>
              </div>
              <div style={styles.todayItem}>
                <div style={{...styles.todayIcon, backgroundColor: '#DBEAFE'}}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                    <polyline points="16,17 21,12 16,7"/>
                    <line x1="21" y1="12" x2="9" y2="12"/>
                  </svg>
                </div>
                <div style={styles.todayInfo}>
                  <span style={styles.todayLabel}>Check-out</span>
                  <span style={styles.todayValue}>{todayActivity.checkouts}</span>
                </div>
              </div>
              <div style={styles.todayItem}>
                <div style={{...styles.todayIcon, backgroundColor: '#EDE9FE'}}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14,2 14,8 20,8"/>
                    <line x1="12" y1="18" x2="12" y2="12"/>
                    <line x1="9" y1="15" x2="15" y2="15"/>
                  </svg>
                </div>
                <div style={styles.todayInfo}>
                  <span style={styles.todayLabel}>New Bookings</span>
                  <span style={styles.todayValue}>{todayActivity.newBookings}</span>
                </div>
              </div>
            </div>
          </div>

          {/* 플랫폼별 매출 */}
          <div style={styles.sideCard}>
            <div style={styles.sideCardHeader}>
              <h3 style={styles.sideCardTitle}>Platform Revenue</h3>
            </div>
            <div style={styles.platformRevenueList}>
              <div style={styles.platformRevenueItem}>
                <div style={styles.platformRevenueIcon}>
                  <div style={{width: '32px', height: '32px', borderRadius: '8px', backgroundColor: '#FF5A5F', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                    <span style={{color: 'white', fontWeight: '700', fontSize: '12px'}}>Air</span>
                  </div>
                </div>
                <div style={styles.platformRevenueInfo}>
                  <span style={styles.platformRevenueName}>Airbnb</span>
                  <span style={styles.platformRevenueValue}>{formatPrice(performanceData.platformRevenue.airbnb)}</span>
                </div>
              </div>
              <div style={styles.platformRevenueItem}>
                <div style={styles.platformRevenueIcon}>
                  <div style={{width: '32px', height: '32px', borderRadius: '8px', backgroundColor: '#003580', display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                    <span style={{color: 'white', fontWeight: '700', fontSize: '10px'}}>B.com</span>
                  </div>
                </div>
                <div style={styles.platformRevenueInfo}>
                  <span style={styles.platformRevenueName}>Booking.com</span>
                  <span style={styles.platformRevenueValue}>{formatPrice(performanceData.platformRevenue.booking)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// 객실명 영어 변환 (한글 "호" 제거, Room 접두어)
const formatRoomName = (room) => {
  // "201호" -> "201", "B01호" -> "B01"
  return room.replace('호', '');
};

// 미니 캘린더 컴포넌트
const MiniCalendar = ({ building, reservations, rooms }) => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = now.getDate();

  // 해당 건물의 예약만 필터링
  const buildingReservations = reservations.filter(r => r.building === building);

  // 플랫폼별 색상
  const getReservationColor = (platform) => {
    const p = (platform || '').toLowerCase();
    if (p.includes('booking')) return '#003580';
    return '#FF5A5F'; // Airbnb
  };

  // 특정 날짜에 예약이 있는지 확인
  const getReservationForCell = (room, day) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return buildingReservations.find(r => 
      r.room === room && 
      r.arrival <= dateStr && 
      r.departure > dateStr
    );
  };

  // 날짜 헤더 생성 (1~말일)
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  return (
    <div style={miniCalStyles.container}>
      <div style={miniCalStyles.scrollWrapper}>
        <div style={miniCalStyles.grid}>
          {/* 헤더 행 - 날짜 */}
          <div style={miniCalStyles.headerRow}>
            <div style={miniCalStyles.roomHeader}>Room</div>
            {days.map(day => {
              const date = new Date(year, month, day);
              const isWeekend = date.getDay() === 0 || date.getDay() === 6;
              const isToday = day === today;
              return (
                <div 
                  key={day} 
                  style={{
                    ...miniCalStyles.dayHeader,
                    backgroundColor: isToday ? '#3B82F6' : isWeekend ? '#FEF3C7' : '#F9FAFB',
                    color: isToday ? '#FFFFFF' : isWeekend ? '#D97706' : '#6B7280',
                    flex: 1
                  }}
                >
                  {day}
                </div>
              );
            })}
          </div>

          {/* 객실별 행 */}
          {rooms.map(room => (
            <div key={room} style={miniCalStyles.roomRow}>
              <div style={miniCalStyles.roomName}>{formatRoomName(room)}</div>
              {days.map(day => {
                const reservation = getReservationForCell(room, day);
                const isToday = day === today;
                return (
                  <div 
                    key={day} 
                    style={{
                      ...miniCalStyles.cell,
                      backgroundColor: reservation 
                        ? getReservationColor(reservation.platform)
                        : isToday ? '#EFF6FF' : '#FFFFFF',
                      borderColor: isToday ? '#3B82F6' : '#E5E7EB',
                      flex: 1
                    }}
                    title={reservation ? `${reservation.guestName || 'Guest'}\n${reservation.arrival} ~ ${reservation.departure}` : ''}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* 범례 */}
      <div style={miniCalStyles.legend}>
        <div style={miniCalStyles.legendItem}>
          <span style={{...miniCalStyles.legendDot, backgroundColor: '#FF5A5F'}}></span>
          <span>Airbnb</span>
        </div>
        <div style={miniCalStyles.legendItem}>
          <span style={{...miniCalStyles.legendDot, backgroundColor: '#003580'}}></span>
          <span>Booking</span>
        </div>
        <div style={miniCalStyles.legendItem}>
          <span style={{...miniCalStyles.legendDot, backgroundColor: '#FFFFFF', border: '1px solid #E5E7EB'}}></span>
          <span>Vacant</span>
        </div>
      </div>
    </div>
  );
};

// 미니 캘린더 스타일
const miniCalStyles = {
  container: {
    marginTop: '16px'
  },
  scrollWrapper: {
    overflowX: 'auto',
    borderRadius: '8px',
    border: '1px solid #E5E7EB'
  },
  grid: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%'
  },
  headerRow: {
    display: 'flex',
    position: 'sticky',
    top: 0,
    zIndex: 1,
    width: '100%'
  },
  roomHeader: {
    width: '50px',
    minWidth: '50px',
    padding: '8px 4px',
    fontSize: '10px',
    fontWeight: '600',
    color: '#374151',
    backgroundColor: '#F9FAFB',
    borderBottom: '1px solid #E5E7EB',
    position: 'sticky',
    left: 0,
    zIndex: 2,
    textAlign: 'center'
  },
  dayHeader: {
    minWidth: '18px',
    padding: '6px 1px',
    fontSize: '9px',
    fontWeight: '600',
    textAlign: 'center',
    borderBottom: '1px solid #E5E7EB',
    borderRight: '1px solid #F3F4F6'
  },
  roomRow: {
    display: 'flex',
    width: '100%'
  },
  roomName: {
    width: '50px',
    minWidth: '50px',
    padding: '4px',
    fontSize: '9px',
    fontWeight: '600',
    color: '#374151',
    backgroundColor: '#F9FAFB',
    borderBottom: '1px solid #E5E7EB',
    position: 'sticky',
    left: 0,
    zIndex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  cell: {
    minWidth: '18px',
    height: '20px',
    borderBottom: '1px solid #E5E7EB',
    borderRight: '1px solid #F3F4F6',
    cursor: 'pointer',
    transition: 'opacity 0.15s'
  },
  legend: {
    display: 'flex',
    gap: '16px',
    marginTop: '12px',
    justifyContent: 'center'
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '11px',
    color: '#6B7280'
  },
  legendDot: {
    width: '12px',
    height: '12px',
    borderRadius: '3px'
  }
};

// 도넛 차트
const DonutChart = ({ airbnb, booking, total }) => {
  const totalCount = airbnb + booking || 1;
  const airbnbPercent = (airbnb / totalCount) * 100;
  const radius = 55;
  const circumference = 2 * Math.PI * radius;
  
  return (
    <svg width="150" height="150" viewBox="0 0 150 150">
      <circle
        cx="75" cy="75" r={radius}
        fill="none" stroke="#003580" strokeWidth="18"
        strokeDasharray={circumference}
        strokeDashoffset={0}
        transform="rotate(-90 75 75)"
      />
      <circle
        cx="75" cy="75" r={radius}
        fill="none" stroke="#FF5A5F" strokeWidth="18"
        strokeDasharray={`${(airbnbPercent / 100) * circumference} ${circumference}`}
        strokeDashoffset={0}
        transform="rotate(-90 75 75)"
      />
      <text x="75" y="70" textAnchor="middle" fontSize="22" fontWeight="700" fill="#1F2937">
        {total}
      </text>
      <text x="75" y="90" textAnchor="middle" fontSize="11" fill="#6B7280">
        Total
      </text>
    </svg>
  );
};

// 스타일
const styles = {
  dashboard: {
    padding: '0'
  },
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '400px'
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '3px solid #E5E7EB',
    borderTop: '3px solid #3B82F6',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },
  loadingText: {
    marginTop: '16px',
    color: '#6B7280',
    fontSize: '14px'
  },

  // 실시간 인디케이터
  liveIndicator: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginBottom: '20px'
  },
  liveIndicatorInner: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 20px',
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderRadius: '24px',
    border: '1px solid rgba(16, 185, 129, 0.2)'
  },
  liveDot: {
    width: '10px',
    height: '10px',
    backgroundColor: '#10B981',
    borderRadius: '50%',
    animation: 'pulse 2s infinite',
    boxShadow: '0 0 8px rgba(16, 185, 129, 0.6)'
  },
  liveText: {
    fontSize: '13px',
    fontWeight: '700',
    color: '#059669',
    textTransform: 'uppercase',
    letterSpacing: '1px'
  },
  liveUpdate: {
    fontSize: '12px',
    color: '#6B7280',
    paddingLeft: '10px',
    borderLeft: '1px solid #D1D5DB'
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
    padding: '24px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    border: '1px solid #F3F4F6'
  },
  kpiHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '16px'
  },
  kpiIconWrap: {
    width: '40px',
    height: '40px',
    borderRadius: '12px',
    backgroundColor: '#DBEAFE',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  kpiLabel: {
    fontSize: '13px',
    color: '#6B7280',
    fontWeight: '600'
  },
  kpiBody: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '6px',
    marginBottom: '12px'
  },
  kpiAmount: {
    fontSize: '28px',
    fontWeight: '700',
    color: '#1F2937'
  },
  kpiUnit: {
    fontSize: '14px',
    color: '#9CA3AF'
  },
  kpiFooter: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '8px'
  },
  kpiChange: {
    fontSize: '13px',
    fontWeight: '700'
  },
  kpiPeriod: {
    fontSize: '12px',
    color: '#9CA3AF'
  },
  kpiSource: {
    fontSize: '10px',
    color: '#10B981',
    fontWeight: '500',
    padding: '4px 8px',
    backgroundColor: '#ECFDF5',
    borderRadius: '4px',
    display: 'inline-block'
  },

  // 메인 그리드
  mainGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 360px',
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
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    border: '1px solid #F3F4F6'
  },
  chartHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px'
  },
  chartTitle: {
    fontSize: '16px',
    fontWeight: '700',
    color: '#1F2937',
    margin: 0
  },
  chartSubtitle: {
    fontSize: '11px',
    color: '#10B981',
    fontWeight: '500',
    padding: '4px 8px',
    backgroundColor: '#ECFDF5',
    borderRadius: '4px'
  },

  // 바 차트
  barChartContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  },
  barRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px'
  },
  barLabel: {
    width: '110px',
    fontSize: '13px',
    fontWeight: '500',
    color: '#374151',
    flexShrink: 0
  },
  barTrack: {
    flex: 1,
    height: '24px',
    backgroundColor: '#F3F4F6',
    borderRadius: '6px',
    overflow: 'hidden'
  },
  barFill: {
    height: '100%',
    borderRadius: '6px',
    transition: 'width 0.5s ease'
  },
  barValue: {
    width: '40px',
    fontSize: '14px',
    fontWeight: '700',
    color: '#1F2937',
    textAlign: 'right'
  },

  // 테이블
  tableCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: '16px',
    padding: '24px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    border: '1px solid #F3F4F6'
  },
  tableHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px'
  },
  tableTitle: {
    fontSize: '16px',
    fontWeight: '700',
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
    borderBottom: '1px solid #E5E7EB',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
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
    fontWeight: '600'
  },
  shareBadge: {
    padding: '4px 10px',
    backgroundColor: '#DBEAFE',
    color: '#1D4ED8',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: '600'
  },
  buildingButtons: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    marginBottom: '16px'
  },
  buildingBtn: {
    padding: '8px 14px',
    borderRadius: '8px',
    border: 'none',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s ease'
  },

  // 사이드 카드
  sideCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: '16px',
    padding: '24px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    border: '1px solid #F3F4F6'
  },
  sideCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px'
  },
  sideCardTitle: {
    fontSize: '16px',
    fontWeight: '700',
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
    width: '14px',
    height: '14px',
    borderRadius: '4px'
  },
  platformName: {
    fontSize: '13px',
    color: '#6B7280',
    flex: 1
  },
  platformValue: {
    fontSize: '14px',
    fontWeight: '700',
    color: '#1F2937'
  },

  // Today's Activity
  todayDate: {
    fontSize: '12px',
    color: '#6B7280',
    backgroundColor: '#F3F4F6',
    padding: '6px 12px',
    borderRadius: '8px',
    fontWeight: '500'
  },
  todayGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  },
  todayItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px'
  },
  todayIcon: {
    width: '44px',
    height: '44px',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  todayInfo: {
    flex: 1,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  todayLabel: {
    fontSize: '14px',
    color: '#6B7280'
  },
  todayValue: {
    fontSize: '22px',
    fontWeight: '700',
    color: '#1F2937'
  },

  // Platform Revenue
  platformRevenueList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  },
  platformRevenueItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px'
  },
  platformRevenueIcon: {},
  platformRevenueInfo: {
    flex: 1,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  platformRevenueName: {
    fontSize: '14px',
    color: '#6B7280'
  },
  platformRevenueValue: {
    fontSize: '16px',
    fontWeight: '700',
    color: '#1F2937'
  }
};

// CSS 애니메이션
const styleSheet = document.createElement("style");
styleSheet.innerText = `
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  
  @keyframes pulse {
    0%, 100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.6;
      transform: scale(1.3);
    }
  }
  
  @media (max-width: 1200px) {
    .dashboard-kpi-grid {
      grid-template-columns: repeat(2, 1fr) !important;
    }
    .dashboard-main-grid {
      grid-template-columns: 1fr !important;
    }
  }
  
  @media (max-width: 768px) {
    .dashboard-kpi-grid {
      grid-template-columns: 1fr !important;
    }
  }
`;
document.head.appendChild(styleSheet);

export default TodaySummaryDashboard;
