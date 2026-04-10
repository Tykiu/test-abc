# UIT Study Buddy - Setup va Deploy

Project hien tai gom:

```text
uit-study-buddy/
|- index.html        # Trang frontend chinh
|- style.css         # CSS giao dien
|- app.js            # Logic frontend
|- backend.py        # FastAPI backend
|- services/         # Business logic backend
|- schemas.py        # Pydantic schemas
|- config.py         # Supabase config
|- requirements.txt
|- .env.example
|- render.yaml
|- vercel.json
```

## 1. Chuan bi Supabase

Tao project moi tren Supabase va chay SQL sau trong SQL Editor:

```sql
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    mssv CHAR(8) NOT NULL UNIQUE,
    avatar_url TEXT,
    is_verified BOOLEAN DEFAULT FALSE,
    bio TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS study_requests (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('study', 'tutor')),
    subject TEXT NOT NULL,
    method TEXT NOT NULL CHECK (method IN ('online', 'offline')),
    location_or_link TEXT,
    time TEXT NOT NULL,
    slots INTEGER NOT NULL DEFAULT 4,
    current_slots INTEGER DEFAULT 0,
    note TEXT,
    status TEXT DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    tutor_role TEXT CHECK (tutor_role IN ('seeking', 'offering', NULL)),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
    id BIGSERIAL PRIMARY KEY,
    sender_id UUID NOT NULL REFERENCES profiles(id),
    receiver_id UUID NOT NULL REFERENCES profiles(id),
    content TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS study_request_members (
    id BIGSERIAL PRIMARY KEY,
    request_id BIGINT NOT NULL REFERENCES study_requests(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (request_id, user_id)
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_request_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public profiles readable" ON profiles FOR SELECT USING (TRUE);
CREATE POLICY "Users update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Open requests readable" ON study_requests FOR SELECT USING (status = 'open');
CREATE POLICY "Users create requests" ON study_requests FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own requests" ON study_requests FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users see own messages" ON messages FOR SELECT
    USING (auth.uid() = sender_id OR auth.uid() = receiver_id);
CREATE POLICY "Users send messages" ON messages FOR INSERT
    WITH CHECK (auth.uid() = sender_id);
CREATE POLICY "Users see own joins" ON study_request_members FOR SELECT
    USING (auth.uid() = user_id);
CREATE POLICY "Users create own joins" ON study_request_members FOR INSERT
    WITH CHECK (auth.uid() = user_id);

ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE study_requests;
```

Ban can luu 3 gia tri:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_KEY`

Bat `Authentication -> Providers -> Email` va cho phep Email OTP.
Neu ban dung reset password, hay them frontend URL vao `Authentication -> URL Configuration`.

## 2. Chay backend local

```bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

Sua file `.env`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-role-key
FRONTEND_URL=http://localhost:5500
ALLOWED_ORIGINS=http://localhost:5500,http://127.0.0.1:5500
```

Chay backend:

```bash
uvicorn backend:app --reload --port 8000
```

Kiem tra:

- API docs: `http://localhost:8000/docs`
- Health: `http://localhost:8000/api/health`

## 3. Chay frontend local

Frontend la file `index.html`, khong phai `style.css`.

Cach nhanh nhat:

1. Mo `index.html` bang Live Server trong VS Code
2. Hoac dung bat ky static server nao de phuc vu thu muc project

Mac dinh frontend goi backend tai:

```js
http://localhost:8000
```

Neu can doi API base ma khong muon sua code, mo console trinh duyet va chay:

```js
localStorage.setItem("sb_api_base", "https://your-backend-url.onrender.com");
location.reload();
```

## 4. Deploy backend len Render

`render.yaml` da duoc cau hinh san.

Khi tao service tren Render, them env vars:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_KEY`
- `FRONTEND_URL`
- `ALLOWED_ORIGINS`

Vi du:

```env
ALLOWED_ORIGINS=https://your-frontend.vercel.app
```

## 5. Deploy frontend len Vercel

`vercel.json` da rewrite tat ca route ve `index.html`.

Sau khi deploy:

1. Mo website frontend
2. Vao console browser
3. Chay:

```js
localStorage.setItem("sb_api_base", "https://your-backend-url.onrender.com");
location.reload();
```

Neu muon co dinh URL backend trong code, sua hang `API_BASE` o `app.js` truoc khi deploy.

## 6. Checklist nghiem thu

Can test toi thieu cac luong sau:

- Dang ky tai khoan
- Dang nhap
- Gui OTP
- Xac thuc OTP
- Quen mat khau
- Tao bai dang study
- Tao bai dang tutor
- Join bai dang
- Sua profile
- Mo chat tu chi tiet bai dang
- Gui va tai lai tin nhan
- Deploy frontend
- Deploy backend

## 7. Luu y hien tai

- Chat frontend da noi vao backend that.
- Backend da co endpoint lay danh sach hoi thoai: `GET /api/messages`
- CORS da doc tu bien `ALLOWED_ORIGINS` thay vi mo `"*"` trong production.
- Nut `Quen mat khau?` da goi API gui email reset password qua Supabase.
- Chuc nang `join` hien da chan tu tham gia bai viet cua chinh minh va chan join trung.
