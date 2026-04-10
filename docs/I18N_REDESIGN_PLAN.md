# 다국어 재설계안 v2 (EN 기본 유지 + KO 모드 추가)

## 1. 문서 목적

이 문서는 현재 코드베이스에 **새 기술부채를 만들지 않는 방향**으로 다국어 구조를 재설계하기 위한 기준 문서다.

핵심 목표는 세 가지다.

- 영어 UI를 기본값으로 유지하면서 한국어 UI를 추가한다.
- 번역 기능보다 먼저 **내부 도메인 값**과 **화면 표시값**을 완전히 분리한다.
- 이미 존재하는 레거시 값을 한 번에 갈아엎지 않고, **boundary adapter**로 격리한다.

중요:

- 기존 레거시를 즉시 0으로 만들 수는 없다.
- 대신 **새로운 구조적 부채는 만들지 않고**, 기존 부채는 `normalization` 레이어 뒤로 밀어 넣는 것을 목표로 한다.

---

## 2. 전제와 제약

### 2.1 반드시 지킬 제약

- 영문 UI는 계속 기본값이어야 한다.
- 전역 상태는 프로젝트 규칙에 따라 `UserContext` 중심으로 유지한다.
- 새로운 글로벌 Context는 추가하지 않는다.
- 기존 Firestore 문서를 대규모로 마이그레이션하지 않는다.
- 진행 중인 기능 작업과 충돌할 수 있는 빅뱅 리팩터링은 하지 않는다.

### 2.2 이 문서가 해결하려는 범위

- UI 언어 전환
- 정적 UI 문구 관리
- 건물/객실/플랫폼/상태 label 중앙화
- 날짜/통화/숫자 formatting 일원화
- 레거시 raw value를 안정적으로 다루는 정규화 계층 설계
- 점진적 마이그레이션 순서와 검증 기준 정의

### 2.3 이번 1차 범위에서 하지 않을 것

- DB 기존 값 전체 변경
- 전 화면 동시 번역
- 외부 번역 플랫폼 연동
- 3개 이상 언어 확장 대응
- 사용자 생성 콘텐츠 자동 번역

---

## 3. 현재 진단

### 3.1 현재 코드베이스 상태

- 앱 전반에 별도 i18n 레이어가 없다.
- 사용자 노출 문자열이 컴포넌트 내부에 직접 하드코딩되어 있다.
- 건물/객실 영문 표시 로직이 여러 파일에 중복되어 있다.
- `en-US`, `ja-JP`, 수기 `dayjs().format(...)`이 섞여 있다.
- 일부 화면은 영문, 일부는 한국어, 일부는 혼합 상태다.
- 일부 state와 비교 로직이 영문 표시값을 직접 들고 있다.

### 3.2 지금 가장 위험한 문제

1. 표시값과 내부값이 혼용된다.
2. 언어, locale, timezone 개념이 분리되어 있지 않다.
3. 건물/객실 변환 로직이 화면마다 중복된다.
4. 새로운 문자열이 계속 하드코딩으로 재유입될 위험이 높다.
5. 레거시 raw value와 미래 확장 가능한 stable id가 분리되어 있지 않다.

---

## 4. 핵심 설계 결정

### 4.1 언어와 지역화 설정은 서로 다른 개념으로 다룬다

다음 네 가지를 분리한다.

- `language`: UI 문구 언어. `en | ko`
- `locale`: 날짜/숫자 렌더링용 locale. 언어에서 파생
- `timeZone`: 운영 기준 시간대. 1차는 `Asia/Tokyo` 고정
- `currency`: 표시 통화. 1차는 `JPY` 고정

즉, 한국어 모드라고 해서 운영 기준 시간대가 한국 시간으로 바뀌면 안 된다.

### 4.2 전역 상태는 `UserContext`를 확장하되 호출은 hook으로 감싼다

새 Context는 만들지 않는다.

권장 구조:

- `UserContext`에 `language`, `resolvedLanguage`, `setLanguage`, `languageLoading`, `i18nReady` 추가
- 화면에서는 가능하면 `useUser()`를 직접 뒤섞어 쓰지 말고 `useI18n()` 같은 얇은 wrapper hook을 사용

`useI18n()`은 새 global store가 아니라, `UserContext`를 읽어 가공만 해주는 helper hook이다.

