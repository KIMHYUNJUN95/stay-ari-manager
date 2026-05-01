const axios = require("axios");

const DEFAULT_BASE_URL = "https://stg.ossu.me/api/external";
const DEFAULT_PAGE_SIZE = 500;

function getAttendanceAppConfig() {
    const apiKey = process.env.ATTENDANCE_APP_API_KEY || process.env.OSSU_EXTERNAL_API_KEY || "";
    const baseUrl = (process.env.ATTENDANCE_APP_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");

    return {
        apiKey,
        baseUrl,
    };
}

function createAttendanceAppClient(config = getAttendanceAppConfig()) {
    if (!config.apiKey) {
        throw new Error("Missing ATTENDANCE_APP_API_KEY or OSSU_EXTERNAL_API_KEY");
    }

    const http = axios.create({
        baseURL: config.baseUrl,
        timeout: Number(process.env.ATTENDANCE_APP_API_TIMEOUT_MS || 30000),
        headers: {
            Authorization: `Bearer ${config.apiKey}`,
            Accept: "application/json",
        },
    });

    async function getPaged(path, params = {}) {
        const size = Math.min(Number(params.size || DEFAULT_PAGE_SIZE), DEFAULT_PAGE_SIZE);
        let page = Number(params.page || 1);
        let totalPages = 1;
        const items = [];

        do {
            const response = await http.get(path, {
                params: {
                    ...params,
                    page,
                    size,
                },
            });
            const data = response.data || {};
            items.push(...(Array.isArray(data.items) ? data.items : []));
            totalPages = Number(data.totalPages || 1);
            page += 1;
        } while (page <= totalPages);

        return items;
    }

    return {
        listEmployees(params = {}) {
            return getPaged("/v1/employees", params);
        },

        listAttendanceRecords(params = {}) {
            if (!params.fromDate || !params.toDate) {
                throw new Error("fromDate and toDate are required");
            }
            return getPaged("/v1/attendance-records", params);
        },

        listPayrollSummaries(params = {}) {
            if (!params.yearMonth) {
                throw new Error("yearMonth is required");
            }
            return getPaged("/v1/payroll-summaries", params);
        },
    };
}

module.exports = {
    createAttendanceAppClient,
    getAttendanceAppConfig,
};
