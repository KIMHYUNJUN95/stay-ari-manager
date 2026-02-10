import React, { useState, useEffect } from 'react';
import { collection, getDocs, query, where, orderBy, limit } from "firebase/firestore";
import { db } from '../firebase';
import { useUser } from '../contexts/UserContext';

// -----------------------------------------------------------------------------
// [CONSTANTS] Configuration & Data
// -----------------------------------------------------------------------------

const BUILDING_ORDER = [
  "아라키초A", "아라키초B", "다이쿄초", "가부키초",
  "다카다노바바", "오쿠보A동", "오쿠보B동", "오쿠보C동", "사노시"
];

// Building name mapping (Korean -> English)
const BUILDING_NAMES_EN = {
  "아라키초A": "Arakicho A",
  "아라키초B": "Arakicho B",
  "다이쿄초": "Daikyocho",
  "가부키초": "Kabukicho",
  "다카다노바바": "Takadanobaba",
  "오쿠보A동": "Okubo A",
  "오쿠보B동": "Okubo B",
  "오쿠보C동": "Okubo C",
  "사노시": "Sano"
};

const DAIKYO_SOLD_DATE = "2026-01-26";

// Month names (number + English)
const MONTHS = [
  '1 January', '2 February', '3 March', '4 April', '5 May', '6 June',
  '7 July', '8 August', '9 September', '10 October', '11 November', '12 December'
];

// Get days in month
const getDaysInMonth = (year, month) => {
  return new Date(year, month, 0).getDate();
};

const getLocalDate = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const sortByBuildingOrder = (list) => {
  return [...list].sort((a, b) => {
    const indexA = BUILDING_ORDER.indexOf(a.building);
    const indexB = BUILDING_ORDER.indexOf(b.building);
    const orderA = indexA === -1 ? 999 : indexA;
    const orderB = indexB === -1 ? 999 : indexB;
    if (orderA !== orderB) return orderA - orderB;
    return (a.room || "").localeCompare(b.room || "");
  });
};

// -----------------------------------------------------------------------------
// [COMPONENT] CleaningDashboard
// -----------------------------------------------------------------------------

