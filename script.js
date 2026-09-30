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
let groupChat = null;
let luxAvatarCrop = null;

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

const luxMentionState = new Map();

function hideMentionDropdown(dropdownId) {
    const dropdown = $(dropdownId);
    if (dropdown) {
        dropdown.innerHTML = "";
        dropdown.classList.add("hidden");
    }
}

async function updateMentionDropdown(inputId, dropdownId) {
    const input = $(inputId);
    const dropdown = $(dropdownId);
    if (!input || !dropdown) return;

    const before = input.value.slice(0, input.selectionStart ?? input.value.length);
    const match = before.match(/(?:^|\s)@([a-zA-Z0-9_.-]*)$/);
    if (!match) {
        hideMentionDropdown(dropdownId);
        return;
    }

    const query = match[1] || "";
    let request = sb.from("profiles")
        .select("id,username,display_name,avatar_url")
        .neq("id", session?.user?.id || "");

    if (query) {
        request = request.or("username.ilike.%" + query + "%,display_name.ilike.%" + query + "%");
    }

    const result = await request.order("username", { ascending: true }).limit(20);
    const profiles = result.data || [];

    if (!profiles.length) {
        dropdown.innerHTML = '<div class="mention-empty">No people found.</div>';
        dropdown.classList.remove("hidden");
        return;
    }

    luxMentionState.set(inputId, { start: before.length - query.length - 1 });

    dropdown.innerHTML = profiles.map(profile => {
        const name = profile.display_name || profile.username || "User";
        return '<button type="button" class="mention-option" data-mention-user="' +
            esc(profile.id) + '" data-mention-username="' + esc(profile.username || "") + '">' +
            avatarHTML(profile, "mention-avatar") +
            '<span class="mention-option-text"><b>' + esc(name) + '</b><small>@' +
            esc(profile.username || "user") + '</small></span></button>';
    }).join("");
    dropdown.classList.remove("hidden");
}

function chooseMention(inputId, dropdownId, userId, username) {
    const input = $(inputId);
    if (!input || !username) return;

    const state = luxMentionState.get(inputId);
    const cursor = input.selectionStart ?? input.value.length;
    const start = state?.start ?? cursor;

    input.value = input.value.slice(0, start) + "@" + username + " " + input.value.slice(cursor);
    const nextCursor = start + username.length + 2;
    input.focus();
    input.setSelectionRange(nextCursor, nextCursor);
    hideMentionDropdown(dropdownId);
    luxTypingSend(true);
}

function bindMentionInput(inputId, dropdownId) {
    const input = $(inputId);
    const dropdown = $(dropdownId);
    if (!input || !dropdown) return;

    input.addEventListener("input", () => updateMentionDropdown(inputId, dropdownId));
    input.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            hideMentionDropdown(dropdownId);
            return;
        }
        if (event.key === "Enter" && !event.shiftKey && !settings.enter_send && !dropdown.classList.contains("hidden")) {
            event.preventDefault();
            const first = dropdown.querySelector("[data-mention-user]");
            if (first) chooseMention(inputId, dropdownId, first.dataset.mentionUser, first.dataset.mentionUsername);
        }
    });

    dropdown.addEventListener("mousedown", (event) => {
        const option = event.target.closest("[data-mention-user]");
        if (!option) return;
        event.preventDefault();
        chooseMention(inputId, dropdownId, option.dataset.mentionUser, option.dataset.mentionUsername);
    });
}

async function loadMentionProfiles(messages) {
    const usernames = [...new Set(
        (messages || []).flatMap(message =>
            [...String(message.message || "").matchAll(/@([a-zA-Z0-9_.-]{3,32})/g)].map(match => match[1])
        )
    )];
    if (!usernames.length) return new Map();

    const result = await sb.from("profiles")
        .select("id,username,display_name,avatar_url")
        .in("username", usernames);

    return new Map((result.data || []).map(profile => [String(profile.username).toLowerCase(), profile]));
}

