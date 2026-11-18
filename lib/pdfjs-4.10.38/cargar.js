/* Carga el lector de PDF (pdf.js 4.10.38, compilación "legacy" para navegadores más antiguos).
 * Está alojado en este mismo sitio, así que no depende de servidores externos.
 * Uso: const pdfjsLib = await cargarPdfjs();
 * Al abrir un PDF, pasa siempre { isEvalSupported: false } a getDocument. */
(function () {
  "use strict";
  var base = document.currentScript ? document.currentScript.src : document.baseURI;
  var url = function (f) { return new URL(f, base).href; };
  var promesa = null;
  window.cargarPdfjs = function () {
    if (promesa) return promesa;
    promesa = import(url("pdf.min.js")).then(function (p) {
      p.GlobalWorkerOptions.workerSrc = url("pdf.worker.min.js");
      window.pdfjsLib = p;
      return p;
    }).catch(function (e) {
      promesa = null;
      throw new Error("No se pudo cargar el lector de PDF. Revisa tu conexión y recarga la página.");
    });
    return promesa;
  };
})();
