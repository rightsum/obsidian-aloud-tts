import * as mobx from "mobx";
import { AudioSystem } from "./AudioSystem";
import {
  AudioTextContext,
  TTSErrorInfo,
  TTSModelOptions,
} from "../models/tts-model";
import { AudioData } from "../models/tts-model";
import { convertToPlayableFormat } from "../util/audioProcessing";

/** manages loading and caching of tracks */
export class ChunkLoader {
  private MAX_BACKGROUND_REQUESTS = 3;
  private MAX_LOCAL_TTL_MILLIS = 60 * 1000;

  private system: AudioSystem;
  private backgroundQueue: BackgroundRequest[] = [];
  private backgroundActiveCount = 0;
  private localCache: CachedAudio[] = [];
  private backgroundRequestProcessor: IntervalDaemon;
  private garbageCollector: IntervalDaemon;
  private requestGate = new RequestGate();

  constructor({ system }: { system: AudioSystem }) {
    this.system = system;

    this.backgroundRequestProcessor = IntervalDaemon(
      this.processBackgroundQueue.bind(this),
      { interval: system.config.backgroundLoaderIntervalMillis },
    );
    this.garbageCollector = IntervalDaemon(this.processGarbage.bind(this), {
      interval: this.MAX_LOCAL_TTL_MILLIS / 2,
    }).startIfNot();
  }

  expireBefore = (
    position: number = this.system.audioStore?.activeText?.position ?? 0,
  ): void => {
    this.backgroundQueue = this.backgroundQueue.filter(
      (x) => !(x.position < position),
    );
  };

  /**
   * Removes locally cached audio (e.g., if ArrayBuffer becomes detached).
   * Does not affect storage cache.
   */
  uncache(text: string): void {
    this.localCache = this.localCache.filter((x) => x.text !== text);
  }

  preload(
    text: string,
    options: TTSModelOptions,
    position: number,
    context: AudioTextContext = {},
  ): void {
    // Check if already queued
    const found = this.backgroundQueue.find(
      (x) => x.text === text && mobx.comparer.structural(x.options, options),
    );
    if (found) {
      return;
    }

    // Check if already in local memory cache (loading or loaded)
    const loaded = this.localCache.find(
      (x) => x.text === text && mobx.comparer.structural(x.options, options),
    );
    if (loaded) {
      return;
    }
    this.backgroundQueue.push({
      text,
      options,
      requestedTime: Date.now(),
      context,
      position,
    });
    this.backgroundRequestProcessor.startIfNot();
  }

  /**
   * @param priority lower runs first when the model limits concurrent requests,
   * e.g. the chunk's position in the text
   */
  async load(
    text: string,
    options: TTSModelOptions,
    context: AudioTextContext = {},
    priority: number = 0,
  ): Promise<AudioData> {
    const existing = this.localCache.find(
      (x) => x.text === text && mobx.comparer.structural(x.options, options), // Use structural comparison
    );

    if (existing) {
      existing.requestedTime = Date.now();
      return existing.result;
    } else {
      const audio = this.createCachedAudio(text, options, context, priority);
      this.localCache.push(audio);
      return audio.result;
    }
  }

  destroy(): void {
    this.backgroundRequestProcessor.stop();
    this.garbageCollector.stop();
    // Clear caches and queue on destroy
    this.localCache = [];
    this.backgroundQueue = [];
    this.backgroundActiveCount = 0;
  }

  private createCachedAudio(
    text: string,
    options: TTSModelOptions,
    context: AudioTextContext = {},
    priority: number = 0,
  ): CachedAudio {
    const audio: CachedAudio = {
      text,
      options,
      requestedTime: Date.now(),
      result: this.tryLoadTrack(text, options, 0, 3, context, priority).catch(
        (e) => {
          this.destroyCachedAudio(audio);
          throw e;
        },
      ),
    };
    return audio;
  }

  private destroyCachedAudio(audio: CachedAudio): void {
    const index = this.localCache.indexOf(audio);
    if (index !== -1) {
      this.localCache.splice(index, 1);
    }
  }

  // Processes the queue
  private processBackgroundQueue(): boolean {
    if (this.backgroundActiveCount >= this.MAX_BACKGROUND_REQUESTS) {
      return true;
    }
    if (this.backgroundQueue.length === 0) {
      return false;
    }

    const item = this.backgroundQueue.shift()!; // Take one item
    const itemOptions: TTSModelOptions = item.options;

    this.backgroundActiveCount += 1; // Increment active *requests* count by 1
    this.load(item.text, itemOptions, item.context, item.position).finally(
      () => {
        this.backgroundActiveCount -= 1;
        this.processBackgroundQueue(); // Check for more work
      },
    );

    return true; // Keep processor running if queue might still have items or requests are active
  }

