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
│   ├── checkins                      ← Lưu record pending/synced/conflict
│   ├── cancelled_registrations       ← Sync từ server để detect invalid QR offline
│   └── sync_log
├── QR Scanner (expo-camera)
├── JWT Verifier (local, no network needed)
└── Background Sync (expo-background-fetch)
```

---

## Luồng chính — Check-in ONLINE

```text
[Mobile App]                    [Backend API]           [PostgreSQL]
     │                               │                        │
     │ 1. Quét QR → lấy qr_token     │                        │
     │    Decode JWT                 │                        │
     │    Verify signature locally   │                        │
     │    Check exp / workshop_id    │                        │
     │                               │                        │
     │ 2. POST /checkin/scan         │                        │
     │    {qr_token, workshop_id?}   │                        │
     │───────────────────────────── ►│                        │
     │                               │ 3. Verify JWT          │
     │                               │    Check registration  │
     │                               │    status = 'confirmed'│
     │                               │    Check NOT already   │
     │                               │    checked in          │
     │                               │───────────────────────►│
     │                               │    INSERT INTO checkins│
     │                               │    ON CONFLICT handle  │
     │                               │◄───────────────────────│
     │◄── 200 {result,               │                        │
     │         registration_id,      │                        │
     │         workshop_id,          │                        │
     │         checked_in_at}        │                        │
     │                               │                        │
     │ 4. Hiển thị:                  │                        │
     │    ✅ Checked in              │                        │
     │    hoặc                       │                        │
     │    ⚠️ Already checked in      │                        │
```

---

## Luồng chính — Check-in OFFLINE

```text
[Mobile App]                    [SQLite Local]          [Backend API]
     │                               │                        │
     │ 1. Quét QR → lấy qr_token      │                        │
     │    Decode JWT                  │                        │
     │                                │                        │
     │ 2. Verify JWT signature        │                        │
     │    (offline, dùng cached key)  │                        │
     │    → Valid / Invalid           │                        │
     │                                │                        │
     │ [Nếu Invalid JWT]              │                        │
     │ Hiển thị: ❌ QR không hợp lệ   │                        │
     │ (End)                          │                        │
     │                                │                        │
     │ [Nếu Valid JWT]                │                        │
     │ 3. Check SQLite:               │                        │
     │    Trong cancelled_registrations?                        │
     │───────────────────────────── ►│                        │
     │◄── not found                  │                        │
     │                                │                        │
     │ 4. Check SQLite:               │                        │
     │    registration_id đã check-in │                        │
     │    local rồi chưa?             │                        │
     │───────────────────────────── ►│                        │
     │◄── not found                  │                        │
     │                                │                        │
     │ 5. INSERT vào SQLite:          │                        │
     │    {                           │                        │
     │      id: local_uuid,           │                        │
     │      device_scan_id,           │                        │
     │      qr_token,                 │                        │
     │      registration_id,          │                        │
     │      workshop_id,              │                        │
     │      student_name,             │                        │
     │      checked_in_at: now(),     │                        │
     │      scanned_at_device: now(), │                        │
     │      status: "pending_sync",   │                        │
     │      device_id                 │                        │
     │    }                           │                        │
     │───────────────────────────── ►│                        │
     │◄── inserted                   │                        │
     │                                │                        │
     │ 6. Hiển thị: ✅ Hợp lệ         │                        │
     │    "Đã ghi nhận (chờ đồng bộ)" │                        │
     │                                │                        │
     │ ═══ [KHI CÓ MẠNG TRỞ LẠI] ═══ │                        │
     │                                │                        │
     │ 7. Background Sync triggered   │                        │
     │    SELECT * FROM checkins      │                        │
     │    WHERE status='pending_sync' │                        │
     │───────────────────────────── ►│                        │
     │◄── [{...}, {...}, ...]        │                        │
     │                                │                        │
     │ 8. POST /checkin/sync          │                        │
     │    {items: [{                  │                        │
     │      device_id,                │                        │
     │      device_scan_id,           │                        │
     │      qr_token,                 │                        │
     │      workshop_id?,             │                        │
     │      scanned_at_device         │                        │
     │    }]}                         │                        │
     │──────────────────────────────────────────────────────► │
     │                                │ 9. For each item:      │
     │                                │    verify qr_token      │
     │                                │    INSERT attendance    │
     │                                │    ON CONFLICT resolve  │
     │                                │◄───────────────────────│
     │◄── 200 {results: [            │                        │
     │       {device_scan_id,         │                        │
     │        result: "checked_in"},  │                        │
     │       {device_scan_id,         │                        │
     │        result: "already_checked_in"},                   │
     │       ...                      │                        │
     │    ]}                          │                        │
     │                                │                        │
     │ 10. UPDATE SQLite:             │                        │
     │     checked_in  → status=synced                         │
     │     already_checked_in → status=conflict                │
     │     error khác → vẫn pending_sync / log error           │
     │───────────────────────────── ►│                        │
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
  checked_in_at     TEXT NOT NULL,     -- ISO 8601, thời điểm ghi nhận trên device
  scanned_at_device TEXT NOT NULL,     -- ISO 8601, dùng cho replay/sync
  status            TEXT DEFAULT 'pending_sync',
                    -- 'pending_sync' | 'synced' | 'conflict'
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
  records_sent     INTEGER,
  records_ok       INTEGER,
  records_conflict INTEGER,
  error            TEXT
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

### E5: Conflict khi sync

**Tình huống:** Cùng một registration đã được check-in ở thiết bị khác trước khi record pending này sync lên.

**Xử lý:**
- Server verify `qr_token`, sau đó insert attendance với ràng buộc unique theo `registration_id`.
- Nếu registration đã được check-in trước đó, server trả về `result: "already_checked_in"`.
- App update SQLite local record thành `status = "conflict"` và lưu `sync_result`.
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
- [ ] Sau khi có mạng trở lại: tất cả `pending_sync` check-ins được sync trong vòng 30 giây.
- [ ] Tắt app đột ngột khi có pending check-ins: data vẫn còn sau khi mở lại app.
- [ ] 50 check-ins pending sync cùng lúc: tất cả được xử lý, không timeout.
- [ ] QR của cùng 1 sinh viên quét 2 lần khi offline: lần 2 hiển thị "Đã check-in", không tạo record mới.
- [ ] Server có thể verify lại toàn bộ `qr_token` của mọi offline record trong lúc sync mà không cần tin tưởng hoàn toàn dữ liệu local.
