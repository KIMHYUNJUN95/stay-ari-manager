const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkAllRooms() {
  console.log('모든 건물의 room 필드 확인 중...\n');

  const snapshot = await db.collection('reservations')
    .where('companyId', '==', 'dGxlQyu47LbplLVCVXiV')
    .where('status', '==', 'confirmed')
    .get();

  const roomsByBuilding = {};
  const weirdRooms = [];

  snapshot.forEach(doc => {
    const data = doc.data();
    const building = data.building || 'UNKNOWN';
    const room = data.room || 'NULL';

    if (!roomsByBuilding[building]) {
      roomsByBuilding[building] = new Set();
    }
    roomsByBuilding[building].add(room);

    // 이상한 값 찾기 (Room, room, 괄호, 숫자만 있는 6자리)
    if (
      room.includes('Room') ||
      room.includes('room') ||
      room.includes('(') ||
      /^\d{6,}$/.test(room)
    ) {
      weirdRooms.push({
        building: building,
        room: room,
        id: doc.id
      });
    }
  });

  console.log('건물별 room 개수:');
  Object.keys(roomsByBuilding).sort().forEach(building => {
    console.log('  ' + building + ': ' + roomsByBuilding[building].size + '개');
  });

  console.log('\n⚠️  이상한 room 값들:');
  if (weirdRooms.length > 0) {
    weirdRooms.forEach(item => {
      console.log('  건물: ' + item.building + ', room: "' + item.room + '", ID: ' + item.id);
    });
  } else {
    console.log('✅ 이상한 값 없음');
  }

  console.log('\n각 건물별 room 값들:');
  Object.keys(roomsByBuilding).sort().forEach(building => {
    console.log('\n[' + building + ']');
    const rooms = Array.from(roomsByBuilding[building]).sort();
    rooms.forEach(room => {
      console.log('  "' + room + '"');
    });
  });

  process.exit(0);
}

checkAllRooms().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
