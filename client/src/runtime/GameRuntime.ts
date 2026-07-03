import type {
  CharacterCreatePacket,
  ClientState,
  Direction
} from "../app/types";
import type { WorldRenderer } from "../render/WorldRenderer";

export interface MovementDebugSnapshot {
  predictedX: number | null;
  predictedY: number | null;
  authorityX: number | null;
  authorityY: number | null;
  pendingSteps: number;
  requestCount: number;
  lastRequestAt: number | null;
  correctionCount: number;
  lastCorrectionAt: number | null;
}

type WalkStatus = "walked" | "cooldown" | "blocked" | "unavailable";

interface RuntimeTransport {
  sendWalk(direction: Direction): void;
  sendHeading(direction: Direction): void;
  requestPositionUpdate(): void;
}

interface RuntimeUiBridge {
  getState: () => ClientState;
  setSelfPosition(x: number, y: number): void;
  setSelfHeading(heading: number): void;
}

const PREDICTED_UI_SYNC_INTERVAL_MS = 260;

const runtimeTimers = {
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis)
};

export class GameRuntime {
  private readonly transport: RuntimeTransport;
  private readonly ui: RuntimeUiBridge;
  private renderer: WorldRenderer | null = null;
  private movementKeys: Direction[] = [];
  private bufferedDirection: Direction | null = null;
  private bufferedAt = Number.NEGATIVE_INFINITY;
  private lastWalkAt = Number.NEGATIVE_INFINITY;
  private pendingWalkSteps: Array<{ x: number; y: number; timeoutId: number }> = [];
  private authorityX: number | null = null;
  private authorityY: number | null = null;
  private requestCount = 0;
  private lastRequestAt: number | null = null;
  private correctionCount = 0;
  private lastCorrectionAt: number | null = null;
  private predictionEnabled = false;
  private predictedX: number | null = null;
  private predictedY: number | null = null;
  private lastPredictedUiSyncAt = Number.NEGATIVE_INFINITY;
  private transferTargetMapId: number | null = null;
  private transferBootstrapReceived = false;
  private transferMapDataReady = false;

  constructor(transport: RuntimeTransport, ui: RuntimeUiBridge) {
    this.transport = transport;
    this.ui = ui;
  }

  setRenderer(renderer: WorldRenderer | null) {
    this.renderer = renderer;
  }

  resetConnection() {
    this.clearMovementKeys();
    this.clearPendingWalkSteps();
    this.lastWalkAt = Number.NEGATIVE_INFINITY;
    this.authorityX = null;
    this.authorityY = null;
    this.requestCount = 0;
    this.lastRequestAt = null;
    this.correctionCount = 0;
    this.lastCorrectionAt = null;
    this.predictionEnabled = false;
    this.predictedX = null;
    this.predictedY = null;
    this.lastPredictedUiSyncAt = Number.NEGATIVE_INFINITY;
    this.transferTargetMapId = null;
    this.transferBootstrapReceived = false;
    this.transferMapDataReady = false;
    this.clearBufferedIntent();
  }

  rememberMovementKey(direction: Direction, isRepeat = false, now = performance.now()) {
    this.movementKeys = this.movementKeys.filter((key) => key !== direction);
    this.movementKeys.push(direction);
    // Buffer the last *genuine* press (ignore OS auto-repeat) so a rapid
    // tap released before the walk cooldown expires still produces a step at
    // the next tile boundary. Repeats are skipped so holding a key doesn't
    // keep the buffer fresh and cause an extra step after release. `now` shares
    // the same clock as tick() so the expiry window is measured consistently.
    if (!isRepeat) {
      this.bufferedDirection = direction;
      this.bufferedAt = now;
    }
  }

  releaseMovementKey(direction: Direction) {
    this.movementKeys = this.movementKeys.filter((key) => key !== direction);
  }

  clearMovementKeys() {
    this.movementKeys = [];
    this.clearBufferedIntent();
  }

  tick(now: number) {
    // "Latest intent wins": a recent tap (the last key pressed, even if already
    // released) takes priority over a still-held key for the NEXT step. This is
    // what lets an intermittent up-tap register while right is held down.
    const held = this.activeMovementDirection();
    const buffered = this.validBufferedDirection(now);
    const direction = buffered ?? held;
    if (!direction) {
      return;
    }

    const status = this.tryPredictedWalk(direction, now);

    // A buffered tap is one-shot: consume it as soon as it has been acted on
    // (it stepped, or it turned into a blocked tile). Keep it ONLY while we are
    // still waiting for the tile boundary (cooldown), so it fires next tick and
    // doesn't starve a held key by re-turning forever.
    if (buffered && status !== "cooldown") {
      this.clearBufferedIntent();
    }
  }

  private validBufferedDirection(now: number): Direction | null {
    if (this.bufferedDirection == null) {
      return null;
    }
    if (now - this.bufferedAt >= this.movementBufferWindowMs()) {
      this.clearBufferedIntent();
      return null;
    }
    return this.bufferedDirection;
  }

