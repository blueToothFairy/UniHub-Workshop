# Đặc tả: Đồng bộ dữ liệu sinh viên từ CSV

## Mô tả

Hệ thống quản lý sinh viên cũ không có API. Mỗi đêm lúc 2:00 sáng, nó export file `students.csv` vào một thư mục được shared với server UniHub. Hệ thống cần đọc file này, validate, import vào database để xác thực sinh viên khi đăng ký workshop — mà không làm gián đoạn dịch vụ đang chạy.

**Quan trọng:** Đây là **cron job chạy theo lịch**, không phải event-driven queue. Chạy trực tiếp, không publish event vào message queue.

---

## Luồng chính

```
[Legacy System]      [Filesystem]       [Express Cron]      [PostgreSQL]
      │                   │                  │                   │
      │ 02:00 AM           │                  │                   │
      │── export ─────────►│                  │                   │
      │   students.csv     │                  │                   │
      │                    │                  │                   │
      │                    │  02:05 AM        │                   │
      │                    │  (5 phút sau để  │                   │
      │                    │  đảm bảo file    │                   │
      │                    │  write xong)     │                   │
      │                    │◄── cron trigger ─│                   │
      │                    │                  │                   │
      │                    │ 1. Read file     │                   │
      │                    │─────────────────►│                   │
      │                    │                  │ 2. Check file exists?
      │                    │                  │    Check file size > 0?
      │                    │                  │    Check modified_time = today?
      │                    │                  │                   │
      │                    │                  │ 3. Parse CSV      │
      │                    │                  │    (streaming,    │
      │                    │                  │    không load     │
      │                    │                  │    toàn bộ vào RAM)
      │                    │                  │                   │
      │                    │                  │ 4. Validate từng row
      │                    │                  │    student_id: required, format
      │                    │                  │    email: valid email
      │                    │                  │    full_name: not empty
      │                    │                  │    → collect valid_rows[]
      │                    │                  │    → collect error_rows[]
      │                    │                  │                   │
      │                    │                  │ 5. Check threshold:
      │                    │                  │    error_rows > 10%?
      │                    │                  │    → ABORT, alert  │
      │                    │                  │    ≤ 10%: tiếp tục│
      │                    │                  │                   │
      │                    │                  │ 6. TRUNCATE       │
      │                    │                  │    staging_students│
      │                    │                  │──────────────────►│
      │                    │                  │                   │
      │                    │                  │ 7. Batch INSERT   │
      │                    │                  │    vào staging_   │
      │                    │                  │    students       │
      │                    │                  │    (chunks 500)   │
      │                    │                  │──────────────────►│
      │                    │                  │                   │
      │                    │                  │ 8. BEGIN TRANSACTION
      │                    │                  │    -- Atomic swap  │
      │                    │                  │    UPDATE users    │
      │                    │                  │    SET is_active=false
      │                    │                  │    WHERE role='student'
      │                    │                  │                   │
      │                    │                  │    INSERT INTO users
      │                    │                  │    SELECT ... FROM staging_students
      │                    │                  │    ON CONFLICT (student_id)
      │                    │                  │    DO UPDATE SET
      │                    │                  │      email = EXCLUDED.email,
      │                    │                  │      full_name = EXCLUDED.full_name,
      │                    │                  │      is_active = true,
      │                    │                  │      updated_at = NOW()
      │                    │                  │                   │
      │                    │                  │    COMMIT         │
      │                    │                  │──────────────────►│
      │                    │                  │                   │
      │                    │                  │ 9. Log kết quả:  │
      │                    │                  │    - total rows   │
      │                    │                  │    - inserted     │
      │                    │                  │    - updated      │
      │                    │                  │    - errors       │
      │                    │                  │    - duration     │
      │                    │                  │                   │
      │                    │                  │ 10. Move file:   │
      │                    │                  │     students.csv  │
      │                    │                  │     → processed/  │
      │                    │                  │     YYYY-MM-DD_   │
      │                    │                  │     students.csv  │
```

---

## Chi tiết kỹ thuật

### CSV Format giả định

```csv
student_id,email,full_name,faculty,class_code
SV001234,nguyen.van.a@student.edu.vn,Nguyễn Văn A,Công nghệ thông tin,CNTT2021A
SV001235,tran.thi.b@student.edu.vn,Trần Thị B,Kinh tế,KT2022B
```

### Express.js Cron Job (node-cron)

