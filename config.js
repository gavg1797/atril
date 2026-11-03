/* Configuración de Atril.
 * Pega aquí tu ID de cliente OAuth de Google (no es secreto: es público por diseño)
 * para que nadie tenga que escribirlo en Ajustes. Guía: README.md → «Configurar Google Drive gratis».
 */
window.ATRIL_CONFIG = {
  googleClientId: "578654012300-nqaf1rh037cp4i9vc0k8k84hbjpn489v.apps.googleusercontent.com",
  ollamaUrl: "http://localhost:11434",
  model: "gemma4",
  numCtx: 16384,
  pickerKey: "AIzaSyBX8RnZs2GIrILiaz3qeV7WqBvjK9SijWo", // clave pública del selector de Drive, limitada a este sitio y a la Picker API
  appId: "578654012300",
  engine: "local",      // "local" = Gemma dentro del navegador (todos los dispositivos) · "ollama" = Ollama en la computadora
  localModel: "e2b",
  localCtx: 4096
};
