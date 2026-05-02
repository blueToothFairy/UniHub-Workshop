# Đặc tả: Check-in tại sự kiện (Offline-first)

## Mô tả

Nhân sự check-in dùng mobile app để quét QR code của sinh viên tại cửa phòng. App phải hoạt động hoàn toàn khi mất mạng — ghi nhận check-in vào local storage và đồng bộ về server khi có mạng trở lại. Không được mất dữ liệu.

---

## Kiến trúc Offline-first trên Mobile

```
Mobile App (React Native)
├── SQLite (expo-sqlite)          ← Local persistent storage
│   ├── checkins (pending/synced)
│   ├── cancelled_registrations   ← Sync từ server để detect invalid QR offline
│   └── sync_log
├── QR Scanner (expo-camera)
├── JWT Verifier (local, no network needed)
└── Background Sync (expo-background-fetch)
```

---

## Luồng chính — Check-in ONLINE

```
[Mobile App]                    [Backend API]           [PostgreSQL]
     │                               │                        │
     │ 1. Quét QR → decode JWT      │                        │
     │    Verify signature locally  │                        │
     │    (server public key cached)│                        │
     │                               │                        │
     │ 2. POST /checkin/scan         │                        │
     │    {qr_token, device_id}      │                        │
     │───────────────────────────── ►│                        │
     │                               │ 3. Verify JWT          │
     │                               │    Check registration  │
     │                               │    status = 'confirmed'│
     │                               │    Check NOT already   │
     │                               │    checked in          │
     │                               │───────────────────────►│
     │                               │    INSERT INTO checkins│
     │                               │    UPDATE registrations│
     │                               │    SET status='attended│
     │                               │◄───────────────────────│
     │◄── 200 {student_name,         │                        │
     │         workshop_title,       │                        │
     │         status: "success"}    │                        │
     │                               │                        │
     │ 4. Hiển thị: ✅ Hợp lệ       │                        │
     │    + Tên sinh viên           │                        │
```

---

## Luồng chính — Check-in OFFLINE

```
[Mobile App]                    [SQLite Local]          [Backend API]
     │                               │                        │
     │ 1. Quét QR → decode JWT       │                        │
     │                               │                        │
     │ 2. Verify JWT signature       │                        │
     │    (offline, dùng cached key) │                        │
     │    → Valid / Invalid          │                        │
     │                               │                        │
     │ [Nếu Invalid JWT]             │                        │
     │ Hiển thị: ❌ QR không hợp lệ  │                        │
     │ (End)                         │                        │
     │                               │                        │
     │ [Nếu Valid JWT]               │                        │
     │ 3. Check SQLite:              │                        │
     │    Trong cancelled_reg table? │                        │
     │───────────────────────────── ►│                        │
     │◄── not found (chưa hủy)      │                        │
     │                               │                        │
     │ 4. Check SQLite:              │                        │
     │    Đã check-in rồi chưa?      │                        │
     │───────────────────────────── ►│                        │
     │◄── not found (chưa check-in) │                        │
     │                               │                        │
     │ 5. INSERT vào SQLite:         │                        │
     │    {registration_id,          │                        │
     │     checked_in_at: now(),     │                        │
     │     status: "pending_sync",   │                        │
     │     device_id}                │                        │
     │───────────────────────────── ►│                        │
     │◄── inserted                   │                        │
     │                               │                        │
     │ 6. Hiển thị: ✅ Hợp lệ       │                        │
     │    (optimistic UI)            │                        │
     │    "Đã ghi nhận (chờ đồng bộ)"│                        │
     │                               │                        │
     │ ═══ [KHI CÓ MẠNG TRỞ LẠI] ══ │                        │
     │                               │                        │
     │ 7. Background Sync triggered  │                        │
     │    SELECT * FROM checkins     │                        │
     │    WHERE status='pending_sync'│                        │
     │───────────────────────────── ►│                        │
     │◄── [{...}, {...}, ...]        │                        │
     │                               │                        │
     │ 8. POST /checkin/sync         │                        │
     │    {records: [{               │                        │
     │      registration_id,         │                        │
     │      checked_in_at,           │                        │
     │      device_id                │                        │
     │    }]}                        │                        │
     │──────────────────────────────────────────────────────► │
     │                               │  9. For each record:   │
     │                               │     INSERT INTO checkins│
     │                               │     ON CONFLICT DO NOTHING│
     │                               │     (idempotent)       │
     │                               │◄───────────────────────│
     │◄── 200 {results: [           │                        │
     │       {id, status: "synced"},  │                        │
     │       {id, status: "already_checked_in"},              │
     │       ...                     │                        │
     │    ]}                         │                        │
     │                               │                        │
     │ 10. UPDATE SQLite:            │                        │
     │     status = "synced" / "conflict"                     │
     │───────────────────────────── ►│                        │
```

---

## Schema SQLite (Local trên Mobile App)

