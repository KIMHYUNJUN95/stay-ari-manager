/**
 * Revenue Dashboard용 overlap 매출·가동률 계산 (노션 매출 대시보드 통합 리포트용)
 * - 다이쿄초 제외
 * - 사노시는 reference only (매출은 보여주되 분석/랭킹/KPI 제외)
 * - 오쿠보 A/B/C는 단독주택 그룹으로 별도 비교
 */
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);

const EXCLUDED_BUILDING = "다이쿄초";
const REFERENCE_ONLY_BUILDINGS = new Set(["사노시"]);
const OKUBO_HOME_BUILDINGS = new Set(["오쿠보A동", "오쿠보B동", "오쿠보C동"]);

function parseLocalDate(dateStr) {
    if (!dateStr) return null;
    const d = dayjs(dateStr).tz("Asia/Tokyo");
    return new Date(d.year(), d.month(), d.date());
}

function roundNumber(value) {
    return Math.round(Number(value || 0));
}

function roundPct(value) {
    return Number(Number(value || 0).toFixed(1));
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

function ensureRoomStat(buildingStat, roomName) {
    const key = roomName || "(미지정)";
    if (!buildingStat.rooms[key]) {
        buildingStat.rooms[key] = {
            room: key,
            revenue: 0,
            occupiedRoomNights: 0,
            availableRoomNights: buildingStat.daysInMonth,
            reservationCount: 0
        };
        buildingStat.roomCount += 1;
        buildingStat.totalRoomNights = buildingStat.roomCount * buildingStat.daysInMonth;
    }
    return buildingStat.rooms[key];
}

function createBuildingStat(buildingName, roomNames, daysInMonth) {
    const rooms = {};
    (roomNames || []).forEach((roomName) => {
        rooms[roomName] = {
            room: roomName,
            revenue: 0,
            occupiedRoomNights: 0,
            availableRoomNights: daysInMonth,
            reservationCount: 0
        };
    });
    const roomCount = Math.max(Object.keys(rooms).length, 1);
    return {
        building: buildingName,
        bucket: getBuildingBucket(buildingName),
        buildingType: getBuildingType(buildingName),
        roomCount,
        daysInMonth,
        totalRoomNights: roomCount * daysInMonth,
        revenue: 0,
        occupiedRoomNights: 0,
        reservationCount: 0,
        rooms
    };
}

function getPriceDiagnosis(roomStat, buildingStat) {
    const buildingAdr = buildingStat.occupiedRoomNights > 0 ? (buildingStat.revenue / buildingStat.occupiedRoomNights) : 0;
    const buildingOcc = buildingStat.totalRoomNights > 0 ? ((buildingStat.occupiedRoomNights / buildingStat.totalRoomNights) * 100) : 0;
    const roomAdr = roomStat.occupiedRoomNights > 0 ? (roomStat.revenue / roomStat.occupiedRoomNights) : 0;
    const roomOcc = roomStat.availableRoomNights > 0 ? ((roomStat.occupiedRoomNights / roomStat.availableRoomNights) * 100) : 0;
    const occDelta = roomOcc - buildingOcc;
    const adrDeltaPct = buildingAdr > 0 ? (((roomAdr - buildingAdr) / buildingAdr) * 100) : 0;

    const occDeltaLabel = `${occDelta >= 0 ? "+" : ""}${occDelta.toFixed(1)}%p`;
    const adrDeltaLabel = `${adrDeltaPct >= 0 ? "+" : ""}${adrDeltaPct.toFixed(1)}%`;
    const reason = `가동률 ${roomOcc.toFixed(1)}% (건물 평균 대비 ${occDeltaLabel}), ADR ¥${roundNumber(roomAdr).toLocaleString()} (평균 대비 ${adrDeltaLabel})`;

    if (buildingStat.roomCount <= 1 || buildingStat.occupiedRoomNights < 5) {
        return { diagnosis: "판단 유보", reason: "동일 건물 비교 표본이 부족합니다." };
    }
    if (roomStat.occupiedRoomNights < 3) {
        return { diagnosis: "판단 유보", reason: `실점유 ${roomStat.occupiedRoomNights}박으로 표본이 충분하지 않습니다.` };
    }
    if (occDelta >= 5 && adrDeltaPct <= -8) {
        return { diagnosis: "저평가 가능성", reason };
    }
    if (occDelta <= -5 && adrDeltaPct >= 8) {
        return { diagnosis: "고평가 가능성", reason };
    }
    if (occDelta >= 5 && adrDeltaPct >= 5) {
        return { diagnosis: "프리미엄 정당화", reason };
    }
    if (occDelta <= -5 && adrDeltaPct <= -5) {
        return { diagnosis: "상품/노출 점검", reason };
    }
    return { diagnosis: "적정", reason };
}

function finalizeBuildingStat(buildingStat) {
    const revenue = roundNumber(buildingStat.revenue);
    const occupiedRoomNights = roundNumber(buildingStat.occupiedRoomNights);
    const totalRoomNights = roundNumber(buildingStat.totalRoomNights);
    const occupancyPct = totalRoomNights > 0 ? roundPct((occupiedRoomNights / totalRoomNights) * 100) : 0;
    const adr = occupiedRoomNights > 0 ? roundNumber(revenue / occupiedRoomNights) : 0;
    const revPar = totalRoomNights > 0 ? roundNumber(revenue / totalRoomNights) : 0;
    const revenuePerRoom = buildingStat.roomCount > 0 ? roundNumber(revenue / buildingStat.roomCount) : 0;

    const rooms = Object.values(buildingStat.rooms)
        .map((roomStat) => {
            const roomRevenue = roundNumber(roomStat.revenue);
            const roomOccupied = roundNumber(roomStat.occupiedRoomNights);
            const roomAvailable = roundNumber(roomStat.availableRoomNights);
            const roomOccPct = roomAvailable > 0 ? roundPct((roomOccupied / roomAvailable) * 100) : 0;
            const roomAdr = roomOccupied > 0 ? roundNumber(roomRevenue / roomOccupied) : 0;
            const roomRevPar = roomAvailable > 0 ? roundNumber(roomRevenue / roomAvailable) : 0;
            const diagnosis = getPriceDiagnosis({
                ...roomStat,
                revenue: roomRevenue,
                occupiedRoomNights: roomOccupied,
                availableRoomNights: roomAvailable
            }, {
                ...buildingStat,
                revenue,
                occupiedRoomNights,
                totalRoomNights
            });
            return {
                room: roomStat.room,
                revenue: roomRevenue,
                occupiedRoomNights: roomOccupied,
                availableRoomNights: roomAvailable,
                occupancyPct: roomOccPct,
                adr: roomAdr,
                revPar: roomRevPar,
                reservationCount: roomStat.reservationCount,
                diagnosis: diagnosis.diagnosis,
                diagnosisReason: diagnosis.reason
            };
        })
        .sort((a, b) => b.revenue - a.revenue);

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
        rooms
    };
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {{ companyId: string, BUILDING_ROOMS: Record<string, Array<{ name: string }>>, forYearMonth?: string }} options
 */
async function computeRevenueDashboardData(db, options = {}) {
    const { companyId, BUILDING_ROOMS, forYearMonth } = options;
    if (!companyId || !BUILDING_ROOMS) return null;

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

    const standardRoomNamesByBuilding = getStandardRoomNamesMap(BUILDING_ROOMS);
    const buildingStatsMap = {};
    Object.entries(standardRoomNamesByBuilding).forEach(([buildingName, roomNames]) => {
        if (buildingName === EXCLUDED_BUILDING) return;
        buildingStatsMap[buildingName] = createBuildingStat(buildingName, roomNames, daysInMonth);
    });

    const snap = await db.collection("reservations")
        .where("companyId", "==", companyId)
        .where("status", "==", "confirmed")
        .get();

    const allDocs = snap.docs
        .map((d) => d.data())
        .filter((d) => (d.building || "") !== EXCLUDED_BUILDING);

    let currentMonthRevenue = 0;
    let lastMonthRevenue = 0;
    let totalRevenueWithReference = 0;
    let referenceRevenue = 0;
    let platformAirbnb = 0;
    let platformBooking = 0;
    let occupiedRoomNights = 0;

    const sixMonthsAgo = refDate.subtract(5, "month").startOf("month");
    const monthKeys = [];
    for (let i = 0; i < 6; i++) monthKeys.push(sixMonthsAgo.add(i, "month").format("YYYY-MM"));
    const monthlyTotals = {};
    monthKeys.forEach((key) => { monthlyTotals[key] = 0; });

    allDocs.forEach((doc) => {
        if (!doc.arrival || !doc.departure) return;

        const buildingName = String(doc.building || "").trim();
        if (!buildingName) return;

        const arrivalDate = parseLocalDate(doc.arrival);
        const departureDate = parseLocalDate(doc.departure);
        if (!arrivalDate || !departureDate) return;

        const totalNights = Math.floor((departureDate - arrivalDate) / (1000 * 60 * 60 * 24));
        if (totalNights <= 0) return;

        const totalPrice = Number(doc.totalPrice ?? doc.price) || 0;
        const pricePerNight = totalPrice / totalNights;
        const platformName = String(doc.platform || doc.referer || "").toLowerCase();
        const bucket = getBuildingBucket(buildingName);

        if (!buildingStatsMap[buildingName]) {
            buildingStatsMap[buildingName] = createBuildingStat(buildingName, [], daysInMonth);
        }

        const addOverlap = (rangeStart, rangeEnd) => {
            if (departureDate <= rangeStart || arrivalDate > rangeEnd) return null;
            const overlapStart = new Date(Math.max(arrivalDate.getTime(), rangeStart.getTime()));
            const overlapEndDate = new Date(departureDate.getTime());
            overlapEndDate.setDate(overlapEndDate.getDate() - 1);
            const overlapEnd = new Date(Math.min(overlapEndDate.getTime(), rangeEnd.getTime()));
            if (overlapStart > overlapEnd) return null;
            const overlapNights = Math.floor((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24)) + 1;
            return { rev: pricePerNight * overlapNights, nights: overlapNights };
        };

        const curr = addOverlap(currentStart, currentEnd);
        if (curr) {
            const roomName = String(doc.room || doc.roomName || "(미지정)");
            const buildingStat = buildingStatsMap[buildingName];
            const roomStat = ensureRoomStat(buildingStat, roomName);

            totalRevenueWithReference += curr.rev;
            if (bucket === "reference") {
                referenceRevenue += curr.rev;
            } else {
                currentMonthRevenue += curr.rev;
                occupiedRoomNights += curr.nights;
                if (platformName.includes("booking")) platformBooking += curr.rev;
                else platformAirbnb += curr.rev;
            }

            buildingStat.revenue += curr.rev;
            buildingStat.occupiedRoomNights += curr.nights;
            buildingStat.reservationCount += 1;

            roomStat.revenue += curr.rev;
            roomStat.occupiedRoomNights += curr.nights;
            roomStat.reservationCount += 1;
        }

        const last = addOverlap(lastStart, lastEnd);
        if (last && bucket !== "reference") {
            lastMonthRevenue += last.rev;
        }

        monthKeys.forEach((ym) => {
            const [targetYear, targetMonth] = ym.split("-").map(Number);
            const start = new Date(targetYear, targetMonth - 1, 1);
            const end = new Date(targetYear, targetMonth, 0);
            const overlap = addOverlap(start, end);
            if (overlap && bucket !== "reference") monthlyTotals[ym] += overlap.rev;
        });
    });

    const finalizedBuildingStats = Object.values(buildingStatsMap)
        .map(finalizeBuildingStat)
        .sort((a, b) => b.revenue - a.revenue);

    const coreBuildingStats = finalizedBuildingStats.filter((item) => item.bucket === "core");
    const okuboHomeStats = finalizedBuildingStats.filter((item) => item.bucket === "okubo");
    const referenceBuildingStats = finalizedBuildingStats.filter((item) => item.bucket === "reference");

    const totalRooms = coreBuildingStats.concat(okuboHomeStats)
        .reduce((sum, item) => sum + item.roomCount, 0);
    const totalRoomNights = totalRooms * daysInMonth;
    const occupancyPct = totalRoomNights > 0 ? roundPct((occupiedRoomNights / totalRoomNights) * 100) : 0;

    const bookingCount = allDocs.filter((reservation) => {
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
            diagnosis: room.diagnosis,
            diagnosisReason: room.diagnosisReason
        })))
        .sort((a, b) => b.revenue - a.revenue);

    return {
        yearMonth,
        currentMonthRevenue: roundNumber(currentMonthRevenue),
        totalRevenueWithReference: roundNumber(totalRevenueWithReference),
        referenceRevenue: roundNumber(referenceRevenue),
        lastMonthRevenue: roundNumber(lastMonthRevenue),
        changePct,
        bookingCount,
        occupancyPct,
        occupiedRoomNights: roundNumber(occupiedRoomNights),
        totalRoomNights: roundNumber(totalRoomNights),
        totalRooms,
        platformAirbnb: roundNumber(platformAirbnb),
        platformBooking: roundNumber(platformBooking),
        buildingBreakdown,
        buildingRoomBreakdown,
        monthlySeries,
        buildingStats: finalizedBuildingStats,
        coreBuildingStats,
        okuboHomeStats,
        referenceBuildingStats
    };
}

module.exports = { computeRevenueDashboardData };
