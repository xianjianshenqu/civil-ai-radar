import { useMemo, useState } from "react";
import {
  IconActivity, IconArrowLeft, IconArrowRight, IconArrowUpRight, IconBell, IconBellCheck,
  IconBolt, IconBrain, IconBuildingBridge2, IconBuildingSkyscraper, IconBuildingTunnel,
  IconCategory, IconChartBar, IconChevronDown, IconCircleCheckFilled, IconClock,
  IconCpu, IconDatabase, IconDrone, IconEye, IconFlame, IconFlask, IconFolder, IconHeart,
  IconHelp, IconLayersLinked, IconLayoutGrid, IconList, IconMapPin, IconMessageCircle,
  IconNews, IconNotebook, IconRobot, IconRoute, IconSearch, IconSettings,
  IconShieldCheck, IconStar, IconStarFilled, IconTrendingUp, IconWaveSine, IconWindmill, IconX,
  IconCheck, IconCopy, IconFileText, IconQuote, IconInfoCircle, IconShare, IconExternalLink,
} from "@tabler/icons-react";
import { civilAiTopics as rawTopics } from "../data/topicsData";
import { entryOrigin, formatDayLabel, groupByDay, isFeatured, listDateLabel, publishedCaption, recommendReason, recommendReasonLabel } from "../lib/radar.js";
import { NOTICE_CLASS_LABELS, noticeClassOf } from "../lib/intel.js";
const civilAiTopics = rawTopics.map(t => ({...t, summary: t.tags.join(" · "), highlights: null}));
const editorialBody = (item) => item.dataOrigin !== "collector" || item.reviewed;

function NoticeStatusChip({ item }) {
  const noticeClass = noticeClassOf(item);
  const label = NOTICE_CLASS_LABELS[noticeClass];
  if (!label) return null;
  return <span className={`notice-chip ${noticeClass}`}>{label}</span>;
}

const sectorTone = { 交通: "traffic", 水利: "water", 电力: "power", 施工: "construction", 石化: "petro", 新能源: "renewable" };

function SaveButton({ isSaved, onToggle }) {
  return (
    <button
      className={`save-button ${isSaved ? "saved" : ""}`}
      type="button"
      onClick={onToggle}
      aria-pressed={isSaved}
      aria-label={isSaved ? "取消收藏此条动态" : "收藏此条动态"}
    >
      {isSaved ? <IconStarFilled size={18} /> : <IconStar size={18} />}
    </button>
  );
}

export function Entry({ item, isSaved, onToggleSave, onOpenDetail }) {
  const featured = isFeatured(item);
  const rec = recommendReason(item);
  const body = item.dataOrigin !== "collector" || item.reviewed || featured;
  return (
    <article className="timeline-entry" data-entry-id={item.id}>
      <div className="entry-time">
        {item.time&&item.time!=='未披露'&&<strong>{item.time}</strong>}
        <span>事件 {item.eventDate}</span>
        <span>{publishedCaption(item)}</span>
      </div>
      <div className="timeline-rail" aria-hidden="true"><i /></div>
      <div className="entry-content">
        <div className="entry-meta">
          {featured && <span className="origin-chip featured">精选</span>}
          <NoticeStatusChip item={item} />
          <span>{item.source}</span>
          <span className="meta-divider" />
          <span><IconMapPin size={13} /> {item.region}</span>
          <span className={item.evidence === "已核验" ? "verified" : "pending-evidence"}>{item.evidence === "已核验" ? <IconCircleCheckFilled size={14} /> : <IconInfoCircle size={14} />} {item.evidence}</span>
          <SaveButton isSaved={isSaved} onToggle={() => onToggleSave(item.id)} />
        </div>
        <div className="entry-title-row">
          <button className="entry-title" type="button" onClick={() => onOpenDetail(item.id)}>
            {item.title}
          </button>
          {item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="source-link">
            查看原文 <IconArrowUpRight size={16} />
          </a>}
        </div>
        {body && item.summary && !String(item.summary).startsWith('由公开订阅源自动发现') ? <p className="entry-summary">{item.summary}</p> : null}
        {rec ? <p className="entry-quote">{rec.kind === 'machine' ? `机器整理：${rec.text}` : rec.kind === 'auto' ? `自动评分理由：${rec.text}` : rec.kind === 'demo' ? rec.text : `推荐理由：${rec.text}`}</p> : null}
        <div className="entry-bottom">
          <div className="chips" aria-label="动态标签">
            <span>{item.sector}</span>
            {item.ai!=='AI 相关线索'&&<span>{item.ai}</span>}
            {item.maturity!=='待判断'&&<span>{item.maturity}</span>}
            <span className="layer-chip">{item.layer}</span>
          </div>
          <button className="detail-link" type="button" onClick={() => onOpenDetail(item.id)}>
            查看详情 <IconArrowUpRight size={14} />
          </button>
        </div>
      </div>
    </article>
  );
}

