// ============================================================
//  DashHub — Servidor OAuth + WebSocket
//  Node.js + Express + ws
// ============================================================
require('dotenv').config();
const express    = require('express');
const { WebSocketServer } = require('ws');
const fetch      = (...args) => import('node-fetch').then(({default: f}) => f(...args));
const crypto     = require('crypto');
const http       = require('http');

const app    = express();
const server = http.createServer(app);

// ── Variables de entorno (se configuran en Railway) ──────────
const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI  = process.env.REDIRECT_URI;   // https://TU-APP.railway.app/auth/callback
const PORT          = process.env.PORT || 3000;

// ── CORS — permite que dashhub.html llame al servidor ────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.use(express.json());

// ── Mapa de sesiones pendientes ──────────────────────────────
// sessionId → WebSocket del dashboard que espera el login
const pendingSessions = new Map();

// ── WebSocket Server ─────────────────────────────────────────
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  // El dashboard envía su sessionId al conectarse
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'REGISTER' && msg.sessionId) {
        pendingSessions.set(msg.sessionId, ws);
        console.log('[WS] Dashboard registrado:', msg.sessionId);
      }
    } catch (_) {}
  });

  ws.on('close', () => {
    // Limpiar sesiones huérfanas
    for (const [id, socket] of pendingSessions.entries()) {
      if (socket === ws) pendingSessions.delete(id);
    }
  });
});

// ── Ruta 1: Generar URL de Google OAuth ──────────────────────
// El QR del dashboard apunta a esta ruta
app.get('/auth/google', (req, res) => {
  const sessionId = req.query.session || crypto.randomUUID();
  const url =
    'https://accounts.google.com/o/oauth2/v2/auth' +
    '?client_id='     + encodeURIComponent(CLIENT_ID) +
    '&redirect_uri='  + encodeURIComponent(REDIRECT_URI) +
    '&response_type=code' +
    '&scope='         + encodeURIComponent('openid email profile') +
    '&state='         + sessionId +
    '&prompt=select_account';
  res.redirect(url);
});

// ── Ruta 2: Callback de Google ────────────────────────────────
app.get('/auth/callback', async (req, res) => {
  const { code, state: sessionId } = req.query;

  if (!code) {
    return res.status(400).send('<h2>❌ No se recibió código de Google.</h2>');
  }

  try {
    // Intercambiar código por tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri:  REDIRECT_URI,
        grant_type:    'authorization_code',
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.id_token) {
      console.error('[OAuth] Error en tokens:', tokenData);
      return res.status(500).send('<h2>❌ Error al obtener token de Google.</h2>');
    }

    // Decodificar JWT para obtener nombre y email
    const payload = JSON.parse(
      Buffer.from(tokenData.id_token.split('.')[1], 'base64url').toString()
    );

    const user = {
      name:    payload.name  || 'Usuario',
      email:   payload.email || '',
      picture: payload.picture || '',
    };

    console.log('[OAuth] Login exitoso:', user.email);

    // Notificar al dashboard vía WebSocket
    const dashWs = pendingSessions.get(sessionId);
    if (dashWs && dashWs.readyState === 1) {
      dashWs.send(JSON.stringify({ type: 'LOGIN_OK', ...user }));
      pendingSessions.delete(sessionId);
    } else {
      console.warn('[WS] No se encontró dashboard para sessionId:', sessionId);
    }

    // Página de confirmación en el móvil
    res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <title>DashHub — Login exitoso</title>
        <style>
          body{font-family:sans-serif;background:#0f0f13;color:#e8e6f0;
               display:flex;align-items:center;justify-content:center;
               height:100vh;margin:0;flex-direction:column;gap:16px;text-align:center;padding:20px}
          .check{font-size:64px}
          h2{font-size:22px;margin:0}
          p{color:#9997a8;font-size:14px;margin:0}
          .badge{background:rgba(29,158,117,0.15);color:#1D9E75;
                 border:1px solid rgba(29,158,117,0.3);border-radius:20px;
                 padding:8px 20px;font-size:13px;font-weight:600}
        </style>
      </head>
      <body>
        <div class="check">✅</div>
        <h2>¡Login exitoso!</h2>
        <div class="badge">${user.name}</div>
        <p>${user.email}</p>
        <p style="margin-top:12px">Puedes cerrar esta pestaña.<br>El dashboard ya está activo.</p>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('[OAuth] Excepción:', err);
    res.status(500).send('<h2>❌ Error interno del servidor.</h2>');
  }
});

// ── Ruta 3: Health check (Railway lo necesita) ───────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'DashHub OAuth Server' });
});

// ── Iniciar servidor ─────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`[DashHub] Servidor corriendo en puerto ${PORT}`);
});
