// dist/index.js (bundled output)
const SSBMPlugin = {
  async onInit(api) {
    api.log("[SSBMPlugin] Initializing...");

    let uid = null;
    let currentRoomCode = null;
    let disposing = false;

    // Setting: Hang up on game end (default true)
    let hangupOnGameEnd = true;

    try {
      if (api.settings?.get) {
        hangupOnGameEnd = (await api.settings.get("hangupOnGameEnd", false)) === true;
      }
    } catch (e) {
      api.log("[SSBMPlugin] Failed to read setting hangupOnGameEnd; defaulting to false", e);
      hangupOnGameEnd = false;
    }

    // Setting: Auto-launch Slippi on plugin start
    let autoLaunchSlippi = false;
    let slippiExePath = null;

    try {
      if (api.settings?.get) {
        autoLaunchSlippi = (await api.settings.get("autoLaunchSlippi", false)) === true;
        slippiExePath = (await api.settings.get("slippiExePath", null)) || null;
      }
    } catch (e) {
      api.log("[SSBMPlugin] Failed to read launch settings (non-fatal)", e);
    }

    if (autoLaunchSlippi && slippiExePath) {
      try {
        await api.host.launchApp(slippiExePath);
        api.log("[SSBMPlugin] Launched Slippi:", slippiExePath);
      } catch (e) {
        api.log("[SSBMPlugin] Failed to launch Slippi (non-fatal):", e?.message || e);
      }
    }

    // Optional: react to live changes (if your harness supports api.settings.onChange)
    let disposeSetting = null;
    try {
      if (api.settings?.onChange) {
        disposeSetting = api.settings.onChange(({ key, value }) => {
          if (key === "hangupOnGameEnd") {
            hangupOnGameEnd = value === true;
            api.log(`[SSBMPlugin] setting hangupOnGameEnd=${hangupOnGameEnd}`);
          }
        });
      }
    } catch (e) {
      api.log("[SSBMPlugin] Failed to subscribe to settings changes (non-fatal)", e);
    }

    // 1) Read Slippi user info (uid) via file bridge
    const user = await api.host.file.readJson("slippiUserFile");
    uid = user?.uid;

    const connectCode = user?.connectCode ?? user?.connect_code ?? null;
    if (!connectCode) {
      api.log("[SSBMPlugin] No connectCode found in slippiUserFile; setSession skipped.");
    } else {
      api.log(`[SSBMPlugin] connectCode loaded: ${connectCode}`);

      try {
        if (api.setSession) {
          await api.setSession(connectCode);
          api.log("[SSBMPlugin] setSession(connectCode) sent.");
        } else {
          api.log("[SSBMPlugin] api.setSession not available (host not updated yet).");
        }
      } catch (e) {
        api.log("[SSBMPlugin] setSession failed (non-fatal)", e);
      }
    }

    if (!uid) {
      api.log("[SSBMPlugin] No uid found in slippiUserFile; connect/disconnect will be suppressed.");
    } else {
      api.log(`[SSBMPlugin] uid loaded: ${uid}`);
    }

    // Setting: Spectate folder
    let spectateFolder = process.platform === "darwin"
      ? "{home}/Slippi/Spectate"
      : "{home}\\Documents\\Slippi\\Spectate";
    try {
      if (api.settings?.get) {
        spectateFolder = (await api.settings.get("spectateFolder", spectateFolder)) || spectateFolder;
      }
    } catch (e) {
      api.log("[SSBMPlugin] Failed to read spectateFolder setting (non-fatal)", e);
    }

    // 2) Subscribe to Dolphin events (include Disconnected + Error)
    await api.host.dolphin.subscribe({ events: ["GameStart", "GameEnd", "Disconnected", "Error"] });

    // 3) Subscribe to spectate folder
    try {
      if (api.host?.dolphin?.subscribeSpectate) {
        await api.host.dolphin.subscribeSpectate(spectateFolder);
        api.log("[SSBMPlugin] subscribeSpectate:", spectateFolder);
      }
    } catch (e) {
      api.log("[SSBMPlugin] subscribeSpectate failed (non-fatal):", e?.message || e);
    }

    function getRoomCodeFromGame(game) {
      const matchId = game?.matchInfo?.matchId;
      const tiebreakerNumber = game?.matchInfo?.tiebreakerNumber;
      if (!matchId || typeof tiebreakerNumber !== "number") return null;
      return `${matchId}-${tiebreakerNumber}`;
    }

    function emitDisconnectIfConnected(reason) {
      if (disposing) return;
      if (!uid) return;
      if (!currentRoomCode) return;

      const roomCode = currentRoomCode;
      currentRoomCode = null;

      api.log(`[SSBMPlugin] disconnect(${roomCode}, ${uid}) reason=${reason || "unknown"}`);
      api.sendEvent("disconnect", roomCode, uid);
    }

    const onGameStart = (game) => {
      if (disposing) return;
      if (!uid) return;

      const roomCode = getRoomCodeFromGame(game);
      if (!roomCode) {
        api.log("[SSBMPlugin] GameStart received but could not derive roomCode", game?.matchInfo);
        return;
      }

      // Idempotent connect
      if (currentRoomCode === roomCode) return;

      // If we get a new start without an end, disconnect old room first
      if (currentRoomCode) {
        api.log(`[SSBMPlugin] Switching rooms: disconnecting ${currentRoomCode} before connecting ${roomCode}`);
        api.sendEvent("disconnect", currentRoomCode, uid);
      }

      currentRoomCode = roomCode;
      api.log(`[SSBMPlugin] connect(${roomCode}, ${uid})`);
      api.sendEvent("connect", roomCode, uid);
    };

    const onGameEnd = (_payload) => {
      if (!hangupOnGameEnd) {
        api.log("[SSBMPlugin] GameEnd received; hangupOnGameEnd=false, leaving call connected.");
        return;
      }
      emitDisconnectIfConnected("game-end");
    };

    const onDolphinDisconnected = () => {
      // Rage quit / Dolphin closed / Slippi stream severed.
      emitDisconnectIfConnected("dolphin-disconnected");
    };

    const onDolphinError = (err) => {
      api.log("[SSBMPlugin] dolphin error", err);
      emitDisconnectIfConnected("dolphin-error");
    };

    const onSpectateStart = (settings) => {
      if (disposing) return;
      if (!uid) return;

      const roomCode = getRoomCodeFromGame(settings);
      if (!roomCode) {
        api.log("[SSBMPlugin] SpectateStart: could not derive roomCode", settings?.matchInfo);
        return;
      }

      if (currentRoomCode === roomCode) return;

      if (currentRoomCode) {
        api.log(`[SSBMPlugin] Spectate: switching from ${currentRoomCode} to ${roomCode}`);
        api.sendEvent("disconnect", currentRoomCode, uid);
      }

      currentRoomCode = roomCode;
      api.log(`[SSBMPlugin] SpectateStart: connect(${roomCode}, ${uid})`);
      api.sendEvent("connect", roomCode, uid);
    };

    // 4) Register forwarded Dolphin events
    const disposeStart = api.on("dolphin:GameStart", onGameStart);
    const disposeEnd = api.on("dolphin:GameEnd", onGameEnd);
    const disposeDisc = api.on("dolphin:Disconnected", onDolphinDisconnected);
    const disposeErr = api.on("dolphin:Error", onDolphinError);
    const disposeSpectate = api.on("dolphin:SpectateStart", onSpectateStart);

    // 5) Provide onDispose for the harness
    this.onDispose = async () => {
      if (disposing) return;
      disposing = true;

      // Best-effort: disconnect if still connected
      if (uid && currentRoomCode) {
        const roomCode = currentRoomCode;
        currentRoomCode = null;

        api.log(`[SSBMPlugin] Disposing: disconnect(${roomCode}, ${uid})`);
        api.sendEvent("disconnect", roomCode, uid);
      }

      // Stop receiving forwarded events
      try { disposeStart(); } catch (e) { api.log("[SSBMPlugin] disposeStart error", e); }
      try { disposeEnd(); } catch (e) { api.log("[SSBMPlugin] disposeEnd error", e); }
      try { disposeDisc(); } catch (e) { api.log("[SSBMPlugin] disposeDisc error", e); }
      try { disposeErr(); } catch (e) { api.log("[SSBMPlugin] disposeErr error", e); }
      try { disposeSpectate(); } catch (e) { api.log("[SSBMPlugin] disposeSpectate error", e); }

      // Stop settings listener (if present)
      try { disposeSetting?.(); } catch (e) { api.log("[SSBMPlugin] disposeSetting error", e); }

      // Unsubscribe upstream
      if (api.host?.dolphin?.unsubscribe) {
        try {
          await api.host.dolphin.unsubscribe({ events: ["GameStart", "GameEnd", "Disconnected", "Error"] });
        } catch (e) {
          api.log("[SSBMPlugin] dolphin.unsubscribe failed (non-fatal)", e);
        }
      }

      if (api.host?.dolphin?.unsubscribeSpectate) {
        try {
          await api.host.dolphin.unsubscribeSpectate();
        } catch (e) {
          api.log("[SSBMPlugin] spectate unsubscribe failed (non-fatal)", e);
        }
      }

      api.log("[SSBMPlugin] Disposed.");
    };
  },

  async onDispose() {
    if (typeof this.onDispose === "function") return this.onDispose();
  }
};

module.exports = SSBMPlugin;
