import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { collection, getDocs, query, where, orderBy, limit, addDoc, writeBatch, doc, onSnapshot } from "firebase/firestore";
import { useNavigate } from 'react-router-dom';
import { db, auth } from '../firebase';
import { useUser } from '../contexts/UserContext';
import dayjs from 'dayjs';
import axios from 'axios';
import { buildPriceAttributionResult, getReservationIdentityKey, parseReservationCreatedAtMs } from '../utils/priceAttribution';

import { BUILDING_NAMES_EN as _BUILDING_NAMES_EN, EXCLUDED_BUILDING_UI, ACTIVE_BUILDING_ORDER } from '../constants/buildingData';

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
    { roomId: "513700", name: "401호" },
    { roomId: "513701", name: "501호" }, { roomId: "513702", name: "601호" },
    { roomId: "513703", name: "701호" }, { roomId: "513704", name: "801호" },
    { roomId: "513705", name: "901호" }
  ]
};

// Firebase Functions API URL
const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || "https://us-central1-my-booking-app-3f0e7.cloudfunctions.net";

// 비활성 계정 minStay 기준값 (50 이상 = 비활성 판단)
const INACTIVE_MINSTAY_THRESHOLD = 50;
const PRICE_INTERVENTION_LIMIT = 400;
const CALENDAR_NUMERIC_FONT_FAMILY = '"Bahnschrift", "DIN Alternate", "Inter", "Aptos", "Segoe UI", sans-serif';