const CleaningDashboard = () => {
  const { companyId } = useUser();
  const currentDate = new Date();
  const [selectedDate, setSelectedDate] = useState(getLocalDate());
  const [selectedYear, setSelectedYear] = useState(currentDate.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(currentDate.getMonth() + 1);
  const [selectedDay, setSelectedDay] = useState(currentDate.getDate());
  const [loading, setLoading] = useState(false);
  const [scheduleList, setScheduleList] = useState([]);

  // Year list (current year ±5 years)
  const YEARS = Array.from({length: 11}, (_, i) => currentDate.getFullYear() - 5 + i);

  // Days in selected month
  const daysInSelectedMonth = getDaysInMonth(selectedYear, selectedMonth);
  const DAYS = Array.from({length: daysInSelectedMonth}, (_, i) => i + 1);

  // Data Fetching Logic (Preserved)
  const fetchData = async () => {
    setLoading(true);
    try {
      if (!companyId) {
        console.warn('⚠️ No companyId for CleaningDashboard');
        setLoading(false);
        return;
      }

      const departuresSnap = await getDocs(
        query(
          collection(db, "reservations"),
          where("companyId", "==", companyId),
          where("status", "==", "confirmed"),
          where("departure", "==", selectedDate)
        )
      );
      const departures = departuresSnap.docs.map(d => ({ ...d.data(), id: d.id }));

      const arrivalsSnap = await getDocs(
        query(
          collection(db, "reservations"),
          where("companyId", "==", companyId),
          where("status", "==", "confirmed"),
          where("arrival", "==", selectedDate)
        )
      );
      const arrivals = arrivalsSnap.docs.map(d => ({ ...d.data(), id: d.id }));

      const tasksMap = {};
      const getTask = (building, room) => {
        const key = `${building}_${room}`;
        if (!tasksMap[key]) {
          tasksMap[key] = {
            id: key,
            building,
            room,
            hasCheckout: false,
            checkoutGuestName: null,
            checkoutNumAdult: 0,
            checkoutNumChild: 0,
            hasNextCheckin: false,
            isSameDayCheckin: false,
            nextCheckinDate: null,
            nextCheckinGuestName: null,
            nextCheckinNumAdult: 0,
            nextCheckinNumChild: 0
          };
        }
        return tasksMap[key];
      };

      departures.forEach(res => {
        const task = getTask(res.building, res.room);
        task.hasCheckout = true;
        task.checkoutGuestName = res.guestName;
        task.checkoutNumAdult = res.numAdult || 0;
        task.checkoutNumChild = res.numChild || 0;
      });

      arrivals.forEach(res => {
        const task = getTask(res.building, res.room);
        task.hasNextCheckin = true;
        task.isSameDayCheckin = true;
        task.nextCheckinDate = res.arrival;
        task.nextCheckinGuestName = res.guestName;
        task.nextCheckinNumAdult = res.numAdult || 0;
        task.nextCheckinNumChild = res.numChild || 0;
      });

      const allTasks = Object.values(tasksMap);
      const finalTasks = await Promise.all(allTasks.map(async (task) => {
        if (task.hasNextCheckin) return task;
        if (task.hasCheckout) {
          const nextCheckinSnap = await getDocs(
            query(
              collection(db, "reservations"),
              where("companyId", "==", companyId),
              where("status", "==", "confirmed"),
              where("building", "==", task.building),
              where("room", "==", task.room),
              where("arrival", ">", selectedDate),
              orderBy("arrival", "asc"),
              limit(1)
            )
          );
          const nextRes = nextCheckinSnap.docs.length > 0 ? nextCheckinSnap.docs[0].data() : null;
          if (nextRes) {
            task.hasNextCheckin = true;
            task.isSameDayCheckin = false;
            task.nextCheckinDate = nextRes.arrival;
            task.nextCheckinGuestName = nextRes.guestName;
            task.nextCheckinNumAdult = nextRes.numAdult || 0;
            task.nextCheckinNumChild = nextRes.numChild || 0;
          }
        }
        return task;
      }));

      const filteredTasks = selectedDate >= DAIKYO_SOLD_DATE
        ? finalTasks.filter(t => t.building !== "다이쿄초")
        : finalTasks;

      setScheduleList(sortByBuildingOrder(filteredTasks));
    } catch (error) {
      console.error("Data loading failed:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (companyId) {
      fetchData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, companyId]);

  // ---------------------------------------------------------------------------
  // [STYLES] Haru Studio Enterprise Theme (Inline for specific component)
  // ---------------------------------------------------------------------------
  const styles = {
    container: {
      padding: '32px',
      background: '#FFFFFF',
      minHeight: '100vh',
      fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '32px',
      flexWrap: 'wrap',
      gap: '16px'
    },
    titleGroup: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px'
    },
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
    title: {
      fontSize: '24px',
      fontWeight: '700',
      color: '#0F172A',
      margin: 0,
      letterSpacing: '-0.5px'
    },
    subtitle: {
      fontSize: '14px',
      color: '#64748B',
      marginTop: '4px',
      fontWeight: '500'
    },
    controls: {
      display: 'flex',
      gap: '12px',
      alignItems: 'center'
    },
    datePickerWrapper: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      background: 'white',
      padding: '10px 14px',
      borderRadius: '10px',
      border: '1px solid #E2E8F0',
      boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
      minWidth: '250px'
    },
    dateSelect: {
      border: 'none',
      outline: 'none',
      fontSize: '14px',
      fontWeight: '600',
      color: '#1E293B',
      background: 'transparent',
      cursor: 'pointer'
    },
    refreshBtn: {
      padding: '10px 20px',
      borderRadius: '10px',
      border: 'none',
      background: 'linear-gradient(135deg, #4F46E5 0%, #4338CA 100%)',
      color: 'white',
      fontSize: '14px',
      fontWeight: '600',
      cursor: 'pointer',
      boxShadow: '0 4px 6px -1px rgba(79, 70, 229, 0.2)',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      transition: 'transform 0.1s'
    },
    kpiCard: {
      background: 'linear-gradient(135deg, #F8FAFC 0%, #F1F5F9 100%)',
      borderRadius: '16px',
      padding: '24px',
      border: '1px solid #E2E8F0',
      display: 'flex',
      alignItems: 'center',
      gap: '20px',
      marginBottom: '32px'
    },
    kpiContent: {
      flex: 1
    },
    kpiLabel: {
      fontSize: '13px',
      fontWeight: '600',
      color: '#64748B',
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      marginBottom: '4px'
    },
    kpiValue: {
      fontSize: '32px',
      fontWeight: '800',
      color: '#1E293B',
      letterSpacing: '-1px'
    },
    infoText: {
      fontSize: '13px',
      color: '#64748B',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      background: '#FFFFFF',
      padding: '8px 12px',
      borderRadius: '8px',
      border: '1px solid #E2E8F0'
    }
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.titleGroup}>
          <div style={styles.icon}>🧹</div>
          <div>
            <h1 style={styles.title}>Cleaning Schedule</h1>
            <p style={styles.subtitle}>Daily Check-in & Check-out Management</p>
          </div>
        </div>
        <div style={styles.controls}>
          <div style={styles.datePickerWrapper}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#4F46E5"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <select
              value={selectedYear}
              onChange={(e) => {
                const newYear = Number(e.target.value);
                setSelectedYear(newYear);
                setSelectedDate(`${e.target.value}-${String(selectedMonth).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`);
              }}
              style={styles.dateSelect}
            >
              {YEARS.map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
            <select
              value={selectedMonth}
              onChange={(e) => {
                const newMonth = Number(e.target.value);
                setSelectedMonth(newMonth);
                const newDaysInMonth = getDaysInMonth(selectedYear, newMonth);
                const adjustedDay = Math.min(selectedDay, newDaysInMonth);
                setSelectedDay(adjustedDay);
                setSelectedDate(`${selectedYear}-${String(e.target.value).padStart(2, '0')}-${String(adjustedDay).padStart(2, '0')}`);
              }}
              style={styles.dateSelect}
            >
              {MONTHS.map((month, index) => (
                <option key={index + 1} value={index + 1}>{month}</option>
              ))}
            </select>
            <select
              value={selectedDay}
              onChange={(e) => {
                const newDay = Number(e.target.value);
                setSelectedDay(newDay);
                setSelectedDate(`${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(e.target.value).padStart(2, '0')}`);
              }}
              style={styles.dateSelect}
            >
              {DAYS.map(day => (
                <option key={day} value={day}>{day}</option>
              ))}
            </select>
          </div>
          <button onClick={fetchData} style={styles.refreshBtn}>
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* KPI Section */}
      <div style={styles.kpiCard}>
        <div style={{
          background: '#FFFFFF',
          width: '64px',
          height: '64px',
          borderRadius: '50%',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          fontSize: '24px',
          boxShadow: '0 4px 6px rgba(0,0,0,0.05)',
          color: '#4F46E5'
        }}>
          📝
        </div>
        <div style={styles.kpiContent}>
          <div style={styles.kpiLabel}>Tasks for Today</div>
          <div style={styles.kpiValue}>{scheduleList.length} Rooms</div>
        </div>
        <div style={styles.infoText}>
          <span>💡</span> List includes all rooms with check-in or check-out activity today.
        </div>
      </div>

      {/* Main Content */}
      <div className="responsive-grid-container">
        {loading ? (
          <div style={{ textAlign: "center", padding: "80px", color: "#94A3B8" }}>
            <div style={{ fontSize: "16px", fontWeight: "500" }}>Loading schedule...</div>
          </div>
        ) : scheduleList.length === 0 ? (
          <div style={{
            textAlign: "center",
            padding: "80px",
            background: "#F8FAFC",
            borderRadius: "16px",
            border: "2px dashed #E2E8F0",
            color: "#64748B"
          }}>
            <div style={{ fontSize: "40px", marginBottom: "16px" }}>🛌</div>
            <div style={{ fontSize: "16px", fontWeight: "600" }}>No cleaning tasks scheduled</div>
            <div style={{ fontSize: "14px", marginTop: "4px" }}>There are no check-ins or check-outs for {selectedDate}.</div>
          </div>
        ) : (
          <div className="responsive-table-container">
            {/* PC Table View */}
            <table className="pc-table-view" style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, marginTop: '8px' }}>
              <thead>
                <tr style={{ background: '#F8FAFC' }}>
                  <th style={{ padding: '16px 24px', textAlign: 'left', fontSize: '12px', fontWeight: '700', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #E2E8F0', width: '25%' }}>Property / Room</th>
                  <th style={{ padding: '16px 24px', textAlign: 'left', fontSize: '12px', fontWeight: '700', color: '#EF4444', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #E2E8F0', width: '37.5%' }}>Check-out (Departure)</th>
                  <th style={{ padding: '16px 24px', textAlign: 'left', fontSize: '12px', fontWeight: '700', color: '#10B981', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid #E2E8F0', width: '37.5%' }}>Check-in (Arrival)</th>
                </tr>
              </thead>
              <tbody>
                {scheduleList.map((task, index) => (
                  <tr key={task.id} style={{
                    background: index % 2 === 0 ? '#FFFFFF' : '#FAFAFA',
                    transition: 'background 0.2s'
                  }}>
                    <td style={{ padding: '20px 24px', borderBottom: '1px solid #F1F5F9' }}>
                      <div style={{ fontWeight: '700', color: '#1E293B', fontSize: '15px' }}>{BUILDING_NAMES_EN[task.building] || task.building}</div>
                      <div style={{ color: '#64748B', fontSize: '14px', marginTop: '4px' }}>Room {task.room?.replace('호', '')}</div>
                    </td>
                    <td style={{ padding: '20px 24px', borderBottom: '1px solid #F1F5F9' }}>
                      {task.hasCheckout ? (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                            <span style={{ fontWeight: '600', color: '#1E293B', fontSize: '15px' }}>{task.checkoutGuestName || "Guest"}</span>
                            <span style={{ fontSize: '11px', background: '#FEF2F2', color: '#EF4444', padding: '2px 8px', borderRadius: '12px', fontWeight: '700' }}>OUT</span>
                          </div>
                          <div style={{ fontSize: '13px', color: '#64748B' }}>
                            {task.checkoutNumAdult} Adults, {task.checkoutNumChild} Children
                          </div>
                        </div>
                      ) : (
                        <div style={{ color: '#CBD5E1', fontSize: '14px', fontStyle: 'italic' }}>No Departure</div>
                      )}
                    </td>
                    <td style={{ padding: '20px 24px', borderBottom: '1px solid #F1F5F9' }}>
                      {task.hasNextCheckin ? (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                            <span style={{ fontWeight: '600', color: '#1E293B', fontSize: '15px' }}>{task.nextCheckinGuestName || "Guest"}</span>
                            {task.isSameDayCheckin ? (
                              <span style={{ fontSize: '11px', background: '#DCFCE7', color: '#166534', padding: '2px 8px', borderRadius: '12px', fontWeight: '700' }}>SAME DAY</span>
                            ) : (
                              <span style={{ fontSize: '11px', background: '#EFF6FF', color: '#2563EB', padding: '2px 8px', borderRadius: '12px', fontWeight: '700' }}>{task.nextCheckinDate}</span>
                            )}
                          </div>
                          <div style={{ fontSize: '13px', color: '#64748B' }}>
                            {task.nextCheckinNumAdult} Adults, {task.nextCheckinNumChild} Children
                          </div>
                        </div>
                      ) : (
                        <div style={{ color: '#CBD5E1', fontSize: '14px', fontStyle: 'italic' }}>No Upcoming Arrival</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile Card List View */}
            <div className="mobile-card-list">
              {scheduleList.map((task) => (
                <div key={task.id} className="mobile-card-item" style={{ gap: '16px' }}>
                  {/* Card Header: Building & Room */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #F1F5F9', paddingBottom: '12px' }}>
                    <div>
                      <div style={{ fontWeight: '700', color: '#1E293B', fontSize: '16px' }}>{BUILDING_NAMES_EN[task.building] || task.building}</div>
                      <div style={{ color: '#64748B', fontSize: '14px' }}>Room {task.room?.replace('호', '')}</div>
                    </div>
                    {task.isSameDayCheckin && (
                      <span style={{ fontSize: '11px', background: '#FEF3C7', color: '#B45309', padding: '4px 8px', borderRadius: '6px', fontWeight: '700' }}>TURNOVER</span>
                    )}
                  </div>

                  {/* Checkout Info */}
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                    <div style={{ background: '#FEF2F2', padding: '8px', borderRadius: '8px', color: '#EF4444' }}>📤</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '12px', fontWeight: '700', color: '#EF4444', marginBottom: '2px', textTransform: 'uppercase' }}>Check-out</div>
                      {task.hasCheckout ? (
                        <>
                          <div style={{ fontWeight: '600', color: '#1E293B', fontSize: '14px' }}>{task.checkoutGuestName}</div>
                          <div style={{ fontSize: '12px', color: '#64748B' }}>{task.checkoutNumAdult}A {task.checkoutNumChild}C</div>
                        </>
                      ) : (
                        <div style={{ color: '#CBD5E1', fontSize: '13px' }}>No departure</div>
                      )}
                    </div>
                  </div>

                  {/* Checkin Info */}
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                    <div style={{ background: '#ECFDF5', padding: '8px', borderRadius: '8px', color: '#10B981' }}>📥</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontSize: '12px', fontWeight: '700', color: '#10B981', marginBottom: '2px', textTransform: 'uppercase' }}>Check-in</div>
                        {task.hasNextCheckin && !task.isSameDayCheckin && (
                          <span style={{ fontSize: '11px', color: '#10B981', background: '#FFFFFF', border: '1px solid #A7F3D0', padding: '1px 6px', borderRadius: '4px' }}>
                            {task.nextCheckinDate}
                          </span>
                        )}
                      </div>
                      {task.hasNextCheckin ? (
                        <>
                          <div style={{ fontWeight: '600', color: '#1E293B', fontSize: '14px' }}>{task.nextCheckinGuestName}</div>
                          <div style={{ fontSize: '12px', color: '#64748B' }}>{task.nextCheckinNumAdult}A {task.nextCheckinNumChild}C</div>
                        </>
                      ) : (
                        <div style={{ color: '#CBD5E1', fontSize: '13px' }}>No upcoming arrival</div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CleaningDashboard;