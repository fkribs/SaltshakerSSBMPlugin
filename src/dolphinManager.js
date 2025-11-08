const { DolphinConnection, Ports, ConnectionEvent, ConnectionStatus, DolphinMessageType } = require('@slippi/slippi-js');

class DolphinManager {
    constructor(windowManager, slippiManager) {
        this.dolphinConnection = new DolphinConnection();
        this.webContents = windowManager.getWebContents(); // For sending events to the renderer process
        this.slippiManager = slippiManager;
        this.setupListeners();
    }

    setupListeners() {
        this.dolphinConnection.on(ConnectionEvent.STATUS_CHANGE, (status) => {
            switch (status) {
                case ConnectionStatus.DISCONNECTED:
                    this.webContents.send('disconnected-event', 'disconnected');
                    this.connect(); // Auto-reconnect
                    break;
                case ConnectionStatus.CONNECTED:
                    this.webContents.send('connected-event', 'connected');
                    break;
                case ConnectionStatus.CONNECTING:
                    this.webContents.send('connecting-event', 'connecting');
                    break;
            }
        });

        this.dolphinConnection.on(ConnectionEvent.MESSAGE, (message) => {
            switch (message.type) {
                case DolphinMessageType.CONNECT_REPLY:
				console.log('Connected: ' + message);
				break;
			case DolphinMessageType.GAME_EVENT:
				var decoded = Buffer.from(message.payload, 'base64');
				this.slippiManager.writeToStream(decoded);
				break;
		}
        });

        this.dolphinConnection.on(ConnectionEvent.ERROR, (err) => {
            console.error('Dolphin connection error', err);
            this.webContents.send('error-event', err.toString());
        });
    }

    connect() {
        this.webContents.send('disconnected-event', 'disconnected');
			if (this.dolphinConnection.getStatus() === ConnectionStatus.DISCONNECTED) {
				// Now try connect to our local Dolphin instance
				this.dolphinConnection.connect('127.0.0.1', Ports.DEFAULT);
			}
    }

    disconnect() {
        this.dolphinConnection.disconnect();
    }
}

module.exports = DolphinManager;
