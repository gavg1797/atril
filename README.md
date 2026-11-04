# Atril · lector de PDF con audio

Atril lee tus PDF en voz alta en español e inglés y te deja marcarlos, tomar notas y hacerles preguntas. Las preguntas las responde **Gemma 4** dentro de tu propio celular, tableta o computadora. Tu biblioteca se guarda sola en **tu Google Drive**.

**Abrir la app:** https://gavg1797.github.io/atril/

## Funciones

- Lectura en voz alta en español e inglés, con voz y velocidad a elegir.
- Doble clic o doble toque en una frase para empezar a leer desde ahí.
- Resaltado amarillo mientras suena el audio.
- Punto verde donde quedó la lectura, con un botón para volver a él.
- Vista de la página original con sus imágenes, o vista de solo texto. Incluye zoom, pantalla completa y modo TV.
- Marcas de resaltado, subrayado (3 tipos) y tachado, con barra movible. El PDF se descarga con tus marcas.
- Avance en porcentaje, estado leído o pendiente, y reinicio del avance.
- Carpetas y subcarpetas en la biblioteca.
- Cuaderno estilo OneNote con lienzo infinito o tamaño de hoja (A4, A3, carta…):
  - texto con negrita, cursiva y subrayado, fuentes y tamaños;
  - dibujo e imágenes;
  - exportación a PDF;
  - vista dividida PDF + cuaderno.
- Crear un PDF desde cero: títulos, texto, imágenes y enlaces.
- Preguntas sobre el documento con citas de página. Las respuestas se pueden escuchar y descargar en PDF, Word o Markdown.
- Traducción de la lectura entre español e inglés.
- Exportar e importar la biblioteca en un .zip, con contraseña opcional.

## Privacidad

- **Inicio de sesión:** para entrar hay que iniciar sesión con Google cada vez que abres Atril.
- **Dónde se guardan tus libros:** en este navegador (IndexedDB) y en la carpeta **«Atril - biblioteca»** de tu Google Drive.
- **Quién los ve:** esa carpeta es privada. La app no tiene servidor propio y los datos van directo de tu navegador a Google.
- **Preguntas y traducciones:** las responde Gemma 4 dentro del navegador de tu dispositivo (o, si lo eliges, Ollama en tu computadora). El texto no se envía a ningún servicio de IA.
- **Este repositorio es público, pero solo contiene el código.** Nunca contiene tus libros.
- **Computadoras compartidas:** en **Ajustes → Cerrar sesión y borrar de este dispositivo** quitas la copia local.
- **Cambio de cuenta:** si alguien inicia sesión con otra cuenta en el mismo navegador, Atril borra primero la biblioteca local de la cuenta anterior.

## Configurar Google Drive gratis

La API de Google Drive y el inicio de sesión de Google **no cuestan nada** y no necesitan tarjeta de crédito. Solo se configuran una vez (unos 10 minutos).

1. **Crea un proyecto.** Entra a https://console.cloud.google.com/ con tu cuenta de Google y crea un proyecto llamado **Atril**.
2. **Activa las APIs.** Ve a **APIs y servicios → Biblioteca** y habilita **Google Drive API** y **Google Picker API**. Luego, en **Credenciales → Crear credenciales → Clave de API**, crea una clave limitada a la *Google Picker API* y al sitio `https://gavg1797.github.io/*`, y pégala en `config.js` (`pickerKey`). El número del proyecto va en `appId`.
3. **Configura la pantalla de consentimiento.** Ve a **APIs y servicios → Pantalla de consentimiento de OAuth** (en la consola nueva se llama **Google Auth Platform**):
   - Tipo de usuario: **Externo**.
   - Nombre de la app: **Atril**. Usa tu correo como correo de asistencia y de contacto.
   - En **Público / Usuarios de prueba**, agrega tu correo (y el de cualquier otra persona que vaya a usar la app, hasta 100).
   - Deja la app en **modo de prueba ("Testing")**. Así no hace falta que Google la verifique.
