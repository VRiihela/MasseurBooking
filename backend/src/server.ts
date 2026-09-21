import { createApp } from "./app.js";
import { loadEmailConfig } from "./config/email.js";
import { ResendEmailSender } from "./services/emailSender.js";
import { startEmailWorker } from "./services/emailWorker.js";
import { startRetentionWorker } from "./services/retentionWorker.js";

const port = Number(process.env.PORT ?? 3000);
createApp().listen(port, () => {
  console.log(`masseur-booking API listening on port ${port}`);
});

const emailConfig = loadEmailConfig();
startEmailWorker(new ResendEmailSender(emailConfig.resendApiKey, emailConfig.fromAddress));
startRetentionWorker();
