// cpu.js - Heavily optimized CPU implementation

import { opcodeMap, opcodeCbmap, CPUInterrupts } from './constants.js';
import { Memory } from './memory.js';
import { Timer } from './timer.js';
import { APU } from './audio.js';
import { ConsoleSerial } from './utils.js';
import { loadboot } from './bootrom.js';
import { cpuOps } from './cpu-operations.js';

// CPU class with performance optimizations
export class CPU {
    constructor(gameboy) {
        this.gameboy = gameboy;

        // Use direct assignment instead of object literal for better performance
        this.r = new CpuRegisters();
        this.IME = true;
        this.clock = {c: 0, serial: 0};
        this.isHalted = false;
        this.isPaused = false;
        this.usingBootRom = false;
        this.debugMode = false;
        this.clockMultiplier = 1.0; // Speed control
        
        // Performance tracking with high-resolution timestamps
        this.lastFrameTime = performance.now();
        this.frameCount = 0;
        this.fpsUpdateInterval = 1000; // Update FPS once per second
        this.lastFpsUpdate = 0;
        this.currentFps = 0;
        this.fpsHistory = new Array(60).fill(60); // Keep track of recent FPS values
        this.frameSkipCount = 0;
        this.maxFrameSkip = 2; // Maximum number of frames to skip when lagging
        this.frameSkipThreshold = 50; // FPS below which we start skipping frames
        
        // Pre-allocate reusable buffers for common operations
        this._tempBuffer = new Uint8Array(256);
        
        // Execution metrics 
        this.instructionsPerFrame = 0;
        this.totalInstructions = 0;
        this.lastPerformanceUpdate = 0;
        
        this.createDevices();
    }

    static get INTERRUPTS() {
        return CPUInterrupts;
    }

    static interruptRoutines = {
        0: function(p){cpuOps.RSTn(p, 0x40);},
        1: function(p){cpuOps.RSTn(p, 0x48);},
        2: function(p){cpuOps.RSTn(p, 0x50);},
        3: function(p){cpuOps.RSTn(p, 0x58);},
        4: function(p){cpuOps.RSTn(p, 0x60);}
    };

    createDevices() {
        this.memory = new Memory(this);
        this.timer = new Timer(this, this.memory);
        this.apu = new APU(this.memory);

        this.SERIAL_INTERNAL_INSTR = 512; // instr to wait per bit if internal clock
        this.enableSerial = 0;
        this.serialHandler = ConsoleSerial;
    }

    reset() {
        this.memory.reset();
        this.r.sp = 0xFFFE;
        this.r.pc = 0;
        this.r.A = 0;
        this.r.F = 0;
        this.r.B = 0;
        this.r.C = 0;
        this.r.D = 0;
        this.r.E = 0;
        this.r.H = 0;
        this.r.L = 0;
        this.IME = true;
        this.clock.c = 0;
        this.clock.serial = 0;
        this.isHalted = false;
        this.instructionsPerFrame = 0;
        this.totalInstructions = 0;
        
        if (this.gameboy.debugger) {
            this.gameboy.debugger.log('CPU reset');
        }
    }

    loadRom(data) {
        try {
            this.memory.setRomData(data);
            if (this.gameboy.debugger) {
                this.gameboy.debugger.log(`ROM loaded: ${this.getGameName()}`);
            }
        } catch (error) {
            if (this.gameboy.debugger) {
                this.gameboy.debugger.handleError(error, 'Loading ROM');
            } else {
                throw error;
            }
        }
    }

    getRamSize() {
        const ramSizeCode = this.memory.rb(0x149);
        switch (ramSizeCode) {
            case 1: return 2048; // 2KB
            case 2: return 8192; // 8KB
            case 3: return 32768; // 32KB
            case 4: return 131072; // 128KB
            case 5: return 65536; // 64KB
            default: return 0;
        }
    }

    getGameName() {
        // Use pre-allocated buffer instead of creating strings in a loop
        for (let i = 0x134, j = 0; i < 0x143; i++, j++) {
            this._tempBuffer[j] = this.memory.rb(i) || 32;
        }
        // Only create string once at the end
        return String.fromCharCode.apply(null, this._tempBuffer.subarray(0, 0x143 - 0x134));
    }

    // Optimized run method using requestAnimationFrame for more consistent timing
    run() {
        if (this.usingBootRom) {
            this.r.pc = 0x0000;
        } else {
            this.r.pc = 0x0100;
        }
        
        this.isPaused = false;
        this.lastFrameTime = performance.now();
        this.frameCount = 0;
        this.lastFpsUpdate = this.lastFrameTime;
        
        // Use requestAnimationFrame for better timing
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
        }
        this.rafId = requestAnimationFrame(this.frameRaf.bind(this));
        
