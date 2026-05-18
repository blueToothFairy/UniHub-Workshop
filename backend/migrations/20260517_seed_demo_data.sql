-- Seed/demo data for local/dev environments
-- Run after running migrations. Idempotent: uses ON CONFLICT DO NOTHING.

BEGIN;

-- Users
INSERT INTO users (id, email, full_name, role, student_id, password_hash, created_at, updated_at)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'organizer@example.com', 'Organizer One', 'organizer', NULL, 'seed-hash', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, email, full_name, role, student_id, password_hash, created_at, updated_at)
VALUES
  ('22222222-2222-2222-2222-222222222222', 'student1@example.com', 'Student One', 'student', 'S123456', 'seed-hash', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, email, full_name, role, password_hash, created_at, updated_at)
VALUES
  ('33333333-3333-3333-3333-333333333333', 'checkin1@example.com', 'Checkin Staff', 'checkin_staff', 'seed-hash', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Workshops
INSERT INTO workshops (id, title, description, speaker_name, room, starts_at, ends_at, capacity, confirmed_registrations, reserved_count, confirmed_count, price_vnd, payment_required, status, created_at, updated_at)
VALUES
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'Intro to RAG',
    'Hands-on intro to Retrieval-Augmented Generation (RAG).',
    'Dr. Example',
    'Room A',
    '2026-06-01 10:00:00+07',
    '2026-06-01 12:00:00+07',
    100,
    1,
    1,
    1,
    200000,
    true,
    'published',
    NOW(), NOW()
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO workshops (id, title, description, speaker_name, room, starts_at, ends_at, capacity, confirmed_registrations, reserved_count, confirmed_count, price_vnd, payment_required, status, created_at, updated_at)
VALUES
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'Open Data Workshop',
    'Workshop about open data and tooling.',
    'Prof. Demo',
    'Room B',
    '2026-06-02 15:00:00+07',
    '2026-06-02 17:00:00+07',
    50,
    1,
    1,
    1,
    0,
    false,
    'published',
    NOW(), NOW()
  )
ON CONFLICT (id) DO NOTHING;

-- Registrations
INSERT INTO registrations (id, user_id, workshop_id, status, confirmed_at, created_at, updated_at)
VALUES
  ('99999999-9999-9999-9999-999999999999','22222222-2222-2222-2222-222222222222','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','confirmed', NOW(), NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO registrations (id, user_id, workshop_id, status, confirmed_at, created_at, updated_at)
VALUES
  ('88888888-8888-8888-8888-888888888888','22222222-2222-2222-2222-222222222222','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','confirmed', NOW(), NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Payments (simulation)
INSERT INTO payments (id, registration_id, user_id, workshop_id, idempotency_key, request_hash, merchant_order_id, gateway, amount_vnd, currency, status, paid_at, created_at, updated_at)
VALUES
  ('77777777-7777-7777-7777-777777777777','99999999-9999-9999-9999-999999999999','22222222-2222-2222-2222-222222222222','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','seed-pay-1','seed-req-1','seed-order-1','simulation',200000,'VND','completed', NOW(), NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Workshop check-in for the free workshop
INSERT INTO workshop_checkins (id, registration_id, workshop_id, user_id, checked_in_by, source, checked_in_at, created_at, updated_at)
VALUES
  ('66666666-6666-6666-6666-666666666666','88888888-8888-8888-8888-888888888888','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','online_scan', NOW(), NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Notification delivery example
INSERT INTO notification_deliveries (id, event_id, event_type, registration_id, workshop_id, user_id, channel, status, attempt_count, created_at, updated_at, sent_at)
VALUES
  ('55555555-5555-5555-5555-555555555555', 'evt-1', 'registration_confirmed','99999999-9999-9999-9999-999999999999','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222','email','sent',1,NOW(),NOW(),NOW())
ON CONFLICT (id) DO NOTHING;

-- In-app notification
INSERT INTO app_notifications (id, user_id, title, body, type, is_read, created_at)
VALUES
  ('44444444-4444-4444-4444-444444444444','22222222-2222-2222-2222-222222222222','Registration confirmed','Your registration for "Intro to RAG" is confirmed.','registration', false, NOW())
ON CONFLICT (id) DO NOTHING;

-- Optional: an audit log entry for the registration
INSERT INTO audit_logs (id, actor_user_id, action, target_type, target_id, after_state, created_at)
VALUES
  ('33333333-1111-2222-3333-444444444444','11111111-1111-1111-1111-111111111111','create_registration','registration','99999999-9999-9999-9999-999999999999', to_jsonb(row('22222222-2222-2222-2222-222222222222','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')::record), NOW())
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- Notes:
-- Run this file with psql: psql -d yourdb -f backend/migrations/20260517_seed_demo_data.sql