function renderMentionText(value, mentionMap) {
    const text = String(value ?? "");
    if (!mentionMap?.size) return esc(text);

    const regex = /@([a-zA-Z0-9_.-]{3,32})/g;
    let output = "";
    let last = 0;
    let match;

    while ((match = regex.exec(text))) {
        output += esc(text.slice(last, match.index));
        const profile = mentionMap.get(match[1].toLowerCase());
        if (profile) {
            output += '<span class="mention-link" onclick="openUserProfile(\'' +
                esc(profile.id) + '\')">@' + esc(profile.username) + '</span>';
        } else {
            output += esc(match[0]);
        }
        last = regex.lastIndex;
    }

    return output + esc(text.slice(last));
}


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
            loadGroupChats(),
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
        (event) => {
            event.stopPropagation();
            const panel = $("notification-panel");
            if (!panel) return;
            if (panel.classList.contains("hidden")) {
                open("notification-panel");
                loadNotifications();
            } else {
                close("notification-panel");
            }
        }
    );

    $("notification-panel")?.addEventListener("click", (event) => {
        event.stopPropagation();
    });

    document.addEventListener("click", () => close("notification-panel"));

    $("clear-notifications")?.addEventListener(
        "click",
        clearNotifications
    );

    $("new-room")?.addEventListener(
        "click",
        createRoom
    );

    $("new-group-chat")?.addEventListener("click", openGroupCreateModal);
    $("group-create-cancel")?.addEventListener("click", () => close("group-create-modal"));

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

    $("save-user-profile-notes")?.addEventListener("click", saveUserProfileNotes);

    $("add-profile-friend")?.addEventListener("click", addProfileFriend);

    $("profile-avatar-file")?.addEventListener("change", (event) => {
        const file = event.target.files?.[0];
        if (file) openAvatarCrop(file);
    });

    $("avatar-crop-zoom")?.addEventListener("input", (event) => {
        setAvatarCropZoom(event.target.value);
    });

    $("avatar-crop-apply")?.addEventListener("click", applyAvatarCrop);
    $("avatar-crop-cancel")?.addEventListener("click", cancelAvatarCrop);
    $("avatar-crop-cancel-2")?.addEventListener("click", cancelAvatarCrop);

    const cropCanvas = $("avatar-crop-canvas");
    cropCanvas?.addEventListener("pointerdown", (event) => {
        if (!luxAvatarCrop) return;
        luxAvatarCrop.dragging = true;
        luxAvatarCrop.startX = event.clientX;
        luxAvatarCrop.startY = event.clientY;
        luxAvatarCrop.originX = luxAvatarCrop.x;
        luxAvatarCrop.originY = luxAvatarCrop.y;
        cropCanvas.setPointerCapture(event.pointerId);
    });
    cropCanvas?.addEventListener("pointermove", (event) => {
        if (!luxAvatarCrop?.dragging) return;
        luxAvatarCrop.x = luxAvatarCrop.originX + event.clientX - luxAvatarCrop.startX;
        luxAvatarCrop.y = luxAvatarCrop.originY + event.clientY - luxAvatarCrop.startY;
        clampAvatarCrop();
        drawAvatarCrop();
    });
    cropCanvas?.addEventListener("pointerup", () => {
        if (luxAvatarCrop) luxAvatarCrop.dragging = false;
    });
    cropCanvas?.addEventListener("pointercancel", () => {
        if (luxAvatarCrop) luxAvatarCrop.dragging = false;
    });

    $("save-settings")?.addEventListener(
        "click",
        saveSettings
    );

    $("dm-send")?.addEventListener(
        "click",
        sendDM
    );

    bindMentionInput("message-input", "room-mention-dropdown");
    bindMentionInput("dm-input", "dm-mention-dropdown");

    $("dm-attach")?.addEventListener("click", () => $("dm-file")?.click());
    $("dm-file")?.addEventListener("change", () => $("dm-input")?.focus());

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
        loadGroupChats();
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
    const roomMentionProfiles = await loadMentionProfiles(messages);

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
            .select("id,username,display_name,status,bio,avatar_url")
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

                        <span class="clickable-avatar" onclick="openUserProfile('${message.user_id}')">${avatarHTML(roomProfileMap[message.user_id] || { display_name: message.name }, "message-avatar")}</span>

                        <div class="message-body">

                            <div class="message-head">
                                <b class="clickable-name" onclick="openUserProfile('${message.user_id}')">
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
                                ${renderMentionText(message.message, roomMentionProfiles)}
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
                                onclick="event.stopPropagation(); openDM('${id}')"
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
        <div class="person-card" onclick="openUserProfile('${profile.id}')">

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
    if (!session) return;

    const result = await sb.from("friendships")
        .select("*")
        .or(`requester.eq.${session.user.id},addressee.eq.${session.user.id}`)
        .eq("status", "accepted");

    const ids = [...new Set((result.data || []).map((friendship) =>
        friendship.requester === session.user.id ? friendship.addressee : friendship.requester
    ))];

    let profiles = [];
    if (ids.length) {
        const profileResult = await sb.from("profiles")
            .select("id,username,display_name,bio,avatar_url")
            .in("id", ids);
        profiles = profileResult.data || [];
    }

    const dmListHTML = profiles.map((profile) => {
        const name = profile.display_name || profile.username || "User";
        return `
            <div class="side-item" data-dm-user-id="${esc(profile.id)}" onclick="openDM('${esc(profile.id)}')">
                <span onclick="event.stopPropagation(); openUserProfile('${esc(profile.id)}')" class="clickable-avatar">${avatarHTML(profile)}</span>
                <span class="lux-online-dot" title="Offline">○</span>
                <span onclick="event.stopPropagation(); openUserProfile('${esc(profile.id)}')" class="clickable-name">${esc(name)}</span>
            </div>
        `;
    }).join("") || '<div class="muted" style="padding:10px">Add friends to start DMs.</div>';

    if ($("dm-people")) $("dm-people").innerHTML = dmListHTML;
    luxRenderOnline();
}

