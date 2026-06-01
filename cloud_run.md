# Google Cloud Run 배포 가이드

## 현황 요약

| 항목 | 현재 환경 | Cloud Run |
|------|-----------|-----------|
| 런타임 | Windows self-hosted runner | 컨테이너 (Linux) |
| 배포 트리거 | GitHub Actions → deploy.bat | GitHub Actions → Cloud Run |
| 서버 | Node.js Express + Socket.IO (포트 3000) | 동일 (포트 환경변수로 제어) |
| 정적 파일 | Express가 `dist/` 서빙 | 동일 |
| HTTPS | 없음 (로컬 네트워크) | Cloud Run이 자동 처리 |
| 인스턴스 수 | 단일 프로세스 | 최소 1개 고정 필요 (아래 설명) |

---

## 분기가 필요한 이유 — 핵심 과제 3가지

### 1. Socket.IO + 인메모리 세션 (가장 중요)

`platform/server/SessionManager.js`는 게임 세션 전체를 **서버 메모리**에 저장합니다.

```
sessions: Map<sessionId → Session>
socketToSession: Map<socketId → { sessionId, role, playerId }>
```

Cloud Run이 트래픽에 따라 **인스턴스를 2개 이상** 띄우면, 인스턴스 A에서 만든 세션을 인스턴스 B에서는 찾지 못합니다. 플레이어가 입장 불가, `Session not found` 에러가 발생합니다.

**해결책**: `--session-affinity` 플래그
Cloud Run의 Session Affinity는 같은 클라이언트(쿠키 기반)를 항상 같은 인스턴스로 라우팅합니다. 게임 특성상 세션 수가 많지 않으므로 이것으로 충분합니다.

> 장기적으로 수백 개 이상의 동시 세션이 예상된다면 SessionManager를 Redis/Firestore 기반으로 전환해야 합니다. 지금은 Session Affinity로 진행합니다.

### 2. Cold Start (인스턴스 0→1 부팅 지연)

기본 설정에서 Cloud Run은 요청이 없으면 인스턴스를 0으로 줄입니다. 게임 서버는 Socket.IO 연결을 즉시 수락해야 하므로, Cold Start(3~10초 지연)가 발생하면 플레이어 접속이 끊깁니다.

**해결책**: `--min-instances=1`
인스턴스를 최소 1개 항상 유지합니다. 비용이 소폭 증가하지만 게임 서버의 필수 조건입니다.

### 3. QR 코드 URL

현재 QR URL은 `HostSDK.js`에서 클라이언트 측 `window.location`으로 생성합니다.

```javascript
// platform/client/HostSDK.js
this._qrUrl = `${scheme}//${host}${port}/games/${this.gameId}/mobile/?session=${sessionId}`;
```

호스트 브라우저가 Cloud Run URL(`https://xxx.run.app`)로 접속하면 QR 코드도 자동으로 해당 URL을 가리킵니다. **코드 변경 불필요.**

---

## 무엇을 분기해야 하는가

### 추가할 파일 (코드베이스 공유, 배포 설정만 분기)

```
connect_dise/
├── Dockerfile                          ← 신규 추가
├── .dockerignore                       ← 신규 추가
└── .github/workflows/
    ├── deploy.yml                      ← 유지 (Windows self-hosted)
    └── cloud-run.yml                   ← 신규 추가 (Cloud Run 전용)
```

코드베이스(서버, 게임 로직, 플랫폼 SDK)는 **동일하게 공유**합니다. 별도 브랜치 불필요.

### 변경할 파일 (선택)

| 파일 | 변경 내용 | 필수 여부 |
|------|-----------|-----------|
| `server/index.js` | CORS origin을 환경변수(`CORS_ORIGIN`)로 제어 | 선택 (보안 강화 시) |
| `platform/server/SessionManager.js` | Redis 기반으로 전환 | 선택 (수평확장 시) |

---

## 단계별 배포 과정

### Step 1 — GCP 프로젝트 초기 설정 (최초 1회)

```bash
# GCP 프로젝트 생성 또는 기존 프로젝트 선택
gcloud projects create connect-dise --name="Connect Dise"
gcloud config set project connect-dise

# 필요한 API 활성화
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable artifactregistry.googleapis.com

# Artifact Registry 저장소 생성 (Docker 이미지 저장)
gcloud artifacts repositories create connect-dise \
  --repository-format=docker \
  --location=asia-northeast3 \
  --description="Connect Dise container images"
```

### Step 2 — GitHub Actions용 서비스 계정 생성 (최초 1회)

