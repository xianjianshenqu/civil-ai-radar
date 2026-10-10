// Only operator-configured public sources are fetched. Browser clients cannot submit arbitrary URLs.
// Tiers weight sales scoring only; they never auto-verify.
// Group headquarters, ministries, Bentley, ICE and FHWA stay unconfigured until a working public feed exists.
// 中国政府采购网（2026-09-18 实测）：search.ccgp.gov.cn 无 robots 限制、检索端点与 www.ccgp.gov.cn 公告页均支持
// HTTPS，按关键词检索采购公告摘要；招标投标公共服务平台 robots 全站禁止，不得采集。
// 全国公共资源交易平台与深圳公共资源交易中心（2026-09-26 实测，详见 server/ggzy.mjs / server/szggzy.mjs）：
// robots.txt 均 404（无限制），检索端点支持 HTTPS，摘要口径与 ccgp 一致。
// 广州公共资源交易中心（2026-09-28，详见 server/gzggzy.mjs）：官网 www.gzggzy.cn，工程建设招标公告为公开栏目列表。
// 四个栏目 × 20 个关键词 = 80 次顺序 GET/日（2026-09-29 关键词与深圳源对齐，由 40 次上调）；不抓详情页。
export const sources = [
  {id:'ccgp-procurement',kind:'ccgp',tier:'t1',name:'中国政府采购网（AI 相关采购公告）',url:'https://search.ccgp.gov.cn/bxsearch',articleHosts:['www.ccgp.gov.cn'],keywords:['智能建造','智慧工地','人工智能','大模型','智能审图','数字孪生','智能算量','智能勘察','数智化','智慧电厂','智能巡检','智慧水利','智能光伏','智能问答','知识管理','翻译服务','标准规范'],sector:'施工',scope:'国内',region:'中国',topicIds:[]},
  {id:'ggzy-national',kind:'ggzy',tier:'t1',name:'全国公共资源交易平台（AI 相关交易公告）',url:'https://www.ggzy.gov.cn/',keywords:['智能建造','智慧工地','人工智能','大模型','智能审图','数字孪生','智能算量','智能勘察','数智化','智慧电厂','智能巡检','智慧水利','智能光伏','智能问答','知识管理','翻译服务','标准规范'],sector:'施工',scope:'国内',region:'中国',topicIds:[]},
  {id:'szggzy-shenzhen',kind:'szggzy',tier:'t1',name:'深圳公共资源交易中心（AI 相关交易公告）',url:'https://www.szggzy.com/',channels:[2850,2851],keywords:['智能建造','智慧工地','人工智能','大模型','智能审图','数字孪生','智能算量','智能勘察','数智化','智慧电厂','智能巡检','智慧水利','智能光伏','智能问答','知识管理','翻译服务','标准规范','智能化','智慧','智能'],sector:'施工',scope:'国内',region:'中国',topicIds:[]},
  {id:'gzggzy-guangzhou',kind:'gzggzy',tier:'t1',name:'广州公共资源交易中心（工程建设招标公告）',url:'https://www.gzggzy.cn/',articleHosts:['gzggzy.cn'],columns:['jyywjsgcfwjzzbgg','jyywjsgcszgczbgg','jyywjsgcjtgczbgg','jyywjsgcslswzbgg'],keywords:['智能建造','智慧工地','人工智能','大模型','智能审图','数字孪生','智能算量','智能勘察','数智化','智慧电厂','智能巡检','智慧水利','智能光伏','智能问答','知识管理','翻译服务','标准规范','智能化','智慧','智能'],sector:'施工',scope:'国内',region:'中国',topicIds:[]},
  {id:'autodesk-aec',tier:'t1',disabledReason:'订阅地址已迁移，目标站点的采集规则禁止自动访问，暂不启用。',name:'Autodesk AEC Tech Drop',url:'https://www.autodesk.com/blogs/aec/feed/',sector:'施工',scope:'海外',region:'美国',topicIds:['autodesk-aec-forma']},
  {id:'autodesk-construction',tier:'t1',name:'Autodesk Construction',url:'https://www.autodesk.com/blogs/construction/feed/',sector:'施工',scope:'海外',region:'美国',topicIds:['autodesk-aec-forma']},
  {id:'cae-engineering',tier:'t1',name:'中国工程院院刊 Engineering',url:'https://www.engineering.org.cn/engi/EN/rss/latest.xml',sector:'施工',scope:'国内',region:'中国',topicIds:[]},
  {id:'cae-engineering-issue',tier:'t1',name:'中国工程院院刊 Engineering（当期）',url:'https://www.engineering.org.cn/engi/EN/rss/current-issue.xml',sector:'施工',scope:'国内',region:'中国',topicIds:[]},
  {id:'cae-sscae',tier:'t1',name:'中国工程科学',url:'https://www.engineering.org.cn/sscae/CN/rss/latest.xml',sector:'施工',scope:'国内',region:'中国',topicIds:[]},
  {id:'crossref-cn-civil',kind:'crossref',tier:'t1',name:'国内土木期刊（Crossref）',url:'https://api.crossref.org/works',articleHosts:['doi.org'],issns:[
    {issn:'0559-9350',name:'水利学报'},
    {issn:'2095-2430',name:'Frontiers of Structural and Civil Engineering'},
    {issn:'1674-7755',name:'Journal of Rock Mechanics and Geotechnical Engineering'},
    {issn:'2095-7564',name:'Journal of Traffic and Transportation Engineering'},
    {issn:'2467-9674',name:'Underground Space'},
    {issn:'2662-4745',name:'Railway Engineering Science'},
    {issn:'1674-2370',name:'Water Science and Engineering'},
    {issn:'2097-0498',name:'Journal of Road Engineering'},
    {issn:'1671-3664',name:'Earthquake Engineering and Engineering Vibration'},
    {issn:'0890-5487',name:'China Ocean Engineering'},
  ],sector:'施工',scope:'国内',region:'中国',topicIds:[]},
  {id:'openalex-cn-civil',kind:'openalex',tier:'t1',name:'OpenAlex 国内土木论文',url:'https://api.openalex.org/works',articleHosts:['doi.org','openalex.org'],country:'CN',topics:['T13031','T14446','T13808','T11006','T12233','T12482','T11606','T10842','T12022'],sector:'施工',scope:'国内',region:'中国',topicIds:[]},
  {id:'asce-source',tier:'t1',name:'ASCE Civil Engineering Source',url:'https://www.asce.org/RSS-Feeds/Trending-News-Feed',sector:'施工',scope:'海外',region:'美国',topicIds:[]},
  {id:'chinanews-scroll',tier:'t2',name:'中新网即时新闻',url:'https://www.chinanews.com.cn/rss/scroll-news.xml',sector:'施工',scope:'国内',region:'中国',topicIds:[]},
  {id:'chinanews-china',tier:'t2',name:'中新网国内新闻',url:'https://www.chinanews.com.cn/rss/china.xml',sector:'施工',scope:'国内',region:'中国',topicIds:[]},
  {id:'chinanews-finance',tier:'t2',name:'中新网财经',url:'https://www.chinanews.com.cn/rss/finance.xml',sector:'施工',scope:'国内',region:'中国',topicIds:[]},
  {id:'sciencenet-news',tier:'t1_5',name:'科学网新闻',url:'https://www.sciencenet.cn/xml/news-0.aspx?news=0',articleHosts:['news.sciencenet.cn'],sector:'施工',scope:'国内',region:'中国',topicIds:[]},
  {id:'mdpi-buildings',tier:'t1',name:'MDPI Buildings',url:'https://www.mdpi.com/rss/journal/buildings',sector:'施工',scope:'海外',region:'国际',topicIds:[]},
  {id:'mdpi-infrastructures',tier:'t1',name:'MDPI Infrastructures',url:'https://www.mdpi.com/rss/journal/infrastructures',sector:'交通',scope:'海外',region:'国际',topicIds:[]},
  {id:'mdpi-iic',tier:'t1',name:'MDPI Intelligent Infrastructure and Construction',url:'https://www.mdpi.com/rss/journal/iic',sector:'施工',scope:'海外',region:'国际',topicIds:[]},
  {id:'frontiers-built-environment',tier:'t1',name:'Frontiers in Built Environment',url:'https://www.frontiersin.org/journals/built-environment/rss',sector:'施工',scope:'海外',region:'国际',topicIds:[]},
  {id:'nature-civil-engineering',tier:'t1',name:'Nature Civil Engineering',url:'https://www.nature.com/subjects/civil-engineering.rss',sector:'施工',scope:'海外',region:'国际',topicIds:[]},
  {id:'sciencedaily-civil',tier:'t2',name:'ScienceDaily Civil Engineering',url:'https://www.sciencedaily.com/rss/matter_energy/civil_engineering.xml',sector:'施工',scope:'海外',region:'美国',topicIds:[]},
  {id:'constructiondive',tier:'t2',name:'Construction Dive',url:'https://www.constructiondive.com/feeds/news/',sector:'施工',scope:'海外',region:'美国',topicIds:[]},
  {id:'gcr',tier:'t2',name:'Global Construction Review',url:'https://www.globalconstructionreview.com/feed/',sector:'施工',scope:'海外',region:'英国',topicIds:[]},
  {id:'construction-management',tier:'t2',name:'Construction Management',url:'https://constructionmanagement.co.uk/feed/',sector:'施工',scope:'海外',region:'英国',topicIds:[]},
  {id:'buildingsmart',tier:'t1',name:'buildingSMART',url:'https://www.buildingsmart.org/feed/',sector:'施工',scope:'海外',region:'国际',topicIds:[]},
  {id:'trimble-news',tier:'t1',name:'Trimble Newsroom',url:'https://news.trimble.com/news-releases?pagetemplate=rss',sector:'施工',scope:'海外',region:'美国',topicIds:[]},
  {id:'bentley-blog',tier:'t1',disabledReason:'公开订阅地址已失效：原 blog.bentley.com/feed 跳转到不存在的路径，且采集器不跟随未审核跳转。',name:'Bentley Blog',url:'https://www.bentley.com/blog/feed/',sector:'施工',scope:'海外',region:'美国',topicIds:['bentley-itwin']},
  {id:'ice-news',tier:'t1',disabledReason:'目标站点对自动访问返回 403，暂不启用。',name:'ICE News & Insight',url:'https://www.ice.org.uk/news-and-insight/rss',sector:'施工',scope:'海外',region:'英国',topicIds:[]},
];
