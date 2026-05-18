# Đặc tả: Check-in tại sự kiện (Offline-first, dùng QR token)

## Mô tả

Nhân sự check-in dùng mobile app để quét QR code của sinh viên tại cửa phòng. App phải hoạt động hoàn toàn khi mất mạng: ghi nhận check-in vào local storage và đồng bộ về server khi có mạng trở lại. Không được mất dữ liệu.

Đặc tả này dùng hướng `qr_token` end-to-end:
- QR chứa JWT do server ký.
- Mobile decode và verify JWT cục bộ để precheck nhanh khi offline.
- Local record vẫn lưu `qr_token` gốc để khi sync server có thể verify lại toàn bộ claims một cách authoritative.

---

## Kiến trúc Offline-first trên Mobile

```text
Mobile App (React Native)
├── SQLite (expo-sqlite)              ← Local persistent storage
│   ├── checkins                      ← Lưu record pending/synced
│   ├── workshops_cache               ← Cache danh sách workshop để staff chọn đúng phòng
│   ├── workshop_roster_cache         ← Cache danh sách đăng ký (roster) theo workshop để verify offline
│   ├── cancelled_registrations       ← Sync từ server để detect invalid QR offline
│   └── sync_log
├── QR Scanner (expo-camera)
├── JWT Verifier (local, no network needed)
├── Selected Workshop State (AsyncStorage) ← Lưu workshop staff đang check-in (chọn 1 lần)
└── Background Sync (expo-background-fetch)
```

---

## Đồng bộ danh sách workshop & roster (để tránh đi nhầm workshop)

### Mục tiêu

- Khi check-in tại cửa phòng, staff **phải chọn đúng workshop** (1 lần) và app **lưu trạng thái** để lần sau mở app vẫn đúng workshop.
- Khi offline, app vẫn có thể:
  - Hiển thị workshop đang check-in (title/time) để staff tự đối chiếu.
  - Verify nhanh QR token có thuộc workshop đã chọn hay không.
  - Hiển thị thông tin sinh viên (name + student_id) nếu có trong cache roster.

### Nguồn dữ liệu

1) **Workshop list** (cho staff chọn):

```text
GET /workshops
Response: { data: { workshops: [{ id, title, startsAt, endsAt, location?, status }], stats: ... } }
```

- Mobile cache vào `workshops_cache`.
- Chỉ cần đủ fields để staff chọn đúng workshop (id + title + thời gian + địa điểm nếu có).

2) **Workshop roster cache** (để verify offline sinh viên thuộc workshop nào + hiển thị thông tin):

```text
GET /checkin/roster?workshop_id={id}&after={last_sync_timestamp?}
Response: {
  data: {
    workshop_id: string,
    server_time: string,
    roster: [
      {
        registration_id: string,
        student_user_id: string,
        student_name: string,
        student_id: string | null,
        registration_status: "confirmed" | "cancelled" | "expired"
      }
    ]
  }
}
```

- Mobile chỉ cần cache **confirmed registrations** (và có thể cache thêm cancelled/expired nếu muốn cảnh báo).
- Khi offline, app dùng roster để:
  - map `registration_id` → `student_name/student_id`
  - verify `registration_id` có nằm trong workshop đã chọn (tránh quét nhầm workshop).

### Trạng thái workshop đang check-in (persist state)

- Mobile lưu `selected_workshop_id` (và optional `selected_workshop_title`, `selected_workshop_synced_at`) trong AsyncStorage.
- UI mặc định hiển thị workshop đã chọn (nếu còn tồn tại trong cache), và cho đổi workshop khi cần.

---

## Luồng chính — Check-in ONLINE

