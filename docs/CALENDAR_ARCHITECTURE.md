# 캘린더 기능 — 구조/설계 정보 수집 (유지보수용)

> 수집일: 2026-09-15 / 목적: 캘린더 유지보수 착수 전 현황 파악 (코드 수정 없음)
> 기준 커밋: `b315a9f` + 워킹트리 미커밋 변경 존재 (BuildingCalendar.jsx +433 / functions/index.js +1618 라인)

---

## 1. 파일 맵

### 프론트엔드
| 파일 | 라인 | 역할 |
|------|------|------|
| `src/components/BuildingCalendar.jsx` | **10,654** | 캘린더 전체 (단일 파일, 모달 5개 + 메인 컴포넌트 포함) |
| `src/App.jsx:19, 528, 2905` | — | import / 사이드바 메뉴(`/calendar`, 🗓️ Calendar) / 라우트 |
| `src/constants/buildingData.js` | 65 | `BUILDING_DATA`, `BUILDING_NAMES_EN`, `BUILDING_ORDER`, `EXCLUDED_BUILDING_UI`, `ACTIVE_BUILDING_ORDER` |
| `src/utils/priceAttribution.js` | 380 | `buildPriceAttributionResult`, `getReservationIdentityKey`, `parseReservationCreatedAtMs` |
| `src/contexts/UserContext.jsx` | — | `companyId` 공급 (멀티테넌트 필터의 유일 소스) |
| `src/components/PriceChangeHistory.jsx` | — | 캘린더와 같은 `price_change_logs` 컬렉션을 읽는 별도 화면 (직접 결합 없음) |

캘린더 관련 파일은 **`BuildingCalendar.jsx` 단 하나**. 별도 CSS 파일 없음(전부 inline style), 별도 hook/util 분리 없음(`priceAttribution.js` 제외).

### 백엔드 (functions/index.js — 8,673줄)
| 함수 | 라인 | 타입 | 타임아웃/메모리 | 캘린더에서의 역할 |
|------|------|------|------------------|------------------|
| `getCachedPrices` | 4758 | onRequest | 60s / 2GiB / minInstances 1 | **가격 조회 (읽기 전용, Beds24 직접 호출 안 함)** |
| `setRoomPrices` | 4493 | onRequest | 120s / 1GiB | 가격 변경 → `beds24_price_jobs` **큐 생성만** |
| `triggerPriceJobNow` | 4587 | onRequest | 540s / 16GiB | 큐잉된 job 즉시 실행 (프론트가 4초마다 최대 5회 kick) |
| `getPriceJobStatus` | 5992 | onRequest | 60s | job 폴링 폴백 (onSnapshot 실패 시) |
| `setMinStay` | 6055 | onRequest | 300s / 1GiB | Gap 모드 minStay 일괄 적용 (동기 처리, job 아님) |
| `createBooking` | 7150 | onRequest | 120s | 수동 예약/블록 생성 |
| `updateBooking` | 7354 | onRequest | 120s | 예약 상세 수정 |
| `cancelBooking` | 7536 | onRequest | 120s | 예약 취소 / 블록 삭제 |
| `scheduledPriceJobWorker` | 5930 | onSchedule | **every 1 min** / 540s / 16GiB | queued job FIFO 처리 (1회 최대 5건 / 45초) |
| `scheduledBeds24PriceSync` | 3338 | onSchedule | **every 15 min** | 전체 가격 캐시 동기화 (수동 job 있으면 양보) |
| `scheduledBeds24Sync` | 3307 | onSchedule | **매시 5분** (JST) | 예약 재대사 |
| `scheduledPriceJobCleanup` | 6029 | onSchedule | every 24h | 7일 지난 job 문서 삭제 |
| `priceWebhook` | 6446 | onRequest | 300s / 16GiB | Beds24 → 가격/재고 변경 수신, 캐시 무효화 |
| `beds24BookingWebhook` | 6740 | onRequest | 120s | Beds24 → 예약 변경 수신 |

---

## 2. 데이터 모델

