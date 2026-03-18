# 노션 매출 대시보드 설계 (우리 시스템 연동)

## 1. 목표

- **노션 매출 대시보드**에서 보는 숫자 = **우리 시스템(React 앱) 매출 대시보드**에서 보는 숫자와 **동일**하게 한다.
- 우리 시스템에서 보고 싶은 데이터를 **같은 기준으로 계산**해 노션에서 불러와 보여준다.

---

## 2. 우리 시스템 매출 관련 화면 정리

| 화면 | 경로 | 데이터 소스 | 주요 지표 |
|------|------|-------------|-----------|
| **Revenue Dashboard** | `/revenue` | Firestore `reservations` (companyId, confirmed) | 월별/기수별 **overlap 매출**, 플랫폼별, 건물별, 차트 |
| **TodaySummaryDashboard** | `/` (메인) | 동일 | 당월/전월 매출(Revenue Monthly 동일), 예약 접수 건수, 가동률, 플랫폼별 매출 |
| **Sales Log Dashboard** | `/sales-log` | Firestore `reservations` + `salesLogMemos` | 기록일별 매출·가동률, 6개월 추이, 건물별 (다이쿄초·사노시·오쿠보A동 제외) |
| **Room Performance** | `/room-performance` | 동일 | 건물별 가동률·매출 (Revenue와 동일 로직) |

**공통 기준**
- **제외 건물**: 다이쿄초 (화면 집계에서 제외, DB는 유지)
- **매출 계산**: `arrival` / `departure` 기준 **해당 기간과 겹치는 숙박일만** `pricePerNight × overlapNights` 로 산입 (예약 1건 전체 금액를 한 번에 넣지 않음)
- **금액 필드**: `totalPrice ?? price`
- **companyId** 필터 적용

---

## 3. 현재 노션 매출 대시보드와의 차이

| 항목 | 현재 노션 (runNotionDashboardSync) | 우리 시스템 (Revenue / TodaySummary) |
|------|-------------------------------------|--------------------------------------|
| **데이터 조회** | `stayMonth == "YYYY-MM"` 로 쿼리 | `companyId`, `status == "confirmed"` 로 전건 조회 후 메모리 필터 |
| **매출 집계** | 예약 1건당 **전체 금액** 합산 | 해당 월과 **겹치는 숙박일만** `pricePerNight × overlapNights` 합산 |
| **제외 건물** | 다이쿄초 제외 (room 수 계산 시) | 다이쿄초 제외 (예약 필터 시) |
| **표시 내용** | 한 줄 요약 텍스트만 | (노션은 현재 요약만, 시스템은 KPI·차트·테이블) |

→ **집계 방식이 다르기 때문에** 지금 노션 매출 숫자는 Revenue Dashboard / TodaySummary와 **일치하지 않음**.  
연동을 제대로 하려면 **노션용 집계도 우리 시스템과 동일한 로직(overlap 기반)**으로 맞춰야 함.

---

## 4. 데이터 소스·계산 통일 방안

### 4.1 단일 진실 공급원 (Single Source of Truth)

- **진실 공급원**: Firestore `reservations` (companyId, status confirmed) + 우리 시스템과 **동일한 집계 규칙**.
- 노션 매출 대시보드는 **이 규칙으로 계산한 결과만** 표시.

### 4.2 우리 시스템과 동일하게 할 규칙

1. **예약 필터**
   - `companyId == DEFAULT_COMPANY_ID`
   - `status == "confirmed"`
   - `building != "다이쿄초"`

2. **당월 매출 (Monthly Revenue)**
   - 해당 월 `[monthStart, monthEnd]` 와 **arrival–departure가 겹치는 구간**만 계산.
   - `overlapNights = 겹치는 숙박 일수`, `pricePerNight = totalPrice / totalNights`  
     → `당월 매출 += pricePerNight * overlapNights`
   - Revenue Dashboard / TodaySummary의 “Monthly”와 **완전 동일** 로직.

3. **전월 매출**
   - 동일 로직으로 전월 구간에 대해 계산 (전월 대비 증감 표시용).

4. **가동률 (Occupancy)**
   - 우리 시스템: **점유 room-nights / 전체 가용 room-nights** (다이쿄초·사노시 제외 등 동일 적용).
   - 노션용도 **같은 BUILDING_ROOMS(또는 ACTIVE 건물 목록)·같은 일수** 기준으로 계산.

5. **플랫폼별 매출**
   - overlap 매출 계산 시 `platform`(또는 referer) 기준으로 A/B 구분 집계 (TodaySummary와 동일).

6. **예약 접수 (bookDate 기준)**
   - 우리 시스템 Performance / TodaySummary와 동일: **bookDate**가 해당 월에 들어온 건만, 중복 제거 등 동일 규칙.

이렇게 하면 “우리 시스템에서 보는 데이터를 노션에서 불러와 보여준다”는 요구를 만족할 수 있음.

---

