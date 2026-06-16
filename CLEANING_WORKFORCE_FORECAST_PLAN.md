# Cleaning Workforce Forecast System - Planning Document

Figma Board:
https://www.figma.com/board/YIQlzAhH5oNkTAdyVETlu6

## Purpose

Forecast the required cleaning headcount and pure labor cost for the next 3 months.

The forecast covers confirmed bookings, projected booking inflow, and same-day booking corrections together.

The primary goal is not monthly cost estimation but determining day-by-day and week-by-week how many cleaning staff are needed, calculated in advance.

## Core Rules

- Cleaning demand is calculated on a checkout basis.
- Forecast horizon: next 3 months.
- Historical reference: past 1 year.
- Daikyocho and Sano are excluded from all calculations.
- Confirmed demand and projected demand must always be displayed separately.
- Headcount output is split into three layers: Mathematical Minimum, Operational Minimum, and Recommended Operating Headcount.
- The calendar view and weekly view are the primary operational displays.
- Only pure labor cost is calculated. Transportation and fixed allowances are excluded.
- Forecast data must reactively recalculate when reservation events occur.
- Setting task data is excluded from workforce forecasting input. Setting operations are managed separately via Slack automation.

## Slack Cleaning Setting Reference

Calendar aggregation follows the same logic as the cleaning-setting channel in `functions/modules/slackReports.js`.

- Cleaning count: confirmed reservations where departure equals the reference date.
- Setting count: confirmed reservations where arrival equals the reference date and the room is not already scheduled for cleaning.
- Turnover: same room has both departure and arrival on the same date.
- Excluded buildings: Daikyocho, Sano.
- Sort order: matches the Slack cleaning report building order.

The dashboard, Google Sheet, and Slack notifications must all read from this single source.

## Building Reference Hours

| Building | Reference Hours |
| --- | --- |
| Araki-cho A | 3.75 hours |
| Araki-cho B | 4.5 hours |
| Kabuki-cho | 3 hours |
| Baba | 4.2 hours |
| Okubo A | 2-person: 3.5 hours per person (planning default) / 1-person fallback: 7 hours |
| Okubo B | 2-person: 3.5 hours per person (planning default) / 1-person fallback: 7 hours |
| Okubo C | 2-person: 3.5 hours per person (planning default) / 1-person fallback: 7 hours |

## Okubo Operating Constraints

- Okubo A, Okubo B, and Okubo C are detached-house type properties.
- Default operation requires 2-person deployment per unit.
- 2-person operation planning value: 3.5 hours per person per unit.
- 1-person fallback: 7 hours per unit. This mode is only applied when staffing shortage is explicitly declared.
- Okubo cleaning count is displayed as 2 cleaning units per physical checkout because the default operation is 2-person deployment.
- Okubo labor cost is still calculated from the physical checkout count: physical checkout count x 2 workers x 3.5 hours.
- The Operational Minimum Headcount calculation must enforce Okubo's 2-person baseline constraint before any buffer is applied.

## Labor Cost Example

| Deployment Mode | Calculation | Total Person-Hours |
| --- | --- | --- |
| 1-person | 1 person x 7 hours | 7 person-hours |
| 2-person standard | 2 persons x 3.5 hours | 7 person-hours |

## Hourly Rate Scenarios

Worker DB is not available. All calculations use scenario-based average rates.

| Scenario | Hourly Rate |
| --- | --- |
| Low | 1,250 yen |
| Base | Average value |
| High | 1,700 yen |

## Timecard App API Integration Roadmap

Current calculations use scenario-based rates. Future integration with a planned timecard app API will upgrade to individual worker-level rates.

Integration principles:
- Keep the single-sheet structure. Only the rate input source changes from scenario values to API data.
- Calendar calculation logic stays unchanged. Only the labor cost segment is replaced with individual rate logic.
- Store individual hourly rates, work minutes, and monthly totals separately to support both daily operations and monthly settlement.
- If the API is unavailable, automatically fall back to scenario-based calculation.

Integration data keys:
- workerId
- workerName
- hourlyRate
- wageType
- workStartAt
- workEndAt
- workMinutes
- building
- assignedTasks
- laborCostDaily
- laborCostMonthly

Integration phases:
1. Phase 1: Operate with scenario-based rates.
2. Phase 2: Read-only integration with timecard app API.
3. Phase 3: Switch labor cost calculation to individual hourly rates.
4. Phase 4: Add assignment recommendations, custom rules, and automated setting features.

## Core Calculation Formulas

```
Total Forecasted Checkouts = Confirmed Checkouts + Projected Inflow Checkouts + Same-Day Booking Correction

Total Required Work Hours = SUM( forecasted checkouts per building x building reference hours )
  Note: Okubo uses 3.5 hours per person at 2-person mode (planning default), 7 hours at 1-person fallback.

Mathematical Minimum Headcount = CEILING( Total Required Work Hours / productive hours per person, 1 )
  productive hours per person default: 7 hours (operator-configurable)

Operational Minimum Headcount = Mathematical Minimum + Okubo 2-person baseline enforcement
  If Okubo demand requires N units and current headcount does not satisfy 2 persons per active Okubo unit,
  headcount is raised to meet that constraint.

Recommended Operating Headcount = Operational Minimum + 10 to 15 percent buffer
  High-load days may apply a higher buffer.

Pure Labor Cost = person-hours x hourly rate
Booking Pickup Rate = (recent 4 weeks x 60%) + (same period prior year x 40%)
```

## Same-Day Booking Definition

A same-day booking is counted only when a vacant room receives a new booking with a same-day check-in.

A check-in for a room that was already booked is not counted as a same-day booking correction.

---

## Storyboard

### Step 1: Goal Definition

Produce Mathematical Minimum Headcount, Operational Minimum Headcount, Recommended Operating Headcount, and projected pure labor cost for the next 3 months.

Use booking pickup rate, 1-year historical patterns, and same-day booking inflow as correction inputs.

Setting task demand is not an input to workforce forecasting. It is managed separately via Slack automation.

### Step 2: Data Collection

Collect current confirmed reservation data.

Fields collected: check-in date, checkout date, building, room, reservation status.

Collect past 1 year of reservation history.

Include room-level active periods.

Hourly rates are scenario-based since a worker DB is not available.

Actual past labor cost data is used for backtest and forecast error verification only.

### Step 3: Data Cleaning and Standardization

Calculate active days per room.

Rooms that opened mid-year are normalized against their actual operating period, not 365 days.

Building names and room names are standardized.

Only confirmed reservations are used as demand input.

Cancelled reservations are excluded.

