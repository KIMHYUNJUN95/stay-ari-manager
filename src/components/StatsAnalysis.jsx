import React, { useState } from 'react';
// 파이어베이스 및 데이터 관련 기능을 파일 내부에서 직접 정의하여 경로 오류 해결
import { initializeApp, getApps, getApp } from "firebase/app";
import { getFirestore, collection, getDocs, query, where } from "firebase/firestore";

// --- 1. 파이어베이스 설정 (경로 오류 방지를 위한 인라인 포함) ---
const firebaseConfig = {
  apiKey: "AIzaSyBHI6d4mDDBEIB77GVQj5Rz1EbMyPaCjgA",
  authDomain: "my-booking-app-3f0e7.firebaseapp.com",
  projectId: "my-booking-app-3f0e7",
  storageBucket: "my-booking-app-3f0e7.firebasestorage.app",
  messagingSenderId: "1008418095386",
  appId: "1:1008418095386:web:99eddb1ec872d0b1906ca3",
  measurementId: "G-KKNJ5P1KFD"
};

// 앱이 이미 초기화되었는지 확인 후 초기화 (중복 방지)
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);

// --- 2. 건물 데이터 (경로 오류 방지를 위한 인라인 포함) ---
const BUILDING_DATA = {
  "아라키초A": [
    "201호", "202호", "301호", "302호", "401호", "402호",
    "501호", "502호", "602호", "701호", "702호"
  ],
  "아라키초B": [
    "101호", "102호", "201호", "202호", "301호", "302호", "401호", "402호"
  ],
  "다이쿄초": [
    "B01호", "B02호", "101호", "102호", "201호", "202호", "302호"
  ],
  "가부키초": [
    "202호", "203호", "302호", "303호", "402호", "403호",
    "502호", "603호", "802호", "803호"
  ],
  "다카다노바바": [
    "2층", "3층", "4층", "5층", "6층", "7층", "8층", "9층"
  ],
  "오쿠보": [
    "A동", "B동", "C동"
  ],
  "사노시": [
    "독채"
  ]
};

// ★ 다이쿄초 매각일 (2025-01-25 마지막 운영일)
const DAIKYO_SOLD_DATE = "2026-01-26";

