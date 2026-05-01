/**
 * update-cleaning-workforce-forecast.js
 *
 * Fills "청소인력예측" sheet with real forecast values from Firestore reservations.
 *
 * Run:
 *   cd functions
 *   node update-cleaning-workforce-forecast.js
 */

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const serviceAccount = require("./serviceAccountKey.json");
const { createAttendanceAppClient } = require("./modules/attendanceAppClient");
const {
    TOKYO_TZ,
    DEFAULT_BUILDING_RULES,
    DEFAULT_WAGE_SCENARIOS,
    DEFAULT_EXCLUDED_BUILDING_ALIASES,
    normalizeText,
    createBuildingResolver,
    calculateCapacityHeadcount,
    enrichCapacityRows,
    addLaborCostScenarios,
    buildDateRange,
} = require("./modules/cleaningWorkforceForecast");

dayjs.extend(utc);
dayjs.extend(timezone);

function loadLocalEnv() {
    const envPath = path.join(__dirname, ".env");
    if (!fs.existsSync(envPath)) return;

    fs.readFileSync(envPath, "utf8").split(/\r?\n/).forEach((line) => {
        const match = line.match(/^\s*([^#=]+)=(.*)$/);
        if (!match) return;
        const key = match[1].trim();
        if (!process.env[key]) process.env[key] = match[2].trim();
    });
}

loadLocalEnv();

const DEFAULT_SPREADSHEET_ID = "1A9HyeH6j4TN2c7ITfzI5s1qQgQhyrqW4e-qLCrlafv0";
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;
const SHEET_TITLE = "\uccad\uc18c\uc778\ub825\uc608\uce21";
const MANUAL_INPUT_LABEL = "\uc6b4\uc601 \uc785\ub825\uac12"; // \uc6b4\uc601 \uc785\ub825\uac12
const API_INPUT_LABEL = "API \uc785\ub825 \uc608\uc815 \ub370\uc774\ud130";
const DEFAULT_COMPANY_ID = process.env.COMPANY_ID || "dGxlQyu47LbplLVCVXiV";
const PRODUCTIVE_HOURS_PER_PERSON = 7;
const BUFFER_RATE = 0.15;
const MAX_STAY_NIGHTS = 10;
// Mixed workforce: some weekday-only, some weekend-only, some 2-3 days/week.
// 3 days/week is a conservative planning average. Raises pool size by ~2.3x vs peak.
const AVG_WORK_DAYS_PER_WEEK = 3;
const FORECAST_PROFILE = String(process.env.FORECAST_PROFILE || "base").toLowerCase();

const BUILDING_ORDER = ["arakichoA", "arakichoB", "kabukicho", "takadanobaba", "okuboA", "okuboB", "okuboC"];
const BUILDING_DISPLAY = {
    arakichoA: "\uc544\ub77c\ud0a4\ucd08A",
    arakichoB: "\uc544\ub77c\ud0a4\ucd08B",
    kabukicho: "\uac00\ubd80\ud0a4\ucd08",
    takadanobaba: "\ub2e4\uce74\ub2e4\ub178\ubc14\ubc14",
    okuboA: "\uc624\ucfe0\ubcf4A\ub3d9",
    okuboB: "\uc624\ucfe0\ubcf4B\ub3d9",
    okuboC: "\uc624\ucfe0\ubcf4C\ub3d9",
};
const DEFAULT_INVENTORY_BY_BUILDING = {
    arakichoA: 11,
    arakichoB: 8,
    kabukicho: 10,
    takadanobaba: 8,
    okuboA: 1,
    okuboB: 1,
    okuboC: 1,
};
const INVENTORY_CONFIG_ENV_KEY = "CLEANING_FORECAST_INVENTORY_JSON";
const API_OUTPUT_MAX_ROWS = Number(process.env.CLEANING_FORECAST_API_MAX_ROWS || 0); // 0 = unlimited
const API_CLEAR_WINDOW_ROWS = Number(process.env.CLEANING_FORECAST_API_CLEAR_WINDOW_ROWS || 5000);
const FORECAST_PROFILES = {
    conservative: { demandMultiplier: 0.85, pickupShift: -0.08 },
    base: { demandMultiplier: 1.0, pickupShift: 0.0 },
    aggressive: { demandMultiplier: 1.15, pickupShift: 0.08 },
};

// Hourly wages below this threshold are treated as test/invalid values and excluded from cost estimates.
const MIN_VALID_HOURLY_WAGE = 1000;

/** Upper bound for weekly summary rows (besides sheet layout limit through "건물별 3개월 요약"). */
const MAX_WEEKLY_SUMMARY_ROWS_HARD_CAP = 52;

function isExcludedBuilding(name) {
    const normalized = normalizeText(name);
    return DEFAULT_EXCLUDED_BUILDING_ALIASES.some((alias) => {
        const normalizedAlias = normalizeText(alias);
        return normalizedAlias && normalized.includes(normalizedAlias);
    });
}

function toPositiveNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function resolveInventoryByBuilding() {
    const resolved = { ...DEFAULT_INVENTORY_BY_BUILDING };
    const warnings = [];
    const rawJson = process.env[INVENTORY_CONFIG_ENV_KEY];

    if (!rawJson) {
        return {
            inventoryByBuilding: resolved,
            source: "default",
            warnings,
        };
    }

    let parsed;
    try {
        parsed = JSON.parse(rawJson);
    } catch (error) {
        warnings.push(`invalid ${INVENTORY_CONFIG_ENV_KEY} JSON: ${error.message}`);
        return {
            inventoryByBuilding: resolved,
            source: "default_fallback",
            warnings,
        };
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        warnings.push(`${INVENTORY_CONFIG_ENV_KEY} must be a JSON object`);
        return {
            inventoryByBuilding: resolved,
            source: "default_fallback",
            warnings,
        };
    }

    BUILDING_ORDER.forEach((buildingKey) => {
        const configured = toPositiveNumber(parsed[buildingKey]);
        if (configured == null) {
            warnings.push(
                `inventory missing/invalid for ${buildingKey}; fallback=${DEFAULT_INVENTORY_BY_BUILDING[buildingKey]}`
            );
            return;
        }
        resolved[buildingKey] = configured;
    });

    return {
        inventoryByBuilding: resolved,
        source: "env_json",
        warnings,
    };
}

function yen(value) {
    return `\u00a5${Number(value || 0).toLocaleString("ja-JP")}`;
}

function estimateCostFromWage(minutes, hourlyWage) {
    const safeMinutes = Number(minutes || 0);
    const safeWage = Number(hourlyWage || 0);
    if (safeMinutes <= 0 || safeWage <= 0) return 0;
    return Math.round((safeMinutes * safeWage) / 60);
}

async function buildAttendanceAppSheetRows(now = dayjs().tz(TOKYO_TZ)) {
    try {
        const client = createAttendanceAppClient();
        const fromDate = now.startOf("month").subtract(2, "month").format("YYYY-MM-DD");
        const toDate = now.format("YYYY-MM-DD");
        const targetMonths = [
            now.startOf("month").subtract(2, "month").format("YYYY-MM"),
            now.startOf("month").subtract(1, "month").format("YYYY-MM"),
            now.startOf("month").format("YYYY-MM"),
        ];

        const [employees, attendanceRecords, payrollGroups] = await Promise.all([
            client.listEmployees({ size: 500 }),
            client.listAttendanceRecords({ fromDate, toDate, size: 500 }),
            Promise.all(targetMonths.map((yearMonth) => client.listPayrollSummaries({ yearMonth, size: 500 }))),
        ]);
        const payrollSummaries = payrollGroups.flat();

        const employeeMap = new Map(employees.map((employee) => [String(employee.employeeId), employee]));
        const monthlyTotals = new Map(targetMonths.map((month) => [month, {
            yearMonth: month,
            employeeCount: new Set(),
            attendanceDays: new Set(),
            attendanceRecordCount: 0,
            totalWorkMinutes: 0,
            estimatedLaborCost: 0,
            appLaborCost: 0,
            appLaborCostCount: 0,
        }]));
        const employeeTotals = new Map();
        const workplaceTotals = new Map();

        const attendanceRows = attendanceRecords.map((record) => {
            const employee = employeeMap.get(String(record.employeeId)) || {};
            const wageValid = Number(employee.hourlyWage) >= MIN_VALID_HOURLY_WAGE;
            const estimatedCost = estimateCostFromWage(record.totalWorkMinutes, wageValid ? employee.hourlyWage : 0);
            const monthKey = String(record.workDate || "").slice(0, 7);
            if (monthlyTotals.has(monthKey)) {
                const bucket = monthlyTotals.get(monthKey);
                bucket.employeeCount.add(String(record.employeeId || ""));
                bucket.attendanceDays.add(String(record.workDate || ""));
                bucket.attendanceRecordCount += 1;
                bucket.totalWorkMinutes += Number(record.totalWorkMinutes || 0);
                bucket.estimatedLaborCost += estimatedCost;
            }

            const employeeKey = String(record.employeeId || "");
            if (!employeeTotals.has(employeeKey)) {
                employeeTotals.set(employeeKey, {
                    employeeId: employeeKey,
                    name: employee.name || "",
                    role: employee.role || "",
                    employmentType: employee.employmentType || "",
                    hourlyWage: employee.hourlyWage || "",
                    wageValid,
                    records: 0,
                    totalWorkMinutes: 0,
                    estimatedCost: 0,
                });
            }
            const employeeBucket = employeeTotals.get(employeeKey);
            employeeBucket.records += 1;
            employeeBucket.totalWorkMinutes += Number(record.totalWorkMinutes || 0);
            employeeBucket.estimatedCost += estimatedCost;

            const workplaceKey = record.workplaceName || "(no workplace)";
            if (!workplaceTotals.has(workplaceKey)) {
                workplaceTotals.set(workplaceKey, {
                    workplaceName: workplaceKey,
                    records: 0,
                    employees: new Set(),
                    totalWorkMinutes: 0,
                    estimatedCost: 0,
                });
            }
            const workplaceBucket = workplaceTotals.get(workplaceKey);
            workplaceBucket.records += 1;
            workplaceBucket.employees.add(employeeKey);
            workplaceBucket.totalWorkMinutes += Number(record.totalWorkMinutes || 0);
            workplaceBucket.estimatedCost += estimatedCost;

            const wageDisplay = wageValid ? (employee.hourlyWage || "") : "미설정";
            return [
                record.workDate || "",
                record.employeeId || "",
                employee.name || "",
                record.workplaceName || "",
                Number(record.totalWorkMinutes || 0),
                Math.round((Number(record.totalWorkMinutes || 0) / 60) * 10) / 10,
                wageDisplay,
                estimatedCost || "",
            ];
        });

        const payrollRows = payrollSummaries.map((summary) => {
            const employee = employeeMap.get(String(summary.employeeId)) || {};
            const wageValid = Number(employee.hourlyWage) >= MIN_VALID_HOURLY_WAGE;
            const estimatedCost = estimateCostFromWage(summary.totalWorkMinutes, wageValid ? employee.hourlyWage : 0);
            const monthKey = String(summary.yearMonth || "");
            if (monthlyTotals.has(monthKey)) {
                const bucket = monthlyTotals.get(monthKey);
                bucket.employeeCount.add(String(summary.employeeId || ""));
                bucket.totalWorkMinutes += 0;
                if (summary.totalLaborCost != null) {
                    bucket.appLaborCost += Number(summary.totalLaborCost || 0);
                    bucket.appLaborCostCount += 1;
                }
            }
            return [
                summary.employeeId || "",
                employee.name || "",
                summary.yearMonth || "",
                summary.payType || "",
                Number(summary.totalWorkMinutes || 0),
                summary.totalLaborCost == null ? "" : Number(summary.totalLaborCost || 0),
                estimatedCost || "",
                summary.paid == null ? "" : String(summary.paid),
            ];
        });

        const currentMonth = now.format("YYYY-MM");
        const monthlyRows = Array.from(monthlyTotals.values()).map((bucket) => {
            const hasAttendance = bucket.attendanceRecordCount > 0;
            const hasAppCost = bucket.appLaborCostCount > 0 && bucket.appLaborCost > 0;
            const hasData = hasAttendance || hasAppCost;
            const isCurrentMonth = bucket.yearMonth === currentMonth;
            // Current month with no data yet: show placeholders.
            const isIncomplete = isCurrentMonth && !hasData;
            // Current month with partial data: still in progress, append status label.
            const isPartial = isCurrentMonth && hasData;
            const monthLabel = isPartial
                ? `${bucket.yearMonth} (부분집계)` // 부분집계
                : bucket.yearMonth;
            // Return raw numbers so RAW write stores numeric cells, not text.
            const displayOrNum = (n) => isIncomplete ? "집계중" : n; // 집계중
            return [
                monthLabel,
                displayOrNum(bucket.employeeCount.size),
                displayOrNum(bucket.attendanceDays.size),
                displayOrNum(bucket.attendanceRecordCount),
                isIncomplete ? "-" : bucket.totalWorkMinutes,
                isIncomplete ? "-" : Math.round((bucket.totalWorkMinutes / 60) * 10) / 10,
                isIncomplete ? "-" : (bucket.appLaborCostCount ? bucket.appLaborCost : ""),
                isIncomplete ? "-" : (bucket.estimatedLaborCost || ""),
            ];
        });

        const employeeSummaryRows = Array.from(employeeTotals.values())
            .sort((a, b) => b.totalWorkMinutes - a.totalWorkMinutes)
            .map((bucket) => [
                bucket.employeeId,
                bucket.name,
                bucket.role,
                bucket.employmentType,
                bucket.wageValid ? bucket.hourlyWage : "미설정", // 미설정
                bucket.records,
                Math.round((bucket.totalWorkMinutes / 60) * 10) / 10,
                bucket.estimatedCost || (bucket.wageValid ? "" : "시급 미설정/테스트 제외"), // 시급 미설정/테스트 제외
            ]);

        const workplaceSummaryRows = Array.from(workplaceTotals.values())
            .sort((a, b) => b.totalWorkMinutes - a.totalWorkMinutes)
            .map((bucket) => [
                bucket.workplaceName,
                bucket.records,
                bucket.employees.size,
                bucket.totalWorkMinutes,
                Math.round((bucket.totalWorkMinutes / 60) * 10) / 10,
                bucket.estimatedCost || "",
                "",
                "",
            ]);

        const rows = [
            ["\ucd9c\ud1f4\uadfc\uc571 \uc5f0\ub3d9 \ud14c\uc2a4\ud2b8", "", "", "", "", "", "", ""],
            ["\uc124\uba85", "\uc2dc\uae09\uc81c \uc54c\ubc14 \uc778\uac74\ube44\ub9cc \ube44\uc6a9 \uacc4\uc0b0, \uace0\uc815\uae09/unknown\uc740 \uadfc\ubb34\uc2dc\uac04 \ucc38\uace0", "", "", "", "", "", ""],
            ["\uae30\uc900", "STAY ARI staging", "\uc9c1\uc6d0", employees.length, "\uadfc\ud0dc", attendanceRecords.length, "\uae09\uc5ec\uc694\uc57d", payrollSummaries.length],
            ["\uc870\ud68c\uae30\uac04", `${fromDate} ~ ${toDate}`, "\uc870\ud68c\uc6d4", targetMonths.join(", "), "", "", "", ""],
            ["", "", "", "", "", "", "", ""],
            ["\uc6d4\ubcc4 \uc2dc\uae09\uc81c \uc54c\ubc14 \uc778\uac74\ube44", "", "", "", "", "", "", ""],
            ["\uc6d4", "\uc778\uc6d0", "\uadfc\ubb34\uc77c", "\uadfc\ud0dc\uac74\uc218", "\uadfc\ubb34\ubd84", "\uadfc\ubb34\uc2dc\uac04", "\uc571\uc778\uac74\ube44", "\uc2dc\uae09\uae30\uc900 \ucd94\uc815"],
            ...monthlyRows,
            ["", "", "", "", "", "", "", ""],
            ["\uc9c1\uc6d0\ubcc4 \uadfc\ubb34 \uc694\uc57d", "", "", "", "", "", "", ""],
            ["ID", "\uc774\ub984", "\uc5ed\ud560", "\uae09\uc5ec\ud0c0\uc785", "\uc2dc\uae09", "\uadfc\ud0dc\uac74\uc218", "\uadfc\ubb34\uc2dc\uac04", "\uc2dc\uae09\uc81c \ucd94\uc815"],
            ...(employeeSummaryRows.length ? employeeSummaryRows : [["--", "--", "--", "--", "--", "--", "--", "--"]]),
            ["", "", "", "", "", "", "", ""],
            ["\uac74\ubb3c/\uadfc\ubb34\uc9c0\ubcc4 \uadfc\ubb34 \uc694\uc57d", "", "", "", "", "", "", ""],
            ["\uadfc\ubb34\uc9c0", "\uadfc\ud0dc\uac74\uc218", "\uc778\uc6d0", "\uadfc\ubb34\ubd84", "\uadfc\ubb34\uc2dc\uac04", "\uc2dc\uae09\uc81c \ucd94\uc815", "", ""],
            ...(workplaceSummaryRows.length ? workplaceSummaryRows : [["--", "--", "--", "--", "--", "--", "--", "--"]]),
            ["", "", "", "", "", "", "", ""],
            ["\uc9c1\uc6d0 \ubaa9\ub85d", "", "", "", "", "", "", ""],
            ["ID", "\uc774\ub984", "\uc5ed\ud560", "\uae09\uc5ec\ud0c0\uc785", "\uc2dc\uae09", "\ube44\uace0", "", ""],
            ...employees.map((employee) => {
                const wageOk = Number(employee.hourlyWage) >= MIN_VALID_HOURLY_WAGE;
                return [
                    employee.employeeId || "",
                    employee.name || "",
                    employee.role || "",
                    employee.employmentType || "",
                    employee.hourlyWage == null ? "" : (wageOk ? employee.hourlyWage : "미설정"),
                    wageOk ? "" : "시급 미설정/테스트 제외", // 시급 미설정/테스트 제외
                    "",
                    "",
                ];
            }),
            ["", "", "", "", "", "", "", ""],
            ["\ucd5c\uadfc 3\uac1c\uc6d4 \uadfc\ud0dc", "", "", "", "", "", "", ""],
            ["\uadfc\ubb34\uc77c", "ID", "\uc774\ub984", "\uadfc\ubb34\uc9c0", "\uadfc\ubb34\ubd84", "\uadfc\ubb34\uc2dc\uac04", "\uc2dc\uae09", "\uc2dc\uae09\uc81c \ucd94\uc815"],
            ...(attendanceRows.length ? attendanceRows : [["--", "--", "--", "--", "--", "--", "--", "--"]]),
            ["", "", "", "", "", "", "", ""],
            ["\ucd5c\uadfc 3\uac1c\uc6d4 \uae09\uc5ec \uc694\uc57d", "", "", "", "", "", "", ""],
            ["ID", "\uc774\ub984", "\uc6d4", "\uae09\uc5ec\ud0c0\uc785", "\uadfc\ubb34\ubd84", "\uc571\uc778\uac74\ube44", "\uc2dc\uae09\uc81c \ucd94\uc815", "\uc9c0\uae09\uc644\ub8cc"],
            ...(payrollRows.length ? payrollRows : [["--", "--", "--", "--", "--", "--", "--", "--"]]),
        ];

        return {
            rows,
            meta: {
                employees: employees.length,
                attendanceRecords: attendanceRecords.length,
                payrollSummaries: payrollSummaries.length,
                targetMonths,
            },
        };
    } catch (error) {
        return {
            rows: [
                ["\ucd9c\ud1f4\uadfc\uc571 \uc5f0\ub3d9 \ud14c\uc2a4\ud2b8", "", "", "", "", "", "", ""],
                ["status", "failed", "error", error.message || String(error), "", "", "", ""],
            ],
            meta: {
                error: error.message || String(error),
            },
        };
    }
}

function normalizeDate(value) {
    if (!value) return "";
    return String(value).slice(0, 10);
}

function getWeekKey(dateKey) {
    const start = dayjs.tz(dateKey, TOKYO_TZ).startOf("week").format("YYYY-MM-DD");
    const end = dayjs.tz(dateKey, TOKYO_TZ).startOf("week").add(6, "day").format("YYYY-MM-DD");
    return { start, end };
}

function findRowByLabel(values, label) {
    for (let i = 0; i < values.length; i += 1) {
        if (String(values[i]?.[0] || "").trim() === label) return i;
    }
    return -1;
}

// Parse the 운영 입력값 manual input section. Returns:
//   byMonth: Map<YYYY-MM, { confirmed_fixed_staff, avg_part_time_days_per_week, notes, rowIndex }>
//   endRow: 0-indexed array position immediately after the last data row (for inserting new month rows).
function parseManualInputs(values, manualInputRow) {
    if (!Number.isInteger(manualInputRow) || manualInputRow < 0) {
        return { byMonth: new Map(), endRow: -1 };
    }
    const byMonth = new Map();
    let endRow = manualInputRow + 2; // skip title row + header row
    for (let i = manualInputRow + 2; i < values.length; i += 1) {
        const row = values[i] || [];
        const first = String(row[0] || "").trim();
        if (!first) { endRow = i; break; }
        if (!/^\d{4}-\d{2}$/.test(first)) { endRow = i; break; }
        const fixedRaw = row[1];
        const avgRaw = row[2];
        const fixedNum = (fixedRaw === "" || fixedRaw == null) ? null : Number(fixedRaw);
        const avgNum = (avgRaw === "" || avgRaw == null) ? null : Number(avgRaw);
        byMonth.set(first, {
            confirmed_fixed_staff: Number.isFinite(fixedNum) && fixedNum >= 0 ? fixedNum : null,
            avg_part_time_days_per_week: Number.isFinite(avgNum) && avgNum > 0 && avgNum <= 7 ? avgNum : null,
            notes: row[3] != null ? String(row[3]) : "",
            rowIndex: i,
        });
        endRow = i + 1;
    }
    return { byMonth, endRow };
}

function buildManualInputRows(months = [], manualInputs = new Map()) {
    return [
        [MANUAL_INPUT_LABEL, "", "", "", "", "", "", ""],
        ["\uc6d4", "\ud655\uc815 \uace0\uc815\uc778\uc6d0", "\ud3c9\uade0 \uc8fc\uadfc\ubb34\uc77c\uc218", "\uba54\ubaa8", "", "", "", ""],
        ...months.map((month) => {
            const manual = manualInputs.get(month) || {};
            return [
                month,
                manual.confirmed_fixed_staff != null ? manual.confirmed_fixed_staff : "",
                manual.avg_part_time_days_per_week != null ? manual.avg_part_time_days_per_week : "",
                manual.notes || "",
                "", "", "", "",
            ];
        }),
        ["", "", "", "", "", "", "", ""],
    ];
}

async function ensureManualInputSection(sheets, months = [], preservedManualInputs = new Map()) {
    const valuesRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_TITLE}!A1:H400`,
    });
    const values = valuesRes.data.values || [];
    const layoutSheetId = await getSheetIdByTitle(sheets, SPREADSHEET_ID, SHEET_TITLE);
    const manualRow = findRowByLabel(values, MANUAL_INPUT_LABEL);
    const apiRow = findRowByLabel(values, API_INPUT_LABEL);

    if (manualRow < 0) {
        const insertAt = apiRow >= 0 ? apiRow : values.length;
        const rows = apiRow >= 0
            ? buildManualInputRows(months, preservedManualInputs)
            : [
                ...buildManualInputRows(months, preservedManualInputs),
                [API_INPUT_LABEL, "", "", "", "", "", "", ""],
            ];
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: {
                requests: [{
                    insertDimension: {
                        range: {
                            sheetId: layoutSheetId,
                            dimension: "ROWS",
                            startIndex: insertAt,
                            endIndex: insertAt + rows.length,
                        },
                        inheritFromBefore: insertAt > 0,
                    },
                }],
            },
        });
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_TITLE}!A${insertAt + 1}:H${insertAt + rows.length}`,
            valueInputOption: "RAW",
            resource: { values: rows },
        });
        console.log(`[forecast] manual input section created at row ${insertAt + 1}`);
        return;
    }

    const { byMonth, endRow } = parseManualInputs(values, manualRow);
    const missing = months.filter((month) => !byMonth.has(month));
    if (endRow < 0) return;

    if (missing.length > 0) {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: {
                requests: [{
                    insertDimension: {
                        range: {
                            sheetId: layoutSheetId,
                            dimension: "ROWS",
                            startIndex: endRow,
                            endIndex: endRow + missing.length,
                        },
                        inheritFromBefore: true,
                    },
                }],
            },
        });
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_TITLE}!A${endRow + 1}:D${endRow + missing.length}`,
            valueInputOption: "RAW",
        resource: {
            values: missing.map((month) => {
                const manual = preservedManualInputs.get(month) || {};
                return [
                    month,
                    manual.confirmed_fixed_staff != null ? manual.confirmed_fixed_staff : "",
                    manual.avg_part_time_days_per_week != null ? manual.avg_part_time_days_per_week : "",
                    manual.notes || "",
                ];
            }),
        },
        });
        console.log(`[forecast] manual input rows added: ${missing.join(", ")}`);
    }

    if (apiRow < 0) {
        const apiInsertAt = endRow + missing.length + 1;
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: {
                requests: [{
                    insertDimension: {
                        range: {
                            sheetId: layoutSheetId,
                            dimension: "ROWS",
                            startIndex: apiInsertAt,
                            endIndex: apiInsertAt + 1,
                        },
                        inheritFromBefore: true,
                    },
                }],
            },
        });
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_TITLE}!A${apiInsertAt + 1}:H${apiInsertAt + 1}`,
            valueInputOption: "RAW",
            resource: { values: [[API_INPUT_LABEL, "", "", "", "", "", "", ""]] },
        });
        console.log(`[forecast] API input anchor created at row ${apiInsertAt + 1}`);
    }
}

