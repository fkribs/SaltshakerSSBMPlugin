const SSBMPlugin = {
  async onInit(api) {
    api.log("[SSBMPlugin] Initializing...");

    // Read connect code from host
    const user = await api.host.get("slippi:user");
    api.log(`Connect code: ${user.connectCode}`);

    // Subscribe to Dolphin events
    await api.host.invoke("dolphin.subscribe", { events: ["GameStart", "GameEnd"] });

    // Listen for forwarded events
    api.on("dolphin:GameStart", (game) => {
      api.log("[SSBMPlugin] Game started", game);
      api.sendEvent("game-start", game);
    });

    api.on("dolphin:GameEnd", () => {
      api.log("[SSBMPlugin] Game ended");
      api.sendEvent("game-end");
    });
  },

  onUnload() {
    api.log("[SSBMPlugin] Shutting down...");
  },
};

module.exports = SSBMPlugin;
