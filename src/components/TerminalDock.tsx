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
import "./TerminalDock.css";

function terminalAppearance(element: HTMLElement) {
  const style = getComputedStyle(element);
  return {
    fontFamily: style.getPropertyValue("--font-mono").trim() || "Consolas, monospace",
    fontSize: parseFloat(style.getPropertyValue("--font-code-size")) || 12,
    theme: {
      background: style.getPropertyValue("--bg-primary").trim(),
      foreground: style.getPropertyValue("--text-primary").trim(),
      cursor: style.getPropertyValue("--text-primary").trim(),
      selectionBackground: style.getPropertyValue("--selection-bg").trim(),
    },
  };
}

export type TerminalPanelRequest = { action: "open-terminal" | "toggle-bottom" };

interface TerminalDockProps {
  open?: boolean;
  cwd: string;
  onClose: () => void;
  panelRequest?: TerminalPanelRequest | null;
  onPanelRequestHandled?: (request: TerminalPanelRequest) => void;
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
  dockPosition?: TerminalDockPosition;
  action?: EnvironmentActionRunRequest;
}

type TerminalDockPosition = "left" | "right" | "bottom";
type TerminalDropPreview = { position: TerminalDockPosition | null };
const terminalDockPositions = ["left", "right", "bottom"] as const;
const terminalDockLabels = { left: "左侧终端", right: "右侧终端", bottom: "底部终端" };

async function readTerminalLocation(): Promise<"bottom" | "right"> {
  const value = await invoke<unknown>("desktop_state_get", { key: "defaultTerminalLocation" }).catch(() => null);
  return value === "right" ? "right" : "bottom";
}

function terminalDockGroups(tabs: SessionTab[], selection: string[]) {
  return terminalDockPositions.flatMap(position => {
    const dockTabs = tabs.filter(tab => (tab.dockPosition ?? "bottom") === position);
    if (!dockTabs.length) return [];
    const selected = selection.map(id => dockTabs.find(tab => tab.id === id)).find(tab => tab !== undefined) ?? dockTabs[0];
    return [{ position, dockTabs, selected }];
  });
}

function terminalDropPosition(bounds: DOMRect, x: number, y: number): TerminalDockPosition | null {
  if (x < bounds.left || x >= bounds.right || y < bounds.top || y >= bounds.bottom) return null;
  const across = (x - bounds.left) / bounds.width;
  if (across < 0.25) return "left";
  if (across >= 0.75) return "right";
  return y >= bounds.top + bounds.height * 0.73 ? "bottom" : null;
}