4. **Crea las credenciales.** Ve a **Credenciales → Crear credenciales → ID de cliente de OAuth**:
   - Tipo: **Aplicación web**.
   - Orígenes autorizados de JavaScript: `https://gavg1797.github.io`. Para probar en tu computadora, agrega también `http://localhost:8000`.
   - Copia el **ID de cliente**. Termina en `.apps.googleusercontent.com`.
5. **Pon el ID en Atril.** Hay dos formas:
   - En la app: toca **Ajustes de Google y Gemma** en la pantalla de inicio y pégalo. Queda guardado en ese navegador.
   - Para todos tus dispositivos a la vez: escríbelo en `config.js`, en `googleClientId`. El ID de cliente no es secreto y puede estar en un repositorio público.

**Qué pasa al iniciar sesión:** como la app está en modo de prueba, Google muestra el aviso *"Google no verificó esta app"*. Es normal porque la app es tuya. Toca **Continuar** y acepta los permisos de Drive.

**Permisos que pide Atril** (todos no sensibles, sin costo):

- Perfil básico (nombre y correo).
- `drive.file`: Atril solo ve la carpeta que crea y los PDF que cada persona elige con el **selector oficial de Google Drive** («Abrir desde Drive»). No puede ver el resto del Drive.

**Cualquier cuenta de Google puede entrar.** La app está publicada («En producción»); cada cuenta empieza con una biblioteca vacía guardada en su propio Drive. Mientras Google no verifique la marca, al entrar aparece «Google no verificó esta app» → **Avanzado → Ir a Atril**.

**Costo:** $0. Google Drive API, Google Picker API e inicio de sesión no cobran, y el proyecto no tiene cuenta de facturación, así que no hay forma de que se cobre nada. La verificación de marca de Google para permisos no sensibles también es gratuita.

## Gemma 4 en cualquier dispositivo (gratis, desde el sitio)

En **Ajustes → Gemma 4 → En este dispositivo**, toca **Descargar**. Atril baja el modelo una sola vez desde Hugging Face (Google, licencia Apache 2.0) y lo guarda en ese navegador. Después funciona sin internet y las preguntas no salen del dispositivo.

| Modelo | Tamaño | Para |
| --- | --- | --- |
| Gemma 4 E2B (recomendado) | 2,0 GB | celulares, tabletas y computadoras |
| Gemma 4 E4B | 3,0 GB | computadoras con buena tarjeta gráfica |

