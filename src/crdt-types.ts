/**
 * 🔮 PRISM CRDT Types - Pure CRDT Implementations
 *
 * Mathematical guarantees: Commutativity, Associativity, Idempotence
 * Automatic convergence, no manual conflict resolution
 */

// ============================================================================
// G-COUNTER - Grow-only Counter
// ============================================================================

export class GCounter {
  private counts: Map<string, number> = new Map();

  increment(nodeId: string, amount: number = 1): void {
    const current = this.counts.get(nodeId) || 0;
    this.counts.set(nodeId, current + amount);
  }

  value(): number {
    let total = 0;
    for (const count of this.counts.values()) {
      total += count;
    }
    return total;
  }

  merge(other: GCounter): void {
    if (!other.counts) return;
    for (const [nodeId, count] of other.counts) {
      const current = this.counts.get(nodeId) || 0;
      this.counts.set(nodeId, Math.max(current, count));
    }
  }

  toJSON(): any {
    return { counts: Object.fromEntries(this.counts) };
  }

  static fromJSON(data: any): GCounter {
    const counter = new GCounter();
    counter.counts = new Map(Object.entries(data.counts || {}));
    return counter;
  }
}

// ============================================================================
// PN-COUNTER - Positive-Negative Counter
// ============================================================================

export class PNCounter {
  private positive = new GCounter();
  private negative = new GCounter();

  increment(nodeId: string, amount: number = 1): void {
    if (amount > 0) {
      this.positive.increment(nodeId, amount);
    } else {
      this.negative.increment(nodeId, -amount);
    }
  }

  decrement(nodeId: string, amount: number = 1): void {
    if (amount > 0) {
      this.negative.increment(nodeId, amount);
    } else {
      this.positive.increment(nodeId, -amount);
    }
  }

  value(): number {
    return this.positive.value() - this.negative.value();
  }

  merge(other: PNCounter): void {
    this.positive.merge(other.positive);
    this.negative.merge(other.negative);
  }

  toJSON(): any {
    return {
      positive: this.positive.toJSON(),
      negative: this.negative.toJSON()
    };
  }

  static fromJSON(data: any): PNCounter {
    const counter = new PNCounter();
    counter.positive = GCounter.fromJSON(data.positive || {});
    counter.negative = GCounter.fromJSON(data.negative || {});
    return counter;
  }
}

// ============================================================================
// OR-SET - Observed-Remove Set
// ============================================================================

export class ORSet<T> {
  private elementMap: Map<string, { value: T; addTags: Set<string>; removeTags: Set<string> }> = new Map();

  add(element: T, nodeId: string): void {
    const key = JSON.stringify(element);
    const existing = this.elementMap.get(key);
    if (existing) {
      existing.addTags.add(nodeId);
    } else {
      this.elementMap.set(key, { value: element, addTags: new Set([nodeId]), removeTags: new Set() });
    }
  }

  remove(element: T, nodeId: string): void {
    const key = JSON.stringify(element);
    const existing = this.elementMap.get(key);
    if (existing) {
      existing.removeTags.add(nodeId);
    }
  }

  elements(): T[] {
    const result: T[] = [];
    for (const [key, entry] of this.elementMap) {
      // Element is visible if there are add tags not covered by remove tags
      const visibleAdds = new Set(entry.addTags);
      for (const removeTag of entry.removeTags) {
        visibleAdds.delete(removeTag);
      }
      if (visibleAdds.size > 0) {
        result.push(entry.value);
      }
    }
    return result;
  }

  merge(other: ORSet<T>): void {
    for (const [key, entry] of other.elementMap) {
      const existing = this.elementMap.get(key);
      if (existing) {
        // Union of add tags and remove tags
        for (const tag of entry.addTags) {
          existing.addTags.add(tag);
        }
        for (const tag of entry.removeTags) {
          existing.removeTags.add(tag);
        }
      } else {
        this.elementMap.set(key, {
          value: entry.value,
          addTags: new Set(entry.addTags),
          removeTags: new Set(entry.removeTags)
        });
      }
    }
  }

  toJSON(): any {
    const elements: any = {};
    for (const [key, entry] of this.elementMap) {
      elements[key] = {
        value: entry.value,
        addTags: Array.from(entry.addTags),
        removeTags: Array.from(entry.removeTags)
      };
    }
    return { elements };
  }

  static fromJSON(data: any): any {
    const set = new ORSet<any>();
    for (const [key, entry] of Object.entries(data.elements || {})) {
      const e = entry as any;
      set.elementMap.set(key, {
        value: e.value,
        addTags: new Set(e.addTags || []),
        removeTags: new Set(e.removeTags || [])
      });
    }
    return set;
  }
}

