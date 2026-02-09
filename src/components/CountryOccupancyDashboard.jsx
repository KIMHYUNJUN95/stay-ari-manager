import React, { useState, useEffect } from 'react';
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from '../firebase';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

// Country code to English name mapping
const COUNTRY_NAMES = {
  // Korea
  'KR': 'South Korea',
  'KO': 'South Korea',

  // Asia
  'JP': 'Japan',
  'JAPAN': 'Japan',
  'CN': 'China',
  'TW': 'Taiwan',
  'HK': 'Hong Kong',
  'SG': 'Singapore',
  'MY': 'Malaysia',
  'TH': 'Thailand',
  'VN': 'Vietnam',
  'PH': 'Philippines',
  'ID': 'Indonesia',
  'IN': 'India',
  'BD': 'Bangladesh',
  'PK': 'Pakistan',
  'NP': 'Nepal',
  'LK': 'Sri Lanka',
  'MM': 'Myanmar',
  'KH': 'Cambodia',
  'LA': 'Laos',
  'MN': 'Mongolia',
  'KZ': 'Kazakhstan',
  'UZ': 'Uzbekistan',
  'MO': 'Macau',

  // Oceania
  'AU': 'Australia',
  'NZ': 'New Zealand',

  // Europe
  'GB': 'United Kingdom',
  'FR': 'France',
  'DE': 'Germany',
  'IT': 'Italy',
  'ES': 'Spain',
  'NL': 'Netherlands',
  'BE': 'Belgium',
  'CH': 'Switzerland',
  'AT': 'Austria',
  'SE': 'Sweden',
  'NO': 'Norway',
  'DK': 'Denmark',
  'FI': 'Finland',
  'PL': 'Poland',
  'CZ': 'Czech Republic',
  'GR': 'Greece',
  'PT': 'Portugal',
  'IE': 'Ireland',
  'TR': 'Turkey',
  'RU': 'Russia',
  'BZ': 'Belize',
  'CR': 'Costa Rica',
  'HE': 'Saint Helena',
  'SW': 'Sweden',
  'DA': 'Denmark',
  'NC': 'New Caledonia',
  'SK': 'Slovakia',

  // Americas
  'US': 'United States',
  'CA': 'Canada',
  'BR': 'Brazil',
  'MX': 'Mexico',
  'AR': 'Argentina',
  'CL': 'Chile',
  'CO': 'Colombia',
  'PE': 'Peru',

  // Middle East
  'SA': 'Saudi Arabia',
  'AE': 'United Arab Emirates',
  'IL': 'Israel',
  'KW': 'Kuwait',

  // Africa
  'EG': 'Egypt',
  'ZA': 'South Africa',
  'NG': 'Nigeria',
  'KE': 'Kenya',

  // Full country names (uppercase)
  'CHINA': 'China',
  'TAIWAN': 'Taiwan',
  'HONGKONG': 'Hong Kong',
  'HONG KONG': 'Hong Kong',
  'SINGAPORE': 'Singapore',
  'MALAYSIA': 'Malaysia',
  'THAILAND': 'Thailand',
  'VIETNAM': 'Vietnam',
  'PHILIPPINES': 'Philippines',
  'INDONESIA': 'Indonesia',
  'INDIA': 'India',
  'AUSTRALIA': 'Australia',
  'NEW ZEALAND': 'New Zealand',
  'UNITED KINGDOM': 'United Kingdom',
  'ENGLAND': 'United Kingdom',
  'FRANCE': 'France',
  'GERMANY': 'Germany',
  'ITALY': 'Italy',
  'SPAIN': 'Spain',
  'NETHERLANDS': 'Netherlands',
  'BELGIUM': 'Belgium',
  'SWITZERLAND': 'Switzerland',
  'AUSTRIA': 'Austria',
  'SWEDEN': 'Sweden',
  'NORWAY': 'Norway',
  'DENMARK': 'Denmark',
  'FINLAND': 'Finland',
  'POLAND': 'Poland',
  'CZECH': 'Czech Republic',
  'GREECE': 'Greece',
  'PORTUGAL': 'Portugal',
  'IRELAND': 'Ireland',
  'TURKEY': 'Turkey',
  'RUSSIA': 'Russia',
  'UNITED STATES': 'United States',
  'USA': 'United States',
  'CANADA': 'Canada',
  'BRAZIL': 'Brazil',
  'MEXICO': 'Mexico',
  'ARGENTINA': 'Argentina',
  'CHILE': 'Chile',
  'COLOMBIA': 'Colombia',
  'PERU': 'Peru',
  'ISRAEL': 'Israel',
  'KUWAIT': 'Kuwait',
  'SAUDI ARABIA': 'Saudi Arabia',
  'UAE': 'United Arab Emirates',
  'EGYPT': 'Egypt',
  'SOUTH AFRICA': 'South Africa',
  'KOREA': 'South Korea',
  'SOUTH KOREA': 'South Korea',

  // Abbreviations and special cases
  'JA': 'Japan',
  'ZH': 'China',
  '19': 'Unclassified',
  'UNDEFINED': 'Unknown',
  'NULL': 'Unknown',
  '': 'Unknown',
};

