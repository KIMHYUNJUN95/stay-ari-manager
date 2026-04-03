const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const axios = require("axios");
const admin = require("firebase-admin");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);
const cors = require("cors")({ origin: true });
const { createSlackReportModule } = require("./modules/slackReports");
const { createGoogleSheetReportModule } = require("./modules/googleSheetReports");
const { createNotionReportModule } = require("./modules/notionReports");
const { NOTION_PAGES, syncNotionSalesDashboard, syncNotionOccupancyDashboard, syncNotionPaxOccupancy, testNotionConnection } = require("./modules/notionReportSync");
const { computeRevenueDashboardData } = require("./modules/revenueDashboardData");
const { getMonthlyRevenueChartUrl, getBuildingRevenueChartUrl } = require("./modules/chartImage");
const { sendSameDayBookingAlert } = require("./modules/sameDayBookingAlert");
const { sendCancelAlert } = require("./modules/cancelAlert"); // cancelAlert.js 수정 시 Functions 재배포

if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();

// ==========================================
// 1) CONSTANTS & MAPPING (사용자 정보 포함)
// ==========================================
// const BEDS24_API_KEY = "REMOVED_FOR_V2"; // V2로 완전 전환되어 사용하지 않음

// ==========================================
// Beds24 API V2 설정 (Firestore 토큰 캐싱)
// ==========================================
// ★ API 크레딧: 예약/캘린더/가격/메시지 등 모든 기능이 공통으로 200 크레딧 한도 사용.
const BEDS24_REFRESH_TOKEN = "f9dBEWviugAGMcPCPMoRIOG7OpguLo187eDqsuhzaFKNrPdkISHOBZtZaYHGHc2Kc5uEaVljPfPq/xVbzPn0bkXrj2gf6Ly96bpHrsm9X9XwC4U/CAA/QPK9EgbVbQOEAj5iYME1EobhelKpStKYg1OK7zruxGOehEykt7yT5Mw=";

// 기본 Company ID (환경 변수 또는 하드코딩된 기본값)
// 향후 멀티 테넌트 확장 시 각 회사별 Beds24 토큰 관리 필요
const DEFAULT_COMPANY_ID = process.env.DEFAULT_COMPANY_ID || 'dGxlQyu47LbplLVCVXiV';

// 메모리 캐시 (같은 인스턴스 내에서 Firestore 읽기 최소화)
let beds24AccessToken = null;
let beds24TokenExpiry = 0;

// Firestore 토큰 문서 경로
const TOKEN_DOC_PATH = "beds24_config/token";

