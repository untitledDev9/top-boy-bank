import nodemailer, { Transporter } from 'nodemailer';

interface EmailOptions {
  email: string;
  subject: string;
  message: string;
  // Optional HTML body. `message` stays as the plain-text fallback.
  html?: string;
}

// One pooled transporter for the whole process. Building a transporter per
// email meant a fresh TCP + TLS + SMTP-auth handshake for every message;
// pooling keeps a few authenticated connections open and reuses them.
//
// Created lazily on first use rather than at import time: dotenv.config() runs
// after the route/controller modules are imported, so the credentials are not
// in process.env yet while this module is being evaluated.
let transporter: Transporter | null = null;

const getTransporter = (): Transporter => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_APP_PASSWORD,
      },
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      // A stuck SMTP server must fail fast instead of holding a connection (and
      // any awaiting caller) indefinitely.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return transporter;
};

// Resend over HTTPS (port 443). Hosts like Render often can't reach SMTP
// ports (465/587), which surfaces as ENETUNREACH/ETIMEDOUT with Gmail.
type OutgoingMessage = { from: string; to: string; subject: string; text: string; html?: string };

const sendViaResend = async (message: OutgoingMessage): Promise<void> => {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`Resend API ${res.status}: ${await res.text().catch(() => '')}`);
  }
};

const sendEmail = async (options: EmailOptions): Promise<void> => {
  const message = {
    from: process.env.EMAIL_FROM || '"Sterling Crest Capital" <noreply@sterlingcrest.ventures>',
    to: options.email,
    subject: options.subject,
    text: options.message,
    ...(options.html ? { html: options.html } : {}),
  };

  // Prefer Resend when configured; otherwise fall back to SMTP (local dev).
  if (process.env.RESEND_API_KEY) {
    await sendViaResend(message);
    return;
  }
  await getTransporter().sendMail(message);
};

export default sendEmail;
