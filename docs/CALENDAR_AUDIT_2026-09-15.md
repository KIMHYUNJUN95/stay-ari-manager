# 캘린더 전수 감사 — 2026-09-15

6개 축 병렬 감사 (가격 동기화 / 블락·해제 / 프론트 상태·렌더링 / 실시간 구독 / 멀티테넌트·보안 / 가격 이력·속성).
읽기 전용. 코드 변경 없음.

**검증 표기**
- `[확인됨]` — 내가 직접 코드를 읽어 재현 경로까지 확인
- `[미검증]` — 에이전트 보고. 코드 위치는 있으나 내가 끝까지 따라가지 않음
- `[추측]` — 외부(Beds24) 동작에 의존해 코드만으로는 단정 불가

---

## P0 — 데이터 파괴 / 매출 직결

### P0-1. 일괄 삭제 버튼이 앱 블락을 전 건물 통째로 하드 삭제 `[확인됨]`
`src/components/BuildingCalendar.jsx:7837`

- `fetchBlockData`(4646)는 `ACTIVE_BUILDING_ORDER` **전 건물**의 `status in ["blackout","maintenance"] && departure >= today` 문서를 모은다.
- 삭제 대상 필터는 `b.source !== "Direct"` 하나뿐. 앱 블락 문서의 `source`는 `"Beds24 Inventory"`(`functions/index.js:7624`)라 **전부 포함**된다.
- 확인 문구는 "Beds24 synced blocks / manual entries will be protected" — 의도적으로 건 블락이 지워진다는 경고가 없다.
- `deleteBlockData`는 `cancelBooking` 후 `batch.delete`로 **문서까지 하드 삭제**(4832). 복구 기록 없음.

**실패 시나리오**: 클릭 1회 → 9개 건물의 향후 모든 앱 블락 해제 + 문서 소멸.

**수정 방향**: 삭제 대상에서 `isInventoryOverrideBlock === true` 제외. 또는 확인 다이얼로그에 앱 블락 건수를 분리 표기.

---

### P0-2. 숫자가 아닌 가격이 Beds24 가격을 삭제 `[확인됨]`
`functions/index.js:2605`

`parseFloat(val.p1)` → `NaN` → `JSON.stringify`가 `null`로 직렬화 → Beds24는 `price1: null`을 **가격 제거**로 처리.
`setRoomPrices`(4699)에 `p1/p2/p3` 검증이 없다. 프론트는 `parseInt(p.newAirbnbPrice)`를 보내므로(`BuildingCalendar.jsx:488`) 빈 입력/비숫자면 NaN.

추가로 그 뒤 `getExpectedPriceValue`(5436)가 `Invalid price value`로 throw → 배치는 "실패"로 기록되지만 **POST는 이미 나갔다**. 가격이 지워진 채 실패로 보고된다.

**수정 방향**: `setRoomPrices` 진입부에서 `REMOVE`/`-1`/유한 숫자만 허용, 아니면 400.

---

### P0-3. 실패한 job이 이전 job을 "덮어썼다"고 간주 → 가격 미반영인데 성공 보고 `[확인됨]`
`functions/index.js:5390`

`comparableStatuses = ["queued","processing","completed","partial_failed","failed"]`.
`getSupersededPriceJobIntent`는 `createdMs`가 더 큰 job과 room:date가 겹치면 현재 job에서 그 키를 제거한다. 상대가 `failed`여도 무조건 superseding으로 본다.

**실패 시나리오**: 10:00 A(5,000엔) 저장 → 10:01 B(6,000엔) 저장 → B가 검증 실패로 `failed` → A는 전 날짜 skip + `status: "completed", superseded: true` → **Beds24엔 어느 가격도 안 들어갔는데 프론트에 성공 토스트**.

**수정 방향**: `comparableStatuses`에서 `failed` 제외. 또는 `progress.results[].success === true`인 키만 superseding 인정.

---

## P1 — 정합성 결함

### P1-1. 가격 job과 스케줄 동기화가 서로 다른 락을 잡는다 `[확인됨]`
`functions/index.js:2291`(`price_sync_lock`) vs `2329`(`price_job_execution_lock`)

