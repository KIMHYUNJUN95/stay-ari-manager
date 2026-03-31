import React, { useState, useEffect } from 'react';
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from './firebase';
import { useUser } from './contexts/UserContext';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import 'react-datepicker/dist/react-datepicker.css';
import { getMonth, getYear } from 'date-fns';
import { BUILDING_ORDER, EXCLUDED_BUILDING_UI, ACTIVE_BUILDING_ORDER, BUILDING_NAMES_EN as _BUILDING_NAMES_EN } from './constants/buildingData';

// 커스텀 DatePicker 헤더 (월: 01 Jan 형식)
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const years = Array.from({ length: 20 }, (_, i) => 2020 + i); // 2020-2039

// eslint-disable-next-line no-unused-vars
const CustomDatePickerHeader = ({
  date,
  changeYear,
  changeMonth,
  decreaseMonth,
  increaseMonth,
  prevMonthButtonDisabled,
  nextMonthButtonDisabled,
}) => (
  <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "8px", padding: "8px" }}>
    <button onClick={decreaseMonth} disabled={prevMonthButtonDisabled} type="button"
      style={{ border: "none", background: "none", cursor: "pointer", fontSize: "16px", padding: "4px 8px" }}>
      {"<"}
    </button>
    <select
      value={getMonth(date)}
      onChange={({ target: { value } }) => changeMonth(Number(value))}
      style={{ padding: "4px 8px", borderRadius: "4px", border: "1px solid #ccc", fontSize: "14px", fontWeight: "600" }}
    >
      {MONTHS_EN.map((month, i) => (
        <option key={month} value={i}>
          {String(i + 1).padStart(2, '0')} {month}
        </option>
      ))}
    </select>
    <select
      value={getYear(date)}
      onChange={({ target: { value } }) => changeYear(Number(value))}
      style={{ padding: "4px 8px", borderRadius: "4px", border: "1px solid #ccc", fontSize: "14px", fontWeight: "600" }}
    >
      {years.map((year) => (
        <option key={year} value={year}>{year}</option>
      ))}
    </select>
    <button onClick={increaseMonth} disabled={nextMonthButtonDisabled} type="button"
      style={{ border: "none", background: "none", cursor: "pointer", fontSize: "16px", padding: "4px 8px" }}>
      {">"}
    </button>
  </div>
);

// ★ 기수 정의 (7기 = 2025.07 ~ 2026.06)
const FISCAL_PERIODS = [
  { period: 8, label: "Period 8", startYear: 2026, startMonth: 7, endYear: 2027, endMonth: 6 },
  { period: 7, label: "Period 7", startYear: 2025, startMonth: 7, endYear: 2026, endMonth: 6 },
  { period: 6, label: "Period 6", startYear: 2024, startMonth: 7, endYear: 2025, endMonth: 6 },
  { period: 5, label: "Period 5", startYear: 2023, startMonth: 7, endYear: 2024, endMonth: 6 },
  { period: 4, label: "Period 4", startYear: 2022, startMonth: 7, endYear: 2023, endMonth: 6 },
];

// 현재 날짜 기준으로 현재 기수 찾기
const getCurrentPeriod = () => {
  const now = new Date();

  for (const fp of FISCAL_PERIODS) {
    // 시작일과 종료일 체크
    const startDate = new Date(fp.startYear, fp.startMonth - 1, 1);
    const endDate = new Date(fp.endYear, fp.endMonth, 0); // 해당 월의 마지막 날

    if (now >= startDate && now <= endDate) {
      return fp.period;
    }
  }
  return 7; // 기본값
};

// 기수 정보 가져오기
const getPeriodInfo = (periodNum) => {
  return FISCAL_PERIODS.find(p => p.period === periodNum) || FISCAL_PERIODS[1]; // 기본 7기
};

const getActiveBuildingOrder = () => ACTIVE_BUILDING_ORDER;



// ★ 날짜 문자열을 로컬 시간대로 파싱 (시간대 문제 해결)
const parseLocalDate = (dateStr) => {
  if (!dateStr) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
};

// 날짜 모드 타입
const DATE_MODES = {
  PERIOD: 'period',    // 기수 선택
  YEAR: 'year',        // 연도별
  MONTH: 'month',      // 월별
  WEEK: 'week',        // 주별
  DAY: 'day',          // 일별
  CUSTOM: 'custom'     // 직접 선택
};

// 연도별 날짜 범위 계산
const getYearRange = (year) => {
  return {
    startDate: `${year}-01-01`,
    endDate: `${year}-12-31`
  };
};

// 월별 날짜 범위 계산
const getMonthRange = (year, month) => {
  const lastDay = new Date(year, month, 0).getDate();
  return {
    startDate: `${year}-${String(month).padStart(2, '0')}-01`,
    endDate: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  };
};

// 주별 날짜 범위 계산 (월요일 ~ 일요일)
const getWeekRange = (date) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // 월요일로 조정
  const monday = new Date(d.setDate(diff));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const formatDate = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  return {
    startDate: formatDate(monday),
    endDate: formatDate(sunday)
  };
};

// 일별 날짜 범위 계산
const getDayRange = (date) => {
  const d = new Date(date);
  const formatted = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return {
    startDate: formatted,
    endDate: formatted
  };
};

// 건물·객실 데이터 (App.jsx와 동일)
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

const ALL_BUILDINGS = "전체";

// Building name EN mapping (중앙 데이터 + 로컬 확장)
const BUILDING_NAMES_EN = { ..._BUILDING_NAMES_EN, "전체": "All Buildings" };
const getBuildingEN = (name) => BUILDING_NAMES_EN[name] || name;

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

