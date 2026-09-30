const SUPABASE_URL = "https://mvgqpkdldciwzqgpayoo.supabase.co";

const SUPABASE_KEY = "sb_publishable_53vpmb7o0GOxHgeGmLIMeg_CrDK2oG4";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(location.search);

let session = null;
let me = null;
let room = params.get("room");
let reply = null;
let dm = null;

let settings = {
    sound: true,
    notifications: true,
    enter_send: true,
    theme: "dark"
};


// =============================
// HELPERS
// =============================

const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[character]));

const open = (id) => {
    $(id)?.classList.remove("hidden");
};

const close = (id) => {
    $(id)?.classList.add("hidden");
};


// =============================
// APP BOOT / AUTH
// =============================

async function boot() {
    try {
        const result = await sb.auth.getSession();

        if (result.error) {
            console.error("Luxcord auth session error:", result.error);
            renderGuest();
            bind();
            return;
        }

        session = result.data?.session || null;

        if (session) {
            await loadMe();
            renderMe();

            setupRealtime();

            await Promise.all([
                loadFriends(),
                loadDMs(),
                loadNotifications()
            ]);
        } else {
            renderGuest();
        }

        bind();

        if (room) {
            await joinRoom(
                room,
                params.get("name") || "Guest"
            );
        } else if (!session) {
            $("logout-btn")?.classList.add("hidden");
        }
    } catch (error) {
        console.error("Luxcord startup error:", error);
        // Keep the app usable even if a secondary feature fails during startup.
        if (session) {
            renderMe();
            bind();
        } else {
            renderGuest();
            bind();
        }
    }
}

sb.auth.onAuthStateChange((event, nextSession) => {
    if (event === "SIGNED_IN" && nextSession) {
        session = nextSession;
        loadMe().then(() => {
            renderMe();
            setupRealtime();
            return Promise.all([
                loadFriends(),
                loadDMs(),
                loadNotifications()
            ]);
        }).catch(error => console.error("Post-login startup error:", error));
    }

    if (event === "SIGNED_OUT") {
        session = null;
        me = null;
        if (location.pathname.endsWith("chat.html")) {
            location.href = "index.html";
        }
    }
});


async function loadMe() {
    const result = await sb
        .from("profiles")
        .select("*")
        .eq("id", session.user.id)
        .maybeSingle();

    if (result.data) {
        me = result.data;
    } else {
        const username =
            (
                session.user.user_metadata?.username ||
                session.user.email.split("@")[0]
            )
                .replace(/[^a-zA-Z0-9_.-]/g, "")
                .slice(0, 32) || "user";

        const created = await sb
            .from("profiles")
            .insert({
                id: session.user.id,
                username,
                display_name: username
            })
            .select()
            .single();

        me = created.data;
    }

    settings = {
        ...settings,
        ...(me?.settings || {})
    };

    document.body.dataset.theme = settings.theme;
}


function renderMe() {
    const name =
        me?.display_name ||
        me?.username ||
        "User";

    if ($("me-name")) {
        $("me-name").textContent = name;
    }

    if ($("me-status")) {
        $("me-status").textContent =
            me?.status || "Online";
    }

    if ($("me-avatar")) {
        $("me-avatar").textContent =
            name[0]?.toUpperCase() || "U";
    }
}


function renderGuest() {
    const name =
        params.get("name") ||
        "Guest";

    if ($("me-name")) {
        $("me-name").textContent = name;
    }

    if ($("me-status")) {
        $("me-status").textContent = "Guest";
    }

    if ($("me-avatar")) {
        $("me-avatar").textContent =
            name[0]?.toUpperCase() || "G";
    }

    $("settings-btn")?.classList.add("hidden");
    $("profile-btn")?.classList.add("hidden");
}


// =============================
// EVENT BINDINGS
// =============================

function bind() {
    document
        .querySelectorAll("[data-view]")
        .forEach((button) => {
            button.onclick = () => {
                view(button.dataset.view);
            };
        });

    $("logout-btn")?.addEventListener("click", async () => {
        await sb.auth.signOut();
        location.href = "index.html";
    });

    $("settings-btn")?.addEventListener(
        "click",
        openSettings
    );

    $("profile-btn")?.addEventListener(
        "click",
        openProfile
    );

    document
        .querySelectorAll(".modal-close")
        .forEach((button) => {
            button.onclick = () => {
                const modal =
                    button.closest(".modal");

                if (modal) {
                    close(modal.id);
                }
            };
        });

    $("notification-btn")?.addEventListener(
        "click",
        () => {
            open("notification-panel");
            loadNotifications();
        }
    );

    $("clear-notifications")?.addEventListener(
        "click",
        clearNotifications
    );

    $("new-room")?.addEventListener(
        "click",
        createRoom
    );

    $("home-room")?.addEventListener(
        "click",
        createRoom
    );

    $("home-friends")?.addEventListener(
        "click",
        () => view("friends")
    );

    $("home-dms")?.addEventListener(
        "click",
        () => view("dms")
    );

    $("leave-btn")?.addEventListener(
        "click",
        leaveRoom
    );

    $("send-btn")?.addEventListener(
        "click",
        sendRoom
    );

    $("message-input")?.addEventListener(
        "input",
        (event) => {
            if ($("char-counter")) {
                $("char-counter").textContent =
                    `${event.target.value.length}/1000`;
            }
        }
    );

    $("message-input")?.addEventListener(
        "keydown",
        (event) => {
            if (
                event.key === "Enter" &&
                !event.shiftKey &&
                settings.enter_send
            ) {
                event.preventDefault();
                sendRoom();
            }
        }
    );

    $("cancel-reply")?.addEventListener(
        "click",
        () => {
            reply = null;
            close("reply-bar");
        }
    );

    $("search-users")?.addEventListener(
        "click",
        searchUsers
    );

    $("user-search")?.addEventListener(
        "keydown",
        (event) => {
            if (event.key === "Enter") {
                searchUsers();
            }
        }
    );

    $("refresh-friends")?.addEventListener(
        "click",
        loadFriends
    );

    $("save-profile")?.addEventListener(
        "click",
        saveProfile
    );

    $("save-settings")?.addEventListener(
        "click",
        saveSettings
    );

    $("dm-send")?.addEventListener(
        "click",
        sendDM
    );
    $("dm-attach")?.addEventListener("click",()=>$( "dm-file")?.click());
    $("dm-cancel-reply")?.addEventListener("click",()=>{reply=null;$("dm-reply-bar")?.classList.add("hidden");});

    $("dm-input")?.addEventListener(
        "keydown",
        (event) => {
            if (
                event.key === "Enter" &&
                !event.shiftKey &&
                settings.enter_send
            ) {
                event.preventDefault();
                sendDM();
            }
        }
    );
}


