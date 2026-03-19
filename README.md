# DashHub 🚀

Dashboard moderno con login QR + Google OAuth 2.0.

## Contenido

- 🗺️ **Maps museos** — Mapa interactivo con museos destacados
- 📡 **Redes sociales** — Feed y métricas de tus redes
- 🛒 **Carro de compras** — Carrito con precios dinámicos
- 🎵 **Streaming LO-FI** — Reproductor de música
- 🏪 **Tienda Online** — Catálogo de productos

## Inicio rápido

1. Clona el repositorio:
   ```bash
   git clone https://github.com/TU_USUARIO/dashhub.git
   cd dashhub
   ```

2. Abre `index.html` en tu navegador — no requiere instalación.

## Configurar Google OAuth (login QR real)

### 1. Crear credenciales en Google Cloud

1. Ve a [console.cloud.google.com](https://console.cloud.google.com)
2. Crea un proyecto nuevo (o usa uno existente)
3. Ve a **APIs & Services → Credentials**
4. Haz clic en **Create Credentials → OAuth 2.0 Client ID**
5. Tipo de aplicación: **Web application**
6. En **Authorized JavaScript origins** agrega tu dominio (ej. `https://tuapp.com`)
7. En **Authorized redirect URIs** agrega tu callback (ej. `https://tuapp.com/auth/callback`)
8. Copia el **Client ID** generado

### 2. Configurar el archivo

Abre `index.html` y edita estas 2 líneas en el `<script>`:

```js
const GOOGLE_CLIENT_ID = 'TU_CLIENT_ID';              // ← pega aquí tu Client ID
const REDIRECT_URI     = 'https://tuapp.com/auth/callback'; // ← tu backend
```

### 3. Flujo QR completo (producción)

El QR generado apunta a la URL de autenticación de Google. Para el flujo automático necesitas un backend que:

1. Reciba el `code` de Google en el callback
2. Intercambie el `code` por un `access_token`
3. Notifique al cliente (vía **WebSocket** o **polling**) que el login fue exitoso

Ejemplo con Node.js + Express:

```js
const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const app = express();
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  const { tokens } = await client.getToken({
    code,
    redirect_uri: process.env.REDIRECT_URI,
  });
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  // payload.name, payload.email, payload.picture
  // → notifica al cliente via WebSocket con los datos del usuario
  res.send('Login exitoso. Puedes cerrar esta ventana.');
});

app.listen(3000);
```

## Demo

Haz clic en **"Simular login con Google"** para probar el flujo completo sin configuración.

## Tecnologías

- HTML5 + CSS3 + JavaScript vanilla
- [QRCode.js](https://github.com/davidshimjs/qrcodejs) — generación de QR
- Google OAuth 2.0
- Google Fonts: Syne + DM Sans

## Estructura

```
dashhub/
├── index.html   ← todo el proyecto en un solo archivo
└── README.md
```

## Licencia

MIT
