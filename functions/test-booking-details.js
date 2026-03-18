/**
 * 예약 상세 정보 확인 - 메시지 필드가 있는지 확인
 */

const axios = require('axios');

const BEDS24_REFRESH_TOKEN = "f9dBEWviugAGMcPCPMoRIOG7OpguLo187eDqsuhzaFKNrPdkISHOBZtZaYHGHc2Kc5uEaVljPfPq/xVbzPn0bkXrj2gf6Ly96bpHrsm9X9XwC4U/CAA/QPK9EgbVbQOEAj5iYME1EobhelKpStKYg1OK7zruxGOehEykt7yT5Mw=";

async function getBeds24Token() {
    const response = await axios.get(
        'https://beds24.com/api/v2/authentication/token',
        {
            headers: {
                'accept': 'application/json',
                'refreshToken': BEDS24_REFRESH_TOKEN
            }
        }
    );
    return response.data.token;
}

async function testBookingDetails() {
    console.log('\n========================================');
    console.log('📋 예약 상세 정보 확인');
    console.log('========================================\n');

    try {
        const token = await getBeds24Token();
        console.log('✅ Token 발급 성공\n');

        // 최근 예약 조회
        const bookingsResponse = await axios.get(
            'https://beds24.com/api/v2/bookings',
            {
                headers: {
                    'accept': 'application/json',
                    'token': token
                },
                params: {
                    arrivalFrom: '2026-02-01',
                    arrivalTo: '2026-02-15'
                }
            }
        );

        const bookings = bookingsResponse.data.data || [];

        // Airbnb 예약 찾기 (메시지가 있을 가능성이 높음)
        const airbnbBooking = bookings.find(b =>
            b.channel && b.channel.toLowerCase().includes('airbnb')
        );

        if (!airbnbBooking) {
            console.log('⚠️ Airbnb 예약을 찾을 수 없습니다.');
            return;
        }

        console.log(`🔍 Airbnb 예약 발견: ID ${airbnbBooking.id}`);
        console.log(`   게스트: ${airbnbBooking.firstName} ${airbnbBooking.lastName}`);
        console.log(`   날짜: ${airbnbBooking.arrival} ~ ${airbnbBooking.departure}\n`);

        // 상세 정보 조회
        console.log('📊 예약 상세 정보 조회 중...\n');
        const detailResponse = await axios.get(
            `https://beds24.com/api/v2/bookings/${airbnbBooking.id}`,
            {
                headers: {
                    'accept': 'application/json',
                    'token': token
                }
            }
        );

        const booking = detailResponse.data.data || detailResponse.data;

        console.log('=== 메시지 관련 필드 ===');
        console.log('message:', booking.message || '(없음)');
        console.log('notes:', booking.notes || '(없음)');
        console.log('comments:', booking.comments || '(없음)');
        console.log('groupNote:', booking.groupNote || '(없음)');
        console.log('apiMessage:', booking.apiMessage || '(없음)');
        console.log('\n=== 모든 필드 목록 ===');
        console.log(Object.keys(booking).sort());

        console.log('\n=== 전체 예약 데이터 (일부) ===');
        console.log(JSON.stringify({
            id: booking.id,
            firstName: booking.firstName,
            lastName: booking.lastName,
            channel: booking.channel,
            apiSource: booking.apiSource,
            message: booking.message,
            notes: booking.notes,
            comments: booking.comments,
            apiMessage: booking.apiMessage
        }, null, 2));

        // 다른 API 엔드포인트 시도
        console.log('\n\n=== 다른 메시지 엔드포인트 테스트 ===\n');

        // 1. /bookings/{id}/messages (이미 실패한 것)
        console.log('1. GET /bookings/{id}/messages');
        try {
            const msgResponse = await axios.get(
                `https://beds24.com/api/v2/bookings/${airbnbBooking.id}/messages`,
                {
                    headers: {
                        'accept': 'application/json',
                        'token': token
                    }
                }
            );
            console.log('   ✅ 성공!');
            console.log('   응답:', JSON.stringify(msgResponse.data, null, 2));
        } catch (e) {
            console.log(`   ❌ 실패: ${e.response?.status} - ${e.response?.data?.error || e.message}`);
        }

        // 2. /messages?bookingId={id}
        console.log('\n2. GET /messages?bookingId={id}');
        try {
            const msgResponse = await axios.get(
                'https://beds24.com/api/v2/messages',
                {
                    headers: {
                        'accept': 'application/json',
                        'token': token
                    },
                    params: {
                        bookingId: airbnbBooking.id
                    }
                }
            );
            console.log('   ✅ 성공!');
            console.log('   응답:', JSON.stringify(msgResponse.data, null, 2));
        } catch (e) {
            console.log(`   ❌ 실패: ${e.response?.status} - ${e.response?.data?.error || e.message}`);
        }

        // 3. /communications?bookingId={id}
        console.log('\n3. GET /communications?bookingId={id}');
        try {
            const msgResponse = await axios.get(
                'https://beds24.com/api/v2/communications',
                {
                    headers: {
                        'accept': 'application/json',
                        'token': token
                    },
                    params: {
                        bookingId: airbnbBooking.id
                    }
                }
            );
            console.log('   ✅ 성공!');
            console.log('   응답:', JSON.stringify(msgResponse.data, null, 2));
        } catch (e) {
            console.log(`   ❌ 실패: ${e.response?.status} - ${e.response?.data?.error || e.message}`);
        }

    } catch (error) {
        console.error('\n❌ 에러:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Response:', JSON.stringify(error.response.data, null, 2));
        }
    }

    console.log('\n========================================');
    console.log('완료');
    console.log('========================================\n');
}

testBookingDetails();
