import nodemailer, { Transporter } from 'nodemailer';

interface EmailOptions {
  email: string;
  subject: string;
  message: string;
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

const sendEmail = async (options: EmailOptions): Promise<void> => {
  const message = {
    from: process.env.EMAIL_FROM || '"Sterling Crest Capital" <noreply@sterlingcrestcapital.com>',
    to: options.email,
    subject: options.subject,
    text: options.message,
  };

  await getTransporter().sendMail(message);
};

export default sendEmail;
