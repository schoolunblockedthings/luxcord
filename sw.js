self.addEventListener("push", event => {
    event.waitUntil((async () => {
        let payload = {};
        try { payload = event.data ? event.data.json() : {}; } catch (_) {}
        const title = payload.title || "Luxcord";
        const options = {
            body: payload.body || "You have a new notification.",
            icon: payload.icon || "/icon-192.png",
            badge: payload.badge || "/icon-192.png",
            data: payload.data || {},
            tag: payload.data?.conversation_id ? "luxcord-" + payload.data.conversation_id : "luxcord-notification",
            renotify: true
        };
        await self.registration.showNotification(title, options);
    })());
});

self.addEventListener("notificationclick", event => {
    event.notification.close();
    const data = event.notification.data || {};
    const target = new URL("chat.html", self.location.origin);

    if (data.sender_id) target.searchParams.set("dm", data.sender_id);

    event.waitUntil((async () => {
        const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

        for (const client of clients) {
            if ("focus" in client) {
                await client.focus();
                client.postMessage({
                    type: "luxcord-notification",
                    action: event.action || "open",
                    data
                });
                return;
            }
        }

        if (self.clients.openWindow) {
            await self.clients.openWindow(target.href);
        }
    })());
});
