# MirrorAI

**Tạo phiên bản AI của chính bạn từ dữ liệu chat.** Chạy 100% trên máy cá nhân, được xây dựng trên nền tảng [OpenClaw](https://openclaw.ai/).

MirrorAI thu thập lịch sử chat từ Telegram, Zalo (và nhiều nền tảng khác), phân tích phong cách viết của bạn, và tạo ra một AI mô phỏng chính bạn — đúng giọng điệu, từ vựng, và thói quen nhắn tin.

```
Bạn ──→ Dữ liệu chat ──→ Xây dựng tính cách ──→ AI Clone ──→ Trả lời thay bạn
        (TG/Zalo)          (RAG + Phân tích)      (OpenClaw)   (Tự động hoặc Thủ công)
```

## Tính năng

- **100% Local** — Toàn bộ dữ liệu nằm trên máy bạn. Không upload lên cloud.
- **Đa nền tảng** — Telegram, Zalo tích hợp sẵn. Mở rộng được cho bất kỳ nền tảng chat nào.
- **Tính cách thông minh** — Phân tích phong cách viết, từ vựng, giọng điệu, thói quen emoji, chủ đề.
- **RAG** — Truy xuất tin nhắn tương tự trong quá khứ để trả lời có ngữ cảnh.
- **Chấm điểm độ tin cậy** — Tự động trả lời khi chắc chắn, xếp hàng chờ duyệt khi không chắc.
- **Thời gian phản hồi tự nhiên** — Mô phỏng tốc độ gõ của người thật (35-65 từ/phút).
- **Đổi AI linh hoạt** — Ollama (local), Claude, GPT, Gemini — chỉ cần đổi config, không sửa code.
- **Tích hợp OpenClaw** — Hoạt động như plugin OpenClaw với hệ thống skills.

## Kiến trúc

```
┌──────────────────────────────────────────────────────┐
│                  Máy của bạn (Local)                  │
│                                                      │
│  ┌────────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ Connectors │→ │ Pipeline │→ │ Persona Builder  │  │
│  │ TG / Zalo  │  │ ETL      │  │ → SOUL.md        │  │
│  └────────────┘  └──────────┘  └──────────────────┘  │
│        ↕               ↓              ↓              │
│  ┌────────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │  OpenClaw  │← │ ChromaDB │← │ RAG Engine       │  │
│  │  Gateway   │  │ (Vector) │  │ truy vấn + sinh  │  │
│  └────────────┘  └──────────┘  └──────────────────┘  │
│        ↕                              ↑              │
│  ┌────────────┐              ┌──────────────────┐    │
│  │ Channels   │              │ Ollama (LLM)     │    │
│  │ TG/Zalo/Web│              │ qwen2.5 + embed  │    │
│  └────────────┘              └──────────────────┘    │
└──────────────────────────────────────────────────────┘
```

## Bắt đầu nhanh

### Cài đặt một lệnh (macOS)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/user/mirrorai/main/scripts/install.sh)"
```

### Cài đặt thủ công

```bash
# 1. Yêu cầu hệ thống
brew install node@20 python@3.12 ollama
brew install --cask docker

# 2. Tải model AI
ollama pull qwen2.5:14b        # Model chat (~9GB)
ollama pull nomic-embed-text   # Model embedding (~270MB)

# 3. ChromaDB (cơ sở dữ liệu vector)
docker run -d --name chromadb -p 8000:8000 chromadb/chroma:latest

# 4. Clone & cài đặt
git clone https://github.com/user/mirrorai.git
cd mirrorai
npm install --workspaces
python3 -m venv .venv && source .venv/bin/activate
pip install -e .

# 5. Thiết lập
mirrorai init       # Trình hướng dẫn tương tác
mirrorai ingest     # Nhập dữ liệu chat
mirrorai status     # Kiểm tra trạng thái
mirrorai mirror --enable  # Bật AI clone
```

## Hướng dẫn sử dụng

### Bước 1: Khởi tạo

```bash
mirrorai init
```

Trình hướng dẫn tương tác giúp cấu hình:
- Chọn nền tảng kết nối (Telegram, Zalo)
- Xác thực (bot token, đăng nhập QR)
- Chọn model AI (Ollama local hoặc cloud)

### Bước 2: Nhập dữ liệu chat

**Telegram:**
1. Mở Telegram Desktop → Settings → Advanced → Export Telegram Data
2. Chọn định dạng JSON, tích "Personal chats" và "Group chats"
3. Chạy:
```bash
mirrorai ingest --platform=telegram --file=~/Downloads/result.json
```

**Zalo:**
```bash
mirrorai ingest --platform=zalo
# Đăng nhập bằng QR, sau đó tự động lấy lịch sử chat
```

### Bước 3: Bật chế độ phản chiếu

```bash
mirrorai mirror --enable    # Bật tự động trả lời
mirrorai mirror --pause     # Tạm dừng (vẫn thu thập dữ liệu)
mirrorai mirror --resume    # Tiếp tục
mirrorai mirror --disable   # Tắt hoàn toàn
```

### Bước 4: Theo dõi

```bash
mirrorai status   # Trạng thái, nền tảng, thống kê tính cách, hàng đợi
```

## Máy trạng thái (State Machine)

```
CHƯA KHỞI TẠO → CÀI ĐẶT → CẤU HÌNH NỀN TẢNG → THU THẬP DỮ LIỆU
→ XỬ LÝ DỮ LIỆU → XÂY DỰNG TÍNH CÁCH → ĐÁNH CHỈ MỤC VECTOR → SẴN SÀNG
→ ĐANG PHẢN CHIẾU ⇄ TẠM DỪNG
         ↓
  CẬP NHẬT TÍNH CÁCH (mỗi 30 phút)
```

## Cấu hình

Toàn bộ cấu hình trong `config/mirrorai.config.yaml`:

```yaml
model:
  primary: "ollama/qwen2.5:14b"         # AI local
  fallback: "anthropic/claude-sonnet-4-6" # AI cloud dự phòng

embedding:
  provider: "ollama"                      # "ollama" hoặc "openai"
  model: "nomic-embed-text"

persona:
  confidence_threshold: 0.65  # Ngưỡng tự động trả lời (0.0-1.0)
  auto_reply: true
  manual_review_queue: true
```

### Chuyển đổi nhà cung cấp AI

Không cần sửa code — chỉ đổi config:

```yaml
# Local (miễn phí, riêng tư)
model:
  primary: "ollama/qwen2.5:14b"

# Cloud (chất lượng cao hơn)
model:
  primary: "anthropic/claude-sonnet-4-6"

# Kết hợp (local trước, cloud dự phòng)
model:
  primary: "ollama/qwen2.5:14b"
  fallback: "anthropic/claude-sonnet-4-6"
```

Biến môi trường trong `~/.mirrorai/.env`:

```bash
TELEGRAM_BOT_TOKEN=123:abc
ANTHROPIC_API_KEY=sk-...     # Tùy chọn: cho cloud dự phòng
OLLAMA_URL=http://localhost:11434
CHROMADB_URL=http://localhost:8000
```

## Thêm nền tảng mới

MirrorAI sử dụng mẫu connector mở rộng. Để thêm nền tảng mới:

```typescript
// 1. Tạo packages/connectors/discord/index.ts
import { SocialConnector } from "../base/connector.js";
import { ConnectorRegistry } from "../base/registry.js";

export class DiscordConnector extends SocialConnector {
  readonly platform = "discord";
  readonly displayName = "Discord";
  // Triển khai các phương thức abstract...
}

// 2. Đăng ký (một dòng duy nhất)
ConnectorRegistry.register("discord", () => new DiscordConnector());

// 3. Thêm "discord" vào mirrorai.config.yaml — xong!
```

Không cần thay đổi gì trong pipeline, persona builder, hay RAG engine.

## Cấu trúc dự án

```
mirrorai/
├── packages/
│   ├── connectors/          # Kết nối nền tảng (Telegram, Zalo)
│   │   ├── base/            # SocialConnector trừu tượng + Registry
│   │   ├── telegram/        # Phân tích export Telegram + realtime
│   │   └── zalo/            # Lấy lịch sử Zalo + realtime
│   ├── core/                # Python: pipeline dữ liệu + AI engine
│   │   ├── data_pipeline/   # Chuẩn hóa → Lọc → Chia nhỏ
│   │   ├── rag_engine/      # Nhúng → Lưu trữ → Truy xuất → Truy vấn
│   │   └── persona_builder/ # Phân tích → Sinh SOUL.md
│   └── openclaw-plugin/     # OpenClaw skills + manifest
│       └── skills/          # mirror-respond, persona-update, v.v.
├── apps/cli/                # CLI: mirrorai init/ingest/status/mirror
├── scripts/install.sh       # Cài đặt một lệnh cho macOS
├── config/                  # Cấu hình YAML + mẫu .env
└── workspace/               # Không gian làm việc OpenClaw (AGENTS.md, SOUL.md)
```

## Công nghệ sử dụng

| Thành phần | Công nghệ |
|-----------|-----------|
| Nền tảng chính | [OpenClaw](https://openclaw.ai/) |
| LLM (local) | Ollama — qwen2.5 |
| Nhúng vector | nomic-embed-text |
| Cơ sở dữ liệu vector | ChromaDB |
| Kết nối nền tảng | TypeScript (grammY, zca-js) |
| Pipeline dữ liệu | Python (LangChain, scikit-learn) |
| Xử lý tiếng Việt | underthesea |
| Giao diện dòng lệnh | Commander + Inquirer |

## Cách hoạt động

1. **Thu thập** — Nhập lịch sử chat từ Telegram (JSON export) hoặc Zalo (API)
2. **Lọc** — Loại bỏ tin nhắn hệ thống, chỉ-có-media, quá ngắn
3. **Chia nhỏ** — Nhóm thành các đoạn 512 token theo ngữ cảnh hội thoại, có phần chồng lấp
4. **Nhúng** — Chuyển thành vector qua nomic-embed-text (chạy local)
5. **Lưu trữ** — Lưu vào ChromaDB để tìm kiếm ngữ nghĩa
6. **Phân tích** — Trích xuất phong cách viết, từ vựng, giọng điệu, chủ đề
7. **Sinh SOUL.md** — Tạo file định nghĩa tính cách cho OpenClaw
8. **Phản chiếu** — Khi nhận tin nhắn: truy xuất RAG → lắp ráp prompt → LLM → kiểm tra độ tin cậy → trả lời

## Yêu cầu phần cứng

| Cấu hình | RAM | Model | Chất lượng |
|----------|-----|-------|-----------|
| Tối thiểu | 8GB | qwen2.5:7b | Đủ cho chat thông thường |
| Khuyến nghị | 16GB | qwen2.5:14b | Tốt cho hầu hết trường hợp |
| Tốt nhất | 32GB+ | qwen2.5:32b | Gần bằng chất lượng cloud |

Khuyến nghị sử dụng Mac Apple Silicon để chạy AI local (tăng tốc GPU qua Metal).

## Giấy phép

MIT

## Đóng góp

Chào đón mọi Pull Request. Để thêm connector cho nền tảng mới, xem phần "Thêm nền tảng mới" ở trên.