function colToA1(colIndex) {
    let n = colIndex + 1;
    let s = "";
    while (n > 0) {
        const m = (n - 1) % 26;
        s = String.fromCharCode(65 + m) + s;
        n = Math.floor((n - 1) / 26);
    }
    return s;
}

function isSectionTitleRow(row = []) {
    const first = String(row?.[0] || "").trim();
    if (!first) return false;
    if (first.startsWith("\uc6d4\uac04 \uce98\ub9b0\ub354 | ")) return true;
    return [
        "\uc8fc\uac04 \uc694\uc57d",
        "\uac74\ubb3c\ubcc4 3\uac1c\uc6d4 \uc694\uc57d",
        "\uc6b4\uc601 \uc785\ub825\uac12",
        "\ucd9c\ud1f4\uadfc\uc571 \uc5f0\ub3d9 \ud14c\uc2a4\ud2b8",
        "\uc6d4\ubcc4 \uc2dc\uae09\uc81c \uc54c\ubc14 \uc778\uac74\ube44",
        "\uc9c1\uc6d0\ubcc4 \uadfc\ubb34 \uc694\uc57d",
        "\uac74\ubb3c/\uadfc\ubb34\uc9c0\ubcc4 \uadfc\ubb34 \uc694\uc57d",
        "\uc9c1\uc6d0 \ubaa9\ub85d",
        "\ucd5c\uadfc 3\uac1c\uc6d4 \uadfc\ud0dc",
        "\ucd5c\uadfc 3\uac1c\uc6d4 \uae09\uc5ec \uc694\uc57d",
    ].includes(first);
}

function isColumnHeaderRow(row = []) {
    const first = String(row?.[0] || "").trim();
    return [
        "\uc77c",
        "\uc8fc \uc2dc\uc791\uc77c",
        "\uc6d4",
        "\uac74\ubb3c",
        "ID",
        "\uadfc\ubb34\uc9c0",
        "\uadfc\ubb34\uc77c",
    ].includes(first);
}

function buildGlobalSheetFormatRequests(sheetId, values = []) {
    const rows = values.length || 220;
    const requests = [
        {
            repeatCell: {
                range: { sheetId, startRowIndex: 0, endRowIndex: rows, startColumnIndex: 0, endColumnIndex: 8 },
                cell: {
                    userEnteredFormat: {
                        textFormat: { fontFamily: "Arial", fontSize: 10 },
                        horizontalAlignment: "CENTER",
                        verticalAlignment: "MIDDLE",
                        wrapStrategy: "WRAP",
                    },
                },
                fields: "userEnteredFormat.textFormat.fontFamily,userEnteredFormat.textFormat.fontSize,userEnteredFormat.horizontalAlignment,userEnteredFormat.verticalAlignment,userEnteredFormat.wrapStrategy",
            },
        },
        {
            updateBorders: {
                range: { sheetId, startRowIndex: 0, endRowIndex: rows, startColumnIndex: 0, endColumnIndex: 8 },
                top: { style: "SOLID", width: 1, color: { red: 0.78, green: 0.82, blue: 0.88 } },
                bottom: { style: "SOLID", width: 1, color: { red: 0.78, green: 0.82, blue: 0.88 } },
                left: { style: "SOLID", width: 1, color: { red: 0.78, green: 0.82, blue: 0.88 } },
                right: { style: "SOLID", width: 1, color: { red: 0.78, green: 0.82, blue: 0.88 } },
                innerHorizontal: { style: "SOLID", width: 1, color: { red: 0.78, green: 0.82, blue: 0.88 } },
                innerVertical: { style: "SOLID", width: 1, color: { red: 0.78, green: 0.82, blue: 0.88 } },
            },
        },
        {
            updateDimensionProperties: {
                range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 8 },
                properties: { pixelSize: 190 },
                fields: "pixelSize",
            },
        },
    ];

    values.forEach((row, index) => {
        if (isSectionTitleRow(row)) {
            requests.push({
                repeatCell: {
                    range: { sheetId, startRowIndex: index, endRowIndex: index + 1, startColumnIndex: 0, endColumnIndex: 8 },
                    cell: {
                        userEnteredFormat: {
                            backgroundColorStyle: { rgbColor: { red: 0.02, green: 0.50, blue: 0.45 } },
                            textFormat: {
                                bold: true,
                                fontSize: 11,
                                foregroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } },
                            },
                            horizontalAlignment: "LEFT",
                        },
                    },
                    fields: "userEnteredFormat.backgroundColorStyle,userEnteredFormat.textFormat,userEnteredFormat.horizontalAlignment",
                },
            });
        }
        if (isColumnHeaderRow(row)) {
            const isCalendarWeekdayRow = [
                "\uc77c",
                "\uc6d4",
                "\ud654",
                "\uc218",
                "\ubaa9",
                "\uae08",
                "\ud1a0",
            ].every((dayName, dayIndex) => String(row?.[dayIndex] || "").trim() === dayName);
            requests.push({
                repeatCell: {
                    range: { sheetId, startRowIndex: index, endRowIndex: index + 1, startColumnIndex: 0, endColumnIndex: 8 },
                    cell: {
                        userEnteredFormat: {
                            backgroundColorStyle: {
                                rgbColor: isCalendarWeekdayRow
                                    ? { red: 0.05, green: 0.12, blue: 0.22 }
                                    : { red: 0.90, green: 0.94, blue: 0.98 },
                            },
                            textFormat: isCalendarWeekdayRow
                                ? {
                                    bold: true,
                                    fontSize: 11,
                                    foregroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } },
                                }
                                : { bold: true },
                            horizontalAlignment: "CENTER",
                            verticalAlignment: "MIDDLE",
                        },
                    },
                    fields: "userEnteredFormat.backgroundColorStyle,userEnteredFormat.textFormat,userEnteredFormat.horizontalAlignment,userEnteredFormat.verticalAlignment",
                },
            });
        }
    });

    return requests;
}