```text
[Mobile App]                    [Backend API]           [PostgreSQL]
  │                                │                        │
  │ 0. Staff chọn workshop         │                        │
  │    (từ workshops_cache)        │                        │
  │    và lưu selected_workshop_id │                        │
  │                                │                        │
  │ 1. Quét QR → lấy qr_token      │                        │
  │    Decode + verify JWT local   │                        │
  │    Check exp                   │                        │
  │    Check token.workshop_id ==  │                        │
  │    selected_workshop_id        │                        │
  │                                │                        │
  │ 2. POST /checkin/scan          │                        │
  │    { qr_token, workshop_id }   │  workshop_id = selected│
  │──────────────────────────────► │                        │
  │                                │ 3. Verify JWT          │
  │                                │    Check registration  │
  │                                │    status = 'confirmed'│
  │                                │    Check NOT already   │
  │                                │    checked in          │
  │                                │───────────────────────►│
  │                                │    INSERT INTO checkins│
  │                                │    ON CONFLICT handle  │
  │                                │◄───────────────────────│
  │◄── 200 { result,               │                        │
  │         registration_id,       │                        │
  │         workshop_id,           │                        │
  │         student_name,          │                        │
  │         student_id,            │                        │
  │         checked_in_at }        │                        │
  │                                │                        │
  │ 4. Hiển thị:                   │                        │
  │    ✅ Checked in               │                        │
  │    hoặc                        │                        │
  │    ⚠️ Already checked in       │                        │
```

---

## Luồng chính — Check-in OFFLINE

```text
[Mobile App]                    [SQLite Local]          [Backend API]
  │                               │                        │
  │ 0. Staff chọn workshop          │                        │
  │    (từ workshops_cache)         │                        │
  │    và lưu selected_workshop_id  │                        │
  │                                 │                        │
  │ 1. Quét QR → lấy qr_token       │                        │
  │    Decode JWT                   │                        │
  │                                 │                        │
  │ 2. Verify JWT signature         │                        │
  │    (offline, dùng cached key)   │                        │
  │    → Valid / Invalid            │                        │
  │                                 │                        │
  │ [Nếu Invalid JWT]               │                        │
  │ Hiển thị: ❌ QR không hợp lệ    │                        │
  │ (End)                           │                        │
  │                                 │                        │
  │ [Nếu Valid JWT]                 │                        │
  │ 3. Check workshop mismatch      │                        │
  │    token.workshop_id            │                        │
  │    == selected_workshop_id ?    │                        │
  │    Nếu mismatch: reject         │                        │
  │    "QR không thuộc workshop này"│                       │
  │                                 │                        │
  │ 4. Check SQLite:                │                        │
  │    Trong cancelled_registrations?                        │
  │──────────────────────────────►│                        │
  │◄── not found                   │                        │
  │                                 │                        │
  │ 5. Check SQLite (roster cache): │                        │
  │    registration_id có trong     │                        │
  │    workshop_roster_cache không? │                        │
  │    → lấy student_name/student_id│                        │
  │    (nếu không có, vẫn lưu qr_token│                       │
  │     để authoritative verify khi sync)                    │
  │                                 │                        │
  │ 6. Check SQLite:                │                        │
  │    registration_id đã check-in  │                        │
  │    local rồi chưa?              │                        │
  │──────────────────────────────►│                        │
  │◄── not found                   │                        │
  │                                 │                        │
  │ 7. INSERT vào SQLite:           │                        │
  │    {                            │                        │
  │      id: local_uuid,            │                        │
  │      device_scan_id,            │                        │
  │      qr_token,                  │                        │
  │      registration_id,           │                        │
  │      workshop_id,               │                        │
  │      student_name,              │                        │
  │      staff_code,                │                        │
  │      checked_in_at: now(),      │                        │
  │      scanned_at_device: now(),  │                        │
  │      status: "pending_sync",    │                        │
  │      device_id                  │                        │
  │    }                            │                        │
  │──────────────────────────────►│                        │
  │◄── inserted                    │                        │
  │                                 │                        │
  │ 8. Hiển thị: ✅ Hợp lệ           │                        │
  │    "Đã ghi nhận (chờ đồng bộ)"  │                        │
  │                                 │                        │
  │ ═══ [KHI CÓ MẠNG TRỞ LẠI] ═══   │                        │
  │                                 │                        │
  │ 9. Background Sync triggered    │                        │
  │    SELECT * FROM checkins       │                        │
  │    WHERE status='pending_sync'  │                        │
  │──────────────────────────────►│                        │
  │◄── [{...}, {...}, ...]         │                        │
  │                                 │                        │
  │ 10. POST /checkin/sync          │                        │
  │    {items: [{                   │                        │
  │      device_id,                 │                        │
  │      device_scan_id,            │                        │
  │      qr_token,                  │                        │
  │      workshop_id,               │                        │
  │      scanned_at_device          │                        │
  │    }]}                          │                        │
  │───────────────────────────────────────────────────────►│
  │                                │ Backend: For each item:│
  │                                │    verify qr_token     │
  │                                │    INSERT attendance   │
  │                                │    ON CONFLICT resolve │
  │                                │◄───────────────────────│
  │◄── 200 {results: [              │                        │
  │      {device_scan_id,           │                        │
  │        result: "checked_in"},   │                        │
  │      {device_scan_id,           │                        │
  │        result: "already_checked_in"},                    │
  │       ...                       │                        │
  │    ]}                           │                        │
  │                                 │                        │
  │ 11. UPDATE SQLite:              │                        │
  │     checked_in  → status=synced                          │
  │     already_checked_in → status=synced                   │
  │     error khác → vẫn pending_sync / log error            │
  │──────────────────────────────►│                        │
```

