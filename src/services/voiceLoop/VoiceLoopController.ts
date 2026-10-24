/**
 * Voice-to-voice loop controller for Box AI.
 *
 * Pipeline: VAD / mic → Whisper STT (whisper.rn) → LLM stream → TTS play.
 * This module orchestrates state; engines already exist under services/asr & tts.
 */

export type VoiceLoopState =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'error';

type Listener = (s: VoiceLoopState, detail?: string) => void;

export class VoiceLoopController {
  private state: VoiceLoopState = 'idle';
  private listeners = new Set<Listener>();

  getState() {
    return this.state;
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(s: VoiceLoopState, detail?: string) {
    this.state = s;
    this.listeners.forEach(fn => fn(s, detail));
  }

  /** Start listening; integrate with useVoiceCapture / asrStore in UI. */
  startListening() {
    this.set('listening');
  }

  onTranscript(text: string) {
    this.set('transcribing', text);
    if (text.trim()) {
      this.set('thinking', text);
    }
  }

  onLlmToken(_token: string) {
    if (this.state !== 'thinking' && this.state !== 'speaking') {
      this.set('thinking');
    }
  }

  onLlmDone() {
    this.set('speaking');
  }

  onTtsDone() {
    this.set('idle');
  }

  fail(message: string) {
    this.set('error', message);
  }

  stop() {
    this.set('idle');
  }
}

export const voiceLoopController = new VoiceLoopController();
