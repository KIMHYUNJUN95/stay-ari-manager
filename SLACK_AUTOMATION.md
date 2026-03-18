# 슬랙 자동화 정리 (디버깅용)

## 환경 변수 (functions/.env)

| 변수 | 용도 | 비고 |
|------|------|------|
| `SLACK_DAILY_REPORT_WEBHOOK_URL` | 일일 운영 리포트 | 필수. 08:50 JST + 변동 시 재전송 |
| `SLACK_CLEANING_REPORT_WEBHOOK_URL` | 청소/셋팅 알림 | 08:50 JST, 당일 기준 |
| `SLACK_SAME_DAY_BOOKING_WEBHOOK_URL` | 당일 예약 알람 | Beds24 웹훅 → 당일 예약 시 1건씩 |
| `SLACK_CANCEL_ALERT_WEBHOOK_URL` | 당일 취소 알람 | 에어/부킹만, 입실일 ±6개월 |
| `SLACK_SYNC_ALERT_WEBHOOK_URL` | 동기화/리포트 실패 알람 | 미설정 시 일일→청소 URL로 fallback |

## 발송 경로

1. **일일 리포트** (`slackReports.js`)
   - **스케줄**: `50 8 * * *` (08:50 JST) → `buildAndSendSlackDailyReport()` (어제 기준)
   - **변동 재전송**: 웹훅/동기화 후 `scheduleOutputUpdates()` → 어제 데이터 포함 시 `buildAndSendSlackDailyReport(false, dateStr, true)` (변동 없으면 생략)
   - **수동**: `sendSlackDailyReportManual` GET (쿼리 `?target=today` 시 오늘 기준)

2. **청소 리포트** (`slackReports.js`)
   - **스케줄**: `50 8 * * *` (08:50 JST) → 당일 체크아웃/체크인 기준
   - **수동**: `sendSlackCleaningReportManual` GET (`?date=YYYY-MM-DD`)

3. **당일 예약 알람** (`sameDayBookingAlert.js`)
   - **트리거**: Beds24 예약 웹훅에서 `eventType===created` + 당일 예약+당일 체크인 + 확정 + 금액>0 + 다이쿄초 제외
   - 플랫폼 무관(에어/부킹/수기 등 전체)

4. **당일 취소 알람** (`cancelAlert.js`)
   - **트리거**: Beds24 예약 웹훅에서 `eventType===cancelled`
   - **필터**: 에어비엔비·부킹닷컴만, 입실일이 오늘 기준 앞뒤 6개월 이내

5. **동기화 알람** (`sendSyncAlert`)
   - **호출처**: `assertReservationDataReady` 실패, `scheduledBeds24Sync` 실패, `beds24BookingWebhook` 500, 일일/청소 스케줄 실패
   - 실패 시 `sendSyncAlert` 내부에서 try/catch로 로그만 남기고 예외 전파 안 함

## 참고

- **runDailyReportNow**: 구글 시트·노션 일일 리포트만 실행. **슬랙 일일 리포트는 호출하지 않음** (슬랙은 08:50 스케줄 + 변동 재전송으로만 발송).
- **일일 리포트 건물 목록**: `SLACK_DAILY_REPORT_BUILDINGS` (slackReports.js). 사노시 포함.
- **청소 건물 순서**: `CLEANING_BUILDING_ORDER`. 다이쿄초 제외.
