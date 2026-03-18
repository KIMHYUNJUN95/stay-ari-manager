import React, { useState, useEffect } from 'react';
import { collection, query, where, orderBy, limit, getDocs } from "firebase/firestore";
import { db } from '../firebase';
import { useUser } from '../contexts/UserContext';

import { BUILDING_NAMES_EN } from '../constants/buildingData';

// -----------------------------------------------------------------------------
// [COMPONENT] PriceChangeHistory (Haru Studio Theme)
// -----------------------------------------------------------------------------

function PriceChangeHistory() {
    const { companyId } = useUser();
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expandedId, setExpandedId] = useState(null);

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

    const formatTimestamp = (ts) => {
        if (!ts) return "-";
        const date = ts.toDate ? ts.toDate() : new Date(ts);
        return date.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
    };

    const formatDateRange = (dateFrom, dateTo) => {
        if (!dateFrom) return "-";
        // YYYY-MM-DD -> MM/DD format
        const from = dateFrom.slice(5).replace("-", "/");
        const to = dateTo ? dateTo.slice(5).replace("-", "/") : from;
        if (from === to) return from;
        return `${from} ~ ${to}`;
    };

    const formatPrice = (p) => {
        if (!p && p !== 0) return "-";
        return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 }).format(p);
    };

    const getPriceChangeIndicator = (oldPrice, newPrice) => {
        if (!oldPrice || !newPrice) return null;
        const diff = newPrice - oldPrice;
        const percent = oldPrice > 0 ? Math.round((diff / oldPrice) * 100) : 0;

        if (diff > 0) {
            return <span style={{ color: "#EF4444", fontSize: "11px", marginLeft: "4px", fontWeight: "600" }}>▲{percent}%</span>;
        } else if (diff < 0) {
            return <span style={{ color: "#10B981", fontSize: "11px", marginLeft: "4px", fontWeight: "600" }}>▼{Math.abs(percent)}%</span>;
        }
        return null;
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
                return {
                    dateFrom: formatKey(first),
                    dateTo: formatKey(last),
                    totalDays: dateKeys.length
                };
            }
        }
        return { dateFrom: null, dateTo: null, totalDays: 0 };
    };

    // Helper to translate building name
    const getBuildingName = (building) => BUILDING_NAMES_EN[building] || building;

    // Helper to format room name (remove "호")
    const getRoomName = (room) => room ? String(room).replace("호", "") : "-";

    // Styles (Haru Studio Enterprise Theme)
    const styles = {
        container: {
            padding: '32px',
            background: '#FFFFFF',
            minHeight: '100vh',
            fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
        },
        header: {
            marginBottom: '32px'
        },
        titleGroup: { display: 'flex', alignItems: 'center', gap: '12px' },
        icon: {
            fontSize: '28px',
            background: '#EEF2FF',
            width: '48px',
            height: '48px',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            borderRadius: '12px',
            color: '#4F46E5'
        },
        title: { fontSize: '24px', fontWeight: '700', color: '#0F172A', margin: 0, letterSpacing: '-0.5px' },
        subtitle: { fontSize: '14px', color: '#64748B', marginTop: '4px', fontWeight: '500' },

        tableContainer: {
            overflowX: "auto",
            background: "#FFFFFF",
            borderRadius: "16px",
            border: "1px solid #E2E8F0"
        },
        th: {
            padding: "16px",
            textAlign: "left",
            fontSize: "12px",
            fontWeight: "700",
            color: "#64748B",
            textTransform: "uppercase",
            borderBottom: "1px solid #E2E8F0",
            background: "#F8FAFC",
            whiteSpace: "nowrap"
        },
        td: {
            padding: "16px",
            fontSize: "14px",
            color: "#334155",
            borderBottom: "1px solid #F1F5F9",
            verticalAlign: "middle"
        },
        row: (isExpanded) => ({
            background: isExpanded ? "#F8FAFC" : "transparent",
            cursor: "pointer",
            transition: "background 0.2s"
        }),
        badge: (type, text) => ({
            background: type === 'success' ? '#ECFDF5' : type === 'fail' ? '#FEF2F2' : '#EFF6FF',
            color: type === 'success' ? '#10B981' : type === 'fail' ? '#EF4444' : '#3B82F6',
            padding: '4px 10px',
            borderRadius: '6px',
            fontSize: '11px',
            fontWeight: '600',
            textTransform: 'uppercase'
        })
    };

    return (
        <div style={styles.container}>
            <div style={styles.header}>
                <div style={styles.titleGroup}>
                    <div style={styles.icon}>💰</div>
                    <div>
                        <h1 style={styles.title}>Price Change History</h1>
                        <p style={styles.subtitle}>Recent 500 price updates and system logs</p>
                    </div>
                </div>
            </div>

            <div style={styles.tableContainer}>
                {loading ? (
                    <div style={{ padding: "60px", textAlign: "center", color: "#94A3B8" }}>
                        Loading history...
                    </div>
                ) : logs.length === 0 ? (
                    <div style={{ padding: "60px", textAlign: "center", color: "#64748B" }}>
                        <div style={{ fontSize: "32px", marginBottom: "16px" }}>🦕</div>
                        No price change history found.
                    </div>
                ) : (
                    <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                        <thead>
                            <tr>
                                <th style={{ ...styles.th, width: "40px" }}></th>
                                <th style={styles.th}>Date & Time</th>
                                <th style={styles.th}>Status</th>
                                <th style={styles.th}>Updater</th>
                                <th style={styles.th}>System</th>
                                <th style={styles.th}>Property</th>
                                <th style={styles.th}>Rooms</th>
                                <th style={styles.th}>Target Dates</th>
                                <th style={{ ...styles.th, textAlign: "right" }}>Old Price</th>
                                <th style={{ ...styles.th, textAlign: "right" }}>New Price</th>
                            </tr>
                        </thead>
                        <tbody>
                            {logs.map(log => {
                                const period = extractPeriodFromDates(log);
                                const isExpanded = expandedId === log.id;
                                const hasSnapshot = log.priceSnapshot && log.priceSnapshot.length > 0;

                                return (
                                    <React.Fragment key={log.id}>
                                        <tr
                                            style={styles.row(isExpanded)}
                                            onClick={() => hasSnapshot && setExpandedId(isExpanded ? null : log.id)}
                                        >
                                            <td style={{ ...styles.td, width: "40px", textAlign: "center" }}>
                                                {hasSnapshot && (
                                                    <span style={{
                                                        display: "inline-block",
                                                        transition: "transform 0.2s",
                                                        transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                                                        color: "#94A3B8",
                                                        fontSize: "12px"
                                                    }}>
                                                        ▶
                                                    </span>
                                                )}
                                            </td>
                                            <td style={{ ...styles.td, color: "#1E293B", fontWeight: "500" }}>{formatTimestamp(log.timestamp)}</td>
                                            <td style={styles.td}>
                                                {log.success ? (
                                                    <span style={styles.badge('success')}>Success</span>
                                                ) : (
                                                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                                        <span style={{ ...styles.badge('fail'), width: "fit-content" }}>Failed</span>
                                                        <span style={{ fontSize: "11px", color: "#EF4444", maxWidth: "150px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={log.error}>
                                                            {log.error}
                                                        </span>
                                                    </div>
                                                )}
                                            </td>
                                            <td style={styles.td}>
                                                <div style={{ fontSize: "13px", color: "#475569" }} title={log.workerEmail || ""}>
                                                    {log.worker && (log.worker.includes("Beds24 시스템") || log.worker.includes("Beds24 System")) ? "Beds24 System" : (log.worker || "System")}
                                                </div>
                                            </td>
                                            <td style={styles.td}>
                                                <span style={{
                                                    background: log.origin?.includes("Beds24") ? "#FFF7ED" : "#EFF6FF",
                                                    color: log.origin?.includes("Beds24") ? "#F59E0B" : "#3B82F6",
                                                    padding: "4px 8px",
                                                    borderRadius: "6px",
                                                    fontSize: "11px",
                                                    fontWeight: "600"
                                                }}>
                                                    {log.origin && log.origin.includes("외부 수정") ? "Beds24 (Ext. Edit)" : (log.origin === "관리자 대시보드" ? "Admin Dashboard" : (log.origin || "Manual"))}
                                                </span>
                                            </td>
                                            <td style={{ ...styles.td, fontWeight: "600" }}>
                                                {getBuildingName(log.building)}
                                            </td>
                                            <td style={styles.td}>
                                                {Array.isArray(log.rooms) ? (
                                                    <div title={log.rooms.map(getRoomName).join(", ")} style={{ maxWidth: "150px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                        {log.rooms.length > 2
                                                            ? `${log.rooms.slice(0, 2).map(getRoomName).join(", ")} +${log.rooms.length - 2}`
                                                            : log.rooms.map(getRoomName).join(", ")
                                                        }
                                                    </div>
                                                ) : getRoomName(log.room)}
                                            </td>
                                            <td style={styles.td}>
                                                <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                                    <span style={{ color: "#2563EB", fontWeight: "600", fontSize: "13px" }}>
                                                        {formatDateRange(period.dateFrom, period.dateTo)}
                                                    </span>
                                                    {period.totalDays > 0 && (
                                                        <span style={{ color: "#94A3B8", fontSize: "11px" }}>
                                                            ({period.totalDays} days)
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td style={{ ...styles.td, textAlign: "right", color: "#64748B" }}>
                                                {formatPrice(log.oldPrice)}
                                            </td>
                                            <td style={{ ...styles.td, textAlign: "right" }}>
                                                <span style={{ fontWeight: "700", color: "#1E293B" }}>
                                                    {formatPrice(log.newPrice)}
                                                </span>
                                                {getPriceChangeIndicator(log.oldPrice, log.newPrice)}
                                            </td>
                                        </tr>

                                        {/* Expanded Snapshot Details */}
                                        {isExpanded && hasSnapshot && (
                                            <tr>
                                                <td colSpan="10" style={{ padding: "0", background: "#F8FAFC" }}>
                                                    <div style={{ padding: "20px 24px 24px 64px", borderBottom: "1px solid #E2E8F0" }}>
                                                        <div style={{ fontSize: "12px", fontWeight: "600", color: "#64748B", marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
                                                            📋 PRICE SNAPSHOT BY DATE
                                                            {log.adjustMode === "percent" && log.percentValue && (
                                                                <span style={{ background: log.percentValue > 0 ? "#FEF2F2" : "#ECFDF5", color: log.percentValue > 0 ? "#EF4444" : "#10B981", padding: "2px 8px", borderRadius: "4px", fontSize: "11px" }}>
                                                                    {log.percentValue > 0 ? "+" : ""}{log.percentValue}% Adjustment
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "12px" }}>
                                                            {log.priceSnapshot.map((snap, idx) => (
                                                                <div key={idx} style={{ background: "white", borderRadius: "10px", padding: "12px", border: "1px solid #E2E8F0", boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}>
                                                                    <div style={{ fontSize: "12px", fontWeight: "600", color: "#4F46E5", marginBottom: "6px" }}>
                                                                        {snap.date ? snap.date.slice(5).replace("-", "/") : "-"}
                                                                    </div>
                                                                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "4px" }}>
                                                                        <span style={{ fontSize: "12px", color: "#94A3B8", textDecoration: "line-through" }}>
                                                                            {formatPrice(snap.oldPrice)}
                                                                        </span>
                                                                        <span style={{ color: "#CBD5E1", fontSize: "10px" }}>→</span>
                                                                        <span style={{ fontSize: "13px", fontWeight: "700", color: snap.newPrice > snap.oldPrice ? "#EF4444" : snap.newPrice < snap.oldPrice ? "#10B981" : "#1E293B" }}>
                                                                            {formatPrice(snap.newPrice)}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}

export default PriceChangeHistory;
