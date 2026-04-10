# 📦 Tài liệu bàn giao — UIT Study Buddy

> Viết lúc: 31/03/2026 · Người bàn giao: KNNN team

---

## 1. Cấu trúc thư mục & file cần bàn giao

### ✅ File CẦN bàn giao (copy đủ)

```
code website/
├── index.html          ← Giao diện chính (HTML)
├── style.css           ← Toàn bộ CSS
├── app.js              ← Logic frontend (JavaScript)
├── demo-data.js        ← Dữ liệu mẫu cho chế độ xem thử
├── backend.py          ← FastAPI backend (entry point)
├── config.py           ← Cấu hình Supabase
├── schemas.py          ← Pydantic models / request schemas
├── requirements.txt    ← Thư viện Python cần cài
├── .env.example        ← Mẫu file biến môi trường (KHÔNG phải .env thật)
├── render.yaml         ← Config deploy backend lên Render
├── vercel.json         ← Config deploy frontend lên Vercel
├── SETUP.md            ← Setup guide gốc
├── HANDOFF.md          ← File này
└── services/
    ├── __init__.py
    ├── auth_service.py
    ├── message_service.py
    ├── profile_service.py
    ├── study_request_service.py
    ├── utility_service.py
    └── verification_service.py
```

### ❌ File KHÔNG cần bàn giao

```
venv/               ← Môi trường ảo Python → người nhận tự tạo
__pycache__/        ← Cache Python → tự sinh ra khi chạy
.env                ← Chứa key bí mật thật → KHÔNG share, tạo riêng
services/__pycache__/
```

> ⚠️ **Tuyệt đối KHÔNG** share file `.env` vì chứa `SUPABASE_SERVICE_KEY` — key này có quyền admin toàn bộ database.

---

## 2. Yêu cầu môi trường

| Công cụ | Phiên bản khuyến nghị |
|---|---|
| Python | 3.10+ |
| pip | mới nhất |
| VS Code | khuyên dùng (có Live Server extension) |
| Supabase account | Tạo free tại supabase.com |

---

## 3. Setup từ đầu (người nhận làm theo thứ tự này)

### ⚡ Cách nhanh nhất — chỉ cần 2 bước

**Bước 1** — Tạo file `.env`:
```bash
copy .env.example .env
# Rồi mở .env và điền 3 key Supabase vào
```

**Bước 2** — Double-click hoặc chạy trong terminal:
```bash
start.bat
```

Script tự động làm: tạo venv → cài thư viện → chạy backend tại `http://localhost:8000`

Sau đó mở `index.html` bằng **Live Server** trong VS Code là dùng được.

---

### Chi tiết từng bước (nếu cần)

#### Bước 1 — Lấy Supabase credentials

