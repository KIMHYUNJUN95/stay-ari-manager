/**
 * Revenue/occupancy aggregation for Notion reports.
 * Revenue follows the app Revenue Dashboard overlap allocation.
 * Occupancy follows the app Occupancy Dashboard unique room-day counting.
 */
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

dayjs.extend(utc);
dayjs.extend(timezone);

const PLATFORM_DEFINITIONS = [
    { key: "airbnb", name: "Airbnb" },
    { key: "booking", name: "Booking.com" },
    { key: "expedia", name: "Expedia" },
    { key: "agoda", name: "Agoda" },
    { key: "direct", name: "Direct(수기)" },
    { key: "other", name: "Other" }
];
const CHECKIN_RESERVATION_PLATFORM_KEYS = new Set(["airbnb", "booking"]);

const EXCLUDED_BUILDING = "다이쿄초";
const REFERENCE_ONLY_BUILDINGS = new Set(["사노시"]);
const OKUBO_HOME_BUILDINGS = new Set(["오쿠보A동", "오쿠보B동", "오쿠보C동"]);

function parseLocalDate(dateStr) {
    if (!dateStr) return null;
    const d = dayjs(dateStr).tz("Asia/Tokyo");
    return new Date(d.year(), d.month(), d.date());
}

function formatDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function eachDateInRange(startDate, endDate, callback) {
    const current = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

    while (current <= end) {
        callback(formatDateKey(current));
        current.setDate(current.getDate() + 1);
    }
}

function roundNumber(value) {
    return Math.round(Number(value || 0));
}

function roundPct(value) {
    return Number(Number(value || 0).toFixed(1));
}

function getReservationAmount(doc, amountMode = "gross") {
    if (amountMode === "net") {
        return Number(doc?.netRevenue ?? doc?.totalPrice ?? doc?.price) || 0;
    }
    return Number(doc?.totalPrice ?? doc?.price ?? doc?.netRevenue) || 0;
}

function formatSignedPercent(value, digits = 1) {
    const number = Number(value || 0);
    return `${number >= 0 ? "+" : ""}${number.toFixed(digits)}%`;
}

function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, Number(value || 0)));
}

function getRankMap(items, selector) {
    return [...items]
        .sort((a, b) => {
            const valueDiff = Number(selector(b) || 0) - Number(selector(a) || 0);
            if (valueDiff !== 0) return valueDiff;
            return String(a.room || "").localeCompare(String(b.room || ""));
        })
        .reduce((acc, item, index) => {
            acc[item.room] = index + 1;
            return acc;
        }, {});
}

function getRankPercentScore(rank, total) {
    if (!total || total <= 1) return 100;
    return ((total - Number(rank || total)) / (total - 1)) * 100;
}

function getDiagnosisScoreAdjustment(diagnosis) {
    switch (String(diagnosis || "")) {
    case "우수 운영":
        return 8;
    case "프리미엄 정당화":
        return 6;
    case "저평가 가능성":
        return -2;
    case "적정":
        return 2;
    case "장기숙박형":
    case "단기회전형":
        return 1;
    case "저성과 주의":
        return -8;
    case "고평가 가능성":
    case "수요 부족/노출 문제":
        return -6;
    case "판단 유보":
    default:
        return 0;
    }
}

function getRelativePerformanceLabel(score) {
    if (score >= 90) return "최상위";
    if (score >= 78) return "상위";
    if (score >= 64) return "양호";
    if (score >= 50) return "보통";
    return "개선 필요";
}

function createPlatformTotals() {
    return PLATFORM_DEFINITIONS.reduce((acc, { key }) => {
        acc[key] = 0;
        return acc;
    }, {});
}

function normalizePlatformKey(doc) {
    const sourceText = [
        doc?.platform,
        doc?.referer,
        doc?.referrer,
        doc?.apiSource,
        doc?.subSource,
        doc?.source,
        doc?.channel
    ]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase())
        .join(" ");

    if (!sourceText) return "other";
    if (sourceText.includes("direct") || sourceText.includes("manual") || sourceText.includes("phone") || sourceText.includes("walk")) return "direct";
    if (sourceText.includes("booking")) return "booking";
    if (sourceText.includes("expedia")) return "expedia";
    if (sourceText.includes("agoda")) return "agoda";
    if (sourceText.includes("airbnb")) return "airbnb";
    return "other";
}

function buildPlatformBreakdown(platformTotals) {
    return PLATFORM_DEFINITIONS.map(({ key, name }) => ({
        key,
        name,
        revenue: roundNumber(platformTotals[key] || 0)
    }));
}

function getBuildingBucket(buildingName) {
    if (REFERENCE_ONLY_BUILDINGS.has(buildingName)) return "reference";
    if (OKUBO_HOME_BUILDINGS.has(buildingName)) return "okubo";
    return "core";
}

function getBuildingType(buildingName) {
    if (REFERENCE_ONLY_BUILDINGS.has(buildingName)) return "단독주택(대행 운영)";
    if (OKUBO_HOME_BUILDINGS.has(buildingName)) return "단독주택";
    return "객실형 건물";
}