### Firestore 컬렉션 (캘린더가 직접 읽는 것)
```
reservations/{id}
  companyId, building, room, roomId, arrival, departure, status,
  platform|referer|channel, guestName, totalPrice/price/netRevenue/commission,
  isExternalInventoryBlock, isInventoryOverrideBlock, lastEventAt, createdAt, modifiedAt
  status ∈ confirmed | cancelled | blackout | maintenance | inquiry

price_change_logs/{id}      # 읽기 전용(캘린더), 쓰기는 백엔드
  companyId, building, room, timestamp, origin, worker, dateFrom, ...

beds24_price_jobs/{jobId}   # onSnapshot 구독
  companyId, building, roomIds[], roomUpdates[], status, progress{processed,total,results},
  failedRoomIds[], coalescedIntoJobId, supersededByJobId, createdAt/startedAt/completedAt
  status ∈ queued | processing | completed | failed | partial_failed

price_sync/{building}                      # 백엔드 전용 (프론트는 getCachedPrices 경유)
  lastSync, invalidatedRoomIds[], reservationInvalidatedRoomIds[], pendingInvalidationCount
price_sync/{building}/rooms/{roomId}
  roomName, roomId, dates: { "YYYYMMDD": { p1, p2, p3, m, mx, na, ov, lm } }

sync_status/price_sync_lock                # 가격 동기화 전역 락
```

### 날짜 셀 데이터 (`dates[YYYYMMDD]`) — 축약 키
| 키 | 의미 |
|----|------|
| `p1` | price1 = **Airbnb 가격** |
| `p2` | price2 = **Booking.com 가격** |
| `p3` | price3 (옵션, `preferAirbnbPrice3` 시 p1 대체) |
| `m` | minStay — **50 이상(`INACTIVE_MINSTAY_THRESHOLD`)이면 비활성 roomId로 판정** |
| `mx` | maxStay |
| `na` | numAvail (0이면 예약 불가) |
| `ov` | override — `"blackout"`이면 Beds24 인벤토리 블록 |
| `lm` | lastModInfo = `{ u, t, o, n, s, ts }` (u=작업자, t="MM-DD HH:mm", o=이전가, n=신규가, s=소스, ts=epoch ms) |

**`lm.s` 규칙 (확정, 변경 금지)** — `"beds24"` → 빨강 `#EF4444` dot / 그 외(system·legacy) → 파랑 `#2563EB`. 회색 dot 없음.
`s`/`ts`는 신규 저장분부터 존재. legacy 비교는 `pickNewerLm()`이 ts 유무에 따라 3단계로 처리 (`BuildingCalendar.jsx:203`).

### Firestore 복합 인덱스 (캘린더 의존)
```
reservations: building, companyId, status, departure
reservations: building, companyId, status, arrival
reservations: building, companyId, status, arrival, departure   ← qLong용
reservations: companyId, status, departure / arrival
price_change_logs: companyId, timestamp DESC
beds24_price_jobs: status, createdAt / status, companyId, building
```

---

## 3. 객실 ID 구조 (핵심 난점)

`BuildingCalendar.jsx:13` `BUILDING_DATA` — 건물별 **객실명** 배열 (UI 행 기준)
`BuildingCalendar.jsx:31` `BUILDING_ROOMS` — 건물별 `{ roomId, name }` 배열 (Beds24 API 기준, **백엔드와 수동 동기화**)

> ⚠️ **파일 내 중복 정의**: `BUILDING_DATA`가 `src/constants/buildingData.js`에도 있으나 캘린더는 자체 로컬 사본을 사용한다(오쿠보/사노 객실명이 다름 — 캘린더는 `"오쿠보A동": ["오쿠보A"]`, constants는 `"오쿠보": ["A동","B동","C동"]`). constants에서는 `BUILDING_NAMES_EN` / `EXCLUDED_BUILDING_UI` / `ACTIVE_BUILDING_ORDER`만 import.

### 듀얼 roomId (1 객실명 ↔ N roomId)
아라키초A·가부키초·오쿠보C 등은 한 객실에 roomId가 2~3개 매핑됨 (채널별 분리 계정). 날짜별로 **어느 roomId가 "활성"인지**를 `m`(minStay) 값으로 판정:

```
getMinStayForRoomIdDate(roomId, date)   → dates[key].m
getActiveUnitInfosForDate(room, date)   → 1 ≤ m < 50 인 unit만 (값 없으면 보수적으로 비활성)
getDisplayUnitInfosForDate(room, date)  → active 없으면 데이터 있는 unit → 그래도 없으면 전체
getCellMinStayForDate(room, date)       → display unit들 중 최소 m
pickPreferredRoomInfo(building, room, infos)  → PREFERRED_DUAL_ROOM_IDS 우선
   PREFERRED_DUAL_ROOM_IDS = { "가부키초__803호": "648398", "아라키초A__501호": "502229" }
```
백엔드도 대응 로직 보유: `shouldMergeArakichoA501PriceRoomIds` / `mergeArakichoA501PriceRoomIds` (`functions/index.js:4508`).

---

## 4. BuildingCalendar.jsx 파일 구조