### 4.3 앱 내부에서는 stable id를 사용한다

기술부채를 줄이려면 앱 내부 상태와 비교 로직은 사람이 읽는 문자열이 아니라 **stable id**를 사용해야 한다.

예:

- 건물 id: `arakicho_a`
- 객실 id: `arakicho_a:201`
- 플랫폼 id: `airbnb`
- 상태 id: `confirmed`

### 4.4 기존 DB/API raw value는 boundary에서만 다룬다

현재 DB와 API는 이미 한국어 building key나 기존 raw room 값을 사용하고 있다.

따라서:

- 읽을 때: raw value -> stable id로 정규화
- 화면 state: stable id만 사용
- 쓸 때: stable id -> legacy raw value로 serialize

이 규칙이 없으면 앞으로도 `"Arakicho A"` 같은 표시 문자열이 state에 다시 스며든다.

### 4.5 번역 대상과 비대상을 분리한다

번역 대상:

- 메뉴
- 버튼/라벨/placeholder
- 모달/토스트/confirm
- 화면 제목/섹션 제목
- 시스템 상태 라벨
- 건물/객실 표시명
- 사용자 노출 알림 문구
- 날짜/통화/숫자 formatting 결과

번역 비대상:

- Firestore raw field 값
- API payload key
- 내부 비교 상수
- guest name, memo, review text, note 같은 사용자/외부 데이터
- 개발용 log 문구

---

## 5. 타깃 아키텍처

### 5.1 권장 파일 구조

```text
src/
  i18n/
    index.js
    keys.js
    locale.js
    formatters.js
    dictionaries/
      en.js
      ko.js
  hooks/
    useI18n.js
  utils/
    domainNormalization.js
    displayLabels.js
  constants/
    i18nConstants.js
    navigationItems.js
    buildingData.js
```

### 5.2 파일별 책임

#### `src/i18n/index.js`

- `t(language, key, params?)`
- key lookup
- fallback 처리
- missing key warning 처리

#### `src/i18n/keys.js`

- 번역 키 상수
- 컴포넌트가 raw string key를 임의 생성하지 않도록 기준 제공

#### `src/i18n/locale.js`

- `language -> locale` 매핑
- `DEFAULT_LANGUAGE`
- `APP_TIME_ZONE`
- `APP_CURRENCY`

#### `src/i18n/formatters.js`

- 날짜/월/요일/통화/숫자 출력 전용 함수
- `Intl`와 필요한 `dayjs` wrapper를 중앙화

#### `src/hooks/useI18n.js`

- `useUser()` 기반 wrapper
- `t`, `language`, `resolvedLanguage`, `setLanguage`, formatter 접근을 화면에 간단히 제공

#### `src/utils/domainNormalization.js`

- raw value -> stable id
- stable id -> raw value
- unknown value 처리

#### `src/utils/displayLabels.js`

- stable id -> 다국어 label
- 도메인별 표시명 접근 단일 경로 제공

#### `src/constants/navigationItems.js`

- `App.jsx`와 `NewLayout.jsx`가 공유하는 메뉴 정의
- 메뉴 순서, route, icon key, i18n key를 중앙화

#### `src/constants/buildingData.js`

- 기존 building data의 단일 source of truth 유지
- 단, 1차 리팩터링에서 아래 정보를 함께 담도록 확장
  - `id`
  - `legacyKey`
  - `labels`
  - `order`
  - `rooms`

중요:

- `buildingData.js` 외에 또 다른 building catalog 파일을 만들면 같은 도메인 정보를 두 군데 관리하게 되어 다시 부채가 생긴다.
- 건물/객실 메타데이터는 가급적 `buildingData.js` 하나로 수렴한다.

---

## 6. 도메인 모델 설계

### 6.1 언어와 무관한 stable id

앱 내부에서 사용할 canonical id는 ASCII 기반 slug로 고정한다.

권장 예시:

```js
const BUILDING_IDS = {
  ARAKICHO_A: "arakicho_a",
  ARAKICHO_B: "arakicho_b",
  DAIKYOCHO: "daikyocho",
  KABUKICHO: "kabukicho",
  TAKADANOBABA: "takadanobaba",
  OKUBO_A: "okubo_a",
  OKUBO_B: "okubo_b",
  OKUBO_C: "okubo_c",
  SANO: "sano"
};
```

