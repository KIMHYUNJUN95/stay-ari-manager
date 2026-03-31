const {
    buildRevenueDashboardSnapshot,
    fetchConfirmedReservations
} = require("./revenueDashboardData");

const TARGET_SHEET_TITLE = "당월+3개월 매출목표";
const TARGET_MONTH_COUNT = 4;
const SUMMARY_LABEL_COLUMNS = 2;
const SUMMARY_BLOCK_WIDTH = 4;
const SCENARIO_LABEL_COLUMNS = 2;
const SCENARIO_MONTH_BLOCK_WIDTH = 2;
const SCENARIO_SEPARATOR_WIDTH = 1;
const PRICING_PANEL_BLOCK_WIDTH = TARGET_MONTH_COUNT + 1;
const PRICING_PANEL_SEPARATOR_WIDTH = 1;
const EXCLUDED_BUILDINGS = Object.freeze(["사노시", "다이쿄초"]);
const SHEET_COLUMNS = SUMMARY_LABEL_COLUMNS + (TARGET_MONTH_COUNT * SUMMARY_BLOCK_WIDTH);
const SUMMARY_MONTH_RANGES = Object.freeze(
    Array.from({ length: TARGET_MONTH_COUNT }, (_, index) => {
        const start = SUMMARY_LABEL_COLUMNS + (index * SUMMARY_BLOCK_WIDTH);
        return { start, end: start + SUMMARY_BLOCK_WIDTH };
    })
);
const SUMMARY_MONTH_START_COLUMNS = Object.freeze(SUMMARY_MONTH_RANGES.map((range) => range.start));
const SCENARIO_MONTH_RANGES = Object.freeze(
    Array.from({ length: TARGET_MONTH_COUNT }, (_, index) => {
        const start = SCENARIO_LABEL_COLUMNS + (index * (SCENARIO_MONTH_BLOCK_WIDTH + SCENARIO_SEPARATOR_WIDTH));
        return { start, end: start + SCENARIO_MONTH_BLOCK_WIDTH };
    })
);
const SCENARIO_SEPARATOR_COLUMNS = Object.freeze(
    SCENARIO_MONTH_RANGES
        .map((range) => range.end)
        .filter((columnIndex) => columnIndex < SHEET_COLUMNS)
);
const SCENARIO_NOTES_START_COLUMN = SCENARIO_SEPARATOR_COLUMNS[SCENARIO_SEPARATOR_COLUMNS.length - 1] + 1;
const PRICING_PANEL_START_COLUMNS = Object.freeze(
    Array.from({ length: 3 }, (_, index) => index * (PRICING_PANEL_BLOCK_WIDTH + PRICING_PANEL_SEPARATOR_WIDTH))
);
const PRICING_SEPARATOR_COLUMNS = Object.freeze(
    PRICING_PANEL_START_COLUMNS
        .slice(1)
        .map((startColumn) => startColumn - 1)
);
const PRICING_PANEL_RANGES = Object.freeze([
    { start: PRICING_PANEL_START_COLUMNS[0], end: PRICING_SEPARATOR_COLUMNS[0] },
    { start: PRICING_PANEL_START_COLUMNS[1], end: PRICING_SEPARATOR_COLUMNS[1] },
    { start: PRICING_PANEL_START_COLUMNS[2], end: SHEET_COLUMNS }
]);
const TOP_HEADER_RANGES = Object.freeze([
    { start: 0, end: 6 },
    { start: 6, end: 12 },
    { start: 12, end: SHEET_COLUMNS }
]);
const COUNTRY_SEASON_TOP_N = 5;
const COUNTRY_SEASON_MONTHS_BACK = 3;
const ROOM_REV_YOY_SPIKE = 2.8;
const ROOM_REV_YOY_DROP = 0.25;
const ROOM_REV_MIN_COMPARE = 50000;
const NEW_ROOM_LOW_REV_YEN = 8000;
const CURRENT_ADR_OCCUPANCY_LEVELS = Object.freeze([30, 40, 50, 60, 70, 75, 80, 85, 90, 95]);
const SCENARIO_UNCERTAINTY_SCALE = Object.freeze({ 0: 1.0, 1: 1.5, 2: 2.2, 3: 2.8 });
function getScenarioDeltas(monthOffset) {
    const scale = SCENARIO_UNCERTAINTY_SCALE[Math.min(Math.max(monthOffset, 0), 3)] || 2.8;
    return {
        conservative: { occDelta: roundPct(-3 * scale), adrFactor: Number((1 - 0.05 * scale).toFixed(3)), label: "보수 목표" },
        base: { occDelta: 0, adrFactor: 1, label: "기준 목표" },
        aggressive: { occDelta: roundPct(3 * scale), adrFactor: Number((1 + 0.05 * scale).toFixed(3)), label: "공격 목표" }
    };
}
const OFFICIAL_MARKET_SEASON_PROFILES = Object.freeze({
    "대한민국": {
        peakMonths: [3, 4, 5, 8, 10],
        shoulderMonths: [1, 2, 7, 9, 12],
        offMonths: [6, 11],
        source: "JNTO 한국인 방일 월별 통계, 한국관광공사 공휴일·설/추석 안내",
        note: "벚꽃(3-4월)·5월 연휴·여름방학(7-8월)·추석·단풍(10월) 수요"
    },
    "대만": {
        peakMonths: [1, 2, 4, 7, 8, 10],
        shoulderMonths: [3, 5, 6, 9, 12],
        offMonths: [11],
        source: "JNTO 대만인 방일 월별 통계, 대만 행정원 공휴일 안내",
        note: "춘절·청명·여름방학(7-8월)·국경절·단풍 수요"
    },
    "홍콩": {
        peakMonths: [2, 4, 7, 10, 12],
        shoulderMonths: [1, 3, 5, 6, 8, 9, 11],
        offMonths: [],
        source: "홍콩 정부 공휴일 및 홍콩관광청 행사 자료, JNTO 홍콩 방일 통계",
        note: "춘절·부활절·여름방학·국경절·연말 수요 집중, 연중 고른 수요"
    },
    "태국": {
        peakMonths: [1, 4, 10, 12],
        shoulderMonths: [2, 3, 5, 9],
        offMonths: [6, 7, 8, 11],
        source: "JNTO 태국인 방일 월별 통계, 태국관광청 Songkran·학교방학 자료",
        note: "송끄란(4월)·학교방학(10월)·연말연시 수요, 화교 춘절 수요 포함"
    },
    "호주": {
        peakMonths: [1, 4, 7, 10, 12],
        shoulderMonths: [2, 3, 6, 9, 11],
        offMonths: [5, 8],
        source: "JNTO 호주인 방일 월별 통계, 호주 주별 학교방학·공휴일 자료",
        note: "여름방학(12-1월)·부활절·겨울방학(7월)·봄방학(10월) 수요"
    },
    "미국": {
        peakMonths: [3, 4, 7, 10, 12],
        shoulderMonths: [5, 6, 9, 11],
        offMonths: [1, 2, 8],
        source: "JNTO 미국인 방일 월별 통계, USAGov 연방 공휴일 자료",
        note: "Spring Break+벚꽃(3-4월)·여름방학(6-7월)·단풍(10월)·연말 수요"
    }
});

function roundNumber(value) {
    return Math.round(Number(value || 0));
}

function roundPct(value) {
    return Number(Number(value || 0).toFixed(1));
}

function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, Number(value || 0)));
}

function average(values) {
    const valid = (values || []).filter((value) => Number.isFinite(Number(value)));
    if (valid.length === 0) return 0;
    return valid.reduce((sum, value) => sum + Number(value || 0), 0) / valid.length;
}

function weightedAverage(entries, fallback = 0) {
    const valid = (entries || []).filter((entry) => Number(entry?.weight || 0) > 0 && Number.isFinite(Number(entry?.value)));
    if (valid.length === 0) return Number(fallback || 0);
    const totalWeight = valid.reduce((sum, entry) => sum + Number(entry.weight || 0), 0);
    if (totalWeight <= 0) return Number(fallback || 0);
    return valid.reduce((sum, entry) => sum + (Number(entry.value || 0) * Number(entry.weight || 0)), 0) / totalWeight;
}

function formatCurrency(value) {
    return `¥${roundNumber(value).toLocaleString("en-US")}`;
}

function formatPct(value) {
    return `${roundPct(value)}%`;
}

function asPlainText(value) {
    return `'${String(value ?? "")}`;
}

function formatSignedPct(value) {
    const numeric = roundPct(value);
    return `${numeric >= 0 ? "+" : ""}${numeric}%p`;
}

function formatSignedPercent(value) {
    const numeric = roundPct(value);
    return `${numeric >= 0 ? "+" : ""}${numeric}%`;
}

function formatMoneyDelta(value) {
    const numeric = roundNumber(value);
    return `${numeric >= 0 ? "+" : "-"}¥${Math.abs(numeric).toLocaleString("en-US")}`;
}

function getExpectedRevenueAtOccupancy(monthSummary, occupancyPct, adr = 0) {
    const supplyRoomNights = Number(monthSummary?.supplyRoomNights || 0);
    const effectiveAdr = Number(adr || monthSummary?.onBooksAdr || monthSummary?.targetAdr || 0);
    const occupiedRoomNights = roundNumber(supplyRoomNights * (Number(occupancyPct || 0) / 100));
    return roundNumber(occupiedRoomNights * effectiveAdr);
}

function buildPricingGuidance(monthSummary) {
    const occupancyGapPct = roundPct(Number(monthSummary?.onBooksOccupancyPct || 0) - Number(monthSummary?.targetOccupancyPct || 0));
    const adrGapPct = Number(monthSummary?.targetAdr || 0) > 0
        ? roundPct((((Number(monthSummary?.onBooksAdr || 0) - Number(monthSummary?.targetAdr || 0)) / Number(monthSummary?.targetAdr || 0)) * 100))
        : 0;

    if (occupancyGapPct <= -10 && adrGapPct >= 3) {
        return { occupancyGapPct, adrGapPct, pricingStatus: "현재 가격 높음", actionText: "비수요일 인하 검토" };
    }
    if (occupancyGapPct <= -10 && adrGapPct <= -3) {
        return { occupancyGapPct, adrGapPct, pricingStatus: "가격 보완 필요", actionText: "가격 유지, 노출/조건 점검" };
    }
    if (occupancyGapPct <= -5 && adrGapPct >= 0) {
        return { occupancyGapPct, adrGapPct, pricingStatus: "소폭 고가 가능성", actionText: "잔여일 탄력 인하 검토" };
    }
    if (occupancyGapPct >= 0 && adrGapPct <= -3) {
        return { occupancyGapPct, adrGapPct, pricingStatus: "인상 여지", actionText: "주말/피크일 소폭 인상 검토" };
    }
    if (occupancyGapPct >= 0 && adrGapPct >= 3) {
        return { occupancyGapPct, adrGapPct, pricingStatus: "고단가 유지 가능", actionText: "현재 가격 유지" };
    }
    return { occupancyGapPct, adrGapPct, pricingStatus: "목표권", actionText: "현재 가격 유지" };
}

function padRow(values) {
    const row = [...values];
    while (row.length < SHEET_COLUMNS) row.push("");
    return row.slice(0, SHEET_COLUMNS);
}

function createEmptyRow() {
    return Array.from({ length: SHEET_COLUMNS }, () => "");
}

function fillRowSegment(row, startColumn, endColumn, values = []) {
    const width = Math.max(0, endColumn - startColumn);
    for (let index = 0; index < width; index += 1) {
        row[startColumn + index] = values[index] ?? "";
    }
    return row;
}

function buildTripleBlockRow(leftValues = [], middleValues = [], rightValues = []) {
    const row = createEmptyRow();
    fillRowSegment(row, PRICING_PANEL_RANGES[0].start, PRICING_PANEL_RANGES[0].end, leftValues);
    fillRowSegment(row, PRICING_PANEL_RANGES[1].start, PRICING_PANEL_RANGES[1].end, middleValues);
    fillRowSegment(row, PRICING_PANEL_RANGES[2].start, PRICING_PANEL_RANGES[2].end, rightValues);
    return row;
}

function buildScenarioOverviewRow(leftLabel, metricLabel, monthPairs = [], noteText = "") {
    const row = createEmptyRow();
    row[0] = leftLabel;
    row[1] = metricLabel;
    SCENARIO_MONTH_RANGES.forEach((range, index) => {
        const pair = monthPairs[index] || [];
        row[range.start] = pair[0] ?? "";
        row[range.start + 1] = pair[1] ?? "";
    });
    row[SCENARIO_NOTES_START_COLUMN] = noteText;
    return row;
}

function buildThreeMonthSummaryRow(label, values = []) {
    const row = createEmptyRow();
    row[0] = label;
    SUMMARY_MONTH_START_COLUMNS.forEach((startColumn, index) => {
        row[startColumn] = values[index] ?? "";
    });
    return row;
}

function getTargetYearMonths(tokyoNow) {
    return Array.from({ length: TARGET_MONTH_COUNT }, (_, index) => tokyoNow.startOf("month").add(index, "month").format("YYYY-MM"));
}

function getRecentYearMonths(tokyoNow) {
    return Array.from({ length: 3 }, (_, index) => tokyoNow.startOf("month").subtract(3 - index, "month").format("YYYY-MM"));
}

function getYearMonthLabel(dayjs, yearMonth) {
    return dayjs(`${yearMonth}-01`).format("YYYY년 M월");
}

function getSeasonTier(monthNumber) {
    if (monthNumber === 12) return 0;
    if (monthNumber === 4) return 1;
    if (monthNumber === 5 || monthNumber === 10) return 2;
    if (monthNumber === 3 || monthNumber === 6) return 3;
    if ([7, 8, 9, 11].includes(monthNumber)) return 4;
    return 5;
}

function getSeasonTierSummary(monthNumber) {
    const tier = getSeasonTier(monthNumber);
    const noteMap = {
        0: "연휴 초성수기",
        1: "벚꽃 피크",
        2: "강수요 시즌",
        3: "준성수기",
        4: "휴일기 가수요",
        5: "동절기 비수기"
    };
    return {
        tier,
        label: `Tier ${tier}`,
        note: noteMap[tier] || "일반 시즌"
    };
}

function getSeasonAdjustment(monthNumber) {
    const tier = getSeasonTier(monthNumber);
    switch (tier) {
    case 0:
        return { occDelta: 2.2, adrPct: 10 };
    case 1:
        return { occDelta: 1.6, adrPct: 7 };
    case 2:
        return { occDelta: 1.0, adrPct: 4 };
    case 3:
        return { occDelta: 0.3, adrPct: 1.5 };
    case 4:
        return { occDelta: -0.7, adrPct: -1.5 };
    case 5:
    default:
        return { occDelta: -1.6, adrPct: -4 };
    }
}

function buildBookingCreatedCounts(allReservations, targetMonths) {
    const targetSet = new Set(targetMonths);
    const counts = {};
    (allReservations || []).forEach((reservation) => {
        const building = String(reservation?.building || "").trim();
        if (!building || EXCLUDED_BUILDINGS.includes(building)) return;
        const monthKey = String(reservation?.bookDate || reservation?.firstNight || "").slice(0, 7);
        if (!targetSet.has(monthKey)) return;
        if (!counts[monthKey]) counts[monthKey] = {};
        counts[monthKey][building] = (counts[monthKey][building] || 0) + 1;
    });
    return counts;
}

function buildObservedRoomCounts(allReservations, targetMonths) {
    const targetSet = new Set(targetMonths);
    const roomSets = {};
    (allReservations || []).forEach((reservation) => {
        const building = String(reservation?.building || "").trim();
        if (!building || EXCLUDED_BUILDINGS.includes(building)) return;
        const roomName = String(reservation?.room || reservation?.roomName || "").trim();
        if (!roomName) return;
        const arrival = String(reservation?.arrival || "");
        const departure = String(reservation?.departure || "");
        if (!arrival || !departure) return;

        targetMonths.forEach((yearMonth) => {
            if (!targetSet.has(yearMonth)) return;
            const monthStart = `${yearMonth}-01`;
            const monthEnd = `${yearMonth}-31`;
            if (departure <= monthStart || arrival > monthEnd) return;
            if (!roomSets[yearMonth]) roomSets[yearMonth] = {};
            if (!roomSets[yearMonth][building]) roomSets[yearMonth][building] = new Set();
            roomSets[yearMonth][building].add(roomName);
        });
    });
    return roomSets;
}

function getBuildingMap(snapshot) {
    return new Map((snapshot?.buildingStats || []).map((item) => [item.building, item]));
}

function getPeerBenchmark(buildingName, recentSnapshots, snapshotMap, yearMonth) {
    const targetStat = getBuildingMap(snapshotMap[yearMonth]).get(buildingName);
    if (!targetStat) {
        return { occupancyPct: 60, adr: 12000, source: "전체 평균" };
    }

    const peerRows = [];
    recentSnapshots.forEach((snapshot) => {
        (snapshot?.buildingStats || []).forEach((stat) => {
            if (stat.building === buildingName) return;
            if (stat.bucket !== targetStat.bucket) return;
            if (stat.roomCount <= 0) return;
            peerRows.push(stat);
        });
    });

    if (peerRows.length === 0) {
        recentSnapshots.forEach((snapshot) => {
            (snapshot?.buildingStats || []).forEach((stat) => {
                if (stat.building === buildingName || stat.roomCount <= 0) return;
                peerRows.push(stat);
            });
        });
    }

    return {
        occupancyPct: average(peerRows.map((stat) => stat.occupancyPct)),
        adr: roundNumber(average(peerRows.map((stat) => stat.adr))),
        source: peerRows.length > 0 ? `${targetStat.buildingType} 유사 자산 가중 평균` : "전체 평균"
    };
}

function getRoomNames(buildingStat) {
    return new Set((buildingStat?.rooms || []).map((room) => String(room?.room || "").trim()).filter(Boolean));
}

function getRoomRevenueShare(buildingStat, roomNames) {
    const targetSet = new Set(roomNames || []);
    const revenue = (buildingStat?.rooms || [])
        .filter((room) => targetSet.has(String(room?.room || "").trim()))
        .reduce((sum, room) => sum + Number(room?.revenue || 0), 0);
    const totalRevenue = Number(buildingStat?.revenue || 0);
    return totalRevenue > 0 ? roundPct((revenue / totalRevenue) * 100) : 0;
}

function getRoomRevenueByName(buildingStat) {
    const map = {};
    (buildingStat?.rooms || []).forEach((room) => {
        const name = String(room?.room || "").trim();
        if (!name) return;
        map[name] = Number(room?.revenue || 0);
    });
    return map;
}

