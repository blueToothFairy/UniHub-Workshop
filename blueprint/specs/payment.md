# Đặc tả hợp nhất: Đăng ký Workshop có phí qua VNPay

## 1. Mục tiêu

Sinh viên chọn workshop có phí, thực hiện thanh toán qua VNPay và nhận mã QR xác nhận. Chức năng phải đảm bảo:

1. **Không oversell chỗ**: tổng số chỗ đang giữ và đã xác nhận không vượt quá `capacity`.
2. **Không double-charge**: retry, timeout, duplicate request, duplicate callback không tạo nhiều payment cho cùng một lần đăng ký.
3. **Hoạt động đúng khi gateway có vấn đề**: VNPay timeout, callback trễ, callback lặp, circuit breaker open, server crash giữa luồng đều được xử lý an toàn.
4. **VNPay callback xử lý synchronous trong backend**: payment record và registration record phải được cập nhật ngay trong request callback, không đẩy payment callback vào queue.
5. **Chỉ publish `RegistrationConfirmed` event vào notification queue**: notification là side-effect sau khi DB đã cập nhật thành công; payment correctness không phụ thuộc queue.

---

## 2. Nguyên tắc thiết kế hợp nhất

### 2.1. Giữ lại từ thiết kế cũ

- VNPay callback được xử lý **synchronous** trong backend.
- Chỉ publish `RegistrationConfirmed` vào notification queue.
- Validate JWT, check role `student`, check rate limit trước khi đăng ký.
- Timeout khi gọi VNPay tối đa **10 giây**.
- Có circuit breaker cho VNPay.
- Có reconciliation job cho trạng thái `unknown`.
- Có QR token dạng signed JWT, hết hạn sau khi workshop kết thúc.
- Có unique constraint cho payment identifiers.
- Có status endpoint để frontend kiểm tra lại trạng thái khi timeout/retry.
- Có cache Redis cho rate limit, circuit breaker, payment status/idempotency response nếu cần tối ưu latency.

### 2.2. Điều chỉnh từ thiết kế v2

- Không dùng `registered_count` với nghĩa mơ hồ.
- Tách counter thành:
  - `reserved_count`: số chỗ đã giữ, gồm `pending_payment + confirmed`.
  - `confirmed_count`: số chỗ đã thanh toán thành công.
- PostgreSQL là **source of truth** cho seat reservation và payment final state.
- Không dùng Redis seat counter để quyết định giữ chỗ.
- `Idempotency-Key` do client gửi lên qua header.
- Callback success/failed phải idempotent.
- Có `reservation_expires_at` để tránh giữ chỗ vĩnh viễn.
- Có `merchant_order_id` do backend sinh ra để reconciliation, vì khi VNPay timeout có thể chưa có `gateway_txn_id`.

### 2.3. Vai trò của Redis trong bản hợp nhất

Redis **được giữ lại**, nhưng không còn là nguồn sự thật cho số chỗ.

Redis có thể dùng cho:

```text
rate limit
circuit breaker state
cache workshop detail
cache payment status/idempotency response, TTL 24 giờ
```

Redis không được dùng làm source of truth cho:

```text
seat availability
reserved_count
confirmed_count
payment final status
registration final status
```

Nếu Redis cache lệch hoặc mất dữ liệu, PostgreSQL vẫn phải trả kết quả đúng.

---

## 3. Khái niệm dữ liệu

### 3.1. Workshop counters

```text
capacity
reserved_count   = số registration có status pending_payment hoặc confirmed
confirmed_count  = số registration có status confirmed
```

Invariant bắt buộc:

```text
0 <= confirmed_count <= reserved_count <= capacity
```

Ý nghĩa hiển thị:

```text
available_seats = capacity - reserved_count
registered      = confirmed_count
```

Lưu ý:

- Chống oversell phải dựa vào `reserved_count < capacity`.
- Không dùng `confirmed_count < capacity` để quyết định giữ chỗ, vì người chưa thanh toán vẫn đang giữ chỗ.

### 3.2. Registration status

```text
pending_payment
confirmed
cancelled
expired
```

Allowed transitions:

```text
pending_payment -> confirmed
pending_payment -> cancelled
pending_payment -> expired
```

Không tự động cho phép:

```text
cancelled -> confirmed
expired   -> confirmed
```

Nếu VNPay báo success sau khi registration đã `expired` hoặc `cancelled`, đưa payment vào `requires_review`. Không tự confirm vì chỗ có thể đã được trả lại và bán cho người khác.

### 3.3. Payment status

```text
initiating       -- đã tạo record, đang hoặc sắp gọi VNPay
redirect_ready   -- đã có payment_url để user thanh toán
unknown          -- không biết trạng thái thực tế do timeout/network error
completed        -- VNPay xác nhận thanh toán thành công
failed           -- VNPay xác nhận thanh toán thất bại
expired          -- pending quá hạn, đã release seat
requires_review  -- callback success đến sau khi registration đã expired/cancelled
```

Mapping với cách gọi trong thiết kế cũ:

```text
processing -> initiating
ready      -> redirect_ready
completed  -> completed
failed     -> failed
unknown    -> unknown
```

Allowed transitions chính:

```text
initiating     -> redirect_ready
initiating     -> unknown
initiating     -> failed
initiating     -> expired

redirect_ready -> completed
redirect_ready -> failed
redirect_ready -> unknown
redirect_ready -> expired

unknown        -> completed
unknown        -> failed
unknown        -> expired
unknown        -> requires_review

expired        -> requires_review
failed         -> requires_review
```

