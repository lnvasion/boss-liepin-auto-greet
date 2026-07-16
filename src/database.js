/**
 * database.js — 候选人沟通记录数据库
 *
 * 存储: GM_setValue (Tampermonkey) → localStorage 降级
 * 格式: JSON 数组，每次沟通后追加
 * 支持: CSV/JSON 导出下载
 */
import { logger } from './logger.js';

const DB_KEY = 'boss_auto_records';

/** @typedef {{ id: string, name: string, description: string, greetedAt: number, dryRun: boolean, greetingSent: string, ageDesc: string, gender: string, workYears: string, degree: string, education: string, lastWork: string, expectLocation: string, expectPosition: string, activeTime: string }} CandidateRecord */

class CandidateDatabase {
  constructor() {
    this.records = [];
    this._loaded = false;
  }

  /**
   * 加载已有记录
   */
  load() {
    if (this._loaded) return;
    this._loaded = true;

    try {
      // 优先使用 GM_setValue (Tampermonkey 专有，更可靠)
      if (typeof GM_getValue === 'function') {
        const raw = GM_getValue(DB_KEY, '[]');
        this.records = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } else {
        const raw = localStorage.getItem(DB_KEY);
        this.records = raw ? JSON.parse(raw) : [];
      }
      logger.info('已加载 ' + this.records.length + ' 条历史沟通记录');
    } catch (e) {
      logger.warn('数据库加载失败，使用空库', e.message);
      this.records = [];
    }
  }

  /**
   * 持久化保存
   */
  _persist() {
    const json = JSON.stringify(this.records);
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(DB_KEY, json);
      }
    } catch (e) {
      // GM_setValue 失败时降级到 localStorage
      logger.debug('GM_setValue 失败，降级到 localStorage');
    }
    try {
      localStorage.setItem(DB_KEY, json);
    } catch (e) {
      logger.error('数据库保存失败 (localStorage 可能已满)', e.message);
    }
  }

  /**
   * 添加一条沟通记录
   * @param {Object} record
   */
  insert(record) {
    this.load();

    const entry = {
      id: record.id,
      name: record.name,
      description: record.description || '',
      greetedAt: Date.now(),
      dryRun: !!record.dryRun,
      greetingSent: record.greetingSent || '',
      ageDesc: record.ageDesc || '',
      gender: record.gender || '',
      workYears: record.workYears || '',
      degree: record.degree || '',
      education: record.education || '',
      lastWork: record.lastWork || '',
      expectLocation: record.expectLocation || '',
      expectPosition: record.expectPosition || '',
      activeTime: record.activeTime || '',
    };

    this.records.push(entry);
    this._persist();

    logger.debug('记录已保存: ' + record.name + ' (总计 ' + this.records.length + ' 条)');
  }

  /**
   * 检查是否已存在同 ID 记录
   */
  exists(id) {
    this.load();
    return this.records.some((r) => r.id === id);
  }

  /**
   * 获取总记录数
   */
  count() {
    return this.records.length;
  }

  /**
   * 获取今日记录数
   */
  todayCount() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cutoff = today.getTime();
    return this.records.filter((r) => r.greetedAt >= cutoff).length;
  }

  /**
   * 获取所有记录
   */
  getAll() {
    this.load();
    return [...this.records];
  }

  /**
   * 导出自定义时间范围的记录为 CSV 文本
   */
  exportCSV(fromDate, toDate) {
    this.load();
    const from = fromDate ? new Date(fromDate).getTime() : 0;
    const to = toDate ? new Date(toDate).getTime() : Infinity;

    let filtered = this.records.filter((r) => r.greetedAt >= from && r.greetedAt <= to);

    // CSV BOM for Excel Chinese support
    const BOM = '﻿';
    const header = '序号,姓名,性别,年龄,经验,学历,学校/专业,最近工作,期望城市,期望职位,活跃时间,简介,沟通时间,招呼语\n';
    const rows = filtered.map((r, i) => {
      const time = new Date(r.greetedAt).toLocaleString('zh-CN');
      const desc = (r.description || '').replace(/"/g, '""');
      const greeting = (r.greetingSent || '').replace(/"/g, '""');
      const education = (r.education || '').replace(/"/g, '""');
      const lastWork = (r.lastWork || '').replace(/"/g, '""');
      return `${i + 1},"${r.name}","${r.gender||''}","${r.ageDesc||''}","${r.workYears||''}","${r.degree||''}","${education}","${lastWork}","${r.expectLocation||''}","${r.expectPosition||''}","${r.activeTime||''}","${desc}","${time}","${greeting}"`;
    }).join('\n');

    return BOM + header + rows;
  }

  /**
   * 导出为 JSON
   */
  exportJSON() {
    this.load();
    return JSON.stringify(this.records, null, 2);
  }

  /**
   * 触发浏览器下载文件
   * @param {string} format - 'csv' | 'json'
   */
  download(format = 'csv') {
    const content = format === 'json' ? this.exportJSON() : this.exportCSV();
    const ext = format === 'json' ? 'json' : 'csv';
    const mime = format === 'json' ? 'application/json' : 'text/csv;charset=utf-8';
    const filename = `boss-candidates-${new Date().toISOString().slice(0,10)}.${ext}`;

    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);

    logger.success('已导出 ' + filename + ' (' + this.records.length + ' 条记录)');
  }

  /**
   * 清空所有记录（需确认）
   */
  clear() {
    this.records = [];
    this._persist();
    logger.warn('数据库已清空');
  }
}

export const candidateDB = new CandidateDatabase();
