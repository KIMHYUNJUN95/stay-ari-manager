const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

dayjs.extend(utc);
dayjs.extend(timezone);

const TOKYO_TZ = "Asia/Tokyo";

const DEFAULT_WAGE_SCENARIOS = {
    low: 1250,
    base: 1450,
    high: 1700,
};

const DEFAULT_BUILDING_RULES = {
    arakichoA: {
        type: "room",
        label: "Arakicho A",
        aliases: [
            "arakichoA", "arakicho a", "arakicho-a", "Arakicho A",
            "아라키초A", "아라키초 A", "아라키초a", "아라키초 a",
        ],
        minWorkers: 1,
        recommendedWorkers: 1,
        hoursPerWorker: 3.75,
        maxUnitsPerWorker: 2,
    },
    arakichoB: {
        type: "room",
        label: "Arakicho B",
        aliases: [
            "arakichoB", "arakicho b", "arakicho-b", "Arakicho B",
            "아라키초B", "아라키초 B", "아라키초b", "아라키초 b",
        ],
        minWorkers: 1,
        recommendedWorkers: 1,
        hoursPerWorker: 4.5,
        maxUnitsPerWorker: 1,
    },
    kabukicho: {
        type: "room",
        label: "Kabukicho",
        aliases: ["kabukicho", "Kabukicho", "가부키초"],
        minWorkers: 1,
        recommendedWorkers: 1,
        hoursPerWorker: 3,
        maxUnitsPerWorker: 2,
    },
    takadanobaba: {
        type: "room",
        label: "Takadanobaba",
        aliases: ["takadanobaba", "baba", "Takadanobaba", "다카다노바바", "바바"],
        minWorkers: 1,
        recommendedWorkers: 1,
        hoursPerWorker: 4.2,
        maxUnitsPerWorker: 1,
    },
    okuboA: {
        type: "okubo",
        label: "Okubo A",
        aliases: [
            "okuboA", "okubo a", "okubo-a", "Okubo A",
            "오쿠보A동", "오쿠보 A동", "오쿠보A", "오쿠보 A",
        ],
        minWorkers: 2,
        recommendedWorkers: 2,
        hoursPerWorker: 3.5,
        cleaningUnitMultiplier: 2,
        fallbackHoursPerWorker: 7,
        workersPerPhysicalUnit: 2,
    },
    okuboB: {
        type: "okubo",
        label: "Okubo B",
        aliases: [
            "okuboB", "okubo b", "okubo-b", "Okubo B",
            "오쿠보B동", "오쿠보 B동", "오쿠보B", "오쿠보 B",
        ],
        minWorkers: 2,
        recommendedWorkers: 2,
        hoursPerWorker: 3.5,
        cleaningUnitMultiplier: 2,
        fallbackHoursPerWorker: 7,
        workersPerPhysicalUnit: 2,
    },
    okuboC: {
        type: "okubo",
        label: "Okubo C",
        aliases: [
            "okuboC", "okubo c", "okubo-c", "Okubo C",
            "오쿠보C동", "오쿠보 C동", "오쿠보C", "오쿠보 C",
        ],
        minWorkers: 2,
        recommendedWorkers: 2,
        hoursPerWorker: 3.5,
        cleaningUnitMultiplier: 2,
        fallbackHoursPerWorker: 7,
        workersPerPhysicalUnit: 2,
    },
};

const DEFAULT_EXCLUDED_BUILDING_ALIASES = [
    "daikyocho",
    "daikyo",
    "sano",
    "다이쿄초",
    "다이쿄",
    "다이쿄초(매각완료)",
    "사노시",
    "사노",
];

function toDateKey(date, timezoneName = TOKYO_TZ) {
    if (!date) return "";
    return dayjs(date).tz(timezoneName).format("YYYY-MM-DD");
}

function normalizeText(value) {
    return String(value || "")
        .normalize("NFC")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
}

function getReservationRoomKey(reservation = {}) {
    return `${String(reservation.building || "").trim()}__${String(reservation.room || "").trim()}`;
}

function isConfirmedReservation(reservation = {}) {
    return String(reservation.status || "").toLowerCase() === "confirmed";
}

function getReservationPax(reservation = {}) {
    return Number(reservation.numAdult || 0) + Number(reservation.numChild || 0);
}

function createBuildingResolver(buildingRules = DEFAULT_BUILDING_RULES) {
    const aliasToKey = new Map();

    Object.entries(buildingRules).forEach(([key, rule]) => {
        [key, rule.label, ...(rule.aliases || [])].forEach((alias) => {
            const normalized = normalizeText(alias);
            if (normalized) aliasToKey.set(normalized, key);
        });
    });

    return function resolveBuildingKey(buildingName) {
        const normalized = normalizeText(buildingName);
        return aliasToKey.get(normalized) || normalized || "unknown";
    };
}

