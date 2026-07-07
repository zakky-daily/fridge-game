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

type CameraOccluder = {
  collider: BoxCollider;
  mesh: THREE.Mesh;
  material: THREE.Material & {
    opacity: number;
    transparent: boolean;
    depthWrite: boolean;
  };
  baseOpacity: number;
  baseTransparent: boolean;
  baseDepthWrite: boolean;
};

type NavigationNode = {
  id: string;
  position: THREE.Vector3;
  links: string[];
};

const navigationNodes: NavigationNode[] = [
  { id: 'south-west', position: new THREE.Vector3(-7.2, 0, 7), links: ['south-mid', 'living-west'] },
  { id: 'south-mid', position: new THREE.Vector3(-1.2, 0, 7), links: ['south-west', 'south-east', 'living-east', 'center-north'] },
  { id: 'south-east', position: new THREE.Vector3(3, 0, 7), links: ['south-mid', 'kitchen-east', 'kitchen-door'] },
  { id: 'kitchen-east', position: new THREE.Vector3(6.8, 0, 7), links: ['south-east', 'kitchen-mid'] },
  { id: 'kitchen-mid', position: new THREE.Vector3(6.8, 0, 4.5), links: ['kitchen-east', 'kitchen-door', 'east-center'] },
  { id: 'kitchen-door', position: new THREE.Vector3(3.2, 0, 2.85), links: ['south-east', 'kitchen-mid', 'center-north', 'dining-north'] },
  { id: 'center-north', position: new THREE.Vector3(0, 0, 2.85), links: ['south-mid', 'kitchen-door', 'living-east', 'center'] },
  { id: 'living-east', position: new THREE.Vector3(-2, 0, 5.8), links: ['south-mid', 'center-north', 'living-west'] },
  { id: 'living-west', position: new THREE.Vector3(-6.6, 0, 5.8), links: ['south-west', 'living-east', 'living-south'] },
  { id: 'living-south', position: new THREE.Vector3(-6.8, 0, 2), links: ['living-west', 'bedroom-entry', 'left-passage'] },
  { id: 'left-passage', position: new THREE.Vector3(-7.05, 0, -1.35), links: ['living-south', 'bedroom-west'] },
  { id: 'bedroom-entry', position: new THREE.Vector3(-3.4, 0, 0.2), links: ['living-south', 'bedroom-door', 'center'] },
  { id: 'bedroom-door', position: new THREE.Vector3(-3.4, 0, -2.7), links: ['bedroom-entry', 'bedroom-west', 'bedroom-mid'] },
  { id: 'bedroom-west', position: new THREE.Vector3(-7, 0, -2.7), links: ['bedroom-door', 'bedroom-south-west', 'left-passage'] },
  { id: 'bedroom-south-west', position: new THREE.Vector3(-7, 0, -5.5), links: ['bedroom-west', 'bedroom-mid'] },
  { id: 'bedroom-mid', position: new THREE.Vector3(-3, 0, -5.5), links: ['bedroom-door', 'bedroom-south-west', 'center-south'] },
  { id: 'center-south', position: new THREE.Vector3(0, 0, -5.5), links: ['bedroom-mid', 'dining-south-west', 'center-lower'] },
  { id: 'dining-south-west', position: new THREE.Vector3(1.2, 0, -4.5), links: ['center-south', 'dining-south-east'] },
  { id: 'dining-south-east', position: new THREE.Vector3(6.8, 0, -4.5), links: ['dining-south-west', 'east-center'] },
  { id: 'east-center', position: new THREE.Vector3(6.8, 0, 0), links: ['dining-south-east', 'kitchen-mid', 'dining-north'] },
  { id: 'dining-north', position: new THREE.Vector3(3.5, 0, 0), links: ['kitchen-door', 'east-center', 'center-east'] },
  { id: 'center-east', position: new THREE.Vector3(2.5, 0, -0.9), links: ['dining-north', 'center-lower'] },
  { id: 'center-lower', position: new THREE.Vector3(0, 0, -0.9), links: ['center-east', 'center', 'center-south'] },
  { id: 'center', position: new THREE.Vector3(0, 0, 0.2), links: ['center-lower', 'center-north', 'bedroom-entry'] },
];

const navigationNodeMap = new Map(navigationNodes.map((node) => [node.id, node]));

const openingEscapePath = [
  new THREE.Vector3(3.5, 0, 6.85),
  new THREE.Vector3(6.5, 0, 5.4),
  new THREE.Vector3(6.55, 0, 2.0),
];

const waterItemPositions: Array<[number, number]> = [
  [-2.3, 5.4],
  [4.7, 6.7],
  [6.7, 3.0],
  [6.7, -4.8],
  [2.0, -5.8],
  [-2.0, -5.8],
  [-7.4, -2.0],
  [-6.1, 2.2],
  [0.5, 4.8],
  [5.2, -0.8],
  [-5.0, 0.5],
  [1.0, -4.5],
];

export class World {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  readonly player = new THREE.Group();
  readonly fridge = new THREE.Group();

