# UniHub Workshop - Architecture Overview

## 1. Mục tiêu kiến trúc

Hệ thống UniHub Workshop cần giải quyết đồng thời nhiều nhóm yêu cầu:

- Phục vụ lượng truy cập lớn khi mở đăng ký workshop.
- Đảm bảo không oversell chỗ ngồi khi nhiều sinh viên đăng ký cùng lúc.
- Tách biệt các phần dễ lỗi như thanh toán, gửi thông báo, AI summary, nhập CSV để sự cố cục bộ không làm sập toàn hệ thống.
- Hỗ trợ nhiều kênh client: student app/web, admin web, check-in mobile app.
- Cho phép mở rộng sau này như thêm kênh thông báo mới hoặc tách service khi tải tăng.

Vì vậy, kiến trúc đề xuất là:

- `Client-server architecture` cho các ứng dụng người dùng.
- `Modular monolith` ở giai đoạn đầu để giảm độ phức tạp vận hành.
- `Event-driven integration` cho các tác vụ bất đồng bộ và tích hợp ngoài.
- `Background workers` cho AI summary, gửi thông báo, đồng bộ CSV, và xử lý thanh toán.

Lý do chọn hướng này:

- So với microservices đầy đủ, modular monolith dễ phát triển, test, deploy và phù hợp bài toán học kỳ/đơn vị trường.
- So với monolith đồng bộ hoàn toàn, kiến trúc event-driven giúp cô lập lỗi tốt hơn, chịu tải tốt hơn và dễ mở rộng dần.
- Các tính năng có đặc tính khác nhau như đăng ký thời gian thực, thanh toán, check-in offline, AI summary và nhập CSV đều có thể được tách thành module rõ ràng nhưng vẫn dùng chung một codebase và một database chính trong giai đoạn đầu.

## 2. Các thành phần chính

Hệ thống gồm các phần sau:

### 2.1 Client applications

1. `Student App/Web`
- Xem danh sách workshop.
- Xem chi tiết workshop, diễn giả, phòng, sơ đồ phòng, số chỗ còn lại.
- Đăng ký workshop miễn phí hoặc có phí.
- Nhận QR code sau khi đăng ký thành công.
- Nhận thông báo trong app.

2. `Admin Web`
- Dành cho ban tổ chức.
- Tạo, cập nhật, đổi phòng, đổi giờ, hủy workshop.
- Upload PDF giới thiệu workshop.
- Xem thống kê đăng ký.

3. `Check-in Mobile App`
- Dành cho nhân sự quét QR tại cửa phòng.
- Hỗ trợ offline-first: vẫn ghi nhận check-in khi mất mạng.
- Tự đồng bộ khi mạng phục hồi.

### 2.2 Edge layer

4. `API Gateway / Load Balancer`
- Là cửa vào duy nhất cho client.
- Thực hiện routing request.
- Áp dụng rate limiting, throttling, request validation cơ bản.
- Có thể gắn thêm CDN/cache cho dữ liệu đọc nhiều như danh sách workshop.

Lý do:
- Giảm tải trực tiếp vào backend.
- Tạo một nơi chung để bảo vệ hệ thống trước burst traffic.

### 2.3 Backend application

5. `Application Server` (modular monolith)

Server backend được chia thành các module nội bộ:

- `Identity & Access Control Module`
- `Workshop Catalog Module`
- `Registration Module`
- `Payment Module`
- `Notification Module`
- `Check-in Module`
- `AI Summary Module`
- `Student Sync Module`
- `Reporting/Statistics Module`

Các module này chạy chung trong một backend nhưng tách riêng theo domain logic, API, service class, transaction boundary và background jobs.

### 2.4 Data and integration layer

6. `Primary Relational Database`
- Lưu users, roles, workshops, schedules, rooms, seat inventory, registrations, payments, notifications, check-ins, import logs.
- Nên dùng PostgreSQL hoặc MySQL.

7. `Redis / Distributed Cache`
- Cache dữ liệu đọc nhiều như danh sách workshop.
- Dùng cho rate limiting, request throttling, idempotency token tạm thời, lock ngắn hạn nếu cần.

8. `Message Broker / Queue`
- Ví dụ RabbitMQ, Kafka hoặc cloud queue tương đương.
- Dùng cho các event như:
  - `RegistrationConfirmed`
  - `PaymentSucceeded`
  - `WorkshopChanged`
  - `WorkshopCancelled`
  - `PDFUploaded`
  - `StudentCSVImported`
  - `CheckInSynced`

9. `Object Storage`
- Lưu PDF workshop.
- Lưu sơ đồ phòng, QR code image nếu cần lưu file.