function isExcludedBuilding(buildingName, options = {}) {
    const excludedAliases = options.excludedBuildingAliases || DEFAULT_EXCLUDED_BUILDING_ALIASES;
    const normalized = normalizeText(buildingName);
    const compact = normalized.replace(/\s+/g, "");

    return excludedAliases.some((alias) => {
        const normalizedAlias = normalizeText(alias);
        if (!normalizedAlias) return false;
        const aliasCompact = normalizedAlias.replace(/\s+/g, "");
        return normalized === normalizedAlias
            || compact === aliasCompact
            || normalized.includes(normalizedAlias)
            || compact.includes(aliasCompact);
    });
}

function sortByBuildingOrder(items = [], buildingOrder = []) {
    const orderMap = new Map(buildingOrder.map((key, index) => [key, index]));
    return [...items].sort((a, b) => {
        const aOrder = orderMap.has(a.buildingKey) ? orderMap.get(a.buildingKey) : 999;
        const bOrder = orderMap.has(b.buildingKey) ? orderMap.get(b.buildingKey) : 999;
        if (aOrder !== bOrder) return aOrder - bOrder;
        if ((a.building || "") !== (b.building || "")) return String(a.building || "").localeCompare(String(b.building || ""));
        return String(a.room || "").localeCompare(String(b.room || ""));
    });
}

function buildCleaningSettingCalendarDay(reservations = [], targetDate, options = {}) {
    const dateKey = toDateKey(targetDate || options.targetDate || dayjs().tz(TOKYO_TZ), options.timezone || TOKYO_TZ);
    const buildingRules = options.buildingRules || DEFAULT_BUILDING_RULES;
    const resolveBuildingKey = createBuildingResolver(buildingRules);
    const buildingOrder = options.buildingOrder || Object.keys(buildingRules);

    const activeReservations = reservations
        .filter(isConfirmedReservation)
        .filter((reservation) => !isExcludedBuilding(reservation.building, options));

    const departures = activeReservations.filter((reservation) => reservation.departure === dateKey);
    const arrivals = activeReservations.filter((reservation) => reservation.arrival === dateKey);

    const departuresByRoom = new Map();
    departures.forEach((reservation) => {
        departuresByRoom.set(getReservationRoomKey(reservation), reservation);
    });

    const arrivalsByRoom = new Map();
    arrivals.forEach((reservation) => {
        arrivalsByRoom.set(getReservationRoomKey(reservation), reservation);
    });

    const cleaningTasks = departures.map((departure) => {
        const roomKey = getReservationRoomKey(departure);
        const arrival = arrivalsByRoom.get(roomKey) || null;
        const buildingKey = resolveBuildingKey(departure.building);

        return {
            date: dateKey,
            building: departure.building || "",
            buildingKey,
            room: departure.room || "",
            hasCheckout: true,
            hasSameDayCheckin: Boolean(arrival),
            checkoutGuestName: departure.guestName || "",
            nextCheckinDate: arrival?.arrival || "",
            nextCheckinGuestName: arrival?.guestName || "",
            nextCheckinPax: arrival ? getReservationPax(arrival) : 0,
        };
    });

    const settingTasks = arrivals
        .filter((arrival) => !departuresByRoom.has(getReservationRoomKey(arrival)))
        .map((arrival) => ({
            date: dateKey,
            building: arrival.building || "",
            buildingKey: resolveBuildingKey(arrival.building),
            room: arrival.room || "",
            hasCheckout: false,
            hasSameDayCheckin: false,
            nextCheckinDate: arrival.arrival || "",
            nextCheckinGuestName: arrival.guestName || "",
            nextCheckinPax: getReservationPax(arrival),
        }));

    const sortedCleaningTasks = sortByBuildingOrder(cleaningTasks, buildingOrder);
    const sortedSettingTasks = sortByBuildingOrder(settingTasks, buildingOrder);

    return {
        date: dateKey,
        cleaningTasks: sortedCleaningTasks,
        settingTasks: sortedSettingTasks,
        summary: {
            cleaningCount: sortedCleaningTasks.length,
            settingCount: sortedSettingTasks.length,
            turnoverCount: sortedCleaningTasks.filter((task) => task.hasSameDayCheckin).length,
        },
        byBuilding: summarizeTasksByBuilding(sortedCleaningTasks, sortedSettingTasks, buildingRules),
    };
}