Duplicate callback vào state cuối như `completed`, `failed`, `expired`, `requires_review` phải trả `200 OK` và không thay đổi counter lần nữa.

---

## 4. Database schema đề xuất

### 4.1. `workshops`

Các field liên quan:

```sql
capacity          integer not null
reserved_count    integer not null default 0
confirmed_count   integer not null default 0
status            text not null
starts_at         timestamptz
ends_at           timestamptz
price             numeric(12, 2) not null
```

Constraint:

```sql
ALTER TABLE workshops
ADD CONSTRAINT chk_workshop_counts_valid
CHECK (
  capacity >= 0
  AND reserved_count >= 0
  AND confirmed_count >= 0
  AND confirmed_count <= reserved_count
  AND reserved_count <= capacity
);
```

### 4.2. `registrations`

Các field liên quan:

```sql
id                       uuid primary key
user_id                  uuid not null
workshop_id              uuid not null references workshops(id)
status                   text not null
reservation_expires_at   timestamptz
confirmed_at             timestamptz
cancelled_at             timestamptz
expired_at               timestamptz
qr_token_hash            text
qr_issued_at             timestamptz
created_at               timestamptz not null default now()
updated_at               timestamptz not null default now()
```

Partial unique index để ngăn duplicate active registration, nhưng vẫn cho phép user thử lại sau khi payment failed/expired:

```sql
CREATE UNIQUE INDEX uq_active_registration_user_workshop
ON registrations(user_id, workshop_id)
WHERE status IN ('pending_payment', 'confirmed');
```

### 4.3. `payments`

Các field liên quan:

```sql
id                         uuid primary key
registration_id            uuid not null references registrations(id)
user_id                    uuid not null
workshop_id                uuid not null
idempotency_key            text not null
request_hash               text not null
merchant_order_id          text not null
gateway                    text not null default 'vnpay'
gateway_txn_id             text
amount                     numeric(12, 2) not null
currency                   text not null default 'VND'
payment_url                text
status                     text not null
gateway_call_started_at    timestamptz
paid_at                    timestamptz
failed_at                  timestamptz
expired_at                 timestamptz
last_error_code            text
last_error_message         text
raw_gateway_response       jsonb
raw_callback_payload       jsonb
created_at                 timestamptz not null default now()
updated_at                 timestamptz not null default now()
```

Unique constraints:

```sql
ALTER TABLE payments
ADD CONSTRAINT uq_payments_registration_id
UNIQUE (registration_id);

ALTER TABLE payments
ADD CONSTRAINT uq_payments_idempotency_key
UNIQUE (idempotency_key);

ALTER TABLE payments
ADD CONSTRAINT uq_payments_merchant_order_id
UNIQUE (merchant_order_id);

CREATE UNIQUE INDEX uq_payments_gateway_txn_id_not_null
ON payments(gateway_txn_id)
WHERE gateway_txn_id IS NOT NULL;
```

Ghi chú:

- `merchant_order_id` do backend sinh ra trước khi gọi VNPay.
- Reconciliation ưu tiên dùng `merchant_order_id` vì khi VNPay timeout có thể backend chưa nhận được `gateway_txn_id`.
- `amount` là snapshot tại thời điểm đăng ký, không phụ thuộc giá workshop thay đổi sau đó.

### 4.4. Optional: `outbox_events`

Trong MVP 4 ngày, có thể enqueue notification sau DB commit. Nếu muốn chắc chắn không mất notification, thêm outbox:

```sql
id             uuid primary key
event_type     text not null
aggregate_id   uuid not null
payload        jsonb not null
status         text not null default 'pending'
created_at     timestamptz not null default now()
published_at   timestamptz
```

Chỉ insert event:

```text
RegistrationConfirmed
```

Có thể thêm unique key để tránh duplicate notification:

```sql
CREATE UNIQUE INDEX uq_outbox_registration_confirmed
ON outbox_events(event_type, aggregate_id)
WHERE event_type = 'RegistrationConfirmed';
```

---

## 5. API contract

### 5.1. `GET /workshops/:id`

Response gợi ý:

```json
{
  "id": "workshop_id",
  "capacity": 60,
  "reserved_count": 42,
  "confirmed_count": 35,
  "available_seats": 18,
  "price": 150000,
  "currency": "VND",
  "status": "open"
}
```

Lưu ý:

- `available_seats = capacity - reserved_count`.
- UI có thể hiển thị `confirmed_count` là số đã đăng ký thành công.
- UI nên dùng `available_seats` để quyết định còn cho bấm nút đăng ký hay không.
- Backend vẫn phải kiểm tra lại bằng DB transaction, không tin tuyệt đối vào số UI đang thấy.

### 5.2. `POST /registrations`

Headers:

```http
Authorization: Bearer <jwt>
Idempotency-Key: <client-generated-uuid>
```

Body:

```json
{
  "workshop_id": "workshop_id"
}
```

Yêu cầu:

- Client phải generate `Idempotency-Key` trước khi gửi request.
- Client phải reuse cùng key khi retry cùng request.
- Backend lưu `request_hash` từ body + user_id + endpoint để phát hiện reuse key sai request.
- Nếu cần cache idempotency response trong Redis, TTL khuyến nghị là **24 giờ**; DB vẫn là source of truth.

Response khi tạo payment URL thành công:

```json
{
  "registration_id": "reg_id",
  "payment_id": "pay_id",
  "payment_status": "redirect_ready",
  "payment_url": "https://vnpay.vn/...",
  "expires_at": "2026-05-06T10:15:00Z"
}
```

HTTP status: `201 Created`.

Response khi replay cùng idempotency key và payment URL đã sẵn sàng:

```json
{
  "registration_id": "reg_id",
  "payment_id": "pay_id",
  "payment_status": "redirect_ready",
  "payment_url": "https://vnpay.vn/...",
  "idempotent_replay": true
}
```

HTTP status: `200 OK`.

Response khi request cũ đang xử lý:

```json
{
  "registration_id": "reg_id",
  "payment_id": "pay_id",
  "payment_status": "initiating",
  "message": "Payment đang được khởi tạo, vui lòng kiểm tra lại sau."
}
```

HTTP status: `202 Accepted`.

Response khi đã thanh toán:

```json
{
  "registration_id": "reg_id",
  "payment_id": "pay_id",
  "payment_status": "completed",
  "message": "already paid"
}
```

Response khi hết chỗ:

```json
{
  "error": "Workshop đã hết chỗ"
}
```

HTTP status: `409 Conflict`.

Response khi circuit breaker open:

```json
{
  "error": "Dịch vụ thanh toán tạm thời gián đoạn. Vui lòng thử lại sau.",
  "retry_after": 60
}
```

HTTP status: `503 Service Unavailable`.

### 5.3. `GET /registrations/:id/payment-status`

Dùng để frontend poll khi:

- `POST /registrations` trả `202`.
- Client timeout.
- User quay về từ VNPay.
- Payment callback có thể bị trễ.

Response pending/unknown:

```json
{
  "registration_id": "reg_id",
  "registration_status": "pending_payment",
  "payment_id": "pay_id",
  "payment_status": "unknown",
  "next_action": "wait"
}
```

Response có payment URL:

```json
{
  "registration_id": "reg_id",
  "registration_status": "pending_payment",
  "payment_id": "pay_id",
  "payment_status": "redirect_ready",
  "payment_url": "https://vnpay.vn/..."
}
```

Response confirmed:

```json
{
  "registration_id": "reg_id",
  "registration_status": "confirmed",
  "payment_status": "completed",
  "qr_available": true
}
```

### 5.4. `POST /payments/callback`

Endpoint nhận VNPay callback.

Yêu cầu xử lý:

1. Verify signature.
2. Verify merchant/order identifiers.
3. Verify amount/currency khớp payment record.
4. Lock payment row bằng `SELECT ... FOR UPDATE`.
5. Update payment/registration/workshop trong cùng DB transaction.
6. Generate QR token khi success.
7. Commit DB.
8. Sau commit, publish `RegistrationConfirmed` event vào notification queue hoặc insert outbox event trong transaction rồi worker publish sau.

Callback hợp lệ nhưng duplicate phải trả `200 OK` để VNPay không retry vô hạn.

---

## 6. Luồng chính Happy Path