Setting demand is excluded from the workforce forecast input at this stage.

### Step 4: Demand Forecasting

Calculate confirmed checkout count per date as the baseline demand.

For rooms not yet booked, calculate projected inflow using pickup rate.

Apply same-day booking correction factor separately.

Confirmed demand and projected demand are stored and displayed separately.

Total forecasted checkouts = confirmed checkouts + projected inflow + same-day correction.

### Step 5: Vacant Room Potential Check-In Assumption (Mandatory)

This step is mandatory and must not be removed.

For each date, identify rooms that have no active booking (vacant rooms).

A vacant room may receive a new confirmed booking or a same-day booking check-in.

If a projected check-in is assumed for a vacant room, the checkout date of that projected booking must feed into future cleaning demand on the corresponding future date.

The forecast logic must trace the full chain: vacant room potential check-in to future checkout to cleaning demand.

This assumption is included in the projected inflow calculation and must be explicitly tracked in the output data.

### Step 6: Booking Pickup Rate Calculation

Blend recent 4-week data with same-period prior-year data.

Recent 4 weeks: 60 percent weight.

Prior year same period: 40 percent weight.

This captures both recent trends and seasonal patterns.

Separate pickup rate by building, day of week, and lead time.

Lead time is defined as how many days before check-in the booking was made.

New rooms with insufficient history use the average of similar rooms in the same building.

### Step 7: Work Hours Calculation

Multiply forecasted checkout count by building reference hours.

Confirmed demand work hours and projected demand work hours are calculated separately.

Okubo A, B, C: use 3.5 hours per person at 2-person mode (planning default). Use 7 hours per unit when 1-person fallback is in effect.

Okubo displayed cleaning count is person-assignment based. One physical Okubo checkout is displayed as 2 cleaning units, while work hours and labor cost use the physical checkout count to avoid double counting.

Total Required Work Hours = sum across all buildings of (forecasted checkouts for building x building reference hours).

### Step 8: Headcount Output - Three Layers

Headcount is produced as three separate values. All three must be shown in the sheet and dashboard.

Layer 1: Mathematical Minimum Headcount
- Formula: CEILING( Total Required Work Hours / productive hours per person, 1 )
- Productive hours per person default: 7 hours (operator-configurable).
- This is the pure time-based theoretical minimum. It does not account for operational constraints.
- This value must be labeled clearly as a mathematical lower bound, not a safe operating target.

Layer 2: Operational Minimum Headcount
- Starts from Mathematical Minimum Headcount.
- Applies Okubo 2-person baseline constraint: if any Okubo unit is active on the date, headcount must be raised to ensure at least 2 persons are assigned to that unit.
- The Okubo constraint is non-negotiable in normal mode. It is only relaxed when 1-person fallback is explicitly declared by the operator.
- This value represents the true minimum needed to run operations without violating building-level constraints.

Layer 3: Recommended Operating Headcount
- Starts from Operational Minimum Headcount.
- Applies a buffer of 10 to 15 percent.
- High-load days may use a higher buffer.
- Confirmed demand only: show separately from total including projected demand.
- This is the value highlighted on the dashboard and used as the default display in daily and weekly calendars.

### Step 9: Labor Cost Calculation

Calculate pure labor cost only.

Exclude transportation and fixed allowances.

Formula: person-hours x hourly rate.

Low scenario: 1,250 yen per hour.

Base scenario: average rate.

High scenario: 1,700 yen per hour.

Show confirmed-demand labor cost and total-including-projected labor cost separately.

### Step 10: Dashboard Output

Show monthly Mathematical Minimum, Operational Minimum, and Recommended Operating Headcount for the next 3 months.

Show daily calendar view.

Show weekly calendar view.

Calendar fields per row: confirmed checkouts, projected inflow, same-day correction, Mathematical Minimum, Operational Minimum, Recommended Headcount, estimated pure labor cost.

Base calendar aggregation: cleaning count, setting count, turnover count. Setting count is displayed for reference but is not used as a workforce forecasting input.

Show monthly estimated pure labor cost.

Show peak-day Top 10.

Show confirmed demand and projected demand separately.

Show same-day correction volume separately.

Flag expected understaffing days: dates where demand is higher than typical.

Flag high-cost risk: dates where High scenario labor cost is significantly elevated.

Do not include unusual task volume alerts.

### Step 11: Backtest

Validate forecast accuracy over the most recent 8 weeks.

Compare forecasted checkout count against actual checkout count.

Compare projected labor cost against actual labor cost.

Separate cleaning count error from labor cost error.

Identify whether errors come from booking prediction, work-hour assumptions, or rate assumptions.

Review building-level error rates and use findings to update correction coefficients.

### Step 12: Google Sheet Structure

All blocks are placed on a single sheet. Do not split into multiple tabs.

Sheet name: Cleaning Workforce Forecast

Internal sections:
1. Summary block (top)
2. Config 1 - Hourly rate scenarios
3. Config 2 - Building reference hours and deployment mode
4. 3-month checkout forecast
5. Mathematical Minimum Headcount
6. Operational Minimum Headcount
7. Recommended Operating Headcount
8. Pure labor cost forecast
9. Daily calendar
10. Weekly calendar
11. Backtest
12. Dashboard summary

Daily calendar minimum columns:
- date
- weekday
- building
- cleaningCount
- settingCount (reference only, not used as forecast input)
- turnoverCount
- confirmedCO
- projectedCO
- totalCO
- estimatedWorkHours
- mathMinHeadcount
- operationalMinHeadcount
- recommendedHeadcount
- estimatedLaborCostLow
- estimatedLaborCostBase
- estimatedLaborCostHigh

Weekly calendar minimum columns:
- weekStart
- weekEnd
- building
- cleaningCountWeekly
- settingCountWeekly (reference only)
- turnoverCountWeekly
- totalWorkHoursWeekly
- mathMinHeadcountPeak
- operationalMinHeadcountPeak
- recommendedHeadcountPeak
- estimatedLaborCostBaseWeekly

### Step 13: Operations Loop and Re-sync Trigger Design

#### Fixed Daily Scheduler

- Run every day at 08:00 Asia/Tokyo.
- At each run: sync reservation data, recalculate full forecast for all buildings, update all headcount layers and labor cost values.

#### Retry and Failure Policy

- If the 08:00 run fails, automatically retry at 08:15 Asia/Tokyo.
- If the retry also fails, send a Slack alert to the operations channel.
- No further automatic retry after the 08:15 attempt. Manual intervention is required.

#### Event-Driven Partial Recalculation

