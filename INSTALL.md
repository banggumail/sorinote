# Sorinote (소리노트) 설치 가이드

본 문서는 데비안 12 (Debian 12) 및 Nginx 환경의 서버에 소리노트를 단독 서비스로 설치하고 구동하는 단계를 상세히 설명합니다.

## 서비스 주요 링크
- 깃허브 저장소: https://github.com/banggumail/sorinote
- 서비스 홈페이지: https://sorinote.2bpencil.online
- 관리자 페이지: https://sorinote.2bpencil.online/admin

---

## 1. 사전 준비 작업

서버에 필요한 도구가 설치되어 있는지 확인하고 미설치된 도구는 설치한다.

### 1-1. Node.js 설치 (방식 A 이용 시 필요)
Node.js v20 이상 버전을 설치한다.
```bash
# NodeSource를 통한 Node.js 20 LTS 설치 (Debian)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 1-2. Docker 및 Compose 설치 (방식 B 이용 시 필요)
```bash
# Docker 공식 리포지토리를 통한 설치
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

---

## 2. 소스 코드 가져오기 및 설치 (Clone)

서버 컴퓨터의 배포 경로로 소스 코드를 복제(다운로드)합니다. (예: `/var/www/sorinote` 또는 사용자의 홈 디렉토리 `~/sorinote`)

### 2-1. 저장소 클론 (설치 링크)
```bash
# git을 이용해 소리노트 저장소 클론
git clone https://github.com/banggumail/sorinote.git /var/www/sorinote

# 클론한 프로젝트 폴더로 이동
cd /var/www/sorinote
```

---

## 3. 배포 진행 (원하는 방식 선택)

---

### [선택 1] 방식 A: PM2를 이용한 네이티브 배포

#### 단계 1: 의존성 패키지 설치
루트 디렉토리에서 아래 명령어를 실행하여 프론트엔드와 백엔드의 모든 의존성을 자동으로 설치한다.
```bash
npm run setup
```

#### 단계 2: 환경 변수 설정
템플릿 파일을 복사하여 환경 변수 파일 `.env`를 생성한다.
```bash
cp .env.example .env
```
필요한 경우 `.env` 파일을 편집기로 열어 설정값을 수정한다. (기본 포트: 3000)
```env
PORT=3000
DATABASE_PATH=database.sqlite
UPLOAD_DIR=uploads
```

#### 단계 3: 프론트엔드 정적 파일 빌드
React 프론트엔드를 빌드한다. 빌드된 정적 리소스는 `dist` 폴더에 생성되며, 백엔드가 직접 호스팅한다.
```bash
npm run build
```

#### 단계 4: PM2 프로세스 매니저 설치 및 무중단 실행
서버가 항상 켜져 있고 오류 발생 시 자동 재시작되도록 PM2로 애플리케이션을 구동한다.
```bash
# PM2 전역 설치
sudo npm install -g pm2

# 프로덕션 환경 변수를 적용하여 실행
pm2 start ecosystem.config.cjs --env production
```

#### 단계 5: 서버 부팅 시 자동 실행 설정
서버가 재부팅되어도 소리노트가 자동으로 켜지도록 systemd 서비스로 등록한다.
```bash
# 시스템 시작 스크립트 생성 명령 실행
pm2 startup
```
*주의: 위 명령어를 실행하면 터미널 화면 맨 아래에 `sudo env PATH=...`로 시작하는 한 줄짜리 명령어가 출력된다. 그 명령어를 그대로 복사하여 터미널에 실행해야 설정이 완료된다.*

```bash
# 최종 완료 후 프로세스 목록 저장
pm2 save
```

---

### [선택 2] 방식 B: Docker Compose를 이용한 배포

서버에 Node.js 등을 직접 설치하지 않고 컨테이너 기술로 간편하게 실행하는 방식이다.

#### 단계 1: 도커 컨테이너 빌드 및 백그라운드 구동
프로젝트 루트 경로에서 아래 명령어를 입력한다.
```bash
sudo docker compose up -d --build
```

#### 단계 2: 데이터 영속화 상태 확인
- 컨테이너가 실행되면 루트 디렉토리에 `./data` 폴더가 자동으로 생성된다.
- DB 파일(`database.sqlite`)과 업로드된 오디오/이미지 파일들이 이 `./data` 폴더 안에 저장된다.
- **백업 시**: 서버 컴퓨터의 `./data` 디렉토리 전체만 백업하면 모든 데이터가 보존된다.

---

## 4. Nginx 역방향 프록시 및 SSL(HTTPS) 설정

외부에서 도메인을 통해 안전하게 접속할 수 있도록 Nginx 프록시와 SSL 암호화를 적용한다.

### 단계 4-1: Nginx 가상 호스트 설정 파일 생성
설정 파일을 생성하고 텍스트 편집기(예: `nano`)로 연다.
```bash
sudo nano /etc/nginx/sites-available/sorinote
```

