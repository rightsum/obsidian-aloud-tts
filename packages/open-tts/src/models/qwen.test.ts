import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../player/TTSPluginSettings";
import { setCorsFreeFetch } from "../util/http";
import {
  qwenCallTextToSpeech,
  qwenTextToSpeech,
  qwenWordTimings,
} from "./qwen";

global.fetch = vi.fn();

describe("Qwen3-TTS", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  afterEach(() => {
    setCorsFreeFetch(undefined);
  });

  it("includes language and instructions in the options used for caching", () => {
    const options = qwenTextToSpeech.convertToOptions({
      ...DEFAULT_SETTINGS,
      qwen_apiBase: "http://studio:8091/",
      qwen_voice: "hossein",
      qwen_language: "German",
      qwen_instructions: "calm",
    });
    expect(options).toEqual({
      apiUri: "http://studio:8091",
      voice: "hossein",
      model: "qwen3-tts|German",
      instructions: "calm",
    });
  });

  it("requests wav with word timestamps through the CORS-free fetch", async () => {
    const corsFree = vi.fn().mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({
        audio: btoa(String.fromCharCode(9, 8, 7)),
        words: [
          { word: "Hello,", start: 0, end: 0.4 },
          { word: "world.", start: 0.5, end: 0.9 },
        ],
      }),
    });
    setCorsFreeFetch(corsFree);

    const result = await qwenCallTextToSpeech(
      "Hello, world.",
      { apiUri: "http://studio:8091", voice: "Vivian", model: "qwen3-tts" },
      DEFAULT_SETTINGS,
    );

    expect(fetch).not.toHaveBeenCalled();
    expect(corsFree).toHaveBeenCalledWith(
      "http://studio:8091/v1/audio/speech",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          input: "Hello, world.",
          voice: "Vivian",
          language: "English",
          response_format: "wav",
          word_timestamps: true,
        }),
      }),
    );
    expect(result.format).toBe("wav");
    expect(new Uint8Array(result.data)).toEqual(new Uint8Array([9, 8, 7]));
    expect(result.wordTimings).toEqual([
      { word: "Hello", start: 0, end: 0.4 },
      { word: "world", start: 0.5, end: 0.9 },
    ]);
  });

  it("splits whisper words that contain several tokens", () => {
    expect(
      qwenWordTimings([{ word: "well-known.", start: 1, end: 2 }]),
    ).toEqual([{ word: "well-known", start: 1, end: 2 }]);
  });

  it("reports an unreachable server", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
    const error = await qwenTextToSpeech.validateConnection({
      ...DEFAULT_SETTINGS,
      qwen_apiBase: "http://nowhere:8091",
    });
    expect(error).toContain("http://nowhere:8091");
  });
});
