/* Guía paso a paso (recorrido) — ilumina una parte de la pantalla y explica qué hacer.
 * Uso: Guia.start([{ sel: "#boton", title: "Título", text: "Explicación", before(){...} }, ...], { onEnd(){...} })
 * Un paso sin «sel» (o cuyo elemento no se ve) se muestra centrado o se salta (si tiene skipIfMissing). */
(function () {
  "use strict";
  const CSS = `
  .gx-root{position:fixed;inset:0;z-index:30000;pointer-events:none;font-family:inherit}
  .gx-shade{position:fixed;inset:0;background:rgba(14,16,22,.58);pointer-events:auto;opacity:0;transition:opacity .2s}
  .gx-root.on .gx-shade{opacity:1}
  .gx-root.has-target .gx-shade{background:transparent}
  .gx-spot{position:fixed;border-radius:14px;box-shadow:0 0 0 4px rgba(255,255,255,.95),0 0 0 9999px rgba(14,16,22,.58);transition:all .25s ease;pointer-events:none}
  .gx-card{position:fixed;width:min(340px,calc(100vw - 24px));background:#fff;color:#1b1d26;border-radius:18px;padding:16px 16px 12px;box-shadow:0 18px 50px rgba(0,0,0,.28);pointer-events:auto;transition:top .25s ease,left .25s ease}
  .gx-step{font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--gx-accent,#476adb);margin-bottom:4px}
  .gx-title{font-size:18px;font-weight:800;margin:0 0 6px;line-height:1.2}
  .gx-text{font-size:14.5px;line-height:1.5;margin:0 0 12px;color:#3d4150}
  .gx-btns{display:flex;align-items:center;gap:8px}
  .gx-btns .gx-sp{flex:1}
  .gx-b{font:inherit;font-weight:700;font-size:14px;border-radius:10px;padding:8px 14px;border:1px solid #d9dce6;background:#fff;color:#1b1d26;cursor:pointer}
  .gx-b.pri{background:var(--gx-accent,#476adb);border-color:transparent;color:#fff}
  .gx-skip{font:inherit;font-size:13px;border:none;background:none;color:#6b7080;cursor:pointer;padding:6px 2px;text-decoration:underline}
  .gx-dots{display:flex;gap:4px;margin-right:auto}
  .gx-dots i{width:6px;height:6px;border-radius:50%;background:#d5d8e2}
  .gx-dots i.on{background:var(--gx-accent,#476adb);width:16px;border-radius:4px}
  @media (prefers-color-scheme:dark){.gx-card{background:#1f2129;color:#eef0f6}.gx-text{color:#c3c7d4}.gx-b{background:#1f2129;color:#eef0f6;border-color:#3a3d4a}}
  @media (prefers-reduced-motion:reduce){.gx-spot,.gx-card,.gx-shade{transition:none}}`;
  let root, spot, card, steps = [], i = 0, opts = {}, visibleSteps = [];

  const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  const pick = (sel) => { if (!sel) return null; for (const s of [].concat(sel)) { for (const el of document.querySelectorAll(s)) if (visible(el)) return el; } return null; };

  function ensure() {
    if (root) return;
    const st = document.createElement("style"); st.textContent = CSS; document.head.append(st);
    root = document.createElement("div"); root.className = "gx-root"; root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true");
    root.innerHTML = `<div class="gx-shade"></div><div class="gx-spot" hidden></div><div class="gx-card" tabindex="-1"></div>`;
    spot = root.querySelector(".gx-spot"); card = root.querySelector(".gx-card");
    root.querySelector(".gx-shade").addEventListener("click", () => {});
    addEventListener("resize", () => root.isConnected && place());
    addEventListener("keydown", (e) => {
      if (!root.isConnected) return;
      if (e.key === "Escape") end(true); else if (e.key === "ArrowRight") go(1); else if (e.key === "ArrowLeft") go(-1);
    });
  }
  function place() {
    const s = visibleSteps[i]; const el = s._el && s._el.isConnected && visible(s._el) ? s._el : null;
    root.classList.toggle("has-target", !!el); spot.hidden = !el;
    const W = innerWidth, H = innerHeight, cw = Math.min(340, W - 24);
    if (!el) { card.style.left = Math.round((W - cw) / 2) + "px"; card.style.top = Math.round(Math.max(12, (H - card.offsetHeight) / 2)) + "px"; return; }
    const r = el.getBoundingClientRect(), pad = 6;
    spot.style.left = (r.left - pad) + "px"; spot.style.top = (r.top - pad) + "px"; spot.style.width = (r.width + pad * 2) + "px"; spot.style.height = (r.height + pad * 2) + "px";
    const ch = card.offsetHeight; let top;
    if (r.bottom + 14 + ch < H) top = r.bottom + 14; else if (r.top - 14 - ch > 0) top = r.top - 14 - ch; else top = Math.max(12, H - ch - 12);
    let left = r.left + r.width / 2 - cw / 2; left = Math.max(12, Math.min(W - cw - 12, left));
    card.style.left = Math.round(left) + "px"; card.style.top = Math.round(top) + "px";
  }
  async function show() {
    const s = visibleSteps[i];
    try { if (s.before) await s.before(); } catch {}
    await new Promise((r) => setTimeout(r, s.before ? 220 : 10));
    s._el = pick(s.sel);
    if (s.sel && !s._el && s.skipIfMissing !== false) { visibleSteps.splice(i, 1); if (i >= visibleSteps.length) return end(false); return show(); }
    if (s._el) { s._el.scrollIntoView?.({ block: "nearest", inline: "nearest" }); }
    const n = visibleSteps.length, last = i === n - 1;
    card.innerHTML = `<div class="gx-step">Paso ${i + 1} de ${n}</div><h3 class="gx-title"></h3><p class="gx-text"></p>
      <div class="gx-btns"><div class="gx-dots">${visibleSteps.map((_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("")}</div>
      ${i > 0 ? '<button class="gx-b" data-a="back" type="button">Atrás</button>' : ""}
      <button class="gx-b pri" data-a="next" type="button">${last ? (opts.doneLabel || "¡Listo!") : "Siguiente"}</button></div>
      ${last ? "" : '<div style="text-align:right;margin-top:6px"><button class="gx-skip" data-a="skip" type="button">Saltar la guía</button></div>'}`;
    card.querySelector(".gx-title").textContent = s.title || "";
    card.querySelector(".gx-text").textContent = s.text || "";
    card.onclick = (e) => { const a = e.target.closest("[data-a]")?.dataset.a; if (a === "next") go(1); else if (a === "back") go(-1); else if (a === "skip") end(true); };
    place(); requestAnimationFrame(place);
    card.querySelector(".gx-b.pri").focus({ preventScroll: true });
  }
  function go(d) { const j = i + d; if (j < 0) return; if (j >= visibleSteps.length) return end(false); i = j; show(); }
  function end(skipped) { root.classList.remove("on"); root.remove(); try { opts.onEnd && opts.onEnd(skipped); } catch {} }
  function start(list, o) {
    ensure(); opts = o || {}; steps = list; visibleSteps = list.slice(); i = 0;
    document.body.append(root); requestAnimationFrame(() => root.classList.add("on"));
    show();
  }
  window.Guia = { start };
})();
