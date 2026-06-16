import React, { useCallback, useEffect, useRef, useState } from 'react';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useUser } from '../contexts/UserContext';
import { BUILDING_NAMES_EN } from '../constants/buildingData';

const CARD_BORDER = '1px solid #E2E8F0';
const SEARCH_RESULT_LIMIT = 40;

const getBuildingName = (name) => BUILDING_NAMES_EN[name] || name || 'Unknown';

const formatRoom = (room) => String(room || '').replace('호', '').trim();

const safeArray = (value) => (Array.isArray(value) ? value : []);

const normalizeSearchText = (value) =>
  String(value || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');

const getSearchToken = (term) => {
  const normalized = normalizeSearchText(term);
  if (!normalized) return '';
  const parts = normalized.split(/[^\p{L}\p{N}@._+-]+/u).filter(Boolean);
  return [...parts, normalized].sort((a, b) => b.length - a.length)[0] || normalized;
};

const formatDate = (dateStr) => {
  if (!dateStr) return '-';
  try {
    const parsed = new Date(`${dateStr}T00:00:00`);
    return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
};

const formatCurrency = (amount) => {
  const parsed = Number(amount || 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return '-';
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0,
  }).format(parsed);
};

const getPlatformStyle = (platform = '') => {
  const normalized = String(platform).toLowerCase();
  if (normalized.includes('airbnb')) return { bg: '#FFF1F2', color: '#E11D48', border: '#FECDD3' };
  if (normalized.includes('booking')) return { bg: '#EFF6FF', color: '#1D4ED8', border: '#BFDBFE' };
  if (normalized.includes('expedia')) return { bg: '#FFF7ED', color: '#C2410C', border: '#FED7AA' };
  if (normalized.includes('agoda')) return { bg: '#F0FDF4', color: '#15803D', border: '#BBF7D0' };
  return { bg: '#F8FAFC', color: '#475569', border: '#CBD5E1' };
};

const pickReservationFields = (reservation = {}) => ({
  id: reservation.id || '',
  arrival: reservation.arrival || '',
  departure: reservation.departure || '',
  building: reservation.building || '',
  room: reservation.room || '',
  platform: reservation.platform || '',
  totalPrice: Number(reservation.totalPrice || reservation.price || 0),
  nights: Number(reservation.nights || 0),
  numAdult: Number(reservation.numAdult || 0),
  numChild: Number(reservation.numChild || 0),
  status: reservation.status || '',
  bookId: reservation.bookId || '',
  bookDate: reservation.bookDate || '',
  arrivalTime: reservation.arrivalTime || '',
});

const normalizeCustomer = (customer = {}) => ({
  ...customer,
  customerKey: customer.customerKey || customer.id || customer.guestName || 'unknown',
  guestName: customer.guestName || '',
  guestEmail: customer.guestEmail || '',
  guestPhone: customer.guestPhone || '',
  guestCountry: customer.guestCountry || '',
  guestCity: customer.guestCity || '',
  guestAddress: customer.guestAddress || '',
  lang: customer.lang || '',
  notes: customer.notes || '',
  visitCount: Number(customer.visitCount || 0),
  totalSpent: Number(customer.totalSpent || 0),
  totalNights: Number(customer.totalNights || 0),
  totalAdults: Number(customer.totalAdults || 0),
  totalChildren: Number(customer.totalChildren || 0),
  platforms: safeArray(customer.platforms),
  buildings: safeArray(customer.buildings),
  buildingRooms: safeArray(customer.buildingRooms),
  recentReservations: safeArray(customer.recentReservations).map((reservation) => pickReservationFields(reservation)),
  latestReservation: pickReservationFields(customer.latestReservation || {}),
  firstVisit: customer.firstVisit || '',
  lastVisit: customer.lastVisit || '',
});

const buildCustomerKey = (reservation = {}) => {
  const name = String(reservation.guestName || '').trim().toLowerCase();
  const email = String(reservation.guestEmail || '').trim().toLowerCase();
  const phone = String(reservation.guestPhone || '').trim().toLowerCase();
  return email ? `${name}__${email}` : `${name}__${phone || reservation.bookId || reservation.id || 'unknown'}`;
};

const aggregateReservationsToCustomers = (reservations = []) => {
  const grouped = new Map();

  reservations.forEach((reservation) => {
    const guestName = String(reservation?.guestName || '').trim();
    if (!guestName || guestName.toLowerCase() === 'unknown') return;
    if (reservation.status === 'blackout' || reservation.status === 'maintenance') return;

    const key = buildCustomerKey(reservation);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(reservation);
  });

  return Array.from(grouped.entries()).map(([customerKey, rows]) => {
    const sorted = [...rows].sort((a, b) =>
      String(b.arrival || b.bookDate || '').localeCompare(String(a.arrival || a.bookDate || ''))
    );
    const latest = sorted[0] || {};
    const first = sorted[sorted.length - 1] || {};

    const platforms = [...new Set(rows.map((row) => row.platform).filter(Boolean))];
    const buildings = [...new Set(rows.map((row) => getBuildingName(row.building)).filter(Boolean))];
    const buildingRooms = [...new Set(rows.map((row) =>
      `${getBuildingName(row.building)}${row.room ? ` / ${formatRoom(row.room)}` : ''}`.trim()
    ).filter(Boolean))];

    return normalizeCustomer({
      customerKey,
      guestName: latest.guestName || first.guestName || '',
      guestEmail: latest.guestEmail || first.guestEmail || '',
      guestPhone: latest.guestPhone || first.guestPhone || '',
      guestCountry: latest.guestCountry || latest.guestCountry2 || first.guestCountry || first.guestCountry2 || '',
      guestCity: latest.guestCity || first.guestCity || '',
      guestAddress: latest.guestAddress || first.guestAddress || '',
      lang: latest.lang || first.lang || '',
      notes: latest.comments || latest.notes || latest.guestComment || first.comments || first.notes || first.guestComment || '',
      visitCount: rows.length,
      totalSpent: rows.reduce((sum, row) => sum + Number(row.totalPrice || row.price || 0), 0),
      totalNights: rows.reduce((sum, row) => sum + Number(row.nights || 0), 0),
      totalAdults: rows.reduce((sum, row) => sum + Number(row.numAdult || 0), 0),
      totalChildren: rows.reduce((sum, row) => sum + Number(row.numChild || 0), 0),
      platforms,
      buildings,
      buildingRooms,
      firstVisit: first.arrival || first.bookDate || '',
      lastVisit: latest.arrival || latest.bookDate || '',
      latestReservation: latest,
      recentReservations: sorted.slice(0, 5),
    });
  });
};

const matchesSearch = (customer, term) => {
  const normalized = normalizeCustomer(customer);
  const lowerTerm = normalizeSearchText(term);
  const haystack = [
    normalized.guestName,
    normalized.guestEmail,
    normalized.guestPhone,
    normalized.guestCountry,
    normalized.guestCity,
    normalized.buildings.join(' '),
    normalized.buildingRooms.join(' '),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ');

  return haystack.includes(lowerTerm);
};

const MetricCard = ({ label, value, accent = '#4F46E5' }) => (
  <div
    className="guest-search-metric-card"
    style={{
      border: CARD_BORDER,
      borderRadius: '18px',
      padding: '16px 18px',
      background: 'linear-gradient(180deg, #FFFFFF 0%, #F8FAFC 100%)',
      minHeight: '92px',
    }}
  >
    <div style={{ fontSize: '11px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
      {label}
    </div>
    <div style={{ marginTop: '10px', fontSize: '24px', fontWeight: 800, color: accent, letterSpacing: '-0.03em' }}>
      {value}
    </div>
  </div>
);

const SectionCard = ({ title, children }) => (
  <div
    className="guest-search-section-card"
    style={{
      border: CARD_BORDER,
      borderRadius: '20px',
      background: '#FFFFFF',
      padding: '18px 20px',
      minHeight: 0,
    }}
  >
    <div style={{ fontSize: '12px', fontWeight: 800, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '14px' }}>
      {title}
    </div>
    {children}
  </div>
);

const DetailRow = ({ label, value }) => (
  <div className="guest-search-detail-row" style={{ display: 'grid', gridTemplateColumns: '112px 1fr', gap: '12px', padding: '8px 0', borderBottom: '1px solid #F1F5F9' }}>
    <div className="guest-search-detail-label" style={{ fontSize: '13px', color: '#94A3B8', fontWeight: 600 }}>{label}</div>
    <div className="guest-search-detail-value" style={{ fontSize: '13px', color: '#1E293B', fontWeight: 600, wordBreak: 'break-word' }}>{value || '-'}</div>
  </div>
);

const GuestResultItem = ({ customer, onClick }) => {
  const normalized = normalizeCustomer(customer);
  const platform = normalized.platforms[0] || normalized.latestReservation.platform || '';
  const platformStyle = getPlatformStyle(platform);

  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        border: CARD_BORDER,
        borderRadius: '18px',
        background: '#FFFFFF',
        padding: '16px 18px',
        display: 'grid',
        gridTemplateColumns: '56px 1fr auto',
        alignItems: 'center',
        gap: '14px',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'all 0.18s ease',
        marginBottom: '12px',
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.borderColor = '#4F46E5';
        event.currentTarget.style.boxShadow = '0 10px 24px rgba(79, 70, 229, 0.10)';
        event.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.borderColor = '#E2E8F0';
        event.currentTarget.style.boxShadow = 'none';
        event.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <div
        style={{
          width: '56px',
          height: '56px',
          borderRadius: '16px',
          background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
          color: '#FFFFFF',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '22px',
          fontWeight: 800,
        }}
      >
        {(normalized.guestName || '?').charAt(0).toUpperCase()}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '16px', fontWeight: 800, color: '#0F172A', marginBottom: '4px' }}>{normalized.guestName}</div>
        <div style={{ fontSize: '12px', color: '#64748B', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          <span>{normalized.guestEmail || normalized.guestPhone || 'No contact info'}</span>
          {normalized.lastVisit && <span>{formatDate(normalized.lastVisit)}</span>}
          {normalized.buildingRooms[0] && <span>{normalized.buildingRooms[0]}</span>}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span
          style={{
            background: platformStyle.bg,
            color: platformStyle.color,
            border: `1px solid ${platformStyle.border}`,
            padding: '4px 10px',
            borderRadius: '999px',
            fontSize: '11px',
            fontWeight: 700,
          }}
        >
          {platform || 'Guest'}
        </span>
        <span style={{ fontSize: '12px', color: '#64748B', fontWeight: 700 }}>{normalized.visitCount} stays</span>
      </div>
    </button>
  );
};

const GuestDetailFrame = ({ customer, onBack }) => {
  const normalized = normalizeCustomer(customer);
  const latestReservation = normalized.latestReservation || {};
  const primaryPlatform = normalized.platforms[0] || latestReservation.platform || '';
  const latestRoom = latestReservation.room ? formatRoom(latestReservation.room) : '-';
  const latestBuilding = latestReservation.building ? getBuildingName(latestReservation.building) : '-';
  const guestCountLabel = `${normalized.totalAdults} adults / ${normalized.totalChildren} children`;

  return (
    <div className="guest-search-frame" style={{ display: 'grid', gap: '18px', minHeight: 0 }}>
      <button
        className="guest-search-back-button"
        onClick={onBack}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          border: 'none',
          background: 'none',
          color: '#4F46E5',
          fontSize: '13px',
          fontWeight: 700,
          cursor: 'pointer',
          padding: 0,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Back to results
      </button>

      <div
        className="guest-search-hero"
        style={{
          background: 'linear-gradient(135deg, #4338CA 0%, #7C3AED 55%, #8B5CF6 100%)',
          borderRadius: '24px',
          padding: '22px 24px',
          color: '#FFFFFF',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '18px', alignItems: 'flex-start' }}>
          <div>
            <div className="guest-search-hero-title" style={{ fontSize: '30px', fontWeight: 900, letterSpacing: '-0.04em', lineHeight: 1.1 }}>{normalized.guestName}</div>
            <div className="guest-search-hero-meta" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '10px', fontSize: '13px', opacity: 0.92 }}>
              <span>{latestBuilding} / {latestRoom}</span>
              {normalized.guestCountry && <span>{normalized.guestCountry}</span>}
              {normalized.lang && <span>{normalized.lang}</span>}
            </div>
          </div>
          <span
            style={{
              alignSelf: 'flex-start',
              background: 'rgba(255,255,255,0.16)',
              border: '1px solid rgba(255,255,255,0.22)',
              borderRadius: '999px',
              padding: '6px 12px',
              fontSize: '12px',
              fontWeight: 700,
              whiteSpace: 'nowrap',
            }}
          >
            {primaryPlatform || 'Guest'}
          </span>
        </div>
      </div>

      <div className="guest-search-metrics" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '14px' }}>
        <MetricCard label="Visits" value={normalized.visitCount} />
        <MetricCard label="Total Nights" value={normalized.totalNights} accent="#0F766E" />
        <MetricCard label="Total Spend" value={formatCurrency(normalized.totalSpent)} accent="#C2410C" />
        <MetricCard label="Guest Mix" value={guestCountLabel} accent="#7C3AED" />
      </div>

      <div className="guest-search-detail" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '16px', minHeight: 0 }}>
        <SectionCard title="Contact Details">
          <DetailRow label="Email" value={normalized.guestEmail} />
          <DetailRow label="Phone" value={normalized.guestPhone} />
          <DetailRow label="Country" value={normalized.guestCountry} />
          <DetailRow label="City" value={normalized.guestCity} />
          <DetailRow label="Address" value={normalized.guestAddress} />
          <DetailRow label="Language" value={normalized.lang} />
        </SectionCard>

        <SectionCard title="History Summary">
          <DetailRow label="First Visit" value={formatDate(normalized.firstVisit)} />
          <DetailRow label="Last Visit" value={formatDate(normalized.lastVisit)} />
          <DetailRow label="Platforms" value={normalized.platforms.join(', ')} />
          <DetailRow label="Properties" value={normalized.buildings.join(', ')} />
          <DetailRow label="Rooms Used" value={normalized.buildingRooms.join(', ')} />
        </SectionCard>

        <SectionCard title="Stay Snapshot">
          <DetailRow label="Latest Arrival" value={formatDate(latestReservation.arrival)} />
          <DetailRow label="Latest Departure" value={formatDate(latestReservation.departure)} />
          <DetailRow label="Latest Room" value={`${latestBuilding} / ${latestRoom}`} />
          <DetailRow label="Booking ID" value={latestReservation.bookId || latestReservation.id} />
          <DetailRow label="Guests" value={`${latestReservation.numAdult || 0} adults, ${latestReservation.numChild || 0} children`} />
          <DetailRow label="Status" value={latestReservation.status} />
        </SectionCard>

        <SectionCard title="Recent Reservations">
          <div className="guest-search-recent-list" style={{ display: 'grid', gap: '10px' }}>
            {normalized.recentReservations.map((reservation) => {
              const style = getPlatformStyle(reservation.platform || '');
              return (
                <div
                  key={reservation.id}
                  className="guest-search-recent-item"
                  style={{
                    border: CARD_BORDER,
                    borderRadius: '14px',
                    padding: '12px 14px',
                    background: '#F8FAFC',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 800, color: '#0F172A' }}>
                        {getBuildingName(reservation.building)} / {formatRoom(reservation.room)}
                      </div>
                      <div style={{ fontSize: '12px', color: '#64748B', marginTop: '4px' }}>
                        {formatDate(reservation.arrival)} - {formatDate(reservation.departure)}
                      </div>
                    </div>
                    <span
                      style={{
                        background: style.bg,
                        color: style.color,
                        border: `1px solid ${style.border}`,
                        borderRadius: '999px',
                        padding: '4px 10px',
                        fontSize: '11px',
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {reservation.platform || 'Unknown'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      </div>

      {normalized.notes && (
        <SectionCard title="Notes">
          <div
            style={{
              fontSize: '13px',
              lineHeight: 1.65,
              color: '#475569',
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {normalized.notes}
          </div>
        </SectionCard>
      )}
    </div>
  );
};

const GuestSearchModal = ({ initialQuery = '', onClose }) => {
  const { companyId } = useUser();
  const [searchInput, setSearchInput] = useState(initialQuery);
  const [results, setResults] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef(null);
  const cachedProfilesRef = useRef(null);
  const cachedReservationsRef = useRef(null);
  const hasSearchTokenIndexRef = useRef(null);

  const doSearch = useCallback(async (term) => {
    const trimmed = String(term || '').trim();
    if (!trimmed || !companyId) return;

    setLoading(true);
    setSearched(true);
    setSelectedCustomer(null);

    try {
      const token = getSearchToken(trimmed);
      let searchSource = [];
      let tokenSearchFailed = false;

      if (token) {
        try {
          const snapshot = await getDocs(
            query(
              collection(db, 'customer_search_index'),
              where('companyId', '==', companyId),
              where('searchTokens', 'array-contains', token),
              limit(SEARCH_RESULT_LIMIT)
            )
          );
          searchSource = snapshot.docs.map((doc) => normalizeCustomer({ id: doc.id, ...doc.data() }));
        } catch (error) {
          tokenSearchFailed = true;
          console.warn('Guest token search fallback:', error);
        }
      }

      if (!tokenSearchFailed && searchSource.length === 0 && hasSearchTokenIndexRef.current === null) {
        const sampleSnapshot = await getDocs(
          query(
            collection(db, 'customer_search_index'),
            where('companyId', '==', companyId),
            limit(1)
          )
        );
        const sampleDoc = sampleSnapshot.docs[0]?.data();
        hasSearchTokenIndexRef.current = Array.isArray(sampleDoc?.searchTokens) && sampleDoc.searchTokens.length > 0;
      }

      const shouldUseFallback =
        tokenSearchFailed ||
        (searchSource.length === 0 && hasSearchTokenIndexRef.current !== true);

      if (shouldUseFallback && !cachedProfilesRef.current) {
        const fallbackSnapshot = await getDocs(
          query(
            collection(db, 'customer_search_index'),
            where('companyId', '==', companyId)
          )
        );
        cachedProfilesRef.current = fallbackSnapshot.docs.map((doc) => normalizeCustomer({ id: doc.id, ...doc.data() }));
      }

      if (searchSource.length === 0) {
        searchSource = cachedProfilesRef.current || [];
      }

      if (!Array.isArray(searchSource) || searchSource.length === 0) {
        if (!cachedReservationsRef.current) {
          const reservationsSnapshot = await getDocs(
            query(collection(db, 'reservations'), where('companyId', '==', companyId))
          );
          cachedReservationsRef.current = reservationsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        }
        searchSource = aggregateReservationsToCustomers(cachedReservationsRef.current);
      }

      const matched = searchSource
        .filter((customer) => matchesSearch(customer, trimmed))
        .sort((a, b) => String(b.lastVisit || '').localeCompare(String(a.lastVisit || '')))
        .slice(0, SEARCH_RESULT_LIMIT);

      setResults(matched);
      if (matched.length === 1) setSelectedCustomer(matched[0]);
    } catch (error) {
      console.error('Guest search error:', error);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    if (initialQuery.trim()) {
      doSearch(initialQuery);
    } else {
      inputRef.current?.focus();
    }
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleKeyDown = (event) => {
    if (event.key === 'Enter') doSearch(searchInput);
    if (event.key === 'Escape') onClose();
  };

  const resultLabel = searched
    ? `${results.length} result${results.length === 1 ? '' : 's'} found`
    : 'Search for a guest';

  return (
    <div
      className="guest-search-modal-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.58)',
        backdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        zIndex: 10000,
        boxSizing: 'border-box',
      }}
    >
      <div
        className="guest-search-modal-shell"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'min(1180px, calc(100vw - 32px))',
          height: 'min(820px, calc(100dvh - 32px))',
          minHeight: 0,
          maxHeight: 'calc(100dvh - 32px)',
          background: '#FFFFFF',
          borderRadius: '28px',
          boxShadow: '0 44px 90px rgba(15, 23, 42, 0.28)',
          overflow: 'hidden',
          display: 'grid',
          gridTemplateRows: 'auto minmax(0, 1fr)',
        }}
      >
        <div className="guest-search-modal-header" style={{ padding: '24px 28px 20px', borderBottom: '1px solid #E2E8F0' }}>
          <div className="guest-search-title-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', marginBottom: '18px' }}>
            <div className="guest-search-title-copy">
              <div className="guest-search-title" style={{ fontSize: '28px', fontWeight: 900, color: '#0F172A', letterSpacing: '-0.04em' }}>Guest Search</div>
              <div className="guest-search-subtitle" style={{ marginTop: '4px', fontSize: '13px', color: '#94A3B8' }}>
                Search guest profiles and view their booking details in one frame
              </div>
            </div>
            <button
              className="guest-search-close-button"
              onClick={onClose}
              aria-label="Close guest search"
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                border: 'none',
                background: '#F1F5F9',
                color: '#64748B',
                fontSize: '22px',
                cursor: 'pointer',
                lineHeight: 1,
              }}
            >
              x
            </button>
          </div>

          <div className="guest-search-header-row" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '12px', alignItems: 'center' }}>
            <div style={{ position: 'relative' }}>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#94A3B8"
                strokeWidth="2"
                style={{ position: 'absolute', left: '18px', top: '50%', transform: 'translateY(-50%)' }}
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type guest name and press Enter"
                autoComplete="off"
                style={{
                  width: '100%',
                  height: '56px',
                  borderRadius: '16px',
                  border: '1px solid #D8E0EB',
                  padding: '0 18px 0 48px',
                  fontSize: '16px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <button
              onClick={() => doSearch(searchInput)}
              style={{
                height: '56px',
                minWidth: '120px',
                borderRadius: '16px',
                border: 'none',
                background: 'linear-gradient(135deg, #4F46E5 0%, #4338CA 100%)',
                color: '#FFFFFF',
                fontSize: '15px',
                fontWeight: 800,
                cursor: 'pointer',
                padding: '0 22px',
              }}
            >
              Search
            </button>
          </div>

          <div className="guest-search-result-label" style={{ marginTop: '12px', fontSize: '12px', color: '#64748B', fontWeight: 600 }}>{resultLabel}</div>
        </div>

        <div className="guest-search-modal-body" style={{ padding: '22px 28px 28px', overflow: 'auto', minHeight: 0 }}>
          {loading ? (
            <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: '#64748B' }}>
              <div style={{ textAlign: 'center' }}>
                <div
                  style={{
                    width: '40px',
                    height: '40px',
                    margin: '0 auto 14px',
                    borderRadius: '50%',
                    border: '3px solid #E2E8F0',
                    borderTopColor: '#4F46E5',
                    animation: 'guest-search-spin 0.8s linear infinite',
                  }}
                />
                <div style={{ fontSize: '14px', fontWeight: 700 }}>Searching guests...</div>
              </div>
            </div>
          ) : selectedCustomer ? (
            <div className="guest-search-selected-frame" style={{ minHeight: '100%', overflow: 'visible' }}>
              <GuestDetailFrame customer={selectedCustomer} onBack={() => setSelectedCustomer(null)} />
            </div>
          ) : searched && results.length === 0 ? (
            <div
              style={{
                height: '100%',
                border: CARD_BORDER,
                borderRadius: '24px',
                background: 'linear-gradient(180deg, #FFFFFF 0%, #F8FAFC 100%)',
                display: 'grid',
                placeItems: 'center',
                textAlign: 'center',
                color: '#64748B',
              }}
            >
              <div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: '#334155', marginBottom: '8px' }}>No guests found</div>
                <div style={{ fontSize: '13px' }}>No guests matched "{searchInput}". Try another name or contact keyword.</div>
              </div>
            </div>
          ) : !searched ? (
            <div
              style={{
                height: '100%',
                border: CARD_BORDER,
                borderRadius: '24px',
                background: 'linear-gradient(180deg, #FFFFFF 0%, #F8FAFC 100%)',
                display: 'grid',
                placeItems: 'center',
                textAlign: 'center',
                color: '#64748B',
              }}
            >
              <div>
                <div style={{ fontSize: '20px', fontWeight: 800, color: '#334155', marginBottom: '8px' }}>Search for a guest</div>
                <div style={{ fontSize: '13px' }}>Enter a guest name, email, phone, or property and open the profile in one view.</div>
              </div>
            </div>
          ) : (
            <div style={{ height: '100%', overflowY: 'auto', paddingRight: '6px' }}>
              {results.map((customer) => (
                <GuestResultItem
                  key={customer.customerKey}
                  customer={customer}
                  onClick={() => setSelectedCustomer(customer)}
                />
              ))}
            </div>
          )}
        </div>

        <style>{`
          @keyframes guest-search-spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          .guest-search-modal-shell,
          .guest-search-modal-body,
          .guest-search-selected-frame,
          .guest-search-frame,
          .guest-search-detail-column {
            min-width: 0;
          }
          .guest-search-selected-frame,
          .guest-search-frame {
            min-height: 0;
          }
          .guest-search-frame {
            min-height: 100%;
            grid-template-rows: auto auto auto auto;
          }
          .guest-search-detail {
            align-content: start;
          }
          @media (max-height: 820px) {
            .guest-search-modal-shell {
              height: calc(100dvh - 18px) !important;
              max-height: calc(100dvh - 18px) !important;
              border-radius: 22px !important;
            }
            .guest-search-modal-backdrop {
              padding: 9px !important;
            }
            .guest-search-modal-header {
              padding: 12px 20px 8px !important;
            }
            .guest-search-modal-header > div:first-child {
              margin-bottom: 10px !important;
            }
            .guest-search-modal-header input,
            .guest-search-modal-header button {
              height: 48px !important;
            }
            .guest-search-modal-header > div:last-child {
              margin-top: 7px !important;
            }
            .guest-search-modal-body {
              padding: 10px 20px 12px !important;
            }
            .guest-search-frame {
              gap: 8px !important;
            }
            .guest-search-back-button {
              font-size: 12px !important;
            }
            .guest-search-hero {
              border-radius: 18px !important;
              padding: 12px 16px !important;
            }
            .guest-search-hero-title {
              font-size: 23px !important;
            }
            .guest-search-hero-meta {
              margin-top: 6px !important;
              font-size: 12px !important;
              gap: 7px !important;
            }
            .guest-search-metrics {
              gap: 9px !important;
            }
            .guest-search-metric-card {
              min-height: 58px !important;
              border-radius: 14px !important;
              padding: 8px 12px !important;
            }
            .guest-search-metric-card > div:first-child {
              font-size: 10px !important;
            }
            .guest-search-metric-card > div:last-child {
              margin-top: 5px !important;
              font-size: 18px !important;
            }
            .guest-search-detail {
              gap: 10px !important;
            }
            .guest-search-detail-column {
              gap: 10px !important;
            }
            .guest-search-section-card {
              border-radius: 15px !important;
              padding: 9px 12px !important;
            }
            .guest-search-section-card > div:first-child {
              font-size: 10px !important;
              margin-bottom: 6px !important;
            }
            .guest-search-detail-row {
              grid-template-columns: 92px 1fr !important;
              gap: 8px !important;
              padding: 4px 0 !important;
            }
            .guest-search-detail-label,
            .guest-search-detail-value {
              font-size: 11px !important;
              line-height: 1.25 !important;
            }
            .guest-search-recent-list {
              gap: 6px !important;
            }
            .guest-search-recent-item {
              border-radius: 11px !important;
              padding: 7px 9px !important;
            }
            .guest-search-recent-item:nth-child(n+4) {
              display: none !important;
            }
          }
          @media (max-height: 700px) {
            .guest-search-modal-header {
              padding: 10px 18px 8px !important;
            }
            .guest-search-modal-header > div:first-child {
              margin-bottom: 10px !important;
            }
            .guest-search-modal-header input,
            .guest-search-modal-header button {
              height: 46px !important;
            }
            .guest-search-modal-header > div:first-child > div:first-child > div:first-child {
              font-size: 22px !important;
            }
            .guest-search-modal-header > div:last-child {
              margin-top: 7px !important;
            }
            .guest-search-modal-body {
              padding: 9px 18px 10px !important;
            }
            .guest-search-frame {
              gap: 7px !important;
            }
            .guest-search-hero {
              padding: 10px 14px !important;
            }
            .guest-search-hero-title {
              font-size: 21px !important;
              white-space: nowrap !important;
              overflow: visible !important;
              text-overflow: ellipsis !important;
              max-width: 760px !important;
            }
            .guest-search-hero-meta {
              margin-top: 4px !important;
            }
            .guest-search-metric-card {
              min-height: 54px !important;
              padding: 7px 10px !important;
            }
            .guest-search-metric-card > div:first-child {
              letter-spacing: 0.04em !important;
            }
            .guest-search-metric-card > div:last-child {
              margin-top: 3px !important;
              font-size: 16px !important;
            }
            .guest-search-section-card {
              padding: 8px 10px !important;
            }
            .guest-search-section-card > div:first-child {
              margin-bottom: 4px !important;
            }
            .guest-search-detail-row {
              grid-template-columns: 82px 1fr !important;
              padding: 3px 0 !important;
            }
            .guest-search-detail-label,
            .guest-search-detail-value {
              font-size: 10.5px !important;
            }
            .guest-search-recent-list {
              gap: 4px !important;
            }
            .guest-search-recent-item {
              padding: 5px 7px !important;
            }
            .guest-search-recent-item:nth-child(n+3) {
              display: none !important;
            }
          }
          @media (min-width: 769px) and (max-height: 760px) {
            .guest-search-modal-shell {
              width: calc(100vw - 8px) !important;
              height: calc(100dvh - 8px) !important;
              max-height: calc(100dvh - 8px) !important;
              border-radius: 16px !important;
            }
            .guest-search-modal-backdrop {
              padding: 4px !important;
            }
            .guest-search-modal-header {
              display: grid !important;
              grid-template-columns: 180px minmax(0, 1fr) 38px !important;
              align-items: center !important;
              column-gap: 10px !important;
              padding: 8px 14px !important;
            }
            .guest-search-title-row {
              display: contents !important;
              margin-bottom: 0 !important;
            }
            .guest-search-title-copy {
              grid-column: 1 !important;
              grid-row: 1 !important;
              min-width: 0 !important;
            }
            .guest-search-title {
              font-size: 20px !important;
              line-height: 1.05 !important;
              white-space: nowrap !important;
            }
            .guest-search-subtitle,
            .guest-search-result-label {
              display: none !important;
            }
            .guest-search-close-button {
              grid-column: 3 !important;
              grid-row: 1 !important;
              width: 34px !important;
              height: 34px !important;
              font-size: 18px !important;
            }
            .guest-search-header-row {
              grid-column: 2 !important;
              grid-row: 1 !important;
              grid-template-columns: minmax(0, 1fr) 96px !important;
              gap: 8px !important;
            }
            .guest-search-header-row input,
            .guest-search-header-row button {
              height: 40px !important;
              border-radius: 12px !important;
              font-size: 13px !important;
            }
            .guest-search-header-row input {
              padding-left: 42px !important;
            }
            .guest-search-header-row button {
              min-width: 96px !important;
              padding: 0 14px !important;
            }
            .guest-search-modal-body {
              padding: 7px 14px 8px !important;
              overflow: auto !important;
            }
            .guest-search-frame {
              gap: 6px !important;
            }
            .guest-search-back-button {
              font-size: 11px !important;
              line-height: 1 !important;
            }
            .guest-search-back-button svg {
              width: 12px !important;
              height: 12px !important;
            }
            .guest-search-hero {
              padding: 9px 14px !important;
              border-radius: 15px !important;
            }
            .guest-search-hero-title {
              font-size: 20px !important;
            }
            .guest-search-hero-meta {
              margin-top: 3px !important;
              font-size: 11px !important;
            }
            .guest-search-metrics {
              gap: 7px !important;
            }
            .guest-search-metric-card {
              min-height: 50px !important;
              padding: 6px 10px !important;
            }
            .guest-search-metric-card > div:first-child {
              font-size: 9px !important;
            }
            .guest-search-metric-card > div:last-child {
              margin-top: 2px !important;
              font-size: 15px !important;
            }
            .guest-search-detail {
              gap: 8px !important;
            }
            .guest-search-detail-row {
              grid-template-columns: 82px 1fr !important;
              padding: 2px 0 !important;
            }
            .guest-search-section-card {
              padding-top: 7px !important;
              padding-bottom: 7px !important;
              border-radius: 13px !important;
            }
            .guest-search-section-card > div:first-child {
              font-size: 9px !important;
              margin-bottom: 3px !important;
            }
            .guest-search-detail-label,
            .guest-search-detail-value {
              font-size: 10px !important;
              line-height: 1.18 !important;
            }
            .guest-search-recent-item {
              padding: 5px 8px !important;
            }
          }
          @media (max-width: 1024px) {
            .guest-search-modal-shell {
              width: calc(100vw - 24px) !important;
              height: calc(100dvh - 24px) !important;
              min-height: auto !important;
              max-height: calc(100dvh - 24px) !important;
            }
            .guest-search-metrics {
              grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
            }
          }
          @media (max-width: 768px) {
            .guest-search-modal-backdrop {
              padding: 8px !important;
            }
            .guest-search-modal-shell {
              width: calc(100vw - 16px) !important;
              height: calc(100dvh - 16px) !important;
              min-height: auto !important;
              max-height: calc(100dvh - 16px) !important;
              border-radius: 20px !important;
            }
            .guest-search-modal-header {
              padding: 16px 18px 12px !important;
            }
            .guest-search-modal-body {
              padding: 14px 18px 18px !important;
            }
            .guest-search-header-row {
              grid-template-columns: 1fr !important;
            }
            .guest-search-metrics {
              grid-template-columns: 1fr 1fr !important;
            }
            .guest-search-detail {
              grid-template-columns: 1fr !important;
              overflow-y: auto !important;
              padding-right: 4px !important;
            }
          }
          @media (min-width: 769px) and (max-width: 1100px) and (max-height: 820px) {
            .guest-search-modal-shell {
              width: calc(100vw - 8px) !important;
              height: calc(100dvh - 8px) !important;
              max-height: calc(100dvh - 8px) !important;
              border-radius: 16px !important;
            }
            .guest-search-modal-backdrop {
              padding: 4px !important;
            }
            .guest-search-modal-header {
              display: grid !important;
              grid-template-columns: 168px minmax(0, 1fr) 34px !important;
              align-items: center !important;
              column-gap: 8px !important;
              padding: 7px 12px !important;
            }
            .guest-search-title-row {
              display: contents !important;
              margin-bottom: 0 !important;
            }
            .guest-search-title-copy {
              grid-column: 1 !important;
              grid-row: 1 !important;
              min-width: 0 !important;
            }
            .guest-search-title {
              font-size: 19px !important;
              line-height: 1 !important;
              white-space: nowrap !important;
            }
            .guest-search-subtitle,
            .guest-search-result-label {
              display: none !important;
            }
            .guest-search-close-button {
              grid-column: 3 !important;
              grid-row: 1 !important;
              width: 32px !important;
              height: 32px !important;
              font-size: 17px !important;
            }
            .guest-search-header-row {
              grid-column: 2 !important;
              grid-row: 1 !important;
              grid-template-columns: minmax(0, 1fr) 88px !important;
              gap: 7px !important;
            }
            .guest-search-header-row input,
            .guest-search-header-row button {
              height: 38px !important;
              border-radius: 11px !important;
              font-size: 12px !important;
            }
            .guest-search-header-row input {
              padding-left: 38px !important;
            }
            .guest-search-header-row button {
              min-width: 88px !important;
              padding: 0 10px !important;
            }
            .guest-search-modal-body {
              padding: 6px 12px 7px !important;
            }
            .guest-search-frame {
              gap: 5px !important;
            }
            .guest-search-back-button {
              font-size: 10.5px !important;
              line-height: 1 !important;
            }
            .guest-search-back-button svg {
              width: 11px !important;
              height: 11px !important;
            }
            .guest-search-hero {
              padding: 8px 13px !important;
              border-radius: 14px !important;
            }
            .guest-search-hero-title {
              font-size: 19px !important;
              line-height: 1.05 !important;
            }
            .guest-search-hero-meta {
              margin-top: 2px !important;
              font-size: 10.5px !important;
            }
            .guest-search-metrics {
              gap: 6px !important;
              grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
            }
            .guest-search-metric-card {
              min-height: 46px !important;
              padding: 5px 9px !important;
              border-radius: 12px !important;
            }
            .guest-search-metric-card > div:first-child {
              font-size: 8.5px !important;
              letter-spacing: 0.03em !important;
            }
            .guest-search-metric-card > div:last-child {
              margin-top: 2px !important;
              font-size: 14px !important;
            }
            .guest-search-detail {
              gap: 6px !important;
              grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
            }
            .guest-search-section-card {
              display: grid !important;
              grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
              column-gap: 10px !important;
              row-gap: 0 !important;
              padding: 7px 10px !important;
              border-radius: 12px !important;
              align-content: start !important;
              overflow: visible !important;
            }
            .guest-search-section-card > div:first-child {
              grid-column: 1 / -1 !important;
              font-size: 8.5px !important;
              margin-bottom: 3px !important;
            }
            .guest-search-detail-row {
              grid-template-columns: 62px minmax(0, 1fr) !important;
              gap: 5px !important;
              padding: 2px 0 !important;
              min-width: 0 !important;
            }
            .guest-search-detail-label,
            .guest-search-detail-value {
              font-size: 9.2px !important;
              line-height: 1.15 !important;
            }
            .guest-search-recent-list {
              grid-column: 1 / -1 !important;
              gap: 4px !important;
            }
            .guest-search-recent-item {
              padding: 5px 8px !important;
              border-radius: 10px !important;
            }
          }
          @media (min-width: 769px) and (max-width: 1100px) and (max-height: 680px) {
            .guest-search-modal-header {
              grid-template-columns: 150px minmax(0, 1fr) 32px !important;
              padding: 5px 10px !important;
            }
            .guest-search-title {
              font-size: 17px !important;
            }
            .guest-search-header-row input,
            .guest-search-header-row button {
              height: 34px !important;
            }
            .guest-search-modal-body {
              padding: 5px 10px 6px !important;
            }
            .guest-search-frame {
              gap: 4px !important;
            }
            .guest-search-hero {
              padding: 7px 11px !important;
            }
            .guest-search-metric-card {
              min-height: 42px !important;
              padding: 4px 8px !important;
            }
            .guest-search-section-card {
              padding: 5px 8px !important;
            }
            .guest-search-detail-row {
              padding: 1px 0 !important;
            }
          }
        `}</style>
      </div>
    </div>
  );
};

export default GuestSearchModal;