---

## Schema SQLite (Local trên Mobile App)

```sql
CREATE TABLE IF NOT EXISTS checkins (
  id                TEXT PRIMARY KEY,  -- local UUID
  device_scan_id    TEXT NOT NULL UNIQUE,
  qr_token          TEXT NOT NULL,
  registration_id   TEXT NOT NULL,
  workshop_id       TEXT NOT NULL,
  student_name      TEXT,
  staff_code        TEXT NOT NULL,     -- mã/định danh staff thực hiện check-in (ví dụ: email hoặc employee code)
  checked_in_at     TEXT NOT NULL,     -- ISO 8601, thời điểm ghi nhận trên device
  scanned_at_device TEXT NOT NULL,     -- ISO 8601, dùng cho replay/sync
  status            TEXT DEFAULT 'pending_sync',
                    -- 'pending_sync' | 'synced'
                    -- NOTE: có thể mở rộng thêm 'conflict' cho các case cần nhân sự xử lý thủ công,
                    -- nhưng duplicate (already_checked_in) được coi là settled và set 'synced'.
  device_id         TEXT NOT NULL,
  sync_result       TEXT               -- JSON kết quả gần nhất từ server
);

CREATE INDEX IF NOT EXISTS idx_checkins_status
ON checkins(status);

CREATE INDEX IF NOT EXISTS idx_checkins_registration_id
ON checkins(registration_id);

CREATE TABLE IF NOT EXISTS cancelled_registrations (
  registration_id TEXT PRIMARY KEY,
  cancelled_at    TEXT NOT NULL,
  synced_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_log (
  id               TEXT PRIMARY KEY,
  synced_at        TEXT NOT NULL,
  staff_code       TEXT NOT NULL,
  records_sent     INTEGER,
  records_ok       INTEGER,
  records_conflict INTEGER,
  error            TEXT
);

-- Cache workshop list để staff chọn đúng workshop khi check-in.
CREATE TABLE IF NOT EXISTS workshops_cache (
  workshop_id    TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  starts_at      TEXT,
  ends_at        TEXT,
  location       TEXT,
  status         TEXT,
  synced_at      TEXT NOT NULL
);

-- Cache roster theo workshop để verify offline rằng QR thuộc đúng workshop.
CREATE TABLE IF NOT EXISTS workshop_roster_cache (
  workshop_id      TEXT NOT NULL,
  registration_id  TEXT NOT NULL,
  student_user_id  TEXT NOT NULL,
  student_name     TEXT NOT NULL,
  student_id       TEXT,
  registration_status TEXT NOT NULL,
  synced_at        TEXT NOT NULL,
  PRIMARY KEY (workshop_id, registration_id)
);
```

---

## Cơ chế đồng bộ danh sách hủy (Cancelled Registrations)

Để mobile app có thể phát hiện QR của sinh viên đã hủy đăng ký ngay cả khi offline:

```text
Mỗi lần app có mạng (foreground hoặc background):
GET /checkin/cancelled-since?after={last_sync_timestamp}

Response: {
  cancelled: [
    { registration_id, cancelled_at },
    ...
  ],
  server_time: "2026-..."
}
```

App lưu dữ liệu vào `cancelled_registrations`.

