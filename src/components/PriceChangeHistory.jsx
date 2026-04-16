import React, { useState, useEffect, useMemo, useDeferredValue, useCallback } from 'react';
import { collection, query, where, orderBy, limit, getDocs, startAfter } from "firebase/firestore";
import { db } from '../firebase';
import { useUser } from '../contexts/UserContext';
import { BUILDING_NAMES_EN, ACTIVE_BUILDING_ORDER } from '../constants/buildingData';
import { buildPriceAttributionResult } from '../utils/priceAttribution';

function PriceChangeHistory() {
    const { companyId } = useUser();
    const [logs, setLogs] = useState([]);
    const [reservations, setReservations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [reservationsLoading, setReservationsLoading] = useState(true);
    const [expandedId, setExpandedId] = useState(null);
    const [buildingFilter, setBuildingFilter] = useState("all");
    const [originFilter, setOriginFilter] = useState("all");
    const [groupBy, setGroupBy] = useState("date");
    const [dateFromFilter, setDateFromFilter] = useState("");
    const [dateToFilter, setDateToFilter] = useState("");
    const deferredDateFromFilter = useDeferredValue(dateFromFilter);
    const deferredDateToFilter = useDeferredValue(dateToFilter);
    const showConversionOnly = originFilter === "conversion";
    const HISTORY_REFRESH_INTERVAL_MS = 30000;
    const HISTORY_PAGE_SIZE = 1000;
    const HISTORY_MAX_PAGES = 12;

    const getTokyoDateKey = (ts) => {
        if (!ts) return "Unknown";
        const date = ts.toDate ? ts.toDate() : new Date(ts);
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Tokyo",
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }).formatToParts(date);
        const year = parts.find((part) => part.type === "year")?.value;
        const month = parts.find((part) => part.type === "month")?.value;
        const day = parts.find((part) => part.type === "day")?.value;
        return year && month && day ? `${year}-${month}-${day}` : "Unknown";
    };

    const normalizeDateInput = (value) => {
        const digits = String(value || "").replace(/\D/g, "").slice(0, 8);
        if (digits.length <= 4) return digits;
        if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
        return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
    };

    const isFullDateValue = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));

    const getValidatedDateFilter = (value) => {
        const normalized = String(value || "").trim();
        if (!isFullDateValue(normalized)) return null;
        const [year, month, day] = normalized.split("-").map(Number);
        const date = new Date(Date.UTC(year, month - 1, day));
        if (
            date.getUTCFullYear() !== year ||
            date.getUTCMonth() !== month - 1 ||
            date.getUTCDate() !== day
        ) {
            return null;
        }
        return normalized;
    };

    const getTokyoTodayKey = () => getTokyoDateKey(new Date());

    const fetchLogs = useCallback(async ({ silent = false } = {}) => {
        if (!companyId) return;
        if (!silent) setLoading(true);
        try {
            let collected = [];
            let lastDoc = null;

            for (let page = 0; page < HISTORY_MAX_PAGES; page += 1) {
                const constraints = [
                    where("companyId", "==", companyId),
                    orderBy("timestamp", "desc"),
                    limit(HISTORY_PAGE_SIZE)
                ];
                if (lastDoc) constraints.push(startAfter(lastDoc));

                const q = query(collection(db, "price_change_logs"), ...constraints);
                const snapshot = await getDocs(q);
                if (snapshot.empty) break;

                collected = collected.concat(
                    snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
                );

                if (snapshot.docs.length < HISTORY_PAGE_SIZE) break;
                lastDoc = snapshot.docs[snapshot.docs.length - 1];
            }

            const data = collected.sort((a, b) => {
                const aMs = a?.timestamp?.toMillis?.() || 0;
                const bMs = b?.timestamp?.toMillis?.() || 0;
                return bMs - aMs;
            });
            setLogs(data);
        } catch (error) {
            console.error("Error fetching price logs:", error);
        } finally {
            setLoading(false);
        }
    }, [companyId]);

    const fetchReservations = useCallback(async ({ silent = false } = {}) => {
        if (!companyId) return;
        if (!silent) setReservationsLoading(true);
        try {
            // 최신 예약 우선 조회 (bookDate 인덱스가 없으면 fallback)
            let collected = [];
            try {
                let lastDoc = null;
                for (let page = 0; page < HISTORY_MAX_PAGES; page += 1) {
                    const constraints = [
                        where("companyId", "==", companyId),
                        where("status", "==", "confirmed"),
                        where("bookDate", ">=", "2026-04-11"),
                        orderBy("bookDate", "desc"),
                        limit(HISTORY_PAGE_SIZE)
                    ];
                    if (lastDoc) constraints.push(startAfter(lastDoc));

                    const newestQuery = query(collection(db, "reservations"), ...constraints);
                    const snapshot = await getDocs(newestQuery);
                    if (snapshot.empty) break;

                    collected = collected.concat(
                        snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
                    );

                    if (snapshot.docs.length < HISTORY_PAGE_SIZE) break;
                    lastDoc = snapshot.docs[snapshot.docs.length - 1];
                }
            } catch (indexedQueryError) {
                console.warn("Reservation newest query fallback:", indexedQueryError?.message || indexedQueryError);
                collected = [];
                let lastDoc = null;
                for (let page = 0; page < HISTORY_MAX_PAGES; page += 1) {
                    const constraints = [
                        where("companyId", "==", companyId),
                        where("status", "==", "confirmed"),
                        limit(HISTORY_PAGE_SIZE)
                    ];
                    if (lastDoc) constraints.push(startAfter(lastDoc));

                    const fallbackQuery = query(collection(db, "reservations"), ...constraints);
                    const snapshot = await getDocs(fallbackQuery);
                    if (snapshot.empty) break;

                    collected = collected.concat(
                        snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
                    );

                    if (snapshot.docs.length < HISTORY_PAGE_SIZE) break;
                    lastDoc = snapshot.docs[snapshot.docs.length - 1];
                }
            }

            const dedupedMap = new Map();
            collected.forEach((row) => {
                if (!row?.id) return;
                dedupedMap.set(row.id, row);
            });
            const data = Array.from(dedupedMap.values());
            setReservations(data);
        } catch (error) {
            console.error("Error fetching reservations for attribution:", error);
        } finally {
            setReservationsLoading(false);
        }
    }, [companyId]);

    useEffect(() => {
        if (!companyId) return;
        let disposed = false;

        const refreshAll = async ({ silent = true } = {}) => {
            if (disposed) return;
            await Promise.all([
                fetchLogs({ silent }),
                fetchReservations({ silent })
            ]);
        };

        refreshAll({ silent: false });

        const intervalId = setInterval(() => {
            refreshAll({ silent: true });
        }, HISTORY_REFRESH_INTERVAL_MS);

        const handleFocus = () => refreshAll({ silent: true });
        const handleVisibility = () => {
            if (document.visibilityState === "visible") {
                refreshAll({ silent: true });
            }
        };

        window.addEventListener("focus", handleFocus);
        document.addEventListener("visibilitychange", handleVisibility);

        return () => {
            disposed = true;
            clearInterval(intervalId);
            window.removeEventListener("focus", handleFocus);
            document.removeEventListener("visibilitychange", handleVisibility);
        };
    }, [companyId, fetchLogs, fetchReservations]);

    const filteredLogs = useMemo(() => {
        let result = logs;
        const validDateFrom = getValidatedDateFilter(deferredDateFromFilter);
        const validDateTo = getValidatedDateFilter(deferredDateToFilter);

        // 방어 필터: 실제 가격 변동이 없는 로그 제외 (minStay/numAvail 단독 변경 잔존 데이터 대응)
        result = result.filter(log => {
            // priceSnapshot이 있으면 그 안에 oldPrice != newPrice 항목이 하나라도 있어야 함
            if (Array.isArray(log.priceSnapshot) && log.priceSnapshot.length > 0) {
                return log.priceSnapshot.some(p => p.oldPrice !== p.newPrice);
            }
            // priceSnapshot 없어도 oldPrice/newPrice 필드가 다르면 유지
            if (log.oldPrice != null && log.newPrice != null) {
                return log.oldPrice !== log.newPrice;
            }
            // 가격 정보가 전혀 없는 로그는 제외
            return false;
        });

        if (buildingFilter !== "all") {
            result = result.filter(log => log.building === buildingFilter);
        }
        if (originFilter !== "all") {
            if (originFilter === "beds24") {
                result = result.filter(log => log.origin?.includes("Beds24") || log.origin?.includes("외부"));
            } else if (originFilter === "admin") {
                result = result.filter(log => log.origin === "관리자 대시보드" || log.origin === "queue_worker");
            } else if (originFilter === "conversion") {
                // conversion 전용 뷰에서는 가격 로그 필터를 추가로 좁히지 않음
            }
        }
        if (validDateFrom || validDateTo) {
            result = result.filter((log) => {
                const logDateKey = getTokyoDateKey(log.timestamp);
                if (!logDateKey || logDateKey === "Unknown") return false;
                if (validDateFrom && logDateKey < validDateFrom) return false;
                if (validDateTo && logDateKey > validDateTo) return false;
                return true;
            });
        }
        return result;
    }, [logs, buildingFilter, originFilter, deferredDateFromFilter, deferredDateToFilter]);

    // conversion attribution 전용: building/origin은 적용하되 날짜는 자르지 않음
    const conversionInterventions = useMemo(() => {
        let result = logs;
        if (buildingFilter !== "all") {
            result = result.filter(log => log.building === buildingFilter);
        }
        if (originFilter === "beds24") {
            result = result.filter(log => log.origin?.includes("Beds24") || log.origin?.includes("외부"));
        } else if (originFilter === "admin") {
            result = result.filter(log => log.origin === "관리자 대시보드" || log.origin === "queue_worker");
        }
        return result;
    }, [logs, buildingFilter, originFilter]);

    // Group logs by date (YYYY-MM-DD)
    const groupedLogs = useMemo(() => {
        const groups = {};
        filteredLogs.forEach(log => {
            const dateKey = getTokyoDateKey(log.timestamp);
            if (!groups[dateKey]) groups[dateKey] = [];
            groups[dateKey].push(log);
        });
        return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
    }, [filteredLogs]);

    const groupedByBuilding = useMemo(() => {
        const groups = {};
        filteredLogs.forEach(log => {
            const key = log.building || "Unknown";
            if (!groups[key]) groups[key] = [];
            groups[key].push(log);
        });
        return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
    }, [filteredLogs]);

    const groupedByBuildingDate = useMemo(() => {
        const buildings = {};
        filteredLogs.forEach(log => {
            const building = log.building || "Unknown";
            const dateKey = getTokyoDateKey(log.timestamp);
            if (!buildings[building]) buildings[building] = {};
            if (!buildings[building][dateKey]) buildings[building][dateKey] = [];
            buildings[building][dateKey].push(log);
        });
        return Object.entries(buildings)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([building, dateGroups]) => [
                building,
                Object.entries(dateGroups).sort(([a], [b]) => b.localeCompare(a))
            ]);
    }, [filteredLogs]);

    const formatTimestamp = (ts) => {
        if (!ts) return "-";
        const date = ts.toDate ? ts.toDate() : new Date(ts);
        return date.toLocaleString('en-US', {
            timeZone: 'Asia/Tokyo',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
    };

    const formatDateFull = (dateStr) => {
        if (!dateStr || dateStr === "Unknown") return "Unknown";
        return String(dateStr).replace(/-/g, " - ");
    };

    const formatDateRange = (dateFrom, dateTo) => {
        if (!dateFrom) return "-";
        const from = dateFrom.slice(5).replace("-", "/");
        const to = dateTo ? dateTo.slice(5).replace("-", "/") : from;
        if (from === to) return from;
        return `${from} ~ ${to}`;
    };

    const formatPrice = (p) => {
        if (!p && p !== 0) return "-";
        return `¥${Number(p).toLocaleString()}`;
    };

    const extractPeriodFromDates = (log) => {
        if (log.dateFrom && log.dateTo) {
            return { dateFrom: log.dateFrom, dateTo: log.dateTo, totalDays: log.totalDays || 1 };
        }
        if (log.dates && typeof log.dates === 'object') {
            const dateKeys = Object.keys(log.dates).sort();
            if (dateKeys.length > 0) {
                const first = dateKeys[0];
                const last = dateKeys[dateKeys.length - 1];
                const formatKey = (k) => `${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`;
                return { dateFrom: formatKey(first), dateTo: formatKey(last), totalDays: dateKeys.length };
            }
        }
        return { dateFrom: null, dateTo: null, totalDays: 0 };
    };

    const getBuildingName = (building) => BUILDING_NAMES_EN[building] || building;
    const getRoomName = (room) => {
        if (!room) return "-";
        const roomName = String(room);
        if (roomName.endsWith("호")) {
            return `Room ${roomName.replace("호", "")}`;
        }
        const specialRooms = {
            "오쿠보A": "Okubo A",
            "오쿠보B": "Okubo B",
            "오쿠보C": "Okubo C",
            "사노": "Sano"
        };
        return specialRooms[roomName] || roomName;
    };
    const getChangeTypeLabel = (log) => {
        const isBeds24 = log.origin?.includes("Beds24") || log.origin?.includes("외부");
        if (isBeds24) return { label: "Beds24 External", bg: "#FFF7ED", color: "#EA580C" };
        if (log.adjustMode === "percent" && log.percentValue != null) {
            const sign = Number(log.percentValue) > 0 ? "+" : "";
            return { label: `Percent ${sign}${log.percentValue}%`, bg: Number(log.percentValue) >= 0 ? "#FEF2F2" : "#ECFDF5", color: Number(log.percentValue) >= 0 ? "#EF4444" : "#10B981" };
        }
        return { label: "Fixed Price", bg: "#EFF6FF", color: "#2563EB" };
    };

    const getScopeSummary = (log, period) => {
        const roomCount = Array.isArray(log.rooms) ? log.rooms.length : (log.room ? 1 : 0);
        const parts = [];
        if (period.totalDays > 0) parts.push(`${period.totalDays} date${period.totalDays !== 1 ? "s" : ""}`);
        if (roomCount > 1) parts.push(`${roomCount} rooms`);
        return parts.join(" · ");
    };

    const getRoomTitle = (log) => {
        if (Array.isArray(log.rooms) && log.rooms.length > 0) {
            const names = log.rooms.map(getRoomName);
            if (names.length === 1) return names[0];
            return `${names[0]} +${names.length - 1}`;
        }
        return getRoomName(log.room);
    };

    const getBeds24Note = (log) => {
        const roomLabel = Array.isArray(log.rooms) && log.rooms.length > 0
            ? log.rooms.map(getRoomName).join(", ")
            : getRoomName(log.room);
        return `Beds24 detected a price or inventory change for ${roomLabel}.`;
    };

    const getUniquePriceSnapshot = (log) => {
        const snapshots = Array.isArray(log?.priceSnapshot) ? log.priceSnapshot : [];
        const seen = new Set();
        return snapshots.filter((snap) => {
            const key = [
                snap?.date || "",
                snap?.room || "",
                snap?.oldPrice ?? "",
                snap?.newPrice ?? ""
            ].join("|");
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    };

    const getOriginLabel = (log) => {
        if (log.origin?.includes("외부 수정") || log.origin?.includes("Beds24")) return "Beds24";
        if (log.origin === "queue_worker") return "Queue";
        if (log.origin === "관리자 대시보드") return "Admin";
        return log.origin || "Manual";
    };

    const getOriginStyle = (log) => {
        const isBeds24 = log.origin?.includes("Beds24") || log.origin?.includes("외부");
        return {
            background: isBeds24 ? "#FFF7ED" : log.origin === "queue_worker" ? "#F0FDF4" : "#EFF6FF",
            color: isBeds24 ? "#EA580C" : log.origin === "queue_worker" ? "#16A34A" : "#2563EB",
            padding: "4px 10px",
            borderRadius: "6px",
            fontSize: "11px",
            fontWeight: "600"
        };
    };

    const getWorkerDisplay = (log) => {
        if (log.worker === "Beds24 System" || log.worker === "Beds24 시스템") return "Beds24";
        if (log.worker === "System (Queue)") return log.workerEmail || "Queue Worker";
        return log.worker || "System";
    };

    const attributedConversions = useMemo(() => {
        const { conversionList } = buildPriceAttributionResult({
            interventions: conversionInterventions,
            reservations,
            defaultWindowHours: 48,
            minInterventionDate: "2026-04-11",
            minBookingDate: "2026-04-11"
        });
        return conversionList;
    }, [conversionInterventions, reservations]);

    const conversionRows = useMemo(() => (
        attributedConversions.map((item) => {
            const reservation = item.reservation || {};
            const intervention = item.intervention || {};
            return {
                key: `${item.reservationKey}:${item.appliedAtMs}`,
                bookingAtMs: item.bookingCreatedAtMs,
                bookingAtSource: item.bookingCreatedAtSource || 'unknown',
                interventionAtMs: item.appliedAtMs,
                building: reservation.building || intervention.building || "Unknown",
                room: reservation.room || "-",
                guestName: reservation.guestName || "Guest",
                arrival: reservation.arrival || "-",
                departure: reservation.departure || "-",
                totalPrice: reservation.totalPrice ?? reservation.price ?? 0,
                hoursToBooking: item.hoursToBooking,
                windowHours: item.windowHours
            };
        })
    ), [attributedConversions]);

    const filteredConversionRows = useMemo(() => {
        const validDateFrom = getValidatedDateFilter(deferredDateFromFilter);
        const validDateTo = getValidatedDateFilter(deferredDateToFilter);
        if (!validDateFrom && !validDateTo) return conversionRows;
        return conversionRows.filter((row) => {
            if (!Number.isFinite(row.bookingAtMs)) return false;
            const dateKey = getTokyoDateKey(row.bookingAtMs);
            if (!dateKey || dateKey === "Unknown") return false;
            if (validDateFrom && dateKey < validDateFrom) return false;
            if (validDateTo && dateKey > validDateTo) return false;
            return true;
        });
    }, [conversionRows, deferredDateFromFilter, deferredDateToFilter, getValidatedDateFilter, getTokyoDateKey]);

    const formatDateTime = (ms) => {
        if (!Number.isFinite(ms)) return "-";
        return new Date(ms).toLocaleString("en-US", {
            timeZone: "Asia/Tokyo",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
        });
    };

    const formatDateOnly = (ms) => {
        if (!Number.isFinite(ms)) return "-";
        const jst = new Date(new Date(ms).toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
        const y = jst.getFullYear();
        const mo = String(jst.getMonth() + 1).padStart(2, "0");
        const d = String(jst.getDate()).padStart(2, "0");
        return `${y}-${mo}-${d}`;
    };

    const stats = useMemo(() => {
        const total = filteredLogs.length;
        const beds24 = filteredLogs.filter(l => l.origin?.includes("Beds24") || l.origin?.includes("외부")).length;
        const admin = filteredLogs.filter(l => l.origin === "관리자 대시보드" || l.origin === "queue_worker").length;
        const converted = attributedConversions.length;
        return { total, beds24, admin, converted };
    }, [filteredLogs, attributedConversions]);

    // 그리드 컬럼: Time | OK | Building | Room | Period | Type | Modifier | Before | After | Δ%
    const COL = '54px 24px 132px 108px 156px 122px 150px 84px 84px 54px';

    const colHeaderStyle = {
        fontSize: '12px', fontWeight: '600', color: '#8E8E93',
        textTransform: 'uppercase', letterSpacing: '0.04em', userSelect: 'none'
    };

    const segBtn = (mode, label) => (
        <button key={mode} onClick={() => setGroupBy(mode)} style={{
            padding: '5px 13px', borderRadius: '8px', border: 'none', cursor: 'pointer',
            background: groupBy === mode ? '#FFFFFF' : 'transparent',
            color: groupBy === mode ? '#1D1D1F' : '#6E6E73',
            fontSize: '12px', fontWeight: groupBy === mode ? '600' : '400',
            boxShadow: groupBy === mode ? '0 1px 4px rgba(0,0,0,0.14)' : 'none',
            transition: 'all 0.15s', whiteSpace: 'nowrap'
        }}>{label}</button>
    );

    // ─── Expanded Snapshot: 룸별 섹션 + 날짜순 타일 그리드 ──────────────────────
    const renderSnapshotCompact = (log, uniquePriceSnapshot, isBeds24) => {
        // 룸별 groupBy
        const roomMap = {};
        uniquePriceSnapshot.forEach((snap) => {
            const roomKey = snap.room || 'Unknown Room';
            if (!roomMap[roomKey]) roomMap[roomKey] = [];
            roomMap[roomKey].push(snap);
        });
        // 룸 키 자연 정렬 (숫자 포함)
        const sortedRooms = Object.keys(roomMap).sort((a, b) =>
            a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
        );
        // 각 룸 내부 날짜 오름차순 정렬
        sortedRooms.forEach((roomKey) => {
            roomMap[roomKey].sort((a, b) => (a.date || '') < (b.date || '') ? -1 : (a.date || '') > (b.date || '') ? 1 : 0);
        });

        return (
            <div style={{ padding: '10px 10px 12px', background: '#F8FAFC', borderTop: '1px solid #E5E7EB' }}>
                {sortedRooms.map((roomKey) => {
                    const snaps = roomMap[roomKey];
                    const roomLabel = snaps[0]?.room ? getRoomName(snaps[0].room) : roomKey;
                    return (
                        <div key={roomKey} style={{ marginBottom: '10px' }}>
                            {/* 섹션 헤더 */}
                            <div style={{
                                display: 'inline-flex', alignItems: 'center', gap: '6px',
                                padding: '4px 10px', marginBottom: '7px',
                                borderRadius: '8px', border: '1px solid #E5E7EB',
                                background: '#F1F5F9'
                            }}>
                                <span style={{ fontSize: '12px', fontWeight: '600', color: '#334155' }}>{roomLabel}</span>
                                <span style={{ fontSize: '11px', color: '#94A3B8' }}>{snaps.length} changes</span>
                            </div>
                            {/* 카드 그리드 */}
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fill, minmax(176px, 1fr))',
                                gap: '7px'
                            }}>
                                {snaps.map((snap, sidx) => {
                                    const d = snap.newPrice - snap.oldPrice;
                                    const pct = snap.oldPrice > 0 ? Math.round(d / snap.oldPrice * 100) : null;
                                    const cardKey = snap.date ? `${roomKey}__${snap.date}__${sidx}` : `${roomKey}__${sidx}`;
                                    return (
                                        <div key={cardKey} style={{
                                            background: '#FFFFFF',
                                            border: `1px solid ${isBeds24 ? '#FFE7BF' : '#E5E7EB'}`,
                                            borderRadius: '10px',
                                            padding: '8px 10px',
                                            minHeight: '64px',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            justifyContent: 'space-between',
                                            gap: '5px'
                                        }}>
                                            {/* 1행: 날짜 */}
                                            <div>
                                                <span style={{ fontSize: '12px', fontWeight: '700', color: '#334155', fontVariantNumeric: 'tabular-nums' }}>
                                                    {snap.date ? snap.date.slice(5).replace('-', '/') : '-'}
                                                </span>
                                            </div>
                                            {/* 2행: oldPrice → newPrice */}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                                                <span style={{ fontSize: '11px', color: '#94A3B8', textDecoration: 'line-through', fontVariantNumeric: 'tabular-nums' }}>
                                                    {formatPrice(snap.oldPrice)}
                                                </span>
                                                <span style={{ fontSize: '11px', color: '#CBD5E1' }}>→</span>
                                                <span style={{ fontSize: '12px', fontWeight: '700', color: d > 0 ? '#16A34A' : d < 0 ? '#DC2626' : '#1D1D1F', fontVariantNumeric: 'tabular-nums' }}>
                                                    {formatPrice(snap.newPrice)}
                                                </span>
                                            </div>
                                            {/* 3행: % badge */}
                                            <div>
                                                <span style={{
                                                    fontSize: '11px', fontWeight: '700',
                                                    padding: '1px 7px', borderRadius: '999px',
                                                    color: pct == null ? '#64748B' : pct > 0 ? '#166534' : pct < 0 ? '#B91C1C' : '#64748B',
                                                    background: pct == null ? '#E2E8F0' : pct > 0 ? '#DCFCE7' : pct < 0 ? '#FEE2E2' : '#E2E8F0'
                                                }}>
                                                    {pct == null ? '-' : `${pct > 0 ? '+' : ''}${pct}%`}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    // ─── 행 렌더러 (단일 Compact 스타일) ────────────────────────────────────
    const renderRows = (rows) => rows.map((log, idx) => {
        const period = extractPeriodFromDates(log);
        const isExpanded = expandedId === log.id;
        const uniquePriceSnapshot = getUniquePriceSnapshot(log);
        const hasSnapshot = uniquePriceSnapshot.length > 0;
        const changedCellsCount = hasSnapshot ? uniquePriceSnapshot.length : 1;
        const isBeds24 = log.origin?.includes("Beds24") || log.origin?.includes("외부");
        const ct = getChangeTypeLabel(log);
        const errorMsg = log.errorMessage || log.error;
        const priceDelta = log.oldPrice > 0 && log.newPrice != null
            ? Math.round((log.newPrice - log.oldPrice) / log.oldPrice * 100) : null;
        const zebraBase = idx % 2 === 0 ? '#FFFFFF' : '#FAFAFA';

        return (
            <React.Fragment key={log.id}>
                <div
                    onClick={() => hasSnapshot && setExpandedId(isExpanded ? null : log.id)}
                    onMouseEnter={e => { e.currentTarget.style.background = '#EFF6FF'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = isExpanded ? '#EFF6FF' : zebraBase; }}
                    style={{
                        display: 'grid', gridTemplateColumns: COL, alignItems: 'center',
                        padding: '0 10px', gap: '0 6px', minHeight: '40px',
                        borderTop: '1px solid #F2F2F7',
                        borderLeft: `2px solid ${isBeds24 ? '#FF9F0A' : 'transparent'}`,
                        cursor: hasSnapshot ? 'pointer' : 'default',
                        background: isExpanded ? '#EFF6FF' : zebraBase,
                        transition: 'background 0.1s'
                    }}
                >
                    <span style={{ fontSize: '12px', color: '#8E8E93', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                        {formatTimestamp(log.timestamp)}
                    </span>
                    <span style={{ fontSize: '11px', fontWeight: '700', color: log.success !== false ? '#34C759' : '#FF3B30', textAlign: 'center' }}>
                        {log.success !== false ? '✓' : '✗'}
                    </span>
                    <span style={{ fontSize: '13px', fontWeight: '500', color: '#1D1D1F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {getBuildingName(log.building)}
                    </span>
                    <span style={{ fontSize: '12px', color: '#3C3C43', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {getRoomTitle(log)}
                    </span>
                    <span style={{ fontSize: '12px', color: '#0071E3', fontVariantNumeric: 'tabular-nums', overflow: 'visible', textOverflow: 'clip', whiteSpace: 'normal', lineHeight: 1.2 }}>
                        <span>{formatDateRange(period.dateFrom, period.dateTo)}</span>
                        {period.totalDays > 0 && <span style={{ color: '#AEAEB2', marginLeft: '4px' }}>{period.totalDays}d</span>}
                        {changedCellsCount > 0 && <span style={{ color: '#64748B', marginLeft: '6px', fontWeight: '600' }}>{changedCellsCount} cells</span>}
                    </span>
                    <span style={{ fontSize: '12px', fontWeight: '600', color: ct.color, overflow: 'visible', textOverflow: 'clip', whiteSpace: 'normal', lineHeight: 1.2 }}>
                        {ct.label}
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2, overflow: 'hidden' }}>
                        <span style={{ fontSize: '12px', fontWeight: '600', color: '#1F2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {getWorkerDisplay(log)}
                        </span>
                        <span style={{ fontSize: '11px', color: '#6B7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {log.workerEmail || '-'}
                        </span>
                    </span>
                    <span style={{ fontSize: '12px', color: '#AEAEB2', textDecoration: 'line-through', fontVariantNumeric: 'tabular-nums', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {log.oldPrice != null ? formatPrice(log.oldPrice) : '—'}
                    </span>
                    <span style={{ fontSize: '13px', fontWeight: '700', fontVariantNumeric: 'tabular-nums', textAlign: 'right', whiteSpace: 'nowrap', color: log.newPrice > log.oldPrice ? '#16A34A' : log.newPrice < log.oldPrice ? '#DC2626' : '#1D1D1F' }}>
                        {log.newPrice != null ? formatPrice(log.newPrice) : '—'}
                    </span>
                    <span style={{ fontSize: '12px', fontWeight: '600', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
                        color: priceDelta == null ? '#C7C7CC' : priceDelta > 0 ? '#16A34A' : priceDelta < 0 ? '#DC2626' : '#8E8E93' }}>
                        {priceDelta == null ? '—' : `${priceDelta > 0 ? '+' : ''}${priceDelta}%`}
                        {hasSnapshot && <span style={{ color: '#C7C7CC', marginLeft: '3px', display: 'inline-block', transition: 'transform 0.15s', transform: isExpanded ? 'rotate(90deg)' : 'none' }}>›</span>}
                    </span>
                </div>
                {log.success === false && errorMsg && (
                    <div style={{ padding: '4px 10px', fontSize: '12px', color: '#FF3B30', background: '#FFF2F0', borderTop: '1px solid #FFE5E5' }}>
                        {errorMsg}
                    </div>
                )}
                {isExpanded && hasSnapshot && renderSnapshotCompact(log, uniquePriceSnapshot, isBeds24)}
            </React.Fragment>
        );
    });

    const groupHeaderStyle = (sub = false) => ({
        padding: sub ? '3px 10px' : '4px 10px',
        background: sub ? '#F5F5F7' : '#EBEBEB',
        borderTop: '1px solid #E0E0E0',
        borderBottom: '1px solid #E0E0E0',
        display: 'flex', alignItems: 'center', gap: '6px', height: '26px'
    });

    return (
        <div style={{
            padding: '12px 14px',
            background: '#F5F5F7',
            minHeight: '100vh',
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif'
        }}>
            {/* Header */}
            <div style={{ marginBottom: '10px', display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                <h1 style={{ fontSize: '20px', fontWeight: '700', color: '#1D1D1F', margin: 0, letterSpacing: '-0.3px' }}>
                    Price History
                </h1>
                <p style={{ fontSize: '12px', color: '#8E8E93', margin: 0, fontWeight: '400' }}>
                    {stats.total} records · {stats.admin} admin · {stats.beds24} Beds24 · {stats.converted} converted
                </p>
            </div>

            {/* Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
                <select
                    value={buildingFilter}
                    onChange={e => setBuildingFilter(e.target.value)}
                    style={{
                        padding: '4px 24px 4px 8px', borderRadius: '7px',
                        border: '1px solid #D1D1D6', fontSize: '12px',
                        color: '#1D1D1F', background: '#FFFFFF', cursor: 'pointer', outline: 'none',
                        WebkitAppearance: 'none', appearance: 'none',
                        backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\'%3E%3Cpath d=\'M0 0l5 6 5-6z\' fill=\'%238E8E93\'/%3E%3C/svg%3E")',
                        backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center'
                    }}
                >
                    <option value="all">All Properties</option>
                    {ACTIVE_BUILDING_ORDER.map(b => (
                        <option key={b} value={b}>{getBuildingName(b)}</option>
                    ))}
                </select>

                <select
                    value={originFilter}
                    onChange={e => setOriginFilter(e.target.value)}
                    style={{
                        padding: '4px 24px 4px 8px', borderRadius: '7px',
                        border: '1px solid #D1D1D6', fontSize: '12px',
                        color: '#1D1D1F', background: '#FFFFFF', cursor: 'pointer', outline: 'none',
                        WebkitAppearance: 'none', appearance: 'none',
                        backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\'%3E%3Cpath d=\'M0 0l5 6 5-6z\' fill=\'%238E8E93\'/%3E%3C/svg%3E")',
                        backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center'
                    }}
                >
                    <option value="all">All Sources</option>
                    <option value="admin">Admin</option>
                    <option value="beds24">Beds24</option>
                    <option value="conversion">Price Conversions</option>
                </select>

                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                    <input
                        type="text"
                        inputMode="numeric"
                        maxLength={10}
                        value={dateFromFilter}
                        onChange={e => setDateFromFilter(normalizeDateInput(e.target.value))}
                        placeholder="From YYYY-MM-DD"
                        style={{
                            width: '120px', padding: '4px 7px', borderRadius: '7px',
                            border: '1px solid #D1D1D6', fontSize: '12px',
                            color: '#1D1D1F', background: '#FFFFFF', outline: 'none',
                            fontVariantNumeric: 'tabular-nums'
                        }}
                    />
                    <span style={{ fontSize: '11px', color: '#AEAEB2' }}>~</span>
                    <input
                        type="text"
                        inputMode="numeric"
                        maxLength={10}
                        value={dateToFilter}
                        onChange={e => setDateToFilter(normalizeDateInput(e.target.value))}
                        placeholder="To YYYY-MM-DD"
                        style={{
                            width: '112px', padding: '4px 7px', borderRadius: '7px',
                            border: '1px solid #D1D1D6', fontSize: '12px',
                            color: '#1D1D1F', background: '#FFFFFF', outline: 'none',
                            fontVariantNumeric: 'tabular-nums'
                        }}
                    />
                    <button
                        onClick={() => { const t = getTokyoTodayKey(); setDateFromFilter(t); setDateToFilter(t); }}
                        style={{ padding: '4px 8px', borderRadius: '7px', border: '1px solid #D1D1D6', background: '#F8FAFC', color: '#334155', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}
                    >Today</button>
                    <button
                        onClick={() => { setDateFromFilter(""); setDateToFilter(""); }}
                        style={{ padding: '4px 8px', borderRadius: '7px', border: '1px solid #D1D1D6', background: '#FFFFFF', color: '#6B7280', fontSize: '11px', fontWeight: '600', cursor: 'pointer' }}
                    >Clear</button>
                </div>

                <span style={{ fontSize: '12px', color: '#AEAEB2' }}>
                    {filteredLogs.length} of {logs.length}
                </span>

                {/* Group By segment control — pushed right */}
                <div style={{
                    marginLeft: 'auto',
                    display: 'inline-flex', alignItems: 'center',
                    background: '#E5E5EA', borderRadius: '10px', padding: '3px', gap: '2px'
                }}>
                    {segBtn('date', 'By Date')}
                    {segBtn('building', 'By Building')}
                    {segBtn('building+date', 'Building + Date')}
                </div>
            </div>

            {showConversionOnly && (
            <div style={{
                background: '#FFFFFF',
                borderRadius: '14px',
                boxShadow: '0 1px 4px rgba(0,0,0,0.06), 0 0 0 0.5px rgba(0,0,0,0.06)',
                overflow: 'hidden',
                marginBottom: '16px'
            }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    padding: '12px 16px',
                    borderBottom: '1px solid #E5E5EA',
                    background: '#F8FAFC'
                }}>
                    <div style={{ fontSize: '14px', fontWeight: '700', color: '#0F172A' }}>
                        Price-Driven Booking Conversions
                    </div>
                    <div style={{ fontSize: '12px', color: '#64748B' }}>
                        {reservationsLoading ? 'Loading reservations...' : `${filteredConversionRows.length} matched bookings`}
                    </div>
                </div>
                {reservationsLoading ? (
                    <div style={{ padding: '18px 16px', fontSize: '13px', color: '#94A3B8' }}>
                        Calculating attribution...
                    </div>
                ) : filteredConversionRows.length === 0 ? (
                    <div style={{ padding: '18px 16px', fontSize: '13px', color: '#94A3B8' }}>
                        No matched booking found for current filters (rule: same room/date overlap and booking within 48h after price change).
                    </div>
                ) : (
                    <div style={{
                        overflowX: 'auto'
                    }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                            <thead style={{ position: 'sticky', top: 0, zIndex: 1, background: '#FFFFFF' }}>
                                <tr>
                                    <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #EEF2F7', color: '#64748B', fontWeight: '600' }}>Booked At</th>
                                    <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #EEF2F7', color: '#64748B', fontWeight: '600' }}>Building / Room</th>
                                    <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #EEF2F7', color: '#64748B', fontWeight: '600' }}>Guest / Stay</th>
                                    <th style={{ padding: '8px 10px', textAlign: 'right', borderBottom: '1px solid #EEF2F7', color: '#64748B', fontWeight: '600' }}>Revenue</th>
                                    <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #EEF2F7', color: '#64748B', fontWeight: '600' }}>Intervention At</th>
                                    <th style={{ padding: '8px 10px', textAlign: 'right', borderBottom: '1px solid #EEF2F7', color: '#64748B', fontWeight: '600' }}>Lag</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredConversionRows.map((row) => (
                                    <tr key={row.key} style={{ borderBottom: '1px solid #F1F5F9' }}>
                                        <td style={{ padding: '8px 10px', color: '#0F172A', fontVariantNumeric: 'tabular-nums' }}
                                            title={row.bookingAtSource === 'date_only_fallback' ? 'Date-only booking — no exact booking time provided.' : undefined}>
                                            {row.bookingAtSource === 'exact'
                                                ? formatDateTime(row.bookingAtMs)
                                                : row.bookingAtSource === 'date_only_fallback'
                                                    ? <span>{formatDateOnly(row.bookingAtMs)}<span style={{ marginLeft: '4px', fontSize: '10px', color: '#94A3B8', fontWeight: '600' }}>(date only)</span></span>
                                                    : '-'}
                                        </td>
                                        <td style={{ padding: '8px 10px', color: '#0F172A' }}>
                                            <div style={{ fontWeight: '600' }}>{getBuildingName(row.building)}</div>
                                            <div style={{ fontSize: '11px', color: '#64748B' }}>{getRoomName(row.room)}</div>
                                        </td>
                                        <td style={{ padding: '8px 10px', color: '#0F172A' }}>
                                            <div style={{ fontWeight: '600' }}>{row.guestName}</div>
                                            <div style={{ fontSize: '11px', color: '#64748B' }}>{row.arrival} ~ {row.departure}</div>
                                        </td>
                                        <td style={{ padding: '8px 10px', textAlign: 'right', color: '#0F172A', fontWeight: '700', fontVariantNumeric: 'tabular-nums' }}>
                                            {formatPrice(row.totalPrice)}
                                        </td>
                                        <td style={{ padding: '8px 10px', color: '#0F172A', fontVariantNumeric: 'tabular-nums' }}>{formatDateTime(row.interventionAtMs)}</td>
                                        <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                                            <span style={{
                                                display: 'inline-block',
                                                fontSize: '11px',
                                                fontWeight: '700',
                                                color: '#047857',
                                                background: '#ECFDF5',
                                                padding: '2px 8px',
                                                borderRadius: '999px'
                                            }}>
                                                {row.hoursToBooking}h / {row.windowHours}h
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            )}

            {/* Table */}
            {!showConversionOnly && (loading ? (
                <div style={{ padding: '80px', textAlign: 'center', color: '#AEAEB2', fontSize: '14px' }}>
                    Loading...
                </div>
            ) : filteredLogs.length === 0 ? (
                <div style={{ padding: '80px', textAlign: 'center' }}>
                    <div style={{ fontSize: '15px', fontWeight: '600', color: '#1D1D1F', marginBottom: '6px' }}>No records found</div>
                    <div style={{ fontSize: '13px', color: '#AEAEB2' }}>
                        {buildingFilter !== 'all' || originFilter !== 'all' || dateFromFilter || dateToFilter ? 'Try adjusting filters' : 'Price changes will appear here'}
                    </div>
                </div>
            ) : (
                <div style={{
                    background: '#FFFFFF',
                    borderRadius: '14px',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.06), 0 0 0 0.5px rgba(0,0,0,0.06)',
                    overflow: 'hidden'
                }}>
                    {/* Column headers */}
                    <div style={{
                        display: 'grid', gridTemplateColumns: COL,
                        padding: '0 10px', gap: '0 6px', height: '30px', alignItems: 'center',
                        borderBottom: '1px solid #E5E5EA', background: '#F5F5F7',
                        position: 'sticky', top: 0, zIndex: 1
                    }}>
                        <span style={colHeaderStyle}>Time</span>
                        <span style={colHeaderStyle}>OK</span>
                        <span style={colHeaderStyle}>Building</span>
                        <span style={colHeaderStyle}>Room</span>
                        <span style={colHeaderStyle}>Period</span>
                        <span style={colHeaderStyle}>Type</span>
                        <span style={colHeaderStyle}>Modifier</span>
                        <span style={{ ...colHeaderStyle, textAlign: 'right' }}>Before</span>
                        <span style={{ ...colHeaderStyle, textAlign: 'right' }}>After</span>
                        <span style={{ ...colHeaderStyle, textAlign: 'right' }}>Δ%</span>
                    </div>

                    {/* Rows — By Date */}
                    {groupBy === 'date' && groupedLogs.map(([dateKey, dateLogs]) => (
                        <React.Fragment key={dateKey}>
                            <div style={groupHeaderStyle()}>
                                <span style={{ fontSize: '12px', fontWeight: '600', color: '#3C3C43' }}>
                                    {`${dateKey} · ${dateLogs.length} change${dateLogs.length !== 1 ? 's' : ''}`}
                                </span>
                            </div>
                            {renderRows(dateLogs)}
                        </React.Fragment>
                    ))}

                    {/* Rows — By Building */}
                    {groupBy === 'building' && groupedByBuilding.map(([building, buildingLogs]) => (
                        <React.Fragment key={building}>
                            <div style={groupHeaderStyle()}>
                                <span style={{ fontSize: '12px', fontWeight: '600', color: '#3C3C43' }}>
                                    {`${getBuildingName(building)} · ${buildingLogs.length} record${buildingLogs.length !== 1 ? 's' : ''}`}
                                </span>
                            </div>
                            {renderRows(buildingLogs)}
                        </React.Fragment>
                    ))}

                    {/* Rows — Building + Date */}
                    {groupBy === 'building+date' && groupedByBuildingDate.map(([building, dateGroups]) => (
                        <React.Fragment key={building}>
                            <div style={groupHeaderStyle()}>
                                <span style={{ fontSize: '12px', fontWeight: '700', color: '#1D1D1F' }}>
                                    {`${getBuildingName(building)} · ${dateGroups.reduce((s, [, rows]) => s + rows.length, 0)} records`}
                                </span>
                            </div>
                            {dateGroups.map(([dateKey, dateLogs]) => (
                                <React.Fragment key={dateKey}>
                                    <div style={groupHeaderStyle(true)}>
                                        <span style={{ fontSize: '12px', fontWeight: '500', color: '#6E6E73' }}>
                                            {`${dateKey} · ${dateLogs.length}`}
                                        </span>
                                    </div>
                                    {renderRows(dateLogs)}
                                </React.Fragment>
                            ))}
                        </React.Fragment>
                    ))}
                </div>
            ))}
        </div>
    );
}

export default PriceChangeHistory;