- Necesita **WebGPU**: Chrome o Edge actualizados (computadora y Android), Safari en iPhone o iPad con iOS 26 o más reciente.
- Descárgalo con wifi. Si se corta, toca **Continuar descarga** y sigue donde quedó.
- Cada dispositivo descarga su propia copia. Puedes borrarla en Ajustes.
- En celulares con poca memoria, elige **Memoria corta**.
- **Sin WebGPU** (por ejemplo, Samsung con procesador Exynos como el Galaxy S24 FE): elige **Gemma 4 E2B · modo procesador** (2,6 GB). Corre en el procesador con [wllama](https://github.com/ngxson/wllama) (llama.cpp), sin tarjeta gráfica. Es más lento: cuenta con 30 segundos a unos minutos por respuesta. Después de descargarlo, recarga Atril una vez para que use varios núcleos.

## Usar Atril sin internet

1. Con internet, entra con Google y ve a **Ajustes → Sin conexión** para crear un **PIN** de 4 a 12 números.
2. En **Ajustes → Gemma 4**, descarga el modelo en ese dispositivo.
3. Abre una vez cada libro que quieras tener a mano. Los libros de tu Drive ya se descargan solos al iniciar sesión.

Sin internet, Atril abre desde la copia guardada en el dispositivo. Pide tu PIN y funcionan:

- la lectura en voz alta;
- las marcas y el cuaderno;
- las preguntas y la traducción con Gemma.

Los cambios que hagas sin internet se suben a Drive la próxima vez que inicies sesión con conexión.

**Voces sin internet:** la voz depende del sistema. Las voces del dispositivo (Windows, macOS, iOS, Android) funcionan sin internet; las voces «Google…» de Chrome en computadora necesitan conexión.

## Gemma con la app Mobile Server (Android)

En teléfonos donde el navegador no tiene WebGPU (por ejemplo, Samsung con Exynos), Atril puede usar la Gemma de [Mobile Server](https://github.com/techjarves/mobile-server). Es una versión modificada y no oficial de Google AI Edge Gallery (licencia Apache 2.0) que corre Gemma con la tarjeta gráfica del teléfono y la ofrece en `http://localhost:8080` como API compatible con OpenAI.

1. Descarga `app-arm64-v8a-release.apk` de sus [Releases](https://github.com/techjarves/mobile-server/releases) e instálalo; Android pedirá permitir apps de origen desconocido para Chrome.
2. En Mobile Server, descarga **Gemma 4 E2B**, ábrelo una vez en el chat para que quede cargado y activa el servidor. No hace falta activar túneles: Atril se conecta dentro del mismo teléfono.
3. En Atril, ve a **Ajustes → Gemma 4 → App Edge Gallery modificada** y toca **Probar conexión**. Si Chrome pide acceso a otras apps del dispositivo, toca **Permitir**.

**Ten en cuenta:**

- Deja Mobile Server abierta en segundo plano.
- El servidor también escucha en tu red wifi, sin contraseña. Otros dispositivos de la misma red podrían usar tu Gemma, pero no ven tus documentos.

## Opcional: Gemma 4 con Ollama (en tu computadora)

1. **Instala Ollama** desde https://ollama.com/download.
2. **Descarga el modelo.** En una terminal, ejecuta:
   ```
   ollama pull gemma4
   ```
   Si tu equipo tiene poca memoria, usa `gemma4:e2b`.
3. **Permite que Atril se conecte a Ollama.** Por seguridad, Ollama solo acepta páginas que tú autorizas.
   - **Windows:** abre *Configuración → Sistema → Acerca de → Configuración avanzada del sistema → Variables de entorno*. Crea la variable de usuario `OLLAMA_ORIGINS` con el valor `https://gavg1797.github.io`. Después cierra Ollama desde la bandeja del sistema y vuelve a abrirlo.
   - **macOS:** ejecuta `launchctl setenv OLLAMA_ORIGINS "https://gavg1797.github.io"` y reinicia Ollama.
   - **Linux (systemd):** ejecuta `sudo systemctl edit ollama`, agrega `Environment="OLLAMA_ORIGINS=https://gavg1797.github.io"` bajo `[Service]` y luego ejecuta `sudo systemctl restart ollama`.
4. **Comprueba la conexión.** En Atril, abre **Ajustes → Probar conexión**. Si Chrome pregunta si el sitio puede acceder a dispositivos de tu red local, acepta.

**Límites de las preguntas:**

- Solo funcionan en la computadora donde corre Ollama, con Chrome, Edge o Firefox. Safari bloquea la conexión con `localhost`.
- En el celular y la tableta funcionan la lectura, las marcas, el cuaderno y Google Drive.

## Ejecutar en tu computadora

```
python3 -m http.server 8000
```

Luego abre http://localhost:8000. Recuerda agregar ese origen en el paso 4 de Google y en `OLLAMA_ORIGINS`.

## Archivos

| Archivo | Para qué sirve |
| --- | --- |
| `index.html` | El lector completo: biblioteca, reproductor, marcas, cuaderno, preguntas y sincronización. |
| `platform.js` | Inicio de sesión con Google, API de Google Drive, conexión con Ollama y descargas. |
| `platform.css` | Pantalla de acceso y ajustes. |
| `config.js` | ID de cliente de Google, clave del selector de Drive, Gemma y Ollama. |
| `privacidad.html` | Política de privacidad (la pide la pantalla de consentimiento de Google). |
| `sw.js`, `manifest.webmanifest` | Permiten instalar Atril como app en el celular o la computadora. |
