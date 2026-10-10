// 土木 AI 雷达 · AI 日报结构化内参版式与工程阶段数据定义

export const dailySections = [
  {
    id: "site_deployment",
    number: "01",
    title: "示范工程与现场落地",
    enTitle: "Site & Project Deployments",
    badge: "现场试点",
    color: "#059669",
    description: "涵盖工程施工标段现场部署、央企数字化示范应用与关键重大基础设施运行反馈。",
  },
  {
    id: "software_machinery",
    number: "02",
    title: "软件算法与智能装备",
    enTitle: "Software & Intelligent Machinery",
    badge: "装备与软件",
    color: "#2563eb",
    description: "涵盖工程专用生成式设计、BIM数据路线、盾构自主掘进控制与激光点云现实捕捉算法。",
  },
  {
    id: "standards_policy",
    number: "03",
    title: "规程标准与行业资讯",
    enTitle: "Codes, Policy & Industry",
    badge: "规范与标准",
    color: "#d97706",
    description: "涵盖住建部/交通部/水利部规程标准导向、行业大赛赛题、知识检索助手及数据资产治理。",
  },
  {
    id: "research_global",
    number: "04",
    title: "学术前沿与海外观察",
    enTitle: "Research & Global Front",
    badge: "前沿研究",
    color: "#7c3aed",
    description: "涵盖权威工程学会（ASCE/IABSE）论文报告、世界模型与工程多智能体交叉探索成果。",
  },
];

export const engineeringStages = [
  "全部阶段",
  "勘察设计",
  "智慧施工",
  "运行维护",
  "防灾与水利",
];

export function getDailySectionId(entry) {
  if (entry.dailySection) return entry.dailySection;
  if (
    entry.id === "20260828-autodesk-research-aec-ai" ||
    entry.id === "overseas-bridge" ||
    entry.layer === "研究"
  ) {
    return "research_global";
  }
  if (
    entry.id === "water-knowledge" ||
    entry.id === "transport-competition" ||
    entry.layer === "赛事活动" ||
    entry.title.includes("规范") ||
    entry.title.includes("标准") ||
    entry.title.includes("赛")
  ) {
    return "standards_policy";
  }
  if (
    entry.id.includes("autodesk") ||
    entry.id === "tunnel-tbm-ai" ||
    entry.ai === "自适应控制" ||
    entry.layer === "行业活动" ||
    entry.title.includes("算法") ||
    entry.title.includes("软件") ||
    entry.title.includes("路线图")
  ) {
    return "software_machinery";
  }
  return "site_deployment";
}

export function formatDailyPlainText(entries, dateStr = "按公开日期归档") {
  const lines = [
    `【土木 AI 每日内参早报 · ${dateStr}】`,
    `本期收录 ${entries.length} 篇动态，请逐项查看核验状态与原始出处。`,
    "",
  ];

  for (const sec of dailySections) {
    const matched = entries.filter((e) => getDailySectionId(e) === sec.id);
    if (!matched.length) continue;
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━`);
    lines.push(`${sec.number} ${sec.title}（${matched.length} 篇）`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━`);
    matched.forEach((e, i) => {
      lines.push(`${i + 1}. 【${e.sector} · ${e.engineeringStage || e.layer}】${e.title}`);
      lines.push(`   • 信源：${e.source}（${e.region} · ${e.evidence}）`);
      lines.push(`   • 摘要：${e.summary}`);
      if (e.implication) {
        lines.push(`   • 启示：${e.implication}`);
      }
      lines.push(`   • 链接：${e.sourceUrl}`);
      lines.push("");
    });
  }

  lines.push(`─────────────`);
  lines.push(`来源：土木 AI 雷达 (Civil Intelligence) · 历史入库资料，核验状态以各条目记录为准`);
  return lines.join("\n");
}
