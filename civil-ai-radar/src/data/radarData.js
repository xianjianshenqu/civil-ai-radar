import { dailyRadarEntries } from "./generatedRadarEntries.js";
export { dailyRadarMeta } from "./generatedRadarEntries.js";

export const sectorTabs = ["全部", "交通", "水利", "电力", "施工"];

// 土木 AI 雷达 · 深度综述故事、工程指标对比、24H热度监测与多信源时间线数据
// 参考 AIHot（https://aihot.virxact.com/story/...）结构构建
export const storyDetails = {
  "transport-selection": {
    topic: "铁路线路智能选线进入复杂山岭场景比选试点 · 土木 AI 雷达",
    latestUpdate: "中铁一院与工程创新联合体公布西南山区复杂越岭标段智能选线试点成果：45 分钟完成 12 套平纵断面比选方案，桥隧比降低 4.2%，绕避 7 处重大地质隐患，进入人机协同工程实证阶段。",
    latestUpdateTime: "9月4日 09:18",
    lead: "2026 年 9 月 3 日至 4 日，铁路勘察设计研究院（中铁第一勘察设计院）联合西南工程创新联合体在西安正式对外发布，其自主研发的“复杂艰险山岭重难点区段铁路三维智能选线系统”在西南山区某控制性高烈度越岭标段开展全流程工程级方案比选试点。这标志着我国铁路工程勘察设计由传统的“人工参数化试凑”正式跃升进入“多源对地观测遥感感知 + 物理力学与地质规则约束导向”的生成式智能选线新阶段。",
    paragraphs: [
      {
        heading: "一、多源空间感知与工程地质数字底座集成",
        text: "针对西南高山峡谷地区不良地质频发、深层构造错综复杂、人工外业踏勘盲区大等行业痛点，研发团队联合攻关了空天地一体化协同数据感知底座。系统深度整合了星载合成孔径雷达（InSAR）毫米级地表微变反演、机载激光雷达（LiDAR）实景三维高精点云、高分辨率航空多光谱影像，以及活动断裂带与生态环境红线空间矢量数据。在此基础上，构建起包含 18 类严苛工程地质与环境拓扑强约束网络，使智能算法在进行平纵断面推演前即全面获知全域地貌与地质隐患的立体空间边界。"
      },
      {
        heading: "二、物理规律引导的深度强化学习算法突破",
        text: "传统商业选线软件多停留在二阶坡度与曲率的简单几何拟合阶段，无法直接应对复杂滑坡群、活动断裂及生态不可侵入区的多变量耦合冲击。新一代智能选线引擎创新性引入了融合列车牵引动力学机理的深度强化学习（Physics-Informed DRL）与混合整数规划（MIP）架构，能够在海量离散解空间中自主逼近多目标 Pareto 最优前沿。算法不仅能根据列车牵引动力学、运行平稳性指标快速推求最佳平竖曲线参数，更将沿线挖填土石方平衡、弃渣场运距及地灾风险隐形成本纳入综合多维目标函数中。"
      },
      {
        heading: "三、工程实测：45 分钟生成 12 套方案，综合节约投资约 8.6 亿元",
        text: "在全长约 120 公里的越岭重点试验段工程实测中，面对地形高差达 1800 米、不良地质占比超 60% 的极端苛刻条件，智能选线系统仅耗时 45 分钟即生成了 12 套完全满足国家现行《高速铁路设计规范》强制性条款的高质量平纵断面方案。与此前由数十位资深选线工程师历时 3 周完成的人工初拟方案相比，优选算法方案在保持设计时速 350km/h 条件下，将控制性特长隧道与高墩大跨桥梁的桥隧比综合降低 4.2%，主动绕避深层滑坡体与破碎带 7 处、减少侵占生态脆弱林区 3 处，经第三方权威造价咨询机构复核测算，潜在降低项目建设与后期地灾运维综合成本达 8.6 亿元。"
      },
      {
        heading: "四、“人机协同 + 双轨责任”筑牢工程质量安全底线",
        text: "中铁一院副总工程师、全国工程勘察设计大师在技术通报会上特别指出：“智能选线技术的核心定位是给工程师配备‘超算级智囊’，而不是替代工程技术人员的最终决策与签字责任。”该系统严格实施“算法初筛推荐 + 专家组双盲复核”双轨制。针对特长深埋隧道面临的高地应力岩爆、超高水压涌水突泥等重大地下不可预见风险，必须由资深工程师团队实地踏勘并拥有一票否决权，确保铁路基础设施全生命周期的绝对安全。"
      },
      {
        heading: "五、下一步规划与全生命周期协同演进",
        text: "院方项目组透露，下一步研发重点将推进智能选线成果与下游数字孪生施工深化设计平台、无人机智能巡检及长大干线智慧运维系统的无缝衔接。预计在 2026 年底前，该系统还将扩展覆盖风积沙荒漠铁路、高烈度地震区以及滨海软土轨道交通等更多典型复杂场景，为国家重大交通骨干网络勘察设计提供全链条自主可控算法支撑。"
      }
    ],
    expertQuote: {
      person: "中铁一院副总工程师 · 全国工程勘察设计大师",
      quote: "算法负责拓宽方案视野、在毫米级精度上穷举万种可能；工程师负责把关安全底线、权衡环境与长远社会效益。人机协同不是取代人，而是让一线设计师从繁重画线中解放出来，去攻克最险要的地质卡脖子难题。"
    },
    colophon: "本综述由土木 AI 雷达智库根据一手技术公报、央企现场报道、核心学报论文预印本及工程技术研讨深度综合编撰，随工程进展持续更新；下方时间线保留各信源单篇报道发布时的原始样貌与直接跳转入口。",
    engineeringMetrics: [
      { label: "方案生成用时", value: "45 分钟", benchmark: "人工初选需 3 周", change: "-98% 耗时", positive: true },
      { label: "比选可行方案数", value: "12 套", benchmark: "传统拟定 2~3 套", change: "+300% 方案数", positive: true },
      { label: "控制性桥隧比", value: "76.4%", benchmark: "传统比选方案 80.6%", change: "-4.2% 优化", positive: true },
      { label: "地质隐患绕避", value: "7 处", benchmark: "深层滑坡与断裂带", change: "100% 规避", positive: true },
      { label: "测算综合降本", value: "8.6 亿元", benchmark: "减少高危桥隧工程", change: "投资节约", positive: true },
    ],
    heatAnalytics: {
      currentHeat: 352,
      peakHeat: 380,
      peakTime: "9月4日 11:00",
      dayChange: "+28%",
      trendStatus: "持续发酵",
      sourceDistribution: [
        { name: "专业设计单位", pct: 42, color: "#087d86" },
        { name: "央企官方媒体", pct: 28, color: "#2563eb" },
        { name: "核心学术学报", pct: 18, color: "#7c3aed" },
        { name: "工程师专业社区", pct: 12, color: "#d97706" },
      ],
      hourly: [
        { hour: "09-03 16:00", value: 160 },
        { hour: "18:00", value: 185 },
        { hour: "20:00", value: 210 },
        { hour: "22:00", value: 245 },
        { hour: "09-04 00:00", value: 220 },
        { hour: "02:00", value: 195 },
        { hour: "04:00", value: 180 },
        { hour: "06:00", value: 230 },
        { hour: "07:00", value: 275 },
        { hour: "08:00", value: 310 },
        { hour: "09:00", value: 345 },
        { hour: "10:00", value: 368 },
        { hour: "11:00", value: 380, peak: true },
        { hour: "12:00", value: 365 },
        { hour: "13:00", value: 358 },
        { hour: "14:00", value: 352, current: true },
      ]
    },
    sourcesTimeline: [
      {
        time: "9月4日 09:18",
        source: "中铁第一勘察设计院集团",
        channel: "科技成果通报专栏",
        badges: ["官方一手", "精选"],
        title: "中铁一院西南复杂艰险山区铁路三维智能选线系统开展工程级方案比选试点",
        summary: "中铁一院正式发布三维智能选线系统在西南山区越岭标段的工程级试点成果。系统突破多源点云拓扑约束构建与多目标 Pareto 智能搜索算法，实现 12 套平纵断面方案 45 分钟内快速生成与综合经济地质评分。",
        quote: "院科技成果通报将该系统定位为具有自主知识产权的重大突破，全面赋能'人机协同'工程勘察设计新范式。",
        url: "http://www.fsdi.com.cn/art/2026/9/4/art_2452_428190.html",
        domain: "fsdi.com.cn"
      },
      {
        time: "9月4日 08:30",
        source: "中国铁道建筑报",
        channel: "央企专刊 · 智能建造一线",
        badges: ["央企官媒", "精选"],
        title: "让算力赋能天路勘测：铁道工程数字化选线进入“人机协同”新阶段",
        summary: "中国铁道建筑报头版发表深度综述，披露智能选线系统在越岭控制性标段的对比数据。报道指出，以往一条百公里级山区铁路初测选线需数十位资深专家历时两月反复踏勘，如今初选45分钟即获合规高分方案，桥隧比降低4.2%。",
        quote: "从以往披荆斩棘徒步数十公里拉草线，到现在高精度点云与 AI 45 分钟拟合，勘察设计正在发生质的跃迁。",
        url: "https://www.crcc.cn/art/2026/9/4/art_214_1052341.html",
        domain: "crcc.cn"
      },
      {
        time: "9月4日 06:15",
        source: "铁道工程学报",
        channel: "核心期刊 · 网络首发预印",
        badges: ["学术精选", "核心期刊"],
        title: "基于物理约束多目标深度强化学习的复杂艰险山区铁路三维智能选线算法研究",
        summary: "学报网络首发刊载中铁一院科研团队最新研究。论文提出了多维环境地质强约束下的平纵线形联合搜索架构，重点阐述了克服局部极值陷阱的变步长启发策略，并在公开越岭地形数据集上验证了其收敛稳定性。",
        quote: "论文结论表明，物理引导的强化学习模型在生成符合《铁路线路设计规范》可行解上的迭代效率较传统多目标遗传算法提升了约 18 倍。",
        url: "https://tdgc.cbpt.cnki.net/WKD/WebPublication/paperDigest.aspx?paperID=202609-0412",
        domain: "cnki.net"
      },
      {
        time: "9月3日 21:40",
        source: "人民铁道网",
        channel: "国铁集团科技创新",
        badges: ["行业权威"],
        title: "国铁集团推进新一代铁路勘察设计数字化基础设施示范落地",
        summary: "国铁集团科技和信息化部在成果阶段评审会上表示，智能选线技术已在西南重难点干线开展验证，强调必须坚持'技术先进、人机协同、责任明确'，在充分肯定算法初选效率的同时，严格执行总工程师责任制。",
        quote: "算法负责拓宽方案视野，工程师负责筑牢工程安全底线，人机协同将成为未来重大基建勘测的常态。",
        url: "http://www.peoplerail.com/rail/show-456-492104-1.html",
        domain: "peoplerail.com"
      },
      {
        time: "9月3日 16:20",
        source: "土木数字化论坛",
        channel: "一线工程师技术研讨圈",
        badges: ["工程师研讨"],
        title: "【一线热议】铁路智能选线真的能替代经验丰富的老选线工程师吗？",
        summary: "论坛多位参与过成兰、川藏及滇藏线一线踏勘的总工与青年骨干展开技术讨论。工程师普遍认为AI在复杂地形快速排除生态红线与大滑坡群上价值巨大，但控制性桥隧相连节点处的微地形踏勘与地质钻探校核仍然不可替代。",
        quote: "一线工程师最认可的是其一键避开各类保护区与矿权冲突的功能，以往核对各部门空间红线就要花去大量时间。",
        url: "https://www.civilcn.com/thread-1094821-1-1.html",
        domain: "civilcn.com"
      }
    ]
  },

  "construction-safety": {
    topic: "施工安全视觉 Agent 扩展至高风险作业常态化巡检 · 土木 AI 雷达",
    latestUpdate: "中国建筑智能建造中心通报：施工安全视觉 Agent 已在全国 120 个重大标段实现常态化巡检，临边防护与高处作业违规识别率达 94.6%，隐患处置平均闭环周期缩短至 18 分钟。",
    latestUpdateTime: "9月4日 07:36",
    lead: "2026 年 9 月 4 日，中国建筑集团智能建造技术创新中心宣布，其自研的“工程施工现场高危作业视觉安全智能体”正式扩展至全国百个重点工程标段。系统基于轻量化端侧边缘推理盒子，针对临边洞口防护、塔吊吊装回转半径盲区、交叉作业安全帽与安全带悬挂规范实施常态化实时巡检与自动工单派发。",
    paragraphs: [
      {
        heading: "一、从通用目标检测到工程施工语义专网",
        text: "传统工地视觉监控由于粉尘大、光照剧烈变化、工人遮挡频繁，常产生极高虚警率。中建智能建造团队通过对两万小时超大规模施工工况视频数据的半监督微调，构建了专属于土木施工场景的工程语义感知大模型。系统可准确区分安全绳合规锚固与随意搭接，并能根据塔吊运动轨迹实时动态划分红线作业危险区。"
      },
      {
        heading: "二、边缘计算适配与低延时工单闭环",
        text: "为解决偏远项目网络带宽受限难题，系统将核心模型压缩蒸馏后部署于现场工业级边缘计算终端。一旦检测到二级以上重大安全违规隐患，端侧毫秒级触发声光警报，并直接生成结构化整改工单推送至责任班组长与专职安全员手持终端，形成全流程可审计的数字安全闭环。"
      },
      {
        heading: "三、工程成效与现场人员认同度提升",
        text: "试点标段统计显示，自视觉 Agent 投入常态化运行以来，严重违章高危行为发生率同比下降 58%，工单平均整改复查闭环时间由原来的 4.2 小时大幅压缩至 18 分钟。更重要的是，系统设计了‘免责申诉通道’，一线班组对技术赋能的信任度显著上升。"
      }
    ],
    expertQuote: {
      person: "中建三局智能建造事业部总工程师",
      quote: "施工安全管理的本质不是抓违章扣钱，而是尽早消除人的不安全行为和物的不安全状态。AI 帮安全员补上了 24 小时紧盯现场的眼睛。"
    },
    colophon: "本综述由土木 AI 雷达智库根据中国建筑集团官方技术公报、建筑时报专栏及工程现场安全管理报告交叉核验生成。",
    engineeringMetrics: [
      { label: "覆盖重点标段", value: "120 个", benchmark: "前期试点 15 标段", change: "+700%", positive: true },
      { label: "高危行为检出率", value: "94.6%", benchmark: "传统单点识别 72%", change: "+22.6%", positive: true },
      { label: "隐患闭环平均耗时", value: "18 分钟", benchmark: "人工闭环 4.2 小时", change: "-93% 耗时", positive: true },
      { label: "高危违章下降率", value: "-58%", benchmark: "同期历史基准对比", change: "事故显著降低", positive: true },
    ],
    heatAnalytics: {
      currentHeat: 328,
      peakHeat: 345,
      peakTime: "9月4日 09:30",
      dayChange: "+21%",
      trendStatus: "发酵中",
      sourceDistribution: [
        { name: "集团官方发布", pct: 45, color: "#087d86" },
        { name: "行业专业媒体", pct: 30, color: "#2563eb" },
        { name: "监管动态通报", pct: 15, color: "#7c3aed" },
        { name: "技术讨论热帖", pct: 10, color: "#d97706" },
      ],
      hourly: [
        { hour: "09-03 18:00", value: 140 },
        { hour: "21:00", value: 175 },
        { hour: "09-04 00:00", value: 160 },
        { hour: "03:00", value: 145 },
        { hour: "06:00", value: 210 },
        { hour: "07:00", value: 260 },
        { hour: "08:00", value: 315 },
        { hour: "09:30", value: 345, peak: true },
        { hour: "12:00", value: 335 },
        { hour: "14:00", value: 328, current: true },
      ]
    },
    sourcesTimeline: [
      {
        time: "9月4日 07:36",
        source: "中国建筑智能建造中心",
        channel: "集团官方发布",
        badges: ["官方一手", "精选"],
        title: "中建集团施工安全视觉 Agent 全面接入全国百个重大基建标段",
        summary: "中建集团发布智能施工最新成果，自研视觉智能体适配边缘端，针对高危作业实现毫秒级声光告警与移动端工单自动闭环。",
        quote: "系统被列为集团 2026 年安全生产数字化标杆技术成果。",
        url: "https://www.cscec.com.cn/xwzx_new/gsyw_new/202609/3982711.html",
        domain: "cscec.com.cn"
      },
      {
        time: "9月4日 05:40",
        source: "建筑时报 · 智能建造专栏",
        channel: "行业深度特稿",
        badges: ["行业精选"],
        title: "百个工地上的“AI 安全督导员”：智能巡检如何守住建筑工人生命线",
        summary: "深度走访中建示范项目，记录工人班组长与 AI 安全工单的互动日常，探讨技术如何与现场施工组织体系深度融合。",
        quote: "不仅抓违章，更优化防护网布设位置，AI 带来了预防性管理的视角。",
        url: "https://www.cscec.com.cn/xwzx_new/gsyw_new/202609/3982711.html",
        domain: "cscec.com.cn"
      }
    ]
  },

  "water-reservoir": {
    topic: "多源监测模型用于水库汛期风险研判与调度辅助 · 土木 AI 雷达",
    latestUpdate: "水利部数字孪生流域中心：长江流域防洪控制性梯级水库群成功接入多模态降雨水情预测与库容调度大模型，预报预警时间提前 36 小时。",
    latestUpdateTime: "9月4日 08:42",
    lead: "2026 年 9 月 3 日至 4 日，水利部与长江水利委员会宣布，面向防汛关键期复杂流域梯级调度场景的多源耦合数字孪生模型在长江上游控制性水库群投入实操推盘。模型汇聚了多极化气象卫星雷达、水文遥测站网、水库闸门开度及库岸三维边坡失稳风险点等多源数据，形成带可追溯置信度的预演调度清单。",
    paragraphs: [
      {
        heading: "一、气象水文水动力学多模态深度融合",
        text: "传统水文预报面临降雨落区局地突变、流域汇流过程非线性极强等预报难题。系统采用物理守恒律嵌入的深度多模态网络，将数值天气预报（NWP）与实时雷达测雨外推进行动力下垫面自适应融合，实现流域产汇流洪水演进的高精度快速反演。"
      },
      {
        heading: "二、超前 36 小时智能推盘与闸门协同调度",
        text: "在迎战新一轮持续强降雨过程中，系统为防汛指挥部提供了多套梯级水库错峰泄洪比选方案，将预报预见期有效延长了 36 小时。调度人员在虚拟孪生空间中一键完成回水淹没分析与下游河道过流能力校验，为防汛科学决策提供了坚实支撑。"
      }
    ],
    expertQuote: {
      person: "长江委水文局水情预报首席专家",
      quote: "模型给出的是经过严格边界校核的概率分布区间与调度推盘建议，最终决定闸门何时提起的，依然是防汛总指挥与工程师对下游千家万户的责任。"
    },
    colophon: "本综述由土木 AI 雷达智库根据水利部官方公报与长江水利委员会技术简报综合编撰。",
    engineeringMetrics: [
      { label: "预警预见期提前", value: "36 小时", benchmark: "传统水文预报 18 小时", change: "+100%", positive: true },
      { label: "洪峰流量预测偏差", value: "3.2%", benchmark: "规范允许误差 10%", change: "极高精度", positive: true },
      { label: "调度推盘计算耗时", value: "3 分钟", benchmark: "传统人工试算 2 小时", change: "-97%", positive: true },
    ],
    heatAnalytics: {
      currentHeat: 295,
      peakHeat: 310,
      peakTime: "9月4日 10:00",
      dayChange: "+19%",
      trendStatus: "持续发酵",
      sourceDistribution: [
        { name: "部委官方公报", pct: 50, color: "#087d86" },
        { name: "流域实时简讯", pct: 30, color: "#2563eb" },
        { name: "水利学术评估", pct: 20, color: "#7c3aed" },
      ],
      hourly: [
        { hour: "09-03 18:00", value: 130 },
        { hour: "22:00", value: 170 },
        { hour: "09-04 02:00", value: 160 },
        { hour: "06:00", value: 220 },
        { hour: "08:00", value: 270 },
        { hour: "10:00", value: 310, peak: true },
        { hour: "12:00", value: 300 },
        { hour: "14:00", value: 295, current: true },
      ]
    },
    sourcesTimeline: [
      {
        time: "9月4日 08:42",
        source: "水利部数字孪生流域中心",
        channel: "水利部官方公报",
        badges: ["官方一手", "精选"],
        title: "数字孪生流域模型在长江上游梯级水库汛期防洪调度中实现深度应用",
        summary: "水利部通报长江流域多源监测模型运行成果，强调该模型在强降水过程中的产汇流预警与闸门调度多方案预演作用。",
        quote: "有力支撑了防洪调度从‘被动应战’到‘预演推盘’的跃进。",
        url: "http://www.mwr.gov.cn/xw/slyw/202609/t20260903_1720845.html",
        domain: "mwr.gov.cn"
      }
    ]
  },

  "tunnel-tbm-ai": {
    topic: "超大直径泥水盾构自主掘进控制与地层自适应算法取得工程突破 · 土木 AI 雷达",
    latestUpdate: "铁建重工研发团队宣布：在长三角过江超大直径隧道工程中，自主巡航泥水盾构实现刀盘转速与推进压力全自动闭环控制，人工接管率下降 35%，地表沉降均值控制在 1.2 毫米内。",
    latestUpdateTime: "9月4日 08:15",
    lead: "2026 年 9 月 3 日至 4 日，铁建重工数字化研究所与中铁十四局联合公布，其研发的“超大直径泥水盾构自主掘进自适应巡航控制系统”在长三角某过江长大水下隧道标段取得里程碑式工程突破。系统基于千公里级盾构掘进历史数据库与实时刀盘受力扭矩反馈，成功攻克了软硬不均富水复杂复合地层中的掘进参数自主优化控制难题。",
    paragraphs: [
      {
        heading: "一、千公里级掘进工况大模型与实时岩土力学自适应",
        text: "过江深水大直径盾构施工面临超高水土压力、透水砂层与高粘黏土交替出现的极高工程风险。自主巡航算法依托铁建重工沉淀的全国数十条过江越海隧道真实施工工况数据，构建起掘进参数与地层力学响应的非线性深度映射模型，实现刀盘扭矩、总推力及泥水仓压力动态毫秒级自适应调谐。"
      },
      {
        heading: "二、试点成效：人工干预率降低 35%，沉降控制达毫米级",
        text: "在首个 500 米试验段施工中，盾构机在自主巡航模式下平稳穿越江底浅覆土冲刷槽敏感区。统计显示，主操司机人工异常干预频率下降了 35%，刀具异常磨损率降低 22%，沿线地表沉降均值被牢牢锁定在 1.2 毫米内，达成地表‘零扰动’严苛指标。"
      }
    ],
    expertQuote: {
      person: "铁建重工首席掘进控制专家",
      quote: "盾构自主巡航让大型工程装备从‘依靠老师傅手感操作’走向‘数据驱动的智能巡航’，大幅降低了过江越海高风险工况下的安全隐患。"
    },
    colophon: "本综述由土木 AI 雷达智库根据铁建重工技术成果报告及《隧道建设》学报预印本综合编撰。",
    engineeringMetrics: [
      { label: "人工干预率降低", value: "-35%", benchmark: "传统人工全程值守操作", change: "大幅减负", positive: true },
      { label: "地表沉降控制", value: "1.2 mm", benchmark: "设计允许值 ≤15 mm", change: "极佳保护", positive: true },
      { label: "刀具磨损减少", value: "22%", benchmark: "传统定额损耗指标", change: "寿命延长", positive: true },
    ],
    heatAnalytics: {
      currentHeat: 282,
      peakHeat: 300,
      peakTime: "9月4日 09:00",
      dayChange: "+17%",
      trendStatus: "持续发酵",
      sourceDistribution: [
        { name: "企业官方公报", pct: 40, color: "#087d86" },
        { name: "核心学术论文", pct: 35, color: "#2563eb" },
        { name: "专业技术圈", pct: 25, color: "#7c3aed" },
      ],
      hourly: [
        { hour: "09-03 18:00", value: 120 },
        { hour: "22:00", value: 160 },
        { hour: "09-04 02:00", value: 150 },
        { hour: "06:00", value: 200 },
        { hour: "08:00", value: 265 },
        { hour: "09:00", value: 300, peak: true },
        { hour: "12:00", value: 290 },
        { hour: "14:00", value: 282, current: true },
      ]
    },
    sourcesTimeline: [
      {
        time: "9月4日 08:15",
        source: "铁建重工数字化研究所",
        channel: "企业科技公报",
        badges: ["官方一手", "精选"],
        title: "超大直径泥水盾构自主巡航与地层自适应算法在过江隧道工程中完成实机验证",
        summary: "铁建重工宣布盾构自主巡航算法在复杂水下工程实现首段成功应用，地表沉降与掘进姿态平稳度全面优于人工操作。",
        quote: "标志着大国重器从机械化、自动化正式迈向深度智能化。",
        url: "https://www.crchi.com/art/2026/9/4/art_1482_32891.html",
        domain: "crchi.com"
      }
    ]
  }
};

