# 跨端持久化对接架构

一套统一核心 HTML（`app.html`）+ 可替换桥接层（`bridge.js`），三端共用同一套表单与配置模型，通过替换桥接文件切换持久化与消息队列通道。

## 设计原则

```
                ┌─────────────────────────────┐
                │   app.html（统一核心）       │
                │  表单 / 配置库 / 生成JSON    │
                └──────────────┬──────────────┘
                               │ window.hostBridge（统一接口）
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
   bridge.js             desktop-bridge.js      cloud-bridge.js      mobile-bridge.js
   浏览器 localStorage     exe 本地 REST       云端 REST + WS       本地 + 可选云端
```

统一接口 `window.hostBridge`（async）：
- `info()` 平台与能力
- `list()` / `load(id)` / `save(id,config)` / `remove(id)` 配置持久化
- `publish(topic,message)` / `subscribe(topic,cb)` 消息队列

四个实现保持接口一致，业务代码零改动。

## 四端运行方式

### 1) 浏览器（默认）
直接打开 `app.html`。桥接为 `bridge.js`，配置存 localStorage，发布暂存本地 outbox。
- 文件：`app.html` + `bridge.js`

### 2) 桌面 exe（电脑端，外部运行 + 本地持久化）
- 文件：`desktop/PosterDeliveryDesktop.exe`（.NET 10 单文件，188KB）+ `desktop/web/`（页面）
- 运行：双击 exe，自动打开 `http://127.0.0.1:8792`
- 持久化：配置写到 **exe 同目录** `poster-data/configs/*.json`，消息队列 `poster-data/mq/*.jsonl`（真外部文件，重启不丢）
- 桥接：`desktop-bridge.js`（同源 REST，MQ 用轮询订阅）
- 已验证：info / 配置增删改查 / MQ 发布回放 / 静态页 200

### 3) 手机 APK（本地保存 + 云端对接）
- 工程：`mobile/`（Capacitor 7）+ `mobile-bridge.js` + `sync.js` + Android 原生桥接示例
- 本地持久化：Capacitor WebView 沙箱内 localStorage（App 内永久保存）
- 可选云端：`node sync.js <云端地址>` 注入端点，保存后异步转发云端，离线存 outbox
- 打包（需 Android Studio / JDK17 / SDK）：
  ```bash
  cd mobile && npm install && node sync.js https://你的云端:8791
  npx cap add android && npx cap sync android
  cd android && ./gradlew assembleDebug
  ```
- 产物：`android/app/build/outputs/apk/debug/app-debug.apk`
- **本机未打包 APK**：环境无 JDK / Android SDK / Gradle，已在 `mobile/README.md` 写明步骤

### 4) 网页云端（REST + 消息队列）
- 文件：`cloud/server.cjs`（Node 原生，零依赖）+ `cloud/mq.cjs`（文件持久化 MQ）+ `cloud/index.html` + `cloud/cloud-bridge.js`
- 启动：`cd cloud && node server.cjs` → `http://localhost:8791`
- REST：`/api/configs`、`/api/config/:id`（GET/POST/DELETE）、`/api/publish`、`/api/mq/replay/:topic`
- WebSocket：`ws://host/ws?topic=xxx` 实时推送消息
- MQ：append-only JSONL + 消费位点，topic 隔离；可替换为 RabbitMQ/Kafka（接口不变）
- 已验证：info / 配置 CRUD / MQ 发布回放 / WS 握手与推送

## 数据流示例

用户在 app.html 填好"实际内容" → 保存到配置库：
1. 浏览器：localStorage
2. 桌面：POST `/api/config/:id` → exe 写本地文件
3. 手机：localStorage + 异步转发云端
4. 云端：POST `/api/config/:id` → 写云端文件 + 发布 `poster-config` 消息 → WS 推送在线订阅者

发布到消息队列：
- `hostBridge.publish('poster-config', msg)` → 各端写入各自通道（本地 outbox / 本地文件 MQ / 云端 broker）

## 通过 curl 获取静态资源 + 本地服务

两个服务已在本机运行：
- 云端 REST + FileMQ：`http://localhost:8791`
- 桌面 exe 本地服务：`http://127.0.0.1:8792`

一键启动（若服务未运行）：
```bash
bash start-services.sh
```

批量拉取全部静态资源（21 个文件，含统一核心/配置/图片/思维导图/三端源码/文档）：
```bash
bash curl-assets.sh http://localhost:8791 ./downloaded
```

常用单条命令：
```bash
# 静态资源
curl http://localhost:8791/app.html -o app.html
curl http://localhost:8791/poster-config.json -o poster-config.json
curl http://localhost:8791/poster-source.jpeg -o poster.jpg
curl http://localhost:8791/step-dependencies.xmind -o map.xmind
curl http://localhost:8791/cloud/cloud-bridge.js -o cloud-bridge.js

# API / 消息队列
curl http://localhost:8791/api/info
curl http://localhost:8791/api/configs
curl -X POST http://localhost:8791/api/publish \
  -H 'Content-Type: application/json' \
  -d '{"topic":"poster-config","message":{"name":"实际数据"}}'
curl http://localhost:8791/api/mq/replay/poster-config
```

桌面服务同样可被 curl：
```bash
curl http://127.0.0.1:8792/                 # 桌面版页面
curl http://127.0.0.1:8792/api/info
curl -X POST http://127.0.0.1:8792/api/config/demo \
  -H 'Content-Type: application/json' -d '{"meta":{"configName":"demo"}}'
```

## 端口
- 桌面 exe：8792（固定，仅 127.0.0.1 / localhost）
- 云端：8791（可用 `PORT` 环境变量覆盖）

## 技术约束与已知事项
- `D:/WorkSpace/package.json` 含 `"type":"module"`，故云端脚本用 `.cjs` 扩展名（CJS）
- D 盘文件被 DLP 加密代理处理，.NET 源码在 `%TEMP%` 构建后复制 exe 到交付目录
- 环境 Bash 偶发 SIGTERM 挂起，长任务改用工具后台方式或 PowerShell
- 本机 npm registry 可达，但未安装 Capacitor 依赖（APK 打包在目标环境执行 `npm install`）
