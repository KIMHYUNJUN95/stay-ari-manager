const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkReservation() {
  console.log('예약 ID 81900087 확인 중...\n');

  const doc = await db.collection('reservations').doc('81900087').get();

  if (!doc.exists) {
    console.log('예약을 찾을 수 없습니다.');
    process.exit(0);
  }

  const data = doc.data();

  console.log('=== 예약 정보 ===');
  console.log('ID:', doc.id);
  console.log('건물:', data.building);
  console.log('room:', data.room);
  console.log('roomId:', data.roomId);
  console.log('propertyId:', data.propertyId);
  console.log('arrival:', data.arrival);
  console.log('departure:', data.departure);
  console.log('guestName:', data.guestName);
  console.log('status:', data.status);

  console.log('\n=== 전체 데이터 ===');
  console.log(JSON.stringify(data, null, 2));

  process.exit(0);
}

checkReservation().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
