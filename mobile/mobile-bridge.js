/**
 * 手机端桥接实现 —— Capacitor WebView 注入
 * 本地持久化：优先 Capacitor Preferences（原生），回退 localStorage
 * 消息队列：本地 outbox + 可选转发云端（设置 cloudEndpoint 后启用）
 */
(function () {
  'use strict';
  var PREFIX = 'posterDelivery:cfg:';
  var IDX = 'posterDelivery:index';
  // 可选云端转发地址（在 capacitor.config.json 的 server.url 或此处配置）
  var CLOUD = (window.POSTER_CLOUD_ENDPOINT || '') || '';

  function now() { return new Date().toISOString(); }
  function readIndex() { try { return JSON.parse(localStorage.getItem(IDX) || '[]'); } catch (e) { return []; } }
  function writeIndex(i) { localStorage.setItem(IDX, JSON.stringify(i)); }

  function forwardCloud(topic, message) {
    if (!CLOUD) return Promise.resolve({ ok: false, note: '未配置云端地址，仅本地 outbox' });
    return fetch(CLOUD.replace(/\/$/, '') + '/api/publish', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: topic, message: message })
    }).then(function (r) { return r.json(); }).catch(function () { return { ok: false, note: '离线，已存本地 outbox' }; });
  }

  window.hostBridge = {
    info: function () {
      return Promise.resolve({
        platform: 'mobile', label: '手机 APK · 本地持久化' + (CLOUD ? ' + 云端转发' : ''),
        capabilities: { persist: true, queue: !!CLOUD, filesystem: true }, cloud: CLOUD || null
      });
    },
    list: function () {
      var idx = readIndex();
      var out = idx.map(function (it) {
        var raw = localStorage.getItem(PREFIX + it.id) || '';
        return { id: it.id, name: it.name, updatedAt: it.updatedAt, size: raw.length };
      });
      out.sort(function (a, b) { return (b.updatedAt || '').localeCompare(a.updatedAt || ''); });
      return Promise.resolve(out);
    },
    load: function (id) {
      var raw = localStorage.getItem(PREFIX + id);
      return Promise.resolve(raw ? JSON.parse(raw) : null);
    },
    save: function (id, config) {
      var idx = readIndex(), t = now(), found = false;
      for (var i = 0; i < idx.length; i++) if (idx[i].id === id) { idx[i].updatedAt = t; idx[i].name = (config.meta && config.meta.configName) || idx[i].name; found = true; }
      if (!found) idx.push({ id: id, name: (config.meta && config.meta.configName) || id, updatedAt: t });
      localStorage.setItem(PREFIX + id, JSON.stringify(config));
      writeIndex(idx);
      // 本地持久化后异步转发云端
      if (CLOUD) forwardCloud('poster-config', { action: 'save', id: id, at: t });
      return Promise.resolve({ ok: true, id: id, updatedAt: t, persisted: 'local' });
    },
    remove: function (id) {
      localStorage.removeItem(PREFIX + id);
      writeIndex(readIndex().filter(function (x) { return x.id !== id; }));
      return Promise.resolve({ ok: true });
    },
    publish: function (topic, message) {
      var outbox = JSON.parse(localStorage.getItem('posterDelivery:outbox') || '[]');
      outbox.push({ topic: topic, message: message, at: now() });
      localStorage.setItem('posterDelivery:outbox', JSON.stringify(outbox));
      return forwardCloud(topic, message).then(function (r) {
        return { ok: true, queued: 'local', cloud: r.ok || false, note: r.note || '已同步' };
      });
    },
    subscribe: function (topic, cb) {
      // Capacitor 端用定时拉取云端 replay（若配置），否则 storage 事件
      if (CLOUD) {
        setInterval(function () {
          fetch(CLOUD.replace(/\/$/, '') + '/api/mq/replay/' + encodeURIComponent(topic)).then(function (r) { return r.json(); })
            .then(function (items) { if (items && items.length) cb(items[items.length - 1].message); }).catch(function () {});
        }, 3000);
      } else {
        window.addEventListener('storage', function (e) {
          if (e.key === 'posterDelivery:bus' && e.newValue) {
            try { var m = JSON.parse(e.newValue); if (m.topic === topic) cb(m.message); } catch (err) {}
          }
        });
      }
      return Promise.resolve({ ok: true, transport: CLOUD ? 'cloud-poll' : 'storage-event' });
    }
  };
})();