export function CompactEntry({ item, isSaved, onToggleSave, onOpenDetail }) {
  const origin = entryOrigin(item);
  const body = editorialBody(item);
  return (
    <article className="compact-entry-row" data-entry-id={item.id}>
      <div className="compact-time-badge">
        {item.time && item.time !== '未披露' ? <strong>{item.time}</strong> : <strong>{listDateLabel(item)}</strong>}
        <span className="compact-pub-date">{publishedCaption(item)}</span>
      </div>
      <div className="compact-body">
        <div className="compact-meta-line">
          <span className={`origin-chip ${origin === '精选' ? 'featured' : origin === '入库' ? 'catalog' : 'collected'}`}>{origin}</span>
          <span className="compact-sector-tag">{item.sector}</span>
          <span className="compact-source-name">{item.source}</span>
          <span className="compact-region"><IconMapPin size={12} /> {item.region}</span>
          <span className={item.evidence === "已核验" ? "compact-evidence-tag verified" : "compact-evidence-tag"}>{item.evidence}</span>
          {item.procurement?.buyer ? <span className="origin-chip collected">采购人：{item.procurement.buyer.slice(0, 24)}</span> : null}
          {item.machineReview && !item.reviewed ? <span className="origin-chip collected">机器整理</span> : null}
        </div>
        <div className="compact-title-line">
          <button className="compact-title-btn" type="button" onClick={() => onOpenDetail(item.id)}>{item.title}</button>
        </div>
        {body && item.summary ? <p className="compact-summary">{item.summary}</p> : null}
      </div>
      <div className="compact-actions">
        <SaveButton isSaved={isSaved} onToggle={() => onToggleSave(item.id)} />
        <button className="compact-detail-btn" type="button" onClick={() => onOpenDetail(item.id)}>详情 <IconArrowUpRight size={13} /></button>
      </div>
    </article>
  );
}

export function DateGroupedFeed({ entries, className, renderItem }) {
  const groups = groupByDay(entries);
  return groups.map((group) => (
    <section className="feed-day-block" key={group.day || "unknown"}>
      <div className="feed-heading">
        <div>
          <h2>{formatDayLabel(group.day)}</h2>
          <span>{group.items.length} 条</span>
        </div>
      </div>
      <div className={className}>{group.items.map(renderItem)}</div>
    </section>
  ));
}

