// input.js - Input class, Keyboard handler, Gamepad handler

import { Util } from './utils.js';

// The Input management system
export class Input {
    constructor(cpu, pad) {
        this.cpu = cpu;
        this.memory = cpu.memory;
        this.P1 = 0xFF00;
        this.state = 0;

        pad.init(this.pressKey.bind(this), this.releaseKey.bind(this));
    }

    static get keys() {
        return {
            START: 0x80,
            SELECT: 0x40,
            B: 0x20,
            A: 0x10,
            DOWN: 0x08,
            UP: 0x04,
            LEFT: 0x02,
            RIGHT: 0x01
        };
    }

    pressKey(key) {
        this.state |= Input.keys[key];
        this.cpu.requestInterrupt(4); // HILO
    }

    releaseKey(key) {
        const mask = 0xFF - Input.keys[key];
        this.state &= mask;
    }

    update() {
        let value = this.memory.rb(this.P1);
        value = ((~value) & 0x30); // invert the value so 1 means 'active'
        if (value & 0x10) { // direction keys listened
            value |= (this.state & 0x0F);
        } else if (value & 0x20) { // action keys listened
            value |= ((this.state & 0xF0) >> 4);
        } else if ((value & 0x30) == 0) { // no keys listened
            value &= 0xF0;
        }

        value = ((~value) & 0x3F); // invert back
        this.memory[this.P1] = value;
    }
}

// Keyboard listener
// Does the mapping between the keyboard and the Input class
export class Keyboard {
    constructor() {}

    // Initialize the keyboard listeners and set up the callbacks
    // for button press / release
    init(onPress, onRelease) {
        this.onPress = onPress;
        this.onRelease = onRelease;

        const self = this;
        document.addEventListener('keydown', function(e) {
            self.managePress(e.keyCode);
        });
        document.addEventListener('keyup', function(e) {
            self.manageRelease(e.keyCode);
        });
    }

    managePress(keycode) {
        const key = this.translateKey(keycode);
        if (key) {
            this.onPress(key);
        }
    }

    manageRelease(keycode) {
        const key = this.translateKey(keycode);
        if (key) {
            this.onRelease(key);
        }
    }

    // Transform a keyboard keycode into a key of the Input.keys object
    translateKey(keycode) {
        let key = null;
        switch (keycode) {
            case 71: // G
                key = 'A';
                break;
            case 66: // B
                key = 'B';
                break;
            case 72: // H
                key = 'START';
                break;
            case 78: // N
                key = 'SELECT';
                break;
            case 37: // left
                key = 'LEFT';
                break;
            case 38: // up
                key = 'UP';
                break;
            case 39: // right
                key = 'RIGHT';
                break;
            case 40: // down
                key = 'DOWN';
                break;
        }

        return key;
    }
}

// This is the default buttons mapping for the Gamepad
// It's optimized for the XBOX pad
const xboxMapping = {
    0: 'UP',
    1: 'DOWN',
    2: 'LEFT',
    3: 'RIGHT',
    4: 'START',
    5: 'SELECT',
    11: 'A',
    12: 'B'
};

// Gamepad listener
// Communication layer between the Gamepad API and the Input class
export class Gamepad {
    constructor(mapping) {
        this.gamepad = null;
        this.state = {A:0,B:0,START:0,SELECT:0,LEFT:0,RIGHT:0,UP:0,DOWN:0};
        this.pullInterval = null;
        this.buttonMapping = mapping || xboxMapping;
    }

    // Initialize the gamepad listeners and set up the callbacks
    init(onPress, onRelease) {
        this.onPress = onPress;
        this.onRelease = onRelease;

        const self = this;
        window.addEventListener('gamepadconnected', function(e) {
            self.gamepad = e.gamepad;
            self.activatePull();
        });
        window.addEventListener('gamepaddisconnected', function(e) {
            self.gamepad = null;
            self.deactivatePull();
        });
    }

    activatePull() {
        this.deactivatePull();
        this.pullInterval = setInterval(this.pullState.bind(this), 100);
    }

    deactivatePull() {
        clearInterval(this.pullInterval);
    }

    // Check the state of the current gamepad in order to detect any press/release action
    pullState() {
        for (const index in this.buttonMapping) {
            const button = this.buttonMapping[index];
            const oldState = this.state[button];
            this.state[button] = this.gamepad.buttons[index].pressed;

            if (this.state[button] == 1 && oldState == 0) {
                this.managePress(button);
            } else if (this.state[button] == 0 && oldState == 1) {
                this.manageRelease(button);
            }
        }
    }

    managePress(key) {
        this.onPress(key);
    }

    manageRelease(key) {
        this.onRelease(key);
    }
}