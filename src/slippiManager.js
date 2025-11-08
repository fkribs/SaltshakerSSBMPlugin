const { SlpStream, SlpStreamEvent, SlpParser } = require('@slippi/slippi-js');

class SlippiManager {
    constructor(windowManager) {
        this.slpStream = new SlpStream();
        this.parser = new SlpParser();
        this.webContents = windowManager.getWebContents();
        this.setupListeners();
    }

    setupListeners() {
        this.slpStream.on(SlpStreamEvent.COMMAND, (event) => {
            this.parser.handleCommand(event.command, event.payload);
            switch (event.command) {
                case 54: // 54 is the command for game start
                    this.webContents.send('game-start', this.parser.getSettings());
                    break;
                case 57: // 57 is the command for game end
                    this.webContents.send('game-end');
                    break;
            }
        });
    }

    writeToStream(data) {
        this.slpStream.write(data);
    }
}

module.exports = SlippiManager;