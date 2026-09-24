import { timingSafeEqual } from "node:crypto";
import nodemailer from "nodemailer";

type RelayMail = {
  to: string;
  subject: string;
  text: string;
  messageId: string;
};

const jsonHeaders = {
  "cache-control": "private, no-store",
  "content-type": "application/json; charset=utf-8",
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function authorized(value: string | null, secret: string) {
  const expected = `Bearer ${secret}`;
  if (!value || value.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}

function validMail(value: unknown): value is RelayMail {
  if (!value || typeof value !== "object") return false;
  const mail = value as Record<string, unknown>;
  return (
    typeof mail.to === "string" &&
    mail.to.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail.to) &&
    typeof mail.subject === "string" &&
    mail.subject.length > 0 &&
    mail.subject.length <= 250 &&
    typeof mail.text === "string" &&
    mail.text.length > 0 &&
    mail.text.length <= 20_000 &&
    typeof mail.messageId === "string" &&
    /^[0-9a-f-]{36}$/i.test(mail.messageId)
  );
}

export default {
  async fetch(request: Request) {
    if (request.method !== "POST")
      return reply(405, { error: "method_not_allowed" });

    const relaySecret = process.env.MAIL_RELAY_SECRET || "";
    const gmailUser = process.env.GMAIL_USER || "";
    const gmailPassword = process.env.GMAIL_APP_PASSWORD || "";
    if (
      relaySecret.length < 32 ||
      !gmailUser ||
      !gmailPassword ||
      !authorized(request.headers.get("authorization"), relaySecret)
    )
      return reply(401, { error: "unauthorized" });

    const length = Number(request.headers.get("content-length") || "0");
    if (length > 32_768) return reply(413, { error: "payload_too_large" });
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      return reply(415, { error: "unsupported_media_type" });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return reply(400, { error: "invalid_json" });
    }
    if (!validMail(body)) return reply(400, { error: "invalid_mail" });

    try {
      const transport = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 587,
        secure: false,
        requireTLS: true,
        auth: { user: gmailUser, pass: gmailPassword },
        tls: { rejectUnauthorized: true },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      await transport.sendMail({
        to: body.to,
        from: `Noctis <${gmailUser}>`,
        subject: body.subject,
        text: body.text,
        messageId: `<${body.messageId}@noctis>`,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      transport.close();
      return reply(200, { delivered: true });
    } catch (error) {
      const failure = error as { code?: string; responseCode?: number };
      console.error(
        JSON.stringify({
          event: "security_mail_relay_failed",
          code: failure.code || null,
          responseCode: failure.responseCode || null,
        }),
      );
      return reply(502, { error: "delivery_failed" });
    }
  },
};