// =============================
// VIEWS
// =============================

function view(viewName) {
    document
        .querySelectorAll(".view")
        .forEach((element) => {
            element.classList.add("hidden");
        });

    const selectedView =
        $(`${viewName}-view`);

    if (selectedView) {
        selectedView.classList.remove("hidden");
    }

    document
        .querySelectorAll(".rail-btn[data-view]")
        .forEach((button) => {
            button.classList.toggle(
                "active",
                button.dataset.view === viewName
            );
        });

    const titles = {
        home: "Home",
        friends: "Friends",
        dms: "Direct Messages",
        room: "Room Chat"
    };

    if ($("view-title")) {
        $("view-title").textContent =
            titles[viewName] || "Luxcord";
    }

    if (viewName === "friends") {
        loadFriends();
    }

    if (viewName === "dms") {
        loadDMs();
    }
}


// =============================
// ROOMS
// =============================

async function createRoom() {
    const code = prompt("Room code");

    if (!code?.trim()) {
        return;
    }

    await joinRoom(
        code.trim(),
        me?.username ||
        params.get("name") ||
        "Guest"
    );
}


async function joinRoom(roomCode, name) {
    room = roomCode;
    luxSubscribeRoomTyping();
    luxBindRoomTyping();

    // Fixed:
    // The old code referenced #room-display even though
    // that element may not exist in the HTML.

    if ($("room-name-side")) {
        $("room-name-side").textContent =
            roomCode;
    }

    if ($("room-subtitle")) {
        $("room-subtitle").textContent =
            `• ${roomCode}`;
    }

    view("room");

    if (session && me) {
        await sb
            .from("user_status")
            .upsert(
                {
                    room: roomCode,
                    name: me.username,
                    last_active: Date.now(),
                    is_typing: false,
                    typing_timestamp: Date.now()
                },
                {
                    onConflict: "room,name"
                }
            );
    }

    await refreshRoom();
    await loadMembers();
}


async function refreshRoom() {
    if (!room) {
        return;
    }

    const result = await sb
        .from("chat_messages")
        .select("*")
        .eq("room", room)
        .order("id");

    if (result.error) {
        if ($("chat-display")) {
            $("chat-display").innerHTML = `
                <div class="empty-state">
                    <h2>Database setup needed</h2>
                    <p>
                        Run supabase/schema.sql in
                        the Supabase SQL Editor.
                    </p>
                </div>
            `;
        }

        return;
    }

    const messages = result.data || [];

    let reactions = [];

    if (session && messages.length) {
        const reactionResult = await sb
            .from("message_reactions")
            .select("*")
            .in(
                "message_id",
                messages.map(
                    (message) => message.id
                )
            );

        reactions =
            reactionResult.data || [];
    }

    if (!$("chat-display")) {
        return;
    }

    $("chat-display").innerHTML =
        messages
            .map((message) => {
                const parent =
                    messages.find(
                        (item) =>
                            String(item.id) ===
                            String(message.reply_to)
                    );

                const actions = session
                    ? `
                        <button
                            onclick="reactRoom(${message.id}, '❤️')"
                        >
                            ❤️
                        </button>

                        <button
                            onclick="reactRoom(${message.id}, '👍')"
                        >
                            👍
                        </button>

                        <button
                            onclick="reactRoom(${message.id}, '😂')"
                        >
                            😂
                        </button>
                    `
                    : "";

                return `
                    <article class="message">

                        <div class="message-avatar">
                            ${esc(
                                (message.name || "?")[0]
                            )}
                        </div>

                        <div class="message-body">

                            <div class="message-head">
                                <b>
                                    ${esc(
                                        message.name
                                    )}
                                </b>

                                <time>
                                    ${new Date(
                                        message.created_at
                                    ).toLocaleTimeString([], {
                                        hour: "2-digit",
                                        minute: "2-digit"
                                    })}
                                </time>
                            </div>

                            ${
                                parent
                                    ? `
                                        <div class="reply-preview">
                                            Replying to
                                            ${esc(parent.name)}:
                                            ${esc(
                                                String(
                                                    parent.message
                                                ).slice(0, 100)
                                            )}
                                        </div>
                                    `
                                    : ""
                            }

                            <div class="message-text">
                                ${esc(message.message)}
                            </div>

                            <div class="message-actions">

                                <button
                                    onclick="replyRoom(${message.id})"
                                >
                                    ↩ Reply
                                </button>

                                ${actions}

                            </div>

                            <div class="reactions">
                                ${groups(
                                    reactions.filter(
                                        (reaction) =>
                                            reaction.message_id ===
                                            message.id
                                    )
                                )}
                            </div>

                        </div>

                    </article>
                `;
            })
            .join("");

    $("chat-display").scrollTop =
        $("chat-display").scrollHeight;
}