function normalizeReservationCountry(reservation) {
    const c1 = String(reservation?.guestCountry || "").trim();
    const c2 = String(reservation?.guestCountry2 || "").trim();
    const raw = (c1 || c2).toUpperCase();
    if (!raw) return "신원미상";


    const countryMap = {
        KR: "대한민국", KOREA: "대한민국", "SOUTH KOREA": "대한민국", KOR: "대한민국", KO: "대한민국",
        JP: "일본", JAPAN: "일본", JPN: "일본",
        CN: "중국", CHINA: "중국", CHN: "중국",
        TW: "대만", TAIWAN: "대만",
        HK: "홍콩", "HONG KONG": "홍콩",
        MO: "마카오", MACAU: "마카오",
        US: "미국", USA: "미국", "UNITED STATES": "미국",
        CA: "캐나다", CANADA: "캐나다",
        AU: "호주", AUSTRALIA: "호주",
        GB: "영국", UK: "영국", "UNITED KINGDOM": "영국",
        FR: "프랑스", FRANCE: "프랑스",
        DE: "독일", GERMANY: "독일",
        IT: "이탈리아", ITALY: "이탈리아",
        ES: "스페인", SPAIN: "스페인",
        NL: "네덜란드", NETHERLANDS: "네덜란드",
        BE: "벨기에", BELGIUM: "벨기에",
        CH: "스위스", SWITZERLAND: "스위스",
        AT: "오스트리아", AUSTRIA: "오스트리아",
        SE: "스웨덴", SWEDEN: "스웨덴",
        NO: "노르웨이", NORWAY: "노르웨이",
        DK: "덴마크", DENMARK: "덴마크",
        FI: "핀란드", FINLAND: "핀란드",
        SG: "싱가포르", SINGAPORE: "싱가포르",
        MY: "말레이시아", MALAYSIA: "말레이시아",
        TH: "태국", THAILAND: "태국",
        VN: "베트남", VIETNAM: "베트남",
        PH: "필리핀", PHILIPPINES: "필리핀",
        ID: "인도네시아", INDONESIA: "인도네시아",
        IN: "인도", INDIA: "인도",
        AE: "아랍에미리트", UAE: "아랍에미리트",
        RU: "러시아", RUSSIA: "러시아",
        BR: "브라질", BRAZIL: "브라질",
        MX: "멕시코", MEXICO: "멕시코",
        NZ: "뉴질랜드", "NEW ZEALAND": "뉴질랜드"
    };


    if (countryMap[raw]) return countryMap[raw];

    if (/^[A-Z]{2}$/.test(raw)) {
        try {
            const dn = new Intl.DisplayNames(["ko"], { type: "region" });
            const name = dn.of(raw);
            if (name && name !== raw) {
                if (name === "ko" || name === "KO") return "대한민국";
                return name;
            }
        } catch (_) {
            // noop
        }
    }

    if (raw === "KO") return "대한민국";
    return raw;
}

function parseTokyoDay(dateStr, dayjs) {
    const s = String(dateStr || "").slice(0, 10);
    if (!s) return null;
    if (typeof dayjs.tz === "function") {
        const d = dayjs.tz(s, "Asia/Tokyo").startOf("day");
        return d.isValid() ? d : null;
    }
    const d = dayjs(s).startOf("day");
    return d.isValid() ? d : null;
}

function forEachStayNight(arrival, departure, dayjs, visitor) {
    let cur = parseTokyoDay(arrival, dayjs);
    const end = parseTokyoDay(departure, dayjs);
    if (!cur || !end) return;
    while (cur.isBefore(end, "day")) {
        visitor(cur);
        cur = cur.add(1, "day");
    }
}

function formatMonthBucket(months = []) {
    const sorted = [...new Set((months || []).map((m) => Number(m)).filter((m) => m >= 1 && m <= 12))].sort((a, b) => a - b);
    if (sorted.length === 0) return "없음";
    const groups = [];
    let start = sorted[0];
    let end = sorted[0];
    for (let i = 1; i < sorted.length; i += 1) {
        if (sorted[i] === end + 1) {
            end = sorted[i];
            continue;
        }
        groups.push(start === end ? `${start}월` : `${start}-${end}월`);
        start = sorted[i];
        end = sorted[i];
    }
    groups.push(start === end ? `${start}월` : `${start}-${end}월`);
    return groups.join(", ");
}

function getFallbackCountrySeasonProfile(monthMap = {}) {
    const months = Array.from({ length: 12 }, (_, index) => ({
        month: index + 1,
        nights: Number(monthMap[index + 1] || 0)
    }));
    const ranked = [...months].sort((a, b) => b.nights - a.nights);
    const peakMonths = ranked.slice(0, 4).map((item) => item.month).sort((a, b) => a - b);
    const offMonths = ranked.slice(-4).map((item) => item.month).sort((a, b) => a - b);
    const shoulderMonths = months
        .map((item) => item.month)
        .filter((month) => !peakMonths.includes(month) && !offMonths.includes(month))
        .sort((a, b) => a - b);

    return {
        peakMonths,
        shoulderMonths,
        offMonths,
        source: "최근 3개월 대상 숙박박수 분포 기준",
        note: "공식 판매 미래 예약 확보"
    };
}

function resolveCountrySeasonProfile(countryName, monthMap = {}) {
    const official = OFFICIAL_MARKET_SEASON_PROFILES[countryName];
    if (official) return official;
    return getFallbackCountrySeasonProfile(monthMap);
}

function computeCountryMarketSeasonality(allReservations, dayjs, tokyoNow) {
    const rangeEnd = tokyoNow.endOf("day");
    const rangeStart = tokyoNow.subtract(COUNTRY_SEASON_MONTHS_BACK, "month").startOf("day");
    const byCountryMonth = {};
    let unknownNights = 0;

    (allReservations || []).forEach((reservation) => {
        if (String(reservation?.status || "").trim() !== "confirmed") return;
        const building = String(reservation?.building || "").trim();
        if (!building || EXCLUDED_BUILDINGS.includes(building)) return;

        const country = normalizeReservationCountry(reservation);
        forEachStayNight(reservation?.arrival, reservation?.departure, dayjs, (d) => {
            if (d.isBefore(rangeStart, "day") || d.isAfter(rangeEnd, "day")) return;
            const monthNum = d.month() + 1;
            if (country === "신원미상") {
                unknownNights += 1;
                return;
            }
            if (!byCountryMonth[country]) byCountryMonth[country] = {};
            byCountryMonth[country][monthNum] = (byCountryMonth[country][monthNum] || 0) + 1;
        });
    });

    const countryTotals = Object.entries(byCountryMonth).map(([name, monthMap]) => ({
        name,
        monthMap,
        total: Object.values(monthMap).reduce((sum, n) => sum + n, 0)
    })).filter((entry) => entry.total > 0)
        .sort((a, b) => b.total - a.total);

    const knownGrandTotal = countryTotals.reduce((sum, entry) => sum + entry.total, 0);
    const allNights = knownGrandTotal + unknownNights;
    const unknownSharePct = allNights > 0 ? roundPct((unknownNights / allNights) * 100) : 0;

    const topCountries = countryTotals.slice(0, COUNTRY_SEASON_TOP_N).map((entry, index) => {
        const profile = resolveCountrySeasonProfile(entry.name, entry.monthMap);
        return {
            rank: index + 1,
            name: entry.name,
            totalNights: entry.total,
            sharePct: knownGrandTotal > 0 ? roundPct((entry.total / knownGrandTotal) * 100) : 0,
            peakText: formatMonthBucket(profile.peakMonths),
            shoulderText: formatMonthBucket(profile.shoulderMonths),
            offText: formatMonthBucket(profile.offMonths),
            sourceText: profile.source,
            noteText: profile.note
        };
    });

    return {
        basisText: `Top ${COUNTRY_SEASON_TOP_N} 국가별 최근 ${COUNTRY_SEASON_MONTHS_BACK}개월 확정예약 숙박박수 기준 · 상위 국가 각국 공식 공휴일 관광청 자료, 미래 예약 국가별 박수 분포 fallback`,
        unknownNights: roundNumber(unknownNights),
        unknownSharePct,
        allNights: roundNumber(allNights),
        topCountries
    };
}

// --- 전년 비교 보정 함수 ---

// snapshot의 rooms 배열에서 객실 이름 Set 추출 (inventory 기준)
function getInventoryRoomSet(buildingStat) {
    return new Set(
        (buildingStat?.rooms || [])
            .map(r => String(r?.room || "").trim())
            .filter(Boolean)
    );
}

// 1단계: 전년 동월 운영 상태 판정
// 반환값: "not_operated" | "insufficient_data" | "partial_operation" | "comparable"
function assessComparisonBaseline(lastYearStat, targetStat, lastYearObservedRooms) {
    if (!lastYearStat) {
        return "not_operated";
    }

    const lyRevenue = Number(lastYearStat.revenue || 0);
    const lyOccupiedNights = Number(lastYearStat.occupiedRoomNights || 0);
    const lyTotalNights = Number(lastYearStat.totalRoomNights || 0);
    const lyRoomCount = Number(lastYearStat.roomCount || 0);
    const lyObservedCount = lastYearObservedRooms ? lastYearObservedRooms.size : 0;
    const curRoomCount = Number(targetStat?.roomCount || 0);

    if (lyRevenue <= 0 && lyOccupiedNights <= 0) {
        return "not_operated";
    }

    if (lyTotalNights <= 0 || lyRoomCount <= 0) {
        return "not_operated";
    }

    if (lyObservedCount === 0) {
        return "insufficient_data";
    }

    const lyOccupancyPct = lyTotalNights > 0 ? (lyOccupiedNights / lyTotalNights) * 100 : 0;

    // 극단적으로 낮은 가동률(5% 미만)이면서 매출도 미미하면 부분 운영
    if (lyOccupancyPct < 5 && lyRevenue < 50000) {
        return "partial_operation";
    }

    // 전년 동월 관측 객실이 현재 객실의 절반 미만이면 부분 운영
    if (curRoomCount > 0 && lyObservedCount > 0 && lyObservedCount < curRoomCount * 0.5) {
        return "partial_operation";
    }

    if (lyOccupancyPct < 10 && curRoomCount > 0 && lyObservedCount < curRoomCount * 0.7) {
        return "insufficient_data";
    }

    return "comparable";
}
    // lastYearStat.rooms는 현재 BUILDING_ROOMS 기준으로 미리 채워질 수 있어 inventory 이름만으로 전년 존재를 확정하지 않는다.
// 2단계: 전년 동월에 실제로 없던 객실 감지
// lastYearStat.rooms는 현재 BUILDING_ROOMS 기준으로 미리 채워져 있으므로
// 반환: { confirmedNew: [...], possibleNew: [...] }
//   confirmedNew: 전년 inventory에도 없고 observed/revenue도 없음 = 확실한 신규
//   possibleNew: 전년 inventory에 이름은 있지만 observed/revenue 실적 없음 = 가짜 inventory 가능성
function detectNewRoomSignals(currentObservedRooms, lastYearStat, lastYearObservedRooms) {
    if (!currentObservedRooms || currentObservedRooms.size === 0) {
        return { confirmedNew: [], possibleNew: [] };
    }
    const lyObserved = lastYearObservedRooms || new Set();
    const lyRevenueMap = getRoomRevenueByName(lastYearStat);
    const lyInventory = getInventoryRoomSet(lastYearStat);

    const confirmedNew = [];
    const possibleNew = [];

    for (const name of currentObservedRooms) {
        const wasObserved = lyObserved.has(name);
        const hadRevenue = (lyRevenueMap[name] || 0) > 0;

        if (wasObserved || hadRevenue) {
            // 전년에 관측되었거나 매출이 있었으면 신규가 아님
            continue;
        }

        const inInventory = lyInventory.has(name);

        if (!inInventory) {
            // 전년 inventory에도 없고 observed/revenue도 없음 = 확실한 신규
            confirmedNew.push(name);
        } else {
            // inventory에 이름이 있지만 매출 실적 없음
            // BUILDING_ROOMS 기준 가짜 채움일 수 있으므로 확정하지 않음
            possibleNew.push(name);
        }
    }

    return { confirmedNew, possibleNew };
}

// 3단계: 매출 급변 객실 감지
// 비교 대상: 전년에 실제 운영 실적(observed 또는 revenue)이 있는 객실 중
// (현재 observed에 없어도 비교 대상 포함 = 매출 0 급감 감지 목적)
function detectRevenueOutliers(targetStat, lastYearStat, currentObservedRooms, lastYearObservedRooms, excludeRoomNames) {
    const currMap = getRoomRevenueByName(targetStat);
    const lastMap = getRoomRevenueByName(lastYearStat);
    const curInventory = getInventoryRoomSet(targetStat);
    const curObserved = currentObservedRooms || new Set();
    const lyObserved = lastYearObservedRooms || new Set();
    const excludeSet = new Set(excludeRoomNames || []);

    // 전년에 실제 운영 실적이 있는 객실 목록 (observed 또는 매출 > 0)
    const lyActiveRooms = new Set();
    for (const name of lyObserved) lyActiveRooms.add(name);
    for (const [name, rev] of Object.entries(lastMap)) {
        if (rev > 0) lyActiveRooms.add(name);
    }

    // 비교 대상: 전년 active + 현재 inventory 또는 observed에 존재, 신규 제외
    const candidateSet = new Set();
    for (const name of lyActiveRooms) {
        if (excludeSet.has(name)) continue;
        if (curInventory.has(name) || curObserved.has(name)) candidateSet.add(name);
    }

    const spikes = [];
    const drops = [];

    candidateSet.forEach(name => {
        const curRev = currMap[name] || 0;
        const lyRev = lastMap[name] || 0;
            // 양쪽 모두 미달 적으면 노이즈이므로 제외
        if (curRev < ROOM_REV_MIN_COMPARE && lyRev < ROOM_REV_MIN_COMPARE) return;
        // 급등
        if (lyRev >= ROOM_REV_MIN_COMPARE && curRev > lyRev * ROOM_REV_YOY_SPIKE) {
            spikes.push(name);
        } else if (lyRev < ROOM_REV_MIN_COMPARE && curRev >= ROOM_REV_MIN_COMPARE) {
            spikes.push(name);
        }
        // 급감
        if (lyRev >= ROOM_REV_MIN_COMPARE && curRev < lyRev * ROOM_REV_YOY_DROP) {
            drops.push(name);
        } else if (curRev < ROOM_REV_MIN_COMPARE && lyRev >= ROOM_REV_MIN_COMPARE) {
            drops.push(name);
        }
    });

    return { spikes, drops };
}

function summarizeBuildingDiagnosis(buildingStat) {
    const weightedScoreMap = {
        "지속 성장": 6,
        "상승 가능성": 4,
        "안정": 1,
        "초기운영": 1,
        "장기공백": 0,
        "판단 유보": 0,
        "고평가 가능성": -4,
        "하락과 주의": -5,
        "수요 부족/침체 문제": -6
    };
    const diagnosisCounts = {};
    (buildingStat?.rooms || []).forEach((room) => {
        const diagnosis = String(room?.diagnosis || "판단 유보");
        diagnosisCounts[diagnosis] = (diagnosisCounts[diagnosis] || 0) + 1;
    });

    const dominantDiagnosis = Object.entries(diagnosisCounts)
        .sort((a, b) => {
            const diff = (b[1] || 0) - (a[1] || 0);
            if (diff !== 0) return diff;
            return (weightedScoreMap[b[0]] || 0) - (weightedScoreMap[a[0]] || 0);
        })[0]?.[0] || "판단 유보";

    const score = average((buildingStat?.rooms || []).map((room) => weightedScoreMap[String(room?.diagnosis || "판단 유보")] || 0));

    return {
        dominantDiagnosis,
        adrAdjustmentPct: clampNumber(score, -6, 4)
    };
}

// 상태값별 색상 정의 (전년 비교 컬럼용)
const COMPARISON_STATUS_COLORS = {
    not_operated:    { bg: { red: 0.93, green: 0.93, blue: 0.93 }, fg: { red: 0.45, green: 0.45, blue: 0.45 } },
    insufficient_data: { bg: { red: 0.96, green: 0.95, blue: 0.92 }, fg: { red: 0.50, green: 0.45, blue: 0.35 } },
    partial_operation: { bg: { red: 1.00, green: 0.97, blue: 0.88 }, fg: { red: 0.55, green: 0.42, blue: 0.10 } },
    confirmed_new:   { bg: { red: 0.88, green: 0.94, blue: 1.00 }, fg: { red: 0.10, green: 0.35, blue: 0.65 } },
    possible_new:    { bg: { red: 0.93, green: 0.91, blue: 0.98 }, fg: { red: 0.35, green: 0.28, blue: 0.55 } },
    revenue_drop:    { bg: { red: 1.00, green: 0.92, blue: 0.92 }, fg: { red: 0.65, green: 0.15, blue: 0.15 } },
    revenue_spike:   { bg: { red: 0.90, green: 0.98, blue: 0.92 }, fg: { red: 0.12, green: 0.48, blue: 0.18 } },
    mixed_signal:    { bg: { red: 1.00, green: 0.95, blue: 0.88 }, fg: { red: 0.50, green: 0.35, blue: 0.10 } },
    stable:          { bg: { red: 0.96, green: 0.98, blue: 1.00 }, fg: { red: 0.30, green: 0.40, blue: 0.55 } }
};

// buildComparisonLabel: 4가지 보정으로 전년 비교 문구 + 상태 타입 생성
// 반환: { label: string, statusType: string }
function buildComparisonLabel(buildingName, targetStat, lastYearStat, comparisonYearMonth, currentObservedRooms, lastYearObservedRooms) {
    // --- 1단계: 전년 동월 비교 가능 여부 판정 ---
    const baseline = assessComparisonBaseline(lastYearStat, targetStat, lastYearObservedRooms);

    if (baseline === "not_operated") {
        return { label: "전년 동월 미운영", statusType: "not_operated" };
    }
    if (baseline === "insufficient_data") {
        return { label: "전년 동월 데이터 부족", statusType: "insufficient_data" };
    }
    if (baseline === "partial_operation") {
        return { label: "전년 동월 부분 운영", statusType: "partial_operation" };
    }

    // --- 2단계: 전년 동월에 실제로 없던 객실 감지 ---
    const newSignals = detectNewRoomSignals(currentObservedRooms, lastYearStat, lastYearObservedRooms);
    const allNewRooms = [...newSignals.confirmedNew, ...newSignals.possibleNew];

    // --- 3단계: 매출 급변 객실 감지 ---
    const outliers = detectRevenueOutliers(targetStat, lastYearStat, currentObservedRooms, lastYearObservedRooms, allNewRooms);

    // --- 결과 조합 ---
    const signals = [];
    const statusTypes = [];

    if (newSignals.confirmedNew.length > 0) {
        const count = newSignals.confirmedNew.length;
        if (count <= 2) {
            signals.push(`신규 객실 ${count}개 (${newSignals.confirmedNew.join(", ")})`);
        } else {
            signals.push(`신규 객실 ${count}개`);
        }
        statusTypes.push("confirmed_new");
    }

    if (newSignals.possibleNew.length > 0) {
        const count = newSignals.possibleNew.length;
        if (count <= 2) {
            signals.push(`전년 미관측 객실 ${count}개 (${newSignals.possibleNew.join(", ")})`);
        } else {
            signals.push(`전년 미관측 객실 ${count}개`);
        }
        statusTypes.push("possible_new");
    }

    if (outliers.drops.length > 0) {
        signals.push(`매출 급감 객실 ${outliers.drops.length}개`);
        statusTypes.push("revenue_drop");
    }

    if (outliers.spikes.length > 0) {
        signals.push(`매출 급증 객실 ${outliers.spikes.length}개`);
        statusTypes.push("revenue_spike");
    }

    if (signals.length > 0) {
        // 우선순위: confirmed_new > possible_new > revenue_drop > revenue_spike
        const priorityOrder = ["confirmed_new", "possible_new", "revenue_drop", "revenue_spike"];
        const primaryStatus = statusTypes.length > 1
            ? (priorityOrder.find(t => statusTypes.includes(t)) || "mixed_signal")
            : statusTypes[0];
        const finalStatus = statusTypes.length > 1 ? "mixed_signal" : primaryStatus;
        return { label: signals.join(" / "), statusType: finalStatus };
    }

    // --- 4단계: fallback (이슈 없을 때만) ---
    return { label: "동일 구성 · 큰 변동 없음", statusType: "stable" };
}