### 6.2 건물/객실 catalog 구조

권장 구조 예:

```js
export const BUILDING_CATALOG = [
  {
    id: "arakicho_a",
    legacyKey: "아라키초A",
    labels: {
      en: "Arakicho A",
      ko: "아라키초A"
    },
    order: 1,
    rooms: [
      {
        id: "arakicho_a:201",
        legacyKey: "201호",
        labels: {
          en: "Room 201",
          ko: "201호"
        },
        order: 1
      }
    ]
  }
];
```

### 6.3 room id는 건물 포함 composite id로 만든다

객실 번호만으로는 전역 유일성이 보장되지 않을 수 있다.

따라서 room id는 반드시 건물 id를 포함한다.

- 좋은 예: `arakicho_a:201`
- 나쁜 예: `201`

### 6.4 플랫폼/상태 id

플랫폼과 상태는 이미 비교값으로 적합한 형태가 많으므로 그대로 canonical id로 사용한다.

- 플랫폼: `airbnb`, `booking`, `expedia`, `agoda`, `direct`
- 상태: `confirmed`, `cancelled`, `blackout`, `inquiry`

### 6.5 sentinel 상수

표시 문자열이 아니라 내부 sentinel 상수를 사용한다.

권장:

```js
export const ALL_BUILDINGS = "__ALL_BUILDINGS__";
export const ALL_ROOMS = "__ALL_ROOMS__";
export const ALL_MEMBERS = "__ALL_MEMBERS__";
export const ALL_PLATFORMS = "__ALL_PLATFORMS__";
export const ALL_STATUSES = "__ALL_STATUSES__";
```

실제 화면 label은 번역으로 표시한다.

### 6.6 정렬 규칙

정렬은 번역 label 기준이 아니라 **도메인 정의 순서** 기준으로 한다.

이유:

- 언어가 바뀌면 알파벳/한글 정렬 결과가 달라진다.
- 운영 화면의 익숙한 순서를 유지해야 한다.

즉:

- 건물 순서는 `order` 또는 기존 `BUILDING_ORDER`
- 메뉴 순서는 `navigationItems`
- 상태/플랫폼 순서는 중앙 상수

---

## 7. 정규화와 직렬화 규약

### 7.1 왜 필요한가

현재 코드에는 다음이 섞여 있다.

- legacy raw 한국어 값
- 영문 표시값
- 일부 소문자 비교용 값

이 상태에서 바로 i18n만 붙이면 화면이 바뀔 때마다 값 비교가 깨진다.

### 7.2 필수 함수

```js
normalizeBuildingId(input)
normalizeRoomId({ buildingInput, roomInput })
normalizePlatformId(input)
normalizeStatusId(input)

toLegacyBuildingValue(buildingId)
toLegacyRoomValue(roomId)
```

### 7.3 읽기 규약

- Firestore/API/raw import로 들어온 값은 즉시 정규화한다.
- UI state에는 stable id만 저장한다.
- select, filter, tab, modal state도 stable id만 사용한다.

### 7.4 쓰기 규약

- 기존 API/DB가 legacy raw 값을 기대하는 곳은 serialize 해서 보낸다.
- 새 코드에서 translated label을 저장하거나 전송하지 않는다.

### 7.5 unknown 값 처리

정규화되지 않는 값이 들어올 수 있다.

처리 원칙:

- 화면이 죽으면 안 된다.
- unknown 값은 `null` 또는 `unknown` sentinel로 처리하고, raw value를 보존한다.
- 개발 환경에서는 one-time warning을 남긴다.
- 사용자 화면에는 가능한 범위에서 raw value fallback을 보여준다.

예:

```js
{
  id: null,
  rawValue: "Arakicho A",
  unresolved: true
}
```

### 7.6 점진적 마이그레이션 브리지

1차 구현에서는 기존 코드와 충돌을 줄이기 위해 다음 브리지가 필요하다.

- 과거 state 기본값 `"Arakicho A"` -> `normalizeBuildingId("Arakicho A")`
- 과거 `"전체"` / `"All Properties"` -> `ALL_BUILDINGS`
- 과거 raw room string -> `normalizeRoomId(...)`

즉, 문서상 원칙만 선언하는 것이 아니라 **기존 혼합 값을 흡수하는 adapter**를 먼저 둔다.

