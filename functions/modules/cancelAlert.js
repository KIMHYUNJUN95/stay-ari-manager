/**
 * 당일 취소 알람: 취소 발생 시 입실일이 오늘 기준 앞뒤 6개월 이내인 예약만 Slack(당일취소알람 채널)로 전송.
 * - 일일보고서 취소 건수와 동일 기준(입실일 ±6개월).
 * - 채널 필터: 에어비엔비·부킹닷컴만 알람 전송 (그 외 채널은 건너뜀).
 * - 알람 형식은 당일 예약 알람과 동일한 톤으로 전송.
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
 * 에어비엔비·부킹닷컴 채널만 허용 (당일취소알람 채널 필터).
 */
function isAirbnbOrBooking(booking) {
    const ref = String(booking.referer || booking.platform || "").toLowerCase();
    if (ref.includes("airbnb")) return true;
    if (ref.includes("booking")) return true;
    return false;
}

/**
 * 입실일이 오늘 기준 앞뒤 6개월 이내인지 여부 (일일보고서 취소 건수와 동일 기준).
 */
function isArrivalWithinSixMonths(booking) {
    const arrival = booking.arrival;
    if (!arrival) return false;
    const tokyoNow = dayjs().tz("Asia/Tokyo");
    const arrDate = dayjs(arrival).tz("Asia/Tokyo");
    const sixMonthsAgo = tokyoNow.subtract(6, "month");
    const sixMonthsLater = tokyoNow.add(6, "month");
    return (arrDate.isAfter(sixMonthsAgo) || arrDate.isSame(sixMonthsAgo, "day"))
        && (arrDate.isBefore(sixMonthsLater) || arrDate.isSame(sixMonthsLater, "day"));
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
    if (!isArrivalWithinSixMonths(booking)) {
        console.log("[CancelAlert] 입실일이 ±6개월 이외 — 건너뜀", { arrival: booking.arrival, bookId: booking.bookId || booking.id });
        return;
    }
    if (!isAirbnbOrBooking(booking)) {
        console.log("[CancelAlert] 에어/부킹 외 채널 — 건너뜀", { referer: booking.referer, platform: booking.platform, bookId: booking.bookId || booking.id });
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
    formatCancelAlertMessage,
    isArrivalWithinSixMonths
};
