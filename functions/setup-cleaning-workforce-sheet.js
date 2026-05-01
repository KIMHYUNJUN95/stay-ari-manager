/**
 * setup-cleaning-workforce-sheet.js
 *
 * Single-tab calendar-first layout for workforce forecast.
 * This script rewrites "청소인력예측" with a readability-focused structure.
 */

const { google } = require("googleapis");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const serviceAccount = require("./serviceAccountKey.json");

dayjs.extend(utc);
dayjs.extend(timezone);

const DEFAULT_SPREADSHEET_ID = "1A9HyeH6j4TN2c7ITfzI5s1qQgQhyrqW4e-qLCrlafv0";
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;
const SHEET_TITLE = "\uccad\uc18c\uc778\ub825\uc608\uce21"; // 청소인력예측
const TOKYO_TZ = "Asia/Tokyo";

const COLORS = {
    titleBg: { red: 0.071, green: 0.102, blue: 0.173 },
    titleText: { red: 1, green: 1, blue: 1 },
    subBg: { red: 0.953, green: 0.965, blue: 0.984 },
    cardBg: { red: 0.976, green: 0.984, blue: 0.996 },
    sectionBg: { red: 0.067, green: 0.545, blue: 0.510 },
    sectionText: { red: 1, green: 1, blue: 1 },
    weekdayBg: { red: 0.129, green: 0.227, blue: 0.361 },
    calendarBg: { red: 0.988, green: 0.992, blue: 1.0 },
    sundayBg: { red: 1.0, green: 0.945, blue: 0.945 },
    saturdayBg: { red: 0.941, green: 0.969, blue: 1.0 },
    outOfMonthBg: { red: 0.945, green: 0.949, blue: 0.957 },
    todayBg: { red: 1.0, green: 0.984, blue: 0.831 },
    headerRowBg: { red: 0.922, green: 0.945, blue: 0.980 },
    gridBorder: { red: 0.824, green: 0.859, blue: 0.910 },
    text: { red: 0.094, green: 0.129, blue: 0.188 },
    mutedText: { red: 0.392, green: 0.455, blue: 0.545 },
    white: { red: 1, green: 1, blue: 1 },
};

const BUILDINGS = [
    ["\uc544\ub77c\ud0a4\ucd08A", "\uac1d\uc2e4\ud615", "3.75h", "1\uba85", "1\uba85"],
    ["\uc544\ub77c\ud0a4\ucd08B", "\uac1d\uc2e4\ud615", "4.5h", "1\uba85", "1\uba85"],
    ["\uac00\ubd80\ud0a4\ucd08", "\uac1d\uc2e4\ud615", "3h", "1\uba85", "1\uba85"],
    ["\ub2e4\uce74\ub2e4\ub178\ubc14\ubc14", "\uac1d\uc2e4\ud615", "4.2h", "1\uba85", "1\uba85"],
    ["\uc624\ucfe0\ubcf4A\ub3d9", "\ub3c5\ucc44\ud615", "2\uba85 3.5h", "2\uba85", "2\uba85"],
    ["\uc624\ucfe0\ubcf4B\ub3d9", "\ub3c5\ucc44\ud615", "2\uba85 3.5h", "2\uba85", "2\uba85"],
    ["\uc624\ucfe0\ubcf4C\ub3d9", "\ub3c5\ucc44\ud615", "2\uba85 3.5h", "2\uba85", "2\uba85"],
];

const DAY_NAMES = [
    "\uc77c",
    "\uc6d4",
    "\ud654",
    "\uc218",
    "\ubaa9",
    "\uae08",
    "\ud1a0",
];

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

async function ensureSheet(sheets) {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const found = meta.data.sheets.find((s) => s.properties.title === SHEET_TITLE);
    if (found) return found.properties.sheetId;

    const created = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
            requests: [{
                addSheet: {
                    properties: { title: SHEET_TITLE },
                },
            }],
        },
    });

    return created.data.replies[0].addSheet.properties.sheetId;
}

