# 배포 및 노션 갱신 테스트

---

## ⭐ 항상 마지막에 실행할 명령어 (복사용)

**1) 빌드·배포**
```bash
firebase deploy --only functions
```

**2) 노션 페이지 갱신**
```powershell
Invoke-RestMethod -Uri "https://rundailyreportnow-iphheelkyq-uc.a.run.app" -Method GET
```

---

## 1. Firebase 재로그인 (최초 1회 또는 만료 시)

```bash
firebase login --reauth
```

브라우저에서 Google 계정으로 로그인 후 터미널로 돌아오면 완료.

---

## 2. Functions 배포

프로젝트 루트(`c:\-stay-ari-manager-main`)에서:

```bash
firebase deploy --only functions
```

배포가 끝나면 터미널에 함수 URL이 출력됩니다.

---

## 3. 노션 페이지 갱신 테스트

배포 후 아래 URL로 **GET** 또는 **POST** 요청을 보내면, 구글 시트 일일 리포트 갱신 + 노션 7종(일일로그, 취소로그, 매출일지, 플랫폼분석, 인원현황, 매출·가동률 대시보드) 동기화가 한 번 실행됩니다.

**현재 사용 중인 URL (Cloud Run):**

```
https://rundailyreportnow-iphheelkyq-uc.a.run.app
```

**방법 1 — 브라우저**  
위 주소를 주소창에 복사해 넣고 엔터 (GET 요청).

**방법 2 — PowerShell**  
⚠️ URL만 붙여넣으면 안 됩니다. **전체 명령**을 복사해서 실행하세요.

```powershell
Invoke-RestMethod -Uri "https://rundailyreportnow-iphheelkyq-uc.a.run.app" -Method GET
```

**방법 3 — curl**

```bash
curl "https://rundailyreportnow-iphheelkyq-uc.a.run.app"
```

응답 예시:

```json
{
  "success": true,
  "message": "Google Sheet daily report updated",
  "notionTest": { "ok": true, "tokenPresent": true, "message": "연결 성공" }
}
```

`notionTest.ok`가 `true`이면 노션 연동 정상. 노션에서 해당 페이지들이 갱신되었는지 확인하면 됩니다.

---

## 4. 자동 갱신 스케줄 (JST)

| 리포트 | 스케줄 | 내용 |
|--------|--------|------|
| **인원현황** | 매일 **08:50** | 구글 시트 인원현황 시트 갱신 + 노션 인원현황 페이지 동기화 |
| 일일로그·취소·매출일지·플랫폼 | 매일 (스케줄 설정값) | 일일 리포트 스케줄에 따라 구글 시트 + 노션 7종 갱신 |
| 플랫폼 분석 | 매시 **정시** | 구글 시트·노션 플랫폼 분석 1시간마다 갱신 |

인원현황 페이지는 **매일 08:50 JST**에 자동으로 구글 시트와 동일 데이터로 노션에 반영됩니다.

---

## 5. (선택) 매출 요약 노션 DB — 검색/필터용

매출 대시보드 동기화 시 **노션 DB**에 월별·건물별·플랫폼별 매출을 행으로 넣어 두면, 노션 기본 **필터·정렬·검색**으로 조회할 수 있습니다.

**설정 방법**

1. 노션에서 **새 데이터베이스** 생성 (매출 대시보드 페이지 안 또는 별도 페이지).
2. 속성 추가:
   - **Name** (제목) — 예: `월별_2025-02`, `건물_가부키초`, `플랫폼_Airbnb`
   - **Category** (선택) — 옵션: `월별`, `건물별`, `플랫폼`
   - **Revenue** (숫자) — 매출
   - **Note** (텍스트, 선택) — 보조 설명
3. DB 페이지 URL에서 **database_id** 복사 (주소창의 32자리 hex).
4. `functions/config/notionReportPages.js`에서 `salesDashboardDatabaseId`에 해당 ID 문자열 설정 (예: `"abc123def456..."`).
5. 해당 DB 페이지를 노션 연동(Connections)에 추가한 뒤, 배포·갱신 실행.

한글 속성명을 쓰려면 **이름**, **구분**, **매출**, **비고** 로 만들면 됩니다. (구분 옵션: `월별`, `건물별`, `플랫폼`)

---

## 리전이 다른 경우

배포 로그에 나온 함수 URL을 그대로 사용하면 됩니다.  
예: `https://asia-northeast3-my-booking-app-3f0e7.cloudfunctions.net/runDailyReportNow`
