import { observer } from "mobx-react-lite";
import React from "react";
import {
  QWEN_LANGUAGES,
  TTSPluginSettingsStore,
  listQwenVoices,
} from "open-tts";
import {
  OptionSelectSetting,
  TextInputSetting,
  TextareaSetting,
} from "../setting-components";

export const QwenSettings = observer(
  ({ store }: { store: TTSPluginSettingsStore }) => {
    return (
      <>
        <TextInputSetting
          name="Server URL"
          description="The address of your Qwen3-TTS server, e.g. http://localhost:8091."
          store={store}
          provider="qwen"
          fieldName="qwen_apiBase"
          placeholder="http://localhost:8091"
          validation={{
            validate: (value: string) => /^https?:\/\/.+/.test(value),
            errorMessage: "Enter a URL starting with http:// or https://.",
          }}
        />
        <QwenVoiceComponent store={store} />
        <OptionSelectSetting
          name="Language"
          description="The language of the text being read."
          store={store}
          provider="qwen"
          fieldName="qwen_language"
          options={QWEN_LANGUAGES.map((value) => ({ label: value, value }))}
        />
        <TextareaSetting
          name="Instructions"
          description="Optional speaking style for built-in voices, e.g. calm and warm, like an audiobook narrator. Ignored by cloned voices."
          store={store}
          provider="qwen"
          fieldName="qwen_instructions"
        />
      </>
    );
  },
);

const QwenVoiceComponent: React.FC<{
  store: TTSPluginSettingsStore;
}> = observer(({ store }) => {
  const [voices, setVoices] = React.useState<{
    builtin: string[];
    custom: string[];
  }>({ builtin: [], custom: [] });
  const [error, setError] = React.useState<string | null>(null);
  const apiBase = store.settings.qwen_apiBase;

  React.useEffect(() => {
    let cancelled = false;
    setError(null);
    listQwenVoices(apiBase)
      .then((fetched) => {
        if (!cancelled) setVoices(fetched);
      })
      .catch((err) => {
        console.error("Failed to fetch Qwen3-TTS voices:", err);
        if (!cancelled) {
          setVoices({ builtin: [], custom: [] });
          setError("Failed to load voices. Please check the server URL.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  if (error) {
    return <p style={{ color: "var(--text-error)" }}>{error}</p>;
  }

  const options = [
    ...voices.builtin.map((v) => ({ label: v, value: v })),
    ...voices.custom.map((v) => ({ label: `${v} (cloned)`, value: v })),
  ];
  const current = store.settings.qwen_voice;
  if (current && !options.some((o) => o.value === current)) {
    options.unshift({ label: current, value: current });
  }

  return (
    <OptionSelectSetting
      name="Voice"
      description="A built-in voice, or one of the cloned voices from the server's voices folder."
      store={store}
      provider="qwen"
      fieldName="qwen_voice"
      options={options}
    />
  );
});