function summarizeTasksByBuilding(cleaningTasks = [], settingTasks = [], buildingRules = DEFAULT_BUILDING_RULES) {
    const buildingMap = new Map();

    function getBucket(task) {
        const key = task.buildingKey || "unknown";
        if (!buildingMap.has(key)) {
            buildingMap.set(key, {
                buildingKey: key,
                building: task.building || buildingRules[key]?.label || key,
                cleaningCount: 0,
                settingCount: 0,
                turnoverCount: 0,
                confirmedCO: 0,
                projectedCO: 0,
                totalCO: 0,
            });
        }
        return buildingMap.get(key);
    }

    cleaningTasks.forEach((task) => {
        const bucket = getBucket(task);
        bucket.cleaningCount += 1;
        bucket.confirmedCO += 1;
        bucket.totalCO += 1;
        if (task.hasSameDayCheckin) bucket.turnoverCount += 1;
    });

    settingTasks.forEach((task) => {
        const bucket = getBucket(task);
        bucket.settingCount += 1;
    });

    return Array.from(buildingMap.values());
}

function getBuildingScenario(rule = {}, options = {}) {
    if (rule.type !== "okubo") {
        return {
            workers: rule.minWorkers || 1,
            hoursPerWorker: Number(rule.hoursPerWorker || 0),
            scenarioUsed: "room_1p_standard",
        };
    }

    if (options.okuboMode === "one_worker") {
        return {
            workers: 1,
            hoursPerWorker: Number(rule.fallbackHoursPerWorker || 7),
            scenarioUsed: "okubo_1p",
        };
    }

    if (options.okuboMode === "two_worker_extended") {
        return {
            workers: 2,
            hoursPerWorker: 5,
            scenarioUsed: "okubo_2p_extended",
        };
    }

    return {
        workers: 2,
        hoursPerWorker: Number(rule.hoursPerWorker || 4),
        scenarioUsed: "okubo_2p_standard",
    };
}

// Headcount based on practical cleaning capacity rules, not hours.
// Room buildings: ceil(physicalCheckoutUnits / maxUnitsPerWorker)
// Okubo: physicalCheckoutUnits * workersPerPhysicalUnit
function calculateCapacityHeadcount(rule, physicalCheckoutUnits) {
    const units = Number(physicalCheckoutUnits || 0);
    if (units <= 0) return 0;
    if (rule.type === "okubo") {
        const workersPerUnit = Math.max(1, Number(rule.workersPerPhysicalUnit || rule.minWorkers || 2));
        return Math.ceil(units * workersPerUnit);
    }
    const maxUnitsPerWorker = Math.max(1, Number(rule.maxUnitsPerWorker || 1));
    return Math.ceil(units / maxUnitsPerWorker);
}

function enrichCapacityRows(buildingRows = [], options = {}) {
    const buildingRules = options.buildingRules || DEFAULT_BUILDING_RULES;

    return buildingRows.map((row) => {
        const rule = buildingRules[row.buildingKey] || {};
        const scenario = getBuildingScenario(rule, options);
        const checkoutUnits = Number(row.totalCO || row.confirmedCO || row.cleaningCount || 0);
        const physicalCheckoutUnits = Number(
            row.physicalCheckoutUnits != null
                ? row.physicalCheckoutUnits
                : checkoutUnits
        );

        // Labor cost uses hours: physicalCheckoutUnits * hoursPerWorker * workers
        const estimatedJobHours = physicalCheckoutUnits * scenario.hoursPerWorker;
        const estimatedWorkHours = estimatedJobHours * scenario.workers;

        // Headcount uses capacity rules — not hours.
        const capacityHeadcount = calculateCapacityHeadcount(rule, physicalCheckoutUnits);

        return {
            ...row,
            checkoutUnits,
            physicalCheckoutUnits,
            okuboFlag: rule.type === "okubo",
            scenarioUsed: scenario.scenarioUsed,
            workersPerUnit: scenario.workers,
            hoursPerUnit: scenario.hoursPerWorker,
            estimatedJobHours,
            estimatedWorkHours,
            capacityHeadcount,
            mathMinHeadcount: capacityHeadcount,
            operationalMinHeadcount: capacityHeadcount,
            minHeadcount: capacityHeadcount,
            recommendedHeadcount: capacityHeadcount,
        };
    });
}

function estimateLaborCost(workMinutes, hourlyRate) {
    const minutes = Number(workMinutes || 0);
    const rate = Number(hourlyRate || 0);
    if (minutes <= 0 || rate <= 0) return 0;
    return Math.round((minutes * rate) / 60);
}

function addLaborCostScenarios(rows = [], wageScenarios = DEFAULT_WAGE_SCENARIOS) {
    return rows.map((row) => {
        const workMinutes = Number(row.estimatedWorkHours || 0) * 60;
        return {
            ...row,
            estimatedLaborCostLow: estimateLaborCost(workMinutes, wageScenarios.low),
            estimatedLaborCostBase: estimateLaborCost(workMinutes, wageScenarios.base),
            estimatedLaborCostHigh: estimateLaborCost(workMinutes, wageScenarios.high),
        };
    });
}

