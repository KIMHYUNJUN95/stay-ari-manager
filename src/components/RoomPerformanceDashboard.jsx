// src/components/RoomPerformanceDashboard.jsx
import React, { useState, useEffect } from 'react';
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from '../firebase';
import { useUser } from '../contexts/UserContext';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

import { BUILDING_ORDER, BUILDING_NAMES_EN, EXCLUDED_BUILDING_UI } from '../constants/buildingData';

// 각 건물의 객실 수 (매출 분석용 — BUILDING_DATA와 다른 형태)
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

const getBuildingNameEN = (name) => BUILDING_NAMES_EN[name] || name;

// 도쿄 시간대로 현재 날짜 가져오기
const getTokyoDate = () => {
  const now = new Date();
  const tokyoTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  return tokyoTime;
};

const getTokyoDateString = () => {
  const tokyo = getTokyoDate();
  const y = tokyo.getFullYear();
  const m = String(tokyo.getMonth() + 1).padStart(2, '0');
  const d = String(tokyo.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// 날짜 유틸 함수
const parseLocalDate = (dateStr) => {
  if (!dateStr) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const formatDate = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const getDaysInMonth = (year, month) => {
  return new Date(year, month, 0).getDate();
};

// 주간 범위 계산 (선택일 기준)
// direction: "past" = 과거 7일, "future" = 미래 7일
const getWeekRange = (baseDateStr, direction = "past") => {
  const baseDate = parseLocalDate(baseDateStr);
  let startDate, endDate;

  if (direction === "past") {
    // 과거: 선택일이 끝 날짜 (6일 전 ~ 선택일)
    endDate = new Date(baseDate);
    startDate = new Date(baseDate);
    startDate.setDate(baseDate.getDate() - 6);
  } else {
    // 미래: 선택일이 시작 날짜 (선택일 ~ 6일 후)
    startDate = new Date(baseDate);
    endDate = new Date(baseDate);
    endDate.setDate(baseDate.getDate() + 6);
  }

  return { start: formatDate(startDate), end: formatDate(endDate), days: 7 };
};

// 월간 범위 계산
const getMonthRange = (year, month) => {
  const days = getDaysInMonth(year, month);
  return {
    start: `${year}-${String(month).padStart(2, '0')}-01`,
    end: `${year}-${String(month).padStart(2, '0')}-${String(days).padStart(2, '0')}`,
    days: days
  };
};

// 가동률 계산 (예약된 날짜들을 Set으로 - 겹침 제거)
const getOccupiedDaysSet = (reservations, periodStart, periodEnd) => {
  const occupiedDates = new Set();
  const startDate = parseLocalDate(periodStart);
  const endDate = parseLocalDate(periodEnd);

  reservations.forEach(r => {
    const resStart = new Date(Math.max(parseLocalDate(r.arrival), startDate));
    const resEnd = parseLocalDate(r.departure);
    resEnd.setDate(resEnd.getDate() - 1); // departure 전날까지만

    const actualEnd = resEnd > endDate ? endDate : resEnd;

    if (resStart <= actualEnd) {
      const current = new Date(resStart);
      while (current <= actualEnd) {
        occupiedDates.add(formatDate(current));
        current.setDate(current.getDate() + 1);
      }
    }
  });

  return occupiedDates.size;
};

// ★ 매출 계산 (RevenueDashboard.jsx와 100% 동일한 로직)
// 1박당 기준 매출 집계 (베드24와 동일한 방식)
const calculateRevenue = (reservations, periodStart, periodEnd) => {
  let total = 0;
  const currentStart = parseLocalDate(periodStart);
  const currentEnd = parseLocalDate(periodEnd);

  reservations.forEach(doc => {
    if (!doc.arrival || !doc.departure) return;

    if (doc.building === EXCLUDED_BUILDING_UI) return;

    // totalPrice 사용 (Beds24 invoiceItems 합계 = 실제 예약 금액)
    const totalPrice = Number(doc.totalPrice || doc.price) || 0;
    if (totalPrice === 0) return;

    // 총 박수 계산 (arrival ~ departure 전날까지)
    const arrivalDate = parseLocalDate(doc.arrival);
    const departureDate = parseLocalDate(doc.departure);
    const totalNights = Math.floor((departureDate - arrivalDate) / (1000 * 60 * 60 * 24));

    if (totalNights <= 0) return; // 잘못된 데이터 제외

    // 1박당 금액 계산
    const pricePerNight = totalPrice / totalNights;

    // 예약 기간이 현재 범위와 겹치는지 확인 (RevenueDashboard와 동일)
    if (departureDate > currentStart && arrivalDate <= currentEnd) {
      // 겹치는 구간의 시작일과 종료일 (departure는 체크아웃 날이므로 -1일)
      const overlapStart = new Date(Math.max(arrivalDate, currentStart));
      const overlapEndDate = new Date(departureDate);
      overlapEndDate.setDate(overlapEndDate.getDate() - 1); // departure 전날까지
      const overlapEnd = new Date(Math.min(overlapEndDate, currentEnd));

      if (overlapStart <= overlapEnd) {
        // 겹치는 박수 계산 (시작일부터 종료일까지 포함)
        const overlapNights = Math.floor((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24)) + 1;
        const overlapRevenue = pricePerNight * overlapNights;
        total += overlapRevenue;
      }
    }
  });

  return Math.round(total);
};

// 가격 포맷
const formatPrice = (price) => {
  if (!price) return "¥0";
  return `¥${Math.round(price).toLocaleString()}`;
};

// 변화율 계산
const getChangeRate = (current, previous) => {
  if (!previous || previous === 0) return null;
  return ((current - previous) / previous * 100);
};

// 변화율 색상
const getChangeColor = (rate) => {
  if (rate === null) return "#94A3B8";
  return rate >= 0 ? "#10B981" : "#F43F5E";
};

// 가동률 색상
const getRateColor = (rate) => {
  if (rate >= 80) return "#22C55E";
  if (rate >= 60) return "#F97316";
  return "#EF4444";
};

const styles = {
  page: {
    background: "#FFFFFF",
    minHeight: "100vh",
    padding: "32px 40px 48px",
    display: "flex",
    flexDirection: "column",
    gap: "28px"
  },
  hero: {
    background: "linear-gradient(135deg, #4F46E5 0%, #6366F1 60%, #8B5CF6 100%)",
    borderRadius: "24px",
    padding: "32px",
    color: "white",
    display: "flex",
    flexDirection: "column",
    gap: "18px",
    boxShadow: "0 25px 60px rgba(79,70,229,0.25)"
  },
  heroTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "16px",
    flexWrap: "wrap"
  },
  heroTitle: {
    fontSize: "30px",
    fontWeight: 700,
    margin: 0
  },
  heroSubtitle: {
    fontSize: "15px",
    opacity: 0.85,
    margin: 0
  },
  heroMeta: {
    display: "flex",
    gap: "14px",
    flexWrap: "wrap"
  },
  heroPill: {
    background: "rgba(255,255,255,0.18)",
    padding: "10px 16px",
    borderRadius: "999px",
    fontSize: "13px",
    fontWeight: 600
  },
  controlRow: {
    display: "flex",
    gap: "12px",
    flexWrap: "wrap",
    alignItems: "center"
  },
  segmented: {
    display: "flex",
    padding: "4px",
    borderRadius: "999px",
    background: "rgba(255,255,255,0.2)",
    backdropFilter: "blur(10px)",
    border: "1px solid rgba(255,255,255,0.25)"
  },
  segmentedBtn: (active) => ({
    padding: "8px 18px",
    borderRadius: "999px",
    border: "none",
    background: active ? "#FFFFFF" : "transparent",
    color: active ? "#4F46E5" : "rgba(255,255,255,0.7)",
    fontWeight: 600,
    fontSize: "13px",
    cursor: "pointer",
    transition: "all 0.2s ease"
  }),
  whiteSegmented: {
    display: "flex",
    padding: "4px",
    borderRadius: "14px",
    background: "#F1F5F9",
    border: "1px solid #E2E8F0"
  },
  whiteSegmentedBtn: (active, activeColor = "#4F46E5") => ({
    padding: "8px 16px",
    borderRadius: "10px",
    border: "none",
    background: active ? activeColor : "transparent",
    color: active ? "white" : "#475569",
    fontWeight: 600,
    fontSize: "13px",
    cursor: "pointer",
    minWidth: "90px",
    transition: "all 0.2s ease"
  }),
  datePicker: {
    padding: "10px 14px",
    borderRadius: "12px",
    border: "1px solid #CBD5F5",
    background: "white",
    fontSize: "14px",
    fontWeight: 600,
    color: "#1E293B",
    boxShadow: "0 10px 25px rgba(15,23,42,0.08)",
    minWidth: "150px"
  },
  pillHighlight: {
    padding: "6px 14px",
    borderRadius: "999px",
    background: "#E0EAFF",
    color: "#1D4ED8",
    fontSize: "13px",
    fontWeight: 600
  },
  sectionCard: {
    background: "#FFFFFF",
    borderRadius: "20px",
    padding: "24px",
    boxShadow: "0 25px 60px rgba(15,23,42,0.08)",
    border: "1px solid #E2E8F0"
  },
  kpiGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: "18px"
  },
  kpiCard: {
    borderRadius: "18px",
    padding: "20px",
    background: "#F8FAFC",
    border: "1px solid #EDF2F7",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    position: "relative",
    overflow: "hidden"
  },
  kpiAccent: {
    position: "absolute",
    inset: 0,
    opacity: 0.08,
    background: "radial-gradient(circle at top right, #6366F1, transparent 55%)"
  },
  kpiLabel: {
    fontSize: "13px",
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    fontWeight: 600
  },
  kpiValue: {
    fontSize: "30px",
    fontWeight: 700,
    color: "#0F172A"
  },
  chartTitle: {
    fontSize: "18px",
    fontWeight: 700,
    color: "#111827",
    marginBottom: "18px"
  },
  badge: {
    fontSize: "12px",
    color: "#64748B",
    textTransform: "uppercase",
    letterSpacing: "0.12em"
  },
  warningCard: {
    background: "linear-gradient(135deg, #FFF7F7, #FFE4E6)",
    borderRadius: "18px",
    padding: "24px",
    border: "1px solid #FECACA",
    boxShadow: "0 20px 40px rgba(244,63,94,0.15)"
  },
  warningTitle: {
    fontSize: "18px",
    fontWeight: 700,
    color: "#B91C1C",
    marginBottom: "16px"
  },
  warningChip: {
    background: "white",
    borderRadius: "12px",
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    border: "1px solid #FFE4E6",
    minWidth: "190px"
  },
  buildingHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "14px",
    color: "#312E81"
  },
  statsLine: {
    fontSize: "13px",
    color: "#475569"
  }
};

