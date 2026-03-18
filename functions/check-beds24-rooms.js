const admin = require('firebase-admin');
const axios = require('axios');

admin.initializeApp();
const db = admin.firestore();

const BEDS24_REFRESH_TOKEN = "f9dBEWviugAGMcPCPMoRIOG7OpguLo187eDqsuhzaFKNrPdkISHOBZtZaYHGHc2Kc5uEaVljPfPq/xVbzPn0bkXrj2gf6Ly96bpHrsm9X9XwC4U/CAA/QPK9EgbVbQOEAj5iYME1EobhelKpStKYg1OK7zruxGOehEykt7yT5Mw=";

async function getBeds24Token() {
  try {
    const response = await axios.get("https://beds24.com/api/v2/authentication/token", {
      headers: { refreshToken: BEDS24_REFRESH_TOKEN }
    });
    return response.data.token;
  } catch (error) {
    console.error("토큰 발급 실패:", error.message);
    throw error;
  }
}

async function checkRooms() {
  console.log('Beds24에서 방 정보 조회 중...\n');

  const token = await getBeds24Token();

  // 모든 방 정보 조회
  const response = await axios.get("https://beds24.com/api/v2/inventory/rooms", {
    headers: { token }
  });

  const rooms = response.data.data;

  console.log('전체 방 개수:', rooms.length);
  console.log('\n648398, 648399 찾기:\n');

  const target1 = rooms.find(r => r.id === 648398);
  const target2 = rooms.find(r => r.id === 649399);

  if (target1) {
    console.log('✅ roomId 648398 찾음:');
    console.log('   이름:', target1.name);
    console.log('   propertyId:', target1.propertyId);
    console.log('   전체 정보:', JSON.stringify(target1, null, 2));
  } else {
    console.log('❌ roomId 648398 없음');
  }

  console.log('');

  if (target2) {
    console.log('✅ roomId 648399 찾음:');
    console.log('   이름:', target2.name);
    console.log('   propertyId:', target2.propertyId);
    console.log('   전체 정보:', JSON.stringify(target2, null, 2));
  } else {
    console.log('❌ roomId 648399 없음');
  }

  // 가부키초와 오쿠보C동 관련 방들 출력
  console.log('\n\n모든 방 목록 (propertyId별):');
  const byProperty = {};
  rooms.forEach(r => {
    if (!byProperty[r.propertyId]) {
      byProperty[r.propertyId] = [];
    }
    byProperty[r.propertyId].push(r);
  });

  Object.keys(byProperty).forEach(propId => {
    console.log('\npropertyId ' + propId + ':');
    byProperty[propId].forEach(r => {
      console.log('  roomId ' + r.id + ': ' + r.name);
    });
  });

  process.exit(0);
}

checkRooms().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