```bash
# 서비스 계정 생성
gcloud iam service-accounts create github-actions \
  --display-name="GitHub Actions Deploy"

export SA="github-actions@connect-dise.iam.gserviceaccount.com"

# Cloud Run 배포 권한 부여
gcloud projects add-iam-policy-binding connect-dise \
  --member="serviceAccount:${SA}" \
  --role="roles/run.admin"

# Artifact Registry 이미지 푸시 권한
gcloud projects add-iam-policy-binding connect-dise \
  --member="serviceAccount:${SA}" \
  --role="roles/artifactregistry.writer"

# 서비스 계정 사용 권한 (Cloud Run이 이 SA로 실행)
gcloud projects add-iam-policy-binding connect-dise \
  --member="serviceAccount:${SA}" \
  --role="roles/iam.serviceAccountUser"

# GitHub Secrets에 등록할 키 파일 생성
gcloud iam service-accounts keys create gcp-key.json \
  --iam-account="${SA}"
```

생성된 `gcp-key.json` 내용 전체를 GitHub 레포지토리 Settings → Secrets에 등록합니다:

| Secret 이름 | 값 |
|-------------|-----|
| `GCP_PROJECT_ID` | `connect-dise` |
| `GCP_SA_KEY` | `gcp-key.json` 파일 전체 내용 (JSON) |

> `gcp-key.json`은 민감 정보이므로 즉시 삭제하거나 안전하게 보관하세요.

### Step 3 — Dockerfile 작성

멀티스테이지 빌드로 최종 이미지에 devDependencies와 소스파일을 제외합니다.

**`Dockerfile`**

```dockerfile
# ── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# 의존성 설치 (devDependencies 포함 — 빌드에 필요)
COPY package*.json ./
RUN npm ci

# 소스 전체 복사 후 Vite 빌드
COPY . .
RUN npm run build

# ── Stage 2: Runtime ────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

# production 의존성만 설치
COPY package*.json ./
RUN npm ci --omit=dev

# 빌드 결과물 복사
COPY --from=builder /app/dist ./dist

# 서버 코드 복사
COPY server/ ./server/
COPY platform/server/ ./platform/server/

# Cloud Run은 PORT 환경변수로 포트를 지정
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server/index.js"]
```

### Step 4 — .dockerignore 작성

**`.dockerignore`**

```
node_modules/
dist/
.git/
.github/
.claude/
.env
*.log
*.md
docs/
deploy.bat
```

### Step 5 — GitHub Actions 워크플로 작성

**`.github/workflows/cloud-run.yml`**

```yaml
name: Cloud Run Deploy

on:
  push:
    branches: [ "main" ]
  workflow_dispatch:        # 수동 실행 허용

env:
  PROJECT_ID: ${{ secrets.GCP_PROJECT_ID }}
  REGION: asia-northeast3
  SERVICE: connect-dise
  IMAGE: asia-northeast3-docker.pkg.dev/${{ secrets.GCP_PROJECT_ID }}/connect-dise/app

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}

      - name: Configure Docker
        run: gcloud auth configure-docker asia-northeast3-docker.pkg.dev

      - name: Build and push Docker image
        run: |
          docker build -t $IMAGE:${{ github.sha }} -t $IMAGE:latest .
          docker push $IMAGE:${{ github.sha }}
          docker push $IMAGE:latest

      - name: Deploy to Cloud Run
        run: |
          gcloud run deploy $SERVICE \
            --image=$IMAGE:${{ github.sha }} \
            --region=$REGION \
            --platform=managed \
            --allow-unauthenticated \
            --port=8080 \
            --min-instances=1 \
            --max-instances=3 \
            --memory=512Mi \
            --cpu=1 \
            --timeout=3600 \
            --session-affinity \
            --set-env-vars="NODE_ENV=production"

      - name: Show service URL
        run: |
          gcloud run services describe $SERVICE \
            --region=$REGION \
            --format="value(status.url)"
```

### Step 6 — 기존 Windows 워크플로와 충돌 방지

현재 `deploy.yml`은 `main` 브랜치 push 시 동시에 실행됩니다. 두 워크플로를 **상호 독립적으로** 유지하려면 브랜치 전략을 선택합니다.

**옵션 A — 동시 배포 (권장, 초기)**: 두 워크플로가 같은 `main` 브랜치를 바라봄. Windows 서버와 Cloud Run이 동시에 최신 코드를 배포. 어느 환경이 더 안정적인지 비교 운영.

**옵션 B — 브랜치 분리**: `cloud-run.yml`의 트리거를 `cloud-run` 브랜치로 제한.
```yaml
on:
  push:
    branches: [ "cloud-run" ]
```
`main`은 Windows 배포 전용, `cloud-run` 브랜치는 Cloud Run 전용으로 분리.

**옵션 C — 태그 기반 배포**: Cloud Run 배포는 `v*` 태그가 붙을 때만 실행.
```yaml
on:
  push:
    tags: [ "v*" ]
```

