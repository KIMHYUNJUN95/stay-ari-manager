const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');
const fs = require('fs');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function analyze4PersonSummary() {
  const startDate = '2025-02-18';
  const endDate = '2026-02-18';
  const threePersonRooms = ['502호', '603호', '802호', '803호']; // 3인실 제외

  const snapshot = await db.collection('reservations')
    .where('companyId', '==', 'dGxlQyu47LbplLVCVXiV')
    .where('status', '==', 'confirmed')
    .get();

  const roomStats = {};

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

    if (!roomStats[room]) {
      roomStats[room] = {
        total: 0,
        one: 0,
        two: 0,
        three: 0,
        four: 0
      };
    }

    roomStats[room].total++;

    if (totalGuests === 1) roomStats[room].one++;
    else if (totalGuests === 2) roomStats[room].two++;
    else if (totalGuests === 3) roomStats[room].three++;
    else if (totalGuests === 4) roomStats[room].four++;
  });

  // 방 이름순 정렬
  const sortedRooms = Object.keys(roomStats).sort();

  // 전체 합계
  let totalAll = 0, totalOne = 0, totalTwo = 0, totalThree = 0, totalFour = 0;
  sortedRooms.forEach(room => {
    const stats = roomStats[room];
    totalAll += stats.total;
    totalOne += stats.one;
    totalTwo += stats.two;
    totalThree += stats.three;
    totalFour += stats.four;
  });

  // 출력 문자열 생성
  let output = '';
  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  output += '가부키초 4인실 예약 분석 보고서\n';
  output += '분석 기간: 2025-02-18 ~ 2026-02-18\n';
  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  output += '\n\n';

  // 1. 인원별 예약 통계
  output += '【1】 인원별 예약 통계\n';
  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  output += '\n';
  output += '┌────────┬──────────┬────────┬────────┬────────┬────────┐\n';
  output += '│  방    │  총 예약 │  1인   │  2인   │  3인   │  4인   │\n';
  output += '├────────┼──────────┼────────┼────────┼────────┼────────┤\n';

  sortedRooms.forEach(room => {
    const stats = roomStats[room];
    const paddedRoom = room.padEnd(6, ' ');
    const paddedTotal = String(stats.total).padStart(6, ' ');
    const paddedOne = String(stats.one).padStart(4, ' ');
    const paddedTwo = String(stats.two).padStart(4, ' ');
    const paddedThree = String(stats.three).padStart(4, ' ');
    const paddedFour = String(stats.four).padStart(4, ' ');
    output += `│ ${paddedRoom} │ ${paddedTotal}건 │ ${paddedOne}건 │ ${paddedTwo}건 │ ${paddedThree}건 │ ${paddedFour}건 │\n`;
  });

  output += '├────────┼──────────┼────────┼────────┼────────┼────────┤\n';
  const paddedTotalAll = String(totalAll).padStart(6, ' ');
  const paddedTotalOne = String(totalOne).padStart(4, ' ');
  const paddedTotalTwo = String(totalTwo).padStart(4, ' ');
  const paddedTotalThree = String(totalThree).padStart(4, ' ');
  const paddedTotalFour = String(totalFour).padStart(4, ' ');
  output += `│ 합계   │ ${paddedTotalAll}건 │ ${paddedTotalOne}건 │ ${paddedTotalTwo}건 │ ${paddedTotalThree}건 │ ${paddedTotalFour}건 │\n`;
  output += '└────────┴──────────┴────────┴────────┴────────┴────────┘\n';
  output += '\n\n';

  // 2. 저활용 분석
  output += '【2】 저활용 분석 (1~3인 숙박)\n';
  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  output += '\n';
  output += '┌────────┬─────────────────┬──────────────┐\n';
  output += '│  방    │  저활용 (1~3인) │   비율       │\n';
  output += '├────────┼─────────────────┼──────────────┤\n';

  sortedRooms.forEach(room => {
    const stats = roomStats[room];
    const underutilized = stats.one + stats.two + stats.three;
    const rate = stats.total > 0 ? ((underutilized / stats.total) * 100).toFixed(1) : 0;
    const rateNum = parseFloat(rate);

    let marker = '';
    if (rateNum >= 40) marker = ' 🔴';
    else if (rateNum >= 30) marker = ' ⚠️';
    else if (rateNum <= 20) marker = ' ⭐';

    const paddedRoom = room.padEnd(6, ' ');
    const paddedCount = `${underutilized}건/${stats.total}건`.padEnd(13, ' ');
    const paddedRate = `${rate}%`.padStart(8, ' ');

    output += `│ ${paddedRoom} │ ${paddedCount} │ ${paddedRate}${marker.padEnd(5, ' ')}│\n`;
  });

  const totalUnderutilized = totalOne + totalTwo + totalThree;
  const totalRate = totalAll > 0 ? ((totalUnderutilized / totalAll) * 100).toFixed(1) : 0;
  const paddedTotalCount = `${totalUnderutilized}건/${totalAll}건`.padEnd(13, ' ');
  const paddedTotalRate = `${totalRate}%`.padStart(8, ' ');

  output += '├────────┼─────────────────┼──────────────┤\n';
  output += `│ 합계   │ ${paddedTotalCount} │ ${paddedTotalRate}     │\n`;
  output += '└────────┴─────────────────┴──────────────┘\n';
  output += '\n\n';

  // 3. 주요 발견 사항
  output += '【3】 주요 발견 사항\n';
  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  output += '\n';
  output += '▶ 전체 통계\n';
  output += `  • 총 예약: ${totalAll}건\n`;
  output += `  • 1인 예약: ${totalOne}건 (${((totalOne / totalAll) * 100).toFixed(1)}%)\n`;
  output += `  • 2인 예약: ${totalTwo}건 (${((totalTwo / totalAll) * 100).toFixed(1)}%)\n`;
  output += `  • 3인 예약: ${totalThree}건 (${((totalThree / totalAll) * 100).toFixed(1)}%)\n`;
  output += `  • 4인 예약: ${totalFour}건 (${((totalFour / totalAll) * 100).toFixed(1)}%)\n`;
  output += '\n';
  output += '▶ 저활용 현황\n';
  output += `  • 총 저활용 예약: ${totalUnderutilized}건 (${totalRate}%)\n`;
  output += `  • 4인 활용: ${totalFour}건 (${((totalFour / totalAll) * 100).toFixed(1)}%)\n`;
  output += '\n';

  // 방별 특이사항
  output += '▶ 방별 특이사항\n';
  output += '\n';

  sortedRooms.forEach(room => {
    const stats = roomStats[room];
    const underutilized = stats.one + stats.two + stats.three;
    const rate = ((underutilized / stats.total) * 100).toFixed(1);
    const fourRate = ((stats.four / stats.total) * 100).toFixed(1);

    let status = '';
    let marker = '';
    if (parseFloat(rate) >= 40) {
      status = '심각한 저활용';
      marker = '🔴';
    } else if (parseFloat(rate) >= 30) {
      status = '개선 필요';
      marker = '⚠️';
    } else if (parseFloat(rate) <= 20) {
      status = '효율적';
      marker = '⭐';
    } else {
      status = '양호';
    }

    output += `  [${room}] - ${status} ${marker}\n`;
    output += `  • 저활용 비율 ${rate}%\n`;
    output += `  • 4인 예약 비율: ${fourRate}% (${stats.four}건/${stats.total}건)\n`;

    if (parseFloat(rate) >= 40) {
      output += `  • → 가격 정책 재검토 필요 (1~3인 예약이 ${underutilized}건)\n`;
    } else if (parseFloat(rate) <= 20) {
      output += `  • → 모범 사례로 활용 가능\n`;
    }

    output += '\n';
  });

  // 4. 권장 사항
  output += '\n';
  output += '【4】 권장 사항\n';
  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  output += '\n';

  // 저활용 방 찾기
  const highUnderutilization = [];
  const efficient = [];

  sortedRooms.forEach(room => {
    const stats = roomStats[room];
    const underutilized = stats.one + stats.two + stats.three;
    const rate = ((underutilized / stats.total) * 100).toFixed(1);

    if (parseFloat(rate) >= 30) {
      highUnderutilization.push({ room, rate, stats });
    } else if (parseFloat(rate) <= 20) {
      efficient.push({ room, rate, stats });
    }
  });

  if (highUnderutilization.length > 0) {
    output += '1. 저활용 방 개선 전략\n';
    highUnderutilization.forEach(({ room, rate }) => {
      output += `   [${room}]\n`;
      output += `   ✓ 1~3인 예약 시 추가 요금 부과\n`;
      output += `   ✓ 4인 예약 우대 가격 정책 도입\n`;
      output += `   ✓ 최소 인원 요구사항 검토\n`;
      output += '\n';
    });
  }

  if (efficient.length > 0) {
    output += `2. 효율적 운영 방 분석\n`;
    efficient.forEach(({ room }) => {
      output += `   [${room}]\n`;
      output += `   ✓ 이 방의 가격/마케팅 전략 분석\n`;
      output += `   ✓ 다른 방에 적용 가능한 요소 도출\n`;
      output += '\n';
    });
  }

  output += '3. 전체 4인실 전략\n';
  output += `   ✓ 4인 예약 비율: ${((totalFour / totalAll) * 100).toFixed(1)}%\n`;
  output += `   ✓ 목표: 4인 활용률 70% 이상 달성\n`;
  output += `   ✓ 가격 차별화로 4인 예약 유도\n`;
  output += '\n';

  output += '\n';
  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';
  output += '보고서 생성일: 2026-02-18\n';
  output += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n';

  // 파일 저장
  fs.writeFileSync('4person_summary.txt', output, 'utf8');
  console.log(output);
  console.log('\n✅ 파일 저장됨: functions/4person_summary.txt');

  process.exit(0);
}

analyze4PersonSummary().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
