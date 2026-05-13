Dưới đây là thiết kế mình đề xuất cho tình huống **12.000 sinh viên truy cập trong 10 phút đầu**, trong đó **7.200 sinh viên dồn vào 3 phút đầu**.

Con số trung bình nghe không quá lớn:

```text
7.200 request / 180 giây ≈ 40 sinh viên/giây
```

Nhưng thực tế nguy hiểm hơn vì mỗi sinh viên có thể:

```text
refresh liên tục
double click Register
retry khi chậm
poll status liên tục
mở nhiều tab
gửi nhiều request song song
```

Nếu mỗi người tạo 5–10 request, backend có thể nhận vài trăm đến vài nghìn RPS trong thời gian ngắn. Vì vậy cần bảo vệ theo nhiều lớp.

---

# Mục tiêu thiết kế

Hệ thống cần đảm bảo:

```text
1. Backend API không bị quá tải.
2. Client spam request không có lợi hơn client bình thường.
3. Mỗi sinh viên có cơ hội công bằng.
4. Không oversell chỗ.
5. Khi quá tải, hệ thống degrade có kiểm soát, không sập toàn bộ.
```

---

# Kiến trúc tổng thể đề xuất

```text
[Student Browser]
      |
      v
[CDN / Static Cache]
      |
      v
[API Gateway / Edge Rate Limit]
      |
      v
[Admission Control / Virtual Queue]
      |
      v
[Backend API]
      |
      v
[Redis: rate limit, queue, admission token]
      |
      v
[PostgreSQL: source of truth for seats]
```

Ý tưởng chính:

```text
Không cho tất cả 12.000 sinh viên đánh thẳng vào POST /registrations.

Thay vào đó:
  - GET/read API được cache.
  - POST đăng ký được kiểm soát bằng admission token.
  - Mỗi user chỉ có một cơ hội active tại một thời điểm.
  - Backend chỉ nhận số lượng request vừa sức xử lý.
```

---

# 1. Tách read traffic và write traffic

## Read traffic

Các endpoint như:

```http
GET /workshops/:id
GET /workshops
GET /registrations/:id/payment-status
```

nên được cache/throttle tốt.

Với `GET /workshops/:id`, response nên có:

```json
{
  "id": "workshop_id",
  "capacity": 60,
  "reserved_count": 42,
  "confirmed_count": 35,
  "available_seats": 18,
  "registration_opens_at": "2026-05-20T09:00:00Z",
  "registration_status": "open"
}
```

Có thể cache ngắn:

```text
CDN/browser cache: 3–10 giây
Backend cache: 1–3 giây
```

Không cần mọi sinh viên refresh là query DB ngay.

## Write traffic

Các endpoint nguy hiểm:

```http
POST /registrations
POST /registrations/:id/simulate-payment
POST /payments/create-order
```

phải đi qua:

```text
rate limit
admission control
idempotency
DB atomic reservation
```

---

# 2. Rate limiting nhiều tầng

Rate limit không chỉ theo IP, vì sinh viên có thể dùng chung Wi-Fi trường. Nên limit theo nhiều khóa.

## Per-user rate limit

Ví dụ:

```text
POST /registrations:
  1 request / 3 giây / user
  burst tối đa 2 request

GET payment-status:
  1 request / 2 giây / user

GET workshop detail:
  1 request / 1 giây / user
```

Nếu vượt:

```http
429 Too Many Requests
Retry-After: 3
```

Body:

```json
{
  "error": "RATE_LIMITED",
  "retry_after": 3
}
```

## Per-IP rate limit

Dùng để chặn bot hoặc lỗi frontend:

```text
POST /registrations:
  30 request / phút / IP

GET workshop detail:
  300 request / phút / IP
```

Không nên quá chặt theo IP vì nhiều sinh viên có thể dùng cùng mạng.

## Global rate limit

Đây là lớp bảo vệ backend:

```text
POST /registrations:
  tối đa 100–300 request/giây toàn hệ thống
```

Nếu vượt, trả:

```json
{
  "error": "SYSTEM_BUSY",
  "retry_after": 5
}
```

Client phải retry có jitter:

