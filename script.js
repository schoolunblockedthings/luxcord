const SUPABASE_URL = "https://mvgqpkdldciwzqgpayoo.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12Z3Fwa2RsZGNpd3pxZ3BheW9vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2ODkzMTAsImV4cCI6MjEwNjI2NTMxMH0.7VSGwqyucBwdDCZzlS_xCLdLhEQaN3laJBYYDmGnN08";

const urlParams = new URLSearchParams(window.location.search);
const username = urlParams.get('name');
const currentRoom = urlParams.get('room');

let audio = new Audio("https://code.org");
let lastMessageCount = 0;

const chatDisplay = document.getElementById("chat-display");
const messageInput = document.getElementById("message-input");
const typingLabel = document.getElementById("typing-label");
const charCounter = document.getElementById("char-counter");

if (!username || !currentRoom) {
    window.location.href = "index.html";
} else {
    document.getElementById("room-display").innerText = "Room: " + currentRoom;
    
    refreshChatData();
    setInterval(refreshChatData, 4000); // 4 seconds to be safe with network speeds
}

async function refreshChatData() {
    const headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
    };

    // STEP 1: Heartbeat
    try {
        // FIXED: Removed query strings from POST url which causes errors in Supabase API
        const res = await fetch(`${SUPABASE_URL}/rest/v1/user_status`, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json',
                'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify({
                room: currentRoom,
                name: username,
                last_active: Date.now(),
                typing_timestamp: Date.now()
            })
        });
        if (!res.ok) console.log("Heartbeat status code: " + res.status);
    } catch (err) {
        console.error("Heartbeat fail: ", err);
    }

    // STEP 2: Fetch Messages
    try {
        const msgResponse = await fetch(`${SUPABASE_URL}/rest/v1/chat_messages?room=eq.${encodeURIComponent(currentRoom)}&order=id.asc`, {
            method: 'GET',
            headers: headers
        });
        
        if (!msgResponse.ok) {
            const errText = await msgResponse.text();
            alert("Failed to load messages from database: " + errText);
            return;
        }

        const messages = await msgResponse.json();
        
        if (messages && messages.length !== lastMessageCount) {
            chatDisplay.innerHTML = "";
            messages.forEach(msg => {
                const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                chatDisplay.innerHTML += `[${time}] <b>${msg.name}</b>: ${msg.message}\n`;
            });
            chatDisplay.scrollTop = chatDisplay.scrollHeight;
            
            if (lastMessageCount > 0 && messages[messages.length - 1].name !== username) {
                audio.play().catch(() => {});
            }
            lastMessageCount = messages.length;
        }
    } catch (err) {
        alert("Message Fetch Exception: " + err.message);
    }

    // STEP 3: Fetch Typing Users
    try {
        const statusResponse = await fetch(`${SUPABASE_URL}/rest/v1/user_status?room=eq.${encodeURIComponent(currentRoom)}`, {
            method: 'GET',
            headers: headers
        });
        if (statusResponse.ok) {
            const users = await statusResponse.json();
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
    } catch (e) {}
}

messageInput.addEventListener("input", async () => {
    charCounter.innerText = `${messageInput.value.length}/100`;
    try {
        await fetch(`${SUPABASE_URL}/rest/v1/user_status?room=eq.${encodeURIComponent(currentRoom)}&name=eq.${encodeURIComponent(username)}`, {
            method: 'PATCH',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                is_typing: true,
                typing_timestamp: Date.now()
            })
        });
    } catch(e){}
});

messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessage();
});
document.getElementById("send-btn").addEventListener("click", sendMessage);

async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;

    messageInput.value = "";
    charCounter.innerText = "0/1000";

    const headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
    };

    try {
        await fetch(`${SUPABASE_URL}/rest/v1/user_status?room=eq.${encodeURIComponent(currentRoom)}&name=eq.${encodeURIComponent(username)}`, {
            method: 'PATCH',
            headers: headers,
            body: JSON.stringify({ is_typing: false })
        });

        const response = await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
            method: 'POST',
            headers: {
                ...headers,
                'Prefer': 'return=representation'
            },
            body: JSON.stringify({
                room: currentRoom,
                name: username,
                message: text
            })
        });

        if (!response.ok) {
            const errData = await response.text();
            alert("Database rejected your message submission:\n" + errData);
        } else {
            setTimeout(refreshChatData, 300); // Give the database a moment to register before redrawing
        }
    } catch (err) {
        alert("Network Send Error: " + err.message);
    }
}

document.getElementById("leave-btn").addEventListener("click", async () => {
    try {
        await fetch(`${SUPABASE_URL}/rest/v1/user_status?room=eq.${encodeURIComponent(currentRoom)}&name=eq.${encodeURIComponent(username)}`, {
            method: 'DELETE',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`
            }
        });
    } catch (e) {}
    window.location.href = "index.html";
});
