const { collectTodayAssignments } = require("./collectTodayAssignments");
const { formatCleaningAssignmentsMessage } = require("../slack/formatCleaningAssignmentsMessage");

function createHotelsmartCleaningModule({
    onRequest,
    hotelsmartSecrets = [],
    authorizeInternalRequest,
} = {}) {
    const collectHotelsmartCleaningAssignmentsManual = onRequest({
        cors: true,
        timeoutSeconds: 540,
        memory: "2GiB",
        secrets: hotelsmartSecrets,
    }, async (req, res) => {
        try {
            if (typeof authorizeInternalRequest !== "function") {
                throw new Error("Internal request authorization is not configured");
            }
            await authorizeInternalRequest(req);

            const source = req.method === "GET" ? req.query : req.body;
            const operatingDate = source?.date || source?.operatingDate || null;
            const propertyName = source?.propertyName || null;
            const debug = String(source?.debug || "") === "1";

            const result = await collectTodayAssignments({
                operatingDate,
                propertyNames: propertyName ? [propertyName] : undefined,
                debug,
            });

            res.json({
                success: true,
                ...result,
                slackMessage: formatCleaningAssignmentsMessage(result),
            });
        } catch (error) {
            const statusCode = Number(error.statusCode) || 500;
            if (statusCode >= 500) {
                console.error("[Hotelsmart] collectHotelsmartCleaningAssignmentsManual failed:", error.message || error);
            }
            res.status(statusCode).json({
                success: false,
                error: error.message || "Failed to collect HOTELSMART cleaning assignments",
            });
        }
    });

    return {
        collectHotelsmartCleaningAssignmentsManual,
    };
}

module.exports = {
    createHotelsmartCleaningModule,
};
