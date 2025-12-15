// dist/index.js (bundled output)
const SSBMPlugin = {
  async onInit(api) {
    api.log("[SSBMPlugin] Initializing...");

    // 1) Read Slippi connect code via generic file bridge
    const user = await api.host.file.readJson("slippiUserFile");

    if (user?.connectCode) {
      api.log(`Connect code: ${user.connectCode}`);
      api.sendEvent("setSession", user.connectCode);
    } else {
      api.log("No connect code found");
    }

    // 2) Subscribe to Dolphin events via generic dolphin bridge
    await api.host.dolphin.subscribe({
      events: ["GameStart", "GameEnd"]
    });

    // 3) Listen for forwarded Dolphin events
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
    // Optional: if you later add dolphin.unsubscribe()
    api.log("[SSBMPlugin] Shutting down...");
  }
};

module.exports = SSBMPlugin;
