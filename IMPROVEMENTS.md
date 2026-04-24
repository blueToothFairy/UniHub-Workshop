Câu hỏi rất hay — đây là điểm nhiều người nhầm lẫn giữa **queue** và **event bus**.

---

## Phân tích từng event một

Hãy nhìn vào danh sách và hỏi thẳng: *"Task này cần queue không, hay chỉ cần gọi thẳng?"*

### `RegistrationConfirmed` → **CẦN queue**

Sau khi đăng ký thành công, cần:
- Gửi email xác nhận
- Gửi in-app notification

Hai việc này **chậm và có thể fail** (email provider timeout, API lỗi). Nếu làm synchronous thì response của `POST /registrations` phải chờ email server → UX tệ, và nếu email lỗi thì đăng ký có bị rollback không? Không nên. Queue giải quyết đúng chỗ đau này.

✅ **Queue đúng chỗ.**

---

### `PaymentSucceeded` → **Không cần queue riêng**

Event này đến từ VNPay callback gọi vào `POST /payments/callback`. Tại handler đó, bạn cần:
- UPDATE payment status
- UPDATE registration status → confirmed
- Generate QR code
- Enqueue notification

Ba việc đầu là **DB writes đơn giản**, làm trong một transaction là xong, không cần queue. Chỉ việc cuối (notification) mới cần queue — và đó chính là `RegistrationConfirmed` event ở trên.

Nếu bạn publish `PaymentSucceeded` vào queue rồi có một worker nhận và làm 3 việc đó, bạn đang thêm một bước nhảy không cần thiết, và phải xử lý thêm: *"Nếu worker fail giữa chừng thì payment đã confirmed chưa?"*

⚠️ **Queue ở đây làm phức tạp hơn, không đơn giản hơn.**

---

### `WorkshopChanged` / `WorkshopCancelled` → **Cần queue, nhưng chỉ cho notification**

Khi admin hủy workshop, cần notify tất cả sinh viên đã đăng ký. Đây có thể là hàng trăm email — cần queue để:
- Không block response của admin
- Retry nếu email fail từng cái

Tuy nhiên bản thân việc UPDATE database (đổi status workshop) vẫn làm synchronous trong request handler. Queue chỉ nhận nhiệm vụ **fan-out notification**, không phải xử lý core logic.

✅ **Queue đúng chỗ, nhưng cần nói rõ queue nhận task gì.**

---

### `PDFUploaded` → **Cần queue**

Upload xong PDF → trigger AI summary. AI call mất 10–30 giây, không thể làm synchronous. Đây là use case kinh điển cho queue.

✅ **Queue đúng chỗ.**

---

### `StudentCSVImported` → **Không cần queue, dùng cron job**

CSV import chạy lúc 2:05 sáng theo lịch cố định. Đây là **scheduled job**, không phải event-driven. Không có ai trigger nó — nó tự chạy theo thời gian.

Nếu bạn publish `StudentCSVImported` vào queue thì ai publish? Cron job publish vào queue rồi worker nhận lại xử lý — bạn đang thêm một bước nhảy vô nghĩa. Cron job gọi thẳng service là đủ.

❌ **Queue sai chỗ. Dùng cron job trực tiếp.**

---

### `CheckInSynced` → **Không cần queue**

Mobile app gọi `POST /checkin/sync` với batch records. Backend nhận, INSERT vào DB, trả về kết quả. Đây là **synchronous request-response** bình thường. Không có gì async ở đây cả.

Nếu bạn publish event này vào queue thì để làm gì? Ai consume? Làm gì với nó? Tài liệu của đồng đội không trả lời được câu hỏi này.

❌ **Queue sai chỗ. Không cần thiết.**

---

## Vấn đề gốc rễ: nhầm lẫn giữa hai pattern

Đồng đội của bạn đang trộn lẫn hai thứ khác nhau:

```
Pattern A — Task Queue (đúng use case)
  "Tôi có việc cần làm nhưng không muốn làm ngay"
  → Gửi email, generate AI summary, fan-out notification
  → Worker nhận task, xử lý, retry nếu fail

Pattern B — Event Bus (bị dùng sai)
  "Tôi muốn thông báo cho hệ thống biết điều gì vừa xảy ra"
  → Nhưng nếu không có ai lắng nghe hoặc không cần async
  → thì publish event chỉ là overhead
```

`PaymentSucceeded`, `StudentCSVImported`, `CheckInSynced` trong danh sách đó thuộc Pattern B bị áp dụng không cần thiết — không có consumer nào thực sự cần nhận event này một cách async.

---

## Danh sách đã được làm sạch

| Task | Cơ chế đúng | Lý do |
|------|------------|-------|
| Gửi email sau đăng ký | ✅ Queue | Async, có thể fail, cần retry |
| Gửi in-app notification | ✅ Queue | Async, không block response |
| Fan-out email khi hủy workshop | ✅ Queue | Nhiều email, cần fan-out |
| Generate AI summary từ PDF | ✅ Queue | Chậm (10–30s), async hoàn toàn |
| UPDATE payment + registration | ❌ Không queue | DB write đơn giản, trong transaction |
| CSV import | ❌ Không queue | Cron job, scheduled, không event-driven |
| Nhận batch check-in sync | ❌ Không queue | Request-response bình thường |

Tóm lại: queue chỉ có giá trị khi task **chậm, có thể fail, hoặc cần fan-out**. Còn lại, gọi thẳng đơn giản hơn, dễ debug hơn, và ít thứ có thể hỏng hơn.