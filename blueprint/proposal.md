# UniHub Workshop — Project Proposal

## Vấn đề
Quy trình quản lý workshop bằng Google Form + xử lý thủ công không còn phù hợp khi quy mô sự kiện tăng lớn và có nhiều luồng nghiệp vụ đồng thời.

Các điểm nghẽn chính:
- Không kiểm soát chỗ theo thời gian thực: khi nhiều sinh viên đăng ký cùng lúc, rất dễ vượt `capacity` hoặc phải chốt danh sách thủ công sau đó.
- Không có cơ chế chống gửi lặp: người dùng retry/refresh có thể tạo dữ liệu trùng hoặc gây tranh chấp trạng thái.
- Không hỗ trợ luồng thanh toán có kiểm soát: khó đảm bảo tính đúng đắn khi callback trễ, timeout, hoặc cổng thanh toán không ổn định.
- Check-in phụ thuộc mạng tại điểm quét: nếu mất kết nối, quy trình bị gián đoạn và có nguy cơ mất dữ liệu attendance.
- Dữ liệu sinh viên phụ thuộc hệ thống cũ không có API: chỉ nhận CSV theo lịch, gây trễ dữ liệu và tăng rủi ro file lỗi/trùng.

Hậu quả cụ thể nếu không thay đổi:
- Ban tổ chức tốn nhiều công sức đối soát thủ công, khó truy vết khi có sự cố.
- Trải nghiệm sinh viên kém trong giờ cao điểm (chờ lâu, trạng thái đăng ký không rõ ràng).
- Nguy cơ sai lệch dữ liệu nghiệp vụ (oversell, thanh toán treo, check-in thiếu) ảnh hưởng trực tiếp đến vận hành sự kiện.

## Mục tiêu
Hệ thống UniHub Workshop hướng tới các mục tiêu vận hành sau:
- Hỗ trợ đăng ký cao điểm với kiểm soát tải và tranh chấp chỗ ngồi an toàn (mục tiêu thiết kế: phục vụ đợt mở đăng ký quy mô lớn, tham chiếu 12.000 sinh viên trong 10 phút đầu).
- Đảm bảo tính đúng đắn dữ liệu đăng ký/thanh toán:
  - Không oversell chỗ ngồi (`confirmed_count <= reserved_count <= capacity`).
  - Không tạo trừ tiền lặp cho cùng một ý định đăng ký (idempotency).
- Hoàn tất luồng workshop có phí từ đăng ký -> thanh toán -> nhận QR check-in một cách nhất quán.
- Cho phép check-in offline tại hiện trường và đồng bộ lại khi có mạng mà không mất bản ghi.
- Tự động hóa nhập dữ liệu sinh viên từ CSV theo lịch, có khả năng chịu lỗi file và ghi nhận outcome rõ ràng.
- Cung cấp công cụ quản trị cho ban tổ chức (dashboard, quản lý workshop, audit log, thông báo).

## Người dùng và nhu cầu
### 1) Sinh viên (`student`)
Nhu cầu:
- Xem danh sách workshop, chi tiết workshop.
- Đăng ký workshop miễn phí/có phí, theo dõi trạng thái thanh toán.
- Nhận mã QR khi đăng ký thành công.
- Nhận thông báo xác nhận và cập nhật liên quan.

Điều quan trọng nhất:
- Tốc độ phản hồi trong giờ cao điểm.
- Trạng thái đăng ký rõ ràng, không mơ hồ khi mạng/chuyển hướng thanh toán gặp sự cố.

### 2) Ban tổ chức (`organizer`)
Nhu cầu:
- Tạo/sửa/hủy workshop, theo dõi thống kê.
- Quản lý tài liệu workshop (upload PDF), xem AI summary.
- Theo dõi audit log và chất lượng vận hành.

Điều quan trọng nhất:
- Tính chính xác dữ liệu nghiệp vụ và khả năng truy vết khi sự cố xảy ra.

### 3) Nhân sự check-in (`checkin_staff`)
Nhu cầu:
- Quét QR nhanh tại hiện trường.
- Vẫn check-in được khi mất mạng.
- Đồng bộ lại an toàn khi kết nối trở lại.

Điều quan trọng nhất:
- Không mất dữ liệu attendance trong điều kiện mạng không ổn định.

## Phạm vi
### Trong phạm vi đồ án
- Ứng dụng web cho sinh viên và ban tổ chức (Next.js).
- API backend (Express + TypeScript) với các module:
  - Auth/RBAC.
  - Workshop read/admin.
  - Registration + payment orchestration.
  - Notification (in-app + email).
  - Check-in scan/sync.
  - CSV import theo lịch.
- Ứng dụng mobile check-in (Expo) với hàng đợi offline SQLite.
- Persistence đa tầng: PostgreSQL (source of truth), Redis (queue/cache/control), Elasticsearch (search).
- Tích hợp MoMo sandbox, Resend email, Gemini summary, Cloudinary lưu trữ PDF.

### Ngoài phạm vi
- Triển khai hạ tầng production-grade đầy đủ (multi-region, autoscaling phức tạp, DR hoàn chỉnh).
- Tích hợp hai chiều hoặc realtime với hệ thống cũ (do không có API từ phía legacy).
- Tích hợp payment production chính thức với đối soát tài chính/hoàn tiền tự động cấp doanh nghiệp.
- Đảm bảo SLA cấp thương mại (99.9%+, observability/incident response đầy đủ như môi trường enterprise).

## Rủi ro và ràng buộc
### Rủi ro kỹ thuật chính
- Tranh chấp chỗ ngồi khi nhiều yêu cầu ghi đồng thời vào cùng workshop.
- Tải đột biến tại thời điểm mở đăng ký gây nghẽn API/DB.
- Cổng thanh toán không ổn định (timeout, callback trễ/mất, trả kết quả mơ hồ).
- Check-in tại khu vực mất mạng kéo dài.
- Chất lượng dữ liệu đầu vào CSV không ổn định (thiếu file, file trùng, file lỗi định dạng).

### Ràng buộc hệ thống
- Ràng buộc tích hợp một chiều: chỉ đọc CSV export theo lịch cố định, không gọi API legacy.
- Ràng buộc vận hành tại sự kiện: check-in phải hoạt động ngay cả khi không có Internet.
- Ràng buộc nhất quán dữ liệu: mọi chuyển trạng thái payment/registration cần idempotent và có khả năng tự phục hồi (reconciliation/expiry).
- Ràng buộc triển khai học thuật: ưu tiên kiến trúc đủ chắc để demo/kịch bản tải cao, nhưng vẫn giữ độ phức tạp phù hợp phạm vi đồ án.