```text
[BROWSER]                  [BACKEND API]              [Redis optional]    [PostgreSQL]    [VNPay]
    │                            │                            │                 │             │
    │ 1. GET /workshops/:id      │                            │                 │             │
    │───────────────────────────►│                            │                 │             │
    │                            │ 1.1 Read cache optional    │                 │             │
    │                            │───────────────────────────►│                 │             │
    │                            │ 1.2 Nếu cache miss, read DB                  │             │
    │                            │─────────────────────────────────────────────►│             │
    │◄── workshop detail ────────│                            │                 │             │
    │    capacity, reserved,     │                            │                 │             │
    │    confirmed, available,   │                            │                 │             │
    │    price, status           │                            │                 │             │
    │                            │                            │                 │             │
    │ 2. Click "Đăng ký"         │                            │                 │             │
    │    Client generate         │                            │                 │             │
    │    Idempotency-Key         │                            │                 │             │
    │                            │                            │                 │             │
    │ 3. POST /registrations     │                            │                 │             │
    │    {workshop_id}           │                            │                 │             │
    │    Authorization Bearer    │                            │                 │             │
    │    Idempotency-Key         │                            │                 │             │
    │───────────────────────────►│                            │                 │             │
    │                            │ 4. Validate JWT            │                 │             │
    │                            │    Check role=student      │                 │             │
    │                            │    Check rate limit        │                 │             │
    │                            │───────────────────────────►│                 │             │
    │                            │                            │                 │             │
    │                            │ 5. Check idempotency       │                 │             │
    │                            │    Redis cache optional    │                 │             │
    │                            │    DB is source of truth   │                 │             │
    │                            │─────────────────────────────────────────────►│             │
    │                            │                            │                 │             │
    │                            │ 6. Check circuit breaker   │                 │             │
    │                            │    Nếu OPEN: return 503    │                 │             │
    │                            │    Không reserve seat      │                 │             │
    │                            │                            │                 │             │
    │                            │ 7. BEGIN TRANSACTION       │                 │             │
    │                            │    Atomic reserve seat:    │                 │             │
    │                            │    UPDATE workshops        │                 │             │
    │                            │    SET reserved_count += 1 │                 │             │
    │                            │    WHERE reserved_count    │                 │             │
    │                            │          < capacity        │                 │             │
    │                            │    RETURNING id            │                 │             │
    │                            │                            │                 │             │
    │                            │    INSERT registration     │                 │             │
    │                            │    status=pending_payment  │                 │             │
    │                            │                            │                 │             │
    │                            │    INSERT payment          │                 │             │
    │                            │    status=initiating       │                 │             │
    │                            │    merchant_order_id       │                 │             │
    │                            │    idempotency_key         │                 │             │
    │                            │    COMMIT                  │                 │             │
    │                            │─────────────────────────────────────────────►│             │
    │                            │◄─────────────────────────────────────────────│             │
    │                            │                            │                 │             │
    │                            │ 8. Cache processing state  │                 │             │
    │                            │    optional, TTL 24h       │                 │             │
    │                            │───────────────────────────►│                 │             │
    │                            │                            │                 │             │
    │                            │ 9. Call VNPay              │                 │             │
    │                            │    Timeout <= 10s          │                 │             │
    │                            │──────────────────────────────────────────────────────────►│
    │                            │◄── payment_url, txn_id optional ─────────────────────────│
    │                            │                            │                 │             │
    │                            │ 10. UPDATE payment         │                 │             │
    │                            │     status=redirect_ready  │                 │             │
    │                            │     payment_url=...        │                 │             │
    │                            │─────────────────────────────────────────────►│             │
    │                            │                            │                 │             │
    │                            │ 11. Cache ready response   │                 │             │
    │                            │     optional, TTL 24h      │                 │             │
    │                            │───────────────────────────►│                 │             │
    │◄── 201 {payment_url}       │                            │                 │             │
    │                            │                            │                 │             │
    │ 12. Redirect user to VNPay │                            │                 │             │
    │──────────────────────────────────────────────────────────────────────────────────────►│
    │                            │                            │                 │             │
    │ 13. VNPay callback         │                            │                 │             │
    │◄──────────────────────────────────────────────────────────────────────────────────────│
    │                            │ 14. Verify signature       │                 │             │
    │                            │     BEGIN                  │                 │             │
    │                            │     Lock payment           │                 │             │
    │                            │     Lock registration      │                 │             │
    │                            │     payment=completed      │                 │             │
    │                            │     registration=confirmed │                 │             │
    │                            │     confirmed_count += 1   │                 │             │
    │                            │     Generate QR token      │                 │             │
    │                            │     COMMIT                 │                 │             │
    │                            │─────────────────────────────────────────────►│             │
    │                            │                            │                 │             │
    │                            │ 15. Cache completed state  │                 │             │
    │                            │     optional               │                 │             │
    │                            │───────────────────────────►│                 │             │
    │                            │                            │                 │             │
    │                            │ 16. Publish                │                 │             │
    │                            │     RegistrationConfirmed  │                 │             │
    │◄── 200 OK                  │                            │                 │             │
```

---

## 7. Chi tiết xử lý `POST /registrations`

### Bước 1: Validate request

- Validate JWT.
- Check role `student`.
- Check workshop tồn tại, đang mở đăng ký, có phí, chưa kết thúc.
- Check rate limit.
- Check `Idempotency-Key` tồn tại trong header.

Nếu thiếu `Idempotency-Key`:

```json
{
  "error": "Missing Idempotency-Key header"
}
```

HTTP status: `400 Bad Request`.

### Bước 2: Idempotency lookup

Tính `request_hash` từ:

```text
method + path + user_id + normalized body
```

Tìm payment theo `idempotency_key` trong DB. Có thể đọc Redis trước để tối ưu, nhưng DB là source of truth.

Nếu tìm thấy và `request_hash` khác:

```json
{
  "error": "Idempotency-Key was reused with a different request"
}
```

HTTP status: `409 Conflict`.

Nếu tìm thấy và cùng request:

| Payment status | Response |
|---|---|
| `initiating` | `202`, trả trạng thái đang xử lý |
| `redirect_ready` | `200`, trả lại `payment_url`, không gọi VNPay lần nữa |
| `unknown` | `202`, trả trạng thái unknown, hướng dẫn poll |
| `completed` | `200`, trả `already paid`, không trả payment URL cũ |
| `failed` / `expired` | `409` hoặc yêu cầu tạo request mới với idempotency key mới |
| `requires_review` | `409`, thông báo đang cần xử lý thủ công |

### Bước 3: Check active registration

Tìm active registration của user cho workshop:

```sql
SELECT *
FROM registrations
WHERE user_id = :user_id
  AND workshop_id = :workshop_id
  AND status IN ('pending_payment', 'confirmed');
```

Nếu `pending_payment`:

- Trả trạng thái payment hiện tại.
- Không tạo registration mới.
- Không gọi VNPay lần nữa nếu payment đã có `payment_url` hoặc đang `initiating` gần đây.

Nếu `confirmed`:

```json
{
  "error": "Bạn đã đăng ký workshop này rồi",
  "registration_status": "confirmed"
}
```

HTTP status: `409 Conflict`.

### Bước 4: Check circuit breaker trước khi reserve seat

Nếu circuit breaker đang `OPEN`:

- Không tạo registration.
- Không tạo payment.
- Không tăng `reserved_count`.
- Trả `503` nhanh, ví dụ dưới 100ms.

### Bước 5: Atomic reserve seat trong PostgreSQL

Khuyến nghị dùng atomic update thay cho check rồi update rời rạc:

```sql
UPDATE workshops
SET reserved_count = reserved_count + 1
WHERE id = :workshop_id
  AND status = 'open'
  AND reserved_count < capacity
RETURNING id, capacity, reserved_count, confirmed_count, price;
```