const RevenueDashboard = () => {
  const { companyId } = useUser();
  // 현재 기수를 기본값으로 설정
  const [selectedPeriod, setSelectedPeriod] = useState(getCurrentPeriod());
  const [comparePeriod, setComparePeriod] = useState(getCurrentPeriod() - 1);
  const [loading, setLoading] = useState(true);

  // 날짜 모드 (기수/연/월/주/일/직접선택)
  const [dateMode, setDateMode] = useState(DATE_MODES.PERIOD);

  // ★ 비교 모드 상태
  const [viewMode, setViewMode] = useState('standard'); // 'standard' | 'custom_compare'

  // UI Selection State (Temporary)
  const [targetConfig, setTargetConfig] = useState({
    building: "아라키초A",
    rooms: [],
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1,
    period: getCurrentPeriod(),
    // For Custom Range
    startDate: "",
    endDate: ""
  });

  const [compareConfig, setCompareConfig] = useState({
    building: "아라키초A",
    rooms: [],
    year: new Date().getFullYear() - 1, // Default to prev year
    month: new Date().getMonth() + 1,
    period: getCurrentPeriod() - 1,
    // For Custom Range
    startDate: "",
    endDate: ""
  });

  // Verified Configuration (Applied on Search)
  const [verifiedConfig, setVerifiedConfig] = useState(null);

  // 연/월/주/일 선택용 state
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedWeekDate, setSelectedWeekDate] = useState(now);
  const [selectedDay, setSelectedDay] = useState(now);

  // 커스텀 날짜 검색 - 초기값 빈 문자열 (날짜 선택 전까지 데이터 없음)
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");

  // 데이터 상태
  const [monthlyData, setMonthlyData] = useState([]);
  const [, setBuildingData] = useState([]);
  const [buildingCompareData, setBuildingCompareData] = useState([]); // 건물별 비교 데이터
  const [roomData, setRoomData] = useState({});
  const [roomCompareData, setRoomCompareData] = useState({}); // 객실별 비교 데이터
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [compareRevenue, setCompareRevenue] = useState(0);

  // Effect: Standard Mode -> Auto Fetch / Custom Mode -> Fetch only when verifiedConfig updates
  useEffect(() => {
    if (!companyId) return;
    if (viewMode === 'standard') {
      fetchRevenueData();
    } else if (viewMode === 'custom_compare' && verifiedConfig) {
      fetchRevenueData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, selectedPeriod, comparePeriod, dateMode, selectedYear, selectedMonth, selectedWeekDate, selectedDay, customStartDate, customEndDate, viewMode, verifiedConfig]);

  // Search Button Handler
  const handleSearch = () => {
    setVerifiedConfig({
      target: { ...targetConfig },
      compare: { ...compareConfig },
      dateMode // Snapshot current date mode
    });
  };

  // 기수 또는 날짜 모드에 해당하는 날짜 범위 반환
  const getDateRange = (periodNum, isCompare = false) => {
    const formatDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    // 연도별 모드
    if (dateMode === DATE_MODES.YEAR) {
      if (isCompare) {
        return getYearRange(selectedYear - 1);
      }
      return getYearRange(selectedYear);
    }

    // 월별 모드
    if (dateMode === DATE_MODES.MONTH) {
      if (isCompare) {
        // 전년 동월
        return getMonthRange(selectedYear - 1, selectedMonth);
      }
      return getMonthRange(selectedYear, selectedMonth);
    }

    // 주별 모드
    if (dateMode === DATE_MODES.WEEK) {
      const currentRange = getWeekRange(selectedWeekDate);
      if (isCompare) {
        // 전년 동일 주
        const prevYearDate = new Date(selectedWeekDate);
        prevYearDate.setFullYear(prevYearDate.getFullYear() - 1);
        return getWeekRange(prevYearDate);
      }
      return currentRange;
    }

    // 일별 모드
    if (dateMode === DATE_MODES.DAY) {
      if (isCompare) {
        // 전년 동일
        const prevYearDate = new Date(selectedDay);
        prevYearDate.setFullYear(prevYearDate.getFullYear() - 1);
        return getDayRange(prevYearDate);
      }
      return getDayRange(selectedDay);
    }

    // 직접 선택 모드
    if (dateMode === DATE_MODES.CUSTOM && customStartDate && customEndDate) {
      if (isCompare) {
        const start = parseLocalDate(customStartDate);
        const end = parseLocalDate(customEndDate);
        start.setFullYear(start.getFullYear() - 1);
        end.setFullYear(end.getFullYear() - 1);
        return {
          startDate: formatDate(start),
          endDate: formatDate(end)
        };
      }
      return {
        startDate: customStartDate,
        endDate: customEndDate
      };
    }

    // 기수 모드 (기본)
    const period = getPeriodInfo(periodNum);
    const lastDay = new Date(period.endYear, period.endMonth, 0).getDate();
    return {
      startDate: `${period.startYear}-${String(period.startMonth).padStart(2, '0')}-01`,
      endDate: `${period.endYear}-${String(period.endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    };
  };

  // 날짜 모드가 기수 이외인지 확인
  const isNonPeriodMode = dateMode !== DATE_MODES.PERIOD;

  // Month names in English
  const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAY_NAMES_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // 월 라벨 생성 (기수/연/월/주/일에 따라 다르게)
  const getMonthLabels = () => {
    // 연도별: 1월~12월
    if (dateMode === DATE_MODES.YEAR) {
      return Array.from({ length: 12 }, (_, i) => ({
        key: `${selectedYear}-${String(i + 1).padStart(2, '0')}`,
        label: MONTH_NAMES_SHORT[i]
      }));
    }

    // 월별: 해당 월의 주차별 또는 단일 월
    if (dateMode === DATE_MODES.MONTH) {
      return [{
        key: `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`,
        label: MONTH_NAMES_SHORT[selectedMonth - 1]
      }];
    }

    // 주별: 해당 주의 일별
    if (dateMode === DATE_MODES.WEEK) {
      const range = getWeekRange(selectedWeekDate);
      const start = parseLocalDate(range.startDate);
      const labels = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        labels.push({
          key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
          label: `${d.getMonth() + 1}/${d.getDate()}(${DAY_NAMES_SHORT[i]})`
        });
      }
      return labels;
    }

    // 일별: 해당 일만
    if (dateMode === DATE_MODES.DAY) {
      const d = new Date(selectedDay);
      return [{
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        label: `${MONTH_NAMES_SHORT[d.getMonth()]} ${d.getDate()}`
      }];
    }

    // 직접 선택: 해당 범위의 월만 표시
    if (dateMode === DATE_MODES.CUSTOM && customStartDate && customEndDate) {
      const start = parseLocalDate(customStartDate);
      const end = parseLocalDate(customEndDate);
      const labels = [];

      let current = new Date(start.getFullYear(), start.getMonth(), 1);
      while (current <= end) {
        labels.push({
          key: `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`,
          label: MONTH_NAMES_SHORT[current.getMonth()]
        });
        current.setMonth(current.getMonth() + 1);
      }
      return labels;
    }

    // 기수 기준: 7월~12월, 1월~6월
    return [
      { key: '07', label: 'Jul' },
      { key: '08', label: 'Aug' },
      { key: '09', label: 'Sep' },
      { key: '10', label: 'Oct' },
      { key: '11', label: 'Nov' },
      { key: '12', label: 'Dec' },
      { key: '01', label: 'Jan' },
      { key: '02', label: 'Feb' },
      { key: '03', label: 'Mar' },
      { key: '04', label: 'Apr' },
      { key: '05', label: 'May' },
      { key: '06', label: 'Jun' },
    ];
  };

  const fetchRevenueData = async () => {
    if (!companyId) {
      console.warn('⚠️ No companyId for RevenueDashboard');
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const currentRange = getDateRange(selectedPeriod, false);
      // 비교 범위: Standard 모드일 때만 별도 계산, Custom 모드일 때는 currentRange 동일 사용 (단, 사용자가 비교군을 다른 날짜로 하고 싶다면? 기획상 '같은 기간 비교'가 기본. 일단 currentRange 사용)
      const compareRange = viewMode === 'custom_compare'
        ? currentRange
        : getDateRange(comparePeriod, isNonPeriodMode);

      // 전체 데이터 가져오기 (2023년부터)
      const q = query(
        collection(db, "reservations"),
        where("companyId", "==", companyId),
        where("status", "==", "confirmed")
      );

      const snapshot = await getDocs(q);
      let allDocs = snapshot.docs.map(d => d.data());
      // ★ 캘린더·Total Revenue 동일 기준: 화면용 집계에서 다이쿄초 제외 (DB는 유지)
      allDocs = allDocs.filter(d => (d.building || "") !== EXCLUDED_BUILDING_UI);

      console.log(`💰 매출 계산 시작: ${allDocs.length}건의 confirmed 예약 데이터 (다이쿄초 제외)`);

      // 월별 데이터 초기화
      const monthLabels = getMonthLabels();
      const monthlyMap = {};

      monthLabels.forEach(m => {
        monthlyMap[m.key] = { month: m.label, current: 0, compare: 0 };
      });

      // 집계 변수
      const bMapCurrent = {};
      const bMapCompare = {};
      const rMapCurrent = {};
      const rMapCompare = {};
      let totalCurrent = 0;
      let totalCompare = 0;

      // ★ 핵심 계산 로직 함수 (재사용)
      // docs: 대상 예약 목록
      // range: 계산할 날짜 범위
      // field: 'current' | 'compare' (저장할 필드명)
      // keyMapper: 날짜를 monthlyMap 키로 매핑하는 함수 (비교군 연도 보정 등을 위함)
      const processRevenue = (docs, range, field, keyMapper) => {
        let rangeTotal = 0;
        const rangeStart = parseLocalDate(range.startDate);
        const rangeEnd = parseLocalDate(range.endDate);

        docs.forEach(doc => {
          if (!doc.arrival || !doc.departure) return;

          const totalPrice = Number(doc.totalPrice || doc.price) || 0;
          const bName = doc.building || "Unknown";
          const rName = doc.room || "Unknown";

          if (bName === EXCLUDED_BUILDING_UI) return;

          const arrivalDate = parseLocalDate(doc.arrival);
          const departureDate = parseLocalDate(doc.departure);
          const totalNights = Math.floor((departureDate - arrivalDate) / (1000 * 60 * 60 * 24));

          if (totalNights <= 0) return;

          const pricePerNight = totalPrice / totalNights;

          // 범위 겹침 확인
          if (departureDate > rangeStart && arrivalDate <= rangeEnd) {
            const overlapStart = new Date(Math.max(arrivalDate, rangeStart));
            const overlapEndDate = new Date(departureDate);
            overlapEndDate.setDate(overlapEndDate.getDate() - 1);
            const overlapEnd = new Date(Math.min(overlapEndDate, rangeEnd));

            if (overlapStart <= overlapEnd) {
              const overlapNights = Math.floor((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24)) + 1;
              const overlapRevenue = pricePerNight * overlapNights;

              // 1. 월별 분배 (차트용)
              if (dateMode === DATE_MODES.WEEK) {
                // 주별 모드: 요일 매핑
                const refStart = parseLocalDate(range.startDate);
                let current = new Date(overlapStart);
                while (current <= overlapEnd) {
                  const dayIndex = Math.floor((current - refStart) / (1000 * 60 * 60 * 24));
                  if (dayIndex >= 0 && dayIndex < 7) {
                    const targetKey = monthLabels[dayIndex]?.key;
                    if (targetKey && monthlyMap[targetKey]) {
                      monthlyMap[targetKey][field] += pricePerNight;
                    }
                  }
                  current.setDate(current.getDate() + 1);
                }
              } else if (dateMode === DATE_MODES.DAY) {
                // 일별 모드
                const dayKey = monthLabels[0]?.key;
                if (dayKey && monthlyMap[dayKey]) {
                  // 전체 금액 합산
                  monthlyMap[dayKey][field] += overlapRevenue;
                }
              } else {
                // 월별/기수/연도 모드
                let current = new Date(overlapStart);
                while (current <= overlapEnd) {
                  const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);
                  const periodEnd = overlapEnd < monthEnd ? overlapEnd : monthEnd;

                  const monthNights = Math.floor((periodEnd - current) / (1000 * 60 * 60 * 24)) + 1;
                  const monthRevenue = pricePerNight * monthNights;

                  const monthKey = keyMapper ? keyMapper(current) : String(current.getMonth() + 1).padStart(2, '0');

                  if (monthlyMap[monthKey]) {
                    monthlyMap[monthKey][field] += monthRevenue;
                  }

                  current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
                }
              }

              // 2. 총계 및 건물/객실별 집계
              rangeTotal += overlapRevenue;

              // Map 업데이트
              const bMap = field === 'current' ? bMapCurrent : bMapCompare;
              const rMap = field === 'current' ? rMapCurrent : rMapCompare;

              bMap[bName] = (bMap[bName] || 0) + overlapRevenue;
              if (!rMap[bName]) rMap[bName] = {};
              rMap[bName][rName] = (rMap[bName][rName] || 0) + overlapRevenue;
            }
          }
        });

        return rangeTotal;
      };

      // === 실행 로직 ===

      if (viewMode === 'custom_compare') {
        if (!verifiedConfig) return; // Should not happen if triggered correctly

        // 1. Target Group
        // Get Date Range based on verifiedConfig.target
        const getCustomDateRange = (config) => {
          // Reuse logic but use config's date params
          const formatDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

          if (verifiedConfig.dateMode === DATE_MODES.YEAR) return getYearRange(config.year);
          if (verifiedConfig.dateMode === DATE_MODES.MONTH) return getMonthRange(config.year, config.month);
          if (verifiedConfig.dateMode === DATE_MODES.PERIOD) {
            const p = getPeriodInfo(config.period);
            const lastDay = new Date(p.endYear, p.endMonth, 0).getDate();
            return {
              startDate: `${p.startYear}-${String(p.startMonth).padStart(2, '0')}-01`,
              endDate: `${p.endYear}-${String(p.endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
            };
          }
          if (verifiedConfig.dateMode === DATE_MODES.WEEK) {
            // Week mode: Use startDate as base, calculate week range
            if (config.startDate) {
              const baseDate = parseLocalDate(config.startDate);
              const dayOfWeek = baseDate.getDay();
              const monday = new Date(baseDate);
              monday.setDate(baseDate.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
              const sunday = new Date(monday);
              sunday.setDate(monday.getDate() + 6);
              return {
                startDate: formatDate(monday),
                endDate: formatDate(sunday)
              };
            }
            return getWeekRange(selectedWeekDate); // Fallback to global
          }
          if (verifiedConfig.dateMode === DATE_MODES.DAY) {
            // Day mode: Use startDate directly
            if (config.startDate) {
              return { startDate: config.startDate, endDate: config.startDate };
            }
            return getDayRange(selectedDay); // Fallback to global
          }
          if (verifiedConfig.dateMode === DATE_MODES.CUSTOM) {
            return { startDate: config.startDate, endDate: config.endDate };
          }
          return getDateRange(selectedPeriod, false); // Fallback
        }

        const targetRange = getCustomDateRange(verifiedConfig.target);
        const compareRange = getCustomDateRange(verifiedConfig.compare);

        // Target Group Processing
        const targetDocs = allDocs.filter(d => {
          if (verifiedConfig.target.building !== ALL_BUILDINGS && d.building !== verifiedConfig.target.building) return false;
          if (verifiedConfig.target.building !== ALL_BUILDINGS && verifiedConfig.target.rooms.length > 0 && !verifiedConfig.target.rooms.includes(d.room)) return false;
          return true;
        });

        // We need to Re-generate monthLabels based on Target Range to ensure X-axis is correct for Target
        // But `monthLabels` var is derived from global state outside. 
        // Refactoring constraint: We are inside fetch.
        // Let's stick to using the derived keys but make sure mapper matches them.

        // RE-CHECK `getMonthLabels`:
        // For YEAR logic: keys are "YYYY-MM". Labels are "Jan", "Feb".
        // The chart uses `monthLabels` to map data.
        // If we want to compare 2024 vs 2023, keys must match.
        // Option A: Use "MM" as key for both.
        // Option B: Map 2023 data to 2024 keys.

        // Let's use Option B (current Standard mode does this).
        // Target: 2024 (Use YYYY-MM keys)
        // Compare: 2023 -> Map to 2024-MM.

        const targetStartYear = parseLocalDate(targetRange.startDate).getFullYear();
        const compareStartYear = parseLocalDate(compareRange.startDate).getFullYear();
        const yearDiff = targetStartYear - compareStartYear;

        const comparisonMapper = (date) => {
          // Shift date by yearDiff to match Target Keys
          const shifted = new Date(date);
          shifted.setFullYear(shifted.getFullYear() + yearDiff);

          if (verifiedConfig.dateMode === DATE_MODES.YEAR) {
            return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}`;
          }
          // Period mode uses '07', '08' keys (no year).
          if (verifiedConfig.dateMode === DATE_MODES.PERIOD) {
            return String(date.getMonth() + 1).padStart(2, '0');
          }
          // Month mode uses single key or daily??
          // Existing: `key: selectedYear-selectedMonth`
          return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}`;
        };

        const targetMapper = (date) => {
          if (verifiedConfig.dateMode === DATE_MODES.YEAR) {
            return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          }
          if (verifiedConfig.dateMode === DATE_MODES.PERIOD) {
            return String(date.getMonth() + 1).padStart(2, '0');
          }
          return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        };

        totalCurrent = processRevenue(targetDocs, targetRange, 'current', targetMapper);
        const compareDocs = allDocs.filter(d => {
          if (verifiedConfig.compare.building !== ALL_BUILDINGS && d.building !== verifiedConfig.compare.building) return false;
          if (verifiedConfig.compare.building !== ALL_BUILDINGS && verifiedConfig.compare.rooms.length > 0 && !verifiedConfig.compare.rooms.includes(d.room)) return false;
          return true;
        });

        totalCompare = processRevenue(compareDocs, compareRange, 'compare', comparisonMapper);

      } else {
        // [Standard Mode] - 기존 로직 100% 동일

        // Current Period
        const currentMapper = (date) => {
          if (isNonPeriodMode) {
            return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          }
          return String(date.getMonth() + 1).padStart(2, '0');
        };
        totalCurrent = processRevenue(allDocs, currentRange, 'current', currentMapper);

        // Compare Period
        const compareMapper = (date) => {
          // 비교 기간(작년) 데이터를 현재 차트(올해) 키에 매핑
          if (isNonPeriodMode) {
            // 예: 2024-07 -> 2025-07 매핑
            // dateMode가 YEAR, CUSTOM 등일 때 연도 + 1 처리
            const mappedYear = date.getFullYear() + 1;
            return `${mappedYear}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          }
          // 기수 모드: 그냥 월만 일치하면 됨
          return String(date.getMonth() + 1).padStart(2, '0');
        };
        totalCompare = processRevenue(allDocs, compareRange, 'compare', compareMapper);
      }

      // 차트용 배열 변환
      const chartData = monthLabels.map(m => monthlyMap[m.key] || { month: m.label, current: 0, compare: 0 });

      // 건물별 데이터 (정렬) - 화면 표시용이므로 다이쿄초 제외
      const buildingChartData = getActiveBuildingOrder()
        .filter(name => bMapCurrent[name] || bMapCompare[name])
        .map(name => ({
          name,
          current: bMapCurrent[name] || 0,
          compare: bMapCompare[name] || 0
        }));

      // 다른 건물들 추가 (Beds24 등 기타) - 다이쿄초 제외
      Object.keys(bMapCurrent).forEach(name => {
        if (name === EXCLUDED_BUILDING_UI) return;
        if (!BUILDING_ORDER.includes(name)) {
          buildingChartData.push({
            name,
            current: bMapCurrent[name] || 0,
            compare: bMapCompare[name] || 0
          });
        }
      });
      // Compare에만 있는 건물도 추가
      Object.keys(bMapCompare).forEach(name => {
        if (name === EXCLUDED_BUILDING_UI) return;
        const exists = buildingChartData.find(b => b.name === name);
        if (!exists && !BUILDING_ORDER.includes(name)) {
          buildingChartData.push({
            name,
            current: 0,
            compare: bMapCompare[name] || 0
          });
        }
      });

      setMonthlyData(chartData);
      setBuildingData(buildingChartData.map(b => ({ name: b.name, value: b.current }))); // 단순 BarChart용
      setBuildingCompareData(buildingChartData);
      setRoomData(rMapCurrent);
      setRoomCompareData(rMapCompare);
      setTotalRevenue(totalCurrent);
      setCompareRevenue(totalCompare);

    } catch (error) {
      console.error("매출 데이터 로딩 실패:", error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (val) => {
    return "¥ " + Math.round(val).toLocaleString();
  };

  const getGrowthRate = (current, compare) => {
    if (!compare || compare === 0) return null;
    return ((current - compare) / compare * 100).toFixed(1);
  };

  const currentPeriodInfo = getPeriodInfo(selectedPeriod);
  const comparePeriodInfo = getPeriodInfo(comparePeriod);

  // 표시용 라벨 생성
  const getCurrentLabel = () => {
    if (viewMode === 'custom_compare') {
      if (targetConfig.building === ALL_BUILDINGS) {
        return `Target: All Buildings`;
      }
      const roomText = targetConfig.rooms.length === 0 ? "All Rooms" : targetConfig.rooms.length > 2 ? `${targetConfig.rooms.length} Rooms` : targetConfig.rooms.map(r => getRoomEN(r)).join(", ");
      return `Target: ${getBuildingEN(targetConfig.building)} (${roomText})`;
    }

    const range = getDateRange(selectedPeriod, false);
    switch (dateMode) {
      case DATE_MODES.YEAR:
        return `${selectedYear}`;
      case DATE_MODES.MONTH:
        return `${MONTH_NAMES_SHORT[selectedMonth - 1]} ${selectedYear} (whole month)`;
      case DATE_MODES.WEEK:
        return `${range.startDate} ~ ${range.endDate}`;
      case DATE_MODES.DAY:
        return `${MONTH_NAMES_SHORT[selectedDay.getMonth()]} ${selectedDay.getDate()}, ${selectedDay.getFullYear()} (1 day)`;
      case DATE_MODES.CUSTOM:
        return `${customStartDate} ~ ${customEndDate}`;
      default:
        return `Period ${currentPeriodInfo.period} (${currentPeriodInfo.startYear}.${currentPeriodInfo.startMonth}~${currentPeriodInfo.endYear}.${currentPeriodInfo.endMonth})`;
    }
  };

  const getCompareLabel = () => {
    if (viewMode === 'custom_compare') {
      if (compareConfig.building === ALL_BUILDINGS) {
        return `Compare: All Buildings`;
      }
      const roomText = compareConfig.rooms.length === 0 ? "All Rooms" : compareConfig.rooms.length > 2 ? `${compareConfig.rooms.length} Rooms` : compareConfig.rooms.map(r => getRoomEN(r)).join(", ");
      return `Compare: ${getBuildingEN(compareConfig.building)} (${roomText})`;
    }

    switch (dateMode) {
      case DATE_MODES.YEAR:
        return `${selectedYear - 1}`;
      case DATE_MODES.MONTH:
        return `${MONTH_NAMES_SHORT[selectedMonth - 1]} ${selectedYear - 1}`;
      case DATE_MODES.WEEK:
      case DATE_MODES.DAY:
      case DATE_MODES.CUSTOM:
        return `Previous Year`;
      default:
        return `Period ${comparePeriodInfo.period} (${comparePeriodInfo.startYear}.${comparePeriodInfo.startMonth}~${comparePeriodInfo.endYear}.${comparePeriodInfo.endMonth})`;
    }
  };

  const currentLabel = getCurrentLabel();
  const compareLabel = getCompareLabel();

  // 주차 이동 함수
  const moveWeek = (direction) => {
    const newDate = new Date(selectedWeekDate);
    newDate.setDate(newDate.getDate() + (direction * 7));
    setSelectedWeekDate(newDate);
  };

  // 일자 이동 함수
  const moveDay = (direction) => {
    const newDate = new Date(selectedDay);
    newDate.setDate(newDate.getDate() + direction);
    setSelectedDay(newDate);
  };

  // ★ 비교 설정 핸들러
  const handleBuildingChange = (isTarget, building) => {
    const setter = isTarget ? setTargetConfig : setCompareConfig;
    // 건물 변경 시 객실 선택 초기화 (전체 선택 상태인 빈 배열로? 아니면 빈 배열은 '전체'가 아니라 '선택안함'?
    // 기획상: 방을 하나도 선택 안하면 -> 매출 0이 됨 (필터링이므로).
    // 따라서 건물 변경 시 편의상 '전체 선택'이 나을 수도 있고, '전체 해제'가 나을 수도 있음.
    // 기존 로직: `rooms`가 비어있으면 로직에서 filter할 때 어떻게 처리했지?
    // processRevenue에서: `if (targetConfig.rooms.length > 0 && !targetConfig.rooms.includes(d.room)) return false;`
    // 즉, rooms가 비어있으면 "전체 선택"이 아니라 "필터링 안함" -> 즉 "전체 포함".
    // 그러므로 초기값 []은 "전체 선택"과 동일한 효과.
    setter(prev => ({ ...prev, building, rooms: [] }));
  };

  const toggleRoom = (isTarget, room) => {
    const config = isTarget ? targetConfig : compareConfig;
    // 현재 rooms가 비어있으면 (전체 선택 상태), 먼저 전체 목록을 채운 뒤 uncheck해야 함
    let currentRooms = config.rooms;
    const allRooms = BUILDING_DATA[config.building] || [];

    if (currentRooms.length === 0) {
      // "전체" 상태에서 하나를 끄는 경우 -> 나머지 다 선택하고 그 방만 뺌
      currentRooms = [...allRooms];
    }

    // 이제 토글
    const newRooms = currentRooms.includes(room)
      ? currentRooms.filter(r => r !== room)
      : [...currentRooms, room];

    // 만약 모든 방이 선택되었다면 다시 [] (전체 모드)로 최적화?
    // 아니면 명시적으로 다 들고 있을까? 명시적인게 UI 처리에 덜 헷갈림.
    // 하지만 로직상 [] = 전체 이므로, UI에서도 이를 반영해야 함.
    // 여기서는 명시적으로 배열 관리하고, "전체 선택" 버튼 누을 때만 []로 초기화하는게 UX상 헷갈릴 수 있음.
    // -> 로직 수정: `rooms: []`를 "아무것도 선택 안함"으로 할지 "전체"로 할지.
    // 보통 필터 UI에서는 "선택 없으면 전체"가 관례.
    // 하지만 "대상 그룹" 설정에서는 명시적 선택을 원할 수도.
    // 일단 "선택 없으면 전체" 로직 유지하고, UI 표시할 때 "All Selected" 처리.

    // 수정: Checkbox UI이므로, [] 상태 (전체)와 [a,b,c] 상태 (전체)를 구분하지 않으면,
    // 하나 껐을 때 나머지 다 켜지는 로직 필요.

    // 다시 정리:
    // rooms: [] -> All selected logic in fetchRevenueData
    // UI: Checkbox for each room.
    // If rooms is empty, all checkboxes checked.
    // If user unchecks one, rooms becomes [current_all - that_one].

    const isNowAll = newRooms.length === allRooms.length;
    const setter = isTarget ? setTargetConfig : setCompareConfig;
    setter(prev => ({ ...prev, rooms: isNowAll ? [] : newRooms }));
  };

  const selectAllRooms = (isTarget) => {
    const setter = isTarget ? setTargetConfig : setCompareConfig;
    setter(prev => ({ ...prev, rooms: [] })); // Empty = All
  };

  const isRoomSelected = (isTarget, room) => {
    const config = isTarget ? targetConfig : compareConfig;
    if (config.rooms.length === 0) return true; // Empty = All
    return config.rooms.includes(room);
  };

  // 연도 옵션 생성 (2022 ~ 현재 + 1년)
  const yearOptions = [];
  for (let y = 2022; y <= now.getFullYear() + 1; y++) {
    yearOptions.push(y);
  }



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
        marginBottom: "28px",
        flexWrap: "wrap",
        gap: "20px"
      }}>
        <div>
          <h1 style={{
            fontSize: "28px",
            fontWeight: "700",
            color: "#1E293B",
            margin: 0,
            marginBottom: "8px"
          }}>
            Revenue Dashboard
          </h1>
          <p style={{
            fontSize: "14px",
            color: "#64748B",
            margin: 0
          }}>
            Comprehensive revenue analytics and fiscal period comparison
          </p>
        </div>
      </div>

      {/* View Mode Toggle */}
      <div style={{
        display: "flex",
        justifyContent: "center",
        marginBottom: "20px",
        gap: "4px",
        background: "#F1F5F9",
        padding: "4px",
        borderRadius: "12px",
        width: "fit-content",
        margin: "0 auto 24px"
      }}>
        {['standard', 'custom_compare'].map(mode => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            style={{
              padding: "10px 24px",
              borderRadius: "10px",
              border: "none",
              background: viewMode === mode ? "white" : "transparent",
              color: viewMode === mode ? "#1F2937" : "#6B7280",
              fontWeight: "600",
              fontSize: "14px",
              cursor: "pointer",
              boxShadow: viewMode === mode ? "0 2px 4px rgba(0,0,0,0.05)" : "none",
              transition: "all 0.2s ease"
            }}
          >
            {mode === 'standard' ? 'Standard Analytics' : 'Custom Comparison'}
          </button>
        ))}
      </div>

      {/* Premium Period Selector Card */}
      <div style={{
        background: "white",
        padding: "24px",
        borderRadius: "20px",
        marginBottom: "24px",
        boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
        border: "1px solid #E5E7EB"
      }}>
        {/* Mode Tabs */}
        <div style={{
          display: "flex",
          gap: "6px",
          marginBottom: "20px",
          background: "#F3F4F6",
          padding: "6px",
          borderRadius: "14px",
          width: "fit-content"
        }}>
          {[
            { mode: DATE_MODES.PERIOD, label: "Fiscal Period", icon: "📊" },
            { mode: DATE_MODES.YEAR, label: "Yearly", icon: "📅" },
            { mode: DATE_MODES.MONTH, label: "Monthly", icon: "🗓️" },
            { mode: DATE_MODES.WEEK, label: "Weekly", icon: "📆" },
            { mode: DATE_MODES.DAY, label: "Daily", icon: "📌" },
            { mode: DATE_MODES.CUSTOM, label: "Custom", icon: "🎯" }
          ].map(({ mode, label, icon }) => (
            <button
              key={mode}
              onClick={() => setDateMode(mode)}
              style={{
                padding: "12px 20px",
                borderRadius: "10px",
                border: "none",
                background: dateMode === mode ? "linear-gradient(135deg, #10B981 0%, #059669 100%)" : "transparent",
                color: dateMode === mode ? "white" : "#6B7280",
                fontWeight: "600",
                fontSize: "14px",
                cursor: "pointer",
                whiteSpace: "nowrap",
                transition: "all 0.2s ease",
                boxShadow: dateMode === mode ? "0 4px 12px rgba(16, 185, 129, 0.3)" : "none",
                display: "flex",
                alignItems: "center",
                gap: "6px"
              }}
            >
              <span style={{ fontSize: "14px" }}>{icon}</span>
              {label}
            </button>
          ))}
        </div>

        {/* Mode-specific Selection UI - Standard Mode Only for Global Selectors */}
        {viewMode === 'standard' && (
          <div style={{
            display: "flex",
            gap: "16px",
            flexWrap: "wrap",
            alignItems: "flex-end"
          }}>
            {/* Fiscal Period Mode */}
            {dateMode === DATE_MODES.PERIOD && (
              <>
                <div style={{ flex: "1 1 200px", minWidth: "200px" }}>
                  <label style={{
                    fontSize: "12px",
                    color: "#6B7280",
                    display: "block",
                    marginBottom: "8px",
                    fontWeight: "600",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px"
                  }}>Current Period</label>
                  <div style={{
                    position: "relative",
                    background: "linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)",
                    borderRadius: "14px",
                    border: "2px solid #10B981",
                    overflow: "hidden"
                  }}>
                    <select
                      style={{
                        width: "100%",
                        padding: "14px 16px",
                        border: "none",
                        background: "transparent",
                        fontSize: "15px",
                        fontWeight: "600",
                        color: "#065F46",
                        cursor: "pointer",
                        outline: "none",
                        appearance: "none"
                      }}
                      value={selectedPeriod}
                      onChange={(e) => setSelectedPeriod(Number(e.target.value))}
                    >
                      {FISCAL_PERIODS.map(p => (
                        <option key={p.period} value={p.period}>
                          Period {p.period} ({p.startYear}.{p.startMonth}~{p.endYear}.{p.endMonth})
                        </option>
                      ))}
                    </select>
                    <div style={{
                      position: "absolute",
                      right: "14px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      pointerEvents: "none"
                    }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </div>
                  </div>
                </div>
                {viewMode === 'standard' && (
                  <div style={{ flex: "1 1 200px", minWidth: "200px" }}>
                    <label style={{
                      fontSize: "12px",
                      color: "#6B7280",
                      display: "block",
                      marginBottom: "8px",
                      fontWeight: "600",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px"
                    }}>Compare Period</label>
                    <div style={{
                      position: "relative",
                      background: "#F9FAFB",
                      borderRadius: "14px",
                      border: "1px solid #E5E7EB",
                      overflow: "hidden"
                    }}>
                      <select
                        style={{
                          width: "100%",
                          padding: "14px 16px",
                          border: "none",
                          background: "transparent",
                          fontSize: "15px",
                          fontWeight: "500",
                          color: "#374151",
                          cursor: "pointer",
                          outline: "none",
                          appearance: "none"
                        }}
                        value={comparePeriod}
                        onChange={(e) => setComparePeriod(Number(e.target.value))}
                      >
                        {FISCAL_PERIODS.map(p => (
                          <option key={p.period} value={p.period}>
                            Period {p.period} ({p.startYear}.{p.startMonth}~{p.endYear}.{p.endMonth})
                          </option>
                        ))}
                      </select>
                      <div style={{
                        position: "absolute",
                        right: "14px",
                        top: "50%",
                        transform: "translateY(-50%)",
                        pointerEvents: "none"
                      }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2.5">
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Yearly Mode */}
            {dateMode === DATE_MODES.YEAR && (
              <div style={{ flex: "1 1 200px", minWidth: "200px" }}>
                <label style={{
                  fontSize: "12px",
                  color: "#6B7280",
                  display: "block",
                  marginBottom: "8px",
                  fontWeight: "600",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px"
                }}>Select Year</label>
                <div style={{
                  position: "relative",
                  background: "linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)",
                  borderRadius: "14px",
                  border: "2px solid #10B981",
                  overflow: "hidden"
                }}>
                  <select
                    style={{
                      width: "100%",
                      padding: "14px 16px",
                      border: "none",
                      background: "transparent",
                      fontSize: "15px",
                      fontWeight: "600",
                      color: "#065F46",
                      cursor: "pointer",
                      outline: "none",
                      appearance: "none"
                    }}
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(Number(e.target.value))}
                  >
                    {yearOptions.map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                  <div style={{
                    position: "absolute",
                    right: "14px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    pointerEvents: "none"
                  }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                </div>
                {viewMode === 'standard' && (
                  <div style={{
                    fontSize: "12px",
                    color: "#6B7280",
                    marginTop: "8px",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px"
                  }}>
                    <span style={{ color: "#9CA3AF" }}>vs</span>
                    <span style={{ fontWeight: "600" }}>{selectedYear - 1}</span>
                  </div>
                )}
              </div>
            )}

            {/* Monthly Mode */}
            {dateMode === DATE_MODES.MONTH && (
              <>
                <div style={{ flex: "1 1 140px", minWidth: "140px" }}>
                  <label style={{
                    fontSize: "12px",
                    color: "#6B7280",
                    display: "block",
                    marginBottom: "8px",
                    fontWeight: "600",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px"
                  }}>Year</label>
                  <div style={{
                    position: "relative",
                    background: "#F9FAFB",
                    borderRadius: "12px",
                    border: "1px solid #E5E7EB",
                    overflow: "hidden"
                  }}>
                    <select
                      style={{
                        width: "100%",
                        padding: "12px 14px",
                        border: "none",
                        background: "transparent",
                        fontSize: "14px",
                        fontWeight: "600",
                        color: "#374151",
                        cursor: "pointer",
                        outline: "none",
                        appearance: "none"
                      }}
                      value={selectedYear}
                      onChange={(e) => setSelectedYear(Number(e.target.value))}
                    >
                      {yearOptions.map(y => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div style={{ flex: "1 1 140px", minWidth: "140px" }}>
                  <label style={{
                    fontSize: "12px",
                    color: "#6B7280",
                    display: "block",
                    marginBottom: "8px",
                    fontWeight: "600",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px"
                  }}>Month</label>
                  <div style={{
                    position: "relative",
                    background: "linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)",
                    borderRadius: "12px",
                    border: "2px solid #10B981",
                    overflow: "hidden"
                  }}>
                    <select
                      style={{
                        width: "100%",
                        padding: "12px 14px",
                        border: "none",
                        background: "transparent",
                        fontSize: "14px",
                        fontWeight: "600",
                        color: "#065F46",
                        cursor: "pointer",
                        outline: "none",
                        appearance: "none"
                      }}
                      value={selectedMonth}
                      onChange={(e) => setSelectedMonth(Number(e.target.value))}
                    >
                      {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                        <option key={m} value={m}>{MONTH_NAMES_SHORT[m - 1]}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {viewMode === 'standard' && (
                  <div style={{
                    fontSize: "12px",
                    color: "#6B7280",
                    alignSelf: "flex-end",
                    paddingBottom: "14px",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px"
                  }}>
                    <span style={{ color: "#9CA3AF" }}>vs</span>
                    <span style={{ fontWeight: "600" }}>{selectedYear - 1}.{String(selectedMonth).padStart(2, '0')}</span>
                  </div>
                )}
              </>
            )}

            {/* Weekly Mode */}
            {dateMode === DATE_MODES.WEEK && (
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <button
                  onClick={() => moveWeek(-1)}
                  style={{
                    padding: "12px 16px",
                    borderRadius: "12px",
                    border: "1px solid #E5E7EB",
                    background: "white",
                    cursor: "pointer",
                    fontSize: "16px",
                    transition: "all 0.2s",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="2.5">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <div style={{
                  padding: "12px 24px",
                  background: "linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)",
                  borderRadius: "12px",
                  border: "2px solid #10B981",
                  fontWeight: "700",
                  fontSize: "15px",
                  textAlign: "center",
                  minWidth: "220px",
                  color: "#065F46"
                }}>
                  {(() => {
                    const range = getWeekRange(selectedWeekDate);
                    return `${range.startDate} ~ ${range.endDate}`;
                  })()}
                </div>
                <button
                  onClick={() => moveWeek(1)}
                  style={{
                    padding: "12px 16px",
                    borderRadius: "12px",
                    border: "1px solid #E5E7EB",
                    background: "white",
                    cursor: "pointer",
                    fontSize: "16px",
                    transition: "all 0.2s",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="2.5">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
                <button
                  onClick={() => setSelectedWeekDate(new Date())}
                  style={{
                    padding: "12px 20px",
                    borderRadius: "12px",
                    border: "none",
                    background: "linear-gradient(135deg, #10B981 0%, #059669 100%)",
                    color: "white",
                    cursor: "pointer",
                    fontSize: "14px",
                    fontWeight: "600",
                    boxShadow: "0 4px 12px rgba(16, 185, 129, 0.3)"
                  }}
                >
                  This Week
                </button>
              </div>
            )}

            {/* Daily Mode */}
            {dateMode === DATE_MODES.DAY && (
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <button
                  onClick={() => moveDay(-1)}
                  style={{
                    padding: "12px 16px",
                    borderRadius: "12px",
                    border: "1px solid #E5E7EB",
                    background: "white",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="2.5">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                {/* Custom Date Picker - Year/Month/Day dropdowns */}
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "10px 16px",
                  borderRadius: "12px",
                  border: "2px solid #10B981",
                  background: "linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)"
                }}>
                  <select
                    value={selectedDay.getFullYear()}
                    onChange={(e) => {
                      const newDate = new Date(selectedDay);
                      newDate.setFullYear(Number(e.target.value));
                      setSelectedDay(newDate);
                    }}
                    style={{
                      border: "none",
                      background: "transparent",
                      fontSize: "15px",
                      fontWeight: "700",
                      color: "#065F46",
                      cursor: "pointer",
                      outline: "none",
                      appearance: "none"
                    }}
                  >
                    {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                  <span style={{ color: "#10B981", fontWeight: "500" }}>-</span>
                  <select
                    value={selectedDay.getMonth() + 1}
                    onChange={(e) => {
                      const newDate = new Date(selectedDay);
                      newDate.setMonth(Number(e.target.value) - 1);
                      setSelectedDay(newDate);
                    }}
                    style={{
                      border: "none",
                      background: "transparent",
                      fontSize: "15px",
                      fontWeight: "700",
                      color: "#065F46",
                      cursor: "pointer",
                      outline: "none",
                      appearance: "none"
                    }}
                  >
                    {Array.from({ length: 12 }, (_, i) => (
                      <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, '0')} {MONTH_NAMES_SHORT[i]}</option>
                    ))}
                  </select>
                  <span style={{ color: "#10B981", fontWeight: "500" }}>-</span>
                  <select
                    value={selectedDay.getDate()}
                    onChange={(e) => {
                      const newDate = new Date(selectedDay);
                      newDate.setDate(Number(e.target.value));
                      setSelectedDay(newDate);
                    }}
                    style={{
                      border: "none",
                      background: "transparent",
                      fontSize: "15px",
                      fontWeight: "700",
                      color: "#065F46",
                      cursor: "pointer",
                      outline: "none",
                      appearance: "none"
                    }}
                  >
                    {Array.from({ length: new Date(selectedDay.getFullYear(), selectedDay.getMonth() + 1, 0).getDate() }, (_, i) => (
                      <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, '0')}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => moveDay(1)}
                  style={{
                    padding: "12px 16px",
                    borderRadius: "12px",
                    border: "1px solid #E5E7EB",
                    background: "white",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="2.5">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
                <button
                  onClick={() => setSelectedDay(new Date())}
                  style={{
                    padding: "12px 20px",
                    borderRadius: "12px",
                    border: "none",
                    background: "linear-gradient(135deg, #10B981 0%, #059669 100%)",
                    color: "white",
                    cursor: "pointer",
                    fontSize: "14px",
                    fontWeight: "600",
                    boxShadow: "0 4px 12px rgba(16, 185, 129, 0.3)"
                  }}
                >
                  Today
                </button>
              </div>
            )}

            {/* Custom Mode */}
            {dateMode === DATE_MODES.CUSTOM && (() => {
              // 각각의 필드를 개별적으로 추적
              const startYear = customStartDate ? Number(customStartDate.split('-')[0]) : "";
              const startMonth = customStartDate ? Number(customStartDate.split('-')[1]) : "";
              const startDay = customStartDate ? Number(customStartDate.split('-')[2]) : "";
              const endYear = customEndDate ? Number(customEndDate.split('-')[0]) : "";
              const endMonth = customEndDate ? Number(customEndDate.split('-')[1]) : "";
              const endDay = customEndDate ? Number(customEndDate.split('-')[2]) : "";

              const selectStyle = {
                border: "none",
                background: "transparent",
                fontSize: "14px",
                fontWeight: "700",
                color: "#065F46",
                cursor: "pointer",
                outline: "none",
                minWidth: "50px",
                textAlign: "center"
              };

              return (
                <div style={{ display: "flex", gap: "12px", alignItems: "flex-end", flexWrap: "wrap" }}>
                  <div>
                    <label style={{
                      fontSize: "12px",
                      color: "#6B7280",
                      display: "block",
                      marginBottom: "8px",
                      fontWeight: "600",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px"
                    }}>Start Date</label>
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      padding: "10px 14px",
                      borderRadius: "12px",
                      border: customStartDate ? "2px solid #10B981" : "2px solid #D1D5DB",
                      background: customStartDate ? "linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)" : "#F9FAFB"
                    }}>
                      <select
                        value={startYear}
                        onChange={(e) => {
                          const y = Number(e.target.value);
                          const m = startMonth || 1;
                          const d = startDay || 1;
                          setCustomStartDate(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
                        }}
                        style={selectStyle}
                      >
                        <option value="">YYYY</option>
                        {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                      </select>
                      <span style={{ color: customStartDate ? "#10B981" : "#9CA3AF" }}>-</span>
                      <select
                        value={startMonth}
                        onChange={(e) => {
                          const m = Number(e.target.value);
                          const y = startYear || now.getFullYear();
                          const d = startDay || 1;
                          setCustomStartDate(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
                        }}
                        style={selectStyle}
                      >
                        <option value="">MM</option>
                        {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, '0')}</option>)}
                      </select>
                      <span style={{ color: customStartDate ? "#10B981" : "#9CA3AF" }}>-</span>
                      <select
                        value={startDay}
                        onChange={(e) => {
                          const d = Number(e.target.value);
                          const y = startYear || now.getFullYear();
                          const m = startMonth || 1;
                          setCustomStartDate(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
                        }}
                        style={selectStyle}
                      >
                        <option value="">DD</option>
                        {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, '0')}</option>)}
                      </select>
                    </div>
                  </div>
                  <span style={{
                    paddingBottom: "14px",
                    color: "#9CA3AF",
                    fontSize: "16px",
                    fontWeight: "500"
                  }}>→</span>
                  <div>
                    <label style={{
                      fontSize: "12px",
                      color: "#6B7280",
                      display: "block",
                      marginBottom: "8px",
                      fontWeight: "600",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px"
                    }}>End Date</label>
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      padding: "10px 14px",
                      borderRadius: "12px",
                      border: customEndDate ? "2px solid #10B981" : "2px solid #D1D5DB",
                      background: customEndDate ? "linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)" : "#F9FAFB"
                    }}>
                      <select
                        value={endYear}
                        onChange={(e) => {
                          const y = Number(e.target.value);
                          const m = endMonth || 1;
                          const d = endDay || 1;
                          setCustomEndDate(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
                        }}
                        style={selectStyle}
                      >
                        <option value="">YYYY</option>
                        {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                      </select>
                      <span style={{ color: customEndDate ? "#10B981" : "#9CA3AF" }}>-</span>
                      <select
                        value={endMonth}
                        onChange={(e) => {
                          const m = Number(e.target.value);
                          const y = endYear || now.getFullYear();
                          const d = endDay || 1;
                          setCustomEndDate(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
                        }}
                        style={selectStyle}
                      >
                        <option value="">MM</option>
                        {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, '0')}</option>)}
                      </select>
                      <span style={{ color: customEndDate ? "#10B981" : "#9CA3AF" }}>-</span>
                      <select
                        value={endDay}
                        onChange={(e) => {
                          const d = Number(e.target.value);
                          const y = endYear || now.getFullYear();
                          const m = endMonth || 1;
                          setCustomEndDate(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
                        }}
                        style={selectStyle}
                      >
                        <option value="">DD</option>
                        {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, '0')}</option>)}
                      </select>
                    </div>
                  </div>
                  {viewMode === 'standard' && customStartDate && customEndDate && (
                    <div style={{
                      fontSize: "12px",
                      color: "#6B7280",
                      paddingBottom: "14px",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px"
                    }}>
                      <span style={{ color: "#9CA3AF" }}>vs</span>
                      <span style={{ fontWeight: "600" }}>Previous Year</span>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* Custom Comparison Configuration UI */}
        {viewMode === 'custom_compare' && (
          <div style={{
            marginTop: "24px",
            paddingTop: "24px",
            borderTop: "1px solid #E5E7EB",
            display: "grid",
            gap: "24px"
          }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
              {/* Target Group */}
              <div style={{ background: "#F9FAFB", padding: "20px", borderRadius: "16px", border: "1px solid #E5E7EB" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
                  <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: "#10B981" }}></div>
                  <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "700", color: "#1F2937" }}>Target Group (A)</h3>
                </div>

                {/* Date Selector (Target) */}
                <div style={{ marginBottom: "20px", paddingBottom: "20px", borderBottom: "1px dashed #E5E7EB" }}>
                  <label style={{ display: "block", fontSize: "12px", color: "#6B7280", fontWeight: "600", marginBottom: "8px", textTransform: "uppercase" }}>Date Range</label>
                  {dateMode === DATE_MODES.PERIOD && (
                    <select
                      value={targetConfig.period}
                      onChange={(e) => setTargetConfig({ ...targetConfig, period: Number(e.target.value) })}
                      style={{ width: "100%", padding: "10px", borderRadius: "10px", border: "1px solid #D1D5DB" }}
                    >
                      {FISCAL_PERIODS.map(p => <option key={p.period} value={p.period}>{p.label} ({p.startYear}.{p.startMonth}~{p.endYear}.{p.endMonth})</option>)}
                    </select>
                  )}
                  {dateMode === DATE_MODES.YEAR && (
                    <select
                      value={targetConfig.year}
                      onChange={(e) => setTargetConfig({ ...targetConfig, year: Number(e.target.value) })}
                      style={{ width: "100%", padding: "10px", borderRadius: "10px", border: "1px solid #D1D5DB" }}
                    >
                      {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                  )}
                  {dateMode === DATE_MODES.MONTH && (
                    <div style={{ display: "flex", gap: "10px" }}>
                      <select
                        value={targetConfig.year}
                        onChange={(e) => setTargetConfig({ ...targetConfig, year: Number(e.target.value) })}
                        style={{ flex: 1, padding: "10px", borderRadius: "10px", border: "1px solid #D1D5DB" }}
                      >
                        {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                      </select>
                      <select
                        value={targetConfig.month}
                        onChange={(e) => setTargetConfig({ ...targetConfig, month: Number(e.target.value) })}
                        style={{ flex: 1, padding: "10px", borderRadius: "10px", border: "1px solid #D1D5DB" }}
                      >
                        {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{MONTH_NAMES_SHORT[m - 1]}</option>)}
                      </select>
                    </div>
                  )}
                  {dateMode === DATE_MODES.WEEK && (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <button
                        onClick={() => {
                          const d = targetConfig.weekDate ? parseLocalDate(targetConfig.weekDate) : new Date();
                          d.setDate(d.getDate() - 7);
                          const fmt = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                          setTargetConfig({ ...targetConfig, weekDate: fmt, startDate: fmt });
                        }}
                        style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid #D1D5DB", background: "white", cursor: "pointer" }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
                      </button>
                      <div style={{
                        flex: 1,
                        padding: "10px 14px",
                        borderRadius: "12px",
                        border: "2px solid #10B981",
                        background: "#ECFDF5",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "4px"
                      }}>
                        <div style={{ fontSize: "14px", fontWeight: "700", color: "#065F46", marginBottom: "4px" }}>
                          {(() => {
                            const baseDate = targetConfig.weekDate ? parseLocalDate(targetConfig.weekDate) : new Date();
                            const range = getWeekRange(baseDate);
                            return `${range.startDate} ~ ${range.endDate}`;
                          })()}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                          {(() => {
                            const d = targetConfig.weekDate ? parseLocalDate(targetConfig.weekDate) : new Date();
                            const selectStyle = { border: "none", background: "transparent", fontSize: "12px", fontWeight: "600", color: "#065F46", cursor: "pointer", outline: "none" };
                            return (
                              <>
                                <select
                                  value={d.getFullYear()}
                                  onChange={(e) => {
                                    const newDate = new Date(d);
                                    newDate.setFullYear(Number(e.target.value));
                                    const fmt = `${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}-${String(newDate.getDate()).padStart(2, '0')}`;
                                    setTargetConfig({ ...targetConfig, weekDate: fmt, startDate: fmt });
                                  }}
                                  style={selectStyle}
                                >
                                  {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                                </select>
                                <span style={{ color: "#10B981", fontSize: "12px" }}>-</span>
                                <select
                                  value={d.getMonth() + 1}
                                  onChange={(e) => {
                                    const newDate = new Date(d);
                                    newDate.setMonth(Number(e.target.value) - 1);
                                    const fmt = `${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}-${String(newDate.getDate()).padStart(2, '0')}`;
                                    setTargetConfig({ ...targetConfig, weekDate: fmt, startDate: fmt });
                                  }}
                                  style={selectStyle}
                                >
                                  {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, '0')}</option>)}
                                </select>
                                <span style={{ color: "#10B981", fontSize: "12px" }}>-</span>
                                <select
                                  value={d.getDate()}
                                  onChange={(e) => {
                                    const newDate = new Date(d);
                                    newDate.setDate(Number(e.target.value));
                                    const fmt = `${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}-${String(newDate.getDate()).padStart(2, '0')}`;
                                    setTargetConfig({ ...targetConfig, weekDate: fmt, startDate: fmt });
                                  }}
                                  style={selectStyle}
                                >
                                  {Array.from({ length: new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() }, (_, i) => <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, '0')}</option>)}
                                </select>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          const d = targetConfig.weekDate ? parseLocalDate(targetConfig.weekDate) : new Date();
                          d.setDate(d.getDate() + 7);
                          const fmt = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                          setTargetConfig({ ...targetConfig, weekDate: fmt, startDate: fmt });
                        }}
                        style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid #D1D5DB", background: "white", cursor: "pointer" }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
                      </button>
                    </div>
                  )}
                  {dateMode === DATE_MODES.DAY && (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <button
                        onClick={() => {
                          const d = targetConfig.startDate ? parseLocalDate(targetConfig.startDate) : new Date();
                          d.setDate(d.getDate() - 1);
                          const fmt = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                          setTargetConfig({ ...targetConfig, startDate: fmt });
                        }}
                        style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid #D1D5DB", background: "white", cursor: "pointer" }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
                      </button>
                      <div style={{
                        flex: 1,
                        padding: "12px 14px",
                        borderRadius: "12px",
                        border: "2px solid #10B981",
                        background: "#ECFDF5",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px"
                      }}>
                        {(() => {
                          const d = targetConfig.startDate ? parseLocalDate(targetConfig.startDate) : new Date();
                          const selectStyle = { border: "none", background: "transparent", fontSize: "15px", fontWeight: "700", color: "#065F46", cursor: "pointer", outline: "none" };
                          return (
                            <>
                              <select
                                value={d.getFullYear()}
                                onChange={(e) => {
                                  const newDate = new Date(d);
                                  newDate.setFullYear(Number(e.target.value));
                                  const fmt = `${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}-${String(newDate.getDate()).padStart(2, '0')}`;
                                  setTargetConfig({ ...targetConfig, startDate: fmt });
                                }}
                                style={selectStyle}
                              >
                                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                              </select>
                              <span style={{ color: "#10B981", fontWeight: "500" }}>-</span>
                              <select
                                value={d.getMonth() + 1}
                                onChange={(e) => {
                                  const newDate = new Date(d);
                                  newDate.setMonth(Number(e.target.value) - 1);
                                  const fmt = `${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}-${String(newDate.getDate()).padStart(2, '0')}`;
                                  setTargetConfig({ ...targetConfig, startDate: fmt });
                                }}
                                style={selectStyle}
                              >
                                {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, '0')} {MONTH_NAMES_SHORT[i]}</option>)}
                              </select>
                              <span style={{ color: "#10B981", fontWeight: "500" }}>-</span>
                              <select
                                value={d.getDate()}
                                onChange={(e) => {
                                  const newDate = new Date(d);
                                  newDate.setDate(Number(e.target.value));
                                  const fmt = `${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}-${String(newDate.getDate()).padStart(2, '0')}`;
                                  setTargetConfig({ ...targetConfig, startDate: fmt });
                                }}
                                style={selectStyle}
                              >
                                {Array.from({ length: new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() }, (_, i) => <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, '0')}</option>)}
                              </select>
                            </>
                          );
                        })()}
                      </div>
                      <button
                        onClick={() => {
                          const d = targetConfig.startDate ? parseLocalDate(targetConfig.startDate) : new Date();
                          d.setDate(d.getDate() + 1);
                          const fmt = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                          setTargetConfig({ ...targetConfig, startDate: fmt });
                        }}
                        style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid #D1D5DB", background: "white", cursor: "pointer" }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
                      </button>
                    </div>
                  )}
                  {dateMode === DATE_MODES.CUSTOM && (() => {
                    const startYear = targetConfig.startDate ? Number(targetConfig.startDate.split('-')[0]) : "";
                    const startMonth = targetConfig.startDate ? Number(targetConfig.startDate.split('-')[1]) : "";
                    const startDay = targetConfig.startDate ? Number(targetConfig.startDate.split('-')[2]) : "";
                    const endYear = targetConfig.endDate ? Number(targetConfig.endDate.split('-')[0]) : "";
                    const endMonth = targetConfig.endDate ? Number(targetConfig.endDate.split('-')[1]) : "";
                    const endDay = targetConfig.endDate ? Number(targetConfig.endDate.split('-')[2]) : "";

                    const selectStyle = {
                      border: "none",
                      background: "transparent",
                      fontSize: "14px",
                      fontWeight: "700",
                      color: "#065F46",
                      cursor: "pointer",
                      outline: "none",
                      minWidth: "50px",
                      textAlign: "center"
                    };

                    return (
                      <div style={{ display: "flex", gap: "12px", alignItems: "flex-end", flexWrap: "wrap", marginBottom: "16px" }}>
                        <div>
                          <label style={{ fontSize: "12px", color: "#6B7280", display: "block", marginBottom: "8px", fontWeight: "600", textTransform: "uppercase" }}>Start Date</label>
                          <div style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "4px",
                            padding: "10px 14px",
                            borderRadius: "12px",
                            border: targetConfig.startDate ? "2px solid #10B981" : "2px solid #D1D5DB",
                            background: targetConfig.startDate ? "linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)" : "#F9FAFB"
                          }}>
                            <select
                              value={startYear}
                              onChange={(e) => {
                                const y = Number(e.target.value);
                                const m = startMonth || 1;
                                const d = startDay || 1;
                                setTargetConfig({ ...targetConfig, startDate: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
                              }}
                              style={selectStyle}
                            >
                              <option value="">YYYY</option>
                              {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                            </select>
                            <span style={{ color: targetConfig.startDate ? "#10B981" : "#9CA3AF" }}>-</span>
                            <select
                              value={startMonth}
                              onChange={(e) => {
                                const m = Number(e.target.value);
                                const y = startYear || now.getFullYear();
                                const d = startDay || 1;
                                setTargetConfig({ ...targetConfig, startDate: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
                              }}
                              style={selectStyle}
                            >
                              <option value="">MM</option>
                              {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, '0')}</option>)}
                            </select>
                            <span style={{ color: targetConfig.startDate ? "#10B981" : "#9CA3AF" }}>-</span>
                            <select
                              value={startDay}
                              onChange={(e) => {
                                const d = Number(e.target.value);
                                const y = startYear || now.getFullYear();
                                const m = startMonth || 1;
                                setTargetConfig({ ...targetConfig, startDate: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
                              }}
                              style={selectStyle}
                            >
                              <option value="">DD</option>
                              {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, '0')}</option>)}
                            </select>
                          </div>
                        </div>
                        <span style={{ paddingBottom: "14px", color: "#9CA3AF", fontSize: "16px", fontWeight: "500" }}>→</span>
                        <div>
                          <label style={{ fontSize: "12px", color: "#6B7280", display: "block", marginBottom: "8px", fontWeight: "600", textTransform: "uppercase" }}>End Date</label>
                          <div style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "4px",
                            padding: "10px 14px",
                            borderRadius: "12px",
                            border: targetConfig.endDate ? "2px solid #10B981" : "2px solid #D1D5DB",
                            background: targetConfig.endDate ? "linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)" : "#F9FAFB"
                          }}>
                            <select
                              value={endYear}
                              onChange={(e) => {
                                const y = Number(e.target.value);
                                const m = endMonth || 1;
                                const d = endDay || 1;
                                setTargetConfig({ ...targetConfig, endDate: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
                              }}
                              style={selectStyle}
                            >
                              <option value="">YYYY</option>
                              {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                            </select>
                            <span style={{ color: targetConfig.endDate ? "#10B981" : "#9CA3AF" }}>-</span>
                            <select
                              value={endMonth}
                              onChange={(e) => {
                                const m = Number(e.target.value);
                                const y = endYear || now.getFullYear();
                                const d = endDay || 1;
                                setTargetConfig({ ...targetConfig, endDate: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
                              }}
                              style={selectStyle}
                            >
                              <option value="">MM</option>
                              {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, '0')}</option>)}
                            </select>
                            <span style={{ color: targetConfig.endDate ? "#10B981" : "#9CA3AF" }}>-</span>
                            <select
                              value={endDay}
                              onChange={(e) => {
                                const d = Number(e.target.value);
                                const y = endYear || now.getFullYear();
                                const m = endMonth || 1;
                                setTargetConfig({ ...targetConfig, endDate: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
                              }}
                              style={selectStyle}
                            >
                              <option value="">DD</option>
                              {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, '0')}</option>)}
                            </select>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Building Select */}
                <div style={{ marginBottom: "16px" }}>
                  <label style={{ display: "block", fontSize: "12px", color: "#6B7280", fontWeight: "600", marginBottom: "6px", textTransform: "uppercase" }}>Building</label>
                  <select
                    value={targetConfig.building}
                    onChange={(e) => handleBuildingChange(true, e.target.value)}
                    style={{ width: "100%", padding: "12px", borderRadius: "10px", border: "1px solid #D1D5DB", fontSize: "14px", fontWeight: "600", color: "#374151" }}
                  >
                    {Object.keys(BUILDING_DATA).map(b => (
                      <option key={b} value={b}>{getBuildingEN(b)}</option>
                    ))}
                    <option value={ALL_BUILDINGS}>All Buildings</option>
                  </select>
                </div>

                {/* Rooms Select */}
                {targetConfig.building !== ALL_BUILDINGS && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <label style={{ fontSize: "12px", color: "#6B7280", fontWeight: "600", textTransform: "uppercase" }}>Rooms</label>
                    <button onClick={() => selectAllRooms(true)} style={{ border: "none", background: "transparent", color: "#10B981", fontSize: "12px", fontWeight: "600", cursor: "pointer" }}>
                      {targetConfig.rooms.length === 0 ? "Reset" : "Select All"}
                    </button>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {(BUILDING_DATA[targetConfig.building] || []).map(room => {
                      const isSelected = isRoomSelected(true, room);
                      return (
                        <button key={room} onClick={() => toggleRoom(true, room)} style={{ padding: "6px 12px", borderRadius: "20px", border: isSelected ? "1px solid #10B981" : "1px solid #E5E7EB", background: isSelected ? "#ECFDF5" : "white", color: isSelected ? "#065F46" : "#4B5563", fontSize: "13px", fontWeight: "500", cursor: "pointer", transition: "all 0.1s" }}>
                          {getRoomEN(room)}
                        </button>
                      );
                    })}
                  </div>
                </div>
                )}
              </div>

              {/* Compare Group */}
              <div style={{ background: "#F9FAFB", padding: "20px", borderRadius: "16px", border: "1px solid #E5E7EB" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
                  <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: "#9CA3AF" }}></div>
                  <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "700", color: "#1F2937" }}>Comparison Group (B)</h3>
                </div>

                {/* Date Selector (Compare) */}
                <div style={{ marginBottom: "20px", paddingBottom: "20px", borderBottom: "1px dashed #E5E7EB" }}>
                  <label style={{ display: "block", fontSize: "12px", color: "#6B7280", fontWeight: "600", marginBottom: "8px", textTransform: "uppercase" }}>Date Range</label>
                  {dateMode === DATE_MODES.PERIOD && (
                    <select
                      value={compareConfig.period}
                      onChange={(e) => setCompareConfig({ ...compareConfig, period: Number(e.target.value) })}
                      style={{ width: "100%", padding: "10px", borderRadius: "10px", border: "1px solid #D1D5DB" }}
                    >
                      {FISCAL_PERIODS.map(p => <option key={p.period} value={p.period}>{p.label} ({p.startYear}.{p.startMonth}~{p.endYear}.{p.endMonth})</option>)}
                    </select>
                  )}
                  {dateMode === DATE_MODES.YEAR && (
                    <select
                      value={compareConfig.year}
                      onChange={(e) => setCompareConfig({ ...compareConfig, year: Number(e.target.value) })}
                      style={{ width: "100%", padding: "10px", borderRadius: "10px", border: "1px solid #D1D5DB" }}
                    >
                      {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                  )}
                  {dateMode === DATE_MODES.MONTH && (
                    <div style={{ display: "flex", gap: "10px" }}>
                      <select
                        value={compareConfig.year}
                        onChange={(e) => setCompareConfig({ ...compareConfig, year: Number(e.target.value) })}
                        style={{ flex: 1, padding: "10px", borderRadius: "10px", border: "1px solid #D1D5DB" }}
                      >
                        {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                      </select>
                      <select
                        value={compareConfig.month}
                        onChange={(e) => setCompareConfig({ ...compareConfig, month: Number(e.target.value) })}
                        style={{ flex: 1, padding: "10px", borderRadius: "10px", border: "1px solid #D1D5DB" }}
                      >
                        {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{MONTH_NAMES_SHORT[m - 1]}</option>)}
                      </select>
                    </div>
                  )}
                  {dateMode === DATE_MODES.WEEK && (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <button
                        onClick={() => {
                          const d = compareConfig.weekDate ? parseLocalDate(compareConfig.weekDate) : new Date();
                          d.setDate(d.getDate() - 7);
                          const fmt = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                          setCompareConfig({ ...compareConfig, weekDate: fmt, startDate: fmt });
                        }}
                        style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid #D1D5DB", background: "white", cursor: "pointer" }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
                      </button>
                      <div style={{
                        flex: 1,
                        padding: "10px 14px",
                        borderRadius: "12px",
                        border: "2px solid #9CA3AF",
                        background: "#F3F4F6",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "4px"
                      }}>
                        <div style={{ fontSize: "14px", fontWeight: "700", color: "#374151", marginBottom: "4px" }}>
                          {(() => {
                            const baseDate = compareConfig.weekDate ? parseLocalDate(compareConfig.weekDate) : new Date();
                            const range = getWeekRange(baseDate);
                            return `${range.startDate} ~ ${range.endDate}`;
                          })()}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                          {(() => {
                            const d = compareConfig.weekDate ? parseLocalDate(compareConfig.weekDate) : new Date();
                            const selectStyle = { border: "none", background: "transparent", fontSize: "12px", fontWeight: "600", color: "#374151", cursor: "pointer", outline: "none" };
                            return (
                              <>
                                <select
                                  value={d.getFullYear()}
                                  onChange={(e) => {
                                    const newDate = new Date(d);
                                    newDate.setFullYear(Number(e.target.value));
                                    const fmt = `${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}-${String(newDate.getDate()).padStart(2, '0')}`;
                                    setCompareConfig({ ...compareConfig, weekDate: fmt, startDate: fmt });
                                  }}
                                  style={selectStyle}
                                >
                                  {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                                </select>
                                <span style={{ color: "#9CA3AF", fontSize: "12px" }}>-</span>
                                <select
                                  value={d.getMonth() + 1}
                                  onChange={(e) => {
                                    const newDate = new Date(d);
                                    newDate.setMonth(Number(e.target.value) - 1);
                                    const fmt = `${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}-${String(newDate.getDate()).padStart(2, '0')}`;
                                    setCompareConfig({ ...compareConfig, weekDate: fmt, startDate: fmt });
                                  }}
                                  style={selectStyle}
                                >
                                  {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, '0')}</option>)}
                                </select>
                                <span style={{ color: "#9CA3AF", fontSize: "12px" }}>-</span>
                                <select
                                  value={d.getDate()}
                                  onChange={(e) => {
                                    const newDate = new Date(d);
                                    newDate.setDate(Number(e.target.value));
                                    const fmt = `${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}-${String(newDate.getDate()).padStart(2, '0')}`;
                                    setCompareConfig({ ...compareConfig, weekDate: fmt, startDate: fmt });
                                  }}
                                  style={selectStyle}
                                >
                                  {Array.from({ length: new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() }, (_, i) => <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, '0')}</option>)}
                                </select>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          const d = compareConfig.weekDate ? parseLocalDate(compareConfig.weekDate) : new Date();
                          d.setDate(d.getDate() + 7);
                          const fmt = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                          setCompareConfig({ ...compareConfig, weekDate: fmt, startDate: fmt });
                        }}
                        style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid #D1D5DB", background: "white", cursor: "pointer" }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
                      </button>
                    </div>
                  )}
                  {dateMode === DATE_MODES.DAY && (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <button
                        onClick={() => {
                          const d = compareConfig.startDate ? parseLocalDate(compareConfig.startDate) : new Date();
                          d.setDate(d.getDate() - 1);
                          const fmt = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                          setCompareConfig({ ...compareConfig, startDate: fmt });
                        }}
                        style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid #D1D5DB", background: "white", cursor: "pointer" }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
                      </button>
                      <div style={{
                        flex: 1,
                        padding: "12px 14px",
                        borderRadius: "12px",
                        border: "2px solid #9CA3AF",
                        background: "#F3F4F6",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "6px"
                      }}>
                        {(() => {
                          const d = compareConfig.startDate ? parseLocalDate(compareConfig.startDate) : new Date();
                          const selectStyle = { border: "none", background: "transparent", fontSize: "15px", fontWeight: "700", color: "#374151", cursor: "pointer", outline: "none" };
                          return (
                            <>
                              <select
                                value={d.getFullYear()}
                                onChange={(e) => {
                                  const newDate = new Date(d);
                                  newDate.setFullYear(Number(e.target.value));
                                  const fmt = `${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}-${String(newDate.getDate()).padStart(2, '0')}`;
                                  setCompareConfig({ ...compareConfig, startDate: fmt });
                                }}
                                style={selectStyle}
                              >
                                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                              </select>
                              <span style={{ color: "#9CA3AF", fontWeight: "500" }}>-</span>
                              <select
                                value={d.getMonth() + 1}
                                onChange={(e) => {
                                  const newDate = new Date(d);
                                  newDate.setMonth(Number(e.target.value) - 1);
                                  const fmt = `${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}-${String(newDate.getDate()).padStart(2, '0')}`;
                                  setCompareConfig({ ...compareConfig, startDate: fmt });
                                }}
                                style={selectStyle}
                              >
                                {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, '0')} {MONTH_NAMES_SHORT[i]}</option>)}
                              </select>
                              <span style={{ color: "#9CA3AF", fontWeight: "500" }}>-</span>
                              <select
                                value={d.getDate()}
                                onChange={(e) => {
                                  const newDate = new Date(d);
                                  newDate.setDate(Number(e.target.value));
                                  const fmt = `${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}-${String(newDate.getDate()).padStart(2, '0')}`;
                                  setCompareConfig({ ...compareConfig, startDate: fmt });
                                }}
                                style={selectStyle}
                              >
                                {Array.from({ length: new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() }, (_, i) => <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, '0')}</option>)}
                              </select>
                            </>
                          );
                        })()}
                      </div>
                      <button
                        onClick={() => {
                          const d = compareConfig.startDate ? parseLocalDate(compareConfig.startDate) : new Date();
                          d.setDate(d.getDate() + 1);
                          const fmt = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                          setCompareConfig({ ...compareConfig, startDate: fmt });
                        }}
                        style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid #D1D5DB", background: "white", cursor: "pointer" }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
                      </button>
                    </div>
                  )}
                  {dateMode === DATE_MODES.CUSTOM && (() => {
                    const startYear = compareConfig.startDate ? Number(compareConfig.startDate.split('-')[0]) : "";
                    const startMonth = compareConfig.startDate ? Number(compareConfig.startDate.split('-')[1]) : "";
                    const startDay = compareConfig.startDate ? Number(compareConfig.startDate.split('-')[2]) : "";
                    const endYear = compareConfig.endDate ? Number(compareConfig.endDate.split('-')[0]) : "";
                    const endMonth = compareConfig.endDate ? Number(compareConfig.endDate.split('-')[1]) : "";
                    const endDay = compareConfig.endDate ? Number(compareConfig.endDate.split('-')[2]) : "";

                    const selectStyle = {
                      border: "none",
                      background: "transparent",
                      fontSize: "14px",
                      fontWeight: "700",
                      color: "#065F46", // 기존 Comparison 그룹 색상 유지 (회색 계열이 아니라면 target과 동일하게 065F46)
                      cursor: "pointer",
                      outline: "none",
                      minWidth: "50px",
                      textAlign: "center"
                    };

                    return (
                      <div style={{ display: "flex", gap: "12px", alignItems: "flex-end", flexWrap: "wrap", marginBottom: "16px" }}>
                        <div>
                          <label style={{ fontSize: "12px", color: "#6B7280", display: "block", marginBottom: "8px", fontWeight: "600", textTransform: "uppercase" }}>Start Date</label>
                          <div style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "4px",
                            padding: "10px 14px",
                            borderRadius: "12px",
                            border: compareConfig.startDate ? "2px solid #9CA3AF" : "2px solid #D1D5DB",
                            background: compareConfig.startDate ? "#F3F4F6" : "#F9FAFB"
                          }}>
                            <select
                              value={startYear}
                              onChange={(e) => {
                                const y = Number(e.target.value);
                                const m = startMonth || 1;
                                const d = startDay || 1;
                                setCompareConfig({ ...compareConfig, startDate: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
                              }}
                              style={selectStyle}
                            >
                              <option value="">YYYY</option>
                              {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                            </select>
                            <span style={{ color: compareConfig.startDate ? "#9CA3AF" : "#9CA3AF" }}>-</span>
                            <select
                              value={startMonth}
                              onChange={(e) => {
                                const m = Number(e.target.value);
                                const y = startYear || now.getFullYear();
                                const d = startDay || 1;
                                setCompareConfig({ ...compareConfig, startDate: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
                              }}
                              style={selectStyle}
                            >
                              <option value="">MM</option>
                              {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, '0')}</option>)}
                            </select>
                            <span style={{ color: compareConfig.startDate ? "#9CA3AF" : "#9CA3AF" }}>-</span>
                            <select
                              value={startDay}
                              onChange={(e) => {
                                const d = Number(e.target.value);
                                const y = startYear || now.getFullYear();
                                const m = startMonth || 1;
                                setCompareConfig({ ...compareConfig, startDate: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
                              }}
                              style={selectStyle}
                            >
                              <option value="">DD</option>
                              {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, '0')}</option>)}
                            </select>
                          </div>
                        </div>
                        <span style={{ paddingBottom: "14px", color: "#9CA3AF", fontSize: "16px", fontWeight: "500" }}>→</span>
                        <div>
                          <label style={{ fontSize: "12px", color: "#6B7280", display: "block", marginBottom: "8px", fontWeight: "600", textTransform: "uppercase" }}>End Date</label>
                          <div style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "4px",
                            padding: "10px 14px",
                            borderRadius: "12px",
                            border: compareConfig.endDate ? "2px solid #9CA3AF" : "2px solid #D1D5DB",
                            background: compareConfig.endDate ? "#F3F4F6" : "#F9FAFB"
                          }}>
                            <select
                              value={endYear}
                              onChange={(e) => {
                                const y = Number(e.target.value);
                                const m = endMonth || 1;
                                const d = endDay || 1;
                                setCompareConfig({ ...compareConfig, endDate: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
                              }}
                              style={selectStyle}
                            >
                              <option value="">YYYY</option>
                              {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                            </select>
                            <span style={{ color: compareConfig.endDate ? "#9CA3AF" : "#9CA3AF" }}>-</span>
                            <select
                              value={endMonth}
                              onChange={(e) => {
                                const m = Number(e.target.value);
                                const y = endYear || now.getFullYear();
                                const d = endDay || 1;
                                setCompareConfig({ ...compareConfig, endDate: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
                              }}
                              style={selectStyle}
                            >
                              <option value="">MM</option>
                              {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, '0')}</option>)}
                            </select>
                            <span style={{ color: compareConfig.endDate ? "#9CA3AF" : "#9CA3AF" }}>-</span>
                            <select
                              value={endDay}
                              onChange={(e) => {
                                const d = Number(e.target.value);
                                const y = endYear || now.getFullYear();
                                const m = endMonth || 1;
                                setCompareConfig({ ...compareConfig, endDate: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
                              }}
                              style={selectStyle}
                            >
                              <option value="">DD</option>
                              {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, '0')}</option>)}
                            </select>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Building Select */}
                <div style={{ marginBottom: "16px" }}>
                  <label style={{ display: "block", fontSize: "12px", color: "#6B7280", fontWeight: "600", marginBottom: "6px", textTransform: "uppercase" }}>Building</label>
                  <select
                    value={compareConfig.building}
                    onChange={(e) => handleBuildingChange(false, e.target.value)}
                    style={{ width: "100%", padding: "12px", borderRadius: "10px", border: "1px solid #D1D5DB", fontSize: "14px", fontWeight: "600", color: "#374151" }}
                  >
                    {Object.keys(BUILDING_DATA).map(b => (
                      <option key={b} value={b}>{getBuildingEN(b)}</option>
                    ))}
                    <option value={ALL_BUILDINGS}>All Buildings</option>
                  </select>
                </div>

                {/* Rooms Select */}
                {compareConfig.building !== ALL_BUILDINGS && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <label style={{ fontSize: "12px", color: "#6B7280", fontWeight: "600", textTransform: "uppercase" }}>Rooms</label>
                    <button onClick={() => selectAllRooms(false)} style={{ border: "none", background: "transparent", color: "#10B981", fontSize: "12px", fontWeight: "600", cursor: "pointer" }}>
                      {compareConfig.rooms.length === 0 ? "Reset" : "Select All"}
                    </button>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {(BUILDING_DATA[compareConfig.building] || []).map(room => {
                      const isSelected = isRoomSelected(false, room);
                      return (
                        <button key={room} onClick={() => toggleRoom(false, room)} style={{ padding: "6px 12px", borderRadius: "20px", border: isSelected ? "1px solid #10B981" : "1px solid #E5E7EB", background: isSelected ? "#F3F4F6" : "white", color: isSelected ? "#1F2937" : "#4B5563", borderColor: isSelected ? "#9CA3AF" : "#E5E7EB", fontSize: "13px", fontWeight: "500", cursor: "pointer", transition: "all 0.1s" }}>
                          {getRoomEN(room)}
                        </button>
                      );
                    })}
                  </div>
                </div>
                )}
              </div>
            </div>

            {/* Search Button */}
            <button
              onClick={handleSearch}
              style={{
                width: "100%",
                padding: "16px",
                background: "linear-gradient(135deg, #10B981 0%, #059669 100%)",
                color: "white",
                fontSize: "18px",
                fontWeight: "700",
                borderRadius: "16px",
                border: "none",
                boxShadow: "0 4px 6px -1px rgba(16, 185, 129, 0.4), 0 2px 4px -1px rgba(16, 185, 129, 0.2)",
                cursor: "pointer",
                transition: "all 0.2s"
              }}
              onMouseOver={(e) => e.target.style.transform = "translateY(-1px)"}
              onMouseOut={(e) => e.target.style.transform = "translateY(0)"}
            >
              Analyze & Compare
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div style={{
          textAlign: "center",
          padding: "80px 20px",
          background: "white",
          borderRadius: "20px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.06)"
        }}>
          <div style={{
            width: "60px",
            height: "60px",
            margin: "0 auto 20px",
            border: "4px solid #E5E7EB",
            borderTopColor: "#10B981",
            borderRadius: "50%",
            animation: "spin 1s linear infinite"
          }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <p style={{ color: "#374151", fontSize: "16px", fontWeight: "600", margin: "0 0 8px 0" }}>
            Analyzing Revenue Data...
          </p>
          <p style={{ color: "#9CA3AF", fontSize: "13px", margin: 0 }}>
            Calculating daily revenue distribution
          </p>
        </div>
      ) : (
        <>
          {/* Premium KPI Cards */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "20px",
            marginBottom: "28px"
          }}>
            {/* Current Revenue Card */}
            <div style={{
              background: "white",
              borderRadius: "20px",
              padding: "24px",
              boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
              border: "1px solid #E5E7EB",
              position: "relative",
              overflow: "hidden"
            }}>
              <div style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: "4px",
                background: "linear-gradient(135deg, #10B981 0%, #059669 100%)"
              }} />
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                <div>
                  <p style={{ fontSize: "13px", color: "#6B7280", margin: "0 0 8px 0", fontWeight: "500" }}>
                    {currentLabel}
                  </p>
                  <h2 style={{
                    fontSize: "36px",
                    fontWeight: "800",
                    color: "#065F46",
                    margin: "0 0 8px 0",
                    letterSpacing: "-1px"
                  }}>
                    {formatCurrency(totalRevenue)}
                  </h2>
                  <span style={{
                    fontSize: "12px",
                    color: "#059669",
                    background: "#ECFDF5",
                    padding: "4px 10px",
                    borderRadius: "6px",
                    fontWeight: "600"
                  }}>
                    Total Revenue
                  </span>
                </div>
                <div style={{
                  width: "56px",
                  height: "56px",
                  background: "linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)",
                  borderRadius: "16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center"
                }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2">
                    <line x1="12" y1="1" x2="12" y2="23" />
                    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Compare Revenue Card */}
            <div style={{
              background: "white",
              borderRadius: "20px",
              padding: "24px",
              boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
              border: "1px solid #E5E7EB",
              position: "relative",
              overflow: "hidden"
            }}>
              <div style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: "4px",
                background: "linear-gradient(135deg, #9CA3AF 0%, #6B7280 100%)"
              }} />
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                <div>
                  <p style={{ fontSize: "13px", color: "#6B7280", margin: "0 0 8px 0", fontWeight: "500" }}>
                    {compareLabel}
                  </p>
                  <h2 style={{
                    fontSize: "36px",
                    fontWeight: "800",
                    color: "#374151",
                    margin: "0 0 8px 0",
                    letterSpacing: "-1px"
                  }}>
                    {formatCurrency(compareRevenue)}
                  </h2>
                  <span style={{
                    fontSize: "12px",
                    color: "#6B7280",
                    background: "#F3F4F6",
                    padding: "4px 10px",
                    borderRadius: "6px",
                    fontWeight: "600"
                  }}>
                    Comparison
                  </span>
                </div>
                <div style={{
                  width: "56px",
                  height: "56px",
                  background: "#F3F4F6",
                  borderRadius: "16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center"
                }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Growth Rate Card */}
            <div style={{
              background: getGrowthRate(totalRevenue, compareRevenue) >= 0
                ? "linear-gradient(135deg, #FEF2F2 0%, #FECACA 100%)"
                : "linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)",
              borderRadius: "20px",
              padding: "24px",
              boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
              border: `1px solid ${getGrowthRate(totalRevenue, compareRevenue) >= 0 ? "#FECACA" : "#BFDBFE"}`,
              position: "relative",
              overflow: "hidden"
            }}>
              <div style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: "4px",
                background: getGrowthRate(totalRevenue, compareRevenue) >= 0
                  ? "linear-gradient(135deg, #EF4444 0%, #DC2626 100%)"
                  : "linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)"
              }} />
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                <div>
                  <p style={{ fontSize: "13px", color: "#6B7280", margin: "0 0 8px 0", fontWeight: "500" }}>
                    YoY Growth Rate
                  </p>
                  <h2 style={{
                    fontSize: "36px",
                    fontWeight: "800",
                    color: getGrowthRate(totalRevenue, compareRevenue) >= 0 ? "#DC2626" : "#2563EB",
                    margin: "0 0 8px 0",
                    letterSpacing: "-1px"
                  }}>
                    {getGrowthRate(totalRevenue, compareRevenue) !== null
                      ? `${getGrowthRate(totalRevenue, compareRevenue) >= 0 ? '+' : ''}${getGrowthRate(totalRevenue, compareRevenue)}%`
                      : '-'
                    }
                  </h2>
                  <span style={{
                    fontSize: "12px",
                    color: getGrowthRate(totalRevenue, compareRevenue) >= 0 ? "#DC2626" : "#2563EB",
                    background: getGrowthRate(totalRevenue, compareRevenue) >= 0 ? "#FEE2E2" : "#DBEAFE",
                    padding: "4px 10px",
                    borderRadius: "6px",
                    fontWeight: "600",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px"
                  }}>
                    {getGrowthRate(totalRevenue, compareRevenue) >= 0
                      ? <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="18 15 12 9 6 15" /></svg> Increase</>
                      : <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="6 9 12 15 18 9" /></svg> Decrease</>
                    }
                  </span>
                </div>
                <div style={{
                  width: "56px",
                  height: "56px",
                  background: getGrowthRate(totalRevenue, compareRevenue) >= 0
                    ? "linear-gradient(135deg, #EF4444 0%, #DC2626 100%)"
                    : "linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)",
                  borderRadius: "16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: getGrowthRate(totalRevenue, compareRevenue) >= 0
                    ? "0 4px 12px rgba(239, 68, 68, 0.3)"
                    : "0 4px 12px rgba(59, 130, 246, 0.3)"
                }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                    {getGrowthRate(totalRevenue, compareRevenue) >= 0
                      ? <><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></>
                      : <><polyline points="23 18 13.5 8.5 8.5 13.5 1 6" /><polyline points="17 18 23 18 23 12" /></>
                    }
                  </svg>
                </div>
              </div>
            </div>
          </div>

          {/* Monthly Revenue Chart */}
          <div style={{
            background: "white",
            borderRadius: "20px",
            padding: "24px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
            border: "1px solid #E5E7EB",
            marginBottom: "24px"
          }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              marginBottom: "24px"
            }}>
              <div style={{
                width: "44px",
                height: "44px",
                background: "linear-gradient(135deg, #10B981 0%, #059669 100%)",
                borderRadius: "12px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 4px 12px rgba(16, 185, 129, 0.3)"
              }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <div>
                <h3 style={{ fontSize: "18px", fontWeight: "700", color: "#111827", margin: 0 }}>
                  {dateMode === DATE_MODES.WEEK ? "Daily Revenue (by Day)" :
                    dateMode === DATE_MODES.DAY ? "Daily Revenue Comparison" :
                      dateMode === DATE_MODES.MONTH ? "Monthly Revenue" :
                        "Monthly Revenue Trend"}
                </h3>
                <p style={{ fontSize: "13px", color: "#6B7280", margin: "4px 0 0 0" }}>
                  Period comparison analysis
                </p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={380}>
              {(dateMode === DATE_MODES.WEEK || dateMode === DATE_MODES.DAY || dateMode === DATE_MODES.MONTH) ? (
                <BarChart data={monthlyData} margin={{ top: 10, right: 30, left: 20, bottom: 10 }} barSize={30}>
                  <defs>
                    <linearGradient id="currentGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10B981" />
                      <stop offset="100%" stopColor="#059669" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(val) => `¥${(val / 10000).toFixed(0)}M`} tick={{ fontSize: 12, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    formatter={(value) => formatCurrency(value)}
                    contentStyle={{
                      background: "white",
                      border: "none",
                      borderRadius: "12px",
                      boxShadow: "0 10px 40px rgba(0,0,0,0.15)",
                      padding: "12px 16px"
                    }}
                  />
                  <Legend />
                  <Bar dataKey="current" name={currentLabel} fill="url(#currentGradient)" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="compare" name={compareLabel} fill="#D1D5DB" radius={[8, 8, 0, 0]} />
                </BarChart>
              ) : (
                <LineChart data={monthlyData} margin={{ top: 10, right: 30, left: 20, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(val) => `¥${(val / 10000).toFixed(0)}M`} tick={{ fontSize: 12, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    formatter={(value) => formatCurrency(value)}
                    contentStyle={{
                      background: "white",
                      border: "none",
                      borderRadius: "12px",
                      boxShadow: "0 10px 40px rgba(0,0,0,0.15)",
                      padding: "12px 16px"
                    }}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="current"
                    name={isNonPeriodMode ? currentLabel : `Period ${currentPeriodInfo.period}`}
                    stroke="#10B981"
                    strokeWidth={3}
                    dot={{ fill: "#10B981", strokeWidth: 2, r: 4 }}
                    activeDot={{ r: 8, fill: "#10B981" }}
                  />
                  <Line
                    type="monotone"
                    dataKey="compare"
                    name={isNonPeriodMode ? compareLabel : `Period ${comparePeriodInfo.period}`}
                    stroke="#9CA3AF"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={{ fill: "#9CA3AF", strokeWidth: 2, r: 3 }}
                  />
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>

          {/* Building Revenue Chart */}
          <div style={{
            background: "white",
            borderRadius: "20px",
            padding: "24px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
            border: "1px solid #E5E7EB",
            marginBottom: "24px"
          }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "24px"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{
                  width: "44px",
                  height: "44px",
                  background: "linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)",
                  borderRadius: "12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  boxShadow: "0 4px 12px rgba(139, 92, 246, 0.3)"
                }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                    <polyline points="9 22 9 12 15 12 15 22" />
                  </svg>
                </div>
                <div>
                  <h3 style={{ fontSize: "18px", fontWeight: "700", color: "#111827", margin: 0 }}>
                    Revenue by Property
                  </h3>
                  <p style={{ fontSize: "13px", color: "#6B7280", margin: "4px 0 0 0" }}>
                    {isNonPeriodMode ? `${currentLabel} vs ${compareLabel}` : `Period ${currentPeriodInfo.period} vs Period ${comparePeriodInfo.period}`}
                  </p>
                </div>
              </div>
              <div style={{
                background: "#F3F4F6",
                padding: "8px 14px",
                borderRadius: "10px",
                fontSize: "13px",
                fontWeight: "600",
                color: "#374151"
              }}>
                {buildingCompareData.length} Properties
              </div>
            </div>
            <ResponsiveContainer width="100%" height={420}>
              <BarChart data={buildingCompareData.map(b => ({ ...b, nameEN: getBuildingEN(b.name) }))} margin={{ top: 20, right: 30, left: 20, bottom: 80 }} barSize={30}>
                <defs>
                  <linearGradient id="buildingCurrentGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10B981" />
                    <stop offset="100%" stopColor="#059669" />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                <XAxis
                  dataKey="nameEN"
                  tick={{ fontSize: 12, fill: "#374151", fontWeight: 500 }}
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                  angle={-35}
                  textAnchor="end"
                  height={80}
                />
                <YAxis tickFormatter={(val) => `¥${(val / 10000).toFixed(0)}M`} tick={{ fontSize: 12, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(value) => formatCurrency(value)}
                  contentStyle={{
                    background: "white",
                    border: "none",
                    borderRadius: "12px",
                    boxShadow: "0 10px 40px rgba(0,0,0,0.15)",
                    padding: "12px 16px"
                  }}
                />
                <Legend />
                <Bar
                  dataKey="current"
                  name={isNonPeriodMode ? currentLabel : `Period ${currentPeriodInfo.period}`}
                  fill="url(#buildingCurrentGradient)"
                  radius={[8, 8, 0, 0]}
                />
                <Bar
                  dataKey="compare"
                  name={isNonPeriodMode ? compareLabel : `Period ${comparePeriodInfo.period}`}
                  fill="#D1D5DB"
                  radius={[8, 8, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Room-level Revenue Breakdown */}
          {getActiveBuildingOrder().filter(bName => roomData[bName] || roomCompareData[bName]).map(bName => {
            const currentTotal = buildingCompareData.find(b => b.name === bName)?.current || 0;
            const compareTotal = buildingCompareData.find(b => b.name === bName)?.compare || 0;
            const growthRate = getGrowthRate(currentTotal, compareTotal);

            // 객실 목록 (현재 + 비교 기수 합친 유니크 목록)
            const allRooms = [...new Set([
              ...Object.keys(roomData[bName] || {}),
              ...Object.keys(roomCompareData[bName] || {})
            ])].sort();

            if (allRooms.length === 0) return null;

            return (
              <div key={bName} style={{
                background: "white",
                borderRadius: "20px",
                padding: "24px",
                boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
                border: "1px solid #E5E7EB",
                marginBottom: "24px"
              }}>
                {/* Building Header */}
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "20px",
                  paddingBottom: "16px",
                  borderBottom: "1px solid #F3F4F6"
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <div style={{
                      width: "44px",
                      height: "44px",
                      background: "linear-gradient(135deg, #10B981 0%, #059669 100%)",
                      borderRadius: "12px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: "0 4px 12px rgba(16, 185, 129, 0.3)"
                    }}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                        <polyline points="9 22 9 12 15 12 15 22" />
                      </svg>
                    </div>
                    <div>
                      <h3 style={{ fontSize: "18px", fontWeight: "700", color: "#111827", margin: 0 }}>
                        {getBuildingEN(bName)}
                      </h3>
                      <p style={{ fontSize: "13px", color: "#6B7280", margin: "2px 0 0 0" }}>
                        {allRooms.length} rooms
                      </p>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: "20px", fontWeight: "700", color: "#065F46" }}>
                      {formatCurrency(currentTotal)}
                    </div>
                    {growthRate !== null && (
                      <span style={{
                        fontSize: "13px",
                        fontWeight: "600",
                        color: growthRate >= 0 ? "#DC2626" : "#2563EB",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px"
                      }}>
                        {growthRate >= 0 ? "↑" : "↓"} {growthRate >= 0 ? '+' : ''}{growthRate}%
                      </span>
                    )}
                  </div>
                </div>

                {/* Table */}
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
                    <thead>
                      <tr style={{ background: "#F9FAFB" }}>
                        <th style={{ padding: "14px 16px", textAlign: "left", fontWeight: "600", color: "#374151", borderRadius: "8px 0 0 8px" }}>Room</th>
                        <th style={{ padding: "14px 16px", textAlign: "right", fontWeight: "600", color: "#10B981" }}>{isNonPeriodMode ? "Current" : `Period ${currentPeriodInfo.period}`}</th>
                        <th style={{ padding: "14px 16px", textAlign: "right", fontWeight: "600", color: "#6B7280" }}>{isNonPeriodMode ? "Previous" : `Period ${comparePeriodInfo.period}`}</th>
                        <th style={{ padding: "14px 16px", textAlign: "right", fontWeight: "600", color: "#374151" }}>Diff</th>
                        <th style={{ padding: "14px 16px", textAlign: "right", fontWeight: "600", color: "#374151", borderRadius: "0 8px 8px 0" }}>Growth</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allRooms.map((rName, idx) => {
                        const currentVal = roomData[bName]?.[rName] || 0;
                        const compareVal = roomCompareData[bName]?.[rName] || 0;
                        const diff = currentVal - compareVal;
                        const roomGrowth = getGrowthRate(currentVal, compareVal);

                        return (
                          <tr
                            key={rName}
                            style={{
                              borderBottom: "1px solid #F3F4F6",
                              transition: "background 0.2s"
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = "#F9FAFB"}
                            onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                          >
                            <td style={{ padding: "14px 16px", fontWeight: "600", color: "#111827" }}>{getRoomEN(rName)}</td>
                            <td style={{ padding: "14px 16px", textAlign: "right", color: "#065F46", fontWeight: "600" }}>
                              {formatCurrency(currentVal)}
                            </td>
                            <td style={{ padding: "14px 16px", textAlign: "right", color: "#6B7280" }}>
                              {formatCurrency(compareVal)}
                            </td>
                            <td style={{
                              padding: "14px 16px",
                              textAlign: "right",
                              color: diff >= 0 ? "#DC2626" : "#2563EB",
                              fontWeight: "600"
                            }}>
                              {diff >= 0 ? '+' : ''}{formatCurrency(diff)}
                            </td>
                            <td style={{ padding: "14px 16px", textAlign: "right" }}>
                              <span style={{
                                color: roomGrowth >= 0 ? "#DC2626" : "#2563EB",
                                fontWeight: "600",
                                background: roomGrowth >= 0 ? "#FEF2F2" : "#EFF6FF",
                                padding: "4px 10px",
                                borderRadius: "6px",
                                fontSize: "13px"
                              }}>
                                {roomGrowth !== null
                                  ? `${roomGrowth >= 0 ? '+' : ''}${roomGrowth}%`
                                  : '-'
                                }
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                      {/* Building Total */}
                      <tr style={{ background: "linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)", fontWeight: "bold" }}>
                        <td style={{ padding: "14px 16px", fontWeight: "700", color: "#065F46", borderRadius: "8px 0 0 8px" }}>Total</td>
                        <td style={{ padding: "14px 16px", textAlign: "right", color: "#065F46", fontWeight: "700" }}>{formatCurrency(currentTotal)}</td>
                        <td style={{ padding: "14px 16px", textAlign: "right", color: "#6B7280", fontWeight: "600" }}>{formatCurrency(compareTotal)}</td>
                        <td style={{
                          padding: "14px 16px",
                          textAlign: "right",
                          color: currentTotal - compareTotal >= 0 ? "#DC2626" : "#2563EB",
                          fontWeight: "700"
                        }}>
                          {currentTotal - compareTotal >= 0 ? '+' : ''}{formatCurrency(currentTotal - compareTotal)}
                        </td>
                        <td style={{ padding: "14px 16px", textAlign: "right", borderRadius: "0 8px 8px 0" }}>
                          <span style={{
                            color: growthRate >= 0 ? "#DC2626" : "#2563EB",
                            fontWeight: "700",
                            background: growthRate >= 0 ? "#FEE2E2" : "#DBEAFE",
                            padding: "6px 12px",
                            borderRadius: "8px",
                            fontSize: "14px"
                          }}>
                            {growthRate !== null ? `${growthRate >= 0 ? '+' : ''}${growthRate}%` : '-'}
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
};

export default RevenueDashboard;
