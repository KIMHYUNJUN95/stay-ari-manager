/**
 * 🔔 알림 시스템 테스트 스크립트
 *
 * 사용법:
 * 1. 브라우저에서 앱 열기 (npm start)
 * 2. F12 눌러서 개발자 도구 열기
 * 3. Console 탭으로 이동
 * 4. 이 파일 전체 복사해서 붙여넣기 (Ctrl+V)
 * 5. Enter 키
 */

console.log('🔔 알림 시스템 테스트 시작...\n');

// ==========================================
// 1. localStorage 상태 확인
// ==========================================
console.log('📦 1. localStorage 데이터 확인:');
console.log('─'.repeat(50));

const lastKnown = localStorage.getItem('lastKnownReservations');
const notifications = localStorage.getItem('notifications');
const firstLoad = localStorage.getItem('notificationFirstLoad');
const lastSync = localStorage.getItem('lastNotificationSync');

console.log('✓ lastKnownReservations:', lastKnown ? `${JSON.parse(lastKnown).length}개 예약` : '❌ 없음');
console.log('✓ notifications:', notifications ? `${JSON.parse(notifications).length}개 알림` : '✅ 비어있음 (정상)');
console.log('✓ notificationFirstLoad:', firstLoad || '❌ 없음 (첫 로드)');
console.log('✓ lastNotificationSync:', lastSync ? new Date(parseInt(lastSync)).toLocaleString('ko-KR') : '❌ 없음');
console.log('\n');

// ==========================================
// 2. 알림 데이터 상세 보기
// ==========================================
if (notifications && JSON.parse(notifications).length > 0) {
  console.log('🔔 2. 현재 알림 목록:');
  console.log('─'.repeat(50));

  const notificationList = JSON.parse(notifications);
  notificationList.forEach((notif, index) => {
    const timeAgo = Math.floor((Date.now() - notif.timestamp) / 60000);
    console.log(`${index + 1}. [${notif.type}] ${notif.message}`);
    console.log(`   읽음: ${notif.isRead ? '✓' : '✗'} | ${timeAgo}분 전`);
  });
  console.log('\n');
}

// ==========================================
// 3. 예약 데이터 샘플 보기
// ==========================================
if (lastKnown && JSON.parse(lastKnown).length > 0) {
  console.log('📋 3. 저장된 예약 데이터 (최근 3개):');
  console.log('─'.repeat(50));

  const reservations = JSON.parse(lastKnown);
  reservations.slice(0, 3).forEach((res, index) => {
    const price = res.totalPrice || res.price || 0;
    const priceText = price >= 1000 ? `¥${price.toLocaleString('ja-JP')}` : `$${price}`;

    console.log(`${index + 1}. ${res.guestName || 'No name'}`);
    console.log(`   건물: ${res.building} | 상태: ${res.status}`);
    console.log(`   날짜: ${res.arrival} → ${res.departure}`);
    console.log(`   가격: ${priceText}`);
    console.log(`   플랫폼: ${res.platform || 'Unknown'}`);
  });
  console.log(`\n   ... 총 ${reservations.length}개 예약\n`);
}

// ==========================================
// 4. Firebase 연결 확인
// ==========================================
console.log('🔥 4. Firebase 연결 상태:');
console.log('─'.repeat(50));

try {
  if (typeof window.firebase !== 'undefined') {
    console.log('✅ Firebase 라이브러리 로드됨');
  } else {
    console.log('❌ Firebase 라이브러리 없음');
  }
} catch (e) {
  console.log('❌ Firebase 체크 실패:', e.message);
}
console.log('\n');

// ==========================================
// 5. 시스템 상태 요약
// ==========================================
console.log('📊 5. 시스템 상태 요약:');
console.log('─'.repeat(50));

const status = {
  localStorage저장: lastKnown ? '✅' : '❌',
  첫로드완료: firstLoad === 'false' ? '✅' : '⚠️ 첫 로드 대기중',
  알림개수: notifications ? JSON.parse(notifications).length : 0,
  예약개수: lastKnown ? JSON.parse(lastKnown).length : 0,
  마지막동기화: lastSync ? new Date(parseInt(lastSync)).toLocaleTimeString('ko-KR') : '없음'
};

console.table(status);
console.log('\n');

// ==========================================
// 6. 건강 체크
// ==========================================
console.log('💊 6. 건강 체크:');
console.log('─'.repeat(50));

let healthScore = 0;
let healthIssues = [];

if (lastKnown) {
  healthScore += 25;
  console.log('✅ 예약 데이터 저장됨 (+25점)');
} else {
  healthIssues.push('예약 데이터 없음 (5초 대기 필요)');
  console.log('⚠️ 예약 데이터 없음 (0점)');
}

