// cpu.js - CPU implementation and register management

import { opcodeMap, opcodeCbmap, CPUInterrupts } from './constants.js';
import { Memory } from './memory.js';
import { Timer } from './timer.js';
import { APU } from './audio.js';
import { ConsoleSerial } from './utils.js';
import { loadboot } from './bootrom.js';
import { cpuOps } from './cpu-operations.js';

// CPU class
export class CPU {
    constructor(gameboy) {
        this.gameboy = gameboy;

        this.r = {A:0, F: 0, B:0, C:0, D:0, E:0, H:0, L:0, pc:0, sp:0};
        this.IME = true;
        this.clock = {c: 0, serial: 0};
        this.isHalted = false;
        this.isPaused = false;
        this.usingBootRom = false;

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
    }

    loadRom(data) {
        this.memory.setRomData(data);
    }

    getRamSize() {
        var size = 0;
        switch (this.memory.rb(0x149)) {
            case 1:
                size = 2048;
                break;
            case 2:
                size = 2048 * 4;
                break;
            case 3:
                size = 2048 * 16;
                break;
        }

        return size;
    }

    getGameName() {
        var name = '';
        for (var i = 0x134; i < 0x143; i++) {
            var char = this.memory.rb(i) || 32;
            name += String.fromCharCode(char);
        }

        return name;
    }

    // Start the execution of the emulator
    run() {
        if (this.usingBootRom) {
            this.r.pc = 0x0000;
        } else {
            this.r.pc = 0x0100;
        }
        this.frame();
    }

    stop() {
        clearTimeout(this.nextFrameTimer);
    }

    // Fetch-and-execute loop
    // Will execute instructions for the duration of a frame
    frame() {
        if (!this.isPaused) {
            this.nextFrameTimer = setTimeout(this.frame.bind(this), 1000 / 60); 
        }

        try {
            var vblank = false;
            while (!vblank) {
                var oldInstrCount = this.clock.c;
                if (!this.isHalted) {
                    var opcode = this.fetchOpcode();
                    opcodeMap[opcode](this);
                    this.r.F &= 0xF0; // tmp fix

                    if (this.enableSerial) {
                        var instr = this.clock.c - oldInstrCount;
                        this.clock.serial += instr;
                        if (this.clock.serial >= 8 * this.SERIAL_INTERNAL_INSTR) {
                            this.endSerialTransfer();
                        }
                    }
                } else {
                    this.clock.c += 4;
                }

                var elapsed = this.clock.c - oldInstrCount;
                vblank = this.gpu.update(elapsed);
                this.timer.update(elapsed);
                this.input.update();
                this.apu.update(elapsed);
                this.checkInterrupt();
            }
            this.clock.c = 0;
        } catch (e) {
            this.gameboy.handleException(e);
        }
    }

    fetchOpcode() {
        var opcode = this.memory.rb(this.r.pc++);
        if (opcode === undefined) {
            console.log(opcode + ' at ' + (this.r.pc-1).toString(16));
            this.stop();
            return;
        }
        if (!opcodeMap[opcode]) {
            console.error('Unknown opcode '+opcode.toString(16)+' at address '+(this.r.pc-1).toString(16)+', stopping execution...');
            this.stop();
            return null;
        }

        return opcode;
    }

    // read register
    rr(register) {
        return this.r[register];
    }

    // write register
    wr(register, value) {
        this.r[register] = value;
    }

    halt() {
        this.isHalted = true;
    }
    
    unhalt() {
        this.isHalted = false;
    }
    
    pause() {
        this.isPaused = true;
    }
    
    unpause() {
        if (this.isPaused) {
            this.isPaused = false;
            this.frame();
        }
    }

    // Look for interrupt flags
    checkInterrupt() {
        if (!this.IME) {
            return;
        }
        for (var i = 0; i < 5; i++) {
            var IFval = this.memory.rb(0xFF0F);
            if ((IFval & (1 << i)) && this.isInterruptEnable(i)) {
                IFval &= (0xFF - (1<<i));
                this.memory.wb(0xFF0F, IFval);
                this.disableInterrupts();
                this.clock.c += 4; // 20 clocks to serve interrupt, with 16 for RSTn
                CPU.interruptRoutines[i](this);
                break;
            }
        }
    }

    // Set an interrupt flag
    requestInterrupt(type) {
        var IFval = this.memory.rb(0xFF0F);
        IFval |= (1 << type)
        this.memory.wb(0xFF0F, IFval);
        this.unhalt();
    }

    isInterruptEnable(type) {
        return (this.memory.rb(0xFFFF) & (1 << type)) != 0;
    }

    enableInterrupts() {
        this.IME = true;
    }
    
    disableInterrupts() {
        this.IME = false;
    }

    enableSerialTransfer() {
        this.enableSerial = 1;
        this.clock.serial = 0;
    }

    endSerialTransfer() {
        this.enableSerial = 0;
        var data = this.memory.rb(0xFF01);
        this.memory.wb(0xFF02, 0);
        this.serialHandler.out(data);
        this.memory.wb(0xFF01, this.serialHandler.in());
    }

    resetDivTimer() {
        this.timer.resetDiv();
    }
}