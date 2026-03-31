import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from '../firebase';
import { useUser } from '../contexts/UserContext';

// -----------------------------------------------------------------------------
// [CONSTANTS & LOGIC] Data Management (Preserved)
// -----------------------------------------------------------------------------
import { BUILDING_NAMES_EN, EXCLUDED_BUILDING_UI } from '../constants/buildingData';

const getTodayString = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const getCountryFlag = (country) => {
  const flags = {
    'JP': '🇯🇵', 'KR': '🇰🇷', 'CN': '🇨🇳', 'TW': '🇹🇼', 'HK': '🇭🇰',
    'US': '🇺🇸', 'GB': '🇬🇧', 'AU': '🇦🇺', 'CA': '🇨🇦', 'SG': '🇸🇬',
    'TH': '🇹🇭', 'VN': '🇻🇳', 'PH': '🇵🇭', 'MY': '🇲🇾', 'ID': '🇮🇩',
    'FR': '🇫🇷', 'DE': '🇩🇪', 'IT': '🇮🇹', 'ES': '🇪🇸', 'NL': '🇳🇱',
    'Japan': '🇯🇵', 'Korea': '🇰🇷', 'China': '🇨🇳', 'Taiwan': '🇹🇼',
    'USA': '🇺🇸', 'United States': '🇺🇸', 'UK': '🇬🇧', 'Australia': '🇦🇺',
  };
  return flags[country] || '🌍';
};

const formatCurrency = (val) => "¥" + Math.floor(val).toLocaleString();

const getBuildingName = (name) => BUILDING_NAMES_EN[name] || name || "Unknown";

const formatRoom = (room) => {
  if (!room) return '';
  // Remove '호' suffix
  let cleaned = room.replace('호', '');

  // Handle specific cases where room name is just the building name in Korean
  // Specifically handle "사노시 사노" which might appear as a room name or need specific cleaning
  if (['오쿠보A', '오쿠보B', '오쿠보C', '오쿠보'].includes(cleaned)) return '';
  if (cleaned.includes('사노')) return ''; // Hide room name if it's just repeating Sano building info

  return cleaned;
};

// -----------------------------------------------------------------------------
// [COMPONENT] CustomerListDashboard
// -----------------------------------------------------------------------------