주석은 "기존 price sync lock 재사용"이라 되어 있으나 **별개 문서**다. 상호 배제 없음.
게다가 `getNextQueuedPriceJobHint`(2384)는 `status == "queued"`만 조회 → job이 `processing`으로 넘어가면 `syncAllPrices`가 양보하지 않는다.

**실패 시나리오**: job이 POST 성공 후 `verifyBeds24PriceWrites` 재시도 중(수 초~수백 초) → 같은 시각 스케줄 동기화가 Beds24에서 **옛 가격**을 읽어 `rooms/{rid}.set({dates}, {merge:true})`(2955)로 덮어씀 + `lm{u:"Beds24", o:신가격, n:구가격, s:"beds24"}`로 **"Beds24가 되돌렸다"는 허위 이력**까지 생성.

**수정 방향**: 단일 락으로 통합하거나, `shouldYieldToQueuedPriceJob` 조회에 `processing` 포함.

---

### P1-2. job 실행 락 TTL(5분) < 최대 실행시간(9분) + 소유자 확인 없이 삭제 `[확인됨]`
`functions/index.js:2327`, `6277`

`PRICE_JOB_EXECUTION_LOCK_TTL_MS = 5분`인데 `triggerPriceJobNow`는 `timeoutSeconds: 540`(9분). rate limit 백오프(10/20/30/40초 × 5회) × 검증 3회 × source/sibling 2세트면 5분 초과가 현실적.
`finally { await releasePriceJobExecutionLock(); }`는 **자신이 소유자인지 확인하지 않고 삭제**한다.

**실패 시나리오**: job A 6분째 → TTL 만료 → job B 시작 → A가 끝나며 락 삭제 → job C 진입. 서로 다른 job이 같은 roomId에 동시 POST + 캐시 read-modify-write(트랜잭션 없음) → 뒤에 끝난 쪽이 앞의 가격을 덮어쓴다.

**수정 방향**: TTL ≥ 540초, 락 문서에 `lockId` 토큰을 넣어 소유자 확인 후에만 삭제.

---

### P1-3. 웹훅 coalescing 가드가 예약 무효화까지 보고 진짜 가격 변경을 버린다 `[확인됨]`
`functions/index.js:6885` ↔ `1788`

`recentlyDuplicatedWhileInvalidated`는 `invalidatedRoomIds` + `invalidatedAt`(5분)만 본다.
그런데 `invalidatePriceCacheForReservationMutations`(1788)가 **똑같은 필드**를 쓴다 — `invalidatedRoomIds`와 `reservationInvalidatedRoomIds` 양쪽에 add.

**실패 시나리오**: 게스트 예약/취소로 room X 무효화(T) → T+2분에 운영자가 Beds24에서 그 방 가격 변경 → 웹훅이 가드에 걸려 `return 200`. **즉시 sync 없음, 이력 없음, 프론트 신호 0.** 15분 증분 동기화 전까지 옛 가격.

**수정 방향**: `invalidatedBy`가 웹훅 기원일 때만 coalesce, 또는 room별 `lastPriceWebhookAt` 분리.

---

### P1-4. 스케줄 동기화가 웹훅 무효화 신호를 통째로 덮어써 잃는다 `[미검증]`
`functions/index.js:3018`

`invalidatedRoomIds: remainingInvalidatedRoomIds`는 **배열 전체 치환**이고, 기준 스냅샷은 건물 처리 **시작 시점**(2807)에 읽은 값이다. 트랜잭션 아님.

**실패 시나리오**: 동기화가 락을 쥔 채 처리 중 → 웹훅 도착 → 락 실패로 `arrayUnion` fallback(7055)으로 X 무효화 → 직후 동기화가 5분 전 스냅샷 배열로 덮어씀 → **X 무효화 소멸**. 웹훅은 이미 소비되어 재시도도 없다. 다음 풀 대사까지 옛 가격.

이 조합은 드문 경로가 아니라 웹훅 fallback의 **기본 경로**다.

**수정 방향**: `runTransaction`으로 감싸고 배열 치환 대신 성공한 roomId만 `arrayRemove`.

---

### P1-5. abort된 가격 요청이 `onSettled`를 호출하지 않아 낙관적 가격이 고착 `[확인됨]`
`src/components/BuildingCalendar.jsx:4494`