```text
retry sau 3–8 giây, không retry đồng loạt.
```

---

# 3. Admission Control / Virtual Queue

Đây là phần quan trọng nhất để đảm bảo công bằng.

Thay vì cho tất cả sinh viên gọi thẳng `POST /registrations`, ta dùng cơ chế **admission token**.

## Luồng đề xuất

```text
1. Sinh viên mở trang workshop.
2. Trước giờ mở đăng ký, frontend gọi:
   GET /workshops/:id/registration-gate

3. Backend trả:
   - chưa mở
   - đang mở
   - hoặc user đang trong hàng chờ

4. Khi mở đăng ký, backend cấp admission token theo tốc độ có kiểm soát.

5. Chỉ client có admission token hợp lệ mới được gọi POST /registrations.
```

Endpoint:

```http
POST /workshops/:id/admission
```

Response nếu được vào:

```json
{
  "status": "admitted",
  "admission_token": "signed_token",
  "expires_in": 30
}
```

Response nếu phải chờ:

```json
{
  "status": "waiting",
  "queue_position": 1532,
  "estimated_wait_seconds": 45,
  "retry_after": 5
}
```

`POST /registrations` bắt buộc có:

```http
Admission-Token: <signed-token>
Idempotency-Key: <uuid>
Authorization: Bearer <jwt>
```

Nếu thiếu token:

```http
403 Forbidden
```

Body:

```json
{
  "error": "ADMISSION_TOKEN_REQUIRED"
}
```

---

# 4. Fairness: công bằng giữa sinh viên

Có 2 cách phổ biến.

---

## Cách A: First-come, first-served có kiểm soát

Ai vào hàng chờ trước thì được cấp token trước.

Dùng Redis Sorted Set:

```text
queue:workshop:{id}
score = joined_at timestamp
member = user_id
```

Khi user join:

```text
ZADD queue:workshop:123 joined_at user_id
```

Worker hoặc API cấp token theo batch:

```text
Mỗi giây cấp 50–100 admission token
```

Ưu điểm:

```text
Dễ hiểu.
Dễ giải thích cho sinh viên.
Phù hợp nếu mở đăng ký đúng giờ.
```

Nhược điểm:

```text
Người mạng nhanh hơn có lợi.
Người canh đúng millisecond có lợi.
```

---

## Cách B: Fair window + randomization

Để công bằng hơn trong thời điểm mở đăng ký, dùng **cửa sổ gom hàng chờ**.

Ví dụ:

```text
Từ 08:55 đến 09:00:
  sinh viên có thể vào waiting room.

Lúc 09:00:
  tất cả người đã vào waiting room được random thứ tự.

Sau 09:00:
  người vào sau xếp sau nhóm đầu.
```

Cách này giảm lợi thế của người spam refresh đúng thời điểm.

Redis model:

```text
waiting_room:workshop:{id}
member = user_id
score = random_rank hoặc assigned_rank
```

Luồng:

```text
08:55 - 09:00:
  user join waiting room

09:00:
  backend lock danh sách
  shuffle/randomize rank
  bắt đầu cấp admission token theo rank

09:00 trở đi:
  user mới được append phía sau
```

Ưu điểm:

```text
Công bằng hơn cho đợt dồn vào đầu.
Spam request không giúp được gì.
```

Nhược điểm:

```text
Phức tạp hơn first-come-first-served.
Cần giải thích UX rõ.
```

Với quy mô project hiện tại, mình khuyên dùng *Cách A*.

---

# 5. Admission token nên hoạt động thế nào?

Admission token nên là signed JWT hoặc opaque token lưu Redis.

Payload ví dụ:

```json
{
  "type": "registration_admission",
  "user_id": "user_123",
  "workshop_id": "workshop_456",
  "rank": 152,
  "iat": 1778061600,
  "exp": 1778061630,
  "jti": "token_unique_id"
}
```

Quy tắc:

```text
Token chỉ dùng cho đúng user.
Token chỉ dùng cho đúng workshop.
Token sống ngắn, ví dụ 30–60 giây.
Token chỉ dùng một lần hoặc một logical attempt.
```

Redis lưu:

```text
admission_token:{jti} = unused
TTL = 60s
```

