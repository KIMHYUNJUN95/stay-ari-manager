export const PRICE_ATTRIBUTION_DEFAULT_WINDOW_HOURS = 48;

function toMillis(value) {
  if (value == null) return null;
  if (typeof value?.toMillis === "function") {
    const ms = value.toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value?.toDate === "function") {
    const ms = value.toDate().getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const str = String(value || "").trim();
  if (!str) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const ms = new Date(`${str}T00:00:00+09:00`).getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  const parsed = new Date(str).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function toDateKey(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function getDateRangeOverlap(arrival, departure, fromDate, toDate) {
  const a = toDateKey(arrival);
  const d = toDateKey(departure);
  const f = toDateKey(fromDate);
  const t = toDateKey(toDate || fromDate);

  if (!a || !d || !f || !t) return false;
  return a <= t && d > f;
}

function dateRangeToDateSet(fromDate, toDate) {
  const set = new Set();
  const start = toDateKey(fromDate);
  const end = toDateKey(toDate);
  if (!start || !end) return set;

  let cursor = new Date(`${start}T00:00:00+09:00`);
  const endDate = new Date(`${end}T00:00:00+09:00`);
  while (cursor.getTime() <= endDate.getTime()) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, "0");
    const d = String(cursor.getDate()).padStart(2, "0");
    set.add(`${y}-${m}-${d}`);
    cursor = new Date(cursor.getTime() + (24 * 60 * 60 * 1000));
  }
  return set;
}

function iterateStayDateKeys(arrival, departure, callback) {
  const start = toDateKey(arrival);
  const end = toDateKey(departure);
  if (!start || !end) return;

  let cursor = new Date(`${start}T00:00:00+09:00`);
  const endDate = new Date(`${end}T00:00:00+09:00`);
  while (cursor.getTime() < endDate.getTime()) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, "0");
    const d = String(cursor.getDate()).padStart(2, "0");
    callback(`${y}-${m}-${d}`);
    cursor = new Date(cursor.getTime() + (24 * 60 * 60 * 1000));
  }
}

function buildBuildingRoomKey(building, room) {
  return `${String(building || "").trim()}__${String(room || "").trim()}`;
}

function buildBuildingRoomDateKey(building, room, dateKey) {
  return `${buildBuildingRoomKey(building, room)}__${String(dateKey || "").trim()}`;
}

function buildTargetDatesByRoom(log) {
  const map = {};
  const addDate = (room, dateStr) => {
    const roomKey = String(room || "").trim();
    const dayKey = toDateKey(dateStr);
    if (!roomKey || !dayKey) return;
    if (!map[roomKey]) map[roomKey] = new Set();
    map[roomKey].add(dayKey);
  };

  if (Array.isArray(log?.priceSnapshot) && log.priceSnapshot.length > 0) {
    log.priceSnapshot.forEach((row) => addDate(row?.room, row?.date));
    return map;
  }

  if (log?.dates && typeof log.dates === "object") {
    const roomList = Array.isArray(log?.rooms) && log.rooms.length > 0
      ? log.rooms
      : (log?.room ? [log.room] : []);
    Object.keys(log.dates).forEach((dateKey) => {
      const normalizedDate = `${String(dateKey).slice(0, 4)}-${String(dateKey).slice(4, 6)}-${String(dateKey).slice(6, 8)}`;
      roomList.forEach((room) => addDate(room, normalizedDate));
    });
    return map;
  }

  const fallbackSet = dateRangeToDateSet(log?.dateFrom, log?.dateTo || log?.dateFrom);
  if (fallbackSet.size > 0) {
    const roomList = Array.isArray(log?.rooms) && log.rooms.length > 0
      ? log.rooms
      : (log?.room ? [log.room] : []);
    roomList.forEach((room) => {
      const roomKey = String(room || "").trim();
      if (!roomKey) return;
      map[roomKey] = new Set(fallbackSet);
    });
  }

  return map;
}

function getInterventionRoomSet(log) {
  const roomNames = [];
  if (Array.isArray(log?.rooms)) {
    log.rooms.forEach((room) => {
      if (room != null && String(room).trim()) roomNames.push(String(room).trim());
    });
  }
  if (log?.room != null && String(log.room).trim()) {
    roomNames.push(String(log.room).trim());
  }
  return new Set(roomNames);
}

function resolveWindowHours(log, defaultHours) {
  const custom = Number(log?.attributionWindowHours);
  if (Number.isFinite(custom) && custom > 0) return custom;
  return defaultHours;
}

