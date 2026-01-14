# 🔐 FastMoss Proxy Server

Proxy server để embed FastMoss webapp vào Electron app.

## 🚀 Deploy lên Railway

### Bước 1: Tạo Project trên Railway

1. Đăng nhập [Railway](https://railway.app)
2. Click **"New Project"** → **"Empty Project"**
3. Click **"Add Service"** → **"GitHub Repo"** hoặc **"Empty Service"**

### Bước 2: Upload Code

**Option A: Từ GitHub**
1. Push folder này lên GitHub repo
2. Connect repo với Railway

**Option B: Từ Railway CLI**
```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

### Bước 3: Cấu hình Environment Variables

Trong Railway Dashboard → Service → **Variables**, thêm:

| Variable | Mô tả |
|----------|-------|
| `FASTMOSS_COOKIES` | Cookies từ EditThisCookie (JSON format) |

### Bước 4: Lấy Cookies từ FastMoss

1. Đăng nhập FastMoss trên Chrome
2. Install extension **EditThisCookie** hoặc **Cookie Editor**
3. Mở FastMoss → Click icon extension → **Export** (JSON)
4. Copy toàn bộ JSON
5. Paste vào biến `FASTMOSS_COOKIES` trên Railway

**Ví dụ format:**
```json
[
  {"name": "accessToken", "value": "xxx...", "domain": ".fastmoss.com"},
  {"name": "refreshToken", "value": "yyy...", "domain": ".fastmoss.com"}
]
```

### Bước 5: Deploy

Railway sẽ tự động deploy. Domain có dạng:
```
fastmoss-proxy-xxxx.up.railway.app
```

## 🧪 Test

```bash
# Health check
curl https://your-domain.up.railway.app/health

# Truy cập FastMoss qua proxy
# Mở browser: https://your-domain.up.railway.app/vi/
```

## 📱 Tích hợp vào Electron App

```javascript
// Trong Electron main.ts
const PROXY_URL = 'https://your-domain.up.railway.app';

// Tạo BrowserView để embed FastMoss
const fastmossView = new BrowserView();
mainWindow.addBrowserView(fastmossView);
fastmossView.setBounds({ x: 0, y: 0, width: 800, height: 600 });
fastmossView.webContents.loadURL(`${PROXY_URL}/vi/`);
```

## ⚠️ Lưu ý

1. **Cookies hết hạn ~15 ngày** - Cần update lại trong Railway Variables
2. **Không share URL proxy** - Ai có URL đều có thể truy cập FastMoss của bạn
3. **Railway Hobby Plan** - Giới hạn $5/tháng

## 🐛 Troubleshooting

### "Cookies: Not configured"
→ Chưa set biến `FASTMOSS_COOKIES`. Kiểm tra Railway Variables.

### Trang trắng / không load
→ Cookies có thể đã hết hạn. Export cookies mới từ Chrome.

### Bị redirect về trang login
→ Cookies không hợp lệ hoặc đã hết hạn.
