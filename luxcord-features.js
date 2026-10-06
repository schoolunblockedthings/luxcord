/* Luxcord feature pack */
(() => {
  const $ = id => document.getElementById(id);
  const escLocal = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  const state = { recorder:null, chunks:[], searchOpen:false };

  function currentTarget() {
    if (window.groupChat) return { kind:"group", id:window.groupChat.id, label:window.groupChat.name || "Group" };
    if (window.dm) return { kind:"dm", id:window.dm.id, label:"Direct message" };
    return null;
  }

  function toast(message) {
    let el = $("lux-feature-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "lux-feature-toast";
      el.className = "lux-feature-toast";
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  function openFeatureModal(title, body, actions="") {
    let modal = $("lux-feature-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "lux-feature-modal";
      modal.className = "modal hidden";
      modal.innerHTML = '<div class="modal-card lux-feature-card"><button class="x modal-close" type="button" data-lux-close>×</button><h2 id="lux-feature-title"></h2><div id="lux-feature-body"></div><div id="lux-feature-actions" class="lux-feature-actions"></div></div>';
      document.body.appendChild(modal);
      modal.addEventListener("click", e => { if (e.target === modal || e.target.hasAttribute("data-lux-close")) modal.classList.add("hidden"); });
    }
    $("lux-feature-title").textContent = title;
    $("lux-feature-body").innerHTML = body;
    $("lux-feature-actions").innerHTML = actions;
    modal.classList.remove("hidden");
    return modal;
  }

  async function toggleBookmark(kind, id, button) {
    if (!window.session) return;
    const query = sb.from("message_bookmarks").select("id").eq("user_id", session.user.id);
    const q = kind === "dm" ? query.eq("dm_message_id", id) : query.eq("group_message_id", id);
    const found = await q.maybeSingle();
    if (found.data) {
      await sb.from("message_bookmarks").delete().eq("id", found.data.id);
      if (button) button.textContent = "🔖";
      toast("Removed from saved messages");
    } else {
      await sb.from("message_bookmarks").insert(kind === "dm"
        ? {user_id:session.user.id,dm_message_id:id}
        : {user_id:session.user.id,group_message_id:id});
      if (button) button.textContent = "🔖✓";
      toast("Saved message");
    }
  }

  async function togglePin(kind, id, button) {
    if (!window.session) return;
    const query = sb.from("message_pins").select("id").eq("user_id", session.user.id);
    const q = kind === "dm" ? query.eq("dm_message_id", id) : query.eq("group_message_id", id);
    const found = await q.maybeSingle();
    if (found.data) {
      await sb.from("message_pins").delete().eq("id", found.data.id);
      if (button) button.textContent = "📌";
      toast("Unpinned");
    } else {
      await sb.from("message_pins").insert(kind === "dm"
        ? {user_id:session.user.id,dm_message_id:id}
        : {user_id:session.user.id,group_message_id:id});
      if (button) button.textContent = "📌✓";
      toast("Pinned message");
    }
  }

  async function editMessage(kind, id, article) {
    const textEl = article.querySelector(".message-text");
    const old = textEl?.innerText?.replace(/\s+\(edited\)$/,"").trim() || "";
    const value = prompt("Edit message", old);
    if (value === null || !value.trim()) return;
    const fn = kind === "dm" ? "edit_dm_message" : "edit_group_message";
    const result = await sb.rpc(fn, {p_message_id:id,p_message:value.trim()});
    if (result.error) toast(result.error.message);
    else {
      if (kind === "group") await refreshGroupChat();
      else await refreshDM();
    }
  }

  async function deleteMessage(kind, id) {
    if (!confirm("Delete this message?")) return;
    const fn = kind === "dm" ? "delete_dm_message" : "delete_group_message";
    const result = await sb.rpc(fn, {p_message_id:id});
    if (result.error) toast(result.error.message);
    else if (kind === "group") await refreshGroupChat();
    else await refreshDM();
  }

  function setReply(kind, id, article) {
    const text = article.querySelector(".message-text")?.innerText || "message";
    if (typeof showDMReply === "function") showDMReply({kind,id,text});
    else {
      window.luxReplyTarget = {kind,id,text};
      $("dm-reply-bar")?.classList.remove("hidden");
      $("dm-reply-text") && ($("dm-reply-text").textContent = "Replying to: " + text.slice(0,120));
    }
    toast("Reply selected");
  }

  async function addReaction(kind, id, emoji) {
    if (kind === "dm" && typeof reactDM === "function") return reactDM(id,emoji);
    if (kind === "group" && typeof reactGroup === "function") return reactGroup(id,emoji);
  }

  async function decorateArticle(article) {
    if (article.dataset.luxDecorated === "1") return;
    const id = article.dataset.messageId;
    const kind = article.dataset.messageKind;
    if (!id || !kind) return;
    article.dataset.luxDecorated = "1";

    const actions = article.querySelector(".message-actions") || (() => {
      const el=document.createElement("div"); el.className="message-actions lux-message-actions";
      article.querySelector(".message-body")?.appendChild(el); return el;
    })();

    const add = (label,title,fn,cls="") => {
      const b=document.createElement("button"); b.type="button"; b.textContent=label; b.title=title; b.className="lux-msg-btn "+cls;
      b.addEventListener("click",e=>{e.stopPropagation();fn(b)}); actions.appendChild(b); return b;
    };
    add("↩","Reply",()=>setReply(kind,id,article));
    add("😊","React",b=>{
      const emojis=["❤️","👍","😂","😭","🔥","🎉","😮","👎"];
      const body=emojis.map(e=>'<button type="button" class="lux-emoji-choice" data-e="'+e+'">'+e+'</button>').join("");
      const modal=openFeatureModal("React",'<div class="lux-emoji-grid">'+body+'</div>');
      modal.querySelectorAll("[data-e]").forEach(x=>x.addEventListener("click",()=>{modal.classList.add("hidden");addReaction(kind,id,x.dataset.e);}));
    });
    add("🔖","Save message",b=>toggleBookmark(kind,id,b));
    add("📌","Pin message",b=>togglePin(kind,id,b));
    if (String(window.session?.user?.id) === String(article.querySelector(".clickable-name")?.getAttribute("onclick")?.match(/'([^']+)'/)?.[1])) {
      add("✎","Edit",()=>editMessage(kind,id,article));
      add("🗑","Delete",()=>deleteMessage(kind,id),"danger");
    }

    const attachment=article.querySelector(".message-attachment-file");
    if (attachment) {
      const href=attachment.href||"";
      if (/\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(href)) {
        const img=document.createElement("img");
        img.src=href; img.alt=attachment.textContent||"Image"; img.loading="eager"; img.className="lux-message-image";
        const container=article.closest("#dm-messages");
        const wasNearBottom=container ? (container.scrollHeight - container.scrollTop - container.clientHeight < 180) : false;
        const scrollDistance=container ? (container.scrollHeight - container.scrollTop - container.clientHeight) : 0;
        const restoreScroll=()=>{
          if (!container) return;
          if (wasNearBottom) container.scrollTop=container.scrollHeight;
          else container.scrollTop=Math.max(0,container.scrollHeight-container.clientHeight-scrollDistance);
        };
        img.addEventListener("load",restoreScroll,{once:true});
        img.addEventListener("error",restoreScroll,{once:true});
        attachment.replaceWith(img);
      }
    }

    if (window.luxReplyTarget) {}
  }

  function decorateAll() {
    document.querySelectorAll("#dm-messages .message[data-message-id]").forEach(decorateArticle);
  }

  async function showSaved() {
    if (!session) return;
    const result=await sb.from("message_bookmarks").select("*").eq("user_id",session.user.id).order("created_at",{ascending:false}).limit(100);
    if (result.error) return toast(result.error.message);
    const dmIds=(result.data||[]).map(x=>x.dm_message_id).filter(Boolean);
    const groupIds=(result.data||[]).map(x=>x.group_message_id).filter(Boolean);
    const [dms,groups]=await Promise.all([
      dmIds.length?sb.from("dm_messages").select("id,message,created_at").in("id",dmIds):{data:[]},
      groupIds.length?sb.from("group_messages").select("id,message,created_at").in("id",groupIds):{data:[]}
    ]);
    const rows=[...(dms.data||[]).map(x=>({...x,kind:"dm"})),...(groups.data||[]).map(x=>({...x,kind:"group"}))];
    const body=rows.length?rows.map(x=>'<button class="lux-saved-row" data-kind="'+x.kind+'" data-id="'+x.id+'"><span>🔖</span><span>'+escLocal(x.message||"Deleted message")+'</span></button>').join(""):'<div class="muted">No saved messages yet.</div>';
    const modal=openFeatureModal("Saved messages",body);
    modal.querySelectorAll(".lux-saved-row").forEach(b=>b.addEventListener("click",()=>{modal.classList.add("hidden");toast("Saved message #"+b.dataset.id);}));
  }

  async function showPins() {
    if (!session) return;
    const result=await sb.from("message_pins").select("*").eq("user_id",session.user.id).order("created_at",{ascending:false}).limit(100);
    if(result.error)return toast(result.error.message);
    const body=(result.data||[]).length?(result.data||[]).map(x=>'<div class="lux-saved-row"><span>📌</span><span>Message #'+(x.dm_message_id||x.group_message_id)+'</span></div>').join(""):'<div class="muted">No pinned messages.</div>';
    openFeatureModal("Pinned messages",body);
  }

  async function searchMessages() {
    const target=currentTarget();
    if(!target)return toast("Open a DM or group first.");
    const modal=openFeatureModal("Search messages",'<input id="lux-search-input" class="lux-search-input" placeholder="Search this conversation..."><div id="lux-search-results" class="lux-search-results muted">Type to search.</div>');
    const input=$("lux-search-input"), out=$("lux-search-results");
    const run=async()=> {
      const q=input.value.trim(); if(!q){out.textContent="Type to search.";return;}
      const query=target.kind==="dm"
        ? sb.from("dm_messages").select("id,message,created_at").eq("conversation_id",target.id).ilike("message","%"+q+"%").order("created_at",{ascending:false}).limit(50)
        : sb.from("group_messages").select("id,message,created_at").eq("group_id",target.id).ilike("message","%"+q+"%").order("created_at",{ascending:false}).limit(50);
      const res=await query;
      if(res.error){out.textContent=res.error.message;return;}
      out.innerHTML=(res.data||[]).length?(res.data||[]).map(x=>'<button class="lux-saved-row" data-id="'+x.id+'"><b>#'+x.id+'</b><span>'+escLocal(x.message)+'</span></button>').join(""):'<div class="muted">No matches.</div>';
    };
    input.addEventListener("input",run); input.focus();
  }

  function addComposerTools() {
    const composer=$("dm-composer");
    if(!composer || composer.dataset.luxTools==="1")return;
    composer.dataset.luxTools="1";
    const wrap=document.createElement("div"); wrap.className="lux-composer-tools";
    const button=(label,title,fn)=>{const b=document.createElement("button");b.type="button";b.textContent=label;b.title=title;b.className="lux-tool-btn";b.addEventListener("click",fn);wrap.appendChild(b);};
    button("😊","Emoji",()=>{
      const emojis=["😀","😂","😍","😭","😎","😮","😡","🤔","👍","👎","❤️","🔥","🎉","💀","✨","🙏"];
      const modal=openFeatureModal("Emoji",'<div class="lux-emoji-grid">'+emojis.map(e=>'<button class="lux-emoji-choice" data-e="'+e+'">'+e+'</button>').join("")+'</div>');
      modal.querySelectorAll("[data-e]").forEach(b=>b.addEventListener("click",()=>{const input=$("dm-input");input.value+=b.dataset.e;input.focus();modal.classList.add("hidden");}));
    });
    button("🎙","Voice message",startVoiceMessage);
    button("🔎","Search",searchMessages);
    button("🔖","Saved",showSaved);
    button("📌","Pins",showPins);
    button("📊","Poll",createPoll);
    composer.insertBefore(wrap,composer.firstChild);
  }

  async function createPoll() {
    const target=currentTarget(); if(!target)return toast("Open a DM or group first.");
    const question=prompt("Poll question"); if(!question?.trim())return;
    const raw=prompt("Options, separated by commas"); if(!raw)return;
    const options=raw.split(",").map(x=>x.trim()).filter(Boolean).slice(0,8);
    if(options.length<2)return toast("Add at least 2 options.");
    const text="[Poll] "+question.trim()+" — "+options.join(" • ");
    if(target.kind==="dm") {
      const res=await sb.from("dm_messages").insert({conversation_id:target.id,sender_id:session.user.id,message:text});
      if(res.error)toast(res.error.message); else refreshDM();
    } else {
      const res=await sb.from("group_messages").insert({group_id:target.id,sender_id:session.user.id,message:text});
      if(res.error)toast(res.error.message); else refreshGroupChat();
    }
  }

  async function startVoiceMessage() {
    if(!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)return toast("Voice recording is not supported here.");
    if(!window.dm || !window.session)return toast("Voice messages are available in DMs.");
    if(state.recorder)return;
    try {
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      const recorder=new MediaRecorder(stream); state.recorder=recorder; state.chunks=[];
      recorder.ondataavailable=e=>{if(e.data.size)state.chunks.push(e.data)};
      recorder.onstop=async()=>{
        stream.getTracks().forEach(t=>t.stop()); state.recorder=null;
        const blob=new Blob(state.chunks,{type:recorder.mimeType||"audio/webm"});
        const file=new File([blob],"voice-message.webm",{type:blob.type});
        const attachment=await uploadDMFile(file);
        if(!attachment)return;
        const res=await sb.from("dm_messages").insert({conversation_id:dm.id,sender_id:session.user.id,message:"Voice message",attachment_url:attachment.url,attachment_name:attachment.name});
        if(res.error)toast(res.error.message); else refreshDM();
      };
      recorder.start();
      toast("Recording… click 🎙 again to stop");
      const stop=()=>{if(state.recorder){state.recorder.stop();document.removeEventListener("click",stop,true)}};
      setTimeout(()=>document.addEventListener("click",stop,true),250);
    }catch(e){toast(e.message||"Microphone permission denied.");}
  }

  function addDragDrop() {
    const composer=$("dm-composer"); if(!composer || composer.dataset.luxDrop==="1")return;
    composer.dataset.luxDrop="1";
    ["dragenter","dragover"].forEach(ev=>composer.addEventListener(ev,e=>{e.preventDefault();composer.classList.add("lux-drop-active")}));
    ["dragleave","drop"].forEach(ev=>composer.addEventListener(ev,e=>{e.preventDefault();composer.classList.remove("lux-drop-active")}));
    composer.addEventListener("drop",e=>{const f=e.dataTransfer.files?.[0];if(f&&$("dm-file")){const dt=new DataTransfer();dt.items.add(f);$("dm-file").files=dt.files;toast("Attached "+f.name)}});
    $("dm-input")?.addEventListener("paste",e=>{const f=[...(e.clipboardData?.files||[])][0];if(f&&f.type.startsWith("image/")&&$("dm-file")){const dt=new DataTransfer();dt.items.add(f);$("dm-file").files=dt.files;toast("Pasted image attached");}});
  }

  function addProfileBlock() {
    const btn=$("add-profile-friend"); if(!btn || btn.dataset.luxBlock==="1")return;
    btn.dataset.luxBlock="1";
    const block=document.createElement("button"); block.type="button"; block.className="secondary wide"; block.id="lux-block-user"; block.textContent="Block user";
    block.addEventListener("click",async()=>{
      const id=$("user-profile-modal")?.dataset.profileId;if(!id||!session)return;
      const found=await sb.from("blocked_users").select("user_id").eq("user_id",session.user.id).eq("blocked_user_id",id).maybeSingle();
      if(found.data){await sb.from("blocked_users").delete().eq("user_id",session.user.id).eq("blocked_user_id",id);block.textContent="Block user";toast("User unblocked");}
      else {await sb.from("blocked_users").insert({user_id:session.user.id,blocked_user_id:id});block.textContent="Unblock user";toast("User blocked");}
    });
    btn.parentNode?.insertBefore(block,btn.nextSibling);
  }

  function addStatusControl() {
    const bio=$("profile-bio"); if(!bio || $("lux-custom-status"))return;
    const label=document.createElement("label"); label.id="lux-custom-status"; label.style.display="block"; label.style.marginTop="10px";
    label.innerHTML='Status message<input id="lux-status-input" maxlength="120" placeholder="What are you up to?">';
    bio.parentNode?.insertBefore(label,bio.nextSibling);
    $("profile-modal")?.addEventListener("click",()=>{if($("lux-status-input"))$("lux-status-input").value=me?.status||""},{once:true});
    const save=$("save-profile"); save?.addEventListener("click",async()=>{const v=$("lux-status-input")?.value.trim();if(window.session)await sb.from("profiles").update({status:v||null}).eq("id",session.user.id);});
  }

  function addSettingsControls() {
    const theme=$("setting-theme"); if(!theme || $("lux-accent"))return;
    const label=document.createElement("label"); label.id="lux-accent"; label.innerHTML='Accent color<select id="setting-accent"><option value="purple">Purple</option><option value="blue">Blue</option><option value="green">Green</option><option value="pink">Pink</option></select></label>';
    theme.parentNode?.after(label);
    const save=$("save-settings"); save?.addEventListener("click",()=>{const a=$("setting-accent")?.value||"purple";document.body.dataset.accent=a;settings=settings||{};settings.accent=a;});
  }


  async function updateLastSeen() {
    if (!session) return;
    const result = await sb.from("profiles")
      .update({last_seen_at:new Date().toISOString()})
      .eq("id",session.user.id);
    if (result.error) console.warn("Luxcord last seen:", result.error.message);
  }

  const callState = { channel:null, inboxChannel:null, pc:null, local:null, remote:null, peerId:null, conversationId:null, muted:false, ringing:false, pendingIce:[] };

  function dmPeerId() {
    if (!dm || !session) return null;
    return String(dm.user_a) === String(session.user.id) ? dm.user_b : dm.user_a;
  }

  function callUI() {
    let box = $("lux-call-ui");
    if (!box) {
      box = document.createElement("div");
      box.id = "lux-call-ui";
      box.className = "lux-call-ui hidden";
      box.innerHTML = '<div class="lux-call-title" id="lux-call-title">Voice call</div><div class="lux-call-status" id="lux-call-status"></div><div class="lux-call-actions" id="lux-call-actions"></div><audio id="lux-call-audio" autoplay></audio>';
      document.body.appendChild(box);
    }
    return box;
  }

  function setCallStatus(text) { callUI(); if ($("lux-call-status")) $("lux-call-status").textContent = text; }

  async function stopCall(sendHangup=true) {
    const peer = callState.peerId, cid = callState.conversationId, ch = callState.channel;
    if (sendHangup && ch && peer) {
      try { await ch.send({type:"broadcast",event:"call-signal",payload:{type:"hangup",from:session.user.id,to:peer,conversation_id:cid}}); } catch(e) {}
    }
    callState.local?.getTracks().forEach(t=>t.stop());
    callState.pc?.close();
    if (callState.channel) sb.removeChannel(callState.channel);
    callState.channel=null; callState.pc=null; callState.local=null; callState.remote=null;
    callState.peerId=null; callState.conversationId=null; callState.muted=false; callState.ringing=false; callState.pendingIce=[];
    const box=callUI(); box.classList.add("hidden");
    if ($("lux-call-audio")) $("lux-call-audio").srcObject=null;
    const head=$("dm-conversation-head"); if(head) head.dataset.luxCall="";
  }

  async function ensureCallChannel(conversationId, peerId) {
    const cid=String(conversationId);
    if (callState.channel && callState.conversationId===cid) return callState.channel;
    if (callState.channel) sb.removeChannel(callState.channel);

    // One private signaling room per DM conversation prevents unrelated calls
    // from sharing state and makes caller/receiver subscribe to the same room.
    const ch=sb.channel("luxcord-call-"+cid);
    ch.on("broadcast",{event:"call-signal"}, async ({payload})=>{
      if (!payload || String(payload.to)!==String(session.user.id) || String(payload.conversation_id)!==cid) return;
      if (payload.type==="offer") {
        if (!callState.pc && !callState.ringing) await receiveOffer(payload, payload.from);
      } else if (payload.type==="answer" && callState.pc) {
        try {
          await callState.pc.setRemoteDescription(new RTCSessionDescription(payload.answer));
          setCallStatus("Connected");
          await flushPendingIce();
        } catch(e) { console.warn("Voice answer error:",e); }
      } else if (payload.type==="ice" && callState.pc && payload.candidate) {
        await queueOrAddIce(payload.candidate);
      } else if (payload.type==="hangup") {
        await stopCall(false);
      }
    });
    await ch.subscribe();
    callState.channel=ch; callState.conversationId=cid; callState.peerId=String(peerId);
    return ch;
  }

  async function queueOrAddIce(candidate) {
    if (!candidate) return;
    if (!callState.pc?.remoteDescription) {
      callState.pendingIce.push(candidate);
      return;
    }
    try { await callState.pc.addIceCandidate(candidate); } catch(e) { console.warn("Voice ICE error:",e); }
  }

  async function flushPendingIce() {
    if (!callState.pc?.remoteDescription || !callState.pendingIce.length) return;
    const pending=callState.pendingIce.splice(0);
    for (const candidate of pending) {
      try { await callState.pc.addIceCandidate(candidate); } catch(e) {}
    }
  }

  function buildPeer(peerId, conversationId) {
    const pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});
    callState.pc=pc;
    pc.onicecandidate=e=>{
      if(e.candidate && callState.channel) {
        callState.channel.send({type:"broadcast",event:"call-signal",payload:{
          type:"ice",from:session.user.id,to:peerId,conversation_id:String(conversationId),candidate:e.candidate
        }});
      }
    };
    pc.ontrack=e=>{
      callState.remote=e.streams[0];
      const audio=$("lux-call-audio");
      if(audio) { audio.srcObject=e.streams[0]; audio.play?.().catch(()=>{}); }
    };
    pc.onconnectionstatechange=()=>{
      if(pc.connectionState==="connected") setCallStatus("Connected");
      else if(["failed","disconnected","closed"].includes(pc.connectionState)) setCallStatus("Call ended");
    };
    if(callState.local) callState.local.getTracks().forEach(track=>pc.addTrack(track,callState.local));
    return pc;
  }

  async function getMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Your browser does not support microphone calls.");
    return navigator.mediaDevices.getUserMedia({audio:true,video:false});
  }

  function callButtons() {
    $("lux-call-actions").innerHTML='<button type="button" class="lux-call-btn" id="lux-call-mute">🎙️ Mute</button><button type="button" class="lux-call-btn danger" id="lux-call-hangup">☎ Hang up</button>';
    $("lux-call-mute").onclick=toggleCallMute;
    $("lux-call-hangup").onclick=()=>stopCall(true);
  }

  async function startVoiceCall() {
    if (!dm || !session || callState.pc || callState.ringing) return;
    const peerId=dmPeerId(); if(!peerId) return;
    try {
      callState.local=await getMicrophone();
      callState.peerId=String(peerId); callState.conversationId=String(dm.id); callState.pendingIce=[];
      await ensureCallChannel(dm.id,peerId);
      const pc=buildPeer(peerId,dm.id);
      const offer=await pc.createOffer();
      await pc.setLocalDescription(offer);
      const box=callUI();
      box.classList.remove("hidden");
      $("lux-call-title").textContent="Calling "+($("dm-conversation-name")?.textContent||"User");
      setCallStatus("Calling…");
      callButtons();
      const signalChannel=callState.inboxChannel || callState.channel;
      await signalChannel.send({type:"broadcast",event:"call-signal",payload:{
        type:"offer",from:session.user.id,to:peerId,conversation_id:String(dm.id),offer
      }});
    } catch(e) {
      console.error("Voice call error:",e);
      toast(e.message||"Could not start call");
      await stopCall(false);
    }
  }

  async function receiveOffer(payload, peerId) {
    if (callState.pc || callState.ringing) return;
    callState.ringing=true;
    callState.peerId=String(peerId);
    callState.conversationId=String(payload.conversation_id);
    callState.pendingIce=[];
    const box=callUI();
    box.classList.remove("hidden");
    $("lux-call-title").textContent="Incoming voice call";
    setCallStatus("Someone is calling you…");
    $("lux-call-actions").innerHTML='<button type="button" class="lux-call-btn accept" id="lux-call-accept">📞 Accept</button><button type="button" class="lux-call-btn danger" id="lux-call-decline">Decline</button>';
    $("lux-call-accept").onclick=async()=>{
      try {
        callState.ringing=false;
        callState.local=await getMicrophone();
        await ensureCallChannel(payload.conversation_id,peerId);
        const pc=buildPeer(peerId,payload.conversation_id);
        await pc.setRemoteDescription(new RTCSessionDescription(payload.offer));
        await flushPendingIce();
        const answer=await pc.createAnswer();
        await pc.setLocalDescription(answer);
        setCallStatus("Connecting…");
        callButtons();
        await callState.channel.send({type:"broadcast",event:"call-signal",payload:{
          type:"answer",from:session.user.id,to:peerId,conversation_id:String(payload.conversation_id),answer
        }});
      } catch(e) {
        toast(e.message||"Could not answer call");
        await stopCall(true);
      }
    };
    $("lux-call-decline").onclick=()=>stopCall(true);
  }

  function toggleCallMute() {
    callState.muted=!callState.muted;
    callState.local?.getAudioTracks().forEach(t=>t.enabled=!callState.muted);
    const btn=$("lux-call-mute"); if(btn) btn.textContent=callState.muted?"🔇 Unmute":"🎙️ Mute";
  }

  async function initCallSignaling() {
    if (!session || callState.inboxChannel) return;
    const inbox=sb.channel("luxcord-call-inbox-"+String(session.user.id));
    inbox.on("broadcast",{event:"call-signal"},async ({payload})=>{
      if (!payload || String(payload.to)!==String(session.user.id) || payload.type!=="offer") return;
      if (callState.pc || callState.ringing) return;
      await receiveOffer(payload,payload.from);
    });
    await inbox.subscribe();
    callState.inboxChannel=inbox;
  }

  function addDMCallControls() {
    const head=$("dm-conversation-head"); if(!head || !dm || groupChat || !session) return;
    if(head.dataset.luxCallControls==="1") return;
    head.dataset.luxCallControls="1";
    const btn=document.createElement("button"); btn.type="button"; btn.className="lux-call-header-btn"; btn.textContent="📞"; btn.title="Voice call"; btn.onclick=startVoiceCall; head.appendChild(btn);
  }

  function addGroupTools() {
    if (!window.groupChat || !session) return;
    const head=$("dm-conversation-head");
    if (!head || head.dataset.luxGroupTools==="1") return;
    head.dataset.luxGroupTools="1";
    const mute=document.createElement("button");
    mute.type="button"; mute.className="lux-tool-btn"; mute.textContent="🔔"; mute.title="Mute group";
    mute.addEventListener("click",()=>{
      settings=settings||{}; settings.mutedGroups=settings.mutedGroups||{};
      settings.mutedGroups[String(groupChat.id)]=!settings.mutedGroups[String(groupChat.id)];
      mute.textContent=settings.mutedGroups[String(groupChat.id)]?"🔕":"🔔";
      toast(settings.mutedGroups[String(groupChat.id)]?"Group muted":"Group unmuted");
      if(session) sb.from("profiles").update({settings}).eq("id",session.user.id);
    });
    head.appendChild(mute);
  }

  function observe() {
    const target=$("dm-messages"); if(target){
      new MutationObserver(()=>setTimeout(decorateAll,0)).observe(target,{childList:true,subtree:true});
    }
    setInterval(()=>{addComposerTools();addDragDrop();addProfileBlock();addStatusControl();addSettingsControls();addGroupTools();addDMCallControls();initCallSignaling();decorateAll()},1200); updateLastSeen(); setInterval(updateLastSeen,60000); document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")updateLastSeen();});
  }

  document.addEventListener("DOMContentLoaded",observe);
  if(document.readyState!=="loading")observe();
})();
