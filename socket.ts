import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import User, { IUser } from './models/User';
import Chat from './models/Chat';

interface AuthSocket extends Socket {
  user?: IUser;
}

export function setupSocket(server: HttpServer, allowedOrigins: string[]) {
  const io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
    },
  });

  // Auth middleware — verify JWT
  io.use(async (socket: AuthSocket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error('Authentication required'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { id: string };
      const user = await User.findById(decoded.id);
      if (!user || !user.is_active) return next(new Error('Invalid user'));

      socket.user = user;
      next();
    } catch {
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (rawSocket) => {
    const socket = rawSocket as AuthSocket;
    const user = socket.user!;

    if (user.role !== 'admin') {
      socket.disconnect();
      return;
    }

    socket.join('admins');

    // Admin gets list of active chats
    socket.on('admin:getChats', async (callback: (data: any) => void) => {
      try {
        const chats = await Chat.find({ status: { $ne: 'closed' } })
          .sort({ updated_at: -1 })
          .select('customer_name status admin_id updated_at messages');

        const chatList = chats.map((c) => ({
          _id: c._id,
          customer_name: c.customer_name,
          status: c.status,
          updated_at: c.updated_at,
          lastMessage: c.messages[c.messages.length - 1],
        }));

        callback({ success: true, chats: chatList });
      } catch {
        callback({ success: false, message: 'Failed to load chats' });
      }
    });

    // Admin joins a specific chat to view messages
    socket.on('admin:joinChat', async (data: { chatId: string }, callback: (data: any) => void) => {
      try {
        const chat = await Chat.findById(data.chatId);
        if (!chat) return callback({ success: false, message: 'Chat not found' });

        socket.join(`chat:${chat._id}`);
        callback({ success: true, chat });
      } catch {
        callback({ success: false, message: 'Failed to join chat' });
      }
    });

    // Admin takes over the chat from AI
    socket.on('admin:takeover', async (data: { chatId: string }, callback: (data: any) => void) => {
      try {
        const chat = await Chat.findById(data.chatId);
        if (!chat || chat.status === 'closed') return callback({ success: false, message: 'Chat not found' });

        chat.status = 'admin';
        chat.admin_id = user._id as any;

        chat.messages.push({
          sender: 'ai',
          text: 'You are now connected with a live support agent. How can we assist you?',
          created_at: new Date(),
        });
        await chat.save();

        callback({ success: true });
      } catch {
        callback({ success: false, message: 'Failed to take over chat' });
      }
    });

    // Admin sends a message
    socket.on('admin:message', async (data: { chatId: string; text: string }, callback: (data: any) => void) => {
      try {
        const chat = await Chat.findOne({ _id: data.chatId, status: 'admin' });
        if (!chat) return callback({ success: false, message: 'Chat not found or not taken over' });

        chat.messages.push({ sender: 'admin', text: data.text, created_at: new Date() });
        await chat.save();

        callback({ success: true });
      } catch {
        callback({ success: false, message: 'Failed to send message' });
      }
    });

    // Admin closes/ends a chat
    socket.on('admin:closeChat', async (data: { chatId: string }) => {
      try {
        await Chat.findByIdAndUpdate(data.chatId, { status: 'closed' });
      } catch { /* silent */ }
    });

    // Admin polls for chat updates (refresh chat list)
    socket.on('admin:refreshChats', async (callback: (data: any) => void) => {
      try {
        const chats = await Chat.find({ status: { $ne: 'closed' } })
          .sort({ updated_at: -1 })
          .select('customer_name status admin_id updated_at messages');

        const chatList = chats.map((c) => ({
          _id: c._id,
          customer_name: c.customer_name,
          status: c.status,
          updated_at: c.updated_at,
          lastMessage: c.messages[c.messages.length - 1],
        }));

        callback({ success: true, chats: chatList });
      } catch {
        callback({ success: false, message: 'Failed to load chats' });
      }
    });
  });

  return io;
}