10. `Email Provider`
- Gửi email xác nhận.

11. `Payment Gateway`
- Xử lý thanh toán workshop có phí.

12. `AI Service / LLM Gateway`
- Nhận text đã được làm sạch để sinh summary.

13. `Scheduled CSV Import Source`
- Thư mục chứa file CSV xuất từ hệ thống cũ mỗi đêm.

## 3. Cách các phần giao tiếp với nhau

### 3.1 Kiểu giao tiếp

Hệ thống dùng hai kiểu giao tiếp:

1. `Synchronous request/response`
- Client gọi API Gateway.
- API Gateway gọi Application Server.
- Application Server đọc/ghi trực tiếp vào database, cache, hoặc gọi payment khi cần phản hồi ngay.

2. `Asynchronous event/message`
- Sau các giao dịch quan trọng, backend phát event vào queue.
- Worker nền tiêu thụ event để gửi email, tạo summary AI, cập nhật thống kê, đồng bộ check-in, xử lý retry.

Lý do:
- Các luồng cần phản hồi nhanh cho người dùng vẫn chạy đồng bộ.
- Các tác vụ chậm hoặc dễ lỗi được đẩy sang bất đồng bộ để không làm request người dùng bị treo.

### 3.2 Luồng xem workshop

`Student App/Web -> API Gateway -> Workshop Catalog Module -> Cache/Database`

Chi tiết:
- Danh sách workshop được cache ngắn hạn.
- Chi tiết workshop lấy từ database.
- Số chỗ còn lại không nên chỉ cache lâu vì cần gần thời gian thực.
- Có thể dùng:
  - Query trực tiếp từ seat inventory trong database.
  - Hoặc cache ngắn vài giây và refresh liên tục.

Nếu payment gateway hoặc AI service lỗi:
- Luồng xem workshop vẫn hoạt động bình thường.
- Summary AI có thể tạm chưa hiển thị hoặc hiển thị bản cũ.

### 3.3 Luồng đăng ký workshop miễn phí

`Student App/Web -> API Gateway -> Registration Module -> Database`

Các bước:
1. Xác thực sinh viên qua Identity module.
2. Kiểm tra workshop còn mở đăng ký, đúng thời gian, đúng điều kiện.
3. Thực hiện giữ chỗ/ghi nhận đăng ký trong transaction.
4. Sinh QR code sau khi đăng ký thành công.
5. Phát event `RegistrationConfirmed`.
6. Notification worker gửi thông báo in-app và email.

Điểm quan trọng để tránh tranh chấp chỗ:
- Dùng transaction ở database.
- Cập nhật seat inventory theo kiểu atomic:
  - `remaining_seats > 0` mới được trừ.
  - Hoặc tạo registration theo quota bằng optimistic/pessimistic locking.
- Chỉ xác nhận đăng ký khi transaction commit thành công.

Kết quả:
- Không có hai sinh viên cùng lấy được chỗ cuối.

### 3.4 Luồng đăng ký workshop có phí

`Student App/Web -> API Gateway -> Registration Module -> Payment Module -> Payment Gateway`

Kiến trúc đề xuất:
- Không trừ chỗ vĩnh viễn ngay khi sinh viên bấm đăng ký.
- Tạo `registration_pending_payment` với thời gian giữ chỗ ngắn, ví dụ 10 phút.
- Payment Module tạo payment order với `idempotency key`.
- Khi payment gateway callback thành công:
  - Payment Module xác nhận thanh toán.
  - Registration Module chuyển trạng thái sang `confirmed`.
  - QR code được phát hành.
  - Event `RegistrationConfirmed` được gửi.
- Nếu timeout hoặc gateway lỗi:
  - Registration vẫn ở trạng thái pending hoặc failed.
  - Hết TTL thì chỗ được giải phóng bởi background job.

Vì sao làm vậy:
- Tránh trừ tiền hai lần bằng idempotency key.
- Tránh giữ chỗ vô thời hạn khi thanh toán treo.
- Nếu payment gateway sập lâu, chỉ luồng có phí bị ảnh hưởng; xem workshop và workshop miễn phí vẫn chạy.

### 3.5 Luồng gửi thông báo

`RegistrationConfirmed / WorkshopChanged / WorkshopCancelled -> Message Broker -> Notification Module workers`

Notification Module dùng mô hình:

- `Notification Orchestrator`
- `Channel Providers`
  - `InAppProvider`
  - `EmailProvider`
  - sau này thêm `TelegramProvider`

Lý do:
- Dùng interface/provider pattern để thêm kênh mới mà không sửa logic nghiệp vụ chính.
- Registration module chỉ publish event, không cần biết gửi qua kênh nào.