function getStandardRoomNamesMap(BUILDING_ROOMS) {
    const result = {};
    Object.entries(BUILDING_ROOMS || {}).forEach(([buildingName, rooms]) => {
        const uniqueNames = [...new Set(
            (rooms || [])
                .map((room) => String(room?.name || "").trim())
                .filter(Boolean)
        )];
        result[buildingName] = uniqueNames;
    });
    return result;
}

function createRoomStat(roomName, daysInMonth) {
    return {
        room: roomName || "(미지정)",
        revenue: 0,
        occupiedDateKeys: new Set(),
        availableRoomNights: daysInMonth,
        reservationCount: 0
    };
}

function ensureRoomStat(buildingStat, roomName) {
    const key = roomName || "(미지정)";
    if (!buildingStat.rooms[key]) {
        buildingStat.rooms[key] = createRoomStat(key, buildingStat.daysInMonth);
        buildingStat.roomCount += 1;
    }
    return buildingStat.rooms[key];
}

function createBuildingStat(buildingName, roomNames, daysInMonth) {
    const rooms = {};
    (roomNames || []).forEach((roomName) => {
        rooms[roomName] = createRoomStat(roomName, daysInMonth);
    });

    return {
        building: buildingName,
        
        bucket: getBuildingBucket(buildingName),
        buildingType: getBuildingType(buildingName),
        roomCount: Math.max(Object.keys(rooms).length, 1),
        daysInMonth,
        revenue: 0,
        reservationCount: 0,
        rooms
    };
}

function getPriceDiagnosis(roomStat, buildingStat) {
    const buildingAdr = buildingStat.occupiedRoomNights > 0 ? (buildingStat.revenue / buildingStat.occupiedRoomNights) : 0;
    const buildingOcc = buildingStat.totalRoomNights > 0 ? ((buildingStat.occupiedRoomNights / buildingStat.totalRoomNights) * 100) : 0;
    const buildingAvgReservationCount = buildingStat.roomCount > 0 ? (buildingStat.reservationCount / buildingStat.roomCount) : 0;
    const buildingAvgStayNights = buildingStat.reservationCount > 0 ? (buildingStat.occupiedRoomNights / buildingStat.reservationCount) : 0;
    const roomAdr = roomStat.occupiedRoomNights > 0 ? (roomStat.revenue / roomStat.occupiedRoomNights) : 0;
    const roomOcc = roomStat.availableRoomNights > 0 ? ((roomStat.occupiedRoomNights / roomStat.availableRoomNights) * 100) : 0;
    const roomAvgStayNights = roomStat.reservationCount > 0 ? (roomStat.occupiedRoomNights / roomStat.reservationCount) : 0;
    const occDelta = roomOcc - buildingOcc;
    const adrDeltaPct = buildingAdr > 0 ? (((roomAdr - buildingAdr) / buildingAdr) * 100) : 0;
    const bookingDeltaPct = buildingAvgReservationCount > 0
        ? (((roomStat.reservationCount - buildingAvgReservationCount) / buildingAvgReservationCount) * 100)
        : 0;
    const avgStayDeltaPct = buildingAvgStayNights > 0
        ? (((roomAvgStayNights - buildingAvgStayNights) / buildingAvgStayNights) * 100)
        : 0;

    const occDeltaLabel = `${occDelta >= 0 ? "+" : ""}${occDelta.toFixed(1)}%p`;
    const adrDeltaLabel = formatSignedPercent(adrDeltaPct);
    const bookingDeltaLabel = formatSignedPercent(bookingDeltaPct);
    const avgStayDeltaLabel = formatSignedPercent(avgStayDeltaPct);
    const reason = `가동률 ${roomOcc.toFixed(1)}% (건물 평균 대비 ${occDeltaLabel}), ADR ¥${roundNumber(roomAdr).toLocaleString()} (평균 대비 ${adrDeltaLabel}), 예약수 ${roomStat.reservationCount}건 (평균 대비 ${bookingDeltaLabel}), 평균 숙박 ${roomAvgStayNights.toFixed(1)}박 (평균 대비 ${avgStayDeltaLabel})`;

    if (buildingStat.roomCount <= 1 || buildingStat.occupiedRoomNights < 5 || buildingStat.reservationCount < 3) {
        return {
            diagnosis: "판단 유보",
            reason: `동일 건물 비교 표본이 부족합니다. 건물 총 예약 ${buildingStat.reservationCount}건, 점유 ${buildingStat.occupiedRoomNights}박입니다.`
        };
    }
    if (roomStat.reservationCount === 0 && roomStat.occupiedRoomNights === 0 && buildingAvgReservationCount >= 2) {
        return { diagnosis: "수요 부족/노출 문제", reason };
    }
    if (roomStat.occupiedRoomNights < 3 && roomStat.reservationCount <= 1) {
        return {
            diagnosis: "판단 유보",
            reason: `${reason} · 실점유 ${roomStat.occupiedRoomNights}박 / 예약 ${roomStat.reservationCount}건으로 표본이 충분하지 않습니다.`
        };
    }
    if (bookingDeltaPct <= -20 && avgStayDeltaPct >= 25 && roomOcc >= (buildingOcc - 2)) {
        return { diagnosis: "장기숙박형", reason };
    }
    if (occDelta >= 5 && adrDeltaPct <= -8 && bookingDeltaPct >= 10) {
        return { diagnosis: "저평가 가능성", reason };
    }
    if (occDelta <= -5 && adrDeltaPct >= 8 && bookingDeltaPct <= -10) {
        return { diagnosis: "고평가 가능성", reason };
    }
    if (occDelta <= -5 && Math.abs(adrDeltaPct) < 8 && bookingDeltaPct <= -15) {
        return { diagnosis: "수요 부족/노출 문제", reason };
    }
    if (bookingDeltaPct >= 20 && occDelta >= -3 && adrDeltaPct <= -5 && avgStayDeltaPct <= -20) {
        return { diagnosis: "단기회전형", reason };
    }
    return { diagnosis: "적정", reason };
}