  private playerBody = new THREE.Group();
  private candyBoxFace = new THREE.Group();
  private candyShell = new THREE.Group();
  private candyPayload = new THREE.Group();
  private candyPieces: THREE.Object3D[] = [];
  private items: Item[] = [];
  private itemSpawnTimer = 4;
  private colliders: BoxCollider[] = [];
  private cameraOccluders: CameraOccluder[] = [];
  private candyShellRadius = 1.08;
  private candyCurrentNodeId = 'south-east';
  private candyTargetNodeId = 'kitchen-east';
  private candyPreviousNodeId: string | null = 'south-mid';
  private openingEscapeIndex = 0;
  private openingPlayerStopX = -1;
  private openingOrbitYaw = 0;
  private openingOrbitBaseYaw = 0;
  private openingOrbitPitch = 0.35;
  private openingOrbitDistance = 5;
  private cameraYaw = -Math.PI / 2;
  private cameraYawOffset = 0;
  private cameraPitch = 0.34;
  private playerFacingYaw = Math.PI / 2;
  private clockTime = 0;
  private playerBodyMesh!: THREE.Mesh;
  private playerBodyBasePositions = new Float32Array();
  private playerShapeRate = 0;
  private playerBelt!: THREE.Mesh;
  private playerArms: THREE.Object3D[] = [];
  private playerLegs: THREE.Object3D[] = [];
  private playerShoes: THREE.Object3D[] = [];

  constructor(private renderer: THREE.WebGLRenderer) {
    this.scene.background = new THREE.Color('#07101f');
    this.scene.fog = new THREE.Fog('#07101f', 15, 38);
    this.buildHouse();
    this.validateNavigationGraph();
    this.buildPlayer();
    this.buildCandyBox();
    this.scene.add(this.player, this.fridge);
    this.resize();
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.fov = this.camera.aspect < 0.75 ? 78 : 60;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  }

  resetForOpening() {
    this.clearItems();
    this.openingEscapeIndex = 0;
    const narrow = this.camera.aspect < 0.75;
    this.openingPlayerStopX = narrow ? -0.65 : -0.55;
    this.player.position.set(narrow ? -0.85 : -1.65, 0, 6.85);
    this.player.rotation.y = -Math.PI / 2;
    this.player.scale.setScalar(narrow ? 0.68 : 0.9);
    this.fridge.position.set(narrow ? 0.75 : 1.15, 0, 6.85);
    this.fridge.rotation.set(0, 0, 0);
    this.fridge.scale.setScalar(narrow ? 0.66 : 0.9);
    this.candyShell.rotation.set(0, 0, 0);
    this.player.visible = true;
    this.fridge.visible = true;
    this.setCandyBoxMood('smug');
    // Shoot across the open south corridor, away from the kitchen partition.
    this.camera.position.set(
      narrow ? this.player.position.x : 3.6,
      narrow ? 4.6 : 3.9,
      narrow ? 9.45 : 9.2,
    );
    const target = this.getOpeningCameraTarget();
    const offset = this.camera.position.clone().sub(target);
    this.openingOrbitDistance = offset.length();
    this.openingOrbitYaw = Math.atan2(offset.x, offset.z);
    this.openingOrbitBaseYaw = this.openingOrbitYaw;
    this.openingOrbitPitch = Math.asin(offset.y / this.openingOrbitDistance);
    this.updateOpeningLook(0, 0);
  }

  updateOpeningLook(deltaX: number, deltaY: number) {
    this.openingOrbitYaw = clamp(
      this.openingOrbitYaw - deltaX * 0.004,
      this.openingOrbitBaseYaw - 0.5,
      this.openingOrbitBaseYaw + 0.5,
    );
    this.openingOrbitPitch = clamp(this.openingOrbitPitch + deltaY * 0.003, 0.12, 0.78);
    const target = this.getOpeningCameraTarget();
    const horizontalDistance = Math.cos(this.openingOrbitPitch) * this.openingOrbitDistance;
    this.camera.position.set(
      target.x + Math.sin(this.openingOrbitYaw) * horizontalDistance,
      target.y + Math.sin(this.openingOrbitPitch) * this.openingOrbitDistance,
      target.z + Math.cos(this.openingOrbitYaw) * horizontalDistance,
    );
    this.camera.lookAt(target);
    this.updateCameraOccluders(target);
  }

  animateOpening(stage: number, dt: number) {
    this.clockTime += dt;
    if (stage <= 1) {
      this.player.position.x = Math.min(
        this.openingPlayerStopX,
        this.player.position.x + dt * 0.65,
      );
      this.player.rotation.y = -Math.PI / 2;
    }
    if (stage >= 5) {
      this.setCandyBoxMood(stage >= 11 ? 'worried' : 'smug');
    }
    if (stage >= 11 && this.openingEscapeIndex < openingEscapePath.length) {
      const target = openingEscapePath[this.openingEscapeIndex];
      const direction = target.clone().sub(this.fridge.position).setY(0);
      const remaining = direction.length();
      if (remaining < 0.12) {
        this.openingEscapeIndex += 1;
      } else {
        direction.normalize();
        const travel = Math.min(remaining, dt * 4.2);
        this.fridge.position.addScaledVector(direction, travel);
        this.rollCandyBox(direction, travel);
      }
    }
    this.animateCharacters(dt, false);
  }