## 5. 노션에 보여줄 지표 제안 (1차)

우리 시스템에서 “매출 대시보드”로 보는 것과 맞추는 관점에서 후보.

### 5.1 필수 (시스템과 숫자 일치)

- **당월 누적 매출 (¥)**  
  - overlap 기반 당월 매출 합계 (Revenue Monthly = TodaySummary “매출”과 동일).
- **전월 대비 증감 (%, 절대값)**  
  - 전월 overlap 매출 대비 당월 증감.
- **당월 예약 건수**  
  - bookDate 기준 해당 월 신규 확정 예약 (일일로그/Performance와 기준 통일 시 건수 일치 가능).
- **당월 가동률 (%)**  
  - 점유 room-nights / 전체 가용 room-nights (우리 시스템 Occupancy Rate와 동일).

### 5.2 선택 (우리 시스템에 있는 데이터)

- **플랫폼별 매출**  
  - Airbnb / Booking.com 금액(비율).
- **건물별 매출**  
  - 건물별 overlap 매출 (Revenue Dashboard 건물별과 동일).
- **기간 표시**  
  - 집계 기준: “당월 1일 ~ 말일” 또는 “당월 1일 ~ 전일”(일일로그 MTD와 맞출 경우).

노션 UI 제약(테이블·콜아웃 위주)을 고려해, 1차는 **KPI 4개 + 플랫폼별** 정도로 시작하고, 필요 시 건물별 테이블을 추가하는 단계 설계를 권장.

---

## 6. 갱신 주기

- **현재**: `scheduledNotionDashboardSync` 매일 **09:00 JST**에 `runNotionDashboardSync()` 실행 → 매출·가동률 요약만 노션에 전달.
- **제안**:  
  - 매출 대시보드도 **같은 09:00 JST**에 갱신 유지.  
  - 단, `runNotionDashboardSync()` 내부에서 **우리 시스템과 동일한 overlap·가동률 로직**으로 재계산한 뒤, 그 결과를 노션 매출 대시보드에 넘기도록 변경.

---

## 7. 구현 방향 (옵션)

### Option A: Functions에서 “우리 시스템 로직” 직접 구현 (권장)

- **위치**: `functions/` (예: `runNotionDashboardSync` 또는 전용 모듈).
- **내용**:
  - Firestore에서 `reservations` (companyId, status confirmed) 조회.
  - 다이쿄초 제외.
  - **Overlap 기반** 당월/전월 매출, 플랫폼별 매출, 가동률, 예약 건수 계산 (Revenue / TodaySummary / Occupancy와 동일 규칙).
- **노션**: 계산 결과만 받아서 `syncNotionSalesDashboard(pageId, { tokyoNow, salesData })` 로 전달.  
  - `salesData`: 당월/전월 매출, 증감, 예약 건수, 가동률, 플랫폼별 등.
- **장점**: 노션과 우리 시스템 숫자 일치 보장, 스케줄·수동 갱신 모두 같은 로직 사용.

### Option B: 공유 로직 모듈

- Revenue Dashboard 등에서 쓰는 “overlap 매출·가동률” 로직을 **공용 모듈**로 분리(예: Node에서 실행 가능한 스크립트 또는 Cloud Functions 내 유틸).
- 노션 동기화는 이 모듈을 호출해 결과만 받아서 표시.
- **장점**: 프론트와 백엔드가 한 번만 정의한 규칙을 사용.  
- **단점**: 현재 프론트는 React/브라우저, 백은 Node이므로 로직 이식 또는 공통 스펙 문서화 필요.

### Option C: API 엔드포인트

- 우리 시스템(또는 별도 백엔드)에 “매출 대시보드 수치 API”를 두고, 같은 overlap·가동률 로직으로 응답.
- Functions는 해당 API를 호출해 결과를 노션에 전달.
- **장점**: 한 곳에서만 집계 로직 유지.  
- **단점**: API 설계·인증·배포 필요.

---

## 8. 정리

1. **연동 정의**: “노션 매출 대시보드 = 우리 시스템(Revenue / TodaySummary)과 **동일 데이터·동일 계산**”으로 정의.
2. **데이터 소스**: Firestore `reservations` + **overlap 기반 매출** + 우리 시스템과 동일한 제외 건물·가동률 기준.
3. **표시**: 당월 매출, 전월 대비, 예약 건수, 가동률, (선택) 플랫폼별·건물별.
4. **갱신**: 기존처럼 매일 09:00 JST, 단 계산 로직을 우리 시스템에 맞게 교체.
5. **구현**: 1차로 **Option A**(Functions에서 동일 로직 구현)로 진행하면, 별도 API 없이도 “우리 시스템처럼 노션에서 불러와 보여주기”를 만족할 수 있음.

이 설계대로 진행하면, 노션 매출 대시보드는 “우리 시스템 매출 대시보드와 연동되어, 보고 싶은 데이터를 같은 기준으로 노션에서 보는” 형태로 완성할 수 있습니다.
