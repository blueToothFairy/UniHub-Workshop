# Chỉ mục Specs

Thư mục này chứa các đặc tả tính năng theo đúng cấu trúc `blueprint/specs/` trong đề bài.

- `auth.md`: xác thực và phân quyền
- `payment.md`: đăng ký workshop có phí, seat allocation, payment callback, idempotency
- `workshop-catalog.md`: xem danh sách workshop và số chỗ còn lại theo thời gian thực
- `admin.md`: quản trị workshop và dashboard nội bộ
- `notification.md`: thông báo email và in-app, mở rộng thêm kênh mới
- `checkin.md`: check-in offline-first trên mobile và đồng bộ lại
- `ai-summary.md`: upload PDF và tạo tóm tắt bằng AI
- `csv-import.md`: đồng bộ dữ liệu sinh viên từ CSV ban đêm

Ánh xạ với đề bài:

- Xem và đăng ký workshop: `workshop-catalog.md` + `payment.md`
- Thông báo: `notification.md`
- Quản trị: `admin.md`
- Check-in tại sự kiện: `checkin.md`
- AI Summary: `ai-summary.md`
- Đồng bộ dữ liệu sinh viên: `csv-import.md`