- On reservation create, update, or cancel: immediately identify the impacted dates and windows (check-in date to checkout date, plus any adjacent vacant-room projection windows).
- Recalculate only the impacted dates and buildings. Do not run a full forecast.
- Apply results to the sheet incrementally.

#### Pickup Rate Re-learning

- Weekly: update pickup rate using the most recent 4 weeks and same period prior year.

#### Monthly Review

- Compare actual results against forecast.
- Review backtest report and update correction coefficients as needed.

#### Monitoring Fields

Each scheduler run must record the following fields:
- last_success_at: timestamp of the most recent successful run.
- last_failure_at: timestamp of the most recent failed run (null if no failure).
- run_duration: elapsed time in milliseconds for the run.
- processed_records: number of reservation records processed in the run.
- failure_reason: error message string if the run failed (null if successful).

These fields must be stored in a dedicated monitoring document in Firestore and updated after every run attempt, including retries.

### Step 14: Vacant Room Potential Check-In Assumption

This section defines a mandatory forecasting rule that must not be skipped or simplified.

- The forecast must cover not only confirmed reservations but also vacant rooms for each date in the forecast window.
- A vacant room is one with no active booking. Under normal conditions, a vacant room is assumed to be in a cleaned and ready state from the previous day.
- A vacant room may receive a new booking or a same-day booking at any time. This possibility must be kept open in the forecast.
- If a projected check-in is assumed for a vacant room, the checkout date of that projected booking must be added to future cleaning demand on the corresponding date.
- The forecast logic must trace the full chain: vacant room potential check-in to future checkout date to cleaning demand on that date.
- Setting data is excluded from workforce forecast input. Setting operations are managed via Slack automation and are not part of this system's headcount calculation.
- The final output is day-level, week-level, and month-level headcount across all three layers: Mathematical Minimum, Operational Minimum, and Recommended Operating Headcount.
- Headcount calculation is based on the sum of confirmed checkouts and projected checkouts, where projected checkouts include the vacant-room potential check-in assumption.

---

## Step 16: Single-Sheet Full Structure Review and Redesign Specification

This section is a complete structure review and implementation plan for redesigning the "청소인력예측" single-sheet layout so that each monthly calendar block carries its own month-scoped KPI block. This is a planning and spec document only. No code changes are made at this step.

---

### 1. Current Structure Map

The following table shows the exact row layout produced by `setup-cleaning-workforce-sheet.js` as of the current version. All row numbers are 1-indexed as they appear in Google Sheets. All columns are A through H (columns I onward are hidden).

```
Row  1    Global title row          "청소 인력 예측 시스템"           merged A:H
Row  2    Global subtitle row       "체크아웃 기준 | 미래 3개월 ..."   merged A:H
Row  3    Empty separator
Row  4    Global KPI row 1          next-30-days rolling values        A:H  ← PROBLEM: rolling window, not month-scoped
Row  5    Global KPI row 2          metadata / basis label             A:H  ← PROBLEM: says "매일 08:00", not month-scoped
Row  6    Instruction row           "안내: 각 날짜 셀에..."             merged A:H
Row  7    Empty separator

Row  8    April title row           "월간 캘린더 | 2026년 4월"         merged A:G
Row  9    April weekday header      "일 월 화 수 목 금 토"
Row 10    April week 1              calendar cells
Row 11    April week 2
Row 12    April week 3
Row 13    April week 4
Row 14    April week 5
Row 15    April week 6
Row 16    Empty separator

Row 17    May title row             "월간 캘린더 | 2026년 5월"         merged A:G
Row 18    May weekday header
Row 19    May week 1
Row 20    May week 2
Row 21    May week 3
Row 22    May week 4
Row 23    May week 5
Row 24    May week 6
Row 25    Empty separator

Row 26    June title row            "월간 캘린더 | 2026년 6월"         merged A:G
Row 27    June weekday header
Row 28    June week 1
Row 29    June week 2
Row 30    June week 3
Row 31    June week 4
Row 32    June week 5
Row 33    June week 6
Row 34    Empty separator

Row 35    "주간 요약" section title    merged A:H
Row 36    Weekly header row
Row 37    Current week data
Row 38    Next week data
Row 39    Empty separator

Row 40    "건물별 3개월 요약" title     merged A:H
Row 41    Building table header row
Row 42    Monthly workforce pool summary header  ← written by update script
Row 43    April workforce pool row               ← written by update script
Row 44    May workforce pool row                 ← written by update script
Row 45    June workforce pool row                ← written by update script
Row 46    Empty row
Row 47    Building header row
Row 48    Arakicho A data
Row 49    Arakicho B data
Row 50    Kabukicho data
Row 51    Takadanobaba data
Row 52    Okubo A data
Row 53    Okubo B data
Row 54    Okubo C data
Row 55    Empty separator

Row 56    "설정 | 건물별 청소 기준" title  merged A:H
Row 57    Config header row
Row 58    Arakicho A config
Row 59    Arakicho B config
Row 60    Kabukicho config
Row 61    Takadanobaba config
Row 62    Okubo A config
Row 63    Okubo B config
Row 64    Okubo C config
Row 65    Empty separator

Row 66    "API 입력 예정 데이터" title   merged A:H
Row 67    API header row
Row 68+   API data rows (up to 120 building-date rows)
```

Key structural problems in current layout:

- Rows 4-5 are global. They are physically above the April calendar only. May and June calendars have no dedicated KPI block.
- The update script writes a secondary KPI hint into columns B-H of the calendar title row (e.g., row 8 columns B-H for April). This is a workaround, not a proper block. It overwrites the merge or leaves partial data in a merged cell area.
- The label "다음 30일 총 청소" in row 4 is factually incorrect when the sheet represents three distinct months.
- The `findRowByLabel` anchor strategy in the update script depends on the title row text being in column A. The KPI hint written to B-H of the title row conflicts with the merge that spans A:G.

---

### 2. Target Structure Map

Each monthly block is expanded to include a dedicated 2-row KPI block immediately above the calendar title. The global rolling-window KPI at rows 4-5 is removed. The instruction row is retained in a condensed form.

