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
