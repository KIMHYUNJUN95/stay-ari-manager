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

admin.initializeApp();
const db = admin.firestore();

// ==========================================
// 1) CONSTANTS & MAPPING (사용자 정보 포함)
// ==========================================
// const BEDS24_API_KEY = "REMOVED_FOR_V2"; // V2로 완전 전환되어 사용하지 않음

// ==========================================
// Beds24 API V2 설정 (Firestore 토큰 캐싱)
// ==========================================
const BEDS24_REFRESH_TOKEN = "f9dBEWviugAGMcPCPMoRIOG7OpguLo187eDqsuhzaFKNrPdkISHOBZtZaYHGHc2Kc5uEaVljPfPq/xVbzPn0bkXrj2gf6Ly96bpHrsm9X9XwC4U/CAA/QPK9EgbVbQOEAj5iYME1EobhelKpStKYg1OK7zruxGOehEykt7yT5Mw=";

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
    { name: "아라키초A", id: "NSoH37aJMipHA4K4MPVyp2pnq", v2Id: 176430 },
    { name: "아라키초B", id: "AV3yKzD2gFz4OmNdlv4qANoQc", v2Id: 280663 },
    { name: "다이쿄초", id: "CXNtlpJnRuKJDPrTpqOaa3yws", v2Id: 206509, disabled: true }, // ★ 매각 완료 (2026-01-25) - API 동기화 중단, 과거 데이터 보존
    { name: "가부키초", id: "3ldwEucRNOIyhAdAhFWbBhw3e", v2Id: 176431 },
    { name: "다카다노바바", id: "8Nx8VcOYwSYVAwG01xkokmsX7", v2Id: 243936 },
    { name: "오쿠보A동", id: "dJQloWov7XuXMUmSXyVsLP8LR", v2Id: 205165 },
    { name: "오쿠보B동", id: "WbtREQENBg6aIR0pgEIympSAv", v2Id: 294552 },
    { name: "오쿠보C동", id: "MXP5jJXp2mPxVhjdTAF0KnHTP", v2Id: 211056 },
    { name: "사노시", id: "gDzuVIkyvm5fqtuifdveeIKZO", v2Id: 226546 }
];

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
        "441885": "802호", "452065": "802호", "624198": "803호",
        "437952": "오쿠보A", "615969": "오쿠보B", "450096": "오쿠보C", "496532": "오쿠보C",
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
    const guestName = `${b.firstName || b.guestFirstName || ""} ${b.lastName || b.guestName || ""}`.toLowerCase();

    // 블락/점검 키워드 체크
    if (guestName.includes("블락") || guestName.includes("점검") || guestName.includes("blackout") || guestName.includes("block")) {
        return "blackout";
    }

    // V1: 0 = Cancelled, 1/2 = Confirmed
    // V2: "cancelled"/"canceled" = Cancelled, "new"/"confirmed" = Confirmed
    if (s === "0" || s === "cancelled" || s === "canceled") {
        return "cancelled";
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
function normalize(b, propKey, building) {
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
    };
}

// ★ Beds24 API V2 호출 (페이지네이션 + 순차 호출)
// Beds24 제한: 1회 최대 100건, 동시 1개 호출만 허용
// V2 Endpoint: GET /bookings
async function fetchAllBookingsFromProperty(prop, dateParams) {
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

    // ★ 두 번 조회: 1) 일반 예약, 2) 취소된 예약
    const statusesToFetch = [null, "cancelled"];  // null = 기본(new/confirmed), "cancelled" = 취소

    for (const statusFilter of statusesToFetch) {
        let page = 1;
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

                // 날짜 파라미터 추가
                if (finalParams.arrivalFrom) params.arrivalFrom = finalParams.arrivalFrom;
                if (finalParams.arrivalTo) params.arrivalTo = finalParams.arrivalTo;

                // ★ V2 API 호출
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

                allBookings.push(...arr.map((b) => normalize(b, prop.id, prop.name)));

                // 다음 페이지 존재 여부 확인
                const pagesInfo = res.data.pages;
                if (pagesInfo && pagesInfo.nextPageExists) {
                    page++;
                    // 페이지네이션 사이 딜레이
                    await new Promise(resolve => setTimeout(resolve, 1500));
                } else {
                    break;
                }

            } catch (err) {
                console.error(`❌ Fetch Error (${prop.name} [${statusLabel}], page=${page}):`, err.message);
                throw err;
            }
        }

        // 상태 변경 사이 딜레이
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // 취소 예약 카운트 로그
    const cancelledCount = allBookings.filter(b => b.status === "cancelled").length;
    console.log(`  ✅ ${prop.name} 총합: ${allBookings.length}건 (취소: ${cancelledCount}건)`);

    return allBookings;
}

// 빠른 동기화: 도쿄 시간 기준 6개월 전 ~ 향후 18개월 (서버/로컬 시간차 보정)
// ★ 서버가 2025년일 경우, 2026년 2월 데이터를 잡기 위해 +1년 이상의 버퍼 필요
async function fetchFromBeds24Quick() {
    const tokyoNow = dayjs().utcOffset(9);
    // ★ 원복: 체크인 날짜(Arrival) 기준 6개월 (동기화는 넓게 가져오고, 필터는 프론트에서)
    const arrivalFrom = tokyoNow.subtract(6, "month").format("YYYYMMDD");
    const arrivalTo = tokyoNow.add(6, "month").format("YYYYMMDD");

    console.log(`[Quick Sync] Tokyo: ${tokyoNow.format("YYYY-MM-DD HH:mm")} | Arrival Range: ${arrivalFrom} ~ ${arrivalTo}`);

    const allBookings = [];

    // ★ 순차 호출 (Beds24 제한: 동시 1개만)
    for (const prop of PROPERTIES) {
        if (prop.disabled) {
            console.log(`⏭️  Skipping (disabled): ${prop.name}`);
            continue;
        }
        console.log(`🔄 Fetching: ${prop.name}...`);
        // ★ 변경: 다시 Arrival 기준 (사용자 요청: 동기화는 건드리지 마라)
        const bookings = await fetchAllBookingsFromProperty(prop, {
            arrivalFrom: arrivalFrom,
            arrivalTo: arrivalTo
        });
        allBookings.push(...bookings);

        // API 호출 사이 딜레이 (2초로 증가 - Rate Limit 방지)
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log(`✅ Quick Sync 완료: 총 ${allBookings.length}건`);
    return allBookings;
}

// 전체 동기화: 2023년 1월부터 향후 2년 (표준)
async function fetchFromBeds24Full() {
    const arrivalFrom = "2023-01-01"; // 다시 2023년부터 조회
    const arrivalTo = dayjs().add(24, "month").format("YYYY-MM-DD"); // V2 형식 유지

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
        });
        allBookings.push(...bookings);

        // API 호출 사이 딜레이 (2초로 증가 - Rate Limit 방지)
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log(`✅ Full Sync 완료: 총 ${allBookings.length}건`);
    return allBookings;
}

