export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

const RESEND_SEND_URL = "https://api.resend.com/emails";

export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly fromAddress: string,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const response = await fetch(RESEND_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.fromAddress,
        to: message.to,
        subject: message.subject,
        text: message.body,
      }),
    });

    if (!response.ok) {
      // Never include the API key here -- only the provider's own status/detail.
      const detail = await response.text().catch(() => "");
      throw new Error(`Resend send failed with status ${response.status}: ${detail}`);
    }
  }
}
