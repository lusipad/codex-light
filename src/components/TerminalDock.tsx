import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { DesktopOpenPreferences } from "./GeneralOpenPreferences";
import { PlusIcon, TerminalIcon, TrashIcon, XIcon } from "./Icons";
import { createTerminalOutput, type TerminalOutputData, type TerminalOutputExit, type TerminalSnapshot } from "../terminalOutput";
import type { EnvironmentActionRunRequest } from "../environmentActions";

interface TerminalDockProps {
  open?: boolean;
  cwd: string;
  onClose: () => void;
  pendingCommand?: { id: number; command: string; cwd?: string } | null;
  onCommandHandled?: (id: number) => void;
  pendingAction?: EnvironmentActionRunRequest | null;
  onActionResult?: (id: string, error?: string) => void;
}

interface SessionTab {
  id: string;
  title: string;
  cwd: string;
  shell: string;
  action?: EnvironmentActionRunRequest;
}



export const TerminalDock: React.FC<TerminalDockProps> = ({
  open = true,
  cwd,
  onClose,
  pendingCommand,
  onCommandHandled,
  pendingAction,
  onActionResult,
}) => {
  const [selectedShell, setSelectedShell] = useState<string>("");
  const [shellOptions, setShellOptions] = useState<{ id: string; label: string }[]>([]);
  const [fontSize, setFontSize] = useState<number>(13);
  const [dockHeight, setDockHeight] = useState<number>(260);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [commandRetry, setCommandRetry] = useState(0);
  const [tabs, setTabs] = useState<SessionTab[]>(() => [
    {
      id: crypto.randomUUID(),
      title: "终端 1",
      cwd: cwd || ".",
      shell: "",
    },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>(tabs[0].id);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const subscriptionsReadyRef = useRef<Promise<boolean>>(Promise.resolve(false));
  const handledActionsRef = useRef(new Set<string>());
  const onActionResultRef = useRef(onActionResult);
  onActionResultRef.current = onActionResult;
  const pendingActionRef = useRef(pendingAction);
  pendingActionRef.current = pendingAction;
  const xtermMapRef = useRef<
    Map<string, {
      term: Terminal; fit: FitAddon; el: HTMLDivElement; ready: Promise<boolean>;
      output: ReturnType<typeof createTerminalOutput>; cancelHydration: () => void;
      actionId?: string;
      cancelAction?: () => void;
    }>
  >(new Map());

  useEffect(() => {
    let cancelled = false;
    invoke<DesktopOpenPreferences>("desktop_open_preferences").then(value => {
      if (!cancelled) setShellOptions(value.shells);
    }).catch(error => { if (!cancelled) setCommandError(`读取终端 Shell 失败：${String(error)}`); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlistenData: UnlistenFn | null = null;
    let unlistenExit: UnlistenFn | null = null;

    const dataReady = listen<TerminalOutputData>("terminal:data", (event) => {
      if (disposed) return;
      const entry = xtermMapRef.current.get(event.payload.sessionId);
      if (entry) {
        entry.output.data(event.payload);
      }
    }).then((fn) => {
      if (disposed) fn();
      else unlistenData = fn;
    });

    const exitReady = listen<TerminalOutputExit>("terminal:exit", (event) => {
      if (disposed) return;
      const entry = xtermMapRef.current.get(event.payload.sessionId);
      if (entry) {
        entry.output.exit(event.payload);
      }
    }).then((fn) => {
      if (disposed) fn();
      else unlistenExit = fn;
    });
    subscriptionsReadyRef.current = Promise.all([dataReady, exitReady])
      .then(() => !disposed)
      .catch((error) => {
        if (!disposed) setCommandError(`监听终端输出失败：${String(error)}`);
        return false;
      });

    return () => {
      disposed = true;
      if (unlistenData) unlistenData();
      if (unlistenExit) unlistenExit();
      xtermMapRef.current.forEach(({ term, el, output, cancelHydration, actionId, cancelAction }, sessionId) => {
        cancelAction?.();
        if (actionId) void invoke("terminal_close", { sessionId }).catch(() => {});
        output.dispose();
        cancelHydration();
        term.dispose();
        el.remove();
      });
      xtermMapRef.current.clear();
    };
  }, []);

  // Update font size on all existing terminals
  useEffect(() => {
    xtermMapRef.current.forEach((entry) => {
      entry.term.options.fontSize = fontSize;
      try {
        entry.fit.fit();
      } catch {
        // ignore
      }
    });
  }, [fontSize]);

  const lastExecutedCmdId = useRef<number | null>(null);

  useEffect(() => {
    if (!open || !pendingAction || handledActionsRef.current.has(pendingAction.id)) return;
    handledActionsRef.current.add(pendingAction.id);
    const next: SessionTab = {
      id: pendingAction.sessionId, title: pendingAction.title,
      cwd: pendingAction.cwd, shell: selectedShell, action: pendingAction,
    };
    setTabs(previous => {
      const existing = previous.findIndex(tab => tab.id === next.id);
      return existing < 0 ? [...previous, next] : previous.map((tab, index) => index === existing ? next : tab);
    });
    setActiveTabId(next.id);
    setCommandError(null);
  }, [open, pendingAction, selectedShell]);

  useEffect(() => {
    if (!open || !containerRef.current) return;
    const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
    if (!activeTab) return;
    const fitTimers: ReturnType<typeof setTimeout>[] = [];

    xtermMapRef.current.forEach((val, key) => {
      val.el.style.display = key === activeTab.id ? "block" : "none";
    });

    let entry = xtermMapRef.current.get(activeTab.id);
    if (entry && entry.actionId !== activeTab.action?.id) {
      entry.cancelAction?.();
      entry.output.dispose();
      entry.cancelHydration();
      entry.term.dispose();
      entry.el.remove();
      xtermMapRef.current.delete(activeTab.id);
      entry = undefined;
    }
    if (!entry) {
      const el = document.createElement("div");
      el.style.width = "100%";
      el.style.height = "100%";
      containerRef.current.appendChild(el);

      const term = new Terminal({
        disableStdin: true,
        cursorBlink: true,
        fontSize,
        fontFamily:
          "'JetBrains Mono', 'Cascadia Mono', 'Consolas', monospace",
        theme: {
          background: "#0d0f12",
          foreground: "#e5e7eb",
          cursor: "#60a5fa",
          selectionBackground: "rgba(96, 165, 250, 0.28)",
        },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(el);
      fitTimers.push(setTimeout(() => {
        try {
          fit.fit();
        } catch {
          // ignore
        }
      }, 30));

      let hydrated = false;
      let actionResultReported = false;
      const finishAction = (error?: string) => {
        if (!activeTab.action || actionResultReported) return;
        actionResultReported = true;
        onActionResultRef.current?.(activeTab.action.id, error);
      };
      let settleHydration: (ready: boolean) => void = () => {};
      const hydration = new Promise<boolean>((resolve) => { settleHydration = resolve; });
      const isCurrent = () => xtermMapRef.current.get(activeTab.id)?.term === term;
      const output = createTerminalOutput(activeTab.id, {
        write(data, replay) {
          if (!isCurrent()) return;
          if (!replay) {
            term.write(data);
            return;
          }
          const complete = () => {
            if (!isCurrent()) return;
            hydrated = true;
            term.options.disableStdin = false;
            settleHydration(true);
          };
          if (data) term.write(data, complete);
          else complete();
        },
        onExit() {
          if (isCurrent()) term.writeln("\r\n\x1b[33m[进程已退出 Process exited]\x1b[0m");
        },
      });

      term.attachCustomKeyEventHandler((arg: KeyboardEvent) => {
        if (arg.type === "keydown") {
          if (
            (arg.ctrlKey || arg.metaKey) &&
            ((arg.shiftKey && arg.key.toLowerCase() === "c") ||
              (arg.key.toLowerCase() === "c" && term.hasSelection()))
          ) {
            const sel = term.getSelection();
            if (sel) {
              navigator.clipboard.writeText(sel);
              return false;
            }
          }
          if ((arg.ctrlKey || arg.metaKey) && arg.key.toLowerCase() === "v") {
            navigator.clipboard.readText().then((clip) => {
              if (clip && hydrated && isCurrent()) {
                invoke("terminal_write", { sessionId: activeTab.id, data: clip }).catch(() => {});
              }
            });
            return false;
          }
        }
        return true;
      });

      term.onData((data) => {
        if (!hydrated || !isCurrent()) return;
        invoke("terminal_write", { sessionId: activeTab.id, data }).catch(
          () => {}
        );
      });

      entry = { term, fit, el, output, actionId: activeTab.action?.id,
        cancelAction: activeTab.action ? () => finishAction("终端标签页已关闭，操作已取消。") : undefined,
        cancelHydration: () => settleHydration(false), ready: Promise.resolve(false) };
      xtermMapRef.current.set(activeTab.id, entry);

      entry.ready = subscriptionsReadyRef.current.then((listening) => {
        if (!listening || !isCurrent() || (activeTab.action && pendingActionRef.current?.id !== activeTab.action.id)) {
          finishAction("终端监听或操作上下文已关闭，操作未发送。");
          return false;
        }
        const action = activeTab.action;
        return invoke<TerminalSnapshot>(action ? "terminal_run_environment_action" : "terminal_create_or_attach", {
        sessionId: activeTab.id,
        cwd: action ? action.workspaceCwd : activeTab.cwd || cwd || ".",
        ...(action ? { configPath: action.configPath, expectedContent: action.expectedContent, index: action.index } : {}),
        cols: term.cols || 100,
        rows: term.rows || 24,
        shell: activeTab.shell || selectedShell,
      })
        .then((info) => {
          if (!isCurrent()) {
            if (action) {
              if (!xtermMapRef.current.has(activeTab.id)) void invoke("terminal_close", { sessionId: activeTab.id }).catch(() => {});
              finishAction("终端标签页已关闭，操作已取消。");
            }
            return false;
          }
          output.attach(info);
          finishAction();
          return hydration;
        })
        .catch((err) => {
          finishAction(String(err));
          if (xtermMapRef.current.get(activeTab.id)?.term === term) {
            term.writeln(`\x1b[31m无法启动终端会话: ${String(err)}\x1b[0m`);
          }
          return false;
        });
      });
    } else {
      fitTimers.push(setTimeout(() => {
        try {
          entry!.fit.fit();
          invoke("terminal_resize", {
            sessionId: activeTab.id,
            cols: entry!.term.cols,
            rows: entry!.term.rows,
          }).catch(() => {});
        } catch {
          // ignore
        }
      }, 30));
    }

    const handleResize = () => {
      const curr = xtermMapRef.current.get(activeTab.id);
      if (!curr) return;
      try {
        curr.fit.fit();
        invoke("terminal_resize", {
          sessionId: activeTab.id,
          cols: curr.term.cols,
          rows: curr.term.rows,
        }).catch(() => {});
      } catch {
        // ignore
      }
    };

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && containerRef.current) {
      ro = new ResizeObserver(() => handleResize());
      ro.observe(containerRef.current);
    }

    window.addEventListener("resize", handleResize);
    return () => {
      fitTimers.forEach(clearTimeout);
      window.removeEventListener("resize", handleResize);
      ro?.disconnect();
    };
  }, [open, activeTabId, tabs, cwd, fontSize, selectedShell]);

  useEffect(() => {
    if (!open || !pendingCommand || pendingCommand.id === lastExecutedCmdId.current) return;
    if (pendingCommand.cwd && pendingCommand.cwd !== cwd) {
      lastExecutedCmdId.current = pendingCommand.id;
      setCommandError("环境动作的工作区已变化，已取消尚未发送的命令。");
      onCommandHandled?.(pendingCommand.id);
      return;
    }
    const activeTab = tabs.find((tab) => tab.id === activeTabId);
    if (activeTab?.action || activeTab?.cwd !== (cwd || ".")) {
      const matchingTab = tabs.find((tab) => !tab.action && tab.cwd === (cwd || "."));
      if (matchingTab) setActiveTabId(matchingTab.id);
      else addNewTerminal();
      return;
    }
    const entry = xtermMapRef.current.get(activeTabId);
    if (!entry) return;
    let cancelled = false;
    setCommandError(null);
    void (async () => {
      if (!await entry.ready) {
        if (!cancelled) setCommandError("终端尚未启动，请新建终端后重试命令。");
        return;
      }
      if (cancelled || xtermMapRef.current.get(activeTabId) !== entry) return;
      lastExecutedCmdId.current = pendingCommand.id;
      try {
        await invoke("terminal_write", {
          sessionId: activeTabId,
          data: `${pendingCommand.command}\r`,
        });
        onCommandHandled?.(pendingCommand.id);
      } catch (error) {
        if (xtermMapRef.current.get(activeTabId) === entry && lastExecutedCmdId.current === pendingCommand.id) {
          setCommandError(`命令输入可能不完整，请检查终端后重试：${String(error)}`);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [open, pendingCommand, activeTabId, tabs, cwd, commandRetry, onCommandHandled]);

  const addNewTerminal = () => {
    const idx = tabs.length + 1;
    const id = crypto.randomUUID();
    const shellMeta =
      shellOptions.find((s) => s.id === selectedShell) || { label: "终端" };
    const next: SessionTab = {
      id,
      title: `${shellMeta.label} ${idx}`,
      cwd: cwd || ".",
      shell: selectedShell,
    };
    setTabs((prev) => [...prev, next]);
    setActiveTabId(id);
  };

  const interruptActiveTerminal = () => {
    invoke("terminal_write", {
      sessionId: activeTabId,
      data: "\x03",
    }).catch(() => {});
  };

  const handleStartResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = dockHeight;
    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = startY - moveEvent.clientY;
      const newHeight = Math.max(140, Math.min(window.innerHeight * 0.8, startHeight + deltaY));
      setDockHeight(newHeight);
      const curr = xtermMapRef.current.get(activeTabId);
      if (curr) {
        try {
          curr.fit.fit();
          invoke("terminal_resize", {
            sessionId: activeTabId,
            cols: curr.term.cols,
            rows: curr.term.rows,
          }).catch(() => {});
        } catch {
          // ignore
        }
      }
    };
    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const clearActiveTerminal = () => {
    const entry = xtermMapRef.current.get(activeTabId);
    if (entry) {
      entry.cancelAction?.();
      entry.term.clear();
    }
  };

  const closeTerminalTab = (id: string) => {
    invoke("terminal_close", { sessionId: id }).catch(() => {});
    const entry = xtermMapRef.current.get(id);
    if (entry) {
      entry.output.dispose();
      entry.cancelHydration();
      entry.term.dispose();
      entry.el.remove();
      xtermMapRef.current.delete(id);
    } else {
      const action = tabs.find(tab => tab.id === id)?.action;
      if (action) onActionResultRef.current?.(action.id, "终端标签页已关闭，操作未发送。");
    }
    const remaining = tabs.filter((t) => t.id !== id);
    if (remaining.length === 0) {
      onClose();
      const id = crypto.randomUUID();
      setTabs([
        {
          id,
          title: "终端 1",
          cwd: cwd || ".",
          shell: selectedShell,
        },
      ]);
      setActiveTabId(id);
    } else {
      setTabs(remaining);
      if (activeTabId === id) {
        setActiveTabId(remaining[remaining.length - 1].id);
      }
    }
  };

  return (
    <div className="terminal-dock" style={{ height: dockHeight, display: open ? undefined : "none" }}>
      <div className="terminal-dock-resizer" onMouseDown={handleStartResize} title="拖动调整终端高度" />
      <div className="terminal-dock-header">
        <div className="terminal-tabs">
          {tabs.map((t) => (
            <div
              key={t.id}
              className={`terminal-tab ${t.id === activeTabId ? "active" : ""}`}
              onClick={() => setActiveTabId(t.id)}
            >
              <TerminalIcon size={12} />
              <span>{t.title}</span>
              <button
                className="terminal-tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTerminalTab(t.id);
                }}
                title="关闭终端会话"
              >
                <XIcon size={11} />
              </button>
            </div>
          ))}
          <select
            className="terminal-shell-select"
            value={selectedShell}
            onChange={(e) => setSelectedShell(e.target.value)}
            title="选择新建终端的默认 Shell"
          >
            <option value="">使用通用设置默认 Shell</option>
            {shellOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            className="icon-btn"
            onClick={addNewTerminal}
            title="新建终端标签页"
          >
            <PlusIcon size={13} />
          </button>
        </div>
        <div className="terminal-dock-actions">
          <span className="terminal-cwd-badge" title={cwd}>
            {cwd}
          </span>
          <button
            className="icon-btn"
            onClick={() => setFontSize((f) => Math.max(10, f - 1))}
            title="缩小终端字号"
          >
            A-
          </button>
          <button
            className="icon-btn"
            onClick={() => setFontSize((f) => Math.min(20, f + 1))}
            title="放大终端字号"
          >
            A+
          </button>
          <button
            className="icon-btn"
            onClick={interruptActiveTerminal}
            title="中断当前运行 (Ctrl+C)"
            style={{ fontWeight: 600, fontSize: "calc(11px * var(--font-ui-scale, 1))" }}
          >
            ^C
          </button>
          <button
            className="icon-btn"
            onClick={clearActiveTerminal}
            title="清空当前终端屏幕"
          >
            <TrashIcon size={13} />
          </button>
          <button className="icon-btn" onClick={onClose} title="隐藏底部终端面板">
            <XIcon size={14} />
          </button>
        </div>
      </div>
      {commandError && (
        <div role="status">
          {commandError}
          {pendingCommand && <button onClick={() => {
            lastExecutedCmdId.current = null;
            setCommandRetry((value) => value + 1);
          }}>重试命令</button>}
        </div>
      )}
      <div className="terminal-xterm-wrapper" ref={containerRef} />
    </div>
  );
};
