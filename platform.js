/* Atril · capa de plataforma
 * - Inicio de sesión con Google obligatorio en cada arranque (Google Identity Services).
 * - Google Drive por la API REST v3 (la biblioteca vive en la carpeta «Atril - biblioteca»).
 * - «Preguntar»: copia la consulta con el texto del PDF para pegarla en la IA que prefieras.
 * - Descargas normales del navegador.
 * Expone window.claude.use(nombre) con la misma forma que usa el código del lector,
 * así el lector conserva todas sus funciones sin cambios de lógica.
 */
(() => {
  "use strict";
  const CFG_KEY = "atril-config", OWNER_KEY = "atril-owner";
  const FOLDER = "application/vnd.google-apps.folder";
  const DAPI = "https://www.googleapis.com/drive/v3/", UAPI = "https://www.googleapis.com/upload/drive/v3/";
  const FIELDS = "id,name,mimeType,size,modifiedTime,parents";
  const base = Object.assign({ googleClientId: "", pickerKey: "", appId: "" }, window.ATRIL_CONFIG || {});
  let cfg = (() => { try { return Object.assign({}, base, JSON.parse(localStorage.getItem(CFG_KEY) || "{}")); } catch { return { ...base }; } })();
  if (!cfg.googleClientId) cfg.googleClientId = base.googleClientId;
  const saveCfg = () => { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch {} };

  let token = null, tokenExp = 0, user = null, started = false, offlineMode = false;
  // Ventana o pestaña aparte del cuaderno (index.html#nb=…): usa la sesión ya abierta en Atril, sin volver a iniciar sesión.
  const NBWIN = /^#nb=/.test(location.hash);
  if (NBWIN) document.documentElement.classList.add("nbwin");
  const fromOpener = () => { try { const o = window.opener; if (o && o !== window && !o.closed && o.location.origin === location.origin && typeof o.__atrilHandoff === "function") return o.__atrilHandoff(); } catch {} return null; };
  window.__atrilHandoff = () => started && user ? { token: token && Date.now() < tokenExp ? token : null, tokenExp, user: { ...user }, offlineMode } : null;
  window.__atrilOpenerAlive = () => !!fromOpener();
  function takeOpenerToken() { const hd = fromOpener(); if (hd?.token && user && hd.user?.sub === user.sub) { token = hd.token; tokenExp = hd.tokenExp; offlineMode = !!hd.offlineMode; bar && (bar.hidden = true); return true; } return false; }
  const READ_KEY = "atril@lectura", GUIDE_KEY = "atril@guia-v1";
  try { if (localStorage.getItem(READ_KEY) === "1") document.documentElement.dataset.read = "libro"; } catch {}
  const OFF_KEY = "atril-offline";
  const $ = (s, r = document) => r.querySelector(s);
  const h = (tag, attrs = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (v == null) continue; if (k === "text") n.textContent = v; else if (k === "html") n.innerHTML = v; else n.setAttribute(k, v); } n.append(...kids.filter(Boolean)); return n; };

  /* ---------------- Google: inicio de sesión ---------------- */
  let gisP = null;
  const loadGis = () => gisP ??= new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.async = true;
    s.onload = () => res(); s.onerror = () => { gisP = null; rej(new Error("No se pudo cargar el inicio de sesión de Google. Revisa tu conexión.")); };
    document.head.append(s);
  });
  // Solo permisos no sensibles: Atril ve únicamente los archivos que crea y los que cada persona elige en el selector de Google.
  const SCOPE_FILE = "https://www.googleapis.com/auth/drive.file";
  const scopes = () => ["openid", "email", "profile", SCOPE_FILE].join(" ");
  async function signIn(prompt) {
    if (!cfg.googleClientId) throw new Error("Falta el ID de cliente de Google. Ábrelo en Ajustes.");
    await loadGis();
    return new Promise((res, rej) => {
      const tc = google.accounts.oauth2.initTokenClient({
        client_id: cfg.googleClientId, scope: scopes(), prompt,
        callback: (r) => {
          if (r.error) { rej(new Error(r.error_description || r.error)); return; }
          if (!google.accounts.oauth2.hasGrantedAllScopes(r, SCOPE_FILE)) { rej(new Error("Para guardar tu biblioteca, marca el permiso de Google Drive al iniciar sesión.")); return; }
          token = r.access_token; tokenExp = Date.now() + (Number(r.expires_in) || 3600) * 1000 - 60000;
          res(r);
        },
        error_callback: (e) => rej(new Error(e?.type === "popup_closed" ? "Se cerró la ventana de Google antes de terminar." : e?.type === "popup_failed_to_open" ? "El navegador bloqueó la ventana de Google. Permite las ventanas emergentes para este sitio." : (e?.message || "No se pudo iniciar sesión."))),
      });
      tc.requestAccessToken();
    });
  }
  async function whoAmI() {
    const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: "Bearer " + token } });
    if (!r.ok) throw new Error("Google no devolvió tu perfil.");
    return r.json();
  }

  /* ---------------- Google Drive (REST v3) ---------------- */
  const mapF = (f) => f && { id: f.id, title: f.name, mimeType: f.mimeType, fileSize: f.size, modifiedTime: f.modifiedTime, parents: f.parents };
  async function gfetch(url, opt = {}) {
    if (!navigator.onLine) throw { code: "offline" };
    if ((!token || Date.now() > tokenExp) && NBWIN) takeOpenerToken();
    if (!token || Date.now() > tokenExp) { if (offlineMode && !navigator.onLine) throw { code: "offline" }; showReauth(offlineMode ? "Volviste a tener internet. Inicia sesión para guardar tus cambios en Drive." : ""); throw { code: "needs_reauth" }; }
    let r;
    try { r = await fetch(url, { ...opt, headers: { ...(opt.headers || {}), Authorization: "Bearer " + token } }); }
    catch (e) { throw { code: navigator.onLine ? "server_unavailable" : "offline", message: e?.message || "sin conexión" }; }
    if (r.status === 401) { token = null; showReauth(); throw { code: "needs_reauth" }; }
    if (!r.ok) {
      let j = null; try { j = await r.json(); } catch {}
      const msg = j?.error?.message || "HTTP " + r.status, reason = j?.error?.errors?.[0]?.reason || "";
      if (r.status === 429 || /rateLimit/i.test(reason)) throw { code: "rate_limited", message: msg };
      if (r.status >= 500) throw { code: "upstream_error", message: msg };
      if (r.status === 403 && /insufficient|scope/i.test(msg + " " + reason)) throw { code: "not_in_manifest", message: msg };
      throw { code: "tool_error", message: msg + (r.status === 404 ? " (notFound)" : "") };
    }
    return r;
  }
  const json = (r) => r.json();
  const toU8 = (d) => d instanceof Uint8Array ? d : d instanceof ArrayBuffer ? new Uint8Array(d) : null;
  function b64u8(b) { const s = atob(b); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  async function upload(meta, data, type) {
    const size = data.byteLength ?? data.size ?? 0;
    if (size > 5 * 1024 * 1024) {
      const r = await gfetch(UAPI + "files?uploadType=resumable&fields=" + FIELDS, { method: "POST", headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": type }, body: JSON.stringify(meta) });
      const loc = r.headers.get("Location");
      if (loc) { const p = await gfetch(loc, { method: "PUT", headers: { "Content-Type": type }, body: new Blob([data], { type }) }); return mapF(await p.json()); }
    }
    const b = "atril" + Math.random().toString(36).slice(2);
    const body = new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${type}\r\n\r\n`, data, `\r\n--${b}--`]);
    const r = await gfetch(UAPI + "files?uploadType=multipart&fields=" + FIELDS, { method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + b }, body });
    return mapF(await r.json());
  }
  const convQ = (q) => String(q || "")
    .replace(/parentId = '((?:[^'\\]|\\.)*)'/g, "'$1' in parents")
    .replace(/owner = 'me'/g, "'me' in owners")
    .replace(/\btitle (=|contains) /g, "name $1 ");
  const DRIVE_TOOLS = {
    async search_files(i) {
      const p = new URLSearchParams({ q: convQ(i.query), pageSize: String(Math.min(i.pageSize || 100, 1000)), fields: `nextPageToken,files(${FIELDS})`, spaces: "drive" });
      if (i.pageToken) p.set("pageToken", i.pageToken);
      const j = await gfetch(DAPI + "files?" + p).then(json);
      return { files: (j.files || []).map(mapF), nextPageToken: j.nextPageToken || null };
    },
    async create_file(i) {
      const meta = { name: i.title }; if (i.parentId) meta.parents = [i.parentId];
      const mime = i.mimeType || i.contentMimeType;
      if (mime === FOLDER) {
        meta.mimeType = FOLDER;
        return mapF(await gfetch(DAPI + "files?fields=" + FIELDS, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(meta) }).then(json));
      }
      const c = i.base64Content;
      const data = toU8(c?.$file?.data) || (c?.$file?.data instanceof Blob ? c.$file.data : null) || (typeof c === "string" ? b64u8(c) : null) || new TextEncoder().encode(i.textContent ?? "");
      meta.mimeType = mime || "application/octet-stream";
      return upload(meta, data, meta.mimeType);
    },
    async update_content(i) {
      const type = i.type || "application/octet-stream";
      return mapF(await gfetch(UAPI + "files/" + encodeURIComponent(i.fileId) + "?uploadType=media&fields=" + FIELDS, { method: "PATCH", headers: { "Content-Type": type }, body: new Blob([i.data], { type }) }).then(json));
    },
    async update_file(i) {
      const id = encodeURIComponent(i.fileId); let out = null;
      if (i.parentId) {
        const cur = await gfetch(DAPI + "files/" + id + "?fields=parents").then(json);
        const p = new URLSearchParams({ addParents: i.parentId, fields: FIELDS }); const old = (cur.parents || []).filter(x => x !== i.parentId); if (old.length) p.set("removeParents", old.join(","));
        out = await gfetch(DAPI + "files/" + id + "?" + p, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" }).then(json);
      }
      if (i.title) out = await gfetch(DAPI + "files/" + id + "?fields=" + FIELDS, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: i.title }) }).then(json);
      return mapF(out);
    },
    async trash_file(i) {
      return mapF(await gfetch(DAPI + "files/" + encodeURIComponent(i.fileId) + "?fields=" + FIELDS, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) }).then(json));
    },
    async file_version(i) {
      return gfetch(DAPI + "files/" + encodeURIComponent(i.fileId) + "?fields=version,modifiedTime").then(json);
    },
    async download_file_content(i) {
      const r = await gfetch(DAPI + "files/" + encodeURIComponent(i.fileId) + "?alt=media");
      return { content: new Uint8Array(await r.arrayBuffer()) };
    },
  };
  /* Selector oficial de Google Drive: cada persona elige qué PDF comparte con Atril (permiso drive.file). */
  let gapiP = null;
  const loadPicker = () => gapiP ??= new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = "https://apis.google.com/js/api.js"; s.async = true;
    s.onload = () => gapi.load("picker", { callback: res, onerror: () => { gapiP = null; rej(new Error("picker")); } });
    s.onerror = () => { gapiP = null; rej(new Error("No se pudo cargar el selector de Google Drive. Revisa tu conexión.")); };
    document.head.append(s);
  });
  window.__atrilPick = async ({ multi = true } = {}) => {
    if (!token || Date.now() > tokenExp) { showReauth(); throw { code: "needs_reauth" }; }
    if (!cfg.pickerKey) throw { code: "no_picker", message: "Falta la clave del selector de Google Drive en config.js." };
    await loadPicker();
    return new Promise((res) => {
      const P = google.picker;
      const mine = new P.DocsView(P.ViewId.DOCS).setMimeTypes("application/pdf").setIncludeFolders(true).setSelectFolderEnabled(false).setMode(P.DocsViewMode.LIST);
      const recent = new P.DocsView(P.ViewId.RECENTLY_PICKED);
      const b = new P.PickerBuilder().addView(mine).addView(recent).setOAuthToken(token).setDeveloperKey(cfg.pickerKey).setLocale("es")
        .setTitle(multi ? "Elige uno o varios PDF de tu Google Drive" : "Elige el PDF de este libro en tu Google Drive")
        .setOrigin(location.protocol + "//" + location.host)
        .setCallback((d) => {
          if (d[P.Response.ACTION] === P.Action.PICKED) res((d[P.Response.DOCUMENTS] || []).map(x => ({ id: x[P.Document.ID], title: x[P.Document.NAME], mimeType: x[P.Document.MIME_TYPE], fileSize: x.sizeBytes })));
          else if (d[P.Response.ACTION] === P.Action.CANCEL) res([]);
        });
      if (cfg.appId) b.setAppId(cfg.appId);
      if (multi) b.enableFeature(P.Feature.MULTISELECT_ENABLED);
      if (innerWidth < 640) b.setSize(innerWidth - 16, innerHeight - 40);
      b.build().setVisible(true);
    });
  };

  const MCP = {
    async listTools() { return { fileArgs: true, tools: Object.keys(DRIVE_TOOLS) }; },
    async callTool(_server, tool, input) { const f = DRIVE_TOOLS[tool]; if (!f) throw { code: "tool_error", message: "Operación desconocida: " + tool }; return f(input || {}); },
  };

  /* ---------------- Descargas ---------------- */
  const DOWNLOADS = {
    async save({ filename, data, type }) {
      const blob = data instanceof Blob ? data : new Blob([data], { type: type || (/\.pdf$/i.test(filename) ? "application/pdf" : /\.md$/i.test(filename) ? "text/markdown" : "application/octet-stream") });
      const url = URL.createObjectURL(blob), a = h("a", { href: url, download: filename || "archivo" });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      return { status: "saved" };
    },
  };
  const PERMS = { async state() { return "granted"; }, async manage() { openSettings(); }, async request(names) { return Object.fromEntries((names || []).map(n => [n, "granted"])); } };
  window.claude = { use: async (name) => ({ downloads: DOWNLOADS, permissions: PERMS, mcp: MCP })[name] || null };

  /* ---------------- Interfaz: pantalla de acceso, ajustes, renovar sesión ---------------- */
  const LOGO = '<svg width="44" height="44" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#2B47D4"/><path d="M18 18h12a6 6 0 0 1 6 6v24a5 5 0 0 0-5-5H18z" fill="#fff"/><path d="M46 18H38a6 6 0 0 0-2 .4V48a5 5 0 0 1 5-5h5z" fill="#C9D3FF"/><circle cx="47" cy="45" r="7" fill="#FFE36E"/><path d="M45 42v6l5-3z" fill="#18201F"/></svg>';
  const GOOGLE_G = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
  let gate, setM, bar;
  function buildUI() {
    gate = h("div", { id: "pfGate", role: "dialog", "aria-modal": "true", "aria-labelledby": "pfTitle" });
    gate.innerHTML = `<div class="pfcard">
      <div class="pflogo">${LOGO}</div>
      <h1 id="pfTitle">Atril</h1>
      <p class="pfsub">Escucha tus PDF, márcalos y pregúntales.</p>
      <div id="pfMain">
        <button class="pfbtn pfg" id="pfLogin" type="button">${GOOGLE_G}<span>Iniciar sesión con Google</span></button>
        <p class="pfmsg" id="pfMsg" role="status" aria-live="polite"></p>
      </div>
      <div id="pfOff" hidden>
        <p class="pfwarn" id="pfOffText"></p>
        <div id="pfOffForm" hidden>
          <label class="pff"><span>PIN de Atril</span><input id="pfOffPin" type="password" inputmode="numeric" autocomplete="off" maxlength="12"></label>
          <button class="pfbtn pfprimary" id="pfOffGo" type="button" style="width:100%">Entrar sin conexión</button>
          <p class="pfmsg" id="pfOffMsg" role="status" aria-live="polite"></p>
        </div>
      </div>
      <div id="pfOwner" hidden>
        <p class="pfwarn" id="pfOwnerText"></p>
        <div class="pfrow"><button class="pfbtn" id="pfOwnerNo" type="button">Cancelar</button><button class="pfbtn pfdanger" id="pfOwnerYes" type="button">Borrar y continuar</button></div>
      </div>
      <ul class="pfpoints">
        <li><b>Privado.</b> Tus libros se guardan en este navegador y en la carpeta «Atril - biblioteca» de tu Google Drive. Nadie más tiene acceso.</li>
        <li><b>Pregunta en la IA que prefieras.</b> Atril prepara y copia tu consulta con el texto del PDF para que la pegues en ChatGPT, Gemini o Claude.</li>
        <li><b>Cada cuenta es privada.</b> Solo ves la biblioteca de la cuenta con la que entras, y al cerrar sesión no queda nada en este dispositivo.</li>
        <li><b>Cada vez que abres Atril</b> tienes que iniciar sesión.</li>
      </ul>
      <button class="pflink" id="pfOpenSet" type="button">Ajustes de Google</button>
    </div>`;
    setM = h("div", { id: "pfSet", role: "dialog", "aria-modal": "true", "aria-labelledby": "pfSetTitle", hidden: "" });
    setM.innerHTML = `<div class="pfcard pfwide">
      <div class="pfhead"><h2 id="pfSetTitle">Ajustes</h2><button class="pfx" id="pfSetClose" type="button" aria-label="Cerrar">✕</button></div>
      <section id="pfAcct" hidden>
        <h3>Cuenta de Google</h3>
        <p class="pfline" id="pfWho"></p>
        <div class="pfrow wrap"><button class="pfbtn" id="pfSyncNow" type="button">Guardar en Drive ahora</button><button class="pfbtn" id="pfLogout" type="button">Cerrar sesión</button></div>
        <p class="pfhint">Al cerrar sesión, Atril guarda tus cambios en Google Drive y no deja tu biblioteca en este dispositivo.</p>
      </section>
      <section id="pfOffSet" hidden>
        <h3>Sin conexión</h3>
        <p class="pfline" id="pfOffState"></p>
        <label class="pff"><span>PIN para entrar sin internet (4 a 12 números)</span><input id="pfPinNew" type="password" inputmode="numeric" autocomplete="new-password" maxlength="12" placeholder="••••"></label>
        <div class="pfrow wrap"><button class="pfbtn pfprimary" id="pfPinSave" type="button">Guardar PIN</button><button class="pfbtn" id="pfPinDel" type="button" hidden>Quitar acceso sin conexión</button></div>
        <p class="pfhint">Con internet siempre se entra con Google. Sin internet, Atril pide este PIN y abre tu biblioteca guardada en este dispositivo; los cambios se suben a Drive cuando vuelvas a iniciar sesión con conexión. Gemma funciona sin internet si ya la descargaste aquí.</p>
      </section>
      <section>
        <h3>Google</h3>
        <label class="pff"><span>ID de cliente OAuth</span><input id="pfCid" spellcheck="false" autocomplete="off" placeholder="1234567890-abc.apps.googleusercontent.com"></label>
        <p class="pfhint">Atril solo puede ver la carpeta «Atril - biblioteca» que él mismo crea y los PDF que tú eliges en «Abrir desde Drive». No puede ver el resto de tu Drive.</p>
        <p class="pfhint">Es gratis. La guía paso a paso está en el <a href="https://github.com/gavg1797/atril#configurar-google-drive-gratis" target="_blank" rel="noopener">README del proyecto</a>.</p>
      </section>
      <div class="pfrow end"><button class="pfbtn pfprimary" id="pfSave" type="button">Guardar</button></div>
    </div>`;
    bar = h("div", { id: "pfBar", hidden: "" });
    bar.innerHTML = `<span>Tu sesión de Google venció. Los cambios esperan para guardarse en Drive.</span><button class="pfbtn pfprimary" id="pfRenew" type="button">Renovar sesión</button>`;
    document.body.append(gate, setM, bar);

    $("#pfLogin").addEventListener("click", login);
    $("#pfOffGo").addEventListener("click", offlineEnter);
    $("#pfOffPin").addEventListener("keydown", (e) => { if (e.key === "Enter") offlineEnter(); });
    $("#pfPinSave").addEventListener("click", async () => {
      const pin = $("#pfPinNew").value.trim();
      if (!/^\d{4,12}$/.test(pin)) { toast("El PIN debe tener de 4 a 12 números."); return; }
      const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
      localStorage.setItem(OFF_KEY, JSON.stringify({ sub: user.sub, salt, hash: await pinHash(pin, salt) }));
      renderOffSet(); toast("Listo: podrás entrar a Atril sin internet con ese PIN.");
    });
    $("#pfPinDel").addEventListener("click", () => { localStorage.removeItem(OFF_KEY); renderOffSet(); toast("Se quitó el acceso sin conexión."); });
    addEventListener("offline", renderOffGate);
    addEventListener("online", () => {
      renderOffGate();
      if (!started) return;
      if (token && Date.now() < tokenExp) window.__atrilSyncNow?.();
      else showReauth("Volviste a tener internet. Inicia sesión para guardar tus cambios en Drive.");
    });
    renderOffGate();
    $("#pfOpenSet").addEventListener("click", openSettings);
    $("#pfSetClose").addEventListener("click", closeSettings);
    setM.addEventListener("click", (e) => { if (e.target === setM) closeSettings(); });
    addEventListener("keydown", (e) => { if (e.key === "Escape" && !setM.hidden) closeSettings(); });
    $("#pfSave").addEventListener("click", saveSettings);
    $("#pfRenew").addEventListener("click", renew);
    $("#pfLogout").addEventListener("click", () => { closeSettings(); askLogout(); });
    $("#pfSyncNow").addEventListener("click", async () => { const b = $("#pfSyncNow"); b.disabled = true; b.textContent = "Guardando…"; try { await window.__atrilSyncNow?.(); } finally { b.disabled = false; b.textContent = "Guardar en Drive ahora"; } });
    if (!cfg.googleClientId) msg("Primero pega tu ID de cliente de Google en «Ajustes de Google».", true);
    if (NBWIN) {
      const hd = fromOpener(), own = ownerRec();
      if (hd?.user && (!own || own.sub === hd.user.sub)) { token = hd.token; tokenExp = hd.tokenExp || 0; user = hd.user; offlineMode = !!hd.offlineMode; start(); }
    }
  }
  const b64 = (u8) => btoa(String.fromCharCode(...u8));
  async function pinHash(pin, salt) {
    const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: Uint8Array.from(atob(salt), c => c.charCodeAt(0)), iterations: 250000 }, k, 256);
    return b64(new Uint8Array(bits));
  }
  const offRec = () => { try { return JSON.parse(localStorage.getItem(OFF_KEY) || "null"); } catch { return null; } };
  const ownerRec = () => { try { return JSON.parse(localStorage.getItem(OWNER_KEY) || "null"); } catch { return null; } };
  function renderOffGate() {
    if (!gate || started) return;
    const off = !navigator.onLine || gate.dataset.gisFail === "1", rec = offRec(), own = ownerRec();
    $("#pfOff").hidden = !off;
    if (!off) return;
    const ok = rec && own && rec.sub === own.sub;
    $("#pfOffText").textContent = ok ? `Sin internet. Puedes abrir la biblioteca de ${own.email} guardada en este dispositivo con tu PIN de Atril.` : "Sin internet. Para usar Atril sin conexión, activa un PIN en Ajustes → Sin conexión la próxima vez que entres con internet.";
    $("#pfOffForm").hidden = !ok;
  }
  async function offlineEnter() {
    const rec = offRec(), own = ownerRec(), pin = $("#pfOffPin").value.trim(), out = $("#pfOffMsg");
    if (!rec || !own || rec.sub !== own.sub) return;
    const wait = (rec.fails || 0) >= 5 ? Math.min(300, 15 * 2 ** ((rec.fails || 0) - 5)) * 1000 - (Date.now() - (rec.last || 0)) : 0;
    if (wait > 0) { out.textContent = `Demasiados intentos. Espera ${Math.ceil(wait / 1000)} s.`; out.classList.add("warn"); return; }
    if ((await pinHash(pin, rec.salt)) !== rec.hash) {
      rec.fails = (rec.fails || 0) + 1; rec.last = Date.now(); localStorage.setItem(OFF_KEY, JSON.stringify(rec));
      out.textContent = "PIN incorrecto."; out.classList.add("warn"); return;
    }
    rec.fails = 0; localStorage.setItem(OFF_KEY, JSON.stringify(rec));
    user = { sub: own.sub, email: own.email, name: "" }; offlineMode = true; start();
  }
  function renderOffSet() {
    const sec = $("#pfOffSet"); sec.hidden = !user; if (!user) return;
    const rec = offRec(), on = rec && rec.sub === user.sub;
    $("#pfOffState").textContent = on ? "Acceso sin conexión activado en este dispositivo." : "Acceso sin conexión desactivado.";
    $("#pfPinDel").hidden = !on; $("#pfPinSave").textContent = on ? "Cambiar PIN" : "Guardar PIN"; $("#pfPinNew").value = "";
  }
  const msg = (t, warn) => { const m = $("#pfMsg"); m.textContent = t || ""; m.classList.toggle("warn", !!warn); };

  function openSettings() {
    $("#pfCid").value = cfg.googleClientId || "";
    renderOffSet(); $("#pfAcct").hidden = !user; if (user) $("#pfWho").textContent = `${user.name ? user.name + " · " : ""}${user.email || ""}`;
    setM.hidden = false;
  }
  function closeSettings() { setM.hidden = true; }
  function saveSettings() {
    const prevCid = cfg.googleClientId;
    cfg.googleClientId = $("#pfCid").value.trim();
    saveCfg(); closeSettings();
    if (!user) msg(cfg.googleClientId ? "" : "Primero pega tu ID de cliente de Google en «Ajustes de Google».", !cfg.googleClientId);
    else if (prevCid !== cfg.googleClientId) { token = null; showReauth("Cambiaste los permisos de Google. Renueva la sesión para aplicarlos."); }
  }
  function toast(t) { const n = document.getElementById("toast"); if (!n) return; n.textContent = t; n.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { n.hidden = true; }, 4500); }
  function showReauth(text) { if (!started || !bar) return; if (text) bar.firstElementChild.textContent = text; bar.hidden = false; }
  async function renew() {
    const b = $("#pfRenew"); b.disabled = true;
    try {
      await signIn("");
      const me = await whoAmI();
      if (me.sub !== user.sub) { location.reload(); return; }
      offlineMode = false; user = { ...user, ...me };
      bar.hidden = true; bar.firstElementChild.textContent = "Tu sesión de Google venció. Los cambios esperan para guardarse en Drive.";
      window.__atrilDriveResume?.();
    } catch (e) { bar.firstElementChild.textContent = e.message || "No se pudo renovar la sesión."; }
    finally { b.disabled = false; }
  }
  // Limpia restos de versiones anteriores (bibliotecas guardadas aparte por cuenta).
  async function cleanupLegacy() {
    const del = (n) => new Promise((res) => { try { const r = indexedDB.deleteDatabase(n); r.onsuccess = r.onerror = r.onblocked = () => res(); } catch { res(); } });
    try { localStorage.removeItem("atril@cuentas"); } catch {}
    await del("atril-cuentas");
    try { const dbs = await indexedDB.databases?.(); for (const d of dbs || []) if (d.name && d.name.startsWith("atril-u-")) await del(d.name); } catch {}
  }
  const personalKeys = () => Object.keys(localStorage).filter(k => k.startsWith("atril-") && k !== CFG_KEY && k !== OWNER_KEY);
  async function wipeDevice() {
    // borra toda la información personal de este dispositivo (la copia de Google Drive no se toca)
    await new Promise((res) => { try { const r = indexedDB.deleteDatabase("atril"); r.onsuccess = r.onerror = r.onblocked = () => res(); } catch { res(); } });
    try { for (const k of personalKeys()) localStorage.removeItem(k); localStorage.removeItem(OWNER_KEY); } catch {}
    await cleanupLegacy();
    try { for (const k of await caches.keys()) if (k.startsWith("atril-data")) await caches.delete(k); } catch {}
  }
  // Cerrar sesión: guarda en Google Drive y borra todo de este dispositivo.
  async function logout(force) {
    if (window.__atrilPending?.() && token) { try { await window.__atrilSyncNow?.(); } catch {} }
    if (!force && window.__atrilPending?.()) {
      const go = await confirmUnsaved();
      if (!go) return false;
    }
    // evita que el lector vuelva a escribir algo al salir de la página
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (this === localStorage && String(k).startsWith("atril-") && k !== CFG_KEY) return; return set.call(this, k, v); };
    await wipeDevice();
    try { if (token) google.accounts.oauth2.revoke(token, () => {}); } catch {}
    token = null; user = null;
    location.reload();
    return true;
  }
  function confirmUnsaved() {
    return new Promise((res) => {
      const d = document.getElementById("pfOut"); if (!d) { res(true); return; }
      const card = d.querySelector(".pfcard"); const keep = card.innerHTML;
      card.innerHTML = `<div class="pfhead"><h2>Cambios sin guardar</h2></div>
        <p class="pfwarn">No se pudieron guardar tus últimos cambios en Google Drive (sin internet o la sesión de Google venció). Si cierras sesión ahora, esos cambios se perderán.</p>
        <div class="pfrow wrap" style="margin-top:14px"><button class="pfbtn" id="pfUnsNo" type="button">Volver a Atril</button><button class="pfbtn pfdanger" id="pfUnsYes" type="button">Cerrar sesión de todos modos</button></div>`;
      d.hidden = false;
      const done = (v) => { card.innerHTML = keep; d.hidden = true; d.__wired = false; res(v); };
      card.querySelector("#pfUnsNo").onclick = () => done(false);
      card.querySelector("#pfUnsYes").onclick = () => done(true);
    });
  }

  async function login() {
    const b = $("#pfLogin"); b.disabled = true; msg("Abriendo Google…");
    try {
      await signIn("select_account");
      msg("Comprobando tu cuenta…");
      const me = await whoAmI();
      const owner = (() => { try { return JSON.parse(localStorage.getItem(OWNER_KEY) || "null"); } catch { return null; } })();
      // Privacidad: en este dispositivo solo puede haber información de la cuenta que inicia sesión.
      // Si quedó algo de otra cuenta (por ejemplo, cerró el navegador sin cerrar sesión), se borra; su copia está en su Google Drive.
      if (owner && owner.sub !== me.sub) { msg("Preparando tu biblioteca…"); await wipeDevice(); }
      await cleanupLegacy();
      window.__atrilDbName = "atril";
      user = me;
      try { localStorage.setItem(OWNER_KEY, JSON.stringify({ sub: me.sub, email: me.email })); } catch {}
      start();
    } catch (e) {
      msg(e.message || "No se pudo iniciar sesión.", true); b.disabled = false;
      if (!navigator.onLine || /cargar el inicio de sesión/.test(e.message || "")) { gate.dataset.gisFail = "1"; renderOffGate(); }
    }
  }
  function start() {
    if (started) return; started = true;
    // Gemma ya no se usa: se borra el modelo que se hubiera descargado (libera hasta 3 GB)
    (async () => { try { await (await navigator.storage.getDirectory()).removeEntry("atril-models", { recursive: true }); } catch {} })();
    window.__atrilDbName = "atril";
    try { const st = JSON.parse(localStorage.getItem("atril-drive") || "{}"); st.on = true; localStorage.setItem("atril-drive", JSON.stringify(st)); } catch {}
    gate.remove();
    document.documentElement.classList.add("pf-in");
    const src = document.getElementById("atrilMain");
    const s = document.createElement("script"); s.textContent = src.textContent; document.body.append(s);
    setInterval(() => { if (token && Date.now() > tokenExp) { if (NBWIN && takeOpenerToken()) return; token = null; showReauth(); } }, 30000);
    try { navigator.storage?.persist?.(); } catch {}
    addLogoutButton();
    setTimeout(setupReaderUI, 0);
    if (offlineMode) setTimeout(() => toast(navigator.onLine ? "Entraste sin sesión de Google: inicia sesión para guardar en Drive." : "Modo sin conexión: tus cambios se guardan en este dispositivo y se subirán a Drive cuando vuelvas a tener internet."), 800);
  }
  // Botón «Cerrar sesión» visible en la barra superior (además del que está en Ajustes)
  function addLogoutButton() {
    const top = document.querySelector("header.top");
    if (!top || document.getElementById("pfOutBtn")) return;
    const b = h("button", { id: "pfOutBtn", class: "btn pfoutbtn", type: "button", title: user?.email ? `Cerrar sesión (${user.email})` : "Cerrar sesión" });
    b.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4"/></svg><span>Cerrar sesión</span>`;
    b.addEventListener("click", askLogout);
    const up = document.getElementById("uploadTop");
    if (up) top.insertBefore(b, up); else top.append(b);
    // «Sesión iniciada con …»
    const email = user?.email || "";
    if (email) {
      const who = h("div", { id: "pfWhoChip", class: "pfwho", title: email });
      who.innerHTML = `<span class="pfava" aria-hidden="true"></span><span class="pfwtx"><small>Sesión iniciada con</small><b></b></span>`;
      who.querySelector(".pfava").textContent = email.slice(0, 1).toUpperCase();
      who.querySelector("b").textContent = email;
      top.insertBefore(who, b);
    }
  }
  /* ---------- Modo lectura, menú «Más», ayuda y recorrido guiado ---------- */
  function setupReaderUI() {
    // Modo lectura
    const rb = document.getElementById("readModeBtn");
    const syncRead = () => { const on = document.documentElement.dataset.read === "libro"; if (rb) { rb.setAttribute("aria-pressed", String(on)); rb.title = on ? "Volver a los colores normales" : "Colores de libro, más cómodos para leer"; } };
    rb?.addEventListener("click", () => {
      const on = document.documentElement.dataset.read !== "libro";
      if (on) document.documentElement.dataset.read = "libro"; else delete document.documentElement.dataset.read;
      try { localStorage.setItem(READ_KEY, on ? "1" : "0"); } catch {}
      syncRead(); toast(on ? "Modo lectura activado: colores de libro." : "Colores normales.");
    });
    syncRead();
    // Menú «Más»: las acciones menos usadas salen de la barra para que se vea más simple
    const more = document.getElementById("moreBtn");
    if (more && !document.getElementById("moreMenu")) {
      const menu = h("div", { id: "moreMenu", class: "moremenu", role: "menu", hidden: "" });
      for (const id of ["followBtn", "bmPlaceBtn", "newPdfBtn", "editDocBtn", "splitBtn", "castBtn", "dlBtn", "resetBtn", "permBtn"]) { const el = document.getElementById(id); if (el) menu.append(el); }
      document.body.append(menu);
      const close = () => { menu.hidden = true; more.setAttribute("aria-expanded", "false"); };
      // Las acciones de la barra (que ahí solo muestran el ícono) aparecen aquí con su nombre
      const PROXY = ["readModeBtn", "nbBtn", "pdfFullMenu", "doneBtn"];
      const shown = (el) => el && !el.hidden && el.offsetParent !== null;
      const buildProxies = () => {
        menu.querySelectorAll(".mproxy,.msep").forEach(n => n.remove());
        const first = menu.firstChild, frag = document.createDocumentFragment();
        for (const id of PROXY) {
          const src = document.getElementById(id); if (!shown(src)) continue;
          const lab = (src.querySelector(":scope > span:not(.gdot)")?.textContent || src.title || "").trim();
          const b = h("button", { type: "button", class: "btn mproxy", role: "menuitem" });
          const ico = src.querySelector("svg"); if (ico) b.append(ico.cloneNode(true));
          b.append(h("span", {}, lab));
          if (src.hasAttribute("aria-pressed")) b.setAttribute("aria-pressed", src.getAttribute("aria-pressed"));
          b.addEventListener("click", () => src.click());
          frag.append(b);
        }
        const seg = document.getElementById("modeSeg");
        if (seg && !seg.hidden && shown(seg)) for (const sb of seg.querySelectorAll("button")) {
          const b = h("button", { type: "button", class: "btn mproxy", role: "menuitemradio" });
          const ico = sb.querySelector("svg"); if (ico) b.append(ico.cloneNode(true));
          b.append(h("span", {}, "Ver: " + (sb.querySelector("span")?.textContent || sb.textContent).trim()));
          b.setAttribute("aria-pressed", sb.getAttribute("aria-pressed") || "false");
          b.addEventListener("click", () => sb.click());
          frag.append(b);
        }
        if (frag.childNodes.length) { frag.append(h("div", { class: "msep", role: "separator" })); menu.insertBefore(frag, first); }
      };
      const open = () => {
        buildProxies();
        menu.hidden = false; more.setAttribute("aria-expanded", "true");
        const r = more.getBoundingClientRect(), w = menu.offsetWidth, hgt = menu.offsetHeight;
        menu.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + "px";
        menu.style.top = (r.bottom + 6 + hgt < innerHeight ? r.bottom + 6 : Math.max(8, r.top - hgt - 6)) + "px";
      };
      more.addEventListener("click", (e) => { e.stopPropagation(); menu.hidden ? open() : close(); });
      menu.addEventListener("click", (e) => { if (e.target.closest("button")) setTimeout(close, 0); });
      document.addEventListener("pointerdown", (e) => { if (!menu.hidden && !menu.contains(e.target) && e.target !== more && !more.contains(e.target)) close(); });
      addEventListener("resize", close);
    }
    // En la barra solo se ven íconos: el nombre del botón queda como texto emergente (y se actualiza si cambia)
    const rt = document.querySelector(".rtools");
    if (rt) {
      const sync = () => { for (const b of rt.querySelectorAll(":scope > .btn")) { const sp = b.querySelector(":scope > span:not(.gdot)"); const t = sp?.textContent.trim(); if (t && (b.dataset.autoTitle || !b.title)) { b.title = t; b.setAttribute("aria-label", t); b.dataset.autoTitle = "1"; } } };
      sync(); new MutationObserver(sync).observe(rt, { subtree: true, characterData: true, childList: true });
    }
    // Botón de ayuda en la barra superior
    const top = document.querySelector("header.top");
    if (top && !document.getElementById("helpBtn")) {
      const hb = h("button", { id: "helpBtn", class: "btn helpbtn", type: "button", title: "Guía: cómo usar Atril", "aria-label": "Guía: cómo usar Atril" }); hb.textContent = "?";
      hb.addEventListener("click", startGuide);
      const out = document.getElementById("pfWhoChip") || document.getElementById("pfOutBtn");
      if (out) top.insertBefore(hb, out); else top.append(hb);
    }
    // La primera vez, el recorrido arranca solo
    let seen = false; try { seen = localStorage.getItem(GUIDE_KEY) === "1"; } catch {}
    if (!seen && !NBWIN) setTimeout(startGuide, 900);
  }
  const tab = (t) => () => { const b = document.querySelector(`.tabs [data-tab="${t}"]`); if (b && getComputedStyle(b.parentElement).display !== "none") b.click(); };
  // Para los pasos del lector: si no hay un documento abierto, abre el primero de la biblioteca (por ejemplo, la guía de Atril)
  const reader = () => {
    const rb = document.getElementById("readModeBtn"); const vis = rb && rb.getBoundingClientRect().width > 0;
    if (vis) return;
    if (document.body.classList.contains("focus")) { document.getElementById("showMenu")?.click(); if (document.getElementById("readModeBtn")?.getBoundingClientRect().width > 0) return; }
    const li = document.querySelector("#docs li.doc"); if (li) li.click(); else tab("read")();
    setTimeout(() => { if (document.body.classList.contains("focus")) document.getElementById("showMenu")?.click(); }, 150);
  };
  function startGuide() {
    if (!window.Guia) return;
    Guia.start([
      { title: "¡Bienvenido a Atril!", text: "Te muestro en un minuto cómo usarlo: subir tus PDF, escucharlos, leerlos con comodidad y preguntarles." },
      { sel: "#uploadTop", title:"Sube tus PDF", text: "Toca «Subir PDF» o arrastra el archivo a la ventana. También puedes traerlos desde Google Drive." },
      { sel: ["#docs", ".lib .drop"], before: tab("lib"), title:"Tu biblioteca", text: "Aquí están tus documentos. Toca uno para abrirlo. Arriba puedes filtrar Pendientes o Leídos y crear carpetas." },
      { sel: "#libMoreBtn", before: tab("lib"), title: "Más opciones de la biblioteca", text: "Aquí están Subcarpeta, Crear PDF nuevo, Abrir desde Drive, Importar y Exportar biblioteca y el estado de Google Drive. Tus libros, marcas y notas se guardan solos en tu Drive." },
      { sel: ["#playBtn", "#mpPlay"], before: reader, title:"Escucha el documento", text: "Toca ▶ para que Atril lea en voz alta. Puedes cambiar la voz y la velocidad en las opciones de audio." },
      { sel: "#readModeBtn", before: reader, title:"Modo lectura", text: "Cambia a colores de libro (papel cálido y letra oscura). Cansa menos la vista al leer mucho rato. Tócalo de nuevo para volver a los colores normales." },
      { sel: "#moreBtn", before: reader, title:"Más opciones", text: "Aquí están las demás herramientas: crear un PDF, editarlo, dividir la pantalla con el cuaderno, transmitir a la TV, descargar y reiniciar el avance." },
      { sel: "#moreBtn", before: reader, title:"Marca de lectura", text: "El punto verde marca por dónde vas. En «Más» → «Poner marca de lectura» lo colocas en cualquier párrafo; al pausar la lectura, Atril te pregunta si guardas la marca ahí. Toca el botón verde para volver a ella." },
      { sel: "#askBtn", before: reader, title:"Preguntar", text: "Selecciona texto (doble clic) y toca «Preguntar», o escribe tu pregunta. Atril copia la consulta con el texto y la página para que la pegues en ChatGPT, Gemini o Claude." },
      { sel: "#pfWhoChip", title: "Tu cuenta", text: "Aquí ves con qué cuenta de Google entraste. Cada cuenta ve solo su propia biblioteca." },
      { sel: "#pfOutBtn", title: "Cerrar sesión", text: "Al terminar, cierra sesión: tus cambios se guardan en Drive y no queda nada en este dispositivo." },
      { sel: "#helpBtn", title: "¿Dudas?", text: "Toca «?» cuando quieras para repetir esta guía." },
    ], { onEnd: () => { try { localStorage.setItem(GUIDE_KEY, "1"); } catch {} } });
  }
  function askLogout() {
    let d = document.getElementById("pfOut");
    if (!d) {
      d = h("div", { id: "pfOut", role: "dialog", "aria-modal": "true", "aria-labelledby": "pfOutTitle" });
      d.innerHTML = `<div class="pfcard">
        <div class="pfhead"><h2 id="pfOutTitle">Cerrar sesión</h2><button class="pfx" id="pfOutX" type="button" aria-label="Cancelar">✕</button></div>
        <p class="pfline" id="pfOutWho"></p>
        <p class="pfhint">Atril guarda tus cambios en Google Drive y borra tu biblioteca de este dispositivo. Al volver a iniciar sesión se descarga de nuevo desde tu Drive.</p>
        <div class="pfrow wrap" style="margin-top:14px">
          <button class="pfbtn pfprimary" id="pfOutYes" type="button">Cerrar sesión</button>
          <button class="pfbtn" id="pfOutNo" type="button">Cancelar</button>
        </div>
      </div>`;
      document.body.append(d);
      const close = () => { d.hidden = true; };
      d.addEventListener("click", (e) => { if (e.target === d) close(); });
      d.addEventListener("click", (e) => { if (e.target.closest("#pfOutX,#pfOutNo")) close(); });
      addEventListener("keydown", (e) => { if (e.key === "Escape" && !d.hidden) close(); });
      d.addEventListener("click", async (e) => {
        const b = e.target.closest("#pfOutYes"); if (!b) return;
        d.querySelectorAll("button").forEach(x => x.disabled = true); b.textContent = "Guardando y cerrando sesión…";
        const ok = await logout(false);
        if (!ok) { d.querySelectorAll("button").forEach(x => x.disabled = false); const y = d.querySelector("#pfOutYes"); if (y) y.textContent = "Cerrar sesión"; }
      });
    }
    d.querySelector("#pfOutWho").textContent = user?.email ? `Sesión iniciada como ${user.email}.` : (offlineMode ? "Estás usando Atril sin conexión." : "");
    d.hidden = false;
    d.querySelector("#pfOutYes").focus();
  }
  addEventListener("beforeunload", (e) => { if (started && window.__atrilPending?.()) { e.preventDefault(); e.returnValue = ""; } });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", buildUI); else buildUI();
  if ("serviceWorker" in navigator && window.isSecureContext) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
})();
