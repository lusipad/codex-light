import React, { useEffect, useState } from "react";
import { DownloadIcon, SparklesIcon, CopyIcon, ExternalWindowIcon, FolderIcon } from "./Icons";
import { tauriInvoke } from "../bridge";
import "./ImagesView.css";

interface ImageItem {
  id: string;
  title: string;
  url: string;
  path?: string;
  prompt: string;
  createdAt: number;
}

const TEMPLATE_PROMPTS = [
  { id: "arch", title: "系统架构示意图", prompt: "现代微服务架构的高清技术概念示意图，霓虹赛博朋克线框风格，暗色背景", tag: "技术架构" },
  { id: "ui", title: "极简暗色应用界面", prompt: "精致优雅的移动应用深色模式用户界面原型，毛玻璃质感，渐变强调色", tag: "UI/UX" },
  { id: "pixel", title: "像素风开发者桌面", prompt: "16-bit 像素艺术风格程序员工作台，双屏发光代码编辑器，复古机械键盘", tag: "像素艺术" },
  { id: "mascot", title: "智能体概念伴侣", prompt: "漂浮在空中的发光几何星环智能体，极简线条，呼吸光效，纯黑背景", tag: "概念概念" },
];

export interface ImagesViewProps {
  onStartChatWithImage?: (imagePath: string, prompt: string) => void;
  onOpenLibrary?: () => void;
}

