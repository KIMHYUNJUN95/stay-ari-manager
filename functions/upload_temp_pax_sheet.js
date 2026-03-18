const fs = require("fs");
const dayjs = require("dayjs");
const { google } = require("googleapis");
const serviceAccount = require("./serviceAccountKey.json");

const SPREADSHEET_ID = "1A9HyeH6j4TN2c7ITfzI5s1qQgQhyrqW4e-qLCrlafv0";
const INPUT_PATH = "c:/-stay-ari-manager-main/reports/company_submission_pax_report_2025-12_to_2026-02.txt";

function parseCellLine(line) {
  return line
    .split("│")
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseReport(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] || "";
    if (!line.includes("객실별 인원 예약 분석 보고서")) {
      i++;
      continue;
    }

    const buildingTitle = line.trim();
    const periodLine = (lines[i + 1] || "").trim();
    const block = {
      buildingTitle,
      periodLine,
      headers: [],
      rows: [],
      bullets: [],
    };

    // 표 헤더 탐색
    let j = i;
    while (j < lines.length && !lines[j].includes("│ 방")) j++;
    if (j < lines.length) {
      block.headers = parseCellLine(lines[j]);
      j++;
      while (j < lines.length) {
        const rowLine = lines[j] || "";
        if (!rowLine.trim().startsWith("│")) break;
        const cells = parseCellLine(rowLine);
        if (cells.length > 0) block.rows.push(cells);
        j++;
      }
    }

    // 전체 통계 bullet 탐색
    while (j < lines.length && !(lines[j] || "").includes("▶ 전체 통계")) j++;
    if (j < lines.length) {
      j++;
      while (j < lines.length) {
        const bl = (lines[j] || "").trim();
        if (!bl.startsWith("•")) break;
        block.bullets.push(bl.replace(/^•\s*/, ""));
        j++;
      }
    }

    blocks.push(block);
    i = j;
  }
  return blocks;
}