async function loadGroupChats() {
    if (!session || !$("group-people")) return;

    const memberships = await sb.from("group_members").select("group_id").eq("user_id", session.user.id);
    if (memberships.error) {
        $("group-people").innerHTML = '<div class="muted group-empty">Run the group chat SQL setup first.</div>';
        return;
    }

    const groupIds = [...new Set((memberships.data || []).map((row) => row.group_id))];
    if (!groupIds.length) {
        $("group-people").innerHTML = '<div class="muted group-empty">No group chats yet.</div>';
        return;
    }

    const groupsResult = await sb.from("group_conversations")
        .select("id,name,created_by")
        .in("id", groupIds)
        .order("created_at", { ascending: false });

    if (groupsResult.error) {
        $("group-people").innerHTML = '<div class="muted group-empty">Run the group chat SQL setup first.</div>';
        return;
    }

    const countResult = await sb.from("group_members").select("group_id").in("group_id", groupIds);
    const counts = {};
    (countResult.data || []).forEach((row) => { counts[row.group_id] = (counts[row.group_id] || 0) + 1; });

    $("group-people").innerHTML = (groupsResult.data || []).map((group) => `
        <div class="side-item group-side-item" onclick="openGroupChat('${esc(group.id)}')">
            <span class="group-icon">#</span>
            <span class="group-side-name">${esc(group.name)}</span>
            <span class="group-side-count">${counts[group.id] || 0}</span>
        </div>
    `).join("") || '<div class="muted group-empty">No group chats yet.</div>';
}

async function openGroupCreateModal() {
    if (!session) return;

    const list = $("group-create-friends");
    if (!list) return;

    $("group-create-name").value = "";
    $("group-create-error").textContent = "";
    $("group-create-selected").textContent = "0 selected";
    list.innerHTML = '<div class="muted">Loading friends...</div>';
    open("group-create-modal");

    const result = await sb.from("friendships")
        .select("*")
        .or(`requester.eq.${session.user.id},addressee.eq.${session.user.id}`)
        .eq("status", "accepted");

    const ids = [...new Set((result.data || []).map((friendship) =>
        friendship.requester === session.user.id ? friendship.addressee : friendship.requester
    ))];

    if (result.error || !ids.length) {
        list.innerHTML = '<div class="muted">Add some friends first.</div>';
        return;
    }

    const profiles = await sb.from("profiles")
        .select("id,username,display_name,avatar_url")
        .in("id", ids)
        .order("username", { ascending: true });

    if (profiles.error) {
        list.innerHTML = '<div class="muted">Could not load your friends.</div>';
        return;
    }

    list.innerHTML = (profiles.data || []).map((profile) => {
        const name = profile.display_name || profile.username || "User";
        return '<label class="group-friend-option">' +
            '<input type="checkbox" value="' + esc(profile.id) + '">' +
            avatarHTML(profile, "group-friend-avatar") +
            '<span><b>' + esc(name) + '</b><small>@' + esc(profile.username || "user") + '</small></span>' +
            '</label>';
    }).join("") || '<div class="muted">Add some friends first.</div>';

    list.querySelectorAll('input[type="checkbox"]').forEach((input) => {
        input.addEventListener("change", () => {
            const count = list.querySelectorAll('input[type="checkbox"]:checked').length;
            $("group-create-selected").textContent = count + (count === 1 ? " selected" : " selected");
        });
    });
}

