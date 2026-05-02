# Đặc tả: Quản trị workshop và dashboard nội bộ

## Mô tả

Ban tổ chức sử dụng trang web admin để tạo workshop mới, cập nhật thông tin, đổi phòng, đổi giờ, hủy workshop và theo dõi số lượng đăng ký theo thời gian gần thực. Chức năng này chỉ dành cho người dùng có role `organizer`; sinh viên và nhân sự check-in không được truy cập.

## Luồng chính

1. Organizer đăng nhập vào web app và truy cập `/admin`.
2. Next.js middleware kiểm tra JWT trong cookie và xác nhận role `organizer`.
3. Organizer mở danh sách workshop để xem trạng thái: số chỗ, số đăng ký, trạng thái thanh toán, lịch phòng.
4. Khi tạo workshop mới, frontend gửi `POST /admin/workshops` kèm thông tin tiêu đề, mô tả, sức chứa, diễn giả, phòng, thời gian và giá vé.
5. Backend kiểm tra dữ liệu đầu vào, kiểm tra xung đột lịch phòng và diễn giả.
6. Nếu hợp lệ, backend lưu workshop vào PostgreSQL, ghi `audit_logs`, và trả về workshop vừa tạo.
7. Khi cập nhật hoặc đổi lịch, frontend gọi `PUT /admin/workshops/:id` hoặc endpoint chuyên biệt cho reschedule.
8. Backend kiểm tra workshop có đang bị khóa nghiệp vụ không, kiểm tra sức chứa mới không thấp hơn số đăng ký đã xác nhận, rồi cập nhật dữ liệu.
9. Nếu thay đổi ảnh hưởng đến sinh viên đã đăng ký, backend publish event sang queue thông báo để gửi email và in-app notification bất đồng bộ.
10. Dashboard admin định kỳ gọi `/admin/dashboard/stats` để hiển thị tổng số workshop, số đăng ký, trạng thái thanh toán và check-in.

## Kịch bản lỗi

### E1: Sinh viên hoặc check-in staff truy cập trang admin

- Middleware frontend chặn truy cập và chuyển hướng sang trang `403` hoặc trang chủ.
- Nếu cố gọi API trực tiếp, backend trả `403 Forbidden`.

### E2: Tạo workshop trùng phòng và trùng thời gian

- Backend phát hiện overlap khi kiểm tra lịch.
- Trả `409 Conflict` với thông tin workshop đang chiếm phòng trong khung giờ đó.

### E3: Giảm sức chứa thấp hơn số lượng đã xác nhận

- Backend từ chối cập nhật.
- Trả `400 Bad Request` với thông điệp giải thích rằng sức chứa mới nhỏ hơn số lượng sinh viên đã giữ chỗ hợp lệ.

### E4: Hủy workshop khi queue thông báo đang lỗi

- Trạng thái workshop vẫn được cập nhật thành `cancelled` trong transaction chính.
- Job gửi thông báo được retry bất đồng bộ; lỗi được ghi log để ban tổ chức xử lý tiếp.

### E5: Dashboard bị lỗi tạm thời do truy vấn chậm

- Frontend hiển thị trạng thái stale kèm thời điểm cập nhật gần nhất.
- Người dùng có thể refresh lại mà không ảnh hưởng đến các thao tác CRUD khác.

## Ràng buộc

- Chỉ role `organizer` được phép truy cập toàn bộ `/admin/*`.
- Mọi thao tác tạo, sửa, hủy workshop phải ghi `audit_logs` với `before_state` và `after_state`.
- Dashboard có thể dùng polling 5-10 giây; không bắt buộc WebSocket cho đồ án.
- Các thay đổi ảnh hưởng đến người đã đăng ký phải tách phần gửi thông báo sang queue, không block response chính.

## Tiêu chí chấp nhận

- [ ] Student gọi `GET /admin/dashboard/stats` nhận `403`.
- [ ] Organizer tạo workshop hợp lệ thì dữ liệu được lưu và xuất hiện trên danh sách admin.
- [ ] Workshop trùng phòng, trùng giờ bị từ chối với `409`.
- [ ] Khi reschedule workshop đã có người đăng ký, hệ thống vẫn trả response nhanh và thông báo được xử lý bất đồng bộ.
- [ ] Mọi thao tác create, update, cancel đều có bản ghi trong `audit_logs`.
