# UniHub Workshop — Technical Design

## Kiến trúc tổng thể

### Lựa chọn: Monolith Modular (không phải Microservices)

**Lý do chọn Monolith Modular thay vì Microservices:**

Với quy mô đồ án và ràng buộc chi phí, microservices sẽ tốn tài nguyên vô lý: mỗi service cần container riêng, service discovery, inter-service authentication, distributed tracing... Tất cả điều đó không phù hợp khi chạy trên một VPS free tier.

Monolith Modular cho phép:
- **Tách code rõ ràng theo module** (auth, workshop, registration, checkin, notification, payment, ai_summary, csv_import) nhưng deploy một process duy nhất.
- **Dễ extract thành microservice sau này** nếu cần — các module giao tiếp qua interface, không gọi thẳng database của nhau.
- **Vận hành đơn giản:** một Docker Compose file, không cần Kubernetes.

### Tech Stack: Node.js + Express (không NestJS)

**Lựa chọn Express thay vì NestJS:**
- **Đơn giản hơn** cho sinh viên mới bắt đầu: Express là minimalist, dễ hiểu
- **Ít dependencies:** Giảm attack surface, build time nhanh hơn
- **Linh hoạt:** Có thể cấu hình middleware và routing theo cách riêng
- **Hỗ trợ Bull tốt:** Bull (job queue) hoạt động hoàn hảo với Express
- **Performance đủ dùng:** Express + PostgreSQL + Bull có thể handle 100-200 RPS dễ dàng cho application này

### Các thành phần chính

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                          │
│  Web App (Next.js)          Mobile App (React Native/Expo)  │
└──────────────┬──────────────────────────┬───────────────────┘
               │ HTTPS/REST               │ HTTPS/REST
┌──────────────▼──────────────────────────▼───────────────────┐
│                    BACKEND API (Express.js)                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐  │
│  │   Auth   │ │Workshop  │ │ Register │ │  Check-in     │  │
│  │ Routes   │ │ Routes   │ │ Routes   │ │ Routes        │  │
│  └──────────┘ └──────────┘ └──────────┘ └───────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐  │
│  │ Payment  │ │Notif.    │ │AI Summary│ │ CSV Import    │  │
│  │ Routes   │ │ Routes   │ │ Routes   │ │ Routes        │  │
│  └──────────┘ └──────────┘ └──────────┘ └───────────────┘  │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Bull Workers (chạy trong cùng process):              │ │
│  │  - email-worker    (RegistrationConfirmed event)     │ │
│  │  - ai-summary-worker (PDFUploaded event)             │ │
│  │  - notification-worker (WorkshopChanged event)       │ │
│  └────────────────────────────────────────────────────────┘ │
└───────┬──────────────┬─────────────────────────┬────────────┘
        │              │                          │
┌───────▼──┐   ┌───────▼──┐             ┌────────▼──────────┐
│PostgreSQL│   │  Redis   │             │  Bull Queue       │
│(primary  │   │(cache +  │             │  (Redis backend)  │
│ storage) │   │ rate lmt)│             │                   │
└──────────┘   └──────────┘             └───────────────────┘
```

### Giao tiếp giữa các thành phần

| Từ | Đến | Giao thức | Ghi chú |
|----|-----|-----------|---------|
| Web/Mobile App | Backend API | REST/HTTPS | JWT Bearer token |
| Backend API | PostgreSQL | TCP (pg client library) | Connection pool |
| Backend API | Redis | TCP | Cache, rate limit, idempotency store |
| Backend API | BullMQ | In-process | Async jobs: email, AI, CSV |
| BullMQ Worker | Email Provider | HTTPS | Resend API / SMTP |
| BullMQ Worker | AI Provider | HTTPS | Gemini API |
| BullMQ Worker | Payment Gateway | HTTPS | VNPay |
| Cron Job | CSV File | File I/O | Đọc file export từ thư mục shared |

---

## C4 Diagram

### Level 1 — System Context

```
                        ┌─────────────────────────────────┐
                        │                                 │
    ┌──────────┐        │      UniHub Workshop            │        ┌──────────────┐
    │          │ xem,   │                                 │ gửi   │              │
    │ Sinh viên│──────► │  Hệ thống số hóa toàn bộ quy   │──────►│ Email Service│
    │          │ đăng ký│  trình đăng ký và check-in      │ email │ (Resend/SMTP)│
    └──────────┘        │  workshop cho Tuần lễ kỹ năng   │       └──────────────┘
                        │                                 │
    ┌──────────┐        │                                 │       ┌──────────────┐
    │   Ban    │ quản   │                                 │ gọi  │              │
    │ Tổ chức  │──────► │                                 │──────►│  AI Provider │
    │          │ trị    │                                 │ API  │(Gemini/Claude)│
    └──────────┘        │                                 │       └──────────────┘
                        │                                 │
    ┌──────────┐        │                                 │       ┌──────────────┐
    │ Nhân sự  │ quét  │                                 │ gọi  │   Payment    │
    │ Check-in │──────► │                                 │──────►│  Gateway     │
    │          │  QR   │                                 │ API  │  (VNPay)     │
    └──────────┘        │                                 │       └──────────────┘
                        │                                 │
                        │                                 │       ┌──────────────┐
                        │                                 │ đọc  │  Hệ thống    │
                        │                                 │◄─────│  Quản lý SV  │
                        │                                 │ CSV  │  (Legacy)    │
                        └─────────────────────────────────┘       └──────────────┘
