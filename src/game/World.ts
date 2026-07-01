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

// A wide, connected loop through every room. Furniture is deliberately kept
// outside this route so the fridge never gets trapped against a collider.
const waypoints = [
  new THREE.Vector3(-2.5, 0, 7.0),
  new THREE.Vector3(3.4, 0, 7.0),
  new THREE.Vector3(6.7, 0, 5.4),
  new THREE.Vector3(6.7, 0, 1.1),
  new THREE.Vector3(6.8, 0, -5.8),
  new THREE.Vector3(3.2, 0, -7.5),
  new THREE.Vector3(-1.2, 0, -7.5),
  new THREE.Vector3(-7.5, 0, -7.5),
  new THREE.Vector3(-7.7, 0, -2.4),
  new THREE.Vector3(-6.3, 0, 1.0),
  new THREE.Vector3(-6.1, 0, 5.5),
];

const openingEscapePath = [
  new THREE.Vector3(3.5, 0, 6.85),
  new THREE.Vector3(6.5, 0, 5.4),
  new THREE.Vector3(6.55, 0, 2.0),
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
  private waypointDirection: 1 | -1 = 1;
  private openingEscapeIndex = 0;
  private cameraYaw = -Math.PI / 2;
  private cameraPitch = 0.34;
  private clockTime = 0;
  private playerTorso!: THREE.Mesh;
  private playerBelly!: THREE.Mesh;
  private playerBelt!: THREE.Mesh;
  private playerArms: THREE.Object3D[] = [];
  private playerLegs: THREE.Object3D[] = [];
  private playerShoes: THREE.Object3D[] = [];

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
    this.openingEscapeIndex = 0;
    this.player.position.set(-4, 0, 6.85);
    this.player.rotation.y = -Math.PI / 2;
    this.fridge.position.set(0.8, 0, 6.85);
    this.fridge.rotation.set(0, 0, 0);
    this.player.visible = true;
    this.fridge.visible = true;
    this.setFridgeMood('smug');
    // Shoot across the open south corridor, away from the kitchen partition.
    const narrow = this.camera.aspect < 0.75;
    this.camera.position.set(narrow ? 1.2 : 3.6, narrow ? 3.5 : 3.9, narrow ? 9.15 : 9.2);
    this.camera.lookAt(narrow ? 1.2 : 0.3, narrow ? 0.4 : 1.25, narrow ? 6.35 : 6.2);
  }

  animateOpening(stage: number, dt: number) {
    this.clockTime += dt;
    if (stage <= 1) {
      this.player.position.x = Math.min(-1, this.player.position.x + dt * 0.65);
      this.player.rotation.y = -Math.PI / 2;
    }
    if (stage >= 5) {
      this.setFridgeMood(stage >= 11 ? 'worried' : 'smug');
      this.fridge.rotation.z = Math.sin(this.clockTime * 8) * 0.035;
    }
    if (stage >= 11 && this.openingEscapeIndex < openingEscapePath.length) {
      const target = openingEscapePath[this.openingEscapeIndex];
      const direction = target.clone().sub(this.fridge.position).setY(0);
      const remaining = direction.length();
      if (remaining < 0.12) {
        this.openingEscapeIndex += 1;
      } else {
        direction.normalize();
        this.fridge.position.addScaledVector(direction, Math.min(remaining, dt * 4.2));
        this.fridge.rotation.y = Math.atan2(direction.x, direction.z);
      }
    }
    this.animateCharacters(dt, false);
  }

  resetForGame(difficulty: Difficulty) {
    this.player.visible = true;
    this.fridge.visible = true;
    this.player.position.set(-4.2, 0, 7.0);
    this.fridge.position.set(2.5, 0, 7.0);
    this.fridge.rotation.set(0, 0, 0);
    this.player.rotation.set(0, 0, 0);
    this.setPlayerShape(0, true);
    this.waypointIndex = 1;
    this.waypointDirection = 1;
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
    if (playerDistance < 4.8) {
      const nextIndex = this.wrapWaypoint(this.waypointIndex + 1);
      const previousIndex = this.wrapWaypoint(this.waypointIndex - 1);
      const nextSafety = waypoints[nextIndex].distanceTo(this.player.position);
      const previousSafety = waypoints[previousIndex].distanceTo(this.player.position);
      this.waypointDirection = nextSafety >= previousSafety ? 1 : -1;
    }

    const target = waypoints[this.waypointIndex];
    const direction = target.clone().sub(this.fridge.position).setY(0);
    const calorieRate = clamp(calories / GAME_CONFIG.calories.maxForScaling, 0, 1);
    const escapeBurst =
      1 + clamp((5.5 - playerDistance) / 4, 0, 0.32) * (1 - calorieRate);
    const effectiveSpeed = speed * escapeBurst;
    if (direction.length() < 0.7) {
      this.waypointIndex = this.wrapWaypoint(this.waypointIndex + this.waypointDirection);
    } else {
      direction.normalize();
      const next = this.fridge.position.clone().addScaledVector(direction, effectiveSpeed * dt);
      if (this.canOccupy(next.x, next.z, 0.8)) {
        this.fridge.position.copy(next);
      } else {
        // Reversing keeps the fridge moving even if it is displaced into a
        // collider corner by future layout changes.
        this.waypointDirection = this.waypointDirection === 1 ? -1 : 1;
        this.waypointIndex = this.wrapWaypoint(this.waypointIndex + this.waypointDirection);
      }
      this.fridge.rotation.y = Math.atan2(direction.x, direction.z);
    }

    this.setFridgeMood(calorieRate > 0.68 ? 'worried' : calorieRate > 0.3 ? 'alert' : 'smug');
    this.animateCharacters(dt, true);
  }

  setPlayerShape(calories: number, immediate = false) {
    const rate = clamp(calories / GAME_CONFIG.calories.maxForScaling, 0, 1);
    const blend = immediate ? 1 : 0.055;
    const approach = (current: number, target: number) => lerp(current, target, blend);

    const bellyWidth = lerp(1.52, 0.78, rate);
    const bellyDepth = lerp(1.3, 0.76, rate);
    this.playerBelly.scale.x = approach(this.playerBelly.scale.x, bellyWidth);
    this.playerBelly.scale.y = approach(this.playerBelly.scale.y, lerp(1.12, 0.94, rate));
    this.playerBelly.scale.z = approach(this.playerBelly.scale.z, bellyDepth);
    this.playerBelly.position.y = approach(this.playerBelly.position.y, lerp(1.32, 1.38, rate));

    this.playerTorso.scale.x = approach(this.playerTorso.scale.x, lerp(1.08, 0.82, rate));
    this.playerTorso.scale.z = approach(this.playerTorso.scale.z, lerp(0.86, 0.72, rate));
    this.playerBelt.scale.x = approach(this.playerBelt.scale.x, lerp(1.38, 0.8, rate));
    this.playerBelt.scale.z = approach(this.playerBelt.scale.z, lerp(1.14, 0.72, rate));

    this.playerArms.forEach((arm, index) => {
      const side = index === 0 ? -1 : 1;
      arm.position.x = approach(arm.position.x, side * lerp(0.96, 0.67, rate));
      arm.rotation.z = approach(arm.rotation.z, side * lerp(-0.18, -0.05, rate));
    });
    this.playerLegs.forEach((leg, index) => {
      const side = index === 0 ? -1 : 1;
      leg.position.x = approach(leg.position.x, side * lerp(0.36, 0.25, rate));
    });
    this.playerShoes.forEach((shoe, index) => {
      const side = index === 0 ? -1 : 1;
      shoe.position.x = approach(shoe.position.x, side * lerp(0.36, 0.25, rate));
    });
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
    this.scene.add(new THREE.HemisphereLight('#9eb8ff', '#241a17', 1.35));
    const moon = new THREE.DirectionalLight('#b8d8ff', 2.6);
    moon.position.set(-8, 14, 7);
    moon.castShadow = true;
    this.scene.add(moon);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.MeshStandardMaterial({ color: '#654830', roughness: 0.92 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    for (let z = -9.5; z < 9.8; z += 0.72) {
      this.addBox(0, 0.012, z, 19.6, 0.018, 0.025, '#34281f');
    }
    for (let x = -8; x <= 8; x += 4) {
      this.addBox(x, 0.013, 0, 0.022, 0.02, 19.5, '#4b3828');
    }

    const kitchenFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(7.7, 7.2),
      new THREE.MeshStandardMaterial({ color: '#526675', roughness: 0.82 }),
    );
    kitchenFloor.rotation.x = -Math.PI / 2;
    kitchenFloor.position.set(5.9, 0.035, 5.9);
    kitchenFloor.receiveShadow = true;
    this.scene.add(kitchenFloor);
    const kitchenGrid = new THREE.GridHelper(7.2, 8, '#7f94a0', '#627885');
    kitchenGrid.position.set(5.9, 0.042, 5.9);
    this.scene.add(kitchenGrid);

    this.addWall(0, -10, 20, 0.35);
    this.addWall(0, 10, 20, 0.35);
    this.addWall(-10, 0, 0.35, 20);
    this.addWall(10, 0, 0.35, 20);

    // Wide openings preserve an uninterrupted chase route between rooms.
    this.addWall(1.55, 4.85, 0.22, 2.25);
    this.addWall(1.55, 1.0, 0.22, 1.8);
    this.addDoorFrame(1.55, 2.85, Math.PI / 2);
    this.addWall(-5.25, -1.35, 2.25, 0.2);
    this.addWall(-1.55, -1.35, 2.15, 0.2);
    this.addDoorFrame(-3.4, -1.35, 0);

    this.buildKitchen();
    this.buildLivingRoom();
    this.buildBedroom();
    this.buildDiningArea();
    this.addWindowsAndDecor();

    const livingLight = new THREE.PointLight('#ffd39a', 17, 10);
    livingLight.position.set(-4.8, 3.1, 4.8);
    this.scene.add(livingLight);
    const kitchenLight = new THREE.PointLight('#dcefff', 20, 10);
    kitchenLight.position.set(5.6, 3, 5.8);
    this.scene.add(kitchenLight);
    const bedroomLight = new THREE.PointLight('#9dafff', 10, 8);
    bedroomLight.position.set(-4.7, 2.8, -5.2);
    this.scene.add(bedroomLight);
  }

  private addWall(x: number, z: number, width: number, depth: number) {
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(width, 3.15, depth),
      new THREE.MeshStandardMaterial({ color: '#5d6980', roughness: 0.86 }),
    );
    wall.position.set(x, 1.575, z);
    wall.castShadow = true;
    wall.receiveShadow = true;
    this.scene.add(wall);
    const horizontal = width >= depth;
    this.addBox(
      x,
      0.08,
      z,
      horizontal ? width + 0.03 : Math.max(width, 0.12) + 0.06,
      0.13,
      horizontal ? Math.max(depth, 0.12) + 0.06 : depth + 0.03,
      '#d4c6ad',
    );
    this.colliders.push({
      minX: x - width / 2,
      maxX: x + width / 2,
      minZ: z - depth / 2,
      maxZ: z + depth / 2,
    });
  }

  private addFurniture(
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    color: string,
    collidable = true,
  ) {
    const furniture = this.addBox(x, y + height / 2, z, width, height, depth, color);
    if (collidable) {
      this.colliders.push({
        minX: x - width / 2,
        maxX: x + width / 2,
        minZ: z - depth / 2,
        maxZ: z + depth / 2,
      });
    }
    return furniture;
  }

  private buildKitchen() {
    const cabinet = '#8da0a8';
    const cabinetDark = '#51646e';
    const counter = '#d8d4c8';

    this.addFurniture(8.72, 0, 5.25, 1.15, 0.9, 6.25, cabinet);
    this.addFurniture(5.55, 0, 8.72, 5.2, 0.9, 1.15, cabinet);
    this.addBox(8.68, 0.94, 5.25, 1.25, 0.11, 6.35, counter);
    this.addBox(5.55, 0.94, 8.68, 5.3, 0.11, 1.25, counter);

    // Cabinet doors, handles, sink and stove.
    for (const z of [3.15, 4.55, 5.95, 7.35]) {
      this.addBox(8.1, 0.47, z, 0.035, 0.65, 1.02, cabinetDark);
      this.addBox(8.06, 0.5, z, 0.035, 0.06, 0.35, '#d8e2e5');
    }
    for (const x of [3.8, 5.15, 6.5, 7.85]) {
      this.addBox(x, 0.47, 8.08, 1.08, 0.65, 0.035, cabinetDark);
      this.addBox(x, 0.5, 8.04, 0.35, 0.06, 0.035, '#d8e2e5');
    }
    this.addBox(8.55, 1.02, 4.5, 0.82, 0.035, 1.3, '#263843');
    const faucet = new THREE.Mesh(
      new THREE.TorusGeometry(0.22, 0.035, 7, 14, Math.PI),
      new THREE.MeshStandardMaterial({ color: '#c4d0d5', metalness: 0.7, roughness: 0.25 }),
    );
    faucet.rotation.y = Math.PI / 2;
    faucet.position.set(8.25, 1.25, 4.5);
    this.scene.add(faucet);

    const stove = this.addBox(5.1, 1.02, 8.55, 1.45, 0.045, 0.82, '#18252d');
    for (const x of [-0.43, 0.43]) {
      for (const z of [-0.23, 0.23]) {
        const burner = new THREE.Mesh(
          new THREE.TorusGeometry(0.18, 0.025, 8, 16),
          new THREE.MeshStandardMaterial({ color: '#87949a', roughness: 0.45 }),
        );
        burner.rotation.x = Math.PI / 2;
        burner.position.set(5.1 + x, 1.055, 8.55 + z);
        this.scene.add(burner);
      }
    }
    stove.castShadow = true;

    for (const z of [4.3, 6.4]) {
      this.addFurniture(9.05, 1.42, z, 0.55, 0.85, 1.65, '#718691', false);
    }
    this.addBox(6.45, 2.65, 9.72, 2.2, 0.24, 0.08, '#cad8dc');
    this.addBox(6.45, 2.65, 9.66, 1.75, 0.09, 0.04, '#8ca5af');
  }

  private buildLivingRoom() {
    const rug = new THREE.Mesh(
      new THREE.PlaneGeometry(4.7, 3.5),
      new THREE.MeshStandardMaterial({ color: '#7c5361', roughness: 1 }),
    );
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(-4.25, 0.045, 4.1);
    this.scene.add(rug);
    for (const x of [-5.9, -4.25, -2.6]) {
      this.addBox(x, 0.052, 4.1, 0.045, 0.01, 3.15, '#b78388');
    }

    this.addFurniture(-8.75, 0, 4.25, 1.25, 0.62, 3.45, '#3e6d72');
    this.addFurniture(-9.18, 0.42, 4.25, 0.45, 1.15, 3.45, '#31575d', false);
    for (const z of [3.35, 5.15]) {
      const cushion = this.addFurniture(-8.3, 0.56, z, 0.72, 0.5, 1.38, '#5b8c8c', false);
      cushion.rotation.z = -0.08;
    }
    this.addFurniture(-4.25, 0, 4.05, 2.15, 0.42, 1.0, '#6f4931');
    this.addBox(-4.25, 0.47, 4.05, 2.3, 0.12, 1.12, '#ac7a4e');

    this.addFurniture(-4.8, 0, 8.95, 3.2, 0.5, 0.65, '#4e362a');
    this.addBox(-4.8, 1.35, 9.52, 2.65, 1.4, 0.08, '#111b28');
    this.addBox(-4.8, 1.35, 9.45, 2.35, 1.12, 0.03, '#355476');
    this.addBox(-4.8, 0.75, 9.45, 0.16, 0.7, 0.12, '#26313c');

  }

  private buildBedroom() {
    this.addFurniture(-4.65, 0, -5.25, 3.05, 0.46, 2.45, '#725244');
    this.addFurniture(-4.65, 0.44, -5.15, 2.82, 0.34, 2.15, '#d7d0c2', false);
    this.addFurniture(-4.65, 0.73, -6.05, 2.82, 0.18, 0.72, '#e8e2d8', false);
    this.addFurniture(-4.65, 0.7, -4.88, 2.86, 0.08, 1.25, '#7085a5', false);

    this.addFurniture(-9.05, 0, -4.45, 1.05, 2.45, 2.65, '#58463c');
    for (const z of [-5.1, -3.8]) {
      this.addBox(-8.49, 1.28, z, 0.035, 2.05, 1.08, '#6b574a');
      this.addBox(-8.45, 1.28, z, 0.035, 0.08, 0.25, '#c2a471');
    }

    this.addFurniture(-0.6, 0, -9.0, 2.8, 0.75, 0.72, '#5f4432');
    for (const x of [-1.65, 0.45]) {
      this.addBox(x, 0.37, -8.65, 0.12, 0.74, 0.12, '#3f3028');
    }
    this.addBox(-0.6, 1.25, -9.55, 1.45, 1.05, 0.05, '#17283b');
    this.addBox(-0.6, 1.25, -9.51, 1.18, 0.8, 0.03, '#4e6d8d');
  }

  private buildDiningArea() {
    this.addFurniture(3.75, 0, -2.65, 2.65, 0.72, 1.45, '#765239');
    this.addBox(3.75, 0.78, -2.65, 2.82, 0.12, 1.6, '#aa7950');
    for (const x of [2.75, 4.75]) {
      for (const z of [-3.65, -1.65]) {
        this.addFurniture(x, 0, z, 0.62, 0.48, 0.62, '#4d6267', false);
        this.addBox(x, 0.88, z + (z < -2.65 ? -0.22 : 0.22), 0.62, 0.85, 0.16, '#607980');
      }
    }
    const bowl = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#d7885b', side: THREE.DoubleSide }),
    );
    bowl.scale.y = 0.45;
    bowl.position.set(3.75, 0.92, -2.65);
    this.scene.add(bowl);
  }

  private addWindowsAndDecor() {
    const glass = new THREE.MeshStandardMaterial({
      color: '#284a75',
      emissive: '#1b3c72',
      emissiveIntensity: 1.5,
      roughness: 0.25,
    });
    for (const x of [-5.8, 5.5]) {
      const pane = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.35, 0.05), glass);
      pane.position.set(x, 2.05, -9.78);
      this.scene.add(pane);
      this.addBox(x, 2.05, -9.73, 0.08, 1.48, 0.08, '#d8d2c5');
      this.addBox(x, 2.05, -9.73, 2.95, 0.08, 0.08, '#d8d2c5');
    }

    this.addBox(-9.77, 2.05, 0.1, 0.05, 1.4, 2.6, '#31537b');
    this.addBox(-9.72, 2.05, 0.1, 0.08, 0.08, 2.72, '#d8d2c5');
    this.addBox(-9.72, 2.05, 0.1, 0.08, 1.52, 0.08, '#d8d2c5');

    this.addBox(-2.15, 1.95, -1.23, 1.35, 0.92, 0.06, '#c79a53');
    this.addBox(-2.15, 1.95, -1.18, 1.08, 0.66, 0.04, '#496c78');
    this.addBox(1.66, 2.02, 4.75, 0.06, 1.0, 1.35, '#d9ae68');
    this.addBox(1.61, 2.02, 4.75, 0.04, 0.76, 1.05, '#765d80');

    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.26, 0.52, 12),
      new THREE.MeshStandardMaterial({ color: '#b36d4c', roughness: 0.82 }),
    );
    pot.position.set(0.15, 0.26, 0.15);
    this.scene.add(pot);
    for (const offset of [-0.24, 0, 0.24]) {
      const leaf = new THREE.Mesh(
        new THREE.SphereGeometry(0.31, 12, 9),
        new THREE.MeshStandardMaterial({ color: '#4d8b68', roughness: 0.9 }),
      );
      leaf.scale.set(0.65, 1.45, 0.55);
      leaf.position.set(0.15 + offset, 0.88 + Math.abs(offset), 0.15);
      leaf.rotation.z = offset * 1.7;
      this.scene.add(leaf);
    }
  }

  private addDoorFrame(x: number, z: number, rotation: number) {
    const verticalWall = Math.abs(rotation) > 0.1;
    const color = '#c7a979';
    if (verticalWall) {
      this.addBox(x, 1.18, z - 0.88, 0.28, 2.35, 0.18, color);
      this.addBox(x, 1.18, z + 0.88, 0.28, 2.35, 0.18, color);
      this.addBox(x, 2.37, z, 0.28, 0.18, 1.95, color);
    } else {
      this.addBox(x - 0.88, 1.18, z, 0.18, 2.35, 0.28, color);
      this.addBox(x + 0.88, 1.18, z, 0.18, 2.35, 0.28, color);
      this.addBox(x, 2.37, z, 1.95, 0.18, 0.28, color);
    }
  }

  private addBox(
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    color: string,
  ) {
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshStandardMaterial({ color, roughness: 0.78 }),
    );
    box.position.set(x, y, z);
    box.castShadow = height > 0.08;
    box.receiveShadow = true;
    this.scene.add(box);
    return box;
  }

  private buildPlayer() {
    const skin = new THREE.MeshStandardMaterial({ color: '#f2b58f', roughness: 0.7 });
    const shirt = new THREE.MeshStandardMaterial({ color: '#f0a65b', roughness: 0.75 });
    const pants = new THREE.MeshStandardMaterial({ color: '#233a61', roughness: 0.8 });
    const shoes = new THREE.MeshStandardMaterial({ color: '#17223a', roughness: 0.7 });

    this.playerTorso = new THREE.Mesh(new THREE.SphereGeometry(0.62, 22, 16), shirt);
    this.playerTorso.scale.set(1.08, 1.12, 0.86);
    this.playerTorso.position.y = 1.85;
    this.playerTorso.castShadow = true;

    this.playerBelly = new THREE.Mesh(new THREE.SphereGeometry(0.7, 24, 18), shirt);
    this.playerBelly.scale.set(1.52, 1.12, 1.3);
    this.playerBelly.position.set(0, 1.32, 0.09);
    this.playerBelly.castShadow = true;

    this.playerBelt = new THREE.Mesh(
      new THREE.TorusGeometry(0.64, 0.055, 8, 24),
      new THREE.MeshStandardMaterial({ color: '#263249', roughness: 0.68 }),
    );
    this.playerBelt.rotation.x = Math.PI / 2;
    this.playerBelt.position.set(0, 1.03, 0.04);
    this.playerBelt.castShadow = true;

    this.playerBody.add(this.playerTorso, this.playerBelly, this.playerBelt);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.38, 18, 14), skin);
    head.position.y = 2.72;
    head.castShadow = true;
    this.player.add(head);

    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.39, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
      new THREE.MeshStandardMaterial({ color: '#342824', roughness: 0.9 }),
    );
    hair.position.y = 2.83;
    hair.rotation.x = -0.2;
    this.player.add(hair);

    this.playerArms = [];
    this.playerLegs = [];
    this.playerShoes = [];
    for (const side of [-1, 1] as const) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.7, 6, 10), skin);
      arm.position.set(side * 0.96, 1.5, 0);
      arm.rotation.z = side * -0.18;
      arm.castShadow = true;
      this.player.add(arm);
      this.playerArms.push(arm);

      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.62, 6, 12), pants);
      leg.position.set(side * 0.36, 0.48, 0);
      leg.castShadow = true;
      this.player.add(leg);
      this.playerLegs.push(leg);

      const shoe = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), shoes);
      shoe.scale.set(1, 0.55, 1.45);
      shoe.position.set(side * 0.36, 0.16, 0.1);
      shoe.castShadow = true;
      this.player.add(shoe);
      this.playerShoes.push(shoe);
    }
    this.player.add(this.playerBody);
    this.setPlayerShape(0, true);

    const marker = new THREE.Mesh(
      new THREE.RingGeometry(0.78, 0.9, 32),
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
      [-2.3, 5.4], [4.7, 6.7], [6.7, 3.0], [6.7, -4.8],
      [2.0, -7.2], [-2.0, -7.2], [-7.4, -2.0], [-6.1, 2.2],
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

  private wrapWaypoint(index: number) {
    return (index + waypoints.length) % waypoints.length;
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
