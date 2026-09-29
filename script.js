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
    
    // Run the initial data fetch immediately
    refreshChatData();
    
    // Loop every 3 seconds to fetch new messages and update typing indicators
    setInterval(refreshChatData, 3000);
}

async function refreshChatData() {
    try {
        const headers = {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`
        };

        // 1. Update our own online timestamp heartbeat
        await fetch(`${SUPABASE_URL}/rest/v1/user_status?room=eq.${encodeURIComponent(currentRoom)}&name=eq.${encodeURIComponent(username)}`, {
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

        // 2. Fetch all messages for the current room
        const msgResponse = await fetch(`${SUPABASE_URL}/rest/v1/chat_messages?room=eq.${encodeURIComponent(currentRoom)}&order=id.asc`, {
            method: 'GET',
            headers: headers
        });
        const messages = await msgResponse.json();
        
        if (messages && messages.length !== lastMessageCount) {
            chatDisplay.innerHTML = "";
            messages.forEach(msg => {
                const time = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                chatDisplay.innerHTML += `[${time}] <b>${msg.name}</b>: ${msg.message}\n`;
            });
            chatDisplay.scrollTop = chatDisplay.scrollHeight;
            
            // Play sound if a new message arrives from a friend
            if (lastMessageCount > 0 && messages[messages.length - 1].name !== username) {
                audio.play().catch(() => {});
            }
            lastMessageCount = messages.length;
        }

        // 3. Fetch all active typing statuses
        const statusResponse = await fetch(`${SUPABASE_URL}/rest/v1/user_status?room=eq.${encodeURIComponent(currentRoom)}`, {
            method: 'GET',
            headers: headers
        });
        const users = await statusResponse.json();
        
        let typers = [];
        const now = Date.now();
        
        if (users) {
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
        }
        typingLabel.innerText = typers.join("\n");

    } catch (err) {
        console.error("Error syncing data loop: ", err);
    }
}

// Handle typing inputs
messageInput.addEventListener("input", async () => {
    charCounter.innerText = `${messageInput.value.length}/100`;
    
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

    const headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
    };

    try {
        // Turn typing status off
        await fetch(`${SUPABASE_URL}/rest/v1/user_status?room=eq.${encodeURIComponent(currentRoom)}&name=eq.${encodeURIComponent(username)}`, {
            method: 'PATCH',
            headers: headers,
            body: JSON.stringify({ is_typing: false })
        });

        // Post new message row
        await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                room: currentRoom,
                name: username,
                message: text
            })
        });

        refreshChatData();
    } catch (err) {
        console.error("Failed to transmit text: ", err);
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
