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

function avatarHTML(profile, className = "avatar") {
    const name = profile?.display_name || profile?.username || "User";
    const initial = esc(name[0]?.toUpperCase() || "?");
    if (profile?.avatar_url) {
        return '<div class="' + className + ' avatar-photo"><img src="' + esc(profile.avatar_url) + '" alt="' + esc(name) + '" loading="lazy"></div>';
    }
    return '<div class="' + className + '">' + initial + '</div>';
}


async function boot() {
    const result = await sb.auth.getSession();

    session = result.data.session;

    if (session) {
        await loadMe();

        renderMe();

        setupRealtime();
        await luxStartPresence();
        await luxStartTyping();

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
}


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
        $("me-avatar").innerHTML = avatarHTML(me, "avatar");
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

    $("dm-input")?.addEventListener(
        "input",
        () => luxTypingSend(true)
    );

    $("dm-input")?.addEventListener(
        "blur",
        () => luxTypingSend(false)
    );

    $("message-input")?.addEventListener(
        "blur",
        () => luxTypingSend(false)
    );

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

    const roomUserIds = [
        ...new Set(
            messages
                .map((message) => message.user_id)
                .filter(Boolean)
        )
    ];

    let roomProfiles = [];
    if (roomUserIds.length) {
        const profileResult = await sb
            .from("profiles")
            .select("id,username,display_name,avatar_url")
            .in("id", roomUserIds);
        roomProfiles = profileResult.data || [];
    }

    const roomProfileMap = Object.fromEntries(
        roomProfiles.map((profile) => [profile.id, profile])
    );

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

                        ${avatarHTML(roomProfileMap[message.user_id] || { display_name: message.name }, "message-avatar")}

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
    luxTypingSend(false);

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
                "id,username,display_name,status,avatar_url"
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

            ${avatarHTML(profile)}

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
    if (!session) {
        return;
    }

    const result = await sb
        .from("friendships")
        .select("*")
        .or(
            `requester.eq.${session.user.id},addressee.eq.${session.user.id}`
        )
        .eq("status", "accepted");

    const ids = [
        ...(result.data || []).map((friendship) =>
            friendship.requester === session.user.id
                ? friendship.addressee
                : friendship.requester
        )
    ];

    let profiles = [];

    if (ids.length) {
        const profileResult = await sb
            .from("profiles")
            .select("id,username,display_name")
            .in("id", ids);

        profiles = profileResult.data || [];
    }

    const dmListHTML =
        profiles
            .map((profile) => {
                const name =
                    profile.display_name ||
                    profile.username ||
                    "User";

                return `
                    <div
                        class="side-item"
                        data-dm-user-id="${profile.id}"
                        onclick="openDM('${profile.id}')"
                    >
                        ${avatarHTML(profile)}<span class="lux-online-dot" title="Offline">○</span>
                        <span>${esc(name)}</span>
                    </div>
                `;            })
            .join("") ||
        `
            <div
                class="muted"
                style="padding:10px"
            >
                Add friends to start DMs.
            </div>
        `;

    if ($("dm-people")) {
        $("dm-people").innerHTML = dmListHTML;
    }

    if ($("dm-people-main")) {
        $("dm-people-main").innerHTML = dmListHTML;
    }
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

    const targetProfile = await sb
        .from("profiles")
        .select("id,username,display_name,status,avatar_url")
        .eq("id", id)
        .maybeSingle();
    const dmProfile = targetProfile.data || { id, display_name: "User" };
    if ($("dm-conversation-name")) $("dm-conversation-name").textContent = dmProfile.display_name || dmProfile.username || "User";
    if ($("dm-conversation-status")) $("dm-conversation-status").textContent = dmProfile.status || "Direct message";
    if ($("dm-conversation-avatar")) $("dm-conversation-avatar").innerHTML = avatarHTML(dmProfile, "avatar");
    luxTypingContextChanged();

    view("dms");

    open("dm-messages");
    open("dm-composer");
    close("dm-empty");

    await refreshDM();
    await luxMarkDMRead();
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
                    "id,username,display_name,avatar_url"
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

                const avatar = user.avatar_url
                    ? '<div class="message-avatar avatar-photo"><img src="' + esc(user.avatar_url) + '" alt="' + esc(name) + '" loading="lazy"></div>'
                    : '<div class="message-avatar">' + esc(name[0]?.toUpperCase() || "?") + '</div>';

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
    >${avatar}</div>

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
        >${esc(message.message)}</div>

        <div class="dm-read-state" style="font-size:11px;opacity:.65;margin-top:2px;">${message.sender_id === session.user.id ? (message.read_at ? "Seen" : "Sent") : ""}</div>

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
        ><button
            onclick="reactDM(${message.id}, '❤️')"
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


async function sendDM() {
    if (!dm || !session) {
        return;
    }

    const input = $("dm-input");

    if (!input) {
        return;
    }

    const text =
        input.value.trim();

    if (!text) {
        return;
    }

    const result = await sb
        .from("dm_messages")
        .insert({
            conversation_id: dm.id,
            sender_id: session.user.id,
            message: text
        });

    if (result.error) {
        alert(result.error.message);
        return;
    }

    input.value = "";
    luxTypingSend(false);

    const target =
        dm.user_a === session.user.id
            ? dm.user_b
            : dm.user_a;

    await notify(
        target,
        "dm",
        "New direct message",
        `${me.display_name || me.username} sent you a message.`
    );

    await refreshDM();
}


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
    if ($("profile-avatar-file")) $("profile-avatar-file").value = "";

    open("profile-modal");
}


