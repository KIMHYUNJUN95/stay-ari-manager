"use strict";

const fs = require("fs");
const path = require("path");
const util = require("util");

const functionsDir = path.resolve(__dirname, "..");
const projectDir = path.resolve(functionsDir, "..");
const envPath = path.join(functionsDir, ".env");
const serviceAccountPath = path.join(functionsDir, "serviceAccountKey.json");
const logDir = path.join(projectDir, "tmp");
const logPath = path.join(logDir, "slack-cleaning-local-scheduler.log");

function loadLocalEnv() {
    if (!fs.existsSync(envPath)) {
        throw new Error(`Environment file not found: ${envPath}`);
    }

    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/u);
    lines.forEach((rawLine) => {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) return;

        const separatorIndex = line.indexOf("=");
        if (separatorIndex <= 0) return;

        const key = line.slice(0, separatorIndex).trim();
        let value = line.slice(separatorIndex + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        if (!process.env[key]) process.env[key] = value;
    });
}

function installFileLogger() {
    fs.mkdirSync(logDir, { recursive: true });

    ["log", "warn", "error"].forEach((level) => {
        const original = console[level].bind(console);
        console[level] = (...args) => {
            original(...args);
            const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${util.format(...args)}\n`;
            fs.appendFileSync(logPath, line, "utf8");
        };
    });
}

async function main() {
    installFileLogger();
    loadLocalEnv();

    if (!fs.existsSync(serviceAccountPath)) {
        throw new Error(`Service account file not found: ${serviceAccountPath}`);
    }
    process.env.GOOGLE_APPLICATION_CREDENTIALS = serviceAccountPath;

    const { scheduledSlackCleaningReportRetry } = require(path.join(functionsDir, "index.js"));
    if (typeof scheduledSlackCleaningReportRetry?.run !== "function") {
        throw new Error("scheduledSlackCleaningReportRetry.run is unavailable");
    }

    console.log("[Local Cleaning Scheduler] started");
    await scheduledSlackCleaningReportRetry.run({ time: new Date().toISOString() });
    console.log("[Local Cleaning Scheduler] completed");
}

main().catch((error) => {
    console.error("[Local Cleaning Scheduler] failed:", error?.stack || error?.message || error);
    process.exitCode = 1;
});