Khi `POST /registrations`:

```text
1. Verify token signature.
2. Check token user/workshop khớp.
3. Atomically mark token used.
4. Nếu token đã used -> reject hoặc replay theo idempotency.
```

---

# 6. Backend vẫn phải dùng DB atomic reservation

Admission control chỉ giúp giảm tải và tăng công bằng. Nó **không thay thế** seat correctness.

Trong DB vẫn phải làm:

```sql
UPDATE workshops
SET reserved_count = reserved_count + 1
WHERE id = :workshop_id
  AND reserved_count < capacity
RETURNING id, reserved_count, capacity;
```

Nếu không có row:

```http
409 Conflict
```

Body:

```json
{
  "error": "WORKSHOP_FULL"
}
```

Lý do: admission token chỉ kiểm soát lượng request vào backend, nhưng vẫn có race condition hoặc token dư.

---

# 7. Không cấp quá nhiều token so với số chỗ

Nếu workshop chỉ còn 60 chỗ, không nên cấp admission token cho 5.000 người cùng lúc.

Có thể cấp token theo batch nhỏ:

```text
available_seats = capacity - reserved_count

batch_size = min(available_seats + buffer, max_tokens_per_second)
```

Ví dụ:

```text
capacity = 60
buffer = 20
=> chỉ cấp khoảng 80 token đầu

Sau đó quan sát:
  nếu nhiều token expire hoặc request fail
  cấp tiếp batch nhỏ
```

Tại sao cần buffer?

```text
Một số user nhận token nhưng không bấm tiếp.
Một số request fail validation.
Một số user mất mạng.
```

Nhưng buffer không nên quá lớn để tránh backend bị burst.

---

# 8. Idempotency chống double-click/retry

Frontend vẫn phải gửi:

```http
Idempotency-Key: <uuid>
```

Backend rule:

```text
Same user + same workshop + same idempotency key:
  replay kết quả cũ

Same key + different body:
  409

New key nhưng đã có active registration:
  trả registration hiện tại, không tạo mới
```

Nhờ đó:

```text
double click
browser retry
network retry
mở nhiều tab
```

không tạo nhiều registration/payment.

---

# 9. Client retry phải có backoff + jitter

Không nên để frontend retry kiểu:

```text
retry ngay lập tức
retry mỗi 100ms
mọi client retry cùng lúc
```

Nên dùng:

```text
Retry-After header từ backend
random jitter
exponential backoff
```

Ví dụ:

```ts
const waitMs = retryAfterSeconds * 1000 + random(0, 2000);
```

Nếu backend trả:

```http
429 Retry-After: 5
```

thì client retry sau:

```text
5–7 giây
```

Không phải đúng 5 giây để tránh herd effect.

---

# 10. Graceful degradation khi quá tải

Khi backend gần quá tải, không nên để mọi thứ chậm dần rồi chết. Nên chủ động degrade.

## Với read API

Nếu DB đang quá tải:

```text
trả cached workshop detail
cho phép dữ liệu trễ 5–10 giây
```

## Với register API

Nếu global limiter đầy:

```http
429 Too Many Requests
Retry-After: 5
```

Hoặc:

```http
503 Service Unavailable
Retry-After: 10
```

Body:

```json
{
  "error": "REGISTRATION_BUSY",
  "message": "Hệ thống đang xử lý lượng đăng ký lớn. Vui lòng thử lại sau.",
  "retry_after": 10
}
```

## Với queue API

Nếu user chưa đến lượt:

```http
200 OK
```

Body:

```json
{
  "status": "waiting",
  "queue_position": 234,
  "retry_after": 5
}
```

Không trả lỗi nếu chỉ đang chờ.

---

# 11. Luồng hoàn chỉnh đề xuất

## Trước giờ mở đăng ký

```text
Student mở trang workshop
GET /workshops/:id
-> CDN/cache trả thông tin workshop

Student join waiting room
POST /workshops/:id/admission
-> status = waiting
```

## Tại thời điểm mở đăng ký

```text
Backend xếp hàng waiting room
Bắt đầu cấp admission token theo batch
Frontend poll admission mỗi 3–5 giây
```

