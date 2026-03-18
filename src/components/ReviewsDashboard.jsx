// src/components/ReviewsDashboard.jsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useUser } from '../contexts/UserContext';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Constants ───────────────────────────────────────────────────────────────

import { BUILDING_NAMES_EN, ACTIVE_BUILDING_ORDER as BUILDING_ORDER } from '../constants/buildingData';

const BOOKING_CATEGORIES = [
  { key: "clean", label: "Cleanliness" },
  { key: "comfort", label: "Comfort" },
  { key: "facilities", label: "Facilities" },
  { key: "staff", label: "Staff" },
  { key: "value", label: "Value" },
  { key: "location", label: "Location" }
];

const AIRBNB_CATEGORIES = [
  { key: "cleanliness", label: "Cleanliness" },
  { key: "accuracy", label: "Accuracy" },
  { key: "checkin", label: "Check-in" },
  { key: "communication", label: "Communication" },
  { key: "location", label: "Location" },
  { key: "value", label: "Value" }
];

const BUILDING_COLORS = [
  "#4F46E5", "#7C3AED", "#EC4899", "#EF4444",
  "#F59E0B", "#10B981", "#06B6D4", "#8B5CF6"
];

const API_BASE = process.env.REACT_APP_API_BASE_URL || "https://us-central1-my-booking-app-3f0e7.cloudfunctions.net";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const getBuildingEn = (name) => BUILDING_NAMES_EN[name] || name;
const getBuildingColor = (name) => BUILDING_COLORS[BUILDING_ORDER.indexOf(name) % BUILDING_COLORS.length] || "#4F46E5";

const getScoreColor = (score, max = 10) => {
  const pct = (score / max) * 10;
  if (pct >= 9) return "#10B981";
  if (pct >= 8) return "#4F46E5";
  if (pct >= 7) return "#F59E0B";
  return "#EF4444";
};

const getScoreBg = (score, max = 10) => {
  const pct = (score / max) * 10;
  if (pct >= 9) return "rgba(16,185,129,0.12)";
  if (pct >= 8) return "rgba(79,70,229,0.12)";
  if (pct >= 7) return "rgba(245,158,11,0.12)";
  return "rgba(239,68,68,0.12)";
};

const formatScore = (score, decimals = 1) => score > 0 ? score.toFixed(decimals) : "—";
const formatScoreAuto = (score, max = 10) => score > 0 ? score.toFixed(max === 5 ? 2 : 1) : "—";

