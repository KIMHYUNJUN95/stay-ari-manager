/**
 * 슬랙 일일/청소 리포트 + 동기화 알람
 * - SLACK_DAILY_REPORT_WEBHOOK_URL: 일일 운영 리포트 (08:00 JST + 변동 시 재전송)
 * - SLACK_CLEANING_REPORT_WEBHOOK_URL: 청소/셋팅 알림 (08:50 JST, 당일 기준)
 * - SLACK_SYNC_ALERT_WEBHOOK_URL: 동기화/리포트 실패 알람 (미설정 시 일일→청소 순으로 fallback)
 */
const axios = require("axios");
const crypto = require("crypto");
const { defineString } = require("firebase-functions/params");
const { collectTodayAssignments } = require("./hotelsmart/collectTodayAssignments");

const slackDailyReportWebhookUrl = defineString("SLACK_DAILY_REPORT_WEBHOOK_URL", { default: "" });
const slackCleaningReportWebhookUrl = defineString("SLACK_CLEANING_REPORT_WEBHOOK_URL", { default: "" });
const syncAlertWebhookUrl = defineString("SLACK_SYNC_ALERT_WEBHOOK_URL", { default: "" });

const SLACK_DAILY_REPORT_BUILDINGS = [
    "아라키초A", "아라키초B", "가부키초", "오쿠보A동", "오쿠보B동", "오쿠보C동", "다카다노바바", "STAY ARI Apartment Hotel", "사노시"
];

const SKY_BUILDING_NAME = "STAY ARI Apartment Hotel";
const SKY_HOTELSMART_SCREEN_SOURCE = true;
const HOTELSMART_CLEANING_CACHE_COLLECTION = "hotelsmart_cleaning_snapshots";

const CLEANING_BUILDING_ORDER = [
    "아라키초A", "아라키초B", "가부키초", "다카다노바바", "오쿠보A동", "오쿠보B동", "오쿠보C동", SKY_BUILDING_NAME
];

const CLEANING_BUILDING_LABELS = {
    "오쿠보A동": "오쿠보A (B동)",
    "오쿠보B동": "오쿠보B (A동)",
    [SKY_BUILDING_NAME]: "SKY"
};