---

## 8. 번역 런타임 설계

### 8.1 `t()` 기본 계약

```js
t(language, key, params?)
```

동작 순서:

1. 요청 언어 사전 조회
2. 없으면 `en` 사전 fallback
3. 그래도 없으면 key 자체 반환

### 8.2 missing key 정책

개발 환경:

- key 누락 시 one-time console warning
- UI는 `en` fallback 또는 key 출력

운영 환경:

- 사용자 화면은 깨지지 않아야 한다
- `en` fallback 우선
- 최종 fallback은 key 문자열

중요:

- missing key 때문에 빈 문자열을 반환하면 안 된다.

### 8.3 키 설계 원칙

좋은 예:

```text
common.save
common.cancel
nav.calendar
nav.revenue
sync.quick
profile.language
calendar.checkIn
calendar.checkOut
```

나쁜 예:

- `"Save"`를 key로 사용
- `"Quick Sync"`를 key로 사용
- 컴포넌트별 즉흥 key 작성

### 8.4 interpolation 원칙

```js
t(language, "calendar.selectedSummary", {
  rooms: selectedRooms.length,
  dates: selectedDates.length
});
```

### 8.5 plural 기술부채 최소화 전략

1차에서는 ICU plural을 직접 구현하지 않는다.

대신 copy를 아래처럼 설계한다.

- 영어: `Selected rooms: {rooms}`
- 한국어: `선택 객실: {rooms}`

즉, 문장 구조를 중립적으로 설계해서 복잡한 plural 부채를 줄인다.

### 8.6 번역 대상의 명확한 경계

번역해야 하는 것:

- 시스템이 소유한 정적 UI copy
- 시스템이 소유한 도메인 label
- 시스템이 소유한 상태 문구

번역하지 말아야 하는 것:

- 사용자 입력 메모
- 외부 리뷰 본문
- API가 그대로 준 사용자 데이터
- 예약자 이름

---

## 9. formatting 설계

### 9.1 locale, timezone, currency 고정 규칙

```js
DEFAULT_LANGUAGE = "en"
LANGUAGE_TO_LOCALE = {
  en: "en-US",
  ko: "ko-KR"
}
APP_TIME_ZONE = "Asia/Tokyo"
APP_CURRENCY = "JPY"
```

중요:

- 언어가 `ko`여도 timezone은 `Asia/Tokyo`
- 언어가 `en`이어도 통화는 `JPY`

### 9.2 formatter 함수 목록

권장 함수:

```js
formatCurrencyJPY(value, language)
formatNumber(value, language)
formatShortDate(value, language)
formatMonthYear(value, language)
formatWeekday(value, language)
formatDateTime(value, language)
formatDateRange(start, end, language)
```

### 9.3 구현 원칙

- 사용자 노출 날짜/숫자/통화는 반드시 formatter 경유
- 화면에서 직접 `toLocaleDateString('en-US')` 호출 금지
- 화면에서 직접 `Intl.NumberFormat('ja-JP', ...)` 호출 금지
- `dayjs(...).format('MMM D')` 같은 수기 포맷 신규 추가 금지

### 9.4 날짜 처리 주의점

- 날짜 표시 기준은 운영 시간대 `Asia/Tokyo`
- 날짜와 시간이 같이 있는 값은 formatter 내부에서 명시적으로 `timeZone`을 적용
- 날짜만 의미하는 값은 가능한 한 formatter에서 일관된 parsing 규칙을 사용

### 9.5 포맷과 번역을 섞지 않는다

예:

- `currency`는 formatter가 담당
- `Check-in` 같은 단어는 번역 사전이 담당

한 함수가 둘 다 억지로 처리하지 않는다.

---

## 10. 상태 저장과 초기 부팅 설계

### 10.1 저장 위치

- Firestore: `users/{uid}.language`
- localStorage: `ui.language`

### 10.2 초기 결정 순서

첫 렌더 플리커를 줄이기 위해 순서를 명확히 정의한다.

1. 앱 시작 시 localStorage를 동기적으로 읽어 임시 언어 결정
2. localStorage가 없으면 `en`
3. 로그인 후 Firestore 사용자 문서를 읽어 최종 언어 확정
4. Firestore 값이 localStorage와 다르면 UI와 localStorage를 동기화

### 10.3 필요한 상태