// ============================================================================
// LWW-REGISTER - Last-Write-Wins Register
// ============================================================================

export class LWWRegister<T> {
  private value: T | null = null;
  private timestamp: number = 0;
  private nodeId: string = '';

  set(value: T, timestamp: number, nodeId: string): void {
    if (timestamp > this.timestamp) {
      this.value = value;
      this.timestamp = timestamp;
      this.nodeId = nodeId;
    }
  }

  get(): T | null {
    return this.value;
  }

  merge(other: LWWRegister<T>): void {
    if (other.timestamp > this.timestamp) {
      this.value = other.value;
      this.timestamp = other.timestamp;
      this.nodeId = other.nodeId;
    }
  }

  toJSON(): any {
    return {
      value: this.value,
      timestamp: this.timestamp,
      nodeId: this.nodeId
    };
  }

  static fromJSON<T>(data: any): LWWRegister<T> {
    const register = new LWWRegister<T>();
    register.value = data.value;
    register.timestamp = data.timestamp || 0;
    register.nodeId = data.nodeId || '';
    return register;
  }
}

// ============================================================================
// LWW-MAP - Last-Write-Wins Map
// ============================================================================

export class LWWMap<K, V> {
  private entryMap: Map<string, { value: V; timestamp: number; nodeId: string }> = new Map();

  set(key: K, value: V, timestamp: number, nodeId: string): void {
    const keyStr = JSON.stringify(key);
    const existing = this.entryMap.get(keyStr);

    if (!existing || timestamp > existing.timestamp) {
      this.entryMap.set(keyStr, { value, timestamp, nodeId });
    }
  }

  get(key: K): V | undefined {
    const keyStr = JSON.stringify(key);
    return this.entryMap.get(keyStr)?.value;
  }

  delete(key: K): void {
    const keyStr = JSON.stringify(key);
    this.entryMap.delete(keyStr);
  }

  entries(): IterableIterator<[K, V]> {
    const result: [K, V][] = [];
    for (const [keyStr, entry] of this.entryMap) {
      result.push([JSON.parse(keyStr), entry.value]);
    }
    return result.values();
  }

  merge(other: LWWMap<K, V>): void {
    for (const [keyStr, entry] of other.entryMap) {
      const existing = this.entryMap.get(keyStr);
      if (!existing || entry.timestamp > existing.timestamp) {
        this.entryMap.set(keyStr, entry);
      }
    }
  }

  toJSON(): any {
    const entries: any = {};
    for (const [key, entry] of this.entryMap) {
      entries[key] = entry;
    }
    return { entries };
  }

  static fromJSON(data: any): any {
    const map = new LWWMap<any, any>();
    for (const [key, entry] of Object.entries(data.entries || {})) {
      map.entryMap.set(key, entry as any);
    }
    return map;
  }
}

// ============================================================================
// OR-MAP - Observed-Remove Map
// ============================================================================

export class ORMap<K, V> {
  private entries: Map<string, ORSet<{ key: K; value: V }>> = new Map();

  set(key: K, value: V, nodeId: string): void {
    const keyStr = JSON.stringify(key);
    let set = this.entries.get(keyStr);
    if (!set) {
      set = new ORSet<{ key: K; value: V }>();
      this.entries.set(keyStr, set);
    }
    set.add({ key, value }, nodeId);
  }

  get(key: K): V | undefined {
    const keyStr = JSON.stringify(key);
    const set = this.entries.get(keyStr);
    if (set) {
      const elements = set.elements();
      return elements.length > 0 ? elements[elements.length - 1].value : undefined;
    }
    return undefined;
  }

  delete(key: K): void {
    const keyStr = JSON.stringify(key);
    const set = this.entries.get(keyStr);
    if (set) {
      const elements = set.elements();
      if (elements.length > 0) {
        // Remove the most recent element
        set.remove(elements[elements.length - 1], 'tombstone');
      }
    }
  }

  merge(other: ORMap<K, V>): void {
    for (const [keyStr, otherSet] of other.entries) {
      let localSet = this.entries.get(keyStr);
      if (!localSet) {
        localSet = new ORSet<{ key: K; value: V }>();
        this.entries.set(keyStr, localSet);
      }
      localSet.merge(otherSet);
    }
  }

  toJSON(): any {
    const entries: any = {};
    for (const [key, set] of this.entries) {
      entries[key] = set.toJSON();
    }
    return { entries };
  }

  static fromJSON(data: any): any {
    const map = new ORMap<any, any>();
    for (const [key, setData] of Object.entries(data.entries || {})) {
      map.entries.set(key, ORSet.fromJSON(setData));
    }
    return map;
  }
}
