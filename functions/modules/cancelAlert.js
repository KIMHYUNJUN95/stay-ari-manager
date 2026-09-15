/**
 * 당일 취소 알람: 취소 발생 시 기간/채널 제한 없이 모든 취소 예약을 Slack(당일취소알람 채널)로 전송.
 * - 예약일, 취소일, 입실일 제한 없음.
 * - 채널 필터 없음: 모든 플랫폼 취소 알림 전송.
 * - 알람 형식은 기존 취소 알림 양식을 유지.
 */
const axios = require("axios");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const { defineString } = require("firebase-functions/params");

dayjs.extend(utc);
dayjs.extend(timezone);

const cancelAlertWebhookUrl = defineString("SLACK_CANCEL_ALERT_WEBHOOK_URL");

function toDateOnly(str) {
    if (!str) return null;
    const s = String(str);
    return s.length >= 10 ? s.slice(0, 10) : s;
}

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

/**
 * 취소 알람 메시지 생성 (당일 예약 알람과 동일한 형식).
 * @param {Object} booking - 취소된 예약 문서 (building, room, arrival, departure, guestName, cancelTime, totalPrice, bookId 등)
 */
function formatCancelAlertMessage(booking) {
    const arrival = toDateOnly(booking.arrival);
    const departure = toDateOnly(booking.departure);
    const nights = (arrival && departure)
        ? dayjs(departure).diff(dayjs(arrival), "day")
        : 0;
    const guestCount = formatGuestCount(booking);
    const amount = booking.totalPrice != null ? `¥${Number(booking.totalPrice).toLocaleString()}` : "-";
    const platform = booking.referer || booking.platform || "-";
    const cancelTimeStr = booking.cancelTime
        ? dayjs(booking.cancelTime).tz("Asia/Tokyo").format("YYYY-MM-DD HH:mm")
        : "-";
    return [
        "🔔 당일 취소 1건",
        `건물: ${booking.building || "-"} | 객실: ${booking.room || "-"}`,
        `체크인: ${arrival || "-"} | 체크아웃: ${departure || "-"} | ${nights}박`,
        `게스트: ${booking.guestName || "-"} | ${guestCount} | 플랫폼: ${platform}`,
        `금액: ${amount} | 예약ID: ${booking.bookId || booking.id || "-"}`,
        `취소 시각: ${cancelTimeStr} (JST)`
    ].join("\n");
}

/**
 * 당일 취소 알람을 Slack 웹훅으로 전송.
 * URL이 비어 있으면 전송하지 않음.
 * @param {Object} booking - 취소된 예약 문서 (normalized)
 */
async function sendCancelAlert(booking) {
    if (!booking || typeof booking !== "object") {
        console.warn("[CancelAlert] booking 없음 — 건너뜀");
        return;
    }
    const webhookUrl = (cancelAlertWebhookUrl.value() || "").trim();
    if (!webhookUrl) {
        console.warn("[CancelAlert] SLACK_CANCEL_ALERT_WEBHOOK_URL 미설정 — 알람 건너뜀");
        return;
    }
    const text = formatCancelAlertMessage(booking);
    console.log("[CancelAlert] 전송 시도", { bookId: booking.bookId || booking.id, building: booking.building, arrival: booking.arrival });
    await axios.post(webhookUrl, { text }, {
        headers: { "Content-Type": "application/json" },
        timeout: 10000
    });
    console.log("[CancelAlert] Slack 전송 성공", { bookId: booking.bookId || booking.id });
}

module.exports = {
    sendCancelAlert,
    formatCancelAlertMessage
};
