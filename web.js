/* Atril · Sitios web → PDF
 * - «Enviar a Atril»: un marcador (bookmarklet) que, tocado en cualquier página, abre Atril y le pasa
 *   el contenido de esa página. No hay servidores intermedios: la página va directo de tu navegador a Atril.
 * - Atril limpia la página (Mozilla Readability, en lib/), conserva títulos, párrafos, listas, citas,
 *   enlaces e imágenes, y la convierte en un PDF editable de tu biblioteca (se guarda en Drive como los demás).
 * - Si una página no deja enviar su contenido, se puede copiar (Ctrl+A, Ctrl+C) y pegar en Atril.
 */
(() => {
  "use strict";
  const ORIGIN = location.origin;
  const APP_URL = ORIGIN + location.pathname.replace(/[^/]*$/, "");
  const MAX_IMGS = 40, MIN_IMG = 48, MAX_DIM = 1400;
  let pending = null, bannerEl = null, opener = null, pageOrigin = "*";
  const waiting = new Map();

  /* ---------- utilidades ---------- */
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const escA = (s) => esc(s).replace(/"/g, "&quot;");
  const abs = (u, base) => { try { return new URL(u, base).href; } catch { return ""; } };
  const plain = (html) => { const t = document.createElement("template"); t.innerHTML = String(html).replace(/<br\s*\/?>/gi, "\n"); return t.content.textContent; };
  const h = (tag, attrs = {}, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else if (k === "html") n.innerHTML = v; else n.setAttribute(k, v); } n.append(...kids.filter(Boolean)); return n; };
  const say = (msg) => { if (typeof window.__atrilToast === "function") window.__atrilToast(msg); else banner(msg); };

  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("No se pudo cargar " + src)); document.head.append(s); });
  }

  function banner(msg, actions = []) {
    if (!bannerEl) { bannerEl = h("div", { class: "webbanner", role: "status" }); document.body.append(bannerEl); }
    bannerEl.replaceChildren(h("span", { text: msg }), ...actions);
    bannerEl.hidden = false;
  }
  function hideBanner() { if (bannerEl) bannerEl.hidden = true; }

  /* ---------- el marcador «Enviar a Atril» ---------- */
  function bookmarkletCode() {
    const src = `(function(){var A=${JSON.stringify(APP_URL)},O=${JSON.stringify(ORIGIN)},s=getSelection(),sel="";try{if(s&&s.rangeCount&&String(s).trim().length>200){var d=document.createElement("div");for(var i=0;i<s.rangeCount;i++)d.appendChild(s.getRangeAt(i).cloneContents());sel=d.innerHTML}}catch(e){}var P={t:"atril-pagina",v:1,url:location.href,title:document.title,lang:document.documentElement.lang||"",html:document.documentElement.outerHTML,sel:sel};var w=window.open(A+"?web=1","_blank");if(!w){alert("Permite las ventanas emergentes de este sitio para enviar la página a Atril.");return}if(window.__atrilSend){window.__atrilSend=P;return}window.__atrilSend=P;addEventListener("message",function(e){if(e.origin!==O||!e.data)return;var m=e.data;if(m.t==="atril-listo"){e.source.postMessage(window.__atrilSend,O)}else if(m.t==="atril-img"){fetch(m.src).then(function(r){if(!r.ok)throw 0;return r.blob()}).then(function(b){if(b.size>8e6)throw 0;var f=new FileReader();f.onload=function(){e.source.postMessage({t:"atril-img",id:m.id,data:f.result},O)};f.readAsDataURL(b)}).catch(function(){e.source.postMessage({t:"atril-img",id:m.id,data:null},O)})}})})()`;
    return "javascript:" + encodeURIComponent(src);
  }

  /* ---------- HTML → bloques (títulos, párrafos, listas, citas, código, imágenes) ---------- */
  const SKIP = new Set(["script", "style", "noscript", "template", "button", "form", "input", "select", "textarea", "iframe", "object", "embed", "video", "audio", "canvas", "nav", "svg", "math", "link", "meta", "head"]);
  const BLOCK = new Set(["p", "div", "section", "article", "main", "header", "footer", "aside", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre", "figure", "figcaption", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "dl", "dt", "dd", "hr", "img", "picture", "details", "summary", "address", "center"]);
  function imgSrc(im, base) {
    if (!im) return "";
    let s = im.getAttribute("data-src") || im.getAttribute("data-lazy-src") || im.getAttribute("data-original") || "";
    const set = im.getAttribute("srcset") || im.getAttribute("data-srcset") || im.closest("picture")?.querySelector("source[srcset]")?.getAttribute("srcset");
    if (!s && set) { const c = set.split(",").map((x) => x.trim().split(/\s+/)).filter((x) => x[0]); const best = c.sort((a, b) => (parseFloat(b[1]) || 1) - (parseFloat(a[1]) || 1)).find((x) => (parseFloat(x[1]) || 1) <= 1600) || c[0]; if (best) s = best[0]; }
    if (!s) s = im.getAttribute("src") || "";
    if (!s || /^data:image\/(gif|svg)/i.test(s) && s.length < 400) return "";
    return /^data:/i.test(s) ? s : abs(s, base);
  }
  function htmlToBlocks(root, base) {
    const blocks = []; let cur = null;
    const flush = () => { if (cur && plain(cur.html).trim()) { cur.html = cur.html.replace(/^(\s|<br>)+|(\s|<br>)+$/g, ""); blocks.push(cur); } cur = null; };
    const addInline = (html, ctx) => {
      if (!html) return;
      if (!cur) {
        if (!html.trim() || /^(\s|<br>)*$/.test(html)) return;
        cur = { k: ctx.li ? "li" : "p", html: "", quote: !!ctx.quote, depth: ctx.depth || 0 };
        if (ctx.li) { cur.mark = ctx.li.ol ? `${ctx.li.n}.` : "•"; ctx.li = null; }
      }
      cur.html += html;
    };
    const inline = (n) => {
      if (n.nodeType === 3) return esc(n.textContent.replace(/\s+/g, " "));
      if (n.nodeType !== 1) return "";
      const t = n.tagName.toLowerCase();
      if (SKIP.has(t) || n.hidden || n.getAttribute("aria-hidden") === "true") return "";
      if (t === "br") return "<br>";
      if (t === "img") return "";
      const inner = [...n.childNodes].map(inline).join("");
      if (!inner.trim()) return inner;
      if (t === "b" || t === "strong") return `<b>${inner}</b>`;
      if (t === "i" || t === "em" || t === "cite" || t === "dfn") return `<i>${inner}</i>`;
      if (t === "u" || t === "ins") return `<u>${inner}</u>`;
      if (t === "code" || t === "kbd" || t === "samp" || t === "tt") return `<span style="font-family:Courier New">${inner}</span>`;
      if (t === "a") { const href = abs(n.getAttribute("href") || "", base); return /^(https?:|mailto:)/i.test(href) ? `<a href="${escA(href)}">${inner}</a>` : inner; }
      return inner;
    };
    const hasBlock = (n) => [...n.querySelectorAll("*")].some((c) => BLOCK.has(c.tagName.toLowerCase()));
    const walk = (n, ctx) => {
      for (const c of [...n.childNodes]) {
        if (c.nodeType === 3) { addInline(esc(c.textContent.replace(/\s+/g, " ")), ctx); continue; }
        if (c.nodeType !== 1) continue;
        const t = c.tagName.toLowerCase();
        if (SKIP.has(t) || c.hidden || c.getAttribute("aria-hidden") === "true") continue;
        if (t === "img" || t === "picture") { flush(); const im = t === "img" ? c : c.querySelector("img"); const src = imgSrc(im, base); if (src) blocks.push({ k: "img", src, alt: im?.getAttribute("alt") || "" }); continue; }
        if (/^h[1-6]$/.test(t)) { flush(); const html = inline(c).trim(); if (plain(html).trim()) blocks.push({ k: "h", lvl: +t[1] <= 2 ? 2 : 3, html }); c.querySelectorAll("img").forEach((im) => { const src = imgSrc(im, base); if (src) blocks.push({ k: "img", src, alt: im.getAttribute("alt") || "" }); }); continue; }
        if (t === "br") { addInline("<br>", ctx); continue; }
        if (t === "hr") { flush(); continue; }
        if (t === "pre") { flush(); const tx = c.textContent.replace(/\s+$/, ""); if (tx.trim()) blocks.push({ k: "pre", text: tx, quote: !!ctx.quote }); continue; }
        if (t === "ul" || t === "ol") { flush(); const sub = { ...ctx, ol: t === "ol", n: +(c.getAttribute("start") || 1), depth: (ctx.depth || 0) + 1 }; for (const li of c.children) { if (li.tagName.toLowerCase() !== "li") { walk(li, sub); continue; } flush(); const lc = { ...sub, li: { ol: sub.ol, n: sub.n } }; walk(li, lc); flush(); sub.n++; } continue; }
        if (t === "li") { flush(); walk(c, { ...ctx, li: { ol: false, n: 1 }, depth: (ctx.depth || 0) + 1 }); flush(); continue; }
        if (t === "blockquote") { flush(); walk(c, { ...ctx, quote: true }); flush(); continue; }
        if (t === "figcaption") { flush(); const html = inline(c).trim(); if (plain(html).trim()) blocks.push({ k: "cap", html }); continue; }
        if (t === "table") {
          flush();
          for (const tr of c.querySelectorAll("tr")) {
            const cells = [...tr.children].filter((x) => /^t[dh]$/i.test(x.tagName)).map((x) => { const v = inline(x).trim(); return x.tagName.toLowerCase() === "th" && v ? `<b>${v}</b>` : v; }).filter((v) => plain(v).trim());
            if (cells.length) blocks.push({ k: "p", html: cells.join("  |  "), quote: !!ctx.quote, depth: ctx.depth || 0 });
          }
          continue;
        }
        if (t === "dt") { flush(); const html = inline(c).trim(); if (html) blocks.push({ k: "p", html: `<b>${html}</b>` }); continue; }
        if (BLOCK.has(t)) { flush(); walk(c, ctx); flush(); continue; }
        /* elemento en línea: si dentro trae imágenes o bloques, se recorre; si no, se agrega con su formato */
        if (c.querySelector("img,picture") || hasBlock(c)) walk(c, ctx);
        else addInline(inline(c), ctx);
      }
    };
    walk(root, { depth: 0 });
    flush();
    /* quita repeticiones seguidas y bloques que solo son ruido */
    return blocks.filter((b, i) => !(b.k !== "img" && i && blocks[i - 1].k === b.k && blocks[i - 1].html === b.html));
  }

  /* ---------- imágenes → data: URL (JPEG o PNG, máx. 1400 px) ---------- */
  function askOpener(src) {
    if (!opener) return Promise.resolve(null);
    const id = Math.random().toString(36).slice(2);
    return new Promise((res) => {
      const t = setTimeout(() => { waiting.delete(id); res(null); }, 20000);
      waiting.set(id, (data) => { clearTimeout(t); res(data); });
      try { opener.postMessage({ t: "atril-img", id, src }, pageOrigin); } catch { clearTimeout(t); waiting.delete(id); res(null); }
    });
  }
  async function getBlob(src) {
    if (/^data:/i.test(src)) return await (await fetch(src)).blob();
    try {
      const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 12000);
      const r = await fetch(src, { mode: "cors", credentials: "omit", signal: ctl.signal }); clearTimeout(tm);
      if (r.ok) { const b = await r.blob(); if (/^image\//.test(b.type) || !b.type) return b; }
    } catch {}
    const data = await askOpener(src);
    return data ? await (await fetch(data)).blob() : null;
  }
  async function toDataUrl(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const w0 = img.naturalWidth || 300, h0 = img.naturalHeight || 150;
      if (w0 < MIN_IMG || h0 < MIN_IMG) return null;
      const sc = Math.min(1, MAX_DIM / Math.max(w0, h0)), c = document.createElement("canvas");
      c.width = Math.round(w0 * sc); c.height = Math.round(h0 * sc);
      const ctx = c.getContext("2d");
      const png = /png|gif|svg|webp/.test(blob.type) && c.width * c.height < 700000;
      if (!png) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); }
      ctx.drawImage(img, 0, 0, c.width, c.height);
      return { src: c.toDataURL(png ? "image/png" : "image/jpeg", 0.82), w: c.width, h: c.height };
    } catch { return null; } finally { URL.revokeObjectURL(url); }
  }
  async function loadImages(blocks, onProg) {
    const imgs = blocks.filter((b) => b.k === "img");
    imgs.slice(MAX_IMGS).forEach((b) => { b.skip = true; });
    const todo = imgs.slice(0, MAX_IMGS); let done = 0, i = 0;
    const worker = async () => { while (i < todo.length) { const b = todo[i++]; try { const blob = await getBlob(b.src); const r = blob && await toDataUrl(blob); if (r) Object.assign(b, { data: r.src, w: r.w, h: r.h }); else b.skip = true; } catch { b.skip = true; } onProg?.(++done, todo.length); } };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return blocks.filter((b) => b.k !== "img" || (b.data && !b.skip));
  }

  /* ---------- página completa → artículo ---------- */
  async function pageToArticle(p) {
    const url = p.url || "", base = url || APP_URL;
    let root, title = (p.title || "").trim(), byline = "", site = "";
    if (p.sel) {
      const t = document.createElement("template"); t.innerHTML = p.sel; root = t.content;
    } else {
      const doc = new DOMParser().parseFromString(p.html || "", "text/html");
      /* las direcciones relativas se vuelven absolutas aquí (Atril no permite <base> por seguridad) */
      if (url) {
        const pb = doc.querySelector("base[href]"), b0 = pb ? abs(pb.getAttribute("href"), url) || url : url;
        doc.querySelectorAll("base").forEach((b) => b.remove());
        for (const n of doc.querySelectorAll("[href],[src],[data-src],[data-lazy-src],[data-original]")) for (const a of ["href", "src", "data-src", "data-lazy-src", "data-original"]) { const v = n.getAttribute(a); if (v && !/^(data:|javascript:|#|mailto:)/i.test(v)) n.setAttribute(a, abs(v, b0)); }
        for (const n of doc.querySelectorAll("[srcset],[data-srcset]")) for (const a of ["srcset", "data-srcset"]) { const v = n.getAttribute(a); if (v) n.setAttribute(a, v.split(",").map((x) => { const [u, ...r] = x.trim().split(/\s+/); return [abs(u, b0), ...r].join(" "); }).join(", ")); }
      }
      try {
        if (!window.Readability) await loadScript("lib/readability-0.6.0.js");
        const art = new window.Readability(doc.cloneNode(true), { charThreshold: 250, keepClasses: false }).parse();
        if (art?.content) { const t = document.createElement("template"); t.innerHTML = art.content; root = t.content; title = (art.title || title).trim(); byline = art.byline || ""; site = art.siteName || ""; }
      } catch (e) { console.warn("Readability", e); }
      if (!root) root = doc.body;
    }
    let blocks = htmlToBlocks(root, base);
    if (!title) { const hb = blocks.find((b) => b.k === "h") || blocks.find((b) => b.k !== "img"); title = hb ? plain(hb.html || hb.text || "").trim().replace(/\s+/g, " ").slice(0, 80) : ""; }
    /* si el artículo empieza con su propio título, no se repite */
    if (blocks[0]?.k === "h" && plain(blocks[0].html).trim().toLowerCase() === title.toLowerCase()) blocks.shift();
    if (!site && url) { try { site = new URL(url).hostname.replace(/^www\./, ""); } catch {} }
    if (!title) title = site || "Página web";
    return { title, url, site, byline, lang: (p.lang || "").slice(0, 2).toLowerCase(), blocks };
  }

  async function process(p, viaOpener) {
    banner("Preparando la página…");
    const art = await pageToArticle(p);
    if (!art.blocks.some((b) => b.k !== "img")) { banner("No se encontró texto en esa página.", [h("button", { class: "btn", type: "button", text: "Cerrar" })]); bannerEl.querySelector("button").onclick = hideBanner; return; }
    const n = art.blocks.filter((b) => b.k === "img").length;
    if (n) banner(`Bajando imágenes (0 de ${Math.min(n, MAX_IMGS)})…`);
    art.blocks = await loadImages(art.blocks, (d, t) => banner(`Bajando imágenes (${d} de ${t})…`));
    deliver(art);
  }

  function deliver(art) {
    if (typeof window.__atrilWebImport === "function") { hideBanner(); window.__atrilWebImport(art); return; }
    pending = art;
    banner(`«${art.title}» está lista. Inicia sesión para guardarla como PDF en tu biblioteca.`);
  }

  /* ---------- pegar una página copiada ---------- */
  function pasteToPayload(e, url) {
    const cd = e.clipboardData; if (!cd) return null;
    const html = cd.getData("text/html"), txt = cd.getData("text/plain");
    if (html && html.trim()) {
      const frag = html.replace(/^[\s\S]*?<!--StartFragment-->/i, "").replace(/<!--EndFragment-->[\s\S]*$/i, "");
      return { url, title: "", sel: frag.length > 40 ? frag : html, html: "" };
    }
    if (txt && txt.trim()) return { url, title: "", sel: txt.split(/\n{2,}|\r\n\r\n/).map((x) => `<p>${esc(x.trim())}</p>`).join(""), html: "" };
    return null;
  }
  function pasteBox(onDone) {
    const urlIn = h("input", { type: "url", class: "webin", placeholder: "Dirección de la página (opcional)", "aria-label": "Dirección de la página" });
    const area = h("div", { class: "webpaste", contenteditable: "true", role: "textbox", "aria-label": "Pega aquí la página", "data-ph": "Toca aquí y pega (Ctrl+V o mantener presionado → Pegar)" });
    area.addEventListener("paste", (e) => {
      e.preventDefault();
      const p = pasteToPayload(e, urlIn.value.trim());
      if (!p) { say("No se encontró texto en lo que pegaste."); return; }
      area.textContent = "Recibido ✓"; onDone?.(); process(p, false).catch((err) => { console.error(err); say("No se pudo convertir la página."); });
    });
    area.addEventListener("beforeinput", (e) => { if (e.inputType !== "insertFromPaste") e.preventDefault(); });
    return h("div", { class: "webpastewrap" }, urlIn, area);
  }

  /* ---------- ventana «Abrir sitio web» ---------- */
  let modal = null;
  function openDialog() {
    if (modal) { modal.hidden = false; return; }
    const close = () => { modal.hidden = true; };
    const link = h("a", { class: "btn primary webbm", href: bookmarkletCode(), title: "Arrastra este botón a tu barra de marcadores", text: "📄 Enviar a Atril" });
    link.addEventListener("click", (e) => { e.preventDefault(); say("Arrástralo a la barra de marcadores; no se toca aquí."); });
    const copy = h("button", { class: "btn", type: "button", text: "Copiar código del marcador" });
    copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(bookmarkletCode()); say("Código copiado. Pégalo como dirección (URL) de un marcador nuevo."); } catch { prompt("Copia este código:", bookmarkletCode()); } });
    const card = h("div", { class: "mcard" },
      h("div", { class: "mhead" }, h("h2", { id: "webTitle", text: "Abrir sitio web" }), h("button", { class: "icon-btn", type: "button", "aria-label": "Cerrar", text: "✕" })),
      h("p", { class: "mlead", html: "Convierte cualquier página web en un <b>PDF de tu biblioteca</b>: la escuchas, la subrayas, escribes encima con el lápiz y la editas. Se guarda en tu Google Drive como los demás libros." }),
      h("h3", { class: "webh", text: "En la computadora (una sola vez)" }),
      h("ol", { class: "steps webSteps" },
        h("li", { html: "Muestra la barra de marcadores: <b>Ctrl+Mayús+B</b> (en Mac, <b>⌘+Mayús+B</b>)." }),
        h("li", {}, "Arrastra este botón a la barra: ", link),
        h("li", { html: "En cualquier página, toca <b>Enviar a Atril</b>. Atril se abre en otra pestaña y guarda la página como PDF. Si antes seleccionas una parte del texto, solo se envía esa parte." })),
      h("h3", { class: "webh", text: "En el celular o si una página no lo permite" }),
      h("p", { class: "mnote", html: "En la página, selecciona todo y copia; luego pégalo aquí abajo. También puedes crear un marcador a mano con este código como dirección:" }),
      h("div", { class: "mfoot", style: "justify-content:flex-start" }, copy),
      pasteBox(close),
      h("p", { class: "mnote", html: "Todo es gratis y privado: la página pasa directo de tu navegador a Atril, sin servidores intermedios." }));
    modal = h("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "webTitle" }, card);
    card.querySelector(".icon-btn").addEventListener("click", close);
    modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
    addEventListener("keydown", (e) => { if (e.key === "Escape" && modal && !modal.hidden) close(); });
    document.body.append(modal);
  }

  /* ---------- recibir la página desde el marcador (?web=1) ---------- */
  function receive() {
    try { history.replaceState(null, "", location.pathname + location.hash); } catch {}
    try { opener = window.opener && window.opener !== window ? window.opener : null; } catch { opener = null; }
    let got = false, tries = 0;
    const fallback = () => {
      if (got) return;
      const box = pasteBox(hideBanner);
      banner("Esa página no dejó enviar su contenido. Vuelve a ella, selecciona todo (Ctrl+A), copia (Ctrl+C) y pégalo aquí:", [box]);
    };
    addEventListener("message", (e) => {
      if (!opener || e.source !== opener || !e.data || typeof e.data !== "object") return;
      const m = e.data;
      if (m.t === "atril-pagina" && !got && typeof m.html === "string") {
        got = true; pageOrigin = e.origin;
        process(m, true).catch((err) => { console.error(err); banner("No se pudo convertir la página. Intenta copiarla y pegarla en «Abrir sitio web»."); });
      } else if (m.t === "atril-img" && waiting.has(m.id)) { const f = waiting.get(m.id); waiting.delete(m.id); f(typeof m.data === "string" && /^data:/.test(m.data) ? m.data : null); }
    });
    if (!opener) { fallback(); return; }
    banner("Recibiendo la página…");
    const ping = setInterval(() => {
      if (got) { clearInterval(ping); return; }
      if (++tries > 25) { clearInterval(ping); fallback(); return; }
      try { opener.postMessage({ t: "atril-listo" }, "*"); } catch { clearInterval(ping); fallback(); }
    }, 300);
  }

  window.AtrilWeb = {
    open: openDialog,
    take() { const p = pending; pending = null; if (p) hideBanner(); return p; },
    _blocks: htmlToBlocks, _article: pageToArticle
  };
  const boot = () => { if (/[?&]web=1\b/.test(location.search)) receive(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