주석은 `// always called so retry logic can run`인데 실제로는 `if (requestId === priceFetchRequestIdRef.current && isMountedRef.current)` **안에** 있다. abort되면 절대 안 불린다.

**실패 시나리오**: price job 완료 → `refreshCompletedPriceJob` → `fetchPrices(true, b, cb)` 시작 → 같은 2초 창에 `price_sync` watcher가 재조회 발사 → 이전 요청 abort → `onSettled` 미호출 → `clearPendingPriceJob(jobId)` 미실행. `pendingPriceJobs`에 절대 TTL이 없고 job 문서는 더 안 바뀌므로 **새로고침 전까지 `pendingPriceCellMap`이 실제 가격을 영구히 덮어쓴다**.

**수정 방향**: `finally`에서 abort 시에도 `onSettled(false)` 호출. `pendingPriceJobs`에 절대 TTL 추가.

---

### P1-6. Beds24 응답이 짧거나 배열이 아니면 실패가 성공으로 보고 `[확인됨/추측 혼합]`
`functions/index.js:7363`, `7536`, `7466`

`getBeds24BatchResult`의 마지막 폴백 `return apiResponse?.data;`는 **모든 index에 같은 값**을 준다.
`createBeds24BlackoutOverrideBatch`는 `item`이 `undefined`여도 `{ success: true }`로 채운다.

**실패 시나리오**: roomId 3개를 보냈는데 2개짜리 배열이 오면 3번째는 성공 처리 → Firestore 문서·`ov`·가상 바까지 다 생기지만 **Beds24엔 블락 없음**. 응답이 객체면 전원 1번째 결과 공유.

Beds24가 실제로 짧은 배열을 반환하는지는 `[추측]`. 방어 부재 자체는 `[확인됨]`.

**수정 방향**: `item == null`이면 실패 처리, `ids.length !== 응답 길이`면 전체 실패.

---

### P1-7. 부분 실패한 블락이 완전한 블락과 구분 불가하게 렌더 `[확인됨]`
`src/components/BuildingCalendar.jsx:3901` (`isBeds24InventoryBlackoutForDate`)

`infosToCheck.some(info => ov === "blackout")` — 듀얼/트리플 중 **하나만** blackout이어도 셀 전체가 블락으로 보인다.
`partialFailure` 분기는 낙관적 바를 롤백하지 않고 alert만 띄운다.

**실패 시나리오**: 오쿠보C 3개 ID 중 1개 실패 → alert를 닫으면 캘린더엔 완전한 블락과 똑같은 바 → 실패한 ID로 예약이 그대로 들어온다. 새로고침해도 동일.

**수정 방향**: 부분 블락을 별도 색/스트라이프 + 경고 배지로 구분, 또는 판정을 "모든 unit이 blackout"으로 변경.

---

### P1-8. Beds24 성공 후 Firestore 실패 → 해제 불가능한 고아 블락 `[미검증]`
`functions/index.js:7592`, `7671`

Beds24 POST를 먼저 보내고 `patchPriceSyncForBlackout` → `reservations.set` 순서인데 보상 롤백이 없다.

**실패 시나리오**: Beds24 blackout 성공 → Firestore 오류 → 프론트에는 "이 방은 아직 예약 가능, 재시도하세요"라고 **정반대** 안내. 실제로는 Beds24는 막혔고, 문서가 없어 `findAppBlockDocsForRange`가 못 찾고 `ov`도 없어 가상 바조차 안 뜬다 → **캘린더에 아무것도 안 보이는 채로 판매 정지**.

**수정 방향**: Firestore 실패 시 `clearBeds24BlackoutOverride`로 보상 롤백, 또는 pending 문서를 먼저 쓰고 Beds24 성공 후 확정.

---

### P1-9. 낙관적 블락 콜백이 엉뚱한 컴포넌트에 연결 — 기능 자체가 죽어 있다 `[확인됨]`
`src/components/BuildingCalendar.jsx:6667` vs `7190`

`onOptimisticBlockStart` / `onOptimisticBlockRollback`이 `<ReservationDetailModal>`(6667)에 전달된다. 그 컴포넌트 시그니처(1305)는 두 prop을 **받지 않는다**.
콜백을 실제로 호출하는 `ManualBookingModal`은 시그니처(1924)에 두 prop이 있지만, `<ManualBookingModal>`(7190) 렌더 지점에서 **전혀 넘어가지 않는다**.

