function getGoogleServiceAccountCredentials() {
    const rawCredentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!rawCredentials) {
        throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not configured");
    }

    let credentials;
    try {
        credentials = JSON.parse(rawCredentials);
    } catch (error) {
        throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is invalid JSON");
    }

    if (!credentials.client_email || !credentials.private_key) {
        throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing required fields");
    }
    return credentials;
}

module.exports = { getGoogleServiceAccountCredentials };