function getRemainingSalesDays(dayjs, tokyoNow, yearMonth) {
    const endOfTargetMonth = dayjs(`${yearMonth}-01`).endOf("month");
    return Math.max(1, endOfTargetMonth.diff(tokyoNow.startOf("day"), "day") + 1);
}

function createScenarioSummary(monthSummary, monthOffset = 0) {
    const deltas = getScenarioDeltas(monthOffset);
    return Object.entries(deltas).map(([scenarioKey, config]) => {
        let occupancyPct = clampNumber(monthSummary.targetOccupancyPct + config.occDelta, 0, 97);
        let adr = roundNumber(monthSummary.targetAdr * config.adrFactor);
        let occupiedRoomNights = roundNumber(monthSummary.supplyRoomNights * (occupancyPct / 100));
        occupiedRoomNights = Math.max(occupiedRoomNights, monthSummary.onBooksOccupiedRoomNights || 0);
        occupancyPct = monthSummary.supplyRoomNights > 0
            ? roundPct((occupiedRoomNights / monthSummary.supplyRoomNights) * 100)
            : 0;
        let revenue = roundNumber(occupiedRoomNights * adr);
        if (revenue < Number(monthSummary.onBooksRevenue || 0)) {
            revenue = roundNumber(monthSummary.onBooksRevenue || 0);
            adr = occupiedRoomNights > 0 ? roundNumber(revenue / occupiedRoomNights) : adr;
        }
        return {
            scenarioKey,
            label: config.label,
            occupancyPct,
            adr,
            occupiedRoomNights,
            revenue
        };
    });
}

function getCurrentPointTargetRatio(monthOffset, currentElapsedRatio, depletionPaceRatio) {
    const baseRatioMap = {
        0: 0.78,
        1: 0.58,
        2: 0.26,
        3: 0.14
    };
    const minRatioMap = {
        0: 0.60,
        1: 0.38,
        2: 0.16,
        3: 0.07
    };
    const maxRatioMap = {
        0: 1.00,
        1: 0.86,
        2: 0.58,
        3: 0.38
    };
    const progressWeightMap = {
        0: 0.36,
        1: 0.08,
        2: 0.05,
        3: 0.03
    };
    const numericOffset = Number(monthOffset);
    const safeOffset = Object.prototype.hasOwnProperty.call(baseRatioMap, numericOffset)
        ? numericOffset
        : 3;
    const baseRatio = baseRatioMap[safeOffset] || 0.14;
    const progressAdj = (Number(currentElapsedRatio || 0.5) - 0.5) * (progressWeightMap[safeOffset] || 0.05);
    const paceAdj = clampNumber((Number(depletionPaceRatio || 1) - 1) * 0.12, -0.08, 0.08);

    return clampNumber(
        baseRatio + progressAdj + paceAdj,
        minRatioMap[safeOffset] || 0.07,
        maxRatioMap[safeOffset] || 0.38
    );
}

function computeFutureTargetGoalsData({ dayjs, tokyoNow, BUILDING_ROOMS, allReservations }) {
    const countrySeasonality = computeCountryMarketSeasonality(allReservations, dayjs, tokyoNow);
    const targetMonths = getTargetYearMonths(tokyoNow);
    const recentMonths = getRecentYearMonths(tokyoNow);
    const currentYearMonth = tokyoNow.format("YYYY-MM");
    const comparisonMonths = targetMonths.map((yearMonth) => dayjs(`${yearMonth}-01`).subtract(1, "year").format("YYYY-MM"));
    const observedRoomMonths = [...new Set([...targetMonths, ...comparisonMonths])];
    const lookbackDates = [7, 14].map((days) => tokyoNow.subtract(days, "day").format("YYYY-MM-DD"));
    const snapshotMonths = [...new Set([currentYearMonth, ...recentMonths, ...targetMonths, ...comparisonMonths])];

    const snapshotMap = {};
    snapshotMonths.forEach((yearMonth) => {
        snapshotMap[yearMonth] = buildRevenueDashboardSnapshot(allReservations, {
            BUILDING_ROOMS,
            forYearMonth: yearMonth,
            excludedBuildings: EXCLUDED_BUILDINGS,
            amountMode: "gross"
        });
    });

    const observedRoomCounts = buildObservedRoomCounts(allReservations, observedRoomMonths);
    const currentSnapshot = snapshotMap[currentYearMonth];
    const recentSnapshots = recentMonths.map((yearMonth) => snapshotMap[yearMonth]);
    const buildingNames = Object.keys(BUILDING_ROOMS || {}).filter((buildingName) => !EXCLUDED_BUILDINGS.includes(buildingName));
    const currentElapsedRatio = clampNumber(tokyoNow.date() / Math.max(1, tokyoNow.daysInMonth()), 0.2, 1);
    const asOfReservationSets = Object.fromEntries(lookbackDates.map((dateKey) => [
        dateKey,
        (allReservations || []).filter((reservation) => {
            const bookedAt = String(reservation?.bookDate || reservation?.firstNight || "").slice(0, 10);
            return bookedAt && bookedAt <= dateKey;
        })
    ]));

    const monthResults = targetMonths.map((yearMonth) => {
        const targetSnapshot = snapshotMap[yearMonth];
        const lastYearSnapshot = snapshotMap[dayjs(`${yearMonth}-01`).subtract(1, "year").format("YYYY-MM")];
        const lookbackSnapshots = Object.fromEntries(lookbackDates.map((dateKey) => [
            dateKey,
            buildRevenueDashboardSnapshot(asOfReservationSets[dateKey], {
                BUILDING_ROOMS,
                forYearMonth: yearMonth,
                excludedBuildings: EXCLUDED_BUILDINGS,
                amountMode: "gross"
            })
        ]));
        const targetBuildingMap = getBuildingMap(targetSnapshot);
        const lastYearBuildingMap = getBuildingMap(lastYearSnapshot);
        const lookbackBuildingMaps = Object.fromEntries(lookbackDates.map((dateKey) => [dateKey, getBuildingMap(lookbackSnapshots[dateKey])]));
        const monthNumber = Number(yearMonth.slice(5, 7));
        const monthOffset = dayjs(`${yearMonth}-01`).diff(tokyoNow.startOf("month"), "month");
        const seasonInfo = getSeasonTierSummary(monthNumber);
        const seasonAdjustment = getSeasonAdjustment(monthNumber);
        const peerCache = {};
        const comparisonYearMonth = dayjs(`${yearMonth}-01`).subtract(1, "year").format("YYYY-MM");

        const buildingGoals = buildingNames.map((buildingName) => {
            const targetStat = targetBuildingMap.get(buildingName) || {
                building: buildingName,
                buildingType: "객실형 건물",
                roomCount: 0,
                totalRoomNights: 0,
                occupiedRoomNights: 0,
                occupancyPct: 0,
                adr: 0,
                revenue: 0,
                rooms: []
            };
            const lastYearStat = lastYearBuildingMap.get(buildingName) || null;
            const currentStat = getBuildingMap(currentSnapshot).get(buildingName) || null;
            const recentStats = recentSnapshots.map((snapshot) => getBuildingMap(snapshot).get(buildingName) || null);
            const recentOccValues = recentStats.map((stat) => Number(stat?.occupancyPct || 0));
            const recentAdrValues = recentStats.map((stat) => Number(stat?.adr || 0));
            const recentRevenueValues = recentStats.map((stat) => Number(stat?.revenue || 0));
            const recentOccAvg = average(recentOccValues);
            const recentAdrAvg = average(recentAdrValues);
            const recentRevenueAvg = average(recentRevenueValues);
            const recentOccSlope = recentOccValues.length >= 2 ? (recentOccValues[recentOccValues.length - 1] - recentOccValues[0]) / Math.max(1, recentOccValues.length - 1) : 0;
            const recentAdrSlopePct = recentAdrValues.length >= 2 && recentAdrValues[0] > 0
                ? (((recentAdrValues[recentAdrValues.length - 1] - recentAdrValues[0]) / recentAdrValues[0]) * 100)
                : 0;
            const lastYearObservedRoomCount = observedRoomCounts[dayjs(`${yearMonth}-01`).subtract(1, "year").format("YYYY-MM")]?.[buildingName]?.size || 0;
            const peerBenchmark = peerCache[buildingName] || getPeerBenchmark(buildingName, recentSnapshots, snapshotMap, yearMonth);
            peerCache[buildingName] = peerBenchmark;
            const diagnosisSummary = summarizeBuildingDiagnosis(currentStat || targetStat);

            let assetClass = "동일 비교 가능 자산";
            if (!lastYearStat || (Number(lastYearStat.revenue || 0) <= 0 && Number(lastYearStat.occupiedRoomNights || 0) <= 0)) {
                assetClass = "신규 자산";
            } else if (lastYearObservedRoomCount > 0 && lastYearObservedRoomCount !== Number(targetStat.roomCount || 0)) {
                assetClass = "객실 수 변동 자산";
            }

            const recentOccBase = recentOccAvg > 0 ? recentOccAvg : peerBenchmark.occupancyPct;
            const recentAdrBase = recentAdrAvg > 0 ? recentAdrAvg : peerBenchmark.adr;
            const yoyOccBase = assetClass === "신규 자산" ? peerBenchmark.occupancyPct : Number(lastYearStat?.occupancyPct || recentOccBase);
            const yoyAdrBase = assetClass === "신규 자산" ? peerBenchmark.adr : Number(lastYearStat?.adr || recentAdrBase);

            let targetOccupancyPct = weightedAverage([
                { value: recentOccBase + (recentOccSlope * 0.6), weight: 0.45 },
                { value: yoyOccBase, weight: assetClass === "동일 비교 가능 자산" ? 0.30 : 0.20 },
                { value: Number(targetStat.occupancyPct || currentStat?.occupancyPct || recentOccBase), weight: 0.15 },
                { value: Number(targetStat.occupancyPct || 0) + seasonAdjustment.occDelta, weight: 0.10 }
            ], recentOccBase);

            targetOccupancyPct += seasonAdjustment.occDelta;
            if (assetClass === "신규 자산") targetOccupancyPct -= 1.0;
            if (assetClass === "객실 수 변동 자산") targetOccupancyPct -= 0.5;
            targetOccupancyPct = clampNumber(targetOccupancyPct, 5, 97);

            let targetAdr = weightedAverage([
                { value: recentAdrBase * (1 + (recentAdrSlopePct * 0.25 / 100)), weight: 0.45 },
                { value: yoyAdrBase, weight: assetClass === "동일 비교 가능 자산" ? 0.30 : 0.20 },
                { value: Number(currentStat?.adr || recentAdrBase), weight: 0.15 },
                { value: Number(targetStat.adr || 0) > 0 ? Number(targetStat.adr || 0) : recentAdrBase, weight: 0.10 }
            ], recentAdrBase);

            targetAdr *= 1 + ((seasonAdjustment.adrPct + diagnosisSummary.adrAdjustmentPct + (assetClass === "신규 자산" ? -3 : assetClass === "객실 수 변동 자산" ? -1.5 : 0)) / 100);
            targetAdr = roundNumber(Math.max(targetAdr, Number(targetStat.adr || 0) * 0.98 || targetAdr));

            const supplyRoomNights = Number(targetStat.totalRoomNights || 0);
            let targetOccupiedRoomNights = roundNumber(supplyRoomNights * (targetOccupancyPct / 100));
            targetOccupiedRoomNights = Math.max(targetOccupiedRoomNights, Number(targetStat.occupiedRoomNights || 0));
            targetOccupancyPct = supplyRoomNights > 0 ? roundPct((targetOccupiedRoomNights / supplyRoomNights) * 100) : 0;

            let targetRevenue = roundNumber(targetOccupiedRoomNights * targetAdr);
            if (targetRevenue < Number(targetStat.revenue || 0)) {
                targetRevenue = roundNumber(targetStat.revenue || 0);
                targetAdr = targetOccupiedRoomNights > 0 ? roundNumber(targetRevenue / targetOccupiedRoomNights) : targetAdr;
            }

            const finalTargetOccupancyPct = targetOccupancyPct;
            const finalTargetOccupiedRoomNights = targetOccupiedRoomNights;
            const finalTargetRevenue = targetRevenue;
            const finalTargetAdr = targetAdr;
            const onBooksOccupiedRoomNights = Number(targetStat.occupiedRoomNights || 0);
            const onBooksRevenue = Number(targetStat.revenue || 0);
            const remainingSupplyRoomNights = Math.max(0, supplyRoomNights - onBooksOccupiedRoomNights);
            const remainingOccupiedGap = Math.max(0, finalTargetOccupiedRoomNights - onBooksOccupiedRoomNights);
            const additionalRevenueNeeded = Math.max(0, finalTargetRevenue - onBooksRevenue);
            const lastYearRevenue = roundNumber(lastYearStat?.revenue || 0);
            const additionalRevenueVsLastYear = roundNumber(onBooksRevenue - lastYearRevenue);
            const sevenDayStat = lookbackBuildingMaps[lookbackDates[0]].get(buildingName) || null;
            const fourteenDayStat = lookbackBuildingMaps[lookbackDates[1]].get(buildingName) || null;
            const recentPickup7 = Math.max(0, onBooksOccupiedRoomNights - Number(sevenDayStat?.occupiedRoomNights || 0));
            const recentPickup14 = Math.max(0, onBooksOccupiedRoomNights - Number(fourteenDayStat?.occupiedRoomNights || 0));
            const avgDailyPickup = weightedAverage([
                { value: recentPickup7 / 7, weight: 0.65 },
                { value: recentPickup14 / 14, weight: 0.35 }
            ], recentPickup14 / 14);
            const remainingSalesDays = getRemainingSalesDays(dayjs, tokyoNow, yearMonth);
            const requiredDailyPickup = remainingOccupiedGap > 0 ? (remainingOccupiedGap / remainingSalesDays) : 0;
            const depletionPaceRatio = requiredDailyPickup > 0 ? (avgDailyPickup / requiredDailyPickup) : 1;
            const currentPointRatio = getCurrentPointTargetRatio(monthOffset, currentElapsedRatio, depletionPaceRatio);
            const targetPickupRoomNights = Math.min(
                remainingSupplyRoomNights,
                roundNumber(remainingOccupiedGap * currentPointRatio)
            );

            targetOccupiedRoomNights = onBooksOccupiedRoomNights + targetPickupRoomNights;
            targetRevenue = Math.max(
                onBooksRevenue,
                Math.min(
                    finalTargetRevenue,
                    onBooksRevenue + roundNumber(targetPickupRoomNights * finalTargetAdr)
                )
            );
            targetAdr = targetOccupiedRoomNights > 0 ? roundNumber(targetRevenue / targetOccupiedRoomNights) : finalTargetAdr;
            targetOccupancyPct = supplyRoomNights > 0 ? roundPct((targetOccupiedRoomNights / supplyRoomNights) * 100) : 0;

            const currentObservedRooms = observedRoomCounts[yearMonth]?.[buildingName] || new Set();
            const lastYearObservedRooms = observedRoomCounts[comparisonYearMonth]?.[buildingName] || new Set();
            const comparisonResult = buildComparisonLabel(buildingName, targetStat, lastYearStat, comparisonYearMonth, currentObservedRooms, lastYearObservedRooms);
            const comparisonLabel = comparisonResult.label;
            const comparisonStatusType = comparisonResult.statusType;
            const seasonLabel = `${seasonInfo.label} · ${seasonInfo.note}`;
            const positiveFactors = [];
            const negativeFactors = [];

            if (seasonAdjustment.occDelta > 0 || seasonAdjustment.adrPct > 0) {
                positiveFactors.push(`${seasonInfo.note}`);
            } else if (seasonAdjustment.occDelta < 0 || seasonAdjustment.adrPct < 0) {
                negativeFactors.push(`${seasonInfo.note}`);
            }
            if (depletionPaceRatio >= 1.1) positiveFactors.push("유입 판매 흡수 속도 양호");
            if (depletionPaceRatio <= 0.85) negativeFactors.push("유입 판매 흡수 속도 둔화");
            if (diagnosisSummary.dominantDiagnosis === "상승 가능성" || diagnosisSummary.dominantDiagnosis === "지속 성장") {
                positiveFactors.push(`가격 진정성 ${diagnosisSummary.dominantDiagnosis}`);
            }
            if (["고평가 가능성", "하락과 주의", "수요 부족/침체 문제"].includes(diagnosisSummary.dominantDiagnosis)) {
                negativeFactors.push(`가격 진정성 ${diagnosisSummary.dominantDiagnosis}`);
            }
            if (assetClass === "신규 자산") negativeFactors.push("전년 비교 불가");
            if (assetClass === "객실 수 변동 자산") negativeFactors.push("객실 수 변동 보정");

            const buildingScenarios = createScenarioSummary({
                targetOccupancyPct,
                targetAdr,
                supplyRoomNights,
                onBooksOccupiedRoomNights: roundNumber(targetStat.occupiedRoomNights || 0),
                onBooksRevenue: roundNumber(targetStat.revenue || 0)
            }, monthOffset);

            return {
                yearMonth,
                building: buildingName,
                buildingType: targetStat.buildingType,
                assetClass,
                roomCount: Number(targetStat.roomCount || 0),
                supplyRoomNights,
                targetOccupancyPct,
                targetAdr,
                targetRevenue,
                targetOccupiedRoomNights,
                finalTargetOccupancyPct,
                finalTargetAdr,
                finalTargetRevenue,
                onBooksRevenue: roundNumber(targetStat.revenue || 0),
                lastYearRevenue,
                onBooksOccupiedRoomNights: roundNumber(targetStat.occupiedRoomNights || 0),
                onBooksOccupancyPct: roundPct(targetStat.occupancyPct || 0),
                onBooksAdr: roundNumber(targetStat.adr || 0),
                remainingRoomNights: roundNumber(remainingSupplyRoomNights),
                additionalRevenueNeeded: roundNumber(additionalRevenueNeeded),
                additionalRevenueVsLastYear: roundNumber(additionalRevenueVsLastYear),
                additionalOccupiedRoomNightsNeeded: roundNumber(remainingOccupiedGap),
                recentDailyPickup: roundPct(avgDailyPickup),
                requiredDailyPickup: roundPct(requiredDailyPickup),
                comparisonLabel,
                comparisonStatusType,
                seasonLabel,
                dominantDiagnosis: diagnosisSummary.dominantDiagnosis,
                positiveFactors,
                negativeFactors,
                buildingScenarios
            };
        });

        const monthSummary = buildingGoals.reduce((acc, goal) => {
            acc.supplyRoomNights += goal.supplyRoomNights;
            acc.targetOccupiedRoomNights += goal.targetOccupiedRoomNights;
            acc.targetRevenue += goal.targetRevenue;
            acc.lastYearRevenue += Number(goal.lastYearRevenue || 0);
            return acc;
        }, {
            yearMonth,
            monthLabel: getYearMonthLabel(dayjs, yearMonth),
            seasonLabel: `${seasonInfo.label} · ${seasonInfo.note}`,
            supplyRoomNights: 0,
            targetOccupiedRoomNights: 0,
            targetRevenue: 0,
            lastYearRevenue: 0
        });

        monthSummary.targetOccupancyPct = monthSummary.supplyRoomNights > 0
            ? roundPct((monthSummary.targetOccupiedRoomNights / monthSummary.supplyRoomNights) * 100)
            : 0;
        monthSummary.targetAdr = monthSummary.targetOccupiedRoomNights > 0
            ? roundNumber(monthSummary.targetRevenue / monthSummary.targetOccupiedRoomNights)
            : 0;
        monthSummary.onBooksRevenue = buildingGoals.reduce((sum, goal) => sum + goal.onBooksRevenue, 0);
        monthSummary.onBooksOccupiedRoomNights = buildingGoals.reduce((sum, goal) => sum + goal.onBooksOccupiedRoomNights, 0);
        monthSummary.onBooksOccupancyPct = monthSummary.supplyRoomNights > 0
            ? roundPct((monthSummary.onBooksOccupiedRoomNights / monthSummary.supplyRoomNights) * 100)
            : 0;
        monthSummary.onBooksAdr = monthSummary.onBooksOccupiedRoomNights > 0
            ? roundNumber(monthSummary.onBooksRevenue / monthSummary.onBooksOccupiedRoomNights)
            : 0;
        monthSummary.remainingRoomNights = monthSummary.supplyRoomNights - monthSummary.onBooksOccupiedRoomNights;
        monthSummary.additionalRevenueNeeded = Math.max(0, monthSummary.targetRevenue - monthSummary.onBooksRevenue);
        monthSummary.additionalRevenueVsLastYear = roundNumber(monthSummary.onBooksRevenue - monthSummary.lastYearRevenue);
        monthSummary.additionalOccupiedRoomNightsNeeded = Math.max(0, monthSummary.targetOccupiedRoomNights - monthSummary.onBooksOccupiedRoomNights);
        monthSummary.scenarios = createScenarioSummary(monthSummary, monthOffset);

        const positiveLeaders = buildingGoals
            .filter((goal) => goal.positiveFactors.length > 0)
            .sort((a, b) => b.targetRevenue - a.targetRevenue)
            .slice(0, 3);
        const negativeLeaders = buildingGoals
            .filter((goal) => goal.negativeFactors.length > 0)
            .sort((a, b) => b.targetRevenue - a.targetRevenue)
            .slice(0, 3);

        monthSummary.rationale = {
            existingAssetRevenue: buildingGoals.filter((goal) => goal.assetClass === "동일 비교 가능 자산").reduce((sum, goal) => sum + goal.targetRevenue, 0),
            newAssetRevenue: buildingGoals.filter((goal) => goal.assetClass === "신규 자산").reduce((sum, goal) => sum + goal.targetRevenue, 0),
            roomChangeRevenue: buildingGoals.filter((goal) => goal.assetClass === "객실 수 변동 자산").reduce((sum, goal) => sum + goal.targetRevenue, 0),
            upwardFactorsText: positiveLeaders.map((goal) => `${goal.building}: ${goal.positiveFactors[0]}`).join(" / ") || "상향 요인 없음",
            downwardRiskText: negativeLeaders.map((goal) => `${goal.building}: ${goal.negativeFactors[0]}`).join(" / ") || "하향 리스크 없음"
        };

        return {
            monthSummary,
            buildingGoals
        };
    });

    const validation = monthResults.map(({ monthSummary, buildingGoals }) => {
        const revenueFromBuildings = roundNumber(buildingGoals.reduce((sum, goal) => sum + goal.targetRevenue, 0));
        const occupiedFromBuildings = roundNumber(buildingGoals.reduce((sum, goal) => sum + goal.targetOccupiedRoomNights, 0));
        return {
            yearMonth: monthSummary.yearMonth,
            revenueMatches: revenueFromBuildings === roundNumber(monthSummary.targetRevenue),
            occupiedMatches: occupiedFromBuildings === roundNumber(monthSummary.targetOccupiedRoomNights)
        };
    });

    return {
        generatedAt: tokyoNow.format("YYYY-MM-DD HH:mm"),
        targetMonths,
        excludedAssets: [...EXCLUDED_BUILDINGS],
        dataSources: ["Firestore reservations (totalPrice)", "Building Calendar gross revenue", "Occupancy Rate Dashboard"],
        countrySeasonality,
        monthResults,
        validation
    };
}