function groups(reactions) {
    const grouped = {};

    reactions.forEach((reaction) => {
        grouped[reaction.emoji] =
            (grouped[reaction.emoji] || 0) + 1;
    });

    return Object
        .entries(grouped)
        .map(
            ([emoji, count]) =>
                `<span class="reaction">${esc(
                    emoji
                )} ${count}</span>`
        )
        .join("");
}


window.replyRoom = async function (id) {
    const result = await sb
        .from("chat_messages")
        .select("*")
        .eq("id", id)
        .single();

    reply = result.data;

    if (!reply) {
        return;
    }

    if ($("reply-text")) {
        $("reply-text").textContent =
            `Replying to ${reply.name}: ${
                String(reply.message).slice(0, 100)
            }`;
    }

    open("reply-bar");

    $("message-input")?.focus();
};


window.reactRoom = async function (id, emoji) {
    if (!session) {
        return;
    }

    const result = await sb
        .from("message_reactions")
        .select("id")
        .eq("message_id", id)
        .eq("user_id", session.user.id)
        .eq("emoji", emoji)
        .maybeSingle();

    if (result.data) {
        await sb
            .from("message_reactions")
            .delete()
            .eq("id", result.data.id);
    } else {
        await sb
            .from("message_reactions")
            .insert({
                message_id: id,
                user_id: session.user.id,
                emoji
            });
    }

    await refreshRoom();
};


async function sendRoom() {
    const input = $("message-input");

    if (!input) {
        return;
    }

    const text = input.value.trim();

    if (!text || !room) {
        return;
    }

    const result = await sb
        .from("chat_messages")
        .insert({
            room,
            name:
                me?.username ||
                params.get("name") ||
                "Guest",
            message: text,
            user_id: session?.user?.id || null,
            reply_to: reply?.id || null
        });

    if (result.error) {
        alert(result.error.message);
        return;
    }

    input.value = "";

    if ($("char-counter")) {
        $("char-counter").textContent =
            "0/1000";
    }

    reply = null;

    close("reply-bar");

    await refreshRoom();
}


async function leaveRoom() {
    if (session && room && me) {
        await sb
            .from("user_status")
            .delete()
            .eq("room", room)
            .eq("name", me.username);
    }

    room = null;

    view("home");
}


async function loadMembers() {
    if (!room || !$("room-members")) {
        return;
    }

    const result = await sb
        .from("user_status")
        .select("*")
        .eq("room", room);

    $("room-members").innerHTML =
        (result.data || [])
            .filter(
                (user) =>
                    Date.now() -
                    user.last_active <
                    30000
            )
            .map(
                (user) => `
                    <div class="side-item">
                        🟢 ${esc(user.name)}
                    </div>
                `
            )
            .join("");
}


// =============================
// FRIENDS
// =============================

async function loadFriends() {
    if (!session) {
        return;
    }

    const result = await sb
        .from("friendships")
        .select("*")
        .or(
            `requester.eq.${session.user.id},addressee.eq.${session.user.id}`
        );

    const friendships =
        result.data || [];

    const ids = [
        ...new Set(
            friendships
                .flatMap((friendship) => [
                    friendship.requester,
                    friendship.addressee
                ])
                .filter(
                    (id) =>
                        id !== session.user.id
                )
        )
    ];

    let profiles = [];

    if (ids.length) {
        const profileResult = await sb
            .from("profiles")
            .select(
                "id,username,display_name,status"
            )
            .in("id", ids);

        profiles =
            profileResult.data || [];
    }

    const profileMap =
        Object.fromEntries(
            profiles.map(
                (profile) => [
                    profile.id,
                    profile
                ]
            )
        );

    const incoming =
        friendships.filter(
            (friendship) =>
                friendship.addressee ===
                    session.user.id &&
                friendship.status ===
                    "pending"
        );

    const friends =
        friendships.filter(
            (friendship) =>
                friendship.status ===
                "accepted"
        );

    if ($("requests-list")) {
        $("requests-list").innerHTML =
            incoming
                .map(
                    (friendship) =>
                        person(
                            profileMap[
                                friendship.requester
                            ],
                            `
                                <button
                                    class="primary"
                                    onclick="acceptFriend('${friendship.id}')"
                                >
                                    Accept
                                </button>

                                <button
                                    class="secondary"
                                    onclick="declineFriend('${friendship.id}')"
                                >
                                    Decline
                                </button>
                            `
                        )
                )
                .join("") ||
            '<div class="muted">No pending requests.</div>';
    }

    if ($("friends-list")) {
        $("friends-list").innerHTML =
            friends
                .map((friendship) => {
                    const id =
                        friendship.requester ===
                        session.user.id
                            ? friendship.addressee
                            : friendship.requester;

                    return person(
                        profileMap[id],
                        `
                            <button
                                class="secondary"
                                onclick="openDM('${id}')"
                            >
                                Message
                            </button>
                        `
                    );
                })
                .join("") ||
            '<div class="muted">No friends yet.</div>';
    }

    if ($("friend-summary")) {
        $("friend-summary").textContent =
            `${friends.length} friend${
                friends.length === 1
                    ? ""
                    : "s"
            }`;
    }
}


function person(profile, actions) {
    if (!profile) {
        return "";
    }

    const displayName =
        profile.display_name ||
        profile.username;

    return `
        <div class="person-card">

            <div class="avatar">
                ${esc(displayName[0])}
            </div>

            <div class="info">
                <b>${esc(displayName)}</b>

                <small>
                    @${esc(profile.username)}
                    •
                    ${esc(
                        profile.status ||
                        "Online"
                    )}
                </small>
            </div>

            <div class="actions">
                ${actions}
            </div>

        </div>
    `;
}