  resetForGame(difficulty: Difficulty) {
    this.player.visible = true;
    this.fridge.visible = true;
    this.player.scale.setScalar(1);
    this.fridge.scale.setScalar(1);
    this.player.position.set(-4.2, 0, 7.0);
    this.fridge.position.set(2.5, 0, 7.0);
    this.fridge.rotation.set(0, 0, 0);
    this.candyShell.rotation.set(0, 0, 0);
    this.playerFacingYaw = Math.PI / 2;
    this.player.rotation.set(0, this.playerFacingYaw, 0);
    this.setPlayerShape(0, true);
    this.candyCurrentNodeId = 'south-east';
    this.candyTargetNodeId = 'kitchen-east';
    this.candyPreviousNodeId = 'south-mid';
    // Start directly behind the player, facing the fridge along the first corridor.
    this.cameraYaw = -Math.PI / 2;
    this.cameraYawOffset = 0;
    this.cameraPitch = 0.34;
    this.setCandyBoxMood('smug');
    this.spawnItems(DIFFICULTY_SETTINGS[difficulty].itemCount);
    this.updateCamera(0, 0, true, true);
  }

  updateCamera(deltaX: number, deltaY: number, moveInputActive: boolean, immediate = false) {
    const hasLookInput = Math.abs(deltaX) + Math.abs(deltaY) > 0.001;
    if (hasLookInput) {
      this.cameraYawOffset = clamp(this.cameraYawOffset - deltaX * 0.0018, -0.48, 0.48);
      this.cameraPitch = clamp(this.cameraPitch + deltaY * 0.0016, 0.18, 0.62);
    }
    if (immediate || moveInputActive || hasLookInput) {
      this.cameraYaw = this.playerFacingYaw + Math.PI + this.cameraYawOffset;
    }
    const distance = 6.2;
    const target = this.player.position.clone().add(new THREE.Vector3(0, 1.35, 0));
    const offset = new THREE.Vector3(
      Math.sin(this.cameraYaw) * Math.cos(this.cameraPitch) * distance,
      Math.sin(this.cameraPitch) * distance,
      Math.cos(this.cameraYaw) * Math.cos(this.cameraPitch) * distance,
    );
    const desired = target.clone().add(offset);
    this.camera.position.copy(desired);
    this.camera.lookAt(target);
    this.updateCameraOccluders(target);
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
    this.playerFacingYaw = Math.atan2(direction.x, direction.z);
    this.player.rotation.y = this.playerFacingYaw;
    return true;
  }

  updateFridge(dt: number, speed: number, calories: number) {
    const playerDistance = this.player.position.distanceTo(this.fridge.position);
    const target = this.requireNavigationNode(this.candyTargetNodeId).position;
    const direction = target.clone().sub(this.fridge.position).setY(0);
    const calorieRate = clamp(calories / GAME_CONFIG.calories.maxForScaling, 0, 1);
    const escapeBurst =
      1 + clamp((5.5 - playerDistance) / 4, 0, 0.32) * (1 - calorieRate);
    const effectiveSpeed = speed * escapeBurst;
    if (direction.length() < 0.28) {
      this.fridge.position.copy(target);
      this.chooseNextCandyNode();
    } else {
      direction.normalize();
      const next = this.fridge.position.clone().addScaledVector(direction, effectiveSpeed * dt);
      if (this.canOccupy(next.x, next.z, 0.8)) {
        const travel = next.distanceTo(this.fridge.position);
        this.fridge.position.copy(next);
        this.rollCandyBox(direction, travel);
      } else {
        this.candyTargetNodeId = this.candyCurrentNodeId;
      }
    }

    this.setCandyBoxMood(calorieRate > 0.68 ? 'worried' : calorieRate > 0.3 ? 'alert' : 'smug');
    this.animateCharacters(dt, true);
  }