async function saveProfile() {
    const username = $("profile-username").value.trim().replace(/[^a-zA-Z0-9_.-]/g, "");
    if (username.length < 3) {
        $("profile-error").textContent = "Username must be at least 3 characters.";
        return;
    }
    let avatarUrl = me?.avatar_url || null;
    const file = $("profile-avatar-file")?.files?.[0];
    if (file) {
        if (!file.type.startsWith("image/")) {
            $("profile-error").textContent = "Please choose an image.";
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            $("profile-error").textContent = "Profile pictures must be 5 MB or smaller.";
            return;
        }
        const extension = (file.name.split(".").pop() || "jpg").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
        const path = "avatars/" + session.user.id + "-" + Date.now() + "." + extension;
        const upload = await sb.storage.from("luxcord-attachments").upload(path, file, { cacheControl: "3600", upsert: false });
        if (upload.error) {
            $("profile-error").textContent = upload.error.message;
            return;
        }
        avatarUrl = sb.storage.from("luxcord-attachments").getPublicUrl(path).data.publicUrl;
    }
    const result = await sb.from("profiles").update({
        username,
        display_name: $("profile-display-name").value.trim() || username,
        status: $("profile-status").value.trim() || "Online",
        bio: $("profile-bio").value.trim(),
        avatar_url: avatarUrl
    }).eq("id", session.user.id).select().single();
    if (result.error) {
        $("profile-error").textContent = result.error.message;
        return;
    }
    me = result.data;
    if ($("profile-avatar-file")) $("profile-avatar-file").value = "";
    renderMe();
    await loadFriends();
    await loadDMs();
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
// SIMPLE REALTIME TYPING
// =============================
let luxTypingChannel = null;
let luxTypingTimer = null;
const luxTypingUsers = new Map();
function luxTypingContext() {
    if (dm) return { kind: "dm", id: String(dm.id) };
    if (room) return { kind: "room", id: String(room) };
    return null;
}
function luxTypingRender() {
    const ctx = luxTypingContext();
    const label = ctx?.kind === "dm" ? $("dm-typing-label") : $("typing-label");
    const otherLabel = ctx?.kind === "dm" ? $("typing-label") : $("dm-typing-label");
    if (otherLabel) otherLabel.textContent = "";
    if (!label) return;
    const names = [];
    const now = Date.now();
    for (const [key, value] of luxTypingUsers) {
        if (now - value.at > 1800 || value.userId === session?.user?.id) {
            luxTypingUsers.delete(key);
            continue;
        }
        if (ctx && value.kind === ctx.kind && value.id === ctx.id) names.push(value.name || "Someone");
    }
    label.textContent = names.length === 0 ? "" : names.length === 1 ? names[0] + " is typing…" : names.slice(0, 2).join(" and ") + " are typing…";
}
function luxTypingContextChanged() {
    luxTypingUsers.clear();
    luxTypingRender();
}
async function luxTypingSend(typing) {
    if (!session || !luxTypingChannel) return;
    const ctx = luxTypingContext();
    if (!ctx) return;
    await luxTypingChannel.send({
        type: "broadcast",
        event: "typing",
        payload: {
            kind: ctx.kind,
            id: ctx.id,
            userId: session.user.id,
            name: me?.display_name || me?.username || "Someone",
            typing: !!typing
        }
    });
    if (typing) {
        clearTimeout(luxTypingTimer);
        luxTypingTimer = setTimeout(() => luxTypingSend(false), 1400);
    }
}
async function luxStartTyping() {
    if (!session) return;
    if (luxTypingChannel) await sb.removeChannel(luxTypingChannel);
    luxTypingChannel = sb.channel("luxcord-typing")
        .on("broadcast", { event: "typing" }, ({ payload }) => {
            if (!payload || payload.userId === session.user.id) return;
            const key = payload.kind + ":" + payload.id + ":" + payload.userId;
            if (payload.typing) {
                luxTypingUsers.set(key, {
                    kind: payload.kind,
                    id: String(payload.id),
                    userId: payload.userId,
                    name: payload.name,
                    at: Date.now()
                });
            } else {
                luxTypingUsers.delete(key);
            }
            luxTypingRender();
        })
        .subscribe();
}
// =============================
// DM READ + ONLINE PRESENCE
// =============================
let luxPresenceChannel = null;
let luxPresenceReady = false;
async function luxMarkDMRead() {
    if (!dm || !session) return;
    const result = await sb.rpc("mark_dm_messages_read", { p_conversation_id: dm.id });
    if (result.error) { console.warn("DM read receipt:", result.error.message); return; }
    await refreshDM(); await loadDMs();
}
function luxIsOnline(userId) {
    if (!luxPresenceChannel || !userId) return false;
    return Object.values(luxPresenceChannel.presenceState()).some(entries =>
        (entries || []).some(entry => String(entry?.user_id) === String(userId) && entry?.tab_open === true)
    );
}
function luxRenderOnline() {
    document.querySelectorAll("[data-dm-user-id]").forEach(item => {
        const dot = item.querySelector(".lux-online-dot"); if (!dot) return;
        const online = luxIsOnline(item.dataset.dmUserId);
        dot.textContent = online ? "●" : "○"; dot.title = online ? "Online now" : "Offline";
        dot.classList.toggle("online", online);
    });
}
async function luxStartPresence() {
    if (!session) return;
    if (luxPresenceChannel) await sb.removeChannel(luxPresenceChannel);
    const key = String(session.user.id) + "-" + Math.random().toString(36).slice(2);
    luxPresenceReady = false;
    luxPresenceChannel = sb.channel("luxcord-online", { config: { presence: { key } } })
        .on("presence", { event: "sync" }, luxRenderOnline)
        .on("presence", { event: "join" }, luxRenderOnline)
        .on("presence", { event: "leave" }, luxRenderOnline)
        .subscribe(async status => {
            if (status !== "SUBSCRIBED") return;
            luxPresenceReady = true;
            await luxPresenceChannel.track({ user_id: session.user.id, tab_open: true });
            luxRenderOnline();
        });
}
async function luxStopPresence() {
    if (!luxPresenceChannel) return;
    try { await luxPresenceChannel.untrack(); await sb.removeChannel(luxPresenceChannel); } catch (_) {}
    luxPresenceChannel = null; luxPresenceReady = false;
}
// =============================
// PRESENCE REFRESH
// =============================

setInterval(() => {
    if (room) {
        loadMembers();
    }
}, 4000);


// =============================
// DM LIVE FALLBACK
// =============================
setInterval(async () => {
    if (session && dm && !$("dms-view")?.classList.contains("hidden")) {
        await refreshDM(); await luxMarkDMRead();
    }
    luxRenderOnline();
}, 3000);

document.addEventListener("visibilitychange", async () => {
    if (!session || document.hidden) return;
    if (luxPresenceChannel && luxPresenceReady) await luxPresenceChannel.track({ user_id: session.user.id, tab_open: true });
    if (dm && !$("dms-view")?.classList.contains("hidden")) await luxMarkDMRead();
    luxRenderOnline();
});

window.addEventListener("pagehide", () => {
    luxTypingSend(false);
    luxStopPresence();
});

// =============================
// START
// =============================

boot();