function StatsAnalysis() {
  const currentDate = new Date();
  const [selectedYear, setSelectedYear] = useState(currentDate.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(currentDate.getMonth() + 1);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);

  // 날짜 포맷팅 (YYYY-MM)
  const targetMonth = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;

  // 캐시 버스팅용 버전
  const CACHE_BUSTER = 'v2.0';

  // 월 이름 (숫자+영어 조합)
  const MONTHS = [
    '1 January', '2 February', '3 March', '4 April', '5 May', '6 June',
    '7 July', '8 August', '9 September', '10 October', '11 November', '12 December'
  ];

  // 연도 목록 (현재년도 ±5년)
  const YEARS = Array.from({length: 11}, (_, i) => currentDate.getFullYear() - 5 + i);

  const calculateStats = async () => {
    setLoading(true);
    setStats(null);

    // 1. 선택한 달의 데이터 쿼리
    const q = query(
      collection(db, "reservations"),
      where("date", ">=", `${targetMonth}-01`),
      where("date", "<=", `${targetMonth}-31`)
    );

    try {
      const snapshot = await getDocs(q);
      const reservations = snapshot.docs.map(doc => doc.data());

      // 2. 데이터 집계 구조 만들기
      const report = {};
      Object.keys(BUILDING_DATA).forEach(b => {
        report[b] = { total: 0, rooms: {} };
        BUILDING_DATA[b].forEach(r => {
          report[b].rooms[r] = { total: 0, cancelled: 0 };
        });
      });

      // 3. 카운팅
      reservations.forEach(r => {
        const { building, room, status, arrival } = r;

        // 다이쿄초: bookDate가 1/26 이후인 예약만 제외 (1/25 이전 예약은 모두 포함)
        const bookDate = r.bookDate || arrival;
        if (building === "다이쿄초" && bookDate >= DAIKYO_SOLD_DATE) return;

        // 데이터 무결성 체크 (혹시 삭제된 객실 데이터가 있을 경우 무시)
        if (report[building] && report[building].rooms[room]) {
          report[building].total += 1; // 건물 전체 건수
          report[building].rooms[room].total += 1; // 객실 전체 건수 (취소 포함)

          if (status === 'cancelled') {
            report[building].rooms[room].cancelled += 1;
          }
        }
      });

      setStats(report);
    } catch (error) {
      console.error(error);
      alert("Failed to load data. Please try again.");
    }
    setLoading(false);
  };

  return (
    <div style={{ background: "#FFFFFF", minHeight: "100vh", padding: "32px" }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <div>
          <h1 style={{ fontSize: "28px", fontWeight: "700", color: "#1E293B", margin: 0, marginBottom: "8px" }}>Stay Month Analytics</h1>
          <p style={{ fontSize: "14px", color: "#64748B", margin: 0 }}>Monthly booking performance and room statistics</p>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", background: "white", padding: "14px 20px", borderRadius: "12px", border: "2px solid #E2E8F0", boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)", transition: "all 0.2s ease" }}>
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
          <button
            onClick={calculateStats}
            style={{
              padding: '14px 24px',
              background: 'linear-gradient(135deg, #4F46E5 0%, #6366F1 100%)',
              color: 'white',
              border: 'none',
              borderRadius: '12px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '600',
              boxShadow: '0 2px 8px rgba(79, 70, 229, 0.15)',
              transition: 'all 0.2s ease'
            }}
          >
            Analyze
          </button>
        </div>
      </div>

      {loading && <div style={{ textAlign: "center", padding: "100px", color: "#94A3B8" }}>
        <div style={{ fontSize: "48px", marginBottom: "16px" }}>📊</div>
        <div style={{ fontSize: "16px", fontWeight: "600", color: "#475569" }}>Analyzing data...</div>
      </div>}

      {!loading && stats && Object.keys(stats).map(building => {
        const getBuildingNameEN = (koreanName) => {
          const nameMap = {
            "아라키초A": "Arakicho A",
            "아라키초B": "Arakicho B",
            "다이쿄초": "Daikyocho",
            "가부키초": "Kabukicho",
            "다카다노바바": "Takadanobaba",
            "오쿠보": "Okubo",
            "사노시": "Sanoshi"
          };
          return nameMap[koreanName] || koreanName;
        };

        return (
        <div key={building} style={{ background: '#F8FAFC', borderRadius: '16px', padding: '28px', marginBottom: '24px', border: '1px solid #E2E8F0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', paddingBottom: '16px', borderBottom: '2px solid #E2E8F0' }}>
            <div>
              <h3 style={{ fontSize: '20px', fontWeight: '700', color: '#1E293B', margin: 0, marginBottom: '4px' }}>{getBuildingNameEN(building)}</h3>
              <p style={{ fontSize: '13px', color: '#64748B', margin: 0 }}>Total {stats[building].total} bookings received</p>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ background: 'white', borderBottom: '2px solid #E2E8F0' }}>
                <th style={{ textAlign: 'left', padding: '14px 16px', fontSize: '12px', fontWeight: '700', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Room</th>
                <th style={{ textAlign: 'right', padding: '14px 16px', fontSize: '12px', fontWeight: '700', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total</th>
                <th style={{ textAlign: 'right', padding: '14px 16px', fontSize: '12px', fontWeight: '700', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Share (%)</th>
                <th style={{ textAlign: 'right', padding: '14px 16px', fontSize: '12px', fontWeight: '700', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Cancelled</th>
                <th style={{ textAlign: 'right', padding: '14px 16px', fontSize: '12px', fontWeight: '700', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Cancel Rate (%)</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(stats[building].rooms).map((room, idx) => {
                const data = stats[building].rooms[room];

                const share = stats[building].total === 0 ? 0
                  : ((data.total / stats[building].total) * 100).toFixed(1);

                const cancelRate = data.total === 0 ? 0
                  : ((data.cancelled / data.total) * 100).toFixed(1);

                const isHighShare = Number(share) >= 15;
                const isHighCancel = Number(cancelRate) >= 30;

                return (
                  <tr key={room} style={{ background: idx % 2 === 0 ? 'white' : '#F1F5F9', borderBottom: '1px solid #E2E8F0' }}>
                    <td style={{ textAlign: 'left', padding: '16px', fontWeight: '600', fontSize: '14px', color: '#1E293B' }}>{room}</td>
                    <td style={{ textAlign: 'right', padding: '16px', color: '#64748B' }}>{data.total}</td>
                    <td style={{ textAlign: 'right', padding: '16px', fontWeight: isHighShare ? '700' : 'normal', color: isHighShare ? '#DC2626' : '#4F46E5' }}>
                      {share}% {isHighShare && '🔥'}
                    </td>
                    <td style={{ textAlign: 'right', padding: '16px', color: '#64748B' }}>{data.cancelled}</td>
                    <td style={{ textAlign: 'right', padding: '16px', fontWeight: isHighCancel ? '700' : 'normal', color: isHighCancel ? '#DC2626' : '#4F46E5' }}>
                      {cancelRate}% {isHighCancel && '⚠️'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )})}
    </div>
  );
}

export default StatsAnalysis;