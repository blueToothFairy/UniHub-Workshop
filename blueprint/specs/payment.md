# Đặc tả: Đăng ký Workshop có phí

## Mô tả

Sinh viên chọn workshop có phí, thực hiện thanh toán qua VNPay và nhận mã QR xác nhận. Luồng này phải đảm bảo: không oversell chỗ, không double-charge, hoạt động đúng ngay cả khi gateway có vấn đề.

**Quan trọng:** 
- VNPay callback (webhook) được xử lý **SYNCHRONOUS** trong backend (không queue) để đảm bảo payment record được cập nhật ngay.
- **CHỈ** RegistrationConfirmed event được publish vào notification queue (để gửi email, in-app notification).
- Điều này tránh trường hợp: payment callback fail → payment không được ghi nhận.

---

## Luồng chính (Happy Path)

```
[BROWSER]                  [BACKEND API]              [Redis]    [PostgreSQL]    [VNPay]
    │                            │                        │             │             │
    │ 1. GET /workshops/:id      │                        │             │             │
    │───────────────────────────►│                        │             │             │
    │◄── workshop detail ────────│                        │             │             │
    │    (capacity, registered,  │                        │             │             │
    │     price, status)         │                        │             │             │
    │                            │                        │             │             │
    │ 2. Click "Đăng ký"         │                        │             │             │
    │    Frontend generates:     │                        │             │             │
    │    idempotency_key = UUIDv4│                        │             │             │
    │                            │                        │             │             │
    │ 3. POST /registrations     │                        │             │             │
    │    {workshop_id,           │                        │             │             │
    │     idempotency_key}       │                        │             │             │
    │    Authorization: Bearer   │                        │             │             │
    │───────────────────────────►│                        │             │             │
    │                            │ 4. Validate JWT        │             │             │
    │                            │    Check role=student  │             │             │
    │                            │    Check Rate Limit    │             │             │
    │                            │                        │             │             │
    │                            │ 5. DECRBY seat_count  │             │             │
    │                            │    workshop:{id}:seats │             │             │
    │                            │──────────────────────►│             │             │
    │                            │◄── result: 45 (>0 OK) │             │             │
    │                            │                        │             │             │
    │                            │ 6. BEGIN TRANSACTION   │             │             │
    │                            │    SELECT * FROM workshops           │             │
    │                            │    WHERE id = :id FOR UPDATE        │             │
    │                            │    (row-level lock)   │             │             │
    │                            │──────────────────────────────────►  │             │
    │                            │    Check: registered_count < capacity             │
    │                            │    INSERT INTO registrations (pending)            │
    │                            │    UPDATE workshops SET registered_count += 1    │
    │                            │    INSERT INTO payments (idempotency_key)         │
    │                            │    COMMIT                           │             │
    │                            │◄───────────────────────────────────│             │
    │                            │                        │             │             │
    │                            │ 7. Set Redis:          │             │             │
    │                            │    ik:payment:{key}    │             │             │
    │                            │    = "processing"      │             │             │
    │                            │──────────────────────►│             │             │
    │                            │                        │             │             │
    │                            │ 8. Call VNPay (Circuit Breaker)                  │
    │                            │──────────────────────────────────────────────────►│
    │                            │◄─── {payment_url, txn_id} ─────────────────────│
    │                            │                        │             │             │
    │                            │ 9. Cache result in Redis             │             │
    │                            │    ik:payment:{key} = {payment_url}│             │
    │                            │──────────────────────►│             │             │
    │                            │                        │             │             │
    │◄── 201 {payment_url} ──────│                        │             │             │
    │                            │                        │             │             │
    │ 10. Redirect → VNPay UI   │                        │             │             │
    │     User nhập thẻ/QR...   │                        │             │             │
    │                            │                        │             │             │
    │                         [VNPay callback POST /payments/callback]               │
    │                            │◄─── {txn_id, status: "success"} ──────────────│
    │                            │                        │             │             │
    │                            │ 11. Verify callback signature                     │
    │                            │     UPDATE payments SET status='completed'        │
    │                            │     UPDATE registrations SET status='confirmed'   │
    │                            │     Generate QR token (signed JWT)               │
    │                            │     UPDATE registrations SET qr_code=...          │
    │                            │──────────────────────────────────►  │             │
    │                            │                        │             │             │
    │                            │ 12. Enqueue notifications            │             │
    │                            │     → email queue                   │             │
    │                            │     → app notification              │             │
    │                            │                        │             │             │
    │◄── Redirect /my-registrations                       │             │             │
    │    (QR code displayed)     │                        │             │             │
```

---

## Kịch bản lỗi

