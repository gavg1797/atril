# Atril · lector de PDF con audio

Atril lee tus PDF en voz alta en español e inglés y te deja marcarlos, tomar notas y preparar preguntas sobre ellos para la IA que prefieras (**NotebookLM, Copilot, Claude o Gemini**). Tu biblioteca se guarda sola en **tu Google Drive**.

**Abrir la app:** https://gavg1797.github.io/atril/

## Funciones

- Lectura en voz alta en español e inglés, con voz y velocidad a elegir.
- Triple clic o triple toque en una frase para empezar a leer desde ahí. Con doble clic o doble toque se selecciona el texto para marcarlo.
- La vista baja sola para seguir lo que se está leyendo (si desplazas la página a mano, espera unos segundos antes de volver a seguir la lectura).
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

- **Preguntar a tu IA:** selecciona texto (doble clic) y toca **Preguntar**, o escribe tu pregunta. Con **Copiar** o con los accesos directos a **NotebookLM, Copilot, Claude y Gemini**, Atril copia la consulta (pregunta + texto + página) y abre la IA en otra pestaña para que solo la pegues. En pantallas anchas el panel va a la derecha del documento; también puede ser una ventana flotante.

- **Biblioteca:** vista en **cuadrícula** (portadas en proporción de libro con el nombre abajo) o en **lista**. Botones pequeños para **buscar** (en todas las carpetas), filtrar por **fecha** y **tamaño** y **ordenar**. Las acciones menos usadas (Carpeta, Crear PDF nuevo, Abrir desde Drive, Importar/Exportar biblioteca y Google Drive) están en **⋯ Más**.

## Privacidad

- **Inicio de sesión:** para entrar hay que iniciar sesión con Google cada vez que abres Atril.
- **Dónde se guardan tus libros:** en este navegador (IndexedDB) y en la carpeta **«Atril - biblioteca»** de tu Google Drive.
- **En vivo:** cada libro, carpeta, marca o nota se guarda en Drive al instante, y los demás dispositivos conectados a la misma cuenta lo reciben en unos segundos (aparece «Actualizado desde otro dispositivo»). Si estás escuchando un libro, la lectura no se interrumpe.
- **Una sola biblioteca por cuenta:** si por alguna razón quedaron dos copias de la biblioteca en tu Drive (por ejemplo, dos carpetas «Atril - biblioteca»), Atril las combina solo al iniciar sesión en la que tiene más libros, sin perder documentos, carpetas, marcas ni avance. La copia sobrante va a la papelera de Drive. Lo que borras en un dispositivo también se borra en los demás.
- **Modo seguimiento de lectura** (en «Más»): **Por palabra** subraya con una línea roja fina solo la palabra que se está leyendo (si la voz no avisa cada palabra, Atril calcula el ritmo); **Por frase** subraya la frase completa. Ya no se usa el resaltado amarillo.
- **Barra de marcar anclable:** con el botón de anclar la pones a la izquierda o derecha (vertical) o arriba o abajo (horizontal), o la dejas flotante. Al seleccionar texto en el PDF la selección ya no salta al renglón de arriba o de abajo.
- **Más espacio para leer:** la barra del lector muestra solo íconos (con su nombre al pasar el mouse y con texto dentro de «Más») y la cabecera ocupa una sola fila.
- **Marca de lectura (punto verde):** en «Más» → **Poner marca de lectura** tocas cualquier párrafo y la marca queda ahí (también desde la barra de selección con **Marca aquí**). Al pausar la lectura en voz alta, Atril pregunta si guardas la marca en ese párrafo. El botón verde te lleva a la marca; tocando el punto verde puedes leer desde ahí, moverlo o quitarlo. Al poner la marca, la lectura en voz alta también sigue desde ese párrafo (si ya estaba leyendo, salta ahí). La marca se guarda en Drive y se ve en todos tus dispositivos.
- **Quién los ve:** esa carpeta es privada. La app no tiene servidor propio y los datos van directo de tu navegador a Google.
- **Preguntas:** Atril no tiene IA propia ni envía tu texto a ningún servicio. Arma la consulta (tu pregunta + el texto seleccionado + la página) y la copia; tú decides en qué IA pegarla.
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
   - En la app: toca **Ajustes de Google** en la pantalla de inicio y pégalo. Queda guardado en ese navegador.
   - Para todos tus dispositivos a la vez: escríbelo en `config.js`, en `googleClientId`. El ID de cliente no es secreto y puede estar en un repositorio público.

**Qué pasa al iniciar sesión:** como la app está en modo de prueba, Google muestra el aviso *"Google no verificó esta app"*. Es normal porque la app es tuya. Toca **Continuar** y acepta los permisos de Drive.

**Permisos que pide Atril** (todos no sensibles, sin costo):

- Perfil básico (nombre y correo).
- `drive.file`: Atril solo ve la carpeta que crea y los PDF que cada persona elige con el **selector oficial de Google Drive** («Abrir desde Drive»). No puede ver el resto del Drive.

**Cualquier cuenta de Google puede entrar.** La app está publicada («En producción»); cada cuenta empieza con una biblioteca vacía guardada en su propio Drive. Mientras Google no verifique la marca, al entrar aparece «Google no verificó esta app» → **Avanzado → Ir a Atril**.

**Costo:** $0. Google Drive API, Google Picker API e inicio de sesión no cobran, y el proyecto no tiene cuenta de facturación, así que no hay forma de que se cobre nada. La verificación de marca de Google para permisos no sensibles también es gratuita.

## Usar Atril sin internet

1. Con internet, entra con Google y ve a **Ajustes → Sin conexión** para crear un **PIN** de 4 a 12 números.
2. Abre una vez cada libro que quieras tener a mano. Los libros de tu Drive ya se descargan solos al iniciar sesión.

Sin internet, Atril abre desde la copia guardada en el dispositivo. Pide tu PIN y funcionan:

- la lectura en voz alta;
- las marcas y el cuaderno;
- preparar y copiar preguntas.

Los cambios que hagas sin internet se suben a Drive la próxima vez que inicies sesión con conexión.

**Voces sin internet:** la voz depende del sistema. Las voces del dispositivo (Windows, macOS, iOS, Android) funcionan sin internet; las voces «Google…» de Chrome en computadora necesitan conexión.

## Ejecutar en tu computadora

```
python3 -m http.server 8000
```

Luego abre http://localhost:8000. Recuerda agregar ese origen en el paso 4 de Google.

## Archivos

| Archivo | Para qué sirve |
| --- | --- |
| `index.html` | El lector completo: biblioteca, reproductor, marcas, cuaderno, preguntas y sincronización. |
| `platform.js` | Inicio de sesión con Google, API de Google Drive y descargas. |
| `platform.css` | Pantalla de acceso y ajustes. |
| `config.js` | ID de cliente de Google y clave del selector de Drive. |
| `privacidad.html` | Política de privacidad (la pide la pantalla de consentimiento de Google). |
| `sw.js`, `manifest.webmanifest` | Permiten instalar Atril como app en el celular o la computadora. |
