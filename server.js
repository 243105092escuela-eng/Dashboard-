// ============================================================
//  DashHub — Servidor TOTP (Google Authenticator)
//  Node.js + Express + speakeasy + qrcode
// ============================================================
require('dotenv').config();
const express   = require('express');
const speakeasy = require('speakeasy');
const QRCode    = require('qrcode');
const http      = require('http');
const { WebSocketServer } = require('ws');

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 3000;

// ── Secret TOTP ───────────────────────────────────────────────
// Si no existe en Railway lo genera automáticamente al arrancar
let TOTP_SECRET = process.env.TOTP_SECRET;
if (!TOTP_SECRET) {
  const generated = speakeasy.generateSecret({ name: 'DashHub' });
  TOTP_SECRET = generated.base32;
  console.log('[TOTP] Secret generado — agrégalo en Railway como TOTP_SECRET:');
  console.log(TOTP_SECRET);
}

const APP_NAME = process.env.APP_NAME || 'DashHub';
const APP_USER = process.env.APP_USER || 'admin@dashhub.app';

// ── CORS ──────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json());

// ── WebSocket — notifica al dashboard cuando el código es válido
const wss = new WebSocketServer({ server });
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('[WS] Dashboard conectado. Total:', clients.size);
  ws.on('close', () => {
    clients.delete(ws);
    console.log('[WS] Dashboard desconectado. Total:', clients.size);
  });
});

function notifyDashboard(payload) {
  const msg = JSON.stringify(payload);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg);
  }
}

// ── Ruta 1: Health check ──────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'DashHub TOTP Server' });
});

// ── Ruta 2: QR como JSON para el dashboard ───────────────────
app.get('/setup-qr', async (req, res) => {
  try {
    const otpauthUrl = speakeasy.otpauthURL({
      secret:   TOTP_SECRET,
      label:    encodeURIComponent(APP_USER),
      issuer:   APP_NAME,
      encoding: 'base32',
    });
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);
    res.json({ qr: qrDataUrl });
  } catch (err) {
    res.status(500).json({ error: 'Error generando QR' });
  }
});

// ── Estado de escaneo ─────────────────────────────────────────
let qrScanned = false;

// ── Ruta 3: Authenticator escanea — activa la vista de código ─
app.get('/setup-scanned', (req, res) => {
  qrScanned = true;
  notifyDashboard({ type: 'QR_SCANNED' });
  res.json({ ok: true });
});

// ── Ruta 4: Polling — dashboard pregunta si ya se escaneó ─────
app.get('/check-scanned', (req, res) => {
  if (qrScanned) {
    qrScanned = false; // reset para la próxima sesión
    return res.json({ scanned: true });
  }
  res.json({ scanned: false });
});

// ── Ruta 5: QR de configuración como página HTML ─────────────
// Abre esta URL UNA SOLA VEZ para vincular Google Authenticator
app.get('/setup', async (req, res) => {
  try {
    const otpauthUrl = speakeasy.otpauthURL({
      secret:   TOTP_SECRET,
      label:    encodeURIComponent(APP_USER),
      issuer:   APP_NAME,
      encoding: 'base32',
    });

    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

    res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <title>DashHub — Configurar Authenticator</title>
        <style>
          body{font-family:sans-serif;background:#0f0f13;color:#e8e6f0;
               display:flex;align-items:center;justify-content:center;
               min-height:100vh;margin:0;flex-direction:column;gap:20px;
               text-align:center;padding:30px}
          h2{font-size:22px;margin:0;color:#1D9E75}
          p{color:#9997a8;font-size:14px;margin:0;max-width:320px;line-height:1.6}
          img{border-radius:16px;background:#fff;padding:16px;width:220px}
          .step{background:#17171e;border:1px solid rgba(255,255,255,0.07);
                border-radius:12px;padding:14px 20px;max-width:340px;
                font-size:13px;color:#9997a8;line-height:1.7;text-align:left}
          .step b{color:#e8e6f0}
          .warn{background:rgba(216,90,48,0.1);border:1px solid rgba(216,90,48,0.3);
                border-radius:10px;padding:10px 16px;font-size:12px;
                color:#e07a5a;max-width:340px}
        </style>
      </head>
      <body>
        <h2>⚙️ Configurar Google Authenticator</h2>
        <p>Escanea este QR <b>una sola vez</b> con Google Authenticator para vincular DashHub.</p>
        <img src="${qrDataUrl}" alt="QR TOTP">
        <div class="step">
          <b>Pasos:</b><br>
          1. Abre <b>Google Authenticator</b> en tu teléfono<br>
          2. Toca el <b>+</b> → "Escanear código QR"<br>
          3. Apunta al código de arriba<br>
          4. Aparecerá <b>DashHub</b> con un código de 6 dígitos<br>
          5. Usa ese código para iniciar sesión en el dashboard
        </div>
        <div class="warn">
          ⚠️ Una vez configurado no compartas este QR con nadie.<br>
          Esta página solo debe abrirse una vez.
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('[Setup] Error:', err);
    res.status(500).send('<h2>❌ Error generando QR.</h2>');
  }
});

// ── Ruta 3: Verificar código TOTP ─────────────────────────────
app.post('/auth/verify', (req, res) => {
  const { token, name } = req.body;

  if (!token) {
    return res.status(400).json({ ok: false, error: 'Falta el código.' });
  }

  const valid = speakeasy.totp.verify({
    secret:   TOTP_SECRET,
    encoding: 'base32',
    token:    token.toString().trim(),
    window:   1, // acepta ±30 segundos de desfase de reloj
  });

  if (valid) {
    console.log('[TOTP] Login exitoso');
    qrScanned = false; // reset
    notifyDashboard({ type: 'LOGIN_OK', name: name || 'Usuario', email: APP_USER });
    return res.json({ ok: true });
  } else {
    console.warn('[TOTP] Código incorrecto');
    return res.status(401).json({ ok: false, error: 'Código incorrecto.' });
  }
});

// ── Iniciar servidor ──────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`[DashHub] Servidor TOTP corriendo en puerto ${PORT}`);
});
