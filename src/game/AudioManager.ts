export type SoundEffect = 'select' | 'dialogue' | 'water' | 'catch';
export type BgmMode = 'menu' | 'opening' | 'game' | 'rest' | 'result';

type Score = {
  bpm: number;
  chords: number[][];
  melody: Array<number | null>;
  bass: number[];
  groove: 'soft' | 'chase' | 'celebration';
  brightness: number;
};

const SCORES: Record<BgmMode, Score> = {
  menu: {
    bpm: 94,
    chords: [[57, 60, 64], [55, 59, 62], [53, 57, 60], [55, 59, 64]],
    melody: [69, null, 72, 71, 69, null, 67, 64, 65, null, 69, 67, 64, 67, 69, null],
    bass: [45, 43, 41, 43],
    groove: 'soft',
    brightness: 1400,
  },
  opening: {
    bpm: 80,
    chords: [[52, 55, 59], [50, 53, 57], [48, 52, 55], [50, 54, 57]],
    melody: [64, null, 67, null, 66, 64, null, 62, 60, null, 64, 62, 59, null, 62, null],
    bass: [40, 38, 36, 38],
    groove: 'soft',
    brightness: 1050,
  },
  game: {
    bpm: 126,
    chords: [[57, 60, 64], [55, 59, 62], [53, 57, 60], [55, 59, 64]],
    melody: [69, 72, 76, null, 74, 72, 69, 67, 69, 72, 77, 76, 74, 72, 71, null],
    bass: [45, 43, 41, 43],
    groove: 'chase',
    brightness: 1900,
  },
  rest: {
    bpm: 68,
    chords: [[53, 57, 60], [48, 52, 55], [50, 53, 57], [48, 52, 57]],
    melody: [65, null, null, 64, 60, null, 62, null, 64, null, null, 60, 57, null, 60, null],
    bass: [41, 36, 38, 36],
    groove: 'soft',
    brightness: 850,
  },
  result: {
    bpm: 108,
    chords: [[60, 64, 67], [62, 65, 69], [64, 67, 71], [65, 69, 72]],
    melody: [72, 76, 79, 84, 81, 79, 76, 79, 81, 84, 88, 86, 84, 81, 79, 84],
    bass: [48, 50, 52, 53],
    groove: 'celebration',
    brightness: 2200,
  },
};

export class AudioManager {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private effects: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private loopTimer: number | null = null;
  private mode: BgmMode | null = null;
  private musicSources = new Set<OscillatorNode | AudioBufferSourceNode>();
  private noiseBuffer: AudioBuffer | null = null;

  playEffect(effect: SoundEffect) {
    const context = this.ensureContext();
    void context.resume();
    const start = context.currentTime + 0.015;

    if (effect === 'select') {
      this.playPluck(659.25, start, 0.13, 0.075, this.effects);
      this.playPluck(987.77, start + 0.055, 0.16, 0.055, this.effects);
      return;
    }
    if (effect === 'dialogue') {
      this.playPluck(440, start, 0.09, 0.04, this.effects);
      this.playNoise(start, 0.045, 0.018, 1500, this.effects);
      return;
    }
    if (effect === 'water') {
      [659.25, 880, 1174.66, 1318.51].forEach((frequency, index) => {
        this.playGlassTone(frequency, start + index * 0.055, 0.5 - index * 0.035, 0.07);
      });
      this.playNoise(start, 0.28, 0.035, 3600, this.effects, 900);
      return;
    }

    this.playKick(start, 0.12);
    [523.25, 659.25, 783.99].forEach((frequency, index) => {
      this.playPluck(frequency, start + index * 0.085, 0.42, 0.09, this.effects);
      this.playPluck(frequency * 2, start + index * 0.085 + 0.025, 0.28, 0.035, this.effects);
    });
    this.playNoise(start + 0.2, 0.34, 0.04, 5200, this.effects);
  }

  startBgm(mode: BgmMode) {
    if (!this.context) return;
    void this.context.resume();
    if (this.mode === mode && this.loopTimer !== null) return;
    this.stopBgm();
    this.mode = mode;

    const score = SCORES[mode];
    const stepDuration = 60 / score.bpm / 2;
    const loopDuration = stepDuration * score.melody.length;
    const schedule = () => {
      if (!this.context || this.mode !== mode) return;
      this.scheduleScore(score, this.context.currentTime + 0.06);
    };
    schedule();
    this.loopTimer = window.setInterval(schedule, loopDuration * 1000);
  }

  private scheduleScore(score: Score, start: number) {
    const stepDuration = 60 / score.bpm / 2;
    score.chords.forEach((chord, chordIndex) => {
      const chordStart = start + chordIndex * stepDuration * 4;
      this.playPad(chord, chordStart, stepDuration * 3.85, score.brightness);
      this.playBass(score.bass[chordIndex], chordStart, stepDuration * 1.6);
      this.playBass(score.bass[chordIndex] + 7, chordStart + stepDuration * 2, stepDuration * 1.4);
    });

    score.melody.forEach((note, index) => {
      const noteStart = start + index * stepDuration;
      if (note !== null) {
        this.playPluck(
          this.midiToFrequency(note),
          noteStart,
          stepDuration * 1.45,
          score.groove === 'soft' ? 0.028 : 0.042,
          this.music,
          true,
        );
      }
      if (score.groove === 'chase') {
        this.playHat(noteStart, index % 2 === 0 ? 0.024 : 0.014);
        if (index % 4 === 0) this.playKick(noteStart, 0.055, true);
        if (index % 8 === 4) this.playSnare(noteStart, 0.038);
      } else if (score.groove === 'celebration') {
        if (index % 4 === 0) this.playKick(noteStart, 0.045, true);
        if (index % 4 === 2) this.playHat(noteStart, 0.02);
      } else if (index % 4 === 2) {
        this.playHat(noteStart, 0.008);
      }
    });
  }