function finalizeBuildingStat(buildingStat) {
    const roomSummaries = Object.values(buildingStat.rooms)
        .map((roomStat) => {
            const roomRevenue = roundNumber(roomStat.revenue);
            const roomOccupied = roomStat.occupiedDateKeys instanceof Set
                ? roomStat.occupiedDateKeys.size
                : roundNumber(roomStat.occupiedRoomNights);
            const roomAvailable = roundNumber(roomStat.availableRoomNights);
            const roomOccPct = roomAvailable > 0 ? roundPct((roomOccupied / roomAvailable) * 100) : 0;
            const roomAdr = roomOccupied > 0 ? roundNumber(roomRevenue / roomOccupied) : 0;
            const roomRevPar = roomAvailable > 0 ? roundNumber(roomRevenue / roomAvailable) : 0;

            return {
                room: roomStat.room,
                revenue: roomRevenue,
                occupiedRoomNights: roomOccupied,
                availableRoomNights: roomAvailable,
                occupancyPct: roomOccPct,
                adr: roomAdr,
                revPar: roomRevPar,
                reservationCount: roomStat.reservationCount,
                avgStayNights: roomStat.reservationCount > 0 ? Number((roomOccupied / roomStat.reservationCount).toFixed(1)) : 0
            };
        })
        .sort((a, b) => b.revenue - a.revenue);

    const revenue = roundNumber(buildingStat.revenue);
    const occupiedRoomNights = roomSummaries.reduce((sum, room) => sum + room.occupiedRoomNights, 0);
    const totalRoomNights = buildingStat.roomCount * buildingStat.daysInMonth;
    const occupancyPct = totalRoomNights > 0 ? roundPct((occupiedRoomNights / totalRoomNights) * 100) : 0;
    const adr = occupiedRoomNights > 0 ? roundNumber(revenue / occupiedRoomNights) : 0;
    const revPar = totalRoomNights > 0 ? roundNumber(revenue / totalRoomNights) : 0;
    const revenuePerRoom = buildingStat.roomCount > 0 ? roundNumber(revenue / buildingStat.roomCount) : 0;
    const avgReservationCount = buildingStat.roomCount > 0 ? Number((buildingStat.reservationCount / buildingStat.roomCount).toFixed(1)) : 0;
    const avgStayNights = buildingStat.reservationCount > 0 ? Number((occupiedRoomNights / buildingStat.reservationCount).toFixed(1)) : 0;

    const rooms = roomSummaries.map((room) => {
        const diagnosis = getPriceDiagnosis(room, {
            roomCount: buildingStat.roomCount,
            revenue,
            occupiedRoomNights,
            totalRoomNights,
            reservationCount: buildingStat.reservationCount
        });

        return {
            ...room,
            diagnosis: diagnosis.diagnosis,
            diagnosisReason: diagnosis.reason
        };
    });

    return {
        building: buildingStat.building,
        bucket: buildingStat.bucket,
        buildingType: buildingStat.buildingType,
        roomCount: buildingStat.roomCount,
        revenue,
        occupiedRoomNights,
        totalRoomNights,
        occupancyPct,
        adr,
        revPar,
        revenuePerRoom,
        reservationCount: buildingStat.reservationCount,
        avgReservationCount,
        avgStayNights,
        rooms
    };
}