Nếu email provider lỗi:
- In-app notification vẫn có thể gửi.
- Email được retry từ queue.
- Không ảnh hưởng luồng đăng ký đã thành công.

### 3.6 Luồng quản trị workshop

`Admin Web -> API Gateway -> Identity Module + Workshop/Admin Modules -> Database`

Các thay đổi như đổi giờ, đổi phòng, hủy workshop:
- Ghi vào database bằng transaction.
- Publish event `WorkshopChanged` hoặc `WorkshopCancelled`.
- Notification worker gửi thông báo đến sinh viên đã đăng ký.
- Reporting/statistics được cập nhật bất đồng bộ nếu cần.

Kiểm soát truy cập:
- `RBAC` theo role:
  - `Student`: chỉ xem và đăng ký workshop.
  - `Organizer`: tạo/sửa/hủy workshop, upload PDF, xem thống kê.
  - `CheckInStaff`: chỉ dùng API check-in/quét QR.

Khuyến nghị:
- Admin API tách route riêng.
- Bắt buộc strong authentication.
- Audit log cho hành động quản trị.

### 3.7 Luồng check-in tại sự kiện

#### Online mode

`Check-in App -> API Gateway -> Check-in Module -> Database`

Các bước:
- Nhân sự quét QR.
- Backend xác minh registration hợp lệ.
- Kiểm tra chưa check-in trước đó.
- Ghi check-in thành công.

#### Offline mode

`Check-in App local store -> Sync API -> Check-in Module`

Thiết kế mobile app:
- Lưu cục bộ danh sách check-in pending trong SQLite/local database trên thiết bị.
- Mỗi bản ghi có:
  - local event id
  - timestamp
  - device id
  - QR payload
  - sync status
- Khi có mạng, app gửi batch sync lên backend.

Backend xử lý:
- Dùng idempotency theo `checkin_event_id` hoặc `(registration_id, event_time_bucket, device_id)`.
- Nếu cùng một QR đã được check-in trước đó, backend trả về trạng thái duplicate thay vì lỗi phá sync.

Kết quả:
- Check-in không bị mất dữ liệu khi mất mạng.
- Đồng bộ lại an toàn khi có mạng.

### 3.8 Luồng AI Summary

`Admin Web upload PDF -> Object Storage -> event PDFUploaded -> AI Summary Worker`

Pipeline:
1. Admin upload PDF.
2. Metadata PDF lưu vào database, file lưu object storage.
3. Worker tải PDF về.
4. Tách text.
5. Làm sạch text.
6. Gửi sang AI service để sinh summary.
7. Lưu summary vào database.
8. Workshop detail page đọc summary đã lưu.

Lý do:
- Tác vụ AI chậm và dễ lỗi, không nên chạy trong request admin đồng bộ.
- Nếu AI service lỗi, workshop vẫn được tạo/cập nhật bình thường.

### 3.9 Luồng đồng bộ dữ liệu sinh viên từ CSV

`Scheduler -> Student Sync Module -> import CSV -> staging table -> validation -> merge to main tables`

Quy trình:
1. Job định kỳ phát hiện file CSV mới.
2. Nạp vào `staging table`.
3. Kiểm tra định dạng, số cột, dữ liệu trùng, dữ liệu lỗi.
4. Ghi log import.
5. Merge dữ liệu hợp lệ sang bảng sinh viên chính.
6. Dữ liệu lỗi giữ riêng để review, không làm fail toàn bộ hệ thống.

Thiết kế quan trọng:
- Import chạy ngoài luồng người dùng.
- Dùng staging table để tránh làm bẩn dữ liệu chính.
- Hỗ trợ upsert theo student code.
- Mỗi batch import có version/batch_id để truy vết.

Nếu file CSV lỗi:
- Batch đó bị đánh dấu failed/partial.
- Hệ thống đang chạy và dữ liệu cũ vẫn tiếp tục được dùng.
- Không làm gián đoạn đăng ký workshop.

## 4. Sơ đồ kiến trúc logic

```text
[Student App/Web] ----\
                       \
[Admin Web] ------------> [API Gateway / Load Balancer] ---> [Application Server]
                       /                                        |-- Identity & RBAC
[Check-in Mobile App] -/                                        |-- Workshop Catalog
                                                                |-- Registration
                                                                |-- Payment
                                                                |-- Notification
                                                                |-- Check-in
                                                                |-- AI Summary
                                                                |-- Student Sync
                                                                |-- Reporting
                                                                      |
                                                                      +--> [Primary DB]
                                                                      +--> [Redis Cache]
                                                                      +--> [Message Broker]
                                                                      +--> [Object Storage]
                                                                      +--> [Payment Gateway]
                                                                      +--> [Email Provider]
                                                                      +--> [AI Service]
                                                                      +--> [CSV Import Folder]
```