// saveBookings: syncRangeStart를 전달받아 해당 범위 내의 예약만 취소 처리
async function saveBookings(list, syncRangeStart = null) {
    const batchLimit = 400;
    let batch = db.batch();
    let count = 0;

    // Beds24에서 가져온 예약 ID 목록
    const beds24BookIds = new Set(list.map(item => item.id));

    // 건물별로 기존 예약 확인 및 삭제/취소 처리
    const buildingsInList = [...new Set(list.map(item => item.building))];

    // ★ 동기화 범위 시작일 (Quick Sync: 오늘, Full Sync: 2023-01-01)
    const rangeStartDate = syncRangeStart ? new Date(syncRangeStart) : null;

    for (const building of buildingsInList) {
        const existingSnap = await db.collection("reservations")
            .where("building", "==", building)
            .get();

        for (const doc of existingSnap.docs) {
            const docId = doc.id;
            // Beds24에 없는 예약은 cancelled로 표시
            if (!beds24BookIds.has(docId)) {
                const existingData = doc.data();
                // 이미 cancelled가 아니고, 활성 상태인 경우 (confirmed, blackout, maintenance 포함)
                const activeStatuses = ["confirmed", "blackout", "maintenance"];
                if (activeStatuses.includes(existingData.status) && existingData.arrival) {
                    const arrivalDate = new Date(existingData.arrival);

                    // ★ 핵심 수정: 동기화 범위 내의 예약만 취소 처리
                    // Quick Sync는 오늘 이후 예약만 가져오므로, 과거 예약은 건드리지 않음
                    if (rangeStartDate && arrivalDate < rangeStartDate) {
                        // 동기화 범위 이전의 예약은 건드리지 않음 (과거 예약 보존)
                        continue; // for...of 에서는 continue 사용
                    }

                    const sixMonthsAgo = new Date();
                    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

                    if (arrivalDate > sixMonthsAgo) {
                        console.log(`Marking as cancelled (not in Beds24): ${docId} - ${existingData.guestName}`);
                        batch.update(doc.ref, {
                            status: "cancelled",
                            updatedAt: new Date(),
                            syncNote: "Beds24에서 삭제됨"
                        });
                        count++;

                        if (count % batchLimit === 0) {
                            await batch.commit(); // ★ 이제 정상적으로 작동
                            batch = db.batch();
                        }
                    }
                }
            }
        }
    }

    // 새로운/업데이트된 예약 저장 (merge: false로 완전 덮어쓰기)
    for (const item of list) {
        const docRef = db.collection("reservations").doc(item.id);
        batch.set(docRef, item); // merge 없이 완전 덮어쓰기

        count++;
        if (count % batchLimit === 0) {
            await batch.commit();
            batch = db.batch();
        }
    }
    if (count % batchLimit !== 0) { await batch.commit(); }
    return count;
}


// ==========================================
// 4) EXPORTS
// ==========================================

