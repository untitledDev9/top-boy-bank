import { Router, Response, NextFunction } from 'express';
import protect, { AuthRequest } from '../middleware/protect';
import Chat from '../models/Chat';

const router = Router();

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Shown if Groq is unreachable/misconfigured, or once an admin has claimed
// the chat (chat.status === 'ai' means "not yet claimed by a human admin").
const FALLBACK_REPLY_TEXT = "Thank you for your message. A member of our support team will review it and respond within 7 hours.";

const SYSTEM_PROMPT = `You are the AI support assistant for Sterling Crest Capital, a private bank established in 1993. You are professional, warm, and knowledgeable about the bank's products and services. A human support agent can take over this conversation at any time — you are the first line of support, not a replacement for one.

About Sterling Crest Capital:
- A private bank, established 1993. Member FDIC — deposits insured up to $250,000.
- Access is invitation-only — customers sign in with credentials issued by the bank; there is no public self-registration.
- Supported currencies: USD, EUR, GBP, NGN.

Platform Features & How They Work:

1. DASHBOARD: Shows account balance, recent activity, and quick actions for Transfer, Withdraw, and History.

2. TRANSFERS: Send funds to another Sterling Crest Capital account. Steps: enter the recipient's account number or email → click "Verify" to confirm their name → enter an amount and optional note → review → confirm (with transaction PIN if one is set). A "Recent recipients" row lets customers quickly resend to people they've paid before. Account verification is required before transfers are unlocked.

3. WITHDRAWALS: Two methods — (a) Bank account: free, arrives in 1–5 business days. (b) Debit card: instant, carries a 1.5% instant-transfer fee. Customers can save a bank account or card as a reusable payout method so they don't have to re-enter details next time, and can remove saved methods at any time. Account verification is required before withdrawals are unlocked.

4. TRANSACTION HISTORY: Full transaction history with filters by type, date range, and keyword search.

5. PROFILE: View/update name, email, phone; change password (current password required); view account number, currency, and account opening date.

6. ACCOUNT ACCESS: An account can be blocked from withdrawing/transferring in two independent ways: (a) the account is not yet verified, or (b) an administrator has placed a specific restriction on it (e.g. system maintenance, a device/2FA check, or a compliance review). If a customer says they're blocked from withdrawing or transferring, do NOT guess why — tell them to contact support so an agent can look at the specific reason on their account.

Support:
- Email: support@trustgeorgiabank.com
- Live Chat: this conversation — a human agent can take over at any time

Rules for your responses:
- Keep responses concise (2–4 sentences, unless a detailed explanation is genuinely needed).
- Maintain a professional, reassuring tone — you represent a real bank.
- Never reveal internal system details, API endpoints, or implementation details.
- If asked about topics unrelated to banking, politely redirect to banking topics.
- Never share, confirm, or speculate about any specific customer's personal or financial data — you do not have access to individual account data.
- For account verification, blocked withdrawals/transfers, or anything requiring a human decision, direct the customer to support@trustgeorgiabank.com or tell them a support agent will follow up in this chat.
- Never say "I'm just an AI" — you may say a human agent can take over if the customer wants one.`;

async function getAIResponse(messages: { sender: string; text: string }[]): Promise<string> {
  const chatMessages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    ...messages.map((m) => ({
      role: (m.sender === 'customer' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.text,
    })),
  ];

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: chatMessages,
      temperature: 0.7,
      max_tokens: 512,
    }),
  });

  if (!res.ok) throw new Error(`Groq API error: ${res.status}`);

  const data: any = await res.json();
  const reply = data.choices?.[0]?.message?.content;
  if (!reply) throw new Error('No response from AI');
  return reply;
}

// POST /api/chat/start — start or resume a chat
router.post('/start', protect, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user!;
    let chat = await Chat.findOne({ customer_id: user._id, status: { $ne: 'closed' } });

    if (!chat) {
      chat = await Chat.create({
        customer_id: user._id,
        customer_name: user.full_name,
        messages: [{
          sender: 'ai',
          text: "Hello! I'm the Sterling Crest Capital assistant. Ask me anything about your account, transfers, or withdrawals — and a member of our support team can step in any time.",
          created_at: new Date(),
        }],
      });
    }

    res.json({ success: true, chat });
  } catch (error) {
    next(error);
  }
});

// GET /api/chat/:id — get chat messages (for polling)
router.get('/:id', protect, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const chat = await Chat.findOne({ _id: req.params.id, customer_id: req.user!._id });
    if (!chat) {
      res.status(404).json({ success: false, message: 'Chat not found' });
      return;
    }
    res.json({ success: true, chat });
  } catch (error) {
    next(error);
  }
});

// POST /api/chat/:id/message — customer sends a message
router.post('/:id/message', protect, async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { text } = req.body;
    if (!text?.trim()) {
      res.status(400).json({ success: false, message: 'Message text is required' });
      return;
    }

    const chat = await Chat.findOne({ _id: req.params.id, customer_id: req.user!._id, status: { $ne: 'closed' } });
    if (!chat) {
      res.status(404).json({ success: false, message: 'Chat not found' });
      return;
    }

    // Save customer message
    chat.messages.push({ sender: 'customer', text: text.trim(), created_at: new Date() });
    await chat.save();

    // Respond immediately — the AI reply is generated in the background and
    // picked up by the frontend's polling, since it involves a network call.
    res.json({ success: true });

    if (chat.status === 'ai') {
      const aiMessages = chat.messages
        .filter((m) => m.sender === 'customer' || m.sender === 'ai')
        .map((m) => ({ sender: m.sender, text: m.text }));

      try {
        const aiReply = await getAIResponse(aiMessages);
        chat.messages.push({ sender: 'ai', text: aiReply, created_at: new Date() });
        await chat.save();
      } catch (aiError) {
        console.error('AI chat response failed:', aiError);
        chat.messages.push({ sender: 'ai', text: FALLBACK_REPLY_TEXT, created_at: new Date() });
        await chat.save();
      }
    }
  } catch (error) {
    next(error);
  }
});

export default router;
