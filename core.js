// core.js - Main Gameboy class and integration

import { Util } from './utils.js';
import { CPU } from './cpu.js';
import { Screen } from './screen.js';
import { GPU } from './gpu.js';
import { Input } from './input.js';
import { Rom } from './rom.js';
import { UnimplementedException } from './utils.js';
import { loadboot } from './bootrom.js';

// Define default options
const defaultOptions = {
    pad: {class: null, mapping: null}, // Will be imported from input.js
    zoom: 1,
    romReaders: [],
    statusContainerId: 'status',
    gameNameContainerId: 'game-name',
    errorContainerId: 'error'
};

// Gameboy class
export class Gameboy {
    constructor(canvas, options) {
        options = options || {};
        this.options = Util.extend({}, defaultOptions, options);

        var cpu = new CPU(this);
        var screen = new Screen(canvas, this.options.zoom);
        var gpu = new GPU(screen, cpu);
        cpu.gpu = gpu;

        // We'll update the keyboard import in input.js to address circular dependency
        var pad = new this.options.pad.class(this.options.pad.mapping);
        var input = new Input(cpu, pad);
        cpu.input = input;

        this.cpu = cpu;
        this.screen = screen;
        this.input = input;
        this.pad = pad;

        this.createRom(this.options.romReaders);

        this.statusContainer   = document.getElementById(this.options.statusContainerId) || document.createElement('div');
        this.gameNameContainer = document.getElementById(this.options.gameNameContainerId) || document.createElement('div');
        this.errorContainer    = document.getElementById(this.options.errorContainerId) || document.createElement('div');
    }

    // Create the ROM object and bind one or more readers
    createRom(readers) {
        var rom = new Rom(this);
        if (readers.length == 0) {
            // add the default rom reader
            var romReader = new RomFileReader();
            rom.addReader(romReader);
        } else {
            for (var i in readers) {
                if (readers.hasOwnProperty(i)) {
                    rom.addReader(readers[i]);
                }
            }
        }
    }

    startRom(rom) {
        this.errorContainer.classList.add('hide');
        this.cpu.reset();
        try {
            this.cpu.loadRom(rom.data);
            this.setStatus('Game Running :');
            this.setGameName(this.cpu.getGameName());
            this.cpu.run();
        } catch (e) {
            this.handleException(e);
        }
    }

    pause(value) {
        if (value) {
            this.setStatus('Game Paused :');
            this.cpu.pause();
        } else {
            this.setStatus('Game Running :');
            this.cpu.unpause();
        }
    }

    error(message) {
        this.setStatus('Error during execution');
        this.setError('An error occurred during execution:' + message);
        this.cpu.stop();
    }

    setStatus(status) {
        this.statusContainer.innerHTML = status;
    }
    
    // Display an error message
    setError(message) {
        this.errorContainer.classList.remove('hide');
        this.errorContainer.innerHTML = message;
    }
    
    // Display the name of the game running
    setGameName(name) {
        this.gameNameContainer.innerHTML = name;
    }
    
    setSoundEnabled(value) {
        if (value) {
            this.cpu.apu.connect();
        } else {
            this.cpu.apu.disconnect();
        }
    }
    
    setScreenZoom(value) {
        this.screen.setPixelSize(value);
    }
    
    handleException(e) {
        if (e instanceof UnimplementedException) {
            if (e.fatal) {
                this.error('This cartridge is not supported ('+ e.message +')');
            } else {
                console.error(e.message);
            }
        } else {
            throw e;
        }
    }
}

// Re-export the CPU class from core.js to maintain compatibility
export { CPU };