function getPriceDiagnosisStrict(roomStat, buildingStat) {
    const buildingAdr = buildingStat.occupiedRoomNights > 0 ? (buildingStat.revenue / buildingStat.occupiedRoomNights) : 0;
    const buildingOcc = buildingStat.totalRoomNights > 0 ? ((buildingStat.occupiedRoomNights / buildingStat.totalRoomNights) * 100) : 0;
    const buildingAvgReservationCount = buildingStat.roomCount > 0 ? (buildingStat.reservationCount / buildingStat.roomCount) : 0;
    const buildingAvgStayNights = buildingStat.reservationCount > 0 ? (buildingStat.occupiedRoomNights / buildingStat.reservationCount) : 0;
    const roomAdr = roomStat.occupiedRoomNights > 0 ? (roomStat.revenue / roomStat.occupiedRoomNights) : 0;
    const roomOcc = roomStat.availableRoomNights > 0 ? ((roomStat.occupiedRoomNights / roomStat.availableRoomNights) * 100) : 0;
    const roomAvgStayNights = roomStat.reservationCount > 0 ? (roomStat.occupiedRoomNights / roomStat.reservationCount) : 0;
    const occDelta = roomOcc - buildingOcc;
    const adrDeltaPct = buildingAdr > 0 ? (((roomAdr - buildingAdr) / buildingAdr) * 100) : 0;
    const bookingDeltaPct = buildingAvgReservationCount > 0
        ? (((roomStat.reservationCount - buildingAvgReservationCount) / buildingAvgReservationCount) * 100)
        : 0;
    const avgStayDeltaPct = buildingAvgStayNights > 0
        ? (((roomAvgStayNights - buildingAvgStayNights) / buildingAvgStayNights) * 100)
        : 0;
    const topRevenueTier = Math.max(1, Math.ceil(buildingStat.roomCount * 0.25));
    const topDemandTier = Math.max(1, Math.ceil(buildingStat.roomCount * 0.35));
    const topRevParTier = Math.max(1, Math.ceil(buildingStat.roomCount * 0.25));
    const topAdrTier = Math.max(1, Math.ceil(buildingStat.roomCount * 0.35));
    const middleTierStart = Math.max(2, Math.ceil(buildingStat.roomCount * 0.5));
    const bottomRevenueTierStart = Math.max(1, buildingStat.roomCount - Math.max(1, Math.ceil(buildingStat.roomCount * 0.25)) + 1);
    const bottomRevParTierStart = Math.max(1, buildingStat.roomCount - Math.max(1, Math.ceil(buildingStat.roomCount * 0.35)) + 1);
    const bottomDemandTierStart = Math.max(1, buildingStat.roomCount - Math.max(1, Math.ceil(buildingStat.roomCount * 0.35)) + 1);
    const bottomAdrTierStart = Math.max(1, buildingStat.roomCount - Math.max(1, Math.ceil(buildingStat.roomCount * 0.35)) + 1);
    const occDeltaLabel = `${occDelta >= 0 ? "+" : ""}${occDelta.toFixed(1)}%p`;
    const adrDeltaLabel = formatSignedPercent(adrDeltaPct);
    const bookingDeltaLabel = formatSignedPercent(bookingDeltaPct);
    const avgStayDeltaLabel = formatSignedPercent(avgStayDeltaPct);
    const similarDemandRevenueGapLabel = formatSignedPercent(roomStat.similarDemandRevenueGapPct || 0);
    const similarDemandRevParGapLabel = formatSignedPercent(roomStat.similarDemandRevParGapPct || 0);
    const strongDemand = roomStat.occupancyRank <= topDemandTier || roomStat.reservationRank <= topDemandTier;
    const weakDemand = roomStat.occupancyRank >= bottomDemandTierStart && roomStat.reservationRank >= bottomDemandTierStart;
    const weakMonetization = roomStat.adrRank >= bottomAdrTierStart || adrDeltaPct <= -8;
    const strongMonetization = roomStat.adrRank <= topAdrTier || adrDeltaPct >= 8;
    const midOrLowRevenue = roomStat.revenueRank >= middleTierStart || roomStat.revParRank >= middleTierStart;
    const severeRevenueWeakness = roomStat.revenueRank >= bottomRevenueTierStart && roomStat.revParRank >= bottomRevParTierStart;
    const reason = `가동률 ${roomOcc.toFixed(1)}% (건물 평균 대비 ${occDeltaLabel}), ADR ¥${roundNumber(roomAdr).toLocaleString()} (평균 대비 ${adrDeltaLabel}), 예약수 ${roomStat.reservationCount}건(평균 대비 ${bookingDeltaLabel}), 평균 숙박 ${roomAvgStayNights.toFixed(1)}박(평균 대비 ${avgStayDeltaLabel}), 매출 순위 ${roomStat.revenueRank}/${buildingStat.roomCount}, RevPAR 순위 ${roomStat.revParRank}/${buildingStat.roomCount}, 예약수 순위 ${roomStat.reservationRank}/${buildingStat.roomCount}, ADR 순위 ${roomStat.adrRank}/${buildingStat.roomCount}, 유사 예약수 최고 객실 대비 매출 ${similarDemandRevenueGapLabel}, RevPAR ${similarDemandRevParGapLabel}`;

    if (buildingStat.roomCount <= 1 || buildingStat.occupiedRoomNights < 5 || buildingStat.reservationCount < 3) {
        return {
            diagnosis: "판단 유보",
            reason: `동일 건물 비교 표본이 부족합니다. 건물 총 예약 ${buildingStat.reservationCount}건 / 점유 ${buildingStat.occupiedRoomNights}박입니다.`
        };
    }
    if (roomStat.reservationCount === 0 && roomStat.occupiedRoomNights === 0 && buildingAvgReservationCount >= 2) {
        return { diagnosis: "수요 부족/노출 문제", reason };
    }
    if (roomStat.occupiedRoomNights < 3 && roomStat.reservationCount <= 1) {
        return {
            diagnosis: "판단 유보",
            reason: `${reason} · 현재 객실 표본이 ${roomStat.occupiedRoomNights}박 / 예약 ${roomStat.reservationCount}건으로 충분하지 않습니다.`
        };
    }
    if (bookingDeltaPct <= -20 && avgStayDeltaPct >= 25 && roomOcc >= (buildingOcc - 2)) {
        return { diagnosis: "장기숙박형", reason };
    }
    if (
        strongDemand &&
        weakMonetization &&
        (
            midOrLowRevenue ||
            (roomStat.similarDemandRevenueGapPct || 0) <= -8 ||
            (roomStat.similarDemandRevParGapPct || 0) <= -8
        )
    ) {
        return { diagnosis: "저평가 가능성", reason };
    }
    if (
        weakDemand &&
        strongMonetization &&
        (
            roomStat.revenueRank > topRevenueTier ||
            roomStat.revParRank > topRevParTier
        )
    ) {
        return { diagnosis: "고평가 가능성", reason };
    }
    if (occDelta <= -5 && Math.abs(adrDeltaPct) < 8 && bookingDeltaPct <= -15) {
        return { diagnosis: "수요 부족/노출 문제", reason };
    }
    if (bookingDeltaPct >= 20 && occDelta >= -3 && adrDeltaPct <= -5 && avgStayDeltaPct <= -20) {
        return { diagnosis: "단기회전형", reason };
    }
    if (
        roomStat.revenueRank <= topRevenueTier &&
        roomStat.occupancyRank <= topDemandTier &&
        roomStat.reservationRank <= Math.max(topDemandTier + 1, 2)
    ) {
        return { diagnosis: "우수 운영", reason: `${reason} · 회전형 우수 운영 객실입니다.` };
    }
    if (
        roomStat.revenueRank <= topRevenueTier &&
        roomStat.revParRank <= topRevParTier &&
        strongDemand &&
        roomStat.adrRank <= Math.max(topAdrTier + 1, 2)
    ) {
        return { diagnosis: "우수 운영", reason: `${reason} · 단가형 우수 운영 객실입니다.` };
    }
    if (
        (
            severeRevenueWeakness &&
            weakDemand
        ) ||
        (
            roomStat.revenueRank >= middleTierStart &&
            roomStat.revParRank >= middleTierStart &&
            weakDemand &&
            bookingDeltaPct <= -5
        ) ||
        (
            roomStat.revenueRank >= middleTierStart &&
            (roomStat.similarDemandRevenueGapPct || 0) <= -7
        ) ||
        (
            roomStat.revParRank >= middleTierStart &&
            (roomStat.similarDemandRevParGapPct || 0) <= -8
        )
    ) {
        return { diagnosis: "저성과 주의", reason };
    }
    return { diagnosis: "적정", reason };
}

