import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, orderBy, limit, getDocs } from "firebase/firestore";
import { db } from '../firebase';
import { useUser } from '../contexts/UserContext';
import { BUILDING_NAMES_EN, ACTIVE_BUILDING_ORDER } from '../constants/buildingData';

function PriceChangeHistory() {
    const { companyId } = useUser();
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expandedId, setExpandedId] = useState(null);
    const [buildingFilter, setBuildingFilter] = useState("all");
    const [originFilter, setOriginFilter] = useState("all");

    useEffect(() => {
        if (!companyId) return;
        const fetchLogs = async () => {
            try {
                const q = query(
                    collection(db, "price_change_logs"),
                    where("companyId", "==", companyId),
                    orderBy("timestamp", "desc"),
                    limit(500)
                );
                const snapshot = await getDocs(q);
                const data = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                setLogs(data);
            } catch (error) {
                console.error("Error fetching price logs:", error);
            } finally {
                setLoading(false);
            }
        };
        fetchLogs();
    }, [companyId]);

    const filteredLogs = useMemo(() => {
        let result = logs;
        if (buildingFilter !== "all") {
            result = result.filter(log => log.building === buildingFilter);
        }
        if (originFilter !== "all") {
            if (originFilter === "beds24") {
                result = result.filter(log => log.origin?.includes("Beds24") || log.origin?.includes("외부"));
            } else if (originFilter === "admin") {
                result = result.filter(log => log.origin === "관리자 대시보드" || log.origin === "queue_worker");
            }
        }
        return result;
    }, [logs, buildingFilter, originFilter]);

    // Group logs by date (YYYY-MM-DD)
    const groupedLogs = useMemo(() => {
        const groups = {};
        filteredLogs.forEach(log => {
            const ts = log.timestamp;
            let dateKey = "Unknown";
            if (ts) {
                const date = ts.toDate ? ts.toDate() : new Date(ts);
                dateKey = date.toISOString().slice(0, 10);
            }
            if (!groups[dateKey]) groups[dateKey] = [];
            groups[dateKey].push(log);
        });
        return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
    }, [filteredLogs]);

    const formatTimestamp = (ts) => {
        if (!ts) return "-";
        const date = ts.toDate ? ts.toDate() : new Date(ts);
        return date.toLocaleString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
    };

    const formatDateFull = (dateStr) => {
        if (!dateStr || dateStr === "Unknown") return "Unknown";
        const d = new Date(dateStr + "T00:00:00");
        return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
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
    const getRoomName = (room) => room ? String(room).replace("호", "") : "-";

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

    const stats = useMemo(() => {
        const total = filteredLogs.length;
        const beds24 = filteredLogs.filter(l => l.origin?.includes("Beds24") || l.origin?.includes("외부")).length;
        const admin = filteredLogs.filter(l => l.origin === "관리자 대시보드" || l.origin === "queue_worker").length;
        return { total, beds24, admin };
    }, [filteredLogs]);

    return (
        <div style={{
            padding: '32px',
            background: '#FFFFFF',
            minHeight: '100vh',
            fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
        }}>
            {/* Header */}
            <div style={{ marginBottom: '28px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                        fontSize: '28px',
                        background: 'linear-gradient(135deg, #EEF2FF 0%, #E0E7FF 100%)',
                        width: '48px', height: '48px',
                        display: 'flex', justifyContent: 'center', alignItems: 'center',
                        borderRadius: '14px'
                    }}>
                        💰
                    </div>
                    <div>
                        <h1 style={{ fontSize: '24px', fontWeight: '700', color: '#0F172A', margin: 0, letterSpacing: '-0.5px' }}>
                            Price Change History
                        </h1>
                        <p style={{ fontSize: '14px', color: '#64748B', marginTop: '4px', fontWeight: '500' }}>
                            {stats.total} records · {stats.admin} admin · {stats.beds24} Beds24
                        </p>
                    </div>
                </div>
            </div>

            {/* Filters */}
            <div style={{
                display: "flex", gap: "12px", marginBottom: "20px", flexWrap: "wrap", alignItems: "center"
            }}>
                <select
                    value={buildingFilter}
                    onChange={(e) => setBuildingFilter(e.target.value)}
                    style={{
                        padding: "8px 14px", borderRadius: "10px",
                        border: "1px solid #E2E8F0", fontSize: "13px", fontWeight: "500",
                        color: "#334155", background: "white", cursor: "pointer", outline: "none"
                    }}
                >
                    <option value="all">All Properties</option>
                    {ACTIVE_BUILDING_ORDER.map(b => (
                        <option key={b} value={b}>{getBuildingName(b)}</option>
                    ))}
                </select>

                <select
                    value={originFilter}
                    onChange={(e) => setOriginFilter(e.target.value)}
                    style={{
                        padding: "8px 14px", borderRadius: "10px",
                        border: "1px solid #E2E8F0", fontSize: "13px", fontWeight: "500",
                        color: "#334155", background: "white", cursor: "pointer", outline: "none"
                    }}
                >
                    <option value="all">All Sources</option>
                    <option value="admin">Admin Dashboard</option>
                    <option value="beds24">Beds24 External</option>
                </select>

                <span style={{ fontSize: "12px", color: "#94A3B8", marginLeft: "4px" }}>
                    Showing {filteredLogs.length} of {logs.length}
                </span>
            </div>

            {/* Content */}
            {loading ? (
                <div style={{ padding: "80px", textAlign: "center", color: "#94A3B8" }}>
                    <div style={{ fontSize: "32px", marginBottom: "16px", animation: "pulse 1.5s infinite" }}>⏳</div>
                    Loading history...
                </div>
            ) : filteredLogs.length === 0 ? (
                <div style={{ padding: "80px", textAlign: "center", color: "#64748B" }}>
                    <div style={{ fontSize: "40px", marginBottom: "16px" }}>🦕</div>
                    <div style={{ fontSize: "16px", fontWeight: "600" }}>No price change history found</div>
                    <div style={{ fontSize: "13px", color: "#94A3B8", marginTop: "8px" }}>
                        {buildingFilter !== "all" || originFilter !== "all"
                            ? "Try adjusting filters"
                            : "Changes will appear here after price updates"}
                    </div>
                </div>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                    {groupedLogs.map(([dateKey, dateLogs]) => (
                        <div key={dateKey}>
                            {/* Date Group Header */}
                            <div style={{
                                display: "flex", alignItems: "center", gap: "12px",
                                marginBottom: "12px", padding: "0 4px"
                            }}>
                                <div style={{
                                    fontSize: "14px", fontWeight: "700", color: "#1E293B",
                                    background: "linear-gradient(135deg, #F1F5F9 0%, #E2E8F0 100%)",
                                    padding: "6px 14px", borderRadius: "8px"
                                }}>
                                    {formatDateFull(dateKey)}
                                </div>
                                <div style={{ flex: 1, height: "1px", background: "#E2E8F0" }} />
                                <span style={{ fontSize: "12px", color: "#94A3B8", fontWeight: "500" }}>
                                    {dateLogs.length} change{dateLogs.length !== 1 ? "s" : ""}
                                </span>
                            </div>

                            {/* Log Cards */}
                            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                {dateLogs.map(log => {
                                    const period = extractPeriodFromDates(log);
                                    const isExpanded = expandedId === log.id;
                                    const hasSnapshot = log.priceSnapshot && log.priceSnapshot.length > 0;
                                    const isBeds24 = log.origin?.includes("Beds24") || log.origin?.includes("외부");
                                    const errorMsg = log.errorMessage || log.error;

                                    return (
                                        <div key={log.id} style={{
                                            background: "white",
                                            borderRadius: "14px",
                                            border: `1px solid ${isBeds24 ? "#FED7AA" : "#E2E8F0"}`,
                                            overflow: "hidden",
                                            transition: "box-shadow 0.2s",
                                            boxShadow: isExpanded ? "0 4px 12px rgba(0,0,0,0.08)" : "0 1px 3px rgba(0,0,0,0.04)"
                                        }}>
                                            {/* Main Row */}
                                            <div
                                                onClick={() => hasSnapshot && setExpandedId(isExpanded ? null : log.id)}
                                                style={{
                                                    padding: "14px 18px",
                                                    display: "flex", alignItems: "center", gap: "14px",
                                                    cursor: hasSnapshot ? "pointer" : "default",
                                                    flexWrap: "wrap"
                                                }}
                                            >
                                                {/* Time */}
                                                <div style={{ minWidth: "48px", fontSize: "13px", fontWeight: "600", color: "#475569" }}>
                                                    {formatTimestamp(log.timestamp)}
                                                </div>

                                                {/* Status */}
                                                <div style={{ minWidth: "60px" }}>
                                                    {log.success !== false ? (
                                                        <span style={{
                                                            background: '#ECFDF5', color: '#10B981',
                                                            padding: '3px 8px', borderRadius: '6px',
                                                            fontSize: '11px', fontWeight: '600'
                                                        }}>OK</span>
                                                    ) : (
                                                        <span style={{
                                                            background: '#FEF2F2', color: '#EF4444',
                                                            padding: '3px 8px', borderRadius: '6px',
                                                            fontSize: '11px', fontWeight: '600'
                                                        }} title={errorMsg}>FAIL</span>
                                                    )}
                                                </div>

                                                {/* Origin Badge */}
                                                <span style={getOriginStyle(log)}>
                                                    {getOriginLabel(log)}
                                                </span>

                                                {/* Worker */}
                                                <div style={{
                                                    fontSize: "13px", color: "#475569", minWidth: "100px",
                                                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                                                }} title={log.workerEmail || log.worker || ""}>
                                                    {getWorkerDisplay(log)}
                                                </div>

                                                {/* Building */}
                                                <div style={{
                                                    fontSize: "13px", fontWeight: "600", color: "#1E293B", minWidth: "90px"
                                                }}>
                                                    {getBuildingName(log.building)}
                                                </div>

                                                {/* Rooms */}
                                                <div style={{
                                                    fontSize: "12px", color: "#64748B", minWidth: "80px",
                                                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                                                }} title={Array.isArray(log.rooms) ? log.rooms.map(getRoomName).join(", ") : ""}>
                                                    {Array.isArray(log.rooms)
                                                        ? (log.rooms.length > 2
                                                            ? `${log.rooms.slice(0, 2).map(getRoomName).join(", ")} +${log.rooms.length - 2}`
                                                            : log.rooms.map(getRoomName).join(", "))
                                                        : getRoomName(log.room)}
                                                </div>

                                                {/* Target Dates */}
                                                <div style={{ fontSize: "12px", minWidth: "100px" }}>
                                                    <span style={{ color: "#2563EB", fontWeight: "600" }}>
                                                        {formatDateRange(period.dateFrom, period.dateTo)}
                                                    </span>
                                                    {period.totalDays > 0 && (
                                                        <span style={{ color: "#94A3B8", fontSize: "11px", marginLeft: "4px" }}>
                                                            ({period.totalDays}d)
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Price Change */}
                                                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" }}>
                                                    {log.oldPrice != null && log.newPrice != null ? (
                                                        <>
                                                            <span style={{ color: "#94A3B8", textDecoration: "line-through", fontSize: "12px" }}>
                                                                {formatPrice(log.oldPrice)}
                                                            </span>
                                                            <span style={{ color: "#CBD5E1", fontSize: "10px" }}>→</span>
                                                            <span style={{
                                                                fontWeight: "700",
                                                                color: log.newPrice > log.oldPrice ? "#EF4444" : log.newPrice < log.oldPrice ? "#10B981" : "#334155"
                                                            }}>
                                                                {formatPrice(log.newPrice)}
                                                            </span>
                                                            {log.oldPrice > 0 && (
                                                                <span style={{
                                                                    fontSize: "11px", fontWeight: "600",
                                                                    color: log.newPrice > log.oldPrice ? "#EF4444" : "#10B981"
                                                                }}>
                                                                    {log.newPrice > log.oldPrice ? "▲" : "▼"}{Math.abs(Math.round((log.newPrice - log.oldPrice) / log.oldPrice * 100))}%
                                                                </span>
                                                            )}
                                                        </>
                                                    ) : (
                                                        <span style={{ color: "#CBD5E1", fontSize: "12px" }}>—</span>
                                                    )}
                                                </div>

                                                {/* Expand Arrow */}
                                                {hasSnapshot && (
                                                    <span style={{
                                                        display: "inline-block",
                                                        transition: "transform 0.2s",
                                                        transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                                                        color: "#94A3B8", fontSize: "11px", marginLeft: "4px"
                                                    }}>▶</span>
                                                )}
                                            </div>

                                            {/* Error Message */}
                                            {log.success === false && errorMsg && (
                                                <div style={{
                                                    padding: "8px 18px 12px",
                                                    fontSize: "12px", color: "#EF4444",
                                                    borderTop: "1px solid #FEE2E2",
                                                    background: "#FEF2F2"
                                                }}>
                                                    {errorMsg}
                                                </div>
                                            )}

                                            {/* Notes (Beds24) */}
                                            {isBeds24 && log.notes && !hasSnapshot && (
                                                <div style={{
                                                    padding: "8px 18px 12px",
                                                    fontSize: "12px", color: "#92400E",
                                                    borderTop: "1px solid #FED7AA",
                                                    background: "#FFFBEB"
                                                }}>
                                                    {log.notes}
                                                </div>
                                            )}

                                            {/* Expanded Snapshot */}
                                            {isExpanded && hasSnapshot && (
                                                <div style={{
                                                    padding: "16px 18px 20px",
                                                    borderTop: "1px solid #E2E8F0",
                                                    background: "#F8FAFC"
                                                }}>
                                                    <div style={{
                                                        fontSize: "12px", fontWeight: "600", color: "#64748B",
                                                        marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px"
                                                    }}>
                                                        📋 {isBeds24 ? "DETECTED PRICE CHANGES" : "PRICE SNAPSHOT BY DATE"}
                                                        {log.adjustMode === "percent" && log.percentValue && (
                                                            <span style={{
                                                                background: log.percentValue > 0 ? "#FEF2F2" : "#ECFDF5",
                                                                color: log.percentValue > 0 ? "#EF4444" : "#10B981",
                                                                padding: "2px 8px", borderRadius: "4px", fontSize: "11px"
                                                            }}>
                                                                {log.percentValue > 0 ? "+" : ""}{log.percentValue}%
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div style={{
                                                        display: "grid",
                                                        gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                                                        gap: "10px"
                                                    }}>
                                                        {log.priceSnapshot.map((snap, idx) => (
                                                            <div key={idx} style={{
                                                                background: "white",
                                                                borderRadius: "10px",
                                                                padding: "10px 12px",
                                                                border: "1px solid #E2E8F0",
                                                                boxShadow: "0 1px 2px rgba(0,0,0,0.04)"
                                                            }}>
                                                                <div style={{
                                                                    fontSize: "11px", fontWeight: "700",
                                                                    color: "#4F46E5", marginBottom: "4px",
                                                                    display: "flex", justifyContent: "space-between"
                                                                }}>
                                                                    <span>{snap.date ? snap.date.slice(5).replace("-", "/") : "-"}</span>
                                                                    {snap.room && <span style={{ color: "#94A3B8", fontWeight: "500" }}>{getRoomName(snap.room)}</span>}
                                                                </div>
                                                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "4px" }}>
                                                                    <span style={{ fontSize: "12px", color: "#94A3B8", textDecoration: "line-through" }}>
                                                                        {formatPrice(snap.oldPrice)}
                                                                    </span>
                                                                    <span style={{ color: "#CBD5E1", fontSize: "10px" }}>→</span>
                                                                    <span style={{
                                                                        fontSize: "13px", fontWeight: "700",
                                                                        color: snap.newPrice > snap.oldPrice ? "#EF4444" : snap.newPrice < snap.oldPrice ? "#10B981" : "#1E293B"
                                                                    }}>
                                                                        {formatPrice(snap.newPrice)}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default PriceChangeHistory;
