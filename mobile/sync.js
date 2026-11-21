/**
 * 把统一核心 app.html 组装成 Capacitor 的 www 目录：
 *  - bridge.js 替换为 mobile-bridge.js
 *  - 注入可选云端端点（POSTER_CLOUD_ENDPOINT）
 * 用法：node sync.js [cloudEndpoint]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');       // poster-delivery
const MOBILE = __dirname;                          // mobile
const WWW = path.join(MOBILE, 'www');
const cloud = process.argv[2] || process.env.POSTER_CLOUD_ENDPOINT || '';

fs.mkdirSync(WWW, { recursive: true });

let app = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');
// 桥接替换
app = app.replace('src="bridge.js"', 'src="mobile-bridge.js"');
// 注入云端地址（在 mobile-bridge 之前定义）
if (cloud) {
  app = app.replace('<script src="mobile-bridge.js"></script>',
    '<script>window.POSTER_CLOUD_ENDPOINT=' + JSON.stringify(cloud) + ';</script>\n  <script src="mobile-bridge.js"></script>');
}
// 移动端页脚链接去掉（APK 内不需要跳本地文件），保留导航与配置链接为相对
app = app.replace(/href="poster\.html"/g, 'href="#poster"').replace(/href="dependencies\.html"/g, 'href="#deps"');

fs.writeFileSync(path.join(WWW, 'index.html'), app, 'utf8');
fs.copyFileSync(path.join(MOBILE, 'mobile-bridge.js'), path.join(WWW, 'mobile-bridge.js'));

// 复制依赖页需要的资源（可选）
['dependencies.html', 'dependencies-config.json', 'poster-config.json', 'step-dependencies.xmind', 'poster-source.jpeg'].forEach(f => {
  const src = path.join(ROOT, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(WWW, f));
});

console.log('www 已生成:', WWW);
console.log('云端转发:', cloud || '（未配置，仅本地持久化）');
console.log('文件:', fs.readdirSync(WWW).join(', '));