### 모듈 스코프 (1~2898)
| 라인 | 심볼 |
|------|------|
| 13 / 31 | `BUILDING_DATA` / `BUILDING_ROOMS` |
| 98~144 | `API_BASE_URL`, 세션스토리지 가격 캐시 (`readPriceCacheSession`/`write`/`clear`, TTL **5분**, 키 `stayAri.priceCache.v1.{companyId}.{building}`) |
| 145~152 | `INACTIVE_MINSTAY_THRESHOLD=50`, `PREFERRED_DUAL_ROOM_IDS`, `PRICE_INTERVENTION_LIMIT=400`, `CALENDAR_NUMERIC_FONT_FAMILY`, `EMPTY_CELL_STATE` |
| 154 | `buildReservationSignature()` — 26개 필드 기반 변경 감지 시그니처 (불필요 리렌더 차단) |
| 189~252 | `pickPreferredRoomInfo`, `pickNewerLm`, `normalizeRoomSourceKey`, `toYmd`, `parseLogTimestampMs`, `getLogSource` |
| **253** | `PriceSettingModal` (~790줄) — 직접입력/퍼센트 조정 2모드, 2-step |
| 1046~1180 | 표시 헬퍼: `getBuildingNameEN`, `getRoomNameEN`, `PLATFORM_COLORS`, `getPlatformColor`, `formatPrice`, `formatCalendarPriceShort`, `getMergedRoomChannelPrices`, `BEDS24_DETAIL_*` 레이아웃 상수 |
| **1248** | `ReservationDetailModal` (~460줄) — 예약 상세/수정/취소 |
| **1711** | `MonthPickerModal` |
| **1867** | `ManualBookingModal` (~730줄) — 수동 예약/블록 생성 + 낙관적 블록 |
| 2621~2896 | 통계 계산 순수함수: `calculateBuildingMetrics`, `calculateBuildingMetricsForRange`, `calculateCommissionSummary`, `calculateArrivalCountSummary`, `parseMoneyAmount`, `getReservationChannelKey` |

### 메인 컴포넌트 `BuildingCalendar()` (2899~10654)
- **State ~60개, Ref ~25개** (전부 로컬 `useState` — CLAUDE.md 규칙대로 추가 Context/상태 라이브러리 없음)
- **useMemo/useCallback/useEffect 총 149개**
- 2899~3200 : state/ref 선언 + 파생 플래그
- 3176~3255 : 셀 선택 큐 (rAF 배치 + `selectionGenerationRef` stale flush 가드)
- 3255~3510 : **price job 생명주기** (kick / onSnapshot / 폴링 폴백 / 토스트)
- 3520~3900 : 날짜·객실 해석 계층 (`displayDays`→`stableDisplayDays`→`gapCoverageDays`, roomId 활성 판정)
- 3896~4300 : 네비게이션·모드 토글·선택 핸들러
- 4306~4520 : **`fetchPrices`** + 가격 재조회 트리거 effect 4종
- 4525~4630 : `fetchBlockData` (블록 관리 모달)
- 4632~4970 : **예약 조회/실시간 구독**
- 4973~5700 : **파생 인덱스 계층** (아래 §6)
- 5682~6000 : 통계 memo (`analysis`, `allBuildingMetrics`, `priceStats`, `priceInsightSummary`, `commissionSummary`, `futureVacancySummary` …)
- 6007~6258 : `renderReservationBar` (예약 바 렌더러, ~240줄)
- 6279~10654 : **JSX 렌더** (모바일 뷰 6364~6720 / 데스크톱 6720~10654)

---

## 5. 예약 데이터 흐름

### 단일 건물 = 실시간 구독 (`onSnapshot` ×3), 전체 보기 = `getDocs` 1회
`useEffect` (4727) 내부 `startSubscription()`:

| 쿼리 | 조건 | 커버 범위 |
|------|------|----------|
| **Q1** | `departure >= start && departure <= end` | 기간 내 체크아웃 |
| **Q2** | `arrival >= start && arrival <= end` | 기간 내 체크인 |
| **qLong** | `arrival <= start && departure >= end` | 기간 전체를 가로지르는 장기 체류 |

- 세 스냅샷을 `Map`으로 병합(qLong 베이스 → Q1/Q2 덮어쓰기) 후 **1 rAF로 묶어** `applyFilter()` 1회 호출
- `buildReservationSignature()` 비교로 동일하면 `setReservations` 생략
- 조회 범위는 앞뒤 **±1일 확장**(`extendedRange`) — 경계 바 렌더 보정
- 에러 복구: 지수 백오프 5회(2s→32s) → `fetchReservations()` 폴백 → 60초마다 재구독 루프
- 인덱스 누락 폴백: `qLong` → `getDocs` 1회 보완 / `Q2` → `getDocs` + 60초 갱신 루프
- `showCancelled` 토글이 쿼리의 `status in [...]`을 바꿔 **구독을 재생성**함

