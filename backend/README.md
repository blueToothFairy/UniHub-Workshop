# Backend Setup Guide

## Mục tiêu

Thư mục `backend/` hiện là bộ khung Express + TypeScript tối thiểu cho UniHub. Hướng dẫn này giúp bạn:

- cài dependency
- cấu hình biến môi trường
- chạy server local
- build production
- hiểu nhanh cấu trúc thư mục

## Yêu cầu

- Node.js 20 trở lên
- npm 10 trở lên

Kiểm tra nhanh:

```powershell
node -v
npm -v
```

## 1. Cài dependency

Từ root repo:

```powershell
cd backend
npm install
```

## 2. Cấu hình môi trường

Tạo file `.env` từ mẫu:

```powershell
Copy-Item .env.example .env
```

Giá trị mẫu hiện có trong [backend/.env.example](/c:/DiskD/HCMUS/Semester8/SoftwareDesign/Final/UniHub-Workshop/backend/.env.example:1):

```env
PORT=3001
SUPABASE_DB_URL=
UPSTASH_REDIS_URL=
JWT_SECRET=
```

Ở thời điểm hiện tại:

- `PORT` dùng ngay để chạy local server
- `SUPABASE_DB_URL`, `UPSTASH_REDIS_URL`, `JWT_SECRET` là chỗ dành sẵn cho bước implement tiếp theo

Nếu chỉ muốn chạy thử scaffold hiện tại, bạn chỉ cần:

```env
PORT=3001
```

## 3. Chạy local

Chạy development server:

```powershell
npm run dev
```

Server mặc định chạy tại:

```text
http://localhost:3001
```

## 4. Kiểm tra server

### Health check

Mở trình duyệt hoặc gọi:

```text
GET http://localhost:3001/health
```

Kết quả mong đợi:

```json
{
  "status": "ok"
}
```

### Admin dashboard placeholder routes

Hiện backend đã có sẵn các route khung:

- `GET /admin/dashboard/stats`
- `GET /admin/dashboard/payments`
- `GET /admin/dashboard/checkin-today`

Ví dụ kiểm tra bằng PowerShell:

```powershell
Invoke-RestMethod http://localhost:3001/admin/dashboard/stats
Invoke-RestMethod http://localhost:3001/admin/dashboard/payments
Invoke-RestMethod http://localhost:3001/admin/dashboard/checkin-today
```

Các route này hiện trả dữ liệu placeholder từ:

- [admin-dashboard.router.ts](/c:/DiskD/HCMUS/Semester8/SoftwareDesign/Final/UniHub-Workshop/backend/src/modules/admin-dashboard/admin-dashboard.router.ts:1)
- [admin-dashboard.service.ts](/c:/DiskD/HCMUS/Semester8/SoftwareDesign/Final/UniHub-Workshop/backend/src/modules/admin-dashboard/admin-dashboard.service.ts:1)

## 5. Build production

Build TypeScript:

```powershell
npm run build
```

Chạy bản build:

```powershell
npm run start
```

## 6. Chạy test

Script test đã được khai báo:

```powershell
npm test
```

Lưu ý:

- Hiện chưa có file test thực tế
- `vitest` mới được chuẩn bị sẵn trong scaffold

## 7. Cấu trúc hiện tại

```text
backend/
├── migrations/                  # chỗ để raw SQL migrations
├── src/
│   ├── app.ts                   # entrypoint Express
│   ├── modules/
│   │   └── admin-dashboard/     # module mẫu đầu tiên
│   ├── shared/
│   │   ├── errors/
│   │   ├── interfaces/
│   │   └── middleware/
│   └── workers/                 # chỗ để queue workers
├── .env.example
├── package.json
└── tsconfig.json
```

## 8. Luồng mở rộng tiếp theo

Bước hợp lý tiếp theo cho backend:

1. Thêm database layer và repository implementation cho dashboard
2. Thêm middleware `authenticate` và `authorize` thật
3. Viết test cho các route admin dashboard
4. Thêm module `auth`, `workshop`, `notification`, `checkin`
5. Thêm migration SQL trong `migrations/`

## 9. Lưu ý hiện trạng

Backend hiện mới là scaffold, chưa phải bản hoàn chỉnh. Cụ thể:

- chưa kết nối Supabase
- chưa kết nối Upstash Redis
- chưa có JWT auth thật
- chưa có validation request
- chưa có test case
- chưa có error handler tập trung

Nói ngắn gọn: chạy được để làm nền, nhưng chưa phải backend nghiệp vụ hoàn chỉnh.