function yen(value) {
    return `\u00a5${Number(value || 0).toLocaleString("ja-JP")}`;
}

function buildCalendarMonth(monthStart, todayKey) {
    const start = monthStart.startOf("month");
    const gridStart = start.startOf("week");
    const weeks = [];

    for (let week = 0; week < 6; week += 1) {
        const row = [];
        for (let dow = 0; dow < 7; dow += 1) {
            const date = gridStart.add(week * 7 + dow, "day");
            const dateKey = date.format("YYYY-MM-DD");
            const inMonth = date.isSame(start, "month");
            const isToday = dateKey === todayKey;

            const lines = inMonth ? [
                `${date.format("M/D")} ${date.format("ddd")}${isToday ? "  TODAY" : ""}`,
                "\uccad\uc18c -- / \uc14b\ud305 --",
                "\ucd5c\uc18c -- | \uad8c\uc7a5 --",
                `${yen(0)}`,
            ] : [""];

            row.push({
                inMonth,
                isToday,
                dow,
                text: lines.join("\n"),
            });
        }
        weeks.push(row);
    }

    return {
        label: `${monthStart.format("YYYY\ub144 M\uc6d4")}`,
        weeks,
    };
}

function buildSheetModel() {
    const now = dayjs().tz(TOKYO_TZ);
    const todayKey = now.format("YYYY-MM-DD");
    const months = [0, 1, 2].map((offset) => buildCalendarMonth(now.add(offset, "month"), todayKey));
    const values = [];
    const monthMeta = [];

    values.push(["\uccad\uc18c \uc778\ub825 \uc608\uce21 \uc2dc\uc2a4\ud15c"]);
    values.push(["\uccb4\ud06c\uc544\uc6c3 \uae30\uc900 | \ubbf8\ub798 3\uac1c\uc6d4 | \ud655\uc815 \uc608\uc57d+\uc608\uc0c1 \uc720\uc785 | \uc21c\uc218 \uc778\uac74\ube44\ub9cc \uacc4\uc0b0 | \ub2e4\uc774\ucfc4\ucd08/\uc0ac\ub178 \uc81c\uc678"]);
    values.push(["\uc548\ub0b4", "\uac01 \ub0a0\uc9dc \uce78\uc5d0 \uccad\uc18c, \uc14b\ud305, \ucd5c\uc18c/\uad8c\uc7a5 \uc778\uc6d0, \uc608\uc0c1 \uc778\uac74\ube44 \ud45c\uc2dc", "", "", "", "", "", ""]);
    values.push([]);

    months.forEach((month) => {
        const startRow = values.length;
        const kpiRow1 = startRow;
        const kpiRow2 = startRow + 1;
        values.push(["", "", "", "", "", "", "", ""]); // KPI row 1 placeholder
        values.push(["", "", "", "", "", "", "", ""]); // KPI row 2 placeholder
        values.push([`\uc6d4\uac04 \uce98\ub9b0\ub354 | ${month.label}`]);
        values.push(DAY_NAMES);
        month.weeks.forEach((week) => {
            values.push(week.map((d) => d.text));
        });
        values.push([]);

        monthMeta.push({
            startRow,
            kpiRow1,
            kpiRow2,
            titleRow: startRow + 2,
            weekdayRow: startRow + 3,
            firstWeekRow: startRow + 4,
            weeks: month.weeks,
        });
    });

    values.push(["\uc8fc\uac04 \uc694\uc57d"]);
    values.push(["\uc8fc \uc2dc\uc791\uc77c", "\uc8fc \uc885\ub8cc\uc77c", "\ucd1d \uccad\uc18c", "\ucd1d \uc14b\ud305", "\ud53c\ud06c \ucd5c\uc18c\uc778\uc6d0", "\ud53c\ud06c \uad8c\uc7a5\uc778\uc6d0", "\uc608\uc0c1 \uc21c\uc218 \uc778\uac74\ube44", "\uba54\ubaa8"]);
    values.push(["--", "--", "--", "--", "--", "--", yen(0), "API \uc5f0\uacc4 \ud6c4 \uc790\ub3d9 \uc785\ub825"]);
    values.push(["--", "--", "--", "--", "--", "--", yen(0), "Slack \uccad\uc18c/\uc14b\ud305 \uae30\uc900"]);
    values.push([]);

    values.push(["\uac74\ubb3c\ubcc4 3\uac1c\uc6d4 \uc694\uc57d"]);
    values.push(["\uac74\ubb3c", "\uc774\ub2ec CO", "\ub2e4\uc74c\ub2ec CO", "3\uac1c\uc6d4 \ud569\uacc4 CO", "\ucd5c\uc18c\uc778\uc6d0 \ud3c9\uade0", "\uad8c\uc7a5\uc778\uc6d0 \ud3c9\uade0", "\uc608\uc0c1 \uc21c\uc218 \uc778\uac74\ube44", "\uba54\ubaa8"]);
    BUILDINGS.forEach(([name]) => {
        values.push([name, "--", "--", "--", "--", "--", yen(0), ""]);
    });
    values.push([]);

    values.push(["\uc124\uc815 | \uac74\ubb3c\ubcc4 \uccad\uc18c \uae30\uc900"]);
    values.push(["\uac74\ubb3c", "\ud0c0\uc785", "\uccad\uc18c \uc2dc\uac04", "\ucd5c\uc18c \uc778\uc6d0", "\uad8c\uc7a5 \uc778\uc6d0", "\ube44\uace0", "", ""]);
    BUILDINGS.forEach(([name, type, hours, min, rec]) => {
        values.push([name, type, hours, min, rec, "\ub2e4\uc774\ucfc4\ucd08/\uc0ac\ub178 \uc81c\uc678", "", ""]);
    });
    values.push([]);

    // Manual operational input section. Daily sync MUST NOT clear or overwrite these cells.
    values.push(["\uc6b4\uc601 \uc785\ub825\uac12"]);
    values.push([
        "\uc6d4",
        "\ud655\uc815 \uace0\uc815\uc778\uc6d0",
        "\ud3c9\uade0 \uc8fc\uadfc\ubb34\uc77c\uc218",
        "\uba54\ubaa8",
        "", "", "", "",
    ]);
    [0, 1, 2].forEach((offset) => {
        const monthKey = now.add(offset, "month").format("YYYY-MM");
        values.push([monthKey, "", "", "", "", "", "", ""]);
    });
    values.push([]);

    values.push(["API \uc785\ub825 \uc608\uc815 \ub370\uc774\ud130"]);
    values.push(["date", "building", "confirmed_cleaning", "projected_cleaning", "setting", "min_headcount", "estimated_labor_cost", "confidence"]);
    values.push(["--", "--", "--", "--", "--", "--", "--", "\ud655\uc815+\uc608\uc0c1 \ubd84\ub9ac \ud45c\uc2dc"]);

    return { values, monthMeta };
}

