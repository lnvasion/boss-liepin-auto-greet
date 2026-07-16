/**
 * intention-learner.js — 从意向人选学习筛选画像
 *
 * Stage 1: 分析猎聘RPS付费服务筛选出的候选人
 *          提取共性特征，生成筛选画像
 * Stage 2: 画像存储到 localStorage，供推荐页使用
 */

const PROFILE_KEY = 'liepin_filter_profile';

/**
 * 从候选人文案中提取关键词
 */
function extractKeywords(texts, stopWords) {
  const wordFreq = {};
  const stops = new Set(stopWords || ['的', '了', '在', '是', '和', '与', '及', '或',
    '等', '等方', '具备', '拥有', '具有', '能力', '方面', '相关', '以上', '以下',
    '可以', '能够', '较强', '良好', '优秀', '一定', '熟悉', '了解', '掌握',
    '背景', '经验', '工作', '负责', '参与', '从事', '进行', '完成',
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '0',
  ]);

  for (const text of texts) {
    if (!text) continue;
    // 提取中文词组(2-6字)和英文单词(3+字母)
    const words = text.match(/[一-龥]{2,6}|[a-zA-Z]{3,}/g) || [];
    for (const w of words) {
      const lower = w.toLowerCase();
      if (stops.has(lower) || stops.has(w) || w.length < 2) continue;
      wordFreq[lower] = (wordFreq[lower] || 0) + 1;
    }
  }
  // 按频率排序
  return Object.entries(wordFreq)
    .sort((a, b) => b[1] - a[1])
    .map(([word, count]) => ({ word, count }));
}

/**
 * 分析学位分布
 */
function analyzeDegrees(candidates) {
  const dist = {};
  for (const c of candidates) {
    const d = c.eduLevelDesc || '未知';
    dist[d] = (dist[d] || 0) + 1;
  }
  const sorted = Object.entries(dist).sort((a, b) => b[1] - a[1]);
  return { distribution: sorted, minRequired: sorted[0]?.[0] || '本科' };
}

/**
 * 分析经验年限
 */
function analyzeWorkYears(candidates) {
  const years = candidates
    .map(c => parseInt(c.workYearDesc) || 0)
    .filter(y => y > 0);
  if (years.length === 0) return { min: 1, max: 10, avg: 3 };
  const sum = years.reduce((a, b) => a + b, 0);
  return {
    min: Math.min(...years),
    max: Math.max(...years),
    avg: Math.round(sum / years.length),
  };
}

/**
 * 分析学校层次
 */
function analyzeSchools(candidates) {
  let tier = 0; // 0=不限, 1=本科, 2=名校, 3=海归
  let has985211 = false;
  let hasOverseas = false;
  let hasRegular = false;

  for (const c of candidates) {
    const eduList = c.eduExpList || [];
    for (const edu of eduList) {
      const name = (edu.expName || '') + (edu.expSubTitle || '');
      if (/985|211|双一流|清华|北大|复旦|交大|浙大|南大|武大|华科|中大|同济|人大|南开|厦大|哈工大|西交/i.test(name)) {
        has985211 = true;
      }
      if (/[a-zA-Z].*大学|University|College|Institute/i.test(name) && !/中国|师范|理工|工业|科技|农业|林业|海洋|民族|政法|财经|外国语|中医药|药科|邮电|电子|石油|化工|地质|矿业|电力|水利|建筑|交通|航空|航天|海洋|体育|音乐|美术|戏剧|电影|舞蹈/i.test(name)) {
        hasOverseas = true;
      }
      hasRegular = true;
    }
  }

  if (has985211 && hasOverseas) tier = 3;
  else if (has985211) tier = 2;
  else if (hasOverseas) tier = 3;
  else if (hasRegular) tier = 1;

  return { tier, has985211, hasOverseas };
}

/**
 * 分析期望薪资范围
 */
function analyzeSalary(candidates) {
  let minSal = Infinity, maxSal = 0;
  for (const c of candidates) {
    const s = c.salaryDesc || '';
    const match = s.match(/(\d+)-(\d+)/);
    if (match) {
      minSal = Math.min(minSal, parseInt(match[1]));
      maxSal = Math.max(maxSal, parseInt(match[2]));
    }
  }
  return {
    min: minSal === Infinity ? 0 : minSal,
    max: maxSal === 0 ? 50000 : maxSal,
  };
}

/**
 * 分析意向城市分布
 */
function analyzeCities(candidates) {
  const dist = {};
  for (const c of candidates) {
    const city = c.dqName || c.dqClarification?.dqName || '未知';
    dist[city] = (dist[city] || 0) + 1;
  }
  return Object.entries(dist).sort((a, b) => b[1] - a[1]);
}

/**
 * 分析行业/职能 (从matchReason提取)
 */
function analyzeIndustry(candidates) {
  const allReasons = candidates.map(c => c.matchReason || '').filter(Boolean);
  const keywords = extractKeywords(allReasons, []);
  return keywords.slice(0, 20);
}

/**
 * 主入口: 从候选数据构建筛选画像
 * @param {Array} candidates - get-candidate-list 返回的 data 数组
 * @returns {Object} 筛选画像
 */
