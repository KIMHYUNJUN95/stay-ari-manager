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
            if (names.length <= 2) return names.join(", ");
            return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
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
            interventions: filteredLogs,
            reservations,
            defaultWindowHours: 48,
            minInterventionDate: "2026-04-11",
            minBookingDate: "2026-04-11"
        });
        return conversionList;
    }, [filteredLogs, reservations]);

    const conversionRows = useMemo(() => (
        attributedConversions.map((item) => {
            const reservation = item.reservation || {};
            const intervention = item.intervention || {};
            return {
                key: `${item.reservationKey}:${item.appliedAtMs}`,
                bookingAtMs: item.bookingCreatedAtMs,
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

    const stats = useMemo(() => {
        const total = filteredLogs.length;
        const beds24 = filteredLogs.filter(l => l.origin?.includes("Beds24") || l.origin?.includes("외부")).length;
        const admin = filteredLogs.filter(l => l.origin === "관리자 대시보드" || l.origin === "queue_worker").length;
        const converted = attributedConversions.length;
        return { total, beds24, admin, converted };
    }, [filteredLogs, attributedConversions]);

    const COL = '72px 54px minmax(110px,140px) minmax(80px,110px) 126px 118px 1fr';

    const colHeaderStyle = {
        fontSize: '11px', fontWeight: '600', color: '#8E8E93',
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

    const renderRows = (rows) => rows.map((log, idx) => {
        const period = extractPeriodFromDates(log);
        const isExpanded = expandedId === log.id;
        const uniquePriceSnapshot = getUniquePriceSnapshot(log);
        const hasSnapshot = uniquePriceSnapshot.length > 0;
        const isBeds24 = log.origin?.includes("Beds24") || log.origin?.includes("외부");
        const ct = getChangeTypeLabel(log);
        const errorMsg = log.errorMessage || log.error;
        const priceDelta = log.oldPrice > 0 && log.newPrice != null
            ? Math.round((log.newPrice - log.oldPrice) / log.oldPrice * 100) : null;

        return (
            <React.Fragment key={log.id}>
                <div
                    onClick={() => hasSnapshot && setExpandedId(isExpanded ? null : log.id)}
                    onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = '#F9F9F9'; }}
                    onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = 'transparent'; }}
                    style={{
                        display: 'grid', gridTemplateColumns: COL, alignItems: 'center',
                        padding: '10px 20px', gap: '0 8px',
                        borderTop: idx > 0 ? '1px solid #F2F2F7' : 'none',
                        borderLeft: `3px solid ${isBeds24 ? '#FF9F0A' : 'transparent'}`,
                        cursor: hasSnapshot ? 'pointer' : 'default',
                        background: isExpanded ? '#F5F5F7' : 'transparent',
                        transition: 'background 0.12s'
                    }}
                >
                    <span style={{ fontSize: '12px', color: '#8E8E93', fontVariantNumeric: 'tabular-nums' }}>
                        {formatTimestamp(log.timestamp)}
                    </span>
                    <span>
                        {log.success !== false
                            ? <span style={{ fontSize: '10px', fontWeight: '700', color: '#34C759', background: '#F0FFF4', padding: '2px 7px', borderRadius: '20px' }}>OK</span>
                            : <span style={{ fontSize: '10px', fontWeight: '700', color: '#FF3B30', background: '#FFF2F0', padding: '2px 7px', borderRadius: '20px' }} title={errorMsg}>FAIL</span>
                        }
                    </span>
                    <span style={{ fontSize: '13px', fontWeight: '500', color: '#1D1D1F', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {getBuildingName(log.building)}
                    </span>
                    <span style={{ fontSize: '12px', color: '#3C3C43', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {getRoomTitle(log)}
                    </span>
                    <div style={{ fontSize: '12px', color: '#0071E3', fontWeight: '500', fontVariantNumeric: 'tabular-nums' }}>
                        {formatDateRange(period.dateFrom, period.dateTo)}
                        {period.totalDays > 0 && <span style={{ color: '#AEAEB2', fontWeight: '400', marginLeft: '3px' }}>{period.totalDays}d</span>}
                    </div>
                    <span style={{ fontSize: '11px', fontWeight: '500', color: ct.color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ct.label}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '7px' }}>
                        {log.oldPrice != null && log.newPrice != null ? (
                            <>
                                <span style={{ fontSize: '12px', color: '#AEAEB2', textDecoration: 'line-through', fontVariantNumeric: 'tabular-nums' }}>
                                    {formatPrice(log.oldPrice)}
                                </span>
                                <span style={{ color: '#D1D1D6', fontSize: '11px' }}>→</span>
                                <span style={{
                                    fontSize: '14px', fontWeight: '700', fontVariantNumeric: 'tabular-nums',
                                    color: log.newPrice > log.oldPrice ? '#FF3B30' : log.newPrice < log.oldPrice ? '#34C759' : '#1D1D1F'
                                }}>
                                    {formatPrice(log.newPrice)}
                                </span>
                                {priceDelta !== null && priceDelta !== 0 && (
                                    <span style={{
                                        fontSize: '11px', fontWeight: '600',
                                        color: priceDelta > 0 ? '#FF3B30' : '#34C759',
                                        background: priceDelta > 0 ? '#FFF2F0' : '#F0FFF4',
                                        padding: '2px 6px', borderRadius: '20px'
                                    }}>
                                        {priceDelta > 0 ? '▲' : '▼'}{Math.abs(priceDelta)}%
                                    </span>
                                )}
                                {hasSnapshot && (
                                    <span style={{
                                        color: '#C7C7CC', fontSize: '14px', marginLeft: '2px',
                                        display: 'inline-block', transition: 'transform 0.18s',
                                        transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)'
                                    }}>›</span>
                                )}
                            </>
                        ) : (
                            <span style={{ fontSize: '13px', color: '#D1D1D6' }}>—</span>
                        )}
                    </div>
                </div>

                {/* Error */}
                {log.success === false && errorMsg && (
                    <div style={{ padding: '6px 20px 8px', fontSize: '12px', color: '#FF3B30', background: '#FFF2F0', borderTop: '1px solid #FFE5E5' }}>
                        {errorMsg}
                    </div>
                )}

                {/* Expanded Snapshot */}
                {isExpanded && hasSnapshot && (
                    <div style={{ padding: '16px 20px 20px', background: '#F5F5F7', borderTop: '1px solid #E5E5EA' }}>
                        <div style={{ fontSize: '11px', fontWeight: '600', color: '#8E8E93', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {isBeds24 ? 'Detected Changes' : 'Price Snapshot by Date'}
                            {log.adjustMode === 'percent' && log.percentValue && (
                                <span style={{ background: Number(log.percentValue) > 0 ? '#FFF2F0' : '#F0FFF4', color: Number(log.percentValue) > 0 ? '#FF3B30' : '#34C759', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '600' }}>
                                    {Number(log.percentValue) > 0 ? '+' : ''}{log.percentValue}%
                                </span>
                            )}
                            <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#AEAEB2', fontWeight: '400' }}>
                                by {getWorkerDisplay(log)}{log.workerEmail ? ` · ${log.workerEmail}` : ''}
                            </span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))', gap: '8px' }}>
                            {uniquePriceSnapshot.map((snap, sidx) => (
                                <div key={sidx} style={{ background: '#FFFFFF', borderRadius: '10px', padding: '10px 12px', border: '1px solid #E5E5EA' }}>
                                    <div style={{ fontSize: '11px', fontWeight: '600', color: '#0071E3', marginBottom: '5px', display: 'flex', justifyContent: 'space-between' }}>
                                        <span>{snap.date ? snap.date.slice(5).replace('-', '/') : '-'}</span>
                                        {snap.room && <span style={{ color: '#AEAEB2', fontWeight: '400' }}>{getRoomName(snap.room)}</span>}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                        <span style={{ fontSize: '12px', color: '#AEAEB2', textDecoration: 'line-through', fontVariantNumeric: 'tabular-nums' }}>{formatPrice(snap.oldPrice)}</span>
                                        <span style={{ color: '#D1D1D6', fontSize: '10px' }}>→</span>
                                        <span style={{ fontSize: '13px', fontWeight: '700', fontVariantNumeric: 'tabular-nums', color: snap.newPrice > snap.oldPrice ? '#FF3B30' : snap.newPrice < snap.oldPrice ? '#34C759' : '#1D1D1F' }}>{formatPrice(snap.newPrice)}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </React.Fragment>
        );
    });

    const groupHeaderStyle = (sub = false) => ({
        padding: sub ? '6px 20px' : '8px 20px',
        background: sub ? '#F9F9F9' : '#F2F2F7',
        borderTop: '1px solid #E5E5EA',
        borderBottom: '1px solid #E5E5EA',
        display: 'flex', alignItems: 'center', gap: '8px'
    });

    return (
        <div style={{
            padding: '28px 32px',
            background: '#F5F5F7',
            minHeight: '100vh',
            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif'
        }}>
            {/* Header */}
            <div style={{ marginBottom: '24px' }}>
                <h1 style={{ fontSize: '26px', fontWeight: '700', color: '#1D1D1F', margin: '0 0 4px', letterSpacing: '-0.5px' }}>
                    Price History
                </h1>
                <p style={{ fontSize: '13px', color: '#8E8E93', margin: 0, fontWeight: '400' }}>
                    {stats.total} records&nbsp;&nbsp;·&nbsp;&nbsp;{stats.admin} admin&nbsp;&nbsp;·&nbsp;&nbsp;{stats.beds24} Beds24&nbsp;&nbsp;·&nbsp;&nbsp;{stats.converted} converted
                </p>
            </div>

            {/* Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
                <select
                    value={buildingFilter}
                    onChange={e => setBuildingFilter(e.target.value)}
                    style={{
                        padding: '7px 12px', borderRadius: '9px',
                        border: '1px solid #D1D1D6', fontSize: '13px',
                        color: '#1D1D1F', background: '#FFFFFF', cursor: 'pointer', outline: 'none',
                        WebkitAppearance: 'none', appearance: 'none', paddingRight: '28px',
                        backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\'%3E%3Cpath d=\'M0 0l5 6 5-6z\' fill=\'%238E8E93\'/%3E%3C/svg%3E")',
                        backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center'
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
                        padding: '7px 12px', borderRadius: '9px',
                        border: '1px solid #D1D1D6', fontSize: '13px',
                        color: '#1D1D1F', background: '#FFFFFF', cursor: 'pointer', outline: 'none',
                        WebkitAppearance: 'none', appearance: 'none', paddingRight: '28px',
                        backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\'%3E%3Cpath d=\'M0 0l5 6 5-6z\' fill=\'%238E8E93\'/%3E%3C/svg%3E")',
                        backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center'
                    }}
                >
                    <option value="all">All Sources</option>
                    <option value="admin">Admin</option>
                    <option value="beds24">Beds24</option>
                    <option value="conversion">Price Conversions</option>
                </select>

                <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '6px 10px',
                    borderRadius: '10px',
                    background: '#FFFFFF',
                    border: '1px solid #E5E5EA',
                    flexWrap: 'wrap'
                }}>
                    <input
                        type="text"
                        inputMode="numeric"
                        maxLength={10}
                        value={dateFromFilter}
                        onChange={e => setDateFromFilter(normalizeDateInput(e.target.value))}
                        placeholder="From YYYY-MM-DD"
                        style={{
                            width: '132px',
                            padding: '7px 10px',
                            borderRadius: '8px',
                            border: '1px solid #D1D1D6',
                            fontSize: '12px',
                            color: '#1D1D1F',
                            background: '#FFFFFF',
                            outline: 'none',
                            fontVariantNumeric: 'tabular-nums'
                        }}
                    />
                    <span style={{ fontSize: '12px', color: '#AEAEB2' }}>~</span>
                    <input
                        type="text"
                        inputMode="numeric"
                        maxLength={10}
                        value={dateToFilter}
                        onChange={e => setDateToFilter(normalizeDateInput(e.target.value))}
                        placeholder="To YYYY-MM-DD"
                        style={{
                            width: '124px',
                            padding: '7px 10px',
                            borderRadius: '8px',
                            border: '1px solid #D1D1D6',
                            fontSize: '12px',
                            color: '#1D1D1F',
                            background: '#FFFFFF',
                            outline: 'none',
                            fontVariantNumeric: 'tabular-nums'
                        }}
                    />
                    <button
                        onClick={() => {
                            const todayKey = getTokyoTodayKey();
                            setDateFromFilter(todayKey);
                            setDateToFilter(todayKey);
                        }}
                        style={{
                            padding: '6px 10px',
                            borderRadius: '8px',
                            border: '1px solid #D1D1D6',
                            background: '#F8FAFC',
                            color: '#334155',
                            fontSize: '12px',
                            fontWeight: '600',
                            cursor: 'pointer'
                        }}
                    >
                        Today
                    </button>
                    <button
                        onClick={() => {
                            setDateFromFilter("");
                            setDateToFilter("");
                        }}
                        style={{
                            padding: '6px 10px',
                            borderRadius: '8px',
                            border: '1px solid #D1D1D6',
                            background: '#FFFFFF',
                            color: '#6B7280',
                            fontSize: '12px',
                            fontWeight: '600',
                            cursor: 'pointer'
                        }}
                    >
                        Clear
                    </button>
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
                        {reservationsLoading ? 'Loading reservations...' : `${conversionRows.length} matched bookings`}
                    </div>
                </div>
                {reservationsLoading ? (
                    <div style={{ padding: '18px 16px', fontSize: '13px', color: '#94A3B8' }}>
                        Calculating attribution...
                    </div>
                ) : conversionRows.length === 0 ? (
                    <div style={{ padding: '18px 16px', fontSize: '13px', color: '#94A3B8' }}>
                        No matched booking found for current filters (rule: same room/date overlap and booking within 48h after price change).
                    </div>
                ) : (
                    <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
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
                                {conversionRows.map((row) => (
                                    <tr key={row.key} style={{ borderBottom: '1px solid #F1F5F9' }}>
                                        <td style={{ padding: '8px 10px', color: '#0F172A', fontVariantNumeric: 'tabular-nums' }}>{formatDateTime(row.bookingAtMs)}</td>
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
                        padding: '9px 20px', gap: '0 8px',
                        borderBottom: '1px solid #E5E5EA',
                        background: '#FAFAFA'
                    }}>
                        <span style={colHeaderStyle}>Time</span>
                        <span style={colHeaderStyle}>Status</span>
                        <span style={colHeaderStyle}>Building</span>
                        <span style={colHeaderStyle}>Room</span>
                        <span style={colHeaderStyle}>Period</span>
                        <span style={colHeaderStyle}>Type</span>
                        <span style={{ ...colHeaderStyle, textAlign: 'right' }}>Price Change</span>
                    </div>

                    {/* Rows — By Date */}
                    {groupBy === 'date' && groupedLogs.map(([dateKey, dateLogs]) => (
                        <React.Fragment key={dateKey}>
                            <div style={groupHeaderStyle()}>
                                <span style={{ fontSize: '12px', fontWeight: '600', color: '#3C3C43' }}>
                                    {formatDateFull(dateKey)}
                                </span>
                                <span style={{ fontSize: '11px', color: '#AEAEB2', fontWeight: '400' }}>
                                    {dateLogs.length} change{dateLogs.length !== 1 ? 's' : ''}
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
                                    {getBuildingName(building)}
                                </span>
                                <span style={{ fontSize: '11px', color: '#AEAEB2', fontWeight: '400' }}>
                                    {buildingLogs.length} record{buildingLogs.length !== 1 ? 's' : ''}
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
                                    {getBuildingName(building)}
                                </span>
                                <span style={{ fontSize: '11px', color: '#AEAEB2', fontWeight: '400' }}>
                                    {dateGroups.reduce((s, [, rows]) => s + rows.length, 0)} records
                                </span>
                            </div>
                            {dateGroups.map(([dateKey, dateLogs]) => (
                                <React.Fragment key={dateKey}>
                                    <div style={groupHeaderStyle(true)}>
                                        <span style={{ fontSize: '11px', fontWeight: '500', color: '#6E6E73' }}>
                                            {formatDateFull(dateKey)}
                                        </span>
                                        <span style={{ fontSize: '11px', color: '#AEAEB2', fontWeight: '400' }}>
                                            {dateLogs.length} change{dateLogs.length !== 1 ? 's' : ''}
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
