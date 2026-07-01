import * as THREE from 'three';
import { clamp, DIFFICULTY_SETTINGS, GAME_CONFIG, lerp, type Difficulty } from '../config';

type Item = {
  mesh: THREE.Group;
  collected: boolean;
};

type BoxCollider = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

const waypoints = [
  new THREE.Vector3(7, 0, 7),
  new THREE.Vector3(7, 0, 0),
  new THREE.Vector3(7, 0, -7),
  new THREE.Vector3(0, 0, -7),
  new THREE.Vector3(-7, 0, -7),
  new THREE.Vector3(-7, 0, 0),
  new THREE.Vector3(-7, 0, 7),
  new THREE.Vector3(0, 0, 7),
];

export class World {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  readonly player = new THREE.Group();
  readonly fridge = new THREE.Group();

  private playerBody = new THREE.Group();
  private fridgeFace = new THREE.Group();
  private items: Item[] = [];
  private colliders: BoxCollider[] = [];
  private waypointIndex = 0;
  private cameraYaw = -Math.PI / 2;
  private cameraPitch = 0.34;
  private clockTime = 0;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.scene.background = new THREE.Color('#07101f');
    this.scene.fog = new THREE.Fog('#07101f', 15, 38);
    this.buildHouse();
    this.buildPlayer();
    this.buildFridge();
    this.scene.add(this.player, this.fridge);
    this.resize();
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  }

  resetForOpening() {
    this.clearItems();
    this.player.position.set(-3.8, 0, 4.2);
    this.player.rotation.y = -Math.PI / 2;
    this.fridge.position.set(1.5, 0, 4.2);
    this.fridge.rotation.y = 0;
    this.player.visible = true;
    this.fridge.visible = true;
    this.setFridgeMood('smug');
    // Keep the camera inside the south wall. On narrow screens, frame the fridge
    // near the center because the menu occupies the lower half of the screen.
    const narrow = this.camera.aspect < 0.75;
    this.camera.position.set(narrow ? 1.4 : -0.5, 3.4, 8.8);
    this.camera.lookAt(narrow ? 1.4 : -0.5, narrow ? 0.25 : 1.3, narrow ? 4.2 : 3.4);
  }

  animateOpening(stage: number, dt: number) {
    this.clockTime += dt;
    if (stage <= 1) {
      this.player.position.x = Math.min(-1, this.player.position.x + dt * 0.65);
      this.player.rotation.y = -Math.PI / 2;
    }
    if (stage >= 4) {
      this.setFridgeMood(stage >= 6 ? 'worried' : 'smug');
      this.fridge.rotation.z = Math.sin(this.clockTime * 8) * 0.035;
    }
    if (stage >= 7) {
      this.fridge.position.x += dt * 4;
      this.fridge.rotation.y = Math.PI / 2;
    }
    this.animateCharacters(dt, false);
  }

  resetForGame(difficulty: Difficulty) {
    this.player.visible = true;
    this.fridge.visible = true;
    this.player.position.set(-3, 0, 7);
    this.fridge.position.set(3.5, 0, 7);
    this.fridge.rotation.set(0, 0, 0);
    this.player.rotation.set(0, 0, 0);
    this.playerBody.scale.set(1.25, 1, 1.25);
    this.waypointIndex = 0;
    // Start directly behind the player, facing the fridge along the first corridor.
    this.cameraYaw = -Math.PI / 2;
    this.cameraPitch = 0.34;
    this.setFridgeMood('smug');
    this.spawnItems(DIFFICULTY_SETTINGS[difficulty].itemCount);
    this.updateCamera(0, 0, true);
  }

  updateCamera(deltaX: number, deltaY: number, immediate = false) {
    this.cameraYaw -= deltaX * 0.005;
    this.cameraPitch = clamp(this.cameraPitch + deltaY * 0.003, 0.12, 0.72);
    const distance = 6.2;
    const target = this.player.position.clone().add(new THREE.Vector3(0, 1.35, 0));
    const offset = new THREE.Vector3(
      Math.sin(this.cameraYaw) * Math.cos(this.cameraPitch) * distance,
      Math.sin(this.cameraPitch) * distance + 0.6,
      Math.cos(this.cameraYaw) * Math.cos(this.cameraPitch) * distance,
    );
    const desired = target.clone().add(offset);
    // Keep the third-person camera inside the outer walls. This is a lightweight
    // wall-clipping guard suitable for the rectangular prototype house.
    desired.x = clamp(desired.x, -9.35, 9.35);
    desired.z = clamp(desired.z, -9.35, 9.35);
    if (immediate) this.camera.position.copy(desired);
    else this.camera.position.lerp(desired, 0.16);
    this.camera.lookAt(target);
  }

  movePlayer(inputX: number, inputY: number, distance: number) {
    if (Math.abs(inputX) + Math.abs(inputY) < 0.01) return false;
    const forward = new THREE.Vector3(-Math.sin(this.cameraYaw), 0, -Math.cos(this.cameraYaw));
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const direction = forward.multiplyScalar(inputY).add(right.multiplyScalar(inputX)).normalize();
    const next = this.player.position.clone().addScaledVector(direction, distance);
    if (this.canOccupy(next.x, this.player.position.z, GAME_CONFIG.player.radius)) {
      this.player.position.x = next.x;
    }
    if (this.canOccupy(this.player.position.x, next.z, GAME_CONFIG.player.radius)) {
      this.player.position.z = next.z;
    }
    this.player.rotation.y = Math.atan2(direction.x, direction.z);
    return true;
  }

  updateFridge(dt: number, speed: number, calories: number) {
    const playerDistance = this.player.position.distanceTo(this.fridge.position);
    if (playerDistance < 4.2) {
      const away = this.fridge.position.clone().sub(this.player.position).setY(0).normalize();
      let bestIndex = this.waypointIndex;
      let bestScore = -Infinity;
      waypoints.forEach((point, index) => {
        const score = point.distanceTo(this.player.position) - point.distanceTo(this.fridge.position) * 0.18;
        if (score > bestScore) {
          bestScore = score;
          bestIndex = index;
        }
      });
      this.waypointIndex = bestIndex;
      if (away.lengthSq() > 0) this.fridge.rotation.y = Math.atan2(away.x, away.z);
    }

    const target = waypoints[this.waypointIndex];
    const direction = target.clone().sub(this.fridge.position).setY(0);
    if (direction.length() < 0.7) {
      this.waypointIndex = (this.waypointIndex + 1) % waypoints.length;
    } else {
      direction.normalize();
      const next = this.fridge.position.clone().addScaledVector(direction, speed * dt);
      if (this.canOccupy(next.x, next.z, 0.8)) {
        this.fridge.position.copy(next);
      } else {
        this.waypointIndex = (this.waypointIndex + 1) % waypoints.length;
      }
      this.fridge.rotation.y = Math.atan2(direction.x, direction.z);
    }

    const rate = clamp(calories / GAME_CONFIG.calories.maxForScaling, 0, 1);
    this.setFridgeMood(rate > 0.68 ? 'worried' : rate > 0.3 ? 'alert' : 'smug');
    this.animateCharacters(dt, true);
  }

  setPlayerShape(calories: number) {
    const rate = clamp(calories / GAME_CONFIG.calories.maxForScaling, 0, 1);
    const width = lerp(1.25, 0.92, rate);
    this.playerBody.scale.x = lerp(this.playerBody.scale.x, width, 0.04);
    this.playerBody.scale.z = lerp(this.playerBody.scale.z, width, 0.04);
  }

  collectNearbyItems(): number {
    let collected = 0;
    for (const item of this.items) {
      if (!item.collected && item.mesh.position.distanceTo(this.player.position) < 1.25) {
        item.collected = true;
        item.mesh.visible = false;
        collected += 1;
      }
    }
    return collected;
  }

  updateItems(dt: number) {
    this.clockTime += dt;
    for (const item of this.items) {
      if (!item.collected) {
        item.mesh.rotation.y += dt * 1.8;
        item.mesh.position.y = 0.75 + Math.sin(this.clockTime * 3 + item.mesh.position.x) * 0.12;
      }
    }
  }

  getDistance() {
    return this.player.position.distanceTo(this.fridge.position);
  }

  getCameraYaw() {
    return this.cameraYaw;
  }

  dispose() {
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      }
    });
  }

  private buildHouse() {
    this.scene.add(new THREE.HemisphereLight('#9eb8ff', '#162238', 1.75));
    const moon = new THREE.DirectionalLight('#b8d8ff', 2.6);
    moon.position.set(-8, 14, 7);
    moon.castShadow = true;
    this.scene.add(moon);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.MeshStandardMaterial({ color: '#263751', roughness: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const grid = new THREE.GridHelper(20, 20, '#3e5a78', '#304760');
    grid.position.y = 0.01;
    this.scene.add(grid);

    this.addWall(0, -10, 20, 0.35);
    this.addWall(0, 10, 20, 0.35);
    this.addWall(-10, 0, 0.35, 20);
    this.addWall(10, 0, 0.35, 20);
    this.addWall(0, 2.2, 7, 0.28);
    this.addWall(0, -2.2, 7, 0.28);

    this.addFurniture(-6.8, 0, -0.4, 3.2, 1.3, '#5e4660');
    this.addFurniture(6.7, 0, 0.5, 3.1, 1.2, '#214e57');
    this.addFurniture(0, 0, -7.8, 2.8, 1.1, '#655139');
    this.addFurniture(0, 0, 7.8, 2.8, 1.1, '#465a68');

    const rug = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 3),
      new THREE.MeshStandardMaterial({ color: '#414064', roughness: 1 }),
    );
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0, 0.025, 0);
    this.scene.add(rug);

    const windowGlow = new THREE.PointLight('#668dff', 18, 10);
    windowGlow.position.set(-8, 3, -6);
    this.scene.add(windowGlow);
  }

  private addWall(x: number, z: number, width: number, depth: number) {
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(width, 3.5, depth),
      new THREE.MeshStandardMaterial({ color: '#42536b', roughness: 0.82 }),
    );
    wall.position.set(x, 1.75, z);
    wall.castShadow = true;
    wall.receiveShadow = true;
    this.scene.add(wall);
    this.colliders.push({
      minX: x - width / 2,
      maxX: x + width / 2,
      minZ: z - depth / 2,
      maxZ: z + depth / 2,
    });
  }

  private addFurniture(x: number, _y: number, z: number, width: number, depth: number, color: string) {
    const furniture = new THREE.Mesh(
      new THREE.BoxGeometry(width, 1.1, depth),
      new THREE.MeshStandardMaterial({ color, roughness: 0.78 }),
    );
    furniture.position.set(x, 0.55, z);
    furniture.castShadow = true;
    this.scene.add(furniture);
    this.colliders.push({
      minX: x - width / 2,
      maxX: x + width / 2,
      minZ: z - depth / 2,
      maxZ: z + depth / 2,
    });
  }

  private buildPlayer() {
    const skin = new THREE.MeshStandardMaterial({ color: '#f2b58f', roughness: 0.7 });
    const shirt = new THREE.MeshStandardMaterial({ color: '#f0a65b', roughness: 0.75 });
    const pants = new THREE.MeshStandardMaterial({ color: '#233a61', roughness: 0.8 });

    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.68, 20, 16), shirt);
    torso.scale.set(1, 1.25, 0.78);
    torso.position.y = 1.45;
    torso.castShadow = true;
    this.playerBody.add(torso);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.38, 18, 14), skin);
    head.position.y = 2.45;
    head.castShadow = true;
    this.player.add(head);

    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.62, 6, 12), pants);
      leg.position.set(side * 0.3, 0.48, 0);
      leg.castShadow = true;
      this.player.add(leg);
    }
    this.player.add(this.playerBody);

    const marker = new THREE.Mesh(
      new THREE.RingGeometry(0.7, 0.82, 32),
      new THREE.MeshBasicMaterial({ color: '#7df5c6', side: THREE.DoubleSide }),
    );
    marker.rotation.x = -Math.PI / 2;
    marker.position.y = 0.03;
    this.player.add(marker);
  }

  private buildFridge() {
    const white = new THREE.MeshStandardMaterial({ color: '#e8f1f4', roughness: 0.45 });
    const dark = new THREE.MeshStandardMaterial({ color: '#17202e', roughness: 0.5 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.35, 1.05), white);
    body.position.y = 1.45;
    body.castShadow = true;
    this.fridge.add(body);

    const seam = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.035, 0.04), dark);
    seam.position.set(0, 1.65, 0.54);
    this.fridge.add(seam);

    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), dark);
      eye.position.set(side * 0.28, 2.15, 0.57);
      eye.scale.y = 1.15;
      eye.name = `eye-${side}`;
      this.fridgeFace.add(eye);

      const foot = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.28, 4, 8), dark);
      foot.position.set(side * 0.42, 0.16, 0);
      foot.rotation.z = side * 0.18;
      foot.name = `foot-${side}`;
      this.fridge.add(foot);
    }

    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.08, 0.05), dark);
    mouth.position.set(0, 1.82, 0.58);
    mouth.name = 'mouth';
    this.fridgeFace.add(mouth);

    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.72, 0.09), dark);
    handle.position.set(0.54, 1.3, 0.59);
    this.fridge.add(handle, this.fridgeFace);

    const glow = new THREE.PointLight('#d7f8ff', 3, 4);
    glow.position.set(0, 2.3, 1);
    this.fridge.add(glow);
  }

  private setFridgeMood(mood: 'smug' | 'alert' | 'worried') {
    const mouth = this.fridgeFace.getObjectByName('mouth');
    const left = this.fridgeFace.getObjectByName('eye--1');
    const right = this.fridgeFace.getObjectByName('eye-1');
    if (!mouth || !left || !right) return;
    if (mood === 'smug') {
      mouth.rotation.z = -0.12;
      mouth.scale.set(1, 1, 1);
      left.scale.y = 0.55;
      right.scale.y = 1.1;
    } else if (mood === 'alert') {
      mouth.rotation.z = 0;
      mouth.scale.set(0.7, 1.4, 1);
      left.scale.y = 1.25;
      right.scale.y = 1.25;
    } else {
      mouth.rotation.z = 0;
      mouth.scale.set(0.55, 2.5, 1);
      left.scale.y = 1.6;
      right.scale.y = 1.6;
    }
  }

  private animateCharacters(dt: number, running: boolean) {
    this.clockTime += dt;
    const pace = running ? 10 : 3;
    this.fridge.position.y = Math.abs(Math.sin(this.clockTime * pace)) * (running ? 0.1 : 0.025);
    for (const side of [-1, 1]) {
      const foot = this.fridge.getObjectByName(`foot-${side}`);
      if (foot) foot.rotation.x = Math.sin(this.clockTime * pace + side) * (running ? 0.5 : 0.08);
    }
  }

  private spawnItems(count: number) {
    this.clearItems();
    const positions = [
      [-3, 5.2], [5, 7], [8, 4], [7, -4],
      [4, -7], [-4, -7], [-8, -4], [-7, 4],
    ];
    for (let i = 0; i < count; i += 1) {
      const [x, z] = positions[i];
      const item = new THREE.Group();
      const bottle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22, 0.26, 0.75, 12),
        new THREE.MeshStandardMaterial({
          color: i % 2 ? '#88f2bd' : '#59c7ff',
          emissive: i % 2 ? '#174c34' : '#123f59',
          emissiveIntensity: 0.7,
        }),
      );
      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.13, 0.13, 0.13, 12),
        new THREE.MeshStandardMaterial({ color: '#e9faff' }),
      );
      cap.position.y = 0.44;
      item.add(bottle, cap);
      item.position.set(x, 0.75, z);
      this.scene.add(item);
      this.items.push({ mesh: item, collected: false });
    }
  }

  private clearItems() {
    for (const item of this.items) this.scene.remove(item.mesh);
    this.items = [];
  }

  private canOccupy(x: number, z: number, radius: number) {
    if (x < -9.3 || x > 9.3 || z < -9.3 || z > 9.3) return false;
    return !this.colliders.some(
      (box) =>
        x + radius > box.minX &&
        x - radius < box.maxX &&
        z + radius > box.minZ &&
        z - radius < box.maxZ,
    );
  }
}
