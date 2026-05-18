# Đặc tả: AI Summary từ PDF

## Mô tả

Ban tổ chức (admin với role 'organizer') upload file PDF mô tả workshop. Hệ thống tự động extract text, làm sạch và gửi sang AI (Gemini free tier) để tạo bản tóm tắt ngắn gọn, hiển thị trên trang chi tiết workshop cho sinh viên.

---

## Luồng chính

```
[Admin Web]              [Backend API]         [Cloudinary]    [BullMQ]    [Gemini API]
     │                        │                     │              │             │
     │ 1. Upload PDF          │                     │              │             │
     │── POST /workshops/:id  │                     │              │             │
     │   /pdf (multipart)─── ►│                     │              │             │
     │                        │ 2. Validate:        │              │             │
     │                        │    type=PDF         │              │             │
     │                        │    size ≤ 10MB      │              │             │
     │                        │                     │              │             │
     │                        │ 3. Upload to Cloudinary     │              │             │
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
     │                        │─────────────────────────────────►  │             │
     │                        │                     │              │             │
     │◄── 202 Accepted        │                     │              │             │
     │    {status: "processing"}                    │              │             │
     │                        │                     │              │             │
     │                     [ASYNC - BullMQ Worker]                 │             │
     │                        │                     │              │             │
     │                        │              6. Download PDF       │             │
     │                        │◄────────────────────│◄───────────  │             │
     │                        │                     │              │             │
     │                        │              7. Call Gemini API    │             │
     │                        │──────────────────────────────────────────────── ►│
     │                        │              Prompt:               │             │
     │                        │              "You are an Expert Educational Content Analyst. Your task is to analyze the provided workshop document and generate a professional summary.

Please follow these instructions strictly:
1. Language: English.
2. Tone: Professional, engaging, and concise.
3. Content: The summary must cover:
   - Main Topic: What is the workshop about?
   - Target Audience: Who should attend this workshop?
   - Key Highlights: List 3-4 most valuable takeaways or activities.
4. Constraints:
   - Length: Between 150 - 200 words.
   - Do not mention page numbers or administrative details unless relevant to the content.
   - If the document is not a workshop proposal, reply with: "Lỗi: Tài liệu không hợp lệ."

Formatting: Use Markdown for the output with clear headings."         │             │
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

### E1: Gemini API rate limit (15 RPM free tier)

**Xử lý:**
- BullMQ job fail với rate limit error.
- Retry với delay 60 giây.
- Tối đa 3 retries.

### E2: Gemini trả về nội dung không phù hợp

**Xử lý:**
- Không có content moderation phức tạp cho đồ án.
- Admin có thể xem và sửa `ai_summary` thủ công qua trang admin.

---

## Ràng buộc

- **Async hoàn toàn:** Upload PDF → 202 ngay, không chờ AI.
- **Chi phí:** Gemini free tier 15 RPM.
- **File size:** Tối đa 10MB PDF.
- **Fallback:** Nếu AI không tạo được summary, vẫn hiển thị description thủ công của ban tổ chức.

---

## Tiêu chí chấp nhận

- [ ] Upload PDF 5MB: nhận 202 trong < 2 giây.
- [ ] AI summary xuất hiện trên trang workshop trong < 60 giây sau upload.
- [ ] PDF không có text: hiển thị thông báo fallback thay vì crash.
- [ ] Admin có thể xem và override ai_summary bất kỳ lúc nào.