async function searchUsers() {
    if (!session) {
        return;
    }

    const input = $("user-search");

    if (!input) {
        return;
    }

    const query = input.value.trim();

    if (query.length < 2) {
        return;
    }

    const result = await sb
        .from("profiles")
        .select(
            "id,username,display_name,status"
        )
        .ilike(
            "username",
            `%${query}%`
        )
        .neq(
            "id",
            session.user.id
        )
        .limit(20);

    if ($("friend-results")) {
        $("friend-results").innerHTML =
            (result.data || [])
                .map(
                    (profile) =>
                        person(
                            profile,
                            `
                                <button
                                    class="primary"
                                    onclick="sendFriend('${profile.id}')"
                                >
                                    Add friend
                                </button>
                            `
                        )
                )
                .join("") ||
            '<div class="muted">No users found.</div>';
    }
}


window.sendFriend = async function (id) {
    const existing = await sb
        .from("friendships")
        .select("id")
        .or(
            `and(requester.eq.${session.user.id},addressee.eq.${id}),and(requester.eq.${id},addressee.eq.${session.user.id})`
        );

    if (existing.data?.length) {
        alert(
            "Friend request already exists."
        );
        return;
    }

    const result = await sb
        .from("friendships")
        .insert({
            requester: session.user.id,
            addressee: id
        });

    if (result.error) {
        alert(result.error.message);
        return;
    }

    await notify(
        id,
        "friend_request",
        "New friend request",
        `${me.username} sent you a friend request.`
    );

    await loadFriends();
};


window.acceptFriend = async function (id) {
    const result = await sb
        .from("friendships")
        .update({
            status: "accepted"
        })
        .eq("id", id)
        .eq(
            "addressee",
            session.user.id
        )
        .select()
        .single();

    if (result.data) {
        await notify(
            result.data.requester,
            "friend_accept",
            "Friend request accepted",
            `${me.username} accepted your request.`
        );
    }

    await loadFriends();
    await loadDMs();
};


window.declineFriend = async function (id) {
    await sb
        .from("friendships")
        .update({
            status: "declined"
        })
        .eq("id", id)
        .eq(
            "addressee",
            session.user.id
        );

    await loadFriends();
}


// =============================
// NOTIFICATIONS
// =============================

async function notify(
    id,
    type,
    title,
    body
) {
    await sb.rpc(
        "create_notification",
        {
            target_user: id,
            notification_type: type,
            notification_title: title,
            notification_body: body,
            notification_data: {}
        }
    );
}


async function loadNotifications() {
    if (!session) {
        return;
    }

    const result = await sb
        .from("notifications")
        .select("*")
        .eq(
            "user_id",
            session.user.id
        )
        .order("created_at", {
            ascending: false
        })
        .limit(30);

    const notifications =
        result.data || [];

    const unread =
        notifications.filter(
            (notification) =>
                !notification.read
        );

    if ($("notification-count")) {
        $("notification-count").textContent =
            unread.length;

        $("notification-count")
            .classList.toggle(
                "hidden",
                unread.length === 0
            );
    }

    if ($("notifications-list")) {
        $("notifications-list").innerHTML =
            notifications
                .map(
                    (notification) => `
                        <div
                            class="notification ${
                                notification.read
                                    ? ""
                                    : "unread"
                            }"
                            onclick="readNotification('${notification.id}')"
                        >
                            <b>
                                ${esc(
                                    notification.title
                                )}
                            </b>

                            <div>
                                ${esc(
                                    notification.body
                                )}
                            </div>

                            <small>
                                ${new Date(
                                    notification.created_at
                                ).toLocaleString()}
                            </small>
                        </div>
                    `
                )
                .join("") ||
            `
                <div
                    class="muted"
                    style="padding:15px"
                >
                    No notifications.
                </div>
            `;
    }
}


window.readNotification =
    async function (id) {
        await sb
            .from("notifications")
            .update({
                read: true
            })
            .eq("id", id);

        await loadNotifications();
    };


async function clearNotifications() {
    if (!session) {
        return;
    }

    await sb
        .from("notifications")
        .update({
            read: true
        })
        .eq(
            "user_id",
            session.user.id
        );

    await loadNotifications();
}


// =============================
// DIRECT MESSAGES
// =============================

async function loadDMs() {
    if (!session) return;
    const result = await sb.from("friendships").select("*")
        .or(`requester.eq.${session.user.id},addressee.eq.${session.user.id}`).eq("status","accepted");
    const ids=(result.data||[]).map(f=>f.requester===session.user.id?f.addressee:f.requester);
    let profiles=[];
    if(ids.length){
        const pr=await sb.from("profiles").select("id,username,display_name,last_seen_at").in("id",ids);
        profiles=pr.data||[];
    }
    const rows=await Promise.all(profiles.map(async profile=>{
        const users=[session.user.id,profile.id].sort();
        const conv=await sb.from("dm_conversations").select("id").eq("user_a",users[0]).eq("user_b",users[1]).maybeSingle();
        let unread=0;
        if(conv.data){
            const count=await sb.from("dm_messages").select("id",{count:"exact",head:true})
                .eq("conversation_id",conv.data.id).neq("sender_id",session.user.id).is("read_at",null);
            unread=count.count||0;
        }
        const name=profile.display_name||profile.username||"User";
        return `<div class="side-item" data-dm-user-id="${profile.id}" onclick="openDM('${profile.id}')">
            <div class="avatar">${esc(name[0]?.toUpperCase()||"?")}</div>
            <span class="dm-online-dot">○</span>
            <span>${esc(name)}</span>
            ${unread?'<span class="dm-unread-badge">'+unread+'</span>':''}
        </div>`;
    }));
    const html=rows.join("")||'<div class="muted" style="padding:10px">Add friends to start DMs.</div>';
    if($("dm-people"))$("dm-people").innerHTML=html;
    if($("dm-people-main"))$("dm-people-main").innerHTML=html;
    luxRenderPresence?.();
}

