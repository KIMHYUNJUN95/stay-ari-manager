import React, { useState, useEffect } from 'react';
import { collection, getDocs, query, where, doc, getDoc, setDoc, deleteDoc } from "firebase/firestore";
import { db } from '../firebase';

// ==========================================
// Design System (Apple Style / Premium)
// ==========================================
const styles = {
    container: {
        padding: '32px',
        maxWidth: '100%',
        margin: '0 auto',
        fontFamily: '-apple-system, BlinkMacSystemFont, "San Francisco", "Helvetica Neue", sans-serif',
        color: '#1D1D1F'
    },
    header: {
        marginBottom: '24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end'
    },
    title: {
        fontSize: '28px',
        fontWeight: '700',
        marginBottom: '8px',
        background: 'linear-gradient(135deg, #1D1D1F 0%, #434343 100%)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent'
    },
    subtitle: {
        fontSize: '15px',
        color: '#86868B',
        fontWeight: '500'
    },
    headerButtons: {
        display: 'flex',
        gap: '10px',
        alignItems: 'center'
    },
    card: {
        background: 'white',
        borderRadius: '20px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
        border: '1px solid rgba(0,0,0,0.04)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
    },
    controls: {
        padding: '20px 24px',
        borderBottom: '1px solid #F5F5F7',
        display: 'flex',
        gap: '16px',
        alignItems: 'center',
        background: '#FAFAFA'
    },
    select: {
        padding: '10px 14px',
        fontSize: '14px',
        fontWeight: '600',
        border: '1px solid #E5E5EA',
        borderRadius: '10px',
        outline: 'none',
        background: 'white',
        color: '#1D1D1F',
        minWidth: '160px',
        cursor: 'pointer'
    },
    tableWrapper: {
        overflowX: 'auto',
        maxHeight: 'calc(100vh - 240px)',
        position: 'relative'
    },
    table: {
        width: '100%',
        borderCollapse: 'separate',
        borderSpacing: 0,
        fontSize: '13px',
        minWidth: 'max-content'
    },
    th: {
        position: 'sticky',
        top: 0,
        background: '#F9FAFB',
        padding: '12px 8px',
        fontWeight: '600',
        color: '#6B7280',
        borderBottom: '1px solid #E5E5EA',
        borderRight: '1px solid #E5E5EA',
        textAlign: 'center',
        zIndex: 10,
        minWidth: '100px',
        fontSize: '12px',
        letterSpacing: '0.5px'
    },
    thCorner: {
        position: 'sticky',
        left: 0,
        top: 0,
        zIndex: 20,
        background: '#F9FAFB',
        borderBottom: '1px solid #E5E5EA',
        borderRight: '2px solid #E5E5EA',
        minWidth: '80px',
        textAlign: 'center',
        fontWeight: '700',
        color: '#374151',
        padding: '12px 8px'
    },
    tdDate: {
        position: 'sticky',
        left: 0,
        background: 'white',
        zIndex: 5,
        borderRight: '2px solid #E5E5EA',
        borderBottom: '1px solid #F3F4F6',
        fontWeight: '700',
        color: '#1F2937',
        fontSize: '13px',
        textAlign: 'center',
        padding: '8px 12px',
        minWidth: '80px'
    },
    td: {
        padding: '8px',
        borderBottom: '1px solid #F3F4F6',
        borderRight: '1px solid #F3F4F6',
        textAlign: 'center',
        verticalAlign: 'middle',
        height: '60px',
        background: 'white'
    },
    cellInner: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '2px'
    },
    revenueText: {
        fontSize: '13px',
        fontWeight: '700',
        color: '#111827',
        fontVariantNumeric: 'tabular-nums'
    },
    occupancyText: {
        fontSize: '11px',
        fontWeight: '500',
        color: '#6B7280',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '4px',
        marginTop: '2px'
    },
    diffPositive: { color: '#059669', fontSize: '10px', fontWeight: 'bold' },
    diffNegative: { color: '#DC2626', fontSize: '10px', fontWeight: 'bold' },
    loading: {
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '400px',
        color: '#9CA3AF',
        fontSize: '15px'
    },
    // Memo styles
    memoIcon: {
        position: 'absolute',
        left: '4px',
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '18px',
        height: '18px',
        borderRadius: '4px',
        background: '#FEF3C7',
        color: '#D97706',
        fontSize: '10px',
        cursor: 'pointer',
        transition: 'all 0.2s',
        zIndex: 5
    },
    memoIconHover: {
        background: '#FDE68A',
        transform: 'translateY(-50%) scale(1.1)'
    },
    dateCell: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '2px',
        position: 'relative'
    },
    // Modal styles
    modalOverlay: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
    },
    modal: {
        background: 'white',
        borderRadius: '16px',
        width: '100%',
        maxWidth: '480px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        overflow: 'hidden'
    },
    modalHeader: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '20px 24px',
        borderBottom: '1px solid #E5E5EA',
        background: '#FAFAFA'
    },
    modalTitle: {
        fontSize: '17px',
        fontWeight: '600',
        color: '#1D1D1F',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
    },
    modalClose: {
        width: '32px',
        height: '32px',
        borderRadius: '8px',
        border: 'none',
        background: '#F3F4F6',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '18px',
        color: '#6B7280',
        transition: 'all 0.2s'
    },
    modalBody: {
        padding: '24px'
    },
    modalTextarea: {
        width: '100%',
        minHeight: '150px',
        padding: '14px',
        border: '1px solid #E5E5EA',
        borderRadius: '12px',
        fontSize: '14px',
        fontFamily: 'inherit',
        resize: 'vertical',
        outline: 'none',
        transition: 'border-color 0.2s',
        boxSizing: 'border-box'
    },
    modalFooter: {
        display: 'flex',
        justifyContent: 'flex-end',
        gap: '12px',
        padding: '16px 24px',
        borderTop: '1px solid #E5E5EA',
        background: '#FAFAFA'
    },
    modalBtn: {
        padding: '10px 20px',
        borderRadius: '10px',
        border: 'none',
        fontSize: '14px',
        fontWeight: '600',
        cursor: 'pointer',
        transition: 'all 0.2s'
    },
    modalBtnPrimary: {
        background: 'linear-gradient(135deg, #007AFF 0%, #0055D4 100%)',
        color: 'white'
    },
    modalBtnSecondary: {
        background: '#F3F4F6',
        color: '#374151'
    },
    modalBtnDanger: {
        background: '#FEE2E2',
        color: '#DC2626'
    },
    addMemoBtn: {
        padding: '8px 16px',
        borderRadius: '8px',
        border: '1px solid #FCD34D',
        background: 'linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%)',
        fontSize: '13px',
        fontWeight: '600',
        cursor: 'pointer',
        color: '#92400E',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        transition: 'all 0.2s'
    }
};