- `language`: 사용자가 저장한 선호 언어
- `resolvedLanguage`: 현재 렌더에 쓰는 실제 언어
- `languageLoading`: Firestore 기반 선호값 확인 중 여부
- `i18nReady`: 공통 UI 렌더 가능한 상태 여부

### 10.4 언어 변경 시 동작

1. UI 즉시 반영
2. localStorage 즉시 저장
3. Firestore 저장 시도
4. Firestore 실패 시 UI는 되돌리지 않음
5. 이후 재로그인/재접속 시 재동기화

### 10.5 오프라인/실패 처리

- Firestore 저장 실패로 언어 토글이 막히면 안 된다.
- 저장 실패 시 localStorage 값으로 계속 동작
- 필요 시 toast는 로컬라이즈된 문구로 노출

---

## 11. 서버/클라이언트 메시지 계약

### 11.1 왜 필요한가

UI만 번역해도 서버가 영어 문장을 그대로 던지면 KO 모드에서 영어가 다시 보인다.

### 11.2 권장 계약

서버/함수/내부 API는 가능하면 아래 형태를 반환한다.

```js
{
  ok: false,
  code: "SYNC_FAILED",
  params: { provider: "Beds24" },
  debugMessage: "Beds24 returned 500"
}
```

클라이언트는:

- `code` -> 번역 키 매핑
- `params` -> interpolation
- `debugMessage` -> 개발/로그용

### 11.3 raw message만 있는 경우

레거시 응답에는 code가 없을 수 있다.

이 경우 정책:

- 사용자에게는 로컬라이즈된 generic 문구 우선 노출
- 필요 시 raw message는 상세 정보로 부가 노출
- raw message 자체를 번역하려고 시도하지 않는다

### 11.4 1차 범위 판단

1차에서는 모든 서버 응답을 바꾸지 않는다.

대신:

- 새로 손대는 영역부터 `code` 중심으로 전환
- 기존 raw message는 generic fallback으로 감싼다

---

## 12. UI 통합 전략

### 12.1 언어 설정 진입점

1차:

- `MyProfile`에 language setting 추가

2차:

- `NewLayout` 사용자 영역에 quick toggle 또는 진입 링크 검토

### 12.2 메뉴 구조 중앙화

`App.jsx`와 `NewLayout.jsx`의 메뉴 정의는 하나의 중앙 config를 공유한다.

메뉴 항목은 label 문자열이 아니라 다음 형태로 관리한다.

```js
{
  id: "calendar",
  route: "/calendar",
  titleKey: "nav.calendar",
  icon: "calendar"
}
```

### 12.3 select와 filter 패턴

옵션은 항상 아래처럼 구성한다.

```js
{
  value: buildingId,
  label: getBuildingLabel(buildingId, language)
}
```

금지:

- `value`에 `"Arakicho A"` 저장
- `value`에 `"전체"` 저장

### 12.4 화면 state 설계 규칙

state에는 다음만 저장한다.

- stable id
- boolean
- number
- raw data object

state에 translated label을 저장하지 않는다.

---

## 13. 구현 방식 결정

### 13.1 Option A. `react-i18next`

장점:

- 생태계 성숙
- plural/interpolation 기능 강함
- 장기 확장성 좋음

단점:

- 현재 프로젝트 규칙과 도입 비용이 큼
- provider 패턴이 추가됨
- 현시점 가장 큰 문제인 도메인 정규화까지 해결해주지는 않음

### 13.2 Option B. 경량 커스텀 i18n + 정규화 레이어

장점:

- 현재 `UserContext` 구조와 잘 맞음
- 필요한 문제를 정확히 겨냥함
- 점진적 도입에 유리
- stable id / legacy raw value adapter를 함께 설계 가능

단점:

- 고급 plural 기능은 직접 관리해야 함
- 언어가 3개 이상 늘면 재검토 필요

### 13.3 권장 결론

1차는 **Option B**를 채택한다.

이유:

- 지금의 핵심 문제는 번역 프레임워크 부재보다 **정규화와 중앙화 부재**
- 먼저 구조를 안정화해야 기술부채가 줄어든다

단, 아래 조건이 오면 `react-i18next` 재검토:

- 지원 언어 3개 이상
- 외부 번역 워크플로 필요
- plural/ICU 요구 증가