export const TerminalDock: React.FC<TerminalDockProps> = ({
  open = true,
  cwd,
  onClose,
  panelRequest,
  onPanelRequestHandled,
  pendingCommand,
  onCommandHandled,
  pendingAction,
  onActionResult,
}) => {
  const [selectedShell, setSelectedShell] = useState<string>("");
  const [shellOptions, setShellOptions] = useState<{ id: string; label: string }[]>([]);
  const [fontSize, setFontSize] = useState<number>(12);
  const [actionsOpen, setActionsOpen] = useState<TerminalDockPosition | false>(false);
  const [hiddenDocks, setHiddenDocks] = useState<TerminalDockPosition[]>([]);
  const [panelFocusId, setPanelFocusId] = useState<string | null>(null);
  const handledPanelRequest = useRef<TerminalPanelRequest | null>(null);
  const [dockHeight, setDockHeight] = useState<number>(260);
  const [dockWidths, setDockWidths] = useState({ left: 360, right: 360 });
  const [commandError, setCommandError] = useState<string | null>(null);
  const [commandRetry, setCommandRetry] = useState(0);
  const [tabs, setTabs] = useState<SessionTab[]>([]);
  const [selection, setSelection] = useState<string[]>([]);
  const activeTabId = selection[0] ?? "";
  const setActiveTabId = (id: string) => {
    setSelection(current => current[0] === id ? current : [id, ...current.filter(previous => previous !== id && tabs.some(tab => tab.id === previous))]);
  };
  const groups = terminalDockGroups(tabs, selection);
  const visibleGroups = groups.filter(group => !hiddenDocks.includes(group.position));
  const hiddenGroups = groups.filter(group => hiddenDocks.includes(group.position));
  const bothSides = visibleGroups.some(group => group.position === "left") && visibleGroups.some(group => group.position === "right");
  const revealDock = (position: TerminalDockPosition) => {
    setHiddenDocks(current => current.includes(position) ? current.filter(dock => dock !== position) : current);
  };
  const hideDock = (position: TerminalDockPosition) => {
    setHiddenDocks(current => current.includes(position) ? current : [...current, position]);
    if (actionsOpen === position) setActionsOpen(false);
    const remaining = visibleGroups.filter(group => group.position !== position);
    const fallback = remaining.find(group => group.selected.id === activeTabId) ?? remaining[0];
    if (!fallback) return;
    setActiveTabId(fallback.selected.id);
    requestAnimationFrame(() => document.getElementById(`terminal-tab-${fallback.selected.id}`)?.focus());
  };
  const dockResizeRef = useRef<{ id: number; position: TerminalDockPosition; start: number; size: number; limit: number } | null>(null);
  const tabDragRef = useRef<{ id: number; tabId: string; x: number; y: number; bounds: DOMRect; moving: boolean } | null>(null);
  const suppressTabClickRef = useRef(false);
  const [dropPreview, setDropPreview] = useState<TerminalDropPreview | null>(null);

  useEffect(() => {
    if (open) return;
    tabDragRef.current = null;
    setDropPreview(null);
  }, [open]);

  const dockContainersRef = useRef(new Map<TerminalDockPosition, HTMLDivElement>());
  const actionsTriggersRef = useRef(new Map<TerminalDockPosition, HTMLButtonElement>());
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
      releaseInput?: () => void;
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
      xtermMapRef.current.forEach(({ term, el, output, cancelHydration, actionId, cancelAction, releaseInput }, sessionId) => {
        releaseInput?.();
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
    const update = () => {
      const element = dockContainersRef.current.values().next().value;
      if (!element) return;
      const appearance = terminalAppearance(element);
      setFontSize(appearance.fontSize);
      xtermMapRef.current.forEach((entry, sessionId) => {
        const { term } = entry;
        term.options.fontFamily = appearance.fontFamily;
        term.options.theme = appearance.theme;
        term.options.fontSize = appearance.fontSize;
        try {
          entry.fit.fit();
          void entry.ready.then(ready => {
            if (ready && xtermMapRef.current.get(sessionId) === entry) {
              void invoke("terminal_resize", { sessionId, cols: term.cols, rows: term.rows }).catch(() => {});
            }
          });
        } catch {
          // Hidden renderers are fitted again when their tab opens.
        }
      });
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-theme"] });
    document.fonts.addEventListener("loadingdone", update);
    return () => {
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", update);
    };
  }, []);

  useEffect(() => {
    xtermMapRef.current.forEach((entry, sessionId) => {
      entry.term.options.fontSize = fontSize;
      try {
        entry.fit.fit();
        void entry.ready.then(ready => {
          if (ready && xtermMapRef.current.get(sessionId) === entry) {
            void invoke("terminal_resize", { sessionId, cols: entry.term.cols, rows: entry.term.rows }).catch(() => {});
          }
        });
      } catch {
        // ignore
      }
    });
  }, [fontSize]);

  const lastExecutedCmdId = useRef<number | null>(null);

  useEffect(() => {
    if (!open || !pendingAction || handledActionsRef.current.has(pendingAction.id)) return;
    let cancelled = false;
    const showAction = (position: TerminalDockPosition) => {
      if (cancelled) return;
      handledActionsRef.current.add(pendingAction.id);
      const next: SessionTab = {
        id: pendingAction.sessionId, title: pendingAction.title, dockPosition: position,
        cwd: pendingAction.cwd, shell: selectedShell, action: pendingAction,
      };
      revealDock(position);
      setTabs(previous => previous.some(tab => tab.id === next.id)
        ? previous.map(tab => tab.id === next.id ? next : tab)
        : [...previous, next]);
      setActiveTabId(next.id);
      setCommandError(null);
    };
    const existing = tabs.find(tab => tab.id === pendingAction.sessionId);
    if (existing) showAction(existing.dockPosition ?? "bottom");
    else void readTerminalLocation().then(showAction);
    return () => { cancelled = true; };
  }, [open, pendingAction, selectedShell, tabs]);

  const attachDockTerminal = (activeTab: SessionTab, container: HTMLDivElement) => {
    const fitTimers: ReturnType<typeof setTimeout>[] = [];

    let entry = xtermMapRef.current.get(activeTab.id);
    if (entry && entry.actionId !== activeTab.action?.id) {
      entry.releaseInput?.();
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
      container.appendChild(el);

      const term = new Terminal({
        disableStdin: true,
        cursorBlink: true,
        fontSize,
        fontFamily: terminalAppearance(el).fontFamily,
        theme: terminalAppearance(el).theme,
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
      let attached = false;
      let userKey: string | null = null;
      let userInputEvent: Event | null = null;
      const compositionInputs: { start: number; end?: number }[] = [];
      const inputTimers = new Set<ReturnType<typeof setTimeout>>();
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
              if (clip && attached && isCurrent()) {
                invoke("terminal_write", { sessionId: activeTab.id, data: clip }).catch(() => {});
              }
            });
            return false;
          }
        }
        return true;
      });

      const markUserInput = (event: Event) => {
        if (event.target === term.textarea) userInputEvent = event;
      };
      const keySubscription = term.onKey(event => { userKey = event.key; });
      const startComposition = (event: Event) => {
        if (event.target !== term.textarea || !term.textarea) return;
        const start = term.textarea.value.length;
        compositionInputs.forEach(input => { input.end ??= start; });
        compositionInputs.push({ start });
      };
      const endComposition = (event: Event) => {
        if (event.target !== term.textarea) return;
        const input = compositionInputs.at(-1);
        if (!input) return;
        // xterm finalizes composition in a zero-delay timer registered by its
        // target listener. Expire this exact-text credential after that timer.
        void Promise.resolve().then(() => {
          if (!isCurrent()) return;
          const timer = setTimeout(() => {
            inputTimers.delete(timer);
            const index = compositionInputs.indexOf(input);
            if (index >= 0) compositionInputs.splice(index, 1);
          }, 0);
          inputTimers.add(timer);
        });
      };
      el.addEventListener("input", markUserInput, true);
      el.addEventListener("paste", markUserInput, true);
      el.addEventListener("compositionstart", startComposition, true);
      el.addEventListener("compositionend", endComposition, true);

      term.onData((data) => {
        // xterm can ignore an input event without emitting onData. Its Event is
        // user input only during synchronous dispatch, never a later ANSI reply.
        const compositionIndex = data.length === 0 ? -1 : compositionInputs.findIndex(input =>
          term.textarea?.value.substring(input.start, input.end) === data);
        const fromUser = userKey === data || (userInputEvent != null && userInputEvent.eventPhase !== 0) || compositionIndex >= 0;
        if (compositionIndex >= 0) compositionInputs.splice(compositionIndex, 1);
        userKey = null;
        userInputEvent = null;
        if (!attached || (!hydrated && !fromUser) || !isCurrent()) return;
        invoke("terminal_write", { sessionId: activeTab.id, data }).catch(
          () => {}
        );
      });

      entry = { term, fit, el, output, actionId: activeTab.action?.id,
        releaseInput: () => {
          keySubscription.dispose();
          userKey = null;
          userInputEvent = null;
          compositionInputs.length = 0;
          inputTimers.forEach(clearTimeout);
          inputTimers.clear();
          el.removeEventListener("input", markUserInput, true);
          el.removeEventListener("paste", markUserInput, true);
          el.removeEventListener("compositionstart", startComposition, true);
          el.removeEventListener("compositionend", endComposition, true);
        },
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
          attached = true;
          term.options.disableStdin = false;
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
      if (entry.el.parentElement !== container) container.appendChild(entry.el);
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
      if (!curr || curr.el.parentElement !== container) return;
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
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => handleResize());
      ro.observe(container);
    }

    window.addEventListener("resize", handleResize);
    return () => {
      fitTimers.forEach(clearTimeout);
      window.removeEventListener("resize", handleResize);
      ro?.disconnect();
    };
  };

  useEffect(() => {
    if (!open) return;
    const shown = new Set(visibleGroups.map(group => group.selected.id));
    xtermMapRef.current.forEach((entry, id) => {
      entry.el.style.display = shown.has(id) ? "block" : "none";
    });
    const cleanups = visibleGroups.flatMap(group => {
      const container = dockContainersRef.current.get(group.position);
      return container ? [attachDockTerminal(group.selected, container)] : [];
    });
    return () => cleanups.forEach(cleanup => cleanup());
  }, [open, selection, tabs, hiddenDocks, cwd, fontSize, selectedShell]);

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
      if (matchingTab) {
        revealDock(matchingTab.dockPosition ?? "bottom");
        setActiveTabId(matchingTab.id);
      }
      else return scheduleDefaultTerminal();
      return;
    }
    const position = activeTab.dockPosition ?? "bottom";
    if (hiddenDocks.includes(position)) {
      revealDock(position);
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
  }, [open, pendingCommand, activeTabId, tabs, hiddenDocks, cwd, commandRetry, onCommandHandled]);

  const addNewTerminal = (dockPosition: TerminalDockPosition = "bottom") => {
    const idx = tabs.length + 1;
    const id = crypto.randomUUID();
    const shellMeta =
      shellOptions.find((s) => s.id === selectedShell) || { label: "终端" };
    const next: SessionTab = {
      id,
      title: `${shellMeta.label} ${idx}`,
      cwd: cwd || ".",
      shell: selectedShell,
      dockPosition,
    };
    setTabs((prev) => [...prev, next]);
    revealDock(dockPosition);
    setActiveTabId(id);
    return id;
  };

  const scheduleDefaultTerminal = () => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) addNewTerminal(); });
    return () => { cancelled = true; };
  };

  useEffect(() => {
    if (!open || !panelRequest || handledPanelRequest.current === panelRequest) return;
    let cancelled = false;
    const showPanel = (position: TerminalDockPosition) => {
      if (cancelled) return;
      handledPanelRequest.current = panelRequest;
      onPanelRequestHandled?.(panelRequest);
      const group = groups.find(group => group.position === position);
      if (panelRequest.action === "toggle-bottom" && group && !hiddenDocks.includes(position)) {
        hideDock(position);
        return;
      }
      const target = panelRequest.action === "toggle-bottom" || !group?.selected.action
        ? group?.selected
        : group.dockTabs.find(tab => !tab.action);
      if (target) {
        revealDock(position);
        setActiveTabId(target.id);
        setPanelFocusId(target.id);
      } else {
        setPanelFocusId(addNewTerminal(position));
      }
    };
    if (panelRequest.action === "toggle-bottom") showPanel("bottom");
    else void readTerminalLocation().then(showPanel);
    return () => { cancelled = true; };
  }, [open, panelRequest, tabs, selection, hiddenDocks]);

  useEffect(() => {
    if (open && !tabs.length && !panelRequest && !pendingAction && !pendingCommand) return scheduleDefaultTerminal();
  }, [open, tabs.length, panelRequest, pendingAction, pendingCommand]);

  useEffect(() => {
    if (!open || panelFocusId == null) return;
    const entry = xtermMapRef.current.get(panelFocusId);
    if (entry && visibleGroups.some(group => group.selected.id === panelFocusId)) entry.term.focus();
    setPanelFocusId(null);
  }, [open, panelFocusId]);

  const interruptActiveTerminal = (sessionId = activeTabId) => {
    invoke("terminal_write", {
      sessionId,
      data: "\x03",
    }).catch(() => {});
  };

  const moveActiveDock = (position: TerminalDockPosition, tabId = activeTabId) => {
    revealDock(position);
    setTabs(current => current.map(tab => tab.id === tabId ? { ...tab, dockPosition: position } : tab));
    if (tabId !== activeTabId) setActiveTabId(tabId);
  };

  const startTabDrag = (event: React.PointerEvent<HTMLButtonElement>, tabId: string) => {
    if (event.button !== 0 || !event.isPrimary) return;
    suppressTabClickRef.current = false;
    if (event.pointerType === "touch") return;
    const bounds = event.currentTarget.closest(".workspace-main-with-terminal")?.getBoundingClientRect();
    if (!bounds || !bounds.width || !bounds.height) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    tabDragRef.current = { id: event.pointerId, tabId, x: event.clientX, y: event.clientY, bounds, moving: false };
  };

  const trackTabDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = tabDragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    if (!drag.moving && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
    drag.moving = true;
    suppressTabClickRef.current = true;
    const position = terminalDropPosition(drag.bounds, event.clientX, event.clientY);
    setDropPreview(current => current?.position === position ? current : { position });
  };

  const cancelTabDrag = (pointerId?: number) => {
    const drag = tabDragRef.current;
    if (!drag || (pointerId !== undefined && drag.id !== pointerId)) return;
    tabDragRef.current = null;
    if (drag.moving) setDropPreview(null);
  };

  const finishTabDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = tabDragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    cancelTabDrag(event.pointerId);
    if (!drag.moving) return;
    const bounds = event.currentTarget.closest(".workspace-main-with-terminal")?.getBoundingClientRect();
    const position = bounds && terminalDropPosition(bounds, event.clientX, event.clientY);
    if (position) {
      moveActiveDock(position, drag.tabId);
      requestAnimationFrame(() => document.getElementById(`terminal-tab-${drag.tabId}`)?.focus());
    }
  };

  const handleStartResize = (event: React.PointerEvent<HTMLDivElement>, position: TerminalDockPosition) => {
    const dock = event.currentTarget.parentElement;
    const workspace = dock?.parentElement;
    if (!dock || !workspace || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const sideDock = position !== "bottom";
    const width = workspace.clientWidth;
    const sideLimit = bothSides
      ? Math.min(width * 0.36, Math.max(120, (width - 420) / 2))
      : Math.min(width * 0.5, Math.max(140, width - 420));
    dockResizeRef.current = {
      id: event.pointerId,
      position,
      start: sideDock ? event.clientX : event.clientY,
      size: sideDock ? dock.offsetWidth : dock.offsetHeight,
      limit: sideDock ? sideLimit : workspace.clientHeight * 0.8,
    };
  };

  const handleDockResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const resize = dockResizeRef.current;
    if (!resize || resize.id !== event.pointerId) return;
    const sideDock = resize.position !== "bottom";
    const cursor = sideDock ? event.clientX : event.clientY;
    const delta = resize.position === "left" ? cursor - resize.start : resize.start - cursor;
    const size = Math.min(resize.limit, Math.max(sideDock ? 180 : 140, resize.size + delta));
    if (sideDock) setDockWidths(current => ({ ...current, [resize.position]: size }));
    else setDockHeight(size);
  };

  const clearActiveTerminal = (sessionId = activeTabId) => {
    const entry = xtermMapRef.current.get(sessionId);
    if (entry) {
      entry.cancelAction?.();
      entry.term.clear();
    }
  };

  const closeTerminalTab = (id: string) => {
    if (tabDragRef.current?.tabId === id) cancelTabDrag();
    invoke("terminal_close", { sessionId: id }).catch(() => {});
    const entry = xtermMapRef.current.get(id);
    if (entry) {
      entry.releaseInput?.();
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
      setHiddenDocks([]);
      setTabs([]);
      setSelection([]);
    } else {
      setTabs(remaining);
      if (activeTabId === id) {
        const next = remaining.filter(tab => !hiddenDocks.includes(tab.dockPosition ?? "bottom")).at(-1) ?? remaining[remaining.length - 1];
        revealDock(next.dockPosition ?? "bottom");
        setActiveTabId(next.id);
      }
    }
  };

  const renderDockGroup = ({ position: dockPosition, dockTabs, selected }: ReturnType<typeof terminalDockGroups>[number]) => {
    const sideDock = dockPosition !== "bottom";
    const dockOpen = open && !hiddenDocks.includes(dockPosition);
    const actionsVisible = dockOpen && actionsOpen === dockPosition;
    return <div key={dockPosition} className="terminal-dock terminal-dock-workspace" data-position={dockPosition} data-open={dockOpen}
        style={{ width: sideDock ? `min(var(--terminal-side-max), ${dockWidths[dockPosition]}px)` : undefined,
          height: sideDock ? undefined : `min(80cqh, ${dockHeight}px)`, display: dockOpen ? undefined : "none" }}>
      <div className="terminal-dock-resizer" onPointerDown={event => handleStartResize(event, dockPosition)} onPointerMove={handleDockResize}
        onLostPointerCapture={() => { dockResizeRef.current = null; }} title={sideDock ? "拖动调整终端宽度" : "拖动调整终端高度"} />
      <div className="terminal-dock-header">
        <div className="terminal-tabs" role="tablist" aria-label={terminalDockLabels[dockPosition]}>
          {dockTabs.map((t) => (
            <div
              key={t.id}
              className={`terminal-tab ${t.id === selected.id ? "active" : ""}`}
            >
              <button className="terminal-tab-select" role="tab" type="button"
                id={`terminal-tab-${t.id}`} aria-selected={t.id === selected.id}
                aria-controls={`terminal-panel-${dockPosition}`} tabIndex={t.id === selected.id ? 0 : -1}
                onPointerDown={event => startTabDrag(event, t.id)}
                onPointerMove={trackTabDrag}
                onPointerUp={finishTabDrag}
                onPointerCancel={event => cancelTabDrag(event.pointerId)}
                onLostPointerCapture={event => cancelTabDrag(event.pointerId)}
                onClick={event => {
                  if (event.detail === 0 || !suppressTabClickRef.current) setActiveTabId(t.id);
                }}
                onKeyDown={event => {
                  if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                  if (event.key === "Escape" && tabDragRef.current?.moving) {
                    event.preventDefault();
                    event.stopPropagation();
                    cancelTabDrag();
                    return;
                  }
                  const index = dockTabs.findIndex(tab => tab.id === t.id);
                  const nextIndex = event.key === "ArrowRight" ? (index + 1) % dockTabs.length
                    : event.key === "ArrowLeft" ? (index + dockTabs.length - 1) % dockTabs.length
                    : event.key === "Home" ? 0 : event.key === "End" ? dockTabs.length - 1 : -1;
                  if (nextIndex >= 0) {
                    event.preventDefault();
                    const id = dockTabs[nextIndex].id;
                    setActiveTabId(id);
                    document.getElementById(`terminal-tab-${id}`)?.focus();
                  } else if (event.key === "Delete") {
                    event.preventDefault();
                    closeTerminalTab(t.id);
                  }
                }}>
                <TerminalIcon size={12} />
                <span>{t.title}</span>
              </button>
              <button
                className="terminal-tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTerminalTab(t.id);
                }}
                title="关闭终端会话" aria-label={`关闭 ${t.title}`}
              >
                <XIcon size={11} />
              </button>
            </div>
          ))}
          <button className="icon-btn" onClick={() => addNewTerminal(dockPosition)} title="新建终端标签页" aria-label="新建终端标签页">
            <PlusIcon size={13} />
          </button>
        </div>
        <div className="terminal-dock-actions">
          <button className="icon-btn" ref={node => {
            if (node) actionsTriggersRef.current.set(dockPosition, node);
            else actionsTriggersRef.current.delete(dockPosition);
          }} aria-expanded={actionsVisible}
            aria-controls={`terminal-session-actions-${dockPosition}`} aria-label="终端操作" title="终端操作"
            onClick={() => setActionsOpen(value => value === dockPosition ? false : dockPosition)}>···</button>
          <button className="icon-btn" onClick={() => hideDock(dockPosition)} title={`隐藏${terminalDockLabels[dockPosition]}`}
            aria-label={`隐藏${terminalDockLabels[dockPosition]}`}>
            <XIcon size={14} />
          </button>
        </div>
      </div>
      {actionsVisible && <div className="terminal-session-actions" id={`terminal-session-actions-${dockPosition}`} role="group" aria-label="终端操作"
        onKeyDown={event => {
          if (event.key === "Escape" && !event.nativeEvent.isComposing && event.keyCode !== 229) {
            event.preventDefault(); event.stopPropagation();
            setActionsOpen(false); actionsTriggersRef.current.get(dockPosition)?.focus();
          }
        }}>
          {hiddenGroups.map(group => (
            <button type="button" className="secondary-btn compact" key={group.position} onClick={() => {
              revealDock(group.position);
              setActionsOpen(false);
              setActiveTabId(group.selected.id);
              requestAnimationFrame(() => document.getElementById(`terminal-tab-${group.selected.id}`)?.focus());
            }}>显示{terminalDockLabels[group.position]}</button>
          ))}
          <select className="terminal-shell-select" id={`terminal-placement-${dockPosition}`} value={dockPosition} aria-label="终端停靠位置"
            onChange={event => {
              const position = event.target.value as TerminalDockPosition;
              moveActiveDock(position, selected.id);
              setActionsOpen(position);
              requestAnimationFrame(() => document.getElementById(`terminal-placement-${position}`)?.focus());
            }}>
            <option value="left">停靠左侧</option>
            <option value="right">停靠右侧</option>
            <option value="bottom">停靠底部</option>
          </select>
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
          <span className="terminal-cwd-badge" title={selected.cwd}>
            {selected.cwd}
          </span>
          <button
            className="icon-btn"
            onClick={() => setFontSize((f) => Math.max(8, f - 1))}
            disabled={fontSize <= 8}
            title="缩小终端字号"
          >
            A-
          </button>
          <button
            className="icon-btn"
            onClick={() => setFontSize((f) => Math.min(24, f + 1))}
            disabled={fontSize >= 24}
            title="放大终端字号"
          >
            A+
          </button>
          <button
            className="icon-btn"
            onClick={() => interruptActiveTerminal(selected.id)}
            title="中断当前运行 (Ctrl+C)"
            style={{ fontWeight: 600, fontSize: "calc(11px * var(--font-ui-scale, 1))" }}
          >
            ^C
          </button>
          <button
            className="icon-btn"
            onClick={() => clearActiveTerminal(selected.id)}
            title="清空当前终端屏幕"
          >
            <TrashIcon size={13} />
          </button>
      </div>}
      {commandError && selected.id === activeTabId && (
        <div role="status">
          {commandError}
          {pendingCommand && <button onClick={() => {
            lastExecutedCmdId.current = null;
            setCommandRetry((value) => value + 1);
          }}>重试命令</button>}
        </div>
      )}
      <div className="terminal-xterm-wrapper" ref={node => {
        if (node) dockContainersRef.current.set(dockPosition, node);
        else dockContainersRef.current.delete(dockPosition);
      }} id={`terminal-panel-${dockPosition}`} onFocus={() => setActiveTabId(selected.id)}
        data-codex-terminal role="tabpanel" aria-labelledby={`terminal-tab-${selected.id}`} />
    </div>;
  };

  return (
    <>
      {groups.map(renderDockGroup)}
      {open && dropPreview && <div className="terminal-drop-preview" aria-hidden="true" data-target={dropPreview.position ?? ""}>
        <span data-position="left">停靠左侧</span>
        <span data-position="right">停靠右侧</span>
        <span data-position="bottom">停靠底部</span>
      </div>}
    </>
  );
};
