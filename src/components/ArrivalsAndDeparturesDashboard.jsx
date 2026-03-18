// ✈️ Haru Studio - Arrivals & Departures Management Dashboard
// Ultra-premium enterprise-grade property management interface

import React, { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { collection, query, where, getDocs } from "firebase/firestore";
import { db } from '../firebase';
import { useUser } from '../contexts/UserContext';
import { BUILDING_NAMES_EN } from '../constants/buildingData';

// Country code to flag emoji mapping
const COUNTRY_FLAGS = {
  'KR': '🇰🇷', 'JP': '🇯🇵', 'CN': '🇨🇳', 'TW': '🇹🇼', 'HK': '🇭🇰',
  'SG': '🇸🇬', 'MY': '🇲🇾', 'TH': '🇹🇭', 'VN': '🇻🇳', 'PH': '🇵🇭',
  'ID': '🇮🇩', 'IN': '🇮🇳', 'AU': '🇦🇺', 'NZ': '🇳🇿', 'GB': '🇬🇧',
  'FR': '🇫🇷', 'DE': '🇩🇪', 'IT': '🇮🇹', 'ES': '🇪🇸', 'NL': '🇳🇱',
  'BE': '🇧🇪', 'CH': '🇨🇭', 'AT': '🇦🇹', 'SE': '🇸🇪', 'NO': '🇳🇴',
  'DK': '🇩🇰', 'FI': '🇫🇮', 'PL': '🇵🇱', 'CZ': '🇨🇿', 'GR': '🇬🇷',
  'PT': '🇵🇹', 'IE': '🇮🇪', 'TR': '🇹🇷', 'RU': '🇷🇺', 'US': '🇺🇸',
  'CA': '🇨🇦', 'BR': '🇧🇷', 'MX': '🇲🇽', 'AR': '🇦🇷', 'CL': '🇨🇱',
  'CO': '🇨🇴', 'PE': '🇵🇪', 'SA': '🇸🇦', 'AE': '🇦🇪', 'IL': '🇮🇱',
  'KW': '🇰🇼', 'EG': '🇪🇬', 'ZA': '🇿🇦', 'NG': '🇳🇬', 'KE': '🇰🇪'
};

const getCountryFlag = (countryCode) => {
  if (!countryCode) return '🌐';
  const code = String(countryCode).toUpperCase().trim();
  return COUNTRY_FLAGS[code] || '🌐';
};

const getBuildingEN = (name) => BUILDING_NAMES_EN[name] || name;

// Format room number - remove "호" suffix
const formatRoomNumber = (room) => {
  if (!room) return 'N/A';
  // Remove "호" suffix (e.g., "201호" -> "201")
  return room.replace('호', '').trim();
};

// Format price for display
const formatPrice = (price) => {
  if (!price || price === 0) return "¥0";
  const numPrice = typeof price === 'string' ? parseFloat(price.replace(/[^0-9.-]+/g, "")) : price;
  if (isNaN(numPrice)) return "¥0";
  return `¥${Math.round(numPrice).toLocaleString()}`;
};

// Get platform color
const getPlatformColor = (platform) => {
  const p = (platform || '').toLowerCase();
  if (p.includes('booking')) return '#003580';
  return '#FF5A5F'; // Airbnb color
};

// Calculate nights between two dates
const calculateNights = (arrival, departure) => {
  if (!arrival || !departure) return 0;
  const start = new Date(arrival);
  const end = new Date(departure);
  const diffTime = Math.abs(end - start);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
};

// Month names (number + English)
const MONTHS = [
  '1 January', '2 February', '3 March', '4 April', '5 May', '6 June',
  '7 July', '8 August', '9 September', '10 October', '11 November', '12 December'
];

// Get days in month
const getDaysInMonth = (year, month) => {
  return new Date(year, month, 0).getDate();
};

const ArrivalsAndDeparturesDashboard = () => {
  const { companyId } = useUser();
  const currentDate = new Date();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [selectedYear, setSelectedYear] = useState(currentDate.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(currentDate.getMonth() + 1);
  const [selectedDay, setSelectedDay] = useState(currentDate.getDate());
  const [searchQuery, setSearchQuery] = useState('');
  const [arrivals, setArrivals] = useState([]);
  const [departures, setDepartures] = useState([]);
  const [filterPlatform, setFilterPlatform] = useState('all'); // all, airbnb, booking
  const [selectedGuest, setSelectedGuest] = useState(null); // For modal
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Year list (current year ±5 years)
  const YEARS = Array.from({length: 11}, (_, i) => currentDate.getFullYear() - 5 + i);

  // Days in selected month
  const daysInSelectedMonth = getDaysInMonth(selectedYear, selectedMonth);
  const DAYS = Array.from({length: daysInSelectedMonth}, (_, i) => i + 1);

  // Open guest detail modal
  const openGuestModal = (guest) => {
    setSelectedGuest(guest);
    setIsModalOpen(true);
  };

  // Close modal
  const closeModal = () => {
    setIsModalOpen(false);
    setTimeout(() => setSelectedGuest(null), 300); // Clear after animation
  };

  // Read URL search parameter and auto-search
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const searchParam = params.get('search');
    if (searchParam) {
      setSearchQuery(searchParam);
    }
  }, [location.search]);

  useEffect(() => {
    if (companyId) {
      fetchReservations();
    }
    // eslint-disable-next-line
  }, [selectedDate, searchQuery, companyId]);

  const fetchReservations = async () => {
    setLoading(true);
    try {
      let arrivalsData = [];
      let departuresData = [];

      if (!companyId) {
        console.warn('⚠️ No companyId available, skipping fetch');
        setLoading(false);
        return;
      }

      if (searchQuery.trim()) {
        // If there's a search query, fetch all confirmed reservations (no date filter)
        const allQuery = query(
          collection(db, "reservations"),
          where("companyId", "==", companyId),
          where("status", "==", "confirmed")
        );
        const allSnapshot = await getDocs(allQuery);
        const allReservations = allSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // Filter arrivals and departures from all reservations
        arrivalsData = allReservations;
        departuresData = allReservations;

        console.log(`✈️ Search mode: Loaded ${allReservations.length} total reservations for company ${companyId}`);
      } else {
        // Normal mode: filter by selected date
        const arrivalsQuery = query(
          collection(db, "reservations"),
          where("companyId", "==", companyId),
          where("status", "==", "confirmed"),
          where("arrival", "==", selectedDate)
        );

        const departuresQuery = query(
          collection(db, "reservations"),
          where("companyId", "==", companyId),
          where("status", "==", "confirmed"),
          where("departure", "==", selectedDate)
        );

        const [arrivalsSnapshot, departuresSnapshot] = await Promise.all([
          getDocs(arrivalsQuery),
          getDocs(departuresQuery)
        ]);

        arrivalsData = arrivalsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        departuresData = departuresSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        console.log(`✈️ Date mode: Loaded ${arrivalsData.length} arrivals, ${departuresData.length} departures for ${selectedDate} (company: ${companyId})`);
      }

      // Deduplicate by bookId
      const uniqueArrivals = Array.from(
        new Map(arrivalsData.map(item => [item.bookId || item.id, item])).values()
      );
      const uniqueDepartures = Array.from(
        new Map(departuresData.map(item => [item.bookId || item.id, item])).values()
      );

      setArrivals(uniqueArrivals);
      setDepartures(uniqueDepartures);
    } catch (error) {
      console.error("Failed to fetch reservations:", error);
    } finally {
      setLoading(false);
    }
  };

  // Filter and search logic
  const filteredArrivals = useMemo(() => {
    return arrivals.filter(item => {
      const matchesSearch = !searchQuery ||
        (item.guestName && item.guestName.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (item.room && item.room.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (item.building && item.building.toLowerCase().includes(searchQuery.toLowerCase()));

      // If search query exists, ignore date filter (show all matching results)
      // Otherwise, filter by arrival date (already filtered in query when no search)
      const matchesDate = searchQuery.trim() ? true : item.arrival === selectedDate;

      const matchesPlatform = filterPlatform === 'all' ||
        (item.platform && item.platform.toLowerCase().includes(filterPlatform));

      return matchesSearch && matchesDate && matchesPlatform;
    });
  }, [arrivals, searchQuery, filterPlatform, selectedDate]);

  const filteredDepartures = useMemo(() => {
    return departures.filter(item => {
      const matchesSearch = !searchQuery ||
        (item.guestName && item.guestName.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (item.room && item.room.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (item.building && item.building.toLowerCase().includes(searchQuery.toLowerCase()));

      // If search query exists, ignore date filter (show all matching results)
      // Otherwise, filter by departure date (already filtered in query when no search)
      const matchesDate = searchQuery.trim() ? true : item.departure === selectedDate;

      const matchesPlatform = filterPlatform === 'all' ||
        (item.platform && item.platform.toLowerCase().includes(filterPlatform));

      return matchesSearch && matchesDate && matchesPlatform;
    });
  }, [departures, searchQuery, filterPlatform, selectedDate]);

  // Format date for display
  const formatDisplayDate = (dateStr) => {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  // Get platform icon/badge
  const getPlatformBadge = (platform) => {
    const p = (platform || '').toLowerCase();
    if (p.includes('booking')) {
      return (
        <div style={styles.platformBadge.booking}>
          <span style={styles.platformIcon}>🏨</span>
          <span>Booking</span>
        </div>
      );
    }
    return (
      <div style={styles.platformBadge.airbnb}>
        <span style={styles.platformIcon}>🏠</span>
        <span>Airbnb</span>
      </div>
    );
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.brandSection}>
          <div style={styles.logoIcon}>✈️</div>
          <div>
            <h1 style={styles.title}>Arrivals & Departures</h1>
            <p style={styles.subtitle}>Haru Studio Property Management</p>
          </div>
        </div>

        {/* Control Bar */}
        <div style={styles.controlBar}>
          {/* Glassmorphic Search */}
          <div style={styles.searchWrapper}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#64748B"
              strokeWidth="2"
              style={styles.searchIcon}
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder="Search by guest name, room, or building..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={styles.searchInput}
            />
          </div>

          {/* Date Picker */}
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

          {/* Platform Filter */}
          <div style={styles.filterButtons}>
            <button
              onClick={() => setFilterPlatform('all')}
              style={{
                ...styles.filterBtn,
                ...(filterPlatform === 'all' ? styles.filterBtnActive : {})
              }}
            >
              All
            </button>
            <button
              onClick={() => setFilterPlatform('airbnb')}
              style={{
                ...styles.filterBtn,
                ...(filterPlatform === 'airbnb' ? styles.filterBtnActive : {})
              }}
            >
              Airbnb
            </button>
            <button
              onClick={() => setFilterPlatform('booking')}
              style={{
                ...styles.filterBtn,
                ...(filterPlatform === 'booking' ? styles.filterBtnActive : {})
              }}
            >
              Booking
            </button>
          </div>
        </div>
      </div>

      {/* Date Display */}
      <div style={styles.dateDisplay}>
        <div style={styles.dateDisplayInner}>
          <span style={styles.dateLabel}>Viewing:</span>
          <span style={styles.dateValue}>{formatDisplayDate(selectedDate)}</span>
        </div>
      </div>

      {loading ? (
        <div style={styles.loadingContainer}>
          <div style={styles.spinner}></div>
          <p style={styles.loadingText}>Loading reservations...</p>
        </div>
      ) : (
        <div style={styles.mainGrid}>
          {/* Expected Arrivals Block */}
          <div style={styles.block}>
            <div style={styles.blockHeader}>
              <div style={styles.blockTitleRow}>
                <h2 style={styles.blockTitle}>
                  <span style={styles.blockIcon}>🛬</span>
                  Expected Arrivals
                </h2>
                <div style={styles.countBadge.arrival}>
                  {filteredArrivals.length} {filteredArrivals.length === 1 ? 'Guest' : 'Guests'}
                </div>
              </div>
              <p style={styles.blockSubtitle}>
                Guests checking in today
              </p>
            </div>

            <div style={styles.guestList}>
              {filteredArrivals.length === 0 ? (
                <div style={styles.emptyState}>
                  <div style={styles.emptyIcon}>📭</div>
                  <p style={styles.emptyText}>No arrivals scheduled</p>
                  <p style={styles.emptySubtext}>Check another date or adjust filters</p>
                </div>
              ) : (
                filteredArrivals.map((guest) => (
                  <GuestCard
                    key={guest.id}
                    guest={guest}
                    type="arrival"
                    getPlatformBadge={getPlatformBadge}
                    onClick={() => openGuestModal(guest)}
                  />
                ))
              )}
            </div>
          </div>

          {/* Scheduled Departures Block */}
          <div style={styles.block}>
            <div style={styles.blockHeader}>
              <div style={styles.blockTitleRow}>
                <h2 style={styles.blockTitle}>
                  <span style={styles.blockIcon}>🛫</span>
                  Scheduled Departures
                </h2>
                <div style={styles.countBadge.departure}>
                  {filteredDepartures.length} {filteredDepartures.length === 1 ? 'Guest' : 'Guests'}
                </div>
              </div>
              <p style={styles.blockSubtitle}>
                Guests checking out today
              </p>
            </div>

            <div style={styles.guestList}>
              {filteredDepartures.length === 0 ? (
                <div style={styles.emptyState}>
                  <div style={styles.emptyIcon}>📭</div>
                  <p style={styles.emptyText}>No departures scheduled</p>
                  <p style={styles.emptySubtext}>Check another date or adjust filters</p>
                </div>
              ) : (
                filteredDepartures.map((guest) => (
                  <GuestCard
                    key={guest.id}
                    guest={guest}
                    type="departure"
                    getPlatformBadge={getPlatformBadge}
                    onClick={() => openGuestModal(guest)}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Quick Stats Footer */}
      {!loading && (
        <div style={styles.statsFooter}>
          <div style={styles.statItem}>
            <span style={styles.statLabel}>Total Check-ins</span>
            <span style={styles.statValue}>{filteredArrivals.length}</span>
          </div>
          <div style={styles.statDivider}></div>
          <div style={styles.statItem}>
            <span style={styles.statLabel}>Total Check-outs</span>
            <span style={styles.statValue}>{filteredDepartures.length}</span>
          </div>
          <div style={styles.statDivider}></div>
          <div style={styles.statItem}>
            <span style={styles.statLabel}>Net Occupancy Change</span>
            <span style={{
              ...styles.statValue,
              color: (filteredArrivals.length - filteredDepartures.length) > 0 ? '#10B981' :
                (filteredArrivals.length - filteredDepartures.length) < 0 ? '#EF4444' : '#64748B'
            }}>
              {filteredArrivals.length - filteredDepartures.length > 0 ? '+' : ''}
              {filteredArrivals.length - filteredDepartures.length}
            </span>
          </div>
        </div>
      )}

      {/* Reservation Detail Modal */}
      {isModalOpen && selectedGuest && (
        <ReservationDetailModal
          reservation={selectedGuest}
          onClose={closeModal}
        />
      )}
    </div>
  );
};

// Guest Card Component
const GuestCard = ({ guest, type, getPlatformBadge, onClick }) => {
  const statusColor = type === 'arrival' ? '#60A5FA' : '#FB923C'; // Soft blue vs Muted coral

  return (
    <div onClick={onClick} style={{...styles.guestCard, cursor: 'pointer'}}>
      {/* Left: Main Info */}
      <div style={styles.guestCardLeft}>
        <div style={styles.guestHeader}>
          <span style={styles.guestFlag}>{getCountryFlag(guest.guestCountry)}</span>
          <h3 style={styles.guestName}>{guest.guestName || 'Anonymous Guest'}</h3>
          <div style={{ ...styles.statusBadge, backgroundColor: `${statusColor}15`, color: statusColor }}>
            {type === 'arrival' ? 'Check-in' : 'Check-out'}
          </div>
        </div>

        <div style={styles.guestDetails}>
          <div style={styles.detailItem}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
            <span>{getBuildingEN(guest.building) || 'N/A'}</span>
          </div>
          {/* Hide room for standalone houses (Okubo/Sano) */}
          {!(guest.building && (guest.building.includes('오쿠보') || guest.building.includes('사노'))) && (
            <div style={styles.detailItem}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span>Room {formatRoomNumber(guest.room)}</span>
            </div>
          )}
          <div style={styles.detailItem}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <span>{guest.numAdult || 1} {guest.numAdult === 1 ? 'Guest' : 'Guests'}</span>
          </div>
        </div>
      </div>

      {/* Right: Platform & Dates */}
      <div style={styles.guestCardRight}>
        {getPlatformBadge(guest.platform)}
        <div style={styles.dateRange}>
          <div style={styles.dateRangeItem}>
            <span style={styles.dateRangeLabel}>Check-in</span>
            <span style={styles.dateRangeValue}>{guest.arrival || 'N/A'}</span>
          </div>
          <span style={styles.dateRangeSeparator}>→</span>
          <div style={styles.dateRangeItem}>
            <span style={styles.dateRangeLabel}>Check-out</span>
            <span style={styles.dateRangeValue}>{guest.departure || 'N/A'}</span>
          </div>
        </div>
        <div style={styles.confirmedBadge}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="3">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>Confirmed</span>
        </div>
      </div>
    </div>
  );
};

// Info Row Component for Modal
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

// Reservation Detail Modal Component
const ReservationDetailModal = ({ reservation, onClose }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
    ...reservation,
    totalPrice: reservation.totalPrice ?? reservation.price ?? ""
  });

  if (!reservation) return null;

  const platformColor = getPlatformColor(reservation.platform);
  const nights = calculateNights(reservation.arrival, reservation.departure);

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
        {/* Header */}
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
              {getBuildingEN(reservation.building)} · Room {formatRoomNumber(reservation.room)}
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
          }}>×</button>
        </div>

        {/* Guest Header Card */}
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
            <span>{getCountryFlag(reservation.guestCountry)} {reservation.guestCountry || "Unknown"}</span>
            <span>{isEditing ? editData.numAdult : reservation.numAdult || 0} Adults</span>
            <span>{isEditing ? editData.numChild : reservation.numChild || 0} Children</span>
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

        {/* Detail Info */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 24px" }}>
          <InfoRow icon="📧" label="Email" value={isEditing ? editData.guestEmail : reservation.guestEmail} field="guestEmail" isEditing={isEditing} editData={editData} setEditData={setEditData} />
          <InfoRow icon="📞" label="Phone" value={isEditing ? editData.guestPhone : reservation.guestPhone} field="guestPhone" isEditing={isEditing} editData={editData} setEditData={setEditData} />
          <InfoRow icon="🌍" label="Country" value={reservation.guestCountry} isEditing={false} editData={editData} setEditData={setEditData} />
          <InfoRow icon="🕐" label="Est. Arrival" value={reservation.arrivalTime} isEditing={false} editData={editData} setEditData={setEditData} />

          <div style={{ height: "12px" }} />

          <InfoRow icon="📅" label="Check-in" value={isEditing ? editData.arrival : reservation.arrival} field="arrival" isEditing={isEditing} editData={editData} setEditData={setEditData} />
          <InfoRow icon="📅" label="Check-out" value={isEditing ? editData.departure : reservation.departure} field="departure" isEditing={isEditing} editData={editData} setEditData={setEditData} />
          <InfoRow icon="🌙" label="Nights" value={nights ? `${nights} nights` : ""} isEditing={false} editData={editData} setEditData={setEditData} />

          <div style={{ height: "12px" }} />

          <InfoRow icon="👥" label="Adults" value={isEditing ? editData.numAdult : reservation.numAdult} field="numAdult" isEditing={isEditing} editData={editData} setEditData={setEditData} />
          <InfoRow icon="👶" label="Children" value={isEditing ? editData.numChild : reservation.numChild} field="numChild" isEditing={isEditing} editData={editData} setEditData={setEditData} />

          <div style={{ height: "12px" }} />

          <InfoRow icon="🏷️" label="Booking Ref." value={reservation.bookId || reservation.apiReference} isEditing={false} editData={editData} setEditData={setEditData} />

          <div style={{ height: "12px" }} />

          <InfoRow icon="💰" label="Total" value={formatPrice(isEditing ? editData.totalPrice : (reservation.totalPrice || reservation.price))} field="totalPrice" isEditing={isEditing} editData={editData} setEditData={setEditData} />
          {nights > 0 && (
            <InfoRow
              icon="🌙"
              label="Per Night"
              value={formatPrice(Math.round((parseFloat(String(isEditing ? editData.totalPrice : (reservation.totalPrice || reservation.price)).replace(/[^0-9.-]+/g, "")) || 0) / nights))}
              isEditing={false} editData={editData} setEditData={setEditData}
            />
          )}
          <InfoRow icon="💸" label="OTA Fee" value={formatPrice(reservation.commission)} isEditing={false} editData={editData} setEditData={setEditData} />
          <InfoRow icon="💵" label="Net Revenue" value={formatPrice(reservation.netRevenue)} isEditing={false} editData={editData} setEditData={setEditData} />

          {/* Guest Comments */}
          {reservation.guestComments && (
            <div style={{ marginTop: "16px", paddingBottom: "16px" }}>
              <div style={{ color: "#6B7280", fontSize: "14px", marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px", fontWeight: "500" }}>
                <span>💬</span> Notes & Requests
              </div>
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
            </div>
          )}
        </div>

        {/* Button Section */}
        <div style={{ padding: "20px 24px", borderTop: "1px solid #E5E7EB", display: "flex", flexDirection: "column", gap: "10px" }}>
          <button
            onClick={onClose}
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
              boxShadow: "0 4px 12px rgba(59, 130, 246, 0.3)",
              transition: "all 0.2s"
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

// Styles - Enterprise-grade Haru Studio Design
const styles = {
  container: {
    padding: '40px',
    background: 'linear-gradient(135deg, #F1F5F9 0%, #E2E8F0 100%)',
    minHeight: '100vh',
    fontFamily: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif"
  },

  // Header
  header: {
    marginBottom: '32px'
  },
  brandSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    marginBottom: '24px'
  },
  logoIcon: {
    fontSize: '48px',
    lineHeight: 1
  },
  title: {
    fontSize: '32px',
    fontWeight: '700',
    color: '#1E293B',
    margin: 0,
    letterSpacing: '-0.8px'
  },
  subtitle: {
    fontSize: '15px',
    color: '#64748B',
    marginTop: '4px',
    fontWeight: '500'
  },

  // Control Bar (Glassmorphism)
  controlBar: {
    display: 'flex',
    gap: '16px',
    flexWrap: 'wrap',
    alignItems: 'center',
    background: 'rgba(255, 255, 255, 0.7)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    padding: '20px 24px',
    borderRadius: '20px',
    border: '1px solid rgba(255, 255, 255, 0.3)',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.5)'
  },
  searchWrapper: {
    position: 'relative',
    flex: '1 1 300px',
    minWidth: '250px'
  },
  searchIcon: {
    position: 'absolute',
    left: '16px',
    top: '50%',
    transform: 'translateY(-50%)',
    pointerEvents: 'none'
  },
  searchInput: {
    width: '100%',
    padding: '12px 16px 12px 44px',
    border: '1px solid #E2E8F0',
    borderRadius: '12px',
    fontSize: '14px',
    fontWeight: '500',
    color: '#1E293B',
    background: '#FFFFFF',
    outline: 'none',
    transition: 'all 0.2s ease',
    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)'
  },
  datePickerWrapper: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    background: 'white',
    padding: '10px 14px',
    borderRadius: '12px',
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
  filterButtons: {
    display: 'flex',
    gap: '8px',
    background: '#F8FAFC',
    padding: '4px',
    borderRadius: '10px'
  },
  filterBtn: {
    padding: '8px 16px',
    border: 'none',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: '600',
    color: '#64748B',
    background: 'transparent',
    cursor: 'pointer',
    transition: 'all 0.2s ease'
  },
  filterBtnActive: {
    background: '#FFFFFF',
    color: '#4F46E5',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)'
  },

  // Date Display
  dateDisplay: {
    marginBottom: '32px',
    display: 'flex',
    justifyContent: 'center'
  },
  dateDisplayInner: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 24px',
    background: '#FFFFFF',
    borderRadius: '16px',
    border: '1px solid #E2E8F0',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)'
  },
  dateLabel: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  },
  dateValue: {
    fontSize: '15px',
    fontWeight: '700',
    color: '#1E293B'
  },

  // Loading
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '100px 20px',
    background: '#FFFFFF',
    borderRadius: '24px',
    border: '1px solid #E2E8F0',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.06)'
  },
  spinner: {
    width: '48px',
    height: '48px',
    border: '4px solid #E2E8F0',
    borderTop: '4px solid #4F46E5',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite'
  },
  loadingText: {
    marginTop: '20px',
    fontSize: '15px',
    fontWeight: '500',
    color: '#64748B'
  },

  // Main Grid
  mainGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '24px',
    marginBottom: '32px'
  },

  // Block (Arrival/Departure)
  block: {
    background: '#FFFFFF',
    borderRadius: '24px',
    padding: '32px',
    border: '1px solid #E2E8F0',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.06)',
    minHeight: '500px'
  },
  blockHeader: {
    marginBottom: '28px',
    paddingBottom: '20px',
    borderBottom: '2px solid #F1F5F9'
  },
  blockTitleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px'
  },
  blockTitle: {
    fontSize: '22px',
    fontWeight: '700',
    color: '#1E293B',
    margin: 0,
    display: 'flex',
    alignItems: 'center',
    gap: '12px'
  },
  blockIcon: {
    fontSize: '28px'
  },
  blockSubtitle: {
    fontSize: '14px',
    color: '#64748B',
    margin: '4px 0 0 0',
    fontWeight: '500'
  },
  countBadge: {
    arrival: {
      padding: '8px 16px',
      background: 'linear-gradient(135deg, #DBEAFE 0%, #BFDBFE 100%)',
      color: '#1E40AF',
      borderRadius: '12px',
      fontSize: '13px',
      fontWeight: '700',
      border: '1px solid #93C5FD'
    },
    departure: {
      padding: '8px 16px',
      background: 'linear-gradient(135deg, #FED7AA 0%, #FDBA74 100%)',
      color: '#C2410C',
      borderRadius: '12px',
      fontSize: '13px',
      fontWeight: '700',
      border: '1px solid #FB923C'
    }
  },

  // Guest List
  guestList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  },

  // Guest Card
  guestCard: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 24px',
    background: 'linear-gradient(135deg, #FAFAFA 0%, #F8FAFC 100%)',
    borderRadius: '16px',
    border: '1px solid #E2E8F0',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    cursor: 'pointer'
  },
  guestCardLeft: {
    flex: 1
  },
  guestHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '12px'
  },
  guestFlag: {
    fontSize: '24px',
    lineHeight: 1
  },
  guestName: {
    fontSize: '16px',
    fontWeight: '700',
    color: '#1E293B',
    margin: 0,
    flex: 1
  },
  statusBadge: {
    padding: '6px 12px',
    borderRadius: '8px',
    fontSize: '12px',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  },
  guestDetails: {
    display: 'flex',
    gap: '20px',
    flexWrap: 'wrap'
  },
  detailItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
    color: '#64748B',
    fontWeight: '500'
  },

  // Guest Card Right
  guestCardRight: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '12px'
  },
  platformBadge: {
    airbnb: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '6px 12px',
      background: 'linear-gradient(135deg, #FF5A5F 0%, #FF385C 100%)',
      color: '#FFFFFF',
      borderRadius: '8px',
      fontSize: '12px',
      fontWeight: '700',
      boxShadow: '0 2px 8px rgba(255, 90, 95, 0.3)'
    },
    booking: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '6px 12px',
      background: 'linear-gradient(135deg, #003580 0%, #00224F 100%)',
      color: '#FFFFFF',
      borderRadius: '8px',
      fontSize: '12px',
      fontWeight: '700',
      boxShadow: '0 2px 8px rgba(0, 53, 128, 0.3)'
    }
  },
  platformIcon: {
    fontSize: '14px',
    lineHeight: 1
  },
  dateRange: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    background: '#F8FAFC',
    borderRadius: '10px',
    border: '1px solid #E2E8F0'
  },
  dateRangeItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px'
  },
  dateRangeLabel: {
    fontSize: '10px',
    color: '#94A3B8',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  },
  dateRangeValue: {
    fontSize: '12px',
    color: '#1E293B',
    fontWeight: '700'
  },
  dateRangeSeparator: {
    fontSize: '12px',
    color: '#CBD5E1',
    fontWeight: '700'
  },
  confirmedBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 12px',
    background: 'linear-gradient(135deg, #D1FAE5 0%, #A7F3D0 100%)',
    color: '#059669',
    borderRadius: '8px',
    fontSize: '11px',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    border: '1px solid #6EE7B7'
  },

  // Empty State
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px 20px',
    textAlign: 'center'
  },
  emptyIcon: {
    fontSize: '64px',
    marginBottom: '16px',
    opacity: 0.5
  },
  emptyText: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#64748B',
    margin: '0 0 8px 0'
  },
  emptySubtext: {
    fontSize: '14px',
    color: '#94A3B8',
    margin: 0
  },

  // Stats Footer
  statsFooter: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '32px',
    padding: '24px 32px',
    background: '#FFFFFF',
    borderRadius: '20px',
    border: '1px solid #E2E8F0',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.06)'
  },
  statItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px'
  },
  statLabel: {
    fontSize: '12px',
    fontWeight: '600',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  },
  statValue: {
    fontSize: '28px',
    fontWeight: '700',
    color: '#1E293B'
  },
  statDivider: {
    width: '1px',
    height: '40px',
    background: '#E2E8F0'
  }
};

// CSS Animations
const styleSheet = document.createElement("style");
styleSheet.innerText = `
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  /* Hover effects */
  .guest-card-hover:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12) !important;
    border-color: #4F46E5 !important;
  }

  input[type="text"]:focus,
  input[type="date"]:focus {
    border-color: #4F46E5 !important;
    box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1) !important;
  }

  button:hover {
    opacity: 0.9;
  }

  button:active {
    transform: scale(0.98);
  }

  @media (max-width: 1024px) {
    .main-grid-responsive {
      grid-template-columns: 1fr !important;
    }
  }
`;
document.head.appendChild(styleSheet);

export default ArrivalsAndDeparturesDashboard;
