const axios = require('axios');

const REFRESH_TOKEN = "f9dBEWviugAGMcPCPMoRIOG7OpguLo187eDqsuhzaFKNrPdkISHOBZtZaYHGHc2Kc5uEaVljPfPq/xVbzPn0bkXrj2gf6Ly96bpHrsm9X9XwC4U/CAA/QPK9EgbVbQOEAj5iYME1EobhelKpStKYg1OK7zruxGOehEykt7yT5Mw=";
const ROOM_ID = 383971;

async function getAccessToken() {
    const response = await axios.get('https://beds24.com/api/v2/authentication/token', {
        headers: { refreshToken: REFRESH_TOKEN }
    });
    return response.data.token;
}

async function getV2Fields() {
    const today = new Date().toISOString().split('T')[0];
    const endDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    console.log(`\n=== Beds24 V2 API 필드 구조 확인 ===\n`);
    console.log(`roomId: ${ROOM_ID}`);
    console.log(`날짜: ${today} ~ ${endDate}\n`);
    
    try {
        const token = await getAccessToken();
        console.log('토큰 발급 성공!\n');
        
        const response = await axios.get('https://beds24.com/api/v2/inventory/rooms/calendar', {
            headers: { token: token },
            params: {
                roomId: ROOM_ID,
                startDate: today,
                endDate: endDate,
                includePrices: true,
                includeLinkedPrices: true,
                includeMinStay: true,
                includeMaxStay: true
            }
        });
        
        const data = response.data;
        const roomData = data.data?.[0];
        const calendarEntry = roomData?.calendar?.[0];
        
        console.log('=== 전체 응답 구조 ===');
        console.log(JSON.stringify(data, null, 2));
        
        console.log('\n=== calendar[0] 필드 목록 ===');
        if (calendarEntry) {
            const allFields = Object.keys(calendarEntry).sort();
            console.log('모든 필드:', allFields);
            
            const priceFields = allFields.filter(k => k.toLowerCase().includes('price'));
            console.log('\n가격 관련 필드:', priceFields);
            
            console.log('\n=== 각 필드 값 ===');
            for (const field of allFields) {
                console.log(`  ${field}: ${JSON.stringify(calendarEntry[field])}`);
            }
        }
        
    } catch (error) {
        console.error('에러:', error.response?.data || error.message);
    }
}

getV2Fields();