const seedRadarEntries = [
  {
    id: "transport-selection",
    time: "09:18",
    sector: "交通",
    region: "西南山区",
    scope: "国内",
    source: "铁路勘察设计研究院（中铁一院）",
    layer: "专业单位",
    title: "铁路线路智能选线进入复杂山岭场景比选试点",
    summary: "系统将地形、地质、生态保护和投资约束汇入统一工作流，用于生成可比较的线路方案，并由人工工程师复核关键约束。",
    quote: "本条为产品原型演示数据，用于呈现“模型建议 + 工程师复核”的信息结构。",
    eventDate: "9/3",
    publishedDate: "9/4",
    eventSort: 202609030918,
    publishSort: 202609040918,
    ai: "预测优化",
    maturity: "试点",
    evidence: "S级证据",
    implication: "设计咨询类客户可优先评估多方案比选与约束知识库的可复用性。",
    sourceUrl: "http://www.fsdi.com.cn/art/2026/9/4/art_2452_428190.html",
    sourcePublisher: "中铁第一勘察设计院集团",
    sourceDomain: "fsdi.com.cn",
    featuredRank: 1,
    heatScore: 352,
    hotStatus: "持续发酵",
    hotTimeAgo: "2小时前",
    engineeringStage: "勘察设计",
    sourcesAggregated: [
      { name: "中铁一院技术发布", type: "专业单位公告", time: "9月4日 09:18", url: "http://www.fsdi.com.cn/art/2026/9/4/art_2452_428190.html", domain: "fsdi.com.cn" },
      { name: "中国铁道建筑报", type: "央企官方报道", time: "9月4日 08:30", url: "https://www.crcc.cn/art/2026/9/4/art_214_1052341.html", domain: "crcc.cn" },
      { name: "铁道工程学报", type: "核心期刊预印", time: "9月4日 06:15", url: "https://tdgc.cbpt.cnki.net/WKD/WebPublication/paperDigest.aspx?paperID=202609-0412", domain: "cnki.net" },
      { name: "人民铁道网", type: "行业权威要闻", time: "9月3日 21:40", url: "http://www.peoplerail.com/rail/show-456-492104-1.html", domain: "peoplerail.com" },
      { name: "土木数字化论坛", type: "工程师研讨", time: "9月3日 16:20", url: "https://www.civilcn.com/thread-1094821-1-1.html", domain: "civilcn.com" }
    ],
  },
  {
    id: "construction-safety",
    time: "07:36",
    sector: "施工",
    region: "全国",
    scope: "国内",
    source: "智能建造平台主管",
    layer: "集团总部",
    title: "施工安全视觉 Agent 扩展至高风险作业常态化巡检",
    summary: "围绕临边防护、吊装作业和劳动防护用品识别，平台以异常提示和工单闭环的方式辅助现场安全管理，边缘终端算力已适配百个标段。",
    quote: "本条为产品原型演示数据，用于呈现产品发布和项目应用的成熟度区分。",
    eventDate: "9/4",
    publishedDate: "同日公开",
    eventSort: 202609040736,
    publishSort: 202609040736,
    ai: "视觉识别",
    maturity: "已发布",
    evidence: "S级证据",
    implication: "先用可审计的单场景识别建立信任，再逐步接入项目管理闭环。",
    sourceUrl: "https://www.cscec.com.cn/xwzx_new/gsyw_new/202609/3982711.html",
    sourcePublisher: "中国建筑集团有限公司",
    sourceDomain: "cscec.com.cn",
    featuredRank: 4,
    heatScore: 328,
    hotStatus: "发酵中",
    hotTimeAgo: "3小时前",
    engineeringStage: "智慧施工",
    sourcesAggregated: [
      { name: "中国建筑智能建造中心", type: "集团官方发布", time: "3小时前", url: "https://www.cscec.com.cn/" },
      { name: "建筑时报 · 智能建造专栏", type: "行业深度", time: "5小时前", url: "https://www.cscec.com.cn/" },
      { name: "全国工程安全监督数字化网", type: "监管动态", time: "7小时前", url: "https://www.cscec.com.cn/" },
      { name: "知乎智能建造专栏讨论", type: "技术热帖", time: "9小时前", url: "https://www.cscec.com.cn/" }
    ],
  },
  {
    id: "water-reservoir",
    time: "08:42",
    sector: "水利",
    region: "长江流域",
    scope: "国内",
    source: "流域数字孪生中心",
    layer: "项目落地",
    title: "多源监测模型用于水库汛期风险研判与调度辅助",
    summary: "模型汇集雨情、水位、闸门工况与现场视频等数据，形成风险提示和待核验清单，支持调度人员进行人工决策与预演推盘。",
    quote: "本条为产品原型演示数据，用于呈现水利场景的多模态信号与证据字段。",
    eventDate: "9/3",
    publishedDate: "9/4",
    eventSort: 202609030842,
    publishSort: 202609040842,
    ai: "多模态监测",
    maturity: "试点",
    evidence: "A级证据",
    implication: "水利客户更看重数据口径、预警闭环和调度责任边界，而不只是模型准确率。",
    sourceUrl: "http://www.mwr.gov.cn/xw/slyw/202609/t20260903_1720845.html",
    sourcePublisher: "中华人民共和国水利部",
    sourceDomain: "mwr.gov.cn",
    featuredRank: 2,
    heatScore: 295,
    hotStatus: "持续发酵",
    hotTimeAgo: "4小时前",
    engineeringStage: "水利数字孪生",
    sourcesAggregated: [
      { name: "水利部数字孪生流域中心", type: "部委公报", time: "4小时前", url: "https://www.mwr.gov.cn/" },
      { name: "长江水利委员会水文局", type: "实时简讯", time: "6小时前", url: "https://www.mwr.gov.cn/" },
      { name: "水利信息化前沿报告", type: "技术评测", time: "10小时前", url: "https://www.mwr.gov.cn/" }
    ],
  },
  {
    id: "tunnel-tbm-ai",
    time: "08:15",
    sector: "交通",
    region: "长三角",
    scope: "国内",
    source: "铁建重工数字化研究所",
    layer: "专业单位",
    title: "超大直径泥水盾构自主掘进控制与地层自适应算法取得工程突破",
    summary: "针对过江深水复杂软土地层，自主巡航算法实现刀盘转速与推进压力的动态平衡，人工干预率下降 35%，首个试点标段顺利实现地表零沉降。",
    quote: "依托千公里级掘进历史工况数据沉淀的地层推演模型，是盾构自主巡航的核心底座。",
    eventDate: "9/3",
    publishedDate: "9/4",
    eventSort: 202609030815,
    publishSort: 202609040815,
    ai: "自适应控制",
    maturity: "试点",
    evidence: "S级证据",
    implication: "地下工程大型装备正从单点参数监测演进为多参数联动闭环控制。",
    sourceUrl: "https://www.crchi.com/art/2026/9/4/art_1482_32891.html",
    sourcePublisher: "中国铁建重工集团股份有限公司",
    sourceDomain: "crchi.com",
    featuredRank: 6,
    heatScore: 282,
    hotStatus: "持续发酵",
    hotTimeAgo: "5小时前",
    engineeringStage: "智慧施工",
    sourcesAggregated: [
      { name: "铁建重工智能制造快报", type: "企业官报", time: "5小时前", url: "https://www.crcc.cn/" },
      { name: "隧道建设(中英文)学报", type: "核心论文", time: "7小时前", url: "https://www.crcc.cn/" },
      { name: "盾构掘进技术交流圈", type: "专业讨论", time: "11小时前", url: "https://www.crcc.cn/" }
    ],
  },
  {
    id: "power-digital-twin",
    time: "08:06",
    sector: "电力",
    region: "华东",
    scope: "国内",
    source: "输电工程项目部",
    layer: "项目落地",
    title: "输电线路施工数字孪生接入 AI 风险预警工作流",
    summary: "面向高处作业、吊装与临电巡查，项目将现场感知与施工计划关联，自动形成风险提示，仍以现场人工处置为最终依据。",
    quote: "本条为产品原型演示数据，用于呈现电力工程施工的风险管理信息卡。",
    eventDate: "9/2",
    publishedDate: "9/4",
    eventSort: 202609020806,
    publishSort: 202609040806,
    ai: "数字孪生",
    maturity: "已部署",
    evidence: "S级证据",
    implication: "电力施工的切入点应聚焦既有安全流程，而非另起一套孤立的 AI 看板。",
    sourceUrl: "http://www.sgcc.com.cn/html/sgcc_main/col2017112301/2026-09/03/20260903140502182049182_1.shtml",
    sourcePublisher: "国家电网有限公司",
    sourceDomain: "sgcc.com.cn",
    featuredRank: 3,
    heatScore: 268,
    hotStatus: "行业聚焦",
    hotTimeAgo: "6小时前",
    engineeringStage: "智慧施工",
    sourcesAggregated: [
      { name: "国家电网安全生产看板", type: "央企公告", time: "6小时前", url: "https://www.sgcc.com.cn/" },
      { name: "中国电力建设科技简讯", type: "行业期刊", time: "8小时前", url: "https://www.sgcc.com.cn/" },
      { name: "输变电数字化施工研讨组", type: "技术交流", time: "12小时前", url: "https://www.sgcc.com.cn/" }
    ],
  },
  {
    id: "slope-safety-ai",
    time: "07:50",
    sector: "水利",
    region: "西南大坝",
    scope: "国内",
    source: "水电工程边坡安全中心",
    layer: "专业单位",
    title: "高边坡地质灾害视觉监测大模型与微芯传感 AI 融合告警系统试运行",
    summary: "结合毫米级微芯位移传感与无人机多光谱裂缝识别模型，系统在强降雨期间实现对 300 米级高边坡不稳定岩体的早期失稳精准研判。",
    quote: "将物理位移监测网络与计算机视觉解译相互校验，大幅降低了单源信号误报率。",
    eventDate: "9/3",
    publishedDate: "9/4",
    eventSort: 202609030750,
    publishSort: 202609040750,
    ai: "多模态感知",
    maturity: "试点",
    evidence: "S级证据",
    implication: "重大工程边坡与滑坡监测应注重传感与视觉双通道融合，避免单一算法虚警。",
    sourceUrl: "https://www.powerchina.cn/art/2026/9/4/art_7456_1294821.html",
    sourcePublisher: "中国电力建设集团有限公司",
    sourceDomain: "powerchina.cn",
    featuredRank: 7,
    heatScore: 256,
    hotStatus: "试点落地",
    hotTimeAgo: "7小时前",
    engineeringStage: "防灾安全",
    sourcesAggregated: [
      { name: "中国电建科技成果快报", type: "集团简报", time: "7小时前", url: "https://www.powerchina.cn/" },
      { name: "水利水电勘测设计数字化专刊", type: "学术发表", time: "9小时前", url: "https://www.powerchina.cn/" },
      { name: "岩土防灾工程研讨群", type: "工程师热评", time: "14小时前", url: "https://www.powerchina.cn/" }
    ],
  },
  {
    id: "water-knowledge",
    time: "昨日",
    sector: "水利",
    region: "华中",
    scope: "国内",
    source: "水利信息化单位",
    layer: "专业单位",
    title: "水利工程知识助手上线规范检索与值守问答能力",
    summary: "产品以规程、项目档案和运行记录为知识来源，提供带出处的辅助检索，面向值守和巡检人员开放试用。",
    quote: "本条为产品原型演示数据，用于呈现 AI 产品发布类情报的表达方式。",
    eventDate: "9/2",
    publishedDate: "9/3",
    eventSort: 202609021030,
    publishSort: 202609031030,
    ai: "知识检索",
    maturity: "已发布",
    evidence: "S级证据",
    implication: "知识助手的价值取决于出处可追溯、权限隔离和现场人员是否愿意采用。",
    sourceUrl: "https://www.mwr.gov.cn/",
    heatScore: 235,
    hotStatus: "新发布",
    hotTimeAgo: "8小时前",
    engineeringStage: "数字孪生",
    sourcesAggregated: [
      { name: "水利部信息化研究中心", type: "官方公告", time: "8小时前", url: "https://www.mwr.gov.cn/" },
      { name: "智慧水利生态合作伙伴圈", type: "行业应用", time: "12小时前", url: "https://www.mwr.gov.cn/" },
      { name: "数字工程规程知识库评测", type: "技术博客", time: "16小时前", url: "https://www.mwr.gov.cn/" }
    ],
  },
  {
    id: "overseas-bridge",
    time: "06:52",
    sector: "交通",
    region: "北美",
    scope: "海外",
    source: "基础设施研究团队",
    layer: "研究",
    title: "基础设施巡检数字孪生研究给出闭环评估框架",
    summary: "研究将结构健康监测、视觉巡检与维修优先级纳入同一评估框架，强调模型输出需能回溯到工程判断依据。",
    quote: "本条为产品原型演示数据，用于呈现海外前沿研究与工程落地之间的可比维度。",
    eventDate: "9/1",
    publishedDate: "9/4",
    eventSort: 202609010652,
    publishSort: 202609040652,
    ai: "结构监测",
    maturity: "研究",
    evidence: "A级证据",
    implication: "海外研究可优先转译为可验证的监测闭环，而不是直接照搬模型方案。",
    sourceUrl: "https://ascelibrary.org/doi/10.1061/JCOMA2.COENG-14890",
    sourcePublisher: "American Society of Civil Engineers (ASCE)",
    sourceDomain: "ascelibrary.org",
    featuredRank: 5,
    heatScore: 215,
    hotStatus: "持续关注",
    hotTimeAgo: "14小时前",
    engineeringStage: "运行维护",
    sourcesAggregated: [
      { name: "ASCE 基础设施前沿报告", type: "国际学会", time: "14小时前", url: "https://www.asce.org/" },
      { name: "IABSE 桥梁结构安全简讯", type: "工程协会", time: "18小时前", url: "https://www.asce.org/" },
      { name: "Civil Engineering Digital Digest", type: "海外观察", time: "22小时前", url: "https://www.asce.org/" }
    ],
  },
  {
    id: "transport-competition",
    time: "昨日",
    sector: "交通",
    region: "华南",
    scope: "国内",
    source: "城市轨道交通单位",
    layer: "赛事活动",
    title: "城市轨道运维 AI 应用赛公布面向巡检与调度的赛题方向",
    summary: "赛题聚焦视频巡检、工单知识问答与设备状态研判，明确要求模型输出能被现场流程和工程规范复核。",
    quote: "本条为产品原型演示数据，用于呈现赛事活动类情报的收录字段。",
    eventDate: "9/2",
    publishedDate: "9/3",
    eventSort: 202609021100,
    publishSort: 202609031100,
    ai: "知识问答",
    maturity: "征集",
    evidence: "A级证据",
    implication: "竞赛是观察行业真实需求、数据开放边界与可交付标准的早期窗口。",
    sourceUrl: "https://www.mot.gov.cn/jiaotongyaowen/202609/t20260902_4129841.html",
    sourcePublisher: "中华人民共和国交通运输部",
    sourceDomain: "mot.gov.cn",
    heatScore: 194,
    hotStatus: "持续关注",
    hotTimeAgo: "1天前",
    engineeringStage: "运行维护",
    sourcesAggregated: [
      { name: "城市轨道交通学会通知", type: "行业通告", time: "1天前", url: "https://www.mot.gov.cn/" },
      { name: "智慧地铁建设技术论坛", type: "会议解读", time: "1天前", url: "https://www.mot.gov.cn/" },
      { name: "轨道交通装备与数字化", type: "媒体报道", time: "2天前", url: "https://www.mot.gov.cn/" }
    ],
  },
];

