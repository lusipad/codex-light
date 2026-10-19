import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { PlusIcon, TerminalIcon, TrashIcon, XIcon } from "./Icons";

interface TerminalDockProps {
  open?: boolean;
  cwd: string;
  onClose: () => void;
  pendingCommand?: { id: number; command: string } | null;
}

interface SessionTab {
  id: string;
  title: string;
  cwd: string;
  shell: string;
}

const SHELL_OPTIONS = [
  { id: "powershell.exe", label: "PowerShell" },
  { id: "cmd.exe", label: "CMD" },
  { id: "bash.exe", label: "Git Bash" },
  { id: "wsl.exe", label: "WSL" },
];

export const TerminalDock: React.FC<TerminalDockProps> = ({
  open = true,
  cwd,
  onClose,
  pendingCommand,
}) => {
  const [selectedShell, setSelectedShell] = useState<string>("powershell.exe");
  const [fontSize, setFontSize] = useState<number>(13);
  const [tabs, setTabs] = useState<SessionTab[]>([
    {
      id: "term-1",
      title: "PowerShell 1",
      cwd: cwd || ".",
      shell: "powershell.exe",
    },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>("term-1");

  const containerRef = useRef<HTMLDivElement | null>(null);
  const xtermMapRef = useRef<
    Map<string, { term: Terminal; fit: FitAddon; el: HTMLDivElement }>
  >(new Map());

  useEffect(() => {
    let unlistenData: UnlistenFn | null = null;
    let unlistenExit: UnlistenFn | null = null;

    listen<{ sessionId: string; data: string }>("terminal:data", (event) => {
      const entry = xtermMapRef.current.get(event.payload.sessionId);
      if (entry) {
        entry.term.write(event.payload.data);
      }
    }).then((fn) => {
      unlistenData = fn;
    });

    listen<{ sessionId: string }>("terminal:exit", (event) => {
      const entry = xtermMapRef.current.get(event.payload.sessionId);
      if (entry) {
        entry.term.writeln("\r\n\x1b[33m[进程已退出 Process exited]\x1b[0m");
      }
    }).then((fn) => {
      unlistenExit = fn;
    });

    return () => {
      if (unlistenData) unlistenData();
      if (unlistenExit) unlistenExit();
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

  // Execute pending toolbar command (e.g. Run / Test / Build)
  const lastExecutedCmdId = useRef<number | null>(null);
  useEffect(() => {
    if (!open || !pendingCommand || pendingCommand.id === lastExecutedCmdId.current) {
      return;
    }
    lastExecutedCmdId.current = pendingCommand.id;
    const timer = setTimeout(() => {
      invoke("terminal_write", {
        sessionId: activeTabId,
        data: `${pendingCommand.command}\r`,
      }).catch(() => {});
    }, 180);
    return () => clearTimeout(timer);
  }, [open, pendingCommand, activeTabId]);

  useEffect(() => {
    if (!open || !containerRef.current) return;
    const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
    if (!activeTab) return;

    xtermMapRef.current.forEach((val, key) => {
      val.el.style.display = key === activeTab.id ? "block" : "none";
    });

    let entry = xtermMapRef.current.get(activeTab.id);
    if (!entry) {
      const el = document.createElement("div");
      el.style.width = "100%";
      el.style.height = "100%";
      containerRef.current.appendChild(el);

      const term = new Terminal({
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
      setTimeout(() => {
        try {
          fit.fit();
        } catch {
          // ignore
        }
      }, 30);

      term.onData((data) => {
        invoke("terminal_write", { sessionId: activeTab.id, data }).catch(
          () => {}
        );
      });

      entry = { term, fit, el };
      xtermMapRef.current.set(activeTab.id, entry);

      invoke("terminal_create_or_attach", {
        sessionId: activeTab.id,
        cwd: activeTab.cwd || cwd || ".",
        cols: term.cols || 100,
        rows: term.rows || 24,
        shell: activeTab.shell || selectedShell,
      }).catch((err) => {
        term.writeln(`\x1b[31m无法启动终端会话: ${String(err)}\x1b[0m`);
      });
    } else {
      setTimeout(() => {
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
      }, 30);
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

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [open, activeTabId, tabs, cwd, fontSize, selectedShell]);

  const addNewTerminal = () => {
    const idx = tabs.length + 1;
    const id = `term-${Date.now()}`;
    const shellMeta =
      SHELL_OPTIONS.find((s) => s.id === selectedShell) || SHELL_OPTIONS[0];
    const next: SessionTab = {
      id,
      title: `${shellMeta.label} ${idx}`,
      cwd: cwd || ".",
      shell: selectedShell,
    };
    setTabs((prev) => [...prev, next]);
    setActiveTabId(id);
  };

  const clearActiveTerminal = () => {
    const entry = xtermMapRef.current.get(activeTabId);
    if (entry) {
      entry.term.clear();
    }
  };

  const closeTerminalTab = (id: string) => {
    invoke("terminal_close", { sessionId: id }).catch(() => {});
    const entry = xtermMapRef.current.get(id);
    if (entry) {
      entry.term.dispose();
      entry.el.remove();
      xtermMapRef.current.delete(id);
    }
    const remaining = tabs.filter((t) => t.id !== id);
    if (remaining.length === 0) {
      onClose();
      setTabs([
        {
          id: `term-${Date.now()}`,
          title: "PowerShell 1",
          cwd: cwd || ".",
          shell: selectedShell,
        },
      ]);
    } else {
      setTabs(remaining);
      if (activeTabId === id) {
        setActiveTabId(remaining[remaining.length - 1].id);
      }
    }
  };

  if (!open) return null;

  return (
    <div className="terminal-dock">
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
            {SHELL_OPTIONS.map((s) => (
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
      <div className="terminal-xterm-wrapper" ref={containerRef} />
    </div>
  );
};