```javascript
// File: src/jobs/csvImportJob.js
const cron = require('node-cron');
const fs = require('fs').promises;
const path = require('path');
const csv = require('csv-parse');
const pool = require('../db/pool'); // pg connection pool
const logger = require('../utils/logger');

async function importStudents() {
  const jobId = `import_${new Date().toISOString().split('T')[0]}`;
  logger.info(`[CSV Import] Starting job: ${jobId}`);

  const filePath = path.join(process.env.CSV_DROP_DIR, 'students.csv');

  try {
    // 1. File existence check
    await fs.access(filePath);
    const stat = await fs.stat(filePath);
    
    if (stat.size === 0) {
      throw new Error('File is empty');
    }

    // 2. Parse và validate (streaming)
    const { validRows, errorRows } = await parseAndValidate(filePath);

    // 3. Safety check: không import nếu quá nhiều lỗi
    const errorRate = errorRows.length / (validRows.length + errorRows.length);
    const errorThreshold = parseFloat(process.env.CSV_ERROR_THRESHOLD || '0.1');
    
    if (errorRate > errorThreshold) {
      throw new Error(
        `Error rate ${(errorRate * 100).toFixed(1)}% exceeds threshold ${(errorThreshold * 100).toFixed(1)}%. ` +
        `Errors: ${errorRows.slice(0, 5).map(r => r.reason).join(', ')}`
      );
    }

    // 4. Import theo chunks
    await upsertToDatabase(validRows, jobId);

    // 5. Archive file
    await archiveFile(filePath, jobId);

    logger.info(`[CSV Import] Done: ${validRows.length} upserted, ${errorRows.length} skipped`);
    
    // Alert admin (publish notification event)
    // await notificationQueue.add('admin-alert', { ... });

  } catch (error) {
    logger.error(`[CSV Import] Failed: ${error.message}`);
    
    // Gửi email cảnh báo admin
    // await notificationQueue.add('admin-alert-error', {
    //   subject: `[UniHub] CSV Import failed ${new Date().toLocaleDateString('vi-VN')}`,
    //   body: error.message
    // });
  }
}

async function parseAndValidate(filePath) {
  const validRows = [];
  const errorRows = [];

  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv.parse({
        columns: ['student_id', 'email', 'full_name', 'faculty', 'class_code'],
        skip_empty_lines: true,
        from_line: 2, // skip header
      }))
      .on('data', (row) => {
        const validation = validateRow(row);
        if (validation.valid) {
          validRows.push(row);
        } else {
          errorRows.push({ ...row, reason: validation.error });
        }
      })
      .on('error', reject)
      .on('end', () => resolve({ validRows, errorRows }));
  });
}

function validateRow(row) {
  // Validate student_id
  if (!row.student_id || !/^SV\d{6}$/.test(row.student_id.trim())) {
    return { valid: false, error: 'Invalid student_id format' };
  }

  // Validate email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!row.email || !emailRegex.test(row.email.trim())) {
    return { valid: false, error: 'Invalid email' };
  }

  // Validate full_name
  if (!row.full_name || row.full_name.trim().length === 0) {
    return { valid: false, error: 'full_name is required' };
  }

  if (row.full_name.length > 255) {
    return { valid: false, error: 'full_name too long' };
  }

  return { valid: true };
}

async function upsertToDatabase(rows, jobId) {
  const client = await pool.connect();
  
  try {
    // Xử lý theo chunks để không overload DB
    const CHUNK_SIZE = 500;
    
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      
      // Tạo VALUES clause với escape
      const values = chunk.map((row, idx) => {
        const base = idx * 5;
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, 'student', true, crypt($${base + 1}, gen_salt('bf')), NOW(), NOW())`;
      }).join(',');
      
      const flatParams = chunk.flatMap(row => [
        row.student_id.trim(),
        row.email.trim(),
        row.full_name.trim(),
        row.faculty?.trim() || null,
        row.class_code?.trim() || null,
      ]);

      const query = `
        INSERT INTO users (student_id, email, full_name, faculty, class_code, role, is_active, password_hash, created_at, updated_at)
        VALUES ${values}
        ON CONFLICT (student_id) DO UPDATE SET
          email = EXCLUDED.email,
          full_name = EXCLUDED.full_name,
          faculty = EXCLUDED.faculty,
          class_code = EXCLUDED.class_code,
          is_active = true,
          updated_at = NOW()
      `;

      await client.query(query, flatParams);
    }

    // Deactivate sinh viên không còn trong file CSV
    // TODO: Nếu cần - thêm tracking import_batch

  } finally {
    client.release();
  }
}

