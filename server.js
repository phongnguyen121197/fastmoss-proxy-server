/**
 * FastMoss Proxy Server v2.0
 * 
 * Proxy để embed FastMoss webapp vào Electron app
 * - Forward requests đến www.fastmoss.com
 * - Inject cookies vào requests
 * - Rewrite cookies domain để browser nhận được
 * 
 * Flow: Electron App → Railway Proxy → FastMoss
 * 
 * @author Phongdepzai
 * @version 2.0.0
 */

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// CONFIGURATION
// ============================================================

const FASTMOSS_URL = 'https://www.fastmoss.com';

// Cookies từ environment variable (JSON format từ EditThisCookie)
const FASTMOSS_COOKIES_JSON = process.env.FASTMOSS_COOKIES || '[]';

// Parse cookies
let parsedCookies = [];
let cookieString = '';

try {
  parsedCookies = JSON.parse(FASTMOSS_COOKIES_JSON);
  if (Array.isArray(parsedCookies) && parsedCookies.length > 0) {
    cookieString = parsedCookies
      .filter(c => c.name && c.value)
      .map(c => `${c.name}=${c.value}`)
      .join('; ');
    console.log(`[Proxy] Loaded ${parsedCookies.length} cookies`);
  } else {
    console.warn('[Proxy] No cookies configured!');
  }
} catch (e) {
  console.error('[Proxy] Failed to parse cookies:', e.message);
}

// ============================================================
// INJECT COOKIES ENDPOINT
// ============================================================

// Endpoint để inject cookies vào browser
app.get('/inject-cookies', (req, res) => {
  if (parsedCookies.length === 0) {
    return res.send('<html><body><h1>No cookies configured</h1></body></html>');
  }
  
  // Tạo script để set cookies trong browser rồi redirect
  const cookieScripts = parsedCookies
    .filter(c => c.name && c.value)
    .map(c => {
      const expires = c.expirationDate 
        ? new Date(c.expirationDate * 1000).toUTCString()
        : new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toUTCString();
      return `document.cookie = "${c.name}=${c.value}; path=/; expires=${expires}; SameSite=Lax";`;
    })
    .join('\n    ');
  
  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>FastMoss - Đang đăng nhập...</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #ff6b9d 0%, #ffa07a 100%);
    }
    .loader {
      text-align: center;
      color: white;
    }
    .spinner {
      width: 50px;
      height: 50px;
      border: 5px solid rgba(255,255,255,0.3);
      border-top: 5px solid white;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 20px;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="loader">
    <div class="spinner"></div>
    <h2>Đang đăng nhập FastMoss...</h2>
    <p>Vui lòng đợi...</p>
  </div>
  <script>
    // Set cookies
    ${cookieScripts}
    
    // Redirect to FastMoss after setting cookies
    setTimeout(function() {
      window.location.href = '/vi/';
    }, 1000);
  </script>
</body>
</html>
  `;
  
  res.send(html);
});

// ============================================================
// HEALTH CHECK
// ============================================================

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '2.0.0',
    target: FASTMOSS_URL,
    hasCookies: cookieString.length > 0,
    cookieCount: parsedCookies.length,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// ============================================================
// PROXY MIDDLEWARE
// ============================================================

const proxyMiddleware = createProxyMiddleware({
  target: FASTMOSS_URL,
  changeOrigin: true,
  cookieDomainRewrite: {
    'www.fastmoss.com': '',
    '.fastmoss.com': '',
    'fastmoss.com': ''
  },
  
  // Thêm cookies vào mỗi request
  onProxyReq: (proxyReq, req, res) => {
    // Inject cookies
    if (cookieString) {
      proxyReq.setHeader('Cookie', cookieString);
    }
    
    // Set headers để giả lập browser thật
    proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    proxyReq.setHeader('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8');
    proxyReq.setHeader('Accept-Language', 'vi-VN,vi;q=0.9,en;q=0.8');
    proxyReq.setHeader('Referer', FASTMOSS_URL);
    proxyReq.setHeader('Origin', FASTMOSS_URL);
    
    // Remove headers có thể gây vấn đề
    proxyReq.removeHeader('x-forwarded-host');
    proxyReq.removeHeader('x-forwarded-proto');
    
    console.log(`[Proxy] ${req.method} ${req.url}`);
  },
  
  // Xử lý response
  onProxyRes: (proxyRes, req, res) => {
    // Cho phép iframe embedding
    delete proxyRes.headers['x-frame-options'];
    delete proxyRes.headers['content-security-policy'];
    
    // Rewrite Set-Cookie headers để browser nhận được
    const setCookieHeaders = proxyRes.headers['set-cookie'];
    if (setCookieHeaders) {
      proxyRes.headers['set-cookie'] = setCookieHeaders.map(cookie => {
        return cookie
          .replace(/domain=[^;]+;?/gi, '')
          .replace(/secure;?/gi, '')
          .replace(/SameSite=None/gi, 'SameSite=Lax');
      });
    }
    
    console.log(`[Proxy] Response ${proxyRes.statusCode} for ${req.url}`);
  },
  
  // Xử lý errors
  onError: (err, req, res) => {
    console.error('[Proxy] Error:', err.message);
    res.status(502).json({
      error: 'Proxy Error',
      message: err.message
    });
  },
  
  // Log
  logLevel: 'warn'
});

// Apply proxy cho tất cả routes
app.use('/', proxyMiddleware);

// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║           🔐 FastMoss Proxy Server v2.0.0                    ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  Port: ${PORT}                                                  ║
║  Target: ${FASTMOSS_URL}                          ║
║  Cookies: ${cookieString ? 'Loaded ✅' : 'Not configured ❌'}                                 ║
║                                                              ║
║  Endpoints:                                                  ║
║  ├── GET /health         - Health check                     ║
║  ├── GET /inject-cookies - Inject & redirect                ║
║  └── /*                  - Proxy to FastMoss                ║
║                                                              ║
║  📌 Truy cập: /inject-cookies để đăng nhập tự động          ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
  `);
});