### 뷰 범위
- `monthly`: 해당 월 1일 ~ 말일
- `rolling`: `rollingStartDate` ~ +30일
- `전체`: `portfolioAnalysisRange` (커밋된 date from/to)

---

## 6. 가격 데이터 흐름

```
[읽기]
  fetchPrices(force, building, onSettled)
    → priceCacheRef(메모리)  → sessionStorage(5분 TTL)  → POST getCachedPrices
    → roomPrices  { [roomId]: { roomName, roomId, dates: {YYYYMMDD: {...}} } }

  가드: AbortController 취소, requestId stale 응답 무시,
        동일 requestKey(`building|from|to`) 중복 요청 차단,
        isMountedRef, hasVisiblePriceCoverage(화면 범위 전체가 na/ov 포함해 커버되는지)

  재조회 트리거:
    ① calendarBuilding 변경
    ② priceReservationSignature 변경 → 300ms 후 force (+ consistencyPending=true)
    ③ reservationInvalidatedRoomIds 존재 → 30초 후 force
    ④ price job completed → refreshCompletedPriceJob (최대 4회 × 3초 재시도)

[쓰기]
  PriceSettingModal → POST setRoomPrices → beds24_price_jobs 문서 생성(queued) + jobId 반환
    → 프론트: pendingPriceJobs[jobId] 등록 + pendingCells 낙관적 표시
    → onSnapshot(beds24_price_jobs/{jobId}) 구독
       └ 실패 시 usePollingFallback → getPriceJobStatus 4초 폴링 (최대 120회 ≒ 8분)
    → 4초마다 triggerPriceJobNow kick (최대 5회)
    → scheduledPriceJobWorker(1분 주기)가 FIFO 처리, 15분 stuck job 자동 re-queue
    → completed → fetchPrices(force) → pendingCells 해제 + 토스트

  Gap 모드 → POST setMinStay (동기, 낙관적 패치 + 실패 시 structuredClone 백업 롤백)
```

---

## 7. 파생 인덱스 계층 (렌더 성능 핵심)

```
reservations (raw)
  ├─ visibleReservations              isInventoryOverrideBlock 제외
  ├─ externalInventoryBlocks          ov==="blackout" 연속 구간 → 가상 blackout 예약 생성
  ├─ visibleOptimisticInventoryBlocks 실제 데이터 도착 전 낙관적 블록 (중복 시 자동 제거)
  └─ calendarReservations = 위 3개 병합
        └─ calendarReservationIndex { byRoom, byRoomUnit, visibleByRoom, visibleByRoomVisual }
              ├─ roomAllReservationsMap        (gap 계산용, cancelled 제외)
              ├─ roomAllReservationsByUnitMap  (듀얼 roomId 단위)
              ├─ roomReservationsMap           (계산용)
              └─ roomReservationsMapVisual     (렌더용 — showCancelled에 따라 반전)
                    └─ roomDateStateIndex  { "room__date": {hasReservation, hasBlockingReservation, ...} }
                          ├─ isCellOccupied / isCellPriceBlocked
                          ├─ gapInfoByCellKey → gapCellSet
                          ├─ calendarCellStateMap   ← 셀 렌더가 O(1)로 조회
                          └─ calendarPriceCellMap   ← 가격/minStay/lm O(1) 조회
```
성능 패턴: dayjs 객체 생성 회피(`"YYYY-MM-DD"` 문자열 비교로 시간 순서 판정), rAF 배치, signature 비교, `EMPTY_CELL_STATE`/`EMPTY_PRICE_CELL` 공유 객체.

### Gap 판정 (`getCheckInGapInfo`, 5360)
"체크인 가능하나 **1박만** 팔 수 있는데 minStay가 2인 셀" = 빨간 Gap.
- 단일 객실은 행 단위 공실 shortcut, 듀얼 객실은 roomId 해석 후 판정
- `cellMinStay !== 2`면 즉시 non-gap
- `consistencyPending` 또는 `invalidatedRoomIds` 포함 시 **경고 억제** (캐시 stale 오탐 방지)
- `isSegmentEntry`: 직전 날짜가 `blocked` 또는 `past`일 때만 gap 인정

---

## 8. UI 모드 / 뷰 매트릭스

