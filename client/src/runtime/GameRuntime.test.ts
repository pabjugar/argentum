import { describe, expect, it, vi } from "vitest";
import { createInitialState } from "../app/appReducer";
import { GameRuntime } from "./GameRuntime";

describe("GameRuntime movement prediction", () => {
  it("does not predict a step into an occupied character tile", () => {
    const state = createInitialState();
    state.connection.status = "connected";
    state.world.mapStatus = "ready";
    state.world.map = {
      mapId: 1,
      name: "Test",
      width: 5,
      height: 5,
      tiles: new Uint8Array(25),
      musicHi: 0,
      musicLow: 0,
      layers: [[], [], [], []],
      npcs: [],
      exits: []
    };
    state.world.self.x = 2;
    state.world.self.y = 2;
    state.world.self.heading = 1;
    state.world.self.speed = 1;
    state.world.others = {
      99: {
        charIndex: 99,
        name: "Blocker",
        x: 3,
        y: 2,
        dead: false,
        heading: 3,
        bodyId: 1,
        headId: 1,
        weaponId: 0,
        shieldId: 0,
        helmetId: 0,
        cartId: 0,
        backpackId: 0,
        effectId: 0,
        effectLoops: 0,
        speed: 1,
        isNpc: false
      }
    };

    const transport = {
      sendWalk: vi.fn(),
      sendHeading: vi.fn(),
      requestPositionUpdate: vi.fn()
    };
    const ui = {
      getState: () => state,
      setSelfPosition: (x: number, y: number) => {
        state.world.self.x = x;
        state.world.self.y = y;
      },
      setSelfHeading: (heading: number) => {
        state.world.self.heading = heading;
      }
    };

    const runtime = new GameRuntime(transport, ui);
    runtime.onMapLoaded(1);
    runtime.rememberMovementKey("east");
    runtime.tick(1_000);

    expect(transport.sendWalk).not.toHaveBeenCalled();
    expect(transport.sendHeading).toHaveBeenCalledWith("east");
    expect(state.world.self.x).toBe(2);
    expect(state.world.self.y).toBe(2);
    expect(state.world.self.heading).toBe(2);
  });

  it("does not predict a water step while not navigating", () => {
    const state = createInitialState();
    state.connection.status = "connected";
    state.world.mapStatus = "ready";
    state.world.map = {
      mapId: 78,
      name: "Costas de nix",
      width: 5,
      height: 5,
      tiles: new Uint8Array(25),
      musicHi: 0,
      musicLow: 0,
      layers: [[], [], [], []],
      npcs: [],
      exits: []
    };
    state.world.map.tiles[(2 - 1) * state.world.map.width + (3 - 1)] = 2;
    state.world.self.x = 2;
    state.world.self.y = 2;
    state.world.self.heading = 1;
    state.world.self.speed = 1;
    state.world.self.navigating = false;

    const transport = {
      sendWalk: vi.fn(),
      sendHeading: vi.fn(),
      requestPositionUpdate: vi.fn()
    };
    const ui = {
      getState: () => state,
      setSelfPosition: (x: number, y: number) => {
        state.world.self.x = x;
        state.world.self.y = y;
      },
      setSelfHeading: (heading: number) => {
        state.world.self.heading = heading;
      }
    };

    const runtime = new GameRuntime(transport, ui);
    runtime.onMapLoaded(78);
    runtime.rememberMovementKey("east");
    runtime.tick(1_000);

    expect(transport.sendWalk).not.toHaveBeenCalled();
    expect(transport.sendHeading).toHaveBeenCalledWith("east");
    expect(state.world.self.x).toBe(2);
    expect(state.world.self.y).toBe(2);
  });

  it("predicts a water step while navigating", () => {
    const state = createInitialState();
    state.connection.status = "connected";
    state.world.mapStatus = "ready";
    state.world.map = {
      mapId: 78,
      name: "Costas de nix",
      width: 5,
      height: 5,
      tiles: new Uint8Array(25),
      musicHi: 0,
      musicLow: 0,
      layers: [[], [], [], []],
      npcs: [],
      exits: []
    };
    state.world.map.tiles[(2 - 1) * state.world.map.width + (3 - 1)] = 2;
    state.world.self.x = 2;
    state.world.self.y = 2;
    state.world.self.heading = 1;
    state.world.self.speed = 1;
    state.world.self.navigating = true;

    const transport = {
      sendWalk: vi.fn(),
      sendHeading: vi.fn(),
      requestPositionUpdate: vi.fn()
    };
    const ui = {
      getState: () => state,
      setSelfPosition: (x: number, y: number) => {
        state.world.self.x = x;
        state.world.self.y = y;
      },
      setSelfHeading: (heading: number) => {
        state.world.self.heading = heading;
      }
    };

    const runtime = new GameRuntime(transport, ui);
    runtime.onMapLoaded(78);
    runtime.rememberMovementKey("east");
    runtime.tick(1_000);

    expect(transport.sendWalk).toHaveBeenCalledWith("east");
    expect(state.world.self.x).toBe(3);
    expect(state.world.self.y).toBe(2);
    expect(state.world.self.heading).toBe(2);
  });

  it("keeps consecutive predicted steps moving even when UI position sync is throttled", () => {
    const state = createInitialState();
    state.connection.status = "connected";
    state.world.mapStatus = "ready";
    state.world.map = {
      mapId: 1,
      name: "Test",
      width: 8,
      height: 5,
      tiles: new Uint8Array(40),
      musicHi: 0,
      musicLow: 0,
      layers: [[], [], [], []],
      npcs: [],
      exits: []
    };
    state.world.self.x = 2;
    state.world.self.y = 2;
    state.world.self.heading = 2;
    state.world.self.speed = 1;
    state.world.walkIntervalMs = 210;

    const transport = {
      sendWalk: vi.fn(),
      sendHeading: vi.fn(),
      requestPositionUpdate: vi.fn()
    };
    const ui = {
      getState: () => state,
      setSelfPosition: (x: number, y: number) => {
        state.world.self.x = x;
        state.world.self.y = y;
      },
      setSelfHeading: (heading: number) => {
        state.world.self.heading = heading;
      }
    };

    const runtime = new GameRuntime(transport, ui);
    runtime.onMapLoaded(1);
    runtime.rememberMovementKey("east");

    runtime.tick(1_000);
    runtime.tick(1_210);

    expect(transport.sendWalk).toHaveBeenCalledTimes(2);
    expect(state.world.self.x).toBe(3);
    expect(state.world.self.y).toBe(2);
    expect(runtime.getDebugSnapshot().predictedX).toBe(4);
    expect(runtime.getDebugSnapshot().predictedY).toBe(2);
  });

  it("buffers a rapid re-tap during cooldown and steps once at the next boundary", () => {
    const state = createInitialState();
    state.connection.status = "connected";
    state.world.mapStatus = "ready";
    state.world.map = {
      mapId: 1,
      name: "Test",
      width: 8,
      height: 5,
      tiles: new Uint8Array(40),
      musicHi: 0,
      musicLow: 0,
      layers: [[], [], [], []],
      npcs: [],
      exits: []
    };
    state.world.self.x = 2;
    state.world.self.y = 2;
    state.world.self.heading = 2;
    state.world.self.speed = 1;
    state.world.walkIntervalMs = 210;

    const transport = {
      sendWalk: vi.fn(),
      sendHeading: vi.fn(),
      requestPositionUpdate: vi.fn()
    };
    const ui = {
      getState: () => state,
      setSelfPosition: (x: number, y: number) => {
        state.world.self.x = x;
        state.world.self.y = y;
      },
      setSelfHeading: (heading: number) => {
        state.world.self.heading = heading;
      }
    };

    const runtime = new GameRuntime(transport, ui);
    runtime.onMapLoaded(1);

    // First step, then the key is released.
    runtime.rememberMovementKey("east", false, 1_000);
    runtime.tick(1_000);
    runtime.releaseMovementKey("east");
    expect(transport.sendWalk).toHaveBeenCalledTimes(1);

    // Rapid re-tap while still in the walk cooldown; released before the boundary.
    runtime.rememberMovementKey("east", false, 1_050);
    runtime.releaseMovementKey("east");

    // A tick still inside the cooldown must not step.
    runtime.tick(1_100);
    expect(transport.sendWalk).toHaveBeenCalledTimes(1);

    // At the tile boundary the buffered intent fires exactly one step.
    runtime.tick(1_210);
    expect(transport.sendWalk).toHaveBeenCalledTimes(2);

    // The buffer is consumed once: no extra step afterwards.
    runtime.tick(1_420);
    expect(transport.sendWalk).toHaveBeenCalledTimes(2);
    expect(runtime.getDebugSnapshot().predictedX).toBe(4);
  });

  it("a single tap that steps immediately does not fire a phantom second step", () => {
    const state = createInitialState();
    state.connection.status = "connected";
    state.world.mapStatus = "ready";
    state.world.map = {
      mapId: 1,
      name: "Test",
      width: 8,
      height: 5,
      tiles: new Uint8Array(40),
      musicHi: 0,
      musicLow: 0,
      layers: [[], [], [], []],
      npcs: [],
      exits: []
    };
    state.world.self.x = 2;
    state.world.self.y = 2;
    state.world.self.heading = 2;
    state.world.self.speed = 1;
    state.world.walkIntervalMs = 210;

    const transport = {
      sendWalk: vi.fn(),
      sendHeading: vi.fn(),
      requestPositionUpdate: vi.fn()
    };
    const ui = {
      getState: () => state,
      setSelfPosition: (x: number, y: number) => {
        state.world.self.x = x;
        state.world.self.y = y;
      },
      setSelfHeading: (heading: number) => {
        state.world.self.heading = heading;
      }
    };

    const runtime = new GameRuntime(transport, ui);
    runtime.onMapLoaded(1);

    // Discrete tap: the step happens immediately because the cooldown is clear.
    runtime.rememberMovementKey("east", false, 1_000);
    runtime.tick(1_000);
    runtime.releaseMovementKey("east");
    expect(transport.sendWalk).toHaveBeenCalledTimes(1);

    // The next tile boundary (and beyond) must NOT step again from a stale buffer.
    runtime.tick(1_210);
    runtime.tick(1_420);
    expect(transport.sendWalk).toHaveBeenCalledTimes(1);
    expect(runtime.getDebugSnapshot().predictedX).toBe(3);
  });

  it("a tapped direction preempts a still-held key even if released before the boundary", () => {
    const state = createInitialState();
    state.connection.status = "connected";
    state.world.mapStatus = "ready";
    state.world.map = {
      mapId: 1,
      name: "Test",
      width: 8,
      height: 8,
      tiles: new Uint8Array(64),
      musicHi: 0,
      musicLow: 0,
      layers: [[], [], [], []],
      npcs: [],
      exits: []
    };
    state.world.self.x = 4;
    state.world.self.y = 4;
    state.world.self.heading = 2;
    state.world.self.speed = 1;
    state.world.walkIntervalMs = 210;

    const transport = {
      sendWalk: vi.fn(),
      sendHeading: vi.fn(),
      requestPositionUpdate: vi.fn()
    };
    const ui = {
      getState: () => state,
      setSelfPosition: (x: number, y: number) => {
        state.world.self.x = x;
        state.world.self.y = y;
      },
      setSelfHeading: (heading: number) => {
        state.world.self.heading = heading;
      }
    };

    const runtime = new GameRuntime(transport, ui);
    runtime.onMapLoaded(1);

    // Hold right and step.
    runtime.rememberMovementKey("east", false, 1_000);
    runtime.tick(1_000);
    expect(transport.sendWalk).toHaveBeenLastCalledWith("east");

    // Tap up mid-cooldown while right stays held, then release up before the boundary.
    runtime.rememberMovementKey("north", false, 1_050);
    runtime.tick(1_050); // still in cooldown, no step yet
    runtime.releaseMovementKey("north");
    expect(transport.sendWalk).toHaveBeenCalledTimes(1);

    // At the boundary the up tap must win over the still-held right.
    runtime.tick(1_210);
    expect(transport.sendWalk).toHaveBeenCalledTimes(2);
    expect(transport.sendWalk).toHaveBeenLastCalledWith("north");

    // Right is still held, so the following boundary resumes moving right.
    runtime.tick(1_420);
    expect(transport.sendWalk).toHaveBeenCalledTimes(3);
    expect(transport.sendWalk).toHaveBeenLastCalledWith("east");
  });

  it("drops a buffered intent once its window expires", () => {
    const state = createInitialState();
    state.connection.status = "connected";
    state.world.mapStatus = "ready";
    state.world.map = {
      mapId: 1,
      name: "Test",
      width: 8,
      height: 5,
      tiles: new Uint8Array(40),
      musicHi: 0,
      musicLow: 0,
      layers: [[], [], [], []],
      npcs: [],
      exits: []
    };
    state.world.self.x = 2;
    state.world.self.y = 2;
    state.world.self.heading = 2;
    state.world.self.speed = 1;
    state.world.walkIntervalMs = 210;

    const transport = {
      sendWalk: vi.fn(),
      sendHeading: vi.fn(),
      requestPositionUpdate: vi.fn()
    };
    const ui = {
      getState: () => state,
      setSelfPosition: (x: number, y: number) => {
        state.world.self.x = x;
        state.world.self.y = y;
      },
      setSelfHeading: (heading: number) => {
        state.world.self.heading = heading;
      }
    };

    const runtime = new GameRuntime(transport, ui);
    runtime.onMapLoaded(1);

    // A tap that is never followed by a timely tick (window is 210 + 60 ms).
    runtime.rememberMovementKey("east", false, 1_000);
    runtime.releaseMovementKey("east");

    runtime.tick(1_400);
    expect(transport.sendWalk).not.toHaveBeenCalled();
  });
});
