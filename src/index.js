// index.js
const DolphinManager = require("./dolphinManager");
const { SlpStream, SlpParser, SlpStreamEvent } = require("@slippi/slippi-js");

let dolphinManager = null;
let slippiManager = null;

const SSBMPlugin = {
  /**
   * Called when the plugin is loaded
   * @param {object} context - Provided by the Saltshaker runtime
   *  context.windowManager  → lets you send events to the renderer
   *  context.pluginEvents   → event emitter for plugin <-> client messages
   */
  onInit(context) {
    console.log("[SSBMPlugin] Initializing...");

    // Set up Slippi data pipeline
    slippiManager = new SlpStream();
    const parser = new SlpParser();

    // Whenever Dolphin sends a new command, pipe it to the parser
    slippiManager.on(SlpStreamEvent.COMMAND, (evt) => {
      parser.handleCommand(evt.command, evt.payload);
    });

    // Initialize Dolphin connection layer
    dolphinManager = new DolphinManager(context.windowManager, slippiManager);

    // Optionally: listen for parsed game events
    parser.on("gameStart", (game) => {
      console.log("[SSBMPlugin] Game started!", game);
      context.pluginEvents.emit("game-start", game);
    });

    parser.on("gameEnd", (game) => {
      console.log("[SSBMPlugin] Game ended.");
      context.pluginEvents.emit("game-end", game);
    });

    // Begin connecting
    dolphinManager.connect();
  },

  /**
   * Called when the plugin is unloaded or disabled
   */
  onUnload() {
    console.log("[SSBMPlugin] Shutting down...");
    if (dolphinManager) dolphinManager.disconnect();
    dolphinManager = null;
    slippiManager = null;
  },
};

module.exports = SSBMPlugin;
