Dưới đây là thiết kế mình đề xuất cho chức năng Thông báo sau khi đăng ký workshop thành công. Mình sẽ thiết kế bám theo luồng hiện tại của UniHub: khi registration chuyển sang confirmed, hệ thống đã có event RegistrationConfirmed, publish sau DB commit và phải at-most-once theo registration id. Đây là nền rất tốt để xây notification service.

1. Mục tiêu thiết kế

Chức năng cần đảm bảo:

1. Sau khi sinh viên đăng ký thành công, nhận thông báo qua:
   - Web app / in-app notification
   - Email

2. Không làm chậm hoặc phá vỡ luồng đăng ký.
   Registration confirmed rồi thì notification gửi fail cũng không rollback registration.

3. Không gửi trùng thông báo khi:
   - user retry
   - simulation confirm bị gọi lặp
   - callback/payment success bị duplicate
   - worker retry

4. Dễ thêm kênh mới như Telegram, SMS, Zalo trong học kỳ sau.

5. Có khả năng retry khi email provider hoặc notification channel lỗi tạm thời.

Điểm quan trọng: registration/payment không nên gọi trực tiếp email/web notification service. Registration chỉ nên phát ra event RegistrationConfirmed. Notification module sẽ consume event và tự xử lý các kênh. Hiện spec đã yêu cầu event này dùng cho cả free và simulated-paid flow, với payload gồm registration_id, workshop_id, user_id, confirmed_at.

2. Kiến trúc tổng thể

Đề xuất kiến trúc:

Registration / Payment Module
        |
        | 1. DB transaction confirm registration
        | 2. Insert/Publish RegistrationConfirmed after commit
        v
Event Bus / Queue / Outbox
        |
        v
Notification Service
        |
        +--> InAppNotificationChannel
        |
        +--> EmailNotificationChannel
        |
        +--> TelegramNotificationChannel  (future)
        |
        +--> Other channels               (future)

Luồng:

1. Registration chuyển sang confirmed.
2. QR được tạo.
3. DB commit thành công.
4. Emit event RegistrationConfirmed.
5. Notification worker nhận event.
6. Worker tạo notification jobs cho từng channel.
7. Từng channel gửi độc lập.
8. Gửi fail thì retry theo channel, không ảnh hưởng registration.

Thiết kế này phù hợp với decision hiện có: confirmation event phải publish sau commit và dedupe theo registration id.
3. Event đầu vào: RegistrationConfirmed

Event contract nên giữ ổn định:

{
  "event_id": "evt_...",
  "event_type": "RegistrationConfirmed",
  "occurred_at": "2026-05-06T10:00:00Z",
  "payload": {
    "registration_id": "reg_123",
    "workshop_id": "workshop_456",
    "user_id": "user_789",
    "confirmed_at": "2026-05-06T10:00:00Z"
  }
}

Payload tối thiểu đang được spec yêu cầu là:

{
  "registration_id": "string",
  "workshop_id": "string",
  "user_id": "string",
  "confirmed_at": "string"
}

Mình khuyên không nhồi quá nhiều thông tin như workshop title, user email vào event. Notification service nên tự hydrate dữ liệu từ DB khi xử lý event. Lý do:

- Tránh event quá lớn.
- Tránh gửi dữ liệu cũ nếu workshop/user đổi thông tin.
- Dễ thay đổi template mà không đổi event contract.

Tuy nhiên, để tránh N+1 quá nặng, có thể thêm snapshot nhỏ sau này, nhưng MVP chưa cần.

4. Nên dùng Outbox Pattern

Vì bạn có yêu cầu “publish sau DB commit” và “không observable nếu transaction fail”, cách sạch nhất là Outbox Pattern.

Trong transaction confirm registration

Khi registration chuyển sang confirmed, cùng transaction insert:

INSERT INTO outbox_events (
  id,
  event_type,
  aggregate_id,
  payload,
  status,
  created_at
)
VALUES (
  gen_random_uuid(),
  'RegistrationConfirmed',
  :registration_id,
  :payload,
  'pending',
  now()
)
ON CONFLICT DO NOTHING;

Unique constraint:

CREATE UNIQUE INDEX uq_outbox_registration_confirmed
ON outbox_events(event_type, aggregate_id)
WHERE event_type = 'RegistrationConfirmed';

Vì spec yêu cầu duplicate simulation confirmation chỉ publish một event cho registration đó, unique key theo event_type + registration_id là phù hợp.

Outbox worker

Worker chạy định kỳ hoặc consume queue:

1. Lấy outbox_events status = pending.
2. Publish sang queue hoặc gọi NotificationService.handle(event).
3. Nếu thành công: status = published.
4. Nếu fail: retry later.

Query gợi ý:

SELECT *
FROM outbox_events
WHERE status = 'pending'
ORDER BY created_at
LIMIT 100
FOR UPDATE SKIP LOCKED;
5. Notification module nên tách thành 3 lớp
Lớp 1: Event Consumer

Nhận RegistrationConfirmed.

class RegistrationConfirmedConsumer {
  async handle(event: RegistrationConfirmedEvent) {
    await notificationOrchestrator.handleRegistrationConfirmed(event);
  }
}

Nhiệm vụ:

- Validate event.
- Dedupe event.
- Tạo notification deliveries cho các kênh enabled.
Lớp 2: Notification Orchestrator

Quyết định event này cần gửi qua kênh nào.

class NotificationOrchestrator {
  constructor(
    private readonly channelRegistry: NotificationChannelRegistry,
    private readonly templateRenderer: NotificationTemplateRenderer,
    private readonly deliveryRepo: NotificationDeliveryRepository,
  ) {}

  async handleRegistrationConfirmed(event: RegistrationConfirmedEvent) {
    const context = await this.buildContext(event);

    const channels = await this.channelRegistry.getEnabledChannels({
      eventType: 'RegistrationConfirmed',
      userId: event.payload.user_id,
    });

    for (const channel of channels) {
      await this.deliveryRepo.createIfNotExists({
        eventId: event.event_id,
        eventType: event.event_type,
        aggregateId: event.payload.registration_id,
        userId: event.payload.user_id,
        channel: channel.name,
        status: 'pending',
      });
    }
  }
}
Lớp 3: Channel Adapter

Mỗi kênh là một adapter riêng:

interface NotificationChannel {
  name: NotificationChannelName;

  send(input: SendNotificationInput): Promise<SendNotificationResult>;
}

Ví dụ:

class InAppNotificationChannel implements NotificationChannel {
  name = 'in_app';

  async send(input: SendNotificationInput) {
    // Insert/read model for web notification
  }
}

class EmailNotificationChannel implements NotificationChannel {
  name = 'email';

  async send(input: SendNotificationInput) {
    // Send via SMTP/Resend/SendGrid/etc.
  }
}

class TelegramNotificationChannel implements NotificationChannel {
  name = 'telegram';

  async send(input: SendNotificationInput) {
    // Future: call Telegram Bot API
  }
}

Muốn thêm Telegram sau này thì chỉ cần:

1. Thêm TelegramNotificationChannel.
2. Thêm user notification preference / telegram_chat_id nếu cần.
3. Register channel vào registry.
4. Thêm template telegram.

Không cần sửa registration/payment core.