**결과**: `optimisticInventoryBlocks`는 **항상 `[]`**. 블락 생성 시 바가 아예 안 뜨고 웹훅→구독→재조회가 끝날 때까지 빈 셀. `visibleOptimisticInventoryBlocks`, `isSameCalendarBlock`, 정리 effect 전부 죽은 코드.

**수정 방향**: 두 prop을 `<ManualBookingModal>`로 옮긴다.

---

### P1-10. 회색 dot이 실제로 그려진다 (확정 룰 위반) `[확인됨 — 에이전트 간 결론 충돌을 내가 판정]`
`src/components/BuildingCalendar.jsx:10354-10358`

```
hasLastModMarker = !!(lastModInfo || latestSourceEntry)
lastModMarkerColor = beds24 ? #EF4444 : system ? #2563EB : #94A3B8
```

`lastModInfo`만 있어도 dot은 그려진다. 그런데 `lastModInfo.s`가 `'beds24'`/`'system'` 둘 다 아니면(legacy — 메모리에 "legacy는 s 없을 수 있음"으로 확정) `lastModSourceEntry = null`이고, 그 셀의 로그가 최근 1,000건 윈도우 밖이면 `latestSourceEntry`도 null → **회색**.

프론트 축 에이전트는 "도달 불가"라 했으나 오판. 이력 축 에이전트가 맞다.

**수정 방향**: 마지막 폴백을 `#2563EB`로. (dot을 숨기면 legacy 셀의 dot이 사라지므로 색만 파랑으로.)

---

### P1-11. Min Stay(Gap) 적용 실패 시 낙관적 업데이트가 롤백되지 않는다 `[미검증]`
`src/components/BuildingCalendar.jsx:7554-7592`

`backupRoomPrices`/`backupPriceCache`는 **`catch`에서만** 복원되는데, fetch는 `.catch(err => ({success:false}))`로 이미 잡히고 180초 타임아웃도 `Promise.race`로 resolve된다 → **API 실패는 catch에 도달하지 않는다**.
4단계 주석은 "최신 서버에서 최종 가격 새로고침"이라 되어 있으나 실제로는 `setLastPriceSyncByBuilding`만 하고 `fetchPrices` 호출이 없다.

**결과**: 서버 실패인데 `m: "2"`가 화면에 남고, 오염된 값이 `priceCacheRef`에 있어 건물을 바꿨다 돌아와도 되살아난다. F5 전까지 잘못된 minStay로 gap 판정까지 어긋난다.

**수정 방향**: `!batchResult.success` 경로에서도 백업 복원 + 성공/실패 무관하게 `fetchPrices(true, ...)`.

---

### P1-12. `ManualBookingModal`에 `setLoading(true)`가 없다 → 예약 중복 생성 `[확인됨]`
`src/components/BuildingCalendar.jsx:1925`

`setLoading(true)`는 파일 내 465/1341/4867/4983행뿐 — 전부 다른 컴포넌트. `finally { setLoading(false) }`만 있다.
`disabled={loading}`가 걸린 "Create Reservation" 버튼이 사실상 항상 활성 → 느린 네트워크에서 두 번 누르면 Beds24에 중복 생성.

블랙아웃 듀얼 ID 경로는 `onClose()`를 즉시 호출해 안전하나, 일반 예약 경로(2152-2199)는 모달이 열린 채 대기한다.

**수정 방향**: 검증 통과 직후 `setLoading(true)`, 조기 return 경로에서도 해제.

---

### P1-13. 앱 자신의 가격/minStay 쓰기가 실시간 신호를 발사하지 않는다 `[확인됨]`
`functions/index.js` — `price_sync/{building}` 부모 문서 쓰기는 **1783 / 3016 / 6907 / 7055 네 곳뿐**.
`processPriceJob`의 캐시 패치(5594)와 `syncMinStayOnly`(3131)는 `rooms/{roomId}` + 월 캐시만 쓴다.

**결과**: A가 가격을 바꾸면 같은 건물을 열어둔 B의 캘린더는 문서화된 실시간 채널로 아무 신호도 못 받는다. B가 알게 되는 유일한 경로는 Beds24가 우리 쓰기를 웹훅으로 되쏘는 것 `[추측]`.