### Step 7 — 최초 배포 후 서비스 URL 확인

```bash
gcloud run services describe connect-dise \
  --region=asia-northeast3 \
  --format="value(status.url)"
# 예: https://connect-dise-abc123-du.a.run.app
```

이 URL로 호스트가 접속하면 QR 코드가 자동으로 해당 URL을 포함합니다.

---

## Cloud Run 서비스 설정 상세

### 필수 설정

| 설정 | 값 | 이유 |
|------|-----|------|
| `--session-affinity` | 활성화 | Socket.IO 인메모리 세션 유지 |
| `--min-instances=1` | 1 | Cold Start 방지 (게임 접속 지연 없애기) |
| `--timeout=3600` | 3600초 (1시간) | Socket.IO 장기 연결 지원 (기본 300초로는 부족) |
| `--port=8080` | 8080 | Cloud Run 기본 포트 (PORT 환경변수로 전달됨) |
| `--allow-unauthenticated` | 활성화 | 누구나 접속 가능 (게임 서비스) |

### 권장 설정

| 설정 | 값 | 이유 |
|------|-----|------|
| `--max-instances=3` | 3 | Session Affinity 환경에서 인스턴스가 너무 많으면 새 세션이 분산될 수 있음 |
| `--memory=512Mi` | 512Mi | Dixit 카드 200장 등 에셋 메모리 포함 |
| `--cpu=1` | 1 | Socket.IO + 게임 로직 처리 |
| `--region=asia-northeast3` | 서울 | 한국 사용자 대상 최저 레이턴시 |

### HTTP/2 vs HTTP/1.1

Cloud Run은 기본적으로 HTTP/1.1을 사용합니다. Socket.IO WebSocket은 HTTP/1.1 업그레이드 방식으로 동작하므로 **별도 설정 불필요**합니다.

> HTTP/2를 강제하면 WebSocket 업그레이드가 차단될 수 있으므로 사용하지 않습니다.

---

## 이미지 크기 고려사항

Dixit 게임 카드 200장(PNG)이 `games/dixit/assets/cards/`에 포함되어 있어 Docker 이미지가 큽니다. 빌드 시간 및 이미지 크기를 확인하세요.

```bash
# 로컬에서 이미지 크기 확인
docker build -t connect-dise-test .
docker images connect-dise-test
```

이미지가 1GB를 초과하면 Cloud Build 타임아웃을 늘리거나, 카드 이미지를 Google Cloud Storage로 분리하는 방안을 고려합니다.

---

## 기존 Windows 배포와 병행 운영 체크리스트

- [ ] GCP 프로젝트 생성 및 API 활성화
- [ ] 서비스 계정 및 키 생성, GitHub Secrets 등록
- [ ] `Dockerfile` 추가
- [ ] `.dockerignore` 추가
- [ ] `.github/workflows/cloud-run.yml` 추가
- [ ] 첫 번째 push 후 Cloud Run 서비스 URL 확인
- [ ] 해당 URL로 로비 접속 → 게임 생성 → 모바일 QR 스캔 → 입장 동작 확인
- [ ] 5분 이상 연결 유지 후 세션 유지 여부 확인 (Socket.IO reconnect)
- [ ] Cloud Run 로그에서 에러 없는지 확인: `gcloud run logs tail connect-dise --region=asia-northeast3`

---

## 비용 추정

`--min-instances=1` 설정 시 인스턴스가 항상 실행됩니다.

| 항목 | 예상 비용 |
|------|----------|
| Cloud Run (CPU 1, 512Mi, 1 인스턴스 상시) | ~$15–20/월 |
| Artifact Registry (이미지 저장) | ~$0.5–2/월 |
| 네트워크 송신 (한국 내) | ~$0.1–1/월 |
| **합계** | **~$16–23/월** |

> Cloud Run은 사용량에 따라 비용이 달라집니다. 실제 트래픽에 따라 조정하세요.
> 첫 90일은 $300 크레딧이 제공됩니다.

---

## 장기 확장 — SessionManager Redis 전환 (선택)

동시 세션이 많아지거나 인스턴스를 자유롭게 확장해야 할 경우, `SessionManager`를 Redis 기반으로 전환합니다.

**추가 필요 사항**:
- Google Cloud Memorystore (Redis) 인스턴스 생성
- `platform/server/SessionManager.js`를 Redis 클라이언트(`ioredis`)로 재구현
- VPC Connector 설정 (Cloud Run ↔ Memorystore 통신)
- `--session-affinity` 제거 가능 (세션이 Redis에 저장되므로)

이 작업은 코드 변경이 크므로 별도 마일스톤으로 진행합니다.
