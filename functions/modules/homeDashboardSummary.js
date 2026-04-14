const admin = require("firebase-admin");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

dayjs.extend(utc);
dayjs.extend(timezone);

const HOME_DASHBOARD_SUMMARY_COLLECTION = "dashboard_home_summaries";
const HOME_DASHBOARD_META_COLLECTION = "dashboard_home_summary_meta";

function parseLocalDate(dateStr) {
    if (!dateStr) return null;
    const parsed = dayjs(dateStr).tz("Asia/Tokyo");
    if (!parsed.isValid()) return null;
    return new Date(parsed.year(), parsed.month(), parsed.date());
}

function formatDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getUniqueRoomNamesByBuilding(buildingRooms = {}) {
    return Object.entries(buildingRooms).reduce((acc, [buildingName, rooms]) => {
        acc[buildingName] = [...new Set((rooms || []).map((room) => String(room?.name || "").trim()).filter(Boolean))];
        return acc;
    }, {});
}

function getOccupiedDaysSet(reservations, monthStart, monthEnd) {
    const occupiedDates = new Set();

    (reservations || []).forEach((reservation) => {
        const arrivalDate = parseLocalDate(reservation?.arrival);
        const departureDate = parseLocalDate(reservation?.departure);
        if (!arrivalDate || !departureDate) return;

        const reservationEnd = new Date(departureDate);
        reservationEnd.setDate(reservationEnd.getDate() - 1);
        if (arrivalDate > monthEnd || reservationEnd < monthStart) return;

        const actualStart = new Date(Math.max(arrivalDate.getTime(), monthStart.getTime()));
        const actualEnd = new Date(Math.min(reservationEnd.getTime(), monthEnd.getTime()));
        const cursor = new Date(actualStart);

        while (cursor <= actualEnd) {
            occupiedDates.add(formatDateKey(cursor));
            cursor.setDate(cursor.getDate() + 1);
        }
    });

    return occupiedDates.size;
}

function getPlatformRevenueKey(reservation) {
    const sourceText = [
        reservation?.platform,
        reservation?.referer,
        reservation?.referrer,
        reservation?.apiSource,
        reservation?.subSource,
        reservation?.source,
        reservation?.channel
    ]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase())
        .join(" ");

    if (!sourceText) return "other";
    if (sourceText.includes("direct") || sourceText.includes("manual") || sourceText.includes("phone") || sourceText.includes("walk")) return "direct";
    if (sourceText.includes("booking")) return "booking";
    if (sourceText.includes("airbnb")) return "airbnb";
    return "other";
}

function deduplicateBookings(bookings = []) {
    const uniqueMap = new Map();
    bookings.forEach((reservation) => {
        const dedupeKey = reservation?.bookId || reservation?.refNum || `${reservation?.guestName || ""}_${reservation?.firstNight || reservation?.arrival || ""}`;
        if (!uniqueMap.has(dedupeKey)) {
            uniqueMap.set(dedupeKey, reservation);
        }
    });
    return Array.from(uniqueMap.values());
}

function createEmptySummary({
    companyId = "",
    currentMonthKey = "",
    lastMonthKey = "",
    todayKey = "",
    buildingNames = []
} = {}) {
    return {
        companyId,
        summaryType: "home_dashboard",
        summaryVersion: 1,
        currentMonthKey,
        lastMonthKey,
        todayKey,
        sourceReservationCount: 0,
        revenueData: {
            currentMonth: 0,
            lastMonth: 0
        },
        performanceData: {
            total: 0,
            lastMonthTotal: 0,
            buildings: buildingNames.map((name) => ({ name, count: 0 })),
            platforms: { airbnb: 0, booking: 0 },
            platformRevenue: { airbnb: 0, booking: 0, direct: 0 }
        },
        occupancyData: {
            currentRate: 0,
            lastMonthRate: 0,
            totalNights: 0,
            totalSlots: 0
        },
        todayActivity: {
            checkins: 0,
            checkouts: 0,
            newBookings: 0
        },
        avgStayData: {
            avgNights: 0,
            totalBookings: 0,
            lastMonthAvg: 0
        }
    };
}

