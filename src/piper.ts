// Offline Turkish TTS running fully in the browser (WASM + ONNX, no server/API).
// Voice models (~63MB each) download on first use from Hugging Face and are
// cached by the browser afterwards.

export const PIPER_VOICE_OPTIONS = [
  { value: "tr_TR-dfki-medium", label: "Dfki" },
  { value: "tr_TR-fahrettin-medium", label: "Fahrettin" }
] as const;

export const PIPER_LANGUAGE_OPTIONS = [{ value: "tr-TR", label: "Turkish" }] as const;

export const DEFAULT_PIPER_VOICE = "tr_TR-dfki-medium";

// Each voice is fetched from its highest available version: dfki tracks the
// repo's latest version, while fettah/fahrettin were removed from latest and
// are pinned to the v1.0.0 tag (their highest available).
const PIPER_VOICE_BASE_URLS: Record<string, string> = {
  "tr_TR-dfki-medium": "https://huggingface.co/rhasspy/piper-voices/resolve/main/",
  "tr_TR-fahrettin-medium": "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/"
};

export function isPiperVoiceId(value: string): boolean {
  return (PIPER_VOICE_OPTIONS as readonly { value: string }[]).some((option) => option.value === value);
}

export function isPiperSupported(): boolean {
  return typeof WebAssembly !== "undefined";
}

interface PiperGenerateResponse {
  file: Blob;
}

interface PiperEngine {
  generate: (text: string, voice: string, speaker?: number) => Promise<PiperGenerateResponse>;
}

let enginePromise: Promise<PiperEngine> | null = null;

async function loadPiperEngine(): Promise<PiperEngine> {
  if (!enginePromise) {
    enginePromise = (async () => {
      const { PiperWebEngine, OnnxWebRuntime, RemoteVoiceProvider } = await import("piper-tts-web");
      // Default HuggingFaceVoiceProvider tracks the repo's latest version.
      // Single thread: the app serves no COOP/COEP headers (EPUB hosts would
      // break under require-corp), so SharedArrayBuffer threading is off.
      const providersByBaseUrl = new Map<string, { fetch: (voice: string) => Promise<unknown>; destroy: () => void }>();
      const providerFor = (voice: string) => {
        const baseUrl =
          PIPER_VOICE_BASE_URLS[voice] || "https://huggingface.co/rhasspy/piper-voices/resolve/main/";
        let provider = providersByBaseUrl.get(baseUrl);
        if (!provider) {
          provider = new RemoteVoiceProvider({ baseUrl }) as {
            fetch: (voice: string) => Promise<unknown>;
            destroy: () => void;
          };
          providersByBaseUrl.set(baseUrl, provider);
        }
        return provider;
      };
      return new PiperWebEngine({
        onnxRuntime: new OnnxWebRuntime({ numThreads: 1 }),
        voiceProvider: {
          fetch: (voice: string) => providerFor(voice).fetch(voice),
          destroy: () => providersByBaseUrl.forEach((provider) => provider.destroy())
        }
      }) as PiperEngine;
    })();
    enginePromise.catch(() => {
      enginePromise = null;
    });
  }
  return enginePromise;
}

export async function generatePiperWav(text: string, voice: string): Promise<Blob> {
  const voiceId = isPiperVoiceId(voice) ? voice : DEFAULT_PIPER_VOICE;
  const engine = await loadPiperEngine();
  const response = await engine.generate(text, voiceId, 0);
  return response.file;
}
