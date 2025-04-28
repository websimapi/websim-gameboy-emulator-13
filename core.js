// core.js - Main Gameboy class, CPU class, and core processing

import { opcodeMap, opcodeCbmap, CPUInterrupts } from './constants.js';
import { Util } from './utils.js';
import { Memory } from './memory.js';
import { Timer } from './timer.js';
import { APU } from './audio.js';
import { GPU } from './gpu.js';
import { Screen } from './screen.js';
import { Input } from './input.js';
import { Rom, RomFileReader, RomDropFileReader } from './rom.js';
import { UnimplementedException, ConsoleSerial } from './utils.js';

// Boot ROM data
function loadboot(cpu) {
    var boot = [
        0x31, 0xFE, 0xFF, 0xAF, 0x21, 0xFF, 0x9F, 0x32, 0xCB, 0x7C, 0x20, 0xFB, 0x21, 0x26, 0xFF, 0x0E,
        0x11, 0x3E, 0x80, 0x32, 0xE2, 0x0C, 0x3E, 0xF3, 0xE2, 0x32, 0x3E, 0x77, 0x77, 0x3E, 0xFC, 0xE0,
        0x47, 0x11, 0x04, 0x01, 0x21, 0x10, 0x80, 0x1A, 0xCD, 0x95, 0x00, 0xCD, 0x96, 0x00, 0x13, 0x7B,
        0xFE, 0x34, 0x20, 0xF3, 0x11, 0xD8, 0x00, 0x06, 0x08, 0x1A, 0x13, 0x22, 0x23, 0x05, 0x20, 0xF9,
        0x3E, 0x19, 0xEA, 0x10, 0x99, 0x21, 0x2F, 0x99, 0x0E, 0x0C, 0x3D, 0x28, 0x08, 0x32, 0x0D, 0x20,
        0xF9, 0x2E, 0x0F, 0x18, 0xF3, 0x67, 0x3E, 0x64, 0x57, 0xE0, 0x42, 0x3E, 0x91, 0xE0, 0x40, 0x04,
        0x1E, 0x02, 0x0E, 0x0C, 0xF0, 0x44, 0xFE, 0x90, 0x20, 0xFA, 0x0D, 0x20, 0xF7, 0x1D, 0x20, 0xF2,
        0x0E, 0x13, 0x24, 0x7C, 0x1E, 0x83, 0xFE, 0x62, 0x28, 0x06, 0x1E, 0xC1, 0xFE, 0x64, 0x20, 0x06,
        0x7B, 0xE2, 0x0C, 0x3E, 0x87, 0xE2, 0xF0, 0x42, 0x90, 0xE0, 0x42, 0x15, 0x20, 0xD2, 0x05, 0x20,
        0x4F, 0x16, 0x20, 0x18, 0xCB, 0x4F, 0x06, 0x04, 0xC5, 0xCB, 0x11, 0x17, 0xC1, 0xCB, 0x11, 0x17,
        0x05, 0x20, 0xF5, 0x22, 0x23, 0x22, 0x23, 0xC9, 0xCE, 0xED, 0x66, 0x66, 0xCC, 0x0D, 0x00, 0x0B,
        0x03, 0x73, 0x00, 0x83, 0x00, 0x0C, 0x00, 0x0D, 0x00, 0x08, 0x11, 0x1F, 0x88, 0x89, 0x00, 0x0E,
        0xDC, 0xCC, 0x6E, 0xE6, 0xDD, 0xDD, 0xD9, 0x99, 0xBB, 0xBB, 0x67, 0x63, 0x6E, 0x0E, 0xEC, 0xCC,
        0xDD, 0xDC, 0x99, 0x9F, 0xBB, 0xB9, 0x33, 0x3E, 0x3C, 0x42, 0xB9, 0xA5, 0xB9, 0xA5, 0x42, 0x3C,
        0x21, 0x04, 0x01, 0x11, 0xA8, 0x00, 0x1A, 0x13, 0xBE, 0x00, 0x00, 0x23, 0x7D, 0xFE, 0x34, 0x20,
        0xF5, 0x06, 0x19, 0x78, 0x86, 0x23, 0x05, 0x20, 0xFB, 0x86, 0x00, 0x00, 0x3E, 0x01, 0xE0, 0x50
    ];

    for (var i in boot) {
        cpu.memory[i] = boot[i];
    }
    cpu.r.pc = 0;
    cpu.usingBootRom = true;
}

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
            this.nextFrameTimer = setTimeout(this.frame.bind(this), 1000 / Screen.physics.FREQUENCY);
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
            if (Util.readBit(IFval, i) && this.isInterruptEnable(i)) {
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
        return Util.readBit(this.memory.rb(0xFFFF), type) != 0;
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

// CPU Operations
export const cpuOps = {
    LDrrnn: function(p, r1, r2) {p.wr(r2, p.memory.rb(p.r.pc));p.wr(r1, p.memory.rb(p.r.pc+1)); p.r.pc+=2;p.clock.c += 12;},
    LDrrar: function(p, r1, r2, r3) {cpuOps._LDav(p, Util.getRegAddr(p, r1, r2), p.r[r3]);p.clock.c += 8;},
    LDrrra: function(p, r1, r2, r3) {p.wr(r1, p.memory.rb(Util.getRegAddr(p, r2, r3)));p.clock.c += 8;},
    LDrn:   function(p, r1) {p.wr(r1, p.memory.rb(p.r.pc++));p.clock.c += 8;},
    LDrr:   function(p, r1, r2) {p.wr(r1, p.r[r2]);p.clock.c += 4;},
    LDrar:  function(p, r1, r2) {p.memory.wb(p.r[r1]+0xFF00, p.r[r2]);p.clock.c += 8;},
    LDrra:  function(p, r1, r2) {p.wr(r1, p.memory.rb(p.r[r2]+0xFF00));p.clock.c += 8;},
    LDspnn: function(p) {p.wr('sp', (p.memory.rb(p.r.pc + 1) << 8) + p.memory.rb(p.r.pc));p.r.pc+=2;p.clock.c += 12;},
    LDsprr: function(p, r1, r2) {p.wr('sp', Util.getRegAddr(p, r1, r2));p.clock.c += 8;},
    LDnnar: function(p, r1) {var addr=(p.memory.rb(p.r.pc + 1) << 8) + p.memory.rb(p.r.pc);p.memory.wb(addr,p.r[r1]);p.r.pc+=2; p.clock.c += 16;},
    LDrnna: function(p, r1) {var addr=(p.memory.rb(p.r.pc + 1) << 8) + p.memory.rb(p.r.pc);p.wr(r1, p.memory.rb(addr));p.r.pc+=2; p.clock.c += 16;},
    LDrrspn:function(p, r1, r2) {var rel = p.memory.rb(p.r.pc++);rel=Util.getSignedValue(rel);var val=p.r.sp + rel;
        var c = (p.r.sp&0xFF) + (rel&0xFF) > 0xFF;var h = (p.r.sp & 0xF) + (rel & 0xF) > 0xF;val &= 0xFFFF;
        var f = 0; if(h)f|=0x20;if(c)f|=0x10;p.wr('F', f);
        p.wr(r1, val >> 8);p.wr(r2, val&0xFF);
        p.clock.c+=12;},
    LDnnsp: function(p) {var addr = p.memory.rb(p.r.pc++) + (p.memory.rb(p.r.pc++)<<8); cpuOps._LDav(p, addr, p.r.sp & 0xFF);cpuOps._LDav(p, addr+1, p.r.sp >> 8);p.clock.c+=20;},
    LDrran: function(p, r1, r2){var addr = Util.getRegAddr(p, r1, r2);cpuOps._LDav(p, addr, p.memory.rb(p.r.pc++));p.clock.c+=12;},
    _LDav:  function(p, addr, val){p.memory.wb(addr, val);},
    LDHnar: function(p, r1){p.memory.wb(0xFF00 + p.memory.rb(p.r.pc++), p.r[r1]);p.clock.c+=12;},
    LDHrna: function(p, r1){p.wr(r1, p.memory.rb(0xFF00 + p.memory.rb(p.r.pc++)));p.clock.c+=12;},
    
    INCrr:  function(p, r1, r2) {p.wr(r2, (p.r[r2]+1)&0xFF); if (p.r[r2] == 0) p.wr(r1, (p.r[r1]+1)&0xFF);p.clock.c += 8;},
    INCrra: function(p, r1, r2) {var addr = Util.getRegAddr(p, r1, r2);var val = (p.memory.rb(addr)+1)&0xFF;var z = val==0;var h=(p.memory.rb(addr)&0xF)+1 > 0xF;
        p.memory.wb(addr, val);
        p.r.F&=0x10;if(h)p.r.F|=0x20;if(z)p.r.F|=0x80;
        p.clock.c+=12;},
    INCsp:  function(p){p.wr('sp', p.r.sp+1); p.r.sp &= 0xFFFF; p.clock.c+=8;},
    INCr:   function(p, r1) {var h = ((p.r[r1]&0xF) + 1)&0x10;p.wr(r1, (p.r[r1] + 1)&0xFF);var z = p.r[r1]==0;
        p.r.F&=0x10;if(h)p.r.F|=0x20;if(z)p.r.F|=0x80;
        p.clock.c += 4;},
    DECrr:  function(p, r1, r2) {p.wr(r2, (p.r[r2] - 1) & 0xFF); if (p.r[r2] == 0xFF) p.wr(r1, (p.r[r1] - 1)&0xFF);p.clock.c += 8;},
    DECsp:  function(p){p.wr('sp', p.r.sp-1); p.r.sp &= 0xFFFF; p.clock.c+=8;},
    DECr:   function(p, r1) {var h = (p.r[r1]&0xF) < 1;p.wr(r1, (p.r[r1] - 1) & 0xFF);var z = p.r[r1]==0;
        p.r.F&=0x10;p.r.F|=0x40;if(h)p.r.F|=0x20;if(z)p.r.F|=0x80;
        p.clock.c += 4;},
    DECrra: function(p, r1, r2){var addr = Util.getRegAddr(p, r1, r2);var val = (p.memory.rb(addr)-1)&0xFF;var z = val==0;var h=(p.memory.rb(addr)&0xF) < 1;
        p.memory.wb(addr, val);
        p.r.F&=0x10;p.r.F|=0x40;if(h)p.r.F|=0x20;if(z)p.r.F|=0x80;
        p.clock.c+=12;},
    ADDrr:  function(p, r1, r2) {var n = p.r[r2];cpuOps._ADDrn(p, r1, n); p.clock.c += 4;},
    ADDrn:  function(p, r1) {var n = p.memory.rb(p.r.pc++);cpuOps._ADDrn(p, r1, n); p.clock.c+=8;},
    _ADDrn: function(p, r1, n) {var h=((p.r[r1]&0xF)+(n&0xF))&0x10;p.wr(r1, p.r[r1]+n);var c=p.r[r1]&0x100;p.r[r1]&=0xFF;
            var f = 0;if (p.r[r1]==0)f|=0x80;if (h)f|=0x20;if (c)f|=0x10;p.wr('F', f);},
    ADDrrrr:function(p, r1, r2, r3, r4) {cpuOps._ADDrrn(p, r1, r2, (p.r[r3]<<8) + p.r[r4]); p.clock.c+=8;},
    ADDrrsp:function(p, r1, r2) {cpuOps._ADDrrn(p, r1, r2, p.r.sp); p.clock.c += 8;},
    ADDspn: function(p) {var v = p.memory.rb(p.r.pc++);v = Util.getSignedValue(v);
        var c = ((p.r.sp&0xFF) + (v&0xFF)) > 0xFF; var h = (p.r.sp & 0xF) + (v&0xF) > 0xF;
        var f = 0; if(h)f|=0x20;if(c)f|=0x10;p.wr('F', f);
        p.wr('sp', (p.r.sp + v) & 0xFFFF);
        p.clock.c+=16;},
    _ADDrrn:function(p, r1, r2, n) {var v1 = (p.r[r1]<<8) + p.r[r2];var v2 = n;
        var res = v1 + v2;var c = res&0x10000;var h = ((v1&0xFFF) + (v2&0xFFF))&0x1000;var z = p.r.F&0x80;
        res&=0xFFFF;p.r[r2]=res&0xFF;res=res>>8;p.r[r1]=res&0xFF;
        var f=0;if(z)f|=0x80;if(h)f|=0x20;if(c)f|=0x10;p.r.F=f;},
    ADCrr:  function(p, r1, r2) {var n = p.r[r2]; cpuOps._ADCrn(p, r1, n); p.clock.c += 4;},
    ADCrn:  function(p, r1) {var n = p.memory.rb(p.r.pc++); cpuOps._ADCrn(p, r1, n); p.clock.c += 8;},
    _ADCrn: function(p, r1, n) {
        var c = p.r.F&0x10?1:0;var h=((p.r[r1]&0xF)+(n&0xF)+c)&0x10;
        p.wr(r1, p.r[r1]+n+c);c=p.r[r1]&0x100;p.r[r1]&=0xFF;
        var f = 0;if (p.r[r1]==0)f|=0x80;if (h)f|=0x20;if (c)f|=0x10;p.r.F=f;},
    ADCrrra:function(p, r1, r2, r3) {var n = p.memory.rb(Util.getRegAddr(p, r2, r3)); cpuOps._ADCrn(p, r1, n); p.clock.c += 8;},
    ADDrrra:function(p, r1, r2, r3) {var v = p.memory.rb(Util.getRegAddr(p, r2, r3));var h=((p.r[r1]&0xF)+(v&0xF))&0x10;p.wr(r1, p.r[r1]+v);var c=p.r[r1]&0x100;p.r[r1]&=0xFF;
        var f = 0;if (p.r[r1]==0)f|=0x80;if (h)f|=0x20;if (c)f|=0x10;p.wr('F', f);
        p.clock.c += 8;},
    SUBr:   function(p, r1) {var n = p.r[r1];cpuOps._SUBn(p, n);p.clock.c += 4;},
    SUBn:   function(p) {var n = p.memory.rb(p.r.pc++);cpuOps._SUBn(p, n);p.clock.c += 8;},
    SUBrra: function(p, r1, r2) {var n = p.memory.rb(Util.getRegAddr(p, r1, r2));cpuOps._SUBn(p, n);p.clock.c+=8;},
    _SUBn:  function(p, n) {var c = p.r.A < n;var h = (p.r.A&0xF) < (n&0xF);
        p.wr('A', p.r.A - n);p.r.A&=0xFF; var z = p.r.A==0;
        var f = 0x40;if (z)f|=0x80;if (h)f|=0x20;if (c)f|=0x10;p.wr('F', f);},
    SBCn:   function(p) {var n = p.memory.rb(p.r.pc++); cpuOps._SBCn(p, n); p.clock.c += 8;},
    SBCr:   function(p, r1) {var n = p.r[r1]; cpuOps._SBCn(p, n); p.clock.c += 4;},
    SBCrra: function(p, r1, r2) {var v = p.memory.rb((p.r[r1] << 8) + p.r[r2]); cpuOps._SBCn(p, v); p.clock.c += 8;},
    _SBCn:  function(p, n) {var carry = p.r.F&0x10 ? 1 : 0;
        var c = p.r.A < n + carry;var h = (p.r.A&0xF) < (n&0xF) + carry;
        p.wr('A', p.r.A - n - carry); p.r.A&=0xFF; var z = p.r.A == 0;
        var f = 0x40;if(z)f|=0x80;if (h)f|=0x20;if (c)f|=0x10;p.r.F=f;},
    ORr:    function(p, r1) {p.r.A|=p.r[r1];p.r.F=(p.r.A==0)?0x80:0x00;p.clock.c += 4;},
    ORn:    function(p) {p.r.A|=p.memory.rb(p.r.pc++);p.r.F=(p.r.A==0)?0x80:0x00;p.clock.c += 8;},
    ORrra:  function(p, r1, r2) {p.r.A|=p.memory.rb((p.r[r1] << 8)+ p.r[r2]);p.r.F=(p.r.A==0)?0x80:0x00;p.clock.c += 8;},
    ANDr:   function(p, r1) {p.r.A&=p.r[r1];p.r.F=(p.r.A==0)?0xA0:0x20;p.clock.c += 4;},
    ANDn:   function(p) {p.r.A&=p.memory.rb(p.r.pc++);p.r.F=(p.r.A==0)?0xA0:0x20;p.clock.c += 8;},
    ANDrra: function(p, r1, r2) {p.r.A&=p.memory.rb(Util.getRegAddr(p, r1, r2));p.r.F=(p.r.A==0)?0xA0:0x20;p.clock.c += 8;},
    XORr:   function(p, r1) {p.r.A^=p.r[r1];p.r.F=(p.r.A==0)?0x80:0x00;p.clock.c += 4;},
    XORn:   function(p) {p.r.A^=p.memory.rb(p.r.pc++);p.r.F=(p.r.A==0)?0x80:0x00;p.clock.c += 8;},
    XORrra: function(p, r1, r2) {p.r.A^=p.memory.rb((p.r[r1] << 8)+ p.r[r2]);p.r.F=(p.r.A==0)?0x80:0x00;p.clock.c += 8;},
    CPr:    function(p, r1) {var n = p.r[r1];cpuOps._CPn(p, n); p.clock.c += 4;},
    CPn:    function(p) {var n =p.memory.rb(p.r.pc++);cpuOps._CPn(p, n);p.clock.c+=8;},
    CPrra:  function(p, r1, r2) {var n = p.memory.rb(Util.getRegAddr(p, r1, r2));cpuOps._CPn(p, n);p.clock.c+=8;},
    _CPn:   function(p, n) {
        var c = p.r.A < n;var z = p.r.A == n;var h = (p.r.A&0xF) < (n&0xF);
        var f = 0x40;if(z)f+=0x80;if (h)f+=0x20;if (c)f+=0x10;p.r.F=f;},
    RRCr:   function(p, r1) {p.r.F=0;var out=p.r[r1] & 0x01;if(out)p.r.F|=0x10;p.r[r1]=(p.r[r1]>>1)|(out*0x80);if(p.r[r1]==0)p.r.F|=0x80;p.clock.c+=4;},
    RRCrra: function(p, r1, r2) {var addr = Util.getRegAddr(p, r1, r2);p.r.F=0;var out=p.memory.rb(addr)&0x01;if(out)p.r.F|=0x10;p.memory.wb(addr, (p.memory.rb(addr)>>1)|(out*0x80));if(p.memory.rb(addr)==0)p.r.F|=0x80;p.clock.c+=12;},
    RLCr:   function(p, r1) {p.r.F=0;var out=p.r[r1]&0x80?1:0;if(out)p.r.F|=0x10;p.r[r1]=((p.r[r1]<<1)+out)&0xFF;if(p.r[r1]==0)p.r.F|=0x80;p.clock.c+=4;},
    RLCrra: function(p, r1, r2) {var addr = Util.getRegAddr(p, r1, r2);p.r.F=0;var out=p.memory.rb(addr)&0x80?1:0;if(out)p.r.F|=0x10;p.memory.wb(addr, ((p.memory.rb(addr)<<1)+out)&0xFF);if(p.memory.rb(addr)==0)p.r.F|=0x80;p.clock.c+=12;},
    RLr:    function(p, r1) {var c=(p.r.F&0x10)?1:0;p.r.F=0;var out=p.r[r1]&0x80;out?p.r.F|=0x10:p.r.F&=0xEF;p.r[r1]=((p.r[r1]<<1)+c)&0xFF;if(p.r[r1]==0)p.r.F|=0x80;p.clock.c+=4;},
    RLrra:  function(p, r1, r2) {var addr = Util.getRegAddr(p, r1, r2);var c=(p.r.F&0x10)?1:0;p.r.F=0;var out=p.memory.rb(addr)&0x80;out?p.r.F|=0x10:p.r.F&=0xEF;p.memory.wb(addr,((p.memory.rb(addr)<<1)+c)&0xFF);if(p.memory.rb(addr)==0)p.r.F|=0x80;p.clock.c+=12;},
    RRr:    function(p, r1) {var c=(p.r.F&0x10)?1:0;p.r.F=0;var out=p.r[r1]&0x01;out?p.r.F|=0x10:p.r.F&=0xEF;p.r[r1]=(p.r[r1]>>1)|(c*0x80);if(p.r[r1]==0)p.r.F|=0x80;p.clock.c+=4;},
    RRrra:  function(p, r1, r2) {var addr = Util.getRegAddr(p, r1, r2);var c=(p.r.F&0x10)?1:0;p.r.F=0;var out=p.memory.rb(addr)&0x01;out?p.r.F|=0x10:p.r.F&=0xEF;p.memory.wb(addr,(p.memory.rb(addr)>>1)|(c*0x80));if(p.memory.rb(addr)==0)p.r.F|=0x80;p.clock.c+=12;},
    SRAr:   function(p, r1) {p.r.F = 0;if (p.r[r1]&0x01)p.r.F|=0x10;var msb=p.r[r1]&0x80;p.r[r1]=(p.r[r1]>>1)|msb;if (p.r[r1]==0)p.r.F|=0x80;p.clock.c+=4;},
    SRArra: function(p, r1, r2) {var addr = Util.getRegAddr(p, r1, r2);p.r.F = 0;if (p.memory.rb(addr)&0x01)p.r.F|=0x10;var msb=p.memory.rb(addr)&0x80;p.memory.wb(addr, (p.memory.rb(addr)>>1)|msb);if (p.memory.rb(addr)==0)p.r.F|=0x80;p.clock.c+=12;},
    SLAr:   function(p, r1) {p.r.F = 0;if (p.r[r1]&0x80)p.r.F|=0x10;p.r[r1]=(p.r[r1]<<1)&0xFF;if (p.r[r1]==0)p.r.F|=0x80;p.clock.c+=4;},
    SLArra: function(p, r1, r2) {var addr = Util.getRegAddr(p, r1, r2);p.r.F = 0;if (p.memory.rb(addr)&0x80)p.r.F|=0x10;p.memory.wb(addr, (p.memory.rb(addr)<<1)&0xFF);if (p.memory.rb(addr)==0)p.r.F|=0x80;p.clock.c+=12;},
    SRLr:   function(p, r1) {p.r.F = 0;if (p.r[r1]&0x01)p.r.F|=0x10;p.r[r1]=p.r[r1]>>1;if (p.r[r1]==0)p.r.F|=0x80;p.clock.c+=4;},
    SRLrra: function(p, r1, r2) {var addr = Util.getRegAddr(p, r1, r2);p.r.F = 0;if (p.memory.rb(addr)&0x01)p.r.F|=0x10;p.memory.wb(addr, p.memory.rb(addr)>>1);if (p.memory.rb(addr)==0)p.r.F|=0x80;p.clock.c+=12;},
    BITir:  function(p, i, r1) {var mask=1<<i;var z=(p.r[r1]&mask)?0:1;var f=p.r.F&0x10;f |= 0x20;if(z)f|=0x80;p.r.F=f;p.clock.c+=4;},
    BITirra:function(p, i, r1, r2) {var addr = Util.getRegAddr(p, r1, r2);var mask=1<<i;var z=(p.memory.rb(addr)&mask)?0:1;var f=p.r.F&0x10;f |= 0x20;if(z)f|=0x80;p.r.F=f;p.clock.c+=8;},
    SETir:  function(p, i, r1) {var mask=1<<i;p.r[r1]|=mask;p.clock.c += 4;},
    SETirra:function(p, i, r1, r2) {var addr = Util.getRegAddr(p, r1, r2);var mask=1<<i;p.memory.wb(addr, p.memory.rb(addr)|mask);p.clock.c += 12;},
    RESir:  function(p, i, r1) {var mask=0xFF - (1<<i);p.r[r1]&=mask;p.clock.c += 4;},
    RESirra:function(p, i, r1, r2) {var addr = Util.getRegAddr(p, r1, r2);var mask=0xFF - (1<<i);p.memory.wb(addr, p.memory.rb(addr)&mask);p.clock.c += 12;},
    SWAPr:  function(p, r1) {p.r[r1] = cpuOps._SWAPn(p, p.r[r1]);p.clock.c+=4;},
    SWAPrra:function(p, r1, r2){var addr = (p.r[r1] << 8)+ p.r[r2]; p.memory.wb(addr, cpuOps._SWAPn(p, p.memory.rb(addr))); p.clock.c+=12;},
    _SWAPn: function(p, n){p.r.F = n==0?0x80:0;return ((n&0xF0) >> 4) | ((n&0x0F) << 4);},
    
    // Jump operations - the JPnn function was missing
    JPnn:   function(p) {p.wr('pc', (p.memory.rb(p.r.pc+1) << 8) + p.memory.rb(p.r.pc));p.clock.c += 16;},
    JRccn:  function(p, cc) {if (Util.testFlag(p, cc)){var v=p.memory.rb(p.r.pc++);v=Util.getSignedValue(v);p.r.pc += v;p.clock.c+=4;}else{p.r.pc++;}p.clock.c += 8;},
    JPccnn: function(p, cc) {if (Util.testFlag(p, cc)){p.wr('pc', (p.memory.rb(p.r.pc+1) << 8) + p.memory.rb(p.r.pc));p.clock.c+=4;}else{p.r.pc+=2;}p.clock.c += 12;},
    JPrr:   function(p, r1, r2) {p.r.pc = (p.r[r1] << 8) + p.r[r2];p.clock.c += 4;},
    JRn:    function(p) {var v=p.memory.rb(p.r.pc++);v=Util.getSignedValue(v);p.r.pc += v;p.clock.c += 12;},
    
    PUSHrr: function(p, r1, r2) {p.wr('sp', p.r.sp-1);p.memory.wb(p.r.sp, p.r[r1]);p.wr('sp', p.r.sp-1);p.memory.wb(p.r.sp, p.r[r2]);p.clock.c+=16;},
    POPrr:  function(p, r1, r2) {p.wr(r2, p.memory.rb(p.r.sp));p.wr('sp', p.r.sp+1);p.wr(r1, p.memory.rb(p.r.sp));p.wr('sp', p.r.sp+1);p.clock.c+=12;},
    RSTn:   function(p, n) {p.wr('sp', p.r.sp-1);p.memory.wb(p.r.sp,p.r.pc>>8);p.wr('sp', p.r.sp-1);p.memory.wb(p.r.sp,p.r.pc&0xFF);p.r.pc=n;p.clock.c+=16;},
    RET:    function(p) {p.r.pc = p.memory.rb(p.r.sp);p.wr('sp', p.r.sp+1);p.r.pc+=p.memory.rb(p.r.sp)<<8;p.wr('sp', p.r.sp+1);p.clock.c += 16;},
    RETcc:  function(p, cc) {if (Util.testFlag(p, cc)){p.r.pc = p.memory.rb(p.r.sp);p.wr('sp', p.r.sp+1);p.r.pc+=p.memory.rb(p.r.sp)<<8;p.wr('sp', p.r.sp+1);p.clock.c+=12;}p.clock.c+=8;},
    CALLnn: function(p) {cpuOps._CALLnn(p); p.clock.c+=24;},
    CALLccnn:function(p, cc) {if (Util.testFlag(p, cc)){cpuOps._CALLnn(p);p.clock.c+=12;}else{p.r.pc+=2;}p.clock.c+=12; },
    _CALLnn:function(p){p.wr('sp', p.r.sp - 1); p.memory.wb(p.r.sp, ((p.r.pc+2)&0xFF00)>>8);
        p.wr('sp', p.r.sp - 1); p.memory.wb(p.r.sp, (p.r.pc+2)&0x00FF);
        var j=p.memory.rb(p.r.pc)+(p.memory.rb(p.r.pc+1)<<8);p.r.pc=j;},
    
    CPL:    function(p) {p.wr('A', (~p.r.A)&0xFF);p.r.F|=0x60,p.clock.c += 4;},
    CCF:    function(p) {p.r.F&=0x9F;p.r.F&0x10?p.r.F&=0xE0:p.r.F|=0x10;p.clock.c += 4;},
    SCF:    function(p) {p.r.F&=0x9F;p.r.F|=0x10;p.clock.c+=4;},
    DAA:    function(p) {
        var sub = (p.r.F&0x40) ? 1 : 0; var h = (p.r.F&0x20)?1:0;var c = (p.r.F&0x10)?1:0;
        if (sub) {
            if (h) {
                p.r.A = (p.r.A - 0x6) & 0xFF;
            }
            if (c) {
                p.r.A -= 0x60;
            }
        } else {
            if ((p.r.A&0xF) > 9 || h) {
                p.r.A += 0x6;
            }
            if (p.r.A > 0x9F || c) {
                p.r.A += 0x60;
            }
        }
        if (p.r.A&0x100) c = 1;

        p.r.A &= 0xFF;
        p.r.F &= 0x40;if (p.r.A == 0) p.r.F|=0x80;if (c) p.r.F|=0x10;
        p.clock.c += 4;
    },
    HALT:   function(p) {p.halt(); p.clock.c+=4;},
    DI:     function(p) {p.disableInterrupts();p.clock.c += 4;},
    EI:     function(p) {p.enableInterrupts();p.clock.c += 4;},
    RETI:   function(p) {p.enableInterrupts();cpuOps.RET(p);},
    CB:     function(p) {var opcode = p.memory.rb(p.r.pc++);
        opcodeCbmap[opcode](p);
        p.clock.c+=4;}
};