function dateRange(start, end) {
    const days = dayjs.tz(end, TOKYO_TZ).diff(dayjs.tz(start, TOKYO_TZ), "day") + 1;
    return buildDateRange(start, days, TOKYO_TZ);
}

/**
 * Build a map of physicalRoomKey → sorted confirmed reservations.
 * physicalRoomKey = `${buildingKey}__${room}` — NOT roomId-based.
 */
function buildRoomReservationMap(reservations, resolver) {
    const roomMap = new Map();
    reservations.forEach((r) => {
        if (r.status !== "confirmed") return;
        const buildingKey = resolver(r.building);
        if (!BUILDING_ORDER.includes(buildingKey)) return;
        const roomKey = `${buildingKey}__${String(r.room || "").trim()}`;
        if (!roomKey || roomKey === "__") return;
        if (!roomMap.has(roomKey)) roomMap.set(roomKey, []);
        roomMap.get(roomKey).push(r);
    });
    roomMap.forEach((list) => list.sort((a, b) => a.arrival.localeCompare(b.arrival)));
    return roomMap;
}

/**
 * Returns true if a 1-night (or longer) stay can start on or after weekStart and
 * checkout on or before weekEnd, without overlapping any existing reservation.
 */
function hasAvailableStayInsideWeek(roomReservations, weekStart, weekEnd) {
    const weekEndMinus1 = dayjs.tz(weekEnd, TOKYO_TZ).subtract(1, "day").format("YYYY-MM-DD");
    if (weekEndMinus1 < weekStart) return false; // degenerate week
    const nights = dateRange(weekStart, weekEndMinus1);
    for (const night of nights) {
        // 1-night stay: checkin=night, checkout=night+1
        const checkout = dayjs.tz(night, TOKYO_TZ).add(1, "day").format("YYYY-MM-DD");
        if (checkout > weekEnd) continue;
        const isFree = !roomReservations.some((r) => r.arrival < checkout && r.departure > night);
        if (isFree) return true;
    }
    return false;
}

/**
 * Count physical rooms that can accept a new stay fully within the remaining usable window.
 * For past weeks returns 0; for the current week only checks from todayKey onward.
 */
function countWeeklyShortStayAvailableCheckouts(roomMap, weekStart, weekEnd, todayKey) {
    if (weekEnd < todayKey) return 0;
    const effectiveStart = todayKey > weekStart ? todayKey : weekStart;
    const effectiveEnd = weekEnd;
    if (effectiveStart >= effectiveEnd) return 0; // need at least one night
    let count = 0;
    roomMap.forEach((roomReservations) => {
        if (hasAvailableStayInsideWeek(roomReservations, effectiveStart, effectiveEnd)) count++;
    });
    return count;
}

/**
 * Builds one row per calendar week with confirmed-only operational metrics.
 * Columns: weekStart, weekEnd, 확정청소, 주내추가가능CO, 확정피크일, 피크대응, 주간확보풀, 확정인건비
 */
function buildWeeklySummaryRowsFromDaily(dailyMap, roomMap = new Map(), todayKey = "") {
    const daily = dailyMap instanceof Map ? dailyMap : new Map(Object.entries(dailyMap || {}));
    const dateKeys = [...daily.keys()].filter(Boolean).sort();
    if (!dateKeys.length) return [];

    const weekStartSet = new Set();
    dateKeys.forEach((d) => {
        const ws = dayjs.tz(d, TOKYO_TZ).startOf("week").format("YYYY-MM-DD");
        weekStartSet.add(ws);
    });

    const weekStarts = [...weekStartSet].sort((a, b) => a.localeCompare(b));

    return weekStarts.map((weekStart) => {
        const weekEnd = dayjs.tz(weekStart, TOKYO_TZ).add(6, "day").format("YYYY-MM-DD");

        // Remaining-operation window: skip past dates, zero-out fully past weeks.
        const isPastWeek = todayKey && weekEnd < todayKey;
        const effectiveStart = isPastWeek ? null : (todayKey && todayKey > weekStart ? todayKey : weekStart);
        const effectiveEnd = isPastWeek ? null : weekEnd;

        let confirmedCleaning = 0;
        let confirmedCost = 0;
        let confirmedNeedPeak = 0;
        let confirmedPeakDate = "";
        let confirmedNeedSum = 0;

        if (effectiveStart && effectiveEnd) {
            dateRange(effectiveStart, effectiveEnd).forEach((d) => {
                const s = daily.get(d) || {};
                const need = safeInt(s.operationalMinHeadcount);
                confirmedCleaning += safeInt(s.confirmed);
                confirmedCost += safeInt(s.confirmedCostBase);
                confirmedNeedSum += need;
                if (need > confirmedNeedPeak) { confirmedNeedPeak = need; confirmedPeakDate = d; }
            });
        }

        const weeklyPool = confirmedNeedSum > 0
            ? Math.ceil(confirmedNeedSum / Math.max(1, AVG_WORK_DAYS_PER_WEEK))
            : 0;
        const weeklyAvailableCO = countWeeklyShortStayAvailableCheckouts(roomMap, weekStart, weekEnd, todayKey);

        return [
            weekStart,
            weekEnd,
            confirmedCleaning,
            weeklyAvailableCO,
            confirmedPeakDate || "-",
            confirmedNeedPeak,
            weeklyPool,
            yen(confirmedCost),
        ];
    });
}

function safeInt(n) {
    return Number.isFinite(Number(n)) ? Number(n) : 0;
}

function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}

function getConfidence(horizonDays) {
    if (horizonDays <= 3) return "\ub192\uc74c";
    if (horizonDays <= 21) return "\uc911\uac04";
    return "\ub0ae\uc74c";
}

async function getSheetsClient() {
    const auth = new google.auth.GoogleAuth({
        credentials: {
            client_email: serviceAccount.client_email,
            private_key: serviceAccount.private_key,
        },
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const client = await auth.getClient();
    return google.sheets({ version: "v4", auth: client });
}

async function getSheetIdByTitle(sheets, spreadsheetId, title) {
    const res = await sheets.spreadsheets.get({ spreadsheetId });
    const sheet = (res.data.sheets || []).find((s) => s.properties.title === title);
    if (!sheet) throw new Error(`Sheet not found: ${title}`);
    return sheet.properties.sheetId;
}

function initFirestore() {
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
        });
    }
    return admin.firestore();
}

async function fetchReservations(db, companyId) {
    const snapshot = await db.collection("reservations")
        .where("companyId", "==", companyId)
        .where("status", "==", "confirmed")
        .get();

    return snapshot.docs
        .map((doc) => {
            const d = doc.data() || {};
            return {
                id: doc.id,
                building: String(d.building || "").trim(),
                room: String(d.room || "").trim(),
                arrival: normalizeDate(d.arrival),
                departure: normalizeDate(d.departure),
                bookDate: normalizeDate(d.bookDate),
                status: String(d.status || "").toLowerCase(),
                numAdult: safeInt(d.numAdult),
                numChild: safeInt(d.numChild),
            };
        })
        .filter((r) => r.arrival && r.departure && !isExcludedBuilding(r.building));
}

function buildHistoryStructures(reservations, resolver, historyStart, todayKey) {
    const arrivalsByDateBuilding = new Map();
    const leadsByBuilding = new Map();
    const losByBuilding = new Map();
    const recentStart = dayjs.tz(todayKey, TOKYO_TZ).subtract(28, "day").format("YYYY-MM-DD");
    const calibrateStart = dayjs.tz(todayKey, TOKYO_TZ).subtract(56, "day").format("YYYY-MM-DD");
    const yesterday = dayjs.tz(todayKey, TOKYO_TZ).subtract(1, "day").format("YYYY-MM-DD");

    reservations.forEach((r) => {
        const bKey = resolver(r.building);
        if (!BUILDING_ORDER.includes(bKey)) return;
        if (r.arrival >= historyStart && r.arrival <= yesterday) {
            const key = `${r.arrival}__${bKey}`;
            arrivalsByDateBuilding.set(key, (arrivalsByDateBuilding.get(key) || 0) + 1);
        }
        if (r.bookDate && r.departure >= historyStart && r.departure <= yesterday) {
            const lead = dayjs.tz(r.departure, TOKYO_TZ).diff(dayjs.tz(r.bookDate, TOKYO_TZ), "day");
            if (lead >= 0 && lead <= 365) {
                if (!leadsByBuilding.has(bKey)) leadsByBuilding.set(bKey, []);
                leadsByBuilding.get(bKey).push(lead);
            }
        }
        const nights = dayjs.tz(r.departure, TOKYO_TZ).diff(dayjs.tz(r.arrival, TOKYO_TZ), "day");
        if (nights >= 1 && nights <= 30) {
            if (!losByBuilding.has(bKey)) losByBuilding.set(bKey, new Map());
            const m = losByBuilding.get(bKey);
            m.set(nights, (m.get(nights) || 0) + 1);
        }
    });

    const recentArrivalWeekday = new Map();
    const recentArrivalWeekdayDays = new Map();
    dateRange(recentStart, yesterday).forEach((dateKey) => {
        const dow = dayjs.tz(dateKey, TOKYO_TZ).day();
        BUILDING_ORDER.forEach((bKey) => {
            const count = arrivalsByDateBuilding.get(`${dateKey}__${bKey}`) || 0;
            const key = `${bKey}__${dow}`;
            recentArrivalWeekday.set(key, (recentArrivalWeekday.get(key) || 0) + count);
            recentArrivalWeekdayDays.set(key, (recentArrivalWeekdayDays.get(key) || 0) + 1);
        });
    });

    const losDistByBuilding = new Map();
    BUILDING_ORDER.forEach((bKey) => {
        const raw = losByBuilding.get(bKey) || new Map([[1, 1], [2, 1], [3, 1]]);
        let total = 0;
        raw.forEach((v, k) => {
            if (k >= 1 && k <= MAX_STAY_NIGHTS) total += v;
        });
        const dist = [];
        raw.forEach((v, k) => {
            if (k >= 1 && k <= MAX_STAY_NIGHTS) dist.push({ nights: k, p: v / Math.max(total, 1) });
        });
        if (!dist.length) dist.push({ nights: 1, p: 0.5 }, { nights: 2, p: 0.3 }, { nights: 3, p: 0.2 });
        losDistByBuilding.set(bKey, dist);
    });

    const calibrationByBuilding = new Map();
    BUILDING_ORDER.forEach((bKey) => {
        let actual = 0;
        let expected = 0;
        dateRange(calibrateStart, yesterday).forEach((d) => {
            const dow = dayjs.tz(d, TOKYO_TZ).day();
            const recentKey = `${bKey}__${dow}`;
            const recentAvg = (recentArrivalWeekday.get(recentKey) || 0) / Math.max(1, recentArrivalWeekdayDays.get(recentKey) || 1);
            const yoyDate = dayjs.tz(d, TOKYO_TZ).subtract(1, "year").format("YYYY-MM-DD");
            const yoyCount = arrivalsByDateBuilding.get(`${yoyDate}__${bKey}`) || 0;
            const blended = (recentAvg * 0.6) + (yoyCount * 0.4);
            expected += blended;
            actual += arrivalsByDateBuilding.get(`${d}__${bKey}`) || 0;
        });
        const ratio = expected > 0 ? (actual / expected) : 1;
        calibrationByBuilding.set(bKey, clamp(ratio, 0.7, 1.3));
    });

    return { arrivalsByDateBuilding, leadsByBuilding, recentArrivalWeekday, recentArrivalWeekdayDays, losDistByBuilding, calibrationByBuilding };
}

function estimateVacantCheckins({
    buildingKey,
    targetDateKey,
    vacantRooms,
    inventory,
    todayKey,
    history,
}) {
    if (vacantRooms <= 0 || inventory <= 0) return 0;
    const horizon = dayjs.tz(targetDateKey, TOKYO_TZ).diff(dayjs.tz(todayKey, TOKYO_TZ), "day");
    if (horizon < 0) return 0;

    const profile = FORECAST_PROFILES[FORECAST_PROFILE] || FORECAST_PROFILES.base;
    const calibration = history.calibrationByBuilding.get(buildingKey) || 1;
    const dow = dayjs.tz(targetDateKey, TOKYO_TZ).day();
    const recentKey = `${buildingKey}__${dow}`;
    const recentSum = history.recentArrivalWeekday.get(recentKey) || 0;
    const recentDays = Math.max(1, history.recentArrivalWeekdayDays.get(recentKey) || 1);
    const recentAvg = recentSum / recentDays;

    const yoyDate = dayjs.tz(targetDateKey, TOKYO_TZ).subtract(1, "year").format("YYYY-MM-DD");
    const yoyCount = history.arrivalsByDateBuilding.get(`${yoyDate}__${buildingKey}`) || 0;
    const blendedDemand = ((recentAvg * 0.6) + (yoyCount * 0.4)) * profile.demandMultiplier * calibration;

    const leads = history.leadsByBuilding.get(buildingKey) || [];
    let pickupShare = 0.65 + profile.pickupShift;
    if (leads.length >= 20) {
        const bookedAtHorizon = leads.filter((lead) => lead >= horizon).length;
        pickupShare = bookedAtHorizon / leads.length;
    }
    const vacancyRate = clamp(vacantRooms / inventory, 0, 1);
    const demandAdjusted = blendedDemand * (0.55 + 0.45 * vacancyRate);
    const pickupAdjusted = demandAdjusted * clamp(pickupShare + 0.2, 0.12, 1.0);
    const expectedCheckins = Math.min(vacantRooms, Math.max(0, pickupAdjusted));
    return expectedCheckins;
}