1. Vào [supabase.com](https://supabase.com) → tạo project mới
2. Vào **Project Settings → API** → lấy:
   - `SUPABASE_URL` (Project URL)
   - `SUPABASE_ANON_KEY` (public anon key)
   - `SUPABASE_SERVICE_KEY` (service_role key — giữ bí mật)
3. Vào **SQL Editor** → chạy toàn bộ SQL trong `SETUP.md` mục 1 để tạo bảng
4. Vào **Authentication → Providers → Email** → bật `Email OTP`
5. Vào **Authentication → URL Configuration** → thêm URL frontend vào Redirect URLs

### Bước 2 — Tạo file `.env`

```bash
copy .env.example .env
```

Rồi mở `.env` và điền thật:

```env
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
FRONTEND_URL=http://localhost:5500
ALLOWED_ORIGINS=http://localhost:5500,http://127.0.0.1:5500
```

### Bước 3 — Cài thư viện Python & chạy backend

```bash
# Tạo môi trường ảo
python -m venv venv

# Kích hoạt (Windows)
venv\Scripts\activate

# Cài thư viện
pip install -r requirements.txt

# Chạy backend
uvicorn backend:app --reload --port 8000
```

Kiểm tra: mở trình duyệt vào `http://localhost:8000/docs` → thấy Swagger UI là OK.

### Bước 4 — Chạy frontend

Cách 1 (khuyến nghị): Cài extension **Live Server** trong VS Code → click chuột phải vào `index.html` → **Open with Live Server**

Cách 2: Dùng bất kỳ static server nào, ví dụ:
```bash
# Nếu có Python
python -m http.server 5500
```

Cách 3 (xem thử không cần backend): thêm `?demo=1` vào URL:
```
http://127.0.0.1:5500/index.html?demo=1
```

---

## 4. Deploy lên production

### Frontend → Vercel

1. Push code lên GitHub (không push `.env` và `venv`)
2. Vào [vercel.com](https://vercel.com) → Import repo
3. Vercel tự nhận `vercel.json` → deploy tự động
4. Sau khi deploy xong, mở browser console và chạy:
   ```js
   localStorage.setItem("sb_api_base", "https://your-backend.onrender.com");
   location.reload();
   ```
   Hoặc sửa thẳng dòng `API_BASE` trong `app.js` trước khi deploy.

### Backend → Render

1. Vào [render.com](https://render.com) → New Web Service → chọn repo của bạn
2. Render tự đọc `render.yaml`
3. Thêm Environment Variables trong dashboard Render:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_KEY`
   - `ALLOWED_ORIGINS=https://your-frontend.vercel.app`

---

## 5. Kiến trúc tổng quan

```
[Trình duyệt]
      │
      ├─ index.html  (giao diện)
      ├─ style.css   (CSS)
      └─ app.js      (fetch API backend, quản lý state)
            │
            ▼
     [FastAPI Backend - backend.py]
            │
            ├─ auth_service.py       (đăng ký, đăng nhập, reset mật khẩu)
            ├─ profile_service.py    (xem/sửa hồ sơ)
            ├─ study_request_service (tạo/xem/join bài đăng)
            ├─ message_service.py    (gửi/nhận tin nhắn)
            ├─ verification_service  (gửi/xác nhận OTP email)
            └─ utility_service.py   (health check)
                    │
                    ▼
            [Supabase] (PostgreSQL + Auth + Storage)
```

---

## 6. Những thứ đã được chỉnh sửa/thêm mới (so với bản gốc)

### 🐛 Bug fixes

| Lỗi | File | Mô tả |
|---|---|---|
| `uploadAvatar` defined inside `apiFetch` | `app.js` | Hàm bị lồng sai vị trí nên không gọi được từ bên ngoài — đã di chuyển ra ngoài |
| `uploadAvatar` dùng `supabase` client chưa khởi tạo | `app.js` | Đã thay bằng `FileReader` (đọc ảnh dạng base64/Data URL) |
| Avatar bài đăng luôn hiện chữ cái mặc định | `app.js` | `buildCard()` giờ kiểm tra `profile.avatar_url` và hiển thị ảnh nếu có |

### ✨ Tính năng / UI được cải thiện

| Thứ | File | Nội dung |
|---|---|---|
| **Upload avatar** | `app.js`, `index.html` | Preview tức thì, nút "Chọn ảnh" đẹp thay input file mặc định, báo tên file + dung lượng, giới hạn 2MB |
| **Avatar trong navbar** | `app.js` | Hiện ảnh thật thay chữ cái sau khi upload |
| **Avatar trong card bài đăng** | `app.js` | Bài của mình lấy avatar từ `currentProfile` (localStorage), bài người khác từ `profile.avatar_url` API |
| **Grid layout bài đăng** | `style.css` | Đổi từ `auto-fit` (giãn lộn xộn) → 3 cột cố định desktop / 2 cột tablet / 1 cột mobile. Card không bị kéo căng khi ít bài |
| **Trang Profile** | `app.js`, `style.css` | Full-screen (không bị cắt), avatar lớn 88px ở trên, nút "Trang chủ" nhỏ có icon ←, title căn giữa cân xứng, icon cho mỗi nút action |
| **Chat UI** | `app.js`, `style.css` | Sidebar 300px + chat area full height; bubble tin nhắn kiểu iMessage (góc không đều, align left/right riêng); header hiện avatar + tên + MSSV; input pill-shape tròn; nút gửi icon ✈️ |
| **Demo data** | `demo-data.js` | Thêm `avatar_url` (DiceBear SVG) cho tất cả nhân vật demo để test hiển thị |
| **Re-render sau save** | `app.js` | Sau khi lưu profile → gọi `renderCards()` để bài đăng của mình cập nhật avatar ngay |

### ⚠️ Giới hạn hiện tại cần biết

| Giới hạn | Chi tiết |
|---|---|
| **Avatar người khác thấy được** | ✅ Đã fix: avatar lưu vào Supabase DB dưới dạng base64. Người khác xem bài đăng sẽ thấy ảnh đại diện. Nhược điểm nhỏ: base64 nặng hơn URL, nên ảnh nên <500KB. Nếu muốn tối ưu: dùng Supabase Storage |
| **`profile_service.py` lưu `avatar_url`** | ✅ Đã fix: backend giờ lưu `avatar_url` vào cột `avatar_url` trong bảng `profiles` |
| **Không có Realtime chat** | Tin nhắn được load lại khi mở chat. Chưa có WebSocket/Supabase Realtime |

---

## 7. Những việc cần làm tiếp theo (TODO)

- [x] ~~Upload avatar lên Supabase Storage~~ → Đã lưu base64 vào DB, người khác thấy được rồi
- [ ] Nâng cấp avatar: upload lên **Supabase Storage** (URL thay vì base64 nặng) nếu cần tối ưu
- [ ] Thêm **Realtime** cho chat (Supabase Realtime hoặc polling interval)
- [ ] Thêm **thông báo** khi có tin nhắn mới (badge số)
- [ ] Trang **bài đăng của tôi** — xem/xóa/đóng bài mình đã đăng
- [ ] Tìm kiếm **full-text** theo tên môn học trên backend thay vì filter local

---

## 8. Contacts / References

- Supabase docs: https://supabase.com/docs
- FastAPI docs: https://fastapi.tiangolo.com
- DiceBear (avatar mẫu): https://www.dicebear.com/how-to-use/http-api