## 5. Chiến lược xử lý các vấn đề chính

### 5.1 Tranh chấp chỗ ngồi

Giải pháp:
- Mọi thao tác giữ chỗ/xác nhận đăng ký phải qua `Registration Module`.
- Database là nguồn sự thật duy nhất cho seat inventory.
- Dùng transaction + row locking hoặc atomic update.
- Không tin dữ liệu chỗ còn lại từ client.

Ví dụ cách làm:
- Bảng workshop có `remaining_seats`.
- Khi đăng ký:
  - `UPDATE workshops SET remaining_seats = remaining_seats - 1 WHERE workshop_id = ? AND remaining_seats > 0`
  - Nếu số dòng affected = 1 thì giữ được chỗ.
  - Nếu = 0 thì hết chỗ.

Ưu điểm:
- Đơn giản, mạnh, dễ chứng minh tính đúng.

### 5.2 Tải trọng đột biến và công bằng khi mở đăng ký

Giải pháp nhiều lớp:

1. `CDN/cache` cho dữ liệu đọc nhiều.
2. `API Gateway rate limiting`
- Giới hạn request theo user/IP/device.
- Chặn client spam request liên tục.

3. `Virtual waiting room / registration token`
- Khi mở đăng ký, sinh viên lấy một token/slot trước khi vào luồng giữ chỗ.
- Giúp làm phẳng burst traffic.

4. `Queue-based admission control`
- Cho phép chỉ một lượng request đăng ký đồng thời đi vào Registration Module.
- Các request còn lại đứng hàng đợi ngắn thay vì đập thẳng vào DB.

5. `Idempotency key`
- Một sinh viên bấm nhiều lần vẫn chỉ tạo một attempt hợp lệ.

6. `Short-lived cache` cho thông tin workshop
- Giảm số lần query DB không cần thiết.

Lý do:
- Công bằng hơn giữa sinh viên.
- Giảm khả năng backend bị quá tải.
- Bảo vệ database là thành phần nhạy nhất.

### 5.3 Thanh toán không ổn định

Giải pháp:
- Tách Payment Module rõ ràng.
- Workshop browsing không phụ thuộc payment.
- Dùng circuit breaker hoặc timeout khi gọi payment gateway.
- Có retry có kiểm soát cho callback/status check.
- Dùng idempotency key cho payment request.
- Chỗ ngồi chỉ `confirmed` sau khi thanh toán thành công.

Nếu payment gateway lỗi:
- Workshop list/detail vẫn hoạt động.
- Đăng ký miễn phí vẫn hoạt động.
- Đăng ký có phí có thể:
  - tạm không tạo payment mới
  - hoặc đưa vào pending/retry
- Không gây trừ tiền hai lần.

### 5.4 Check-in offline

Giải pháp:
- Mobile app local-first cho check-in.
- Dữ liệu lưu local durable store, không chỉ giữ trong RAM.
- Sync theo batch khi có mạng.
- Backend xử lý duplicate/idempotent.

Nếu mất mạng:
- Nhân sự vẫn check-in được.
- Rủi ro chỉ là việc xác thực realtime bị chậm, nhưng dữ liệu không mất.

### 5.5 Tích hợp một chiều bằng CSV

Giải pháp:
- Đồng bộ theo batch ban đêm.
- Dùng staging + validation + merge.
- Mọi lỗi của batch import bị cô lập trong job import.

Nếu import lỗi:
- Không ảnh hưởng API runtime.
- Dữ liệu sinh viên cũ vẫn dùng được.

## 6. Ảnh hưởng khi từng phần gặp sự cố

Phần này trả lời trực tiếp câu hỏi: khi một phần hỏng thì phần còn lại bị ảnh hưởng ra sao.

### 6.1 API Gateway lỗi

Ảnh hưởng:
- Toàn bộ client khó truy cập hệ thống.

Giảm thiểu:
- Chạy nhiều instance.
- Có health check và load balancer failover.

### 6.2 Database chính lỗi

Ảnh hưởng:
- Hầu hết chức năng cốt lõi dừng: xem dữ liệu động, đăng ký, check-in online, admin update.

Giảm thiểu:
- Replication, backup, monitoring, point-in-time recovery.
- Cache vẫn có thể phục vụ một phần dữ liệu đọc nếu thiết kế read-only fallback.

### 6.3 Redis/cache lỗi

