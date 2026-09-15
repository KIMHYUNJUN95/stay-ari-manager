const fs = require("fs");
const os = require("os");
const path = require("path");
const { MATERIAL_ICON_LABELS } = require("./constants");

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retry(operation, {
    attempts = 3,
    delayMs = 1000,
    factor = 2,
    label = "operation",
} = {}) {
    let lastError = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return await operation(attempt);
        } catch (error) {
            lastError = error;
            if (attempt >= attempts) break;
            console.warn(`[Hotelsmart] ${label} attempt ${attempt}/${attempts} failed:`, error.message || error);
            await sleep(delayMs);
            delayMs *= factor;
        }
    }

    throw lastError;
}

function normalizeWhitespace(value) {
    return String(value || "")
        .replace(/\u00A0/g, " ")
        .replace(/\r/g, "")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function splitMeaningfulLines(value, { stripMaterialIcons = true } = {}) {
    const lines = String(value || "")
        .replace(/\u00A0/g, " ")
        .split(/\n+/)
        .map((line) => normalizeWhitespace(line))
        .filter(Boolean);

    if (!stripMaterialIcons) return lines;
    return lines.filter((line) => !MATERIAL_ICON_LABELS.has(line));
}

function compactJoinedLines(value, options = {}) {
    return splitMeaningfulLines(value, options).join("\n").trim();
}

function removePlaceholderDashes(value) {
    return splitMeaningfulLines(value)
        .filter((line) => line !== "-")
        .join("\n")
        .trim();
}

function shouldCaptureDebugArtifacts(debug) {
    return Boolean(debug) && process.env.NODE_ENV !== "production";
}

async function maybeSaveDebugScreenshot(page, name, debug = false) {
    if (!shouldCaptureDebugArtifacts(debug)) return null;
    const dir = path.join(os.tmpdir(), "hotelsmart-debug");
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${Date.now()}-${name}.png`);
    await page.screenshot({ path: filePath, fullPage: true });
    return filePath;
}

module.exports = {
    sleep,
    retry,
    normalizeWhitespace,
    splitMeaningfulLines,
    compactJoinedLines,
    removePlaceholderDashes,
    maybeSaveDebugScreenshot,
    shouldCaptureDebugArtifacts,
};
