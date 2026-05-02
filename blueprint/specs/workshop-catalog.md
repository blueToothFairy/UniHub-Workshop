# Đặc tả: Xem danh sách workshop và chỗ trống

## Mô tả

Sinh viên xem danh sách workshop trong tuần lễ, lọc theo ngày hoặc chủ đề, xem thông tin diễn giả, phòng tổ chức, giá vé và số chỗ còn lại theo thời gian gần thực trước khi quyết định đăng ký.

## Luồng chính

1. Sinh viên mở trang danh sách workshop trên web app.
2. Frontend gọi `GET /workshops` với các bộ lọc như ngày, trạng thái, miễn phí hoặc có phí.
3. Backend đọc dữ liệu workshop từ PostgreSQL và kết hợp số chỗ còn lại từ Redis cache hoặc từ bộ đếm đã đồng bộ.
4. Response trả về danh sách workshop kèm metadata: `capacity`, `registered_count`, `remaining_seats`, `price`, `status`.
5. Sinh viên bấm vào một workshop để xem trang chi tiết.
6. Frontend gọi `GET /workshops/:id` để lấy thêm mô tả, AI summary, sơ đồ phòng và trạng thái đăng ký của chính người dùng.

## Kịch bản lỗi

### E1: Redis seat counter tạm thời unavailable

- Backend fallback sang số liệu từ PostgreSQL.
- Response vẫn trả về danh sách workshop, nhưng `remaining_seats` có thể chậm hơn vài giây so với thực tế.

### E2: Workshop vừa hết chỗ trong lúc sinh viên đang xem

- Danh sách vẫn có thể hiển thị `remaining_seats > 0` do dữ liệu cũ trong ngắn hạn.
- Quyết định cuối cùng vẫn thuộc về luồng đăng ký; nếu hết chỗ tại thời điểm submit thì payment/registration flow trả `409`.

### E3: Bộ lọc không hợp lệ

- Backend trả `400 Bad Request` cho các tham số filter sai kiểu hoặc vượt giới hạn cho phép.

## Ràng buộc

- Trang danh sách phải hoạt động kể cả khi payment gateway gặp sự cố.
- Các endpoint xem workshop là read-only, không được phụ thuộc trực tiếp vào queue thông báo hoặc AI worker.
- Dữ liệu hiển thị phải đủ để sinh viên phân biệt workshop miễn phí và workshop có phí.

## Tiêu chí chấp nhận

- [ ] Sinh viên xem được danh sách workshop với số chỗ còn lại.
- [ ] Khi payment gateway lỗi kéo dài, `GET /workshops` vẫn trả `200`.
- [ ] Bộ lọc ngày và loại workshop hoạt động đúng.
- [ ] Trang chi tiết workshop hiển thị được AI summary nếu đã được tạo.
