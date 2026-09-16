# Stay-Ari → Stay-Ops 기능 통합 기획

작성 2026-09-16. **기획 단계 — 착수 전.**
대상: `\\wsl.localhost\Ubuntu\home\kghkw\projects\Stay-Ops`

범위: 가동률 · 매출 · 캘린더 + **Slack/Google 등 자동화 전부**

---

## 0. 전제를 먼저 바로잡아야 한다

"기능을 옮긴다"가 아니라 **"이미 절반쯤 겹쳐 있는 두 시스템을 합친다"** 다.

| | Stay-Ari Manager | Stay-Ops |
|---|---|---|
| 프레임워크 | CRA React 18, **JS** | Next.js 16, React 19, **TS** |
| DB | Firestore (문서) | **Supabase Postgres** (관계형) |
| 백엔드 | Cloud Functions (30개+) | API routes + Supabase |
| 테넌시 | `companyId` 필드 필터 | `organization_id` + RLS |
| 스타일 | 인라인 스타일 | **Tailwind 4** |
| 스케줄러 | Cloud Scheduler (12개) | `CRON_SECRET` 외부 트리거 |
| 테스트 | 없음 | **vitest** |

**코드는 한 줄도 그대로 못 옮긴다.** 옮길 가치가 있는 자산은 코드가 아니라:

1. 도메인 규칙 (minStay 50 관례, 듀얼 ID, 12개월 오픈 구간, 주말=금토일)
2. 운영 중 비싸게 얻은 함정 목록 (`CALENDAR_AUDIT_2026-09-15.md`)
3. 리포트의 정의 — 무엇을 어떤 기준으로 집계해 누구에게 보내는가

---

## 1. Stay-Ops에 이미 있는 것 — 다시 만들지 말 것

조사로 확인한 것만 적는다.

**캘린더**
- `src/components/admin/calendar/admin-reservation-console.tsx` — **2,000줄**, 동작 중
- `src/lib/admin-calendar-dashboard.ts` — 404줄. 객실축(`AdminCalendarRoomAxisRow`), 블락(`AdminCalendarRoomBlock`), 채널 구분(`airbnb|booking|manual`), JST 날짜 처리
- `src/app/mobile/calendar/page.tsx` — 모바일 캘린더 별도 존재

**Beds24 연동** — `src/lib/beds24/` 17개 모듈
`access-token`, `credits`, `inventory-sync`, `room-blocks-sync`, `room-sync`, `properties-room-master-sync`, `reservations-backfill`, `process-webhook-booking`, `webhook-events`, `sync-control`, `reviews-sync`, `review-room-relink`, `reservation-lookup/id/status`, `source-normalization`, `booking-payload`

**도메인 규칙이 이미 구현돼 있다**
- `BEDS24_INACTIVE_MIN_STAY_THRESHOLD = 50`, `isInactiveBeds24Room()` (`src/lib/rooms.ts`)
- `external_minimum_stay` 컬럼
- **듀얼 ID 해법이 Stay-Ari와 다르고, 더 낫다**: Stay-Ari는 roomId 배열을 들고 다니는데 Stay-Ops는 `room_label`을 정본으로 두고 `external_room_id`를 갱신한다 (`buildGlobalExternalRoomToCanonical`, `resolveReservationCanonicalRoomLabel`). Beds24 room ID가 연중 바뀌는 것까지 흡수한다. **이 모델을 유지한다.**

**자동화 기반**
- `src/lib/slack-notify.ts`
- env: `SLACK_DAILY_REPORT_WEBHOOK_URL`, `SLACK_OPS_ALERT_WEBHOOK_URL`, `GOOGLE_CLIENT_ID/SECRET`, `CRON_SECRET`, VAPID(웹푸시), `DEEPL_API_KEY`
- API: `beds24/webhook`, `beds24/reconcile`, `beds24/reviews-sync`, `attendance/reminders`, `tasks/reminders`, `recruit/sync`

**가동률** — `getAdminDashboard`에 있으나 **오늘 하루 `occupied/total`뿐**

---

## 2. 없는 것 — 실제 이식 대상

### 2-1. 가격 관리 (전체 작업량의 약 8할)
Stay-Ops에 가격 개념이 사실상 없다. `reservations` 테이블에 **가격 컬럼 자체가 없고**, 매출은 `raw_payload` jsonb에서 꺼내 쓴다.

옮겨야 할 것:
- 가격 캐시 (`price_sync` 문서 → Postgres 테이블 재설계)
- 가격 수정 큐 + 워커 + 실행 락
- minStay 편집
- 가격 변경 이력 + 셀 호버 툴팁
- 듀얼 ID 가격 전파 · 정합성 검증
- 대량 선택 UX (2축 교차 모델)