if (firstLoad === 'false') {
  healthScore += 25;
  console.log('✅ 초기 동기화 완료 (+25점)');
} else {
  healthIssues.push('초기 동기화 미완료');
  console.log('⚠️ 초기 동기화 미완료 (0점)');
}

if (lastSync) {
  const timeSinceSync = Date.now() - parseInt(lastSync);
  if (timeSinceSync < 20 * 60 * 1000) { // 20분 이내
    healthScore += 25;
    console.log('✅ 최근 동기화됨 (+25점)');
  } else {
    healthIssues.push('동기화가 오래됨');
    console.log('⚠️ 동기화가 오래됨 (0점)');
  }
} else {
  healthIssues.push('동기화 기록 없음');
  console.log('⚠️ 동기화 기록 없음 (0점)');
}

// UI 확인 (NotificationBell 컴포넌트가 있는지)
const bellButton = document.querySelector('button[aria-label="Notifications"]');
if (bellButton) {
  healthScore += 25;
  console.log('✅ 알림 벨 UI 존재 (+25점)');
} else {
  healthIssues.push('알림 벨 UI 없음');
  console.log('❌ 알림 벨 UI 없음 (0점)');
}

console.log('\n');
console.log(`🏆 종합 건강 점수: ${healthScore}/100`);

if (healthScore === 100) {
  console.log('🎉 완벽합니다! 시스템이 정상 작동 중입니다.');
} else if (healthScore >= 75) {
  console.log('✅ 양호합니다. 대부분의 기능이 정상입니다.');
} else if (healthScore >= 50) {
  console.log('⚠️ 주의: 일부 기능에 문제가 있을 수 있습니다.');
} else {
  console.log('❌ 경고: 여러 문제가 발견되었습니다.');
}

if (healthIssues.length > 0) {
  console.log('\n⚠️ 발견된 문제:');
  healthIssues.forEach((issue, i) => {
    console.log(`   ${i + 1}. ${issue}`);
  });
}

console.log('\n');

// ==========================================
// 7. 빠른 액션 가이드
// ==========================================
console.log('🚀 7. 빠른 액션:');
console.log('─'.repeat(50));
console.log('다음 명령어를 복사해서 실행하세요:\n');

console.log('// localStorage 초기화 (문제 있을 때):');
console.log('localStorage.clear(); location.reload();\n');

console.log('// 알림 목록만 확인:');
console.log('JSON.parse(localStorage.getItem("notifications") || "[]")\n');

console.log('// 예약 목록만 확인:');
console.log('JSON.parse(localStorage.getItem("lastKnownReservations") || "[]")\n');

console.log('// 알림 벨 강제 클릭:');
console.log('document.querySelector(\'button[aria-label="Notifications"]\')?.click()\n');

console.log('─'.repeat(50));
console.log('✅ 테스트 완료!\n');

// ==========================================
// 8. 실시간 모니터링 시작 (선택사항)
// ==========================================
console.log('💡 TIP: 실시간 모니터링을 시작하려면 다음 실행:\n');
console.log('startNotificationMonitor()\n');

// 실시간 모니터링 함수
window.startNotificationMonitor = function() {
  console.log('🔄 실시간 모니터링 시작... (종료: stopNotificationMonitor())');

  let lastNotificationCount = 0;
  let lastReservationCount = 0;

  window.notificationMonitorInterval = setInterval(() => {
    const notifs = JSON.parse(localStorage.getItem('notifications') || '[]');
    const reservs = JSON.parse(localStorage.getItem('lastKnownReservations') || '[]');

    if (notifs.length !== lastNotificationCount) {
      console.log(`🔔 알림 변경: ${lastNotificationCount} → ${notifs.length}`);
      if (notifs.length > lastNotificationCount) {
        const newNotifs = notifs.slice(0, notifs.length - lastNotificationCount);
        newNotifs.forEach(n => {
          console.log(`   새 알림: ${n.message}`);
        });
      }
      lastNotificationCount = notifs.length;
    }

    if (reservs.length !== lastReservationCount) {
      console.log(`📋 예약 변경: ${lastReservationCount} → ${reservs.length}`);
      lastReservationCount = reservs.length;
    }
  }, 5000); // 5초마다 체크

  console.log('✅ 모니터링 활성화 (5초 간격)');
};

window.stopNotificationMonitor = function() {
  if (window.notificationMonitorInterval) {
    clearInterval(window.notificationMonitorInterval);
    console.log('🛑 실시간 모니터링 종료');
  }
};