export function HotEventCard({ event, rank, onOpenDetail }) {
  const [open, setOpen] = useState(false);
  const rankClass = rank === 1 ? "rank-gold" : rank === 2 ? "rank-silver" : rank === 3 ? "rank-bronze" : "rank-normal";
  const sourceCount = event.sources.length;
  return (
    <article className={`hot-card ${rankClass}`} data-entry-id={event.leadId}>
      <div className="hot-card-inner">
        <div className="hot-rank-col">
          <div className={`hot-rank-badge ${rankClass}`}>
            <span className="rank-num">{String(rank).padStart(2, "0")}</span>
            <span className="rank-medal-label">评分</span>
          </div>
        </div>
        <div className="hot-body-col">
          <div className="hot-card-header">
            <div className="hot-status-group">
              <span className="hot-status-pill status-teal">{event.featuredRank ? '编辑置顶' : '销售推荐'}</span>
              <NoticeStatusChip item={event} />
              <span className="hot-source-text">{event.source} · 首次公开 {event.publishedDate}</span>
              {event.upcoming ? <span className="hot-status-pill status-orange">即将发生</span> : null}
            </div>
          </div>
          <div className="hot-title-row">
            <button className="hot-title-btn" type="button" onClick={() => onOpenDetail(event.leadId)}>{event.title}</button>
          </div>
          {event.summary ? <p className="hot-summary">{event.summary}</p> : null}
          {event.implication ? (
            <div className="hot-implication-box">
              <span className="implication-tag">{recommendReasonLabel(event.recommendKind) || '推荐理由'}</span>
              <span className="implication-text">{event.implication}</span>
            </div>
          ) : null}
          <div className="hot-sources-container">
            <button className="hot-sources-toggle" type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              <span className="toggle-left">{sourceCount ? `${sourceCount} 个可追溯来源` : "暂无文章级来源链接"}{event.itemCount > 1 ? ` · ${event.itemCount} 条记录` : ""}</span>
              <span className="toggle-right">{open ? "收起" : "查看信源"} <IconChevronDown size={14} className={`toggle-chevron${open ? " rotate" : ""}`} /></span>
            </button>
            {open && (
              <div className="hot-sources-list">
                {sourceCount ? event.sources.map((source) => (
                  <a className="hot-source-link-item" key={source.url} href={source.url} target="_blank" rel="noreferrer">
                    <span className="source-tag">{source.type}</span>
                    <span className="source-title">{source.name}</span>
                    <IconArrowUpRight size={14} className="source-arrow" />
                  </a>
                )) : <p className="hot-source-text">该事件尚未记录可跳转的原文页面。</p>}
              </div>
            )}
          </div>
          <div className="hot-card-footer">
            <div className="chips">
              <span className="sector-tag">{event.sector}</span>
              <span>{event.evidence}</span>
            </div>
            <div className="hot-footer-links">
              <button className="detail-action-btn" type="button" onClick={() => onOpenDetail(event.leadId)}>查看详情</button>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function previewPriority(event) {
  const lead = event?.items?.[0];
  const raw = event?.assistScore?.priority
    || lead?.assistScore?.priority
    || event?.salesScore?.priority
    || lead?.salesScore?.priority;
  return raw === 'P0' || raw === 'P1' || raw === 'P2' || raw === 'P3' ? raw : '';
}

function previewCut(event) {
  const raw = Array.isArray(event?.offerings) ? event.offerings : event?.salesScore?.offerings;
  const offerings = (Array.isArray(raw) ? raw : [])
    .map(item => String(item || "").trim())
    .filter(item => item && item !== "不相关")
    .slice(0, 2);
  if (offerings.length) return offerings;
  const sector = typeof event?.sector === "string" ? event.sector.trim() : "";
  if (sector && sector !== "全部" && sector !== "未披露") return [sector];
  return [];
}

export function HomeHotPreview({ events, onOpenDetail, onViewAll }) {
  if (!events.length) return null;
  return (
    <section className="focus-panel" aria-label="销售推荐事件">
      <div className="panel-heading">
        <div className="home-hot-head-left">
          <span className="home-hot-flame"><IconFlame size={16} /></span>
          <h2>销售推荐</h2>
        </div>
        <button className="view-full-hot-btn" type="button" onClick={onViewAll}>完整榜单 <IconArrowRight size={13} /></button>
      </div>
      <p className="home-hot-note">销售价值自动评分（假设，非实时热度，非核验）</p>
      <ol className="home-hot-list">
        {events.slice(0, 5).map((event, index) => {
          const cut = previewCut(event);
          const priority = previewPriority(event);
          const reason = typeof event.implication === 'string' ? event.implication.trim() : '';
          const reasonLabel = recommendReasonLabel(event.recommendKind);
          return (
            <li className="home-hot-item" key={event.id} data-entry-id={event.leadId}>
              <span className={`home-hot-rank rank-${index + 1}`}>{index + 1}</span>
              <div className="home-hot-copy">
                <div className="home-hot-title-line">
                  <NoticeStatusChip item={event} />
                  <button className="focus-title" type="button" onClick={() => onOpenDetail(event.leadId)}>{event.title}</button>
                </div>
                {reason ? <p className="home-hot-reason" title={reason}>{reasonLabel ? <span>{reasonLabel}</span> : null}{reason}</p> : null}
                {cut.length > 0 && (
                  <p className="home-hot-offering">
                    {cut.map(name => <span className="home-hot-offering-chip" key={name}>{name}</span>)}
                  </p>
                )}
              </div>
              <span className="home-hot-meta">
                {priority ? <span className={`review-priority p-${priority}`}>{priority}</span> : null}
                <span className="focus-source">{event.source}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ==================== 主题库专属卡片与看板组件 ====================
const topicIconComponents = {
  IconBuildingSkyscraper,
  IconBuildingTunnel,
  IconBuildingBridge2,
  IconRoute,
  IconCpu,
  IconWaveSine,
  IconLayersLinked,
  IconBrain,
  IconEye,
  IconDrone,
  IconShieldCheck,
  IconFlask,
  IconWindmill,
  IconBolt,
};

function TopicCard({ topic, matchedEntries, onSelectTopic }) {
  const IconComp = topicIconComponents[topic.icon] || IconFolder;
  const recentEntry = matchedEntries[0];
  const sectorTagClass = sectorTone[topic.sector] || "global";

  return (
    <article className="topic-card">
      <div className="topic-card-top">
        <div className={"topic-icon-wrap cat-" + topic.category}>
          <IconComp size={22} stroke={1.8} />
        </div>
        <div className="topic-badge-group">
          <span className="topic-category-tag">{topic.categoryLabel}</span>
          <span className="topic-badge">{topic.badge}</span>
        </div>
        <div className="topic-heat-pill" title="当前关联条目数">
          <IconFlame size={13} />
          <span>{matchedEntries.length} 条</span>
        </div>
      </div>

      <div className="topic-card-body">
        <div className="topic-title-row">
          <h3 className="topic-name">{topic.name}</h3>
          <span className={"topic-sector-pill " + sectorTagClass}>{topic.sector}</span>
        </div>
        <p className="topic-en-name">{topic.enName}</p>
        <p className="topic-summary">{topic.summary}</p>

        {topic.highlights && (
          <div className="topic-highlight-pill">
            <span className="highlight-dot" />
            <span>{topic.highlights}</span>
          </div>
        )}

        <div className="topic-tags">
          {topic.tags.map((tag, idx) => (
            <span key={idx} className="topic-tag-chip">
              #{tag}
            </span>
          ))}
        </div>
      </div>

      {recentEntry && (
        <div className="topic-recent-preview">
          <span className="preview-label">最新关联</span>
          <span className="preview-title" title={recentEntry.title}>
            {recentEntry.title}
          </span>
        </div>
      )}

      <div className="topic-card-footer">
        <span className="matched-count">
          已归集 <strong>{matchedEntries.length}</strong> 条动态
        </span>
        <button
          type="button"
          className="topic-view-btn"
          onClick={() => onSelectTopic(topic.id)}
        >
          查看专题动态 ({matchedEntries.length}) <IconArrowRight size={13} />
        </button>
      </div>
    </article>
  );
}

function TopicDetailView({
  topic,
  matchedEntries,
  saved,
  toggleSaved,
  onOpenDetail,
  onBack,
}) {
  const IconComp = topicIconComponents[topic.icon] || IconFolder;
  const sectorTagClass = sectorTone[topic.sector] || "global";

  return (
    <div className="topic-detail-view">
      <div className="topic-detail-breadcrumb">
        <button type="button" onClick={onBack} className="topic-back-btn">
          <IconArrowLeft size={15} /> 返回主题看板
        </button>
        <span className="crumb-sep">/</span>
        <span className="crumb-cat">{topic.categoryLabel}</span>
        <span className="crumb-sep">/</span>
        <span className="crumb-current">{topic.name}</span>
      </div>

      <header className="topic-detail-hero">
        <div className="topic-hero-left">
          <div className={"topic-hero-icon cat-" + topic.category}>
            <IconComp size={30} stroke={1.8} />
          </div>
          <div className="topic-hero-meta-col">
            <div className="topic-hero-meta-row">
              <span className="topic-category-tag">{topic.categoryLabel}</span>
              <span className="topic-badge">{topic.badge}</span>
              <span className={"topic-sector-pill " + sectorTagClass}>{topic.sector}</span>
              <span className="topic-heat-pill">
                <IconFlame size={13} /> 关联 {matchedEntries.length} 条
              </span>
            </div>
            <h1 className="topic-hero-title">{topic.name}</h1>
            <p className="topic-hero-en">{topic.enName}</p>
          </div>
        </div>
      </header>

      <div className="topic-hero-info">
        <p className="topic-hero-desc">{topic.summary}</p>
        {topic.highlights && (
          <div className="topic-hero-highlight">
            <strong>核心成效：</strong>
            <span>{topic.highlights}</span>
          </div>
        )}
        <div className="topic-tags">
          {topic.tags.map((tag, idx) => (
            <span key={idx} className="topic-tag-chip">
              #{tag}
            </span>
          ))}
        </div>
      </div>

      <div className="topic-feed-header">
        <div className="topic-feed-heading">
          <h2>已归集工程信号</h2>
          <span>共 {matchedEntries.length} 篇相关情报与动态 · 其中关键词自动匹配 {matchedEntries.filter(item => item.autoTopicIds?.includes(topic.id)).length} 篇</span>
        </div>
        <p className="topic-feed-note">关键词自动匹配只代表主题相关，不代表该企业或项目参与；编辑归类的条目优先展示。</p>
      </div>

      <div className="timeline-list">
        {matchedEntries.length ? (
          matchedEntries.map((item) => (
            <Entry
              key={item.id}
              item={item}
              isSaved={saved.includes(item.id)}
              onToggleSave={toggleSaved}
              onOpenDetail={onOpenDetail}
            />
          ))
        ) : (
          <div className="empty-state">
            <IconBrain size={28} />
            <strong>该主题正在收录更多一手工程信号</strong>
            <span>暂无匹配动态</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function TopicsDashboard({
  allEntries,
  saved,
  toggleSaved,
  onOpenDetail,
  searchQuery,
  activeSector, selectedCat, setSelectedCat, selectedTopicId, setSelectedTopicId,
}) {

  const handleSelectTopic = (id) => {
    setSelectedTopicId(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleBackToDashboard = () => {
    setSelectedTopicId(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const topicEntriesMap = useMemo(() => {
    const map = {};
    for (const topic of civilAiTopics) {
      const matched = allEntries.filter(item => item.topicIds?.includes(topic.id));
      // 编辑/信源归类在前，关键词自动匹配在后。
      matched.sort((a, b) => Number(b.autoTopicIds?.includes(topic.id) ? 0 : 1) - Number(a.autoTopicIds?.includes(topic.id) ? 0 : 1));
      map[topic.id] = matched;
    }
    return map;
  }, [allEntries]);

  const activeTopic = selectedTopicId
    ? civilAiTopics.find((t) => t.id === selectedTopicId)
    : null;

  if (activeTopic) {
    return (
      <TopicDetailView
        topic={activeTopic}
        matchedEntries={topicEntriesMap[activeTopic.id] || []}
        saved={saved}
        toggleSaved={toggleSaved}
        onOpenDetail={onOpenDetail}
        onBack={handleBackToDashboard}
      />
    );
  }

  const query = searchQuery.trim().toLowerCase();
  const filteredTopics = civilAiTopics.filter((topic) => {
    if (selectedCat !== "all" && topic.category !== selectedCat) return false;
    if (activeSector !== "全部" && topic.sector !== "综合" && topic.sector !== activeSector) return false;
    if (!query) return true;
    const searchString = [
      topic.name,
      topic.enName,
      topic.summary,
      topic.badge,
      ...topic.tags,
      ...topic.matchedKeywords,
    ]
      .join(" ")
      .toLowerCase();
    return searchString.includes(query);
  });

  const categories = [
    { id: "all", label: "全部板块", count: civilAiTopics.length },
    { id: "enterprises", label: "企业与领军平台", count: civilAiTopics.filter((t) => t.category === "enterprises").length },
    { id: "tech_stacks", label: "核心技术栈", count: civilAiTopics.filter((t) => t.category === "tech_stacks").length },
    { id: "scenarios", label: "工程应用场景", count: civilAiTopics.filter((t) => t.category === "scenarios").length },
  ];

  return (
    <div className="topics-dashboard">
      <div className="topics-overview-banner">
        <div className="topics-banner-info">
          <div className="topics-kicker">
            <IconFolder size={14} />
            <span>TOPIC INDEX · 知识图谱</span>
          </div>
          <h2>土木工程与 AI 专题知识库</h2>
          
        </div>
        <div className="topics-metric-cards">
          <div className="metric-chip">
            <strong>{civilAiTopics.filter(t => t.category === "enterprises").length}</strong>
            <span>领军平台</span>
          </div>
          <div className="metric-chip">
            <strong>{civilAiTopics.filter(t => t.category === "tech_stacks").length}</strong>
            <span>核心技术</span>
          </div>
          <div className="metric-chip">
            <strong>{civilAiTopics.filter(t => t.category === "scenarios").length}</strong>
            <span>典型场景</span>
          </div>
          <div className="metric-chip">
            <strong>{allEntries.length}</strong>
            <span>当前条目</span>
          </div>
        </div>
      </div>

      <div className="topics-category-bar">
        <div className="topics-cat-tabs">
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className={"cat-tab-btn " + (selectedCat === cat.id ? "active" : "")}
              onClick={() => setSelectedCat(cat.id)}
            >
              <span>{cat.label}</span>
              <span className="cat-count">{cat.count}</span>
            </button>
          ))}
        </div>
        <div className="topics-cat-tip">
          当前展示 <strong>{filteredTopics.length}</strong> 个主题专题
        </div>
      </div>

      {filteredTopics.length > 0 ? (
        <div className="topics-grid">
          {filteredTopics.map((topic) => (
            <TopicCard
              key={topic.id}
              topic={topic}
              matchedEntries={topicEntriesMap[topic.id] || []}
              onSelectTopic={handleSelectTopic}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <IconSearch size={28} />
          <strong>未找到匹配的主题专题</strong>
          <span>尝试清空关键词或切换所属工程领域</span>
        </div>
      )}
    </div>
  );
}

