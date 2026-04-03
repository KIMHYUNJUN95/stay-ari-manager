/**
 * 슬랙 일일/청소 리포트 + 동기화 알람
 * - SLACK_DAILY_REPORT_WEBHOOK_URL: 일일 운영 리포트 (08:00 JST + 변동 시 재전송)
 * - SLACK_CLEANING_REPORT_WEBHOOK_URL: 청소/셋팅 알림 (08:50 JST, 당일 기준)
 * - SLACK_SYNC_ALERT_WEBHOOK_URL: 동기화/리포트 실패 알람 (미설정 시 일일→청소 순으로 fallback)
 */
const axios = require("axios");
const { defineString } = require("firebase-functions/params");

const slackDailyReportWebhookUrl = defineString("SLACK_DAILY_REPORT_WEBHOOK_URL", { default: "" });
const slackCleaningReportWebhookUrl = defineString("SLACK_CLEANING_REPORT_WEBHOOK_URL", { default: "" });
const syncAlertWebhookUrl = defineString("SLACK_SYNC_ALERT_WEBHOOK_URL", { default: "" });

const SLACK_DAILY_REPORT_BUILDINGS = [
    "아라키초A", "아라키초B", "가부키초", "오쿠보A동", "오쿠보B동", "오쿠보C동", "다카다노바바", "사노시"
];