function createSlackReportModule({
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
    hotelsmartSecrets = [],
    authorizeInternalRequest
}) {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const syncAlertDedupeWindowMs = 15 * 60 * 1000;

    async function sendSyncAlert(title, lines = []) {
        try {
            const webhookUrl = (
                syncAlertWebhookUrl.value() ||
                slackDailyReportWebhookUrl.value() ||
                slackCleaningReportWebhookUrl.value() ||
                ""
            ).trim();
            if (!webhookUrl) return;

            const normalizedLines = lines.map((line) => String(line || ""));
            const dedupeSource = `${String(title || "").trim()}\n${normalizedLines.join("\n")}`
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 4000);
            const dedupeId = crypto.createHash("sha256").update(dedupeSource).digest("hex").slice(0, 40);
            const dedupeRef = db.collection("sync_alert_dedupe").doc(dedupeId);
            const nowMs = Date.now();
            let shouldSend = true;

            try {
                await db.runTransaction(async (tx) => {
                    const snap = await tx.get(dedupeRef);
                    const data = snap.exists ? (snap.data() || {}) : {};
                    const suppressUntil = typeof data.suppressUntil?.toDate === "function"
                        ? data.suppressUntil.toDate()
                        : (data.suppressUntil ? new Date(data.suppressUntil) : null);
                    if (suppressUntil && suppressUntil.getTime() > nowMs) {
                        shouldSend = false;
                        tx.set(dedupeRef, {
                            suppressedCount: Number(data.suppressedCount || 0) + 1,
                            lastSuppressedAt: new Date(nowMs)
                        }, { merge: true });
                        return;
                    }

                    tx.set(dedupeRef, {
                        title: String(title || ""),
                        sentAt: new Date(nowMs),
                        suppressUntil: new Date(nowMs + syncAlertDedupeWindowMs),
                        suppressedCount: 0
                    }, { merge: true });
                });
            } catch (dedupeError) {
                console.warn("[Slack] sync alert dedupe check failed:", dedupeError.message || dedupeError);
            }

            if (!shouldSend) {
                console.log(`[Slack] duplicate sync alert suppressed: ${title}`);
                return;
            }

            const text = [`[Sync Alert] ${title}`, ...normalizedLines].join("\n");
            await axios.post(webhookUrl, { text }, {
                headers: { "Content-Type": "application/json" },
                timeout: 10000
            });
        } catch (e) {
            console.error("[Slack] sendSyncAlert 실패 (원래 오류는 호출부 로그 참고):", e.message || e);
        }
    }

    async function hasSlackDailySnapshot(dateStr) {
        if (!dateStr) return false;
        const snapshotDoc = await db.collection("slack_report_snapshots").doc(`daily_report_${dateStr}`).get();
        return snapshotDoc.exists;
    }

    function wasSnapshotSentOnDate(snapshotData, dateStr) {
        if (!snapshotData?.lastSentAt || !dateStr) return false;
        const sentAt = dayjs(snapshotData.lastSentAt);
        if (!sentAt.isValid()) return false;
        return sentAt.tz("Asia/Tokyo").format("YYYY-MM-DD") === dateStr;
    }

    async function hasSlackCleaningSnapshot(dateStr, { requireComplete = true } = {}) {
        if (!dateStr) return false;
        const snapshotDoc = await db.collection("slack_report_snapshots").doc(`cleaning_report_${dateStr}`).get();
        if (!snapshotDoc.exists) return false;

        const snapshotData = snapshotDoc.data() || {};
        if (
            snapshotData.companyId !== DEFAULT_COMPANY_ID ||
            !wasSnapshotSentOnDate(snapshotData, dateStr) ||
            !snapshotData.messageHash ||
            !Array.isArray(snapshotData.hotelsmartContext?.assignees) ||
            (requireComplete && snapshotData.hasMissingAssignees === true)
        ) {
            return false;
        }

        try {
            const { assigneeMap } = deserializeHotelsmartCleaningContext(snapshotData.hotelsmartContext);
            assertHotelsmartAssigneeTextIntegrity(assigneeMap);
            return true;
        } catch (error) {
            console.warn(`[Slack Cleaning Retry] invalid sent snapshot, retry required: ${dateStr}`, error.message || error);
            return false;
        }
    }

    async function runSlackDailyReportWithRetry({
        useToday = false,
        targetDateStr = null,
        skipIfUnchanged = false,
        isResend = false,
        maxAttempts = 3,
        baseDelayMs = 5000,
        context = "scheduledSlackDailyReport"
    } = {}) {
        let lastError = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                await buildAndSendSlackDailyReport(useToday, targetDateStr, skipIfUnchanged, isResend);
                return;
            } catch (e) {
                lastError = e;
                console.warn(`[Slack Daily] ${context} attempt ${attempt}/${maxAttempts} failed:`, e.message || e);
                if (attempt < maxAttempts) {
                    await sleep(baseDelayMs * attempt);
                }
            }
        }

        throw lastError;
    }

    async function buildAndSendSlackDailyReport(useToday = false, targetDateStr = null, skipIfUnchanged = false, isResend = false) {
        const webhookUrl = (slackDailyReportWebhookUrl.value() || "").trim();
        if (!webhookUrl) {
            console.log("⏭️ [Slack Daily] 웹훅 URL 미설정 — 건너뜀");
            return;
        }

        // A transient audit failure must not suppress the daily report when the
        // latest reconciled reservation data is still fresh and structurally valid.
        await assertReservationDataReady("buildAndSendSlackDailyReport", {
            allowAuditErrorWhenFresh: true
        });

        const tokyoNow = dayjs().tz("Asia/Tokyo");
        const reportDay = targetDateStr ? dayjs(targetDateStr).tz("Asia/Tokyo") : (useToday ? tokyoNow : tokyoNow.subtract(1, "day"));
        const yesterdayStr = reportDay.format("YYYY-MM-DD");
        const monthStart = reportDay.startOf("month").format("YYYY-MM-DD");
        const yesterdayStartIso = reportDay.startOf("day").toISOString();
        const yesterdayEndIso = reportDay.endOf("day").toISOString();

        const selectedFields = ["id", "bookId", "bookDate", "status", "price", "totalPrice", "building", "room", "cancelTime", "arrival", "modified", "referer", "companyId"];

        const [bookedSnap, cancelSnap, modifiedSnap] = await Promise.all([
            db.collection("reservations")
                .where("bookDate", ">=", monthStart)
                .where("bookDate", "<=", yesterdayStr)
                .select(...selectedFields)
                .get(),
            db.collection("reservations")
                .where("cancelTime", ">=", yesterdayStartIso)
                .where("cancelTime", "<=", yesterdayEndIso)
                .select(...selectedFields)
                .get(),
            db.collection("reservations")
                .where("modified", ">=", yesterdayStartIso)
                .where("modified", "<=", yesterdayEndIso)
                .select(...selectedFields)
                .get()
        ]);

        const allDocs = [];
        const seen = new Set();
        const pushUnique = (doc) => {
            const d = doc.data();
            const key = String(d.bookId || d.id || `${d.bookDate || ""}|${d.arrival || ""}|${d.room || ""}|${d.cancelTime || d.modified || ""}`);
            if (seen.has(key)) return;
            seen.add(key);
            allDocs.push(d);
        };
        bookedSnap.docs.forEach(pushUnique);
        cancelSnap.docs.forEach(pushUnique);
        modifiedSnap.docs.forEach(pushUnique);
        const filteredAllDocs = filterDocsToCompany(allDocs, DEFAULT_COMPANY_ID);

        const cancelById = new Map();
        const pushCancel = (d) => {
            const id = d.bookId || d.id || `${d.bookDate}|${d.arrival}|${d.room}|${d.cancelTime || d.modified}`;
            if (!cancelById.has(id)) cancelById.set(id, d);
        };
        cancelSnap.docs.forEach((doc) => pushCancel(doc.data()));
        modifiedSnap.docs.forEach((doc) => pushCancel(doc.data()));
        const cancelDocs = filterDocsToCompany(Array.from(cancelById.values()), DEFAULT_COMPANY_ID);

        const newBookings = filteredAllDocs.filter((d) => {
            if (d.building === "다이쿄초") return false;
            if (d.referer !== "Airbnb" && d.referer !== "Booking.com") return false;
            if (d.status !== "confirmed" || d.bookDate !== yesterdayStr) return false;
            if (getBookingAmount(d) <= 0) return false;
            return true;
        });

        const cancelledBookings = cancelDocs.filter((d) => {
            if (d.building === "다이쿄초") return false;
            if (d.referer !== "Airbnb" && d.referer !== "Booking.com") return false;
            if (d.status !== "cancelled") return false;
            const rawCancelTime = d.cancelTime || d.modified || "";
            if (!rawCancelTime) return false;
            const jstCancelDate = dayjs(rawCancelTime).tz("Asia/Tokyo").format("YYYY-MM-DD");
            if (jstCancelDate !== yesterdayStr) return false;
            if (d.arrival) {
                const arrDate = dayjs(d.arrival);
                const rptDate = dayjs(yesterdayStr);
                if (!arrDate.isAfter(rptDate.subtract(6, "month")) || !arrDate.isBefore(rptDate.add(6, "month"))) return false;
            }
            return true;
        });

        const dailyRevenue = newBookings.reduce((sum, b) => sum + getBookingAmount(b), 0);
        const totalNew = newBookings.length;
        const totalCancel = cancelledBookings.length;

        const newByReferer = { Airbnb: 0, Booking: 0 };
        newBookings.forEach((b) => {
            if (b.referer === "Airbnb") newByReferer.Airbnb += 1;
            else if (b.referer === "Booking.com") newByReferer.Booking += 1;
        });
        const cancelByReferer = { Airbnb: 0, Booking: 0 };
        cancelledBookings.forEach((b) => {
            if (b.referer === "Airbnb") cancelByReferer.Airbnb += 1;
            else if (b.referer === "Booking.com") cancelByReferer.Booking += 1;
        });
        const refererLine = `예약 채널: 에어 ${newByReferer.Airbnb}건 | 부킹 ${newByReferer.Booking}건 | 총 ${totalNew}건\n취소 채널: 에어 ${cancelByReferer.Airbnb}건 | 부킹 ${cancelByReferer.Booking}건 | 총 ${totalCancel}건`;

        const yesterdayMonthly = {};
        newBookings.forEach((d) => {
            const key = d.arrival ? dayjs(d.arrival).tz("Asia/Tokyo").format("M월") : "미정";
            yesterdayMonthly[key] = (yesterdayMonthly[key] || 0) + 1;
        });
        const yesterdayMonthOrder = Object.keys(yesterdayMonthly)
            .filter((k) => /^\d+월$/.test(k))
            .map((k) => parseInt(k, 10))
            .sort((a, b) => a - b);
        const yesterdayMonthlyParts = [];
        yesterdayMonthOrder.forEach((m) => yesterdayMonthlyParts.push(`${m}월 ${yesterdayMonthly[`${m}월`]}건`));
        if (yesterdayMonthly["미정"]) yesterdayMonthlyParts.push(`미정 ${yesterdayMonthly["미정"]}건`);
        const yesterdayMonthlyBreakdownStr = yesterdayMonthlyParts.length > 0 ? yesterdayMonthlyParts.join("  ·  ") : "—";

        const cancelledMonthly = {};
        cancelledBookings.forEach((d) => {
            const key = d.arrival ? dayjs(d.arrival).tz("Asia/Tokyo").format("M월") : "미정";
            cancelledMonthly[key] = (cancelledMonthly[key] || 0) + 1;
        });
        const cancelledMonthOrder = Object.keys(cancelledMonthly)
            .filter((k) => /^\d+월$/.test(k))
            .map((k) => parseInt(k, 10))
            .sort((a, b) => a - b);
        const cancelledMonthlyParts = [];
        cancelledMonthOrder.forEach((m) => cancelledMonthlyParts.push(`${m}월 ${cancelledMonthly[`${m}월`]}건`));
        if (cancelledMonthly["미정"]) cancelledMonthlyParts.push(`미정 ${cancelledMonthly["미정"]}건`);
        const cancelledMonthlyBreakdownStr = cancelledMonthlyParts.length > 0 ? cancelledMonthlyParts.join("  ·  ") : "—";

        const formatArrivalMonthCounts = (counts) => {
            const monthNumbers = Object.keys(counts)
                .filter((key) => /^\d+월$/.test(key))
                .map((key) => parseInt(key, 10))
                .sort((a, b) => a - b);
            const parts = monthNumbers.map((month) => `${month}월 *${counts[`${month}월`]}건*`);
            if (counts["미정"]) parts.push(`미정 *${counts["미정"]}건*`);
            return parts.join(", ");
        };

        const byBuilding = {};
        for (const b of SLACK_DAILY_REPORT_BUILDINGS) {
            byBuilding[b] = {
                new: 0,
                cancel: 0,
                revenue: 0,
                newArrivalMonths: {},
                cancelArrivalMonths: {}
            };
        }
        newBookings.forEach((b) => {
            const bd = b.building || "기타";
            if (byBuilding[bd]) {
                byBuilding[bd].new += 1;
                byBuilding[bd].revenue += getBookingAmount(b);
                const arrivalMonth = b.arrival ? dayjs(b.arrival).tz("Asia/Tokyo").format("M월") : "미정";
                byBuilding[bd].newArrivalMonths[arrivalMonth] = (byBuilding[bd].newArrivalMonths[arrivalMonth] || 0) + 1;
            }
        });
        cancelledBookings.forEach((b) => {
            const bd = b.building || "기타";
            if (byBuilding[bd]) {
                byBuilding[bd].cancel += 1;
                const arrivalMonth = b.arrival ? dayjs(b.arrival).tz("Asia/Tokyo").format("M월") : "미정";
                byBuilding[bd].cancelArrivalMonths[arrivalMonth] = (byBuilding[bd].cancelArrivalMonths[arrivalMonth] || 0) + 1;
            }
        });

        const mtdDocs = filteredAllDocs.filter((d) => {
            if (d.building === "다이쿄초") return false;
            if (d.referer !== "Airbnb" && d.referer !== "Booking.com") return false;
            if (d.status !== "confirmed" || getBookingAmount(d) <= 0) return false;
            if (!d.bookDate || d.bookDate < monthStart || d.bookDate > yesterdayStr) return false;
            return true;
        });
        const mtdNew = mtdDocs.length;

        const totalMonthly = {};
        mtdDocs.forEach((d) => {
            const key = d.arrival ? dayjs(d.arrival).tz("Asia/Tokyo").format("M월") : "미정";
            totalMonthly[key] = (totalMonthly[key] || 0) + 1;
        });
        const monthOrder = Object.keys(totalMonthly)
            .filter((k) => /^\d+월$/.test(k))
            .map((k) => parseInt(k, 10))
            .sort((a, b) => a - b);
        const monthlyParts = [];
        monthOrder.forEach((m) => monthlyParts.push(`${m}월 ${totalMonthly[`${m}월`]}건`));
        if (totalMonthly["미정"]) monthlyParts.push(`미정 ${totalMonthly["미정"]}건`);
        const monthlyBreakdownStr = monthlyParts.length > 0 ? monthlyParts.join("  ·  ") : "—";

        // ★ 변동 감지: skipIfUnchanged=true일 때 동일하면 발송 생략. isResend일 때는 이전 스냅샷으로 변동 요약용
        let prevSnapshot = null;
        const snapshotRef = db.collection("slack_report_snapshots").doc(`daily_report_${yesterdayStr}`);
        const snapshotDoc = await snapshotRef.get();
        if (snapshotDoc.exists) {
            prevSnapshot = snapshotDoc.data();
            if (skipIfUnchanged && !isResend && prevSnapshot.totalNew === totalNew && prevSnapshot.totalCancel === totalCancel && prevSnapshot.dailyRevenue === dailyRevenue && prevSnapshot.mtdNew === mtdNew) {
                console.log(`⏭️ [Slack Daily] 변동 없음, 발송 생략: ${yesterdayStr}`);
                return;
            }
        }

        // 아침 첫 발송용 기존 양식 (■ · •, 변동 상세 없음). 변동 재전송(isResend)일 때만 변동 내용 포함
        const buildingLinesClean = SLACK_DAILY_REPORT_BUILDINGS.map((b) => {
            const s = byBuilding[b];
            const newMonthBreakdown = formatArrivalMonthCounts(s.newArrivalMonths);
            const cancelMonthBreakdown = formatArrivalMonthCounts(s.cancelArrivalMonths);
            const newMonthSuffix = newMonthBreakdown ? ` [${newMonthBreakdown}]` : "";
            const cancelMonthSuffix = cancelMonthBreakdown ? ` [${cancelMonthBreakdown}]` : "";
            const rev = s.revenue > 0 ? `*¥${s.revenue.toLocaleString()}*` : "—";
            return `• ${b}  ·  예약 ${s.new}건${newMonthSuffix}  취소 ${s.cancel}건${cancelMonthSuffix}  ·  ${rev}`;
        }).join("\n");

        const messageTextClean = `일일 운영 리포트 · ${yesterdayStr}
■ 전일 실적 (전 건물 합계)
신규 예약 ${totalNew}건　취소 ${totalCancel}건　매출 *¥${dailyRevenue.toLocaleString()}*
신규 채널: 에어비엔비 ${newByReferer.Airbnb}건  ·  부킹닷컴 ${newByReferer.Booking}건
취소 채널: 에어비엔비 ${cancelByReferer.Airbnb}건  ·  부킹닷컴 ${cancelByReferer.Booking}건
신규 입실월별: ${yesterdayMonthlyBreakdownStr}
취소 입실월별: ${cancelledMonthlyBreakdownStr}
■ 건물별 실적
${buildingLinesClean}
■ 당월 누적 (예약일 기준, 확정건)
총 ${mtdNew}건
입실월별: ${monthlyBreakdownStr}`;

        let messageText = messageTextClean;
        if (isResend && prevSnapshot) {
            const diffParts = [];
            const dNew = totalNew - (prevSnapshot.totalNew || 0);
            const dCancel = totalCancel - (prevSnapshot.totalCancel || 0);
            const dRev = dailyRevenue - (prevSnapshot.dailyRevenue || 0);
            const dMtd = mtdNew - (prevSnapshot.mtdNew || 0);
            if (dNew !== 0) diffParts.push(`예약 ${dNew > 0 ? "+" : ""}${dNew}건`);
            if (dCancel !== 0) diffParts.push(`취소 ${dCancel > 0 ? "+" : ""}${dCancel}건`);
            if (dRev !== 0) diffParts.push(`매출 *${dRev > 0 ? "+" : ""}¥${dRev.toLocaleString()}*`);
            if (dMtd !== 0) diffParts.push(`당월누적 ${dMtd > 0 ? "+" : ""}${dMtd}건`);
            const changeSummaryLine = diffParts.length > 0 ? `\n📌 전번 대비 변동: ${diffParts.join(" | ")}\n` : "";
            const MAX_DETAIL = 10;
            const newDetailLines = newBookings.slice(0, MAX_DETAIL).map((b) => {
                const amt = getBookingAmount(b);
                return `${b.building || "-"} ${b.room || "-"} | ${(b.guestName || "-").slice(0, 12)} | *¥${amt.toLocaleString()}*`;
            });
            const cancelDetailLines = cancelledBookings.slice(0, MAX_DETAIL).map((b) => {
                return `${b.building || "-"} ${b.room || "-"} | ${(b.guestName || "-").slice(0, 12)} (취소)`;
            });
            const newDetailBlock = totalNew > 0 ? `신규 ${totalNew}건:\n${newDetailLines.join("\n")}${totalNew > MAX_DETAIL ? `\n… 외 ${totalNew - MAX_DETAIL}건` : ""}` : "신규 없음";
            const cancelDetailBlock = totalCancel > 0 ? `취소 ${totalCancel}건:\n${cancelDetailLines.join("\n")}${totalCancel > MAX_DETAIL ? `\n… 외 ${totalCancel - MAX_DETAIL}건` : ""}` : "취소 없음";
            messageText = `${messageTextClean}${changeSummaryLine}\n■ 변동 상세\n${newDetailBlock}\n\n${cancelDetailBlock}`;
        }

        await axios.post(webhookUrl, { text: messageText }, { headers: { "Content-Type": "application/json" }, timeout: 10000 });
        console.log("✅ [Slack Daily] 발송 완료:", yesterdayStr, isResend ? "(변동 재전송)" : "");

        // ★ 발송 후 스냅샷 저장 (변동 재전송 비교용)
        await db.collection("slack_report_snapshots").doc(`daily_report_${yesterdayStr}`).set({
            totalNew, totalCancel, dailyRevenue, mtdNew,
            sentAt: new Date().toISOString(),
            companyId: DEFAULT_COMPANY_ID
        });
    }

    function sortCleaningByBuilding(tasks) {
        return [...tasks].sort((a, b) => {
            const i = CLEANING_BUILDING_ORDER.indexOf(a.building);
            const j = CLEANING_BUILDING_ORDER.indexOf(b.building);
            const oi = i === -1 ? 999 : i;
            const oj = j === -1 ? 999 : j;
            if (oi !== oj) return oi - oj;
            return (a.room || "").localeCompare(b.room || "");
        });
    }

    function formatCleaningRoomCode(building, room) {
        const buildingName = String(building || "");
        const roomName = String(room || "");
        const roomDigits = roomName.replace(/[^0-9]/g, "");

        if (!roomDigits) return roomName;

        if (buildingName === "아라키초A") return "AA" + roomDigits;
        if (buildingName === "아라키초B") return "AB" + roomDigits;
        if (buildingName === "가부키초") return "K" + roomDigits;

        if (buildingName === "다카다노바바") {
            const floorNumber = Number(roomDigits[0]);
            if (Number.isFinite(floorNumber) && floorNumber >= 2 && floorNumber <= 9) {
                return "T" + String(floorNumber);
            }
            return "T" + roomDigits;
        }

        return roomName;
    }

    function formatCleaningBuildingLabel(building) {
        const buildingName = String(building || "");
        return CLEANING_BUILDING_LABELS[buildingName] || buildingName;
    }

    function getReservationPax(reservation) {
        return (reservation?.numAdult || 0) + (reservation?.numChild || 0);
    }

    function getSkyRoomMatchKey(room) {
        const normalizedRoom = String(room || "").trim().toUpperCase();
        const roomDigits = normalizedRoom.replace(/[^0-9]/g, "");
        return roomDigits || normalizedRoom;
    }

    function formatSkyDisplayRoomCode(room) {
        const roomName = String(room || "").trim();
        const roomDigits = roomName.replace(/[^0-9]/g, "");
        return roomDigits ? `sky${roomDigits}` : roomName;
    }

    function normalizeCleaningBuildingKey(building) {
        const normalized = String(building || "")
            .trim()
            .toLowerCase()
            .replace(/[\s_\-()]/g, "");

        if (!normalized) return "";
        if (normalized === "arakichoa" || normalized === "아라키초a") return "arakicho_a";
        if (normalized === "arakichob" || normalized === "아라키초b") return "arakicho_b";
        if (normalized === "kabukicho" || normalized === "가부키초") return "kabukicho";
        if (normalized === "takadanobaba" || normalized === "다카다노바바") return "takadanobaba";
        if (normalized === "okubockr" || normalized === "okuboc" || normalized === "오쿠보c동" || normalized === "오쿠보c") return "okubo_c";
        if (normalized === "okubob" || normalized === "오쿠보b동" || normalized === "오쿠보b") return "okubo_b";
        if (normalized === "stayariapartmenthotel" || normalized === "sky") return "sky";
        if (normalized === "stayari" || normalized === "okuboa" || normalized === "\uC624\uCFE0\uBCF4a\uB3D9" || normalized === "\uC624\uCFE0\uBCF4a") return "okubo_a";
        return normalized;
    }

    function getCleaningAssignmentLookupKey(building, room) {
        const buildingKey = normalizeCleaningBuildingKey(building);
        const rawRoom = String(room || "").trim();
        const upperRoom = rawRoom.toUpperCase().replace(/\s+/g, "");
        const roomDigits = upperRoom.replace(/[^0-9]/g, "");

        let canonicalRoom = upperRoom;

        if (buildingKey === "arakicho_a" && roomDigits) canonicalRoom = "AA" + roomDigits;
        else if (buildingKey === "arakicho_b" && roomDigits) canonicalRoom = "AB" + roomDigits;
        else if (buildingKey === "kabukicho" && roomDigits) canonicalRoom = "K" + roomDigits;
        else if (buildingKey === "takadanobaba" && roomDigits) canonicalRoom = "T" + roomDigits[0];
        else if (buildingKey === "okubo_a" && !roomDigits) canonicalRoom = "OKUBOA";
        else if (buildingKey === "okubo_c" && !roomDigits) canonicalRoom = "OKUBOC";
        else if (buildingKey === "okubo_b" && !roomDigits) canonicalRoom = "OKUBOB";
        else if (buildingKey === "sky" && roomDigits) canonicalRoom = "O" + roomDigits;
        else if (buildingKey === "sky" && !roomDigits) canonicalRoom = "SKY";

        return `${buildingKey}__${canonicalRoom}`;
    }

    function formatHotelsmartRoomCodeForSlack(building, room) {
        const buildingKey = normalizeCleaningBuildingKey(building);
        const rawRoom = String(room || "").trim();
        const upperRoom = rawRoom.toUpperCase().replace(/\s+/g, "");
        const roomDigits = upperRoom.replace(/[^0-9]/g, "");

        if (buildingKey === "arakicho_a" && roomDigits) return "AA" + roomDigits;
        if (buildingKey === "arakicho_b" && roomDigits) return "AB" + roomDigits;
        if (buildingKey === "kabukicho" && roomDigits) return "K" + roomDigits;
        if (buildingKey === "takadanobaba" && roomDigits) return "T" + roomDigits[0];
        if (buildingKey === "okubo_c" && !roomDigits) return "오쿠보C";
        if (buildingKey === "okubo_b" && !roomDigits) return "오쿠보B";
        if (buildingKey === "okubo_a" && !roomDigits) return "\uC624\uCFE0\uBCF4A";
        if (buildingKey === "sky" && roomDigits) return roomDigits;
        if (buildingKey === "sky" && !roomDigits) return "SKY";
        return rawRoom;
    }

    function formatSkyScreenRoomCode(roomRaw) {
        const rawRoom = String(roomRaw || "").trim();
        return rawRoom.replace(/\s+/g, "");
    }

    async function collectAndCacheHotelsmartCleaningContext(targetDateStr) {
        const result = await collectTodayAssignments({ operatingDate: targetDateStr });
        const assigneeMap = new Map();
        const skyRows = [];

        (result.properties || []).forEach((property) => {
            (property.assignments || []).forEach((assignment) => {
                const roomCode = getCleaningAssignmentLookupKey(
                    assignment.propertyName,
                    assignment.roomCodeNormalized || assignment.roomRaw || ""
                );
                const roomCodeForSlack = String(formatHotelsmartRoomCodeForSlack(
                    assignment.propertyName,
                    assignment.roomCodeNormalized || assignment.roomRaw || ""
                ) || "").trim();
                const assigneeName = String(assignment.assigneeNormalized || "").trim();

                if (normalizeCleaningBuildingKey(assignment.propertyName) === "sky" && roomCodeForSlack) {
                    skyRows.push({
                        roomCode: formatSkyScreenRoomCode(assignment.roomRaw || assignment.roomCodeNormalized),
                        assigneeName,
                    });
                }

                if (!roomCode || !assigneeName) return;

                [roomCode, roomCodeForSlack].filter(Boolean).forEach((key) => {
                    if (!assigneeMap.has(key)) assigneeMap.set(key, []);
                    const bucket = assigneeMap.get(key);
                    if (!bucket.includes(assigneeName)) bucket.push(assigneeName);
                });
            });
        });

        assertHotelsmartAssigneeTextIntegrity(assigneeMap);
        const serializedContext = serializeHotelsmartCleaningContext(assigneeMap, skyRows);
        await db.collection(HOTELSMART_CLEANING_CACHE_COLLECTION).doc(targetDateStr).set({
            companyId: DEFAULT_COMPANY_ID,
            operatingDate: targetDateStr,
            collectedAt: new Date().toISOString(),
            context: serializedContext,
        }, { merge: true });

        return { assigneeMap, skyRows, source: "live", collectionError: null };
    }

    async function loadCachedHotelsmartCleaningContext(targetDateStr) {
        const cacheDoc = await db.collection(HOTELSMART_CLEANING_CACHE_COLLECTION).doc(targetDateStr).get();
        if (cacheDoc.exists && cacheDoc.data()?.companyId === DEFAULT_COMPANY_ID && cacheDoc.data()?.context) {
            const cached = deserializeHotelsmartCleaningContext(cacheDoc.data().context);
            assertHotelsmartAssigneeTextIntegrity(cached.assigneeMap);
            return { ...cached, source: "daily_cache" };
        }

        const reportDoc = await db.collection("slack_report_snapshots").doc(`cleaning_report_${targetDateStr}`).get();
        if (reportDoc.exists && reportDoc.data()?.companyId === DEFAULT_COMPANY_ID && reportDoc.data()?.hotelsmartContext) {
            const cached = deserializeHotelsmartCleaningContext(reportDoc.data().hotelsmartContext);
            assertHotelsmartAssigneeTextIntegrity(cached.assigneeMap);
            return { ...cached, source: "report_cache" };
        }

        return null;
    }

    async function getHotelsmartCleaningContext(targetDateStr) {
        try {
            return await collectAndCacheHotelsmartCleaningContext(targetDateStr);
        } catch (error) {
            console.error("[Slack Cleaning] HOTELSMART collector failed; continuing with fallback:", error.message || error);
            const cached = await loadCachedHotelsmartCleaningContext(targetDateStr).catch((cacheError) => {
                console.error("[Slack Cleaning] HOTELSMART cache load failed:", cacheError.message || cacheError);
                return null;
            });
            if (cached) {
                return { ...cached, collectionError: String(error.message || error) };
            }
            return {
                assigneeMap: new Map(),
                skyRows: [],
                source: "unavailable",
                collectionError: String(error.message || error),
            };
        }
    }

    function serializeHotelsmartCleaningContext(assigneeMap, skyRows = []) {
        return {
            assignees: Array.from(assigneeMap.entries()).map(([key, names]) => ({
                key,
                names: Array.isArray(names) ? names : []
            })),
            skyRows: (Array.isArray(skyRows) ? skyRows : []).map((row) => ({
                roomCode: String(row?.roomCode || "").trim(),
                assigneeName: String(row?.assigneeName || "").trim(),
            })).filter((row) => row.roomCode),
        };
    }

    function deserializeHotelsmartCleaningContext(snapshotContext) {
        const assigneeMap = new Map();
        (snapshotContext?.assignees || []).forEach((entry) => {
            const key = String(entry?.key || "").trim();
            const names = Array.isArray(entry?.names)
                ? entry.names.map((name) => String(name || "").trim()).filter(Boolean)
                : [];
            if (key && names.length > 0) assigneeMap.set(key, names);
        });

        const serializedSkyRows = (Array.isArray(snapshotContext?.skyRows) ? snapshotContext.skyRows : [])
                .map((row) => ({
                    roomCode: String(row?.roomCode || "").trim(),
                    assigneeName: String(row?.assigneeName || "").trim(),
                }))
                .filter((row) => row.roomCode);
        const skyRows = serializedSkyRows.length > 0
            ? serializedSkyRows
            : Array.from(assigneeMap.entries()).flatMap(([key, names]) => {
                const match = /^sky__O(\d+)$/i.exec(String(key || ""));
                if (!match) return [];
                const normalizedNames = Array.isArray(names) && names.length > 0 ? names : [""];
                return normalizedNames.map((assigneeName) => ({
                    roomCode: match[1],
                    assigneeName: String(assigneeName || "").trim(),
                }));
            });

        return {
            assigneeMap,
            skyRows,
        };
    }

    function assertHotelsmartAssigneeTextIntegrity(assigneeMap) {
        const corruptedKeys = [];

        for (const [key, names] of assigneeMap.entries()) {
            const hasCorruptedName = (Array.isArray(names) ? names : []).some((name) => {
                const normalized = String(name || "").trim();
                if (!normalized) return true;
                return /\?{2,}|�/u.test(normalized) || !/[\p{L}\p{N}]/u.test(normalized);
            });
            if (hasCorruptedName) corruptedKeys.push(String(key || ""));
        }

        if (corruptedKeys.length > 0) {
            throw new Error(`HOTELSMART assignee text corrupted: ${corruptedKeys.slice(0, 20).join(", ")}`);
        }
    }

    function buildSkyCleaningList(
        skyRows,
        skyDepartureByRoomCode = new Map(),
        skyArrivalByRoomCode = new Map()
    ) {
        if (!SKY_HOTELSMART_SCREEN_SOURCE) return [];

        const byRoom = new Map();
        skyDepartureByRoomCode.forEach((departureReservation, roomMatchKey) => {
            const arrivalReservation = skyArrivalByRoomCode.get(roomMatchKey);
            const arrivalGuestName = String(arrivalReservation?.guestName || "").trim() || "—";
            byRoom.set(roomMatchKey, {
                building: SKY_BUILDING_NAME,
                room: formatSkyDisplayRoomCode(departureReservation?.room || roomMatchKey),
                reservationRoom: departureReservation?.room || roomMatchKey,
                label: arrivalReservation
                    ? `${arrivalGuestName} (${getReservationPax(arrivalReservation)})`
                    : "체크인 X",
                hotelsmartOnly: true,
                hotelsmartAssigneeNames: [],
            });
        });

        (Array.isArray(skyRows) ? skyRows : []).forEach((row) => {
            const roomCode = String(row?.roomCode || "").trim();
            const assigneeName = String(row?.assigneeName || "").trim();
            if (!roomCode) return;

            const roomMatchKey = getSkyRoomMatchKey(roomCode);
            if (!byRoom.has(roomMatchKey)) {
                byRoom.set(roomMatchKey, {
                    building: SKY_BUILDING_NAME,
                    room: roomCode,
                    label: "",
                    hotelsmartOnly: true,
                    hotelsmartAssigneeNames: [],
                });
            }

            const item = byRoom.get(roomMatchKey);
            if (assigneeName && !item.hotelsmartAssigneeNames.includes(assigneeName)) {
                item.hotelsmartAssigneeNames.push(assigneeName);
            }
        });

        return Array.from(byRoom.values());
    }

    async function buildAndSendSlackCleaningReport(targetDateStr, options = {}) {
        const {
            isCorrection = false,
            skipIfUnchanged = false,
            hotelsmartContextSnapshot = null,
            allowMissingAssignees = true,
            alertOnHotelsmartFallback = false,
        } = options;
        const webhookUrl = (slackCleaningReportWebhookUrl.value() || "").trim();
        if (!webhookUrl) {
            console.error("[Slack Cleaning] webhook URL is not configured");
            throw new Error("SLACK_CLEANING_REPORT_WEBHOOK_URL is not configured");
        }

        await assertReservationDataReady("buildAndSendSlackCleaningReport", {
            allowAuditErrorWhenFresh: true
        });

        const [departuresSnap, arrivalsSnap] = await Promise.all([
            db.collection("reservations")
                .where("companyId", "==", DEFAULT_COMPANY_ID)
                .where("status", "==", "confirmed")
                .where("departure", "==", targetDateStr)
                .get(),
            db.collection("reservations")
                .where("companyId", "==", DEFAULT_COMPANY_ID)
                .where("status", "==", "confirmed")
                .where("arrival", "==", targetDateStr)
                .get()
        ]);

        const departures = filterDocsToCompany(departuresSnap.docs.map((d) => ({ ...d.data(), id: d.id })), DEFAULT_COMPANY_ID);
        const arrivals = filterDocsToCompany(arrivalsSnap.docs.map((d) => ({ ...d.data(), id: d.id })), DEFAULT_COMPANY_ID);

        const skyDepartureByRoomCode = new Map();
        departures.forEach((r) => {
            if (r.building !== SKY_BUILDING_NAME) return;
            const roomCode = formatCleaningRoomCode(r.building, r.room);
            if (!roomCode) return;
            skyDepartureByRoomCode.set(getSkyRoomMatchKey(roomCode), r);
        });

        const skyArrivalByRoomCode = new Map();
        arrivals.forEach((r) => {
            if (r.building !== SKY_BUILDING_NAME) return;
            const roomCode = formatCleaningRoomCode(r.building, r.room);
            if (!roomCode) return;
            skyArrivalByRoomCode.set(getSkyRoomMatchKey(roomCode), r);
        });

        const departureRoomKeys = new Set();
        departures.forEach((r) => {
            if (r.building === "다이쿄초") return;
            if (SKY_HOTELSMART_SCREEN_SOURCE && r.building === SKY_BUILDING_NAME) return;
            departureRoomKeys.add(`${r.building || ""}_${r.room || ""}`);
        });

        const arrivalByKey = {};
        arrivals.forEach((r) => {
            if (r.building === "다이쿄초") return;
            if (SKY_HOTELSMART_SCREEN_SOURCE && r.building === SKY_BUILDING_NAME) return;
            const key = `${r.building || ""}_${r.room || ""}`;
            arrivalByKey[key] = r;
        });

        const cleaningList = await Promise.all(departures.map(async (d) => {
            if (d.building === "다이쿄초") return null;
            if (SKY_HOTELSMART_SCREEN_SOURCE && d.building === SKY_BUILDING_NAME) return null;
            const key = `${d.building || ""}_${d.room || ""}`;
            const arr = arrivalByKey[key];
            if (arr) {
                const name = arr.guestName || "—";
                return { building: d.building, room: d.room, label: `${name} (${getReservationPax(arr)})` };
            }

            return { building: d.building, room: d.room, label: "체크인 X" };
        }));

        const settingList = [];
        arrivals.forEach((a) => {
            if (a.building === "다이쿄초") return;
            const key = `${a.building || ""}_${a.room || ""}`;
            const isSkyRoom = SKY_HOTELSMART_SCREEN_SOURCE && a.building === SKY_BUILDING_NAME;
            const hasSameDayDeparture = isSkyRoom
                ? skyDepartureByRoomCode.has(getSkyRoomMatchKey(formatCleaningRoomCode(a.building, a.room)))
                : departureRoomKeys.has(key);
            if (hasSameDayDeparture) return;
            const name = a.guestName || "—";
            settingList.push({ building: a.building, room: a.room, label: `${name} (${getReservationPax(a)})` });
        });

        const hotelsmartContext = hotelsmartContextSnapshot
            ? {
                ...deserializeHotelsmartCleaningContext(hotelsmartContextSnapshot),
                source: "injected",
                collectionError: null,
            }
            : await getHotelsmartCleaningContext(targetDateStr);
        const {
            assigneeMap: hotelsmartAssigneeMap,
            skyRows: hotelsmartSkyRows,
            source: hotelsmartContextSource,
            collectionError: hotelsmartCollectionError,
        } = hotelsmartContext;
        if (alertOnHotelsmartFallback && hotelsmartCollectionError) {
            await sendSyncAlert("HOTELSMART cleaning fallback activated", [
                `date=${targetDateStr}`,
                `source=${hotelsmartContextSource}`,
                hotelsmartCollectionError,
            ]);
        }
        assertHotelsmartAssigneeTextIntegrity(hotelsmartAssigneeMap);
        const cleaningListWithHotelsmart = [
            ...cleaningList.filter(Boolean),
            ...buildSkyCleaningList(hotelsmartSkyRows, skyDepartureByRoomCode, skyArrivalByRoomCode)
        ];

        const cleaningListWithNextCheckinPax = await Promise.all(cleaningListWithHotelsmart.map(async (item) => {
            if (item.label !== "체크인 X") return item;

            const nextCheckinSnap = await db.collection("reservations")
                .where("companyId", "==", DEFAULT_COMPANY_ID)
                .where("status", "==", "confirmed")
                .where("building", "==", item.building)
                .where("room", "==", item.reservationRoom || item.room)
                .where("arrival", ">", targetDateStr)
                .orderBy("arrival", "asc")
                .limit(1)
                .get();
            const nextCheckin = nextCheckinSnap.docs
                .map((doc) => ({ ...doc.data(), id: doc.id }))
                .find((reservation) => getEffectiveCompanyId(reservation) === DEFAULT_COMPANY_ID);

            if (!nextCheckin) return item;
            return { ...item, label: `체크인 X (${getReservationPax(nextCheckin)})` };
        }));

        const missingAssigneeRooms = cleaningListWithNextCheckinPax.filter((item) => {
            if (!CLEANING_BUILDING_ORDER.includes(item.building)) return false;
            const roomCode = formatCleaningRoomCode(item.building, item.room);
            const assignmentKey = getCleaningAssignmentLookupKey(item.building, item.room);
            const assigneeNames = item.hotelsmartOnly
                ? item.hotelsmartAssigneeNames
                : (hotelsmartAssigneeMap.get(assignmentKey) || hotelsmartAssigneeMap.get(roomCode) || null);
            return !assigneeNames || assigneeNames.length === 0;
        });
        const missingRoomCodes = Array.from(new Set(missingAssigneeRooms
            .map((item) => formatCleaningRoomCode(item.building, item.room))
            .filter(Boolean)));
        if (missingRoomCodes.length > 0) {
            if (!allowMissingAssignees) {
                throw new Error(`HOTELSMART assignee missing: ${missingRoomCodes.join(", ")}`);
            }
            console.warn(`[Slack Cleaning] report includes unassigned rooms: ${missingRoomCodes.join(", ")}`);
        }

        const sortedCleaning = sortCleaningByBuilding(cleaningListWithNextCheckinPax);
        const sortedSetting = sortCleaningByBuilding(settingList);

        const byBuilding = (list, title, includeHotelsmartAssignees = false) => {
            const groups = {};
            list.forEach((t) => {
                const b = t.building || "기타";
                if (!groups[b]) groups[b] = [];
                const roomCode = formatCleaningRoomCode(t.building, t.room);
                const assignmentKey = getCleaningAssignmentLookupKey(t.building, t.room);
                const assigneeNames = includeHotelsmartAssignees
                    ? (t.hotelsmartOnly
                        ? t.hotelsmartAssigneeNames
                        : (hotelsmartAssigneeMap.get(assignmentKey) || hotelsmartAssigneeMap.get(roomCode) || null))
                    : null;
                const assigneeSuffix = assigneeNames && assigneeNames.length > 0
                    ? ` | ${assigneeNames.join(", ")}`
                    : (includeHotelsmartAssignees ? " | 담당자 미배정" : "");
                const labelPart = t.label ? ` | ${t.label}` : "";
                groups[b].push(`*${roomCode}*${labelPart}${assigneeSuffix}`);
            });
            const lines = [];
            CLEANING_BUILDING_ORDER.forEach((b) => {
                if (!groups[b] || groups[b].length === 0) return;
                lines.push(`${formatCleaningBuildingLabel(b)}\n${groups[b].join("\n")}`);
            });
            if (!title) return lines.length === 0 ? "없음" : lines.join("\n\n");
            if (lines.length === 0) return `${title}\n\n없음`;
            return `${title}\n\n${lines.join("\n\n")}`;
        };

        const cleaningBlock = byBuilding(sortedCleaning, "", true);
        const settingBlock = byBuilding(sortedSetting, "*셋팅해야 하는 객실*");

        const baseMessageText = `기준일: ${targetDateStr}\n\n${cleaningBlock}\n\n*------------------------------------------------*\n\n${settingBlock}`;
        const messageHash = crypto.createHash("sha256").update(baseMessageText).digest("hex");
        if (skipIfUnchanged) {
            const previousSnapshot = await db.collection("slack_report_snapshots").doc(`cleaning_report_${targetDateStr}`).get();
            if (
                previousSnapshot.exists &&
                previousSnapshot.data()?.companyId === DEFAULT_COMPANY_ID &&
                wasSnapshotSentOnDate(previousSnapshot.data(), targetDateStr) &&
                previousSnapshot.data()?.messageHash === messageHash
            ) {
                console.log(`[Slack Cleaning] 명단 내용 변동 없음 — 정정 생략: ${targetDateStr}`);
                return { sent: false, reason: "unchanged" };
            }
        }

        const correctionHeader = isCorrection
            ? "🔄 *청소/셋팅 명단 정정본*\n예약 변경이 반영되었습니다. 기존 메시지 대신 이 명단을 확인해주세요.\n\n"
            : "";
        const messageText = `${correctionHeader}${baseMessageText}`;
        await axios.post(webhookUrl, { text: messageText }, { headers: { "Content-Type": "application/json" }, timeout: 10000 });
        const sentAt = new Date().toISOString();
        const snapshotPayload = {
            companyId: DEFAULT_COMPANY_ID,
            reportType: "cleaning",
            reportDate: targetDateStr,
            deliveryStatus: missingRoomCodes.length > 0 ? "sent_partial" : "sent",
            hasMissingAssignees: missingRoomCodes.length > 0,
            missingAssigneeRoomCodes: missingRoomCodes,
            messageHash,
            hotelsmartContext: serializeHotelsmartCleaningContext(hotelsmartAssigneeMap, hotelsmartSkyRows),
            hotelsmartContextSource,
            hotelsmartCollectionError: hotelsmartCollectionError || null,
            lastSentAt: sentAt,
            lastSendType: isCorrection ? "correction" : "scheduled"
        };
        if (isCorrection) snapshotPayload.lastCorrectionAt = sentAt;
        else snapshotPayload.initialSentAt = sentAt;
        await db.collection("slack_report_snapshots").doc(`cleaning_report_${targetDateStr}`).set(snapshotPayload, { merge: true });
        console.log("✅ [Slack Cleaning] 발송 완료:", targetDateStr, isCorrection ? "(정정본)" : "");
        return { sent: true, reason: isCorrection ? "correction_sent" : "report_sent" };
    }

    async function sendSlackCleaningReportCorrectionIfSent(targetDateStr) {
        const snapshotDoc = await db.collection("slack_report_snapshots").doc(`cleaning_report_${targetDateStr}`).get();
        if (!snapshotDoc.exists || snapshotDoc.data()?.companyId !== DEFAULT_COMPANY_ID) {
            console.log(`[Slack Cleaning] 최초 명단 미발송 상태 — 정정 생략: ${targetDateStr}`);
            return { sent: false, reason: "initial_report_not_sent" };
        }

        const hotelsmartContextSnapshot = snapshotDoc.data()?.hotelsmartContext || null;
        if (!hotelsmartContextSnapshot) {
            console.warn(`[Slack Cleaning] HOTELSMART 담당자 캐시 없음 — 정정 생략: ${targetDateStr}`);
            return { sent: false, reason: "hotelsmart_context_missing" };
        }

        return buildAndSendSlackCleaningReport(targetDateStr, {
            isCorrection: true,
            skipIfUnchanged: true,
            hotelsmartContextSnapshot
        });
    }

    const scheduledSlackDailyReport = onSchedule({
        schedule: "30 6 * * *",
        timeZone: "Asia/Tokyo",
        retryCount: 3,
        minBackoffSeconds: 60,
        maxBackoffSeconds: 600,
        maxDoublings: 4,
        maxRetrySeconds: 900,
        timeoutSeconds: 120,
        memory: "16GiB",
        cpu: 4
    }, async () => {
        try {
            // 아침 08:00 JST: 전날(어제) 기준 일일 리포트 1회 발송. 변동 재전송은 scheduleOutputUpdates에서 처리.
            await runSlackDailyReportWithRetry({
                skipIfUnchanged: true,
                context: "scheduledSlackDailyReport"
            });
        } catch (e) {
            console.error("❌ [Slack Daily] scheduledSlackDailyReport 실패:", e.stack || e.message);
            await sendSyncAlert("scheduledSlackDailyReport failed", [String(e.stack || e.message)]);
        }
    });

    const sendSlackDailyReportManual = onRequest({
        cors: true,
        timeoutSeconds: 120,
        memory: "16GiB",
        cpu: 4
    }, async (req, res) => {
        try {
            const dateStr = (req.query && typeof req.query.date === "string" && req.query.date.trim()) ? req.query.date.trim() : null;
            const target = (req.query && typeof req.query.target === "string") ? req.query.target.trim() : "";
            const useToday = !dateStr && target === "today";
            if (!dateStr && !useToday) {
                return res.status(400).json({
                    success: false,
                    error: "Explicit date=YYYY-MM-DD or target=today is required"
                });
            }
            await runSlackDailyReportWithRetry({
                useToday,
                targetDateStr: dateStr,
                context: "sendSlackDailyReportManual",
                maxAttempts: 2,
                baseDelayMs: 3000
            });
            res.json({
                success: true,
                message: "Slack daily report sent",
                target: dateStr || (useToday ? "today" : "yesterday")
            });
        } catch (e) {
            console.error("sendSlackDailyReportManual:", e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    const scheduledSlackDailyReportRetry = onSchedule({
        schedule: "50 6 * * *",
        timeZone: "Asia/Tokyo",
        retryCount: 2,
        minBackoffSeconds: 60,
        maxBackoffSeconds: 300,
        maxDoublings: 3,
        maxRetrySeconds: 600,
        timeoutSeconds: 120,
        memory: "16GiB",
        cpu: 4
    }, async () => {
        const yesterdayStr = dayjs().tz("Asia/Tokyo").subtract(1, "day").format("YYYY-MM-DD");

        try {
            if (await hasSlackDailySnapshot(yesterdayStr)) {
                console.log(`??툘 [Slack Daily Retry] snapshot already exists, skip: ${yesterdayStr}`);
                return;
            }

            await runSlackDailyReportWithRetry({
                targetDateStr: yesterdayStr,
                skipIfUnchanged: true,
                context: "scheduledSlackDailyReportRetry"
            });
        } catch (e) {
            console.error("??[Slack Daily Retry] scheduledSlackDailyReportRetry ?ㅽ뙣:", e.stack || e.message);
            await sendSyncAlert("scheduledSlackDailyReportRetry failed", [String(e.stack || e.message)]);
        }
    });

    const scheduledHotelsmartCleaningPrefetch = onSchedule({
        schedule: "15 5,18 * * *",
        timeZone: "Asia/Tokyo",
        retryCount: 2,
        minBackoffSeconds: 120,
        maxBackoffSeconds: 600,
        timeoutSeconds: 540,
        memory: "4GiB",
        cpu: 2,
        secrets: hotelsmartSecrets
    }, async () => {
        const nowTokyo = dayjs().tz("Asia/Tokyo");
        const targetDateStr = nowTokyo.hour() >= 12
            ? nowTokyo.add(1, "day").format("YYYY-MM-DD")
            : nowTokyo.format("YYYY-MM-DD");
        try {
            const context = await collectAndCacheHotelsmartCleaningContext(targetDateStr);
            console.log(`[Hotelsmart Prefetch] cached: ${targetDateStr}, source=${context.source}`);
        } catch (e) {
            console.error("[Hotelsmart Prefetch] failed:", e.stack || e.message);
            await sendSyncAlert("scheduledHotelsmartCleaningPrefetch failed", [
                `date=${targetDateStr}`,
                String(e.stack || e.message),
            ]);
            throw e;
        }
    });

    const scheduledSlackCleaningReport = onSchedule({
        schedule: "30 6 * * *",
        timeZone: "Asia/Tokyo",
        timeoutSeconds: 540,
        memory: "16GiB",
        cpu: 4,
        secrets: hotelsmartSecrets
    }, async () => {
        const todayStr = dayjs().tz("Asia/Tokyo").format("YYYY-MM-DD");
        try {
            if (await hasSlackCleaningSnapshot(todayStr, { requireComplete: false })) {
                console.log(`[Slack Cleaning] already sent today: ${todayStr}`);
                return;
            }
            await buildAndSendSlackCleaningReport(todayStr, {
                skipIfUnchanged: false,
                alertOnHotelsmartFallback: true,
            });
        } catch (e) {
            console.error("❌ [Slack Cleaning] scheduledSlackCleaningReport 실패:", e.stack || e.message);
            await sendSyncAlert("scheduledSlackCleaningReport failed", [String(e.stack || e.message)]);
            throw e;
        }
    });

    const scheduledSlackCleaningReportRetry = onSchedule({
        schedule: "50 6,7,8 * * *",
        timeZone: "Asia/Tokyo",
        retryCount: 2,
        minBackoffSeconds: 120,
        maxBackoffSeconds: 600,
        timeoutSeconds: 540,
        memory: "16GiB",
        cpu: 4,
        secrets: hotelsmartSecrets
    }, async () => {
        const todayStr = dayjs().tz("Asia/Tokyo").format("YYYY-MM-DD");
        if (await hasSlackCleaningSnapshot(todayStr, { requireComplete: true })) {
            console.log(`[Slack Cleaning Retry] already sent: ${todayStr}`);
            return;
        }

        try {
            const hasPartialReport = await hasSlackCleaningSnapshot(todayStr, { requireComplete: false });
            await buildAndSendSlackCleaningReport(todayStr, {
                isCorrection: hasPartialReport,
                skipIfUnchanged: hasPartialReport,
                alertOnHotelsmartFallback: !hasPartialReport,
            });
        } catch (e) {
            console.error("[Slack Cleaning] scheduledSlackCleaningReportRetry failed:", e.stack || e.message);
            await sendSyncAlert("scheduledSlackCleaningReportRetry failed", [String(e.stack || e.message)]);
            throw e;
        }
    });

    const sendSlackCleaningReportManual = onRequest({
        cors: true,
        timeoutSeconds: 540,
        memory: "16GiB",
        cpu: 4,
        secrets: hotelsmartSecrets
    }, async (req, res) => {
        try {
            if (typeof authorizeInternalRequest !== "function") {
                throw new Error("Internal request authorization is not configured");
            }
            await authorizeInternalRequest(req);

            if (req.method !== "GET") {
                res.status(405).json({ success: false, error: "GET required" });
                return;
            }

            const dateStr = typeof req.query?.date === "string" ? req.query.date.trim() : "";
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                res.status(400).json({ success: false, error: "date=YYYY-MM-DD required" });
                return;
            }

            await buildAndSendSlackCleaningReport(dateStr);
            res.json({ success: true, message: "Slack cleaning report sent", date: dateStr });
        } catch (e) {
            const statusCode = Number(e.statusCode) || 500;
            if (statusCode >= 500) console.error("sendSlackCleaningReportManual:", e);
            res.status(statusCode).json({ success: false, error: e.message });
        }
    });

    return {
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
    };
}

module.exports = {
    createSlackReportModule
};