export default function SalesLog() {
    const currentDate = new Date();
    const [selectedYear, setSelectedYear] = useState(currentDate.getFullYear());
    const [selectedMonth, setSelectedMonth] = useState(currentDate.getMonth() + 1);

    // 날짜 포맷팅 (YYYY-MM)
    const selectedMonthStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;

    // 월 이름 (숫자+영어 조합)
    const MONTHS = [
        '1 January', '2 February', '3 March', '4 April', '5 May', '6 June',
        '7 July', '8 August', '9 September', '10 October', '11 November', '12 December'
    ];

    // 연도 목록 (현재년도 ±5년)
    const YEARS = Array.from({length: 11}, (_, i) => currentDate.getFullYear() - 5 + i);

    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [targetMonths, setTargetMonths] = useState([]);

    // Memo states
    const [memos, setMemos] = useState({});
    const [showMemoModal, setShowMemoModal] = useState(false);
    const [selectedDate, setSelectedDate] = useState(null);
    const [memoText, setMemoText] = useState('');
    const [savingMemo, setSavingMemo] = useState(false);
    const [hoveredMemoDate, setHoveredMemoDate] = useState(null);

    // ==========================================
    // 1. Data Fetching
    // ==========================================
    const fetchLogs = async () => {
        setLoading(true);
        setLogs([]);
        try {
            const [year, month] = selectedMonthStr.split('-').map(Number);
            const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
            const lastDay = new Date(year, month, 0).getDate();
            const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

            const q = query(
                collection(db, "sales_logs"),
                where("__name__", ">=", startDate),
                where("__name__", "<=", endDate)
            );

            const snapshot = await getDocs(q);
            const fetchedLogs = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            fetchedLogs.sort((a, b) => a.id.localeCompare(b.id));
            setLogs(fetchedLogs);
        } catch (error) {
            console.error("Error fetching logs:", error);
        } finally {
            setLoading(false);
        }
    };

    // Fetch memos for the selected month
    const fetchMemos = async () => {
        try {
            const [year, month] = selectedMonthStr.split('-').map(Number);
            const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
            const lastDay = new Date(year, month, 0).getDate();
            const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

            const q = query(
                collection(db, "salesLogMemos"),
                where("__name__", ">=", startDate),
                where("__name__", "<=", endDate)
            );

            const snapshot = await getDocs(q);
            const memosMap = {};
            snapshot.docs.forEach(doc => {
                if (doc.data().memo) {
                    memosMap[doc.id] = doc.data().memo;
                }
            });
            setMemos(memosMap);
        } catch (error) {
            console.error("Error fetching memos:", error);
        }
    };

    useEffect(() => {
        fetchLogs();
        fetchMemos();
    }, [selectedMonthStr]);

    // ==========================================
    // 2. Identify Target Months (Columns)
    // ==========================================
    useEffect(() => {
        if (logs.length === 0) {
            setTargetMonths([]);
            return;
        }

        const allTargetMonths = new Set();
        logs.forEach(log => {
            if (log.monthlyStats) {
                Object.keys(log.monthlyStats).forEach(m => allTargetMonths.add(m));
            }
        });

        const sorted = Array.from(allTargetMonths).sort();
        setTargetMonths(sorted);
    }, [logs]);

    // ==========================================
    // 3. Helpers
    // ==========================================
    const formatCompactPrice = (val) => {
        if (!val) return "-";
        return val.toLocaleString();
    };

    const getDiff = (currentVal, rowIndex, targetMonthKey) => {
        if (rowIndex === 0) return 0;
        const prevLog = logs[rowIndex - 1];
        const prevVal = prevLog.monthlyStats?.[targetMonthKey]?.revenue || 0;
        return currentVal - prevVal;
    };

    const getDayLabel = (dateStr) => {
        return parseInt(dateStr.split('-')[2], 10);
    };

    // ==========================================
    // 4. Memo Functions
    // ==========================================
    const openMemoModal = (date, existingMemo = '') => {
        setSelectedDate(date);
        setMemoText(existingMemo);
        setShowMemoModal(true);
    };

    const closeMemoModal = () => {
        setShowMemoModal(false);
        setSelectedDate(null);
        setMemoText('');
    };

    const handleSaveMemo = async () => {
        if (!selectedDate) return;

        setSavingMemo(true);
        try {
            if (memoText.trim()) {
                await setDoc(doc(db, "salesLogMemos", selectedDate), {
                    memo: memoText.trim(),
                    updatedAt: new Date().toISOString()
                });
                setMemos(prev => ({ ...prev, [selectedDate]: memoText.trim() }));
            } else {
                // Delete memo if empty
                await deleteDoc(doc(db, "salesLogMemos", selectedDate));
                setMemos(prev => {
                    const newMemos = { ...prev };
                    delete newMemos[selectedDate];
                    return newMemos;
                });
            }
            closeMemoModal();
        } catch (error) {
            console.error("Failed to save memo:", error);
            alert("Failed to save memo.");
        } finally {
            setSavingMemo(false);
        }
    };

    const handleDeleteMemo = async () => {
        if (!selectedDate) return;
        if (!window.confirm("Delete this memo?")) return;

        setSavingMemo(true);
        try {
            await deleteDoc(doc(db, "salesLogMemos", selectedDate));
            setMemos(prev => {
                const newMemos = { ...prev };
                delete newMemos[selectedDate];
                return newMemos;
            });
            closeMemoModal();
        } catch (error) {
            console.error("Failed to delete memo:", error);
            alert("Failed to delete memo.");
        } finally {
            setSavingMemo(false);
        }
    };

    const openAddMemoModal = () => {
        // Default to today's date in the selected month, or first day
        const today = new Date();
        const [year, month] = selectedMonthStr.split('-').map(Number);
        let defaultDate;

        if (today.getFullYear() === year && today.getMonth() + 1 === month) {
            defaultDate = `${year}-${String(month).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        } else {
            defaultDate = `${year}-${String(month).padStart(2, '0')}-01`;
        }

        openMemoModal(defaultDate, '');
    };

    return (
        <div style={styles.container}>
            {/* Header */}
            <div style={styles.header}>
                <div>
                    <h1 style={styles.title}>Daily Sales Log</h1>
                    <div style={styles.subtitle}>
                        Monitor booking pace and occupancy changes day by day
                    </div>
                </div>
                <div style={styles.headerButtons}>
                    <button
                        onClick={openAddMemoModal}
                        style={styles.addMemoBtn}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                        Add Memo
                    </button>
                    <button
                        onClick={async () => {
                            const date = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
                            if (!window.confirm(`Delete sales log for ${date}?\nThis cannot be undone.`)) return;

                            try {
                                const response = await fetch('https://us-central1-my-booking-app-3f0e7.cloudfunctions.net/deleteSalesLog', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ date })
                                });
                                const result = await response.json();
                                if (result.success) {
                                    alert(`✓ Sales log deleted for ${date}`);
                                    fetchLogs();
                                } else {
                                    alert('Failed: ' + (result.error || 'Unknown error'));
                                }
                            } catch (err) {
                                alert('Connection error: ' + err.message);
                            }
                        }}
                        style={{
                            padding: '8px 16px',
                            borderRadius: '8px',
                            border: '1px solid #FEE2E2',
                            background: 'white',
                            fontSize: '13px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            color: '#DC2626',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px'
                        }}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14"/>
                        </svg>
                        Delete Log
                    </button>
                    <button
                        onClick={async () => {
                            const date = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
                            if (!window.confirm(`Re-generate sales log for ${date}?\nThis will overwrite existing data.`)) return;

                            try {
                                const response = await fetch('https://us-central1-my-booking-app-3f0e7.cloudfunctions.net/recordSalesLog?date=' + date, {
                                    method: 'GET'
                                });
                                const result = await response.json();
                                if (result.success) {
                                    alert(`✓ Sales log re-generated for ${date}`);
                                    fetchLogs();
                                } else {
                                    alert('Failed: ' + (result.error || 'Unknown error'));
                                }
                            } catch (err) {
                                alert('Connection error: ' + err.message);
                            }
                        }}
                        style={{
                            padding: '8px 16px',
                            borderRadius: '8px',
                            border: '1px solid #DBEAFE',
                            background: 'linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)',
                            fontSize: '13px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            color: 'white',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            boxShadow: '0 2px 8px rgba(59, 130, 246, 0.15)'
                        }}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                        </svg>
                        Re-generate
                    </button>
                    <button
                        onClick={() => { fetchLogs(); fetchMemos(); }}
                        style={{
                            padding: '8px 16px',
                            borderRadius: '8px',
                            border: '1px solid #E5E7EB',
                            background: 'white',
                            fontSize: '13px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            color: '#374151',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px'
                        }}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M23 4v6h-6"/>
                            <path d="M1 20v-6h6"/>
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                        </svg>
                        Refresh
                    </button>
                </div>
            </div>

            <div style={styles.card}>
                {/* Controls */}
                <div style={styles.controls}>
                    <label style={{ fontSize: '14px', fontWeight: '600', color: '#1D1D1F' }}>
                        Viewing Log For:
                    </label>
                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <select
                            value={selectedYear}
                            onChange={(e) => setSelectedYear(Number(e.target.value))}
                            style={{
                                ...styles.select,
                                padding: '8px 12px',
                                fontSize: '14px'
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
                                ...styles.select,
                                padding: '8px 12px',
                                fontSize: '14px'
                            }}
                        >
                            {MONTHS.map((month, index) => (
                                <option key={index + 1} value={index + 1}>{month}</option>
                            ))}
                        </select>
                    </div>
                    <span style={{ fontSize: '13px', color: '#6B7280', borderLeft: '1px solid #E5E5EA', paddingLeft: '16px' }}>
                        Tip: Scroll horizontally to see future months
                    </span>
                </div>

                {/* Content */}
                {loading ? (
                    <div style={styles.loading}>Loading data...</div>
                ) : logs.length === 0 ? (
                    <div style={{ padding: '60px', textAlign: 'center', color: '#6B7280' }}>
                        <div style={{ fontSize: '40px', marginBottom: '16px' }}>📭</div>
                        <div>No logs found for <strong>{selectedMonthStr}</strong></div>
                        <div style={{ fontSize: '13px', marginTop: '8px' }}>
                            Logs are recorded automatically every midnight.
                        </div>
                    </div>
                ) : (
                    <div style={styles.tableWrapper}>
                        <table style={styles.table}>
                            <thead>
                                <tr>
                                    <th style={styles.thCorner}>Day</th>
                                    {targetMonths.map(tm => {
                                        const [y, m] = tm.split('-');
                                        const date = new Date(y, m - 1);
                                        const label = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                                        return <th key={tm} style={styles.th}>{label}</th>;
                                    })}
                                </tr>
                            </thead>
                            <tbody>
                                {logs.map((log, rowIndex) => {
                                    const dayLabel = getDayLabel(log.id);
                                    const hasMemo = memos[log.id];

                                    return (
                                        <tr key={log.id}>
                                            <td style={styles.tdDate}>
                                                <div style={styles.dateCell}>
                                                    {hasMemo && (
                                                        <span
                                                            style={{
                                                                ...styles.memoIcon,
                                                                ...(hoveredMemoDate === log.id ? styles.memoIconHover : {})
                                                            }}
                                                            onMouseEnter={() => setHoveredMemoDate(log.id)}
                                                            onMouseLeave={() => setHoveredMemoDate(null)}
                                                            onClick={() => openMemoModal(log.id, memos[log.id])}
                                                            title={memos[log.id]}
                                                        >
                                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                                            </svg>
                                                        </span>
                                                    )}
                                                    <span style={{ fontSize: '14px', fontWeight: '600', color: '#1D1D1F' }}>{dayLabel}</span>
                                                    <div style={{ fontSize: '10px', color: '#9CA3AF', fontWeight: '400' }}>
                                                        {new Date(log.id).toLocaleDateString('en-US', { weekday: 'short' })}
                                                    </div>
                                                </div>
                                            </td>

                                            {targetMonths.map(tm => {
                                                const stat = log.monthlyStats?.[tm];
                                                const revenue = stat?.revenue || 0;
                                                const occupancy = stat?.occupancy || 0;
                                                const diff = getDiff(revenue, rowIndex, tm);

                                                return (
                                                    <td key={`${log.id}-${tm}`} style={styles.td}>
                                                        <div style={styles.cellInner}>
                                                            <div style={styles.revenueText}>
                                                                {revenue > 0 ? `¥${formatCompactPrice(revenue)}` : '-'}
                                                            </div>
                                                            <div style={styles.occupancyText}>
                                                                <span>{occupancy > 0 ? `${occupancy.toFixed(1)}%` : '-'}</span>
                                                                {diff !== 0 && (
                                                                    <span style={{
                                                                        marginLeft: '4px',
                                                                        ...(diff > 0 ? styles.diffPositive : styles.diffNegative)
                                                                    }}>
                                                                        {diff > 0 ? '▲' : '▼'}{formatCompactPrice(Math.abs(diff))}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <div style={{ marginTop: '24px', textAlign: 'center', fontSize: '12px', color: '#9CA3AF' }}>
                CONFIDENTIAL | Generated by HARU Dashboard
            </div>

            {/* Memo Modal */}
            {showMemoModal && (
                <div style={styles.modalOverlay} onClick={closeMemoModal}>
                    <div style={styles.modal} onClick={e => e.stopPropagation()}>
                        <div style={styles.modalHeader}>
                            <div style={styles.modalTitle}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2">
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                </svg>
                                {memos[selectedDate] ? 'Edit Memo' : 'Add Memo'}
                            </div>
                            <button
                                style={styles.modalClose}
                                onClick={closeMemoModal}
                            >
                                ×
                            </button>
                        </div>
                        <div style={styles.modalBody}>
                            <div style={{ marginBottom: '16px' }}>
                                <label style={{
                                    display: 'block',
                                    fontSize: '13px',
                                    fontWeight: '600',
                                    color: '#374151',
                                    marginBottom: '8px'
                                }}>
                                    Date
                                </label>
                                <input
                                    type="date"
                                    value={selectedDate || ''}
                                    onChange={(e) => setSelectedDate(e.target.value)}
                                    style={{
                                        padding: '10px 14px',
                                        border: '1px solid #E5E5EA',
                                        borderRadius: '10px',
                                        fontSize: '14px',
                                        fontWeight: '500',
                                        outline: 'none',
                                        width: '100%',
                                        boxSizing: 'border-box'
                                    }}
                                />
                            </div>
                            <div>
                                <label style={{
                                    display: 'block',
                                    fontSize: '13px',
                                    fontWeight: '600',
                                    color: '#374151',
                                    marginBottom: '8px'
                                }}>
                                    Memo
                                </label>
                                <textarea
                                    value={memoText}
                                    onChange={(e) => setMemoText(e.target.value)}
                                    placeholder="Enter your memo here..."
                                    style={styles.modalTextarea}
                                    autoFocus
                                />
                            </div>
                        </div>
                        <div style={styles.modalFooter}>
                            {memos[selectedDate] && (
                                <button
                                    onClick={handleDeleteMemo}
                                    disabled={savingMemo}
                                    style={{
                                        ...styles.modalBtn,
                                        ...styles.modalBtnDanger,
                                        marginRight: 'auto'
                                    }}
                                >
                                    Delete
                                </button>
                            )}
                            <button
                                onClick={closeMemoModal}
                                style={{
                                    ...styles.modalBtn,
                                    ...styles.modalBtnSecondary
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSaveMemo}
                                disabled={savingMemo}
                                style={{
                                    ...styles.modalBtn,
                                    ...styles.modalBtnPrimary,
                                    opacity: savingMemo ? 0.6 : 1
                                }}
                            >
                                {savingMemo ? 'Saving...' : 'Save'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