function finalizeBuildingStatStrict(buildingStat) {
    const roomSummaries = Object.values(buildingStat.rooms)
        .map((roomStat) => {
            const roomRevenue = roundNumber(roomStat.revenue);
            const roomOccupied = roomStat.occupiedDateKeys instanceof Set
                ? roomStat.occupiedDateKeys.size
                : roundNumber(roomStat.occupiedRoomNights);
            const roomAvailable = roundNumber(roomStat.availableRoomNights);
            const roomOccPct = roomAvailable > 0 ? roundPct((roomOccupied / roomAvailable) * 100) : 0;
            const roomAdr = roomOccupied > 0 ? roundNumber(roomRevenue / roomOccupied) : 0;
            const roomRevPar = roomAvailable > 0 ? roundNumber(roomRevenue / roomAvailable) : 0;

            return {
                room: roomStat.room,
                revenue: roomRevenue,
                occupiedRoomNights: roomOccupied,
                availableRoomNights: roomAvailable,
                occupancyPct: roomOccPct,
                adr: roomAdr,
                revPar: roomRevPar,
                reservationCount: roomStat.reservationCount,
                avgStayNights: roomStat.reservationCount > 0 ? Number((roomOccupied / roomStat.reservationCount).toFixed(1)) : 0
            };
        })
        .sort((a, b) => b.revenue - a.revenue);

    const revenueRankMap = getRankMap(roomSummaries, (room) => room.revenue);
    const revParRankMap = getRankMap(roomSummaries, (room) => room.revPar);
    const occupancyRankMap = getRankMap(roomSummaries, (room) => room.occupancyPct);
    const reservationRankMap = getRankMap(roomSummaries, (room) => room.reservationCount);
    const adrRankMap = getRankMap(roomSummaries, (room) => room.adr);
    const roomsWithBenchmarks = roomSummaries.map((room) => {
        const similarDemandRooms = roomSummaries.filter((candidate) => Math.abs(candidate.reservationCount - room.reservationCount) <= 1);
        const similarDemandTopRevenue = similarDemandRooms.reduce((max, candidate) => Math.max(max, Number(candidate.revenue) || 0), 0);
        const similarDemandTopRevPar = similarDemandRooms.reduce((max, candidate) => Math.max(max, Number(candidate.revPar) || 0), 0);

        return {
            ...room,
            revenueRank: revenueRankMap[room.room] || roomSummaries.length,
            revParRank: revParRankMap[room.room] || roomSummaries.length,
            occupancyRank: occupancyRankMap[room.room] || roomSummaries.length,
            reservationRank: reservationRankMap[room.room] || roomSummaries.length,
            adrRank: adrRankMap[room.room] || roomSummaries.length,
            similarDemandRevenueGapPct: similarDemandTopRevenue > 0
                ? Number((((room.revenue - similarDemandTopRevenue) / similarDemandTopRevenue) * 100).toFixed(1))
                : 0,
            similarDemandRevParGapPct: similarDemandTopRevPar > 0
                ? Number((((room.revPar - similarDemandTopRevPar) / similarDemandTopRevPar) * 100).toFixed(1))
                : 0
        };
    });

    const revenue = roundNumber(buildingStat.revenue);
    const occupiedRoomNights = roomsWithBenchmarks.reduce((sum, room) => sum + room.occupiedRoomNights, 0);
    const totalRoomNights = buildingStat.roomCount * buildingStat.daysInMonth;
    const occupancyPct = totalRoomNights > 0 ? roundPct((occupiedRoomNights / totalRoomNights) * 100) : 0;
    const adr = occupiedRoomNights > 0 ? roundNumber(revenue / occupiedRoomNights) : 0;
    const revPar = totalRoomNights > 0 ? roundNumber(revenue / totalRoomNights) : 0;
    const revenuePerRoom = buildingStat.roomCount > 0 ? roundNumber(revenue / buildingStat.roomCount) : 0;
    const avgReservationCount = buildingStat.roomCount > 0 ? Number((buildingStat.reservationCount / buildingStat.roomCount).toFixed(1)) : 0;
    const avgStayNights = buildingStat.reservationCount > 0 ? Number((occupiedRoomNights / buildingStat.reservationCount).toFixed(1)) : 0;

    const rooms = roomsWithBenchmarks.map((room) => {
        const diagnosis = getPriceDiagnosisStrict(room, {
            roomCount: buildingStat.roomCount,
            revenue,
            occupiedRoomNights,
            totalRoomNights,
            reservationCount: buildingStat.reservationCount
        });

        return {
            ...room,
            diagnosis: diagnosis.diagnosis,
            diagnosisReason: diagnosis.reason
        };
    }).map((room) => {
        const rankBaseScore =
            (getRankPercentScore(room.revenueRank, buildingStat.roomCount) * 0.45) +
            (getRankPercentScore(room.revParRank, buildingStat.roomCount) * 0.35) +
            (getRankPercentScore(room.occupancyRank, buildingStat.roomCount) * 0.20);
        const relativePerformanceScore = roundPct(clampNumber(rankBaseScore + getDiagnosisScoreAdjustment(room.diagnosis), 0, 100));

        return {
            ...room,
            relativePerformanceScore,
            relativePerformanceLabel: getRelativePerformanceLabel(relativePerformanceScore)
        };
    });

    return {
        building: buildingStat.building,
        bucket: buildingStat.bucket,
        buildingType: buildingStat.buildingType,
        roomCount: buildingStat.roomCount,
        revenue,
        occupiedRoomNights,
        totalRoomNights,
        occupancyPct,
        adr,
        revPar,
        revenuePerRoom,
        reservationCount: buildingStat.reservationCount,
        avgReservationCount,
        avgStayNights,
        rooms
    };
}

