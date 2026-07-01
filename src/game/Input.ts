import * as THREE from 'three';

type JoystickState = {
  pointerId: number;
  originX: number;
  originY: number;
};

export class Input {
  private keys = new Set<string>();
  private move = new THREE.Vector2();
  private lookDelta = new THREE.Vector2();
  private joystick: JoystickState | null = null;
  private lookPointerId: number | null = null;
  private lookLast = new THREE.Vector2();
  private boostPressed = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private joystickZone: HTMLElement,
    private joystickKnob: HTMLElement,
    private boostButton: HTMLElement,
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    canvas.addEventListener('pointerdown', this.onCanvasDown);
    canvas.addEventListener('pointermove', this.onCanvasMove);
    canvas.addEventListener('pointerup', this.onCanvasUp);
    canvas.addEventListener('pointercancel', this.onCanvasUp);
    joystickZone.addEventListener('pointerdown', this.onJoystickDown);
    joystickZone.addEventListener('pointermove', this.onJoystickMove);
    joystickZone.addEventListener('pointerup', this.onJoystickUp);
    joystickZone.addEventListener('pointercancel', this.onJoystickUp);
    boostButton.addEventListener('pointerdown', this.onBoostDown);
    boostButton.addEventListener('pointerup', this.onBoostUp);
    boostButton.addEventListener('pointercancel', this.onBoostUp);
    window.addEventListener('blur', this.reset);
  }

  getMovement(): THREE.Vector2 {
    const keyboard = new THREE.Vector2(
      Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) -
        Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft')),
      Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) -
        Number(this.keys.has('KeyS') || this.keys.has('ArrowDown')),
    );
    if (keyboard.lengthSq() > 0) return keyboard.normalize();
    return this.move.clone();
  }

  getLookDelta(): THREE.Vector2 {
    const value = this.lookDelta.clone();
    this.lookDelta.set(0, 0);
    return value;
  }

  isDashActive() {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.boostPressed;
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.canvas.removeEventListener('pointerdown', this.onCanvasDown);
    this.canvas.removeEventListener('pointermove', this.onCanvasMove);
    this.canvas.removeEventListener('pointerup', this.onCanvasUp);
    this.joystickZone.removeEventListener('pointerdown', this.onJoystickDown);
    this.joystickZone.removeEventListener('pointermove', this.onJoystickMove);
    this.joystickZone.removeEventListener('pointerup', this.onJoystickUp);
    this.boostButton.removeEventListener('pointerdown', this.onBoostDown);
    window.removeEventListener('blur', this.reset);
  }

  private onKeyDown = (event: KeyboardEvent) => {
    this.keys.add(event.code);
  };

  private onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
  };

  private onCanvasDown = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.clientX < window.innerWidth * 0.4 && event.pointerType !== 'mouse') return;
    this.lookPointerId = event.pointerId;
    this.lookLast.set(event.clientX, event.clientY);
    this.canvas.setPointerCapture(event.pointerId);
  };

  private onCanvasMove = (event: PointerEvent) => {
    if (event.pointerId !== this.lookPointerId) return;
    this.lookDelta.x += event.clientX - this.lookLast.x;
    this.lookDelta.y += event.clientY - this.lookLast.y;
    this.lookLast.set(event.clientX, event.clientY);
  };

  private onCanvasUp = (event: PointerEvent) => {
    if (event.pointerId === this.lookPointerId) this.lookPointerId = null;
  };

  private onJoystickDown = (event: PointerEvent) => {
    event.stopPropagation();
    const rect = this.joystickZone.getBoundingClientRect();
    this.joystick = {
      pointerId: event.pointerId,
      originX: rect.left + rect.width / 2,
      originY: rect.top + rect.height / 2,
    };
    this.joystickZone.setPointerCapture(event.pointerId);
    this.updateJoystick(event.clientX, event.clientY);
  };

  private onJoystickMove = (event: PointerEvent) => {
    if (event.pointerId === this.joystick?.pointerId) {
      this.updateJoystick(event.clientX, event.clientY);
    }
  };

  private onJoystickUp = (event: PointerEvent) => {
    if (event.pointerId !== this.joystick?.pointerId) return;
    this.joystick = null;
    this.move.set(0, 0);
    this.joystickKnob.style.transform = 'translate(0, 0)';
  };

  private updateJoystick(x: number, y: number) {
    if (!this.joystick) return;
    const delta = new THREE.Vector2(x - this.joystick.originX, y - this.joystick.originY);
    const maxDistance = 42;
    if (delta.length() > maxDistance) delta.setLength(maxDistance);
    this.move.set(delta.x / maxDistance, -delta.y / maxDistance);
    this.joystickKnob.style.transform = `translate(${delta.x}px, ${delta.y}px)`;
  }

  private onBoostDown = (event: PointerEvent) => {
    event.stopPropagation();
    this.boostPressed = true;
    this.boostButton.classList.add('is-active');
  };

  private onBoostUp = () => {
    this.boostPressed = false;
    this.boostButton.classList.remove('is-active');
  };

  private reset = () => {
    this.keys.clear();
    this.move.set(0, 0);
    this.boostPressed = false;
  };
}
