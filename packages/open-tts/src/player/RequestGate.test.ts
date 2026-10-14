import { describe, expect, it } from "vitest";
import { RequestGate } from "./ChunkLoader";
import { qwenTextToSpeech } from "../models/qwen";
import { kokoroTextToSpeech } from "../models/kokoro";

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("RequestGate", () => {
  it("runs one request at a time and picks the lowest priority next", async () => {
    const gate = new RequestGate();
    const started: number[] = [];
    const releases: Record<number, () => void> = {};
    const run = (priority: number) =>
      gate.acquire(1, priority).then((release) => {
        started.push(priority);
        releases[priority] = release;
      });

    void run(5);
    await flush();
    void run(9);
    void run(6);
    void run(7);
    await flush();
    expect(started).toEqual([5]);

    releases[5]();
    await flush();
    expect(started).toEqual([5, 6]);

    releases[6]();
    await flush();
    releases[7]();
    await flush();
    expect(started).toEqual([5, 6, 7, 9]);
  });

  it("does not limit when the limit is unset", async () => {
    const gate = new RequestGate();
    await Promise.all([1, 2, 3].map((p) => gate.acquire(Infinity, p)));
  });

  it("ignores a second release of the same slot", async () => {
    const gate = new RequestGate();
    const release = await gate.acquire(1, 0);
    release();
    release();
    const a = await gate.acquire(1, 0);
    let bStarted = false;
    void gate.acquire(1, 0).then(() => (bStarted = true));
    await flush();
    expect(bStarted).toBe(false);
    a();
    await flush();
    expect(bStarted).toBe(true);
  });
});

describe("provider concurrency limits", () => {
  it("serializes Qwen3-TTS but leaves Kokoro unlimited", () => {
    expect(qwenTextToSpeech.maxConcurrentRequests).toBe(1);
    expect(kokoroTextToSpeech.maxConcurrentRequests).toBeUndefined();
  });
});
