import chaseBgmUrl from '../assets/audio/chase.mp3';
import menuBgmUrl from '../assets/audio/menu.mp3';

export type SoundEffect = 'select' | 'dialogue' | 'water' | 'catch';
export type BgmMode = 'menu' | 'opening' | 'game' | 'rest' | 'result';

const BGM_TRACKS: Record<BgmMode, { url: string; volume: number }> = {
  menu: { url: menuBgmUrl, volume: 0.24 },
  opening: { url: menuBgmUrl, volume: 0.19 },
  game: { url: chaseBgmUrl, volume: 0.28 },
  rest: { url: menuBgmUrl, volume: 0.15 },
  result: { url: menuBgmUrl, volume: 0.23 },
};

export class AudioManager {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private effects: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private bgm: HTMLAudioElement | null = null;
  private bgmUrl = '';
  private fadingOutBgm: HTMLAudioElement | null = null;
  private bgmFadeFrame: number | null = null;
  private mode: BgmMode | null = null;
  private unlocked = false;

  playEffect(effect: SoundEffect) {
    const context = this.ensureContext();
    this.unlocked = true;
    void context.resume();
    if (this.mode && !this.bgm) this.playBgm(this.mode);
    const start = context.currentTime + 0.015;

    if (effect === 'select') {
      this.playPluck(659.25, start, 0.13, 0.075);
      this.playPluck(987.77, start + 0.055, 0.16, 0.055);
      return;
    }
    if (effect === 'dialogue') {
      this.playPluck(440, start, 0.09, 0.04);
      this.playNoise(start, 0.045, 0.018, 1500);
      return;
    }
    if (effect === 'water') {
      [659.25, 880, 1174.66, 1318.51].forEach((frequency, index) => {
        this.playGlassTone(frequency, start + index * 0.055, 0.5 - index * 0.035, 0.07);
      });
      this.playNoise(start, 0.28, 0.035, 3600, 900);
      return;
    }

    this.playKick(start, 0.12);
    [523.25, 659.25, 783.99].forEach((frequency, index) => {
      this.playPluck(frequency, start + index * 0.085, 0.42, 0.09);
      this.playPluck(frequency * 2, start + index * 0.085 + 0.025, 0.28, 0.035);
    });
    this.playNoise(start + 0.2, 0.34, 0.04, 5200);
  }

  startBgm(mode: BgmMode) {
    this.mode = mode;
    if (this.unlocked) this.playBgm(mode);
  }

  private playBgm(mode: BgmMode) {
    const track = BGM_TRACKS[mode];
    if (this.bgm && this.bgmUrl === track.url) {
      this.fadeVolume(this.bgm, track.volume, 420);
      if (this.bgm.paused) void this.bgm.play().catch(() => undefined);
      return;
    }

    const previous = this.bgm;
    const next = new Audio(track.url);
    next.loop = true;
    next.preload = 'auto';
    next.volume = 0;
    this.bgm = next;
    this.bgmUrl = track.url;
    void next.play()
      .then(() => {
        if (this.bgm === next && this.mode) {
          this.crossFade(previous, next, BGM_TRACKS[this.mode].volume);
        }
      })
      .catch(() => {
        if (this.bgm === next) {
          this.bgm = null;
          this.bgmUrl = '';
        }
      });
  }

  private crossFade(
    previous: HTMLAudioElement | null,
    next: HTMLAudioElement,
    targetVolume: number,
  ) {
    this.cancelBgmFade();
    if (this.fadingOutBgm && this.fadingOutBgm !== previous) {
      this.fadingOutBgm.pause();
    }
    this.fadingOutBgm = previous;
    const previousVolume = previous?.volume ?? 0;
    const startedAt = performance.now();
    const duration = 650;
    const tick = (now: number) => {
      const rate = Math.max(0, Math.min((now - startedAt) / duration, 1));
      const eased = 1 - Math.pow(1 - rate, 3);
      next.volume = targetVolume * eased;
      if (previous) previous.volume = previousVolume * (1 - eased);
      if (rate < 1) {
        this.bgmFadeFrame = requestAnimationFrame(tick);
      } else {
        previous?.pause();
        this.fadingOutBgm = null;
        this.bgmFadeFrame = null;
      }
    };
    this.bgmFadeFrame = requestAnimationFrame(tick);
  }

  private fadeVolume(audio: HTMLAudioElement, targetVolume: number, duration: number) {
    this.cancelBgmFade();
    const initialVolume = audio.volume;
    const startedAt = performance.now();
    const tick = (now: number) => {
      const rate = Math.max(0, Math.min((now - startedAt) / duration, 1));
      audio.volume = initialVolume + (targetVolume - initialVolume) * rate;
      this.bgmFadeFrame = rate < 1 ? requestAnimationFrame(tick) : null;
    };
    this.bgmFadeFrame = requestAnimationFrame(tick);
  }

