/**
 * candidate-scorer.js — 候选人打分引擎
 *
 * 根据筛选画像对候选人进行多维度评分
 * 总分 100 分，各维度权重可配置
 */

import { loadProfile } from './intention-learner.js';

// 默认权重
const DEFAULT_WEIGHTS = {
  skills: 30,       // 技能关键词匹配
  degree: 10,       // 学历匹配
  school: 10,       // 学校层次
  workYears: 10,    // 经验年限
  location: 10,     // 城市匹配
  position: 15,     // 职位关键词匹配
  company: 10,      // 公司背景
  salary: 5,        // 薪资匹配
};

// 默认最低分数线
const DEFAULT_MIN_SCORE = 40;

let _weights = { ...DEFAULT_WEIGHTS };
let _minScore = DEFAULT_MIN_SCORE;

export function setWeights(w) { _weights = { ...DEFAULT_WEIGHTS, ...w }; }
export function getWeights() { return { ..._weights }; }
export function setMinScore(s) { _minScore = s; }
export function getMinScore() { return _minScore; }

/**
 * 技能关键词匹配分
 */
function scoreSkills(card, profile) {
  if (!profile.skillKeywords || profile.skillKeywords.length === 0) return _weights.skills;

  const text = [
    card.title || '',
    card.description || '',
    card.expectPosition || '',
    card.lastWork || '',
    card.education || '',
    (card._rawData?.matchReason || ''),
  ].join(' ').toLowerCase();

  let matched = 0;
  const keywords = profile.skillKeywords.slice(0, 15); // 取前15个最有区分度的
  for (const kw of keywords) {
    if (text.includes(kw.toLowerCase())) matched++;
  }

  if (keywords.length === 0) return _weights.skills * 0.5;
  const ratio = matched / keywords.length;
  return Math.round(_weights.skills * ratio);
}

/**
 * 学历匹配分
 */
function scoreDegree(card, profile) {
  const degreeOrder = ['高中', '大专', '本科', '硕士', '博士', 'MBA', 'EMBA'];
  const cardDegree = card.degree || '';
  const requiredDegree = profile.degreeRequired || '本科';

  const cardIdx = degreeOrder.findIndex(d => cardDegree.includes(d));
  const reqIdx = degreeOrder.findIndex(d => requiredDegree.includes(d));

  if (cardIdx === -1 || reqIdx === -1) return _weights.degree * 0.5;
  if (cardIdx >= reqIdx) return _weights.degree;
  if (cardIdx === reqIdx - 1) return Math.round(_weights.degree * 0.7);
  return Math.round(_weights.degree * 0.3);
}

/**
 * 学校层次分
 */
function scoreSchool(card, profile) {
  if (!profile.prefer985211 && !profile.preferOverseas) return _weights.school * 0.6;

  const eduText = (card.education || '').toLowerCase();
  let score = 0;

  if (profile.prefer985211 && /985|211|双一流|清华|北大|复旦|交大|浙大|南大|武大|华科|中大|同济|人大|南开|厦大|哈工大|西交/i.test(eduText)) {
    score += _weights.school * 0.6;
  }

  if (profile.preferOverseas && /[a-z].*(university|college|institute|school)/i.test(eduText) &&
      !/中国|师范|理工|工业|科技|农业|林业|海洋|民族|政法|财经|外国语|中医药/i.test(eduText)) {
    score += _weights.school * 0.6;
  }

  // 普通本科
  if (score === 0 && /本科|学士|大学|学院/.test(eduText)) {
    score = Math.round(_weights.school * 0.3);
  }

  return Math.min(_weights.school, score);
}

/**
 * 经验年限匹配分
 */
function scoreWorkYears(card, profile) {
  const cardYears = parseInt(card.workYears) || 0;
  const minYears = profile.workYearsMin || 1;
  const maxYears = profile.workYearsMax || 10;
  const avgYears = profile.workYearsAvg || 3;

  if (cardYears === 0) return Math.round(_weights.workYears * 0.5);
  if (cardYears >= minYears && cardYears <= maxYears) return _weights.workYears;

  // 越接近平均值分越高
  const dist = Math.abs(cardYears - avgYears);
  if (dist <= 2) return Math.round(_weights.workYears * 0.8);
  if (dist <= 5) return Math.round(_weights.workYears * 0.5);
  return Math.round(_weights.workYears * 0.2);
}

/**
 * 城市匹配分
 */
function scoreLocation(card, profile) {
  if (!profile.targetCities || profile.targetCities.length === 0) return _weights.location * 0.5;

  const cardCities = [
    card.expectLocation || '',
    card.cityName || '',
  ].map(c => c.toLowerCase());

  const targetCities = profile.targetCities.map(c => c.toLowerCase());

  for (const tc of targetCities) {
    for (const cc of cardCities) {
      if (cc && tc && (cc.includes(tc) || tc.includes(cc))) {
        return _weights.location;
      }
    }
  }

  return 0;
}