function buildSheetRows(reportData) {
    const rows = [];
    const sectionRows = [];
    const headerRows = [];
    const dataRanges = [];
    const spacerRows = [];
    const totalRows = [];
    const revenueRows = [];
    const currentRevenueRows = [];
    const occupancyRows = [];
    const currentOccupancyRows = [];
    const adrRows = [];
    const currentAdrRows = [];
    const mergedContentRows = [];
    const factorNarrativeRows = [];
    const validationRows = [];
    const textInsightRows = [];
    const pricingPanelTitleRows = [];
    const pricingPanelHeaderRows = [];
    const pricingBodyRanges = [];
    const overallSummaryRows = [];
    const scenarioOverviewRows = [];
    const topSummaryValueRows = [];
    const scenarioOverviewTopHeaderRows = [];
    const scenarioOverviewSubHeaderRows = [];
    const scenarioOverviewRevenueRows = [];
    const scenarioOverviewOccupancyRows = [];
    const scenarioOverviewAdrRows = [];
    const scenarioOverviewGroupStartRows = [];
    const buildingCurrencyRows = [];
    const buildingInsightRows = [];
    const scenarioMoneyRows = [];
    const buildingScenarioStyleRows = [];
    const buildingGroupStartRows = [];
    const scenarioGroupStartRows = [];
    const countrySeasonRows = [];
    const countrySeasonHeaderRows = [];
    const comparisonStatusRows = [];

    const countrySeason = reportData.countrySeasonality || {
        basisText: "",
        unknownNights: 0,
        unknownSharePct: 0,
        topCountries: []
    };

    rows.push(padRow([`당월 + 3개월 매출 목표 시트`, "", "", "", "", "", "", "", "", "", ""]));
    rows.push(padRow([
        `기준일시: ${reportData.generatedAt} JST`,
        "",
        "",
        "",
        `📊 ${reportData.targetMonths.map((yearMonth) => yearMonth.replace("-", ".")).join(", ")}`,
        "",
        "",
        "",
        `출처: ${reportData.dataSources.join(" / ")}`,
        "",
        "",
        "",
        ""
    ]));
    rows.push(padRow([""]));
    spacerRows.push(rows.length);

    sectionRows.push(rows.length + 1);
    rows.push(padRow(["상단 요약"]));
    rows.push(padRow([
        `기준일시: ${asPlainText(reportData.generatedAt)} JST`,
        "",
        "",
        "",
        "",
        `대상 4개월: ${asPlainText(reportData.targetMonths.map((yearMonth) => yearMonth.replace("-", ".")).join(" / "))}`,
        "",
        "",
        "",
        "",
        "",
        "",
        ""
    ]));
    topSummaryValueRows.push(rows.length);
    rows.push(padRow(["기준 데이터 원본", reportData.dataSources.join(" / ")]));
    mergedContentRows.push(rows.length);
    rows.push(padRow(["플랫폼 기준", "Airbnb / Booking.com 예약 기준 운영 지표"]));
    mergedContentRows.push(rows.length);
    rows.push(padRow(["금액 기준", "채널수수료 포함(totalPrice) 기준 — Revenue Dashboard 동일"]));
    mergedContentRows.push(rows.length);
    rows.push(padRow(["제외 자산", reportData.excludedAssets.join(", ")]));
    mergedContentRows.push(rows.length);
    rows.push(padRow(["시즌 티어 요약", reportData.monthResults.map((result) => `${result.monthSummary.monthLabel} ${result.monthSummary.seasonLabel}`).join(" / ")]));
    mergedContentRows.push(rows.length);
    rows.push(padRow([""]));
    spacerRows.push(rows.length);

    sectionRows.push(rows.length + 1);
    rows.push(padRow(["전체 목표 요약"]));
    headerRows.push(rows.length + 1);
    rows.push(buildThreeMonthSummaryRow("지표", reportData.monthResults.map((result) => asPlainText(result.monthSummary.monthLabel))));
    overallSummaryRows.push(rows.length);
    rows.push(buildThreeMonthSummaryRow("목표 매출액", reportData.monthResults.map((result) => formatCurrency(result.monthSummary.targetRevenue))));
    overallSummaryRows.push(rows.length);
    revenueRows.push(rows.length);
    rows.push(buildThreeMonthSummaryRow("현재 매출액", reportData.monthResults.map((result) => formatCurrency(result.monthSummary.onBooksRevenue))));
    overallSummaryRows.push(rows.length);
    currentRevenueRows.push(rows.length);
    rows.push(buildThreeMonthSummaryRow("목표 가동률", reportData.monthResults.map((result) => formatPct(result.monthSummary.targetOccupancyPct))));
    overallSummaryRows.push(rows.length);
    occupancyRows.push(rows.length);
    rows.push(buildThreeMonthSummaryRow("현재 가동률", reportData.monthResults.map((result) => formatPct(result.monthSummary.onBooksOccupancyPct))));
    overallSummaryRows.push(rows.length);
    currentOccupancyRows.push(rows.length);
    rows.push(buildThreeMonthSummaryRow("목표 ADR", reportData.monthResults.map((result) => formatCurrency(result.monthSummary.targetAdr))));
    overallSummaryRows.push(rows.length);
    adrRows.push(rows.length);
    rows.push(buildThreeMonthSummaryRow("현재 ADR", reportData.monthResults.map((result) => formatCurrency(result.monthSummary.onBooksAdr))));
    overallSummaryRows.push(rows.length);
    currentAdrRows.push(rows.length);
    rows.push(buildThreeMonthSummaryRow("공급 객실박", reportData.monthResults.map((result) => roundNumber(result.monthSummary.supplyRoomNights))));
    overallSummaryRows.push(rows.length);
    rows.push(buildThreeMonthSummaryRow("목표 점유박", reportData.monthResults.map((result) => roundNumber(result.monthSummary.targetOccupiedRoomNights))));
    overallSummaryRows.push(rows.length);
    rows.push(buildThreeMonthSummaryRow("목표 대비 가동률 갭", reportData.monthResults.map((result) => {
        const gap = roundPct(result.monthSummary.onBooksOccupancyPct - result.monthSummary.targetOccupancyPct);
        return `목표대비 ${gap >= 0 ? "+" : ""}${gap}%p`;
    })));
    overallSummaryRows.push(rows.length);
    rows.push(buildThreeMonthSummaryRow("목표 대비 ADR 갭", reportData.monthResults.map((result) => {
        const adrGapPct = Number(result.monthSummary.targetAdr || 0) > 0
            ? roundPct((((Number(result.monthSummary.onBooksAdr || 0) - Number(result.monthSummary.targetAdr || 0)) / Number(result.monthSummary.targetAdr || 0)) * 100))
            : 0;
        return `목표대비 ${adrGapPct >= 0 ? "+" : ""}${adrGapPct}%`;
    })));
    overallSummaryRows.push(rows.length);
    rows.push(buildThreeMonthSummaryRow("가격 판단", reportData.monthResults.map((result) => buildPricingGuidance(result.monthSummary).pricingStatus)));
    overallSummaryRows.push(rows.length);
    textInsightRows.push(rows.length);
    rows.push(buildThreeMonthSummaryRow("권장 액션", reportData.monthResults.map((result) => buildPricingGuidance(result.monthSummary).actionText)));
    overallSummaryRows.push(rows.length);
    textInsightRows.push(rows.length);
    rows.push(padRow([""]));
    spacerRows.push(rows.length);

    sectionRows.push(rows.length + 1);
    rows.push(padRow(["현재 ADR 기준 수익 시뮬레이션"]));
    rows.push(buildTripleBlockRow(
        ["예상 매출"],
        ["필요 점유박"],
        ["ADR 인상 효과"]
    ));
    pricingPanelTitleRows.push(rows.length);
    rows.push(buildTripleBlockRow(
        ["구분", ...reportData.monthResults.map((result) => asPlainText(result.monthSummary.monthLabel))],
        ["구분", ...reportData.monthResults.map((result) => asPlainText(result.monthSummary.monthLabel))],
        ["구분", ...reportData.monthResults.map((result) => asPlainText(result.monthSummary.monthLabel))]
    ));
    pricingPanelHeaderRows.push(rows.length);
    const pricingBodyStart = rows.length + 1;
    rows.push(buildTripleBlockRow(
        ["현재 기준", ...reportData.monthResults.map((result) => formatCurrency(result.monthSummary.onBooksRevenue))],
        ["현재 점유박", ...reportData.monthResults.map((result) => roundNumber(result.monthSummary.onBooksOccupiedRoomNights))],
        ["현재 ADR", ...reportData.monthResults.map((result) => formatCurrency(result.monthSummary.onBooksAdr))]
    ));
    currentRevenueRows.push(rows.length);
    rows.push(buildTripleBlockRow(
        ["목표 기준", ...reportData.monthResults.map((result) => formatCurrency(result.monthSummary.targetRevenue))],
        ["목표 점유박", ...reportData.monthResults.map((result) => roundNumber(result.monthSummary.targetOccupiedRoomNights))],
        [asPlainText("+5% ADR"), ...reportData.monthResults.map((result) => asPlainText(formatMoneyDelta(roundNumber(result.monthSummary.targetOccupiedRoomNights * result.monthSummary.onBooksAdr * 0.05))))]
    ));
    revenueRows.push(rows.length);
    const adrLiftRows = [
        { label: "+10% ADR", factor: 0.10 },
        { label: "+15% ADR", factor: 0.15 },
        { label: "+20% ADR", factor: 0.20 }
    ];
    const occupancyRowsData = CURRENT_ADR_OCCUPANCY_LEVELS.map((occupancyPct) => ({
        left: [`가동률 ${occupancyPct}%`, ...reportData.monthResults.map((result) => formatCurrency(getExpectedRevenueAtOccupancy(result.monthSummary, occupancyPct, result.monthSummary.onBooksAdr)))],
        middle: [`수요 자유박 ${occupancyPct}%`, ...reportData.monthResults.map((result) => roundNumber(result.monthSummary.supplyRoomNights * (occupancyPct / 100)))]
    }));
    occupancyRowsData.forEach((rowData, index) => {
        const adrLift = adrLiftRows[index - 0] || null;
        rows.push(buildTripleBlockRow(
            rowData.left,
            rowData.middle,
            adrLift
                ? [asPlainText(adrLift.label), ...reportData.monthResults.map((result) => asPlainText(formatMoneyDelta(roundNumber(result.monthSummary.targetOccupiedRoomNights * result.monthSummary.onBooksAdr * adrLift.factor))))]
                : ["", "", "", ""]
        ));
        revenueRows.push(rows.length);
    });
    pricingBodyRanges.push({ startRow: pricingBodyStart, endRow: rows.length });
    rows.push(padRow([""]));
    spacerRows.push(rows.length);

    reportData.monthResults.forEach(({ monthSummary, buildingGoals }) => {
        sectionRows.push(rows.length + 1);
        rows.push(padRow([`건물별 목표 표 · ${monthSummary.monthLabel}`]));
        headerRows.push(rows.length + 1);
        rows.push(padRow([
            "건물명", "객실", "공급박", "남은박", "",
            "목표 매출", "현재 매출", "목표 가동률", "현재 가동률", "",
            "목표 ADR", "현재 ADR", "작년 비교", "전년대비 증감"
        ]));
        const rangeStart = rows.length + 1;
        buildingGoals.forEach((goal) => {
            buildingGroupStartRows.push(rows.length + 1);
            rows.push(padRow([
                goal.building,
                goal.roomCount,
                roundNumber(goal.supplyRoomNights),
                roundNumber(goal.remainingRoomNights),
                "",
                formatCurrency(goal.targetRevenue),
                formatCurrency(goal.onBooksRevenue),
                asPlainText(formatPct(goal.targetOccupancyPct)),
                asPlainText(formatPct(goal.onBooksOccupancyPct)),
                "",
                formatCurrency(goal.targetAdr),
                formatCurrency(goal.onBooksAdr),
                goal.comparisonLabel,
                asPlainText(formatMoneyDelta(goal.additionalRevenueVsLastYear))
            ]));
            buildingCurrencyRows.push(rows.length);
            buildingInsightRows.push(rows.length);
            comparisonStatusRows.push({ row: rows.length, statusType: goal.comparisonStatusType, col: 12 });
        });
        rows.push(padRow([
            "전체",
            buildingGoals.reduce((sum, goal) => sum + goal.roomCount, 0),
            roundNumber(monthSummary.supplyRoomNights),
            roundNumber(monthSummary.remainingRoomNights),
            "",
            formatCurrency(monthSummary.targetRevenue),
            formatCurrency(monthSummary.onBooksRevenue),
            asPlainText(formatPct(monthSummary.targetOccupancyPct)),
            asPlainText(formatPct(monthSummary.onBooksOccupancyPct)),
            "",
            formatCurrency(monthSummary.targetAdr),
            formatCurrency(monthSummary.onBooksAdr),
            "건물별 구성 영향 합산",
            asPlainText(formatMoneyDelta(monthSummary.additionalRevenueVsLastYear))
        ]));
        totalRows.push(rows.length);
        buildingCurrencyRows.push(rows.length);
        buildingInsightRows.push(rows.length);
        dataRanges.push({ startRow: rangeStart, endRow: rows.length });
        rows.push(padRow([""]));
        spacerRows.push(rows.length);

        sectionRows.push(rows.length + 1);
        rows.push(padRow([`건물별 목표 시나리오 · ${monthSummary.monthLabel}`]));
        headerRows.push(rows.length + 1);
        rows.push(padRow([
            "건물명", "시나리오", "현재 매출", "현재 가동률", "",
            "현재 ADR", "목표 매출", "목표 가동률", "목표 ADR", "",
            "추가 매출", "ADR 증감", "가동률 증감", ""
        ]));
        const scenarioRangeStart = rows.length + 1;
        buildingGoals.forEach((goal) => {
            (goal.buildingScenarios || []).forEach((scenario) => {
                const revenueDelta = Number(scenario.revenue || 0) - Number(goal.onBooksRevenue || 0);
                const adrDeltaPct = Number(goal.onBooksAdr || 0) > 0
                    ? (((Number(scenario.adr || 0) - Number(goal.onBooksAdr || 0)) / Number(goal.onBooksAdr || 0)) * 100)
                    : 0;
                const occDeltaPct = Number(scenario.occupancyPct || 0) - Number(goal.onBooksOccupancyPct || 0);
                const isFirstScenario = scenario.scenarioKey === "conservative";
                if (isFirstScenario) scenarioGroupStartRows.push(rows.length + 1);
                rows.push(padRow([
                    isFirstScenario ? goal.building : "",
                    scenario.label,
                    formatCurrency(goal.onBooksRevenue),
                    asPlainText(formatPct(goal.onBooksOccupancyPct)),
                    "",
                    formatCurrency(goal.onBooksAdr),
                    formatCurrency(scenario.revenue),
                    asPlainText(formatPct(scenario.occupancyPct)),
                    formatCurrency(scenario.adr),
                    "",
                    asPlainText(formatMoneyDelta(revenueDelta)),
                    asPlainText(formatSignedPercent(adrDeltaPct)),
                    asPlainText(formatSignedPct(occDeltaPct)),
                    ""
                ]));
                scenarioMoneyRows.push(rows.length);
                buildingScenarioStyleRows.push({ row: rows.length, scenarioKey: scenario.scenarioKey });
            });
        });
        dataRanges.push({ startRow: scenarioRangeStart, endRow: rows.length });
        rows.push(padRow([""]));
        spacerRows.push(rows.length);
    });

    sectionRows.push(rows.length + 1);
    rows.push(padRow(["목표 시나리오"]));
    rows.push(padRow([
        "시나리오",
        "지표",
        asPlainText(reportData.monthResults[0]?.monthSummary?.monthLabel || ""),
        "",
        "",
        asPlainText(reportData.monthResults[1]?.monthSummary?.monthLabel || ""),
        "",
        asPlainText(reportData.monthResults[2]?.monthSummary?.monthLabel || ""),
        "",
        "",
        "요약",
        "",
        "",
        ""
    ]));
    scenarioOverviewTopHeaderRows.push(rows.length);
    rows.push(padRow([
        "",
        "",
        "현재",
        "목표",
        "",
        "현재",
        "목표",
        "현재",
        "목표",
        "",
        "차이/메모",
        "",
        "",
        ""
    ]));
    scenarioOverviewSubHeaderRows.push(rows.length);
    const scenarioLabels = getScenarioDeltas(0);
    Object.keys(scenarioLabels).forEach((scenarioKey) => {
        const scenarioLabel = scenarioLabels[scenarioKey].label;
        scenarioOverviewGroupStartRows.push(rows.length + 1);
        rows.push(padRow([
            scenarioLabel,
            "매출",
            formatCurrency(reportData.monthResults[0]?.monthSummary?.onBooksRevenue || 0),
            formatCurrency(reportData.monthResults[0]?.monthSummary?.scenarios.find((item) => item.scenarioKey === scenarioKey)?.revenue || 0),
            "",
            formatCurrency(reportData.monthResults[1]?.monthSummary?.onBooksRevenue || 0),
            formatCurrency(reportData.monthResults[1]?.monthSummary?.scenarios.find((item) => item.scenarioKey === scenarioKey)?.revenue || 0),
            formatCurrency(reportData.monthResults[2]?.monthSummary?.onBooksRevenue || 0),
            formatCurrency(reportData.monthResults[2]?.monthSummary?.scenarios.find((item) => item.scenarioKey === scenarioKey)?.revenue || 0),
            "",
            asPlainText(reportData.monthResults.map((result) => {
                const targetRevenue = Number(result.monthSummary.scenarios.find((item) => item.scenarioKey === scenarioKey)?.revenue || 0);
                const currentRevenue = Number(result.monthSummary.onBooksRevenue || 0);
                return formatMoneyDelta(targetRevenue - currentRevenue);
            }).join("\n")),
            "",
            "",
            ""
        ]));
        scenarioOverviewRevenueRows.push(rows.length);
        rows.push(padRow([
            "",
            "가동률",
            asPlainText(formatPct(reportData.monthResults[0]?.monthSummary?.onBooksOccupancyPct || 0)),
            asPlainText(formatPct(reportData.monthResults[0]?.monthSummary?.scenarios.find((item) => item.scenarioKey === scenarioKey)?.occupancyPct || 0)),
            "",
            asPlainText(formatPct(reportData.monthResults[1]?.monthSummary?.onBooksOccupancyPct || 0)),
            asPlainText(formatPct(reportData.monthResults[1]?.monthSummary?.scenarios.find((item) => item.scenarioKey === scenarioKey)?.occupancyPct || 0)),
            asPlainText(formatPct(reportData.monthResults[2]?.monthSummary?.onBooksOccupancyPct || 0)),
            asPlainText(formatPct(reportData.monthResults[2]?.monthSummary?.scenarios.find((item) => item.scenarioKey === scenarioKey)?.occupancyPct || 0)),
            "",
            asPlainText(reportData.monthResults.map((result) => {
                const targetPct = Number(result.monthSummary.scenarios.find((item) => item.scenarioKey === scenarioKey)?.occupancyPct || 0);
                const currentPct = Number(result.monthSummary.onBooksOccupancyPct || 0);
                return formatSignedPct(targetPct - currentPct);
            }).join("\n")),
            "",
            "",
            ""
        ]));
        scenarioOverviewOccupancyRows.push(rows.length);
        rows.push(padRow([
            "",
            "ADR",
            formatCurrency(reportData.monthResults[0]?.monthSummary?.onBooksAdr || 0),
            formatCurrency(reportData.monthResults[0]?.monthSummary?.scenarios.find((item) => item.scenarioKey === scenarioKey)?.adr || 0),
            "",
            formatCurrency(reportData.monthResults[1]?.monthSummary?.onBooksAdr || 0),
            formatCurrency(reportData.monthResults[1]?.monthSummary?.scenarios.find((item) => item.scenarioKey === scenarioKey)?.adr || 0),
            formatCurrency(reportData.monthResults[2]?.monthSummary?.onBooksAdr || 0),
            formatCurrency(reportData.monthResults[2]?.monthSummary?.scenarios.find((item) => item.scenarioKey === scenarioKey)?.adr || 0),
            "",
            asPlainText(reportData.monthResults.map((result) => {
                const targetAdr = Number(result.monthSummary.scenarios.find((item) => item.scenarioKey === scenarioKey)?.adr || 0);
                const currentAdr = Number(result.monthSummary.onBooksAdr || 0);
                const adrGapPct = currentAdr > 0 ? (((targetAdr - currentAdr) / currentAdr) * 100) : 0;
                return formatSignedPercent(adrGapPct);
            }).join("\n")),
            "",
            "",
            ""
        ]));
        scenarioOverviewAdrRows.push(rows.length);
    });
    rows.push(padRow([""]));
    spacerRows.push(rows.length);

    sectionRows.push(rows.length + 1);
    rows.push(padRow(["국가별 수요 시즌 (프로모션·가격 캘린더 참고)"]));
    rows.push(padRow(["산정 기준", countrySeason.basisText]));
    mergedContentRows.push(rows.length);
    headerRows.push(rows.length + 1);
    rows.push(padRow(["순위", "국가", "성수기 월", "", "", "평수기 월", "", "", "비수기 월", "", "", "근거/참고", "", ""]));
    countrySeasonHeaderRows.push(rows.length);
    const countrySeasonDataStart = rows.length + 1;
    countrySeason.topCountries.forEach((countryRow) => {
        rows.push(padRow([
            String(countryRow.rank),
            `${countryRow.name} (${countryRow.sharePct}%)`,
            asPlainText(countryRow.peakText),
            "",
            "",
            asPlainText(countryRow.shoulderText),
            "",
            "",
            asPlainText(countryRow.offText),
            "",
            "",
            asPlainText(`${countryRow.noteText} / ${countryRow.sourceText}`),
            "",
            ""
        ]));
        countrySeasonRows.push(rows.length);
    });
    if (countrySeasonDataStart <= rows.length) {
        dataRanges.push({ startRow: countrySeasonDataStart, endRow: rows.length });
    }
    rows.push(padRow([
        "미확인 국가",
        `박수 ${countrySeason.unknownNights} · 전체 대비 ${countrySeason.unknownSharePct}% (순위 제외)`
    ]));
    mergedContentRows.push(rows.length);

    rows.push(padRow(["검증", ...reportData.validation.map((item) => `${item.yearMonth}: 매출 ${item.revenueMatches ? "OK" : "CHECK"} / 점유박 ${item.occupiedMatches ? "OK" : "CHECK"}`)]));
    validationRows.push(rows.length);

    return {
        rows,
        sectionRows,
        headerRows,
        dataRanges,
        spacerRows,
        totalRows,
        revenueRows,
        currentRevenueRows,
        occupancyRows,
        currentOccupancyRows,
        adrRows,
        currentAdrRows,
        mergedContentRows,
        factorNarrativeRows,
        validationRows,
        textInsightRows,
        pricingPanelTitleRows,
        pricingPanelHeaderRows,
        pricingBodyRanges,
        overallSummaryRows,
        scenarioOverviewRows,
        topSummaryValueRows,
        scenarioOverviewTopHeaderRows,
        scenarioOverviewSubHeaderRows,
        scenarioOverviewRevenueRows,
        scenarioOverviewOccupancyRows,
        scenarioOverviewAdrRows,
        scenarioOverviewGroupStartRows,
        buildingCurrencyRows,
        buildingInsightRows,
        scenarioMoneyRows,
        buildingScenarioStyleRows,
        buildingGroupStartRows,
        scenarioGroupStartRows,
        countrySeasonRows,
        countrySeasonHeaderRows,
        comparisonStatusRows
    };
}

