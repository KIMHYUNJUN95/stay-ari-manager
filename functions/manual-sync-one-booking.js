/**
 * 단일 예약 메시지 동기화 테스트
 */

const axios = require('axios');
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

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

async function syncOneBooking() {
    try {
        console.log('=== 단일 예약 메시지 동기화 테스트 ===\n');

        // 1. Firestore에서 첫 번째 confirmed 예약 가져오기
        const reservationSnap = await db.collection("reservations")
            .where("status", "==", "confirmed")
            .limit(1)
            .get();

        if (reservationSnap.empty) {
            console.log('❌ confirmed 예약이 없습니다.');
            return;
        }

        const reservation = reservationSnap.docs[0].data();
        const bookingId = reservation.bookId;

        console.log('📋 테스트 예약:');
        console.log(`   - Booking ID: ${bookingId}`);
        console.log(`   - Guest: ${reservation.guestName}`);
        console.log(`   - Dates: ${reservation.arrival} ~ ${reservation.departure}`);
        console.log(`   - Platform: ${reservation.platform}\n`);

        // 2. Beds24에서 메시지 조회
        const token = await getBeds24Token();
        console.log('✅ Token 발급 성공\n');

        console.log('📬 메시지 조회 중...');
        const response = await axios.get(
            'https://beds24.com/api/v2/bookings/messages',
            {
                headers: {
                    "accept": "application/json",
                    "token": token
                },
                params: {
                    bookingId: bookingId
                }
            }
        );

        const messages = response.data.data || [];
        console.log(`✅ 메시지 ${messages.length}개 조회 완료\n`);

        if (messages.length === 0) {
            console.log('ℹ️ 이 예약에는 메시지가 없습니다.');
            return;
        }

        // 3. 메시지 포맷 변환
        const formattedMessages = messages.map(msg => ({
            text: msg.message || msg.text || '',
            from: msg.source === 'guest' ? 'guest' : 'host',
            time: msg.time || msg.createdAt || new Date().toISOString(),
            senderName: msg.senderName || (msg.source === 'host' ? 'Staff' : 'Guest'),
            messageId: msg.id || null,
            read: msg.read !== false
        }));

        formattedMessages.sort((a, b) => new Date(a.time) - new Date(b.time));

        console.log('=== 메시지 샘플 (최대 3개) ===');
        formattedMessages.slice(0, 3).forEach((msg, idx) => {
            console.log(`\n${idx + 1}. [${msg.from}] ${msg.time}`);
            console.log(`   ${msg.text.substring(0, 100)}${msg.text.length > 100 ? '...' : ''}`);
        });

        const lastMessage = formattedMessages[formattedMessages.length - 1];
        const hasUnread = messages.some(msg => msg.source === 'guest' && msg.read === false);

        // 4. Firestore에 저장
        const docId = `${reservation.companyId}_${bookingId}`;
        console.log(`\n\n💾 Firestore 저장 중... (Doc ID: ${docId})`);

        await db.collection("booking_messages").doc(docId).set({
            companyId: reservation.companyId,
            bookingId: bookingId,
            guestName: reservation.guestName,
            guestCountry: reservation.guestCountry || reservation.guestCountry2 || '',
            building: reservation.building,
            room: reservation.room,
            arrival: reservation.arrival,
            departure: reservation.departure,
            platform: reservation.platform,
            messages: formattedMessages,
            messageCount: formattedMessages.length,
            lastMessage: lastMessage ? lastMessage.text : '',
            lastMessageTime: lastMessage ? lastMessage.time : null,
            lastMessageFrom: lastMessage ? lastMessage.from : null,
            hasUnread: hasUnread,
            lastSyncTime: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log('✅ Firestore 저장 완료!\n');
        console.log('=== 요약 ===');
        console.log(`메시지 개수: ${formattedMessages.length}`);
        console.log(`읽지 않은 메시지: ${hasUnread ? 'YES' : 'NO'}`);
        console.log(`마지막 메시지: ${lastMessage.from} - ${lastMessage.time}`);

        console.log('\n\n🎉 성공! UI를 새로고침하면 메시지가 보일 것입니다.');

    } catch (error) {
        console.error('\n❌ 에러:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', error.response.data);
        }
        console.error('Stack:', error.stack);
    } finally {
        process.exit();
    }
}

syncOneBooking();
