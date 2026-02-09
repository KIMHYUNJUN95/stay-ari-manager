# 🔧 알림 시스템 디버깅 가이드

## ✅ 코드 검증 완료

모든 코드가 정상적으로 컴파일되었습니다!

**컴파일 상태:** ✅ 성공 (경고 수정 완료)
- UUID 생성 함수 경고 수정
- NotificationBell import 정상
- BUILDING_NAMES_EN export 정상

---

## 🔍 단계별 디버깅 절차

### 1단계: 앱 실행 및 콘솔 확인

```bash
# 앱 실행
npm start

# 브라우저가 자동으로 열리면:
# 1. F12 키를 눌러 개발자 도구 열기
# 2. Console 탭 확인
```

**확인할 콘솔 메시지:**
```javascript
// 정상 작동 시:
"📊 Initial baseline set. Notifications will appear on next sync."

// 에러 발생 시:
"Failed to fetch reservations: [에러 메시지]"
"Sync error: [에러 메시지]"
```

---

### 2단계: UI 확인

#### PC 헤더 확인:
```
┌──────────────────────────────────────────────┐
│  Search...  🔍   📅  🔔  👤 Admin            │
│                         ↑                     │
│                    여기에 벨 아이콘 있어야 함    │
└──────────────────────────────────────────────┘
```

**체크리스트:**
- [ ] 벨 아이콘이 보이는가?
- [ ] 달력 아이콘과 사용자 아이콘 사이에 있는가?
- [ ] 클릭하면 드롭다운이 열리는가?

#### 드롭다운 확인:
```
클릭 후 나타나야 할 모습:
┌─────────────────────────────────────┐
│ 🔔 Notifications              🔄    │
│ Last sync: Just now                 │
├─────────────────────────────────────┤
│                                     │
│        🔔                           │
│    No notifications yet             │
│                                     │
└─────────────────────────────────────┘
```

---

### 3단계: Firebase 연결 테스트

#### 브라우저 콘솔에서 실행:
```javascript
// Firebase 연결 확인
console.log('Firebase app name:', window.firebase?.app?.name);

// localStorage 확인
console.log('Last known:', localStorage.getItem('lastKnownReservations'));
console.log('Notifications:', localStorage.getItem('notifications'));
console.log('First load:', localStorage.getItem('notificationFirstLoad'));
```

**예상 결과:**
```
Firebase app name: [앱 이름]
Last known: [JSON 배열] 또는 null
Notifications: [] 또는 [알림 배열]
First load: null 또는 "false"
```

---

### 4단계: 강제 동기화 테스트

#### 수동 동기화:
1. 벨 아이콘 클릭
2. 드롭다운 헤더의 🔄 아이콘 클릭
3. 콘솔에서 메시지 확인

**예상 콘솔 메시지:**
```javascript
// 첫 동기화:
"📊 Initial baseline set. Notifications will appear on next sync."

// 이후 동기화 (변경사항 없음):
"✅ Manual sync complete. No new changes detected."

// 변경사항 있음:
"🔔 3 new notification(s) generated."
```

---

### 5단계: 알림 생성 테스트

#### 방법 A: Firestore에서 직접 수정
```
1. Firebase Console 접속
   https://console.firebase.google.com

2. Firestore Database 선택

3. reservations 컬렉션 열기

4. 새 문서 추가:
   {
     guestName: "테스트 게스트",
     building: "오쿠보A동",
     platform: "Airbnb",
     totalPrice: 50000,
     status: "confirmed",
     arrival: "2026-02-10",
     departure: "2026-02-12",
     numAdult: 2,
     numChild: 0
   }

5. 앱에서 강제 동기화 클릭

6. 알림 확인:
   ✨ New: 테스트 게스트 · Airbnb · Okubo A · ¥50,000
```

#### 방법 B: 개발자 도구에서 테스트
```javascript
// 브라우저 콘솔에서 실행:

// 1. localStorage 초기화
localStorage.removeItem('lastKnownReservations');
localStorage.removeItem('notifications');
localStorage.removeItem('notificationFirstLoad');
localStorage.removeItem('lastNotificationSync');

// 2. 페이지 새로고침 (F5)

// 3. 5초 후 강제 동기화 클릭
```