const CustomerListDashboard = () => {
  const { companyId } = useUser();
  const [loading, setLoading] = useState(true);
  const [reservations, setReservations] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [viewMode, setViewMode] = useState("all"); // all, repeat, longStay, currentRepeat, current
  const [sortBy, setSortBy] = useState("recent"); // recent, name, totalSpent

  useEffect(() => {
    if (companyId) {
      fetchCustomerData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const fetchCustomerData = async () => {
    if (!companyId) {
      console.warn('⚠️ No companyId for CustomerListDashboard');
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const q = query(
        collection(db, "reservations"),
        where("companyId", "==", companyId),
        where("status", "==", "confirmed")
      );
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      const filteredData = data.filter(res => res.building !== EXCLUDED_BUILDING_UI);
      setReservations(filteredData);
    } catch (error) {
      console.error("Failed to load customer data:", error);
    } finally {
      setLoading(false);
    }
  };

  const customerData = useMemo(() => {
    const customerMap = new Map();

    reservations.forEach(res => {
      const name = (res.guestName || "").trim();
      if (!name || name.toLowerCase() === "unknown") return;

      const key = res.guestEmail
        ? `${name}_${res.guestEmail}`.toLowerCase()
        : `${name}_${res.guestPhone || res.bookId || res.id}`.toLowerCase();

      if (!customerMap.has(key)) {
        customerMap.set(key, {
          guestName: name,
          guestEmail: res.guestEmail || "",
          guestPhone: res.guestPhone || "",
          guestCountry: res.guestCountry || res.guestCountry2 || "",
          guestCity: res.guestCity || "",
          guestAddress: res.guestAddress || "",
          lang: res.lang || "",
          reservations: [],
          totalSpent: 0,
          totalNights: 0,
          totalAdults: 0,
          totalChildren: 0,
          visitCount: 0,
          platforms: new Set(),
          buildings: new Set(),
          buildingRooms: new Set(),
        });
      }

      const customer = customerMap.get(key);
      customer.reservations.push(res);
      customer.totalSpent += Number(res.totalPrice || res.price || 0);
      customer.totalNights += Number(res.nights || 0);
      customer.totalAdults += Number(res.numAdult || 0);
      customer.totalChildren += Number(res.numChild || 0);
      customer.visitCount += 1;
      if (res.platform) customer.platforms.add(res.platform);
      if (res.building) customer.buildings.add(getBuildingName(res.building));
      if (res.building && res.room) {
        customer.buildingRooms.add(`${getBuildingName(res.building)} ${formatRoom(res.room)}`.trim());
      } else if (res.building) {
        customer.buildingRooms.add(getBuildingName(res.building).trim());
      }
    });

    return Array.from(customerMap.values()).map(c => {
      const latestRes = c.reservations.reduce((latest, r) => {
        const arrival = r.arrival || r.bookDate;
        const latestDate = latest?.arrival || latest?.bookDate;
        return !latestDate || arrival > latestDate ? r : latest;
      }, null);

      return {
        ...c,
        platforms: Array.from(c.platforms),
        buildings: Array.from(c.buildings),
        buildingRooms: Array.from(c.buildingRooms),
        lastAdults: Number(latestRes?.numAdult || 0),
        lastChildren: Number(latestRes?.numChild || 0),
        lastNights: Number(latestRes?.nights || 0),
        lastPrice: Number(latestRes?.totalPrice || latestRes?.price || 0),
        lastVisit: c.reservations.reduce((latest, r) => {
          const arrival = r.arrival || r.bookDate;
          return !latest || arrival > latest ? arrival : latest;
        }, null),
        firstVisit: c.reservations.reduce((earliest, r) => {
          const arrival = r.arrival || r.bookDate;
          return !earliest || arrival < earliest ? arrival : earliest;
        }, null),
      };
    });
  }, [reservations]);

  const repeatCustomers = useMemo(() => customerData.filter(c => c.visitCount >= 2), [customerData]);

  const currentStayCustomers = useMemo(() => {
    const today = getTodayString();
    return reservations.filter(res => {
      const arrival = res.arrival;
      const departure = res.departure;
      return arrival && departure && arrival <= today && departure > today;
    }).map(res => ({
      ...res,
      guestCountry: res.guestCountry || res.guestCountry2 || "",
    }));
  }, [reservations]);

  const longStayCustomers = useMemo(() => currentStayCustomers.filter(res => Number(res.nights || 0) >= 7), [currentStayCustomers]);

  const currentRepeatCustomers = useMemo(() => {
    const repeatNames = new Set(repeatCustomers.map(c => c.guestName.toLowerCase()));
    return currentStayCustomers.filter(res => {
      const name = (res.guestName || "").trim().toLowerCase();
      return name && repeatNames.has(name);
    });
  }, [currentStayCustomers, repeatCustomers]);

  const filteredData = useMemo(() => {
    let data;
    if (viewMode === "repeat") data = repeatCustomers;
    else if (viewMode === "longStay") data = longStayCustomers;
    else if (viewMode === "current") data = currentStayCustomers;
    else if (viewMode === "currentRepeat") data = currentRepeatCustomers;
    else data = customerData;

    if (!searchTerm.trim()) return data;

    const term = searchTerm.toLowerCase();
    return data.filter(item => {
      const name = (item.guestName || "").toLowerCase();
      const email = (item.guestEmail || "").toLowerCase();
      const country = (item.guestCountry || "").toLowerCase();
      const building = viewMode === "longStay"
        ? (item.building || "").toLowerCase()
        : (item.buildings?.join(" ") || "").toLowerCase();
      return name.includes(term) || email.includes(term) || country.includes(term) || building.includes(term);
    });
  }, [viewMode, customerData, repeatCustomers, longStayCustomers, currentStayCustomers, currentRepeatCustomers, searchTerm]);

  const sortedData = useMemo(() => {
    const data = [...filteredData];
    if (viewMode === "longStay" || viewMode === "current" || viewMode === "currentRepeat") {
      return data.sort((a, b) => (b.arrival || "").localeCompare(a.arrival || ""));
    }
    switch (sortBy) {
      case "name": return data.sort((a, b) => (a.guestName || "").localeCompare(b.guestName || ""));
      case "totalSpent": return data.sort((a, b) => b.totalSpent - a.totalSpent);
      case "visits": return data.sort((a, b) => b.visitCount - a.visitCount);
      case "recent": default: return data.sort((a, b) => (b.lastVisit || "").localeCompare(a.lastVisit || ""));
    }
  }, [filteredData, sortBy, viewMode]);

  const stats = useMemo(() => {
    const totalCustomers = customerData.length;
    const repeatCount = repeatCustomers.length;
    const currentCount = currentStayCustomers.length;
    const totalRevenue = customerData.reduce((sum, c) => sum + c.totalSpent, 0);
    const avgSpentPerCustomer = totalCustomers > 0 ? totalRevenue / totalCustomers : 0;

    const countryStats = {};
    customerData.forEach(c => {
      const country = c.guestCountry || "Unknown";
      if (!countryStats[country]) countryStats[country] = 0;
      countryStats[country]++;
    });
    const topCountries = Object.entries(countryStats).sort((a, b) => b[1] - a[1]).slice(0, 5);

    return { totalCustomers, repeatCount, currentCount, totalRevenue, avgSpentPerCustomer, topCountries };
  }, [customerData, repeatCustomers, currentStayCustomers]);

  // Styles (Haru Studio Enterprise Theme)
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

    // KPI Cards
    kpiGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '32px' },
    kpiCard: { background: '#F8FAFC', padding: '20px', borderRadius: '16px', border: '1px solid #E2E8F0' },
    kpiLabel: { fontSize: '12px', fontWeight: '600', color: '#64748B', textTransform: 'uppercase', marginBottom: '8px' },
    kpiValue: { fontSize: '24px', fontWeight: '800', color: '#1E293B' },
    kpiDiff: { fontSize: '12px', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' },

    // Controls
    controls: { display: 'flex', flexWrap: 'wrap', gap: '16px', marginBottom: '24px', alignItems: 'center' },
    tabGroup: { display: 'flex', background: '#F1F5F9', padding: '4px', borderRadius: '12px', gap: '2px' },
    tab: (active) => ({
      padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: '600',
      border: 'none', cursor: 'pointer', background: active ? '#FFFFFF' : 'transparent',
      color: active ? '#4F46E5' : '#64748B', boxShadow: active ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
      transition: 'all 0.2s'
    }),
    searchInput: {
      padding: '10px 16px', borderRadius: '10px', border: '1px solid #CBD5E1',
      fontSize: '14px', outline: 'none', minWidth: '240px', flex: 1
    },
    select: {
      padding: '10px 16px', borderRadius: '10px', border: '1px solid #CBD5E1',
      fontSize: '14px', outline: 'none', background: 'white'
    },

    // Table
    tableHeaderTh: {
      textAlign: 'left', padding: '16px', fontSize: '12px', fontWeight: '700',
      color: '#64748B', textTransform: 'uppercase', borderBottom: '1px solid #E2E8F0',
      whiteSpace: 'nowrap'
    },
    tableRow: { background: '#FFFFFF', transition: 'background 0.2s' },
    tableCell: { padding: '16px', fontSize: '14px', borderBottom: '1px solid #F1F5F9', color: '#334155' },

    // Badges
    badge: (type) => ({
      padding: '4px 10px', borderRadius: '99px', fontSize: '11px', fontWeight: '700',
      background: type === 'vip' ? '#FEF2F2' : type === 'staying' ? '#ECFDF5' : '#F1F5F9',
      color: type === 'vip' ? '#EF4444' : type === 'staying' ? '#10B981' : '#64748B',
      display: 'inline-block'
    })
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.titleGroup}>
          <div style={styles.icon}>👥</div>
          <div>
            <h1 style={styles.title}>Customer List</h1>
            <p style={styles.subtitle}>Manage guests, booking history, and loyalty insights</p>
          </div>
        </div>
      </div>

      {/* KPI Section */}
      <div style={styles.kpiGrid}>
        <div style={styles.kpiCard}>
          <div style={styles.kpiLabel}>Total Customers</div>
          <div style={styles.kpiValue}>{stats.totalCustomers.toLocaleString()}</div>
        </div>
        <div style={styles.kpiCard}>
          <div style={styles.kpiLabel}>Returning (2+)</div>
          <div style={{ ...styles.kpiValue, color: '#F59E0B' }}>{stats.repeatCount.toLocaleString()}</div>
        </div>
        <div style={styles.kpiCard}>
          <div style={styles.kpiLabel}>Currently Staying</div>
          <div style={{ ...styles.kpiValue, color: '#10B981' }}>{stats.currentCount.toLocaleString()}</div>
        </div>
        <div style={styles.kpiCard}>
          <div style={styles.kpiLabel}>Total Revenue</div>
          <div style={{ ...styles.kpiValue, color: '#4F46E5' }}>{formatCurrency(stats.totalRevenue)}</div>
        </div>
      </div>

      {/* Controls */}
      <div style={styles.controls}>
        <div style={styles.tabGroup}>
          <button style={styles.tab(viewMode === 'all')} onClick={() => setViewMode('all')}>All Guests</button>
          <button style={styles.tab(viewMode === 'repeat')} onClick={() => setViewMode('repeat')}>Returning</button>
          <button style={styles.tab(viewMode === 'current')} onClick={() => setViewMode('current')}>Staying Now</button>
          <button style={styles.tab(viewMode === 'longStay')} onClick={() => setViewMode('longStay')}>Long Stay</button>
        </div>
        <input
          style={styles.searchInput}
          placeholder="Search by name, email, or country..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        {['all', 'repeat'].includes(viewMode) && (
          <select style={styles.select} value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="recent">Recent Visit</option>
            <option value="visits">Most Visits</option>
            <option value="totalSpent">Highest Spend</option>
            <option value="name">Name (A-Z)</option>
          </select>
        )}
      </div>

      <div style={{ fontSize: '13px', color: '#64748B', marginBottom: '16px' }}>
        Showing <strong>{sortedData.length}</strong> results
      </div>

      {/* Customer List */}
      <div className="responsive-grid-container">
        {loading ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#94A3B8' }}>Loading customer data...</div>
        ) : sortedData.length === 0 ? (
          <div style={{ padding: '60px', textAlign: 'center', background: '#F8FAFC', borderRadius: '16px', color: '#64748B' }}>
            <div style={{ fontSize: '32px', marginBottom: '16px' }}>🔍</div>
            No customers found matching your criteria.
          </div>
        ) : (
          <div className="responsive-table-container">
            {/* PC Table View */}
            <table className="pc-table-view" style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead>
                <tr style={{ background: '#F8FAFC' }}>
                  <th style={styles.tableHeaderTh}>Guest</th>
                  <th style={styles.tableHeaderTh}>Contact / Country</th>
                  <th style={styles.tableHeaderTh}>Stats</th>
                  <th style={styles.tableHeaderTh}>{['current', 'longStay'].includes(viewMode) ? 'Current Stay' : 'History'}</th>
                  <th style={styles.tableHeaderTh}>Last Activity</th>
                </tr>
              </thead>
              <tbody>
                {sortedData.map((item, idx) => (
                  <tr key={idx} style={{ ...styles.tableRow, background: idx % 2 === 0 ? '#FFFFFF' : '#FAFAFA' }}>
                    <td style={styles.tableCell}>
                      <div style={{ fontWeight: '600', color: '#1E293B', fontSize: '15px' }}>{item.guestName}</div>
                      {item.visitCount >= 2 && (
                        <span style={{ ...styles.badge('vip'), marginTop: '6px' }}>{item.visitCount} visits</span>
                      )}
                    </td>
                    <td style={styles.tableCell}>
                      <div style={{ fontSize: '13px', marginBottom: '4px' }}>{item.guestEmail || '-'}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#64748B' }}>
                        <span>{getCountryFlag(item.guestCountry)}</span>
                        <span>{item.guestCountry || 'Unknown'}</span>
                      </div>
                    </td>
                    <td style={styles.tableCell}>
                      <div style={{ fontSize: '13px' }}>
                        <span style={{ fontWeight: '600', color: '#4F46E5' }}>{formatCurrency(item.totalSpent || item.lastPrice)}</span>
                        <span style={{ color: '#94A3B8', margin: '0 4px' }}>•</span>
                        <span>{item.totalNights || item.nights} nights</span>
                      </div>
                    </td>
                    <td style={styles.tableCell}>
                      {['current', 'longStay'].includes(viewMode) ? (
                        <div>
                          <div style={{ fontWeight: '500' }}>{getBuildingName(item.building)} {formatRoom(item.room)}</div>
                          <div style={{ fontSize: '12px', color: '#64748B' }}>{item.arrival} ~ {item.departure}</div>
                          <span style={{ ...styles.badge('staying'), marginTop: '4px' }}>In House</span>
                        </div>
                      ) : (
                        <div style={{ fontSize: '12px', color: '#64748B', maxWidth: '200px', lineHeight: '1.4' }}>
                          {item.buildingRooms.slice(0, 3).join(', ')}
                          {item.buildingRooms.length > 3 && ` +${item.buildingRooms.length - 3} more`}
                        </div>
                      )}
                    </td>
                    <td style={styles.tableCell}>
                      <div style={{ fontSize: '13px' }}>{item.lastVisit || item.arrival}</div>
                      <div style={{ fontSize: '12px', color: '#94A3B8' }}>{['current', 'longStay'].includes(viewMode) ? 'Check-in' : 'Last Visit'}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile Card List View */}
            <div className="mobile-card-list">
              {sortedData.map((item, idx) => (
                <div key={idx} className="mobile-card-item">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                    <div>
                      <div style={{ fontSize: '16px', fontWeight: '700', color: '#1E293B' }}>{item.guestName}</div>
                      <div style={{ fontSize: '13px', color: '#64748B', marginTop: '2px' }}>{item.guestEmail}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '20px' }}>{getCountryFlag(item.guestCountry)}</span>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px', background: '#F8FAFC', padding: '12px', borderRadius: '8px' }}>
                    <div>
                      <div style={{ fontSize: '11px', color: '#64748B', fontWeight: '600' }}>TOTAL SPEND</div>
                      <div style={{ fontSize: '14px', fontWeight: '700', color: '#4F46E5' }}>{formatCurrency(item.totalSpent || item.lastPrice)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: '#64748B', fontWeight: '600' }}>VISITS</div>
                      <div style={{ fontSize: '14px', fontWeight: '700', color: '#1E293B' }}>{item.visitCount || 1}</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    {['current', 'longStay'].includes(viewMode) ? (
                      <div style={{ fontSize: '13px', color: '#1E293B' }}>
                        <strong>{getBuildingName(item.building)} {formatRoom(item.room)}</strong> (~{item.departure})
                      </div>
                    ) : (
                      <div style={{ fontSize: '12px', color: '#64748B' }}>
                        Last: {item.lastVisit}
                      </div>
                    )}
                    {item.visitCount >= 2 && <span style={styles.badge('vip')}>VIP</span>}
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

export default CustomerListDashboard;
