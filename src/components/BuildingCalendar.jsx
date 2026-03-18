import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, getDocs, query, where, addDoc, writeBatch, doc } from "firebase/firestore";
import { useNavigate } from 'react-router-dom';
import { db, auth } from '../firebase';
import { useUser } from '../contexts/UserContext';
import dayjs from 'dayjs';
import axios from 'axios';

import { BUILDING_NAMES_EN as _BUILDING_NAMES_EN, BUILDING_ORDER, EXCLUDED_BUILDING_UI, ACTIVE_BUILDING_ORDER } from '../constants/buildingData';

// 건물·객실 데이터 (캘린더 전용 — 매출 분석용 객실명)
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

// 객실 ID 매핑 (Beds24 API용) - 백엔드와 동기화됨
const BUILDING_ROOMS = {
  "아라키초A": [
    { roomId: "383971", name: "201호" }, { roomId: "601545", name: "201호" },
    { roomId: "403542", name: "202호" }, { roomId: "601546", name: "202호" },
    { roomId: "383972", name: "301호" }, { roomId: "601547", name: "301호" },
    { roomId: "383978", name: "302호" }, { roomId: "601548", name: "302호" },
    { roomId: "440617", name: "401호" }, { roomId: "515300", name: "401호" },
    { roomId: "383974", name: "402호" }, { roomId: "601549", name: "402호" },
    { roomId: "383975", name: "501호" }, { roomId: "502229", name: "501호" },
    { roomId: "383976", name: "502호" }, { roomId: "601550", name: "502호" },
    { roomId: "537451", name: "602호" }, { roomId: "601551", name: "602호" },
    { roomId: "383973", name: "701호" }, { roomId: "601552", name: "701호" },
    { roomId: "383977", name: "702호" }, { roomId: "601553", name: "702호" }
  ],
  "아라키초B": [
    { roomId: "585734", name: "101호" }, { roomId: "585738", name: "102호" },
    { roomId: "585735", name: "201호" }, { roomId: "585739", name: "202호" },
    { roomId: "585736", name: "301호" }, { roomId: "585740", name: "302호" },
    { roomId: "585737", name: "401호" }, { roomId: "585741", name: "402호" }
  ],
  "다이쿄초": [
    { roomId: "440619", name: "B01호" }, { roomId: "440620", name: "B02호" },
    { roomId: "440621", name: "101호" }, { roomId: "440622", name: "102호" },
    { roomId: "440623", name: "201호" }, { roomId: "440624", name: "202호" },
    { roomId: "440625", name: "302호" }
  ],
  "가부키초": [
    { roomId: "383979", name: "202호" }, { roomId: "451220", name: "202호" },
    { roomId: "383980", name: "203호" }, { roomId: "452061", name: "203호" },
    { roomId: "383981", name: "302호" }, { roomId: "452062", name: "302호" },
    { roomId: "383982", name: "303호" }, { roomId: "451223", name: "303호" },
    { roomId: "383983", name: "402호" }, { roomId: "451224", name: "402호" },
    { roomId: "383984", name: "403호" }, { roomId: "452063", name: "403호" },
    { roomId: "543189", name: "502호" }, { roomId: "601560", name: "502호" },
    { roomId: "383985", name: "603호" }, { roomId: "452064", name: "603호" },
    { roomId: "441885", name: "802호" }, { roomId: "452065", name: "802호" },
    { roomId: "624198", name: "803호" }, { roomId: "648398", name: "803호" }
  ],
  "오쿠보A동": [{ roomId: "437952", name: "오쿠보A" }],
  "오쿠보B동": [{ roomId: "615969", name: "오쿠보B" }],
  "오쿠보C동": [{ roomId: "450096", name: "오쿠보C" }, { roomId: "496532", name: "오쿠보C" }, { roomId: "648399", name: "오쿠보C" }],
  "사노시": [{ roomId: "481152", name: "사노" }],
  "다카다노바바": [
    { roomId: "513698", name: "201호" }, { roomId: "513699", name: "301호" },
    { roomId: "513700", name: "401호" }, { roomId: "556719", name: "401호" },
    { roomId: "513701", name: "501호" }, { roomId: "513702", name: "601호" },
    { roomId: "513703", name: "701호" }, { roomId: "513704", name: "801호" },
    { roomId: "513705", name: "901호" }
  ]
};

// Firebase Functions API URL
const API_BASE_URL = "https://us-central1-my-booking-app-3f0e7.cloudfunctions.net";

// 비활성 어카운트 minStay 임계값 (50박 이상 = 닫힌 계정)
const INACTIVE_MINSTAY_THRESHOLD = 50;

