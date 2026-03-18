const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkKabukichoRooms() {
  console.log('가부키초 건물의 room 필드 확인 중...\n');

  const snapshot = await db.collection('reservations')
    .where('companyId', '==', 'dGxlQyu47LbplLVCVXiV')
    .where('building', '==', '가부키초')
    .where('status', '==', 'confirmed')
    .limit(50)
    .get();

  const roomValues = new Set();

  snapshot.forEach(doc => {
    const data = doc.data();
    if (data.room) {
      roomValues.add(data.room);
    }
  });

  console.log('가부키초 건물의 고유한 room 값들:');
  console.log('총 ' + roomValues.size + '개의 고유 값\n');

  const sorted = Array.from(roomValues).sort();
  sorted.forEach(room => {
    console.log('  "' + room + '"');
  });

  console.log('\n이상한 값 찾기:');
  const weird = sorted.filter(room => {
    return room.includes('Room') || room.includes('room') || room.includes('(');
  });

  if (weird.length > 0) {
    console.log('⚠️  이상한 값 발견:');
    weird.forEach(room => {
      console.log('  "' + room + '"');
    });
  } else {
    console.log('✅ 이상한 값 없음');
  }

  process.exit(0);
}

checkKabukichoRooms().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
