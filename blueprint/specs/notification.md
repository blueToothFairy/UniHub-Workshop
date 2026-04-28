# Đặc tả: Hệ thống Thông báo (Extensible)

## Mô tả

Gửi thông báo đến sinh viên qua nhiều kênh sau các sự kiện quan trọng (đăng ký thành công, workshop bị hủy, nhắc nhở sắp diễn ra). Hệ thống được thiết kế theo **Strategy Pattern** để dễ bổ sung kênh mới (Telegram, Zalo) mà không sửa business logic.

---

## Luồng chính

```
Express Request Handler
  │
  ├── RegistrationService.create()
  │   └── Registration saved successfully
  │
  ├── Enqueue vào Bull: notification_queue
  │   └── Job: { type: 'registration_confirmed', user_id, registration_id }
  │
  └── Return response to client immediately
  

Bull Worker (async, separate process):
  │
  ├── Dequeue job
  │
  ├── Resolve channels (Email + In-App by default)
  │
  └── Execute channel handlers:
        ├── EmailChannel.send()    → Resend API
        ├── AppChannel.send()      → INSERT app_notifications
        └── TelegramChannel.send() → Telegram Bot API (future)
```

**Pattern:** Producer/Consumer via Bull Queue (NOT pub/sub)
- Producer (registration handler) enqueues job
- Consumer (Bull worker) processes job
- Retry logic built-in: fails → retry up to 3 times with exponential backoff

### Interface (mở rộng dễ dàng)

```javascript
// Base interface
class NotificationChannel {
  name = '';
  async send(notification) {
    throw new Error('Must implement send()');
  }
}

// Email channel (built-in)
class EmailChannel extends NotificationChannel {
  name = 'email';
  async send(notification) {
    const { user, subject, body, html } = notification;
    await resend.emails.send({
      from: 'noreply@unihub.edu.vn',
      to: user.email,
      subject,
      html
    });
  }
}

// App notification channel (built-in)
class AppChannel extends NotificationChannel {
  name = 'app';
  async send(notification) {
    const { user, title, body } = notification;
    await db.query(
      'INSERT INTO app_notifications (user_id, title, body, type) VALUES ($1, $2, $3, $4)',
      [user.id, title, body, notification.type]
    );
  }
}

// Telegram channel (future - thêm mà không sửa code cũ)
class TelegramChannel extends NotificationChannel {
  name = 'telegram';
  async send(notification) {
    const { user, body } = notification;
    if (!user.telegram_id) return; // Skip if user chưa connect Telegram
    await telegramBot.sendMessage(user.telegram_id, body);
  }
}

// Channel registry
const channels = {
  email: new EmailChannel(),
  app: new AppChannel(),
  // telegram: new TelegramChannel(), // uncomment to enable
};
```

### Bull Queue Setup

```javascript
// src/queues/notificationQueue.js
const Queue = require('bull');
const redis = require('redis');

const notificationQueue = new Queue('notifications', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379
  }
});

// Worker: xử lý từng job
notificationQueue.process(async (job) => {
  const { type, user_id, data } = job.data;
  
  // Build notification object
  const notification = buildNotification(type, user_id, data);
  
  // Execute channel handlers
  for (const channel of notification.channels) {
    try {
      await channels[channel].send(notification);
    } catch (err) {
      console.error(`[Notification] ${channel} failed:`, err);
      throw err; // Bull sẽ retry
    }
  }
  
  // Log success
  await db.query(
    'INSERT INTO notification_logs (user_id, channel, type, status) VALUES ($1, $2, $3, $4)',
    [user_id, notification.channels.join(','), type, 'sent']
  );
});

// Retry config: 3 times, exponential backoff
notificationQueue.on('failed', (job, err) => {
  console.error(`Job ${job.id} failed:`, err);
});

module.exports = notificationQueue;
```

### Sử dụng trong registration route

```javascript
// src/routes/registrations.js
const express = require('express');
const notificationQueue = require('../queues/notificationQueue');
const db = require('../db/pool');

router.post('/registrations', authMiddleware, async (req, res) => {
  const { workshop_id } = req.body;
  const user = req.user;
  
  try {
    // 1. Create registration
    const registration = await createRegistration(workshop_id, user.id);
    
    // 2. Enqueue notification (non-blocking)
    await notificationQueue.add({
      type: 'registration_confirmed',
      user_id: user.id,
      data: {
        registration_id: registration.id,
        workshop_id,
        qr_code: registration.qr_code
      }
    }, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000 // 2s, 5s, 30s
      },
      removeOnComplete: true
    });
    
    // 3. Return to client immediately
    res.status(201).json({
      registration_id: registration.id,
      qr_code: registration.qr_code
    });
    
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

---

## Kịch bản lỗi

### E1: Email provider timeout hoac fail tam thoi

- Worker ghi nhan job that bai va de Bull retry toi da 3 lan voi exponential backoff.
- API dang ky van tra response thanh cong vi thong bao chay bat dong bo.

### E2: Kenh thong bao moi duoc bat nhung nguoi dung chua lien ket tai khoan

- Channel handler bo qua nguoi dung khong du dieu kien, ghi log canh bao.
- Cac kenh con lai van gui binh thuong, khong lam fail ca job.

### E3: Notification log ghi DB that bai sau khi gui thanh cong

- Worker retry buoc ghi log.
- Neu van that bai sau retry, he thong canh bao qua monitoring nhung khong gui lai thong bao de tranh duplicate.

## Các loại thông báo

| Event | Kênh | Nội dung |
|-------|------|---------|
| Đăng ký thành công (free) | Email + App | Xác nhận + QR code |
| Đăng ký thành công (paid) | Email + App | Xác nhận + QR code + receipt |
| Workshop bị hủy | Email + App | Thông báo hủy + lý do |
| Workshop đổi phòng/giờ | Email + App | Thông tin mới |
| Nhắc nhở (1 ngày trước) | App | "Workshop X diễn ra ngày mai" |
| Thanh toán thất bại | Email + App | "Thanh toán thất bại, vui lòng thử lại" |

---

## Ràng buộc

- **Async:** Tất cả thông báo qua BullMQ queue — không block response chính.
- **Retry:** 3 lần với exponential backoff (1s, 5s, 30s) khi fail.
- **Log:** Mọi notification được log vào `notification_logs` table (audit trail).
- **Extensible:** Thêm kênh Telegram: implement `NotificationChannel`, register vào DI container, không cần sửa `NotificationService`.

---

## Tiêu chí chấp nhận

- [ ] Email xác nhận gửi trong < 30 giây sau đăng ký thành công.
- [ ] App notification hiển thị trong < 5 giây (polling mỗi 10s hoặc WebSocket).
- [ ] Khi Resend API fail: retry 3 lần, sau đó log lỗi và tiếp tục (không crash).
- [ ] Thêm TelegramChannel: chỉ cần tạo class mới, không sửa file nào khác.