  requestPositionUpdate() {
    this.requestCount += 1;
    this.lastRequestAt = Date.now();
    this.transport.requestPositionUpdate();
  }

  onMapChange(mapId: number, hadActiveMap: boolean) {
    this.clearPendingWalkSteps();
    this.authorityX = null;
    this.authorityY = null;
    this.predictedX = null;
    this.predictedY = null;
    this.lastPredictedUiSyncAt = Number.NEGATIVE_INFINITY;
    this.predictionEnabled = false;
    this.transferTargetMapId = hadActiveMap ? mapId : null;
    this.transferBootstrapReceived = false;
    this.transferMapDataReady = false;
    if (hadActiveMap) {
      this.renderer?.beginMapTransfer();
    } else {
      this.renderer?.finishMapTransfer();
    }
  }

  onMapLoaded(mapId: number) {
    if (this.transferTargetMapId == null) {
      this.predictionEnabled = true;
      this.renderer?.finishMapTransfer();
      return;
    }

    this.transferMapDataReady = true;
    this.tryFinishTransferBootstrap(mapId);
  }

  onMapLoadError() {
    this.predictionEnabled = false;
    this.transferMapDataReady = false;
    this.renderer?.finishMapTransfer();
  }

  onServerPosition(x: number, y: number) {
    if (
      this.authorityX !== x ||
      this.authorityY !== y ||
      this.ui.getState().world.self.x !== x ||
      this.ui.getState().world.self.y !== y
    ) {
      this.lastCorrectionAt = Date.now();
      this.correctionCount += 1;
    }

    this.authorityX = x;
    this.authorityY = y;
    this.predictedX = x;
    this.predictedY = y;

    if (!this.consumePendingStep(x, y)) {
      this.renderer?.snapSelfPosition(x, y);
    }

    this.syncConfirmedPositionToUi(x, y);
    this.noteTransferBootstrap();
  }

  onSelfCharacter(character: CharacterCreatePacket) {
    // Match the old client bootstrap/handoff behavior: once the server
    // re-creates our own character, any locally pending walk confirmations
    // are stale and should not keep influencing movement/reconciliation.
    this.clearPendingWalkSteps();
    this.authorityX = character.x;
    this.authorityY = character.y;
    this.predictedX = character.x;
    this.predictedY = character.y;
    this.lastPredictedUiSyncAt = Number.NEGATIVE_INFINITY;
    this.renderer?.snapSelfPosition(character.x, character.y);
    this.renderer?.setSelfHeading(character.heading);
    this.ui.setSelfPosition(character.x, character.y);
    this.noteTransferBootstrap();
  }

  onSelfHeading(heading: number) {
    this.renderer?.setSelfHeading(heading);
    this.ui.setSelfHeading(heading);
  }

  getDebugSnapshot(): MovementDebugSnapshot {
    return {
      predictedX: this.currentPredictedX(),
      predictedY: this.currentPredictedY(),
      authorityX: this.authorityX,
      authorityY: this.authorityY,
      pendingSteps: this.pendingWalkSteps.length,
      requestCount: this.requestCount,
      lastRequestAt: this.lastRequestAt,
      correctionCount: this.correctionCount,
      lastCorrectionAt: this.lastCorrectionAt
    };
  }

  private activeMovementDirection() {
    return this.movementKeys.length > 0 ? this.movementKeys[this.movementKeys.length - 1] : null;
  }

  private clearBufferedIntent() {
    this.bufferedDirection = null;
    this.bufferedAt = Number.NEGATIVE_INFINITY;
  }

  private movementBufferWindowMs() {
    // Must cover a full walk interval (a tap right after a step boundary has to
    // survive to the next one) plus a little slack for frame/timing jitter.
    return this.currentWalkIntervalMs() + 60;
  }

  private currentWalkIntervalMs() {
    const state = this.ui.getState();
    const speed = state.world.self.speed > 0 ? state.world.self.speed : 1;
    return Math.max(40, state.world.walkIntervalMs / speed);
  }

  private tileIndex(x: number, y: number, width: number) {
    return (y - 1) * width + (x - 1);
  }

  private tileValueAt(x: number, y: number) {
    const map = this.ui.getState().world.map;
    if (!map) {
      return 0;
    }

    if (x < 1 || x > map.width || y < 1 || y > map.height) {
      return 1;
    }

    return map.tiles[this.tileIndex(x, y, map.width)] ?? 0;
  }

  private isTileBlocked(x: number, y: number) {
    const tileValue = this.tileValueAt(x, y);

    if (tileValue === 0 || tileValue === 4) {
      return false;
    }

    if (tileValue === 2) {
      return !this.ui.getState().world.self.navigating;
    }

    return true;
  }

  private isTileOccupied(x: number, y: number) {
    const world = this.ui.getState().world;

    for (const other of Object.values(world.others)) {
      if (!other.dead && other.x === x && other.y === y) {
        return true;
      }
    }

    const hasLiveNpc = Object.values(world.others).some((other) => other.isNpc && !other.dead);
    if (!hasLiveNpc && world.map) {
      return world.map.npcs.some((npc) => npc.x === x && npc.y === y);
    }

    return false;
  }

