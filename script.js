const SUPABASE_URL = "https://mvgqpkdldciwzqgpayoo.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12Z3Fwa2RsZGNpd3pxZ3BheW9vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2ODkzMTAsImV4cCI6MjEwNjI2NTMxMH0.7VSGwqyucBwdDCZzlS_xCLdLhEQaN3laJBYYDmGnN08";

// FIXED: Explicitly grab createClient from the window object to stop the crash
const { createClient } = window.supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);

const urlParams = new URLSearchParams(window.location.search);
const username = urlParams.get('name');
const currentRoom = urlParams.get('room');

let audio = new Audio("https://code.org");

const chatDisplay = document.getElementById("chat-display");
const messageInput = document.getElementById("message-input");
const typingLabel = document.getElementById("typing-label");
const charCounter = document.getElementById("char-counter");

if (!username || !currentRoom) {
    window.location.href = "index.html";
} else {
    document.getElementById("room-display").innerText = "Room: " + currentRoom;
    setupChatRoom();
}

async function setupChatRoom() {
    const now = Date.now();

    await supabaseClient.from('user_status').upsert({
        room: currentRoom,
        name: username,
        last_active: now,
        is_typing: false,
        typing_timestamp: 0
    }, { onConflict: 'room,name' });

    setInterval(async () => {
        await supabaseClient.from('user_status').update({ last_active: Date.now() }).eq('room', currentRoom).eq('name', username);
    }, 5000);

    const { data: messages } = await supabaseClient.from('chat_messages').select('*').eq('room', currentRoom).order('id', { ascending: true });
    if (messages) {
        messages.forEach(msg => appendMessage(msg));
    }

    supabaseClient.channel('messages-channel')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room=eq.${currentRoom}` }, payload => {
            appendMessage(payload.new);
            if (payload.new.name !== username) {
                audio.play().catch(() => {});
            }
        })
        .subscribe();

    supabaseClient.channel('status-channel')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'user_status', filter: `room=eq.${currentRoom}` }, () => {
            updateStatusDisplay();
        })
        .subscribe();

    updateStatusDisplay();
}

function appendMessage(msg) {
    const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    chatDisplay.innerHTML += `[${time}] <b>${msg.name}</b>: ${msg.message}\n`;
    chatDisplay.scrollTop = chatDisplay.scrollHeight;
}

async function updateStatusDisplay() {
    const { data: users } = await supabaseClient.from('user_status').select('*').eq('room', currentRoom);
    if (!users) return;

    let typers = [];
    const now = Date.now();

    users.forEach(u => {
        if (u.name !== username) {
            const isOnline = (now - u.last_active < 15000);
            const isTyping = u.is_typing && (now - u.typing_timestamp < 4000);

            if (isTyping) {
                let onlinePrefix = isOnline ? "(🟢)" : "";
                typers.push(`${onlinePrefix}${u.name} - typing...`);
            }
        }
    });
    typingLabel.innerText = typers.join("\n");
}

messageInput.addEventListener("input", async () => {
    charCounter.innerText = `${messageInput.value.length}/100`;
    await supabaseClient.from('user_status').update({
        is_typing: true,
        typing_timestamp: Date.now()
    }).eq('room', currentRoom).eq('name', username);
});

messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessage();
});
document.getElementById("send-btn").addEventListener("click", sendMessage);

async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;

    messageInput.value = "";
    charCounter.innerText = "0/100";

    try {
        await supabaseClient.from('user_status').update({ is_typing: false }).eq('room', currentRoom).eq('name', username);

        const { error } = await supabaseClient.from('chat_messages').insert({
            room: currentRoom,
            name: username,
            message: text
        });

        if (error) {
            alert("Error sending message: " + error.message);
        }
    } catch (err) {
        alert("Exception while sending: " + err.message);
    }
}

document.getElementById("leave-btn").addEventListener("click", async () => {
    await supabaseClient.from('user_status').delete().eq('room', currentRoom).eq('name', username);
    window.location.href = "index.html";
});