### E1: Hết chỗ (Seat Exhausted)

**Tình huống:** 60 người cùng đăng ký workshop 60 chỗ vào đúng 1 lúc.

**Xử lý:**
1. Redis `DECRBY seat_count 1` với `seat_count = 0` sẽ trả về giá trị âm.
2. Nếu kết quả < 0: ngay lập tức `INCRBY seat_count 1` (rollback Redis counter).
3. Trả về HTTP 409 `{"error": "Workshop đã hết chỗ"}` mà KHÔNG tạo DB record.
4. Không gọi PostgreSQL transaction → tiết kiệm tài nguyên DB.

**Trường hợp race condition (Redis OK nhưng DB full):**
- PostgreSQL transaction kiểm tra lại `registered_count < capacity`.
- Nếu fail ở đây (edge case): rollback transaction, `INCRBY seat_count 1`, trả 409.

### E2: Client timeout sau khi server tạo payment

**Tình huống:** Client gọi `POST /registrations`, server xử lý xong và trả 201, nhưng client bị mất mạng trước khi nhận response. Client retry với cùng `idempotency_key`.

**Xử lý:**
1. Server check Redis: `ik:payment:{key}` = `{payment_url}` (đã cache).
2. Trả về 200 với `payment_url` cũ — giống y hệt response lần đầu.
3. VNPay KHÔNG bị gọi lại, không tạo payment record mới.

### E3: VNPay timeout khi đang gọi

**Tình huống:** `Promise.race([vnpayCall, timeout(10_000)])` — timeout thắng.

**Xử lý:**
1. Circuit Breaker ghi nhận failure.
2. Delete Redis key `ik:payment:{key}` (xóa "processing" lock).
3. Rollback: UPDATE registrations SET status='cancelled', UPDATE workshops SET registered_count -= 1.
4. Redis: `INCRBY seat_count 1` (hoàn lại chỗ).
5. Trả về 503 với thông báo rõ ràng: "Thanh toán thất bại, chỗ đã được hoàn lại. Vui lòng thử lại."

### E4: VNPay callback thất bại (payment failed)

**Tình huống:** VNPay gọi callback với `status: "failed"`.

**Xử lý:**
1. UPDATE payments SET status='failed'.
2. UPDATE registrations SET status='cancelled'.
3. UPDATE workshops SET registered_count -= 1.
4. INCRBY Redis seat_count 1.
5. Gửi notification: "Thanh toán không thành công, vui lòng thử đăng ký lại."

### E5: Circuit Breaker OPEN

**Tình huống:** VNPay đã fail 5 lần trong 30 giây, Circuit Breaker chuyển sang OPEN.

**Xử lý:**
1. Server không gọi VNPay.
2. Trả về 503 ngay lập tức (< 100ms).
3. Response: `{"error": "Dịch vụ thanh toán tạm thời gián đoạn. Vui lòng thử lại sau 60 giây.", "retry_after": 60}`.
4. Các endpoint khác (xem workshop, đăng ký miễn phí...) hoạt động bình thường.
5. Sau 60s: Circuit Breaker → HALF-OPEN, thử probe request tiếp theo.

### E6: Duplicate registration (sinh viên đăng ký lại workshop đã đăng ký)

**Xử lý:**
- PostgreSQL UNIQUE constraint `(user_id, workshop_id)` trên bảng registrations.
- Trả về 409: "Bạn đã đăng ký workshop này rồi."

---

## Ràng buộc

- **Tính nhất quán:** `registered_count` trong DB phải luôn bằng số registration có status `confirmed` cho workshop đó. Kiểm tra bằng cron job hàng đêm (reconciliation).
- **Timeout VNPay:** Tối đa 10 giây, không chờ lâu hơn.
- **Idempotency key TTL:** 24 giờ trong Redis.
- **QR token expiry:** Signed JWT với `exp = workshop.ends_at + 1 giờ` (hết hạn sau khi workshop kết thúc).
- **Seat counter Redis:** Khởi tạo lại từ DB mỗi khi server restart (trong Express app initialization, ví dụ: `app.listen()` callback).

---

## Tiêu chí chấp nhận

- [ ] 100 requests đồng thời cho workshop 60 chỗ: đúng 60 registrations được tạo, không hơn.
- [ ] Retry với cùng `idempotency_key`: chỉ một payment record được tạo trong DB.
- [ ] Khi VNPay fail: registered_count không tăng, chỗ được hoàn lại.
- [ ] Khi Circuit Breaker OPEN: GET /workshops vẫn trả về 200.
- [ ] QR code nhận được sau khi payment callback thành công (< 5 giây từ khi VNPay gọi callback).
