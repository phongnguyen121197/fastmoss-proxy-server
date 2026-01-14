/**
 * FastMoss Proxy Server
 * 
 * Proxy để embed FastMoss webapp vào Electron app
 * Forward tất cả requests đến www.fastmoss.com với cookies được inject
 * 
 * Flow: Electron App → Railway Proxy → FastMoss
 * 
 * @author Phongdepzai
 * @version 1.0.0
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
const FASTMOSS_COOKIES = process.env.FASTMOSS_COOKIES || '[]';

/**
 * Parse cookies từ JSON sang cookie string
 */
function parseCookiesToString(cookiesJson) {
  try {
    const cookies = JSON.parse(cookiesJson);
    if (!Array.isArray(cookies) || cookies.length === 0) {
      console.warn('[Proxy] No cookies configured!');
      return '';
    }
    
    const cookieString = cookies
      .filter(c => c.name && c.value)
      .map(c => `${c.name}=${c.value}`)
      .join('; ');
    
    console.log(`[Proxy] Loaded ${cookies.length} cookies`);
    return cookieString;
  } catch (e) {
    console.error('[Proxy] Failed to parse cookies:', e.message);
    return '';
  }
}

const cookieString = parseCookiesToString(FASTMOSS_COOKIES);

// ============================================================
// HEALTH CHECK
// ============================================================

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    target: FASTMOSS_URL,
    hasCookies: cookieString.length > 0,
    cookieCount: cookieString ? cookieString.split(';').length : 0,
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
    
    // Log status
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
║           🔐 FastMoss Proxy Server v1.0.0                    ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  Port: ${PORT}                                                  ║
║  Target: ${FASTMOSS_URL}                          ║
║  Cookies: ${cookieString ? 'Loaded ✅' : 'Not configured ❌'}                                 ║
║                                                              ║
║  Endpoints:                                                  ║
║  ├── GET /health - Health check                             ║
║  └── /*          - Proxy to FastMoss                        ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
  `);
});