function buildSheetRowsExpanded(reportData) {
    const rows = [];
    const sectionRows = [];
    const headerRows = [];
    const dataRanges = [];
    const spacerRows = [];
    const totalRows = [];
    const revenueRows = [];
    const currentRevenueRows = [];
    const occupancyRows = [];
    const currentOccupancyRows = [];
    const adrRows = [];
    const currentAdrRows = [];
    const mergedContentRows = [];
    const factorNarrativeRows = [];
    const validationRows = [];
    const textInsightRows = [];
    const pricingPanelTitleRows = [];
    const pricingPanelHeaderRows = [];
    const pricingBodyRanges = [];
    const overallSummaryRows = [];
    const scenarioOverviewRows = [];
    const topSummaryValueRows = [];
    const scenarioOverviewTopHeaderRows = [];
    const scenarioOverviewSubHeaderRows = [];
    const scenarioOverviewRevenueRows = [];
    const scenarioOverviewOccupancyRows = [];
    const scenarioOverviewAdrRows = [];
    const scenarioOverviewGroupStartRows = [];
    const buildingCurrencyRows = [];
    const buildingInsightRows = [];
    const scenarioMoneyRows = [];
    const buildingScenarioStyleRows = [];
    const buildingGroupStartRows = [];
    const scenarioGroupStartRows = [];
    const countrySeasonRows = [];
    const countrySeasonHeaderRows = [];
    const comparisonStatusRows = [];

    const countrySeason = reportData.countrySeasonality || {
        basisText: "",
        unknownNights: 0,
        unknownSharePct: 0,
        topCountries: []
    };

    rows.push(padRow(["당월 + 3개월 매출 목표 시트"]));
    rows.push(padRow([
        `기준일시: ${reportData.generatedAt} JST`,
        "",
        "",
        "",
        "",
        "",
        `📊 ${reportData.targetMonths.map((yearMonth) => yearMonth.replace("-", ".")).join(", ")}`,
        "",
        "",
        "",
        "",
        "",
        `출처: ${reportData.dataSources.join(" / ")}`
    ]));
    rows.push(padRow([""]));
    spacerRows.push(rows.length);

    sectionRows.push(rows.length + 1);
    rows.push(padRow(["상단 요약"]));
    rows.push(padRow([
        `기준일시: ${asPlainText(reportData.generatedAt)} JST`,
        "",
        "",
        "",
        "",
        "",
        `당월 + 3개월: ${asPlainText(reportData.targetMonths.map((yearMonth) => yearMonth.replace("-", ".")).join(" / "))}`,
        "",
        "",
        "",
        "",
        "",
        ""
    ]));
    topSummaryValueRows.push(rows.length);
    rows.push(padRow(["기준 데이터 원본", reportData.dataSources.join(" / ")]));
    mergedContentRows.push(rows.length);
    rows.push(padRow(["플랫폼 기준", "Airbnb / Booking.com 예약 기준 운영 지표"]));
    mergedContentRows.push(rows.length);
    rows.push(padRow(["금액 기준", "채널수수료 포함(totalPrice) 기준 — Revenue Dashboard 동일"]));
    mergedContentRows.push(rows.length);
    rows.push(padRow(["제외 자산", reportData.excludedAssets.join(", ")]));
    mergedContentRows.push(rows.length);
    rows.push(padRow(["시즌 티어 요약", reportData.monthResults.map((result) => `${result.monthSummary.monthLabel} ${result.monthSummary.seasonLabel}`).join(" / ")]));
    mergedContentRows.push(rows.length);
    rows.push(padRow([""]));
    spacerRows.push(rows.length);

    sectionRows.push(rows.length + 1);
    rows.push(padRow(["전체 목표 요약"]));
    headerRows.push(rows.length + 1);
    rows.push(buildThreeMonthSummaryRow("지표", reportData.monthResults.map((result) => asPlainText(result.monthSummary.monthLabel))));
    overallSummaryRows.push(rows.length);
    rows.push(buildThreeMonthSummaryRow("목표 매출액", reportData.monthResults.map((result) => formatCurrency(result.monthSummary.targetRevenue))));
    overallSummaryRows.push(rows.length);
    revenueRows.push(rows.length);
    rows.push(buildThreeMonthSummaryRow("현재 매출액", reportData.monthResults.map((result) => formatCurrency(result.monthSummary.onBooksRevenue))));
    overallSummaryRows.push(rows.length);
    currentRevenueRows.push(rows.length);
    rows.push(buildThreeMonthSummaryRow("목표 가동률", reportData.monthResults.map((result) => formatPct(result.monthSummary.targetOccupancyPct))));
    overallSummaryRows.push(rows.length);
    occupancyRows.push(rows.length);
    rows.push(buildThreeMonthSummaryRow("현재 가동률", reportData.monthResults.map((result) => formatPct(result.monthSummary.onBooksOccupancyPct))));
    overallSummaryRows.push(rows.length);
    currentOccupancyRows.push(rows.length);
    rows.push(buildThreeMonthSummaryRow("목표 ADR", reportData.monthResults.map((result) => formatCurrency(result.monthSummary.targetAdr))));
    overallSummaryRows.push(rows.length);
    adrRows.push(rows.length);
    rows.push(buildThreeMonthSummaryRow("현재 ADR", reportData.monthResults.map((result) => formatCurrency(result.monthSummary.onBooksAdr))));
    overallSummaryRows.push(rows.length);
    currentAdrRows.push(rows.length);
    rows.push(buildThreeMonthSummaryRow("공급 객실박", reportData.monthResults.map((result) => roundNumber(result.monthSummary.supplyRoomNights))));
    overallSummaryRows.push(rows.length);
    rows.push(buildThreeMonthSummaryRow("목표 점유박", reportData.monthResults.map((result) => roundNumber(result.monthSummary.targetOccupiedRoomNights))));
    overallSummaryRows.push(rows.length);
    rows.push(buildThreeMonthSummaryRow("목표 대비 가동률 갭", reportData.monthResults.map((result) => {
        const gap = roundPct(result.monthSummary.onBooksOccupancyPct - result.monthSummary.targetOccupancyPct);
        return `목표대비 ${gap >= 0 ? "+" : ""}${gap}%p`;
    })));
    overallSummaryRows.push(rows.length);
    rows.push(buildThreeMonthSummaryRow("목표 대비 ADR 갭", reportData.monthResults.map((result) => {
        const adrGapPct = Number(result.monthSummary.targetAdr || 0) > 0
            ? roundPct((((Number(result.monthSummary.onBooksAdr || 0) - Number(result.monthSummary.targetAdr || 0)) / Number(result.monthSummary.targetAdr || 0)) * 100))
            : 0;
        return `목표대비 ${adrGapPct >= 0 ? "+" : ""}${adrGapPct}%`;
    })));
    overallSummaryRows.push(rows.length);
    rows.push(buildThreeMonthSummaryRow("가격 판단", reportData.monthResults.map((result) => buildPricingGuidance(result.monthSummary).pricingStatus)));
    overallSummaryRows.push(rows.length);
    textInsightRows.push(rows.length);
    rows.push(buildThreeMonthSummaryRow("권장 액션", reportData.monthResults.map((result) => buildPricingGuidance(result.monthSummary).actionText)));
    overallSummaryRows.push(rows.length);
    textInsightRows.push(rows.length);
    rows.push(padRow([""]));
    spacerRows.push(rows.length);

    sectionRows.push(rows.length + 1);
    rows.push(padRow(["현재 ADR 기준 수익 시뮬레이션"]));
    rows.push(buildTripleBlockRow(
        ["예상 매출"],
        ["필요 점유박"],
        ["ADR 인상 효과"]
    ));
    pricingPanelTitleRows.push(rows.length);
    rows.push(buildTripleBlockRow(
        ["구분", ...reportData.monthResults.map((result) => asPlainText(result.monthSummary.monthLabel))],
        ["구분", ...reportData.monthResults.map((result) => asPlainText(result.monthSummary.monthLabel))],
        ["구분", ...reportData.monthResults.map((result) => asPlainText(result.monthSummary.monthLabel))]
    ));
    pricingPanelHeaderRows.push(rows.length);
    const pricingBodyStart = rows.length + 1;
    rows.push(buildTripleBlockRow(
        ["현재 기준", ...reportData.monthResults.map((result) => formatCurrency(result.monthSummary.onBooksRevenue))],
        ["현재 점유박", ...reportData.monthResults.map((result) => roundNumber(result.monthSummary.onBooksOccupiedRoomNights))],
        ["현재 ADR", ...reportData.monthResults.map((result) => formatCurrency(result.monthSummary.onBooksAdr))]
    ));
    currentRevenueRows.push(rows.length);
    rows.push(buildTripleBlockRow(
        ["목표 기준", ...reportData.monthResults.map((result) => formatCurrency(result.monthSummary.targetRevenue))],
        ["목표 점유박", ...reportData.monthResults.map((result) => roundNumber(result.monthSummary.targetOccupiedRoomNights))],
        [asPlainText("+5% ADR"), ...reportData.monthResults.map((result) => asPlainText(formatMoneyDelta(roundNumber(result.monthSummary.targetOccupiedRoomNights * result.monthSummary.onBooksAdr * 0.05))))]
    ));
    revenueRows.push(rows.length);
    const adrLiftRows = [
        { label: "+10% ADR", factor: 0.10 },
        { label: "+15% ADR", factor: 0.15 },
        { label: "+20% ADR", factor: 0.20 }
    ];
    const occupancyRowsData = CURRENT_ADR_OCCUPANCY_LEVELS.map((occupancyPct) => ({
        left: [`가동률 ${occupancyPct}%`, ...reportData.monthResults.map((result) => formatCurrency(getExpectedRevenueAtOccupancy(result.monthSummary, occupancyPct, result.monthSummary.onBooksAdr)))],
        middle: [`수요 자유박 ${occupancyPct}%`, ...reportData.monthResults.map((result) => roundNumber(result.monthSummary.supplyRoomNights * (occupancyPct / 100)))]
    }));
    occupancyRowsData.forEach((rowData, index) => {
        const adrLift = adrLiftRows[index - 0] || null;
        rows.push(buildTripleBlockRow(
            rowData.left,
            rowData.middle,
            adrLift
                ? [asPlainText(adrLift.label), ...reportData.monthResults.map((result) => asPlainText(formatMoneyDelta(roundNumber(result.monthSummary.targetOccupiedRoomNights * result.monthSummary.onBooksAdr * adrLift.factor))))]
                : Array.from({ length: PRICING_PANEL_BLOCK_WIDTH }, () => "")
        ));
        revenueRows.push(rows.length);
    });
    pricingBodyRanges.push({ startRow: pricingBodyStart, endRow: rows.length });
    rows.push(padRow([""]));
    spacerRows.push(rows.length);

    reportData.monthResults.forEach(({ monthSummary, buildingGoals }) => {
        sectionRows.push(rows.length + 1);
        rows.push(padRow([`건물별 목표 표 · ${monthSummary.monthLabel}`]));
        headerRows.push(rows.length + 1);
        rows.push(padRow([
            "건물명", "객실", "공급박", "남은박", "",
            "목표 매출", "현재 매출", "목표 가동률", "현재 가동률", "",
            "목표 ADR", "현재 ADR", "작년 비교", "전년대비 증감"
        ]));
        const rangeStart = rows.length + 1;
        buildingGoals.forEach((goal) => {
            buildingGroupStartRows.push(rows.length + 1);
            rows.push(padRow([
                goal.building,
                goal.roomCount,
                roundNumber(goal.supplyRoomNights),
                roundNumber(goal.remainingRoomNights),
                "",
                formatCurrency(goal.targetRevenue),
                formatCurrency(goal.onBooksRevenue),
                asPlainText(formatPct(goal.targetOccupancyPct)),
                asPlainText(formatPct(goal.onBooksOccupancyPct)),
                "",
                formatCurrency(goal.targetAdr),
                formatCurrency(goal.onBooksAdr),
                goal.comparisonLabel,
                asPlainText(formatMoneyDelta(goal.additionalRevenueVsLastYear))
            ]));
            buildingCurrencyRows.push(rows.length);
            buildingInsightRows.push(rows.length);
            comparisonStatusRows.push({ row: rows.length, statusType: goal.comparisonStatusType, col: 12 });
        });
        rows.push(padRow([
            "전체",
            buildingGoals.reduce((sum, goal) => sum + goal.roomCount, 0),
            roundNumber(monthSummary.supplyRoomNights),
            roundNumber(monthSummary.remainingRoomNights),
            "",
            formatCurrency(monthSummary.targetRevenue),
            formatCurrency(monthSummary.onBooksRevenue),
            asPlainText(formatPct(monthSummary.targetOccupancyPct)),
            asPlainText(formatPct(monthSummary.onBooksOccupancyPct)),
            "",
            formatCurrency(monthSummary.targetAdr),
            formatCurrency(monthSummary.onBooksAdr),
            "건물별 구성 영향 합산",
            asPlainText(formatMoneyDelta(monthSummary.additionalRevenueVsLastYear))
        ]));
        totalRows.push(rows.length);
        buildingCurrencyRows.push(rows.length);
        buildingInsightRows.push(rows.length);
        dataRanges.push({ startRow: rangeStart, endRow: rows.length });
        rows.push(padRow([""]));
        spacerRows.push(rows.length);

        sectionRows.push(rows.length + 1);
        rows.push(padRow([`건물별 목표 시나리오 · ${monthSummary.monthLabel}`]));
        headerRows.push(rows.length + 1);
        rows.push(padRow([
            "건물명", "시나리오", "현재 매출", "현재 가동률", "",
            "현재 ADR", "목표 매출", "목표 가동률", "목표 ADR", "",
            "추가 매출", "ADR 증감", "가동률 증감", ""
        ]));
        const scenarioRangeStart = rows.length + 1;
        buildingGoals.forEach((goal) => {
            (goal.buildingScenarios || []).forEach((scenario) => {
                const revenueDelta = Number(scenario.revenue || 0) - Number(goal.onBooksRevenue || 0);
                const adrDeltaPct = Number(goal.onBooksAdr || 0) > 0
                    ? (((Number(scenario.adr || 0) - Number(goal.onBooksAdr || 0)) / Number(goal.onBooksAdr || 0)) * 100)
                    : 0;
                const occDeltaPct = Number(scenario.occupancyPct || 0) - Number(goal.onBooksOccupancyPct || 0);
                const isFirstScenario = scenario.scenarioKey === "conservative";
                if (isFirstScenario) scenarioGroupStartRows.push(rows.length + 1);
                rows.push(padRow([
                    isFirstScenario ? goal.building : "",
                    scenario.label,
                    formatCurrency(goal.onBooksRevenue),
                    asPlainText(formatPct(goal.onBooksOccupancyPct)),
                    "",
                    formatCurrency(goal.onBooksAdr),
                    formatCurrency(scenario.revenue),
                    asPlainText(formatPct(scenario.occupancyPct)),
                    formatCurrency(scenario.adr),
                    "",
                    asPlainText(formatMoneyDelta(revenueDelta)),
                    asPlainText(formatSignedPercent(adrDeltaPct)),
                    asPlainText(formatSignedPct(occDeltaPct)),
                    ""
                ]));
                scenarioMoneyRows.push(rows.length);
                buildingScenarioStyleRows.push({ row: rows.length, scenarioKey: scenario.scenarioKey });
            });
        });
        dataRanges.push({ startRow: scenarioRangeStart, endRow: rows.length });
        rows.push(padRow([""]));
        spacerRows.push(rows.length);
    });

    sectionRows.push(rows.length + 1);
    rows.push(padRow(["목표 시나리오"]));
    const topHeaderRow = createEmptyRow();
    topHeaderRow[0] = "시나리오";
    topHeaderRow[1] = "지표";
    reportData.monthResults.forEach((result, index) => {
        topHeaderRow[SCENARIO_MONTH_RANGES[index].start] = asPlainText(result.monthSummary.monthLabel || "");
    });
    topHeaderRow[SCENARIO_NOTES_START_COLUMN] = "요약";
    rows.push(topHeaderRow);
    scenarioOverviewTopHeaderRows.push(rows.length);

    const subHeaderRow = createEmptyRow();
    SCENARIO_MONTH_RANGES.forEach((range) => {
        subHeaderRow[range.start] = "현재";
        subHeaderRow[range.start + 1] = "목표";
    });
    subHeaderRow[SCENARIO_NOTES_START_COLUMN] = "차이/메모";
    rows.push(subHeaderRow);
    scenarioOverviewSubHeaderRows.push(rows.length);

    const scenarioLabelsExpanded = getScenarioDeltas(0);
    Object.keys(scenarioLabelsExpanded).forEach((scenarioKey) => {
        const scenarioLabel = scenarioLabelsExpanded[scenarioKey].label;
        scenarioOverviewGroupStartRows.push(rows.length + 1);
        rows.push(buildScenarioOverviewRow(
            scenarioLabel,
            "매출",
            reportData.monthResults.map((result) => ([
                formatCurrency(result.monthSummary.onBooksRevenue || 0),
                formatCurrency(result.monthSummary.scenarios.find((item) => item.scenarioKey === scenarioKey)?.revenue || 0)
            ])),
            asPlainText(reportData.monthResults.map((result) => {
                const targetRevenue = Number(result.monthSummary.scenarios.find((item) => item.scenarioKey === scenarioKey)?.revenue || 0);
                const currentRevenue = Number(result.monthSummary.onBooksRevenue || 0);
                return `${result.monthSummary.monthLabel}: ${formatMoneyDelta(targetRevenue - currentRevenue)}`;
            }).join("\n"))
        ));
        scenarioOverviewRevenueRows.push(rows.length);
        rows.push(buildScenarioOverviewRow(
            "",
            "가동률",
            reportData.monthResults.map((result) => ([
                asPlainText(formatPct(result.monthSummary.onBooksOccupancyPct || 0)),
                asPlainText(formatPct(result.monthSummary.scenarios.find((item) => item.scenarioKey === scenarioKey)?.occupancyPct || 0))
            ])),
            asPlainText(reportData.monthResults.map((result) => {
                const targetPct = Number(result.monthSummary.scenarios.find((item) => item.scenarioKey === scenarioKey)?.occupancyPct || 0);
                const currentPct = Number(result.monthSummary.onBooksOccupancyPct || 0);
                return `${result.monthSummary.monthLabel}: ${formatSignedPct(targetPct - currentPct)}`;
            }).join("\n"))
        ));
        scenarioOverviewOccupancyRows.push(rows.length);
        rows.push(buildScenarioOverviewRow(
            "",
            "ADR",
            reportData.monthResults.map((result) => ([
                formatCurrency(result.monthSummary.onBooksAdr || 0),
                formatCurrency(result.monthSummary.scenarios.find((item) => item.scenarioKey === scenarioKey)?.adr || 0)
            ])),
            asPlainText(reportData.monthResults.map((result) => {
                const targetAdr = Number(result.monthSummary.scenarios.find((item) => item.scenarioKey === scenarioKey)?.adr || 0);
                const currentAdr = Number(result.monthSummary.onBooksAdr || 0);
                const adrGapPct = currentAdr > 0 ? (((targetAdr - currentAdr) / currentAdr) * 100) : 0;
                return `${result.monthSummary.monthLabel}: ${formatSignedPercent(adrGapPct)}`;
            }).join("\n"))
        ));
        scenarioOverviewAdrRows.push(rows.length);
    });
    rows.push(padRow([""]));
    spacerRows.push(rows.length);

    sectionRows.push(rows.length + 1);
    rows.push(padRow(["국가별 수요 시즌 (프로모션·가격 캘린더 참고)"]));
    rows.push(padRow(["산정 기준", countrySeason.basisText]));
    mergedContentRows.push(rows.length);
    headerRows.push(rows.length + 1);
    rows.push(padRow(["순위", "국가", "성수기 월", "", "", "중수기 월", "", "", "비수기 월", "", "", "근거/참고", "", ""]));
    countrySeasonHeaderRows.push(rows.length);
    const countrySeasonDataStart = rows.length + 1;
    countrySeason.topCountries.forEach((countryRow) => {
        rows.push(padRow([
            String(countryRow.rank),
            `${countryRow.name} (${countryRow.sharePct}%)`,
            asPlainText(countryRow.peakText),
            "",
            "",
            asPlainText(countryRow.shoulderText),
            "",
            "",
            asPlainText(countryRow.offText),
            "",
            "",
            asPlainText(`${countryRow.noteText} / ${countryRow.sourceText}`),
            "",
            ""
        ]));
        countrySeasonRows.push(rows.length);
    });
    if (countrySeasonDataStart <= rows.length) {
        dataRanges.push({ startRow: countrySeasonDataStart, endRow: rows.length });
    }
    rows.push(padRow([
        "미확인 국가",
        `박수 ${countrySeason.unknownNights} · 전체 대비 ${countrySeason.unknownSharePct}% (순위 제외)`
    ]));
    mergedContentRows.push(rows.length);

    rows.push(padRow(["검증", ...reportData.validation.map((item) => `${item.yearMonth}: 매출 ${item.revenueMatches ? "OK" : "CHECK"} / 점유박 ${item.occupiedMatches ? "OK" : "CHECK"}`)]));
    validationRows.push(rows.length);

    return {
        rows,
        sectionRows,
        headerRows,
        dataRanges,
        spacerRows,
        totalRows,
        revenueRows,
        currentRevenueRows,
        occupancyRows,
        currentOccupancyRows,
        adrRows,
        currentAdrRows,
        mergedContentRows,
        factorNarrativeRows,
        validationRows,
        textInsightRows,
        pricingPanelTitleRows,
        pricingPanelHeaderRows,
        pricingBodyRanges,
        overallSummaryRows,
        scenarioOverviewRows,
        topSummaryValueRows,
        scenarioOverviewTopHeaderRows,
        scenarioOverviewSubHeaderRows,
        scenarioOverviewRevenueRows,
        scenarioOverviewOccupancyRows,
        scenarioOverviewAdrRows,
        scenarioOverviewGroupStartRows,
        buildingCurrencyRows,
        buildingInsightRows,
        scenarioMoneyRows,
        buildingScenarioStyleRows,
        buildingGroupStartRows,
        scenarioGroupStartRows,
        countrySeasonRows,
        countrySeasonHeaderRows,
        comparisonStatusRows
    };
}