const formatDate = (dateStr) => {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr.replace(" ", "T"));
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}.${m}.${day}`;
  } catch { return null; }
};

const getMonthKey = (dateStr) => {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr.replace(" ", "T"));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  } catch { return null; }
};

const avg = (arr) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;

// ─── Data Computation ─────────────────────────────────────────────────────────

function computeBuildingStats(reviews) {
  const stats = {};
  for (const r of reviews) {
    if (!BUILDING_ORDER.includes(r.building)) continue;
    if (!stats[r.building]) {
      stats[r.building] = {
        building: r.building,
        buildingEn: getBuildingEn(r.building),
        booking: { scores: [], categories: {}, unanswered: 0 },
        airbnb: { scores: [], categories: {} }
      };
    }
    const s = stats[r.building];
    if (r.channel === "booking") {
      if (r.score > 0) s.booking.scores.push(r.score);
      if (!r.hasReply) s.booking.unanswered++;
      if (r.categories) {
        for (const [k, v] of Object.entries(r.categories)) {
          if (v !== null && v !== undefined) {
            if (!s.booking.categories[k]) s.booking.categories[k] = [];
            s.booking.categories[k].push(v);
          }
        }
      }
    } else if (r.channel === "airbnb") {
      const airbnbScore = r.rawScore || (r.score > 0 ? r.score / 2 : 0);
      if (airbnbScore > 0) s.airbnb.scores.push(airbnbScore);
      if (r.categories) {
        for (const [k, v] of Object.entries(r.categories)) {
          if (v !== null && v !== undefined) {
            if (!s.airbnb.categories[k]) s.airbnb.categories[k] = [];
            s.airbnb.categories[k].push(v);
          }
        }
      }
    }
  }
  // Aggregate
  const result = {};
  for (const [building, s] of Object.entries(stats)) {
    const bookingAvg = avg(s.booking.scores);
    const airbnbAvg = avg(s.airbnb.scores); // already normalized to 0-10
    const bookingCatAvg = {};
    for (const [k, vs] of Object.entries(s.booking.categories)) bookingCatAvg[k] = avg(vs);
    const airbnbCatAvg = {};
    for (const [k, vs] of Object.entries(s.airbnb.categories)) airbnbCatAvg[k] = avg(vs); // 원본 1-5 유지

    const totalCount = s.booking.scores.length + s.airbnb.scores.length;

    result[building] = {
      building,
      buildingEn: getBuildingEn(building),
      color: getBuildingColor(building),
      bookingCount: s.booking.scores.length,
      bookingAvg,
      bookingCatAvg,
      airbnbCount: s.airbnb.scores.length,
      airbnbAvg, // 5점 만점
      airbnbCatAvg, // 5점 만점
      totalCount,
      unanswered: s.booking.unanswered
    };
  }
  return result;
}

function computeTrendData(reviews) {
  // Booking.com만 날짜 있음
  const bookingReviews = reviews.filter(r => r.channel === "booking" && r.createdAt);
  const byMonthBuilding = {};

  for (const r of bookingReviews) {
    const month = getMonthKey(r.createdAt);
    if (!month || !BUILDING_ORDER.includes(r.building)) continue;
    if (!byMonthBuilding[month]) byMonthBuilding[month] = {};
    if (!byMonthBuilding[month][r.building]) byMonthBuilding[month][r.building] = [];
    if (r.score > 0) byMonthBuilding[month][r.building].push(r.score);
  }

  const months = Object.keys(byMonthBuilding).sort();
  return months.map(month => {
    const row = { month };
    for (const building of BUILDING_ORDER) {
      const scores = byMonthBuilding[month]?.[building] || [];
      row[getBuildingEn(building)] = scores.length ? parseFloat(avg(scores).toFixed(2)) : null;
    }
    return row;
  });
}

function computeWeaknesses(buildingStats, threshold = 8.0) {
  const weaknesses = [];
  for (const s of Object.values(buildingStats)) {
    // Booking.com category weaknesses
    for (const { key, label } of BOOKING_CATEGORIES) {
      const score = s.bookingCatAvg[key];
      if (score !== undefined && score < threshold) {
        weaknesses.push({
          building: s.building, buildingEn: s.buildingEn, color: s.color,
          channel: "Booking.com", category: label, score,
          gap: threshold - score
        });
      }
    }
    // Airbnb category weaknesses (5점 만점 — threshold의 절반 기준)
    const airbnbThreshold = threshold / 2; // 8.0 → 4.0
    for (const { key, label } of AIRBNB_CATEGORIES) {
      const score = s.airbnbCatAvg[key];
      if (score !== undefined && score < airbnbThreshold) {
        weaknesses.push({
          building: s.building, buildingEn: s.buildingEn, color: s.color,
          channel: "Airbnb", category: label, score, max: 5,
          gap: airbnbThreshold - score
        });
      }
    }
  }
  return weaknesses.sort((a, b) => a.score - b.score);
}

function computeRoomStats(reviews) {
  const airbnbReviews = reviews.filter(r => r.channel === "airbnb" && r.roomId);
  // roomId 기준으로 그룹핑 (듀얼 어카운트 분리)
  const byBuildingRoomId = {};

  for (const r of airbnbReviews) {
    const b = r.building;
    if (!BUILDING_ORDER.includes(b)) continue;
    if (!byBuildingRoomId[b]) byBuildingRoomId[b] = {};
    const rid = r.roomId;
    if (!byBuildingRoomId[b][rid]) byBuildingRoomId[b][rid] = { roomName: r.roomName || "Unknown", scores: [], categories: {} };
    const airbnbScore = r.rawScore || (r.score > 0 ? r.score / 2 : 0);
    if (airbnbScore > 0) byBuildingRoomId[b][rid].scores.push(airbnbScore);
    if (r.categories) {
      for (const [k, v] of Object.entries(r.categories)) {
        if (v !== null && v !== undefined) {
          if (!byBuildingRoomId[b][rid].categories[k]) byBuildingRoomId[b][rid].categories[k] = [];
          byBuildingRoomId[b][rid].categories[k].push(v);
        }
      }
    }
  }

  // 같은 roomName이 2개 이상이면 A/B 접미사 추가
  const result = {};
  for (const [building, roomIds] of Object.entries(byBuildingRoomId)) {
    result[building] = {};
    // roomName별 roomId 목록
    const nameToIds = {};
    for (const [rid, data] of Object.entries(roomIds)) {
      if (!nameToIds[data.roomName]) nameToIds[data.roomName] = [];
      nameToIds[data.roomName].push(rid);
    }
    for (const [rid, data] of Object.entries(roomIds)) {
      const ids = nameToIds[data.roomName];
      let displayName = data.roomName;
      if (ids.length > 1) {
        const idx = ids.indexOf(rid);
        displayName = `${data.roomName} (${String.fromCharCode(65 + idx)})`;
      }
      const roomAvg = avg(data.scores);
      const catAvgs = {};
      for (const [k, vs] of Object.entries(data.categories)) catAvgs[k] = avg(vs);
      result[building][displayName] = { count: data.scores.length, avg: roomAvg, catAvgs, roomId: rid };
    }
  }
  return result;
}

// ─── Date Picker ─────────────────────────────────────────────────────────────

const EN_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const EN_DAYS = ["Su","Mo","Tu","We","Th","Fr","Sa"];

function DatePickerButton({ value, onChange, placeholder = "Select date" }) {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() => value ? parseInt(value.substring(0, 4)) : new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => value ? parseInt(value.substring(5, 7)) - 1 : new Date().getMonth());
  const ref = React.useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (value) {
      setViewYear(parseInt(value.substring(0, 4)));
      setViewMonth(parseInt(value.substring(5, 7)) - 1);
    }
  }, [value]);

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const handleSelect = (day) => {
    const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    onChange(dateStr);
    setOpen(false);
  };

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  const displayText = value
    ? `${EN_MONTHS[parseInt(value.substring(5, 7)) - 1].substring(0, 3)} ${parseInt(value.substring(8, 10))}, ${value.substring(0, 4)}`
    : placeholder;

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button onClick={() => setOpen(!open)} style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "7px 14px", borderRadius: 8, border: "1.5px solid #E2E8F0",
        background: "white", color: value ? "#1E293B" : "#94A3B8",
        fontSize: 13, fontWeight: value ? 600 : 400, cursor: "pointer",
        transition: "all 0.2s", minWidth: 140
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={value ? "#4F46E5" : "#94A3B8"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        {displayText}
      </button>

      {open && (
        <motion.div
          initial={{ opacity: 0, y: -4, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.15 }}
          style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 1000,
            background: "white", borderRadius: 14, padding: 16,
            boxShadow: "0 8px 30px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08)",
            border: "1px solid #E2E8F0", width: 280
          }}>
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <button onClick={prevMonth} style={{ border: "none", background: "none", cursor: "pointer", color: "#64748B", fontSize: 16, padding: "4px 8px", borderRadius: 6 }}>‹</button>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#1E293B" }}>
              {viewMonth + 1}. {EN_MONTHS[viewMonth]} {viewYear}
            </span>
            <button onClick={nextMonth} style={{ border: "none", background: "none", cursor: "pointer", color: "#64748B", fontSize: 16, padding: "4px 8px", borderRadius: 6 }}>›</button>
          </div>

          {/* Day headers */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 4 }}>
            {EN_DAYS.map(d => (
              <div key={d} style={{ textAlign: "center", fontSize: 11, fontWeight: 600, color: "#94A3B8", padding: "4px 0" }}>{d}</div>
            ))}
          </div>

          {/* Days */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
            {Array.from({ length: firstDay }).map((_, i) => <div key={`e-${i}`} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const isSelected = dateStr === value;
              const isToday = dateStr === todayStr;
              return (
                <button key={day} onClick={() => handleSelect(day)} style={{
                  width: 34, height: 34, borderRadius: 8, border: "none",
                  background: isSelected ? "#4F46E5" : isToday ? "rgba(79,70,229,0.08)" : "transparent",
                  color: isSelected ? "white" : isToday ? "#4F46E5" : "#374151",
                  fontWeight: isSelected || isToday ? 700 : 400,
                  fontSize: 13, cursor: "pointer",
                  transition: "all 0.15s",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  margin: "0 auto"
                }}
                onMouseEnter={e => { if (!isSelected) e.target.style.background = "#F1F5F9"; }}
                onMouseLeave={e => { if (!isSelected) e.target.style.background = isToday ? "rgba(79,70,229,0.08)" : "transparent"; }}
                >
                  {day}
                </button>
              );
            })}
          </div>

          {/* Today button */}
          <div style={{ marginTop: 8, borderTop: "1px solid #F1F5F9", paddingTop: 8, display: "flex", justifyContent: "center" }}>
            <button onClick={() => { const t = new Date(); handleSelect(t.getDate()); setViewYear(t.getFullYear()); setViewMonth(t.getMonth()); }}
              style={{ border: "none", background: "none", color: "#4F46E5", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: "4px 12px", borderRadius: 6 }}>
              Today
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScoreBadge({ score, max = 10, size = "md" }) {
  const color = getScoreColor(score, max);
  const bg = getScoreBg(score, max);
  const fontSize = size === "lg" ? 22 : size === "sm" ? 12 : 15;
  const padding = size === "lg" ? "8px 14px" : size === "sm" ? "3px 7px" : "5px 10px";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      background: bg, color, border: `1.5px solid ${color}30`,
      borderRadius: 8, fontWeight: 700, fontSize, padding, letterSpacing: "-0.3px"
    }}>
      {formatScoreAuto(score, max)}
    </span>
  );
}

function StarDisplay({ score, max = 5 }) {
  const filled = Math.round((score / 10) * max);
  return (
    <span style={{ display: "inline-flex", gap: 2 }}>
      {Array.from({ length: max }).map((_, i) => (
        <svg key={i} width="12" height="12" viewBox="0 0 24 24" fill={i < filled ? "#F59E0B" : "#E2E8F0"}>
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      ))}
    </span>
  );
}

function CategoryBar({ label, score, max = 10 }) {
  const pct = Math.min((score / max) * 100, 100);
  const color = getScoreColor(score, max);
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: "#64748B", fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 12, color, fontWeight: 700 }}>{formatScoreAuto(score, max)}</span>
      </div>
      <div style={{ height: 6, background: "#E2E8F0", borderRadius: 999 }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          style={{ height: "100%", background: color, borderRadius: 999 }}
        />
      </div>
    </div>
  );
}

function PlatformBadge({ channel }) {
  const isBooking = channel === "booking";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600,
      background: isBooking ? "#003580" : "#FF385C",
      color: "white"
    }}>
      {isBooking ? "Booking.com" : "Airbnb"}
    </span>
  );
}

function TabButton({ id, label, active, onClick, badge }) {
  return (
    <button onClick={() => onClick(id)} style={{
      padding: "10px 18px", border: "none", borderRadius: 10, cursor: "pointer",
      fontWeight: active ? 700 : 500, fontSize: 13,
      background: active ? "#4F46E5" : "transparent",
      color: active ? "white" : "#64748B",
      transition: "all 0.2s ease",
      position: "relative", display: "flex", alignItems: "center", gap: 6
    }}>
      {label}
      {badge > 0 && (
        <span style={{
          background: active ? "rgba(255,255,255,0.3)" : "#EF4444",
          color: "white", borderRadius: 999, fontSize: 10, fontWeight: 700,
          padding: "1px 6px", minWidth: 18
        }}>
          {badge}
        </span>
      )}
    </button>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ buildingStats, reviews, channel }) {
  const isBooking = channel === "booking";
  const maxScore = isBooking ? 10 : 5;
  const totalReviews = reviews.length;
  const overallAvg = isBooking
    ? avg(reviews.filter(r => r.score > 0).map(r => r.score))
    : avg(reviews.filter(r => r.rawScore > 0 || r.score > 0).map(r => r.rawScore || r.score / 2));
  const unansweredTotal = isBooking ? reviews.filter(r => !r.hasReply).length : 0;

  // 점수별 분포
  const highCount = reviews.filter(r => {
    const s = isBooking ? r.score : (r.rawScore || r.score / 2);
    return s >= (isBooking ? 9 : 4.5);
  }).length;
  const lowCount = reviews.filter(r => {
    const s = isBooking ? r.score : (r.rawScore || r.score / 2);
    return s > 0 && s < (isBooking ? 7 : 3.5);
  }).length;

  const summaryCards = isBooking ? [
    { label: "Total Reviews", value: totalReviews, icon: "📝", color: "#003580", bg: "rgba(0,53,128,0.08)" },
    { label: "Average Score", value: overallAvg > 0 ? overallAvg.toFixed(1) : "—", suffix: "/ 10", icon: "⭐", color: "#003580", bg: "rgba(0,53,128,0.08)" },
    { label: "Excellent (9+)", value: highCount, icon: "🏆", color: "#10B981", bg: "rgba(16,185,129,0.08)" },
    { label: "Unanswered", value: unansweredTotal, icon: "💬", color: unansweredTotal > 0 ? "#EF4444" : "#10B981", bg: unansweredTotal > 0 ? "rgba(239,68,68,0.08)" : "rgba(16,185,129,0.08)" }
  ] : [
    { label: "Total Reviews", value: totalReviews, icon: "📝", color: "#FF385C", bg: "rgba(255,56,92,0.08)" },
    { label: "Average Score", value: overallAvg > 0 ? overallAvg.toFixed(2) : "—", suffix: "/ 5", icon: "⭐", color: "#FF385C", bg: "rgba(255,56,92,0.08)" },
    { label: "5-Star Reviews", value: highCount, icon: "🏆", color: "#10B981", bg: "rgba(16,185,129,0.08)" },
    { label: "Below 3.5", value: lowCount, icon: "⚠️", color: lowCount > 0 ? "#EF4444" : "#10B981", bg: lowCount > 0 ? "rgba(239,68,68,0.08)" : "rgba(16,185,129,0.08)" }
  ];

  const sortedBuildings = BUILDING_ORDER.filter(b => buildingStats[b]);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      {/* Summary Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 28 }}>
        {summaryCards.map((c, i) => (
          <motion.div key={c.label}
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: i * 0.06 }}
            style={{
              background: "white", borderRadius: 16, padding: "20px 24px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04)",
              border: "1px solid #F1F5F9"
            }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: c.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
                {c.icon}
              </div>
              <span style={{ fontSize: 12, color: "#94A3B8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{c.label}</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: c.color, letterSpacing: "-1px" }}>{c.value}</span>
              {c.suffix && <span style={{ fontSize: 12, color: "#94A3B8", fontWeight: 500 }}>{c.suffix}</span>}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Building Cards Grid */}
      <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1E293B", marginBottom: 16, letterSpacing: "-0.3px" }}>
        {isBooking ? "Booking.com" : "Airbnb"} — Rating by Property
      </h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
        {sortedBuildings.map((building, i) => {
          const s = buildingStats[building];
          const count = isBooking ? s.bookingCount : s.airbnbCount;
          const scoreAvg = isBooking ? s.bookingAvg : s.airbnbAvg;
          const catAvg = isBooking ? s.bookingCatAvg : s.airbnbCatAvg;
          const categories = isBooking ? BOOKING_CATEGORIES : AIRBNB_CATEGORIES;
          if (count === 0) return null;

          return (
            <motion.div key={building}
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: i * 0.05 }}
              style={{
                background: "white", borderRadius: 16, padding: "20px 22px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04)",
                border: "1px solid #F1F5F9", overflow: "hidden", position: "relative"
              }}>
              {/* Color accent bar */}
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${s.color}, ${s.color}80)`, borderRadius: "16px 16px 0 0" }} />

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#1E293B", marginBottom: 2 }}>{s.buildingEn}</div>
                  <div style={{ fontSize: 12, color: "#94A3B8" }}>{count} reviews</div>
                </div>
                <ScoreBadge score={scoreAvg} max={maxScore} size="lg" />
              </div>

              {/* Category bars */}
              <div style={{ marginBottom: isBooking && s.unanswered > 0 ? 12 : 0 }}>
                {categories.map(({ key, label }) => {
                  const val = catAvg[key];
                  if (val === undefined || val === null) return null;
                  return <CategoryBar key={key} label={label} score={val} max={maxScore} />;
                })}
              </div>

              {/* Unanswered badge (Booking only) */}
              {isBooking && s.unanswered > 0 && (
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px",
                  background: "rgba(239,68,68,0.08)", borderRadius: 8, border: "1px solid rgba(239,68,68,0.2)"
                }}>
                  <span style={{ fontSize: 11, color: "#EF4444", fontWeight: 600 }}>
                    {s.unanswered} unanswered review{s.unanswered > 1 ? "s" : ""}
                  </span>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ─── Trends Tab ───────────────────────────────────────────────────────────────