function buildHomeDashboardSummaryFromReservations({
    reservations = [],
    buildingRooms = {},
    excludedBuildingName = "",
    referenceOnlyBuildingName = "",
    companyId = "",
    now = dayjs().tz("Asia/Tokyo")
} = {}) {
    const roomNamesByBuilding = getUniqueRoomNamesByBuilding(buildingRooms);
    const displayBuildingNames = Object.keys(roomNamesByBuilding).filter(
        (buildingName) => buildingName !== excludedBuildingName && buildingName !== referenceOnlyBuildingName
    );

    const currentMonthKey = now.format("YYYY-MM");
    const lastMonthKey = now.subtract(1, "month").format("YYYY-MM");
    const todayKey = now.format("YYYY-MM-DD");
    const currentMonthStartKey = now.startOf("month").format("YYYY-MM-DD");
    const currentMonthEndKey = now.endOf("month").format("YYYY-MM-DD");
    const lastMonthStartKey = now.subtract(1, "month").startOf("month").format("YYYY-MM-DD");
    const lastMonthEndKey = now.subtract(1, "month").endOf("month").format("YYYY-MM-DD");

    const currentMonthStart = parseLocalDate(currentMonthStartKey);
    const currentMonthEnd = parseLocalDate(currentMonthEndKey);
    const lastMonthStart = parseLocalDate(lastMonthStartKey);
    const lastMonthEnd = parseLocalDate(lastMonthEndKey);
    const daysInCurrentMonth = now.daysInMonth();
    const daysInLastMonth = now.subtract(1, "month").daysInMonth();

    const summary = createEmptySummary({
        companyId,
        currentMonthKey,
        lastMonthKey,
        todayKey,
        buildingNames: displayBuildingNames
    });

    summary.sourceReservationCount = reservations.length;

    const currentMonthBookings = [];
    const lastMonthBookings = [];
    const thisMonthCheckins = [];
    const lastMonthCheckins = [];
    const reservationsByRoom = new Map();
    let currentMonthRevenue = 0;
    let lastMonthRevenue = 0;
    let todayCheckins = 0;
    let todayCheckouts = 0;
    let todayNewBookings = 0;
    const platformRevenue = {
        airbnb: 0,
        booking: 0,
        direct: 0
    };

    reservations.forEach((reservation) => {
        const building = reservation?.building || "";
        const room = reservation?.room || "";
        const bookDate = reservation?.bookDate || reservation?.firstNight || "";
        const totalPrice = Number(reservation?.totalPrice ?? reservation?.price) || 0;
        const arrivalDate = parseLocalDate(reservation?.arrival);
        const departureDate = parseLocalDate(reservation?.departure);

        if (arrivalDate && departureDate && room && building) {
            const roomKey = `${building}__${room}`;
            const roomReservations = reservationsByRoom.get(roomKey) || [];
            roomReservations.push(reservation);
            reservationsByRoom.set(roomKey, roomReservations);

            if (building !== excludedBuildingName) {
                const totalNights = Math.floor((departureDate - arrivalDate) / (1000 * 60 * 60 * 24));
                if (totalNights > 0) {
                    const pricePerNight = totalPrice / totalNights;
                    const platformRevenueKey = getPlatformRevenueKey(reservation);

                    if (departureDate > currentMonthStart && arrivalDate <= currentMonthEnd) {
                        const overlapStart = new Date(Math.max(arrivalDate.getTime(), currentMonthStart.getTime()));
                        const overlapEndDate = new Date(departureDate);
                        overlapEndDate.setDate(overlapEndDate.getDate() - 1);
                        const overlapEnd = new Date(Math.min(overlapEndDate.getTime(), currentMonthEnd.getTime()));

                        if (overlapStart <= overlapEnd) {
                            const overlapNights = Math.floor((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24)) + 1;
                            const monthlyRevenue = pricePerNight * overlapNights;
                            currentMonthRevenue += monthlyRevenue;

                            if (platformRevenueKey === "airbnb") platformRevenue.airbnb += monthlyRevenue;
                            if (platformRevenueKey === "booking") platformRevenue.booking += monthlyRevenue;
                            if (platformRevenueKey === "direct") platformRevenue.direct += monthlyRevenue;
                        }
                    }

                    if (departureDate > lastMonthStart && arrivalDate <= lastMonthEnd) {
                        const overlapStart = new Date(Math.max(arrivalDate.getTime(), lastMonthStart.getTime()));
                        const overlapEndDate = new Date(departureDate);
                        overlapEndDate.setDate(overlapEndDate.getDate() - 1);
                        const overlapEnd = new Date(Math.min(overlapEndDate.getTime(), lastMonthEnd.getTime()));

                        if (overlapStart <= overlapEnd) {
                            const overlapNights = Math.floor((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24)) + 1;
                            lastMonthRevenue += pricePerNight * overlapNights;
                        }
                    }
                }
            }
        }

        if (building !== excludedBuildingName && bookDate.startsWith(currentMonthKey)) {
            currentMonthBookings.push(reservation);
        }
        if (building !== excludedBuildingName && bookDate.startsWith(lastMonthKey)) {
            lastMonthBookings.push(reservation);
        }

        if (reservation?.arrival === todayKey) todayCheckins += 1;
        if (reservation?.departure === todayKey) todayCheckouts += 1;
        if (reservation?.bookDate === todayKey) todayNewBookings += 1;

        if (
            reservation?.arrival &&
            reservation.arrival.startsWith(currentMonthKey) &&
            building !== referenceOnlyBuildingName &&
            building !== excludedBuildingName &&
            totalPrice > 0
        ) {
            thisMonthCheckins.push(reservation);
        }

        if (
            reservation?.arrival &&
            reservation.arrival.startsWith(lastMonthKey) &&
            building !== referenceOnlyBuildingName &&
            building !== excludedBuildingName &&
            totalPrice > 0
        ) {
            lastMonthCheckins.push(reservation);
        }
    });

    summary.revenueData = {
        currentMonth: Math.round(currentMonthRevenue),
        lastMonth: Math.round(lastMonthRevenue)
    };

    const uniqueCurrentBookings = deduplicateBookings(currentMonthBookings);
    const uniqueLastBookings = deduplicateBookings(lastMonthBookings);
    const buildingCount = {};
    const platformCount = { airbnb: 0, booking: 0 };

    uniqueCurrentBookings.forEach((reservation) => {
        const building = reservation?.building || "Unknown";
        buildingCount[building] = (buildingCount[building] || 0) + 1;

        const platformName = String(reservation?.platform || "").toLowerCase();
        if (platformName.includes("booking")) {
            platformCount.booking += 1;
        } else {
            platformCount.airbnb += 1;
        }
    });

    summary.performanceData = {
        total: uniqueCurrentBookings.length,
        lastMonthTotal: uniqueLastBookings.length,
        buildings: displayBuildingNames
            .map((buildingName) => ({ name: buildingName, count: buildingCount[buildingName] || 0 }))
            .sort((a, b) => b.count - a.count),
        platforms: platformCount,
        platformRevenue: {
            airbnb: Math.round(platformRevenue.airbnb),
            booking: Math.round(platformRevenue.booking),
            direct: Math.round(platformRevenue.direct)
        }
    };

    let currentOccupiedDays = 0;
    let currentAvailableDays = 0;
    let lastOccupiedDays = 0;
    let lastAvailableDays = 0;

    Object.entries(roomNamesByBuilding).forEach(([buildingName, roomNames]) => {
        if (buildingName === referenceOnlyBuildingName || buildingName === excludedBuildingName) return;

        roomNames.forEach((roomName) => {
            const roomReservations = reservationsByRoom.get(`${buildingName}__${roomName}`) || [];
            currentOccupiedDays += getOccupiedDaysSet(roomReservations, currentMonthStart, currentMonthEnd);
            currentAvailableDays += daysInCurrentMonth;
            lastOccupiedDays += getOccupiedDaysSet(roomReservations, lastMonthStart, lastMonthEnd);
            lastAvailableDays += daysInLastMonth;
        });
    });

    summary.occupancyData = {
        currentRate: currentAvailableDays > 0 ? Number(((currentOccupiedDays / currentAvailableDays) * 100).toFixed(1)) : 0,
        lastMonthRate: lastAvailableDays > 0 ? Number(((lastOccupiedDays / lastAvailableDays) * 100).toFixed(1)) : 0,
        totalNights: currentOccupiedDays,
        totalSlots: currentAvailableDays
    };

    summary.todayActivity = {
        checkins: todayCheckins,
        checkouts: todayCheckouts,
        newBookings: todayNewBookings
    };

    const currentMonthStayNights = thisMonthCheckins.reduce((sum, reservation) => sum + (Number(reservation?.nights) || 0), 0);
    const lastMonthStayNights = lastMonthCheckins.reduce((sum, reservation) => sum + (Number(reservation?.nights) || 0), 0);

    summary.avgStayData = {
        avgNights: thisMonthCheckins.length > 0 ? Number((currentMonthStayNights / thisMonthCheckins.length).toFixed(1)) : 0,
        totalBookings: thisMonthCheckins.length,
        lastMonthAvg: lastMonthCheckins.length > 0 ? Number((lastMonthStayNights / lastMonthCheckins.length).toFixed(1)) : 0
    };

    return summary;
}