---

## 14. 단계별 마이그레이션 계획

### Phase 0. 설계 확정

- 본 문서 승인
- stable id 규칙 확정
- sentinel 목록 확정
- 번역 대상/비대상 확정

### Phase 1. 기반 레이어 구축

- `UserContext` 확장
- `i18n` 유틸 생성
- `useI18n()` 생성
- `i18nConstants.js` 생성
- formatter 생성

완료 기준:

- 앱 어디서든 `language`와 `t()`를 안전하게 읽을 수 있음

### Phase 2. 도메인 정규화 레이어 구축

- `buildingData.js`를 stable id 중심으로 확장
- `domainNormalization.js` 생성
- `displayLabels.js` 생성
- legacy raw value -> stable id adapter 도입

완료 기준:

- 건물/객실/플랫폼/상태를 문자열 비교 없이 stable id로 다룰 수 있음

### Phase 3. 공통 쉘 전환

우선 대상:

- `src/App.jsx`
- `src/components/NewLayout.jsx`
- `src/components/LoginScreen.jsx`
- `src/components/SyncManager.jsx`
- `src/components/MyProfile.jsx`

완료 기준:

- 메뉴/공통 버튼/공통 모달/프로필 설정이 EN/KO 전환 가능
- 메뉴 정의가 중앙화됨

### Phase 4. 중형 화면 전환

우선 대상:

- `RevenueDashboard.jsx`
- `TodaySummaryDashboard.jsx`
- `OccupancyRateDashboard.jsx`
- `RoomPerformanceDashboard.jsx`
- `ReviewsDashboard.jsx`
- `MemberManagement.jsx`

완료 기준:

- 주요 운영 화면에서 직접 하드코딩 문구 제거
- 날짜/통화 포맷이 공통 formatter 사용

### Phase 5. 고위험 화면 전환

최종 대상:

- `BuildingCalendar.jsx`

이유:

- 문자열 수가 많다
- 필터/selection/modal/gap 관련 state가 많다
- 진행 중 작업과 충돌 가능성이 크다

완료 기준:

- translated label이 state/비교 로직에 남아 있지 않다

### Phase 6. 서버 메시지와 레거시 누락 보강

- 새로 손대는 API 응답부터 `code` 기반 메시지 계약 적용
- generic fallback 메시지 적용
- unknown normalization 로그 정리

### Phase 7. QA와 재유입 방지

- EN/KO 교차 점검
- 모바일/데스크탑 점검
- localStorage/Firestore 동기화 점검
- missing key/unknown id 점검
- 하드코딩 문자열 재유입 검사

---

## 15. 고위험 포인트와 대응

### 15.1 표시값 비교

위험:

- 언어 전환 후 분기 실패

대응:

- 비교/필터/저장에는 stable id만 사용

### 15.2 timezone 누락

위험:

- 체크인/체크아웃 날짜가 하루 밀려 보일 수 있음

대응:

- 사용자 노출 날짜 formatter에 `Asia/Tokyo` 강제

### 15.3 unknown raw value

위험:

- 신규/예외 데이터 유입 시 화면 오류

대응:

- normalization fallback과 one-time warning 구현

### 15.4 하드코딩 재유입

위험:

- 몇 주 뒤 다시 영어/한국어 문자열이 컴포넌트에 섞임

대응:

- review checklist
- grep 점검
- 신규 공통 문구는 반드시 `keys.js` 추가 후 사용

### 15.5 메뉴 중복 정의

위험:

- `App`와 `NewLayout`가 서로 다른 label/route를 보여줌

대응:

- `navigationItems.js` 단일 source of truth

### 15.6 모바일 라벨 길이 증가

위험:

- 한국어 라벨 길이로 버튼/탭 깨짐

대응:

- 짧은 모바일 label 허용
- 줄바꿈/ellipsis 정책 사전 정의

---

## 16. 코딩 규칙과 가드레일

### 16.1 반드시 지킬 것

- 비교/저장/API/쿼리에는 translated label 사용 금지
- UI 문구는 `t()` 또는 display helper 경유
- 날짜/통화/숫자는 formatter 경유
- select/filter value는 stable id 사용
- 메뉴 정의는 중앙 config 사용

### 16.2 금지

