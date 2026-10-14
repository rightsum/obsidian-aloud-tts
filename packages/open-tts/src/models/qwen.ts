import type { TTSPluginSettings } from "../player/TTSPluginSettings";
import { fetchWithoutCors } from "../util/http";
import { base64ToArrayBuffer } from "../util/misc";
import { tokenizeWords } from "../util/wordTiming";
import {
  AudioData,
  TTSErrorInfo,
  WordTiming,
  validate200,
  type TTSModel,
  type TTSModelOptions,
} from "./tts-model";

export const DEFAULT_QWEN_API_URL = "http://localhost:8091";

export const QWEN_LANGUAGES = [
  "English",
  "Chinese",
  "Japanese",
  "Korean",
  "German",
  "French",
  "Russian",
  "Portuguese",
  "Spanish",
  "Italian",
] as const;

/** Self-hosted Qwen3-TTS server with an OpenAI-style /v1/audio/speech endpoint */
export const qwenTextToSpeech: TTSModel = {
  call: qwenCallTextToSpeech,
  validateConnection: async (settings) => {
    try {
      await listQwenVoices(settings.qwen_apiBase);
      return undefined;
    } catch (error) {
      const detail =
        error instanceof TTSErrorInfo
          ? error.ttsJsonMessage() || error.message
          : String(error);
      return `Cannot connect to Qwen3-TTS at ${qwenBaseUrl(settings.qwen_apiBase)}: ${detail}`;
    }
  },
  convertToOptions: (settings): TTSModelOptions => {
    return {
      apiUri: qwenBaseUrl(settings.qwen_apiBase),
      voice: settings.qwen_voice,
      model: `qwen3-tts|${settings.qwen_language}`,
      instructions: settings.qwen_instructions || undefined,
    };
  },
};

export function qwenBaseUrl(apiBase: string | undefined): string {
  return (apiBase || DEFAULT_QWEN_API_URL).replace(/\/+$/, "");
}

interface QwenWord {
  word: string;
  start: number;
  end: number;
}

export async function qwenCallTextToSpeech(
  text: string,
  options: TTSModelOptions,
  settings: TTSPluginSettings,
): Promise<AudioData> {
  const response = await fetchWithoutCors(`${options.apiUri}/v1/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: text,
      voice: options.voice,
      language: settings.qwen_language,
      ...(options.instructions ? { instructions: options.instructions } : {}),
      response_format: "wav",
      word_timestamps: true,
    }),
  });
  await validate200(response, qwenErrorMessage);
  const body: { audio: string; words?: QwenWord[] } = await response.json();
  return {
    data: base64ToArrayBuffer(body.audio),
    format: "wav",
    wordTimings: body.words ? qwenWordTimings(body.words) : undefined,
  };
}

/** Whisper words can carry punctuation (e.g. "later."), so re-tokenize them */
export function qwenWordTimings(words: QwenWord[]): WordTiming[] {
  return words.flatMap((w) =>
    tokenizeWords(w.word).map((token) => ({
      word: token.word,
      start: w.start,
      end: w.end,
    })),
  );
}

export async function listQwenVoices(
  apiBase: string | undefined,
): Promise<{ builtin: string[]; custom: string[] }> {
  const response = await fetchWithoutCors(
    `${qwenBaseUrl(apiBase)}/v1/audio/voices`,
  );
  await validate200(response, qwenErrorMessage);
  const body: { builtin?: string[]; custom?: string[] } = await response.json();
  return { builtin: body.builtin ?? [], custom: body.custom ?? [] };
}

function qwenErrorMessage(body: unknown) {
  const detail = (body as { detail?: unknown })?.detail;
  if (!detail) {
    return undefined;
  }
  return {
    error: {
      message: typeof detail === "string" ? detail : JSON.stringify(detail),
      type: "qwen_error",
      code: "",
      param: null,
    },
  };
}