function buildFormatRequests({ sheetId, rowCount, sectionRows, headerRows, dataRanges, spacerRows, totalRows, revenueRows, currentRevenueRows, occupancyRows, currentOccupancyRows, adrRows, currentAdrRows, mergedContentRows, factorNarrativeRows, validationRows, textInsightRows, pricingPanelTitleRows, pricingPanelHeaderRows, pricingBodyRanges, overallSummaryRows, scenarioOverviewRows, topSummaryValueRows, scenarioOverviewTopHeaderRows, scenarioOverviewSubHeaderRows, scenarioOverviewRevenueRows, scenarioOverviewOccupancyRows, scenarioOverviewAdrRows, scenarioOverviewGroupStartRows, buildingCurrencyRows, buildingInsightRows, scenarioMoneyRows, buildingScenarioStyleRows, buildingGroupStartRows, scenarioGroupStartRows, countrySeasonRows, countrySeasonHeaderRows, comparisonStatusRows }) {
    const navy = { red: 0.05, green: 0.12, blue: 0.28 };
    const darkBlue = { red: 0.08, green: 0.22, blue: 0.45 };
    const lightBlue = { red: 0.88, green: 0.93, blue: 1.0 };
    const white = { red: 1, green: 1, blue: 1 };
    const softSlate = { red: 0.95, green: 0.96, blue: 0.98 };
    const rowOdd = { red: 0.97, green: 0.98, blue: 1.0 };
    const totalFill = { red: 0.91, green: 0.95, blue: 0.99 };
    const revenueFill = { red: 0.92, green: 0.98, blue: 0.94 };
    const currentRevenueFill = { red: 0.95, green: 0.99, blue: 0.96 };
    const occupancyFill = { red: 0.92, green: 0.96, blue: 1.0 };
    const currentOccupancyFill = { red: 0.95, green: 0.98, blue: 1.0 };
    const adrFill = { red: 0.96, green: 0.93, blue: 1.0 };
    const currentAdrFill = { red: 0.98, green: 0.95, blue: 1.0 };
    const revenueText = { red: 0.00, green: 0.42, blue: 0.15 };
    const currentRevenueText = { red: 0.12, green: 0.35, blue: 0.16 };
    const occupancyText = { red: 0.07, green: 0.30, blue: 0.67 };
    const currentOccupancyText = { red: 0.08, green: 0.31, blue: 0.55 };
    const adrText = { red: 0.42, green: 0.18, blue: 0.68 };
    const currentAdrText = { red: 0.36, green: 0.22, blue: 0.58 };
    const mutedText = { red: 0.26, green: 0.30, blue: 0.36 };
    const pricingGreenTitle = { red: 0.20, green: 0.52, blue: 0.33 };
    const pricingGreenFill = { red: 0.93, green: 0.98, blue: 0.94 };
    const pricingBlueTitle = { red: 0.16, green: 0.41, blue: 0.69 };
    const pricingBlueFill = { red: 0.92, green: 0.96, blue: 1.0 };
    const pricingPurpleTitle = { red: 0.46, green: 0.28, blue: 0.63 };
    const pricingPurpleFill = { red: 0.97, green: 0.94, blue: 1.0 };
    const separatorFill = { red: 0.90, green: 0.92, blue: 0.96 };
    const borderThin = { style: "SOLID", color: { red: 0.75, green: 0.80, blue: 0.90 } };
    const borderMed = { style: "SOLID_MEDIUM", color: { red: 0.15, green: 0.25, blue: 0.45 } };
    const buildingScenarioColors = {
        conservative: {
            labelBg: { red: 0.90, green: 0.95, blue: 1.0 },
            rowBg: { red: 0.97, green: 0.99, blue: 1.0 },
            labelFg: darkBlue
        },
        base: {
            labelBg: { red: 0.92, green: 0.98, blue: 0.93 },
            rowBg: { red: 0.98, green: 1.0, blue: 0.98 },
            labelFg: { red: 0.15, green: 0.45, blue: 0.25 }
        },
        aggressive: {
            labelBg: { red: 1.0, green: 0.94, blue: 0.91 },
            rowBg: { red: 1.0, green: 0.98, blue: 0.96 },
            labelFg: { red: 0.58, green: 0.29, blue: 0.14 }
        }
    };
    // 4개월 레이아웃: 모든 데이터 열 108px 이상 확보 (이전 3개월 22px 분리열 제거)
    // 서로 다른 섹션(pricing panel, building table, scenario)이 같은 열 위치를
    // 데이터/분리 용도로 공유하므로, 분리 효과는 backgroundColor로만 처리
    const columnWidths = [136, 136, 108, 108, 108, 108, 108, 108, 108, 108, 108, 108, 108, 108, 108, 108, 108, 44];
    const separatorRequests = (columns, startRowIndex, endRowIndex) => columns.map((columnIndex) => ({
        repeatCell: {
            range: { sheetId, startRowIndex, endRowIndex, startColumnIndex: columnIndex, endColumnIndex: columnIndex + 1 },
            cell: { userEnteredFormat: { backgroundColor: separatorFill } },
            fields: "userEnteredFormat.backgroundColor"
        }
    }));

    const requests = [
        { unmergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: Math.max(rowCount + 2, 40), startColumnIndex: 0, endColumnIndex: SHEET_COLUMNS } } },
        { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 2, rowCount, columnCount: SHEET_COLUMNS } }, fields: "gridProperties.frozenRowCount,gridProperties.rowCount,gridProperties.columnCount" } },
        ...columnWidths.map((pixelSize, index) => ({
            updateDimensionProperties: {
                range: { sheetId, dimension: "COLUMNS", startIndex: index, endIndex: index + 1 },
                properties: { pixelSize },
                fields: "pixelSize"
            }
        })),
        { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: SHEET_COLUMNS }, cell: { userEnteredFormat: { backgroundColor: white, textFormat: { fontFamily: "Noto Sans KR", fontSize: 11, foregroundColor: mutedText }, verticalAlignment: "MIDDLE", wrapStrategy: "CLIP" } }, fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment,wrapStrategy)" } },
        { mergeCells: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: SHEET_COLUMNS }, mergeType: "MERGE_ALL" } },
        ...TOP_HEADER_RANGES.map(({ start, end }) => ({
            mergeCells: { range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: start, endColumnIndex: end }, mergeType: "MERGE_ALL" }
        })),
        { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: SHEET_COLUMNS }, cell: { userEnteredFormat: { backgroundColor: navy, textFormat: { foregroundColor: white, bold: true, fontSize: 18 }, horizontalAlignment: "LEFT", padding: { left: 16, right: 16, top: 8, bottom: 8 } } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,padding)" } },
        ...TOP_HEADER_RANGES.map(({ start, end }) => ({
            repeatCell: {
                range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: start, endColumnIndex: end },
                cell: { userEnteredFormat: { backgroundColor: darkBlue, textFormat: { foregroundColor: white, fontSize: 10, bold: true }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE", padding: { left: 12, right: 12, top: 8, bottom: 8 }, wrapStrategy: "WRAP" } },
                fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding,wrapStrategy)"
            }
        })),
        { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 42 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 1, endIndex: 2 }, properties: { pixelSize: 44 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: 2, endIndex: rowCount }, properties: { pixelSize: 36 }, fields: "pixelSize" } },
        { repeatCell: { range: { sheetId, startRowIndex: 2, endRowIndex: rowCount, startColumnIndex: 1, endColumnIndex: SCENARIO_NOTES_START_COLUMN }, cell: { userEnteredFormat: { horizontalAlignment: "RIGHT" } }, fields: "userEnteredFormat.horizontalAlignment" } },
        { repeatCell: { range: { sheetId, startRowIndex: 2, endRowIndex: rowCount, startColumnIndex: SCENARIO_NOTES_START_COLUMN, endColumnIndex: SHEET_COLUMNS }, cell: { userEnteredFormat: { horizontalAlignment: "LEFT" } }, fields: "userEnteredFormat.horizontalAlignment" } },
        { repeatCell: { range: { sheetId, startRowIndex: 2, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { horizontalAlignment: "LEFT" } }, fields: "userEnteredFormat.horizontalAlignment" } },
        { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: 1, endColumnIndex: SCENARIO_NOTES_START_COLUMN }, cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "#,##0" } } }, fields: "userEnteredFormat.numberFormat" } },
        { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: 1, endColumnIndex: SCENARIO_NOTES_START_COLUMN }, cell: { userEnteredFormat: { padding: { left: 8, right: 10, top: 5, bottom: 5 } } }, fields: "userEnteredFormat.padding" } },
        { repeatCell: { range: { sheetId, startRowIndex: 2, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: SHEET_COLUMNS }, cell: { userEnteredFormat: { padding: { left: 10, right: 10, top: 4, bottom: 4 } } }, fields: "userEnteredFormat.padding" } }
    ];

    sectionRows.forEach((rowNumber) => {
        requests.push(
            { mergeCells: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 0, endColumnIndex: SHEET_COLUMNS }, mergeType: "MERGE_ALL" } },
            { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 0, endColumnIndex: SHEET_COLUMNS }, cell: { userEnteredFormat: { backgroundColor: darkBlue, textFormat: { foregroundColor: white, bold: true, fontSize: 12 }, horizontalAlignment: "LEFT", padding: { left: 14, right: 10, top: 6, bottom: 6 } } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,padding)" } },
            { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: rowNumber - 1, endIndex: rowNumber }, properties: { pixelSize: 32 }, fields: "pixelSize" } }
        );
    });

    mergedContentRows.forEach((rowNumber) => {
        requests.push(
            { mergeCells: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 1, endColumnIndex: SHEET_COLUMNS }, mergeType: "MERGE_ALL" } },
            { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: darkBlue } } }, fields: "userEnteredFormat.textFormat" } },
            { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 1, endColumnIndex: SHEET_COLUMNS }, cell: { userEnteredFormat: { horizontalAlignment: "LEFT", padding: { left: 12, right: 12, top: 8, bottom: 8 } } }, fields: "userEnteredFormat(horizontalAlignment,padding)" } },
            { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: rowNumber - 1, endIndex: rowNumber }, properties: { pixelSize: 54 }, fields: "pixelSize" } }
        );
    });

    (topSummaryValueRows || []).forEach((rowNumber) => {
        requests.push(
            { mergeCells: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 0, endColumnIndex: 5 }, mergeType: "MERGE_ALL" } },
            { mergeCells: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 5, endColumnIndex: SHEET_COLUMNS }, mergeType: "MERGE_ALL" } },
            { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 0, endColumnIndex: 5 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.97, green: 0.98, blue: 1.0 }, textFormat: { bold: true, foregroundColor: darkBlue, fontSize: 10 }, horizontalAlignment: "LEFT", verticalAlignment: "MIDDLE", wrapStrategy: "WRAP", padding: { left: 12, right: 10, top: 7, bottom: 7 } } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy,padding)" } },
            { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 5, endColumnIndex: SHEET_COLUMNS }, cell: { userEnteredFormat: { backgroundColor: { red: 0.97, green: 0.98, blue: 1.0 }, textFormat: { bold: true, foregroundColor: darkBlue, fontSize: 10 }, horizontalAlignment: "LEFT", verticalAlignment: "MIDDLE", wrapStrategy: "WRAP", padding: { left: 12, right: 10, top: 7, bottom: 7 } } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy,padding)" } },
            { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: rowNumber - 1, endIndex: rowNumber }, properties: { pixelSize: 38 }, fields: "pixelSize" } }
        );
    });

    headerRows.forEach((rowNumber) => {
        requests.push(
            { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 0, endColumnIndex: SHEET_COLUMNS }, cell: { userEnteredFormat: { backgroundColor: lightBlue, textFormat: { bold: true, foregroundColor: darkBlue, fontSize: 11 }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE", wrapStrategy: "WRAP", padding: { left: 8, right: 8, top: 7, bottom: 7 } } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy,padding)" } },
            { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: rowNumber - 1, endIndex: rowNumber }, properties: { pixelSize: 48 }, fields: "pixelSize" } }
        );
    });

    spacerRows.forEach((rowNumber) => {
        requests.push(
            { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 0, endColumnIndex: SHEET_COLUMNS }, cell: { userEnteredFormat: { backgroundColor: softSlate } }, fields: "userEnteredFormat.backgroundColor" } },
            { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: rowNumber - 1, endIndex: rowNumber }, properties: { pixelSize: 14 }, fields: "pixelSize" } }
        );
    });

    dataRanges.forEach((range) => {
        for (let row = range.startRow; row <= range.endRow; row += 1) {
            if ((row - range.startRow) % 2 !== 1) continue;
            requests.push({
                repeatCell: {
                    range: { sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 0, endColumnIndex: SHEET_COLUMNS },
                    cell: { userEnteredFormat: { backgroundColor: rowOdd } },
                    fields: "userEnteredFormat.backgroundColor"
                }
            });
        }
    });

    totalRows.forEach((rowNumber) => {
        requests.push(
            { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 0, endColumnIndex: SHEET_COLUMNS }, cell: { userEnteredFormat: { backgroundColor: totalFill, textFormat: { bold: true, fontSize: 10, foregroundColor: darkBlue } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } },
            { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: rowNumber - 1, endIndex: rowNumber }, properties: { pixelSize: 31 }, fields: "pixelSize" } }
        );
    });

    revenueRows.forEach((rowNumber) => {
        requests.push({
            repeatCell: {
                range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 2, endColumnIndex: SHEET_COLUMNS },
                cell: { userEnteredFormat: { backgroundColor: revenueFill, textFormat: { bold: true, foregroundColor: revenueText } } },
                fields: "userEnteredFormat(backgroundColor,textFormat)"
            }
        });
    });

    currentRevenueRows.forEach((rowNumber) => {
        requests.push({
            repeatCell: {
                range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 2, endColumnIndex: SHEET_COLUMNS },
                cell: { userEnteredFormat: { backgroundColor: currentRevenueFill, textFormat: { bold: true, foregroundColor: currentRevenueText } } },
                fields: "userEnteredFormat(backgroundColor,textFormat)"
            }
        });
    });

    occupancyRows.forEach((rowNumber) => {
        requests.push({
            repeatCell: {
                range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 2, endColumnIndex: SHEET_COLUMNS },
                cell: { userEnteredFormat: { backgroundColor: occupancyFill, textFormat: { bold: true, foregroundColor: occupancyText }, numberFormat: { type: "PERCENT", pattern: "0.0%" } } },
                fields: "userEnteredFormat(backgroundColor,textFormat,numberFormat)"
            }
        });
    });

    currentOccupancyRows.forEach((rowNumber) => {
        requests.push({
            repeatCell: {
                range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 2, endColumnIndex: SHEET_COLUMNS },
                cell: { userEnteredFormat: { backgroundColor: currentOccupancyFill, textFormat: { bold: true, foregroundColor: currentOccupancyText }, numberFormat: { type: "PERCENT", pattern: "0.0%" } } },
                fields: "userEnteredFormat(backgroundColor,textFormat,numberFormat)"
            }
        });
    });

    adrRows.forEach((rowNumber) => {
        requests.push({
            repeatCell: {
                range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 2, endColumnIndex: SHEET_COLUMNS },
                cell: { userEnteredFormat: { backgroundColor: adrFill, textFormat: { bold: true, foregroundColor: adrText } } },
                fields: "userEnteredFormat(backgroundColor,textFormat)"
            }
        });
    });

    currentAdrRows.forEach((rowNumber) => {
        requests.push({
            repeatCell: {
                range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 2, endColumnIndex: SHEET_COLUMNS },
                cell: { userEnteredFormat: { backgroundColor: currentAdrFill, textFormat: { bold: true, foregroundColor: currentAdrText } } },
                fields: "userEnteredFormat(backgroundColor,textFormat)"
            }
        });
    });

    (buildingCurrencyRows || []).forEach((rowNumber) => {
        [[5, revenueText], [6, currentRevenueText], [10, adrText], [11, currentAdrText], [13, revenueText]].forEach(([colIndex, fg]) => {
            requests.push({
                repeatCell: {
                    range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: colIndex, endColumnIndex: colIndex + 1 },
                    cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: fg }, horizontalAlignment: "RIGHT" } },
                    fields: "userEnteredFormat(textFormat,horizontalAlignment)"
                }
            });
        });
        requests.push(
            {
                repeatCell: {
                    range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 0, endColumnIndex: 4 },
                    cell: { userEnteredFormat: { backgroundColor: softSlate, horizontalAlignment: "CENTER", textFormat: { bold: true, foregroundColor: darkBlue } } },
                    fields: "userEnteredFormat(backgroundColor,horizontalAlignment,textFormat)"
                }
            },
            {
                repeatCell: {
                    range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 12, endColumnIndex: 13 },
                    cell: { userEnteredFormat: { backgroundColor: { red: 0.97, green: 0.98, blue: 1.0 }, verticalAlignment: "TOP", horizontalAlignment: "LEFT", wrapStrategy: "WRAP", padding: { left: 12, right: 12, top: 8, bottom: 8 } } },
                    fields: "userEnteredFormat(backgroundColor,verticalAlignment,horizontalAlignment,wrapStrategy,padding)"
                }
            },
            {
                repeatCell: {
                    range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 13, endColumnIndex: 14 },
                    cell: { userEnteredFormat: { verticalAlignment: "MIDDLE", horizontalAlignment: "RIGHT", padding: { left: 8, right: 12, top: 6, bottom: 6 } } },
                    fields: "userEnteredFormat(verticalAlignment,horizontalAlignment,padding)"
                }
            }
        );
    });

    (buildingInsightRows || []).forEach((rowNumber) => {
        requests.push(
            { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: rowNumber - 1, endIndex: rowNumber }, properties: { pixelSize: 72 }, fields: "pixelSize" } },
            { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 12, endColumnIndex: 13 }, cell: { userEnteredFormat: { verticalAlignment: "TOP", horizontalAlignment: "LEFT", wrapStrategy: "WRAP" } }, fields: "userEnteredFormat(verticalAlignment,horizontalAlignment,wrapStrategy)" } }
        );
    });

    (scenarioMoneyRows || []).forEach((rowNumber) => {
        [[2, currentRevenueText], [5, currentAdrText], [6, revenueText], [8, adrText], [10, revenueText], [11, adrText], [12, occupancyText]].forEach(([colIndex, fg]) => {
            requests.push({
                repeatCell: {
                    range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: colIndex, endColumnIndex: colIndex + 1 },
                    cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: fg }, horizontalAlignment: "RIGHT" } },
                    fields: "userEnteredFormat(textFormat,horizontalAlignment)"
                }
            });
        });
        [3, 7].forEach((colIndex) => {
            requests.push({
                repeatCell: {
                    range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: colIndex, endColumnIndex: colIndex + 1 },
                    cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: occupancyText }, horizontalAlignment: "RIGHT" } },
                    fields: "userEnteredFormat(textFormat,horizontalAlignment)"
                }
            });
        });
        requests.push(
            {
                repeatCell: {
                    range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 0, endColumnIndex: 2 },
                    cell: { userEnteredFormat: { backgroundColor: softSlate, textFormat: { bold: true, foregroundColor: darkBlue }, horizontalAlignment: "LEFT" } },
                    fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)"
                }
            },
            {
                updateDimensionProperties: {
                    range: { sheetId, dimension: "ROWS", startIndex: rowNumber - 1, endIndex: rowNumber },
                    properties: { pixelSize: 48 },
                    fields: "pixelSize"
                }
            }
        );
    });

    factorNarrativeRows.forEach((rowNumber) => {
        requests.push(
            { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: rowNumber - 1, endIndex: rowNumber }, properties: { pixelSize: 122 }, fields: "pixelSize" } },
            { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 1, endColumnIndex: SHEET_COLUMNS }, cell: { userEnteredFormat: { verticalAlignment: "TOP", padding: { left: 10, right: 10, top: 8, bottom: 8 } } }, fields: "userEnteredFormat(verticalAlignment,padding)" } }
        );
    });

    (buildingGroupStartRows || []).forEach((rowNumber) => {
        requests.push({
            updateBorders: {
                range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 0, endColumnIndex: SHEET_COLUMNS },
                top: borderMed
            }
        });
    });

    (scenarioGroupStartRows || []).forEach((rowNumber) => {
        requests.push(
            {
                updateBorders: {
                    range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber + 2, startColumnIndex: 0, endColumnIndex: SHEET_COLUMNS },
                    top: borderMed,
                    bottom: borderThin
                }
            },
            {
                repeatCell: {
                    range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber + 2, startColumnIndex: 0, endColumnIndex: 2 },
                    cell: { userEnteredFormat: { backgroundColor: softSlate, textFormat: { bold: true, foregroundColor: darkBlue } } },
                    fields: "userEnteredFormat(backgroundColor,textFormat)"
                }
            }
        );
    });

    (buildingScenarioStyleRows || []).forEach(({ row, scenarioKey }) => {
        const palette = buildingScenarioColors[scenarioKey];
        if (!palette) return;
        requests.push(
            {
                repeatCell: {
                    range: { sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 1, endColumnIndex: 2 },
                    cell: {
                        userEnteredFormat: {
                            backgroundColor: palette.labelBg,
                            textFormat: { bold: true, foregroundColor: palette.labelFg },
                            horizontalAlignment: "CENTER",
                            verticalAlignment: "MIDDLE"
                        }
                    },
                    fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
                }
            },
            {
                repeatCell: {
                    range: { sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 2, endColumnIndex: SHEET_COLUMNS },
                    cell: { userEnteredFormat: { backgroundColor: palette.rowBg } },
                    fields: "userEnteredFormat.backgroundColor"
                }
            }
        );
    });

    (countrySeasonHeaderRows || []).forEach((rowNumber) => {
        requests.push(
            { mergeCells: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 2, endColumnIndex: 5 }, mergeType: "MERGE_ALL" } },
            { mergeCells: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 5, endColumnIndex: 8 }, mergeType: "MERGE_ALL" } },
            { mergeCells: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 8, endColumnIndex: 11 }, mergeType: "MERGE_ALL" } },
            { mergeCells: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 11, endColumnIndex: 14 }, mergeType: "MERGE_ALL" } },
            { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 0, endColumnIndex: 2 }, cell: { userEnteredFormat: { backgroundColor: softSlate, textFormat: { bold: true, foregroundColor: darkBlue }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)" } },
            { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 2, endColumnIndex: 11 }, cell: { userEnteredFormat: { horizontalAlignment: "LEFT", verticalAlignment: "MIDDLE", padding: { left: 12, right: 10, top: 7, bottom: 7 } } }, fields: "userEnteredFormat(horizontalAlignment,verticalAlignment,padding)" } },
            { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 11, endColumnIndex: 14 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.96, green: 0.97, blue: 0.99 }, horizontalAlignment: "LEFT", verticalAlignment: "MIDDLE", padding: { left: 12, right: 12, top: 7, bottom: 7 } } }, fields: "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,padding)" } },
            { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: rowNumber - 1, endIndex: rowNumber }, properties: { pixelSize: 42 }, fields: "pixelSize" } }
        );
    });

    (countrySeasonRows || []).forEach((rowNumber) => {
        requests.push(
            { mergeCells: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 2, endColumnIndex: 5 }, mergeType: "MERGE_ALL" } },
            { mergeCells: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 5, endColumnIndex: 8 }, mergeType: "MERGE_ALL" } },
            { mergeCells: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 8, endColumnIndex: 11 }, mergeType: "MERGE_ALL" } },
            { mergeCells: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 11, endColumnIndex: 14 }, mergeType: "MERGE_ALL" } },
            { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: rowNumber - 1, endIndex: rowNumber }, properties: { pixelSize: 84 }, fields: "pixelSize" } },
            { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 0, endColumnIndex: 2 }, cell: { userEnteredFormat: { backgroundColor: softSlate, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE", textFormat: { bold: true, foregroundColor: darkBlue } } }, fields: "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)" } },
            { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 2, endColumnIndex: 11 }, cell: { userEnteredFormat: { horizontalAlignment: "LEFT", wrapStrategy: "WRAP", verticalAlignment: "TOP", padding: { left: 12, right: 10, top: 8, bottom: 8 } } }, fields: "userEnteredFormat(horizontalAlignment,wrapStrategy,verticalAlignment,padding)" } },
            { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 11, endColumnIndex: 14 }, cell: { userEnteredFormat: { backgroundColor: { red: 0.97, green: 0.98, blue: 1.0 }, horizontalAlignment: "LEFT", wrapStrategy: "WRAP", verticalAlignment: "TOP", padding: { left: 12, right: 12, top: 8, bottom: 8 } } }, fields: "userEnteredFormat(backgroundColor,horizontalAlignment,wrapStrategy,verticalAlignment,padding)" } }
        );
    });

    validationRows.forEach((rowNumber) => {
        requests.push(
            { mergeCells: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 1, endColumnIndex: SHEET_COLUMNS }, mergeType: "MERGE_ALL" } },
            { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: rowNumber - 1, endIndex: rowNumber }, properties: { pixelSize: 60 }, fields: "pixelSize" } },
            { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { backgroundColor: softSlate, textFormat: { bold: true, foregroundColor: darkBlue }, horizontalAlignment: "LEFT", verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)" } },
            { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 1, endColumnIndex: SHEET_COLUMNS }, cell: { userEnteredFormat: { backgroundColor: { red: 0.97, green: 0.98, blue: 1.0 }, horizontalAlignment: "LEFT", verticalAlignment: "MIDDLE", wrapStrategy: "WRAP", padding: { left: 12, right: 12, top: 8, bottom: 8 } } }, fields: "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,padding)" } }
        );
    });

    textInsightRows.forEach((rowNumber) => {
        requests.push({
            repeatCell: {
                range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 1, endColumnIndex: SHEET_COLUMNS },
                cell: { userEnteredFormat: { horizontalAlignment: "LEFT", wrapStrategy: "WRAP" } },
                fields: "userEnteredFormat(horizontalAlignment,wrapStrategy)"
            }
        });
    });

    (overallSummaryRows || []).forEach((rowNumber) => {
        requests.push(
            { mergeCells: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 0, endColumnIndex: 2 }, mergeType: "MERGE_ALL" } },
            ...SUMMARY_MONTH_RANGES.map(({ start, end }) => ({ mergeCells: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: start, endColumnIndex: end }, mergeType: "MERGE_ALL" } })),
            { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 0, endColumnIndex: 2 }, cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: darkBlue }, backgroundColor: softSlate, horizontalAlignment: "LEFT", verticalAlignment: "MIDDLE", padding: { left: 12, right: 10, top: 6, bottom: 6 } } }, fields: "userEnteredFormat(textFormat,backgroundColor,horizontalAlignment,verticalAlignment,padding)" } },
            { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 2, endColumnIndex: SHEET_COLUMNS }, cell: { userEnteredFormat: { horizontalAlignment: "RIGHT", verticalAlignment: "MIDDLE", padding: { left: 10, right: 12, top: 6, bottom: 6 } } }, fields: "userEnteredFormat(horizontalAlignment,verticalAlignment,padding)" } }
        );
    });

    (scenarioOverviewRows || []).forEach((rowNumber) => {
        requests.push(
            { mergeCells: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 2, endColumnIndex: 6 }, mergeType: "MERGE_ALL" } },
            { mergeCells: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 6, endColumnIndex: 10 }, mergeType: "MERGE_ALL" } },
            { mergeCells: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 10, endColumnIndex: 14 }, mergeType: "MERGE_ALL" } },
            { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 0, endColumnIndex: 2 }, cell: { userEnteredFormat: { backgroundColor: softSlate, textFormat: { bold: true, foregroundColor: darkBlue } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } },
            { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 2, endColumnIndex: 14 }, cell: { userEnteredFormat: { horizontalAlignment: "RIGHT", verticalAlignment: "MIDDLE", padding: { left: 10, right: 12, top: 6, bottom: 6 } } }, fields: "userEnteredFormat(horizontalAlignment,verticalAlignment,padding)" } }
        );
    });

    (scenarioOverviewTopHeaderRows || []).forEach((rowNumber) => {
        requests.push(
            ...SCENARIO_MONTH_RANGES.map(({ start, end }) => ({ mergeCells: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: start, endColumnIndex: end }, mergeType: "MERGE_ALL" } })),
            { mergeCells: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: SCENARIO_NOTES_START_COLUMN, endColumnIndex: SHEET_COLUMNS }, mergeType: "MERGE_ALL" } },
            { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 0, endColumnIndex: SHEET_COLUMNS }, cell: { userEnteredFormat: { backgroundColor: lightBlue, textFormat: { bold: true, foregroundColor: darkBlue, fontSize: 11 }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE", padding: { left: 8, right: 8, top: 7, bottom: 7 } } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding)" } },
            ...separatorRequests(SCENARIO_SEPARATOR_COLUMNS, rowNumber - 1, rowNumber),
            { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: rowNumber - 1, endIndex: rowNumber }, properties: { pixelSize: 38 }, fields: "pixelSize" } }
        );
    });

    (scenarioOverviewSubHeaderRows || []).forEach((rowNumber) => {
        requests.push(
            { mergeCells: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: SCENARIO_NOTES_START_COLUMN, endColumnIndex: SHEET_COLUMNS }, mergeType: "MERGE_ALL" } },
            { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 0, endColumnIndex: SHEET_COLUMNS }, cell: { userEnteredFormat: { backgroundColor: softSlate, textFormat: { bold: true, foregroundColor: darkBlue, fontSize: 10 }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE", padding: { left: 8, right: 8, top: 6, bottom: 6 } } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding)" } },
            ...separatorRequests(SCENARIO_SEPARATOR_COLUMNS, rowNumber - 1, rowNumber),
            { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: rowNumber - 1, endIndex: rowNumber }, properties: { pixelSize: 34 }, fields: "pixelSize" } }
        );
    });

    const scenarioOverviewMetricStyles = [
        { rows: scenarioOverviewRevenueRows || [], currentFill: currentRevenueFill, currentTextColor: currentRevenueText, targetFill: revenueFill, targetTextColor: revenueText },
        { rows: scenarioOverviewOccupancyRows || [], currentFill: currentOccupancyFill, currentTextColor: currentOccupancyText, targetFill: occupancyFill, targetTextColor: occupancyText },
        { rows: scenarioOverviewAdrRows || [], currentFill: currentAdrFill, currentTextColor: currentAdrText, targetFill: adrFill, targetTextColor: adrText }
    ];

    scenarioOverviewMetricStyles.forEach(({ rows, currentFill, currentTextColor, targetFill, targetTextColor }) => {
        rows.forEach((rowNumber) => {
            requests.push(
                { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 0, endColumnIndex: 2 }, cell: { userEnteredFormat: { backgroundColor: softSlate, textFormat: { bold: true, foregroundColor: darkBlue }, horizontalAlignment: "LEFT", verticalAlignment: "MIDDLE", padding: { left: 12, right: 8, top: 6, bottom: 6 } } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding)" } },
                ...SCENARIO_MONTH_RANGES.flatMap(({ start }) => ([
                    { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: start, endColumnIndex: start + 1 }, cell: { userEnteredFormat: { backgroundColor: currentFill, textFormat: { bold: true, foregroundColor: currentTextColor }, horizontalAlignment: "RIGHT", verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)" } },
                    { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: start + 1, endColumnIndex: start + 2 }, cell: { userEnteredFormat: { backgroundColor: targetFill, textFormat: { bold: true, foregroundColor: targetTextColor }, horizontalAlignment: "RIGHT", verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)" } }
                ])),
                { mergeCells: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: SCENARIO_NOTES_START_COLUMN, endColumnIndex: SHEET_COLUMNS }, mergeType: "MERGE_ALL" } },
                { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: SCENARIO_NOTES_START_COLUMN, endColumnIndex: SHEET_COLUMNS }, cell: { userEnteredFormat: { backgroundColor: { red: 0.97, green: 0.98, blue: 1.0 }, horizontalAlignment: "LEFT", verticalAlignment: "TOP", wrapStrategy: "WRAP", textFormat: { fontSize: 10 }, padding: { left: 12, right: 12, top: 5, bottom: 5 } } }, fields: "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,textFormat,padding)" } },
                ...separatorRequests(SCENARIO_SEPARATOR_COLUMNS, rowNumber - 1, rowNumber),
                { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: rowNumber - 1, endIndex: rowNumber }, properties: { pixelSize: 74 }, fields: "pixelSize" } }
            );
        });
    });

    (scenarioOverviewGroupStartRows || []).forEach((rowNumber) => {
        requests.push(
            { mergeCells: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber + 2, startColumnIndex: 0, endColumnIndex: 1 }, mergeType: "MERGE_ALL" } },
            { updateBorders: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber + 2, startColumnIndex: 0, endColumnIndex: SHEET_COLUMNS }, top: borderMed, bottom: borderThin } }
        );
    });

    textInsightRows.forEach((rowNumber) => {
        requests.push({
            repeatCell: {
                range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: 1, endColumnIndex: SHEET_COLUMNS },
                cell: { userEnteredFormat: { horizontalAlignment: "LEFT", wrapStrategy: "WRAP", verticalAlignment: "MIDDLE" } },
                fields: "userEnteredFormat(horizontalAlignment,wrapStrategy,verticalAlignment)"
            }
        });
    });

    pricingPanelTitleRows.forEach((rowNumber) => {
        requests.push(
            { mergeCells: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: PRICING_PANEL_RANGES[0].start, endColumnIndex: PRICING_PANEL_RANGES[0].end }, mergeType: "MERGE_ALL" } },
            { mergeCells: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: PRICING_PANEL_RANGES[1].start, endColumnIndex: PRICING_PANEL_RANGES[1].end }, mergeType: "MERGE_ALL" } },
            { mergeCells: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: PRICING_PANEL_RANGES[2].start, endColumnIndex: PRICING_PANEL_RANGES[2].end }, mergeType: "MERGE_ALL" } },
            { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: PRICING_PANEL_RANGES[0].start, endColumnIndex: PRICING_PANEL_RANGES[0].end }, cell: { userEnteredFormat: { backgroundColor: pricingGreenTitle, textFormat: { bold: true, fontSize: 12, foregroundColor: white }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE", padding: { left: 10, right: 10, top: 8, bottom: 8 } } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding)" } },
            { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: PRICING_PANEL_RANGES[1].start, endColumnIndex: PRICING_PANEL_RANGES[1].end }, cell: { userEnteredFormat: { backgroundColor: pricingBlueTitle, textFormat: { bold: true, fontSize: 12, foregroundColor: white }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE", padding: { left: 10, right: 10, top: 8, bottom: 8 } } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding)" } },
            { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: PRICING_PANEL_RANGES[2].start, endColumnIndex: PRICING_PANEL_RANGES[2].end }, cell: { userEnteredFormat: { backgroundColor: pricingPurpleTitle, textFormat: { bold: true, fontSize: 12, foregroundColor: white }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE", padding: { left: 10, right: 10, top: 8, bottom: 8 } } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding)" } },
            ...separatorRequests(PRICING_SEPARATOR_COLUMNS, rowNumber - 1, rowNumber),
            { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: rowNumber - 1, endIndex: rowNumber }, properties: { pixelSize: 34 }, fields: "pixelSize" } }
        );
    });

    pricingPanelHeaderRows.forEach((rowNumber) => {
        requests.push(
            { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: PRICING_PANEL_RANGES[0].start, endColumnIndex: PRICING_PANEL_RANGES[0].end }, cell: { userEnteredFormat: { backgroundColor: pricingGreenFill, textFormat: { bold: true, foregroundColor: pricingGreenTitle, fontSize: 10 }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE", padding: { left: 8, right: 8, top: 7, bottom: 7 } } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding)" } },
            { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: PRICING_PANEL_RANGES[1].start, endColumnIndex: PRICING_PANEL_RANGES[1].end }, cell: { userEnteredFormat: { backgroundColor: pricingBlueFill, textFormat: { bold: true, foregroundColor: pricingBlueTitle, fontSize: 10 }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE", padding: { left: 8, right: 8, top: 7, bottom: 7 } } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding)" } },
            { repeatCell: { range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: PRICING_PANEL_RANGES[2].start, endColumnIndex: PRICING_PANEL_RANGES[2].end }, cell: { userEnteredFormat: { backgroundColor: pricingPurpleFill, textFormat: { bold: true, foregroundColor: pricingPurpleTitle, fontSize: 10 }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE", padding: { left: 8, right: 8, top: 7, bottom: 7 } } }, fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,padding)" } },
            ...separatorRequests(PRICING_SEPARATOR_COLUMNS, rowNumber - 1, rowNumber),
            { updateDimensionProperties: { range: { sheetId, dimension: "ROWS", startIndex: rowNumber - 1, endIndex: rowNumber }, properties: { pixelSize: 34 }, fields: "pixelSize" } }
        );
    });

    pricingBodyRanges.forEach((range) => {
        requests.push(
            { repeatCell: { range: { sheetId, startRowIndex: range.startRow - 1, endRowIndex: range.endRow, startColumnIndex: PRICING_PANEL_RANGES[0].start, endColumnIndex: PRICING_PANEL_RANGES[0].end }, cell: { userEnteredFormat: { backgroundColor: pricingGreenFill } }, fields: "userEnteredFormat.backgroundColor" } },
            { repeatCell: { range: { sheetId, startRowIndex: range.startRow - 1, endRowIndex: range.endRow, startColumnIndex: PRICING_PANEL_RANGES[1].start, endColumnIndex: PRICING_PANEL_RANGES[1].end }, cell: { userEnteredFormat: { backgroundColor: pricingBlueFill } }, fields: "userEnteredFormat.backgroundColor" } },
            { repeatCell: { range: { sheetId, startRowIndex: range.startRow - 1, endRowIndex: range.endRow, startColumnIndex: PRICING_PANEL_RANGES[2].start, endColumnIndex: PRICING_PANEL_RANGES[2].end }, cell: { userEnteredFormat: { backgroundColor: pricingPurpleFill } }, fields: "userEnteredFormat.backgroundColor" } },
            ...separatorRequests(PRICING_SEPARATOR_COLUMNS, range.startRow - 1, range.endRow),
            { repeatCell: { range: { sheetId, startRowIndex: range.startRow - 1, endRowIndex: range.endRow, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: pricingGreenTitle, fontSize: 10 }, horizontalAlignment: "LEFT", wrapStrategy: "WRAP", verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat(textFormat,horizontalAlignment,wrapStrategy,verticalAlignment)" } },
            { repeatCell: { range: { sheetId, startRowIndex: range.startRow - 1, endRowIndex: range.endRow, startColumnIndex: PRICING_PANEL_RANGES[1].start, endColumnIndex: PRICING_PANEL_RANGES[1].start + 1 }, cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: pricingBlueTitle, fontSize: 10 }, horizontalAlignment: "LEFT", wrapStrategy: "WRAP", verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat(textFormat,horizontalAlignment,wrapStrategy,verticalAlignment)" } },
            { repeatCell: { range: { sheetId, startRowIndex: range.startRow - 1, endRowIndex: range.endRow, startColumnIndex: PRICING_PANEL_RANGES[2].start, endColumnIndex: PRICING_PANEL_RANGES[2].start + 1 }, cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: pricingPurpleTitle, fontSize: 10 }, horizontalAlignment: "LEFT", wrapStrategy: "WRAP", verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat(textFormat,horizontalAlignment,wrapStrategy,verticalAlignment)" } },
            { repeatCell: { range: { sheetId, startRowIndex: range.startRow - 1, endRowIndex: range.endRow, startColumnIndex: 1, endColumnIndex: 5 }, cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: revenueText, fontSize: 10 }, horizontalAlignment: "RIGHT", verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)" } },
            { repeatCell: { range: { sheetId, startRowIndex: range.startRow - 1, endRowIndex: range.endRow, startColumnIndex: PRICING_PANEL_RANGES[1].start + 1, endColumnIndex: PRICING_PANEL_RANGES[1].end }, cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: occupancyText, fontSize: 10 }, horizontalAlignment: "RIGHT", verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)" } },
            { repeatCell: { range: { sheetId, startRowIndex: range.startRow - 1, endRowIndex: range.endRow, startColumnIndex: PRICING_PANEL_RANGES[2].start + 1, endColumnIndex: SHEET_COLUMNS - 1 }, cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: adrText, fontSize: 10 }, horizontalAlignment: "RIGHT", verticalAlignment: "MIDDLE" } }, fields: "userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)" } },
            { repeatCell: { range: { sheetId, startRowIndex: range.startRow - 1, endRowIndex: range.endRow, startColumnIndex: 1, endColumnIndex: 5 }, cell: { userEnteredFormat: { horizontalAlignment: "RIGHT", textFormat: { fontSize: 10 } } }, fields: "userEnteredFormat(horizontalAlignment,textFormat.fontSize)" } },
            { repeatCell: { range: { sheetId, startRowIndex: range.startRow - 1, endRowIndex: range.endRow, startColumnIndex: PRICING_PANEL_RANGES[1].start + 1, endColumnIndex: PRICING_PANEL_RANGES[1].end }, cell: { userEnteredFormat: { horizontalAlignment: "RIGHT", textFormat: { fontSize: 10 } } }, fields: "userEnteredFormat(horizontalAlignment,textFormat.fontSize)" } },
            { repeatCell: { range: { sheetId, startRowIndex: range.startRow - 1, endRowIndex: range.endRow, startColumnIndex: PRICING_PANEL_RANGES[2].start + 1, endColumnIndex: SHEET_COLUMNS - 1 }, cell: { userEnteredFormat: { horizontalAlignment: "RIGHT", textFormat: { fontSize: 10 } } }, fields: "userEnteredFormat(horizontalAlignment,textFormat.fontSize)" } },
            { updateBorders: { range: { sheetId, startRowIndex: range.startRow - 2, endRowIndex: range.endRow, startColumnIndex: PRICING_PANEL_RANGES[0].start, endColumnIndex: PRICING_PANEL_RANGES[0].end }, top: borderMed, bottom: borderMed, left: borderMed, right: borderMed, innerHorizontal: borderThin, innerVertical: borderThin } },
            { updateBorders: { range: { sheetId, startRowIndex: range.startRow - 2, endRowIndex: range.endRow, startColumnIndex: PRICING_PANEL_RANGES[1].start, endColumnIndex: PRICING_PANEL_RANGES[1].end }, top: borderMed, bottom: borderMed, left: borderMed, right: borderMed, innerHorizontal: borderThin, innerVertical: borderThin } },
            { updateBorders: { range: { sheetId, startRowIndex: range.startRow - 2, endRowIndex: range.endRow, startColumnIndex: PRICING_PANEL_RANGES[2].start, endColumnIndex: PRICING_PANEL_RANGES[2].end }, top: borderMed, bottom: borderMed, left: borderMed, right: borderMed, innerHorizontal: borderThin, innerVertical: borderThin } }
        );
    });

    requests.push(
        { updateBorders: { range: { sheetId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: SHEET_COLUMNS }, top: borderMed, bottom: borderMed, left: borderMed, right: borderMed, innerHorizontal: borderThin, innerVertical: borderThin } }
    );

    // 전년 비교 컬럼 상태별 색상 적용
    (comparisonStatusRows || []).forEach(({ row, statusType, col }) => {
        const colors = COMPARISON_STATUS_COLORS[statusType];
        if (!colors) return;
        requests.push({
            repeatCell: {
                range: { sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: col, endColumnIndex: col + 1 },
                cell: { userEnteredFormat: { backgroundColor: colors.bg, textFormat: { foregroundColor: colors.fg, bold: true, fontSize: 10 } } },
                fields: "userEnteredFormat(backgroundColor,textFormat)"
            }
        });
    });

    return requests;
}

async function updateFutureTargetGoalsSheet({
    sheets,
    spreadsheetId,
    meta,
    tokyoNow,
    dayjs,
    db,
    companyId,
    BUILDING_ROOMS
}) {
    if (!db || !companyId || !BUILDING_ROOMS) {
        throw new Error("updateFutureTargetGoalsSheet 누락: db/companyId/BUILDING_ROOMS");
    }

    console.log(`📈 [Target Goals] ${TARGET_SHEET_TITLE} 갱신 시작...`);
    const allReservations = await fetchConfirmedReservations(db, companyId);
    const reportData = computeFutureTargetGoalsData({ dayjs, tokyoNow, BUILDING_ROOMS, allReservations });
    const {
        rows,
        sectionRows,
        headerRows,
        dataRanges,
        spacerRows,
        totalRows,
        revenueRows,
        currentRevenueRows,
        occupancyRows,
        currentOccupancyRows,
        adrRows,
        currentAdrRows,
        mergedContentRows,
        factorNarrativeRows,
        validationRows,
        textInsightRows,
        pricingPanelTitleRows,
        pricingPanelHeaderRows,
        pricingBodyRanges,
        overallSummaryRows,
        scenarioOverviewRows,
        topSummaryValueRows,
        scenarioOverviewTopHeaderRows,
        scenarioOverviewSubHeaderRows,
        scenarioOverviewRevenueRows,
        scenarioOverviewOccupancyRows,
        scenarioOverviewAdrRows,
        scenarioOverviewGroupStartRows,
        buildingCurrencyRows,
        buildingInsightRows,
        scenarioMoneyRows,
        buildingScenarioStyleRows,
        buildingGroupStartRows,
        scenarioGroupStartRows,
        countrySeasonRows,
        countrySeasonHeaderRows,
        comparisonStatusRows
    } = buildSheetRowsExpanded(reportData);

    let targetSheet = (meta?.data?.sheets || []).find((sheet) => sheet.properties.title === TARGET_SHEET_TITLE);
    let sheetId = targetSheet?.properties?.sheetId || null;
    if (!sheetId) {
        const res = await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            resource: { requests: [{ addSheet: { properties: { title: TARGET_SHEET_TITLE, tabColorStyle: { rgbColor: { red: 0.87, green: 0.43, blue: 0.14 } } } } }] }
        });
        sheetId = res.data.replies[0].addSheet.properties.sheetId;
        targetSheet = { properties: { sheetId } };
    }

    await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: `${TARGET_SHEET_TITLE}!A1:R950`
    });
    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${TARGET_SHEET_TITLE}!A1`,
        valueInputOption: "USER_ENTERED",
        resource: { values: rows }
    });
    await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
            requests: buildFormatRequests({
                sheetId,
                rowCount: rows.length,
                sectionRows,
                headerRows,
                dataRanges,
                spacerRows,
                totalRows,
                revenueRows,
                currentRevenueRows,
                occupancyRows,
                currentOccupancyRows,
                adrRows,
                currentAdrRows,
                mergedContentRows,
                factorNarrativeRows,
                validationRows,
                textInsightRows,
                pricingPanelTitleRows,
                pricingPanelHeaderRows,
                pricingBodyRanges,
                overallSummaryRows,
                scenarioOverviewRows,
                topSummaryValueRows,
                scenarioOverviewTopHeaderRows,
                scenarioOverviewSubHeaderRows,
                scenarioOverviewRevenueRows,
                scenarioOverviewOccupancyRows,
                scenarioOverviewAdrRows,
                scenarioOverviewGroupStartRows,
                buildingCurrencyRows,
                buildingInsightRows,
                scenarioMoneyRows,
                buildingScenarioStyleRows,
                buildingGroupStartRows,
                scenarioGroupStartRows,
                countrySeasonRows,
                countrySeasonHeaderRows,
                comparisonStatusRows
            })
        }
    });

    console.log(`✅[Target Goals] ${TARGET_SHEET_TITLE} 갱신 완료 (${reportData.targetMonths.join(", ")})`);
    return reportData;
}

module.exports = {
    TARGET_SHEET_TITLE,
    computeFutureTargetGoalsData,
    updateFutureTargetGoalsSheet
};
