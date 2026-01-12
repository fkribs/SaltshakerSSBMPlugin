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

    // 2) Subscribe to Dolphin events (include Disconnected + Error)
    await api.host.dolphin.subscribe({ events: ["GameStart", "GameEnd", "Disconnected", "Error"] });

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
      emitDisconnectIfConnected("game-end");
    };

    const onDolphinDisconnected = () => {
      // Rage quit / Dolphin closed / Slippi stream severed.
      emitDisconnectIfConnected("dolphin-disconnected");
    };

    const onDolphinError = (err) => {
      // Conservative: treat as disconnect if we were “in game”.
      // If you find false positives, remove this and rely on Disconnected only.
      api.log("[SSBMPlugin] dolphin error", err);
      emitDisconnectIfConnected("dolphin-error");
    };

    // 3) Register forwarded Dolphin events
    const disposeStart = api.on("dolphin:GameStart", onGameStart);
    const disposeEnd = api.on("dolphin:GameEnd", onGameEnd);
    const disposeDisc = api.on("dolphin:Disconnected", onDolphinDisconnected);
    const disposeErr = api.on("dolphin:Error", onDolphinError);

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
      try { disposeDisc(); } catch (e) { api.log("[SSBMPlugin] disposeDisc error", e); }
      try { disposeErr(); } catch (e) { api.log("[SSBMPlugin] disposeErr error", e); }

      // Unsubscribe upstream
      if (api.host?.dolphin?.unsubscribe) {
        try {
          await api.host.dolphin.unsubscribe({ events: ["GameStart", "GameEnd", "Disconnected", "Error"] });
        } catch (e) {
          api.log("[SSBMPlugin] dolphin.unsubscribe failed (non-fatal)", e);
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