// 빠른 동기화 (기본) - 6개월 전 ~ 향후 6개월 (과거 예약 변경도 자동 반영)
// ★ 순차 호출로 변경되어 타임아웃 증가
exports.syncBeds24 = onRequest({ cors: true, timeoutSeconds: 540, memory: '512MiB' }, async (req, res) => {
    try {
        const tokyoNow = dayjs().utcOffset(9);
        const syncRangeStart = tokyoNow.subtract(6, "month").format("YYYY-MM-DD"); // 6개월 전부터
        const list = await fetchFromBeds24Quick();
        const count = await saveBookings(list, syncRangeStart);
        res.json({ success: true, message: `빠른 동기화 완료! ${count}건 저장됨 (6개월 전~6개월 후)`, count });
    } catch (e) {
        console.error("Quick Sync Failed:", e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 전체 동기화 (관리자용) - 2023년 1월부터 전체
// ★ 순차 호출 + 페이지네이션으로 모든 데이터 가져오기 (최대 10분)
exports.syncBeds24Full = onRequest({ cors: true, timeoutSeconds: 900, memory: '1GiB' }, async (req, res) => {
    try {
        const syncRangeStart = "2023-01-01"; // 다시 2023년부터
        const list = await fetchFromBeds24Full();
        const count = await saveBookings(list, syncRangeStart);
        res.json({ success: true, message: `전체 동기화 완료! ${count}건 저장됨 (2023년~향후 24개월)`, count });
    } catch (e) {
        console.error("Full Sync Failed:", e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==========================================
// 가격 데이터 동기화 서포트 함수 (Lock & Retry)
// ==========================================

// 동기화 잠금 관리
async function useSyncLock(action = 'check') {
    const lockRef = db.collection("sync_status").doc("price_sync_lock");
    const now = new Date();

    if (action === 'acquire') {
        const snap = await lockRef.get();
        if (snap.exists) {
            const data = snap.data();
            const lockTime = data.lockedAt?.toDate() || new Date(0);
            const diffMinutes = (now - lockTime) / (1000 * 60);

            // 15분이 지났으면 고착된 락으로 간주하고 강제 점유
            if (diffMinutes < 15) {
                console.log(`[Sync Lock] 이미 실행 중입니다 (시작: ${Math.round(diffMinutes)}분 전)`);
                return false;
            }
        }
        await lockRef.set({ lockedAt: admin.firestore.FieldValue.serverTimestamp(), status: 'running' });
        return true;
    } else if (action === 'release') {
        await lockRef.delete();
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

// Beds24 API V2 POST 전용 Retry + Backoff 래퍼
async function beds24PostV2WithRetry(endpoint, data, attempts = 3) {
    for (let i = 0; i < attempts; i++) {
        try {
            const token = await getBeds24Token();
            const response = await axios.post(`https://beds24.com/api/v2${endpoint}`, data, {
                headers: { "token": token }
            });

            // V2 에러 체크
            if (response.data && response.data.success === false) {
                const errorStr = String(response.data.error || "").toLowerCase();
                if (errorStr.includes("limit exceeded") || errorStr.includes("too many requests")) {
                    throw { isRateLimit: true, message: response.data.error };
                }
                // success === false인 경우 에러로 처리
                throw new Error(response.data.error || "Beds24 API 호출 실패");
            }
            return response;
        } catch (err) {
            const isLastAttempt = i === attempts - 1;
            const isRateLimit = err.isRateLimit || err.response?.status === 429;

            if (isRateLimit && !isLastAttempt) {
                const waitSec = (i + 1) * 10; // V2 Rate Limit 대기시간 증가
                console.warn(`[V2 POST Retry] Rate Limit 감지. ${waitSec}초 후 재시도 (${i + 1}/${attempts})`);
                await new Promise(r => setTimeout(r, waitSec * 1000));
                continue;
            }

            if (isLastAttempt) throw err;

            // 일반 네트워크 에러 재시도
            const waitSec = 2;
            console.warn(`[V2 POST Retry] 네트워크 오류: ${err.message}. ${waitSec}초 후 재시도`);
            await new Promise(r => setTimeout(r, waitSec * 1000));
        }
    }
}

// 가격 데이터 동기화 함수 (Firestore 캐싱)
// ==========================================
async function syncAllPrices() {
    const isLocked = await useSyncLock('acquire');
    if (!isLocked) return { error: "Sync already in progress" };

    try {
        const tokyoNow = dayjs().utcOffset(9);
        const fromDate = tokyoNow.format("YYYY-MM-DD"); // V2용 (YYYY-MM-DD)
        const toDate = tokyoNow.add(6, "month").format("YYYY-MM-DD");

        // firestore 저장용 키 생성 (YYYYMMDD) 헬퍼
        const toKey = (d) => d.replace(/-/g, '');

        console.log(`[V2 Bulletproof Sync] 시작: ${fromDate} ~ ${toDate} (Pace: 0.5s)`);
        const syncResults = {};

        for (const prop of PROPERTIES) {
            if (prop.disabled) {
                console.log(`⏭️  [Price Sync Skip] ${prop.name}: disabled`);
                continue;
            }
            const buildingName = prop.name;
            const roomsToFetch = BUILDING_ROOMS[buildingName] || [];
            if (roomsToFetch.length === 0) continue;

            console.log(`[V2 Sync] 건물 시작: ${buildingName} (${roomsToFetch.length}개 객실)`);
            let successInBuilding = 0;

            for (const room of roomsToFetch) {
                const rid = String(room.roomId);
                try {
                    // [Cache Protection] 최근 15분 내 수동 수정된 방 스킵
                    const roomDocRef = db.collection("price_sync").doc(buildingName).collection("rooms").doc(rid);
                    const existingSnap = await roomDocRef.get();
                    if (existingSnap.exists) {
                        const roomCache = existingSnap.data();
                        const lastUserUpdate = roomCache?.lastManualUpdate?.toDate() || null;
                        if (lastUserUpdate && dayjs().diff(dayjs(lastUserUpdate), 'minute') < 15) {
                            console.log(`[Price Sync Skip] ${buildingName} - ${room.name}(${rid}): 최근 수동 수정됨`);
                            successInBuilding++;
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
                        includeMaxStay: true
                    });

                    // V2 응답 파싱
                    // 실제 구조: { data: [{ roomId, calendar: [{ from, to, price1, minStay, ... }] }] }
                    const roomData = response.data?.data?.[0];
                    if (roomData && Array.isArray(roomData.calendar)) {
                        const datesObj = {};

                        roomData.calendar.forEach(entry => {
                            // from/to 범위를 개별 날짜로 확장
                            const fromDate = dayjs(entry.from);
                            const toDate = dayjs(entry.to);

                            for (let d = fromDate; d.isBefore(toDate) || d.isSame(toDate, 'day'); d = d.add(1, 'day')) {
                                const dateKey = d.format('YYYYMMDD');
                                datesObj[dateKey] = {
                                    p1: String(entry.price1 || ""),
                                    p2: String(entry.price2 || ""),
                                    p3: String(entry.price3 || ""),
                                    m: String(entry.minStay || ""),
                                    mx: String(entry.maxStay || "")
                                };
                            }
                        });

                        // 원자적 개별 저장 (Atomic Storage)
                        await roomDocRef.set({
                            roomName: room.name,
                            roomId: rid,
                            dates: datesObj,
                            lastSyncRoom: admin.firestore.FieldValue.serverTimestamp()
                        }, { merge: true });
                        successInBuilding++;
                    } else if (response.data?.error) {
                        console.error(`[Price Sync Error] ${buildingName} - ${room.name}: ${response.data.error}`);
                    }

                } catch (err) {
                    console.error(`[Price Sync Fatal] ${buildingName} - ${room.roomId}:`, err.message);
                }

                // V2는 빠르므로 대기 시간 단축 (2.0s -> 0.5s)
                await new Promise(r => setTimeout(r, 500));
            }

            // 건물 요약 정보 업데이트
            await db.collection("price_sync").doc(buildingName).set({
                building: buildingName,
                lastSync: admin.firestore.FieldValue.serverTimestamp(),
                roomCount: successInBuilding,
                targetRoomCount: roomsToFetch.length,
                dateFrom: fromDate,
                dateTo: toDate
            }, { merge: true });

            syncResults[buildingName] = { success: true, rooms: successInBuilding };

            // 건물 간 대기 시간도 단축 (5s -> 1s)
            await new Promise(r => setTimeout(r, 1000));
        }

        console.log(`[V2 Sync] 전체 완료:`, syncResults);
        return syncResults;

    } finally {
        // 성공하든 실패하든 반드시 락 해제
        await useSyncLock('release');
    }
}

// 수동 가격 동기화 (HTTP 호출용)
exports.triggerPriceSync = onRequest({ cors: true, timeoutSeconds: 540 }, async (req, res) => {
    try {
        console.log("[Manual Trigger] 가격 동기화 시작");
        const result = await syncAllPrices();
        res.json({ success: true, message: "가격 동기화 완료", result });
    } catch (e) {
        console.error("[Manual Trigger] 가격 동기화 실패:", e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 스케줄러 (자동 동기화) - 15분마다 (비용 최적화)
// ★ 5개월 전부터 동기화하여 과거 예약 변경/취소도 자동 반영
// ★ 가격 데이터도 함께 동기화 (Firestore 캐싱)
exports.scheduledBeds24Sync = onSchedule({
    schedule: "every 15 minutes",
    timeoutSeconds: 540,
    memory: "1GiB"
}, async () => {
    const tokyoNow = dayjs().utcOffset(9);
    const syncRangeStart = tokyoNow.subtract(5, "month").format("YYYY-MM-DD"); // 5개월 전부터

    // 1. 예약 동기화
    const list = await fetchFromBeds24Quick();
    await saveBookings(list, syncRangeStart);
    console.log(`✅ 예약 동기화 완료: ${list.length}건 (${tokyoNow.format("YYYY-MM-DD HH:mm")})`);

    // 2. 가격 동기화 (Firestore 캐싱)
    await syncAllPrices();
    console.log(`✅ 가격 동기화 완료 (${tokyoNow.format("YYYY-MM-DD HH:mm")})`);
});

// 입/퇴실 조회
exports.getTodayArrivals = onRequest({ cors: true }, async (req, res) => {
    const date = req.body.date || dayjs().format("YYYY-MM-DD");

    const snap = await db.collection("reservations")
        .where("status", "==", "confirmed")
        .get();

    const list = [];
    snap.forEach((d) => {
        const x = d.data();
        if (x.arrival === date || x.departure === date) list.push(x);
    });

    res.json({ success: true, data: list });
});

// ==========================================
// 디버깅: 건물별 가격 필드 구조 확인 (V2)
// ==========================================
exports.debugPriceFields = onRequest({ cors: true, timeoutSeconds: 120 }, async (req, res) => {
    try {
        const tokyoNow = dayjs().utcOffset(9);
        const targetDate = tokyoNow.add(30, "day").format("YYYY-MM-DD");
        const results = {};

        for (const prop of PROPERTIES) {
            if (prop.disabled) continue; // disabled 건물 제외
            const rooms = BUILDING_ROOMS[prop.name];
            if (!rooms || rooms.length === 0) continue;

            const sampleRoom = rooms[0];

            try {
                // V2 GET /inventory/rooms/calendar
                const response = await beds24GetV2WithRetry("/inventory/rooms/calendar", {
                    propertyId: prop.v2Id,
                    startDate: tokyoNow.format("YYYY-MM-DD"),
                    endDate: tokyoNow.add(7, "day").format("YYYY-MM-DD"),
                    includePrices: true,
                    includeLinkedPrices: true,
                    includeMinStay: true,
                    includeMaxStay: true
                });

                results[prop.name] = {
                    roomsFound: (response.data && response.data.data) ? response.data.data.length : 0,
                    sampleRoom: (response.data && response.data.data) ? response.data.data[0] : null
                };
            } catch (err) {
                results[prop.name] = { error: err.message };
            }
            await new Promise(resolve => setTimeout(resolve, 300));
        }

        res.json({
            success: true,
            message: "건물별 가격 필드 구조 (V2)",
            targetDate: targetDate,
            fullData: results
        });
    } catch (e) {
        console.error("debugPriceFields Error:", e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==========================================
// 디버깅: Daily Price 채널 매핑 확인 (Legacy - 사용 중지)
// ==========================================
/*
exports.debugChannelMapping = onRequest({ cors: true, timeoutSeconds: 120 }, async (req, res) => {
    try {
        res.json({ message: "Legacy function disabled (V2 Migration)" });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
*/

exports.debugBeds24Fields = onRequest({ cors: true }, async (req, res) => {
    try {
        // V2 GET /bookings?limit=1
        const response = await beds24GetV2WithRetry("/bookings", {
            limit: 5 // 샘플 5개
        });

        const bookings = (response.data && Array.isArray(response.data.data)) ? response.data.data : [];

        if (bookings.length === 0) {
            return res.json({ message: "예약 데이터 없음", rawResponse: response.data });
        }

        // 모든 예약에서 발견된 필드들을 수집
        const allFields = new Set();
        const sampleValues = {};

        bookings.forEach(booking => {
            Object.keys(booking).forEach(key => {
                allFields.add(key);
                if (!sampleValues[key] && booking[key] !== null && booking[key] !== "" && typeof booking[key] !== 'object') {
                    sampleValues[key] = booking[key];
                }
            });
        });

        res.json({
            success: true,
            totalBookings: bookings.length,
            allFieldNames: Array.from(allFields).sort(),
            fieldCount: allFields.size,
            sampleBookingRaw: bookings[0],
            sampleValues: sampleValues
        });
    } catch (e) {
        console.error("Debug Error:", e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ★ minStay 실제 API 응답 확인용 디버그 함수
exports.debugMinStayResponse = onRequest({ cors: true, timeoutSeconds: 60 }, async (req, res) => {
    try {
        const { roomId, date } = req.query;

        if (!roomId) {
            return res.status(400).json({ error: "roomId 필요 (예: ?roomId=585734&date=2026-03-03)" });
        }

        // 날짜 범위 설정 (지정 날짜 또는 오늘부터 7일)
        const fromDate = date || dayjs().utcOffset(9).format('YYYY-MM-DD');
        const toDate = date || dayjs().utcOffset(9).add(7, 'day').format('YYYY-MM-DD');

        // Beds24 API 직접 호출 (RAW 응답 확인)
        const response = await beds24GetV2WithRetry("/inventory/rooms/calendar", {
            roomId: parseInt(roomId),
            from: fromDate,
            to: toDate,
            includePrice1: true,
            includePrice2: true,
            includeMinStay: true,
            includeMaxStay: true
        });

        res.json({
            success: true,
            roomId: roomId,
            dateRange: { from: fromDate, to: toDate },
            rawApiResponse: response.data,
            // minStay 값만 추출해서 보기 쉽게
            minStayValues: response.data?.data?.[0]?.calendar?.map(cal => ({
                date: cal.from,
                minStay: cal.minStay,
                minStayType: typeof cal.minStay,
                minStayIsNull: cal.minStay === null,
                minStayIsUndefined: cal.minStay === undefined,
                minStayIsZero: cal.minStay === 0,
                minStayIsEmpty: cal.minStay === ""
            })) || []
        });
    } catch (e) {
        console.error("debugMinStayResponse Error:", e.message);
        res.status(500).json({ success: false, error: e.message });
    }
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
        { roomId: "624198", name: "803호" }
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
    "오쿠보C동": [{ roomId: "450096", name: "오쿠보C" }, { roomId: "496532", name: "오쿠보C" }],
    "사노시": [{ roomId: "481152", name: "사노" }]
};

// ==========================================
// 가격 조회: Legacy API (효과적인 가격 반환 - API V2는 명시적 설정값만 반환하므로 사용 불가)
// ==========================================

// ==========================================
// 가격 조회 (Firestore 캐시에서 읽기 - API 호출 없음)
// ==========================================
// ★ 가격 설정 (수동) - V2 마이그레이션 완료
// V2: POST /inventory/rooms/calendar
exports.setRoomPrices = onRequest({ cors: true, timeoutSeconds: 300 }, async (req, res) => {
    try {
        const { roomId, roomIds, dates, building } = req.body;

        // roomId (단수) 또는 roomIds (배열) 지원
        let inputRoomIds = roomIds || (roomId ? [roomId] : []);
        if (inputRoomIds.length === 0 || !dates) {
            return res.status(400).json({ error: "Missing roomId/roomIds or dates" });
        }

        // ★ 모든 roomId에 가격 설정 (minStay 체크 제거)
        // 같은 방에 여러 roomId가 있는 경우 모두 설정해야 함
        const activeRoomIds = inputRoomIds;
        console.log(`[setRoomPrices] 가격 설정 대상 roomIds: ${activeRoomIds.join(', ')}`);

        // V1 payload ({ "20240101": { p1: "15000", m: "2" } }) 를 V2 Array로 변환
        const calendarUpdates = [];
        const toV2Date = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

        for (const [dateStr, val] of Object.entries(dates)) {
            const v2Date = toV2Date(dateStr);
            const updateItem = {
                from: v2Date,
                to: v2Date
            };
            // 'REMOVE' 또는 -1인 경우 null로 설정하여 Override 삭제
            if (val.p1 !== undefined) updateItem.price1 = (val.p1 === 'REMOVE' || val.p1 === -1) ? null : parseFloat(val.p1);
            if (val.p2 !== undefined) updateItem.price2 = (val.p2 === 'REMOVE' || val.p2 === -1) ? null : parseFloat(val.p2);
            if (val.p3 !== undefined) updateItem.price3 = (val.p3 === 'REMOVE' || val.p3 === -1) ? null : parseFloat(val.p3);
            if (val.m !== undefined) updateItem.minStay = (val.m === 'REMOVE' || val.m === -1) ? null : parseInt(val.m);

            calendarUpdates.push(updateItem);
        }

        // 각 roomId에 대해 API 호출 (Rate Limit 방지를 위해 딜레이 추가)
        const results = [];
        for (let i = 0; i < activeRoomIds.length; i++) {
            const rid = activeRoomIds[i];

            // 첫 번째가 아닌 경우 딜레이 (Rate Limit 방지)
            if (i > 0) {
                console.log(`[setRoomPrices] Rate Limit 방지 대기 (2초)...`);
                await new Promise(r => setTimeout(r, 2000));
            }

            try {
                const payload = [{
                    roomId: parseInt(rid),
                    calendar: calendarUpdates
                }];
                const apiResponse = await beds24PostV2WithRetry("/inventory/rooms/calendar", payload);

                // API 응답 확인 (V2 API는 success 필드로 성공 여부 표시)
                if (apiResponse.data && apiResponse.data.success === false) {
                    throw new Error(apiResponse.data.error || "Beds24 API 호출 실패");
                }

                results.push({ roomId: rid, success: true });
                console.log(`[setRoomPrices] Beds24 API 성공: roomId=${rid}`);
            } catch (err) {
                results.push({ roomId: rid, success: false, error: err.message });
                console.error(`[setRoomPrices] Beds24 API 실패: roomId=${rid}`, err.message);
            }
        }

        // 결과 확인: 모든 roomId가 실패했는지 확인
        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;
        const allSuccess = failCount === 0;
        const allFailed = successCount === 0;

        // 캐시 패칭용 roomIds (성공한 roomId만)
        const targetRoomIds = results.filter(r => r.success).map(r => String(r.roomId));

        // 3. price_sync 캐시 업데이트 (Write-through)
        try {
            const buildingRef = db.collection("price_sync").doc(building);
            const batch = db.batch();

            for (const rid of targetRoomIds) {
                const sRid = String(rid);
                const roomDocRef = buildingRef.collection("rooms").doc(sRid);
                const roomSnap = await roomDocRef.get();

                let roomData = roomSnap.exists ? roomSnap.data() : { roomId: sRid, dates: {} };
                if (!roomData.dates) roomData.dates = {};

                // [Cache Protection] 수동 수정 시점 기록
                roomData.lastManualUpdate = admin.firestore.FieldValue.serverTimestamp();

                Object.entries(dates).forEach(([dKey, values]) => {
                    if (!roomData.dates[dKey]) roomData.dates[dKey] = {};
                    if (values.p1 !== undefined) roomData.dates[dKey].p1 = String(values.p1);
                    if (values.p2 !== undefined) roomData.dates[dKey].p2 = String(values.p2);
                    if (values.m !== undefined) roomData.dates[dKey].m = String(values.m);
                });

                batch.set(roomDocRef, roomData, { merge: true });
            }
            await batch.commit();
            console.log(`[price_sync Patched] ${building} atomic updates committed.`);
        } catch (err) {
            console.error("price_sync Patching Error:", err.message);
        }

        // 응답: 성공/실패 여부와 상세 결과 반환
        if (allFailed) {
            return res.status(500).json({
                success: false,
                error: `모든 객실 가격 설정 실패 (${failCount}개 실패)`,
                results: results,
                roomIds: targetRoomIds
            });
        }

        res.json({
            success: allSuccess,
            message: allSuccess
                ? `가격 설정 완료 (V2 API) - ${successCount}개 객실 성공`
                : `일부 객실 가격 설정 완료 (V2 API) - ${successCount}개 성공, ${failCount}개 실패`,
            roomIds: targetRoomIds,
            results: results,
            patched: true
        });
    } catch (e) {
        console.error("setRoomPrices V2 Error:", e.response?.data || e.message);
        res.status(500).json({ success: false, error: e.response?.data?.error || e.message });
    }
});

exports.getCachedPrices = onRequest({ cors: true }, async (req, res) => {
    try {
        const { building } = req.body;

        if (!building) {
            return res.status(400).json({ success: false, error: "건물명이 필요합니다" });
        }

        const docRef = db.collection("price_sync").doc(building);
        const doc = await docRef.get();

        if (!doc.exists) {
            return res.json({
                success: false,
                error: "캐시된 가격 데이터가 없습니다. 잠시 후 다시 시도해주세요.",
                noCache: true
            });
        }

        // 새 구조: rooms 서브컬렉션에서 모든 방 데이터 가져오기
        const priceData = {};
        const roomsSnap = await docRef.collection("rooms").get();
        roomsSnap.forEach(roomDoc => {
            priceData[roomDoc.id] = roomDoc.data();
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
        const { building, roomId, dateFrom, dateTo } = req.body;

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
// 디버깅: Firestore 키 확인
// ==========================================
exports.debugRoomPropMapping = onRequest({ cors: true }, async (req, res) => {
    try {
        const snap = await db.collection("reservations")
            .where("departure", ">=", "2025-01-01")
            .get();

        const mapping = {};
        snap.forEach(doc => {
            const d = doc.data();
            if (d.building && d.roomId) {
                const key = `${d.building}_${d.roomId}`;
                if (!mapping[key]) mapping[key] = new Set();
                if (d.propKey) mapping[key].add(d.propKey);
            }
        });

        const result = {};
        Object.entries(mapping).forEach(([key, keys]) => {
            result[key] = Array.from(keys);
        });

        res.json({ success: true, mapping: result });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

exports.debugFindPropKeys = onRequest({ cors: true }, async (req, res) => {
    try {
        const snap = await db.collection("reservations")
            .where("departure", ">=", "2025-07-01")
            .get();

        const keys = {};
        const buildings = {};
        const wronglyCancelled = [];

        snap.forEach(doc => {
            const d = doc.data();
            const isConfirmed = d.status === "confirmed";
            const isWronglyCancelled = d.status === "cancelled" && d.syncNote === "Beds24에서 삭제됨";

            if (isConfirmed || isWronglyCancelled) {
                // PropKey Stats
                if (d.propKey) {
                    if (!keys[d.propKey]) keys[d.propKey] = { buildings: new Set(), confirmed: 0, wronglyCancelled: 0 };
                    keys[d.propKey].buildings.add(d.building);
                    if (isConfirmed) keys[d.propKey].confirmed++;
                    if (isWronglyCancelled) keys[d.propKey].wronglyCancelled++;
                }

                // Building Stats
                if (d.building) {
                    if (!buildings[d.building]) buildings[d.building] = { confirmedCount: 0, revenue: 0, wronglyCancelledCount: 0 };
                    if (isConfirmed) {
                        buildings[d.building].confirmedCount++;
                        buildings[d.building].revenue += (Number(d.totalPrice || d.price) || 0);
                    }
                    if (isWronglyCancelled) {
                        buildings[d.building].wronglyCancelledCount++;
                        wronglyCancelled.push({
                            id: doc.id,
                            building: d.building,
                            room: d.room,
                            propKey: d.propKey,
                            arrival: d.arrival,
                            revenue: (Number(d.totalPrice || d.price) || 0)
                        });
                    }
                }
            }
        });

        const resultKeys = Object.entries(keys).map(([k, v]) => ({
            propKey: k,
            buildings: Array.from(v.buildings),
            confirmed: v.confirmed,
            wronglyCancelled: v.wronglyCancelled
        }));

        res.json({
            success: true,
            keys: resultKeys,
            buildings,
            wronglyCancelledSample: wronglyCancelled.slice(0, 10),
            totalWronglyCancelled: wronglyCancelled.length,
            lostRevenue: wronglyCancelled.reduce((s, x) => s + x.revenue, 0)
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

exports.debugCheckFirestore = onRequest({ cors: true }, async (req, res) => {
    try {
        const { building } = req.body;
        if (building) {
            const doc = await db.collection("price_sync").doc(building).get();
            if (!doc.exists) return res.json({ success: false, error: "Doc not found" });
            const data = doc.data();

            // rooms 서브컬렉션에서 샘플 데이터 확인
            const roomsSnap = await db.collection("price_sync").doc(building).collection("rooms").limit(1).get();
            if (roomsSnap.empty) {
                return res.json({ success: true, building, roomCount: 0, status: "No room sub-docs found" });
            }

            const sampleRoomDoc = roomsSnap.docs[0];
            const sampleRoom = sampleRoomDoc.data();
            const dates = Object.keys(sampleRoom?.dates || {}).sort();

            return res.json({
                success: true,
                building,
                summaryRoomCount: data.roomCount,
                actualRoomCount: roomsSnap.size, // 여기서는 limit(1)이라 1이 나오겠지만, 전체 조회가 아니므로 참고용
                dateCount: dates.length,
                firstDate: dates[0],
                lastDate: dates[dates.length - 1],
                sampleRoom: sampleRoom?.roomName,
                sampleData: sampleRoom?.dates?.[dates[0]]
            });
        }

        const snap = await db.collection("price_sync").get();
        const keys = [];
        for (const doc of snap.docs) {
            const data = doc.data();
            // 서브컬렉션 개수 조회 (비용 발생하지만 디버깅용이므로 수행)
            const roomsSnap = await doc.ref.collection("rooms").get();
            keys.push({
                id: doc.id,
                roomCount: roomsSnap.size,
                lastSync: data.lastSync?.toDate()?.toISOString()
            });
        }
        res.json({ success: true, keys, count: keys.length });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==========================================
// 최소 숙박일수 설정: Beds24 API V2 (단일 API 호출)
// ==========================================
exports.setMinStay = onRequest({ cors: true, timeoutSeconds: 300 }, async (req, res) => {
    try {
        const { building, roomName, dateFrom, dateTo, minStayValue, dates } = req.body;
        console.log("setMinStay (V2) 요청:", { building, roomName, dateFrom, dateTo, minStayValue, dates });

        const roomInfos = BUILDING_ROOMS[building]?.filter(r => r.name === roomName) || [];
        if (roomInfos.length === 0) {
            return res.status(400).json({ success: false, error: `객실 ${roomName}을 찾을 수 없습니다` });
        }

        // 활성화된 roomId 찾기 (minStay < 50인 것만)
        // 여러 roomId가 있는 경우, 현재 활성화된 것을 찾아야 함
        let targetRoomId = null;
        for (const info of roomInfos) {
            try {
                const response = await beds24GetV2WithRetry("/inventory/rooms/calendar", {
                    roomId: parseInt(info.roomId),
                    startDate: dayjs().format("YYYY-MM-DD"),
                    endDate: dayjs().add(1, "day").format("YYYY-MM-DD"),
                    includeMinStay: true
                });
                const roomData = response.data?.data?.[0];
                if (roomData && Array.isArray(roomData.calendar) && roomData.calendar.length > 0) {
                    const currentMinStay = roomData.calendar[0].minStay || 0;
                    if (currentMinStay < 50) {
                        // 활성화된 roomId 발견
                        targetRoomId = info.roomId;
                        console.log(`[setMinStay] 활성화된 roomId 발견: ${info.roomId} (minStay: ${currentMinStay})`);
                        break;
                    }
                }
            } catch (err) {
                console.warn(`[setMinStay] roomId ${info.roomId} 확인 실패:`, err.message);
            }
        }

        // 활성화된 roomId를 찾지 못하면 첫 번째 사용 (fallback)
        if (!targetRoomId) {
            targetRoomId = roomInfos[0].roomId;
            console.warn(`[setMinStay] 활성화된 roomId를 찾지 못함, 첫 번째 사용: ${targetRoomId}`);
        }

        // v2: 일괄 설정
        const payload = {
            roomId: parseInt(targetRoomId),
            calendar: []
        };

        // 두 가지 형식 지원:
        // 1. dates 객체 (GAP 일괄수정): { "20260123": { m: 1 }, "20260125": { m: 1 } }
        // 2. dateFrom/dateTo/minStayValue (연속 날짜 범위)
        let datesToUpdate = {};
        if (dates && typeof dates === 'object') {
            // GAP 일괄수정 형식
            datesToUpdate = dates;
            Object.entries(dates).forEach(([dateKey, values]) => {
                // dateKey: "20260123" -> "2026-01-23"
                const v2Date = `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`;
                payload.calendar.push({
                    from: v2Date,
                    to: v2Date,
                    minStay: parseInt(values.m) || 1
                });
            });
        } else if (dateFrom && dateTo && minStayValue !== undefined) {
            // 연속 날짜 범위 형식
            const start = dayjs(dateFrom);
            const end = dayjs(dateTo);
            const diff = end.diff(start, 'day');
            for (let i = 0; i <= diff; i++) {
                const d = start.add(i, 'day');
                const v2Date = d.format('YYYY-MM-DD');
                payload.calendar.push({
                    from: v2Date,
                    to: v2Date,
                    minStay: parseInt(minStayValue)
                });
                datesToUpdate[d.format('YYYYMMDD')] = { m: String(minStayValue) };
            }
        } else {
            return res.status(400).json({ success: false, error: "dates 또는 dateFrom/dateTo/minStayValue가 필요합니다" });
        }

        // 배열로 감싸서 전송 [{ roomId: ..., calendar: [...] }]
        // ★ Beds24 버그 대응: 2→1 변경 시 빈칸이 되는 문제
        // 우회 방법: 먼저 중간값(3)으로 바꾸고, 다시 목표값으로 변경

        // 1로 바꾸는 요청인지 확인
        const isSettingToOne = payload.calendar.every(cal => cal.minStay === 1);

        if (isSettingToOne) {
            // 1단계: 먼저 중간값(3)으로 변경
            const intermediatePayload = {
                roomId: targetRoomId,
                calendar: payload.calendar.map(cal => ({
                    ...cal,
                    minStay: 3  // 중간값
                }))
            };
            console.log(`[setMinStay] 1단계 - 중간값(3)으로 변경: roomId=${targetRoomId}`);
            await beds24PostV2WithRetry("/inventory/rooms/calendar", [intermediatePayload]);

            // 2초 대기
            await new Promise(r => setTimeout(r, 2000));

            // 2단계: 목표값(1)으로 변경
            console.log(`[setMinStay] 2단계 - 목표값(1)으로 변경: roomId=${targetRoomId}`);
            await beds24PostV2WithRetry("/inventory/rooms/calendar", [payload]);

            console.log(`[setMinStay] Beds24 API 호출 완료 (중간값 우회): roomId=${targetRoomId}`);
        } else {
            // 1이 아닌 다른 값으로 바꿀 때는 단일 호출
            console.log(`[setMinStay] API 호출: roomId=${targetRoomId}, dates=${payload.calendar.length}개`);
            await beds24PostV2WithRetry("/inventory/rooms/calendar", [payload]);
            console.log(`[setMinStay] Beds24 API 호출 완료: roomId=${targetRoomId}`);
        }

        // 3. 원자적 캐시 패칭 (price_sync Atomic)
        try {
            const buildingRef = db.collection("price_sync").doc(building);
            const batch = db.batch();
            for (const info of roomInfos) {
                const sRid = String(info.roomId);
                const roomDocRef = buildingRef.collection("rooms").doc(sRid);
                const roomSnap = await roomDocRef.get();
                let roomData = roomSnap.exists ? roomSnap.data() : { roomId: sRid, dates: {} };
                if (!roomData.dates) roomData.dates = {};
                roomData.lastManualUpdate = admin.firestore.FieldValue.serverTimestamp();
                Object.entries(datesToUpdate).forEach(([dKey, values]) => {
                    if (!roomData.dates[dKey]) roomData.dates[dKey] = {};
                    roomData.dates[dKey].m = String(values.m);
                });
                batch.set(roomDocRef, roomData, { merge: true });
            }
            await batch.commit();
            console.log(`[price_sync Patched] ${building} minStay atomic updates committed.`);
        } catch (err) {
            console.error("price_sync Patching Error in setMinStay:", err.message);
        }

        res.json({ success: true, message: `MinStay updated to ${minStayValue} for Room ${targetRoomId}` });

    } catch (e) {
        console.error("setMinStay Error:", e.response?.data || e.message);
        res.status(500).json({ success: false, error: e.response?.data?.error || e.message });
    }
});

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

        const data = req.body;
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

            await db.collection("price_change_logs").add({
                timestamp: new Date(),
                building: building,
                rooms: [roomName],
                success: true,
                worker: "Beds24 시스템",
                origin: "Beds24 (외부 수정)",
                notes: `Beds24에서 객실(${roomName})의 가격 또는 재고 변경이 감지되었습니다.`
            });

            // price_sync 캐시 무효화 (lastSyncTime 초기화로 다음 syncAllPrices 시 새로 읽어옴)
            const priceSyncDoc = db.collection("price_sync").doc(building);
            await priceSyncDoc.set({
                lastSyncTime: null,
                invalidatedAt: admin.firestore.FieldValue.serverTimestamp(),
                invalidatedBy: "priceWebhook (external change)"
            }, { merge: true });
            console.log(`[Cache Invalidated] ${building} price_sync marked for refresh due to external webhook.`);
        }
        res.status(200).send("OK");
    } catch (e) {
        console.error("priceWebhook Error:", e.message);
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
        const { building, roomId, room, arrival, departure, guestName, numAdult, numChild, guestPhone, guestEmail, source, price, comments } = req.body;

        // roomId 필수
        if (!roomId) throw new Error("Missing roomId");

        // building -> propertyId
        const propertyId = getPropertyIdByBuilding(building);
        if (!propertyId) throw new Error(`Invalid building: ${building}`);

        // room 이름 (전달받거나 roomId에서 추출)
        const roomName = room || getRoomNameByRoomId(roomId);

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
            comments: comments || "",
            apiSource: source || "Direct",
            price: parseFloat(price) || 0
            // status 필드 제거 (V2에서 유효하지 않음)
        }];

        console.log(`[createBooking] 예약 생성: ${building} ${roomName} (roomId: ${roomId}, propertyId: ${propertyId})`);

        const response = await beds24PostV2WithRetry("/bookings", payload);

        // V2 응답은 배열 형식
        const result = Array.isArray(response.data) ? response.data[0] : response.data;

        if (result.errors && result.errors.length > 0) {
            throw new Error(result.errors.map(e => e.message).join(", "));
        }

        const newBookingId = result.new?.id || result.id; // V2 응답 구조

        // Firestore에도 저장
        const newBooking = {
            id: String(newBookingId),
            bookId: String(newBookingId),
            building,
            room: roomName,
            roomId: String(roomId),
            guestName: guestName || "Guest",
            arrival: arrival,
            departure: departure,
            status: "confirmed",
            price: parseFloat(price) || 0,
            source: source || "Direct",
            updatedAt: new Date()
        };
        await db.collection("reservations").doc(String(newBookingId)).set(newBooking);

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
        const { bookId, ...updates } = req.body;

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
        if (updates.guestPhone) payload.phone = updates.guestPhone;
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
        await db.collection("reservations").doc(String(bookId)).update({
            ...updates,
            updatedAt: new Date()
        });
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
        const { bookId, reason } = req.body;

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
        await db.collection("reservations").doc(String(bookId)).set({
            status: "cancelled",
            cancelReason: reason || "",
            updatedAt: new Date()
        }, { merge: true });

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
async function createDailySalesLog(date) {
    console.log(`📊 매출 일지 생성 시작: ${date}`);

    // 1. 해당 날짜에 confirmed된 모든 예약 조회
    const reservationsSnap = await db.collection("reservations")
        .where("status", "==", "confirmed")
        .get();

    const allReservations = [];
    reservationsSnap.forEach(doc => allReservations.push(doc.data()));

    // ★ 미래 월별 매출 계산 (1박당 분배 방식 - RevenueDashboard와 동일)
    const futureMonths = {};
    const baseDate = dayjs(date).utcOffset(9);

    // 2. 2026년 1월부터 (기록일 + 6개월)까지 데이터 순회
    // (매일매일 1월~미래6개월까지의 누적/변동 데이터를 기록)
    const startRecord = dayjs("2026-01-01");
    const endRecord = dayjs(date).add(6, 'month');

    let ptr = startRecord;
    while (ptr.isBefore(endRecord) || ptr.isSame(endRecord, 'month')) {
        const targetMonth = ptr.format('YYYY-MM');
        futureMonths[targetMonth] = {
            revenue: 0,           // 1박당 분배 매출
            reservationCount: 0   // 해당 월에 숙박하는 예약 수
        };
        ptr = ptr.add(1, 'month');
    }

    // 각 예약별로 1박당 분배 계산
    allReservations.forEach(reservation => {
        if (!reservation.arrival || !reservation.departure) return;

        const totalPrice = Number(reservation.totalPrice || reservation.price) || 0;
        if (totalPrice <= 0) return;

        // 총 박수 계산
        const arrivalDate = dayjs(reservation.arrival);
        const departureDate = dayjs(reservation.departure);
        const totalNights = departureDate.diff(arrivalDate, 'day');

        if (totalNights <= 0) return;

        // 1박당 금액
        const pricePerNight = totalPrice / totalNights;

        // 각 월별로 분배
        Object.keys(futureMonths).forEach(targetMonth => {
            const monthStart = dayjs(`${targetMonth}-01`);
            const monthEnd = monthStart.add(1, 'month');

            // 예약 기간과 해당 월이 겹치는지 확인
            // departure는 체크아웃 날이므로, 숙박은 arrival ~ departure-1일
            if (departureDate.isAfter(monthStart) && arrivalDate.isBefore(monthEnd)) {
                // 겹치는 구간 계산
                const overlapStart = arrivalDate.isBefore(monthStart) ? monthStart : arrivalDate;
                const lastNight = departureDate.subtract(1, 'day'); // 마지막 숙박일
                const overlapEnd = lastNight.isAfter(monthEnd.subtract(1, 'day'))
                    ? monthEnd.subtract(1, 'day')
                    : lastNight;

                if (overlapStart.isBefore(overlapEnd) || overlapStart.isSame(overlapEnd)) {
                    // 겹치는 박수 (시작일부터 종료일까지 포함)
                    const overlapNights = overlapEnd.diff(overlapStart, 'day') + 1;
                    const overlapRevenue = pricePerNight * overlapNights;

                    futureMonths[targetMonth].revenue += overlapRevenue;

                    // 예약 건수는 해당 월에 숙박하면 1건으로 카운트 (중복 방지를 위해 Set 사용 필요시 추후 수정)
                }
            }
        });

        // 예약 건수 카운트 (해당 월에 숙박하면 1건)
        Object.keys(futureMonths).forEach(targetMonth => {
            const monthStart = dayjs(`${targetMonth}-01`);
            const monthEnd = monthStart.add(1, 'month');

            if (departureDate.isAfter(monthStart) && arrivalDate.isBefore(monthEnd)) {
                futureMonths[targetMonth].reservationCount++;
            }
        });
    });

    // 로그 출력
    Object.entries(futureMonths).forEach(([month, data]) => {
        console.log(`  📅 ${month}: 매출 ¥${Math.round(data.revenue).toLocaleString()}, 예약 ${data.reservationCount}건`);
    });

    // 2. 체크인 매출 계산 (arrival === date)
    const checkinReservations = allReservations.filter(r => r.arrival === date);
    const checkinRevenue = checkinReservations.reduce((sum, r) => sum + (r.totalPrice || r.price || 0), 0);

    // 3. 예약 접수 매출 계산 (bookDate === date)
    const bookingReservations = allReservations.filter(r => r.bookDate === date);
    const bookingRevenue = bookingReservations.reduce((sum, r) => sum + (r.totalPrice || r.price || 0), 0);

    // 4. 신규 예약 상세 (bookDate === date) - 일일 보고서용
    // ★ 중복 제거 강화 (bookId 우선, 없으면 apiReference, 마지막으로 guestName+arrival+building)
    const uniqueBookings = new Map();
    bookingReservations.forEach(r => {
        // bookId가 가장 신뢰할 수 있는 키
        let key = r.bookId;

        // bookId가 없거나 유효하지 않으면 apiReference 사용
        if (!key || key === 'undefined' || key === 'null') {
            key = r.apiReference;
        }

        // 그래도 없으면 조합 키 사용 (같은 게스트가 같은 날 같은 건물에 예약하면 동일 건으로 처리)
        if (!key || key === 'undefined' || key === 'null') {
            key = `${(r.guestName || '').trim()}_${r.arrival}_${r.building}`;
        }

        if (key && !uniqueBookings.has(key)) {
            uniqueBookings.set(key, r);
        }
    });
    const newBookingsList = Array.from(uniqueBookings.values());
    const newBookings = newBookingsList.length;

    console.log(`📋 신규예약 중복제거: 원본 ${bookingReservations.length}건 → 최종 ${newBookings}건`);

    // 플랫폼별 집계 (예약)
    const bookingByPlatform = { Airbnb: 0, Booking: 0 };
    newBookingsList.forEach(r => {
        const platform = (r.platform || "").toLowerCase();
        if (platform.includes("booking")) {
            bookingByPlatform.Booking++;
        } else {
            bookingByPlatform.Airbnb++;
        }
    });

    // 월별 집계 (예약) - stayMonth 기준
    const bookingByMonth = {};
    newBookingsList.forEach(r => {
        const month = r.stayMonth || (r.arrival ? r.arrival.slice(0, 7) : null);
        if (month) {
            bookingByMonth[month] = (bookingByMonth[month] || 0) + 1;
        }
    });

    // 5. 취소 상세 (cancelTime이 해당 날짜로 시작) - 일일 보고서용
    const cancelledSnap = await db.collection("reservations")
        .where("status", "==", "cancelled")
        .get();

    const cancelDocs = [];
    cancelledSnap.forEach(doc => {
        const data = doc.data();
        if (data.cancelTime && data.cancelTime.slice(0, 10) === date) {
            cancelDocs.push(data);
        }
    });

    // 중복 제거 (bookId 기준)
    const uniqueCancels = new Map();
    cancelDocs.forEach(r => {
        const key = r.bookId || r.refNum || `${r.guestName}_${r.arrival}`;
        if (!uniqueCancels.has(key)) {
            uniqueCancels.set(key, r);
        }
    });
    const cancelList = Array.from(uniqueCancels.values());
    const cancellations = cancelList.length;

    // 플랫폼별 집계 (취소)
    const cancelByPlatform = { Airbnb: 0, Booking: 0 };
    cancelList.forEach(r => {
        const platform = (r.platform || "").toLowerCase();
        if (platform.includes("booking")) {
            cancelByPlatform.Booking++;
        } else {
            cancelByPlatform.Airbnb++;
        }
    });

    // 월별 집계 (취소)
    const cancelByMonth = {};
    cancelList.forEach(r => {
        const month = r.stayMonth || (r.arrival ? r.arrival.slice(0, 7) : null);
        if (month) {
            cancelByMonth[month] = (cancelByMonth[month] || 0) + 1;
        }
    });

    console.log(`📋 일일보고서 - 예약: ${newBookings}건 (에어${bookingByPlatform.Airbnb}/부킹${bookingByPlatform.Booking}), 취소: ${cancellations}건 (에어${cancelByPlatform.Airbnb}/부킹${cancelByPlatform.Booking})`);

    // 6. 체크인/체크아웃 수
    const checkins = checkinReservations.length;
    const checkouts = allReservations.filter(r => r.departure === date).length;

    // 7. 가동률 계산 (사노시 제외)
    // 해당 날짜에 점유 중인 객실 수 / 전체 객실 수
    let occupiedRooms = 0;
    let totalRooms = 0;

    // 건물별 상세 데이터
    const buildings = {};

    Object.entries(BUILDING_ROOMS).forEach(([building, rooms]) => {
        if (building === "사노시") return; // 사노시 제외

        const buildingRooms = {};
        let buildingRevenue = 0;
        let buildingOccupied = 0;
        let buildingCheckins = 0;
        let buildingCheckouts = 0;

        rooms.forEach(room => {
            const roomName = room.name;
            totalRooms++;

            // 해당 날짜에 이 객실이 점유되어 있는지 확인
            // arrival <= date < departure (departure는 체크아웃 날이므로 제외)
            const isOccupied = allReservations.some(r =>
                r.building === building &&
                r.room === roomName &&
                r.arrival <= date &&
                r.departure > date
            );

            if (isOccupied) {
                occupiedRooms++;
                buildingOccupied++;
            }

            // 해당 객실의 체크인 매출
            const roomCheckins = checkinReservations.filter(r =>
                r.building === building && r.room === roomName
            );
            const roomRevenue = roomCheckins.reduce((sum, r) => sum + (r.totalPrice || r.price || 0), 0);
            buildingRevenue += roomRevenue;

            // 체크인/체크아웃 카운트
            const roomCheckinCount = roomCheckins.length;
            const roomCheckoutCount = allReservations.filter(r =>
                r.building === building && r.room === roomName && r.departure === date
            ).length;
            buildingCheckins += roomCheckinCount;
            buildingCheckouts += roomCheckoutCount;

            buildingRooms[roomName] = {
                revenue: roomRevenue,
                occupied: isOccupied,
                checkin: roomCheckinCount > 0,
                checkout: roomCheckoutCount > 0
            };
        });

        const buildingOccupancy = rooms.length > 0 ? (buildingOccupied / rooms.length * 100) : 0;

        buildings[building] = {
            revenue: buildingRevenue,
            occupancy: parseFloat(buildingOccupancy.toFixed(1)),
            checkins: buildingCheckins,
            checkouts: buildingCheckouts,
            occupiedRooms: buildingOccupied,
            totalRooms: rooms.length,
            rooms: buildingRooms
        };
    });

    const occupancyRate = totalRooms > 0 ? (occupiedRooms / totalRooms * 100) : 0;

    // 8. 문서 저장
    const salesLogData = {
        date: date,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        isAutoGenerated: true,

        summary: {
            checkinRevenue: checkinRevenue,
            bookingRevenue: bookingRevenue,
            totalReservations: allReservations.length,
            newBookings: newBookings,
            cancellations: cancellations,
            checkins: checkins,
            checkouts: checkouts,
            occupancyRate: parseFloat(occupancyRate.toFixed(1)),
            occupiedRooms: occupiedRooms,
            totalRooms: totalRooms
        },

        // ★ 미래 월별 매출 (구글 스프레드시트 대체)
        futureMonths: futureMonths,

        // ★ 일일 보고서 데이터 (아침 보고용)
        dailyReport: {
            bookings: {
                total: newBookings,
                byPlatform: bookingByPlatform,
                byMonth: bookingByMonth
            },
            cancellations: {
                total: cancellations,
                byPlatform: cancelByPlatform,
                byMonth: cancelByMonth
            }
        },

        buildings: buildings,
        memo: ""
    };

    // 기존 문서가 있으면 메모 유지
    const existingDoc = await db.collection("dailySalesLog").doc(date).get();
    if (existingDoc.exists) {
        const existingData = existingDoc.data();
        salesLogData.memo = existingData.memo || "";
        salesLogData.createdAt = existingData.createdAt; // 최초 생성 시간 유지
    }

    await db.collection("dailySalesLog").doc(date).set(salesLogData);

    const totalFutureRevenue = Object.values(futureMonths).reduce((sum, m) => sum + m.revenue, 0);
    console.log(`✅ 매출 일지 저장 완료: ${date} (당일체크인: ¥${checkinRevenue}, 미래총합: ¥${totalFutureRevenue.toLocaleString()})`);
    return salesLogData;
}

// 매일 자정 (도쿄 시간) 자동 스냅샷
exports.dailySalesSnapshot = onSchedule({
    schedule: "0 0 * * *",
    timeZone: "Asia/Tokyo",
    memory: "512MiB"
}, async () => {
    // 어제 날짜 기준 (자정에 실행되므로 어제 데이터 확정)
    const yesterday = dayjs().utcOffset(9).subtract(1, 'day').format('YYYY-MM-DD');
    console.log(`🕐 자동 매출 스냅샷 실행: ${yesterday}`);
    await createDailySalesLog(yesterday);
});

// 수동 저장 API
exports.saveSalesLogManual = onRequest({ cors: true, timeoutSeconds: 120, memory: "512MiB" }, async (req, res) => {
    try {
        const { date } = req.body;

        // 날짜가 없으면 오늘 날짜 (도쿄 시간)
        const targetDate = date || dayjs().utcOffset(9).format('YYYY-MM-DD');

        console.log(`📝 수동 매출 저장 요청: ${targetDate}`);
        const result = await createDailySalesLog(targetDate);

        // 수동 저장인 경우 플래그 업데이트
        await db.collection("dailySalesLog").doc(targetDate).update({
            isAutoGenerated: false,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

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
exports.manualPriceSync = onRequest({ cors: true, timeoutSeconds: 540 }, async (req, res) => {
    try {
        console.log("수동 가격 동기화 시작...");
        const result = await syncAllPrices();
        res.json({ success: true, result });
    } catch (e) {
        console.error("Manual Sync Error:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

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

        // ★ Exclude Daikyocho (다이쿄초) - 예약일(bookDate) 기준
        // 2026-01-25까지 예약한 건 체크인 날짜 상관없이 우리 매출
        // 2026-01-26 이후 예약한 건 제외 (매각 후 다른 업체)
        const DAIKYO_SOLD_DATE = "2026-01-26";
        const bookDate = data.bookDate || data.arrival;  // 예약일 우선, 없으면 체크인일
        if (data.building === "다이쿄초" && bookDate >= DAIKYO_SOLD_DATE) return;

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
        monthlyStats: stats
    });

    console.log(`[SalesLog] ${targetDateStr} 저장 완료.`, stats);
    return stats;
}

// 스케줄러: 매일 자정 (일본 시간)
exports.dailySalesSnapshot = onSchedule({
    schedule: "0 0 * * *", // 매일 00:00
    timeZone: "Asia/Tokyo",
    timeoutSeconds: 540,
    memory: "512MiB"
}, async (event) => {
    const today = dayjs().tz("Asia/Tokyo").format("YYYY-MM-DD");
    await createDailySalesLog(today);
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