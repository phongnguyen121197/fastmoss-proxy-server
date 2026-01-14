/**
 * FastMoss Proxy Server v3.0
 * 
 * Proxy với full HTML/JS rewriting để ngăn redirect về domain gốc
 * 
 * Techniques:
 * 1. Rewrite tất cả URLs trong HTML/JS từ fastmoss.com → proxy domain
 * 2. Inject script để intercept window.location changes
 * 3. Rewrite cookies domain
 * 4. Rewrite Location headers
 * 
 * @author Phongdepzai
 * @version 3.0.0
 */

const express = require('express');
const { createProxyMiddleware, responseInterceptor } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// CONFIGURATION
// ============================================================

const FASTMOSS_URL = 'https://www.fastmoss.com';
const FASTMOSS_DOMAIN = 'www.fastmoss.com';

// Lấy proxy domain từ env hoặc request
let PROXY_DOMAIN = process.env.PROXY_DOMAIN || '';

// Cookies từ environment variable
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
  }
} catch (e) {
  console.error('[Proxy] Failed to parse cookies:', e.message);
}

// ============================================================
// URL REWRITING FUNCTIONS
// ============================================================

/**
 * Script inject vào đầu trang để block redirects
 */
function getBlockRedirectScript(proxyDomain) {
  return `
<script>
(function() {
  // Store original location methods
  var originalAssign = window.location.assign;
  var originalReplace = window.location.replace;
  
  // Proxy domain
  var PROXY_DOMAIN = '${proxyDomain}';
  var ORIGINAL_DOMAIN = 'www.fastmoss.com';
  
  // Function to rewrite URL
  function rewriteUrl(url) {
    if (!url) return url;
    var urlStr = String(url);
    
    // If URL contains original domain, rewrite to proxy
    if (urlStr.includes(ORIGINAL_DOMAIN) || urlStr.includes('fastmoss.com')) {
      urlStr = urlStr.replace(/https?:\\/\\/(www\\.)?fastmoss\\.com/g, 'https://' + PROXY_DOMAIN);
    }
    
    // If absolute URL to original domain, rewrite
    if (urlStr.startsWith('https://fastmoss.com') || urlStr.startsWith('https://www.fastmoss.com')) {
      urlStr = urlStr.replace(/https:\\/\\/(www\\.)?fastmoss\\.com/g, 'https://' + PROXY_DOMAIN);
    }
    
    return urlStr;
  }
  
  // Override location.assign
  window.location.assign = function(url) {
    var newUrl = rewriteUrl(url);
    console.log('[Proxy] Intercepted assign:', url, '->', newUrl);
    return originalAssign.call(window.location, newUrl);
  };
  
  // Override location.replace
  window.location.replace = function(url) {
    var newUrl = rewriteUrl(url);
    console.log('[Proxy] Intercepted replace:', url, '->', newUrl);
    return originalReplace.call(window.location, newUrl);
  };
  
  // Override location.href setter
  var locationDescriptor = Object.getOwnPropertyDescriptor(window, 'location');
  if (locationDescriptor && locationDescriptor.configurable !== false) {
    try {
      var originalHref = Object.getOwnPropertyDescriptor(window.location.__proto__, 'href');
      if (originalHref && originalHref.set) {
        Object.defineProperty(window.location.__proto__, 'href', {
          get: originalHref.get,
          set: function(url) {
            var newUrl = rewriteUrl(url);
            console.log('[Proxy] Intercepted href:', url, '->', newUrl);
            return originalHref.set.call(this, newUrl);
          },
          configurable: true
        });
      }
    } catch(e) {
      console.log('[Proxy] Could not override href:', e.message);
    }
  }
  
  // Intercept anchor clicks
  document.addEventListener('click', function(e) {
    var target = e.target;
    while (target && target.tagName !== 'A') {
      target = target.parentElement;
    }
    if (target && target.href) {
      var newHref = rewriteUrl(target.href);
      if (newHref !== target.href) {
        console.log('[Proxy] Rewriting link:', target.href, '->', newHref);
        target.href = newHref;
      }
    }
  }, true);
  
  console.log('[Proxy] Redirect interceptor installed');
})();
</script>
`;
}

/**
 * Rewrite URLs trong content
 */
function rewriteContent(content, proxyDomain, contentType) {
  if (!content || !proxyDomain) return content;
  
  let result = content;
  
  // Rewrite absolute URLs
  result = result.replace(/https:\/\/www\.fastmoss\.com/g, `https://${proxyDomain}`);
  result = result.replace(/https:\/\/fastmoss\.com/g, `https://${proxyDomain}`);
  result = result.replace(/http:\/\/www\.fastmoss\.com/g, `https://${proxyDomain}`);
  result = result.replace(/http:\/\/fastmoss\.com/g, `https://${proxyDomain}`);
  
  // Rewrite protocol-relative URLs
  result = result.replace(/\/\/www\.fastmoss\.com/g, `//${proxyDomain}`);
  result = result.replace(/\/\/fastmoss\.com/g, `//${proxyDomain}`);
  
  // Rewrite domain in strings (for JS)
  result = result.replace(/"www\.fastmoss\.com"/g, `"${proxyDomain}"`);
  result = result.replace(/'www\.fastmoss\.com'/g, `'${proxyDomain}'`);
  result = result.replace(/`www\.fastmoss\.com`/g, `\`${proxyDomain}\``);
  
  return result;
}

