import React, { useState } from "react";
import { ExternalWindowIcon, PlusIcon, SearchIcon, SparklesIcon } from "./Icons";
import "./GptsView.css";

interface GptItem {
  id: string;
  name: string;
  description: string;
  author: string;
  category: string;
  avatar: string;
  promptStarter: string;
}

const SAMPLE_GPTS: GptItem[] = [
  {
    id: "code-architect",
    name: "Code Architect",
    description: "专注大型项目架构设计、设计模式推演与技术选型对比。",
    author: "OpenAI",
    category: "编程开发",
    avatar: "🏗️",
    promptStarter: "请帮我评审当前系统的微服务拆分方案",
  },
  {
    id: "rust-mentor",
    name: "Rust Mentor",
    description: "深入剖析所有权模型、生命周期推导与异步并发编程最佳实践。",
    author: "Rustaceans",
    category: "编程开发",
    avatar: "🦀",
    promptStarter: "解释这段代码中为什么借用检查器会报错",
  },
  {
    id: "tech-doc-writer",
    name: "Tech Doc Writer",
    description: "编写清晰专业的 API 规范、技术白皮书与 Markdown 文档。",
    author: "DocCraft",
    category: "写作辅助",
    avatar: "✍️",
    promptStarter: "帮我为当前的 REST API 生成 OpenAPI 格式文档草案",
  },
  {
    id: "data-analyst",
    name: "Data Analyst Pro",
    description: "上传 CSV 或 SQL 日志，快速生成数据洞察与可视化图表建议。",
    author: "InsightLab",
    category: "研究分析",
    avatar: "📊",
    promptStarter: "分析这段查询日志中的慢查询性能瓶颈",
  },
];

const CATEGORIES = ["全部", "编程开发", "研究分析", "写作辅助", "生产力"];

export interface GptsViewProps {
  onStartGptChat?: (gpt: GptItem) => void;
  onNavigatePlugins?: () => void;
}

export const GptsView: React.FC<GptsViewProps> = ({
  onStartGptChat,
  onNavigatePlugins,
}) => {
  const [activeTab, setActiveTab] = useState<"explore" | "mine">("explore");
  const [selectedCategory, setSelectedCategory] = useState<string>("全部");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const filteredGpts = SAMPLE_GPTS.filter((gpt) => {
    const matchesCat = selectedCategory === "全部" || gpt.category === selectedCategory;
    const matchesSearch =
      !searchQuery.trim() ||
      gpt.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      gpt.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  return (
    <div className="gpts-view-container">
      {/* 官方 12 月 11 日迁移停用实测横幅 */}
      <div className="gpts-deprecation-banner" role="alert">
        <span className="deprecation-icon">⚠️</span>
        <div className="deprecation-text">
          <strong>官方迁移提示：GPT 将于 12 月 11 日停用</strong>
          <p>
            由创建者迁移的 GPT 之后将以**插件 (Plugins & Skills)** 形式继续运行与分发。你可以将自定义指令无缝迁移为独立技能。
          </p>
        </div>
        {onNavigatePlugins && (
          <button type="button" className="migration-btn" onClick={onNavigatePlugins}>
            浏览插件中心 →
          </button>
        )}
      </div>

      <div className="gpts-header-row">
        <div>
          <h2>GPTs 探索与迁移中心</h2>
          <p className="subtitle">
            发现定制化智能体、迁移旧版 GPT 配置至现代插件与技能生态。
          </p>
        </div>
        <div className="gpts-tabs">
          <button
            type="button"
            className={`gpts-tab-btn ${activeTab === "explore" ? "active" : ""}`}
            onClick={() => setActiveTab("explore")}
          >
            探索发现
          </button>
          <button
            type="button"
            className={`gpts-tab-btn ${activeTab === "mine" ? "active" : ""}`}
            onClick={() => setActiveTab("mine")}
          >
            我的 GPTs
          </button>
        </div>
      </div>

      {activeTab === "explore" ? (
        <>
          <div className="gpts-filter-bar">
            <div className="gpts-search-wrap">
              <SearchIcon size={14} />
              <input
                type="text"
                placeholder="搜索精选智能体与工具…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="gpts-category-pills">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`gpts-cat-pill ${selectedCategory === cat ? "active" : ""}`}
                  onClick={() => setSelectedCategory(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="gpts-grid">
            {filteredGpts.map((gpt) => (
              <div
                key={gpt.id}
                className="gpt-card"
                onClick={() => onStartGptChat?.(gpt)}
                title={`与 ${gpt.name} 开始对话`}
              >
                <div className="gpt-card-avatar">{gpt.avatar}</div>
                <div className="gpt-card-body">
                  <div className="gpt-card-title-row">
                    <strong>{gpt.name}</strong>
                    <span className="gpt-badge">{gpt.category}</span>
                  </div>
                  <p className="gpt-desc">{gpt.description}</p>
                  <div className="gpt-card-footer">
                    <span className="gpt-author">由 {gpt.author} 提供</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="my-gpts-section">
          <div className="my-gpts-header">
            <h3>我创建的 GPTs</h3>
            <button
              type="button"
              className="primary-btn"
              onClick={() => onNavigatePlugins?.()}
            >
              <PlusIcon size={14} /> 创建新插件技能
            </button>
          </div>
          <div className="empty-hint" style={{ padding: "36px 0" }}>
            <p>你尚未创建自定义 GPT。官方建议直接通过 <strong>技能与插件生态 ($skill-creator)</strong> 创建可长效维护的本地智能体。</p>
          </div>
        </div>
      )}
    </div>
  );
};