```
Row  1    Global title row          "청소 인력 예측 시스템"             merged A:H
Row  2    Global subtitle row       "체크아웃 기준 | 미래 3개월 ..."     merged A:H
Row  3    Global instruction row    "안내: 각 날짜 셀에..."              merged A:H
Row  4    Empty separator

[--- APRIL BLOCK  (11 rows, rows 5-15) ---]
Row  5    April KPI row 1           month cleaning count / op min / recommended / labor cost   A:H
Row  6    April KPI row 2           confirmed CO / projected CO / last update / basis label    A:H
Row  7    April title row           "월간 캘린더 | 2026년 4월"           merged A:H (full width, no B-H hint)
Row  8    April weekday header      "일 월 화 수 목 금 토"
Row  9    April week 1
Row 10    April week 2
Row 11    April week 3
Row 12    April week 4
Row 13    April week 5
Row 14    April week 6
Row 15    Empty separator

[--- MAY BLOCK  (11 rows, rows 16-26) ---]
Row 16    May KPI row 1
Row 17    May KPI row 2
Row 18    May title row             "월간 캘린더 | 2026년 5월"
Row 19    May weekday header
Row 20    May week 1
Row 21    May week 2
Row 22    May week 3
Row 23    May week 4
Row 24    May week 5
Row 25    May week 6
Row 26    Empty separator

[--- JUNE BLOCK  (11 rows, rows 27-37) ---]
Row 27    June KPI row 1
Row 28    June KPI row 2
Row 29    June title row            "월간 캘린더 | 2026년 6월"
Row 30    June weekday header
Row 31    June week 1
Row 32    June week 2
Row 33    June week 3
Row 34    June week 4
Row 35    June week 5
Row 36    June week 6
Row 37    Empty separator

Row 38    "주간 요약" section title
Row 39    Weekly header row
Row 40    Current week data
Row 41    Next week data
Row 42    Empty separator

Row 43    "건물별 3개월 요약" section title
Row 44    Monthly workforce pool summary header
Row 45    April workforce pool row
Row 46    May workforce pool row
Row 47    June workforce pool row
Row 48    Empty separator
Row 49    Building header row
Row 50    Arakicho A
Row 51    Arakicho B
Row 52    Kabukicho
Row 53    Takadanobaba
Row 54    Okubo A
Row 55    Okubo B
Row 56    Okubo C
Row 57    Empty separator

Row 58    "설정 | 건물별 청소 기준" section title
Row 59    Config header
Row 60    Arakicho A config
Row 61    Arakicho B config
Row 62    Kabukicho config
Row 63    Takadanobaba config
Row 64    Okubo A config
Row 65    Okubo B config
Row 66    Okubo C config
Row 67    Empty separator

Row 68    "API 입력 예정 데이터" section title
Row 69    API header row
Row 70+   API data rows
```

#### Row-Offset Template Per Month Block

Each month block is exactly 11 rows. Using a zero-based offset from the month's anchor row:

```
offset 0   KPI row 1  — A:H  — cleaning count, op min, recommended, labor cost
offset 1   KPI row 2  — A:H  — confirmed CO, projected CO, last update, basis
offset 2   Calendar title row  — A:H merged
offset 3   Weekday header row
offset 4   Week 1
offset 5   Week 2
offset 6   Week 3
offset 7   Week 4
offset 8   Week 5
offset 9   Week 6
offset 10  Empty separator
```

Month anchor rows (1-indexed):
- Month 0 (current month): anchor = 5
- Month 1 (next month):    anchor = 16
- Month 2 (month after):   anchor = 27

Derived positions:
- kpiRow1      = anchor + 0
- kpiRow2      = anchor + 1
- titleRow     = anchor + 2
- weekdayRow   = anchor + 3
- firstWeekRow = anchor + 4
- lastWeekRow  = anchor + 9
- separatorRow = anchor + 10

In the setup script, `monthMeta` must store all six of these positions for each month, not just titleRow and weekdayRow.

#### KPI Row 1 Field Layout (A:H, 8 cells)

```
A   label   "N월 총 청소"
B   value   integer count (confirmedCO + projectedCO, all buildings, all dates in month)
C   label   "운영최소인원"
D   value   integer (peak daily operationalMinHeadcount across all dates in month)
E   label   "권장인원"
F   value   integer (peak daily recommendedHeadcount across all dates in month)
G   label   "예상인건비(Base)"
H   value   yen-formatted integer (sum of estimatedLaborCostBase, all dates in month)
```

#### KPI Row 2 Field Layout (A:H, 8 cells)

```
A   label   "확정 CO"
B   value   integer (sum confirmedCO, all buildings, all dates in month)
C   label   "예상 CO(빈객실)"
D   value   integer (sum projectedCO, all buildings, all dates in month)
E   label   "업데이트"
F   value   timestamp string YYYY-MM-DD HH:mm (Asia/Tokyo, actual write time)
G   label   "기준"
H   value   "확정+빈객실 유입 예상"
```

No cell in KPI row 1 or KPI row 2 may contain the phrase "다음 30일" or reference a rolling window.

---

### 3. Required Change List (Severity Ordered)

#### Severity 1 — Correctness Breaking

These issues produce wrong numbers or wrong structure if not fixed first.

1. Remove the global rolling-window KPI block from rows 4-5.
   - The label "다음 30일 총 청소" and its computed value are factually wrong for May and June.
   - These rows must be removed from `buildSheetModel()` and the corresponding write block must be removed from `updateSheetWithForecast()`.

2. Add per-month KPI rows to `buildSheetModel()`.
   - Each month loop in `buildSheetModel()` must push 2 placeholder KPI rows before the title row.
   - `monthMeta` must record `kpiRow1` and `kpiRow2` positions.

3. Change KPI aggregation in `updateSheetWithForecast()` from rolling next-30 to month-scoped.
   - The `next30` date range and `next30Agg` accumulator must be removed.
   - For each month in `monthlyData`, compute the month-scoped KPI values from `model.daily` using only dates whose string starts with that month key.
   - Write to the corresponding `kpiRow1` and `kpiRow2` positions derived from the title row offset.

4. Remove the B-H hint write on the calendar title row.
   - The current workaround writes month summary to `B${rowIdx + 1}:H${rowIdx + 1}` which partially overlaps the merged title cell. This must be removed once dedicated KPI rows exist.

#### Severity 2 — Layout Integrity

5. Extend the title row merge to full A:H width.
   - Currently the calendar title merge is A:G (7 columns). After removing the B-H hint, the merge should extend to A:H to match the KPI rows above it and be visually consistent.

6. Update `applyLayout()` in the setup script to format the KPI rows.
   - KPI rows need background color (`COLORS.cardBg`), bold labels, border styling matching the existing KPI block design.
   - The setup script currently only applies KPI styling to rows 3-5 (0-indexed). After redesign, KPI styling must be applied to the 2 KPI rows of each month block.

7. Update frozen row count.
   - Currently `frozenRowCount: 2` freezes the global title and subtitle. After redesign this is still correct (rows 1-2 remain the global header). No change needed here, but must be verified.

