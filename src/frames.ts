import { mergeTallies, type HiddenTally } from './hidden';

/** Hidden-item counts reported by each frame of a tab, so the popup can add them up. */
export class FrameCounts {
  private tabs = new Map<number, Map<number, number>>();
  private kinds = new Map<number, Map<number, HiddenTally>>();

  set(tabId: number, frameId: number, count: number, groups?: HiddenTally): void {
    const frames = this.tabs.get(tabId) ?? new Map<number, number>();
    frames.set(frameId, count);
    this.tabs.set(tabId, frames);
    const g = this.kinds.get(tabId) ?? new Map<number, HiddenTally>();
    g.set(frameId, groups ?? {});
    this.kinds.set(tabId, g);
  }

  dropFrame(tabId: number, frameId: number): void {
    const frames = this.tabs.get(tabId);
    frames?.delete(frameId);
    if (frames && frames.size === 0) this.tabs.delete(tabId);
    const g = this.kinds.get(tabId);
    g?.delete(frameId);
    if (g && g.size === 0) this.kinds.delete(tabId);
  }

  dropTab(tabId: number): void {
    this.tabs.delete(tabId);
    this.kinds.delete(tabId);
  }

  total(tabId: number): number {
    let n = 0;
    for (const c of this.tabs.get(tabId)?.values() ?? []) n += c;
    return n;
  }

  /** What was hidden in a tab by group, frames added up. */
  groups(tabId: number): HiddenTally {
    return mergeTallies(this.kinds.get(tabId)?.values() ?? []);
  }
}