window.openDM = async function (id) {
    if (!session) {
        return;
    }

    const users = [
        session.user.id,
        id
    ].sort();

    let result = await sb
        .from("dm_conversations")
        .select("*")
        .eq("user_a", users[0])
        .eq("user_b", users[1])
        .maybeSingle();

    if (!result.data) {
        result = await sb
            .from("dm_conversations")
            .insert({
                user_a: users[0],
                user_b: users[1]
            })
            .select()
            .single();
    }

    if (result.error) {
        alert(result.error.message);
        return;
    }

    dm = result.data;

    const otherProfile = await sb.from("profiles").select("id,username,display_name,last_seen_at").eq("id", id).maybeSingle();
    const other = otherProfile.data || {};
    const otherName = other.display_name || other.username || "User";
    if ($("dm-conversation-name")) $("dm-conversation-name").textContent = otherName;
    if ($("dm-conversation-avatar")) $("dm-conversation-avatar").textContent = otherName[0]?.toUpperCase() || "?";
    if ($("dm-conversation-status")) $("dm-conversation-status").textContent = luxIsOnline?.(id) ? "Online now" : "Direct message";
    open("dm-conversation-head");

    view("dms");

    open("dm-messages");
    open("dm-composer");
    close("dm-empty");

    await refreshDM();
};


let dmRefreshing = false;

async function refreshDM() {
    if (!dm || !session || dmRefreshing) {
        return;
    }

    dmRefreshing = true;

    try {
        const result = await sb
            .from("dm_messages")
            .select("*")
            .eq("conversation_id", dm.id)
            .order("created_at", {
                ascending: true
            });

        if (result.error) {
            console.error(
                "DM message load error:",
                result.error
            );
            return;
        }

        const messages = result.data || [];

        const ids = [
            ...new Set(
                messages.map(
                    (message) => message.sender_id
                )
            )
        ];

        let profiles = [];

        if (ids.length) {
            const profileResult = await sb
                .from("profiles")
                .select(
                    "id,username,display_name"
                )
                .in("id", ids);

            profiles =
                profileResult.data || [];
        }

        const profileMap =
            Object.fromEntries(
                profiles.map(
                    (profile) => [
                        profile.id,
                        profile
                    ]
                )
            );

        const container = $("dm-messages");

        if (!container) {
            return;
        }

        const wasNearBottom =
            container.scrollHeight -
                container.scrollTop -
                container.clientHeight <
            150;

        container.innerHTML = messages
            .map((message) => {
                const user =
                    profileMap[
                        message.sender_id
                    ] || {};

                const name =
                    user.display_name ||
                    user.username ||
                    "User";

                const avatar =
                    name[0]?.toUpperCase() || "?";

                const time =
                    new Date(
                        message.created_at
                    ).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit"
                    });

                return `
<article
    class="message"
    style="
        display:grid;
        grid-template-columns:36px minmax(0,1fr);
        gap:10px;
        width:100%;
        margin:0 0 9px 0;
        padding:0;
        height:auto;
        min-height:0;
        align-items:start;
    "
>
    <div
        class="message-avatar"
        style="
            grid-column:1;
            grid-row:1;
            width:36px;
            height:36px;
            min-width:36px;
            margin:0;
            padding:0;
        "
    >${esc(avatar)}</div>

    <div
        class="message-body"
        style="
            grid-column:2;
            grid-row:1;
            display:block;
            width:100%;
            height:auto;
            min-height:0;
            margin:0;
            padding:0;
        "
    >
        <div
            class="message-head"
            style="
                display:flex;
                flex-direction:row;
                align-items:baseline;
                justify-content:flex-start;
                gap:8px;
                width:100%;
                height:18px;
                min-height:18px;
                margin:0;
                padding:0;
                line-height:18px;
            "
        ><b
            style="
                display:inline;
                margin:0;
                padding:0;
                line-height:18px;
            "
        >${esc(name)}</b><time
            style="
                display:inline;
                margin:0;
                padding:0;
                line-height:16px;
                font-size:11px;
            "
        >${esc(time)}</time></div>

        <div
            class="message-text"
            style="
                display:block;
                width:100%;
                height:auto;
                min-height:19px;
                margin:1px 0 0 0;
                padding:0;
                white-space:pre-wrap;
                word-break:break-word;
                overflow-wrap:anywhere;
                line-height:19px;
                text-align:left;
            "
        >${message.deleted_at ? "<i>Message deleted</i>" : esc(message.message)}${message.edited_at && !message.deleted_at ? ' <small class="dm-edited">(edited)</small>' : ""}</div>

        ${message.attachment_url && !message.deleted_at ? (() => {
            const isImage = /\\.(?:png|jpe?g|gif|webp|bmp|svg)(?:[?#].*)?$/i.test(message.attachment_name || message.attachment_url);
            return isImage
                ? `<a href="${esc(message.attachment_url)}" target="_blank" rel="noopener" class="dm-attachment"><img src="${esc(message.attachment_url)}" alt="${esc(message.attachment_name || "Image")}" loading="lazy" style="max-width:320px;max-height:320px;border-radius:10px;display:block;margin-top:6px;object-fit:contain;"></a>`
                : `<a href="${esc(message.attachment_url)}" target="_blank" rel="noopener" class="dm-attachment">📎 ${esc(message.attachment_name || "Attachment")}</a>`;
        })() : ""}

        ${message.sender_id === session.user.id ? `<div class="dm-read-state">${message.read_at ? "Seen" : "Sent"}</div>` : ""}

        <div
            class="message-actions"
            style="
                display:flex;
                flex-direction:row;
                align-items:center;
                justify-content:flex-start;
                gap:2px;
                width:100%;
                height:20px;
                min-height:20px;
                margin:1px 0 0 0;
                padding:0;
            "
        ><button onclick="replyToDMMessage(\${message.id}, \${JSON.stringify(message.message)})">↩</button><button onclick="editDMMessage(\${message.id})">✎</button><button onclick="deleteDMMessage(\${message.id})">🗑</button><button
            onclick="reactDM(\${message.id}, '❤️')"
            style="
                display:inline-flex;
                align-items:center;
                justify-content:center;
                width:auto;
                height:20px;
                min-height:20px;
                margin:0;
                padding:1px 4px;
                line-height:18px;
            "
        >❤️</button><button
            onclick="reactDM(${message.id}, '👍')"
            style="
                display:inline-flex;
                align-items:center;
                justify-content:center;
                width:auto;
                height:20px;
                min-height:20px;
                margin:0;
                padding:1px 4px;
                line-height:18px;
            "
        >👍</button></div>
    </div>
</article>
`;
            })
            .join("");

        if (wasNearBottom || messages.length <= 1) {
            container.scrollTop =
                container.scrollHeight;
        }
    } finally {
        dmRefreshing = false;
    }
}


