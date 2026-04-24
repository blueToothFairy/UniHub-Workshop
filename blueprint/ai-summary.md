# Đặc tả: AI Summary từ PDF

## Mô tả

Ban tổ chức upload file PDF mô tả workshop. Hệ thống tự động extract text, làm sạch và gửi sang AI (Gemini free tier) để tạo bản tóm tắt ngắn gọn, hiển thị trên trang chi tiết workshop cho sinh viên.

---

## Luồng xử lý

```
[Admin Web]              [Backend API]         [R2 Storage]    [BullMQ]    [Gemini API]
     │                        │                     │              │             │
     │ 1. Upload PDF          │                     │              │             │
     │── POST /workshops/:id  │                     │              │             │
     │   /pdf (multipart)─── ►│                     │              │             │
     │                        │ 2. Validate:        │              │             │
     │                        │    type=PDF         │              │             │
     │                        │    size ≤ 10MB      │              │             │
     │                        │                     │              │             │
     │                        │ 3. Upload to R2     │              │             │
     │                        │────────────────────►│              │             │
     │                        │◄── pdf_url ─────── │              │             │
     │                        │                     │              │             │
     │                        │ 4. UPDATE workshops │              │             │
     │                        │    SET pdf_url=..., │              │             │
     │                        │    ai_summary=null  │              │             │
     │                        │    (reset summary)  │              │             │
     │                        │                     │              │             │
     │                        │ 5. Enqueue job      │              │             │
     │                        │    ai_summary_queue │              │             │
     │                        │─────────────────────────────────► │             │
     │                        │                     │              │             │
     │◄── 202 Accepted        │                     │              │             │
     │    {status: "processing"}                    │              │             │
     │                        │                     │              │             │
     │                     [ASYNC - BullMQ Worker]                 │             │
     │                        │                     │              │             │
     │                        │              6. Download PDF       │             │
     │                        │◄────────────────────│◄─────────── │             │
     │                        │                     │              │             │
     │                        │              7. Extract text       │             │
     │                        │              (pdf-parse library)   │             │
     │                        │              Clean text:           │             │
     │                        │              - Remove headers/footers            │
     │                        │              - Remove page numbers               │
     │                        │              - Normalize whitespace              │
     │                        │              Truncate: max 8000 tokens            │
     │                        │                     │              │             │
     │                        │              8. Call Gemini API    │             │
     │                        │──────────────────────────────────────────────── ►│
     │                        │              Prompt:               │             │
     │                        │              "Tóm tắt tài liệu     │             │
     │                        │              workshop này trong     │             │
     │                        │              150-200 từ tiếng Việt, │             │
     │                        │              nêu rõ: chủ đề chính,  │             │
     │                        │              đối tượng phù hợp,    │             │
     │                        │              điểm nổi bật."         │             │
     │                        │◄──── {summary text} ────────────────────────── │
     │                        │                     │              │             │
     │                        │              9. UPDATE workshops   │             │
     │                        │              SET ai_summary=...,   │             │
     │                        │              summary_generated_at=NOW()          │
     │                        │                     │              │             │
     │ [Admin/Student xem]    │                     │              │             │
     │── GET /workshops/:id ─►│                     │              │             │
     │◄── {ai_summary: "..."}─│                     │              │             │
```

---

## Kịch bản lỗi

### E1: PDF không extract được text (scanned image PDF)

**Xử lý:**
- `pdf-parse` trả về text rỗng.
- UPDATE workshops SET ai_summary = 'Không thể tạo tóm tắt tự động từ file PDF này. Vui lòng nhập mô tả thủ công.'
- Log cảnh báo cho admin.

### E2: Gemini API rate limit (60 RPM free tier)

**Xử lý:**
- BullMQ job fail với rate limit error.
- Retry với delay 60 giây.
- Tối đa 3 retries.

### E3: PDF quá dài (vượt context window)

**Xử lý:**
- Extract text xong: truncate ở 8.000 tokens (~32.000 ký tự).
- Thêm ghi chú vào prompt: "Đây là phần đầu của tài liệu. Tóm tắt dựa trên nội dung này."

### E4: Gemini trả về nội dung không phù hợp

**Xử lý:**
- Không có content moderation phức tạp cho đồ án.
- Admin có thể xem và sửa `ai_summary` thủ công qua trang admin.

---

## Ràng buộc

- **Async hoàn toàn:** Upload PDF → 202 ngay, không chờ AI.
- **Chi phí:** Gemini free tier 60 RPM, 1.5M tokens/ngày — đủ cho đồ án.
- **File size:** Tối đa 10MB PDF.
- **Fallback:** Nếu AI không tạo được summary, vẫn hiển thị description thủ công của ban tổ chức.

---

## Tiêu chí chấp nhận

- [ ] Upload PDF 5MB: nhận 202 trong < 2 giây.
- [ ] AI summary xuất hiện trên trang workshop trong < 60 giây sau upload.
- [ ] PDF không có text: hiển thị thông báo fallback thay vì crash.
- [ ] Admin có thể xem và override ai_summary bất kỳ lúc nào.
