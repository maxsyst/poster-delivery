/**
 * 统一持久化桥接协议 —— 浏览器端（localStorage）实现
 *
 * 三端（桌面 exe / 手机 APK / 网页云端）通过替换本文件注入各自的 hostBridge 实现，
 * 统一核心应用 app.html 只依赖 window.hostBridge 这一套接口，不改业务代码。
 *
 * 接口契约（async）：
 *   hostBridge.info()                  -> { platform, label, capabilities }
 *   hostBridge.list()                  -> [{ id, name, updatedAt, size }]
 *   hostBridge.load(id)                -> config object | null
 *   hostBridge.save(id, config)        -> { ok, id, updatedAt }
 *   hostBridge.remove(id)              -> { ok }
 *   hostBridge.publish(topic, message) -> { ok }        // 发往消息队列（无通道时 ok:false）
 *   hostBridge.subscribe(topic, cb)    -> { ok }        // 订阅 topic，回调 (message)
 */
(function () {
  'use strict';

  var PREFIX = 'posterDelivery:cfg:';
  var IDX = 'posterDelivery:index';

  function readIndex() {
    try { return JSON.parse(localStorage.getItem(IDX) || '[]'); }
    catch (e) { return []; }
  }
  function writeIndex(idx) {
    localStorage.setItem(IDX, JSON.stringify(idx));
  }
  function now() {
    return new Date().toISOString();
  }

  var bridge = {
    info: function () {
      return Promise.resolve({
        platform: 'browser',
        label: '浏览器 · localStorage',
        capabilities: { persist: true, queue: false, filesystem: false }
      });
    },

    list: function () {
      var idx = readIndex();
      var out = idx.map(function (item) {
        var raw = localStorage.getItem(PREFIX + item.id) || '';
        return { id: item.id, name: item.name, updatedAt: item.updatedAt, size: raw.length };
      });
      out.sort(function (a, b) { return (b.updatedAt || '').localeCompare(a.updatedAt || ''); });
      return Promise.resolve(out);
    },

    load: function (id) {
      var raw = localStorage.getItem(PREFIX + id);
      if (!raw) return Promise.resolve(null);
      try { return Promise.resolve(JSON.parse(raw)); }
      catch (e) { return Promise.reject(new Error('配置解析失败: ' + id)); }
    },

    save: function (id, config) {
      var idx = readIndex();
      var t = now();
      var found = false;
      for (var i = 0; i < idx.length; i++) {
        if (idx[i].id === id) {
          idx[i].updatedAt = t;
          idx[i].name = config && config.meta && config.meta.configName || idx[i].name;
          found = true;
        }
      }
      if (!found) {
        idx.push({ id: id, name: (config && config.meta && config.meta.configName) || id, updatedAt: t });
      }
      localStorage.setItem(PREFIX + id, JSON.stringify(config));
      writeIndex(idx);
      return Promise.resolve({ ok: true, id: id, updatedAt: t });
    },

    remove: function (id) {
      localStorage.removeItem(PREFIX + id);
      writeIndex(readIndex().filter(function (x) { return x.id !== id; }));
      return Promise.resolve({ ok: true });
    },

    publish: function (topic, message) {
      // 浏览器无外部消息队列通道，记录到本地 outbox 供后续同步
      try {
        var outbox = JSON.parse(localStorage.getItem('posterDelivery:outbox') || '[]');
        outbox.push({ topic: topic, message: message, at: now() });
        localStorage.setItem('posterDelivery:outbox', JSON.stringify(outbox));
        return Promise.resolve({ ok: true, queued: 'local-outbox', note: '已暂存本地待同步队列' });
      } catch (e) {
        return Promise.resolve({ ok: false, note: '无可用消息队列通道' });
      }
    },

    subscribe: function (topic, cb) {
      // 浏览器端通过 storage 事件做跨标签页同步
      var handler = function (e) {
        if (e.key === 'posterDelivery:bus' && e.newValue) {
          try {
            var msg = JSON.parse(e.newValue);
            if (msg.topic === topic) cb(msg.message);
          } catch (err) { /* ignore */ }
        }
      };
      window.addEventListener('storage', handler);
      window.__posterUnsub = function () { window.removeEventListener('storage', handler); };
      return Promise.resolve({ ok: true, transport: 'storage-event' });
    }
  };

  window.hostBridge = bridge;
})();