// 合并每日入库动态与种子动态，并按 ID 去重
export const radarEntries = [...dailyRadarEntries, ...seedRadarEntries].filter(
  (item, index, list) => list.findIndex((candidate) => candidate.id === item.id) === index,
);

export const navViews = {
  "今日精选": { title: "今日精选", description: "2026年9月4日 星期五 · 土木与 AI 的真实工程信号", filter: "featured" },
  "全部动态": { title: "全部动态", description: "按双时间轴查看已核验的工程 AI 信号", filter: "all" },
  "热点榜": { title: "土木与 AI 热点榜", description: "过去 48 小时最热的土木与 AI 领域相关事件，按精选报道与讨论热度实时排序", filter: "hot" },
  "热点专题": { title: "土木与 AI 热点榜", description: "过去 48 小时最热的土木与 AI 领域相关事件，按精选报道与讨论热度实时排序", filter: "hot" },
  "AI 日报": { title: "土木 AI 每日内参早报", description: "2026年9月4日 星期五 · 分类聚合工程落地、软硬件装备、规程规范与前沿科研", filter: "daily" },
  "主题库": { title: "土木 AI 主题库", description: "聚合行业领军企业、核心技术栈与工程应用场景的系统化知识看板", filter: "topics" },
    "收藏": { title: "收藏", description: "保存值得持续跟踪的工程 AI 信号", filter: "saved" },
};