  setPlayerShape(calories: number, immediate = false) {
    const rate = clamp(calories / GAME_CONFIG.calories.maxForScaling, 0, 1);
    const blend = immediate ? 1 : 0.055;
    const approach = (current: number, target: number) => lerp(current, target, blend);
    this.playerShapeRate = immediate ? rate : approach(this.playerShapeRate, rate);
    this.updatePlayerBodyGeometry(this.playerShapeRate);

    this.playerBelt.scale.x = approach(
      this.playerBelt.scale.x,
      lerp(1.46, 0.9, this.playerShapeRate),
    );
    this.playerBelt.scale.z = approach(
      this.playerBelt.scale.z,
      lerp(1.28, 0.82, this.playerShapeRate),
    );

    this.playerArms.forEach((arm, index) => {
      const side = index === 0 ? -1 : 1;
      arm.position.x = approach(
        arm.position.x,
        side * lerp(0.98, 0.65, this.playerShapeRate),
      );
      arm.rotation.z = approach(
        arm.rotation.z,
        side * lerp(-0.16, -0.035, this.playerShapeRate),
      );
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

  private updatePlayerBodyGeometry(rate: number) {
    const positions = this.playerBodyMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const vertexCount = positions.count;
    for (let index = 0; index < vertexCount; index += 1) {
      const baseX = this.playerBodyBasePositions[index * 3];
      const baseY = this.playerBodyBasePositions[index * 3 + 1];
      const baseZ = this.playerBodyBasePositions[index * 3 + 2];
      const normalizedY = baseY / 0.68;
      const bellyWeight = Math.exp(-Math.pow((normalizedY + 0.18) / 0.52, 2));
      const upperWidth = lerp(1.06, 0.88, rate);
      const bellyWidth = lerp(1.5, 0.92, rate);
      const upperDepth = lerp(0.92, 0.78, rate);
      const bellyDepth = lerp(1.32, 0.84, rate);
      const width = lerp(upperWidth, bellyWidth, bellyWeight);
      const depth = lerp(upperDepth, bellyDepth, bellyWeight);
      positions.setXYZ(
        index,
        baseX * width,
        baseY * 1.45,
        baseZ * depth + bellyWeight * lerp(0.1, 0.015, rate),
      );
    }
    positions.needsUpdate = true;
    this.playerBodyMesh.geometry.computeVertexNormals();
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
    const remaining = this.items.filter((item) => !item.collected).length;
    if (remaining <= 1) {
      this.itemSpawnTimer -= dt;
      if (this.itemSpawnTimer <= 0) {
        this.spawnRandomWaterItem();
        this.itemSpawnTimer = 5 + Math.random() * 4;
      }
    } else {
      this.itemSpawnTimer = Math.min(this.itemSpawnTimer, 3);
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
    this.addWall(1.55, 5.1, 0.22, 1.75);
    this.addWall(1.55, 0.8, 0.22, 1.4);
    this.addDoorFrame(1.55, 2.85, Math.PI / 2);
    this.addWall(-5.1, -1.35, 1.35, 0.2);
    this.addWall(-1.65, -1.35, 1.25, 0.2);
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
    const collider = {
      minX: x - width / 2,
      maxX: x + width / 2,
      minZ: z - depth / 2,
      maxZ: z + depth / 2,
    };
    this.colliders.push(collider);
    this.addCameraOccluder(wall, collider);
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
      const collider = {
        minX: x - width / 2,
        maxX: x + width / 2,
        minZ: z - depth / 2,
        maxZ: z + depth / 2,
      };
      this.colliders.push(collider);
      this.addCameraOccluder(furniture, collider);
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

    this.addFurniture(-8.95, 0, 4.25, 1.05, 0.62, 3.45, '#3e6d72');
    this.addFurniture(-9.32, 0.42, 4.25, 0.38, 1.15, 3.45, '#31575d', false);
    for (const z of [3.35, 5.15]) {
      const cushion = this.addFurniture(-8.72, 0.56, z, 0.62, 0.5, 1.38, '#5b8c8c', false);
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
    this.addFurniture(-4.65, 0, -8.15, 3.05, 0.46, 2.45, '#725244');
    this.addFurniture(-4.65, 0.5, -8.05, 2.82, 0.3, 2.15, '#d7d0c2', false);
    this.addFurniture(-4.65, 0.84, -8.85, 2.7, 0.16, 0.68, '#e8e2d8', false);
    this.addFurniture(-4.65, 0.82, -7.78, 2.68, 0.08, 1.18, '#7085a5', false);

    this.addFurniture(-9.32, 0, -5.45, 0.84, 2.45, 1.9, '#58463c');
    for (const z of [-5.9, -5.0]) {
      this.addBox(-8.88, 1.28, z, 0.035, 2.05, 0.76, '#6b574a');
      this.addBox(-8.84, 1.28, z, 0.035, 0.08, 0.2, '#c2a471');
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

    // Paintings sit flush on the wall surfaces and remain fully inside each wall span.
    this.addBox(-1.65, 2.02, -1.225, 0.9, 0.82, 0.04, '#c79a53');
    this.addBox(-1.65, 2.02, -1.198, 0.7, 0.61, 0.025, '#496c78');
    this.addBox(1.69, 2.02, 4.95, 0.045, 0.9, 1.05, '#d9ae68');
    this.addBox(1.718, 2.02, 4.95, 0.025, 0.68, 0.82, '#765d80');

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
    const columnHeight = 2.92;
    const columnY = columnHeight / 2;
    const beamY = 2.99;
    if (verticalWall) {
      this.addBox(x, columnY, z - 1.28, 0.26, columnHeight, 0.22, color);
      this.addBox(x, columnY, z + 1.28, 0.26, columnHeight, 0.22, color);
      this.addBox(x, beamY, z, 0.26, 0.18, 2.78, color);
    } else {
      this.addBox(x - 1.05, columnY, z, 0.2, columnHeight, 0.24, color);
      this.addBox(x + 1.05, columnY, z, 0.2, columnHeight, 0.24, color);
      this.addBox(x, beamY, z, 2.3, 0.18, 0.24, color);
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

  private addCameraOccluder(mesh: THREE.Mesh, collider: BoxCollider) {
    const material = mesh.material as CameraOccluder['material'];
    this.cameraOccluders.push({
      collider,
      mesh,
      material,
      baseOpacity: material.opacity,
      baseTransparent: material.transparent,
      baseDepthWrite: material.depthWrite,
    });
  }

  private buildPlayer() {
    const skin = new THREE.MeshStandardMaterial({ color: '#f2b58f', roughness: 0.7 });
    const shirt = new THREE.MeshStandardMaterial({ color: '#f0a65b', roughness: 0.75 });
    const pants = new THREE.MeshStandardMaterial({ color: '#233a61', roughness: 0.8 });
    const shoes = new THREE.MeshStandardMaterial({ color: '#17223a', roughness: 0.7 });

    const bodyGeometry = new THREE.SphereGeometry(0.68, 26, 20);
    this.playerBodyBasePositions = new Float32Array(
      (bodyGeometry.getAttribute('position') as THREE.BufferAttribute).array,
    );
    this.playerBodyMesh = new THREE.Mesh(bodyGeometry, shirt);
    this.playerBodyMesh.position.y = 1.56;
    this.playerBodyMesh.castShadow = true;

    this.playerBelt = new THREE.Mesh(
      new THREE.TorusGeometry(0.64, 0.055, 8, 24),
      new THREE.MeshStandardMaterial({ color: '#263249', roughness: 0.68 }),
    );
    this.playerBelt.rotation.x = Math.PI / 2;
    this.playerBelt.position.set(0, 1.03, 0.04);
    this.playerBelt.castShadow = true;

    this.playerBody.add(this.playerBodyMesh, this.playerBelt);

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
      arm.position.set(side * 0.98, 1.5, 0);
      arm.rotation.z = side * -0.16;
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

  private buildCandyBox() {
    const dark = new THREE.MeshStandardMaterial({ color: '#182438', roughness: 0.45 });
    const shellMaterial = new THREE.MeshPhysicalMaterial({
      color: '#bcecff',
      transparent: true,
      opacity: 0.28,
      transmission: 0.5,
      roughness: 0.08,
      metalness: 0.05,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const shell = new THREE.Mesh(new THREE.SphereGeometry(this.candyShellRadius, 40, 28), shellMaterial);
    shell.castShadow = true;
    shell.renderOrder = 3;
    this.candyShell.add(shell);

    const hoopMaterial = new THREE.MeshStandardMaterial({
      color: '#79c9dc',
      transparent: true,
      opacity: 0.72,
      roughness: 0.3,
    });
    const equator = new THREE.Mesh(new THREE.TorusGeometry(this.candyShellRadius + 0.005, 0.024, 8, 52), hoopMaterial);
    equator.rotation.x = Math.PI / 2;
    const meridian = new THREE.Mesh(new THREE.TorusGeometry(this.candyShellRadius + 0.005, 0.024, 8, 52), hoopMaterial);
    meridian.rotation.y = Math.PI / 2;
    this.candyShell.add(equator, meridian);

    const handle = new THREE.Mesh(
      new THREE.TorusGeometry(0.3, 0.052, 10, 26, Math.PI),
      new THREE.MeshStandardMaterial({ color: '#f0b65f', roughness: 0.45 }),
    );
    handle.position.y = 1.08;
    handle.castShadow = true;
    this.candyShell.add(handle);
    for (const side of [-1, 1]) {
      const connector = new THREE.Mesh(
        new THREE.CylinderGeometry(0.052, 0.052, 0.18, 10),
        new THREE.MeshStandardMaterial({ color: '#f0b65f', roughness: 0.45 }),
      );
      connector.position.set(side * 0.3, 1.02, 0);
      this.candyShell.add(connector);
    }
    this.candyShell.position.y = this.candyShellRadius;

    const bowlMaterial = new THREE.MeshStandardMaterial({
      color: '#f7f5ee',
      roughness: 0.62,
      side: THREE.DoubleSide,
    });
    const bowl = new THREE.Mesh(
      new THREE.SphereGeometry(0.82, 34, 18, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      bowlMaterial,
    );
    bowl.castShadow = true;
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.82, 0.045, 8, 38),
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.45 }),
    );
    rim.rotation.x = Math.PI / 2;
    this.candyPayload.add(bowl, rim);

    const candySpecs = [
      { color: '#ef6b78', accent: '#ffe0e4', position: [-0.38, -0.28, 0.08], rotation: [0.2, 0.4, 0.7], shape: 'wrap' },
      { color: '#64c8a2', accent: '#e2fff4', position: [0.34, -0.27, 0.12], rotation: [0.5, 0.2, -0.5], shape: 'wrap' },
      { color: '#6d402d', accent: '#b77b55', position: [0.02, -0.24, -0.22], rotation: [0.1, 0.6, 0.15], shape: 'chocolate' },
      { color: '#d89a4a', accent: '#5b3827', position: [-0.22, -0.19, -0.32], rotation: [Math.PI / 2, 0.1, 0.2], shape: 'cookie' },
      { color: '#9b7de3', accent: '#f0e9ff', position: [0.31, -0.18, -0.24], rotation: [0.3, 0.1, 0.9], shape: 'wafer' },
      { color: '#f58d4c', accent: '#fff0bc', position: [0.02, -0.13, 0.23], rotation: [0.2, 0.5, -0.2], shape: 'lollipop' },
      { color: '#ff8ab3', accent: '#fff0f6', position: [0.48, -0.2, -0.02], rotation: [0.2, -0.4, 0.35], shape: 'gumdrop' },
      { color: '#82d5ef', accent: '#e9faff', position: [-0.49, -0.2, -0.1], rotation: [0.35, 0.5, -0.4], shape: 'gumdrop' },
      { color: '#f1c75b', accent: '#fff4c7', position: [-0.09, -0.08, -0.06], rotation: [0.1, 0.3, 0.5], shape: 'donut' },
      { color: '#54b9a4', accent: '#d9fff5', position: [0.24, -0.07, 0.04], rotation: [0.4, 0.2, -0.25], shape: 'wrap' },
      { color: '#7a4d38', accent: '#ce8b62', position: [-0.32, -0.08, 0.16], rotation: [0.15, 0.7, 0.18], shape: 'chocolate' },
      { color: '#f08ca2', accent: '#fff2f5', position: [0.09, -0.03, -0.28], rotation: [0.25, -0.3, 0.28], shape: 'wafer' },
      { color: '#b7df51', accent: '#f4ffd4', position: [-0.5, -0.06, 0.18], rotation: [0.1, 0.2, -0.55], shape: 'wrap' },
      { color: '#f7a7d6', accent: '#ffffff', position: [0.43, -0.05, 0.22], rotation: [0.25, -0.1, 0.1], shape: 'donut' },
      { color: '#c69052', accent: '#6b3e28', position: [0.0, 0.0, 0.06], rotation: [Math.PI / 2, 0.2, -0.15], shape: 'cookie' },
    ] as const;
    this.candyPieces = candySpecs.map((spec) => {
      const candy = new THREE.Group();
      const material = new THREE.MeshStandardMaterial({
        color: spec.color,
        map: this.createCandyTexture(spec.color, spec.accent),
        roughness: 0.55,
        emissive: spec.color,
        emissiveIntensity: 0.08,
      });
      if (spec.shape === 'wrap') {
        const center = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.22, 5, 10), material);
        center.rotation.z = Math.PI / 2;
        candy.add(center);
        for (const side of [-1, 1]) {
          const wrapper = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.17, 8), material);
          wrapper.rotation.z = side * Math.PI / 2;
          wrapper.position.x = side * 0.25;
          candy.add(wrapper);
        }
      } else if (spec.shape === 'cookie') {
        const cookie = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.09, 16), material);
        cookie.rotation.x = Math.PI / 2;
        candy.add(cookie);
        for (const [x, y] of [[-0.08, 0.06], [0.06, 0.08], [0.1, -0.05], [-0.04, -0.08]]) {
          const chip = new THREE.Mesh(
            new THREE.SphereGeometry(0.028, 7, 5),
            new THREE.MeshStandardMaterial({ color: '#4a2b20', roughness: 0.8 }),
          );
          chip.position.set(x, y, 0.055);
          candy.add(chip);
        }
      } else if (spec.shape === 'chocolate') {
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.28), material);
        candy.add(base);
        for (const x of [-0.135, 0, 0.135]) {
          for (const z of [-0.075, 0.075]) {
            const segment = new THREE.Mesh(
              new THREE.BoxGeometry(0.11, 0.045, 0.11),
              new THREE.MeshStandardMaterial({ color: '#8b583d', roughness: 0.68 }),
            );
            segment.position.set(x, 0.05, z);
            candy.add(segment);
          }
        }
      } else if (spec.shape === 'lollipop') {
        const stick = new THREE.Mesh(
          new THREE.CylinderGeometry(0.025, 0.025, 0.44, 8),
          new THREE.MeshStandardMaterial({ color: '#f5eee0', roughness: 0.75 }),
        );
        stick.position.y = -0.17;
        const sweet = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), material);
        sweet.position.y = 0.12;
        const spiral = new THREE.Mesh(
          new THREE.TorusGeometry(0.1, 0.016, 6, 20),
          new THREE.MeshStandardMaterial({ color: spec.accent, roughness: 0.4 }),
        );
        spiral.position.set(0, 0.12, 0.13);
        candy.add(stick, sweet, spiral);
      } else if (spec.shape === 'gumdrop') {
        const gumdrop = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), material);
        gumdrop.scale.set(1, 0.78, 1);
        const sugar = new THREE.Mesh(
          new THREE.TorusGeometry(0.12, 0.018, 6, 18),
          new THREE.MeshStandardMaterial({ color: spec.accent, roughness: 0.85 }),
        );
        sugar.rotation.x = Math.PI / 2;
        sugar.position.y = -0.04;
        candy.add(gumdrop, sugar);
      } else if (spec.shape === 'donut') {
        const donut = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.065, 10, 22), material);
        const icing = new THREE.Mesh(
          new THREE.TorusGeometry(0.16, 0.025, 8, 22),
          new THREE.MeshStandardMaterial({ color: spec.accent, roughness: 0.55 }),
        );
        icing.position.z = 0.055;
        candy.add(donut, icing);
      } else {
        const wafer = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.15, 0.24), material);
        candy.add(wafer);
        for (const x of [-0.11, 0, 0.11]) {
          const stripe = new THREE.Mesh(
            new THREE.BoxGeometry(0.025, 0.17, 0.25),
            new THREE.MeshStandardMaterial({ color: spec.accent, roughness: 0.7 }),
          );
          stripe.position.x = x;
          candy.add(stripe);
        }
      }
      candy.position.set(spec.position[0], spec.position[1], spec.position[2]);
      candy.rotation.set(spec.rotation[0], spec.rotation[1], spec.rotation[2]);
      candy.scale.setScalar(0.82);
      candy.traverse((object) => {
        if (object instanceof THREE.Mesh) object.castShadow = true;
      });
      this.candyPayload.add(candy);
      return candy;
    });

    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.092, 16, 10), dark);
      eye.position.set(side * 0.2, -0.18, 0.72);
      eye.scale.set(0.9, 1.2, 0.65);
      eye.name = `eye-${side}`;
      this.candyBoxFace.add(eye);
      const highlight = new THREE.Mesh(
        new THREE.SphereGeometry(0.022, 8, 6),
        new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.25 }),
      );
      highlight.position.set(side * 0.178, -0.148, 0.79);
      this.candyBoxFace.add(highlight);
      const cheek = new THREE.Mesh(
        new THREE.SphereGeometry(0.074, 12, 8),
        new THREE.MeshStandardMaterial({
          color: '#f28ca4',
          emissive: '#8e3247',
          emissiveIntensity: 0.12,
          roughness: 0.65,
        }),
      );
      cheek.position.set(side * 0.36, -0.34, 0.7);
      cheek.scale.set(1, 0.52, 0.45);
      this.candyBoxFace.add(cheek);
    }
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.022, 7, 20, Math.PI), dark);
    mouth.position.set(0, -0.35, 0.73);
    mouth.rotation.z = Math.PI;
    mouth.name = 'mouth';
    this.candyBoxFace.add(mouth);

    this.candyPayload.add(this.candyBoxFace);
    this.candyPayload.position.y = this.candyShellRadius;
    this.fridge.add(this.candyPayload, this.candyShell);

    const glow = new THREE.PointLight('#8adcf2', 4, 4);
    glow.position.set(0, 1.45, 0);
    this.fridge.add(glow);
  }

  private createCandyTexture(baseColor: string, accentColor: string) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.fillStyle = baseColor;
    context.fillRect(0, 0, 64, 64);
    context.strokeStyle = accentColor;
    context.lineWidth = 9;
    for (let offset = -64; offset < 128; offset += 24) {
      context.beginPath();
      context.moveTo(offset, 64);
      context.lineTo(offset + 64, 0);
      context.stroke();
    }
    const shine = context.createLinearGradient(0, 0, 64, 0);
    shine.addColorStop(0, 'rgba(255,255,255,0)');
    shine.addColorStop(0.48, 'rgba(255,255,255,0.35)');
    shine.addColorStop(0.62, 'rgba(255,255,255,0)');
    context.fillStyle = shine;
    context.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1.5, 1.5);
    return texture;
  }

  private setCandyBoxMood(mood: 'smug' | 'alert' | 'worried') {
    const mouth = this.candyBoxFace.getObjectByName('mouth');
    const left = this.candyBoxFace.getObjectByName('eye--1');
    const right = this.candyBoxFace.getObjectByName('eye-1');
    if (!mouth || !left || !right) return;
    if (mood === 'smug') {
      mouth.rotation.z = Math.PI - 0.08;
      mouth.scale.set(1, 0.9, 1);
      left.scale.y = 0.72;
      right.scale.y = 1.18;
    } else if (mood === 'alert') {
      mouth.rotation.z = Math.PI;
      mouth.scale.set(0.72, 1.25, 1);
      left.scale.y = 1.25;
      right.scale.y = 1.25;
    } else {
      mouth.rotation.z = 0;
      mouth.scale.set(0.62, 1.4, 1);
      left.scale.y = 1.6;
      right.scale.y = 1.6;
    }
  }

  private animateCharacters(dt: number, running: boolean) {
    this.clockTime += dt;
    this.fridge.position.y = 0;
    const amount = running ? 0.045 : 0.018;
    this.candyPieces.forEach((candy, index) => {
      candy.rotation.z += Math.sin(this.clockTime * 4 + index) * amount * dt;
    });
  }

  private rollCandyBox(direction: THREE.Vector3, distance: number) {
    if (distance <= 0 || direction.lengthSq() === 0) return;
    const axis = new THREE.Vector3(direction.z, 0, -direction.x).normalize();
    this.candyShell.rotateOnWorldAxis(axis, distance / this.candyShellRadius);
  }

  private spawnItems(count: number) {
    this.clearItems();
    this.itemSpawnTimer = 4;
    const shuffled = waterItemPositions
      .slice(1)
      .sort(() => Math.random() - 0.5);
    const positions = [waterItemPositions[0], ...shuffled].slice(0, count);
    positions.forEach(([x, z], index) => this.spawnWaterItem(x, z, index));
  }

  private spawnRandomWaterItem() {
    const activePositions = this.items
      .filter((item) => !item.collected)
      .map((item) => item.mesh.position);
    const candidates = waterItemPositions.filter(([x, z]) =>
      activePositions.every((position) => Math.hypot(position.x - x, position.z - z) > 1.5),
    );
    if (candidates.length === 0) return;
    const [x, z] = candidates[Math.floor(Math.random() * candidates.length)];
    this.spawnWaterItem(x, z, this.items.length);
  }

  private spawnWaterItem(x: number, z: number, variant: number) {
    const item = new THREE.Group();
    const bottle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.26, 0.75, 12),
      new THREE.MeshStandardMaterial({
        color: variant % 2 ? '#88f2bd' : '#59c7ff',
        emissive: variant % 2 ? '#174c34' : '#123f59',
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

  private clearItems() {
    for (const item of this.items) this.scene.remove(item.mesh);
    this.items = [];
  }

  private getOpeningCameraTarget() {
    return this.player.position.clone().add(new THREE.Vector3(0, 0.35, 0));
  }

  private requireNavigationNode(id: string) {
    const node = navigationNodeMap.get(id);
    if (!node) throw new Error(`Unknown navigation node: ${id}`);
    return node;
  }

  private chooseNextCandyNode() {
    const current = this.requireNavigationNode(this.candyTargetNodeId);
    const previousId = this.candyCurrentNodeId;
    this.candyPreviousNodeId = previousId;
    this.candyCurrentNodeId = current.id;

    const validLinks = current.links.filter((id) => {
      const linked = this.requireNavigationNode(id);
      return this.isPathClear(current.position, linked.position, 0.82);
    });
    if (validLinks.length === 0) {
      throw new Error(`Navigation node has no usable exit: ${current.id}`);
    }

    const alternatives = validLinks.filter((id) => id !== previousId);
    const candidates = alternatives.length > 0 ? alternatives : validLinks;
    const ranked = candidates
      .map((id) => {
        const node = this.requireNavigationNode(id);
        const playerDistance = node.position.distanceTo(this.player.position);
        const forwardBonus = id === this.candyPreviousNodeId ? -2 : 0;
        return { id, score: playerDistance + forwardBonus + Math.random() * 3.2 };
      })
      .sort((a, b) => b.score - a.score);
    this.candyTargetNodeId = ranked[0].id;
  }

  private validateNavigationGraph() {
    const invalidNodes = navigationNodes.filter(
      (node) => !this.canOccupy(node.position.x, node.position.z, 0.82),
    );
    const invalidEdges: string[] = [];
    for (const node of navigationNodes) {
      for (const linkedId of node.links) {
        const linked = this.requireNavigationNode(linkedId);
        if (!linked.links.includes(node.id)) {
          invalidEdges.push(`${node.id}->${linkedId} (one-way)`);
        } else if (
          node.id < linkedId &&
          !this.isPathClear(node.position, linked.position, 0.82)
        ) {
          invalidEdges.push(`${node.id}<->${linkedId}`);
        }
      }
    }
    const visited = new Set<string>();
    const pending = [navigationNodes[0].id];
    while (pending.length > 0) {
      const id = pending.pop();
      if (!id || visited.has(id)) continue;
      visited.add(id);
      pending.push(...this.requireNavigationNode(id).links);
    }
    const terminalNodes = navigationNodes.filter((node) => node.links.length < 2);
    if (
      invalidNodes.length > 0 ||
      invalidEdges.length > 0 ||
      terminalNodes.length > 0 ||
      visited.size !== navigationNodes.length
    ) {
      throw new Error(
        `Invalid navigation graph: nodes=${invalidNodes.map((node) => node.id).join(',')}; ` +
          `edges=${invalidEdges.join(',')}; terminals=${terminalNodes.map((node) => node.id).join(',')}; ` +
          `connected=${visited.size}/${navigationNodes.length}`,
      );
    }
    console.info(`Navigation graph ready: ${navigationNodes.length} nodes, no dead ends`);
  }

  private isPathClear(from: THREE.Vector3, to: THREE.Vector3, radius: number) {
    const distance = from.distanceTo(to);
    const steps = Math.max(1, Math.ceil(distance / 0.16));
    for (let step = 0; step <= steps; step += 1) {
      const rate = step / steps;
      const x = lerp(from.x, to.x, rate);
      const z = lerp(from.z, to.z, rate);
      if (!this.canOccupy(x, z, radius)) return false;
    }
    return true;
  }

  private updateCameraOccluders(target: THREE.Vector3) {
    for (const occluder of this.cameraOccluders) {
      const blocked =
        this.pointInsideCollider(this.camera.position.x, this.camera.position.z, occluder.collider, 0.04) ||
        this.segmentIntersectsCollider(
          target.x,
          target.z,
          this.camera.position.x,
          this.camera.position.z,
          occluder.collider,
          0.06,
        );
      occluder.material.opacity = blocked ? Math.min(occluder.baseOpacity, 0.23) : occluder.baseOpacity;
      occluder.material.transparent = blocked || occluder.baseTransparent;
      occluder.material.depthWrite = blocked ? false : occluder.baseDepthWrite;
      occluder.mesh.renderOrder = blocked ? 4 : 0;
    }
  }

  private pointInsideCollider(x: number, z: number, box: BoxCollider, padding = 0) {
    return (
      x >= box.minX - padding &&
      x <= box.maxX + padding &&
      z >= box.minZ - padding &&
      z <= box.maxZ + padding
    );
  }

  private segmentIntersectsCollider(
    startX: number,
    startZ: number,
    endX: number,
    endZ: number,
    box: BoxCollider,
    padding = 0,
  ) {
    let minRate = 0;
    let maxRate = 1;
    const deltaX = endX - startX;
    const deltaZ = endZ - startZ;
    const axes = [
      { start: startX, delta: deltaX, min: box.minX - padding, max: box.maxX + padding },
      { start: startZ, delta: deltaZ, min: box.minZ - padding, max: box.maxZ + padding },
    ];

    for (const axis of axes) {
      if (Math.abs(axis.delta) < 0.00001) {
        if (axis.start < axis.min || axis.start > axis.max) return false;
        continue;
      }
      const near = (axis.min - axis.start) / axis.delta;
      const far = (axis.max - axis.start) / axis.delta;
      minRate = Math.max(minRate, Math.min(near, far));
      maxRate = Math.min(maxRate, Math.max(near, far));
      if (minRate > maxRate) return false;
    }
    return maxRate >= 0 && minRate <= 1;
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
