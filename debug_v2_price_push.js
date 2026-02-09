const axios = require('axios');

const REFRESH_TOKEN = "f9dBEWviugAGMcPCPMoRIOG7OpguLo187eDqsuhzaFKNrPdkISHOBZtZaYHGHc2Kc5uEaVljPfPq/xVbzPn0bkXrj2gf6Ly96bpHrsm9X9XwC4U/CAA/QPK9EgbVbQOEAj5iYME1EobhelKpStKYg1OK7zruxGOehEykt7yT5Mw=";
const ROOM_ID = 383971; // 아라키초A 201호
const TEST_PRICE = 99999; // 테스트용 가격

async function getAccessToken() {
    const response = await axios.get('https://beds24.com/api/v2/authentication/token', {
        headers: { refreshToken: REFRESH_TOKEN }
    });
    return response.data.token;
}

async function debugPricePush() {
    console.log('\n========================================');
    console.log('V2 가격 푸시 디버깅');
    console.log('========================================\n');

    const today = new Date().toISOString().split('T')[0];
    
    try {
        const token = await getAccessToken();
        console.log('✅ 토큰 발급 성공\n');

        // 1. 현재 가격 확인 (변경 전)
        console.log('=== 1. 현재 가격 확인 (변경 전) ===');
        const beforeRes = await axios.get('https://beds24.com/api/v2/inventory/rooms/calendar', {
            headers: { token },
            params: {
                roomId: ROOM_ID,
                startDate: today,
                endDate: today,
                includePrices: true
            }
        });
        const beforeData = beforeRes.data?.data?.[0]?.calendar?.[0];
        console.log('변경 전 데이터:', JSON.stringify(beforeData, null, 2));
        console.log(`변경 전 price1: ${beforeData?.price1}`);

        await new Promise(r => setTimeout(r, 2000));

        // 2. 가격 변경 시도 (V2 POST)
        console.log('\n=== 2. 가격 변경 시도 ===');
        const payload = [{
            roomId: ROOM_ID,
            calendar: [{
                from: today,
                to: today,
                price1: TEST_PRICE
            }]
        }];
        console.log('POST payload:', JSON.stringify(payload, null, 2));

        const postRes = await axios.post('https://beds24.com/api/v2/inventory/rooms/calendar', payload, {
            headers: { 
                token,
                'Content-Type': 'application/json'
            }
        });
        console.log('POST 응답:', JSON.stringify(postRes.data, null, 2));
        console.log('POST 상태 코드:', postRes.status);

        await new Promise(r => setTimeout(r, 3000));

        // 3. 변경 후 가격 확인
        console.log('\n=== 3. 변경 후 가격 확인 ===');
        const afterRes = await axios.get('https://beds24.com/api/v2/inventory/rooms/calendar', {
            headers: { token },
            params: {
                roomId: ROOM_ID,
                startDate: today,
                endDate: today,
                includePrices: true
            }
        });
        const afterData = afterRes.data?.data?.[0]?.calendar?.[0];
        console.log('변경 후 데이터:', JSON.stringify(afterData, null, 2));
        console.log(`변경 후 price1: ${afterData?.price1}`);

        // 4. 결과 분석
        console.log('\n=== 4. 결과 분석 ===');
        if (afterData?.price1 === TEST_PRICE) {
            console.log('✅ 가격 변경 성공!');
        } else {
            console.log('❌ 가격 변경 실패!');
            console.log(`  기대값: ${TEST_PRICE}`);
            console.log(`  실제값: ${afterData?.price1}`);
            
            // 가능한 원인 분석
            console.log('\n=== 가능한 원인 ===');
            if (beforeData?.minStay >= 50) {
                console.log('⚠️ minStay가 50 이상 - 비활성화된 방일 수 있음');
            }
            console.log('⚠️ V2 API는 Override 방식이 아닐 수 있음');
            console.log('⚠️ Rate Plan/Daily Rate 설정 확인 필요');
        }

        // 5. 원래 가격으로 복원
        console.log('\n=== 5. 원래 가격으로 복원 ===');
        if (beforeData?.price1) {
            await new Promise(r => setTimeout(r, 2000));
            const restorePayload = [{
                roomId: ROOM_ID,
                calendar: [{
                    from: today,
                    to: today,
                    price1: beforeData.price1
                }]
            }];
            const restoreRes = await axios.post('https://beds24.com/api/v2/inventory/rooms/calendar', restorePayload, {
                headers: { token, 'Content-Type': 'application/json' }
            });
            console.log('복원 응답:', JSON.stringify(restoreRes.data, null, 2));
        }

    } catch (error) {
        console.error('\n❌ 에러 발생:');
        console.error('메시지:', error.message);
        console.error('응답:', error.response?.data);
        console.error('상태:', error.response?.status);
    }
}

debugPricePush();