async function fetchConfirmedReservations(db, companyId) {
    const snapshot = await db.collection("reservations")
        .where("companyId", "==", companyId)
        .where("status", "==", "confirmed")
        .get();

    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function markHomeDashboardSummaryDirty(db, {
    companyId,
    reason = "",
    source = ""
} = {}) {
    if (!companyId) return;

    await db.collection(HOME_DASHBOARD_META_COLLECTION).doc(String(companyId)).set({
        companyId: String(companyId),
        dirty: true,
        lastRequestedReason: reason || "",
        lastRequestedSource: source || "",
        lastRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastRequestedAtMs: Date.now(),
        requestCount: admin.firestore.FieldValue.increment(1)
    }, { merge: true });
}

async function refreshHomeDashboardSummary(db, {
    companyId,
    buildingRooms,
    excludedBuildingName = "",
    referenceOnlyBuildingName = "",
    reason = "",
    source = "",
    now = dayjs().tz("Asia/Tokyo")
} = {}) {
    if (!companyId) {
        throw new Error("Missing companyId");
    }

    const reservations = await fetchConfirmedReservations(db, String(companyId));
    const summary = buildHomeDashboardSummaryFromReservations({
        reservations,
        buildingRooms,
        excludedBuildingName,
        referenceOnlyBuildingName,
        companyId: String(companyId),
        now
    });
    const computedAtMs = Date.now();

    await db.collection(HOME_DASHBOARD_SUMMARY_COLLECTION).doc(String(companyId)).set({
        ...summary,
        computedAtMs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedReason: reason || "",
        updatedSource: source || ""
    }, { merge: true });

    await db.collection(HOME_DASHBOARD_META_COLLECTION).doc(String(companyId)).set({
        companyId: String(companyId),
        dirty: false,
        lastCompletedReason: reason || "",
        lastCompletedSource: source || "",
        lastRefreshedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastRefreshedAtMs: computedAtMs,
        lastError: null
    }, { merge: true });

    return {
        ...summary,
        computedAtMs
    };
}

async function processDirtyHomeDashboardSummaries(db, {
    buildingRooms,
    excludedBuildingName = "",
    referenceOnlyBuildingName = "",
    limit = 10
} = {}) {
    const snapshot = await db.collection(HOME_DASHBOARD_META_COLLECTION)
        .where("dirty", "==", true)
        .limit(limit)
        .get();

    const results = [];

    for (const dirtyDoc of snapshot.docs) {
        const companyId = dirtyDoc.id;
        try {
            const summary = await refreshHomeDashboardSummary(db, {
                companyId,
                buildingRooms,
                excludedBuildingName,
                referenceOnlyBuildingName,
                reason: dirtyDoc.data()?.lastRequestedReason || "dirty_refresh",
                source: dirtyDoc.data()?.lastRequestedSource || "scheduler"
            });
            results.push({
                companyId,
                success: true,
                reservationCount: summary.sourceReservationCount,
                computedAtMs: summary.computedAtMs
            });
        } catch (error) {
            await dirtyDoc.ref.set({
                dirty: true,
                lastError: error.message || String(error),
                lastFailedAt: admin.firestore.FieldValue.serverTimestamp(),
                lastFailedAtMs: Date.now()
            }, { merge: true });
            results.push({
                companyId,
                success: false,
                error: error.message || String(error)
            });
        }
    }

    return results;
}

module.exports = {
    HOME_DASHBOARD_SUMMARY_COLLECTION,
    HOME_DASHBOARD_META_COLLECTION,
    markHomeDashboardSummaryDirty,
    refreshHomeDashboardSummary,
    processDirtyHomeDashboardSummaries
};
