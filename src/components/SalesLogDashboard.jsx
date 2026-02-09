// src/components/SalesLogDashboard.jsx
// Revenue Analytics Dashboard - Historical Data & Forecasting
import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, query, where, doc, getDoc, setDoc } from "firebase/firestore";
import { db } from '../firebase';

// Building order (excluding Sano)
const BUILDING_ORDER = [
  "아라키초A", "아라키초B", "다이쿄초", "가부키초",
  "다카다노바바", "오쿠보A동", "오쿠보B동", "오쿠보C동"
];

// ★ 다이쿄초 매각일 (2025-01-25 마지막 운영일)
const DAIKYO_SOLD_DATE = "2026-01-26";

// 현재 운영 중인 건물 목록 (날짜 기준)
const getActiveBuildingOrder = (dateStr) => {
  if (dateStr >= DAIKYO_SOLD_DATE) {
    return BUILDING_ORDER.filter(b => b !== "다이쿄초");
  }
  return BUILDING_ORDER;
};

// Room count per building
const BUILDING_ROOMS = {
  "아라키초A": ["201호", "202호", "301호", "302호", "401호", "402호", "501호", "502호", "602호", "701호", "702호"],
  "아라키초B": ["101호", "102호", "201호", "202호", "301호", "302호", "401호", "402호"],
  "다이쿄초": ["B01호", "B02호", "101호", "102호", "201호", "202호", "302호"],
  "가부키초": ["202호", "203호", "302호", "303호", "402호", "403호", "502호", "603호", "802호", "803호"],
  "오쿠보A동": ["오쿠보A"],
  "오쿠보B동": ["오쿠보B"],
  "오쿠보C동": ["오쿠보C"],
  "다카다노바바": ["201호", "301호", "401호", "501호", "601호", "701호", "801호", "901호"]
};

// Building names in English
const BUILDING_NAMES_EN = {
  "아라키초A": "Arakicho A",
  "아라키초B": "Arakicho B",
  "다이쿄초": "Daikyocho",
  "가부키초": "Kabukicho",
  "다카다노바바": "Takadanobaba",
  "오쿠보A동": "Okubo A",
  "오쿠보B동": "Okubo B",
  "오쿠보C동": "Okubo C"
};