```

**Actors:**
- **Sinh viên:** Truy cập web browser hoặc PWA, đăng ký và nhận QR
- **Ban tổ chức:** Truy cập trang admin web, full quyền quản lý
- **Nhân sự check-in:** Dùng mobile app (React Native) để quét QR

**External Systems:**
- **Email Service (Resend):** Gửi email xác nhận — free tier 3.000 email/tháng đủ dùng
- **AI Provider (Gemini):** Generate summary từ PDF — free tier 60 RPM
- **Payment Gateway (VNPay):** Xử lý thanh toán workshop có phí — sandbox môi trường dev
- **Legacy Student System:** Không có API, chỉ export CSV vào thư mục lúc 2:00 sáng

---

### Level 2 — Container

```
┌────────────────────────────────────────────────────────────────────────────┐
│                           UniHub Workshop System                            │
│                                                                              │
│  ┌─────────────────────┐          ┌─────────────────────────────────────┐  │
│  │    Web Application   │          │         Mobile Application           │  │
│  │                      │          │                                      │  │
│  │  Next.js 14 (App     │          │  React Native + Expo                 │  │
│  │  Router) + Tailwind  │          │  iOS & Android                       │  │
│  │                      │          │                                      │  │
│  │  Pages:              │          │  Screens:                            │  │
│  │  - Workshop list     │          │  - QR Scanner (Camera)               │  │
│  │  - Workshop detail   │          │  - Check-in result                   │  │
│  │  - My registrations  │          │  - Offline queue status              │  │
│  │  - Admin dashboard   │          │                                      │  │
│  │  - Admin CRUD        │          │  Offline: SQLite (expo-sqlite)       │  │
│  │                      │          │  Sync: Background fetch              │  │
│  └──────────┬───────────┘          └──────────────┬──────────────────────┘  │
│             │ REST/HTTPS                           │ REST/HTTPS               │
│             │                                      │                          │
│  ┌──────────▼──────────────────────────────────────▼──────────────────────┐  │
│  │                        Backend API (Express.js)                         │  │
│  │                                                                          │  │
│  │  Port 3000 | REST API | JWT Auth | Middleware stack                     │  │
│  │                                                                          │  │
│  │  Routes: /auth, /workshops, /registrations, /checkin,                   │  │
│  │          /payments, /notifications, /admin/*                            │  │
│  │                                                                          │  │
│  │  Bull Queues (async workers, in-process with Redis):                    │  │
│  │  - notification-queue (via Resend email + in-app)                       │  │
│  │  - ai-summary-queue  (via Gemini API)                                   │  │
│  │  - retry logic for failed jobs                                          │  │
│  │                                                                          │  │
│  └──────┬────────────────────────────┬────────────┬───────────────────────┘  │
│         │                            │            │                           │
│  ┌──────▼──────┐  ┌──────────────────▼──┐  ┌─────▼─────────────────────┐   │
│  │ PostgreSQL  │  │       Redis           │  │   File Storage            │   │
│  │             │  │                       │  │                           │   │
│  │ Primary DB  │  │  - Cache (workshops)  │  │  Cloudflare R2 (free)    │   │
│  │ Connection  │  │  - Rate limit tokens  │  │  hoặc local disk /uploads│   │
│  │ Pool: 20    │  │  - Idempotency keys   │  │  - PDF files              │   │
│  │             │  │  - Job queue backend  │  │  - QR code images         │   │
│  │ Tables:     │  │  - Session data       │  │                           │   │
│  │ users       │  │                       │  └───────────────────────────┘   │
│  │ workshops   │  │  Connection pool: 10 │                                   │
│  │ registrations│ └───────────────────────┘                                  │
│  │ checkins    │                                                              │
│  │ payments    │                                                              │
│  │ ...         │                                                              │
│  └─────────────┘                                                              │
└────────────────────────────────────────────────────────────────────────────┘
```

**Lý do chọn công nghệ:**

| Thành phần | Lựa chọn | Lý do |
|------------|----------|-------|
| Frontend | Next.js 14 | Free deploy trên Vercel, SSR tốt cho SEO, App Router hỗ trợ streaming |
| Mobile | React Native + Expo | Một codebase cho iOS + Android, Expo Go cho dev nhanh, không cần Mac để test Android |
| Backend | Express.js (Node.js) | Đơn giản, có thể học nhanh, middleware pattern rõ ràng, hỗ trợ Bull job queue tốt |
| Database | PostgreSQL | ACID, row-level locking (quan trọng cho seat contention), free self-host |
| Cache/Rate Limit | Redis | Hỗ trợ Token Bucket, lưu idempotency keys, Bull queue backend — một service nhiều chức năng |
| Queue | Bull + Redis | In-process job queue, không cần riêng message broker service, durable (Redis persistence), retry tự động, đơn giản deploy |
| File | Cloudflare R2 | Free 10GB, S3-compatible API, không egress fee |
| Email | Resend | Free 3.000/tháng, API đơn giản |
| Auth | JWT + Refresh Token | Stateless, không cần session store riêng |

---

## High-Level Architecture Diagram

### Luồng dữ liệu tổng quan

```
                         INTERNET
                            │
                    ┌───────▼────────┐
                    │   Cloudflare   │  ← DDoS protection (free)
                    │   (CDN/Proxy)  │
                    └───────┬────────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
       ┌──────▼──┐   ┌──────▼──┐   ┌─────▼──────┐
       │  Next.js │   │Express  │   │React Native│
       │  Web App │   │   API   │   │ Mobile App │
       │ (Vercel) │   │ (VPS)   │   │(Expo build)│
       └──────────┘   └────┬────┘   └────────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────▼──┐  ┌──────▼──┐  ┌─────▼──────┐
        │Postgres│  │  Redis  │  │  R2 Storage│
        │  (VPS) │  │  (VPS)  │  │(Cloudflare)│
        └────────┘  └─────────┘  └────────────┘
              │
    ┌─────────┼──────────┬──────────────┐
    │         │          │              │
┌───▼──┐  ┌──▼───┐  ┌───▼───┐  ┌──────▼────┐
│Resend│  │Gemini│  │VNPay  │  │Legacy CSV │
│Email │  │  AI  │  │Payment│  │(file drop)│
└──────┘  └──────┘  └───────┘  └───────────┘
```

### Luồng check-in offline (điểm đặc biệt)

```
Mobile App                    Backend API
    │                              │
    │ [ONLINE] Quét QR             │
    │──────── POST /checkin ──────►│
    │◄─────── 200 OK ─────────────│
    │                              │
    │ [OFFLINE] Quét QR            │
    │  ┌────────────────────┐      │
    │  │ Lưu vào SQLite:    │      │
    │  │ {qr_code, time,    │      │
    │  │  status: "pending"}│      │
    │  └────────────────────┘      │
    │  Hiển thị "Đã ghi nhận"      │
    │  (optimistic UI)             │
    │                              │
    │ [KHI CÓ MẠNG TRỞ LẠI]      │
    │──── POST /checkin/sync ─────►│
    │  [batch: pending records]    │
    │◄─── 200 {results: [...]} ───│
    │  Update SQLite: confirmed    │
```

### Luồng tích hợp CSV (điểm đặc biệt)

```
Legacy System           VPS Filesystem        Express.js Cron Job (Node-cron)
    │                        │                      │
    │ 02:00 AM               │                      │
    │── export students.csv ►│                      │
    │                        │                      │
    │                        │     02:05 AM         │
    │                        │◄─── read file ───────│ (cron.schedule)
    │                        │                      │
    │                        │                      │ TRUNCATE staging_students
    │                        │                      │ COPY CSV rows to staging
    │                        │                      │ Validate (duplicate, format)
    │                        │                      │ Log validation errors
    │                        │                      │
    │                        │                      │ BEGIN TRANSACTION
    │                        │                      │ DELETE users WHERE role='student'
    │                        │                      │ INSERT from staging_students
    │                        │                      │ COMMIT (atomic)
    │                        │                      │
    │                        │                      │ Log import_batch success
```

**Quan trọng:** Đây là cron job chạy theo schedule, không phải event-driven. Không publish event vào queue.

---

## Thiết kế cơ sở dữ liệu

### Lựa chọn: PostgreSQL duy nhất (không kết hợp NoSQL)

**Lý do:**
- **Đơn giản vận hành:** Một database, một connection string, một backup strategy.
- **ACID đầy đủ:** Cần thiết cho seat allocation (transaction isolation), payment record.
- **Row-level locking:** `SELECT ... FOR UPDATE` để xử lý seat contention mà không cần distributed lock phức tạp.
- **JSONB:** PostgreSQL hỗ trợ JSONB tốt, dùng cho các field schema linh hoạt (metadata, offline_queue).
- **Chi phí:** Self-host miễn phí, không cần MongoDB Atlas hay DynamoDB.

Redis được dùng nhưng chỉ là cache + queue backend, không phải primary storage.

---

### Schema Database

```sql
-- ==========================================
-- USERS & AUTHENTICATION
-- ==========================================

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    VARCHAR(20) UNIQUE,          -- Mã sinh viên (NULL cho admin/staff)
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(255) NOT NULL,
  role          VARCHAR(20) NOT NULL          -- 'student' | 'organizer' | 'checkin_staff'
                CHECK (role IN ('student', 'organizer', 'checkin_staff')),
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked     BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Bảng staging để import CSV (swap atomic)
CREATE TABLE staging_students (
  student_id  VARCHAR(20) PRIMARY KEY,
  email       VARCHAR(255) NOT NULL,
  full_name   VARCHAR(255) NOT NULL,
  faculty     VARCHAR(100),
  class_code  VARCHAR(50),
  import_batch VARCHAR(50) NOT NULL  -- timestamp của lần import
);

-- ==========================================
-- WORKSHOPS
-- ==========================================

CREATE TABLE rooms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL,
  building    VARCHAR(100),
  capacity    INT NOT NULL,
  floor_map_url VARCHAR(500),  -- URL đến sơ đồ phòng
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE speakers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name   VARCHAR(255) NOT NULL,
  title       VARCHAR(255),
  bio         TEXT,
  avatar_url  VARCHAR(500),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE workshops (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           VARCHAR(500) NOT NULL,
  description     TEXT,
  ai_summary      TEXT,                    -- Generated bởi AI từ PDF
  pdf_url         VARCHAR(500),            -- URL file PDF đã upload
  speaker_id      UUID REFERENCES speakers(id),
  room_id         UUID REFERENCES rooms(id),
  starts_at       TIMESTAMPTZ NOT NULL,
  ends_at         TIMESTAMPTZ NOT NULL,
  capacity        INT NOT NULL,
  registered_count INT NOT NULL DEFAULT 0, -- Denormalized counter
  status          VARCHAR(20) NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'published', 'cancelled')),
  is_paid         BOOLEAN DEFAULT false,
  price           DECIMAL(10,2) DEFAULT 0,
  registration_opens_at  TIMESTAMPTZ,
  registration_closes_at TIMESTAMPTZ,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Index cho các query phổ biến
CREATE INDEX idx_workshops_starts_at ON workshops(starts_at);
CREATE INDEX idx_workshops_status ON workshops(status);

-- ==========================================
-- REGISTRATIONS
-- ==========================================

CREATE TABLE registrations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  workshop_id     UUID NOT NULL REFERENCES workshops(id),
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'confirmed', 'cancelled', 'attended')),
  qr_code         VARCHAR(500) UNIQUE,     -- QR token (signed JWT)
  registered_at   TIMESTAMPTZ DEFAULT NOW(),
  cancelled_at    TIMESTAMPTZ,
  payment_id      UUID,                    -- FK đến payments (nullable cho free workshop)

  UNIQUE (user_id, workshop_id)            -- Mỗi SV chỉ đăng ký 1 lần mỗi workshop
);

CREATE INDEX idx_registrations_user ON registrations(user_id);
CREATE INDEX idx_registrations_workshop ON registrations(workshop_id);
CREATE INDEX idx_registrations_qr ON registrations(qr_code);

-- ==========================================
-- PAYMENTS
-- ==========================================

CREATE TABLE payments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id   UUID NOT NULL REFERENCES registrations(id),
  user_id           UUID NOT NULL REFERENCES users(id),
  amount            DECIMAL(10,2) NOT NULL,
  currency          VARCHAR(3) DEFAULT 'VND',
  status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
  idempotency_key   VARCHAR(255) UNIQUE NOT NULL,  -- Client-generated key
  gateway           VARCHAR(50) DEFAULT 'vnpay',
  gateway_txn_id    VARCHAR(255),                  -- ID từ VNPay
  gateway_response  JSONB,                         -- Raw response lưu để debug
  paid_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_payments_idempotency ON payments(idempotency_key);
CREATE INDEX idx_payments_registration ON payments(registration_id);

-- ==========================================
-- CHECK-IN
-- ==========================================

CREATE TABLE checkins (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id UUID NOT NULL REFERENCES registrations(id) UNIQUE,
  staff_id      UUID REFERENCES users(id),
  checked_in_at TIMESTAMPTZ NOT NULL,
  source        VARCHAR(20) DEFAULT 'online'
                CHECK (source IN ('online', 'offline_sync')),
  device_id     VARCHAR(255),  -- ID thiết bị của nhân sự check-in
  synced_at     TIMESTAMPTZ,  -- NULL nếu check-in online trực tiếp
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- NOTIFICATIONS
-- ==========================================

CREATE TABLE notification_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id),
  channel       VARCHAR(20) NOT NULL  -- 'email' | 'app' | 'telegram'
                CHECK (channel IN ('email', 'app', 'telegram')),
  type          VARCHAR(50) NOT NULL,  -- 'registration_confirmed', 'workshop_cancelled', ...
  payload       JSONB,
  status        VARCHAR(20) DEFAULT 'sent'
                CHECK (status IN ('sent', 'failed', 'pending')),
  sent_at       TIMESTAMPTZ DEFAULT NOW()
);

-- In-app notifications
CREATE TABLE app_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id),
  title       VARCHAR(255) NOT NULL,
  body        TEXT,
  type        VARCHAR(50) NOT NULL,
  is_read     BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_app_notif_user ON app_notifications(user_id, is_read);
```

### Giải thích các quyết định schema quan trọng

**`registered_count` denormalized trên workshops:**
Thay vì COUNT(*) mỗi lần query, giữ counter này và update atomic cùng với INSERT registration trong một transaction. Tránh full table scan khi hiển thị số chỗ còn lại.

**`idempotency_key` UNIQUE trên payments:**
Cột này là chìa khóa để chống double-charge. Client tạo key trước khi gọi API, server kiểm tra UNIQUE constraint. PostgreSQL đảm bảo chỉ một INSERT thành công ngay cả khi concurrent.

**`qr_code` là signed JWT:**
QR token là một JWT chứa `{registration_id, workshop_id, user_id}`, ký bằng server secret. Khi offline, mobile app có thể verify signature cục bộ mà không cần gọi API.

---

## Thiết kế kiểm soát truy cập

### Mô hình: RBAC (Role-Based Access Control)

Ba role cố định, không có permission tùy chỉnh phức tạp (đủ dùng cho đồ án):

| Role | Mô tả | Permissions |
|------|-------|-------------|
| `student` | Sinh viên | Xem workshop, đăng ký, hủy đăng ký của mình, xem QR của mình |
| `organizer` | Ban tổ chức | Tất cả quyền của student + tạo/sửa/hủy workshop, xem thống kê, upload PDF |
| `checkin_staff` | Nhân sự check-in | Chỉ dùng API quét QR và đồng bộ offline |

### Triển khai kiểm soát truy cập trong Express.js

```javascript
// 1. JWT Payload chứa role
interface JwtPayload {
  sub: string;     // user_id
  email: string;
  role: 'student' | 'organizer' | 'checkin_staff';
  iat: number;
  exp: number;
}

// 2. Middleware xác thực JWT
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// 3. Middleware kiểm tra role
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    next();
  };
}

// 4. Sử dụng middleware trên route
app.put(
  '/admin/workshops/:id',
  authMiddleware,
  requireRole('organizer'),
  (req, res) => {
    // Update workshop logic
  }
);

// 5. Kiểm tra ownership (student chỉ xem data của mình)
app.get(
  '/registrations/my',
  authMiddleware,
  requireRole('student'),
  async (req, res) => {
    const registrations = await db.registrations.findMany({
      where: { user_id: req.user.sub }
    });
    res.json(registrations);
  }
);
```

### Ma trận phân quyền theo API endpoint

| Endpoint | student | organizer | checkin_staff |
|----------|---------|-----------|---------------|
| GET /workshops | ✅ | ✅ | ✅ |
| GET /workshops/:id | ✅ | ✅ | ✅ |
| POST /registrations | ✅ | ✅ | ❌ |
| GET /registrations/my | ✅ | ✅ | ❌ |
| DELETE /registrations/:id | ✅ (own) | ✅ | ❌ |
| POST /workshops | ❌ | ✅ | ❌ |
| PUT /workshops/:id | ❌ | ✅ | ❌ |
| DELETE /workshops/:id | ❌ | ✅ | ❌ |
| GET /workshops/stats | ❌ | ✅ | ❌ |
| POST /workshops/:id/pdf | ❌ | ✅ | ❌ |
| POST /checkin/scan | ❌ | ✅ | ✅ |
| POST /checkin/sync | ❌ | ❌ | ✅ |
| GET /admin/* | ❌ | ✅ | ❌ |

### Bảo mật bổ sung

- **JWT expiry:** Access token 15 phút, Refresh token 7 ngày
- **Refresh token rotation:** Mỗi lần refresh tạo token mới, token cũ bị revoke
- **Admin route guard:** Tất cả `/admin/*` yêu cầu role `organizer`, check tại middleware level trước khi vào controller
- **Rate limit per user:** Áp dụng thêm rate limit theo `user_id` cho POST /registrations để tránh spam

---

## Thiết kế các cơ chế bảo vệ hệ thống

### 1. Kiểm soát tải đột biến — Token Bucket Rate Limiting

**Bài toán:** 12.000 sinh viên, 60% trong 3 phút đầu = ~7.200 users trong 180 giây = ~40 requests/giây cho endpoint đăng ký. Backend Express.js trên VPS free tier có thể handle 200–500 RPS bình thường, nhưng với DB transaction nặng (seat lock) thì bottleneck thực tế thấp hơn nhiều.

**Giải pháp: Token Bucket per User + Global Rate Limit**

```
Mỗi user có một "bucket" chứa token.
- Bucket capacity: 5 tokens
- Refill rate: 1 token/giây
- Mỗi request tiêu 1 token
- Bucket lưu trong Redis với TTL

Ngoài ra, global bucket cho toàn API:
- Global capacity: 500 tokens (500 RPS)
- Refill: 500 tokens/giây
```

**Tại sao Token Bucket thay vì Fixed Window?**
- Fixed Window bị "thundering herd" vào đầu mỗi window.
- Token Bucket làm mượt traffic, cho phép burst nhỏ nhưng giới hạn sustained rate.
- Phù hợp hơn cho mobile client có thể retry aggressively.

**Triển khai với Redis (Lua script để atomic):**

```lua
-- Redis Lua script: token_bucket.lua
-- KEYS[1]: bucket key (vd: "rl:user:uuid123")
-- ARGV[1]: capacity, ARGV[2]: refill_rate/s, ARGV[3]: now (unix ms), ARGV[4]: cost

local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens = tonumber(bucket[1]) or capacity
local last_refill = tonumber(bucket[2]) or now

-- Tính số token được refill từ lần trước
local elapsed = (now - last_refill) / 1000
local new_tokens = math.min(capacity, tokens + elapsed * rate)

if new_tokens < cost then
  return {0, math.ceil((cost - new_tokens) / rate * 1000)}  -- 0 = denied, retry_after ms
end

new_tokens = new_tokens - cost
redis.call('HMSET', key, 'tokens', new_tokens, 'last_refill', now)
redis.call('PEXPIRE', key, math.ceil(capacity / rate * 1000) + 1000)
return {1, 0}  -- 1 = allowed
```

**Express.js Middleware cho Rate Limiting:**

```javascript
const redis = require('redis');
const client = redis.createClient();

async function tokenBucketMiddleware(req, res, next) {
  const userId = req.user?.sub || req.ip;
  const key = `rl:user:${userId}`;
  const capacity = 5;
  const refillRate = 1; // token/giây
  const now = Date.now();
  const cost = 1;

  // Chạy Lua script trên Redis
  const result = await client.eval(
    `-- Token bucket Lua script (as above)`,
    { keys: [key], arguments: [capacity, refillRate, now, cost] }
  );

  if (result[0] === 0) {
    // Denied
    const retryAfter = Math.ceil(result[1] / 1000);
    return res.status(429)
      .set('Retry-After', retryAfter)
      .json({ error: 'Too many requests', retry_after_seconds: retryAfter });
  }

  // Allowed
  next();
}

// Dùng trên critical endpoint
app.post('/registrations', authMiddleware, tokenBucketMiddleware, async (req, res) => {
  // Handle registration
});
```

**Lý do Express thay vì NestJS cho rate limiting:**
- Express middleware pattern rõ ràng, dễ debug
- Không cần decorator complexity
- Lua script chạy trực tiếp trên Redis, không phụ thuộc framework
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const key = `rl:reg:${user?.sub || request.ip}`;

    const [allowed, retryAfter] = await this.redis.eval(
      TOKEN_BUCKET_SCRIPT,
      1, key,
      5,    // capacity
      1,    // 1 token/second
      Date.now(),
      1     // cost per request
    );

    if (!allowed) {
      const response = context.switchToHttp().getResponse();
      response.setHeader('Retry-After', retryAfter / 1000);
      throw new HttpException('Too Many Requests', 429);
    }
    return true;
  }
}
```

**Hành vi khi vượt ngưỡng:**
- HTTP 429 với header `Retry-After: X` (giây)
- Response body: `{"error": "Quá nhiều yêu cầu. Vui lòng thử lại sau X giây."}`
- Frontend hiển thị countdown, không spam retry

---

### 2. Xử lý cổng thanh toán không ổn định — Circuit Breaker

**Bài toán:** Nếu VNPay timeout hoặc lỗi liên tục, mỗi request đăng ký workshop có phí sẽ đợi 30 giây rồi fail. 100 user đồng thời = 100 thread/connection bị treo = backend tê liệt.

**Giải pháp: Circuit Breaker với 3 trạng thái**

```
         failure_threshold đạt              success sau half-open
CLOSED ──────────────────────────► OPEN ──────────────────────► CLOSED
  ▲                                   │
  │                                   │ timeout (60s)
  │                                   ▼
  └──────────── HALF-OPEN ◄───────────┘
       (thử 1 request probe)
```

**Trạng thái và ngưỡng:**

| Trạng thái | Hành vi | Điều kiện chuyển |
|------------|---------|------------------|
| **CLOSED** | Gọi bình thường, đếm failure | 5 failures trong 30s → OPEN |
| **OPEN** | Từ chối ngay, không gọi gateway | Sau 60s → HALF-OPEN |
| **HALF-OPEN** | Cho 1 request thử qua | Thành công → CLOSED, Thất bại → OPEN |

**Lưu trữ state trong Redis (TTL tự động reset):**

```javascript
// File: src/utils/circuitBreaker.js
const redis = require('redis');

const FAILURE_THRESHOLD = 5;
const RESET_TIMEOUT = 60_000; // 60s
const WINDOW = 30_000;        // 30s window

async function executeWithCircuitBreaker(fn, name, redisClient) {
  // Get current state
  const state = await redisClient.get(`cb:${name}:state`);

  if (state === 'OPEN') {
    // Graceful degradation: return meaningful error
    const err = new Error('Cổng thanh toán tạm thời không khả dụng. Vui lòng thử lại sau ít phút.');
    err.statusCode = 503;
    throw err;
  }

  try {
    // Execute with 10s timeout
    const result = await Promise.race([
      fn(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), 10_000)
      )
    ]);

    // Success: reset to CLOSED if was HALF-OPEN
    if (state === 'HALF-OPEN') {
      await redisClient.del(`cb:${name}:state`);
      await redisClient.del(`cb:${name}:failures`);
    }
    return result;

  } catch (error) {
    // Record failure
    await redisClient.incr(`cb:${name}:failures`);
    const failures = await redisClient.get(`cb:${name}:failures`);

    if (parseInt(failures) >= FAILURE_THRESHOLD) {
      // Open circuit: reject future requests for 60s
      await redisClient.setex(`cb:${name}:state`, 60, 'OPEN');
      await redisClient.del(`cb:${name}:failures`);
    }
    throw error;
  }
}

module.exports = { executeWithCircuitBreaker };
```

**Graceful Degradation:**
- Khi OPEN, endpoint `POST /registrations` với workshop có phí trả về 503 với thông báo rõ ràng.
- Tất cả endpoint KHÔNG liên quan payment vẫn hoạt động bình thường (Circuit Breaker chỉ bao quanh lời gọi VNPay service, không ảnh hưởng các module khác).
- Frontend hiển thị banner: "Chức năng thanh toán đang tạm gián đoạn. Bạn vẫn có thể xem và đăng ký workshop miễn phí."

---

### 3. Chống trừ tiền hai lần — Idempotency Key

**Bài toán:** Client timeout sau khi server đã gọi VNPay thành công. Client retry → server gọi VNPay lần 2 → double charge.

**Giải pháp: Idempotency Key trên cả client và server**

**Luồng hoàn chỉnh:**

```
CLIENT                          SERVER                        VNPay
  │                               │                             │
  │ 1. Generate idempotency_key   │                             │
  │    = UUID v4, lưu localStorage│                             │
  │                               │                             │
  │── POST /payments ────────────►│                             │
  │   {workshop_id, idempotency_key}                            │
  │                               │ 2. Check Redis:             │
  │                               │    EXISTS ik:{key}?         │
  │                               │    → NO: tiếp tục           │
  │                               │    → YES: trả kết quả cũ   │
  │                               │                             │
  │                               │ 3. Set Redis:               │
  │                               │    ik:{key} = "processing"  │
  │                               │    TTL = 24h                │
  │                               │                             │
  │                               │── call VNPay ──────────────►│
  │                               │◄── response ───────────────│
  │                               │                             │
  │                               │ 4. INSERT payments          │
  │                               │    (idempotency_key UNIQUE) │
  │                               │                             │
  │                               │ 5. Set Redis:               │
  │                               │    ik:{key} = {result}      │
  │                               │    TTL = 24h                │
  │                               │                             │
  │◄── 200 {payment_url} ─────────│                             │
  │                               │                             │
  │ [TIMEOUT/RETRY]               │                             │
  │── POST /payments (same key) ─►│                             │
  │                               │ Check Redis: EXISTS → YES   │
  │                               │ Return cached result        │
  │◄── 200 {same payment_url} ────│  (VNPay KHÔNG bị gọi lại)  │
```

**Chi tiết kỹ thuật:**

```javascript
// File: src/routes/payments.js
const express = require('express');
const { v4: uuidv4, validate: validateUUID } = require('uuid');
const { executeWithCircuitBreaker } = require('../utils/circuitBreaker');
const db = require('../db/pool');
const redis = require('../db/redis');

router.post('/payments', authMiddleware, async (req, res) => {
  const { workshop_id, idempotency_key } = req.body;
  const user = req.user;

  try {
    // 1. Validate idempotency_key format (UUID v4)
    if (!validateUUID(idempotency_key, 4)) {
      return res.status(400).json({ 
        error: 'idempotency_key phải là UUID v4 hợp lệ' 
      });
    }

    const cacheKey = `ik:payment:${idempotency_key}`;

    // 2. Check Redis cache first
    const cached = await redis.get(cacheKey);
    if (cached === 'processing') {
      return res.status(409).json({ 
        error: 'Yêu cầu đang được xử lý, vui lòng chờ' 
      });
    }
    if (cached) {
      return res.status(200).json(JSON.parse(cached)); // Return old result, don't reprocess
    }

    // 3. Lock: mark as processing
    await redis.setex(cacheKey, 86400, 'processing'); // 24h TTL

    // 4. Create payment record in DB first (idempotency_key UNIQUE constraint)
    const payment = await db.query(
      `INSERT INTO payments (registration_id, user_id, amount, idempotency_key, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING id, amount`,
      [registration_id, user.sub, workshop_price, idempotency_key]
    );

    // 5. Call VNPay via Circuit Breaker
    const vnpayResult = await executeWithCircuitBreaker(
      () => vnpayService.createPaymentUrl(payment.rows[0]),
      'vnpay',
      redis
    );

    // 6. Cache result
    const result = { 
      payment_id: payment.rows[0].id, 
      payment_url: vnpayResult.url 
    };
    await redis.setex(cacheKey, 86400, JSON.stringify(result));

    res.status(200).json(result);

  } catch (error) {
    // If error, clear "processing" so client can retry
    await redis.del(cacheKey);
    
    if (error.statusCode === 409) {
      // Duplicate idempotency_key (UNIQUE constraint)
      return res.status(409).json({ error: 'Bạn đã đăng ký workshop này rồi' });
    }
    
    if (error.statusCode === 503) {
      // Circuit breaker open
      return res.status(503).json({ error: error.message });
    }
    
    res.status(500).json({ error: error.message });
  }
});
```

**Thời gian hết hạn:**
- Redis key TTL: 24 giờ (đủ để handle retry trong ngày, không tốn memory lâu dài)
- PostgreSQL `idempotency_key` UNIQUE: permanent, backup cho Redis miss

**Nơi lưu trữ:**
- **Redis:** Fast lookup, O(1), TTL tự động cleanup
- **PostgreSQL:** Durable backup, UNIQUE constraint là safety net cuối cùng

---

## Kiến trúc UI và Frontend

### 1. Phân tách ứng dụng theo vai trò người dùng

**Quyết định:** Tách trải nghiệm người dùng theo persona thay vì tách thành nhiều deployment độc lập. UniHub dùng một ứng dụng web Next.js cho sinh viên và ban tổ chức, cùng một ứng dụng mobile Expo dành riêng cho nhân sự check-in.

**Lý do:**
- Giữ đúng Single Responsibility Principle ở cấp ứng dụng: sinh viên, admin và check-in staff có nhu cầu khác nhau rõ rệt
- Tránh overhead vận hành của một admin frontend riêng
- Giữ mobile app tập trung hoàn toàn vào check-in offline-first thay vì dàn trải thêm các tính năng sinh viên hoặc admin
- Cho phép kiểm soát chặt chẽ type-safety và API contract giữa UI với backend

**Đánh đổi:**
- Student web và admin web dùng chung codebase nên cần tổ chức route, layout và component rõ ràng để tránh lẫn trách nhiệm
- Chấp nhận được vì vẫn chỉ có một web deployment, phù hợp ràng buộc đồ án

### 2. Kiến trúc Web Application (Next.js 14 App Router)

**Mục tiêu người dùng:**
- Sinh viên: xem workshop, đăng ký, theo dõi trạng thái thanh toán, nhận xác nhận
- Ban tổ chức: dashboard, CRUD workshop, scheduling, audit logs, settings

**Quyết định:**
- Dùng React Server Components mặc định cho các trang đọc dữ liệu nhiều
- Chỉ dùng `"use client"` ở các lá tương tác mạnh như form, modal, nút đăng ký, widget polling
- Tất cả business mutation đi qua Express backend API, không phụ thuộc Next.js Server Actions cho các luồng nghiệp vụ chính

**Tổ chức route:**
- `(student)/...` cho luồng public và sinh viên
- `admin/...` cho luồng nội bộ của organizer/admin

**Lý do:**
- Giảm JavaScript phía client cho các trang đọc nhiều
- Giữ ranh giới rõ giữa tầng hiển thị và tầng nghiệp vụ
- Dễ áp dụng RBAC trong layout và middleware

### 3. Kiến trúc Mobile Application (React Native + Expo)

**Mục tiêu người dùng:**
- Chỉ dành cho check-in staff

**Quyết định:**
- Mobile app theo mô hình offline-first
- Quét QR tương tác với `expo-sqlite` trước, không phụ thuộc kết nối mạng tại thời điểm scan
- Đồng bộ theo cơ chế background hoặc manual sync khi có mạng trở lại
- Dùng Expo Router để giữ navigation đơn giản và nhất quán

**Lý do:**
- Khu vực check-in có thể mạng yếu hoặc mất mạng
- Event-day workflow cần phản hồi nhanh hơn là phụ thuộc round-trip đến server
- SQLite phù hợp hơn key-value storage cho hàng đợi check-in

### 4. Chiến lược truy xuất dữ liệu và type safety

**Quyết định:**
- UI không truy cập trực tiếp PostgreSQL; mọi dữ liệu đi qua backend API
- Web dùng typed API client bọc quanh `fetch`
- Public reads như workshop list có thể dùng caching/revalidation
- User-specific và admin-sensitive data dùng dynamic fetching
- Mobile sync dùng explicit sync action và retry, không dùng subscription real-time

**Lý do:**
- Giữ backend là source of truth
- Tránh rò rỉ logic truy vấn vào frontend
- Type contract rõ ràng giúp giảm lỗi khi thay đổi API

**Ràng buộc kiểu dữ liệu:**
- DTO và validation schema ở frontend phải mirror contract backend
- `react-hook-form` + `zod` được dùng cho form state và validation

### 5. Design System và ngôn ngữ thị giác

**Quyết định:** Dùng chung triết lý component nhưng phân tách rõ visual language theo persona. Ba bề mặt `student web`, `admin web`, và `mobile check-in` không nên giống hệt nhau.

#### A. Student Web

- Hướng thị giác: sống động, thân thiện, khơi gợi khám phá
- Dùng card phân lớp, gradient nhẹ, bề mặt kính mờ sáng để tạo cảm giác sự kiện
- Trạng thái quan trọng cần nổi bật:
  - số chỗ còn lại
  - miễn phí hay có phí
  - còn mở đăng ký hay đã đầy
  - AI summary hoặc điểm nổi bật workshop

#### B. Admin Web

- Hướng thị giác: vận hành, rõ ràng, data-dense
- Ưu tiên table, chart, filter, badge trạng thái, alert card
- Trang admin cần ít trang trí hơn student portal; ưu tiên clarity hơn novelty
- Trạng thái cần thể hiện rõ:
  - loading
  - stale data timestamp
  - destructive action confirmation
  - anomaly severity

#### C. Mobile Check-in

- Hướng thị giác: high-contrast, dark, action-oriented
- Nền tối giúp đỡ mỏi mắt và tăng readability khi scan QR trong hội trường
- Feedback phải nhận ra ngay:
  - scan thành công
  - QR không hợp lệ
  - QR đã check-in
  - scan offline đang chờ sync

### 6. Cấu trúc component và thư mục frontend

**Quyết định:** Tách rõ phần orchestration và phần presentation. Screen-level container hoặc server component lo fetch dữ liệu typed; component nhỏ hơn lo render và interaction.

**Web**

```text
frontend/
├── app/
│   ├── (student)/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── workshops/[id]/page.tsx
│   └── admin/
│       ├── layout.tsx
│       ├── dashboard/page.tsx
│       ├── workshops/page.tsx
│       └── audit-logs/page.tsx
├── components/
│   ├── ui/           # component presentation-only
│   ├── student/      # composite component cho sinh viên
│   └── admin/        # composite component cho admin
└── lib/
    ├── api-client.ts
    └── theme-utils.ts
```

**Mobile**

```text
mobile/
├── app/
│   ├── _layout.tsx
│   ├── (auth)/index.tsx
│   └── (checkin)/
│       ├── scanner.tsx
│       └── sync-queue.tsx
├── components/
│   ├── QROverlay.tsx
│   └── StatusToast.tsx
└── lib/
    └── offline-store.ts
```

**Nguyên tắc:**
- `ui/` chỉ nên chứa primitive hoặc component thiên về style và accessibility
- Không đặt business logic nặng trong leaf UI component
- Logic offline persistence phải nằm trong `lib/` thay vì screen component

### 7. Quản lý state phía frontend

**Quyết định:** Ưu tiên state pattern có sẵn của framework trước, tránh thêm global state library nếu chưa có nhu cầu rõ ràng.

**Lý do:**
- Giảm bundle size và giảm chi phí nhận thức khi phát triển
- Phù hợp với RSC trên web và screen-scoped state trên mobile

**Cách áp dụng:**
- Web server state:
  - React Server Components cho read-heavy data
  - dynamic fetch cho dữ liệu authenticated hoặc admin-only
- Web client state:
  - `useState`, `useReducer`, `useContext`
  - `react-hook-form` + `zod`
- Mobile local state:
  - state cấp màn hình cho camera, sync status, feedback
  - `expo-sqlite` là source of truth cho pending offline check-ins

### 8. ADR cho frontend

### ADR-006: Styling Framework Across Web and Mobile

**Quyết định:** Dùng Tailwind CSS cho web Next.js và NativeWind-compatible utility styling cho Expo mobile.

**Lý do:**
- Tăng tốc độ iteration
- Giữ chung tư duy utility-first giữa web và mobile
- Dễ trích xuất reusable UI primitives

**Đánh đổi:**
- JSX có thể verbose hơn
- Giảm rủi ro bằng cách gom pattern lặp lại vào shared component và helper

### ADR-007: Mobile Offline Storage Engine

**Quyết định:** Dùng `expo-sqlite` thay vì `AsyncStorage`.

**Lý do:**
- Hàng đợi check-in cần query có cấu trúc, deduplication, và kiểm tra record pending
- SQLite phù hợp hơn key-value storage cho bài toán này

**Đánh đổi:**
- Setup và quản lý schema cục bộ phức tạp hơn một chút
- Chấp nhận vì độ bền của event-day workflow quan trọng hơn

### ADR-008: Web Component Segregation

**Quyết định:** Dùng server component như data-loading container và client component như presenter xử lý interaction khi phù hợp.

**Lý do:**
- Thỏa Single Responsibility ở cấp component
- Giảm client bundle cho trang đọc nhiều
- Giữ business mutation đi qua backend API nhưng vẫn có UI composition sạch

**Đánh đổi:**
- Cần cẩn thận với server/client boundary và serializable props
- Chấp nhận vì lợi ích về hiệu năng và maintainability phù hợp với UniHub

---

## Các quyết định kỹ thuật quan trọng (ADR)

### ADR-001: Monolith Modular vs Microservices

**Quyết định:** Monolith Modular

**Lý do:** VPS Oracle Free Tier chỉ có 1GB RAM. Microservices tối thiểu cần 5–8 services × 128MB = 640MB–1GB RAM chỉ cho overhead, chưa tính business logic. Không khả thi.

**Đánh đổi:** Không thể scale từng component độc lập, nhưng với 12.000 sinh viên/năm (không phải concurrent users liên tục), không cần thiết.

---

### ADR-002: BullMQ vs Separate Message Broker (RabbitMQ/Kafka)

**Quyết định:** BullMQ (Redis-backed, in-process với Express.js)

**Lý do:** RabbitMQ cần thêm một container, thêm RAM, thêm ops. BullMQ dùng Redis vốn đã cần cho rate limiting và cache — không tốn thêm resource. Kafka hoàn toàn overkill cho đồ án này.

**Đánh đổi:** BullMQ không có advanced routing như RabbitMQ, nhưng đủ dùng cho email/AI/CSV queue.

---

### ADR-003: JWT vs Session-based Auth

**Quyết định:** JWT (stateless) cho Web/Mobile

**Lý do:** Mobile app không có session cookie mechanism tốt. JWT cho phép verify ở mobile mà không cần gọi server (offline QR verification). Refresh token stored in Redis cho phép revoke nếu cần.

**Đánh đổi:** Access token không thể revoke ngay (chỉ hết hạn sau 15 phút). Chấp nhận được vì đây là ứng dụng nội bộ trường.

---

### ADR-004: PostgreSQL Row-level Lock vs Redis Distributed Lock cho Seat Allocation

**Quyết định:** Kết hợp: Redis cho "pre-check" (fast path) + PostgreSQL transaction cho "final commit"

**Lý do:**
- Redis `DECRBY registered_count` (atomic) làm quick check xem còn chỗ không, loại bỏ 90% request sớm.
- PostgreSQL `SELECT ... FOR UPDATE` + `registered_count++` trong transaction làm final commit, đảm bảo ACID tuyệt đối.
- Không dùng Redis distributed lock duy nhất vì Redis không có ACID — có thể mất data nếu Redis restart đúng lúc commit.

---

### ADR-005: Offline QR Verification

**Quyết định:** QR code là JWT signed bởi server secret

**Lý do:** Mobile app có thể verify JWT signature offline (server public key được cache khi app khởi động). Chỉ cần online khi sync checkin records về server.

**Đánh đổi:** Nếu registration bị hủy sau khi đã generate QR, offline verification không phát hiện được. Giải pháp: sync danh sách cancelled registrations vào SQLite local của app mỗi khi có mạng.
