# 手机端 APK 对接（Capacitor）

## 本机能做什么 / 不能做什么
- 本机已生成：Capacitor 工程配置、`mobile-bridge.js`（本地持久化 + 可选云端转发）、`sync.js` 组装脚本、Android 原生桥接示例。
- 本机**不能真实打包 APK**：环境无 JDK / Android SDK / Gradle，且 C 盘仅剩 ~14G（APK 构建需数 GB）。APK 需在装有 Android Studio 的机器构建。

## 数据流
```
app.html（统一核心）
   └─ mobile-bridge.js
        ├─ 本地持久化：localStorage（Capacitor WebView 沙箱内，永久保存）
        ├─ 可选云端转发：fetch → /api/publish（配置 POSTER_CLOUD_ENDPOINT 后）
        └─ 消息队列：本地 outbox + 云端 replay 轮询
```

## 构建步骤（在 Android 构建环境执行）
1. 安装 Node 18+ 与 Android Studio（含 SDK + JDK 17）。
2. 进入本目录：`cd poster-delivery/mobile`
3. 安装依赖：`npm install`
4. 组装 Web 资源并指定云端（按实际地址替换）：
   ```bash
   node sync.js https://your-cloud-host:8791
   ```
   若不接云端，仅本地持久化：`node sync.js`
5. 添加 Android 平台：`npx cap add android`
6. 同步：`npx cap sync android`
7. 打包 APK：
   ```bash
   cd android && ./gradlew assembleDebug
   # 输出：android/app/build/outputs/apk/debug/app-debug.apk
   ```
   发布版用 `assembleRelease`（需签名配置）。
8. 安装到手机：`adb install android/app/build/outputs/apk/debug/app-debug.apk`

## 原生桥接（可选增强）
默认无需原生代码。若需写入 App 内部文件系统，把
`android-bridge/BridgeActivity.java.example` 复制到
`android/app/src/main/java/com/maxsyst/posterdelivery/BridgeActivity.java`，
并在 `MainActivity.onCreate` 里：
```java
addJavascriptInterface(new BridgeActivity(this), "NativeStore");
```
然后在 `mobile-bridge.js` 的 `save`/`load` 中优先调用 `window.NativeStore.save/load`。

## 云端对接说明
`node sync.js <云端地址>` 会把地址写入 Web 资源，手机端保存配置后异步转发到云端
`/api/config/:id` 与 `/api/publish`，离线时存本地 outbox，恢复网络后由 `publish` 补发。