// Month names
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES_FULL = ['1 January', '2 February', '3 March', '4 April', '5 May', '6 June', '7 July', '8 August', '9 September', '10 October', '11 November', '12 December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Parse date string to local date
const parseLocalDate = (dateStr) => {
  if (!dateStr) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
};

// Format price
const formatPrice = (price) => {
  if (!price && price !== 0) return "¥0";
  return `¥${Math.round(price).toLocaleString()}`;
};

// Format compact price (millions)
// Format compact price (English)
const formatCompactPrice = (price) => {
  if (!price) return "¥0";
  if (price >= 1000000) return `¥${(price / 1000000).toFixed(1)}M`;
  if (price >= 1000) return `¥${(price / 1000).toFixed(0)}k`;
  return `¥${Math.round(price).toLocaleString()}`;
};

// Get days in month
const getDaysInMonth = (year, month) => {
  return new Date(year, month, 0).getDate();
};

// Calculate occupied days set
const getOccupiedDaysSet = (reservations, monthStart, monthEnd) => {
  const occupiedDates = new Set();

  reservations.forEach(r => {
    const resStart = new Date(Math.max(new Date(r.arrival), new Date(monthStart)));
    const resEnd = new Date(r.departure);
    resEnd.setDate(resEnd.getDate() - 1);

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

const SalesLogDashboard = () => {
  // View mode: daily | monthly
  const [viewMode, setViewMode] = useState("monthly");

  // Selected date
  const today = new Date();
  const [selectedYear, setSelectedYear] = useState(today.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth() + 1);
  const [selectedDay, setSelectedDay] = useState(today.getDate());

  // Data states
  const [allReservations, setAllReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [memo, setMemo] = useState("");
  const [savingMemo, setSavingMemo] = useState(false);

  // Load all data from 2023
  useEffect(() => {
    fetchAllData();
  }, []);

  const fetchAllData = async () => {
    setLoading(true);
    try {
      const q = query(
        collection(db, "reservations"),
        where("status", "==", "confirmed")
      );

      const snapshot = await getDocs(q);
      const reservations = snapshot.docs.map(d => d.data());

      console.log(`📊 Revenue Analytics: ${reservations.length} confirmed reservations loaded`);
      setAllReservations(reservations);
    } catch (error) {
      console.error("Failed to load data:", error);
    } finally {
      setLoading(false);
    }
  };

  // Load memo
  useEffect(() => {
    loadMemo();
  }, [selectedYear, selectedMonth, selectedDay, viewMode]);

  const loadMemo = async () => {
    try {
      const memoKey = viewMode === "daily"
        ? `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`
        : `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;

      const docRef = doc(db, "salesLogMemos", memoKey);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        setMemo(docSnap.data().memo || "");
      } else {
        setMemo("");
      }
    } catch (error) {
      console.error("Failed to load memo:", error);
    }
  };

  // Save memo
  const handleSaveMemo = async () => {
    setSavingMemo(true);
    try {
      const memoKey = viewMode === "daily"
        ? `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`
        : `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;

      await setDoc(doc(db, "salesLogMemos", memoKey), {
        memo,
        updatedAt: new Date().toISOString()
      });
      alert("Memo saved successfully.");
    } catch (error) {
      console.error("Failed to save memo:", error);
      alert("Failed to save memo.");
    } finally {
      setSavingMemo(false);
    }
  };

  // Calculate selected period data
  const selectedData = useMemo(() => {
    if (!allReservations.length) return null;

    let startDate, endDate, daysCount;

    if (viewMode === "daily") {
      startDate = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`;
      endDate = startDate;
      daysCount = 1;
    } else {
      const lastDay = getDaysInMonth(selectedYear, selectedMonth);
      startDate = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`;
      endDate = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      daysCount = lastDay;
    }

    const periodStart = parseLocalDate(startDate);
    const periodEnd = parseLocalDate(endDate);

    // Calculate revenue
    let totalRevenue = 0;
    const buildingRevenueMap = {};

    allReservations.forEach(doc => {
      if (!doc.arrival || !doc.departure) return;

      const bName = doc.building || "Unknown";

      // ★ 다이쿄초: 예약 접수일(bookDate)이 2026-01-26 이후인 경우만 제외
      // 1/25 이전에 예약한 건은 체크인 날짜와 관계없이 모두 포함
      const bookDate = doc.bookDate || doc.arrival; // bookDate 없으면 arrival 사용
      if (bName === "다이쿄초" && bookDate >= DAIKYO_SOLD_DATE) return;

      const totalPrice = Number(doc.totalPrice || doc.price) || 0;
      const arrivalDate = parseLocalDate(doc.arrival);
      const departureDate = parseLocalDate(doc.departure);

      if (!arrivalDate || !departureDate) return;

      const totalNights = Math.floor((departureDate - arrivalDate) / (1000 * 60 * 60 * 24));
      if (totalNights <= 0) return;

      const pricePerNight = totalPrice / totalNights;

      if (departureDate > periodStart && arrivalDate <= periodEnd) {
        const overlapStart = new Date(Math.max(arrivalDate, periodStart));
        const overlapEndDate = new Date(departureDate);
        overlapEndDate.setDate(overlapEndDate.getDate() - 1);
        const overlapEnd = new Date(Math.min(overlapEndDate, periodEnd));

        if (overlapStart <= overlapEnd) {
          const overlapNights = Math.floor((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24)) + 1;
          const overlapRevenue = pricePerNight * overlapNights;

          totalRevenue += overlapRevenue;
          buildingRevenueMap[bName] = (buildingRevenueMap[bName] || 0) + overlapRevenue;
        }
      }
    });

    // Calculate occupancy per building
    const buildingStats = {};
    let totalOccupiedDays = 0;
    let totalAvailableDays = 0;
    let totalReservationCount = 0;

    // ★ 건물 목록 유지 (과거 데이터는 보여야 함)
    BUILDING_ORDER.forEach(building => {
      const rooms = BUILDING_ROOMS[building];
      let buildingOccupiedDays = 0;
      let buildingAvailableDays = rooms.length * daysCount;
      let buildingReservationCount = 0;

      rooms.forEach(room => {
        // ★ 다이쿄초: bookDate가 1/26 이후인 예약만 제외
        const roomReservations = allReservations.filter(r => {
          const bookDate = r.bookDate || r.arrival;
          return r.building === building &&
            r.room === room &&
            r.arrival <= endDate &&
            r.departure > startDate &&
            !(building === "다이쿄초" && bookDate >= DAIKYO_SOLD_DATE);
        });

        const occupiedDays = getOccupiedDaysSet(roomReservations, startDate, endDate);
        buildingOccupiedDays += occupiedDays;

        // ★ 다이쿄초: bookDate가 1/26 이후인 예약만 제외
        const checkinReservations = allReservations.filter(r => {
          const bookDate = r.bookDate || r.arrival;
          return r.building === building &&
            r.room === room &&
            r.arrival >= startDate &&
            r.arrival <= endDate &&
            !(building === "다이쿄초" && bookDate >= DAIKYO_SOLD_DATE);
        });
        buildingReservationCount += checkinReservations.length;
      });

      const occupancyRate = buildingAvailableDays > 0
        ? (buildingOccupiedDays / buildingAvailableDays * 100)
        : 0;

      buildingStats[building] = {
        revenue: Math.round(buildingRevenueMap[building] || 0),
        occupiedDays: buildingOccupiedDays,
        availableDays: buildingAvailableDays,
        occupancyRate: parseFloat(occupancyRate.toFixed(1)),
        reservationCount: buildingReservationCount
      };

      if (buildingOccupiedDays > 0) {
        totalOccupiedDays += buildingOccupiedDays;
        totalAvailableDays += buildingAvailableDays;
      }
      totalReservationCount += buildingReservationCount;
    });

    const totalOccupancyRate = totalAvailableDays > 0
      ? (totalOccupiedDays / totalAvailableDays * 100)
      : 0;

    return {
      startDate,
      endDate,
      daysCount,
      buildings: buildingStats,
      total: {
        revenue: Math.round(totalRevenue),
        occupiedDays: totalOccupiedDays,
        availableDays: totalAvailableDays,
        occupancyRate: parseFloat(totalOccupancyRate.toFixed(1)),
        reservationCount: totalReservationCount
      }
    };
  }, [allReservations, selectedYear, selectedMonth, selectedDay, viewMode]);

  // Calculate occupancy-based revenue prediction (Last 6 months)
  const occupancyRevenueStats = useMemo(() => {
    if (!allReservations.length) return null;

    const CURRENT_TOTAL_ROOMS = BUILDING_ORDER.reduce((sum, b) => sum + BUILDING_ROOMS[b].length, 0);

    const monthlyStats = [];

    // Calculate 6 months ago from today
    const sixMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 5, 1);
    const startYear = sixMonthsAgo.getFullYear();
    const startMonth = sixMonthsAgo.getMonth() + 1;
    const endYear = today.getFullYear();
    const endMonth = today.getMonth() + 1;

    for (let year = startYear; year <= endYear; year++) {
      const mStart = (year === startYear) ? startMonth : 1;
      const mEnd = (year === endYear) ? endMonth : 12;

      for (let month = mStart; month <= mEnd; month++) {
        const lastDay = getDaysInMonth(year, month);
        const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
        const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        const periodStart = parseLocalDate(monthStart);
        const periodEnd = parseLocalDate(monthEnd);

        let monthRevenue = 0;
        allReservations.forEach(doc => {
          if (!doc.arrival || !doc.departure) return;

          const totalPrice = Number(doc.totalPrice || doc.price) || 0;
          const arrivalDate = parseLocalDate(doc.arrival);
          const departureDate = parseLocalDate(doc.departure);

          if (!arrivalDate || !departureDate) return;

          const totalNights = Math.floor((departureDate - arrivalDate) / (1000 * 60 * 60 * 24));
          if (totalNights <= 0) return;

          const pricePerNight = totalPrice / totalNights;

          if (departureDate > periodStart && arrivalDate <= periodEnd) {
            const overlapStart = new Date(Math.max(arrivalDate, periodStart));
            const overlapEndDate = new Date(departureDate);
            overlapEndDate.setDate(overlapEndDate.getDate() - 1);
            const overlapEnd = new Date(Math.min(overlapEndDate, periodEnd));

            if (overlapStart <= overlapEnd) {
              const overlapNights = Math.floor((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24)) + 1;
              monthRevenue += pricePerNight * overlapNights;
            }
          }
        });

        let monthOccupiedDays = 0;
        let monthAvailableDays = 0;

        BUILDING_ORDER.forEach(building => {
          const rooms = BUILDING_ROOMS[building];
          let buildingOccupiedDays = 0;

          rooms.forEach(room => {
            const roomReservations = allReservations.filter(r =>
              r.building === building &&
              r.room === room &&
              r.arrival <= monthEnd &&
              r.departure > monthStart
            );

            buildingOccupiedDays += getOccupiedDaysSet(roomReservations, monthStart, monthEnd);
          });

          if (buildingOccupiedDays > 0) {
            monthOccupiedDays += buildingOccupiedDays;
            monthAvailableDays += rooms.length * lastDay;
          }
        });

        const occupancyRate = monthAvailableDays > 0
          ? (monthOccupiedDays / monthAvailableDays * 100)
          : 0;

        const revenuePerRoomDay = monthAvailableDays > 0
          ? monthRevenue / monthAvailableDays
          : 0;

        if (occupancyRate > 0) {
          monthlyStats.push({
            year,
            month,
            revenue: Math.round(monthRevenue),
            occupancyRate: parseFloat(occupancyRate.toFixed(1)),
            revenuePerRoomDay: Math.round(revenuePerRoomDay),
            activeRooms: Math.round(monthAvailableDays / lastDay)
          });
        }
      }
    }

    const n = monthlyStats.length;
    if (n === 0) {
      return { monthlyStats, regression: null, predictions: [], currentRooms: CURRENT_TOTAL_ROOMS };
    }

    const avgOccupancy = monthlyStats.reduce((sum, m) => sum + m.occupancyRate, 0) / n;
    const avgRevenuePerRoomDay = monthlyStats.reduce((sum, m) => sum + m.revenuePerRoomDay, 0) / n;

    let numerator = 0;
    let denominator = 0;

    monthlyStats.forEach(m => {
      const xDiff = m.occupancyRate - avgOccupancy;
      const yDiff = m.revenuePerRoomDay - avgRevenuePerRoomDay;
      numerator += xDiff * yDiff;
      denominator += xDiff * xDiff;
    });

    const slope = denominator !== 0 ? numerator / denominator : 0;
    const intercept = avgRevenuePerRoomDay - (slope * avgOccupancy);

    const targetRates = [95, 90, 85, 80, 75, 70, 65, 60];
    const predictions = targetRates.map(rate => {
      const predictedPerRoomDay = slope * rate + intercept;
      const predictedMonthly = predictedPerRoomDay * CURRENT_TOTAL_ROOMS * 30;

      return {
        rate,
        revenuePerRoomDay: Math.round(predictedPerRoomDay),
        predictedRevenue: Math.round(predictedMonthly)
      };
    });

    const regression = {
      slope: Math.round(slope),
      intercept: Math.round(intercept),
      avgOccupancy: parseFloat(avgOccupancy.toFixed(1)),
      avgRevenuePerRoomDay: Math.round(avgRevenuePerRoomDay),
      dataCount: n,
      currentRooms: CURRENT_TOTAL_ROOMS
    };

    return {
      monthlyStats,
      regression,
      predictions,
      currentRooms: CURRENT_TOTAL_ROOMS
    };
  }, [allReservations]);

  // Generate daily calendar
  const generateDailyCalendar = () => {
    const firstDay = new Date(selectedYear, selectedMonth - 1, 1).getDay();
    const daysInMonth = getDaysInMonth(selectedYear, selectedMonth);

    const weeks = [];
    let days = [];

    for (let i = 0; i < firstDay; i++) {
      days.push(null);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      days.push(d);
      if (days.length === 7) {
        weeks.push(days);
        days = [];
      }
    }

    while (days.length > 0 && days.length < 7) {
      days.push(null);
    }
    if (days.length > 0) weeks.push(days);

    return weeks;
  };

  // Navigation
  const prevYear = () => setSelectedYear(y => y - 1);
  const nextYear = () => setSelectedYear(y => y + 1);
  const prevMonth = () => {
    if (selectedMonth === 1) {
      setSelectedMonth(12);
      setSelectedYear(y => y - 1);
    } else {
      setSelectedMonth(m => m - 1);
    }
  };
  const nextMonth = () => {
    if (selectedMonth === 12) {
      setSelectedMonth(1);
      setSelectedYear(y => y + 1);
    } else {
      setSelectedMonth(m => m + 1);
    }
  };

  // Get day data for calendar
  const getDayData = (day) => {
    if (!day || !allReservations.length) return null;

    const dateStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayDate = parseLocalDate(dateStr);

    let revenue = 0;
    allReservations.forEach(doc => {
      if (!doc.arrival || !doc.departure) return;

      const totalPrice = Number(doc.totalPrice || doc.price) || 0;
      const arrivalDate = parseLocalDate(doc.arrival);
      const departureDate = parseLocalDate(doc.departure);

      if (!arrivalDate || !departureDate) return;

      const totalNights = Math.floor((departureDate - arrivalDate) / (1000 * 60 * 60 * 24));
      if (totalNights <= 0) return;

      if (arrivalDate <= dayDate && departureDate > dayDate) {
        revenue += totalPrice / totalNights;
      }
    });

    let occupiedRooms = 0;
    let totalRoomsActive = 0;

    BUILDING_ORDER.forEach(building => {
      const rooms = BUILDING_ROOMS[building];
      let buildingOccupied = 0;

      rooms.forEach(room => {
        const hasReservation = allReservations.some(r =>
          r.building === building &&
          r.room === room &&
          r.arrival <= dateStr &&
          r.departure > dateStr
        );
        if (hasReservation) buildingOccupied++;
      });

      if (buildingOccupied > 0) {
        occupiedRooms += buildingOccupied;
        totalRoomsActive += rooms.length;
      }
    });

    const occupancyRate = totalRoomsActive > 0 ? (occupiedRooms / totalRoomsActive * 100) : 0;

    return {
      revenue: Math.round(revenue),
      occupiedRooms,
      occupancyRate: parseFloat(occupancyRate.toFixed(1))
    };
  };

  // Get month data for grid
  const getMonthData = (month) => {
    if (!allReservations.length) return null;

    const lastDay = getDaysInMonth(selectedYear, month);
    const monthStart = `${selectedYear}-${String(month).padStart(2, '0')}-01`;
    const monthEnd = `${selectedYear}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const periodStart = parseLocalDate(monthStart);
    const periodEnd = parseLocalDate(monthEnd);

    let revenue = 0;
    allReservations.forEach(doc => {
      if (!doc.arrival || !doc.departure) return;

      const totalPrice = Number(doc.totalPrice || doc.price) || 0;
      const arrivalDate = parseLocalDate(doc.arrival);
      const departureDate = parseLocalDate(doc.departure);

      if (!arrivalDate || !departureDate) return;

      const totalNights = Math.floor((departureDate - arrivalDate) / (1000 * 60 * 60 * 24));
      if (totalNights <= 0) return;

      const pricePerNight = totalPrice / totalNights;

      if (departureDate > periodStart && arrivalDate <= periodEnd) {
        const overlapStart = new Date(Math.max(arrivalDate, periodStart));
        const overlapEndDate = new Date(departureDate);
        overlapEndDate.setDate(overlapEndDate.getDate() - 1);
        const overlapEnd = new Date(Math.min(overlapEndDate, periodEnd));

        if (overlapStart <= overlapEnd) {
          const overlapNights = Math.floor((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24)) + 1;
          revenue += pricePerNight * overlapNights;
        }
      }
    });

    let occupiedDays = 0;
    let availableDays = 0;

    BUILDING_ORDER.forEach(building => {
      const rooms = BUILDING_ROOMS[building];
      let buildingOccupiedDays = 0;

      rooms.forEach(room => {
        const roomReservations = allReservations.filter(r =>
          r.building === building &&
          r.room === room &&
          r.arrival <= monthEnd &&
          r.departure > monthStart
        );

        buildingOccupiedDays += getOccupiedDaysSet(roomReservations, monthStart, monthEnd);
      });

      if (buildingOccupiedDays > 0) {
        occupiedDays += buildingOccupiedDays;
        availableDays += rooms.length * lastDay;
      }
    });

    const occupancyRate = availableDays > 0 ? (occupiedDays / availableDays * 100) : 0;

    return {
      revenue: Math.round(revenue),
      occupancyRate: parseFloat(occupancyRate.toFixed(1))
    };
  };

  // Render
  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.iconWrapper}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 20V10M18 20V4M6 20v-4" />
            </svg>
          </div>
          <div>
            <h1 style={styles.title}>Revenue Analytics</h1>
            <p style={styles.subtitle}>Revenue & Occupancy Analytics</p>
          </div>
        </div>

        {/* View Toggle */}
        <div style={styles.toggleWrapper}>
          <button
            onClick={() => setViewMode("monthly")}
            style={{
              ...styles.toggleBtn,
              ...(viewMode === "monthly" ? styles.toggleBtnActive : {})
            }}
          >
            Monthly
          </button>
          <button
            onClick={() => setViewMode("daily")}
            style={{
              ...styles.toggleBtn,
              ...(viewMode === "daily" ? styles.toggleBtnActive : {})
            }}
          >
            Daily
          </button>
        </div>
      </div>

      {loading ? (
        <div style={styles.loadingWrapper}>
          <div style={styles.spinner}></div>
          <p style={styles.loadingText}>Loading data from 2023...</p>
        </div>
      ) : (
        <>
          {/* Main Content */}
          <div style={styles.mainGrid}>
            {/* Left: Calendar */}
            <div style={styles.calendarSection}>
              <div style={styles.card}>
                {viewMode === "daily" ? (
                  <>
                    {/* Daily Calendar Header */}
                    <div style={styles.calendarHeader}>
                      <button onClick={prevMonth} style={styles.navBtn}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M15 18l-6-6 6-6" />
                        </svg>
                      </button>
                      <span style={styles.calendarTitle}>
                        {selectedMonth} {MONTH_NAMES_FULL[selectedMonth - 1]} {selectedYear}
                      </span>
                      <button onClick={nextMonth} style={styles.navBtn}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M9 18l6-6-6-6" />
                        </svg>
                      </button>
                    </div>

                    {/* Weekday Header */}
                    <div style={styles.weekdayHeader}>
                      {WEEKDAYS.map((day, i) => (
                        <div key={day} style={{
                          ...styles.weekdayCell,
                          color: i === 0 ? '#FF3B30' : i === 6 ? '#007AFF' : '#8E8E93'
                        }}>
                          {day}
                        </div>
                      ))}
                    </div>

                    {/* Calendar Grid */}
                    <div style={styles.calendarGrid}>
                      {generateDailyCalendar().map((week, wi) => (
                        <div key={wi} style={styles.weekRow}>
                          {week.map((day, di) => {
                            if (!day) return <div key={di} style={styles.emptyCell} />;

                            const dayData = getDayData(day);
                            const isSelected = day === selectedDay;
                            const isToday = day === today.getDate() &&
                              selectedMonth === today.getMonth() + 1 &&
                              selectedYear === today.getFullYear();

                            return (
                              <div
                                key={di}
                                onClick={() => setSelectedDay(day)}
                                style={{
                                  ...styles.dayCell,
                                  ...(isSelected ? styles.dayCellSelected : {}),
                                  ...(isToday && !isSelected ? styles.dayCellToday : {}),
                                  cursor: 'pointer'
                                }}
                              >
                                <span style={{
                                  ...styles.dayNumber,
                                  color: isSelected ? '#FFF' : (di === 0 ? '#FF3B30' : di === 6 ? '#007AFF' : '#1D1D1F')
                                }}>
                                  {day}
                                </span>
                                {dayData && (
                                  <>
                                    <span style={{
                                      ...styles.dayRevenue,
                                      color: isSelected ? 'rgba(255,255,255,0.9)' : '#FF9500'
                                    }}>
                                      {formatCompactPrice(dayData.revenue)}
                                    </span>
                                    <span style={{
                                      ...styles.dayOccupancy,
                                      color: isSelected ? 'rgba(255,255,255,0.7)' : '#34C759'
                                    }}>
                                      {dayData.occupancyRate}%
                                    </span>
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    {/* Monthly Grid Header */}
                    <div style={styles.calendarHeader}>
                      <button onClick={prevYear} style={styles.navBtn}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M15 18l-6-6 6-6" />
                        </svg>
                      </button>
                      <span style={styles.calendarTitle}>{selectedYear}</span>
                      <button onClick={nextYear} style={styles.navBtn}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M9 18l6-6-6-6" />
                        </svg>
                      </button>
                    </div>

                    {/* Monthly Grid */}
                    <div style={styles.monthGrid}>
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(month => {
                        const monthData = getMonthData(month);
                        const isSelected = month === selectedMonth;
                        const isCurrentMonth = month === today.getMonth() + 1 && selectedYear === today.getFullYear();

                        return (
                          <div
                            key={month}
                            onClick={() => setSelectedMonth(month)}
                            style={{
                              ...styles.monthCell,
                              ...(isSelected ? styles.monthCellSelected : {}),
                              ...(isCurrentMonth && !isSelected ? styles.monthCellCurrent : {}),
                              cursor: 'pointer'
                            }}
                          >
                            <span style={{
                              ...styles.monthName,
                              color: isSelected ? '#FFF' : '#1D1D1F'
                            }}>
                              {month} {MONTH_NAMES[month - 1]}
                            </span>
                            {monthData && (
                              <>
                                <span style={{
                                  ...styles.monthRevenue,
                                  color: isSelected ? 'rgba(255,255,255,0.95)' : '#FF9500'
                                }}>
                                  {formatPrice(monthData.revenue)}
                                </span>
                                <span style={{
                                  ...styles.monthOccupancy,
                                  color: isSelected ? 'rgba(255,255,255,0.8)' : '#34C759'
                                }}>
                                  {monthData.occupancyRate}% Occ.
                                </span>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Right: Details */}
            <div style={styles.detailsSection}>
              {/* Period Label */}
              <div style={styles.periodLabel}>
                <div style={styles.periodIcon}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                </div>
                <span style={styles.periodText}>
                  {viewMode === "daily"
                    ? `${selectedMonth} ${MONTH_NAMES_FULL[selectedMonth - 1]} ${selectedDay}, ${selectedYear}`
                    : `${selectedMonth} ${MONTH_NAMES_FULL[selectedMonth - 1]} ${selectedYear}`
                  }
                </span>
              </div>

              {/* KPI Cards */}
              {selectedData && (
                <div style={styles.kpiGrid}>
                  <div style={styles.kpiCard}>
                    <div style={{ ...styles.kpiIcon, background: 'linear-gradient(135deg, #4F46E5 0%, #4338CA 100%)' }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                        <line x1="12" y1="1" x2="12" y2="23" />
                        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                      </svg>
                    </div>
                    <div style={styles.kpiContent}>
                      <span style={styles.kpiLabel}>Total Revenue</span>
                      <span style={styles.kpiValue}>{formatPrice(selectedData.total.revenue)}</span>
                    </div>
                  </div>

                  <div style={styles.kpiCard}>
                    <div style={{ ...styles.kpiIcon, background: 'linear-gradient(135deg, #E8F5E9 0%, #C8E6C9 100%)' }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#34C759" strokeWidth="2">
                        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                      </svg>
                    </div>
                    <div style={styles.kpiContent}>
                      <span style={styles.kpiLabel}>Occupancy Rate</span>
                      <span style={{ ...styles.kpiValue, color: '#34C759' }}>{selectedData.total.occupancyRate}%</span>
                      <span style={styles.kpiSub}>{selectedData.total.occupiedDays}/{selectedData.total.availableDays} room-nights</span>
                    </div>
                  </div>

                  <div style={styles.kpiCard}>
                    <div style={{ ...styles.kpiIcon, background: 'linear-gradient(135deg, #EDE7F6 0%, #D1C4E9 100%)' }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5856D6" strokeWidth="2">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                    </div>
                    <div style={styles.kpiContent}>
                      <span style={styles.kpiLabel}>Check-ins</span>
                      <span style={{ ...styles.kpiValue, color: '#5856D6' }}>{selectedData.total.reservationCount}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Building Details */}
              {selectedData && (
                <div style={styles.card}>
                  <h3 style={styles.cardTitle}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                      <polyline points="9,22 9,12 15,12 15,22" />
                    </svg>
                    Building Performance
                  </h3>
                  <div style={styles.buildingGrid}>
                    {BUILDING_ORDER.map(building => {
                      const bData = selectedData.buildings[building];
                      if (!bData) return null;

                      const occupancyColor = bData.occupancyRate >= 85 ? '#34C759' :
                        bData.occupancyRate >= 70 ? '#FF9500' : '#FF3B30';

                      return (
                        <div key={building} style={styles.buildingCard}>
                          <div style={styles.buildingHeader}>
                            <span style={styles.buildingName}>{BUILDING_NAMES_EN[building]}</span>
                            <span style={{ ...styles.buildingOccupancy, color: occupancyColor }}>
                              {bData.occupancyRate}%
                            </span>
                          </div>
                          <div style={styles.buildingRevenue}>{formatPrice(bData.revenue)}</div>
                          <div style={styles.buildingCheckins}>{bData.reservationCount} check-ins</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Memo */}
              <div style={styles.card}>
                <h3 style={styles.cardTitle}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  Notes
                </h3>
                <textarea
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="Add notes for this period..."
                  style={styles.memoTextarea}
                />
                <button
                  onClick={handleSaveMemo}
                  disabled={savingMemo}
                  style={{
                    ...styles.saveBtn,
                    opacity: savingMemo ? 0.6 : 1
                  }}
                >
                  {savingMemo ? "Saving..." : "Save Note"}
                </button>
              </div>
            </div>
          </div>

          {/* Revenue Prediction */}
          {occupancyRevenueStats && occupancyRevenueStats.regression && (
            <div style={styles.predictionSection}>
              <div style={styles.card}>
                <h3 style={styles.cardTitle}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="20" x2="18" y2="10" />
                    <line x1="12" y1="20" x2="12" y2="4" />
                    <line x1="6" y1="20" x2="6" y2="14" />
                  </svg>
                  Revenue Prediction by Occupancy
                  <span style={styles.cardSubtitle}>
                    Based on last 6 months data
                  </span>
                </h3>

                {/* Calculation Info */}
                <div style={styles.calculationInfo}>
                  <div style={styles.infoItem}>
                    <div style={styles.infoIcon}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#007AFF" strokeWidth="2">
                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                      </svg>
                    </div>
                    <div>
                      <span style={styles.infoLabel}>Active Rooms</span>
                      <span style={styles.infoValue}>{occupancyRevenueStats.regression.currentRooms}</span>
                    </div>
                  </div>
                  <div style={styles.infoItem}>
                    <div style={styles.infoIcon}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34C759" strokeWidth="2">
                        <line x1="12" y1="1" x2="12" y2="23" />
                        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                      </svg>
                    </div>
                    <div>
                      <span style={styles.infoLabel}>Avg. Revenue/Room/Day</span>
                      <span style={styles.infoValue}>{formatPrice(occupancyRevenueStats.regression.avgRevenuePerRoomDay)}</span>
                    </div>
                  </div>
                  <div style={styles.infoItem}>
                    <div style={styles.infoIcon}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF9500" strokeWidth="2">
                        <polyline points="23,6 13.5,15.5 8.5,10.5 1,18" />
                        <polyline points="17,6 23,6 23,12" />
                      </svg>
                    </div>
                    <div>
                      <span style={styles.infoLabel}>Per 1% Occupancy</span>
                      <span style={styles.infoValue}>+{formatPrice(occupancyRevenueStats.regression.slope)}/room/day</span>
                    </div>
                  </div>
                </div>

                {/* Formula */}
                <div style={styles.formulaBox}>
                  <span style={styles.formulaLabel}>Prediction Formula</span>
                  <span style={styles.formulaText}>
                    Monthly Revenue = Revenue/Room/Day × {occupancyRevenueStats.regression.currentRooms} rooms × 30 days
                  </span>
                </div>

                {/* Prediction Grid */}
                <div style={styles.predictionGrid}>
                  {occupancyRevenueStats.predictions.map((pred, index) => (
                    <div
                      key={pred.rate}
                      style={{
                        ...styles.predictionCard,
                        background: index === 0 ? 'linear-gradient(135deg, #FF9500 0%, #FF6B00 100%)' :
                          index === 1 ? 'linear-gradient(135deg, #34C759 0%, #28A745 100%)' :
                            'linear-gradient(135deg, #F5F5F7 0%, #E5E5EA 100%)'
                      }}
                    >
                      <span style={{
                        ...styles.predictionRate,
                        color: index <= 1 ? '#FFF' : '#1D1D1F'
                      }}>
                        {pred.rate}%
                      </span>
                      <span style={{
                        ...styles.predictionRevenue,
                        color: index <= 1 ? '#FFF' : '#1D1D1F'
                      }}>
                        {formatPrice(pred.predictedRevenue)}
                      </span>
                      <span style={{
                        ...styles.predictionPerDay,
                        color: index <= 1 ? 'rgba(255,255,255,0.8)' : '#8E8E93'
                      }}>
                        {formatPrice(pred.revenuePerRoomDay)}/room/day
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

// Styles
const styles = {
  container: {
    padding: '24px',
    maxWidth: '1600px',
    margin: '0 auto'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px'
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px'
  },
  iconWrapper: {
    width: '48px',
    height: '48px',
    borderRadius: '12px',
    background: 'linear-gradient(135deg, #4F46E5 0%, #4338CA 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'white'
  },
  title: {
    fontSize: '28px',
    fontWeight: '700',
    color: '#1E293B',
    margin: 0,
    marginBottom: '8px'
  },
  subtitle: {
    fontSize: '14px',
    color: '#64748B',
    margin: 0
  },
  toggleWrapper: {
    display: 'flex',
    background: '#F1F5F9',
    borderRadius: '12px',
    padding: '4px'
  },
  toggleBtn: {
    padding: '10px 20px',
    border: 'none',
    borderRadius: '10px',
    background: 'transparent',
    color: '#64748B',
    cursor: 'pointer',
    fontWeight: '600',
    fontSize: '14px',
    transition: 'all 0.2s'
  },
  toggleBtnActive: {
    background: '#4F46E5',
    color: 'white'
  },
  loadingWrapper: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '80px',
    gap: '16px'
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '3px solid #F1F5F9',
    borderTopColor: '#4F46E5',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },
  loadingText: {
    color: '#64748B',
    fontSize: '14px'
  },
  mainGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1.2fr',
    gap: '24px',
    marginBottom: '24px'
  },
  calendarSection: {
    minWidth: 0
  },
  detailsSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    minWidth: 0
  },
  card: {
    background: 'white',
    borderRadius: '16px',
    padding: '24px',
    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
    border: '1px solid #E2E8F0'
  },
  cardTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '16px',
    fontWeight: '600',
    color: '#0F172A',
    marginTop: 0,
    marginBottom: '20px'
  },
  cardSubtitle: {
    fontSize: '12px',
    fontWeight: '400',
    color: '#64748B',
    marginLeft: 'auto'
  },
  calendarHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px'
  },
  calendarTitle: {
    fontSize: '20px',
    fontWeight: '700',
    color: '#0F172A'
  },
  navBtn: {
    width: '36px',
    height: '36px',
    border: 'none',
    borderRadius: '10px',
    background: '#F1F5F9',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#334155',
    transition: 'all 0.2s'
  },
  weekdayHeader: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    marginBottom: '12px'
  },
  weekdayCell: {
    textAlign: 'center',
    fontSize: '12px',
    fontWeight: '600',
    padding: '8px'
  },
  calendarGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px'
  },
  weekRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: '4px'
  },
  emptyCell: {
    aspectRatio: '1',
    minHeight: '70px'
  },
  dayCell: {
    aspectRatio: '1',
    minHeight: '70px',
    padding: '8px',
    borderRadius: '12px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '2px',
    background: '#F8FAFC',
    transition: 'all 0.2s'
  },
  dayCellSelected: {
    background: 'linear-gradient(135deg, #4F46E5 0%, #4338CA 100%)'
  },
  dayCellToday: {
    background: '#EEF2FF',
    border: '2px solid #4F46E5'
  },
  dayNumber: {
    fontSize: '14px',
    fontWeight: '600'
  },
  dayRevenue: {
    fontSize: '10px',
    fontWeight: '700'
  },
  dayOccupancy: {
    fontSize: '9px',
    fontWeight: '600'
  },
  monthGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '12px'
  },
  monthCell: {
    padding: '20px 16px',
    borderRadius: '14px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    background: '#F8FAFC',
    transition: 'all 0.2s',
    minHeight: '110px'
  },
  monthCellSelected: {
    background: 'linear-gradient(135deg, #4F46E5 0%, #4338CA 100%)'
  },
  monthCellCurrent: {
    background: '#EEF2FF',
    border: '2px solid #4F46E5'
  },
  monthName: {
    fontSize: '16px',
    fontWeight: '700'
  },
  monthRevenue: {
    fontSize: '14px',
    fontWeight: '700'
  },
  monthOccupancy: {
    fontSize: '11px',
    fontWeight: '600'
  },
  periodLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '16px 20px',
    background: 'linear-gradient(135deg, #EEF2FF 0%, #E0E7FF 100%)',
    borderRadius: '14px',
    border: '1px solid #C7D2FE'
  },
  periodIcon: {
    width: '36px',
    height: '36px',
    borderRadius: '10px',
    background: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  periodText: {
    fontSize: '18px',
    fontWeight: '700',
    color: '#4F46E5'
  },
  kpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '16px'
  },
  kpiCard: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '14px',
    padding: '20px',
    background: 'white',
    borderRadius: '14px',
    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
  },
  kpiIcon: {
    width: '44px',
    height: '44px',
    borderRadius: '12px',
    background: 'linear-gradient(135deg, #EEF2FF 0%, #E0E7FF 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0
  },
  kpiContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px'
  },
  kpiLabel: {
    fontSize: '12px',
    color: '#64748B',
    fontWeight: '500'
  },
  kpiValue: {
    fontSize: '22px',
    fontWeight: '700',
    color: '#4F46E5'
  },
  kpiSub: {
    fontSize: '11px',
    color: '#64748B'
  },
  buildingGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
    gap: '12px'
  },
  buildingCard: {
    padding: '16px',
    background: '#F8FAFC',
    borderRadius: '12px',
    border: '1px solid #E2E8F0'
  },
  buildingHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px'
  },
  buildingName: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#334155'
  },
  buildingOccupancy: {
    fontSize: '13px',
    fontWeight: '700'
  },
  buildingRevenue: {
    fontSize: '15px',
    fontWeight: '700',
    color: '#4F46E5',
    marginBottom: '4px'
  },
  buildingCheckins: {
    fontSize: '11px',
    color: '#64748B'
  },
  memoTextarea: {
    width: '100%',
    minHeight: '100px',
    padding: '14px',
    border: '1px solid #E2E8F0',
    borderRadius: '12px',
    fontSize: '14px',
    resize: 'vertical',
    fontFamily: 'inherit',
    outline: 'none',
    transition: 'border-color 0.2s',
    boxSizing: 'border-box'
  },
  saveBtn: {
    marginTop: '12px',
    padding: '12px 24px',
    background: 'linear-gradient(135deg, #4F46E5 0%, #4338CA 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '10px',
    cursor: 'pointer',
    fontWeight: '600',
    fontSize: '14px',
    transition: 'all 0.2s'
  },
  predictionSection: {
    marginTop: '8px'
  },
  calculationInfo: {
    display: 'flex',
    gap: '24px',
    marginBottom: '20px',
    padding: '16px 20px',
    background: 'linear-gradient(135deg, #F8FAFC 0%, #F1F5F9 100%)',
    borderRadius: '12px'
  },
  infoItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  infoIcon: {
    width: '32px',
    height: '32px',
    borderRadius: '8px',
    background: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  infoLabel: {
    display: 'block',
    fontSize: '11px',
    color: '#64748B',
    marginBottom: '2px'
  },
  infoValue: {
    display: 'block',
    fontSize: '14px',
    fontWeight: '700',
    color: '#1E293B'
  },
  formulaBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '16px 20px',
    background: 'linear-gradient(135deg, #F0FDF4 0%, #DCFCE7 100%)',
    borderRadius: '12px',
    marginBottom: '20px',
    border: '1px solid #BBF7D0'
  },
  formulaLabel: {
    fontSize: '12px',
    fontWeight: '600',
    color: '#15803D'
  },
  formulaText: {
    fontSize: '14px',
    fontWeight: '500',
    color: '#14532D',
    fontFamily: 'monospace'
  },
  predictionGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
    gap: '12px'
  },
  predictionCard: {
    padding: '18px 14px',
    borderRadius: '14px',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px'
  },
  predictionRate: {
    fontSize: '20px',
    fontWeight: '800'
  },
  predictionRevenue: {
    fontSize: '14px',
    fontWeight: '700'
  },
  predictionPerDay: {
    fontSize: '10px',
    fontWeight: '500'
  }
};

// Add CSS animation for spinner
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  
  @media (max-width: 1024px) {
    .sales-log-main-grid {
      grid-template-columns: 1fr !important;
    }
  }
`;
document.head.appendChild(styleSheet);

export default SalesLogDashboard;
