const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function analyzeUnderutilization() {
  console.log('=== 가부키초 3인실 저활용 분석 (최근 1년) ===\n');

  // 최근 1년 기간 설정
  const today = new Date();
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(today.getFullYear() - 1);

  const startDate = oneYearAgo.toISOString().split('T')[0];
  const endDate = today.toISOString().split('T')[0];

  console.log('분석 기간:', startDate, '~', endDate);
  console.log('데이터 로딩 중...\n');

  // 3인실 목록
  const threePersonRooms = ['502호', '603호', '802호', '803호'];

  // 단순 쿼리: companyId와 status만
  const snapshot = await db.collection('reservations')
    .where('companyId', '==', 'dGxlQyu47LbplLVCVXiV')
    .where('status', '==', 'confirmed')
    .get();

  console.log('총', snapshot.size, '건의 예약 검색됨');

  // 메모리에서 필터링
  let filteredCount = 0;
  const roomStats = {};
  threePersonRooms.forEach(room => {
    roomStats[room] = {
      total: 0,
      oneGuest: 0,
      twoGuests: 0,
      threeGuests: 0,
      fourPlusGuests: 0,
      oneGuestBookings: [],
      twoGuestsBookings: []
    };
  });

  let totalThreeRoomBookings = 0;
  let totalUnderutilized = 0;

  snapshot.forEach(doc => {
    const data = doc.data();

    // 가부키초만
    if (data.building !== '가부키초') return;

    // 3인실만
    const room = data.room;
    if (!threePersonRooms.includes(room)) return;

    // 기간 필터링
    if (!data.arrival || !data.departure) return;
    if (data.arrival < startDate || data.arrival > endDate) return;

    filteredCount++;
    const numAdult = data.numAdult || 0;
    const numChild = data.numChild || 0;
    const totalGuests = numAdult + numChild;

    totalThreeRoomBookings++;
    roomStats[room].total++;

    // 인원수별 분류
    if (totalGuests === 1) {
      roomStats[room].oneGuest++;
      roomStats[room].oneGuestBookings.push({
        id: doc.id,
        arrival: data.arrival,
        departure: data.departure,
        guestName: data.guestName,
        adults: numAdult,
        children: numChild,
        platform: data.platform
      });
      totalUnderutilized++;
    } else if (totalGuests === 2) {
      roomStats[room].twoGuests++;
      roomStats[room].twoGuestsBookings.push({
        id: doc.id,
        arrival: data.arrival,
        departure: data.departure,
        guestName: data.guestName,
        adults: numAdult,
        children: numChild,
        platform: data.platform
      });
      totalUnderutilized++;
    } else if (totalGuests === 3) {
      roomStats[room].threeGuests++;
    } else {
      roomStats[room].fourPlusGuests++;
    }
  });

  console.log('필터링된 예약:', filteredCount, '건\n');

  // 결과 출력
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 전체 요약');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('총 3인실 예약:', totalThreeRoomBookings, '건');
  console.log('저활용 예약 (1~2인):', totalUnderutilized, '건');
  console.log('저활용 비율:', ((totalUnderutilized / totalThreeRoomBookings) * 100).toFixed(1) + '%');
  console.log('');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 방별 상세 통계');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  threePersonRooms.forEach(room => {
    const stats = roomStats[room];
    const underutilized = stats.oneGuest + stats.twoGuests;
    const utilizationRate = stats.total > 0 ? ((underutilized / stats.total) * 100).toFixed(1) : 0;

    console.log('\n[' + room + '] (3인실)');
    console.log('  총 예약:', stats.total, '건');
    console.log('  1인 숙박:', stats.oneGuest, '건 (' + (stats.total > 0 ? ((stats.oneGuest / stats.total) * 100).toFixed(1) : 0) + '%)');
    console.log('  2인 숙박:', stats.twoGuests, '건 (' + (stats.total > 0 ? ((stats.twoGuests / stats.total) * 100).toFixed(1) : 0) + '%)');
    console.log('  3인 숙박:', stats.threeGuests, '건');
    console.log('  4인+ 숙박:', stats.fourPlusGuests, '건');
    console.log('  저활용 합계:', underutilized, '건 (' + utilizationRate + '%)');
  });

  // 1인 예약 상세 샘플 (최근 5건)
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔍 1인 예약 샘플 (최근 5건)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  threePersonRooms.forEach(room => {
    const bookings = roomStats[room].oneGuestBookings.sort((a, b) => b.arrival.localeCompare(a.arrival));
    if (bookings.length > 0) {
      console.log('\n[' + room + '] 1인 예약:');
      bookings.slice(0, 5).forEach(b => {
        console.log('  - ' + b.arrival + ' ~ ' + b.departure + ' | ' + b.guestName + ' | ' + b.adults + 'A ' + b.children + 'C | ' + b.platform);
      });
    }
  });

  // 2인 예약 상세 샘플 (최근 5건)
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔍 2인 예약 샘플 (최근 5건)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  threePersonRooms.forEach(room => {
    const bookings = roomStats[room].twoGuestsBookings.sort((a, b) => b.arrival.localeCompare(a.arrival));
    if (bookings.length > 0) {
      console.log('\n[' + room + '] 2인 예약:');
      bookings.slice(0, 5).forEach(b => {
        console.log('  - ' + b.arrival + ' ~ ' + b.departure + ' | ' + b.guestName + ' | ' + b.adults + 'A ' + b.children + 'C | ' + b.platform);
      });
    }
  });

  // CSV 출력 (엑셀용)
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📄 CSV 데이터 (엑셀 복사용)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('방,총예약,1인,2인,3인,4인+,저활용합계,저활용비율');
  threePersonRooms.forEach(room => {
    const stats = roomStats[room];
    const underutilized = stats.oneGuest + stats.twoGuests;
    const rate = stats.total > 0 ? ((underutilized / stats.total) * 100).toFixed(1) : 0;
    console.log(room + ',' + stats.total + ',' + stats.oneGuest + ',' + stats.twoGuests + ',' + stats.threeGuests + ',' + stats.fourPlusGuests + ',' + underutilized + ',' + rate + '%');
  });

  process.exit(0);
}

analyzeUnderutilization().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
