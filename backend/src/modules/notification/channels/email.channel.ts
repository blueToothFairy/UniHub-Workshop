import type { ChannelSendInput, ChannelSendResult, INotificationChannel } from "./INotificationChannel.js";

function isRetryableStatus(statusCode: number): boolean {
  return statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

export class EmailNotificationChannel implements INotificationChannel {
  public readonly name = "email" as const;

  public async send(input: ChannelSendInput): Promise<ChannelSendResult> {
    if (!input.userEmail) {
      return { success: false, retryable: false, error: "Recipient email is missing" };
    }

    const apiKey = process.env.RESEND_API_KEY ?? "";
    const from = process.env.NOTIFICATION_EMAIL_FROM ?? "";
    const workshopTitle = input.workshopTitle ?? "your workshop";
    const userName = input.userFullName ?? "Student";

    if (!apiKey || !from) {
      return {
        success: false,
        retryable: false,
        error: "Missing RESEND_API_KEY or NOTIFICATION_EMAIL_FROM configuration"
      };
    }

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from,
          to: [input.userEmail],
          subject: "Workshop registration confirmed",
          html: `<p>Hi ${userName},</p><p>Your registration for <strong>${workshopTitle}</strong> is confirmed.</p>`
        })
      });

      if (response.ok) {
        return { success: true, retryable: false };
      }

      const bodyText = await response.text();
      return {
        success: false,
        retryable: isRetryableStatus(response.status),
        error: `Resend request failed (${response.status}): ${bodyText}`
      };
    } catch (error: unknown) {
      return {
        success: false,
        retryable: true,
        error: error instanceof Error ? error.message : "Email request failed"
      };
    }
  }
}
