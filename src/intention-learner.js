/**
 * intention-learner.js — BOSS直聘版: 从推荐页学习筛选画像
 *
 * 与猎聘不同, BOSS没有独立的"意向人选"页。
 * 策略: 从当前推荐页的候选人中建立画像
 */

const PROFILE_KEY = 'boss_filter_profile';

/**
 * 从文本提取关键词
 */
function extractKeywords(texts, stopWords) {
  const wordFreq = {};
  const stops = new Set(stopWords || ['的','了','在','是','和','与','及','或',
    '等','具备','拥有','具有','能力','方面','相关','以上','以下',
    '可以','能够','较强','良好','优秀','一定','熟悉','了解','掌握',
    '背景','经验','工作','负责','参与','从事','进行','完成',
    '1','2','3','4','5','6','7','8','9','0',
  ]);
  for (const text of texts) {
    if (!text) continue;
    const words = text.match(/[一-龥]{2,6}|[a-zA-Z]{3,}/g) || [];
    for (const w of words) {
      const lower = w.toLowerCase();
      if (stops.has(lower) || stops.has(w) || w.length < 2) continue;
      wordFreq[lower] = (wordFreq[lower] || 0) + 1;
    }
  }
  return Object.entries(wordFreq)
    .sort((a, b) => b[1] - a[1])
    .map(([word, count]) => ({ word, count }));
}

/**
 * 从卡片数组构建筛选画像
 * @param {Array} cards - cardScanner 解析的卡片数组 (需含 _pageData)
 * @returns {Object} 筛选画像
 */
export function buildProfile(cards) {
  if (!cards || cards.length === 0) return null;

  // 收集所有文本素材
  const texts = [];
  const degrees = [];
  const workYears = [];
  const cities = [];
  let has985211 = false, hasOverseas = false;

  for (const card of cards) {
    const d = card._pageData || {};
    // 文本: 职位标签 + 工作经历 + 个人描述
    if (card.title) texts.push(card.title);
    if (card.description) texts.push(card.description);
    if (d.geekDesc) texts.push(typeof d.geekDesc === 'string' ? d.geekDesc : d.geekDesc.content);
    if (d.geekLastWork?.responsibility) texts.push(d.geekLastWork.responsibility);

    // 学历
    if (d.geekDegree) degrees.push(d.geekDegree);
    if (d.eduLevelShow) degrees.push(d.eduLevelShow);

    // 经验
    if (d.geekWorkYear) {
      const y = parseInt(d.geekWorkYear);
      if (y > 0) workYears.push(y);
    }

    // 城市
    if (d.expectLocation) cities.push(d.expectLocation);
    if (d.cityName) cities.push(d.cityName);

    // 学校
    const eduList = d.showEdus || d.geekEdus || [];
    for (const edu of eduList) {
      const name = (edu.school || edu.expName || '');
      if (/985|211|双一流|清华|北大|复旦|交大|浙大|南大|武大|华科|中大|同济|人大|南开|厦大|哈工大|西交/i.test(name)) has985211 = true;
      if (/[a-zA-Z].*(University|College|Institute)/i.test(name) && !/中国|师范|理工|工业|科技|外语/i.test(name)) hasOverseas = true;
    }
  }

  // 分析
  const keywords = extractKeywords(texts, []);
  const skillKeywords = keywords.filter(k => k.count >= 2 && k.word.length >= 2).slice(0, 25);

  // 学历分布
  const degreeDist = {};
  for (const deg of degrees) {
    const d = deg.includes('硕士') ? '硕士' : deg.includes('博士') ? '博士' : deg.includes('本科') ? '本科' : deg.includes('大专') ? '大专' : deg;
    degreeDist[d] = (degreeDist[d] || 0) + 1;
  }
  const degreeSorted = Object.entries(degreeDist).sort((a, b) => b[1] - a[1]);

  // 经验
  const yrMin = workYears.length > 0 ? Math.min(...workYears) : 1;
  const yrMax = workYears.length > 0 ? Math.max(...workYears) : 10;
  const yrAvg = workYears.length > 0 ? Math.round(workYears.reduce((a, b) => a + b, 0) / workYears.length) : 3;

  // 城市
  const cityDist = {};
  for (const c of cities) {
    if (c && c.length > 1) cityDist[c] = (cityDist[c] || 0) + 1;
  }
  const topCities = Object.entries(cityDist).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // 学校层次
  let schoolTier = 0;
  if (has985211 && hasOverseas) schoolTier = 3;
  else if (has985211) schoolTier = 2;
  else if (hasOverseas) schoolTier = 3;
  else schoolTier = 1;

  const profile = {
    createdAt: Date.now(),
    source: 'boss_recommend',
    candidateCount: cards.length,
    skillKeywords: skillKeywords.map(k => k.word),
    degreeRequired: degreeSorted[0]?.[0] || '本科',
    degreeDistribution: degreeSorted,
    workYearsMin: yrMin,
    workYearsMax: yrMax,
    workYearsAvg: yrAvg,
    schoolTier,
    prefer985211: has985211,
    preferOverseas: hasOverseas,
    targetCities: topCities.map(([c]) => c),
    salaryMin: 0,
    salaryMax: 50000,
    industryKeywords: [],
    sampleCandidates: cards.slice(0, 3).map(c => ({
      name: c.name,
      age: c.ageDesc || '',
      degree: c.degree || '',
      workYears: c.workYears || '',
      school: c.education || '',
    })),
  };

  return profile;
}

export function saveProfile(profile) {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); return true; } catch (e) { return false; }
}

export function loadProfile() {
  try { const raw = localStorage.getItem(PROFILE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}

export function hasProfile() { return !!localStorage.getItem(PROFILE_KEY); }

export function getProfileSummary(profile) {
  if (!profile) return null;
  return {
    candidateCount: profile.candidateCount,
    topSkills: profile.skillKeywords?.slice(0, 8).join('、'),
    degree: profile.degreeRequired,
    workYears: `${profile.workYearsMin}-${profile.workYearsMax}年`,
    cities: profile.targetCities?.slice(0, 3).join('、'),
    createdAt: new Date(profile.createdAt).toLocaleString('zh-CN'),
  };
}
