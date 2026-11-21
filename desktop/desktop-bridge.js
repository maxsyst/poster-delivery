/**
 * 桌面端桥接实现 —— exe 本地服务注入
 * 配置持久化到本地 JSON 文件（exe 提供 REST），消息队列用本地文件队列 + 轮询订阅
 */
(function () {
  'use strict';
  var ORIGIN = (typeof location !== 'undefined' && location.protocol === 'http:')
    ? location.origin : 'http://127.0.0.1:8792';

  function api(path, opt) {
    opt = opt || {};
    opt.headers = Object.assign({ 'Content-Type': 'application/json' }, opt.headers || {});
    return fetch(ORIGIN + path, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
        return j;
      });
    });
  }

  var pollers = {};
  window.hostBridge = {
    info: function () {
      return api('/api/info').then(function (i) {
        return { platform: i.platform, label: i.label, capabilities: i.capabilities, dataDir: i.dataDir };
      });
    },
    list: function () { return api('/api/configs'); },
    load: function (id) { return api('/api/config/' + encodeURIComponent(id)); },
    save: function (id, config) { return api('/api/config/' + encodeURIComponent(id), { method: 'POST', body: JSON.stringify(config) }); },
    remove: function (id) { return api('/api/config/' + encodeURIComponent(id), { method: 'DELETE' }); },
    publish: function (topic, message) {
      return api('/api/publish', { method: 'POST', body: JSON.stringify({ topic: topic, message: message }) })
        .then(function (r) { return { ok: true, seq: r.seq, transport: 'local-file-queue' }; });
    },
    subscribe: function (topic, cb) {
      if (pollers[topic]) return Promise.resolve({ ok: true, transport: 'poll' });
      var last = -1;
      pollers[topic] = setInterval(function () {
        api('/api/mq/replay/' + encodeURIComponent(topic) + '?from=' + (last + 1))
          .then(function (items) {
            (items || []).forEach(function (r) { if (r.seq > last) { last = r.seq; cb(r.message || r); } });
          }).catch(function () {});
      }, 1500);
      return Promise.resolve({ ok: true, transport: 'poll' });
    }
  };
})();