// 룸 이름 포맷팅 (호 제거 및 영문 변환)
const formatRoomName = (name) => {
  if (!name) return "";
  let formatted = name.replace("호", "");
  if (formatted === "오쿠보A") return "Okubo A";
  if (formatted === "오쿠보B") return "Okubo B";
  if (formatted === "오쿠보C") return "Okubo C";
  if (formatted === "사노") return "Sano";
  return formatted;
};

// 월 영문명
const MONTH_NAMES_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// 월 이름 (숫자+영어 조합) - OccupancyRateDashboard와 동일
const MONTHS = [
  '1 January', '2 February', '3 March', '4 April', '5 May', '6 June',
  '7 July', '8 August', '9 September', '10 October', '11 November', '12 December'
];

// 룸 이름 포맷팅 (호 제거 및 영문 변환)
const RoomPerformanceDashboard = () => {
  const { companyId } = useUser();
  const currentDate = getTokyoDate();

  const [viewMode, setViewMode] = useState("weekly"); // weekly | monthly
  const [weekDirection, setWeekDirection] = useState("past"); // past | future
  const [selectedDate, setSelectedDate] = useState(() => {
    return getTokyoDateString(); // 도쿄 시간 기준
  });
  const [selectedYear, setSelectedYear] = useState(currentDate.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(currentDate.getMonth() + 1);
  const [selectedDay, setSelectedDay] = useState(currentDate.getDate());
  const [loading, setLoading] = useState(false);

  // 연도 목록 (현재년도 ±5년)
  const YEARS = Array.from({length: 11}, (_, i) => currentDate.getFullYear() - 5 + i);

  // 선택된 연도와 월에 따른 일 수 계산
  const daysInSelectedMonth = getDaysInMonth(selectedYear, selectedMonth);
  const DAYS = Array.from({length: daysInSelectedMonth}, (_, i) => i + 1);

  // 데이터 상태
  const [currentPeriod, setCurrentPeriod] = useState({ occupancy: 0, revenue: 0, start: '', end: '' });
  const [previousPeriod, setPreviousPeriod] = useState({ occupancy: 0, revenue: 0, start: '', end: '' });
  const [trendData, setTrendData] = useState([]);
  const [buildingData, setBuildingData] = useState([]);
  const [roomData, setRoomData] = useState({});
  const [lowOccupancyRooms, setLowOccupancyRooms] = useState([]);

  useEffect(() => {
    if (companyId) {
      fetchData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, viewMode, selectedDate, weekDirection]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // 기간 계산
      let currentRange, previousRange, trendRanges = [];

      if (viewMode === "weekly") {
        currentRange = getWeekRange(selectedDate, weekDirection);

        // 비교 기간: 현재 기간의 7일 전 (과거든 미래든 동일하게 7일 전과 비교)
        if (weekDirection === "past") {
          const prevWeekDate = new Date(parseLocalDate(selectedDate));
          prevWeekDate.setDate(prevWeekDate.getDate() - 7);
          previousRange = getWeekRange(formatDate(prevWeekDate), "past");
        } else {
          // 미래: 선택일 기준 7일 전 데이터와 비교
          const prevWeekDate = new Date(parseLocalDate(selectedDate));
          prevWeekDate.setDate(prevWeekDate.getDate() - 7);
          previousRange = getWeekRange(formatDate(prevWeekDate), "past");
        }

        // 4주 추이 데이터
        for (let i = 3; i >= 0; i--) {
          const weekDate = new Date(parseLocalDate(selectedDate));
          if (weekDirection === "past") {
            weekDate.setDate(weekDate.getDate() - (i * 7));
          } else {
            weekDate.setDate(weekDate.getDate() + (i * 7));
          }
          const range = getWeekRange(formatDate(weekDate), weekDirection);
          // 날짜 범위 라벨 생성 (예: "12/23~29")
          const startParts = range.start.split('-');
          const endParts = range.end.split('-');
          const startLabel = `${parseInt(startParts[1])}/${parseInt(startParts[2])}`;
          const endLabel = startParts[1] === endParts[1]
            ? `${parseInt(endParts[2])}`
            : `${parseInt(endParts[1])}/${parseInt(endParts[2])}`;
          trendRanges.push({
            label: `${startLabel}~${endLabel}`,
            ...range
          });
        }

        // 미래 모드일 때 순서 정렬 (시간 순서대로)
        if (weekDirection === "future") {
          trendRanges.sort((a, b) => a.start.localeCompare(b.start));
        }
      } else {
        const [year, month] = selectedDate.split('-').map(Number);
        currentRange = getMonthRange(year, month);
        const prevMonth = month === 1 ? 12 : month - 1;
        const prevYear = month === 1 ? year - 1 : year;
        previousRange = getMonthRange(prevYear, prevMonth);

        // 최근 6개월 추이
        for (let i = 5; i >= 0; i--) {
          const m = month - i;
          const y = m <= 0 ? year - 1 : year;
          const adjMonth = m <= 0 ? 12 + m : m;
          const range = getMonthRange(y, adjMonth);
          const labelMonth = adjMonth - 1;
          trendRanges.push({
            label: MONTH_NAMES_EN[labelMonth], // 영문 월 이름 사용
            ...range
          });
        }
      }

      // Firestore 쿼리 - 필요한 기간의 모든 예약 가져오기
      if (!companyId) {
        console.warn('⚠️ No companyId for RoomPerformanceDashboard');
        setLoading(false);
        return;
      }

      const oldestStart = trendRanges[0]?.start || previousRange.start;
      const q = query(
        collection(db, "reservations"),
        where("companyId", "==", companyId),
        where("departure", ">=", oldestStart),
        where("status", "==", "confirmed")
      );

      const snapshot = await getDocs(q);
      const allReservations = snapshot.docs.map(d => d.data());
      console.log(`📊 객실 성과 분석: ${allReservations.length}건 예약 조회`);

      // ★ 전체 매출 계산 (RevenueDashboard와 동일 로직 - 모든 예약 포함)
      // 이 매출은 KPI에 표시되며, RevenueDashboard와 일치합니다
      const totalCurrentRevenue = calculateRevenue(allReservations, currentRange.start, currentRange.end);
      const totalPrevRevenue = calculateRevenue(allReservations, previousRange.start, previousRange.end);

      // 건물별 가동률/매출 계산 (사노시 제외 - 가동률 계산용)
      let currentOccupied = 0, currentAvailable = 0;
      let prevOccupied = 0, prevAvailable = 0;

      const buildingStats = [];
      const roomStats = {};
      const lowRooms = [];

      Object.keys(BUILDING_ROOMS).forEach(building => {
        if (building === "사노시") return; // 사노시 제외 (가동률 계산용)
        if (building === EXCLUDED_BUILDING_UI) return; // 다이쿄초: 화면에서 항상 제외

        const rooms = BUILDING_ROOMS[building];
        let bldgCurrentOcc = 0, bldgPrevOcc = 0;
        let bldgCurrentRev = 0, bldgPrevRev = 0;
        let bldgAvailable = rooms.length * currentRange.days;

        roomStats[building] = {};

        rooms.forEach(room => {
          // ★ 다이쿄초: bookDate가 1/26 이후인 예약만 제외
          const roomReservations = allReservations.filter(r => {
            return r.building === building && r.room === room && building !== EXCLUDED_BUILDING_UI;
          });

          // 현재 기간 매출 계산 (calculateRevenue 내부에서 필터링 처리)
          const currOccDays = getOccupiedDaysSet(
            roomReservations.filter(r => r.arrival <= currentRange.end && r.departure > currentRange.start),
            currentRange.start, currentRange.end
          );
          const currRev = calculateRevenue(roomReservations, currentRange.start, currentRange.end);

          // 이전 기간 매출 계산 (calculateRevenue 내부에서 필터링 처리)
          const prevOccDays = getOccupiedDaysSet(
            roomReservations.filter(r => r.arrival <= previousRange.end && r.departure > previousRange.start),
            previousRange.start, previousRange.end
          );
          const prevRev = calculateRevenue(roomReservations, previousRange.start, previousRange.end);

          const currRate = (currOccDays / currentRange.days * 100);
          const prevRate = (prevOccDays / previousRange.days * 100);
          const rateChange = getChangeRate(currRate, prevRate);
          const revChange = getChangeRate(currRev, prevRev);

          roomStats[building][room] = {
            currentOccupancy: parseFloat(currRate.toFixed(1)),
            previousOccupancy: parseFloat(prevRate.toFixed(1)),
            occupancyChange: rateChange !== null ? parseFloat(rateChange.toFixed(1)) : null,
            currentRevenue: currRev,
            previousRevenue: prevRev,
            revenueChange: revChange !== null ? parseFloat(revChange.toFixed(1)) : null,
            occupiedDays: currOccDays,
            totalDays: currentRange.days
          };

          // 가동률 낮은 객실 체크
          const threshold = viewMode === "weekly" ? 40 : 50;
          if (currRate < threshold) {
            lowRooms.push({
              building,
              room,
              rate: parseFloat(currRate.toFixed(1)),
              change: rateChange !== null ? parseFloat(rateChange.toFixed(1)) : null
            });
          }

          bldgCurrentOcc += currOccDays;
          bldgPrevOcc += prevOccDays;
          bldgCurrentRev += currRev;
          bldgPrevRev += prevRev;
        });

        const bldgCurrRate = (bldgCurrentOcc / bldgAvailable * 100);
        const bldgPrevRate = (bldgPrevOcc / (rooms.length * previousRange.days) * 100);

        buildingStats.push({
          name: getBuildingNameEN(building),
          currentRate: parseFloat(bldgCurrRate.toFixed(1)),
          previousRate: parseFloat(bldgPrevRate.toFixed(1)),
          rateChange: parseFloat(getChangeRate(bldgCurrRate, bldgPrevRate)?.toFixed(1) || 0),
          currentRevenue: bldgCurrentRev,
          previousRevenue: bldgPrevRev,
          revenueChange: parseFloat(getChangeRate(bldgCurrentRev, bldgPrevRev)?.toFixed(1) || 0)
        });

        currentOccupied += bldgCurrentOcc;
        currentAvailable += bldgAvailable;
        prevOccupied += bldgPrevOcc;
        prevAvailable += rooms.length * previousRange.days;
      });

      // 정렬
      buildingStats.sort((a, b) => {
        const idxA = BUILDING_ORDER.indexOf(a.name);
        const idxB = BUILDING_ORDER.indexOf(b.name);
        return idxA - idxB;
      });

      lowRooms.sort((a, b) => a.rate - b.rate);

      // 추이 데이터 계산
      const trends = trendRanges.map(range => {
        let totalOcc = 0, totalAvail = 0;

        // 가동률 계산 (사노시·다이쿄초 제외)
        Object.keys(BUILDING_ROOMS).forEach(building => {
          if (building === "사노시" || building === EXCLUDED_BUILDING_UI) return;
          const rooms = BUILDING_ROOMS[building];

          rooms.forEach(room => {
            const roomReservations = allReservations.filter(r =>
              r.building === building && r.room === room
            );
            const occFiltered = roomReservations.filter(r =>
              r.arrival <= range.end && r.departure > range.start
            );
            totalOcc += getOccupiedDaysSet(occFiltered, range.start, range.end);
            totalAvail += range.days;
          });
        });

        // ★ 매출 계산 (전체 예약 기준 - RevenueDashboard와 동일)
        const totalRev = calculateRevenue(allReservations, range.start, range.end);

        return {
          label: range.label,
          occupancy: parseFloat((totalOcc / totalAvail * 100).toFixed(1)),
          revenue: totalRev
        };
      });

      // 상태 업데이트
      const currOccRate = currentAvailable > 0 ? (currentOccupied / currentAvailable * 100) : 0;
      const prevOccRate = prevAvailable > 0 ? (prevOccupied / prevAvailable * 100) : 0;

      setCurrentPeriod({
        occupancy: parseFloat(currOccRate.toFixed(1)),
        revenue: totalCurrentRevenue,  // ★ 전체 매출 사용 (RevenueDashboard와 동일)
        start: currentRange.start,
        end: currentRange.end
      });
      setPreviousPeriod({
        occupancy: parseFloat(prevOccRate.toFixed(1)),
        revenue: totalPrevRevenue,  // ★ 전체 매출 사용 (RevenueDashboard와 동일)
        start: previousRange.start,
        end: previousRange.end
      });
      setTrendData(trends);
      setBuildingData(buildingStats);
      setRoomData(roomStats);
      setLowOccupancyRooms(lowRooms.slice(0, 10));

    } catch (error) {
      console.error("객실 성과 데이터 로딩 실패:", error);
    } finally {
      setLoading(false);
    }
  };

  const occupancyChange = getChangeRate(currentPeriod.occupancy, previousPeriod.occupancy);
  const revenueChange = getChangeRate(currentPeriod.revenue, previousPeriod.revenue);

  return (
    <div style={styles.page}>
      <div style={styles.hero}>
        <div style={styles.heroTop}>
          <div>
            <p style={styles.heroSubtitle}>Haru Studio · Advanced Hospitality Performance</p>
            <h2 style={styles.heroTitle}>{viewMode === "weekly" ? "Weekly" : "Monthly"} Room Performance</h2>
          </div>
          <span style={styles.heroPill}>Live synced · Asia/Tokyo</span>
        </div>
        <div style={styles.controlRow}>
          <div style={styles.segmented}>
            <button style={styles.segmentedBtn(viewMode === "weekly")}
              onClick={() => setViewMode("weekly")}>
              Weekly
            </button>
            <button style={styles.segmentedBtn(viewMode === "monthly")}
              onClick={() => setViewMode("monthly")}>
              Monthly
            </button>
          </div>

          {viewMode === "weekly" && (
            <div style={styles.whiteSegmented}>
              <button
                style={styles.whiteSegmentedBtn(weekDirection === "past", "#F97316")}
                onClick={() => setWeekDirection("past")}
              >
                Past 7 Days
              </button>
              <button
                style={styles.whiteSegmentedBtn(weekDirection === "future", "#10B981")}
                onClick={() => setWeekDirection("future")}
              >
                Next 7 Days
              </button>
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: "12px", background: "white", padding: "10px 14px", borderRadius: "12px", border: "1px solid #CBD5F5", boxShadow: "0 10px 25px rgba(15,23,42,0.08)", minWidth: viewMode === "weekly" ? "200px" : "180px" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
            <select
              value={selectedYear}
              onChange={(e) => {
                const newYear = Number(e.target.value);
                setSelectedYear(newYear);
                if (viewMode === "weekly") {
                  setSelectedDate(`${e.target.value}-${String(selectedMonth).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`);
                } else {
                  setSelectedDate(`${e.target.value}-${String(selectedMonth).padStart(2, '0')}-01`);
                }
              }}
              style={{
                border: "none",
                outline: "none",
                fontSize: "14px",
                fontWeight: "600",
                color: "#1E293B",
                background: "transparent",
                cursor: "pointer"
              }}
            >
              {YEARS.map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
            <select
              value={selectedMonth}
              onChange={(e) => {
                const newMonth = Number(e.target.value);
                setSelectedMonth(newMonth);
                // 선택된 일이 새로운 월의 일수를 초과하는 경우 조정
                const newDaysInMonth = getDaysInMonth(selectedYear, newMonth);
                const adjustedDay = Math.min(selectedDay, newDaysInMonth);
                setSelectedDay(adjustedDay);
                if (viewMode === "weekly") {
                  setSelectedDate(`${selectedYear}-${String(e.target.value).padStart(2, '0')}-${String(adjustedDay).padStart(2, '0')}`);
                } else {
                  setSelectedDate(`${selectedYear}-${String(e.target.value).padStart(2, '0')}-01`);
                }
              }}
              style={{
                border: "none",
                outline: "none",
                fontSize: "14px",
                fontWeight: "600",
                color: "#1E293B",
                background: "transparent",
                cursor: "pointer"
              }}
            >
              {MONTHS.map((month, index) => (
                <option key={index + 1} value={index + 1}>{month}</option>
              ))}
            </select>
            {viewMode === "weekly" && (
              <select
                value={selectedDay}
                onChange={(e) => {
                  const newDay = Number(e.target.value);
                  setSelectedDay(newDay);
                  setSelectedDate(`${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(e.target.value).padStart(2, '0')}`);
                }}
                style={{
                  border: "none",
                  outline: "none",
                  fontSize: "14px",
                  fontWeight: "600",
                  color: "#1E293B",
                  background: "transparent",
                  cursor: "pointer"
                }}
              >
                {DAYS.map(day => (
                  <option key={day} value={day}>{day}</option>
                ))}
              </select>
            )}
          </div>
        </div>
        <div style={styles.heroMeta}>
          <span style={styles.pillHighlight}>{currentPeriod.start} → {currentPeriod.end}</span>
          <span style={styles.pillHighlight}>Benchmark · {previousPeriod.start} → {previousPeriod.end}</span>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "100px", color: "#94A3B8" }}>
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>📊</div>
          <div style={{ fontSize: "16px", fontWeight: "600", color: "#475569" }}>Analyzing performance data...</div>
        </div>
      ) : (
        <>
          <div style={styles.sectionCard}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px" }}>
              <div>
                <span style={styles.badge}>Snapshot</span>
                <h3 style={{ fontSize: "20px", fontWeight: 700, color: "#0F172A", marginTop: "8px" }}>Key Operational KPIs</h3>
              </div>
              <span style={styles.pillHighlight}>{viewMode === "weekly" ? `${weekDirection === "past" ? "Past" : "Next"} 7 Days` : "Current Month"}</span>
            </div>
            <div style={styles.kpiGrid}>
              <div style={styles.kpiCard}>
                <div style={styles.kpiAccent}></div>
                <div style={styles.kpiLabel}>Occupancy</div>
                <div style={{ ...styles.kpiValue, color: getRateColor(currentPeriod.occupancy) }}>{currentPeriod.occupancy}%</div>
                <div style={{ color: "#94A3B8", fontSize: "13px" }}>
                  Sano City excluded · Capacity {currentPeriod.start && currentPeriod.end}
                </div>
              </div>
              <div style={styles.kpiCard}>
                <div style={styles.kpiAccent}></div>
                <div style={styles.kpiLabel}>Revenue</div>
                <div style={{ ...styles.kpiValue, color: "#2563EB", fontSize: "28px" }}>{formatPrice(currentPeriod.revenue)}</div>
                <div style={{ color: "#94A3B8", fontSize: "13px" }}>Per-night allocation · Beds24 parity</div>
              </div>
              <div style={styles.kpiCard}>
                <div style={styles.kpiAccent}></div>
                <div style={styles.kpiLabel}>Occupancy Delta</div>
                <div style={{ ...styles.kpiValue, color: getChangeColor(occupancyChange), fontSize: "28px" }}>
                  {occupancyChange !== null ? `${occupancyChange >= 0 ? "+" : ""}${occupancyChange.toFixed(1)}%` : "-"}
                </div>
                <div style={{ color: "#94A3B8", fontSize: "13px" }}>vs. Previous Period</div>
              </div>
              <div style={styles.kpiCard}>
                <div style={styles.kpiAccent}></div>
                <div style={styles.kpiLabel}>Revenue Delta</div>
                <div style={{ ...styles.kpiValue, color: getChangeColor(revenueChange), fontSize: "28px" }}>
                  {revenueChange !== null ? `${revenueChange >= 0 ? "+" : ""}${revenueChange.toFixed(1)}%` : "-"}
                </div>
                <div style={{ color: "#94A3B8", fontSize: "13px" }}>vs. Previous Period</div>
              </div>
            </div>
          </div>

          <div style={{ ...styles.sectionCard, display: "flex", flexDirection: "column", gap: "20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span style={styles.badge}>Trend</span>
                <div style={styles.chartTitle}>{viewMode === "weekly"
                  ? (weekDirection === "past" ? "Past 4 Weeks Trajectory" : "Upcoming 4 Weeks Projection")
                  : "Six-Month Trajectory"}</div>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trendData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" />
                <YAxis yAxisId="left" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `¥${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  formatter={(value, name) => {
                    if (name === "occupancy") return [`${value}%`, "Occupancy"];
                    return [`¥${Math.round(value).toLocaleString()}`, "Revenue"];
                  }}
                />
                <Legend />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="occupancy"
                  name="Occupancy"
                  stroke={viewMode === "weekly" ? (weekDirection === "past" ? "#FF9500" : "#34C759") : "#5856D6"}
                  strokeWidth={3}
                  dot={{ r: 5 }}
                />
                <Line yAxisId="right" type="monotone" dataKey="revenue" name="Revenue" stroke="#0071E3" strokeWidth={2} strokeDasharray="5 5" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div style={styles.sectionCard}>
            <div style={styles.chartTitle}>Building Occupancy Comparison</div>
            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={buildingData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} tick={{ fontSize: 12 }} />
                <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <Tooltip formatter={(v, n) => n === "currentRate" ? [`${v}%`, "Current"] : [`${v}%`, "Previous"]} />
                <Legend />
                <Bar
                  dataKey="currentRate"
                  name={viewMode === "weekly"
                    ? (weekDirection === "past" ? "Past 7 Days" : "Next 7 Days")
                    : "Current Month"}
                  fill={weekDirection === "past" ? "#FF9500" : "#34C759"}
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="previousRate"
                  name="Previous Period"
                  fill="#C7C7CC"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {lowOccupancyRooms.length > 0 && (
            <div style={styles.warningCard}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <div>
                  <span style={styles.badge}>Risk Watch</span>
                  <div style={styles.warningTitle}>Rooms Requiring Attention</div>
                </div>
                <span style={{ fontSize: "13px", color: "#B91C1C" }}>
                  Threshold · {viewMode === "weekly" ? "40%" : "50%"} Occupancy
                </span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
                {lowOccupancyRooms.map((room, idx) => (
                  <div key={idx} style={styles.warningChip}>
                    <strong style={{ color: "#0F172A" }}>{getBuildingNameEN(room.building)} · {formatRoomName(room.room)}</strong>
                    <div style={{ fontSize: "13px", color: "#64748B" }}>
                      Current rate <span style={{ color: "#DC2626", fontWeight: 700 }}>{room.rate}%</span>
                    </div>
                    {room.change !== null && (
                      <span style={{ fontSize: "12px", color: getChangeColor(room.change) }}>
                        {room.change >= 0 ? "+" : ""}{room.change}% vs prior
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 건물별 객실 상세 */}
          {BUILDING_ORDER.filter(b => b !== EXCLUDED_BUILDING_UI && b !== "사노시" && roomData[b]).map(building => {
            const bldg = buildingData.find(b => b.name === getBuildingNameEN(building));
            if (!bldg) return null;

            const rooms = Object.keys(roomData[building] || {}).sort((a, b) => {
              return roomData[building][b].currentOccupancy - roomData[building][a].currentOccupancy;
            });

            return (
              <div key={building} className="building-section" style={styles.sectionCard}>
                <div style={styles.buildingHeader}>
                  <span style={{ fontSize: "18px", fontWeight: 700 }}>{getBuildingNameEN(building)}</span>
                  <div style={styles.statsLine}>
                    Occupancy <strong style={{ color: getRateColor(bldg.currentRate) }}>{bldg.currentRate}%</strong>
                    <span style={{ marginLeft: "8px", color: getChangeColor(bldg.rateChange) }}>
                      ({bldg.rateChange >= 0 ? "+" : ""}{bldg.rateChange}%)
                    </span>
                    <span style={{ margin: "0 12px" }}>|</span>
                    Revenue <strong style={{ color: "#2563EB" }}>{formatPrice(bldg.currentRevenue)}</strong>
                    <span style={{ marginLeft: "8px", color: getChangeColor(bldg.revenueChange) }}>
                      ({bldg.revenueChange >= 0 ? "+" : ""}{bldg.revenueChange}%)
                    </span>
                  </div>
                </div>
                <div className="table-card">
                  <table className="table-full">
                    <thead>
                      <tr>
                        <th className="text-left">Room</th>
                        <th className="text-right">Occupancy</th>
                        <th className="text-right">Δ Occupancy</th>
                        <th className="text-right">Revenue</th>
                        <th className="text-right">Δ Revenue</th>
                        <th className="text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rooms.map(room => {
                        const r = roomData[building][room];
                        const threshold = viewMode === "weekly" ? 40 : 50;
                        const isLow = r.currentOccupancy < threshold;

                        return (
                          <tr key={room} style={{ background: isLow ? "#FFF5F5" : "transparent" }}>
                            <td className="text-left" style={{ fontWeight: "600" }}>{formatRoomName(room)}</td>
                            <td className="text-right" style={{ color: getRateColor(r.currentOccupancy), fontWeight: "bold" }}>
                              {r.currentOccupancy}%
                            </td>
                            <td className="text-right" style={{ color: getChangeColor(r.occupancyChange) }}>
                              {r.occupancyChange !== null ? (
                                <>{r.occupancyChange >= 0 ? "+" : ""}{r.occupancyChange}%</>
                              ) : "-"}
                            </td>
                            <td className="text-right" style={{ color: "#0071E3" }}>
                              {formatPrice(r.currentRevenue)}
                            </td>
                            <td className="text-right" style={{ color: getChangeColor(r.revenueChange) }}>
                              {r.revenueChange !== null ? (
                                <>{r.revenueChange >= 0 ? "+" : ""}{r.revenueChange}%</>
                              ) : "-"}
                            </td>
                            <td className="text-center">
                              {isLow ? (
                                <span style={{
                                  background: "#FF3B30",
                                  color: "white",
                                  padding: "4px 10px",
                                  borderRadius: "10px",
                                  fontSize: "11px",
                                  fontWeight: "600"
                                }}>Attention</span>
                              ) : r.currentOccupancy >= 70 ? (
                                <span style={{
                                  background: "#34C759",
                                  color: "white",
                                  padding: "4px 10px",
                                  borderRadius: "10px",
                                  fontSize: "11px",
                                  fontWeight: "600"
                                }}>Excellent</span>
                              ) : (
                                <span style={{
                                  background: "#FF9500",
                                  color: "white",
                                  padding: "4px 10px",
                                  borderRadius: "10px",
                                  fontSize: "11px",
                                  fontWeight: "600"
                                }}>Good</span>
                              )}
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

          {/* 도움말 */}
          <div style={{
            marginTop: "20px",
            padding: "18px 24px",
            background: "#F8FAFC",
            borderRadius: "16px",
            fontSize: "13px",
            color: "#475569",
            border: "1px solid #E2E8F0"
          }}>
            <strong style={{ textTransform: "uppercase", letterSpacing: "0.2em", fontSize: "12px", color: "#94A3B8" }}>Optimization Playbook</strong>
            <ul style={{ marginTop: "12px", paddingLeft: "20px", lineHeight: "1.9" }}>
              <li><strong>Low occupancy rooms</strong>: refresh photography, adjust copywriting, and recalibrate pricing tiers.</li>
              <li><strong>Track deltas</strong>: monitor week-over-week metrics to validate whether listing tweaks are effective.</li>
              <li><strong>Boost ranking</strong>: rapid responses, stellar reviews, and Superhost badges drive algorithm exposure.</li>
              <li><strong>Peer benchmarking</strong>: compare rooms within the same building to uncover actionable differentiators.</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
};

export default RoomPerformanceDashboard;
