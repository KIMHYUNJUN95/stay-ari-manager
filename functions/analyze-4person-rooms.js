const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');
const fs = require('fs');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function analyze4PersonRooms() {
  const startDate = '2025-02-18';
  const endDate = '2026-02-18';
  const threePersonRooms = ['502호', '603호', '802호', '803호'];

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('가부키초 4인실 분석 (4인 숙박)');
  console.log('분석 기간: 2025-02-18 ~ 2026-02-18');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  const snapshot = await db.collection('reservations')
    .where('companyId', '==', 'dGxlQyu47LbplLVCVXiV')
    .where('status', '==', 'confirmed')
    .get();

  const roomStats = {};
  const allBookings = [];

  snapshot.forEach(doc => {
    const data = doc.data();
    if (data.building !== '가부키초') return;
    const room = data.room;

    // 3인실 제외
    if (threePersonRooms.includes(room)) return;

    if (!data.arrival || !data.departure) return;
    if (data.arrival < startDate || data.arrival > endDate) return;

    const numAdult = data.numAdult || 0;
    const numChild = data.numChild || 0;
    const totalGuests = numAdult + numChild;

    // 4인 숙박만
    if (totalGuests !== 4) return;

    if (!roomStats[room]) {
      roomStats[room] = {
        total: 0,
        bookings: []
      };
    }

    const booking = {
      arrival: data.arrival,
      departure: data.departure,
      guestName: data.guestName || '(이름없음)',
      adults: numAdult,
      children: numChild,
      platform: data.platform || 'Unknown',
      room: room
    };

    roomStats[room].total++;
    roomStats[room].bookings.push(booking);
    allBookings.push(booking);
  });

  // 방 이름순 정렬
  const sortedRooms = Object.keys(roomStats).sort();

  // 출력 문자열 생성
  let output = '';
  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  output += '가부키초 4인실 4인 숙박 예약 리스트\n';
  output += '분석 기간: 2025-02-18 ~ 2026-02-18\n';
  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  output += '\n';

  sortedRooms.forEach(room => {
    const stats = roomStats[room];
    const bookings = stats.bookings.sort((a, b) => a.arrival.localeCompare(b.arrival));

    output += `\n【${room}】 4인 숙박 ${stats.total}건\n`;
    output += '─────────────────────────────────────────────────────────────\n';

    bookings.forEach((b, idx) => {
      output += `${idx + 1}. ${b.arrival} ~ ${b.departure} | ${b.guestName} | ${b.adults + b.children}명(성인${b.adults}, 아동${b.children}) | ${b.platform}\n`;
    });
  });

  // 요약 테이블
  const totalBookings = allBookings.length;

  output += '\n\n';
  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  output += '📊 요약 통계\n';
  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  output += '\n';
  output += `총 4인 숙박 예약: ${totalBookings}건\n`;
  output += '\n';

  output += '┌────────────┬──────────┐\n';
  output += '│    방      │  4인 예약│\n';
  output += '├────────────┼──────────┤\n';

  sortedRooms.forEach(room => {
    const count = roomStats[room].total;
    const paddedRoom = room.padEnd(10, ' ');
    const paddedCount = String(count).padStart(6, ' ');
    output += `│ ${paddedRoom} │ ${paddedCount}건 │\n`;
  });

  output += '├────────────┼──────────┤\n';
  const paddedTotal = String(totalBookings).padStart(6, ' ');
  output += `│ 합계       │ ${paddedTotal}건 │\n`;
  output += '└────────────┴──────────┘\n';

  output += '\n';
  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  output += '보고서 생성일: 2026-02-18\n';
  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';

  // 파일 저장
  fs.writeFileSync('4person_rooms_report.txt', output, 'utf8');
  console.log(output);
  console.log('\n✅ 파일 저장됨: functions/4person_rooms_report.txt');

  process.exit(0);
}

analyze4PersonRooms().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
