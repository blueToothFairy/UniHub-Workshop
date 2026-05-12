Khi cổng thanh toán liên tục lỗi, mục tiêu của hệ thống là:

```text
Không để lỗi gateway lan sang toàn bộ backend.
Không giữ thread/connection chờ timeout quá lâu.
Không tạo nhiều registration/payment lỗi.
Không làm sập các chức năng không liên quan như xem workshop, đăng ký miễn phí, xem QR cũ.
```

Cách phổ biến là dùng **Circuit Breaker + Graceful Degradation**.

---

# 1. Vấn đề nếu không có Circuit Breaker

Giả sử backend gọi VNPay/MoMo mỗi lần user đăng ký workshop có phí.

Nếu gateway bị chậm hoặc lỗi liên tục:

```text
User A gọi POST /registrations
Backend gọi gateway, chờ 10s rồi timeout

User B gọi POST /registrations
Backend gọi gateway, chờ 10s rồi timeout

100 user cùng gọi
=> 100 request backend cùng bị treo chờ gateway
```

Hậu quả:

```text
Thread pool / connection pool bị chiếm
CPU/memory tăng
Database transaction có thể bị giữ lâu
API khác bị chậm theo
User retry liên tục làm tải tăng thêm
Toàn hệ thống có thể degraded hoặc sập
```

Circuit Breaker giúp backend “biết dừng lại” thay vì cứ tiếp tục gọi gateway đang lỗi.

---

# 2. Circuit Breaker là gì?

Circuit Breaker giống cầu dao điện.

Khi mọi thứ bình thường, hệ thống cho request đi qua gateway.

Khi gateway lỗi liên tục, hệ thống “ngắt cầu dao”, không gọi gateway nữa trong một khoảng thời gian.

Sau một lúc, hệ thống thử lại vài request nhỏ. Nếu gateway hồi phục thì mở lại bình thường; nếu chưa hồi phục thì tiếp tục chặn.

Circuit Breaker thường có 3 trạng thái:

```text
Closed     = bình thường, cho gọi gateway
Open       = gateway đang lỗi, chặn gọi gateway
Half-Open  = thử lại một vài request để xem gateway đã hồi chưa
```

---

# 3. Trạng thái Closed

Đây là trạng thái bình thường.

```text
Backend nhận request
Backend gọi payment gateway
Gateway trả success/failure
Backend xử lý theo kết quả
```

Trong trạng thái `Closed`, hệ thống vẫn ghi nhận thống kê:

```text
số lần gọi gateway
số lần success
số lần failed
số lần timeout
latency
error rate
```

Ví dụ rule:

```text
Nếu trong 30 giây gần nhất có 5 lỗi liên tiếp
hoặc error rate > 50%
thì chuyển Circuit Breaker sang Open.
```

Flow:

```text
Closed
  |
  | gateway fail nhiều lần
  v
Open
```

Trong bài toán đăng ký workshop có phí, ở trạng thái Closed:

```text
POST /registrations
-> validate user
-> check seat
-> tạo pending registration/payment
-> gọi gateway
-> trả payment_url
```

Nhưng nên lưu ý: **không giữ DB transaction trong lúc gọi gateway**. DB transaction chỉ dùng để reserve seat và tạo record, sau đó commit rồi mới gọi gateway.

---

# 4. Trạng thái Open

`Open` nghĩa là gateway đang bị xem là lỗi nặng. Backend **không gọi gateway nữa**.

Thay vì gọi gateway rồi chờ timeout, backend trả lỗi nhanh:

```json
{
  "error": "Dịch vụ thanh toán tạm thời gián đoạn. Vui lòng thử lại sau.",
  "retry_after": 60
}
```

HTTP status thường là:

```text
503 Service Unavailable
```

Điểm quan trọng:

```text
Trả nhanh, ví dụ dưới 100ms.
Không gọi gateway.
Không giữ chỗ nếu chưa chắc có thể tạo payment session.
Không ảnh hưởng các endpoint khác.
```