### 2-2. 기간 가동률
오늘 스냅샷만 존재. 월별·객실별·요일별·건물별 집계가 없다.

### 2-3. 매출 분석
추출은 되지만 집계·추이·채널 분해·목표 대비가 없다.

### 2-4. 자동화 (아래 4장)

---

## 3. 단계 계획

기존 자산에 얹는 순서. 리스크 낮은 것부터.

### 1단계 — 가동률 (가장 안전, 새 테이블 불필요)
`admin-calendar-dashboard.ts`가 이미 객실축과 예약·블락을 만든다. 기간 집계만 얹는다.

- 분모에서 **비활성 객실 제외** (`isInactiveBeds24Room`). 이걸 빠뜨리면 가동률이 실제보다 낮게 나온다
- 분모에서 **블락 처리 방침 결정** — Stay-Ari는 blackout을 판매 중지로 본다
- `[check_in, check_out)` 반열림 규약 유지 (Stay-Ops의 `buildDates`도 동일한지 확인 필요)
- JST 기준. Stay-Ops는 `toJstDateString`이 이미 있고, UTC 절단 버그를 이미 한 번 고쳤다 (`63b914d`)

산출: 건물별/객실별/기간별 가동률, 요일 패턴.

### 2단계 — 매출 (마이그레이션 선행)
`raw_payload`에서 매번 꺼내는 방식은 집계·인덱싱에 취약하다.

- 마이그레이션: `reservations`에 `total_amount numeric`, `currency text`, `channel text`, `commission numeric?` 추가
- 동기화 경로(`process-webhook-booking`, `reservations-backfill`)에서 채우기
- 기존 행 backfill (`raw_payload` 파싱, 이미 `getRawPayloadNumber`가 있음)
- 그 다음 집계: 일/월 매출, 채널별, ADR, RevPAR, 목표 대비

**주의**: 취소 예약 처리 기준을 먼저 정해야 한다. Stay-Ari는 `status === "confirmed"`만 집계한다.

### 3단계 — 캘린더에 가격 얹기
1·2단계로 데이터가 준비된 뒤.

- **기존 `admin-reservation-console`에 가격 행을 얹는 것**을 기본으로 한다. 2,000줄짜리 동작 중인 화면을 갈아엎는 건 위험 대비 이득이 없다
- 가격 그리드·대량 선택·이력 툴팁은 Tailwind + TS로 재작성

### 4단계 — 가격 쓰기 경로 (가장 위험)
읽기가 안정된 뒤에 쓰기를 붙인다. Beds24에 실제로 쓰는 경로라 사고가 곧 매출 손실이다.

설계 단계에서 **반드시** 반영할 것 (전부 이번 감사에서 실제로 터진 것들):
- 가격 job과 동기화가 **같은 락**을 잡을 것. 락 TTL > 최대 실행시간, 소유자 토큰 확인 후 해제
- Beds24 배치 응답 **길이 검증** — 짧은 배열/비배열을 성공으로 읽으면 안 됨
- 페이지네이션 truncation 시 **저장 skip** (부분 데이터를 완전한 것으로 캐싱 금지)
- 가격 입력 검증 — `NaN`이 JSON에서 `null`이 되어 Beds24가 "가격 삭제"로 처리
- 실패한 job을 superseding으로 간주하지 말 것
- 크레딧 가드를 **읽기도** 할 것 (켜기만 하면 무의미)
- 쓰기 후 검증(verify) 경로

---

## 4. 자동화 이관 목록

Stay-Ari 스케줄 함수 12개 + 모듈 17개. Stay-Ops는 `CRON_SECRET` 기반 외부 트리거(`.github/` 존재 — Actions인지 Vercel Cron인지 확인 필요)를 쓴다.

### 4-1. Beds24 동기화 계열
| Stay-Ari | 주기 | Stay-Ops 대응 |
|---|---|---|
| `scheduledBeds24Sync` | 매시 05분 | `beds24/reconcile` **있음** |
| `scheduledBeds24PropertySync` | 주간 | `properties-room-master-sync` **있음** |
| `scheduledReviewsSync` / `Reconcile` | 일/주 | `beds24/reviews-sync` **있음** |
| `scheduledBeds24PriceSync` | 15분 | **없음 — 신규** |
| `scheduledPriceJobWorker` | 1분 | **없음 — 신규** |
| `scheduledPriceJobCleanup` | 일 | **없음 — 신규** |

→ 앞의 4개는 **이미 있으니 건드리지 않는다.** 뒤 3개만 추가.