async function createGroupChat() {
    if (!session) return;

    const name = $("group-create-name")?.value.trim();
    const list = $("group-create-friends");
    const error = $("group-create-error");
    const selected = [...(list?.querySelectorAll('input[type="checkbox"]:checked') || [])].map((input) => input.value);

    if (!name) {
        error.textContent = "Enter a group name.";
        return;
    }

    if (!selected.length) {
        error.textContent = "Select at least one friend.";
        return;
    }

    error.textContent = "";
    $("group-create-submit").disabled = true;
    $("group-create-submit").textContent = "Creating...";

    const groupResult = await sb.from("group_conversations")
        .insert({ name: name.slice(0, 80), created_by: session.user.id })
        .select()
        .single();

    if (groupResult.error) {
        error.textContent = groupResult.error.message;
        $("group-create-submit").disabled = false;
        $("group-create-submit").textContent = "Create group";
        return;
    }

    const memberIds = [...new Set([session.user.id, ...selected])];
    const memberResult = await sb.from("group_members").insert(memberIds.map((userId) => ({
        group_id: groupResult.data.id,
        user_id: userId,
        added_by: session.user.id
    })));

    if (memberResult.error) {
        error.textContent = memberResult.error.message;
        $("group-create-submit").disabled = false;
        $("group-create-submit").textContent = "Create group";
        return;
    }

    close("group-create-modal");
    $("group-create-submit").disabled = false;
    $("group-create-submit").textContent = "Create group";
    await loadGroupChats();
    await openGroupChat(groupResult.data.id);
}

window.openDM = async function (id) {
    if (!session) return;

    const users = [session.user.id, id].sort();
    let result = await sb.from("dm_conversations").select("*")
        .eq("user_a", users[0]).eq("user_b", users[1]).maybeSingle();

    if (!result.data) {
        result = await sb.from("dm_conversations")
            .insert({ user_a: users[0], user_b: users[1] }).select().single();
    }

    if (result.error) {
        alert(result.error.message);
        return;
    }

    dm = result.data;
    groupChat = null;
    close("group-members-panel");
    close("dm-reply-bar");
    open("dm-conversation-head");
    $("dm-attach").style.display = "";
    $("dm-input").placeholder = "Message...";

    const targetProfile = await sb.from("profiles")
        .select("id,username,display_name,status,bio,avatar_url").eq("id", id).maybeSingle();
    const dmProfile = targetProfile.data || { id, display_name: "User" };

    $("dm-conversation-name").textContent = dmProfile.display_name || dmProfile.username || "User";
    $("dm-conversation-status").textContent = luxIsOnline(id) ? "Online now" : "Direct message";
    $("dm-conversation-avatar").innerHTML = avatarHTML(dmProfile, "avatar");
    $("dm-conversation-avatar").onclick = () => openUserProfile(id);
    $("dm-conversation-avatar").style.cursor = "pointer";
    $("dm-conversation-name").onclick = () => openUserProfile(id);
    $("dm-conversation-name").style.cursor = "pointer";

    luxTypingContextChanged();
    view("dms");
    open("dm-messages");
    open("dm-composer");
    close("dm-empty");

    await refreshDM();
    await luxMarkDMRead();
};

window.openGroupChat = async function (id) {
    if (!session || !id) return;

    const result = await sb.from("group_conversations").select("id,name,created_by").eq("id", id).maybeSingle();
    if (result.error || !result.data) {
        alert(result.error?.message || "Group chat not found.");
        return;
    }

    const membership = await sb.from("group_members").select("group_id")
        .eq("group_id", id).eq("user_id", session.user.id).maybeSingle();
    if (membership.error || !membership.data) {
        alert("You are not a member of this group.");
        return;
    }

    groupChat = result.data;
    dm = null;
    close("dm-empty");
    close("dm-reply-bar");
    open("dm-conversation-head");
    open("dm-messages");
    open("dm-composer");
    open("group-members-panel");
    $("dm-attach").style.display = "none";
    $("dm-file").value = "";
    $("dm-input").placeholder = "Message the group...";
    $("dm-conversation-name").textContent = groupChat.name;
    $("dm-conversation-status").textContent = "Group chat";
    $("dm-conversation-avatar").textContent = "#";
    $("dm-conversation-avatar").onclick = null;
    $("dm-conversation-avatar").style.cursor = "default";
    $("dm-conversation-name").onclick = null;
    $("dm-conversation-name").style.cursor = "default";

    luxTypingContextChanged();
    view("dms");
    await refreshGroupChat();
    await loadGroupMembers(id);
};

async function loadGroupMembers(groupId) {
    if (!groupId || !$("group-members")) return;

    const membersResult = await sb.from("group_members").select("user_id").eq("group_id", groupId);
    const memberIds = (membersResult.data || []).map((row) => row.user_id);
    const profileResult = memberIds.length
        ? await sb.from("profiles").select("id,username,display_name,avatar_url").in("id", memberIds)
        : { data: [] };
    const profileMap = Object.fromEntries((profileResult.data || []).map((profile) => [profile.id, profile]));

    $("group-member-count").textContent = memberIds.length + (memberIds.length === 1 ? " member" : " members");
    $("group-members").innerHTML = memberIds.map((id) => {
        const profile = profileMap[id] || { id, display_name: "User" };
        const online = luxIsOnline(id);
        return `
            <div class="group-member-row" data-group-member-id="${esc(id)}" onclick="openUserProfile('${esc(id)}')">
                ${avatarHTML(profile, "group-member-avatar")}
                <div class="group-member-info">
                    <b>${esc(profile.display_name || profile.username || "User")}</b>
                    <span data-group-member-status="${esc(id)}">${online ? "Online now" : "Offline"}</span>
                </div>
                <i class="group-online-dot ${online ? "online" : ""}" data-group-member-dot="${esc(id)}" title="${online ? "Online now" : "Offline"}"></i>
            </div>
        `;
    }).join("") || '<div class="muted" style="padding:10px">No members.</div>';
}

