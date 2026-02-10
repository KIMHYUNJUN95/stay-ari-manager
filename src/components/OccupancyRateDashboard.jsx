// src/components/OccupancyRateDashboard.jsx
import React, { useState, useEffect } from 'react';
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from '../firebase';
import { useUser } from '../contexts/UserContext';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

// 건물 정렬 순서
const BUILDING_ORDER = [
  "아라키초A", "아라키초B", "다이쿄초", "가부키초",
  "다카다노바바", "오쿠보A동", "오쿠보B동", "오쿠보C동", "사노시"
];

// 건물명 영문 매핑
const getBuildingNameEN = (koreanName) => {
  const nameMap = {
    "아라키초A": "Arakicho A",
    "아라키초B": "Arakicho B",
    "다이쿄초": "Daikyocho",
    "가부키초": "Kabukicho",
    "다카다노바바": "Takadanobaba",
    "오쿠보A동": "Okubo A",
    "오쿠보B동": "Okubo B",
    "오쿠보C동": "Okubo C",
    "사노시": "Sanoshi"
  };
  return nameMap[koreanName] || koreanName;
};

// 객실명 영문 변환
const getRoomNameEN = (koreanRoom) => {
  // "201호" -> "Room 201", "오쿠보A" -> "Okubo A", "사노" -> "Sano"
  if (koreanRoom === "오쿠보A") return "Okubo A";
  if (koreanRoom === "오쿠보B") return "Okubo B";
  if (koreanRoom === "오쿠보C") return "Okubo C";
  if (koreanRoom === "사노") return "Sano";
  return koreanRoom.replace("호", "").replace(/^(\d+)/, "Room $1");
};

// ★ 다이쿄초 매각일 (2025-01-25 마지막 운영일)
const DAIKYO_SOLD_DATE = "2026-01-26";

// 현재 운영 중인 건물 목록 (날짜 기준)
const getActiveBuildingOrder = (dateStr) => {
  if (dateStr >= DAIKYO_SOLD_DATE) {
    return BUILDING_ORDER.filter(b => b !== "다이쿄초");
  }
  return BUILDING_ORDER;
};

// 각 건물의 객실 수 (객실 리스트의 길이)
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

// 월의 일수 계산
const getDaysInMonth = (year, month) => {
  return new Date(year, month, 0).getDate();
};

