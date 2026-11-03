/* Atril · capa de plataforma
 * - Inicio de sesión con Google obligatorio en cada arranque (Google Identity Services).
 * - Google Drive por la API REST v3 (la biblioteca vive en la carpeta «Atril - biblioteca»).
 * - Preguntas y traducción con Gemma 4 en Ollama, en tu propia computadora.
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
  const base = Object.assign({ googleClientId: "", ollamaUrl: "http://localhost:11434", model: "gemma4", numCtx: 16384, pickerKey: "", appId: "", engine: "local", localModel: "e2b", localCtx: 4096 }, window.ATRIL_CONFIG || {});
  let cfg = (() => { try { return Object.assign({}, base, JSON.parse(localStorage.getItem(CFG_KEY) || "{}")); } catch { return { ...base }; } })();
  if (!cfg.googleClientId) cfg.googleClientId = base.googleClientId;
  const saveCfg = () => { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch {} };

  let token = null, tokenExp = 0, user = null, started = false, offlineMode = false;
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

  /* ---------------- Gemma 4 en Ollama ---------------- */
  const ollamaBase = () => String(cfg.ollamaUrl || "http://localhost:11434").replace(/\/+$/, "");
  async function ollamaChat(messages, { signal, onText, format, noThink = true } = {}) {
    const msgs = messages.map((m, i) => ({ role: i === 0 && m.role === "user" && messages.length > 1 ? "system" : m.role, content: String(m.content ?? "") }));
    const body = { model: cfg.model || "gemma4", messages: msgs, stream: true, options: { num_ctx: Number(cfg.numCtx) || 16384 } };
    if (format) body.format = format;
    if (noThink) body.think = false;
    let r;
    try { r = await fetch(ollamaBase() + "/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal }); }
    catch (e) { if (signal?.aborted) throw { code: "cancelled" }; throw { code: "ollama_offline", message: e?.message }; }
    if (!r.ok) {
      let t = ""; try { t = (await r.json())?.error || ""; } catch {}
      if (noThink && /think/i.test(t)) return ollamaChat(messages, { signal, onText, format, noThink: false });
      if (r.status === 404 || /not found|pull/i.test(t)) throw { code: "model_missing", message: t };
      throw { code: "ollama_error", message: t || "HTTP " + r.status };
    }
    const rd = r.body.getReader(), dec = new TextDecoder(); let buf = "", text = "", reason = "";
    try {
      for (;;) {
        const { value, done } = await rd.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let k; while ((k = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, k).trim(); buf = buf.slice(k + 1); if (!line) continue;
          let j; try { j = JSON.parse(line); } catch { continue; }
          if (j.error) throw { code: "ollama_error", message: j.error, text };
          if (j.message?.content) { text += j.message.content; onText?.({ text }); }
          if (j.done) reason = j.done_reason || "";
        }
      }
    } catch (e) { if (signal?.aborted || e?.name === "AbortError") throw { code: "cancelled", text }; throw e?.code ? e : { code: "ollama_offline", message: e?.message, text }; }
    return { text, truncated: reason === "length" };
  }
  /* ---------------- Gemma 4 dentro del navegador (WebGPU, todos los dispositivos) ---------------- */
  const GENAI = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@0.10.29";
  const WLL = "https://cdn.jsdelivr.net/npm/@wllama/wllama@3.8.1/esm";
  const HF = "https://huggingface.co/litert-community/";
  // Modo procesador (sin WebGPU): Gemma 4 E2B QAT Q4_0 de Unsloth en formato GGUF, dividido en partes (revisión fija).
  const CPU_REPO = "https://huggingface.co/znasif/gemma-4-E2B-it-qat-Q4_K_XL-split/resolve/57ca239d91056961768dde77efbae958d15af770/";
  const cpuParts = [[1, 23532320], [2, 1321205952], [3, 508734272], [4, 510543744], [5, 256355264]].map(([n, size]) => { const file = `e2b-q4-0000${n}-of-00005.gguf`; return { file, url: CPU_REPO + file, size }; });
  const MODELS = {
    e2b: { label: "Gemma 4 E2B", kind: "webgpu", parts: [{ file: "gemma-4-E2B-it-web.litertlm", url: HF + "gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it-web.litertlm", size: 2008432640 }] },
    e4b: { label: "Gemma 4 E4B", kind: "webgpu", parts: [{ file: "gemma-4-E4B-it-web.litertlm", url: HF + "gemma-4-E4B-it-litert-lm/resolve/main/gemma-4-E4B-it-web.litertlm", size: 2969059328 }] },
    cpu: { label: "Gemma 4 E2B (modo procesador)", kind: "cpu", parts: cpuParts },
  };
  try { for (const [k, v] of Object.entries(window.ATRIL_MODELS || {})) { MODELS[k] = { ...MODELS[k], ...v }; if (v.size && MODELS[k].parts.length === 1) MODELS[k].parts = [{ ...MODELS[k].parts[0], size: v.size }]; } } catch {}
  for (const m of Object.values(MODELS)) m.size = m.parts.reduce((a, p) => a + p.size, 0);
  const engine = () => cfg.engine === "ollama" ? "ollama" : "local";
  const lModel = () => MODELS[cfg.localModel] ? cfg.localModel : "e2b";
  const lCtx = () => Number(cfg.localCtx) || 4096;
  const hasOPFS = () => !!(navigator.storage?.getDirectory && window.FileSystemFileHandle && "createWritable" in FileSystemFileHandle.prototype);
  const CACHE_M = "atril-models";
  async function opfsDir() { return (await navigator.storage.getDirectory()).getDirectoryHandle("atril-models", { create: true }); }
  async function partSize(p) {
    if (hasOPFS()) { try { return (await (await (await opfsDir()).getFileHandle(p.file)).getFile()).size; } catch { return 0; } }
    try { return (await (await caches.open(CACHE_M)).match(p.url)) ? p.size : 0; } catch { return 0; }
  }
  async function modelInfo(key = lModel()) {
    const m = MODELS[key]; let size = 0, complete = true;
    for (const p of m.parts) { const s = Math.min(await partSize(p), p.size); size += s; if (s !== p.size) complete = false; }
    return { size, complete };
  }
  async function modelFiles(key = lModel()) {
    const out = [];
    for (const p of MODELS[key].parts) {
      if (hasOPFS()) { try { const f = await (await (await opfsDir()).getFileHandle(p.file)).getFile(); if (f.size !== p.size) return null; out.push(f); continue; } catch { return null; } }
      try { const r = await (await caches.open(CACHE_M)).match(p.url); if (!r) return null; out.push(new File([await r.blob()], p.file)); } catch { return null; }
    }
    return out;
  }
  async function deleteModel(key = lModel()) {
    await closeLocal();
    for (const p of MODELS[key].parts) {
      try { await (await opfsDir()).removeEntry(p.file); } catch {}
      try { await (await caches.open(CACHE_M)).delete(p.url); } catch {}
    }
    if (key === "cpu") setIsolation(false);
  }
  let DL = null; // descarga en curso { key, ctl, got, total }
  const dlSubs = new Set(); const dlEmit = () => dlSubs.forEach(f => { try { f(DL); } catch {} });
  async function downloadPart(p, base, ctl) {
    let have = hasOPFS() ? Math.min(await partSize(p), p.size) : 0;
    if (have === p.size) { DL.got = base + have; dlEmit(); return; }
    const r = await fetch(p.url, { headers: have ? { Range: `bytes=${have}-` } : {}, signal: ctl.signal });
    if (!r.ok) throw { code: "download", message: "HTTP " + r.status };
    if (have && r.status !== 206) have = 0;
    DL.got = base + have; dlEmit();
    if (hasOPFS()) {
      const h = await (await opfsDir()).getFileHandle(p.file, { create: true });
      let w = await h.createWritable({ keepExistingData: have > 0 }); if (have) await w.seek(have); else await w.truncate(0);
      const rd = r.body.getReader(); let sinceCommit = 0, pos = have;
      try {
        for (;;) {
          const { value, done } = await rd.read(); if (done) break;
          await w.write(value); pos += value.byteLength; DL.got = base + pos; sinceCommit += value.byteLength; dlEmit();
          if (sinceCommit > 64 * 1024 * 1024) { await w.close(); w = await h.createWritable({ keepExistingData: true }); await w.seek(pos); sinceCommit = 0; }
        }
        await w.close();
      } catch (e) { try { await w.close(); } catch {} throw e; }
      if ((await h.getFile()).size !== p.size) throw { code: "download", message: "El archivo quedó incompleto. Toca Descargar para continuar." };
    } else {
      const prog = new TransformStream({ transform(c, ctrl) { DL.got += c.byteLength; dlEmit(); ctrl.enqueue(c); } });
      await (await caches.open(CACHE_M)).put(p.url, new Response(r.body.pipeThrough(prog), { headers: { "Content-Type": "application/octet-stream", "Content-Length": String(p.size) } }));
    }
  }
  async function downloadModel(key = lModel()) {
    if (DL) return;
    const m = MODELS[key];
    if (!navigator.storage) throw { code: "no_storage" };
    try { await navigator.storage.persist?.(); } catch {}
    const info = await modelInfo(key); if (info.complete) return;
    try { const est = await navigator.storage.estimate(); if (est.quota && est.quota - (est.usage || 0) < (m.size - info.size) + 80e6) throw { code: "no_space", need: m.size - info.size }; } catch (e) { if (e?.code) throw e; }
    const ctl = new AbortController(); DL = { key, ctl, got: info.size, total: m.size }; dlEmit();
    try {
      let base = 0;
      for (const p of m.parts) { await downloadPart(p, base, ctl); base += p.size; }
    } catch (e) {
      if (ctl.signal.aborted) throw { code: "paused" };
      throw e?.code ? e : { code: "download", message: e?.message || "sin conexión" };
    } finally { DL = null; dlEmit(); }
    if (key === "cpu") setIsolation(true);
  }
  const pauseDownload = () => DL?.ctl.abort();
  /* Guarda el motor de Gemma para que funcione sin internet; el modelo ya está en el navegador. */
  async function cacheGemmaRuntime(key = lModel()) {
    if (!navigator.onLine) return;
    const list = MODELS[key]?.kind === "cpu" ? [WLL + "/index.js", WLL + "/wasm/wllama.wasm"] : ["/genai_bundle.mjs", "/wasm/genai_wasm_internal.js", "/wasm/genai_wasm_internal.wasm"].map(f => GENAI + f);
    for (const u of list) { try { await fetch(u); } catch {} }
  }
  /* Modo procesador: con aislamiento de documento (lo agrega sw.js) Gemma puede usar varios núcleos. */
  async function setIsolation(on) {
    try { const c = await caches.open("atril-flags"); if (on) await c.put("/__isolate", new Response("1")); else await c.delete("/__isolate"); } catch {}
  }

  let llm = null, llmSig = "", llmP = null;
  async function closeLocal() { const x = llm; llm = null; llmSig = ""; try { await x?.close(); } catch {} }
  async function webgpuOK() { try { return !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch { return false; } }
  const cleanOut = (t) => String(t).replace(/<\|channel>[\s\S]*?(<channel\|>|$)/g, "").replace(/<\|?turn\|?>(model|user|system)?\n?/g, "").replace(/<turn\|>/g, "").replace(/^\s+/, "");
  const ROLE = { user: "user", assistant: "model", model: "model", system: "system" };
  function render(msgs) { return msgs.map(x => `<|turn>${ROLE[x.role] || "user"}\n${x.content}<turn|>\n`).join("") + "<|turn>model\n"; }
  function trimChars(msgs, maxChars) {
    for (let k = 0; k < 8; k++) {
      const n = msgs.reduce((a, m) => a + m.content.length, 0); if (n <= maxChars) break;
      if (msgs.length > 2) { msgs.splice(1, 1); continue; }
      const big = msgs.reduce((a, b) => (b.content.length > a.content.length ? b : a));
      big.content = big.content.slice(0, Math.max(500, big.content.length - (n - maxChars) - 200)) + "\n[…recortado para que quepa en la memoria del modelo]";
    }
    return msgs;
  }
  async function loadMediaPipe(key) {
    if (!(await webgpuOK())) throw { code: "no_webgpu" };
    const files = await modelFiles(key); if (!files) throw { code: "model_not_downloaded" };
    const { FilesetResolver, LlmInference } = await import(GENAI + "/genai_bundle.mjs");
    const fs = await FilesetResolver.forGenAiTasks(GENAI + "/wasm");
    const m = await LlmInference.createFromOptions(fs, { baseOptions: { modelAssetBuffer: files[0].stream().getReader() }, maxTokens: lCtx(), topK: 40, temperature: 0.6 });
    return {
      close: () => m.close(),
      async gen(msgs, onText, signal) {
        const budget = lCtx() - 700;
        for (let k = 0; k < 6; k++) {
          let n; try { n = m.sizeInTokens(render(msgs)); } catch { break; }
          if (!n || n <= budget) break;
          if (msgs.length > 2) { msgs.splice(1, 1); continue; }
          const big = msgs.reduce((a, b) => (b.content.length > a.content.length ? b : a));
          big.content = big.content.slice(0, Math.floor(big.content.length * Math.max(0.3, (budget / n) * 0.92))) + "\n[…recortado para que quepa en la memoria del modelo]";
        }
        let raw = ""; const onAbort = () => { try { m.cancelProcessing(); } catch {} };
        signal?.addEventListener("abort", onAbort);
        try { await m.generateResponse(render(msgs), (part) => { raw += part; onText(cleanOut(raw)); }); }
        catch (e) { if (signal?.aborted) throw { code: "cancelled", text: cleanOut(raw) }; throw { code: "local_error", message: e?.message || String(e), text: cleanOut(raw) }; }
        finally { signal?.removeEventListener("abort", onAbort); try { m.clearCancelSignals?.(); } catch {} }
        return raw;
      },
    };
  }
  async function loadCpu(key) {
    const files = await modelFiles(key); if (!files) throw { code: "model_not_downloaded" };
    const { Wllama } = await import(WLL + "/index.js");
    const w = new Wllama({ default: WLL + "/wasm/wllama.wasm" }, { suppressNativeLog: true });
    await w.loadModel(files, { n_ctx: lCtx(), n_gpu_layers: 0, n_batch: 256, warmup: false, default_template_kwargs: { enable_thinking: false } });
    return {
      threads: (() => { try { return w.getNumThreads(); } catch { return 1; } })(),
      close: () => w.exit(),
      async gen(msgs, onText, signal) {
        trimChars(msgs, Math.max(2500, (lCtx() - 1000) * 3));
        let raw = "";
        try {
          await w.createChatCompletion({ messages: msgs, stream: true, max_tokens: 700, temperature: 0.6, abortSignal: signal,
            onData: (c) => { const d = c?.choices?.[0]?.delta?.content; if (d) { raw += d; onText(cleanOut(raw)); } } });
        } catch (e) { if (signal?.aborted) throw { code: "cancelled", text: cleanOut(raw) }; throw { code: "local_error", message: e?.message || String(e), text: cleanOut(raw) }; }
        return raw;
      },
    };
  }
  async function loadLocal() {
    const key = lModel(), sig = key + "|" + lCtx();
    if (llm && llmSig === sig) return llm;
    if (llmP) return llmP;
    llmP = (async () => {
      await closeLocal();
      llm = MODELS[key].kind === "cpu" ? await loadCpu(key) : await loadMediaPipe(key);
      llmSig = sig; return llm;
    })().catch(e => { throw e?.code ? e : { code: "local_load", message: e?.message || String(e) }; }).finally(() => { llmP = null; });
    return llmP;
  }
  let gate0 = Promise.resolve();
  const exclusive = (fn) => { const p = gate0.then(fn, fn); gate0 = p.catch(() => {}); return p; };
  async function localChat(messages, { signal, onText } = {}) {
    return exclusive(async () => {
      if (signal?.aborted) throw { code: "cancelled" };
      const cpu = MODELS[lModel()].kind === "cpu";
      let shown = false;
      if (!llm || llmSig !== lModel() + "|" + lCtx()) { onText?.({ text: cpu ? "_Cargando Gemma en modo procesador… puede tardar uno o dos minutos la primera vez de cada sesión._" : "_Cargando Gemma en este dispositivo… La primera vez de cada sesión tarda un poco._" }); shown = true; }
      const m = await loadLocal();
      if (cpu && !shown) onText?.({ text: "_Gemma está leyendo el documento… (en modo procesador tarda un poco antes de empezar a escribir)_" });
      else if (cpu) onText?.({ text: "_Gemma está leyendo el documento…_" });
      const msgs = messages.map((x, i) => ({ role: i === 0 && x.role === "user" && messages.length > 1 ? "system" : x.role, content: String(x.content ?? "") }));
      const raw = await m.gen(msgs, (t) => { if (t || shown) onText?.({ text: t || "…" }); }, signal);
      if (signal?.aborted) throw { code: "cancelled", text: cleanOut(raw) };
      return { text: cleanOut(raw).trim(), truncated: false };
    });
  }
  window.__atrilCtxChars = () => engine() === "local" ? Math.max(2500, (lCtx() - (MODELS[lModel()].kind === "cpu" ? 1400 : 1600)) * 3) : Math.max(8000, ((Number(cfg.numCtx) || 16384) - 3500) * 3);

  const chat = (msgs, opts) => engine() === "local" ? localChat(msgs, opts) : ollamaChat(msgs, opts);
  const SAMPLE = async (input, opts = {}) => {
    try { return await chat(typeof input === "string" ? [{ role: "user", content: input }] : input, opts); }
    catch (e) { if (e?.code === "model_not_downloaded" || e?.code === "no_webgpu") setTimeout(() => openSettings("gemma"), 400); throw e; }
  };
  SAMPLE.json = async (prompt, opts = {}) => {
    const { text } = engine() === "local"
      ? await localChat([{ role: "user", content: prompt + "\n\nResponde únicamente con el arreglo JSON, sin texto adicional ni bloques de código." }], { signal: opts.signal })
      : await ollamaChat([{ role: "user", content: prompt }], { signal: opts.signal, format: { type: "array", items: { type: "string" } } });
    try {
      const s = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
      const v = JSON.parse(s.startsWith("[") || s.startsWith("{") ? s : (s.match(/\[[\s\S]*\]/) || [s])[0]);
      if (Array.isArray(v)) return v;
      const arr = v && typeof v === "object" ? Object.values(v).find(Array.isArray) : null;
      if (arr) return arr; throw 0;
    } catch { throw { code: "invalid_json" }; }
  };
  async function ollamaModels() {
    const r = await fetch(ollamaBase() + "/api/tags"); if (!r.ok) throw new Error("HTTP " + r.status);
    return ((await r.json()).models || []).map(m => m.name);
  }

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
  window.claude = { use: async (name) => ({ sample: SAMPLE, downloads: DOWNLOADS, permissions: PERMS, mcp: MCP })[name] || null };

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
        <li><b>Gemma 4 en tu dispositivo.</b> Las preguntas y traducciones las responde Gemma dentro de tu celular, tableta o computadora; el texto no va a otros servicios.</li>
        <li><b>Cada vez que abres Atril</b> tienes que iniciar sesión.</li>
      </ul>
      <button class="pflink" id="pfOpenSet" type="button">Ajustes de Google y Gemma</button>
    </div>`;
    setM = h("div", { id: "pfSet", role: "dialog", "aria-modal": "true", "aria-labelledby": "pfSetTitle", hidden: "" });
    setM.innerHTML = `<div class="pfcard pfwide">
      <div class="pfhead"><h2 id="pfSetTitle">Ajustes</h2><button class="pfx" id="pfSetClose" type="button" aria-label="Cerrar">✕</button></div>
      <section id="pfAcct" hidden>
        <h3>Cuenta de Google</h3>
        <p class="pfline" id="pfWho"></p>
        <div class="pfrow wrap"><button class="pfbtn" id="pfSyncNow" type="button">Guardar en Drive ahora</button><button class="pfbtn" id="pfLogout" type="button">Cerrar sesión</button><button class="pfbtn pfdanger" id="pfWipe" type="button">Cerrar sesión y borrar de este dispositivo</button></div>
        <p class="pfhint">«Borrar de este dispositivo» quita los libros guardados en este navegador. Tu copia en Google Drive no se toca.</p>
      </section>
      <section id="pfOffSet" hidden>
        <h3>Sin conexión</h3>
        <p class="pfline" id="pfOffState"></p>
        <label class="pff"><span>PIN para entrar sin internet (4 a 12 números)</span><input id="pfPinNew" type="password" inputmode="numeric" autocomplete="new-password" maxlength="12" placeholder="••••"></label>
        <div class="pfrow wrap"><button class="pfbtn pfprimary" id="pfPinSave" type="button">Guardar PIN</button><button class="pfbtn" id="pfPinDel" type="button" hidden>Quitar acceso sin conexión</button></div>
        <p class="pfhint">Con internet siempre se entra con Google. Sin internet, Atril pide este PIN y abre tu biblioteca guardada en este dispositivo; los cambios se suben a Drive cuando vuelvas a iniciar sesión con conexión. Gemma funciona sin internet si ya la descargaste aquí.</p>
      </section>
      <section id="pfGemma">
        <h3>Gemma 4</h3>
        <div class="pfseg" role="radiogroup" aria-label="Dónde funciona Gemma">
          <label><input type="radio" name="pfEng" value="local"><span><b>En este dispositivo</b><em>Celular, tableta o computadora. Se descarga una vez desde este sitio.</em></span></label>
          <label><input type="radio" name="pfEng" value="ollama"><span><b>Ollama en mi computadora</b><em>Solo en la computadora donde está instalado Ollama.</em></span></label>
        </div>
        <div id="pfLocal">
          <label class="pff"><span>Modelo</span><select id="pfLModel"><option value="e2b">Gemma 4 E2B · 2,0 GB · recomendado</option><option value="e4b">Gemma 4 E4B · 3,0 GB · computadoras potentes</option><option value="cpu">Gemma 4 E2B · 2,6 GB · modo procesador (sin WebGPU, más lento)</option></select></label>
          <p class="pfhint pfwarn" id="pfGpuNote" hidden></p>
          <label class="pff"><span>Memoria para cada pregunta</span><select id="pfLCtx"><option value="2048">Corta · equipos con poca memoria</option><option value="4096">Normal · recomendada</option><option value="8192">Larga · computadoras</option></select></label>
          <div class="pfdl" id="pfDl"><p class="pfline" id="pfDlText"></p><div class="pfbar" id="pfDlBarW" hidden><i id="pfDlBar"></i></div></div>
          <div class="pfrow wrap"><button class="pfbtn pfprimary" id="pfDlBtn" type="button">Descargar</button><button class="pfbtn" id="pfDlPause" type="button" hidden>Pausar</button><button class="pfbtn" id="pfLTest" type="button">Probar</button><button class="pfbtn pfdanger" id="pfDlDel" type="button" hidden>Borrar de este dispositivo</button></div>
          <p class="pfmsg" id="pfLMsg" role="status" aria-live="polite"></p>
          <p class="pfhint">El modelo viene de Google (Hugging Face, licencia Apache 2.0) y se guarda en este navegador; después funciona sin internet y tus preguntas no salen del dispositivo. Necesita un navegador con WebGPU: Chrome o Edge en computadora y Android, Safari en iPhone y iPad con iOS 26 o más reciente. Conviene descargarlo con wifi.</p>
        </div>
        <div id="pfOll">
          <label class="pff"><span>Dirección de Ollama</span><input id="pfOUrl" type="url" spellcheck="false" autocomplete="off"></label>
          <label class="pff"><span>Modelo</span><input id="pfModel" list="pfModels" spellcheck="false" autocomplete="off" placeholder="gemma4"><datalist id="pfModels"><option value="gemma4"><option value="gemma4:e2b"><option value="gemma4:e4b"><option value="gemma4:26b"><option value="gemma4:31b"></datalist></label>
          <label class="pff"><span>Memoria de contexto (tokens)</span><select id="pfCtx"><option value="8192">8 192 · equipos modestos</option><option value="16384">16 384 · recomendado</option><option value="32768">32 768 · documentos largos</option><option value="65536">65 536 · mucha memoria</option></select></label>
          <div class="pfrow"><button class="pfbtn" id="pfTest" type="button">Probar conexión</button><span class="pfmsg" id="pfTestMsg" role="status" aria-live="polite"></span></div>
          <p class="pfhint">Ollama tiene que estar abierto en esta computadora y permitir este sitio: <code>OLLAMA_ORIGINS=${location.origin}</code>.</p>
        </div>
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
    $("#pfTest").addEventListener("click", testOllama);
    setM.querySelectorAll('input[name="pfEng"]').forEach(r => r.addEventListener("change", () => { lMsg(""); renderLocal(); }));
    $("#pfLModel").addEventListener("change", () => { lMsg(""); renderLocal(); });
    $("#pfDlBtn").addEventListener("click", async () => {
      const key = $("#pfLModel").value; lMsg("");
      if (MODELS[key].kind !== "cpu" && !(await webgpuOK())) { lMsg(localErr({ code: "no_webgpu" }), true); return; }
      try {
        await downloadModel(key); cacheGemmaRuntime(key); cfg.localModel = key; cfg.engine = "local"; saveCfg();
        toast(`${MODELS[key].label} quedó descargado en este dispositivo.`);
        if (key === "cpu" && !self.crossOriginIsolated) lMsg("Listo. Recarga Atril una vez para que Gemma use todos los núcleos del procesador (responde más rápido).");
      }
      catch (e) { lMsg(localErr(e), e?.code !== "paused"); if (e?.code !== "paused") toast(localErr(e)); }
      renderLocal();
    });
    $("#pfDlPause").addEventListener("click", pauseDownload);
    $("#pfDlDel").addEventListener("click", async () => { await deleteModel($("#pfLModel").value); lMsg("Se borró el modelo de este dispositivo."); renderLocal(); });
    $("#pfLTest").addEventListener("click", async () => {
      const b = $("#pfLTest"); b.disabled = true; const keep = { m: cfg.localModel, c: cfg.localCtx };
      cfg.localModel = $("#pfLModel").value; cfg.localCtx = Number($("#pfLCtx").value) || 4096;
      lMsg("Cargando Gemma… (puede tardar hasta un minuto la primera vez)");
      try { const t0 = Date.now(); const { text } = await localChat([{ role: "user", content: "Responde solo con la palabra: listo" }]); lMsg(`Funciona: «${text.slice(0, 40)}» (${((Date.now() - t0) / 1000).toFixed(1)} s${llm?.threads ? `, ${llm.threads} ${llm.threads === 1 ? "núcleo" : "núcleos"}` : ""}).`); }
      catch (e) { lMsg(localErr(e), true); }
      finally { cfg.localModel = keep.m; cfg.localCtx = keep.c; b.disabled = false; renderLocal(); }
    });
    dlSubs.add(() => { renderLocal(); renderPill(); });
    $("#pfRenew").addEventListener("click", renew);
    $("#pfLogout").addEventListener("click", () => logout(false));
    $("#pfWipe").addEventListener("click", () => logout(true));
    $("#pfSyncNow").addEventListener("click", async () => { const b = $("#pfSyncNow"); b.disabled = true; b.textContent = "Guardando…"; try { await window.__atrilSyncNow?.(); } finally { b.disabled = false; b.textContent = "Guardar en Drive ahora"; } });
    if (!cfg.googleClientId) msg("Primero pega tu ID de cliente de Google en «Ajustes de Google y Gemma».", true);
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

  const mb = (n) => (n / 1e9).toLocaleString("es", { maximumFractionDigits: 2 }) + " GB";
  async function renderLocal() {
    if (!setM || setM.hidden) return;
    const key = $("#pfLModel").value, m = MODELS[key], info = await modelInfo(key), busy = DL && DL.key === key;
    $("#pfLocal").hidden = selEngine() !== "local"; $("#pfOll").hidden = selEngine() !== "ollama";
    $("#pfDlBarW").hidden = !(busy || (info.size && !info.complete));
    const got = busy ? DL.got : info.size; $("#pfDlBar").style.width = (got / m.size * 100).toFixed(1) + "%";
    $("#pfDlText").textContent = busy ? `Descargando ${m.label}: ${mb(got)} de ${mb(m.size)} (${Math.floor(got / m.size * 100)}%). Puedes seguir usando Atril.`
      : info.complete ? `${m.label} está listo en este dispositivo (${mb(m.size)}).` + (llm && llmSig.startsWith(key) ? " Cargado en memoria." : "")
      : info.size ? `Descarga pausada: ${mb(info.size)} de ${mb(m.size)}. Toca «Continuar» para seguir donde quedó.`
      : `${m.label} aún no está en este dispositivo. Ocupa ${mb(m.size)}.`;
    $("#pfDlBtn").hidden = busy || info.complete; $("#pfDlBtn").textContent = info.size ? "Continuar descarga" : "Descargar";
    $("#pfDlPause").hidden = !busy; $("#pfDlDel").hidden = busy || !info.size; $("#pfLTest").hidden = !info.complete || busy;
    if (!$("#pfLMsg").dataset.keep) { $("#pfLMsg").textContent = ""; $("#pfLMsg").classList.remove("warn"); }
  }
  const selEngine = () => (setM.querySelector('input[name="pfEng"]:checked') || {}).value || engine();
  const lMsg = (t, warn) => { const n = $("#pfLMsg"); n.textContent = t; n.classList.toggle("warn", !!warn); n.dataset.keep = t ? "1" : ""; };
  const localErr = (e) => ({
    no_webgpu: "Este navegador no tiene WebGPU. Elige «modo procesador» en Modelo: funciona sin tarjeta gráfica, aunque más lento.",
    model_not_downloaded: "Primero descarga el modelo con el botón «Descargar».",
    no_space: `No hay espacio suficiente en este dispositivo (faltan unos ${mb(e?.need || 0)}). Libera espacio e inténtalo de nuevo.`,
    no_storage: "Este navegador no permite guardar archivos grandes. Prueba con Chrome, Edge o Safari actualizados.",
    paused: "Descarga en pausa. Puedes continuarla cuando quieras.",
    local_load: "No se pudo cargar Gemma en este dispositivo. Puede que no tenga memoria suficiente: cierra otras apps y pestañas y elige «Memoria corta». " + (e?.message ? "(" + String(e.message).slice(0, 120) + ")" : ""),
  }[e?.code] || ("Error: " + (e?.message || e?.code || "desconocido")));
  function openSettings(focus) {
    setM.querySelectorAll('input[name="pfEng"]').forEach(r => { r.checked = r.value === engine(); });
    $("#pfLModel").value = lModel(); $("#pfLCtx").value = String(lCtx()); lMsg("");
    webgpuOK().then(async ok => {
      const note = $("#pfGpuNote"); note.hidden = ok;
      if (ok) return;
      note.textContent = "Este navegador no tiene WebGPU (pasa en algunos teléfonos, como los Samsung con procesador Exynos). Usa el «modo procesador»: funciona sin tarjeta gráfica, aunque cada respuesta tarda más.";
      for (const o of $("#pfLModel").options) o.disabled = o.value !== "cpu";
      if ($("#pfLModel").value !== "cpu") { $("#pfLModel").value = "cpu"; renderLocal(); }
    });
    if (focus === "gemma") setTimeout(() => $("#pfGemma").scrollIntoView({ block: "start" }), 50);
    $("#pfOUrl").value = cfg.ollamaUrl; $("#pfModel").value = cfg.model; $("#pfCid").value = cfg.googleClientId || "";
    $("#pfCtx").value = String(cfg.numCtx); if (!$("#pfCtx").value) $("#pfCtx").value = "16384";
    $("#pfTestMsg").textContent = "";
    renderOffSet(); $("#pfAcct").hidden = !user; if (user) $("#pfWho").textContent = `${user.name ? user.name + " · " : ""}${user.email || ""}`;
    setM.hidden = false; renderLocal();
    ollamaModels().then(list => { const dl = $("#pfModels"); const have = new Set([...dl.options].map(o => o.value)); for (const n of list) if (!have.has(n)) dl.append(h("option", { value: n })); }).catch(() => {});
  }
  function closeSettings() { setM.hidden = true; }
  function saveSettings() {
    const prevCid = cfg.googleClientId;
    cfg.ollamaUrl = $("#pfOUrl").value.trim() || "http://localhost:11434";
    cfg.model = $("#pfModel").value.trim() || "gemma4";
    cfg.numCtx = Number($("#pfCtx").value) || 16384;
    cfg.googleClientId = $("#pfCid").value.trim();
    const lm = $("#pfLModel").value, lc = Number($("#pfLCtx").value) || 4096;
    if (lm !== lModel() || lc !== lCtx()) closeLocal();
    cfg.engine = selEngine(); cfg.localModel = lm; cfg.localCtx = lc;
    saveCfg(); closeSettings();
    if (!user) msg(cfg.googleClientId ? "" : "Primero pega tu ID de cliente de Google en «Ajustes de Google y Gemma».", !cfg.googleClientId);
    else if (prevCid !== cfg.googleClientId) { token = null; showReauth("Cambiaste los permisos de Google. Renueva la sesión para aplicarlos."); }
  }
  async function testOllama() {
    const out = $("#pfTestMsg"); out.classList.remove("warn"); out.textContent = "Probando…";
    const keep = { ...cfg }; cfg.ollamaUrl = $("#pfOUrl").value.trim() || cfg.ollamaUrl; cfg.model = $("#pfModel").value.trim() || cfg.model;
    try {
      const list = await ollamaModels().catch(() => { throw { code: "ollama_offline" }; });
      if (!list.some(n => n === cfg.model || n === cfg.model + ":latest")) throw { code: "model_missing", message: list.length ? "Modelos instalados: " + list.join(", ") : "No hay modelos instalados." };
      const { text } = await ollamaChat([{ role: "user", content: "Responde solo: listo" }]);
      out.textContent = `Conectado con ${cfg.model}: «${text.trim().slice(0, 40)}»`;
    } catch (e) {
      out.classList.add("warn");
      let why = "";
      if (e.code === "ollama_offline") {
        // ¿Ollama está corriendo pero no permite este sitio (CORS), o no está corriendo?
        let alive = false; try { await Promise.race([fetch(ollamaBase() + "/api/version", { mode: "no-cors" }), new Promise((_, j) => setTimeout(() => j(0), 4000))]); alive = true; } catch {}
        why = alive
          ? `Ollama está abierto, pero no permite este sitio. Configura OLLAMA_ORIGINS=${location.origin}, cierra Ollama por completo (también desde la bandeja del sistema) y vuelve a abrirlo.`
          : `No encontré Ollama en ${ollamaBase()}. Revisa que esté instalado y abierto (al abrir ${ollamaBase()} en el navegador debe decir «Ollama is running»). Si Chrome pregunta si este sitio puede acceder a tu red local, toca Permitir.`;
      }
      out.textContent = e.code === "ollama_offline" ? why : e.code === "model_missing" ? `Falta el modelo «${cfg.model}». Instálalo con: ollama pull ${cfg.model}. ${e.message || ""}` : "Error: " + (e.message || e.code);
    } finally { cfg.ollamaUrl = keep.ollamaUrl; cfg.model = keep.model; }
  }
  let pill = null;
  function renderPill() {
    if (!document.body) return;
    if (!pill) { pill = h("button", { id: "pfPill", type: "button", hidden: "" }); pill.addEventListener("click", () => openSettings("gemma")); document.body.append(pill); }
    pill.hidden = !DL || !started; if (DL) pill.textContent = `Descargando Gemma · ${Math.floor(DL.got / DL.total * 100)}%`;
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
  async function wipeDevice() {
    await new Promise((res) => { try { const r = indexedDB.deleteDatabase("atril"); r.onsuccess = r.onerror = r.onblocked = () => res(); } catch { res(); } });
    try { for (const k of Object.keys(localStorage)) if (k.startsWith("atril-") && k !== CFG_KEY) localStorage.removeItem(k); } catch {}
    try { for (const k of await caches.keys()) if (k.startsWith("atril-data")) await caches.delete(k); } catch {}
  }
  async function logout(wipe) {
    const pending = window.__atrilPending?.();
    if (pending && token) { try { await window.__atrilSyncNow?.(); } catch {} }
    if (wipe) await wipeDevice();
    try { if (token) google.accounts.oauth2.revoke(token, () => {}); } catch {}
    token = null; user = null;
    location.reload();
  }

  async function login() {
    const b = $("#pfLogin"); b.disabled = true; msg("Abriendo Google…");
    try {
      await signIn("select_account");
      msg("Comprobando tu cuenta…");
      const me = await whoAmI();
      const owner = (() => { try { return JSON.parse(localStorage.getItem(OWNER_KEY) || "null"); } catch { return null; } })();
      if (owner && owner.sub !== me.sub) {
        $("#pfMain").hidden = true; $("#pfOwner").hidden = false;
        $("#pfOwnerText").textContent = `Este navegador guarda la biblioteca de otra cuenta (${owner.email || "otra persona"}). Para proteger su privacidad, se borrará de este dispositivo antes de abrir la tuya. Su copia en Google Drive no se toca.`;
        const ok = await new Promise((res) => { $("#pfOwnerYes").onclick = () => res(true); $("#pfOwnerNo").onclick = () => res(false); });
        if (!ok) { try { google.accounts.oauth2.revoke(token, () => {}); } catch {} token = null; $("#pfOwner").hidden = true; $("#pfMain").hidden = false; msg(""); b.disabled = false; return; }
        await wipeDevice();
      }
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
    try { const st = JSON.parse(localStorage.getItem("atril-drive") || "{}"); st.on = true; localStorage.setItem("atril-drive", JSON.stringify(st)); } catch {}
    gate.remove();
    document.documentElement.classList.add("pf-in");
    const src = document.getElementById("atrilMain");
    const s = document.createElement("script"); s.textContent = src.textContent; document.body.append(s);
    setInterval(() => { if (token && Date.now() > tokenExp) { token = null; showReauth(); } }, 30000);
    try { navigator.storage?.persist?.(); } catch {}
    modelInfo().then(i => { if (i.complete) { cacheGemmaRuntime(); if (MODELS[lModel()].kind === "cpu") setIsolation(true); } }).catch(() => {});
    if (offlineMode) setTimeout(() => toast(navigator.onLine ? "Entraste sin sesión de Google: inicia sesión para guardar en Drive." : "Modo sin conexión: tus cambios se guardan en este dispositivo y se subirán a Drive cuando vuelvas a tener internet."), 800);
  }
  addEventListener("beforeunload", (e) => { if (started && window.__atrilPending?.()) { e.preventDefault(); e.returnValue = ""; } });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", buildUI); else buildUI();
  if ("serviceWorker" in navigator && window.isSecureContext) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
})();