function TrendsTab({ trendData, buildingStats }) {
  const [selectedBuildings, setSelectedBuildings] = useState([]);

  useEffect(() => {
    const available = BUILDING_ORDER.filter(b => buildingStats[b] && buildingStats[b].bookingCount > 0);
    if (available.length > 0 && selectedBuildings.length === 0) {
      setSelectedBuildings(available.slice(0, 4));
    }
  }, [buildingStats]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleBuilding = (b) => {
    setSelectedBuildings(prev =>
      prev.includes(b) ? prev.filter(x => x !== b) : [...prev, b]
    );
  };

  // Monthly average (all buildings combined)
  const allMonthlyAvg = trendData.map(row => {
    const scores = Object.entries(row)
      .filter(([k]) => k !== "month")
      .map(([, v]) => v)
      .filter(v => v !== null && v > 0);
    return { month: row.month, avg: scores.length ? parseFloat(avg(scores).toFixed(2)) : null };
  });

  const availableBuildings = BUILDING_ORDER.filter(b => buildingStats[b] && buildingStats[b].bookingCount > 0);

  const formatMonth = (m) => {
    if (!m) return "";
    const [y, mo] = m.split("-");
    const d = new Date(parseInt(y), parseInt(mo) - 1);
    return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      {trendData.length === 0 ? (
        <div style={{ textAlign: "center", padding: "80px 40px", color: "#94A3B8" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📈</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#64748B", marginBottom: 6 }}>No trend data yet</div>
          <div style={{ fontSize: 13 }}>Sync reviews first to see monthly trends.</div>
        </div>
      ) : (
        <>
          {/* Overall trend */}
          <div style={{ background: "white", borderRadius: 16, padding: "24px", marginBottom: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04)", border: "1px solid #F1F5F9" }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#1E293B", marginBottom: 4, letterSpacing: "-0.3px" }}>Overall Monthly Average (Booking.com)</h3>
            <p style={{ fontSize: 12, color: "#94A3B8", marginBottom: 20 }}>Average review score across all properties</p>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={allMonthlyAvg}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis dataKey="month" tickFormatter={formatMonth} tick={{ fontSize: 11, fill: "#94A3B8" }} />
                <YAxis domain={[7, 10]} tick={{ fontSize: 11, fill: "#94A3B8" }} />
                <Tooltip formatter={(v) => [v?.toFixed(2), "Avg Score"]} labelFormatter={formatMonth} contentStyle={{ borderRadius: 10, border: "1px solid #E2E8F0", fontSize: 12 }} />
                <Line type="monotone" dataKey="avg" stroke="#4F46E5" strokeWidth={2.5} dot={{ r: 4, fill: "#4F46E5", strokeWidth: 0 }} activeDot={{ r: 6 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Per-building trend */}
          <div style={{ background: "white", borderRadius: 16, padding: "24px", boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04)", border: "1px solid #F1F5F9" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
              <div>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: "#1E293B", marginBottom: 4, letterSpacing: "-0.3px" }}>Per-Property Trend</h3>
                <p style={{ fontSize: 12, color: "#94A3B8" }}>Select properties to compare</p>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxWidth: 340 }}>
                {availableBuildings.map(b => {
                  const active = selectedBuildings.includes(b);
                  const color = getBuildingColor(b);
                  return (
                    <button key={b} onClick={() => toggleBuilding(b)} style={{
                      padding: "4px 10px", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer", border: "none",
                      background: active ? color : "#F1F5F9",
                      color: active ? "white" : "#64748B",
                      transition: "all 0.2s"
                    }}>
                      {getBuildingEn(b)}
                    </button>
                  );
                })}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis dataKey="month" tickFormatter={formatMonth} tick={{ fontSize: 11, fill: "#94A3B8" }} />
                <YAxis domain={[6, 10]} tick={{ fontSize: 11, fill: "#94A3B8" }} />
                <Tooltip formatter={(v, name) => [v?.toFixed(2), name]} labelFormatter={formatMonth} contentStyle={{ borderRadius: 10, border: "1px solid #E2E8F0", fontSize: 12 }} />
                <Legend />
                {selectedBuildings.map(b => (
                  <Line key={b} type="monotone" dataKey={getBuildingEn(b)} stroke={getBuildingColor(b)}
                    strokeWidth={2} dot={{ r: 3, strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </motion.div>
  );
}

// ─── Insights Tab ─────────────────────────────────────────────────────────────

function InsightsTab({ weaknesses, buildingStats, channel }) {
  const radarChannel = channel || "booking";
  const availableBuildings = BUILDING_ORDER.filter(b => buildingStats[b]);

  const bookingRadarData = BOOKING_CATEGORIES.map(({ key, label }) => {
    const row = { category: label };
    for (const b of availableBuildings) {
      const score = buildingStats[b]?.bookingCatAvg?.[key];
      row[getBuildingEn(b)] = score !== undefined ? parseFloat(score.toFixed(2)) : null;
    }
    return row;
  });

  const airbnbRadarData = AIRBNB_CATEGORIES.map(({ key, label }) => {
    const row = { category: label };
    for (const b of availableBuildings) {
      const score = buildingStats[b]?.airbnbCatAvg?.[key];
      row[getBuildingEn(b)] = score !== undefined ? parseFloat(score.toFixed(2)) : null;
    }
    return row;
  });

  const radarData = radarChannel === "booking" ? bookingRadarData : airbnbRadarData;

  const highWeaknesses = weaknesses.filter(w => w.gap > 1.5);
  const lowWeaknesses = weaknesses.filter(w => w.gap <= 1.5);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
        {/* Radar Chart */}
        <div style={{ background: "white", borderRadius: 16, padding: "24px", boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04)", border: "1px solid #F1F5F9" }}>
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#1E293B", letterSpacing: "-0.3px" }}>
              {radarChannel === "booking" ? "Booking.com" : "Airbnb"} — Category Radar
            </h3>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="#E2E8F0" />
              <PolarAngleAxis dataKey="category" tick={{ fontSize: 11, fill: "#64748B" }} />
              <PolarRadiusAxis domain={radarChannel === "airbnb" ? [0, 5] : [0, 10]} tick={{ fontSize: 9, fill: "#94A3B8" }} tickCount={radarChannel === "airbnb" ? 5 : 4} />
              {availableBuildings.slice(0, 4).map(b => (
                <Radar key={b} name={getBuildingEn(b)} dataKey={getBuildingEn(b)}
                  stroke={getBuildingColor(b)} fill={getBuildingColor(b)} fillOpacity={0.08} strokeWidth={2} />
              ))}
              <Legend />
              <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #E2E8F0", fontSize: 12 }} formatter={(v) => v ? v.toFixed(2) : "—"} />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        {/* Category Bar Chart */}
        <div style={{ background: "white", borderRadius: 16, padding: "24px", boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04)", border: "1px solid #F1F5F9" }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "#1E293B", marginBottom: 4, letterSpacing: "-0.3px" }}>Category Breakdown</h3>
          <p style={{ fontSize: 12, color: "#94A3B8", marginBottom: 16 }}>Average by category across all properties</p>
          <div style={{ overflowY: "auto", maxHeight: 240 }}>
            {(radarChannel === "booking" ? BOOKING_CATEGORIES : AIRBNB_CATEGORIES).map(({ key, label }) => {
              const scores = availableBuildings.map(b =>
                radarChannel === "booking"
                  ? buildingStats[b]?.bookingCatAvg?.[key]
                  : buildingStats[b]?.airbnbCatAvg?.[key]
              ).filter(v => v !== undefined && v !== null);
              const avgScore = scores.length ? avg(scores) : 0;
              return <CategoryBar key={key} label={label} score={avgScore} max={radarChannel === "airbnb" ? 5 : 10} />;
            })}
          </div>
        </div>
      </div>

      {/* Weaknesses */}
      <div style={{ background: "white", borderRadius: 16, padding: "24px", boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04)", border: "1px solid #F1F5F9" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(239,68,68,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>⚠️</div>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: "#1E293B", letterSpacing: "-0.3px" }}>Improvement Areas</h3>
          {weaknesses.length > 0 && (
            <span style={{ background: "#EF4444", color: "white", borderRadius: 999, fontSize: 11, fontWeight: 700, padding: "2px 8px" }}>{weaknesses.length}</span>
          )}
        </div>
        <p style={{ fontSize: 12, color: "#94A3B8", marginBottom: 20 }}>
          Categories scoring below {radarChannel === "airbnb" ? "4.0 / 5" : "8.0 / 10"}
        </p>

        {weaknesses.length === 0 ? (
          <div style={{ textAlign: "center", padding: "32px", color: "#10B981" }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🎉</div>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Excellent performance!</div>
            <div style={{ fontSize: 12, color: "#94A3B8" }}>All categories are above the 8.0 threshold.</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
            {weaknesses.map((w, i) => (
              <motion.div key={`${w.building}-${w.channel}-${w.category}`}
                initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.25, delay: i * 0.04 }}
                style={{
                  borderRadius: 12, padding: "14px 16px",
                  background: w.gap > 1.5 ? "rgba(239,68,68,0.05)" : "rgba(245,158,11,0.05)",
                  border: `1px solid ${w.gap > 1.5 ? "rgba(239,68,68,0.2)" : "rgba(245,158,11,0.2)"}`
                }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#1E293B", marginBottom: 2 }}>{w.buildingEn}</div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <PlatformBadge channel={w.channel === "Booking.com" ? "booking" : "airbnb"} />
                      <span style={{ fontSize: 11, color: "#64748B" }}>{w.category}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: getScoreColor(w.score, w.max || 10), letterSpacing: "-0.5px" }}>{formatScoreAuto(w.score, w.max || 10)}<span style={{ fontSize: 10, fontWeight: 500, color: "#94A3B8" }}>/{w.max || 10}</span></div>
                    <div style={{ fontSize: 10, color: "#94A3B8" }}>-{w.gap.toFixed(1)} below</div>
                  </div>
                </div>
                <div style={{ height: 4, background: "#E2E8F0", borderRadius: 999 }}>
                  <div style={{ height: "100%", width: `${(w.score / (w.max || 10)) * 100}%`, background: getScoreColor(w.score, w.max || 10), borderRadius: 999 }} />
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Reviews Tab ──────────────────────────────────────────────────────────────

function ReviewsTab({ reviews, channel: parentChannel, dateSearchReversed, hasDateFilter }) {
  const channel = parentChannel || "all";
  const [building, setBuilding] = useState("all");
  const [replyFilter, setReplyFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 15;

  // 기간 검색 방향 변경 시 정렬 자동 반영
  useEffect(() => {
    if (hasDateFilter) setSortBy(dateSearchReversed ? "newest" : "oldest");
  }, [dateSearchReversed, hasDateFilter]);

  // reviews 변경 시 page 리셋
  useEffect(() => { setPage(0); }, [reviews]);

  const buildings = ["all", ...BUILDING_ORDER.filter(b => reviews.some(r => r.building === b))];

  const filtered = useMemo(() => {
    let list = reviews.filter(r => {
      if (channel !== "all" && r.channel !== channel) return false;
      if (building !== "all" && r.building !== building) return false;
      if (replyFilter === "unanswered" && r.hasReply) return false;
      if (replyFilter === "answered" && !r.hasReply) return false;
      if (search) {
        const q = search.toLowerCase();
        const text = [r.content?.text, r.content?.positive, r.content?.negative, r.reviewerName, getBuildingEn(r.building)].join(" ").toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });

    if (sortBy === "newest") list = list.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    else if (sortBy === "oldest") list = list.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
    else if (sortBy === "lowest") list = list.sort((a, b) => a.score - b.score);
    else if (sortBy === "highest") list = list.sort((a, b) => b.score - a.score);
    return list;
  }, [reviews, channel, building, replyFilter, search, sortBy]);

  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      {/* Filter bar */}
      <div style={{ background: "white", borderRadius: 14, padding: "16px 20px", marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.06)", border: "1px solid #F1F5F9" }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search reviews..."
            style={{ flex: 1, minWidth: 180, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #E2E8F0", fontSize: 13, outline: "none", color: "#1E293B" }} />

          <select value={building} onChange={e => { setBuilding(e.target.value); setPage(0); }}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1.5px solid #E2E8F0", fontSize: 13, color: "#1E293B", background: "white", cursor: "pointer" }}>
            {buildings.map(b => <option key={b} value={b}>{b === "all" ? "All Properties" : getBuildingEn(b)}</option>)}
          </select>

          {parentChannel === "booking" && (
            <select value={replyFilter} onChange={e => { setReplyFilter(e.target.value); setPage(0); }}
              style={{ padding: "8px 12px", borderRadius: 8, border: "1.5px solid #E2E8F0", fontSize: 13, color: "#1E293B", background: "white", cursor: "pointer" }}>
              <option value="all">All Replies</option>
              <option value="unanswered">Unanswered</option>
              <option value="answered">Answered</option>
            </select>
          )}

          <select value={sortBy} onChange={e => setSortBy(e.target.value)}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1.5px solid #E2E8F0", fontSize: 13, color: "#1E293B", background: "white", cursor: "pointer" }}>
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="lowest">Lowest Score</option>
            <option value="highest">Highest Score</option>
          </select>

          <span style={{ fontSize: 12, color: "#94A3B8", whiteSpace: "nowrap" }}>{filtered.length} results</span>
        </div>
      </div>

      {/* Review cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {paginated.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px", color: "#94A3B8", background: "white", borderRadius: 16, border: "1px solid #F1F5F9" }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🔍</div>
            <div style={{ fontWeight: 600, color: "#64748B" }}>No reviews found</div>
          </div>
        ) : paginated.map((r, i) => (
          <motion.div key={r.id || r.reviewId || `review-${i}`}
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: i * 0.03 }}
            style={{
              background: "white", borderRadius: 14, padding: "16px 20px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)", border: "1px solid #F1F5F9"
            }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <PlatformBadge channel={r.channel} />
                <span style={{ fontSize: 12, fontWeight: 600, color: "#4F46E5" }}>
                  {getBuildingEn(r.building)}{r.roomName ? ` · ${r.roomName}` : ""}
                </span>
                {r.reviewerName && (
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>
                    {r.reviewerName}{r.reviewerCountry ? ` (${r.reviewerCountry.toUpperCase()})` : ""}
                  </span>
                )}
                {r.createdAt && (
                  <span style={{ fontSize: 12, color: "#64748B", fontWeight: 500 }}>
                    {formatDate(r.createdAt)}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                <ScoreBadge score={r.channel === "airbnb" ? (r.rawScore || r.score / 2) : r.score} max={r.channel === "airbnb" ? 5 : 10} />
                {!r.hasReply && r.channel === "booking" && (
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#EF4444", background: "rgba(239,68,68,0.1)", padding: "2px 7px", borderRadius: 6, border: "1px solid rgba(239,68,68,0.2)" }}>
                    No reply
                  </span>
                )}
              </div>
            </div>

            {/* Review content */}
            {r.channel === "booking" && (
              <div style={{ display: "flex", gap: 16 }}>
                {r.content?.positive && (
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: "#10B981", fontWeight: 600, marginBottom: 4 }}>👍 Positive</div>
                    <p style={{ fontSize: 13, color: "#374151", lineHeight: 1.5, margin: 0 }}>{r.content.positive}</p>
                  </div>
                )}
                {r.content?.negative && (
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: "#EF4444", fontWeight: 600, marginBottom: 4 }}>👎 Negative</div>
                    <p style={{ fontSize: 13, color: "#374151", lineHeight: 1.5, margin: 0 }}>{r.content.negative}</p>
                  </div>
                )}
                {!r.content?.positive && !r.content?.negative && (
                  <p style={{ fontSize: 13, color: "#94A3B8", fontStyle: "italic", margin: 0 }}>No written review</p>
                )}
              </div>
            )}
            {r.channel === "airbnb" && r.content?.text && (
              <p style={{ fontSize: 13, color: "#374151", lineHeight: 1.6, margin: 0 }}>{r.content.text}</p>
            )}
            {r.channel === "airbnb" && !r.content?.text && (
              <p style={{ fontSize: 13, color: "#94A3B8", fontStyle: "italic", margin: 0 }}>No written review</p>
            )}

            {/* Reply */}
            {r.reply && (
              <div style={{ marginTop: 10, padding: "10px 14px", background: "#F8FAFC", borderRadius: 8, borderLeft: "3px solid #4F46E5" }}>
                <div style={{ fontSize: 11, color: "#4F46E5", fontWeight: 600, marginBottom: 4 }}>Host Reply</div>
                <p style={{ fontSize: 12, color: "#374151", lineHeight: 1.5, margin: 0 }}>{r.reply}</p>
              </div>
            )}
          </motion.div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, marginTop: 20 }}>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            style={{ padding: "8px 16px", borderRadius: 8, border: "1.5px solid #E2E8F0", background: "white", cursor: page === 0 ? "not-allowed" : "pointer", color: "#64748B", fontSize: 13, fontWeight: 600, opacity: page === 0 ? 0.5 : 1 }}>
            ← Prev
          </button>
          <span style={{ fontSize: 13, color: "#64748B" }}>Page {page + 1} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
            style={{ padding: "8px 16px", borderRadius: 8, border: "1.5px solid #E2E8F0", background: "white", cursor: page >= totalPages - 1 ? "not-allowed" : "pointer", color: "#64748B", fontSize: 13, fontWeight: 600, opacity: page >= totalPages - 1 ? 0.5 : 1 }}>
            Next →
          </button>
        </div>
      )}
    </motion.div>
  );
}

// ─── Rooms Tab ────────────────────────────────────────────────────────────────

function RoomsTab({ roomStats, buildingStats }) {
  const availableBuildings = BUILDING_ORDER.filter(b => roomStats[b] && Object.keys(roomStats[b]).length > 0);
  const [selectedBuilding, setSelectedBuilding] = useState(null);

  useEffect(() => {
    if (availableBuildings.length > 0 && !selectedBuilding) {
      setSelectedBuilding(availableBuildings[0]);
    }
  }, [availableBuildings.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (availableBuildings.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "80px", color: "#94A3B8" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🏠</div>
        <div style={{ fontSize: 16, fontWeight: 600, color: "#64748B", marginBottom: 6 }}>No room-level data yet</div>
        <div style={{ fontSize: 13 }}>Airbnb room reviews will appear here after syncing.</div>
      </div>
    );
  }

  const rooms = selectedBuilding ? Object.entries(roomStats[selectedBuilding] || {}).sort((a, b) => b[1].avg - a[1].avg) : [];

  const barData = rooms.map(([room, data]) => ({
    room, avg: parseFloat(data.avg.toFixed(2)), count: data.count
  }));

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      {/* Building Selector */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {availableBuildings.map(b => {
          const active = selectedBuilding === b;
          const color = getBuildingColor(b);
          return (
            <button key={b} onClick={() => setSelectedBuilding(b)} style={{
              padding: "8px 16px", borderRadius: 10, border: `2px solid ${active ? color : "#E2E8F0"}`,
              background: active ? color : "white", color: active ? "white" : "#64748B",
              fontWeight: active ? 700 : 500, fontSize: 13, cursor: "pointer", transition: "all 0.2s"
            }}>
              {getBuildingEn(b)}
            </button>
          );
        })}
      </div>

      {selectedBuilding && (
        <>
          {/* Bar chart */}
          <div style={{ background: "white", borderRadius: 16, padding: "24px", marginBottom: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04)", border: "1px solid #F1F5F9" }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#1E293B", marginBottom: 4, letterSpacing: "-0.3px" }}>
              Room Ratings — {getBuildingEn(selectedBuilding)}
            </h3>
            <p style={{ fontSize: 12, color: "#94A3B8", marginBottom: 20 }}>Airbnb average score per room (0–5)</p>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={barData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" horizontal={false} />
                <XAxis type="number" domain={[3, 5]} tick={{ fontSize: 11, fill: "#94A3B8" }} />
                <YAxis type="category" dataKey="room" tick={{ fontSize: 12, fill: "#374151", fontWeight: 500 }} width={52} />
                <Tooltip formatter={(v, n) => [v, "Avg Score"]} contentStyle={{ borderRadius: 10, border: "1px solid #E2E8F0", fontSize: 12 }} />
                <Bar dataKey="avg" fill={getBuildingColor(selectedBuilding)} radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Room cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
            {rooms.map(([room, data], i) => (
              <motion.div key={room}
                initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.2, delay: i * 0.04 }}
                style={{
                  background: "white", borderRadius: 14, padding: "16px 18px",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.05)", border: "1px solid #F1F5F9"
                }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#1E293B" }}>{room}</span>
                  <ScoreBadge score={data.avg} max={5} size="sm" />
                </div>
                <div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 10 }}>{data.count} reviews</div>
                {AIRBNB_CATEGORIES.map(({ key, label }) => {
                  const catScore = data.catAvgs[key];
                  if (catScore === undefined) return null;
                  return <CategoryBar key={key} label={label} score={catScore} max={5} />;
                })}
              </motion.div>
            ))}
          </div>
        </>
      )}
    </motion.div>
  );
}

// ─── Unanswered Tab ───────────────────────────────────────────────────────────

function UnansweredTab({ reviews }) {
  const unanswered = useMemo(() =>
    reviews.filter(r => r.channel === "booking" && !r.hasReply && r.score > 0)
      .sort((a, b) => a.score - b.score),
    [reviews]
  );

  const byBuilding = useMemo(() => {
    const map = {};
    for (const r of unanswered) {
      if (!map[r.building]) map[r.building] = [];
      map[r.building].push(r);
    }
    return map;
  }, [unanswered]);

  if (unanswered.length === 0) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ textAlign: "center", padding: "80px", color: "#10B981" }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#1E293B", marginBottom: 8 }}>All Caught Up!</div>
        <div style={{ fontSize: 14, color: "#64748B" }}>No unanswered Booking.com reviews found.</div>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
        <div style={{ background: "white", borderRadius: 14, padding: "16px 22px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", border: "1px solid #F1F5F9", display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(239,68,68,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>💬</div>
          <div>
            <div style={{ fontSize: 28, fontWeight: 800, color: "#EF4444", letterSpacing: "-1px" }}>{unanswered.length}</div>
            <div style={{ fontSize: 12, color: "#94A3B8" }}>Reviews awaiting reply</div>
          </div>
        </div>
        <div style={{ background: "white", borderRadius: 14, padding: "16px 22px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", border: "1px solid #F1F5F9", display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(79,70,229,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>🏨</div>
          <div>
            <div style={{ fontSize: 28, fontWeight: 800, color: "#4F46E5", letterSpacing: "-1px" }}>{Object.keys(byBuilding).length}</div>
            <div style={{ fontSize: 12, color: "#94A3B8" }}>Properties affected</div>
          </div>
        </div>
        <div style={{ background: "white", borderRadius: 14, padding: "16px 22px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", border: "1px solid #F1F5F9", display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(245,158,11,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>⭐</div>
          <div>
            <div style={{ fontSize: 28, fontWeight: 800, color: "#F59E0B", letterSpacing: "-1px" }}>
              {unanswered.length ? (unanswered.reduce((s, r) => s + r.score, 0) / unanswered.length).toFixed(1) : "—"}
            </div>
            <div style={{ fontSize: 12, color: "#94A3B8" }}>Avg score (unanswered)</div>
          </div>
        </div>
      </div>

      {Object.entries(byBuilding).map(([building, buildingReviews]) => (
        <div key={building} style={{ background: "white", borderRadius: 16, padding: "20px 24px", marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.06)", border: "1px solid #F1F5F9" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: getBuildingColor(building) }} />
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#1E293B" }}>{getBuildingEn(building)}</h3>
            <span style={{ fontSize: 12, color: "#EF4444", fontWeight: 600 }}>{buildingReviews.length} unanswered</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {buildingReviews.map(r => (
              <div key={r.id || r.reviewId} style={{ display: "flex", gap: 16, padding: "12px 14px", background: "#FFF8F6", borderRadius: 10, border: "1px solid rgba(239,68,68,0.15)", alignItems: "flex-start" }}>
                <ScoreBadge score={r.score} size="sm" />
                <div style={{ flex: 1 }}>
                  {r.content?.positive && <p style={{ fontSize: 12, color: "#374151", margin: "0 0 4px" }}>👍 {r.content.positive}</p>}
                  {r.content?.negative && <p style={{ fontSize: 12, color: "#374151", margin: 0 }}>👎 {r.content.negative}</p>}
                  {!r.content?.positive && !r.content?.negative && <p style={{ fontSize: 12, color: "#94A3B8", fontStyle: "italic", margin: 0 }}>No written review</p>}
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  {r.reviewerName && <div style={{ fontSize: 11, color: "#64748B", fontWeight: 600 }}>{r.reviewerName}</div>}
                  {r.createdAt && <div style={{ fontSize: 11, color: "#94A3B8" }}>{formatDate(r.createdAt)}</div>}
                  {r.url && (
                    <a href={r.url} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 11, color: "#4F46E5", textDecoration: "none", fontWeight: 600 }}>
                      Reply ↗
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </motion.div>
  );
}

// ─── Channel Selector ─────────────────────────────────────────────────────────

function ChannelSelector({ channel, onChange, bookingCount, airbnbCount }) {
  const channels = [
    { id: "booking", label: "Booking.com", color: "#003580", bg: "rgba(0,53,128,0.08)", count: bookingCount },
    { id: "airbnb", label: "Airbnb", color: "#FF385C", bg: "rgba(255,56,92,0.08)", count: airbnbCount }
  ];
  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
      {channels.map(ch => {
        const active = channel === ch.id;
        return (
          <button key={ch.id} onClick={() => onChange(ch.id)} style={{
            display: "flex", alignItems: "center", gap: 10, padding: "12px 22px",
            borderRadius: 14, border: `2px solid ${active ? ch.color : "#E2E8F0"}`,
            background: active ? ch.color : "white", color: active ? "white" : "#374151",
            fontWeight: 700, fontSize: 14, cursor: "pointer", transition: "all 0.25s ease",
            boxShadow: active ? `0 4px 14px ${ch.color}30` : "0 1px 3px rgba(0,0,0,0.04)",
            transform: active ? "scale(1.02)" : "scale(1)"
          }}>
            {ch.label}
            <span style={{
              background: active ? "rgba(255,255,255,0.25)" : ch.bg,
              color: active ? "white" : ch.color,
              borderRadius: 999, fontSize: 11, fontWeight: 700, padding: "2px 8px"
            }}>
              {ch.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

// ─── Review Sync Modal ────────────────────────────────────────────────────────

const SYNC_YEARS = Array.from({ length: new Date().getFullYear() - 2020 + 3 }, (_, i) => 2021 + i);
const SYNC_MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const getDays = (y, m) => Array.from({ length: new Date(y, m, 0).getDate() }, (_, i) => i + 1);
const toStr = (y, m, d) => `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
const parseStr = (s) => { const [y,m,d] = s.split('-').map(Number); return {year:y,month:m,day:d}; };

function ReviewSyncDateDropdown({ label, value, onChange }) {
  const { year, month, day } = parseStr(value);
  const update = (y, m, d) => onChange(toStr(y, m, Math.min(d, new Date(y, m, 0).getDate())));
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", gap: 6 }}>
        <select value={year} onChange={e => update(Number(e.target.value), month, day)}
          style={{ flex: 1.4, padding: "9px 6px", border: "1.5px solid #E2E8F0", borderRadius: 9, fontSize: 13, color: "#1E293B", background: "#F8FAFC", outline: "none", cursor: "pointer" }}>
          {SYNC_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={month} onChange={e => update(year, Number(e.target.value), day)}
          style={{ flex: 1, padding: "9px 6px", border: "1.5px solid #E2E8F0", borderRadius: 9, fontSize: 13, color: "#1E293B", background: "#F8FAFC", outline: "none", cursor: "pointer" }}>
          {SYNC_MONTHS.map(m => <option key={m} value={m}>{String(m).padStart(2,'0')} · {MONTH_SHORT[m-1]}</option>)}
        </select>
        <select value={day} onChange={e => update(year, month, Number(e.target.value))}
          style={{ flex: 1, padding: "9px 6px", border: "1.5px solid #E2E8F0", borderRadius: 9, fontSize: 13, color: "#1E293B", background: "#F8FAFC", outline: "none", cursor: "pointer" }}>
          {getDays(year, month).map(d => <option key={d} value={d}>Day {d}</option>)}
        </select>
      </div>
    </div>
  );
}

function ReviewSyncModal({ isOpen, onClose, onDone, companyId }) {
  const today = new Date().toISOString().split('T')[0];
  const [fromDate, setFromDate] = useState('2022-01-01');
  const [toDate, setToDate] = useState(today);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleSync = async () => {
    setSyncing(true); setResult(null); setError(null);
    try {
      const res = await fetch(`${API_BASE}/syncReviewsManual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, fromDate, toDate })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Sync failed');
      setResult(data.synced);
      if (onDone) onDone();
    } catch (e) { setError(e.message); }
    setSyncing(false);
  };

  const handleClose = () => { if (syncing) return; setResult(null); setError(null); onClose(); };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={handleClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <motion.div initial={{ opacity: 0, y: 24, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.97 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
          onClick={e => e.stopPropagation()}
          style={{ background: "#fff", borderRadius: 20, width: "100%", maxWidth: 440, boxShadow: "0 24px 60px rgba(0,0,0,0.18)", overflow: "hidden" }}>

          {/* Header */}
          <div style={{ background: "linear-gradient(135deg, #1E293B 0%, #334155 100%)", padding: "24px 28px 20px", position: "relative" }}>
            <p style={{ fontSize: 19, fontWeight: 700, color: "#fff", margin: "0 0 3px", letterSpacing: "-0.3px" }}>Sync Reviews</p>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", margin: 0 }}>Select date range — Beds24 → Firestore</p>
            <button onClick={handleClose}
              style={{ position: "absolute", top: 18, right: 18, background: "rgba(255,255,255,0.12)", border: "none", borderRadius: "50%", width: 30, height: 30, color: "#fff", fontSize: 17, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
          </div>

          {/* Body */}
          <div style={{ padding: "22px 28px 28px", display: "flex", flexDirection: "column", gap: 14 }}>
            <ReviewSyncDateDropdown label="Start Date" value={fromDate} onChange={setFromDate} />
            <ReviewSyncDateDropdown label="End Date" value={toDate} onChange={setToDate} />

            <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 10, padding: "11px 14px", fontSize: 12, color: "#166534", lineHeight: 1.6 }}>
              ✅ Booking.com & Airbnb reviews will be fetched<br />
              ✅ Existing reviews will be updated
            </div>

            {syncing && (
              <div style={{ height: 4, background: "#E2E8F0", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ height: "100%", background: "linear-gradient(90deg, #4F46E5, #818CF8)", borderRadius: 4, animation: "progressPulse 1.5s ease-in-out infinite", width: "100%" }} />
              </div>
            )}

            {result !== null && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                style={{ background: "#F0FDF4", border: "1px solid #86EFAC", borderRadius: 12, padding: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#166534", marginBottom: 4 }}>✅ Sync Complete</div>
                <div style={{ fontSize: 13, color: "#166534", display: "flex", justifyContent: "space-between" }}>
                  <span>Reviews synced</span><strong>{result}</strong>
                </div>
              </motion.div>
            )}

            {error && (
              <div style={{ background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 10, padding: "11px 14px", fontSize: 12, color: "#9A3412" }}>
                ❌ {error}
              </div>
            )}

            <button onClick={handleSync} disabled={syncing}
              style={{ width: "100%", padding: 13, background: syncing ? "#94A3B8" : "linear-gradient(135deg, #4F46E5 0%, #6366F1 100%)", color: "#fff", border: "none", borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: syncing ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: syncing ? "none" : "0 4px 14px rgba(79,70,229,0.3)", transition: "all 0.2s", marginTop: 4 }}>
              {syncing ? <><span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span> Syncing...</> : <>↻ Start Sync</>}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export default function ReviewsDashboard() {
  const { companyId, userData } = useUser();
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState(null);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [activeChannel, setActiveChannel] = useState("booking");
  const [activeTab, setActiveTab] = useState("overview");
  const [lastSynced, setLastSynced] = useState(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [appliedFrom, setAppliedFrom] = useState("");
  const [appliedTo, setAppliedTo] = useState("");

  // 채널 변경 시 탭 리셋
  const handleChannelChange = (ch) => {
    setActiveChannel(ch);
    setActiveTab("overview");
  };

  // Load reviews from Firestore
  const loadReviews = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const snap = await getDocs(query(
        collection(db, "reviews"),
        where("companyId", "==", companyId)
      ));
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setReviews(data);

      let latest = null;
      for (const d of data) {
        const t = d.syncedAt?.toDate?.();
        if (t && (!latest || t > latest)) latest = t;
      }
      setLastSynced(latest);
    } catch (err) {
      console.error("[ReviewsDashboard] Firestore load error:", err);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { loadReviews(); }, [loadReviews]);

  // Manual sync
  const handleSync = async () => {
    if (syncing || !companyId) return;
    setSyncing(true);
    setSyncMsg(null);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 540000);
      const res = await fetch(`${API_BASE}/syncReviewsManual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const json = await res.json();
      if (json.success) {
        setSyncMsg(`✅ Synced ${json.synced} reviews`);
        await loadReviews();
      } else {
        setSyncMsg(`❌ Sync failed: ${json.error}`);
      }
    } catch (err) {
      if (err.name === "AbortError") {
        setSyncMsg("⏳ Sync is taking long — refreshing data...");
      } else {
        setSyncMsg(`❌ ${err.message}`);
      }
      await loadReviews();
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(null), 8000);
    }
  };

  // 기간 검색 방향: from > to이면 역순 (최신→과거)
  const dateSearchReversed = useMemo(() => {
    if (appliedFrom && appliedTo) return appliedFrom > appliedTo;
    return false;
  }, [appliedFrom, appliedTo]);

  const hasDateFilter = !!(appliedFrom || appliedTo);

  // 날짜 범위 필터링된 전체 리뷰
  const dateFilteredReviews = useMemo(() => {
    if (!appliedFrom && !appliedTo) return reviews;
    const minDate = appliedFrom && appliedTo ? (appliedFrom < appliedTo ? appliedFrom : appliedTo) : (appliedFrom || appliedTo);
    const maxDate = appliedFrom && appliedTo ? (appliedFrom > appliedTo ? appliedFrom : appliedTo) : (appliedFrom || appliedTo);
    return reviews.filter(r => {
      if (!r.createdAt) return false;
      const d = r.createdAt.substring(0, 10);
      return d >= minDate && d <= maxDate;
    });
  }, [reviews, appliedFrom, appliedTo]);

  const handleDateSearch = () => {
    setAppliedFrom(dateFrom);
    setAppliedTo(dateTo);
  };

  const handleDateClear = () => {
    setDateFrom("");
    setDateTo("");
    setAppliedFrom("");
    setAppliedTo("");
  };

  // 채널별 필터된 리뷰
  const channelReviews = useMemo(() => dateFilteredReviews.filter(r => r.channel === activeChannel), [dateFilteredReviews, activeChannel]);
  const bookingCount = dateFilteredReviews.filter(r => r.channel === "booking").length;
  const airbnbCount = dateFilteredReviews.filter(r => r.channel === "airbnb").length;

  // Computed data (채널별, 날짜 필터 적용)
  const buildingStats = useMemo(() => computeBuildingStats(dateFilteredReviews), [dateFilteredReviews]);
  const trendData = useMemo(() => computeTrendData(dateFilteredReviews), [dateFilteredReviews]);
  const weaknesses = useMemo(() => computeWeaknesses(buildingStats), [buildingStats]);
  const roomStats = useMemo(() => computeRoomStats(dateFilteredReviews), [dateFilteredReviews]);
  const unansweredCount = dateFilteredReviews.filter(r => r.channel === "booking" && !r.hasReply).length;

  // 채널별 탭 구성
  const BOOKING_TABS = [
    { id: "overview", label: "Overview" },
    { id: "trends", label: "Trends" },
    { id: "insights", label: "Insights" },
    { id: "reviews", label: "Reviews" },
    { id: "unanswered", label: "Unanswered", badge: unansweredCount },
  ];

  const AIRBNB_TABS = [
    { id: "overview", label: "Overview" },
    { id: "insights", label: "Insights" },
    { id: "reviews", label: "Reviews" },
    { id: "rooms", label: "Room Scores" },
  ];

  const TABS = activeChannel === "booking" ? BOOKING_TABS : AIRBNB_TABS;

  // ★ 임시: owner만 접근 가능 (기능 완료 후 제거)
  if (userData && userData.role !== 'owner') {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", padding: 40 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔧</div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: "#1E293B", margin: "0 0 8px 0" }}>Coming Soon</h2>
        <p style={{ fontSize: 14, color: "#94A3B8", textAlign: "center" }}>
          This feature is currently under development.<br />It will be available soon.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1200, margin: "0 auto" }}>
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "#1E293B", margin: 0, letterSpacing: "-0.8px" }}>
            Reviews & Ratings
          </h1>
          <p style={{ fontSize: 13, color: "#94A3B8", marginTop: 4 }}>
            {reviews.length > 0
              ? `${reviews.length} total reviews`
              : "No reviews cached yet — click Sync to load data"}
            {lastSynced && ` · Last synced ${lastSynced.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`}
          </p>
        </div>
        <button onClick={() => setSyncModalOpen(true)}
          style={{
            display: "flex", alignItems: "center", gap: 8, padding: "10px 20px",
            background: "#4F46E5", color: "white", border: "none",
            borderRadius: 10, fontWeight: 600, fontSize: 13, cursor: "pointer",
            boxShadow: "0 2px 8px rgba(79,70,229,0.3)",
            transition: "all 0.2s"
          }}>
          <span>↻</span>
          Sync Reviews
        </button>
      </motion.div>

      {/* Sync message */}
      <AnimatePresence>
        {syncMsg && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            style={{ background: syncMsg.startsWith("✅") ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)", border: `1px solid ${syncMsg.startsWith("✅") ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)"}`, borderRadius: 10, padding: "10px 16px", marginBottom: 16, fontSize: 13, fontWeight: 600, color: syncMsg.startsWith("✅") ? "#059669" : "#DC2626" }}>
            {syncMsg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Channel Selector */}
      <ChannelSelector channel={activeChannel} onChange={handleChannelChange} bookingCount={bookingCount} airbnbCount={airbnbCount} />

      {/* Date Range Filter */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12, marginBottom: 16,
        background: "white", borderRadius: 14, padding: "12px 20px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)", border: "1px solid #F1F5F9",
        flexWrap: "wrap"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#475569" }}>Period</span>
        </div>
        <DatePickerButton value={dateFrom} onChange={setDateFrom} placeholder="Start date" />
        <span style={{ fontSize: 13, color: "#94A3B8", fontWeight: 500 }}>→</span>
        <DatePickerButton value={dateTo} onChange={setDateTo} placeholder="End date" />
        <button onClick={handleDateSearch} disabled={!dateFrom && !dateTo}
          style={{
            padding: "7px 18px", borderRadius: 8, border: "none",
            background: (dateFrom || dateTo) ? "#4F46E5" : "#E2E8F0",
            color: (dateFrom || dateTo) ? "white" : "#94A3B8",
            fontSize: 13, fontWeight: 600, cursor: (dateFrom || dateTo) ? "pointer" : "not-allowed",
            transition: "all 0.2s",
            boxShadow: (dateFrom || dateTo) ? "0 2px 6px rgba(79,70,229,0.25)" : "none"
          }}>
          Search
        </button>
        {hasDateFilter && (
          <>
            <button onClick={handleDateClear}
              style={{
                padding: "7px 14px", borderRadius: 8, border: "1.5px solid #E2E8F0",
                background: "white", color: "#64748B", fontSize: 12, fontWeight: 600,
                cursor: "pointer", transition: "all 0.2s"
              }}>
              Clear
            </button>
            <span style={{ fontSize: 12, color: "#94A3B8" }}>
              {dateFilteredReviews.length} reviews found
              {dateSearchReversed && " · newest first"}
              {!dateSearchReversed && appliedFrom && appliedTo && " · oldest first"}
            </span>
          </>
        )}
      </div>

      {/* Tab Navigation */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24, background: "white", borderRadius: 14, padding: "6px 8px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", border: "1px solid #F1F5F9", overflowX: "auto" }}>
        {TABS.map(tab => (
          <TabButton key={tab.id} id={tab.id} label={tab.label} active={activeTab === tab.id} onClick={setActiveTab} badge={tab.badge} />
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} style={{ height: 120, background: "white", borderRadius: 16, border: "1px solid #F1F5F9", position: "relative", overflow: "hidden" }}>
              <div style={{
                position: "absolute", inset: 0,
                background: "linear-gradient(90deg, #F8FAFC 25%, #F1F5F9 50%, #F8FAFC 75%)",
                backgroundSize: "200% 100%",
                animation: "shimmer 1.5s infinite"
              }} />
            </div>
          ))}
        </div>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div key={`${activeChannel}-${activeTab}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
            {activeTab === "overview" && <OverviewTab buildingStats={buildingStats} reviews={channelReviews} channel={activeChannel} />}
            {activeTab === "trends" && activeChannel === "booking" && <TrendsTab trendData={trendData} buildingStats={buildingStats} />}
            {activeTab === "insights" && <InsightsTab weaknesses={weaknesses.filter(w => (activeChannel === "booking" ? w.channel === "Booking.com" : w.channel === "Airbnb"))} buildingStats={buildingStats} channel={activeChannel} />}
            {activeTab === "reviews" && <ReviewsTab reviews={channelReviews} channel={activeChannel} dateSearchReversed={dateSearchReversed} hasDateFilter={hasDateFilter} />}
            {activeTab === "rooms" && activeChannel === "airbnb" && <RoomsTab roomStats={roomStats} buildingStats={buildingStats} />}
            {activeTab === "unanswered" && activeChannel === "booking" && <UnansweredTab reviews={reviews} />}
          </motion.div>
        </AnimatePresence>
      )}

      <ReviewSyncModal isOpen={syncModalOpen} onClose={() => setSyncModalOpen(false)} onDone={loadReviews} companyId={companyId} />

      {/* Mobile styles */}
      <style>{`
        @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @media (max-width: 768px) {
          div[style*="grid-template-columns: repeat(4, 1fr)"] { grid-template-columns: repeat(2, 1fr) !important; }
          div[style*="grid-template-columns: 1fr 1fr"] { grid-template-columns: 1fr !important; }
          div[style*="padding: 28px 32px"] { padding: 16px !important; }
          div[style*="maxWidth: 1200"] { max-width: 100% !important; }
        }
      `}</style>
    </div>
  );
}
