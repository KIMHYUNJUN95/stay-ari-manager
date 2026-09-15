const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const { setGlobalOptions } = require("firebase-functions/v2/options");
const axios = require("axios");
const admin = require("firebase-admin");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
dayjs.extend(utc);
dayjs.extend(timezone);
const cors = require("cors")({ origin: true });
const { createSlackReportModule } = require("./modules/slackReports");
const { createHotelsmartCleaningModule } = require("./modules/hotelsmart");
const { createGoogleSheetReportModule } = require("./modules/googleSheetReports");
const { createNotionReportModule } = require("./modules/notionReports");
const { createPriceConsistencyAuditModule } = require("./modules/priceConsistencyAudit");
const { NOTION_PAGES, syncNotionSalesDashboard, syncNotionOccupancyDashboard, syncNotionPaxOccupancy, testNotionConnection } = require("./modules/notionReportSync");
const { computeRevenueDashboardData } = require("./modules/revenueDashboardData");
const { getMonthlyRevenueChartUrl, getBuildingRevenueChartUrl } = require("./modules/chartImage");
const { sendSameDayBookingAlert } = require("./modules/sameDayBookingAlert");
const { markHomeDashboardSummaryDirty, refreshHomeDashboardSummary, processDirtyHomeDashboardSummaries } = require("./modules/homeDashboardSummary");
const { createAttendanceAppClient } = require("./modules/attendanceAppClient");
const { runCleaningWorkforceForecastUpdate } = require("./update-cleaning-workforce-forecast");
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
const beds24RefreshTokenSecret = defineSecret("BEDS24_REFRESH_TOKEN");
const googleServiceAccountJsonSecret = defineSecret("GOOGLE_SERVICE_ACCOUNT_JSON");
setGlobalOptions({ secrets: [beds24RefreshTokenSecret, googleServiceAccountJsonSecret] });

// 기본 Company ID (환경 변수 또는 하드코딩된 기본값)
// 향후 멀티 테넌트 확장 시 각 회사별 Beds24 토큰 관리 필요
const DEFAULT_COMPANY_ID = process.env.DEFAULT_COMPANY_ID || 'dGxlQyu47LbplLVCVXiV';
const hotelsmartLoginIdSecret = defineSecret("HOTELSMART_LOGIN_ID");
const hotelsmartPasswordSecret = defineSecret("HOTELSMART_PASSWORD");
const HOTELSMART_SECRETS = [hotelsmartLoginIdSecret, hotelsmartPasswordSecret];

async function authorizeInternalAutomationRequest(req) {
    const authorization = String(req.headers?.authorization || "").trim();
    const match = /^Bearer\s+(.+)$/i.exec(authorization);
    if (!match) {
        const error = new Error("Firebase ID token required");
        error.statusCode = 401;
        throw error;
    }

    let decodedToken;
    try {
        decodedToken = await admin.auth().verifyIdToken(match[1]);
    } catch (verificationError) {
        const error = new Error("Invalid Firebase ID token");
        error.statusCode = 401;
        throw error;
    }

    const userSnapshot = await db.collection("users").doc(decodedToken.uid).get();
    const userData = userSnapshot.exists ? (userSnapshot.data() || {}) : {};
    const allowedRoles = new Set(["owner", "manager"]);
    if (userData.companyId !== DEFAULT_COMPANY_ID || !allowedRoles.has(userData.role)) {
        const error = new Error("Owner or manager access required");
        error.statusCode = 403;
        throw error;
    }

    return { uid: decodedToken.uid, companyId: userData.companyId, role: userData.role };
}

// 메모리 캐시 (같은 인스턴스 내에서 Firestore 읽기 최소화)
let beds24AccessToken = null;
let beds24TokenExpiry = 0;

// Firestore 토큰 문서 경로
const TOKEN_DOC_PATH = "beds24_config/token";
const RESERVATION_FORECAST_IMPACT_FIELDS = [
    "arrival",
    "departure",
    "status",
    "room",
    "roomId",
    "building",
    "companyId",
];

