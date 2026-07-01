import * as THREE from 'three';
import { clamp, DIFFICULTY_SETTINGS, GAME_CONFIG, type Difficulty } from '../config';
import { Input } from './Input';
import { World } from './World';

type Screen = 'home' | 'opening' | 'difficulty' | 'rest' | 'playing' | 'result' | 'help';
type Result = {
  calories: number;
  seconds: number;
  items: number;
};

const openingLines = [
  { speaker: 'ナレーション', text: '午前0時すぎ。静かな家に、足音がひとつ。' },
  { speaker: '主人公', text: '今日も疲れた……ちょっとだけ何か食べようかな。' },
  { speaker: '主人公', text: '夜食は……うん、ほんの少しだけ。' },
  { speaker: '冷蔵庫', text: 'ちょっと待った！ その一口、本当に今必要？' },
  { speaker: '主人公', text: 'えっ、冷蔵庫が喋った！？' },
  { speaker: '冷蔵庫', text: '食べたいなら、まずは少しだけ動いてみない？' },
  { speaker: '冷蔵庫', text: 'ふふん、追いつけるものなら追いついてごらん！' },
  { speaker: 'ナレーション', text: 'こうして、深夜の小さな追いかけっこが始まった。' },
];

const fridgeLines = [
  'まだ追ってくるの！？',
  'その調子、意外といい運動だよ！',
  'カロリーが燃える音がする……！',
  'だんだん足が重くなってきた……冷蔵庫なのに！',
];

export class Game {
  private renderer: THREE.WebGLRenderer;
  private world: World;
  private input: Input;
  private screen: Screen = 'home';
  private difficulty: Difficulty = 'normal';
  private calories = 0;
  private elapsed = 0;
  private boostRemaining = 0;
  private itemCount = 0;
  private openingIndex = 0;
  private openingDestination: 'home' | 'difficulty' = 'difficulty';
  private openingAutoTimer = 0;
  private speechTimer = 0;
  private speechIndex = 0;
  private lastTime = performance.now();
  private audioContext: AudioContext | null = null;

  private overlay = this.required<HTMLElement>('#overlay');
  private hud = this.required<HTMLElement>('#hud');
  private touchControls = this.required<HTMLElement>('#touch-controls');
  private meter = this.required<HTMLElement>('#calorie-meter');
  private meterValue = this.required<HTMLElement>('#meter-value');
  private distanceValue = this.required<HTMLElement>('#distance-value');
  private boostValue = this.required<HTMLElement>('#boost-value');
  private modeValue = this.required<HTMLElement>('#mode-value');
  private toast = this.required<HTMLElement>('#game-toast');