  private predictedDestination(direction: Direction) {
    const x = this.currentPredictedX();
    const y = this.currentPredictedY();

    if (x == null || y == null) {
      return null;
    }

    switch (direction) {
      case "north":
        return { x, y: y - 1, heading: 1 };
      case "east":
        return { x: x + 1, y, heading: 2 };
      case "south":
        return { x, y: y + 1, heading: 3 };
      case "west":
        return { x: x - 1, y, heading: 4 };
    }
  }

  private currentPredictedX() {
    return this.predictedX ?? this.ui.getState().world.self.x;
  }

  private currentPredictedY() {
    return this.predictedY ?? this.ui.getState().world.self.y;
  }

  private pushPendingWalkStep(x: number, y: number) {
    const timeoutMs = Math.max(300, Math.round(this.currentWalkIntervalMs() * 2));
    const step = {
      x,
      y,
      timeoutId: runtimeTimers.setTimeout(() => {
        if (
          this.pendingWalkSteps.length > 0 &&
          this.pendingWalkSteps[this.pendingWalkSteps.length - 1] === step
        ) {
          this.requestPositionUpdate();
        }
      }, timeoutMs)
    };

    this.pendingWalkSteps.push(step);
  }

  private clearPendingWalkSteps() {
    for (const step of this.pendingWalkSteps) {
      runtimeTimers.clearTimeout(step.timeoutId);
    }
    this.pendingWalkSteps = [];
  }

  private consumePendingStep(x: number, y: number) {
    for (let index = 0; index < this.pendingWalkSteps.length; index += 1) {
      const step = this.pendingWalkSteps[index];
      if (step.x === x && step.y === y) {
        for (let consumed = 0; consumed <= index; consumed += 1) {
          runtimeTimers.clearTimeout(this.pendingWalkSteps[consumed].timeoutId);
        }
        this.pendingWalkSteps = this.pendingWalkSteps.slice(index + 1);
        return true;
      }
    }

    return false;
  }

  private tryPredictedWalk(direction: Direction, now: number): WalkStatus {
    const state = this.ui.getState();

    if (state.connection.status !== "connected") {
      return "unavailable";
    }

    const world = state.world;
    if (!this.predictionEnabled || world.mapStatus !== "ready" || !world.map) {
      return "unavailable";
    }

    if (now - this.lastWalkAt < this.currentWalkIntervalMs()) {
      return "cooldown";
    }

    const destination = this.predictedDestination(direction);
    if (!destination) {
      return "unavailable";
    }

    if (this.isTileBlocked(destination.x, destination.y) || this.isTileOccupied(destination.x, destination.y)) {
      if (state.world.self.heading !== destination.heading) {
        this.transport.sendHeading(direction);
        this.renderer?.setSelfHeading(destination.heading);
        this.ui.setSelfHeading(destination.heading);
      }
      return "blocked";
    }

    this.transport.sendWalk(direction);
    this.lastWalkAt = now;

    if (state.world.self.heading !== destination.heading) {
      this.renderer?.setSelfHeading(destination.heading);
      this.ui.setSelfHeading(destination.heading);
    }

    const walkInterval = this.currentWalkIntervalMs();
    const speed = state.world.self.speed;
    this.renderer?.pushSelfMovement(destination.x, destination.y, walkInterval, speed);
    this.predictedX = destination.x;
    this.predictedY = destination.y;
    this.syncPredictedPositionToUi(now);
    this.pushPendingWalkStep(destination.x, destination.y);
    return "walked";
  }

  private syncPredictedPositionToUi(now: number) {
    if (this.predictedX == null || this.predictedY == null) {
      return;
    }

    if (now - this.lastPredictedUiSyncAt < PREDICTED_UI_SYNC_INTERVAL_MS) {
      return;
    }

    const self = this.ui.getState().world.self;
    if (self.x === this.predictedX && self.y === this.predictedY) {
      return;
    }

    this.lastPredictedUiSyncAt = now;
    this.ui.setSelfPosition(this.predictedX, this.predictedY);
  }

  private syncConfirmedPositionToUi(x: number, y: number) {
    const self = this.ui.getState().world.self;
    if (self.x === x && self.y === y) {
      return;
    }

    this.ui.setSelfPosition(x, y);
  }

  private noteTransferBootstrap() {
    if (this.transferTargetMapId == null) {
      return;
    }

    this.transferBootstrapReceived = true;
    this.tryFinishTransferBootstrap(this.transferTargetMapId);
  }

  private tryFinishTransferBootstrap(mapId: number) {
    if (this.transferTargetMapId == null || this.transferTargetMapId !== mapId) {
      return;
    }

    if (!this.transferMapDataReady || !this.transferBootstrapReceived) {
      this.predictionEnabled = false;
      return;
    }

    this.transferTargetMapId = null;
    this.transferBootstrapReceived = false;
    this.transferMapDataReady = false;
    this.predictionEnabled = true;
    this.renderer?.finishMapTransfer();
  }
}