**수정 방향**: 두 경로 끝에서 부모 문서의 `lastSyncAt`(또는 전용 `lastChangeAt`)만이라도 touch.

---

### P1-14. 무효화 상태의 stale 응답을 fresh로 캐싱하고 재시도하지 않는다 `[확인됨]`
`functions/index.js:5030` + `BuildingCalendar.jsx:4453, 4460, 4465`

`refreshInvalidatedRoomsDuringCacheRead = false` 하드코딩 → `invalidatedRoomIds`가 차 있어도 옛 캐시를 그대로 준다(그 아래 live-refresh 100줄은 도달 불가 코드).
응답에 `hasPendingInvalidation` / `invalidatedRoomIds`가 실려 오지만 프론트는 `reservationInvalidatedRoomIds`만 읽는다.
`writePriceCacheSession`이 이 stale 스냅샷을 `cachedAt = now`로 저장하고, `priceConsistencyPending`까지 false로 내린다.

**결과**: 화면은 "방금 갱신됨"처럼 보이면서 옛 값을 띄우고, 새로고침해도 세션 캐시가 이를 견딘다. 15분 증분 동기화 전까지 복구 없음.

**수정 방향**: 프론트가 `hasPendingInvalidation`을 읽어 세션 캐시 쓰기 생략 + 재시도 예약 + pending 표시.

---

## P2 — 성능 / UX / 운영

| 항목 | 위치 | 내용 |
|---|---|---|
| 셀 hover마다 전체 재렌더 | `BuildingCalendar.jsx:10444` | `setHoveredDay`/`setHoveredRoom`이 780셀 전체 재렌더 유발. `React.memo` 미적용. 26객실 뷰에서 체감 렉 |
| 건물 전환당 fetchPrices 3회 | `BuildingCalendar.jsx:4553` | 시그니처 레이스로 강제 재조회 2회 + effect 1회. 앞 건은 abort로 낭비 |
| 이력 윈도우가 회사 전체 1,000건 | `BuildingCalendar.jsx:3125` | 한 건물의 대량 로그가 윈도우를 채우면 **다른 8개 건물 이력이 툴팁에서 사라진다** |
| 감사 모듈이 크레딧 가드를 안 본다 | `priceConsistencyAudit.js:64` | 전 건물 라이브 2회 왕복, throttle 없음. 200 크레딧을 단발 소진해 sync/job을 쿨다운으로 밀어냄 |
| 가드 래퍼가 쿨다운을 켜기만 하고 안 읽는다 | `functions/index.js:2679` | 가드 활성 후에도 같은 루프의 남은 호출은 전부 나간다 |
| job 정리가 500건 상한 초과 시 영구 실패 | `functions/index.js:6391` | `limit` 없는 `batch.delete`. 초과하면 매일 같은 지점에서 실패 → 컬렉션 무한 증가 |
| `dates` 맵 프루닝 없음 | `functions/index.js:2955`, `6753` | stale 날짜 영구 잔존 + 약 5,000일에서 문서 1MiB 상한 → 해당 객실 캐시 정지 |
| 모바일이 Beds24 블락을 무시 | `BuildingCalendar.jsx:6717` | `ov==="blackout"`/`na<=0` 미검사 → 데스크톱은 막힌 날을 **모바일은 빈 방 + 가격**으로 표시 |
| 모바일에서 블락 생성·해제 불가 | `BuildingCalendar.jsx:6684-7039` | 모바일 뷰가 블락 바 자체를 렌더하지 않음. 의도 확인 필요 |
| 모바일 셀 폭이 회전에 반응 안 함 | `BuildingCalendar.jsx:6686` | `window.innerWidth`를 렌더 중 읽는데 리스너는 `isMobile` 불리언만 갱신 |
| `calculateBuildingMetrics`가 UTC 기준 | `BuildingCalendar.jsx:2675` | JST 00:00~09:00에 "Vacant Today"만 어제 기준 |
| 셀은 `p1`, 통계는 `p3 \|\| p1` | `:1215` vs `:6056, 6097, 6169` | `p1 ≠ p3`인 방에서 셀 숫자와 통계 카드 불일치 |
| 가격 없음을 `¥0 ~ ¥0`으로 표시 | `BuildingCalendar.jsx:10929` | `>= 0` 조건이라 `"-"` 분기 도달 불가 |
| Price Insight가 방문한 건물만 집계 | `BuildingCalendar.jsx:6126` | 세션마다 다른 결과 |
| `roomPrices` 건물 전환 시 리셋 없음 | `BuildingCalendar.jsx:4447` | 정합성 문제는 없으나 단조 증가. Gap 적용마다 `structuredClone` 전량 복제(7414) |
| 해제 재진입 가드 없음 | `BuildingCalendar.jsx:4736` | 내가 `unblockBusy`를 제거하며 생긴 것. 모달을 즉시 닫아 위험은 낮지만, 같은 roomId로 구간이 겹치는 문서 2개를 병렬 clear 시 `preBlockNumAvailByDate` 경합 |
| 재블락 시 numAvail 스냅샷 덮어씀 | `functions/index.js:7429` | 문서 ID가 결정적 + `merge:true`라 두 번째 스냅샷이 blackout 이후 값이 될 수 있음 `[추측]` |
| 캐시에 없는 날짜는 `ov` 패치 skip | `functions/index.js:7373` | 13개월 뒤 블락은 Beds24엔 걸리는데 **캘린더에 전혀 표시되지 않고 해제 버튼도 없다** |
| 과거 날짜 블락 잔재 정리 불가 | `functions/index.js:6698` | 동기화 범위가 오늘~라 자가 치유 안 됨 |
| attribution 폴백이 전체 날짜로 확대 | `priceAttribution.js:99, 339` | priceWebhook 로그의 `priceSnapshot` 행에 `room`이 없어 `dateFrom~dateTo` 전 구간이 target이 됨 → 전환 통계 오염 |
| 단일 청크 로그의 `rooms` 메타 과대 | `functions/index.js:6225` | 메타 축소가 `chunkCount > 1`에서만 동작 |
| job coalescing이 작성자를 뒤바꿈 | `functions/index.js:6234` | 2분 내 같은 건물 job을 흡수하면 **B의 수정이 A 이름으로** 기록 |
| `partial_failed` 로그가 통계에서 제외 | `priceAttribution.js:215` | 20개 중 1개 실패해도 19개 전환이 통째로 사라짐 |

