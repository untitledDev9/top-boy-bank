import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import Chat from '../models/Chat';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

// The greeting is stored on each chat when it's created, so chats opened before
// the rename still show the old name. Only messages whose text is exactly one of
// the old greetings are rewritten. Dry run unless --apply is passed.
const TAIL = ' Ask me anything about your account, transfers, or withdrawals — and a member of our support team can step in any time.';
const OLD_GREETINGS = [
  `Hello! I'm the Trust Georgia Bank assistant.${TAIL}`,
  `Hello! I'm the Sterling Crest Bank assistant.${TAIL}`,
];
const NEW_GREETING = `Hello! I'm the Sterling Crest Capital assistant.${TAIL}`;

const run = async (): Promise<void> => {
  try {
    await mongoose.connect(process.env.MONGO_URI as string);
    console.log('Connected to MongoDB');

    const filter = { messages: { $elemMatch: { sender: 'ai', text: { $in: OLD_GREETINGS } } } };
    const matching = await Chat.countDocuments(filter);
    console.log(`${matching} chat(s) have an old greeting`);

    if (!process.argv.includes('--apply')) {
      console.log('Dry run - pass --apply to update them');
      process.exit(0);
    }

    // updateMany skips the save hook, so updated_at / expires_at are left alone.
    const result = await Chat.updateMany(
      filter,
      { $set: { 'messages.$[m].text': NEW_GREETING } },
      { arrayFilters: [{ 'm.sender': 'ai', 'm.text': { $in: OLD_GREETINGS } }] }
    );
    console.log(`Updated ${result.modifiedCount} chat(s)`);

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
};

run();