function getOverlapRange(arrivalDate, departureDate, rangeStart, rangeEnd) {
    if (departureDate <= rangeStart || arrivalDate > rangeEnd) return null;

    const overlapStart = new Date(Math.max(arrivalDate.getTime(), rangeStart.getTime()));
    const overlapEndDate = new Date(departureDate.getTime());
    overlapEndDate.setDate(overlapEndDate.getDate() - 1);
    const overlapEnd = new Date(Math.min(overlapEndDate.getTime(), rangeEnd.getTime()));

    if (overlapStart > overlapEnd) return null;

    const overlapNights = Math.floor((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24)) + 1;
    return {
        start: overlapStart,
        end: overlapEnd,
        nights: overlapNights
    };
}

function buildRevenueDashboardSnapshot(allDocs = [], options = {}) {
    const {
        BUILDING_ROOMS,
        forYearMonth,
        excludedBuildings = [EXCLUDED_BUILDING],
        amountMode = "gross"
    } = options;
    if (!BUILDING_ROOMS) return null;
    const tokyoNow = dayjs().tz("Asia/Tokyo");
    const refDate = forYearMonth
        ? dayjs(`${forYearMonth}-01`).tz("Asia/Tokyo")
        : tokyoNow;
    const year = refDate.year();
    const month = refDate.month() + 1;
    const yearMonth = `${year}-${String(month).padStart(2, "0")}`;
    const monthStart = `${yearMonth}-01`;
    const monthEnd = dayjs(`${yearMonth}-01`).endOf("month").format("YYYY-MM-DD");
    const lastMonth = refDate.subtract(1, "month");
    const lastMonthStart = lastMonth.startOf("month").format("YYYY-MM-DD");
    const lastMonthEnd = lastMonth.endOf("month").format("YYYY-MM-DD");
    const daysInMonth = dayjs(monthStart).daysInMonth();

    const currentStart = parseLocalDate(monthStart);
    const currentEnd = parseLocalDate(monthEnd);
    const lastStart = parseLocalDate(lastMonthStart);
    const lastEnd = parseLocalDate(lastMonthEnd);
    const excludedSet = new Set((excludedBuildings || []).map((building) => String(building || "").trim()).filter(Boolean));

    const standardRoomNamesByBuilding = getStandardRoomNamesMap(BUILDING_ROOMS);
    const buildingStatsMap = {};
    Object.entries(standardRoomNamesByBuilding).forEach(([buildingName, roomNames]) => {
        if (excludedSet.has(buildingName)) return;
        buildingStatsMap[buildingName] = createBuildingStat(buildingName, roomNames, daysInMonth);
    });
    const filteredDocs = (allDocs || []).filter((doc) => !excludedSet.has(String(doc?.building || "").trim()));

    let currentMonthRevenue = 0;
    let lastMonthRevenue = 0;
    let totalRevenueWithReference = 0;
    let referenceRevenue = 0;
    const platformTotals = createPlatformTotals();
    let checkinReservationCount = 0;

    const sixMonthsAgo = refDate.subtract(5, "month").startOf("month");
    const monthKeys = [];
    for (let i = 0; i < 6; i++) monthKeys.push(sixMonthsAgo.add(i, "month").format("YYYY-MM"));
    const monthlyTotals = {};
    monthKeys.forEach((key) => {
        monthlyTotals[key] = 0;
    });

    filteredDocs.forEach((doc) => {
        if (!doc.arrival || !doc.departure) return;

        const buildingName = String(doc.building || "").trim();
        if (!buildingName) return;

        const arrivalDate = parseLocalDate(doc.arrival);
        const departureDate = parseLocalDate(doc.departure);
        if (!arrivalDate || !departureDate) return;

        const totalNights = Math.floor((departureDate - arrivalDate) / (1000 * 60 * 60 * 24));
        if (totalNights <= 0) return;

        const reservationAmount = getReservationAmount(doc, amountMode);
        const pricePerNight = reservationAmount / totalNights;
        const platformKey = normalizePlatformKey(doc);
        const bucket = getBuildingBucket(buildingName);

        if (!buildingStatsMap[buildingName]) {
            buildingStatsMap[buildingName] = createBuildingStat(buildingName, [], daysInMonth);
        }

        if (
            bucket !== "reference" &&
            CHECKIN_RESERVATION_PLATFORM_KEYS.has(platformKey) &&
            arrivalDate >= currentStart &&
            arrivalDate <= currentEnd
        ) {
            checkinReservationCount += 1;
        }

        const currentOverlap = getOverlapRange(arrivalDate, departureDate, currentStart, currentEnd);
        if (currentOverlap) {
            const overlapRevenue = pricePerNight * currentOverlap.nights;
            const roomName = String(doc.room || doc.roomName || "(미지정)");
            const buildingStat = buildingStatsMap[buildingName];
            const roomStat = ensureRoomStat(buildingStat, roomName);

            totalRevenueWithReference += overlapRevenue;
            if (bucket === "reference") {
                referenceRevenue += overlapRevenue;
            } else {
                currentMonthRevenue += overlapRevenue;
                platformTotals[platformKey] = (platformTotals[platformKey] || 0) + overlapRevenue;
            }

            buildingStat.revenue += overlapRevenue;
            buildingStat.reservationCount += 1;
            roomStat.revenue += overlapRevenue;
            roomStat.reservationCount += 1;

            eachDateInRange(currentOverlap.start, currentOverlap.end, (dateKey) => {
                roomStat.occupiedDateKeys.add(dateKey);
            });
        }

        const lastOverlap = getOverlapRange(arrivalDate, departureDate, lastStart, lastEnd);
        if (lastOverlap && bucket !== "reference") {
            lastMonthRevenue += pricePerNight * lastOverlap.nights;
        }

        monthKeys.forEach((ym) => {
            const [targetYear, targetMonth] = ym.split("-").map(Number);
            const start = new Date(targetYear, targetMonth - 1, 1);
            const end = new Date(targetYear, targetMonth, 0);
            const overlap = getOverlapRange(arrivalDate, departureDate, start, end);
            if (overlap && bucket !== "reference") {
                monthlyTotals[ym] += pricePerNight * overlap.nights;
            }
        });
    });

    const finalizedBuildingStats = Object.values(buildingStatsMap)
        .map(finalizeBuildingStatStrict)
        .sort((a, b) => b.revenue - a.revenue);

    const coreBuildingStats = finalizedBuildingStats.filter((item) => item.bucket === "core");
    const okuboHomeStats = finalizedBuildingStats.filter((item) => item.bucket === "okubo");
    const referenceBuildingStats = finalizedBuildingStats.filter((item) => item.bucket === "reference");

    const operatingBuildings = coreBuildingStats.concat(okuboHomeStats);
    const totalRooms = operatingBuildings.reduce((sum, item) => sum + item.roomCount, 0);
    const occupiedRoomNights = operatingBuildings.reduce((sum, item) => sum + item.occupiedRoomNights, 0);
    const totalRoomNights = operatingBuildings.reduce((sum, item) => sum + item.totalRoomNights, 0);
    const occupancyPct = totalRoomNights > 0 ? roundPct((occupiedRoomNights / totalRoomNights) * 100) : 0;

    const bookingCreatedCount = filteredDocs.filter((reservation) => {
        if (REFERENCE_ONLY_BUILDINGS.has(reservation.building)) return false;
        const bookTime = reservation.bookDate || reservation.firstNight || "";
        return typeof bookTime === "string" && bookTime.startsWith(yearMonth);
    }).length;

    const changePct = lastMonthRevenue > 0
        ? roundPct(((currentMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100)
        : (currentMonthRevenue > 0 ? 100 : 0);

    const monthlySeries = monthKeys.map((ym) => ({
        month: ym,
        revenue: roundNumber(monthlyTotals[ym] || 0)
    }));

    const buildingBreakdown = coreBuildingStats.map((item) => ({
        building: item.building,
        revenue: item.revenue,
        roomCount: item.roomCount,
        occupancyPct: item.occupancyPct,
        adr: item.adr,
        revPar: item.revPar,
        revenuePerRoom: item.revenuePerRoom
    }));

    const buildingRoomBreakdown = coreBuildingStats
        .flatMap((item) => item.rooms.map((room) => ({
            building: item.building,
            room: room.room,
            revenue: room.revenue,
            occupancyPct: room.occupancyPct,
            adr: room.adr,
            revPar: room.revPar,
            reservationCount: room.reservationCount,
            relativePerformanceScore: room.relativePerformanceScore,
            relativePerformanceLabel: room.relativePerformanceLabel,
            diagnosis: room.diagnosis,
            diagnosisReason: room.diagnosisReason
        })))
        .sort((a, b) => {
            const scoreDiff = Number(b.relativePerformanceScore || 0) - Number(a.relativePerformanceScore || 0);
            if (scoreDiff !== 0) return scoreDiff;
            const revParDiff = Number(b.revPar || 0) - Number(a.revPar || 0);
            if (revParDiff !== 0) return revParDiff;
            return Number(b.revenue || 0) - Number(a.revenue || 0);
        });

    const platformBreakdown = buildPlatformBreakdown(platformTotals);

    return {
        yearMonth,
        currentMonthRevenue: roundNumber(currentMonthRevenue),
        totalRevenueWithReference: roundNumber(totalRevenueWithReference),
        referenceRevenue: roundNumber(referenceRevenue),
        lastMonthRevenue: roundNumber(lastMonthRevenue),
        changePct,
        bookingCount: bookingCreatedCount,
        bookingCreatedCount,
        stayMonthReservationCount: checkinReservationCount,
        checkinReservationCount,
        occupancyPct,
        occupiedRoomNights: roundNumber(occupiedRoomNights),
        totalRoomNights: roundNumber(totalRoomNights),
        totalRooms,
        platformAirbnb: roundNumber(platformTotals.airbnb),
        platformBooking: roundNumber(platformTotals.booking),
        platformExpedia: roundNumber(platformTotals.expedia),
        platformAgoda: roundNumber(platformTotals.agoda),
        platformDirect: roundNumber(platformTotals.direct),
        platformOther: roundNumber(platformTotals.other),
        platformBreakdown,
        buildingBreakdown,
        buildingRoomBreakdown,
        monthlySeries,
        buildingStats: finalizedBuildingStats,
        coreBuildingStats,
        okuboHomeStats,
        referenceBuildingStats
    };
}

async function fetchConfirmedReservations(db, companyId) {
    if (!db || !companyId) return [];
    const snap = await db.collection("reservations")
        .where("companyId", "==", companyId)
        .where("status", "==", "confirmed")
        .get();
    return snap.docs.map((d) => d.data());
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {{ companyId: string, BUILDING_ROOMS: Record<string, Array<{ name: string }>>, forYearMonth?: string, excludedBuildings?: string[] }} options
 */
async function computeRevenueDashboardData(db, options = {}) {
    const { companyId, BUILDING_ROOMS } = options;
    if (!companyId || !BUILDING_ROOMS) return null;
    const allDocs = await fetchConfirmedReservations(db, companyId);
    return buildRevenueDashboardSnapshot(allDocs, options);
}

module.exports = {
    computeRevenueDashboardData,
    fetchConfirmedReservations,
    buildRevenueDashboardSnapshot
};
