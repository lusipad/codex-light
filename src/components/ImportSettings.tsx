import React from "react";
import { importChoiceId, type ExternalImportsState } from "../externalImport";

export function ImportSettings({ state, cwd }: { state: ExternalImportsState; cwd: string }) {
  const busy = state.phase === "detecting" || state.phase === "importing";
  return <div className="settings-scroll-container">
    <div className="card-section">
      <h3>从其他 AI 应用导入</h3>
      <p className="card-subtitle-desc">检测可导入的指令、设置、技能和聊天记录，选择后再执行导入。</p>
      <button type="button" className="secondary-btn" disabled={busy}
        onClick={() => void state.detect(cwd, true)}>{state.phase === "detecting" ? "正在检测…" : "检测可导入内容"}</button>
      {state.scope.cwd && <p>检测工作区：{state.scope.cwd}</p>}
      {state.error && <p role="alert" className="error-banner">{state.error}</p>}
      {state.uncertain && <p role="alert">上次导入结果尚未确认，已阻止重复提交。请核对目标数据及后台任务。</p>}
      {state.phase === "choosing" && !state.choices.length && <p>未检测到可导入内容。</p>}
      {state.choices.map(choice => {
        const id = importChoiceId(choice);
        return <label key={id} className="settings-toggle-row">
          <input type="checkbox" disabled={busy || state.uncertain} checked={state.selected.includes(id)}
            onChange={event => state.setSelected(event.target.checked ? [...state.selected, id] : state.selected.filter(value => value !== id))} />
          <span className="settings-toggle-label">
            <span className="settings-toggle-title">{choice.provider === "cursor" ? "Cursor" : "Claude Code"} · {choice.item.itemType}</span>
            <span className="settings-toggle-desc">{choice.item.description}</span>
            <span className="settings-toggle-desc">{choice.item.cwd || "用户目录"}</span>
          </span>
        </label>;
      })}
      {state.selected.length > 0 && <div className="form-grid-row">
        <button type="button" className="primary-btn" disabled={busy || state.uncertain} onClick={() => {
          if (window.confirm(`将导入选中的 ${state.selected.length} 项内容，可能写入目标配置与文件。是否继续？`)) void state.start();
        }}>导入所选内容（{state.selected.length}）</button>
        <button type="button" className="secondary-btn" disabled={busy} onClick={() => state.setSelected([])}>取消选择</button>
      </div>}
      {state.phase === "importing" && <p role="status">正在导入，已处理 {state.progress} 项。离开此页后仍会跟踪后台任务。</p>}
    </div>
    {state.reports.map(report => <div className="card-section" key={report.importId}>
      <h3>{report.provider === "cursor" ? "Cursor" : "Claude Code"} 导入结果</h3>
      <p role="status">服务报告成功 {report.successes.length} 项，失败 {report.failures.length} 项。</p>
      {report.successes.map((item, index) => <p key={`success-${index}`}>{item.itemType} · {item.target || item.source || "未返回目标"}<br />{item.readback}</p>)}
      {report.failures.map((item, index) => <p key={`failure-${index}`} role="alert">{item.itemType} · {item.source}<br />{item.message || "导入失败"}</p>)}
    </div>)}
  </div>;
}
