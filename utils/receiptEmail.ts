// HTML + plain-text receipt for incoming transfers. Every user-supplied value
// (names, descriptions) is escaped before it goes into the markup.

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const money = (value: number, currency: string): string =>
  `${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

const last4 = (accountNumber: string): string => `•••• ${String(accountNumber).slice(-4)}`;

export interface IncomingReceipt {
  recipientName: string;
  senderName: string;
  senderAccountNumber: string;
  recipientAccountNumber: string;
  amount: number;
  newBalance: number;
  currency: string;
  description: string;
  reference: string;
  date: Date;
}

export const buildReceiptSubject = (r: IncomingReceipt): string =>
  `Sterling Crest Capital - You received ${money(r.amount, r.currency)}`;

export const buildReceiptText = (r: IncomingReceipt): string =>
  [
    `Hello ${r.recipientName},`,
    '',
    `You received a transfer of ${money(r.amount, r.currency)} from ${r.senderName}.`,
    '',
    `Reference: ${r.reference}`,
    `Date: ${formatDate(r.date)}`,
    `From: ${r.senderName} (account ${last4(r.senderAccountNumber)})`,
    `To: your account ${last4(r.recipientAccountNumber)}`,
    `Description: ${r.description}`,
    `Amount received: ${money(r.amount, r.currency)}`,
    `New balance: ${money(r.newBalance, r.currency)}`,
    '',
    'Thank you for choosing Sterling Crest Capital.',
  ].join('\n');

const formatDate = (d: Date): string =>
  d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';

const row = (label: string, value: string): string => `
              <tr>
                <td style="padding:12px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:14px;width:40%;">${label}</td>
                <td style="padding:12px 0;border-bottom:1px solid #e5e7eb;color:#111827;font-size:14px;text-align:right;">${value}</td>
              </tr>`;

export const buildReceiptHtml = (r: IncomingReceipt): string => {
  const name = escapeHtml(r.recipientName);
  const sender = escapeHtml(r.senderName);
  const description = escapeHtml(r.description || 'Transfer');
  const amount = escapeHtml(money(r.amount, r.currency));
  const balance = escapeHtml(money(r.newBalance, r.currency));

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Funds received</title>
  </head>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background:#0f2a4a;padding:20px 28px;color:#ffffff;font-size:16px;font-weight:bold;letter-spacing:0.3px;">
                Sterling Crest Capital
              </td>
            </tr>
            <tr>
              <td style="padding:28px 28px 8px;">
                <p style="margin:0 0 4px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:1px;">Payment received</p>
                <p style="margin:0 0 16px;color:#111827;font-size:34px;font-weight:bold;">${amount}</p>
                <p style="margin:0;color:#374151;font-size:15px;line-height:1.5;">Hi ${name}, <strong>${sender}</strong> sent you this payment.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 28px 24px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">${row('Reference', escapeHtml(r.reference))}${row('Date', escapeHtml(formatDate(r.date)))}${row('From', `${sender}<br /><span style="color:#6b7280;font-size:12px;">Account ${escapeHtml(last4(r.senderAccountNumber))}</span>`)}${row('To', `Your account<br /><span style="color:#6b7280;font-size:12px;">Account ${escapeHtml(last4(r.recipientAccountNumber))}</span>`)}${row('Description', description)}${row('Amount received', `<strong>${amount}</strong>`)}${row('New balance', balance)}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px 28px;background:#f9fafb;color:#6b7280;font-size:12px;line-height:1.5;">
                This is an automated receipt. If you don't recognise this payment, contact Sterling Crest Capital support.
              </td>
            </tr>
          </table>
          <p style="color:#9ca3af;font-size:11px;margin:16px 0 0;">&copy; Sterling Crest Capital</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};