function gridRange(sheetId, startRowIndex, endRowIndex, startColumnIndex, endColumnIndex) {
    return { sheetId, startRowIndex, endRowIndex, startColumnIndex, endColumnIndex };
}

function repeatCell(range, userEnteredFormat, fields) {
    return {
        repeatCell: {
            range,
            cell: { userEnteredFormat },
            fields,
        },
    };
}

function addMerge(requests, sheetId, row, colStart, colEnd) {
    requests.push({
        mergeCells: {
            range: gridRange(sheetId, row, row + 1, colStart, colEnd),
            mergeType: "MERGE_ALL",
        },
    });
}

async function applyLayout(sheets, sheetId) {
    const { values, monthMeta } = buildSheetModel();
    const rowCount = Math.max(values.length + 20, 260);
    const requests = [];

    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
            requests: [{
                unmergeCells: {
                    range: gridRange(sheetId, 0, 500, 0, 26),
                },
            }],
        },
    });

    await sheets.spreadsheets.values.clear({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_TITLE}!A1:Z500`,
    });

    await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_TITLE}!A1`,
        valueInputOption: "RAW",
        resource: { values },
    });

    requests.push({
        updateSheetProperties: {
            properties: {
                sheetId,
                gridProperties: {
                    rowCount,
                    columnCount: 26,
                    frozenRowCount: 2,
                    frozenColumnCount: 0,
                    hideGridlines: true,
                },
            },
            fields: "gridProperties(rowCount,columnCount,frozenRowCount,frozenColumnCount,hideGridlines)",
        },
    });

    requests.push(repeatCell(
        gridRange(sheetId, 0, rowCount, 0, 26),
        {
            backgroundColor: COLORS.white,
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
            wrapStrategy: "WRAP",
            textFormat: { fontFamily: "Arial", fontSize: 10, foregroundColor: COLORS.text },
            borders: {
                top: { style: "NONE" },
                bottom: { style: "NONE" },
                left: { style: "NONE" },
                right: { style: "NONE" },
            },
        },
        "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,textFormat,borders)"
    ));

    requests.push({
        updateDimensionProperties: {
            range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 7 },
            properties: { pixelSize: 185 },
            fields: "pixelSize",
        },
    });
    requests.push({
        updateDimensionProperties: {
            range: { sheetId, dimension: "COLUMNS", startIndex: 7, endIndex: 8 },
            properties: { pixelSize: 250 },
            fields: "pixelSize",
        },
    });
    requests.push({
        updateDimensionProperties: {
            range: { sheetId, dimension: "COLUMNS", startIndex: 8, endIndex: 26 },
            properties: { hiddenByUser: true },
            fields: "hiddenByUser",
        },
    });

    addMerge(requests, sheetId, 0, 0, 8);
    addMerge(requests, sheetId, 1, 0, 8);
    addMerge(requests, sheetId, 2, 0, 8);

    requests.push(repeatCell(
        gridRange(sheetId, 0, 2, 0, 8),
        {
            backgroundColor: COLORS.titleBg,
            horizontalAlignment: "LEFT",
            verticalAlignment: "MIDDLE",
            textFormat: { bold: true, foregroundColor: COLORS.titleText, fontSize: 15 },
        },
        "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)"
    ));

    requests.push(repeatCell(
        gridRange(sheetId, 2, 3, 0, 8),
        {
            backgroundColor: COLORS.subBg,
            horizontalAlignment: "LEFT",
            textFormat: { bold: false, foregroundColor: COLORS.mutedText, fontSize: 10 },
        },
        "userEnteredFormat(backgroundColor,horizontalAlignment,textFormat)"
    ));

    monthMeta.forEach((meta) => {
        // KPI rows: cardBg with borders, no merge (each of A:H holds a value)
        requests.push(repeatCell(
            gridRange(sheetId, meta.kpiRow1, meta.kpiRow2 + 1, 0, 8),
            {
                backgroundColor: COLORS.cardBg,
                horizontalAlignment: "CENTER",
                verticalAlignment: "MIDDLE",
                textFormat: { bold: true, foregroundColor: COLORS.text, fontSize: 10 },
                borders: {
                    top: { style: "SOLID", color: COLORS.gridBorder },
                    bottom: { style: "SOLID", color: COLORS.gridBorder },
                    left: { style: "SOLID", color: COLORS.gridBorder },
                    right: { style: "SOLID", color: COLORS.gridBorder },
                },
            },
            "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat,borders)"
        ));
        requests.push({
            updateDimensionProperties: {
                range: { sheetId, dimension: "ROWS", startIndex: meta.kpiRow1, endIndex: meta.kpiRow2 + 1 },
                properties: { pixelSize: 28 },
                fields: "pixelSize",
            },
        });

        addMerge(requests, sheetId, meta.titleRow, 0, 8);

        requests.push(repeatCell(
            gridRange(sheetId, meta.titleRow, meta.titleRow + 1, 0, 8),
            {
                backgroundColor: COLORS.sectionBg,
                horizontalAlignment: "LEFT",
                textFormat: { bold: true, foregroundColor: COLORS.sectionText, fontSize: 12 },
                borders: {
                    top: { style: "SOLID", color: COLORS.gridBorder },
                    bottom: { style: "SOLID", color: COLORS.gridBorder },
                    left: { style: "SOLID", color: COLORS.gridBorder },
                    right: { style: "SOLID", color: COLORS.gridBorder },
                },
            },
            "userEnteredFormat(backgroundColor,horizontalAlignment,textFormat,borders)"
        ));

        requests.push(repeatCell(
            gridRange(sheetId, meta.weekdayRow, meta.weekdayRow + 1, 0, 7),
            {
                backgroundColor: { red: 0.05, green: 0.12, blue: 0.22 },
                horizontalAlignment: "CENTER",
                verticalAlignment: "MIDDLE",
                textFormat: { bold: true, foregroundColor: COLORS.white, fontSize: 11 },
                borders: {
                    top: { style: "SOLID", color: COLORS.gridBorder },
                    bottom: { style: "SOLID", color: COLORS.gridBorder },
                    left: { style: "SOLID", color: COLORS.gridBorder },
                    right: { style: "SOLID", color: COLORS.gridBorder },
                },
            },
            "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat,borders)"
        ));

        for (let week = 0; week < 6; week += 1) {
            for (let dow = 0; dow < 7; dow += 1) {
                const cell = meta.weeks[week][dow];
                const row = meta.firstWeekRow + week;
                let bg = COLORS.calendarBg;

                if (!cell.inMonth) bg = COLORS.outOfMonthBg;
                else if (cell.isToday) bg = COLORS.todayBg;
                else if (dow === 0) bg = COLORS.sundayBg;
                else if (dow === 6) bg = COLORS.saturdayBg;

                requests.push(repeatCell(
                    gridRange(sheetId, row, row + 1, dow, dow + 1),
                    {
                        backgroundColor: bg,
                        horizontalAlignment: "LEFT",
                        verticalAlignment: "TOP",
                        textFormat: { fontSize: 10, foregroundColor: COLORS.text },
                        padding: { top: 6, right: 6, bottom: 6, left: 6 },
                        borders: {
                            top: { style: "SOLID", color: COLORS.gridBorder },
                            bottom: { style: "SOLID", color: COLORS.gridBorder },
                            left: { style: "SOLID", color: COLORS.gridBorder },
                            right: { style: "SOLID", color: COLORS.gridBorder },
                        },
                    },
                    "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat,padding,borders)"
                ));
            }
        }

        requests.push({
            updateDimensionProperties: {
                range: { sheetId, dimension: "ROWS", startIndex: meta.titleRow, endIndex: meta.titleRow + 1 },
                properties: { pixelSize: 32 },
                fields: "pixelSize",
            },
        });
        requests.push({
            updateDimensionProperties: {
                range: { sheetId, dimension: "ROWS", startIndex: meta.weekdayRow, endIndex: meta.weekdayRow + 1 },
                properties: { pixelSize: 24 },
                fields: "pixelSize",
            },
        });
        requests.push({
            updateDimensionProperties: {
                range: { sheetId, dimension: "ROWS", startIndex: meta.firstWeekRow, endIndex: meta.firstWeekRow + 6 },
                properties: { pixelSize: 82 },
                fields: "pixelSize",
            },
        });
    });

    // Format lower summary/config tables.
    let manualInputTitleRow = -1;
    values.forEach((row, idx) => {
        const title = String(row[0] || "");
        const isSectionTitle = [
            "\uc8fc\uac04 \uc694\uc57d",
            "\uac74\ubb3c\ubcc4 3\uac1c\uc6d4 \uc694\uc57d",
            "\uc124\uc815 | \uac74\ubb3c\ubcc4 \uccad\uc18c \uae30\uc900",
            "\uc6b4\uc601 \uc785\ub825\uac12",
            "API \uc785\ub825 \uc608\uc815 \ub370\uc774\ud130",
        ].includes(title);

        if (title === "\uc6b4\uc601 \uc785\ub825\uac12") manualInputTitleRow = idx;

        if (isSectionTitle) {
            addMerge(requests, sheetId, idx, 0, 8);
            requests.push(repeatCell(
                gridRange(sheetId, idx, idx + 1, 0, 8),
                {
                    backgroundColor: COLORS.sectionBg,
                    horizontalAlignment: "LEFT",
                    textFormat: { bold: true, foregroundColor: COLORS.sectionText, fontSize: 11 },
                    borders: {
                        top: { style: "SOLID", color: COLORS.gridBorder },
                        bottom: { style: "SOLID", color: COLORS.gridBorder },
                        left: { style: "SOLID", color: COLORS.gridBorder },
                        right: { style: "SOLID", color: COLORS.gridBorder },
                    },
                },
                "userEnteredFormat(backgroundColor,horizontalAlignment,textFormat,borders)"
            ));
        }
    });

    for (let r = 0; r < values.length; r += 1) {
        const first = String(values[r][0] || "");
        const isTableHeader = [
            "\uc8fc \uc2dc\uc791\uc77c",
            "\uac74\ubb3c",
            "date",
            "\uc6d4",
        ].includes(first);

        if (isTableHeader) {
            requests.push(repeatCell(
                gridRange(sheetId, r, r + 1, 0, 8),
                {
                    backgroundColor: COLORS.headerRowBg,
                    textFormat: { bold: true, foregroundColor: COLORS.text, fontSize: 10 },
                    borders: {
                        top: { style: "SOLID", color: COLORS.gridBorder },
                        bottom: { style: "SOLID", color: COLORS.gridBorder },
                        left: { style: "SOLID", color: COLORS.gridBorder },
                        right: { style: "SOLID", color: COLORS.gridBorder },
                    },
                },
                "userEnteredFormat(backgroundColor,textFormat,borders)"
            ));
        }
    }

    // Yellow highlight for manual input data rows (3 month rows).
    if (manualInputTitleRow >= 0) {
        const dataStart = manualInputTitleRow + 2;
        const dataEnd = manualInputTitleRow + 5; // exclusive (3 month rows)
        requests.push(repeatCell(
            gridRange(sheetId, dataStart, dataEnd, 0, 4),
            {
                backgroundColor: { red: 1.0, green: 0.965, blue: 0.78 },
                horizontalAlignment: "CENTER",
                verticalAlignment: "MIDDLE",
                textFormat: { fontFamily: "Arial", fontSize: 10, foregroundColor: COLORS.text },
                borders: {
                    top: { style: "SOLID", color: { red: 0.85, green: 0.71, blue: 0.32 } },
                    bottom: { style: "SOLID", color: { red: 0.85, green: 0.71, blue: 0.32 } },
                    left: { style: "SOLID", color: { red: 0.85, green: 0.71, blue: 0.32 } },
                    right: { style: "SOLID", color: { red: 0.85, green: 0.71, blue: 0.32 } },
                },
            },
            "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat,borders)"
        ));
    }

    requests.push(repeatCell(
        gridRange(sheetId, 0, values.length, 0, 8),
        {
            borders: {
                top: { style: "SOLID", color: COLORS.gridBorder },
                bottom: { style: "SOLID", color: COLORS.gridBorder },
                left: { style: "SOLID", color: COLORS.gridBorder },
                right: { style: "SOLID", color: COLORS.gridBorder },
            },
        },
        "userEnteredFormat.borders"
    ));

    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: { requests },
    });
}

async function main() {
    console.log(`[setup] Spreadsheet: ${SPREADSHEET_ID}`);
    const sheets = await getSheetsClient();
    const sheetId = await ensureSheet(sheets);
    await applyLayout(sheets, sheetId);
    console.log(`[setup] Done: ${SHEET_TITLE} (sheetId=${sheetId})`);
}

main().catch((err) => {
    console.error("[setup] Failed:", err.message || err);
    process.exit(1);
});
