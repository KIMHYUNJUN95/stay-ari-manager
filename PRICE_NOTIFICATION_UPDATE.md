# 💰 가격 정보 추가 업데이트

## ✅ 변경 사항

알림 메시지에 **예약 금액**이 추가되었습니다!

---

## 📝 새로운 알림 형식

### **1. 신규 예약 (✨ NEW)**
```
이전: ✨ New: Mia Russo · Airbnb · Okubo B
현재: ✨ New: Mia Russo · Airbnb · Okubo B · ¥45,000
```

### **2. 예약 취소 (❌ CANCEL)**
```
이전: ❌ Canceled: John Doe · Arakicho A
현재: ❌ Canceled: John Doe · Arakicho A · ¥32,500
```

### **3. 예약 수정 (📝 MODIFY)**

**날짜 변경:**
```
📝 Modified: Sarah Lee · Date Changed (Feb 10 → Feb 12)
```

**인원 변경:**
```
📝 Modified: Tom Kim · Guests Changed (2 → 4)
```

**박수 변경:**
```
📝 Modified: Alice Park · Nights Changed (3 → 5)
```

**가격 변경 (신규 감지!):**
```
📝 Modified: David Chen · Price Changed (¥40,000 → ¥45,000)
```

**여러 항목 동시 변경:**
```
📝 Modified: Emma Wilson · Date Changed (Feb 10 → Feb 12), Price Changed (¥40,000 → ¥45,000)
```

---

## 💴 가격 표시 형식

### 자동 통화 감지:
- **일본 엔화 (¥)**: 가격이 1,000 이상인 경우
  - 예: `¥45,000`, `¥32,500`, `¥120,000`
- **미국 달러 ($)**: 가격이 1,000 미만인 경우
  - 예: `$450`, `$325`, `$120`

### 천 단위 구분:
- 일본 형식: `¥45,000` (쉼표로 구분)
- 미국 형식: `$1,234` (쉼표로 구분)

---

## 🔍 가격 변경 감지

시스템이 다음 경우에 가격 변경을 감지합니다:

1. **totalPrice 변경** (우선순위)
2. **price 변경** (totalPrice가 없을 경우)
3. **0원 → 금액 있음** (가격 입력)
4. **금액 있음 → 0원** (가격 삭제)
5. **금액 → 다른 금액** (가격 수정)

---

## 🧪 테스트 방법

### 1. 신규 예약 가격 테스트
```
Firestore에서 새 예약 추가:
- guestName: "Test User"
- totalPrice: 50000
- status: "confirmed"

예상 알림:
✨ New: Test User · Airbnb · Okubo B · ¥50,000
```

### 2. 가격 변경 테스트
```
기존 예약의 가격 수정:
totalPrice: 40000 → 45000

예상 알림:
📝 Modified: Test User · Price Changed (¥40,000 → ¥45,000)
```

### 3. 취소된 예약 가격 테스트
```
예약 상태 변경:
status: "confirmed" → "canceled"

예상 알림:
❌ Canceled: Test User · Okubo B · ¥50,000
```

---

## 📊 데이터 우선순위

예약 데이터에서 가격을 가져오는 우선순위:

```javascript
1순위: reservation.totalPrice
2순위: reservation.price
3순위: 0 (가격 정보 없음)
```

---

## 🎨 UI 예시

```
┌─────────────────────────────────────────────┐
│ 🔔 Notifications                          🔄 │
│ Last sync: 2m ago                            │
├─────────────────────────────────────────────┤
│ ✨ New: Mia Russo                           │
│    Airbnb · Okubo B · ¥45,000         5m ago│
├─────────────────────────────────────────────┤
│ 📝 Modified: Sarah Lee                      │
│    Price Changed (¥40,000 → ¥45,000)  1h ago│
├─────────────────────────────────────────────┤
│ ❌ Canceled: John Doe                       │
│    Arakicho A · ¥32,500                3h ago│
└─────────────────────────────────────────────┘
```

---

## 🛠️ 기술적 변경 사항

### 추가된 함수:
```javascript
// 가격 포맷팅 함수
const formatPrice = useCallback((price) => {
  if (!price || price === 0) return '';
  if (price >= 1000) {
    return `¥${price.toLocaleString('ja-JP')}`;
  } else {
    return `$${price.toLocaleString('en-US')}`;
  }
}, []);
```

### 수정된 부분:

**1. generateMessage 함수:**
- NEW 타입: 가격 정보 추가
- CANCEL 타입: 가격 정보 추가
- MODIFY 타입: 가격 변경 감지 추가

**2. compareAndNotify 함수:**
- 가격 비교 로직 추가
- `oldPrice !== newPrice` 체크

---

## 💡 사용 팁

### 가격 정보가 없는 경우:
- 가격이 0원이거나 없으면 표시하지 않음
- 알림 형식: `✨ New: Guest Name · Airbnb · Okubo B` (가격 제외)

### 가격만 변경된 경우:
```
📝 Modified: Guest Name · Price Changed (¥40,000 → ¥45,000)
```

### 날짜와 가격이 함께 변경된 경우:
```
📝 Modified: Guest Name · Date Changed (Feb 10 → Feb 12), Price Changed (¥40,000 → ¥45,000)
```

---

## 📱 실제 사용 예시

### 시나리오 1: 신규 예약 입력
```
상황: Airbnb에서 ¥50,000짜리 예약 들어옴
알림: ✨ New: 田中太郎 · Airbnb · Okubo B · ¥50,000

→ 관리자가 즉시 금액 확인 가능!
```

### 시나리오 2: 가격 협상 후 변경
```
상황: 게스트와 가격 협상으로 ¥45,000 → ¥40,000 변경
알림: 📝 Modified: 田中太郎 · Price Changed (¥45,000 → ¥40,000)

→ 가격 변동 이력 추적 가능!
```

### 시나리오 3: 취소 환불 처리
```
상황: ¥50,000짜리 예약이 취소됨
알림: ❌ Canceled: 田中太郎 · Okubo B · ¥50,000

→ 환불 금액 즉시 확인 가능!
```

---

## ✅ 확인 사항

테스트 시 확인할 항목:

- [ ] 신규 예약에 가격 표시
- [ ] 취소 예약에 가격 표시
- [ ] 가격 변경 감지 (수정 알림)
- [ ] 엔화 형식 (¥45,000)
- [ ] 달러 형식 ($450)
- [ ] 천 단위 쉼표 구분
- [ ] 가격 없을 때 표시 안 함
- [ ] 여러 변경사항 함께 표시

---

## 🔄 롤백 방법

이전 버전으로 돌아가려면:

**`/src/hooks/useNotifications.js` 파일에서:**
1. `formatPrice` 함수 제거
2. `generateMessage` 함수에서 `priceText` 관련 코드 제거
3. `compareAndNotify` 함수에서 가격 비교 로직 제거

---

**업데이트 날짜:** 2026년 2월 6일
**버전:** 1.1.0 (가격 정보 추가)

🎉 **이제 예약 정보와 함께 가격도 한눈에 확인 가능합니다!**