Nếu không có row trả về:

```json
{
  "error": "Workshop đã hết chỗ"
}
```

HTTP status: `409 Conflict`.

Sau đó insert registration và payment trong cùng transaction:

```sql
INSERT INTO registrations (
  id,
  user_id,
  workshop_id,
  status,
  reservation_expires_at
)
VALUES (
  :registration_id,
  :user_id,
  :workshop_id,
  'pending_payment',
  now() + interval '15 minutes'
);

INSERT INTO payments (
  id,
  registration_id,
  user_id,
  workshop_id,
  idempotency_key,
  request_hash,
  merchant_order_id,
  amount,
  currency,
  status,
  gateway_call_started_at
)
VALUES (
  :payment_id,
  :registration_id,
  :user_id,
  :workshop_id,
  :idempotency_key,
  :request_hash,
  :merchant_order_id,
  :amount_snapshot,
  'VND',
  'initiating',
  now()
);
```

### Bước 6: Gọi VNPay

Gọi VNPay sau khi DB transaction đã commit.

Timeout tối đa:

```text
10 giây
```

Nếu VNPay trả payment URL thành công:

```sql
UPDATE payments
SET status = 'redirect_ready',
    payment_url = :payment_url,
    gateway_txn_id = :gateway_txn_id,
    raw_gateway_response = :raw_response,
    updated_at = now()
WHERE id = :payment_id
  AND status = 'initiating';
```

Nếu update không thành công vì payment đã chuyển state do callback/reconciliation, đọc lại payment và trả trạng thái hiện tại.

Nếu VNPay trả lỗi chắc chắn, release seat trong DB transaction:

```sql
BEGIN;

SELECT *
FROM registrations
WHERE id = :registration_id
FOR UPDATE;

UPDATE registrations
SET status = 'cancelled',
    cancelled_at = now(),
    updated_at = now()
WHERE id = :registration_id
  AND status = 'pending_payment'
RETURNING id;

-- Chỉ chạy nếu câu UPDATE trên có row.
UPDATE workshops
SET reserved_count = reserved_count - 1
WHERE id = :workshop_id;

UPDATE payments
SET status = 'failed',
    failed_at = now(),
    last_error_code = :error_code,
    last_error_message = :error_message,
    updated_at = now()
WHERE id = :payment_id
  AND status IN ('initiating', 'unknown', 'redirect_ready');

COMMIT;
```

Nếu VNPay timeout hoặc network error:

```sql
UPDATE payments
SET status = 'unknown',
    last_error_code = 'GATEWAY_TIMEOUT',
    last_error_message = 'VNPay call timed out',
    updated_at = now()
WHERE id = :payment_id
  AND status = 'initiating';
```

Không cancel registration ngay. Seat vẫn được giữ tạm thời cho tới khi reconciliation hoặc expiry quyết định.

Response khuyến nghị:

```json
{
  "registration_id": "reg_id",
  "payment_id": "pay_id",
  "payment_status": "unknown",
  "message": "Payment đang xử lý, vui lòng kiểm tra lại sau."
}
```

HTTP status khuyến nghị: `202 Accepted`.

Nếu cần giữ tương thích với thiết kế cũ, có thể dùng `503 Service Unavailable` kèm `retryable: true`, nhưng frontend phải hiểu đây là trạng thái đã tạo payment pending, không phải request thất bại hoàn toàn.

---

## 8. Xử lý VNPay callback synchronous

### 8.1. Nguyên tắc

- Verify signature trước khi đụng DB state.
- Verify `merchant_order_id`, amount, currency.
- Callback hợp lệ nhưng duplicate phải trả `200 OK`.
- Mọi thay đổi payment/registration/workshop counter nằm trong một DB transaction.
- Không enqueue callback vào queue để xử lý payment sau.
- Chỉ publish notification sau khi registration được confirm thành công.

### 8.2. Callback success

Pseudo-flow:

```text
1. Verify signature.
2. Find payment by merchant_order_id.
3. BEGIN.
4. SELECT payment FOR UPDATE.
5. SELECT registration FOR UPDATE.
6. Nếu payment.status = completed:
     COMMIT, return 200.
7. Nếu registration.status = pending_payment:
     payment.status = completed
     registration.status = confirmed
     workshops.confirmed_count += 1
     generate QR token/hash
     insert outbox RegistrationConfirmed hoặc mark event cần publish
     COMMIT
     publish notification sau commit
     return 200
8. Nếu registration.status != pending_payment:
     payment.status = requires_review
     lưu raw callback
     COMMIT
     return 200
```

SQL guard quan trọng:

```sql
UPDATE registrations
SET status = 'confirmed',
    confirmed_at = now(),
    qr_token_hash = :qr_token_hash,
    qr_issued_at = now(),
    updated_at = now()
WHERE id = :registration_id
  AND status = 'pending_payment'
RETURNING id;
```

Chỉ nếu update trên có row thì mới:

```sql
UPDATE workshops
SET confirmed_count = confirmed_count + 1
WHERE id = :workshop_id;
```

Không tăng `reserved_count` khi payment success vì seat đã được giữ ở bước tạo registration.

### 8.3. Callback failed

Pseudo-flow:

```text
1. Verify signature.
2. Find payment by merchant_order_id.
3. BEGIN.
4. SELECT payment FOR UPDATE.
5. SELECT registration FOR UPDATE.
6. Nếu payment.status đã failed/expired/completed:
     COMMIT, return 200.
7. Nếu registration.status = pending_payment:
     registration.status = cancelled
     payment.status = failed
     workshops.reserved_count -= 1
     COMMIT
     return 200.
8. Nếu registration.status không còn pending:
     payment.status = failed hoặc requires_review tùy policy
     COMMIT
     return 200.
```

SQL guard quan trọng:

```sql
UPDATE registrations
SET status = 'cancelled',
    cancelled_at = now(),
    updated_at = now()
WHERE id = :registration_id
  AND status = 'pending_payment'
RETURNING id;
```

Chỉ nếu update trên có row thì mới:

```sql
UPDATE workshops
SET reserved_count = reserved_count - 1
WHERE id = :workshop_id;
```

Không gửi duplicate notification. Trong MVP, payment failed có thể hiển thị qua status endpoint thay vì queue.

---

## 9. Kịch bản lỗi

### E1: Hết chỗ

Tình huống: 100 người cùng đăng ký workshop 60 chỗ.

Xử lý:

1. Backend không dùng Redis seat counter.
2. PostgreSQL chạy atomic update:

```sql
UPDATE workshops
SET reserved_count = reserved_count + 1
WHERE id = :workshop_id
  AND reserved_count < capacity
RETURNING id;
```

3. Chỉ 60 transaction đầu nhận được row.
4. 40 transaction còn lại không có row, trả `409 Workshop đã hết chỗ`.
5. Không tạo registration/payment cho 40 request thất bại.

Kết quả:

```text
reserved_count <= capacity
pending_payment + confirmed <= capacity
```

### E2: Client timeout sau khi server tạo payment

Tình huống:

- Client gửi `POST /registrations` với `Idempotency-Key`.
- Server tạo registration/payment và có thể đã tạo payment URL.
- Client mất mạng trước khi nhận response.
- Client retry với cùng `Idempotency-Key`.

Xử lý:

1. Server tìm payment theo `idempotency_key` trong DB; Redis cache chỉ là optional.
2. Nếu `redirect_ready`: trả lại payment URL cũ, không gọi VNPay lần nữa.
3. Nếu `initiating`: trả `202`, không gọi VNPay lần nữa nếu request trước đang xử lý gần đây.
4. Nếu `unknown`: trả `202`, hướng dẫn poll status.
5. Nếu `completed`: trả `already paid`, không trả payment URL cũ.
6. Nếu cùng key nhưng khác body/user/workshop: trả `409`.

Điểm quan trọng:

- Idempotency key do client tạo trước khi gửi request.
- Nếu response bị mất, client vẫn biết key để retry.

### E3: VNPay timeout khi đang gọi

Tình huống:

```text
Promise.race([vnpayCall, timeout(10_000)])
```

Timeout thắng.

Xử lý:

1. Circuit breaker ghi nhận failure.
2. `payment.status = unknown`.
3. `registration.status` vẫn là `pending_payment`.
4. Không trả seat ngay vì có thể VNPay đã nhận request.
5. Trả `202` hoặc `503 retryable` tùy contract frontend.
6. Reconciliation job query VNPay bằng `merchant_order_id`.

Reconciliation result:

| VNPay query result | Hành động |
|---|---|
| `SUCCESS` | confirm registration, `confirmed_count += 1` |
| `FAILED` | cancel registration, `reserved_count -= 1` |
| `NOT_FOUND` sau grace period | expire registration, `reserved_count -= 1` |
| network error/UNKNOWN | retry sau |

### E4: VNPay callback failed

Tình huống: VNPay gọi callback với status failed.

Xử lý:

1. Verify callback signature.
2. Lock payment/registration.
3. Nếu registration còn `pending_payment`:
   - `payment.status = failed`
   - `registration.status = cancelled`
   - `reserved_count -= 1`
4. Nếu callback duplicate:
   - không decrement lần 2
   - trả `200 OK`
5. Không tăng/giảm `confirmed_count`.

### E5: Circuit breaker OPEN

Tình huống: VNPay fail nhiều lần, circuit breaker chuyển `OPEN`.

Xử lý:

1. Server không gọi VNPay.
2. Server check circuit breaker **trước khi reserve seat**.
3. Không tạo registration.
4. Không tạo payment.
5. Không tăng `reserved_count`.
6. Trả `503` nhanh.

Response:

```json
{
  "error": "Dịch vụ thanh toán tạm thời gián đoạn. Vui lòng thử lại sau.",
  "retry_after": 60
}
```

Các endpoint khác như `GET /workshops/:id`, đăng ký workshop miễn phí vẫn hoạt động bình thường.

### E6: Duplicate registration

Tình huống: sinh viên bấm đăng ký lại cùng workshop.

Xử lý:

- Nếu đã có registration `pending_payment`: trả lại trạng thái payment hiện tại, không tạo payment mới.
- Nếu đã có registration `confirmed`: trả `409 Bạn đã đăng ký workshop này rồi`.
- Nếu registration cũ là `cancelled` hoặc `expired`: cho phép tạo registration/payment mới với idempotency key mới.

Constraint dùng partial unique index:

```sql
CREATE UNIQUE INDEX uq_active_registration_user_workshop
ON registrations(user_id, workshop_id)
WHERE status IN ('pending_payment', 'confirmed');
```

### E7: Duplicate VNPay callback

