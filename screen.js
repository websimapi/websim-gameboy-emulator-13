// screen.js - Canvas rendering, pixel processing, and screen scaling

// Screen device
export class Screen {
    constructor(canvas, pixelSize) {
        this.context = canvas.getContext('2d');
        this.canvas = canvas;
        this.pixelSize = pixelSize || 1;
        this.initImageData();
    }

    static get colors() {
        return [
            0xFF, // White
            0xAA, // Light gray
            0x55, // Dark gray
            0x00  // Black
        ];
    }

    static get physics() {
        return {
            WIDTH: 160,
            HEIGHT: 144,
            FREQUENCY: 60
        };
    }

    setPixelSize(pixelSize) {
        this.pixelSize = pixelSize;
        this.initImageData();
    }

    initImageData() {
        this.canvas.width = Screen.physics.WIDTH * this.pixelSize;
        this.canvas.height = Screen.physics.HEIGHT * this.pixelSize;
        this.imageData = this.context.createImageData(this.canvas.width, this.canvas.height);
    }

    clearScreen() {
        this.context.fillStyle = '#FFF';
        this.context.fillRect(0, 0, Screen.physics.WIDTH * this.pixelSize, Screen.physics.HEIGHT * this.pixelSize);
    }

    fillImageData(buffer) {
        for (let y = 0; y < Screen.physics.HEIGHT; y++) {
            for (let py = 0; py < this.pixelSize; py++) {
                const _y = y * this.pixelSize + py;
                for (let x = 0; x < Screen.physics.WIDTH; x++) {
                    for (let px = 0; px < this.pixelSize; px++) {
                        const offset = _y * this.canvas.width + (x * this.pixelSize + px);
                        const v = Screen.colors[buffer[y * Screen.physics.WIDTH + x]];
                        this.imageData.data[offset * 4] = v;
                        this.imageData.data[offset * 4 + 1] = v;
                        this.imageData.data[offset * 4 + 2] = v;
                        this.imageData.data[offset * 4 + 3] = 255;
                    }
                }
            }
        }
    }

    render(buffer) {
        this.fillImageData(buffer);
        this.context.putImageData(this.imageData, 0, 0);
    }
}
