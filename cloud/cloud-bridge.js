/**
 * 云端桥接实现 —— 部署到云端时用它替换 bridge.js
 * 配置存到云端 REST API，消息队列通过 WebSocket 实时订阅 + REST 发布
 */
(function () {
  'use strict';
  var ORIGIN = (typeof location !== 'undefined' && location.origin) || 'http://localhost:8791';

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

  var ws = null;
  var subs = {}; // topic -> [cb]
  function ensureWS() {
    if (ws && ws.readyState <= 1) return;
    var topics = Object.keys(subs).join(',');
    ws = new WebSocket('ws' + ORIGIN.replace(/^http/, '') + '/ws?topic=' + encodeURIComponent(topics));
    ws.onmessage = function (e) {
      try {
        var m = JSON.parse(e.data);
        if (m.type === 'mq' && m.record) {
          (subs[m.record.topic] || []).forEach(function (cb) { cb(m.record.message || m.record); });
        }
      } catch (err) { /* ignore */ }
    };
    ws.onclose = function () { ws = null; };
  }

  window.hostBridge = {
    info: function () {
      return api('/api/info').then(function (i) {
        return { platform: i.platform, label: i.label, capabilities: i.capabilities, mq: i.mq };
      });
    },
    list: function () { return api('/api/configs'); },
    load: function (id) { return api('/api/config/' + encodeURIComponent(id)); },
    save: function (id, config) {
      return api('/api/config/' + encodeURIComponent(id), { method: 'POST', body: JSON.stringify(config) });
    },
    remove: function (id) { return api('/api/config/' + encodeURIComponent(id), { method: 'DELETE' }); },
    publish: function (topic, message) {
      return api('/api/publish', { method: 'POST', body: JSON.stringify({ topic: topic, message: message }) })
        .then(function (r) { return { ok: true, seq: r.seq, topic: r.topic, transport: 'cloud-broker' }; });
    },
    subscribe: function (topic, cb) {
      (subs[topic] = subs[topic] || []).push(cb);
      ensureWS();
      return Promise.resolve({ ok: true, transport: 'websocket' });
    }
  };
})();