| 축 | 값 |
|----|-----|
| 디바이스 | 데스크톱(6720~) / 모바일 ≤768px (6364~6720, 주 7일 슬라이드 전용 렌더) |
| 뷰 모드 | `monthly` / `rolling`(30일) |
| 건물 | 개별 9개 / `전체`(포트폴리오 통계 뷰) |
| 편집 모드 | 일반(예약 생성) / `priceMode` / `gapEditMode` / minStay Edit |
| 필터 | `showCancelled`, `vacantOnlyMode`(오늘 공실만), `isCalendarFullscreen` |

**핵심 파생값**
```js
calendarBuilding    = (selectedBuilding === "전체" && (priceMode || gapEditMode))
                        ? portfolioPriceBuilding : selectedBuilding
showBeds24DetailView = calendarBuilding !== "전체"   // 행 높이 82px, 가격/minStay/예약 3트랙 표시
```
행 높이: Beds24 상세 82px / priceMode 60px / 기본 52px / cancelled 다중 레인 시 가변.

**모드별 클릭 동작 (`handleDateCellClick`, 4206)**
- 과거 날짜 → 무시
- priceMode·gapEditMode → 셀 토글 선택 (드래그는 `queueCellSelection` rAF 배치)
- 일반 모드 → 1클릭 시작점 / 2클릭 종료점 → 충돌 검사 후 `ManualBookingModal`

---

## 9. 알아둘 현황/주의점 (수정 안 함, 기록만)

1. **초기 `selectedBuilding = "Arakicho A"`** (3902). `BUILDING_DATA` 키는 한글이므로 마운트 직후엔 매칭 실패 → "전체(All Properties)" 상태로 시작. `buildingResetInitRef`가 이 케이스에서 모드 리셋을 1회 건너뛰도록 방어하고 있음.
2. `BUILDING_DATA` / `BUILDING_ROOMS`가 **캘린더 파일 내부 하드코딩**이며 백엔드 `functions/index.js`의 동일 매핑과 수동 동기화 상태. 객실 추가·변경 시 3곳(캘린더, constants, functions) 모두 확인 필요.
3. `getCachedPrices`의 invalidated room 라이브 재싱크 경로는 `refreshInvalidatedRoomsDuringCacheRead = false`로 **비활성 고정**(4810). 죽은 코드가 아니라 의도적 플래그 — 캐시만 서빙.
4. `setPriceCache` 직접 호출 금지 — 반드시 `updatePriceCache()` (state/ref 동기화 보장, dev 모드 경고 있음).
5. `showCancelled` 변경은 Firestore 구독을 재생성함(쿼리 `status in` 변경). 토글 빈도가 높으면 비용 영향.
6. `price_change_logs` 조회는 `showBeds24DetailView`일 때만, 60초 쓰로틀, 최대 400건.
7. 워킹트리에 미커밋 변경 다수 (`BuildingCalendar.jsx` +433줄, `functions/index.js` +1618줄). 유지보수 착수 전 커밋/스태시 상태 정리 권장.
8. 스타일은 전량 inline style (Tailwind 없음). 색상: 사이드바 `#1E293B`, Primary `#4F46E5`, BG `#F1F5F9`, 카드 `border-radius 20px` + `box-shadow 0 10px 25px rgba(0,0,0,0.05)`.
9. 캘린더 전용 테스트 없음.

---

## 10. 유지보수 시 우선 확인 지점

| 증상 | 1차 확인 위치 |
|------|--------------|
| 예약 바 누락/잔상 | Q1/Q2/qLong 병합 (`applyFilter` 4780) + 인덱스 존재 여부 |
| 가격이 안 보임/옛날 값 | `hasVisiblePriceCoverage`(3781) → sessionStorage TTL → `getCachedPrices` `noCache` |
| 가격 저장 후 반영 지연 | `beds24_price_jobs` 상태 + `scheduledPriceJobWorker` 로그 + `refreshCompletedPriceJob` 재시도 |
| 듀얼 객실 값 이상 | `getActiveUnitInfosForDate`(3822) / `PREFERRED_DUAL_ROOM_IDS`(146) |
| 빨간 Gap 오탐 | `getCheckInGapInfo`(5360) — `consistencyPending`, `invalidatedRoomIds` |
| dot 색상 | `lm.s === 'beds24'` → `#EF4444`, 그 외 `#2563EB` (규칙 확정, 변경 금지) |
| 블록이 안 지워짐 | `externalInventoryBlocks`(4973) / `cleanupStaleInventoryOverrideBlocks`(functions 6386) |
| 스크롤/헤더 어긋남 | `syncCalendarHeaderScroll` + `calendarHeaderRowRef` / `isCalendarFullscreen` 분기 |
