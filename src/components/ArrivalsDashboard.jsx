import React, { useState, useEffect } from 'react';

// ==============================
// 🎨 스타일 & 모바일 유틸리티
// ==============================
const styles = {
    container: { padding: "0" },
    header: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px", marginBottom: "24px" },
    title: { fontSize: "24px", fontWeight: "700", color: "#0F172A", letterSpacing: "-0.5px", margin: 0 },
    controls: { display: "flex", gap: "10px", alignItems: "center" },

    // 검색창 & 입력폼
    searchInput: { padding: "10px 16px", borderRadius: "12px", border: "1px solid #E2E8F0", fontSize: "14px", width: "220px", transition: "all 0.2s", outline: "none", background: "white", boxShadow: "0 1px 2px rgba(0,0,0,0.05)" },
    dateInput: { padding: "10px 14px", borderRadius: "12px", border: "1px solid #E2E8F0", fontSize: "14px", fontWeight: "600", color: "#334155", background: "white", cursor: "pointer" },
    refreshBtn: { padding: "10px 16px", borderRadius: "12px", border: "none", background: "#4F46E5", color: "white", fontSize: "14px", fontWeight: "600", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", boxShadow: "0 4px 6px -1px rgba(79, 70, 229, 0.2)" },

    // 섹션 카드
    sectionCard: { background: "white", borderRadius: "16px", border: "1px solid #F1F5F9", boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05)", marginBottom: "24px", overflow: "hidden" },
    sectionHeader: { padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #F8FAFC" },
    sectionTitle: { fontSize: "16px", fontWeight: "700", margin: 0, display: "flex", alignItems: "center", gap: "8px" },
    badge: { padding: "4px 10px", borderRadius: "20px", fontSize: "12px", fontWeight: "700" },

    // PC 테이블
    table: { width: "100%", borderCollapse: "collapse", fontSize: "14px" },
    th: { textAlign: "left", padding: "16px 24px", color: "#64748B", fontWeight: "600", borderBottom: "1px solid #F1F5F9", background: "#F8FAFC", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.05em" },
    td: { padding: "16px 24px", color: "#334155", borderBottom: "1px solid #F8FAFC" },

    // 모바일 카드
    mobileCardList: { display: "flex", flexDirection: "column", gap: "12px", padding: "16px" },
    mobileCard: { background: "white", border: "1px solid #E2E8F0", borderRadius: "12px", padding: "16px", display: "flex", flexDirection: "column", gap: "12px", boxShadow: "0 2px 4px rgba(0,0,0,0.02)" },
    mobileCardHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
    mobileRoom: { fontSize: "16px", fontWeight: "700", color: "#0F172A" },
    mobileName: { fontSize: "15px", fontWeight: "600", marginTop: "2px" },
    mobileInfoRow: { display: "flex", justifyContent: "space-between", fontSize: "13px", color: "#64748B" },
    label: { color: "#94A3B8", marginRight: "6px" }
};

// 건물 이름 영어 매핑
const BUILDING_NAMES_EN = {
    "아라키초A": "Arakicho A",
    "아라키초B": "Arakicho B",
    "다이쿄초": "Daikyocho",
    "가부키초": "Kabukicho",
    "다카다노바바": "Takadanobaba",
    "오쿠보A동": "Okubo A",
    "오쿠보B동": "Okubo B",
    "오쿠보C동": "Okubo C",
    "사노시": "Sano",
    "사노": "Sano"
};

const getBuildingEN = (name) => BUILDING_NAMES_EN[name] || name;

// Format building/room display - Okubo properties are standalone houses
const formatBuildingRoom = (building, room) => {
    const buildingEN = getBuildingEN(building);
    // Okubo properties are standalone houses, show only building name
    if (building && (building.includes("오쿠보") || building.includes("사노"))) {
        return buildingEN;
    }
    // Other properties show "Building · Room"
    return `${buildingEN} · ${room}`;
};

// 건물 정렬
const BUILDING_ORDER = ["아라키초A", "아라키초B", "다이쿄초", "가부키초", "다카다노바바", "오쿠보A동", "오쿠보B동", "오쿠보C동"];
const sortByBuildingOrder = (list) => {
    return [...list].sort((a, b) => {
        const indexA = BUILDING_ORDER.indexOf(a.building);
        const indexB = BUILDING_ORDER.indexOf(b.building);
        const orderA = indexA === -1 ? 999 : indexA;
        const orderB = indexB === -1 ? 999 : indexB;
        return orderA - orderB;
    });
};

const formatPrice = (price) => {
    if (!price) return "¥0";
    const num = parseFloat(String(price).replace(/[^0-9.-]+/g, ""));
    if (isNaN(num)) return "¥0";
    return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(num);
};

const getPlatformDisplay = (platform) => {
    const p = (platform || "").toLowerCase();
    if (p.includes("booking")) return <span style={{ color: "#003580", fontWeight: "700" }}>Booking.com</span>;
    if (p.includes("airbnb")) return <span style={{ color: "#FF385C", fontWeight: "700" }}>Airbnb</span>;
    return <span style={{ color: "#64748B" }}>{platform || "Unknown"}</span>;
};

// ==============================
// 📋 Guest Detail Modal
// ==============================
const GuestDetailModal = ({ guest, onClose }) => {
    if (!guest) return null;

    const InfoRow = ({ label, value, icon }) => (
        <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid #F1F5F9" }}>
            <span style={{ color: "#64748B", fontSize: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
                <span>{icon}</span> {label}
            </span>
            <span style={{ fontWeight: "600", fontSize: "14px", color: "#334155", textAlign: "right" }}>
                {value || "-"}
            </span>
        </div>
    );

    return (
        <div style={{
            position: "fixed", top: 0, left: 0, width: "100%", height: "100%",
            background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)",
            display: "flex", justifyContent: "center", alignItems: "center", zIndex: 9999, padding: "20px"
        }} onClick={onClose}>
            <div style={{
                background: "white", width: "100%", maxWidth: "480px", borderRadius: "24px",
                boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)", overflow: "hidden",
                animation: "slideUp 0.3s ease-out"
            }} onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div style={{ background: "linear-gradient(135deg, #4F46E5 0%, #4338CA 100%)", padding: "24px", color: "white" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div>
                            <h2 style={{ fontSize: "20px", fontWeight: "700", margin: 0 }}>{guest.guestName || "No Name"}</h2>
                            <p style={{ margin: "4px 0 0", opacity: 0.9, fontSize: "14px" }}>{formatBuildingRoom(guest.building, guest.room)}</p>
                        </div>
                        <button onClick={onClose} style={{ background: "rgba(255,255,255,0.2)", border: "none", borderRadius: "50%", width: "32px", height: "32px", color: "white", fontSize: "20px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>&times;</button>
                    </div>
                </div>

                {/* Body */}
                <div style={{ padding: "24px", maxHeight: "60vh", overflowY: "auto" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "24px" }}>
                        <div style={{ background: "#F8FAFC", padding: "12px", borderRadius: "12px", textAlign: "center" }}>
                            <div style={{ fontSize: "12px", color: "#64748B", marginBottom: "4px" }}>Check-in</div>
                            <div style={{ fontWeight: "700", color: "#0F172A" }}>{guest.arrival}</div>
                        </div>
                        <div style={{ background: "#F8FAFC", padding: "12px", borderRadius: "12px", textAlign: "center" }}>
                            <div style={{ fontSize: "12px", color: "#64748B", marginBottom: "4px" }}>Check-out</div>
                            <div style={{ fontWeight: "700", color: "#0F172A" }}>{guest.departure}</div>
                        </div>
                    </div>

                    <InfoRow icon="👥" label="Guests" value={`${guest.numAdult || 0} Adults, ${guest.numChild || 0} Children`} />
                    <InfoRow icon="📱" label="Platform" value={guest.platform} />
                    <InfoRow icon="📞" label="Phone" value={guest.guestPhone} />
                    <InfoRow icon="💰" label="Total Price" value={formatPrice(guest.totalPrice || guest.price)} />
                    <InfoRow icon="🕐" label="Arrival Time" value={guest.arrivalTime} />

                    {guest.guestComments && (
                        <div style={{ marginTop: "20px" }}>
                            <div style={{ fontSize: "13px", fontWeight: "600", color: "#64748B", marginBottom: "8px" }}>Guest Comments</div>
                            <div style={{ background: "#F1F5F9", padding: "12px", borderRadius: "12px", fontSize: "14px", color: "#334155", lineHeight: "1.5" }}>
                                {guest.guestComments}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div style={{ padding: "16px 24px", borderTop: "1px solid #F1F5F9", background: "#F8FAFC" }}>
                    <button onClick={onClose} style={{ width: "100%", padding: "12px", background: "white", border: "1px solid #E2E8F0", borderRadius: "12px", fontWeight: "600", color: "#334155", cursor: "pointer" }}>
                        Close Detail
                    </button>
                </div>
            </div>
            <style>{`@keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>
        </div>
    );
};

// ==============================
// 🧩 메인 컴포넌트
// ==============================
const ArrivalsDashboard = () => {
    const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
    const [loading, setLoading] = useState(false);
    const [guestList, setGuestList] = useState([]);
    const [error, setError] = useState("");
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
    const [selectedGuest, setSelectedGuest] = useState(null);

    // 모바일 감지
    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // 데이터 호출
    const GET_ARRIVALS_URL = "https://us-central1-my-booking-app-3f0e7.cloudfunctions.net/getTodayArrivals";
    const fetchTodayArrivals = async () => {
        setLoading(true);
        setError("");
        try {
            const response = await fetch(GET_ARRIVALS_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ date: selectedDate })
            });
            const result = await response.json();
            if (result.success && Array.isArray(result.data)) {
                setGuestList(result.data);
            } else {
                setGuestList([]);
            }
        } catch (err) {
            console.error(err);
            setError("Failed to fetch data");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTodayArrivals();
    }, [selectedDate]);

    // 필터링
    const todayArrivals = sortByBuildingOrder(guestList.filter(guest => guest.arrival === selectedDate));
    const todayDepartures = sortByBuildingOrder(guestList.filter(guest => guest.departure === selectedDate));

    return (
        <div style={styles.container}>
            {/* Modal */}
            {selectedGuest && <GuestDetailModal guest={selectedGuest} onClose={() => setSelectedGuest(null)} />}

            {/* Header */}
            <div style={styles.header}>
                <div>
                    <h2 style={styles.title}>Arrivals & Departures</h2>
                    <p style={{ margin: "4px 0 0", color: "#64748B", fontSize: "14px" }}>Manage daily check-ins and check-outs</p>
                </div>
                <div style={styles.controls}>
                    <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} style={styles.dateInput} />
                    <button onClick={fetchTodayArrivals} style={styles.refreshBtn}><span>🔄</span> {isMobile ? "" : "Refresh"}</button>
                </div>
            </div>

            {/* Error & Loading */}
            {error && <div style={{ padding: "16px", background: "#FEF2F2", color: "#DC2626", borderRadius: "12px", marginBottom: "20px" }}>⚠️ {error}</div>}
            {loading && <div style={{ textAlign: "center", padding: "40px", color: "#94A3B8" }}>Loading schedule...</div>}

            {/* Content */}
            {!loading && (
                <>
                    {/* Arrivals */}
                    <div style={{ ...styles.sectionCard, borderTop: "4px solid #4F46E5" }}>
                        <div style={styles.sectionHeader}>
                            <h3 style={{ ...styles.sectionTitle, color: "#4F46E5" }}>
                                📥 Expected Arrivals
                                <span style={{ ...styles.badge, background: "#EEF2FF", color: "#4F46E5" }}>{todayArrivals.length}</span>
                            </h3>
                        </div>

                        {/* PC Table */}
                        {!isMobile && (
                            <table style={styles.table}>
                                <thead>
                                    <tr>
                                        <th style={styles.th}>Property / Room</th>
                                        <th style={styles.th}>Guest Name</th>
                                        <th style={styles.th}>Pax</th>
                                        <th style={styles.th}>Platform</th>
                                        <th style={styles.th}>Stay Dates</th>
                                        <th style={styles.th}>Total</th>
                                        <th style={styles.th}>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {todayArrivals.length === 0 ? (
                                        <tr><td colSpan="7" style={{ ...styles.td, textAlign: "center", padding: "40px" }}>No arrivals scheduled.</td></tr>
                                    ) : (
                                        todayArrivals.map((g, i) => (
                                            <tr key={i} onClick={() => setSelectedGuest(g)} style={{ cursor: "pointer", transition: "background 0.2s" }} onMouseEnter={e => e.currentTarget.style.background = "#F8FAFC"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                                                <td style={{ ...styles.td, fontWeight: "700" }}>{formatBuildingRoom(g.building, g.room)}</td>
                                                <td style={styles.td}><span style={{ color: "#4F46E5", fontWeight: "600" }}>{g.guestName}</span></td>
                                                <td style={styles.td}>{g.numAdult}A {g.numChild}C</td>
                                                <td style={styles.td}>{getPlatformDisplay(g.platform)}</td>
                                                <td style={{ ...styles.td, color: "#64748B" }}>{g.arrival} ~ {g.departure}</td>
                                                <td style={{ ...styles.td, fontWeight: "600" }}>{formatPrice(g.totalPrice || g.price)}</td>
                                                <td style={styles.td}><span style={{ background: "#DCFCE7", color: "#166534", padding: "4px 10px", borderRadius: "20px", fontSize: "12px", fontWeight: "700" }}>Arrival</span></td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        )}

                        {/* Mobile Cards */}
                        {isMobile && (
                            <div style={styles.mobileCardList}>
                                {todayArrivals.length === 0 ? (
                                    <div style={{ textAlign: "center", padding: "20px", color: "#94A3B8" }}>No arrivals</div>
                                ) : (
                                    todayArrivals.map((g, i) => (
                                        <div key={i} style={styles.mobileCard} onClick={() => setSelectedGuest(g)}>
                                            <div style={styles.mobileCardHeader}>
                                                <div>
                                                    <div style={styles.mobileRoom}>{formatBuildingRoom(g.building, g.room)}</div>
                                                    <div style={{ ...styles.mobileName, color: "#4F46E5" }}>{g.guestName}</div>
                                                </div>
                                                <span style={{ background: "#EEF2FF", color: "#4F46E5", padding: "4px 8px", borderRadius: "8px", fontSize: "11px", fontWeight: "700" }}>Check-in</span>
                                            </div>
                                            <div style={{ height: "1px", background: "#F1F5F9" }} />
                                            <div style={styles.mobileInfoRow}><span><span style={styles.label}>Pax:</span>{g.numAdult}A {g.numChild}C</span>{getPlatformDisplay(g.platform)}</div>
                                            <div style={styles.mobileInfoRow}><span><span style={styles.label}>Stay:</span>{g.arrival} ~ {g.departure}</span></div>
                                            <div style={{ ...styles.mobileInfoRow, justifyContent: "flex-end", marginTop: "4px" }}><span style={{ fontSize: "16px", fontWeight: "700", color: "#0F172A" }}>{formatPrice(g.totalPrice || g.price)}</span></div>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}
                    </div>

                    {/* Departures */}
                    <div style={{ ...styles.sectionCard, borderTop: "4px solid #EF4444" }}>
                        <div style={styles.sectionHeader}>
                            <h3 style={{ ...styles.sectionTitle, color: "#EF4444" }}>
                                📤 Scheduled Departures
                                <span style={{ ...styles.badge, background: "#FEF2F2", color: "#EF4444" }}>{todayDepartures.length}</span>
                            </h3>
                        </div>

                        {/* PC Table */}
                        {!isMobile && (
                            <table style={styles.table}>
                                <thead>
                                    <tr>
                                        <th style={styles.th}>Property / Room</th>
                                        <th style={styles.th}>Guest Name</th>
                                        <th style={styles.th}>Pax</th>
                                        <th style={styles.th}>Platform</th>
                                        <th style={styles.th}>Check-in Date</th>
                                        <th style={styles.th}>Total</th>
                                        <th style={styles.th}>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {todayDepartures.length === 0 ? (
                                        <tr><td colSpan="7" style={{ ...styles.td, textAlign: "center", padding: "40px" }}>No departures scheduled.</td></tr>
                                    ) : (
                                        todayDepartures.map((g, i) => (
                                            <tr key={i} onClick={() => setSelectedGuest(g)} style={{ cursor: "pointer", transition: "background 0.2s" }} onMouseEnter={e => e.currentTarget.style.background = "#F8FAFC"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                                                <td style={{ ...styles.td, fontWeight: "700" }}>{formatBuildingRoom(g.building, g.room)}</td>
                                                <td style={styles.td}><span style={{ color: "#EF4444", fontWeight: "600" }}>{g.guestName}</span></td>
                                                <td style={styles.td}>{g.numAdult}A {g.numChild}C</td>
                                                <td style={styles.td}>{getPlatformDisplay(g.platform)}</td>
                                                <td style={{ ...styles.td, color: "#64748B" }}>{g.arrival}</td>
                                                <td style={{ ...styles.td, fontWeight: "600" }}>{formatPrice(g.totalPrice || g.price)}</td>
                                                <td style={styles.td}><span style={{ background: "#FEE2E2", color: "#991B1B", padding: "4px 10px", borderRadius: "20px", fontSize: "12px", fontWeight: "700" }}>Pending</span></td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        )}

                        {/* Mobile Cards */}
                        {isMobile && (
                            <div style={styles.mobileCardList}>
                                {todayDepartures.length === 0 ? (
                                    <div style={{ textAlign: "center", padding: "20px", color: "#94A3B8" }}>No departures</div>
                                ) : (
                                    todayDepartures.map((g, i) => (
                                        <div key={i} style={styles.mobileCard} onClick={() => setSelectedGuest(g)}>
                                            <div style={styles.mobileCardHeader}>
                                                <div>
                                                    <div style={styles.mobileRoom}>{formatBuildingRoom(g.building, g.room)}</div>
                                                    <div style={{ ...styles.mobileName, color: "#EF4444" }}>{g.guestName}</div>
                                                </div>
                                                <span style={{ background: "#FEF2F2", color: "#EF4444", padding: "4px 8px", borderRadius: "8px", fontSize: "11px", fontWeight: "700" }}>Check-out</span>
                                            </div>
                                            <div style={{ height: "1px", background: "#F1F5F9" }} />
                                            <div style={styles.mobileInfoRow}><span><span style={styles.label}>Pax:</span>{g.numAdult}A {g.numChild}C</span>{getPlatformDisplay(g.platform)}</div>
                                            <div style={styles.mobileInfoRow}><span><span style={styles.label}>In:</span>{g.arrival}</span></div>
                                            <div style={{ ...styles.mobileInfoRow, justifyContent: "flex-end", marginTop: "4px" }}><span style={{ fontSize: "16px", fontWeight: "700", color: "#0F172A" }}>{formatPrice(g.totalPrice || g.price)}</span></div>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

export default ArrivalsDashboard;
