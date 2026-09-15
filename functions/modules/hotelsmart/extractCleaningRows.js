const { normalizeAssignee } = require("./normalizeAssignee");
const { normalizeRoomCode } = require("./normalizeRoomCode");
const {
    compactJoinedLines,
    normalizeWhitespace,
    removePlaceholderDashes,
} = require("./shared");

function parseTimeCell(timeLines = []) {
    const [checkoutLine = "", checkinLine = ""] = timeLines;
    const checkoutTime = normalizeWhitespace(checkoutLine.replace(/^CO\s*/iu, "")) || "-";
    const checkinTime = normalizeWhitespace(checkinLine.replace(/^C\/?I\s*/iu, "")) || "-";
    return { checkoutTime, checkinTime };
}

async function extractCleaningRows(page, {
    propertyName,
    operatingDate,
    collectedAt,
} = {}) {
    const rows = await page.evaluate(() => {
        const cleanText = (value) => String(value || "")
            .replace(/\u00A0/g, " ")
            .replace(/\r/g, "")
            .split(/\n+/)
            .map((line) => line.trim())
            .filter(Boolean)
            .join("\n");

        return Array.from(document.querySelectorAll("table tbody tr"))
            .map((row) => {
                const cells = Array.from(row.querySelectorAll("td"));
                if (cells.length < 10) return null;

                const roomCell = cells[1];
                const roomRaw = cleanText(roomCell?.querySelector(".room-number")?.textContent || "");
                if (!roomRaw) return null;

                const roomType = cleanText(roomCell?.querySelector(".room-type")?.textContent || "");
                const roomStatus = cleanText(cells[2]?.textContent || "");
                const cleaningStatus = cleanText(cells[3]?.textContent || "");
                const stayInfoRaw = cleanText(cells[4]?.innerText || "");
                const timeLines = Array.from(cells[5]?.querySelectorAll(".time-row") || []).map((node) => cleanText(node.textContent || node.innerText || ""));
                const cleanerRows = Array.from(cells[6]?.querySelectorAll(".cleaner-row") || []).map((node) => cleanText(node.innerText || node.textContent || ""));
                const notesA = cleanText(cells[7]?.innerText || "");
                const notesB = cleanText(cells[8]?.innerText || "");

                return {
                    roomRaw,
                    roomType,
                    roomStatus,
                    cleaningStatus,
                    stayInfoRaw,
                    timeLines,
                    cleanerRows,
                    notesA,
                    notesB,
                };
            })
            .filter(Boolean);
    });

    return rows.map((row) => {
        const cleanerLines = row.cleanerRows || [];
        const cleaningCompanyRaw = compactJoinedLines(cleanerLines[0] || "");
        const assigneeRaw = compactJoinedLines(cleanerLines[1] || cleanerLines[cleanerLines.length - 1] || "");
        const { checkoutTime, checkinTime } = parseTimeCell(row.timeLines || []);
        const notes = [removePlaceholderDashes(row.notesA), removePlaceholderDashes(row.notesB)]
            .filter(Boolean)
            .join(" | ");

        return {
            propertyName,
            roomRaw: normalizeWhitespace(row.roomRaw),
            roomCodeNormalized: normalizeRoomCode(propertyName, row.roomRaw),
            roomType: normalizeWhitespace(row.roomType),
            roomStatus: compactJoinedLines(row.roomStatus),
            cleaningStatus: compactJoinedLines(row.cleaningStatus),
            stayInfoRaw: compactJoinedLines(row.stayInfoRaw),
            checkoutTime,
            checkinTime,
            cleaningCompanyRaw,
            assigneeRaw,
            assigneeNormalized: normalizeAssignee(assigneeRaw),
            notes,
            collectedAt,
            operatingDate,
        };
    });
}

module.exports = {
    extractCleaningRows,
};