function aggregateDailyForecast({ reservations, forecastDates, resolver, todayKey, history, inventoryByBuilding }) {
    const daily = new Map();
    const dailyByBuilding = [];
    const forecastStart = forecastDates[0];
    const forecastEnd = forecastDates[forecastDates.length - 1];
    const simStart = todayKey;
    const simEnd = dayjs.tz(forecastEnd, TOKYO_TZ).add(MAX_STAY_NIGHTS, "day").format("YYYY-MM-DD");
    const simDates = dateRange(simStart, simEnd);

    const confirmedDeparture = new Map();
    const confirmedOccupied = new Map();
    BUILDING_ORDER.forEach((bKey) => {
        simDates.forEach((d) => confirmedOccupied.set(`${d}__${bKey}`, 0));
    });

    reservations.forEach((r) => {
        const bKey = resolver(r.building);
        if (!BUILDING_ORDER.includes(bKey)) return;
        if (r.departure >= forecastStart && r.departure <= forecastEnd) {
            const depKey = `${r.departure}__${bKey}`;
            confirmedDeparture.set(depKey, (confirmedDeparture.get(depKey) || 0) + 1);
        }

        let cursor = dayjs.tz(r.arrival, TOKYO_TZ);
        const checkout = dayjs.tz(r.departure, TOKYO_TZ);
        while (cursor.isBefore(checkout)) {
            const d = cursor.format("YYYY-MM-DD");
            if (d >= simStart && d <= simEnd) {
                const occKey = `${d}__${bKey}`;
                confirmedOccupied.set(occKey, (confirmedOccupied.get(occKey) || 0) + 1);
            }
            cursor = cursor.add(1, "day");
        }
    });

    const projectedOccupied = new Map();
    const projectedDeparture = new Map();
    BUILDING_ORDER.forEach((bKey) => {
        simDates.forEach((d) => projectedOccupied.set(`${d}__${bKey}`, 0));
    });

    // Day-by-day fluid simulation:
    // vacant rooms can receive potential check-ins, and those generate future check-outs.
    simDates.forEach((dateKey) => {
        BUILDING_ORDER.forEach((buildingKey) => {
            const inventory = Number(inventoryByBuilding?.[buildingKey] || 0);
            if (!inventory) return;
            const occConfirmed = confirmedOccupied.get(`${dateKey}__${buildingKey}`) || 0;
            const occProjected = projectedOccupied.get(`${dateKey}__${buildingKey}`) || 0;
            const vacantRooms = Math.max(0, inventory - occConfirmed - occProjected);
            const potentialCheckins = estimateVacantCheckins({
                buildingKey,
                targetDateKey: dateKey,
                vacantRooms,
                inventory,
                todayKey,
                history,
            });

            if (potentialCheckins <= 0) return;
            const losDist = history.losDistByBuilding.get(buildingKey) || [{ nights: 1, p: 1 }];
            losDist.forEach(({ nights, p }) => {
                if (nights < 1 || p <= 0) return;
                const flow = potentialCheckins * p;
                if (flow <= 0) return;

                const depDate = dayjs.tz(dateKey, TOKYO_TZ).add(nights, "day").format("YYYY-MM-DD");
                if (depDate >= forecastStart && depDate <= forecastEnd) {
                    const depKey = `${depDate}__${buildingKey}`;
                    projectedDeparture.set(depKey, (projectedDeparture.get(depKey) || 0) + flow);
                }

                let cursor = dayjs.tz(dateKey, TOKYO_TZ);
                const checkout = dayjs.tz(depDate, TOKYO_TZ);
                while (cursor.isBefore(checkout)) {
                    const stayDate = cursor.format("YYYY-MM-DD");
                    if (stayDate >= simStart && stayDate <= simEnd) {
                        const occKey = `${stayDate}__${buildingKey}`;
                        projectedOccupied.set(occKey, (projectedOccupied.get(occKey) || 0) + flow);
                    }
                    cursor = cursor.add(1, "day");
                }
            });
        });
    });

    forecastDates.forEach((dateKey) => {
        const buildingRows = BUILDING_ORDER.map((buildingKey) => {
            const confirmed = safeInt(confirmedDeparture.get(`${dateKey}__${buildingKey}`) || 0);
            const projectedRaw = Number(projectedDeparture.get(`${dateKey}__${buildingKey}`) || 0);
            const projected = Math.max(0, Math.ceil(projectedRaw));
            const rule = DEFAULT_BUILDING_RULES[buildingKey] || {};
            const cleaningUnitMultiplier = Math.max(1, Number(rule.cleaningUnitMultiplier || 1));
            const physicalTotal = confirmed + projected;
            const displayConfirmed = confirmed * cleaningUnitMultiplier;
            const displayProjected = projected * cleaningUnitMultiplier;
            const displayTotal = physicalTotal * cleaningUnitMultiplier;

            return {
                building: BUILDING_DISPLAY[buildingKey],
                buildingKey,
                cleaningCount: displayTotal,
                settingCount: 0,
                turnoverCount: 0,
                confirmedCO: displayConfirmed,
                projectedCO: displayProjected,
                totalCO: displayTotal,
                physicalConfirmedCO: confirmed,
                physicalProjectedCO: projected,
                physicalCheckoutUnits: physicalTotal,
            };
        });

        const capacityRows = addLaborCostScenarios(
            enrichCapacityRows(buildingRows, {
                buildingRules: DEFAULT_BUILDING_RULES,
                productiveHoursPerPerson: PRODUCTIVE_HOURS_PER_PERSON,
                bufferRate: BUFFER_RATE,
                okuboMode: "two_worker_standard",
            }),
            DEFAULT_WAGE_SCENARIOS
        );

        const aggregate = capacityRows.reduce((acc, row) => {
            const rule = DEFAULT_BUILDING_RULES[row.buildingKey] || {};
            const confirmedHeadcount = calculateCapacityHeadcount(rule, Number(row.physicalConfirmedCO || 0));
            acc.confirmed += safeInt(row.confirmedCO);
            acc.projected += safeInt(row.projectedCO);
            acc.cleaning += safeInt(row.totalCO);
            acc.turnover += safeInt(row.turnoverCount);
            acc.totalJobHours += Number(row.estimatedJobHours || 0);
            acc.confirmedHeadcount += confirmedHeadcount;
            acc.mathMinHeadcount += safeInt(row.mathMinHeadcount);
            acc.operationalMinHeadcount += safeInt(row.operationalMinHeadcount);
            acc.minHeadcount += safeInt(row.operationalMinHeadcount);
            acc.recommendedHeadcount += safeInt(row.recommendedHeadcount);
            acc.costLow += safeInt(row.estimatedLaborCostLow);
            acc.costBase += safeInt(row.estimatedLaborCostBase);
            acc.costHigh += safeInt(row.estimatedLaborCostHigh);
            // Confirmed-only cost: proportional share of base cost by confirmed physical units
            const physUnits = Number(row.physicalCheckoutUnits || 0);
            const physConfirmed = Number(row.physicalConfirmedCO || 0);
            const confirmedFraction = physUnits > 0 ? physConfirmed / physUnits : 0;
            acc.confirmedCostBase += Math.round(safeInt(row.estimatedLaborCostBase) * confirmedFraction);
            return acc;
        }, {
            confirmed: 0,
            projected: 0,
            cleaning: 0,
            turnover: 0,
            totalJobHours: 0,
            confirmedHeadcount: 0,
            mathMinHeadcount: 0,
            operationalMinHeadcount: 0,
            minHeadcount: 0,
            recommendedHeadcount: 0,
            costLow: 0,
            costBase: 0,
            costHigh: 0,
            confirmedCostBase: 0,
        });

        daily.set(dateKey, aggregate);
        capacityRows.forEach((row) => {
            const rule = DEFAULT_BUILDING_RULES[row.buildingKey] || {};
            const confirmedHeadcount = calculateCapacityHeadcount(rule, Number(row.physicalConfirmedCO || 0));
            dailyByBuilding.push({
                date: dateKey,
                weekday: dayjs.tz(dateKey, TOKYO_TZ).format("ddd"),
                building: BUILDING_DISPLAY[row.buildingKey] || row.building,
                buildingKey: row.buildingKey,
                confirmed: safeInt(row.confirmedCO),
                projected: safeInt(row.projectedCO),
                setting: 0,
                estimatedJobHours: Number(row.estimatedJobHours || 0),
                confirmedHeadcount,
                mathMinHeadcount: safeInt(row.mathMinHeadcount),
                operationalMinHeadcount: safeInt(row.operationalMinHeadcount),
                minHeadcount: safeInt(row.operationalMinHeadcount),
                recommendedHeadcount: safeInt(row.recommendedHeadcount),
                costBase: safeInt(row.estimatedLaborCostBase),
                confirmedCostBase: Math.round(safeInt(row.estimatedLaborCostBase) * (
                    Number(row.physicalCheckoutUnits || 0) > 0
                        ? Number(row.physicalConfirmedCO || 0) / Number(row.physicalCheckoutUnits || 0)
                        : 0
                )),
                confidence: getConfidence(dayjs.tz(dateKey, TOKYO_TZ).diff(dayjs.tz(todayKey, TOKYO_TZ), "day")),
            });
        });
    });

    return { daily, dailyByBuilding };
}

function computeConfirmedWeekdayWeekendAverages(monthDates, daily) {
    let weekdayCount = 0;
    let weekendCount = 0;
    let weekdayDays = 0;
    let weekendDays = 0;
    monthDates.forEach((dateKey) => {
        const dow = dayjs.tz(dateKey, TOKYO_TZ).day();
        const confirmed = safeInt((daily.get(dateKey) || {}).confirmed || 0);
        if (dow === 0 || dow === 6) { weekendDays += 1; weekendCount += confirmed; }
        else { weekdayDays += 1; weekdayCount += confirmed; }
    });
    const weekdayAvg = weekdayDays ? weekdayCount / weekdayDays : 0;
    const weekendAvg = weekendDays ? weekendCount / weekendDays : 0;
    const concentration = weekdayAvg > 0 ? weekendAvg / weekdayAvg : (weekendAvg > 0 ? null : 0);
    return { weekdayAvg, weekendAvg, concentration };
}

function formatWeekendIncrease(concentration) {
    if (concentration === null) return "\uc8fc\ub9d0\ub9cc"; // 주말만
    if (!Number.isFinite(Number(concentration))) return "-";
    const pct = Math.round((Number(concentration) - 1) * 100);
    return `\ud3c9\uc77c \ub300\ube44 ${pct >= 0 ? "+" : ""}${pct}%`;
}