// Haru Studio Chart Colors - Vibrant & Modern
const PIE_COLORS = [
  '#6366F1', // Indigo
  '#10B981', // Emerald
  '#F59E0B', // Amber
  '#EF4444', // Red
  '#8B5CF6', // Violet
  '#14B8A6', // Teal
  '#F97316', // Orange
  '#EC4899', // Pink
  '#06B6D4', // Cyan
  '#84CC16', // Lime
  '#A855F7', // Purple
  '#22D3EE', // Sky
  '#FB923C', // Light Orange
  '#4ADE80', // Light Green
  '#818CF8'  // Light Indigo
];

const CountryOccupancyDashboard = () => {
  const [loading, setLoading] = useState(true);
  const [selectedPeriod, setSelectedPeriod] = useState('all'); // all, thisYear, thisMonth
  const [countryData, setCountryData] = useState([]);
  const [guestSizeData, setGuestSizeData] = useState([]);
  const [totalReservations, setTotalReservations] = useState(0);

  useEffect(() => {
    fetchCountryData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPeriod]);

  const fetchCountryData = async () => {
    setLoading(true);
    try {
      // 날짜 범위 계산
      const today = new Date();
      let startDate = null;

      if (selectedPeriod === 'thisYear') {
        startDate = `${today.getFullYear()}-01-01`;
      } else if (selectedPeriod === 'thisMonth') {
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        startDate = `${year}-${month}-01`;
      }

      // 쿼리 생성 (확정된 예약만)
      let q;
      if (startDate) {
        q = query(
          collection(db, "reservations"),
          where("status", "==", "confirmed"),
          where("arrival", ">=", startDate)
        );
      } else {
        q = query(
          collection(db, "reservations"),
          where("status", "==", "confirmed")
        );
      }

      const snapshot = await getDocs(q);

      // ★ 중복 제거: bookId 기준으로 유니크하게 (아라키초A, 가부키초, 다카다노바바 계정 중복 방지)
      const uniqueMap = new Map();
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        const bookId = data.bookId || data.refNum || doc.id; // bookId 우선, 없으면 refNum, 없으면 문서 ID

        // 이미 있는 예약이면 건너뛰기 (중복 제거)
        if (!uniqueMap.has(bookId)) {
          uniqueMap.set(bookId, data);
        }
      });

      const reservations = Array.from(uniqueMap.values());

      console.log(`🌍 Country Analysis: Total ${snapshot.docs.length} docs → ${reservations.length} unique confirmed reservations after deduplication`);

      // Debug: Check first 3 reservations
      if (reservations.length > 0) {
        console.log(`📋 Reservation Data Sample:`, reservations.slice(0, 3).map(r => ({
          bookId: r.bookId,
          refNum: r.refNum,
          guestName: r.guestName,
          guestCountry: r.guestCountry,
          numAdult: r.numAdult,
          building: r.building,
          room: r.room
        })));
      }

      // Country aggregation
      const countryMap = {};
      const unknownSamples = []; // Collect unknown data samples

      reservations.forEach(r => {
        const rawCountry = r.guestCountry || 'UNKNOWN';
        const countryCode = String(rawCountry).toUpperCase().trim();
        const countryName = COUNTRY_NAMES[countryCode] || (countryCode === 'UNKNOWN' ? 'Unknown' : countryCode);

        // Collect unknown data samples (first 10)
        if (countryName === 'Unknown' && unknownSamples.length < 10) {
          unknownSamples.push({
            bookId: r.bookId,
            guestName: r.guestName,
            guestCountry: r.guestCountry,
            rawValue: rawCountry,
            building: r.building,
            room: r.room
          });
        }

        if (!countryMap[countryName]) {
          countryMap[countryName] = 0;
        }
        countryMap[countryName]++;
      });

      // Log unknown data if exists
      if (unknownSamples.length > 0) {
        console.log(`⚠️ 'Unknown' country data samples (${unknownSamples.length}):`, unknownSamples);
      }

      // 국가별 데이터 정렬 (예약 건수 내림차순)
      const countryArray = Object.entries(countryMap)
        .map(([name, count]) => ({
          name,
          count,
          percentage: ((count / reservations.length) * 100).toFixed(1)
        }))
        .sort((a, b) => b.count - a.count);

      setCountryData(countryArray);
      setTotalReservations(reservations.length);

      // Guest size aggregation (based on numAdult)
      const guestSizeMap = {};
      reservations.forEach(r => {
        const size = r.numAdult || 1; // Default 1 guest
        const key = size === 1 ? '1 Guest' : `${size} Guests`;

        // Debug: Log reservations with 12+ guests
        if (size >= 12) {
          console.log(`⚠️ ${size} guests reservation found:`, {
            bookId: r.bookId,
            guestName: r.guestName,
            building: r.building,
            room: r.room,
            arrival: r.arrival,
            departure: r.departure,
            numAdult: r.numAdult
          });
        }

        if (!guestSizeMap[key]) {
          guestSizeMap[key] = 0;
        }
        guestSizeMap[key]++;
      });

      // Sort guest size data by number
      const guestSizeArray = Object.entries(guestSizeMap)
        .map(([name, count]) => ({
          name,
          count,
          percentage: ((count / reservations.length) * 100).toFixed(1)
        }))
        .sort((a, b) => {
          // Sort by number (1 Guest, 2 Guests, 3 Guests...)
          const aNum = parseInt(a.name);
          const bNum = parseInt(b.name);
          return aNum - bNum;
        });

      setGuestSizeData(guestSizeArray);

    } catch (error) {
      console.error("Failed to load country data:", error);
    } finally {
      setLoading(false);
    }
  };

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
    brandSection: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px'
    },
    logoIcon: {
      fontSize: '32px'
    },
    title: {
      fontSize: '28px',
      fontWeight: '700',
      color: '#1E293B',
      margin: 0,
      letterSpacing: '-0.5px'
    },
    subtitle: {
      fontSize: '14px',
      color: '#64748B',
      marginTop: '4px',
      fontWeight: '500'
    },
    filterSection: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      background: '#F8FAFC',
      padding: '12px 20px',
      borderRadius: '12px',
      border: '1px solid #E2E8F0'
    },
    filterLabel: {
      fontSize: '14px',
      fontWeight: '600',
      color: '#475569',
      whiteSpace: 'nowrap'
    },
    select: {
      padding: '8px 16px',
      borderRadius: '8px',
      border: '1px solid #E2E8F0',
      background: '#FFFFFF',
      color: '#1E293B',
      fontSize: '14px',
      fontWeight: '500',
      cursor: 'pointer',
      outline: 'none',
      transition: 'all 0.2s ease',
      minWidth: '120px'
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.brandSection}>
          <span style={styles.logoIcon}>✈️</span>
          <div>
            <h1 style={styles.title}>Country Occupancy Dashboard</h1>
            <p style={styles.subtitle}>Powered by Haru Studio</p>
          </div>
        </div>
        <div style={styles.filterSection}>
          <span style={styles.filterLabel}>Period:</span>
          <select
            style={styles.select}
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value)}
          >
            <option value="all">All Time</option>
            <option value="thisYear">This Year</option>
            <option value="thisMonth">This Month</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "80px", color: "#94A3B8", fontSize: "16px", fontWeight: "500" }}>
          Analyzing data...
        </div>
      ) : (
        <>
          <div className="responsive-grid" style={{ marginBottom: '32px' }}>
            <div style={{
              background: 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)',
              padding: '28px',
              borderRadius: '16px',
              color: '#FFFFFF',
              boxShadow: '0 4px 12px rgba(99, 102, 241, 0.15)'
            }}>
              <div style={{ fontSize: '14px', fontWeight: '600', opacity: 0.9, marginBottom: '12px' }}>
                Total Reservations
              </div>
              <div style={{ fontSize: '36px', fontWeight: '700', marginBottom: '8px' }}>
                {totalReservations}
              </div>
              <div style={{ fontSize: '13px', opacity: 0.85 }}>Confirmed bookings</div>
            </div>

            <div style={{
              background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
              padding: '28px',
              borderRadius: '16px',
              color: '#FFFFFF',
              boxShadow: '0 4px 12px rgba(16, 185, 129, 0.15)'
            }}>
              <div style={{ fontSize: '14px', fontWeight: '600', opacity: 0.9, marginBottom: '12px' }}>
                Countries
              </div>
              <div style={{ fontSize: '36px', fontWeight: '700', marginBottom: '8px' }}>
                {countryData.length}
              </div>
              <div style={{ fontSize: '13px', opacity: 0.85 }}>Unique nations</div>
            </div>

            <div style={{
              background: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
              padding: '28px',
              borderRadius: '16px',
              color: '#FFFFFF',
              boxShadow: '0 4px 12px rgba(245, 158, 11, 0.15)'
            }}>
              <div style={{ fontSize: '14px', fontWeight: '600', opacity: 0.9, marginBottom: '12px' }}>
                Top Country
              </div>
              <div style={{ fontSize: '28px', fontWeight: '700', marginBottom: '8px' }}>
                {countryData[0]?.name || '-'}
              </div>
              <div style={{ fontSize: '13px', opacity: 0.85 }}>
                {countryData[0]?.count || 0} bookings ({countryData[0]?.percentage || 0}%)
              </div>
            </div>

            <div style={{
              background: 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)',
              padding: '28px',
              borderRadius: '16px',
              color: '#FFFFFF',
              boxShadow: '0 4px 12px rgba(139, 92, 246, 0.15)'
            }}>
              <div style={{ fontSize: '14px', fontWeight: '600', opacity: 0.9, marginBottom: '12px' }}>
                Most Common
              </div>
              <div style={{ fontSize: '28px', fontWeight: '700', marginBottom: '8px' }}>
                {guestSizeData.reduce((max, curr) => curr.count > max.count ? curr : max, guestSizeData[0])?.name || '-'}
              </div>
              <div style={{ fontSize: '13px', opacity: 0.85 }}>
                {guestSizeData.reduce((max, curr) => curr.count > max.count ? curr : max, guestSizeData[0])?.count || 0} reservations
              </div>
            </div>
          </div>

          {/* Charts Section */}
          <div className="responsive-two-column" style={{ marginBottom: "32px" }}>
            {/* Country Pie Chart */}
            <div style={{
              background: '#FFFFFF',
              padding: '28px',
              borderRadius: '16px',
              border: '1px solid #E2E8F0',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)'
            }}>
              <div style={{
                fontSize: '18px',
                fontWeight: '700',
                color: '#1E293B',
                marginBottom: '24px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <span>🌏</span>
                <span>Country Distribution (Top 10)</span>
              </div>
              <ResponsiveContainer width="100%" height={400}>
                <PieChart>
                  <Pie
                    data={countryData.slice(0, 10)}
                    dataKey="count"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={120}
                    label={({ name, percentage }) => `${name} ${percentage}%`}
                    labelLine={{ stroke: '#94A3B8', strokeWidth: 1 }}
                  >
                    {countryData.slice(0, 10).map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value, name) => [`${value} reservations`, name]}
                    contentStyle={{
                      background: '#FFFFFF',
                      border: '1px solid #E2E8F0',
                      borderRadius: '8px',
                      padding: '12px',
                      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)'
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Guest Size Bar Chart */}
            <div style={{
              background: '#FFFFFF',
              padding: '28px',
              borderRadius: '16px',
              border: '1px solid #E2E8F0',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)'
            }}>
              <div style={{
                fontSize: '18px',
                fontWeight: '700',
                color: '#1E293B',
                marginBottom: '24px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <span>👥</span>
                <span>Guest Size Distribution</span>
              </div>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={guestSizeData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: '#64748B', fontSize: 12 }}
                    axisLine={{ stroke: '#E2E8F0' }}
                  />
                  <YAxis
                    tick={{ fill: '#64748B', fontSize: 12 }}
                    axisLine={{ stroke: '#E2E8F0' }}
                  />
                  <Tooltip
                    formatter={(value) => [`${value} reservations`]}
                    contentStyle={{
                      background: '#FFFFFF',
                      border: '1px solid #E2E8F0',
                      borderRadius: '8px',
                      padding: '12px',
                      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)'
                    }}
                  />
                  <Legend wrapperStyle={{ paddingTop: '20px' }} />
                  <Bar
                    dataKey="count"
                    name="Reservations"
                    fill="#6366F1"
                    radius={[8, 8, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Country Details Table */}
          <div style={{
            background: '#FFFFFF',
            padding: '28px',
            borderRadius: '16px',
            border: '1px solid #E2E8F0',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
            marginBottom: '32px'
          }}>
            <div style={{
              fontSize: '18px',
              fontWeight: '700',
              color: '#1E293B',
              marginBottom: '24px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <span>📊</span>
              <span>Country Statistics</span>
            </div>
            <div className="responsive-table-container">
              <table className="pc-table-view" style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
                <thead>
                  <tr style={{ background: '#F8FAFC' }}>
                    <th style={{
                      padding: '14px 16px',
                      textAlign: 'left',
                      fontSize: '13px',
                      fontWeight: '700',
                      color: '#475569',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      borderBottom: '2px solid #E2E8F0'
                    }}>Rank</th>
                    <th style={{
                      padding: '14px 16px',
                      textAlign: 'left',
                      fontSize: '13px',
                      fontWeight: '700',
                      color: '#475569',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      borderBottom: '2px solid #E2E8F0'
                    }}>Country</th>
                    <th style={{
                      padding: '14px 16px',
                      textAlign: 'right',
                      fontSize: '13px',
                      fontWeight: '700',
                      color: '#475569',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      borderBottom: '2px solid #E2E8F0'
                    }}>Reservations</th>
                    <th style={{
                      padding: '14px 16px',
                      textAlign: 'right',
                      fontSize: '13px',
                      fontWeight: '700',
                      color: '#475569',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      borderBottom: '2px solid #E2E8F0'
                    }}>Share</th>
                    <th style={{
                      padding: '14px 16px',
                      textAlign: 'right',
                      fontSize: '13px',
                      fontWeight: '700',
                      color: '#475569',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      borderBottom: '2px solid #E2E8F0'
                    }}>Distribution</th>
                  </tr>
                </thead>
                <tbody>
                  {countryData.map((country, index) => (
                    <tr
                      key={country.name}
                      style={{
                        background: index % 2 === 0 ? '#FFFFFF' : '#F8FAFC',
                        transition: 'background 0.2s ease'
                      }}
                    >
                      <td style={{
                        padding: '16px',
                        fontWeight: '600',
                        color: '#64748B',
                        fontSize: '14px',
                        borderBottom: '1px solid #E2E8F0'
                      }}>
                        #{index + 1}
                      </td>
                      <td style={{
                        padding: '16px',
                        fontWeight: '600',
                        fontSize: '15px',
                        color: '#1E293B',
                        borderBottom: '1px solid #E2E8F0'
                      }}>
                        {country.name}
                      </td>
                      <td style={{
                        padding: '16px',
                        textAlign: 'right',
                        color: '#6366F1',
                        fontWeight: '600',
                        fontSize: '15px',
                        borderBottom: '1px solid #E2E8F0'
                      }}>
                        {country.count}
                      </td>
                      <td style={{
                        padding: '16px',
                        textAlign: 'right',
                        fontWeight: '600',
                        color: '#1E293B',
                        fontSize: '15px',
                        borderBottom: '1px solid #E2E8F0'
                      }}>
                        {country.percentage}%
                      </td>
                      <td style={{
                        padding: '16px',
                        textAlign: 'right',
                        borderBottom: '1px solid #E2E8F0'
                      }}>
                        <div style={{
                          width: "100%",
                          height: "10px",
                          background: "#F1F5F9",
                          borderRadius: "6px",
                          overflow: "hidden",
                          position: "relative"
                        }}>
                          <div style={{
                            width: `${country.percentage}%`,
                            height: "100%",
                            background: `linear-gradient(90deg, ${PIE_COLORS[index % PIE_COLORS.length]}, ${PIE_COLORS[index % PIE_COLORS.length]}dd)`,
                            borderRadius: "6px",
                            transition: "width 0.5s ease"
                          }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Mobile Card List */}
              <div className="mobile-card-list">
                {countryData.map((country, index) => (
                  <div key={country.name} className="mobile-card-item">
                    <div className="mobile-card-row" style={{ borderBottom: '1px solid #F1F5F9', paddingBottom: '12px' }}>
                      <span style={{ fontWeight: '700', color: '#1E293B', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '12px', background: '#F1F5F9', padding: '2px 8px', borderRadius: '12px', color: '#64748B' }}>#{index + 1}</span>
                        {country.name}
                      </span>
                      <span style={{ color: '#6366F1', fontWeight: '700' }}>{country.percentage}%</span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-label">Reservations</span>
                      <span className="mobile-value">{country.count} bookings</span>
                    </div>
                    <div style={{ marginTop: '8px' }}>
                      <div style={{ width: '100%', height: '6px', background: '#F1F5F9', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ width: `${country.percentage}%`, height: '100%', background: PIE_COLORS[index % PIE_COLORS.length], borderRadius: '3px' }}></div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Guest Size Details Table */}
          <div style={{
            background: '#FFFFFF',
            padding: '28px',
            borderRadius: '16px',
            border: '1px solid #E2E8F0',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
            marginBottom: '32px'
          }}>
            <div style={{
              fontSize: '18px',
              fontWeight: '700',
              color: '#1E293B',
              marginBottom: '24px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <span>👥</span>
              <span>Guest Size Statistics</span>
            </div>
            <div className="responsive-table-container">
              <table className="pc-table-view" style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
                <thead>
                  <tr style={{ background: '#F8FAFC' }}>
                    <th style={{
                      padding: '14px 16px',
                      textAlign: 'left',
                      fontSize: '13px',
                      fontWeight: '700',
                      color: '#475569',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      borderBottom: '2px solid #E2E8F0'
                    }}>Party Size</th>
                    <th style={{
                      padding: '14px 16px',
                      textAlign: 'right',
                      fontSize: '13px',
                      fontWeight: '700',
                      color: '#475569',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      borderBottom: '2px solid #E2E8F0'
                    }}>Reservations</th>
                    <th style={{
                      padding: '14px 16px',
                      textAlign: 'right',
                      fontSize: '13px',
                      fontWeight: '700',
                      color: '#475569',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      borderBottom: '2px solid #E2E8F0'
                    }}>Share</th>
                    <th style={{
                      padding: '14px 16px',
                      textAlign: 'right',
                      fontSize: '13px',
                      fontWeight: '700',
                      color: '#475569',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      borderBottom: '2px solid #E2E8F0'
                    }}>Distribution</th>
                  </tr>
                </thead>
                <tbody>
                  {guestSizeData.map((size, index) => (
                    <tr
                      key={size.name}
                      style={{
                        background: index % 2 === 0 ? '#FFFFFF' : '#F8FAFC',
                        transition: 'background 0.2s ease'
                      }}
                    >
                      <td style={{
                        padding: '16px',
                        fontWeight: '600',
                        fontSize: '15px',
                        color: '#1E293B',
                        borderBottom: '1px solid #E2E8F0'
                      }}>
                        {size.name}
                      </td>
                      <td style={{
                        padding: '16px',
                        textAlign: 'right',
                        color: '#6366F1',
                        fontWeight: '600',
                        fontSize: '15px',
                        borderBottom: '1px solid #E2E8F0'
                      }}>
                        {size.count}
                      </td>
                      <td style={{
                        padding: '16px',
                        textAlign: 'right',
                        fontWeight: '600',
                        color: '#1E293B',
                        fontSize: '15px',
                        borderBottom: '1px solid #E2E8F0'
                      }}>
                        {size.percentage}%
                      </td>
                      <td style={{
                        padding: '16px',
                        textAlign: 'right',
                        borderBottom: '1px solid #E2E8F0'
                      }}>
                        <div style={{
                          width: "100%",
                          height: "10px",
                          background: "#F1F5F9",
                          borderRadius: "6px",
                          overflow: "hidden",
                          position: "relative"
                        }}>
                          <div style={{
                            width: `${size.percentage}%`,
                            height: "100%",
                            background: "linear-gradient(90deg, #6366F1, #4F46E5)",
                            borderRadius: "6px",
                            transition: "width 0.5s ease"
                          }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Mobile Card List */}
              <div className="mobile-card-list">
                {guestSizeData.map((size, index) => (
                  <div key={size.name} className="mobile-card-item">
                    <div className="mobile-card-row" style={{ borderBottom: '1px solid #F1F5F9', paddingBottom: '12px' }}>
                      <span style={{ fontWeight: '700', color: '#1E293B' }}>{size.name}</span>
                      <span style={{ color: '#6366F1', fontWeight: '700' }}>{size.percentage}%</span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-label">Reservations</span>
                      <span className="mobile-value">{size.count} bookings</span>
                    </div>
                    <div style={{ marginTop: '8px' }}>
                      <div style={{ width: '100%', height: '6px', background: '#F1F5F9', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ width: `${size.percentage}%`, height: '100%', background: "linear-gradient(90deg, #6366F1, #4F46E5)", borderRadius: '3px' }}></div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Help Section */}
          <div style={{
            background: 'linear-gradient(135deg, #F8FAFC 0%, #F1F5F9 100%)',
            padding: '24px 28px',
            borderRadius: '16px',
            border: '1px solid #E2E8F0',
            fontSize: '14px',
            color: '#475569',
            lineHeight: '1.8'
          }}>
            <div style={{
              fontSize: '16px',
              fontWeight: '700',
              color: '#1E293B',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <span>💡</span>
              <span>Dashboard Guide</span>
            </div>
            <ul style={{ marginTop: "12px", paddingLeft: "24px", lineHeight: "1.9" }}>
              <li style={{ marginBottom: '8px' }}>
                <strong style={{ color: '#1E293B' }}>Country Share:</strong> Shows visitor distribution by country based on confirmed reservations
              </li>
              <li style={{ marginBottom: '8px' }}>
                <strong style={{ color: '#1E293B' }}>Guest Count:</strong> Calculated based on adult guests per reservation
              </li>
              <li style={{ marginBottom: '8px' }}>
                <strong style={{ color: '#1E293B' }}>Time Period:</strong> Filter by All Time, This Year, or This Month
              </li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
};

export default CountryOccupancyDashboard;