async function uploadDMAttachment(file){
    if(!file||!session)return null;
    if(file.size>15*1024*1024){
        alert("Attachments must be 15 MB or smaller.");
        return null;
    }
    const safeName=(file.name||"attachment").replace(/[^a-zA-Z0-9._-]/g,"_");
    const path=session.user.id+"/"+Date.now()+"-"+safeName;
    const upload=await sb.storage.from("luxcord-attachments").upload(path,file,{upsert:false,contentType:file.type||"application/octet-stream"});
    if(upload.error){
        console.error("Attachment upload failed:",upload.error);
        alert("Could not upload the file: "+upload.error.message);
        return null;
    }
    const publicUrl=sb.storage.from("luxcord-attachments").getPublicUrl(path).data.publicUrl;
    return {url:publicUrl,name:file.name};
}


async function sendDM(){if(!dm||!session)return;const input=$("dm-input");if(!input)return;const text=input.value.trim();const file=$("dm-file")?.files?.[0];if(!text&&!file)return;const attachment=file?await uploadDMAttachment(file):null;const result=await sb.from("dm_messages").insert({conversation_id:dm.id,sender_id:session.user.id,message:text||(attachment?.name||""),reply_to_id:reply?.id||null,attachment_url:attachment?.url||null,attachment_name:attachment?.name||null});if(result.error){alert(result.error.message);return;}input.value="";if($("dm-file"))$("dm-file").value="";reply=null;$("dm-reply-bar")?.classList.add("hidden");const target=dm.user_a===session.user.id?dm.user_b:dm.user_a;await notify(target,"dm","New direct message",`${me.display_name||me.username} sent you a message.`,{conversation_id:dm.id,sender_id:session.user.id});await refreshDM();}


window.reactDM = async function (
    id,
    emoji
) {
    if (!session) {
        return;
    }

    const result = await sb
        .from("dm_reactions")
        .select("id")
        .eq("message_id", id)
        .eq(
            "user_id",
            session.user.id
        )
        .eq("emoji", emoji)
        .maybeSingle();

    if (result.data) {
        await sb
            .from("dm_reactions")
            .delete()
            .eq("id", result.data.id);
    } else {
        await sb
            .from("dm_reactions")
            .insert({
                message_id: id,
                user_id: session.user.id,
                emoji
            });
    }

    await refreshDM();
};


// =============================
// PROFILE
// =============================

function openProfile() {
    if (!session) {
        alert(
            "Create an account to use profiles."
        );
        return;
    }

    $("profile-username").value =
        me.username || "";

    $("profile-display-name").value =
        me.display_name || "";

    $("profile-status").value =
        me.status || "Online";

    $("profile-bio").value =
        me.bio || "";

    open("profile-modal");
}


async function saveProfile() {
    const username =
        $("profile-username")
            .value
            .trim()
            .replace(
                /[^a-zA-Z0-9_.-]/g,
                ""
            );

    if (username.length < 3) {
        if ($("profile-error")) {
            $("profile-error").textContent =
                "Username must be at least 3 characters.";
        }

        return;
    }

    const result = await sb
        .from("profiles")
        .update({
            username,
            display_name:
                $("profile-display-name")
                    .value
                    .trim() || username,
            status:
                $("profile-status")
                    .value
                    .trim() || "Online",
            bio:
                $("profile-bio")
                    .value
                    .trim()
        })
        .eq("id", session.user.id)
        .select()
        .single();

    if (result.error) {
        if ($("profile-error")) {
            $("profile-error").textContent =
                result.error.message;
        }

        return;
    }

    me = result.data;

    renderMe();

    close("profile-modal");
}


// =============================
// SETTINGS
// =============================

function openSettings() {
    if ($("setting-sound")) {
        $("setting-sound").checked =
            !!settings.sound;
    }

    if ($("setting-notify")) {
        $("setting-notify").checked =
            !!settings.notifications;
    }

    if ($("setting-enter")) {
        $("setting-enter").checked =
            !!settings.enter_send;
    }

    if ($("setting-theme")) {
        $("setting-theme").value =
            settings.theme || "dark";
    }

    open("settings-modal");
}


async function saveSettings() {
    settings = {
        sound:
            $("setting-sound")?.checked ??
            true,

        notifications:
            $("setting-notify")?.checked ??
            true,

        enter_send:
            $("setting-enter")?.checked ??
            true,

        theme:
            $("setting-theme")?.value ||
            "dark"
    };

    if (session) {
        await sb
            .from("profiles")
            .update({
                settings
            })
            .eq(
                "id",
                session.user.id
            );
    }

    document.body.dataset.theme =
        settings.theme;

    close("settings-modal");

    if (
        settings.notifications &&
        "Notification" in window &&
        Notification.permission ===
            "default"
    ) {
        await Notification.requestPermission();
    }
}


// =============================
// REALTIME
// =============================

let realtimeChannel = null;