function hasReservationForecastImpactChange(before, after) {
    if (!before || !after) return true;
    return RESERVATION_FORECAST_IMPACT_FIELDS.some((field) => {
        const prev = before[field] ?? null;
        const next = after[field] ?? null;
        return prev !== next;
    });
}

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
        const refreshToken = String(beds24RefreshTokenSecret.value() || "")
            .replace(/\uFEFF/g, "")
            .replace(/[\r\n]/g, "")
            .trim();
        if (!refreshToken) {
            throw new Error("BEDS24_REFRESH_TOKEN secret is empty");
        }
        if (/[\u0000-\u001F\u007F-\u009F]/.test(refreshToken)) {
            throw new Error("BEDS24_REFRESH_TOKEN secret contains invalid control characters");
        }
        const response = await axios.get("https://beds24.com/api/v2/authentication/token", {
            headers: {
                "accept": "application/json",
                "refreshToken": refreshToken
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
    { name: "STAY ARI Apartment Hotel", id: "343112", v2Id: 343112, companyId: DEFAULT_COMPANY_ID },
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

async function assertBeds24PropertyCoverage(properties = PROPERTIES) {
    const expectedIds = (properties || [])
        .filter((prop) => prop && !prop.disabled)
        .map((prop) => String(prop.v2Id));
    const accessibleProperties = await fetchAllBeds24Properties();
    const accessibleIds = new Set(accessibleProperties.map((prop) => String(prop.id)));
    const missingIds = expectedIds.filter((propertyId) => !accessibleIds.has(propertyId));
    if (missingIds.length > 0) {
        throw new Error(`Beds24 property coverage incomplete: ${missingIds.join(",")}`);
    }
    return { expectedCount: expectedIds.length, accessibleCount: accessibleIds.size };
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
// Beds24 credits are shared at account level. Keep enough headroom for
// booking/inventory webhooks and other functions running in parallel.
const BEDS24_REQUEST_SOFT_LIMIT = 80;
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
    "roomId",
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

const SLACK_CLEANING_CORRECTION_FIELDS = new Set(["arrival", "room", "status"]);

function shouldQueueSlackCleaningCorrection(beforeData, afterData, changedFields, todayStr) {
    if (!beforeData || !afterData || !todayStr) return false;
    if (!(changedFields || []).some((field) => SLACK_CLEANING_CORRECTION_FIELDS.has(field))) return false;

    const beforeArrival = String(beforeData.arrival || "").slice(0, 10);
    const afterArrival = String(afterData.arrival || "").slice(0, 10);
    const beforeAffected = beforeData.status === "confirmed" && beforeArrival === todayStr;
    const afterAffected = afterData.status === "confirmed" && afterArrival === todayStr;
    return beforeAffected || afterAffected;
}

async function queueSlackCleaningCorrection({ companyId, bookingId, targetDate, changedFields }) {
    await db.collection("slack_cleaning_correction_jobs").add({
        companyId,
        bookingId: String(bookingId || ""),
        targetDate,
        changedFields: Array.from(new Set(changedFields || [])),
        status: "queued",
        requestedAt: admin.firestore.FieldValue.serverTimestamp()
    });
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

    // sync 시마다 재정제: 기존 noisy guestComments도 점진 정리
    // 후보 우선순위: guestComments(기존값) > comments > notes
    enriched.guestComments = extractHumanNotes(enriched);

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
    const isWebhookAudit = syncVariant === "webhook" || rest.syncType === "webhook";
    if (isWebhookAudit) {
        const auditId = await recordSyncAudit({
            domain: "reservations",
            statusDocId: RESERVATION_SYNC_STATUS_DOC_ID,
            ...rest,
            updateStatusDoc: false
        });
        const webhookStatus = {
            lastWebhookAuditId: auditId,
            lastWebhookAt: admin.firestore.FieldValue.serverTimestamp(),
            lastWebhookStatus: rest.status || "success",
            lastWebhookErrorMessage: rest.errorMessage || "",
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        if ((rest.status || "success") !== "error") {
            webhookStatus.lastWebhookSuccessAt = admin.firestore.FieldValue.serverTimestamp();
        }
        await db.collection("sync_status").doc(RESERVATION_SYNC_STATUS_DOC_ID).set(webhookStatus, { merge: true });
        return auditId;
    }

    const errorMessage = String(rest.errorMessage || "");
    const isTransientRateLimitError = rest.status === "error" &&
        /(status code 429|\b429\b|limit exceeded|too many requests|rate limit)/i.test(errorMessage);
    if (isTransientRateLimitError) {
        const auditId = await recordSyncAudit({
            domain: "reservations",
            statusDocId: RESERVATION_SYNC_STATUS_DOC_ID,
            ...rest,
            updateStatusDoc: false
        });
        await db.collection("sync_status").doc(RESERVATION_SYNC_STATUS_DOC_ID).set({
            lastAttemptAuditId: auditId,
            lastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
            lastAttemptStatus: "error",
            lastAttemptErrorMessage: errorMessage,
            lastTransientErrorAt: admin.firestore.FieldValue.serverTimestamp(),
            lastTransientErrorReason: "beds24_rate_limit_429",
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        return auditId;
    }

    const statusMarkers = {};
    const isSuccessfulAudit = rest.status !== "error" && rest.status !== "skipped";
    if (isSuccessfulAudit && syncVariant === "incremental") {
        statusMarkers.lastIncrementalAt = true;
        statusMarkers.lastReconciledAt = true;
    }
    if (isSuccessfulAudit && (syncVariant === "full_reconcile" || syncVariant === "manual_quick" || syncVariant === "manual_full")) {
        statusMarkers.lastFullReconcileAt = true;
        statusMarkers.lastReconciledAt = true;
    }
    if (isSuccessfulAudit && !syncVariant && rest.syncType !== "webhook") {
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
    const isSuccessfulAudit = rest.status !== "error" && rest.status !== "skipped";
    if (isSuccessfulAudit && (syncVariant === "webhook" || syncVariant === "immediate" ||
        syncVariant === "queued" || syncVariant === "failed" || syncVariant === "skipped")) {
        statusMarkers.lastWebhookAt = true;
    }
    if (isSuccessfulAudit && syncVariant === "incremental") {
        statusMarkers.lastIncrementalAt = true;
        statusMarkers.lastReconciledAt = true;
    }
    if (isSuccessfulAudit && (syncVariant === "full_reconcile" || syncVariant === "manual_full")) {
        statusMarkers.lastFullReconcileAt = true;
        statusMarkers.lastReconciledAt = true;
    }
    if (isSuccessfulAudit && syncVariant === "minstay_reconcile") {
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

const BEDS24_API_GUARD_DOC_ID = "beds24_api_guard";
const BEDS24_API_LOW_CREDIT_THRESHOLD = 10;
const BEDS24_API_GUARD_MIN_COOLDOWN_SEC = 15;
const BEDS24_API_GUARD_DEFAULT_COOLDOWN_SEC = 60;
const BEDS24_API_GUARD_MAX_COOLDOWN_SEC = 300;
const RESERVATION_FULL_SYNC_LOCK_DOC_ID = "reservation_full_sync_lock";
const RESERVATION_FULL_SYNC_LOCK_TTL_MS = 20 * 60 * 1000;

function normalizeBeds24ApiCooldownSec(resetInSec, fallbackSec = BEDS24_API_GUARD_DEFAULT_COOLDOWN_SEC) {
    const baseSec = Number.isFinite(resetInSec) && resetInSec > 0 ? (resetInSec + 2) : fallbackSec;
    return Math.min(Math.max(baseSec, BEDS24_API_GUARD_MIN_COOLDOWN_SEC), BEDS24_API_GUARD_MAX_COOLDOWN_SEC);
}

async function getBeds24ApiGuardState() {
    const snap = await db.collection("sync_status").doc(BEDS24_API_GUARD_DOC_ID).get();
    if (!snap.exists) {
        return { active: false, remainingSec: 0, reason: null, creditRemaining: null };
    }

    const data = snap.data() || {};
    const cooldownUntil = toDateOrNull(data.cooldownUntil);
    const remainingMs = cooldownUntil ? (cooldownUntil.getTime() - Date.now()) : 0;
    return {
        active: remainingMs > 0,
        remainingSec: remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0,
        reason: data.reason || null,
        creditRemaining: data.creditRemaining ?? null,
        endpoint: data.endpoint || null,
        method: data.method || null
    };
}

async function activateBeds24ApiGuard({
    reason = "rate_limit",
    resetInSec = null,
    creditRemaining = null,
    endpoint = null,
    method = null,
    fallbackSec = BEDS24_API_GUARD_DEFAULT_COOLDOWN_SEC
} = {}) {
    const cooldownSec = normalizeBeds24ApiCooldownSec(resetInSec, fallbackSec);
    const cooldownUntil = new Date(Date.now() + cooldownSec * 1000);
    await db.collection("sync_status").doc(BEDS24_API_GUARD_DOC_ID).set({
        reason,
        creditRemaining: Number.isFinite(creditRemaining) ? creditRemaining : null,
        endpoint: endpoint || null,
        method: method || null,
        cooldownSec,
        cooldownUntil,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    console.warn(`[Beds24ApiGuard] ${reason} -> cooldown ${cooldownSec}s (${method || "API"} ${endpoint || ""})`);
    return { cooldownSec, cooldownUntil };
}

async function acquireReservationFullSyncLock(owner) {
    const lockRef = db.collection("sync_status").doc(RESERVATION_FULL_SYNC_LOCK_DOC_ID);
    return db.runTransaction(async (tx) => {
        const snap = await tx.get(lockRef);
        const data = snap.exists ? (snap.data() || {}) : {};
        const expiresAt = toDateOrNull(data.expiresAt);
        if (data.state === "running" && expiresAt && expiresAt.getTime() > Date.now()) {
            return {
                acquired: false,
                owner: data.owner || null,
                expiresAt
            };
        }

        const nextExpiresAt = new Date(Date.now() + RESERVATION_FULL_SYNC_LOCK_TTL_MS);
        tx.set(lockRef, {
            state: "running",
            owner,
            acquiredAt: admin.firestore.FieldValue.serverTimestamp(),
            expiresAt: nextExpiresAt,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        return { acquired: true, owner, expiresAt: nextExpiresAt };
    });
}

async function releaseReservationFullSyncLock(owner) {
    const lockRef = db.collection("sync_status").doc(RESERVATION_FULL_SYNC_LOCK_DOC_ID);
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(lockRef);
        if (!snap.exists || snap.data()?.owner !== owner) return;
        tx.set(lockRef, {
            state: "released",
            owner: null,
            expiresAt: new Date(0),
            releasedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    });
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
    invalidThreshold = REPORT_INVALID_THRESHOLD,
    allowAuditErrorWhenFresh = false
} = {}) {
    const statusSnap = await db.collection("sync_status").doc(RESERVATION_SYNC_STATUS_DOC_ID).get();
    if (!statusSnap.exists) {
        console.warn(`[Reservation Gate] ${context}: sync status missing (companyId=${companyId})`);
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

    const shouldIgnoreAuditError = (
        allowAuditErrorWhenFresh &&
        Boolean(lastHealthyAt) &&
        invalidCriticalCount <= invalidThreshold
    );

    if (data.lastAuditStatus === "error" && !shouldIgnoreAuditError) {
        errors.push(`마지막 sync audit 상태가 error 입니다 (${data.lastErrorMessage || "원인 미상"})`);
    }
    if (invalidCriticalCount > invalidThreshold) {
        errors.push(`필수 필드 누락 예약이 ${invalidCriticalCount}건 감지되었습니다`);
    }

    if (errors.length > 0) {
        // The owning scheduled/manual function sends one incident alert.
        // Sending here multiplied one sync issue across every downstream
        // report and every webhook-triggered sales-log refresh.
        console.warn(`[Reservation Gate] ${context} blocked (companyId=${companyId}): ${errors.join(" | ")}`);
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
        "513701": "501호", "513702": "601호", "513703": "701호", "513704": "801호", "513705": "901호",
        "708662": "101", "708663": "102", "708632": "103", "708635": "105",
        "708636": "106", "708637": "107", "708638": "108", "708642": "109", "708643": "110",
        "708664": "201", "708665": "202", "708644": "203", "708645": "205",
        "708646": "206", "708650": "207", "708651": "208", "708652": "209", "708653": "210",
        "708666": "302", "708654": "303", "708656": "305", "708657": "306",
        "708658": "307", "708659": "308", "708660": "309", "708661": "310"
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
// 2-B) HELPER: BOOKING CREATED-AT (exact ms + source)
// ==========================================
function resolveBookingCreatedAt(b) {
    // exact datetime: require time component (length > 10)
    const toExactMs = (str) => {
        if (!str || str.length <= 10) return null;
        try {
            const ms = dayjs(str).valueOf();
            return (Number.isFinite(ms) && ms > 0) ? ms : null;
        } catch { return null; }
    };
    // date-only fallback: end-of-day JST
    const toDateEndMs = (dateKey) => {
        if (!dateKey || dateKey.length < 10) return null;
        try {
            const ms = new Date(`${String(dateKey).slice(0, 10)}T23:59:59+09:00`).getTime();
            return Number.isFinite(ms) ? ms : null;
        } catch { return null; }
    };

    for (const [field, src] of [['bookingTime', 'bookingTime'], ['bookTime', 'bookTime'], ['entryTime', 'entryTime']]) {
        const ms = toExactMs(b[field]);
        if (ms) return { ms, source: src };
    }
    const bookDateMs = toDateEndMs(b.bookDate);
    if (bookDateMs) return { ms: bookDateMs, source: 'bookDate_fallback' };
    return { ms: null, source: 'unknown' };
}

// ==========================================
// 3) NORMALIZE & FETCH (Normal Sync)
// ==========================================

// OTA/Beds24 시스템 정책 문구 판별 — 사람이 쓴 메모는 제거하지 않도록 보수적으로 작성
function isSystemPolicyLine(line) {
    if (!line || !line.trim()) return true; // 빈 줄 제거
    const t = line.trim();
    const patterns = [
        /THIS RESERVATION HAS BEEN PRE-PAID/i,
        /cancellation grace period/i,
        /do not charge if cancelled/i,
        /non-refundable/i,
        /booked rate:/i,
        /rate plan:/i,
        /payment policy/i,
        /cancellation policy/i,
        /\bpre-paid\b/i,
        /booking\.com policy/i,
        /^this booking is guaranteed/i,
        /^payment received/i,
        /^virtual credit card/i,
        /\bVCC\b/,
    ];
    return patterns.some((re) => re.test(t));
}

// 예약 raw 데이터에서 사람이 쓴 메모만 추출
// 줄 단위 통삭제 대신 세그먼트 단위 필터 — 정책+요청 혼합 줄에서도 요청 보존
function extractHumanNotes(b) {
    // 후보 필드 순서대로 수집 (중복 제거): 수기 기입값(guestComments) 우선
    const seen = new Set();
    const candidates = [];
    for (const val of [b.guestComments, b.comments, b.notes]) {
        const s = String(val || "").trim();
        if (s && !seen.has(s)) { seen.add(s); candidates.push(s); }
    }
    if (candidates.length === 0) return "";

    const resultLines = [];
    const seenSegs = new Set();

    for (const block of candidates) {
        for (const rawLine of block.split(/\r?\n/)) {
            const line = rawLine.trim();
            if (!line) continue;

            // 세그먼트 단위 분리: `. ` `;` `•` `|` 기준
            // 소수점/약어 오탐 방지를 위해 `.` 뒤에 공백이 오는 경우만 분리
            // 전체 줄 선필터 없이 세그먼트 레벨에서만 판별 — 혼합 줄 보존
            const segments = line.split(/[•|;]|\.\s+/);
            const kept = [];
            for (const seg of segments) {
                const s = seg.trim();
                if (!s || seenSegs.has(s)) continue;
                if (isSystemPolicyLine(s)) continue;
                seenSegs.add(s);
                kept.push(s);
            }
            if (kept.length > 0) resultLines.push(kept.join(" "));
        }
    }
    return resultLines.join("\n");
}

function normalize(b, propKey, building, companyId) {
    const status = determineStatus(b);
    const bookDateStr = determineDate(b);
    const bookingCreatedAt = resolveBookingCreatedAt(b);

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
        guestComments: extractHumanNotes(b),
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
        // ★ 예약 생성 정밀 시각 (attribution용)
        bookingCreatedAtMs: bookingCreatedAt.ms,
        bookingCreatedAtSource: bookingCreatedAt.source,
        ...(b.bookingTime ? { bookingTimeRaw: b.bookingTime } : {}),
        ...(b.bookTime ? { bookTimeRaw: b.bookTime } : {}),
        ...(b.entryTime ? { entryTimeRaw: b.entryTime } : {}),
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
                const isTransientNetworkError = (
                    !err.response &&
                    ["ECONNRESET", "ETIMEDOUT", "ECONNABORTED", "ENOTFOUND", "EAI_AGAIN"].includes(err.code)
                ) || /socket hang up|network|timeout/i.test(err.message || "");
                if (isTransientNetworkError && rateLimitRetry < 3) {
                    rateLimitRetry++;
                    const waitSec = rateLimitRetry * 5; // 5s, 10s, 15s
                    console.warn(`  ⚠️ Transient Beds24 network error. ${waitSec}초 대기 후 재시도 (${rateLimitRetry}/3)`);
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
const BEDS24_BOOKING_STATUSES = ["confirmed", "new", "cancelled", "request", "black", "inquiry"];

// Beds24 V2 supports repeated propertyId/status parameters. Fetch all active
// properties in one pagination flow so reconciliation stays credit efficient.
async function fetchAllBookingsFromProperties(properties, dateParams, options = {}) {
    const activeProperties = (properties || []).filter((prop) => prop && !prop.disabled);
    if (activeProperties.length === 0) return [];

    const toV2Date = (value) => {
        if (!value || value.length !== 8) return value;
        return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
    };
    const propertyById = new Map(activeProperties.map((prop) => [String(prop.v2Id), prop]));
    const statuses = options.legacyMode
        ? ["confirmed", "new", "cancelled"]
        : BEDS24_BOOKING_STATUSES;
    const requestBudget = options.requestBudget || null;
    const finalParams = { ...dateParams };
    if (finalParams.arrivalFrom) finalParams.arrivalFrom = toV2Date(finalParams.arrivalFrom);
    if (finalParams.arrivalTo) finalParams.arrivalTo = toV2Date(finalParams.arrivalTo);

    const allBookings = [];
    let page = 1;
    while (true) {
        const params = {
            propertyId: activeProperties.map((prop) => prop.v2Id),
            status: statuses,
            page,
            limit: 100
        };
        if (finalParams.modifiedFrom) {
            params.modifiedFrom = finalParams.modifiedFrom;
        } else {
            if (finalParams.arrivalFrom) params.arrivalFrom = finalParams.arrivalFrom;
            if (finalParams.arrivalTo) params.arrivalTo = finalParams.arrivalTo;
        }

        await waitForBeds24RequestBudget(requestBudget, `bookings:batch:page${page}`);
        consumeBeds24RequestBudget(requestBudget);
        const response = await beds24GetV2WithGuard("/bookings", params, 5, {
            paramsSerializer: beds24RepeatParamsSerializer
        });
        const rows = Array.isArray(response.data?.data) ? response.data.data : [];

        for (const booking of rows) {
            const prop = propertyById.get(String(booking.propertyId));
            if (!prop) {
                console.warn(`[Bookings Batch] Unknown propertyId=${booking.propertyId}, bookingId=${booking.id || "-"}`);
                continue;
            }
            allBookings.push(normalize(booking, prop.id, prop.name, prop.companyId));
        }

        console.log(`[Bookings Batch] page=${page}, fetched=${rows.length}, accepted=${allBookings.length}`);
        if (!response.data?.pages?.nextPageExists) break;
        page++;
        await sleep(500);
    }

    return allBookings;
}

async function fetchFromBeds24Quick(options = {}) {
    const tokyoNow = options.now ? dayjs(options.now).utcOffset(9) : dayjs().utcOffset(9);
    const syncWindow = getReservationSyncWindow(tokyoNow);
    const arrivalFrom = options.arrivalFrom || syncWindow.start;
    const arrivalTo = options.arrivalTo || syncWindow.end;
    const requestBudget = options.requestBudget || null;

    console.log(`[Quick Sync] Tokyo: ${tokyoNow.format("YYYY-MM-DD HH:mm")} | Arrival Range: ${arrivalFrom} ~ ${arrivalTo}`);

    const allBookings = await fetchAllBookingsFromProperties(PROPERTIES, {
        arrivalFrom,
        arrivalTo
    }, { requestBudget });

    console.log(`✅ Quick Sync 완료: 총 ${allBookings.length}건`);
    return allBookings;
}

// 전체 동기화: 2023년 1월부터 향후 2년 (표준)
async function fetchFromBeds24Full(options = {}) {
    const arrivalFrom = "2023-01-01"; // 다시 2023년부터 조회
    const arrivalTo = dayjs().add(24, "month").format("YYYY-MM-DD"); // V2 형식 유지
    const requestBudget = options.requestBudget || null;

    console.log(`[Full Sync] ${arrivalFrom} ~ ${arrivalTo}`);

    const allBookings = await fetchAllBookingsFromProperties(PROPERTIES, {
        arrivalFrom,
        arrivalTo
    }, { requestBudget });

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

    const allBookings = await fetchAllBookingsFromProperties(PROPERTIES, { modifiedFrom }, { requestBudget });
    console.log(`✅ Incremental Sync 완료: ${allBookings.length}건 (변경분만)`);
    return allBookings;
}

function getBookingAmount(doc) {
    return Number(doc.totalPrice ?? doc.price) || 0;
}

async function collectReservationMutations(list) {
    const uniqueItems = [...new Map((list || []).map((item) => [String(item.id), item])).values()];
    const mutations = [];
    const READ_CHUNK = 100;
    for (let i = 0; i < uniqueItems.length; i += READ_CHUNK) {
        const chunk = uniqueItems.slice(i, i + READ_CHUNK);
        const refs = chunk.map((item) => db.collection("reservations").doc(String(item.id)));
        const snapshots = await db.getAll(...refs);
        snapshots.forEach((snapshot, index) => {
            const beforeData = snapshot.exists ? snapshot.data() : null;
            const afterData = chunk[index];
            const mutationSummary = buildReservationMutationSummary(beforeData, afterData);
            if (!beforeData || mutationSummary.changedFields.length > 0) {
                mutations.push({ beforeData, afterData, mutationSummary });
            }
        });
    }
    return mutations;
}

const PRICE_CACHE_RESERVATION_FIELDS = new Set(["arrival", "departure", "status", "room", "roomId"]);

async function invalidatePriceCacheForReservationMutations(
    mutations,
    companyId = DEFAULT_COMPANY_ID,
    source = "reservation_mutation"
) {
    const affectedRoomIdsByBuilding = new Map();
    const todayJst = dayjs().tz("Asia/Tokyo").format("YYYY-MM-DD");

    const addAffectedReservation = (reservation) => {
        if (!reservation) return;
        if (reservation.companyId && reservation.companyId !== companyId) return;

        const building = String(reservation.building || "").trim();
        const roomId = String(reservation.roomId || "").trim();
        const departure = String(reservation.departure || "").slice(0, 10);
        if (!building || !roomId) return;
        if (departure && departure < todayJst) return;

        const property = PROPERTIES.find((item) => item.name === building && !item.disabled);
        if (!property) return;

        if (!affectedRoomIdsByBuilding.has(building)) {
            affectedRoomIdsByBuilding.set(building, new Set());
        }
        affectedRoomIdsByBuilding.get(building).add(roomId);
    };

    for (const mutation of mutations || []) {
        const changedFields = mutation?.mutationSummary?.changedFields || [];
        if (!changedFields.some((field) => PRICE_CACHE_RESERVATION_FIELDS.has(field))) continue;

        // A cancellation/date/room move can affect both the old and new inventory location.
        addAffectedReservation(mutation.beforeData);
        addAffectedReservation(mutation.afterData);
    }

    await Promise.all([...affectedRoomIdsByBuilding.entries()].map(async ([building, roomIdSet]) => {
        const priceSyncRef = db.collection("price_sync").doc(building);
        await db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(priceSyncRef);
            const current = snapshot.exists ? snapshot.data() : {};
            const invalidatedRoomIds = new Set((current.invalidatedRoomIds || []).map(String));
            const reservationInvalidatedRoomIds = new Set(
                (current.reservationInvalidatedRoomIds || []).map(String)
            );
            roomIdSet.forEach((roomId) => invalidatedRoomIds.add(String(roomId)));
            roomIdSet.forEach((roomId) => reservationInvalidatedRoomIds.add(String(roomId)));

            transaction.set(priceSyncRef, {
                invalidatedRoomIds: [...invalidatedRoomIds],
                pendingInvalidationCount: invalidatedRoomIds.size,
                reservationInvalidatedRoomIds: [...reservationInvalidatedRoomIds],
                pendingReservationInvalidationCount: reservationInvalidatedRoomIds.size,
                invalidatedAt: admin.firestore.FieldValue.serverTimestamp(),
                invalidatedBy: source,
                reservationInvalidatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        });
    }));

    return Object.fromEntries(
        [...affectedRoomIdsByBuilding.entries()].map(([building, roomIds]) => [building, [...roomIds]])
    );
}

async function runReservationReconcileAlertFallbacks(mutations, companyId = DEFAULT_COMPANY_ID) {
    try {
        await invalidatePriceCacheForReservationMutations(
            mutations,
            companyId,
            "reservation_reconcile"
        );
    } catch (error) {
        console.warn("[Reservation Reconcile] price cache invalidation failed:", error.message);
        await sendSyncAlert("reservation price cache invalidation failed", [
            `companyId=${companyId}`,
            String(error.message || error)
        ]);
    }

    const todayJst = dayjs().tz("Asia/Tokyo").format("YYYY-MM-DD");
    for (const { beforeData, afterData, mutationSummary } of mutations || []) {
        const bookingId = afterData.bookId || afterData.id;
        if (shouldQueueSlackCleaningCorrection(beforeData, afterData, mutationSummary.changedFields, todayJst)) {
            try {
                await queueSlackCleaningCorrection({
                    companyId,
                    bookingId,
                    targetDate: todayJst,
                    changedFields: mutationSummary.changedFields.filter((field) => SLACK_CLEANING_CORRECTION_FIELDS.has(field))
                });
            } catch (error) {
                console.warn(`[Reservation Reconcile] cleaning correction queue failed for ${bookingId}:`, error.message);
            }
        }

        const amount = getBookingAmount(afterData);
        const isSameDayCreated = mutationSummary.eventType === "created" &&
            afterData.status === "confirmed" &&
            String(afterData.bookDate || "").slice(0, 10) === todayJst &&
            String(afterData.arrival || "").slice(0, 10) === todayJst &&
            amount > 0 &&
            afterData.building !== "다이쿄초";
        if (isSameDayCreated) {
            try {
                await sendSameDayBookingAlert(afterData);
            } catch (error) {
                console.warn(`[Reservation Reconcile] same-day alert failed for ${bookingId}:`, error.message);
            }
        }

        if (mutationSummary.eventType === "cancelled") {
            try {
                await sendCancelAlert(afterData);
            } catch (error) {
                console.warn(`[Reservation Reconcile] cancel alert failed for ${bookingId}:`, error.message);
            }
        }
    }
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
    if (count > 0) {
        try {
            await markHomeDashboardSummaryDirty(db, {
                companyId,
                reason: syncMode || "reservation_upsert",
                source: syncSource || "reservation_upsert"
            });
        } catch (summaryErr) {
            console.warn("[HomeDashboardSummary] mark dirty failed after upsert:", summaryErr.message);
        }
    }
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
    const cancelledItems = [];
    const automationMutations = [];

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
                    cancelledItems.push(cancelledDoc);
                    automationMutations.push({
                        beforeData: existingData,
                        afterData: cancelledDoc,
                        mutationSummary: buildReservationMutationSummary(existingData, cancelledDoc)
                    });

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

    if (cancelledCount > 0) {
        try {
            await markHomeDashboardSummaryDirty(db, {
                companyId,
                reason: "reconcile_cancelled",
                source: syncSource || "reservation_reconcile"
            });
        } catch (summaryErr) {
            console.warn("[HomeDashboardSummary] mark dirty failed after reconcile cancel:", summaryErr.message);
        }
    }

    return {
        cancelledCount,
        cancelledItems,
        automationMutations,
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

async function refreshHomeDashboardSummarySafe(companyId, reason, source) {
    if (!companyId) return;
    try {
        await refreshHomeDashboardSummary(db, {
            companyId,
            buildingRooms: BUILDING_ROOMS,
            excludedBuildingName: HOME_DASHBOARD_EXCLUDED_BUILDING,
            referenceOnlyBuildingName: HOME_DASHBOARD_REFERENCE_ONLY_BUILDING,
            reason,
            source
        });
    } catch (summaryErr) {
        console.warn("[HomeDashboardSummary] refresh failed:", summaryErr.message);
    }
}


// ==========================================
// 4) EXPORTS
// ==========================================

// 빠른 동기화 (기본) - 과거 6개월 ~ 향후 12개월
// ★ 순차 호출로 변경되어 타임아웃 증가
exports.syncBeds24 = onRequest({ cors: true, timeoutSeconds: 540, memory: "16GiB", cpu: 4, maxInstances: 4 }, async (req, res) => {
    try {
        const companyId = req.body?.companyId || DEFAULT_COMPANY_ID;
        const tokyoNow = dayjs().utcOffset(9);
        const syncWindow = getReservationSyncWindow(tokyoNow);
        const requestBudget = createBeds24RequestBudget();
        // 수동 Quick Sync는 사용자 기대(전체 재대사·삭제 반영)에 맞춰 항상 전체 fetch 후 재대사. 증분 미사용.
        await assertBeds24PropertyCoverage();
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
        await runReservationReconcileAlertFallbacks(result.automationMutations || [], companyId);
        const recentListQuick = [...list, ...(result.cancelledItems || [])].filter((r) => {
            const d = r.arrival || r.departure || r.bookDate || "";
            const dt = String(d).slice(0, 10);
            return dt >= fourteenDaysAgoQuick && dt <= fourteenDaysLaterQuick;
        });
        try {
            await scheduleOutputUpdates(recentListQuick.map((item) => buildReservationOutputImpact(item)));
        } catch (e) {
            console.warn("[Manual Quick Sync] Output update failed:", e.message);
        }
        await refreshHomeDashboardSummarySafe(companyId, "manual_quick_sync", "syncBeds24");
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
    schedule: "30 3 * * 0",
    timeZone: "Asia/Tokyo",
    timeoutSeconds: 540,
    memory: "4GiB",
    cpu: 4,
    maxInstances: 1
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

exports.triggerBeds24PropertySync = onRequest({ cors: true, timeoutSeconds: 540, memory: "16GiB", cpu: 4, maxInstances: 4 }, async (req, res) => {
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
exports.syncBeds24Full = onRequest({ cors: true, timeoutSeconds: 900, memory: "16GiB", cpu: 4, maxInstances: 2 }, async (req, res) => {
    if (req.method !== "POST") {
        return res.status(405).json({ success: false, error: "POST required" });
    }

    const companyId = String(req.body?.companyId || "").trim();
    if (!companyId || companyId !== DEFAULT_COMPANY_ID) {
        return res.status(403).json({ success: false, error: "Valid companyId required" });
    }

    const lockOwner = `manual_full_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    let lockAcquired = false;
    try {
        const lock = await acquireReservationFullSyncLock(lockOwner);
        if (!lock.acquired) {
            return res.status(409).json({
                success: false,
                error: "A full reservation sync is already running",
                lockExpiresAt: lock.expiresAt?.toISOString?.() || null
            });
        }
        lockAcquired = true;
        const syncRangeStart = "2023-01-01"; // 다시 2023년부터
        const syncRangeEnd = dayjs().add(24, "month").format("YYYY-MM-DD");
        const requestBudget = createBeds24RequestBudget();
        await assertBeds24PropertyCoverage();
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
        await runReservationReconcileAlertFallbacks(result.automationMutations || [], companyId);
        const recentListFull = [...list, ...(result.cancelledItems || [])].filter((r) => {
            const d = r.arrival || r.departure || r.bookDate || "";
            const dt = String(d).slice(0, 10);
            return dt >= fourteenDaysAgoFull && dt <= fourteenDaysLaterFull;
        });
        try {
            await scheduleOutputUpdates(recentListFull.map((item) => buildReservationOutputImpact(item)));
        } catch (e) {
            console.warn("[Manual Full Sync] Output update failed:", e.message);
        }
        await refreshHomeDashboardSummarySafe(companyId, "manual_full_sync", "syncBeds24Full");
        res.json({ success: true, message: `전체 동기화 완료! ${result.upsertedCount}건 저장됨 (2023년~향후 24개월)`, ...result, companyId });
    } catch (e) {
        console.error("Full Sync Failed:", e.message);
        await recordReservationSyncAudit({
            syncType: "manual_full",
            status: "error",
            syncSource: "beds24_manual_full",
            companyId,
            errorMessage: e.message
        });
        res.status(500).json({ success: false, error: e.message });
    } finally {
        if (lockAcquired) {
            try {
                await releaseReservationFullSyncLock(lockOwner);
            } catch (lockError) {
                console.warn("Full Sync lock release failed:", lockError.message);
            }
        }
    }
});

exports.refreshHomeDashboardSummary = onRequest({ cors: true, timeoutSeconds: 180, memory: "512MiB" }, async (req, res) => {
    try {
        if (req.method !== "POST") {
            return res.status(400).json({ success: false, error: "POST required" });
        }

        const companyId = req.body?.companyId || DEFAULT_COMPANY_ID;
        const summary = await refreshHomeDashboardSummary(db, {
            companyId,
            buildingRooms: BUILDING_ROOMS,
            excludedBuildingName: HOME_DASHBOARD_EXCLUDED_BUILDING,
            referenceOnlyBuildingName: HOME_DASHBOARD_REFERENCE_ONLY_BUILDING,
            reason: req.body?.reason || "manual_request",
            source: req.body?.source || "refreshHomeDashboardSummary"
        });

        return res.json({
            success: true,
            companyId,
            computedAtMs: summary.computedAtMs,
            reservationCount: summary.sourceReservationCount
        });
    } catch (error) {
        console.error("[HomeDashboardSummary] manual refresh failed:", error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
});

exports.scheduledRefreshHomeDashboardSummary = onSchedule({
    schedule: "*/5 * * * *",
    timeZone: "Asia/Tokyo",
    timeoutSeconds: 240,
    memory: "512MiB"
}, async () => {
    const results = await processDirtyHomeDashboardSummaries(db, {
        buildingRooms: BUILDING_ROOMS,
        excludedBuildingName: HOME_DASHBOARD_EXCLUDED_BUILDING,
        referenceOnlyBuildingName: HOME_DASHBOARD_REFERENCE_ONLY_BUILDING,
        limit: 10
    });

    if (results.length > 0) {
        console.log("[HomeDashboardSummary] scheduled refresh results:", JSON.stringify(results));
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

const PRICE_JOB_EXECUTION_LOCK_TTL_MS = 5 * 60 * 1000;
async function acquirePriceJobExecutionLock(lockedBy = "priceJobWorker") {
    const lockRef = db.collection("sync_status").doc("price_job_execution_lock");
    try {
        let acquired = false;
        let ageMinutes = null;
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(lockRef);
            if (snap.exists) {
                const lockTime = snap.data()?.lockedAt?.toDate() || new Date(0);
                const diffMs = Date.now() - lockTime.getTime();
                if (diffMs < PRICE_JOB_EXECUTION_LOCK_TTL_MS) {
                    ageMinutes = diffMs / (1000 * 60);
                    acquired = false;
                    return;
                }
            }
            tx.set(lockRef, {
                lockedAt: admin.firestore.FieldValue.serverTimestamp(),
                status: "running",
                lockedBy
            });
            acquired = true;
        });
        return { acquired, ageMinutes };
    } catch (e) {
        console.error(`[PriceJobLock] acquire failed (${lockedBy}):`, e.message);
        return { acquired: false, ageMinutes: null, error: e };
    }
}
async function releasePriceJobExecutionLock() {
    try {
        await db.collection("sync_status").doc("price_job_execution_lock").delete();
    } catch (e) {
        console.warn("[PriceJobLock] release failed:", e.message);
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
async function getNextQueuedPriceJobHint({ excludeJobIds = [] } = {}) {
    const excludedSet = new Set((excludeJobIds || []).map((id) => String(id)));
    const snap = await db.collection("beds24_price_jobs")
        .where("status", "==", "queued")
        .orderBy("createdAt")
        .limit(Math.max(1, excludedSet.size + 1))
        .get();

    for (const jobDoc of snap.docs) {
        if (excludedSet.has(String(jobDoc.id))) continue;
        const jobData = jobDoc.data() || {};
        return {
            id: String(jobDoc.id),
            companyId: jobData.companyId || null,
            building: jobData.building || null,
            roomIds: Array.isArray(jobData.roomIds) ? jobData.roomIds.map(String) : []
        };
    }

    return null;
}

async function shouldYieldToQueuedPriceJob({ reason = "scheduled", throttleState = null, intervalMs = 5000, excludeJobIds = [] } = {}) {
    if (reason !== "scheduled") return null;

    const now = Date.now();
    if (throttleState && typeof throttleState.lastCheckedAt === "number" && (now - throttleState.lastCheckedAt) < intervalMs) {
        return null;
    }
    if (throttleState) {
        throttleState.lastCheckedAt = now;
    }

    return await getNextQueuedPriceJobHint({ excludeJobIds });
}

async function beds24GetV2WithRetry(endpoint, params, attempts = 5, axiosOptions = {}) {
    for (let i = 0; i < attempts; i++) {
        try {
            const token = await getBeds24Token();
            const response = await axios.get(`https://beds24.com/api/v2${endpoint}`, {
                headers: { "token": token },
                params: params,
                ...axiosOptions
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

/**
 * GET /inventory/rooms/calendar 를 페이지 끝까지 읽어 roomId별로 병합한다.
 *
 * 배치 조회는 20객실 × 12개월을 한 번에 요청하므로 응답이 한 페이지를 넘을 수 있다.
 * 이 프로젝트의 다른 Beds24 V2 호출은 모두 pages.nextPageExists를 처리하는데
 * 가격 캘린더 조회만 빠져 있었고, 잘린 뒤쪽은 조용히 사라져 영구 미동기화가 됐다.
 *
 * @returns {{ roomsById: Map<string, {roomId, calendar: []}>, pageCount: number, truncated: boolean }}
 */
async function beds24GetRoomCalendarAllPages(params, { maxPages = 20, label = "calendar" } = {}) {
    const roomsById = new Map();
    let nextLink = null;
    let pageCount = 0;
    let lastError = null;

    while (pageCount < maxPages) {
        let result;
        if (nextLink) {
            const token = await getBeds24Token();
            const pageRes = await axios.get(nextLink, { headers: { token } });
            result = pageRes.data;
        } else {
            const res = await beds24GetV2WithGuard("/inventory/rooms/calendar", params, 5, {
                paramsSerializer: beds24RepeatParamsSerializer
            });
            result = res.data;
        }
        pageCount++;

        if (result?.error) lastError = result.error;

        const rows = Array.isArray(result?.data) ? result.data : [];
        rows.forEach((roomData) => {
            const rid = String(roomData?.roomId || "");
            if (!rid) return;
            const existing = roomsById.get(rid);
            if (existing) {
                // 같은 roomId가 여러 페이지에 걸쳐 오면 calendar를 이어 붙인다.
                existing.calendar = existing.calendar.concat(Array.isArray(roomData.calendar) ? roomData.calendar : []);
            } else {
                roomsById.set(rid, {
                    ...roomData,
                    roomId: rid,
                    calendar: Array.isArray(roomData.calendar) ? [...roomData.calendar] : []
                });
            }
        });

        if (!result?.pages?.nextPageExists || !result?.pages?.nextPageLink) {
            return { roomsById, pageCount, truncated: false, error: lastError };
        }
        nextLink = result.pages.nextPageLink;
        await sleep(200);
    }

    // maxPages를 다 쓰고도 다음 페이지가 남아 있으면 결과가 불완전하다는 뜻이다. 조용히 넘기지 않는다.
    console.warn(`[Beds24 Calendar] ${label}: ${maxPages}페이지를 초과해 응답이 잘렸습니다. 결과 불완전.`);
    return { roomsById, pageCount, truncated: true, error: lastError };
}

// Beds24는 minStay가 설정되지 않은 날짜를 "빈칸"으로 반환하며, 이는 1박을 의미한다.
// 이를 빈 문자열로 저장하면 프론트의 활성 roomId 판정(1 <= m < 50)과 setMinStay의
// getActiveRoomId가 NaN을 만나 해당 roomId를 "비활성"으로 오인한다.
// 그 결과 ① minStay 재수정이 통째로 스킵되고 ② 듀얼룸에서 그 roomId의 blackout이 화면에서 누락된다.
// 따라서 캐시에는 항상 1 이상의 숫자 문자열로 정규화해 저장/응답한다.
/**
 * price_change_logs 기록. priceSnapshot이 크면 여러 문서로 나눠 쓴다.
 *
 * 한 번의 가격 수정이 수천 건(최대 91객실 × 365일)을 담을 수 있는데,
 * priceSnapshot을 한 문서에 몰아넣으면 Firestore 문서 1MB 상한을 넘겨 로그가 통째로 유실된다.
 * 잘라내지 않고 분할하므로 이력 커버리지는 그대로 유지된다.
 */
const PRICE_LOG_SNAPSHOT_CHUNK_SIZE = 2000;

async function writePriceChangeLogChunks(baseDoc, priceSnapshot = []) {
    const snapshot = Array.isArray(priceSnapshot) ? priceSnapshot : [];
    if (snapshot.length === 0) {
        await db.collection("price_change_logs").add(baseDoc);
        return 1;
    }

    const chunkCount = Math.ceil(snapshot.length / PRICE_LOG_SNAPSHOT_CHUNK_SIZE);
    for (let i = 0; i < chunkCount; i++) {
        const chunk = snapshot.slice(i * PRICE_LOG_SNAPSHOT_CHUNK_SIZE, (i + 1) * PRICE_LOG_SNAPSHOT_CHUNK_SIZE);
        const chunkDoc = {
            ...baseDoc,
            priceSnapshot: chunk,
            totalChangeCount: snapshot.length
        };

        // 분할할 때는 rooms / dateFrom / dateTo 도 그 청크 내용으로 좁힌다.
        // 그러지 않으면 가격→예약 전환 판정(priceAttribution)이 이 청크에 없는 객실에 대해
        // 전체 날짜 범위로 폴백해, 실제로 바꾸지 않은 날짜까지 "가격 덕분에 팔림"으로 오인한다.
        if (chunkCount > 1) {
            const chunkRooms = [...new Set(chunk.map((row) => row?.room).filter(Boolean))];
            const chunkDates = chunk.map((row) => row?.date).filter(Boolean).sort();
            if (chunkRooms.length > 0) chunkDoc.rooms = chunkRooms;
            if (chunkDates.length > 0) {
                chunkDoc.dateFrom = chunkDates[0];
                chunkDoc.dateTo = chunkDates[chunkDates.length - 1];
            }
            chunkDoc.chunkIndex = i;
            chunkDoc.chunkCount = chunkCount;
        }

        await db.collection("price_change_logs").add(chunkDoc);
    }
    if (chunkCount > 1) {
        console.log(`[PriceChangeLog] ${snapshot.length}건을 ${chunkCount}개 문서로 분할 기록`);
    }
    return chunkCount;
}

function normalizeBeds24MinStay(rawMinStay) {
    const parsed = parseInt(rawMinStay, 10);
    return Number.isFinite(parsed) && parsed >= 1 ? String(parsed) : "1";
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
        if (val.m !== undefined) updateItem.minStay = parseInt(val.m, 10);
        if (val.mx !== undefined) updateItem.maxStay = parseInt(val.mx, 10);
        if (val.na !== undefined) updateItem.numAvail = parseInt(val.na, 10);
        if (val.ov !== undefined) updateItem.override = val.ov || null;
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

// 여러 roomId를 반복 파라미터(roomId=A&roomId=B)로 직렬화 — Beds24 GET 배치 지원 형식.
// (axios 기본 배열 직렬화 roomId[]= 는 Beds24가 전체 객실을 반환하므로 사용 불가. 검증 완료)
function beds24RepeatParamsSerializer(params) {
    const parts = [];
    Object.entries(params).forEach(([k, v]) => {
        if (Array.isArray(v)) v.forEach((item) => parts.push(`${k}=${encodeURIComponent(item)}`));
        else if (v !== undefined && v !== null) parts.push(`${k}=${encodeURIComponent(v)}`);
    });
    return parts.join("&");
}

async function beds24GetV2WithGuard(endpoint, params, attempts = 5, axiosOptions = {}) {
    try {
        const response = await beds24GetV2WithRetry(endpoint, params, attempts, axiosOptions);
        const creditRemaining = parseInt(response.headers?.["x-five-min-limit-remaining"], 10);
        const resetInSec = parseInt(response.headers?.["x-five-min-limit-resets-in"], 10);
        if (Number.isFinite(creditRemaining) && creditRemaining < BEDS24_API_LOW_CREDIT_THRESHOLD) {
            await activateBeds24ApiGuard({
                reason: "low_credit_get",
                resetInSec,
                creditRemaining,
                endpoint,
                method: "GET",
                fallbackSec: 30
            });
        }
        return response;
    } catch (err) {
        const errorStr = String(err?.message || err?.response?.data?.error || "").toLowerCase();
        const isRateLimit = err?.isRateLimit || err?.response?.status === 429 || errorStr.includes("limit exceeded") || errorStr.includes("too many requests");
        if (isRateLimit) {
            const resetInSec = parseInt(err.response?.headers?.["x-five-min-limit-resets-in"], 10);
            await activateBeds24ApiGuard({
                reason: "rate_limit_get",
                resetInSec,
                endpoint,
                method: "GET",
                fallbackSec: 60
            });
        }
        throw err;
    }
}

async function beds24PostV2WithGuard(endpoint, data, attempts = 3) {
    try {
        const response = await beds24PostV2WithRetry(endpoint, data, attempts);
        const creditRemaining = parseInt(response.headers?.["x-five-min-limit-remaining"], 10);
        const resetInSec = parseInt(response.headers?.["x-five-min-limit-resets-in"], 10);
        if (Number.isFinite(creditRemaining) && creditRemaining < BEDS24_API_LOW_CREDIT_THRESHOLD) {
            await activateBeds24ApiGuard({
                reason: "low_credit_post",
                resetInSec,
                creditRemaining,
                endpoint,
                method: "POST",
                fallbackSec: 30
            });
        }
        return response;
    } catch (err) {
        const errorStr = String(err?.message || err?.response?.data?.error || "").toLowerCase();
        const isRateLimit = err?.isRateLimit || err?.response?.status === 429 || errorStr.includes("limit exceeded") || errorStr.includes("too many requests");
        if (isRateLimit) {
            const resetInSec = parseInt(err.response?.headers?.["x-five-min-limit-resets-in"], 10);
            await activateBeds24ApiGuard({
                reason: "rate_limit_post",
                resetInSec,
                endpoint,
                method: "POST",
                fallbackSec: 60
            });
        }
        throw err;
    }
}

// 가격 데이터 동기화 함수 (Firestore 캐싱)
// ==========================================
async function syncAllPrices({
    forceFull = false,
    reason = "scheduled",
    targetBuildings = null
} = {}) {
    const apiGuard = await getBeds24ApiGuardState();
    if (apiGuard.active) {
        console.log(`[V2 Sync] Beds24 API cooldown active (${apiGuard.remainingSec}s remaining)`);
        return {
            skipped: true,
            reason: "beds24_api_cooldown",
            cooldownRemainingSec: apiGuard.remainingSec
        };
    }
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
        const isTargetedSync = Array.isArray(targetBuildings) && targetBuildings.length > 0;

        // firestore 저장용 키 생성 (YYYYMMDD) 헬퍼
        const toKey = (d) => d.replace(/-/g, '');

        console.log(`[V2 Bulletproof Sync] 시작: ${fromDate} ~ ${toDate} (${runFullSync ? "full" : "incremental"})`);
        const syncResults = {};
        let requestedRooms = 0;
        let syncedRooms = 0;
        let skippedRooms = 0;
        const touchedBuildings = [];
        const priorityCheckState = { lastCheckedAt: 0 };
        let yieldedToManualJob = null;

        buildingLoop:
        for (const prop of PROPERTIES) {
            const queuedPriceJob = await shouldYieldToQueuedPriceJob({ reason, throttleState: priorityCheckState, intervalMs: 1500 });
            if (queuedPriceJob) {
                yieldedToManualJob = queuedPriceJob;
                console.log(`[V2 Sync] yielding to queued manual price job ${queuedPriceJob.id} before building sync`);
                break;
            }
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
            const reservationInvalidatedRoomIds = new Set(
                (buildingCache.reservationInvalidatedRoomIds || []).map((id) => String(id))
            );
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

            // [Cache Protection] 최근 15분 내 수동 수정된 방을 병렬로 확인해 제외
            const protectionChecks = await Promise.all(roomsToFetch.map((room) =>
                buildingRef.collection("rooms").doc(String(room.roomId)).get()
                    .then((snap) => ({ room, snap }))
                    .catch(() => ({ room, snap: null }))
            ));
            const roomsToActuallyFetch = [];
            // 위 protectionChecks가 이미 읽어온 스냅샷을 재사용해 이전 가격을 보관한다.
            // 스케줄 동기화로만 들어온 Beds24 가격 변경도 lm(셀 dot/이력)과 price_change_logs에 남기기 위함이며,
            // Firestore 읽기는 한 건도 늘지 않는다.
            const previousDatesByRoomId = {};
            for (const { room, snap } of protectionChecks) {
                if (snap && snap.exists) {
                    previousDatesByRoomId[String(room.roomId)] = snap.data()?.dates || {};
                    const lastUserUpdate = snap.data()?.lastManualUpdate?.toDate() || null;
                    if (lastUserUpdate && dayjs().diff(dayjs(lastUserUpdate), 'minute') < 15) {
                        console.log(`[Price Sync Skip] ${buildingName} - ${room.name}(${room.roomId}): 최근 수동 수정됨`);
                        skippedRooms++;
                        continue;
                    }
                }
                roomsToActuallyFetch.push(room);
            }
            // 이 건물에서 이번 동기화로 감지된 가격 변동 (price_change_logs 기록용)
            const scheduledPriceDiffs = [];

            // ★ 배치 GET: 여러 roomId를 한 번에 조회 (객실당 1콜 → 청크당 1콜, 크레딧·시간 대폭 절감)
            const PRICE_SYNC_GET_BATCH_SIZE = 20;
            for (let ci = 0; ci < roomsToActuallyFetch.length; ci += PRICE_SYNC_GET_BATCH_SIZE) {
                const queuedDuringRoomLoop = await shouldYieldToQueuedPriceJob({ reason, throttleState: priorityCheckState, intervalMs: 1500 });
                if (queuedDuringRoomLoop) {
                    yieldedToManualJob = queuedDuringRoomLoop;
                    console.log(`[V2 Sync] yielding to queued manual price job ${queuedDuringRoomLoop.id} during ${buildingName}`);
                    break buildingLoop;
                }

                const chunk = roomsToActuallyFetch.slice(ci, ci + PRICE_SYNC_GET_BATCH_SIZE);
                const chunkRoomIds = chunk.map((room) => String(room.roomId));
                const roomById = new Map(chunk.map((room) => [String(room.roomId), room]));

                let pageResult;
                try {
                    // ★ V2 API 호출 (GET /inventory/rooms/calendar) — roomId 배열 + 반복 파라미터 직렬화로 다중 객실 일괄 조회.
                    // includePrices 필수! 없으면 가격 데이터가 반환되지 않음.
                    // 20객실 × 12개월은 한 페이지를 넘을 수 있어 반드시 끝까지 읽는다.
                    pageResult = await beds24GetRoomCalendarAllPages({
                        roomId: chunkRoomIds,
                        startDate: fromDate,
                        endDate: toDate,
                        includePrices: true,
                        includeLinkedPrices: true,
                        includeMinStay: true,
                        includeMaxStay: true,
                        includeNumAvail: true,
                        includeOverride: true
                    }, { label: `${buildingName} batch [${chunkRoomIds.join(",")}]` });
                } catch (err) {
                    console.error(`[Price Sync Fatal] ${buildingName} batch [${chunkRoomIds.join(",")}]:`, err.message);
                    await new Promise(r => setTimeout(r, 500));
                    continue;
                }

                // V2 응답 구조: { data: [{ roomId, calendar: [{ from, to, price1, minStay, ... }] }, ...] }
                const entries = [...pageResult.roomsById.values()];
                if (entries.length === 0 && pageResult.error) {
                    console.error(`[Price Sync Error] ${buildingName} batch: ${pageResult.error}`);
                }
                // 응답이 잘렸으면 이 배치는 저장하지 않는다.
                // 불완전한 데이터를 캐시에 쓰면 Beds24에 있는 날짜가 "없는 날짜"로 굳어버린다.
                if (pageResult.truncated) {
                    console.error(`[Price Sync] ${buildingName} batch [${chunkRoomIds.join(",")}] 응답 잘림 — 저장 skip (다음 주기 재시도)`);
                    await new Promise(r => setTimeout(r, 500));
                    continue;
                }

                // 각 객실 데이터를 병렬로 파싱·저장 (서로 다른 room 문서/month 캐시라 충돌 없음)
                await Promise.all(entries.map(async (roomData) => {
                    const rid = String(roomData.roomId);
                    const room = roomById.get(rid);
                    if (!room || !Array.isArray(roomData.calendar)) return;

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
                                m: normalizeBeds24MinStay(entry.minStay),
                                mx: String(entry.maxStay || ""),
                                na: entry.numAvail !== undefined && entry.numAvail !== null ? String(entry.numAvail) : "",
                                ov: entry.override ? String(entry.override) : ""
                            };
                        }
                    });

                    // 이전 가격과 비교해 변동을 감지한다.
                    // 웹훅이 누락된 Beds24 변경은 이 스케줄 동기화로만 들어오는데,
                    // 여기서 lm을 남기지 않으면 캘린더 이력이 이전 변경에 멈춰 잘못된 정보를 보여준다.
                    const previousDates = previousDatesByRoomId[rid] || {};
                    const nowFormattedForLm = dayjs().utcOffset(9).format("MM-DD HH:mm");
                    Object.keys(datesObj).forEach((dateKey) => {
                        const oldP1 = parseFloat(previousDates[dateKey]?.p1) || 0;
                        const newP1 = parseFloat(datesObj[dateKey].p1) || 0;
                        if (oldP1 === newP1 || (oldP1 === 0 && newP1 === 0)) return;
                        datesObj[dateKey].lm = {
                            u: "Beds24",
                            t: nowFormattedForLm,
                            o: oldP1,
                            n: newP1,
                            s: "beds24",
                            ts: Date.now()
                        };
                        scheduledPriceDiffs.push({
                            date: `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`,
                            room: room.name,
                            oldPrice: oldP1,
                            newPrice: newP1
                        });
                    });

                    try {
                        // 원자적 개별 저장 (Atomic Storage) — dates는 deep-merge라 기존 lm(source dot) 보존 (기존 동작과 동일)
                        await buildingRef.collection("rooms").doc(rid).set({
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
                        await mergePriceSyncMonthCache(buildingName, rid, room.name, datesObj, { cacheComplete: true });
                        successInBuilding++;
                        syncedRooms++;
                        syncedRoomIds.add(rid);
                    } catch (writeErr) {
                        console.error(`[Price Sync Write Fatal] ${buildingName} - ${rid}:`, writeErr.message);
                    }
                }));

                // 청크 간 throttle (객실당이 아니라 청크당 → 호출/대기 횟수 대폭 감소)
                await new Promise(r => setTimeout(r, 500));
            }

            // 스케줄 동기화로 감지된 가격 변동을 이력에 남긴다.
            // 지금까지는 priceWebhook과 가격 job만 로그를 써서, 웹훅이 누락된 변경은 이력에 전혀 남지 않았다.
            if (scheduledPriceDiffs.length > 0) {
                try {
                    scheduledPriceDiffs.sort((a, b) => a.date.localeCompare(b.date));
                    const avgOld = Math.round(scheduledPriceDiffs.reduce((s, d) => s + d.oldPrice, 0) / scheduledPriceDiffs.length);
                    const avgNew = Math.round(scheduledPriceDiffs.reduce((s, d) => s + d.newPrice, 0) / scheduledPriceDiffs.length);
                    await writePriceChangeLogChunks({
                        companyId: prop.companyId || DEFAULT_COMPANY_ID,
                        timestamp: admin.firestore.FieldValue.serverTimestamp(),
                        building: buildingName,
                        rooms: [...new Set(scheduledPriceDiffs.map((d) => d.room))],
                        success: true,
                        worker: "Beds24 System",
                        origin: "Beds24 Scheduled Sync",
                        notes: `정기 동기화에서 ${buildingName} 가격 변동 ${scheduledPriceDiffs.length}건 감지`,
                        oldPrice: avgOld,
                        newPrice: avgNew,
                        dateFrom: scheduledPriceDiffs[0].date,
                        dateTo: scheduledPriceDiffs[scheduledPriceDiffs.length - 1].date
                    }, scheduledPriceDiffs);
                    console.log(`[Price Sync] ${buildingName} 가격 변동 ${scheduledPriceDiffs.length}건 로그 기록`);
                } catch (logErr) {
                    console.warn(`[Price Sync] ${buildingName} price_change_logs 기록 실패:`, logErr.message);
                }
            }

            const buildingFullComplete = runFullSync && successInBuilding === roomsToFetch.length;
            const remainingInvalidatedRoomIds = runFullSync
                ? roomsToFetch.map((room) => String(room.roomId)).filter((id) => !syncedRoomIds.has(id))
                : [...invalidatedRoomIds].filter((id) => !syncedRoomIds.has(String(id)));
            const remainingReservationInvalidatedRoomIds = [...reservationInvalidatedRoomIds]
                .filter((id) => !syncedRoomIds.has(String(id)));

            // 건물 요약 정보 업데이트
            await buildingRef.set({
                building: buildingName,
                lastSync: admin.firestore.FieldValue.serverTimestamp(),
                lastIncrementalSync: runFullSync ? buildingCache.lastIncrementalSync || null : admin.firestore.FieldValue.serverTimestamp(),
                lastFullSync: buildingFullComplete
                    ? admin.firestore.FieldValue.serverTimestamp()
                    : (buildingCache.lastFullSync || null),
                roomCount: successInBuilding,
                targetRoomCount: roomsToFetch.length,
                dateFrom: fromDate,
                dateTo: toDate,
                outputImpact: buildPriceOutputImpact({ building: buildingName, fromDate, toDate }),
                invalidatedRoomIds: remainingInvalidatedRoomIds,
                pendingInvalidationCount: remainingInvalidatedRoomIds.length,
                reservationInvalidatedRoomIds: remainingReservationInvalidatedRoomIds,
                pendingReservationInvalidationCount: remainingReservationInvalidatedRoomIds.length,
                invalidatedAt: remainingInvalidatedRoomIds.length > 0
                    ? (buildingCache.invalidatedAt || admin.firestore.FieldValue.serverTimestamp())
                    : admin.firestore.FieldValue.delete(),
                invalidatedBy: remainingInvalidatedRoomIds.length > 0
                    ? (buildingCache.invalidatedBy || "priceWebhook")
                    : admin.firestore.FieldValue.delete(),
                reservationInvalidatedAt: remainingReservationInvalidatedRoomIds.length > 0
                    ? (buildingCache.reservationInvalidatedAt || admin.firestore.FieldValue.serverTimestamp())
                    : admin.firestore.FieldValue.delete()
            }, { merge: true });

            syncResults[buildingName] = {
                success: runFullSync ? buildingFullComplete : successInBuilding === roomsToFetch.length,
                rooms: successInBuilding,
                targetRooms: roomsToFetch.length,
                mode: runFullSync ? (buildingFullComplete ? "full" : "full_partial") : "incremental"
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
                note: yieldedToManualJob
                    ? `price incremental yielded to queued manual job: ${yieldedToManualJob.id}`
                    : "price incremental skipped: no invalidated rooms",
                metadata: yieldedToManualJob
                    ? { runFullSync, touchedBuildings: [], yieldedToManualJobId: yieldedToManualJob.id }
                    : { runFullSync, touchedBuildings: [] },
                updateStatusDoc: false
            });
            return {
                skipped: true,
                mode: "incremental",
                rooms: 0,
                yieldedToManualJobId: yieldedToManualJob?.id || null
            };
        }

        const fullComplete = runFullSync && !yieldedToManualJob && skippedRooms === 0 && syncedRooms === requestedRooms;
        await recordPriceSyncAudit({
            syncType: reason,
            syncVariant: runFullSync
                ? (fullComplete ? "full_reconcile" : "full_reconcile_partial")
                : "incremental",
            status: runFullSync && !fullComplete ? "partial" : "success",
            syncSource: runFullSync ? "beds24_price_full_reconcile" : "beds24_price_incremental",
            companyId: DEFAULT_COMPANY_ID,
            fetchedCount: requestedRooms,
            upsertedCount: syncedRooms,
            note: `mode=${runFullSync ? "full" : "incremental"}, skipped=${skippedRooms}${yieldedToManualJob ? `, yielded=${yieldedToManualJob.id}` : ""}`,
            metadata: {
                touchedBuildings,
                requestedRooms,
                syncedRooms,
                skippedRooms,
                fullComplete,
                yieldedToManualJobId: yieldedToManualJob?.id || null
            },
            updateStatusDoc: !isTargetedSync
        });

        console.log(`[V2 Sync] 전체 완료:`, syncResults);
        return {
            success: true,
            mode: runFullSync ? (fullComplete ? "full" : "full_partial") : "incremental",
            fullComplete,
            requestedRooms,
            syncedRooms,
            skippedRooms,
            yieldedToManualJobId: yieldedToManualJob?.id || null,
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
// Targeted minStay recovery helper. Scheduled minStay protection is handled by
// the six-hour full price reconcile, which already fetches m/mx in bulk.
// ==========================================
async function syncMinStayOnly({ reason = "scheduled", targetBuildings = null } = {}) {
    const apiGuard = await getBeds24ApiGuardState();
    if (apiGuard.active) {
        console.log(`[MinStay Reconcile] Beds24 API cooldown active (${apiGuard.remainingSec}s remaining)`);
        return {
            skipped: true,
            reason: "beds24_api_cooldown",
            cooldownRemainingSec: apiGuard.remainingSec
        };
    }
    if (reason === "scheduled") {
        const queuedPriceJob = await getNextQueuedPriceJobHint();
        if (queuedPriceJob) {
            console.log(`[MinStay Reconcile] yielded to queued manual price job ${queuedPriceJob.id} before lock acquire`);
            return {
                skipped: true,
                reason: "yield_to_manual_job",
                yieldedToManualJobId: queuedPriceJob.id
            };
        }
    }

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
        const priorityCheckState = { lastCheckedAt: 0 };
        let yieldedToManualJob = null;

        buildingLoop:
        for (const prop of PROPERTIES) {
            const queuedPriceJob = await shouldYieldToQueuedPriceJob({ reason, throttleState: priorityCheckState, intervalMs: 1500 });
            if (queuedPriceJob) {
                yieldedToManualJob = queuedPriceJob;
                console.log(`[MinStay Reconcile] yielding to queued manual price job ${queuedPriceJob.id} before building sync`);
                break;
            }
            if (prop.disabled) continue;
            if (Array.isArray(targetBuildings) && targetBuildings.length > 0 && !targetBuildings.includes(prop.name)) {
                continue;
            }
            const buildingName = prop.name;
            const allRooms = BUILDING_ROOMS[buildingName] || [];
            if (allRooms.length === 0) continue;

            const buildingRef = db.collection("price_sync").doc(buildingName);
            let updatedInBuilding = 0;
            touchedBuildings.push(buildingName);

            for (const room of allRooms) {
                const queuedDuringRoomLoop = await shouldYieldToQueuedPriceJob({ reason, throttleState: priorityCheckState, intervalMs: 1500 });
                if (queuedDuringRoomLoop) {
                    yieldedToManualJob = queuedDuringRoomLoop;
                    console.log(`[MinStay Reconcile] yielding to queued manual price job ${queuedDuringRoomLoop.id} during ${buildingName}/${room.roomId}`);
                    break buildingLoop;
                }
                const rid = String(room.roomId);
                try {
                    // includePrices: false 로 경량화. Beds24 V2는 includeMinStay 독립 지원.
                    // 만약 minStay 필드가 반환되지 않으면 includePrices: true 로 변경 필요.
                    const pageResult = await beds24GetRoomCalendarAllPages({
                        roomId: rid,
                        startDate: fromDate,
                        endDate: toDate,
                        includePrices: false,
                        includeLinkedPrices: false,
                        includeMinStay: true,
                        includeMaxStay: true
                    }, { label: `minStay reconcile ${buildingName}/${rid}` });

                    if (pageResult.truncated) {
                        console.error(`[MinStay Reconcile] ${buildingName}/${rid} 응답 잘림 — 갱신 skip`);
                        totalSkipped++;
                        continue;
                    }

                    const roomData = pageResult.roomsById.get(rid);
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
                            updateMap[`dates.${dateKey}.m`] = normalizeBeds24MinStay(entry.minStay);
                            updateMap[`dates.${dateKey}.mx`] = String(entry.maxStay || "");
                            datesPatch[dateKey] = {
                                m: normalizeBeds24MinStay(entry.minStay),
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
                        await mergePriceSyncMonthCache(buildingName, rid, room.name, datesPatch);
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
            note: `minStay-only reconcile, skipped=${totalSkipped}${yieldedToManualJob ? `, yielded=${yieldedToManualJob.id}` : ""}`,
            metadata: {
                touchedBuildings,
                totalFetched,
                totalUpdated,
                totalSkipped,
                yieldedToManualJobId: yieldedToManualJob?.id || null
            }
        });

        console.log(`[MinStay Reconcile] 완료: fetched=${totalFetched}, updated=${totalUpdated}, skipped=${totalSkipped}`);
        return {
            success: true,
            totalFetched,
            totalUpdated,
            totalSkipped,
            yieldedToManualJobId: yieldedToManualJob?.id || null
        };

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

// 수동 가격 동기화 (HTTP 호출용, 단일 건물만 허용)
exports.triggerPriceSync = onRequest({ cors: true, timeoutSeconds: 540, memory: "16GiB", cpu: 4, maxInstances: 4 }, async (req, res) => {
    try {
        const companyId = String(req.body?.companyId || "").trim();
        const building = String(req.body?.building || "").trim();
        if (!companyId) {
            return res.status(400).json({ success: false, error: "Missing companyId" });
        }
        if (companyId !== DEFAULT_COMPANY_ID) {
            return res.status(403).json({ success: false, error: "Access denied: companyId mismatch" });
        }
        if (!building) {
            return res.status(400).json({ success: false, error: "Missing building" });
        }

        const targetProperty = PROPERTIES.find((property) => property.name === building && !property.disabled);
        if (!targetProperty) {
            return res.status(400).json({ success: false, error: `Unknown or disabled building: ${building}` });
        }

        console.log(`[Manual Trigger] 단일 건물 가격 동기화 시작: ${building}`);
        const result = await syncAllPrices({
            forceFull: true,
            reason: "manual_targeted",
            targetBuildings: [building]
        });
        res.json({ success: true, message: `${building} 가격 동기화 완료`, building, result });
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
    let incrementalMutations = [];
    try {
        incrementalMutations = await collectReservationMutations(incrementalList);
    } catch (error) {
        console.warn("[Scheduled Reservation Reconcile] mutation pre-read failed:", error.message);
        await sendSyncAlert("scheduledBeds24Sync automation fallback pre-read failed", [error.message]);
    }
    try {
        await invalidatePriceCacheForReservationMutations(
            incrementalMutations,
            companyId,
            "beds24_scheduled_daily_incremental"
        );
    } catch (error) {
        console.warn("[Scheduled Reservation Reconcile] price cache invalidation failed:", error.message);
        await sendSyncAlert("scheduledBeds24Sync price cache invalidation failed", [error.message]);
    }
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
    await runReservationReconcileAlertFallbacks(incrementalMutations, companyId);

    let fullList = [];
    let fullResult = null;
    let fullAuditError = null;
    const shouldRunDeepAudit = forceFull || shouldRunFullAudit(statusData, {
        intervalMinutes: RESERVATION_FULL_RECONCILE_INTERVAL_MINUTES,
        now: tokyoNow.toDate()
    });

    if (shouldRunDeepAudit) {
        try {
            await assertBeds24PropertyCoverage();
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
            await runReservationReconcileAlertFallbacks(fullResult.automationMutations || [], companyId);

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
        } catch (error) {
            fullAuditError = error;
            fullList = [];
            fullResult = null;
            await recordReservationSyncAudit({
                syncType: "scheduled_daily",
                syncVariant: "full_reconcile",
                status: "error",
                syncSource: "beds24_scheduled_daily_window",
                companyId,
                rangeStart: syncWindow.start,
                rangeEnd: syncWindow.end,
                errorMessage: error.message,
                note: "full reconcile skipped destructive changes because coverage was incomplete"
            });
            await sendSyncAlert("scheduledBeds24Sync full reconcile failed", [
                `companyId=${companyId}`,
                error.message
            ]);
        }
    }

    const fourteenDaysAgo = tokyoNow.subtract(14, "day").format("YYYY-MM-DD");
    const fourteenDaysLater = tokyoNow.add(14, "day").format("YYYY-MM-DD");
    const impactMap = new Map();
    [...incrementalList, ...fullList, ...(fullResult?.cancelledItems || [])].forEach((item) => {
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
        ranFullAudit: Boolean(fullResult),
        fullAuditError: fullAuditError?.message || null
    };
}

// Webhooks are primary. One hourly batched GET recovers dropped events before
// they can be omitted from time-sensitive Slack/Google automations.
exports.scheduledBeds24Sync = onSchedule({
    schedule: "5 * * * *",
    timeZone: "Asia/Tokyo",
    timeoutSeconds: 540,
    memory: "4GiB",
    cpu: 4,
    maxInstances: 1
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
    memory: "16GiB",
    cpu: 4
}, async () => {
    const tokyoNow = dayjs().utcOffset(9);
    try {
        const queuedPriceJob = await getNextQueuedPriceJobHint();
        if (queuedPriceJob) {
            await recordPriceSyncAudit({
                syncType: "scheduled",
                status: "skipped",
                syncVariant: "yield_to_manual_job",
                syncSource: "beds24_scheduled_prices",
                companyId: DEFAULT_COMPANY_ID,
                note: `yielded to queued manual price job ${queuedPriceJob.id}`,
                metadata: {
                    queuedJobId: queuedPriceJob.id,
                    queuedJobBuilding: queuedPriceJob.building || null,
                    queuedJobCompanyId: queuedPriceJob.companyId || null
                },
                updateStatusDoc: false
            });
            console.log(`[scheduledBeds24PriceSync] yielded to queued manual price job ${queuedPriceJob.id}`);
            return;
        }
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

// minStay is included in the six-hour full price reconcile. Keep this targeted
// manual trigger only for recovery/testing without restoring per-room polling.
exports.triggerMinStaySync = onRequest({ cors: true, timeoutSeconds: 540, memory: "16GiB", cpu: 4, maxInstances: 4 }, async (req, res) => {
    try {
        if (req.method !== "POST") {
            return res.status(400).json({ success: false, error: "POST required" });
        }

        const companyId = String(req.body?.companyId || "").trim();
        const building = String(req.body?.building || "").trim();
        if (!companyId) {
            return res.status(400).json({ success: false, error: "Missing companyId" });
        }
        if (companyId !== DEFAULT_COMPANY_ID) {
            return res.status(403).json({ success: false, error: "Access denied: companyId mismatch" });
        }
        if (!building) {
            return res.status(400).json({ success: false, error: "Missing building" });
        }

        const targetProperty = PROPERTIES.find((property) => property.name === building && !property.disabled);
        if (!targetProperty) {
            return res.status(400).json({ success: false, error: `Unknown or disabled building: ${building}` });
        }

        console.log(`[Manual Trigger] 단일 건물 minStay 동기화 시작: ${building}`);
        const result = await syncMinStayOnly({ reason: "manual_targeted", targetBuildings: [building] });
        res.json({ success: true, message: `${building} minStay 동기화 완료`, building, result });
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
const REVIEW_RETENTION_DAYS = 90;

function toReviewDateKey(value) {
    if (!value) return null;
    if (typeof value?.toDate === "function") {
        const d = value.toDate();
        return dayjs(d).isValid() ? dayjs(d).format("YYYY-MM-DD") : null;
    }
    const s = String(value).trim();
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    const d = dayjs(s);
    return d.isValid() ? d.format("YYYY-MM-DD") : null;
}

async function cleanupOldReviews(companyId, cutoffDate = null) {
    const cutoffDateKey = cutoffDate || dayjs().utcOffset(9).subtract(REVIEW_RETENTION_DAYS, "day").format("YYYY-MM-DD");
    const snap = await db.collection("reviews").where("companyId", "==", companyId).get();
    const staleRefs = [];

    snap.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const dateKey = data.createdDateKey || toReviewDateKey(data.createdAt);
        if (dateKey && dateKey < cutoffDateKey) staleRefs.push(docSnap.ref);
    });

    const CHUNK = 400;
    for (let i = 0; i < staleRefs.length; i += CHUNK) {
        const wb = db.batch();
        staleRefs.slice(i, i + CHUNK).forEach((ref) => wb.delete(ref));
        await wb.commit();
    }

    console.log(`[reviewsRetention] companyId=${companyId}, cutoff=${cutoffDateKey}, deleted=${staleRefs.length}`);
    return staleRefs.length;
}

// booking 리뷰에 예약 컨텍스트(linkedRoom/Arrival/Departure/Building) 보강
async function enrichBookingReviewsWithReservationContext(companyId, batchItems) {
    const targets = batchItems.filter(item =>
        item.data.channel === "booking" && item.data.reservationId
    );
    console.log(`[enrichReviews] 대상 booking 리뷰: ${targets.length}건`);
    if (!targets.length) return;

    // reservationId 중복 제거 후 10개씩 Firestore 'in' 쿼리
    const allIds = [...new Set(targets.map(item => String(item.data.reservationId)))];
    const reservationIndex = {};
    const ID_CHUNK = 10;
    for (let i = 0; i < allIds.length; i += ID_CHUNK) {
        const chunk = allIds.slice(i, i + ID_CHUNK);
        try {
            const snap = await db.collection("reservations")
                .where("companyId", "==", companyId)
                .where("bookId", "in", chunk)
                .get();
            snap.docs.forEach(doc => {
                const d = doc.data();
                if (d.bookId) reservationIndex[String(d.bookId)] = d;
            });
        } catch (e) {
            console.warn(`[enrichReviews] reservations 조회 실패 (chunk ${i}):`, e.message);
        }
    }

    // 매칭 → batch update
    let matched = 0, skipped = 0;
    const updates = [];
    for (const item of targets) {
        const resId = String(item.data.reservationId);
        const res = reservationIndex[resId];
        if (!res) { skipped++; continue; }
        updates.push({
            id: item.id,
            fields: {
                linkedRoom: res.room || null,
                linkedArrival: res.arrival || null,
                linkedDeparture: res.departure || null,
                linkedBuilding: res.building || null,
                linkedAt: admin.firestore.FieldValue.serverTimestamp()
            }
        });
        matched++;
    }

    const WRITE_CHUNK = 400;
    for (let i = 0; i < updates.length; i += WRITE_CHUNK) {
        const chunk = updates.slice(i, i + WRITE_CHUNK);
        const wb = db.batch();
        for (const u of chunk) {
            wb.update(db.collection("reviews").doc(u.id), u.fields);
        }
        await wb.commit();
    }
    console.log(`[enrichReviews] 매칭 성공: ${matched}건, 실패(스킵): ${skipped}건`);
}

function normalizeApiReference(ref) {
    return String(ref || "").toLowerCase().replace(/[\s\-]/g, "");
}

async function enrichAirbnbReviewsWithReservationContext(companyId, batchItems) {
    // building + reservationId 모두 유효한 항목만 대상
    const targets = batchItems.filter(item =>
        item.data.channel === "airbnb" &&
        item.data.reservationId &&
        item.data.building
    );
    console.log(`[enrichAirbnbReviews] 대상 airbnb 리뷰: ${targets.length}건`);
    if (!targets.length) return;

    // 인덱스 구축: 1차(apiReference in) + 2차 폴백(building+date-window)
    const allIds = [...new Set(targets.map(item => String(item.data.reservationId)))];
    const reservationIndex = {};        // `${building}__${normApiRef}` → d[]
    const reservationIndexByApiRef = {}; // `${normApiRef}` → d[]
    const seenDocIds = new Set();       // 1차/2차 중복 방지
    const ID_CHUNK = 10;
    let phase1CandidatesFetched = 0, phase2FallbackFetched = 0;

    // 공통 인덱스 등록 헬퍼 (doc.id 기준 dedupe)
    const addToIndex = (doc) => {
        if (seenDocIds.has(doc.id)) return;
        seenDocIds.add(doc.id);
        const d = doc.data();
        if (!d.apiReference || !d.building) return;
        const normApiKey = normalizeApiReference(d.apiReference);
        const compKey = `${d.building}__${normApiKey}`;
        if (!reservationIndex[compKey]) reservationIndex[compKey] = [];
        reservationIndex[compKey].push(d);
        if (!reservationIndexByApiRef[normApiKey]) reservationIndexByApiRef[normApiKey] = [];
        reservationIndexByApiRef[normApiKey].push(d);
    };

    // 1차 조회: apiReference in 원본 reservationId (Firestore 정확 매칭)
    for (let i = 0; i < allIds.length; i += ID_CHUNK) {
        const chunk = allIds.slice(i, i + ID_CHUNK);
        try {
            const snap = await db.collection("reservations")
                .where("companyId", "==", companyId)
                .where("apiReference", "in", chunk)
                .get();
            snap.docs.forEach(doc => { addToIndex(doc); phase1CandidatesFetched++; });
        } catch (e) {
            console.warn(`[enrichAirbnbReviews] 1차 조회 실패 (chunk ${i}):`, e.message);
        }
    }

    // 2차 조회(폴백): 1차에서 정규화 키로도 못 찾은 타깃 → building + arrival 범위로 후보 확장
    // Firestore는 normalize 비교 불가이므로, 코드 레벨 normalizeApiReference 비교로 흡수
    const unmatchedNormIds = new Set(
        allIds
            .map(id => normalizeApiReference(id))
            .filter(normId => !reservationIndexByApiRef[normId])
    );
    if (unmatchedNormIds.size > 0) {
        const phase2Groups = {};
        for (const item of targets) {
            if (!unmatchedNormIds.has(normalizeApiReference(String(item.data.reservationId)))) continue;
            const b = String(item.data.building);
            const rawDate = item.data.createdAt;
            if (!rawDate) continue;
            const reviewDate = dayjs(String(rawDate).replace(" ", "T")).format("YYYY-MM-DD");
            if (reviewDate === "Invalid Date") continue;
            if (!phase2Groups[b]) phase2Groups[b] = { minDate: reviewDate, maxDate: reviewDate };
            if (reviewDate < phase2Groups[b].minDate) phase2Groups[b].minDate = reviewDate;
            if (reviewDate > phase2Groups[b].maxDate) phase2Groups[b].maxDate = reviewDate;
        }
        for (const [b, range] of Object.entries(phase2Groups)) {
            const fetchFrom = dayjs(range.minDate).subtract(7, "day").format("YYYY-MM-DD");
            const fetchTo = dayjs(range.maxDate).add(21, "day").format("YYYY-MM-DD");
            try {
                const snap = await db.collection("reservations")
                    .where("companyId", "==", companyId)
                    .where("building", "==", b)
                    .where("arrival", ">=", fetchFrom)
                    .where("arrival", "<=", fetchTo)
                    .get();
                snap.docs.forEach(doc => { addToIndex(doc); phase2FallbackFetched++; });
            } catch (e) {
                console.warn(`[enrichAirbnbReviews] 2차 조회 실패 (${b}):`, e.message);
            }
        }
    }
    const dedupedReservationCount = seenDocIds.size;

    let matchedPrimary = 0, matchedFallbackUnique = 0, matchedFallbackDateWindow = 0;
    let skippedAmbiguous = 0, skippedNoCandidate = 0, collision = 0;
    const updates = [];
    const matchedIds = new Set();

    const pushUpdate = (itemId, res) => {
        updates.push({
            id: itemId,
            fields: {
                linkedGuestName: res.guestName || null,
                reviewerName: res.guestName || null,
                linkedRoom: res.room || null,
                linkedArrival: res.arrival || null,
                linkedDeparture: res.departure || null,
                linkedBuilding: res.building || null,
                linkedAt: admin.firestore.FieldValue.serverTimestamp()
            }
        });
        matchedIds.add(itemId);
    };

    // Phase 1: building + apiReference 복합키 매칭 (정규화 키 조회)
    for (const item of targets) {
        const building = String(item.data.building);
        const compKey = `${building}__${normalizeApiReference(item.data.reservationId)}`;
        const candidates = reservationIndex[compKey];
        if (!candidates || candidates.length === 0) continue;
        let res = candidates[0];
        if (candidates.length > 1) {
            collision++;
            res = candidates.reduce((best, cur) => {
                if (!best.arrival) return cur;
                if (!cur.arrival) return best;
                return cur.arrival > best.arrival ? cur : best;
            }, candidates[0]);
        }
        pushUpdate(item.id, res);
        matchedPrimary++;
    }

    // Phase 2: apiReference 단독 유니크 매칭 — 정규화 키 조회 (정확히 1건일 때만)
    for (const item of targets) {
        if (matchedIds.has(item.id)) continue;
        const fallback = reservationIndexByApiRef[normalizeApiReference(item.data.reservationId)] || [];
        if (fallback.length === 1) {
            pushUpdate(item.id, fallback[0]);
            matchedFallbackUnique++;
        }
    }

    // Phase 3: date-window 폴백 (arrival ±7일 fetch → arrival <= reviewDate <= departure+14일 필터)
    const unmatchedTargets = targets.filter(item => !matchedIds.has(item.id));
    if (unmatchedTargets.length > 0) {
        // 건물별 그룹핑 + reviewDate 범위 계산
        const buildingGroups = {};
        for (const item of unmatchedTargets) {
            const rawDate = item.data.createdAt;
            if (!rawDate) continue;
            const reviewDate = dayjs(String(rawDate).replace(" ", "T")).format("YYYY-MM-DD");
            if (reviewDate === "Invalid Date") continue;
            const b = String(item.data.building);
            if (!buildingGroups[b]) buildingGroups[b] = { items: [], minDate: reviewDate, maxDate: reviewDate };
            buildingGroups[b].items.push({ item, reviewDate });
            if (reviewDate < buildingGroups[b].minDate) buildingGroups[b].minDate = reviewDate;
            if (reviewDate > buildingGroups[b].maxDate) buildingGroups[b].maxDate = reviewDate;
        }

        // 건물별 reservations fetch (arrival 범위로 쿼리, 나머지 메모리 필터)
        const buildingReservations = {};
        for (const [b, group] of Object.entries(buildingGroups)) {
            const fetchFrom = dayjs(group.minDate).subtract(7, "day").format("YYYY-MM-DD");
            const fetchTo = dayjs(group.maxDate).add(21, "day").format("YYYY-MM-DD");
            try {
                const snap = await db.collection("reservations")
                    .where("companyId", "==", companyId)
                    .where("building", "==", b)
                    .where("arrival", ">=", fetchFrom)
                    .where("arrival", "<=", fetchTo)
                    .get();
                buildingReservations[b] = snap.docs
                    .map(d => d.data())
                    .filter(d => d.arrival && d.departure && d.guestName);
            } catch (e) {
                console.warn(`[enrichAirbnbReviews] date-window 조회 실패 (${b}):`, e.message);
                buildingReservations[b] = [];
            }
        }

        for (const [b, group] of Object.entries(buildingGroups)) {
            const allRes = buildingReservations[b] || [];
            for (const { item, reviewDate } of group.items) {
                if (matchedIds.has(item.id)) continue;
                const resId = String(item.data.reservationId || "");
                const normResId = normalizeApiReference(resId);

                // 조건: arrival <= reviewDate <= departure + 14일
                const candidates = allRes.filter(r => {
                    const dep14 = dayjs(r.departure).add(14, "day").format("YYYY-MM-DD");
                    return r.arrival <= reviewDate && dep14 >= reviewDate;
                });

                if (candidates.length === 0) { skippedNoCandidate++; continue; }

                if (candidates.length === 1) {
                    pushUpdate(item.id, candidates[0]);
                    matchedFallbackDateWindow++;
                    continue;
                }

                // 다중 후보 — 우선순위 1: apiReference 정규화 일치
                const normMatches = candidates.filter(r =>
                    r.apiReference && normalizeApiReference(r.apiReference) === normResId
                );
                if (normMatches.length === 1) {
                    pushUpdate(item.id, normMatches[0]);
                    matchedFallbackDateWindow++;
                    continue;
                }
                if (normMatches.length > 1) { skippedAmbiguous++; continue; }

                // 우선순위 2: reviewDate에 arrival이 가장 가까운 것 (2일 이상 우위여야 확신)
                const sorted = [...candidates].sort((a, c) => {
                    const da = Math.abs(dayjs(a.arrival).diff(dayjs(reviewDate), "day"));
                    const dc = Math.abs(dayjs(c.arrival).diff(dayjs(reviewDate), "day"));
                    return da - dc;
                });
                const d1 = Math.abs(dayjs(sorted[0].arrival).diff(dayjs(reviewDate), "day"));
                const d2 = Math.abs(dayjs(sorted[1].arrival).diff(dayjs(reviewDate), "day"));
                if (d2 - d1 > 2) {
                    pushUpdate(item.id, sorted[0]);
                    matchedFallbackDateWindow++;
                } else {
                    skippedAmbiguous++;
                }
            }
        }
    }

    // batch write
    const WRITE_CHUNK = 400;
    for (let i = 0; i < updates.length; i += WRITE_CHUNK) {
        const chunk = updates.slice(i, i + WRITE_CHUNK);
        const wb = db.batch();
        for (const u of chunk) {
            wb.update(db.collection("reviews").doc(u.id), u.fields);
        }
        await wb.commit();
    }
    const totalMatched = matchedPrimary + matchedFallbackUnique + matchedFallbackDateWindow;
    const unmatchedFinal = targets.length - totalMatched;
    console.log(`[enrichAirbnbReviews] fetched(raw=${phase1CandidatesFetched} fallback=${phase2FallbackFetched} deduped=${dedupedReservationCount}) matched(primary=${matchedPrimary} unique=${matchedFallbackUnique} date=${matchedFallbackDateWindow}) unmatched=${unmatchedFinal}`);
}

async function syncAllReviews(companyId, fromDate = null, options = {}) {
    const { insertOnly = false, toDate = null } = options;
    const tokyoNow = dayjs().utcOffset(9);
    if (!fromDate) fromDate = tokyoNow.subtract(REVIEW_RETENTION_DAYS, "day").format("YYYY-MM-DD");
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
                            hasReply: !!(review.reply && (review.reply.text || review.reply.message || review.reply.last_change_timestamp)),
                            reply: review.reply || null,
                            replyAt: review.reply?.last_change_timestamp || null,
                            createdAt: review.created_timestamp || null,
                            createdDateKey: toReviewDateKey(review.created_timestamp),
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
                        const _catAlias = {
                            "check_in": "checkin", "check-in": "checkin", "check in": "checkin",
                            "cleanliness_rating": "cleanliness",
                        };
                        const _stdKeys = new Set(["cleanliness", "accuracy", "checkin", "communication", "location", "value"]);
                        const cats = {};
                        if (Array.isArray(review.category_ratings)) {
                            for (const c of review.category_ratings) {
                                const rawKey = String(c.category || "").toLowerCase().trim();
                                if (!rawKey) continue;
                                const aliased = _catAlias[rawKey];
                                const stripped = rawKey.replace(/[\s\-_]+/g, "");
                                const key = aliased || (_stdKeys.has(stripped) ? stripped : null) || rawKey;
                                cats[key] = c.rating;
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
                                hasReply: !!(review.reviewee_response || review.responded_at),
                                reply: review.reviewee_response || null,
                                replyAt: review.responded_at || null,
                                createdAt: review.submitted_at || review.first_completed_at || null,
                                createdDateKey: toReviewDateKey(review.submitted_at || review.first_completed_at),
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
    // 카테고리 정합성 검증 로그 (batch 완성 후 write 전, 1회 실행)
    const _REVIEW_REQUIRED_KEYS = {
        booking: ["clean", "comfort", "facilities", "staff", "value", "location"],
        airbnb:  ["cleanliness", "accuracy", "checkin", "communication", "location", "value"],
    };
    function collectCategoryStats(items) {
        const acc = {
            booking: { reviews: 0, keyCounts: {}, missing: 0 },
            airbnb:  { reviews: 0, keyCounts: {}, missing: 0 },
        };
        for (const { data } of items) {
            const s = acc[data.channel];
            if (!s) continue;
            s.reviews++;
            const cats = data.categories || {};
            for (const [k, v] of Object.entries(cats)) {
                if (v !== null && v !== undefined) s.keyCounts[k] = (s.keyCounts[k] || 0) + 1;
            }
            const required = _REVIEW_REQUIRED_KEYS[data.channel] || [];
            if (required.some(rk => cats[rk] === null || cats[rk] === undefined)) s.missing++;
        }
        const out = {};
        for (const [ch, s] of Object.entries(acc)) {
            out[ch] = {
                reviews: s.reviews,
                keyCounts: s.keyCounts,
                missing: s.missing,
                missingRate: s.reviews > 0 ? +(s.missing / s.reviews).toFixed(3) : 0,
            };
        }
        return out;
    }
    const _catStats = collectCategoryStats(batch);
    console.log("[syncReviews][validation]", JSON.stringify(_catStats));

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
        // 예약 컨텍스트 보강 (오류 시 전체 실패 방지)
        try {
            await enrichBookingReviewsWithReservationContext(companyId, batch);
        } catch (e) {
            console.warn("[syncReviews] booking enrichment 실패:", e.message);
        }
        try {
            await enrichAirbnbReviewsWithReservationContext(companyId, batch);
        } catch (e) {
            console.warn("[syncReviews] airbnb enrichment 실패:", e.message);
        }
        return batch.length;
    }
}

// 리뷰 풀 재대사: Beds24 전체 목록 vs Firestore 비교 → 삭제된 리뷰 하드 삭제
async function reconcileReviews(companyId) {
    const beds24ReviewIds = new Set();
    let completeTraversal = true;

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
                if (!result || !Array.isArray(result.data)) {
                    completeTraversal = false;
                    hasMore = false;
                    break;
                }
                if (result.data.length === 0) {
                    hasMore = false;
                    break;
                }
                result.data.forEach(r => beds24ReviewIds.add(`booking_${r.review_id}`));
                if (result.pages?.nextPageExists) {
                    const lastTs = result.data[result.data.length - 1].created_timestamp;
                    const lastDate = lastTs ? lastTs.split(" ")[0] : null;
                    if (lastDate && lastDate !== pageFrom) { pageFrom = lastDate; pageCount++; }
                    else {
                        completeTraversal = false;
                        hasMore = false;
                    }
                } else { hasMore = false; }
                await new Promise(r => setTimeout(r, 300));
            }
            if (hasMore) {
                completeTraversal = false;
                console.warn(`[reconcileReviews] Booking.com ${prop.name} page cap reached; deletion disabled`);
            }
        } catch (err) {
            completeTraversal = false;
            console.warn(`[reconcileReviews] Booking.com ${prop.name} 실패:`, err.message);
        }
        await new Promise(r => setTimeout(r, 300));
    }

    // Airbnb 전체 리뷰 ID 수집
    for (const [buildingName, rooms] of Object.entries(BUILDING_ROOMS)) {
        const prop = PROPERTIES.find((item) => item.name === buildingName);
        if (!prop || prop.disabled) continue;
        for (const room of rooms) {
            try {
                let nextLink = null;
                let hasMore = true;
                let pageCount = 0;
                while (hasMore && pageCount < 20) {
                    let result;
                    if (nextLink) {
                        const token = await getBeds24Token();
                        const pageResponse = await axios.get(nextLink, { headers: { token } });
                        result = pageResponse.data;
                    } else {
                        const response = await beds24GetV2WithRetry("/channels/airbnb/reviews", {
                            roomId: parseInt(room.roomId)
                        });
                        result = response.data;
                    }
                    if (!result || !Array.isArray(result.data)) {
                        completeTraversal = false;
                        break;
                    }
                    result.data.forEach((review) => beds24ReviewIds.add(`airbnb_${review.id}`));
                    nextLink = result.pages?.nextPageExists ? result.pages?.nextPageLink : null;
                    hasMore = Boolean(nextLink);
                    pageCount++;
                    if (hasMore) await new Promise((resolve) => setTimeout(resolve, 300));
                }
                if (hasMore) {
                    completeTraversal = false;
                    console.warn(`[reconcileReviews] Airbnb ${buildingName}/${room.name} page cap reached; deletion disabled`);
                }
            } catch (err) {
                if (err.response?.status !== 400) {
                    completeTraversal = false;
                    console.warn(`[reconcileReviews] Airbnb ${room.name} 실패:`, err.message);
                }
            }
            await new Promise(r => setTimeout(r, 200));
        }
    }

    if (!completeTraversal) {
        console.warn("[reconcileReviews] Partial Beds24 traversal detected; local review deletion skipped");
        return 0;
    }

    // Firestore에서 삭제된 리뷰 찾아서 하드 삭제
    const firestoreSnap = await db.collection("reviews").where("companyId", "==", companyId).get();
    const activeReviewBuildings = new Set(PROPERTIES.filter((prop) => !prop.disabled).map((prop) => prop.name));
    const toDelete = firestoreSnap.docs.filter((docSnap) => {
        const building = docSnap.data()?.building;
        return activeReviewBuildings.has(building) && !beds24ReviewIds.has(docSnap.id);
    });
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
        console.log(`[UnifiedSync] 예약 batch fetch: ${arrivalFrom} ~ ${arrivalTo}${isLegacyRange ? " [legacy mode]" : ""}`);
        const allBookings = await fetchAllBookingsFromProperties(
            PROPERTIES,
            { arrivalFrom, arrivalTo },
            { legacyMode: isLegacyRange }
        );
        console.log(`[UnifiedSync] 예약 fetch 완료: ${allBookings.length}건`);
        const reservationResult = await incrementalReservationSync(allBookings, companyId, "unified_sync");
        console.log(`✅ [UnifiedSync] 예약 완료: ${reservationResult.upsertedCount}건`);

        // 2. 리뷰 동기화 — 과거 데이터 모드에서는 스킵 (Airbnb 리뷰가 roomId별 65회+ 호출로 타임아웃 유발)
        let reviewCount = 0;
        let prunedReviews = 0;
        if (!isLegacyRange) {
            reviewCount = await syncAllReviews(companyId, fromDate, { insertOnly: true, toDate: arrivalTo });
            prunedReviews = await cleanupOldReviews(companyId);
            console.log(`✅ [UnifiedSync] 리뷰 완료: ${reviewCount}건 신규`);
        } else {
            console.log(`⏭️ [UnifiedSync] 리뷰 동기화 스킵 (과거 데이터 모드)`);
        }

        res.json({
            success: true,
            reservations: { upserted: reservationResult.upsertedCount },
            reviews: { inserted: reviewCount, pruned: prunedReviews }
        });
    } catch (err) {
        console.error("[unifiedSync] 실패:", err);
        res.status(500).json({ error: err.message });
    }
});

// Reviews have no supported webhook in the Beds24 V2 docs. Poll once daily;
// review data is not operationally time-critical like bookings/inventory.
exports.scheduledReviewsSync = onSchedule({
    schedule: "15 4 * * *",
    timeZone: "Asia/Tokyo",
    timeoutSeconds: 540,
    memory: "512MiB"
}, async () => {
    const companyId = DEFAULT_COMPANY_ID;
    const count = await syncAllReviews(companyId);
    const pruned = await cleanupOldReviews(companyId);
    console.log(`✅ 리뷰 증분 동기화 완료: ${count}건, 정리: ${pruned}건 (${dayjs().utcOffset(9).format("YYYY-MM-DD HH:mm")})`);
});

// Weekly safety reconcile. Destructive pruning runs only after a complete
// Beds24 traversal; partial API results must never delete local review data.
exports.scheduledReviewsReconcile = onSchedule({
    schedule: "45 4 * * 0",
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

    // arrival/departure를 각각 equality로 좁혀 병렬 조회 (전체 confirmed 스캔 제거).
    // 기존 복합 인덱스 (companyId,status,arrival),(companyId,status,departure) 재사용 — 인덱스 추가 불필요.
    const base = db.collection("reservations")
        .where("companyId", "==", companyId)
        .where("status", "==", "confirmed");

    const [arrSnap, depSnap] = await Promise.all([
        base.where("arrival", "==", date).get(),
        base.where("departure", "==", date).get()
    ]);

    // arrival==date 와 departure==date 양쪽에 걸리는 문서는 id로 dedup
    const byId = new Map();
    arrSnap.forEach((d) => byId.set(d.id, d.data()));
    depSnap.forEach((d) => byId.set(d.id, d.data()));

    res.json({ success: true, data: [...byId.values()] });
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
        { roomId: "502229", name: "501호" }, { roomId: "383975", name: "501호" },
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
        { roomId: "648398", name: "803호" }, { roomId: "624198", name: "803호" }
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
    "STAY ARI Apartment Hotel": [
        { roomId: "708662", name: "101" }, { roomId: "708663", name: "102" },
        { roomId: "708632", name: "103" }, { roomId: "708635", name: "105" },
        { roomId: "708636", name: "106" }, { roomId: "708637", name: "107" },
        { roomId: "708638", name: "108" }, { roomId: "708642", name: "109" },
        { roomId: "708643", name: "110" }, { roomId: "708664", name: "201" },
        { roomId: "708665", name: "202" }, { roomId: "708644", name: "203" },
        { roomId: "708645", name: "205" }, { roomId: "708646", name: "206" },
        { roomId: "708650", name: "207" }, { roomId: "708651", name: "208" },
        { roomId: "708652", name: "209" }, { roomId: "708653", name: "210" },
        { roomId: "708666", name: "302" }, { roomId: "708654", name: "303" },
        { roomId: "708656", name: "305" }, { roomId: "708657", name: "306" },
        { roomId: "708658", name: "307" }, { roomId: "708659", name: "308" },
        { roomId: "708660", name: "309" }, { roomId: "708661", name: "310" }
    ],
    "사노시": [{ roomId: "481152", name: "사노" }]
};

// Beds24 Daily Price links. Price writes must target the source price row,
// while inventory/min-stay writes must continue to target the active roomId.
// These links were verified against GET /properties?includePriceRules=true.
// A post-write readback below prevents a future Beds24 configuration change
// from being reported as a false success.
const BEDS24_PRICE_SOURCE_ROOM_ID = Object.freeze({
    "502229": "383975",
    "515300": "440617",
    "601545": "383971",
    "601546": "403542",
    "601547": "383972",
    "601548": "383978",
    "601549": "383974",
    "601550": "383976",
    "601551": "537451",
    "601552": "383973",
    "601553": "383977",
    "451220": "383979",
    "451223": "383982",
    "451224": "383983",
    "452061": "383980",
    "452062": "383981",
    "452063": "383984",
    "452064": "383985",
    "452065": "441885",
    "601560": "543189",
    "648398": "624198",
    "496532": "450096",
    "648399": "450096",
    "556719": "513700"
});

function getBeds24PriceSourceRoomId(roomId) {
    const roomIdStr = String(roomId || "");
    return BEDS24_PRICE_SOURCE_ROOM_ID[roomIdStr] || roomIdStr;
}

function getRelatedBeds24RoomIds(building, roomName, roomId = null) {
    const allRooms = BUILDING_ROOMS[building] || [];
    const normalizedRoomName = String(roomName || "");
    const relatedIds = allRooms
        .filter((room) => normalizedRoomName && room.name === normalizedRoomName)
        .map((room) => String(room.roomId));

    if (roomId != null && roomId !== "") relatedIds.push(String(roomId));
    const sourceIds = relatedIds.map((id) => getBeds24PriceSourceRoomId(id));
    return [...new Set([...relatedIds, ...sourceIds].filter(Boolean))];
}

function normalizeBeds24PriceWriteRoomUpdates(building, roomUpdates = []) {
    const updatesBySourceRoomId = new Map();

    roomUpdates.forEach((roomUpdate) => {
        const requestedRoomId = String(roomUpdate?.roomId || "");
        if (!requestedRoomId) return;

        const sourceRoomId = getBeds24PriceSourceRoomId(requestedRoomId);
        const roomName = roomUpdate?.roomName || getRoomNameByRoomId(requestedRoomId);
        const existing = updatesBySourceRoomId.get(sourceRoomId) || {
            roomId: sourceRoomId,
            roomName,
            dates: {},
            cacheRoomIds: []
        };

        existing.dates = { ...existing.dates, ...(roomUpdate?.dates || {}) };
        existing.cacheRoomIds = [...new Set([
            ...existing.cacheRoomIds,
            ...getRelatedBeds24RoomIds(building, roomName, requestedRoomId)
        ])];
        updatesBySourceRoomId.set(sourceRoomId, existing);
    });

    return [...updatesBySourceRoomId.values()].map((roomUpdate) => ({
        ...roomUpdate,
        calendarUpdates: buildBeds24CalendarUpdatesFromDates(roomUpdate.dates)
    }));
}

const HOME_DASHBOARD_EXCLUDED_BUILDING = PROPERTIES.find((property) => property.disabled)?.name || "";
const HOME_DASHBOARD_REFERENCE_ONLY_BUILDING = PROPERTIES[PROPERTIES.length - 1]?.name || "";

const {
    sendSyncAlert,
    buildAndSendSlackDailyReport,
    buildAndSendSlackCleaningReport,
    sendSlackCleaningReportCorrectionIfSent,
    scheduledSlackDailyReport,
    scheduledSlackDailyReportRetry,
    sendSlackDailyReportManual,
    scheduledHotelsmartCleaningPrefetch,
    scheduledSlackCleaningReport,
    scheduledSlackCleaningReportRetry,
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
    getEffectiveCompanyId,
    hotelsmartSecrets: HOTELSMART_SECRETS,
    authorizeInternalRequest: authorizeInternalAutomationRequest
});

const {
    collectHotelsmartCleaningAssignmentsManual,
} = createHotelsmartCleaningModule({
    onRequest,
    hotelsmartSecrets: HOTELSMART_SECRETS,
    authorizeInternalRequest: authorizeInternalAutomationRequest,
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
    BUILDING_ROOMS,
    assertReservationDataReady
});

// Beds24 ↔ price_sync 캐시 정합성 대조 (읽기 전용 — 쓰기 없음)
const { auditPriceConsistency } = createPriceConsistencyAuditModule({
    onRequest,
    db,
    dayjs,
    beds24GetRoomCalendarAllPages,
    normalizeBeds24MinStay,
    authorizeInternalRequest: authorizeInternalAutomationRequest,
    BUILDING_ROOMS,
    PROPERTIES,
    DEFAULT_COMPANY_ID
});
exports.auditPriceConsistency = auditPriceConsistency;

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
const ARAKICHO_A_501_DUAL_ROOM_IDS = ["502229", "383975"];

function normalizeRoomIdList(roomIds = []) {
    if (Array.isArray(roomIds)) return roomIds.map((rid) => String(rid));
    if (roomIds == null || roomIds === "") return [];
    return [String(roomIds)];
}

function shouldMergeArakichoA501PriceRoomIds({ building, roomName, roomIds = [] }) {
    const roomIdSet = new Set(normalizeRoomIdList(roomIds));
    return (building === "아라키초A" && roomName === "501호")
        || ARAKICHO_A_501_DUAL_ROOM_IDS.some((rid) => roomIdSet.has(rid));
}

function mergeArakichoA501PriceRoomIds(roomIds = []) {
    return [...new Set([...normalizeRoomIdList(roomIds), ...ARAKICHO_A_501_DUAL_ROOM_IDS])];
}

exports.setRoomPrices = onRequest({ cors: true, timeoutSeconds: 120, memory: "1GiB", cpu: 1, minInstances: 1, maxInstances: 4 }, async (req, res) => {
    try {
        const { companyId, roomId, roomIds, dates, building, worker, workerEmail, roomUpdates } = req.body;
        if (!companyId) return res.status(400).json({ success: false, error: "Missing companyId" });

        let effectiveBuilding = building || null;
        let normalizedRoomUpdates = [];
        if (Array.isArray(roomUpdates) && roomUpdates.length > 0) {
            roomUpdates.forEach((roomUpdate) => {
                const updateDates = roomUpdate?.dates || {};
                let updateRoomIds = normalizeRoomIdList(roomUpdate?.roomIds || (roomUpdate?.roomId ? [roomUpdate.roomId] : []));
                if (updateRoomIds.length === 0 || Object.keys(updateDates).length === 0) return;
                if (shouldMergeArakichoA501PriceRoomIds({ building: effectiveBuilding, roomName: roomUpdate?.roomName, roomIds: updateRoomIds })) {
                    updateRoomIds = mergeArakichoA501PriceRoomIds(updateRoomIds);
                    if (!effectiveBuilding) effectiveBuilding = "아라키초A";
                    console.log(`[setRoomPrices] 아라키초A 501호 듀얼 roomId 병합: ${updateRoomIds.join(", ")}`);
                }
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
            let inputRoomIds = normalizeRoomIdList(roomIds || (roomId ? [roomId] : []));
            if (inputRoomIds.length === 0 || !dates) {
                return res.status(400).json({ error: "Missing roomId/roomIds or dates" });
            }
            if (shouldMergeArakichoA501PriceRoomIds({ building: effectiveBuilding, roomIds: inputRoomIds })) {
                inputRoomIds = mergeArakichoA501PriceRoomIds(inputRoomIds);
                if (!effectiveBuilding) effectiveBuilding = "아라키초A";
                console.log(`[setRoomPrices] 아라키초A 501호 듀얼 roomId 병합: ${inputRoomIds.join(", ")}`);
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

        normalizedRoomUpdates = normalizeBeds24PriceWriteRoomUpdates(effectiveBuilding, normalizedRoomUpdates);

        if (normalizedRoomUpdates.length === 0) {
            return res.status(400).json({ success: false, error: "No valid room updates to queue" });
        }

        const activeRoomIds = [...new Set(normalizedRoomUpdates.map((item) => String(item.roomId)))];

        // Firestore에 price job 생성 — 즉시 Beds24 호출 없음
        const jobRef = await db.collection("beds24_price_jobs").add({
            companyId,
            building: effectiveBuilding,
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
            error: null,
            jobType: "price"
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

exports.triggerPriceJobNow = onRequest({ cors: true, timeoutSeconds: 540, memory: "16GiB", cpu: 4, maxInstances: 4 }, async (req, res) => {
    try {
        const { jobId, companyId } = req.body;
        if (!jobId || !companyId) {
            return res.status(400).json({ success: false, error: "Missing jobId or companyId" });
        }

        const jobRef = db.collection("beds24_price_jobs").doc(String(jobId));
        const jobSnap = await jobRef.get();
        if (!jobSnap.exists) {
            return res.status(404).json({ success: false, error: "Job not found" });
        }

        const jobData = jobSnap.data() || {};
        if (jobData.companyId !== companyId) {
            return res.status(403).json({ success: false, error: "Access denied: companyId mismatch" });
        }

        if (jobData.status !== "queued") {
            return res.json({
                success: true,
                triggered: false,
                jobId: String(jobId),
                status: jobData.status,
                skipped: true
            });
        }

        const result = await processPriceJob(String(jobId));
        const refreshedSnap = await jobRef.get();
        const refreshedData = refreshedSnap.exists ? (refreshedSnap.data() || {}) : {};

        res.json({
            success: true,
            triggered: !result?.skipped,
            jobId: String(jobId),
            status: refreshedData.status || result?.status || "queued",
            skipped: !!result?.skipped,
            reason: result?.reason || null,
            cooldownRemainingSec: result?.cooldownRemainingSec || null
        });
    } catch (e) {
        console.error("[triggerPriceJobNow] Error:", e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

function getPriceCacheMonthKeys(fromKey, toKey) {
    if (!fromKey || !toKey || fromKey > toKey) return [];
    const months = [];
    let cursor = dayjs(`${fromKey.slice(0, 4)}-${fromKey.slice(4, 6)}-01`);
    const end = dayjs(`${toKey.slice(0, 4)}-${toKey.slice(4, 6)}-01`);
    while (cursor.isValid() && (cursor.isBefore(end, "month") || cursor.isSame(end, "month"))) {
        months.push(cursor.format("YYYYMM"));
        cursor = cursor.add(1, "month");
    }
    return months;
}

function groupPriceDatesByMonth(datesObj = {}) {
    const grouped = {};
    Object.entries(datesObj || {}).forEach(([dateKey, value]) => {
        const monthKey = String(dateKey).slice(0, 6);
        if (!/^\d{6}$/.test(monthKey)) return;
        if (!grouped[monthKey]) grouped[monthKey] = {};
        grouped[monthKey][dateKey] = value;
    });
    return grouped;
}

async function mergePriceSyncMonthCache(building, roomId, roomName, datesObj = {}, { cacheComplete = false } = {}) {
    const grouped = groupPriceDatesByMonth(datesObj);
    const monthKeys = Object.keys(grouped);
    if (monthKeys.length === 0) return;

    const buildingRef = db.collection("price_sync").doc(building);
    const batch = db.batch();
    monthKeys.forEach((monthKey) => {
        const monthRef = buildingRef.collection("months").doc(monthKey);
        const roomPayload = {
            roomName,
            roomId: String(roomId),
            dates: grouped[monthKey],
            lastSyncRoom: admin.firestore.FieldValue.serverTimestamp()
        };
        if (cacheComplete) {
            roomPayload.cacheComplete = true;
        }

        batch.set(monthRef, {
            building,
            month: monthKey,
            rooms: {
                [String(roomId)]: roomPayload
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    });
    await batch.commit();
}

async function patchPriceSyncMonthCacheFields(building, roomId, roomName, dateFieldPatches = {}) {
    const grouped = groupPriceDatesByMonth(dateFieldPatches);
    const monthKeys = Object.keys(grouped);
    if (monthKeys.length === 0) return;

    const buildingRef = db.collection("price_sync").doc(building);
    for (const monthKey of monthKeys) {
        const monthRef = buildingRef.collection("months").doc(monthKey);
        await monthRef.set({
            building,
            month: monthKey,
            rooms: {
                [String(roomId)]: {
                    roomName,
                    roomId: String(roomId),
                    dates: {}
                }
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        const updates = {
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            [`rooms.${String(roomId)}.lastSyncRoom`]: admin.firestore.FieldValue.serverTimestamp()
        };
        Object.entries(grouped[monthKey]).forEach(([dateKey, fields]) => {
            Object.entries(fields || {}).forEach(([field, value]) => {
                updates[`rooms.${String(roomId)}.dates.${dateKey}.${field}`] = value;
            });
        });
        await monthRef.update(updates);
    }
}

async function readPriceSyncMonthCache({ buildingRef, building, fromKey, toKey, filterRoomDataByDateRange }) {
    const monthKeys = getPriceCacheMonthKeys(fromKey, toKey);
    if (monthKeys.length === 0) return { hit: false, priceData: {}, monthKeys };

    const monthRefs = monthKeys.map((monthKey) => buildingRef.collection("months").doc(monthKey));
    const monthSnaps = await db.getAll(...monthRefs);
    const existingSnaps = monthSnaps.filter((snap) => snap.exists);
    if (existingSnaps.length === 0) return { hit: false, priceData: {}, monthKeys };

    const priceData = {};
    existingSnaps.forEach((snap) => {
        const rooms = snap.data()?.rooms || {};
        Object.entries(rooms).forEach(([roomId, roomData]) => {
            if (!priceData[roomId]) {
                priceData[roomId] = {
                    roomName: roomData.roomName,
                    roomId: String(roomId),
                    dates: {}
                };
            }
            Object.assign(priceData[roomId].dates, roomData.dates || {});
        });
    });

    Object.keys(priceData).forEach((roomId) => {
        priceData[roomId] = filterRoomDataByDateRange(priceData[roomId]);
    });

    // [불변식] 월 캐시가 hit이면 rooms 서브컬렉션은 아예 읽지 않는다.
    // 따라서 price_sync/{building}/rooms/{roomId} 를 쓰는 코드는 반드시
    // mergePriceSyncMonthCache 또는 patchPriceSyncMonthCacheFields 도 함께 호출해야 한다.
    // 한쪽만 쓰면 그 변경은 화면에 영원히 반영되지 않는다.
    const expectedRoomIds = (BUILDING_ROOMS[building] || []).map((room) => String(room.roomId));
    const hasAllRequestedMonths = existingSnaps.length === monthKeys.length;
    const incompleteRoomIds = expectedRoomIds.filter((roomId) =>
        !existingSnaps.every((snap) => snap.data()?.rooms?.[roomId]?.cacheComplete === true)
    );
    const hasAllExpectedRooms = expectedRoomIds.length > 0 && incompleteRoomIds.length === 0;
    const hit = hasAllRequestedMonths && hasAllExpectedRooms;

    // miss가 계속되면 월 캐시가 사실상 죽은 것이다(매 요청마다 rooms 전체 조회).
    // 원인을 눈으로 확인할 수 있게 사유를 남긴다.
    if (!hit) {
        const reason = !hasAllRequestedMonths
            ? `월 문서 누락 (${existingSnaps.length}/${monthKeys.length})`
            : `cacheComplete 아닌 roomId ${incompleteRoomIds.length}개: ${incompleteRoomIds.slice(0, 5).join(",")}`;
        console.log(`[PriceCache] ${building} month cache miss — ${reason}`);
    }

    return { hit, priceData, monthKeys };
}

exports.getCachedPrices = onRequest({ cors: true, timeoutSeconds: 60, memory: "2GiB", cpu: 1, minInstances: 1, maxInstances: 12 }, async (req, res) => {
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
        const filterRoomDataByDateRange = (roomData) => {
            if (!useDateRangeFilter || !roomData?.dates) {
                return roomData;
            }
            const filteredDates = {};
            for (const [dateKey, dateValue] of Object.entries(roomData.dates)) {
                if (dateKey >= fromKey && dateKey <= toKey) {
                    filteredDates[dateKey] = dateValue;
                }
            }
            return {
                ...roomData,
                dates: filteredDates
            };
        };

        const docRef = db.collection("price_sync").doc(building);
        let doc = await docRef.get();

        if (!doc.exists) {
            return res.json({
                success: false,
                error: "캐시된 가격 데이터가 없습니다. 잠시 후 다시 시도해주세요.",
                noCache: true
            });
        }

        let docData = doc.data();
        if (docData.companyId && docData.companyId !== companyId) {
            return res.status(403).json({ success: false, error: "Access denied: companyId mismatch" });
        }

        const invalidatedRoomIds = [...new Set((docData.invalidatedRoomIds || []).map((id) => String(id)).filter(Boolean))];
        const reservationInvalidatedRoomIds = [
            ...new Set((docData.reservationInvalidatedRoomIds || []).map((id) => String(id)).filter(Boolean))
        ];
        const liveRoomDataById = {};
        const refreshInvalidatedRoomsDuringCacheRead = false;
        if (!refreshInvalidatedRoomsDuringCacheRead && invalidatedRoomIds.length > 0) {
            console.log(`[getCachedPrices] ${building} has ${invalidatedRoomIds.length} invalidated room(s); serving cached data without blocking on Beds24 live refresh`);
        }
        if (refreshInvalidatedRoomsDuringCacheRead && invalidatedRoomIds.length > 0) {
            const apiGuard = await getBeds24ApiGuardState();
            const roomNameById = {};
            (BUILDING_ROOMS[building] || []).forEach((room) => {
                roomNameById[String(room.roomId)] = room.name;
            });
            if (apiGuard.active) {
                console.log(`[getCachedPrices] Beds24 API cooldown active (${apiGuard.remainingSec}s remaining), serving cached data only`);
            } else {
                const { acquired } = await acquirePriceSyncLock("getCachedPrices");
                if (acquired) {
                    const syncedRoomIds = [];
                    try {
                        // 무효화된 객실들을 순차가 아닌 동시성 제한 병렬로 재싱크 → fetch(getCachedPrices) 지연 단축.
                        // 각 호출은 서로 다른 room 문서/month 캐시(rooms.{roomId})만 쓰므로 병렬 충돌 없음.
                        // Beds24 rate limit(기본 60/5분) 내에서 안전하도록 동시 호출 수 제한.
                        const GET_CACHED_SYNC_CONCURRENCY = 5;
                        for (let i = 0; i < invalidatedRoomIds.length; i += GET_CACHED_SYNC_CONCURRENCY) {
                            const chunk = invalidatedRoomIds.slice(i, i + GET_CACHED_SYNC_CONCURRENCY);
                            const chunkResults = await Promise.all(chunk.map(async (roomId) => {
                                const roomName = roomNameById[roomId] || getRoomNameByRoomId(roomId);
                                try {
                                    const syncResult = await syncSingleRoomPriceCache(building, roomId, roomName, {
                                        reason: "getCachedPrices",
                                        companyId
                                    });
                                    return { roomId, roomName, syncResult };
                                } catch (syncErr) {
                                    console.warn(`[getCachedPrices] parallel sync failed ${building}/${roomId}:`, syncErr.message);
                                    return { roomId, roomName, syncResult: null };
                                }
                            }));
                            chunkResults.forEach(({ roomId, roomName, syncResult }) => {
                                if (syncResult?.success) {
                                    syncedRoomIds.push(roomId);
                                    liveRoomDataById[roomId] = {
                                        roomName,
                                        roomId: String(roomId),
                                        dates: syncResult.newDates
                                    };
                                }
                            });
                        }
                    } finally {
                        await releasePriceSyncLock();
                    }
                    if (syncedRoomIds.length > 0) {
                        const syncedRoomIdSet = new Set(syncedRoomIds.map(String));
                        const remainingInvalidatedRoomIds = invalidatedRoomIds.filter((roomId) => !syncedRoomIdSet.has(String(roomId)));
                        await docRef.set({
                            lastSync: admin.firestore.FieldValue.serverTimestamp(),
                            lastIncrementalSync: admin.firestore.FieldValue.serverTimestamp(),
                            invalidatedRoomIds: remainingInvalidatedRoomIds,
                            pendingInvalidationCount: remainingInvalidatedRoomIds.length,
                            invalidatedAt: remainingInvalidatedRoomIds.length > 0
                                ? (docData.invalidatedAt || admin.firestore.FieldValue.serverTimestamp())
                                : admin.firestore.FieldValue.delete(),
                            invalidatedBy: remainingInvalidatedRoomIds.length > 0
                                ? (docData.invalidatedBy || "getCachedPrices")
                                : admin.firestore.FieldValue.delete()
                        }, { merge: true });
                        doc = await docRef.get();
                        docData = doc.data() || docData;
                    }
                } else {
                    // 락 미획득 시 live 스냅샷 fallback도 동시성 제한 병렬로 처리 (읽기 전용 스냅샷이라 충돌 없음)
                    const GET_CACHED_FALLBACK_CONCURRENCY = 5;
                    for (let i = 0; i < invalidatedRoomIds.length; i += GET_CACHED_FALLBACK_CONCURRENCY) {
                        const chunk = invalidatedRoomIds.slice(i, i + GET_CACHED_FALLBACK_CONCURRENCY);
                        await Promise.all(chunk.map(async (roomId) => {
                            const roomName = roomNameById[roomId] || getRoomNameByRoomId(roomId);
                            try {
                                const liveRoomSnapshot = await fetchSingleRoomPriceCacheSnapshot(roomId);
                                if (liveRoomSnapshot?.success) {
                                    try {
                                        await cleanupStaleInventoryOverrideBlocks({
                                            companyId,
                                            roomId,
                                            currentDates: liveRoomSnapshot.datesObj,
                                            syncSource: "getCachedPrices:live_fallback"
                                        });
                                    } catch (cleanupErr) {
                                        console.warn(`[getCachedPrices] inventory override cleanup failed ${building}/${roomId}:`, cleanupErr.message);
                                    }
                                    liveRoomDataById[roomId] = {
                                        roomName,
                                        roomId: String(roomId),
                                        dates: liveRoomSnapshot.datesObj
                                    };
                                }
                            } catch (liveSyncErr) {
                                console.warn(`[getCachedPrices] live fallback failed ${building}/${roomId}:`, liveSyncErr.message);
                            }
                        }));
                    }
                }
            }
        }

        // 새 구조: rooms 서브컬렉션에서 모든 방 데이터 가져오기
        let priceData = {};
        let cacheMode = "legacy_rooms";
        let monthCache = null;
        if (useDateRangeFilter) {
            monthCache = await readPriceSyncMonthCache({
                buildingRef: docRef,
                building,
                fromKey,
                toKey,
                filterRoomDataByDateRange
            });
            if (monthCache.hit) {
                priceData = monthCache.priceData;
                cacheMode = "month_slices";
            }
        }

        if (Object.keys(priceData).length === 0) {
            const roomsSnap = await docRef.collection("rooms").get();
            roomsSnap.forEach(roomDoc => {
                priceData[roomDoc.id] = filterRoomDataByDateRange(roomDoc.data());
            });
        }
        if (monthCache && !monthCache.hit && Object.keys(monthCache.priceData || {}).length > 0) {
            Object.entries(monthCache.priceData).forEach(([roomId, roomData]) => {
                const existing = priceData[roomId] || {};
                priceData[roomId] = {
                    ...existing,
                    ...roomData,
                    roomName: roomData.roomName || existing.roomName,
                    roomId: String(roomId),
                    dates: {
                        ...(existing.dates || {}),
                        ...(roomData.dates || {})
                    }
                };
            });
            cacheMode = "legacy_rooms_month_overlay";
        }
        Object.entries(liveRoomDataById).forEach(([roomId, roomData]) => {
            priceData[roomId] = filterRoomDataByDateRange(roomData);
        });

        // 정규화 도입 이전에 m: ""로 저장된 캐시도 즉시 1박으로 응답한다.
        // (그러지 않으면 다음 full sync까지 해당 roomId가 프론트에서 비활성으로 오인된다)
        Object.values(priceData).forEach((roomData) => {
            Object.values(roomData?.dates || {}).forEach((dateEntry) => {
                if (dateEntry && typeof dateEntry === "object") {
                    dateEntry.m = normalizeBeds24MinStay(dateEntry.m);
                }
            });
        });

        const data = docData;
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
            cacheMode,
            invalidatedRoomIds,
            reservationInvalidatedRoomIds,
            invalidatedRoomCount: invalidatedRoomIds.length,
            hasPendingInvalidation: invalidatedRoomIds.length > 0,
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
exports.checkAvailability = onRequest({ cors: true, timeoutSeconds: 120, memory: "16GiB", cpu: 4, maxInstances: 4 }, async (req, res) => {
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
        const response = await beds24GetV2WithGuard("/inventory/rooms/calendar", {
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
function getPriceJobCreatedAtMs(jobData = {}, jobSnapshot = null) {
    return jobData?.createdAt?.toMillis?.()
        || jobSnapshot?.createTime?.toMillis?.()
        || 0;
}

function getPriceJobType(jobData = {}) {
    if (jobData?.jobType === "min_stay" || jobData?.worker === "Min Stay Queue") return "min_stay";
    return "price";
}

function normalizePriceJobRoomUpdates(jobData = {}) {
    const { roomUpdates, roomIds, dates, calendarUpdates } = jobData || {};
    return Array.isArray(roomUpdates) && roomUpdates.length > 0
        ? roomUpdates
            .filter((item) => item?.roomId && item?.dates && Object.keys(item.dates).length > 0)
            .map((item) => ({
                roomId: String(item.roomId),
                roomName: item.roomName || null,
                dates: item.dates,
                cacheRoomIds: normalizeRoomIdList(item.cacheRoomIds || item.roomIds || [item.roomId]),
                calendarUpdates: Array.isArray(item.calendarUpdates) ? item.calendarUpdates : buildBeds24CalendarUpdatesFromDates(item.dates)
            }))
        : (roomIds || []).map((rid) => ({
            roomId: String(rid),
            roomName: null,
            dates: dates || {},
            cacheRoomIds: [String(rid)],
            calendarUpdates: Array.isArray(calendarUpdates) ? calendarUpdates : buildBeds24CalendarUpdatesFromDates(dates || {})
        }));
}

function getPriceJobRoomDateKeys(roomUpdates = []) {
    const keys = new Set();
    roomUpdates.forEach((item) => {
        const rid = String(item?.roomId || "");
        if (!rid) return;
        Object.keys(item?.dates || {}).forEach((dateKey) => {
            keys.add(`${rid}:${dateKey}`);
        });
    });
    return keys;
}

function prunePriceJobRoomUpdates(roomUpdates = [], supersededKeySet = new Set()) {
    if (!(supersededKeySet instanceof Set) || supersededKeySet.size === 0) {
        return roomUpdates;
    }

    return roomUpdates
        .map((item) => {
            const rid = String(item?.roomId || "");
            const nextDates = {};
            Object.entries(item?.dates || {}).forEach(([dateKey, values]) => {
                if (!supersededKeySet.has(`${rid}:${dateKey}`)) {
                    nextDates[dateKey] = values;
                }
            });
            if (Object.keys(nextDates).length === 0) {
                return null;
            }
            return {
                roomId: rid,
                roomName: item.roomName || null,
                dates: nextDates,
                cacheRoomIds: normalizeRoomIdList(item.cacheRoomIds || [rid]),
                calendarUpdates: buildBeds24CalendarUpdatesFromDates(nextDates)
            };
        })
        .filter(Boolean);
}

async function getSupersededPriceJobIntent({
    jobId,
    companyId,
    building,
    jobType = "price",
    currentCreatedMs,
    roomUpdates = [],
    excludeJobIds = []
} = {}) {
    if (!jobId || !companyId || !building || !Number.isFinite(currentCreatedMs) || currentCreatedMs <= 0 || !Array.isArray(roomUpdates) || roomUpdates.length === 0) {
        return {
            roomUpdates,
            supersededKeyCount: 0,
            supersededByJobIds: [],
            supersededByJobId: null
        };
    }

    const currentKeys = getPriceJobRoomDateKeys(roomUpdates);
    if (currentKeys.size === 0) {
        return {
            roomUpdates,
            supersededKeyCount: 0,
            supersededByJobIds: [],
            supersededByJobId: null
        };
    }

    const excludedIds = new Set([jobId, ...(excludeJobIds || []).map(String)]);
    const comparableStatuses = ["queued", "processing", "completed", "partial_failed", "failed"];
    const sameBuildingSnap = await db.collection("beds24_price_jobs")
        .where("status", "in", comparableStatuses)
        .where("companyId", "==", companyId)
        .where("building", "==", building)
        .get();

    const supersededKeySet = new Set();
    const supersededByJobIds = [];

    sameBuildingSnap.docs
        .filter((docSnap) => !excludedIds.has(docSnap.id))
        .map((docSnap) => ({
            id: docSnap.id,
            data: docSnap.data() || {},
            createdMs: getPriceJobCreatedAtMs(docSnap.data() || {}, docSnap)
        }))
        .filter((item) => getPriceJobType(item.data) === jobType)
        .filter((item) => item.createdMs > currentCreatedMs)
        .sort((a, b) => a.createdMs - b.createdMs)
        .forEach((item) => {
            let hasOverlap = false;
            const candidateUpdates = normalizePriceJobRoomUpdates(item.data);
            const comparableUpdates = jobType === "price"
                ? normalizeBeds24PriceWriteRoomUpdates(building, candidateUpdates)
                : candidateUpdates;
            comparableUpdates.forEach((update) => {
                const rid = String(update.roomId || "");
                Object.keys(update.dates || {}).forEach((dateKey) => {
                    const key = `${rid}:${dateKey}`;
                    if (currentKeys.has(key)) {
                        supersededKeySet.add(key);
                        hasOverlap = true;
                    }
                });
            });
            if (hasOverlap) {
                supersededByJobIds.push(item.id);
            }
        });

    return {
        roomUpdates: prunePriceJobRoomUpdates(roomUpdates, supersededKeySet),
        supersededKeyCount: supersededKeySet.size,
        supersededByJobIds,
        supersededByJobId: supersededByJobIds.length > 0 ? supersededByJobIds[supersededByJobIds.length - 1] : null
    };
}

function getCalendarEntryForDate(calendar = [], dateStr) {
    return (calendar || []).find((entry) => entry?.from <= dateStr && entry?.to >= dateStr) || null;
}

function getExpectedPriceValue(value) {
    if (value === "REMOVE" || value === -1 || value === null) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        throw new Error(`Invalid price value for Beds24 verification: ${value}`);
    }
    return parsed;
}

/**
 * 되읽기 검증 대상을 만든다.
 *
 * 가격 쓰기는 source 방 하나에만 POST하고 Beds24 Daily Price 링크가 연결 방에
 * 전파해 주기를 기대한다. 그런데 연결 방의 실제 값은 지금까지 한 번도 확인하지 않았고,
 * 캐시에는 "전파됐다"고 가정한 값을 써 왔다. 링크가 끊겨 있으면 평소엔 드러나지 않다가
 * 듀얼 ID가 동시에 열리는 교차일에 값이 어긋나 보인다.
 *
 * → source 방은 보낸 값 전체를, 연결 방은 p1(전파돼야 하는 값)만 검증 대상으로 삼는다.
 *   minStay는 활성 roomId별 설정이라 전파 대상이 아니므로 연결 방에서는 확인하지 않는다.
 *
 * @returns {{ targets: Object, siblingToSource: Map<string,string> }}
 */
function buildPriceWriteVerificationTargets(roomUpdateByRoomId, sourceRoomIds, jobType) {
    const targets = {};
    const siblingToSource = new Map();

    (sourceRoomIds || []).forEach((sourceRid) => {
        const roomUpdate = roomUpdateByRoomId[sourceRid];
        if (!roomUpdate) return;
        targets[sourceRid] = roomUpdate;

        if (jobType !== "price") return;

        normalizeRoomIdList(roomUpdate.cacheRoomIds || []).forEach((cacheRoomId) => {
            const siblingRid = String(cacheRoomId);
            if (siblingRid === sourceRid || targets[siblingRid]) return;

            const p1OnlyDates = {};
            Object.entries(roomUpdate.dates || {}).forEach(([dateKey, values]) => {
                if (values?.p1 !== undefined) p1OnlyDates[dateKey] = { p1: values.p1 };
            });
            if (Object.keys(p1OnlyDates).length === 0) return;

            targets[siblingRid] = { ...roomUpdate, roomId: siblingRid, dates: p1OnlyDates };
            siblingToSource.set(siblingRid, sourceRid);
        });
    });

    return { targets, siblingToSource };
}

/**
 * @param {boolean} includeLinkedPrices
 *   false — 그 방에 "직접" 설정된 값만 읽는다. 우리가 POST한 source 방 검증에 쓴다.
 *           (연결된 Daily Price 쪽에 잘못 쓰인 요청을 성공으로 오인하지 않기 위함)
 *   true  — 링크로 전파된 값까지 포함해 읽는다. 연결 방 검증에 쓴다.
 *           연결 방의 가격은 링크를 통해서만 보이므로 false로 읽으면 항상 불일치로 나온다.
 *           캐시(syncAllPrices)도 true로 만들어지므로 화면에 보이는 값과 기준이 일치한다.
 */
async function verifyBeds24PriceWrites(roomIds, roomUpdateByRoomId, attempts = 3, { includeLinkedPrices = false } = {}) {
    const targetRoomIds = [...new Set((roomIds || []).map(String).filter(Boolean))];
    const dateKeys = targetRoomIds.flatMap((roomId) => Object.keys(roomUpdateByRoomId[roomId]?.dates || {}));
    if (targetRoomIds.length === 0 || dateKeys.length === 0) {
        return { verifiedRoomIds: targetRoomIds, errorsByRoomId: {} };
    }

    const sortedDateKeys = [...new Set(dateKeys)].sort();
    const fromKey = sortedDateKeys[0];
    const toKey = sortedDateKeys[sortedDateKeys.length - 1];
    const toV2Date = (dateKey) => `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`;
    const fromDate = toV2Date(fromKey);
    const toDate = toV2Date(toKey);
    let latestErrorsByRoomId = {};

    for (let attempt = 1; attempt <= attempts; attempt++) {
        const roomDataById = new Map();
        const VERIFY_BATCH_SIZE = 20;
        let verifyTruncated = false;
        for (let i = 0; i < targetRoomIds.length; i += VERIFY_BATCH_SIZE) {
            const chunk = targetRoomIds.slice(i, i + VERIFY_BATCH_SIZE);
            const pageResult = await beds24GetRoomCalendarAllPages({
                roomId: chunk,
                startDate: fromDate,
                endDate: toDate,
                includePrices: true,
                includeLinkedPrices,
                includeMinStay: true
            }, { label: `verify [${chunk.join(",")}]` });
            if (pageResult.truncated) verifyTruncated = true;
            pageResult.roomsById.forEach((roomData, rid) => {
                roomDataById.set(rid, roomData);
            });
        }

        // 잘린 응답으로는 "일치한다"를 증명할 수 없다. 검증 실패로 처리해 재시도/실패 보고로 넘긴다.
        if (verifyTruncated) {
            const truncationError = "Beds24 verification readback truncated (paged response)";
            return {
                verifiedRoomIds: [],
                errorsByRoomId: Object.fromEntries(targetRoomIds.map((roomId) => [roomId, truncationError]))
            };
        }

        const errorsByRoomId = {};
        targetRoomIds.forEach((roomId) => {
            const roomData = roomDataById.get(roomId);
            const mismatches = [];
            Object.entries(roomUpdateByRoomId[roomId]?.dates || {}).forEach(([dateKey, values]) => {
                const dateStr = toV2Date(dateKey);
                const entry = getCalendarEntryForDate(roomData?.calendar || [], dateStr);

                if (values?.p1 !== undefined) {
                    const expected = getExpectedPriceValue(values.p1);
                    const actual = entry?.price1 == null ? null : Number(entry.price1);
                    const matches = expected === null ? actual === null : actual === expected;
                    if (!matches) {
                        mismatches.push({ field: "price1", date: dateStr, expected, actual });
                    }
                }

                // minStay도 반드시 읽어 확인한다. Beds24는 값을 반영하지 않고도 success=true를 반환하므로
                // 검증이 없으면 반영 실패가 그대로 로컬 캐시에 "성공"으로 기록된다.
                // Beds24는 minStay 1을 빈칸으로 돌려주므로 양쪽 모두 1 기준으로 정규화해 비교한다.
                if (values?.m !== undefined) {
                    const expected = Number(normalizeBeds24MinStay(values.m));
                    const actual = entry ? Number(normalizeBeds24MinStay(entry.minStay)) : null;
                    if (actual !== expected) {
                        mismatches.push({ field: "minStay", date: dateStr, expected, actual });
                    }
                }
            });

            if (mismatches.length > 0) {
                const sample = mismatches.slice(0, 3)
                    .map((item) => `${item.date} ${item.field}: expected=${item.expected}, actual=${item.actual}`)
                    .join("; ");
                errorsByRoomId[roomId] = `Beds24 readback mismatch (${mismatches.length} value(s)): ${sample}`;
            }
        });

        latestErrorsByRoomId = errorsByRoomId;
        if (Object.keys(errorsByRoomId).length === 0) break;
        if (attempt < attempts) await sleep(attempt * 500);
    }

    return {
        verifiedRoomIds: targetRoomIds.filter((roomId) => !latestErrorsByRoomId[roomId]),
        errorsByRoomId: latestErrorsByRoomId
    };
}

async function patchVerifiedPriceJobCache({
    buildingRef,
    building,
    sourceRoomId,
    roomUpdate,
    jobData,
    nowFormatted,
    oldPricesByRoom,
    skipCacheRoomIds = new Set()
}) {
    const roomDates = roomUpdate?.dates || {};
    const isPriceJob = getPriceJobType(jobData) === "price";
    const cacheRoomIds = (isPriceJob
        ? [...new Set([sourceRoomId, ...normalizeRoomIdList(roomUpdate?.cacheRoomIds || [])])]
        : [sourceRoomId]
    // 전파가 확인되지 않은 연결 방은 캐시에 쓰지 않는다.
    // 가정한 값을 써 버리면 Beds24와 어긋난 상태가 "정상"으로 굳는다.
    ).filter((cacheRoomId) => cacheRoomId === sourceRoomId || !skipCacheRoomIds.has(String(cacheRoomId)));

    await Promise.all(cacheRoomIds.map(async (cacheRoomId) => {
        const roomDocRef = buildingRef.collection("rooms").doc(cacheRoomId);
        const roomSnap = await roomDocRef.get();
        const roomData = roomSnap.exists
            ? roomSnap.data()
            : { roomId: cacheRoomId, roomName: getRoomNameByRoomId(cacheRoomId), dates: {} };
        if (!roomData.dates) roomData.dates = {};
        roomData.lastManualUpdate = admin.firestore.FieldValue.serverTimestamp();

        if (cacheRoomId === sourceRoomId) {
            oldPricesByRoom[sourceRoomId] = {};
            Object.keys(roomDates).forEach((dateKey) => {
                oldPricesByRoom[sourceRoomId][dateKey] = parseFloat(roomData.dates[dateKey]?.p1) || 0;
            });
        }

        Object.entries(roomDates).forEach(([dateKey, values]) => {
            if (!roomData.dates[dateKey]) roomData.dates[dateKey] = {};
            const valuesToCache = isPriceJob && cacheRoomId !== sourceRoomId
                ? { p1: values.p1 }
                : values;
            const oldP1 = parseFloat(roomData.dates[dateKey].p1) || 0;
            const newP1 = valuesToCache.p1 !== undefined ? parseFloat(valuesToCache.p1) : oldP1;

            if (valuesToCache.p1 !== undefined) roomData.dates[dateKey].p1 = String(valuesToCache.p1);
            if (valuesToCache.p2 !== undefined) roomData.dates[dateKey].p2 = String(valuesToCache.p2);
            if (valuesToCache.p3 !== undefined) roomData.dates[dateKey].p3 = String(valuesToCache.p3);
            if (valuesToCache.m !== undefined) roomData.dates[dateKey].m = String(valuesToCache.m);
            if (valuesToCache.mx !== undefined) roomData.dates[dateKey].mx = String(valuesToCache.mx);
            if (valuesToCache.na !== undefined) roomData.dates[dateKey].na = String(valuesToCache.na);
            if (valuesToCache.ov !== undefined) roomData.dates[dateKey].ov = String(valuesToCache.ov);

            if (valuesToCache.p1 !== undefined && oldP1 !== newP1) {
                roomData.dates[dateKey].lm = {
                    u: jobData.worker || "Admin",
                    t: nowFormatted,
                    o: oldP1,
                    n: newP1,
                    s: "system",
                    ts: Date.now()
                };
            }
        });

        await roomDocRef.set(roomData, { merge: true });
        const changedDatesForMonthCache = {};
        Object.keys(roomDates).forEach((dateKey) => {
            if (roomData.dates?.[dateKey]) changedDatesForMonthCache[dateKey] = roomData.dates[dateKey];
        });
        await mergePriceSyncMonthCache(
            building,
            cacheRoomId,
            roomData.roomName || getRoomNameByRoomId(cacheRoomId),
            changedDatesForMonthCache
        );
    }));
}

async function processPriceJob(jobId) {
    const jobRef = db.collection("beds24_price_jobs").doc(jobId);
    const apiGuard = await getBeds24ApiGuardState();
    if (apiGuard.active) {
        console.log(`[PriceJob ${jobId}] Beds24 API cooldown active (${apiGuard.remainingSec}s remaining)`);
        return {
            skipped: true,
            reason: "beds24_api_cooldown",
            cooldownRemainingSec: apiGuard.remainingSec
        };
    }

    // 기존 price sync lock 재사용 (scheduled/webhook sync와 동시 write 방지)
    const { acquired } = await acquirePriceJobExecutionLock("priceJobWorker");
    if (!acquired) {
        console.log(`[PriceJob ${jobId}] 락 점유 중 — 스킵`);
        return { skipped: true, reason: "lock_busy" };
    }

    try {
        // ★ Coalescing 전처리: lock 보유 중에 같은 companyId + building의 queued secondary jobs 검색
        let coalescedJobIds = [];
        let mergedRoomUpdates = null;
        let currentJobCreatedMs = 0;
        try {
            const preSnap = await jobRef.get();
            if (preSnap.exists && preSnap.data()?.status === "queued") {
                const preData = preSnap.data();
                const cId = preData.companyId;
                const cBuilding = preData.building;
                const currentJobType = getPriceJobType(preData);
                currentJobCreatedMs = getPriceJobCreatedAtMs(preData, preSnap);
                if (cId && cBuilding) {
                    const secSnap = await db.collection("beds24_price_jobs")
                        .where("status", "==", "queued")
                        .where("companyId", "==", cId)
                        .where("building", "==", cBuilding)
                        .get();
                    const COALESCE_WINDOW_MS = 2 * 60 * 1000; // 2분 이내 생성된 job만 coalescing
                    const nowMs = Date.now();
                    const secDocs = secSnap.docs.filter(d => {
                        if (d.id === jobId) return false;
                        if (getPriceJobType(d.data() || {}) !== currentJobType) return false;
                        const secCreatedMs = getPriceJobCreatedAtMs(d.data(), d);
                        if (!secCreatedMs) return false;
                        if (currentJobCreatedMs > 0) {
                            return Math.abs(secCreatedMs - currentJobCreatedMs) <= COALESCE_WINDOW_MS;
                        }
                        return (nowMs - secCreatedMs) <= COALESCE_WINDOW_MS;
                    });
                    if (secDocs.length > 0) {
                        // last-write-wins: createdAt 오름차순 정렬 → 나중 값 덮어쓰기
                        const allForMerge = [
                            { id: jobId, data: preData },
                            ...secDocs.map(d => ({ id: d.id, data: d.data() }))
                        ].sort((a, b) => (a.data.createdAt?.toMillis?.() || 0) - (b.data.createdAt?.toMillis?.() || 0));
                        const dateValMap = {};
                        const roomNameMap = {};
                        const cacheRoomIdsMap = {};
                        for (const { data } of allForMerge) {
                            for (const ru of (Array.isArray(data.roomUpdates) ? data.roomUpdates : [])) {
                                if (!ru?.roomId || !ru?.dates) continue;
                                const rid = String(ru.roomId);
                                if (ru.roomName) roomNameMap[rid] = ru.roomName;
                                if (!cacheRoomIdsMap[rid]) cacheRoomIdsMap[rid] = new Set();
                                normalizeRoomIdList(ru.cacheRoomIds || [rid]).forEach((cacheRoomId) => {
                                    cacheRoomIdsMap[rid].add(cacheRoomId);
                                });
                                Object.entries(ru.dates || {}).forEach(([dKey, val]) => {
                                    dateValMap[`${rid}:${dKey}`] = { roomId: rid, dateKey: dKey, values: val };
                                });
                            }
                        }
                        const mergedByRoom = {};
                        for (const { roomId: rid, dateKey, values } of Object.values(dateValMap)) {
                            if (!mergedByRoom[rid]) mergedByRoom[rid] = {};
                            mergedByRoom[rid][dateKey] = values;
                        }
                        mergedRoomUpdates = Object.entries(mergedByRoom).map(([rid, dates]) => ({
                            roomId: rid,
                            roomName: roomNameMap[rid] || null,
                            dates,
                            cacheRoomIds: [...(cacheRoomIdsMap[rid] || new Set([rid]))],
                            calendarUpdates: buildBeds24CalendarUpdatesFromDates(dates)
                        }));
                        coalescedJobIds = secDocs.map(d => d.id);
                        console.log(`[PriceJob ${jobId}] Coalescing: ${coalescedJobIds.length}개 secondary job 흡수 [${coalescedJobIds.join(", ")}]`);
                    }
                }
            }
        } catch (coalesceErr) {
            // coalescing 실패 시 안전하게 단독 처리 (기존 동작 유지)
            console.warn(`[PriceJob ${jobId}] Coalescing 전처리 실패 (무시하고 계속):`, coalesceErr.message);
            coalescedJobIds = [];
            mergedRoomUpdates = null;
        }

        let jobData = null;

        // Firestore 트랜잭션: queued → processing 원자적 전환 (중복 실행 방지)
        try {
            await db.runTransaction(async (tx) => {
                const snap = await tx.get(jobRef);
                if (!snap.exists) throw new Error("Job not found");
                const data = snap.data();
                if (data.status !== "queued") throw new Error(`SKIP:${data.status}`);
                const primaryUpdate = {
                    status: "processing",
                    startedAt: admin.firestore.FieldValue.serverTimestamp(),
                    retryCount: (data.retryCount || 0) + 1
                };
                if (mergedRoomUpdates && coalescedJobIds.length > 0) {
                    primaryUpdate.roomUpdates = mergedRoomUpdates;
                    primaryUpdate.roomIds = [...new Set(mergedRoomUpdates.map(ru => ru.roomId))];
                    primaryUpdate.coalescedJobIds = coalescedJobIds;
                    primaryUpdate["progress.total"] = mergedRoomUpdates.length;
                }
                const secondaryQueuedRefs = [];
                for (const sjId of coalescedJobIds) {
                    const sjRef = db.collection("beds24_price_jobs").doc(sjId);
                    const sjSnap = await tx.get(sjRef);
                    if (sjSnap.exists && sjSnap.data().status === "queued") {
                        secondaryQueuedRefs.push(sjRef);
                    }
                }
                tx.update(jobRef, primaryUpdate);
                // secondary jobs: status 재확인 후 absorbed 처리
                secondaryQueuedRefs.forEach((sjRef) => {
                    tx.update(sjRef, {
                        status: "processing",
                        startedAt: admin.firestore.FieldValue.serverTimestamp(),
                        coalescedIntoJobId: jobId
                    });
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

        const { building, companyId: jobCompanyId, worker: jobWorker, workerEmail: jobWorkerEmail } = jobData;
        const originalRoomUpdates = mergedRoomUpdates || normalizePriceJobRoomUpdates(jobData);
        const normalizedRoomUpdates = getPriceJobType(jobData) === "price"
            ? normalizeBeds24PriceWriteRoomUpdates(building, originalRoomUpdates)
            : originalRoomUpdates;
        const supersededIntent = await getSupersededPriceJobIntent({
            jobId,
            companyId: jobCompanyId,
            building,
            jobType: getPriceJobType(jobData),
            currentCreatedMs: currentJobCreatedMs,
            roomUpdates: normalizedRoomUpdates,
            excludeJobIds: coalescedJobIds
        });
        const effectiveRoomUpdates = supersededIntent.roomUpdates;
        const supersededKeyCount = supersededIntent.supersededKeyCount || 0;
        const supersededByJobIds = supersededIntent.supersededByJobIds || [];
        const supersededByJobId = supersededIntent.supersededByJobId || null;
        const roomIds = effectiveRoomUpdates.map((item) => item.roomId);
        const roomUpdateByRoomId = {};
        effectiveRoomUpdates.forEach((item) => {
            roomUpdateByRoomId[item.roomId] = item;
        });
        const buildingRef = db.collection("price_sync").doc(building);
        const results = [];
        if (supersededKeyCount > 0) {
            const supersedeMeta = {
                roomUpdates: effectiveRoomUpdates,
                roomIds,
                supersededKeyCount,
                supersededByJobIds,
                "progress.total": roomIds.length
            };
            if (roomIds.length === 0) {
                supersedeMeta.supersededByJobId = supersededByJobId;
            }
            await jobRef.update(supersedeMeta);
        }

        if (roomIds.length === 0 && supersededByJobId) {
            const supersededResults = normalizedRoomUpdates.map((item) => ({
                roomId: item.roomId,
                success: true,
                skipped: true,
                superseded: true,
                supersededByJobId
            }));
            await jobRef.update({
                status: "completed",
                completedAt: admin.firestore.FieldValue.serverTimestamp(),
                "progress.processed": 0,
                "progress.results": supersededResults,
                failedRoomIds: [],
                error: null,
                supersededByJobId,
                supersededByJobIds,
                supersededKeyCount
            });

            if (coalescedJobIds.length > 0) {
                const secBatch = db.batch();
                coalescedJobIds.forEach((sjId) => {
                    secBatch.update(db.collection("beds24_price_jobs").doc(sjId), {
                        status: "completed",
                        completedAt: admin.firestore.FieldValue.serverTimestamp(),
                        failedRoomIds: [],
                        error: null,
                        supersededByJobId,
                        supersededByJobIds,
                        supersededKeyCount
                    });
                });
                await secBatch.commit();
            }

            console.log(`[PriceJob ${jobId}] skipped stale intent; superseded by newer job ${supersededByJobId}`);
            return { jobId, status: "completed", superseded: true, supersededByJobId };
        }
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
            if (b > 0) {
                const midRunApiGuard = await getBeds24ApiGuardState();
                if (midRunApiGuard.active) {
                    const remainingRoomIds = batches.slice(b).flat().map(String);
                    const remainingRoomIdSet = new Set(remainingRoomIds);
                    const remainingRoomUpdates = effectiveRoomUpdates.filter((item) => remainingRoomIdSet.has(String(item.roomId)));
                    await jobRef.update({
                        status: "queued",
                        startedAt: null,
                        roomUpdates: remainingRoomUpdates,
                        roomIds: remainingRoomIds,
                        "progress.processed": processedCount,
                        "progress.results": results,
                        error: null,
                        cooldownDeferredAt: admin.firestore.FieldValue.serverTimestamp(),
                        cooldownRemainingSec: midRunApiGuard.remainingSec
                    });
                    console.log(`[PriceJob ${jobId}] pausing remaining ${remainingRoomIds.length} roomIds due to Beds24 API cooldown (${midRunApiGuard.remainingSec}s remaining)`);
                    return {
                        skipped: true,
                        reason: "beds24_api_cooldown",
                        cooldownRemainingSec: midRunApiGuard.remainingSec
                    };
                }
            }
            const batchRoomIds = batches[b].map(String);
            const payload = batchRoomIds.map(rid => ({
                roomId: parseInt(rid),
                calendar: roomUpdateByRoomId[rid]?.calendarUpdates || []
            }));

            try {
                const apiResp = await beds24PostV2WithGuard("/inventory/rooms/calendar", payload);

                // Beds24 V2: 응답이 배열이면 요청 payload와 동일 순서로 roomId별 결과가 옴
                const respItems = Array.isArray(apiResp.data) ? apiResp.data
                    : (Array.isArray(apiResp.data?.data) ? apiResp.data.data : null);

                if (respItems && respItems.length === batchRoomIds.length) {
                    let batchSuccessCount = 0;
                    let batchFailCount = 0;

                    // 1) Beds24 API 수락 여부를 먼저 확인한다.
                    const acceptedRids = [];
                    const apiErrorsByRoomId = {};
                    for (let ri = 0; ri < batchRoomIds.length; ri++) {
                        const rid = batchRoomIds[ri];
                        const item = respItems[ri];
                        const itemHasErrors = item?.errors && item.errors.length > 0;
                        const itemSuccess = item?.success !== false && !itemHasErrors;

                        if (itemSuccess) {
                            acceptedRids.push(rid);
                        } else {
                            apiErrorsByRoomId[rid] = item?.errors?.map(e => e.message).join("; ") || "Beds24 item-level failure";
                        }
                    }

                    // 2) Price 작업은 실제 Beds24 값을 다시 읽어 일치할 때만 성공 처리한다.
                    //    연결된 Daily Price에 잘못 쓴 요청도 Beds24가 success=true를 반환할 수 있기 때문이다.
                    let verificationErrorsByRoomId = {};
                    // 링크 전파가 확인되지 않은 연결 방 — 캐시에 "전파됐다"고 쓰면 안 된다.
                    const unpropagatedSiblingRoomIds = new Set();
                    if (acceptedRids.length > 0) {
                        const { targets, siblingToSource } = buildPriceWriteVerificationTargets(
                            roomUpdateByRoomId, acceptedRids, getPriceJobType(jobData)
                        );
                        const sourceRids = Object.keys(targets).filter((rid) => !siblingToSource.has(rid));
                        const siblingRids = Object.keys(targets).filter((rid) => siblingToSource.has(rid));

                        // source는 직접 설정값만(false), 연결 방은 링크 전파값까지(true) 읽어야 한다.
                        // 기준이 다르므로 한 번의 조회로 합칠 수 없다.
                        const [sourceVerification, siblingVerification] = await Promise.all([
                            sourceRids.length > 0
                                ? verifyBeds24PriceWrites(sourceRids, targets, 3, { includeLinkedPrices: false })
                                : Promise.resolve({ errorsByRoomId: {} }),
                            siblingRids.length > 0
                                ? verifyBeds24PriceWrites(siblingRids, targets, 3, { includeLinkedPrices: true })
                                : Promise.resolve({ errorsByRoomId: {} })
                        ]);
                        const mergedErrors = { ...sourceVerification.errorsByRoomId, ...siblingVerification.errorsByRoomId };

                        Object.entries(mergedErrors).forEach(([rid, error]) => {
                            if (siblingToSource.has(rid)) {
                                // 연결 방 불일치 = Beds24 Daily Price 링크가 전파하지 않았다는 뜻.
                                // source 쓰기 자체는 성공했으므로 job을 실패로 만들지 않는다.
                                // 대신 크게 로그를 남기고, 그 방 캐시는 건드리지 않아 다음 sync가 실제 값으로 채우게 한다.
                                unpropagatedSiblingRoomIds.add(rid);
                                console.error(
                                    `[PriceJob ${jobId}] Daily Price 링크 미전파 의심: source=${siblingToSource.get(rid)} → linked=${rid} — ${error}`
                                );
                            } else {
                                verificationErrorsByRoomId[rid] = error;
                            }
                        });
                    }

                    const successRids = [];
                    batchRoomIds.forEach((rid) => {
                        const error = apiErrorsByRoomId[rid] || verificationErrorsByRoomId[rid] || null;
                        if (error) {
                            results.push({ roomId: rid, success: false, error });
                            batchFailCount++;
                        } else {
                            const unpropagated = normalizeRoomIdList(roomUpdateByRoomId[rid]?.cacheRoomIds || [])
                                .filter((cacheRoomId) => unpropagatedSiblingRoomIds.has(String(cacheRoomId)));
                            results.push({
                                roomId: rid,
                                success: true,
                                verified: true,
                                ...(unpropagated.length > 0 ? { unpropagatedLinkedRoomIds: unpropagated } : {})
                            });
                            successRids.push(rid);
                            batchSuccessCount++;
                        }
                    });

                    // 3) 검증 성공 객실의 Firestore 캐시 패치를 동시성 제한 병렬로 처리.
                    //    각 rid는 서로 다른 room 문서(rooms.{rid})와 month 캐시(rooms.{rid})만 쓰므로 병렬 충돌 없음.
                    //    같은 배치 = 같은 논리적 시각이므로 lm.t용 시각은 배치당 1회만 계산.
                    const ROOM_WRITE_CONCURRENCY = 10;
                    const nowFormatted = dayjs().utcOffset(9).format("MM-DD HH:mm");
                    for (let i = 0; i < successRids.length; i += ROOM_WRITE_CONCURRENCY) {
                        const chunk = successRids.slice(i, i + ROOM_WRITE_CONCURRENCY);
                        await Promise.all(chunk.map(async (rid) => {
                            try {
                                const roomUpdate = roomUpdateByRoomId[rid];
                                await patchVerifiedPriceJobCache({
                                    buildingRef,
                                    building,
                                    sourceRoomId: rid,
                                    roomUpdate,
                                    jobData,
                                    nowFormatted,
                                    oldPricesByRoom,
                                    skipCacheRoomIds: unpropagatedSiblingRoomIds
                                });
                            } catch (cacheErr) {
                                console.error(`[PriceJob ${jobId}] 캐시 패치 실패 roomId=${rid}:`, cacheErr.message);
                            }
                        }));
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
                            const nowFormatted = dayjs().utcOffset(9).format("MM-DD HH:mm");
                            Object.entries(dates).forEach(([dKey, values]) => {
                                if (!roomData.dates[dKey]) roomData.dates[dKey] = {};
                                
                                const oldP1 = parseFloat(roomData.dates[dKey].p1) || 0;
                                const newP1 = values.p1 !== undefined ? parseFloat(values.p1) : oldP1;

                                if (values.p1 !== undefined) roomData.dates[dKey].p1 = String(values.p1);
                                if (values.p2 !== undefined) roomData.dates[dKey].p2 = String(values.p2);
                                if (values.p3 !== undefined) roomData.dates[dKey].p3 = String(values.p3);

                                if (values.p1 !== undefined && oldP1 !== newP1) {
                                    roomData.dates[dKey].lm = {
                                        u: jobData.worker || "Admin",
                                        t: nowFormatted,
                                        o: oldP1,
                                        n: newP1,
                                        s: "system",
                                        ts: Date.now()
                                    };
                                }
                            });
                            await roomDocRef.set(roomData, { merge: true });
                        } catch (cacheErr) {
                            console.error(`[PriceJob ${jobId}] 캐시 패치 실패 roomId=${rid}:`, cacheErr.message);
                        }
                    }
                    console.log(`[PriceJob ${jobId}] 배치 ${b + 1}/${batches.length} 성공 (${batchRoomIds.length}개 roomId, non-array response)`);
                }
            } catch (err) {
                // HTTP-level 실패 (429, 네트워크 에러 등) — 일시적 오류는 재시도 (queued), 치명적 오류만 failed 기록
                const errorStr = String(err?.message || err?.response?.data?.error || "").toLowerCase();
                const errStatus = err?.response?.status;
                const errCode = err?.code;
                
                const isRateLimit = err?.isRateLimit || errStatus === 429 || errorStr.includes("limit exceeded") || errorStr.includes("too many requests");
                const isTransient = [500, 502, 503, 504].includes(errStatus) || 
                                    ["ECONNABORTED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND"].includes(errCode) || 
                                    errorStr.includes("timeout") || 
                                    errorStr.includes("network error") ||
                                    errorStr.includes("low credit");

                if (isRateLimit || isTransient) {
                    const remainingRoomIds = batches.slice(b).flat().map(String);
                    const remainingRoomIdSet = new Set(remainingRoomIds);
                    const remainingRoomUpdates = effectiveRoomUpdates.filter((item) => remainingRoomIdSet.has(String(item.roomId)));
                    await jobRef.update({
                        status: "queued",
                        startedAt: null,
                        roomUpdates: remainingRoomUpdates,
                        roomIds: remainingRoomIds,
                        "progress.processed": processedCount,
                        "progress.results": results,
                        error: null,
                        cooldownDeferredAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                    console.warn(`[PriceJob ${jobId}] transient error (${err.message}); requeued ${remainingRoomIds.length} remaining roomIds`);
                    return {
                        skipped: true,
                        reason: isRateLimit ? "beds24_api_cooldown" : "transient_api_error"
                    };
                }
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

        // ★ coalesced secondary jobs 최종 상태 동기화 (primary 결과 확정 후)
        if (coalescedJobIds.length > 0) {
            try {
                const secFinalUpdate = {
                    status: finalStatus,
                    completedAt: admin.firestore.FieldValue.serverTimestamp(),
                    failedRoomIds: [],
                    error: finalStatus !== "completed" ? `primary job ${jobId} ${finalStatus}` : null
                };
                const secBatch = db.batch();
                coalescedJobIds.forEach(sjId => {
                    secBatch.update(db.collection("beds24_price_jobs").doc(sjId), secFinalUpdate);
                });
                await secBatch.commit();
                console.log(`[PriceJob ${jobId}] Secondary ${coalescedJobIds.length}개 최종 상태 동기화: ${finalStatus}`);
            } catch (secErr) {
                console.error(`[PriceJob ${jobId}] Secondary 상태 동기화 실패:`, secErr.message);
            }
        }

        // ★ 실제 완료 결과 기준으로 price_change_logs 기록 (queued 시점 프론트 가짜 로그 대신)
        try {
            // 1. roomId → room name 역 매핑 (building 기준)
            const buildingRoomList = BUILDING_ROOMS[building] || [];
            const roomIdToName = {};
            buildingRoomList.forEach(r => { if (!roomIdToName[r.roomId]) roomIdToName[r.roomId] = r.name; });

            // 2. YYYYMMDD → YYYY-MM-DD 변환 헬퍼
            const toDateStr = (yyyymmdd) => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
            const mergedDates = {};
            effectiveRoomUpdates.forEach((item) => {
                Object.entries(item.dates || {}).forEach(([dKey, val]) => {
                    mergedDates[dKey] = val;
                });
            });
            const sortedDateKeys = Object.keys(mergedDates).sort();
            const dateFrom = sortedDateKeys.length > 0 ? toDateStr(sortedDateKeys[0]) : null;
            const dateTo = sortedDateKeys.length > 0 ? toDateStr(sortedDateKeys[sortedDateKeys.length - 1]) : null;

            // 3. 성공한 roomId 기준 표시용 객실명 (중복 제거)
            const successRoomIds = [...new Set(results.filter(r => r.success).map(r => String(r.roomId)))];
            const baseRoomIds = successRoomIds.length > 0 ? successRoomIds : roomIds.map(String);
            const roomNames = [...new Set(baseRoomIds.map(rid => roomIdToName[rid] || rid))];

            // 4. priceSnapshot — 실제 가격이 변경된 항목만 (oldPrice != newPrice)
            const priceSnapshotAll = [];
            successRoomIds.forEach(rid => {
                const roomUpdate = roomUpdateByRoomId[rid];
                const rName = roomUpdate?.roomName || roomIdToName[rid] || rid;
                Object.keys(roomUpdate?.dates || {}).sort().forEach(dKey => {
                    priceSnapshotAll.push({
                        date: toDateStr(dKey),
                        room: rName,
                        oldPrice: oldPricesByRoom[rid]?.[dKey] || 0,
                        newPrice: parseInt(roomUpdate?.dates?.[dKey]?.p1) || 0
                    });
                });
            });
            // 가격 변동 없는 날짜(minStay/numAvail만 변경된 경우) 제외
            const priceSnapshot = priceSnapshotAll.filter(p => p.oldPrice !== p.newPrice);

            // 실제 가격 변동이 없으면 로그 skip
            if (priceSnapshot.length === 0) {
                console.log(`[PriceJob ${jobId}] 가격 변동 없음 (minStay/재고만 변경), price_change_logs skip`);
            } else {
                const avgOldPrice = Math.round(priceSnapshot.reduce((s, p) => s + p.oldPrice, 0) / priceSnapshot.length);
                const avgNewPrice = Math.round(priceSnapshot.reduce((s, p) => s + p.newPrice, 0) / priceSnapshot.length);
                await writePriceChangeLogChunks({
                    companyId: jobCompanyId || null,
                    jobId,
                    building: building || "unknown",
                    rooms: roomNames,
                    dateFrom,
                    dateTo,
                    totalDays: sortedDateKeys.length,
                    dates: mergedDates,
                    oldPrice: avgOldPrice,
                    newPrice: avgNewPrice,
                    success: finalStatus === "completed",
                    errorMessage: failedRoomIds.length > 0 ? `${failedRoomIds.length}개 roomId 실패: ${failedRoomIds.join(", ")}` : null,
                    worker: jobWorker || "System (Queue)",
                    workerEmail: jobWorkerEmail || null,
                    origin: "queue_worker",
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    details: results.map(r => ({ room: roomIdToName[String(r.roomId)] || String(r.roomId), success: r.success, error: r.error || null }))
                }, priceSnapshot);
            }
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
        // coalesced secondary jobs도 failed 동기화
        if (coalescedJobIds && coalescedJobIds.length > 0) {
            try {
                const secBatch = db.batch();
                coalescedJobIds.forEach(sjId => {
                    secBatch.update(db.collection("beds24_price_jobs").doc(sjId), {
                        status: "failed",
                        completedAt: admin.firestore.FieldValue.serverTimestamp(),
                        error: `primary job ${jobId} failed`
                    });
                });
                await secBatch.commit();
            } catch (_) {}
        }
        console.error(`[PriceJob ${jobId}] 처리 중 오류:`, e.message);
        throw e;
    } finally {
        await releasePriceJobExecutionLock();
    }
}

// 스케줄: 1분마다 queued job 1개 직렬 처리
exports.scheduledPriceJobWorker = onSchedule({
    schedule: "every 1 minutes",
    timeoutSeconds: 540,
    memory: "16GiB",
    cpu: 4,
    maxInstances: 1
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
                const stuckData = doc.data();
                if (stuckData.coalescedIntoJobId) {
                    // coalesced secondary: primary 상태 기준으로 최종 상태 resolve (re-queue 금지)
                    try {
                        const primarySnap = await db.collection("beds24_price_jobs").doc(stuckData.coalescedIntoJobId).get();
                        const primaryStatus = primarySnap.exists ? (primarySnap.data().status || "failed") : "failed";
                        const resolvedStatus = ["completed", "failed", "partial_failed"].includes(primaryStatus) ? primaryStatus : "failed";
                        await doc.ref.update({ status: resolvedStatus, completedAt: admin.firestore.FieldValue.serverTimestamp() });
                        console.log(`[PriceJobWorker] Coalesced secondary ${doc.id} → ${resolvedStatus} (primary: ${stuckData.coalescedIntoJobId})`);
                    } catch (_) {
                        await doc.ref.update({ status: "failed", completedAt: admin.firestore.FieldValue.serverTimestamp(), error: "stuck secondary recovery" });
                    }
                } else {
                    console.log(`[PriceJobWorker] Stuck job 복구: ${doc.id}`);
                    await doc.ref.update({ status: "queued", startedAt: null });
                }
            }
        }

        // queued job 1개 처리 (createdAt 기준 oldest-first FIFO)
        const workerStartedAt = Date.now();
        const MAX_JOBS_PER_RUN = 5;
        const MAX_RUNTIME_MS = 45 * 1000;
        let processedJobs = 0;

        while (processedJobs < MAX_JOBS_PER_RUN && (Date.now() - workerStartedAt) < MAX_RUNTIME_MS) {
            const snap = await db.collection("beds24_price_jobs")
                .where("status", "==", "queued")
                .orderBy("createdAt")
                .limit(1)
                .get();
            if (snap.empty) break;

            const result = await processPriceJob(snap.docs[0].id);
            if (result?.skipped && (result.reason === "lock_busy" || result.reason === "beds24_api_cooldown")) {
                break;
            }
            processedJobs++;
        }
    } catch (e) {
        console.error("[PriceJobWorker] 오류:", e.message);
        // throw 하지 않음 — 다음 스케줄 실행 때 재시도
    }
});

// job 상태 확인 endpoint (프론트 polling용)
exports.getPriceJobStatus = onRequest({ cors: true, timeoutSeconds: 60, memory: "2GiB", maxInstances: 20 }, async (req, res) => {
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
            coalescedIntoJobId: data.coalescedIntoJobId || null,
            coalescedJobIds: data.coalescedJobIds || [],
            supersededByJobId: data.supersededByJobId || null,
            supersededByJobIds: data.supersededByJobIds || [],
            supersededKeyCount: data.supersededKeyCount || 0,
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
exports.setMinStay = onRequest({ cors: true, timeoutSeconds: 300, memory: "1GiB", cpu: 1, minInstances: 1, maxInstances: 4 }, async (req, res) => {
    try {
        const { companyId, building, roomName, roomNames: inputRoomNames, dateFrom, dateTo, minStayValue, dates, cells } = req.body;
        if (!companyId) return res.status(400).json({ success: false, error: "Missing companyId" });

        const normalizedCells = Array.isArray(cells)
            ? cells.map((cell) => {
                const normalizedDateKey = /^\d{8}$/.test(String(cell?.dateKey || ""))
                    ? String(cell.dateKey)
                    : String(cell?.date || "").replace(/-/g, "");
                const parsedMinStay = parseInt(cell?.minStay ?? cell?.m ?? minStayValue, 10);
                return {
                    roomName: String(cell?.roomName || cell?.room || "").trim(),
                    dateKey: normalizedDateKey,
                    roomId: cell?.roomId ? String(cell.roomId) : "",
                    minStay: Number.isFinite(parsedMinStay) ? parsedMinStay : 1
                };
            }).filter((cell) => cell.roomName && /^\d{8}$/.test(cell.dateKey))
            : [];

        const roomNameList = normalizedCells.length > 0
            ? [...new Set(normalizedCells.map((cell) => cell.roomName))]
            : (inputRoomNames || (roomName ? [roomName] : []));
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
        const cellsByRoomName = normalizedCells.reduce((acc, cell) => {
            if (!acc[cell.roomName]) acc[cell.roomName] = [];
            acc[cell.roomName].push(cell);
            return acc;
        }, {});

        for (const rn of roomNameList) {
            const roomInfos = roomInfosByName[rn];
            const getActiveRoomId = (dateKey, explicitRoomId = "") => {
                if (explicitRoomId && roomInfos.some((info) => String(info.roomId) === String(explicitRoomId))) {
                    return String(explicitRoomId);
                }
                if (roomInfos.length === 1) return String(roomInfos[0].roomId);
                const activeRoomIds = [];
                for (const info of roomInfos) {
                    const rid = String(info.roomId);
                    // 날짜 데이터 자체가 없으면 판단 불가 → 비활성. 데이터는 있고 m만 비어 있으면 Beds24 기준 1박이다.
                    const dateEntry = roomCacheByRoomId[rid]?.dates?.[dateKey];
                    if (!dateEntry) continue;
                    const m = parseInt(normalizeBeds24MinStay(dateEntry.m), 10);
                    if (m >= 1 && m < INACTIVE_MS_THRESHOLD) activeRoomIds.push(rid);
                }
                if (activeRoomIds.length === 0) return null;
                if (building === "가부키초" && rn === "803호" && activeRoomIds.includes("648398")) {
                    return "648398";
                }
                if (building === "아라키초A" && rn === "501호" && activeRoomIds.includes("502229")) {
                    return "502229";
                }
                return activeRoomIds[0];
            };

            if (normalizedCells.length > 0) {
                for (const cell of cellsByRoomName[rn] || []) {
                    const v2Date = `${cell.dateKey.slice(0, 4)}-${cell.dateKey.slice(4, 6)}-${cell.dateKey.slice(6, 8)}`;
                    const rid = getActiveRoomId(cell.dateKey, cell.roomId);
                    if (!rid) { console.warn(`[setMinStay] ${rn} 날짜 ${cell.dateKey} active roomId 없음, 스킵`); continue; }
                    addToGroup(rid, v2Date, cell.minStay, cell.dateKey, String(cell.minStay));
                }
            } else if (dates && typeof dates === "object") {
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

        // 실제 Beds24 전송은 processPriceJob이 담당한다.
        const allTargetRoomIds = [];
        for (const [roomId, group] of Object.entries(groupByRoomId)) {
            group.calendar = consolidateCalendarRanges(group.calendar);
            allTargetRoomIds.push(roomId);
        }
        const minStayRoomUpdates = Object.entries(groupByRoomId).map(([roomId, group]) => ({
            roomId: String(roomId),
            roomName: getRoomNameByRoomId(roomId),
            dates: group.datesToUpdate,
            calendarUpdates: group.calendar
        }));

        const jobRef = await db.collection("beds24_price_jobs").add({
            companyId,
            building,
            roomIds: allTargetRoomIds.map(String),
            dates: null,
            calendarUpdates: null,
            roomUpdates: minStayRoomUpdates,
            worker: "Min Stay Queue",
            workerEmail: null,
            status: "queued",
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            startedAt: null,
            completedAt: null,
            progress: { processed: 0, total: allTargetRoomIds.length, results: [] },
            failedRoomIds: [],
            retryCount: 0,
            error: null,
            jobType: "min_stay"
        });

        console.log(`[setMinStay] Job created: ${jobRef.id} (${allTargetRoomIds.length} roomId)`);
        return res.json({
            success: true,
            queued: true,
            jobId: jobRef.id,
            message: "MinStay update queued",
            roomIds: allTargetRoomIds.map(String),
            results: allTargetRoomIds.map((rid) => ({ roomId: String(rid), success: true, queued: true }))
        });

    } catch (e) {
        console.error("setMinStay Error:", e.response?.data || e.message);
        res.status(500).json({ success: false, error: e.response?.data?.error || e.message });
    }
});

async function tryAcquireWebhookPriceSyncLock() {
    const queuedPriceJob = await getNextQueuedPriceJobHint();
    if (queuedPriceJob) {
        return {
            acquired: false,
            yieldedToManualJob: true,
            queuedJobId: queuedPriceJob.id
        };
    }

    const result = await acquirePriceSyncLock("priceWebhook");
    return {
        acquired: result.acquired,
        yieldedToManualJob: false,
        queuedJobId: null
    };
}
async function releaseWebhookPriceSyncLock() {
    await releasePriceSyncLock();
}

async function fetchSingleRoomPriceCacheSnapshot(roomId) {
    const apiGuard = await getBeds24ApiGuardState();
    if (apiGuard.active) {
        console.log(`[fetchSingleRoomPriceCacheSnapshot] Beds24 API cooldown active (${apiGuard.remainingSec}s remaining)`);
        return {
            success: false,
            skipped: true,
            reason: "beds24_api_cooldown",
            cooldownRemainingSec: apiGuard.remainingSec
        };
    }
    const tokyoNow = dayjs().utcOffset(9);
    const fromDate = tokyoNow.format("YYYY-MM-DD");
    const toDate = tokyoNow.add(12, "month").format("YYYY-MM-DD");

    const pageResult = await beds24GetRoomCalendarAllPages({
        roomId: parseInt(roomId),
        startDate: fromDate,
        endDate: toDate,
        includePrices: true,
        includeLinkedPrices: true,
        includeMinStay: true,
        includeMaxStay: true,
        includeNumAvail: true,
        includeOverride: true
    }, { label: `room ${roomId}` });

    // 잘린 응답으로 캐시를 덮어쓰면 Beds24에 있는 날짜가 "없는 날짜"로 굳는다.
    if (pageResult.truncated) {
        console.error(`[fetchSingleRoomPriceCacheSnapshot] roomId=${roomId} 응답 잘림 — 캐시 갱신 skip`);
        return { success: false, skipped: true, reason: "response_truncated" };
    }

    const roomData = pageResult.roomsById.get(String(roomId));
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
                m: normalizeBeds24MinStay(entry.minStay),
                mx: String(entry.maxStay || ""),
                na: entry.numAvail !== undefined && entry.numAvail !== null ? String(entry.numAvail) : "",
                ov: entry.override ? String(entry.override) : ""
            };
        }
    });

    return { success: true, fromDate, toDate, datesObj };
}

async function cleanupStaleInventoryOverrideBlocks({
    companyId,
    roomId,
    currentDates,
    syncSource = "inventory_override_reconcile"
} = {}) {
    const roomIdStr = String(roomId || "");
    if (!companyId || !roomIdStr || !currentDates) {
        return { cleanedCount: 0 };
    }

    const staleBlockSnap = await db.collection("reservations")
        .where("companyId", "==", companyId)
        .where("roomId", "==", roomIdStr)
        .get();

    if (staleBlockSnap.empty) {
        return { cleanedCount: 0 };
    }

    const cleanupBatch = db.batch();
    const cancelledDocs = [];

    staleBlockSnap.docs.forEach((blockDoc) => {
        const blockData = blockDoc.data() || {};
        if (blockData.status !== "blackout") return;
        if (blockData.isInventoryOverrideBlock !== true) return;
        if (!String(blockDoc.id).startsWith(`inventory-blackout:${roomIdStr}:`)) return;

        const blockArrival = blockData.arrival;
        const blockDeparture = blockData.departure;
        if (!blockArrival || !blockDeparture) return;

        let hasActiveOverride = false;
        let hasSnapshotEntry = false;
        for (let cursor = dayjs(blockArrival), end = dayjs(blockDeparture); cursor.isBefore(end); cursor = cursor.add(1, "day")) {
            const dateKey = cursor.format("YYYYMMDD");
            if (currentDates[dateKey] === undefined) continue;
            hasSnapshotEntry = true;
            if (String(currentDates[dateKey]?.ov || "").toLowerCase() === "blackout") {
                hasActiveOverride = true;
                break;
            }
        }

        if (!hasSnapshotEntry || hasActiveOverride) return;

        const cancelTime = new Date().toISOString();
        const cancelledDoc = enrichReservationDocument({
            ...blockData,
            id: String(blockData.id || blockDoc.id),
            bookId: String(blockData.bookId || blockDoc.id),
            status: "cancelled",
            cancelTime,
            cancelReason: blockData.cancelReason || "Beds24 calendar override removed",
            syncNote: "Beds24 calendar override removed (auto-cleanup)",
            lastEventType: "auto_cancel_inventory_override_removed"
        }, {
            companyId: getEffectiveCompanyId(blockData),
            syncSource,
            syncMode: "webhook"
        });

        cleanupBatch.set(blockDoc.ref, cancelledDoc, { merge: true });
        cancelledDocs.push(cancelledDoc);
    });

    if (cancelledDocs.length === 0) {
        return { cleanedCount: 0 };
    }

    await cleanupBatch.commit();

    try {
        await scheduleOutputUpdates(cancelledDocs.map((item) => buildReservationOutputImpact(item)));
    } catch (outputErr) {
        console.warn("[Inventory Override Cleanup] Output update failed:", outputErr.message);
    }

    return { cleanedCount: cancelledDocs.length };
}

async function syncSingleRoomPriceCache(building, roomId, roomName, { reason = "webhook", companyId } = {}) {
    const liveSnapshot = await fetchSingleRoomPriceCacheSnapshot(roomId);
    if (!liveSnapshot?.success) {
        return { success: false, skipped: true };
    }
    const { fromDate, toDate, datesObj } = liveSnapshot;

    const roomDocRef = db.collection("price_sync").doc(building).collection("rooms").doc(String(roomId));
    
    // 주황색 점(lm) 정보 보존을 위해 기존 데이터 가져오기 (v2.1)
    const oldSnap = await roomDocRef.get();
    if (oldSnap.exists) {
        const oldDates = oldSnap.data()?.dates || {};
        Object.keys(datesObj).forEach(dKey => {
            const oldP1 = parseFloat(oldDates[dKey]?.p1) || 0;
            const newP1 = parseFloat(datesObj[dKey].p1) || 0;

            if (oldP1 !== newP1 && (oldP1 > 0 || newP1 > 0)) {
                datesObj[dKey].lm = {
                    u: "Beds24",
                    t: dayjs().utcOffset(9).format("MM-DD HH:mm"),
                    o: oldP1,
                    n: newP1,
                    s: "beds24",
                    ts: Date.now()
                };
            } else if (oldDates[dKey]?.lm) {
                datesObj[dKey].lm = oldDates[dKey].lm;
            }
        });
    }

    await roomDocRef.set({
        roomName,
        roomId: String(roomId),
        dates: datesObj,
        outputImpact: buildPriceOutputImpact({ building, roomName, roomId: String(roomId), fromDate, toDate }),
        lastSyncRoom: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    await mergePriceSyncMonthCache(building, roomId, roomName, datesObj, { cacheComplete: true });

    try {
        await cleanupStaleInventoryOverrideBlocks({
            companyId,
            roomId: String(roomId),
            currentDates: datesObj,
            syncSource: `syncSingleRoomPriceCache:${reason}`
        });
    } catch (cleanupErr) {
        console.warn("[syncSingleRoomPriceCache] Inventory override cleanup failed:", cleanupErr.message);
    }

    return { success: true, newDates: datesObj };
}

// ==========================================
// 가격/재고 변경 웹훅: Beds24에서 발생한 변경 사항 감지
// ==========================================
exports.priceWebhook = onRequest({ cors: true, timeoutSeconds: 300, memory: "16GiB", cpu: 4, maxInstances: 4 }, async (req, res) => {
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

            if (building === "Unknown") {
                console.warn(`[priceWebhook] Unknown roomId=${roomId}; ignored without Beds24 API call`);
                return res.status(200).send("OK");
            }

            const mappedProperty = PROPERTIES.find((prop) => prop.name === building && !prop.disabled);
            const payloadPropertyId = data.propId || data.propertyId || data.propid;
            if (!mappedProperty || (payloadPropertyId && String(mappedProperty.v2Id) !== String(payloadPropertyId))) {
                console.warn(`[priceWebhook] Property mismatch for roomId=${roomId}; ignored without Beds24 API call`);
                return res.status(200).send("OK");
            }

            const companyId = mappedProperty.companyId || DEFAULT_COMPANY_ID;
            const roomIdStr = String(roomId);
            const relatedRoomIds = getRelatedBeds24RoomIds(building, roomName, roomIdStr);

            // Read old cached prices before sync to detect price diffs
            let oldDates = null;
            try {
                const oldSnap = await db.collection("price_sync").doc(building).collection("rooms").doc(String(roomId)).get();
                if (oldSnap.exists) {
                    oldDates = oldSnap.data()?.dates || null;
                }
            } catch (_) { /* cache miss is fine */ }

            // price_sync 캐시 무효화 (기본 — 즉시 sync 성공 시 제거됨)
            const priceSyncDoc = db.collection("price_sync").doc(building);
            const snap = await priceSyncDoc.get();
            const priceSyncState = snap.data() || {};
            const existingIds = new Set((priceSyncState.invalidatedRoomIds || []).map(String));
            const invalidatedAt = priceSyncState.invalidatedAt?.toDate?.() || null;
            const recentlyDuplicatedWhileInvalidated = relatedRoomIds.every((id) => existingIds.has(id)) &&
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

            relatedRoomIds.forEach((id) => existingIds.add(id));
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

            const apiGuard = await getBeds24ApiGuardState();
            const lockState = apiGuard.active ? { acquired: false } : await tryAcquireWebhookPriceSyncLock();
            let syncResult = null;
            let syncError = null;
            let skipReason = null;

            if (apiGuard.active) {
                skipReason = `Beds24 API cooldown active (${apiGuard.remainingSec}s remaining)`;
                console.log(`[priceWebhook] immediate sync skipped (${skipReason}) -> invalidation fallback`);
            } else if (lockState.acquired) {
                try {
                    const groupSyncResults = await Promise.allSettled(relatedRoomIds.map((relatedRoomId) =>
                        syncSingleRoomPriceCache(
                            building,
                            relatedRoomId,
                            getRoomNameByRoomId(relatedRoomId),
                            { reason: "webhook_room_group", companyId }
                        )
                    ));
                    const failedGroupSync = groupSyncResults.find((result) =>
                        result.status === "rejected" || !result.value?.success
                    );
                    if (failedGroupSync) {
                        const failureMessage = failedGroupSync.status === "rejected"
                            ? failedGroupSync.reason?.message
                            : failedGroupSync.value?.reason || "room group sync skipped";
                        throw new Error(failureMessage || "room group sync failed");
                    }
                    const triggerRoomIndex = relatedRoomIds.indexOf(roomIdStr);
                    const triggerRoomResult = triggerRoomIndex >= 0
                        ? groupSyncResults[triggerRoomIndex]?.value
                        : groupSyncResults[0]?.value;
                    syncResult = {
                        ...(triggerRoomResult || {}),
                        success: true,
                        syncedRoomIds: relatedRoomIds
                    };
                } catch (syncErr) {
                    syncError = syncErr;
                    console.error(`[priceWebhook] 즉시 동기화 실패, invalidation fallback: ${syncErr.message}`);
                }
            } else {
                skipReason = "sync lock 사용 중 (scheduled/webhook 실행 중)";
                console.log(`[priceWebhook] 즉시 sync 불가 (${skipReason}) → invalidation fallback`);
            }

            // Build price diff from old cache vs new sync data
            // oldDates가 없어도(첫 sync, 캐시 만료 등) newDates 기준으로 diff 계산
            let priceDiffs = [];
            if (syncResult?.success && syncResult.newDates) {
                const tokyoToday = dayjs().utcOffset(9).format("YYYYMMDD");
                const diffLimit = dayjs().utcOffset(9).add(12, "month").format("YYYYMMDD");
                for (const [dk, newVal] of Object.entries(syncResult.newDates)) {
                    if (dk < tokyoToday || dk > diffLimit) continue;
                    const oldVal = oldDates?.[dk]; // optional: oldDates 없으면 undefined → oldP1 = 0
                    const oldP1 = parseFloat(oldVal?.p1) || 0;
                    const newP1 = parseFloat(newVal?.p1) || 0;
                    if (oldP1 !== newP1 && (oldP1 > 0 || newP1 > 0)) {
                        priceDiffs.push({ date: `${dk.slice(0,4)}-${dk.slice(4,6)}-${dk.slice(6,8)}`, oldPrice: oldP1, newPrice: newP1 });
                    }
                }
                priceDiffs.sort((a, b) => a.date.localeCompare(b.date));
            }

            // Write price_change_logs — 가격 변동이 있을 때만 기록 (minStay/numAvail 단독 변경은 제외)
            if (priceDiffs.length > 0) {
                try {
                    const logData = {
                        companyId,
                        timestamp: admin.firestore.FieldValue.serverTimestamp(),
                        building,
                        rooms: [roomName],
                        roomId: roomIdStr,
                        success: true,
                        worker: "Beds24 System",
                        origin: "Beds24 External Change",
                        notes: `Beds24 detected a price change for room ${roomName}.`,
                        priceSnapshot: priceDiffs,
                        oldPrice: Math.round(priceDiffs.reduce((s, d) => s + d.oldPrice, 0) / priceDiffs.length),
                        newPrice: Math.round(priceDiffs.reduce((s, d) => s + d.newPrice, 0) / priceDiffs.length),
                        dateFrom: priceDiffs[0].date,
                        dateTo: priceDiffs[priceDiffs.length - 1].date,
                        totalDays: priceDiffs.length
                    };
                    await db.collection("price_change_logs").add(logData);
                } catch (logErr) {
                    console.error("[priceWebhook] price_change_logs write failed:", logErr.message);
                }
            } else {
                console.log(`[priceWebhook] 가격 변동 없음 (minStay/numAvail 변경만), 로그 skip: ${building} ${roomName}`);
            }

            try {
                if (syncResult?.success) {
                    await db.runTransaction(async (tx) => {
                        const snap = await tx.get(priceSyncDoc);
                        const data = snap.data() || {};
                        const currentIds = new Set((data.invalidatedRoomIds || []).map(String));
                        relatedRoomIds.forEach((id) => currentIds.delete(id));
                        const remaining = [...currentIds];
                        const updates = {
                            invalidatedRoomIds: remaining,
                            pendingInvalidationCount: remaining.length,
                            lastWebhookAt: admin.firestore.FieldValue.serverTimestamp(),
                            lastSyncAt: admin.firestore.FieldValue.serverTimestamp()
                        };
                        if (remaining.length === 0) {
                            updates.invalidatedAt = admin.firestore.FieldValue.delete();
                            updates.invalidatedBy = admin.firestore.FieldValue.delete();
                        }
                        tx.update(priceSyncDoc, updates);
                    });
                    await recordPriceSyncAudit({
                        syncType: "webhook",
                        syncVariant: "immediate",
                        syncSource: "beds24_price_webhook",
                        companyId,
                        fetchedCount: relatedRoomIds.length,
                        upsertedCount: relatedRoomIds.length,
                        note: `immediate room-group sync: ${building} ${roomName} (${relatedRoomIds.join(",")}), priceDiffs=${priceDiffs.length}`,
                        metadata: {
                            building,
                            roomName,
                            roomId: roomIdStr,
                            relatedRoomIds,
                            action: action || "UNKNOWN",
                            priceDiffCount: priceDiffs.length
                        }
                    });
                } else {
                    const fallbackVariant = skipReason ? "skipped" : (syncResult?.skipped ? "skipped" : (syncError ? "failed" : "queued"));
                    await db.collection("price_sync").doc(building).update({
                        invalidatedRoomIds: admin.firestore.FieldValue.arrayUnion(...relatedRoomIds),
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
                if (lockState?.acquired) await releaseWebhookPriceSyncLock();
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
exports.beds24BookingWebhook = onRequest({ cors: true, timeoutSeconds: 120, memory: "16GiB", cpu: 4, maxInstances: 4 }, async (req, res) => {
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
        try {
            await invalidatePriceCacheForReservationMutations(
                [{ beforeData: existingData, afterData: normalized, mutationSummary }],
                companyId,
                "beds24_booking_webhook"
            );
        } catch (error) {
            console.warn("[Booking Webhook] price cache invalidation failed:", error.message);
            await sendSyncAlert("beds24BookingWebhook price cache invalidation failed", [
                `companyId=${companyId}`,
                `bookingId=${booking.id}`,
                String(error.message || error)
            ]);
        }
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
        if (
            normalized.building !== "다이쿄초" &&
            shouldQueueSlackCleaningCorrection(existingData, normalized, mutationSummary.changedFields, todayKst)
        ) {
            try {
                await queueSlackCleaningCorrection({
                    companyId,
                    bookingId: booking.id,
                    targetDate: todayKst,
                    changedFields: mutationSummary.changedFields.filter((field) => SLACK_CLEANING_CORRECTION_FIELDS.has(field))
                });
                console.log(`[Booking Webhook] 청소/셋팅 정정 작업 등록: ${booking.id} (${mutationSummary.changedFields.join(",")})`);
            } catch (e) {
                console.warn("[Booking Webhook] 청소/셋팅 정정 작업 등록 실패:", e.message);
                await sendSyncAlert("Slack cleaning correction queue failed", [
                    `bookingId=${booking.id}`,
                    `targetDate=${todayKst}`,
                    String(e.message || e)
                ]);
            }
        }

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

        // 당일 취소 알림: 취소 건은 기간/채널 제한 없이 당일취소알람 채널로 전송
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
// 청소/셋팅 명단 정정 작업 처리
// ==========================================
exports.processSlackCleaningCorrectionJob = onDocumentWritten({
    document: "slack_cleaning_correction_jobs/{jobId}",
    timeoutSeconds: 540,
    memory: "16GiB",
    cpu: 4,
    concurrency: 1,
    maxInstances: 1,
    secrets: HOTELSMART_SECRETS
}, async (event) => {
    const jobSnapshot = event.data?.after;
    if (!jobSnapshot?.exists || jobSnapshot.data()?.status !== "queued") return;

    const jobRef = jobSnapshot.ref;
    let jobData = null;
    const claimed = await db.runTransaction(async (transaction) => {
        const freshSnapshot = await transaction.get(jobRef);
        if (!freshSnapshot.exists || freshSnapshot.data()?.status !== "queued") return false;

        jobData = freshSnapshot.data();
        transaction.update(jobRef, {
            status: "processing",
            startedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return true;
    });

    if (!claimed || !jobData) return;

    try {
        if (jobData.companyId !== DEFAULT_COMPANY_ID || !jobData.targetDate) {
            await jobRef.update({
                status: "skipped",
                resultReason: "invalid_job_scope",
                completedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            return;
        }

        const result = await sendSlackCleaningReportCorrectionIfSent(jobData.targetDate);
        await jobRef.update({
            status: result.sent ? "completed" : "skipped",
            resultReason: result.reason || "unknown",
            completedAt: admin.firestore.FieldValue.serverTimestamp()
        });
    } catch (e) {
        await jobRef.update({
            status: "failed",
            error: String(e.message || e).slice(0, 1000),
            completedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        await sendSyncAlert("Slack cleaning correction failed", [
            `jobId=${event.params?.jobId || "-"}`,
            `targetDate=${jobData.targetDate || "-"}`,
            String(e.message || e)
        ]);
        throw e;
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

function getInventoryOverrideEndDate(departure) {
    return dayjs(departure).subtract(1, "day").format("YYYY-MM-DD");
}

function getInventoryOverrideBlockDocId(roomId, arrival, departure) {
    return `inventory-blackout:${String(roomId)}:${arrival}:${departure}`;
}

function getBeds24BatchResult(apiResponse, index = 0) {
    if (Array.isArray(apiResponse?.data)) {
        return apiResponse.data[index];
    }
    if (Array.isArray(apiResponse?.data?.data)) {
        return apiResponse.data.data[index];
    }
    return apiResponse?.data;
}

async function patchPriceSyncForBlackout(building, roomId, arrival, departure) {
    const roomDocRef = db.collection("price_sync").doc(building).collection("rooms").doc(String(roomId));
    const snap = await roomDocRef.get();
    if (!snap.exists) return;
    const currentDates = snap.data()?.dates || {};
    const updates = {};
    const datesPatch = {};
    let d = dayjs(arrival);
    const depDate = dayjs(departure);
    while (d.isBefore(depDate)) {
        const dateKey = d.format("YYYYMMDD");
        if (currentDates[dateKey] !== undefined) {
            updates[`dates.${dateKey}.ov`] = "blackout";
            datesPatch[dateKey] = { ov: "blackout" };
        }
        d = d.add(1, "day");
    }
    if (Object.keys(updates).length > 0) {
        await roomDocRef.update(updates);
        await patchPriceSyncMonthCacheFields(building, roomId, snap.data()?.roomName || getRoomNameByRoomId(roomId), datesPatch);
    }
}

async function patchPriceSyncForBlackoutClear(building, roomId, arrival, departure, restoreNumAvailByDate = null) {
    const roomDocRef = db.collection("price_sync").doc(building).collection("rooms").doc(String(roomId));
    const snap = await roomDocRef.get();
    if (!snap.exists) return;
    const currentDates = snap.data()?.dates || {};
    const updates = {};
    const datesPatch = {};
    let d = dayjs(arrival);
    const depDate = dayjs(departure);
    while (d.isBefore(depDate)) {
        const dateKey = d.format("YYYYMMDD");
        const dayKey = d.format("YYYY-MM-DD");
        if (currentDates[dateKey] !== undefined) {
            // 키를 지우지 않고 ""로 덮어쓴다.
            // 전체 동기화가 override 없는 날짜에 쓰는 값과 동일한 형태이며,
            // 프론트 hasVisiblePriceCoverage는 na/ov 키의 "존재"로 캐시 완전성을 판단하므로
            // 키를 지우면 그 날짜가 포함된 화면은 세션 캐시를 못 쓰고 매번 재조회하게 된다.
            updates[`dates.${dateKey}.ov`] = "";
            datesPatch[dateKey] = { ov: "" };
            const restoredNumAvail = parseInt(restoreNumAvailByDate?.[dayKey], 10);
            if (Number.isFinite(restoredNumAvail)) {
                updates[`dates.${dateKey}.na`] = String(restoredNumAvail);
                datesPatch[dateKey].na = String(restoredNumAvail);
            }
        }
        d = d.add(1, "day");
    }
    if (Object.keys(updates).length > 0) {
        await roomDocRef.update(updates);
        await patchPriceSyncMonthCacheFields(building, roomId, snap.data()?.roomName || getRoomNameByRoomId(roomId), datesPatch);
    }
}

async function getStoredNumAvailSnapshotForBlock(building, roomId, arrival, departure) {
    if (!building || !roomId || !arrival || !departure) return {};
    const roomDocRef = db.collection("price_sync").doc(building).collection("rooms").doc(String(roomId));
    const snap = await roomDocRef.get();
    if (!snap.exists) return {};
    const currentDates = snap.data()?.dates || {};
    const restoreMap = {};
    let d = dayjs(arrival);
    const depDate = dayjs(departure);
    while (d.isBefore(depDate)) {
        const dateKey = d.format("YYYYMMDD");
        const dayKey = d.format("YYYY-MM-DD");
        const parsedNumAvail = parseInt(currentDates?.[dateKey]?.na, 10);
        if (Number.isFinite(parsedNumAvail)) {
            restoreMap[dayKey] = parsedNumAvail;
        }
        d = d.add(1, "day");
    }
    return restoreMap;
}

async function createBeds24BlackoutOverride({ roomId, arrival, departure }) {
    const endDate = getInventoryOverrideEndDate(departure);
    if (!arrival || !departure || !dayjs(departure).isAfter(dayjs(arrival), "day")) {
        throw new Error("Invalid blackout date range");
    }

    const payload = [{
        roomId: parseInt(roomId),
        calendar: [{
            from: arrival,
            to: endDate,
            override: "blackout"
        }]
    }];

            const response = await beds24PostV2WithGuard("/inventory/rooms/calendar", payload);
    const result = getBeds24BatchResult(response, 0);
    if (result?.errors && result.errors.length > 0) {
        throw new Error(result.errors.map(e => e.message).join(", "));
    }
    if (result?.success === false) {
        throw new Error("Beds24 blackout override create failed");
    }
}

async function clearBeds24BlackoutOverride({ roomId, arrival, departure, restoreNumAvailByDate = null }) {
    if (!arrival || !departure || !dayjs(departure).isAfter(dayjs(arrival), "day")) {
        throw new Error("Invalid blackout date range");
    }

    const clearUpdates = [];
    let d = dayjs(arrival);
    const depDate = dayjs(departure);
    while (d.isBefore(depDate)) {
        const dayKey = d.format("YYYY-MM-DD");
        const updateItem = {
            from: dayKey,
            to: dayKey,
            override: "none"
        };
        const restoredNumAvail = parseInt(restoreNumAvailByDate?.[dayKey], 10);
        if (Number.isFinite(restoredNumAvail)) {
            updateItem.numAvail = restoredNumAvail;
        }
        clearUpdates.push(updateItem);
        d = d.add(1, "day");
    }

    const response = await beds24PostV2WithGuard("/inventory/rooms/calendar", [{
        roomId: parseInt(roomId),
        calendar: consolidateCalendarRanges(clearUpdates)
    }]);
    const result = getBeds24BatchResult(response, 0);
    if (result?.errors && result.errors.length > 0) {
        throw new Error(result.errors.map(e => e.message).join(", "));
    }
    if (result?.success === false) {
        throw new Error("Beds24 blackout override clear failed");
    }
}

// ★ 예약 생성 - V2 마이그레이션 완료 (roomId 직접 수신)
exports.createBooking = onRequest({ cors: true, memory: "1GiB", timeoutSeconds: 120 }, async (req, res) => {
    try {
        // roomId를 직접 받음 (프론트엔드에서 전송)
        const { companyId, building, blockSegments, roomId, room, arrival, departure, guestName, numAdult, numChild, guestPhone, guestEmail, source, price, comments, staffId, operatorId, isBlock: requestedBlock } = req.body;
        if (!companyId) return res.status(400).json({ success: false, error: "Missing companyId" });
        const actorId = firstNonEmptyValue(normalizePossibleActorId(staffId), normalizePossibleActorId(operatorId), normalizePossibleActorId(source));

        // ★ 블락 여부: 우리 시스템에서 블락으로 생성한 경우 Beds24에도 status=black으로 생성
        const explicitIsBlock = requestedBlock === true || requestedBlock === "true";
        const isBlock = explicitIsBlock || !!(
            guestName &&
            (String(guestName).toLowerCase().includes("room block") || String(guestName).toLowerCase().includes("blackout")) ||
            comments === "System Block"
        );

        // ★ multi-segment 블락: 프론트에서 blockSegments 배열로 전달된 경우 단일 HTTP 요청 안에서 직렬 처리
        if (isBlock && Array.isArray(blockSegments) && blockSegments.length > 0) {
            const bookingDate = dayjs().tz("Asia/Tokyo").format("YYYY-MM-DD");
            const results = [];

            for (const seg of blockSegments) {
                try {
                    const segRoomId = seg.roomId;
                    const segRoomName = seg.room || getRoomNameByRoomId(segRoomId);
                    const segArrival = seg.arrival;
                    const segDeparture = seg.departure;
                    const segRestoreNumAvailByDate = await getStoredNumAvailSnapshotForBlock(building, segRoomId, segArrival, segDeparture);

                    console.log(`[createBooking] 블락 segment: ${building} ${segRoomName} (roomId: ${segRoomId}) ${segArrival}~${segDeparture}`);

                    await createBeds24BlackoutOverride({ roomId: segRoomId, arrival: segArrival, departure: segDeparture });
                    await patchPriceSyncForBlackout(building, segRoomId, segArrival, segDeparture);

                    const segBookingId = getInventoryOverrideBlockDocId(segRoomId, segArrival, segDeparture);
                    const segBooking = {
                        id: String(segBookingId), bookId: String(segBookingId),
                        companyId: companyId || null, building, room: segRoomName, roomId: String(segRoomId),
                        guestName: "Room Block (Blackout)", guestEmail: "", guestPhone: "", comments: "System Block",
                        arrival: segArrival, departure: segDeparture, status: "blackout", price: 0,
                        source: "Beds24 Inventory", referer: actorId || "", apiSource: "Beds24 Inventory",
                        createdByStaffId: actorId || "", createdBySource: actorId ? "manual_request" : "",
                        lastModifiedByStaffId: actorId || "", lastModifiedBySource: actorId ? "manual_request" : "",
                        lastActorId: actorId || "", lastActorSource: actorId ? "manual_request" : "",
                        isInventoryOverrideBlock: true, inventoryOverrideType: "blackout",
                        preBlockNumAvailByDate: segRestoreNumAvailByDate,
                        updatedAt: new Date()
                    };
                    const segEnriched = { ...segBooking, bookDate: bookingDate, stayMonth: segArrival ? String(segArrival).slice(0, 7) : "" };
                    await db.collection("reservations").doc(String(segBookingId)).set(
                        enrichReservationDocument(segEnriched, { companyId: companyId || DEFAULT_COMPANY_ID, syncSource: "manual_create_inventory_override", syncMode: "manual" }),
                        { merge: true }
                    );
                    results.push({ success: true, bookingId: segBookingId, roomId: String(segRoomId), room: segRoomName, arrival: segArrival, departure: segDeparture });

                    syncSingleRoomPriceCache(building, segRoomId, segRoomName, { reason: "manual_inventory_blackout_create", companyId })
                        .catch(cacheErr => console.warn("[createBooking] Segment cache sync failed:", cacheErr.message));
                } catch (segErr) {
                    console.error(`[createBooking] Segment failed (roomId=${seg.roomId} ${seg.arrival}~${seg.departure}):`, segErr.message);
                    results.push({ success: false, error: segErr.message, roomId: String(seg.roomId || ""), room: seg.room || "", arrival: seg.arrival, departure: seg.departure });
                }
            }

            const hasAnySuccess = results.some(r => r.success);
            const hasAnyFailure = results.some(r => !r.success);
            console.log(`[createBooking] 블락 segment 처리 완료: ${results.filter(r => r.success).length}/${results.length}`);
            res.json({ success: hasAnySuccess, partialFailure: hasAnyFailure, results });
            return;
        }

        // roomId 필수 (단일 segment 또는 수기예약)
        if (!roomId) throw new Error("Missing roomId");

        // building -> propertyId
        const propertyId = getPropertyIdByBuilding(building);
        if (!propertyId) throw new Error(`Invalid building: ${building}`);

        // room 이름 (전달받거나 roomId에서 추출)
        const roomName = room || getRoomNameByRoomId(roomId);

        // V2 API payload (배열 형식)
        let newBookingId;
        let restoreNumAvailByDate = undefined;

        console.log(`[createBooking] 예약 생성: ${building} ${roomName} (roomId: ${roomId}, propertyId: ${propertyId})${isBlock ? " [BLOCK]" : ""}`);

        if (isBlock) {
            restoreNumAvailByDate = await getStoredNumAvailSnapshotForBlock(building, roomId, arrival, departure);
            await createBeds24BlackoutOverride({ roomId, arrival, departure });
            newBookingId = getInventoryOverrideBlockDocId(roomId, arrival, departure);
            await patchPriceSyncForBlackout(building, roomId, arrival, departure);
            syncSingleRoomPriceCache(building, roomId, roomName, {
                reason: "manual_inventory_blackout_create",
                companyId
            }).catch(cacheErr => console.warn("[createBooking] Override cache sync failed:", cacheErr.message));
        } else {
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
                price: parseFloat(price) || 0
            }];
            const response = await beds24PostV2WithRetry("/bookings", payload);

            const result = Array.isArray(response.data) ? response.data[0] : response.data;

            if (result.errors && result.errors.length > 0) {
                throw new Error(result.errors.map(e => e.message).join(", "));
            }

            newBookingId = result.new?.id || result.id;
        }

        // V2 응답은 배열 형식
        // result handled inside the non-block branch

        /* legacy result handling removed

        const newBookingId = result.new?.id || result.id; // V2 응답 구조

        // Firestore에도 저장 (블락이면 status=blackout, 수기 예약이면 confirmed)
        */
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
            source: isBlock ? "Beds24 Inventory" : (source || "Direct"),
            referer: actorId || "",
            apiSource: isBlock ? "Beds24 Inventory" : (source || "Direct"),
            createdByStaffId: actorId || "",
            createdBySource: actorId ? "manual_request" : "",
            lastModifiedByStaffId: actorId || "",
            lastModifiedBySource: actorId ? "manual_request" : "",
            lastActorId: actorId || "",
            lastActorSource: actorId ? "manual_request" : "",
            isInventoryOverrideBlock: isBlock,
            inventoryOverrideType: isBlock ? "blackout" : "",
            ...(isBlock ? { preBlockNumAvailByDate: restoreNumAvailByDate } : {}),
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
                syncSource: isBlock ? "manual_create_inventory_override" : "manual_create_booking",
                syncMode: "manual"
            }),
            { merge: true }
        );
        // ★ 핵심 작업(Beds24 + Firestore) 완료 → 즉시 응답
        console.log(`[createBooking] 예약 생성 성공: bookingId=${newBookingId}`);
        res.json({ success: true, bookingId: newBookingId });

        // 후처리: fire-and-forget (응답 후 백그라운드 실행, 실패해도 사용자 응답 영향 없음)
        if (!isBlock) {
            void (async () => {
                try {
                    await scheduleOutputUpdates([buildReservationOutputImpact(newBookingEnriched)]);
                    console.log(`[createBooking] BG: scheduleOutputUpdates 완료 bookingId=${newBookingId}`);
                } catch (e) {
                    console.warn("[createBooking] BG: scheduleOutputUpdates 실패:", e.message);
                }
                try {
                    await refreshHomeDashboardSummarySafe(companyId || DEFAULT_COMPANY_ID, "manual_create_booking", "createBooking");
                    console.log(`[createBooking] BG: refreshHomeDashboard 완료`);
                } catch (e) {
                    console.warn("[createBooking] BG: refreshHomeDashboard 실패:", e.message);
                }
            })();
        }
    } catch (e) {
        console.error("createBooking Error:", e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==========================================
// 예약 수정 (우리 시스템 -> Beds24 -> Firebase)
// ==========================================
// ★ 예약 수정 - V2 마이그레이션 완료
exports.updateBooking = onRequest({ cors: true, memory: "512MiB", timeoutSeconds: 120 }, async (req, res) => {
    try {
        const { bookId, companyId, ...updates } = req.body;

        // 1. 필수 파라미터 검증
        if (!companyId) return res.status(400).json({ success: false, error: "Missing companyId" });
        if (!bookId) return res.status(400).json({ success: false, error: "Missing bookId" });
        const bookIdNum = parseInt(bookId, 10);
        if (isNaN(bookIdNum)) return res.status(400).json({ success: false, error: "Invalid bookId" });

        // 2. Firestore 문서 존재 및 companyId 격리 검증 (Beds24 호출 전)
        const existingSnap = await db.collection("reservations").doc(String(bookId)).get();
        if (!existingSnap.exists) {
            return res.status(404).json({ success: false, error: "Reservation not found" });
        }
        const existingData = existingSnap.data();
        const effectiveCompanyId = getEffectiveCompanyId(existingData);
        if (effectiveCompanyId && effectiveCompanyId !== companyId) {
            return res.status(403).json({ success: false, error: "companyId mismatch" });
        }

        // 3. Beds24 V2 POST /bookings 페이로드 구성
        //    필드 존재 여부 기반(hasOwnProperty)으로 매핑 — truthy 체크 아님
        const hasField = (field) => Object.prototype.hasOwnProperty.call(updates, field);
        const normalizeStr = (v) => (v == null ? "" : String(v));

        const payload = { id: bookIdNum };

        // arrival/departure: trim 기반 검증 — 공백만 있는 입력도 거부하여 Beds24/Firestore 불일치 방지
        if (hasField("arrival")) {
            const arrivalVal = String(updates.arrival ?? "").trim();
            if (!arrivalVal) return res.status(400).json({ success: false, error: "arrival cannot be empty" });
            payload.arrival = arrivalVal;
        }
        if (hasField("departure")) {
            const departureVal = String(updates.departure ?? "").trim();
            if (!departureVal) return res.status(400).json({ success: false, error: "departure cannot be empty" });
            payload.departure = departureVal;
        }

        if (hasField("guestName")) {
            const trimmed = String(updates.guestName || "").trim();
            if (!trimmed) return res.status(400).json({ success: false, error: "guestName cannot be empty" });
            const parts = trimmed.split(/\s+/);
            payload.firstName = parts[0];
            payload.lastName = parts.slice(1).join(" ") || ".";
        }

        if (hasField("numAdult")) {
            const n = parseInt(updates.numAdult, 10);
            if (isNaN(n) || n < 1) return res.status(400).json({ success: false, error: "numAdult must be >= 1" });
            payload.numAdult = n;
        }
        // numChild: 0도 유효한 값이므로 hasField 기반으로 처리
        if (hasField("numChild")) {
            const n = parseInt(updates.numChild, 10);
            payload.numChild = isNaN(n) ? 0 : Math.max(0, n);
        }

        if (hasField("guestEmail")) payload.email = normalizeStr(updates.guestEmail);
        if (hasField("guestPhone")) {
            payload.phone = normalizeStr(updates.guestPhone);
            payload.mobile = normalizeStr(updates.guestPhone);
        }
        // guestCountry, arrivalTime: 공식 Beds24 V2 POST /bookings Swagger 접근 불가 + createBooking
        // 실제 사용 페이로드에도 해당 필드 없음 → 쓰기 지원 미확인.
        // Beds24 페이로드에 포함하지 않고 Firestore에만 저장 (의도적 정책, canonicalUpdates 참조).
        // 공식 문서에서 "country", "arrivalTime" 필드가 POST /bookings에서 쓰기 가능하다고 확인되면
        // payload.country = normalizeStr(updates.guestCountry);
        // payload.arrivalTime = normalizeStr(updates.arrivalTime); 를 추가할 것.

        // price: price 필드 우선, 없으면 totalPrice 사용
        const rawPrice = hasField("price") ? updates.price : (hasField("totalPrice") ? updates.totalPrice : undefined);
        if (rawPrice !== undefined) {
            const p = parseFloat(rawPrice);
            if (isNaN(p)) return res.status(400).json({ success: false, error: "Invalid price value" });
            payload.price = p;
        }

        // comments: comments 필드 우선, 없으면 guestComments
        const commentsVal = hasField("comments") ? updates.comments : (hasField("guestComments") ? updates.guestComments : undefined);
        if (commentsVal !== undefined) payload.comments = normalizeStr(commentsVal);

        // 4. Beds24 V2 POST /bookings 호출
        const response = await beds24PostV2WithRetry("/bookings", [payload]);
        const result = Array.isArray(response.data) ? response.data[0] : response.data;
        if (result && result.errors && result.errors.length > 0) {
            const errMsg = result.errors.map(e => e.message || JSON.stringify(e)).join(", ");
            return res.status(502).json({ success: false, error: "Beds24 error: " + errMsg });
        }

        // 5. Firestore 업데이트 — canonical 필드만 명시적으로 저장
        const canonicalUpdates = {};
        const canonical = [
            ["guestName", updates.guestName],
            ["guestEmail", updates.guestEmail],
            ["guestPhone", updates.guestPhone],
            ["guestCountry", updates.guestCountry],
            ["arrivalTime", updates.arrivalTime],
            ["arrival", updates.arrival],
            ["departure", updates.departure],
            ["numAdult", payload.numAdult],
            ["numChild", payload.numChild],
            ["comments", commentsVal],
            ["guestComments", commentsVal],
            ["price", payload.price],
            ["totalPrice", payload.price],
        ];
        for (const [key, val] of canonical) {
            if (val !== undefined) canonicalUpdates[key] = val;
        }

        // 응답 성능 개선: 연락처/메모만 바뀐 경우 무거운 요약 재계산을 건너뜀
        const changedFields = Object.keys(canonicalUpdates);
        const outputImpactFields = new Set(["arrival", "departure", "price", "totalPrice", "numAdult", "numChild"]);
        const summaryImpactFields = new Set(["arrival", "departure", "price", "totalPrice", "numAdult", "numChild"]);
        const shouldUpdateOutput = changedFields.some((field) => outputImpactFields.has(field));
        const shouldRefreshSummary = changedFields.some((field) => summaryImpactFields.has(field));

        const actorId = firstNonEmptyValue(
            normalizePossibleActorId(req.body?.staffId),
            normalizePossibleActorId(req.body?.operatorId),
            normalizePossibleActorId(updates?.source),
            normalizePossibleActorId(existingData?.lastActorId)
        );
        await db.collection("reservations").doc(String(bookId)).set(
            enrichReservationDocument({
                ...existingData,
                ...canonicalUpdates,
                id: String(bookId),
                bookId: String(bookId),
                lastEventType: "manual_update",
                lastChangedFields: Object.keys(canonicalUpdates).slice(0, 20),
                lastEventAt: new Date().toISOString(),
                lastActorId: actorId || existingData.lastActorId || "",
                lastActorSource: actorId ? "manual_request" : (existingData.lastActorSource || ""),
                lastModifiedByStaffId: actorId || existingData.lastModifiedByStaffId || "",
                lastModifiedBySource: actorId ? "manual_request" : (existingData.lastModifiedBySource || "")
            }, {
                companyId: effectiveCompanyId || companyId,
                syncSource: "manual_update_booking",
                syncMode: "manual"
            }),
            { merge: true }
        );

        const merged = { ...existingData, ...canonicalUpdates, id: String(bookId), bookId: String(bookId) };

        // 저장 자체가 성공했으면 먼저 응답을 반환해 500 false-failure와 체감 지연을 줄임.
        res.json({ success: true });

        // 6. 후처리 (best-effort, 응답 후 실행)
        Promise.resolve().then(async () => {
            if (shouldUpdateOutput) {
                try {
                    await scheduleOutputUpdates([buildReservationOutputImpact(merged)]);
                } catch (e) {
                    console.warn("[updateBooking] Output update failed:", e.message);
                }
            }
            if (shouldRefreshSummary) {
                try {
                    await refreshHomeDashboardSummarySafe(companyId, "manual_update_booking", "updateBooking");
                } catch (e) {
                    console.warn("[updateBooking] Summary refresh failed:", e.message);
                }
            }
        }).catch((e) => {
            console.warn("[updateBooking] Background post-process failed:", e.message);
        });

    } catch (e) {
        console.error("updateBooking Error:", e);
        const errDetail = e.response?.data ? JSON.stringify(e.response.data).slice(0, 300) : e.message;
        res.status(500).json({ success: false, error: errDetail });
    }
});

// ==========================================
// 예약 취소/삭제 (Beds24 -> Firebase)
// ==========================================
// ★ 예약 취소 - V2 마이그레이션 완료
exports.cancelBooking = onRequest({ cors: true, memory: "1GiB", timeoutSeconds: 120 }, async (req, res) => {
    try {
        const { bookId, companyId, reason, cancelledBy, staffId, operatorId } = req.body;
        if (!companyId) return res.status(400).json({ success: false, error: "Missing companyId" });
        if (!bookId) return res.status(400).json({ error: "Missing bookId" });
        let existingSnap = await db.collection("reservations").doc(String(bookId)).get();
        let existingData = existingSnap.exists ? existingSnap.data() : {};
        const isInventoryOverrideBlock = existingData?.isInventoryOverrideBlock === true;

        // V2 취소: status: "cancelled" (문자열)
        if (isInventoryOverrideBlock) {
            const overrideRoomId = String(existingData.roomId || "");
            const overrideArrival = existingData.arrival || "";
            const overrideDeparture = existingData.departure || "";
            const overrideBuilding = existingData.building || req.body.building || "";
            const overrideRoomName = existingData.room || getRoomNameByRoomId(overrideRoomId);

            if (!overrideRoomId || !overrideArrival || !overrideDeparture) {
                throw new Error("Missing inventory override block metadata");
            }

            await clearBeds24BlackoutOverride({
                roomId: overrideRoomId,
                arrival: overrideArrival,
                departure: overrideDeparture,
                restoreNumAvailByDate: existingData?.preBlockNumAvailByDate || null
            });

            try {
                await patchPriceSyncForBlackoutClear(
                    overrideBuilding,
                    overrideRoomId,
                    overrideArrival,
                    overrideDeparture,
                    existingData?.preBlockNumAvailByDate || null
                );
            } catch (cacheErr) {
                console.warn("[cancelBooking] Override cache patch failed:", cacheErr.message);
            }
            syncSingleRoomPriceCache(overrideBuilding, overrideRoomId, overrideRoomName, {
                reason: "manual_inventory_blackout_remove",
                companyId
            }).catch(cacheErr => console.warn("[cancelBooking] Override cache sync failed:", cacheErr.message));
        } else {
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
        }

        /* result handled inside the cancel branch

        if (result.errors && result.errors.length > 0) {
            throw new Error(result.errors.map(e => e.message).join(", "));
        }

        // Firestore 업데이트 (문서 없으면 생성)
        */
        // existingData loaded above
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
                lastEventType: isInventoryOverrideBlock ? "manual_cancel_inventory_override" : "manual_cancel",
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
                syncSource: isInventoryOverrideBlock ? "manual_cancel_inventory_override" : "manual_cancel_booking",
                syncMode: "manual"
            }),
            { merge: true }
        );
        // ★ 핵심 작업(Beds24 취소 + Firestore 업데이트) 완료 → 즉시 응답
        console.log(`[cancelBooking] 예약 취소 완료: bookId=${bookId}`);
        res.json({ success: true });

        // 후처리: fire-and-forget (응답 후 백그라운드 실행, 실패해도 사용자 응답 영향 없음)
        if (!isInventoryOverrideBlock) {
            void (async () => {
                try {
                    const cancelledDoc = { ...existingData, id: String(bookId), bookId: String(bookId), status: "cancelled", cancelTime: new Date().toISOString() };
                    await scheduleOutputUpdates([buildReservationOutputImpact(cancelledDoc)]);
                    console.log(`[cancelBooking] BG: scheduleOutputUpdates 완료 bookId=${bookId}`);
                } catch (e) {
                    console.warn("[cancelBooking] BG: scheduleOutputUpdates 실패:", e.message);
                }
                try {
                    await refreshHomeDashboardSummarySafe(companyId, "manual_cancel_booking", "cancelBooking");
                    console.log(`[cancelBooking] BG: refreshHomeDashboard 완료`);
                } catch (e) {
                    console.warn("[cancelBooking] BG: refreshHomeDashboard 실패:", e.message);
                }
            })();
        }
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
    const salesLogExcludedBuildings = new Set(["사노시", "오쿠보A동"]);
    const countSalesLogRooms = ({ includeDaikyo }) => Object.entries(BUILDING_ROOMS)
        .filter(([building]) => !salesLogExcludedBuildings.has(building))
        .filter(([building]) => includeDaikyo || building !== "다이쿄초")
        .reduce((total, [, rooms]) => total + rooms.length, 0);
    const ROOM_COUNT_WITH_DAIKYO = countSalesLogRooms({ includeDaikyo: true });
    const ROOM_COUNT_WITHOUT_DAIKYO = countSalesLogRooms({ includeDaikyo: false });
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
    schedule: "30 0 * * *", // 예약 보정(00:05) 완료 후 스냅샷 생성
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
    memory: "16GiB",
    cpu: 4
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
    timeoutSeconds: 540,
    memory: "1GiB"
}, async () => {
    try {
        await assertReservationDataReady("scheduledNotionDashboardSync");
        await runNotionDashboardSync();
        console.log("✅ [Notion] 매출·가동률 대시보드 동기화 완료");
    } catch (e) {
        console.error("❌ [Notion] Dashboard sync failed:", e.message);
    }
});

exports.scheduledSlackDailyReport = scheduledSlackDailyReport;
exports.scheduledSlackDailyReportRetry = scheduledSlackDailyReportRetry;
exports.sendSlackDailyReportManual = sendSlackDailyReportManual;
exports.scheduledHotelsmartCleaningPrefetch = scheduledHotelsmartCleaningPrefetch;
exports.scheduledSlackCleaningReport = scheduledSlackCleaningReport;
exports.scheduledSlackCleaningReportRetry = scheduledSlackCleaningReportRetry;
exports.sendSlackCleaningReportManual = sendSlackCleaningReportManual;
exports.collectHotelsmartCleaningAssignmentsManual = collectHotelsmartCleaningAssignmentsManual;

exports.scheduledMonthlyNotionReport = scheduledMonthlyNotionReport;
exports.sendNotionReport = sendNotionReport;

// 리뷰 수동 동기화 (날짜 범위 지정)
exports.syncReviewsManual = onRequest({ cors: true, timeoutSeconds: 540, memory: "512MiB" }, async (req, res) => {
    try {
        const { companyId, fromDate, toDate } = req.body;
        if (!companyId) return res.status(400).json({ success: false, error: "Missing companyId" });
        const from = fromDate || dayjs().tz("Asia/Tokyo").subtract(REVIEW_RETENTION_DAYS, "day").format("YYYY-MM-DD");
        console.log(`🔄 [syncReviewsManual] fromDate=${from}, toDate=${toDate || "auto"}, companyId=${companyId}`);
        const synced = await syncAllReviews(companyId, from, { insertOnly: false, toDate: toDate || null });
        const pruned = await cleanupOldReviews(companyId);
        res.json({ success: true, synced, pruned });
    } catch (e) {
        console.error("syncReviewsManual:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

function getRequestParam(req, key, fallback = null) {
    return (req.body && req.body[key] != null)
        ? req.body[key]
        : (req.query && req.query[key] != null ? req.query[key] : fallback);
}

function sanitizeDocId(value) {
    return String(value || "").replace(/[\/#?[\]]/g, "_");
}

async function commitAttendanceAppRows(collectionName, rows, buildDocId, companyId) {
    const now = admin.firestore.FieldValue.serverTimestamp();
    let batch = db.batch();
    let pending = 0;
    let written = 0;

    for (const row of rows) {
        const docId = sanitizeDocId(buildDocId(row));
        if (!docId) continue;
        const ref = db.collection(collectionName).doc(docId);
        batch.set(ref, {
            ...row,
            companyId,
            source: "attendance_app",
            updatedAt: now,
        }, { merge: true });
        pending += 1;
        written += 1;

        if (pending >= 450) {
            await batch.commit();
            batch = db.batch();
            pending = 0;
        }
    }

    if (pending > 0) await batch.commit();
    return written;
}

function getAttendanceDateRange(req) {
    const fromDate = String(getRequestParam(req, "fromDate", "") || "");
    const toDate = String(getRequestParam(req, "toDate", "") || "");
    if (!fromDate || !toDate) {
        throw new Error("fromDate and toDate are required");
    }

    const days = dayjs(toDate).diff(dayjs(fromDate), "day");
    if (days < 0) throw new Error("toDate must be after fromDate");
    if (days > 93) throw new Error("Date range must be 93 days or less");

    return { fromDate, toDate };
}

exports.testAttendanceAppConnection = onRequest({ cors: true, timeoutSeconds: 60 }, async (req, res) => {
    try {
        const client = createAttendanceAppClient();
        const employees = await client.listEmployees({ page: 1, size: 5 });
        res.json({
            success: true,
            checked: "employees",
            count: employees.length,
            sample: employees.slice(0, 5).map((item) => ({
                employeeId: item.employeeId,
                name: item.name,
                role: item.role,
                employmentType: item.employmentType,
                hourlyWage: item.hourlyWage,
            })),
        });
    } catch (e) {
        console.error("testAttendanceAppConnection:", e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

exports.syncAttendanceAppEmployees = onRequest({ cors: true, timeoutSeconds: 180, memory: "512MiB" }, async (req, res) => {
    try {
        const companyId = String(getRequestParam(req, "companyId", DEFAULT_COMPANY_ID));
        const client = createAttendanceAppClient();
        const employees = await client.listEmployees({ size: 500 });
        const written = await commitAttendanceAppRows(
            "attendance_app_employees",
            employees,
            (row) => `${companyId}_${row.employeeId}`,
            companyId
        );

        res.json({ success: true, companyId, fetched: employees.length, written });
    } catch (e) {
        console.error("syncAttendanceAppEmployees:", e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

exports.syncAttendanceAppAttendanceRecords = onRequest({ cors: true, timeoutSeconds: 300, memory: "512MiB" }, async (req, res) => {
    try {
        const companyId = String(getRequestParam(req, "companyId", DEFAULT_COMPANY_ID));
        const employeeId = getRequestParam(req, "employeeId", null);
        const { fromDate, toDate } = getAttendanceDateRange(req);
        const client = createAttendanceAppClient();
        const records = await client.listAttendanceRecords({
            fromDate,
            toDate,
            ...(employeeId ? { employeeId } : {}),
            size: 500,
        });
        const written = await commitAttendanceAppRows(
            "attendance_app_attendance_records",
            records,
            (row) => `${companyId}_${row.workDate}_${row.employeeId}`,
            companyId
        );

        res.json({ success: true, companyId, fromDate, toDate, fetched: records.length, written });
    } catch (e) {
        console.error("syncAttendanceAppAttendanceRecords:", e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

exports.syncAttendanceAppPayrollSummaries = onRequest({ cors: true, timeoutSeconds: 300, memory: "512MiB" }, async (req, res) => {
    try {
        const companyId = String(getRequestParam(req, "companyId", DEFAULT_COMPANY_ID));
        const yearMonth = String(getRequestParam(req, "yearMonth", dayjs().tz("Asia/Tokyo").format("YYYY-MM")));
        const employeeId = getRequestParam(req, "employeeId", null);
        const client = createAttendanceAppClient();
        const summaries = await client.listPayrollSummaries({
            yearMonth,
            ...(employeeId ? { employeeId } : {}),
            size: 500,
        });
        const written = await commitAttendanceAppRows(
            "attendance_app_payroll_summaries",
            summaries,
            (row) => `${companyId}_${row.yearMonth}_${row.employeeId}`,
            companyId
        );

        res.json({ success: true, companyId, yearMonth, fetched: summaries.length, written });
    } catch (e) {
        console.error("syncAttendanceAppPayrollSummaries:", e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

exports.scheduledCleaningWorkforceForecast = onSchedule({
    schedule: "0 8 * * *",
    timeZone: "Asia/Tokyo",
    timeoutSeconds: 540,
    memory: "1GiB",
}, async () => {
    await runCleaningWorkforceForecastUpdate();
});

exports.syncCleaningWorkforceForecastOnReservationWrite = onDocumentWritten({
    document: "reservations/{reservationId}",
    timeoutSeconds: 540,
    memory: "1GiB",
}, async (event) => {
    const before = event.data?.before?.exists ? event.data.before.data() : null;
    const after = event.data?.after?.exists ? event.data.after.data() : null;

    if (!hasReservationForecastImpactChange(before, after)) return;

    const targetCompanyId = (after && after.companyId) || (before && before.companyId) || DEFAULT_COMPANY_ID;
    if (targetCompanyId !== DEFAULT_COMPANY_ID) return;

    const reservationId = event.params?.reservationId || "-";
    console.log(`[forecast-trigger] reservation write detected: ${reservationId}`);
    await runCleaningWorkforceForecastUpdate();
});

// ==========================================
// CUSTOMER SEARCH INDEX
// Pre-aggregated customer profiles for fast header search.
// Each doc = one unique customer (companyId + customerKey).
// Synced automatically on every reservation write.
// ==========================================

const CSI_COLLECTION = 'customer_search_index';
const CSI_EXCLUDED_BUILDING = '다이쿄초';
const CSI_BUILDING_NAMES = {
    '아라키초A': 'Araki-cho A', '아라키초B': 'Araki-cho B',
    '다이쿄초': 'Daikyo-cho', '가부키초': 'Kabuki-cho',
    '다카다노바바': 'Takadanobaba', '오쿠보A동': 'Okubo A',
    '오쿠보B동': 'Okubo B', '오쿠보C동': 'Okubo C', '사노시': 'Sano-shi',
};

function csiBuildingName(raw) {
    return CSI_BUILDING_NAMES[raw] || raw || 'Unknown';
}

function csiFormatRoom(room) {
    return String(room || '').replace('호', '').trim();
}

function csiCustomerKey(reservation) {
    const name = String(reservation?.guestName || '').trim().toLowerCase();
    const email = String(reservation?.guestEmail || '').trim().toLowerCase();
    const phone = String(reservation?.guestPhone || '').trim().toLowerCase();
    return email
        ? `${name}__${email}`
        : `${name}__${phone || reservation?.bookId || reservation?.id || 'unknown'}`;
}

function csiDocId(companyId, customerKey) {
    const safe = customerKey.replace(/[^a-zA-Z0-9@._-]/g, '_').slice(0, 180);
    return `${companyId}__${safe}`;
}

function csiPickReservationFields(r) {
    return {
        id: r.id || '',
        arrival: r.arrival || '',
        departure: r.departure || '',
        building: r.building || '',
        room: r.room || '',
        platform: r.platform || '',
        totalPrice: Number(r.totalPrice || r.price || 0),
        nights: Number(r.nights || 0),
        numAdult: Number(r.numAdult || 0),
        numChild: Number(r.numChild || 0),
        status: r.status || '',
        bookId: r.bookId || '',
        bookDate: r.bookDate || '',
        arrivalTime: r.arrivalTime || '',
    };
}

function csiNormalizeSearchText(value) {
    return String(value || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function csiBuildSearchTokens(values = []) {
    const tokens = new Set();

    values.forEach((value) => {
        const normalized = csiNormalizeSearchText(value);
        if (!normalized) return;

        tokens.add(normalized);
        normalized
            .split(/[^\p{L}\p{N}@._+-]+/u)
            .filter(Boolean)
            .forEach((part) => {
                tokens.add(part);
                for (let i = 2; i <= Math.min(part.length, 16); i += 1) {
                    tokens.add(part.slice(0, i));
                }
            });
    });

    return Array.from(tokens).slice(0, 200);
}

function csiBuildProfile(companyId, customerKey, reservations) {
    const relevant = reservations.filter(
        (r) => r.building !== CSI_EXCLUDED_BUILDING && String(r.guestName || '').trim()
    );
    if (relevant.length === 0) return null;

    let guestName = '', guestEmail = '', guestPhone = '', guestCountry = '';
    let guestCity = '', guestAddress = '', lang = '', notes = '';
    const platforms = new Set();
    const buildings = new Set();
    const buildingRooms = new Set();
    let totalSpent = 0, totalNights = 0, totalAdults = 0, totalChildren = 0;

    relevant.forEach((r) => {
        if (!guestName) guestName = String(r.guestName || '').trim();
        if (!guestEmail && r.guestEmail) guestEmail = r.guestEmail;
        if (!guestPhone && r.guestPhone) guestPhone = r.guestPhone;
        const country = r.guestCountry || r.guestCountry2 || '';
        if (!guestCountry && country) guestCountry = country;
        if (!guestCity && r.guestCity) guestCity = r.guestCity;
        if (!guestAddress && r.guestAddress) guestAddress = r.guestAddress;
        if (!lang && r.lang) lang = r.lang;
        if (!notes && (r.comments || r.notes || r.guestComment)) {
            notes = r.comments || r.notes || r.guestComment || '';
        }
        if (r.platform) platforms.add(r.platform);
        if (r.building) buildings.add(csiBuildingName(r.building));
        if (r.building || r.room) {
            buildingRooms.add(
                `${csiBuildingName(r.building)}${r.room ? ` / ${csiFormatRoom(r.room)}` : ''}`.trim()
            );
        }
        totalSpent += Number(r.totalPrice || r.price || 0);
        totalNights += Number(r.nights || 0);
        totalAdults += Number(r.numAdult || 0);
        totalChildren += Number(r.numChild || 0);
    });

    const sorted = [...relevant].sort((a, b) =>
        String(b.arrival || b.bookDate || '').localeCompare(String(a.arrival || a.bookDate || ''))
    );
    const latest = sorted[0] || null;
    const first = sorted[sorted.length - 1] || null;
    const platformList = Array.from(platforms);
    const buildingList = Array.from(buildings);
    const buildingRoomList = Array.from(buildingRooms);
    const searchTokens = csiBuildSearchTokens([
        guestName,
        guestEmail,
        guestPhone,
        guestCountry,
        guestCity,
        guestAddress,
        lang,
        ...platformList,
        ...buildingList,
        ...buildingRoomList,
    ]);

    return {
        companyId,
        customerKey,
        guestName,
        guestNameLower: guestName.toLowerCase(),
        guestEmail,
        guestPhone,
        guestCountry,
        guestCity,
        guestAddress,
        lang,
        notes,
        visitCount: relevant.length,
        totalSpent,
        totalNights,
        totalAdults,
        totalChildren,
        platforms: platformList,
        buildings: buildingList,
        buildingRooms: buildingRoomList,
        searchTokens,
        lastVisit: latest?.arrival || latest?.bookDate || '',
        firstVisit: first?.arrival || first?.bookDate || '',
        latestReservation: latest ? csiPickReservationFields(latest) : null,
        recentReservations: sorted.slice(0, 5).map(csiPickReservationFields),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
}

// Recompute index docs for all customers sharing the given guestName in the company.
async function csiUpdateForGuest(companyId, guestName) {
    if (!companyId || !guestName || guestName.toLowerCase() === 'unknown') return;

    const snap = await db.collection('reservations')
        .where('companyId', '==', companyId)
        .where('guestName', '==', guestName)
        .get();

    const reservations = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const existingProfileSnap = await db.collection(CSI_COLLECTION)
        .where('companyId', '==', companyId)
        .where('guestNameLower', '==', guestName.toLowerCase())
        .get();

    // Group by customerKey (same name, different email/phone = different customer)
    const grouped = new Map();
    reservations.forEach((r) => {
        const key = csiCustomerKey(r);
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(r);
    });

    const batch = db.batch();
    const validDocIds = new Set();
    grouped.forEach((customerReservations, customerKey) => {
        const profile = csiBuildProfile(companyId, customerKey, customerReservations);
        if (!profile) return;
        const docRef = db.collection(CSI_COLLECTION).doc(csiDocId(companyId, customerKey));
        validDocIds.add(docRef.id);
        batch.set(docRef, profile, { merge: true });
    });

    existingProfileSnap.docs.forEach((docSnap) => {
        if (!validDocIds.has(docSnap.id)) {
            batch.delete(docSnap.ref);
        }
    });

    await batch.commit();
}

// Trigger: keep index in sync whenever a reservation is written/updated/deleted.
exports.syncCustomerSearchIndexOnReservationWrite = onDocumentWritten({
    document: 'reservations/{reservationId}',
    timeoutSeconds: 120,
    memory: '256MiB',
}, async (event) => {
    const before = event.data?.before?.exists ? event.data.before.data() : null;
    const after = event.data?.after?.exists ? event.data.after.data() : null;

    // Collect distinct (companyId, guestName) pairs that need re-aggregation.
    const targets = new Set();
    const addTarget = (r) => {
        const name = String(r?.guestName || '').trim();
        const company = r?.companyId;
        if (company && name && name.toLowerCase() !== 'unknown') {
            targets.add(`${company}:::${name}`);
        }
    };
    if (before) addTarget(before);
    if (after) addTarget(after);

    for (const target of targets) {
        const sep = target.indexOf(':::');
        const companyId = target.slice(0, sep);
        const guestName = target.slice(sep + 3);
        await csiUpdateForGuest(companyId, guestName);
    }
});

// HTTP backfill: call once after deploying to populate the index from existing reservations.
// POST body: { companyId: "..." }  — omit to backfill all companies (slow).
exports.backfillCustomerSearchIndex = onRequest({ cors: true, timeoutSeconds: 540, memory: '1GiB' }, async (req, res) => {
    cors(req, res, async () => {
        const targetCompanyId = req.body?.companyId || null;
        console.log(`[csi-backfill] start companyId=${targetCompanyId || 'ALL'}`);

        let q = db.collection('reservations');
        if (targetCompanyId) q = q.where('companyId', '==', targetCompanyId);
        const snap = await q.get();
        const allReservations = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        console.log(`[csi-backfill] loaded ${allReservations.length} reservations`);

        // Group by (companyId, customerKey)
        const profileMap = new Map();
        allReservations.forEach((r) => {
            const company = r.companyId;
            const name = String(r.guestName || '').trim();
            if (!company || !name || name.toLowerCase() === 'unknown') return;
            const key = csiCustomerKey(r);
            const mapKey = `${company}:::${key}`;
            if (!profileMap.has(mapKey)) profileMap.set(mapKey, { companyId: company, customerKey: key, reservations: [] });
            profileMap.get(mapKey).reservations.push(r);
        });
        console.log(`[csi-backfill] ${profileMap.size} unique customers`);

        const entries = Array.from(profileMap.values());
        let written = 0;
        for (let i = 0; i < entries.length; i += 400) {
            const batch = db.batch();
            entries.slice(i, i + 400).forEach(({ companyId, customerKey, reservations }) => {
                const profile = csiBuildProfile(companyId, customerKey, reservations);
                if (!profile) return;
                const docRef = db.collection(CSI_COLLECTION).doc(csiDocId(companyId, customerKey));
                batch.set(docRef, profile);
                written++;
            });
            await batch.commit();
        }
        console.log(`[csi-backfill] done. wrote=${written}`);
        res.json({ ok: true, written, total: profileMap.size });
    });
});