Ảnh hưởng:
- Hệ thống chậm hơn.
- Rate limiting hoặc token bucket có thể giảm hiệu quả nếu phụ thuộc Redis.

Không ảnh hưởng:
- Dữ liệu chính không mất vì source of truth vẫn là database.

### 6.4 Message broker lỗi

Ảnh hưởng:
- Event bất đồng bộ bị chậm:
  - email chậm gửi
  - summary AI chậm cập nhật
  - sync/check-in retry bị trì hoãn

Không ảnh hưởng trực tiếp:
- Xem workshop.
- Đăng ký lõi nếu transaction chính vẫn commit được.

Lưu ý:
- Nên dùng outbox pattern để tránh mất event khi DB commit thành công nhưng publish event thất bại.

### 6.5 Payment gateway lỗi

Ảnh hưởng:
- Chỉ luồng đăng ký có phí bị ảnh hưởng.

Không ảnh hưởng:
- Xem workshop.
- Workshop miễn phí.
- Check-in của workshop đã đăng ký.
- Admin update workshop.

### 6.6 Email provider lỗi

Ảnh hưởng:
- Email xác nhận gửi chậm hoặc thất bại.

Không ảnh hưởng:
- In-app notification.
- Trạng thái đăng ký.
- QR code.

### 6.7 AI service lỗi

Ảnh hưởng:
- Summary không sinh mới hoặc cập nhật chậm.

Không ảnh hưởng:
- Tạo workshop.
- Xem workshop.
- Đăng ký.
- Check-in.

### 6.8 CSV import job lỗi

Ảnh hưởng:
- Dữ liệu sinh viên mới chưa được cập nhật.

Không ảnh hưởng:
- Hệ thống đang chạy với dữ liệu batch trước.

### 6.9 Kết nối mạng ở khu check-in lỗi

Ảnh hưởng:
- Không check-in online realtime được.

Không ảnh hưởng:
- App vẫn ghi nhận offline và sync lại sau.

## 7. Bảo mật và phân quyền

Thiết kế bảo mật đề xuất:

- Authentication tập trung bằng JWT/session token.
- `RBAC` cho 3 nhóm người dùng:
  - `Student`
  - `Organizer`
  - `CheckInStaff`
- Admin routes tách riêng, yêu cầu quyền chặt chẽ.
- Audit log cho các thao tác nhạy cảm:
  - tạo/sửa/hủy workshop
  - đổi phòng/giờ
  - upload PDF
  - check-in thủ công nếu có
- QR code nên chứa token đã ký số hoặc reference id khó đoán, không chứa dữ liệu nhạy cảm thuần văn bản.

## 8. Khả năng mở rộng trong tương lai

Kiến trúc này hỗ trợ mở rộng theo từng bước:

1. Ban đầu:
- Một backend modular monolith.
- Một database chính.
- Một queue.

2. Khi tải tăng:
- Scale ngang API server.
- Tách background workers riêng.
- Tách module Notification, Payment, Check-in Sync thành service riêng nếu cần.

3. Khi cần thêm kênh thông báo:
- Chỉ thêm provider mới trong Notification Module, ví dụ `TelegramProvider`.
- Không cần sửa Registration Module hay Admin Module.

4. Khi cần AI mạnh hơn:
- Thay AI provider mà không đổi phần còn lại của hệ thống, miễn giữ cùng contract.

## 9. Kết luận

Kiến trúc đề xuất cho UniHub Workshop là một `modular monolith` kết hợp `event-driven processing`. Hệ thống gồm ba nhóm client chính, một lớp API Gateway, backend chia module theo domain, database quan hệ làm nguồn dữ liệu chính, cache để giảm tải, message broker cho các tác vụ bất đồng bộ, cùng các tích hợp ngoài như payment, email, AI và CSV import.

Các thành phần giao tiếp theo hai cơ chế:
- đồng bộ cho các thao tác cần phản hồi ngay như xem workshop, đăng ký, check-in online
- bất đồng bộ cho thông báo, AI summary, đồng bộ dữ liệu, retry và các tác vụ chậm

Khi một phần gặp sự cố, kiến trúc này giúp cô lập ảnh hưởng:
- payment hỏng không làm hỏng browsing
- email hỏng không làm mất đăng ký
- AI hỏng không chặn admin tạo workshop
- CSV import lỗi không làm dừng hệ thống runtime
- mất mạng ở điểm check-in không làm mất dữ liệu check-in

Đây là phương án cân bằng tốt giữa tính đúng đắn, khả năng chịu tải, độ an toàn khi tích hợp ngoài, và độ phức tạp triển khai cho một hệ thống workshop quy mô trường đại học.
