import { Server } from 'socket.io';
import webpush from 'web-push';
import AdminNotificationRecord from '../models/AdminNotification';
import type { AdminNotificationType } from '../models/AdminNotification';
import AdminPushSubscription from '../models/AdminPushSubscription';

export interface AdminNotification {
  id: string;
  type: AdminNotificationType;
  title: string;
  message: string;
  url: string;
  created_at: string;
}

let io: Server | null = null;
let pushEnabled = false;

export function configureAdminNotifications(server: Server): void {
  io = server;

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return;

  webpush.setVapidDetails(subject, publicKey, privateKey);
  pushEnabled = true;
}

export function getVapidPublicKey(): string | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  return publicKey && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT ? publicKey : null;
}

export function notifyAdmins(notification: AdminNotification): void {
  void persistAndDispatch(notification).catch((error: unknown) => {
    console.error('Failed to dispatch admin notification:', error);
  });
}

async function persistAndDispatch(notification: AdminNotification): Promise<void> {
  try {
    await AdminNotificationRecord.updateOne(
      { event_id: notification.id },
      {
        $setOnInsert: {
          event_id: notification.id,
          type: notification.type,
          title: notification.title,
          message: notification.message,
          url: notification.url,
          created_at: notification.created_at,
        },
      },
      { upsert: true }
    );
  } catch (error) {
    console.error('Failed to persist admin notification:', error);
  }

  io?.to('admins').emit('admin:notification', notification);

  if (!pushEnabled) return;
  await sendPushNotifications(notification);
}

/*
 * Background push is best-effort; saving the event and live sockets still
 * deliver the in-app notification if a device's push service is unavailable.
 */
async function sendPushNotifications(notification: AdminNotification): Promise<void> {
  const subscriptions = await AdminPushSubscription.find().lean();
  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: subscription.keys,
        },
        JSON.stringify({
          id: notification.id,
          type: notification.type,
          title: notification.title,
          message: `${notification.title} in your admin dashboard.`,
          body: `${notification.title} in your admin dashboard.`,
          url: notification.url,
          created_at: notification.created_at,
        })
      );
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        try {
          await AdminPushSubscription.deleteOne({ _id: subscription._id });
        } catch (deleteError) {
          console.error('Failed to remove expired admin push subscription:', deleteError);
        }
        return;
      }

      console.error('Failed to deliver an admin push notification:', error);
    }
  }));
}
