# Real Demo: Peak + Idempotency + Circuit Breaker

Demo title:
`"Một đợt mở đăng ký workshop có phí trong giờ cao điểm, MoMo bị lỗi, và client retry nhiều lần"`

## Mục tiêu

- Chạy trên **hành vi thật** của backend hiện tại (không mock, không sửa source backend).
- Mỗi phần có script riêng và tự ghi log `.txt` trong chính thư mục phần đó.
- Có script tổng chạy liền mạch toàn bộ kịch bản.

## Cấu trúc

- `00_setup/run.mjs`: chuẩn bị dữ liệu demo (workshop + student), preflight config.
- `01_peak_admission/run.mjs`: demo peak admission + polling throttle.
- `02_idempotency/run.mjs`: demo idempotency replay và conflict.
- `03_oversell/run.mjs`: demo no-oversell dưới concurrent registration.
- `04_circuit_breaker/run.mjs`: demo circuit breaker + graceful degradation.
- `04_circuit_breaker/mock-momo-server.mjs`: local MoMo mock for Part 4.
- `99_full_scenario/run-all.mjs`: chạy toàn bộ theo thứ tự.

## Lưu ý quan trọng theo codebase hiện tại

1. Tên biến env dùng trong backend là:
- `PEAK_CONTROL_*` (không phải `PEAK_ADMISSION_*`).
- `PAYMENT_CIRCUIT_*` (không phải `PAYMENT_CB_*`).

2. Admission budget hiện tại được tính:
- `admitBudget = (availableSeats + queueBufferSeats) - activeTokenCount`
- Với workshop `capacity=3`, kết quả thường là tối đa 3 token active khi `queueBufferSeats=0`.

3. Trong `POST /registrations`, backend validate admission token trước idempotency lookup.
- Retry cùng idempotency key trong peak mode cần **token admission mới**.

4. Phần circuit breaker không dùng mock. Script kiểm thử hành vi thật:
- Lỗi gateway thật (`timeout/transport/provider`) -> breaker mở.
- Nếu môi trường MoMo đang ổn định tuyệt đối, phần này có thể chưa mở breaker đủ nhanh.

Update: Part 4 hiện đã tự chạy backend tạm thời + mock MoMo local để chủ động tạo lỗi circuit-breaker.
Backend tạm này chạy mặc định ở `http://127.0.0.1:3300`, mock MoMo ở `http://127.0.0.1:19090`.

## Chạy từng phần

Chạy từ thư mục `backend`:

```bash
node demo/peak-paid-momo-retry-real/00_setup/run.mjs
node demo/peak-paid-momo-retry-real/01_peak_admission/run.mjs
node demo/peak-paid-momo-retry-real/02_idempotency/run.mjs
node demo/peak-paid-momo-retry-real/03_oversell/run.mjs
node demo/peak-paid-momo-retry-real/04_circuit_breaker/run.mjs
```

## Chạy full scenario

```bash
node demo/peak-paid-momo-retry-real/99_full_scenario/run-all.mjs
```

## Env khuyến nghị cho demo

```env
DEMO_STUDENT_COUNT=50
DEMO_CB_STUDENT_COUNT=50

PEAK_CONTROL_ENABLED=true
PEAK_CONTROL_WINDOW_START_UTC=00:00
PEAK_CONTROL_WINDOW_END_UTC=23:59
PEAK_CONTROL_USER_POLL_MIN_INTERVAL_SECONDS=5
PEAK_CONTROL_USER_WRITE_MIN_INTERVAL_SECONDS=3
PEAK_CONTROL_GLOBAL_WRITE_LIMIT_PER_SECOND=3
PEAK_CONTROL_QUEUE_BUFFER_SEATS=0

PAYMENT_CIRCUIT_FAILURE_THRESHOLD=3
PAYMENT_CIRCUIT_OPEN_DURATION_SECONDS=20
PAYMENT_CIRCUIT_HALF_OPEN_PROBE_LIMIT=1
```