```sql
-- Check-ins pending sync
CREATE TABLE IF NOT EXISTS checkins (
  id              TEXT PRIMARY KEY,  -- local UUID
  registration_id TEXT NOT NULL,
  workshop_id     TEXT NOT NULL,
  student_name    TEXT,              -- cached từ QR JWT
  checked_in_at   TEXT NOT NULL,     -- ISO 8601
  status          TEXT DEFAULT 'pending_sync',
                  -- 'pending_sync' | 'synced' | 'conflict'
  device_id       TEXT NOT NULL,
  sync_result     TEXT               -- JSON kết quả từ server
);

-- Danh sách registration đã bị hủy (sync từ server)
-- Để detect invalid QR offline
CREATE TABLE IF NOT EXISTS cancelled_registrations (
  registration_id TEXT PRIMARY KEY,
  cancelled_at    TEXT NOT NULL,
  synced_at       TEXT NOT NULL
);

-- Log sync
CREATE TABLE IF NOT EXISTS sync_log (
  id          TEXT PRIMARY KEY,
  synced_at   TEXT NOT NULL,
  records_sent INTEGER,
  records_ok  INTEGER,
  records_conflict INTEGER,
  error       TEXT
);
```

---

## Cơ chế đồng bộ danh sách hủy (Cancelled Registrations)

Để mobile app có thể phát hiện QR của sinh viên đã hủy đăng ký ngay cả khi offline:

```
Mỗi lần app có mạng (foreground hoặc background):
GET /checkin/cancelled-since?after={last_sync_timestamp}

Response: {
  cancelled: [
    {registration_id, cancelled_at},
    ...
  ],
  server_time: "2024-..."
}

App lưu vào SQLite cancelled_registrations table.
```

Khi quét QR offline: kiểm tra `registration_id` trong `cancelled_registrations`. Nếu tìm thấy → reject với lý do "Đăng ký đã bị hủy".

---

## Kịch bản lỗi

### E1: QR đã check-in rồi (trùng lặp)

**Online:**
- Server check: đã có record trong `checkins` table với `registration_id` này.
- Trả về 200 với `status: "already_checked_in"` + `checked_in_at`.
- App hiển thị: "⚠️ Đã check-in lúc HH:MM" (màu vàng, không phải lỗi đỏ).

**Offline:**
- SQLite check: tìm thấy trong `checkins` local.
- Hiển thị: "⚠️ Đã check-in (offline ghi nhận lúc HH:MM)".

### E2: QR hết hạn (workshop đã kết thúc)

- JWT `exp` = `workshop.ends_at + 1 hour`.
- Verify JWT → expired.
- Hiển thị: "❌ QR đã hết hạn (workshop đã kết thúc)".

### E3: QR của workshop khác (nhân sự quét nhầm)

- JWT decode: `workshop_id` không khớp với workshop mà nhân sự đang phụ trách.
- App kiểm tra `workshop_id` trong JWT với `workshop_id` được cài trong session của nhân sự.
- Hiển thị: "❌ QR không thuộc workshop này".

### E4: Đồng bộ thất bại (network error khi sync)

- BullMQ retry mechanism: thử lại 3 lần với exponential backoff.
- Nếu vẫn fail: records vẫn ở `pending_sync` trong SQLite.
- Lần sau có mạng: tự động thử lại.
- Không mất data — SQLite là durable storage.

### E5: Conflict khi sync (cùng QR check-in bởi 2 nhân sự khác nhau)

**Tình huống:** Sinh viên dùng QR cho 2 nhân sự ở 2 cửa (corner case).

**Xử lý:**
- Server `INSERT INTO checkins ON CONFLICT (registration_id) DO NOTHING`.
- Record đầu tiên sync về được chấp nhận, các record sau trả về `status: "conflict"`.
- App update SQLite: `status = "conflict"`, log lại để báo cáo.
- Không coi là lỗi nghiêm trọng — `"attended"` là kết quả cuối cùng.

---

## Ràng buộc

- **Durability:** Check-in data không được mất khi app crash hoặc thiết bị mất nguồn — SQLite đảm bảo điều này.
- **Idempotency:** `POST /checkin/sync` phải idempotent — server dùng `ON CONFLICT DO NOTHING`.
- **Batch size:** Mỗi sync request tối đa 100 records để tránh timeout.
- **JWT verification key:** Server public key được cache trong app khi login, refresh khi expired.
- **Offline detection:** Dùng `@react-native-community/netinfo` để detect trạng thái mạng.
- **Background sync:** Dùng `expo-background-fetch` với interval 15 phút khi app ở background.

---

## Tiêu chí chấp nhận

- [ ] Quét QR khi offline: app ghi nhận và hiển thị "Hợp lệ" trong < 500ms.
- [ ] Sau khi có mạng trở lại: tất cả pending check-ins được sync trong vòng 30 giây.
- [ ] Tắt app đột ngột khi có pending check-ins: data vẫn còn sau khi mở lại app.
- [ ] 50 check-ins pending sync cùng lúc: tất cả được xử lý, không timeout.
- [ ] QR của cùng 1 sinh viên quét 2 lần: lần 2 hiển thị "Đã check-in", không tạo record mới.
