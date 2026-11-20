# Admin mobile app and push notifications

The admin dashboard is installable as a PWA. Serve it over HTTPS (localhost is
also allowed for development), open `/sharp` on the admin's phone, and use
**Add to phone** in the notification menu. On iOS, use Safari's Share menu and
choose **Add to Home Screen**.

The dropdown loads recent events from MongoDB and refreshes every five seconds,
so it can recover events even if the live socket briefly disconnects. Events
are retained for up to 30 days.

Background push alerts require VAPID keys on the API server. Generate a key pair
with `npx web-push generate-vapid-keys`, then configure these backend environment
variables:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT` (a `mailto:` contact or HTTPS URL)

The public key is served to authenticated admins by the API; do not place the
private key in the frontend or commit it to source control. After deploying the
API configuration, open the installed admin app and select **Enable push** in
the notification menu. The API's `CLIENT_URL` must allow the frontend origin,
and reverse proxies must pass the `/socket.io` WebSocket path for live in-app
notifications.
