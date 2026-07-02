import './style.css';
import { Game } from './game/Game';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <canvas id="game-canvas" tabindex="0" aria-label="逃げるお菓子BOX 3Dゲーム画面"></canvas>
  <div id="overlay" class="overlay"></div>

  <div id="hud" class="hud hidden">
    <div class="hud-top">
      <div class="mode-chip"><small>今日の体調</small><b id="mode-value">今日は頑張る</b></div>
      <div class="distance-card"><small>お菓子BOXまで</small><b id="distance-value">0.0 m</b></div>
    </div>
    <div id="calorie-meter" class="calorie-meter">
      <div class="meter-inner">
        <small>摂取カロリー<br>見直し</small>
        <b><span id="meter-value">0</span><i>kcal</i></b>
        <em>※ゲーム内推定</em>
      </div>
    </div>
    <div class="boost-card"><span>水ブースト</span><b id="boost-value">—</b></div>
    <div class="desktop-hint">WASD / 矢印 移動 · ドラッグ 視点</div>
  </div>

  <div id="game-toast" class="game-toast hidden"></div>

  <div id="touch-controls" class="touch-controls hidden">
    <div id="joystick" class="joystick"><div id="joystick-knob"></div></div>
  </div>
`;

new Game();
