/**
 * 轻量文件持久化消息队列（File-backed MQ）
 * - append-only 日志：每个 topic 一个 .jsonl 文件，每行一条消息
 * - 消费位点：每个 subscriber 独立 offset，存 offsets.json
 * - 无外部依赖（Redis/RabbitMQ），适合单机云端与演示
 * 生产可替换为 RabbitMQ/Kafka，接口保持一致：publish / subscribe / replay
 */
'use strict';
const fs = require('fs');
const path = require('path');

class FileMQ {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.offsetFile = path.join(dir, '_offsets.json');
    this.subs = new Map(); // topic -> Set<fn>
    this._loadOffsets();
  }

  _loadOffsets() {
    try { this.offsets = JSON.parse(fs.readFileSync(this.offsetFile, 'utf8')); }
    catch (e) { this.offsets = {}; }
  }
  _saveOffsets() {
    fs.writeFileSync(this.offsetFile, JSON.stringify(this.offsets, null, 2));
  }
  _topicFile(topic) {
    const safe = String(topic).replace(/[^\w\-\u4e00-\u9fa5]/g, '_');
    return path.join(this.dir, safe + '.jsonl');
  }

  /** 发布一条消息，返回序号 */
  publish(topic, message) {
    const file = this._topicFile(topic);
    const idx = this._count(topic);
    const record = { seq: idx, topic, at: new Date().toISOString(), message };
    fs.appendFileSync(file, JSON.stringify(record) + '\n');
    // 广播给在线订阅者
    (this.subs.get(topic) || []).forEach(fn => {
      try { fn(record); } catch (e) { /* ignore consumer error */ }
    });
    return record;
  }

  _count(topic) {
    const file = this._topicFile(topic);
    if (!fs.existsSync(file)) return 0;
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length;
  }

  /** 列出某 topic 的消息（可指定 from seq） */
  replay(topic, from) {
    const file = this._topicFile(topic);
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line, i) => {
      try { return JSON.parse(line); } catch (e) { return { seq: i, raw: line }; }
    }).filter(r => from === undefined || r.seq >= from);
  }

  /** 订阅：cb(record)；返回取消订阅函数 */
  subscribe(topic, cb, consumerId) {
    if (!this.subs.has(topic)) this.subs.set(topic, new Set());
    this.subs.get(topic).add(cb);
    // 若有 consumerId，按位点回放未消费消息
    if (consumerId) {
      const key = consumerId + ':' + topic;
      const from = this.offsets[key] || 0;
      this.replay(topic, from).forEach(r => {
        try { cb(r); } catch (e) { /* ignore */ }
        this.offsets[key] = r.seq + 1;
      });
      this._saveOffsets();
    }
    return () => { const s = this.subs.get(topic); if (s) s.delete(cb); };
  }

  /** 提交消费位点 */
  ack(consumerId, topic, seq) {
    const key = consumerId + ':' + topic;
    this.offsets[key] = seq + 1;
    this._saveOffsets();
  }

  status() {
    const topics = {};
    fs.readdirSync(this.dir).filter(f => f.endsWith('.jsonl')).forEach(f => {
      topics[f.replace(/\.jsonl$/, '')] = fs.readFileSync(path.join(this.dir, f), 'utf8').split('\n').filter(Boolean).length;
    });
    return { topics, offsets: this.offsets };
  }
}

module.exports = { FileMQ };
