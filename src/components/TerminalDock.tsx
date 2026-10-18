import React, { useEffect, useRef, useState } from "react";
import { Plus, Terminal as TerminalIcon, Trash2, X } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { tauriInvoke, tauriListen } from "../bridge";

interface TerminalDockProps {
  cwd: string;
  pendingCommand: { id: number; command: string } | null;
  onClose: () => void;
}

interface TermTab {
  id: string;
  title: string;
}

export const TerminalDock: React.FC<TerminalDockProps> = ({
  cwd,
  pendingCommand,
  onClose,
}) => {
  const [tabs, setTabs] = useState<TermTab[]>([
    { id: "term-1", title: "PowerShell 1" },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>("term-1");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const xtermMapRef = useRef<
    Map<string, { term: Terminal; fit: FitAddon; opened: boolean }>
  >(new Map());

  // Listen to global terminal:data events from Rust portable-pty
  useEffect(() => {
    let unlistenData: (() => void) | null = null;
    tauriListen<{ sessionId: string; data: string }>(
      "terminal:data",
      (payload) => {
        const entry = xtermMapRef.current.get(payload.sessionId);
        if (entry) {
          entry.term.write(payload.data);
        }
      }
    ).then((fn) => {
      unlistenData = fn;
    });

    return () => {
      if (unlistenData) unlistenData();
    };
  }, []);

  // Mount and attach active terminal tab
  useEffect(() => {
    const host = containerRef.current;
    if (!host || !activeTabId) return;

    host.innerHTML = "";
    let entry = xtermMapRef.current.get(activeTabId);
    if (!entry) {
      const term = new Terminal({
        cursorBlink: true,
        fontFamily: "'Cascadia Mono', 'Consolas', 'JetBrains Mono', monospace",
        fontSize: 13,
        lineHeight: 1.25,
        theme: {
          background: "#0d1117",
          foreground: "#e6edf3",
          cursor: "#58a6ff",
          selectionBackground: "rgba(88, 166, 255, 0.3)",
        },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.onData((data) => {
        tauriInvoke("terminal_write", {
          sessionId: activeTabId,
          data,
        }).catch(() => {});
      });
      entry = { term, fit, opened: false };
      xtermMapRef.current.set(activeTabId, entry);
    }

    const mountDiv = document.createElement("div");
    mountDiv.style.width = "100%";
    mountDiv.style.height = "100%";
    host.appendChild(mountDiv);

    entry.term.open(mountDiv);
    entry.opened = true;
    setTimeout(() => {
      try {
        entry?.fit.fit();
        const cols = entry?.term.cols || 100;
        const rows = entry?.term.rows || 24;
        tauriInvoke("terminal_create_or_attach", {
          sessionId: activeTabId,
          cwd,
          cols,
          rows,
        }).catch((err) => {
          entry?.term.writeln(`\r\n\x1b[31m[PTY Error] ${String(err)}\x1b[0m`);
        });
      } catch {}
    }, 50);

    const handleResize = () => {
      try {
        entry?.fit.fit();
        if (entry?.term.cols && entry?.term.rows) {
          tauriInvoke("terminal_resize", {
            sessionId: activeTabId,
            cols: entry.term.cols,
            rows: entry.term.rows,
          }).catch(() => {});
        }
      } catch {}
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [activeTabId, cwd]);

  // Execute command sent from chat code block
  useEffect(() => {
    if (!pendingCommand || !activeTabId) return;
    tauriInvoke("terminal_create_or_attach", {
      sessionId: activeTabId,
      cwd,
      cols: 100,
      rows: 24,
    })
      .then(() =>
        tauriInvoke("terminal_write", {
          sessionId: activeTabId,
          data: `${pendingCommand.command}\r`,
        })
      )
      .catch(() => {});
  }, [pendingCommand, activeTabId, cwd]);

  const handleAddTab = () => {
    const nextNum = tabs.length + 1;
    const id = `term-${Date.now()}`;
    setTabs((prev) => [...prev, { id, title: `PowerShell ${nextNum}` }]);
    setActiveTabId(id);
  };

  const handleCloseTab = (id: string) => {
    tauriInvoke("terminal_close", { sessionId: id }).catch(() => {});
    const entry = xtermMapRef.current.get(id);
    if (entry) {
      entry.term.dispose();
      xtermMapRef.current.delete(id);
    }
    const remaining = tabs.filter((t) => t.id !== id);
    if (remaining.length === 0) {
      onClose();
      return;
    }
    setTabs(remaining);
    if (activeTabId === id) {
      setActiveTabId(remaining[0].id);
    }
  };

  return (
    <div className="terminal-dock">
      <div className="terminal-dock-header">
        <div className="terminal-tabs">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`terminal-tab ${tab.id === activeTabId ? "active" : ""}`}
              onClick={() => setActiveTabId(tab.id)}
            >
              <TerminalIcon size={13} />
              <span>{tab.title}</span>
              <button
                type="button"
                className="icon-btn-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCloseTab(tab.id);
                }}
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="icon-btn-xs"
            onClick={handleAddTab}
            title="新建终端标签页"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="terminal-header-right">
          <span className="terminal-cwd-badge" title={cwd}>
            {cwd}
          </span>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            title="隐藏终端面板"
          >
            <X size={14} />
          </button>
        </div>
      </div>
      <div ref={containerRef} className="terminal-canvas-host" />
    </div>
  );
};