Tình huống: VNPay gửi cùng callback success hoặc failed nhiều lần.

Xử lý:

- Lock payment row.
- Nếu state đã ở trạng thái cuối, return `200 OK`.
- Không tăng `confirmed_count` lần 2.
- Không giảm `reserved_count` lần 2.
- Không publish duplicate `RegistrationConfirmed`.

### E8: Callback success đến sau khi registration đã expired

Tình huống:

- User thanh toán rất muộn.
- Reservation đã hết hạn, seat đã được release.
- Sau đó VNPay callback success.

Xử lý:

1. Verify signature.
2. Lock payment/registration.
3. Nếu registration không còn `pending_payment`, không confirm tự động.
4. Set `payment.status = requires_review`.
5. Lưu raw callback.
6. Trả `200 OK` cho VNPay.
7. Tạo alert/manual task để admin hoàn tiền hoặc xử lý thủ công.

Lý do:

- Nếu seat đã release, workshop có thể đã bán hết cho người khác.
- Tự confirm sẽ có nguy cơ oversell.

### E9: Server crash sau khi reserve seat nhưng trước/sau khi gọi VNPay

Tình huống:

- DB transaction đã commit, `payment.status = initiating`.
- Server crash trước khi trả response hoặc trước khi update `payment_url`.

Xử lý:

1. Client retry với cùng `Idempotency-Key`.
2. Nếu `payment.status = initiating` và `gateway_call_started_at` còn mới, trả `202`.
3. Nếu `initiating` bị stale:
   - Reconciliation query VNPay bằng `merchant_order_id`.
   - Nếu VNPay `SUCCESS`: confirm.
   - Nếu VNPay `FAILED`: cancel + release.
   - Nếu VNPay `NOT_FOUND`: có thể retry tạo payment với cùng `merchant_order_id`, hoặc expire sau grace period.
4. Reservation expiry job đảm bảo seat không bị giữ vĩnh viễn.

---

## 10. Reconciliation jobs

### 10.1. Payment reconciliation job

Chạy mỗi 1-5 phút.

Query:

```sql
SELECT *
FROM payments
WHERE status IN ('unknown', 'initiating', 'redirect_ready')
  AND updated_at < now() - interval '2 minutes'
ORDER BY updated_at ASC
LIMIT 100
FOR UPDATE SKIP LOCKED;
```

Hành động:

- Gọi VNPay Query API bằng `merchant_order_id`.
- Nếu success: confirm registration.
- Nếu failed: cancel registration + release seat.
- Nếu not found và payment quá cũ: expire.
- Nếu network error: giữ nguyên, retry lần sau.

### 10.2. Reservation expiry job

Chạy mỗi 1 phút.

Query:

```sql
SELECT *
FROM registrations
WHERE status = 'pending_payment'
  AND reservation_expires_at < now()
ORDER BY reservation_expires_at ASC
LIMIT 100
FOR UPDATE SKIP LOCKED;
```

Hành động:

```text
registration.status = expired
payment.status = expired nếu chưa completed
reserved_count -= 1
```

Chỉ release seat nếu registration đang chuyển từ `pending_payment` sang `expired`.

### 10.3. Counter reconciliation job

Chạy định kỳ, ví dụ mỗi đêm hoặc mỗi vài giờ.

Query kiểm tra:

```sql
SELECT
  w.id,
  w.reserved_count,
  COUNT(r.id) FILTER (
    WHERE r.status IN ('pending_payment', 'confirmed')
  ) AS actual_reserved_count,
  w.confirmed_count,
  COUNT(r.id) FILTER (
    WHERE r.status = 'confirmed'
  ) AS actual_confirmed_count
FROM workshops w
LEFT JOIN registrations r ON r.workshop_id = w.id
GROUP BY w.id;
```

Nếu lệch:

- Ghi alert.
- Có thể auto-fix trong maintenance window nếu team đồng ý.

---

## 11. QR code

Khi payment success và registration được confirm:

1. Generate signed JWT.
2. Payload tối thiểu:

```json
{
  "type": "workshop_checkin",
  "registration_id": "reg_id",
  "workshop_id": "workshop_id",
  "user_id": "user_id",
  "iat": 1778061600,
  "exp": 1778151600
}
```

3. `exp = workshop.ends_at + 1 giờ`.
4. Lưu `qr_token_hash`, không bắt buộc lưu raw token.
5. Khi scan QR:
   - Verify JWT signature.
   - Verify `exp`.
   - Check DB registration vẫn `confirmed`.
   - Check registration/workshop/user khớp.

---

## 12. Notification

Chỉ publish event:

```text
RegistrationConfirmed
```

Payload gợi ý:

```json
{
  "registration_id": "reg_id",
  "workshop_id": "workshop_id",
  "user_id": "user_id",
  "confirmed_at": "2026-05-06T10:00:00Z"
}
```

Để tránh duplicate notification:

- Nếu có outbox: dùng unique key theo `registration_id + event_type`.
- Nếu publish trực tiếp sau commit: trước khi publish cần đảm bảo callback success không phải duplicate.

Trong MVP 4 ngày:

- Payment failed/cancelled có thể hiển thị qua status endpoint.
- Notification failed payment không bắt buộc đi qua queue vì yêu cầu chính là payment correctness.

---

## 13. Ràng buộc hệ thống