let dmRefreshing = false;

async function refreshDM() {
    if (groupChat) return refreshGroupChat();
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
        const dmMentionProfiles = await loadMentionProfiles(messages);

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
    onclick="openUserProfile('${message.sender_id}')">${avatar}</div>

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
        onclick="openUserProfile('${message.sender_id}')" class="clickable-name">${esc(name)}</b><time
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
        >${renderMentionText(message.message, dmMentionProfiles)}</div>

        ${message.attachment_url ? ("<a class=\"message-attachment-file\" href=\"" + esc(message.attachment_url) + "\" target=\"_blank\" rel=\"noopener\">📎 " + esc(message.attachment_name || "Download attachment") + "</a>") : ""}

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


async function uploadDMFile(file) {
    if (!session || !dm || !file) return null;
    if (file.size > 25 * 1024 * 1024) { alert("Files must be 25 MB or smaller."); return null; }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = "chat/" + session.user.id + "/" + Date.now() + "-" + safeName;
    const upload = await sb.storage.from("luxcord-attachments").upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || "application/octet-stream" });
    if (upload.error) { alert(upload.error.message); return null; }
    return { url: sb.storage.from("luxcord-attachments").getPublicUrl(path).data.publicUrl, name: file.name };
}

async function sendDM() {
    if (groupChat) return sendGroupMessage();
    if (!dm || !session) {
        return;
    }

    const input = $("dm-input");

    if (!input) {
        return;
    }

    const text = input.value.trim();
    const fileInput = $("dm-file");
    const file = fileInput?.files?.[0] || null;
    if (!text && !file) return;

    let attachment = null;
    if (file) {
        attachment = await uploadDMFile(file);
        if (!attachment) return;
    }

    const result = await sb
        .from("dm_messages")
        .insert({
            conversation_id: dm.id,
            sender_id: session.user.id,
            message: text || attachment?.name || "Attachment",
            attachment_url: attachment?.url || null,
            attachment_name: attachment?.name || null
        });

    if (result.error) {
        alert(result.error.message);
        return;
    }

    input.value = "";
    if (fileInput) fileInput.value = "";
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


async function refreshGroupChat() {
    if (!groupChat || !session || dmRefreshing) return;
    dmRefreshing = true;
    try {
        const result = await sb.from("group_messages").select("*")
            .eq("group_id", groupChat.id).order("created_at", { ascending: true });
        if (result.error) {
            console.error("Group message load error:", result.error);
            return;
        }

        const messages = result.data || [];
        const mentionProfiles = await loadMentionProfiles(messages);
        const senderIds = [...new Set(messages.map((message) => message.sender_id).filter(Boolean))];
        const profileResult = senderIds.length
            ? await sb.from("profiles").select("id,username,display_name,avatar_url").in("id", senderIds)
            : { data: [] };
        const profileMap = Object.fromEntries((profileResult.data || []).map((profile) => [profile.id, profile]));
        const container = $("dm-messages");
        if (!container) return;

        const wasNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150;
        container.innerHTML = messages.map((message) => {
            const user = profileMap[message.sender_id] || {};
            const name = user.display_name || user.username || "User";
            const time = new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            return `
                <article class="message" style="display:grid;grid-template-columns:36px minmax(0,1fr);gap:10px;width:100%;margin:0 0 9px;padding:7px 9px;align-items:start">
                    <div class="message-avatar" style="grid-column:1;grid-row:1;width:36px;height:36px;min-width:36px" onclick="openUserProfile('${esc(message.sender_id)}')">${avatarHTML(user, "message-avatar")}</div>
                    <div class="message-body" style="grid-column:2;grid-row:1;min-width:0">
                        <div class="message-head"><b class="clickable-name" onclick="openUserProfile('${esc(message.sender_id)}')">${esc(name)}</b><time>${esc(time)}</time></div>
                        <div class="message-text">${renderMentionText(message.message, mentionProfiles)}</div>
                    </div>
                </article>
            `;
        }).join("");

        if (wasNearBottom || messages.length <= 1) container.scrollTop = container.scrollHeight;
    } finally {
        dmRefreshing = false;
    }
}

async function sendGroupMessage() {
    if (!groupChat || !session) return;
    const input = $("dm-input");
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    const result = await sb.from("group_messages").insert({
        group_id: groupChat.id,
        sender_id: session.user.id,
        message: text
    });

    if (result.error) {
        alert(result.error.message);
        return;
    }

    input.value = "";
    luxTypingSend(false);
    await refreshGroupChat();
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


async function openUserProfile(userId) {
    if (!session || !userId || String(userId) === String(session.user.id)) return;
    const result = await sb.from("profiles").select("id,username,display_name,status,bio,avatar_url,last_seen_at").eq("id", userId).maybeSingle();
    if (result.error || !result.data) { alert(result.error?.message || "Profile not found."); return; }
    const profile = result.data;
    $("user-profile-avatar").innerHTML = avatarHTML(profile, "profile-popup-avatar");
    $("user-profile-name").textContent = profile.display_name || profile.username || "User";
    $("user-profile-username").textContent = "@" + (profile.username || "user");
    const profileOnline = luxIsOnline(profile.id);
    $("user-profile-status").dataset.profileStatusUserId = profile.id;
    $("user-profile-status").className = "user-profile-status";
    $("user-profile-status").textContent = profileOnline ? "Online now" : "Offline";
    $("user-profile-bio").textContent = profile.bio || "No bio yet.";
    const notes = await sb.from("profile_notes").select("notes").eq("user_id", session.user.id).eq("profile_id", userId).maybeSingle();
    $("user-profile-notes").value = notes.data?.notes || "";
    $("user-profile-notes-status").textContent = "";

    const friendButton = $("add-profile-friend");
    const friendStatus = $("add-profile-friend-status");
    if (friendButton && friendStatus) {
        friendButton.disabled = true;
        friendButton.textContent = "Loading...";
        friendStatus.textContent = "";

        const friendship = await sb
            .from("friendships")
            .select("id,requester,addressee,status")
            .or(`and(requester.eq.${session.user.id},addressee.eq.${userId}),and(requester.eq.${userId},addressee.eq.${session.user.id})`)
            .maybeSingle();

        friendButton.disabled = false;
        friendButton.dataset.profileId = userId;

        if (friendship.data?.status === "accepted") {
            friendButton.textContent = "Friends";
            friendButton.disabled = true;
            delete friendButton.dataset.friendshipId;
        } else if (friendship.data?.requester === session.user.id) {
            friendButton.textContent = "Cancel Request";
            friendButton.disabled = false;
            friendButton.dataset.friendshipId = friendship.data.id;
            friendButton.dataset.requester = "true";
        } else if (friendship.data?.addressee === session.user.id) {
            friendButton.textContent = "Accept Request";
            friendButton.disabled = false;
            friendButton.dataset.friendshipId = friendship.data.id;
        } else {
            friendButton.textContent = "Add Friend";
        }
    }

    $("user-profile-modal").dataset.profileId = userId;
    open("user-profile-modal");
}

async function addProfileFriend() {
    if (!session) return;

    const button = $("add-profile-friend");
    const status = $("add-profile-friend-status");
    const profileId = button?.dataset.profileId;
    const friendshipId = button?.dataset.friendshipId;
    const isRequester = button?.dataset.requester === "true";
    if (!button || !profileId) return;

    button.disabled = true;
    status.textContent = "";

    if (friendshipId && isRequester) {
        const cancelled = await sb
            .from("friendships")
            .delete()
            .eq("id", friendshipId)
            .eq("requester", session.user.id)
            .eq("addressee", profileId);

        if (cancelled.error) {
            status.textContent = cancelled.error.message;
            button.disabled = false;
            return;
        }

        delete button.dataset.friendshipId;
        delete button.dataset.requester;
        button.textContent = "Add Friend";
        button.disabled = false;
        status.textContent = "Friend request cancelled.";
        await loadFriends();
        return;
    }

    if (friendshipId) {
        const accepted = await sb
            .from("friendships")
            .update({ status: "accepted" })
            .eq("id", friendshipId)
            .eq("addressee", session.user.id)
            .select()
            .single();

        if (accepted.error) {
            status.textContent = accepted.error.message;
            button.disabled = false;
            return;
        }

        await notify(
            accepted.data.requester,
            "friend_accept",
            "Friend request accepted",
            `${me.username} accepted your friend request.`
        );

        delete button.dataset.friendshipId;
        delete button.dataset.requester;
        button.textContent = "Friends";
        status.textContent = "Friend request accepted.";
        await loadFriends();
        return;
    }

    const existing = await sb
        .from("friendships")
        .select("id,requester,addressee,status")
        .or(
            `and(requester.eq.${session.user.id},addressee.eq.${profileId}),and(requester.eq.${profileId},addressee.eq.${session.user.id})`
        )
        .maybeSingle();

    if (existing.error) {
        status.textContent = existing.error.message;
        button.disabled = false;
        return;
    }

    if (existing.data) {
        button.dataset.friendshipId = existing.data.id;

        if (existing.data.status === "accepted") {
            button.textContent = "Friends";
            button.disabled = true;
            delete button.dataset.requester;
        } else if (existing.data.requester === session.user.id) {
            button.textContent = "Cancel Request";
            button.disabled = false;
            button.dataset.requester = "true";
        } else {
            button.textContent = "Accept Request";
            button.disabled = false;
        }
        return;
    }

    const result = await sb
        .from("friendships")
        .insert({
            requester: session.user.id,
            addressee: profileId
        })
        .select()
        .single();

    if (result.error) {
        status.textContent = result.error.message;
        button.disabled = false;
        return;
    }

    await notify(
        profileId,
        "friend_request",
        "New friend request",
        `${me.username} sent you a friend request.`
    );

    button.dataset.friendshipId = result.data.id;
    button.dataset.requester = "true";
    button.textContent = "Cancel Request";
    button.disabled = false;
    status.textContent = "Friend request sent.";
};
async function saveUserProfileNotes() {
    const profileId = $("user-profile-modal")?.dataset.profileId;
    if (!session || !profileId) return;
    const notes = $("user-profile-notes").value.slice(0, 5000);
    const result = await sb.from("profile_notes").upsert({ user_id: session.user.id, profile_id: profileId, notes }, { onConflict: "user_id,profile_id" });
    if (result.error) { $("user-profile-notes-status").textContent = result.error.message; return; }
    $("user-profile-notes-status").textContent = "Saved";
}
// =============================
// AVATAR CROPPER
// =============================

function openAvatarCrop(file) {
    if (!file || !file.type.startsWith("image/")) return;
    if (file.size > 5 * 1024 * 1024) {
        $("profile-error").textContent = "Profile pictures must be 5 MB or smaller.";
        return;
    }

    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
        const canvas = $("avatar-crop-canvas");
        const ctx = canvas.getContext("2d");
        const size = 420;
        const fit = Math.max(size / image.width, size / image.height);
        luxAvatarCrop = {
            file,
            url,
            image,
            ctx,
            size,
            baseScale: fit,
            zoom: 1,
            x: size / 2,
            y: size / 2,
            dragging: false,
            startX: 0,
            startY: 0,
            originX: 0,
            originY: 0
        };
        $("avatar-crop-zoom").value = "100";
        $("avatar-crop-zoom-value").textContent = "100%";
        open("avatar-crop-modal");
        drawAvatarCrop();
    };
    image.onerror = () => {
        URL.revokeObjectURL(url);
        $("profile-error").textContent = "That image could not be opened.";
    };
    image.src = url;
}

function drawAvatarCrop() {
    if (!luxAvatarCrop) return;
    const {ctx, size, image, baseScale, zoom, x, y} = luxAvatarCrop;
    const scale = baseScale * zoom;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "#080a10";
    ctx.fillRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(
        image,
        x - image.width * scale / 2,
        y - image.height * scale / 2,
        image.width * scale,
        image.height * scale
    );
    ctx.restore();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 3, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,.9)";
    ctx.lineWidth = 3;
    ctx.stroke();
}

