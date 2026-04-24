# UniHub Workshop — Infrastructure Guide (Chi phí tối thiểu)

## Tổng quan chi phí

| Dịch vụ | Tầng miễn phí | Giới hạn | Đủ dùng? |
|---------|--------------|---------|---------|
| Oracle Cloud Free Tier | 2x AMD VM (1 OCPU, 1GB RAM mỗi) hoặc 1x ARM (4 OCPU, 24GB) | Vĩnh viễn | ✅ Rất tốt |
| Vercel (Next.js) | Free | 100GB bandwidth/tháng | ✅ |
| Cloudflare R2 | Free | 10GB storage, 1M req/tháng | ✅ |
| Resend (Email) | Free | 3.000 email/tháng | ✅ |
| Gemini API | Free | 60 RPM, 1.5M tokens/ngày | ✅ |
| Cloudflare (CDN/DNS) | Free | Không giới hạn | ✅ |
| **Tổng** | **~0 VNĐ/tháng** | | ✅ |

## Kiến trúc Deploy

```
┌─────────────────────────────────────┐
│    Oracle Cloud ARM Free Tier       │
│   4 OCPU / 24GB RAM (Vĩnh viễn)    │
│                                     │
│  ┌──────────────────────────────┐   │
│  │        Docker Compose        │   │
│  │                              │   │
│  │  ┌──────────┐ ┌───────────┐ │   │
│  │  │ Express  │ │ postgres  │ │   │
│  │  │ :3000    │ │ :5432     │ │   │
│  │  │ + Bull   │ │           │ │   │
│  │  └──────────┘ └───────────┘ │   │
│  │                              │   │
│  │  ┌──────────┐ ┌───────────┐ │   │
│  │  │  redis   │ │  nginx    │ │   │
│  │  │ :6379    │ │ :80/:443  │ │   │
│  │  └──────────┘ └───────────┘ │   │
│  └──────────────────────────────┘   │
│                                     │
│  /data/csv/      ← thư mục CSV      │
│  /data/uploads/  ← PDF files        │
│  /data/backups/  ← pg_dump hàng đêm │
└─────────────────────────────────────┘
         │
         │ Cloudflare Proxy
         │
┌────────▼──────┐    ┌───────────────┐
│ api.unihub.io │    │  unihub.io    │
│ (VPS backend) │    │ (Vercel, SSG) │
└───────────────┘    └───────────────┘
```

## docker-compose.yml (production-ready cho sinh viên)

```yaml
version: '3.9'

services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: unihub
      POSTGRES_USER: unihub
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./scripts/init-db.sql:/docker-entrypoint-initdb.d/init.sql
    networks:
      - internal
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U unihub"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --save 60 1 --loglevel warning --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis_data:/data
    networks:
      - internal
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5

  api:
    image: ghcr.io/your-repo/unihub-api:latest
    restart: unless-stopped
    environment:
      NODE_ENV: production
      PORT: 3000
      DATABASE_URL: postgres://unihub:${POSTGRES_PASSWORD}@postgres:5432/unihub
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
      JWT_SECRET: ${JWT_SECRET}
      RESEND_API_KEY: ${RESEND_API_KEY}
      GEMINI_API_KEY: ${GEMINI_API_KEY}
      VNPAY_TMNCODE: ${VNPAY_TMNCODE}
      VNPAY_HASHSECRET: ${VNPAY_HASHSECRET}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    volumes:
      - ./data/csv:/data/csv:ro         # Mount thư mục CSV (read-only)
      - ./data/uploads:/data/uploads    # Mount thư mục upload
    networks:
      - internal
      - external
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.api.rule=Host(`api.unihub.io`)"
      - "traefik.http.routers.api.tls.certresolver=letsencrypt"
      - "traefik.http.services.api.loadbalancer.server.port=3000"

  traefik:
    image: traefik:v3
    restart: unless-stopped
    command:
      - "--providers.docker=true"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.letsencrypt.acme.email=${ADMIN_EMAIL}"
      - "--certificatesresolvers.letsencrypt.acme.tlschallenge=true"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - traefik_certs:/letsencrypt
    networks:
      - external

volumes:
  postgres_data:
  redis_data:
  traefik_certs:

networks:
  internal:
  external:
```

## Backup Strategy (quan trọng!)

```bash
# Cron job backup PostgreSQL mỗi đêm lúc 1:00 AM
# /home/ubuntu/backup.sh
#!/bin/bash
DATE=$(date +%Y-%m-%d)
docker exec postgres pg_dump -U unihub unihub | gzip > /data/backups/unihub_$DATE.sql.gz

# Giữ 7 ngày gần nhất
find /data/backups -name "*.sql.gz" -mtime +7 -delete

# Upload lên Cloudflare R2 (dùng rclone)
rclone copy /data/backups/unihub_$DATE.sql.gz r2:unihub-backups/
```

## CI/CD với GitHub Actions

```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build Docker image
        run: |
          docker build -t ghcr.io/${{ github.repository }}/unihub-api:latest .
          docker login ghcr.io -u $ -p ${{ secrets.GITHUB_TOKEN }}
          docker push ghcr.io/${{ github.repository }}/unihub-api:latest

      - name: Deploy to VPS
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ubuntu
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /home/ubuntu/unihub
            docker compose pull api
            docker compose up -d api
            # Wait for app to start
            sleep 5
            # Check health
            curl -f http://localhost:3000/health || exit 1
            echo "✓ Deployment successful"
```

## Dockerfile (Express.js)

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy app
COPY . .

# Run migrations (if using a migration tool)
# RUN npm run migrate

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if (r.statusCode !== 200) throw new Error('unhealthy')})"

EXPOSE 3000

CMD ["npm", "start"]
```

## .env.example

```bash
# Database
DATABASE_URL=postgres://unihub:password@localhost:5432/unihub
POSTGRES_PASSWORD=secure_password_here

# Cache & Queue
REDIS_URL=redis://:secure_password@localhost:6379
REDIS_PASSWORD=secure_password_here

# Auth
JWT_SECRET=your_jwt_secret_key_min_32_chars
JWT_EXPIRY=15m
REFRESH_TOKEN_EXPIRY=7d

# Email
RESEND_API_KEY=re_xxxxxxxxxxxxx

# AI Summary
GEMINI_API_KEY=AIzaxxxxxxxxxxxxx

# Payment Gateway
VNPAY_TMNCODE=your_merchant_code
VNPAY_HASHSECRET=your_secret_key
VNPAY_API_URL=https://sandbox.vnpayment.vn

# File Storage
CLOUDFLARE_R2_ACCOUNT_ID=xxxxxxx
CLOUDFLARE_R2_ACCESS_KEY=xxxxx
CLOUDFLARE_R2_SECRET_KEY=xxxxx
CLOUDFLARE_R2_BUCKET=unihub
CLOUDFLARE_R2_ENDPOINT=https://xxx.r2.cloudflarestorage.com

# CSV Import
CSV_DROP_DIR=/data/csv
CSV_ERROR_THRESHOLD=0.1

# Server
PORT=3000
NODE_ENV=production
ADMIN_EMAIL=admin@unihub.edu.vn
```