// 가격 설정 모달 (고급 버전)
function PriceSettingModal({ building, room, selectedDates, roomPrices, onClose, onSave, onJobQueued, selectedRooms, selectedCells, companyId, pendingPriceCellMap }) {
  // 조정 모드: 'direct' (직접입력), 'percent' (퍼센트)
  const [adjustMode, setAdjustMode] = useState("direct");
  const [percentValue, setPercentValue] = useState("");
  const [priceAirbnb, setPriceAirbnb] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState(1); // 1: 입력, 2: 기간선택/확인

  // 실제 선택된 room-date 쌍 (cartesian product 방식)
  const actualCells = useMemo(() => {
    if (selectedCells && selectedCells.length > 0) return selectedCells;
    return (selectedDates || []).map(d => ({ room, date: d }));
  }, [selectedCells, selectedDates, room]);

  const getModalActiveRoomInfosForDate = useCallback((roomName, dateStr) => {
    const unitInfos = BUILDING_ROOMS[building]?.filter(r => r.name === roomName) || [];
    if (unitInfos.length <= 1) return unitInfos;

    const dateKey = dateStr.replace(/-/g, "");
    const activeInfos = unitInfos.filter((info) => {
      const ms = parseInt(roomPrices?.[String(info.roomId)]?.dates?.[dateKey]?.m, 10);
      return Number.isFinite(ms) && ms >= 1 && ms < INACTIVE_MINSTAY_THRESHOLD;
    });

    return activeInfos;
  }, [building, roomPrices]);

  const getModalPriceForRoomDate = useCallback((roomName, dateStr) => {
    const dateKey = dateStr.replace(/-/g, "");
    const activeRoomInfos = getModalActiveRoomInfosForDate(roomName, dateStr);
    const allRoomInfos = BUILDING_ROOMS[building]?.filter(r => r.name === roomName) || [];
    const mergedPrices = getMergedRoomChannelPrices({
      primaryUnitInfos: activeRoomInfos,
      fallbackUnitInfos: allRoomInfos,
      roomPrices,
      dateKey
    });

    let airbnbPrice = mergedPrices.airbnbPrice;
    let bookingPrice = mergedPrices.bookingPrice;

    const pendingPriceCell = pendingPriceCellMap?.[`${roomName}__${dateStr}`];
    if (pendingPriceCell?.airbnbPrice > 0) {
      airbnbPrice = pendingPriceCell.airbnbPrice;
    }

    return {
      airbnbPrice,
      bookingPrice,
      hasPrice: airbnbPrice > 0 || bookingPrice > 0
    };
  }, [getModalActiveRoomInfosForDate, roomPrices, pendingPriceCellMap]);

  // 선택된 셀의 실제 가격 정보를 날짜별로 그룹화
  const selectedPricesInfo = useMemo(() => {
    if (!roomPrices) return [];

    const dateMap = {};
    actualCells.forEach(cell => {
      if (!dateMap[cell.date]) dateMap[cell.date] = new Set();
      dateMap[cell.date].add(cell.room);
    });

    return Object.entries(dateMap).sort(([a], [b]) => a.localeCompare(b)).map(([dateStr, roomSet]) => {
      const prices = [];
      [...roomSet].forEach(targetRoom => {
        const currentPrice = getModalPriceForRoomDate(targetRoom, dateStr);
        if (currentPrice.hasPrice) {
          prices.push({
            room: targetRoom,
            airbnb: currentPrice.airbnbPrice,
            booking: currentPrice.bookingPrice
          });
        }
      });

      const uniquePrices = [...new Set(prices.map(p => p.airbnb))];
      const representativePrice = prices.length > 0 ? prices[0].airbnb : 0;
      const representativeBooking = prices.length > 0 ? prices[0].booking : 0;

      return {
        date: dateStr,
        dateDisplay: dateStr.slice(5),
        airbnbPrice: representativePrice,
        bookingPrice: representativeBooking,
        priceDetails: prices,
        hasMultiplePrices: uniquePrices.length > 1
      };
    });
  }, [actualCells, getModalPriceForRoomDate, roomPrices]);

  // 평균 Airbnb 가격 (Screen 1용) - 실제 선택 데이터 기반
  const avgAirbnbPrice = useMemo(() => {
    let totalPrice = 0;
    let count = 0;
    actualCells.forEach(cell => {
      const currentPrice = getModalPriceForRoomDate(cell.room, cell.date);
      if (currentPrice.airbnbPrice > 0) {
        totalPrice += currentPrice.airbnbPrice;
        count++;
      }
    });
    return count > 0 ? Math.round(totalPrice / count) : 0;
  }, [actualCells, getModalPriceForRoomDate]);

  // ✅ Confirm 화면에서 실제 선택 데이터(cartesian product 방식)
  const confirmDisplayData = useMemo(() => {
    const rows = [];

    [...actualCells].sort((a, b) => a.date.localeCompare(b.date) || a.room.localeCompare(b.room)).forEach(cell => {
      const dateStr = cell.date;
      const targetRoom = cell.room;
      const currentPrice = getModalPriceForRoomDate(targetRoom, dateStr);
      if (!currentPrice.hasPrice) return;

      let newPrice = currentPrice.airbnbPrice;
      if (adjustMode === "direct" && priceAirbnb) {
        newPrice = parseInt(priceAirbnb);
      } else if (adjustMode === "percent" && percentValue) {
        const pct = parseFloat(percentValue) || 0;
        newPrice = Math.round(currentPrice.airbnbPrice * (1 + pct / 100));
      }

      rows.push({
        room: targetRoom,
        roomDisplay: targetRoom.replace('호', ''),
        date: dateStr,
        dateDisplay: dateStr.slice(5),
        airbnbPrice: currentPrice.airbnbPrice,
        bookingPrice: currentPrice.bookingPrice,
        newAirbnbPrice: newPrice
      });
    });

    return rows;
  }, [actualCells, getModalPriceForRoomDate, adjustMode, priceAirbnb, percentValue]);

  // 변경된 값이 있는지 확인
  const hasChanges = useMemo(() => {
    if (adjustMode === "direct") {
      return priceAirbnb && priceAirbnb.length > 0;
    }
    return percentValue && parseFloat(percentValue) !== 0;
  }, [adjustMode, priceAirbnb, percentValue]);

  // 퍼센트 프리셋 선택 버튼
  const percentPresets = [-20, -10, -5, 5, 10, 20, 30];

  const handleSave = async () => {
    if (!hasChanges) {
      setError("Please enter a price to change");
      return;
    }

    setLoading(true);
    setError("");

    try {
      // ✅ room별로 실제 선택된 날짜별로 그룹화(cartesian product 방식)
      const cellsByRoom = {};
      confirmDisplayData.forEach(p => {
        if (!cellsByRoom[p.room]) cellsByRoom[p.room] = [];
        cellsByRoom[p.room].push(p);
      });

      const roomEntries = Object.entries(cellsByRoom);
      const roomsToUpdate = roomEntries.map(([rn]) => rn);
      let allResults = [];
      let lastJobId = null;
      let totalJobRoomCount = 0;
      let anyQueued = false;
      const allDatesData = {};
      const roomUpdates = roomEntries.map(([roomName, priceInfos]) => {
        const datesData = {};
        priceInfos.forEach(p => {
          const dateKey = p.date.replace(/-/g, "");
          datesData[dateKey] = {
            p1: parseInt(p.newAirbnbPrice),
            p3: parseInt(p.newAirbnbPrice)
          };
        });
        Object.assign(allDatesData, datesData);

        const activeRoomIds = new Set();
        priceInfos.forEach(p => {
          const activeInfos = getModalActiveRoomInfosForDate(roomName, p.date);
          activeInfos.forEach(info => activeRoomIds.add(info.roomId));
        });
        const roomInfos = BUILDING_ROOMS[building]?.filter(r => r.name === roomName) || [];
        const finalRoomIds = activeRoomIds.size > 0 ? Array.from(activeRoomIds) : roomInfos.map(info => info.roomId);

        return {
          roomName,
          roomIds: finalRoomIds,
          dates: datesData
        };
      }).filter(update => update.roomIds.length > 0 && Object.keys(update.dates).length > 0);

      const totalRequestedRoomIds = [...new Set(roomUpdates.flatMap(update => update.roomIds.map(String)))];
      const body = {
        companyId,
        building,
        roomUpdates,
        worker: auth.currentUser?.displayName || auth.currentUser?.email || "Admin",
        workerEmail: auth.currentUser?.email || null
      };
      const response = await fetch(`${API_BASE_URL}/setRoomPrices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Server error (${response.status})`);
      }

      const result = await response.json();
      if (result.queued) {
        anyQueued = true;
        lastJobId = result.jobId;
        totalJobRoomCount = Array.isArray(result.roomIds) ? result.roomIds.length : totalRequestedRoomIds.length;
      }

      allResults = result.results || totalRequestedRoomIds.map(rid => ({
        roomId: rid,
        success: result.success,
        error: result.error
      }));

      const failCount = allResults.filter(r => !r.success).length;
      const allSuccess = failCount === 0;

      // 가격 변경 이력 데이터 생성 (실제 선택 셀 기준)
      const priceSnapshot = confirmDisplayData.map(p => ({
        date: p.date,
        room: p.room,
        oldPrice: p.airbnbPrice || 0,
        newPrice: p.newAirbnbPrice || 0
      }));

      const sortedDates = [...new Set(confirmDisplayData.map(p => p.date))].sort();
      const dateFrom = sortedDates[0];
      const dateTo = sortedDates[sortedDates.length - 1];

      const avgOldPrice = Math.round(priceSnapshot.reduce((sum, p) => sum + p.oldPrice, 0) / priceSnapshot.length);
      const avgNewPrice = Math.round(priceSnapshot.reduce((sum, p) => sum + p.newPrice, 0) / priceSnapshot.length);

      if (!anyQueued) try {
        const sanitizedResults = allResults.map(r => ({
          room: r.room || r.roomId || "unknown",
          success: r.success === true,
          error: r.error || null
        }));

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
          dateFrom: dateFrom || null,
          dateTo: dateTo || null,
          totalDays: sortedDates.length || 0,
          priceSnapshot: priceSnapshot || [],
          dates: allDatesData || {},
          oldPrice: isNaN(avgOldPrice) ? 0 : avgOldPrice,
          newPrice: isNaN(avgNewPrice) ? 0 : avgNewPrice,
          success: allSuccess === true,
          errorMessage: allSuccess ? null : `${failCount} rooms failed: ${allResults.filter(r => !r.success).map(r => r.error || 'Unknown error').join(', ')}`,
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

      if (anyQueued) {
        onJobQueued && onJobQueued({
          jobId: lastJobId,
          roomCount: totalJobRoomCount,
          pendingCells: confirmDisplayData.map((priceInfo) => ({
            room: priceInfo.room,
            date: priceInfo.date,
            airbnbPrice: priceInfo.newAirbnbPrice
          }))
        });
        onClose();
      } else if (allSuccess) {
        alert(`Prices updated for ${roomsToUpdate.length} rooms!`);
        setTimeout(() => {
          onSave && onSave();
          onClose();
        }, 300);
      } else {
        const errorMsgs = allResults.filter(r => !r.success).map(r => {
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
              {/* Current Price Info - 날짜별 객실별 목록 */}
              <div style={{
                borderRadius: "16px",
                marginBottom: "24px",
                border: "1px solid #E2E8F0",
                overflow: "hidden"
              }}>
                {/* 안내 헤더 */}
                <div style={{
                  padding: "10px 16px",
                  background: "linear-gradient(135deg, #FFF5F7 0%, #FFF0F3 100%)",
                  borderBottom: "1px solid #FECDD3",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center"
                }}>
                  <span style={{ fontSize: "12px", color: "#9CA3AF", fontWeight: "500" }}>Current Prices (Beds24)</span>
                  <span style={{ fontSize: "12px", color: "#6B7280", fontWeight: "600" }}>
                    {(selectedRooms && selectedRooms.length > 0 ? selectedRooms.length : 1)} rooms · {selectedDates.length} dates
                  </span>
                </div>
                {/* 날짜별 섹션 (스크롤) */}
                <div style={{ maxHeight: "200px", overflowY: "auto", background: "white" }}>
                  {selectedPricesInfo.map((dateInfo, dIdx) => (
                    <div key={dateInfo.date} style={{
                      borderBottom: dIdx < selectedPricesInfo.length - 1 ? "1px solid #F1F5F9" : "none"
                    }}>
                      {/* 날짜 헤더 */}
                      <div style={{
                        padding: "5px 16px 4px",
                        fontSize: "11px",
                        fontWeight: "700",
                        color: "#64748B",
                        letterSpacing: "0.04em",
                        background: "#FAFAFA",
                        borderBottom: "1px solid #F1F5F9"
                      }}>
                        {dateInfo.date}
                        {dateInfo.hasMultiplePrices && (
                          <span style={{ marginLeft: "6px", fontSize: "10px", color: "#F59E0B", fontWeight: "500" }}>
                            · prices vary
                          </span>
                        )}
                      </div>
                      {/* 객실별 행 */}
                      {dateInfo.priceDetails.length > 0 ? dateInfo.priceDetails.map((pr, rIdx) => (
                        <div key={rIdx} style={{
                          display: "flex",
                          alignItems: "center",
                          padding: "5px 16px 5px 20px",
                          gap: "6px",
                          borderTop: rIdx > 0 ? "1px solid #F8FAFC" : "none",
                          background: "white"
                        }}>
                          <span style={{ fontSize: "12px", fontWeight: "600", color: "#374151", minWidth: "56px" }}>
                            {getRoomNameEN(pr.room)}
                          </span>
                          <span style={{ fontSize: "10px", color: "#FF385C", fontWeight: "700", background: "#FFF0F3", padding: "1px 5px", borderRadius: "4px" }}>Air</span>
                          <span style={{ fontSize: "13px", fontWeight: "700", color: "#FF385C" }}>¥{pr.airbnb.toLocaleString()}</span>
                          {pr.booking > 0 && (
                            <>
                              <span style={{ fontSize: "11px", color: "#D1D5DB", margin: "0 1px" }}>·</span>
                              <span style={{ fontSize: "10px", color: "#003580", fontWeight: "700", background: "#EFF6FF", padding: "1px 5px", borderRadius: "4px" }}>Bkg</span>
                              <span style={{ fontSize: "12px", fontWeight: "600", color: "#003580" }}>¥{pr.booking.toLocaleString()}</span>
                            </>
                          )}
                        </div>
                      )) : (
                        <div style={{ padding: "6px 20px", fontSize: "12px", color: "#9CA3AF" }}>No price data</div>
                      )}
                    </div>
                  ))}
                </div>
                {/* 하단 안내 */}
                <div style={{ padding: "8px 16px", background: "#F8FAFC", borderTop: "1px solid #E2E8F0", fontSize: "11px", color: "#9CA3AF", display: "flex", alignItems: "center", gap: "4px" }}>
                  <span>·</span> Booking.com auto-syncs with Airbnb
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
                    Direct Input
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
                    Percentage
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
                <span style={{ fontSize: "24px" }}>?</span>
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
                      // 같은 날짜의 첫 번째만 해당줄에 날짜 표시
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
                              <span style={{ color: "#3B82F6", fontSize: "12px" }}>Reset</span>
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
                  {confirmDisplayData.length} cells ({[...new Set(confirmDisplayData.map(p => p.room))].length} rooms)
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
                onClick={() => alert("Price reset is not supported here.\nPlease reset it directly in the Beds24 dashboard.")}
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
                Preview →              </button>
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
                Edit
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

// 건물명 영문 맵 (캘린더에서 사용 목적 포함 - "전체" 포함)
const BUILDING_NAMES_EN = { ..._BUILDING_NAMES_EN, "전체": "All Properties" };

// 화면에서 제외된 건물 (다이쿄초 매각완료)
const isBuildingSold = (building) => building === EXCLUDED_BUILDING_UI;

// 영문 건물명 변환 함수
const getBuildingNameEN = (koreanName) => BUILDING_NAMES_EN[koreanName] || koreanName;

// 객실 이름 영문 변환 함수 (201호 -> Room 201)
const getRoomNameEN = (roomName) => {
  if (!roomName) return roomName;
  // "201호" -> "Room 201", "B01호" -> "Room B01", "오쿠보A" -> "Okubo A"
  if (roomName.endsWith('호')) {
    return `Room ${roomName.replace('호', '')}`;
  }
  // 오쿠보, 사노 등 특수 케이스 처리
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
  "Airbnb": "#F2A3A5",
  "Booking": "#8FDCDD",
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
  if (p.includes("direct")) return PLATFORM_COLORS.Direct;  // 직접 예약
  return PLATFORM_COLORS.default;
};

// 날짜 계산 유틸리티
const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
const formatPrice = (price) => {
  if (!price) return "¥0";
  const num = parseFloat(String(price).replace(/[^0-9.-]+/g, ""));
  if (isNaN(num)) return "¥0";
  return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 }).format(num);
};
const formatCalendarPriceShort = (price) => {
  if (!price) return "—";
  const num = parseFloat(String(price).replace(/[^0-9.-]+/g, ""));
  if (!Number.isFinite(num) || num <= 0) return "—";
  if (num >= 1000) {
    const compact = num / 1000;
    return `${compact.toFixed(num % 1000 === 0 ? 0 : 1)}K`;
  }
  return Math.round(num).toLocaleString();
};

const getMergedRoomChannelPrices = ({
  primaryUnitInfos = [],
  fallbackUnitInfos = [],
  roomPrices = {},
  dateKey,
  preferAirbnbPrice3 = false
}) => {
  const orderedInfos = [];
  const seenRoomIds = new Set();

  [primaryUnitInfos, fallbackUnitInfos].forEach((unitInfos) => {
    (unitInfos || []).forEach((info) => {
      const roomId = String(info?.roomId || "");
      if (!roomId || seenRoomIds.has(roomId)) return;
      seenRoomIds.add(roomId);
      orderedInfos.push(info);
    });
  });

  let airbnbPrice = 0;
  let bookingPrice = 0;
  let hasError = false;
  let errorMsg = "";

  for (const info of orderedInfos) {
    const roomPriceData = roomPrices?.[String(info.roomId)];
    if (roomPriceData?.dates?.error && !hasError) {
      hasError = true;
      errorMsg = roomPriceData.dates.error;
    }

    const priceInfo = roomPriceData?.dates?.[dateKey];
    if (!priceInfo) continue;

    if (airbnbPrice <= 0) {
      const airbnbRaw = preferAirbnbPrice3 ? (priceInfo.p3 || priceInfo.p1) : priceInfo.p1;
      const ap = parseFloat(airbnbRaw) || 0;
      if (ap > 0) airbnbPrice = ap;
    }

    if (bookingPrice <= 0) {
      const bp = parseFloat(priceInfo.p2) || 0;
      if (bp > 0) bookingPrice = bp;
    }

    if (airbnbPrice > 0 && bookingPrice > 0 && hasError) break;
  }

  return {
    airbnbPrice,
    bookingPrice,
    hasError,
    errorMsg
  };
};

const BEDS24_DETAIL_ROW_HEIGHT = 82;
const BEDS24_DETAIL_PRICE_TRACK_HEIGHT = 30;
const BEDS24_DETAIL_MINSTAY_TRACK_HEIGHT = 22;
const BEDS24_DETAIL_RESERVATION_TRACK_HEIGHT = 30;
const BEDS24_DETAIL_RESERVATION_TRACK_TOP =
  BEDS24_DETAIL_ROW_HEIGHT - BEDS24_DETAIL_RESERVATION_TRACK_HEIGHT;
const BEDS24_DETAIL_STICKY_WIDTH = 164;
const BEDS24_DETAIL_ROOM_NAME_WIDTH = 86;

// 예약 상세 모달 내부 컴포넌트 (재사용을 위해 함수 바깥에서 정의)
// 예약 생성 시각 파서 — Firestore Timestamp / Date / string 모두 처리, JST 포맷 반환
function parseBookedAt(reservation) {
  const { ms, source } = parseReservationCreatedAtMs(reservation);

  if (source === 'exact' && Number.isFinite(ms)) {
    const formatted = new Date(ms).toLocaleString("en-US", {
      timeZone: "Asia/Tokyo",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
      hour12: false
    });
    return `${formatted} (JST)`;
  }

  if (source === 'date_only_fallback' && Number.isFinite(ms)) {
    const jst = new Date(new Date(ms).toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
    const y = jst.getFullYear();
    const mo = String(jst.getMonth() + 1).padStart(2, "0");
    const d = String(jst.getDate()).padStart(2, "0");
    return `${y}-${mo}-${d} (date only)`;
  }

  return "No info";
}

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
function ReservationDetailModal({ reservation, onClose, onRefresh, isMobile, companyId }) {
  const [isEditing, setIsEditing] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const [editData, setEditData] = useState({
    ...reservation,
    totalPrice: reservation.totalPrice ?? reservation.price ?? ""
  });
  const [loading, setLoading] = useState(false);

  if (!reservation) return null;

  const handleUpdate = async () => {
    setLoading(true);
    try {
      const updatePayload = {
        companyId,
        bookId: reservation.bookId,
        building: reservation.building,
        guestName: editData.guestName,
        price: String(editData.totalPrice || "0"),
        numAdult: parseInt(editData.numAdult, 10) || 1,
        numChild: parseInt(editData.numChild, 10) || 0,
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
  const nights = reservation.nights || (() => {
    const arr = reservation.arrival ? new Date(reservation.arrival) : null;
    const dep = reservation.departure ? new Date(reservation.departure) : null;
    return arr && dep ? Math.round((dep - arr) / 86400000) : 0;
  })();
  const buildingRoomLabel = `${getBuildingNameEN(reservation.building)} · ${getRoomNameEN(reservation.room)}`;
  const guestSummary = `${isEditing ? editData.numAdult : reservation.numAdult || 0} Adults`;
  const childSummary = `${isEditing ? editData.numChild : reservation.numChild || 0} Children`;

  const detailRows = (
    <>
      <InfoRow icon={"📧"} label="Email" value={isEditing ? editData.guestEmail : reservation.guestEmail} field="guestEmail" isEditing={isEditing} editData={editData} setEditData={setEditData} />
      <InfoRow icon={"📞"} label="Phone" value={isEditing ? editData.guestPhone : reservation.guestPhone} field="guestPhone" isEditing={isEditing} editData={editData} setEditData={setEditData} />
      <InfoRow icon={"🌍"} label="Country" value={reservation.guestCountry} isEditing={isEditing} editData={editData} setEditData={setEditData} />
      <InfoRow icon={"⏰"} label="Est. Arrival" value={reservation.arrivalTime} isEditing={isEditing} editData={editData} setEditData={setEditData} />

      <div style={{ height: "12px" }} />

      <InfoRow icon={"🕐"} label="Booked At" value={parseBookedAt(reservation)} isEditing={isEditing} editData={editData} setEditData={setEditData} />
      <InfoRow icon={"📅"} label="Check-in" value={isEditing ? editData.arrival : reservation.arrival} field="arrival" isEditing={isEditing} editData={editData} setEditData={setEditData} />
      <InfoRow icon={"📅"} label="Check-out" value={isEditing ? editData.departure : reservation.departure} field="departure" isEditing={isEditing} editData={editData} setEditData={setEditData} />
      <InfoRow icon={"🌙"} label="Nights" value={reservation.nights ? `${reservation.nights} nights` : ""} isEditing={isEditing} editData={editData} setEditData={setEditData} />

      <div style={{ height: "12px" }} />

      <InfoRow icon={"👥"} label="Adults" value={isEditing ? editData.numAdult : reservation.numAdult} field="numAdult" isEditing={isEditing} editData={editData} setEditData={setEditData} />
      <InfoRow icon={"🧒"} label="Children" value={isEditing ? editData.numChild : reservation.numChild} field="numChild" isEditing={isEditing} editData={editData} setEditData={setEditData} />

      <div style={{ height: "12px" }} />

      <InfoRow icon={"🏷️"} label="Booking Ref." value={reservation.apiReference} isEditing={isEditing} editData={editData} setEditData={setEditData} />

      <div style={{ height: "12px" }} />

      <InfoRow icon={"💰"} label="Total" value={formatPrice(isEditing ? editData.totalPrice : (reservation.totalPrice || reservation.price))} field="totalPrice" isEditing={isEditing} editData={editData} setEditData={setEditData} />
      {nights > 0 && (
        <InfoRow
          icon={"🌙"}
          label="Per Night"
          value={formatPrice(Math.round((parseFloat(String(isEditing ? editData.totalPrice : (reservation.totalPrice || reservation.price)).replace(/[^0-9.-]+/g, "")) || 0) / nights))}
          isEditing={isEditing}
          editData={editData}
          setEditData={setEditData}
        />
      )}
      <InfoRow icon={"💎"} label="OTA Fee" value={formatPrice(reservation.commission)} isEditing={isEditing} editData={editData} setEditData={setEditData} />
      <InfoRow icon={"💵"} label="Net Revenue" value={formatPrice(reservation.netRevenue)} isEditing={isEditing} editData={editData} setEditData={setEditData} />

      <div style={{ marginTop: "16px", paddingBottom: "16px" }}>
        <div style={{ color: "#6B7280", fontSize: "14px", marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px", fontWeight: "500" }}>
          <span>{"💬"}</span> Notes & Requests
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
    </>
  );

  if (isMobile && !showFull) {
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
          <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 6px" }}>
            <div style={{ width: "36px", height: "4px", borderRadius: "2px", background: "#D1D1D6" }} />
          </div>

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
                {buildingRoomLabel}
              </div>
            </div>
            <button onClick={onClose} style={{
              width: "30px", height: "30px", borderRadius: "50%",
              border: "none", background: "#F2F2F7",
              fontSize: "16px", color: "#8E8E93", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>{"×"}</button>
          </div>

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
                {guestSummary}{(reservation.numChild || 0) > 0 ? ` · ${reservation.numChild} children` : ""}
              </div>
            </div>
          </div>

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
              {buildingRoomLabel}
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
          }}>{"×"}</button>
        </div>

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
            <span>{guestSummary}</span>
            <span>{childSummary}</span>
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

        <div style={{ flex: 1, overflowY: "auto", padding: "0 24px" }}>
          {detailRows}
        </div>

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
                      companyId,
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
                fontWeight: "500",
                cursor: "pointer"
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
function MonthPickerModal({ year, month, onSelect, onClose }) {
  const [selectedYear, setSelectedYear] = useState(year);
  const [selectedMonth, setSelectedMonth] = useState(month);

  const currentYear = new Date().getFullYear();
  const years = [];
  for (let y = currentYear - 2; y <= currentYear + 2; y++) {
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
function ManualBookingModal({ initialBuilding, initialRoom, initialDates, onClose, onSave, onOptimisticBlockStart, onOptimisticBlockRollback, companyId, roomPrices, priceCache }) {
  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(initialBuilding || "Arakicho A");
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
  const [basePrice, setBasePrice] = useState(null); // { value: number, label: string }
  const [priceAdjustPct, setPriceAdjustPct] = useState(0);

  const [modalPriceSource, setModalPriceSource] = useState(() => {
    const cachedByBuilding = priceCache?.[building];
    if (cachedByBuilding && Object.keys(cachedByBuilding).length > 0) return cachedByBuilding;
    if (building === initialBuilding) return roomPrices || {};
    return {};
  });

  useEffect(() => {
    const cachedByBuilding = priceCache?.[building];
    if (cachedByBuilding && Object.keys(cachedByBuilding).length > 0) {
      setModalPriceSource(cachedByBuilding);
      return;
    }
    if (building === initialBuilding && roomPrices && Object.keys(roomPrices).length > 0) {
      setModalPriceSource(roomPrices);
      return;
    }
    setModalPriceSource({});
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/getCachedPrices`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, building, forceRefresh: false })
        });
        const data = await res.json();
        if (!cancelled && data?.success && data?.priceData) {
          setModalPriceSource(data.priceData);
        }
      } catch (_) { /* fallback 실패 시 무시 */ }
    })();
    return () => { cancelled = true; };
  }, [building, initialBuilding, roomPrices, priceCache, companyId]);

  const rooms = BUILDING_ROOMS[building] || [];

  // 선택 기간의 날짜별 활성 룸아이디 캐시 업데이트
  const stayPriceData = useMemo(() => {
    if (!modalPriceSource || !room || !building || !arrival || !departure) return null;
    const unitInfos = (BUILDING_ROOMS[building] || []).filter(r => r.name === room);
    if (unitInfos.length === 0) return null;
    const stayDates = [];
    let cur = dayjs(arrival);
    const dep = dayjs(departure);
    while (cur.isBefore(dep)) {
      stayDates.push(cur.format('YYYY-MM-DD'));
      cur = cur.add(1, 'day');
    }
    if (stayDates.length === 0) return null;
    const rows = stayDates.map(dateStr => {
      const dateKey = dateStr.replace(/-/g, '');
      let activeCandidates = unitInfos;
      let unresolved = false;
      if (unitInfos.length > 1) {
        const active = unitInfos.filter(info => {
          const pi = modalPriceSource?.[String(info.roomId)]?.dates?.[dateKey];
          if (!pi) return false;
          const ms = parseInt(pi.m, 10);
          return Number.isFinite(ms) && ms >= 1 && ms < INACTIVE_MINSTAY_THRESHOLD;
        });
        if (active.length > 0) {
          activeCandidates = active;
        } else {
          unresolved = true; // active room 없음 → stale fallback 방식
        }
      }
      const merged = getMergedRoomChannelPrices({
        primaryUnitInfos: activeCandidates,
        fallbackUnitInfos: unitInfos,
        roomPrices: modalPriceSource,
        dateKey,
        preferAirbnbPrice3: false
      });
      return {
        date: dateStr,
        airbnb: merged.airbnbPrice > 0 ? Math.round(merged.airbnbPrice) : null,
        booking: merged.bookingPrice > 0 ? Math.round(merged.bookingPrice) : null,
        unresolved
      };
    });
    const hasAnyPrice = rows.some(r => r.airbnb !== null);
    const hasUnresolved = rows.some(r => r.unresolved);
    const totalAirbnb = rows.reduce((s, r) => s + (r.airbnb || 0), 0);
    const totalBooking = rows.reduce((s, r) => s + (r.booking || 0), 0);
    return { rows, totalAirbnb, totalBooking, hasAnyPrice, hasUnresolved };
  }, [modalPriceSource, room, building, arrival, departure]);

  const applyAdjustment = (pct) => {
    if (!basePrice) return;
    const adjusted = Math.round(basePrice.value * (1 + pct / 100));
    setPriceAdjustPct(pct);
    setPrice(String(adjusted));
  };

  const handleSave = async () => {
    if (!room) { alert("Please select a room."); return; }
    if (!guestName) { alert("Please enter guest name."); return; }
    if (!price) { alert("Please enter price."); return; }

    const targetRoomInfos = rooms.filter(r => r.name === room);
    if (targetRoomInfos.length === 0) { alert("Room information not found."); return; }

  // 만약 roomName으로 roomId를 찾을 때, stay 전체에서 active roomId로 통일해야 하는 경우 복잡함
    const lowerGuestName = String(guestName || "").toLowerCase();
    const isBlackout = lowerGuestName.includes("blackout") || lowerGuestName.includes("room block");
    const isBlockGuest = isBlackout;
    let mainRoomInfo = targetRoomInfos[0];
    if (targetRoomInfos.length > 1 && !isBlockGuest) {
      const stayDates = [];
      let cursor = dayjs(arrival);
      const dep = dayjs(departure);
      while (cursor.isBefore(dep)) {
        stayDates.push(cursor.format("YYYY-MM-DD"));
        cursor = cursor.add(1, "day");
      }

      const resolvedIdsByDate = stayDates.map((dateStr) => {
        const dateKey = dateStr.replace(/-/g, "");
        const activeInfos = targetRoomInfos.filter((info) => {
          const priceInfo = modalPriceSource?.[String(info.roomId)]?.dates?.[dateKey];
          const minStay = parseInt(priceInfo?.m, 10);
          return Number.isFinite(minStay) && minStay >= 1 && minStay < INACTIVE_MINSTAY_THRESHOLD;
        });
        return activeInfos[0] ? String(activeInfos[0].roomId) : "";
      });

      const unresolvedDates = stayDates.filter((_, idx) => !resolvedIdsByDate[idx]);
      const uniqueResolvedIds = [...new Set(resolvedIdsByDate.filter(Boolean))];
      if (unresolvedDates.length > 0 || uniqueResolvedIds.length !== 1) {
        alert("Active room could not be resolved for this stay after building change. Please refresh prices and try again.");
        return;
      }

      const resolvedInfo = targetRoomInfos.find((info) => String(info.roomId) === String(uniqueResolvedIds[0]));
      if (!resolvedInfo) {
        alert("Active room information not found.");
        return;
      }
      mainRoomInfo = resolvedInfo;
    }
    if (isBlackout && targetRoomInfos.length > 1) {
      const stayDates = [];
      let cursor = dayjs(arrival);
      const dep = dayjs(departure);
      while (cursor.isBefore(dep)) {
        stayDates.push(cursor.format("YYYY-MM-DD"));
        cursor = cursor.add(1, "day");
      }

      const resolveRoomInfoForDate = (dateStr) => {
        const dateKey = dateStr.replace(/-/g, "");
        const activeInfos = targetRoomInfos.filter((info) => {
          const priceInfo = modalPriceSource?.[String(info.roomId)]?.dates?.[dateKey];
          const minStay = parseInt(priceInfo?.m, 10);
          return Number.isFinite(minStay) && minStay >= 1 && minStay < INACTIVE_MINSTAY_THRESHOLD;
        });
        return activeInfos[0] || null;
      };

      const firstInfo = stayDates[0] ? resolveRoomInfoForDate(stayDates[0]) : targetRoomInfos[0];
      if (!firstInfo) {
        alert("Active room could not be resolved for this block stay after building change. Please refresh prices and try again.");
        return;
      }

      const blockSegments = [];
      let segmentStart = stayDates[0] || arrival;
      let currentInfo = firstInfo;

      for (let i = 1; i < stayDates.length; i++) {
        const nextInfo = resolveRoomInfoForDate(stayDates[i]);
        if (!nextInfo) {
          alert("Active room could not be resolved for this block stay after building change. Please refresh prices and try again.");
          return;
        }

        if (String(nextInfo.roomId) !== String(currentInfo.roomId)) {
          blockSegments.push({
            roomInfo: currentInfo,
            arrival: segmentStart,
            departure: stayDates[i]
          });
          segmentStart = stayDates[i];
          currentInfo = nextInfo;
        }
      }

      blockSegments.push({
        roomInfo: currentInfo,
        arrival: segmentStart,
        departure
      });

      const optimisticBlocks = blockSegments.map((seg, index) =>
        buildOptimisticInventoryBlock(seg.roomInfo.name, seg.arrival, seg.departure, `${Date.now()}:${index}`)
      );
      const rollbackIds = optimisticBlocks.map((block) => block.id);
      onOptimisticBlockStart && onOptimisticBlockStart(optimisticBlocks);
      onClose && onClose();
      try {
        const response = await axios.post(`${API_BASE_URL}/createBooking`, {
          companyId,
          building,
          blockSegments: blockSegments.map(seg => ({
            roomId: seg.roomInfo.roomId,
            room: seg.roomInfo.name,
            arrival: seg.arrival,
            departure: seg.departure,
          })),
          guestName: "Room Block (Blackout)",
          price: "0",
          numAdult,
          numChild,
          guestEmail: "",
          guestPhone: "",
          comments: "System Block",
          source: "Direct",
          isBlock: true
        });

        if (!response.data.success) {
          onOptimisticBlockRollback && onOptimisticBlockRollback(rollbackIds);
          alert("Failed to create room block: " + (response.data.error || "Unknown error"));
          return;
        }

        if (response.data.partialFailure) {
          const failed = (response.data.results || []).filter(r => !r.success);
          const failedIdSet = new Set(
            failed.map(r => `${r.arrival}__${r.departure}`)
          );
          const rollbackFailedIds = optimisticBlocks
            .filter(block => failedIdSet.has(`${block.arrival}__${block.departure}`))
            .map(block => block.id);
          if (rollbackFailedIds.length > 0) {
            onOptimisticBlockRollback && onOptimisticBlockRollback(rollbackFailedIds);
          }
          alert("Some segments failed:\n" + failed.map(r => `${r.arrival}~${r.departure}: ${r.error}`).join("\n"));
          onSave();
          return;
        }

        alert("Room block completed!");
        onSave();
      } catch (err) {
        onOptimisticBlockRollback && onOptimisticBlockRollback(rollbackIds);
        console.error(err);
        alert("Error: " + err.message);
      }
      return;
    }

    let optimisticSingleBlockIds = [];
    try {
      if (isBlackout) {
        const optimisticBlock = buildOptimisticInventoryBlock(mainRoomInfo.name, arrival, departure, Date.now());
        optimisticSingleBlockIds = [optimisticBlock.id];
        onOptimisticBlockStart && onOptimisticBlockStart([optimisticBlock]);
        onClose && onClose();
      }

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
        guestEmail: isBlackout ? "" : guestEmail,
        guestPhone: isBlackout ? "" : guestPhone,
        comments: isBlackout ? "System Block" : guestComments,
        source: "Direct",
        isBlock: isBlackout
      };

      const response = await axios.post(`${API_BASE_URL}/createBooking`, payload);

      if (response.data.success) {
        alert(isBlackout ? "Room block completed!" : "Reservation created successfully!");
        onSave();
      } else {
        if (isBlackout && optimisticSingleBlockIds.length > 0) {
          onOptimisticBlockRollback && onOptimisticBlockRollback(optimisticSingleBlockIds);
        }
        alert("Failed to create reservation: " + (response.data.error || "Unknown error"));
      }
    } catch (err) {
      if (isBlackout && optimisticSingleBlockIds.length > 0) {
        onOptimisticBlockRollback && onOptimisticBlockRollback(optimisticSingleBlockIds);
      }
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

  const buildOptimisticInventoryBlock = useCallback((roomName, blockArrival, blockDeparture, token) => {
    const tempId = `optimistic-blackout:${building}:${roomName}:${blockArrival}:${blockDeparture}:${token}`;
    return {
      id: tempId,
      bookId: tempId,
      companyId,
      building,
      room: roomName,
      guestName: "Beds24 Block",
      arrival: blockArrival,
      departure: blockDeparture,
      status: "blackout",
      source: "Beds24 Inventory",
      platform: "Direct",
      price: 0,
      totalPrice: 0,
      isExternalInventoryBlock: true,
      isOptimisticInventoryBlock: true,
      comments: "Beds24 calendar override blackout"
    };
  }, [building, companyId]);

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

          {/* Price Reference Panel */}
          {stayPriceData && stayPriceData.hasAnyPrice && (
            <div style={{ marginBottom: "20px", background: "#F8FAFC", borderRadius: "12px", border: "1px solid #E5E7EB", overflow: "hidden" }}>
              <div style={{ padding: "10px 16px", borderBottom: "1px solid #E5E7EB", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#F1F5F9" }}>
                <span style={{ fontSize: "13px", fontWeight: "700", color: "#374151" }}>Price Reference</span>
                <span style={{ fontSize: "11px", color: "#9CA3AF", fontWeight: "500" }}>Beds24 base rate · read-only</span>
              </div>
              {/* Column header */}
              <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 1fr", padding: "6px 16px", gap: "8px", borderBottom: "1px solid #F3F4F6" }}>
                <span style={{ fontSize: "11px", color: "#9CA3AF", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.05em" }}>Date</span>
                <span style={{ fontSize: "11px", color: "#F97316", fontWeight: "600", textAlign: "right", textTransform: "uppercase", letterSpacing: "0.05em" }}>Airbnb</span>
                <span style={{ fontSize: "11px", color: "#003580", fontWeight: "600", textAlign: "right", textTransform: "uppercase", letterSpacing: "0.05em" }}>Booking.com</span>
              </div>
              {/* Per-night rows */}
              <div style={{ maxHeight: "160px", overflowY: "auto" }}>
                {stayPriceData.rows.map((row, idx) => (
                  <div key={row.date} style={{ display: "grid", gridTemplateColumns: "90px 1fr 1fr", padding: "5px 16px", gap: "8px", background: row.unresolved ? "#FFF7ED" : idx % 2 === 0 ? "white" : "#FAFAFA" }}>
                    <span style={{ fontSize: "13px", color: row.unresolved ? "#B45309" : "#6B7280" }}>
                      {dayjs(row.date).format("MM/DD (ddd)")}{row.unresolved ? " *" : ""}
                    </span>
                    <span style={{ fontSize: "13px", color: row.airbnb ? "#111827" : "#D1D5DB", fontWeight: row.airbnb ? "600" : "400", textAlign: "right" }}>
                      {row.airbnb ? `¥${row.airbnb.toLocaleString()}` : '--'}
                    </span>
                    <span style={{ fontSize: "13px", color: row.booking ? "#374151" : "#D1D5DB", textAlign: "right" }}>
                      {row.booking ? `¥${row.booking.toLocaleString()}` : '--'}
                    </span>
                  </div>
                ))}
              </div>
              {/* Total row */}
              <div style={{ display: "grid", gridTemplateColumns: "90px 1fr 1fr", padding: "8px 16px", gap: "8px", borderTop: "1px solid #E5E7EB", background: stayPriceData.hasUnresolved ? "#FFF7ED" : "#EFF6FF" }}>
                <span style={{ fontSize: "13px", color: stayPriceData.hasUnresolved ? "#B45309" : "#374151", fontWeight: "700" }}>
                  {stayPriceData.hasUnresolved ? "Total*" : "Total"}
                </span>
                <span style={{ fontSize: "14px", color: stayPriceData.hasUnresolved ? "#B45309" : "#1D4ED8", fontWeight: "700", textAlign: "right" }}>
                  {stayPriceData.hasUnresolved ? `~¥${stayPriceData.totalAirbnb.toLocaleString()}` : `¥${stayPriceData.totalAirbnb.toLocaleString()}`}
                </span>
                <span style={{ fontSize: "13px", color: stayPriceData.hasUnresolved ? "#B45309" : "#374151", fontWeight: "600", textAlign: "right" }}>
                  {stayPriceData.hasUnresolved ? `~¥${stayPriceData.totalBooking.toLocaleString()}` : `¥${stayPriceData.totalBooking.toLocaleString()}`}
                </span>
              </div>
              {stayPriceData.hasUnresolved && (
                <div style={{ padding: "6px 16px", background: "#FFF7ED", borderTop: "1px solid #FDE68A" }}>
                  <span style={{ fontSize: "11px", color: "#B45309" }}>* Some dates could not resolve an active room. Quick-fill totals may be approximate.</span>
                </div>
              )}
              {/* Quick-fill buttons */}
              <div style={{ display: "flex", gap: "8px", padding: "10px 16px", borderTop: "1px solid #E5E7EB" }}>
                <button
                  disabled={stayPriceData.hasUnresolved}
                  onClick={() => {
                    const val = stayPriceData.totalAirbnb;
                    setBasePrice({ value: val, label: "Airbnb" });
                    setPriceAdjustPct(0);
                    setPrice(String(val));
                  }}
                  style={{ flex: 1, padding: "7px 10px", background: stayPriceData.hasUnresolved ? "#F3F4F6" : basePrice?.label === "Airbnb" ? "#FED7AA" : "#FFF7ED", color: stayPriceData.hasUnresolved ? "#9CA3AF" : "#C2410C", border: stayPriceData.hasUnresolved ? "1px solid #E5E7EB" : basePrice?.label === "Airbnb" ? "2px solid #F97316" : "1px solid #FDBA74", borderRadius: "8px", fontSize: "12px", fontWeight: "600", cursor: stayPriceData.hasUnresolved ? "not-allowed" : "pointer", transition: "all 0.15s", opacity: stayPriceData.hasUnresolved ? 0.6 : 1 }}
                  title={stayPriceData.hasUnresolved ? "Automatic fill is unavailable until the active room is resolved" : undefined}
                >
                  Use Airbnb ¥{stayPriceData.totalAirbnb.toLocaleString()}
                </button>
                <button
                  disabled={stayPriceData.hasUnresolved}
                  onClick={() => {
                    const val = stayPriceData.totalBooking;
                    setBasePrice({ value: val, label: "Booking" });
                    setPriceAdjustPct(0);
                    setPrice(String(val));
                  }}
                  style={{ flex: 1, padding: "7px 10px", background: stayPriceData.hasUnresolved ? "#F3F4F6" : basePrice?.label === "Booking" ? "#BFDBFE" : "#EFF6FF", color: stayPriceData.hasUnresolved ? "#9CA3AF" : "#1D4ED8", border: stayPriceData.hasUnresolved ? "1px solid #E5E7EB" : basePrice?.label === "Booking" ? "2px solid #3B82F6" : "1px solid #BFDBFE", borderRadius: "8px", fontSize: "12px", fontWeight: "600", cursor: stayPriceData.hasUnresolved ? "not-allowed" : "pointer", transition: "all 0.15s", opacity: stayPriceData.hasUnresolved ? 0.6 : 1 }}
                  title={stayPriceData.hasUnresolved ? "Automatic fill is unavailable until the active room is resolved" : undefined}
                >
                  Use Booking ¥{stayPriceData.totalBooking.toLocaleString()}
                </button>
              </div>

              {/* Percentage Adjustment Panel → Use 버튼 클릭 시에만 표시 */}
              {basePrice && (
                <div style={{ padding: "12px 16px", borderTop: "1px solid #E5E7EB", background: "#F8FAFF" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                    <span style={{ fontSize: "12px", fontWeight: "700", color: "#374151" }}>Price Adjustment</span>
                    <span style={{ fontSize: "11px", color: "#9CA3AF" }}>
                      Base ¥{basePrice.value.toLocaleString()} · {basePrice.label}
                    </span>
                  </div>

                  {/* Preset chips */}
                  <div style={{ display: "flex", gap: "6px", marginBottom: "10px", flexWrap: "wrap" }}>
                    {[-10, -5, 0, 5, 10].map(pct => (
                      <button
                        key={pct}
                        onClick={() => applyAdjustment(pct)}
                        style={{
                          padding: "4px 12px",
                          borderRadius: "20px",
                          fontSize: "12px",
                          fontWeight: "600",
                          cursor: "pointer",
                          border: priceAdjustPct === pct ? "2px solid #4F46E5" : "1px solid #E5E7EB",
                          background: priceAdjustPct === pct ? "#EEF2FF" : "white",
                          color: pct < 0 ? "#DC2626" : pct > 0 ? "#16A34A" : "#374151",
                          transition: "all 0.15s"
                        }}
                      >
                        {pct > 0 ? `+${pct}%` : `${pct}%`}
                      </button>
                    ))}
                  </div>

                  {/* Custom percentage input */}
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <button
                      onClick={() => applyAdjustment(priceAdjustPct - 1)}
                      style={{ width: "30px", height: "30px", borderRadius: "8px", border: "1px solid #E5E7EB", background: "white", fontSize: "16px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#DC2626", fontWeight: "700", flexShrink: 0 }}
                    >‹</button>
                    <div style={{ display: "flex", alignItems: "center", border: "1px solid #C7D2FE", borderRadius: "8px", overflow: "hidden", background: "white" }}>
                      <input
                        type="number"
                        value={priceAdjustPct}
                        onChange={(e) => applyAdjustment(Number(e.target.value))}
                        style={{ width: "56px", padding: "5px 8px", border: "none", outline: "none", fontSize: "14px", fontWeight: "700", textAlign: "center", color: priceAdjustPct < 0 ? "#DC2626" : priceAdjustPct > 0 ? "#16A34A" : "#374151" }}
                      />
                      <span style={{ paddingRight: "8px", fontSize: "13px", color: "#6B7280", fontWeight: "600" }}>%</span>
                    </div>
                    <button
                      onClick={() => applyAdjustment(priceAdjustPct + 1)}
                      style={{ width: "30px", height: "30px", borderRadius: "8px", border: "1px solid #E5E7EB", background: "white", fontSize: "16px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#16A34A", fontWeight: "700", flexShrink: 0 }}
                    >+</button>
                    {priceAdjustPct !== 0 && (
                      <span style={{ fontSize: "13px", fontWeight: "700", color: priceAdjustPct < 0 ? "#DC2626" : "#16A34A", marginLeft: "4px" }}>
                        → ¥{Math.round(basePrice.value * (1 + priceAdjustPct / 100)).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

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

// 필터 버튼 스타일
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

// 건물/객실 분석 데이터 계산 (순수 함수 형태로 컴포넌트 바깥에서 정의하여 최적화)
function calculateBuildingMetrics(targetReservations, targetRooms, daysInMonth, year, month) {
  const uniqueRoomNames = [...new Set(targetRooms.map(r => r.name))];

  let occupiedSlot = 0;

  uniqueRoomNames.forEach(roomName => {
    const roomRes = targetReservations.filter(r => r.room === roomName && r.status === "confirmed");
    if (roomRes.length === 0) return;

    const occupiedSet = new Set();
    const mStart = new Date(year, month, 1);
    const mEnd = new Date(year, month, daysInMonth);

    roomRes.forEach(r => {
      if (!r.arrival || !r.departure) return;

      const [sY, sM, sD] = r.arrival.split('-').map(Number);
      const [eY, eM, eD] = r.departure.split('-').map(Number);

      const start = new Date(sY, sM - 1, sD);
      const end = new Date(eY, eM - 1, eD);
      end.setDate(end.getDate() - 1);

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

  const totalSlot = uniqueRoomNames.length * daysInMonth;
  const occupancyRate = totalSlot > 0 ? (occupiedSlot / totalSlot) * 100 : 0;
  const vacantNights = Math.max(0, totalSlot - occupiedSlot);

  let totalRevenue = 0;
  let occupiedRoomsToday = 0;
  const todayStr = new Date().toISOString().slice(0, 10);
  const roomNamesWithReservationToday = new Set();
  targetReservations.forEach(r => {
    if (r.status === "confirmed" && r.arrival <= todayStr && r.departure > todayStr) {
      roomNamesWithReservationToday.add(r.room);
    }
  });
  occupiedRoomsToday = roomNamesWithReservationToday.size;

  targetReservations.forEach(r => {
    if (r.status !== "confirmed" || !r.arrival || !r.departure) return;
    const arrivalDate = new Date(r.arrival + 'T00:00:00');
    const departureDate = new Date(r.departure + 'T00:00:00');
    const monthStartDate = new Date(year, month, 1);
    const monthEndDate = new Date(year, month + 1, 1);

    const effectiveStart = arrivalDate < monthStartDate ? monthStartDate : arrivalDate;
    const effectiveEnd = departureDate > monthEndDate ? monthEndDate : departureDate;

    if (effectiveEnd > effectiveStart) {
      const nightsInMonth = Math.ceil((effectiveEnd - effectiveStart) / (1000 * 60 * 60 * 24));
      const totalReservationNights = Math.max(1, Math.ceil((departureDate - arrivalDate) / (1000 * 60 * 60 * 24)));

      const val = parseFloat(r.totalPrice) || parseFloat(r.price) || parseFloat(r.netRevenue) || 0;
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
    occupiedDays: occupiedSlot,
    availableDays: totalSlot
  };
}

function calculateBuildingMetricsForRange(targetReservations, targetRooms, rangeStartStr, rangeEndStr) {
  const uniqueRoomNames = [...new Set(targetRooms.map(r => r.name))];
  const rangeStart = dayjs(rangeStartStr).startOf("day");
  const rangeEnd = dayjs(rangeEndStr).startOf("day");
  if (!rangeStart.isValid() || !rangeEnd.isValid() || rangeEnd.isBefore(rangeStart)) {
    return {
      occupancyRate: 0,
      emptyRoomsToday: 0,
      vacantNights: 0,
      avgPrice: 0,
      totalRevenue: 0,
      occupiedDays: 0,
      availableDays: 0
    };
  }

  const rangeEndExclusive = rangeEnd.add(1, "day");
  const rangeDays = rangeEnd.diff(rangeStart, "day") + 1;
  let occupiedSlot = 0;

  uniqueRoomNames.forEach(roomName => {
    const roomRes = targetReservations.filter(r => r.room === roomName && r.status === "confirmed");
    const occupiedSet = new Set();

    roomRes.forEach(r => {
      if (!r.arrival || !r.departure) return;
      const arrivalDate = dayjs(r.arrival).startOf("day");
      const departureDate = dayjs(r.departure).startOf("day");
      if (!arrivalDate.isValid() || !departureDate.isValid()) return;

      const effectiveStart = arrivalDate.isAfter(rangeStart) ? arrivalDate : rangeStart;
      const effectiveEnd = departureDate.isBefore(rangeEndExclusive) ? departureDate : rangeEndExclusive;
      if (!effectiveEnd.isAfter(effectiveStart)) return;

      for (let d = effectiveStart; d.isBefore(effectiveEnd); d = d.add(1, "day")) {
        occupiedSet.add(d.format("YYYY-MM-DD"));
      }
    });

    occupiedSlot += occupiedSet.size;
  });

  const totalSlot = uniqueRoomNames.length * rangeDays;
  const occupancyRate = totalSlot > 0 ? (occupiedSlot / totalSlot) * 100 : 0;
  const vacantNights = Math.max(0, totalSlot - occupiedSlot);

  let totalRevenue = 0;
  const todayStr = dayjs().format("YYYY-MM-DD");
  const roomNamesWithReservationToday = new Set();
  targetReservations.forEach(r => {
    if (r.status === "confirmed" && r.arrival <= todayStr && r.departure > todayStr) {
      roomNamesWithReservationToday.add(r.room);
    }
  });

  targetReservations.forEach(r => {
    if (r.status !== "confirmed" || !r.arrival || !r.departure) return;
    const arrivalDate = dayjs(r.arrival).startOf("day");
    const departureDate = dayjs(r.departure).startOf("day");
    if (!arrivalDate.isValid() || !departureDate.isValid()) return;

    const effectiveStart = arrivalDate.isAfter(rangeStart) ? arrivalDate : rangeStart;
    const effectiveEnd = departureDate.isBefore(rangeEndExclusive) ? departureDate : rangeEndExclusive;
    if (!effectiveEnd.isAfter(effectiveStart)) return;

    const visibleNights = effectiveEnd.diff(effectiveStart, "day");
    const totalReservationNights = Math.max(1, departureDate.diff(arrivalDate, "day"));
    const val = parseFloat(r.totalPrice) || parseFloat(r.price) || parseFloat(r.netRevenue) || 0;
    if (val > 0 && totalReservationNights > 0) {
      totalRevenue += (val / totalReservationNights) * visibleNights;
    }
  });

  return {
    occupancyRate,
    emptyRoomsToday: Math.max(0, uniqueRoomNames.length - roomNamesWithReservationToday.size),
    vacantNights,
    avgPrice: occupiedSlot > 0 ? totalRevenue / occupiedSlot : 0,
    totalRevenue,
    occupiedDays: occupiedSlot,
    availableDays: totalSlot
  };
}

function normalizeDateInput(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

function getResolvedDateInput(value) {
  const normalized = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1) return null;

  const lastDayOfMonth = dayjs(new Date(year, month, 0)).date();
  const safeDay = Math.min(day, lastDayOfMonth);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
}

function parseMoneyAmount(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = parseFloat(String(value).replace(/[^0-9.-]+/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getReservationChannelKey(reservation) {
  const source = [
    reservation?.referer,
    reservation?.referrer,
    reservation?.channel,
    reservation?.platform,
    reservation?.source,
    reservation?.apiSource
  ].filter(Boolean).join(" ").toLowerCase();

  if (source.includes("airbnb")) return "airbnb";
  if (source.includes("booking")) return "booking";
  if (source.includes("direct") || source.includes("manual")) return "direct";
  return "other";
}

function calculateCommissionSummary(targetReservations, visibleDays) {
  const firstDate = visibleDays[0]?.dateStr;
  const lastDate = visibleDays[visibleDays.length - 1]?.dateStr;
  if (!firstDate || !lastDate) return { airbnb: 0, booking: 0, total: 0 };

  const rangeStart = dayjs(firstDate).startOf("day");
  const rangeEnd = dayjs(lastDate).add(1, "day").startOf("day");
  const summary = { airbnb: 0, booking: 0 };

  targetReservations.forEach((reservation) => {
    if (reservation.status !== "confirmed" || !reservation.arrival || !reservation.departure) return;

    const channelKey = getReservationChannelKey(reservation);
    if (channelKey !== "airbnb" && channelKey !== "booking") return;

    const commission = parseMoneyAmount(reservation.commission);
    if (commission <= 0) return;

    const arrivalDate = dayjs(reservation.arrival).startOf("day");
    const departureDate = dayjs(reservation.departure).startOf("day");
    const totalReservationNights = Math.max(1, departureDate.diff(arrivalDate, "day"));
    const effectiveStart = arrivalDate.isAfter(rangeStart) ? arrivalDate : rangeStart;
    const effectiveEnd = departureDate.isBefore(rangeEnd) ? departureDate : rangeEnd;
    const visibleNights = effectiveEnd.diff(effectiveStart, "day");

    if (visibleNights <= 0) return;
    summary[channelKey] += (commission / totalReservationNights) * visibleNights;
  });

  return {
    airbnb: summary.airbnb,
    booking: summary.booking,
    total: summary.airbnb + summary.booking
  };
}

function calculateArrivalCountSummary(targetReservations, visibleDays) {
  const firstDate = visibleDays[0]?.dateStr;
  const lastDate = visibleDays[visibleDays.length - 1]?.dateStr;
  if (!firstDate || !lastDate) return { airbnb: 0, booking: 0, direct: 0, total: 0 };

  const rangeStart = dayjs(firstDate).startOf("day");
  const rangeEnd = dayjs(lastDate).add(1, "day").startOf("day");
  const summary = { airbnb: 0, booking: 0, direct: 0 };

  targetReservations.forEach((reservation) => {
    if (reservation.status !== "confirmed" || !reservation.arrival) return;

    const arrivalDate = dayjs(reservation.arrival).startOf("day");
    if (!arrivalDate.isValid()) return;
    if (arrivalDate.isBefore(rangeStart) || !arrivalDate.isBefore(rangeEnd)) return;

    const channelKey = getReservationChannelKey(reservation);
    if (channelKey !== "airbnb" && channelKey !== "booking" && channelKey !== "direct") return;

    summary[channelKey] += 1;
  });

  return {
    airbnb: summary.airbnb,
    booking: summary.booking,
    direct: summary.direct,
    total: summary.airbnb + summary.booking + summary.direct
  };
}

// 메인 캘린더 컴포넌트
function BuildingCalendar() {
  const { companyId } = useUser();

  const [selectedBuilding, setSelectedBuilding] = useState("Arakicho A");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [portfolioDateFrom, setPortfolioDateFrom] = useState("");
  const [portfolioDateTo, setPortfolioDateTo] = useState("");
  // 타이핑 버퍼와 분리된 확정 날짜 상태 (실제 조회에만 사용)
  const [committedDateFrom, setCommittedDateFrom] = useState("");
  const [committedDateTo, setCommittedDateTo] = useState("");
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedReservation, setSelectedReservation] = useState(null);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [expandedBuildings, setExpandedBuildings] = useState([]); // 전체보기 확장 상태
  const [isCalendarFullscreen, setIsCalendarFullscreen] = useState(false);
  const [portfolioPriceBuilding, setPortfolioPriceBuilding] = useState(ACTIVE_BUILDING_ORDER[0] || "");

  // 캘린더 드래그 스크롤 참조
  const calendarRef = React.useRef(null);
  const calendarHeaderRowRef = useRef(null);
  const [isDraggingCalendar, setIsDraggingCalendar] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);

  const handleCalendarMouseDown = (e) => {
    if (priceMode || gapEditMode) return; // 가격/Gap 모드에서는 스크롤 선택 기능과 충돌 방지로 제외
    // 예약 팝업 버튼 클릭 시 드래그 방식
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
    const walk = (startX - x) * 1.5; // 스크롤 속도감을 위한 가속도
    const nextScrollLeft = scrollLeft + walk;
    calendarRef.current.scrollLeft = nextScrollLeft;
    syncCalendarHeaderScroll(nextScrollLeft);
  };

  const handleCalendarMouseUp = () => {
    setIsDraggingCalendar(false);
  };

  const syncCalendarHeaderScroll = useCallback((nextScrollLeft) => {
    if (!calendarHeaderRowRef.current || isCalendarFullscreen) return;
    calendarHeaderRowRef.current.scrollLeft = nextScrollLeft;
  }, [isCalendarFullscreen]);

  const restoreCalendarViewport = useCallback((viewport) => {
    if (!viewport) return;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!calendarRef.current) return;
        calendarRef.current.scrollLeft = viewport.left;
        calendarRef.current.scrollTop = viewport.top;
        syncCalendarHeaderScroll(viewport.left);
      });
    });
  }, [syncCalendarHeaderScroll]);

  // 가격 설정 관련 state
  const [priceMode, setPriceMode] = useState(false);
  const [isDragging, setIsDragging] = useState(false); // 드래그 선택 상태 (가격모드에서 사용)
  const [selectedRoom, setSelectedRoom] = useState(null); // 선택된 방 (마지막 선택 편의를 위해)
  const [selectedCells, setSelectedCells] = useState([]); // cell-level selection: [{ room: "701호", date: "2026-02-05" }, ...]

  // selectedCells에서 고유한 방만 추출 (편의를 위해)
  const selectedRooms = useMemo(() => [...new Set(selectedCells.map(c => c.room))], [selectedCells]);
  const selectedDates = useMemo(() => [...new Set(selectedCells.map(c => c.date))], [selectedCells]);
  const selectedDateSet = useMemo(() => new Set(selectedDates), [selectedDates]);
  const getSelectedCellKey = useCallback((roomName, dateStr) => `${roomName}__${dateStr}`, []);
  const selectedCellKeySet = useMemo(
    () => new Set(selectedCells.map((cell) => getSelectedCellKey(cell.room, cell.date))),
    [selectedCells, getSelectedCellKey]
  );
  const [showPriceModal, setShowPriceModal] = useState(false);
  const [showManualBookingModal, setShowManualBookingModal] = useState(false);
  const [showPriceInsightModal, setShowPriceInsightModal] = useState(false);
  const [insightSelectedBuilding, setInsightSelectedBuilding] = useState(null); // 모달 내 건물 선택
  const [gapEditMode, setGapEditMode] = useState(false); // Gap 설정 모드
  const [showGapEditModal, setShowGapEditModal] = useState(false); // Gap 설정 모달
  const [gapEditMinStay, setGapEditMinStay] = useState(1); // 1박 또는 2박
  const [customMinStay, setCustomMinStay] = useState(""); // custom 3+ 입력값
  const [isGapApplying, setIsGapApplying] = useState(false); // Gap 적용 중 상태
  const [showCancelled, setShowCancelled] = useState(false); // 취소된 예약 보기 여부

  // 블록 관리 관련 상태
  const [showBlockCleanupModal, setShowBlockCleanupModal] = useState(false);
  const [blockData, setBlockData] = useState([]);
  const [blockLoading, setBlockLoading] = useState(false);
  const [blockDeleting, setBlockDeleting] = useState(false);
  const [optimisticInventoryBlocks, setOptimisticInventoryBlocks] = useState([]);
  const [selectionStart, setSelectionStart] = useState(null); // { room, date }
  const [hoveredDay, setHoveredDay] = useState(null); // dateStr (YYYY-MM-DD)
  const [hoveredRoom, setHoveredRoom] = useState(null);
  const [dragAction, setDragAction] = useState(null); // 'select' or 'deselect'

  const navigate = useNavigate();
  const [roomPrices, setRoomPrices] = useState({});
  const [pricesLoading, setPricesLoading] = useState(false);
  const [pricesError, setPricesError] = useState(false);
  const pricesLoadingRef = useRef(false);
  const priceModeRef = useRef(false);
  const selectedBuildingRef = useRef(selectedBuilding);
  const [priceCache, setPriceCache] = useState({}); // 건물별 가격 캐시: { "아라키초A": {...} }
  const [priceInterventionLogs, setPriceInterventionLogs] = useState([]);
  const priceCacheRef = useRef({});
  // priceCache는 반드시 updatePriceCache로만 갱신 (state/ref 동기화 보장)
  const updatePriceCache = useCallback((updater) => {
    setPriceCache((prev) => {
      const next = updater(prev);
      if (next === prev) return prev;
      if (next === null || typeof next !== "object" || Array.isArray(next)) {
        console.warn("[BuildingCalendar] priceCache updater must return a plain object; kept previous cache.");
        if (process.env.NODE_ENV === "development") {
          console.warn("[BuildingCalendar] Do not call setPriceCache directly — use updatePriceCache.");
        }
        return prev;
      }
      priceCacheRef.current = next;
      return next;
    });
  }, []);
  const priceFetchControllerRef = useRef(null);
  const priceFetchRequestIdRef = useRef(0);
  const fetchPricesRef = useRef(null);
  const isMountedRef = useRef(true); // unmount 후 상태 오염 방지
  const [lastPriceSyncByBuilding, setLastPriceSyncByBuilding] = useState({}); // 건물별 마지막 동기화 시각
  const selectedCellKeySetRef = useRef(new Set());
  const [viewMode, setViewMode] = useState("monthly"); // "monthly" | "rolling"
  const [rollingStartDate, setRollingStartDate] = useState(new Date()); // 롤링 뷰 시작일
  const [dateSearchInput, setDateSearchInput] = useState(""); // date jump input (YYYY-MM-DD)
  // ✅ 가격 설정 job 상태 추적 관련
  const [pendingPriceJobs, setPendingPriceJobs] = useState({}); // { [jobId]: { jobId, building, roomCount, status, pendingCells, usePollingFallback } }
  const pendingPriceJobsRef = useRef({});
  const prevPendingJobIdsRef = useRef(new Set());
  const priceJobListenersRef = useRef({});
  const lastInterventionFetchKeyRef = useRef(null);
  const lastInterventionFetchAtRef = useRef(0);
  const [priceJobToast, setPriceJobToast] = useState(null);     // { status: 'success'|'error'|'partial'|'queued', message }
  const [priceCellTooltip, setPriceCellTooltip] = useState(null); // { text, x, y }
  const priceCellTooltipRef = useRef(null);
  const priceCellTooltipFrameRef = useRef(null);
  const pendingPriceJobList = useMemo(() => Object.values(pendingPriceJobs), [pendingPriceJobs]);
  const calendarBuilding = selectedBuilding === "전체" && (priceMode || gapEditMode) ? portfolioPriceBuilding : selectedBuilding;
  const showBeds24DetailView = !!calendarBuilding && calendarBuilding !== "전체";
  const [vacantOnlyMode, setVacantOnlyMode] = useState(false);
  const toggleCalendarFullscreen = useCallback(() => {
    setIsCalendarFullscreen((prev) => !prev);
  }, []);

  // 모바일 전용 state
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [mobileWeekStart, setMobileWeekStart] = useState(() => {
    const today = dayjs();
    const dow = today.day(); // 0 = Sunday
    return today.add(dow === 0 ? -6 : 1 - dow, 'day'); // 이번 주 월요일
  });
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    priceModeRef.current = priceMode;
  }, [priceMode]);

  useEffect(() => {
    selectedBuildingRef.current = calendarBuilding;
  }, [calendarBuilding]);

  useEffect(() => {
    if (!companyId || !showBeds24DetailView) {
      if (!companyId) setPriceInterventionLogs([]);
      return;
    }

    const now = Date.now();
    const fetchKey = companyId;
    if (
      lastInterventionFetchKeyRef.current === fetchKey &&
      now - lastInterventionFetchAtRef.current < 60_000
    ) {
      return;
    }

    let cancelled = false;
    const fetchPriceInterventions = async () => {
      try {
        const q = query(
          collection(db, "price_change_logs"),
          where("companyId", "==", companyId),
          orderBy("timestamp", "desc"),
          limit(PRICE_INTERVENTION_LIMIT)
        );
        const snapshot = await getDocs(q);
        if (cancelled) return;
        lastInterventionFetchKeyRef.current = fetchKey;
        lastInterventionFetchAtRef.current = Date.now();
        setPriceInterventionLogs(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
      } catch (error) {
        console.error("[BuildingCalendar] Failed to fetch price interventions:", error);
      }
    };

    fetchPriceInterventions();
    return () => {
      cancelled = true;
    };
  }, [companyId, showBeds24DetailView]);

  useEffect(() => () => {
    if (priceCellTooltipFrameRef.current) {
      cancelAnimationFrame(priceCellTooltipFrameRef.current);
    }
  }, []);

  useEffect(() => {
    if (!isCalendarFullscreen) return undefined;

    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsCalendarFullscreen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isCalendarFullscreen]);

  useEffect(() => {
    pendingPriceJobsRef.current = pendingPriceJobs;
  }, [pendingPriceJobs]);

  // 선택 셀 ref 동기화
  useEffect(() => {
    selectedCellKeySetRef.current = new Set(selectedCellKeySet);
  }, [selectedCellKeySet]);

  const applyCellSelection = useCallback((roomName, dateStr, action) => {
    const cellKey = getSelectedCellKey(roomName, dateStr);

    if (action === 'select') {
      if (selectedCellKeySetRef.current.has(cellKey)) return;
      selectedCellKeySetRef.current.add(cellKey);
      setSelectedCells(prev => [...prev, { room: roomName, date: dateStr }]);
      return;
    }

    if (!selectedCellKeySetRef.current.has(cellKey)) return;
    selectedCellKeySetRef.current.delete(cellKey);
    setSelectedCells(prev => prev.filter(c => !(c.room === roomName && c.date === dateStr)));
  }, [getSelectedCellKey]);

  const clearPendingPriceJob = useCallback((jobId) => {
    setPendingPriceJobs(prev => {
      if (!prev[jobId]) return prev;
      const next = { ...prev };
      delete next[jobId];
      return next;
    });
  }, []);

  const triggerPriceJobNow = useCallback((jobId) => {
    if (!jobId || !companyId) return;
    fetch(`${API_BASE_URL}/triggerPriceJobNow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, companyId })
    }).catch((err) => {
      console.warn("[PriceJob Trigger]", err.message);
    });
  }, [companyId]);

  const handlePendingPriceJobUpdate = useCallback((jobId, data = {}) => {
    const existingJob = pendingPriceJobsRef.current[jobId];
    if (!existingJob) return;

    const nextStatus = data.status || existingJob.status || "queued";
    if (nextStatus === "processing") {
      if (existingJob.status === "processing") return;
      setPendingPriceJobs(prev => prev[jobId]
        ? ({
            ...prev,
            [jobId]: {
              ...prev[jobId],
              status: "processing"
            }
          })
        : prev);
      return;
    }

    if (nextStatus === "completed" || nextStatus === "failed" || nextStatus === "partial_failed") {
      clearPendingPriceJob(jobId);
      if (nextStatus === "completed") {
        setPriceJobToast({ status: "success", message: `Price update completed. (${existingJob.roomCount} rooms)` });
      } else if (nextStatus === "partial_failed") {
        const failList = (data.failedRoomIds || []).join(", ");
        setPriceJobToast({ status: "partial", message: failList ? `Partially completed. Failed roomId: ${failList}` : "Partially completed. Please review the affected rooms." });
      } else {
        setPriceJobToast({ status: "error", message: `Price update failed: ${data.error || "Unknown error"}` });
      }
      if (existingJob.building) {
        fetchPricesRef.current && fetchPricesRef.current(true, existingJob.building);
      }
      return;
    }

    const nextFailedRoomIds = data.failedRoomIds || existingJob.failedRoomIds || [];
    const nextError = data.error || existingJob.error || null;
    const sameFailedRoomIds = JSON.stringify(existingJob.failedRoomIds || []) === JSON.stringify(nextFailedRoomIds || []);
    if (existingJob.status === nextStatus && existingJob.error === nextError && sameFailedRoomIds) {
      return;
    }

    setPendingPriceJobs(prev => prev[jobId]
      ? ({
          ...prev,
          [jobId]: {
            ...prev[jobId],
            status: nextStatus,
            failedRoomIds: nextFailedRoomIds,
            error: nextError
          }
        })
      : prev);
  }, [clearPendingPriceJob]);

  useEffect(() => {
    return () => {
      Object.values(priceJobListenersRef.current).forEach((unsubscribe) => {
        try {
          unsubscribe();
        } catch (_) {}
      });
      priceJobListenersRef.current = {};
    };
  }, []);

  useEffect(() => {
    const currentIds = new Set(Object.keys(pendingPriceJobs));
    const prevIds = prevPendingJobIdsRef.current;

    // removed: jobId가 사라진 경우만 unsubscribe
    prevIds.forEach((jobId) => {
      if (currentIds.has(jobId)) return;
      const unsub = priceJobListenersRef.current[jobId];
      if (unsub) {
        try { unsub(); } catch (_) {}
        delete priceJobListenersRef.current[jobId];
      }
    });

    // added: 신규 jobId에만 listener 등록
    currentIds.forEach((jobId) => {
      if (prevIds.has(jobId)) return; // 기존 job — 재등록 안 함
      const job = pendingPriceJobs[jobId];
      if (!job || priceJobListenersRef.current[jobId] || job.usePollingFallback) return;
      priceJobListenersRef.current[jobId] = onSnapshot(
        doc(db, "beds24_price_jobs", jobId),
        (snapshot) => {
          if (!snapshot.exists()) return;
          handlePendingPriceJobUpdate(jobId, snapshot.data() || {});
        },
        (error) => {
          console.warn("[PriceJob Snapshot]", error.message);
          setPendingPriceJobs(prev => prev[jobId]
            ? ({
                ...prev,
                [jobId]: {
                  ...prev[jobId],
                  usePollingFallback: true
                }
              })
            : prev);
          const unsub2 = priceJobListenersRef.current[jobId];
          if (unsub2) {
            try { unsub2(); } catch (_) {}
            delete priceJobListenersRef.current[jobId];
          }
        }
      );
    });

    prevPendingJobIdsRef.current = currentIds;
  }, [handlePendingPriceJobUpdate, pendingPriceJobs]);

  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      Object.values(pendingPriceJobsRef.current).forEach((job) => {
        if (!job?.jobId || job.status !== "queued") return;
        const kickAttempts = job.kickAttempts || 1;
        const lastKickAtMs = job.lastKickAtMs || job.createdAtMs || 0;
        if (kickAttempts >= 5) return;
        if ((now - lastKickAtMs) < 4000) return;

        triggerPriceJobNow(job.jobId);
        setPendingPriceJobs(prev => prev[job.jobId]
          ? ({
              ...prev,
              [job.jobId]: {
                ...prev[job.jobId],
                kickAttempts: (prev[job.jobId].kickAttempts || 1) + 1,
                lastKickAtMs: now
              }
            })
          : prev);
      });
    }, 4000);

    return () => clearInterval(id);
  }, [triggerPriceJobNow]);

  useEffect(() => {
    const MAX_ATTEMPTS = 120; // 최대 8분 (Beds24 cooldown + next worker tick 여유)
    const attemptsRef = { current: 0 };
    let cancelled = false;

    const poll = async () => {
      const pollingJobIds = Object.entries(pendingPriceJobsRef.current)
        .filter(([, job]) => job.usePollingFallback)
        .map(([jobId]) => jobId);

      if (pollingJobIds.length === 0) {
        attemptsRef.current = 0;
        return;
      }

      attemptsRef.current++;
      if (attemptsRef.current > MAX_ATTEMPTS) {
        pollingJobIds.forEach((jobId) => clearPendingPriceJob(jobId));
        setPriceJobToast({ status: "error", message: "Processing is taking longer than expected. Please refresh prices in a moment." });
        return;
      }

      await Promise.all(pollingJobIds.map(async (jobId) => {
        try {
          const res = await fetch(`${API_BASE_URL}/getPriceJobStatus`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId, companyId })
          });
          const data = await res.json();
          if (!cancelled) {
            handlePendingPriceJobUpdate(jobId, data);
          }
        } catch (err) {
          console.error("[PriceJob Poll]", err.message);
        }
      }));
    };

    poll();
    const id = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [clearPendingPriceJob, companyId, handlePendingPriceJobUpdate]);

  // priceJobToast 자동 닫기 (6초)
  useEffect(() => {
    if (!priceJobToast) return;
    const duration = priceJobToast.status === "queued" ? 1800 : 6000;
    const id = setTimeout(() => setPriceJobToast(null), duration);
    return () => clearTimeout(id);
  }, [priceJobToast]);
  const handleMobileWeekNav = (direction) => {
    setMobileWeekStart(prev => {
      const next = prev.add(direction * 7, 'day');
      setCurrentDate(next.toDate()); // 해당 달의 날짜 데이터 불러오기
      return next;
    });
  };

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const daysInMonth = getDaysInMonth(year, month);
  const portfolioAnalysisRange = useMemo(() => {
    const monthStart = dayjs(new Date(year, month, 1)).format("YYYY-MM-DD");
    const monthEnd = dayjs(new Date(year, month, daysInMonth)).format("YYYY-MM-DD");
    const validFrom = getResolvedDateInput(committedDateFrom);
    const validTo = getResolvedDateInput(committedDateTo);

    if (validFrom || validTo) {
      const first = validFrom || validTo;
      const last = validTo || validFrom;
      const startDate = first <= last ? first : last;
      const endDate = first <= last ? last : first;
      return {
        startDate,
        endDate,
        isCustom: true,
        label: startDate === endDate ? startDate : `${startDate} ~ ${endDate}`
      };
    }

    return {
      startDate: monthStart,
      endDate: monthEnd,
      isCustom: false,
      label: `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month]} ${year}`
    };
  }, [year, month, daysInMonth, committedDateFrom, committedDateTo]);
  const rooms = useMemo(() => BUILDING_DATA[calendarBuilding] || [], [calendarBuilding]);
  const roomCatalogByName = useMemo(() => {
    const map = {};
    (BUILDING_ROOMS[calendarBuilding] || []).forEach((info) => {
      const roomName = String(info?.name || "");
      if (!roomName) return;
      if (!map[roomName]) map[roomName] = [];
      map[roomName].push(info);
    });
    return map;
  }, [calendarBuilding]);
  const currentBuildingLastPriceSync = calendarBuilding && calendarBuilding !== "전체"
    ? (lastPriceSyncByBuilding[calendarBuilding] || null)
    : null;
  const pendingPriceCellMap = useMemo(() => {
    const cellMap = {};
    pendingPriceJobList
      .filter((job) => job.building === selectedBuilding)
      .sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0))
      .forEach((job) => {
        Object.entries(job.pendingCells || {}).forEach(([cellKey, cellData]) => {
          cellMap[cellKey] = cellData;
        });
      });
    return cellMap;
  }, [pendingPriceJobList, selectedBuilding]);

  // 뷰 모드에 따른 표시할 날짜 계산
  const displayDays = useMemo(() => {
    if (viewMode === "rolling") {
      // Rolling view: rollingStartDate부터 30일
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
      // 월별 뷰: 해당 월의 1일부터
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

  // 뷰 전환/로딩 구간 완충: displayDays가 비어있고 loading 중일 때만 이전 값 유지.
  // loading이 끝난 뒤 빈 상태는 실제 빈 상태(잔상 없음)로 그대로 내려감.
  const prevDisplayDaysRef = useRef([]);
  if (displayDays.length > 0) {
    prevDisplayDaysRef.current = displayDays;
  }
  const stableDisplayDays = displayDays.length > 0
    ? displayDays
    : (loading ? prevDisplayDaysRef.current : []);

  // 롤링 뷰용 (다른 곳에서 사용) — stableDisplayDays 기반으로 헤더/본문 소스 일치
  const rollingDays = viewMode === "rolling" ? stableDisplayDays : [];

  const renderCalendarDateHeader = () => (
    <div
      style={{
        display: "flex",
        borderBottom: "1px solid #E5E7EB",
        background: "#F9FAFB",
        position: "relative",
        minHeight: "48px",
        flexShrink: 0,
        minWidth: "max-content"
      }}
    >
      <div style={{
        width: showBeds24DetailView ? `${BEDS24_DETAIL_STICKY_WIDTH}px` : "120px",
        minWidth: showBeds24DetailView ? `${BEDS24_DETAIL_STICKY_WIDTH}px` : "120px",
        padding: "16px 12px",
        fontWeight: "700",
        fontSize: "12px",
        color: "#4B5563",
        textTransform: "uppercase",
        letterSpacing: "0.5px",
        borderRight: "1px solid #E5E7EB",
        background: "#F9FAFB",
        position: "sticky",
        left: 0,
        zIndex: 121
      }}>
        Room
      </div>
      {viewMode === "monthly" ? (
        Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const date = new Date(year, month, day);
          const dayOfWeek = date.getDay();
          const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
          const isToday = new Date().toDateString() === date.toDateString();
          const isHeaderSelected = selectedDateSet.has(dayjs(date).format("YYYY-MM-DD"));
          const isPastHeaderDate = date < new Date(new Date().setHours(0, 0, 0, 0));

          return (
            <div
              key={day}
              style={{
                flex: "1 1 0",
                minWidth: "32px",
                padding: "10px 2px",
                minHeight: "48px",
                boxSizing: "border-box",
                textAlign: "center",
                fontSize: "12px",
                fontWeight: isToday ? "800" : "600",
                color: isPastHeaderDate
                  ? "#94A3B8"
                  : isToday
                    ? "#3B82F6"
                    : isWeekend
                      ? "#E98B8B"
                      : "#4B5563",
                background: isHeaderSelected
                  ? "linear-gradient(180deg, rgba(245,158,11,0.18) 0%, rgba(251,191,36,0.08) 100%)"
                  : isToday
                    ? "#EFF6FF"
                    : isPastHeaderDate
                      ? "rgba(248,250,252,0.96)"
                      : "#F9FAFB",
                borderRight: "1px solid #F3F4F6",
                boxShadow: isHeaderSelected ? "inset 0 -3px 0 #F59E0B" : "none",
                display: "flex",
                flexDirection: "column",
                gap: "2px",
                opacity: isPastHeaderDate ? 0.72 : 1
              }}
            >
              <div style={{ fontSize: "13px" }}>{day}</div>
              <div style={{ fontSize: "9px", opacity: 0.7 }}>
                {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][dayOfWeek]}
              </div>
            </div>
          );
        })
      ) : (
        rollingDays.map((d, i) => {
          const dayOfWeek = d.date.getDay();
          const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
          const isToday = new Date().toDateString() === d.date.toDateString();
          const isNewMonth = i === 0 || d.day === 1;
          const isHeaderSelected = selectedDateSet.has(d.dateStr);
          const isPastHeaderDate = d.date < new Date(new Date().setHours(0, 0, 0, 0));

          return (
            <div
              key={d.dateStr}
              style={{
                flex: "1 1 0",
                minWidth: "32px",
                padding: "10px 2px",
                minHeight: "48px",
                boxSizing: "border-box",
                textAlign: "center",
                fontSize: "12px",
                fontWeight: isToday ? "800" : "600",
                color: isPastHeaderDate
                  ? "#94A3B8"
                  : isToday
                    ? "#3B82F6"
                    : isWeekend
                      ? "#EF4444"
                      : "#4B5563",
                background: isHeaderSelected
                  ? "linear-gradient(180deg, rgba(245,158,11,0.18) 0%, rgba(251,191,36,0.08) 100%)"
                  : isToday
                    ? "#EFF6FF"
                    : isPastHeaderDate
                      ? "rgba(248,250,252,0.96)"
                      : isNewMonth
                        ? "#FFFBEB"
                        : "#F9FAFB",
                borderRight: "1px solid #F3F4F6",
                borderLeft: isNewMonth && i > 0 ? "2px solid #F59E0B" : "none",
                boxShadow: isHeaderSelected ? "inset 0 -3px 0 #F59E0B" : "none",
                display: "flex",
                flexDirection: "column",
                gap: "2px",
                opacity: isPastHeaderDate ? 0.72 : 1
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
  );

  const gapCoverageDays = useMemo(() => {
    if (stableDisplayDays.length === 0) return [];
    const firstDate = dayjs(stableDisplayDays[0].dateStr).subtract(1, 'day');
    const lastDate = dayjs(stableDisplayDays[stableDisplayDays.length - 1].dateStr).add(1, 'day');
    const days = [];
    let cursor = firstDate;
    while (!cursor.isAfter(lastDate, 'day')) {
      days.push({
        dateStr: cursor.format('YYYY-MM-DD'),
        dateKey: cursor.format('YYYYMMDD')
      });
      cursor = cursor.add(1, 'day');
    }
    return days;
  }, [stableDisplayDays]);

  const hasVisiblePriceCoverage = useCallback((buildingName, cacheData) => {
    if (!buildingName || buildingName === "전체" || !cacheData || Object.keys(cacheData).length === 0) {
      return false;
    }

    const dateKeysToCheck = gapCoverageDays.map((d) => d.dateKey);
    if (dateKeysToCheck.length === 0) return false;

    const roomsToCheck = BUILDING_DATA[buildingName] || [];

    return roomsToCheck.every((roomName) => {
      const unitInfos = BUILDING_ROOMS[buildingName]?.filter(r => r.name === roomName) || [];
      if (unitInfos.length === 0) return true;

      return dateKeysToCheck.every((dateKey) =>
        unitInfos.some((info) => {
          const dateEntry = cacheData[String(info.roomId)]?.dates?.[dateKey];
          if (!dateEntry) return false;
          return Object.prototype.hasOwnProperty.call(dateEntry, "na") &&
            Object.prototype.hasOwnProperty.call(dateEntry, "ov");
        })
      );
    });
  }, [gapCoverageDays]);

  // 날짜별 활성 roomId 맵: minStay 50/99이면 비활성 판단, 1~49이면 활성
  const getMinStayForRoomIdDate = useCallback((roomId, dateStr) => {
    if (!calendarBuilding || calendarBuilding === "전체") return null;
    const dateKey = dateStr.replace(/-/g, "");
    const priceInfo = roomPrices?.[String(roomId)]?.dates?.[dateKey];
    if (!priceInfo) return null;
    const ms = parseInt(priceInfo.m, 10);
    return Number.isFinite(ms) ? ms : null;
  }, [calendarBuilding, roomPrices]);

  const getPriceInfoForRoomIdDate = useCallback((roomId, dateStr) => {
    if (!calendarBuilding || calendarBuilding === "전체") return null;
    const dateKey = dateStr.replace(/-/g, "");
    return roomPrices?.[String(roomId)]?.dates?.[dateKey] || null;
  }, [calendarBuilding, roomPrices]);

  const getActiveUnitInfosForDate = useCallback((roomName, dateStr) => {
    const unitInfos = BUILDING_ROOMS[calendarBuilding]?.filter(r => r.name === roomName) || [];
    if (unitInfos.length <= 1) return unitInfos;

    // minStay >= INACTIVE_MINSTAY_THRESHOLD(50/99)이면 비활성 room으로 본다.
    // 값이 없으면 비활성으로 보수 처리해서 잘못된 active room 선택을 막는다.
    const activeInfos = unitInfos.filter((info) => {
      const ms = getMinStayForRoomIdDate(info.roomId, dateStr) ?? INACTIVE_MINSTAY_THRESHOLD;
      return ms >= 1 && ms < INACTIVE_MINSTAY_THRESHOLD;
    });

    // 활성화된 것이 없으면 전체 반환 (비활성화된 roomId로만 구성 가능한 방도 포함)
    return activeInfos;
  }, [calendarBuilding, getMinStayForRoomIdDate]);

  const getDisplayUnitInfosForDate = useCallback((roomName, dateStr) => {
    const dateKey = dateStr.replace(/-/g, "");
    const activeInfos = getActiveUnitInfosForDate(roomName, dateStr);
    if (activeInfos.length > 0) return activeInfos;

    const allInfos = BUILDING_ROOMS[calendarBuilding]?.filter(r => r.name === roomName) || [];
    const withData = allInfos.filter((info) => roomPrices[String(info.roomId)]?.dates?.[dateKey]);
    return withData.length > 0 ? withData : allInfos;
  }, [calendarBuilding, getActiveUnitInfosForDate, roomPrices]);

  const getMinStayFromUnitInfos = useCallback((unitInfos, dateStr) => {
    const dateKey = dateStr.replace(/-/g, "");
    let cellMinStay = 0;

    (unitInfos || []).forEach((info) => {
      const priceInfo = roomPrices[String(info.roomId)]?.dates?.[dateKey];
      if (!priceInfo) return;
      const ms = parseInt(priceInfo.m, 10);
      if (Number.isFinite(ms) && ms >= 1 && ms < INACTIVE_MINSTAY_THRESHOLD && (cellMinStay === 0 || ms < cellMinStay)) {
        cellMinStay = ms;
      }
    });

    return cellMinStay;
  }, [roomPrices]);

  const getCellMinStayForDate = useCallback((roomName, dateStr) => {
    const roomInfos = getDisplayUnitInfosForDate(roomName, dateStr);
    return getMinStayFromUnitInfos(roomInfos, dateStr);
  }, [getDisplayUnitInfosForDate, getMinStayFromUnitInfos]);

  const isBeds24InventoryBlackoutForDate = useCallback((roomName, dateStr) => {
    if (!calendarBuilding || calendarBuilding === "전체") return false;

    const dateKey = dateStr.replace(/-/g, "");
    const allInfos = BUILDING_ROOMS[calendarBuilding]?.filter(r => r.name === roomName) || [];
    if (allInfos.length === 0) return false;

    const activeInfos = getActiveUnitInfosForDate(roomName, dateStr);
    // 활성 unit이 있으면 그것만, 없으면 전체 infos로 fallback (전 unit 비활성 날짜도 blackout 체크)
    const infosToCheck = activeInfos.length > 0 ? activeInfos : allInfos;

    return infosToCheck.some((info) => {
      const priceInfo = roomPrices?.[String(info.roomId)]?.dates?.[dateKey];
      return String(priceInfo?.ov || "").toLowerCase() === "blackout";
    });
  }, [calendarBuilding, getActiveUnitInfosForDate, roomPrices]);

  // 날짜별 예약 여부 캐시 (드래그 선택용)
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
  const handleMonthSelect = (newYear, newMonth) => {
    setCurrentDate(new Date(newYear, newMonth, 1));
    if (selectedBuilding === "전체") {
      setPortfolioDateFrom("");
      setPortfolioDateTo("");
    }
  };

  // 롤링 뷰 이동 (30일 단위)
  const goToRollingNext = () => {
    setRollingStartDate(dayjs(rollingStartDate).add(30, 'day').toDate());
  };
  const goToRollingPrev = () => {
    setRollingStartDate(dayjs(rollingStartDate).subtract(30, 'day').toDate());
  };
  const goToRollingToday = () => {
    // 현재 시작일 조정 (최소 박수 기준 계산)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    setRollingStartDate(yesterday);
  };

  // --- Date jump search helpers ---
  const normalizeDateSearchInput = (value) => {
    const digits = String(value || "").replace(/\D/g, "").slice(0, 8);
    if (digits.length <= 4) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
  };

  const isValidDateSearch = (value) => {
    const s = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  };

  // Apply: switch to rolling view anchored at the given date
  const applyDateSearch = (value) => {
    if (!isValidDateSearch(value)) return;
    const [y, m, d] = value.split("-").map(Number);
    setViewMode("rolling");
    setRollingStartDate(new Date(y, m - 1, d));
  };

  // Today: set input to Tokyo today and jump
  const handleDateSearchToday = () => {
    const tokyoToday = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric", month: "2-digit", day: "2-digit"
    }).format(new Date());
    setDateSearchInput(tokyoToday);
    applyDateSearch(tokyoToday);
  };

  // 뷰 모드 변경
  const toggleViewMode = () => {
    if (viewMode === "monthly") {
      setViewMode("rolling");
      // 롤링 뷰로 변경 시 현재 시작일 조정 (최소 박수 기준 계산)
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      setRollingStartDate(yesterday);
    } else {
      setViewMode("monthly");
    }
  };

  // 가격 모드 토글
  const togglePriceMode = () => {
    const preservedViewport = calendarRef.current
      ? {
          left: calendarRef.current.scrollLeft,
          top: calendarRef.current.scrollTop
        }
      : null;
    const nextPriceMode = !priceMode;
    setPriceMode(nextPriceMode);
    if (nextPriceMode) {
      setGapEditMode(false);
      // 가격 모드 진입 시 열려 있는 예약 상세 모달 닫기 (UI 겹침 방지)
      setSelectedReservation(null);
    }
    setSelectedRoom(null);
    setSelectedCells([]); // 초기화
    setSelectionStart(null); // 드래그 선택 중이었다면 초기화
    setHoveredDay(null);
    setHoveredRoom(null);
    // priceMode ON 진입 시: 캐시 없음 / 빈 데이터 / stale(5분 초과) 이상이면 fetch
    if (nextPriceMode && calendarBuilding && calendarBuilding !== "전체") {
      const cacheAge = currentBuildingLastPriceSync ? (Date.now() - currentBuildingLastPriceSync.getTime()) : Infinity;
      const isStale = cacheAge > 5 * 60 * 1000;
      const hasNoCache = !priceCache[calendarBuilding];
      const hasEmptyPrices = Object.keys(roomPrices).length === 0;
      const hasIncompleteCache = !hasNoCache && !hasVisiblePriceCoverage(calendarBuilding, priceCache[calendarBuilding]);
      if (hasNoCache || hasEmptyPrices) {
        fetchPrices(false, calendarBuilding);
      } else if (isStale || hasIncompleteCache) {
        fetchPrices(true, calendarBuilding);
      }
    }

    restoreCalendarViewport(preservedViewport);
  };

  const toggleMinStayEditMode = () => {
    const nextGapMode = !gapEditMode;
    setGapEditMode(nextGapMode);
    if (nextGapMode) {
      setPriceMode(false);
      // gap edit 모드 진입 시 예약 상세 모달 닫기
      setSelectedReservation(null);
    }
    setSelectedCells([]);
    setSelectedRoom(null);
    setSelectionStart(null);
    setHoveredDay(null);
    setHoveredRoom(null);
  };

  const selectRedGapCells = () => {
    const todayStr = dayjs().format('YYYY-MM-DD');
    const gapCells = [];
    gapCellSet.forEach(key => {
      const [room, date] = key.split('__');
      if (date < todayStr) return;
      const gapInfo = gapInfoByCellKey[`${room}__${date}`] || { resolvedRoomId: null };
      gapCells.push({ room, date, roomId: gapInfo.resolvedRoomId || "" });
    });
    if (gapCells.length === 0) {
      alert("No red gap cells (1 night available with minStay 2) found.");
      return;
    }
    gapCells.sort((a, b) => a.room.localeCompare(b.room) || a.date.localeCompare(b.date));
    setSelectedCells(gapCells);
    setSelectedRoom(gapCells[0]?.room || null);
  };

  const toggleVacantOnlyMode = useCallback(() => {
    setVacantOnlyMode((prev) => !prev);
    setSelectedRoom(null);
    setSelectedCells([]);
    setSelectionStart(null);
    setHoveredDay(null);
    setHoveredRoom(null);
  }, []);

  // 객실 선택 토글
  const toggleRoomSelection = (room) => {
    if (selectedRooms.includes(room)) {
      // 이미 선택된 방이면 제거
      setSelectedCells(prev => prev.filter(c => c.room !== room));
      const remaining = selectedRooms.filter(r => r !== room);
      setSelectedRoom(remaining.length > 0 ? remaining[remaining.length - 1] : null);
    } else {
      // 날짜가 없으면 현재 뷰의 전체 날짜 사용
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

  // Price Mode 대량 선택 시 안내 메시지
  const [bulkSelectMsg, setBulkSelectMsg] = useState('');

  // 전체 객실 선택
  const toggleSelectAllRooms = () => {
    if (allSelectableRoomsSelected) {
      const selectableRoomSet = new Set(selectableRooms);
      setSelectedCells(prev => prev.filter(c => !selectableRoomSet.has(c.room)));
      const remaining = selectedRooms.filter(r => !selectableRoomSet.has(r));
      setSelectedRoom(remaining.length > 0 ? remaining[remaining.length - 1] : null);
      setBulkSelectMsg('');
    } else {
      // 모든 방 × 현재 선택된 날짜들 (예약 있는 셀 제외)
      const newCells = [];
      let skipped = 0;
      selectableRooms.forEach(room => {
        selectedDates.forEach(date => {
          if (selectedCellKeySet.has(getSelectedCellKey(room, date))) return;
          if (isCellOccupied(room, date)) { skipped++; return; }
          newCells.push({ room, date });
        });
      });
      setSelectedCells(prev => [...prev, ...newCells]);
      setSelectedRoom(selectableRooms[0] || null);
      if (newCells.length === 0) {
        setBulkSelectMsg('No vacant cells available for selected scope');
      } else {
        setBulkSelectMsg(skipped > 0 ? `${skipped} occupied cell${skipped > 1 ? 's' : ''} excluded` : '');
      }
    }
  };

  // 요일별 날짜 선택
  const selectDatesByFilter = (filterType) => {
    // filterType: 'all', 'weekday', 'weekend', 'mon', 'tue'...
    const newDates = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // ✅ Bug #3 Fix: 롤링 뷰이면 displayDays 사용, 아니면 월별 반복
    const daysToIterate = viewMode === "rolling" ? displayDays :
      Array.from({ length: daysInMonth }, (_, i) => ({
        date: new Date(year, month, i + 1),
        dateStr: `${year}-${String(month + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`
      }));

    daysToIterate.forEach(d => {
      const date = d.date;
      if (date < today) return; // 과거날짜 제외

      const dateStr = d.dateStr;
      const dayOfWeek = date.getDay(); // 0(일) ~ 6(토)

      let shouldSelect = false;

      if (filterType === 'all') shouldSelect = true;
      else if (filterType === 'weekend') shouldSelect = (dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0);
      else if (filterType === 'weekday') shouldSelect = (dayOfWeek >= 1 && dayOfWeek <= 4);
      else if (typeof filterType === 'number') shouldSelect = (dayOfWeek === filterType);

      if (shouldSelect) newDates.push(dateStr);
    });

    // 선택된 날짜와 방으로 셀 쌍 생성 (예약 있는 셀 제외)
    const roomsToUse = selectedRooms.length > 0 ? selectedRooms : selectableRooms;
    const newCells = [];
    let skipped = 0;
    roomsToUse.forEach(room => {
      newDates.forEach(date => {
        if (isCellOccupied(room, date)) { skipped++; return; }
        newCells.push({ room, date });
      });
    });
    setSelectedCells(newCells);

    if (newCells.length === 0) {
      setBulkSelectMsg('No vacant cells available for selected scope');
    } else {
      setBulkSelectMsg(skipped > 0 ? `${skipped} occupied cell${skipped > 1 ? 's' : ''} excluded` : '');
    }

    // ✅ Bug #1 Fix: 첫 번째 방을 위해 selectedRoom 설정
    if (roomsToUse.length > 0) {
      setSelectedRoom(roomsToUse[0]);
    }
  };

  // 날짜 셀 클릭 핸들러
  const handleDateCellClick = (room, dateStr) => {
    const clickedDate = dayjs(dateStr).toDate();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 과거 날짜 스킵
    if (clickedDate < today) return;

    // 가격 설정 모드 또는 Gap 설정 모드인 경우 (다른 클릭 이벤트)
    if (priceMode || gapEditMode) {
      const roomInfo = BUILDING_ROOMS[selectedBuilding]?.find(r => r.name === room);
      if (!roomInfo) return;

      // 셀 단위 선택 (토글)
      const existingIndex = selectedCells.findIndex(c => c.room === room && c.date === dateStr);

      if (existingIndex >= 0) {
        // 이미 선택된 셀이라면 제거
        setSelectedCells(prev => prev.filter((_, i) => i !== existingIndex));
      } else {
        // ✅ 추가
        setSelectedCells(prev => [...prev, { room, date: dateStr }]);
      }

      setSelectedRoom(room); // 마지막 선택된 방 (편의를 위해)
      return;
    }

    // 일반 모드 (직접 예약 블록 생성)
    if (!selectionStart) {
      // 첫 번째 클릭: 시작점 설정
      setSelectionStart({ room, date: dateStr });
    } else {
      // 두 번째 클릭
      if (selectionStart.room !== room) {
        // 같은 방이 아니면 selection 초기화 후 다시 시작
        setSelectionStart({ room, date: dateStr });
        return;
      }

      // 같은 날짜 두 번째 클릭: 범위 계산 및 모드 확인
      const startDate = dayjs(selectionStart.date);
      const endDate = dayjs(dateStr);

      // checkIn = 더 이른 날짜, checkOut = 더 늦은 날짜 (마지막 선택한 날 = check-out)
      const [checkIn, checkOut] = startDate.isBefore(endDate) ? [startDate, endDate] : [endDate, startDate];

      // 같은 날짜 두 번째 클릭 = 0박이면 선택 취소하고 정리
      if (checkIn.isSame(checkOut, 'day')) {
        setSelectionStart(null);
        setSelectedCells([]);
        setHoveredDay(null);
        setHoveredRoom(null);
        return;
      }

      // 숙박일수: checkIn 이상 checkOut 미만 (check-out 날짜 제외하고 포함)
      const stayDates = [];
      let current = checkIn;
      while (current.isBefore(checkOut)) {
        stayDates.push(current.format('YYYY-MM-DD'));
        current = current.add(1, 'day');
      }

      // 선택 기간 내 기존 예약 겹침 검사 (cancelled 제외)
      const hasConflict = stayDates.some(d =>
        reservations.some(r =>
          r.room === room && r.status !== 'cancelled' &&
          r.arrival <= d && r.departure > d
        )
      );
      if (hasConflict) {
        alert("One or more selected dates already have a reservation.");
        setSelectionStart(null);
        setHoveredDay(null);
        setHoveredRoom(null);
        return;
      }

      setSelectedRoom(room);
      // 선택한 예약의 stayDates를 셀로 변환(첫번째 날짜+1=departure로 계산)
      const rangeCells = stayDates.map(date => ({ room, date }));
      setSelectedCells(rangeCells);
      setShowManualBookingModal(true);
      setSelectionStart(null);
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

  // 가격 데이터 조회 (Firestore 캐시에서 가져옴 - API 직접 호출 안함)
  const fetchPrices = useCallback(async (forceRefresh = false, buildingOverride = null) => {
    const targetBuilding = buildingOverride || selectedBuildingRef.current;
    if (!targetBuilding || targetBuilding === "전체") return; // 전체 보기에서는 가격 조회 안함
    const requestDateFrom = gapCoverageDays[0]?.dateStr || null;
    const requestDateTo = gapCoverageDays[gapCoverageDays.length - 1]?.dateStr || null;

    // 로딩 중이어도 pending으로 표시 (날짜별 취소 방지)
    setPricesError(false);

    // 로컬 캐시 확인 (현재 화면 표시 범위를 커버하면 사용)
    const cachedBuildingData = priceCacheRef.current[targetBuilding];
    const hasVisibleCoverage = !!(cachedBuildingData && hasVisiblePriceCoverage(targetBuilding, cachedBuildingData));
    const canUseLocalCache = !!(cachedBuildingData && hasVisibleCoverage);
    if (!forceRefresh && canUseLocalCache) {
      setRoomPrices(prev => ({ ...prev, ...cachedBuildingData }));
      return;
    }

    if (cachedBuildingData) {
      setRoomPrices(prev => ({ ...prev, ...cachedBuildingData }));
    }

    if (priceFetchControllerRef.current) {
      priceFetchControllerRef.current.abort();
    }
    const controller = new AbortController();
    priceFetchControllerRef.current = controller;
    const requestId = ++priceFetchRequestIdRef.current;

    pricesLoadingRef.current = true;
    setPricesLoading(true);
    const fetchBuilding = targetBuilding;
    try {
      // Firestore 캐시에서 가져옴 (Beds24 API 호출 안함)
      const response = await fetch(`${API_BASE_URL}/getCachedPrices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          building: fetchBuilding,
          dateFrom: requestDateFrom,
          dateTo: requestDateTo
        }),
        signal: controller.signal
      });

      const data = await response.json();
      // stale 응답 가드: 응답이 도착했을 때 이미 더 새 요청이 있으면 무시
      if (requestId !== priceFetchRequestIdRef.current) return;
      if (data.success && data.priceData) {
        // 프론트 캐시에 저장
        updatePriceCache(prev => ({ ...prev, [fetchBuilding]: data.priceData }));
        // 현재 가격 데이터에 업데이트
        setRoomPrices(prev => ({ ...prev, ...data.priceData }));
        // 마지막 동기화 시각 저장
        setLastPriceSyncByBuilding(prev => ({
          ...prev,
          [fetchBuilding]: data.lastSync ? new Date(data.lastSync) : new Date()
        }));
      } else if (data.noCache) {
        // noCache는 에러가 아님 — pricesError 올리지 않음
        console.warn("Price cache unavailable, waiting for sync...");
      } else {
        // 논리 실패: stale 가드(line 위)를 통과한 최신 요청이므로 에러 반영
        console.error("Price fetch failed:", data.error || "Unknown error");
        if (isMountedRef.current) {
          setPricesError(true);
        }
      }
    } catch (err) {
      if (err.name === "AbortError") {
        // 의도적 취소 — pricesError를 건드리지 않음 (finally는 여전히 실행됨)
        return;
      }
      console.error("Price fetch error:", err);
      // stale 요청 또는 unmount 후에는 상태 변경 금지
      if (requestId === priceFetchRequestIdRef.current && isMountedRef.current) {
        setPricesError(true);
      }
    } finally {
      if (requestId === priceFetchRequestIdRef.current && isMountedRef.current) {
        pricesLoadingRef.current = false;
        setPricesLoading(false);
        if (priceFetchControllerRef.current === controller) {
          priceFetchControllerRef.current = null;
        }
      }

      // pending 작업이 있으면 즉시 실행
    }
  }, [companyId, gapCoverageDays, hasVisiblePriceCoverage, updatePriceCache]);

  useEffect(() => {
    fetchPricesRef.current = fetchPrices;
  }, [fetchPrices]);

  // unmount 시 진행 중인 가격 요청 abort + isMounted 플래그 해제
  // setup에서 true 복구 → StrictMode(dev) setup→cleanup→setup 재실행에서도 정상 동작
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      priceFetchControllerRef.current?.abort();
      priceFetchControllerRef.current = null;
    };
  }, []);

  // 일반 모드/가격 모드 모두 날짜별 활성 roomId 결정을 위해 캐시 로드
  useEffect(() => {
    if (calendarBuilding && calendarBuilding !== "전체") {
      fetchPrices(false, calendarBuilding);
    }
  }, [calendarBuilding, fetchPrices]);

  // 선택 초기화 (건물 변경 시)
  useEffect(() => {
    const isAllPropertiesView = !ACTIVE_BUILDING_ORDER.includes(selectedBuilding);
    if (isAllPropertiesView) {
      setPriceMode(false);
      setGapEditMode(false);
    }
    setSelectedRoom(null);
    setSelectedCells([]);
  }, [selectedBuilding]);

  // 블록 데이터 조회 함수
  const fetchBlockData = useCallback(async () => {
    if (!companyId) return;
    setBlockLoading(true);
    try {
      const buildings = ACTIVE_BUILDING_ORDER;
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

      // 날짜별 정렬
      allBlocks.sort((a, b) => (a.arrival || '').localeCompare(b.arrival || ''));
      setBlockData(allBlocks);
    } catch (error) {
      console.error("Error fetching block data:", error);
      alert("Failed to fetch block data: " + error.message);
    } finally {
      setBlockLoading(false);
    }
  }, [companyId]);

  // 블록 데이터 일괄 삭제 함수 (Beds24 API + Firestore 동시 삭제)
  const deleteBlockData = async (blockIds) => {
    if (blockIds.length === 0) return;

    setBlockDeleting(true);
    try {
      // 1. Beds24 API에서 블록 취소 (3건씩 배치 처리 + 배치 간 500ms 대기)
      const BATCH_SIZE = 3;
      const beds24Results = [];
      for (let i = 0; i < blockIds.length; i += BATCH_SIZE) {
        const batch = blockIds.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(async (blockId) => {
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
              return { id: blockId, success: result.success, error: result.error };
            } catch (err) {
              return { id: blockId, success: false, error: err.message };
            }
          })
        );
        beds24Results.push(...batchResults);
        if (i + BATCH_SIZE < blockIds.length) {
          await new Promise(r => setTimeout(r, 500));
        }
      }

      // 2. Beds24 성공한 id만 Firestore에서 삭제
      const successIds = beds24Results.filter(r => r.success).map(r => r.id);
      const beds24Failed = beds24Results.filter(r => !r.success).length;

      if (successIds.length > 0) {
        const batch = writeBatch(db);
        successIds.forEach(id => {
          batch.delete(doc(db, "reservations", id));
        });
        await batch.commit();
      }

      const beds24Success = successIds.length;

      // 삭제된 목록 업데이트 (성공한 id만 제거)
      setBlockData(prev => prev.filter(b => !successIds.includes(b.id)));

      // 예약 목록도 업데이트
      fetchReservations();
      fetchPrices(true);

      if (beds24Failed > 0) {
        alert(`${beds24Success} blocks deleted.\n${beds24Failed} blocks were kept because Beds24 cancellation failed.`);
      } else {
        alert(`${beds24Success} blocks deleted successfully from both Firestore and Beds24.`);
      }
    } catch (error) {
      console.error("Error deleting block data:", error);
      alert("Delete failed: " + error.message);
    } finally {
      setBlockDeleting(false);
    }
  };

  // 예약 데이터 새로고침 함수 (백엔드에서 호출 없이)
  const fetchReservations = useCallback(async () => {
    if (!companyId) {
      console.warn('[BuildingCalendar] No companyId');
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // 뷰 모드에 따른 날짜 범위 계산
      let rangeStart, rangeEnd;
      if (selectedBuilding === "전체") {
        rangeStart = portfolioAnalysisRange.startDate;
        rangeEnd = portfolioAnalysisRange.endDate;
      } else if (viewMode === "rolling") {
        // 롤링 뷰: 시작일부터 30일
        rangeStart = dayjs(rollingStartDate).format('YYYY-MM-DD');
        rangeEnd = dayjs(rollingStartDate).add(30, 'day').format('YYYY-MM-DD');
      } else {
        // 월별 뷰: 해당 월의 1일부터
        rangeStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
        rangeEnd = `${year}-${String(month + 1).padStart(2, '0')}-${daysInMonth}`;
      }

      const statuses = showCancelled ? ["confirmed", "cancelled", "blackout", "maintenance"] : ["confirmed", "blackout", "maintenance"];

      // 경계 날짜를 위해 앞뒤로 1일 여유
      const extendedRangeStart = dayjs(rangeStart).subtract(1, 'day').format('YYYY-MM-DD');
      const extendedRangeEnd = dayjs(rangeEnd).add(1, 'day').format('YYYY-MM-DD');

      // departure >= extendedRangeStart 조건으로 과거 종료된 예약 제외 (Firestore 복합 인덱스 필요)
      // 인덱스 오류 발생시 fallback으로 기본 쿼리 사용
      let allDocs = [];
  const buildingsToQuery = selectedBuilding === '전체' ? ACTIVE_BUILDING_ORDER : [selectedBuilding];

      try {
        const promises = buildingsToQuery.map(b => {
          const q = query(
            collection(db, "reservations"),
            where("companyId", "==", companyId),
            where("building", "==", b),
            where("status", "in", statuses),
            where("departure", ">=", extendedRangeStart)
          );
          return getDocs(q);
        });
        const snapshots = await Promise.all(promises);
        snapshots.forEach(snap => {
          allDocs = [...allDocs, ...snap.docs.map(d => ({ id: d.id, ...d.data() }))];
        });
      } catch (indexErr) {
        // 복합 인덱스 오류 발생시 fallback (departure 조건 없이)
        console.warn("Firestore composite index needed for departure filter, falling back:", indexErr.message);
        allDocs = [];
        const promises = buildingsToQuery.map(b => {
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
          allDocs = [...allDocs, ...snap.docs.map(d => ({ id: d.id, ...d.data() }))];
        });
      }

    if (selectedBuilding === '전체') {
        allDocs = allDocs.filter(r => r.building !== EXCLUDED_BUILDING_UI);
      }

      // arrival <= extendedRangeEnd 조건은 Firestore에서 인덱스 적용 어려움(대신 departure 기반 필터 사용)
      // 프론트에서는 arrival 조건만 추가 적용
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
  }, [companyId, selectedBuilding, year, month, daysInMonth, showCancelled, viewMode, rollingStartDate, portfolioAnalysisRange.startDate, portfolioAnalysisRange.endDate]);

  // 예약 데이터 재조회 트리거
  useEffect(() => {
    fetchReservations();
  }, [fetchReservations]);

  const externalInventoryBlocks = useMemo(() => {
    if (!calendarBuilding || calendarBuilding === '전체' || stableDisplayDays.length === 0 || rooms.length === 0) return [];

    const visibleDateSet = new Set(stableDisplayDays.map((d) => d.dateStr));
    let visMinStr = stableDisplayDays[0].dateStr;
    let visMaxStr = stableDisplayDays[0].dateStr;
    stableDisplayDays.forEach((d) => {
      if (d.dateStr < visMinStr) visMinStr = d.dateStr;
      if (d.dateStr > visMaxStr) visMaxStr = d.dateStr;
    });

    const occupiedByRoomDate = new Set();
    reservations.forEach((r) => {
      if (r.isInventoryOverrideBlock || r.status === 'cancelled' || !r.arrival || !r.departure) return;

      let cur = dayjs(r.arrival);
      const visMinD = dayjs(visMinStr);
      if (cur.isBefore(visMinD, 'day')) cur = visMinD;

      const depExclusive = dayjs(r.departure);
      const visEndExclusive = dayjs(visMaxStr).add(1, 'day');
      const endExclusive = depExclusive.isBefore(visEndExclusive, 'day') ? depExclusive : visEndExclusive;

      while (cur.isBefore(endExclusive, 'day')) {
        const dStr = cur.format('YYYY-MM-DD');
        if (visibleDateSet.has(dStr)) {
          occupiedByRoomDate.add(`${r.room}__${dStr}`);
        }
        cur = cur.add(1, 'day');
      }
    });

    const blocks = [];

    rooms.forEach((room) => {
      let blockStart = null;
      let lastBlockedDate = null;

      stableDisplayDays.forEach((dayInfo, index) => {
        const dateStr = dayInfo.dateStr;
        const hasExistingReservation = occupiedByRoomDate.has(`${room}__${dateStr}`);

        const isInventoryBlocked = !hasExistingReservation && isBeds24InventoryBlackoutForDate(room, dateStr);
        const isLastDay = index === stableDisplayDays.length - 1;

        if (isInventoryBlocked) {
          if (!blockStart) blockStart = dateStr;
          lastBlockedDate = dateStr;
        }

        if ((!isInventoryBlocked || isLastDay) && blockStart && lastBlockedDate) {
          const blockEndDate = isInventoryBlocked && isLastDay ? dateStr : lastBlockedDate;
          blocks.push({
            id: `inventory-blackout:${calendarBuilding}:${room}:${blockStart}:${blockEndDate}`,
            bookId: `inventory-blackout:${calendarBuilding}:${room}:${blockStart}:${blockEndDate}`,
            companyId,
            building: calendarBuilding,
            room,
            guestName: "Beds24 Block",
            arrival: blockStart,
            departure: dayjs(blockEndDate).add(1, 'day').format('YYYY-MM-DD'),
            status: "blackout",
            source: "Beds24 Inventory",
            platform: "Direct",
            price: 0,
            totalPrice: 0,
            isExternalInventoryBlock: true,
            comments: "Beds24 calendar override blackout"
          });
          blockStart = null;
          lastBlockedDate = null;
        }
      });
    });

    return blocks;
  }, [calendarBuilding, companyId, stableDisplayDays, isBeds24InventoryBlackoutForDate, reservations, rooms]);

  const isSameCalendarBlock = useCallback((left, right) => {
    if (!left || !right) return false;
    return (
      left.building === right.building &&
      left.room === right.room &&
      left.arrival === right.arrival &&
      left.departure === right.departure &&
      left.status === "blackout" &&
      right.status === "blackout"
    );
  }, []);

  const visibleReservations = useMemo(() => {
    if (selectedBuilding === '전체') return reservations;
    return reservations.filter(r => !r.isInventoryOverrideBlock);
  }, [reservations, selectedBuilding]);

  const visibleOptimisticInventoryBlocks = useMemo(() => {
    return optimisticInventoryBlocks.filter((block) => {
      const matchedReservation = visibleReservations.some((reservation) => isSameCalendarBlock(reservation, block));
      const matchedExternalBlock = externalInventoryBlocks.some((externalBlock) => isSameCalendarBlock(externalBlock, block));
      return !matchedReservation && !matchedExternalBlock;
    });
  }, [externalInventoryBlocks, isSameCalendarBlock, optimisticInventoryBlocks, visibleReservations]);

  useEffect(() => {
    setOptimisticInventoryBlocks((prev) => {
      const next = prev.filter((block) => {
        const matchedReservation = visibleReservations.some((reservation) => isSameCalendarBlock(reservation, block));
        const matchedExternalBlock = externalInventoryBlocks.some((externalBlock) => isSameCalendarBlock(externalBlock, block));
        return !matchedReservation && !matchedExternalBlock;
      });
      return next.length === prev.length ? prev : next;
    });
  }, [externalInventoryBlocks, isSameCalendarBlock, visibleReservations]);

  const calendarReservations = useMemo(() => {
    const mergedReservations = [...visibleReservations, ...visibleOptimisticInventoryBlocks];
    if (externalInventoryBlocks.length === 0) return mergedReservations;
    return [...mergedReservations, ...externalInventoryBlocks];
  }, [externalInventoryBlocks, visibleOptimisticInventoryBlocks, visibleReservations]);

  const calendarReservationIndex = useMemo(() => {
    const byRoom = {};
    const byRoomUnit = {};
    const visibleByRoom = {};
    const viewStart = stableDisplayDays[0]?.dateStr;
    const viewEnd = stableDisplayDays[stableDisplayDays.length - 1]?.dateStr;
    const viewEndExclusive = viewEnd ? dayjs(viewEnd).add(1, 'day').format('YYYY-MM-DD') : null;

    rooms.forEach((room) => {
      byRoom[room] = [];
      visibleByRoom[room] = [];
      (roomCatalogByName[room] || []).forEach((info) => {
        byRoomUnit[`${room}__${String(info.roomId)}`] = [];
      });
    });

    calendarReservations.forEach((reservation) => {
      if (!reservation || reservation.building !== calendarBuilding) return;
      if (reservation.status === 'cancelled') return;
      if (!reservation.arrival || !reservation.departure) return;

      const roomName = reservation.room;
      if (roomName && byRoom[roomName]) {
        byRoom[roomName].push(reservation);

        if (viewStart && viewEndExclusive) {
          const start = reservation.arrival > viewStart ? reservation.arrival : viewStart;
          const endExclusive = reservation.departure < viewEndExclusive ? reservation.departure : viewEndExclusive;
          if (dayjs(start).isBefore(dayjs(endExclusive))) {
            visibleByRoom[roomName].push(reservation);
          }
        }
      }

      const unitKey = `${roomName}__${String(reservation.roomId || "")}`;
      if (byRoomUnit[unitKey]) {
        byRoomUnit[unitKey].push(reservation);
      }
    });

    return { byRoom, byRoomUnit, visibleByRoom };
  }, [calendarBuilding, calendarReservations, stableDisplayDays, roomCatalogByName, rooms]);

  // 객실별 전체 예약 목록 (gap/인접 날짜 계산을 위해 더 넓은 범위 포함)
  const roomAllReservationsMap = useMemo(() => {
    return calendarReservationIndex.byRoom;
  }, [calendarReservationIndex]);

  // 객실명 + 실제 roomId 기준 전체 예약 목록 (듀얼 객실 1박 gap 판정용)
  const roomAllReservationsByUnitMap = useMemo(() => {
    return calendarReservationIndex.byRoomUnit;
  }, [calendarReservationIndex]);

  // 객실별 예약 목록
  const roomReservationsMap = useMemo(() => {
    return calendarReservationIndex.visibleByRoom;
  }, [calendarReservationIndex]);

  // 해당 room/date에 예약이 있는지 확인 — 대량 선택 필터용 (roomReservationsMap 이후 선언)
  const isCellOccupied = useCallback((room, date) => {
    const reservations = roomReservationsMap[room] || [];
    return reservations.some(r => date >= r.arrival && date < r.departure);
  }, [roomReservationsMap]);

  const activePriceInterventionLogs = useMemo(() => {
    if (!calendarBuilding || calendarBuilding === "전체") {
      return priceInterventionLogs;
    }
    return priceInterventionLogs.filter((log) => log?.building === calendarBuilding);
  }, [calendarBuilding, priceInterventionLogs]);

  const updatePriceCellTooltip = useCallback((nextTooltip) => {
    priceCellTooltipRef.current = nextTooltip;
    if (priceCellTooltipFrameRef.current) return;
    priceCellTooltipFrameRef.current = requestAnimationFrame(() => {
      priceCellTooltipFrameRef.current = null;
      setPriceCellTooltip((prev) => {
        const current = priceCellTooltipRef.current;
        if (!current && !prev) return prev;
        if (!current) return null;
        if (prev && prev.text === current.text && prev.x === current.x && prev.y === current.y) {
          return prev;
        }
        return current;
      });
    });
  }, []);

  const clearPriceCellTooltip = useCallback(() => {
    priceCellTooltipRef.current = null;
    if (priceCellTooltipFrameRef.current) {
      cancelAnimationFrame(priceCellTooltipFrameRef.current);
      priceCellTooltipFrameRef.current = null;
    }
    setPriceCellTooltip(null);
  }, []);

  const priceAttributionByReservationKey = useMemo(() => {
    const { byReservationKey } = buildPriceAttributionResult({
      interventions: activePriceInterventionLogs,
      reservations,
      defaultWindowHours: 48,
      minInterventionDate: "2026-04-11",
      minBookingDate: "2026-04-11"
    });
    return byReservationKey;
  }, [activePriceInterventionLogs, reservations]);

  const roomsVacantTodaySet = useMemo(() => {
    const set = new Set();
    const todayStr = dayjs().format('YYYY-MM-DD');

    rooms.forEach((room) => {
      const isBookedToday = (roomReservationsMap[room] || []).some((reservation) =>
        reservation.status !== "cancelled" &&
        reservation.status !== "blackout" &&
        !reservation.isExternalInventoryBlock &&
        !reservation.isInventoryOverrideBlock &&
        todayStr >= reservation.arrival &&
        todayStr < reservation.departure
      );

      if (!isBookedToday) {
        set.add(room);
      }
    });

    return set;
  }, [roomReservationsMap, rooms]);

  const visibleRooms = useMemo(() => {
    if (!vacantOnlyMode) return rooms;
    return rooms.filter((room) => roomsVacantTodaySet.has(room));
  }, [rooms, roomsVacantTodaySet, vacantOnlyMode]);

  const selectableRooms = vacantOnlyMode ? visibleRooms : rooms;
  const allSelectableRoomsSelected = selectableRooms.length > 0 && selectableRooms.every((room) => selectedRooms.includes(room));

  // Gap detection helper: check-in on this date → only 1 sellable night → minStay 2 → red gap.
  // Row-level vacancy uses roomReservationsMap (same source as cell renderer isFullyOccupied).
  // minStay uses getCellMinStayForDate (same source as cell renderer badge value).
  // Dual rooms: per-roomId reservation counting when unique active roomId is determined.
  const getCheckInGapInfo = useCallback((roomName, dateStr) => {
    const noGap = {
      resolvedRoomId: null,
      isVacant: false,
      availableNightsFromDate: 0,
      cellMinStay: 0,
      isOneNightMinStayGap: false
    };

    // Row-level vacancy: same source as cell renderer (includes all statuses).
    const rowRes = roomReservationsMap[roomName] || [];
    if (rowRes.some(r => dateStr >= r.arrival && dateStr < r.departure)) return noGap;

    // minStay: same calculation as cell renderer badge value (getDisplayUnitInfosForDate based).
    const cellMinStay = getCellMinStayForDate(roomName, dateStr);
    if (cellMinStay !== 2) {
      return { resolvedRoomId: null, isVacant: true, availableNightsFromDate: 0, cellMinStay, isOneNightMinStayGap: false };
    }

    const roomInfos = calendarBuilding && calendarBuilding !== '전체'
      ? (BUILDING_ROOMS[calendarBuilding]?.filter((info) => info.name === roomName) || [])
      : [];

    if (roomInfos.length === 0) {
      return { resolvedRoomId: null, isVacant: true, availableNightsFromDate: 0, cellMinStay, isOneNightMinStayGap: false };
    }

    const genericReservations = (roomAllReservationsMap[roomName] || []).filter((reservation) => !reservation.roomId);
    const genericBlockingReservations = genericReservations.filter((reservation) =>
      reservation.isExternalInventoryBlock ||
      reservation.isInventoryOverrideBlock ||
      reservation.status === "blackout" ||
      reservation.status === "maintenance"
    );
    const genericUnknownReservations = genericReservations.filter((reservation) => !(
      reservation.isExternalInventoryBlock ||
      reservation.isInventoryOverrideBlock ||
      reservation.status === "blackout" ||
      reservation.status === "maintenance"
    ));
    const buildUnitReservations = (targetRoomId) => (
      roomAllReservationsByUnitMap[`${roomName}__${String(targetRoomId)}`] || []
    );
    const overlapsDate = (reservations, targetDateStr) => reservations.some((reservation) =>
      targetDateStr >= reservation.arrival && targetDateStr < reservation.departure
    );
    const todayStr = dayjs().format('YYYY-MM-DD');
    const previousDateStr = dayjs(dateStr).subtract(1, 'day').format('YYYY-MM-DD');
    const nextDateStr = dayjs(dateStr).add(1, 'day').format('YYYY-MM-DD');
    const singleRoomId = roomInfos.length === 1 ? String(roomInfos[0].roomId) : null;

    const getSingleRoomStatus = (targetDateStr, targetRoomId) => {
      const priceInfo = getPriceInfoForRoomIdDate(targetRoomId, targetDateStr);
      const targetMinStay = parseInt(priceInfo?.m, 10);
      if (!Number.isFinite(targetMinStay)) {
        return { status: "unknown", reason: "missing_price" };
      }
      if (String(priceInfo?.ov || "").toLowerCase() === "blackout") {
        return { status: "blocked", reason: "price_blackout" };
      }
      if (!(targetMinStay >= 1 && targetMinStay < INACTIVE_MINSTAY_THRESHOLD)) {
        return { status: "blocked", reason: "inactive_room" };
      }
      if (overlapsDate(roomAllReservationsMap[roomName] || [], targetDateStr)) {
        return { status: "blocked", reason: "reservation_or_block" };
      }
      return { status: "available", reason: "sellable" };
    };

    const getDualRoomStatus = (targetDateStr, targetRoomId) => {
      if (overlapsDate(genericUnknownReservations, targetDateStr)) {
        return { status: "unknown", reason: "generic_reservation_without_roomid" };
      }
      if (overlapsDate(genericBlockingReservations, targetDateStr)) {
        return { status: "blocked", reason: "generic_block_without_roomid" };
      }

      const activeInfos = roomInfos.filter((info) => {
        const targetPriceInfo = getPriceInfoForRoomIdDate(info.roomId, targetDateStr);
        const ms = parseInt(targetPriceInfo?.m, 10);
        return Number.isFinite(ms) &&
          ms >= 1 &&
          ms < INACTIVE_MINSTAY_THRESHOLD &&
          String(targetPriceInfo?.ov || "").toLowerCase() !== "blackout";
      });

      if (activeInfos.length > 1) {
        return { status: "unknown", reason: "multiple_active_roomids" };
      }
      if (activeInfos.length === 0) {
        return { status: "blocked", reason: "no_active_roomid" };
      }
      if (String(activeInfos[0].roomId) !== String(targetRoomId)) {
        return { status: "blocked", reason: "different_roomid_active" };
      }
      if (overlapsDate(buildUnitReservations(targetRoomId), targetDateStr)) {
        return { status: "blocked", reason: "roomid_reservation_or_block" };
      }
      return { status: "available", reason: "sellable" };
    };

    const getDualRoomPhysicalStatus = (targetDateStr) => {
      if (overlapsDate(genericUnknownReservations, targetDateStr)) {
        return { status: "unknown", reason: "generic_reservation_without_roomid" };
      }
      if (overlapsDate(genericBlockingReservations, targetDateStr)) {
        return { status: "blocked", reason: "generic_block_without_roomid" };
      }

      const activeInfos = roomInfos.filter((info) => {
        const targetPriceInfo = getPriceInfoForRoomIdDate(info.roomId, targetDateStr);
        const ms = parseInt(targetPriceInfo?.m, 10);
        return Number.isFinite(ms) &&
          ms >= 1 &&
          ms < INACTIVE_MINSTAY_THRESHOLD &&
          String(targetPriceInfo?.ov || "").toLowerCase() !== "blackout";
      });

      if (activeInfos.length === 0) {
        return { status: "blocked", reason: "no_active_roomid" };
      }
      if (activeInfos.length > 1) {
        return { status: "unknown", reason: "multiple_active_roomids" };
      }
      if (overlapsDate(buildUnitReservations(activeInfos[0].roomId), targetDateStr)) {
        return { status: "blocked", reason: "active_roomid_reserved_or_blocked" };
      }
      return { status: "available", reason: "physical_room_sellable" };
    };

    let resolvedRoomId = null;
    let currentDateStatusInfo = { status: "unknown", reason: "unresolved_roomid" };
    if (roomInfos.length === 1) {
      resolvedRoomId = singleRoomId;
      currentDateStatusInfo = getSingleRoomStatus(dateStr, resolvedRoomId);
    } else {
      const sellableInfos = roomInfos.filter((info) =>
        getDualRoomStatus(dateStr, String(info.roomId)).status === "available"
      );
      if (sellableInfos.length === 1) {
        resolvedRoomId = String(sellableInfos[0].roomId);
        currentDateStatusInfo = { status: "available", reason: "sellable" };
      }
    }

    if (!resolvedRoomId || currentDateStatusInfo.status !== "available") {
      return {
        resolvedRoomId: null,
        isVacant: true,
        availableNightsFromDate: 0,
        cellMinStay,
        isOneNightMinStayGap: false,
        currentDateStatus: currentDateStatusInfo.status,
        currentDateReason: currentDateStatusInfo.reason,
        previousDateStr,
        previousDateStatus: "unknown",
        previousDateReason: "not_checked",
        nextDateStr,
        nextDateStatus: "unknown",
        nextDateReason: "not_checked"
      };
    }

    const previousDateStatusInfo = previousDateStr < todayStr
      ? { status: "past", reason: "before_today" }
      : roomInfos.length === 1
        ? getSingleRoomStatus(previousDateStr, resolvedRoomId)
        : getDualRoomPhysicalStatus(previousDateStr);
    const nextDateStatusInfo = roomInfos.length === 1
      ? getSingleRoomStatus(nextDateStr, resolvedRoomId)
      : getDualRoomStatus(nextDateStr, resolvedRoomId);
    const availableNightsFromDate = nextDateStatusInfo.status === "blocked"
      ? 1
      : nextDateStatusInfo.status === "available"
        ? 2
        : 0;
    const isSegmentEntry = previousDateStatusInfo.status === "blocked" || previousDateStatusInfo.status === "past";
    const isOneNightMinStayGap = availableNightsFromDate === 1 && cellMinStay === 2 && isSegmentEntry;

    return {
      resolvedRoomId,
      isVacant: true,
      availableNightsFromDate,
      cellMinStay,
      isOneNightMinStayGap,
      currentDateStatus: currentDateStatusInfo.status,
      currentDateReason: currentDateStatusInfo.reason,
      previousDateStr,
      previousDateStatus: previousDateStatusInfo.status,
      previousDateReason: previousDateStatusInfo.reason,
      nextDateStr,
      nextDateStatus: nextDateStatusInfo.status,
      nextDateReason: nextDateStatusInfo.reason
    };
  }, [calendarBuilding, roomAllReservationsByUnitMap, roomAllReservationsMap, roomReservationsMap, getCellMinStayForDate, getPriceInfoForRoomIdDate]);

  // 화면 범위 기준 gap info 사전계산 맵 (O(1) 조회용)
  const gapInfoByCellKey = useMemo(() => {
    const map = {};
    rooms.forEach(room => {
      stableDisplayDays.forEach(dayInfo => {
        map[`${room}__${dayInfo.dateStr}`] = getCheckInGapInfo(room, dayInfo.dateStr);
      });
    });
    return map;
  }, [rooms, stableDisplayDays, getCheckInGapInfo]);

  // Gap cell set: only cells where check-in → 1 sellable night AND displayed minStay === 2.
  // Uses getCheckInGapInfo (row-level vacancy + dual-roomId safe).
  // Past dates included; Select Red Gaps button filters past dates on its own.
  const gapCellSet = useMemo(() => {
    const set = new Set();
    rooms.forEach(room => {
      const allRes = roomAllReservationsMap[room] || [];
      if (allRes.length === 0) return;
      stableDisplayDays.forEach(dayInfo => {
        const gi = gapInfoByCellKey[`${room}__${dayInfo.dateStr}`];
        if (gi?.isOneNightMinStayGap) {
          set.add(`${room}__${dayInfo.dateStr}`);
        }
      });
    });
    return set;
  }, [rooms, roomAllReservationsMap, stableDisplayDays, gapInfoByCellKey, selectedBuilding]);

  // [Single View] 건물 통계 데이터 계산
  const analysis = useMemo(() => {
    const roomObjects = rooms.map(r => ({ name: r }));
    return calculateBuildingMetrics(calendarReservations, roomObjects, daysInMonth, year, month);
  }, [calendarReservations, rooms, daysInMonth, year, month]);

  // [전체 뷰] 건물별 타입별 분석 데이터 (아래 렌더에서 직접 계산 방식)
  const allBuildingMetrics = useMemo(() => {
    if (selectedBuilding !== '전체') return null;
    const result = {};
    ACTIVE_BUILDING_ORDER.forEach(bName => {
      const bReservations = calendarReservations.filter(r => r.building === bName);
      const bRooms = BUILDING_ROOMS[bName] || [];
      result[bName] = {
        metrics: calculateBuildingMetricsForRange(bReservations, bRooms, portfolioAnalysisRange.startDate, portfolioAnalysisRange.endDate),
        roomMetrics: {}
      };
      const uniqueRoomNames = [...new Set(bRooms.map(r => r.name))];
      uniqueRoomNames.forEach(roomName => {
        const rReservations = bReservations.filter(r => r.room === roomName);
        const roomInfosForName = bRooms.filter(r => r.name === roomName);
        result[bName].roomMetrics[roomName] = calculateBuildingMetricsForRange(rReservations, roomInfosForName, portfolioAnalysisRange.startDate, portfolioAnalysisRange.endDate);
      });
    });
    return result;
  }, [calendarReservations, selectedBuilding, portfolioAnalysisRange.startDate, portfolioAnalysisRange.endDate]);

  // ✅ min/maxPrice 계산은 별도로 처리 (API 데이터 기반)
  const priceStats = useMemo(() => {
    let minPrice = Infinity;
    let maxPrice = 0;
    if (calendarBuilding && calendarBuilding !== '전체') {
      // stableDisplayDays 기준으로 현재 화면에 보이는 날짜만 추려냄
      for (const { dateStr } of stableDisplayDays) {
        const dateKey = dateStr.replace(/-/g, '');

        for (const roomName of rooms) {
          const isReserved = (roomReservationsMap[roomName] || []).some(r =>
            r.arrival <= dateStr &&
            r.departure > dateStr
          );
          if (isReserved) continue; // 해당 room/date는 건너뜀
          const activeInfos = getActiveUnitInfosForDate(roomName, dateStr);
          const roomInfo = activeInfos[0];
          if (!roomInfo) continue; // 해당 room/date는 건너뜀
          const priceData = roomPrices[roomInfo.roomId]?.dates?.[dateKey];
          if (priceData) {
            const airbnb = parseInt(priceData.p3) || parseInt(priceData.p1);
            if (!isNaN(airbnb) && airbnb > 0) {
              if (airbnb < minPrice) minPrice = airbnb;
              if (airbnb > maxPrice) maxPrice = airbnb;
            }
          }
        }
      }
    }
    return { minPrice: minPrice === Infinity ? 0 : minPrice, maxPrice };
  }, [calendarBuilding, roomReservationsMap, rooms, stableDisplayDays, roomPrices, getActiveUnitInfosForDate]);

  // analysis 객실에 min/max 업데이트 (Single View 전용 편의)
  const singleAnalysis = { ...analysis, ...priceStats };
  const weekdayWeekendRateSummary = useMemo(() => {
    if (!calendarBuilding || calendarBuilding === "전체" || stableDisplayDays.length === 0) {
      return {
        weekdayAvg: 0,
        weekendAvg: 0,
        weekdayCells: 0,
        weekendCells: 0
      };
    }

    let weekdayPriceSum = 0;
    let weekendPriceSum = 0;
    let weekdayCells = 0;
    let weekendCells = 0;

    stableDisplayDays.forEach(({ date, dateStr }) => {
      const dateKey = dateStr.replace(/-/g, "");
      const isWeekend = [0, 5, 6].includes(date.getDay()); // 금/토/일

      rooms.forEach((roomName) => {
        const activeInfos = getActiveUnitInfosForDate(roomName, dateStr);
        const roomInfo = activeInfos[0];
        if (!roomInfo) return;

        const priceData = roomPrices?.[roomInfo.roomId]?.dates?.[dateKey];
        if (!priceData) return;

        const airbnbPrice = parseInt(priceData.p3, 10) || parseInt(priceData.p1, 10) || 0;
        if (!Number.isFinite(airbnbPrice) || airbnbPrice <= 0) return;

        if (isWeekend) {
          weekendCells += 1;
          weekendPriceSum += airbnbPrice;
        } else {
          weekdayCells += 1;
          weekdayPriceSum += airbnbPrice;
        }
      });
    });

    return {
      weekdayAvg: weekdayCells > 0 ? (weekdayPriceSum / weekdayCells) : 0,
      weekendAvg: weekendCells > 0 ? (weekendPriceSum / weekendCells) : 0,
      weekdayCells,
      weekendCells
    };
  }, [calendarBuilding, stableDisplayDays, rooms, getActiveUnitInfosForDate, roomPrices]);
  const displayedAvgPrice = useMemo(() => {
    const totalCells = weekdayWeekendRateSummary.weekdayCells + weekdayWeekendRateSummary.weekendCells;
    if (totalCells <= 0) return 0;
    const totalPrice =
      (weekdayWeekendRateSummary.weekdayAvg * weekdayWeekendRateSummary.weekdayCells) +
      (weekdayWeekendRateSummary.weekendAvg * weekdayWeekendRateSummary.weekendCells);
    return totalPrice / totalCells;
  }, [weekdayWeekendRateSummary]);
  const displayedVsBookedGap = displayedAvgPrice - (singleAnalysis?.avgPrice || 0);
  const priceInsightSummary = useMemo(() => {
    const BUCKET_UNIT = 1000;
    const MIN_EXPOSURE = 4;
    const todayStr = dayjs().format("YYYY-MM-DD");
    const byBuilding = {};

    const getBucketLabel = (price) => {
      const start = Math.floor(price / BUCKET_UNIT) * BUCKET_UNIT;
      const end = start + BUCKET_UNIT - 1;
      return `¥${start.toLocaleString()} ~ ¥${end.toLocaleString()}`;
    };

    const reservationIndex = {};
    (reservations || []).forEach((reservation) => {
      if (!reservation || String(reservation.status || "").toLowerCase() !== "confirmed") return;
      const b = String(reservation.building || "");
      const r = String(reservation.room || "");
      if (!b || !r) return;
      const key = `${b}__${r}`;
      if (!reservationIndex[key]) reservationIndex[key] = [];
      reservationIndex[key].push(reservation);
    });

    ACTIVE_BUILDING_ORDER.forEach((buildingName) => {
      const roomsForBuilding = BUILDING_DATA[buildingName] || [];
      const roomCatalog = BUILDING_ROOMS[buildingName] || [];
      const metricsByType = { weekday: {}, weekend: {} };
      let sampleCells = 0;

      stableDisplayDays.forEach(({ date, dateStr }) => {
        if (dateStr < todayStr) return;
        const dateKey = dateStr.replace(/-/g, "");
        const typeKey = [0, 5, 6].includes(date.getDay()) ? "weekend" : "weekday";

        roomsForBuilding.forEach((roomName) => {
          const candidates = roomCatalog.filter((info) => info.name === roomName);
          if (candidates.length === 0) return;

          const chosenInfo = candidates.find((info) => roomPrices?.[String(info.roomId)]?.dates?.[dateKey]) || candidates[0];
          const priceData = roomPrices?.[String(chosenInfo.roomId)]?.dates?.[dateKey];
          if (!priceData) return;

          const listedPrice = parseInt(priceData.p3, 10) || parseInt(priceData.p1, 10) || 0;
          if (!Number.isFinite(listedPrice) || listedPrice <= 0) return;

          const bucketLabel = getBucketLabel(listedPrice);
          if (!metricsByType[typeKey][bucketLabel]) {
            metricsByType[typeKey][bucketLabel] = { exposure: 0, booked: 0 };
          }

          const isBooked = (reservationIndex[`${buildingName}__${roomName}`] || []).some((reservation) =>
            dateStr >= reservation.arrival && dateStr < reservation.departure
          );

          metricsByType[typeKey][bucketLabel].exposure += 1;
          metricsByType[typeKey][bucketLabel].booked += isBooked ? 1 : 0;
          sampleCells += 1;
        });
      });

      const resolveBest = (typeKey) => {
        const entries = Object.entries(metricsByType[typeKey])
          .map(([bucketLabel, stat]) => ({
            bucketLabel,
            exposure: stat.exposure,
            booked: stat.booked,
            sellThrough: stat.exposure > 0 ? stat.booked / stat.exposure : 0
          }))
          .filter((entry) => entry.exposure >= MIN_EXPOSURE)
          .sort((a, b) => {
            if (b.sellThrough !== a.sellThrough) return b.sellThrough - a.sellThrough;
            return b.exposure - a.exposure;
          });
        return entries[0] || null;
      };

      byBuilding[buildingName] = {
        weekdayBest: resolveBest("weekday"),
        weekendBest: resolveBest("weekend"),
        sampleCells
      };
    });

    return { byBuilding };
  }, [stableDisplayDays, reservations, roomPrices]);
  const commissionSummary = useMemo(() => {
    if (!calendarBuilding || calendarBuilding === "전체") return { airbnb: 0, booking: 0, total: 0 };
    const buildingReservations = calendarReservations.filter((reservation) => reservation.building === calendarBuilding);
    return calculateCommissionSummary(buildingReservations, stableDisplayDays);
  }, [calendarBuilding, calendarReservations, stableDisplayDays]);
  const arrivalCountSummary = useMemo(() => {
    if (!calendarBuilding || calendarBuilding === "전체") return { airbnb: 0, booking: 0, direct: 0, total: 0 };
    const buildingReservations = calendarReservations.filter((reservation) => reservation.building === calendarBuilding);
    return calculateArrivalCountSummary(buildingReservations, stableDisplayDays);
  }, [calendarBuilding, calendarReservations, stableDisplayDays]);
  const futureVacancySummary = useMemo(() => {
    if (!calendarBuilding || calendarBuilding === "전체") return { vacantRoomNights: 0, totalRoomNights: 0, days: 0, avgVacantRooms: 0 };

    const todayStr = dayjs().format("YYYY-MM-DD");
    const futureDays = stableDisplayDays.filter((dayInfo) => dayInfo.dateStr >= todayStr);
    let vacantRoomNights = 0;

    futureDays.forEach(({ dateStr }) => {
      rooms.forEach((room) => {
        const isUnavailable = (roomReservationsMap[room] || []).some((reservation) =>
          reservation.status !== "cancelled" &&
          reservation.status !== "inquiry" &&
          dateStr >= reservation.arrival &&
          dateStr < reservation.departure
        );

        if (!isUnavailable) {
          vacantRoomNights += 1;
        }
      });
    });

    const totalRoomNights = futureDays.length * rooms.length;

    return {
      vacantRoomNights,
      totalRoomNights,
      days: futureDays.length,
      avgVacantRooms: futureDays.length > 0 ? vacantRoomNights / futureDays.length : 0
    };
  }, [calendarBuilding, stableDisplayDays, roomReservationsMap, rooms]);



  // 예약 바 렌더
  const renderReservationBar = (reservation) => {

    const arrivalDate = new Date(reservation.arrival);
    const departureDate = new Date(reservation.departure);

    let startDay, endDay, totalDays;

    if (viewMode === "rolling") {
      // 30일 뷰: rollingStartDate 기준으로 계산 (실제로는 30일)
      const rangeStart = dayjs(rollingStartDate).startOf('day');
      const rangeEnd = rangeStart.add(30, 'day');

      const arrival = dayjs(reservation.arrival).startOf('day');
      const departure = dayjs(reservation.departure).startOf('day');

      // 범위 완전 밖 조기 탈출 (월별 뷰 guard와 동일 패턴):
      // departure <= rangeStart → 예약이 창 이전에 이미 끝남 (exclusive 규칙)
      // arrival >= rangeEnd → 예약이 창 이후에 시작
      if (!departure.isAfter(rangeStart) || !arrival.isBefore(rangeEnd)) {
        return null;
      }

      // 시작/종료를 현재 rolling 범위에 맞춰 잘라낸다.
      const effectiveStart = arrival.isBefore(rangeStart) ? rangeStart : arrival;
      const effectiveEnd = departure.isAfter(rangeEnd) ? rangeEnd : departure;

      startDay = effectiveStart.diff(rangeStart, 'day');
      // endDay는 totalDays(30)를 초과하지 않도록 clamp (overflow 방지)
      endDay = Math.min(effectiveEnd.diff(rangeStart, 'day'), 30);
      totalDays = 30;
    } else {
      // 월별 뷰: dayjs 사용 (시각화 문제 해결)
      const arrival = dayjs(reservation.arrival).startOf('day');
      const departure = dayjs(reservation.departure).startOf('day');
      const monthStart = dayjs(`${year}-${String(month + 1).padStart(2, '0')}-01`).startOf('day');
      const monthEnd = dayjs(`${year}-${String(month + 1).padStart(2, '0')}-${daysInMonth}`).add(1, 'day').startOf('day');

      // ✅ 범위 결정: 예약이 현재 월에 실제로 걸치는지 확인
      // departure가 현재 월 시작보다 이전이거나 같으면 이미 완료된 예약 (표시 안함)
      // arrival이 현재 월 종료보다 이후이거나 같으면 아직 시작 안된 예약 (표시 안함)
      if (!departure.isAfter(monthStart) || !arrival.isBefore(monthEnd)) {
        return null;
      }

      startDay = arrival.isBefore(monthStart) ? 0 : arrival.date() - 1;
      // checkout 이 월 범위 밖이면 월말까지 표시
      endDay = (departure.isAfter(monthEnd) || departure.isSame(monthEnd)) ? daysInMonth : departure.date() - 1;
      totalDays = daysInMonth;
    }

    // ✅ 렌더링 전략: 비활성화된 데이터 또는 범위 밖 예약 처리
    // 1. 잘못된 예약 데이터 (arrival >= departure)
    if (arrivalDate >= departureDate) {
      console.warn(`[INVALID DATA] ${reservation.guestName} (arrival: ${reservation.arrival} >= departure: ${reservation.departure}) - bookId: ${reservation.bookId}`);
      return null;
    }
    // 2. 범위 완전 밖: rolling/월 경계를 벗어난 예약 (endDay<=0 이거나 startDay>=totalDays)
    if (startDay >= totalDays || endDay <= 0) {
      return null;
    }

    // ✅ 위치와 너비 계산 — 1박 예약은 최소 1셀 보장 (경계 클리핑 후에도 0이 되지 않음)
    const nights = Math.max(1, endDay - startDay);
    const leftPercent = (startDay / totalDays) * 100;
    const widthPercent = (nights / totalDays) * 100;

    const isCancelled = reservation.status === "cancelled";
    const isBlackout = reservation.status === "blackout";
    const isExternalInventoryBlock = !!reservation.isExternalInventoryBlock;
    const isInventoryOverrideBlock = !!reservation.isInventoryOverrideBlock;
    const isInventoryLikeBlock = isExternalInventoryBlock || isInventoryOverrideBlock;

    let platformColor = getPlatformColor(reservation.platform);
    if (isCancelled) platformColor = "#8E8E93";
    if (isBlackout) platformColor = "#1D1D1F"; // Blackout은 검정색
    // pastel 배경에서 대비 확보: Airbnb/Booking은 진한 네이비-슬레이트 텍스트 사용
    const barTextColor = platformColor === PLATFORM_COLORS.Airbnb ? "#5C2022"
      : platformColor === PLATFORM_COLORS.Booking ? "#134648"
      : "white";
    const guestName = reservation.guestName || "Reservation";
    let displayText = isInventoryLikeBlock
      ? "[Beds24 Block]"
      : `${isCancelled ? "[Cancelled] " : ""}${isBlackout ? "[Block] " : ""}${guestName}`;

    // ✅ 예약 감지: 같은 room에서 날짜가 겹치는 non-cancelled 예약 목록
    const overlapGroup = (roomReservationsMap[reservation.room] || []).filter(r =>
      r.status !== 'cancelled' &&
      r.arrival < reservation.departure &&
      r.departure > reservation.arrival
    );
    overlapGroup.sort((a, b) =>
      a.arrival < b.arrival ? -1 : a.arrival > b.arrival ? 1 :
      (a.bookId || a.id || '') < (b.bookId || b.id || '') ? -1 : 1
    );
    const totalCount = overlapGroup.length;
    const overlapIndex = overlapGroup.findIndex(r =>
      (r.bookId || r.id) === (reservation.bookId || reservation.id)
    );
    const barIndex = overlapIndex >= 0 ? overlapIndex : 0;
    const reservationTrackHeight = showBeds24DetailView
      ? BEDS24_DETAIL_RESERVATION_TRACK_HEIGHT
      : 40;
    const barSlotHeight = reservationTrackHeight / Math.max(totalCount, 1);
    const barHeight = totalCount > 1
      ? Math.max(7, Math.floor(barSlotHeight) - 4)
      : Math.max(10, reservationTrackHeight - 6);
    // 슬롯 중앙 정렬: beds24 detail은 픽셀 오프셋, 일반 뷰는 슬롯 중심 %
    const barTop = showBeds24DetailView
      ? `${BEDS24_DETAIL_RESERVATION_TRACK_TOP + Math.floor((barSlotHeight - barHeight) / 2) + (barIndex * barSlotHeight)}px`
      : totalCount > 1
        ? `${((barIndex + 0.5) / totalCount) * 100}%`
        : "50%";
    const barTransform = showBeds24DetailView
      ? "none"
      : "translateY(-50%)";

    const isManualCheckoutTargetActive = !!selectionStart && !priceMode && !gapEditMode && selectionStart.room === reservation.room;
    const allowPriceEditThroughBlock = !!priceMode && (isBlackout || isInventoryLikeBlock);
    const isEditMode = priceMode || gapEditMode; // 가격/gap 편집 모드 — 예약 상세 모달 차단
    const isPastReservation = dayjs(reservation.departure).startOf('day').valueOf() <= dayjs().startOf('day').valueOf();
    const reservationIdentityKey = getReservationIdentityKey(reservation);
    const attributedConversion = priceAttributionByReservationKey[reservationIdentityKey] || null;
    const isPriceDrivenSuccess = !isCancelled && !isBlackout && !!attributedConversion;

    return (
      <div
        key={reservation.bookId || `${reservation.arrival}-${reservation.room}-${reservation.status}`}
        data-no-drag="true"
        onClick={() => {
          // 편집 모드(가격/gap)에서는 어떤 예약 바 클릭도 상세 모달을 열지 않음
          if (isEditMode) return;
          if (!isInventoryLikeBlock && !allowPriceEditThroughBlock) setSelectedReservation(reservation);
        }}
        style={{
          position: "absolute",
          left: `${leftPercent}%`,
          width: `${widthPercent}%`,
          top: barTop,
          transform: barTransform,
          height: `${barHeight}px`,
          backgroundColor: platformColor,
          border: isCancelled
            ? "1.5px dashed rgba(255,255,255,0.5)"
            : (isPriceDrivenSuccess ? "2px solid #1E3A8A" : "none"),
          opacity: isCancelled ? 0.56 : (allowPriceEditThroughBlock ? 0.3 : (isPastReservation ? 0.44 : (showBeds24DetailView ? 0.94 : 1))),
          borderRadius: "999px",
          color: barTextColor,
          fontSize: showBeds24DetailView ? "9px" : "11px",
          fontWeight: showBeds24DetailView ? "600" : "700",
          padding: showBeds24DetailView ? "1px 8px" : "3px 12px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          cursor: (isEditMode || isManualCheckoutTargetActive || isInventoryLikeBlock || allowPriceEditThroughBlock) ? "default" : "pointer",
          boxShadow: isCancelled
            ? "none"
            : (isPriceDrivenSuccess
              ? "0 0 0 1px #1E3A8A, 0 4px 12px rgba(30, 58, 138, 0.28)"
              : (showBeds24DetailView
                ? "0 1px 4px rgba(15, 23, 42, 0.14)"
                : "0 1px 3px rgba(15,23,42,0.10)")),
          transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
          zIndex: isCancelled ? 5 : (isBlackout ? 6 : 10),
          backgroundImage: isBlackout
            ? "repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(255,255,255,0.05) 10px, rgba(255,255,255,0.05) 20px)"
            : (showBeds24DetailView
              ? "linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(0,0,0,0.02) 100%)"
              : "linear-gradient(180deg, rgba(255,255,255,0.1) 0%, rgba(0,0,0,0.05) 100%)"),
          display: "flex",
          alignItems: "center",
          gap: showBeds24DetailView ? "4px" : "6px",
          pointerEvents: (isManualCheckoutTargetActive || allowPriceEditThroughBlock) ? "none" : "auto"
        }}
        onMouseEnter={(e) => {
          if (isEditMode || isManualCheckoutTargetActive || isInventoryLikeBlock || allowPriceEditThroughBlock) return;
          const hoverTransform = showBeds24DetailView
            ? "translateY(-1px) scale(1.01)"
            : "translateY(-50%) scale(1.005)";
          e.currentTarget.style.transform = hoverTransform;
          e.currentTarget.style.boxShadow = showBeds24DetailView
            ? "0 2px 8px rgba(15, 23, 42, 0.18)"
            : "0 2px 6px rgba(15,23,42,0.14)";
          e.currentTarget.style.zIndex = 25;
        }}
        onMouseLeave={(e) => {
          if (isEditMode || isManualCheckoutTargetActive || isInventoryLikeBlock || allowPriceEditThroughBlock) return;
          e.currentTarget.style.transform = barTransform;
          e.currentTarget.style.boxShadow = isCancelled
            ? "none"
            : (isPriceDrivenSuccess
              ? "0 0 0 1px #1E3A8A, 0 4px 12px rgba(30, 58, 138, 0.28)"
              : (showBeds24DetailView
                ? "0 1px 4px rgba(15, 23, 42, 0.14)"
                : "0 1px 3px rgba(15,23,42,0.10)"));
          e.currentTarget.style.zIndex = isCancelled ? 5 : (isBlackout ? 6 : 10);
        }}
        title={`${isPriceDrivenSuccess ? `[PRICE SUCCESS] Booked ${attributedConversion?.hoursToBooking ?? "-"}h after a manual price update.\n` : ""}${
          isInventoryLikeBlock
            ? `Beds24 Block\n${reservation.arrival} ~ ${reservation.departure}\nInventory blackout`
            : `${reservation.guestName}\n${reservation.arrival} ~ ${reservation.departure}\n${formatPrice(reservation.totalPrice)}`
        }`}
      >
        {isPriceDrivenSuccess ? (
          <span style={{ fontSize: "11px", filter: "drop-shadow(0 0 2px rgba(255,255,255,0.5))" }}>💰</span>
        ) : (
          <span style={{
            display: "inline-block",
            width: showBeds24DetailView ? "5px" : "6px",
            height: showBeds24DetailView ? "5px" : "6px",
            borderRadius: "50%",
            backgroundColor: "white",
            boxShadow: showBeds24DetailView ? "none" : "0 0 4px rgba(255,255,255,0.8)"
          }}></span>
        )}
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

      {/* 가격 설정 job toast - processing / 성공 / 실패 */}
      {priceJobToast && (() => {
        const isQueued = priceJobToast?.status === 'queued';
        const bgColor = isQueued ? '#4F46E5'
          : priceJobToast?.status === 'success' ? '#10B981'
          : priceJobToast?.status === 'partial' ? '#F59E0B'
          : '#EF4444';
        const message = priceJobToast?.message || '';
        return (
          <div style={{
            position: 'fixed', bottom: '28px', left: '50%', transform: 'translateX(-50%)',
            background: bgColor, color: 'white',
            padding: '13px 22px', borderRadius: '12px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.22)',
            fontSize: '14px', fontWeight: '600', zIndex: 99999,
            display: 'flex', alignItems: 'center', gap: '10px',
            whiteSpace: 'nowrap', maxWidth: '90vw', overflow: 'hidden', textOverflow: 'ellipsis'
          }}>
            {isQueued && (
              <span style={{
                display: 'inline-block', width: '15px', height: '15px',
                border: '2px solid rgba(255,255,255,0.4)', borderTopColor: 'white',
                borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0
              }} />
            )}
            {message}
          </div>
        );
      })()}

      {priceCellTooltip?.text && (
        <div
          style={{
            position: 'fixed',
            left: `${priceCellTooltip.x}px`,
            top: `${priceCellTooltip.y}px`,
            zIndex: 999999,
            pointerEvents: 'none',
            background: '#FFFFFF',
            border: '1px solid #A3A3A3',
            boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
            padding: '6px 8px',
            maxWidth: '320px',
            fontSize: '12px',
            lineHeight: 1.3,
            color: '#1F2937',
            whiteSpace: 'pre-wrap'
          }}
        >
          {priceCellTooltip.text}
        </div>
      )}

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
            onOptimisticBlockStart={(blocks) => {
              setOptimisticInventoryBlocks((prev) => [...prev, ...blocks]);
            }}
            onOptimisticBlockRollback={(blockIds) => {
              const rollbackSet = new Set(blockIds || []);
              setOptimisticInventoryBlocks((prev) => prev.filter((block) => !rollbackSet.has(block.id)));
            }}
            companyId={companyId}
          />
        )}

        {/* 모바일 캘린더 뷰 (주별 7일 슬라이드) */}
        {isMobile && (() => {
          const ROOM_W = 48;
          const AVAIL_W = window.innerWidth - 28; // NewLayout 모바일 여백 14px 각 2
          const CELL_W = Math.floor((AVAIL_W - ROOM_W) / 7);
          const weekDays = Array.from({ length: 7 }, (_, i) => mobileWeekStart.add(i, 'day'));
          const todayStr = dayjs().format('YYYY-MM-DD');
  const mobileRooms = selectedBuilding !== '전체' ? (BUILDING_DATA[selectedBuilding] || []) : [];
          const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

          // 모바일 전용 muted color palette
          const MC = {
            primary:    '#6E9DC8',   // 평일용 블루 계열
            primaryBg:  '#EEF5FB',
            sat:        '#7A94C0',   // 토요일용 컬러
            sun:        '#C07878',   // 일요일용 색상
            border:     '#EAECF2',
            borderMid:  '#DDE3EE',
            bg:         '#F5F6FA',
            rowLabel:   '#F8FAFC',
          };
          // 모바일 전용 플랫폼별 색상
          const getMobileColor = (referer) => {
            if (!referer) return '#9AAEC0';
            const p = referer.toLowerCase();
            if (p.includes('airbnb'))  return '#E8788E';  // 에어비앤비 핑크
            if (p.includes('booking')) return '#6E9DC8';  // 부킹 블루
            if (p.includes('expedia')) return '#C8983C';  // 익스피디아 골드
            if (p.includes('agoda'))   return '#D07868';  // 아고다 오렌지
            if (p.includes('direct'))  return '#5AAFC0';
            return '#9AAEC0';
          };

          // ✅ 가격 조회 건너뜀
          const getCellPrice = (roomName, dStr) => {
    if (selectedBuilding === '전체') return 0;
            const dateKey = dStr.replace(/-/g, '');
            const activeInfos = getActiveUnitInfosForDate(roomName, dStr);
            const firstRoomInfo = activeInfos[0];
            if (!firstRoomInfo) return 0;
            const priceData = roomPrices?.[firstRoomInfo.roomId]?.dates?.[dateKey];
            return priceData ? (parseFloat(priceData.p1) || 0) : 0;
          };

          // 하루짜리 예약 처리 (아래 로직 배치)
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

              {/* ✅ 건물 탭 (수평 스크롤) */}
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
                      {getBuildingNameEN(b)}{sold ? ' (Sold)' : ''}
                    </button>
                  );
                })}
              </div>

              {/* ✅ 메인 캘린더 카드 */}
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
                        {mobileWeekStart.format('MMM D')} - {mobileWeekStart.add(6, 'day').format('MMM D, YYYY')}
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

                {/* ✅ 캘린더 슬라이드 — 첫 로드(stableDisplayDays 없음)일 때만 스피너, 전환 시엔 기존 화면 유지 */}
                {loading && stableDisplayDays.length === 0 ? (
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
                              const allRes = reservations.filter(r =>
                                r.room === room &&
                                r.status !== 'cancelled' &&
                                r.arrival <= dStr && r.departure > dStr
                              );
                              const res = allRes[0];
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
                                          }}>{res.guestName ? res.guestName.split(' ')[0] : '--'}</span>
                                        </>
                                      )}
                                    </>
                                  ) : (
                                    priceStr ? (
                                      <span style={{
                                        fontSize: '8px', fontWeight: '500',
                                        color: isToday ? MC.primary : '#B8BECE',
                                        letterSpacing: '-0.2px',
                                      }}>{priceStr}</span>
                                    ) : null
                                  )}
                                  {allRes.length > 1 && (
                                    <div style={{
                                      position: 'absolute', top: '2px', right: '2px',
                                      width: '14px', height: '14px',
                                      borderRadius: '50%',
                                      background: '#C07070',
                                      color: '#fff',
                                      fontSize: '8px', fontWeight: '700',
                                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                                      zIndex: 2, pointerEvents: 'none',
                                    }}>{allRes.length}</div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )) : (
                          <div style={{ padding: '48px 16px', textAlign: 'center' }}>
                            <div style={{ color: '#C8CAD8', fontSize: '13px' }}>
                              Please select a property
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* 오늘로 이동 버튼 */}
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

        {/* 데스크탑 전용 뷰 */}
        {!isMobile && (<>

        {/* 월 선택 모달 */}
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
            building={calendarBuilding}
            room={selectedRoom}
            selectedDates={selectedDates}
            roomPrices={roomPrices}
            onClose={() => setShowPriceModal(false)}
            onSave={() => {
              setSelectedCells([]);
              setSelectedRoom(null);
              updatePriceCache(prev => {
                const newCache = { ...prev };
                delete newCache[calendarBuilding];
                return newCache;
              });
              fetchPrices(true, calendarBuilding);
            }}
            onJobQueued={({ jobId, roomCount, pendingCells = [] }) => {
              setSelectedCells([]);
              setSelectedRoom(null);
              const pendingCellsByKey = {};
              pendingCells.forEach((cell) => {
                pendingCellsByKey[getSelectedCellKey(cell.room, cell.date)] = cell;
              });
              setPendingPriceJobs(prev => ({
                ...prev,
                [jobId]: {
                  jobId,
                  building: calendarBuilding,
                  roomCount,
                  status: "queued",
                  pendingCells: pendingCellsByKey,
                  createdAtMs: Date.now(),
                  lastKickAtMs: Date.now(),
                  kickAttempts: 1,
                  usePollingFallback: false
                }
              }));
              setPriceJobToast({ status: "queued", message: `Saved. Syncing ${roomCount} room${roomCount === 1 ? "" : "s"} in the background.` });
              triggerPriceJobNow(jobId);
            }}
            selectedRooms={selectedRooms}
            selectedCells={selectedCells}
            companyId={companyId}
            pendingPriceCellMap={pendingPriceCellMap}
          />
        )}

        {showManualBookingModal && (
          <ManualBookingModal
            initialBuilding={selectedBuilding !== "전체" ? selectedBuilding : ""}
            initialRoom={selectedRoom || ""}
            initialDates={selectedDates}
            roomPrices={roomPrices}
            priceCache={priceCache}
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
              // 예약 목록 갱신 후 로딩없이 새로고침
              fetchReservations();
              fetchPrices(true);
            }}
            companyId={companyId}
          />
        )}

        {showPriceInsightModal && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(15, 23, 42, 0.45)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 9999
            }}
            onClick={() => setShowPriceInsightModal(false)}
          >
            <div
              style={{
                width: "min(760px, 94vw)",
                background: "white",
                borderRadius: "16px",
                border: "1px solid #E5E7EB",
                boxShadow: "0 24px 50px rgba(15, 23, 42, 0.22)",
                overflow: "hidden"
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "16px 18px",
                borderBottom: "1px solid #EEF2F7",
                background: "linear-gradient(180deg, #FFFFFF 0%, #F8FAFC 100%)"
              }}>
                <div>
                  <div style={{ fontSize: "16px", fontWeight: "800", color: "#0F172A" }}>Price Performance Insight</div>
                  <div style={{ fontSize: "12px", color: "#64748B", marginTop: "2px" }}>
                    Future calendar cells only · weekday vs weekend (Fri-Sun) · bucket size ¥1,000
                  </div>
                </div>
                <button
                  onClick={() => setShowPriceInsightModal(false)}
                  style={{
                    width: "30px",
                    height: "30px",
                    borderRadius: "999px",
                    border: "1px solid #E2E8F0",
                    background: "white",
                    color: "#475569",
                    fontSize: "18px",
                    lineHeight: 1,
                    cursor: "pointer"
                  }}
                >
                  ×
                </button>
              </div>

              <div style={{ padding: "16px 18px 18px", display: "grid", gap: "14px" }}>
                {/* 전체 모드일 때만 건물 선택 드롭다운 표시 */}
                {selectedBuilding === "전체" && (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "12px", color: "#64748B", fontWeight: "600", whiteSpace: "nowrap" }}>Property</span>
                    <select
                      value={insightSelectedBuilding || ""}
                      onChange={(e) => setInsightSelectedBuilding(e.target.value)}
                      style={{
                        flex: 1,
                        padding: "7px 10px",
                        borderRadius: "8px",
                        border: "1px solid #D1D5DB",
                        background: "white",
                        fontSize: "13px",
                        fontWeight: "600",
                        color: "#0F172A",
                        cursor: "pointer",
                        outline: "none"
                      }}
                    >
                      {ACTIVE_BUILDING_ORDER.map((b) => (
                        <option key={b} value={b}>{getBuildingNameEN(b)}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* 선택된 건물 카드 1개만 렌더 */}
                {(() => {
                  const buildingName = selectedBuilding !== "전체"
                    ? calendarBuilding
                    : (insightSelectedBuilding || ACTIVE_BUILDING_ORDER[0]);
                  if (!buildingName) return null;
                  const sectionData = priceInsightSummary?.byBuilding?.[buildingName] || {};
                  const weekdayBest = sectionData.weekdayBest || null;
                  const weekendBest = sectionData.weekendBest || null;
                  return (
                    <div style={{ border: "1px solid #E2E8F0", borderRadius: "12px", background: "#F8FAFC", padding: "12px" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                        <div style={{ fontSize: "14px", fontWeight: "800", color: "#0F172A" }}>{getBuildingNameEN(buildingName)}</div>
                        <div style={{ fontSize: "11px", color: "#64748B" }}>{sectionData.sampleCells || 0} cells</div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                        <div style={{ background: "white", border: "1px solid #E2E8F0", borderRadius: "10px", padding: "10px" }}>
                          <div style={{ fontSize: "11px", fontWeight: "800", color: "#047857", textTransform: "uppercase", letterSpacing: "0.04em" }}>Best weekday price</div>
                          <div style={{ fontSize: "17px", fontWeight: "800", color: "#0F172A", marginTop: "4px" }}>
                            {weekdayBest ? weekdayBest.bucketLabel : "-"}
                          </div>
                          <div style={{ fontSize: "12px", color: "#334155", marginTop: "4px" }}>
                            {weekdayBest ? `Sell-through ${(weekdayBest.sellThrough * 100).toFixed(1)}% · ${weekdayBest.booked}/${weekdayBest.exposure}` : "Not enough sample"}
                          </div>
                        </div>
                        <div style={{ background: "white", border: "1px solid #FEE2E2", borderRadius: "10px", padding: "10px" }}>
                          <div style={{ fontSize: "11px", fontWeight: "800", color: "#B91C1C", textTransform: "uppercase", letterSpacing: "0.04em" }}>Best weekend price</div>
                          <div style={{ fontSize: "17px", fontWeight: "800", color: "#0F172A", marginTop: "4px" }}>
                            {weekendBest ? weekendBest.bucketLabel : "-"}
                          </div>
                          <div style={{ fontSize: "12px", color: "#334155", marginTop: "4px" }}>
                            {weekendBest ? `Sell-through ${(weekendBest.sellThrough * 100).toFixed(1)}% · ${weekendBest.booked}/${weekendBest.exposure}` : "Not enough sample"}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                <div style={{ fontSize: "11px", color: "#64748B", lineHeight: 1.5 }}>
                  Based on currently visible future cells. A cell is counted as booked when a confirmed reservation overlaps that room/date.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Gap Edit Confirm 모달에서 Set N Night 클릭 후 확인 및 즉시 실행 */}
        {showGapEditModal && (
          <div style={{
            position: "fixed",
            top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 9999
          }} onClick={() => !isGapApplying && setShowGapEditModal(false)}>
            <div style={{
              background: "white", borderRadius: "16px", padding: "24px",
              width: "380px", boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)"
            }} onClick={(e) => e.stopPropagation()}>
              <h3 style={{ margin: "0 0 16px 0", fontSize: "17px", fontWeight: "700", color: "#111827" }}>
                Set Min Stay = {gapEditMinStay} Night{gapEditMinStay > 1 ? "s" : ""}
              </h3>
              <div style={{
                background: "#F9FAFB", borderRadius: "10px", padding: "14px", marginBottom: "20px",
                fontSize: "13px", color: "#374151", lineHeight: "1.6"
              }}>
                <strong>{selectedCells.length}</strong> cell{selectedCells.length > 1 ? "s" : ""} ·{" "}
                <strong>{selectedRooms.length}</strong> room{selectedRooms.length > 1 ? "s" : ""}<br />
                <span style={{ color: "#6B7280", fontSize: "12px" }}>
                  {selectedRooms.map(r => getRoomNameEN(r)).join(", ")}
                </span>
              </div>
              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  onClick={() => setShowGapEditModal(false)}
                  disabled={isGapApplying}
                  style={{
                    flex: 1, padding: "12px", borderRadius: "10px",
                    border: "1px solid #E5E7EB", background: "white",
                    color: "#374151", fontSize: "14px", fontWeight: "600",
                    cursor: isGapApplying ? "not-allowed" : "pointer"
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    // ✅ 중복 클릭 방지 (debounce)
                    if (isGapApplying) {
                      return;
                    }

                    if (selectedCells.length === 0) {
                      alert("Please select cells first.");
                      return;
                    }

                    // 처리 시작
                    setIsGapApplying(true);
                    const startTime = Date.now();
                    const cellTargets = selectedCells.map((cell) => {
                      const resolvedRoomId = cell.roomId || (gapInfoByCellKey[`${cell.room}__${cell.date}`]?.resolvedRoomId) || "";
                      return {
                        roomName: cell.room,
                        date: cell.date,
                        dateKey: cell.date.replace(/-/g, ''),
                        roomId: resolvedRoomId,
                        minStay: gapEditMinStay
                      };
                    });

                    // ✅ 백업 (롤백용)
                    const backupRoomPrices = typeof structuredClone === 'function'
                      ? structuredClone(roomPrices)
                      : JSON.parse(JSON.stringify(roomPrices));
                    const backupPriceCache = typeof structuredClone === 'function'
                      ? structuredClone(priceCache)
                      : JSON.parse(JSON.stringify(priceCache));

                    try {
                      // ✅ 1단계: 낙관적 UI 업데이트 (API 호출 전 즉시 반영) - 활성 roomId만 (비활성 50/99 제외)
                      const optimisticPatchMap = {};
                      cellTargets.forEach(({ roomName, date, dateKey, roomId }) => {
                        if (roomId) {
                          if (!optimisticPatchMap[roomId]) optimisticPatchMap[roomId] = new Set();
                          optimisticPatchMap[roomId].add(dateKey);
                          return;
                        }

                        const roomInfos = getActiveUnitInfosForDate(roomName, date);
                        roomInfos.forEach((roomInfo) => {
                          const activeRoomId = String(roomInfo.roomId);
                          if (!optimisticPatchMap[activeRoomId]) optimisticPatchMap[activeRoomId] = new Set();
                          optimisticPatchMap[activeRoomId].add(dateKey);
                        });
                      });

                      setRoomPrices(prev => {
                        const updated = { ...prev };
                        Object.entries(optimisticPatchMap).forEach(([roomId, dateKeySet]) => {
                          const roomEntry = updated[roomId];
                          if (!roomEntry?.dates) return;

                          const nextDates = { ...roomEntry.dates };
                          dateKeySet.forEach((dateKey) => {
                            if (nextDates[dateKey]) {
                              nextDates[dateKey] = { ...nextDates[dateKey], m: String(gapEditMinStay) };
                            }
                          });
                          updated[roomId] = { ...roomEntry, dates: nextDates };
                        });
                        return updated;
                      });

                      updatePriceCache(prev => {
                        if (!prev[calendarBuilding]) return prev;
                        const updatedBuilding = { ...prev[calendarBuilding] };

                        Object.entries(optimisticPatchMap).forEach(([roomId, dateKeySet]) => {
                          const roomEntry = updatedBuilding[roomId];
                          if (!roomEntry?.dates) return;

                          const nextDates = { ...roomEntry.dates };
                          dateKeySet.forEach((dateKey) => {
                            if (nextDates[dateKey]) {
                              nextDates[dateKey] = { ...nextDates[dateKey], m: String(gapEditMinStay) };
                            }
                          });
                          updatedBuilding[roomId] = { ...roomEntry, dates: nextDates };
                        });

                        return { ...prev, [calendarBuilding]: updatedBuilding };
                      });

                      // ✅ 2단계: 낙관적 업데이트 후 API 호출 (병렬 처리)
                      const requestPromise = fetch(`${API_BASE_URL}/setMinStay`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          companyId,
                          building: calendarBuilding,
                          cells: cellTargets
                        })
                      })
                        .then(response => response.json())
                        .then(result => {
                          if (result.success) {
                            return { success: true, results: result.results || [] };
                          } else {
                            console.error("[Gap Apply] API failure:", result);
                            return { success: false, error: result.error };
                          }
                        })
                        .catch(err => {
                          console.error("[Gap Apply] API error:", err);
                          return { success: false, error: err.message };
                        });
                      const timeoutPromise = new Promise((resolve) =>
                        setTimeout(() => resolve({ success: false, error: "Request timeout (180s)" }), 180000)
                      );

                      const batchResult = await Promise.race([requestPromise, timeoutPromise]);
                      let successCount = cellTargets.length;
                      let failedSelections = [];
                      if (batchResult.success) {
                        const itemResults = batchResult.results || [];
                        const failedItems = itemResults.filter(r => !r.success);
                        if (failedItems.length > 0) {
                          const failedRoomIdSet = new Set(failedItems.map((item) => String(item.roomId)));
                          const mappedFailedCells = cellTargets.filter((cell) => cell.roomId && failedRoomIdSet.has(String(cell.roomId)));

                          if (mappedFailedCells.length > 0) {
                            failedSelections = mappedFailedCells.map((cell) => ({
                              label: `${cell.roomName} ${cell.date}`,
                              error: failedItems.find((item) => String(item.roomId) === String(cell.roomId))?.error || "Unknown"
                            }));
                            successCount = Math.max(0, cellTargets.length - failedSelections.length);
                          } else {
                            failedSelections = failedItems.map((item) => ({
                              label: `roomId:${item.roomId}`,
                              error: item.error || "Unknown"
                            }));
                            successCount = Math.max(0, cellTargets.length - failedItems.length);
                          }
                        }
                      } else {
                        successCount = 0;
                        failedSelections = cellTargets.map((cell) => ({
                          label: `${cell.roomName} ${cell.date}`,
                          error: batchResult.error
                        }));
                      }

                      const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);

                      // ✅ 3단계: 결과 처리 후 롤백 또는 최신 서버로 실제 상태 반영
                      if (failedSelections.length > 0) {
                        const timeoutRooms = failedSelections.filter(r => r.error?.includes('timeout'));
                        const actualFails = failedSelections.filter(r => !r.error?.includes('timeout'));

                        let msg = `${failedSelections.length} cell(s) had issues.\n`;
                        if (timeoutRooms.length > 0) msg += `\nTimeout (may have applied on Beds24):\n${timeoutRooms.map(r => `- ${r.label}`).join('\n')}`;
                        if (actualFails.length > 0) msg += `\nFailed:\n${actualFails.map(r => `- ${r.label}: ${r.error}`).join('\n')}`;
                        msg += `\n\nSuccessful: ${successCount} cell(s)\nRefreshing prices to sync with Beds24...`;
                        alert(msg);
                      } else {
                        alert(`${successCount} cell(s) updated!\nMin stay set to ${gapEditMinStay} for ${cellTargets.length} cell(s).\n\nTime: ${elapsedTime}s`);
                      }

                      // 모달 닫기 및 초기화
                      setShowGapEditModal(false);
                      setGapEditMode(false);
                      setSelectedCells([]);
                      setSelectedRoom(null);

                      // ✅ 4단계: 최신 서버에서 최종 가격 새로고침 (Beds24 실제 상태 반영)
                      fetchPrices(true, calendarBuilding);

                    } catch (error) {
                      console.error("[Gap Apply] Fatal error:", error);
                      // 전체 롤백
                      setRoomPrices(backupRoomPrices);
                      updatePriceCache(() => backupPriceCache);
                      alert(`Failed to update.\n\nError: ${error.message}\n\nAll changes have been rolled back.`);
                    } finally {
                      setIsGapApplying(false);
                    }
                  }}
                  disabled={isGapApplying}
                  style={{
                    flex: 1, padding: "12px", borderRadius: "10px", border: "none",
                    background: isGapApplying ? "#9CA3AF"
                      : gapEditMinStay === 1
                        ? "linear-gradient(135deg, #10B981 0%, #059669 100%)"
                        : "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)",
                    color: "white", fontSize: "14px", fontWeight: "700",
                    cursor: isGapApplying ? "not-allowed" : "pointer",
                    boxShadow: isGapApplying ? "none"
                      : gapEditMinStay === 1 ? "0 4px 12px rgba(16, 185, 129, 0.3)" : "0 4px 12px rgba(245, 158, 11, 0.3)",
                    transition: "all 0.2s", opacity: isGapApplying ? 0.7 : 1,
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "8px"
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
                    `Apply`
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Block Cleanup Modal - 블록/유지보수 데이터 관리 */}
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
                    Block Data Cleanup
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
                    <div style={{ fontSize: "24px", marginBottom: "12px" }}>...</div>
                    Loading...
                  </div>
                ) : blockData.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "40px", color: "#10B981" }}>
                    <div style={{ fontSize: "32px", marginBottom: "12px" }}>OK</div>
                    <div style={{ fontWeight: "600" }}>No block data found!</div>
                    <div style={{ fontSize: "13px", marginTop: "8px", color: "#6B7280" }}>
                      No block/maintenance data found.
                    </div>
                  </div>
                ) : (
                  <>
                    {/* 수동입력과 Beds24 동기화 데이터 구분 안내 */}
                    <div style={{
                      background: "#EFF6FF",
                      border: "1px solid #93C5FD",
                      borderRadius: "10px",
                      padding: "12px 16px",
                      marginBottom: "12px",
                      fontSize: "13px",
                      color: "#1D4ED8"
                    }}>
                      <strong>Manual entries (Direct)</strong> are user-created. Do not delete.
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
                      Found <strong>{blockData.filter(b => b.source !== "Direct").length}</strong> Beds24 synced blocks. (Excluding {blockData.filter(b => b.source === "Direct").length} manual entries)
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
                              <td style={{ padding: "10px 12px" }}>{getBuildingNameEN(block.building)}</td>
                              <td style={{ padding: "10px 12px", fontWeight: "500" }}>{getRoomNameEN(block.room)}</td>
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
                                  {isManual ? "Direct" : block.source || "Beds24"}
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
                  Refresh
                </button>

                {/* 수동입력(Direct) 제외한 Beds24 동기화 블록만 삭제 */}
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
                    {blockDeleting ? "Deleting..." : `Delete Beds24 Blocks (${blockData.filter(b => b.source !== "Direct").length})`}
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
        {!priceMode && (
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
                onClick={() => {
                  const isAllPropertiesView = !ACTIVE_BUILDING_ORDER.includes(building);
                  if (isAllPropertiesView) {
                    setPriceMode(false);
                    setGapEditMode(false);
                    setSelectedCells([]);
                    setSelectedRoom(null);
                  }
                  setSelectedBuilding(building);
                }}
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

        {/* 전체 선택 시 통계 표시 섹션 */}
          {selectedBuilding === "전체" && !priceMode ? (
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
              {portfolioAnalysisRange.label} Portfolio Overview
            </h3>

            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "14px",
              flexWrap: "wrap",
              marginBottom: "22px",
              padding: "12px 14px",
              borderRadius: "14px",
              background: "linear-gradient(135deg, #F8FAFC 0%, #FFFFFF 100%)",
              border: "1px solid #E5E7EB"
            }}>
              <button
                onClick={() => setShowMonthPicker(true)}
                style={{
                  padding: "9px 14px",
                  borderRadius: "10px",
                  border: "1px solid #D1D5DB",
                  background: portfolioAnalysisRange.isCustom ? "white" : "linear-gradient(135deg, #1F2937 0%, #111827 100%)",
                  color: portfolioAnalysisRange.isCustom ? "#374151" : "white",
                  cursor: "pointer",
                  fontWeight: "700",
                  fontSize: "13px",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  boxShadow: portfolioAnalysisRange.isCustom ? "none" : "0 4px 12px rgba(31,41,55,0.16)"
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                Monthly Search
              </button>

              <div style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: "6px 10px",
                borderRadius: "10px",
                background: "#FFFFFF",
                border: "1px solid #E5E5EA",
                flexWrap: "wrap"
              }}>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={10}
                  value={portfolioDateFrom}
                  onChange={e => setPortfolioDateFrom(normalizeDateInput(e.target.value))}
                  onBlur={() => {
                    const resolved = getResolvedDateInput(portfolioDateFrom);
                    if (resolved) setCommittedDateFrom(resolved);
                    else if (!portfolioDateFrom) setCommittedDateFrom("");
                  }}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      const resolved = getResolvedDateInput(portfolioDateFrom);
                      if (resolved) setCommittedDateFrom(resolved);
                      e.target.blur();
                    }
                  }}
                  placeholder="From YYYY-MM-DD"
                  style={{
                    width: "132px",
                    padding: "7px 10px",
                    borderRadius: "8px",
                    border: "1px solid #D1D1D6",
                    fontSize: "12px",
                    color: "#1D1D1F",
                    background: "#FFFFFF",
                    outline: "none",
                    fontVariantNumeric: "tabular-nums"
                  }}
                />
                <span style={{ fontSize: "12px", color: "#AEAEB2" }}>~</span>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={10}
                  value={portfolioDateTo}
                  onChange={e => setPortfolioDateTo(normalizeDateInput(e.target.value))}
                  onBlur={() => {
                    const resolved = getResolvedDateInput(portfolioDateTo);
                    if (resolved) setCommittedDateTo(resolved);
                    else if (!portfolioDateTo) setCommittedDateTo("");
                  }}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      const resolved = getResolvedDateInput(portfolioDateTo);
                      if (resolved) setCommittedDateTo(resolved);
                      e.target.blur();
                    }
                  }}
                  placeholder="To YYYY-MM-DD"
                  style={{
                    width: "124px",
                    padding: "7px 10px",
                    borderRadius: "8px",
                    border: "1px solid #D1D1D6",
                    fontSize: "12px",
                    color: "#1D1D1F",
                    background: "#FFFFFF",
                    outline: "none",
                    fontVariantNumeric: "tabular-nums"
                  }}
                />
                <button
                  onClick={() => {
                    const todayKey = dayjs().format("YYYY-MM-DD");
                    setPortfolioDateFrom(todayKey);
                    setPortfolioDateTo(todayKey);
                    setCommittedDateFrom(todayKey);
                    setCommittedDateTo(todayKey);
                  }}
                  style={{
                    padding: "6px 10px",
                    borderRadius: "8px",
                    border: "1px solid #D1D1D6",
                    background: "#F8FAFC",
                    color: "#334155",
                    fontSize: "12px",
                    fontWeight: "600",
                    cursor: "pointer"
                  }}
                >
                  Today
                </button>
                <button
                  onClick={() => {
                    setPortfolioDateFrom("");
                    setPortfolioDateTo("");
                    setCommittedDateFrom("");
                    setCommittedDateTo("");
                  }}
                  style={{
                    padding: "6px 10px",
                    borderRadius: "8px",
                    border: "1px solid #D1D1D6",
                    background: "#FFFFFF",
                    color: "#6B7280",
                    fontSize: "12px",
                    fontWeight: "600",
                    cursor: "pointer"
                  }}
                >
                  Clear
                </button>
              </div>
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
              <thead>
                <tr style={{ background: "linear-gradient(135deg, #F9FAFB 0%, #F3F4F6 100%)" }}>
                  <th style={{ padding: "14px 16px", textAlign: "left", borderRadius: "10px 0 0 10px", fontWeight: "600", color: "#374151" }}>Property</th>
                  <th style={{ padding: "14px 16px", textAlign: "center", fontWeight: "600", color: "#374151" }}>Occupancy</th>
                  <th style={{ padding: "14px 16px", textAlign: "center", fontWeight: "600", color: "#374151" }}>Vacant</th>
                  <th style={{ padding: "14px 16px", textAlign: "right", fontWeight: "600", color: "#374151" }}>Avg. Rate</th>
                  <th style={{ padding: "14px 16px", textAlign: "right", borderRadius: "0 10px 10px 0", fontWeight: "600", color: "#374151" }}>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  // ✅ 하단 합계행 초기화 (평균가 및 점유율 계산)
                  let totalOccupiedDays = 0;
                  let totalAvailableDays = 0;
                  let totalVacantNights = 0;
                  let totalPriceSum = 0;
                  let priceCount = 0;
                  let totalNetRevenue = 0;

                  const rows = ACTIVE_BUILDING_ORDER.map(bName => {
                    const cached = allBuildingMetrics?.[bName];
                    const metrics = cached?.metrics || { occupancyRate: 0, vacantNights: 0, avgPrice: 0, totalRevenue: 0, occupiedDays: 0, availableDays: 0 };

                    const occupancy = metrics.occupancyRate;
                    const vacantNights = metrics.vacantNights || 0;
                    const avgPrice = metrics.avgPrice;
                    const netRev = metrics.totalRevenue;

                    if (bName !== EXCLUDED_BUILDING_UI) {
                      totalOccupiedDays += metrics.occupiedDays || 0;
                      totalAvailableDays += metrics.availableDays || 0;
                    }
                    totalVacantNights += vacantNights;
                    totalPriceSum += avgPrice;
                    if (avgPrice > 0) priceCount++;
                    totalNetRevenue += netRev;

                    const isExpanded = expandedBuildings.includes(bName);
                    const toggleExpand = () => {
                      if (isExpanded) {
                        setExpandedBuildings(expandedBuildings.filter(b => b !== bName));
                      } else {
                        setExpandedBuildings([...expandedBuildings, bName]);
                      }
                    };

                    const bRooms = BUILDING_ROOMS[bName] || [];
                    const uniqueRoomNames = [...new Set(bRooms.map(r => r.name))];
                    const roomRows = isExpanded ? uniqueRoomNames.map(roomName => {
                      const rMetrics = cached?.roomMetrics?.[roomName] || { occupancyRate: 0, vacantNights: 0, avgPrice: 0, totalRevenue: 0 };

                      return (
                        <tr key={roomName} style={{ background: "#FAFAFA", fontSize: "13px", color: "#666" }}>
                          <td style={{ padding: "12px 12px 12px 32px", borderBottom: "1px solid #E5E5EA" }}>• {getRoomNameEN(roomName)}</td>
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
                            <span style={{ fontSize: "12px", color: "#86868B", transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>›</span>
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

                  // ✅ 하단 합계: 전체 평균가 / 전체 점유율 (OccupancyRateDashboard와 동일)
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
          /* 기본 캘린더 슬라이드 */
          <div>
            {/* 가격 모드 배너 - Premium Design */}
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
                      {currentBuildingLastPriceSync && (
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
                          Synced {Math.round((new Date() - currentBuildingLastPriceSync) / 60000)} min ago
                        </div>
                      )}
                    </div>
                  </div>
                  {selectedBuilding === "전체" && (
                    <div style={{
                      marginTop: "18px",
                      paddingTop: "18px",
                      borderTop: "1px solid rgba(245, 158, 11, 0.22)"
                    }}>
                      <div style={{
                        fontSize: "12px",
                        fontWeight: "700",
                        color: "#92400E",
                        marginBottom: "10px",
                        letterSpacing: "0.02em"
                      }}>
                        Editing Property In All Properties View
                      </div>
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        {ACTIVE_BUILDING_ORDER.map((building) => {
                          const isActive = portfolioPriceBuilding === building;
                          return (
                            <button
                              key={`portfolio-price-${building}`}
                              onClick={() => {
                                setPortfolioPriceBuilding(building);
                                setSelectedCells([]);
                                setSelectedRoom(null);
                              }}
                              style={{
                                padding: "8px 12px",
                                borderRadius: "999px",
                                border: isActive ? "none" : "1px solid #FCD34D",
                                background: isActive
                                  ? "linear-gradient(135deg, #1F2937 0%, #111827 100%)"
                                  : "rgba(255,255,255,0.84)",
                                color: isActive ? "white" : "#92400E",
                                fontSize: "12px",
                                fontWeight: "700",
                                cursor: "pointer",
                                boxShadow: isActive ? "0 4px 12px rgba(15, 23, 42, 0.22)" : "none",
                                transition: "all 0.2s"
                              }}
                            >
                              {getBuildingNameEN(building)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
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
                        Failed to load prices.
                        <span
                          style={{ cursor: "pointer", textDecoration: "underline" }}
                          onClick={() => { setPricesError(false); fetchPrices(true); }}
                        >Retry</span>
                      </div>
                    )}

                    {/* Min Stay Edit 모드 토글 */}
                    <button
                      onClick={() => {
                        if (!gapEditMode) {
                          setGapEditMode(true);
                          setSelectedCells([]);
                          setSelectedRoom(null);
                        } else {
                          setGapEditMode(false);
                          setSelectedCells([]);
                          setSelectedRoom(null);
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
                      {gapEditMode ? "Exit Min Stay" : "Min Stay Edit"}
                    </button>

                    {/* 블록 관리 버튼 */}
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

                {/* Gap Edit Mode 확인 설정 액션바 */}
                {gapEditMode && (
                  <div style={{
                    marginTop: "16px",
                    background: "linear-gradient(135deg, #EDE9FE 0%, #F5F3FF 100%)",
                    padding: "14px 20px",
                    borderRadius: "12px",
                    border: "2px solid #8B5CF6",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: "12px"
                  }}>
                    {/* 왼쪽: 선택 안내 */}
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: "200px" }}>
                      <div style={{
                        width: "32px", height: "32px", borderRadius: "8px",
                        background: "linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)",
                        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
                      }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </div>
                      <div>
                        <div style={{ fontWeight: "700", color: "#5B21B6", fontSize: "14px", lineHeight: "1.2" }}>
                          Min Stay Edit
                        </div>
                        <div style={{ fontSize: "12px", color: "#7C3AED", marginTop: "2px" }}>
                          {selectedCells.length > 0
                          ? `${selectedCells.length} cell${selectedCells.length > 1 ? "s" : ""} selected`
                            : "Select cells on calendar"}
                        </div>
                      </div>
                    </div>

                    {/* 오른쪽: 액션 버튼들 */}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      {/* Select Gap Cells 전용 버튼 */}
                      <button
                        onClick={() => {
                          const todayStr = dayjs().format('YYYY-MM-DD');
                          const gapCells = [];
                          gapCellSet.forEach(key => {
                            const [room, date] = key.split('__');
                            if (date < todayStr) return;
                            const gapInfo = gapInfoByCellKey[`${room}__${date}`] || { resolvedRoomId: null };
                            gapCells.push({ room, date, roomId: gapInfo.resolvedRoomId || "" });
                          });
                          if (gapCells.length === 0) {
                            alert("No red gap cells (1 night available with minStay 2) found.");
                            return;
                          }
                          gapCells.sort((a, b) => a.room.localeCompare(b.room) || a.date.localeCompare(b.date));
                          setSelectedCells(gapCells);
                          setSelectedRoom(gapCells[0]?.room || null);
                        }}
                        style={{
                          padding: "8px 14px", borderRadius: "8px",
                          border: "1px solid #EF4444",
                          background: "linear-gradient(135deg, #FEF2F2 0%, #FEE2E2 100%)",
                          color: "#DC2626",
                          fontSize: "12px", fontWeight: "600", cursor: "pointer",
                          display: "flex", alignItems: "center", gap: "5px",
                          transition: "all 0.15s"
                        }}
                        title="Auto-select gap cells that need minStay change (red badges)"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                        Select Red Gaps
                      </button>

                      <div style={{ width: "1px", height: "28px", background: "#DDD6FE" }} />

                      {/* Set 1 Night */}
                      <button
                        disabled={selectedCells.length === 0 || isGapApplying}
                        onClick={() => { setGapEditMinStay(1); setShowGapEditModal(true); }}
                        style={{
                          padding: "8px 16px", borderRadius: "8px", border: "none",
                          background: selectedCells.length === 0 || isGapApplying
                            ? "#E5E7EB"
                            : "linear-gradient(135deg, #10B981 0%, #059669 100%)",
                          color: selectedCells.length === 0 || isGapApplying ? "#9CA3AF" : "white",
                          fontSize: "13px", fontWeight: "700", cursor: selectedCells.length === 0 || isGapApplying ? "not-allowed" : "pointer",
                          boxShadow: selectedCells.length > 0 && !isGapApplying ? "0 2px 8px rgba(16, 185, 129, 0.3)" : "none",
                          transition: "all 0.15s", display: "flex", alignItems: "center", gap: "5px"
                        }}
                      >
                        {isGapApplying ? "Applying..." : "Set 1 Night"}
                      </button>

                      {/* Set 2 Nights */}
                      <button
                        disabled={selectedCells.length === 0 || isGapApplying}
                        onClick={() => { setGapEditMinStay(2); setShowGapEditModal(true); }}
                        style={{
                          padding: "8px 16px", borderRadius: "8px", border: "none",
                          background: selectedCells.length === 0 || isGapApplying
                            ? "#E5E7EB"
                            : "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)",
                          color: selectedCells.length === 0 || isGapApplying ? "#9CA3AF" : "white",
                          fontSize: "13px", fontWeight: "700", cursor: selectedCells.length === 0 || isGapApplying ? "not-allowed" : "pointer",
                          boxShadow: selectedCells.length > 0 && !isGapApplying ? "0 2px 8px rgba(245, 158, 11, 0.3)" : "none",
                          transition: "all 0.15s", display: "flex", alignItems: "center", gap: "5px"
                        }}
                      >
                        {isGapApplying ? "Applying..." : "Set 2 Nights"}
                      </button>

                      {/* Custom 3+ min stay */}
                      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                        <input
                          type="number"
                          min={3}
                          max={30}
                          placeholder="3+"
                          value={customMinStay}
                          onChange={(e) => setCustomMinStay(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              const v = parseInt(customMinStay, 10);
                              if (v >= 3 && v <= 30 && selectedCells.length > 0 && !isGapApplying) {
                                setGapEditMinStay(v);
                                setShowGapEditModal(true);
                              }
                            }
                          }}
                          style={{
                            width: "52px", padding: "7px 8px", borderRadius: "8px",
                            border: "1.5px solid #C4B5FD", background: "white",
                            fontSize: "13px", fontWeight: "600", color: "#1E293B",
                            textAlign: "center", outline: "none",
                            boxShadow: "0 1px 3px rgba(79,70,229,0.08)",
                            MozAppearance: "textfield"
                          }}
                        />
                        <button
                          disabled={
                            selectedCells.length === 0 || isGapApplying ||
                            !(parseInt(customMinStay, 10) >= 3 && parseInt(customMinStay, 10) <= 30)
                          }
                          onClick={() => {
                            const v = parseInt(customMinStay, 10);
                            if (v >= 3 && v <= 30) { setGapEditMinStay(v); setShowGapEditModal(true); }
                          }}
                          style={{
                            padding: "8px 14px", borderRadius: "8px", border: "none",
                            background: (selectedCells.length === 0 || isGapApplying ||
                              !(parseInt(customMinStay, 10) >= 3 && parseInt(customMinStay, 10) <= 30))
                              ? "#E5E7EB"
                              : "linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)",
                            color: (selectedCells.length === 0 || isGapApplying ||
                              !(parseInt(customMinStay, 10) >= 3 && parseInt(customMinStay, 10) <= 30))
                              ? "#9CA3AF" : "white",
                            fontSize: "13px", fontWeight: "700",
                            cursor: (selectedCells.length === 0 || isGapApplying ||
                              !(parseInt(customMinStay, 10) >= 3 && parseInt(customMinStay, 10) <= 30))
                              ? "not-allowed" : "pointer",
                            boxShadow: (selectedCells.length > 0 && !isGapApplying &&
                              parseInt(customMinStay, 10) >= 3 && parseInt(customMinStay, 10) <= 30)
                              ? "0 2px 8px rgba(79,70,229,0.3)" : "none",
                            transition: "all 0.15s"
                          }}
                        >
                          Apply
                        </button>
                      </div>

                      <div style={{ width: "1px", height: "28px", background: "#DDD6FE" }} />

                      {/* Clear Selection */}
                      <button
                        disabled={selectedCells.length === 0}
                        onClick={() => { setSelectedCells([]); setSelectedRoom(null); }}
                        style={{
                          padding: "8px 12px", borderRadius: "8px",
                          border: "1px solid #E5E7EB", background: "white",
                          color: selectedCells.length === 0 ? "#D1D5DB" : "#6B7280",
                          fontSize: "12px", fontWeight: "600",
                          cursor: selectedCells.length === 0 ? "default" : "pointer",
                          transition: "all 0.15s"
                        }}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                )}

                {/* 상단 버튼 그룹 (Row 1: 좌측 상단) - Premium Design */}
                <div style={{ display: "flex", gap: "14px", flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      onClick={toggleSelectAllRooms}
                      style={{
                        padding: "8px 14px",
                        borderRadius: "8px",
                        border: allSelectableRoomsSelected ? "none" : "1px solid #D1D5DB",
                        background: allSelectableRoomsSelected
                          ? "linear-gradient(135deg, #1F2937 0%, #111827 100%)"
                          : "white",
                        color: allSelectableRoomsSelected ? "white" : "#374151",
                        fontSize: "12px",
                        cursor: "pointer",
                        fontWeight: "600",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        transition: "all 0.2s",
                        boxShadow: allSelectableRoomsSelected ? "0 2px 8px rgba(31, 41, 55, 0.3)" : "none"
                      }}
                    >
                      {allSelectableRoomsSelected && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                      {allSelectableRoomsSelected ? "Deselect All" : "Select All Rooms"}
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

                  {bulkSelectMsg && (
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "5px",
                      padding: "4px 10px",
                      borderRadius: "6px",
                      background: bulkSelectMsg.startsWith('No vacant') ? "#FEF2F2" : "#FFFBEB",
                      color: bulkSelectMsg.startsWith('No vacant') ? "#DC2626" : "#92400E",
                      fontSize: "11px",
                      fontWeight: "600",
                      border: `1px solid ${bulkSelectMsg.startsWith('No vacant') ? "#FECACA" : "#FDE68A"}`
                    }}>
                      {bulkSelectMsg}
                    </div>
                  )}

                  <div style={{ flex: 1 }}></div>

                  <div style={{ display: "flex", gap: "10px" }}>
                    <button
                      onClick={() => { setSelectedCells([]); setSelectedRoom(null); setBulkSelectMsg(''); }}
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
              </div>
            )}
          </div>
        )}

        {(selectedBuilding !== "전체" || priceMode || gapEditMode || isCalendarFullscreen) && (
        <div style={isCalendarFullscreen ? {
          position: "fixed",
          inset: 0,
          zIndex: 1400,
          padding: "14px",
          background: "linear-gradient(180deg, rgba(248,250,252,0.98) 0%, rgba(241,245,249,0.98) 100%)",
          backdropFilter: "blur(14px)",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden"
        } : undefined}>
        {isCalendarFullscreen && (
          <div style={{
            display: "flex",
            gap: "8px",
            alignItems: "center",
            overflowX: "auto",
            marginBottom: "8px",
            padding: "8px 10px",
            background: "rgba(255,255,255,0.9)",
            border: "1px solid rgba(226, 232, 240, 0.9)",
            borderRadius: "12px",
            boxShadow: "0 8px 18px rgba(15, 23, 42, 0.07)",
            flexShrink: 0,
            scrollbarWidth: "none",
            msOverflowStyle: "none"
          }}>
            <div style={{
              fontSize: "10px",
              fontWeight: "800",
              color: "#64748B",
              letterSpacing: "0.04em",
              whiteSpace: "nowrap",
              paddingRight: "4px"
            }}>
              PROPERTY
            </div>
            {ACTIVE_BUILDING_ORDER.map((building) => {
              const isActive = calendarBuilding === building;
              return (
                <button
                  key={`fullscreen-building-${building}`}
                  onClick={() => {
                    if (selectedBuilding === "전체" && (priceMode || gapEditMode)) {
                      setPortfolioPriceBuilding(building);
                    } else {
                      setSelectedBuilding(building);
                    }
                    setSelectedCells([]);
                    setSelectedRoom(null);
                  }}
                  style={{
                    padding: "6px 10px",
                    borderRadius: "999px",
                    border: isActive ? "none" : "1px solid #E5E7EB",
                    background: isActive
                      ? "linear-gradient(135deg, #1F2937 0%, #111827 100%)"
                      : "white",
                    color: isActive ? "white" : "#475569",
                    fontWeight: "700",
                    fontSize: "10px",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    boxShadow: isActive ? "0 5px 12px rgba(15, 23, 42, 0.14)" : "0 1px 2px rgba(0,0,0,0.05)",
                    transition: "all 0.2s"
                  }}
                >
                  {getBuildingNameEN(building)}
                </button>
              );
            })}
          </div>
        )}
        {isCalendarFullscreen && (priceMode || gapEditMode) && (
          <div style={{
            display: "flex",
            gap: "8px",
            alignItems: "center",
            flexWrap: "wrap",
            marginBottom: "8px",
            padding: "6px 8px",
            background: "rgba(255,255,255,0.88)",
            border: "1px solid rgba(226, 232, 240, 0.9)",
            borderRadius: "10px",
            boxShadow: "0 6px 14px rgba(15, 23, 42, 0.05)",
            flexShrink: 0
          }}>
            <button
              onClick={toggleSelectAllRooms}
              style={{
                padding: "6px 10px",
                borderRadius: "7px",
                border: allSelectableRoomsSelected ? "none" : "1px solid #D1D5DB",
                background: allSelectableRoomsSelected
                  ? "linear-gradient(135deg, #1F2937 0%, #111827 100%)"
                  : "white",
                color: allSelectableRoomsSelected ? "white" : "#374151",
                fontSize: "11px",
                fontWeight: "700",
                cursor: "pointer",
                transition: "all 0.2s"
              }}
            >
              {allSelectableRoomsSelected ? "Deselect All Rooms" : "Select All Rooms"}
            </button>
            <button onClick={() => selectDatesByFilter('all')} style={{ ...filterBtnStyle, padding: "6px 10px", borderRadius: "7px", fontSize: "11px" }}>All Days</button>
            <button onClick={() => selectDatesByFilter('weekday')} style={{ ...filterBtnStyle, padding: "6px 10px", borderRadius: "7px", fontSize: "11px" }}>Weekdays</button>
            <button onClick={() => selectDatesByFilter('weekend')} style={{ ...filterBtnStyle, padding: "6px 10px", borderRadius: "7px", fontSize: "11px" }}>Weekends</button>
            {bulkSelectMsg && (
              <div style={{
                width: "100%",
                padding: "4px 8px",
                borderRadius: "6px",
                background: bulkSelectMsg.startsWith('No vacant') ? "#FEF2F2" : "#FFFBEB",
                color: bulkSelectMsg.startsWith('No vacant') ? "#DC2626" : "#92400E",
                fontSize: "10px",
                fontWeight: "600",
                border: `1px solid ${bulkSelectMsg.startsWith('No vacant') ? "#FECACA" : "#FDE68A"}`
              }}>
                {bulkSelectMsg}
              </div>
            )}
          </div>
        )}
        {/* 월 네비게이션 - Premium Design */}
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: isCalendarFullscreen ? "8px" : "20px",
          background: "white",
          padding: isCalendarFullscreen ? "8px 12px" : "16px 24px",
          borderRadius: isCalendarFullscreen ? "12px" : "16px",
          boxShadow: isCalendarFullscreen ? "0 10px 22px rgba(15, 23, 42, 0.09)" : "0 4px 16px rgba(0,0,0,0.06)",
          border: "1px solid #F3F4F6",
          flexShrink: 0
        }}>
          <div style={{ display: "flex", gap: isCalendarFullscreen ? "6px" : "10px", alignItems: "center", flexWrap: "wrap" }}>
            {/* 뷰 모드 전환 버튼 */}
            <button
              onClick={toggleViewMode}
              style={{
                padding: isCalendarFullscreen ? "7px 12px" : "10px 16px",
                borderRadius: isCalendarFullscreen ? "8px" : "10px",
                border: viewMode === "rolling" ? "2px solid #7C3AED" : "1px solid #E5E7EB",
                background: viewMode === "rolling" ? "linear-gradient(135deg, #EDE9FE 0%, #DDD6FE 100%)" : "white",
                color: viewMode === "rolling" ? "#7C3AED" : "#4B5563",
                cursor: "pointer",
                fontWeight: "600",
                fontSize: isCalendarFullscreen ? "12px" : "13px",
                display: "flex",
                alignItems: "center",
                gap: isCalendarFullscreen ? "5px" : "6px",
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

            <div style={{ width: "1px", height: isCalendarFullscreen ? "20px" : "24px", background: "#E5E7EB", margin: "0 4px" }}></div>

            {viewMode === "monthly" ? (
              /* 월별 뷰 네비게이터 */
              <>
                <button
                  onClick={goToPrevMonth}
                  style={{
                    padding: isCalendarFullscreen ? "7px 12px" : "10px 16px",
                    borderRadius: isCalendarFullscreen ? "8px" : "10px",
                    border: "1px solid #E5E7EB",
                    background: "white",
                    cursor: "pointer",
                    fontWeight: "600",
                    fontSize: isCalendarFullscreen ? "12px" : "13px",
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
                    padding: isCalendarFullscreen ? "7px 14px" : "10px 18px",
                    borderRadius: isCalendarFullscreen ? "8px" : "10px",
                    border: "none",
                    background: "linear-gradient(135deg, #10B981 0%, #059669 100%)",
                    color: "white",
                    cursor: "pointer",
                    fontWeight: "600",
                    fontSize: isCalendarFullscreen ? "12px" : "13px",
                    boxShadow: isCalendarFullscreen ? "0 3px 8px rgba(16, 185, 129, 0.26)" : "0 4px 12px rgba(16, 185, 129, 0.3)",
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
                    padding: isCalendarFullscreen ? "7px 12px" : "10px 16px",
                    borderRadius: isCalendarFullscreen ? "8px" : "10px",
                    border: "1px solid #E5E7EB",
                    background: "white",
                    cursor: "pointer",
                    fontWeight: "600",
                    fontSize: isCalendarFullscreen ? "12px" : "13px",
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
              /* 30일 롤링 뷰 네비게이터 */
              <>
                <button
                  onClick={goToRollingPrev}
                  style={{
                    padding: isCalendarFullscreen ? "7px 12px" : "10px 16px",
                    borderRadius: isCalendarFullscreen ? "8px" : "10px",
                    border: "1px solid #E5E7EB",
                    background: "white",
                    cursor: "pointer",
                    fontWeight: "600",
                    fontSize: isCalendarFullscreen ? "12px" : "13px",
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
                    padding: isCalendarFullscreen ? "7px 14px" : "10px 18px",
                    borderRadius: isCalendarFullscreen ? "8px" : "10px",
                    border: "none",
                    background: "linear-gradient(135deg, #10B981 0%, #059669 100%)",
                    color: "white",
                    cursor: "pointer",
                    fontWeight: "600",
                    fontSize: isCalendarFullscreen ? "12px" : "13px",
                    boxShadow: isCalendarFullscreen ? "0 3px 8px rgba(16, 185, 129, 0.26)" : "0 4px 12px rgba(16, 185, 129, 0.3)",
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
                    padding: isCalendarFullscreen ? "7px 12px" : "10px 16px",
                    borderRadius: isCalendarFullscreen ? "8px" : "10px",
                    border: "1px solid #E5E7EB",
                    background: "white",
                    cursor: "pointer",
                    fontWeight: "600",
                    fontSize: isCalendarFullscreen ? "12px" : "13px",
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
                  fontSize: isCalendarFullscreen ? "11px" : "13px",
                  color: "#6B7280",
                  marginLeft: isCalendarFullscreen ? "4px" : "8px",
                  padding: isCalendarFullscreen ? "5px 10px" : "6px 12px",
                  background: "#F9FAFB",
                  borderRadius: isCalendarFullscreen ? "7px" : "8px"
                }}>
                  {dayjs(rollingStartDate).format('M/D')} ~ {dayjs(rollingStartDate).add(29, 'day').format('M/D')}
                </span>
              </>
            )}

            <div style={{ width: "1px", height: isCalendarFullscreen ? "20px" : "24px", background: "#E5E7EB", margin: "0 4px" }}></div>

            <button
              onClick={togglePriceMode}
              style={{
                padding: isCalendarFullscreen ? "7px 14px" : "10px 18px",
                borderRadius: isCalendarFullscreen ? "8px" : "10px",
                border: priceMode ? "2px solid #F59E0B" : "none",
                background: priceMode
                  ? "linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%)"
                  : "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)",
                color: priceMode ? "#B45309" : "white",
                cursor: "pointer",
                fontWeight: "700",
                fontSize: isCalendarFullscreen ? "12px" : "13px",
                display: "flex",
                alignItems: "center",
                gap: isCalendarFullscreen ? "6px" : "8px",
                boxShadow: priceMode
                  ? "0 0 0 2px rgba(245, 158, 11, 0.16)"
                  : isCalendarFullscreen
                    ? "0 3px 8px rgba(245, 158, 11, 0.24)"
                    : "0 4px 12px rgba(245, 158, 11, 0.3)",
                transition: "all 0.2s"
              }}
              onMouseEnter={(e) => e.currentTarget.style.transform = "translateY(-1px)"}
              onMouseLeave={(e) => e.currentTarget.style.transform = "translateY(0)"}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {priceMode ? (
                  <>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </>
                ) : (
                  <>
                    <line x1="12" y1="1" x2="12" y2="23" />
                    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </>
                )}
              </svg>
              {priceMode ? "Exit Price" : "Edit Price"}
            </button>
            {priceMode && (
              <button
                onClick={() => { setSelectedCells([]); setSelectedRoom(null); }}
                disabled={selectedCells.length === 0}
                style={{
                  padding: isCalendarFullscreen ? "7px 14px" : "10px 18px",
                  borderRadius: isCalendarFullscreen ? "8px" : "10px",
                  border: "1px solid #E5E7EB",
                  background: "white",
                  color: selectedCells.length === 0 ? "#9CA3AF" : "#6B7280",
                  cursor: selectedCells.length === 0 ? "not-allowed" : "pointer",
                  fontWeight: "700",
                  fontSize: isCalendarFullscreen ? "12px" : "13px",
                  display: "flex",
                  alignItems: "center",
                  gap: isCalendarFullscreen ? "6px" : "8px",
                  transition: "all 0.2s"
                }}
                onMouseEnter={(e) => {
                  if (selectedCells.length > 0) e.currentTarget.style.background = "#F9FAFB";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "white";
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
                Clear Selection
              </button>
            )}
            {priceMode && (
              <button
                onClick={openPriceModal}
                disabled={selectedCells.length === 0 || !selectedRoom}
                style={{
                  padding: isCalendarFullscreen ? "7px 14px" : "10px 18px",
                  borderRadius: isCalendarFullscreen ? "8px" : "10px",
                  border: "none",
                  background: selectedCells.length === 0 || !selectedRoom
                    ? "#E5E7EB"
                    : "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)",
                  color: selectedCells.length === 0 || !selectedRoom ? "#9CA3AF" : "white",
                  cursor: selectedCells.length === 0 || !selectedRoom ? "not-allowed" : "pointer",
                  fontWeight: "700",
                  fontSize: isCalendarFullscreen ? "12px" : "13px",
                  display: "flex",
                  alignItems: "center",
                  gap: isCalendarFullscreen ? "6px" : "8px",
                  boxShadow: selectedCells.length === 0 || !selectedRoom
                    ? "none"
                    : isCalendarFullscreen
                      ? "0 3px 8px rgba(245, 158, 11, 0.24)"
                      : "0 4px 12px rgba(245, 158, 11, 0.3)",
                  transition: "all 0.2s"
                }}
                onMouseEnter={(e) => {
                  if (selectedCells.length > 0 && selectedRoom) e.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Apply Price
              </button>
            )}
            {isCalendarFullscreen && (
              <button
                onClick={toggleMinStayEditMode}
                style={{
                  padding: "7px 14px",
                  borderRadius: "8px",
                  border: gapEditMode ? "2px solid #8B5CF6" : "none",
                  background: gapEditMode
                    ? "linear-gradient(135deg, #EDE9FE 0%, #DDD6FE 100%)"
                    : "linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)",
                  color: gapEditMode ? "#5B21B6" : "white",
                  cursor: "pointer",
                  fontWeight: "700",
                  fontSize: "12px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  boxShadow: gapEditMode ? "0 0 0 2px rgba(139, 92, 246, 0.18)" : "0 3px 8px rgba(139, 92, 246, 0.24)",
                  transition: "all 0.2s"
                }}
                onMouseEnter={(e) => e.currentTarget.style.transform = "translateY(-1px)"}
                onMouseLeave={(e) => e.currentTarget.style.transform = "translateY(0)"}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {gapEditMode ? (
                    <>
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </>
                  ) : (
                    <>
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </>
                  )}
                </svg>
                {gapEditMode ? "Exit Min Stay" : "Min Stay"}
              </button>
            )}
            {isCalendarFullscreen && gapEditMode && (
              <>
                <button
                  onClick={selectRedGapCells}
                  style={{
                    padding: "7px 12px",
                    borderRadius: "8px",
                    border: "1px solid #FCA5A5",
                    background: "linear-gradient(135deg, #FEF2F2 0%, #FEE2E2 100%)",
                    color: "#DC2626",
                    cursor: "pointer",
                    fontWeight: "700",
                    fontSize: "12px",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    transition: "all 0.2s"
                  }}
                  title="Auto-select gap cells that need minStay change"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  Red Gaps
                </button>
                <button
                  disabled={selectedCells.length === 0 || isGapApplying}
                  onClick={() => { setGapEditMinStay(1); setShowGapEditModal(true); }}
                  style={{
                    padding: "7px 12px",
                    borderRadius: "8px",
                    border: "none",
                    background: selectedCells.length === 0 || isGapApplying
                      ? "#E5E7EB"
                      : "linear-gradient(135deg, #10B981 0%, #059669 100%)",
                    color: selectedCells.length === 0 || isGapApplying ? "#9CA3AF" : "white",
                    cursor: selectedCells.length === 0 || isGapApplying ? "not-allowed" : "pointer",
                    fontWeight: "700",
                    fontSize: "12px",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    boxShadow: selectedCells.length > 0 && !isGapApplying ? "0 3px 8px rgba(16, 185, 129, 0.24)" : "none",
                    transition: "all 0.2s"
                  }}
                >
                  Set 1N
                </button>
                <button
                  disabled={selectedCells.length === 0 || isGapApplying}
                  onClick={() => { setGapEditMinStay(2); setShowGapEditModal(true); }}
                  style={{
                    padding: "7px 12px",
                    borderRadius: "8px",
                    border: "none",
                    background: selectedCells.length === 0 || isGapApplying
                      ? "#E5E7EB"
                      : "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)",
                    color: selectedCells.length === 0 || isGapApplying ? "#9CA3AF" : "white",
                    cursor: selectedCells.length === 0 || isGapApplying ? "not-allowed" : "pointer",
                    fontWeight: "700",
                    fontSize: "12px",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    boxShadow: selectedCells.length > 0 && !isGapApplying ? "0 3px 8px rgba(245, 158, 11, 0.24)" : "none",
                    transition: "all 0.2s"
                  }}
                >
                  Set 2N
                </button>
                {/* Custom 3+ (mobile) */}
                <input
                  type="number"
                  min={3}
                  max={30}
                  placeholder="3+"
                  value={customMinStay}
                  onChange={(e) => setCustomMinStay(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const v = parseInt(customMinStay, 10);
                      if (v >= 3 && v <= 30 && selectedCells.length > 0 && !isGapApplying) {
                        setGapEditMinStay(v);
                        setShowGapEditModal(true);
                      }
                    }
                  }}
                  style={{
                    width: "46px", padding: "6px 6px", borderRadius: "8px",
                    border: "1.5px solid #C4B5FD", background: "white",
                    fontSize: "12px", fontWeight: "600", color: "#1E293B",
                    textAlign: "center", outline: "none",
                    MozAppearance: "textfield"
                  }}
                />
                <button
                  disabled={
                    selectedCells.length === 0 || isGapApplying ||
                    !(parseInt(customMinStay, 10) >= 3 && parseInt(customMinStay, 10) <= 30)
                  }
                  onClick={() => {
                    const v = parseInt(customMinStay, 10);
                    if (v >= 3 && v <= 30) { setGapEditMinStay(v); setShowGapEditModal(true); }
                  }}
                  style={{
                    padding: "7px 10px", borderRadius: "8px", border: "none",
                    background: (selectedCells.length === 0 || isGapApplying ||
                      !(parseInt(customMinStay, 10) >= 3 && parseInt(customMinStay, 10) <= 30))
                      ? "#E5E7EB"
                      : "linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)",
                    color: (selectedCells.length === 0 || isGapApplying ||
                      !(parseInt(customMinStay, 10) >= 3 && parseInt(customMinStay, 10) <= 30))
                      ? "#9CA3AF" : "white",
                    cursor: (selectedCells.length === 0 || isGapApplying ||
                      !(parseInt(customMinStay, 10) >= 3 && parseInt(customMinStay, 10) <= 30))
                      ? "not-allowed" : "pointer",
                    fontWeight: "700", fontSize: "12px",
                    display: "flex", alignItems: "center", gap: "4px",
                    boxShadow: (selectedCells.length > 0 && !isGapApplying &&
                      parseInt(customMinStay, 10) >= 3 && parseInt(customMinStay, 10) <= 30)
                      ? "0 3px 8px rgba(79,70,229,0.24)" : "none",
                    transition: "all 0.2s"
                  }}
                >
                  Apply
                </button>
                <button
                  disabled={selectedCells.length === 0}
                  onClick={() => { setSelectedCells([]); setSelectedRoom(null); }}
                  style={{
                    padding: "7px 12px",
                    borderRadius: "8px",
                    border: "1px solid #E5E7EB",
                    background: "white",
                    color: selectedCells.length === 0 ? "#9CA3AF" : "#6B7280",
                    cursor: selectedCells.length === 0 ? "not-allowed" : "pointer",
                    fontWeight: "700",
                    fontSize: "12px",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    transition: "all 0.2s"
                  }}
                  onMouseEnter={(e) => {
                    if (selectedCells.length > 0) e.currentTarget.style.background = "#F9FAFB";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "white";
                  }}
                >
                  Clear
                </button>
              </>
            )}

            <button
              onClick={toggleCalendarFullscreen}
              style={{
                padding: isCalendarFullscreen ? "7px 14px" : "10px 18px",
                borderRadius: isCalendarFullscreen ? "8px" : "10px",
                border: isCalendarFullscreen ? "none" : "1px solid #E5E7EB",
                background: isCalendarFullscreen ? "linear-gradient(135deg, #0F172A 0%, #334155 100%)" : "white",
                color: isCalendarFullscreen ? "white" : "#4B5563",
                cursor: "pointer",
                fontWeight: "600",
                fontSize: isCalendarFullscreen ? "12px" : "13px",
                display: "flex",
                alignItems: "center",
                gap: isCalendarFullscreen ? "6px" : "8px",
                boxShadow: isCalendarFullscreen ? "0 8px 16px rgba(15, 23, 42, 0.16)" : "none",
                transition: "all 0.2s"
              }}
              onMouseEnter={(e) => {
                if (!isCalendarFullscreen) e.currentTarget.style.background = "#F9FAFB";
              }}
              onMouseLeave={(e) => {
                if (!isCalendarFullscreen) e.currentTarget.style.background = "white";
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {isCalendarFullscreen ? (
                  <>
                    <polyline points="9 15 3 15 3 21" />
                    <polyline points="15 9 21 9 21 3" />
                    <line x1="3" y1="21" x2="9" y2="15" />
                    <line x1="21" y1="3" x2="15" y2="9" />
                  </>
                ) : (
                  <>
                    <polyline points="15 3 21 3 21 9" />
                    <polyline points="9 21 3 21 3 15" />
                    <line x1="21" y1="3" x2="14" y2="10" />
                    <line x1="3" y1="21" x2="10" y2="14" />
                  </>
                )}
              </svg>
              {isCalendarFullscreen ? "Exit Full View" : "Full View"}
            </button>

            <button
              onClick={() => navigate('/price-history')}
              style={{
                padding: isCalendarFullscreen ? "7px 14px" : "10px 18px",
                borderRadius: isCalendarFullscreen ? "8px" : "10px",
                border: "1px solid #E5E7EB",
                background: "white",
                color: "#4B5563",
                cursor: "pointer",
                fontWeight: "600",
                fontSize: isCalendarFullscreen ? "12px" : "13px",
                display: "flex",
                alignItems: "center",
                gap: isCalendarFullscreen ? "6px" : "8px",
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
            {showBeds24DetailView && (
              <button
                onClick={toggleVacantOnlyMode}
                style={{
                  padding: isCalendarFullscreen ? "7px 14px" : "10px 18px",
                  borderRadius: isCalendarFullscreen ? "8px" : "10px",
                  border: vacantOnlyMode ? "none" : "1px solid #E5E7EB",
                  background: vacantOnlyMode
                    ? "linear-gradient(135deg, #0F766E 0%, #0F766E 45%, #115E59 100%)"
                    : "white",
                  color: vacantOnlyMode ? "white" : "#4B5563",
                  cursor: "pointer",
                  fontWeight: "600",
                  fontSize: isCalendarFullscreen ? "12px" : "13px",
                  display: "flex",
                  alignItems: "center",
                  gap: isCalendarFullscreen ? "6px" : "8px",
                  boxShadow: vacantOnlyMode ? "0 4px 12px rgba(15, 118, 110, 0.22)" : "none",
                  transition: "all 0.2s"
                }}
                onMouseEnter={(e) => {
                  if (!vacantOnlyMode) e.currentTarget.style.background = "#F9FAFB";
                }}
                onMouseLeave={(e) => {
                  if (!vacantOnlyMode) e.currentTarget.style.background = "white";
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 10h18" />
                  <path d="M5 6h14" />
                  <path d="M7 14h10" />
                  <path d="M9 18h6" />
                </svg>
                {vacantOnlyMode ? "Show All Rooms" : "Vacant Today"}
              </button>
            )}
            {showBeds24DetailView && (
              <button
                onClick={() => {
                  // 모달 오픈 시 현재 건물로 초기화 (전체일 땐 첫 번째 건물)
                  setInsightSelectedBuilding(
                    calendarBuilding && calendarBuilding !== "전체"
                      ? calendarBuilding
                      : ACTIVE_BUILDING_ORDER[0]
                  );
                  setShowPriceInsightModal(true);
                }}
                title="Price performance insight"
                style={{
                  width: isCalendarFullscreen ? "34px" : "38px",
                  height: isCalendarFullscreen ? "34px" : "38px",
                  borderRadius: "999px",
                  border: "1px solid #E5E7EB",
                  background: "white",
                  color: "#475569",
                  cursor: "pointer",
                  fontWeight: "800",
                  fontSize: isCalendarFullscreen ? "15px" : "16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "all 0.2s"
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#F8FAFC";
                  e.currentTarget.style.borderColor = "#CBD5E1";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "white";
                  e.currentTarget.style.borderColor = "#E5E7EB";
                }}
              >
                ?
              </button>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: isCalendarFullscreen ? "12px" : "20px", flexWrap: "wrap", justifyContent: "flex-end" }}>
            {/* 월 표시 */}
            <div
              onClick={() => setShowMonthPicker(true)}
              style={{
                fontSize: isCalendarFullscreen ? "15px" : "18px",
                fontWeight: "700",
                color: "#111827",
                cursor: "pointer",
                padding: isCalendarFullscreen ? "7px 14px" : "10px 18px",
                borderRadius: isCalendarFullscreen ? "10px" : "12px",
                transition: "all 0.2s",
                display: "flex",
                alignItems: "center",
                gap: isCalendarFullscreen ? "6px" : "8px",
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

            {/* Date jump search — type YYYY-MM-DD to jump calendar to that anchor in rolling mode */}
            <div style={{ display: "flex", alignItems: "center", gap: isCalendarFullscreen ? "4px" : "6px" }}>
              <input
                type="text"
                value={dateSearchInput}
                placeholder="YYYY-MM-DD"
                onChange={(e) => setDateSearchInput(normalizeDateSearchInput(e.target.value))}
                onKeyDown={(e) => { if (e.key === "Enter") applyDateSearch(dateSearchInput); }}
                style={{
                  width: isCalendarFullscreen ? "108px" : "128px",
                  padding: isCalendarFullscreen ? "5px 9px" : "7px 11px",
                  borderRadius: isCalendarFullscreen ? "8px" : "10px",
                  border: isValidDateSearch(dateSearchInput) ? "1.5px solid #0EA5E9" : "1px solid #D1D5DB",
                  fontSize: isCalendarFullscreen ? "11px" : "12px",
                  fontFamily: "monospace",
                  outline: "none",
                  color: "#374151",
                  background: "white",
                  transition: "border-color 0.2s"
                }}
              />
              <button
                onClick={() => applyDateSearch(dateSearchInput)}
                disabled={!isValidDateSearch(dateSearchInput)}
                onMouseEnter={(e) => { if (isValidDateSearch(dateSearchInput)) { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 6px 18px rgba(2,132,199,0.45)"; } }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = isValidDateSearch(dateSearchInput) ? "0 3px 10px rgba(2,132,199,0.30)" : "none"; }}
                style={{
                  padding: isCalendarFullscreen ? "5px 13px" : "7px 16px",
                  borderRadius: isCalendarFullscreen ? "8px" : "10px",
                  border: "none",
                  background: isValidDateSearch(dateSearchInput)
                    ? "linear-gradient(135deg, #38BDF8 0%, #0EA5E9 45%, #0284C7 100%)"
                    : "linear-gradient(135deg, #E5E7EB 0%, #D1D5DB 100%)",
                  color: isValidDateSearch(dateSearchInput) ? "white" : "#9CA3AF",
                  fontSize: isCalendarFullscreen ? "11px" : "12px",
                  fontWeight: "700",
                  letterSpacing: "0.04em",
                  cursor: isValidDateSearch(dateSearchInput) ? "pointer" : "not-allowed",
                  boxShadow: isValidDateSearch(dateSearchInput) ? "0 3px 10px rgba(2,132,199,0.30)" : "none",
                  transition: "all 0.2s"
                }}
              >
                Go
              </button>
              <button
                onClick={handleDateSearchToday}
                onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 6px 18px rgba(16,185,129,0.38)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 3px 10px rgba(16,185,129,0.22)"; }}
                style={{
                  padding: isCalendarFullscreen ? "5px 11px" : "7px 14px",
                  borderRadius: isCalendarFullscreen ? "8px" : "10px",
                  border: "none",
                  background: "linear-gradient(135deg, #34D399 0%, #10B981 50%, #059669 100%)",
                  color: "white",
                  fontSize: isCalendarFullscreen ? "11px" : "12px",
                  fontWeight: "700",
                  letterSpacing: "0.04em",
                  cursor: "pointer",
                  boxShadow: "0 3px 10px rgba(16,185,129,0.22)",
                  transition: "all 0.2s",
                  whiteSpace: "nowrap"
                }}
              >
                Today
              </button>
              {dateSearchInput && (
                <button
                  onClick={() => setDateSearchInput("")}
                  title="Clear"
                  style={{
                    padding: isCalendarFullscreen ? "5px 8px" : "7px 10px",
                    borderRadius: isCalendarFullscreen ? "8px" : "10px",
                    border: "1px solid #E5E7EB",
                    background: "white",
                    color: "#9CA3AF",
                    fontSize: isCalendarFullscreen ? "11px" : "12px",
                    cursor: "pointer",
                    lineHeight: 1,
                    transition: "all 0.2s"
                  }}
                >
                  ✕
                </button>
              )}
            </div>

            {/* 범례 */}
            <div style={{ display: "flex", gap: isCalendarFullscreen ? "12px" : "16px", fontSize: isCalendarFullscreen ? "11px" : "12px", color: "#6B7280" }}>
              <span style={{ display: "flex", alignItems: "center", gap: isCalendarFullscreen ? "5px" : "6px" }}>
                <span style={{
                  width: isCalendarFullscreen ? "12px" : "14px",
                  height: isCalendarFullscreen ? "12px" : "14px",
                  borderRadius: isCalendarFullscreen ? "3px" : "4px",
                  background: PLATFORM_COLORS.Airbnb,
                  boxShadow: "0 2px 4px rgba(242, 163, 165, 0.5)"
                }}></span>
                <span style={{ fontWeight: "500" }}>Airbnb</span>
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: isCalendarFullscreen ? "5px" : "6px" }}>
                <span style={{
                  width: isCalendarFullscreen ? "12px" : "14px",
                  height: isCalendarFullscreen ? "12px" : "14px",
                  borderRadius: isCalendarFullscreen ? "3px" : "4px",
                  background: PLATFORM_COLORS.Booking,
                  boxShadow: "0 2px 4px rgba(143, 220, 221, 0.5)"
                }}></span>
                <span style={{ fontWeight: "500" }}>Booking</span>
              </span>
            </div>
          </div>
        </div>

        {/* 캘린더 슬라이더 */}
        <div style={{
          background: "white",
          borderRadius: "20px",
          boxShadow: "0 10px 25px rgba(0,0,0,0.05)",
          overflow: isCalendarFullscreen ? "hidden" : "visible",
          marginBottom: isCalendarFullscreen ? "0" : "24px",
          border: "1px solid #E5E7EB",
          display: 'flex',
          flexDirection: 'column',
          maxHeight: isCalendarFullscreen ? 'none' : undefined,
          minHeight: isCalendarFullscreen ? '0' : undefined,
          flex: isCalendarFullscreen ? 1 : undefined
        }}>
          {loading && stableDisplayDays.length === 0 ? (
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
            <>
              {!isCalendarFullscreen && (
                <div style={{
                  position: "sticky",
                  top: 74,
                  zIndex: 120,
                  overflow: "hidden",
                  background: "#F9FAFB",
                  boxShadow: "0 1px 0 rgba(226, 232, 240, 0.9)"
                }}>
                  <div
                    ref={calendarHeaderRowRef}
                    style={{
                      overflowX: "hidden",
                      overflowY: "visible"
                    }}
                  >
                    {renderCalendarDateHeader()}
                  </div>
                </div>
              )}
              <div style={{
                overflowX: "auto",
                overflowY: isCalendarFullscreen ? "auto" : "visible",
                flex: isCalendarFullscreen ? 1 : undefined,
                minHeight: isCalendarFullscreen ? 0 : undefined,
                cursor: isDraggingCalendar ? 'grabbing' : 'grab',
                userSelect: 'none'
              }}
                onMouseDown={handleCalendarMouseDown}
                onMouseMove={handleCalendarMouseMove}
                onMouseUp={handleCalendarMouseUp}
                onMouseLeave={handleCalendarMouseUp}
                onScroll={(e) => syncCalendarHeaderScroll(e.currentTarget.scrollLeft)}
                ref={calendarRef}
              >
              <div style={{ minWidth: "max-content" }}>
                {isCalendarFullscreen && (
                  <div style={{
                    position: "sticky",
                    top: 0,
                    zIndex: 100,
                    boxShadow: "0 1px 0 rgba(226, 232, 240, 0.9)"
                  }}>
                    {renderCalendarDateHeader()}
                  </div>
                )}

                {/* 객실 행 */}
                {visibleRooms.length > 0 ? visibleRooms.map((room, roomIndex) => (
                  <div
                    key={room}
                    style={{
                      display: "flex",
                      borderBottom: "1px solid #F3F4F6",
                      minHeight: showBeds24DetailView ? `${BEDS24_DETAIL_ROW_HEIGHT}px` : priceMode ? "60px" : "52px",
                      position: "relative",
                      transition: 'background 0.2s',
                      marginBottom: roomIndex < visibleRooms.length - 1 ? (isMobile ? "2px" : "4px") : "0"
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#F9FAFB'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <div style={{
                      width: showBeds24DetailView ? `${BEDS24_DETAIL_STICKY_WIDTH}px` : "120px",
                      minWidth: showBeds24DetailView ? `${BEDS24_DETAIL_STICKY_WIDTH}px` : "120px",
                      padding: showBeds24DetailView ? "0" : "12px",
                      fontWeight: "700",
                      fontSize: "13px",
                      color: "#334155",
                      borderRight: "1px solid #EDF2F7",
                      background: "#FFFFFF",
                      display: "flex",
                      alignItems: showBeds24DetailView ? "stretch" : "center",
                      gap: showBeds24DetailView ? "0" : "10px",
                      flexDirection: showBeds24DetailView ? "row" : "row",
                      position: 'sticky',
                      left: 0,
                      zIndex: isCalendarFullscreen ? 90 : 35,
                      boxShadow: '1px 0 3px rgba(15,23,42,0.025)'
                    }}>
                      {showBeds24DetailView ? (
                        <div style={{
                          display: "grid",
                          gridTemplateColumns: `${BEDS24_DETAIL_ROOM_NAME_WIDTH}px 1fr`,
                          gridTemplateRows: `${BEDS24_DETAIL_PRICE_TRACK_HEIGHT}px ${BEDS24_DETAIL_MINSTAY_TRACK_HEIGHT}px ${BEDS24_DETAIL_RESERVATION_TRACK_HEIGHT}px`,
                          width: "100%",
                          height: "100%"
                        }}>
                          <div style={{
                            gridColumn: "1 / 2",
                            gridRow: "1 / 4",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: priceMode ? "space-between" : "flex-start",
                            padding: "0 10px",
                            borderRight: "1px solid #F5F7FA",
                            color: "#334155",
                            background: "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.98) 100%)",
                            gap: "8px",
                            cursor: priceMode ? "pointer" : "default",
                            userSelect: "none"
                          }}
                          onClick={priceMode ? (e => {
                            e.stopPropagation();
                            toggleRoomSelection(room);
                          }) : undefined}
                          title={priceMode ? `${selectedRooms.includes(room) ? "Deselect" : "Select"} ${getRoomNameEN(room)}` : undefined}
                          onMouseEnter={priceMode ? (e => {
                            e.currentTarget.style.background = selectedRooms.includes(room)
                              ? "linear-gradient(180deg, rgba(219,234,254,0.92) 0%, rgba(239,246,255,0.96) 100%)"
                              : "linear-gradient(180deg, rgba(248,250,252,1) 0%, rgba(241,245,249,0.98) 100%)";
                          }) : undefined}
                          onMouseLeave={priceMode ? (e => {
                            e.currentTarget.style.background = "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.98) 100%)";
                          }) : undefined}>
                            <span>{getRoomNameEN(room)}</span>
                            {priceMode && (
                              <input
                                type="checkbox"
                                checked={selectedRooms.includes(room)}
                                readOnly
                                tabIndex={-1}
                                style={{
                                  width: '16px',
                                  height: '16px',
                                  cursor: "pointer",
                                  accentColor: '#3B82F6',
                                  flexShrink: 0,
                                  pointerEvents: "none"
                                }}
                              />
                            )}
                          </div>
                          <div style={{
                            display: "flex",
                            alignItems: "center",
                            paddingLeft: "10px",
                            borderTop: "1px solid #F7FAFC",
                            fontSize: "8.5px",
                            fontWeight: "700",
                            color: "#94A3B8",
                            letterSpacing: "0.025em"
                          }}>Airbnb</div>
                          <div style={{
                            display: "flex",
                            alignItems: "center",
                            paddingLeft: "10px",
                            borderTop: "1px solid #F7FAFC",
                            fontSize: "8.5px",
                            fontWeight: "700",
                            color: "#A3B2C4",
                            letterSpacing: "0.025em"
                          }}>Min Stay</div>
                          <div style={{
                            display: "flex",
                            alignItems: "center",
                            paddingLeft: "10px",
                            borderTop: "1px solid #F7FAFC",
                            fontSize: "8.5px",
                            fontWeight: "700",
                            color: "#A3B2C4",
                            letterSpacing: "0.025em"
                          }}>Reservation</div>
                        </div>
                      ) : (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "10px",
                            minHeight: "18px",
                            cursor: priceMode ? "pointer" : "default",
                            userSelect: "none",
                            padding: priceMode ? "4px 6px" : "0",
                            margin: priceMode ? "-4px -6px" : "0",
                            borderRadius: priceMode ? "8px" : "0",
                            transition: "background 0.15s ease"
                          }}
                          onClick={priceMode ? (e => {
                            e.stopPropagation();
                            toggleRoomSelection(room);
                          }) : undefined}
                          title={priceMode ? `${selectedRooms.includes(room) ? "Deselect" : "Select"} ${getRoomNameEN(room)}` : undefined}
                          onMouseEnter={priceMode ? (e => {
                            e.currentTarget.style.background = "rgba(241,245,249,0.95)";
                          }) : undefined}
                          onMouseLeave={priceMode ? (e => {
                            e.currentTarget.style.background = "transparent";
                          }) : undefined}
                        >
                          {priceMode && (
                            <input
                              type="checkbox"
                              checked={selectedRooms.includes(room)}
                              readOnly
                              tabIndex={-1}
                              style={{
                                width: '18px',
                                height: '18px',
                                cursor: "pointer",
                                accentColor: '#3B82F6',
                                pointerEvents: "none"
                              }}
                            />
                          )}
                          <span>{getRoomNameEN(room)}</span>
                        </div>
                      )}
                    </div>
                    <div style={{
                      position: "relative",
                      display: "flex",
                      flex: 1,
                      minWidth: 0
                    }}>
                      {/* 날짜 셀 배열 */}
                      {stableDisplayDays.map((dayInfo, i) => {
                        const day = dayInfo.day;
                        const date = dayInfo.date;
                        const isToday = new Date().toDateString() === date.toDateString();
                        const dateStr = dayInfo.dateStr;
                        const cellKey = getSelectedCellKey(room, dateStr);

                        // 셀 범위 선택: 해당 셀이 selectedCells에 있는지 확인
                        const isSelected = selectedCellKeySet.has(cellKey);

                        // ✅ room 이름 기준 예약 (생성/수정된 ID 관계없이 방 ID 예약 모두 포함)
                        const roomReservations = roomReservationsMap[room] || [];
                        const hasReservation = roomReservations.some(r =>
                          dateStr >= r.arrival && dateStr < r.departure
                        );
                        const hasBlockingReservation = roomReservations.some(r =>
                          dateStr >= r.arrival &&
                          dateStr < r.departure &&
                          r.status !== "cancelled" &&
                          r.status !== "blackout" &&
                          !r.isExternalInventoryBlock &&
                          !r.isInventoryOverrideBlock
                        );
                        const isFullyOccupied = hasReservation;

                        const isGap = !isFullyOccupied && gapCellSet.has(`${room}__${dateStr}`);

                        // 과거 날짜인지 확인
                        const todayDate = new Date();
                        todayDate.setHours(0, 0, 0, 0);
                        const isPastDate = date < todayDate;
                        const dayOfWeek = date.getDay();
                        const isWeekendColumn = dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0;
                        const weekendCellBg = "rgba(255, 241, 246, 0.75)";
                        const weekendTrackBgStrong = "rgba(255, 241, 246, 0.88)";
                        const weekendTrackBgSoft = "rgba(255, 245, 248, 0.92)";

                        const dateKey = dateStr.replace(/-/g, "");

                        // 해당 방의 모든 ID 정보를 가져와서 가격 업데이트 (2개 이상은 경고 표시)
                        // display-only fallback: active room 설정 실패 시 해당 날짜의 실제 가격 데이터가
                        // 있는 roomId 기준 사용. 없으면 전체 roomInfos. 뭘 선택하든 roomInfos 기준 처리.
                        const displayRoomInfos = getDisplayUnitInfosForDate(room, dateStr);
                        const allRoomInfosForDate = roomCatalogByName[room] || [];
                        const pendingPriceCell = pendingPriceCellMap[cellKey];
                        const isPendingPriceCell = !!pendingPriceCell;
                        const mergedChannelPrices = getMergedRoomChannelPrices({
                          primaryUnitInfos: displayRoomInfos,
                          fallbackUnitInfos: allRoomInfosForDate,
                          roomPrices,
                          dateKey
                        });
                        let airbnbPrice = mergedChannelPrices.airbnbPrice;
                        let bookingPrice = mergedChannelPrices.bookingPrice;
                        let minStay = 0;  // 0은 "아직 가격 없음" 의미
                        let hasError = mergedChannelPrices.hasError;
                        let errorMsg = mergedChannelPrices.errorMsg;
                        let lastModInfo = null;

                        displayRoomInfos.forEach(info => {
                          const roomPriceData = roomPrices[info.roomId];
                          if (roomPriceData?.dates?.error && !hasError) {
                            hasError = true;
                            errorMsg = roomPriceData.dates.error;
                          }

                          const priceInfo = roomPriceData?.dates?.[dateKey];
                          if (priceInfo) {
                            const ms = parseInt(priceInfo.m, 10); // 문자열/NaN이면 무시하고 1박 기준으로 처리하지 않음
                            if (Number.isFinite(ms) && ms >= 1 && ms < INACTIVE_MINSTAY_THRESHOLD && (minStay === 0 || ms < minStay)) minStay = ms;
                            if (priceInfo.lm && !lastModInfo) {
                              lastModInfo = priceInfo.lm;
                            }
                          }
                        });

                        if (!lastModInfo) {
                          allRoomInfosForDate.forEach((info) => {
                            if (lastModInfo) return;
                            const fallbackLm = roomPrices?.[info.roomId]?.dates?.[dateKey]?.lm;
                            if (fallbackLm) {
                              lastModInfo = fallbackLm;
                            }
                          });
                        }

                        if (isPendingPriceCell && pendingPriceCell.airbnbPrice > 0) {
                          airbnbPrice = pendingPriceCell.airbnbPrice;
                        }

                        // API 호출 시 발생한 오류 처리
                        if (hasError && airbnbPrice === 0 && bookingPrice === 0) {
                          const isLimitExceeded = errorMsg.includes("limit exceeded");
                          return (
                            <div key={day} style={{ flex: "1 1 0", minWidth: "32px", borderRight: "1px solid #F3F4F6", background: "#FEF2F2", display: "flex", alignItems: "center", justifyContent: "center" }} title={errorMsg}>
                              <span style={{ fontSize: "10px", color: "#EF4444", fontWeight: '700' }}>{isLimitExceeded ? "WAIT" : "ERR"}</span>
                            </div>
                          );
                        }

                        // 선택 가능한지 (예약 유무, 과거 여부)
                        const canEditSelect = (priceMode ? !hasBlockingReservation : !hasReservation) && !isPastDate;
                        const canQuickBookSelect = !priceMode && !gapEditMode && !isPastDate && (
                          !selectionStart
                            ? !hasReservation
                            : selectionStart.room === room
                        );
                        const canSelect = (priceMode || gapEditMode) ? canEditSelect : canQuickBookSelect;
                        const isSelectionStart = selectionStart && selectionStart.room === room && selectionStart.date === dateStr;
                        // 드래그 예약 범위 하이라이트 계산 (dateStr 비교로 빠르게 처리)
                        let isInQuickSelectionRange = false;
                        if (!priceMode && selectionStart && selectionStart.room === room && hoveredDay && hoveredRoom === room) {
                          const startD = selectionStart.date <= hoveredDay ? selectionStart.date : hoveredDay;
                          const endD = selectionStart.date <= hoveredDay ? hoveredDay : selectionStart.date;
                          if (dateStr >= startD && dateStr < endD) {
                            isInQuickSelectionRange = true;
                          }
                        }
                        const isHoveredSelectableCell = showBeds24DetailView &&
                          !priceMode &&
                          !gapEditMode &&
                          canQuickBookSelect &&
                          !isInQuickSelectionRange &&
                          !isSelectionStart &&
                          !isDragging &&
                          hoveredDay === dateStr &&
                          hoveredRoom === room;
                        const isDetailSelectionVisible = showBeds24DetailView &&
                          (isSelected || isSelectionStart || isInQuickSelectionRange || isHoveredSelectableCell);
                        const priceCellHoverText = (priceMode || showBeds24DetailView) && (airbnbPrice || minStay)
                          ? `Airbnb: ¥${airbnbPrice.toLocaleString()}\nMin Stay: ${minStay || 0} nights${isPendingPriceCell ? "\nStatus: Pending sync" : ""}${
                              lastModInfo
                                ? `\n\n[History]\n${lastModInfo.s === 'beds24' ? `Modified in Beds24` : `Modified by: ${lastModInfo.u}`}\nAt: ${lastModInfo.t}\nChange: ¥${lastModInfo.o.toLocaleString()} -> ¥${lastModInfo.n.toLocaleString()}`
                                : ""
                            }`
                          : (isPastDate && priceMode ? "Cannot edit past dates" : "");

                        return (
                          <div
                            key={day}
                            onClick={(e) => {
                              if (canQuickBookSelect && !priceMode && !gapEditMode) {
                                e.stopPropagation();
                                handleDateCellClick(room, dateStr);
                              }
                            }}
                            onMouseDown={(e) => {
                              if (canEditSelect && (priceMode || gapEditMode)) {
                                e.stopPropagation();
                                setIsDragging(true);

                                // 첫 번째 셀 및 이전 선택 처리, 방 추가/제거, 날짜 추가/제거
                                const action = isSelected ? 'deselect' : 'select';
                                setDragAction(action);

                                setSelectedRoom(room);

                                // 셀 범위로 추가/제거
                                  applyCellSelection(room, dateStr, action);
                              }
                            }}
                            style={{
                              flex: "1 1 0",
                              minWidth: "32px",
                              borderRight: "1px solid #F3F4F6",
                              background: isSelectionStart
                                ? "#F59E0B"
                                : isInQuickSelectionRange
                                  ? "rgba(245, 158, 11, 0.15)"
                                  : isSelected
                                    ? (gapEditMode
                                      ? "rgba(139, 92, 246, 0.22)"
                                      : showBeds24DetailView
                                        ? "linear-gradient(180deg, rgba(245, 158, 11, 0.18) 0%, rgba(251, 191, 36, 0.1) 100%)"
                                        : "rgba(245, 158, 11, 0.3)")
                                    : isToday
                                      ? "rgba(59, 130, 246, 0.05)"
                                      : isPastDate
                                        ? (isWeekendColumn ? "rgba(255, 241, 246, 0.6)" : "rgba(248,250,252,0.96)")
                                        : canSelect
                                          ? (isWeekendColumn ? weekendCellBg : "#FFFFFF")
                                          : (isWeekendColumn ? "rgba(255, 241, 246, 0.45)" : "transparent"),
                              cursor: canSelect ? "pointer" : "default",
                              display: "flex",
                              flexDirection: "column",
                              alignItems: showBeds24DetailView ? "stretch" : "center",
                              justifyContent: showBeds24DetailView ? "stretch" : "center",
                              transition: "all 0.1s ease",
                              position: "relative",
                              opacity: isPastDate ? (showBeds24DetailView ? 0.64 : 0.72) : 1,
                              zIndex: isSelectionStart || isInQuickSelectionRange || isSelected ? 5 : 1,
                              outline: showBeds24DetailView
                                ? "none"
                                : isSelected
                                ? (gapEditMode ? "2px solid #8B5CF6" : "2px solid #F59E0B")
                                : "none",
                              outlineOffset: "-2px"
                            }}
                            onMouseEnter={(e) => {
                              if (canQuickBookSelect && !priceMode && !gapEditMode) {
                                setHoveredDay(dateStr);
                                setHoveredRoom(room);
                              }
                              if (canEditSelect && (priceMode || gapEditMode)) {
                                setHoveredDay(dateStr);
                                setHoveredRoom(room);

                                // 드래그 중이면 선택/해제 처리 (priceMode 또는 gapEditMode)
                                if (isDragging && (priceMode || gapEditMode) && dragAction) {
                                  // 셀 범위로 추가/제거
                                    applyCellSelection(room, dateStr, dragAction);
                                }
                              }
                              if (!showBeds24DetailView && canSelect && !isSelected && !isInQuickSelectionRange && !isSelectionStart && !isDragging) {
                                e.currentTarget.style.background = gapEditMode ? "rgba(139, 92, 246, 0.1)" : "rgba(245, 158, 11, 0.08)";
                              }
                              if (priceCellHoverText) {
                                updatePriceCellTooltip({
                                  text: priceCellHoverText,
                                  x: e.clientX + 14,
                                  y: e.clientY + 14
                                });
                              } else {
                                clearPriceCellTooltip();
                              }
                            }}
                            onMouseMove={(e) => {
                              if (!priceCellHoverText) return;
                              updatePriceCellTooltip({
                                text: priceCellHoverText,
                                x: e.clientX + 14,
                                y: e.clientY + 14
                              });
                            }}
                            onMouseLeave={(e) => {
                              if (canSelect) {
                                setHoveredDay(null);
                                setHoveredRoom(null);
                              }
                              if (!showBeds24DetailView && canSelect && !isSelected && !isInQuickSelectionRange && !isSelectionStart) {
                                e.currentTarget.style.background = isToday
                                  ? "rgba(59, 130, 246, 0.05)"
                                  : (isWeekendColumn ? weekendCellBg : "#FFFFFF");
                              }
                              clearPriceCellTooltip();
                            }}
                          >
                            {showBeds24DetailView && (
                              <div style={{
                                display: "grid",
                                gridTemplateRows: `${BEDS24_DETAIL_PRICE_TRACK_HEIGHT}px ${BEDS24_DETAIL_MINSTAY_TRACK_HEIGHT}px ${BEDS24_DETAIL_RESERVATION_TRACK_HEIGHT}px`,
                                width: "100%",
                                height: "100%"
                              }}>
                                <div style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  borderTop: "1px solid rgba(226, 232, 240, 0.9)",
                                  background: isWeekendColumn ? weekendTrackBgStrong : "rgba(255,255,255,0.78)",
                                  color: isPendingPriceCell ? "#4C51BF" : "#1F2937",
                                  fontSize: "13.5px",
                                  fontWeight: "400",
                                  letterSpacing: "0",
                                  fontFamily: CALENDAR_NUMERIC_FONT_FAMILY,
                                  fontVariantNumeric: "tabular-nums lining-nums",
                                  fontFeatureSettings: '"tnum" 1, "lnum" 1',
                                  position: "relative"
                                }}>
                                  {formatCalendarPriceShort(airbnbPrice)}
                                  {lastModInfo && (
                                    <div style={{
                                      position: "absolute",
                                      top: "2px",
                                      right: "2px",
                                      width: "4px",
                                      height: "4px",
                                      minWidth: "4px",
                                      minHeight: "4px",
                                      maxWidth: "4px",
                                      maxHeight: "4px",
                                      borderRadius: "50%",
                                      background: lastModInfo.s === 'beds24' ? "#EF4444" : "#2563EB",
                                      boxShadow: "none",
                                      border: "none",
                                      outline: "none",
                                      pointerEvents: "none"
                                    }} />
                                  )}
                                </div>
                                <div style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  borderTop: "1px solid rgba(226, 232, 240, 0.9)",
                                  background: isGap
                                    ? "linear-gradient(135deg, rgba(254,226,226,0.82) 0%, rgba(254,202,202,0.72) 100%)"
                                    : minStay === 1
                                      ? "linear-gradient(135deg, rgba(209,250,229,0.74) 0%, rgba(167,243,208,0.62) 100%)"
                                      : (isWeekendColumn ? "rgba(255, 241, 246, 0.78)" : "rgba(248,250,252,0.72)"),
                                  color: isGap
                                    ? "#DC6A6A"
                                    : minStay === 1
                                      ? "#2F8F73"
                                      : "#64748B",
                                  fontSize: "8.5px",
                                  fontWeight: "700",
                                  letterSpacing: "0.02em",
                                  textShadow: "0 1px 0 rgba(255,255,255,0.6)"
                                }}
                                title={minStay > 0
                                  ? (() => {
                                      const _gi = (!isFullyOccupied && minStay >= 2) ? (gapInfoByCellKey[`${room}__${dateStr}`] || null) : null;
                                      return _gi
                                        ? `nights:${_gi.availableNightsFromDate} gap:${_gi.isOneNightMinStayGap} roomId:${_gi.resolvedRoomId} curr:${_gi.currentDateStatus}/${_gi.currentDateReason} prev:${_gi.previousDateStr} ${_gi.previousDateStatus}/${_gi.previousDateReason} next:${_gi.nextDateStr} ${_gi.nextDateStatus}/${_gi.nextDateReason}`
                                        : `minStay:${minStay}`;
                                    })()
                                  : undefined}
                                >
                                  {minStay > 0 ? minStay : "—"}
                                </div>
                                <div style={{
                                  position: "relative",
                                  borderTop: "1px solid rgba(226, 232, 240, 0.95)",
                                  background: hasReservation
                                    ? (isWeekendColumn
                                      ? "linear-gradient(180deg, rgba(255,242,247,0.92) 0%, rgba(255,236,244,0.96) 100%)"
                                      : "linear-gradient(180deg, rgba(248,250,252,0.9) 0%, rgba(241,245,249,0.96) 100%)")
                                    : (isWeekendColumn ? weekendTrackBgSoft : "rgba(255,255,255,0.92)")
                                }}>
                                  {!hasReservation && canQuickBookSelect && (
                                    <div style={{
                                      position: "absolute",
                                      inset: 0,
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      pointerEvents: "none",
                                      zIndex: 1
                                    }}>
                                      <div style={{
                                        width: "20px",
                                        height: "20px",
                                        borderRadius: "999px",
                                        border: "1px dashed rgba(148, 163, 184, 0.22)",
                                        background: "rgba(148, 163, 184, 0.04)",
                                        color: "rgba(100, 116, 139, 0.35)",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        fontSize: "13px",
                                        fontWeight: "700",
                                        lineHeight: 1,
                                        boxShadow: "none"
                                      }}>
                                        +
                                      </div>
                                    </div>
                                  )}
                                  {pricesLoading && airbnbPrice === 0 && bookingPrice === 0 && !hasError && (
                                    <div style={{
                                      position: "absolute",
                                      top: "6px",
                                      left: "50%",
                                      transform: "translateX(-50%)",
                                      fontSize: "9px",
                                      fontWeight: "700",
                                      color: "#94A3B8",
                                      pointerEvents: "none"
                                    }}>
                                      ...
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                            {/* Price Display - Enhanced Readability */}
                            {!showBeds24DetailView && priceMode && !hasBlockingReservation && airbnbPrice > 0 && (
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
                                  color: isPendingPriceCell ? "#4338CA" : "#1F2937",
                                  fontSize: "13px",
                                  fontWeight: "800",
                                  textAlign: "center",
                                  lineHeight: "1",
                                  letterSpacing: "-0.02em",
                                  fontFamily: CALENDAR_NUMERIC_FONT_FAMILY,
                                  fontVariantNumeric: "tabular-nums lining-nums",
                                  fontFeatureSettings: '"tnum" 1, "lnum" 1',
                                  position: "relative"
                                }}>
                                  {`${(airbnbPrice / 1000).toFixed(airbnbPrice % 1000 === 0 ? 0 : 1)}K`}
                                  {lastModInfo && (
                                    <div style={{
                                      position: "absolute",
                                      top: "2px",
                                      right: "2px",
                                      width: "4px",
                                      height: "4px",
                                      minWidth: "4px",
                                      minHeight: "4px",
                                      maxWidth: "4px",
                                      maxHeight: "4px",
                                      borderRadius: "50%",
                                      background: lastModInfo.s === 'beds24' ? "#EF4444" : "#2563EB",
                                      boxShadow: "none",
                                      border: "none",
                                      outline: "none",
                                      pointerEvents: "none"
                                    }} />
                                  )}
                                </div>
                                {isPendingPriceCell && (
                                  <div style={{
                                    minWidth: "24px",
                                    height: "14px",
                                    padding: "0 4px",
                                    background: "linear-gradient(135deg, rgba(79,70,229,0.18) 0%, rgba(99,102,241,0.12) 100%)",
                                    color: "#4338CA",
                                    border: "1px solid rgba(79,70,229,0.2)",
                                    borderRadius: "999px",
                                    fontSize: "9px",
                                    fontWeight: "800",
                                    letterSpacing: "0.02em",
                                    lineHeight: "12px",
                                    textAlign: "center"
                                  }}>
                                    Sync
                                  </div>
                                )}
                                {/* Min Stay Badge (read-only 가격설정 및 확인 액션바에서) */}
                                {minStay > 0 && (() => {
                                  const _gi = (!isFullyOccupied && minStay >= 2) ? (gapInfoByCellKey[`${room}__${dateStr}`] || null) : null;
                                  return (
                                  <div
                                    title={_gi
                                      ? `nights:${_gi.availableNightsFromDate} gap:${_gi.isOneNightMinStayGap} roomId:${_gi.resolvedRoomId} curr:${_gi.currentDateStatus}/${_gi.currentDateReason} prev:${_gi.previousDateStr} ${_gi.previousDateStatus}/${_gi.previousDateReason} next:${_gi.nextDateStr} ${_gi.nextDateStatus}/${_gi.nextDateReason}`
                                      : `minStay:${minStay}`}
                                    style={{
                                      minWidth: "18px",
                                      height: "16px",
                                      padding: "0 3px",
                                      background: isGap
                                        ? "linear-gradient(135deg, #FEE2E2 0%, #FECACA 100%)"
                                        : minStay === 1
                                          ? "linear-gradient(135deg, #D1FAE5 0%, #A7F3D0 100%)"
                                          : "linear-gradient(135deg, #F3F4F6 0%, #E5E7EB 100%)",
                                      color: isGap
                                        ? "#DC2626"
                                        : minStay === 1
                                          ? "#059669"
                                          : "#64748B",
                                      borderRadius: "4px",
                                      fontSize: "11px",
                                      fontWeight: "800",
                                      textAlign: "center",
                                      lineHeight: "16px",
                                      letterSpacing: "0.01em",
                                      textShadow: "0 1px 0 rgba(255,255,255,0.6)",
                                      boxShadow: "0 1px 2px rgba(0,0,0,0.1)"
                                    }}
                                  >
                                    {minStay}
                                  </div>
                                  );
                                })()}
                              </div>
                            )}
                            {/* 가격 로딩 표시 */}
                            {!showBeds24DetailView && priceMode && !hasReservation && airbnbPrice === 0 && pricesLoading && !hasError && (
                              <div style={{
                                fontSize: "10px",
                                fontWeight: "700",
                                color: "#9CA3AF",
                                lineHeight: 1
                              }}>
                                ...
                              </div>
                            )}
                            {isDetailSelectionVisible && (
                              <div
                                style={{
                                  position: "absolute",
                                  inset: 0,
                                  pointerEvents: "none",
                                  background: isSelectionStart
                                    ? "linear-gradient(180deg, rgba(245, 158, 11, 0.26) 0%, rgba(251, 191, 36, 0.16) 100%)"
                                    : isSelected
                                      ? (gapEditMode
                                        ? "linear-gradient(180deg, rgba(139, 92, 246, 0.2) 0%, rgba(196, 181, 253, 0.12) 100%)"
                                        : "linear-gradient(180deg, rgba(245, 158, 11, 0.22) 0%, rgba(251, 191, 36, 0.14) 100%)")
                                    : isInQuickSelectionRange
                                      ? "rgba(245, 158, 11, 0.14)"
                                      : "rgba(245, 158, 11, 0.08)",
                                  boxShadow: isSelectionStart
                                    ? "inset 0 0 0 2px #F59E0B, inset 0 0 0 1px rgba(251,191,36,0.65)"
                                    : isSelected
                                      ? (gapEditMode
                                        ? "inset 0 0 0 2px #8B5CF6, inset 0 0 0 1px rgba(196,181,253,0.55)"
                                        : "inset 0 0 0 2px #F59E0B, inset 0 0 0 1px rgba(251,191,36,0.7)")
                                    : isInQuickSelectionRange
                                      ? "inset 0 0 0 2px rgba(245, 158, 11, 0.55)"
                                      : "inset 0 0 0 2px rgba(245, 158, 11, 0.45)",
                                  zIndex: 2
                                }}
                              />
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
                )) : (
                  <div style={{
                    padding: "28px 24px",
                    color: "#64748B",
                    fontSize: "13px",
                    fontWeight: "600",
                    background: "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.96) 100%)",
                    borderBottom: "1px solid #F3F4F6"
                  }}>
                    No rooms are vacant today.
                  </div>
                )}
              </div>
              </div>
            </>
          )}
        </div>
        </div>
        )}

        {/* 건물 통계 섹션 (전체 보기 아닌 경우만) - Premium Design */}
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
              gridTemplateColumns: isMobile ? "1fr" : "1.2fr 1.2fr 1fr 1fr",
              gap: "12px",
              alignItems: "stretch"
            }}>
              <div style={{
                order: 8,
                alignSelf: "start",
                gridColumn: isMobile ? "auto" : "3",
                gridRow: isMobile ? "auto" : "2",
                background: "white",
                borderRadius: "16px",
                padding: "14px 16px",
                minHeight: "132px",
                border: "1px solid #E5E7EB",
                boxShadow: "0 2px 8px rgba(0,0,0,0.04)"
              }}>
                <div style={{ fontSize: "13px", color: "#6B7280", fontWeight: "500", marginBottom: "8px" }}>Monthly Occupancy</div>
                <div style={{ fontSize: "28px", fontWeight: "700", color: "#3B82F6" }}>{singleAnalysis.occupancyRate.toFixed(1)}%</div>
                <div style={{ fontSize: "12px", color: "#9CA3AF", marginTop: "4px" }}>Reserved / Total room nights</div>
              </div>
              <div style={{
                order: 9,
                alignSelf: "start",
                gridColumn: isMobile ? "auto" : "4",
                gridRow: isMobile ? "auto" : "3",
                background: "white",
                borderRadius: "16px",
                padding: "14px 16px",
                minHeight: "132px",
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
                order: 3,
                gridColumn: isMobile ? "auto" : "3",
                gridRow: isMobile ? "auto" : "3",
                background: "linear-gradient(135deg, #FFFFFF 0%, #F0FDFA 100%)",
                borderRadius: "16px",
                padding: "14px 16px",
                minHeight: "132px",
                border: "1px solid #CCFBF1",
                boxShadow: "0 2px 8px rgba(0,0,0,0.04)"
              }}>
                <div style={{ fontSize: "13px", color: "#6B7280", fontWeight: "500", marginBottom: "8px" }}>Future Vacancy <span style={{ fontSize: "10px", color: "#9CA3AF" }}>(visible range)</span></div>
                <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
                  <span style={{ fontSize: "28px", fontWeight: "800", color: "#0F766E" }}>{futureVacancySummary.vacantRoomNights}</span>
                  <span style={{ fontSize: "12px", fontWeight: "700", color: "#5EEAD4" }}>room nights</span>
                </div>
                <div style={{ fontSize: "12px", color: "#9CA3AF", marginTop: "4px" }}>
                  {futureVacancySummary.days > 0
                    ? `${futureVacancySummary.days} days from today · avg ${futureVacancySummary.avgVacantRooms.toFixed(1)} rooms/day`
                    : "No future dates in current view"}
                </div>
                <div style={{ fontSize: "11px", color: "#94A3B8", marginTop: "3px" }}>
                  {futureVacancySummary.totalRoomNights} total room nights checked
                </div>
              </div>
              <div style={{
                order: 5,
                gridColumn: isMobile ? "auto" : "span 2",
                gridRow: isMobile ? "auto" : "1 / span 3",
                background: "linear-gradient(135deg, #FFFFFF 0%, #F8FAFC 100%)",
                borderRadius: "16px",
                padding: "14px 16px",
                border: "1px solid #E5E7EB",
                boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
                boxSizing: "border-box"
              }}>
                <div style={{ fontSize: "13px", color: "#6B7280", fontWeight: "500", marginBottom: "10px" }}>Rate Summary</div>
                <div style={{ display: "grid", gap: "9px", padding: "0 2px", boxSizing: "border-box" }}>
                  <div>
                    <div style={{ fontSize: "11px", color: "#9CA3AF", fontWeight: "700", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: "3px" }}>Booked ADR</div>
                    <div style={{ fontSize: "26px", fontWeight: "700", color: "#8B5CF6" }}>{formatPrice(singleAnalysis.avgPrice)}</div>
                    <div style={{ fontSize: "11px", color: "#9CA3AF", marginTop: "2px" }}>Realized booked rate (incl. OTA fees)</div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: "10px", padding: "8px 10px", boxSizing: "border-box" }}>
                      <div style={{ fontSize: "10px", color: "#94A3B8", fontWeight: "700", letterSpacing: "0.04em", textTransform: "uppercase" }}>Displayed Avg Price</div>
                      <div style={{ fontSize: "16px", fontWeight: "700", color: "#334155", marginTop: "3px" }}>
                        {(weekdayWeekendRateSummary.weekdayCells + weekdayWeekendRateSummary.weekendCells) > 0 ? formatPrice(displayedAvgPrice) : "-"}
                      </div>
                    </div>
                    <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: "10px", padding: "8px 10px", boxSizing: "border-box" }}>
                      <div style={{ fontSize: "10px", color: "#B45309", fontWeight: "700", letterSpacing: "0.04em", textTransform: "uppercase" }}>Gap (Displayed - Booked)</div>
                      <div style={{ fontSize: "16px", fontWeight: "700", color: displayedVsBookedGap >= 0 ? "#B45309" : "#1D4ED8", marginTop: "3px" }}>
                        {`${displayedVsBookedGap >= 0 ? "+" : "-"}${formatPrice(Math.abs(displayedVsBookedGap))}`}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: "10px", padding: "8px 10px", boxSizing: "border-box" }}>
                      <div style={{ fontSize: "10px", color: "#94A3B8", fontWeight: "700", letterSpacing: "0.04em", textTransform: "uppercase" }}>Weekday ADR</div>
                      <div style={{ fontSize: "16px", fontWeight: "700", color: "#334155", marginTop: "3px" }}>
                        {weekdayWeekendRateSummary.weekdayCells > 0 ? formatPrice(weekdayWeekendRateSummary.weekdayAvg) : "-"}
                      </div>
                    </div>
                    <div style={{ background: "#FFF7F7", border: "1px solid #FEE2E2", borderRadius: "10px", padding: "8px 10px", boxSizing: "border-box" }}>
                      <div style={{ fontSize: "10px", color: "#F87171", fontWeight: "700", letterSpacing: "0.04em", textTransform: "uppercase" }}>Weekend ADR (Fri-Sun)</div>
                      <div style={{ fontSize: "16px", fontWeight: "700", color: "#B91C1C", marginTop: "3px" }}>
                        {weekdayWeekendRateSummary.weekendCells > 0 ? formatPrice(weekdayWeekendRateSummary.weekendAvg) : "-"}
                      </div>
                    </div>
                  </div>
                  <div style={{ height: "1px", background: "#E5E7EB", margin: "0 2px" }}></div>
                  <div>
                    <div style={{ fontSize: "11px", color: "#9CA3AF", fontWeight: "700", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: "3px" }}>Airbnb Price Range</div>
                    <div style={{ fontSize: "20px", fontWeight: "700", color: "#EF4444" }}>
                      {singleAnalysis.minPrice >= 0 ? `${formatPrice(singleAnalysis.minPrice)} ~ ${formatPrice(singleAnalysis.maxPrice)}` : "-"}
                    </div>
                    <div style={{ fontSize: "11px", color: "#9CA3AF", marginTop: "2px" }}>Available rooms only</div>
                  </div>
                  <div style={{ height: "1px", background: "#E5E7EB", margin: "0 2px" }}></div>
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: "8px"
                  }}>
                    <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: "9px", padding: "7px 9px", boxSizing: "border-box" }}>
                      <div style={{ fontSize: "10px", color: "#94A3B8", fontWeight: "700", textTransform: "uppercase" }}>Vacant Nights</div>
                      <div style={{ fontSize: "15px", fontWeight: "800", color: "#0F766E", marginTop: "2px" }}>
                        {singleAnalysis.vacantNights ?? 0}
                      </div>
                    </div>
                    <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: "9px", padding: "7px 9px", boxSizing: "border-box" }}>
                      <div style={{ fontSize: "10px", color: "#94A3B8", fontWeight: "700", textTransform: "uppercase" }}>Displayed Cells</div>
                      <div style={{ fontSize: "15px", fontWeight: "800", color: "#334155", marginTop: "2px" }}>
                        {weekdayWeekendRateSummary.weekdayCells + weekdayWeekendRateSummary.weekendCells}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div style={{
                order: 4,
                gridColumn: isMobile ? "auto" : "4",
                gridRow: isMobile ? "auto" : "2",
                background: "white",
                borderRadius: "16px",
                padding: "14px 16px",
                minHeight: "132px",
                border: "1px solid #E5E7EB",
                boxShadow: "0 2px 8px rgba(0,0,0,0.04)"
              }}>
                <div style={{ fontSize: "13px", color: "#6B7280", fontWeight: "500", marginBottom: "8px" }}>Est. Revenue <span style={{ fontSize: "10px", color: "#9CA3AF" }}>(incl. OTA fees)</span></div>
                <div style={{ fontSize: "28px", fontWeight: "700", color: "#10B981" }}>{formatPrice(singleAnalysis.totalRevenue)}</div>
                <div style={{ fontSize: "12px", color: "#9CA3AF", marginTop: "4px" }}>{reservations.length} reservations</div>
              </div>
              <div style={{
                order: 6,
                alignSelf: "start",
                gridColumn: isMobile ? "auto" : "3",
                gridRow: isMobile ? "auto" : "1",
                background: "linear-gradient(135deg, #FFFFFF 0%, #F8FAFC 100%)",
                borderRadius: "16px",
                padding: "14px 16px",
                border: "1px solid #E5E7EB",
                boxShadow: "0 2px 8px rgba(0,0,0,0.04)"
              }}>
                <div style={{ fontSize: "13px", color: "#6B7280", fontWeight: "500", marginBottom: "10px" }}>OTA Fees <span style={{ fontSize: "10px", color: "#9CA3AF" }}>(visible range)</span></div>
                <div style={{ display: "grid", gap: "7px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: "7px", fontSize: "12px", fontWeight: "600", color: "#64748B" }}>
                      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: PLATFORM_COLORS.Airbnb }}></span>
                      Airbnb
                    </span>
                    <span style={{ fontSize: "15px", fontWeight: "700", color: "#E15B74" }}>{formatPrice(commissionSummary.airbnb)}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: "7px", fontSize: "12px", fontWeight: "600", color: "#64748B" }}>
                      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: PLATFORM_COLORS.Booking }}></span>
                      Booking
                    </span>
                    <span style={{ fontSize: "15px", fontWeight: "700", color: "#5B84E5" }}>{formatPrice(commissionSummary.booking)}</span>
                  </div>
                  <div style={{ height: "1px", background: "#E5E7EB", margin: "2px 0" }}></div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                    <span style={{ fontSize: "12px", fontWeight: "700", color: "#334155" }}>Total</span>
                    <span style={{ fontSize: "18px", fontWeight: "800", color: "#0F172A" }}>{formatPrice(commissionSummary.total)}</span>
                  </div>
                </div>
              </div>
              <div style={{
                order: 7,
                alignSelf: "start",
                gridColumn: isMobile ? "auto" : "4",
                gridRow: isMobile ? "auto" : "1",
                background: "linear-gradient(135deg, #FFFFFF 0%, #F8FAFC 100%)",
                borderRadius: "16px",
                padding: "14px 16px",
                border: "1px solid #E5E7EB",
                boxShadow: "0 2px 8px rgba(0,0,0,0.04)"
              }}>
                <div style={{ fontSize: "13px", color: "#6B7280", fontWeight: "500", marginBottom: "10px" }}>Reservations <span style={{ fontSize: "10px", color: "#9CA3AF" }}>(arrival date)</span></div>
                <div style={{ display: "grid", gap: "7px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: "7px", fontSize: "12px", fontWeight: "600", color: "#64748B" }}>
                      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: PLATFORM_COLORS.Airbnb }}></span>
                      Airbnb
                    </span>
                    <span style={{ fontSize: "15px", fontWeight: "700", color: "#E15B74" }}>{arrivalCountSummary.airbnb}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: "7px", fontSize: "12px", fontWeight: "600", color: "#64748B" }}>
                      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: PLATFORM_COLORS.Booking }}></span>
                      Booking
                    </span>
                    <span style={{ fontSize: "15px", fontWeight: "700", color: "#5B84E5" }}>{arrivalCountSummary.booking}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: "7px", fontSize: "12px", fontWeight: "600", color: "#64748B" }}>
                      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: PLATFORM_COLORS.Direct }}></span>
                      Direct
                    </span>
                    <span style={{ fontSize: "15px", fontWeight: "700", color: "#00A7D8" }}>{arrivalCountSummary.direct}</span>
                  </div>
                  <div style={{ height: "1px", background: "#E5E7EB", margin: "2px 0" }}></div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                    <span style={{ fontSize: "12px", fontWeight: "700", color: "#334155" }}>Total</span>
                    <span style={{ fontSize: "18px", fontWeight: "800", color: "#0F172A" }}>{arrivalCountSummary.total}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 범례 (전체 보기 아닌 경우만) - Premium Design */}
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
              <span style={{ width: "16px", height: "16px", borderRadius: "5px", background: PLATFORM_COLORS.Airbnb, boxShadow: "0 2px 4px rgba(242, 163, 165, 0.5)" }}></span>
              <span style={{ fontWeight: "500" }}>Airbnb</span>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ width: "16px", height: "16px", borderRadius: "5px", background: PLATFORM_COLORS.Booking, boxShadow: "0 2px 4px rgba(143, 220, 221, 0.5)" }}></span>
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