### 단계 4-2: Nginx 설정 입력
아래 내용을 붙여넣는다. (도메인은 실제 도메인으로 변경한다.)

> [!IMPORTANT]
> 실시간 상호작용은 WebSockets를 사용하므로 `/socket.io/` 경로에 `Upgrade` 헤더를 반드시 설정해야 한다. 설정 누락 시 실시간 커서 및 메모 싱크가 동작하지 않는다.

```nginx
server {
    server_name sorinote.2bpencil.online; # 본인 도메인 주소 기입

    # 웹 애플리케이션 프록시 설정
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 실시간 웹소켓(Socket.IO) 프록시 설정
    location /socket.io/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400; # 끊김 방지
    }

    # 대용량 미디어 파일 업로드 허용 (예: 오디오 녹음본 업로드용)
    client_max_body_size 50M;

    listen 80;
}
```

### 단계 4-3: 설정 활성화 및 Nginx 재시작
```bash
# 가상 호스트 활성화 (심볼릭 링크 생성)
sudo ln -sf /etc/nginx/sites-available/sorinote /etc/nginx/sites-enabled/

# Nginx 문법 검사
sudo nginx -t

# 정상 확인 후 Nginx 재부팅
sudo systemctl restart nginx
```

### 단계 4-4: Certbot으로 HTTPS/SSL 자동 적용
도메인에 SSL 인증서를 설치하여 보안 접속(HTTPS)을 활성화한다.
```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d sorinote.2bpencil.online
```
인증서 갱신 시 Nginx가 자동 재로드되어 상시 무중단 보안 연결을 유지한다.

---

## 5. 소리노트 기본 사용 방법 (Usage Guide)

설치 완료 후 서비스를 이용하는 방법과 관리자 기능을 설명합니다.

### 5-1. 관리자 페이지 (Admin Dashboard)
운영자는 도메인 뒤에 `/admin`을 붙여 관리자 페이지에 접속할 수 있습니다.
- **접속 경로:** `https://본인도메인/admin`
- **비밀번호 설정:** 최초 접속 시 사용할 관리자 비밀번호를 설정할 수 있습니다. (추후 비밀번호 변경 및 삭제 가능)
- **주요 기능:**
  - **홈 화면 디자인 커스텀:** 메인 홈 화면의 배경 색상, 타이틀 텍스트, 타이틀 색상, 설명 글자, 설명 글자 색상, 메인 배너 이미지를 실시간으로 변경하고 즉시 적용할 수 있습니다.
  - **월드(패드) 관리:** 
    - **생성:** 새 패드를 생성할 때 제목, 날짜, 개별 패드용 캔버스 배경색, 아웃라인 배경색, 타이틀 색상을 지정할 수 있습니다.
    - **비공개 설정 (Private):** 패드를 비공개로 설정하면 메인 페이지의 'World list'에 나타나지 않으며, 해당 주소(URL)를 직접 아는 사람만 들어올 수 있는 비밀 보드가 됩니다.
    - **수정 및 삭제:** 기존에 생성된 패드의 테마를 수정하거나 패드 전체(하위 메모 포함)를 영구 삭제할 수 있습니다.

### 5-2. 사용자 협업 화면 (Collaborative Board)
메인 홈 화면의 리스트를 클릭하거나 특정 패드 URL(`https://도메인/패드ID`)로 접속합니다.
- **실시간 상호작용 (Real-time Co-working):**
  - **커서 트래킹:** 보드에 접속한 다른 사용자들의 마우스 실시간 위치와 이름이 화면에 그대로 보입니다.
  - **메모 드래그 동기화:** 포스트잇처럼 생긴 메모를 드래그하여 움직이면, 접속한 모든 사용자들의 화면에 메모가 실시간으로 움직입니다.
  - **편집 동시성 잠금 (Locking):** 누군가 메모를 편집하기 시작하면 해당 메모에 작성자 이름과 함께 잠금 표시가 되어, 여러 사람이 한 메모를 동시에 수정하다가 덮어씌워지는 현상을 방지합니다.
- **메모 컴포넌트 추가:**
  - **텍스트 메모:** 제목, 본문 작성 및 배경색/글자색을 지정할 수 있습니다.
  - **이미지 업로드:** 이미지 파일을 메모에 첨부하여 보드에 게시할 수 있습니다.
  - **오디오(사운드) 메모:** 음성을 실시간 녹음하거나 마이크 파일을 업로드하면, `wavesurfer.js` 파형이 시각화되어 모든 사용자가 보드 상에서 사운드를 직접 재생하고 들을 수 있습니다.
  - **실시간 삭제:** 작성한 메모를 즉시 삭제하여 보드에서 치울 수 있습니다.

---

## 6. 포트 번호 변경 방법 (Port Configuration)