// 가격 설정 모달 (고급 버전)
function PriceSettingModal({ building, room, selectedDates, roomPrices, onClose, onSave, selectedRooms, companyId }) {
  // 조정 모드: 'direct' (직접입력), 'percent' (퍼센트)
  const [adjustMode, setAdjustMode] = useState("direct");
  const [percentValue, setPercentValue] = useState("");
  const [priceAirbnb, setPriceAirbnb] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState(1); // 1: 입력, 2: 미리보기/확인

  // 선택된 셀(객실×날짜)의 실제 가격 정보 (평균 X, 실제 가격)
  const selectedPricesInfo = useMemo(() => {
    if (!selectedDates || !roomPrices) {
      return [];
    }

    const targetRooms = (selectedRooms && selectedRooms.length > 0) ? selectedRooms : [room];

    // 각 날짜별, 첫 번째 roomId(에어비앤비 채널)의 실제 가격
    return selectedDates.sort().map(dateStr => {
      const dateKey = dateStr.replace(/-/g, "");

      // 모든 선택 객실의 첫 번째 roomId에서 가격 수집
      const prices = [];
      targetRooms.forEach(targetRoom => {
        const firstRoomInfo = BUILDING_ROOMS[building]?.find(r => r.name === targetRoom);
        if (firstRoomInfo) {
          const priceData = roomPrices[firstRoomInfo.roomId]?.dates?.[dateKey];
          if (priceData) {
            const ap = parseFloat(priceData.p1) || 0;
            if (ap > 0) prices.push({ room: targetRoom, airbnb: ap, booking: parseFloat(priceData.p2) || 0 });
          }
        }
      });

      // 고유 가격 목록 (같은 가격의 방은 묶음)
      const uniquePrices = [...new Set(prices.map(p => p.airbnb))];
      // 대표 가격 = 첫 번째 방의 가격 (또는 없으면 0)
      const representativePrice = prices.length > 0 ? prices[0].airbnb : 0;
      const representativeBooking = prices.length > 0 ? prices[0].booking : 0;

      return {
        date: dateStr,
        dateDisplay: dateStr.slice(5),
        airbnbPrice: representativePrice,
        bookingPrice: representativeBooking,
        // 날짜별 상세 가격 (다른 가격이 있을 때 표시용)
        priceDetails: prices,
        hasMultiplePrices: uniquePrices.length > 1
      };
    });
  }, [selectedDates, roomPrices, building, room, selectedRooms]);

  // 평균 Airbnb 가격 (Screen 1용 - 모든 객실×날짜의 진짜 평균)
  const avgAirbnbPrice = useMemo(() => {
    // confirmDisplayData에서 모든 방×날짜의 실제 가격 평균
    const targetRooms = (selectedRooms && selectedRooms.length > 0) ? selectedRooms : [room];
    let totalPrice = 0;
    let count = 0;
    selectedDates.forEach(dateStr => {
      const dateKey = dateStr.replace(/-/g, "");
      targetRooms.forEach(targetRoom => {
        const firstRoomInfo = BUILDING_ROOMS[building]?.find(r => r.name === targetRoom);
        if (firstRoomInfo) {
          const priceData = roomPrices?.[firstRoomInfo.roomId]?.dates?.[dateKey];
          const ap = priceData ? (parseFloat(priceData.p1) || 0) : 0;
          if (ap > 0) {
            totalPrice += ap;
            count++;
          }
        }
      });
    });
    return count > 0 ? Math.round(totalPrice / count) : 0;
  }, [selectedDates, selectedRooms, room, building, roomPrices]);

  // 변경 후 가격 계산 (Airbnb만 - Booking은 자동 연동)
  const calculateNewPrices = useMemo(() => {
    if (adjustMode === "direct") {
      return selectedPricesInfo.map(p => ({
        ...p,
        newAirbnbPrice: priceAirbnb ? parseInt(priceAirbnb) : p.airbnbPrice
      }));
    } else {
      // 퍼센트 조정
      const pct = parseFloat(percentValue) || 0;
      const multiplier = 1 + (pct / 100);
      return selectedPricesInfo.map(p => ({
        ...p,
        newAirbnbPrice: Math.round((p.airbnbPrice || 0) * multiplier)
      }));
    }
  }, [adjustMode, percentValue, priceAirbnb, selectedPricesInfo]);

  // ★ Confirm 화면용: 각 객실 × 날짜별 실제 가격 (평균 X)
  const confirmDisplayData = useMemo(() => {
    const targetRooms = (selectedRooms && selectedRooms.length > 0) ? selectedRooms : [room];
    const rows = [];

    selectedDates.sort().forEach(dateStr => {
      const dateKey = dateStr.replace(/-/g, "");
      targetRooms.forEach(targetRoom => {
        const firstRoomInfo = BUILDING_ROOMS[building]?.find(r => r.name === targetRoom);
        if (firstRoomInfo) {
          const priceData = roomPrices?.[firstRoomInfo.roomId]?.dates?.[dateKey];
          const airbnbPrice = priceData ? (parseFloat(priceData.p1) || 0) : 0;
          const bookingPrice = priceData ? (parseFloat(priceData.p2) || 0) : 0;

          // 새 가격 계산
          let newPrice = airbnbPrice;
          if (adjustMode === "direct" && priceAirbnb) {
            newPrice = parseInt(priceAirbnb);
          } else if (adjustMode === "percent" && percentValue) {
            const pct = parseFloat(percentValue) || 0;
            newPrice = Math.round(airbnbPrice * (1 + pct / 100));
          }

          rows.push({
            room: targetRoom,
            roomDisplay: targetRoom.replace('호', ''),
            date: dateStr,
            dateDisplay: dateStr.slice(5),
            airbnbPrice,
            bookingPrice,
            newAirbnbPrice: newPrice
          });
        }
      });
    });

    return rows;
  }, [selectedDates, selectedRooms, room, building, roomPrices, adjustMode, priceAirbnb, percentValue]);

  // 변경 사항 있는지 확인
  const hasChanges = useMemo(() => {
    if (adjustMode === "direct") {
      return priceAirbnb && priceAirbnb.length > 0;
    }
    return percentValue && parseFloat(percentValue) !== 0;
  }, [adjustMode, priceAirbnb, percentValue]);

  // 퍼센트 빠른 선택 버튼
  const percentPresets = [-20, -10, -5, 5, 10, 20, 30];

  const handleSave = async () => {
    if (!hasChanges) {
      setError("Please enter a price to change");
      return;
    }

    setLoading(true);
    setError("");

    try {
      // ★ BULK UPDATE: 모든 변경 사항을 하나의 객체로 합침
      // 구조: datesData[dateStr] = { p1: ..., p3: ... }
      const datesData = {};

      calculateNewPrices.forEach(priceInfo => {
        const dateStr = priceInfo.date.replace(/-/g, "");
        datesData[dateStr] = {
          p1: parseInt(priceInfo.newAirbnbPrice),
          p3: parseInt(priceInfo.newAirbnbPrice)
        };
      });


      // 다중 객실 지원: selectedRooms 배열을 순회하지 않고, 서버에서 처리하거나?
      // 아, 서버는 단일 roomId를 받거나... 
      // 서버를 수정하지 않고 여기서 '여러 번' 보내는 건 again rate limit 이슈가 있음.
      // 하지만 'dates' 기능을 서버에 추가했으므로, 
      // 만약 roomId를 배열로 받는 기능을 서버에 추가하지 않았다면 -> roomId 별로 루프를 돌아야 함. (한 번에 dates 30개씩)
      // roomId 10개 * 1 request = 10 requests. 5분 60회니까 10회는 괜찮음! (날짜 루프를 없앴으니까)

      // 상위 컴포넌트에서 전달받은 selectedRooms 사용 (없으면 기본 roomId)
      // PriceSettingModal은 현재 selectedRooms을 props로 받지 않음. 추가 필요.
      // 임시로: 
      // const targetRooms = window.currentSelectedRooms || [roomId]; // Hacky prop passing or context needed.
      // -> Better: Pass selectedRooms to PriceSettingModal.

      const roomsToUpdate = (selectedRooms && selectedRooms.length > 0) ? selectedRooms : [room];

      // ★ API V2: 모든 roomId를 수집하여 1회 호출로 처리!
      const allRoomIds = [];
      roomsToUpdate.forEach(targetRoomName => {
        const targetRoomInfos = BUILDING_ROOMS[building]?.filter(r => r.name === targetRoomName) || [];
        targetRoomInfos.forEach(info => allRoomIds.push(info.roomId));
      });

      // 1회 API 호출로 모든 객실 처리
      const body = {
        companyId,
        building,
        roomIds: allRoomIds,
        dates: datesData
      };

      const response = await fetch(`${API_BASE_URL}/setRoomPrices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      // HTTP error check
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Server error (${response.status})`);
      }

      const result = await response.json();

      // 서버가 반환한 results 배열 사용 (없으면 호환성을 위해 생성)
      const results = result.results || allRoomIds.map(rid => ({
        roomId: rid,
        success: result.success,
        error: result.error
      }));

      // results 배열에서 성공/실패 여부 확인
      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;
      const allSuccess = failCount === 0 && result.success !== false;

      // ★ 스냅샷 데이터 생성 (날짜별 변경 전/후 가격)
      const priceSnapshot = calculateNewPrices.map(p => ({
        date: p.date,
        oldPrice: p.airbnbPrice || 0,
        newPrice: p.newAirbnbPrice || 0
      }));

      // 기간 정보 (정렬된 날짜의 첫 번째와 마지막)
      const sortedDates = selectedDates.sort();
      const dateFrom = sortedDates[0];
      const dateTo = sortedDates[sortedDates.length - 1];

      // 대표값 (평균 또는 단일값)
      const avgOldPrice = Math.round(priceSnapshot.reduce((sum, p) => sum + p.oldPrice, 0) / priceSnapshot.length);
      const avgNewPrice = Math.round(priceSnapshot.reduce((sum, p) => sum + p.newPrice, 0) / priceSnapshot.length);

      // ★ 로그 저장 (Firestore) - 스냅샷 포함
      try {

        // Firebase에 undefined/NaN 값이 전달되지 않도록 정리
        const sanitizedResults = results.map(r => ({
          room: r.room || r.roomId || "unknown",
          success: r.success === true,
          error: r.error || null
        }));

        // percentValue 안전 처리 (NaN 방지)
        let safePercentValue = null;
        if (adjustMode === "percent" && percentValue) {
          const parsed = parseFloat(percentValue);
          safePercentValue = isNaN(parsed) ? null : parsed;
        }

        const logData = {
          companyId: companyId || null,
          timestamp: new Date(),
          building: building || "unknown",
          rooms: roomsToUpdate || [],
          // 기간 정보
          dateFrom: dateFrom || null,
          dateTo: dateTo || null,
          totalDays: selectedDates.length || 0,
          // 스냅샷 (날짜별 상세)
          priceSnapshot: priceSnapshot || [],
          // 대표값 (호환성 유지)
          dates: datesData || {},
          oldPrice: isNaN(avgOldPrice) ? 0 : avgOldPrice,
          newPrice: isNaN(avgNewPrice) ? 0 : avgNewPrice,
          // 메타 정보
          success: allSuccess === true,
          errorMessage: allSuccess ? null : `${failCount} rooms failed: ${results.filter(r => !r.success).map(r => r.error || 'Unknown error').join(', ')}`,
          worker: auth.currentUser?.displayName || auth.currentUser?.email || "System (Admin)",
          workerEmail: auth.currentUser?.email || null,
          origin: "관리자 대시보드",
          adjustMode: adjustMode || "direct",
          percentValue: safePercentValue,
          details: sanitizedResults
        };

        await addDoc(collection(db, "price_change_logs"), logData);
      } catch (logErr) {
        console.error("Log save failed:", logErr);
      }

      if (allSuccess) {
        alert(`✓ Prices updated for ${roomsToUpdate.length} rooms!`);
        setTimeout(() => {
          onSave && onSave();
          onClose();
        }, 300);
      } else {
        const errorMsgs = results.filter(r => !r.success).map(r => {
          const roomId = r.roomId || r.room || "unknown";
          return `${roomId}: ${r.error || "Unknown error"}`;
        }).join("\n");
        setError(`Failed to update (${failCount} failed):\n${errorMsgs}`);
      }

    } catch (err) {
      setError("Connection failed: " + err.message);
      console.error("Price setting error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: "rgba(0,0,0,0.6)",
      backdropFilter: "blur(4px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 9999
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        maxWidth: "540px",
        width: "90%",
        maxHeight: "85vh",
        overflow: "hidden",
        background: "white",
        borderRadius: "20px",
        boxShadow: "0 25px 50px rgba(0,0,0,0.25)",
        display: "flex",
        flexDirection: "column"
      }}>
        {/* Header */}
        <div style={{ padding: "24px 24px 0", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h2 style={{ fontSize: "22px", fontWeight: "700", color: "#111827", margin: 0 }}>
              {step === 1 ? "Price Settings" : "Confirm Changes"}
            </h2>
            <p style={{ fontSize: "14px", color: "#6B7280", marginTop: "6px" }}>
              {getBuildingNameEN(building)} · {selectedRooms && selectedRooms.length > 1 ? `${selectedRooms.length} rooms` : getRoomNameEN(room)} · {selectedDates.length} days
            </p>
          </div>
          <button onClick={onClose} style={{
            width: "36px",
            height: "36px",
            borderRadius: "10px",
            border: "none",
            background: "#F3F4F6",
            cursor: "pointer",
            fontSize: "18px",
            color: "#6B7280"
          }}>×</button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {step === 1 ? (
            <>
              {/* Current Price Info */}
              <div style={{
                background: "linear-gradient(135deg, #FFF5F7 0%, #FFF0F3 100%)",
                borderRadius: "16px",
                padding: "20px",
                marginBottom: "24px",
                border: "1px solid #FECDD3"
              }}>
                <div style={{ fontSize: "12px", color: "#9CA3AF", marginBottom: "10px", fontWeight: "500" }}>
                  Current Airbnb Price (Beds24)
                </div>
                <div style={{ display: "flex", gap: "24px", flexWrap: "wrap", alignItems: "center" }}>
                  <div>
                    <span style={{ fontSize: "11px", color: "#FF385C", fontWeight: "600" }}>Airbnb</span>
                    <div style={{ fontSize: "28px", fontWeight: "800", color: "#FF385C" }}>
                      ¥{avgAirbnbPrice.toLocaleString()}
                    </div>
                  </div>
                  {selectedPricesInfo[0]?.bookingPrice > 0 && (
                    <div style={{ opacity: 0.7 }}>
                      <span style={{ fontSize: "11px", color: "#003580", fontWeight: "600" }}>Booking (Auto-sync)</span>
                      <div style={{ fontSize: "18px", fontWeight: "700", color: "#003580" }}>
                        ¥{Math.round(selectedPricesInfo.reduce((s, p) => s + p.bookingPrice, 0) / selectedPricesInfo.length).toLocaleString()}
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ fontSize: "12px", color: "#6B7280", marginTop: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
                  <span>💡</span> Booking.com price auto-syncs with Airbnb
                </div>
              </div>

              {/* Adjustment Mode */}
              <div style={{ marginBottom: "24px" }}>
                <div style={{ fontSize: "13px", fontWeight: "600", color: "#374151", marginBottom: "12px" }}>Adjustment Method</div>
                <div style={{ display: "flex", gap: "10px" }}>
                  <button
                    onClick={() => setAdjustMode("direct")}
                    style={{
                      flex: 1,
                      padding: "14px",
                      borderRadius: "12px",
                      border: adjustMode === "direct" ? "2px solid #3B82F6" : "1px solid #E5E7EB",
                      background: adjustMode === "direct" ? "linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)" : "white",
                      color: "#374151",
                      fontWeight: "600",
                      cursor: "pointer",
                      transition: "all 0.2s"
                    }}
                  >
                    💵 Direct Input
                  </button>
                  <button
                    onClick={() => setAdjustMode("percent")}
                    style={{
                      flex: 1,
                      padding: "14px",
                      borderRadius: "12px",
                      border: adjustMode === "percent" ? "2px solid #3B82F6" : "1px solid #E5E7EB",
                      background: adjustMode === "percent" ? "linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)" : "white",
                      color: "#374151",
                      fontWeight: "600",
                      cursor: "pointer",
                      transition: "all 0.2s"
                    }}
                  >
                    📊 Percentage
                  </button>
                </div>
              </div>

              {adjustMode === "direct" ? (
                /* Direct Input Mode */
                <div>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", fontWeight: "600", color: "#FF385C", marginBottom: "12px" }}>
                    <span style={{ width: "14px", height: "14px", borderRadius: "4px", background: "#FF385C" }}></span>
                    Airbnb Price (¥)
                  </label>
                  <input
                    type="number"
                    value={priceAirbnb}
                    onChange={(e) => setPriceAirbnb(e.target.value)}
                    placeholder={`Current: ¥${avgAirbnbPrice.toLocaleString()}`}
                    style={{
                      width: "100%",
                      padding: "18px 20px",
                      border: "2px solid #FF385C",
                      borderRadius: "14px",
                      fontSize: "20px",
                      fontWeight: "700",
                      outline: "none",
                      boxSizing: "border-box",
                      background: "#FFF5F7"
                    }}
                  />
                  <div style={{ fontSize: "12px", color: "#6B7280", marginTop: "10px", textAlign: "center" }}>
                    Booking.com price will auto-sync
                  </div>
                </div>
              ) : (
                /* Percentage Mode */
                <div>
                  <div style={{ fontSize: "13px", fontWeight: "600", color: "#374151", marginBottom: "12px" }}>
                    Select Adjustment Rate
                  </div>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" }}>
                    {percentPresets.map(pct => (
                      <button
                        key={pct}
                        onClick={() => setPercentValue(String(pct))}
                        style={{
                          padding: "10px 16px",
                          borderRadius: "10px",
                          border: percentValue === String(pct) ? "2px solid #3B82F6" : "1px solid #E5E7EB",
                          background: percentValue === String(pct) ? "#EFF6FF" : "white",
                          color: pct > 0 ? "#10B981" : pct < 0 ? "#EF4444" : "#374151",
                          fontWeight: "700",
                          fontSize: "14px",
                          cursor: "pointer",
                          transition: "all 0.2s"
                        }}
                      >
                        {pct > 0 ? `+${pct}%` : `${pct}%`}
                      </button>
                    ))}
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", color: "#6B7280", marginBottom: "8px" }}>
                      Or enter custom (%)
                    </label>
                    <input
                      type="number"
                      value={percentValue}
                      onChange={(e) => setPercentValue(e.target.value)}
                      placeholder="e.g. -15 or 25"
                      style={{
                        width: "100%",
                        padding: "14px 16px",
                        border: "1px solid #E5E7EB",
                        borderRadius: "12px",
                        fontSize: "16px",
                        outline: "none",
                        boxSizing: "border-box"
                      }}
                    />
                  </div>
                  {percentValue && (
                    <div style={{
                      marginTop: "16px",
                      padding: "16px",
                      background: parseFloat(percentValue) > 0 ? "#ECFDF5" : "#FEF2F2",
                      borderRadius: "12px",
                      fontSize: "15px",
                      textAlign: "center",
                      border: parseFloat(percentValue) > 0 ? "1px solid #A7F3D0" : "1px solid #FECACA"
                    }}>
                      Airbnb ¥{avgAirbnbPrice.toLocaleString()} → <strong style={{ fontSize: "18px" }}>¥{Math.round(avgAirbnbPrice * (1 + parseFloat(percentValue) / 100)).toLocaleString()}</strong>
                      <span style={{ marginLeft: "10px", color: parseFloat(percentValue) > 0 ? "#10B981" : "#EF4444", fontWeight: "700" }}>
                        ({parseFloat(percentValue) > 0 ? "+" : ""}{percentValue}%)
                      </span>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            /* Step 2: Preview & Confirm */
            <>
              <div style={{
                background: "linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%)",
                borderRadius: "14px",
                padding: "16px 20px",
                marginBottom: "20px",
                display: "flex",
                alignItems: "center",
                gap: "12px",
                border: "1px solid #FCD34D"
              }}>
                <span style={{ fontSize: "24px" }}>⚠️</span>
                <div style={{ fontSize: "14px", color: "#92400E" }}>
                  <strong>Changes will apply to Beds24 immediately.</strong><br />
                  Please review before confirming.
                </div>
              </div>

              <div style={{ maxHeight: "350px", overflowY: "auto", marginBottom: "20px", borderRadius: "12px", border: "1px solid #E5E7EB" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ background: "#F9FAFB", position: "sticky", top: 0, zIndex: 1 }}>
                      <th style={{ padding: "10px 10px", textAlign: "left", borderBottom: "1px solid #E5E7EB", fontWeight: "600", fontSize: "12px" }}>Room</th>
                      <th style={{ padding: "10px 10px", textAlign: "left", borderBottom: "1px solid #E5E7EB", fontWeight: "600", fontSize: "12px" }}>Date</th>
                      <th style={{ padding: "10px 10px", textAlign: "right", borderBottom: "1px solid #E5E7EB", color: "#6B7280", fontWeight: "600", fontSize: "12px" }}>Current</th>
                      <th style={{ padding: "10px 4px", textAlign: "center", borderBottom: "1px solid #E5E7EB", fontSize: "12px" }}>→</th>
                      <th style={{ padding: "10px 10px", textAlign: "right", borderBottom: "1px solid #E5E7EB", color: "#FF385C", fontWeight: "600", fontSize: "12px" }}>New</th>
                    </tr>
                  </thead>
                  <tbody>
                    {confirmDisplayData.map((p, idx) => {
                      // 같은 날짜의 첫 번째 행에만 날짜 표시
                      const isFirstOfDate = idx === 0 || confirmDisplayData[idx - 1].date !== p.date;
                      return (
                        <tr key={idx} style={{ borderBottom: "1px solid #F3F4F6", background: isFirstOfDate ? "#FAFBFC" : "white" }}>
                          <td style={{ padding: "8px 10px", fontWeight: "500", color: "#374151", fontSize: "12px" }}>{p.roomDisplay}</td>
                          <td style={{ padding: "8px 10px", fontWeight: isFirstOfDate ? "600" : "400", color: isFirstOfDate ? "#111827" : "#9CA3AF", fontSize: "12px" }}>{isFirstOfDate ? p.dateDisplay : ""}</td>
                          <td style={{ padding: "8px 10px", textAlign: "right", color: "#9CA3AF" }}>
                            ¥{(p.airbnbPrice || 0).toLocaleString()}
                          </td>
                          <td style={{ padding: "8px 4px", textAlign: "center", color: "#D1D5DB" }}>→</td>
                          <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: "700", color: p.newAirbnbPrice !== p.airbnbPrice ? "#FF385C" : "#374151" }}>
                            {p.newAirbnbPrice === -1 ? (
                              <span style={{ color: "#3B82F6", fontSize: "12px" }}>↺ Reset</span>
                            ) : (
                              <>
                                ¥{(p.newAirbnbPrice || 0).toLocaleString()}
                                {p.newAirbnbPrice !== p.airbnbPrice && p.airbnbPrice > 0 && (
                                  <span style={{ fontSize: "10px", color: p.newAirbnbPrice > p.airbnbPrice ? "#10B981" : "#EF4444", marginLeft: "4px" }}>
                                    {p.newAirbnbPrice > p.airbnbPrice ? "+" : ""}{Math.round((p.newAirbnbPrice - p.airbnbPrice) / p.airbnbPrice * 100)}%
                                  </span>
                                )}
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div style={{
                background: "linear-gradient(135deg, #FFF5F7 0%, #FFF0F3 100%)",
                borderRadius: "14px",
                padding: "18px",
                textAlign: "center",
                border: "1px solid #FECDD3"
              }}>
                <div style={{ fontSize: "13px", color: "#FF385C", marginBottom: "6px", fontWeight: "500" }}>Price Change Summary</div>
                <div style={{ fontSize: "24px", fontWeight: "800", color: "#FF385C" }}>
                  {confirmDisplayData.filter(p => p.newAirbnbPrice !== p.airbnbPrice).length} cells
                </div>
                <div style={{ fontSize: "12px", color: "#6B7280", marginTop: "4px" }}>
                  {selectedDates.length} days × {(selectedRooms && selectedRooms.length > 0) ? selectedRooms.length : 1} rooms
                </div>
                <div style={{ fontSize: "12px", color: "#6B7280", marginTop: "4px" }}>
                  Booking.com will auto-sync
                </div>
              </div>
            </>
          )}

          {/* Error Message */}
          {error && (
            <div style={{
              marginTop: "20px",
              padding: "14px",
              background: "#FEF2F2",
              borderRadius: "12px",
              color: "#EF4444",
              fontSize: "14px",
              textAlign: "center",
              border: "1px solid #FECACA"
            }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer Buttons */}
        <div style={{ padding: "20px 24px", borderTop: "1px solid #E5E7EB", display: "flex", gap: "12px" }}>
          {step === 1 ? (
            <>
              <button
                onClick={onClose}
                style={{
                  flex: 1,
                  padding: "14px",
                  background: "#F3F4F6",
                  color: "#374151",
                  border: "none",
                  borderRadius: "12px",
                  fontSize: "15px",
                  fontWeight: "600",
                  cursor: "pointer"
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setPriceAirbnb("-1");
                  setAdjustMode("direct");
                  setTimeout(() => setStep(2), 100);
                }}
                disabled={!selectedDates.length}
                style={{
                  padding: "14px 20px",
                  background: "#EF4444",
                  color: "white",
                  border: "none",
                  borderRadius: "12px",
                  fontSize: "15px",
                  fontWeight: "600",
                  cursor: "pointer"
                }}
              >
                Reset
              </button>
              <button
                onClick={() => hasChanges && setStep(2)}
                disabled={!hasChanges}
                style={{
                  flex: 2,
                  padding: "14px",
                  background: hasChanges ? "linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)" : "#D1D5DB",
                  color: "white",
                  border: "none",
                  borderRadius: "12px",
                  fontSize: "15px",
                  fontWeight: "600",
                  cursor: hasChanges ? "pointer" : "not-allowed",
                  boxShadow: hasChanges ? "0 4px 12px rgba(59, 130, 246, 0.3)" : "none"
                }}
              >
                Preview →
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setStep(1)}
                disabled={loading}
                style={{
                  flex: 1,
                  padding: "14px",
                  background: "#F3F4F6",
                  color: "#374151",
                  border: "none",
                  borderRadius: "12px",
                  fontSize: "15px",
                  fontWeight: "600",
                  cursor: loading ? "not-allowed" : "pointer"
                }}
              >
                ← Edit
              </button>
              <button
                onClick={handleSave}
                disabled={loading}
                style={{
                  flex: 2,
                  padding: "14px",
                  background: loading ? "#9CA3AF" : "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)",
                  color: "white",
                  border: "none",
                  borderRadius: "12px",
                  fontSize: "15px",
                  fontWeight: "700",
                  cursor: loading ? "not-allowed" : "pointer",
                  boxShadow: loading ? "none" : "0 4px 12px rgba(245, 158, 11, 0.3)"
                }}
              >
                {loading ? "Saving..." : "Apply to Beds24"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// 건물명 영어 매핑 (캘린더 전용 확장 — "전체" 포함)
const BUILDING_NAMES_EN = { ..._BUILDING_NAMES_EN, "전체": "All Properties" };

// 화면에서 제외할 건물 (다이쿄초 항상 숨김)
const isBuildingSold = (building) => building === EXCLUDED_BUILDING_UI;

// 영어 건물명 가져오기 함수
const getBuildingNameEN = (koreanName) => BUILDING_NAMES_EN[koreanName] || koreanName;

// 객실 호수 영어 변환 함수 (201호 -> Room 201)
const getRoomNameEN = (roomName) => {
  if (!roomName) return roomName;
  // "201호" -> "Room 201", "B01호" -> "Room B01", "오쿠보A" -> "Okubo A"
  if (roomName.endsWith('호')) {
    return `Room ${roomName.replace('호', '')}`;
  }
  // 오쿠보, 사노 등 특수 케이스
  const specialRooms = {
    "오쿠보A": "Okubo A",
    "오쿠보B": "Okubo B",
    "오쿠보C": "Okubo C",
    "사노": "Sano"
  };
  return specialRooms[roomName] || roomName;
};

// 플랫폼 이니셜
const getPlatformInitial = (platform) => {
  if (!platform) return '?';
  const p = platform.toLowerCase();
  if (p.includes('airbnb')) return 'A';
  if (p.includes('booking')) return 'B';
  if (p.includes('expedia')) return 'E';
  if (p.includes('agoda')) return 'Ag';
  if (p.includes('direct')) return 'D';
  return platform.charAt(0).toUpperCase();
};

// 플랫폼별 색상
const PLATFORM_COLORS = {
  "Airbnb": "#FF1F5A",
  "Booking": "#0054C8",
  "Expedia": "#FFC400",
  "Agoda": "#FF3B2E",
  "Direct": "#00C2F0",
  "default": "#6C6C70"
};

const getPlatformColor = (platform) => {
  if (!platform) return PLATFORM_COLORS.default;
  const p = platform.toLowerCase();
  if (p.includes("airbnb")) return PLATFORM_COLORS.Airbnb;
  if (p.includes("booking")) return PLATFORM_COLORS.Booking;
  if (p.includes("expedia")) return PLATFORM_COLORS.Expedia;
  if (p.includes("agoda")) return PLATFORM_COLORS.Agoda;
  if (p.includes("direct")) return PLATFORM_COLORS.Direct;  // 수기 예약
  return PLATFORM_COLORS.default;
};

// 날짜 유틸리티
const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
const formatPrice = (price) => {
  if (!price) return "¥0";
  const num = parseFloat(String(price).replace(/[^0-9.-]+/g, ""));
  if (isNaN(num)) return "¥0";
  return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 }).format(num);
};

// 예약 상세 모달 보조 컴포넌트 (포커스 유지를 위해 외부에 정의)
const InfoRow = ({ label, value, icon, field, isEditing, editData, setEditData }) => (
  <div style={{
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 0",
    borderBottom: "1px solid #F2F2F7"
  }}>
    <span style={{ color: "#86868B", fontSize: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
      <span>{icon}</span> {label}
    </span>
    {isEditing && field ? (
      <input
        type={field.includes('Date') || field.includes('arrival') || field.includes('departure') ? 'date' : (field.includes('price') || field.includes('totalPrice') || field.includes('num') ? 'number' : 'text')}
        value={editData[field] ?? ""}
        onChange={(e) => setEditData({ ...editData, [field]: e.target.value })}
        style={{
          border: "1px solid #0071E3",
          borderRadius: "4px",
          padding: "4px 8px",
          fontSize: "14px",
          width: "50%",
          textAlign: "right"
        }}
      />
    ) : (
      <span style={{ fontWeight: "600", fontSize: "14px", color: (value !== undefined && value !== null && value !== "") ? "#1D1D1F" : "#CCC", maxWidth: "55%", textAlign: "right", wordBreak: "break-word" }}>
        {(value !== undefined && value !== null && value !== "") ? value : "No info"}
      </span>
    )}
  </div>
);

// 예약 상세 모달
function ReservationDetailModal({ reservation, onClose, onRefresh, isMobile }) {
  const [isEditing, setIsEditing] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const [editData, setEditData] = useState({
    ...reservation,
    // 금액 필드가 totalPrice나 price에 흩어져 있을 수 있으므로 초기화 시 확인
    totalPrice: reservation.totalPrice ?? reservation.price ?? ""
  });
  const [loading, setLoading] = useState(false);

  if (!reservation) return null;

  const handleUpdate = async () => {
    setLoading(true);
    try {
      // 묶인 객실들 찾기
      const targetRoomInfos = BUILDING_ROOMS[reservation.building]?.filter(r => r.name === reservation.room) || [];

      // 현재 예약과 같은 기간/방이름을 가진 다른 계정 예약들도 찾아서 같이 업데이트?
      // 우선 현재 bookId에 대해서는 확실히 업데이트
      const updatePayload = {
        bookId: reservation.bookId,
        building: reservation.building,
        guestName: editData.guestName,
        price: String(editData.totalPrice || "0"),
        numAdult: parseInt(editData.numAdult) || 1,
        numChild: parseInt(editData.numChild) || 0,
        arrival: editData.arrival,
        departure: editData.departure,
        guestEmail: editData.guestEmail,
        guestPhone: editData.guestPhone,
        guestComments: editData.guestComments
      };

      const response = await axios.post(`${API_BASE_URL}/updateBooking`, updatePayload);

      if (response.data.success) {
        alert("Successfully updated!");
        onClose();
        if (onRefresh) onRefresh();
      } else {
        throw new Error(response.data.error || "Update failed");
      }
    } catch (err) {
      alert("Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const platformColor = getPlatformColor(reservation.platform || reservation.channel);

  // 모바일: 컴팩트 Bottom Sheet
  if (isMobile && !showFull) {
    const nights = reservation.nights || (() => {
      const arr = reservation.arrival ? new Date(reservation.arrival) : null;
      const dep = reservation.departure ? new Date(reservation.departure) : null;
      return arr && dep ? Math.round((dep - arr) / 86400000) : 0;
    })();
    return (
      <div onClick={onClose} style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.45)", backdropFilter: "blur(3px)",
        zIndex: 9999, display: "flex", alignItems: "flex-end",
      }}>
        <div onClick={(e) => e.stopPropagation()} style={{
          width: "100%", background: "#fff",
          borderRadius: "20px 20px 0 0",
          boxShadow: "0 -8px 32px rgba(0,0,0,0.18)",
          padding: "0 0 34px",
          maxHeight: "55vh", display: "flex", flexDirection: "column",
        }}>
          {/* 드래그 핸들 */}
          <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 6px" }}>
            <div style={{ width: "36px", height: "4px", borderRadius: "2px", background: "#D1D1D6" }} />
          </div>

          {/* 상단: 플랫폼 뱃지 + 이름 + 닫기 */}
          <div style={{ display: "flex", alignItems: "center", padding: "4px 20px 14px", gap: "10px" }}>
            <div style={{
              background: platformColor, color: "#fff",
              fontSize: "12px", fontWeight: "800",
              padding: "4px 10px", borderRadius: "8px", letterSpacing: "0.5px",
            }}>{getPlatformInitial(reservation.channel || reservation.platform)}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "17px", fontWeight: "700", color: "#1C1C1E" }}>
                {reservation.guestName || "(No Name)"}
              </div>
              <div style={{ fontSize: "12px", color: "#8E8E93", marginTop: "1px" }}>
                {getBuildingNameEN(reservation.building)} · {getRoomNameEN(reservation.room)}
              </div>
            </div>
            <button onClick={onClose} style={{
              width: "30px", height: "30px", borderRadius: "50%",
              border: "none", background: "#F2F2F7",
              fontSize: "16px", color: "#8E8E93", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>×</button>
          </div>

          {/* 핵심 정보 카드 3개 */}
          <div style={{ display: "flex", gap: "10px", padding: "0 20px 16px" }}>
            <div style={{ flex: 1, background: "#F2F2F7", borderRadius: "12px", padding: "12px 10px", textAlign: "center" }}>
              <div style={{ fontSize: "10px", color: "#8E8E93", fontWeight: "500", marginBottom: "4px" }}>CHECK-IN</div>
              <div style={{ fontSize: "13px", fontWeight: "700", color: "#1C1C1E" }}>
                {reservation.arrival ? dayjs(reservation.arrival).format("MMM D") : "-"}
              </div>
            </div>
            <div style={{ flex: 1, background: "#F2F2F7", borderRadius: "12px", padding: "12px 10px", textAlign: "center" }}>
              <div style={{ fontSize: "10px", color: "#8E8E93", fontWeight: "500", marginBottom: "4px" }}>CHECK-OUT</div>
              <div style={{ fontSize: "13px", fontWeight: "700", color: "#1C1C1E" }}>
                {reservation.departure ? dayjs(reservation.departure).format("MMM D") : "-"}
              </div>
            </div>
            <div style={{ flex: 1, background: "#F2F2F7", borderRadius: "12px", padding: "12px 10px", textAlign: "center" }}>
              <div style={{ fontSize: "10px", color: "#8E8E93", fontWeight: "500", marginBottom: "4px" }}>NIGHTS</div>
              <div style={{ fontSize: "13px", fontWeight: "700", color: "#1C1C1E" }}>{nights || "-"}</div>
            </div>
          </div>

          {/* 금액 + 인원 */}
          <div style={{ display: "flex", alignItems: "center", padding: "0 20px 16px", gap: "12px" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "11px", color: "#8E8E93", fontWeight: "500" }}>TOTAL</div>
              <div style={{ fontSize: "20px", fontWeight: "800", color: "#1C1C1E", marginTop: "2px" }}>
                {formatPrice(reservation.totalPrice || reservation.price)}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "11px", color: "#8E8E93", fontWeight: "500" }}>GUESTS</div>
              <div style={{ fontSize: "14px", fontWeight: "600", color: "#1C1C1E", marginTop: "2px" }}>
                {(reservation.numAdult || 0)} adults{(reservation.numChild || 0) > 0 ? ` · ${reservation.numChild} children` : ""}
              </div>
            </div>
          </div>

          {/* 전체 상세 보기 버튼 */}
          <div style={{ padding: "0 20px" }}>
            <button onClick={() => setShowFull(true)} style={{
              width: "100%", padding: "13px",
              background: "#1C1C1E", color: "#fff",
              border: "none", borderRadius: "13px",
              fontSize: "15px", fontWeight: "600", cursor: "pointer",
            }}>View Full Details</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose} style={{
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: "rgba(0,0,0,0.6)",
      backdropFilter: "blur(4px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 9999
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        maxWidth: "500px",
        width: "90%",
        background: "white",
        borderRadius: "20px",
        boxShadow: "0 25px 50px rgba(0,0,0,0.25)",
        maxHeight: "90vh",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column"
      }}>
        {/* Header */}
        <div style={{
          padding: "24px 24px 0",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start"
        }}>
          <div>
            <h2 style={{ fontSize: "22px", fontWeight: "700", color: "#111827", margin: 0 }}>
              Reservation Details
            </h2>
            <p style={{ fontSize: "14px", color: "#6B7280", marginTop: "6px" }}>
              {getBuildingNameEN(reservation.building)} · {getRoomNameEN(reservation.room)}
            </p>
          </div>
          <button onClick={onClose} style={{
            width: "36px",
            height: "36px",
            borderRadius: "10px",
            border: "none",
            background: "#F3F4F6",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "18px",
            color: "#6B7280"
          }}>×</button>
        </div>

        {/* Guest Header Card */}
        <div style={{
          margin: "20px 24px",
          background: `linear-gradient(135deg, ${platformColor} 0%, ${platformColor}DD 100%)`,
          borderRadius: "16px",
          padding: "20px",
          color: "white",
          boxShadow: `0 8px 20px ${platformColor}40`
        }}>
          <div style={{ fontSize: "20px", fontWeight: "700", marginBottom: "10px" }}>
            {isEditing ? (
              <input
                value={editData.guestName}
                onChange={(e) => setEditData({ ...editData, guestName: e.target.value })}
                style={{ background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.5)", color: "white", borderRadius: "8px", padding: "6px 12px", width: "100%", fontSize: "18px" }}
              />
            ) : (
              reservation.guestName || "(No Name)"
            )}
          </div>
          <div style={{ display: "flex", gap: "14px", fontSize: "13px", opacity: "0.95", flexWrap: "wrap", alignItems: "center" }}>
            <span>{isEditing ? editData.numAdult : reservation.numAdult || 0} Adults</span>
            <span>{isEditing ? editData.numChild : reservation.numChild || 0} Children</span>
            <span style={{
              background: "rgba(255,255,255,0.25)",
              padding: "4px 10px",
              borderRadius: "6px",
              fontWeight: "600"
            }}>
              {reservation.platform || "Unknown"}
            </span>
          </div>
        </div>

        {/* Detail Info */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 24px" }}>
          <InfoRow icon="📧" label="Email" value={isEditing ? editData.guestEmail : reservation.guestEmail} field="guestEmail" isEditing={isEditing} editData={editData} setEditData={setEditData} />
          <InfoRow icon="📞" label="Phone" value={isEditing ? editData.guestPhone : reservation.guestPhone} field="guestPhone" isEditing={isEditing} editData={editData} setEditData={setEditData} />
          <InfoRow icon="🌍" label="Country" value={reservation.guestCountry} isEditing={isEditing} editData={editData} setEditData={setEditData} />
          <InfoRow icon="🕐" label="Est. Arrival" value={reservation.arrivalTime} isEditing={isEditing} editData={editData} setEditData={setEditData} />

          <div style={{ height: "12px" }} />

          <InfoRow icon="📅" label="Check-in" value={isEditing ? editData.arrival : reservation.arrival} field="arrival" isEditing={isEditing} editData={editData} setEditData={setEditData} />
          <InfoRow icon="📅" label="Check-out" value={isEditing ? editData.departure : reservation.departure} field="departure" isEditing={isEditing} editData={editData} setEditData={setEditData} />
          <InfoRow icon="🌙" label="Nights" value={reservation.nights ? `${reservation.nights} nights` : ""} isEditing={isEditing} editData={editData} setEditData={setEditData} />

          <div style={{ height: "12px" }} />

          <InfoRow icon="👥" label="Adults" value={isEditing ? editData.numAdult : reservation.numAdult} field="numAdult" isEditing={isEditing} editData={editData} setEditData={setEditData} />
          <InfoRow icon="👶" label="Children" value={isEditing ? editData.numChild : reservation.numChild} field="numChild" isEditing={isEditing} editData={editData} setEditData={setEditData} />

          <div style={{ height: "12px" }} />

          <InfoRow icon="🏷️" label="Booking Ref." value={reservation.apiReference} isEditing={isEditing} editData={editData} setEditData={setEditData} />

          <div style={{ height: "12px" }} />

          <InfoRow icon="💰" label="Total" value={formatPrice(isEditing ? editData.totalPrice : (reservation.totalPrice || reservation.price))} field="totalPrice" isEditing={isEditing} editData={editData} setEditData={setEditData} />
          {reservation.nights > 0 && (
            <InfoRow
              icon="🌙"
              label="Per Night"
              value={formatPrice(Math.round((parseFloat(String(isEditing ? editData.totalPrice : (reservation.totalPrice || reservation.price)).replace(/[^0-9.-]+/g, "")) || 0) / reservation.nights))}
              isEditing={isEditing} editData={editData} setEditData={setEditData}
            />
          )}
          <InfoRow icon="💸" label="OTA Fee" value={formatPrice(reservation.commission)} isEditing={isEditing} editData={editData} setEditData={setEditData} />
          <InfoRow icon="💵" label="Net Revenue" value={formatPrice(reservation.netRevenue)} isEditing={isEditing} editData={editData} setEditData={setEditData} />

          {/* Guest Comments */}
          <div style={{ marginTop: "16px", paddingBottom: "16px" }}>
            <div style={{ color: "#6B7280", fontSize: "14px", marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px", fontWeight: "500" }}>
              <span>💬</span> Notes & Requests
            </div>
            {isEditing ? (
              <textarea
                value={editData.guestComments || ""}
                onChange={(e) => setEditData({ ...editData, guestComments: e.target.value })}
                style={{
                  width: "100%",
                  height: "80px",
                  border: "2px solid #3B82F6",
                  borderRadius: "12px",
                  padding: "12px",
                  fontSize: "14px",
                  boxSizing: "border-box",
                  outline: "none"
                }}
              />
            ) : (
              reservation.guestComments && (
                <div style={{
                  background: "#F9FAFB",
                  padding: "14px",
                  borderRadius: "12px",
                  fontSize: "14px",
                  color: "#374151",
                  lineHeight: "1.5",
                  border: "1px solid #E5E7EB"
                }}>
                  {reservation.guestComments}
                </div>
              )
            )}
          </div>
        </div>

        {/* Button Section */}
        <div style={{ padding: "20px 24px", borderTop: "1px solid #E5E7EB", display: "flex", flexDirection: "column", gap: "10px" }}>
          {!isEditing ? (
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={onClose}
                style={{
                  flex: 1,
                  padding: "14px",
                  background: "#F3F4F6",
                  color: "#374151",
                  border: "none",
                  borderRadius: "12px",
                  fontSize: "15px",
                  fontWeight: "600",
                  cursor: "pointer",
                  transition: "all 0.2s"
                }}
              >
                Close
              </button>
              <button
                onClick={() => setIsEditing(true)}
                style={{
                  flex: 2,
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
                Edit Details
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={() => setIsEditing(false)}
                style={{
                  flex: 1,
                  padding: "14px",
                  background: "#F3F4F6",
                  color: "#374151",
                  border: "none",
                  borderRadius: "12px",
                  fontSize: "15px",
                  fontWeight: "600",
                  cursor: "pointer"
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleUpdate}
                disabled={loading}
                style={{
                  flex: 2,
                  padding: "14px",
                  background: "linear-gradient(135deg, #10B981 0%, #059669 100%)",
                  color: "white",
                  border: "none",
                  borderRadius: "12px",
                  fontSize: "15px",
                  fontWeight: "600",
                  cursor: "pointer",
                  boxShadow: "0 4px 12px rgba(16, 185, 129, 0.3)"
                }}
              >
                {loading ? "Saving..." : "Save Changes"}
              </button>
            </div>
          )}

          {!isEditing && reservation.status === "confirmed" && (
            <button
              onClick={async () => {
                if (window.confirm("Are you sure you want to cancel this reservation?\nThis will also be cancelled in Beds24.")) {
                  try {
                    const response = await axios.post(`${API_BASE_URL}/cancelBooking`, {
                      bookId: reservation.bookId,
                      building: reservation.building
                    });
                    if (response.data.success) {
                      alert("Reservation has been cancelled.");
                      onClose();
                      if (onRefresh) onRefresh();
                    } else {
                      alert("Cancellation failed: " + response.data.error);
                    }
                  } catch (err) {
                    alert("Error: " + err.message);
                  }
                }
              }}
              style={{
                width: "100%",
                padding: "12px",
                background: "transparent",
                color: "#EF4444",
                border: "1px solid #EF4444",
                borderRadius: "12px",
                fontSize: "14px",
                fontWeight: "600",
                cursor: "pointer",
                transition: "all 0.2s"
              }}
            >
              Cancel Reservation
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Month Picker Modal - Premium Design
function MonthPickerModal({ year, month, onSelect, onClose }) {
  const [selectedYear, setSelectedYear] = useState(year);
  const [selectedMonth, setSelectedMonth] = useState(month);

  const years = [];
  for (let y = 2023; y <= 2027; y++) {
    years.push(y);
  }

  const months = [
    { short: "Jan", num: 1 },
    { short: "Feb", num: 2 },
    { short: "Mar", num: 3 },
    { short: "Apr", num: 4 },
    { short: "May", num: 5 },
    { short: "Jun", num: 6 },
    { short: "Jul", num: 7 },
    { short: "Aug", num: 8 },
    { short: "Sep", num: 9 },
    { short: "Oct", num: 10 },
    { short: "Nov", num: 11 },
    { short: "Dec", num: 12 }
  ];

  const getMonthName = (monthIdx) => {
    const names = ["January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"];
    return names[monthIdx];
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: "rgba(0,0,0,0.5)",
      backdropFilter: "blur(4px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 9999
    }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "400px",
          width: "90%",
          padding: "24px",
          background: "white",
          borderRadius: "20px",
          boxShadow: "0 25px 50px rgba(0,0,0,0.25)"
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
          <h2 style={{ fontSize: "20px", fontWeight: "700", color: "#111827", margin: 0 }}>Select Date</h2>
          <button onClick={onClose} style={{
            width: "32px",
            height: "32px",
            borderRadius: "8px",
            border: "none",
            background: "#F3F4F6",
            cursor: "pointer",
            fontSize: "16px",
            color: "#6B7280"
          }}>×</button>
        </div>

        {/* Year Selection */}
        <div style={{ marginBottom: "20px" }}>
          <div style={{ fontSize: "13px", fontWeight: "600", color: "#6B7280", marginBottom: "10px" }}>Year</div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {years.map(y => (
              <button
                key={y}
                onClick={() => setSelectedYear(y)}
                style={{
                  padding: "10px 18px",
                  borderRadius: "10px",
                  border: "none",
                  background: selectedYear === y ? "linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)" : "#F3F4F6",
                  color: selectedYear === y ? "white" : "#374151",
                  fontWeight: "600",
                  fontSize: "14px",
                  cursor: "pointer",
                  boxShadow: selectedYear === y ? "0 4px 12px rgba(59, 130, 246, 0.3)" : "none",
                  transition: "all 0.2s"
                }}
              >
                {y}
              </button>
            ))}
          </div>
        </div>

        {/* Month Selection */}
        <div style={{ marginBottom: "24px" }}>
          <div style={{ fontSize: "13px", fontWeight: "600", color: "#6B7280", marginBottom: "10px" }}>Month</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
            {months.map((m, idx) => (
              <button
                key={idx}
                onClick={() => setSelectedMonth(idx)}
                style={{
                  padding: "12px 8px",
                  borderRadius: "10px",
                  border: "none",
                  background: selectedMonth === idx ? "linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)" : "#F3F4F6",
                  color: selectedMonth === idx ? "white" : "#374151",
                  fontWeight: "600",
                  fontSize: "13px",
                  cursor: "pointer",
                  boxShadow: selectedMonth === idx ? "0 4px 12px rgba(59, 130, 246, 0.3)" : "none",
                  transition: "all 0.2s",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "2px"
                }}
              >
                <span style={{ fontSize: "12px", opacity: 0.8 }}>{m.num}</span>
                <span>{m.short}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Confirm Button */}
        <button
          onClick={() => {
            onSelect(selectedYear, selectedMonth);
            onClose();
          }}
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
            boxShadow: "0 4px 12px rgba(59, 130, 246, 0.3)"
          }}
        >
          Go to {getMonthName(selectedMonth)} {selectedYear}
        </button>
      </div>
    </div>
  );
}

// Manual Booking Modal - Premium Design
function ManualBookingModal({ initialBuilding, initialRoom, initialDates, onClose, onSave, companyId }) {
  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(initialBuilding || "아라키초A");
  const [room, setRoom] = useState(initialRoom || "");
  const [arrival, setArrival] = useState(initialDates && initialDates[0] ? initialDates[0] : dayjs().format("YYYY-MM-DD"));
  const [departure, setDeparture] = useState(initialDates && initialDates.length > 0 ? dayjs(initialDates[initialDates.length - 1]).add(1, 'day').format("YYYY-MM-DD") : dayjs().add(1, 'day').format("YYYY-MM-DD"));
  const [guestName, setGuestName] = useState("");
  const [price, setPrice] = useState("");
  const [numAdult, setNumAdult] = useState(1);
  const [numChild, setNumChild] = useState(0);
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestComments, setGuestComments] = useState("");

  const rooms = BUILDING_ROOMS[building] || [];

  const handleSave = async () => {
    if (!room) { alert("Please select a room."); return; }
    if (!guestName) { alert("Please enter guest name."); return; }
    if (!price) { alert("Please enter price."); return; }

    const targetRoomInfos = rooms.filter(r => r.name === room);
    if (targetRoomInfos.length === 0) { alert("Room information not found."); return; }

    // ★ 첫 번째 roomId(메인 계정)에만 예약 생성 - Beds24 내부에서 자동 연동됨
    const mainRoomInfo = targetRoomInfos[0];
    const isBlackout = guestName.includes("점검") || guestName.toLowerCase().includes("blackout");

    setLoading(true);
    try {
      const payload = {
        companyId,
        building,
        roomId: mainRoomInfo.roomId,
        room: mainRoomInfo.name,
        arrival,
        departure,
        guestName: isBlackout ? "Room Block (Blackout)" : guestName,
        price: isBlackout ? "0" : price,
        numAdult,
        numChild,
        comments: isBlackout ? "System Block" : guestComments,
        source: "Direct"
      };

      const response = await axios.post(`${API_BASE_URL}/createBooking`, payload);

      if (response.data.success) {
        alert(isBlackout ? "Room block completed!" : "Reservation created successfully!");
        onSave();
      } else {
        alert("Failed to create reservation: " + (response.data.error || "Unknown error"));
      }
    } catch (err) {
      console.error(err);
      alert("Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const modalInputStyle = {
    padding: "12px 14px",
    border: "1px solid #E5E7EB",
    borderRadius: "10px",
    fontSize: "14px",
    outline: "none",
    transition: "all 0.2s",
    boxSizing: "border-box"
  };

  const modalLabelStyle = {
    fontSize: "13px",
    fontWeight: "600",
    color: "#374151",
    display: "block",
    marginBottom: "6px"
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: "rgba(0,0,0,0.6)",
      backdropFilter: "blur(4px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 9999
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        maxWidth: "520px",
        width: "90%",
        background: "white",
        borderRadius: "20px",
        boxShadow: "0 25px 50px rgba(0,0,0,0.25)",
        maxHeight: "90vh",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column"
      }}>
        {/* Header */}
        <div style={{
          padding: "24px",
          borderBottom: "1px solid #E5E7EB",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
        }}>
          <div>
            <h2 style={{ fontSize: "20px", fontWeight: "700", color: "#111827", margin: 0 }}>
              Add Reservation
            </h2>
            <p style={{ fontSize: "13px", color: "#6B7280", marginTop: "4px" }}>
              Create a new manual booking
            </p>
          </div>
          <button onClick={onClose} style={{
            width: "36px",
            height: "36px",
            borderRadius: "10px",
            border: "none",
            background: "#F3F4F6",
            cursor: "pointer",
            fontSize: "18px",
            color: "#6B7280"
          }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
          <div style={{ marginBottom: "20px" }}>
            <label style={modalLabelStyle}>Property & Room</label>
            <div style={{ display: "flex", gap: "10px" }}>
              <select
                value={building}
                onChange={(e) => { setBuilding(e.target.value); setRoom(""); }}
                style={{ ...modalInputStyle, flex: 1 }}
              >
                {Object.keys(BUILDING_DATA).map(b => <option key={b} value={b}>{getBuildingNameEN(b)}</option>)}
              </select>
              <select
                value={room}
                onChange={(e) => setRoom(e.target.value)}
                style={{ ...modalInputStyle, flex: 1 }}
              >
                <option value="">Select Room</option>
                {Array.from(new Set(rooms.map(r => r.name))).sort().map(name => (
                  <option key={name} value={name}>{getRoomNameEN(name)}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: "flex", gap: "16px", marginBottom: "20px" }}>
            <div style={{ flex: 1 }}>
              <label style={modalLabelStyle}>Check-in</label>
              <input
                type="date"
                value={arrival}
                onChange={(e) => setArrival(e.target.value)}
                style={{ ...modalInputStyle, width: "100%" }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={modalLabelStyle}>Check-out</label>
              <input
                type="date"
                value={departure}
                onChange={(e) => setDeparture(e.target.value)}
                style={{ ...modalInputStyle, width: "100%" }}
              />
            </div>
          </div>

          <div style={{ marginBottom: "20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <label style={{ ...modalLabelStyle, marginBottom: 0 }}>Guest Name</label>
              <button
                onClick={() => { setGuestName("Room Block (Blackout)"); setPrice("0"); }}
                style={{
                  fontSize: "12px",
                  color: "#3B82F6",
                  border: "1px solid #3B82F6",
                  borderRadius: "6px",
                  padding: "4px 10px",
                  background: "white",
                  cursor: "pointer",
                  fontWeight: "500"
                }}
              >
                Set as Block
              </button>
            </div>
            <input
              type="text"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="Enter guest name"
              style={{ ...modalInputStyle, width: "100%" }}
            />
          </div>

          <div style={{ marginBottom: "20px" }}>
            <label style={modalLabelStyle}>Total Price (¥)</label>
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="e.g. 50000"
              style={{ ...modalInputStyle, width: "100%" }}
            />
          </div>

          <div style={{ display: "flex", gap: "16px", marginBottom: "20px" }}>
            <div style={{ flex: 1 }}>
              <label style={modalLabelStyle}>Adults</label>
              <input
                type="number"
                value={numAdult}
                onChange={(e) => setNumAdult(e.target.value)}
                style={{ ...modalInputStyle, width: "100%" }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={modalLabelStyle}>Children</label>
              <input
                type="number"
                value={numChild}
                onChange={(e) => setNumChild(e.target.value)}
                style={{ ...modalInputStyle, width: "100%" }}
              />
            </div>
          </div>

          <div style={{ marginBottom: "20px" }}>
            <label style={modalLabelStyle}>Contact Info</label>
            <div style={{ display: "flex", gap: "10px" }}>
              <input
                type="email"
                value={guestEmail}
                onChange={(e) => setGuestEmail(e.target.value)}
                placeholder="Email"
                style={{ ...modalInputStyle, flex: 1 }}
              />
              <input
                type="text"
                value={guestPhone}
                onChange={(e) => setGuestPhone(e.target.value)}
                placeholder="Phone"
                style={{ ...modalInputStyle, flex: 1 }}
              />
            </div>
          </div>

          <div style={{ marginBottom: "16px" }}>
            <label style={modalLabelStyle}>Notes & Requests</label>
            <textarea
              value={guestComments}
              onChange={(e) => setGuestComments(e.target.value)}
              placeholder="e.g. Early check-in request"
              style={{ ...modalInputStyle, width: "100%", height: "80px", resize: "none" }}
            />
          </div>
        </div>

        {/* Footer Buttons */}
        <div style={{ padding: "20px 24px", borderTop: "1px solid #E5E7EB", display: "flex", gap: "12px" }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: "14px",
              background: "#F3F4F6",
              color: "#374151",
              border: "none",
              borderRadius: "12px",
              fontSize: "15px",
              fontWeight: "600",
              cursor: "pointer"
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            style={{
              flex: 2,
              padding: "14px",
              background: "linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)",
              color: "white",
              border: "none",
              borderRadius: "12px",
              fontSize: "15px",
              fontWeight: "600",
              cursor: "pointer",
              boxShadow: "0 4px 12px rgba(59, 130, 246, 0.3)",
              opacity: loading ? 0.7 : 1
            }}
          >
            {loading ? "Saving..." : "Create Reservation"}
          </button>
        </div>
      </div>
    </div>
  );
}

const labelStyle = {
  fontSize: "13px",
  fontWeight: "600",
  color: "#86868B",
  marginLeft: "4px"
};

const inputStyle = {
  padding: "12px",
  borderRadius: "10px",
  border: "1px solid #E5E5EA",
  fontSize: "14px",
  background: "#F9F9F9",
  outline: "none"
};

const saveButtonStyle = {
  padding: "14px",
  background: "#0071E3",
  color: "white",
  border: "none",
  borderRadius: "12px",
  fontSize: "16px",
  fontWeight: "600",
  cursor: "pointer"
};

const cancelButtonStyle = {
  padding: "14px",
  background: "#F2F2F7",
  color: "#1D1D1F",
  border: "none",
  borderRadius: "12px",
  fontSize: "16px",
  fontWeight: "600",
  cursor: "pointer"
};

// 스타일 유틸
const filterBtnStyle = {
  padding: "6px 12px",
  borderRadius: "6px",
  border: "1px solid #E5E5EA",
  background: "white",
  fontSize: "12px",
  cursor: "pointer",
  color: "#1D1D1F"
};

const dayBtnStyle = {
  padding: "6px 10px",
  borderRadius: "6px",
  border: "1px solid #E5E5EA",
  background: "#F2F2F7",
  fontSize: "11px",
  cursor: "pointer",
  color: "#86868B"
};

// 메인 캘린더 컴포넌트
function BuildingCalendar() {
  const { companyId } = useUser();

  const [selectedBuilding, setSelectedBuilding] = useState("아라키초A");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedReservation, setSelectedReservation] = useState(null);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [expandedBuildings, setExpandedBuildings] = useState([]); // 전체보기 확장 상태

  // 캘린더 드래그 스크롤 관련
  const calendarRef = React.useRef(null);
  const [isDraggingCalendar, setIsDraggingCalendar] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);

  const handleCalendarMouseDown = (e) => {
    if (priceMode || gapEditMode) return; // 가격/Gap 모드일 때는 드래그 선택 기능과 충돌하므로 제외
    // 예약 바나 버튼 클릭 시 드래그 방지
    if (e.target.closest('[data-no-drag]') || e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
    setIsDraggingCalendar(true);
    setStartX(e.clientX);
    setScrollLeft(calendarRef.current.scrollLeft);
    e.preventDefault(); // 텍스트 선택 방지
  };

  const handleCalendarMouseMove = (e) => {
    if (!isDraggingCalendar) return;
    e.preventDefault();
    const x = e.clientX;
    const walk = (startX - x) * 1.5; // 스크롤 속도 조절
    calendarRef.current.scrollLeft = scrollLeft + walk;
  };

  const handleCalendarMouseUp = () => {
    setIsDraggingCalendar(false);
  };

  // 가격 설정 관련 state
  const [priceMode, setPriceMode] = useState(false);
  const [isDragging, setIsDragging] = useState(false); // 드래그 선택 상태 (가격모드용)
  const [selectedRoom, setSelectedRoom] = useState(null); // 유지 (단일 클릭 호환성)
  const [selectedCells, setSelectedCells] = useState([]); // ★ 셀 단위 선택: [{ room: "701호", date: "2026-02-05" }, ...]

  // selectedCells에서 파생된 값들 (호환성 유지)
  const selectedRooms = useMemo(() => [...new Set(selectedCells.map(c => c.room))], [selectedCells]);
  const selectedDates = useMemo(() => [...new Set(selectedCells.map(c => c.date))], [selectedCells]);
  const [showPriceModal, setShowPriceModal] = useState(false);
  const [showManualBookingModal, setShowManualBookingModal] = useState(false);
  const [gapEditMode, setGapEditMode] = useState(false); // Gap 수정 모드
  const [showGapEditModal, setShowGapEditModal] = useState(false); // Gap 수정 모달
  const [gapEditMinStay, setGapEditMinStay] = useState(1); // 1박 또는 2박
  const [isGapApplying, setIsGapApplying] = useState(false); // Gap 적용 중 상태
  const [showCancelled, setShowCancelled] = useState(false); // 취소된 예약 보기 여부

  // 블락 정리 관련 상태
  const [showBlockCleanupModal, setShowBlockCleanupModal] = useState(false);
  const [blockData, setBlockData] = useState([]);
  const [blockLoading, setBlockLoading] = useState(false);
  const [blockDeleting, setBlockDeleting] = useState(false);
  const [selectionStart, setSelectionStart] = useState(null); // { room, date, day }
  const [hoveredDay, setHoveredDay] = useState(null);
  const [hoveredRoom, setHoveredRoom] = useState(null);
  const [dragAction, setDragAction] = useState(null); // 'select' or 'deselect'

  const navigate = useNavigate(); // 네비게이션 훅
  const [roomPrices, setRoomPrices] = useState({});
  const [pricesLoading, setPricesLoading] = useState(false);
  const [pricesError, setPricesError] = useState(false);
  const [priceCache, setPriceCache] = useState({}); // 건물별 캐시: { "아라키초A": {...} }
  const [lastPriceSync, setLastPriceSync] = useState(null); // 마지막 동기화 시간
  const [viewMode, setViewMode] = useState("monthly"); // "monthly" | "rolling"
  const [rollingStartDate, setRollingStartDate] = useState(new Date()); // 롤링 뷰 시작일

  // ── 모바일 전용 state ──
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [mobileWeekStart, setMobileWeekStart] = useState(() => {
    const today = dayjs();
    const dow = today.day(); // 0=일요일
    return today.add(dow === 0 ? -6 : 1 - dow, 'day'); // 이번 주 월요일
  });
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  const handleMobileWeekNav = (direction) => {
    setMobileWeekStart(prev => {
      const next = prev.add(direction * 7, 'day');
      setCurrentDate(next.toDate()); // 해당 주의 월 데이터 로드
      return next;
    });
  };

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const daysInMonth = getDaysInMonth(year, month);
  const rooms = BUILDING_DATA[selectedBuilding] || [];

  // 뷰 모드에 따른 표시할 날짜 배열
  const displayDays = useMemo(() => {
    if (viewMode === "rolling") {
      // 롤링 뷰 (30-Day View): rollingStartDate부터 30일
      const days = [];
      const start = dayjs(rollingStartDate);

      for (let i = 0; i < 30; i++) {
        const d = start.add(i, 'day');
        days.push({
          date: d.toDate(),
          day: d.date(),
          month: d.month(),
          year: d.year(),
          dateStr: d.format('YYYY-MM-DD'),
          dateKey: d.format('YYYYMMDD')
        });
      }
      return days;
    } else {
      // 월별 뷰: 해당 월의 1일~말일
      const days = [];
      for (let i = 1; i <= daysInMonth; i++) {
        const d = dayjs(new Date(year, month, i));
        days.push({
          date: d.toDate(),
          day: i,
          month: month,
          year: year,
          dateStr: d.format('YYYY-MM-DD'),
          dateKey: d.format('YYYYMMDD')
        });
      }
      return days;
    }
  }, [viewMode, rollingStartDate, year, month, daysInMonth]);

  // 롤링 뷰용 (헤더에서 사용)
  const rollingDays = viewMode === "rolling" ? displayDays : [];

  // 날짜별 활성 roomId 판별: minStay 50/99는 비활성(닫힌 계정), 1~49만 활성
  const getMinStayForRoomIdDate = useCallback((roomId, dateStr) => {
    if (selectedBuilding === "전체") return null;
    const dateKey = dateStr.replace(/-/g, "");
    const priceInfo = roomPrices?.[String(roomId)]?.dates?.[dateKey];
    if (!priceInfo) return null;
    const ms = parseInt(priceInfo.m, 10);
    return Number.isFinite(ms) ? ms : null;
  }, [selectedBuilding, roomPrices]);

  const getActiveUnitInfosForDate = useCallback((roomName, dateStr) => {
    const unitInfos = BUILDING_ROOMS[selectedBuilding]?.filter(r => r.name === roomName) || [];
    if (unitInfos.length <= 1) return unitInfos;

    // minStay >= INACTIVE_MINSTAY_THRESHOLD(50/99)이면 비활성(닫힌 계정).
    // null(데이터 미로드)이면 비활성으로 보수적 처리 — 캐시 로드 후 재판단
    const activeInfos = unitInfos.filter((info) => {
      const ms = getMinStayForRoomIdDate(info.roomId, dateStr) ?? INACTIVE_MINSTAY_THRESHOLD;
      return ms >= 1 && ms < INACTIVE_MINSTAY_THRESHOLD;
    });

    // 활성방 없으면 빈 배열 반환 (비활성 roomId로 잘못 작업하는 것 방지)
    return activeInfos;
  }, [selectedBuilding, getMinStayForRoomIdDate]);

  const isReservationActiveOnDate = useCallback((reservation, dateStr) => {
    if (!reservation?.roomId || selectedBuilding === "전체") return true;
    const activeInfos = getActiveUnitInfosForDate(reservation.room, dateStr);
    return activeInfos.some((info) => String(info.roomId) === String(reservation.roomId));
  }, [selectedBuilding, getActiveUnitInfosForDate]);

  // 마우스 업 전역 리스너 (드래그 종료용)
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      setIsDragging(false);
      setDragAction(null);
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  // 월 이동
  const goToPrevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const goToNextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const goToToday = () => setCurrentDate(new Date());
  const handleMonthSelect = (newYear, newMonth) => setCurrentDate(new Date(newYear, newMonth, 1));

  // 오늘 기준 +N달 이동 (오늘 날짜가 속한 달 기준)
  const goToTodayPlusMonths = (months) => {
    const today = new Date();
    setCurrentDate(new Date(today.getFullYear(), today.getMonth() + months, 1));
  };

  // 롤링 뷰 이동 (30일씩)
  const goToRollingNext = () => {
    setRollingStartDate(dayjs(rollingStartDate).add(30, 'day').toDate());
  };
  const goToRollingPrev = () => {
    setRollingStartDate(dayjs(rollingStartDate).subtract(30, 'day').toDate());
  };
  const goToRollingToday = () => {
    // 어제부터 시작 (최소숙박일수 확인용)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    setRollingStartDate(yesterday);
  };

  // 뷰 모드 전환
  const toggleViewMode = () => {
    if (viewMode === "monthly") {
      setViewMode("rolling");
      // 롤링 뷰로 전환 시 어제부터 시작 (최소숙박일수 확인용)
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      setRollingStartDate(yesterday);
    } else {
      setViewMode("monthly");
    }
  };

  // 가격 모드 토글
  const togglePriceMode = () => {
    setPriceMode(!priceMode);
    setSelectedRoom(null);
    setSelectedCells([]); // 초기화
    setSelectionStart(null); // 퀵 예약 선택 중이었다면 초기화
    setHoveredDay(null);
    setHoveredRoom(null);
  };

  // 객실 선택 토글
  const toggleRoomSelection = (room) => {
    if (selectedRooms.includes(room)) {
      // 해당 방의 모든 셀 제거
      setSelectedCells(prev => prev.filter(c => c.room !== room));
      const remaining = selectedRooms.filter(r => r !== room);
      setSelectedRoom(remaining.length > 0 ? remaining[remaining.length - 1] : null);
    } else {
      // 날짜가 없으면 현재 뷰의 모든 미래 날짜 사용
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const datesToUse = selectedDates.length > 0
        ? selectedDates
        : displayDays
          .filter(d => d.date >= today)
          .map(d => d.dateStr);

      const newCells = datesToUse.map(date => ({ room, date }));
      setSelectedCells(prev => [...prev, ...newCells]);
      setSelectedRoom(room);
    }
  };

  // 전체 객실 선택
  const toggleSelectAllRooms = () => {
    if (selectedRooms.length === rooms.length) {
      setSelectedCells([]);
      setSelectedRoom(null);
    } else {
      // 모든 방 × 현재 선택된 날짜들
      const newCells = [];
      rooms.forEach(room => {
        selectedDates.forEach(date => {
          if (!selectedCells.some(c => c.room === room && c.date === date)) {
            newCells.push({ room, date });
          }
        });
      });
      setSelectedCells(prev => [...prev, ...newCells]);
      setSelectedRoom(rooms[0]); // 첫 번째 객실을 기준
    }
  };

  // 요일별 날짜 선택
  const selectDatesByFilter = (filterType) => {
    // filterType: 'all', 'weekday', 'weekend', 'mon', 'tue'...
    const newDates = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // ★ Bug #3 Fix: 롤링 뷰일 때는 displayDays 사용, 아닐 때는 월별 순회
    const daysToIterate = viewMode === "rolling" ? displayDays :
      Array.from({ length: daysInMonth }, (_, i) => ({
        date: new Date(year, month, i + 1),
        dateStr: `${year}-${String(month + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`
      }));

    daysToIterate.forEach(d => {
      const date = d.date;
      if (date < today) return; // 과거 제외

      const dateStr = d.dateStr;
      const dayOfWeek = date.getDay(); // 0(일) ~ 6(토)

      let shouldSelect = false;

      if (filterType === 'all') shouldSelect = true;
      else if (filterType === 'weekend') shouldSelect = (dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0); // 금, 토, 일
      else if (filterType === 'weekday') shouldSelect = (dayOfWeek >= 1 && dayOfWeek <= 4); // 월~목
      else if (typeof filterType === 'number') shouldSelect = (dayOfWeek === filterType);

      if (shouldSelect) newDates.push(dateStr);
    });

    // ★ 선택된 방들 × 새 날짜들로 셀 생성
    const roomsToUse = selectedRooms.length > 0 ? selectedRooms : rooms;
    const newCells = [];
    roomsToUse.forEach(room => {
      newDates.forEach(date => {
        newCells.push({ room, date });
      });
    });
    setSelectedCells(newCells);

    // ★ Bug #1 Fix: 모달 오픈을 위해 selectedRoom 설정
    if (roomsToUse.length > 0) {
      setSelectedRoom(roomsToUse[0]);
    }
  };

  // 주간 선택 (1주~5주, 필터 적용)
  const selectWeek = (weekIdx, filterType) => {
    // weekIdx: 1~5
    // filterType: 'all', 'weekday', 'weekend'
    const newDates = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // ★ Bug #3 Fix: 롤링 뷰일 때는 Rolling View 기준 주차? 
    // 기획적으로 주간 선택은 "월 표시" 기준이 명확하므로, Rolling View에서도 "현재 월"의 1주~5주를 선택하는 것이 자연스러움.
    // 하지만 Rolling View에서 "보이는 날짜"만 선택되어야 한다면 displayDays를 참고해야 함.
    // 여기서는 기존 로직(월 기준)을 유지하되, Rolling View에서 안 보이는 날짜여도 "데이터상" 선택은 되도록 유지하는게 맞음.
    // 다만, Rolling View는 "보이는 날짜"가 중요하므로, Rolling View일 때는 displayDays에서 해당 "번째" 7일을 선택하거나...
    // 사용자 경험상 "Week 1" = 1일~7일, "Week 2" = 8일~14일로 고정되어 있음.
    // 따라서 기존 로직을 유지하되, 월 경계를 넘는 처리가 필요하면 수정. 여기서는 단순 버그 수정이므로 로직 유지.

    // 단, Bug #1 Fix: 모달 오픈을 위해 selectedRoom 설정은 필수.

    let startDay = (weekIdx - 1) * 7 + 1;
    let endDay = weekIdx * 7;
    if (weekIdx === 5) endDay = daysInMonth; // 5주는 말일까지

    for (let i = startDay; i <= daysInMonth; i++) {
      if (i > endDay) break;

      const date = new Date(year, month, i);
      if (date < today) continue;

      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      const dayOfWeek = date.getDay();

      let shouldSelect = false;
      if (filterType === 'all') shouldSelect = true;
      else if (filterType === 'weekend') shouldSelect = (dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0);
      else if (filterType === 'weekday') shouldSelect = (dayOfWeek >= 1 && dayOfWeek <= 4);

      if (shouldSelect) newDates.push(dateStr);
    }

    // ★ 선택된 방들 × 새 날짜들로 셀 추가 (누적)
    const roomsToUse = selectedRooms.length > 0 ? selectedRooms : rooms;
    const newCells = [];
    roomsToUse.forEach(room => {
      newDates.forEach(date => {
        if (!selectedCells.some(c => c.room === room && c.date === date)) {
          newCells.push({ room, date });
        }
      });
    });
    setSelectedCells(prev => [...prev, ...newCells]);

    // ★ Bug #1 Fix
    if (roomsToUse.length > 0) {
      setSelectedRoom(roomsToUse[0]);
    }
  };

  // 날짜 셀 클릭 핸들러
  const handleDateCellClick = (room, day) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const clickedDate = new Date(year, month, day);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 과거 날짜는 무시 (가격 설정 모드 아닐 때만? 아니면 공통으로?)
    if (clickedDate < today) return;

    // 가격 설정 모드 또는 Gap 수정 모드일 때 (단일 클릭 시)
    if (priceMode || gapEditMode) {
      const roomInfo = BUILDING_ROOMS[selectedBuilding]?.find(r => r.name === room);
      if (!roomInfo) return;

      // ★ 셀 단위 선택 (토글)
      const cellKey = `${room}|${dateStr}`;
      const existingIndex = selectedCells.findIndex(c => c.room === room && c.date === dateStr);

      if (existingIndex >= 0) {
        // 이미 선택된 셀이면 제거
        setSelectedCells(prev => prev.filter((_, i) => i !== existingIndex));
      } else {
        // 새 셀 추가
        setSelectedCells(prev => [...prev, { room, date: dateStr }]);
      }

      setSelectedRoom(room); // 마지막 클릭한 방 (호환성 유지)
      return;
    }

    // 일반 모드 (수기 예약 퀵 등록)
    if (!selectionStart) {
      // 첫 번째 클릭: 시작점 설정
      setSelectionStart({ room, date: dateStr, day });
    } else {
      // 두 번째 클릭
      if (selectionStart.room !== room) {
        // 다른 방을 클릭하면 selection 초기화하고 다시 시작
        setSelectionStart({ room, date: dateStr, day });
        return;
      }

      // 같은 방 클릭: 범위 계산 및 모달 오픈
      // ★ Bug #4 Fix: dayjs를 사용하여 월 경계(Rolling View)에서도 올바른 날짜 범위 생성
      const startDate = dayjs(selectionStart.date);
      const endDate = dayjs(dateStr);

      const [from, to] = startDate.isBefore(endDate) ? [startDate, endDate] : [endDate, startDate];

      const range = [];
      let current = from;
      while (current.isSameOrBefore(to)) {
        range.push(current.format('YYYY-MM-DD'));
        current = current.add(1, 'day');
      }

      setSelectedRoom(room);
      // 수기 예약용: range를 셀로 변환
      const rangeCells = range.map(date => ({ room, date }));
      setSelectedCells(rangeCells);
      setShowManualBookingModal(true);
      setSelectionStart(null); // 초기화
      setHoveredDay(null);
      setHoveredRoom(null);
    }
  };

  // 가격 설정 모달 열기
  const openPriceModal = () => {
    if (selectedDates.length === 0) {
      alert("Please select a date first.");
      return;
    }
    setShowPriceModal(true);
  };

  // 가격 데이터 조회 (Firestore 캐시에서 읽기 - API 직접 호출 없음)
  const fetchPrices = useCallback(async (forceRefresh = false) => {
    if (pricesLoading) return;
    if (selectedBuilding === "전체") return; // 전체 보기에서는 가격 조회 안함
    setPricesError(false);

    // 프론트엔드 캐시 확인 (강제 새로고침이 아닐 때만)
    if (!forceRefresh && priceCache[selectedBuilding]) {
      setRoomPrices(prev => ({ ...prev, ...priceCache[selectedBuilding] }));
      return;
    }

    setPricesLoading(true);
    try {
      // Firestore 캐시에서 읽기 (Beds24 API 호출 없음)
      const response = await fetch(`${API_BASE_URL}/getCachedPrices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, building: selectedBuilding })
      });

      const data = await response.json();
      if (data.success && data.priceData) {
        // 프론트엔드 캐시에 저장
        setPriceCache(prev => ({ ...prev, [selectedBuilding]: data.priceData }));
        // 현재 가격 데이터에 병합
        setRoomPrices(prev => ({ ...prev, ...data.priceData }));
        // 마지막 동기화 시간 저장
        setLastPriceSync(data.lastSync ? new Date(data.lastSync) : null);
      } else if (data.noCache) {
        console.warn("캐시 데이터 없음, 동기화 대기 중...");
      } else {
        console.error("Price fetch failed:", data.error || "Unknown error");
      }
    } catch (err) {
      console.error("Price fetch error:", err);
      setPricesError(true);
    } finally {
      setPricesLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBuilding, pricesLoading, companyId]);

  // 일반 모드/가격 모드 모두 날짜별 활성 roomId 판정을 위해 캐시 로드
  useEffect(() => {
    if (selectedBuilding !== "전체") {
      fetchPrices();
    }
  }, [selectedBuilding, fetchPrices]);

  // 선택 초기화 (건물 변경 시)
  useEffect(() => {
    setSelectedRoom(null);
    setSelectedCells([]);
  }, [selectedBuilding]);

  // 블락 데이터 조회 함수
  const fetchBlockData = useCallback(async () => {
    if (!companyId) return;
    setBlockLoading(true);
    try {
      const buildings = ["가부키초", "아라키초A", "아라키초B"];
      let allBlocks = [];

      for (const building of buildings) {
        // blackout 상태 조회
        const blackoutQuery = query(
          collection(db, "reservations"),
          where("companyId", "==", companyId),
          where("building", "==", building),
          where("status", "==", "blackout")
        );
        const blackoutSnap = await getDocs(blackoutQuery);

        // maintenance 상태 조회
        const maintenanceQuery = query(
          collection(db, "reservations"),
          where("companyId", "==", companyId),
          where("building", "==", building),
          where("status", "==", "maintenance")
        );
        const maintenanceSnap = await getDocs(maintenanceQuery);

        blackoutSnap.docs.forEach(doc => {
          allBlocks.push({ id: doc.id, ...doc.data() });
        });
        maintenanceSnap.docs.forEach(doc => {
          allBlocks.push({ id: doc.id, ...doc.data() });
        });
      }

      // 날짜순 정렬
      allBlocks.sort((a, b) => (a.arrival || '').localeCompare(b.arrival || ''));
      setBlockData(allBlocks);
    } catch (error) {
      console.error("Error fetching block data:", error);
      alert("Failed to fetch block data: " + error.message);
    } finally {
      setBlockLoading(false);
    }
  }, [companyId]);

  // 블락 데이터 삭제 함수 (Beds24 API + Firestore 동시 삭제)
  const deleteBlockData = async (blockIds) => {
    if (blockIds.length === 0) return;

    setBlockDeleting(true);
    try {
      // 1. Beds24 API에서 블록 취소 (재생성 방지)
      const beds24Results = [];
      for (const blockId of blockIds) {
        try {
          const response = await fetch(`${API_BASE_URL}/cancelBooking`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              companyId,
              bookId: blockId,
              reason: "Block deleted via Clean Blocks"
            })
          });
          const result = await response.json();
          beds24Results.push({ id: blockId, success: result.success, error: result.error });

          // Rate limit 방지: 요청 사이 딜레이
          await new Promise(r => setTimeout(r, 500));
        } catch (err) {
          beds24Results.push({ id: blockId, success: false, error: err.message });
        }
      }

      // 2. Firestore에서 삭제
      const batch = writeBatch(db);
      blockIds.forEach(id => {
        batch.delete(doc(db, "reservations", id));
      });
      await batch.commit();

      // 결과 확인
      const beds24Success = beds24Results.filter(r => r.success).length;
      const beds24Failed = beds24Results.filter(r => !r.success).length;

      // 삭제 후 목록 갱신
      setBlockData(prev => prev.filter(b => !blockIds.includes(b.id)));

      // 예약 목록도 갱신
      fetchReservations();

      if (beds24Failed > 0) {
        alert(`${blockIds.length} blocks deleted from Firestore.\nBeds24: ${beds24Success} cancelled, ${beds24Failed} failed (may reappear on sync).`);
      } else {
        alert(`${blockIds.length} blocks deleted successfully from both Firestore and Beds24.`);
      }
    } catch (error) {
      console.error("Error deleting block data:", error);
      alert("Delete failed: " + error.message);
    } finally {
      setBlockDeleting(false);
    }
  };

  // 예약 데이터 새로고침 함수 (외부에서 호출 가능)
  const fetchReservations = useCallback(async () => {
    if (!companyId) {
      console.warn('⚠️ No companyId for BuildingCalendar');
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // 뷰 모드에 따른 날짜 범위 계산
      let rangeStart, rangeEnd;
      if (viewMode === "rolling") {
        // 롤링 뷰: 시작일부터 30일
        rangeStart = dayjs(rollingStartDate).format('YYYY-MM-DD');
        rangeEnd = dayjs(rollingStartDate).add(30, 'day').format('YYYY-MM-DD');
      } else {
        // 월별 뷰: 해당 월의 1일~말일
        rangeStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
        rangeEnd = `${year}-${String(month + 1).padStart(2, '0')}-${daysInMonth}`;
      }

      const statuses = showCancelled ? ["confirmed", "cancelled", "blackout", "maintenance"] : ["confirmed", "blackout", "maintenance"];

      // 전체 선택 시 모든 건물 데이터 가져오기
      let allDocs = [];
      if (selectedBuilding === '전체') {
        const promises = ACTIVE_BUILDING_ORDER.map(b => {
          const q = query(
            collection(db, "reservations"),
            where("companyId", "==", companyId),
            where("building", "==", b),
            where("status", "in", statuses)
          );
          return getDocs(q);
        });
        const snapshots = await Promise.all(promises);
        snapshots.forEach(snap => {
          allDocs = [...allDocs, ...snap.docs.map(d => d.data())];
        });
        allDocs = allDocs.filter(r => r.building !== EXCLUDED_BUILDING_UI);
      } else {
        const q = query(
          collection(db, "reservations"),
          where("companyId", "==", companyId),
          where("building", "==", selectedBuilding),
          where("status", "in", statuses)
        );
        const snapshot = await getDocs(q);
        allDocs = snapshot.docs.map(doc => doc.data());
      }

      // ★ 갭 감지를 위해 앞뒤로 1일씩 여유를 두고 예약 필터링
      // (월 말/월 초 경계의 갭도 정확히 감지하기 위함)
      const extendedRangeStart = dayjs(rangeStart).subtract(1, 'day').format('YYYY-MM-DD');
      const extendedRangeEnd = dayjs(rangeEnd).add(1, 'day').format('YYYY-MM-DD');

      const filtered = allDocs.filter(r => {
        if (!r.arrival || !r.departure) return false;
        return r.arrival <= extendedRangeEnd && r.departure >= extendedRangeStart;
      });


      setReservations(filtered);
    } catch (error) {
      console.error("Error fetching reservations:", error);
    } finally {
      setLoading(false);
    }
  }, [selectedBuilding, year, month, daysInMonth, showCancelled, viewMode, rollingStartDate]);

  // 데이터 페칭
  useEffect(() => {
    fetchReservations();
  }, [fetchReservations]);

  // 분석 데이터 계산 함수 (재사용 가능하도록 분리)
  const calculateBuildingMetrics = (targetReservations, targetRooms, daysInMonth, year, month) => {
    // ★ 고유한 객실 이름 추출 (roomId가 2개인 객실은 하나로 취급)
    const uniqueRoomNames = [...new Set(targetRooms.map(r => r.name))];

    // 1. [Occupancy] Set 기반 가동률 계산 (OccupancyRateDashboard 로직 적용)
    // 겹치는 날짜 중복 제거 및 정확한 "박" 수 계산
    let occupiedSlot = 0;

    uniqueRoomNames.forEach(roomName => {
      // ★ 예약 상태가 confirmed인 것만 집계 (취소된 예약 제외)
      const roomRes = targetReservations.filter(r => r.room === roomName && r.status === "confirmed");
      if (roomRes.length === 0) return;

      const occupiedSet = new Set();
      const mStart = new Date(year, month, 1); // 00:00:00
      const mEnd = new Date(year, month, daysInMonth); // 00:00:00

      roomRes.forEach(r => {
        if (!r.arrival || !r.departure) return;

        // ★ 타임존 이슈 해결: 문자열 파싱하여 Local Date 00:00 생성
        const [sY, sM, sD] = r.arrival.split('-').map(Number);
        const [eY, eM, eD] = r.departure.split('-').map(Number);

        const start = new Date(sY, sM - 1, sD);
        const end = new Date(eY, eM - 1, eD);
        end.setDate(end.getDate() - 1); // 체크아웃 날짜 제외 (점유일 기준)

        // 월 범위 내로 클램핑
        const effectiveStart = start < mStart ? mStart : start;
        const effectiveEnd = end > mEnd ? mEnd : end;

        if (effectiveStart <= effectiveEnd) {
          for (let d = new Date(effectiveStart); d <= effectiveEnd; d.setDate(d.getDate() + 1)) {
            const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            occupiedSet.add(dateStr);
          }
        }
      });
      occupiedSlot += occupiedSet.size;
    });

    // ★ 고유한 객실 수 기준으로 계산 (roomId 중복 제거)
    const totalSlot = uniqueRoomNames.length * daysInMonth;
    const occupancyRate = totalSlot > 0 ? (occupiedSlot / totalSlot) * 100 : 0;
    const vacantNights = Math.max(0, totalSlot - occupiedSlot);

    // 2. [Revenue] 매출 및 오늘 빈방 계산
    // 매출은 중복 예약(오버부킹)이라도 각각 다 받아야 하므로 기존 로직 유지
    let totalRevenue = 0;
    let occupiedRoomsToday = 0;
    const todayStr = new Date().toISOString().slice(0, 10);
    // 오늘 예약 있는 객실 수 (객실명 기준, 두 ID 모두 반영)
    const roomNamesWithReservationToday = new Set();
    targetReservations.forEach(r => {
      if (r.status === "confirmed" && r.arrival <= todayStr && r.departure > todayStr) {
        roomNamesWithReservationToday.add(r.room);
      }
    });
    occupiedRoomsToday = roomNamesWithReservationToday.size;

    targetReservations.forEach(r => {

      // 매출 분배 logic
      if (!r.arrival || !r.departure) return;
      const arrivalDate = new Date(r.arrival + 'T00:00:00');
      const departureDate = new Date(r.departure + 'T00:00:00');
      const monthStartDate = new Date(year, month, 1);
      const monthEndDate = new Date(year, month + 1, 1);

      const effectiveStart = arrivalDate < monthStartDate ? monthStartDate : arrivalDate;
      const effectiveEnd = departureDate > monthEndDate ? monthEndDate : departureDate;

      if (effectiveEnd > effectiveStart) {
        const nightsInMonth = Math.ceil((effectiveEnd - effectiveStart) / (1000 * 60 * 60 * 24));
        // 전체 박수
        const totalReservationNights = Math.max(1, Math.ceil((departureDate - arrivalDate) / (1000 * 60 * 60 * 24)));

        const val = parseFloat(r.netRevenue) || parseFloat(r.totalPrice) || parseFloat(r.price) || 0;
        if (val > 0 && totalReservationNights > 0) {
          totalRevenue += (val / totalReservationNights) * nightsInMonth;
        }
      }
    });

    const emptyRoomsToday = Math.max(0, uniqueRoomNames.length - occupiedRoomsToday);
    const avgPrice = occupiedSlot > 0 ? totalRevenue / occupiedSlot : 0;

    return {
      occupancyRate,
      emptyRoomsToday,
      vacantNights,
      avgPrice,
      totalRevenue,
      // ★ 가중 평균 계산용 추가
      occupiedDays: occupiedSlot,
      availableDays: totalSlot
    };
  };

  // 객실별 예약 매핑
  const roomReservationsMap = useMemo(() => {
    const map = {};
    const viewStart = displayDays[0]?.dateStr;
    const viewEnd = displayDays[displayDays.length - 1]?.dateStr;
    const viewEndExclusive = viewEnd ? dayjs(viewEnd).add(1, 'day').format('YYYY-MM-DD') : null;

    rooms.forEach(room => {
      const roomAll = reservations.filter(r => r.room === room);
      // 베드24 두 ID 모두 예약이 들어가므로, 활성/비활성 구분 없이 보이는 기간과 겹치는 예약은 전부 표시
      map[room] = roomAll.filter((r) => {
        if (!r.arrival || !r.departure || !viewStart || !viewEndExclusive) return false;
        const start = r.arrival > viewStart ? r.arrival : viewStart;
        const endExclusive = r.departure < viewEndExclusive ? r.departure : viewEndExclusive;
        return dayjs(start).isBefore(dayjs(endExclusive));
      });
    });
    return map;
  }, [reservations, rooms, displayDays]);

  // [Single View] 건물 분석 데이터 계산
  const analysis = useMemo(() => {
    // Single View에서는 rooms가 문자열 배열임.
    // calculateBuildingMetrics는 targetRooms를 "객체의 배열"로 기대하고 작성했음 ( name 프로퍼티 접근 ).
    // 따라서 변환 필요.
    const roomObjects = rooms.map(r => ({ name: r }));
    return calculateBuildingMetrics(reservations, roomObjects, daysInMonth, year, month);
  }, [reservations, rooms, daysInMonth, year, month]);

  // ★ min/maxPrice 계산은 별도로 유지 (API 데이터 의존)
  const priceStats = useMemo(() => {
    let minPrice = Infinity;
    let maxPrice = 0;
    if (selectedBuilding !== '전체') {
      for (let d = 1; d <= daysInMonth; d++) {
        const dateKey = `${year}${String(month + 1).padStart(2, '0')}${String(d).padStart(2, '0')}`;
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

        rooms.forEach(roomName => {
          const isReserved = reservations.some(r =>
            r.room === roomName &&
            r.arrival <= dateStr &&
            r.departure > dateStr
          );
          if (isReserved) return;
          const activeInfos = getActiveUnitInfosForDate(roomName, dateStr);
          const roomInfo = activeInfos[0];
          if (!roomInfo) return;
          const priceData = roomPrices[roomInfo.roomId]?.dates?.[dateKey];
          if (priceData) {
            const airbnb = parseInt(priceData.p3) || parseInt(priceData.p1);
            if (!isNaN(airbnb) && airbnb > 0) {
              if (airbnb < minPrice) minPrice = airbnb;
              if (airbnb > maxPrice) maxPrice = airbnb;
            }
          }
        });
      }
    }
    return { minPrice: minPrice === Infinity ? 0 : minPrice, maxPrice };
  }, [reservations, rooms, daysInMonth, year, month, roomPrices, selectedBuilding, getActiveUnitInfosForDate]);

  // analysis 객체에 min/max 병합 (Single View 하위 호환)
  const singleAnalysis = { ...analysis, ...priceStats };



  // 예약 바 렌더링
  const renderReservationBar = (reservation, roomIndex) => {

    const arrivalDate = new Date(reservation.arrival);
    const departureDate = new Date(reservation.departure);

    let startDay, endDay, totalDays;

    if (viewMode === "rolling") {
      // 30일 뷰: rollingStartDate 기준으로 계산 (어제부터 30일)
      const rangeStart = dayjs(rollingStartDate).startOf('day');
      const rangeEnd = rangeStart.add(30, 'day');

      const arrival = dayjs(reservation.arrival).startOf('day');
      const departure = dayjs(reservation.departure).startOf('day');

      // 시작일: 범위 시작 또는 체크인일 중 늦은 날
      const effectiveStart = arrival.isBefore(rangeStart) ? rangeStart : arrival;
      // 종료일: 범위 끝 또는 체크아웃일 중 빠른 날
      const effectiveEnd = departure.isAfter(rangeEnd) ? rangeEnd : departure;

      startDay = effectiveStart.diff(rangeStart, 'day');
      endDay = effectiveEnd.diff(rangeStart, 'day');
      totalDays = 30;
    } else {
      // 월별 뷰: dayjs 사용 (시간대 문제 방지)
      const arrival = dayjs(reservation.arrival).startOf('day');
      const departure = dayjs(reservation.departure).startOf('day');
      const monthStart = dayjs(`${year}-${String(month + 1).padStart(2, '0')}-01`).startOf('day');
      const monthEnd = dayjs(`${year}-${String(month + 1).padStart(2, '0')}-${daysInMonth}`).add(1, 'day').startOf('day');

      // ★ 핵심 수정: 예약이 현재 월에 실제로 속하는지 확인
      // departure가 현재 월 시작일 이전이거나 같으면 → 이미 끝난 예약 (표시 안 함)
      // arrival이 현재 월 종료일 이후이거나 같으면 → 아직 시작 안 한 예약 (표시 안 함)
      if (!departure.isAfter(monthStart) || !arrival.isBefore(monthEnd)) {
        return null;
      }

      startDay = arrival.isBefore(monthStart) ? 0 : arrival.date() - 1;
      // 체크아웃이 다음달 1일과 "같은" 경우도 현재 월 말일까지 표시되어야 함
      endDay = (departure.isAfter(monthEnd) || departure.isSame(monthEnd)) ? daysInMonth : departure.date() - 1;
      totalDays = daysInMonth;
    }

    // 너비와 위치 계산 (반응형 - percentage 기반)
    const leftPercent = (startDay / totalDays) * 100;
    const widthPercent = ((endDay - startDay) / totalDays) * 100;

    // ★ 방어 코드: 비정상 데이터 또는 범위 외 예약 처리
    // 1. 진짜 비정상: 체크아웃이 체크인보다 이전 또는 같음
    if (arrivalDate >= departureDate) {
      console.warn(`🚨 INVALID DATA: ${reservation.guestName} (arrival: ${reservation.arrival} >= departure: ${reservation.departure}) - bookId: ${reservation.bookId}`);
      return null;
    }
    // 2. 범위 외: 현재 보기에서 표시할 날짜가 없음 (정상 동작, 로그 생략)
    if (widthPercent <= 0) {
      return null;
    }

    const isCancelled = reservation.status === "cancelled";
    const isBlackout = reservation.status === "blackout";

    let platformColor = getPlatformColor(reservation.platform);
    if (isCancelled) platformColor = "#8E8E93";
    if (isBlackout) platformColor = "#1D1D1F"; // Blackout은 검은색

    const guestName = reservation.guestName || "Reservation";
    let displayText = `${isCancelled ? "[Cancelled] " : ""}${isBlackout ? "🚫 [Block] " : ""}${guestName}`;
    if (!isBlackout) displayText += ` ${formatPrice(reservation.totalPrice || reservation.price)}`;

    return (
      <div
        key={reservation.bookId || `${reservation.arrival}-${reservation.room}-${reservation.status}`}
        data-no-drag="true"
        onClick={() => setSelectedReservation(reservation)}
        style={{
          position: "absolute",
          left: `${leftPercent}%`,
          width: `${widthPercent}%`,
          top: "50%",
          transform: "translateY(-50%)",
          height: "40px",
          backgroundColor: platformColor,
          border: isCancelled ? "1.5px dashed rgba(255,255,255,0.5)" : "none",
          opacity: isCancelled ? 0.6 : 1,
          borderRadius: "8px",
          color: "white",
          fontSize: "11px",
          fontWeight: "700",
          padding: "4px 10px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          cursor: "pointer",
          boxShadow: isCancelled ? "none" : "0 4px 8px rgba(0,0,0,0.15), inset 0 1px 1px rgba(255,255,255,0.2)",
          transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
          zIndex: isCancelled ? 5 : (isBlackout ? 6 : 10),
          backgroundImage: isBlackout
            ? "repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(255,255,255,0.05) 10px, rgba(255,255,255,0.05) 20px)"
            : "linear-gradient(180deg, rgba(255,255,255,0.1) 0%, rgba(0,0,0,0.05) 100%)",
          display: "flex",
          alignItems: "center",
          gap: "6px"
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "translateY(-50%) translateY(-1px) scale(1.01)";
          e.currentTarget.style.boxShadow = "0 6px 12px rgba(0,0,0,0.25), inset 0 1px 1px rgba(255,255,255,0.3)";
          e.currentTarget.style.zIndex = 25;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "translateY(-50%)";
          e.currentTarget.style.boxShadow = isCancelled ? "none" : "0 4px 8px rgba(0,0,0,0.15), inset 0 1px 1px rgba(255,255,255,0.2)";
          e.currentTarget.style.zIndex = isCancelled ? 5 : (isBlackout ? 6 : 10);
        }}
        title={`${reservation.guestName}\n${reservation.arrival} ~ ${reservation.departure}\n${formatPrice(reservation.totalPrice)}`}
      >
        <span style={{
          display: "inline-block",
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          backgroundColor: "white",
          boxShadow: "0 0 4px rgba(255,255,255,0.8)"
        }}></span>
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{displayText}</span>
      </div>
    );
  };

  return (
    <>
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
      <div className="dashboard-content" style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100%'
      }}>
        {/* 예약 상세 모달 */}
        {selectedReservation && (
          <ReservationDetailModal
            reservation={selectedReservation}
            onClose={() => setSelectedReservation(null)}
            onRefresh={fetchReservations}
            isMobile={isMobile}
          />
        )}

        {/* ══════════════════════════════════════
            모바일 캘린더 뷰 (주간 7일 그리드)
        ══════════════════════════════════════ */}
        {isMobile && (() => {
          const ROOM_W = 48;
          const AVAIL_W = window.innerWidth - 28; // NewLayout 모바일 패딩 14px × 2
          const CELL_W = Math.floor((AVAIL_W - ROOM_W) / 7);
          const weekDays = Array.from({ length: 7 }, (_, i) => mobileWeekStart.add(i, 'day'));
          const todayStr = dayjs().format('YYYY-MM-DD');
          const mobileRooms = selectedBuilding !== '전체' ? (BUILDING_DATA[selectedBuilding] || []) : [];
          const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

          // 모바일 전용 뮤트 컬러 팔레트
          const MC = {
            primary:    '#6E9DC8',   // 차분한 스틸 블루
            primaryBg:  '#EEF5FB',
            sat:        '#7A94C0',   // 차분한 토요일 블루
            sun:        '#C07878',   // 차분한 일요일 레드
            border:     '#EAECF2',
            borderMid:  '#DDE3EE',
            bg:         '#F5F6FA',
            rowLabel:   '#F8FAFC',
          };
          // 모바일 전용 뮤트 플랫폼 색상
          const getMobileColor = (referer) => {
            if (!referer) return '#9AAEC0';
            const p = referer.toLowerCase();
            if (p.includes('airbnb'))  return '#E8788E';  // 소프트 로즈
            if (p.includes('booking')) return '#6E9DC8';  // 스틸 블루
            if (p.includes('expedia')) return '#C8983C';  // 웜 앰버
            if (p.includes('agoda'))   return '#D07868';  // 테라코타
            if (p.includes('direct'))  return '#5AAFC0';  // 소프트 틸
            return '#9AAEC0';                             // 블루그레이
          };

          // 셀 가격 조회 헬퍼
          const getCellPrice = (roomName, dStr) => {
            if (selectedBuilding === '전체') return 0;
            const dateKey = dStr.replace(/-/g, '');
            const activeInfos = getActiveUnitInfosForDate(roomName, dStr);
            const firstRoomInfo = activeInfos[0];
            if (!firstRoomInfo) return 0;
            const priceData = roomPrices?.[firstRoomInfo.roomId]?.dates?.[dateKey];
            return priceData ? (parseFloat(priceData.p1) || 0) : 0;
          };

          // 주 내 예약 통계 (헤더 배지용)
          const weekBookedCount = mobileRooms.reduce((acc, rm) => {
            return acc + weekDays.filter(d => {
              const dStr = d.format('YYYY-MM-DD');
              return reservations.some(r =>
                r.room === rm && r.status !== 'cancelled' &&
                r.arrival <= dStr && r.departure > dStr
              );
            }).length;
          }, 0);
          const weekTotalCells = mobileRooms.length * 7;
          const occupancyPct = weekTotalCells > 0 ? Math.round(weekBookedCount / weekTotalCells * 100) : 0;

          return (
            <div style={{
              display: 'flex', flexDirection: 'column', height: 'calc(100vh - 140px)',
              background: MC.bg,
            }}>

              {/* ① 건물 탭 (수평 스크롤) */}
              <div style={{
                display: 'flex', gap: '7px', padding: '10px 0 8px',
                overflowX: 'auto', flexShrink: 0,
                WebkitOverflowScrolling: 'touch',
                scrollbarWidth: 'none', msOverflowStyle: 'none',
              }}>
                {ACTIVE_BUILDING_ORDER.map(b => {
                  const isActive = selectedBuilding === b;
                  const sold = isBuildingSold(b);
                  return (
                    <button key={b} onClick={() => setSelectedBuilding(b)} style={{
                      padding: '7px 14px', borderRadius: '22px', flexShrink: 0,
                      background: isActive ? MC.primary : '#FFFFFF',
                      color: isActive ? '#fff' : sold ? '#B86060' : '#3A3A4A',
                      fontSize: '12px', fontWeight: isActive ? '600' : '500', cursor: 'pointer',
                      border: isActive ? 'none' : `1px solid ${sold ? '#E8C8C8' : '#DDDDE8'}`,
                      boxShadow: isActive
                        ? '0 2px 8px rgba(110,157,200,0.30)'
                        : '0 1px 3px rgba(0,0,0,0.07)',
                      letterSpacing: '-0.2px',
                      transition: 'all 0.15s ease',
                    }}>
                      {getBuildingNameEN(b)}{sold ? ' ✕' : ''}
                    </button>
                  );
                })}
              </div>

              {/* ② 메인 캘린더 카드 */}
              <div style={{
                flex: 1, background: '#FFFFFF',
                borderRadius: '18px 18px 0 0',
                overflow: 'hidden', display: 'flex', flexDirection: 'column',
                boxShadow: '0 -2px 12px rgba(0,0,0,0.06)',
                minHeight: 0,
              }}>

                {/* 주간 네비게이션 헤더 */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 16px 10px', flexShrink: 0,
                  borderBottom: `1px solid ${MC.border}`,
                  background: '#FFFFFF',
                }}>
                  <button onClick={() => handleMobileWeekNav(-1)} style={{
                    width: '34px', height: '34px', borderRadius: '50%',
                    border: 'none', background: MC.bg,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: MC.primary, fontSize: '20px', lineHeight: 1,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                  }}>‹</button>

                  <div style={{ textAlign: 'center', flex: 1, padding: '0 8px' }}>
                    <div style={{ fontSize: '14px', fontWeight: '600', color: '#2A2A3A', letterSpacing: '-0.3px' }}>
                      {mobileWeekStart.format('MMM D')} – {mobileWeekStart.add(6, 'day').format('MMM D, YYYY')}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px', marginTop: '2px' }}>
                      <span style={{ fontSize: '11px', color: MC.primary, fontWeight: '500' }}>
                        {getBuildingNameEN(selectedBuilding)}
                      </span>
                      {mobileRooms.length > 0 && (
                        <span style={{
                          fontSize: '10px', fontWeight: '600',
                          background: occupancyPct >= 80 ? '#C07070' : occupancyPct >= 50 ? '#C09040' : '#6A9E78',
                          color: '#fff', borderRadius: '6px', padding: '1px 5px',
                        }}>{occupancyPct}%</span>
                      )}
                    </div>
                  </div>

                  <button onClick={() => handleMobileWeekNav(1)} style={{
                    width: '34px', height: '34px', borderRadius: '50%',
                    border: 'none', background: MC.bg,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: MC.primary, fontSize: '20px', lineHeight: 1,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                  }}>›</button>
                </div>

                {/* ③ 캘린더 그리드 */}
                {loading ? (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                    <div style={{
                      width: '28px', height: '28px', borderRadius: '50%',
                      border: `2.5px solid ${MC.border}`, borderTopColor: MC.primary,
                      animation: 'spin 0.8s linear infinite',
                    }} />
                    <span style={{ color: '#AAABB8', fontSize: '12px' }}>Loading...</span>
                  </div>
                ) : (
                  <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', minHeight: 0 }}>
                    <div style={{ overflowX: 'hidden' }}>
                      <div style={{ width: '100%' }}>

                        {/* 날짜 헤더 */}
                        <div style={{
                          display: 'flex', position: 'sticky', top: 0, zIndex: 10,
                          background: '#FFFFFF',
                          borderBottom: `1.5px solid ${MC.border}`,
                          boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
                        }}>
                          <div style={{
                            width: ROOM_W, flexShrink: 0,
                            borderRight: `1.5px solid ${MC.border}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            padding: '8px 0',
                          }}>
                            <span style={{ fontSize: '8px', color: '#C8CAD8', fontWeight: '600', letterSpacing: '0.6px' }}>ROOM</span>
                          </div>
                          {weekDays.map(d => {
                            const dStr = d.format('YYYY-MM-DD');
                            const isToday = dStr === todayStr;
                            const isSun = d.day() === 0;
                            const isSat = d.day() === 6;
                            return (
                              <div key={dStr} style={{
                                width: CELL_W, flexShrink: 0,
                                display: 'flex', flexDirection: 'column', alignItems: 'center',
                                padding: '7px 0 5px',
                                borderRight: isSun ? `1.5px solid ${MC.borderMid}` : `0.5px solid ${MC.border}`,
                                background: isToday ? MC.primaryBg : 'transparent',
                              }}>
                                <span style={{
                                  fontSize: '9px', fontWeight: '600',
                                  color: isSun ? MC.sun : isSat ? MC.sat : '#AAABB8',
                                  letterSpacing: '0.3px',
                                }}>{DAY_LABELS[d.day()]}</span>
                                <div style={{
                                  width: '26px', height: '26px', borderRadius: '50%', marginTop: '2px',
                                  background: isToday ? MC.primary : 'transparent',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  boxShadow: isToday ? '0 2px 6px rgba(110,157,200,0.30)' : 'none',
                                }}>
                                  <span style={{
                                    fontSize: '14px', fontWeight: '600',
                                    color: isToday ? '#fff' : isSun ? MC.sun : isSat ? MC.sat : '#2A2A3A',
                                  }}>{d.format('D')}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* 객실 행 */}
                        {mobileRooms.length > 0 ? mobileRooms.map((room, ri) => (
                          <div key={room} style={{
                            display: 'flex',
                            background: '#FFFFFF',
                            borderBottom: `0.5px solid ${MC.border}`,
                          }}>
                            {/* 방 이름 (고정) */}
                            <div style={{
                              width: ROOM_W, flexShrink: 0, minHeight: '44px',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: '10px', fontWeight: '700', color: '#3A3A4A',
                              borderRight: `1px solid ${MC.border}`,
                              background: MC.rowLabel,
                              position: 'sticky', left: 0, zIndex: 5,
                              letterSpacing: '-0.2px',
                              borderLeft: `2.5px solid ${MC.primary}`,
                            }}>
                              {getRoomNameEN(room)}
                            </div>

                            {/* 날짜 셀 */}
                            {weekDays.map((d, di) => {
                              const dStr = d.format('YYYY-MM-DD');
                              const isToday = dStr === todayStr;
                              const isSun = d.day() === 0;
                              const isSat = d.day() === 6;
                              const res = reservations.find(r =>
                                r.room === room &&
                                r.status !== 'cancelled' &&
                                r.arrival <= dStr && r.departure > dStr
                              );
                              const isCheckIn = res && res.arrival === dStr;
                              const price = !res ? getCellPrice(room, dStr) : 0;
                              const priceStr = price >= 1000
                                ? `¥${(price / 1000).toFixed(price % 1000 === 0 ? 0 : 1)}k`
                                : price > 0 ? `¥${price}` : '';

                              const cellColor = res ? getMobileColor(res.referer || res.platform || res.channel) : null;

                              let cellBg;
                              if (res) {
                                cellBg = cellColor;
                              } else if (isToday) {
                                cellBg = MC.primaryBg;
                              } else if (isSat) {
                                cellBg = '#F5F7FF';
                              } else if (isSun) {
                                cellBg = '#FFF8F8';
                              } else {
                                cellBg = '#FFFFFF';
                              }

                              return (
                                <div
                                  key={dStr}
                                  onClick={() => res && setSelectedReservation(res)}
                                  style={{
                                    width: CELL_W, minHeight: '44px', flexShrink: 0,
                                    background: cellBg,
                                    borderRight: isSun ? `1.5px solid ${MC.borderMid}` : `0.5px solid ${MC.border}`,
                                    cursor: res ? 'pointer' : 'default',
                                    display: 'flex', flexDirection: 'column',
                                    alignItems: 'center', justifyContent: 'center',
                                    overflow: 'hidden', padding: '2px',
                                    WebkitTapHighlightColor: 'transparent',
                                    position: 'relative',
                                    borderLeft: isCheckIn ? '2px solid rgba(255,255,255,0.6)' : 'none',
                                  }}
                                >
                                  {res ? (
                                    <>
                                      <div style={{
                                        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                                        background: 'linear-gradient(180deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0) 50%)',
                                        pointerEvents: 'none',
                                      }} />
                                      {isCheckIn && (
                                        <>
                                          <span style={{
                                            fontSize: '7px', fontWeight: '700',
                                            color: 'rgba(255,255,255,0.9)',
                                            background: 'rgba(0,0,0,0.18)',
                                            borderRadius: '3px', padding: '1px 4px',
                                            marginBottom: '2px', zIndex: 1,
                                          }}>{getPlatformInitial(res.referer || res.platform || res.channel)}</span>
                                          <span style={{
                                            fontSize: '8px', fontWeight: '600', color: '#fff',
                                            maxWidth: '100%', overflow: 'hidden',
                                            textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                            zIndex: 1, paddingLeft: '2px', paddingRight: '2px',
                                            textShadow: '0 1px 3px rgba(0,0,0,0.25)',
                                          }}>{res.guestName ? res.guestName.split(' ')[0] : '●'}</span>
                                        </>
                                      )}
                                    </>
                                  ) : (
                                    priceStr ? (
                                      <span style={{
                                        fontSize: '8px', fontWeight: '500',
                                        color: isToday ? MC.primary : '#B8BECЕ',
                                        letterSpacing: '-0.2px',
                                      }}>{priceStr}</span>
                                    ) : null
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )) : (
                          <div style={{ padding: '48px 16px', textAlign: 'center' }}>
                            <div style={{ color: '#C8CAD8', fontSize: '13px' }}>
                              건물을 선택해주세요
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* ④ 하단 오늘 버튼 */}
                <div style={{ padding: '10px 16px 18px', borderTop: `1px solid ${MC.border}`, flexShrink: 0, background: '#FFFFFF' }}>
                  <button
                    onClick={() => {
                      const today = dayjs();
                      const dow = today.day();
                      const monday = today.add(dow === 0 ? -6 : 1 - dow, 'day');
                      setMobileWeekStart(monday);
                      setCurrentDate(monday.toDate());
                    }}
                    style={{
                      width: '100%', padding: '13px',
                      background: MC.primary,
                      color: '#fff',
                      border: 'none', borderRadius: '12px',
                      fontSize: '14px', fontWeight: '600', cursor: 'pointer',
                      boxShadow: '0 3px 10px rgba(110,157,200,0.28)',
                      letterSpacing: '-0.1px',
                    }}
                  >
                    Today
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ══════════════════════════════════════
            데스크탑 전용 뷰
        ══════════════════════════════════════ */}
        {!isMobile && (<>

        {/* 년/월 선택 모달 */}
        {showMonthPicker && (
          <MonthPickerModal
            year={year}
            month={month}
            onSelect={handleMonthSelect}
            onClose={() => setShowMonthPicker(false)}
          />
        )}

        {/* 가격 설정 모달 */}
        {showPriceModal && selectedRoom && (
          <PriceSettingModal
            building={selectedBuilding}
            room={selectedRoom}
            selectedDates={selectedDates}
            roomPrices={roomPrices} // roomPrices 전체를 넘겨서 내부에서 병합하도록 변경
            onClose={() => setShowPriceModal(false)}
            onSave={() => {
              setSelectedCells([]);
              setSelectedRoom(null);
              // 로컬 프론트엔드 캐시 비우기 (건물별 캐시)
              setPriceCache(prev => {
                const newCache = { ...prev };
                delete newCache[selectedBuilding];
                return newCache;
              });
              // Firestore 캐시가 이미 업데이트되었으므로 새로 읽기
              fetchPrices(true);
            }}
            selectedRooms={selectedRooms}
            companyId={companyId}
          />
        )}

        {showManualBookingModal && (
          <ManualBookingModal
            initialBuilding={selectedBuilding !== "전체" ? selectedBuilding : ""}
            initialRoom={selectedRoom || ""}
            initialDates={selectedDates}
            onClose={() => {
              setShowManualBookingModal(false);
              setSelectedCells([]);
              setSelectedRoom(null);
              setSelectionStart(null);
              setHoveredDay(null);
              setHoveredRoom(null);
            }}
            onSave={() => {
              setShowManualBookingModal(false);
              setSelectedCells([]);
              setSelectedRoom(null);
              setSelectionStart(null);
              setHoveredDay(null);
              setHoveredRoom(null);
              // 예약 목록 다시 불러오기 (페이지 새로고침 없이)
              fetchReservations();
            }}
            companyId={companyId}
          />
        )}

        {/* Gap Edit Modal - 캘린더에서 선택한 방+날짜에 minStay 설정 */}
        {showGapEditModal && (
          <div style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999
          }} onClick={() => setShowGapEditModal(false)}>
            <div style={{
              background: "white",
              borderRadius: "16px",
              padding: "28px",
              width: "420px",
              maxHeight: "80vh",
              overflow: "auto",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)"
            }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
                <h2 style={{ margin: 0, fontSize: "20px", fontWeight: "700", color: "#111827" }}>
                  Set Min Stay
                </h2>
                <button
                  onClick={() => setShowGapEditModal(false)}
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: "24px",
                    cursor: "pointer",
                    color: "#9CA3AF",
                    padding: "4px"
                  }}
                >×</button>
              </div>

              {/* Selection Summary */}
              <div style={{
                background: "#F3F4F6",
                borderRadius: "10px",
                padding: "16px",
                marginBottom: "24px"
              }}>
                <p style={{ margin: "0 0 8px 0", fontSize: "14px", fontWeight: "600", color: "#374151" }}>
                  Selected:
                </p>
                <p style={{ margin: 0, fontSize: "13px", color: "#6B7280" }}>
                  <strong>Rooms:</strong> {selectedRooms.map(r => getRoomNameEN(r)).join(", ")}<br />
                  <strong>Dates:</strong> {selectedDates.length} day(s) - {selectedDates.slice(0, 3).join(", ")}{selectedDates.length > 3 ? ` +${selectedDates.length - 3} more` : ""}
                </p>
              </div>

              {/* Min Stay Toggle */}
              <div style={{ marginBottom: "28px" }}>
                <label style={{ display: "block", fontSize: "14px", fontWeight: "600", color: "#374151", marginBottom: "12px" }}>
                  Min Stay Setting
                </label>
                <div style={{ display: "flex", gap: "12px" }}>
                  <button
                    onClick={() => setGapEditMinStay(1)}
                    style={{
                      flex: 1,
                      padding: "16px",
                      borderRadius: "12px",
                      border: gapEditMinStay === 1 ? "2px solid #10B981" : "2px solid #E5E7EB",
                      background: gapEditMinStay === 1 ? "linear-gradient(135deg, #D1FAE5 0%, #A7F3D0 100%)" : "white",
                      color: gapEditMinStay === 1 ? "#065F46" : "#6B7280",
                      fontSize: "16px",
                      fontWeight: "700",
                      cursor: "pointer",
                      transition: "all 0.2s",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "6px"
                    }}
                  >
                    <span style={{ fontSize: "24px" }}>1</span>
                    <span style={{ fontSize: "12px", fontWeight: "500" }}>Night Min</span>
                  </button>
                  <button
                    onClick={() => setGapEditMinStay(2)}
                    style={{
                      flex: 1,
                      padding: "16px",
                      borderRadius: "12px",
                      border: gapEditMinStay === 2 ? "2px solid #F59E0B" : "2px solid #E5E7EB",
                      background: gapEditMinStay === 2 ? "linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%)" : "white",
                      color: gapEditMinStay === 2 ? "#92400E" : "#6B7280",
                      fontSize: "16px",
                      fontWeight: "700",
                      cursor: "pointer",
                      transition: "all 0.2s",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "6px"
                    }}
                  >
                    <span style={{ fontSize: "24px" }}>2</span>
                    <span style={{ fontSize: "12px", fontWeight: "500" }}>Nights Min</span>
                  </button>
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: "flex", gap: "12px" }}>
                <button
                  onClick={() => {
                    setShowGapEditModal(false);
                  }}
                  style={{
                    flex: 1,
                    padding: "14px",
                    borderRadius: "10px",
                    border: "2px solid #E5E7EB",
                    background: "white",
                    color: "#374151",
                    fontSize: "14px",
                    fontWeight: "600",
                    cursor: "pointer",
                    transition: "all 0.2s"
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    // ★ 중복 클릭 방지 (debounce)
                    if (isGapApplying) {
                      return;
                    }

                    if (selectedRooms.length === 0 || selectedDates.length === 0) {
                      alert("Please select rooms and dates first.");
                      return;
                    }

                    // 처리 시작
                    setIsGapApplying(true);
                    const startTime = Date.now();
                    const datesToSet = selectedDates.map(d => d.replace(/-/g, ''));

                    // ★ 백업 (롤백용)
                    const backupRoomPrices = { ...roomPrices };
                    const backupPriceCache = { ...priceCache };

                    try {
                      // ★ 1단계: 낙관적 UI 업데이트 (API 호출 전 즉시 반영) — 활성 roomId만 (비활성 50/99박 제외)
                      const refDateStr = selectedDates[0] || datesToSet[0]?.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
                      selectedRooms.forEach(roomName => {
                        const roomInfos = refDateStr
                          ? getActiveUnitInfosForDate(roomName, refDateStr)
                          : (BUILDING_ROOMS[selectedBuilding]?.filter(r => r.name === roomName) || []);
                        roomInfos.forEach(roomInfo => {
                          setRoomPrices(prev => {
                            const updated = { ...prev };
                            if (updated[roomInfo.roomId]?.dates) {
                              datesToSet.forEach(dateKey => {
                                if (updated[roomInfo.roomId].dates[dateKey]) {
                                  updated[roomInfo.roomId].dates[dateKey].m = String(gapEditMinStay);
                                }
                              });
                            }
                            return updated;
                          });

                          setPriceCache(prev => {
                            const updated = { ...prev };
                            if (updated[selectedBuilding]?.[roomInfo.roomId]?.dates) {
                              datesToSet.forEach(dateKey => {
                                if (updated[selectedBuilding][roomInfo.roomId].dates[dateKey]) {
                                  updated[selectedBuilding][roomInfo.roomId].dates[dateKey].m = String(gapEditMinStay);
                                }
                              });
                            }
                            return updated;
                          });
                        });
                      });

                      // ★ 2단계: 백그라운드 API 호출 (병렬)
                      const apiCalls = selectedRooms.map(roomName => {
                        const datesObj = {};
                        datesToSet.forEach(d => { datesObj[d] = { m: gapEditMinStay }; });

                        return fetch(`${API_BASE_URL}/setMinStay`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            companyId,
                            building: selectedBuilding,
                            roomName: roomName,
                            dates: datesObj
                          })
                        })
                          .then(response => response.json())
                          .then(result => {
                            if (result.success) {
                              return { success: true, roomName };
                            } else {
                              console.error(`[Gap Apply] API 실패: ${roomName}`, result);
                              return { success: false, roomName, error: result.error };
                            }
                          })
                          .catch(err => {
                            console.error(`[Gap Apply] API 에러: ${roomName}`, err);
                            return { success: false, roomName, error: err.message };
                          });
                      });

                      const timeout = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error("Request timeout (30s)")), 30000)
                      );
                      const results = await Promise.race([Promise.all(apiCalls), timeout]);
                      const successCount = results.filter(r => r.success).length;
                      const failedRooms = results.filter(r => !r.success);

                      const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);

                      // ★ 3단계: 실패 시 롤백
                      if (failedRooms.length > 0) {
                        setRoomPrices(backupRoomPrices);
                        setPriceCache(backupPriceCache);

                        alert(`⚠️ ${failedRooms.length} room(s) failed to update.\n\nFailed rooms:\n${failedRooms.map(r => `- ${r.roomName}`).join('\n')}\n\nSuccessful: ${successCount} rooms`);
                      } else {
                        alert(`✓ ${successCount} room(s) updated!\nMin stay set to ${gapEditMinStay} for ${datesToSet.length} date(s).\n\nTime: ${elapsedTime}s`);
                      }

                      // 모달 닫기 및 초기화
                      setShowGapEditModal(false);
                      setGapEditMode(false);
                      setSelectedCells([]);
                      setSelectedRoom(null);

                      // ★ 4단계: 백그라운드 동기화 (2초 후)
                      setTimeout(() => {
                        setPriceCache(prev => {
                          const newCache = { ...prev };
                          delete newCache[selectedBuilding];
                          return newCache;
                        });
                        fetchPrices(true);
                      }, 2000);

                    } catch (error) {
                      console.error("[Gap Apply] 치명적 에러:", error);
                      // 전체 롤백
                      setRoomPrices(backupRoomPrices);
                      setPriceCache(backupPriceCache);
                      alert(`❌ Failed to update.\n\nError: ${error.message}\n\nAll changes have been rolled back.`);
                    } finally {
                      setIsGapApplying(false);
                    }
                  }}
                  disabled={isGapApplying}
                  style={{
                    flex: 1,
                    padding: "14px",
                    borderRadius: "10px",
                    border: "none",
                    background: isGapApplying
                      ? "#9CA3AF"
                      : gapEditMinStay === 1
                        ? "linear-gradient(135deg, #10B981 0%, #059669 100%)"
                        : "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)",
                    color: "white",
                    fontSize: "14px",
                    fontWeight: "600",
                    cursor: isGapApplying ? "not-allowed" : "pointer",
                    boxShadow: isGapApplying
                      ? "none"
                      : gapEditMinStay === 1
                        ? "0 4px 12px rgba(16, 185, 129, 0.3)"
                        : "0 4px 12px rgba(245, 158, 11, 0.3)",
                    transition: "all 0.2s",
                    opacity: isGapApplying ? 0.7 : 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "8px"
                  }}
                >
                  {isGapApplying ? (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: "spin 1s linear infinite" }}>
                        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                      </svg>
                      Applying...
                    </>
                  ) : (
                    `Apply Min Stay = ${gapEditMinStay}`
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Block Cleanup Modal - 블락/점검 데이터 정리 */}
        {showBlockCleanupModal && (
          <div style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999
          }} onClick={() => setShowBlockCleanupModal(false)}>
            <div style={{
              background: "white",
              borderRadius: "16px",
              width: "600px",
              maxHeight: "80vh",
              overflow: "hidden",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
              display: "flex",
              flexDirection: "column"
            }} onClick={(e) => e.stopPropagation()}>
              {/* Header */}
              <div style={{
                padding: "20px 24px",
                borderBottom: "1px solid #E5E7EB",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center"
              }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: "20px", fontWeight: "700", color: "#111827" }}>
                    🗑️ Block Data Cleanup
                  </h2>
                  <p style={{ margin: "4px 0 0", fontSize: "13px", color: "#6B7280" }}>
                    Blackout/maintenance data stored in Firestore
                  </p>
                </div>
                <button
                  onClick={() => setShowBlockCleanupModal(false)}
                  style={{
                    background: "#F3F4F6",
                    border: "none",
                    fontSize: "18px",
                    cursor: "pointer",
                    color: "#6B7280",
                    padding: "8px 12px",
                    borderRadius: "8px"
                  }}
                >×</button>
              </div>

              {/* Content */}
              <div style={{ flex: 1, overflow: "auto", padding: "16px 24px" }}>
                {blockLoading ? (
                  <div style={{ textAlign: "center", padding: "40px", color: "#6B7280" }}>
                    <div style={{ fontSize: "24px", marginBottom: "12px" }}>⏳</div>
                    Loading...
                  </div>
                ) : blockData.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "40px", color: "#10B981" }}>
                    <div style={{ fontSize: "32px", marginBottom: "12px" }}>✅</div>
                    <div style={{ fontWeight: "600" }}>No block data found!</div>
                    <div style={{ fontSize: "13px", marginTop: "8px", color: "#6B7280" }}>
                      No block/maintenance data found.
                    </div>
                  </div>
                ) : (
                  <>
                    {/* 수기입력과 Beds24 동기화 데이터 구분 안내 */}
                    <div style={{
                      background: "#EFF6FF",
                      border: "1px solid #93C5FD",
                      borderRadius: "10px",
                      padding: "12px 16px",
                      marginBottom: "12px",
                      fontSize: "13px",
                      color: "#1D4ED8"
                    }}>
                      💡 <strong>Manual entries (Direct)</strong> are user-created. Do not delete.
                    </div>
                    <div style={{
                      background: "#FEF2F2",
                      border: "1px solid #FCA5A5",
                      borderRadius: "10px",
                      padding: "12px 16px",
                      marginBottom: "16px",
                      fontSize: "13px",
                      color: "#DC2626"
                    }}>
                      ⚠️ Found <strong>{blockData.filter(b => b.source !== "Direct").length}</strong> Beds24 synced blocks. (Excluding {blockData.filter(b => b.source === "Direct").length} manual entries)
                    </div>

                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                      <thead>
                        <tr style={{ background: "#F9FAFB" }}>
                          <th style={{ padding: "10px 12px", textAlign: "left", borderBottom: "1px solid #E5E7EB", fontWeight: "600" }}>Building</th>
                          <th style={{ padding: "10px 12px", textAlign: "left", borderBottom: "1px solid #E5E7EB", fontWeight: "600" }}>Room</th>
                          <th style={{ padding: "10px 12px", textAlign: "left", borderBottom: "1px solid #E5E7EB", fontWeight: "600" }}>Period</th>
                          <th style={{ padding: "10px 12px", textAlign: "center", borderBottom: "1px solid #E5E7EB", fontWeight: "600" }}>Source</th>
                          <th style={{ padding: "10px 12px", textAlign: "center", borderBottom: "1px solid #E5E7EB", fontWeight: "600" }}>Status</th>
                          <th style={{ padding: "10px 12px", textAlign: "center", borderBottom: "1px solid #E5E7EB", fontWeight: "600" }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {blockData.map((block, idx) => {
                          const isManual = block.source === "Direct";
                          return (
                            <tr key={block.id} style={{
                              borderBottom: "1px solid #F3F4F6",
                              background: isManual ? "#F0F9FF" : "transparent"
                            }}>
                              <td style={{ padding: "10px 12px" }}>{block.building}</td>
                              <td style={{ padding: "10px 12px", fontWeight: "500" }}>{block.room}</td>
                              <td style={{ padding: "10px 12px", color: "#6B7280" }}>
                                {block.arrival} ~ {block.departure}
                              </td>
                              <td style={{ padding: "10px 12px", textAlign: "center" }}>
                                <span style={{
                                  padding: "3px 8px",
                                  borderRadius: "4px",
                                  fontSize: "11px",
                                  fontWeight: "600",
                                  background: isManual ? "#DBEAFE" : "#F3F4F6",
                                  color: isManual ? "#1D4ED8" : "#6B7280"
                                }}>
                                  {isManual ? "📝 Direct" : block.source || "Beds24"}
                                </span>
                              </td>
                              <td style={{ padding: "10px 12px", textAlign: "center" }}>
                                <span style={{
                                  padding: "3px 8px",
                                  borderRadius: "4px",
                                  fontSize: "11px",
                                  fontWeight: "600",
                                  background: block.status === "blackout" ? "#FEE2E2" : "#FEF3C7",
                                  color: block.status === "blackout" ? "#DC2626" : "#D97706"
                                }}>
                                  {block.status}
                                </span>
                              </td>
                              <td style={{ padding: "10px 12px", textAlign: "center" }}>
                                {isManual ? (
                                  <span style={{
                                    padding: "5px 10px",
                                    borderRadius: "6px",
                                    fontSize: "12px",
                                    fontWeight: "500",
                                    color: "#9CA3AF"
                                  }}>
                                    Protected
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => deleteBlockData([block.id])}
                                    disabled={blockDeleting}
                                    style={{
                                      padding: "5px 10px",
                                      borderRadius: "6px",
                                      border: "1px solid #FCA5A5",
                                      background: "white",
                                      color: "#DC2626",
                                      fontSize: "12px",
                                      fontWeight: "500",
                                      cursor: blockDeleting ? "not-allowed" : "pointer"
                                    }}
                                  >
                                    Delete
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </>
                )}
              </div>

              {/* Footer */}
              <div style={{
                padding: "16px 24px",
                borderTop: "1px solid #E5E7EB",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center"
              }}>
                <button
                  onClick={() => fetchBlockData()}
                  disabled={blockLoading}
                  style={{
                    padding: "10px 16px",
                    borderRadius: "8px",
                    border: "1px solid #E5E7EB",
                    background: "white",
                    color: "#374151",
                    fontSize: "13px",
                    fontWeight: "600",
                    cursor: blockLoading ? "not-allowed" : "pointer"
                  }}
                >
                  🔄 Refresh
                </button>

                {/* 수기입력(Direct) 제외한 Beds24 동기화 블락만 삭제 */}
                {blockData.filter(b => b.source !== "Direct").length > 0 && (
                  <button
                    onClick={() => {
                      const deletableBlocks = blockData.filter(b => b.source !== "Direct");
                      if (window.confirm(`Are you sure you want to delete ${deletableBlocks.length} Beds24 synced blocks?\n(${blockData.filter(b => b.source === "Direct").length} manual entries will be protected)`)) {
                        deleteBlockData(deletableBlocks.map(b => b.id));
                      }
                    }}
                    disabled={blockDeleting}
                    style={{
                      padding: "10px 20px",
                      borderRadius: "8px",
                      border: "none",
                      background: blockDeleting ? "#9CA3AF" : "linear-gradient(135deg, #EF4444 0%, #DC2626 100%)",
                      color: "white",
                      fontSize: "13px",
                      fontWeight: "600",
                      cursor: blockDeleting ? "not-allowed" : "pointer",
                      boxShadow: "0 4px 12px rgba(239, 68, 68, 0.3)"
                    }}
                  >
                    {blockDeleting ? "Deleting..." : `🗑️ Delete Beds24 Blocks (${blockData.filter(b => b.source !== "Direct").length})`}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 헤더 - Premium Design */}
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "24px",
          paddingBottom: "20px",
          borderBottom: "1px solid #E5E7EB"
        }}>
          <div>
            <h1 style={{
              fontSize: "28px",
              fontWeight: "700",
              color: "#1E293B",
              margin: 0,
              marginBottom: "8px"
            }}>
              Room Calendar
            </h1>
            <p style={{
              fontSize: "14px",
              color: "#64748B",
              margin: 0
            }}>
              Manage reservations and pricing for all properties
            </p>
          </div>
          <div style={{ display: "flex", gap: "12px" }}>
            {!priceMode && selectedBuilding !== "전체" && (
              <>
                <button
                  onClick={() => setShowCancelled(!showCancelled)}
                  style={{
                    padding: "12px 20px",
                    background: showCancelled
                      ? "linear-gradient(135deg, #6B7280 0%, #4B5563 100%)"
                      : "#F9FAFB",
                    color: showCancelled ? "white" : "#374151",
                    border: showCancelled ? "none" : "1px solid #E5E7EB",
                    borderRadius: "12px",
                    fontWeight: "600",
                    fontSize: "13px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                    boxShadow: showCancelled ? "0 4px 12px rgba(107, 114, 128, 0.3)" : "none"
                  }}
                  onMouseEnter={(e) => {
                    if (!showCancelled) {
                      e.currentTarget.style.background = "#F3F4F6";
                      e.currentTarget.style.borderColor = "#D1D5DB";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!showCancelled) {
                      e.currentTarget.style.background = "#F9FAFB";
                      e.currentTarget.style.borderColor = "#E5E7EB";
                    }
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                  </svg>
                  {showCancelled ? "Hide Cancelled" : "Show Cancelled"}
                </button>

                <button
                  onClick={() => setShowManualBookingModal(true)}
                  style={{
                    padding: "12px 24px",
                    background: "linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)",
                    color: "white",
                    border: "none",
                    borderRadius: "12px",
                    fontWeight: "600",
                    fontSize: "13px",
                    cursor: "pointer",
                    boxShadow: "0 4px 14px rgba(59, 130, 246, 0.4)",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "translateY(-2px)";
                    e.currentTarget.style.boxShadow = "0 8px 20px rgba(59, 130, 246, 0.5)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = "0 4px 14px rgba(59, 130, 246, 0.4)";
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Add Reservation
                </button>
              </>
            )}
          </div>
        </div>

        {/* 건물 탭 - Premium Design */}
        <div style={{
          display: "flex",
          gap: "10px",
          marginBottom: "24px",
          overflowX: "auto",
          paddingBottom: "8px",
          scrollbarWidth: "none",
          msOverflowStyle: "none"
        }}>
          {["전체", ...ACTIVE_BUILDING_ORDER].map(building => {
            const isActive = selectedBuilding === building;
            const isSold = isBuildingSold(building);

            return (
              <button
                key={building}
                onClick={() => setSelectedBuilding(building)}
                style={{
                  padding: "12px 20px",
                  borderRadius: "12px",
                  border: isActive ? "none" : "1px solid #E5E7EB",
                  background: isActive
                    ? "linear-gradient(135deg, #1F2937 0%, #111827 100%)"
                    : isSold ? "#FEF2F2" : "white",
                  color: isActive ? "white" : isSold ? "#991B1B" : "#4B5563",
                  fontWeight: "600",
                  fontSize: "13px",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                  boxShadow: isActive
                    ? "0 4px 14px rgba(31, 41, 55, 0.3)"
                    : "0 1px 3px rgba(0,0,0,0.05)",
                  position: "relative",
                  overflow: "hidden"
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = isSold ? "#FEE2E2" : "#F9FAFB";
                    e.currentTarget.style.borderColor = "#D1D5DB";
                    e.currentTarget.style.transform = "translateY(-1px)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = isSold ? "#FEF2F2" : "white";
                    e.currentTarget.style.borderColor = "#E5E7EB";
                    e.currentTarget.style.transform = "translateY(0)";
                  }
                }}
              >
                {getBuildingNameEN(building)}{isSold && " (Sold)"}
              </button>
            );
          })}
        </div>

        {/* 전체 선택 시 분석 대시보드 */}
        {selectedBuilding === "전체" ? (
          <div style={{
            background: "white",
            borderRadius: "20px",
            padding: "28px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
            border: "1px solid #F3F4F6"
          }}>
            <h3 style={{
              fontSize: "20px",
              fontWeight: "700",
              marginBottom: "24px",
              color: "#111827",
              display: "flex",
              alignItems: "center",
              gap: "10px"
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2">
                <line x1="18" y1="20" x2="18" y2="10" />
                <line x1="12" y1="20" x2="12" y2="4" />
                <line x1="6" y1="20" x2="6" y2="14" />
              </svg>
              {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month]} {year} Portfolio Overview
            </h3>

            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
              <thead>
                <tr style={{ background: "linear-gradient(135deg, #F9FAFB 0%, #F3F4F6 100%)" }}>
                  <th style={{ padding: "14px 16px", textAlign: "left", borderRadius: "10px 0 0 10px", fontWeight: "600", color: "#374151" }}>Property</th>
                  <th style={{ padding: "14px 16px", textAlign: "center", fontWeight: "600", color: "#374151" }}>Occupancy</th>
                  <th style={{ padding: "14px 16px", textAlign: "center", fontWeight: "600", color: "#374151" }}>Vacant</th>
                  <th style={{ padding: "14px 16px", textAlign: "right", fontWeight: "600", color: "#374151" }}>Avg. Rate</th>
                  <th style={{ padding: "14px 16px", textAlign: "right", borderRadius: "0 10px 10px 0", fontWeight: "600", color: "#374151" }}>Net Revenue</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  // ★ 가중 평균용 변수 (점유일/가용일 집계)
                  let totalOccupiedDays = 0;
                  let totalAvailableDays = 0;
                  let totalVacantNights = 0;
                  let totalPriceSum = 0;
                  let priceCount = 0;
                  let totalNetRevenue = 0;

                  const rows = ACTIVE_BUILDING_ORDER.map(bName => {
                    // 각 건물별 예약 필터링
                    const bReservations = reservations.filter(r => r.building === bName);
                    const bRooms = BUILDING_ROOMS[bName] || [];

                    // ★ 공통 함수로 메트릭 계산
                    const metrics = calculateBuildingMetrics(bReservations, bRooms, daysInMonth, year, month);

                    const occupancy = metrics.occupancyRate;
                    const vacantNights = metrics.vacantNights || 0; // 월간 총 공실 박수
                    const avgPrice = metrics.avgPrice;
                    const netRev = metrics.totalRevenue;

                    // ★ 가중 평균 집계 (사노시 제외)
                    if (bName !== "사노시") {
                      totalOccupiedDays += metrics.occupiedDays || 0;
                      totalAvailableDays += metrics.availableDays || 0;
                    }
                    totalVacantNights += vacantNights;
                    totalPriceSum += avgPrice;
                    if (avgPrice > 0) priceCount++;
                    totalNetRevenue += netRev;

                    // 확장 여부 확인
                    const isExpanded = expandedBuildings.includes(bName);
                    const toggleExpand = () => {
                      if (isExpanded) {
                        setExpandedBuildings(expandedBuildings.filter(b => b !== bName));
                      } else {
                        setExpandedBuildings([...expandedBuildings, bName]);
                      }
                    };

                    // 객실별 행 생성 (확장되었을 때만) - 고유한 객실 이름으로 합침
                    const uniqueRoomNames = [...new Set(bRooms.map(r => r.name))];
                    const roomRows = isExpanded ? uniqueRoomNames.map(roomName => {
                      const rReservations = bReservations.filter(r => r.room === roomName);
                      // 해당 이름의 모든 roomId들을 합쳐서 하나의 객실로 계산
                      const roomInfosForName = bRooms.filter(r => r.name === roomName);
                      const rMetrics = calculateBuildingMetrics(rReservations, roomInfosForName, daysInMonth, year, month);

                      return (
                        <tr key={roomName} style={{ background: "#FAFAFA", fontSize: "13px", color: "#666" }}>
                          <td style={{ padding: "12px 12px 12px 32px", borderBottom: "1px solid #E5E5EA" }}>└ {getRoomNameEN(roomName)}</td>
                          <td style={{ padding: "12px", textAlign: "center", borderBottom: "1px solid #E5E5EA" }}>
                            {rMetrics.occupancyRate.toFixed(1)}%
                          </td>
                          <td style={{ padding: "12px", textAlign: "center", borderBottom: "1px solid #E5E5EA" }}>
                            {rMetrics.vacantNights} nights
                          </td>
                          <td style={{ padding: "12px", textAlign: "right", borderBottom: "1px solid #E5E5EA" }}>¥{Math.round(rMetrics.avgPrice).toLocaleString()}</td>
                          <td style={{ padding: "12px", textAlign: "right", borderBottom: "1px solid #E5E5EA" }}>¥{Math.round(rMetrics.totalRevenue).toLocaleString()}</td>
                        </tr>
                      );
                    }) : null;

                    return (
                      <React.Fragment key={bName}>
                        <tr style={{ borderBottom: "1px solid #E5E5EA", transition: "background 0.2s" }} onClick={toggleExpand}>
                          <td style={{ padding: "16px 12px", fontWeight: "600", cursor: "pointer", display: "flex", alignItems: "center", gap: "8px" }}>
                            <span style={{ fontSize: "12px", color: "#86868B", transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>▶</span>
                            {getBuildingNameEN(bName)}
                          </td>
                          <td style={{ padding: "16px 12px", textAlign: "center" }}>
                            <span style={{
                              padding: "4px 8px",
                              borderRadius: "4px",
                              background: occupancy >= 80 ? "#E8F5E9" : occupancy >= 60 ? "#FFF3E0" : "#FFEBEE",
                              color: occupancy >= 80 ? "#2E7D32" : occupancy >= 60 ? "#EF6C00" : "#C62828",
                              fontWeight: "700"
                            }}>
                              {occupancy.toFixed(1)}%
                            </span>
                          </td>
                          <td style={{ padding: "16px 12px", textAlign: "center", color: "#86868B" }}>
                            {vacantNights} nights
                          </td>
                          <td style={{ padding: "16px 12px", textAlign: "right" }}>¥{Math.round(avgPrice).toLocaleString()}</td>
                          <td style={{ padding: "16px 12px", textAlign: "right", fontWeight: "700", color: "#0071E3" }}>¥{Math.round(netRev).toLocaleString()}</td>
                        </tr>
                        {roomRows}
                      </React.Fragment>
                    );
                  });

                  // ★ 가중 평균: 전체 점유일 / 전체 가용일 (OccupancyRateDashboard와 동일)
                  const totalAvgOccupancy = totalAvailableDays > 0 ? (totalOccupiedDays / totalAvailableDays) * 100 : 0;
                  const totalAvgPrice = priceCount > 0 ? totalPriceSum / priceCount : 0;

                  return (
                    <>
                      {rows}
                      <tr style={{ background: "#F9F9F9", borderTop: "2px solid #E5E5EA", fontWeight: "700" }}>
                        <td style={{ padding: "16px 12px" }}>Grand Total</td>
                        <td style={{ padding: "16px 12px", textAlign: "center" }}>
                          {totalAvgOccupancy.toFixed(1)}%
                          <span style={{ fontSize: "10px", fontWeight: "400", color: "#86868B", display: "block" }}>(Excluding Sano)</span>
                        </td>
                        <td style={{ padding: "16px 12px", textAlign: "center" }}>{totalVacantNights} nights</td>
                        <td style={{ padding: "16px 12px", textAlign: "right" }}>¥{Math.round(totalAvgPrice).toLocaleString()}</td>
                        <td style={{ padding: "16px 12px", textAlign: "right", color: "#0071E3", fontSize: "16px" }}>¥{Math.round(totalNetRevenue).toLocaleString()}</td>
                      </tr>
                    </>
                  );
                })()}

              </tbody>
            </table>
          </div>
        ) : (
          /* 기존 캘린더 그리드 */
          <div>
            {/* 가격 모드 툴바 - Premium Design */}
            {priceMode && (
              <div style={{
                marginBottom: "20px",
                background: "linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%)",
                padding: "20px 24px",
                borderRadius: "16px",
                border: "1px solid #FCD34D",
                boxShadow: "0 4px 16px rgba(251, 191, 36, 0.15)"
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                    <div style={{
                      width: "48px",
                      height: "48px",
                      borderRadius: "12px",
                      background: "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: "0 4px 12px rgba(245, 158, 11, 0.3)"
                    }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                        <line x1="12" y1="1" x2="12" y2="23" />
                        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                      </svg>
                    </div>
                    <div>
                      <div style={{ fontWeight: "700", color: "#92400E", fontSize: "18px" }}>
                        Price Settings Mode
                      </div>
                      <div style={{ fontSize: "14px", color: "#B45309", marginTop: "2px" }}>
                        {selectedRooms.length > 0
                          ? `${selectedRooms.length} rooms · ${selectedDates.length} days selected`
                          : "Select rooms and dates to adjust pricing"}
                      </div>
                      {lastPriceSync && (
                        <div style={{
                          fontSize: "12px",
                          color: "#059669",
                          marginTop: "6px",
                          display: "flex",
                          alignItems: "center",
                          gap: "4px"
                        }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          Synced {Math.round((new Date() - lastPriceSync) / 60000)} min ago
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "10px" }}>
                    <button
                      onClick={() => navigate('/price-history')}
                      style={{
                        padding: "10px 18px",
                        borderRadius: "10px",
                        border: "1px solid #E5E7EB",
                        background: "white",
                        cursor: "pointer",
                        color: "#374151",
                        fontSize: "13px",
                        fontWeight: "600",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        transition: "all 0.2s"
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "#F9FAFB"}
                      onMouseLeave={(e) => e.currentTarget.style.background = "white"}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                        <line x1="16" y1="17" x2="8" y2="17" />
                      </svg>
                      History
                    </button>
                    <button
                      onClick={() => fetchPrices(true)}
                      disabled={pricesLoading}
                      style={{
                        padding: "10px 18px",
                        borderRadius: "10px",
                        border: "1px solid #E5E7EB",
                        background: "white",
                        cursor: pricesLoading ? "not-allowed" : "pointer",
                        color: "#374151",
                        fontSize: "13px",
                        fontWeight: "600",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        opacity: pricesLoading ? 0.7 : 1,
                        transition: "all 0.2s"
                      }}
                      onMouseEnter={(e) => !pricesLoading && (e.currentTarget.style.background = "#F9FAFB")}
                      onMouseLeave={(e) => e.currentTarget.style.background = "white"}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        style={{ animation: pricesLoading ? "spin 1s linear infinite" : "none" }}
                      >
                        <polyline points="23 4 23 10 17 10" />
                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                      </svg>
                      Refresh
                    </button>

                    {/* 가격 로드 실패 알림 */}
                    {pricesError && (
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px", background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: "8px", fontSize: "12px", color: "#DC2626", fontWeight: "600" }}>
                        ⚠️ Failed to load prices.
                        <span
                          style={{ cursor: "pointer", textDecoration: "underline" }}
                          onClick={() => { setPricesError(false); fetchPrices(true); }}
                        >Retry</span>
                      </div>
                    )}

                    {/* Gap Edit Mode 버튼 - 직접 선택 */}
                    <button
                      onClick={() => {
                        if (!gapEditMode) {
                          // Gap Edit 모드 활성화
                          setGapEditMode(true);
                          setSelectedCells([]);
                          setSelectedRoom(null);
                        } else {
                          // 선택된 항목이 있으면 모달 열기
                          if (selectedDates.length > 0 && selectedRooms.length > 0) {
                            setShowGapEditModal(true);
                          } else {
                            alert("Please select rooms and dates on the calendar first.");
                          }
                        }
                      }}
                      style={{
                        padding: "10px 18px",
                        borderRadius: "10px",
                        border: gapEditMode ? "2px solid #8B5CF6" : "none",
                        background: gapEditMode
                          ? "linear-gradient(135deg, #EDE9FE 0%, #DDD6FE 100%)"
                          : "linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)",
                        cursor: "pointer",
                        color: gapEditMode ? "#5B21B6" : "white",
                        fontSize: "13px",
                        fontWeight: "600",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        boxShadow: gapEditMode
                          ? "0 0 0 3px rgba(139, 92, 246, 0.3)"
                          : "0 4px 12px rgba(139, 92, 246, 0.3)",
                        transition: "all 0.2s"
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.transform = "translateY(-1px)"}
                      onMouseLeave={(e) => e.currentTarget.style.transform = "translateY(0)"}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                      {gapEditMode
                        ? (selectedDates.length > 0 ? `Apply (${selectedRooms.length} room, ${selectedDates.length} dates)` : "Select on Calendar")
                        : "Manual Edit"}
                    </button>

                    {/* Gap Edit 모드 취소 버튼 */}
                    {gapEditMode && (
                      <button
                        onClick={() => {
                          setGapEditMode(false);
                          setSelectedCells([]);
                          setSelectedRoom(null);
                        }}
                        style={{
                          padding: "10px 14px",
                          borderRadius: "10px",
                          border: "1px solid #E5E7EB",
                          background: "white",
                          cursor: "pointer",
                          color: "#6B7280",
                          fontSize: "13px",
                          fontWeight: "600",
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          transition: "all 0.2s"
                        }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                        Cancel
                      </button>
                    )}

                    {/* 블락 정리 버튼 */}
                    <button
                      onClick={() => {
                        setShowBlockCleanupModal(true);
                        fetchBlockData();
                      }}
                      style={{
                        padding: "10px 14px",
                        borderRadius: "10px",
                        border: "1px solid #FCA5A5",
                        background: "linear-gradient(135deg, #FEF2F2 0%, #FEE2E2 100%)",
                        cursor: "pointer",
                        color: "#DC2626",
                        fontSize: "13px",
                        fontWeight: "600",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        transition: "all 0.2s"
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "#FEE2E2"}
                      onMouseLeave={(e) => e.currentTarget.style.background = "linear-gradient(135deg, #FEF2F2 0%, #FEE2E2 100%)"}
                      title="Clean up blackout/maintenance data stored in Firestore"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                      Clean Blocks
                    </button>

                    <button
                      onClick={togglePriceMode}
                      style={{
                        padding: "10px 18px",
                        borderRadius: "10px",
                        border: "none",
                        background: "linear-gradient(135deg, #EF4444 0%, #DC2626 100%)",
                        color: "white",
                        cursor: "pointer",
                        fontWeight: "600",
                        fontSize: "13px",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        boxShadow: "0 4px 12px rgba(239, 68, 68, 0.3)",
                        transition: "all 0.2s"
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.transform = "translateY(-1px)"}
                      onMouseLeave={(e) => e.currentTarget.style.transform = "translateY(0)"}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                      Exit
                    </button>
                  </div>
                </div>

                {/* Gap Edit Mode 안내 배너 */}
                {gapEditMode && (
                  <div style={{
                    marginTop: "16px",
                    background: "linear-gradient(135deg, #EDE9FE 0%, #DDD6FE 100%)",
                    padding: "16px 20px",
                    borderRadius: "12px",
                    border: "2px solid #8B5CF6",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between"
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <div style={{
                        width: "36px",
                        height: "36px",
                        borderRadius: "10px",
                        background: "linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center"
                      }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </div>
                      <div>
                        <div style={{ fontWeight: "700", color: "#5B21B6", fontSize: "15px" }}>
                          Gap Edit Mode - Select rooms and dates on the calendar
                        </div>
                        <div style={{ fontSize: "13px", color: "#7C3AED", marginTop: "2px" }}>
                          {selectedRooms.length > 0
                            ? `${selectedRooms.length} room(s), ${selectedDates.length} date(s) selected`
                            : "Click on calendar cells to select"}
                        </div>
                      </div>
                    </div>
                    {selectedDates.length > 0 && selectedRooms.length > 0 && (
                      <button
                        onClick={() => setShowGapEditModal(true)}
                        style={{
                          padding: "10px 20px",
                          borderRadius: "10px",
                          border: "none",
                          background: "linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)",
                          color: "white",
                          fontSize: "13px",
                          fontWeight: "600",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "6px",
                          boxShadow: "0 4px 12px rgba(139, 92, 246, 0.3)"
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        Apply Selection
                      </button>
                    )}
                  </div>
                )}

                {/* 필터 버튼 그룹 (Row 1: 상단 필터) - Premium Design */}
                <div style={{ display: "flex", gap: "14px", flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      onClick={toggleSelectAllRooms}
                      style={{
                        padding: "8px 14px",
                        borderRadius: "8px",
                        border: selectedRooms.length === rooms.length ? "none" : "1px solid #D1D5DB",
                        background: selectedRooms.length === rooms.length
                          ? "linear-gradient(135deg, #1F2937 0%, #111827 100%)"
                          : "white",
                        color: selectedRooms.length === rooms.length ? "white" : "#374151",
                        fontSize: "12px",
                        cursor: "pointer",
                        fontWeight: "600",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        transition: "all 0.2s",
                        boxShadow: selectedRooms.length === rooms.length ? "0 2px 8px rgba(31, 41, 55, 0.3)" : "none"
                      }}
                    >
                      {selectedRooms.length === rooms.length && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                      {selectedRooms.length === rooms.length ? "Deselect All" : "Select All Rooms"}
                    </button>
                  </div>
                  <div style={{ width: "1px", height: "24px", background: "#E5E7EB" }}></div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button onClick={() => selectDatesByFilter('all')} style={filterBtnStyle}>All Days</button>
                    <button onClick={() => selectDatesByFilter('weekday')} style={filterBtnStyle}>Weekdays</button>
                    <button onClick={() => selectDatesByFilter('weekend')} style={filterBtnStyle}>Weekends</button>
                  </div>

                  <div style={{ width: "1px", height: "24px", background: "#E5E7EB" }}></div>
                  <div style={{ display: "flex", gap: "4px" }}>
                    {["S", "M", "T", "W", "T", "F", "S"].map((d, idx) => (
                      <button key={`day-${idx}`} onClick={() => selectDatesByFilter(idx)} style={dayBtnStyle}>{d}</button>
                    ))}
                  </div>

                  <div style={{ flex: 1 }}></div>

                  <div style={{ display: "flex", gap: "10px" }}>
                    <button
                      onClick={() => { setSelectedCells([]); setSelectedRoom(null); }}
                      style={{
                        padding: "10px 18px",
                        borderRadius: "10px",
                        border: "1px solid #E5E7EB",
                        background: "white",
                        cursor: "pointer",
                        fontWeight: "600",
                        fontSize: "13px",
                        color: "#6B7280",
                        transition: "all 0.2s"
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "#F9FAFB"}
                      onMouseLeave={(e) => e.currentTarget.style.background = "white"}
                    >
                      Clear Selection
                    </button>
                    <button
                      onClick={openPriceModal}
                      style={{
                        padding: "10px 22px",
                        borderRadius: "10px",
                        border: "none",
                        background: "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)",
                        color: "white",
                        cursor: "pointer",
                        fontWeight: "700",
                        fontSize: "13px",
                        boxShadow: "0 4px 14px rgba(245, 158, 11, 0.4)",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        transition: "all 0.2s"
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.transform = "translateY(-1px)"}
                      onMouseLeave={(e) => e.currentTarget.style.transform = "translateY(0)"}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      Apply Price ({selectedRooms.length} rooms)
                    </button>
                  </div>
                </div>

                {/* Row 2: 주간 선택 그리드 (가로형) - Premium Design */}
                <div style={{ marginTop: "20px", paddingTop: "20px", borderTop: "1px solid #FCD34D" }}>
                  <div style={{ fontSize: "14px", fontWeight: "600", marginBottom: "14px", color: "#92400E", display: "flex", alignItems: "center", gap: "8px" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                    <span>Weekly Selection</span>
                    <span style={{ fontSize: "12px", color: "#B45309", fontWeight: "400" }}>(Click to add specific weeks)</span>
                  </div>
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(5, 1fr)",
                    gap: "14px",
                    background: "white",
                    padding: "18px",
                    borderRadius: "14px",
                    border: "1px solid #E5E7EB",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.04)"
                  }}>
                    {[1, 2, 3, 4, 5].map(week => (
                      <div key={week} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        <div style={{
                          fontSize: "13px",
                          fontWeight: "700",
                          color: "#374151",
                          textAlign: "center",
                          marginBottom: "6px",
                          padding: "6px",
                          background: "#F9FAFB",
                          borderRadius: "6px"
                        }}>
                          Week {week}
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); selectWeek(week, 'all'); }}
                          style={{ ...filterBtnStyle, background: "#F3F4F6", border: "none", fontWeight: "600", color: "#374151" }}
                        >
                          All
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); selectWeek(week, 'weekday'); }}
                          style={{ ...filterBtnStyle, color: "#374151" }}
                        >
                          Weekdays
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); selectWeek(week, 'weekend'); }}
                          style={{ ...filterBtnStyle, color: "#EF4444" }}
                        >
                          Weekends
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 월 네비게이션 - Premium Design */}
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "20px",
          background: "white",
          padding: "16px 24px",
          borderRadius: "16px",
          boxShadow: "0 4px 16px rgba(0,0,0,0.06)",
          border: "1px solid #F3F4F6"
        }}>
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            {/* 뷰 모드 전환 버튼 */}
            <button
              onClick={toggleViewMode}
              style={{
                padding: "10px 16px",
                borderRadius: "10px",
                border: viewMode === "rolling" ? "2px solid #7C3AED" : "1px solid #E5E7EB",
                background: viewMode === "rolling" ? "linear-gradient(135deg, #EDE9FE 0%, #DDD6FE 100%)" : "white",
                color: viewMode === "rolling" ? "#7C3AED" : "#4B5563",
                cursor: "pointer",
                fontWeight: "600",
                fontSize: "13px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                transition: "all 0.2s"
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              {viewMode === "rolling" ? "30-Day View" : "Monthly"}
            </button>

            <div style={{ width: "1px", height: "24px", background: "#E5E7EB", margin: "0 4px" }}></div>

            {viewMode === "monthly" ? (
              /* 월별 뷰 컨트롤 */
              <>
                <button
                  onClick={goToPrevMonth}
                  style={{
                    padding: "10px 16px",
                    borderRadius: "10px",
                    border: "1px solid #E5E7EB",
                    background: "white",
                    cursor: "pointer",
                    fontWeight: "600",
                    fontSize: "13px",
                    color: "#374151",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    transition: "all 0.2s"
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "#F9FAFB"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "white"}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                  Prev
                </button>
                <button
                  onClick={goToToday}
                  style={{
                    padding: "10px 18px",
                    borderRadius: "10px",
                    border: "none",
                    background: "linear-gradient(135deg, #10B981 0%, #059669 100%)",
                    color: "white",
                    cursor: "pointer",
                    fontWeight: "600",
                    fontSize: "13px",
                    boxShadow: "0 4px 12px rgba(16, 185, 129, 0.3)",
                    transition: "all 0.2s"
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.transform = "translateY(-1px)"}
                  onMouseLeave={(e) => e.currentTarget.style.transform = "translateY(0)"}
                >
                  Today
                </button>
                <button
                  onClick={goToNextMonth}
                  style={{
                    padding: "10px 16px",
                    borderRadius: "10px",
                    border: "1px solid #E5E7EB",
                    background: "white",
                    cursor: "pointer",
                    fontWeight: "600",
                    fontSize: "13px",
                    color: "#374151",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    transition: "all 0.2s"
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "#F9FAFB"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "white"}
                >
                  Next
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </>
            ) : (
              /* 30일 롤링 뷰 컨트롤 */
              <>
                <button
                  onClick={goToRollingPrev}
                  style={{
                    padding: "10px 16px",
                    borderRadius: "10px",
                    border: "1px solid #E5E7EB",
                    background: "white",
                    cursor: "pointer",
                    fontWeight: "600",
                    fontSize: "13px",
                    color: "#374151",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    transition: "all 0.2s"
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "#F9FAFB"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "white"}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                  Prev 30 Days
                </button>
                <button
                  onClick={goToRollingToday}
                  style={{
                    padding: "10px 18px",
                    borderRadius: "10px",
                    border: "none",
                    background: "linear-gradient(135deg, #10B981 0%, #059669 100%)",
                    color: "white",
                    cursor: "pointer",
                    fontWeight: "600",
                    fontSize: "13px",
                    boxShadow: "0 4px 12px rgba(16, 185, 129, 0.3)",
                    transition: "all 0.2s"
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.transform = "translateY(-1px)"}
                  onMouseLeave={(e) => e.currentTarget.style.transform = "translateY(0)"}
                >
                  From Today
                </button>
                <button
                  onClick={goToRollingNext}
                  style={{
                    padding: "10px 16px",
                    borderRadius: "10px",
                    border: "1px solid #E5E7EB",
                    background: "white",
                    cursor: "pointer",
                    fontWeight: "600",
                    fontSize: "13px",
                    color: "#374151",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    transition: "all 0.2s"
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "#F9FAFB"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "white"}
                >
                  Next 30 Days
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
                <span style={{
                  fontSize: "13px",
                  color: "#6B7280",
                  marginLeft: "8px",
                  padding: "6px 12px",
                  background: "#F9FAFB",
                  borderRadius: "8px"
                }}>
                  {dayjs(rollingStartDate).format('M/D')} ~ {dayjs(rollingStartDate).add(29, 'day').format('M/D')}
                </span>
              </>
            )}

            <div style={{ width: "1px", height: "24px", background: "#E5E7EB", margin: "0 4px" }}></div>

            {!priceMode && selectedBuilding !== "전체" && (
              <button
                onClick={togglePriceMode}
                style={{
                  padding: "10px 18px",
                  borderRadius: "10px",
                  border: "none",
                  background: "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)",
                  color: "white",
                  cursor: "pointer",
                  fontWeight: "600",
                  fontSize: "13px",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  boxShadow: "0 4px 12px rgba(245, 158, 11, 0.3)",
                  transition: "all 0.2s"
                }}
                onMouseEnter={(e) => e.currentTarget.style.transform = "translateY(-1px)"}
                onMouseLeave={(e) => e.currentTarget.style.transform = "translateY(0)"}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="1" x2="12" y2="23" />
                  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
                Edit Price
              </button>
            )}

            <button
              onClick={() => navigate('/price-history')}
              style={{
                padding: "10px 18px",
                borderRadius: "10px",
                border: "1px solid #E5E7EB",
                background: "white",
                color: "#4B5563",
                cursor: "pointer",
                fontWeight: "600",
                fontSize: "13px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                transition: "all 0.2s"
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = "#F9FAFB"}
              onMouseLeave={(e) => e.currentTarget.style.background = "white"}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Price History
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
            {/* 연/월 표시 */}
            <div
              onClick={() => setShowMonthPicker(true)}
              style={{
                fontSize: "18px",
                fontWeight: "700",
                color: "#111827",
                cursor: "pointer",
                padding: "10px 18px",
                borderRadius: "12px",
                transition: "all 0.2s",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                background: "#F9FAFB",
                border: "1px solid #E5E7EB"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#F3F4F6";
                e.currentTarget.style.borderColor = "#D1D5DB";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#F9FAFB";
                e.currentTarget.style.borderColor = "#E5E7EB";
              }}
            >
              {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month]} {year}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>

            {/* 범례 */}
            <div style={{ display: "flex", gap: "16px", fontSize: "12px", color: "#6B7280" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{
                  width: "14px",
                  height: "14px",
                  borderRadius: "4px",
                  background: PLATFORM_COLORS.Airbnb,
                  boxShadow: "0 2px 4px rgba(255, 56, 92, 0.3)"
                }}></span>
                <span style={{ fontWeight: "500" }}>Airbnb</span>
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{
                  width: "14px",
                  height: "14px",
                  borderRadius: "4px",
                  background: PLATFORM_COLORS.Booking,
                  boxShadow: "0 2px 4px rgba(0, 53, 128, 0.3)"
                }}></span>
                <span style={{ fontWeight: "500" }}>Booking</span>
              </span>
            </div>
          </div>
        </div>

        {/* 캘린더 그리드 */}
        <div style={{
          background: "white",
          borderRadius: "20px",
          boxShadow: "0 10px 25px rgba(0,0,0,0.05)",
          overflow: "hidden",
          marginBottom: "24px",
          border: "1px solid #E5E7EB",
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '60vh',
          minHeight: '400px'
        }}>
          {loading ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: "#86868B" }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  border: '3px solid #E5E7EB',
                  borderTop: '3px solid #3B82F6',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                  margin: '0 auto 16px'
                }}></div>
                <p style={{ color: "#6B7280", fontSize: "14px" }}>Loading data...</p>
              </div>
            </div>
          ) : (
            <div style={{
              overflow: "auto",
              flex: 1,
              cursor: isDraggingCalendar ? 'grabbing' : 'grab',
              userSelect: 'none'
            }}
              onMouseDown={handleCalendarMouseDown}
              onMouseMove={handleCalendarMouseMove}
              onMouseUp={handleCalendarMouseUp}
              onMouseLeave={handleCalendarMouseUp}
              ref={calendarRef}
            >
              <div style={{ minWidth: "max-content" }}>
                {/* 날짜 헤더 */}
                <div style={{
                  display: "flex",
                  borderBottom: "1px solid #E5E7EB",
                  background: "#F9FAFB",
                  position: 'sticky',
                  top: 0,
                  zIndex: 100
                }}>
                  <div style={{
                    width: "120px",
                    minWidth: "120px",
                    padding: "16px 12px",
                    fontWeight: "700",
                    fontSize: "12px",
                    color: "#4B5563",
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    borderRight: "1px solid #E5E7EB",
                    background: "#F9FAFB",
                    position: 'sticky',
                    left: 0,
                    zIndex: 110
                  }}>
                    Room
                  </div>
                  {viewMode === "monthly" ? (
                    // 월별 뷰 헤더 (1일~말일)
                    Array.from({ length: daysInMonth }, (_, i) => {
                      const day = i + 1;
                      const date = new Date(year, month, day);
                      const dayOfWeek = date.getDay();
                      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                      const isToday = new Date().toDateString() === date.toDateString();

                      return (
                        <div
                          key={day}
                          style={{
                            flex: "1 1 0",
                            minWidth: "32px",
                            padding: "10px 2px",
                            textAlign: "center",
                            fontSize: "12px",
                            fontWeight: isToday ? "800" : "600",
                            color: isToday ? "#3B82F6" : isWeekend ? "#EF4444" : "#4B5563",
                            background: isToday ? "#EFF6FF" : "transparent",
                            borderRight: "1px solid #F3F4F6",
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '2px'
                          }}
                        >
                          <div style={{ fontSize: '13px' }}>{day}</div>
                          <div style={{ fontSize: "9px", opacity: 0.7 }}>
                            {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][dayOfWeek]}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    // 30일 롤링 뷰 헤더
                    rollingDays.map((d, i) => {
                      const dayOfWeek = d.date.getDay();
                      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                      const isToday = new Date().toDateString() === d.date.toDateString();
                      const isNewMonth = i === 0 || d.day === 1;

                      return (
                        <div
                          key={d.dateStr}
                          style={{
                            flex: "1 1 0",
                            minWidth: "32px",
                            padding: "10px 2px",
                            textAlign: "center",
                            fontSize: "12px",
                            fontWeight: isToday ? "800" : "600",
                            color: isToday ? "#3B82F6" : isWeekend ? "#EF4444" : "#4B5563",
                            background: isToday ? "#EFF6FF" : isNewMonth ? "#FFFBEB" : "transparent",
                            borderRight: "1px solid #F3F4F6",
                            borderLeft: isNewMonth && i > 0 ? "2px solid #F59E0B" : "none",
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '2px'
                          }}
                        >
                          <div style={{ fontSize: isNewMonth ? "10px" : "13px", color: isNewMonth ? "#D97706" : "inherit" }}>
                            {isNewMonth ? `${d.month + 1}/${d.day}` : d.day}
                          </div>
                          <div style={{ fontSize: "9px", opacity: 0.7 }}>
                            {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][dayOfWeek]}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* 객실 행 */}
                {rooms.map((room, roomIndex) => (
                  <div
                    key={room}
                    style={{
                      display: "flex",
                      borderBottom: "1px solid #F3F4F6",
                      minHeight: priceMode ? "60px" : "52px",
                      position: "relative",
                      transition: 'background 0.2s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#F9FAFB'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <div style={{
                      width: "120px",
                      minWidth: "120px",
                      padding: "12px",
                      fontWeight: "700",
                      fontSize: "13px",
                      color: "#1F2937",
                      borderRight: "1px solid #E5E7EB",
                      background: "#FFFFFF",
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      position: 'sticky',
                      left: 0,
                      zIndex: 90,
                      boxShadow: '2px 0 5px rgba(0,0,0,0.02)'
                    }}>
                      {priceMode && (
                        <input
                          type="checkbox"
                          checked={selectedRooms.includes(room)}
                          onChange={(e) => {
                            e.stopPropagation();
                            toggleRoomSelection(room);
                          }}
                          style={{
                            width: '16px',
                            height: '16px',
                            cursor: "pointer",
                            accentColor: '#3B82F6'
                          }}
                        />
                      )}
                      {getRoomNameEN(room)}
                    </div>
                    <div style={{
                      position: "relative",
                      display: "flex",
                      flex: 1,
                      minWidth: 0
                    }}>
                      {/* 날짜 셀 배경 */}
                      {displayDays.map((dayInfo, i) => {
                        const day = dayInfo.day;
                        const date = dayInfo.date;
                        const isToday = new Date().toDateString() === date.toDateString();
                        const dateStr = dayInfo.dateStr;
                        // ★ 셀 단위 선택: 해당 셀이 selectedCells에 있는지 확인
                        const isSelected = selectedCells.some(c => c.room === room && c.date === dateStr);

                        // ★ room 이름 기준 예약 (활성/비활성 ID 구분 없이 두 ID 예약 모두 포함)
                        const roomReservations = roomReservationsMap[room] || [];
                        const hasReservation = roomReservations.some(r =>
                          dateStr >= r.arrival && dateStr < r.departure
                        );
                        const isFullyOccupied = hasReservation;

                        const tomorrowDate = dayjs(dateStr).add(1, 'day').format('YYYY-MM-DD');
                        const hasCheckoutToday = roomReservations.some(r => r.departure === dateStr);
                        const hasCheckinTomorrow = roomReservations.some(r => r.arrival === tomorrowDate);
                        const hasGapInAnyUnit = hasCheckoutToday && hasCheckinTomorrow;
                        const isGap = !isFullyOccupied && hasGapInAnyUnit;

                        // 과거 날짜인지 확인
                        const todayDate = new Date();
                        todayDate.setHours(0, 0, 0, 0);
                        const isPastDate = date < todayDate;

                        const dateKey = dateStr.replace(/-/g, "");

                        // 해당 방의 모든 ID 정보를 가져와서 가격 병합 (2개 이상의 계정 대응)
                        const roomInfos = getActiveUnitInfosForDate(room, dateStr);
                        let airbnbPrice = 0;
                        let bookingPrice = 0;
                        let minStay = 0;  // 0은 "아직 값 없음" 의미
                        let maxStay = 0;
                        let hasError = false;
                        let errorMsg = "";

                        roomInfos.forEach(info => {
                          const roomPriceData = roomPrices[info.roomId];
                          if (roomPriceData?.dates?.error) {
                            hasError = true;
                            errorMsg = roomPriceData.dates.error;
                          }

                          const priceInfo = roomPriceData?.dates?.[dateKey];
                          if (priceInfo) {
                            const ap = parseFloat(priceInfo.p1) || 0;  // Airbnb 가격 (p1)
                            const bp = parseFloat(priceInfo.p2) || 0;  // Booking 가격 (p2)
                            // Beds24에서 빈값 = 1박 가능이므로 빈값/0은 1로 해석
                            const ms = parseInt(priceInfo.m) || 1;     // 최소 숙박일수 (빈값=1)
                            const mx = parseInt(priceInfo.mx) || 0;    // 최대 숙박일수
                            if (ap > 0) airbnbPrice = ap;
                            if (bp > 0) bookingPrice = bp;
                            if (ms >= 1 && ms < INACTIVE_MINSTAY_THRESHOLD && (minStay === 0 || ms < minStay)) minStay = ms;  // 비활성(INACTIVE_MINSTAY_THRESHOLD+) 제외, 최소값 선택
                            if (mx > 0 && mx < 50) maxStay = mx;  // 비활성(50+) 제외한 활성 어카운트만
                          }
                        });

                        // API 사용량 제한 에러 처리
                        if (hasError && airbnbPrice === 0 && bookingPrice === 0) {
                          const isLimitExceeded = errorMsg.includes("limit exceeded");
                          return (
                            <div key={day} style={{ flex: "1 1 0", minWidth: "32px", borderRight: "1px solid #F3F4F6", background: "#FEF2F2", display: "flex", alignItems: "center", justifyContent: "center" }} title={errorMsg}>
                              <span style={{ fontSize: "10px", color: "#EF4444", fontWeight: '700' }}>{isLimitExceeded ? "WAIT" : "ERR"}</span>
                            </div>
                          );
                        }

                        // 선택 가능한지 (예약 없고, 과거 아님)
                        const canSelect = !hasReservation && !isPastDate;
                        const isSelectionStart = selectionStart && selectionStart.room === room && selectionStart.day === day;
                        // 퀵 예약 범위 하이라이트 계산
                        let isInQuickSelectionRange = false;
                        if (!priceMode && selectionStart && selectionStart.room === room && hoveredDay && hoveredRoom === room) {
                          const start = Math.min(selectionStart.day, hoveredDay);
                          const end = Math.max(selectionStart.day, hoveredDay);
                          if (day >= start && day <= end) {
                            isInQuickSelectionRange = true;
                          }
                        }

                        return (
                          <div
                            key={day}
                            onClick={(e) => {
                              if (canSelect && !priceMode) {
                                e.stopPropagation();
                                handleDateCellClick(room, day);
                              }
                            }}
                            onMouseDown={(e) => {
                              if (canSelect && (priceMode || gapEditMode)) {
                                e.stopPropagation();
                                setIsDragging(true);

                                // ★ 여러 방 동시 선택 지원: 방 추가/제거, 날짜 추가/제거
                                const action = isSelected ? 'deselect' : 'select';
                                setDragAction(action);

                                setSelectedRoom(room);

                                // ★ 셀 단위로 추가/제거
                                setSelectedCells(prev => {
                                  if (action === 'select') {
                                    if (prev.some(c => c.room === room && c.date === dateStr)) return prev;
                                    return [...prev, { room, date: dateStr }];
                                  } else {
                                    return prev.filter(c => !(c.room === room && c.date === dateStr));
                                  }
                                });
                              }
                            }}
                            style={{
                              flex: "1 1 0",
                              minWidth: "32px",
                              borderRight: "1px solid #F3F4F6",
                              background: isSelectionStart
                                ? "#F59E0B" // 시작점
                                : isInQuickSelectionRange
                                  ? "rgba(245, 158, 11, 0.15)" // 범위 하이라이트
                                  : isSelected
                                    ? gapEditMode
                                      ? "rgba(139, 92, 246, 0.35)" // Gap Edit 모드: 보라색 (더 진하게)
                                      : "rgba(245, 158, 11, 0.3)" // Price 모드: 주황색 (더 진하게)
                                    : isToday
                                      ? "rgba(59, 130, 246, 0.05)"
                                      : isPastDate && (priceMode || gapEditMode || selectionStart)
                                        ? "#F9FAFB"
                                        : canSelect
                                          ? "#FFFFFF"
                                          : "transparent",
                              cursor: canSelect ? "pointer" : "default",
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              justifyContent: "center",
                              transition: "all 0.1s ease",
                              position: "relative",
                              opacity: isPastDate && (priceMode || gapEditMode || selectionStart) ? 0.5 : 1,
                              zIndex: isSelectionStart || isInQuickSelectionRange || isSelected ? 5 : 1,
                              // ★ 선택된 셀 테두리 강조
                              outline: isSelected
                                ? gapEditMode
                                  ? "2px solid #8B5CF6" // Gap Edit: 보라색 테두리
                                  : "2px solid #F59E0B" // Price: 주황색 테두리
                                : "none",
                              outlineOffset: "-2px"
                            }}
                            onMouseEnter={(e) => {
                              if (canSelect) {
                                setHoveredDay(day);
                                setHoveredRoom(room);

                                // 드래그 중이면 선택/해제 처리 (priceMode 또는 gapEditMode)
                                if (isDragging && (priceMode || gapEditMode) && dragAction) {
                                  // ★ 셀 단위로 추가/제거
                                  setSelectedCells(prev => {
                                    if (dragAction === 'select') {
                                      if (prev.some(c => c.room === room && c.date === dateStr)) return prev;
                                      return [...prev, { room, date: dateStr }];
                                    } else {
                                      return prev.filter(c => !(c.room === room && c.date === dateStr));
                                    }
                                  });
                                }
                              }
                              if (canSelect && !isSelected && !isInQuickSelectionRange && !isSelectionStart && !isDragging) {
                                e.currentTarget.style.background = gapEditMode ? "rgba(139, 92, 246, 0.1)" : "rgba(245, 158, 11, 0.08)";
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (canSelect) {
                                setHoveredDay(null);
                                setHoveredRoom(null);
                              }
                              if (canSelect && !isSelected && !isInQuickSelectionRange && !isSelectionStart) {
                                e.currentTarget.style.background = isToday ? "rgba(59, 130, 246, 0.05)" : "#FFFFFF";
                              }
                            }}
                            title={priceMode && airbnbPrice ? `Airbnb: ¥${airbnbPrice.toLocaleString()}\nBooking: ¥${bookingPrice.toLocaleString()} (Auto-sync)\nMin Stay: ${minStay} nights` : (isPastDate && priceMode ? "Cannot edit past dates" : "")}
                          >
                            {/* Price Display - Enhanced Readability */}
                            {priceMode && !hasReservation && airbnbPrice > 0 && minStay > 0 && (
                              <div style={{
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: "2px",
                                width: "100%",
                                height: "100%",
                                padding: "1px"
                              }}>
                                {/* Price - Larger */}
                                <div style={{
                                  color: "#FF385C",
                                  fontSize: "13px",
                                  fontWeight: "800",
                                  textAlign: "center",
                                  lineHeight: "1",
                                  letterSpacing: "-0.5px"
                                }}>
                                  {airbnbPrice >= 100000
                                    ? `${Math.round(airbnbPrice / 1000)}k`
                                    : `${(airbnbPrice / 1000).toFixed(0)}k`}
                                </div>
                                {/* Min Stay Badge - Larger */}
                                {minStay > 0 && (
                                  <div
                                    style={{
                                      minWidth: "18px",
                                      height: "16px",
                                      padding: "0 3px",
                                      background: isGap && minStay >= 2
                                        ? "linear-gradient(135deg, #FEE2E2 0%, #FECACA 100%)"
                                        : minStay === 1
                                          ? "linear-gradient(135deg, #D1FAE5 0%, #A7F3D0 100%)"
                                          : "linear-gradient(135deg, #F3F4F6 0%, #E5E7EB 100%)",
                                      color: isGap && minStay >= 2
                                        ? "#DC2626"
                                        : minStay === 1
                                          ? "#059669"
                                          : "#6B7280",
                                      borderRadius: "4px",
                                      fontSize: "11px",
                                      fontWeight: "800",
                                      textAlign: "center",
                                      lineHeight: "16px",
                                      cursor: "pointer",
                                      boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
                                      transition: "all 0.15s ease"
                                    }}
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      const newMinStay = parseInt(minStay) === 1 ? 2 : 1;
                                      if (!window.confirm(`Change ${getRoomNameEN(room)} on ${dateStr} to min ${newMinStay} nights?`)) return;

                                      try {
                                        const dateKey = dateStr.replace(/-/g, "");
                                        const response = await fetch(`${API_BASE_URL}/setMinStay`, {
                                          method: "POST",
                                          headers: { "Content-Type": "application/json" },
                                          body: JSON.stringify({
                                            companyId,
                                            building: selectedBuilding,
                                            roomName: room,
                                            dates: { [dateKey]: { m: newMinStay } }
                                          })
                                        });
                                        const result = await response.json();
                                        if (result.success) {
                                          // ★ 로컬 state 즉시 업데이트 — 활성 roomId만 (비활성 50/99박 roomId 제외)
                                          const roomInfos = getActiveUnitInfosForDate(room, dateStr);
                                          roomInfos.forEach(roomInfo => {
                                            setRoomPrices(prev => {
                                              const updated = { ...prev };
                                              if (updated[roomInfo.roomId]?.dates?.[dateKey]) {
                                                updated[roomInfo.roomId].dates[dateKey].m = String(newMinStay);
                                              }
                                              return updated;
                                            });

                                            // 캐시도 동일하게 업데이트
                                            setPriceCache(prev => {
                                              const updated = { ...prev };
                                              if (updated[selectedBuilding]?.[roomInfo.roomId]?.dates?.[dateKey]) {
                                                updated[selectedBuilding][roomInfo.roomId].dates[dateKey].m = String(newMinStay);
                                              }
                                              return updated;
                                            });
                                          });

                                          alert(`✓ ${getRoomNameEN(room)} on ${dateStr} changed to min ${newMinStay} nights!`);

                                          // ★ 백그라운드로 전체 데이터 동기화 (2초 후 - 사용자 체감 속도 개선)
                                          setTimeout(() => {
                                            setPriceCache(prev => {
                                              const newCache = { ...prev };
                                              delete newCache[selectedBuilding];
                                              return newCache;
                                            });
                                            fetchPrices(true);
                                          }, 2000);
                                        } else {
                                          alert("Failed: " + (result.error || "Unknown error"));
                                        }
                                      } catch (err) {
                                        alert("Connection error: " + err.message);
                                      }
                                    }}
                                  >
                                    {minStay}
                                  </div>
                                )}
                              </div>
                            )}
                            {/* 선택 체크 표시 */}
                            {isSelected && (
                              <div style={{
                                width: '6px',
                                height: '6px',
                                borderRadius: '50%',
                                backgroundColor: "#F59E0B",
                                position: "absolute",
                                bottom: '4px'
                              }}></div>
                            )}
                          </div>
                        );
                      })}

                      {/* 예약 바 */}
                      {roomReservationsMap[room]?.map(reservation =>
                        renderReservationBar(reservation, roomIndex)
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 건물 분석 섹션 (전체 보기 아닐 때만) - Premium Design */}
        {selectedBuilding !== "전체" && (
          <div style={{ marginBottom: "24px", marginTop: "24px" }}>
            <h3 style={{
              fontSize: "18px",
              fontWeight: "700",
              marginBottom: "18px",
              color: "#111827",
              display: "flex",
              alignItems: "center",
              gap: "10px"
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2">
                <line x1="18" y1="20" x2="18" y2="10" />
                <line x1="12" y1="20" x2="12" y2="4" />
                <line x1="6" y1="20" x2="6" y2="14" />
              </svg>
              {getBuildingNameEN(selectedBuilding)} Analytics
            </h3>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "16px"
            }}>
              <div style={{
                background: "white",
                borderRadius: "16px",
                padding: "20px",
                border: "1px solid #E5E7EB",
                boxShadow: "0 2px 8px rgba(0,0,0,0.04)"
              }}>
                <div style={{ fontSize: "13px", color: "#6B7280", fontWeight: "500", marginBottom: "8px" }}>Monthly Occupancy</div>
                <div style={{ fontSize: "28px", fontWeight: "700", color: "#3B82F6" }}>{singleAnalysis.occupancyRate.toFixed(1)}%</div>
                <div style={{ fontSize: "12px", color: "#9CA3AF", marginTop: "4px" }}>Reserved / Total room nights</div>
              </div>
              <div style={{
                background: "white",
                borderRadius: "16px",
                padding: "20px",
                border: "1px solid #E5E7EB",
                boxShadow: "0 2px 8px rgba(0,0,0,0.04)"
              }}>
                <div style={{ fontSize: "13px", color: "#6B7280", fontWeight: "500", marginBottom: "8px" }}>Vacant Today</div>
                <div style={{ fontSize: "28px", fontWeight: "700", color: singleAnalysis.emptyRoomsToday > 0 ? "#F59E0B" : "#10B981" }}>
                  {singleAnalysis.emptyRoomsToday}
                </div>
                <div style={{ fontSize: "12px", color: "#9CA3AF", marginTop: "4px" }}>of {rooms.length} total rooms</div>
              </div>
              <div style={{
                background: "white",
                borderRadius: "16px",
                padding: "20px",
                border: "1px solid #E5E7EB",
                boxShadow: "0 2px 8px rgba(0,0,0,0.04)"
              }}>
                <div style={{ fontSize: "13px", color: "#6B7280", fontWeight: "500", marginBottom: "8px" }}>Avg. Daily Rate</div>
                <div style={{ fontSize: "28px", fontWeight: "700", color: "#8B5CF6" }}>{formatPrice(singleAnalysis.avgPrice)}</div>
                <div style={{ fontSize: "12px", color: "#9CA3AF", marginTop: "4px" }}>Net revenue per night</div>
              </div>
              <div style={{
                background: "white",
                borderRadius: "16px",
                padding: "20px",
                border: "1px solid #E5E7EB",
                boxShadow: "0 2px 8px rgba(0,0,0,0.04)"
              }}>
                <div style={{ fontSize: "13px", color: "#6B7280", fontWeight: "500", marginBottom: "8px" }}>Est. Net Revenue <span style={{ fontSize: "10px", color: "#9CA3AF" }}>(excl. OTA fees)</span></div>
                <div style={{ fontSize: "28px", fontWeight: "700", color: "#10B981" }}>{formatPrice(singleAnalysis.totalRevenue)}</div>
                <div style={{ fontSize: "12px", color: "#9CA3AF", marginTop: "4px" }}>{reservations.length} reservations</div>
              </div>
              <div style={{
                background: "white",
                borderRadius: "16px",
                padding: "20px",
                border: "1px solid #E5E7EB",
                boxShadow: "0 2px 8px rgba(0,0,0,0.04)"
              }}>
                <div style={{ fontSize: "13px", color: "#6B7280", fontWeight: "500", marginBottom: "8px" }}>Price Range <span style={{ fontSize: "10px", color: "#9CA3AF" }}>(Airbnb)</span></div>
                <div style={{ fontSize: "20px", fontWeight: "700", color: "#EF4444" }}>
                  {singleAnalysis.minPrice >= 0 ? `${formatPrice(singleAnalysis.minPrice)} ~ ${formatPrice(singleAnalysis.maxPrice)}` : "-"}
                </div>
                <div style={{ fontSize: "12px", color: "#9CA3AF", marginTop: "4px" }}>Available rooms only</div>
              </div>
            </div>
          </div>
        )}

        {/* 범례 (전체 보기 아닐 때만) - Premium Design */}
        {selectedBuilding !== "전체" && (
          <div style={{
            background: "white",
            padding: "18px 24px",
            borderRadius: "14px",
            display: "flex",
            gap: "28px",
            fontSize: "13px",
            color: "#6B7280",
            border: "1px solid #E5E7EB",
            boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
            alignItems: "center",
            flexWrap: "wrap"
          }}>
            <span style={{ fontWeight: "500" }}>Click on a reservation bar to view details</span>
            <div style={{ width: "1px", height: "20px", background: "#E5E7EB" }}></div>
            <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ width: "16px", height: "16px", borderRadius: "5px", background: PLATFORM_COLORS.Airbnb, boxShadow: "0 2px 4px rgba(255, 56, 92, 0.3)" }}></span>
              <span style={{ fontWeight: "500" }}>Airbnb</span>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ width: "16px", height: "16px", borderRadius: "5px", background: PLATFORM_COLORS.Booking, boxShadow: "0 2px 4px rgba(0, 53, 128, 0.3)" }}></span>
              <span style={{ fontWeight: "500" }}>Booking</span>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ width: "16px", height: "16px", borderRadius: "5px", background: PLATFORM_COLORS.Expedia, boxShadow: "0 2px 4px rgba(255, 204, 0, 0.3)" }}></span>
              <span style={{ fontWeight: "500" }}>Expedia</span>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ width: "16px", height: "16px", borderRadius: "5px", background: PLATFORM_COLORS.Agoda, boxShadow: "0 2px 4px rgba(186, 48, 95, 0.3)" }}></span>
              <span style={{ fontWeight: "500" }}>Agoda</span>
            </span>
          </div>
        )}

        {/* Version Marker */}
        <div style={{ textAlign: "right", padding: "10px", fontSize: "10px", color: "#C7C7CC" }}>
          System Version: v1.5.0
        </div>

        </>)} {/* 데스크탑 전용 뷰 닫기 */}
      </div>
    </>
  );
}

export default BuildingCalendar;
