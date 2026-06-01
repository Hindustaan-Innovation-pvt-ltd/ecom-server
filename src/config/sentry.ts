import * as Sentry from "@sentry/node"

Sentry.init({
    dsn: "https://dc31ae9505e9c87c5b56f708d02a0ec7@o4507322358169600.ingest.us.sentry.io/4511488614006784",
    // Setting this option to true will send default PII data to Sentry.
    // For example, automatic IP address collection on events
    sendDefaultPii: true,
});