const CLEANING_BUILDING_ORDER = [
    "아라키초A", "아라키초B", "가부키초", "다카다노바바", "오쿠보A동", "오쿠보B동", "오쿠보C동"
];

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
    getEffectiveCompanyId
}) {
    async function sendSyncAlert(title, lines = []) {
        try {
            const webhookUrl = (
                syncAlertWebhookUrl.value() ||
                slackDailyReportWebhookUrl.value() ||
                slackCleaningReportWebhookUrl.value() ||
                ""
            ).trim();
            if (!webhookUrl) return;

            const text = [`[Sync Alert] ${title}`, ...lines].join("\n");
            await axios.post(webhookUrl, { text }, {
                headers: { "Content-Type": "application/json" },
                timeout: 10000
            });
        } catch (e) {
            console.error("[Slack] sendSyncAlert 실패 (원래 오류는 호출부 로그 참고):", e.message || e);
        }
    }

    async function buildAndSendSlackDailyReport(useToday = false, targetDateStr = null, skipIfUnchanged = false, isResend = false) {
        const webhookUrl = (slackDailyReportWebhookUrl.value() || "").trim();
        if (!webhookUrl) {
            console.log("⏭️ [Slack Daily] 웹훅 URL 미설정 — 건너뜀");
            return;
        }

        await assertReservationDataReady("buildAndSendSlackDailyReport");

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

        const byBuilding = {};
        for (const b of SLACK_DAILY_REPORT_BUILDINGS) {
            byBuilding[b] = { new: 0, cancel: 0, revenue: 0 };
        }
        newBookings.forEach((b) => {
            const bd = b.building || "기타";
            if (byBuilding[bd]) {
                byBuilding[bd].new += 1;
                byBuilding[bd].revenue += getBookingAmount(b);
            }
        });
        cancelledBookings.forEach((b) => {
            const bd = b.building || "기타";
            if (byBuilding[bd]) byBuilding[bd].cancel += 1;
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
            const rev = s.revenue > 0 ? `¥${s.revenue.toLocaleString()}` : "—";
            return `• ${b}  ·  예약 ${s.new}건  취소 ${s.cancel}건  ·  ${rev}`;
        }).join("\n");

        const messageTextClean = `일일 운영 리포트 · ${yesterdayStr}
■ 전일 실적 (전 건물 합계)
신규 예약 ${totalNew}건　취소 ${totalCancel}건　매출 ¥${dailyRevenue.toLocaleString()}
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
            if (dRev !== 0) diffParts.push(`매출 ${dRev > 0 ? "+" : ""}¥${dRev.toLocaleString()}`);
            if (dMtd !== 0) diffParts.push(`당월누적 ${dMtd > 0 ? "+" : ""}${dMtd}건`);
            const changeSummaryLine = diffParts.length > 0 ? `\n📌 전번 대비 변동: ${diffParts.join(" | ")}\n` : "";
            const MAX_DETAIL = 10;
            const newDetailLines = newBookings.slice(0, MAX_DETAIL).map((b) => {
                const amt = getBookingAmount(b);
                return `${b.building || "-"} ${b.room || "-"} | ${(b.guestName || "-").slice(0, 12)} | ¥${amt.toLocaleString()}`;
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

    function getReservationPax(reservation) {
        return (reservation?.numAdult || 0) + (reservation?.numChild || 0);
    }

    async function buildAndSendSlackCleaningReport(targetDateStr) {
        const webhookUrl = (slackCleaningReportWebhookUrl.value() || "").trim();
        if (!webhookUrl) {
            console.log("⏭️ [Slack Cleaning] 웹훅 URL 미설정 — 건너뜀");
            return;
        }

        await assertReservationDataReady("buildAndSendSlackCleaningReport");

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

        const departureRoomKeys = new Set();
        departures.forEach((r) => {
            if (r.building === "다이쿄초") return;
            departureRoomKeys.add(`${r.building || ""}_${r.room || ""}`);
        });

        const arrivalByKey = {};
        arrivals.forEach((r) => {
            if (r.building === "다이쿄초") return;
            const key = `${r.building || ""}_${r.room || ""}`;
            arrivalByKey[key] = r;
        });

        const cleaningList = await Promise.all(departures.map(async (d) => {
            if (d.building === "다이쿄초") return null;
            const key = `${d.building || ""}_${d.room || ""}`;
            const arr = arrivalByKey[key];
            if (arr) {
                const name = arr.guestName || "—";
                return { building: d.building, room: d.room, label: `${name} | ${getReservationPax(arr)}명` };
            }

            const nextCheckinSnap = await db.collection("reservations")
                .where("companyId", "==", DEFAULT_COMPANY_ID)
                .where("status", "==", "confirmed")
                .where("building", "==", d.building)
                .where("room", "==", d.room)
                .where("arrival", ">", targetDateStr)
                .orderBy("arrival", "asc")
                .limit(1)
                .get();

            const nextCheckin = nextCheckinSnap.docs.map((doc) => doc.data()).find((doc) => getEffectiveCompanyId(doc) === DEFAULT_COMPANY_ID);
            if (nextCheckin) {
                const nextName = nextCheckin.guestName || "—";
                return {
                    building: d.building,
                    room: d.room,
                    label: `당일 체크인 없음 | 다음 체크인 ${nextCheckin.arrival}: ${nextName} | ${getReservationPax(nextCheckin)}명`
                };
            }

            return { building: d.building, room: d.room, label: "당일 체크인 없음" };
        }));

        const settingList = [];
        arrivals.forEach((a) => {
            if (a.building === "다이쿄초") return;
            const key = `${a.building || ""}_${a.room || ""}`;
            if (departureRoomKeys.has(key)) return;
            const name = a.guestName || "—";
            settingList.push({ building: a.building, room: a.room, label: `${name} | ${getReservationPax(a)}명` });
        });

        const sortedCleaning = sortCleaningByBuilding(cleaningList.filter(Boolean));
        const sortedSetting = sortCleaningByBuilding(settingList);

        const byBuilding = (list, title) => {
            const groups = {};
            list.forEach((t) => {
                const b = t.building || "기타";
                if (!groups[b]) groups[b] = [];
                groups[b].push(`${t.room || ""} | ${t.label}`);
            });
            const lines = [];
            CLEANING_BUILDING_ORDER.forEach((b) => {
                if (!groups[b] || groups[b].length === 0) return;
                lines.push(`${b}\n${groups[b].join("\n")}`);
            });
            if (lines.length === 0) return `${title}\n없음`;
            return `${title}\n${lines.join("\n\n")}`;
        };

        const cleaningBlock = byBuilding(sortedCleaning, "1. 청소해야 하는 객실");
        const settingBlock = byBuilding(sortedSetting, "2. 셋팅해야 하는 객실");

        const messageText = `청소/셋팅 운영 알림\n기준일: ${targetDateStr}\n\n${cleaningBlock}\n\n${settingBlock}`;
        await axios.post(webhookUrl, { text: messageText }, { headers: { "Content-Type": "application/json" }, timeout: 10000 });
        console.log("✅ [Slack Cleaning] 발송 완료:", targetDateStr);
    }

    const scheduledSlackDailyReport = onSchedule({
        schedule: "0 8 * * *",
        timeZone: "Asia/Tokyo",
        timeoutSeconds: 120,
        memory: "256MiB"
    }, async () => {
        try {
            // 아침 08:00 JST: 전날(어제) 기준 일일 리포트 1회 발송. 변동 재전송은 scheduleOutputUpdates에서 처리.
            await buildAndSendSlackDailyReport();
        } catch (e) {
            console.error("❌ [Slack Daily] scheduledSlackDailyReport 실패:", e.stack || e.message);
            await sendSyncAlert("scheduledSlackDailyReport failed", [String(e.stack || e.message)]);
        }
    });

    const sendSlackDailyReportManual = onRequest({ cors: true }, async (req, res) => {
        try {
            const useToday = (req.query && req.query.target === "today");
            await buildAndSendSlackDailyReport(useToday);
            res.json({ success: true, message: "Slack daily report sent", target: useToday ? "today" : "yesterday" });
        } catch (e) {
            console.error("sendSlackDailyReportManual:", e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    const scheduledSlackCleaningReport = onSchedule({
        schedule: "50 8 * * *",
        timeZone: "Asia/Tokyo",
        timeoutSeconds: 120,
        memory: "256MiB"
    }, async () => {
        try {
            const todayStr = dayjs().tz("Asia/Tokyo").format("YYYY-MM-DD");
            await buildAndSendSlackCleaningReport(todayStr);
        } catch (e) {
            console.error("❌ [Slack Cleaning] scheduledSlackCleaningReport 실패:", e.stack || e.message);
            await sendSyncAlert("scheduledSlackCleaningReport failed", [String(e.stack || e.message)]);
        }
    });

    const sendSlackCleaningReportManual = onRequest({ cors: true }, async (req, res) => {
        try {
            const dateStr = (req.query && req.query.date) || dayjs().tz("Asia/Tokyo").format("YYYY-MM-DD");
            await buildAndSendSlackCleaningReport(dateStr);
            res.json({ success: true, message: "Slack cleaning report sent", date: dateStr });
        } catch (e) {
            console.error("sendSlackCleaningReportManual:", e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    return {
        sendSyncAlert,
        buildAndSendSlackDailyReport,
        buildAndSendSlackCleaningReport,
        scheduledSlackDailyReport,
        sendSlackDailyReportManual,
        scheduledSlackCleaningReport,
        sendSlackCleaningReportManual
    };
}

module.exports = {
    createSlackReportModule
};