/**
 * 职位关键词匹配分
 */
function scorePosition(card, profile) {
  const positionText = [
    card.expectPosition || '',
    card.title || '',
    card.lastWork || '',
  ].join(' ').toLowerCase();

  // 从画像中提取职位相关关键词
  const jobTitle = (profile.jobTitle || '').toLowerCase();
  const industryKeywords = profile.industryKeywords || [];
  const skillKeywords = profile.skillKeywords || [];

  const allKeywords = [...new Set([...industryKeywords, ...skillKeywords])].slice(0, 10);
  let matched = 0;

  for (const kw of allKeywords) {
    if (positionText.includes(kw.toLowerCase())) matched++;
  }

  if (allKeywords.length === 0) return Math.round(_weights.position * 0.5);
  return Math.round(_weights.position * (matched / Math.min(5, allKeywords.length)));
}

/**
 * 公司背景分 (有大厂经历加分)
 */
function scoreCompany(card, profile) {
  const companyText = (card.lastWork || '').toLowerCase();
  let score = 0;

  // 知名公司加分
  const bigNames = ['腾讯', '阿里', '百度', '字节', '美团', '京东', '网易', '华为', '小米',
    '德勤', '普华永道', '安永', '毕马威', '麦肯锡', '波士顿', '贝恩',
    '微软', '谷歌', '亚马逊', '苹果', 'facebook', 'meta', 'IBM', '甲骨文',
    '中金', '中信', '华泰', '国泰君安', '海通', '广发', '招商', '兴业',
    '四大', '500强', '上市', '外企', '央企', '国企'];
  for (const name of bigNames) {
    if (companyText.includes(name.toLowerCase())) {
      score += _weights.company * 0.3;
      break;
    }
  }

  // 如果画像中的候选人来自某些公司, 看card是否也在类似公司
  if (profile.sampleCandidates) {
    for (const sample of profile.sampleCandidates) {
      const sampleCompany = (sample.lastWork || '').toLowerCase();
      if (sampleCompany && companyText.includes(sampleCompany)) {
        score += _weights.company * 0.4;
        break;
      }
    }
  }

  return Math.min(_weights.company, score + Math.round(_weights.company * 0.1));
}

/**
 * 薪资匹配分
 */
function scoreSalary(card, profile) {
  // card中可能没有直接薪资, 看jobWant
  const rawData = card._rawData || {};
  const wantSalary = rawData.jobWant?.wantSalary || '';
  const match = wantSalary.match(/(\d+)-(\d+)/);
  if (!match) return Math.round(_weights.salary * 0.5);

  const cardMin = parseInt(match[1]);
  const cardMax = parseInt(match[2]);
  const profileMin = profile.salaryMin || 0;
  const profileMax = profile.salaryMax || 50000;

  // 区间重叠度
  if (cardMax < profileMin || cardMin > profileMax) return 0;
  if (cardMin >= profileMin && cardMax <= profileMax) return _weights.salary;

  const overlap = Math.min(cardMax, profileMax) - Math.max(cardMin, profileMin);
  const cardRange = cardMax - cardMin || 1;
  return Math.round(_weights.salary * (overlap / cardRange));
}

/**
 * 主入口: 对候选人进行综合评分
 * @param {Object} card - cardScanner 解析的卡片对象
 * @param {Object} profile - 筛选画像 (null则跳过评分)
 * @returns {{ total: number, details: Object, passed: boolean }}
 */
export function scoreCandidate(card, profile) {
  if (!profile) {
    return { total: 100, details: {}, passed: true, reason: '无画像, 不过滤' };
  }

  const scores = {
    skills: scoreSkills(card, profile),
    degree: scoreDegree(card, profile),
    school: scoreSchool(card, profile),
    workYears: scoreWorkYears(card, profile),
    location: scoreLocation(card, profile),
    position: scorePosition(card, profile),
    company: scoreCompany(card, profile),
    salary: scoreSalary(card, profile),
  };

  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  const maxPossible = Object.values(_weights).reduce((a, b) => a + b, 0);
  const normalizedTotal = Math.round(total / maxPossible * 100);

  const passed = normalizedTotal >= _minScore;

  return {
    total: normalizedTotal,
    maxPossible: 100,
    details: scores,
    passed,
    reason: passed ? `达标 (${normalizedTotal}分)` : `未达标 (${normalizedTotal}分 < ${_minScore}分)`,
  };
}

/**
 * 批量评分并过滤
 * @returns {{ passed: Array, rejected: Array }}
 */
export function filterCandidates(cards, profile, minScore) {
  if (minScore !== undefined) setMinScore(minScore);

  const passed = [];
  const rejected = [];

  for (const card of cards) {
    const result = scoreCandidate(card, profile);
    card._score = result;

    if (result.passed) {
      passed.push(card);
    } else {
      rejected.push(card);
    }
  }

  return { passed, rejected };
}