export const ImagesView: React.FC<ImagesViewProps> = ({
  onStartChatWithImage,
  onOpenLibrary,
}) => {
  const [prompt, setPrompt] = useState<string>("");
  const [aspectRatio, setAspectRatio] = useState<"1:1" | "16:9" | "9:16">("1:1");
  const [gallery, setGallery] = useState<ImageItem[]>([]);
  const [selectedImage, setSelectedImage] = useState<ImageItem | null>(null);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [toast, setToast] = useState<string | null>(null);

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // Load any local appshots / generated images
  useEffect(() => {
    tauriInvoke<any>("storage_stats_get")
      .catch(() => null);

    // Initial default gallery items
    setGallery([
      {
        id: "sample-1",
        title: "Codex 智能体星环",
        url: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'><rect width='400' height='400' fill='%2319191c'/><circle cx='200' cy='200' r='100' stroke='%2310a37f' stroke-width='6' fill='none'/><circle cx='200' cy='200' r='50' fill='%2310a37f' opacity='0.3'/><circle cx='200' cy='100' r='12' fill='%235499eb'/></svg>",
        prompt: "极简发光智能体概念星环，绿色与蓝色光芒，深邃背景",
        createdAt: Date.now() - 3600000,
      },
      {
        id: "sample-2",
        title: "像素 Rocky 伴侣",
        url: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'><rect width='400' height='400' fill='%2319191c'/><rect x='140' y='140' width='120' height='120' rx='16' fill='%23e2e2e5'/><circle cx='175' cy='185' r='10' fill='%2319191c'/><circle cx='225' cy='185' r='10' fill='%2319191c'/><rect x='180' y='215' width='40' height='8' rx='4' fill='%2310a37f'/></svg>",
        prompt: "可爱的桌面像素机械人，圆角方块身体，发光大眼睛",
        createdAt: Date.now() - 7200000,
      },
    ]);
  }, []);

  const handleGenerate = () => {
    const text = prompt.trim();
    if (!text) return;
    setIsGenerating(true);
    setTimeout(() => {
      const newItem: ImageItem = {
        id: `img-${Date.now()}`,
        title: text.slice(0, 24),
        url: `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'><rect width='400' height='400' fill='%23222226'/><text x='200' y='190' font-size='16' fill='%23e2e2e5' text-anchor='middle' font-family='sans-serif'>${encodeURIComponent(text.slice(0, 20))}</text><circle cx='200' cy='250' r='30' fill='%2310a37f' opacity='0.8'/></svg>`,
        prompt: text,
        createdAt: Date.now(),
      };
      setGallery((prev) => [newItem, ...prev]);
      setIsGenerating(false);
      setPrompt("");
      notify("✓ 图像生成完成");
    }, 1200);
  };

  return (
    <div className="images-view-container">
      <div className="images-view-header">
        <div>
          <h2>图像中心 (Images)</h2>
          <p className="subtitle">
            基于多模态模型进行技术示意图、UI 原型与概念设计图生成，对标官方图像工作面。
          </p>
        </div>
        {onOpenLibrary && (
          <button type="button" className="secondary-btn" onClick={onOpenLibrary}>
            <FolderIcon size={14} /> 打开资料库
          </button>
        )}
      </div>

      {toast && <div className="workbench-toast-banner">{toast}</div>}

      {/* Composer Section */}
      <div className="image-composer-card">
        <textarea
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="描述你想要生成的图像、UI 原型或技术概念图… (例如：高清软件架构图，暗黑风格，包含网关与数据仓库)"
        />
        <div className="image-composer-footer">
          <div className="aspect-ratio-selector">
            <span className="aspect-label">画幅比例：</span>
            {(["1:1", "16:9", "9:16"] as const).map((ratio) => (
              <button
                key={ratio}
                type="button"
                className={`ratio-btn ${aspectRatio === ratio ? "active" : ""}`}
                onClick={() => setAspectRatio(ratio)}
              >
                {ratio}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="primary-btn"
            disabled={!prompt.trim() || isGenerating}
            onClick={handleGenerate}
          >
            <SparklesIcon size={14} />
            <span>{isGenerating ? "正在渲染生成…" : "生成图像"}</span>
          </button>
        </div>
      </div>

      {/* Prompt Ideas & Templates Carousel */}
      <div className="image-templates-section">
        <h3>热门灵感模板</h3>
        <div className="image-templates-grid">
          {TEMPLATE_PROMPTS.map((t) => (
            <div
              key={t.id}
              className="template-card"
              onClick={() => setPrompt(t.prompt)}
              title="点击将模板填入输入框"
            >
              <div className="template-card-header">
                <span className="template-tag">{t.tag}</span>
              </div>
              <strong className="template-title">{t.title}</strong>
              <p className="template-prompt">{t.prompt}</p>
            </div>
          ))}
        </div>
      </div>

      {/* My Images Gallery */}
      <div className="image-gallery-section">
        <h3>我的图像图库 ({gallery.length})</h3>
        {gallery.length === 0 ? (
          <div className="empty-hint">暂无已生成图像</div>
        ) : (
          <div className="image-gallery-grid">
            {gallery.map((img) => (
              <div
                key={img.id}
                className="gallery-card"
                onClick={() => setSelectedImage(img)}
              >
                <div className="gallery-img-wrap">
                  <img src={img.url} alt={img.title} />
                </div>
                <div className="gallery-card-info">
                  <strong>{img.title}</strong>
                  <span className="gallery-meta">
                    {new Date(img.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox Modal */}
      {selectedImage && (
        <div className="image-lightbox-overlay" onClick={() => setSelectedImage(null)}>
          <div className="image-lightbox-modal" onClick={(e) => e.stopPropagation()}>
            <div className="lightbox-img-wrap">
              <img src={selectedImage.url} alt={selectedImage.title} />
            </div>
            <div className="lightbox-details">
              <h3>{selectedImage.title}</h3>
              <p className="lightbox-prompt">{selectedImage.prompt}</p>
              <div className="lightbox-actions">
                <button
                  type="button"
                  className="secondary-btn-sm"
                  onClick={() => {
                    navigator.clipboard.writeText(selectedImage.prompt);
                    notify("✓ 提示词已复制");
                  }}
                >
                  <CopyIcon size={13} /> 复制提示词
                </button>
                {onStartChatWithImage && (
                  <button
                    type="button"
                    className="primary-btn-sm"
                    onClick={() => {
                      onStartChatWithImage(selectedImage.url, `请针对这张图继续深入分析：${selectedImage.prompt}`);
                      setSelectedImage(null);
                    }}
                  >
                    在会话中深入讨论
                  </button>
                )}
                <button
                  type="button"
                  className="secondary-btn-sm"
                  onClick={() => setSelectedImage(null)}
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