        if (this.gameboy.debugger) {
            this.gameboy.debugger.log('CPU execution started with optimized timing');
        }
    }

    stop() {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        if (this.nextFrameTimer) {
            clearTimeout(this.nextFrameTimer);
            this.nextFrameTimer = null;
        }
        
        if (this.gameboy.debugger) {
            this.gameboy.debugger.log('CPU execution stopped');
        }
    }

    // New optimized frame method using requestAnimationFrame for smoother animation
    frameRaf(timestamp) {
        if (this.isPaused) {
            this.rafId = null;
            return;
        }
        
        this.rafId = requestAnimationFrame(this.frameRaf.bind(this));
        
        try {
            // Track frame performance with high-resolution timer
            const now = timestamp || performance.now();
            const frameDelta = now - this.lastFrameTime;
            this.lastFrameTime = now;
            
            // Calculate target time per frame for 60fps (16.67ms)
            const targetFrameTime = 1000 / 60;
            
            // Skip frame if we're running too slowly and frame skipping is enabled
            if (this.frameSkipCount > 0) {
                this.frameSkipCount--;
                return;
            }
            
            // Update FPS counter every second
            if (now - this.lastFpsUpdate > this.fpsUpdateInterval) {
                this.currentFps = (this.frameCount * 1000) / (now - this.lastFpsUpdate);
                
                // Update FPS history
                this.fpsHistory.shift();
                this.fpsHistory.push(this.currentFps);
                
                // Calculate average FPS
                const avgFps = this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;
                
                // Adjust frame skipping based on performance
                if (avgFps < this.frameSkipThreshold && this.maxFrameSkip > 0) {
                    this.frameSkipCount = Math.min(
                        Math.floor(this.frameSkipThreshold / avgFps), 
                        this.maxFrameSkip
                    );
                }
                
                // Reset counters
                this.frameCount = 0;
                this.lastFpsUpdate = now;
                this.instructionsPerFrame = 0;
            }
            
            this.frameCount++;
            
            // Execute a frame's worth of instructions
            this.executeFrame();
            
        } catch (e) {
            if (this.gameboy.debugger) {
                this.gameboy.debugger.handleError(e, 'CPU Execution');
            } else {
                this.gameboy.handleException(e);
            }
        }
    }
    
    // Execute a full frame of CPU instructions
    executeFrame() {
        let vblank = false;
        this.instructionsPerFrame = 0;
        
        while (!vblank) {
            const oldInstrCount = this.clock.c;
            
            if (!this.isHalted) {
                this.executeInstruction();
                this.instructionsPerFrame++;
                this.totalInstructions++;

                if (this.enableSerial) {
                    const instr = this.clock.c - oldInstrCount;
                    this.clock.serial += instr;
                    if (this.clock.serial >= 8 * this.SERIAL_INTERNAL_INSTR) {
                        this.endSerialTransfer();
                    }
                }
            } else {
                this.clock.c += 4;
            }

            const elapsed = this.clock.c - oldInstrCount;
            vblank = this.gpu.update(elapsed);
            this.timer.update(elapsed);
            this.input.update();
            this.apu.update(elapsed);
            this.checkInterrupt();
        }
        
        this.clock.c = 0;
        
        // Update debug performance metrics, but only if debugger is enabled
        if (this.gameboy.debugger && this.gameboy.debugger.enabled) {
            this.gameboy.debugger.updatePerformanceMetrics();
            this.gameboy.debugger.updateUI();
        }
    }

    // Optimized instruction execution with inline opcode lookup
    executeInstruction() {
        try {
            const opcode = this.memory.rb(this.r.pc++);
            const operation = opcodeMap[opcode];
            
            if (!operation) {
                throw new Error(`Unknown opcode ${opcode.toString(16)} at address ${(this.r.pc-1).toString(16)}`);
            }
            
            // Only check for breakpoints if debugger is actually enabled and active
            if (this.gameboy.debugger && this.gameboy.debugger.enabled) {
                this.gameboy.debugger.recordOpcode(this.r.pc - 1, opcode);
                
                // Check for breakpoints
                if (this.gameboy.debugger.checkBreakpoint(this.r.pc - 1)) {
                    return;
                }
            }
            
            operation(this);
            this.r.F &= 0xF0; // Ensure lower 4 bits are always clear
        } catch (error) {
            if (this.gameboy.debugger) {
                this.gameboy.debugger.handleError(error, 'Execute Instruction');
            } else {
                console.error(`CPU error: ${error.message} at ${(this.r.pc-1).toString(16)}`);
                this.stop();
            }
        }
    }

    // Execute a single instruction - specifically for debugger stepping
    executeSingleInstruction() {
        if (!this.isHalted) {
            this.executeInstruction();
        } else {
            this.clock.c += 4;
        }
        
        this.timer.update(4);
        this.input.update();
        this.apu.update(4);
        this.checkInterrupt();
        
        if (this.gameboy.debugger && this.gameboy.debugger.enabled) {
            this.gameboy.debugger.updateUI(true); // Force update
        }
    }

    // Direct register read for better performance
    rr(register) {
        return this.r[register];
    }

    // Direct register write for better performance
    wr(register, value) {
        this.r[register] = value;
    }

    halt() {
        this.isHalted = true;
        if (this.gameboy.debugger) {
            this.gameboy.debugger.log('CPU halted');
        }
    }
    
    unhalt() {
        this.isHalted = false;
        if (this.gameboy.debugger) {
            this.gameboy.debugger.log('CPU unhalted');
        }
    }
    
    pause() {
        this.isPaused = true;
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        
        if (this.gameboy.debugger) {
            this.gameboy.debugger.log('CPU paused');
        }
    }
    
    unpause() {
        if (this.isPaused) {
            this.isPaused = false;
            this.lastFrameTime = performance.now();
            this.rafId = requestAnimationFrame(this.frameRaf.bind(this));
            
            if (this.gameboy.debugger) {
                this.gameboy.debugger.log('CPU unpaused');
            }
        }
    }

    // Optimized interrupt handling
    checkInterrupt() {
        if (!this.IME) {
            return;
        }
        
        const IFval = this.memory.rb(0xFF0F);
        if (IFval === 0) return; // Quick exit if no interrupts pending
        
        const IEval = this.memory.rb(0xFFFF);
        const activeInterrupts = IFval & IEval;
        if (activeInterrupts === 0) return; // No enabled interrupts pending
        
        // Find the highest priority interrupt (lowest bit position)
        for (let i = 0; i < 5; i++) {
            if (activeInterrupts & (1 << i)) {
                // Clear the interrupt flag
                this.memory.wb(0xFF0F, IFval & ~(1 << i));
                this.disableInterrupts();
                this.clock.c += 4; // 20 clocks to serve interrupt, with 16 for RSTn
                CPU.interruptRoutines[i](this);
                
                if (this.gameboy.debugger && this.gameboy.debugger.enabled) {
                    this.gameboy.debugger.log(`Interrupt ${i} serviced`);
                }
                break;
            }
        }
    }

    requestInterrupt(type) {
        const IFval = this.memory.rb(0xFF0F);
        this.memory.wb(0xFF0F, IFval | (1 << type));
        this.unhalt();
        
        if (this.gameboy.debugger && this.gameboy.debugger.enabled) {
            this.gameboy.debugger.log(`Interrupt ${type} requested`);
        }
    }

    isInterruptEnable(type) {
        return (this.memory.rb(0xFFFF) & (1 << type)) !== 0;
    }

    enableInterrupts() {
        this.IME = true;
        if (this.gameboy.debugger && this.gameboy.debugger.enabled) {
            this.gameboy.debugger.log('Interrupts enabled');
        }
    }
    
    disableInterrupts() {
        this.IME = false;
        if (this.gameboy.debugger && this.gameboy.debugger.enabled) {
            this.gameboy.debugger.log('Interrupts disabled');
        }
    }

    enableSerialTransfer() {
        this.enableSerial = 1;
        this.clock.serial = 0;
    }

    endSerialTransfer() {
        this.enableSerial = 0;
        const data = this.memory.rb(0xFF01);
        this.memory.wb(0xFF02, 0);
        this.serialHandler.out(data);
        this.memory.wb(0xFF01, this.serialHandler.in());
    }

    resetDivTimer() {
        this.timer.resetDiv();
    }
    
    // New method to control emulation speed
    setClockSpeed(multiplier) {
        this.clockMultiplier = Math.max(0.1, Math.min(5.0, multiplier));
        if (this.gameboy.debugger && this.gameboy.debugger.enabled) {
            this.gameboy.debugger.log(`Clock speed set to ${this.clockMultiplier}x`);
        }
        return this.clockMultiplier;
    }
}

// Use a class for CPU registers to improve performance
class CpuRegisters {
    constructor() {
        this.A = 0;
        this.F = 0;
        this.B = 0;
        this.C = 0;
        this.D = 0;
        this.E = 0;
        this.H = 0;
        this.L = 0;
        this.pc = 0;
        this.sp = 0;
    }
}