### 죽은 코드 (정리 권장)
- `functions/index.js:6053-6094` — `throw` 직후 도달 불가 블록. 실행되면 `ReferenceError`. 되살아나면 월 캐시 없이 room 문서만 써서 불변식을 깬다
- `functions/index.js:5034-5125` — `refreshInvalidatedRoomsDuringCacheRead = false`로 죽은 live-refresh 100줄
- `BuildingCalendar.jsx:565-601` — 무청킹 `addDoc`. 현재 도달 불가지만 되살아나면 1MB 위험

---

## 보안 — 별도 판단 필요

구조적 사안이라 P0/P1과 분리한다. **오늘 생긴 문제가 아니라 처음부터 그랬던 구조**다.

### 확인된 사실 `[확인됨]`
- 캘린더/가격/블락/예약 HTTP 함수 중 **ID 토큰을 검증하는 것이 하나도 없다**. `authorizeInternalAutomationRequest`(53)는 올바르게 구현돼 있으나 `priceConsistencyAudit` / `hotelsmart` / `slackReports` 3곳에만 연결
- 프론트도 `Authorization` 헤더를 보내지 않는다 (`src/` 전체에서 `UserContext.jsx:26` 한 곳뿐, Firestore REST용)
- `firestore.rules`가 저장소에 없다. `firebase.json`의 firestore 블록은 `indexes`만
- `getCachedPrices`의 companyId 가드가 죽어 있다 — `price_sync/{building}` 부모 문서에 `companyId`를 쓰는 경로가 없어 `if (docData.companyId && ...)` 앞부분이 항상 falsy
- `cancelBooking`에 문서 companyId 가드가 없다. `updateBooking:7805`에는 있는 검증이 통째로 빠짐. 블락 문서 ID는 `inventory-blackout:<roomId>:<arrival>:<departure>`로 완전히 추측 가능
- `priceWebhook` / `beds24BookingWebhook`에 발신자 검증 없음
- 비밀 노출은 없음 — 토큰은 전부 `defineSecret`/`process.env` 경유, 로그 출력 없음, `.env`는 gitignore

