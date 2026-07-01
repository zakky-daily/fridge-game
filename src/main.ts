import './style.css';
import { Game } from './game/Game';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <canvas id="game-canvas" tabindex="0" aria-label="逃走する冷蔵庫 3Dゲーム画面"></canvas>
  <div id="overlay" class="overlay"></div>

  <div id="hud" class="hud hidden">
    <div class="hud-top">
      <div class="mode-chip"><small>今日の体調</small><b id="mode-value">まだ動けそう</b></div>
      <div class="distance-card"><small>冷蔵庫まで</small><b id="distance-value">0.0 m</b></div>
    </div>
    <div id="calorie-meter" class="calorie-meter">
      <div class="meter-inner">
        <small>摂取カロリー<br>見直し</small>
        <b><span id="meter-value">0</span><i>kcal</i></b>
        <em>ゲーム内推定</em>
      </div>
    </div>
    <div class="boost-card"><span>BOOST</span><b id="boost-value">—</b></div>
    <div class="desktop-hint">WASD 移動 · SHIFT ダッシュ · ドラッグ 視点</div>
  </div>

  <div id="game-toast" class="game-toast hidden"></div>

  <div id="touch-controls" class="touch-controls hidden">
    <div id="joystick" class="joystick"><div id="joystick-knob"></div></div>
    <button id="boost-button" class="boost-button" aria-label="ブースト">BOOST</button>
  </div>
`;

new Game();
