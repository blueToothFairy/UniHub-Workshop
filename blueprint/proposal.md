# UniHub Workshop — Project Proposal

## Vấn đề

Trường Đại học A tổ chức "Tuần lễ kỹ năng và nghề nghiệp" với quy mô ngày càng lớn: 5 ngày, 8–12 workshop song song mỗi ngày. Quy trình hiện tại dùng Google Form + email thủ công đang bộc lộ nhiều điểm yếu nghiêm trọng:

- **Không kiểm soát được chỗ ngồi:** Google Form không có cơ chế giới hạn real-time — nhiều sinh viên có thể đăng ký cùng lúc vượt quá sức chứa phòng.
- **Tải trọng không kiểm soát:** Khi mở đăng ký, hàng nghìn sinh viên truy cập đồng thời khiến Form bị lag hoặc ghi nhận sai dữ liệu.
- **Xác thực thủ công:** Ban tổ chức phải đối chiếu danh sách đăng ký thủ công tại cửa phòng — mất thời gian, dễ sai sót, không có bằng chứng điện tử.
- **Thông báo chậm trễ:** Email gửi thủ công, không có kênh thống nhất, sinh viên dễ bỏ lỡ thông tin thay đổi lịch/phòng.
- **Không có thanh toán tích hợp:** Workshop có phí phải thu tiền mặt hoặc chuyển khoản riêng, không có đối soát tự động.
- **Dữ liệu phân tán:** Không có dashboard tổng hợp để ban tổ chức theo dõi tình hình đăng ký theo thời gian thực.

**Hậu quả cụ thể:** Mùa trước có workshop 60 chỗ nhận 200+ đăng ký do Form không giới hạn, dẫn đến tranh cãi tại cửa phòng và mất uy tín tổ chức.

---

## Mục tiêu

| # | Mục tiêu | Chỉ số đo lường |
|---|----------|-----------------|
| 1 | Hỗ trợ đăng ký đồng thời lớn | 12.000 sinh viên trong 10 phút đầu, không mất dữ liệu |
| 2 | Đảm bảo tính nhất quán chỗ ngồi | Zero trường hợp oversell (2 người cùng nhận chỗ cuối) |
| 3 | Check-in nhanh và tin cậy | QR scan < 2 giây, hoạt động offline |
| 4 | Xác thực sinh viên tự động | Tích hợp CSV từ hệ thống cũ, cập nhật hàng đêm |
| 5 | Thông báo đa kênh | App + email ngay sau đăng ký thành công |
| 6 | Thanh toán an toàn | Không double-charge, graceful khi gateway lỗi |
| 7 | Admin tự phục vụ | Ban tổ chức tạo/sửa/hủy workshop không cần IT |
| 8 | AI Summary tự động | Upload PDF → tóm tắt hiển thị trong < 60 giây |

---

## Người dùng và nhu cầu

### Sinh viên (~12.000)
- **Nhu cầu:** Xem lịch workshop dễ hiểu, đăng ký nhanh, nhận xác nhận ngay, check-in không rắc rối.
- **Quan trọng nhất:** Tốc độ đăng ký khi mở slot và sự công bằng (ai đến trước được trước).
- **Điều kiện:** Kết nối mạng không ổn định trong khuôn viên trường.

### Ban tổ chức (~10 người)
- **Nhu cầu:** Tạo/sửa/hủy workshop, xem thống kê real-time, upload tài liệu.
- **Quan trọng nhất:** Dashboard theo dõi tình trạng đăng ký và thao tác không cần IT support.

### Nhân sự check-in (~20–30 người)
- **Nhu cầu:** Quét QR nhanh, biết ngay kết quả (hợp lệ/không hợp lệ/đã check-in).
- **Quan trọng nhất:** Hoạt động ổn định ngay cả khi mạng trường chập chờn.

---

## Phạm vi

### Trong phạm vi
- Web app cho sinh viên và admin (responsive, chạy trên browser)
- Mobile app cho nhân sự check-in (React Native, iOS + Android)
- Backend API (REST)
- Database, message queue, cache
- Tích hợp: email (SMTP), AI summary (Anthropic Claude API hoặc Gemini API free tier), CSV import
- Thanh toán: tích hợp với một payment gateway Việt Nam (VNPay sandbox)
- CI/CD đơn giản với GitHub Actions, deploy lên một VPS nhỏ

### Ngoài phạm vi
- Payment gateway thật (dùng sandbox/mock)
- Hạ tầng production-grade (không dùng Kubernetes, không multi-region)
- Push notification native (dùng in-app notification thay thế)
- Hệ thống quản lý sinh viên gốc (chỉ đọc CSV export)
- Tích hợp Telegram (thiết kế extensible nhưng chưa implement)

---

## Rủi ro và ràng buộc

| Rủi ro | Mức độ | Giải pháp dự kiến |
|--------|--------|-------------------|
| Tranh chấp chỗ ngồi khi đăng ký đồng thời | Cao | Pessimistic locking + atomic decrement trên Redis |
| Tải đột biến 12.000 sinh viên | Cao | Rate limiting (Token Bucket) + queue đăng ký |
| Payment gateway timeout | Trung bình | Circuit Breaker + Idempotency Key |
| Check-in offline mất dữ liệu | Trung bình | Local SQLite + background sync |
| CSV import gây gián đoạn | Thấp | Import vào staging table, swap atomic |
| Chi phí vượt ngân sách sinh viên | Cao | Ưu tiên free tier, self-host tối đa |

### Ràng buộc chi phí (quan trọng)
Toàn bộ hệ thống phải vận hành được với chi phí **< 200.000 VNĐ/tháng** trong môi trường học thuật:
- VPS: Oracle Cloud Free Tier (2 core, 1GB RAM) hoặc Railway/Render free tier
- Database: PostgreSQL self-hosted trên VPS
- Cache: Redis self-hosted (single node, không cluster)
- AI: Gemini API free tier (60 requests/phút) hoặc Claude API với credit sinh viên
- Email: Resend free tier (3.000 email/tháng) hoặc Gmail SMTP
- File storage: Cloudflare R2 free tier (10GB)
