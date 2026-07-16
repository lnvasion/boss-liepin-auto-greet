/**
 * candidate-scorer.js — BOSS直聘版: 候选人打分引擎
 */

import { loadProfile } from './intention-learner.js';

const DEFAULT_WEIGHTS = {
  skills: 30, degree: 10, school: 10,
  workYears: 10, location: 10, position: 15,
  company: 10, salary: 5,
};

let _weights = { ...DEFAULT_WEIGHTS };
let _minScore = 40;

export function setWeights(w) { _weights = { ...DEFAULT_WEIGHTS, ...w }; }
export function getWeights() { return { ..._weights }; }
export function setMinScore(s) { _minScore = s; }
export function getMinScore() { return _minScore; }

function scoreSkills(card, profile) {
  const text = [
    card.title || '',
    card.description || '',
    card.education || '',
    card.lastWork || '',
    (card._pageData?.geekDesc?.content || card._pageData?.geekDesc || ''),
  ].join(' ').toLowerCase();

  const customKw = profile.customKeywords || [];
  const skillKw = profile.skillKeywords || [];
  const allKeywords = [...customKw, ...skillKw].slice(0, 20);

  if (allKeywords.length === 0) return Math.round(_weights.skills * 0.5);

  let matched = 0, totalWeight = 0;
  for (const kw of allKeywords) {
    const isCustom = customKw.includes(kw);
    const w = isCustom ? 2 : 1;
    totalWeight += w;
    if (text.includes(kw.toLowerCase())) matched += w;
  }
  if (totalWeight === 0) return Math.round(_weights.skills * 0.5);
  return Math.round(_weights.skills * (matched / totalWeight));
}

function scoreDegree(card, profile) {
  const degreeOrder = ['高中', '大专', '本科', '硕士', '博士', 'MBA', 'EMBA'];
  const cardDegree = card.degree || '';
  const requiredDegree = profile.degreeRequired || '本科';
  const cardIdx = degreeOrder.findIndex(d => cardDegree.includes(d));
  const reqIdx = degreeOrder.findIndex(d => requiredDegree.includes(d));
  if (cardIdx === -1 || reqIdx === -1) return Math.round(_weights.degree * 0.5);
  if (cardIdx >= reqIdx) return _weights.degree;
  if (cardIdx === reqIdx - 1) return Math.round(_weights.degree * 0.7);
  return Math.round(_weights.degree * 0.3);
}

function scoreSchool(card, profile) {
  const eduText = (card.education || '').toLowerCase();
  let score = 0;
  if (profile.prefer985211 && /985|211|双一流|清华|北大|复旦|交大|浙大|南大|武大|华科|中大|同济|人大|南开|厦大|哈工大|西交/i.test(eduText)) {
    score += _weights.school * 0.6;
  }
  if (profile.preferOverseas && /[a-z].*(university|college|institute|school)/i.test(eduText) &&
      !/中国|师范|理工|工业|科技|农业|林业|海洋|民族|政法|财经|外国语|中医药/i.test(eduText)) {
    score += _weights.school * 0.6;
  }
  if (score === 0 && /本科|学士|大学|学院/.test(eduText)) {
    score = Math.round(_weights.school * 0.3);
  }
  return Math.min(_weights.school, score);
}

function scoreWorkYears(card, profile) {
  const cardYears = parseInt(card.workYears) || 0;
  const minYears = profile.workYearsMin || 1;
  const maxYears = profile.workYearsMax || 10;
  const avgYears = profile.workYearsAvg || 3;
  if (cardYears === 0) return Math.round(_weights.workYears * 0.5);
  if (cardYears >= minYears && cardYears <= maxYears) return _weights.workYears;
  const dist = Math.abs(cardYears - avgYears);
  if (dist <= 2) return Math.round(_weights.workYears * 0.8);
  if (dist <= 5) return Math.round(_weights.workYears * 0.5);
  return Math.round(_weights.workYears * 0.2);
}

function scoreLocation(card, profile) {
  if (!profile.targetCities || profile.targetCities.length === 0) return Math.round(_weights.location * 0.5);
  const cardCities = [card.expectLocation || '', card.cityName || ''].map(c => c.toLowerCase());
  const targets = profile.targetCities.map(c => c.toLowerCase());
  for (const tc of targets) {
    for (const cc of cardCities) {
      if (cc && tc && (cc.includes(tc) || tc.includes(cc))) return _weights.location;
    }
  }
  return 0;
}

function scorePosition(card, profile) {
  const text = [card.expectPosition || '', card.title || '', card.lastWork || ''].join(' ').toLowerCase();
  const keywords = profile.skillKeywords?.slice(0, 10) || [];
  let matched = 0;
  for (const kw of keywords) {
    if (text.includes(kw.toLowerCase())) matched++;
  }
  if (keywords.length === 0) return Math.round(_weights.position * 0.5);
  return Math.round(_weights.position * (matched / Math.min(5, keywords.length)));
}

function scoreCompany(card, profile) {
  const companyText = (card.lastWork || '').toLowerCase();
  let score = 0;
  const bigNames = ['腾讯','阿里','百度','字节','美团','京东','网易','华为','小米',
    '德勤','普华永道','安永','毕马威','麦肯锡','波士顿','贝恩',
    '微软','谷歌','亚马逊','苹果','IBM','甲骨文','中金','中信','华泰',
    '四大','500强','上市','外企','央企','国企'];
  for (const name of bigNames) {
    if (companyText.includes(name.toLowerCase())) { score += _weights.company * 0.3; break; }
  }
  return Math.min(_weights.company, score + Math.round(_weights.company * 0.1));
}

function scoreSalary(card, profile) {
  return Math.round(_weights.salary * 0.5); // BOSS卡片通常无薪资信息
}

export function scoreCandidate(card, profile) {
  if (!profile) return { total: 100, details: {}, passed: true, reason: '无画像' };

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
    total: normalizedTotal, maxPossible: 100, details: scores, passed,
    reason: passed ? `达标 (${normalizedTotal}分)` : `未达标 (${normalizedTotal}分 < ${_minScore}分)`,
  };
}

export function filterCandidates(cards, profile, minScore) {
  if (minScore !== undefined) setMinScore(minScore);
  const passed = [], rejected = [];
  for (const card of cards) {
    const result = scoreCandidate(card, profile);
    card._score = result;
    (result.passed ? passed : rejected).push(card);
  }
  return { passed, rejected };
}
