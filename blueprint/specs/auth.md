# Đặc tả: Authentication & Authorization

## Mô tả

Hệ thống xác thực người dùng và kiểm soát quyền truy cập theo role. Ba nhóm người dùng có quyền hạn khác nhau và truy cập vào các phần khác nhau của hệ thống.

---

## Luồng chính

### Login

```
POST /auth/login
{
  "email": "nguyen.van.a@student.edu.vn",
  "password": "SV001234"  ← password mặc định = student_id, bắt buộc đổi sau
}

Response 200:
{
  "access_token": "eyJ...",    ← JWT, exp: 15 phút
  "refresh_token": "eyJ...",   ← JWT, exp: 7 ngày
  "user": {
    "id": "uuid",
    "email": "...",
    "full_name": "...",
    "role": "student"
  }
}
```

### Refresh Token

```
POST /auth/refresh
{
  "refresh_token": "eyJ..."
}

Response 200:
{
  "access_token": "eyJ...",     ← Token mới
  "refresh_token": "eyJ..."     ← Token MỚI (rotation)
}
```

Token cũ bị revoke ngay sau khi rotate (lưu `revoked=true` trong DB).

### Logout

```
POST /auth/logout
Authorization: Bearer {access_token}

→ Revoke refresh token hiện tại trong DB
→ Xóa access token khỏi client (frontend responsibility)
```

---

## Cơ chế kiểm tra quyền tại từng điểm truy cập

### 1. API Endpoints (Express Middleware)

```javascript
// src/middleware/auth.js

// Middleware 1: Verify JWT
async function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;  // { sub: user_id, email, role, ... }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        error: 'TOKEN_EXPIRED',
        message: 'Token expired, please refresh'
      });
    }
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Middleware 2: Role check
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: 'Access denied',
        required_role: roles
      });
    }
    next();
  };
}

// Middleware 3: Ownership check (for resource-level auth)
function checkOwnership(resourceField = 'user_id') {
  return async (req, res, next) => {
    // For GET /registrations/:id
    // Check: registration.user_id === req.user.sub
    const resourceId = req.params.id;
    const resource = await db.registrations.findOne(resourceId);
    
    if (!resource || resource[resourceField] !== req.user.sub) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    req.resource = resource;
    next();
  };
}

// Usage in routes
app.get('/workshops', authMiddleware, (req, res) => {
  // Anyone authenticated can view workshops
});

app.post('/workshops', authMiddleware, requireRole('organizer'), (req, res) => {
  // Only organizers can create workshops
});

app.get('/registrations/:id', 
  authMiddleware, 
  requireRole('student', 'organizer'),
  checkOwnership('user_id'),
  (req, res) => {
    // Student sees only own registration, organizer sees all
    res.json(req.resource);
  }
);

app.get('/admin/stats', authMiddleware, requireRole('organizer'), (req, res) => {
  // Only organizers can view stats
});

app.post('/checkin', authMiddleware, requireRole('organizer', 'checkin_staff'), (req, res) => {
  // Both organizer and checkin_staff can check in
});
```

### 2. Trang Admin Web (Next.js middleware)

```typescript
// middleware.ts (Next.js)
export function middleware(request: NextRequest) {
  const token = request.cookies.get('access_token');

  if (request.nextUrl.pathname.startsWith('/admin')) {
    if (!token) return NextResponse.redirect('/login');

    const payload = verifyJWT(token.value);
    if (payload.role !== 'organizer') {
      return NextResponse.redirect('/403');
    }
  }

  if (request.nextUrl.pathname.startsWith('/checkin')) {
    // Chỉ check-in staff hoặc organizer
    const payload = verifyJWT(token?.value);
    if (!['checkin_staff', 'organizer'].includes(payload?.role)) {
      return NextResponse.redirect('/403');
    }
  }
}
```

### 3. Mobile App (React Native)

- Role được lưu trong secure storage (expo-secure-store).
- Khi launch app: check role → redirect đến đúng stack navigation.
- `checkin_staff` chỉ thấy màn hình QR scanner.
- Tất cả API call đều có `Authorization: Bearer {token}` — backend là source of truth.

---

## Kịch bản lỗi

### Sinh viên lần đầu đăng nhập (password mặc định)

```
1. Login với password = student_id
2. Server detect: password_is_default = true
3. Response 200 kèm flag: {"force_change_password": true}
4. Frontend redirect: /change-password (không thể bỏ qua)
5. POST /auth/change-password {old_password, new_password}
6. Sau đổi mật khẩu: redirect về trang chính
```

### Token hết hạn khi đang dùng

```
1. API trả về 401 với code "TOKEN_EXPIRED"
2. Frontend tự động gọi POST /auth/refresh
3. Nếu refresh thành công: retry request gốc với token mới
4. Nếu refresh thất bại (refresh token expired): redirect /login
```

---

## Ràng buộc

- Password hash: bcrypt với cost factor 12
- JWT secret: min 256-bit, lưu trong environment variable
- Refresh token: lưu hash (SHA-256) trong DB, không lưu plaintext
- HTTPS only: tất cả request phải qua HTTPS (enforce bởi Cloudflare)
- Rate limit login: 5 attempts/phút/IP → 429

---

## Tiêu chí chấp nhận

- [ ] Student không thể gọi POST /workshops (403)
- [ ] Checkin_staff không thể gọi GET /admin/stats (403)
- [ ] Sau khi logout: refresh token không còn dùng được
- [ ] Student chỉ thấy registrations của chính mình
- [ ] Organizer thấy tất cả registrations của tất cả workshop