---

### 6단계: 일반적인 문제 해결

#### 문제 1: 벨 아이콘이 안 보임
```
원인: NotificationBell 컴포넌트 import 오류
해결:
1. 브라우저 콘솔에서 에러 확인
2. src/components/NotificationBell.jsx 파일 존재 확인
3. NewLayout.jsx import 문 확인
```

**확인 명령:**
```bash
# 파일 존재 확인
ls -la src/components/NotificationBell.jsx

# import 확인
grep "NotificationBell" src/components/NewLayout.jsx
```

---

#### 문제 2: 드롭다운이 안 열림
```
원인: 클릭 이벤트 오류
해결:
1. F12 → Console에서 JavaScript 에러 확인
2. React DevTools 설치 후 컴포넌트 상태 확인
```

**디버깅 코드 추가:**
```javascript
// NotificationBell.jsx의 bellButton onClick에 임시 추가:
onClick={() => {
  console.log('Bell clicked!', isOpen);
  setIsOpen(!isOpen);
}}
```

---

#### 문제 3: 알림이 생성 안 됨
```
원인: Firebase 데이터 페치 실패 또는 비교 로직 오류
해결:
1. 콘솔에서 "Failed to fetch reservations" 확인
2. Firebase 권한 설정 확인
3. localStorage 데이터 확인
```

**디버깅 스크립트:**
```javascript
// 브라우저 콘솔에서 실행:

// 현재 저장된 데이터 확인
const lastKnown = JSON.parse(localStorage.getItem('lastKnownReservations') || '[]');
console.log('Last known reservations:', lastKnown.length, 'items');
console.log('Data:', lastKnown);

// 알림 확인
const notifications = JSON.parse(localStorage.getItem('notifications') || '[]');
console.log('Notifications:', notifications.length, 'items');
console.log('Data:', notifications);
```

---

#### 문제 4: 건물명이 한글로 나옴
```
원인: BUILDING_NAMES_EN 매핑 누락
해결:
1. src/constants/buildingData.js 확인
2. 건물명 매핑 추가
```

**확인 명령:**
```bash
grep -A 10 "BUILDING_NAMES_EN" src/constants/buildingData.js
```

**누락된 건물명 추가:**
```javascript
export const BUILDING_NAMES_EN = {
  "아라키초A": "Arakicho A",
  "아라키초B": "Arakicho B",
  "다이쿄초": "Daikyocho",
  "가부키초": "Kabukicho",
  "다카다노바바": "Takadanobaba",
  "오쿠보A동": "Okubo A",  // 추가
  "오쿠보B동": "Okubo B",  // 추가
  "오쿠보C동": "Okubo C",  // 추가
  "사노시": "Sano",
  "사노": "Sano"
};
```

---

#### 문제 5: 가격이 표시 안 됨
```
원인: totalPrice 또는 price 필드 누락
해결:
1. Firestore 데이터 확인
2. 필드명 확인 (totalPrice, price)
```

**데이터 확인:**
```javascript
// 브라우저 콘솔에서:
const lastKnown = JSON.parse(localStorage.getItem('lastKnownReservations') || '[]');
const firstReservation = lastKnown[0];
console.log('Price data:', {
  totalPrice: firstReservation?.totalPrice,
  price: firstReservation?.price
});
```

---

### 7단계: 네트워크 디버깅

#### Firestore 호출 확인:
```
1. F12 → Network 탭
2. 페이지 새로고침
3. "firestore" 필터 입력
4. 요청 상태 확인 (200 OK여야 함)
```

**예상 요청:**
```
Name: firestore.googleapis.com/...
Status: 200 OK
Type: xhr
Size: [데이터 크기]
```

---

### 8단계: React DevTools 디버깅

#### React DevTools 설치:
```
Chrome Extension:
https://chrome.google.com/webstore/detail/react-developer-tools/fmkadmapgofadopljbjfkapdkoienihi
```

