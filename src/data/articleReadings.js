// Short editorial reading editions, not copies of publisher articles.
// English is an AI translation of our Chinese edition, never publisher-original text.
export const articleReadings = {
  '20260903-autodesk-connected-aec-data': {
    kind: 'editorial', originalLanguage: 'zh', translationLabel: 'AI 译文 · 待校对',
    paragraphs: {
      zh: ['Autodesk 在 AU 2026 的数据议程中，将工程信息的连接、质量与全生命周期复用放在一起讨论。路线图覆盖细粒度数据的访问、结构化管理和可靠校验。', '相关活动包含数据策略分享、信息质量讨论及产品演示。它们描述了未来工作流的方向，不能据此认定具体项目已经实现自动化收益。', '编辑观察：引入 AI 前，可先检查设计、施工与运维之间的数据交接是否清晰，避免把信息不一致的问题带进自动化流程。'],
      en: ['Autodesk’s AU 2026 data agenda connects engineering information, quality and lifecycle reuse. Its roadmap addresses granular data access, structure and reliable validation.', 'Strategy sessions, information-quality discussions and demonstrations outline workflow directions. They do not establish that individual projects have achieved automation benefits.', 'Editorial perspective: Before adopting AI, examine data handovers between design, construction and operations to avoid carrying inconsistent information into automated workflows.'],
    },
  },
  '20260902-kier-ai-safety-agents': {
    kind: 'editorial', originalLanguage: 'zh', translationLabel: 'AI 译文 · 待校对',
    paragraphs: {
      zh: ['微软对 Kier 的采访介绍了两类早期安全智能体：一类整理安全数据，另一类将安全标准与现场照片、无人机视频关联。', '这些探索旨在帮助人员发现需要处理的风险。Kier 强调人员保持控制权；材料并未给出这些智能体经过独立验证的事故降低效果。', '编辑观察：试点应分别记录数据整理、风险提示和人工处置的结果，明确谁复核、谁决策，以及漏报如何追踪。'],
      en: ['Microsoft’s interview with Kier describes two early safety-agent efforts: organizing safety data and connecting safety standards with site photographs and drone footage.', 'These efforts aim to help people identify risks requiring action. Kier emphasizes human control; the article does not establish independently validated accident reductions from these agents.', 'Editorial perspective: Track data preparation, risk alerts and human responses separately. Specify who reviews and decides, and how missed risks are investigated.'],
    },
  },
  '20260901-autodesk-construction-innovation-sessions': {
    kind: 'editorial', originalLanguage: 'zh', translationLabel: 'AI 译文 · 待校对',
    paragraphs: {
      zh: ['Autodesk 的施工创新议程中，一项专题讨论如何将现场扫描与 Revit、Forma 及资产数据相连接，让数字孪生服务于工程决策。', '活动介绍提出利用 AI 识别偏差、关联模型构件和结构化数据，辅助协调与成本判断。这是课程预告，不能等同于已验证的现场表现。', '编辑观察：评估此类流程时，应核对扫描时间、构件标识和管理字段能否对应，并保留偏差识别的人工复核入口。'],
      en: ['An Autodesk construction session explores connecting site scans with Revit, Forma and asset data so digital twins can inform project decisions.', 'The preview describes AI-assisted deviation detection and links between model elements and structured data for coordination and cost decisions. A session preview does not establish validated field performance.', 'Editorial perspective: Check alignment between scan dates, element identifiers and management fields, and retain human review of detected deviations.'],
    },
  },
  '20260901-autodesk-transportation-ai-webinar': {
    kind: 'editorial', originalLanguage: 'zh', translationLabel: 'AI 译文 · 待校对',
    notice: '本次未能重新读取论坛原页；以下依据历史入库摘要整理，细节待复核。',
    paragraphs: {
      zh: ['历史入库信息记录了一场交通工程 AI 工作流分享，涉及点云中的铁路几何提取、机器学习辅助线路回归，以及 Civil 3D 和 ReCap 助手功能。', '本次无法重新读取论坛原页，因此不补充活动实录、工具性能或试验数据。具体功能范围仍应以发布方的原始材料为准。', '编辑观察：可从点云到线路几何的单一任务开始评估，明确输入质量、校核方法和工程师的最终审核责任。'],
      en: ['The historical record describes a transportation AI webinar covering railway geometry extraction from point clouds, machine-learning-assisted alignment regression, and Civil 3D and ReCap assistants.', 'The forum page could not be reread during this update. No session transcript, performance figures or test results are added; consult the publisher for the precise scope.', 'Editorial perspective: Start with one point-cloud-to-alignment task, defining input quality, validation and the engineer’s final review responsibility.'],
    },
  },
  '20260828-autodesk-research-aec-ai': {
    kind: 'editorial', originalLanguage: 'zh', translationLabel: 'AI 译文 · 待校对',
    paragraphs: {
      zh: ['Autodesk Research 的 AU 2026 议程涉及设计意图整理、施工世界模型、采集数据增强，以及协同多智能体对设计决策的支持。', '这些主题反映研究探索方向。议程本身不证明工具已适用于具体工程，也未形成可直接套用的部署条件或成效结论。', '编辑观察：关注前沿技术时，应先选定一个可验证的工程任务，界定数据范围和成功标准，再决定是否开展试点。'],
      en: ['Autodesk Research’s AU 2026 agenda covers design intent, construction world models, captured-data enrichment and collaborative agents supporting design decisions.', 'These topics indicate research directions. The agenda alone does not demonstrate suitability for a particular project or establish deployment requirements and outcomes.', 'Editorial perspective: Choose a verifiable engineering task, define the data boundary and success criteria, then decide whether a pilot is justified.'],
    },
  },
};