function percentile(values, p) {
    const sorted = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function average(values) {
    const nums = values.filter((v) => Number.isFinite(v));
    if (!nums.length) return 0;
    return nums.reduce((sum, v) => sum + v, 0) / nums.length;
}

function getMonthPeakStats(monthDates, daily) {
    const confirmedCounts = [];
    const confirmedNeeds = [];
    const projectedCounts = [];
    const reserveNeeds = [];
    monthDates.forEach((d) => {
        const s = daily.get(d) || {};
        confirmedCounts.push(safeInt(s.confirmed));
        confirmedNeeds.push(safeInt(s.confirmedHeadcount));
        projectedCounts.push(safeInt(s.projected));
        reserveNeeds.push(safeInt(s.operationalMinHeadcount || s.minHeadcount || 0));
    });
    return {
        confirmedAvg: average(confirmedCounts),
        confirmedP80: percentile(confirmedCounts, 80),
        confirmedP90: percentile(confirmedCounts, 90),
        confirmedNeedAvg: average(confirmedNeeds),
        projectedP80: percentile(projectedCounts, 80),
        reserveAvg: average(reserveNeeds),
        reserveP80: percentile(reserveNeeds, 80),
    };
}

function getDayPeakSignal(stats, monthPeakStats) {
    const confirmed = safeInt(stats.confirmed);
    const confirmedNeed = safeInt(stats.confirmedHeadcount);
    const projected = safeInt(stats.projected);
    const reserveNeed = safeInt(stats.operationalMinHeadcount || stats.minHeadcount || 0);
    if (!monthPeakStats) return { type: "", label: "" };

    const confirmedHigh = confirmed > 0 && (
        confirmed >= monthPeakStats.confirmedP90
        || confirmed >= monthPeakStats.confirmedAvg + 3
        || confirmedNeed >= monthPeakStats.confirmedNeedAvg + 2
    );
    if (confirmedHigh) {
        return { type: "confirmed_high", label: "\ud655\uc815\ud53c\ud06c \ub192\uc74c" };
    }

    const confirmedWarning = confirmed > 0 && (
        confirmed >= monthPeakStats.confirmedP80
        || confirmed >= monthPeakStats.confirmedAvg + 2
        || confirmedNeed >= monthPeakStats.confirmedNeedAvg + 1
    );
    if (confirmedWarning) {
        return { type: "confirmed_warning", label: "\ud655\uc815\ud53c\ud06c \uc8fc\uc758" };
    }

    const projectedWarning = projected > 0 && (
        projected >= monthPeakStats.projectedP80
        || reserveNeed >= monthPeakStats.reserveP80
        || reserveNeed >= monthPeakStats.reserveAvg + 1
    );
    if (projectedWarning) {
        return { type: "projected_warning", label: "\uc608\uc0c1\uc8fc\uc758" };
    }

    return { type: "", label: "" };
}

function getMonthPeakRiskLabel(monthDates, daily) {
    const monthPeakStats = getMonthPeakStats(monthDates, daily);
    let hasHigh = false;
    let hasWarning = false;
    let hasProjectedWarning = false;
    monthDates.forEach((d) => {
        const signal = getDayPeakSignal(daily.get(d) || {}, monthPeakStats);
        if (signal.type === "confirmed_high") hasHigh = true;
        else if (signal.type === "confirmed_warning") hasWarning = true;
        else if (signal.type === "projected_warning") hasProjectedWarning = true;
    });
    if (hasHigh) return "\ud655\uc815\ud53c\ud06c \ub192\uc74c";
    if (hasWarning) return "\ud655\uc815\ud53c\ud06c \uc8fc\uc758";
    if (hasProjectedWarning) return "\uc608\uc0c1\uc8fc\uc758";
    return "\ub0ae\uc74c"; // \ub0ae\uc74c
}

function getMonthPeakDayCountDisplay(monthDates, daily) {
    const monthPeakStats = getMonthPeakStats(monthDates, daily);
    const peakDayCount = monthDates.reduce((count, d) => {
        const signal = getDayPeakSignal(daily.get(d) || {}, monthPeakStats);
        return signal.type ? count + 1 : count;
    }, 0);
    return `${peakDayCount}\uac74`;
}

function buildCalendarCell(dateKey, stats, isToday, peakSignal = { type: "", label: "" }) {
    const d = dayjs.tz(dateKey, TOKYO_TZ);
    const confirmed = safeInt(stats.confirmed);
    const projected = safeInt(stats.projected);
    const confirmedNeed = safeInt(stats.confirmedHeadcount);
    const reserveNeed = safeInt(stats.operationalMinHeadcount);
    const lines = [
        `${d.format("M/D ddd")}${isToday ? "  TODAY" : ""}`,
        `\ud655\uc815 ${confirmed}\uac74`,
        `\uc608\uc0c1 ${projected}\uac74`,
        `\ud655\uc815\ud544\uc694 ${confirmedNeed}\uba85`,
        `\ub300\ube44\ud544\uc694 ${reserveNeed}\uba85`,
        yen(stats.confirmedCostBase),
    ];
    if (peakSignal.label) {
        lines.push(peakSignal.label);
    }
    return lines.join("\n");
}

function buildCalendarCellRichText(dateKey, stats, isToday, peakSignal = { type: "", label: "" }) {
    const text = buildCalendarCell(dateKey, stats, isToday, peakSignal);
    const lines = text.split("\n");
    let cursor = 0;
    const starts = lines.map((line) => {
        const start = cursor;
        cursor += line.length + 1;
        return start;
    });

    // Line indices: 0=date, 1=확정(amber), 2=예상(blue), 3=확정필요, 4=대비필요, 5=cost, 6=peak(optional)
    const runs = [
        // Line 0: date — dark navy, bold
        { startIndex: starts[0], format: { bold: true, foregroundColorStyle: { rgbColor: { red: 0.07, green: 0.13, blue: 0.27 } } } },
        // Line 1: 확정 — amber (#B45309)
        { startIndex: starts[1], format: { bold: false, foregroundColorStyle: { rgbColor: { red: 0.706, green: 0.325, blue: 0.035 } } } },
        // Line 2: 예상 — blue (#2563EB)
        { startIndex: starts[2], format: { bold: false, foregroundColorStyle: { rgbColor: { red: 0.145, green: 0.388, blue: 0.922 } } } },
        // Line 3: 확정필요 — dark slate
        { startIndex: starts[3], format: { bold: false, foregroundColorStyle: { rgbColor: { red: 0.1, green: 0.1, blue: 0.1 } } } },
        // Line 4: 대비필요 — dark navy
        { startIndex: starts[4], format: { bold: false, foregroundColorStyle: { rgbColor: { red: 0.118, green: 0.227, blue: 0.541 } } } },
        // Line 5: cost — green (#047857)
        { startIndex: starts[5], format: { bold: false, foregroundColorStyle: { rgbColor: { red: 0.016, green: 0.471, blue: 0.341 } } } },
    ];
    // Line 6 (optional): peak risk — red (#DC2626), bold
    if (lines.length > 6 && lines[6]) {
        runs.push({ startIndex: starts[6], format: { bold: true, foregroundColorStyle: { rgbColor: { red: 0.863, green: 0.149, blue: 0.149 } } } });
    }
    return { text, textFormatRuns: runs };
}

function computeMonthlyMinimumWorkforce(daily, months, manualInputs = new Map()) {
    return months.map((monthKey) => {
        const monthDates = [...daily.keys()].filter((d) => d.startsWith(monthKey)).sort();
        if (!monthDates.length) {
            return {
                monthKey,
                monthlyMinWorkforce: 0,
                fixedStaff: 0,
                supportPool: 0,
                peakDate: null,
                peakOperational: 0,
                shortageRiskDates: [],
                systemFixedStaff: 0,
                appliedFixedStaff: 0,
                fixedShortage: 0,
                allPartTimeEquivalent: 0,
                avgPartTimeDaysPerWeek: AVG_WORK_DAYS_PER_WEEK,
                manualNotes: "",
            };
        }

        let peakOperational = 0;
        let peakDate = null;
        let baselineOperational = Infinity;
        const dayEntries = monthDates.map((d) => {
            const s = daily.get(d) || {};
            const opMin = s.operationalMinHeadcount || 0;
            if (opMin > peakOperational) { peakOperational = opMin; peakDate = d; }
            if (opMin > 0 && opMin < baselineOperational) baselineOperational = opMin;
            return {
                date: d,
                mathMin: s.mathMinHeadcount || 0,
                operationalMin: opMin,
                recommended: s.recommendedHeadcount || 0,
                confirmed: s.confirmed || 0,
                projected: s.projected || 0,
            };
        });
        if (!Number.isFinite(baselineOperational)) baselineOperational = 0;

        const manual = manualInputs.get(monthKey) || {};
        const systemFixedStaff = baselineOperational;
        const appliedFixedStaff = manual.confirmed_fixed_staff != null
            ? manual.confirmed_fixed_staff
            : systemFixedStaff;
        const avgPartTimeDays = manual.avg_part_time_days_per_week != null
            ? manual.avg_part_time_days_per_week
            : AVG_WORK_DAYS_PER_WEEK;
        const weeksInScope = monthDates.length / 7;
        const partTimeMonthlyCapacityDays = avgPartTimeDays > 0
            ? avgPartTimeDays * weeksInScope
            : 0;

        // Field planning must satisfy both peak-day coverage and total monthly shortage coverage.
        const dailySupportShortages = dayEntries.map((entry) => Math.max(0, entry.operationalMin - appliedFixedStaff));
        const supportDemandPeak = Math.max(0, ...dailySupportShortages);
        const supportDemandDays = dailySupportShortages.reduce((sum, shortage) => sum + shortage, 0);
        const supportPoolByMonthlyCoverage = partTimeMonthlyCapacityDays > 0
            ? Math.ceil(supportDemandDays / partTimeMonthlyCapacityDays)
            : 0;
        const supportPool = Math.max(supportDemandPeak, supportPoolByMonthlyCoverage);
        const totalRequiredPool = appliedFixedStaff + supportPool;
        const fixedShortage = Math.max(0, systemFixedStaff - appliedFixedStaff);
        const totalOperationalDays = dayEntries.reduce((sum, entry) => sum + entry.operationalMin, 0);
        const allPartTimeEquivalentByMonthlyCoverage = partTimeMonthlyCapacityDays > 0
            ? Math.ceil(totalOperationalDays / partTimeMonthlyCapacityDays)
            : 0;
        const allPartTimeEquivalent = Math.max(peakOperational, allPartTimeEquivalentByMonthlyCoverage);

        const shortageRiskDates = [...dayEntries]
            .sort((a, b) => b.operationalMin - a.operationalMin)
            .slice(0, 5)
            .map((entry) => ({
                date: entry.date,
                mathMin: entry.mathMin,
                operationalMin: entry.operationalMin,
                recommended: entry.recommended,
                gap: entry.recommended - entry.operationalMin,
                confirmed: entry.confirmed,
                projected: entry.projected,
            }));

        return {
            monthKey,
            // Existing fields (semantics updated): monthlyMinWorkforce now means total_required_pool;
            // fixedStaff now means appliedFixedStaff.
            monthlyMinWorkforce: totalRequiredPool,
            fixedStaff: appliedFixedStaff,
            supportPool,
            peakDate,
            peakOperational,
            shortageRiskDates,
            systemFixedStaff,
            appliedFixedStaff,
            fixedShortage,
            allPartTimeEquivalent,
            avgPartTimeDaysPerWeek: avgPartTimeDays,
            manualNotes: manual.notes || "",
        };
    });
}

async function updateSheetWithForecast(sheets, model, monthlyData, opts = {}) {
    const valuesRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_TITLE}!A1:H400`,
    });
    const values = valuesRes.data.values || [];

    const buildingRowInitial = findRowByLabel(values, "\uac74\ubb3c\ubcc4 3\uac1c\uc6d4 \uc694\uc57d");
    const weeklyRow = findRowByLabel(values, "\uc8fc\uac04 \uc694\uc57d");
    const monthlyMinRowInitial = findRowByLabel(values, "\uc6d4\ubcc4 \ucd5c\uc18c \uc778\ub825");
    const apiRowInitial = findRowByLabel(values, API_INPUT_LABEL);
    const manualInputRowInitial = findRowByLabel(values, MANUAL_INPUT_LABEL);

    let buildingRow = buildingRowInitial;
    let monthlyMinRow = monthlyMinRowInitial;
    let apiRow = apiRowInitial;
    let manualInputRow = manualInputRowInitial;

    const todayKeyForWeekly = dayjs().tz(TOKYO_TZ).format("YYYY-MM-DD");
    const weeklySummaryRowsAll = buildWeeklySummaryRowsFromDaily(model.daily, opts.roomMap || new Map(), todayKeyForWeekly);
    const weeklyTargetCount = Math.min(weeklySummaryRowsAll.length, MAX_WEEKLY_SUMMARY_ROWS_HARD_CAP);

    if (weeklyRow >= 0 && buildingRowInitial > weeklyRow && weeklyTargetCount > 0) {
        const maxBySheetBefore = Math.max(0, buildingRowInitial - weeklyRow - 3);
        const needInsert = Math.max(0, weeklyTargetCount - maxBySheetBefore);
        if (needInsert > 0) {
            const sheetId = await getSheetIdByTitle(sheets, SPREADSHEET_ID, SHEET_TITLE);
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                resource: {
                    requests: [{
                        insertDimension: {
                            range: {
                                sheetId,
                                dimension: "ROWS",
                                startIndex: buildingRowInitial,
                                endIndex: buildingRowInitial + needInsert,
                            },
                            inheritFromBefore: true,
                        },
                    }],
                },
            });
            const bump = (idx) => (idx >= buildingRowInitial ? idx + needInsert : idx);
            buildingRow = bump(buildingRowInitial);
            if (monthlyMinRowInitial >= 0) monthlyMinRow = bump(monthlyMinRowInitial);
            if (apiRowInitial >= 0) apiRow = bump(apiRowInitial);
            if (manualInputRowInitial >= 0) manualInputRow = bump(manualInputRowInitial);
        }
    }

    const todayKey = dayjs().tz(TOKYO_TZ).format("YYYY-MM-DD");
    let todayCellPosition = null;
    const layoutSheetId = await getSheetIdByTitle(sheets, SPREADSHEET_ID, SHEET_TITLE);

    // Detect calendar title rows and run one-time migration to ensure 3 KPI rows above each.
    let calendarValues = values;
    const monthRows = [];
    for (let i = 0; i < calendarValues.length; i += 1) {
        if (String(calendarValues[i]?.[0] || "").startsWith("\uc6d4\uac04 \uce98\ub9b0\ub354 | ")) monthRows.push(i);
    }

    // Process from bottom to top so earlier row indices are not invalidated by insertions.
    const sortedForMigration = [...monthRows].sort((a, b) => b - a);
    let migrationInsertions = 0;
    for (const rowIdx of sortedForMigration) {
        if (rowIdx < 3) continue;
        const threeAbove = String(calendarValues[rowIdx - 3]?.[0] || "").trim();
        if (!threeAbove) continue; // blank row \u2014 can write KPI row 1 there, no insert needed
        if (/^\d{1,2}\uc6d4 /.test(threeAbove)) continue; // already has our KPI row 1 (e.g. "5\uc6d4 \uc608\uc0c1 \ucd1d \uccad\uc18c")
        // Row is occupied by non-KPI content (e.g. calendar day cell, title) \u2014 insert 1 row.
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: {
                requests: [{
                    insertDimension: {
                        range: {
                            sheetId: layoutSheetId,
                            dimension: "ROWS",
                            startIndex: rowIdx - 2,
                            endIndex: rowIdx - 1,
                        },
                        inheritFromBefore: false,
                    },
                }],
            },
        });
        migrationInsertions++;
    }
    if (migrationInsertions > 0) {
        const refreshed = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_TITLE}!A1:H400`,
        });
        calendarValues = refreshed.data.values || [];
        monthRows.length = 0;
        for (let i = 0; i < calendarValues.length; i += 1) {
            if (String(calendarValues[i]?.[0] || "").startsWith("\uc6d4\uac04 \uce98\ub9b0\ub354 | ")) monthRows.push(i);
        }
        console.log(`[forecast] calendar migration: inserted ${migrationInsertions} KPI row(s), re-detected ${monthRows.length} calendars`);
    }

    const updates = [];
    const calendarLayoutRequests = [];
    const calendarRichTextRequests = [];
    const peakCellPositions = [];
    const weeklyFormatRequests = [];
    const buildingSummaryFormatRequests = [];
    const attendanceAppFormatRequests = [];
    const updateTs = dayjs().tz(TOKYO_TZ).format("YYYY-MM-DD HH:mm");
    let staleApiRow = -1;
    if (apiRow >= 0 && manualInputRow >= 0 && apiRow < manualInputRow) {
        staleApiRow = apiRow;
        apiRow = -1;
    }
    monthRows.forEach((rowIdx) => {
        const title = String(calendarValues[rowIdx]?.[0] || "");
        const m = title.match(/(\d{4})\ub144 (\d{1,2})\uc6d4/);
        if (!m) return;
        const year = Number(m[1]);
        const monthNum = Number(m[2]);
        const monthKey = `${m[1]}-${String(monthNum).padStart(2, "0")}`;

        const monthDates = [...model.daily.keys()].filter((d) => d.startsWith(monthKey)).sort();

        // Write 3 KPI rows above the calendar title.
        // KPI row 1: A${rowIdx-2}, KPI row 2: A${rowIdx-1}, KPI row 3: A${rowIdx}  (1-indexed A1 notation)
        // Title remains at A${rowIdx+1}.
        if (rowIdx >= 3) {
            const monthKpi = monthDates.reduce((acc, d) => {
                const s = model.daily.get(d) || {};
                acc.cleaning += safeInt(s.cleaning);
                acc.confirmed += safeInt(s.confirmed);
                acc.projected += safeInt(s.projected);
                acc.cost += safeInt(s.costBase);
                acc.confirmedCost += safeInt(s.confirmedCostBase);
                return acc;
            }, { cleaning: 0, confirmed: 0, projected: 0, cost: 0, confirmedCost: 0 });

            const mData = monthlyData && monthlyData.find((d) => d && d.monthKey === monthKey);
            const fixedStaff = mData ? mData.fixedStaff : 0;
            const systemFixedStaff = mData ? mData.systemFixedStaff : 0;
            const supportPool = mData ? mData.supportPool : 0;
            const totalPool = mData ? mData.monthlyMinWorkforce : 0;

            const projectedLow = Math.max(0, Math.round(monthKpi.projected * (0.85 / 0.90)));
            const projectedHigh = Math.round(monthKpi.projected * (0.95 / 0.90));
            const monthPeakLabel = getMonthPeakRiskLabel(monthDates, model.daily);
            const monthPeakDayCountDisplay = getMonthPeakDayCountDisplay(monthDates, model.daily);
            const { weekdayAvg, weekendAvg, concentration } = computeConfirmedWeekdayWeekendAverages(monthDates, model.daily);
            const weekendIncreaseDisplay = formatWeekendIncrease(concentration);

            // KPI row 1: demand summary
            updates.push({
                range: `${SHEET_TITLE}!A${rowIdx - 2}:H${rowIdx - 2}`,
                values: [[
                    `${monthNum}\uc6d4 \ud655\uc815+\uc608\uc0c1 \ub300\ube44`,
                    `${monthKpi.cleaning}\uac74`,
                    "\ud655\uc815 \uccad\uc18c",
                    `${monthKpi.confirmed}\uac74`,
                    "\uc608\uc0c1 \ucd94\uac00(Base)",
                    `${monthKpi.projected}\uac74`,
                    "\uc608\uc0c1 \ubc94\uc704(85~95%)",
                    `${projectedLow}~${projectedHigh}\uac74`,
                ]],
            });
            // KPI row 2: workforce summary
            updates.push({
                range: `${SHEET_TITLE}!A${rowIdx - 1}:H${rowIdx - 1}`,
                values: [[
                    "\ucd5c\uc18c \uace0\uc815\uc778\uc6d0",
                    `${systemFixedStaff}\uba85`,
                    "\uc801\uc6a9 \uace0\uc815\uc778\uc6d0",
                    `${fixedStaff}\uba85`,
                    "\ubcf4\ucda9\ud480 \ud544\uc694",
                    `${supportPool}\uba85`,
                    "\ucd1d \ud655\ubcf4 \ud544\uc694",
                    `${totalPool}\uba85`,
                ]],
            });
            // KPI row 3: daily average weekday/weekend + peak cleaning + confirmed labor cost
            updates.push({
                range: `${SHEET_TITLE}!A${rowIdx}:H${rowIdx}`,
                values: [[
                    "\ud3c9/\uc8fc \uc77c\ud3c9\uade0",
                    `${weekdayAvg.toFixed(1)}/${weekendAvg.toFixed(1)}`,
                    "\uc8fc\ub9d0 \uc99d\uac00\uc728",
                    weekendIncreaseDisplay,
                    "\ud53c\ud06c\uc77c \uc218",
                    monthPeakDayCountDisplay,
                    "\ud655\uc815 \uc778\uac74\ube44",
                    yen(monthKpi.confirmedCost),
                ]],
            });

            // KPI row 1 E-H: projected demand \u2014 blue text only
            calendarLayoutRequests.push({
                repeatCell: {
                    range: { sheetId: null, startRowIndex: rowIdx - 3, endRowIndex: rowIdx - 2, startColumnIndex: 4, endColumnIndex: 8 },
                    cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColorStyle: { rgbColor: { red: 0.145, green: 0.388, blue: 0.922 } } } } },
                    fields: "userEnteredFormat.textFormat.bold,userEnteredFormat.textFormat.foregroundColorStyle",
                },
            });
            calendarLayoutRequests.push({
                updateDimensionProperties: {
                    range: { sheetId: null, dimension: "ROWS", startIndex: rowIdx - 3, endIndex: rowIdx - 2 },
                    properties: { pixelSize: 24 },
                    fields: "pixelSize",
                },
            });
            // KPI row 3 E-F: peak risk \u2014 red when warning/high
            if (monthPeakLabel !== "\ub0ae\uc74c") {
                calendarLayoutRequests.push({
                    repeatCell: {
                        range: { sheetId: null, startRowIndex: rowIdx - 1, endRowIndex: rowIdx, startColumnIndex: 4, endColumnIndex: 6 },
                        cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColorStyle: { rgbColor: { red: 0.863, green: 0.149, blue: 0.149 } } } } },
                        fields: "userEnteredFormat.textFormat.bold,userEnteredFormat.textFormat.foregroundColorStyle",
                    },
                });
            }
        }

        // Confirmed workload is the primary peak signal; projected demand is secondary.
        const monthPeakStats = getMonthPeakStats(monthDates, model.daily);

        for (let w = 0; w < 6; w += 1) {
            for (let c = 0; c < 7; c += 1) {
                const r = rowIdx + 2 + w;
                const currentCell = String(calendarValues[r]?.[c] || "");
                if (!currentCell.trim()) continue;
                const first = currentCell.split("\n")[0] || "";
                const dm = first.match(/^(\d{1,2})\/(\d{1,2})/);
                if (!dm) continue;
                const month = Number(dm[1]);
                const day = Number(dm[2]);
                const dateKey = dayjs.tz(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, TOKYO_TZ).format("YYYY-MM-DD");
                const stats = model.daily.get(dateKey) || {
                    cleaning: 0, confirmedHeadcount: 0, minHeadcount: 0, operationalMinHeadcount: 0, recommendedHeadcount: 0, costBase: 0, confirmedCostBase: 0, confirmed: 0, projected: 0,
                };
                if (dateKey === todayKey) todayCellPosition = { r, c };
                const dayPeakSignal = getDayPeakSignal(stats, monthPeakStats);
                if (dayPeakSignal.type) {
                    peakCellPositions.push({ r, c, type: dayPeakSignal.type });
                }
                const richCell = buildCalendarCellRichText(dateKey, stats, dateKey === todayKey, dayPeakSignal);
                updates.push({
                    range: `${SHEET_TITLE}!${colToA1(c)}${r + 1}`,
                    values: [[richCell.text]],
                });
                calendarRichTextRequests.push({
                    updateCells: {
                        range: { sheetId: layoutSheetId, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: c, endColumnIndex: c + 1 },
                        rows: [{ values: [{ userEnteredValue: { stringValue: richCell.text }, textFormatRuns: richCell.textFormatRuns }] }],
                        fields: "userEnteredValue,textFormatRuns",
                    },
                });
            }
        }

        // Calendar readability: reset day cell backgrounds, apply weekday header and row heights.
        calendarLayoutRequests.push({
            repeatCell: {
                range: { sheetId: null, startRowIndex: rowIdx + 2, endRowIndex: rowIdx + 8, startColumnIndex: 0, endColumnIndex: 7 },
                cell: { userEnteredFormat: { backgroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } } } },
                fields: "userEnteredFormat.backgroundColorStyle",
            },
        });
        calendarLayoutRequests.push(
            {
                repeatCell: {
                    range: { sheetId: null, startRowIndex: rowIdx + 1, endRowIndex: rowIdx + 2, startColumnIndex: 0, endColumnIndex: 7 },
                    cell: { userEnteredFormat: { backgroundColorStyle: { rgbColor: { red: 0.05, green: 0.12, blue: 0.22 } }, textFormat: { bold: true, fontSize: 11, foregroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } } }, horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } },
                    fields: "userEnteredFormat.backgroundColorStyle,userEnteredFormat.textFormat,userEnteredFormat.horizontalAlignment,userEnteredFormat.verticalAlignment",
                },
            },
            { updateDimensionProperties: { range: { sheetId: null, dimension: "ROWS", startIndex: rowIdx + 1, endIndex: rowIdx + 2 }, properties: { pixelSize: 28 }, fields: "pixelSize" } },
            {
                repeatCell: {
                    range: { sheetId: null, startRowIndex: rowIdx + 2, endRowIndex: rowIdx + 8, startColumnIndex: 0, endColumnIndex: 7 },
                    cell: { userEnteredFormat: { wrapStrategy: "WRAP", verticalAlignment: "TOP", horizontalAlignment: "LEFT" } },
                    fields: "userEnteredFormat.wrapStrategy,userEnteredFormat.verticalAlignment,userEnteredFormat.horizontalAlignment",
                },
            },
            { updateDimensionProperties: { range: { sheetId: null, dimension: "ROWS", startIndex: rowIdx + 2, endIndex: rowIdx + 8 }, properties: { pixelSize: 140 }, fields: "pixelSize" } }
        );
    });

    peakCellPositions.forEach(({ r, c, type }) => {
        if (type === "projected_warning") return;
        const rgbColor = type === "confirmed_high"
            ? { red: 1.0, green: 0.894, blue: 0.902 }
            : { red: 1.0, green: 0.945, blue: 0.949 };
        calendarLayoutRequests.push({
            repeatCell: {
                range: {
                    sheetId: null,
                    startRowIndex: r,
                    endRowIndex: r + 1,
                    startColumnIndex: c,
                    endColumnIndex: c + 1,
                },
                cell: {
                    userEnteredFormat: {
                        backgroundColorStyle: { rgbColor },
                    },
                },
                fields: "userEnteredFormat.backgroundColorStyle",
            },
        });
    });

    // Apply yellow highlight to the actual TODAY cell (only one cell, overrides white reset).
    if (todayCellPosition) {
        calendarLayoutRequests.push({
            repeatCell: {
                range: {
                    sheetId: null,
                    startRowIndex: todayCellPosition.r,
                    endRowIndex: todayCellPosition.r + 1,
                    startColumnIndex: todayCellPosition.c,
                    endColumnIndex: todayCellPosition.c + 1,
                },
                cell: {
                    userEnteredFormat: {
                        backgroundColorStyle: { rgbColor: { red: 1.0, green: 0.95, blue: 0.4 } },
                    },
                },
                fields: "userEnteredFormat.backgroundColorStyle",
            },
        });
    }

    if (weeklyRow >= 0) {
        const maxBySheet = buildingRow > weeklyRow
            ? Math.max(0, buildingRow - weeklyRow - 3)
            : MAX_WEEKLY_SUMMARY_ROWS_HARD_CAP;
        const maxWeekRows = Math.min(MAX_WEEKLY_SUMMARY_ROWS_HARD_CAP, maxBySheet);
        const weekRows = weeklySummaryRowsAll.slice(0, maxWeekRows);
        if (weeklySummaryRowsAll.length > maxWeekRows) {
            console.warn(
                `[forecast] weekly summary capped: ${weeklySummaryRowsAll.length} weeks -> ${maxWeekRows} rows (sheet layout max ${maxBySheet} or hard cap ${MAX_WEEKLY_SUMMARY_ROWS_HARD_CAP})`
            );
        }

        if (buildingRow > weeklyRow) {
            await sheets.spreadsheets.values.clear({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_TITLE}!A${weeklyRow + 3}:H${buildingRow}`,
            });
        }

        updates.push({
            range: `${SHEET_TITLE}!A${weeklyRow + 2}:H${weeklyRow + 2}`,
            values: [[
                "\uc8fc \uc2dc\uc791\uc77c",
                "\uc8fc \uc885\ub8cc\uc77c",
                "\ud655\uc815 \uccad\uc18c",
                "\ub0a8\uc740 \uc8fc\ub0b4 \ucd94\uac00\uac00\ub2a5 CO",
                "\ud655\uc815 \ud53c\ud06c\uc77c",
                "\ud53c\ud06c \ub300\uc751",
                "\uc8fc\uac04 \ud655\ubcf4\ud480",
                "\ud655\uc815 \uc778\uac74\ube44",
            ]],
        });
        const lastDataRow = weeklyRow + 2 + Math.max(weekRows.length, 1);
        updates.push({
            range: `${SHEET_TITLE}!A${weeklyRow + 3}:H${lastDataRow}`,
            values: weekRows.length ? weekRows : [["--", "--", "--", "--", "--", "--", "--", "--"]],
        });

        // Weekly summary format hard-fix:
        // A,B date | C,D,E,F,G integer | H JPY currency.
        weeklyFormatRequests.push(
            {
                repeatCell: {
                    range: {
                        sheetId: layoutSheetId,
                        startRowIndex: weeklyRow + 2,
                        endRowIndex: lastDataRow,
                        startColumnIndex: 0,
                        endColumnIndex: 2,
                    },
                    cell: {
                        userEnteredFormat: {
                            numberFormat: {
                                type: "DATE",
                                pattern: "yyyy-mm-dd",
                            },
                        },
                    },
                    fields: "userEnteredFormat.numberFormat",
                },
            },
            {
                // C(확정청소), D(주내추가가능CO): NUMBER
                repeatCell: {
                    range: {
                        sheetId: layoutSheetId,
                        startRowIndex: weeklyRow + 2,
                        endRowIndex: lastDataRow,
                        startColumnIndex: 2,
                        endColumnIndex: 4,
                    },
                    cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "0" } } },
                    fields: "userEnteredFormat.numberFormat",
                },
            },
            {
                // E(확정피크일): DATE
                repeatCell: {
                    range: {
                        sheetId: layoutSheetId,
                        startRowIndex: weeklyRow + 2,
                        endRowIndex: lastDataRow,
                        startColumnIndex: 4,
                        endColumnIndex: 5,
                    },
                    cell: { userEnteredFormat: { numberFormat: { type: "DATE", pattern: "yyyy-mm-dd" } } },
                    fields: "userEnteredFormat.numberFormat",
                },
            },
            {
                // F(피크대응), G(주간확보풀): NUMBER
                repeatCell: {
                    range: {
                        sheetId: layoutSheetId,
                        startRowIndex: weeklyRow + 2,
                        endRowIndex: lastDataRow,
                        startColumnIndex: 5,
                        endColumnIndex: 7,
                    },
                    cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "0" } } },
                    fields: "userEnteredFormat.numberFormat",
                },
            },
            {
                repeatCell: {
                    range: {
                        sheetId: layoutSheetId,
                        startRowIndex: weeklyRow + 2,
                        endRowIndex: lastDataRow,
                        startColumnIndex: 7,
                        endColumnIndex: 8,
                    },
                    cell: {
                        userEnteredFormat: {
                            numberFormat: {
                                type: "CURRENCY",
                                pattern: "¥#,##0",
                            },
                        },
                    },
                    fields: "userEnteredFormat.numberFormat",
                },
            }
        );

        // Reset all weekly data row backgrounds to white so stale highlights are cleared.
        weeklyFormatRequests.push({
            repeatCell: {
                range: {
                    sheetId: layoutSheetId,
                    startRowIndex: weeklyRow + 2,
                    endRowIndex: lastDataRow,
                    startColumnIndex: 0,
                    endColumnIndex: 8,
                },
                cell: { userEnteredFormat: { backgroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } } } },
                fields: "userEnteredFormat.backgroundColorStyle",
            },
        });

        // Highlight the weekly row that contains today with soft yellow (#FEF3C7).
        const todayWeekRowOffset = weekRows.findIndex((row) => {
            const ws = String(row[0] || "");
            const we = String(row[1] || "");
            return ws && we && ws <= todayKey && we >= todayKey;
        });
        if (todayWeekRowOffset >= 0) {
            // weekRows data starts at 0-indexed API row weeklyRow + 2 (= A1 sheet row weeklyRow + 3).
            const highlightRowIndex = weeklyRow + 2 + todayWeekRowOffset;
            weeklyFormatRequests.push({
                repeatCell: {
                    range: {
                        sheetId: layoutSheetId,
                        startRowIndex: highlightRowIndex,
                        endRowIndex: highlightRowIndex + 1,
                        startColumnIndex: 0,
                        endColumnIndex: 8,
                    },
                    cell: { userEnteredFormat: { backgroundColorStyle: { rgbColor: { red: 0.996, green: 0.953, blue: 0.780 } } } },
                    fields: "userEnteredFormat.backgroundColorStyle",
                },
            });
        }
    }

    if (buildingRow >= 0) {
        const month0 = dayjs().tz(TOKYO_TZ).format("YYYY-MM");
        const month1 = dayjs().tz(TOKYO_TZ).add(1, "month").format("YYYY-MM");
        const month2 = dayjs().tz(TOKYO_TZ).add(2, "month").format("YYYY-MM");
        const bldStart = buildingRow + 7;
        const bldEndExclusive = bldStart + 1 + BUILDING_ORDER.length;
        const sectionEndExclusive = bldEndExclusive + 2;

        // Reset merged cells/styles in this block before writing fresh values.
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: {
                requests: [
                    {
                        unmergeCells: {
                            range: {
                                sheetId: layoutSheetId,
                                startRowIndex: buildingRow + 1,
                                endRowIndex: sectionEndExclusive,
                                startColumnIndex: 0,
                                endColumnIndex: 8,
                            },
                        },
                    },
                ],
            },
        });

        // Clear summary block first to prevent stale rows from previous layouts.
        await sheets.spreadsheets.values.clear({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_TITLE}!A${buildingRow + 2}:H${sectionEndExclusive}`,
        });

        // Monthly summary header: \uc6d4 / \ucd1d \ud655\ubcf4 \ud544\uc694 / \uc2dc\uc2a4\ud15c \uace0\uc815\uad8c\uc7a5 / \uc801\uc6a9 \uace0\uc815\uc778\uc6d0 / \uace0\uc815 \ubd80\uc871 / \ubcf4\ucda9\ud480 \ud544\uc694 / \uc804\uccb4 \uc8fc3\uc77c \ud658\uc0b0 / \ud53c\ud06c\uc77c
        updates.push({
            range: `${SHEET_TITLE}!A${buildingRow + 2}:H${buildingRow + 2}`,
            values: [[
                "\uc6d4",
                "\ucd1d \ud655\ubcf4 \ud544\uc694",
                "\ucd5c\uc18c \uace0\uc815\uc778\uc6d0",
                "\uc801\uc6a9 \uace0\uc815\uc778\uc6d0",
                "\uace0\uc815 \ubd80\uc871",
                "\ubcf4\ucda9\ud480 \ud544\uc694",
                "\uc804\uccb4 \uc8fc3\uc77c \ud658\uc0b0",
                "\ud53c\ud06c\uc77c",
            ]],
        });
        if (monthlyData && monthlyData.length) {
            const monthRows = monthlyData.filter(Boolean).map((m) => [
                m.monthKey,
                `${m.monthlyMinWorkforce}\uba85`,
                `${m.systemFixedStaff || 0}\uba85`,
                `${m.appliedFixedStaff || 0}\uba85`,
                `${m.fixedShortage || 0}\uba85`,
                `${m.supportPool}\uba85`,
                `${m.allPartTimeEquivalent || 0}\uba85`,
                m.peakDate || "-",
            ]);
            updates.push({
                range: `${SHEET_TITLE}!A${buildingRow + 3}:H${buildingRow + 2 + monthRows.length}`,
                values: monthRows,
            });
        }

        // Per-building breakdown (starts after monthly summary block: 3 months + 1 blank)
        updates.push({
            range: `${SHEET_TITLE}!A${bldStart}:H${bldStart}`,
            values: [[
                "\uac74\ubb3c",
                `${month0} 확정CO`,
                `${month1} 확정CO`,
                `${month2} 확정CO`,
                "\uc77c\ud3c9\uade0 \ucd5c\uc18c",
                "\ud53c\ud06c \ucd5c\uc18c",
                "\ud655\uc815 \uc778\uac74\ube44(3M)",
                "\uba54\ubaa8",
            ]],
        });

        const byBuilding = new Map(BUILDING_ORDER.map((k) => [k, {
            month0: 0, month1: 0, month2: 0, opMin: 0, peakMin: 0, confirmedCost: 0, days: 0,
        }]));
        model.dailyByBuilding.forEach((row) => {
            const key = row.buildingKey || Object.entries(BUILDING_DISPLAY).find(([, name]) => name === row.building)?.[0];
            if (!key || !byBuilding.has(key)) return;
            const bucket = byBuilding.get(key);
            const month = String(row.date).slice(0, 7);
            if (month === month0) bucket.month0 += row.confirmed;
            if (month === month1) bucket.month1 += row.confirmed;
            if (month === month2) bucket.month2 += row.confirmed;
            bucket.opMin += row.operationalMinHeadcount || row.minHeadcount || 0;
            bucket.peakMin = Math.max(bucket.peakMin, row.operationalMinHeadcount || row.minHeadcount || 0);
            bucket.confirmedCost += row.confirmedCostBase || 0;
            bucket.days += 1;
        });
        const bldRows = BUILDING_ORDER.map((key) => {
            const b = byBuilding.get(key);
            return [
                BUILDING_DISPLAY[key],
                b.month0,
                b.month1,
                b.month2,
                b.days ? Math.round((b.opMin / b.days) * 10) / 10 : 0,
                b.peakMin,
                yen(b.confirmedCost),
                "",
            ];
        });
        updates.push({
            range: `${SHEET_TITLE}!A${bldStart + 1}:H${bldStart + BUILDING_ORDER.length}`,
            values: bldRows,
        });

        // Prevent stale green header/background styles from leaking into data rows.
        buildingSummaryFormatRequests.push({
            repeatCell: {
                range: {
                    sheetId: layoutSheetId,
                    startRowIndex: bldStart,
                    endRowIndex: bldStart + BUILDING_ORDER.length,
                    startColumnIndex: 0,
                    endColumnIndex: 8,
                },
                cell: {
                    userEnteredFormat: {
                        backgroundColorStyle: {
                            rgbColor: { red: 1, green: 1, blue: 1 },
                        },
                        textFormat: {
                            bold: false,
                            foregroundColorStyle: {
                                rgbColor: { red: 0, green: 0, blue: 0 },
                            },
                        },
                        horizontalAlignment: "CENTER",
                        verticalAlignment: "MIDDLE",
                    },
                },
                fields: "userEnteredFormat.backgroundColorStyle,userEnteredFormat.textFormat.bold,userEnteredFormat.textFormat.foregroundColorStyle,userEnteredFormat.horizontalAlignment,userEnteredFormat.verticalAlignment",
            },
        });

        // Re-apply full grid borders for per-building table to avoid missing cell borders.
        buildingSummaryFormatRequests.push({
            updateBorders: {
                range: {
                    sheetId: layoutSheetId,
                    startRowIndex: bldStart - 1,
                    endRowIndex: bldStart + BUILDING_ORDER.length,
                    startColumnIndex: 0,
                    endColumnIndex: 8,
                },
                top: { style: "SOLID", width: 1, color: { red: 0.75, green: 0.8, blue: 0.88 } },
                bottom: { style: "SOLID", width: 1, color: { red: 0.75, green: 0.8, blue: 0.88 } },
                left: { style: "SOLID", width: 1, color: { red: 0.75, green: 0.8, blue: 0.88 } },
                right: { style: "SOLID", width: 1, color: { red: 0.75, green: 0.8, blue: 0.88 } },
                innerHorizontal: { style: "SOLID", width: 1, color: { red: 0.75, green: 0.8, blue: 0.88 } },
                innerVertical: { style: "SOLID", width: 1, color: { red: 0.75, green: 0.8, blue: 0.88 } },
            },
        });

        // Improve readability for the building/month summary block.
        buildingSummaryFormatRequests.push(
            {
                repeatCell: {
                    range: {
                        sheetId: layoutSheetId,
                        startRowIndex: buildingRow,
                        endRowIndex: buildingRow + 1,
                        startColumnIndex: 0,
                        endColumnIndex: 8,
                    },
                    cell: {
                        userEnteredFormat: {
                            backgroundColorStyle: { rgbColor: { red: 0.02, green: 0.50, blue: 0.45 } },
                            textFormat: {
                                bold: true,
                                fontSize: 11,
                                foregroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } },
                            },
                            horizontalAlignment: "LEFT",
                        },
                    },
                    fields: "userEnteredFormat.backgroundColorStyle,userEnteredFormat.textFormat,userEnteredFormat.horizontalAlignment",
                },
            },
            {
                repeatCell: {
                    range: {
                        sheetId: layoutSheetId,
                        startRowIndex: buildingRow + 1,
                        endRowIndex: buildingRow + 2,
                        startColumnIndex: 0,
                        endColumnIndex: 8,
                    },
                    cell: {
                        userEnteredFormat: {
                            backgroundColorStyle: { rgbColor: { red: 0.90, green: 0.94, blue: 0.98 } },
                            textFormat: { bold: true },
                            horizontalAlignment: "CENTER",
                            verticalAlignment: "MIDDLE",
                        },
                    },
                    fields: "userEnteredFormat.backgroundColorStyle,userEnteredFormat.textFormat.bold,userEnteredFormat.horizontalAlignment,userEnteredFormat.verticalAlignment",
                },
            },
            {
                repeatCell: {
                    range: {
                        sheetId: layoutSheetId,
                        startRowIndex: bldStart - 1,
                        endRowIndex: bldStart,
                        startColumnIndex: 0,
                        endColumnIndex: 8,
                    },
                    cell: {
                        userEnteredFormat: {
                            backgroundColorStyle: { rgbColor: { red: 0.90, green: 0.94, blue: 0.98 } },
                            textFormat: { bold: true },
                            horizontalAlignment: "CENTER",
                            verticalAlignment: "MIDDLE",
                        },
                    },
                    fields: "userEnteredFormat.backgroundColorStyle,userEnteredFormat.textFormat.bold,userEnteredFormat.horizontalAlignment,userEnteredFormat.verticalAlignment",
                },
            },
            {
                repeatCell: {
                    range: {
                        sheetId: layoutSheetId,
                        startRowIndex: bldStart,
                        endRowIndex: bldStart + BUILDING_ORDER.length,
                        startColumnIndex: 0,
                        endColumnIndex: 1,
                    },
                    cell: {
                        userEnteredFormat: {
                            textFormat: { bold: true },
                            horizontalAlignment: "LEFT",
                        },
                    },
                    fields: "userEnteredFormat.textFormat.bold,userEnteredFormat.horizontalAlignment",
                },
            },
            {
                repeatCell: {
                    range: {
                        sheetId: layoutSheetId,
                        startRowIndex: bldStart,
                        endRowIndex: bldStart + BUILDING_ORDER.length,
                        startColumnIndex: 6,
                        endColumnIndex: 7,
                    },
                    cell: {
                        userEnteredFormat: {
                            textFormat: {
                                bold: true,
                                foregroundColorStyle: { rgbColor: { red: 0.0, green: 0.45, blue: 0.2 } },
                            },
                        },
                    },
                    fields: "userEnteredFormat.textFormat",
                },
            },
            {
                updateDimensionProperties: {
                    range: {
                        sheetId: layoutSheetId,
                        dimension: "ROWS",
                        startIndex: buildingRow,
                        endIndex: bldEndExclusive,
                    },
                    properties: { pixelSize: 24 },
                    fields: "pixelSize",
                },
            }
        );

        // Compact excessive blank rows before the next section.
        // Manual input section is treated as an anchor so its rows are never consumed.
        const nextAnchors = [monthlyMinRow, apiRow, manualInputRow]
            .filter((idx) => Number.isInteger(idx) && idx >= bldEndExclusive + 1)
            .sort((a, b) => a - b);
        if (nextAnchors.length > 0) {
            const nextSectionRow = nextAnchors[0];
            const deleteStart = bldEndExclusive + 1;
            const deleteEnd = nextSectionRow;
            if (deleteEnd > deleteStart) {
                await sheets.spreadsheets.batchUpdate({
                    spreadsheetId: SPREADSHEET_ID,
                    resource: {
                        requests: [{
                            deleteDimension: {
                                range: {
                                    sheetId: layoutSheetId,
                                    dimension: "ROWS",
                                    startIndex: deleteStart,
                                    endIndex: deleteEnd,
                                },
                            },
                        }],
                    },
                });
                const deleted = deleteEnd - deleteStart;
                if (monthlyMinRow >= deleteEnd) monthlyMinRow -= deleted;
                if (apiRow >= deleteEnd) apiRow -= deleted;
                if (manualInputRow >= deleteEnd) manualInputRow -= deleted;
            }
        }
    }

    // Monthly minimum workforce section (monthlyMinRow adjusted if weekly block inserted rows)
    if (monthlyMinRow >= 0 && monthlyData && monthlyData.length) {
        updates.push({
            range: `${SHEET_TITLE}!A${monthlyMinRow + 2}:H${monthlyMinRow + 2}`,
            values: [[
                "\uc6d4",
                "\uc2dc\uc2a4\ud15c \uace0\uc815\uad8c\uc7a5",
                "\ucd1d \ud655\ubcf4 \ud544\uc694",
                "\ubcf4\ucda9\ud480 \ud544\uc694",
                "\uc804\uccb4 \uc8fc3\uc77c \ud658\uc0b0",
                "\ud53c\ud06c\uc77c",
                "\ud53c\ud06c\uc77c \uc6b4\uc601\ucd5c\uc18c",
                "\uc704\ud5d8\uc77c Top1",
                "\uc704\ud5d8\uc77c Top2",
            ]],
        });
        monthlyData.forEach((m, idx) => {
            if (!m) return;
            const top = m.shortageRiskDates || [];
            updates.push({
                range: `${SHEET_TITLE}!A${monthlyMinRow + 3 + idx}:H${monthlyMinRow + 3 + idx}`,
                values: [[
                    m.monthKey,
                    `${m.systemFixedStaff || 0}\uba85`,
                    `${m.monthlyMinWorkforce}\uba85`,
                    `${m.supportPool}\uba85`,
                    `${m.allPartTimeEquivalent || 0}\uba85`,
                    m.peakDate || "-",
                    `${m.peakOperational}\uba85`,
                    top[0] ? `${top[0].date}(\ucd5c\uc18c${top[0].operationalMin})` : "-",
                    top[1] ? `${top[1].date}(\ucd5c\uc18c${top[1].operationalMin})` : "-",
                ]],
            });
        });
    }

    if (apiRow < 0 && buildingRow >= 0) {
        if (manualInputRow >= 0) {
            const { endRow } = parseManualInputs(values, manualInputRow);
            apiRow = endRow >= 0 ? endRow + 1 : manualInputRow + 6;
        } else {
            apiRow = buildingRow + 7 + 1 + BUILDING_ORDER.length + 1;
        }
    }

    if (apiRow >= 0) {
        if (staleApiRow >= 0) {
            await sheets.spreadsheets.values.clear({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_TITLE}!A${staleApiRow + 1}:H${staleApiRow + 1}`,
            });
        }
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_TITLE}!A${apiRow + 1}:H${apiRow + 1}`,
            valueInputOption: "RAW",
            resource: { values: [[API_INPUT_LABEL, "", "", "", "", "", "", ""]] },
        });
        const attendanceAppData = await buildAttendanceAppSheetRows(dayjs().tz(TOKYO_TZ));
        const start = apiRow + 2;
        const end = start + Math.max(attendanceAppData.rows.length, 1) - 1;
        const defaultClearEnd = start + Math.max(API_CLEAR_WINDOW_ROWS, attendanceAppData.rows.length + 10);
        const safeClearEnd = manualInputRow > apiRow ? Math.min(defaultClearEnd, manualInputRow) : defaultClearEnd;
        await sheets.spreadsheets.values.clear({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_TITLE}!A${start}:H${safeClearEnd}`,
        });
        // Reset stale cell formats BEFORE writing values so DATE number formats from
        // previous layouts cannot misinterpret incoming numbers as date serials.
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: {
                requests: [{
                    repeatCell: {
                        range: {
                            sheetId: layoutSheetId,
                            startRowIndex: start - 1,
                            endRowIndex: end + 1,
                            startColumnIndex: 0,
                            endColumnIndex: 8,
                        },
                        cell: {
                            userEnteredFormat: {
                                backgroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } },
                                numberFormat: { type: "TEXT" },
                                textFormat: {
                                    fontFamily: "Arial",
                                    fontSize: 10,
                                    bold: false,
                                    foregroundColorStyle: { rgbColor: { red: 0, green: 0, blue: 0 } },
                                },
                                horizontalAlignment: "CENTER",
                                verticalAlignment: "MIDDLE",
                                wrapStrategy: "WRAP",
                            },
                        },
                        fields: "userEnteredFormat.backgroundColorStyle,userEnteredFormat.numberFormat,userEnteredFormat.textFormat.fontFamily,userEnteredFormat.textFormat.fontSize,userEnteredFormat.textFormat.bold,userEnteredFormat.textFormat.foregroundColorStyle,userEnteredFormat.horizontalAlignment,userEnteredFormat.verticalAlignment,userEnteredFormat.wrapStrategy",
                    },
                }],
            },
        });
        // Write attendance app values with RAW so strings are never re-parsed as dates.
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_TITLE}!A${start}:H${end}`,
            valueInputOption: "RAW",
            resource: {
                values: attendanceAppData.rows.length
                    ? attendanceAppData.rows
                    : [["--", "--", "--", "--", "--", "--", "--", "--"]],
            },
        });
        // Section-aware format helpers \u2014 applied after TEXT reset.
        const makeNumFmt = (rowIdx, colStart, colEnd, pattern) => ({
            repeatCell: {
                range: { sheetId: layoutSheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: colStart, endColumnIndex: colEnd },
                cell: { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern } } },
                fields: "userEnteredFormat.numberFormat",
            },
        });
        const makeCurrFmt = (rowIdx, colStart, colEnd) => ({
            repeatCell: {
                range: { sheetId: layoutSheetId, startRowIndex: rowIdx, endRowIndex: rowIdx + 1, startColumnIndex: colStart, endColumnIndex: colEnd },
                cell: { userEnteredFormat: { numberFormat: { type: "CURRENCY", pattern: "\u00a5#,##0" } } },
                fields: "userEnteredFormat.numberFormat",
            },
        });
        // Section title \u2192 section key mapping (Unicode escapes = Korean at runtime).
        const ATTENDANCE_SECTION_TITLES = {
            "\uc6d4\ubcc4 \uc2dc\uae09\uc81c \uc54c\ubc14 \uc778\uac74\ube44": "monthly",
            "\uc9c1\uc6d0\ubcc4 \uadfc\ubb34 \uc694\uc57d": "employeeSummary",
            "\uac74\ubb3c/\uadfc\ubb34\uc9c0\ubcc4 \uadfc\ubb34 \uc694\uc57d": "workplace",
            "\uc9c1\uc6d0 \ubaa9\ub85d": "employeeList",
            "\ucd5c\uadfc 3\uac1c\uc6d4 \uadfc\ud0dc": "attendance",
            "\ucd5c\uadfc 3\uac1c\uc6d4 \uae09\uc5ec \uc694\uc57d": "payroll",
        };
        const titleRows = [];
        const headerRows = [];
        let attendanceSection = null;
        let sectionDataMode = false;
        attendanceAppData.rows.forEach((row, idx) => {
            const first = String(row?.[0] || "");
            const second = String(row?.[1] || "");
            const rowIndex = start - 1 + idx;

            if (ATTENDANCE_SECTION_TITLES[first]) {
                attendanceSection = ATTENDANCE_SECTION_TITLES[first];
                sectionDataMode = false;
            }
            const isHdr = ["\uc6d4", "ID", "\uadfc\ubb34\uc9c0", "\uadfc\ubb34\uc77c"].includes(first)
                || (first === "\uae30\uc900" && second === "STAY ARI staging");
            if (first && row.slice(1).every((cell) => String(cell || "") === "")) titleRows.push(rowIndex);
            if (isHdr) headerRows.push(rowIndex);

            // Apply section-specific number/currency formats for data rows.
            if (sectionDataMode && attendanceSection && first) {
                const n0 = (c) => attendanceAppFormatRequests.push(makeNumFmt(rowIndex, c, c + 1, "0"));
                const n1 = (c) => attendanceAppFormatRequests.push(makeNumFmt(rowIndex, c, c + 1, "0.0"));
                const cy = (c) => attendanceAppFormatRequests.push(makeCurrFmt(rowIndex, c, c + 1));
                if (attendanceSection === "monthly") {
                    // B\uc778\uc6d0 C\uadfc\ubb34\uc77c D\uadfc\ud0dc\uac74\uc218 E\uadfc\ubb34\ubd84: NUMBER 0; F\uadfc\ubb34\uc2dc\uac04: NUMBER 0.0; G\uc571\uc778\uac74\ube44 H\ucd94\uc815: CURRENCY
                    n0(1); n0(2); n0(3); n0(4); n1(5); cy(6); cy(7);
                } else if (attendanceSection === "employeeSummary") {
                    // F\uadfc\ud0dc\uac74\uc218: NUMBER 0; G\uadfc\ubb34\uc2dc\uac04: NUMBER 0.0; H: CURRENCY only when numeric
                    n0(5); n1(6);
                    if (typeof row[7] === "number") cy(7);
                } else if (attendanceSection === "workplace") {
                    // B\uadfc\ud0dc\uac74\uc218 C\uc778\uc6d0 D\uadfc\ubb34\ubd84: NUMBER 0; E\uadfc\ubb34\uc2dc\uac04: NUMBER 0.0; F\ucd94\uc815: CURRENCY
                    n0(1); n0(2); n0(3); n1(4); cy(5);
                } else if (attendanceSection === "attendance") {
                    // E\uadfc\ubb34\ubd84: NUMBER 0; F\uadfc\ubb34\uc2dc\uac04: NUMBER 0.0; H\ucd94\uc815: CURRENCY (G wage stays TEXT)
                    n0(4); n1(5); cy(7);
                } else if (attendanceSection === "payroll") {
                    // E\uadfc\ubb34\ubd84: NUMBER 0; F\uc571\uc778\uac74\ube44 G\ucd94\uc815: CURRENCY
                    n0(4); cy(5); cy(6);
                }
            }
            if (isHdr) sectionDataMode = true;
            if (!first) sectionDataMode = false;
        });
        titleRows.forEach((rowIndex) => {
            attendanceAppFormatRequests.push({
                repeatCell: {
                    range: {
                        sheetId: layoutSheetId,
                        startRowIndex: rowIndex,
                        endRowIndex: rowIndex + 1,
                        startColumnIndex: 0,
                        endColumnIndex: 8,
                    },
                    cell: {
                        userEnteredFormat: {
                            backgroundColorStyle: { rgbColor: { red: 0.05, green: 0.55, blue: 0.49 } },
                            textFormat: {
                                bold: true,
                                foregroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } },
                            },
                            horizontalAlignment: "LEFT",
                        },
                    },
                    fields: "userEnteredFormat.backgroundColorStyle,userEnteredFormat.textFormat,userEnteredFormat.horizontalAlignment",
                },
            });
        });
        headerRows.forEach((rowIndex) => {
            attendanceAppFormatRequests.push({
                repeatCell: {
                    range: {
                        sheetId: layoutSheetId,
                        startRowIndex: rowIndex,
                        endRowIndex: rowIndex + 1,
                        startColumnIndex: 0,
                        endColumnIndex: 8,
                    },
                    cell: {
                        userEnteredFormat: {
                            backgroundColorStyle: { rgbColor: { red: 0.90, green: 0.94, blue: 0.98 } },
                            textFormat: { bold: true },
                            horizontalAlignment: "CENTER",
                        },
                    },
                    fields: "userEnteredFormat.backgroundColorStyle,userEnteredFormat.textFormat.bold,userEnteredFormat.horizontalAlignment",
                },
            });
        });
        attendanceAppFormatRequests.push({
            updateBorders: {
                range: {
                    sheetId: layoutSheetId,
                    startRowIndex: start - 1,
                    endRowIndex: end,
                    startColumnIndex: 0,
                    endColumnIndex: 8,
                },
                top: { style: "SOLID", width: 1, color: { red: 0.75, green: 0.8, blue: 0.88 } },
                bottom: { style: "SOLID", width: 1, color: { red: 0.75, green: 0.8, blue: 0.88 } },
                left: { style: "SOLID", width: 1, color: { red: 0.75, green: 0.8, blue: 0.88 } },
                right: { style: "SOLID", width: 1, color: { red: 0.75, green: 0.8, blue: 0.88 } },
                innerHorizontal: { style: "SOLID", width: 1, color: { red: 0.75, green: 0.8, blue: 0.88 } },
                innerVertical: { style: "SOLID", width: 1, color: { red: 0.75, green: 0.8, blue: 0.88 } },
            },
        });
        console.log(`[forecast] attendance app section prepared: ${JSON.stringify(attendanceAppData.meta)}`);
    }

    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
            valueInputOption: "USER_ENTERED",
            data: updates,
        },
    });

    if (calendarLayoutRequests.length) {
        const requests = calendarLayoutRequests.map((request) => {
            if (request.repeatCell?.range) request.repeatCell.range.sheetId = layoutSheetId;
            if (request.updateDimensionProperties?.range) request.updateDimensionProperties.range.sheetId = layoutSheetId;
            return request;
        });

        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: { requests },
        });
    }

    if (calendarRichTextRequests.length) {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: { requests: calendarRichTextRequests },
        });
    }

    if (weeklyFormatRequests.length) {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: { requests: weeklyFormatRequests },
        });
    }

    if (buildingSummaryFormatRequests.length) {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: { requests: buildingSummaryFormatRequests },
        });
    }

    if (attendanceAppFormatRequests.length) {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: { requests: attendanceAppFormatRequests },
        });
    }

    // Ensure forecast months have a row in the manual input section.
    // Existing manual values are preserved; only missing month rows are added.
    if (Array.isArray(opts.monthsToEnsure) && opts.monthsToEnsure.length) {
        await ensureManualInputSection(sheets, opts.monthsToEnsure, opts.manualInputs || new Map());
    }

    const refreshedValuesRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_TITLE}!A1:H220`,
    });
    const globalFormatRequests = buildGlobalSheetFormatRequests(layoutSheetId, refreshedValuesRes.data.values || []);
    if (globalFormatRequests.length) {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: { requests: globalFormatRequests },
        });
    }
}

async function runCleaningWorkforceForecastUpdate() {
    const now = dayjs().tz(TOKYO_TZ);
    const todayKey = now.format("YYYY-MM-DD");
    const forecastStart = now.subtract(1, "month").startOf("month").format("YYYY-MM-DD");
    const forecastEnd = now.add(2, "month").endOf("month").format("YYYY-MM-DD");
    const historyStart = now.subtract(1, "year").format("YYYY-MM-DD");

    const db = initFirestore();
    const sheets = await getSheetsClient();
    const resolver = createBuildingResolver(DEFAULT_BUILDING_RULES);
    const inventoryConfig = resolveInventoryByBuilding();

    console.log(`[forecast] companyId=${DEFAULT_COMPANY_ID}`);
    console.log(`[forecast] inventory source=${inventoryConfig.source}`);
    if (inventoryConfig.warnings.length) {
        inventoryConfig.warnings.forEach((warning) => console.warn(`[forecast] ${warning}`));
    }
    console.log(`[forecast] inventory map=${JSON.stringify(inventoryConfig.inventoryByBuilding)}`);
    const reservations = await fetchReservations(db, DEFAULT_COMPANY_ID);
    console.log(`[forecast] reservations loaded: ${reservations.length}`);
    const roomMap = buildRoomReservationMap(reservations, resolver);

    const history = buildHistoryStructures(reservations, resolver, historyStart, todayKey);
    const forecastDates = dateRange(forecastStart, forecastEnd);
    const model = aggregateDailyForecast({
        reservations,
        forecastDates,
        resolver,
        todayKey,
        history,
        inventoryByBuilding: inventoryConfig.inventoryByBuilding,
    });

    const months = [
        now.subtract(1, "month").format("YYYY-MM"),
        now.format("YYYY-MM"),
        now.add(1, "month").format("YYYY-MM"),
        now.add(2, "month").format("YYYY-MM"),
    ];

    // Pre-read sheet so we can capture manual operational inputs before any writes.
    const preReadRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_TITLE}!A1:H400`,
    });
    const preReadValues = preReadRes.data.values || [];
    const preManualRow = findRowByLabel(preReadValues, MANUAL_INPUT_LABEL);
    const { byMonth: manualInputs } = parseManualInputs(preReadValues, preManualRow);
    if (manualInputs.size) {
        manualInputs.forEach((v, k) => {
            console.log(`[forecast] manual input ${k} fixed=${v.confirmed_fixed_staff ?? "-"} avgDays=${v.avg_part_time_days_per_week ?? "-"}`);
        });
    } else {
        console.log("[forecast] manual input section: none / empty (will use system defaults)");
    }

    const monthlyData = computeMonthlyMinimumWorkforce(model.daily, months, manualInputs);
    monthlyData.forEach((m) => {
        if (!m) return;
        console.log(`[forecast] ${m.monthKey} peak=${m.peakOperational}명/일 | 시스템고정=${m.systemFixedStaff}명 | 적용고정=${m.appliedFixedStaff}명 | 보충풀=${m.supportPool}명 | 총확보=${m.monthlyMinWorkforce}명 | 주근무=${m.avgPartTimeDaysPerWeek}일 (peak: ${m.peakDate})`);
    });

    await updateSheetWithForecast(sheets, model, monthlyData, { monthsToEnsure: months, manualInputs, roomMap });
    console.log(`[forecast] updated ${SHEET_TITLE} (${forecastStart} ~ ${forecastEnd})`);
}

if (require.main === module) {
    runCleaningWorkforceForecastUpdate().catch((err) => {
        console.error("[forecast] failed:", err.message || err);
        process.exit(1);
    });
}

module.exports = {
    runCleaningWorkforceForecastUpdate,
};