## Khi user được cấp token

```text
Frontend gọi POST /registrations
Headers:
  Authorization
  Idempotency-Key
  Admission-Token

Backend:
  verify admission token
  rate limit
  idempotency lookup
  DB atomic reserve seat
  create registration/payment
  return result
```

## Khi hết chỗ

```text
Backend ngừng cấp admission token mới
Queue API trả:
  status = closed/full

POST /registrations nếu lọt vào vẫn check DB:
  409 WORKSHOP_FULL
```

---

# 12. Redis data structures gợi ý

## Waiting room

```text
wr:workshop:{id}:users
Type: Sorted Set
member: user_id
score: rank hoặc joined_at
```

## Admission tokens

```text
admission:{jti}
Type: String
Value: user_id/workshop_id/unused
TTL: 60s
```

## Per-user rate limit

```text
rl:user:{user_id}:post_registrations
Type: counter/token bucket
TTL: few seconds
```

## Global rate limit

```text
rl:global:post_registrations
Type: token bucket
```

## User active attempt

```text
active_registration:{workshop_id}:{user_id}
Value: registration_id
TTL: optional or derived from DB
```

Redis chỉ dùng để điều phối tải. PostgreSQL vẫn là source of truth cho registration/seat.

---

# 13. Chống spam và abuse

Nên có các rule:

```text
Một user chỉ được join waiting room một lần cho một workshop.
Một user chỉ có một admission token active.
Một user chỉ có một active registration pending/confirmed.
Admission token hết hạn nếu không dùng trong 30–60 giây.
POST /registrations thiếu token bị reject.
Idempotency key reuse sai body bị reject.
```

Nếu phát hiện nhiều tab:

```text
cùng user/workshop -> trả cùng queue position hoặc cùng active registration
```

Không cho nhiều tab tạo lợi thế.

---

# 14. Cấu hình ban đầu đề xuất

Giả sử backend xử lý an toàn khoảng 100 write requests/giây.

```text
Admission poll:
  mỗi user poll 3–5 giây/lần

Admission token TTL:
  45 giây

Registration API global limit:
  100 requests/giây

Per-user POST /registrations:
  1 request / 3 giây

Per-user admission poll:
  1 request / 3 giây

Batch token release:
  50 token/giây hoặc theo available seats + buffer

Initial waiting room:
  mở trước 5 phút

Randomization window:
  tất cả user join trước opening time được shuffle
```

Nếu workshop chỉ có 60 chỗ:

```text
Không cấp 12.000 token.
Cấp 80 token đầu.
Sau mỗi vài giây, nếu token expire/fail thì cấp thêm.
```

---

# 16. Monitoring cần có

Cần đo:

```text
registration_requests_total
registration_success_total
registration_conflict_full_total
registration_rate_limited_total
admission_waiting_count
admission_tokens_issued_total
admission_tokens_used_total
admission_tokens_expired_total
queue_position_p50/p95
api_latency_p95
db_connection_pool_usage
redis_latency
```

Alert:

```text
POST /registrations p95 > 1s
DB connection pool > 80%
429 tăng đột biến
Redis latency cao
Queue không giảm trong N phút
```

---

# Kết luận

Để backend không bị quá tải khi 12.000 sinh viên đăng ký cùng lúc, không nên chỉ dựa vào “scale server”. Cần kiểm soát luồng vào.

Thiết kế mình đề xuất:

```text
CDN/cache cho read traffic.
Rate limit theo user/IP/global.
Virtual waiting room để điều phối công bằng.
Admission token để giới hạn ai được gọi POST /registrations.
Idempotency để chống double-click/retry.
PostgreSQL atomic update để chống oversell.
Retry-After + jitter để tránh retry storm.
Graceful degradation khi quá tải.
```

Nếu phải chọn phần quan trọng nhất, mình sẽ chọn 4 thứ:

```text
1. Admission token / virtual queue.
2. Per-user + global rate limit.
3. Idempotency key.
4. Atomic DB seat reservation.
```

Trong đó **virtual queue + admission token** là lớp giúp backend “thở được”, còn **atomic DB reservation** là lớp đảm bảo correctness cuối cùng.