function clampAvatarCrop() {
    if (!luxAvatarCrop) return;
    const {image, baseScale, zoom, size} = luxAvatarCrop;
    const scale = baseScale * zoom;
    const halfW = image.width * scale / 2;
    const halfH = image.height * scale / 2;
    const radius = size / 2 - 4;
    luxAvatarCrop.x = Math.min(size - radius + halfW, Math.max(radius - halfW, luxAvatarCrop.x));
    luxAvatarCrop.y = Math.min(size - radius + halfH, Math.max(radius - halfH, luxAvatarCrop.y));
}

function setAvatarCropZoom(value) {
    if (!luxAvatarCrop) return;
    const oldScale = luxAvatarCrop.baseScale * luxAvatarCrop.zoom;
    const newZoom = Number(value) / 100;
    const newScale = luxAvatarCrop.baseScale * newZoom;
    const center = luxAvatarCrop.size / 2;
    const ratio = newScale / oldScale;
    luxAvatarCrop.x = center + (luxAvatarCrop.x - center) * ratio;
    luxAvatarCrop.y = center + (luxAvatarCrop.y - center) * ratio;
    luxAvatarCrop.zoom = newZoom;
    clampAvatarCrop();
    $("avatar-crop-zoom-value").textContent = value + "%";
    drawAvatarCrop();
}