- `"전체"` / `"All Properties"` 같은 label을 로직 분기에 직접 사용
- 컴포넌트별 별도 building translation map 재정의
- `language` 상태를 로컬 state로 분산 저장
- 화면에서 직접 `toLocaleDateString('en-US')` 호출
- 화면에서 직접 `Intl.NumberFormat('ja-JP', ...)` 호출
- 화면에서 translated label을 state에 저장

### 16.3 허용

- 1차에서는 개발 로그 영어 유지 가능
- 점진적 전환 동안 일부 화면만 한국어 대응 상태 가능
- 레거시 API raw message는 generic localized wrapper로 감싸서 표시 가능

### 16.4 리뷰 체크리스트

PR 리뷰 시 아래를 확인한다.

1. 새 UI 문구가 dictionary/keys를 통하는가
2. state와 `value`에 stable id만 저장되는가
3. formatter를 우회한 날짜/금액 표시가 없는가
4. `buildingData.js` 외 중복 매핑이 생기지 않았는가
5. unknown value fallback이 화면을 깨지 않게 처리되는가

### 16.5 권장 자동 점검

추후 아래 점검 스크립트를 추가하는 것을 권장한다.

- `check:i18n`
- `check:hardcoded-ui`
- `check:formatters`

스크립트 목적:

- 하드코딩 문자열 재유입 방지
- 금지된 date/number formatting 패턴 탐지
- `All Properties`, `전체` 같은 label 기반 비교 탐지

---

## 17. 테스트 전략

### 17.1 단위 테스트 우선 대상

- `t()` fallback
- `normalizeBuildingId()`
- `normalizeRoomId()`
- `toLegacyBuildingValue()`
- `getBuildingLabel()`
- formatter 함수

### 17.2 수동 QA 시나리오

1. EN 기본 진입 확인
2. KO로 변경 후 즉시 UI 반영 확인
3. 새로고침 후 KO 유지 확인
4. 재로그인 후 Firestore 값 복원 확인
5. 오프라인/저장 실패 시 localStorage fallback 확인
6. Building/Room filter가 언어 전환 전후 동일하게 동작하는지 확인
7. 모바일에서 메뉴/탭 라벨 깨짐 없는지 확인

### 17.3 회귀 포인트

- 예약/매출/리뷰 등 실제 데이터 필터링 결과
- BuildingCalendar selection/gap 관련 분기
- 알림/토스트/confirm 문구
- 로그인 전후 공통 레이아웃

---

## 18. 완료 기준

다음 조건을 만족하면 1차 완료로 본다.

- `UserContext`에서 언어 조회/변경 가능
- `useI18n()`으로 공통 접근 가능
- `buildingData.js`가 stable id + legacy raw value + label 정보를 단일 관리
- 메뉴/공통 레이아웃/로그인/동기화/프로필이 EN/KO 전환 가능
- 주요 운영 화면이 formatter와 display helper를 공통 사용
- translated label이 state/비교 로직에 남아 있지 않음
- 하드코딩 문자열 신규 재유입 방지 규칙이 문서화되고 리뷰에 적용됨
- `BuildingCalendar.jsx` 전환 시 기존 gap 관련 작업과 충돌하지 않도록 후순위 유지

---

## 19. 권장 실행 순서

1. `UserContext`와 `useI18n()` 설계 확정
2. `i18nConstants.js`, `i18n/index.js`, `formatters.js` 추가
3. `buildingData.js` stable id 구조 확장
4. `domainNormalization.js`, `displayLabels.js` 추가
5. `navigationItems.js` 중앙화
6. `MyProfile` 언어 설정 추가
7. `App` / `NewLayout` / `LoginScreen` / `SyncManager` 전환
8. 중형 대시보드 전환
9. `BuildingCalendar.jsx` 최종 전환
10. 서버 메시지 계약과 점검 스크립트 보강

---

## 20. 최종 판단

- **가능 여부**: 가능
- **권장 방식**: stable id + normalization + 경량 i18n 레이어
- **비권장 방식**: 전 화면 일괄 번역, 표시 문자열 기반 상태 관리
- **현재 기준 난이도**: 상
- **성공의 핵심**: 번역 이전에 **정규화 계층**과 **단일 source of truth**를 먼저 세우는 것

이 문서는 구현 전 기준 문서이며, 이후 작업은 이 순서를 따르는 것을 기본 원칙으로 한다.
