import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY")!;
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY")!;
const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@luxcord.pages.dev";

webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
const admin = createClient(supabaseUrl, serviceRoleKey);

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return new Response("Unauthorized", { status: 401 });

  const authClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
  const { data: { user }, error: authError } = await authClient.auth.getUser(token);
  if (authError || !user) return new Response("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  const targetUser = String(body?.target_user || "");
  const title = String(body?.title || "Luxcord notification").slice(0, 120);
  const message = String(body?.body || "").slice(0, 500);
  const data = body?.data && typeof body.data === "object" ? body.data : {};

  if (!targetUser || !message) return new Response("Missing notification fields", { status: 400 });

  // Only deliver pushes for a notification that this authenticated user just created.
  const { data: notification } = await admin
    .from("notifications")
    .select("id")
    .eq("user_id", targetUser)
    .eq("title", title)
    .eq("body", message)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!notification) return new Response("Notification not found", { status: 403 });

  const { data: subscriptions, error } = await admin
    .from("push_subscriptions")
    .select("id,endpoint,p256dh,auth")
    .eq("user_id", targetUser);

  if (error) return new Response(error.message, { status: 500 });

  const payload = JSON.stringify({
    title,
    body: message,
    data: { ...data, notification_id: notification.id },
    icon: "/icon-192.png",
    badge: "/icon-192.png"
  });

  const staleIds: number[] = [];
  for (const sub of subscriptions || []) {
    try {
      await webpush.sendNotification({
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth }
      }, payload);
    } catch (error) {
      const status = Number((error as { statusCode?: number })?.statusCode || 0);
      if (status === 404 || status === 410) staleIds.push(sub.id);
    }
  }

  if (staleIds.length) await admin.from("push_subscriptions").delete().in("id", staleIds);
  return Response.json({ ok: true, sent: (subscriptions || []).length - staleIds.length });
});
