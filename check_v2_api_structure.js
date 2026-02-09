const axios = require('axios');

const REFRESH_TOKEN = "f9dBEWviugAGMcPCPMoRIOG7OpguLo187eDqsuhzaFKNrPdkISHOBZtZaYHGHc2Kc5uEaVljPfPq/xVbzPn0bkXrj2gf6Ly96bpHrsm9X9XwC4U/CAA/QPK9EgbVbQOEAj5iYME1EobhelKpStKYg1OK7zruxGOehEykt7yT5Mw=";

async function getAccessToken() {
    const response = await axios.get('https://beds24.com/api/v2/authentication/token', {
        headers: { refreshToken: REFRESH_TOKEN }
    });
    return response.data.token;
}

async function checkAllEndpoints() {
    console.log('\n========================================');
    console.log('Beds24 V2 API 전체 필드 구조 확인');
    console.log('========================================\n');

    try {
        const token = await getAccessToken();
        console.log('✅ 토큰 발급 성공\n');

        // 1. GET /bookings - 예약 조회 필드 구조
        console.log('=== 1. GET /bookings (예약 조회) ===');
        try {
            const bookingsRes = await axios.get('https://beds24.com/api/v2/bookings', {
                headers: { token },
                params: {
                    propertyId: 176430, // 아라키초A
                    arrivalFrom: '2026-01-01',
                    arrivalTo: '2026-02-28',
                    limit: 1
                }
            });
            const booking = bookingsRes.data?.data?.[0];
            if (booking) {
                console.log('예약 필드 목록:', Object.keys(booking).sort());
                console.log('\n샘플 데이터:');
                console.log(JSON.stringify(booking, null, 2));
            } else {
                console.log('예약 데이터 없음');
            }
        } catch (e) {
            console.log('에러:', e.response?.data || e.message);
        }

        // 잠시 대기 (Rate Limit 방지)
        await new Promise(r => setTimeout(r, 2000));

        // 2. GET /inventory/rooms - 객실 정보
        console.log('\n=== 2. GET /inventory/rooms (객실 정보) ===');
        try {
            const roomsRes = await axios.get('https://beds24.com/api/v2/inventory/rooms', {
                headers: { token },
                params: {
                    propertyId: 176430,
                    limit: 1
                }
            });
            const room = roomsRes.data?.data?.[0];
            if (room) {
                console.log('객실 필드 목록:', Object.keys(room).sort());
                console.log('\n샘플 데이터:');
                console.log(JSON.stringify(room, null, 2));
            }
        } catch (e) {
            console.log('에러:', e.response?.data || e.message);
        }

        await new Promise(r => setTimeout(r, 2000));

        // 3. GET /inventory/rooms/calendar - 캘린더/가격 필드
        console.log('\n=== 3. GET /inventory/rooms/calendar (캘린더/가격) ===');
        try {
            const calRes = await axios.get('https://beds24.com/api/v2/inventory/rooms/calendar', {
                headers: { token },
                params: {
                    roomId: 383971,
                    startDate: '2026-01-23',
                    endDate: '2026-01-25',
                    includePrices: true,
                    includeMinStay: true,
                    includeMaxStay: true
                }
            });
            const calData = calRes.data?.data?.[0];
            const calEntry = calData?.calendar?.[0];
            if (calEntry) {
                console.log('캘린더 필드 목록:', Object.keys(calEntry).sort());
                console.log('\n샘플 데이터:');
                console.log(JSON.stringify(calEntry, null, 2));
            }
        } catch (e) {
            console.log('에러:', e.response?.data || e.message);
        }

        await new Promise(r => setTimeout(r, 2000));

        // 4. GET /properties - 숙소 정보
        console.log('\n=== 4. GET /properties (숙소 정보) ===');
        try {
            const propRes = await axios.get('https://beds24.com/api/v2/properties', {
                headers: { token },
                params: { limit: 1 }
            });
            const prop = propRes.data?.data?.[0];
            if (prop) {
                console.log('숙소 필드 목록:', Object.keys(prop).sort());
                console.log('\n샘플 데이터 (일부):');
                console.log(JSON.stringify({
                    id: prop.id,
                    name: prop.name,
                    address: prop.address,
                    city: prop.city,
                    country: prop.country
                }, null, 2));
            }
        } catch (e) {
            console.log('에러:', e.response?.data || e.message);
        }

        // 5. POST /bookings 필드 확인 (Beds24 V2 문서 기준)
        console.log('\n=== 5. POST /bookings (예약 생성) 필수/선택 필드 ===');
        console.log(`
필수 필드:
- propertyId: 숙소 ID (정수)
- roomId: 객실 ID (정수)
- arrival: 체크인 날짜 (YYYY-MM-DD)
- departure: 체크아웃 날짜 (YYYY-MM-DD)

선택 필드:
- firstName: 예약자 이름
- lastName: 예약자 성
- email: 이메일
- phone: 전화번호
- numAdult: 성인 수 (정수)
- numChild: 어린이 수 (정수)
- price: 총 금액 (숫자)
- status: 예약 상태 (1=confirmed, 0=cancelled)
- comments: 메모/코멘트
- apiSource: 예약 출처
`);

        // 6. POST /inventory/rooms/calendar 필드 확인
        console.log('\n=== 6. POST /inventory/rooms/calendar (가격 설정) 필드 ===');
        console.log(`
형식: [{ roomId: 123, calendar: [{ from, to, ...fields }] }]

캘린더 항목 필드:
- from: 시작일 (YYYY-MM-DD) [필수]
- to: 종료일 (YYYY-MM-DD) [필수]
- price1: 기본 가격 (숫자 또는 null)
- price2: 가격2 (숫자 또는 null)
- price3: 가격3 (숫자 또는 null)
- price4: 가격4 (숫자 또는 null)
- minStay: 최소 숙박일 (정수)
- maxStay: 최대 숙박일 (정수)
`);

        console.log('\n========================================');
        console.log('완료!');
        console.log('========================================');

    } catch (error) {
        console.error('에러:', error.response?.data || error.message);
    }
}

checkAllEndpoints();
