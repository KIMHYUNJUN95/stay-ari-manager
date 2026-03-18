# Stay-Ari Manager — Claude 작업 지침

## 프로젝트 개요
일본 숙박시설(9개 부동산) 관리 SaaS. Beds24 예약 플랫폼 API를 중심으로 실시간 예약 동기화, 매출 분석, 팀 협업 기능을 제공하는 멀티 테넌트 하이브리드 앱.

## 기술 스택
- **Frontend**: React 18, React Router 6, Recharts, Framer Motion, dayjs, lucide-react
- **Backend**: Firebase Cloud Functions (Node.js)
- **DB**: Firestore (멀티 테넌트 — companyId로 격리)
- **Auth**: Firebase Authentication
- **Mobile**: Capacitor 8 (Android/iOS)
- **External API**: Beds24 V2 API, Google Sheets API
- **Model**: claude-sonnet-4-6

## 파일 구조
```
src/
  components/     # 대시보드/UI 컴포넌트 (30개+)
  contexts/       # UserContext (user, userData, companyId, loading)
  constants/      # buildingData.js, roomLinks.js
  hooks/          # useNotifications.js
  App.jsx         # 라우팅 + 레이아웃 (메인)
  firebase.js     # Firebase 초기화 (db, auth, storage export)
functions/
  index.js        # 모든 Cloud Functions (30개+ 함수)
```

## 아키텍처 규칙

### 멀티 테넌트
- 모든 Firestore 쿼리에 `where('companyId', '==', companyId)` 필수
- companyId는 항상 `useUser()` hook에서 가져올 것
- Cloud Functions 호출 시 항상 `{ companyId, ...params }` 포함

### 상태 관리
- 전역 상태는 UserContext만 사용 (`user`, `userData`, `companyId`, `loading`)
- 로컬 상태는 `useState` + `useEffect` 패턴
- 추가 Context나 외부 상태 라이브러리(Redux, Zustand 등) 도입 금지

### Firestore 접근
```javascript
// 읽기 패턴
const snapshot = await getDocs(query(
  collection(db, 'collection_name'),
  where('companyId', '==', companyId)
));
const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

// 쓰기 패턴
await updateDoc(doc(db, 'collection_name', id), {
  field: value,
  updatedAt: serverTimestamp()
});
```

### Cloud Functions 호출
```javascript
const res = await fetch(
  `${process.env.REACT_APP_API_BASE_URL}/functionName`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ companyId, ...params })
  }
);
```

### 스타일링
- 기존 CSS 클래스 체계 유지 (CSS-in-JS 스타일, App.jsx 패턴 참고)
- 색상: 사이드바 `#1E293B`, Primary `#4F46E5`, BG `#F1F5F9`
- 모바일 반응형 필수: `@media (max-width: 768px)` 오버라이드
- Tailwind 설치되어 있지 않음 — Tailwind 클래스 사용 금지

## 부동산 목록
아라키초A, 아라키초B, 다이쿄초(매각완료), 가부키초, 다카다노바바, 오쿠보A동, 오쿠보B동, 오쿠보C동, 사노시

## 플랫폼
Airbnb, Booking.com, Expedia, Agoda, Direct(수기)

## 예약 상태
`confirmed`, `cancelled`, `blackout`, `inquiry`

## 에이전트 자동 호출 규칙

사용자가 명시적으로 커맨드를 입력하지 않아도, 아래 상황에서 해당 에이전트를 자동으로 호출할 것:

| 상황 감지 | 호출 에이전트 |
|-----------|--------------|
| 기능 추가/구현 요청 | `/feature` |
| 버그/오류/안됨 언급 | `/bugfix` |
| 코드 리뷰/점검 요청 | `/review` |
| 배포/빌드/릴리즈 요청 | `/release` |

예시:
- "메모 기능 추가해줘" → `/feature` 자동 실행
- "모바일에서 깨져" → `/bugfix` 자동 실행
- "이 파일 괜찮아?" → `/review` 자동 실행
- "웹 배포하자" → `/release web` 자동 실행

## 작업 원칙

### 코드 작성 전
1. 반드시 관련 파일을 먼저 읽고 기존 패턴 파악
2. 변경 영향 범위 확인 (특히 멀티 테넌트 관련)
3. 기존 패턴과 일관성 유지

### 코드 작성 시
- 과도한 엔지니어링 금지 — 요청된 것만 구현
- 기존 컴포넌트/함수 재사용 우선
- 새 파일/컴포넌트 생성은 명확히 필요할 때만
- 에러 처리: 사용자 경계(입력/API)만 처리, 내부 로직은 신뢰
- 보안: companyId 격리 항상 확인, API 키 하드코딩 금지

### 검증
- Firestore 쿼리 변경 시 companyId 필터 확인
- 모바일/데스크톱 반응형 동작 확인
- Cloud Functions 변경 시 타임아웃 설정 확인 (기본 60초, 장기 작업 540초)

### 금지 사항
- `companyId` 없이 Firestore 쿼리 실행
- 기존 정규화 함수(`normalize()`) 우회
- functions/index.js에 디버그 함수 추가 (별도 파일로)
- 상태 관리 라이브러리 추가 설치
- Tailwind CSS 클래스 사용

## 기능 개발 규칙

### 언어
- 모든 신규 기능의 변수명, 함수명, 컴포넌트명, 파일명은 **영문**으로 작성
- 주석은 한국어 가능, 코드 식별자는 영문 필수
- 예: `메모저장` (X) → `saveMemo` (O), `청소관리` (X) → `CleaningManager` (O)

### 디자인 품질 기준 (대기업 수준)
- **현재 디자인 컨셉 유지**: 다크 슬레이트 사이드바(`#1E293B`), 인디고 포인트(`#4F46E5`), 라이트 배경(`#F1F5F9`)
- **애니메이션 필수**: 모든 UI 인터랙션에 부드러운 전환 적용
  - 등장: `framer-motion`의 `fadeIn` + `slideUp` (duration 0.3~0.5s, ease: easeOut)
  - 호버: scale, shadow, color 전환 (transition 0.2s)
  - 로딩: 스켈레톤 shimmer 또는 pulse 애니메이션
  - 데이터 갱신: 숫자 카운트업, 차트 드로우 애니메이션
- **마이크로 인터랙션**: 버튼 클릭 피드백, 폼 포커스 효과, 상태 변화 시각화
- **타이포그래피**: 계층 구조 명확 (제목/본문/캡션 size 구분), 적절한 letter-spacing
- **카드/컨테이너**: 미묘한 그림자(`box-shadow`), 적절한 border-radius, backdrop-blur 활용
- **색상**: 단색 금지 — gradient, opacity 변화로 깊이감 표현
- **반응형**: 모바일에서도 동일한 퀄리티 유지