8. Update `updateDimensionProperties` row height assignments.
   - Currently the setup script sets row heights for `titleRow`, `weekdayRow`, and `firstWeekRow` through `lastWeekRow` using `monthMeta` positions. After adding 2 KPI rows per block, the `titleRow` offset shifts by 2. The height assignment must use the new `monthMeta.titleRow` value which accounts for the 2-row KPI offset.

#### Severity 3 — Anchor Stability

9. All section title anchors below the calendar area shift by 6 rows.
   - The current sections start at row 35 (주간 요약), 40 (건물별), etc. After adding 2 KPI rows to each of 3 month blocks (6 extra rows total) and removing 4 global rows (rows 3-6: empty + KPI1 + KPI2 + instruction → replaced by 1 instruction + 1 empty = net -2), the net shift is +6 - 2 = +4 rows downward.
   - The sections `주간 요약`, `건물별 3개월 요약`, `설정 | 건물별 청소 기준`, `API 입력 예정 데이터` will move down by approximately 4 rows.
   - All of these sections are located via `findRowByLabel()` which searches by text content, not by fixed row number. They will continue to be found correctly as long as the label text is unchanged. No hardcoded row numbers must be used.

10. The update script's `monthRows` scanner must still find title rows correctly.
    - Currently it searches for rows starting with "월간 캘린더 | ". After the redesign, the title row is still at `offset 2` within each month block and still contains "월간 캘린더 | ". The scanner will still find it. However, the derived position for KPI write must change from `B${rowIdx + 1}` (old workaround) to `A${rowIdx - 1}:H${rowIdx - 1}` (kpiRow1) and `A${rowIdx}:H${rowIdx}` (kpiRow2).

#### Severity 4 — Label and Display

11. Replace all "다음 30일" label text in `buildSheetModel()`.
    - The placeholder text on row 4 (values[3]) currently says "다음 30일 총 청소". This row is removed. Verify no other row in the model still carries this phrase.

12. Month label in KPI row 1 must include the month number.
    - "N월 총 청소" must use the actual month number from the title label (e.g., "4월 총 청소" for April).
    - Extract month number from `monthMeta.label` or from `monthKey`.

13. Basis label in KPI row 2 must not use rolling-window language.
    - Cell H of KPI row 2 must say "확정+빈객실 유입 예상", never "다음 30일" or "최근 4주".

---

### 4. Implementation Checklist for Engineers

Use this checklist before writing any code for the redesign.

#### Source-of-Truth Row Anchor Strategy

- Do not use any hardcoded row numbers in the update script for section locations.
- The only hardcoded row anchors allowed are in the setup script's `buildSheetModel()` return value, where `monthMeta` is built.
- The update script must derive all write positions from either: (a) `findRowByLabel()` results, or (b) offsets relative to `findRowByLabel()` results.
- After the redesign, KPI row 1 is at `rowIdx - 1` (0-indexed array) = sheet row `rowIdx` (1-indexed). KPI row 2 is at `rowIdx` (0-indexed) = sheet row `rowIdx + 1` (1-indexed). Calendar title is at `rowIdx + 1` (0-indexed) = sheet row `rowIdx + 2` (1-indexed). Verify this arithmetic before writing.

Wait — clarification: `rowIdx` is the 0-indexed position in the `values[]` array. In the Google Sheets API, row numbers are 1-indexed. So:

```
rowIdx (0-based array index of title row)
Sheet row of title = rowIdx + 1
Sheet row of kpiRow1 = rowIdx + 1 - 2 = rowIdx - 1
Sheet row of kpiRow2 = rowIdx + 1 - 1 = rowIdx
```

In range notation (1-indexed):
- KPI row 1: `A${rowIdx - 1}:H${rowIdx - 1}`
- KPI row 2: `A${rowIdx}:H${rowIdx}`
- Calendar week cells: `${colToA1(c)}${rowIdx + 4 + w}` (title at rowIdx+2, weekday at rowIdx+3, weeks at rowIdx+4 through rowIdx+9)

#### Month Parser Robustness

- The regex `title.match(/(\d{4})년 (\d{1,2})월/)` is used to extract year and month from the title row.
- After the redesign, this regex must also produce the month key string `YYYY-MM` for KPI aggregation lookup.
- Add: `const monthKey = \`${m[1]}-${String(Number(m[2])).padStart(2, "0")}\`` immediately after the match.
- Verify `monthlyData.find((d) => d && d.monthKey === monthKey)` returns the correct entry.

#### KPI Write Range Safety

- Before writing KPI rows, confirm that `rowIdx - 1 >= 1` (i.e., there is at least one row above the title row). If `rowIdx < 2`, the KPI rows do not exist and writing must be skipped with a warning logged.
- After the redesign, the minimum `rowIdx` for a calendar title is 6 (0-based), so `rowIdx - 1 = 5` which is valid. Verify this after running setup.

#### Batch Update Ordering

- In `updateSheetWithForecast()`, process operations in this order to avoid stale data conflicts:
  1. Read current sheet values (`spreadsheets.values.get`).
  2. Clear the API data section range (`spreadsheets.values.clear`) — this is the only explicit clear needed.
  3. Build the full `updates` array.
  4. Execute `spreadsheets.values.batchUpdate` with all updates in a single call.
- Do not interleave reads and writes within the same sync run.

#### Merge and Unmerge Stability

- The setup script currently merges the calendar title row as A:G (7 columns). After the redesign, this merge should extend to A:H (8 columns) since the B-H hint workaround is removed.
- The KPI rows (kpiRow1 and kpiRow2) must NOT be merged. Each of the 8 cells (A through H) must hold an individual value (alternating label-value pairs).
- The setup script's unmerge call covers rows 0-500 columns 0-26 before rewriting. This is sufficient. Verify it still runs before the values write.

#### Column Width and Hidden Column Safety

- Columns A through G: 185px each (7 columns for calendar grid).
- Column H: 250px (wider for cost values and basis label).
- Columns I through Z: hidden.
- These settings are applied by the setup script and should not change. The update script never touches column dimensions. Verify this remains true after the redesign.

#### Regression Checks for Weekly, Building, and API Sections

- After the redesign, all three of these sections shift downward by approximately 4 rows net.
- The `findRowByLabel()` function finds them by text content. Confirm the following labels are unchanged and unique in the sheet:
  - "주간 요약"
  - "건물별 3개월 요약"
  - "설정 | 건물별 청소 기준"
  - "API 입력 예정 데이터"
  - "월별 최소 인력" (if present)
- After running setup + update, manually confirm each section label row is found correctly before assuming correctness.

#### Validation Queries After Write

After each test run of the update script, perform these checks:

1. Open the sheet. Confirm April KPI row 1 shows April-scoped values (not next-30 values).
2. Confirm May KPI row 1 exists and shows May-only values.
3. Confirm June KPI row 1 exists and shows June-only values.
4. Confirm no cell anywhere in rows 1 through 37 contains "다음 30일".
5. Confirm KPI row 2 shows confirmed CO and projected CO as separate values.
6. In the API data section, pick one April date. Sum its confirmedCO and projectedCO across all buildings. Confirm it matches the April total cleaning count in the April KPI row 1.
7. Confirm weekly summary section is still populated (not accidentally cleared or shifted into wrong rows).
8. Confirm building summary section still shows per-building data.

---

### 5. Acceptance Test Checklist

The redesign is accepted when all of the following pass without exception.

- April KPI row 1 is present at the row immediately above "월간 캘린더 | 2026년 4월".
- April KPI row 1 cell A contains "4월 총 청소" (not "다음 30일").
- April KPI row 1 cell B contains the total April cleaning count as an integer.
- April KPI row 1 cell D contains the peak daily operational minimum headcount for April as an integer.
- April KPI row 1 cell F contains the peak daily recommended headcount for April as an integer.
- April KPI row 1 cell H contains the total April estimated labor cost formatted as yen.
- April KPI row 2 shows confirmed CO and projected CO as separate labeled values.
- April KPI row 2 basis label (cell H) says "확정+빈객실 유입 예상".
- May KPI row 1 is present at the row immediately above "월간 캘린더 | 2026년 5월".
- May KPI values contain May-only data. Spot check: May total cleaning count must differ from April total cleaning count.
- June KPI row 1 is present at the row immediately above "월간 캘린더 | 2026년 6월".
- June KPI values contain June-only data.
- No row in the sheet has a label or value referencing a rolling 30-day window.
- Calendar cells for all three months still display the correct format: date line, cleaning count line, headcount line, cost line.
- Weekly summary section is populated with current and next week data.
- Building summary section is populated with 7 building rows.
- API data section contains at least one data row.
- Last update timestamp in each month's KPI row 2 reflects the actual sync run time, not a hardcoded placeholder.
- Running the setup script followed by the update script produces a valid sheet with no errors in the console.
- Running the update script alone (without setup) on an already-configured sheet also produces correct results with no errors.

---

## Step 15: Month-Based Top KPI Block Redesign Specification

This section defines the implementation-ready spec for replacing the current next-30-days rolling KPI with a month-based KPI aligned to each monthly calendar section. This is a planning/storyboard spec only. No code changes are made at this step.

### A. Structure Understanding

#### Current State

The current top KPI block (rows 4 and 5 of the sheet) is computed from a rolling 30-day window starting from today. This is structurally misaligned with the monthly calendar sections below it, which are organized by calendar month (April, May, June). A user looking at the April calendar cannot directly read April-only totals from the top KPI block.

The sheet layout currently is:

- Row 4: next-30-days total cleaning count, next-30-days peak operational min headcount, fixed staff, support pool, total pool.
- Row 5: estimated labor cost base, last update timestamp, basis label.
- Below row 5: three monthly calendar sections, each prefixed by a title row "월간 캘린더 | YYYY년 MM월".

#### Target State

Each monthly calendar section must have its own dedicated KPI summary that represents that month only. The top KPI block (rows 4 and 5) serves as the KPI for the earliest active month (the month containing today or the first month in the forecast window). Each subsequent month section carries its own KPI summary in the row adjacent to its title row.

Active month determination rule:

- The active month is the calendar month that contains today's date in Asia/Tokyo timezone.
- If today is within a month that has a calendar section in the sheet, that section's KPI is the primary KPI displayed in rows 4 and 5.
- All three month sections (current month, next month, month after next) each display their own month-scoped KPI in the title row area of their section.

#### How Month Key is Derived

- Month key format: YYYY-MM (e.g., 2026-04).
- All date boundaries are evaluated in Asia/Tokyo timezone.
- Month start = first day of the calendar month at 00:00 Asia/Tokyo.
- Month end = last day of the calendar month at 23:59 Asia/Tokyo.
- A checkout date falls in a month if its date string starts with that month key.

### B. Monthly KPI Specification

#### KPI Row 4 Field Definitions

- A4 to B4: Monthly Total Cleaning Count.
  - Value: sum of (confirmedCO + projectedCO) for all buildings across all dates in the month.
  - Label: "M월 총 청소건수" where M is the month number.
  - Unit: integer count.

- C4 to D4: Monthly Minimum Required Headcount.
  - Value: peak daily operationalMinHeadcount across all dates in the month.
  - This is the Operational Minimum layer (not Mathematical Minimum), because Okubo 2-person constraint must be included.
  - Label: "월 최소인원(운영기준)".
  - Unit: integer count.

- E4 to F4: Monthly Recommended Operating Headcount.
  - Value: peak daily recommendedHeadcount across all dates in the month.
  - Label: "월 권장인원".
  - Unit: integer count.

- G4 to H4: Monthly Estimated Pure Labor Cost Base Scenario.
  - Value: sum of estimatedLaborCostBase for all buildings across all dates in the month.
  - Label: "월 예상인건비(Base)".
  - Unit: Japanese yen integer, formatted with comma separator and yen symbol.

#### KPI Row 5 Field Definitions

- A5 to B5: Monthly Confirmed Checkout Count.
  - Value: sum of confirmedCO for all buildings across all dates in the month.
  - Label: "확정 CO".
  - Unit: integer count.

- C5 to D5: Monthly Projected Checkout Count from Vacant-Room Inflow.
  - Value: sum of projectedCO for all buildings across all dates in the month.
  - This value originates only from the vacant-room potential check-in simulation. It does not include setting task volume.
  - Label: "예상 CO(빈객실)".
  - Unit: integer count (rounded up from float simulation output).

- E5 to F5: Last Update Timestamp.
  - Value: the timestamp at which the forecast was last written to the sheet, formatted as YYYY-MM-DD HH:mm in Asia/Tokyo.
  - Label: "업데이트".

- G5 to H5: Basis Label.
  - Value: static text "확정+빈객실 유입 예상".
  - This label must not say "다음 30일" or any rolling-window phrasing.

#### Formula-Level Logic for Each KPI

Monthly Total Cleaning Count:
```
monthCleaningCount = SUM over all dates D in month:
  SUM over all buildings B:
    confirmedCO(D, B) + projectedCO(D, B)
```

