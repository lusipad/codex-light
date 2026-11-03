export interface TerminalOutputData {
  sessionId: string;
  generation: string;
  startOffset: number;
  endOffset: number;
  data: string;
}

export interface TerminalOutputExit {
  sessionId: string;
  generation: string;
  endOffset: number;
}

export interface TerminalSnapshot {
  sessionId: string;
  cwd: string;
  shell: string;
  replayLog: string;
  generation: string;
  startOffset: number;
  endOffset: number;
  exited: boolean;
}

// Offsets are UTF-8 bytes of decoded output, shared with the Rust replay buffer.
export function createTerminalOutput(
  sessionId: string,
  callbacks: { write: (data: string, replay: boolean) => void; onExit: () => void },
) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let pending: TerminalOutputData[] = [];
  let exits: TerminalOutputExit[] = [];
  let generation: string | undefined;
  let offset = 0;
  let disposed = false;
  let finished = false;

  const validOffset = (value: number) => Number.isSafeInteger(value) && value >= 0;
  function flush() {
    if (disposed || finished || generation === undefined) return;
    pending = pending.filter(event => event.generation === generation && event.endOffset > offset);
    pending.sort((a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset);
    while (pending.length && pending[0].startOffset <= offset) {
      const event = pending.shift()!;
      if (event.endOffset <= offset) continue;
      // Producer snapshots and events end on valid UTF-8 boundaries.
      const bytes = encoder.encode(event.data).subarray(offset - event.startOffset);
      const text = decoder.decode(bytes);
      offset = event.endOffset;
      callbacks.write(text, false);
      if (disposed) return;
    }
    if (exits.some(event => event.generation === generation && event.endOffset <= offset)) {
      finished = true;
      pending = [];
      exits = [];
      callbacks.onExit();
    }
  }

  return {
    data(event: TerminalOutputData) {
      if (disposed || finished || event.sessionId !== sessionId) return;
      if (generation !== undefined && event.generation !== generation) return;
      if (!validOffset(event.startOffset) || !validOffset(event.endOffset)
        || event.endOffset - event.startOffset !== encoder.encode(event.data).length) return;
      pending.push(event);
      flush();
    },
    exit(event: TerminalOutputExit) {
      if (disposed || finished || event.sessionId !== sessionId || !validOffset(event.endOffset)) return;
      if (generation !== undefined && event.generation !== generation) return;
      exits.push(event);
      flush();
    },
    attach(snapshot: TerminalSnapshot) {
      if (disposed || generation !== undefined || snapshot.sessionId !== sessionId) return;
      if (!validOffset(snapshot.startOffset) || !validOffset(snapshot.endOffset)
        || snapshot.endOffset - snapshot.startOffset !== encoder.encode(snapshot.replayLog).length) return;
      generation = snapshot.generation;
      offset = snapshot.endOffset;
      callbacks.write(snapshot.replayLog, true);
      if (snapshot.exited) exits.push({ sessionId, generation, endOffset: offset });
      flush();
    },
    dispose() {
      disposed = true;
      pending = [];
      exits = [];
    },
  };
}