  private cancelBgmFade() {
    if (this.bgmFadeFrame !== null) cancelAnimationFrame(this.bgmFadeFrame);
    this.bgmFadeFrame = null;
  }

  private ensureContext() {
    if (this.context && this.master && this.effects) return this.context;
    this.context = new AudioContext();

    const compressor = this.context.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 18;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.012;
    compressor.release.value = 0.22;
    compressor.connect(this.context.destination);

    this.master = this.context.createGain();
    this.master.gain.value = 0.62;
    this.master.connect(compressor);

    this.effects = this.context.createGain();
    this.effects.gain.value = 0.9;
    this.effects.connect(this.master);

    this.reverb = this.context.createConvolver();
    this.reverb.buffer = this.createImpulseResponse(1.35, 2.7);
    const reverbReturn = this.context.createGain();
    reverbReturn.gain.value = 0.2;
    this.reverb.connect(reverbReturn).connect(this.master);
    const effectsSend = this.context.createGain();
    effectsSend.gain.value = 0.34;
    this.effects.connect(effectsSend).connect(this.reverb);

    this.noiseBuffer = this.createNoiseBuffer();
    return this.context;
  }

  private playPluck(frequency: number, start: number, duration: number, volume: number) {
    if (!this.context || !this.effects) return;
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(4800, frequency * 7), start);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(420, frequency * 1.5),
      start + duration,
    );
    const envelope = this.context.createGain();
    envelope.gain.setValueAtTime(0.001, start);
    envelope.gain.linearRampToValueAtTime(volume, start + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.001, start + duration);

    for (const [type, detune, gainValue] of [
      ['triangle', -4, 0.75],
      ['sine', 7, 0.42],
    ] as const) {
      const oscillator = this.context.createOscillator();
      const voiceGain = this.context.createGain();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      oscillator.detune.value = detune;
      voiceGain.gain.value = gainValue;
      oscillator.connect(voiceGain).connect(filter);
      this.startSource(oscillator, start, start + duration);
    }
    filter.connect(envelope).connect(this.effects);
  }

  private playGlassTone(frequency: number, start: number, duration: number, volume: number) {
    if (!this.context || !this.effects) return;
    const envelope = this.context.createGain();
    envelope.gain.setValueAtTime(volume, start);
    envelope.gain.exponentialRampToValueAtTime(0.001, start + duration);
    envelope.connect(this.effects);
    [1, 2.01, 3.98].forEach((ratio, index) => {
      const oscillator = this.context!.createOscillator();
      const partialGain = this.context!.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency * ratio;
      partialGain.gain.value = 1 / (index + 1.4);
      oscillator.connect(partialGain).connect(envelope);
      this.startSource(oscillator, start, start + duration);
    });
  }

  private playKick(start: number, volume: number) {
    if (!this.context || !this.effects) return;
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(130, start);
    oscillator.frequency.exponentialRampToValueAtTime(48, start + 0.16);
    envelope.gain.setValueAtTime(volume, start);
    envelope.gain.exponentialRampToValueAtTime(0.001, start + 0.18);
    oscillator.connect(envelope).connect(this.effects);
    this.startSource(oscillator, start, start + 0.18);
  }

  private playNoise(
    start: number,
    duration: number,
    volume: number,
    cutoff: number,
    highpass = 0,
  ) {
    if (!this.context || !this.noiseBuffer || !this.effects) return;
    const source = this.context.createBufferSource();
    source.buffer = this.noiseBuffer;
    const lowpass = this.context.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = cutoff;
    const highpassFilter = this.context.createBiquadFilter();
    highpassFilter.type = 'highpass';
    highpassFilter.frequency.value = highpass;
    const envelope = this.context.createGain();
    envelope.gain.setValueAtTime(volume, start);
    envelope.gain.exponentialRampToValueAtTime(0.001, start + duration);
    source.connect(lowpass).connect(highpassFilter).connect(envelope).connect(this.effects);
    this.startSource(source, start, start + duration);
  }

  private startSource(
    source: OscillatorNode | AudioBufferSourceNode,
    start: number,
    stop: number,
  ) {
    source.start(start);
    source.stop(stop);
  }

  private createNoiseBuffer() {
    if (!this.context) throw new Error('Audio context is not ready');
    const buffer = this.context.createBuffer(1, this.context.sampleRate * 2, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) {
      data[index] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private createImpulseResponse(duration: number, decay: number) {
    if (!this.context) throw new Error('Audio context is not ready');
    const length = Math.floor(this.context.sampleRate * duration);
    const impulse = this.context.createBuffer(2, length, this.context.sampleRate);
    for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let index = 0; index < length; index += 1) {
        data[index] =
          (Math.random() * 2 - 1) * Math.pow(1 - index / length, decay);
      }
    }
    return impulse;
  }
}