Monthly Minimum Required Headcount (Operational Minimum):
```
monthOpMin = MAX over all dates D in month:
  SUM over all buildings B:
    operationalMinHeadcount(D, B)

Where operationalMinHeadcount(D, B):
  totalJobHours(D, B) = checkoutCount(D, B) x buildingReferenceHours(B)
  mathMin(D, B) = CEILING( totalJobHours(D, B) / productiveHoursPerPerson )
  okuboFloor(D, B) = 2 if building is Okubo type and checkoutCount > 0, else 0
  operationalMin(D, B) = MAX( mathMin(D, B), okuboFloor(D, B) )
```

Monthly Recommended Headcount:
```
monthRecommended = MAX over all dates D in month:
  SUM over all buildings B:
    recommendedHeadcount(D, B)

Where recommendedHeadcount(D, B):
  recommendedByHours = CEILING( totalJobHours(D, B) x (1 + bufferRate) / productiveHoursPerPerson )
  recommendedHeadcount(D, B) = MAX( recommendedByHours, okuboFloor(D, B) )
  bufferRate default = 0.15
```

Monthly Projected Checkout Count:
```
monthProjectedCO = SUM over all dates D in month:
  SUM over all buildings B:
    projectedCO(D, B)

projectedCO(D, B) is derived only from:
  vacant room count on date D for building B
  x pickup probability given lead time horizon
  x length-of-stay distribution
  projected future checkout dates assigned accordingly
Setting task count is never included in this value.
```

#### Confirmed vs Projected Split Rules

- confirmedCO: comes only from Firestore confirmed reservations with departure date matching the date.
- projectedCO: comes only from the vacant-room simulation. It is the fractional expected checkout demand derived from estimating potential check-ins on vacant rooms, distributed across future dates by length-of-stay probability.
- These two values are stored and displayed separately at all times. They must never be merged into a single field without explicit labeling.
- If a room has a confirmed reservation on date D, it is counted in confirmedCO for the departure date and is never also counted in projectedCO for the same date.
- Vacant rooms are identified as rooms with no active confirmed or projected occupancy on the given date, after running the day-by-day simulation forward.

### C. Cautions and Pitfalls

#### Date Boundary Issues

- All date comparisons must use Asia/Tokyo timezone. A reservation with departure at midnight UTC may shift to the previous date in Tokyo time.
- Month boundaries must be computed as the first and last calendar date in Tokyo timezone, not UTC.
- The month start for April 2026 is 2026-04-01 and the month end is 2026-04-30. Any checkout on 2026-04-30 must be counted in April, not May.
- The simulation window extends beyond the forecast end date by MAX_STAY_NIGHTS days to capture trailing projected checkouts. Checkouts that land after the month end must not be counted in that month.

#### Partial-Month Leakage from Rolling-Window Logic

- The current rolling 30-day logic can bleed across month boundaries. For example, running on April 2 includes dates from April 2 to May 1, mixing April and May demand in a single KPI.
- When switching to month-based KPI, the aggregation window must be fixed to the calendar month, not a rolling count from today.
- Do not reuse the next30 variable or next30Agg accumulator for month-based KPI. They must be replaced with month-scoped accumulators.

#### Double Counting Risk Between Confirmed and Projected

- A confirmed reservation already occupies a room and removes it from the vacant pool. If the simulation also projects a check-in for that room on the same date, it would double-count checkout demand.
- The occupancy tracking (confirmedOccupied map) must be populated before the vacant-room simulation runs for each date. The simulation must subtract confirmed occupancy from inventory before estimating vacantRooms.
- The current code does this correctly (confirmedOccupied is built first, then vacantRooms = inventory - confirmedOccupied - projectedOccupied). Verify this logic is not altered when changing the KPI aggregation scope.

#### Vacant-Room Projection Consistency with Checkout-Date Assignment

- When a projected check-in is assumed on date D with length of stay N nights, the projected checkout must be assigned to date D + N.
- If D + N falls outside the current month, the projected checkout contributes to the next month's demand, not the current month.
- Month-based KPI must only count checkouts whose date falls within the month, not the check-in date.
- Verify that projectedDeparture map entries use departure date as key, not arrival date.

#### Okubo Constraint Underestimation Risk

- If the peak daily operationalMin for a month is driven by a day with no Okubo checkouts, the Okubo 2-person floor is not applied. On a different day when Okubo does have checkouts, the floor kicks in.
- Monthly Minimum Required Headcount (peak daily operationalMin) is taken as the maximum across all days. This correctly captures days where Okubo demand forces the headcount up.
- Do not take the average daily operationalMin. Always take the peak (MAX). Averaging would underestimate the staff needed on high-demand days.

#### Display Mismatch Risk

- If the sheet title row says "YYYY년 MM월" but the KPI block displays a rolling 30-day value, users will assume the KPI matches the month shown. This is a silent display mismatch.
- After the redesign, every KPI label must explicitly name the month it represents (e.g., "4월 총 청소건수" not "총 청소건수").
- The basis label in G5:H5 must say the month name and must never say "다음 30일" or equivalent.

#### Update Timestamp Consistency

- The timestamp in E5:F5 must reflect the time the forecast data was written, not the time the sheet was opened or read.
- The timestamp must be stored as a string in YYYY-MM-DD HH:mm format in Asia/Tokyo timezone.
- If the 08:00 run fails and the retry writes at 08:16, the timestamp must reflect 08:16, not 08:00.

### D. Acceptance Criteria

The implementation is accepted when all of the following are true:

- When the sheet is synced and the April 2026 calendar section is present, the KPI displayed in the April calendar title row shows April-only totals for cleaning count, operational minimum headcount, recommended headcount, and labor cost.
- When the May 2026 calendar section is present, the KPI in its title row shows May-only totals with no April or June data included.
- When the June 2026 calendar section is present, the KPI in its title row shows June-only totals.
- The top KPI block (rows 4 and 5) shows the current active month only, not a rolling 30-day window.
- No field label in rows 4 and 5 contains the phrase "다음 30일" or "next 30 days" or any equivalent rolling-window description.
- The confirmed checkout count and projected checkout count are shown as separate values in the KPI block, not merged.
- The projected checkout count does not include setting task volume.
- Okubo buildings are reflected in the operational minimum headcount on days when they have checkout demand.
- The last update timestamp matches the actual time the sync function wrote to the sheet.
- A manual verification check: take any date in April, look up its daily row in the API data section, and confirm that its confirmedCO and projectedCO values sum correctly to the April cleaning count shown in the KPI.

## 15. 최신 재설정 반영 2026-04-30

### A. 월별 KPI 블록 재설정
- 상단 KPI를 전역 1개로 두지 않고 각 월 캘린더 위에 반복 배치한다.
- 4월 캘린더 위 KPI는 4월 값만, 5월은 5월 값만, 6월은 6월 값만 보여준다.
- 다음 30일 라벨과 롤링 집계는 월별 KPI 영역에서 사용하지 않는다.