- **Source of truth:** PostgreSQL cho seat, registration và payment final state.
- **Counter invariant:** `0 <= confirmed_count <= reserved_count <= capacity`.
- **Timeout VNPay:** tối đa 10 giây.
- **Circuit breaker:** khi `OPEN`, không gọi VNPay và không reserve seat.
- **Idempotency:** client-generated `Idempotency-Key`; DB unique; Redis cache optional TTL 24 giờ.
- **Payment identifiers:** bắt buộc có `merchant_order_id`; `gateway_txn_id` nullable nhưng unique khi có giá trị.
- **QR token expiry:** signed JWT với `exp = workshop.ends_at + 1 giờ`.
- **Callback:** xử lý synchronous trong backend, transaction-safe và idempotent.
- **Notification:** chỉ publish `RegistrationConfirmed` sau khi DB đã confirmed.

---

## 14. Tiêu chí chấp nhận

### 14.1. Seat correctness

- [ ] 100 requests đồng thời cho workshop 60 chỗ: tối đa 60 registration active (`pending_payment + confirmed`).
- [ ] `reserved_count` không bao giờ vượt `capacity`.
- [ ] `confirmed_count` không bao giờ vượt `reserved_count`.
- [ ] Request hết chỗ trả `409` và không tạo payment.

### 14.2. Idempotency

- [ ] Retry cùng `Idempotency-Key` chỉ tạo 1 payment record.
- [ ] Retry cùng `Idempotency-Key` trả lại payment URL cũ nếu đã có.
- [ ] Retry cùng key nhưng body khác trả `409`.
- [ ] Client timeout sau khi server tạo payment không tạo payment thứ 2.

### 14.3. Gateway failure

- [ ] VNPay timeout chuyển payment sang `unknown`.
- [ ] Khi `unknown`, seat chưa bị release ngay.
- [ ] Reconciliation success confirm registration.
- [ ] Reconciliation failed cancel registration và release seat.
- [ ] Pending quá hạn được expire và release seat.
- [ ] Callback success sau khi expired không confirm tự động, payment vào `requires_review`.

### 14.4. Callback correctness

- [ ] Duplicate success callback không tăng `confirmed_count` lần 2.
- [ ] Duplicate failed callback không giảm `reserved_count` lần 2.
- [ ] Callback invalid signature bị reject.
- [ ] Callback amount mismatch bị reject hoặc đưa vào review.
- [ ] QR code có sau callback success dưới 5 giây.

### 14.5. Circuit breaker

- [ ] Khi circuit breaker `OPEN`, `POST /registrations` trả `503` nhanh.
- [ ] Khi circuit breaker `OPEN`, không tạo registration/payment mới.
- [ ] Khi circuit breaker `OPEN`, không reserve seat.
- [ ] `GET /workshops/:id` vẫn trả `200`.

### 14.6. Notification

- [ ] Chỉ publish `RegistrationConfirmed` event sau khi registration confirmed.
- [ ] Duplicate callback không publish duplicate `RegistrationConfirmed`.

---

## 15. Kế hoạch thực hiện MVP trong 4 ngày

### Ngày 1: DB correctness và seat reservation

- Thêm `reserved_count`, `confirmed_count`.
- Thêm registration/payment statuses.
- Thêm constraints/indexes.
- Implement atomic reserve seat.
- Implement active duplicate registration handling.
- Test concurrency 100 requests/60 seats.

### Ngày 2: Payment creation và idempotency

- Frontend gửi `Idempotency-Key`.
- Backend check `idempotency_key + request_hash`.
- Sinh `merchant_order_id`.
- Gọi VNPay timeout 10 giây.
- Update payment `redirect_ready` hoặc `unknown`.
- Implement `GET /registrations/:id/payment-status`.
- Redis cache payment status/idempotency response nếu cần, TTL 24 giờ.

### Ngày 3: VNPay callback synchronous

- Verify signature/amount/order.
- Lock payment/registration.
- Implement success callback idempotent.
- Implement failed callback idempotent.
- Generate QR token.
- Publish hoặc insert `RegistrationConfirmed` event.

### Ngày 4: Reconciliation, expiry, hardening

- Implement reservation expiry job.
- Implement payment reconciliation job tối thiểu.
- Implement circuit breaker check trước reserve.
- Test duplicate callback, timeout, stale initiating payment.
- Run acceptance tests.

---

## 16. Những phần có thể để phase 2

Không bắt buộc cho MVP 4 ngày:

- Redis seat counter.
- Distributed circuit breaker.
- Outbox pattern hoàn chỉnh nếu notification không phải critical path.
- Bảng `payment_attempts` riêng.
- Admin UI cho `requires_review`.
- Auto-refund flow cho late success.

Nếu sau này cần retry payment nhiều lần trên cùng một registration, nên tách thêm bảng `payment_attempts`. Trong MVP, mỗi registration có một payment; nếu failed/expired, user tạo registration mới vì partial unique index chỉ chặn active registration.

---

## 17. Tóm tắt quyết định kiến trúc

```text
PostgreSQL là source of truth cho seat và payment final state.
Redis vẫn được dùng cho cache/rate-limit/circuit-breaker/idempotency response, nhưng không giữ chỗ.
Client-generated Idempotency-Key là bắt buộc.
Giữ chỗ bằng reserved_count trong DB.
Confirm bằng confirmed_count trong DB.
Callback VNPay xử lý synchronous và idempotent.
Unknown payment được xử lý bằng reconciliation + reservation expiry.
Chỉ RegistrationConfirmed event được publish vào notification queue.
```