function buildDailyCalendarRows(reservations = [], dateKeys = [], options = {}) {
    return dateKeys.flatMap((dateKey) => {
        const day = buildCleaningSettingCalendarDay(reservations, dateKey, options);
        const capacityRows = addLaborCostScenarios(enrichCapacityRows(day.byBuilding, options), options.wageScenarios);

        return capacityRows.map((row) => ({
            date: day.date,
            weekday: dayjs(day.date).tz(options.timezone || TOKYO_TZ).format("ddd"),
            building: row.building,
            cleaningCount: row.cleaningCount,
            settingCount: row.settingCount,
            turnoverCount: row.turnoverCount,
            confirmedCO: row.confirmedCO,
            projectedCO: row.projectedCO,
            totalCO: row.totalCO,
            estimatedJobHours: row.estimatedJobHours,
            estimatedWorkHours: row.estimatedWorkHours,
            mathMinHeadcount: row.mathMinHeadcount,
            operationalMinHeadcount: row.operationalMinHeadcount,
            minHeadcount: row.minHeadcount,
            recommendedHeadcount: row.recommendedHeadcount,
            estimatedLaborCostLow: row.estimatedLaborCostLow,
            estimatedLaborCostBase: row.estimatedLaborCostBase,
            estimatedLaborCostHigh: row.estimatedLaborCostHigh,
        }));
    });
}

function buildDateRange(startDate, days, timezoneName = TOKYO_TZ) {
    const start = dayjs(startDate).tz(timezoneName);
    return Array.from({ length: Number(days || 0) }, (_, index) => start.add(index, "day").format("YYYY-MM-DD"));
}

function buildWeeklyCalendarRows(dailyRows = []) {
    const buckets = new Map();

    dailyRows.forEach((row) => {
        const weekStart = dayjs(row.date).startOf("week").format("YYYY-MM-DD");
        const weekEnd = dayjs(row.date).startOf("week").add(6, "day").format("YYYY-MM-DD");
        const key = `${weekStart}__${row.building}`;

        if (!buckets.has(key)) {
            buckets.set(key, {
                weekStart,
                weekEnd,
                building: row.building,
                cleaningCountWeekly: 0,
                settingCountWeekly: 0,
                turnoverCountWeekly: 0,
                totalWorkHoursWeekly: 0,
                mathMinHeadcountPeak: 0,
                operationalMinHeadcountPeak: 0,
                minHeadcountPeak: 0,
                recommendedHeadcountPeak: 0,
                estimatedLaborCostBaseWeekly: 0,
            });
        }

        const bucket = buckets.get(key);
        bucket.cleaningCountWeekly += Number(row.cleaningCount || 0);
        bucket.settingCountWeekly += Number(row.settingCount || 0);
        bucket.turnoverCountWeekly += Number(row.turnoverCount || 0);
        bucket.totalWorkHoursWeekly += Number(row.estimatedWorkHours || row.estimatedJobHours || 0);
        bucket.mathMinHeadcountPeak = Math.max(bucket.mathMinHeadcountPeak, Number(row.mathMinHeadcount || 0));
        bucket.operationalMinHeadcountPeak = Math.max(bucket.operationalMinHeadcountPeak, Number(row.operationalMinHeadcount || row.minHeadcount || 0));
        bucket.minHeadcountPeak = bucket.operationalMinHeadcountPeak;
        bucket.recommendedHeadcountPeak = Math.max(bucket.recommendedHeadcountPeak, Number(row.recommendedHeadcount || 0));
        bucket.estimatedLaborCostBaseWeekly += Number(row.estimatedLaborCostBase || 0);
    });

    return Array.from(buckets.values()).sort((a, b) => {
        if (a.weekStart !== b.weekStart) return a.weekStart.localeCompare(b.weekStart);
        return a.building.localeCompare(b.building);
    });
}

module.exports = {
    TOKYO_TZ,
    DEFAULT_WAGE_SCENARIOS,
    DEFAULT_BUILDING_RULES,
    DEFAULT_EXCLUDED_BUILDING_ALIASES,
    toDateKey,
    normalizeText,
    createBuildingResolver,
    buildCleaningSettingCalendarDay,
    summarizeTasksByBuilding,
    calculateCapacityHeadcount,
    enrichCapacityRows,
    estimateLaborCost,
    addLaborCostScenarios,
    buildDailyCalendarRows,
    buildWeeklyCalendarRows,
    buildDateRange,
};