// ============================================================
// HEALTH CHECK & INJECT ENDPOINTS
// ============================================================

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '3.0.0',
    target: FASTMOSS_URL,
    hasCookies: cookieString.length > 0,
    cookieCount: parsedCookies.length,
    proxyDomain: PROXY_DOMAIN || req.get('host'),
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Inject cookies endpoint
app.get('/inject-cookies', (req, res) => {
  const proxyDomain = PROXY_DOMAIN || req.get('host');
  
  if (parsedCookies.length === 0) {
    return res.send('<html><body><h1>No cookies configured</h1></body></html>');
  }
  
  const cookieScripts = parsedCookies
    .filter(c => c.name && c.value)
    .map(c => {
      const expires = c.expirationDate 
        ? new Date(c.expirationDate * 1000).toUTCString()
        : new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toUTCString();
      return `document.cookie = "${c.name}=${c.value}; path=/; expires=${expires}; SameSite=Lax";`;
    })
    .join('\n    ');
  
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>FastMoss - Đang đăng nhập...</title>
  <style>
    body { font-family: Arial; display: flex; justify-content: center; align-items: center; 
           height: 100vh; margin: 0; background: linear-gradient(135deg, #ff6b9d 0%, #ffa07a 100%); }
    .loader { text-align: center; color: white; }
    .spinner { width: 50px; height: 50px; border: 5px solid rgba(255,255,255,0.3);
               border-top: 5px solid white; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 20px; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="loader">
    <div class="spinner"></div>
    <h2>Đang đăng nhập FastMoss...</h2>
    <p>Vui lòng đợi...</p>
  </div>
  <script>
    ${cookieScripts}
    setTimeout(function() { window.location.href = '/vi/'; }, 1000);
  </script>
</body>
</html>
  `);
});

// ============================================================
// PROXY WITH RESPONSE INTERCEPTION
// ============================================================

const proxyMiddleware = createProxyMiddleware({
  target: FASTMOSS_URL,
  changeOrigin: true,
  selfHandleResponse: true, // Required for responseInterceptor
  
  // Rewrite redirect headers
  autoRewrite: true,
  hostRewrite: true,
  protocolRewrite: 'https',
  
  // Cookie domain rewrite
  cookieDomainRewrite: {
    'www.fastmoss.com': '',
    '.fastmoss.com': '',
    'fastmoss.com': ''
  },
  
  on: {
    proxyReq: (proxyReq, req, res) => {
      // Update proxy domain from request if not set
      if (!PROXY_DOMAIN) {
        PROXY_DOMAIN = req.get('host');
      }
      
      // Inject cookies
      if (cookieString) {
        proxyReq.setHeader('Cookie', cookieString);
      }
      
      // Browser headers
      proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      proxyReq.setHeader('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8');
      proxyReq.setHeader('Accept-Language', 'vi-VN,vi;q=0.9,en;q=0.8');
      proxyReq.setHeader('Accept-Encoding', 'gzip, deflate, br');
      proxyReq.setHeader('Referer', FASTMOSS_URL);
      proxyReq.setHeader('Origin', FASTMOSS_URL);
      
      console.log(`[Proxy] ${req.method} ${req.url}`);
    },
    
    proxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
      const proxyDomain = PROXY_DOMAIN || req.get('host');
      const contentType = proxyRes.headers['content-type'] || '';
      
      // Remove security headers that block framing
      delete proxyRes.headers['x-frame-options'];
      delete proxyRes.headers['content-security-policy'];
      
      // For HTML responses, inject script and rewrite content
      if (contentType.includes('text/html')) {
        let html = responseBuffer.toString('utf8');
        
        // Inject redirect blocker script after <head>
        const blockScript = getBlockRedirectScript(proxyDomain);
        if (html.includes('<head>')) {
          html = html.replace('<head>', '<head>' + blockScript);
        } else if (html.includes('<HEAD>')) {
          html = html.replace('<HEAD>', '<HEAD>' + blockScript);
        } else if (html.includes('<html>') || html.includes('<HTML>')) {
          html = html.replace(/<html>/i, '<html><head>' + blockScript + '</head>');
        } else {
          // Prepend if no head tag
          html = blockScript + html;
        }
        
        // Rewrite all URLs
        html = rewriteContent(html, proxyDomain, contentType);
        
        console.log(`[Proxy] Rewrote HTML for ${req.url}`);
        return html;
      }
      
      // For JS responses, rewrite URLs
      if (contentType.includes('javascript') || contentType.includes('application/json')) {
        let content = responseBuffer.toString('utf8');
        content = rewriteContent(content, proxyDomain, contentType);
        console.log(`[Proxy] Rewrote JS/JSON for ${req.url}`);
        return content;
      }
      
      // For CSS, also rewrite URLs
      if (contentType.includes('text/css')) {
        let css = responseBuffer.toString('utf8');
        css = rewriteContent(css, proxyDomain, contentType);
        return css;
      }
      
      // Return original for other types (images, fonts, etc.)
      return responseBuffer;
    }),
    
    error: (err, req, res) => {
      console.error('[Proxy] Error:', err.message);
      res.status(502).json({ error: 'Proxy Error', message: err.message });
    }
  }
});

// Apply proxy for all other routes
app.use('/', proxyMiddleware);

// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║           🔐 FastMoss Proxy Server v3.0.0                    ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  Port: ${PORT}                                                  ║
║  Target: ${FASTMOSS_URL}                          ║
║  Cookies: ${cookieString ? 'Loaded ✅' : 'Not configured ❌'}                                 ║
║                                                              ║
║  Features:                                                   ║
║  ├── HTML/JS URL Rewriting                                  ║
║  ├── Redirect Interceptor Script                            ║
║  ├── Cookie Domain Rewriting                                ║
║  └── Location Header Rewriting                              ║
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