월별 KPI 표기 항목:
- 해당월 총 청소
- 해당월 최소 필요인원
- 해당월 운영 권장인원
- 해당월 예상 순수 인건비 Base
- 해당월 확정 체크아웃
- 해당월 예상 체크아웃 빈객실 유입 반영
- 업데이트 시각
- 기준 확정 + 빈객실 유입 확률

### B. 최소인원 계산 기준 고정
- 최소인원은 청소 1건당 1명이 아니다.
- 시간 기반으로 계산한다.
- 총 필요시간 = 합계 건물별 예상 체크아웃 x 건물 기준시간
- 산식 최소인원 = CEILING 총 필요시간 / 1인 실근무시간
- 운영 최소인원 = 산식 최소인원 + 운영 제약 반영
- 운영 권장인원 = 운영 최소인원 + 버퍼

오쿠보 제약:
- 오쿠보 A/B/C는 기본 2인 운영 제약을 반영한다.
- 2인 기준 1인당 3.5h를 기본값으로 사용한다.
- 표시 청소건수는 물리 체크아웃 1건당 2건으로 반영한다.
- 1인 fallback 7h는 부족 시나리오로만 사용한다.

### C. 예측 입력 범위
- 필수 반영: 확정 예약 + 확정 체크아웃 + 빈객실 예약 유입 확률
- 빈객실 잠재 체크인은 미래 체크아웃 날짜를 생성해 청소 수요에 합산한다.
- 셋팅 데이터는 인력 예측 입력에서 제외한다.

### D. 동기화 트리거 운영
- 정기: 매일 08:00 Asia/Tokyo
- 이벤트: 예약 생성 변경 취소 시 영향 구간 부분 재계산
- 실패 복구: 08:00 실패 시 08:15 재시도, 재실패 시 Slack 알림

### E. 월별 블록 구조 원칙
- 각 월은 월별 KPI 2행 + 월간 캘린더 제목/요일/본문 + 위험 메모를 한 단위로 반복한다.
- 월별 KPI와 월간 캘린더의 month key는 반드시 동일해야 한다.

## 16. 운영 입력값 (Manual Operational Input) 2026-04-30

운영자가 수기로 입력하는 운영 확정값을 시스템 권장값과 분리해 보존한다.

### A. 시트 위치 및 구조
- 단일 시트 `청소인력예측` 내, `설정 | 건물별 청소 기준` 아래 / `API 입력 예정 데이터` 위에 배치.
- 섹션 제목: `운영 입력값`.
- 컬럼:
  - `월` (YYYY-MM)
  - `확정 고정인원` (확정된 정규 고정인원, 비워두면 시스템 권장값 사용)
  - `평균 주근무일수` (1~7 사이, 비워두면 기본값 `AVG_WORK_DAYS_PER_WEEK = 3`)
  - `메모`
- 데이터 행은 노란 배경(`{red:1.0, green:0.965, blue:0.78}`)으로 시각적으로 구분.

### B. 영속성 규칙 (Persistence)
- 일일 동기화(`update-cleaning-workforce-forecast.js`)는 이 섹션의 **셀을 절대 clear/overwrite 하지 않는다**.
- `deleteDimension`은 운영 입력값 행을 anchor로 인식해 그 위로만 동작한다.
- 기존 시트에 `운영 입력값` 섹션이 없으면 일일 동기화가 `API 입력 예정 데이터` 앵커 위에 비파괴 방식으로 자동 생성한다.
- 예측 대상 월(현재월/+1/+2)이 섹션에 없으면 `insertDimension`으로 신규 행만 추가하고, 기존 값은 그대로 보존한다.
- 셋업 스크립트(`setup-cleaning-workforce-sheet.js`) 재실행은 전체 시트를 재구성하므로 운영자 데이터가 초기화될 수 있다 — 셋업은 관리자 작업으로 한정.

### C. 인력 산식 (Applied Fixed Staff)
입력 파싱 후 월별로 다음과 같이 계산한다.

```
system_fixed_staff      = baselineOperational            // 그날그날 운영최소의 최저값(매일 필요한 핵심 고정)
applied_fixed_staff     = manual.confirmed_fixed_staff ?? system_fixed_staff
avg_part_time_days_per_week = manual.avg_part_time_days_per_week ?? AVG_WORK_DAYS_PER_WEEK
part_time_availability_rate = avg_part_time_days_per_week / 7

support_pool       = CEILING( MAX(0, peakOperational - applied_fixed_staff) / part_time_availability_rate )
total_required_pool = applied_fixed_staff + support_pool
fixed_shortage     = MAX(0, system_fixed_staff - applied_fixed_staff)
all_part_time_equivalent = CEILING( peakOperational / part_time_availability_rate )   // 참고값
```

### D. `총 확보 필요` vs `전체 주3일 환산` 차이
- `총 확보 필요` = `applied_fixed_staff + support_pool`. **운영 가능한 실 인력 수**(고정 + 보충풀).
- `전체 주3일 환산` = `CEILING(peakOperational / part_time_availability_rate)`. 모든 인력을 알바(주N일)로 가정했을 때의 환산값(참고용).
- 즉 `applied_fixed_staff > 0`일 때는 두 값이 다르며, 항상 `총 확보 필요 ≤ 전체 주3일 환산`이다.

### E. 시트 라벨 매핑
- 월별 캘린더 위 KPI 1행: `월 예상 총 청소 / 최소 고정인원 / 적용 고정인원 / 고정 부족`.
- 월별 캘린더 위 KPI 2행: `확정/예상 CO / 보충풀 필요 / 총 확보 필요 / 예상인건비(Base)`.
- `건물별 3개월 요약` 상단 월별 요약 헤더: `월 / 총 확보 필요 / 시스템 고정권장 / 적용 고정인원 / 고정 부족 / 보충풀 필요 / 전체 주3일 환산 / 피크일`.

### F. 검증 체크리스트
- [x] `node --check` 통과 (3개 파일).
- [x] `node functions/update-cleaning-workforce-forecast.js` 정상 종료.
- [ ] 셋업 후 시트에 `운영 입력값` 섹션 노란 행이 보임.
- [ ] 5월 행에 `확정 고정인원=6`, `평균 주근무일수=3` 입력 → sync 후 5월 KPI의 `총 확보 필요 = 6 + CEILING((peak-6)/(3/7))` 일치.
- [ ] sync 재실행 후 입력값이 그대로 유지됨.