export function buildProfile(candidates) {
  if (!candidates || candidates.length === 0) return null;

  // 提取所有matchReason作为分析素材
  const reasons = candidates.map(c => c.matchReason || '');
  const titles = candidates.map(c => c.ejobTitle || '');
  const allText = [...reasons, ...titles];

  // 综合关键词
  const keywords = extractKeywords(reasons, []);
  const skillKeywords = keywords.filter(k =>
    !/^\d/.test(k.word) &&
    !/年|月|日/.test(k.word) &&
    k.word.length >= 2
  ).slice(0, 30);

  const degrees = analyzeDegrees(candidates);
  const workYears = analyzeWorkYears(candidates);
  const schools = analyzeSchools(candidates);
  const salary = analyzeSalary(candidates);
  const cities = analyzeCities(candidates);
  const industry = analyzeIndustry(candidates);

  const profile = {
    createdAt: Date.now(),
    source: 'intention_candidates',
    candidateCount: candidates.length,
    jobTitle: candidates[0]?.ejobTitle || '',

    // 技能关键词 (权重最高)
    skillKeywords: skillKeywords.map(k => k.word),

    // 学历要求
    degreeRequired: degrees.minRequired,
    degreeDistribution: degrees.distribution,

    // 经验要求
    workYearsMin: workYears.min,
    workYearsMax: workYears.max,
    workYearsAvg: workYears.avg,

    // 学校层次
    schoolTier: schools.tier,
    prefer985211: schools.has985211,
    preferOverseas: schools.hasOverseas,

    // 薪资范围
    salaryMin: salary.min,
    salaryMax: salary.max,

    // 目标城市
    targetCities: cities.slice(0, 5).map(([city]) => city),

    // 行业关键词
    industryKeywords: industry.map(k => k.word),

    // 原始数据摘要
    sampleCandidates: candidates.slice(0, 3).map(c => ({
      name: c.userName,
      age: c.ageDesc,
      degree: c.eduLevelDesc,
      workYears: c.workYearDesc,
      school: c.eduExpList?.[0]?.expName || '',
      reason: c.matchReason || '',
    })),
  };

  return profile;
}

/**
 * 保存画像到 localStorage
 */
export function saveProfile(profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 加载画像
 */
export function loadProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/**
 * 检查是否已有画像
 */
export function hasProfile() {
  return !!localStorage.getItem(PROFILE_KEY);
}

/**
 * 初始化意向页自动学习
 * Hook API 响应, 自动构建并保存画像
 */
export function initIntentionLearner() {
  // Hook XHR to capture get-candidate-list response
  const OX = XMLHttpRequest;
  const origSend = OX.prototype.send;
  OX.prototype.send = function (body) {
    const xhr = this;
    xhr.addEventListener('loadend', () => {
      try {
        const url = String(xhr._lp_url || '');
        if (url.includes('get-candidate-list')) {
          const data = JSON.parse(xhr.responseText);
          if (data?.flag === 1 && Array.isArray(data?.data)) {
            const candidates = data.data;
            const profile = buildProfile(candidates);
            if (profile) {
              saveProfile(profile);
              showLearnNotification(profile);
            }
          }
        }
      } catch (e) { /* ignore */ }
    });
    return origSend.call(this, body);
  };
  const origOpen = OX.prototype.open;
  OX.prototype.open = function (method, url) {
    this._lp_url = url;
    return origOpen.apply(this, arguments);
  };

  // Hook fetch too
  const OF = window.fetch;
  window.fetch = function () {
    const args = arguments;
    const url = String(args[0]?.url || args[0] || '');
    return OF.apply(this, args).then(async (r) => {
      if (url.includes('get-candidate-list')) {
        const clone = r.clone();
        try {
          const data = await clone.json();
          if (data?.flag === 1 && Array.isArray(data?.data)) {
            const profile = buildProfile(data.data);
            if (profile) {
              saveProfile(profile);
              showLearnNotification(profile);
            }
          }
        } catch (e) { /* ignore */ }
      }
      return r;
    });
  };
}

/**
 * 页面通知
 */
function showLearnNotification(profile) {
  const summary = getProfileSummary(profile);
  if (!summary) return;

  const existing = document.getElementById('liepin-learn-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'liepin-learn-toast';
  toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#1a1a2e;color:#52c41a;padding:14px 20px;border-radius:8px;z-index:9999999;font:13px/1.6 sans-serif;box-shadow:0 4px 24px rgba(0,0,0,0.5);text-align:center;';
  toast.innerHTML = '<b>✅ 筛选画像已生成！</b><br>' +
    '职位: ' + summary.jobTitle + '<br>' +
    '分析候选人: ' + summary.candidateCount + '人<br>' +
    '关键技能: ' + summary.topSkills + '<br>' +
    '学历要求: ' + summary.degree + ' | 经验: ' + summary.workYears + '<br>' +
    '目标城市: ' + summary.cities + '<br>' +
    '<span style="color:#fa8c16;">现在去推荐页即可按此画像筛选</span>';
  document.body.appendChild(toast);
  setTimeout(() => { toast.remove(); }, 8000);
}

/**
 * 获取画像摘要 (UI显示用)
 */
export function getProfileSummary(profile) {
  if (!profile) return null;
  return {
    candidateCount: profile.candidateCount,
    jobTitle: profile.jobTitle,
    topSkills: profile.skillKeywords?.slice(0, 8).join('、'),
    degree: profile.degreeRequired,
    workYears: `${profile.workYearsMin}-${profile.workYearsMax}年`,
    cities: profile.targetCities?.slice(0, 3).join('、'),
    createdAt: new Date(profile.createdAt).toLocaleString('zh-CN'),
  };
}