#### 컴포넌트 상태 확인:
```
1. F12 → Components 탭
2. NotificationBell 컴포넌트 찾기
3. Hooks 확인:
   - notifications (배열)
   - unreadCount (숫자)
   - isLoading (boolean)
   - lastSyncTime (타임스탬프)
```

---

## 🧪 완전 테스트 시나리오

### 시나리오 1: 신규 예약 알림
```
1. localStorage 초기화
   localStorage.clear();

2. 페이지 새로고침 (F5)

3. 5초 대기 (초기 동기화)

4. Firestore에 새 예약 추가

5. 강제 동기화 클릭

예상 결과:
✨ New: [게스트명] · [플랫폼] · [건물] · [가격]
```

---

### 시나리오 2: 예약 취소 알림
```
1. 기존 예약의 status 변경:
   "confirmed" → "canceled"

2. 강제 동기화 클릭

예상 결과:
❌ Canceled: [게스트명] · [건물] · [가격]
```

---

### 시나리오 3: 가격 변경 알림
```
1. 기존 예약의 totalPrice 변경:
   40000 → 45000

2. 강제 동기화 클릭

예상 결과:
📝 Modified: [게스트명] · Price Changed (¥40,000 → ¥45,000)
```

---

## 📊 성능 모니터링

### 메모리 사용량 확인:
```
1. F12 → Memory 탭
2. Take heap snapshot
3. 15분 후 다시 snapshot
4. Comparison 확인 (메모리 누수 체크)
```

### 타이밍 확인:
```javascript
// 브라우저 콘솔에서:
console.time('sync');
// 강제 동기화 클릭
// 완료 후:
console.timeEnd('sync');

// 예상: 500ms ~ 2000ms
```

---

## 🔐 Firebase 권한 체크

### Firestore 보안 규칙 확인:
```javascript
// Firebase Console → Firestore → Rules

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /reservations/{document=**} {
      allow read: if request.auth != null;  // ← 이 부분 확인
      allow write: if request.auth != null;
    }
  }
}
```

---

## 📝 디버깅 체크리스트

### 초기 설정:
- [ ] npm start 정상 실행
- [ ] 컴파일 오류 없음
- [ ] 브라우저 콘솔에 에러 없음
- [ ] Firebase 연결 정상

### UI 확인:
- [ ] 벨 아이콘 표시됨
- [ ] 클릭 시 드롭다운 열림
- [ ] 빈 상태 메시지 표시됨
- [ ] 강제 동기화 버튼 작동함

### 기능 테스트:
- [ ] 초기 동기화 완료 (5초 후)
- [ ] 강제 동기화 작동
- [ ] 새 예약 알림 생성
- [ ] 취소 알림 생성
- [ ] 수정 알림 생성
- [ ] 가격 정보 표시

### 데이터 검증:
- [ ] localStorage 저장 정상
- [ ] 영문 건물명 표시
- [ ] 가격 포맷 정상 (¥45,000)
- [ ] 타임스탬프 표시 (5m ago)

---

## 🆘 긴급 문제 해결

### 완전 초기화 (모든 게 안 될 때):
```bash
# 1. 앱 종료 (Ctrl+C)

# 2. node_modules 삭제 및 재설치
rm -rf node_modules package-lock.json
npm install

# 3. 브라우저 캐시 완전 삭제
# Chrome: Ctrl+Shift+Delete → "All time" 선택

# 4. localStorage 완전 초기화
# 브라우저 콘솔에서:
localStorage.clear();
sessionStorage.clear();

# 5. 앱 재시작
npm start
```

---

## 📞 추가 도움

문제가 계속되면 다음 정보를 수집하세요:

```
1. 브라우저 콘솔 전체 로그 (Ctrl+A, Ctrl+C)
2. Network 탭 스크린샷
3. React DevTools 컴포넌트 상태 스크린샷
4. localStorage 데이터:
   - lastKnownReservations
   - notifications
   - notificationFirstLoad
```

---

**디버깅 완료 후 확인:**
- ✅ 알림 시스템 정상 작동
- ✅ 15분 자동 동기화 작동
- ✅ 가격 정보 표시
- ✅ 영문 건물명 표시

**마지막 업데이트:** 2026-02-06