Với workshop paid flow, nếu Circuit Breaker đang `Open`, backend nên xử lý:

```text
POST /registrations cho workshop có phí:
  -> phát hiện payment gateway unavailable
  -> không reserve seat
  -> không tạo registration/payment mới
  -> trả 503 retry_after
```

Nhưng các chức năng khác vẫn hoạt động:

```text
GET /workshops/:id            vẫn 200
GET /my-registrations         vẫn 200
Đăng ký workshop miễn phí      vẫn hoạt động
Xem QR đã confirm              vẫn hoạt động
Admin xem danh sách workshop   vẫn hoạt động
```

Đây chính là **Graceful Degradation**: phần thanh toán bị tạm dừng, nhưng hệ thống còn lại vẫn chạy.

---

# 5. Trạng thái Half-Open

Sau một khoảng thời gian, ví dụ 60 giây, Circuit Breaker không nên đóng mãi. Nó chuyển sang `Half-Open`.

`Half-Open` nghĩa là:

```text
Gateway có thể đã hồi.
Cho một số rất ít request thử đi qua.
Không mở flood toàn bộ traffic ngay.
```

Ví dụ:

```text
Sau 60s Open
-> chuyển Half-Open
-> cho 1 request probe gọi gateway
```

Nếu probe thành công:

```text
Half-Open -> Closed
```

Nếu probe thất bại:

```text
Half-Open -> Open
```

Flow:

```text
Open
  |
  | sau retry_after
  v
Half-Open
  |
  | probe success
  v
Closed

Half-Open
  |
  | probe fail
  v
Open
```

Trong trạng thái Half-Open, nên giới hạn nghiêm ngặt:

```text
chỉ cho 1-3 request gateway cùng lúc
các request còn lại vẫn nhận 503 hoặc được yêu cầu thử lại sau
```

Nếu không giới hạn, vừa vào Half-Open mà 100 user cùng retry thì gateway lại bị đập tiếp.

---

# 6. Graceful Degradation là gì?

Graceful Degradation nghĩa là khi một dependency quan trọng bị lỗi, hệ thống **giảm chức năng một cách có kiểm soát**, thay vì chết toàn bộ.

Trong bài toán này:

```text
Payment gateway lỗi
=> chỉ chức năng thanh toán workshop có phí bị tạm gián đoạn
=> hệ thống workshop vẫn dùng được
```

Ví dụ degradation hợp lý:

## Với workshop có phí

```text
GET /workshops/:id:
  vẫn trả thông tin workshop
  thêm field:
    payment_available: false
    payment_unavailable_reason: "PAYMENT_GATEWAY_UNAVAILABLE"
    retry_after: 60
```

Frontend hiển thị:

```text
Cổng thanh toán đang tạm gián đoạn. Vui lòng thử lại sau.
```

Nút đăng ký paid workshop có thể bị disable tạm thời.

## Với workshop miễn phí

Không phụ thuộc gateway, vẫn đăng ký bình thường.

```text
POST /registrations với free workshop:
  vẫn reserve + confirm + tạo QR
```

## Với payment đang pending/unknown

Nếu user đã có registration/payment pending trước khi gateway lỗi:

```text
GET /registrations/:id/payment-status:
  vẫn trả trạng thái hiện tại
  nếu cần thì hướng dẫn user chờ hoặc thử lại sau
```

Không nên để user tạo thêm nhiều payment mới.

---

# 7. Áp dụng vào flow đăng ký workshop

## Khi Circuit Breaker = Closed

```text
1. User bấm đăng ký workshop có phí
2. Backend validate request
3. Backend reserve seat trong DB
4. Backend tạo registration pending_payment
5. Backend tạo payment initiating
6. Backend gọi gateway
7. Gateway trả payment_url
8. Backend update payment redirect_ready
9. Trả payment_url cho frontend
```

## Khi gateway timeout nhiều lần

```text
1. Gateway timeout
2. Backend ghi nhận failure
3. Nếu vượt ngưỡng lỗi:
   Circuit Breaker chuyển Open
```