// 예약된 날짜들을 Set으로 계산 (겹침 제거)
// ★ 베드24 기준: arrival ~ departure 전날까지 점유됨
// 예: 12-05 ~ 12-07 = 12/5, 12/6 점유 (12/7은 체크아웃하는 날이므로 다음 게스트 가능)
const getOccupiedDaysSet = (reservations, monthStart, monthEnd) => {
  const occupiedDates = new Set();

  reservations.forEach(r => {
    // arrival부터 departure 전날까지
    const resStart = new Date(Math.max(new Date(r.arrival), new Date(monthStart)));
    const resEnd = new Date(r.departure);
    resEnd.setDate(resEnd.getDate() - 1); // departure 전날까지만

    // monthEnd보다 크면 monthEnd로 제한
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

const OccupancyRateDashboard = () => {
  const { companyId } = useUser();
  const currentDate = new Date();
  const [selectedYear, setSelectedYear] = useState(currentDate.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(currentDate.getMonth() + 1);
  const [loading, setLoading] = useState(false);

  // 날짜 포맷팅 (YYYY-MM)
  const selectedMonthStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;

  // 월 이름 (숫자+영어 조합)
  const MONTHS = [
    '1 January', '2 February', '3 March', '4 April', '5 May', '6 June',
    '7 July', '8 August', '9 September', '10 October', '11 November', '12 December'
  ];

  // 연도 목록 (현재년도 ±5년)
  const YEARS = Array.from({length: 11}, (_, i) => currentDate.getFullYear() - 5 + i);

  // 데이터 상태
  const [monthlyData, setMonthlyData] = useState([]); // 월별 가동률
  const [buildingData, setBuildingData] = useState([]); // 건물별 가동률
  const [roomData, setRoomData] = useState({}); // 객실별 상세 데이터
  const [lowSeasonMonths, setLowSeasonMonths] = useState([]); // 비수기 월
  const [overallRate, setOverallRate] = useState(0); // 전체 가동률

  useEffect(() => {
    if (companyId) {
      fetchOccupancyData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, selectedMonthStr]);

  const fetchOccupancyData = async () => {
    setLoading(true);
    try {
      // 선택한 월의 연도와 월 추출
      const [year, month] = selectedMonthStr.split('-').map(Number);
      const daysInMonth = getDaysInMonth(year, month);

      // 해당 월의 시작일과 종료일
      const monthStart = `${selectedMonthStr}-01`;
      const monthEnd = `${selectedMonthStr}-${String(daysInMonth).padStart(2, '0')}`;

      // 과거 12개월 데이터 가져오기 (월별 추이 분석용)
      const monthsToFetch = [];
      const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

      for (let i = 11; i >= 0; i--) {
        const d = new Date(year, month - 1 - i, 1);
        const y = d.getFullYear();
        const m = d.getMonth() + 1;
        const lastDay = getDaysInMonth(y, m);
        monthsToFetch.push({
          label: `${m} ${MONTH_NAMES[m - 1]}`,
          year: y,
          month: m,
          start: `${y}-${String(m).padStart(2, '0')}-01`,
          end: `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
          days: lastDay
        });
      }

      // 과거 12개월간의 예약 데이터 가져오기
      // ★ 중요: arrival 기준으로 조회 (체크인 날짜 기준)
      const oldestMonth = monthsToFetch[0];
      const latestMonth = monthsToFetch[monthsToFetch.length - 1];

      if (!companyId) {
        console.warn('⚠️ No companyId for OccupancyRateDashboard');
        setLoading(false);
        return;
      }

      // 모든 예약 데이터 가져오기 (status 필터 제거 - 취소 제외는 클라이언트에서 처리)
      const q = query(
        collection(db, "reservations"),
        where("companyId", "==", companyId),
        where("arrival", "<=", latestMonth.end)  // arrival 기준
      );

      const snapshot = await getDocs(q);
      // 취소된 예약만 제외 (confirmed 예약만 가동률에 포함)
      const allReservations = snapshot.docs
        .map(d => d.data())
        .filter(r => r.status === "confirmed");

      console.log(`📊 가동률 계산: 총 ${allReservations.length}건의 confirmed 예약 데이터 조회됨`);
      console.log(`📅 조회 기간: ${oldestMonth.start} ~ ${latestMonth.end}`);

      // ===== 월별 가동률 계산 (사노시 제외) =====
      const monthlyRates = monthsToFetch.map(m => {
        let totalOccupiedDays = 0;
        let totalAvailableDays = 0;

        Object.keys(BUILDING_ROOMS).forEach(building => {
          // ★ 사노시는 전체 가동률 계산에서 제외 (독채 + 다른 업체 운영)
          if (building === "사노시") return;

          const rooms = BUILDING_ROOMS[building];
          rooms.forEach(room => {
            // ★ 다이쿄초: bookDate가 1/26 이후인 예약만 제외 (1/25 이전 예약은 모두 포함)
            const roomReservations = allReservations.filter(r => {
              const bookDate = r.bookDate || r.arrival;
              return r.building === building &&
                r.room === room &&
                r.arrival <= m.end &&
                r.departure >= m.start &&
                !(building === "다이쿄초" && bookDate >= DAIKYO_SOLD_DATE);
            });

            // 겹침을 제거한 실제 예약된 일수 계산
            const occupiedDays = getOccupiedDaysSet(roomReservations, m.start, m.end);

            totalOccupiedDays += occupiedDays;
            totalAvailableDays += m.days;
          });
        });

        const rate = totalAvailableDays > 0 ? (totalOccupiedDays / totalAvailableDays * 100) : 0;
        return {
          month: m.label,
          rate: parseFloat(rate.toFixed(1)),
          occupiedDays: totalOccupiedDays,
          availableDays: totalAvailableDays
        };
      });

      setMonthlyData(monthlyRates);

      // 비수기 판단 (가동률 60% 미만인 월)
      const lowSeasons = monthlyRates.filter(m => m.rate < 60);
      setLowSeasonMonths(lowSeasons);

      // ===== 선택한 월의 건물별/객실별 가동률 계산 =====
      const buildingRates = [];
      const roomDetails = {};

      Object.keys(BUILDING_ROOMS).forEach(building => {
        const rooms = BUILDING_ROOMS[building];
        let buildingOccupiedDays = 0;
        let buildingAvailableDays = 0;

        roomDetails[building] = {};

        rooms.forEach(room => {
          // ★ 다이쿄초: bookDate가 1/26 이후인 예약만 제외 (1/25 이전 예약은 모두 포함)
          const roomReservations = allReservations.filter(r => {
            const bookDate = r.bookDate || r.arrival;
            return r.building === building &&
              r.room === room &&
              r.arrival <= monthEnd &&
              r.departure >= monthStart &&
              !(building === "다이쿄초" && bookDate >= DAIKYO_SOLD_DATE);
          });

          // 겹침을 제거한 실제 예약된 일수 계산
          const occupiedDays = getOccupiedDaysSet(roomReservations, monthStart, monthEnd);

          const availableDays = daysInMonth;
          const vacantDays = availableDays - occupiedDays;
          const rate = availableDays > 0 ? (occupiedDays / availableDays * 100) : 0;

          roomDetails[building][room] = {
            occupiedDays,
            vacantDays,
            availableDays,
            rate: parseFloat(rate.toFixed(1)),
            reservationCount: roomReservations.length
          };

          buildingOccupiedDays += occupiedDays;
          buildingAvailableDays += availableDays;
        });

        const buildingRate = buildingAvailableDays > 0
          ? (buildingOccupiedDays / buildingAvailableDays * 100)
          : 0;

        buildingRates.push({
          name: building,
          rate: parseFloat(buildingRate.toFixed(1)),
          occupiedDays: buildingOccupiedDays,
          availableDays: buildingAvailableDays
        });
      });

      // 건물 정렬
      buildingRates.sort((a, b) => {
        const indexA = BUILDING_ORDER.indexOf(a.name);
        const indexB = BUILDING_ORDER.indexOf(b.name);
        return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
      });

      setBuildingData(buildingRates);
      setRoomData(roomDetails);

      // 전체 평균 가동률 (사노시 제외)
      const totalOccupied = buildingRates
        .filter(b => b.name !== "사노시")
        .reduce((sum, b) => sum + b.occupiedDays, 0);
      const totalAvailable = buildingRates
        .filter(b => b.name !== "사노시")
        .reduce((sum, b) => sum + b.availableDays, 0);
      const overall = totalAvailable > 0 ? (totalOccupied / totalAvailable * 100) : 0;
      setOverallRate(parseFloat(overall.toFixed(1)));

    } catch (error) {
      console.error("가동률 데이터 로딩 실패:", error);
    } finally {
      setLoading(false);
    }
  };

  // 가동률에 따른 색상 결정
  const getRateColor = (rate) => {
    if (rate >= 80) return "#34C759"; // 높음 (녹색)
    if (rate >= 60) return "#FF9500"; // 보통 (주황)
    return "#FF3B30"; // 낮음 (빨강)
  };

  // 가동률 등급
  const getRateGrade = (rate) => {
    if (rate >= 80) return "우수";
    if (rate >= 60) return "양호";
    if (rate >= 40) return "보통";
    return "저조";
  };

  return (
    <div style={{ background: "#FFFFFF", minHeight: "100vh", padding: "32px" }}>
      <div style={{ marginBottom: "32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: "28px", fontWeight: "700", color: "#1E293B", margin: 0, marginBottom: "8px" }}>Occupancy Rate Dashboard</h1>
          <p style={{ fontSize: "14px", color: "#64748B", margin: 0 }}>Monthly occupancy analytics and room performance metrics</p>
        </div>
        <div style={{ position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", background: "white", padding: "14px 20px", borderRadius: "12px", border: "2px solid #E2E8F0", boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)", cursor: "pointer", transition: "all 0.2s ease" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
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
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
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
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "100px", color: "#94A3B8" }}>
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>📊</div>
          <div style={{ fontSize: "16px", fontWeight: "600", color: "#475569" }}>Analyzing occupancy data...</div>
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "24px", marginBottom: "32px" }}>
            <div style={{ background: "linear-gradient(135deg, #4F46E5 0%, #6366F1 100%)", borderRadius: "16px", padding: "28px", boxShadow: "0 4px 20px rgba(79, 70, 229, 0.15)", color: "white", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: "-20px", right: "-20px", width: "120px", height: "120px", background: "rgba(255, 255, 255, 0.1)", borderRadius: "50%", filter: "blur(40px)" }} />
              <div style={{ position: "relative", zIndex: 1 }}>
                <div style={{ fontSize: "13px", fontWeight: "600", opacity: 0.9, marginBottom: "12px", letterSpacing: "0.5px", textTransform: "uppercase" }}>Overall Rate</div>
                <div style={{ fontSize: "42px", fontWeight: "700", marginBottom: "8px", lineHeight: 1 }}>{overallRate}%</div>
                <div style={{ fontSize: "13px", opacity: 0.8 }}>Excluding Sanoshi</div>
              </div>
            </div>
            {buildingData.find(b => b.name === "사노시") && (
              <div style={{ background: "#F8FAFC", borderRadius: "16px", padding: "28px", border: "1px solid #E2E8F0" }}>
                <div style={{ fontSize: "13px", fontWeight: "600", color: "#64748B", marginBottom: "12px", letterSpacing: "0.5px", textTransform: "uppercase" }}>Sanoshi Rate</div>
                <div style={{ fontSize: "42px", fontWeight: "700", color: "#1E293B", marginBottom: "8px", lineHeight: 1 }}>{buildingData.find(b => b.name === "사노시").rate}%</div>
                <div style={{ display: "inline-block", background: "#E0E7FF", color: "#4F46E5", padding: "4px 12px", borderRadius: "20px", fontSize: "12px", fontWeight: "600" }}>Separate Operation</div>
              </div>
            )}
            <div style={{ background: "#F8FAFC", borderRadius: "16px", padding: "28px", border: "1px solid #E2E8F0" }}>
              <div style={{ fontSize: "13px", fontWeight: "600", color: "#64748B", marginBottom: "12px", letterSpacing: "0.5px", textTransform: "uppercase" }}>Total Buildings</div>
              <div style={{ fontSize: "42px", fontWeight: "700", color: "#1E293B", marginBottom: "8px", lineHeight: 1 }}>{buildingData.filter(b => b.name !== "사노시").length}</div>
              <div style={{ fontSize: "13px", color: "#64748B" }}>Active Properties</div>
            </div>
            {lowSeasonMonths.length > 0 && (
              <div style={{ background: "#F8FAFC", borderRadius: "16px", padding: "28px", border: "1px solid #E2E8F0" }}>
                <div style={{ fontSize: "13px", fontWeight: "600", color: "#64748B", marginBottom: "12px", letterSpacing: "0.5px", textTransform: "uppercase" }}>Low Season</div>
                <div style={{ fontSize: "42px", fontWeight: "700", color: "#1E293B", marginBottom: "8px", lineHeight: 1 }}>{lowSeasonMonths.length}</div>
                <div style={{ display: "inline-block", background: "#FEE2E2", color: "#DC2626", padding: "4px 12px", borderRadius: "20px", fontSize: "12px", fontWeight: "600" }}>Below 60%</div>
              </div>
            )}
          </div>

          <div style={{ background: "#F8FAFC", borderRadius: "16px", padding: "28px", marginBottom: "32px", border: "1px solid #E2E8F0" }}>
            <div style={{ marginBottom: "24px" }}>
              <h3 style={{ fontSize: "18px", fontWeight: "700", color: "#1E293B", margin: 0, marginBottom: "4px" }}>Monthly Trend (Last 12 Months)</h3>
              <p style={{ fontSize: "13px", color: "#64748B", margin: 0 }}>Occupancy rate excluding Sanoshi</p>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={monthlyData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: "#64748B", fontSize: 12 }} />
                <YAxis domain={[0, 100]} tickFormatter={(val) => `${val}%`} tick={{ fill: "#64748B", fontSize: 12 }} />
                <Tooltip contentStyle={{ background: "white", border: "1px solid #E2E8F0", borderRadius: "8px", fontSize: "13px" }} formatter={(value) => [`${value}%`, "Rate"]} />
                <Line type="monotone" dataKey="rate" stroke="#4F46E5" strokeWidth={2.5} dot={{ fill: "#4F46E5", r: 4 }} activeDot={{ r: 6 }} />
                <Line type="monotone" dataKey={() => 60} stroke="#DC2626" strokeWidth={1.5} strokeDasharray="5 5" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div style={{ background: "#F8FAFC", borderRadius: "16px", padding: "28px", marginBottom: "32px", border: "1px solid #E2E8F0" }}>
            <div style={{ marginBottom: "24px" }}>
              <h3 style={{ fontSize: "18px", fontWeight: "700", color: "#1E293B", margin: 0, marginBottom: "4px" }}>Building Performance</h3>
              <p style={{ fontSize: "13px", color: "#64748B", margin: 0 }}>Occupancy rate by property</p>
            </div>
            <ResponsiveContainer width="100%" height={340}>
              <BarChart data={buildingData.map(b => ({ ...b, nameEN: getBuildingNameEN(b.name) }))} margin={{ top: 20, right: 30, left: 20, bottom: 70 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis dataKey="nameEN" angle={-45} textAnchor="end" tick={{ fill: "#475569", fontSize: 13, fontWeight: 600 }} height={90} />
                <YAxis domain={[0, 100]} tickFormatter={(val) => `${val}%`} tick={{ fill: "#64748B", fontSize: 12 }} />
                <Tooltip contentStyle={{ background: "white", border: "1px solid #E2E8F0", borderRadius: "8px", fontSize: "13px" }} formatter={(value) => [`${value}%`, "Rate"]} />
                <Bar dataKey="rate" radius={[8, 8, 0, 0]} barSize={32}>
                  {buildingData.map((entry, index) => (
                    <rect key={`bar-${index}`} fill={entry.name === "사노시" ? "#94A3B8" : "#4F46E5"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* 건물별 상세 가동률 (객실별) */}
          {BUILDING_ORDER.filter(bName => roomData[bName]).map(bName => {
            const building = buildingData.find(b => b.name === bName);
            if (!building) return null;

            // 객실을 가동률 높은 순서대로 정렬 (가동률 같으면 객실명 순서)
            const rooms = Object.keys(roomData[bName] || {}).sort((a, b) => {
              const rateA = roomData[bName][a].rate;
              const rateB = roomData[bName][b].rate;

              // 가동률이 다르면 가동률 내림차순
              if (rateA !== rateB) {
                return rateB - rateA;
              }

              // 가동률이 같으면 객실명 오름차순
              return a.localeCompare(b, 'ko');
            });
            if (rooms.length === 0) return null;

            return (
              <div key={bName} style={{ background: "#F8FAFC", borderRadius: "16px", padding: "28px", marginBottom: "24px", border: "1px solid #E2E8F0" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px", paddingBottom: "16px", borderBottom: "2px solid #E2E8F0" }}>
                  <div>
                    <h3 style={{ fontSize: "20px", fontWeight: "700", color: "#1E293B", margin: 0, marginBottom: "4px" }}>{getBuildingNameEN(bName)}</h3>
                    <p style={{ fontSize: "13px", color: "#64748B", margin: 0 }}>{bName === "사노시" ? "Separate operation - excluded from overall" : "Room-level occupancy breakdown"}</p>
                  </div>
                  <div style={{ background: "linear-gradient(135deg, #4F46E5 0%, #6366F1 100%)", color: "white", padding: "10px 20px", borderRadius: "12px", fontSize: "16px", fontWeight: "700" }}>{building.rate}%</div>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "white", borderBottom: "2px solid #E2E8F0" }}>
                        <th style={{ textAlign: "left", padding: "14px 16px", fontSize: "12px", fontWeight: "700", color: "#64748B", textTransform: "uppercase", letterSpacing: "0.5px" }}>Room</th>
                        <th style={{ textAlign: "right", padding: "14px 16px", fontSize: "12px", fontWeight: "700", color: "#64748B", textTransform: "uppercase", letterSpacing: "0.5px" }}>Bookings</th>
                        <th style={{ textAlign: "right", padding: "14px 16px", fontSize: "12px", fontWeight: "700", color: "#64748B", textTransform: "uppercase", letterSpacing: "0.5px" }}>Occupied</th>
                        <th style={{ textAlign: "right", padding: "14px 16px", fontSize: "12px", fontWeight: "700", color: "#64748B", textTransform: "uppercase", letterSpacing: "0.5px" }}>Vacant</th>
                        <th style={{ textAlign: "right", padding: "14px 16px", fontSize: "12px", fontWeight: "700", color: "#64748B", textTransform: "uppercase", letterSpacing: "0.5px" }}>Rate</th>
                        <th style={{ textAlign: "right", padding: "14px 16px", fontSize: "12px", fontWeight: "700", color: "#64748B", textTransform: "uppercase", letterSpacing: "0.5px" }}>Grade</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rooms.map((rName, idx) => {
                        const rData = roomData[bName][rName];
                        const gradeMap = { "우수": "Excellent", "양호": "Good", "보통": "Fair", "저조": "Poor" };
                        return (
                          <tr key={rName} style={{ background: idx % 2 === 0 ? "white" : "#F1F5F9", borderBottom: "1px solid #E2E8F0" }}>
                            <td style={{ textAlign: "left", padding: "16px", fontWeight: "600", fontSize: "14px", color: "#1E293B" }}>{getRoomNameEN(rName)}</td>
                            <td style={{ textAlign: "right", padding: "16px", color: "#64748B" }}>{rData.reservationCount}</td>
                            <td style={{ textAlign: "right", padding: "16px", fontWeight: "600", color: "#10B981" }}>{rData.occupiedDays}d</td>
                            <td style={{ textAlign: "right", padding: "16px", fontWeight: rData.vacantDays > 15 ? "700" : "normal", color: rData.vacantDays > 15 ? "#DC2626" : "#64748B" }}>{rData.vacantDays}d</td>
                            <td style={{ textAlign: "right", padding: "16px", fontWeight: "700", fontSize: "15px", color: "#4F46E5" }}>{rData.rate}%</td>
                            <td style={{ textAlign: "right", padding: "16px" }}>
                              <span style={{ background: getRateColor(rData.rate), color: "white", padding: "4px 12px", borderRadius: "8px", fontSize: "11px", fontWeight: "600" }}>
                                {gradeMap[getRateGrade(rData.rate)]}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                      <tr style={{ background: "#E0E7FF", fontWeight: "700", borderTop: "2px solid #4F46E5" }}>
                        <td style={{ textAlign: "left", padding: "16px", fontSize: "14px", color: "#1E293B" }}>Building Avg</td>
                        <td style={{ textAlign: "right", padding: "16px", color: "#64748B" }}>{rooms.reduce((sum, r) => sum + roomData[bName][r].reservationCount, 0)}</td>
                        <td style={{ textAlign: "right", padding: "16px", color: "#10B981" }}>{building.occupiedDays}d</td>
                        <td style={{ textAlign: "right", padding: "16px", color: "#64748B" }}>{building.availableDays - building.occupiedDays}d</td>
                        <td style={{ textAlign: "right", padding: "16px", color: "#4F46E5" }}>{building.rate}%</td>
                        <td style={{ textAlign: "right", padding: "16px" }}>
                          <span style={{ background: "#4F46E5", color: "white", padding: "4px 12px", borderRadius: "8px", fontSize: "11px", fontWeight: "600" }}>
                            {({ "우수": "Excellent", "양호": "Good", "보통": "Fair", "저조": "Poor" })[getRateGrade(building.rate)]}
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}

          <div style={{ background: "#F8FAFC", borderRadius: "16px", padding: "24px", border: "1px solid #E2E8F0", marginTop: "32px" }}>
            <h4 style={{ fontSize: "14px", fontWeight: "700", color: "#1E293B", margin: 0, marginBottom: "16px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Grading Criteria</h4>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: "#10B981" }} />
                <span style={{ fontSize: "13px", color: "#64748B" }}>Excellent (80%+)</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: "#F59E0B" }} />
                <span style={{ fontSize: "13px", color: "#64748B" }}>Good (60-80%)</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: "#F59E0B" }} />
                <span style={{ fontSize: "13px", color: "#64748B" }}>Fair (40-60%)</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: "#DC2626" }} />
                <span style={{ fontSize: "13px", color: "#64748B" }}>Poor (Below 40%)</span>
              </div>
            </div>
            <p style={{ fontSize: "13px", color: "#64748B", margin: 0 }}>
              <strong style={{ color: "#1E293B" }}>Note:</strong> Vacant days exceeding 15 days are highlighted in red for attention.
            </p>
          </div>
        </>
      )}
    </div>
  );
};

export default OccupancyRateDashboard;