function setupRealtime() {
    if (!session) {
        return;
    }

    if (realtimeChannel) {
        sb.removeChannel(realtimeChannel);
    }

    realtimeChannel = sb
        .channel(
            `luxcord-live-${session.user.id}`
        )

        // ROOM MESSAGES
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: "chat_messages"
            },
            (payload) => {
                const changedRoom =
                    payload.new?.room ||
                    payload.old?.room;

                if (
                    room &&
                    String(changedRoom) ===
                        String(room)
                ) {
                    refreshRoom();
                }
            }
        )

        // DIRECT MESSAGES
        .on(
            "postgres_changes",
            {
                event: "INSERT",
                schema: "public",
                table: "dm_messages"
            },
            (payload) => {
                const conversationId =
                    payload.new?.conversation_id;

                if (
                    dm &&
                    String(conversationId) ===
                        String(dm.id)
                ) {
                    refreshDM();
                }
            }
        )

        .on(
            "postgres_changes",
            {
                event: "UPDATE",
                schema: "public",
                table: "dm_messages"
            },
            (payload) => {
                const conversationId =
                    payload.new?.conversation_id ||
                    payload.old?.conversation_id;

                if (
                    dm &&
                    String(conversationId) ===
                        String(dm.id)
                ) {
                    refreshDM();
                }
            }
        )

        .on(
            "postgres_changes",
            {
                event: "DELETE",
                schema: "public",
                table: "dm_messages"
            },
            (payload) => {
                const conversationId =
                    payload.old?.conversation_id;

                if (
                    dm &&
                    String(conversationId) ===
                        String(dm.id)
                ) {
                    refreshDM();
                }
            }
        )

        // NOTIFICATIONS
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: "notifications",
                filter:
                    `user_id=eq.${session.user.id}`
            },
            () => {
                loadNotifications();
            }
        )

        .subscribe((status) => {
            console.log(
                "Luxcord realtime:",
                status
            );
        });
}

// =============================
// PRESENCE REFRESH
// =============================

setInterval(() => {
    if (room) {
        loadMembers();
    }
}, 4000);


async function luxUpdateLastSeen(){if(!session)return;await sb.from("profiles").update({last_seen_at:new Date().toISOString()}).eq("id",session.user.id);}
setInterval(luxUpdateLastSeen,60000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)luxUpdateLastSeen();});
/* LIVE CHAT ENHANCEMENTS */
let luxRoomChannel=null;
let luxRoomTypingTimer=null;
let luxRoomTypingUsers=new Map();
let luxPresenceChannel=null;
let luxDMChannel=null;
let luxDMChannelReady=false;
let luxTypingTimer=null;
let luxTypingUsers=new Set();
let luxPresenceKey=null;

function luxSetTypingLabel(id,text){
    const el=$(id);
    if(el)el.textContent=text||"";
}

function luxSubscribeRoomTyping(){
    if(!session||!room)return;
    if(luxRoomChannel)sb.removeChannel(luxRoomChannel);
    luxRoomTypingUsers.clear();

    luxRoomChannel=sb.channel("luxcord-room-typing-"+String(room),{
        config:{broadcast:{self:false}}
    }).on("broadcast",{event:"typing"},({payload})=>{
        if(!payload||String(payload.user_id)===String(session.user.id))return;
        const uid=String(payload.user_id);
        if(payload.typing){
            luxRoomTypingUsers.set(uid,payload.username||"Someone");
        }else{
            luxRoomTypingUsers.delete(uid);
        }
        const names=[...luxRoomTypingUsers.values()];
        luxSetTypingLabel(
            "typing-label",
            names.length ? (names.length===1 ? names[0]+" is typing…" : names.length+" people are typing…") : ""
        );
    }).subscribe(status=>{
        if(status==="SUBSCRIBED")luxBindRoomTyping();
        else console.warn("Room typing channel:",status);
    });
}

async function luxSendRoomTyping(typing){
    if(!luxRoomChannel||!session)return;
    await luxRoomChannel.send({
        type:"broadcast",
        event:"typing",
        payload:{
            user_id:session.user.id,
            username:me?.display_name||me?.username||"Someone",
            typing:!!typing
        }
    });
}

function luxBindRoomTyping(){
    const input=$("message-input");
    if(!input||input.dataset.luxTyping==="room")return;
    input.dataset.luxTyping="room";
    input.addEventListener("input",()=>{
        luxSendRoomTyping(true);
        clearTimeout(luxRoomTypingTimer);
        luxRoomTypingTimer=setTimeout(()=>luxSendRoomTyping(false),1200);
    });
    input.addEventListener("blur",()=>luxSendRoomTyping(false));
}

function luxIsOnline(id){
    if(!id||!luxPresenceChannel)return false;
    const state=luxPresenceChannel.presenceState();
    return Object.values(state).some(entries=>
        (entries||[]).some(entry=>
            String(entry?.user_id)===String(id) && entry?.tab_open===true
        )
    );
}

function luxRenderPresence(){
    document.querySelectorAll("[data-dm-user-id]").forEach(el=>{
        const id=el.getAttribute("data-dm-user-id");
        const dot=el.querySelector(".dm-online-dot");
        if(!dot)return;
        const online=luxIsOnline(id);
        dot.textContent=online?"●":"○";
        dot.title=online?"Online now":"Offline";
        dot.classList.toggle("online",online);
    });

    if(dm&&session){
        const otherId=String(dm.user_a)===String(session.user.id)?dm.user_b:dm.user_a;
        const status=$("dm-conversation-status");
        if(status)status.textContent=luxIsOnline(otherId)?"Online now":"Offline";
    }
}