## Khi Circuit Breaker = Open

```text
1. User bấm đăng ký workshop có phí
2. Backend kiểm tra circuit breaker trước khi reserve seat
3. Vì Open:
   - không reserve seat
   - không tạo registration
   - không gọi gateway
   - trả 503 nhanh
```

Response:

```json
{
  "error": "PAYMENT_GATEWAY_UNAVAILABLE",
  "message": "Dịch vụ thanh toán tạm thời gián đoạn. Vui lòng thử lại sau.",
  "retry_after": 60
}
```

## Khi Circuit Breaker = Half-Open

```text
1. Backend cho một request thử gọi gateway
2. Nếu thành công:
   chuyển Closed
3. Nếu thất bại:
   chuyển Open tiếp
```

---

# 8. Vì sao phải check Circuit Breaker trước khi giữ chỗ?

Đây là điểm rất quan trọng.

Không nên làm:

```text
reserve seat
create pending registration
check gateway
gateway đang down
return 503
```

Vì nếu gateway down lâu, nhiều user sẽ giữ chỗ nhưng không thể thanh toán. Seat bị kẹt.

Nên làm:

```text
check circuit breaker
nếu Open -> return 503, không giữ chỗ

nếu Closed/Half-Open hợp lệ -> mới reserve seat
```

Như vậy khi gateway đã được biết là lỗi nặng, hệ thống không tạo thêm pending registration vô ích.

---

# 9. Nhưng nếu gateway lỗi sau khi đã giữ chỗ thì sao?

Có trường hợp gateway đang Closed, backend reserve seat xong, gọi gateway thì timeout.

Lúc này không nên vội release seat ngay, vì có thể gateway đã nhận request nhưng response bị mất.

Flow an toàn:

```text
payment.status = unknown
registration.status = pending_payment
reserved_count giữ nguyên
```

Sau đó:

```text
reconciliation job query gateway
hoặc reservation expiry job xử lý nếu quá hạn
```

Nếu gateway sau đó xác nhận success:

```text
registration -> confirmed
payment -> completed
confirmed_count += 1
```

Nếu gateway xác nhận failed hoặc không tìm thấy sau grace period:

```text
registration -> cancelled/expired
payment -> failed/expired
reserved_count -= 1
```

Tóm lại:

```text
Circuit Breaker Open trước khi reserve:
  không giữ chỗ

Timeout sau khi đã reserve:
  giữ tạm, chuyển unknown, xử lý bằng reconciliation/expiry
```

---

# 10. Pseudo-code đơn giản

```ts
async function createPaidRegistration(request) {
  if (paymentCircuitBreaker.isOpen()) {
    return {
      status: 503,
      body: {
        error: 'PAYMENT_GATEWAY_UNAVAILABLE',
        retry_after: paymentCircuitBreaker.retryAfterSeconds(),
      },
    };
  }

  const { registration, payment } = await db.transaction(async (tx) => {
    const workshop = await tx.reserveSeatAtomically(request.workshopId);

    if (!workshop) {
      throw new ConflictError('WORKSHOP_FULL');
    }

    const registration = await tx.createRegistration({
      status: 'pending_payment',
    });

    const payment = await tx.createPayment({
      status: 'initiating',
    });

    return { registration, payment };
  });

  try {
    const result = await paymentCircuitBreaker.execute(() =>
      paymentGateway.createPaymentUrl({
        paymentId: payment.id,
        amount: payment.amount,
      })
    );

    await db.updatePayment(payment.id, {
      status: 'redirect_ready',
      payment_url: result.paymentUrl,
    });

    return {
      status: 201,
      body: {
        registration_id: registration.id,
        payment_status: 'redirect_ready',
        payment_url: result.paymentUrl,
      },
    };
  } catch (error) {
    if (error.type === 'CIRCUIT_OPEN') {
      // Trường hợp rare: breaker mở sau khi đã reserve.
      // Không nên tạo thêm request gateway.
      await markPaymentUnknown(payment.id);
    } else if (error.type === 'TIMEOUT') {
      await markPaymentUnknown(payment.id);
    } else {
      await cancelRegistrationAndReleaseSeat(registration.id);
    }

    return {
      status: 202,
      body: {
        registration_id: registration.id,
        payment_status: 'unknown',
        message: 'Payment đang xử lý, vui lòng kiểm tra lại sau.',
      },
    };
  }
}
```