// API V2 Access Token 발급/갱신 함수 (Firestore 캐싱)
async function getBeds24Token() {
    const now = Date.now();

    // 1단계: 메모리 캐시 확인 (만료 5분 전까지 사용)
    if (beds24AccessToken && beds24TokenExpiry > now + 300000) {
        return beds24AccessToken;
    }

    // 2단계: Firestore에서 토큰 가져오기
    try {
        const tokenDoc = await db.doc(TOKEN_DOC_PATH).get();
        if (tokenDoc.exists) {
            const data = tokenDoc.data();
            // Firestore 토큰이 유효하면 사용 (만료 5분 전까지)
            if (data.accessToken && data.expiresAt > now + 300000) {
                beds24AccessToken = data.accessToken;
                beds24TokenExpiry = data.expiresAt;
                console.log("Beds24 토큰 Firestore에서 로드 (만료:", new Date(beds24TokenExpiry).toISOString(), ")");
                return beds24AccessToken;
            }
        }
    } catch (firestoreErr) {
        console.warn("Firestore 토큰 조회 실패:", firestoreErr.message);
        // Firestore 실패해도 계속 진행 (토큰 갱신 시도)
    }

    // 3단계: 토큰 갱신 (Beds24 API 호출)
    try {
        console.log("Beds24 토큰 갱신 요청...");
        const response = await axios.get("https://beds24.com/api/v2/authentication/token", {
            headers: {
                "accept": "application/json",
                "refreshToken": BEDS24_REFRESH_TOKEN
            }
        });

        const newToken = response.data.token;
        const newExpiry = now + (response.data.expiresIn * 1000);

        // 메모리 캐시 업데이트
        beds24AccessToken = newToken;
        beds24TokenExpiry = newExpiry;

        // Firestore에 저장 (다른 인스턴스와 공유)
        try {
            await db.doc(TOKEN_DOC_PATH).set({
                accessToken: newToken,
                expiresAt: newExpiry,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log("Beds24 토큰 갱신 완료 & Firestore 저장 (만료:", new Date(newExpiry).toISOString(), ")");
        } catch (saveErr) {
            console.warn("Firestore 토큰 저장 실패:", saveErr.message);
            // 저장 실패해도 메모리에는 있으므로 계속 진행
        }

        return beds24AccessToken;
    } catch (err) {
        console.error("Beds24 토큰 갱신 실패:", err.message);
        throw new Error("Beds24 인증 실패: " + err.message);
    }
}


const PROPERTIES = [
    { name: "아라키초A", id: "NSoH37aJMipHA4K4MPVyp2pnq", v2Id: 176430, companyId: DEFAULT_COMPANY_ID },
    { name: "아라키초B", id: "AV3yKzD2gFz4OmNdlv4qANoQc", v2Id: 280663, companyId: DEFAULT_COMPANY_ID },
    { name: "다이쿄초", id: "CXNtlpJnRuKJDPrTpqOaa3yws", v2Id: 206509, disabled: true, companyId: DEFAULT_COMPANY_ID }, // ★ 매각 완료 (2026-01-25) - API 동기화 중단, 과거 데이터 보존
    { name: "가부키초", id: "3ldwEucRNOIyhAdAhFWbBhw3e", v2Id: 176431, companyId: DEFAULT_COMPANY_ID },
    { name: "다카다노바바", id: "8Nx8VcOYwSYVAwG01xkokmsX7", v2Id: 243936, companyId: DEFAULT_COMPANY_ID },
    { name: "오쿠보A동", id: "dJQloWov7XuXMUmSXyVsLP8LR", v2Id: 205165, companyId: DEFAULT_COMPANY_ID },
    { name: "오쿠보B동", id: "WbtREQENBg6aIR0pgEIympSAv", v2Id: 294552, companyId: DEFAULT_COMPANY_ID },
    { name: "오쿠보C동", id: "MXP5jJXp2mPxVhjdTAF0KnHTP", v2Id: 211056, companyId: DEFAULT_COMPANY_ID },
    { name: "사노시", id: "gDzuVIkyvm5fqtuifdveeIKZO", v2Id: 226546, companyId: DEFAULT_COMPANY_ID }
];

const BEDS24_PROPERTIES_COLLECTION = "beds24_properties";
const BEDS24_PROPERTIES_STATUS_DOC = "properties_sync";

async function fetchAllBeds24Properties() {
    let nextLink = null;
    let pageCount = 0;
    const allProperties = [];

    while (pageCount < 20) {
        let result;
        if (nextLink) {
            const token = await getBeds24Token();
            const pageRes = await axios.get(nextLink, { headers: { token } });
            result = pageRes.data;
        } else {
            const res = await beds24GetV2WithRetry("/properties", {});
            result = res.data;
        }

        if (!result || !Array.isArray(result.data) || result.data.length === 0) break;

        allProperties.push(...result.data);

        if (result.pages?.nextPageExists && result.pages?.nextPageLink) {
            nextLink = result.pages.nextPageLink;
            pageCount++;
            await new Promise(r => setTimeout(r, 200));
        } else {
            break;
        }
    }

    return allProperties;
}

async function syncBeds24Properties({ reason = "manual" } = {}) {
    const properties = await fetchAllBeds24Properties();
    const batch = db.batch();
    const collectionRef = db.collection(BEDS24_PROPERTIES_COLLECTION);

    let mappedCount = 0;
    const unmatchedProperties = [];
    const seenPropertyIds = [];

    properties.forEach((prop) => {
        const propertyId = String(prop.id);
        const staticMatch = PROPERTIES.find((item) => String(item.v2Id) === propertyId) || null;

        if (staticMatch) mappedCount++;
        if (!staticMatch) {
            unmatchedProperties.push({
                propertyId,
                name: prop.name || "",
                ownerId: prop.account?.ownerId || null
            });
        }

        seenPropertyIds.push(propertyId);

        batch.set(collectionRef.doc(propertyId), {
            propertyId,
            name: prop.name || "",
            propertyType: prop.propertyType || "",
            currency: prop.currency || "",
            city: prop.city || "",
            country: prop.country || "",
            ownerId: prop.account?.ownerId || null,
            staticMapped: !!staticMatch,
            mappedBuilding: staticMatch?.name || "",
            disabledInStaticConfig: !!staticMatch?.disabled,
            companyId: staticMatch?.companyId || DEFAULT_COMPANY_ID,
            raw: prop,
            lastSyncedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    });

    batch.set(db.collection("beds24_config").doc(BEDS24_PROPERTIES_STATUS_DOC), {
        reason,
        propertyCount: properties.length,
        mappedCount,
        unmatchedCount: unmatchedProperties.length,
        unmatchedProperties,
        seenPropertyIds,
        lastSyncAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    await batch.commit();

    return {
        propertyCount: properties.length,
        mappedCount,
        unmatchedCount: unmatchedProperties.length,
        unmatchedProperties
    };
}

const RESERVATION_SYNC_SCHEMA_VERSION = "reservation_sync_v20260330";
const RESERVATION_REQUIRED_FIELDS = ["bookId", "status", "building", "room", "arrival", "departure", "companyId"];
const REPORT_SYNC_MAX_AGE_MINUTES = 1440;
const REPORT_INVALID_THRESHOLD = 0;
const RESERVATION_SYNC_STATUS_DOC_ID = "reservations";
const PRICE_SYNC_STATUS_DOC_ID = "prices";
const RESERVATION_FULL_RECONCILE_INTERVAL_MINUTES = 10080; // 웹훅 메인 운영 기준: 깊은 예약 감사는 주 1회만 수행
const PRICE_FULL_RECONCILE_INTERVAL_MINUTES = 360;       // 가격은 웹훅+증분이 있어 full은 6시간 간격으로 완충
const RESERVATION_SYNC_PAST_MONTHS = 6;
const RESERVATION_SYNC_FUTURE_MONTHS = 12;
const RESERVATION_INCREMENTAL_BUFFER_MINUTES = 10;
const BEDS24_REQUEST_SOFT_LIMIT = 120;
const BEDS24_REQUEST_WINDOW_MS = 5 * 60 * 1000;
const BEDS24_REQUEST_WINDOW_BUFFER_MS = 5000;
const PRICE_WEBHOOK_INVALIDATION_DEBOUNCE_MS = 5 * 60 * 1000;

const SYNC_STATUS_DOC_IDS = {
    reservations: RESERVATION_SYNC_STATUS_DOC_ID,
    prices: PRICE_SYNC_STATUS_DOC_ID
};

function getEffectiveCompanyId(data) {
    return data?.companyId || DEFAULT_COMPANY_ID;
}

function firstNonEmptyValue(...values) {
    for (const value of values) {
        if (typeof value === "string" && value.trim()) return value.trim();
        if (value !== undefined && value !== null && value !== "") return String(value);
    }
    return "";
}

function normalizePossibleActorId(value) {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    if (!trimmed) return "";
    const blocked = new Set(["direct", "manual", "phone", "walk", "airbnb", "booking", "booking.com", "expedia", "agoda", "unknown"]);
    return blocked.has(trimmed.toLowerCase()) ? "" : trimmed;
}

function extractReservationActorInfo(data = {}) {
    const referer = firstNonEmptyValue(data.referer, data.referrer);
    const referrer = firstNonEmptyValue(data.referrer);
    const subSource = firstNonEmptyValue(data.subSource, data.subsource);
    const apiSource = firstNonEmptyValue(data.apiSource);
    const source = firstNonEmptyValue(data.source);
    const channel = firstNonEmptyValue(data.channel);

    const actorCandidates = [
        ["subSource", normalizePossibleActorId(subSource)],
        ["referer", normalizePossibleActorId(referer)],
        ["referrer", normalizePossibleActorId(referrer)],
        ["apiSource", normalizePossibleActorId(apiSource)],
        ["source", normalizePossibleActorId(source)],
        ["channel", normalizePossibleActorId(channel)]
    ];
    const actorEntry = actorCandidates.find(([, value]) => value);

    return {
        referer,
        referrer,
        subSource,
        apiSource,
        source,
        channel,
        actorId: actorEntry ? actorEntry[1] : "",
        actorSource: actorEntry ? actorEntry[0] : ""
    };
}

const RESERVATION_MUTATION_FIELDS = [
    "guestName",
    "arrival",
    "departure",
    "status",
    "price",
    "totalPrice",
    "numAdult",
    "numChild",
    "guestPhone",
    "guestEmail",
    "room",
    "referer",
    "referrer",
    "subSource",
    "apiSource",
    "source",
    "channel",
    "cancelTime",
    "cancelReason"
];

function toComparableReservationValue(value) {
    if (value === undefined || value === null) return "";
    if (typeof value?.toDate === "function") return value.toDate().toISOString();
    if (value instanceof Date) return value.toISOString();
    return value;
}

function buildReservationMutationSummary(beforeData, afterData) {
    const eventType = !beforeData
        ? (afterData?.status === "cancelled" ? "cancelled" : "created")
        : (beforeData.status !== "cancelled" && afterData?.status === "cancelled" ? "cancelled" : "updated");

    const changes = [];
    for (const field of RESERVATION_MUTATION_FIELDS) {
        const beforeValue = toComparableReservationValue(beforeData?.[field]);
        const afterValue = toComparableReservationValue(afterData?.[field]);
        if (beforeValue !== afterValue) {
            changes.push({ field, before: beforeValue, after: afterValue });
        }
    }

    return {
        eventType,
        changedFields: changes.map((change) => change.field),
        changes
    };
}

function applyReservationActorMetadata(data, beforeData = null, eventType = "updated") {
    const actorInfo = extractReservationActorInfo(data);
    const enriched = { ...data, ...actorInfo };
    const actorId = actorInfo.actorId || beforeData?.lastActorId || "";
    const actorSource = actorInfo.actorSource || beforeData?.lastActorSource || "";

    if (beforeData?.createdByStaffId && !enriched.createdByStaffId) enriched.createdByStaffId = beforeData.createdByStaffId;
    if (beforeData?.createdBySource && !enriched.createdBySource) enriched.createdBySource = beforeData.createdBySource;
    if (beforeData?.cancelledByStaffId && !enriched.cancelledByStaffId) enriched.cancelledByStaffId = beforeData.cancelledByStaffId;
    if (beforeData?.cancelledBySource && !enriched.cancelledBySource) enriched.cancelledBySource = beforeData.cancelledBySource;

    if (!beforeData && actorId) {
        enriched.createdByStaffId = actorId;
        enriched.createdBySource = actorSource;
    }
    if (actorId) {
        enriched.lastActorId = actorId;
        enriched.lastActorSource = actorSource;
        enriched.lastModifiedByStaffId = actorId;
        enriched.lastModifiedBySource = actorSource;
    }
    if (eventType === "cancelled" && actorId) {
        enriched.cancelledByStaffId = actorId;
        enriched.cancelledBySource = actorSource;
    }

    return enriched;
}

function buildReservationIntegrityInfo(data) {
    const enriched = { ...data, companyId: getEffectiveCompanyId(data) };
    const missingCriticalFields = RESERVATION_REQUIRED_FIELDS.filter((field) => !enriched[field]);
    const missingReportFields = [];

    if (enriched.status === "confirmed" && !enriched.bookDate) {
        missingReportFields.push("bookDate");
    }
    if (enriched.status === "cancelled" && !enriched.cancelTime && !enriched.modified) {
        missingReportFields.push("cancelTime");
    }

    return {
        missingCriticalFields,
        missingReportFields,
        hasCriticalGap: missingCriticalFields.length > 0,
        hasReportGap: missingReportFields.length > 0,
        schemaVersion: RESERVATION_SYNC_SCHEMA_VERSION,
        checkedAt: new Date().toISOString()
    };
}

function buildReservationOutputImpact(data) {
    const stayDates = [];
    if (data.arrival && data.departure) {
        let cursor = dayjs(data.arrival);
        const checkout = dayjs(data.departure);
        while (cursor.isBefore(checkout)) {
            stayDates.push(cursor.format("YYYY-MM-DD"));
            if (stayDates.length >= 32) break;
            cursor = cursor.add(1, "day");
        }
    }

    return {
        domain: "reservations",
        building: data.building || "",
        room: data.room || "",
        bookingId: String(data.bookId || data.id || ""),
        dateKeys: Array.from(new Set([data.bookDate, data.arrival, data.departure, data.cancelTime ? String(data.cancelTime).slice(0, 10) : ""].filter(Boolean))),
        stayDates,
        monthKeys: Array.from(new Set([data.stayMonth, data.arrival ? String(data.arrival).slice(0, 7) : "", data.bookDate ? String(data.bookDate).slice(0, 7) : ""].filter(Boolean))),
        reportKeys: Array.from(new Set([
            data.building && data.arrival ? `cleaning:${data.building}:${data.arrival}` : "",
            data.building && data.departure ? `cleaning:${data.building}:${data.departure}` : "",
            data.stayMonth ? `occupancy:${data.stayMonth}` : "",
            data.bookDate ? `daily_report:${String(data.bookDate).slice(0, 10)}` : "",
            data.cancelTime ? `cancel_report:${String(data.cancelTime).slice(0, 10)}` : ""
        ].filter(Boolean)))
    };
}

function buildPriceOutputImpact({ building = "", roomName = "", roomId = "", fromDate = "", toDate = "" } = {}) {
    return {
        domain: "prices",
        building,
        room: roomName,
        roomId: String(roomId || ""),
        dateRange: [fromDate, toDate].filter(Boolean),
        reportKeys: Array.from(new Set([
            building ? `calendar:${building}` : "",
            building && roomName ? `calendar:${building}:${roomName}` : ""
        ].filter(Boolean)))
    };
}

/**
 * 여러 outputImpact에서 reportKeys를 수집해 청소/일일 리포트/매출일지 갱신 대상 날짜 추출
 * @param {Array<{ reportKeys?: string[], dateKeys?: string[], monthKeys?: string[] }>} impacts
 * @returns {{ cleaningDates: string[], dailyReportDates: string[], hasReservationImpact: boolean }}
 */
function collectOutputImpactDates(impacts) {
    const cleaningDates = new Set();
    const dailyReportDates = new Set();
    let hasReservationImpact = false;
    const dateLike = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s));

    for (const impact of impacts || []) {
        if (!impact) continue;
        const keys = impact.reportKeys || [];
        for (const key of keys) {
            if (key.startsWith("cleaning:")) {
                const parts = key.split(":");
                if (parts.length >= 3 && dateLike(parts[2])) cleaningDates.add(parts[2]);
            } else if (key.startsWith("daily_report:") && dateLike(key.slice("daily_report:".length))) {
                dailyReportDates.add(key.slice("daily_report:".length));
            } else if (key.startsWith("cancel_report:") && dateLike(key.slice("cancel_report:".length))) {
                dailyReportDates.add(key.slice("cancel_report:".length));
            }
        }
        for (const d of impact.dateKeys || []) {
            if (dateLike(d)) dailyReportDates.add(d);
        }
        if ((impact.reportKeys || []).length > 0 || (impact.domain === "reservations")) hasReservationImpact = true;
    }
    return {
        cleaningDates: Array.from(cleaningDates),
        dailyReportDates: Array.from(dailyReportDates),
        hasReservationImpact
    };
}

/**
 * 수집된 outputImpact에 따라 청소/일일 리포트/매출일지를 영향 날짜만 재계산·발송
 * 슬랙 일일보고서는 중복 방지를 위해 기본적으로 재발송하지 않고,
 * 전용 스케줄(scheduledSlackDailyReport) 또는 수동 재발송(sendSlackDailyReportManual)만 사용한다.
 * 동기화·웹훅 후 호출해 데이터 일치 유지
 * @param {Array<{ reportKeys?: string[], dateKeys?: string[], domain?: string }>} impacts
 * @param {{ skipSalesLog?: boolean, skipSlack?: boolean }} options
 */
async function scheduleOutputUpdates(impacts, options = {}) {
    if (!impacts || impacts.length === 0) return;
    const { skipSalesLog = false, skipSlack = true } = options;
    const { dailyReportDates, hasReservationImpact } = collectOutputImpactDates(impacts);
    const tokyoToday = dayjs().tz("Asia/Tokyo").format("YYYY-MM-DD");
    const tokyoYesterday = dayjs().tz("Asia/Tokyo").subtract(1, "day").format("YYYY-MM-DD");

    if (!skipSlack) {
        // 명시적으로 허용한 경우에만 슬랙 일일 리포트를 재발송한다.
        const yesterdayOnlyDates = dailyReportDates.filter(d => d === tokyoYesterday);
        for (const dateStr of yesterdayOnlyDates) {
            try {
                await buildAndSendSlackDailyReport(false, dateStr, true);
            } catch (e) {
                console.warn("[OutputUpdate] Daily report failed for", dateStr, e.message);
            }
        }
    }

    if (!skipSalesLog && hasReservationImpact) {
        for (const dateStr of [tokyoToday, tokyoYesterday]) {
            try {
                await createDailySalesLog(dateStr, { overwrite: true });
            } catch (e) {
                console.warn("[OutputUpdate] Sales log failed for", dateStr, e.message);
            }
        }
    }
}

function enrichReservationDocument(data, {
    companyId = DEFAULT_COMPANY_ID,
    syncSource = "unknown",
    syncMode = "sync",
    sourceEventTime = null,
    lastSeenAt = new Date()
} = {}) {
    const effectiveCompanyId = companyId || getEffectiveCompanyId(data);
    const sourceLastModified = data.sourceLastModified || data.modified || data.cancelTime || data.bookDate || "";
    const enriched = {
        ...data,
        companyId: effectiveCompanyId,
        sourceLastModified,
        lastSeenInBeds24At: lastSeenAt,
        syncSource,
        syncVersion: RESERVATION_SYNC_SCHEMA_VERSION,
        updatedAt: lastSeenAt
    };

    if (syncMode === "webhook") {
        enriched.lastWebhookAt = lastSeenAt;
    }
    if (syncMode === "reconcile" || syncMode === "manual") {
        enriched.lastReconciledAt = lastSeenAt;
    }
    if (sourceEventTime) {
        enriched.sourceEventTime = sourceEventTime;
    }
    if (enriched.status === "cancelled" && !enriched.cancelTime && sourceLastModified) {
        enriched.cancelTime = sourceLastModified;
    }

    if (!enriched.guestComments && enriched.comments) {
        enriched.guestComments = enriched.comments;
    }

    enriched.outputImpact = buildReservationOutputImpact(enriched);
    enriched.integrity = buildReservationIntegrityInfo(enriched);
    return enriched;
}

function summarizeReservationIntegrity(list) {
    let invalidCriticalCount = 0;
    let invalidReportCount = 0;
    const sampleIds = [];

    list.forEach((item) => {
        const integrity = item.integrity || buildReservationIntegrityInfo(item);
        if (integrity.hasCriticalGap) invalidCriticalCount++;
        if (integrity.hasReportGap) invalidReportCount++;
        if ((integrity.hasCriticalGap || integrity.hasReportGap) && sampleIds.length < 10) {
            sampleIds.push(String(item.bookId || item.id || "unknown"));
        }
    });

    return { invalidCriticalCount, invalidReportCount, sampleIds };
}

async function recordSyncAudit({
    domain = "reservations",
    statusDocId = SYNC_STATUS_DOC_IDS.reservations,
    syncType,
    status = "success",
    syncSource = "",
    companyId = DEFAULT_COMPANY_ID,
    rangeStart = null,
    rangeEnd = null,
    fetchedCount = 0,
    upsertedCount = 0,
    cancelledCount = 0,
    invalidCriticalCount = 0,
    invalidReportCount = 0,
    sampleIds = [],
    note = "",
    errorMessage = "",
    metadata = {},
    updateStatusDoc = true,
    statusMarkers = {}
}) {
    const now = new Date();
    const payload = {
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAtIso: now.toISOString(),
        domain,
        syncType,
        status,
        syncSource: syncSource || syncType,
        companyId,
        rangeStart,
        rangeEnd,
        fetchedCount,
        upsertedCount,
        cancelledCount,
        invalidCriticalCount,
        invalidReportCount,
        sampleIds: sampleIds.slice(0, 10),
        note,
        errorMessage,
        metadata,
        syncVersion: RESERVATION_SYNC_SCHEMA_VERSION
    };

    const auditRef = await db.collection("sync_audit").add(payload);
    const statusPayload = {
        lastAuditId: auditRef.id,
        lastAuditAt: admin.firestore.FieldValue.serverTimestamp(),
        lastAuditStatus: status,
        lastSyncType: syncType,
        lastSyncSource: syncSource || syncType,
        lastCompanyId: companyId,
        lastRangeStart: rangeStart,
        lastRangeEnd: rangeEnd,
        lastFetchedCount: fetchedCount,
        lastUpsertedCount: upsertedCount,
        lastCancelledCount: cancelledCount,
        lastInvalidCriticalCount: invalidCriticalCount,
        lastInvalidReportCount: invalidReportCount,
        lastSampleIds: sampleIds.slice(0, 10),
        lastErrorMessage: errorMessage || "",
        lastNote: note || "",
        lastSyncSchemaVersion: RESERVATION_SYNC_SCHEMA_VERSION,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (updateStatusDoc) {
        if (status !== "error" && status !== "skipped") {
            statusPayload.lastSuccessAt = admin.firestore.FieldValue.serverTimestamp();
        }
        for (const [key, value] of Object.entries(statusMarkers || {})) {
            statusPayload[key] = value === true
                ? admin.firestore.FieldValue.serverTimestamp()
                : value;
        }

        await db.collection("sync_status").doc(statusDocId).set(statusPayload, { merge: true });
    }
    return auditRef.id;
}

async function recordReservationSyncAudit({
    syncVariant = null,
    ...rest
}) {
    const statusMarkers = {};
    if (syncVariant === "webhook" || rest.syncType === "webhook") {
        statusMarkers.lastWebhookAt = true;
    }
    if (syncVariant === "incremental") {
        statusMarkers.lastIncrementalAt = true;
        statusMarkers.lastReconciledAt = true;
    }
    if (syncVariant === "full_reconcile" || syncVariant === "manual_quick" || syncVariant === "manual_full") {
        statusMarkers.lastFullReconcileAt = true;
        statusMarkers.lastReconciledAt = true;
    }
    if (!syncVariant && rest.syncType !== "webhook") {
        statusMarkers.lastReconciledAt = true;
    }

    return recordSyncAudit({
        domain: "reservations",
        statusDocId: RESERVATION_SYNC_STATUS_DOC_ID,
        statusMarkers,
        ...rest
    });
}

async function recordPriceSyncAudit({
    syncVariant = null,
    ...rest
}) {
    const statusMarkers = {};
    if (syncVariant === "webhook" || syncVariant === "immediate" ||
        syncVariant === "queued" || syncVariant === "failed" || syncVariant === "skipped") {
        statusMarkers.lastWebhookAt = true;
    }
    if (syncVariant === "incremental") {
        statusMarkers.lastIncrementalAt = true;
        statusMarkers.lastReconciledAt = true;
    }
    if (syncVariant === "full_reconcile" || syncVariant === "manual_full") {
        statusMarkers.lastFullReconcileAt = true;
        statusMarkers.lastReconciledAt = true;
    }
    if (syncVariant === "minstay_reconcile") {
        statusMarkers.lastReconciledAt = true;
        statusMarkers.lastMinStayReconcileAt = true;
    }

    return recordSyncAudit({
        domain: "prices",
        statusDocId: PRICE_SYNC_STATUS_DOC_ID,
        statusMarkers,
        ...rest
    });
}

function toDateOrNull(value) {
    if (!value) return null;
    if (typeof value?.toDate === "function") return value.toDate();
    if (value instanceof Date) return value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getLatestReservationSyncAt(statusData = {}) {
    const candidates = [
        statusData.lastSuccessAt,
        statusData.lastWebhookAt,
        statusData.lastIncrementalAt,
        statusData.lastFullReconcileAt,
        statusData.lastReconciledAt
    ]
        .map(toDateOrNull)
        .filter(Boolean);

    if (candidates.length === 0) return null;
    return new Date(Math.max(...candidates.map((date) => date.getTime())));
}

async function getDomainStatus(docId) {
    const snap = await db.collection("sync_status").doc(docId).get();
    return snap.exists ? (snap.data() || {}) : null;
}

function getMinutesSince(dateValue, now = new Date()) {
    const date = toDateOrNull(dateValue);
    if (!date) return Infinity;
    return (now.getTime() - date.getTime()) / 60000;
}

function getReservationSyncWindow(base = dayjs().tz("Asia/Tokyo")) {
    const tokyoBase = dayjs(base).tz("Asia/Tokyo");
    return {
        start: tokyoBase.subtract(RESERVATION_SYNC_PAST_MONTHS, "month").format("YYYY-MM-DD"),
        end: tokyoBase.add(RESERVATION_SYNC_FUTURE_MONTHS, "month").format("YYYY-MM-DD")
    };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createBeds24RequestBudget({
    softLimit = BEDS24_REQUEST_SOFT_LIMIT,
    windowMs = BEDS24_REQUEST_WINDOW_MS
} = {}) {
    return {
        softLimit,
        windowMs,
        used: 0,
        windowStartedAt: Date.now()
    };
}

async function waitForBeds24RequestBudget(budget, label = "") {
    if (!budget) return;

    const now = Date.now();
    if (now - budget.windowStartedAt >= budget.windowMs) {
        budget.windowStartedAt = now;
        budget.used = 0;
    }

    if (budget.used < budget.softLimit) return;

    const waitMs = Math.max(0, budget.windowMs - (now - budget.windowStartedAt)) + BEDS24_REQUEST_WINDOW_BUFFER_MS;
    console.log(`[Beds24 Budget] 5분 예산 소진 직전 → ${Math.round(waitMs / 1000)}초 대기${label ? ` (${label})` : ""}`);
    await sleep(waitMs);
    budget.windowStartedAt = Date.now();
    budget.used = 0;
}

function consumeBeds24RequestBudget(budget, cost = 1) {
    if (!budget) return;
    budget.used += cost;
}

function shouldRunFullAudit(statusData, {
    intervalMinutes = 360,
    now = new Date()
} = {}) {
    if (!statusData) return true;
    if (String(statusData.lastSyncSchemaVersion || "") !== RESERVATION_SYNC_SCHEMA_VERSION) return true;
    if (String(statusData.lastAuditStatus || "") === "error") return true;
    if (Number(statusData.lastInvalidCriticalCount || 0) > 0) return true;
    if (Number(statusData.lastInvalidReportCount || 0) > 0) return true;
    return getMinutesSince(statusData.lastFullReconcileAt, now) >= intervalMinutes;
}

async function getScheduledReservationReconcileDecision({
    now = new Date(),
    fullAuditIntervalMinutes = RESERVATION_FULL_RECONCILE_INTERVAL_MINUTES
} = {}) {
    const statusSnap = await db.collection("sync_status").doc(RESERVATION_SYNC_STATUS_DOC_ID).get();
    if (!statusSnap.exists) {
        return { shouldRun: true, reason: "missing_sync_status" };
    }

    const data = statusSnap.data() || {};
    const lastWebhookAt = toDateOrNull(data.lastWebhookAt);
    const lastReconciledAt = toDateOrNull(data.lastReconciledAt);
    const lastAuditStatus = String(data.lastAuditStatus || "");
    const invalidCriticalCount = Number(data.lastInvalidCriticalCount || 0);
    const invalidReportCount = Number(data.lastInvalidReportCount || 0);

    if (lastAuditStatus === "error") {
        return { shouldRun: true, reason: "last_audit_error", data };
    }
    if (invalidCriticalCount > 0 || invalidReportCount > 0) {
        return { shouldRun: true, reason: "integrity_gap_detected", data };
    }
    if (!lastReconciledAt) {
        return { shouldRun: true, reason: "missing_last_reconciled_at", data };
    }

    const reconcileAgeMinutes = (now.getTime() - lastReconciledAt.getTime()) / 60000;
    const webhookAgeMinutes = getMinutesSince(lastWebhookAt, now);
    const fullAuditDue = shouldRunFullAudit(data, {
        intervalMinutes: fullAuditIntervalMinutes,
        now
    });

    if (fullAuditDue) {
        return {
            shouldRun: true,
            reason: "full_audit_due",
            data,
            reconcileAgeMinutes,
            webhookAgeMinutes
        };
    }

    if (!lastWebhookAt) {
        return {
            shouldRun: false,
            reason: "awaiting_webhook_or_manual_sync",
            data,
            reconcileAgeMinutes,
            webhookAgeMinutes
        };
    }

    return {
        shouldRun: false,
        reason: "webhook_primary_ok",
        data,
        reconcileAgeMinutes,
        webhookAgeMinutes
    };
}

async function assertReservationDataReady(context, {
    companyId = DEFAULT_COMPANY_ID,
    maxAgeMinutes = REPORT_SYNC_MAX_AGE_MINUTES,
    invalidThreshold = REPORT_INVALID_THRESHOLD
} = {}) {
    const statusSnap = await db.collection("sync_status").doc(RESERVATION_SYNC_STATUS_DOC_ID).get();
    if (!statusSnap.exists) {
        await sendSyncAlert(`${context}: sync status missing`, [
            `companyId=${companyId}`,
            "sync_status/reservations 문서가 없어 리포트를 중단했습니다."
        ]);
        throw new Error(`[${context}] sync_status/reservations 문서가 없습니다.`);
    }

    const data = statusSnap.data();
    const lastHealthyAt = getLatestReservationSyncAt(data);
    const invalidCriticalCount = Number(data.lastInvalidCriticalCount || 0);
    const errors = [];

    if (!lastHealthyAt) {
        errors.push("최근 예약 동기화 시각 없음");
    } else {
        const ageMinutes = (Date.now() - lastHealthyAt.getTime()) / 60000;
        if (ageMinutes > maxAgeMinutes) {
            errors.push(`최근 성공 동기화가 ${Math.round(ageMinutes)}분 전입니다`);
        }
    }

    if (data.lastAuditStatus === "error") {
        errors.push(`마지막 sync audit 상태가 error 입니다 (${data.lastErrorMessage || "원인 미상"})`);
    }
    if (invalidCriticalCount > invalidThreshold) {
        errors.push(`필수 필드 누락 예약이 ${invalidCriticalCount}건 감지되었습니다`);
    }

    if (errors.length > 0) {
        await sendSyncAlert(`${context}: reservation integrity gate blocked`, [
            `companyId=${companyId}`,
            ...errors
        ]);
        throw new Error(`[${context}] ${errors.join(" | ")}`);
    }
}

function filterDocsToCompany(docs, companyId = DEFAULT_COMPANY_ID) {
    return docs.filter((doc) => getEffectiveCompanyId(doc) === companyId);
}

function getStandardRoomName(roomId, rawName) {
    const ROOM_MAPPING = {
        "383971": "201호", "601545": "201호", "403542": "202호", "601546": "202호",
        "383972": "301호", "601547": "301호", "383978": "302호", "601548": "302호",
        "440617": "401호", "515300": "401호", "383974": "402호", "601549": "402호",
        "502229": "501호", "383975": "501호", "383976": "502호", "601550": "502호",
        "537451": "602호", "601551": "602호", "383973": "701호", "601552": "701호",
        "383977": "702호", "601553": "702호",
        "585734": "101호", "585738": "102호", "585735": "201호", "585739": "202호",
        "585736": "301호", "585740": "302호", "585737": "401호", "585741": "402호",
        "440619": "B01호", "440620": "B02호", "440621": "101호", "440622": "102호",
        "440623": "201호", "440624": "202호", "440625": "302호",
        "383979": "202호", "451220": "202호", "383980": "203호", "452061": "203호",
        "383981": "302호", "452062": "302호", "383982": "303호", "451223": "303호",
        "383983": "402호", "451224": "402호", "383984": "403호", "452063": "403호",
        "543189": "502호", "601560": "502호", "383985": "603호", "452064": "603호",
        "441885": "802호", "452065": "802호", "624198": "803호", "648398": "803호",
        "437952": "오쿠보A", "615969": "오쿠보B", "450096": "오쿠보C", "496532": "오쿠보C", "648399": "오쿠보C",
        "481152": "사노",
        "513698": "201호", "513699": "301호", "513700": "401호", "556719": "401호",
        "513701": "501호", "513702": "601호", "513703": "701호", "513704": "801호", "513705": "901호"
    };
    return ROOM_MAPPING[roomId] || rawName || `Room(${roomId})`;
}
const cleanPrice = (val) => {
    if (!val) return 0;
    const num = parseFloat(String(val).replace(/[^0-9.-]+/g, ""));
    return isNaN(num) ? 0 : num;
};
const determineStatus = (b) => {
    const s = String(b.status).toLowerCase();

    // ★ Beds24 네이티브 블락(status=black) → blackout
    if (s === "black") {
        return "blackout";
    }

    // V1: 0 = Cancelled, 1/2 = Confirmed
    // V2: "cancelled"/"canceled" = Cancelled, "new"/"confirmed" = Confirmed
    // Inquiry/Request: "enquiry"/"request"
    if (s === "0" || s === "cancelled" || s === "canceled") {
        return "cancelled";
    }
    if (s === "enquiry" || s === "request") {
        return "inquiry";
    }
    if (s === "1" || s === "2" || s === "new" || s === "confirmed") {
        return "confirmed";
    }

    return "cancelled";
};

// ==========================================
// 2) HELPER: DATE LOGIC (bookingTime 우선순위 적용)
// ==========================================
// UTC → 일본시간(UTC+9) 변환 헬퍼
const toJapanDate = (dateTimeStr) => {
    if (!dateTimeStr || dateTimeStr.length < 10) return null;
    // 이미 날짜만 있으면 (YYYY-MM-DD) 그대로 반환
    if (dateTimeStr.length === 10) return dateTimeStr;
    // 시간 정보가 있으면 일본 시간대(UTC+9)로 변환
    try {
        // Beds24 시간이 UTC라면 +9시간 해서 일본 시간으로 변환
        const japanDate = dayjs(dateTimeStr).add(9, 'hour');
        return japanDate.format('YYYY-MM-DD');
    } catch {
        return dateTimeStr.slice(0, 10);
    }
};

const determineDate = (b) => {
    // 1순위: [최종 발견 필드] bookingTime 사용 (가장 정확한 예약 접수일)
    if (b.bookingTime && b.bookingTime.length >= 10) return toJapanDate(b.bookingTime);

    // 2순위: bookTime
    if (b.bookTime && b.bookTime.length >= 10) return toJapanDate(b.bookTime);

    // 3순위: entryTime
    if (b.entryTime && b.entryTime.length >= 10) return toJapanDate(b.entryTime);

    // 4순위: invoiceDate (결제일)
    if (b.invoiceItems && Array.isArray(b.invoiceItems) && b.invoiceItems.length > 0) {
        const validDates = b.invoiceItems
            .map(item => item.invoiceDate)
            .filter(d => d && d.length >= 10)
            .sort();
        if (validDates.length > 0) return toJapanDate(validDates[0]);
    }

    // ★ 입실일(firstNight)은 사용하지 않음 (뻥튀기 영구 방지)
    return null;
};

// ==========================================
// 3) NORMALIZE & FETCH (Normal Sync)
// ==========================================
function normalize(b, propKey, building, companyId) {
    const status = determineStatus(b);
    const bookDateStr = determineDate(b);

    // V1 vs V2 Mapping
    // firstNight -> arrival
    // lastNight -> departure (V2 departure is checkout date, V1 lastNight was last stay night)
    const arrival = b.arrival ? b.arrival : (b.firstNight ? b.firstNight.slice(0, 10) : null);

    // V2 departure(체크아웃) vs V1 lastNight(마지막박)
    // V2: b.departure
    // V1: b.lastNight + 1 day
    let departure = null;
    if (b.departure) {
        departure = b.departure;
    } else if (b.lastNight) {
        departure = dayjs(b.lastNight).add(1, 'day').format('YYYY-MM-DD');
    }

    const stayMonth = arrival ? arrival.slice(0, 7) : null;

    const date = bookDateStr; // 대시보드 쿼리 필드 (정확한 예약 접수일)

    // Source fields
    const allSources = [b.referer, b.referrer, b.apiSource, b.subSource, b.source, b.channel].join(" ").toLowerCase();
    let platform = "Airbnb"; // 기본값
    if (allSources.includes("direct") || allSources.includes("manual") || allSources.includes("phone") || allSources.includes("walk")) {
        platform = "Direct"; // 수기 예약
    } else if (allSources.includes("booking")) {
        platform = "Booking";
    } else if (allSources.includes("expedia")) {
        platform = "Expedia";
    } else if (allSources.includes("agoda")) {
        platform = "Agoda";
    }

    let totalPrice = 0;
    if (Array.isArray(b.invoiceItems) && b.invoiceItems.length > 0) {
        totalPrice = b.invoiceItems.reduce((s, x) => s + cleanPrice(x.amount || 0), 0);
    } else if (b.price) {
        totalPrice = cleanPrice(b.price);
    } else if (b.amount) {
        totalPrice = cleanPrice(b.amount);
    }
    const nights = (arrival && departure) ? dayjs(departure).diff(dayjs(arrival), "day") : 0;

    const commission = cleanPrice(b.commission) || 0;
    const netRevenue = totalPrice - commission;

    // V2 Field Mapping for Guest Info
    const guestFirstName = b.firstName || b.guestFirstName || "";
    const guestLastName = b.lastName || b.guestName || "";
    const guestName = `${guestFirstName} ${guestLastName}`.trim();

    // V1 fields
    const bookId = b.id ? String(b.id) : String(b.bookId);
    const roomId = String(b.roomId);

    return {
        id: bookId, bookId: bookId, propKey, roomId: roomId, room: getStandardRoomName(roomId, b.roomName),
        building, guestName: guestName,
        status, rawStatus: String(b.status), platform,
        date, price: totalPrice, nights,
        bookDate: bookDateStr, arrival, departure, stayMonth, totalPrice,
        numAdult: parseInt(b.numAdult) || 0,
        numChild: parseInt(b.numChild) || 0,
        // ★ 고객 상세 정보 (V2 || V1)
        guestEmail: b.email || b.guestEmail || "",
        guestPhone: b.phone || b.guestPhone || b.mobile || b.guestMobile || "",
        guestCountry: b.country || b.guestCountry || "",
        guestCountry2: b.country2 || b.guestCountry2 || "",
        guestAddress: b.address || b.guestAddress || "",
        guestCity: b.city || b.guestCity || "",
        guestPostcode: b.postcode || b.guestPostcode || "",
        guestComments: b.comments || b.guestComments || b.notes || "",
        guestTitle: b.title || b.guestTitle || "",
        arrivalTime: b.arrivalTime || b.guestArrivalTime || "",
        lang: b.lang || "",
        // ★ 금액/정산 관련
        commission: commission,
        netRevenue: netRevenue,
        currency: b.currency || "JPY",
        deposit: cleanPrice(b.deposit) || 0,
        tax: cleanPrice(b.tax) || 0,
        rateDescription: b.rateDescription || "",
        // ★ 채널/예약 관련
        apiReference: b.apiReference || "",
        referer: b.referer || "",
        referrer: b.referrer || "",
        subSource: b.subSource || b.subsource || "",
        apiSource: b.apiSource || "",
        source: b.source || "",
        channel: b.channel || "",
        // ★ 시간/이력 관련 (V2 modifiedTime)
        // ★ 취소된 예약인데 cancelTime이 없으면 modifiedTime을 cancelTime으로 사용
        cancelTime: b.cancelTime || (status === "cancelled" ? (b.modifiedTime || b.modified || "") : ""),
        modified: b.modifiedTime || b.modified || "",
        // ★ 플래그/표시
        flagColor: b.flagColor || "",
        flagText: b.flagText || "",

        // ★ 메시지 (Beds24 -> Firebase)
        guestMessages: Array.isArray(b.messages) ? b.messages.map(m => ({
            id: m.id || "",
            title: m.subject || "",
            message: m.message || "",
            type: m.type || "unknown",
            time: m.time || "",
            from: m.from || "unknown"
        })) : [],

        updatedAt: new Date(),
        companyId: companyId,
    };
}

// ★ Beds24 API V2 호출 (페이지네이션 + 순차 호출)
// Beds24 제한: 1회 최대 100건, 동시 1개 호출만 허용
// V2 Endpoint: GET /bookings
async function fetchAllBookingsFromProperty(prop, dateParams, options = {}) {
    const allBookings = [];

    // V1 날짜 포맷(YYYYMMDD)이 들어오면 V2 포맷(YYYY-MM-DD)으로 변환
    const toV2Date = (d) => {
        if (!d || d.length !== 8) return d;
        return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    };

    // 파라미터 준비
    const finalParams = { ...dateParams };
    if (finalParams.arrivalFrom) finalParams.arrivalFrom = toV2Date(finalParams.arrivalFrom);
    if (finalParams.arrivalTo) finalParams.arrivalTo = toV2Date(finalParams.arrivalTo);
    const requestBudget = options.requestBudget || null;

    // ★ 네 번 조회: 1) 일반 예약, 2) 취소된 예약, 3) 문의/요청, 4) 블락(black)
    // Beds24 V2 API 지원 status: confirmed, request, new, cancelled, black, inquiry
    // legacyMode: 6개월 이상 과거 데이터는 confirmed/cancelled만 조회 (inquiry/request/black 스킵)
    const statusesToFetch = options.legacyMode
        ? [null, "cancelled"]
        : [null, "cancelled", "inquiry", "request", "black"];

    for (const statusFilter of statusesToFetch) {
        let page = 1;
        let rateLimitRetry = 0;
        const statusLabel = statusFilter || "active";

        while (true) {
            try {
                // API 파라미터 구성
                const params = {
                    propertyId: prop.v2Id,
                    page: page,
                    limit: 100
                };

                // 상태 필터 추가
                if (statusFilter) {
                    params.status = statusFilter;
                }

                // 날짜 파라미터 추가 (증분: modifiedFrom만 사용 시 arrival 생략)
                if (finalParams.modifiedFrom) {
                    params.modifiedFrom = finalParams.modifiedFrom; // UTC ISO: YYYY-MM-DDTHH:MM:SS
                } else {
                    if (finalParams.arrivalFrom) params.arrivalFrom = finalParams.arrivalFrom;
                    if (finalParams.arrivalTo) params.arrivalTo = finalParams.arrivalTo;
                }

                // ★ V2 API 호출
                await waitForBeds24RequestBudget(requestBudget, `${prop.name}:${statusLabel}:page${page}`);
                consumeBeds24RequestBudget(requestBudget);
                const token = await getBeds24Token();
                const res = await axios.get("https://beds24.com/api/v2/bookings", {
                    headers: { "token": token },
                    params: params
                });

                // ★ 에러 응답 명시적 체크 (V2 success flag)
                if (res.data && res.data.success === false) {
                    throw new Error(`Beds24 API V2 Error: ${res.data.error}`);
                }

                const arr = (res.data && Array.isArray(res.data.data)) ? res.data.data : [];

                console.log(`  📦 ${prop.name} [${statusLabel}]: page=${page}, ${arr.length}건`);

                if (arr.length === 0) break;

                allBookings.push(...arr.map((b) => normalize(b, prop.id, prop.name, prop.companyId)));

                // 다음 페이지 존재 여부 확인
                const pagesInfo = res.data.pages;
                if (pagesInfo && pagesInfo.nextPageExists) {
                    page++;
                    // 페이지네이션 사이 딜레이
                    await sleep(1500);
                } else {
                    break;
                }

            } catch (err) {
                console.error(`❌ Fetch Error (${prop.name} [${statusLabel}], page=${page}):`, err.message);
                // 400 Bad Request: 해당 status를 API가 지원 안 함 → 스킵하고 다음 status로 진행
                if (err.response && err.response.status === 400) {
                    console.warn(`  ⚠️ status="${statusFilter}" 400 오류 → 스킵`);
                    break;
                }
                // 429 Rate Limit: beds24GetV2WithRetry와 동일한 백오프 전략 적용
                if (err.response && err.response.status === 429 && rateLimitRetry < 5) {
                    rateLimitRetry++;
                    const waitSec = rateLimitRetry * 10; // 10s, 20s, 30s, 40s, 50s
                    console.warn(`  ⚠️ Rate Limit(429). ${waitSec}초 대기 후 재시도 (${rateLimitRetry}/5)`);
                    await sleep(waitSec * 1000);
                    continue;
                }
                throw err;
            }
            rateLimitRetry = 0; // 성공 시 재시도 카운터 리셋
        }

        // 상태 변경 사이 딜레이
        await sleep(1000);
    }

    // 취소 예약 카운트 로그
    const cancelledCount = allBookings.filter(b => b.status === "cancelled").length;
    console.log(`  ✅ ${prop.name} 총합: ${allBookings.length}건 (취소: ${cancelledCount}건)`);

    return allBookings;
}

// 빠른 동기화: 도쿄 시간 기준 과거 6개월 ~ 향후 12개월
async function fetchFromBeds24Quick(options = {}) {
    const tokyoNow = options.now ? dayjs(options.now).utcOffset(9) : dayjs().utcOffset(9);
    const syncWindow = getReservationSyncWindow(tokyoNow);
    const arrivalFrom = options.arrivalFrom || syncWindow.start;
    const arrivalTo = options.arrivalTo || syncWindow.end;
    const requestBudget = options.requestBudget || null;

    console.log(`[Quick Sync] Tokyo: ${tokyoNow.format("YYYY-MM-DD HH:mm")} | Arrival Range: ${arrivalFrom} ~ ${arrivalTo}`);

    const allBookings = [];

    // ★ 순차 호출 (Beds24 제한: 동시 1개만)
    for (const prop of PROPERTIES) {
        if (prop.disabled) {
            console.log(`⏭️  Skipping (disabled): ${prop.name}`);
            continue;
        }
        console.log(`🔄 Fetching: ${prop.name}...`);
        const bookings = await fetchAllBookingsFromProperty(prop, {
            arrivalFrom: arrivalFrom,
            arrivalTo: arrivalTo
        }, {
            requestBudget
        });
        allBookings.push(...bookings);

        // API 호출 사이 딜레이 (2초로 증가 - Rate Limit 방지)
        await sleep(2000);
    }

    console.log(`✅ Quick Sync 완료: 총 ${allBookings.length}건`);
    return allBookings;
}

// 전체 동기화: 2023년 1월부터 향후 2년 (표준)
async function fetchFromBeds24Full(options = {}) {
    const arrivalFrom = "2023-01-01"; // 다시 2023년부터 조회
    const arrivalTo = dayjs().add(24, "month").format("YYYY-MM-DD"); // V2 형식 유지
    const requestBudget = options.requestBudget || null;

    console.log(`[Full Sync] ${arrivalFrom} ~ ${arrivalTo}`);

    const allBookings = [];

    // ★ 순차 호출 (Beds24 제한: 동시 1개만)
    for (const prop of PROPERTIES) {
        if (prop.disabled) {
            console.log(`⏭️  Skipping (disabled): ${prop.name}`);
            continue;
        }
        console.log(`🔄 Fetching: ${prop.name}...`);
        // ★ 변경: 객체 형태로 전달 (Arrival 기준)
        const bookings = await fetchAllBookingsFromProperty(prop, {
            arrivalFrom: arrivalFrom,
            arrivalTo: arrivalTo
        }, {
            requestBudget
        });
        allBookings.push(...bookings);

        // API 호출 사이 딜레이 (2초로 증가 - Rate Limit 방지)
        await sleep(2000);
    }

    console.log(`✅ Full Sync 완료: 총 ${allBookings.length}건`);
    return allBookings;
}

// 증분 동기화: 해당 시각 이후로 수정된 예약만 조회 (Beds24 modifiedFrom 사용)
// modifiedSince: Date 또는 ISO 문자열 (UTC). 이 시각 이후 수정된 예약만 가져옴.
async function fetchFromBeds24Incremental(modifiedSince, options = {}) {
    const sinceDate = modifiedSince instanceof Date ? modifiedSince : new Date(modifiedSince);
    if (Number.isNaN(sinceDate.getTime())) {
        console.warn("[Incremental Sync] invalid modifiedSince, falling back to full range");
        return fetchFromBeds24Quick({ requestBudget: options.requestBudget });
    }
    const modifiedFrom = sinceDate.toISOString().slice(0, 19) + "Z";
    const requestBudget = options.requestBudget || null;
    console.log(`[Incremental Sync] modifiedFrom=${modifiedFrom} (변경분만 조회)`);

    const allBookings = [];
    for (const prop of PROPERTIES) {
        if (prop.disabled) continue;
        const bookings = await fetchAllBookingsFromProperty(prop, { modifiedFrom }, { requestBudget });
        allBookings.push(...bookings);
        await sleep(1500);
    }
    console.log(`✅ Incremental Sync 완료: ${allBookings.length}건 (변경분만)`);
    return allBookings;
}

function getBookingAmount(doc) {
    return Number(doc.totalPrice ?? doc.price) || 0;
}

async function upsertReservations(list, {
    companyId = DEFAULT_COMPANY_ID,
    syncSource = "beds24_sync",
    syncMode = "reconcile",
    sourceEventTime = null
} = {}) {
    const batchLimit = 400;
    let batch = db.batch();
    let count = 0;
    const observedAt = new Date();
    const enrichedList = list.map((item) => enrichReservationDocument(item, {
        companyId,
        syncSource,
        syncMode,
        sourceEventTime,
        lastSeenAt: observedAt
    }));

    for (const item of list) {
        const enriched = enrichedList[count];
        const docRef = db.collection("reservations").doc(String(item.id));
        batch.set(docRef, enriched, { merge: true });
        count++;
        if (count % batchLimit === 0) {
            await batch.commit();
            batch = db.batch();
        }
    }
    if (count % batchLimit !== 0) { await batch.commit(); }
    return {
        upsertedCount: count,
        ...summarizeReservationIntegrity(enrichedList)
    };
}

async function incrementalReservationSync(list, companyId = DEFAULT_COMPANY_ID, syncSource = "beds24_sync") {
    const upsertResult = await upsertReservations(list, {
        companyId,
        syncSource,
        syncMode: "incremental"
    });
    return { cancelledCount: 0, ...upsertResult };
}

async function fullReservationReconcile(list, syncRangeStart = null, syncRangeEnd = null, companyId = DEFAULT_COMPANY_ID, syncSource = "beds24_sync") {
    const observedAt = new Date();
    const batchLimit = 400;
    let batch = db.batch();
    let cancelledCount = 0;

    // Beds24에서 가져온 예약 ID 목록 (문자열로 통일해 비교)
    const beds24BookIds = new Set(list.map(item => String(item.id)));

    // ★ Beds24 응답에 나온 건물 + 동기화 대상 전체 건물 모두 검사 (해당 건물 예약이 0건이어도 삭제된 블락 취소 처리)
    const buildingsInList = new Set(list.map(item => item.building));
    const allSyncBuildings = PROPERTIES.filter(p => !p.disabled).map(p => p.name);
    allSyncBuildings.forEach(b => buildingsInList.add(b));
    const buildingsToProcess = [...buildingsInList];

    // ★ 동기화 범위 안에 있는 예약만 누락 취소 처리한다.
    // 범위 밖 미래 예약은 웹훅으로 들어왔더라도 재대사에서 잘못 cancelled 처리하지 않도록 보호한다.
    const rangeStartDate = syncRangeStart ? dayjs(syncRangeStart).startOf("day") : null;
    const rangeEndDate = syncRangeEnd ? dayjs(syncRangeEnd).endOf("day") : null;

    for (const building of buildingsToProcess) {
        const existingSnap = await db.collection("reservations")
            .where("building", "==", building)
            .get();

        for (const doc of existingSnap.docs) {
            const docId = String(doc.id);
            const existingData = doc.data();

            if (getEffectiveCompanyId(existingData) !== companyId) continue;

            // ★ Beds24에 없는 예약(일반/블락 포함)은 cancelled로 표시 → 우리 시스템에서도 제거
            if (!beds24BookIds.has(docId)) {
                const activeStatuses = ["confirmed", "blackout"];
                if (activeStatuses.includes(existingData.status) && existingData.arrival) {
                    const arrivalDate = dayjs(existingData.arrival);

                    if (!arrivalDate.isValid()) {
                        continue;
                    }

                    if (rangeStartDate && arrivalDate.isBefore(rangeStartDate)) {
                        continue;
                    }

                    if (rangeEndDate && arrivalDate.isAfter(rangeEndDate)) {
                        continue;
                    }

                    const cancelledDoc = enrichReservationDocument({
                        ...existingData,
                        status: "cancelled",
                        cancelTime: existingData.cancelTime || observedAt.toISOString(),
                        syncNote: "Beds24에서 삭제됨"
                    }, {
                        companyId,
                        syncSource: `${syncSource}:cancelled`,
                        syncMode: "reconcile",
                        lastSeenAt: observedAt
                    });

                    batch.set(doc.ref, cancelledDoc, { merge: true });
                    cancelledCount++;

                    if (cancelledCount % batchLimit === 0) {
                        await batch.commit();
                        batch = db.batch();
                    }
                }
            }
        }
    }

    if (cancelledCount % batchLimit !== 0 && cancelledCount > 0) {
        await batch.commit();
    }

    const upsertResult = await upsertReservations(list, {
        companyId,
        syncSource,
        syncMode: "reconcile"
    });

    return {
        cancelledCount,
        ...upsertResult
    };
}

// saveBookings: 하위 호환용 래퍼
async function saveBookings(list, syncRangeStart = null, syncRangeEnd = null, companyId = DEFAULT_COMPANY_ID, syncSource = "beds24_sync", options = {}) {
    const { upsertOnly = false, mode = null } = options;
    if (upsertOnly || mode === "incremental") {
        return incrementalReservationSync(list, companyId, syncSource);
    }
    return fullReservationReconcile(list, syncRangeStart, syncRangeEnd, companyId, syncSource);
}


// ==========================================
// 4) EXPORTS
// ==========================================

// 빠른 동기화 (기본) - 과거 6개월 ~ 향후 12개월
// ★ 순차 호출로 변경되어 타임아웃 증가
exports.syncBeds24 = onRequest({ cors: true, timeoutSeconds: 540, memory: '512MiB' }, async (req, res) => {
    try {
        const companyId = req.body?.companyId || DEFAULT_COMPANY_ID;
        const tokyoNow = dayjs().utcOffset(9);
        const syncWindow = getReservationSyncWindow(tokyoNow);
        const requestBudget = createBeds24RequestBudget();
        // 수동 Quick Sync는 사용자 기대(전체 재대사·삭제 반영)에 맞춰 항상 전체 fetch 후 재대사. 증분 미사용.
        let list = await fetchFromBeds24Quick({ now: tokyoNow, requestBudget });
        const result = await saveBookings(list, syncWindow.start, syncWindow.end, companyId, "beds24_manual_quick");
        const syncVariant = "manual_quick";
        await recordReservationSyncAudit({
            syncType: "manual_quick",
            syncVariant,
            syncSource: "beds24_manual_quick",
            companyId,
            rangeStart: syncWindow.start,
            rangeEnd: syncWindow.end,
            fetchedCount: list.length,
            upsertedCount: result.upsertedCount,
            cancelledCount: result.cancelledCount,
            invalidCriticalCount: result.invalidCriticalCount,
            invalidReportCount: result.invalidReportCount,
            sampleIds: result.sampleIds,
            note: `mode=${syncVariant}`
        });
        const tokyoNowQuick = dayjs().utcOffset(9);
        const fourteenDaysAgoQuick = tokyoNowQuick.subtract(14, "day").format("YYYY-MM-DD");
        const fourteenDaysLaterQuick = tokyoNowQuick.add(14, "day").format("YYYY-MM-DD");
        const recentListQuick = list.filter((r) => {
            const d = r.arrival || r.departure || r.bookDate || "";
            const dt = String(d).slice(0, 10);
            return dt >= fourteenDaysAgoQuick && dt <= fourteenDaysLaterQuick;
        });
        try {
            await scheduleOutputUpdates(recentListQuick.map((item) => buildReservationOutputImpact(item)));
        } catch (e) {
            console.warn("[Manual Quick Sync] Output update failed:", e.message);
        }
        res.json({
            success: true,
            message: `${syncVariant === "incremental" ? "변경분" : "빠른"} 동기화 완료! ${result.upsertedCount}건 저장됨`,
            mode: syncVariant,
            ...result,
            companyId
        });
    } catch (e) {
        console.error("Quick Sync Failed:", e.message);
        await recordReservationSyncAudit({
            syncType: "manual_quick",
            status: "error",
            syncSource: "beds24_manual_quick",
            companyId: req.body?.companyId || DEFAULT_COMPANY_ID,
            errorMessage: e.message
        });
        res.status(500).json({ success: false, error: e.message });
    }
});

exports.scheduledBeds24PropertySync = onSchedule({
    schedule: "every 24 hours",
    timeoutSeconds: 540,
    memory: "512MiB"
}, async () => {
    const tokyoNow = dayjs().utcOffset(9);
    try {
        const result = await syncBeds24Properties({ reason: "scheduled" });
        console.log(`Beds24 property sync completed (${tokyoNow.format("YYYY-MM-DD HH:mm")})`, result);
    } catch (e) {
        await sendSyncAlert("scheduledBeds24PropertySync failed", [
            `companyId=${DEFAULT_COMPANY_ID}`,
            e.message
        ]);
        throw e;
    }
});

exports.triggerBeds24PropertySync = onRequest({ cors: true, timeoutSeconds: 540 }, async (req, res) => {
    try {
        console.log("[Manual Trigger] Beds24 property sync start");
        const result = await syncBeds24Properties({ reason: "manual" });
        res.json({ success: true, message: "Beds24 property sync completed", result });
    } catch (e) {
        console.error("[Manual Trigger] Beds24 property sync failed:", e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 전체 동기화 (관리자용) - 2023년 1월부터 전체
// ★ 순차 호출 + 페이지네이션으로 모든 데이터 가져오기 (최대 10분)
exports.syncBeds24Full = onRequest({ cors: true, timeoutSeconds: 900, memory: '1GiB' }, async (req, res) => {
    try {
        const companyId = req.body?.companyId || DEFAULT_COMPANY_ID;
        const syncRangeStart = "2023-01-01"; // 다시 2023년부터
        const syncRangeEnd = dayjs().add(24, "month").format("YYYY-MM-DD");
        const requestBudget = createBeds24RequestBudget();
        const list = await fetchFromBeds24Full({ requestBudget });
        const result = await saveBookings(list, syncRangeStart, syncRangeEnd, companyId, "beds24_manual_full");
        await recordReservationSyncAudit({
            syncType: "manual_full",
            syncVariant: "manual_full",
            syncSource: "beds24_manual_full",
            companyId,
            rangeStart: syncRangeStart,
            rangeEnd: syncRangeEnd,
            fetchedCount: list.length,
            upsertedCount: result.upsertedCount,
            cancelledCount: result.cancelledCount,
            invalidCriticalCount: result.invalidCriticalCount,
            invalidReportCount: result.invalidReportCount,
            sampleIds: result.sampleIds
        });
        const tokyoNowFull = dayjs().utcOffset(9);
        const fourteenDaysAgoFull = tokyoNowFull.subtract(14, "day").format("YYYY-MM-DD");
        const fourteenDaysLaterFull = tokyoNowFull.add(14, "day").format("YYYY-MM-DD");
        const recentListFull = list.filter((r) => {
            const d = r.arrival || r.departure || r.bookDate || "";
            const dt = String(d).slice(0, 10);
            return dt >= fourteenDaysAgoFull && dt <= fourteenDaysLaterFull;
        });
        try {
            await scheduleOutputUpdates(recentListFull.map((item) => buildReservationOutputImpact(item)));
        } catch (e) {
            console.warn("[Manual Full Sync] Output update failed:", e.message);
        }
        res.json({ success: true, message: `전체 동기화 완료! ${result.upsertedCount}건 저장됨 (2023년~향후 24개월)`, ...result, companyId });
    } catch (e) {
        console.error("Full Sync Failed:", e.message);
        await recordReservationSyncAudit({
            syncType: "manual_full",
            status: "error",
            syncSource: "beds24_manual_full",
            companyId: req.body?.companyId || DEFAULT_COMPANY_ID,
            errorMessage: e.message
        });
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==========================================
// 가격 데이터 동기화 서포트 함수 (Lock & Retry)
// ==========================================

const PRICE_SYNC_LOCK_TTL_MS = 15 * 60 * 1000;
async function acquirePriceSyncLock(lockedBy = "syncAllPrices") {
    const lockRef = db.collection("sync_status").doc("price_sync_lock");
    try {
        let acquired = false;
        let ageMinutes = null;
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(lockRef);
            if (snap.exists) {
                const lockTime = snap.data()?.lockedAt?.toDate() || new Date(0);
                const diffMs = Date.now() - lockTime.getTime();
                if (diffMs < PRICE_SYNC_LOCK_TTL_MS) {
                    ageMinutes = diffMs / (1000 * 60);
                    acquired = false;
                    return;
                }
            }
            tx.set(lockRef, {
                lockedAt: admin.firestore.FieldValue.serverTimestamp(),
                status: 'running',
                lockedBy
            });
            acquired = true;
        });
        return { acquired, ageMinutes };
    } catch (e) {
        console.error(`[PriceSyncLock] acquire failed (${lockedBy}):`, e.message);
        return { acquired: false, ageMinutes: null, error: e };
    }
}
async function releasePriceSyncLock() {
    try {
        await db.collection("sync_status").doc("price_sync_lock").delete();
    } catch (e) {
        console.warn("[PriceSyncLock] release failed:", e.message);
    }
}

// 동기화 잠금 관리
async function useSyncLock(action = 'check') {
    if (action === 'acquire') {
        const { acquired, ageMinutes } = await acquirePriceSyncLock("syncAllPrices");
        if (!acquired) {
            if (typeof ageMinutes === "number") {
                console.log(`[PriceSyncLock] 이미 실행 중 (${ageMinutes.toFixed(1)}분 경과)`);
            }
            return false;
        }
        return true;
    } else if (action === 'release') {
        await releasePriceSyncLock();
        return true;
    }
    return false;
}

// Beds24 API V2 GET 전용 Retry + Backoff 래퍼
async function beds24GetV2WithRetry(endpoint, params, attempts = 5) {
    for (let i = 0; i < attempts; i++) {
        try {
            const token = await getBeds24Token();
            const response = await axios.get(`https://beds24.com/api/v2${endpoint}`, {
                headers: { "token": token },
                params: params
            });

            // V2 에러 체크
            if (response.data && response.data.success === false) {
                const errorStr = String(response.data.error || "").toLowerCase();
                if (errorStr.includes("limit exceeded") || errorStr.includes("too many requests")) {
                    throw { isRateLimit: true, message: response.data.error };
                }
                return response;
            }
            return response;
        } catch (err) {
            const isLastAttempt = i === attempts - 1;
            const isRateLimit = err.isRateLimit || err.response?.status === 429;

            if (isRateLimit && !isLastAttempt) {
                const waitSec = (i + 1) * 10; // V2 Rate Limit 대기시간 증가 (10s, 20s..)
                console.warn(`[V2 Retry] Rate Limit 감지. ${waitSec}초 후 재시도 (${i + 1}/${attempts})`);
                await new Promise(r => setTimeout(r, waitSec * 1000));
                continue;
            }

            if (isLastAttempt) throw err;

            // 일반 네트워크 에러 재시도
            const waitSec = 2;
            console.warn(`[V2 Retry] 네트워크 오류: ${err.message}. ${waitSec}초 후 재시도`);
            await new Promise(r => setTimeout(r, waitSec * 1000));
        }
    }
}

// 연속 날짜를 from/to 범위로 병합 (payload 축소 → 크레딧 절약)
function consolidateCalendarRanges(calendar) {
    if (!calendar || calendar.length <= 1) return calendar;
    const sorted = [...calendar].sort((a, b) => a.from.localeCompare(b.from));
    const result = [{ ...sorted[0] }];
    for (let i = 1; i < sorted.length; i++) {
        const prev = result[result.length - 1];
        const curr = sorted[i];
        const prevNext = dayjs(prev.to).add(1, "day").format("YYYY-MM-DD");
        const { from: _pf, to: _pt, ...prevVals } = prev;
        const { from: _cf, to: _ct, ...currVals } = curr;
        if (prevNext === curr.from && JSON.stringify(prevVals) === JSON.stringify(currVals)) {
            prev.to = curr.to;
        } else {
            result.push({ ...curr });
        }
    }
    return result;
}

function buildBeds24CalendarUpdatesFromDates(dates = {}) {
    const rawCalendarUpdates = [];
    const toV2Date = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

    for (const [dateStr, val] of Object.entries(dates)) {
        const v2Date = toV2Date(dateStr);
        const updateItem = { from: v2Date, to: v2Date };
        if (val.p1 !== undefined) updateItem.price1 = (val.p1 === 'REMOVE' || val.p1 === -1) ? null : parseFloat(val.p1);
        if (val.p2 !== undefined) updateItem.price2 = (val.p2 === 'REMOVE' || val.p2 === -1) ? null : parseFloat(val.p2);
        if (val.p3 !== undefined) updateItem.price3 = (val.p3 === 'REMOVE' || val.p3 === -1) ? null : parseFloat(val.p3);
        if (val.m !== undefined) {
            console.warn(`[setRoomPrices] minStay field ignored (use setMinStay instead). dateStr=${dateStr}, m=${val.m}`);
        }
        rawCalendarUpdates.push(updateItem);
    }

    return consolidateCalendarRanges(rawCalendarUpdates);
}

// Beds24 API V2 POST 전용 Retry + Backoff + Credit-aware 래퍼
async function beds24PostV2WithRetry(endpoint, data, attempts = 3) {
    for (let i = 0; i < attempts; i++) {
        try {
            const token = await getBeds24Token();
            const response = await axios.post(`https://beds24.com/api/v2${endpoint}`, data, {
                headers: { "token": token }
            });

            // Credit-aware pacing: 잔여 크레딧 부족 시 리셋까지 선제 대기
            const creditRemaining = parseInt(response.headers?.["x-five-min-limit-remaining"], 10);
            const resetInSec = parseInt(response.headers?.["x-five-min-limit-resets-in"], 10);
            if (Number.isFinite(creditRemaining) && creditRemaining < 10) {
                const waitSec = Number.isFinite(resetInSec) && resetInSec > 0 ? Math.min(resetInSec + 1, 60) : 15;
                console.warn(`[V2 POST] Credit 잔여 ${creditRemaining}, 리셋 ${resetInSec || "?"}s → ${waitSec}초 선제 대기`);
                await new Promise(r => setTimeout(r, waitSec * 1000));
            }

            // V2 에러 체크
            if (response.data && response.data.success === false) {
                const errorStr = String(response.data.error || "").toLowerCase();
                if (errorStr.includes("limit exceeded") || errorStr.includes("too many requests")) {
                    throw { isRateLimit: true, message: response.data.error };
                }
                throw new Error(response.data.error || "Beds24 API 호출 실패");
            }
            return response;
        } catch (err) {
            const isLastAttempt = i === attempts - 1;
            const isRateLimit = err.isRateLimit || err.response?.status === 429;

            if (isRateLimit && !isLastAttempt) {
                const resetInSec = parseInt(err.response?.headers?.["x-five-min-limit-resets-in"], 10);
                const waitSec = Number.isFinite(resetInSec) && resetInSec > 0
                    ? Math.min(resetInSec + 2, 60)
                    : (i + 1) * 10;
                console.warn(`[V2 POST Retry] Rate Limit 감지. ${waitSec}초 후 재시도 (${i + 1}/${attempts})`);
                await new Promise(r => setTimeout(r, waitSec * 1000));
                continue;
            }

            if (isLastAttempt) throw err;

            const waitSec = 2;
            console.warn(`[V2 POST Retry] 네트워크 오류: ${err.message}. ${waitSec}초 후 재시도`);
            await new Promise(r => setTimeout(r, waitSec * 1000));
        }
    }
}

// 가격 데이터 동기화 함수 (Firestore 캐싱)
// ==========================================
async function syncAllPrices({
    forceFull = false,
    reason = "scheduled",
    targetBuildings = null
} = {}) {
    const isLocked = await useSyncLock('acquire');
    if (!isLocked) return { error: "Sync already in progress" };

    try {
        const tokyoNow = dayjs().utcOffset(9);
        const fromDate = tokyoNow.format("YYYY-MM-DD"); // V2용 (YYYY-MM-DD)
        const toDate = tokyoNow.add(12, "month").format("YYYY-MM-DD");
        const priceStatus = await getDomainStatus(PRICE_SYNC_STATUS_DOC_ID);
        const runFullSync = forceFull || shouldRunFullAudit(priceStatus, {
            intervalMinutes: PRICE_FULL_RECONCILE_INTERVAL_MINUTES,
            now: tokyoNow.toDate()
        });

        // firestore 저장용 키 생성 (YYYYMMDD) 헬퍼
        const toKey = (d) => d.replace(/-/g, '');

        console.log(`[V2 Bulletproof Sync] 시작: ${fromDate} ~ ${toDate} (${runFullSync ? "full" : "incremental"})`);
        const syncResults = {};
        let requestedRooms = 0;
        let syncedRooms = 0;
        let skippedRooms = 0;
        const touchedBuildings = [];

        for (const prop of PROPERTIES) {
            if (prop.disabled) {
                console.log(`⏭️  [Price Sync Skip] ${prop.name}: disabled`);
                continue;
            }
            if (Array.isArray(targetBuildings) && targetBuildings.length > 0 && !targetBuildings.includes(prop.name)) {
                continue;
            }
            const buildingName = prop.name;
            const allRooms = BUILDING_ROOMS[buildingName] || [];
            if (allRooms.length === 0) continue;

            const buildingRef = db.collection("price_sync").doc(buildingName);
            const buildingSnap = await buildingRef.get();
            const buildingCache = buildingSnap.exists ? buildingSnap.data() : {};
            const invalidatedRoomIds = new Set((buildingCache.invalidatedRoomIds || []).map((id) => String(id)));
            const roomsToFetch = runFullSync
                ? allRooms
                : allRooms.filter((room) => invalidatedRoomIds.has(String(room.roomId)));

            if (!runFullSync && roomsToFetch.length === 0) {
                continue;
            }

            console.log(`[V2 Sync] 건물 시작: ${buildingName} (${roomsToFetch.length}개 객실)`);
            let successInBuilding = 0;
            const syncedRoomIds = new Set();
            requestedRooms += roomsToFetch.length;
            touchedBuildings.push(buildingName);

            for (const room of roomsToFetch) {
                const rid = String(room.roomId);
                try {
                    // [Cache Protection] 최근 15분 내 수동 수정된 방 스킵
                    const roomDocRef = buildingRef.collection("rooms").doc(rid);
                    const existingSnap = await roomDocRef.get();
                    if (existingSnap.exists) {
                        const roomCache = existingSnap.data();
                        const lastUserUpdate = roomCache?.lastManualUpdate?.toDate() || null;
                        if (lastUserUpdate && dayjs().diff(dayjs(lastUserUpdate), 'minute') < 15) {
                            console.log(`[Price Sync Skip] ${buildingName} - ${room.name}(${rid}): 최근 수동 수정됨`);
                            skippedRooms++;
                            continue;
                        }
                    }

                    // ★ V2 API 호출 (GET /inventory/rooms/calendar)
                    // includePrices 필수! 없으면 가격 데이터가 반환되지 않음
                    const response = await beds24GetV2WithRetry("/inventory/rooms/calendar", {
                        roomId: rid,
                        startDate: fromDate,
                        endDate: toDate,
                        includePrices: true,
                        includeLinkedPrices: true,
                        includeMinStay: true,
                        includeMaxStay: true,
                        includeNumAvail: true,
                        includeOverride: true
                    });

                    // V2 응답 파싱
                    // 실제 구조: { data: [{ roomId, calendar: [{ from, to, price1, minStay, ... }] }] }
                    const roomData = response.data?.data?.[0];
                    if (roomData && Array.isArray(roomData.calendar)) {
                        const datesObj = {};

                        roomData.calendar.forEach(entry => {
                            // from/to 범위를 개별 날짜로 확장
                            const entryFromDate = dayjs(entry.from);
                            const entryToDate = dayjs(entry.to);

                            for (let d = entryFromDate; d.isBefore(entryToDate) || d.isSame(entryToDate, 'day'); d = d.add(1, 'day')) {
                                const dateKey = d.format('YYYYMMDD');
                                datesObj[dateKey] = {
                                    p1: String(entry.price1 || ""),
                                    p2: String(entry.price2 || ""),
                                    p3: String(entry.price3 || ""),
                                    m: String(entry.minStay || ""),
                                    mx: String(entry.maxStay || ""),
                                    na: entry.numAvail !== undefined && entry.numAvail !== null ? String(entry.numAvail) : "",
                                    ov: entry.override ? String(entry.override) : ""
                                };
                            }
                        });

                        // 원자적 개별 저장 (Atomic Storage)
                        await roomDocRef.set({
                            roomName: room.name,
                            roomId: rid,
                            dates: datesObj,
                            outputImpact: buildPriceOutputImpact({
                                building: buildingName,
                                roomName: room.name,
                                roomId: rid,
                                fromDate,
                                toDate
                            }),
                            lastSyncRoom: admin.firestore.FieldValue.serverTimestamp()
                        }, { merge: true });
                        successInBuilding++;
                        syncedRooms++;
                        syncedRoomIds.add(rid);
                    } else if (response.data?.error) {
                        console.error(`[Price Sync Error] ${buildingName} - ${room.name}: ${response.data.error}`);
                    }

                } catch (err) {
                    console.error(`[Price Sync Fatal] ${buildingName} - ${room.roomId}:`, err.message);
                }

                // V2는 빠르므로 대기 시간 단축 (2.0s -> 0.5s)
                await new Promise(r => setTimeout(r, 500));
            }

            const remainingInvalidatedRoomIds = runFullSync
                ? []
                : [...invalidatedRoomIds].filter((id) => !syncedRoomIds.has(String(id)));

            // 건물 요약 정보 업데이트
            await buildingRef.set({
                building: buildingName,
                lastSync: admin.firestore.FieldValue.serverTimestamp(),
                lastIncrementalSync: runFullSync ? buildingCache.lastIncrementalSync || null : admin.firestore.FieldValue.serverTimestamp(),
                lastFullSync: runFullSync ? admin.firestore.FieldValue.serverTimestamp() : (buildingCache.lastFullSync || null),
                roomCount: successInBuilding,
                targetRoomCount: roomsToFetch.length,
                dateFrom: fromDate,
                dateTo: toDate,
                outputImpact: buildPriceOutputImpact({ building: buildingName, fromDate, toDate }),
                invalidatedRoomIds: remainingInvalidatedRoomIds,
                pendingInvalidationCount: remainingInvalidatedRoomIds.length,
                invalidatedAt: remainingInvalidatedRoomIds.length > 0
                    ? (buildingCache.invalidatedAt || admin.firestore.FieldValue.serverTimestamp())
                    : admin.firestore.FieldValue.delete(),
                invalidatedBy: remainingInvalidatedRoomIds.length > 0
                    ? (buildingCache.invalidatedBy || "priceWebhook")
                    : admin.firestore.FieldValue.delete()
            }, { merge: true });

            syncResults[buildingName] = {
                success: true,
                rooms: successInBuilding,
                targetRooms: roomsToFetch.length,
                mode: runFullSync ? "full" : "incremental"
            };

            // 건물 간 대기 시간도 단축 (5s -> 1s)
            await new Promise(r => setTimeout(r, 1000));
        }

        if (!runFullSync && requestedRooms === 0) {
            await recordPriceSyncAudit({
                syncType: reason,
                status: "skipped",
                syncSource: "beds24_price_incremental",
                companyId: DEFAULT_COMPANY_ID,
                note: "price incremental skipped: no invalidated rooms",
                metadata: { runFullSync, touchedBuildings: [] },
                updateStatusDoc: false
            });
            return { skipped: true, mode: "incremental", rooms: 0 };
        }

        await recordPriceSyncAudit({
            syncType: reason,
            syncVariant: runFullSync ? "full_reconcile" : "incremental",
            syncSource: runFullSync ? "beds24_price_full_reconcile" : "beds24_price_incremental",
            companyId: DEFAULT_COMPANY_ID,
            fetchedCount: requestedRooms,
            upsertedCount: syncedRooms,
            note: `mode=${runFullSync ? "full" : "incremental"}, skipped=${skippedRooms}`,
            metadata: {
                touchedBuildings,
                requestedRooms,
                syncedRooms,
                skippedRooms
            }
        });

        console.log(`[V2 Sync] 전체 완료:`, syncResults);
        return {
            success: true,
            mode: runFullSync ? "full" : "incremental",
            requestedRooms,
            syncedRooms,
            skippedRooms,
            buildings: syncResults
        };

    } catch (e) {
        await recordPriceSyncAudit({
            syncType: reason,
            status: "error",
            syncSource: forceFull ? "beds24_price_full_reconcile" : "beds24_price_incremental",
            companyId: DEFAULT_COMPANY_ID,
            errorMessage: e.message
        });
        throw e;

    } finally {
        // 성공하든 실패하든 반드시 락 해제
        await useSyncLock('release');
    }
}

// ==========================================
// minStay 전용 reconcile
// Beds24 inventory webhook은 minStay 변경을 트리거하지 않으므로
// 별도 주기(60분)로 전 객실의 m/mx 필드만 패치함.
// 가격 필드(p1/p2/p3)는 건드리지 않음.
// ==========================================
async function syncMinStayOnly({ reason = "scheduled" } = {}) {
    const { acquired } = await acquirePriceSyncLock("minStayReconcile");
    if (!acquired) {
        console.log("[MinStay Reconcile] 락 점유 중 — 스킵");
        return { skipped: true, reason: "lock_busy" };
    }

    try {
        const tokyoNow = dayjs().utcOffset(9);
        const fromDate = tokyoNow.format("YYYY-MM-DD");
        const toDate = tokyoNow.add(12, "month").format("YYYY-MM-DD");

        let totalFetched = 0, totalUpdated = 0, totalSkipped = 0;
        const touchedBuildings = [];

        for (const prop of PROPERTIES) {
            if (prop.disabled) continue;
            const buildingName = prop.name;
            const allRooms = BUILDING_ROOMS[buildingName] || [];
            if (allRooms.length === 0) continue;

            const buildingRef = db.collection("price_sync").doc(buildingName);
            let updatedInBuilding = 0;
            touchedBuildings.push(buildingName);

            for (const room of allRooms) {
                const rid = String(room.roomId);
                try {
                    // includePrices: false 로 경량화. Beds24 V2는 includeMinStay 독립 지원.
                    // 만약 minStay 필드가 반환되지 않으면 includePrices: true 로 변경 필요.
                    const response = await beds24GetV2WithRetry("/inventory/rooms/calendar", {
                        roomId: rid,
                        startDate: fromDate,
                        endDate: toDate,
                        includePrices: false,
                        includeLinkedPrices: false,
                        includeMinStay: true,
                        includeMaxStay: true
                    });

                    const roomData = response.data?.data?.[0];
                    if (!roomData || !Array.isArray(roomData.calendar)) {
                        totalSkipped++;
                        continue;
                    }

                    // m/mx 필드만 field-path update (가격 필드 보존)
                    const updateMap = {};
                    const datesPatch = {};
                    roomData.calendar.forEach(entry => {
                        const entryFrom = dayjs(entry.from);
                        const entryTo = dayjs(entry.to);
                        for (let d = entryFrom; d.isBefore(entryTo) || d.isSame(entryTo, 'day'); d = d.add(1, 'day')) {
                            const dateKey = d.format('YYYYMMDD');
                            updateMap[`dates.${dateKey}.m`] = String(entry.minStay || "");
                            updateMap[`dates.${dateKey}.mx`] = String(entry.maxStay || "");
                            datesPatch[dateKey] = {
                                m: String(entry.minStay || ""),
                                mx: String(entry.maxStay || "")
                            };
                        }
                    });

                    if (Object.keys(updateMap).length > 0) {
                        const roomDocRef = buildingRef.collection("rooms").doc(rid);
                        try {
                            await roomDocRef.update(updateMap);
                            updatedInBuilding++;
                            totalUpdated++;
                        } catch (updateErr) {
                            // 문서가 없으면 최소 문서를 생성해 minStay/mx 보정이 바로 반영되게 함
                            if (updateErr.code === 5 || updateErr.code === "not-found") {
                                await roomDocRef.set({
                                    roomName: room.name,
                                    roomId: rid,
                                    dates: datesPatch,
                                    lastSyncRoom: admin.firestore.FieldValue.serverTimestamp(),
                                    lastMinStayReconcileAt: admin.firestore.FieldValue.serverTimestamp()
                                }, { merge: true });
                                console.log(`[MinStay Reconcile] ${buildingName}/${rid}: 문서 생성 후 minStay 패치`);
                                updatedInBuilding++;
                                totalUpdated++;
                            } else {
                                throw updateErr;
                            }
                        }
                    }
                    totalFetched++;
                } catch (err) {
                    console.error(`[MinStay Reconcile Error] ${buildingName} - ${rid}:`, err.message);
                    totalSkipped++;
                }
                await new Promise(r => setTimeout(r, 500));
            }

            console.log(`[MinStay Reconcile] ${buildingName}: ${updatedInBuilding}개 방 갱신`);
            await new Promise(r => setTimeout(r, 1000));
        }

        await recordPriceSyncAudit({
            syncType: reason,
            syncVariant: "minstay_reconcile",
            syncSource: "beds24_minstay_reconcile",
            companyId: DEFAULT_COMPANY_ID,
            fetchedCount: totalFetched,
            upsertedCount: totalUpdated,
            note: `minStay-only reconcile, skipped=${totalSkipped}`,
            metadata: { touchedBuildings, totalFetched, totalUpdated, totalSkipped }
        });

        console.log(`[MinStay Reconcile] 완료: fetched=${totalFetched}, updated=${totalUpdated}, skipped=${totalSkipped}`);
        return { success: true, totalFetched, totalUpdated, totalSkipped };

    } catch (e) {
        await recordPriceSyncAudit({
            syncType: reason,
            status: "error",
            syncSource: "beds24_minstay_reconcile",
            companyId: DEFAULT_COMPANY_ID,
            errorMessage: e.message
        });
        throw e;
    } finally {
        await releasePriceSyncLock();
    }
}

// 수동 가격 동기화 (HTTP 호출용)
exports.triggerPriceSync = onRequest({ cors: true, timeoutSeconds: 540 }, async (req, res) => {
    try {
        console.log("[Manual Trigger] 가격 동기화 시작");
        const result = await syncAllPrices({ forceFull: true, reason: "manual" });
        res.json({ success: true, message: "가격 동기화 완료", result });
    } catch (e) {
        console.error("[Manual Trigger] 가격 동기화 실패:", e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

async function runScheduledReservationReconcile({ forceFull = false } = {}) {
    const tokyoNow = dayjs().tz("Asia/Tokyo");
    const companyId = DEFAULT_COMPANY_ID;
    const syncWindow = getReservationSyncWindow(tokyoNow);
    const statusData = await getDomainStatus(RESERVATION_SYNC_STATUS_DOC_ID);
    const requestBudget = createBeds24RequestBudget();

    const lastReconciledAt = toDateOrNull(statusData?.lastReconciledAt);
    const lastWebhookAt = toDateOrNull(statusData?.lastWebhookAt);
    const baseTime = lastReconciledAt || lastWebhookAt || tokyoNow.subtract(1, "day").toDate();
    const modifiedSince = new Date(baseTime.getTime() - (RESERVATION_INCREMENTAL_BUFFER_MINUTES * 60 * 1000));

    const incrementalList = await fetchFromBeds24Incremental(modifiedSince, { requestBudget });
    const incrementalResult = await saveBookings(
        incrementalList,
        null,
        null,
        companyId,
        "beds24_scheduled_daily_incremental",
        { mode: "incremental" }
    );

    await recordReservationSyncAudit({
        syncType: "scheduled_daily",
        syncVariant: "incremental",
        syncSource: "beds24_scheduled_daily_incremental",
        companyId,
        rangeStart: modifiedSince.toISOString(),
        rangeEnd: tokyoNow.toISOString(),
        fetchedCount: incrementalList.length,
        upsertedCount: incrementalResult.upsertedCount,
        cancelledCount: incrementalResult.cancelledCount,
        invalidCriticalCount: incrementalResult.invalidCriticalCount,
        invalidReportCount: incrementalResult.invalidReportCount,
        sampleIds: incrementalResult.sampleIds || [],
        note: "mode=incremental_backup"
    });

    let fullList = [];
    let fullResult = null;
    const shouldRunDeepAudit = forceFull || shouldRunFullAudit(statusData, {
        intervalMinutes: RESERVATION_FULL_RECONCILE_INTERVAL_MINUTES,
        now: tokyoNow.toDate()
    });

    if (shouldRunDeepAudit) {
        fullList = await fetchFromBeds24Quick({
            now: tokyoNow,
            requestBudget
        });
        fullResult = await saveBookings(
            fullList,
            syncWindow.start,
            syncWindow.end,
            companyId,
            "beds24_scheduled_daily_window",
            { mode: "full_reconcile" }
        );

        await recordReservationSyncAudit({
            syncType: "scheduled_daily",
            syncVariant: "full_reconcile",
            syncSource: "beds24_scheduled_daily_window",
            companyId,
            rangeStart: syncWindow.start,
            rangeEnd: syncWindow.end,
            fetchedCount: fullList.length,
            upsertedCount: fullResult.upsertedCount,
            cancelledCount: fullResult.cancelledCount,
            invalidCriticalCount: fullResult.invalidCriticalCount,
            invalidReportCount: fullResult.invalidReportCount,
            sampleIds: fullResult.sampleIds || [],
            note: `mode=window_audit, forceFull=${forceFull}`
        });
    }

    const fourteenDaysAgo = tokyoNow.subtract(14, "day").format("YYYY-MM-DD");
    const fourteenDaysLater = tokyoNow.add(14, "day").format("YYYY-MM-DD");
    const impactMap = new Map();
    [...incrementalList, ...fullList].forEach((item) => {
        const d = item.arrival || item.departure || item.bookDate || "";
        const dt = String(d).slice(0, 10);
        if (dt < fourteenDaysAgo || dt > fourteenDaysLater) return;
        const impactKey = String(item.bookId || item.id || `${item.building || ""}_${item.room || ""}_${dt}`);
        impactMap.set(impactKey, buildReservationOutputImpact(item));
    });

    try {
        await scheduleOutputUpdates(Array.from(impactMap.values()));
    } catch (e) {
        console.warn("[Scheduled Daily Reservation Reconcile] Output update failed:", e.message);
    }

    return {
        companyId,
        modifiedSince: modifiedSince.toISOString(),
        syncWindow,
        incrementalList,
        incrementalResult,
        fullList,
        fullResult,
        ranFullAudit: shouldRunDeepAudit
    };
}

// 예약 자동 재대사: 자정 1회만 실행. 웹훅이 메인이고, 자정 배치는 누락분 백업 + 주기적 깊은 감사 역할만 수행한다.
exports.scheduledBeds24Sync = onSchedule({
    schedule: "0 0 * * *",
    timeZone: "Asia/Tokyo",
    timeoutSeconds: 540,
    memory: "1GiB"
}, async () => {
    try {
        const result = await runScheduledReservationReconcile();
        console.log(
            `✅ 예약 자정 재대사 완료: incremental=${result.incrementalList.length}건` +
            `${result.ranFullAudit ? `, full=${result.fullList.length}건` : ", full=skip"}`
        );
    } catch (e) {
        await recordReservationSyncAudit({
            syncType: "scheduled_daily",
            status: "error",
            syncSource: "beds24_scheduled_daily",
            companyId: DEFAULT_COMPANY_ID,
            errorMessage: e.message
        });
        await sendSyncAlert("scheduledBeds24Sync failed", [
            `companyId=${DEFAULT_COMPANY_ID}`,
            e.message
        ]);
        throw e;
    }
});

// 가격은 예약과 분리해 기존 cadence를 유지한다.
exports.scheduledBeds24PriceSync = onSchedule({
    schedule: "every 15 minutes",
    timeoutSeconds: 540,
    memory: "1GiB"
}, async () => {
    const tokyoNow = dayjs().utcOffset(9);
    try {
        await syncAllPrices({ reason: "scheduled" });
        console.log(`✅ 가격 동기화 완료 (${tokyoNow.format("YYYY-MM-DD HH:mm")})`);
    } catch (e) {
        await recordPriceSyncAudit({
            syncType: "scheduled",
            status: "error",
            syncSource: "beds24_scheduled_prices",
            companyId: DEFAULT_COMPANY_ID,
            errorMessage: e.message
        });
        await sendSyncAlert("scheduledBeds24PriceSync failed", [
            `companyId=${DEFAULT_COMPANY_ID}`,
            e.message
        ]);
        throw e;
    }
});

// minStay 전용 스케줄 (60분 간격) — 가격 full reconcile(6시간)보다 짧게 유지
exports.scheduledMinStayReconcile = onSchedule({
    schedule: "every 6 hours",
    timeoutSeconds: 540,
    memory: "512MiB"
}, async () => {
    const tokyoNow = dayjs().utcOffset(9);
    try {
        const result = await syncMinStayOnly({ reason: "scheduled" });
        console.log(`✅ minStay 동기화 완료 (${tokyoNow.format("YYYY-MM-DD HH:mm")})`, result);
    } catch (e) {
        await sendSyncAlert("scheduledMinStayReconcile failed", [
            `companyId=${DEFAULT_COMPANY_ID}`,
            e.message
        ]);
        throw e;
    }
});

// minStay 수동 트리거 (테스트/즉시 반영용)
exports.triggerMinStaySync = onRequest({ cors: true, timeoutSeconds: 540 }, async (req, res) => {
    try {
        console.log("[Manual Trigger] minStay 동기화 시작");
        const result = await syncMinStayOnly({ reason: "manual" });
        res.json({ success: true, message: "minStay 동기화 완료", result });
    } catch (e) {
        console.error("[Manual Trigger] minStay 동기화 실패:", e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==========================================
// 리뷰 동기화 헬퍼 (Booking.com + Airbnb → Firestore)
// fromDate: 조회 시작일 (기본값: 최근 30일)
// options.insertOnly: true면 Firestore에 없는 것만 저장 (기존 덮어쓰기 안함)
// ==========================================
async function syncAllReviews(companyId, fromDate = null, options = {}) {
    const { insertOnly = false, toDate = null } = options;
    const tokyoNow = dayjs().utcOffset(9);
    if (!fromDate) fromDate = tokyoNow.subtract(30, "day").format("YYYY-MM-DD");
    const effectiveToDate = toDate || tokyoNow.format("YYYY-MM-DD");
    const batch = [];

    // 1. Booking.com 리뷰 (건물별)
    for (const prop of PROPERTIES) {
        if (prop.disabled) continue;
        try {
            let hasMore = true;
            let pageFrom = fromDate;
            let pageCount = 0;
            while (hasMore && pageCount < 10) {
                const res = await beds24GetV2WithRetry("/channels/booking/reviews", {
                    propertyId: prop.v2Id,
                    from: pageFrom,
                    to: effectiveToDate
                });
                const result = res.data;
                if (!result || !Array.isArray(result.data)) break;

                for (const review of result.data) {
                    const docId = `booking_${review.review_id}`;
                    batch.push({
                        id: docId,
                        data: {
                            reviewId: review.review_id,
                            companyId,
                            channel: "booking",
                            building: prop.name,
                            propertyId: prop.v2Id,
                            roomId: null,
                            roomName: null,
                            score: review.scoring?.review_score || 0,
                            categories: {
                                facilities: review.scoring?.facilities ?? null,
                                comfort: review.scoring?.comfort ?? null,
                                staff: review.scoring?.staff ?? null,
                                value: review.scoring?.value ?? null,
                                clean: review.scoring?.clean ?? null,
                                location: review.scoring?.location ?? null
                            },
                            content: {
                                positive: review.content?.positive || null,
                                negative: review.content?.negative || null,
                                text: null
                            },
                            reviewerName: review.reviewer?.name || null,
                            reviewerCountry: review.reviewer?.country_code || null,
                            hasReply: !!review.reply,
                            reply: review.reply || null,
                            createdAt: review.created_timestamp || null,
                            reservationId: String(review.reservation_id || ""),
                            syncedAt: admin.firestore.FieldValue.serverTimestamp()
                        }
                    });
                }
                console.log(`[syncReviews] Booking.com ${prop.name}: ${result.data.length}건 (page ${pageCount + 1})`);

                // 페이지네이션
                if (result.pages?.nextPageExists && result.data.length > 0) {
                    const lastTs = result.data[result.data.length - 1].created_timestamp;
                    const lastDate = lastTs ? lastTs.split(" ")[0] : null;
                    if (lastDate && lastDate !== pageFrom) {
                        pageFrom = lastDate;
                        pageCount++;
                    } else { hasMore = false; }
                } else { hasMore = false; }
                await new Promise(r => setTimeout(r, 300));
            }
        } catch (err) {
            console.warn(`[syncReviews] Booking.com ${prop.name} 실패:`, err.message);
        }
        await new Promise(r => setTimeout(r, 300));
    }

    // 2. Airbnb 리뷰 (객실별)
    for (const [buildingName, rooms] of Object.entries(BUILDING_ROOMS)) {
        const prop = PROPERTIES.find(p => p.name === buildingName);
        if (!prop || prop.disabled) continue;

        for (const room of rooms) {
            try {
                let hasMore = true;
                let nextLink = null;
                let pageCount = 0;
                let roomTotal = 0;

                while (hasMore && pageCount < 20) {
                    let result;
                    if (nextLink) {
                        // nextPageLink는 전체 URL — 토큰만 헤더로 추가
                        const token = await getBeds24Token();
                        const pageRes = await axios.get(nextLink, { headers: { token } });
                        result = pageRes.data;
                    } else {
                        const res = await beds24GetV2WithRetry("/channels/airbnb/reviews", {
                            roomId: parseInt(room.roomId)
                        });
                        result = res.data;
                    }

                    if (!result || !Array.isArray(result.data)) break;

                    for (const review of result.data) {
                        const reviewDate = review.submitted_at || review.first_completed_at || null;
                        if (reviewDate && reviewDate.substring(0, 10) < fromDate) continue;
                        if (reviewDate && reviewDate.substring(0, 10) > effectiveToDate) continue;

                        const docId = `airbnb_${review.id}`;
                        const cats = {};
                        if (Array.isArray(review.category_ratings)) {
                            for (const c of review.category_ratings) {
                                cats[c.category] = c.rating;
                            }
                        }
                        batch.push({
                            id: docId,
                            data: {
                                reviewId: String(review.id),
                                companyId,
                                channel: "airbnb",
                                building: buildingName,
                                propertyId: prop.v2Id,
                                roomId: room.roomId,
                                roomName: room.name,
                                score: review.overall_rating ? review.overall_rating * 2 : 0,
                                rawScore: review.overall_rating || 0,
                                categories: cats,
                                content: {
                                    positive: null,
                                    negative: null,
                                    text: review.public_review || null
                                },
                                reviewerName: review.reviewer_id ? `Guest #${String(review.reviewer_id).slice(-6)}` : null,
                                reviewerId: review.reviewer_id || null,
                                reviewerCountry: null,
                                hasReply: false,
                                reply: null,
                                createdAt: review.submitted_at || review.first_completed_at || null,
                                reservationId: review.reservation_confirmation_code || null,
                                listingId: review.listing_id || null,
                                syncedAt: admin.firestore.FieldValue.serverTimestamp()
                            }
                        });
                    }
                    roomTotal += result.data.length;

                    if (result.pages?.nextPageExists && result.pages?.nextPageLink) {
                        nextLink = result.pages.nextPageLink;
                        pageCount++;
                        await new Promise(r => setTimeout(r, 300));
                    } else {
                        hasMore = false;
                    }
                }

                if (roomTotal > 0) {
                    console.log(`[syncReviews] Airbnb ${buildingName} ${room.name} (${room.roomId}): ${roomTotal}건`);
                }
            } catch (err) {
                // Airbnb에 등록되지 않은 방은 400 에러 — 조용히 무시
                if (err.response?.status !== 400) {
                    console.warn(`[syncReviews] Airbnb ${buildingName} ${room.name} (${room.roomId}) 실패:`, err.message);
                }
            }
            await new Promise(r => setTimeout(r, 200));
        }
    }

    // Firestore batch write (400개씩 분할)
    const CHUNK = 400;
    if (insertOnly) {
        // insertOnly: Firestore에 없는 것만 저장
        let insertedCount = 0;
        for (let i = 0; i < batch.length; i += CHUNK) {
            const chunk = batch.slice(i, i + CHUNK);
            const wb = db.batch();
            for (const item of chunk) {
                const ref = db.collection("reviews").doc(item.id);
                const snap = await ref.get();
                if (!snap.exists) {
                    wb.set(ref, item.data);
                    insertedCount++;
                }
            }
            await wb.commit();
        }
        console.log(`[syncReviews] insertOnly: ${insertedCount}건 신규 저장 (총 fetch: ${batch.length}건)`);
        return insertedCount;
    } else {
        // 기본: upsert (변경사항 반영)
        for (let i = 0; i < batch.length; i += CHUNK) {
            const chunk = batch.slice(i, i + CHUNK);
            const wb = db.batch();
            for (const item of chunk) {
                const ref = db.collection("reviews").doc(item.id);
                wb.set(ref, item.data, { merge: true });
            }
            await wb.commit();
        }
        return batch.length;
    }
}

// 리뷰 풀 재대사: Beds24 전체 목록 vs Firestore 비교 → 삭제된 리뷰 하드 삭제
async function reconcileReviews(companyId) {
    const beds24ReviewIds = new Set();

    // Booking.com 전체 리뷰 ID 수집
    for (const prop of PROPERTIES) {
        if (prop.disabled) continue;
        try {
            let hasMore = true;
            let pageFrom = "2020-01-01";
            let pageCount = 0;
            while (hasMore && pageCount < 50) {
                const res = await beds24GetV2WithRetry("/channels/booking/reviews", { propertyId: prop.v2Id, from: pageFrom });
                const result = res.data;
                if (!result || !Array.isArray(result.data) || result.data.length === 0) break;
                result.data.forEach(r => beds24ReviewIds.add(`booking_${r.review_id}`));
                if (result.pages?.nextPageExists) {
                    const lastTs = result.data[result.data.length - 1].created_timestamp;
                    const lastDate = lastTs ? lastTs.split(" ")[0] : null;
                    if (lastDate && lastDate !== pageFrom) { pageFrom = lastDate; pageCount++; }
                    else { hasMore = false; }
                } else { hasMore = false; }
                await new Promise(r => setTimeout(r, 300));
            }
        } catch (err) {
            console.warn(`[reconcileReviews] Booking.com ${prop.name} 실패:`, err.message);
        }
        await new Promise(r => setTimeout(r, 300));
    }

    // Airbnb 전체 리뷰 ID 수집
    for (const [, rooms] of Object.entries(BUILDING_ROOMS)) {
        for (const room of rooms) {
            try {
                const res = await beds24GetV2WithRetry("/channels/airbnb/reviews", { roomId: parseInt(room.roomId) });
                const result = res.data;
                if (result && Array.isArray(result.data)) {
                    result.data.forEach(r => beds24ReviewIds.add(`airbnb_${r.id}`));
                }
            } catch (err) {
                if (err.response?.status !== 400) console.warn(`[reconcileReviews] Airbnb ${room.name} 실패:`, err.message);
            }
            await new Promise(r => setTimeout(r, 200));
        }
    }

    // Firestore에서 삭제된 리뷰 찾아서 하드 삭제
    const firestoreSnap = await db.collection("reviews").where("companyId", "==", companyId).get();
    const toDelete = firestoreSnap.docs.filter(d => !beds24ReviewIds.has(d.id));
    const CHUNK = 400;
    for (let i = 0; i < toDelete.length; i += CHUNK) {
        const wb = db.batch();
        toDelete.slice(i, i + CHUNK).forEach(d => wb.delete(d.ref));
        await wb.commit();
    }
    console.log(`[reconcileReviews] 완료: Beds24 ${beds24ReviewIds.size}건, Firestore ${firestoreSnap.size}건, 삭제 ${toDelete.length}건`);
    return toDelete.length;
}

// ==========================================
// 통합 동기화 (예약 + 리뷰, 기간 선택, 없는 데이터만 저장)
// ==========================================
exports.unifiedSync = onRequest({ cors: true, timeoutSeconds: 900, memory: "2GiB" }, async (req, res) => {
    try {
        const { companyId, fromDate, toDate } = req.body;
        if (!companyId) return res.status(400).json({ error: "Missing companyId" });
        if (!fromDate) return res.status(400).json({ error: "Missing fromDate" });

        console.log(`🔄 [UnifiedSync] 시작: fromDate=${fromDate}, toDate=${toDate || "auto"}, companyId=${companyId}`);

        // 1. 예약 동기화 — fetchFromBeds24Full 패턴 그대로, fromDate/toDate 커스텀
        const arrivalFrom = fromDate; // YYYY-MM-DD 형식 그대로
        const arrivalTo = toDate || dayjs().add(24, "month").format("YYYY-MM-DD");
        // 과거 데이터(6개월 이상 이전) 동기화 시 inquiry/request/black 스킵 — 속도 최적화
        const isLegacyRange = toDate && dayjs(toDate).isBefore(dayjs().subtract(6, "month"));
        const allBookings = [];
        for (const prop of PROPERTIES) {
            if (prop.disabled) continue;
            console.log(`[UnifiedSync] 예약 fetch: ${prop.name} (${arrivalFrom} ~ ${arrivalTo})${isLegacyRange ? " [legacy mode]" : ""}`);
            const bookings = await fetchAllBookingsFromProperty(prop, { arrivalFrom, arrivalTo }, { legacyMode: isLegacyRange });
            allBookings.push(...bookings);
            await new Promise(r => setTimeout(r, 500));
        }
        console.log(`[UnifiedSync] 예약 fetch 완료: ${allBookings.length}건`);
        const reservationResult = await incrementalReservationSync(allBookings, companyId, "unified_sync");
        console.log(`✅ [UnifiedSync] 예약 완료: ${reservationResult.upsertedCount}건`);

        // 2. 리뷰 동기화 — 과거 데이터 모드에서는 스킵 (Airbnb 리뷰가 roomId별 65회+ 호출로 타임아웃 유발)
        let reviewCount = 0;
        if (!isLegacyRange) {
            reviewCount = await syncAllReviews(companyId, fromDate, { insertOnly: true, toDate: arrivalTo });
            console.log(`✅ [UnifiedSync] 리뷰 완료: ${reviewCount}건 신규`);
        } else {
            console.log(`⏭️ [UnifiedSync] 리뷰 동기화 스킵 (과거 데이터 모드)`);
        }

        res.json({
            success: true,
            reservations: { upserted: reservationResult.upsertedCount },
            reviews: { inserted: reviewCount }
        });
    } catch (err) {
        console.error("[unifiedSync] 실패:", err);
        res.status(500).json({ error: err.message });
    }
});

// 리뷰 증분 자동 동기화 (3시간마다, 최근 30일)
exports.scheduledReviewsSync = onSchedule({
    schedule: "0 0,3,6,9,12,15,18,21 * * *",
    timeoutSeconds: 540,
    memory: "512MiB"
}, async () => {
    const companyId = DEFAULT_COMPANY_ID;
    const count = await syncAllReviews(companyId);
    console.log(`✅ 리뷰 증분 동기화 완료: ${count}건 (${dayjs().utcOffset(9).format("YYYY-MM-DD HH:mm")})`);
});

// 리뷰 풀 재대사 (매일 새벽 3시 JST — 삭제된 리뷰 정리)
exports.scheduledReviewsReconcile = onSchedule({
    schedule: "0 18 * * *", // 매일 18:00 UTC = JST 03:00
    timeZone: "Asia/Tokyo",
    timeoutSeconds: 540,
    memory: "512MiB"
}, async () => {
    const companyId = DEFAULT_COMPANY_ID;
    const deleted = await reconcileReviews(companyId);
    console.log(`✅ 리뷰 재대사 완료: ${deleted}건 삭제 (${dayjs().utcOffset(9).format("YYYY-MM-DD HH:mm")})`);
});

// 입/퇴실 조회
exports.getTodayArrivals = onRequest({ cors: true }, async (req, res) => {
    const date = req.body.date || dayjs().format("YYYY-MM-DD");
    const companyId = req.body.companyId || DEFAULT_COMPANY_ID;

    const snap = await db.collection("reservations")
        .where("companyId", "==", companyId)
        .where("status", "==", "confirmed")
        .get();

    const list = [];
    snap.forEach((d) => {
        const x = d.data();
        if (x.arrival === date || x.departure === date) list.push(x);
    });

    res.json({ success: true, data: list });
});


// 건물별 roomId 매핑
const BUILDING_ROOMS = {
    "아라키초A": [
        { roomId: "383971", name: "201호" }, { roomId: "601545", name: "201호" },
        { roomId: "403542", name: "202호" }, { roomId: "601546", name: "202호" },
        { roomId: "383972", name: "301호" }, { roomId: "601547", name: "301호" },
        { roomId: "383978", name: "302호" }, { roomId: "601548", name: "302호" },
        { roomId: "440617", name: "401호" }, { roomId: "515300", name: "401호" },
        { roomId: "383974", name: "402호" }, { roomId: "601549", name: "402호" },
        { roomId: "383975", name: "501호" }, { roomId: "502229", name: "501호" },
        { roomId: "383976", name: "502호" }, { roomId: "601550", name: "502호" },
        { roomId: "537451", name: "602호" }, { roomId: "601551", name: "602호" },
        { roomId: "383973", name: "701호" }, { roomId: "601552", name: "701호" },
        { roomId: "383977", name: "702호" }, { roomId: "601553", name: "702호" }
    ],
    "아라키초B": [
        { roomId: "585734", name: "101호" }, { roomId: "585738", name: "102호" },
        { roomId: "585735", name: "201호" }, { roomId: "585739", name: "202호" },
        { roomId: "585736", name: "301호" }, { roomId: "585740", name: "302호" },
        { roomId: "585737", name: "401호" }, { roomId: "585741", name: "402호" }
    ],
    "다이쿄초": [
        { roomId: "440619", name: "B01호" }, { roomId: "440620", name: "B02호" },
        { roomId: "440621", name: "101호" }, { roomId: "440622", name: "102호" },
        { roomId: "440623", name: "201호" }, { roomId: "440624", name: "202호" },
        { roomId: "440625", name: "302호" }
    ],
    "가부키초": [
        { roomId: "383979", name: "202호" }, { roomId: "451220", name: "202호" },
        { roomId: "383980", name: "203호" }, { roomId: "452061", name: "203호" },
        { roomId: "383981", name: "302호" }, { roomId: "452062", name: "302호" },
        { roomId: "383982", name: "303호" }, { roomId: "451223", name: "303호" },
        { roomId: "383983", name: "402호" }, { roomId: "451224", name: "402호" },
        { roomId: "383984", name: "403호" }, { roomId: "452063", name: "403호" },
        { roomId: "543189", name: "502호" }, { roomId: "601560", name: "502호" },
        { roomId: "383985", name: "603호" }, { roomId: "452064", name: "603호" },
        { roomId: "441885", name: "802호" }, { roomId: "452065", name: "802호" },
        { roomId: "624198", name: "803호" }, { roomId: "648398", name: "803호" }
    ],
    "다카다노바바": [
        { roomId: "513698", name: "201호" }, { roomId: "513699", name: "301호" },
        { roomId: "513700", name: "401호" }, { roomId: "556719", name: "401호" },
        { roomId: "513701", name: "501호" }, { roomId: "513702", name: "601호" },
        { roomId: "513703", name: "701호" }, { roomId: "513704", name: "801호" },
        { roomId: "513705", name: "901호" }
    ],
    "오쿠보A동": [{ roomId: "437952", name: "오쿠보A" }],
    "오쿠보B동": [{ roomId: "615969", name: "오쿠보B" }],
    "오쿠보C동": [{ roomId: "450096", name: "오쿠보C" }, { roomId: "496532", name: "오쿠보C" }, { roomId: "648399", name: "오쿠보C" }],
    "사노시": [{ roomId: "481152", name: "사노" }]
};

const {
    sendSyncAlert,
    buildAndSendSlackDailyReport,
    buildAndSendSlackCleaningReport,
    scheduledSlackDailyReport,
    sendSlackDailyReportManual,
    scheduledSlackCleaningReport,
    sendSlackCleaningReportManual
} = createSlackReportModule({
    onRequest,
    onSchedule,
    cors,
    db,
    dayjs,
    DEFAULT_COMPANY_ID,
    filterDocsToCompany,
    getBookingAmount,
    assertReservationDataReady,
    getEffectiveCompanyId
});

const {
    runScheduledDailyReport,
    scheduledPlatformAnalysisHourly,
    scheduledPaxOccupancyReport,
    scheduledMonthlyBriefingSetup
} = createGoogleSheetReportModule({
    onSchedule,
    admin,
    dayjs,
    DEFAULT_COMPANY_ID,
    filterDocsToCompany,
    getBookingAmount,
    assertReservationDataReady,
    sendSyncAlert,
    BUILDING_ROOMS
});

const {
    scheduledMonthlyNotionReport,
    sendNotionReport
} = createNotionReportModule({
    onSchedule,
    onRequest,
    cors,
    db,
    dayjs,
    DEFAULT_COMPANY_ID,
    BUILDING_ROOMS
});

// ==========================================
// 가격 조회: Legacy API (효과적인 가격 반환 - API V2는 명시적 설정값만 반환하므로 사용 불가)
// ==========================================

// ==========================================
// 가격 조회 (Firestore 캐시에서 읽기 - API 호출 없음)
// ==========================================
// ★ 가격 설정 (수동) - V2 마이그레이션 완료
// V2: POST /inventory/rooms/calendar
// ==========================================
// 가격 수정 Job Queue
// [Beds24 공식 문서 전제]
// Beds24 V2 API는 계정 단위 200 credit 공유 한도를 사용.
// 예약/가격/캘린더/메시지 등 모든 API 호출이 동일 budget을 소비.
// 여러 roomId를 즉시 순차 POST하면 scheduled sync / webhook sync와
// credit 경쟁이 발생하고 429 / limit exceeded 확률이 높아짐.
// → setRoomPrices는 Firestore bed24_price_jobs에 job을 적재만 하고,
//    scheduledPriceJobWorker가 1분 간격으로 job 1개씩 직렬 처리.
// ==========================================
exports.setRoomPrices = onRequest({ cors: true, timeoutSeconds: 30 }, async (req, res) => {
    try {
        const { companyId, roomId, roomIds, dates, building, worker, workerEmail, roomUpdates } = req.body;
        if (!companyId) return res.status(400).json({ success: false, error: "Missing companyId" });

        const normalizedRoomUpdates = [];
        if (Array.isArray(roomUpdates) && roomUpdates.length > 0) {
            roomUpdates.forEach((roomUpdate) => {
                const updateDates = roomUpdate?.dates || {};
                const updateRoomIds = roomUpdate?.roomIds || (roomUpdate?.roomId ? [roomUpdate.roomId] : []);
                if (updateRoomIds.length === 0 || Object.keys(updateDates).length === 0) return;
                const calendarUpdates = buildBeds24CalendarUpdatesFromDates(updateDates);
                updateRoomIds.forEach((rid) => {
                    normalizedRoomUpdates.push({
                        roomId: String(rid),
                        roomName: roomUpdate?.roomName || null,
                        dates: updateDates,
                        calendarUpdates
                    });
                });
            });
        } else {
            const inputRoomIds = roomIds || (roomId ? [roomId] : []);
            if (inputRoomIds.length === 0 || !dates) {
                return res.status(400).json({ error: "Missing roomId/roomIds or dates" });
            }
            const calendarUpdates = buildBeds24CalendarUpdatesFromDates(dates);
            inputRoomIds.forEach((rid) => {
                normalizedRoomUpdates.push({
                    roomId: String(rid),
                    roomName: null,
                    dates,
                    calendarUpdates
                });
            });
        }

        if (normalizedRoomUpdates.length === 0) {
            return res.status(400).json({ success: false, error: "No valid room updates to queue" });
        }

        const activeRoomIds = [...new Set(normalizedRoomUpdates.map((item) => String(item.roomId)))];

        // Firestore에 price job 생성 — 즉시 Beds24 호출 없음
        const jobRef = await db.collection("beds24_price_jobs").add({
            companyId,
            building: building || null,
            roomIds: activeRoomIds,
            dates: dates || null,
            calendarUpdates: null,
            roomUpdates: normalizedRoomUpdates,
            worker: worker || null,
            workerEmail: workerEmail || null,
            status: "queued",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            startedAt: null,
            completedAt: null,
            progress: { processed: 0, total: activeRoomIds.length, results: [] },
            failedRoomIds: [],
            retryCount: 0,
            error: null
        });

        const totalDateCount = normalizedRoomUpdates.reduce((sum, item) => sum + Object.keys(item.dates || {}).length, 0);
        console.log(`[setRoomPrices] Job 생성: ${jobRef.id} (${activeRoomIds.length}개 roomId, ${totalDateCount}개 room-date update)`);
        res.json({
            queued: true,
            jobId: jobRef.id,
            success: true,
            message: `가격 수정 작업이 접수되었습니다. 순차 처리 중입니다. (${activeRoomIds.length}개 객실)`,
            roomIds: activeRoomIds,
            // 프론트 호환: results 형식 유지 (log 저장 시 success:true로 집계됨)
            results: activeRoomIds.map(rid => ({ roomId: rid, success: true, queued: true }))
        });
    } catch (e) {
        console.error("setRoomPrices Queue Error:", e.response?.data || e.message);
        res.status(500).json({ success: false, error: e.response?.data?.error || e.message });
    }
});

exports.getCachedPrices = onRequest({ cors: true }, async (req, res) => {
    try {
        const { companyId, building, dateFrom, dateTo } = req.body;

        if (!companyId) return res.status(400).json({ success: false, error: "Missing companyId" });
        if (!building) {
            return res.status(400).json({ success: false, error: "건물명이 필요합니다" });
        }

        const normalizeDateKey = (value) => value ? String(value).replace(/-/g, "") : null;
        const fromKey = normalizeDateKey(dateFrom);
        const toKey = normalizeDateKey(dateTo);
        const useDateRangeFilter = !!(fromKey && toKey && fromKey <= toKey);

        const docRef = db.collection("price_sync").doc(building);
        const doc = await docRef.get();

        if (!doc.exists) {
            return res.json({
                success: false,
                error: "캐시된 가격 데이터가 없습니다. 잠시 후 다시 시도해주세요.",
                noCache: true
            });
        }

        const docData = doc.data();
        if (docData.companyId && docData.companyId !== companyId) {
            return res.status(403).json({ success: false, error: "Access denied: companyId mismatch" });
        }

        // 새 구조: rooms 서브컬렉션에서 모든 방 데이터 가져오기
        const priceData = {};
        const roomsSnap = await docRef.collection("rooms").get();
        roomsSnap.forEach(roomDoc => {
            const roomData = roomDoc.data();
            if (!useDateRangeFilter || !roomData?.dates) {
                priceData[roomDoc.id] = roomData;
                return;
            }

            const filteredDates = {};
            for (const [dateKey, dateValue] of Object.entries(roomData.dates)) {
                if (dateKey >= fromKey && dateKey <= toKey) {
                    filteredDates[dateKey] = dateValue;
                }
            }

            priceData[roomDoc.id] = {
                ...roomData,
                dates: filteredDates
            };
        });

        const data = doc.data();
        const lastSync = data.lastSync?.toDate() || null;
        const diffMinutes = lastSync ? Math.round((new Date() - lastSync) / (1000 * 60)) : null;

        res.json({
            success: true,
            building: data.building,
            priceData, // 집계된 데이터
            dateFrom: data.dateFrom,
            dateTo: data.dateTo,
            requestedDateFrom: useDateRangeFilter ? `${fromKey.slice(0, 4)}-${fromKey.slice(4, 6)}-${fromKey.slice(6, 8)}` : null,
            requestedDateTo: useDateRangeFilter ? `${toKey.slice(0, 4)}-${toKey.slice(4, 6)}-${toKey.slice(6, 8)}` : null,
            lastSync: lastSync?.toISOString(),
            syncAge: diffMinutes,
            roomCount: Object.keys(priceData).length // 실제 로드된 방 개수
        });
    } catch (e) {
        console.error("getCachedPrices Error:", e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==========================================
// 수기예약/수정 전 실시간 확인 (충돌 방지)
// ==========================================
exports.checkAvailability = onRequest({ cors: true, timeoutSeconds: 60 }, async (req, res) => {
    try {
        const { companyId, building, roomId, dateFrom, dateTo } = req.body;

        if (!companyId) return res.status(400).json({ success: false, error: "Missing companyId" });
        if (!building || !roomId || !dateFrom || !dateTo) {
            return res.status(400).json({ success: false, error: "building, roomId, dateFrom, dateTo가 필요합니다" });
        }

        const prop = PROPERTIES.find(p => p.name === building);
        if (!prop) {
            return res.status(400).json({ success: false, error: "건물을 찾을 수 없습니다" });
        }

        // V2 날짜 포맷 확인 (YYYY-MM-DD)
        const toV2Date = (d) => d.includes("-") ? d : `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
        const v2From = toV2Date(dateFrom);
        const v2To = toV2Date(dateTo);

        // Beds24에서 실시간 availability 조회 (V2 API 사용)
        // includeX 파라미터 필수! 없으면 데이터가 반환되지 않음
        const response = await beds24GetV2WithRetry("/inventory/rooms/calendar", {
            roomId: roomId,
            startDate: v2From,
            endDate: v2To,
            includePrices: true,
            includeLinkedPrices: true,
            includeMinStay: true,
            includeMaxStay: true,
            includeNumAvail: true
        });

        let available = true;
        let conflictDates = [];

        // V2 응답 파싱: { data: [{ roomId, calendar: [{ from, to, numAvail, ... }] }] }
        const roomData = response.data?.data?.[0];
        if (roomData && Array.isArray(roomData.calendar)) {
            roomData.calendar.forEach(entry => {
                // numAvail이 0이면 예약 불가
                if (entry.numAvail !== undefined && entry.numAvail === 0) {
                    available = false;
                    // from/to 범위의 모든 날짜를 conflictDates에 추가
                    const fromDate = dayjs(entry.from);
                    const toDate = dayjs(entry.to);
                    for (let d = fromDate; d.isBefore(toDate) || d.isSame(toDate, 'day'); d = d.add(1, 'day')) {
                        conflictDates.push(d.format('YYYY-MM-DD'));
                    }
                }
            });
        }

        res.json({
            success: true,
            available,
            conflictDates,
            message: available ? "예약 가능합니다" : `해당 기간에 이미 예약이 있습니다: ${conflictDates.join(", ")}`
        });
    } catch (e) {
        console.error("checkAvailability Error:", e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});


// ==========================================
// Price Job Worker
// beds24_price_jobs 컬렉션에서 queued job을 1개씩 직렬 처리.
// acquirePriceSyncLock 재사용 → scheduled sync / webhook sync와 credit 경쟁 방지.
// ==========================================

// price job 1개 처리 (core logic)
async function processPriceJob(jobId) {
    const jobRef = db.collection("beds24_price_jobs").doc(jobId);

    // 기존 price sync lock 재사용 (scheduled/webhook sync와 동시 write 방지)
    const { acquired } = await acquirePriceSyncLock("priceJobWorker");
    if (!acquired) {
        console.log(`[PriceJob ${jobId}] 락 점유 중 — 스킵`);
        return { skipped: true, reason: "lock_busy" };
    }

    try {
        let jobData = null;

        // Firestore 트랜잭션: queued → processing 원자적 전환 (중복 실행 방지)
        try {
            await db.runTransaction(async (tx) => {
                const snap = await tx.get(jobRef);
                if (!snap.exists) throw new Error("Job not found");
                const data = snap.data();
                if (data.status !== "queued") throw new Error(`SKIP:${data.status}`);
                tx.update(jobRef, {
                    status: "processing",
                    startedAt: admin.firestore.FieldValue.serverTimestamp(),
                    retryCount: (data.retryCount || 0) + 1
                });
                jobData = data;
            });
        } catch (txErr) {
            if (txErr.message?.startsWith("SKIP:")) {
                console.log(`[PriceJob ${jobId}] ${txErr.message} — 스킵`);
                return { skipped: true };
            }
            throw txErr;
        }

        const { building, roomIds: rawRoomIds, calendarUpdates, dates, roomUpdates, companyId: jobCompanyId, worker: jobWorker, workerEmail: jobWorkerEmail } = jobData;
        const normalizedRoomUpdates = Array.isArray(roomUpdates) && roomUpdates.length > 0
            ? roomUpdates
                .filter((item) => item?.roomId && item?.dates && Object.keys(item.dates).length > 0)
                .map((item) => ({
                    roomId: String(item.roomId),
                    roomName: item.roomName || null,
                    dates: item.dates,
                    calendarUpdates: Array.isArray(item.calendarUpdates) ? item.calendarUpdates : buildBeds24CalendarUpdatesFromDates(item.dates)
                }))
            : (rawRoomIds || []).map((rid) => ({
                roomId: String(rid),
                roomName: null,
                dates: dates || {},
                calendarUpdates: Array.isArray(calendarUpdates) ? calendarUpdates : buildBeds24CalendarUpdatesFromDates(dates || {})
            }));
        const roomIds = normalizedRoomUpdates.map((item) => item.roomId);
        const roomUpdateByRoomId = {};
        normalizedRoomUpdates.forEach((item) => {
            roomUpdateByRoomId[item.roomId] = item;
        });
        const buildingRef = db.collection("price_sync").doc(building);
        const results = [];
        const oldPricesByRoom = {}; // 로그용 구 가격 수집 { rid: { dateKey: p1 } }

        // ★ Batch POST: roomId를 묶어 한 번에 전송 (account-level credit 절약)
        // calendarUpdates는 이미 연속 날짜가 병합된 상태 (consolidateCalendarRanges).
        // beds24PostV2WithRetry가 credit-aware pacing을 제공하므로 배치 간 고정 딜레이 불필요.
        const PRICE_JOB_BATCH_SIZE = 50;
        const batches = [];
        for (let i = 0; i < roomIds.length; i += PRICE_JOB_BATCH_SIZE) {
            batches.push(roomIds.slice(i, i + PRICE_JOB_BATCH_SIZE));
        }

        let processedCount = 0;
        for (let b = 0; b < batches.length; b++) {
            const batchRoomIds = batches[b].map(String);
            const payload = batchRoomIds.map(rid => ({
                roomId: parseInt(rid),
                calendar: roomUpdateByRoomId[rid]?.calendarUpdates || []
            }));

            try {
                const apiResp = await beds24PostV2WithRetry("/inventory/rooms/calendar", payload);

                // Beds24 V2: 응답이 배열이면 요청 payload와 동일 순서로 roomId별 결과가 옴
                const respItems = Array.isArray(apiResp.data) ? apiResp.data
                    : (Array.isArray(apiResp.data?.data) ? apiResp.data.data : null);

                if (respItems && respItems.length === batchRoomIds.length) {
                    let batchSuccessCount = 0;
                    let batchFailCount = 0;
                    for (let ri = 0; ri < batchRoomIds.length; ri++) {
                        const rid = batchRoomIds[ri];
                        const item = respItems[ri];
                        const itemHasErrors = item?.errors && item.errors.length > 0;
                        const itemSuccess = item?.success !== false && !itemHasErrors;

                        if (itemSuccess) {
                            results.push({ roomId: rid, success: true });
                            batchSuccessCount++;
                            try {
                                const roomDocRef = buildingRef.collection("rooms").doc(rid);
                                const roomSnap = await roomDocRef.get();
                                let roomData = roomSnap.exists ? roomSnap.data() : { roomId: rid, dates: {} };
                                if (!roomData.dates) roomData.dates = {};
                                const roomUpdate = roomUpdateByRoomId[rid];
                                const roomDates = roomUpdate?.dates || {};
                                // 로그용 구 가격 수집 (패치 전)
                                oldPricesByRoom[rid] = {};
                                Object.keys(roomDates).forEach(dKey => { oldPricesByRoom[rid][dKey] = parseFloat(roomData.dates[dKey]?.p1) || 0; });
                                roomData.lastManualUpdate = admin.firestore.FieldValue.serverTimestamp();
                                Object.entries(roomDates).forEach(([dKey, values]) => {
                                    if (!roomData.dates[dKey]) roomData.dates[dKey] = {};
                                    if (values.p1 !== undefined) roomData.dates[dKey].p1 = String(values.p1);
                                    if (values.p2 !== undefined) roomData.dates[dKey].p2 = String(values.p2);
                                    // minStay excluded from price job cache patch (setMinStay handles its own cache)
                                });
                                await roomDocRef.set(roomData, { merge: true });
                            } catch (cacheErr) {
                                console.error(`[PriceJob ${jobId}] 캐시 패치 실패 roomId=${rid}:`, cacheErr.message);
                            }
                        } else {
                            const errMsg = item?.errors?.map(e => e.message).join("; ") || "Beds24 item-level failure";
                            results.push({ roomId: rid, success: false, error: errMsg });
                            batchFailCount++;
                        }
                    }
                    console.log(`[PriceJob ${jobId}] 배치 ${b + 1}/${batches.length}: 성공=${batchSuccessCount}, 실패=${batchFailCount}`);
                } else {
                    // 응답이 배열이 아니거나 길이 불일치 — 전체 success 판정 (기존 fallback)
                    throw new Error(
                        (apiResp.data && apiResp.data.success === false)
                            ? (apiResp.data.error || "Beds24 batch POST 실패")
                            : "Unexpected Beds24 batch response shape"
                    );
                    for (const rid of batchRoomIds) {
                        results.push({ roomId: rid, success: true });
                        try {
                            const roomDocRef = buildingRef.collection("rooms").doc(rid);
                            const roomSnap = await roomDocRef.get();
                            let roomData = roomSnap.exists ? roomSnap.data() : { roomId: rid, dates: {} };
                            if (!roomData.dates) roomData.dates = {};
                            // 로그용 구 가격 수집 (패치 전)
                            oldPricesByRoom[rid] = {};
                            Object.keys(dates).forEach(dKey => { oldPricesByRoom[rid][dKey] = parseFloat(roomData.dates[dKey]?.p1) || 0; });
                            roomData.lastManualUpdate = admin.firestore.FieldValue.serverTimestamp();
                            Object.entries(dates).forEach(([dKey, values]) => {
                                if (!roomData.dates[dKey]) roomData.dates[dKey] = {};
                                if (values.p1 !== undefined) roomData.dates[dKey].p1 = String(values.p1);
                                if (values.p2 !== undefined) roomData.dates[dKey].p2 = String(values.p2);
                            });
                            await roomDocRef.set(roomData, { merge: true });
                        } catch (cacheErr) {
                            console.error(`[PriceJob ${jobId}] 캐시 패치 실패 roomId=${rid}:`, cacheErr.message);
                        }
                    }
                    console.log(`[PriceJob ${jobId}] 배치 ${b + 1}/${batches.length} 성공 (${batchRoomIds.length}개 roomId, non-array response)`);
                }
            } catch (err) {
                // HTTP-level 실패 (429 등) — 해당 배치 roomId 전체 failed 기록
                for (const rid of batchRoomIds) {
                    results.push({ roomId: rid, success: false, error: err.message });
                }
                console.error(`[PriceJob ${jobId}] 배치 ${b + 1}/${batches.length} 실패:`, err.message);
            }

            processedCount += batchRoomIds.length;
            await jobRef.update({ "progress.processed": processedCount, "progress.results": results });
        }

        const successCount = results.filter(r => r.success).length;
        const failedRoomIds = results.filter(r => !r.success).map(r => r.roomId);
        let finalStatus = "completed";
        if (successCount === 0) finalStatus = "failed";
        else if (failedRoomIds.length > 0) finalStatus = "partial_failed";

            await jobRef.update({
                status: finalStatus,
                completedAt: admin.firestore.FieldValue.serverTimestamp(),
                "progress.processed": roomIds.length,
            "progress.results": results,
            failedRoomIds,
            error: failedRoomIds.length > 0 ? `${failedRoomIds.length}개 roomId 실패: ${failedRoomIds.join(", ")}` : null
        });

        // ★ 실제 완료 결과 기준으로 price_change_logs 기록 (queued 시점 프론트 가짜 로그 대신)
        try {
            // 1. roomId → room name 역 매핑 (building 기준)
            const buildingRoomList = BUILDING_ROOMS[building] || [];
            const roomIdToName = {};
            buildingRoomList.forEach(r => { if (!roomIdToName[r.roomId]) roomIdToName[r.roomId] = r.name; });

            // 2. YYYYMMDD → YYYY-MM-DD 변환 헬퍼
            const toDateStr = (yyyymmdd) => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
            const mergedDates = {};
            normalizedRoomUpdates.forEach((item) => {
                Object.entries(item.dates || {}).forEach(([dKey, val]) => {
                    mergedDates[dKey] = val;
                });
            });
            const sortedDateKeys = Object.keys(mergedDates).sort();
            const dateFrom = sortedDateKeys.length > 0 ? toDateStr(sortedDateKeys[0]) : null;
            const dateTo = sortedDateKeys.length > 0 ? toDateStr(sortedDateKeys[sortedDateKeys.length - 1]) : null;

            // 3. 성공한 roomId 기준 표시용 객실명 (중복 제거)
            const successRoomIds = results.filter(r => r.success).map(r => String(r.roomId));
            const baseRoomIds = successRoomIds.length > 0 ? successRoomIds : roomIds.map(String);
            const roomNames = [...new Set(baseRoomIds.map(rid => roomIdToName[rid] || rid))];

            // 4. priceSnapshot (성공 객실만, 실패 객실은 포함하지 않음)
            const priceSnapshot = [];
            successRoomIds.forEach(rid => {
                const roomUpdate = roomUpdateByRoomId[rid];
                const roomName = roomUpdate?.roomName || roomIdToName[rid] || rid;
                Object.keys(roomUpdate?.dates || {}).sort().forEach(dKey => {
                    priceSnapshot.push({
                        date: toDateStr(dKey),
                        room: roomName,
                        oldPrice: oldPricesByRoom[rid]?.[dKey] || 0,
                        newPrice: parseInt(roomUpdate?.dates?.[dKey]?.p1) || 0
                    });
                });
            });
            const avgOldPrice = priceSnapshot.length > 0
                ? Math.round(priceSnapshot.reduce((s, p) => s + p.oldPrice, 0) / priceSnapshot.length) : 0;
            const avgNewPrice = priceSnapshot.length > 0
                ? Math.round(priceSnapshot.reduce((s, p) => s + p.newPrice, 0) / priceSnapshot.length) : 0;

            await db.collection("price_change_logs").add({
                companyId: jobCompanyId || null,
                jobId,
                building: building || "unknown",
                rooms: roomNames,
                dateFrom,
                dateTo,
                totalDays: sortedDateKeys.length,
                dates: mergedDates,
                priceSnapshot,
                oldPrice: avgOldPrice,
                newPrice: avgNewPrice,
                success: finalStatus === "completed",
                errorMessage: failedRoomIds.length > 0 ? `${failedRoomIds.length}개 roomId 실패: ${failedRoomIds.join(", ")}` : null,
                worker: jobWorker || "System (Queue)",
                workerEmail: jobWorkerEmail || null,
                origin: "queue_worker",
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                details: results.map(r => ({ room: roomIdToName[String(r.roomId)] || String(r.roomId), success: r.success, error: r.error || null }))
            });
        } catch (logErr) {
            console.error(`[PriceJob ${jobId}] 로그 저장 실패:`, logErr.message);
        }

        console.log(`[PriceJob ${jobId}] 완료: ${finalStatus}, 성공=${successCount}/${roomIds.length}`);
        return { jobId, status: finalStatus, successCount, failedRoomIds };

    } catch (e) {
        // crash-safe: 오류 시 job을 failed로 마킹
        try {
            await jobRef.update({
                status: "failed",
                completedAt: admin.firestore.FieldValue.serverTimestamp(),
                error: e.message
            });
        } catch (_) {}
        console.error(`[PriceJob ${jobId}] 처리 중 오류:`, e.message);
        throw e;
    } finally {
        await releasePriceSyncLock();
    }
}

// 스케줄: 1분마다 queued job 1개 직렬 처리
exports.scheduledPriceJobWorker = onSchedule({
    schedule: "every 1 minutes",
    timeoutSeconds: 540,
    memory: "512MiB"
}, async () => {
    try {
        // 15분 이상 processing 상태인 stuck job 복구 (crash-safe)
        const stuckThreshold = new Date(Date.now() - 15 * 60 * 1000);
        const stuckSnap = await db.collection("beds24_price_jobs")
            .where("status", "==", "processing")
            .get();
        for (const doc of stuckSnap.docs) {
            const startedAt = doc.data().startedAt?.toDate();
            if (startedAt && startedAt < stuckThreshold) {
                console.log(`[PriceJobWorker] Stuck job 복구: ${doc.id}`);
                await doc.ref.update({ status: "queued", startedAt: null });
            }
        }

        // queued job 1개 처리 (createdAt 기준 oldest-first FIFO)
        const snap = await db.collection("beds24_price_jobs")
            .where("status", "==", "queued")
            .orderBy("createdAt")
            .limit(1)
            .get();
        if (snap.empty) return;
        await processPriceJob(snap.docs[0].id);
    } catch (e) {
        console.error("[PriceJobWorker] 오류:", e.message);
        // throw 하지 않음 — 다음 스케줄 실행 때 재시도
    }
});

// job 상태 확인 endpoint (프론트 polling용)
exports.getPriceJobStatus = onRequest({ cors: true }, async (req, res) => {
    try {
        const { jobId, companyId } = req.body;
        if (!jobId || !companyId) {
            return res.status(400).json({ success: false, error: "jobId, companyId가 필요합니다" });
        }
        const snap = await db.collection("beds24_price_jobs").doc(jobId).get();
        if (!snap.exists) {
            return res.status(404).json({ success: false, error: "Job을 찾을 수 없습니다" });
        }
        const data = snap.data();
        if (data.companyId !== companyId) {
            return res.status(403).json({ success: false, error: "접근 권한이 없습니다" });
        }
        res.json({
            success: true,
            jobId,
            status: data.status,
            progress: data.progress,
            building: data.building,
            failedRoomIds: data.failedRoomIds || [],
            error: data.error || null,
            createdAt: data.createdAt?.toDate()?.toISOString() || null,
            startedAt: data.startedAt?.toDate()?.toISOString() || null,
            completedAt: data.completedAt?.toDate()?.toISOString() || null
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 완료된 price job 정리 (7일 이상 지난 completed/failed 문서 삭제)
exports.scheduledPriceJobCleanup = onSchedule({
    schedule: "every 24 hours",
    timeoutSeconds: 120,
    memory: "256MiB"
}, async () => {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const statuses = ["completed", "failed", "partial_failed"];
    let deleted = 0;
    for (const status of statuses) {
        const snap = await db.collection("beds24_price_jobs")
            .where("status", "==", status)
            .where("createdAt", "<", cutoff)
            .get();
        const batch = db.batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        if (!snap.empty) {
            await batch.commit();
            deleted += snap.size;
        }
    }
    console.log(`[PriceJobCleanup] ${deleted}개 job 문서 삭제 완료`);
});

// ==========================================
// 최소 숙박일수 설정: Beds24 API V2
// ==========================================
exports.setMinStay = onRequest({ cors: true, timeoutSeconds: 300 }, async (req, res) => {
    try {
        const { companyId, building, roomName, roomNames: inputRoomNames, dateFrom, dateTo, minStayValue, dates } = req.body;
        if (!companyId) return res.status(400).json({ success: false, error: "Missing companyId" });

        const roomNameList = inputRoomNames || (roomName ? [roomName] : []);
        if (roomNameList.length === 0) {
            return res.status(400).json({ success: false, error: "roomName 또는 roomNames가 필요합니다" });
        }
        console.log(`[setMinStay] 요청: ${roomNameList.length}개 룸, building=${building}`);

        const INACTIVE_MS_THRESHOLD = 50;
        const buildingRef = db.collection("price_sync").doc(building);

        // 모든 roomName에 대해 roomInfos 수집 + 캐시 일괄 로드
        const allRoomIdSet = new Set();
        const roomInfosByName = {};
        for (const rn of roomNameList) {
            const infos = BUILDING_ROOMS[building]?.filter(r => r.name === rn) || [];
            if (infos.length === 0) {
                return res.status(400).json({ success: false, error: `객실 ${rn}을 찾을 수 없습니다` });
            }
            roomInfosByName[rn] = infos;
            infos.forEach(info => allRoomIdSet.add(String(info.roomId)));
        }

        const roomCacheByRoomId = {};
        const cacheLoadPromises = [...allRoomIdSet].map(async (rid) => {
            try {
                const snap = await buildingRef.collection("rooms").doc(rid).get();
                if (snap.exists) roomCacheByRoomId[rid] = snap.data();
            } catch (err) {
                console.warn(`[setMinStay] 캐시 로드 실패 roomId=${rid}:`, err.message);
            }
        });
        await Promise.all(cacheLoadPromises);

        // 모든 roomName × 날짜를 roomId 기준으로 그룹핑
        const groupByRoomId = {};
        const addToGroup = (rid, v2Date, minStayVal, dateKey, mStr) => {
            if (!groupByRoomId[rid]) groupByRoomId[rid] = { calendar: [], datesToUpdate: {} };
            groupByRoomId[rid].calendar.push({ from: v2Date, to: v2Date, minStay: parseInt(minStayVal) });
            groupByRoomId[rid].datesToUpdate[dateKey] = { m: mStr };
        };

        for (const rn of roomNameList) {
            const roomInfos = roomInfosByName[rn];
            const getActiveRoomId = (dateKey) => {
                if (roomInfos.length === 1) return String(roomInfos[0].roomId);
                for (const info of roomInfos) {
                    const rid = String(info.roomId);
                    const m = parseInt(roomCacheByRoomId[rid]?.dates?.[dateKey]?.m, 10);
                    if (Number.isFinite(m) && m < INACTIVE_MS_THRESHOLD) return rid;
                }
                return null;
            };

            if (dates && typeof dates === "object") {
                for (const [dateKey, values] of Object.entries(dates)) {
                    const v2Date = `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`;
                    const rid = getActiveRoomId(dateKey);
                    if (!rid) { console.warn(`[setMinStay] ${rn} 날짜 ${dateKey} active roomId 없음, 스킵`); continue; }
                    addToGroup(rid, v2Date, parseInt(values.m) || 1, dateKey, String(values.m));
                }
            } else if (dateFrom && dateTo && minStayValue !== undefined) {
                const start = dayjs(dateFrom);
                const end = dayjs(dateTo);
                const diff = end.diff(start, "day");
                for (let i = 0; i <= diff; i++) {
                    const d = start.add(i, "day");
                    const dateKey = d.format("YYYYMMDD");
                    const v2Date = d.format("YYYY-MM-DD");
                    const rid = getActiveRoomId(dateKey);
                    if (!rid) { console.warn(`[setMinStay] ${rn} 날짜 ${dateKey} active roomId 없음, 스킵`); continue; }
                    addToGroup(rid, v2Date, minStayValue, dateKey, String(minStayValue));
                }
            } else {
                return res.status(400).json({ success: false, error: "dates 또는 dateFrom/dateTo/minStayValue가 필요합니다" });
            }
        }

        if (Object.keys(groupByRoomId).length === 0) {
            return res.status(400).json({
                success: false,
                error: "해당 날짜에 활성화된 roomId를 찾을 수 없습니다. (minStay<50인 roomId 없음)"
            });
        }

        // ★ 배치 POST: 1-step(minStay≠1)과 2-step(minStay=1)을 분리하여 일괄 전송
        const allTargetRoomIds = [];
        for (const [roomId, group] of Object.entries(groupByRoomId)) {
            group.calendar = consolidateCalendarRanges(group.calendar);
            allTargetRoomIds.push(roomId);
        }
        const oneStepRoomIds = allTargetRoomIds;
        const twoStepRoomIds = [];

        // 배치 응답에서 개별 roomId 에러 감지
        const checkBatchResponse = (apiResp, roomIdList) => {
            const itemResults = [];
            const respItems = Array.isArray(apiResp.data) ? apiResp.data
                : (Array.isArray(apiResp.data?.data) ? apiResp.data.data : null);
            if (respItems && respItems.length === roomIdList.length) {
                for (let ri = 0; ri < roomIdList.length; ri++) {
                    const item = respItems[ri];
                    const hasErrors = item?.errors && item.errors.length > 0;
                    const ok = item?.success !== false && !hasErrors;
                    itemResults.push({ roomId: roomIdList[ri], success: ok, error: ok ? null : (item?.errors?.map(e => e.message).join("; ") || "item-level failure") });
                }
            } else {
                roomIdList.forEach(rid => itemResults.push({ roomId: rid, success: true, error: null }));
            }
            return itemResults;
        };

        const results = [];
        if (allTargetRoomIds.length > 0) {
            const payload = allTargetRoomIds.map(rid => ({
                roomId: parseInt(rid),
                calendar: groupByRoomId[rid].calendar
            }));
            console.log(`[setMinStay] 1-step 배치 POST: ${oneStepRoomIds.length}개 roomId`);
            const resp = await beds24PostV2WithRetry("/inventory/rooms/calendar", payload);
            results.push(...checkBatchResponse(resp, allTargetRoomIds));
        }

            console.log(`[setMinStay] 2-step 1단계(중간값 3): ${twoStepRoomIds.length}개 roomId`);
            console.log(`[setMinStay] 2-step 2단계(목표값 1): ${twoStepRoomIds.length}개 roomId`);

        const failedRoomIdSet = new Set(results.filter(r => !r.success).map(r => r.roomId));
        if (failedRoomIdSet.size > 0) {
            console.warn(`[setMinStay] ${failedRoomIdSet.size}개 roomId 개별 실패: ${[...failedRoomIdSet].join(", ")}`);
        }

        // 캐시 패치 (병렬, 성공한 roomId만)
        const cachePatchPromises = Object.entries(groupByRoomId).filter(([roomId]) => !failedRoomIdSet.has(roomId)).map(async ([roomId, group]) => {
            try {
                const sRid = String(roomId);
                const roomDocRef = buildingRef.collection("rooms").doc(sRid);
                const roomSnap = await roomDocRef.get();
                let roomData = roomSnap.exists ? roomSnap.data() : { roomId: sRid, dates: {} };
                if (!roomData.dates) roomData.dates = {};
                roomData.lastManualUpdate = admin.firestore.FieldValue.serverTimestamp();
                Object.entries(group.datesToUpdate).forEach(([dKey, values]) => {
                    if (!roomData.dates[dKey]) roomData.dates[dKey] = {};
                    roomData.dates[dKey].m = String(values.m);
                });
                await roomDocRef.set(roomData, { merge: true });
            } catch (err) {
                console.error(`[setMinStay] 캐시 패치 실패 roomId=${roomId}:`, err.message);
            }
        });
        await Promise.all(cachePatchPromises);
        console.log(`[setMinStay] 완료: ${results.length}개 roomId, API calls=${oneStepRoomIds.length > 0 ? 1 : 0}+${twoStepRoomIds.length > 0 ? 2 : 0}`);

        res.json({ success: true, message: `MinStay 업데이트 완료`, results });

    } catch (e) {
        console.error("setMinStay Error:", e.response?.data || e.message);
        res.status(500).json({ success: false, error: e.response?.data?.error || e.message });
    }
});

async function tryAcquireWebhookPriceSyncLock() {
    const result = await acquirePriceSyncLock("priceWebhook");
    return result.acquired;
}
async function releaseWebhookPriceSyncLock() {
    await releasePriceSyncLock();
}

async function syncSingleRoomPriceCache(building, roomId, roomName, { reason = "webhook", companyId } = {}) {
    const tokyoNow = dayjs().utcOffset(9);
    const fromDate = tokyoNow.format("YYYY-MM-DD");
    const toDate = tokyoNow.add(12, "month").format("YYYY-MM-DD");

    const response = await beds24GetV2WithRetry("/inventory/rooms/calendar", {
        roomId: parseInt(roomId),
        startDate: fromDate,
        endDate: toDate,
        includePrices: true,
        includeLinkedPrices: true,
        includeMinStay: true,
        includeMaxStay: true,
        includeNumAvail: true,
        includeOverride: true
    });

    const roomData = response.data?.data?.[0];
    if (!roomData || !Array.isArray(roomData.calendar)) {
        return { success: false, skipped: true };
    }

    const datesObj = {};
    roomData.calendar.forEach(entry => {
        const entryFromDate = dayjs(entry.from);
        const entryToDate = dayjs(entry.to);
        for (let d = entryFromDate; d.isBefore(entryToDate) || d.isSame(entryToDate, 'day'); d = d.add(1, 'day')) {
            const dateKey = d.format('YYYYMMDD');
            datesObj[dateKey] = {
                p1: String(entry.price1 || ""),
                p2: String(entry.price2 || ""),
                p3: String(entry.price3 || ""),
                m: String(entry.minStay || ""),
                mx: String(entry.maxStay || ""),
                na: entry.numAvail !== undefined && entry.numAvail !== null ? String(entry.numAvail) : "",
                ov: entry.override ? String(entry.override) : ""
            };
        }
    });

    const roomDocRef = db.collection("price_sync").doc(building).collection("rooms").doc(String(roomId));
    await roomDocRef.set({
        roomName,
        roomId: String(roomId),
        dates: datesObj,
        outputImpact: buildPriceOutputImpact({ building, roomName, roomId: String(roomId), fromDate, toDate }),
        lastSyncRoom: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return { success: true, newDates: datesObj };
}

// ==========================================
// 가격/재고 변경 웹훅: Beds24에서 발생한 변경 사항 감지
// ==========================================
exports.priceWebhook = onRequest({ cors: true }, async (req, res) => {
    try {
        // ★ Webhook 버전 감지 로직 추가
        const method = req.method;
        const contentType = req.headers['content-type'] || '';
        const userAgent = req.headers['user-agent'] || '';

        console.log(`=== Webhook Request Info ===`);
        console.log(`Method: ${method}`);
        console.log(`Content-Type: ${contentType}`);
        console.log(`User-Agent: ${userAgent}`);
        console.log(`Headers:`, Object.keys(req.headers));

        let webhookVersion = 'Unknown';
        let dataSource = '';

        if (method === 'POST' && contentType.includes('application/json')) {
            webhookVersion = 'V2';
            dataSource = 'req.body (JSON)';
            console.log(`✅ Webhook Version: V2 (POST + JSON)`);
        } else if (method === 'GET') {
            webhookVersion = 'V1';
            dataSource = 'req.query (URL params)';
            console.log(`✅ Webhook Version: V1 (GET + URL params)`);
        } else {
            console.log(`⚠️  Unknown Webhook Format`);
        }

        console.log(`Data Source: ${dataSource}`);
        console.log(`==========================`);

        const data = method === "GET" ? req.query : req.body;
        console.log("Beds24 Webhook Received:", JSON.stringify(data));

        const roomId = data.roomId || data.roomid;
        const action = data.action;

        if (roomId && (action === "SYNC_ROOM" || action === "PRICE_CHANGE" || !action)) {
            let building = "Unknown";
            let roomName = "Unknown";

            for (const [bName, rooms] of Object.entries(BUILDING_ROOMS)) {
                const found = rooms.find(r => String(r.roomId) === String(roomId));
                if (found) {
                    building = bName;
                    roomName = found.name;
                    break;
                }
            }

            const companyId = (PROPERTIES.find((prop) => prop.name === building)?.companyId) || DEFAULT_COMPANY_ID;

            // Read old cached prices before sync to detect price diffs
            let oldDates = null;
            try {
                const oldSnap = await db.collection("price_sync").doc(building).collection("rooms").doc(String(roomId)).get();
                if (oldSnap.exists) {
                    oldDates = oldSnap.data()?.dates || null;
                }
            } catch (_) { /* cache miss is fine */ }

            // price_sync 캐시 무효화 (기본 — 즉시 sync 성공 시 제거됨)
            const roomIdStr = String(roomId);
            const priceSyncDoc = db.collection("price_sync").doc(building);
            const snap = await priceSyncDoc.get();
            const priceSyncState = snap.data() || {};
            const existingIds = new Set((priceSyncState.invalidatedRoomIds || []).map(String));
            const invalidatedAt = priceSyncState.invalidatedAt?.toDate?.() || null;
            const recentlyDuplicatedWhileInvalidated = existingIds.has(roomIdStr) &&
                invalidatedAt &&
                (Date.now() - invalidatedAt.getTime()) < PRICE_WEBHOOK_INVALIDATION_DEBOUNCE_MS;

            if (recentlyDuplicatedWhileInvalidated) {
                console.log(`[priceWebhook] duplicate webhook coalesced for ${building}/${roomName} (${roomIdStr})`);
                await recordPriceSyncAudit({
                    syncType: "webhook",
                    syncVariant: "skipped",
                    syncSource: "beds24_price_webhook",
                    companyId,
                    fetchedCount: 0,
                    upsertedCount: 0,
                    note: `coalesced duplicate webhook: ${building} ${roomName} (${roomIdStr})`,
                    metadata: {
                        building,
                        roomName,
                        roomId: roomIdStr,
                        action: action || "UNKNOWN",
                        debounceMs: PRICE_WEBHOOK_INVALIDATION_DEBOUNCE_MS
                    }
                });
                return res.status(200).send("OK");
            }

            existingIds.add(roomIdStr);
            await priceSyncDoc.set({
                invalidatedRoomIds: Array.from(existingIds),
                invalidatedAt: admin.firestore.FieldValue.serverTimestamp(),
                invalidatedBy: "priceWebhook (external change)",
                pendingInvalidationCount: existingIds.size,
                outputImpact: buildPriceOutputImpact({
                    building,
                    roomName,
                    roomId: roomIdStr
                })
            }, { merge: true });
            console.log(`[Cache Invalidated] ${building} price_sync marked for refresh due to external webhook.`);

            const lockAcquired = await tryAcquireWebhookPriceSyncLock();
            let syncResult = null;
            let syncError = null;
            let skipReason = null;

            if (lockAcquired) {
                try {
                    syncResult = await syncSingleRoomPriceCache(building, roomIdStr, roomName, { reason: "webhook", companyId });
                } catch (syncErr) {
                    syncError = syncErr;
                    console.error(`[priceWebhook] 즉시 동기화 실패, invalidation fallback: ${syncErr.message}`);
                }
            } else {
                skipReason = "sync lock 사용 중 (scheduled/webhook 실행 중)";
                console.log(`[priceWebhook] 즉시 sync 불가 (${skipReason}) → invalidation fallback`);
            }

            // Build price diff from old cache vs new sync data
            let priceDiffs = [];
            if (syncResult?.success && syncResult.newDates && oldDates) {
                const tokyoToday = dayjs().utcOffset(9).format("YYYYMMDD");
                const diffLimit = dayjs().utcOffset(9).add(12, "month").format("YYYYMMDD");
                for (const [dk, newVal] of Object.entries(syncResult.newDates)) {
                    if (dk < tokyoToday || dk > diffLimit) continue;
                    const oldVal = oldDates[dk];
                    const oldP1 = parseFloat(oldVal?.p1) || 0;
                    const newP1 = parseFloat(newVal?.p1) || 0;
                    if (oldP1 !== newP1 && (oldP1 > 0 || newP1 > 0)) {
                        priceDiffs.push({ date: `${dk.slice(0,4)}-${dk.slice(4,6)}-${dk.slice(6,8)}`, oldPrice: oldP1, newPrice: newP1 });
                    }
                }
                priceDiffs.sort((a, b) => a.date.localeCompare(b.date));
            }

            // Write price_change_logs with companyId and price diffs
            try {
                const logData = {
                    companyId,
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    building,
                    rooms: [roomName],
                    roomId: roomIdStr,
                    success: true,
                    worker: "Beds24 System",
                    origin: "Beds24 (외부 수정)",
                    notes: `Beds24에서 객실(${roomName})의 가격 또는 재고 변경이 감지되었습니다.`
                };
                if (priceDiffs.length > 0) {
                    logData.priceSnapshot = priceDiffs;
                    logData.oldPrice = Math.round(priceDiffs.reduce((s, d) => s + d.oldPrice, 0) / priceDiffs.length);
                    logData.newPrice = Math.round(priceDiffs.reduce((s, d) => s + d.newPrice, 0) / priceDiffs.length);
                    logData.dateFrom = priceDiffs[0].date;
                    logData.dateTo = priceDiffs[priceDiffs.length - 1].date;
                    logData.totalDays = priceDiffs.length;
                }
                await db.collection("price_change_logs").add(logData);
            } catch (logErr) {
                console.error("[priceWebhook] price_change_logs write failed:", logErr.message);
            }

            try {
                if (syncResult?.success) {
                    await db.collection("price_sync").doc(building).update({
                        invalidatedRoomIds: admin.firestore.FieldValue.arrayRemove(roomIdStr),
                        lastWebhookAt: admin.firestore.FieldValue.serverTimestamp(),
                        lastSyncAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                    await recordPriceSyncAudit({
                        syncType: "webhook",
                        syncVariant: "immediate",
                        syncSource: "beds24_price_webhook",
                        companyId,
                        fetchedCount: 1,
                        upsertedCount: 1,
                        note: `immediate sync: ${building} ${roomName} (${roomId}), priceDiffs=${priceDiffs.length}`,
                        metadata: {
                            building,
                            roomName,
                            roomId: roomIdStr,
                            action: action || "UNKNOWN",
                            priceDiffCount: priceDiffs.length
                        }
                    });
                } else {
                    const fallbackVariant = skipReason ? "skipped" : (syncResult?.skipped ? "skipped" : (syncError ? "failed" : "queued"));
                    await db.collection("price_sync").doc(building).update({
                        invalidatedRoomIds: admin.firestore.FieldValue.arrayUnion(roomIdStr),
                        lastWebhookAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                    await recordPriceSyncAudit({
                        syncType: "webhook",
                        syncVariant: fallbackVariant,
                        syncSource: "beds24_price_webhook",
                        companyId,
                        fetchedCount: 0,
                        upsertedCount: 0,
                        note: `${fallbackVariant}: ${building} ${roomName} (${roomId})${skipReason ? ` - ${skipReason}` : ""}`,
                        metadata: {
                            building,
                            roomName,
                            roomId: roomIdStr,
                            action: action || "UNKNOWN"
                        }
                    });
                }
            } finally {
                if (lockAcquired) await releaseWebhookPriceSyncLock();
            }
        }
        res.status(200).send("OK");
    } catch (e) {
        console.error("priceWebhook Error:", e.message);
        await recordPriceSyncAudit({
            syncType: "webhook",
            status: "error",
            syncSource: "beds24_price_webhook",
            companyId: DEFAULT_COMPANY_ID,
            errorMessage: e.message
        });
        res.status(500).send(e.message);
    }
});

// ==========================================
// 예약 변경 웹훅: Beds24 → 우리 (생성/수정/취소 시 1건만 반영)
// ==========================================
// 설정: Beds24 > SETTINGS > PROPERTIES > ACCESS > Booking Webhook URL 에 이 함수 URL 입력
// 동작: 변경된 예약만 수신 → Firestore 1건 upsert. 15분 풀 동기화보다 API 호출·처리 비용 대폭 절감
exports.beds24BookingWebhook = onRequest({ cors: true, timeoutSeconds: 60 }, async (req, res) => {
    try {
        if (req.method !== "POST" || !req.body || typeof req.body !== "object") {
            res.status(400).send("POST JSON required");
            return;
        }
        const payload = req.body;
        const booking = payload.booking;
        if (!booking || !booking.id) {
            console.log("[Booking Webhook] No booking.id in payload, skipping.");
            res.status(200).send("OK");
            return;
        }

        const propertyId = booking.propertyId;
        const prop = PROPERTIES.find(p => p.v2Id === propertyId);
        if (!prop || prop.disabled) {
            console.log(`[Booking Webhook] Unknown or disabled propertyId=${propertyId}, skipping.`);
            res.status(200).send("OK");
            return;
        }

        const companyId = prop.companyId || DEFAULT_COMPANY_ID;
        const bookingRef = db.collection("reservations").doc(String(booking.id));
        const existingSnap = await bookingRef.get();
        const existingData = existingSnap.exists ? existingSnap.data() : null;
        const eventAt = payload.timeStamp || booking.modifiedTime || booking.bookingTime || null;
        const normalizedBase = normalize(booking, prop.id, prop.name, companyId);
        const mutationSummary = buildReservationMutationSummary(existingData, normalizedBase);
        const normalized = applyReservationActorMetadata({
            ...normalizedBase,
            lastEventType: mutationSummary.eventType,
            lastChangedFields: mutationSummary.changedFields.slice(0, 20),
            lastChangeSummary: mutationSummary.changes.slice(0, 20),
            lastEventAt: eventAt || new Date().toISOString()
        }, existingData, mutationSummary.eventType);
        const upsertResult = await upsertReservations([normalized], {
            companyId,
            syncSource: "beds24_booking_webhook",
            syncMode: "webhook",
            sourceEventTime: eventAt
        });
        await recordReservationSyncAudit({
            syncType: "webhook",
            syncVariant: "webhook",
            syncSource: "beds24_booking_webhook",
            companyId,
            rangeStart: normalized.arrival || null,
            rangeEnd: normalized.departure || null,
            fetchedCount: 1,
            upsertedCount: upsertResult.upsertedCount,
            cancelledCount: mutationSummary.eventType === "cancelled" ? 1 : 0,
            invalidCriticalCount: upsertResult.invalidCriticalCount,
            invalidReportCount: upsertResult.invalidReportCount,
            sampleIds: [String(booking.id)],
            note: `${mutationSummary.eventType}${normalized.lastActorId ? ` by ${normalized.lastActorId}` : ""}`,
            metadata: {
                bookingId: String(booking.id),
                building: prop.name,
                eventType: mutationSummary.eventType,
                actorId: normalized.lastActorId || "",
                actorSource: normalized.lastActorSource || "",
                changedFields: mutationSummary.changedFields.slice(0, 20),
                changes: mutationSummary.changes.slice(0, 20)
            }
        });

        try {
            await scheduleOutputUpdates([buildReservationOutputImpact(normalized)]);
        } catch (e) {
            console.warn("[Booking Webhook] Output update failed:", e.message);
        }

        // 당일 예약 알람: 오늘 예약 + 오늘 체크인(당일예약). 신규 확정, 금액>0, 다이쿄초 제외, 플랫폼 무관
        const todayKst = dayjs().tz("Asia/Tokyo").format("YYYY-MM-DD");
        const amount = getBookingAmount(normalized);
        const isCreated = mutationSummary.eventType === "created";
        const isConfirmed = normalized.status === "confirmed";
        const bookDateOnly = normalized.bookDate ? String(normalized.bookDate).slice(0, 10) : "";
        const arrivalDateOnly = normalized.arrival ? String(normalized.arrival).slice(0, 10) : "";
        const bookDateToday = bookDateOnly === todayKst;
        const arrivalToday = arrivalDateOnly === todayKst;
        const amountOk = amount > 0;
        const notDaikyo = normalized.building !== "다이쿄초";
        const isSameDayCreated = isCreated && isConfirmed && bookDateToday && arrivalToday && amountOk && notDaikyo;

        console.log("[SameDayAlert] check", {
            bookingId: booking.id,
            eventType: mutationSummary.eventType,
            status: normalized.status,
            bookDate: bookDateOnly || normalized.bookDate,
            arrival: arrivalDateOnly || normalized.arrival,
            todayKst,
            amount,
            building: normalized.building,
            fire: isSameDayCreated,
            reason: !isSameDayCreated ? {
                created: isCreated,
                confirmed: isConfirmed,
                bookDateToday,
                arrivalToday,
                amountOk,
                notDaikyo
            } : null
        });

        if (isSameDayCreated) {
            try {
                await sendSameDayBookingAlert(normalized);
                console.log(`[Booking Webhook] 당일 예약 알람 전송 완료: ${booking.id} (${normalized.building} ${normalized.room})`);
            } catch (e) {
                console.warn("[Booking Webhook] 당일 예약 알람 전송 실패:", e.message);
            }
        }

        // 당일 취소 알람: 취소 건 중 입실일이 오늘 기준 앞뒤 6개월 이내인 경우 당일취소알람 채널로 전송
        if (mutationSummary.eventType === "cancelled") {
            try {
                await sendCancelAlert(normalized);
                console.log(`[Booking Webhook] 당일 취소 알람 전송 완료: ${booking.id} (${normalized.building} ${normalized.room})`);
            } catch (e) {
                console.warn("[Booking Webhook] 당일 취소 알람 전송 실패:", e.message);
            }
        }

        console.log(`[Booking Webhook] Upserted booking ${booking.id} (${prop.name}, status=${normalized.status})`);
        res.status(200).send("OK");
    } catch (e) {
        console.error("beds24BookingWebhook Error:", e.message);
        await recordReservationSyncAudit({
            syncType: "webhook",
            status: "error",
            syncSource: "beds24_booking_webhook",
            errorMessage: e.message
        });
        await sendSyncAlert("beds24BookingWebhook failed", [e.message]);
        res.status(500).send(e.message);
    }
});

// ==========================================
// 수기 예약 생성 (우리 시스템 -> Beds24 -> Firebase)
// ==========================================
// 헬퍼: building -> propertyId (v2Id)
function getPropertyIdByBuilding(building) {
    const prop = PROPERTIES.find(p => p.name === building);
    return prop ? prop.v2Id : null;
}

// 헬퍼: roomId -> room name
function getRoomNameByRoomId(roomId) {
    const rid = String(roomId);
    for (const [bName, rooms] of Object.entries(BUILDING_ROOMS)) {
        const found = rooms.find(r => String(r.roomId) === rid);
        if (found) return found.name;
    }
    return `Room(${roomId})`;
}

// ★ 예약 생성 - V2 마이그레이션 완료 (roomId 직접 수신)
exports.createBooking = onRequest({ cors: true }, async (req, res) => {
    try {
        // roomId를 직접 받음 (프론트엔드에서 전송)
        const { companyId, building, roomId, room, arrival, departure, guestName, numAdult, numChild, guestPhone, guestEmail, source, price, comments, staffId, operatorId, isBlock: requestedBlock } = req.body;
        if (!companyId) return res.status(400).json({ success: false, error: "Missing companyId" });
        const actorId = firstNonEmptyValue(normalizePossibleActorId(staffId), normalizePossibleActorId(operatorId), normalizePossibleActorId(source));

        // roomId 필수
        if (!roomId) throw new Error("Missing roomId");

        // building -> propertyId
        const propertyId = getPropertyIdByBuilding(building);
        if (!propertyId) throw new Error(`Invalid building: ${building}`);

        // room 이름 (전달받거나 roomId에서 추출)
        const roomName = room || getRoomNameByRoomId(roomId);

        // ★ 블락 여부: 우리 시스템에서 블락으로 생성한 경우 Beds24에도 status=black으로 생성
        const explicitIsBlock = requestedBlock === true || requestedBlock === "true";
        const isBlock = explicitIsBlock || !!(
            guestName &&
            (String(guestName).toLowerCase().includes("room block") || String(guestName).toLowerCase().includes("blackout")) ||
            comments === "System Block"
        );

        // V2 API payload (배열 형식)
        const payload = [{
            propertyId: parseInt(propertyId),
            roomId: parseInt(roomId),
            arrival: arrival,
            departure: departure,
            firstName: guestName ? guestName.split(" ")[0] : "Guest",
            lastName: guestName ? (guestName.split(" ").slice(1).join(" ") || ".") : ".",
            numAdult: parseInt(numAdult) || 1,
            numChild: parseInt(numChild) || 0,
            email: guestEmail || "",
            phone: guestPhone || "",
            mobile: guestPhone || "",
            comments: comments || "",
            apiSource: source || "Direct",
            price: parseFloat(price) || 0,
            ...(isBlock ? { status: "black" } : {})
        }];

        console.log(`[createBooking] 예약 생성: ${building} ${roomName} (roomId: ${roomId}, propertyId: ${propertyId})${isBlock ? " [BLOCK]" : ""}`);

        const response = await beds24PostV2WithRetry("/bookings", payload);

        // V2 응답은 배열 형식
        const result = Array.isArray(response.data) ? response.data[0] : response.data;

        if (result.errors && result.errors.length > 0) {
            throw new Error(result.errors.map(e => e.message).join(", "));
        }

        const newBookingId = result.new?.id || result.id; // V2 응답 구조

        // Firestore에도 저장 (블락이면 status=blackout, 수기 예약이면 confirmed)
        const newBooking = {
            id: String(newBookingId),
            bookId: String(newBookingId),
            companyId: companyId || null,
            building,
            room: roomName,
            roomId: String(roomId),
            guestName: guestName || "Guest",
            guestEmail: guestEmail || "",
            guestPhone: guestPhone || "",
            comments: comments || "",
            arrival: arrival,
            departure: departure,
            status: isBlock ? "blackout" : "confirmed",
            price: parseFloat(price) || 0,
            source: source || "Direct",
            referer: actorId || "",
            apiSource: source || "Direct",
            createdByStaffId: actorId || "",
            createdBySource: actorId ? "manual_request" : "",
            lastModifiedByStaffId: actorId || "",
            lastModifiedBySource: actorId ? "manual_request" : "",
            lastActorId: actorId || "",
            lastActorSource: actorId ? "manual_request" : "",
            updatedAt: new Date()
        };
        const newBookingEnriched = {
            ...newBooking,
            bookDate: newBooking.bookDate || dayjs().tz("Asia/Tokyo").format("YYYY-MM-DD"),
            stayMonth: newBooking.arrival ? String(newBooking.arrival).slice(0, 7) : ""
        };
        await db.collection("reservations").doc(String(newBookingId)).set(
            enrichReservationDocument(newBookingEnriched, {
                companyId: companyId || DEFAULT_COMPANY_ID,
                syncSource: "manual_create_booking",
                syncMode: "manual"
            }),
            { merge: true }
        );
        try {
            await scheduleOutputUpdates([buildReservationOutputImpact(newBookingEnriched)]);
        } catch (e) {
            console.warn("[createBooking] Output update failed:", e.message);
        }
        console.log(`[createBooking] 예약 생성 성공: bookingId=${newBookingId}`);
        res.json({ success: true, bookingId: newBookingId });
    } catch (e) {
        console.error("createBooking Error:", e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==========================================
// 예약 수정 (우리 시스템 -> Beds24 -> Firebase)
// ==========================================
// ★ 예약 수정 - V2 마이그레이션 완료
exports.updateBooking = onRequest({ cors: true }, async (req, res) => {
    try {
        const { bookId, companyId, ...updates } = req.body;
        if (!companyId) return res.status(400).json({ success: false, error: "Missing companyId" });
        if (!bookId) return res.status(400).json({ error: "Missing bookId" });

        const payload = { id: parseInt(bookId) };

        // V1 필드 -> V2 필드 매핑 및 변환
        if (updates.arrival) payload.arrival = updates.arrival;
        if (updates.departure) payload.departure = updates.departure; // V2는 그대로 사용
        if (updates.guestName) {
            const parts = updates.guestName.split(" ");
            payload.firstName = parts[0];
            payload.lastName = parts.slice(1).join(" ") || ".";
        }
        if (updates.numAdult) payload.numAdult = parseInt(updates.numAdult);
        if (updates.numChild) payload.numChild = parseInt(updates.numChild);
        if (updates.guestPhone) {
            payload.phone = updates.guestPhone;
            payload.mobile = updates.guestPhone;
        }
        if (updates.guestEmail) payload.email = updates.guestEmail;
        if (updates.price) payload.price = parseFloat(updates.price);
        if (updates.comments) payload.comments = updates.comments;
        // status 필드는 V2에서 유효하지 않으므로 제거
        // if (updates.status) payload.status = updates.status === "cancelled" ? 0 : 1;

        const response = await beds24PostV2WithRetry("/bookings", [payload]); // 배열 형식

        const result = Array.isArray(response.data) ? response.data[0] : response.data;

        if (result.errors && result.errors.length > 0) {
            throw new Error(result.errors.map(e => e.message).join(", "));
        }

        // Firestore 업데이트
        const existingSnap = await db.collection("reservations").doc(String(bookId)).get();
        const existingData = existingSnap.exists ? existingSnap.data() : {};
        const actorId = firstNonEmptyValue(
            normalizePossibleActorId(req.body?.staffId),
            normalizePossibleActorId(req.body?.operatorId),
            normalizePossibleActorId(updates?.source),
            normalizePossibleActorId(existingData?.lastActorId)
        );
        await db.collection("reservations").doc(String(bookId)).set(
            enrichReservationDocument({
                ...existingData,
                ...updates,
                id: String(bookId),
                bookId: String(bookId),
                lastEventType: "manual_update",
                lastChangedFields: Object.keys(updates || {}).slice(0, 20),
                lastEventAt: new Date().toISOString(),
                lastActorId: actorId || existingData.lastActorId || "",
                lastActorSource: actorId ? "manual_request" : (existingData.lastActorSource || ""),
                lastModifiedByStaffId: actorId || existingData.lastModifiedByStaffId || "",
                lastModifiedBySource: actorId ? "manual_request" : (existingData.lastModifiedBySource || "")
            }, {
                companyId: getEffectiveCompanyId(existingData),
                syncSource: "manual_update_booking",
                syncMode: "manual"
            }),
            { merge: true }
        );
        try {
            const merged = { ...existingData, ...updates, id: String(bookId), bookId: String(bookId) };
            await scheduleOutputUpdates([buildReservationOutputImpact(merged)]);
        } catch (e) {
            console.warn("[updateBooking] Output update failed:", e.message);
        }
        res.json({ success: true });

    } catch (e) {
        console.error("updateBooking Error:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==========================================
// 예약 취소/삭제 (Beds24 -> Firebase)
// ==========================================
// ★ 예약 취소 - V2 마이그레이션 완료
exports.cancelBooking = onRequest({ cors: true }, async (req, res) => {
    try {
        const { bookId, companyId, reason, cancelledBy, staffId, operatorId } = req.body;
        if (!companyId) return res.status(400).json({ success: false, error: "Missing companyId" });
        if (!bookId) return res.status(400).json({ error: "Missing bookId" });

        // V2 취소: status: "cancelled" (문자열)
        const payload = [{
            id: parseInt(bookId),
            status: "cancelled",
            comments: reason ? `Cancelled: ${reason}` : "Cancelled by User"
        }];

        const response = await beds24PostV2WithRetry("/bookings", payload);

        const result = Array.isArray(response.data) ? response.data[0] : response.data;

        if (result.errors && result.errors.length > 0) {
            throw new Error(result.errors.map(e => e.message).join(", "));
        }

        // Firestore 업데이트 (문서 없으면 생성)
        const existingSnap = await db.collection("reservations").doc(String(bookId)).get();
        const existingData = existingSnap.exists ? existingSnap.data() : {};
        const actorId = firstNonEmptyValue(
            normalizePossibleActorId(cancelledBy),
            normalizePossibleActorId(staffId),
            normalizePossibleActorId(operatorId),
            normalizePossibleActorId(existingData?.lastActorId)
        );
        await db.collection("reservations").doc(String(bookId)).set(
            enrichReservationDocument({
                ...existingData,
                id: String(bookId),
                bookId: String(bookId),
                status: "cancelled",
                cancelReason: reason || "",
                cancelTime: new Date().toISOString(),
                lastEventType: "manual_cancel",
                lastChangedFields: ["status", "cancelReason", "cancelTime"],
                lastEventAt: new Date().toISOString(),
                lastActorId: actorId || existingData.lastActorId || "",
                lastActorSource: actorId ? "manual_request" : (existingData.lastActorSource || ""),
                lastModifiedByStaffId: actorId || existingData.lastModifiedByStaffId || "",
                lastModifiedBySource: actorId ? "manual_request" : (existingData.lastModifiedBySource || ""),
                cancelledByStaffId: actorId || existingData.cancelledByStaffId || "",
                cancelledBySource: actorId ? "manual_request" : (existingData.cancelledBySource || "")
            }, {
                companyId: getEffectiveCompanyId(existingData),
                syncSource: "manual_cancel_booking",
                syncMode: "manual"
            }),
            { merge: true }
        );
        try {
            const cancelledDoc = { ...existingData, id: String(bookId), bookId: String(bookId), status: "cancelled", cancelTime: new Date().toISOString() };
            await scheduleOutputUpdates([buildReservationOutputImpact(cancelledDoc)]);
        } catch (e) {
            console.warn("[cancelBooking] Output update failed:", e.message);
        }
        console.log(`[cancelBooking] 예약 취소 완료: bookId=${bookId}`);
        res.json({ success: true });
    } catch (e) {
        console.error("cancelBooking Error:", e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});


// ==========================================
// 매출 일지 (Daily Sales Log) 기능
// ==========================================

// 특정 날짜의 매출 스냅샷 생성 (미래 월별 매출 포함)




// 수동 저장 API
// 날짜 범위 일괄 재생성 (startDate ~ endDate)
exports.bulkRegenerateSalesLog = onRequest({ cors: true, timeoutSeconds: 540, memory: "1GiB" }, async (req, res) => {
    try {
        const { startDate, endDate } = req.body;
        if (!startDate || !endDate) {
            return res.status(400).json({ success: false, error: "startDate, endDate 필요" });
        }

        const results = [];
        let current = dayjs(startDate).tz("Asia/Tokyo");
        const end = dayjs(endDate).tz("Asia/Tokyo");

        while (current.isBefore(end) || current.isSame(end, 'day')) {
            const dateStr = current.format("YYYY-MM-DD");
            try {
                await createDailySalesLog(dateStr, { overwrite: true });
                results.push({ date: dateStr, status: "ok" });
                console.log(`[BulkRegen] ${dateStr} 완료`);
            } catch (e) {
                results.push({ date: dateStr, status: "error", error: e.message });
                console.error(`[BulkRegen] ${dateStr} 실패:`, e.message);
            }
            current = current.add(1, 'day');
            // Rate limit 방지
            await new Promise(r => setTimeout(r, 200));
        }

        res.json({ success: true, total: results.length, results });
    } catch (e) {
        console.error("bulkRegenerateSalesLog Error:", e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

exports.saveSalesLogManual = onRequest({ cors: true, timeoutSeconds: 120, memory: "1GiB" }, async (req, res) => {
    try {
        const { date } = req.body;

        // 날짜가 없으면 오늘 날짜 (도쿄 시간)
        const targetDate = date || dayjs().utcOffset(9).format('YYYY-MM-DD');

        console.log(`📝 수동 매출 저장 요청: ${targetDate}`);
        const result = await createDailySalesLog(targetDate, { overwrite: true });

        // 수동 저장인 경우 플래그 업데이트 (set+merge로 문서 없어도 안전)
        await db.collection("dailySalesLog").doc(targetDate).set({
            isAutoGenerated: false,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        res.json({
            success: true,
            message: `${targetDate} 매출 일지 저장 완료`,
            data: result
        });
    } catch (e) {
        console.error("saveSalesLogManual Error:", e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 메모 저장 API
exports.saveSalesLogMemo = onRequest({ cors: true }, async (req, res) => {
    try {
        const { date, memo } = req.body;

        if (!date) {
            return res.status(400).json({ success: false, error: "날짜를 입력해주세요" });
        }

        await db.collection("dailySalesLog").doc(date).update({
            memo: memo || "",
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({
            success: true,
            message: `${date} 메모 저장 완료`
        });
    } catch (e) {
        console.error("saveSalesLogMemo Error:", e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==========================================
// 수동 동기화 트리거 (비상용)
// ==========================================
// ==========================================
// 5) SALES LOG LOGIC (Daily Distribution)
// ==========================================
async function createDailySalesLog(targetDateStr, { overwrite = false } = {}) {
    // ★ 기존 스냅샷 보호: overwrite=false면 이미 기록된 날짜는 건너뜀
    if (!overwrite) {
        const existingDoc = await db.collection("sales_logs").doc(targetDateStr).get();
        if (existingDoc.exists) {
            console.log(`[SalesLog] ${targetDateStr} 이미 존재 → 건너뜀 (overwrite=false)`);
            return { skipped: true, existing: existingDoc.data().monthlyStats };
        }
    }

    await assertReservationDataReady("createDailySalesLog");

    // 1. Target Period: This Month ~ +5 Months (Total 6 Months)
    // targetDateStr는 "기록일"(Snapshot Date)입니다.
    const recordDate = dayjs(targetDateStr).tz("Asia/Tokyo");

    // 분석 대상 기간: 기록일이 속한 달의 1일 ~ 8개월 뒤 말일 (총 8개월치)
    // 예: 기록일 1/27 -> 1월 ~ 8월
    const startDate = recordDate.startOf('month');
    const endDate = recordDate.add(7, 'month').endOf('month');

    const startStr = startDate.format("YYYY-MM-DD");
    const endStr = endDate.format("YYYY-MM-DD");

    console.log(`[SalesLog] ${targetDateStr} 기록 시작. 대상 기간: ${startStr} ~ ${endStr}`);

    // 2. Fetch Reservations (Overlapping)
    // 쿼리: departure > start AND arrival < end
    // Firestore 복합 쿼리 제약으로 인해, start보다 늦게 끝나는 것들을 가져와서 메모리 필터링
    const snapshot = await db.collection("reservations")
        .where("companyId", "==", DEFAULT_COMPANY_ID)
        .where("departure", ">", startStr)
        .where("status", "==", "confirmed")
        .get();

    const stats = {};
    // 초기화 (YYYY-MM 키 생성)
    let cur = startDate.clone();
    while (cur.isBefore(endDate) || cur.isSame(endDate, 'month')) {
        const key = cur.format("YYYY-MM");
        stats[key] = { revenue: 0, occupancy: 0, nights: 0 };
        cur = cur.add(1, 'month');
    }

    // 3. Calculate Daily Revenue
    snapshot.forEach(doc => {
        const data = doc.data();
        if (!data.arrival || !data.departure) return;

        // ★ Exclude Sano (사노시) and Okubo A (오쿠보A동) from statistics
        if (data.building === "사노시" || data.building === "오쿠보A동") return;

        // ★ 다이쿄초 전체 제외 (매각)
        if (data.building === "다이쿄초") return;

        // ★ 수기 예약 제외 (에어비앤비, 부킹닷컴만 포함)
        if (data.referer !== "Airbnb" && data.referer !== "Booking.com") return;

        // 도착일이 범위 이후면 스킵
        if (data.arrival >= endStr) return;

        // 가격 계산 (Total Price)
        const totalPrice = parseFloat(data.price || data.totalPrice || 0);

        // 박수 계산
        const arr = dayjs(data.arrival);
        const dep = dayjs(data.departure);
        const totalNights = dep.diff(arr, 'day');

        if (totalNights <= 0) return;

        const pricePerNight = totalPrice / totalNights;

        // 범위 내에서 하루씩 순회하며 매출 할당
        let d = arr;
        while (d.isBefore(dep)) {
            // 해당 날짜가 분석 기간 내인지 확인
            if (d.isSame(startDate) || d.isAfter(startDate)) {
                if (d.isBefore(endDate) || d.isSame(endDate, 'day')) {
                    const monthKey = d.format("YYYY-MM");
                    if (stats[monthKey]) {
                        stats[monthKey].revenue += pricePerNight;
                        stats[monthKey].nights += 1;
                        // [DEBUG] 건물별 매출 추적
                        if (!stats[monthKey]._buildingDebug) stats[monthKey]._buildingDebug = {};
                        stats[monthKey]._buildingDebug[data.building || 'UNKNOWN'] = (stats[monthKey]._buildingDebug[data.building || 'UNKNOWN'] || 0) + pricePerNight;
                        // occupancy는 방 개수 대비 %지만, 여기서는 예약된 박수(nights) 총합으로 일단 기록
                        // 프론트엔드나 2차 가공시 총 방 개수(47실?)로 나누어 % 계산 가능
                    }
                }
            }
            d = d.add(1, 'day');
        }
    });

    // 4. Occupancy % Calculation
    // 총 객실 수 (사노시, 오쿠보A동 제외)
    // - 2026-01-25까지: 46실 (Araki A(11) + Araki B(8) + Daikyo(7) + Kabuki(10) + Takadano(8) + Okubo B/C(2))
    // - 2026-01-26부터: 39실 (다이쿄초 7실 제외)
    const ROOM_COUNT_WITH_DAIKYO = 46;
    const ROOM_COUNT_WITHOUT_DAIKYO = 39;
    const DAIKYO_SOLD_DATE = "2026-01-26";

    Object.keys(stats).forEach(key => {
        const [y, m] = key.split('-').map(Number);
        const daysInMonth = new Date(y, m, 0).getDate();

        // 해당 월이 2026-01 이전이면 46실, 2026-02 이후면 39실
        // 2026-01의 경우 25일까지 46실, 26일부터 39실 (가중평균)
        let totalRoomCount;
        const monthKey = key; // YYYY-MM

        if (monthKey < "2026-01") {
            totalRoomCount = ROOM_COUNT_WITH_DAIKYO;
        } else if (monthKey > "2026-01") {
            totalRoomCount = ROOM_COUNT_WITHOUT_DAIKYO;
        } else {
            // 2026-01: 25일까지 46실, 26일부터 39실
            // 가중평균: (25 * 46 + 6 * 39) / 31
            totalRoomCount = Math.round((25 * ROOM_COUNT_WITH_DAIKYO + 6 * ROOM_COUNT_WITHOUT_DAIKYO) / 31);
        }

        const availableNights = daysInMonth * totalRoomCount;

        stats[key].revenue = Math.round(stats[key].revenue); // 반올림
        // 가동률(%): 소수점 1자리
        stats[key].occupancy = (availableNights > 0)
            ? parseFloat(((stats[key].nights / availableNights) * 100).toFixed(1))
            : 0;
    });

    // 5. Save to Firestore
    await db.collection("sales_logs").doc(targetDateStr).set({
        recordedAt: admin.firestore.FieldValue.serverTimestamp(),
        companyId: DEFAULT_COMPANY_ID,
        monthlyStats: stats
    });

    // [DEBUG] 건물별 매출 출력
    const debugMonth = Object.keys(stats).find(k => k === dayjs(targetDateStr).format("YYYY-MM"));
    if (debugMonth && stats[debugMonth]._buildingDebug) {
        const sorted = Object.entries(stats[debugMonth]._buildingDebug).sort((a, b) => b[1] - a[1]);
        console.log(`[DEBUG] ${debugMonth} 건물별 매출:`);
        sorted.forEach(([b, rev]) => console.log(`  ${b}: ¥${Math.round(rev).toLocaleString()}`));
    }
    console.log(`[SalesLog] ${targetDateStr} 저장 완료.`, stats);

    // ★ 6. Also ensure data exists in 'dailySalesLog' collection for manual trigger (memo support)
    const dailyLogRef = db.collection("dailySalesLog").doc(targetDateStr);
    const dailyLogSnapshot = await dailyLogRef.get();

    if (!dailyLogSnapshot.exists) {
        await dailyLogRef.set({
            date: targetDateStr,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            isAutoGenerated: true,
            memo: ""
        });
        console.log(`[SalesLog] DailySalesLog 문서 생성 완료: ${targetDateStr}`);
    } else {
        // Update updated_at just in case
        await dailyLogRef.update({
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    }

    return stats;
}

// 스케줄러: 매일 자정 (일본 시간)
exports.dailySalesSnapshot = onSchedule({
    schedule: "0 0 * * *", // 매일 00:00
    timeZone: "Asia/Tokyo",
    timeoutSeconds: 540,
    memory: "1GiB"
}, async (event) => {
    const yesterday = dayjs().tz("Asia/Tokyo").subtract(1, "day").format("YYYY-MM-DD");
    await createDailySalesLog(yesterday);
});

// 수동 트리거 (HTTP)
exports.recordSalesLog = onRequest({ cors: true }, async (req, res) => {
    try {
        const date = req.query.date || dayjs().tz("Asia/Tokyo").format("YYYY-MM-DD");
        const stats = await createDailySalesLog(date, { overwrite: true });
        res.json({ success: true, date, stats });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// 과거 데이터 백필 (최근 3개월)
exports.backfillSalesLog = onRequest({ cors: true, timeoutSeconds: 540, memory: "1GiB" }, async (req, res) => {
    try {
        const { days = 90, overwrite = false } = req.body; // ★ 기본: 기존 데이터 보호
        const tokyoNow = dayjs().utcOffset(9);

        console.log(`📊 매출 일지 백필 시작: 최근 ${days}일 (overwrite=${overwrite})`);

        const results = [];
        let skippedCount = 0;
        for (let i = days; i >= 1; i--) {
            const targetDate = tokyoNow.subtract(i, 'day').format('YYYY-MM-DD');

            try {
                const result = await createDailySalesLog(targetDate, { overwrite });
                if (result && result.skipped) {
                    results.push({ date: targetDate, success: true, skipped: true });
                    skippedCount++;
                    console.log(`  ⏭️ ${targetDate} 이미 존재 → 건너뜀 (${days - i + 1}/${days})`);
                } else {
                    results.push({ date: targetDate, success: true });
                    console.log(`  ✅ ${targetDate} 완료 (${days - i + 1}/${days})`);
                }
            } catch (err) {
                results.push({ date: targetDate, success: false, error: err.message });
                console.log(`  ❌ ${targetDate} 실패: ${err.message}`);
            }

            // API 과부하 방지
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        const successCount = results.filter(r => r.success && !r.skipped).length;
        const failCount = results.filter(r => !r.success).length;

        res.json({
            success: true,
            message: `백필 완료: ${successCount}건 신규생성, ${skippedCount}건 건너뜀, ${failCount}건 실패`,
            totalDays: days,
            successCount,
            skippedCount,
            failCount,
            results
        });
    } catch (e) {
        console.error("backfillSalesLog Error:", e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ★ 매출 일지 삭제 API
exports.deleteSalesLog = onRequest({ cors: true }, async (req, res) => {
    try {
        const { date } = req.body;

        if (!date) {
            return res.status(400).json({ success: false, error: "날짜를 입력해주세요" });
        }

        await db.collection("sales_logs").doc(date).delete();
        console.log(`🗑️ 매출 일지 삭제: ${date}`);

        res.json({
            success: true,
            message: `${date} 매출 일지 삭제 완료`
        });
    } catch (e) {
        console.error("deleteSalesLog Error:", e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==========================================
// 6) SCHEDULED DAILY REPORT (Premium Styling)
// ==========================================

/**
 * 매일 아침 9시(한국 시간)에 구글 시트 보고서를 업데이트합니다.
 * 'Daily_Log' 탭에 프리미엄 대시보드와 당월 데이터를 생성합니다.
 * ★ 월간 시트/노션은 스케줄 전체 재계산만 수행 (이벤트 기반 부분 갱신 없음). 데이터 일치는 당일 슬랙 리포트·매출일지로 보완.
 */
exports.scheduledDailyReport = onSchedule({
    schedule: "45 8 * * *", // 매일 08:45 JST (9시 출근 전 안정 반영)
    timeZone: "Asia/Tokyo",
    timeoutSeconds: 540,
    memory: "512MiB"
}, async () => {
    await runScheduledDailyReport();
});

/** 노션 연동 테스트: 토큰 여부 + 한 페이지에 블록 추가 시도 → 결과 JSON 반환 */
exports.testNotionSync = onRequest({ cors: true, timeoutSeconds: 30 }, async (req, res) => {
    try {
        const pageId = NOTION_PAGES.dailyLog || NOTION_PAGES.salesLog;
        const result = await testNotionConnection(pageId);
        res.json(result);
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

/** 구글 시트 일일 리포트 지금 한 번 실행 (임시 수동 갱신용). 노션 7종(일일/취소/매출일지/플랫폼/인원현황 + 매출·가동률 대시보드) 동기화 포함 */
exports.runDailyReportNow = onRequest({ cors: true, timeoutSeconds: 540, memory: "1GiB" }, async (req, res) => {
    try {
        await runScheduledDailyReport();
        const dashboardResult = await runNotionDashboardSync();
        if (NOTION_PAGES.paxOccupancy) {
            const tokyoNow = dayjs().tz("Asia/Tokyo");
            let paxData = null;
            try {
                const { runPaxOccupancyReport } = require("./modules/paxOccupancyReport");
                const paxResult = await runPaxOccupancyReport();
                paxData = paxResult.paxDataForNotion || null;
            } catch (paxErr) {
                console.warn("runPaxOccupancyReport (인원현황) 실패, 노션은 요약만 반영:", paxErr.message);
            }
            await syncNotionPaxOccupancy(NOTION_PAGES.paxOccupancy, {
                title: "인원현황",
                tokyoNow,
                summaryText: paxData ? "수동 갱신으로 구글 시트·노션 동기화됨." : "인원현황 데이터 생성 실패. 매일 08:50 JST PAX 리포트 후 반영됩니다.",
                paxData
            });
        }
        const notionTest = await testNotionConnection(NOTION_PAGES.dailyLog || NOTION_PAGES.salesLog);
        res.json({
            success: true,
            message: "Google Sheet daily report updated",
            notionTest: notionTest,
            ...(dashboardResult && dashboardResult.salesDashboardError && { notionSalesDashboardError: dashboardResult.salesDashboardError })
        });
    } catch (e) {
        console.error("runDailyReportNow:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

exports.scheduledPlatformAnalysisHourly = scheduledPlatformAnalysisHourly;
exports.scheduledPaxOccupancyReport = scheduledPaxOccupancyReport;
exports.scheduledMonthlyBriefingSetup = scheduledMonthlyBriefingSetup;

/** 매출·가동률 대시보드 요약을 노션에 동기화 (매일 09:00 JST). 반환: { salesDashboardError? } */
async function runNotionDashboardSync() {
    let salesDashboardError = null;
    const tokyoNow = dayjs().tz("Asia/Tokyo");
    const year = tokyoNow.year();
    const month = tokyoNow.month() + 1;
    const monthlyReports = [];
    const startYear = 2026;
    const endYear = tokyoNow.year();
    const endMonth = tokyoNow.month() + 1;
    try {
        for (let y = startYear; y <= endYear; y++) {
            const startM = y === startYear ? 1 : 1;
            const endM = y === endYear ? endMonth : 12;
            for (let m = startM; m <= endM; m++) {
                const yearMonth = `${y}-${String(m).padStart(2, "0")}`;
                const salesData = await computeRevenueDashboardData(db, {
                    companyId: DEFAULT_COMPANY_ID,
                    BUILDING_ROOMS,
                    forYearMonth: yearMonth
                });
                let chartUrl = null;
                let buildingChartUrl = null;
                if (salesData && Array.isArray(salesData.monthlySeries) && salesData.monthlySeries.length > 0) {
                    chartUrl = await getMonthlyRevenueChartUrl(salesData.monthlySeries, yearMonth);
                }
                if (salesData && Array.isArray(salesData.buildingBreakdown) && salesData.buildingBreakdown.length > 0) {
                    buildingChartUrl = await getBuildingRevenueChartUrl(salesData.buildingBreakdown, yearMonth);
                }
                monthlyReports.push({ yearMonth, salesData, chartUrl, buildingChartUrl });
            }
        }
    } catch (e) {
        console.warn("[Notion] Sales dashboard data/chart:", e.message);
    }

    const currentYearMonth = `${year}-${String(month).padStart(2, "0")}`;
    const currentMonthReport = monthlyReports.find((item) => item.yearMonth === currentYearMonth);
    const currentSalesData = currentMonthReport?.salesData || null;
    const salesSummary = currentSalesData
        ? `당월(${currentYearMonth}) 체크인 예약 ${currentSalesData.checkinReservationCount ?? currentSalesData.stayMonthReservationCount ?? 0}건 · 운영 매출 ¥${Number(currentSalesData.currentMonthRevenue || 0).toLocaleString()}`
        : `당월(${currentYearMonth}) 시스템 대시보드 기준 데이터가 없습니다.`;
    const occSummary = currentSalesData
        ? `당월 가동률 ${Number(currentSalesData.occupancyPct || 0).toFixed(1)}% (점유 ${currentSalesData.occupiedRoomNights || 0} room-nights / 전체 ${currentSalesData.totalRoomNights || 0})`
        : `당월(${currentYearMonth}) 시스템 대시보드 기준 가동률 데이터가 없습니다.`;

    const runReportUrl = process.env.REPORT_BASE_URL ? `${process.env.REPORT_BASE_URL}/runDailyReportNow` : null;
    const appDashboardUrl = process.env.APP_BASE_URL ? `${process.env.APP_BASE_URL.replace(/\/$/, "")}/#/revenue` : null;

    if (NOTION_PAGES.salesDashboard) {
        try {
            await syncNotionSalesDashboard(NOTION_PAGES.salesDashboard, {
                tokyoNow,
                summaryText: salesSummary,
                monthlyReports,
                runReportUrl,
                appDashboardUrl
            });
        } catch (e) {
            salesDashboardError = e.message || String(e);
            console.error("syncNotionSalesDashboard 실패:", e.message, e.stack);
        }
    }
    // 가동률 대시보드 페이지는 비워 둠 (나중에 다른 보고서용으로 사용할 수 있도록 sync 안 함)
    // if (NOTION_PAGES.occupancyDashboard) {
    //     await syncNotionOccupancyDashboard(NOTION_PAGES.occupancyDashboard, { tokyoNow, summaryText: occSummary });
    // }
    return salesDashboardError ? { salesDashboardError } : {};
}

exports.scheduledNotionDashboardSync = onSchedule({
    schedule: "0 9 * * *",
    timeZone: "Asia/Tokyo",
    timeoutSeconds: 120,
    memory: "256MiB"
}, async () => {
    try {
        await runNotionDashboardSync();
        console.log("✅ [Notion] 매출·가동률 대시보드 동기화 완료");
    } catch (e) {
        console.error("❌ [Notion] Dashboard sync failed:", e.message);
    }
});

exports.scheduledSlackDailyReport = scheduledSlackDailyReport;
exports.sendSlackDailyReportManual = sendSlackDailyReportManual;
exports.scheduledSlackCleaningReport = scheduledSlackCleaningReport;
exports.sendSlackCleaningReportManual = sendSlackCleaningReportManual;

exports.scheduledMonthlyNotionReport = scheduledMonthlyNotionReport;
exports.sendNotionReport = sendNotionReport;

// 리뷰 수동 동기화 (날짜 범위 지정)
exports.syncReviewsManual = onRequest({ cors: true, timeoutSeconds: 540, memory: "512MiB" }, async (req, res) => {
    try {
        const { companyId, fromDate, toDate } = req.body;
        if (!companyId) return res.status(400).json({ success: false, error: "Missing companyId" });
        const from = fromDate || dayjs().tz("Asia/Tokyo").subtract(30, "day").format("YYYY-MM-DD");
        console.log(`🔄 [syncReviewsManual] fromDate=${from}, toDate=${toDate || "auto"}, companyId=${companyId}`);
        const synced = await syncAllReviews(companyId, from, { insertOnly: false, toDate: toDate || null });
        res.json({ success: true, synced });
    } catch (e) {
        console.error("syncReviewsManual:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});