  private processGarbage(): boolean {
    this.localCache = this.localCache.filter(
      (entry) => Date.now() - entry.requestedTime < this.MAX_LOCAL_TTL_MILLIS,
    );
    return true;
  }

  private async tryLoadTrack(
    track: string,
    options: TTSModelOptions,
    attempt: number = 0,
    maxAttempts: number = 3,
    context: AudioTextContext = {},
    priority: number = 0,
  ): Promise<AudioData> {
    try {
      return await this.loadTrack(track, options, context, priority);
    } catch (ex) {
      console.warn("error loading track", ex);
      const errorInfo = ex instanceof TTSErrorInfo ? ex : undefined;
      const canRetry =
        attempt < maxAttempts && (errorInfo ? errorInfo.isRetryable : true);
      if (!canRetry) {
        throw ex;
      } else {
        await new Promise((resolve) =>
          setTimeout(resolve, 250 * Math.pow(2, attempt)),
        );
        return await this.tryLoadTrack(
          track,
          options,
          attempt + 1,
          maxAttempts,
          context,
          priority,
        );
      }
    }
  }

  /** non-stateful function (barring layers of caching and API calls) */
  private async loadTrack(
    text: string,
    options: TTSModelOptions,
    context: AudioTextContext = {},
    priority: number = 0,
  ): Promise<AudioData> {
    // Check cache for mp3 (the playable format we store)
    const cached = await this.system.storage.getAudio(text, options, "mp3");
    if (cached) {
      return cached;
    }

    // Call provider and convert to playable format
    const release = await this.requestGate.acquire(
      this.system.ttsModel.maxConcurrentRequests ?? Infinity,
      priority,
    );
    let audio: AudioData;
    try {
      audio = await this.system.ttsModel.call(
        text,
        options,
        this.system.settings,
        context,
      );
    } finally {
      release();
    }
    const playable = await convertToPlayableFormat(audio);

    // Cache the mp3
    await this.system.storage.saveAudio(text, options, playable);

    return playable;
  }
}

// --- Helper Interfaces and Functions ---

/** Limits concurrent requests; when full, waiters with the lowest priority value go first */
export class RequestGate {
  private active = 0;
  private waiting: { priority: number; resolve: () => void }[] = [];

  async acquire(limit: number, priority: number): Promise<() => void> {
    if (this.active < limit) {
      this.active += 1;
    } else {
      // the releasing request hands its slot over, so `active` is unchanged
      await new Promise<void>((resolve) =>
        this.waiting.push({ priority, resolve }),
      );
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.release();
    };
  }

  private release(): void {
    if (this.waiting.length === 0) {
      this.active -= 1;
      return;
    }
    let next = 0;
    for (let i = 1; i < this.waiting.length; i++) {
      if (this.waiting[i].priority < this.waiting[next].priority) next = i;
    }
    this.waiting.splice(next, 1)[0].resolve();
  }
}
interface IntervalDaemon {
  stop: () => IntervalDaemon;
  startIfNot: () => IntervalDaemon;
}

type ShouldContinue = boolean;

/** runs the work function every interval, until the work function returns false. Can be stopped and started. */
export function IntervalDaemon(
  doWork: () => ShouldContinue,
  opts: {
    interval: number;
  },
): IntervalDaemon {
  let timer: undefined | ReturnType<typeof setInterval>;
  const processor: IntervalDaemon = {
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
      return processor;
    },
    startIfNot: () => {
      if (timer !== undefined) {
        return processor;
      }
      let shouldContinue = true;
      try {
        shouldContinue = doWork();
      } catch (ex) {
        // Decide whether to stop or continue based on error? For now, assume continue.
        shouldContinue = true;
      }
      if (shouldContinue) {
        timer = setInterval(() => {
          let shouldContinueInterval = true;
          try {
            shouldContinueInterval = doWork();
          } catch (ex) {
            // Decide whether to stop or continue based on error? For now, assume continue.
            shouldContinueInterval = true;
          }
          if (!shouldContinueInterval) {
            processor.stop();
          }
        }, opts.interval);
      }
      return processor;
    },
  };
  return processor;
}

interface BackgroundRequest {
  /** the text that was requested */
  text: string;
  /** the options used to generate this audio */
  options: TTSModelOptions;
  /** the time the request was made. Milliseconds since Unix Epoch */
  requestedTime: number;
  /** the context that was requested */
  context: AudioTextContext;
  /** the position that was requested */
  position: number;
}

interface CachedAudio {
  /** the text that was requested */
  readonly text: string;
  /** the index for the text */
  readonly index?: number;
  /** the options used to generate this audio */
  readonly options: TTSModelOptions;
  /** the final result of the request across retries */
  readonly result: Promise<AudioData>;
  /** the time the request was made. Milliseconds since Unix Epoch. May be updated to prevent deletion */
  requestedTime: number;
}
