# codex2image

一个批量调用 **gpt-image-2**（经 CPA 代理）的卡牌立绘生图工具。工作流：

1. 左侧填写提示词 + 选择尺寸预设（或自定义宽高）
2. 设定批量数量和并发数 (1–8)
3. 一键生成，右侧瀑布流实时展示
4. 多选模式勾中想要的，一键下载 zip

## 技术栈

- Next.js 14 (App Router) + TypeScript + Tailwind CSS
- 前端：React 18，自写 CSS masonry，`jszip` 打包下载
- 后端：`/api/generate` 代理调用 CPA `/v1/images/generations`，API key 只在服务端

## CPA 架构说明

本项目里的 "CPA" 指 [**router-for-me/CLIProxyAPI**](https://github.com/router-for-me/CLIProxyAPI)（自 v6.0.19 起内置 Web UI `/management.html`，中文名 "CLI Proxy API"）。调用链是：

```
浏览器 → Next.js /api/generate → CPA /v1/images/generations
        → CPA 转发至 https://chatgpt.com/backend-api/codex/responses
        → OpenAI Codex 账号池 Responses API → gpt-image-2
```

最低可用版本 **CPA ≥ v6.9.32**（开始硬编码 gpt-image-2 + `/v1/images/generations` 路由）。
推荐版本 **≥ v6.9.33**（移除对不支持的 `n` 参数的处理，避免一些报错）。最佳版本 **v6.9.35**（对所有 Codex 上游账号启用图像生成 + 图像路由日志）。

## 实测过的 CPA 行为 (2026-04, CPA v6.9.34)

### 请求/响应形状

- 端点：`POST {CPA_BASE_URL}/images/generations`。`gpt-image-2` **仅能**在 `/v1/images/generations` 和 `/v1/images/edits` 上调用，不能放在 chat/completions。
- 请求体：`{ model:'gpt-image-2', prompt, size:'WxH', quality? }`。**不要发 `n`**，从 v6.9.33 起被忽略/拒绝。
- 响应体：`{ created, data:[{ b64_json, revised_prompt }], size, quality, background, output_format, usage }`
- 成功响应 HTTP=200，`b64_json` 是 PNG 原始字节 base64。PNG IHDR 的宽高与请求 `size` 完全一致。

### 实测尺寸矩阵

| 请求尺寸 | 结果 | 耗时 | 备注 |
|---|---|---|---|
| 1024×1024 | ✅ | ~34s | 官方预设 |
| 1024×1536 / 1536×1024 | ✅ | ~50s | 官方预设 |
| 2048×2048 | ✅ | ~70s | |
| 2048×3072 / 3072×2048 | ✅ | ~90s | |
| 2560×1440 (16:9) | ✅ | ~85s | |
| 2880×2880 | ✅ | ~105s | |
| **单边 ≤ 3072** | **✅** | **~110s** | **安全上限** |
| 3456×2304 / 2304×3456 | ❌ 502 | 130–160s | 上游 abort |
| 3840×2160 / 2160×3840 | ❌ 502 | 70–150s | 上游 abort |

### 单边 ≥3456 为什么总是 502

失败返回：`{"error":{"message":"stream disconnected before completion","type":"server_error","code":"internal_server_error"}}`

**这不是 CPA 的 bug**，而是 OpenAI Codex `/responses` 上游对大边长的请求主动断开 HTTP/2 流（`stream error: stream ID N; INTERNAL_ERROR; received from peer`）。升级 CPA 救不了。详见 CPA Issue [#2973](https://github.com/router-for-me/CLIProxyAPI/issues/2973)。

因此 `lib/presets.ts` 里的 `CPA_MAX_SINGLE_EDGE = 3072`，前端会阻止用户勾选单边 >3072 的尺寸。

### CPA 服务端配置建议

如果你自己跑 CPA，建议把 `config.yaml` 里的 **`nonstream-keepalive-interval` 设为 `0`**（默认 >0）——否则 CPA 会给 `/images/generations` 返回“假 200”（keep-alive 心跳被当作真正的响应体），然后再抛 5xx，导致客户端拿到半截 JSON。Issue #2973 里提到的常见陷阱。

## 快速启动

```bash
npm install
cp .env.example .env.local
# 编辑 .env.local 填入你的 CPA_BASE_URL / CPA_API_KEY
npm run dev
# 默认 http://localhost:3100
```

## 环境变量

| 变量 | 说明 |
|----|----|
| `CPA_BASE_URL` | CPA 服务基址 (不带末尾 `/`，带 `/v1`)。例：`http://your-cpa-host:8317/v1` |
| `CPA_API_KEY`  | CPA 认证密钥。**仅服务端，永不泄露给浏览器** |
| `CPA_MODEL`    | 可选，默认 `gpt-image-2` |

## 部署

### Vercel

1. 推到 GitHub 后，在 Vercel 导入项目
2. 在 Project Settings → Environment Variables 添加 `CPA_BASE_URL` / `CPA_API_KEY`
3. **注意**: CPA 默认是 HTTP (非 HTTPS)。由于调用发生在服务端，浏览器不会报 mixed-content，不用使用 HTTPS 版本。
4. 设置 Function Timeout ≥ 180s (Pro 账户)。大尺寸最多 ~110s，留余量。Hobby 账户 max 10s，生图必超时——请升级或改在自己 VPS 运行。

### 自己 VPS (Debian/Ubuntu)

```bash
git clone https://github.com/AmamiShigure/codex2image.git
cd codex2image
npm install && npm run build
cp .env.example .env.local  # 编辑填入 key
PORT=3100 npm start
# 或用 pm2 / docker / systemd 保活
```

## 文件结构

```
app/
  layout.tsx
  globals.css
  page.tsx
  api/generate/route.ts   # 服务端代理 CPA
components/
  Generator.tsx           # 主 UI + 并发池 + 打包下载
lib/
  cpa.ts                  # CPA client (server-only)
  presets.ts              # 尺寸预设 + prompt size hint
```

## 注意

- 提示词末尾会自动追加 `Output in exactly WxH (ratio ratio) resolution, <orientation> format.` 以提高尺寸命中率。如不需要可在左侧关闭。
- 并发限速时 (429/5xx) 前端会自动 8→6→4 降档 + 重试 3 次。
- 仅生成的图全部在浏览器内存中（b64），刷新页面会丢失。打包下载的 zip 会同时包含每张图的 `.txt` (提示词 + revised_prompt)。

## License

MIT
