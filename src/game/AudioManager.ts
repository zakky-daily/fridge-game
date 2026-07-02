export type SoundEffect = 'select' | 'dialogue' | 'water' | 'catch';
export type BgmMode = 'menu' | 'opening' | 'game' | 'rest' | 'result';

const BGM_PATTERNS: Record<BgmMode, { notes: number[]; tempo: number; volume: number }> = {
  menu: { notes: [220, 277.18, 329.63, 277.18], tempo: 0.52, volume: 0.028 },
  opening: { notes: [196, 246.94, 293.66, 246.94], tempo: 0.48, volume: 0.026 },
  game: { notes: [261.63, 329.63, 392, 440, 392, 329.63], tempo: 0.25, volume: 0.034 },
  rest: { notes: [174.61, 220, 261.63, 220], tempo: 0.72, volume: 0.022 },
  result: { notes: [261.63, 329.63, 392, 523.25], tempo: 0.42, volume: 0.032 },
};

export class AudioManager {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private loopTimer: number | null = null;
  private mode: BgmMode | null = null;

  playEffect(effect: SoundEffect) {
    const context = this.ensureContext();
    void context.resume();
    const patterns: Record<SoundEffect, Array<[number, number, OscillatorType]>> = {
      select: [[520, 0.07, 'sine'], [680, 0.08, 'sine']],
      dialogue: [[410, 0.045, 'triangle']],
      water: [[520, 0.09, 'sine'], [700, 0.1, 'sine'], [940, 0.13, 'triangle']],
      catch: [[392, 0.12, 'triangle'], [523.25, 0.14, 'triangle'], [659.25, 0.2, 'sine']],
    };
    let offset = 0;
    for (const [frequency, duration, type] of patterns[effect]) {
      this.playTone(frequency, context.currentTime + offset, duration, type, 0.09);
      offset += duration * 0.72;
    }
  }

  startBgm(mode: BgmMode) {
    if (!this.context) return;
    const context = this.context;
    void context.resume();
    if (this.mode === mode && this.loopTimer !== null) return;
    this.stopBgm();
    this.mode = mode;
    const pattern = BGM_PATTERNS[mode];
    const loopDuration = pattern.notes.length * pattern.tempo;
    const schedule = () => {
      if (!this.context || !this.music) return;
      const start = this.context.currentTime + 0.04;
      pattern.notes.forEach((frequency, index) => {
        this.playMusicTone(
          frequency,
          start + index * pattern.tempo,
          pattern.tempo * 0.82,
          pattern.volume,
        );
      });
    };
    schedule();
    this.loopTimer = window.setInterval(schedule, loopDuration * 1000);
  }

  private stopBgm() {
    if (this.loopTimer !== null) window.clearInterval(this.loopTimer);
    this.loopTimer = null;
    this.mode = null;
  }

  private ensureContext() {
    if (this.context && this.master && this.music) return this.context;
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = 0.65;
    this.master.connect(this.context.destination);
    this.music = this.context.createGain();
    this.music.gain.value = 1;
    this.music.connect(this.master);
    return this.context;
  }

  private playTone(
    frequency: number,
    start: number,
    duration: number,
    type: OscillatorType,
    volume: number,
  ) {
    if (!this.context || !this.master) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration);
  }

  private playMusicTone(frequency: number, start: number, duration: number, volume: number) {
    if (!this.context || !this.music) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.001, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain).connect(this.music);
    oscillator.start(start);
    oscillator.stop(start + duration);
  }
}
