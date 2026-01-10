// dist/index.js (bundled output)
const SSBMPlugin = {
  async onInit(api) {
    api.log("[SSBMPlugin] Initializing...");

    let uid = null;
    let currentRoomCode = null;
    let disposing = false;

    // 1) Read Slippi user info (uid) via file bridge
    const user = await api.host.file.readJson("slippiUserFile");
    uid = user?.uid;

    if (!uid) {
      api.log("[SSBMPlugin] No uid found in slippiUserFile; connect/disconnect will be suppressed.");
    } else {
      api.log(`[SSBMPlugin] uid loaded: ${uid}`);
    }

    // 2) Subscribe to Dolphin events
    await api.host.dolphin.subscribe({ events: ["GameStart", "GameEnd"] });

    // Helper: derive roomCode from game payload
    function getRoomCodeFromGame(game) {
      const matchId = game?.matchInfo?.matchId;
      const tiebreakerNumber = game?.matchInfo?.tiebreakerNumber;
      if (!matchId || typeof tiebreakerNumber !== "number") return null;
      return `${matchId}-${tiebreakerNumber}`;
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

    const onGameEnd = () => {
      if (disposing) return;
      if (!uid) return;
      if (!currentRoomCode) return;

      const roomCode = currentRoomCode;
      currentRoomCode = null;

      api.log(`[SSBMPlugin] disconnect(${roomCode}, ${uid})`);
      api.sendEvent("disconnect", roomCode, uid);
    };

    // 3) Register forwarded Dolphin events
    const disposeStart = api.on("dolphin:GameStart", onGameStart);
    const disposeEnd = api.on("dolphin:GameEnd", onGameEnd);

    // 4) Provide onDispose for the harness
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

      // Unsubscribe from Dolphin upstream events if your host supports it
      if (api.host?.dolphin?.unsubscribe) {
        try {
          await api.host.dolphin.unsubscribe({ events: ["GameStart", "GameEnd"] });
        } catch (e) {
          api.log("[SSBMPlugin] dolphin.unsubscribe failed (non-fatal)", e);
        }
      }

      api.log("[SSBMPlugin] Disposed.");
    };
  },

  // This is what PluginManager should call (standardize on this name)
  async onDispose() {
    // If PluginManager calls exported onDispose, we forward to the instance disposer we defined in onInit
    if (typeof this.onDispose === "function") return this.onDispose();
  }
};

module.exports = SSBMPlugin;