기본 포트(`3000`) 외에 다른 포트번호로 서비스를 운영하고 싶을 때는 아래 **두 가지 설정**을 변경해야 합니다.

### 6-1. 애플리케이션 실행 포트 수정
실행 방식에 따라 포트 환경 변수를 수정합니다.

* **PM2 실행 환경 (추천):**
  1. 프로젝트 루트의 [ecosystem.config.cjs](file:///Users/2b/Desktop/sorinote/ecosystem.config.cjs) 파일을 엽니다.
  2. `env_production` 블록 내의 `PORT: 3000`을 원하는 포트번호(예: `4000`)로 수정합니다.
  3. 수정 완료 후, 서버 터미널에서 아래 명령어를 통해 환경 변수를 새로 적용해 프로세스를 재기동합니다.
     ```bash
     pm2 restart sorinote --update-env
     ```

* **직접 실행 / Node.js 실행 환경:**
  1. 프로젝트 루트의 `.env` 파일 내 `PORT=3000`을 원하는 포트번호(예: `4000`)로 수정합니다.

### 6-2. Nginx 웹 서버 프록시 설정 수정
Nginx가 변경된 백엔드 포트로 올바르게 신호를 넘겨주도록 프록시 설정을 변경합니다.

1. Nginx 가상 호스트 설정 파일을 엽니다.
   ```bash
   sudo nano /etc/nginx/sites-available/sorinote
   ```
2. 파일 내 `proxy_pass` 경로에 설정되어 있는 포트번호 `3000`을 새로 변경한 포트(예: `4000`)로 수정합니다.
   * *주의: 일반 접속 경로(`/`)와 웹소켓 경로(`/socket.io/`) 두 군데 모두 수정해 주어야 합니다.*
   ```nginx
   location / {
       proxy_pass http://127.0.0.1:4000; # 3000 -> 4000 으로 수정
       ...
   }
   
   location /socket.io/ {
       proxy_pass http://127.0.0.1:4000; # 3000 -> 4000 으로 수정
       ...
   }
   ```
3. Nginx 설정 테스트 후 서비스를 재시작합니다.
   ```bash
   sudo nginx -t && sudo systemctl restart nginx
   ```

---

## 7. 최대 업로드 용량 제한 설정 및 업데이트 방법 (Upload Size Limit Configuration)

이미지 및 소리 파일의 최대 업로드 제한 용량은 기본적으로 **백엔드(Express) 단에서 20MB**, **웹 서버(Nginx) 단에서 50MB**로 이중 제한되어 있습니다. 
더 큰 파일을 업로드할 수 있도록 이 제한을 늘리려면 두 군데의 설정을 모두 변경하고 업데이트해야 합니다.

### 7-1. 백엔드(Express) 용량 제한 수정
1. [server/server.js](file:///Users/2b/Desktop/sorinote/server/server.js) 파일을 엽니다.
2. `multer` 스토리지 설정 부분의 `fileSize` 제한 수치를 원하는 바이트 크기로 수정합니다.
   * 예: 50MB로 확장 시 (`50 * 1024 * 1024`로 수정)
   ```javascript
   const upload = multer({
     storage: storage,
     limits: { fileSize: 50 * 1024 * 1024 } // 20MB -> 50MB로 변경
   });
   ```
3. 수정 완료 후, 변경 사항을 커밋하고 깃허브에 푸시합니다.
   ```bash
   git add server/server.js
   git commit -m "chore: increase file upload limit to 50MB"
   git push origin main
   ```

### 7-2. Nginx 웹 서버 용량 제한 수정
Nginx가 프록시 요청을 차단하지 않도록 가상 호스트 설정 파일의 제한도 일치시키거나 더 크게 늘려줍니다.

1. Nginx 가상 호스트 설정 파일을 엽니다.
   ```bash
   sudo nano /etc/nginx/sites-available/sorinote
   ```
2. 파일 내부에서 `client_max_body_size` 옵션을 찾아 값을 늘려줍니다.
   * 예: 50MB 이상으로 확장 시 (보통 백엔드보다 조금 더 큰 `100M` 등으로 넉넉하게 세팅하는 것을 권장합니다.)
   ```nginx
   client_max_body_size 100M;
   ```
3. Nginx 설정 문법 검사 후 웹 서버를 재시작합니다.
   ```bash
   sudo nginx -t && sudo systemctl restart nginx
   ```

### 7-3. 서버에 배포 업데이트 적용
로컬 수정본과 Nginx 설정 변경이 끝났다면, 서버 컴퓨터 터미널에서 최신 코드를 pull 받고 리로드하여 서버에 적용합니다.

```bash
cd /home/banggumail/sorinote
git pull origin main           # 깃허브에서 수정된 백엔드 코드 다운로드
pm2 reload sorinote            # PM2 프로세스 무중단 재기동 (수정된 20MB 제한이 즉시 활성화됨)
```