function cancelAvatarCrop() {
    if (luxAvatarCrop?.url) URL.revokeObjectURL(luxAvatarCrop.url);
    luxAvatarCrop = null;
    close("avatar-crop-modal");
    if ($("profile-avatar-file")) $("profile-avatar-file").value = "";
}

async function applyAvatarCrop() {
    if (!luxAvatarCrop) return;
    const crop = luxAvatarCrop;
    const out = document.createElement("canvas");
    out.width = 512;
    out.height = 512;
    const ctx = out.getContext("2d");
    const scale = crop.baseScale * crop.zoom;
    const factor = 512 / crop.size;
    ctx.beginPath();
    ctx.arc(256, 256, 256, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(
        crop.image,
        (crop.x - crop.image.width * scale / 2) * factor,
        (crop.y - crop.image.height * scale / 2) * factor,
        crop.image.width * scale * factor,
        crop.image.height * scale * factor
    );

    out.toBlob(async (blob) => {
        if (!blob) return;
        const croppedFile = new File([blob], "profile-picture.png", {type: "image/png"});
        if ($("profile-avatar-file")) {
            const transfer = new DataTransfer();
            transfer.items.add(croppedFile);
            $("profile-avatar-file").files = transfer.files;
        }
        URL.revokeObjectURL(crop.url);
        luxAvatarCrop = null;
        close("avatar-crop-modal");
        $("profile-error").textContent = "Cropped photo ready. Click Save profile.";
    }, "image/png");
}

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
        const path = "avatars/" + session.user.id + "-" + Date.now() + ".png";
        const upload = await sb.storage.from("luxcord-attachments").upload(path, file, {
            cacheControl: "3600",
            upsert: false,
            contentType: "image/png"
        });
        if (upload.error) {
            $("profile-error").textContent = upload.error.message;
            return;
        }
        avatarUrl = sb.storage.from("luxcord-attachments").getPublicUrl(path).data.publicUrl;
    }
    const result = await sb.from("profiles").update({
        username,
        display_name: $("profile-display-name").value.trim() || username,
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

        // GROUP MESSAGES
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "group_messages" }, (payload) => {
            if (groupChat && String(payload.new?.group_id) === String(groupChat.id)) refreshGroupChat();
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "group_members" }, (payload) => {
            const groupId = payload.new?.group_id || payload.old?.group_id;
            if (groupChat && String(groupId) === String(groupChat.id)) loadGroupMembers(groupChat.id);
            loadGroupChats();
        })

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
    if (groupChat) return { kind: "group", id: String(groupChat.id) };
    if (dm) return { kind: "dm", id: String(dm.id) };
    if (room) return { kind: "room", id: String(room) };
    return null;
}
function luxTypingRender() {
    const ctx = luxTypingContext();
    const label = (ctx?.kind === "dm" || ctx?.kind === "group") ? $("dm-typing-label") : $("typing-label");
    const otherLabel = (ctx?.kind === "dm" || ctx?.kind === "group") ? $("typing-label") : $("dm-typing-label");
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
    if (!dm || !session || groupChat) return;
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
        dot.textContent = online ? "●" : "○";
        dot.title = online ? "Online now" : "Offline";
        dot.classList.toggle("online", online);
    });

    document.querySelectorAll("[data-group-member-id]").forEach(item => {
        const id = item.dataset.groupMemberId;
        const online = luxIsOnline(id);
        const status = item.querySelector("[data-group-member-status]");
        const dot = item.querySelector("[data-group-member-dot]");
        if (status) status.textContent = online ? "Online now" : "Offline";
        if (dot) { dot.classList.toggle("online", online); dot.title = online ? "Online now" : "Offline"; }
    });

    document.querySelectorAll("[data-profile-status-user-id]").forEach(item => {
        const online = luxIsOnline(item.dataset.profileStatusUserId);
        item.textContent = online ? "Online now" : "Offline";
        item.classList.toggle("online", online);
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
    if (session && (dm || groupChat) && !$("dms-view")?.classList.contains("hidden")) {
        await refreshDM();
        await luxMarkDMRead();
        if (groupChat) await loadGroupMembers(groupChat.id);
    }
    luxRenderOnline();
}, 3000);

document.addEventListener("visibilitychange", async () => {
    if (!session || document.hidden) return;
    if (luxPresenceChannel && luxPresenceReady) await luxPresenceChannel.track({ user_id: session.user.id, tab_open: true });
    if (dm && !$("dms-view")?.classList.contains("hidden")) await luxMarkDMRead();
    if (groupChat && !$("dms-view")?.classList.contains("hidden")) await loadGroupMembers(groupChat.id);
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