Khi quét QR offline:
- decode `qr_token`
- lấy `registration_id`
- kiểm tra trong `cancelled_registrations`
- nếu tìm thấy thì reject với lý do "Đăng ký đã bị hủy"

---

## Kịch bản lỗi

### E1: QR đã check-in rồi (trùng lặp)

**Online:**
- Server verify `qr_token`, tìm thấy registration đã có attendance.
- Trả về `200` với `result: "already_checked_in"` và `checked_in_at`.
- App hiển thị: "⚠️ Đã check-in lúc HH:MM".

**Offline:**
- App decode `qr_token`, lấy `registration_id`.
- SQLite check: đã có record trong `checkins` local với `registration_id` này.
- Hiển thị: "⚠️ Đã check-in (offline ghi nhận lúc HH:MM)".

### E2: QR hết hạn

- JWT `exp` đã qua hạn.
- Mobile verify local → expired.
- Hiển thị: "❌ QR đã hết hạn".

### E3: QR của workshop khác

- JWT decode ra `workshop_id`.
- `workshop_id` trong token không khớp với workshop context hiện tại của nhân sự.
- Hiển thị: "❌ QR không thuộc workshop này".

### E4: Đồng bộ thất bại (network error khi sync)

- Background sync hoặc foreground sync thử lại tối đa 3 lần với exponential backoff.
- Nếu vẫn fail: record vẫn ở `pending_sync` trong SQLite.
- Lần sau có mạng: tự động thử lại.
- Không mất data, vì SQLite là durable storage.

### E5: Đã check-in trước (duplicate) khi sync

**Tình huống:** Cùng một registration đã được check-in ở thiết bị khác trước khi record pending này sync lên.

**Xử lý:**
- Server verify `qr_token`, sau đó insert attendance với ràng buộc unique theo `registration_id`.
- Nếu registration đã được check-in trước đó, server trả về `result: "already_checked_in"`.
- App update SQLite local record thành `status = "synced"` (đã settled) và lưu `sync_result`.
- Không coi là lỗi nghiêm trọng, vì trạng thái cuối cùng của registration vẫn là đã attended.

### E6: QR không hợp lệ khi sync

- Có thể xảy ra nếu local cache cũ, token bị giả mạo, hoặc lỗi verify phía server.
- Server trả về `result: "invalid_qr"` cùng `error_code`.
- App giữ record để nhân sự hoặc hệ thống điều tra, đồng thời ghi `sync_log`.

---

## Ràng buộc

- **Durability:** Check-in data không được mất khi app crash hoặc thiết bị mất nguồn. SQLite là source of truth cho pending offline check-ins.
- **Idempotency:** `POST /checkin/sync` phải idempotent bằng `device_scan_id` ổn định cho mỗi lần quét offline.
- **Authoritative verification:** Mobile có thể verify local để phản hồi nhanh, nhưng server luôn verify lại `qr_token` khi scan online hoặc sync offline.
- **Batch size:** Mỗi sync request tối đa 100 items để tránh timeout.
- **JWT verification key:** Key verify được cache trong app khi login và refresh khi hết hạn.
- **Offline detection:** Dùng `@react-native-community/netinfo` để detect trạng thái mạng.
- **Background sync:** Dùng `expo-background-fetch` với interval 15 phút khi app ở background.

---

## Tiêu chí chấp nhận

- [ ] Quét QR khi offline: app verify local, ghi nhận vào SQLite, và hiển thị kết quả trong < 500ms.
- [ ] Staff chọn workshop từ danh sách cache; khi scan QR offline, app reject ngay nếu QR không thuộc workshop đã chọn.
- [ ] Sau khi có mạng trở lại: tất cả `pending_sync` check-ins được sync trong vòng 30 giây.
- [ ] Tắt app đột ngột khi có pending check-ins: data vẫn còn sau khi mở lại app.
- [ ] 50 check-ins pending sync cùng lúc: tất cả được xử lý, không timeout.
- [ ] QR của cùng 1 sinh viên quét 2 lần khi offline: lần 2 hiển thị "Đã check-in", không tạo record mới.
- [ ] Server có thể verify lại toàn bộ `qr_token` của mọi offline record trong lúc sync mà không cần tin tưởng hoàn toàn dữ liệu local.
