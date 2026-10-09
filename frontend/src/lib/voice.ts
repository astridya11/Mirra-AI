/**
 * Voice recording and transcription utilities for the dispute description field.
 *
 * No new npm dependencies — uses built-in browser APIs:
 *   getUserMedia, MediaRecorder, AudioContext, OfflineAudioContext.
 *
 * startRecording() returns a handle with stop() (WAV data URL) and cancel().
 * transcribeVoice() posts the data URL to the backend /api/voice/transcribe.
 */

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

const MAX_RECORDING_MS = 60_000; // 60 s auto-stop
const TARGET_SAMPLE_RATE = 16_000; // 16 kHz mono for ASR

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

export interface RecordingHandle {
  /** Stop recording, encode to 16 kHz mono WAV, return data URL. */
  stop: () => Promise<string>;
  /** Cancel recording and release the mic. */
  cancel: () => void;
}

export async function startRecording(): Promise<RecordingHandle> {
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let autoStopTimer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;
  let stopped = false;

  // Resolve the stop promise from the recorder's onstop event.
  let resolveStop: (dataUrl: string) => void;
  let rejectStop: (err: Error) => void;
  const stopPromise = new Promise<string>((resolve, reject) => {
    resolveStop = resolve;
    rejectStop = reject;
  });

  stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  // Prefer WAV-friendly mime; fall back to whatever the browser offers.
  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : MediaRecorder.isTypeSupported("audio/ogg")
        ? "audio/ogg"
        : "";

  recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);

  recorder.ondataavailable = (e: BlobEvent) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  recorder.onstop = async () => {
    // Stop all mic tracks.
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }
    if (autoStopTimer) clearTimeout(autoStopTimer);

    if (cancelled) {
      // Don't produce output on cancel; just resolve with empty.
      resolveStop("");
      return;
    }

    try {
      const blob = new Blob(chunks, { type: mime || "audio/webm" });
      const dataUrl = await encodeWavDataUrl(blob);
      resolveStop(dataUrl);
    } catch (err) {
      rejectStop(err instanceof Error ? err : new Error(String(err)));
    }
  };

  recorder.start();

  // Auto-stop at 60 s.
  autoStopTimer = setTimeout(() => {
    if (!stopped && recorder.state !== "inactive") {
      stopped = true;
      try {
        recorder.stop();
      } catch {
        // ignore
      }
    }
  }, MAX_RECORDING_MS);

  return {
    stop: () => {
      if (stopped) return stopPromise;
      stopped = true;
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
      return stopPromise;
    },
    cancel: () => {
      cancelled = true;
      stopped = true;
      if (autoStopTimer) clearTimeout(autoStopTimer);
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // ignore
        }
      }
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    },
  };
}

// ---------------------------------------------------------------------------
// WAV encoding (16 kHz mono 16-bit PCM)
// ---------------------------------------------------------------------------

async function encodeWavDataUrl(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();

  // Use a temporary AudioContext to decode the compressed audio.
  const AudioCtx: typeof AudioContext =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const tempCtx = new AudioCtx();
  const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
  tempCtx.close();

  // Resample to 16 kHz mono with OfflineAudioContext.
  const OfflineCtx: typeof OfflineAudioContext =
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;

  const numChannels = 1; // mono
  const length = Math.ceil(audioBuffer.duration * TARGET_SAMPLE_RATE);
  const offlineCtx = new OfflineCtx(
    numChannels,
    length,
    TARGET_SAMPLE_RATE
  );

  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineCtx.destination);
  source.start(0);

  const rendered = await offlineCtx.startRendering();
  return audioBufferToWavDataUrl(rendered);
}

function audioBufferToWavDataUrl(buffer: AudioBuffer): string {
  const numChannels = 1;
  const sampleRate = buffer.sampleRate;
  const numSamples = buffer.length;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = numSamples * blockAlign;
  const bufferSize = 44 + dataSize;

  const arr = new ArrayBuffer(bufferSize);
  const view = new DataView(arr);

  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");

  // fmt chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // Interleave samples from channel 0 (mono).
  const channelData = buffer.getChannelData(0);
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    let s = Math.max(-1, Math.min(1, channelData[i]));
    s = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(offset, s, true);
    offset += 2;
  }

  // ArrayBuffer → base64
  const bytes = new Uint8Array(arr);
  let binary = "";
  const chunkSize = 0x8000; // 32 KB
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  const base64 = btoa(binary);
  return `data:audio/wav;base64,${base64}`;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

// ---------------------------------------------------------------------------
// Transcription API call
// ---------------------------------------------------------------------------

export type VoiceLanguage = "en" | "zh" | "ms";

export async function transcribeVoice(
  dataUrl: string,
  language: VoiceLanguage = "en"
): Promise<string> {
  const res = await fetch(`${API_BASE_URL}/api/voice/transcribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audio: dataUrl, language }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || `Transcription failed: ${res.status}`);
  }

  const data = await res.json();
  return (data.text as string) || "";
}