### 노출 요약
| 함수 | 가능한 동작 |
|---|---|
| `getTodayArrivals` | 게스트 이름·이메일·전화·가격 전량 읽기 (`companyId \|\| DEFAULT_COMPANY_ID` 폴백) |
| `setRoomPrices` / `setMinStay` | 실제 판매가·최소숙박일 변경 (매출 직결) |
| `createBooking` | 실제 재고 블락, 위조 예약 생성 |
| `cancelBooking` | `bookId`만 알면 임의 예약·블락 취소 |
| `updateBooking` | 예약 날짜/인원/가격/게스트 정보 변경 |
| `getCachedPrices` | 전 건물 가격·minStay·재고 캐시 조회 |
| `syncBeds24` / `unifiedSync` / `priceWebhook` | Beds24 200 크레딧 반복 고갈 → 정상 동기화 마비 |

### 순서 제안
1. `cancelBooking`에 `updateBooking`과 동일한 문서 companyId 가드 추가 (한 줄, 즉시 가능)
2. 예약을 실제로 바꾸는 4개(`createBooking`/`cancelBooking`/`updateBooking`/`getTodayArrivals`)에 `authorizeInternalAutomationRequest` 적용 + 프론트에 ID 토큰 헤더 추가
3. `setRoomPrices`/`setMinStay`로 확대
4. 두 웹훅에 시크릿 경로 토큰
5. `firestore.rules` 저장소 도입 + `price_sync`에 companyId 기록

---

## 에이전트가 틀렸던 것

- **프론트 축**: "회색 dot은 도달 불가" → **오판**. `hasLastModMarker`는 `lastModInfo` 단독으로도 true가 된다 (P1-10)
- **블락 축**: "`ManualBookingModal`이 낙관적 콜백을 받는다" 전제로 부분 실패 롤백을 논했으나, 실제로는 prop이 넘어가지 않아 기능 자체가 죽어 있다 (P1-9)
- **보안 축**: "`price_sync`에 companyId를 쓰는 코드가 존재하지 않는다" → 맞다. 내 grep이 인접한 `recordPriceSyncAudit` 호출로 번져 한때 반증처럼 보였으나 재확인 결과 에이전트가 정확

---

## 확인했고 문제 없던 영역 (요약)

- **날짜 경계**: `[arrival, departure)` 반열림 규약이 프론트·백엔드 전 경로에서 일관. 오프바이원 없음
- **듀얼 ID 전량 블락**: `BUILDING_ROOMS` 정적 상수를 쓰므로 비활성 ID까지 빠짐없이 포함. 도메인 룰대로
- **`BEDS24_PRICE_SOURCE_ROOM_ID`**: 모든 듀얼/트리플 쌍이 빠짐없이 매핑됨 (아라키초A 11쌍, 가부키초 10쌍, 다카다노바바 401호, 오쿠보C 3중)
- **minStay 정규화**: `normalizeBeds24MinStay`가 빈 문자열/NaN/0/음수를 모두 `"1"`로. 활성 판정 `m >= 1 && m < 50`(50 포함 비활성) 정확
- **페이지네이션 truncation**: 5개 경로 모두 저장 skip 또는 검증 실패 처리. 낙관적 완료 없음
- **구독 정리**: `onSnapshot` 6개 전부 cleanup 있음. 타이머·rAF·`AbortController`도 전부 해제됨
- **`fetchPrices`의 stale 가드**: `requestId` + `AbortController` + `isMountedRef` 삼중. StrictMode 안전
- **멀티테넌트 (프론트)**: 모든 `collection()` 쿼리에 `companyId` 필터. 누락 없음
- **`dayjs` utc 플러그인**: `src/` 전체에 `utcOffset`/`utc`/`tz`/`extend` 호출 0건. `Intl` 기반 포맷터 올바름
- **Tailwind**: 0건
- **로그 청킹**: 청크 2,000행 ≈ 180KB로 1MB 여유. 대량 경로 2곳 모두 실제 사용
- **`lm.s` 소스 일관성**: 백엔드 쓰기 4곳 모두 `s` + `ts` 포함, beds24/system 구분 정확
- **멱등성**: `getInventoryOverrideBlockDocId`는 완전 결정적