### 4-2. 리포트 계열 (전부 신규)
| Stay-Ari | 주기 | 내용 |
|---|---|---|
| `dailySalesSnapshot` | 00:30 | 일일 매출 스냅샷 (예약 보정 후) |
| `scheduledDailyReport` | 08:45 | **Slack + Google Sheets 일일 리포트** |
| `scheduledNotionDashboardSync` | 09:00 | Notion 대시보드 |
| `scheduledCleaningWorkforceForecast` | 08:00 | 청소 인력 예측 |
| `scheduledRefreshHomeDashboardSummary` | 5분 | 홈 대시보드 집계 캐시 |

관련 모듈: `googleSheetReports`, `slackReports`, `slack/`, `notionReports`, `notionReportSync`, `revenueDashboardData`, `paxOccupancyReport`, `cleaningWorkforceForecast`, `chartImage`, `targetGoalsSheet`, `homeDashboardSummary`

### 4-3. 알림 계열 (전부 신규)
- `sameDayBookingAlert` — 당일 예약 알림
- `cancelAlert` — 취소 알림

Stay-Ops는 `slack-notify.ts` + 웹푸시(VAPID)가 있으므로 **전달 경로는 이미 있다.** 트리거와 메시지 구성만 옮기면 된다.

### 4-4. 기타
- `priceConsistencyAudit` — 3단계와 함께
- `hotelsmart/`, `attendanceAppClient` — 이관 대상인지 확인 필요 (Stay-Ops에 근태 기능이 이미 있음)

### 4-5. 인증 방식 차이 (중요)
Stay-Ari의 내부 엔드포인트는 `authorizeInternalAutomationRequest`(Firebase ID 토큰 + owner/manager)를 쓴다. Stay-Ops는 `CRON_SECRET` 방식이다. **이관 시 Stay-Ops 규약(`CRON_SECRET`)으로 통일한다.**

참고: Stay-Ari 쪽 캘린더 HTTP 함수는 대부분 무인증이다. **그 방식을 따라가면 안 된다.** Stay-Ops는 RLS + 세션 기반이라 이미 더 낫다.

---

## 5. 데이터 모델 작업 (마이그레이션)

| 순서 | 내용 |
|---|---|
| M1 | `reservations`: `total_amount`, `currency`, `channel` 추가 + backfill |
| M2 | `room_rates` (가격 캐시): `org, room_id, date, price_airbnb, price_booking, min_stay, max_stay, num_avail, override, last_modified jsonb` — 날짜별 행. Firestore의 `dates` 맵을 행으로 편다 |
| M3 | `rate_change_logs` (가격 이력): Stay-Ari의 1MB 문서 청킹 문제가 사라진다 |
| M4 | `rate_jobs` (가격 수정 큐) + 실행 락 테이블 또는 advisory lock |
| M5 | `daily_sales_snapshots` (매출 스냅샷) |

**관계형으로 가면 Stay-Ari의 구조적 문제 다수가 자동 해소된다** — 문서 1MB 상한, `dates` 맵 무한 증가, 월 캐시와 room 문서 이중화, 청킹. Postgres advisory lock은 직접 만든 락보다 안전하다.

---

## 6. 먼저 정해야 할 것

1. **캘린더**: 기존 콘솔에 얹기 / Stay-Ari UX로 교체 / 가격 전용 화면 신규
2. **Beds24 정본**: Stay-Ops로 일원화 / 당분간 병행 (병행 시 200 크레딧 예산 분할 + 같은 방 동시 쓰기 충돌 주의)
3. **전환 방식**: 기능별 순차 이관 후 Stay-Ari 폐지 / 영구 병행
4. **Notion·HotelSmart** 이관 여부
5. 매출 집계에서 **취소·블락 처리 기준**

---

## 7. 권장 착수 순서 요약

```
1단계  가동률 집계        (새 테이블 없음, 위험 낮음)
2단계  M1 + 매출 집계     (마이그레이션 1건)
3단계  자동화 리포트 이관  (1·2단계 산출물이 입력이 됨)
       - 일일 리포트(Slack+Sheets) → 스냅샷 → 알림 → Notion
4단계  M2·M3 + 가격 읽기 + 캘린더 가격 행
5단계  M4 + 가격 쓰기 + 정합성 감사   (가장 위험, 마지막)
```

자동화를 3단계에 두는 이유: 리포트는 **가동률·매출 집계를 입력으로 받는다.** 집계가 확정되기 전에 리포트를 옮기면 두 번 만들게 된다.

---

## 8. 참고 문서

- `docs/CALENDAR_AUDIT_2026-09-15.md` — 캘린더 전수 감사. 4단계·5단계 설계 시 **필수 입력**
- `docs/CALENDAR_ARCHITECTURE.md` — Stay-Ari 캘린더 구조
- Stay-Ops `CLAUDE.md`(18KB), `AGENTS.md`(12KB) — 대상 프로젝트 규약. 착수 전 정독 필요
