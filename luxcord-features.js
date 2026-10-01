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
        img.src=href; img.alt=attachment.textContent||"Image"; img.loading="lazy"; img.className="lux-message-image";
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


  function updateLastSeen() {
    if (!session) return;
    sb.from("profiles").update({last_seen_at:new Date().toISOString()}).eq("id",session.user.id);
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
    setInterval(()=>{addComposerTools();addDragDrop();addProfileBlock();addStatusControl();addSettingsControls();addGroupTools();decorateAll()},1200); updateLastSeen(); setInterval(updateLastSeen,60000); document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")updateLastSeen();});
  }

  document.addEventListener("DOMContentLoaded",observe);
  if(document.readyState!=="loading")observe();
})();