async function luxPresenceSetup(){
    if(!session)return;
    if(luxPresenceChannel)sb.removeChannel(luxPresenceChannel);

    // A unique presence key makes each browser tab independently trackable.
    luxPresenceKey=String(session.user.id)+"-"+Math.random().toString(36).slice(2);
    luxPresenceChannel=sb.channel("luxcord-presence",{
        config:{presence:{key:luxPresenceKey}}
    })
    .on("presence",{event:"sync"},luxRenderPresence)
    .on("presence",{event:"join"},luxRenderPresence)
    .on("presence",{event:"leave"},luxRenderPresence)
    .subscribe(async status=>{
        if(status==="SUBSCRIBED"){
            const result=await luxPresenceChannel.track({
                user_id:session.user.id,
                username:me?.display_name||me?.username||"User",
                tab_open:true
            });
            if(result?.error)console.warn("Presence track:",result.error);
            luxRenderPresence();
        }else{
            console.warn("Presence channel:",status);
        }
    });
}

async function luxMarkDMRead({refresh=true}={}){
    if(!dm||!session||$("dms-view")?.classList.contains("hidden"))return false;
    const result=await sb.rpc("mark_dm_messages_read",{p_conversation_id:dm.id});
    if(result.error){
        console.warn("DM read receipt:",result.error.message);
        return false;
    }
    if(refresh)await refreshDM();
    await loadDMs();
    return true;
}

function luxSubscribeDM(){
    if(!dm||!session)return;
    if(luxDMChannel)sb.removeChannel(luxDMChannel);
    luxTypingUsers.clear();
    luxDMChannelReady=false;
    luxSetTypingLabel("dm-typing-label","");

    luxDMChannel=sb.channel("luxcord-dm-live-"+String(dm.id),{
        config:{broadcast:{self:false}}
    })
    .on("broadcast",{event:"typing"},({payload})=>{
        if(!payload||String(payload.user_id)===String(session.user.id))return;
        if(payload.typing)luxTypingUsers.add(String(payload.user_id));
        else luxTypingUsers.delete(String(payload.user_id));
        luxSetTypingLabel("dm-typing-label",luxTypingUsers.size?"Typing…":"");
    })
    .on("postgres_changes",{
        event:"*",
        schema:"public",
        table:"dm_messages",
        filter:"conversation_id=eq."+dm.id
    },async payload=>{
        // Refresh first so new/edit/delete messages appear immediately.
        await refreshDM();

        // If this conversation is open, mark incoming messages read.
        if(!$("dms-view")?.classList.contains("hidden")){
            await luxMarkDMRead({refresh:false});
        }
    })
    .subscribe(status=>{
        luxDMChannelReady=status==="SUBSCRIBED";
        if(status==="SUBSCRIBED"){
            luxBindTyping();
            luxMarkDMRead({refresh:false});
        }else{
            console.warn("DM realtime channel:",status);
        }
    });
}

async function luxSendTyping(typing){
    if(!luxDMChannel||!luxDMChannelReady||!session)return;
    await luxDMChannel.send({
        type:"broadcast",
        event:"typing",
        payload:{user_id:session.user.id,typing:!!typing}
    });
}

function luxBindTyping(){
    const input=$("dm-input");
    if(!input||input.dataset.luxTyping==="dm")return;
    input.dataset.luxTyping="dm";
    input.addEventListener("input",()=>{
        luxSendTyping(true);
        clearTimeout(luxTypingTimer);
        luxTypingTimer=setTimeout(()=>luxSendTyping(false),1200);
    });
    input.addEventListener("blur",()=>luxSendTyping(false));
}

const luxOriginalOpenDM=window.openDM;
window.openDM=async function(id){
    await luxOriginalOpenDM(id);
    luxSubscribeDM();
    luxBindTyping();
    await luxMarkDMRead({refresh:false});
    luxRenderPresence();
};

const luxOriginalSetupRealtime=setupRealtime;
setupRealtime=function(){
    luxOriginalSetupRealtime();
    luxPresenceSetup();

    sb.channel("luxcord-desktop-"+session.user.id)
        .on("postgres_changes",{
            event:"INSERT",
            schema:"public",
            table:"notifications",
            filter:"user_id=eq."+session.user.id
        },async p=>{
            if(p.new?.notification_type!=="dm"||!settings.notifications||!("Notification"in window)||Notification.permission!=="granted")return;
            const data=p.new.notification_data||{};
            if(dm&&String(dm.id)===String(data.conversation_id)&&!$("dms-view")?.classList.contains("hidden"))return;
            const reg=await navigator.serviceWorker?.ready.catch(()=>null);
            if(reg)await reg.showNotification(
                p.new.notification_title||"New direct message",
                {
                    body:p.new.notification_body||"You received a message.",
                    tag:"luxcord-dm-"+(data.conversation_id||data.sender_id),
                    renotify:true,
                    data,
                    actions:[{action:"reply",title:"Reply"},{action:"open",title:"Open"}]
                }
            );
        })
        .subscribe();
};

document.addEventListener("visibilitychange",async()=>{
    if(!session)return;
    if(document.hidden){
        // A background tab is still an open tab, so keep presence tracked.
        luxSetTypingLabel("typing-label","");
        luxSetTypingLabel("dm-typing-label","");
    }else{
        if(luxPresenceChannel){
            await luxPresenceChannel.track({
                user_id:session.user.id,
                username:me?.display_name||me?.username||"User",
                tab_open:true
            });
        }
        await luxUpdateLastSeen();
        if(dm&&!$("dms-view")?.classList.contains("hidden"))await luxMarkDMRead();
        luxRenderPresence();
    }
});

window.addEventListener("pagehide",()=>{
    try{
        luxPresenceChannel?.untrack();
        if(luxDMChannel)sb.removeChannel(luxDMChannel);
        if(luxRoomChannel)sb.removeChannel(luxRoomChannel);
    }catch(_){}
});

luxRegisterNotifications();

if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", event => {
        if (event.data?.type !== "luxcord-notification") return;
        const data = event.data.data || {};
        if (data.sender_id) {
            window.openDM(data.sender_id).then(() => {
                if (event.data.action === "reply") {
                    setTimeout(() => $("dm-input")?.focus(), 150);
                }
            });
        }
    });
}

// =============================
// START
// =============================

boot();