export function parseReservationCreatedAtMs(reservation) {
  // 1) Prefer exact datetime fields from booking payloads.
  const datetimeCandidates = [
    reservation?.bookingTime,
    reservation?.bookTime,
    reservation?.entryTime
  ];

  for (const candidate of datetimeCandidates) {
    const ms = toMillis(candidate);
    if (Number.isFinite(ms)) return ms;
  }

  // 2) Fallback for date-only fields:
  // treat as end-of-day (Tokyo) so same-day bookings after price change
  // are not dropped due to missing time precision.
  const dateOnlyCandidates = [
    reservation?.bookDate,
    reservation?.date
  ];
  for (const candidate of dateOnlyCandidates) {
    const dayKey = toDateKey(candidate);
    if (!dayKey) continue;
    const ms = new Date(`${dayKey}T23:59:59+09:00`).getTime();
    if (Number.isFinite(ms)) return ms;
  }

  return null;
}

export function getReservationIdentityKey(reservation) {
  const id = String(reservation?.bookId || reservation?.id || "").trim();
  if (id) return `id:${id}`;

  const building = String(reservation?.building || "").trim();
  const room = String(reservation?.room || "").trim();
  const arrival = String(reservation?.arrival || "").slice(0, 10);
  const departure = String(reservation?.departure || "").slice(0, 10);
  const guest = String(reservation?.guestName || "").trim();
  return `fallback:${building}|${room}|${arrival}|${departure}|${guest}`;
}