async function run() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: serviceAccount.client_email,
      private_key: serviceAccount.private_key,
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: client });

  const raw = fs.readFileSync(INPUT_PATH, "utf8");
  const blocks = parseReport(raw);
  if (!blocks.length) throw new Error("파싱된 보고서 블록이 없습니다.");

  const sheetTitle = `임시_객실인원리포트_${dayjs().format("MMDD_HHmm")}`;

  const addRes = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: {
      requests: [{ addSheet: { properties: { title: sheetTitle } } }],
    },
  });
  const sheetId = addRes.data.replies[0].addSheet.properties.sheetId;

  const values = [];
  const styleTargets = [];

  const width = 7;
  const padRow = (arr) => {
    const row = [...arr];
    while (row.length < width) row.push("");
    return row.slice(0, width);
  };

  for (const block of blocks) {
    const start = values.length;
    values.push(padRow([block.buildingTitle]));
    values.push(padRow([block.periodLine]));
    values.push(padRow([]));
    values.push(padRow(["인원별 예약 통계"]));
    values.push(padRow(block.headers));
    const dataStart = values.length;
    for (const r of block.rows) values.push(padRow(r));
    const dataEnd = values.length;
    values.push(padRow([]));
    const summaryTitleRow = values.length;
    values.push(padRow(["전체 통계"]));
    const bulletStart = values.length;
    for (const b of block.bullets) values.push(padRow([b]));
    const bulletEnd = values.length;
    values.push(padRow([]));
    values.push(padRow([]));

    styleTargets.push({
      titleRow: start,
      periodRow: start + 1,
      sectionRow: start + 3,
      headerRow: start + 4,
      dataStart,
      dataEnd,
      summaryTitleRow,
      bulletStart,
      bulletEnd,
    });
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetTitle}!A1`,
    valueInputOption: "USER_ENTERED",
    resource: { values },
  });

  const NAVY = { red: 0.10, green: 0.22, blue: 0.43 };
  const LIGHT_BLUE = { red: 0.89, green: 0.94, blue: 0.99 };
  const VERY_LIGHT = { red: 0.97, green: 0.98, blue: 1.0 };
  const WHITE = { red: 1, green: 1, blue: 1 };
  const DARK = { red: 0.1, green: 0.1, blue: 0.1 };

  const reqs = [
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 140 },
        fields: "pixelSize",
      },
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: 1, endIndex: 7 },
        properties: { pixelSize: 96 },
        fields: "pixelSize",
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: values.length, startColumnIndex: 0, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            textFormat: { fontFamily: "Noto Sans KR", fontSize: 10, foregroundColor: DARK },
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
            wrapStrategy: "OVERFLOW_CELL",
            backgroundColor: WHITE,
          },
        },
        fields: "userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment,wrapStrategy,backgroundColor)",
      },
    },
  ];

  for (const t of styleTargets) {
    reqs.push({
      mergeCells: {
        range: { sheetId, startRowIndex: t.titleRow, endRowIndex: t.titleRow + 1, startColumnIndex: 0, endColumnIndex: 7 },
        mergeType: "MERGE_ALL",
      },
    });
    reqs.push({
      mergeCells: {
        range: { sheetId, startRowIndex: t.periodRow, endRowIndex: t.periodRow + 1, startColumnIndex: 0, endColumnIndex: 7 },
        mergeType: "MERGE_ALL",
      },
    });
    reqs.push({
      mergeCells: {
        range: { sheetId, startRowIndex: t.sectionRow, endRowIndex: t.sectionRow + 1, startColumnIndex: 0, endColumnIndex: 7 },
        mergeType: "MERGE_ALL",
      },
    });
    reqs.push({
      mergeCells: {
        range: { sheetId, startRowIndex: t.summaryTitleRow, endRowIndex: t.summaryTitleRow + 1, startColumnIndex: 0, endColumnIndex: 7 },
        mergeType: "MERGE_ALL",
      },
    });

    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: t.titleRow, endRowIndex: t.titleRow + 1, startColumnIndex: 0, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            backgroundColor: NAVY,
            textFormat: { foregroundColor: WHITE, bold: true, fontSize: 14 },
            horizontalAlignment: "LEFT",
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
      },
    });
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: t.periodRow, endRowIndex: t.periodRow + 1, startColumnIndex: 0, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            backgroundColor: VERY_LIGHT,
            textFormat: { foregroundColor: DARK, bold: true, fontSize: 10 },
            horizontalAlignment: "LEFT",
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
      },
    });
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: t.sectionRow, endRowIndex: t.sectionRow + 1, startColumnIndex: 0, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            backgroundColor: LIGHT_BLUE,
            textFormat: { bold: true, fontSize: 11 },
            horizontalAlignment: "LEFT",
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
      },
    });
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: t.headerRow, endRowIndex: t.headerRow + 1, startColumnIndex: 0, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            backgroundColor: LIGHT_BLUE,
            textFormat: { bold: true, fontSize: 10 },
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat)",
      },
    });

    // 데이터 마지막 줄(합계) 강조
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: t.dataEnd - 1, endRowIndex: t.dataEnd, startColumnIndex: 0, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            backgroundColor: VERY_LIGHT,
            textFormat: { bold: true, fontSize: 10 },
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat)",
      },
    });

    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: t.summaryTitleRow, endRowIndex: t.summaryTitleRow + 1, startColumnIndex: 0, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            backgroundColor: LIGHT_BLUE,
            textFormat: { bold: true, fontSize: 11 },
            horizontalAlignment: "LEFT",
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
      },
    });
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: t.bulletStart, endRowIndex: t.bulletEnd, startColumnIndex: 0, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: "LEFT",
            textFormat: { fontSize: 10 },
          },
        },
        fields: "userEnteredFormat(horizontalAlignment,textFormat)",
      },
    });

    reqs.push({
      updateBorders: {
        range: { sheetId, startRowIndex: t.headerRow, endRowIndex: t.dataEnd, startColumnIndex: 0, endColumnIndex: 7 },
        top: { style: "SOLID" },
        bottom: { style: "SOLID" },
        left: { style: "SOLID" },
        right: { style: "SOLID" },
        innerHorizontal: { style: "SOLID" },
        innerVertical: { style: "SOLID" },
      },
    });
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: { requests: reqs },
  });

  console.log(`created_sheet_title=${sheetTitle}`);
  console.log(`sheet_id=${sheetId}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
