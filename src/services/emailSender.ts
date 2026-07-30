export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

const POSTMARK_SEND_URL = "https://api.postmarkapp.com/email";

export class PostmarkEmailSender implements EmailSender {
  constructor(
    private readonly apiToken: string,
    private readonly fromAddress: string,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const response = await fetch(POSTMARK_SEND_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": this.apiToken,
      },
      body: JSON.stringify({
        From: this.fromAddress,
        To: message.to,
        Subject: message.subject,
        TextBody: message.body,
      }),
    });

    if (!response.ok) {
      // Never include the API token here -- only the provider's own status/detail.
      const detail = await response.text().catch(() => "");
      throw new Error(`Postmark send failed with status ${response.status}: ${detail}`);
    }
  }
}