  constructor() {
    const canvas = this.required<HTMLCanvasElement>('#game-canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.world = new World(this.renderer);
    this.input = new Input(
      canvas,
      this.required('#joystick'),
      this.required('#joystick-knob'),
      this.required('#boost-button'),
    );
    window.addEventListener('resize', () => this.world.resize());
    this.showHome();
    requestAnimationFrame(this.loop);
  }

  private loop = (now: number) => {
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    if (this.screen === 'opening') this.updateOpening(dt);
    if (this.screen === 'playing') this.updateGame(dt);
    this.renderer.render(this.world.scene, this.world.camera);
    requestAnimationFrame(this.loop);
  };

  private setScreen(screen: Screen) {
    this.screen = screen;
    this.overlay.className = screen === 'playing' ? 'overlay hidden' : 'overlay';
    this.hud.classList.toggle('hidden', screen !== 'playing');
    this.touchControls.classList.toggle('hidden', screen !== 'playing');
    this.toast.classList.add('hidden');
  }

  private showHome = () => {
    this.setScreen('home');
    this.world.resetForOpening();
    this.overlay.innerHTML = `
      <main class="menu-panel home-panel">
        <div class="eyebrow">MIDNIGHT HEALTH CHASE</div>
        <h1>逃走する<br><span>冷蔵庫</span></h1>
        <p class="tagline">深夜、冷蔵庫は走り出した。<br>食べる前に、ほんの少し追いかけよう。</p>
        <div class="menu-actions">
          <button class="primary-button" data-action="start"><span>▶</span> はじめから</button>
          <button class="secondary-button" data-action="movie">ムービーを見る</button>
          <button class="text-button" data-action="help">操作説明</button>
        </div>
        <p class="health-note">無理をしない。それも、このゲームの大切なルールです。</p>
      </main>
      <div class="fridge-badge">「今夜はどうする？」</div>
    `;
    this.bind('[data-action="start"]', () => this.startOpening('difficulty'));
    this.bind('[data-action="movie"]', () => this.startOpening('home'));
    this.bind('[data-action="help"]', this.showHelp);
  };

  private showHelp = () => {
    this.setScreen('help');
    this.overlay.innerHTML = `
      <main class="menu-panel info-panel">
        <button class="close-button" data-action="back" aria-label="戻る">×</button>
        <div class="eyebrow">HOW TO PLAY</div>
        <h2>操作説明</h2>
        <div class="help-grid">
          <section><span class="help-icon">⌨</span><h3>PC</h3><p><b>WASD / 矢印</b> で移動<br><b>Shift</b> でダッシュ<br><b>ドラッグ</b> でカメラ操作</p></section>
          <section><span class="help-icon">◉</span><h3>スマホ</h3><p><b>左スティック</b> で移動<br><b>右側ドラッグ</b> でカメラ<br><b>BOOST</b> でダッシュ</p></section>
        </div>
        <div class="tip-card">水ボトルを拾うと数秒間ブースト。動くほど冷蔵庫は疲れて、追いつきやすくなります。</div>
        <button class="primary-button compact" data-action="back">ホームへ戻る</button>
      </main>
    `;
    this.overlay.querySelectorAll('[data-action="back"]').forEach((button) => {
      button.addEventListener('click', this.showHome);
    });
  };

  private startOpening(destination: 'home' | 'difficulty') {
    this.openingDestination = destination;
    this.openingIndex = 0;
    this.openingAutoTimer = 0;
    this.setScreen('opening');
    this.world.resetForOpening();
    this.overlay.innerHTML = `
      <div class="cinema-bars"></div>
      <button class="skip-button" data-action="skip">スキップ »</button>
      <div class="chapter-label">PROLOGUE — 午前0時のキッチン</div>
      <button class="novel-box" data-action="next" aria-label="次のセリフへ">
        <span id="novel-speaker"></span>
        <span id="novel-text"></span>
        <span class="next-mark">▼</span>
      </button>
    `;
    this.updateOpeningText();
    this.bind('[data-action="next"]', this.nextOpeningLine);
    this.bind('[data-action="skip"]', this.finishOpening);
  }

  private updateOpening(dt: number) {
    this.openingAutoTimer += dt;
    this.world.animateOpening(this.openingIndex, dt);
    if (this.openingAutoTimer > 4.8) this.nextOpeningLine();
  }

  private nextOpeningLine = () => {
    if (this.screen !== 'opening') return;
    this.openingIndex += 1;
    this.openingAutoTimer = 0;
    if (this.openingIndex >= openingLines.length) {
      this.finishOpening();
      return;
    }
    this.updateOpeningText();
  };

  private updateOpeningText() {
    const line = openingLines[this.openingIndex];
    const speaker = this.required<HTMLElement>('#novel-speaker');
    speaker.textContent = line.speaker;
    speaker.dataset.speaker = line.speaker;
    this.required<HTMLElement>('#novel-text').textContent = line.text;
  }

  private finishOpening = () => {
    if (this.openingDestination === 'home') this.showHome();
    else this.showDifficulty();
  };

  private showDifficulty = () => {
    this.setScreen('difficulty');
    this.overlay.innerHTML = `
      <main class="menu-panel mood-panel">
        <div class="eyebrow">CHECK IN WITH YOURSELF</div>
        <h2>今日一日、<br>どうだった？</h2>
        <p class="lead">今の体調に合わせて、今夜の過ごし方を選ぼう。</p>
        <div class="mood-options">
          <button class="mood-button rest" data-mode="rest"><span class="mood-emoji">☾</span><span><b>すごく疲れている</b><small>今日は休息を選ぶ</small></span><i>→</i></button>
          <button class="mood-button easy" data-mode="easy"><span class="mood-emoji">◒</span><span><b>少し疲れている</b><small>ゆっくり追いかける</small></span><i>→</i></button>
          <button class="mood-button normal" data-mode="normal"><span class="mood-emoji">●</span><span><b>まだ動けそう</b><small>いつものペースで挑戦</small></span><i>→</i></button>
        </div>
        <p class="health-note">どれを選んでも正解です。体の声を優先してください。</p>
      </main>
    `;
    this.overlay.querySelectorAll<HTMLElement>('[data-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        const mode = button.dataset.mode;
        if (mode === 'rest') this.showRestEnding();
        else this.startGame(mode as Difficulty);
      });
    });
  };

  private showRestEnding() {
    this.setScreen('rest');
    this.world.player.visible = false;
    this.world.setPlayerShape(0);
    this.overlay.innerHTML = `
      <main class="menu-panel rest-panel">
        <div class="moon-illustration"><span>☾</span><i>z</i><i>z</i></div>
        <div class="eyebrow">REST IS HEALTH, TOO</div>
        <h2>今日は、追いかけない。</h2>
        <p class="rest-copy">体を動かす日も、休む日も、<br>健康にはどちらも必要です。</p>
        <blockquote>冷蔵庫は静かにうなずいた。<br>「うん。今日はゆっくり休もう。」</blockquote>
        <div class="rest-actions">
          <button class="primary-button compact" data-action="home">ホームへ</button>
          <button class="text-button" data-action="choose">選び直す</button>
        </div>
      </main>
    `;
    this.bind('[data-action="home"]', this.showHome);
    this.bind('[data-action="choose"]', this.showDifficulty);
  }

  private startGame(difficulty: Difficulty) {
    this.difficulty = difficulty;
    this.calories = 0;
    this.elapsed = 0;
    this.boostRemaining = 0;
    this.itemCount = 0;
    this.speechTimer = 2.5;
    this.speechIndex = 0;
    this.world.resetForGame(difficulty);
    this.setScreen('playing');
    this.modeValue.textContent = DIFFICULTY_SETTINGS[difficulty].label;
    this.updateHud();
    this.showToast('冷蔵庫を追いかけよう！', 1700);
  }

  private updateGame(dt: number) {
    this.elapsed += dt;
    this.boostRemaining = Math.max(0, this.boostRemaining - dt);
    const movement = this.input.getMovement();
    const look = this.input.getLookDelta();
    const wantsDash = this.input.isDashActive();
    const hasBoost = this.boostRemaining > 0;
    const speed = hasBoost
      ? GAME_CONFIG.player.boostSpeed
      : wantsDash
        ? GAME_CONFIG.player.dashSpeed
        : GAME_CONFIG.player.walkSpeed;
    const moved = this.world.movePlayer(movement.x, movement.y, speed * dt);

    if (moved) {
      const gain = hasBoost
        ? GAME_CONFIG.calories.boostPerSecond
        : wantsDash
          ? GAME_CONFIG.calories.dashPerSecond
          : GAME_CONFIG.calories.walkPerSecond;
      this.calories += gain * dt;
    }

    const rate = clamp(this.calories / GAME_CONFIG.calories.maxForScaling, 0, 1);
    const fridgeRate = Math.max(GAME_CONFIG.fridge.minSpeedRate, 1 - rate * 0.68);
    const fridgeSpeed = DIFFICULTY_SETTINGS[this.difficulty].fridgeSpeed * fridgeRate;
    this.world.updateFridge(dt, fridgeSpeed, this.calories);
    this.world.updateCamera(look.x, look.y);
    this.world.setPlayerShape(this.calories);
    this.world.updateItems(dt);

    const collected = this.world.collectNearbyItems();
    if (collected > 0) {
      this.itemCount += collected;
      this.boostRemaining = GAME_CONFIG.boost.duration;
      this.calories += 2.5;
      this.playPickupSound();
      this.showToast('水分補給！ 4秒ブースト', 1500);
    }

    this.speechTimer -= dt;
    if (this.speechTimer <= 0) {
      this.showFridgeSpeech(fridgeLines[this.speechIndex % fridgeLines.length]);
      this.speechIndex += 1;
      this.speechTimer = 9 + Math.random() * 4;
    }

    if (this.world.getDistance() < GAME_CONFIG.fridge.catchDistance) {
      this.finishGame();
      return;
    }
    this.updateHud();
  }

  private updateHud() {
    const rate = clamp(this.calories / GAME_CONFIG.calories.maxForScaling, 0, 1);
    const hue = 4 + rate * 124;
    this.meter.style.setProperty('--progress', `${rate * 360}deg`);
    this.meter.style.setProperty('--meter-color', `hsl(${hue} 68% 51%)`);
    this.meterValue.textContent = Math.round(this.calories).toString();
    this.distanceValue.textContent = `${this.world.getDistance().toFixed(1)} m`;
    this.boostValue.textContent = this.boostRemaining > 0 ? `${this.boostRemaining.toFixed(1)} 秒` : '—';
    this.boostValue.parentElement?.classList.toggle('active', this.boostRemaining > 0);
  }

  private finishGame() {
    const result = {
      calories: this.calories,
      seconds: this.elapsed,
      items: this.itemCount,
    };
    this.showResult(result);
  }

  private showResult(result: Result) {
    this.setScreen('result');
    const type =
      result.calories >= 55 ? 'しなやか継続タイプ' : result.items >= 3 ? '水分補給マスター' : '小さな一歩タイプ';
    this.overlay.innerHTML = `
      <main class="menu-panel result-panel">
        <div class="result-check">✓</div>
        <div class="eyebrow">CHASE COMPLETE!</div>
        <h2>冷蔵庫を捕まえた！</h2>
        <p class="result-message">少し動くだけでも、体はちゃんと反応している。</p>
        <div class="result-stats">
          <div><small>ゲーム内消費カロリー</small><b>${Math.round(result.calories)}<i> kcal</i></b></div>
          <div><small>タイム</small><b>${this.formatTime(result.seconds)}</b></div>
          <div><small>アイテム</small><b>${result.items}<i> 個</i></b></div>
        </div>
        <div class="health-type"><span>今日の健康タイプ</span><b>${type}</b></div>
        <p class="disclaimer">※カロリーはゲーム内の推定値です。無理せず続けることが一番大切です。</p>
        <div class="result-actions">
          <button class="primary-button compact" data-action="retry">もう一度</button>
          <button class="secondary-button compact" data-action="home">ホームへ</button>
        </div>
      </main>
    `;
    this.bind('[data-action="retry"]', this.showDifficulty);
    this.bind('[data-action="home"]', this.showHome);
  }

  private showToast(message: string, duration: number) {
    this.toast.textContent = message;
    this.toast.classList.remove('hidden');
    window.setTimeout(() => this.toast.classList.add('hidden'), duration);
  }

  private showFridgeSpeech(message: string) {
    const bubble = document.createElement('div');
    bubble.className = 'fridge-speech';
    bubble.textContent = message;
    document.body.appendChild(bubble);
    window.setTimeout(() => bubble.classList.add('show'), 20);
    window.setTimeout(() => {
      bubble.classList.remove('show');
      window.setTimeout(() => bubble.remove(), 300);
    }, 2600);
  }

  private playPickupSound() {
    this.audioContext ??= new AudioContext();
    const oscillator = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(520, this.audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(880, this.audioContext.currentTime + 0.14);
    gain.gain.setValueAtTime(0.12, this.audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.2);
    oscillator.connect(gain).connect(this.audioContext.destination);
    oscillator.start();
    oscillator.stop(this.audioContext.currentTime + 0.2);
  }

  private formatTime(seconds: number) {
    const minutes = Math.floor(seconds / 60);
    const rest = Math.floor(seconds % 60);
    return `${minutes}:${rest.toString().padStart(2, '0')}`;
  }

  private bind(selector: string, handler: () => void) {
    this.required<HTMLElement>(selector).addEventListener('click', handler);
  }

  private required<T extends Element = HTMLElement>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Required element not found: ${selector}`);
    return element;
  }
}
