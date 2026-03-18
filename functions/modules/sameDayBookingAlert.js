/**
 * 당일 예약 알람: "당일 예약" = 오늘 접수(bookDate=오늘) + 오늘 체크인(arrival=오늘)인 신규 확정 건만 Slack으로 전송.
 * - 호출 측에서 bookDate===오늘, arrival===오늘, eventType===created, status===confirmed 등 조건 만족 시 호출.
 * - 플랫폼 무관: 에어비엔비/부킹/수기 등 전체.
 */
const axios = require("axios");
const dayjs = require("dayjs");
const { defineString } = require("firebase-functions/params");

const sameDayBookingWebhookUrl = defineString("SLACK_SAME_DAY_BOOKING_WEBHOOK_URL", { default: "" });

function formatGuestCount(booking) {
    const adult = Number(booking.numAdult) || 0;
    const child = Number(booking.numChild) || 0;
    const total = adult + child;
    if (total === 0) return "인원: -";
    const parts = [];
    if (adult > 0) parts.push(`성인 ${adult}명`);
    if (child > 0) parts.push(`아동 ${child}명`);
    return `인원: ${parts.join(", ")} (총 ${total}명)`;
}

function toDateOnly(str) {
    if (!str) return null;
    const s = String(str);
    return s.length >= 10 ? s.slice(0, 10) : s;
}

function formatSameDayMessage(booking) {
    const arrival = toDateOnly(booking.arrival);
    const departure = toDateOnly(booking.departure);
    const nights = (arrival && departure)
        ? dayjs(departure).diff(dayjs(arrival), "day")
        : 0;
    const guestCount = formatGuestCount(booking);
    const amount = booking.totalPrice != null ? `¥${Number(booking.totalPrice).toLocaleString()}` : "-";
    return [
        "🔔 당일 예약 1건",
        `건물: ${booking.building || "-"} | 객실: ${booking.room || "-"}`,
        `체크인: ${arrival || "-"} | 체크아웃: ${departure || "-"} | ${nights}박`,
        `게스트: ${booking.guestName || "-"} | ${guestCount} | 플랫폼: ${booking.platform || booking.referer || "-"}`,
        `금액: ${amount} | 예약ID: ${booking.bookId || booking.id || "-"}`
    ].join("\n");
}

/**
 * 당일 예약 알람을 Slack 수신 웹훅으로 전송.
 * URL이 비어 있으면 전송하지 않음. 실패 시 예외를 던지므로 호출 측에서 try/catch 권장.
 * @param {Object} booking - normalized 예약 문서 (building, room, arrival, departure, guestName, numAdult, numChild, platform, totalPrice, bookId 등)
 */
async function sendSameDayBookingAlert(booking) {
    if (!booking || typeof booking !== "object") {
        console.warn("[SameDayAlert] booking 없음 — 건너뜀");
        return;
    }
    const webhookUrl = (sameDayBookingWebhookUrl.value() || "").trim();
    if (!webhookUrl) {
        console.warn("[SameDayAlert] SLACK_SAME_DAY_BOOKING_WEBHOOK_URL 미설정 — 알람 건너뜀");
        return;
    }
    const text = formatSameDayMessage(booking);
    console.log("[SameDayAlert] 전송 시도", { bookId: booking.bookId || booking.id, building: booking.building, arrival: booking.arrival });
    await axios.post(webhookUrl, { text }, {
        headers: { "Content-Type": "application/json" },
        timeout: 10000
    });
    console.log("[SameDayAlert] Slack 전송 성공", { bookId: booking.bookId || booking.id });
}

module.exports = {
    sendSameDayBookingAlert,
    formatSameDayMessage
};