Trong production, đoạn trên cần xử lý cẩn thận hơn, nhưng ý chính là:

```text
check breaker trước reserve
timeout thì unknown
known failure thì cancel + release
Open thì fail fast
```

---

# 11. Cấu hình khuyến nghị

Ví dụ cấu hình ban đầu:

```text
gateway_timeout: 10s
failure_threshold: 5 failures
failure_window: 30s
open_duration: 60s
half_open_max_probe: 1 hoặc 3 request
```

Rule:

```text
Nếu 5 lỗi liên tiếp trong 30s:
  Closed -> Open

Sau 60s:
  Open -> Half-Open

Nếu 1 probe success:
  Half-Open -> Closed

Nếu probe fail:
  Half-Open -> Open
```

Có thể nâng cấp sau:

```text
error rate threshold: > 50%
slow call threshold: > 5s
minimum request volume: 10 calls/window
```

---

# 12. Nên log/monitor gì?

Circuit Breaker chỉ hữu ích nếu quan sát được.

Nên có metrics:

```text
payment_gateway_calls_total
payment_gateway_success_total
payment_gateway_failure_total
payment_gateway_timeout_total
payment_gateway_latency_ms
payment_circuit_state
payment_circuit_open_total
payment_unknown_total
payment_reconciliation_success_total
payment_reconciliation_failed_total
```

Log quan trọng:

```text
circuit state changed: Closed -> Open
circuit state changed: Open -> Half-Open
circuit state changed: Half-Open -> Closed
gateway timeout
payment marked unknown
payment reconciled success/failed
```

Alert:

```text
Circuit breaker Open quá 5 phút
payment unknown tăng cao
reconciliation failed liên tục
```

---

# 13. Nếu hiện tại nhóm bạn chỉ dùng simulation payment

Nếu hiện tại chưa dùng payment gateway thật, bạn vẫn có thể thiết kế abstraction sẵn:

```ts
interface PaymentProvider {
  createPaymentSession(input): Promise<PaymentSessionResult>;
  queryPaymentStatus?(input): Promise<PaymentStatusResult>;
}
```

Hiện tại dùng:

```text
SimulationPaymentProvider
```

Sau này dùng:

```text
VNPayPaymentProvider
MoMoPaymentProvider
```

Circuit Breaker chỉ cần bọc provider thật:

```text
Simulation provider:
  không cần circuit breaker hoặc luôn Closed

Real gateway provider:
  dùng circuit breaker
```

Như vậy core registration không cần đổi nhiều.

---

# Kết luận

Cách hệ thống nên phản ứng khi payment gateway lỗi liên tục:

```text
1. Dùng timeout ngắn cho mỗi gateway call.
2. Theo dõi failure/timeout.
3. Khi lỗi vượt ngưỡng, Circuit Breaker chuyển Open.
4. Khi Open:
   - fail fast
   - không gọi gateway
   - không reserve seat mới cho paid registration
   - trả 503 retry_after
5. Vẫn cho các chức năng không phụ thuộc gateway hoạt động.
6. Sau một thời gian, Half-Open cho vài request probe.
7. Gateway hồi thì Closed lại; chưa hồi thì Open tiếp.
8. Request đã lỡ reserve rồi mà gateway timeout thì chuyển payment unknown và xử lý bằng reconciliation/expiry.
```

Nói ngắn gọn: **Circuit Breaker bảo vệ backend khỏi gateway lỗi; Graceful Degradation giữ phần còn lại của hệ thống vẫn sống.**