  private stopBgm() {
    if (this.loopTimer !== null) window.clearInterval(this.loopTimer);
    this.loopTimer = null;
    this.mode = null;
    for (const source of this.musicSources) {
      try {
        source.stop();
      } catch {
        // A source that already ended does not need any further cleanup.
      }
    }
    this.musicSources.clear();
  }

  private ensureContext() {
    if (this.context && this.master && this.music && this.effects) return this.context;
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

    this.music = this.context.createGain();
    this.music.gain.value = 0.72;
    this.music.connect(this.master);

    this.effects = this.context.createGain();
    this.effects.gain.value = 0.9;
    this.effects.connect(this.master);

    this.reverb = this.context.createConvolver();
    this.reverb.buffer = this.createImpulseResponse(1.35, 2.7);
    const reverbReturn = this.context.createGain();
    reverbReturn.gain.value = 0.2;
    this.reverb.connect(reverbReturn).connect(this.master);
    const musicSend = this.context.createGain();
    musicSend.gain.value = 0.2;
    this.music.connect(musicSend).connect(this.reverb);
    const effectsSend = this.context.createGain();
    effectsSend.gain.value = 0.34;
    this.effects.connect(effectsSend).connect(this.reverb);

    this.noiseBuffer = this.createNoiseBuffer();
    return this.context;
  }

  private playPad(notes: number[], start: number, duration: number, cutoff: number) {
    if (!this.context || !this.music) return;
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, start);
    filter.Q.value = 0.6;
    const envelope = this.context.createGain();
    envelope.gain.setValueAtTime(0.001, start);
    envelope.gain.linearRampToValueAtTime(0.024, start + 0.18);
    envelope.gain.setValueAtTime(0.024, start + Math.max(0.2, duration - 0.3));
    envelope.gain.exponentialRampToValueAtTime(0.001, start + duration);
    filter.connect(envelope).connect(this.music);

    for (const note of notes) {
      for (const detune of [-5, 5]) {
        const oscillator = this.context.createOscillator();
        oscillator.type = detune < 0 ? 'triangle' : 'sawtooth';
        oscillator.frequency.value = this.midiToFrequency(note);
        oscillator.detune.value = detune;
        oscillator.connect(filter);
        this.startSource(oscillator, start, start + duration, true);
      }
    }
  }

  private playBass(note: number, start: number, duration: number) {
    if (!this.context || !this.music) return;
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(360, start);
    filter.frequency.exponentialRampToValueAtTime(130, start + duration);
    const envelope = this.context.createGain();
    envelope.gain.setValueAtTime(0.001, start);
    envelope.gain.linearRampToValueAtTime(0.07, start + 0.025);
    envelope.gain.exponentialRampToValueAtTime(0.001, start + duration);
    const oscillator = this.context.createOscillator();
    oscillator.type = 'triangle';
    oscillator.frequency.value = this.midiToFrequency(note);
    oscillator.connect(filter).connect(envelope).connect(this.music);
    this.startSource(oscillator, start, start + duration, true);
  }

  private playPluck(
    frequency: number,
    start: number,
    duration: number,
    volume: number,
    destination: AudioNode | null,
    isMusic = false,
  ) {
    if (!this.context || !destination) return;
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(4800, frequency * 7), start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(420, frequency * 1.5), start + duration);
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
      this.startSource(oscillator, start, start + duration, isMusic);
    }
    filter.connect(envelope).connect(destination);
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
      this.startSource(oscillator, start, start + duration, false);
    });
  }

  private playKick(start: number, volume: number, isMusic = false) {
    if (!this.context) return;
    const destination = isMusic ? this.music : this.effects;
    if (!destination) return;
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(130, start);
    oscillator.frequency.exponentialRampToValueAtTime(48, start + 0.16);
    envelope.gain.setValueAtTime(volume, start);
    envelope.gain.exponentialRampToValueAtTime(0.001, start + 0.18);
    oscillator.connect(envelope).connect(destination);
    this.startSource(oscillator, start, start + 0.18, isMusic);
  }

  private playSnare(start: number, volume: number) {
    this.playNoise(start, 0.12, volume, 3200, this.music, 700, true);
    if (!this.context || !this.music) return;
    const oscillator = this.context.createOscillator();
    const envelope = this.context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.value = 185;
    envelope.gain.setValueAtTime(volume * 0.7, start);
    envelope.gain.exponentialRampToValueAtTime(0.001, start + 0.1);
    oscillator.connect(envelope).connect(this.music);
    this.startSource(oscillator, start, start + 0.1, true);
  }

  private playHat(start: number, volume: number) {
    this.playNoise(start, 0.055, volume, 7800, this.music, 4200, true);
  }

  private playNoise(
    start: number,
    duration: number,
    volume: number,
    cutoff: number,
    destination: AudioNode | null,
    highpass = 0,
    isMusic = false,
  ) {
    if (!this.context || !this.noiseBuffer || !destination) return;
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
    source.connect(lowpass).connect(highpassFilter).connect(envelope).connect(destination);
    this.startSource(source, start, start + duration, isMusic);
  }

  private startSource(
    source: OscillatorNode | AudioBufferSourceNode,
    start: number,
    stop: number,
    isMusic: boolean,
  ) {
    if (isMusic) {
      this.musicSources.add(source);
      source.addEventListener('ended', () => this.musicSources.delete(source), { once: true });
    }
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

  private midiToFrequency(note: number) {
    return 440 * Math.pow(2, (note - 69) / 12);
  }
}
