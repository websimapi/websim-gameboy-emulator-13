// core.js - Optimized core GameBoy emulation

import { Util } from './utils.js';
import { CPU } from './cpu.js';
import { Screen } from './screen.js';
import { GPU } from './gpu.js';
import { Input } from './input.js';
import { Rom } from './rom.js';
import { UnimplementedException } from './utils.js';
import { loadboot } from './bootrom.js';
import { DebugSystem } from './debug.js';

// Define default options
const defaultOptions = {
    pad: {class: null, mapping: null}, // Will be imported from input.js
    zoom: 1,
    romReaders: [],
    statusContainerId: 'status',
    gameNameContainerId: 'game-name',
    errorContainerId: 'error',
    debugMode: false,
    useWebGL: true, // Enable WebGL rendering by default
    enableFrameSkipping: true // Enable frame skipping for performance
};

// Optimized Gameboy class
export class Gameboy {
    constructor(canvas, options) {
        options = options || {};
        this.options = Util.extend({}, defaultOptions, options);

        // Performance metrics
        this.performanceMetrics = {
            fps: 0,
            frameTime: 0,
            startTime: performance.now(),
            frames: 0,
            lastUpdate: 0
        };
        
        // Flag for monitoring component initialization
        this.componentsReady = false;
        
        // Initialize components
        this.initializeComponents(canvas);
        
        // Initialize ROM handling
        this.createRom(this.options.romReaders);

        // Initialize UI references
        this.statusContainer = document.getElementById(this.options.statusContainerId) || document.createElement('div');
        this.gameNameContainer = document.getElementById(this.options.gameNameContainerId) || document.createElement('div');
        this.errorContainer = document.getElementById(this.options.errorContainerId) || document.createElement('div');
        
        // Mark components as ready
        this.componentsReady = true;
    }
    
    // Initialize all emulator components
    initializeComponents(canvas) {
        // Create CPU first
        const cpu = new CPU(this);
        
        // Create Screen with WebGL support when available
        const screen = new Screen(canvas, this.options.zoom);
        
        // Create GPU
        const gpu = new GPU(screen, cpu);
        cpu.gpu = gpu;

        // Create Input handling
        const pad = new this.options.pad.class(this.options.pad.mapping);
        const input = new Input(cpu, pad);
        cpu.input = input;

        // Store references
        this.cpu = cpu;
        this.screen = screen;
        this.input = input;
        this.pad = pad;

        // Initialize debugger if enabled
        if (this.options.debugMode) {
            this.debugger = new DebugSystem(this);
        }
    }

    // Create the ROM object and bind readers
    createRom(readers) {
        var rom = new Rom(this);
        if (readers.length == 0) {
            // Add the default rom reader
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

    // Start running a loaded ROM
    startRom(rom) {
        // Clear any previous errors
        this.errorContainer.classList.add('hide');
        
        // Reset the CPU
        this.cpu.reset();
        
        try {
            // Load ROM data into memory
            this.cpu.loadRom(rom.data);
            
            // Update UI status
            this.setStatus('Game Running:');
            this.setGameName(this.cpu.getGameName());
            
            // Initialize performance metrics
            this.performanceMetrics.startTime = performance.now();
            this.performanceMetrics.frames = 0;
            this.performanceMetrics.lastUpdate = performance.now();
            
            // Start the CPU
            this.cpu.run();
            
            if (this.debugger) {
                this.debugger.log(`Game started: ${this.cpu.getGameName()}`);
            }
            
            // Start performance monitoring
            if (!this.performanceMonitorId) {
                this.performanceMonitorId = setInterval(() => this.updatePerformanceMetrics(), 1000);
            }
        } catch (e) {
            this.handleException(e);
        }
    }

    // Pause or unpause emulation
    pause(value) {
        if (value) {
            this.setStatus('Game Paused :');
            this.cpu.pause();
        } else {
            this.setStatus('Game Running :');
            this.cpu.unpause();
        }
    }
    
    // Toggle debugger on/off
    toggleDebugger() {
        if (this.debugger) {
            const isEnabled = this.debugger.toggle();
            return isEnabled;
        } else {
            this.debugger = new DebugSystem(this);
            // Make sure it's in performance mode by default
            this.debugger.performanceMode = true;
            this.debugger.toggle();
            return true;
        }
    }

    // Display an error
    error(message) {
        this.setStatus('Error during execution');
        this.setError('An error occurred during execution: ' + message);
        this.cpu.stop();
        
        if (this.debugger) {
            this.debugger.log(`ERROR: ${message}`);
        }
    }

    // Update status text
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
    
    // Toggle sound on/off
    setSoundEnabled(value) {
        if (value) {
            this.cpu.apu.connect();
        } else {
            this.cpu.apu.disconnect();
        }
    }
    
    // Set screen zoom level
    setScreenZoom(value) {
        this.screen.setPixelSize(value);
    }
    
    // Handle exceptions
    handleException(e) {
        if (this.debugger) {
            this.debugger.handleError(e, 'Gameboy Execution');
        } else if (e instanceof UnimplementedException) {
            if (e.fatal) {
                this.error('This cartridge is not supported ('+ e.message +')');
            } else {
                console.error(e.message);
            }
        } else {
            this.error(e.message || String(e));
            console.error(e);
        }
    }
    
    // Update performance metrics
    updatePerformanceMetrics() {
        const now = performance.now();
        const elapsed = now - this.performanceMetrics.lastUpdate;
        
        if (elapsed >= 1000) { // Update once per second
            this.performanceMetrics.fps = 
                (this.cpu.frameCount * 1000) / elapsed;
            
            this.performanceMetrics.frameTime = 
                this.cpu.frameCount > 0 ? elapsed / this.cpu.frameCount : 0;
            
            // Reset counters
            this.cpu.frameCount = 0;
            this.performanceMetrics.lastUpdate = now;
            
            // Update debugger if active
            if (this.debugger && this.debugger.enabled) {
                this.debugger.updatePerformanceMetrics();
            }
        }
    }
    
    // Set emulation speed (1.0 = normal)
    setSpeed(multiplier) {
        return this.cpu.setClockSpeed(multiplier);
    }
    
    // Clean up resources when emulator is no longer needed
    dispose() {
        // Stop CPU
        if (this.cpu) {
            this.cpu.stop();
        }
        
        // Stop performance monitoring
        if (this.performanceMonitorId) {
            clearInterval(this.performanceMonitorId);
            this.performanceMonitorId = null;
        }
        
        // Clean up debugger
        if (this.debugger && this.debugger.enabled) {
            this.debugger.toggle();
        }
        
        // Remove any event listeners or other resources
        // ...
        
        console.log('GameBoy emulator resources released');
    }
}

// Re-export the CPU class from core.js to maintain compatibility
export { CPU };