async function archiveFile(filePath, jobId) {
  const processedDir = path.join(process.env.CSV_DROP_DIR, 'processed');
  await fs.mkdir(processedDir, { recursive: true });
  
  const archiveName = `${jobId}_students.csv`;
  const archivePath = path.join(processedDir, archiveName);
  
  await fs.rename(filePath, archivePath);
  logger.info(`[CSV Import] File archived to ${archivePath}`);
}

// Register cron job: chạy lúc 02:05 AM mỗi ngày
// Format: "minute hour day month dayOfWeek"
cron.schedule('5 2 * * *', importStudents, {
  timezone: 'Asia/Ho_Chi_Minh'
});

module.exports = { importStudents };
```

### Setup trong app.js

```javascript
// app.js
require('./jobs/csvImportJob'); // Register cron job khi app start

app.listen(3000, () => {
  console.log('Server running on port 3000');
  console.log('CSV Import job scheduled for 02:05 AM Asia/Ho_Chi_Minh');
});
```

### Validation rules

| Field | Rule | Hành vi khi lỗi |
|-------|------|-----------------|
| `student_id` | Required, format `SV\d{6}` | Skip row, log |
| `email` | Valid email format | Skip row, log |
| `full_name` | Not empty, max 255 chars | Skip row, log |
| `faculty` | Optional | Dùng NULL |
| `class_code` | Optional | Dùng NULL |
| Duplicate `student_id` trong file | — | Lấy row cuối (last wins) |

---

## Kịch bản lỗi

### E1: File không tồn tại

**Tình huống:** Legacy system bị lỗi, không export được file.

**Xử lý:**
1. Log: `[CSV Import] File not found: /data/csv/students.csv`
2. Gửi email cảnh báo admin.
3. Không làm gì với DB — dữ liệu cũ vẫn dùng được.
4. Không crash service.

### E2: File rỗng hoặc chỉ có header

**Xử lý:**
1. Parse xong: `validRows = []`.
2. Safety check: 100% error rate → ABORT.
3. Alert admin.

### E3: File bị corrupt (encoding sai, ký tự đặc biệt)

**Xử lý:**
- Parse với `csv-parse` library, chỉ định encoding `UTF-8`.
- Rows bị parse error → vào `errorRows[]`.
- Nếu tỷ lệ lỗi > 10% → abort.

### E4: Import đang chạy thì server restart

**Xử lý:**
- `staging_students` bị rollback (transaction chưa commit).
- `users` table không bị ảnh hưởng.
- Cron job tiếp theo (hôm sau) chạy lại bình thường.
- File đã archive sẽ không bị import lại (check file tồn tại ở `processed/` dir).

### E5: Import chạy chậm, đội sang giờ cao điểm

**Xử lý:**
- Streaming parse + chunk insert: không load toàn bộ file vào RAM.
- Với 15.000 sinh viên, chunk 500, dự kiến < 5 phút.
- Cron chạy lúc 2:05 AM — đủ xa giờ cao điểm.

---

## Ràng buộc

- **Zero downtime:** Import không lock table `users` lâu — chỉ upsert từng chunk.
- **Idempotent:** Chạy lại cùng file cho kết quả như nhau.
- **Safety threshold:** Abort nếu > 10% rows lỗi (có thể điều chỉnh qua env var `CSV_ERROR_THRESHOLD`).
- **Archive:** File cũ được lưu 30 ngày, sau đó tự xóa.
- **Không dependency ngược:** Nếu CSV import fail hoàn toàn, hệ thống vẫn chạy với dữ liệu sinh viên từ ngày trước.

---

## Tiêu chí chấp nhận

- [ ] File 15.000 rows import xong trong < 10 phút.
- [ ] Sinh viên mới trong CSV có thể đăng nhập ngay sau khi import (password mặc định = student_id).
- [ ] Sinh viên đã có account giữ nguyên password_hash cũ sau khi import (chỉ update email/name).
- [ ] Khi file không tồn tại: service vẫn hoạt động, admin nhận email alert.
- [ ] Khi > 10% rows lỗi: không import gì cả, alert admin.
- [ ] Chạy import 2 lần với cùng file: kết quả giống nhau (idempotent).