export function buildPriceAttributionResult({
  interventions = [],
  reservations = [],
  defaultWindowHours = PRICE_ATTRIBUTION_DEFAULT_WINDOW_HOURS,
  minInterventionDate = null,
  minBookingDate = null
} = {}) {
  const byReservationKey = {};
  const conversionList = [];
  const minInterventionMs = minInterventionDate ? toMillis(minInterventionDate) : null;
  const minBookingMs = minBookingDate ? toMillis(minBookingDate) : null;
  const occupancyEarliestCreatedAtByDate = {};

  // --- DEBUG: �??�계�??�롭 ?�인 추적 ---
  const _dbgTotal = (interventions || []).length;
  const _dbgAfterSuccess = (interventions || []).filter((log) => log?.success !== false);
  const _dbgBeds24Count = _dbgAfterSuccess.filter((log) => String(log?.origin || "").toLowerCase().includes("beds24")).length;
  console.debug(`[Attribution] input=${_dbgTotal} | success_pass=${_dbgAfterSuccess.length} | beds24=${_dbgBeds24Count}`);

  const normalizedInterventions = _dbgAfterSuccess
    // Beds24 직접 ?�정분도 ?�일 attribution 규칙 ?�용 (origin ?�한 ?�음)
    .map((log) => {
      const appliedAtMs = toMillis(log?.timestamp);
      const dateFrom = toDateKey(log?.dateFrom);
      const dateTo = toDateKey(log?.dateTo || log?.dateFrom);
      const roomSet = getInterventionRoomSet(log);
      const targetDatesByRoom = buildTargetDatesByRoom(log);
      const windowHours = resolveWindowHours(log, defaultWindowHours);
      const item = {
        log,
        building: String(log?.building || "").trim(),
        appliedAtMs,
        dateFrom,
        dateTo,
        roomSet,
        targetDatesByRoom,
        fallbackTargetDates: dateRangeToDateSet(dateFrom, dateTo),
        windowHours,
        windowMs: windowHours * 60 * 60 * 1000
      };
      // Beds24 로그가 ?�드 부족으�??�롭?�는 경우 경고
      const isBeds24 = String(log?.origin || "").toLowerCase().includes("beds24");
      if (isBeds24) {
        const dropReason = !Number.isFinite(appliedAtMs) ? "no_timestamp"
          : !item.building ? "no_building"
          : !dateFrom ? "no_dateFrom"
          : !dateTo ? "no_dateTo"
          : roomSet.size === 0 ? "no_rooms"
          : null;
        if (dropReason) {
          console.warn(`[Attribution] Beds24 log DROPPED (${dropReason}):`, { id: log.id, building: log.building, origin: log.origin, dateFrom: log.dateFrom, dateTo: log.dateTo, rooms: log.rooms });
        } else {
          console.debug(`[Attribution] Beds24 log OK ??building=${item.building} dateFrom=${dateFrom} dateTo=${dateTo} rooms=${[...roomSet]} fallbackDates=${[...item.fallbackTargetDates].length}`);
        }
      }
      return item;
    })
    .filter((item) => Number.isFinite(item.appliedAtMs) && item.building && item.dateFrom && item.dateTo && item.roomSet.size > 0)
    .filter((item) => !Number.isFinite(minInterventionMs) || item.appliedAtMs >= minInterventionMs)
    .sort((a, b) => a.appliedAtMs - b.appliedAtMs);

  const _dbgNormBeds24 = normalizedInterventions.filter((i) => String(i.log?.origin || "").toLowerCase().includes("beds24")).length;
  console.debug(`[Attribution] normalizedInterventions=${normalizedInterventions.length} | beds24_passed=${_dbgNormBeds24} | minInterventionDate=${minInterventionDate}`);

  const normalizedReservations = (reservations || []).map((reservation) => {
    if (!reservation) return null;
    if (String(reservation.status || "").toLowerCase() !== "confirmed") return null;

    const reservationKey = getReservationIdentityKey(reservation);
    const building = String(reservation.building || "").trim();
    const room = String(reservation.room || "").trim();
    const bookingCreatedAtMs = parseReservationCreatedAtMs(reservation);
    const arrival = toDateKey(reservation.arrival);
    const departure = toDateKey(reservation.departure);

    if (!building || !room || !arrival || !departure) return null;

    const occupancyCreatedAtMs = Number.isFinite(bookingCreatedAtMs)
      ? bookingCreatedAtMs
      : Number.NEGATIVE_INFINITY;

    iterateStayDateKeys(arrival, departure, (dateKey) => {
      const roomDateKey = buildBuildingRoomDateKey(building, room, dateKey);
      const existingValue = occupancyEarliestCreatedAtByDate[roomDateKey];
      if (existingValue == null || occupancyCreatedAtMs < existingValue) {
        occupancyEarliestCreatedAtByDate[roomDateKey] = occupancyCreatedAtMs;
      }
    });

    return {
      reservation,
      reservationKey,
      building,
      room,
      bookingCreatedAtMs,
      arrival,
      departure
    };
  }).filter(Boolean);

  const interventionsByBuildingRoom = {};
  normalizedInterventions.forEach((item) => {
    item.roomSet.forEach((room) => {
      const key = buildBuildingRoomKey(item.building, room);
      if (!interventionsByBuildingRoom[key]) {
        interventionsByBuildingRoom[key] = [];
      }
      interventionsByBuildingRoom[key].push(item);
    });
  });

  normalizedReservations.forEach(({ reservation, reservationKey, building, room, bookingCreatedAtMs, arrival, departure }) => {
    if (!Number.isFinite(bookingCreatedAtMs)) return;
    if (Number.isFinite(minBookingMs) && bookingCreatedAtMs < minBookingMs) return;

    const candidateInterventions = interventionsByBuildingRoom[buildBuildingRoomKey(building, room)] || [];
    if (candidateInterventions.length === 0) return;

    let best = null;

    candidateInterventions.forEach((item) => {
      if (!getDateRangeOverlap(arrival, departure, item.dateFrom, item.dateTo)) return;
      if (bookingCreatedAtMs <= item.appliedAtMs) return;
      if (bookingCreatedAtMs > item.appliedAtMs + item.windowMs) return;

      const targetDates = item.targetDatesByRoom?.[room] || item.fallbackTargetDates;
      let hasVacantOverlapDate = false;

      for (const targetDate of targetDates) {
        if (targetDate < arrival || targetDate >= departure) continue;

        const occupiedAtMs = occupancyEarliestCreatedAtByDate[buildBuildingRoomDateKey(building, room, targetDate)];
        if (occupiedAtMs == null || occupiedAtMs > item.appliedAtMs) {
          hasVacantOverlapDate = true;
          break;
        }
      }

      if (!hasVacantOverlapDate) return;

      if (!best || item.appliedAtMs > best.appliedAtMs) {
        best = item;
      }
    });

    if (!best) return;

    const hoursToBooking = Number(((bookingCreatedAtMs - best.appliedAtMs) / (1000 * 60 * 60)).toFixed(2));

    const conversion = {
      reservationKey,
      reservation,
      intervention: best.log,
      bookingCreatedAtMs,
      appliedAtMs: best.appliedAtMs,
      windowHours: best.windowHours,
      hoursToBooking
    };

    byReservationKey[reservationKey] = conversion;
    conversionList.push(conversion);
  });

  conversionList.sort((a, b) => b.bookingCreatedAtMs - a.bookingCreatedAtMs);

  // --- DEBUG: 최종 conversion 결과 ?�약 ---
  const _dbgConvBeds24 = conversionList.filter((c) => String(c.intervention?.origin || "").toLowerCase().includes("beds24"));
  console.debug(`[Attribution] RESULT total_conversions=${conversionList.length} | beds24_conversions=${_dbgConvBeds24.length}`);
  if (_dbgConvBeds24.length > 0) {
    _dbgConvBeds24.forEach((c) => {
      console.debug(`[Attribution] ??Beds24 conversion: building=${c.reservation?.building} room=${c.reservation?.room} arrival=${c.reservation?.arrival} hoursToBooking=${c.hoursToBooking}h`);
    });
  }

  return {
    byReservationKey,
    conversionList
  };
}
