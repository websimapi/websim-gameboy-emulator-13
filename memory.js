// memory.js - Optimized Memory and MBC implementations

import { UnimplementedException } from './utils.js';

// Optimized Memory unit using TypedArrays for better performance
export class Memory {
    constructor(cpu) {
        this.MEM_SIZE = 65536; // 64KB

        this.MBCtype = 0;
        this.banksize = 0x4000;
        this.rom = null;
        this.mbc = null;
        this.cpu = cpu;
        
        // Use TypedArray for faster memory access
        this.ram = new Uint8Array(this.MEM_SIZE);
        
        // Cache for frequently accessed memory regions
        this._cachedRegisters = new Uint8Array(256); // For IO registers 0xFF00-0xFFFF
        this._dirtyRegisterMap = new Uint8Array(256); // Track which registers need synchronizing
    }

    static get addresses() {
        return {
            VRAM_START: 0x8000,
            VRAM_END: 0x9FFF,
            EXTRAM_START: 0xA000,
            EXTRAM_END: 0xBFFF,
            OAM_START: 0xFE00,
            OAM_END: 0xFE9F,
            DEVICE_START: 0xFF00,
            DEVICE_END: 0xFF7F,
            DEVICERAM_START: 0xFF00,
            DEVICERAM_END: 0xFF7F
        };
    }

    reset() {
        // Clear main RAM and cache
        this.ram.fill(0, Memory.addresses.VRAM_START, Memory.addresses.VRAM_END + 1);
        this.ram.fill(0, Memory.addresses.DEVICE_START, Memory.addresses.DEVICE_END + 1);
        this.ram[0xFFFF] = 0;
        
        this._cachedRegisters.fill(0);
        this._dirtyRegisterMap.fill(0);
    }

    setRomData(data) {
        this.rom = data;
        this.loadRomBank(0);
        this.mbc = MBC.getMbcInstance(this, this.rom[0x147]);
        this.loadRomBank(1);
        this.mbc.loadRam(this.cpu.getGameName(), this.cpu.getRamSize());
    }

    loadRomBank(index) {
        const start = index ? 0x4000 : 0x0;
        const romStart = index * 0x4000;
        
        // Check for ROM array bounds safety
        if (romStart + this.banksize > this.rom.length) {
            throw new Error(`ROM bank ${index} is out of bounds. ROM size: ${this.rom.length}, requested: ${romStart + this.banksize}`);
        }
        
        // Use set method for TypedArray for faster copying
        this.ram.set(this.rom.subarray(romStart, romStart + this.banksize), start);
    }

    // Optimized Video RAM accessor
    vram(address) {
        if (address < Memory.addresses.VRAM_START || address > Memory.addresses.VRAM_END) {
            throw new Error('VRAM access in out of bounds address ' + address);
        }

        return this.ram[address];
    }

    // Optimized OAM RAM accessor
    oamram(address) {
        if (address < Memory.addresses.OAM_START || address > Memory.addresses.OAM_END) {
            throw new Error('OAMRAM access in out of bounds address ' + address);
        }

        return this.ram[address];
    }

    // Optimized device RAM accessor
    deviceram(address, value) {
        if (address < Memory.addresses.DEVICERAM_START || address > Memory.addresses.DEVICERAM_END) {
            throw new Error('Device RAM access in out of bounds address ' + address);
        }
        
        const cacheIndex = address - Memory.addresses.DEVICERAM_START;
        
        if (value === undefined) {
            // Sync from cache if dirty
            if (this._dirtyRegisterMap[cacheIndex]) {
                this.ram[address] = this._cachedRegisters[cacheIndex];
                this._dirtyRegisterMap[cacheIndex] = 0;
            }
            return this.ram[address];
        } else {
            this.ram[address] = value;
            this._cachedRegisters[cacheIndex] = value;
            this._dirtyRegisterMap[cacheIndex] = 0; // Not dirty since we're writing directly
        }
    }

    // Optimized memory read proxy function
    rb(addr) {
        // Fast paths for common memory regions
        if (addr < 0x8000) {
            // ROM area - directly read from RAM array
            return this.ram[addr];
        }
        
        if (addr >= 0xFF00 && addr <= 0xFF7F) {
            // IO registers - read from cache if available
            const cacheIndex = addr - 0xFF00;
            // Sync from cache if dirty
            if (this._dirtyRegisterMap[cacheIndex]) {
                this.ram[addr] = this._cachedRegisters[cacheIndex];
                this._dirtyRegisterMap[cacheIndex] = 0;
            }
            return this.ram[addr];
        }
        
        if (addr >= 0xFF10 && addr < 0xFF40) {
            // Audio registers with masks
            const mask = APU_MASKS[addr - 0xFF10];
            return this.ram[addr] | mask;
        }
        
        if ((addr >= 0xA000 && addr < 0xC000)) {
            // External RAM handled by MBC
            return this.mbc.readRam(addr);
        }
        
        // Default case - direct RAM access
        return this.ram[addr];
    }

    // Optimized memory write proxy function
    wb(addr, value) {
        if (addr < 0x8000 || (addr >= 0xA000 && addr < 0xC000)) { 
            // MBC area
            this.mbc.manageWrite(addr, value);
        } else if (addr >= 0xFF10 && addr <= 0xFF3F) { 
            // Sound registers
            this.cpu.apu.manageWrite(addr, value);
        } else if (addr == 0xFF00) { 
            // Input register - preserve joypad state
            this.ram[addr] = ((this.ram[addr] & 0x0F) | (value & 0x30));
            
            // Update cache
            const cacheIndex = addr - 0xFF00;
            this._cachedRegisters[cacheIndex] = this.ram[addr];
        } else {
            // Default case - direct write
            this.ram[addr] = value;
            
            // Update cache for IO registers
            if (addr >= 0xFF00 && addr <= 0xFF7F) {
                const cacheIndex = addr - 0xFF00;
                this._cachedRegisters[cacheIndex] = value;
            }
            
            // Special handling for certain addresses
            if ((addr & 0xFF00) == 0xFF00) {
                if (addr == 0xFF02 && (value & 0x80)) {
                    this.cpu.enableSerialTransfer();
                }
                if (addr == 0xFF04) {
                    this.cpu.resetDivTimer();
                }
                if (addr == 0xFF46) { // OAM DMA transfer
                    this.dmaTransfer(value);
                }
            }
        }
    }

    // Optimized DMA transfer
    dmaTransfer(startAddressPrefix) {
        const startAddress = (startAddressPrefix << 8);
        
        // Use TypedArray.set for better performance
        const sourceData = this.ram.subarray(startAddress, startAddress + 0xA0);
        this.ram.set(sourceData, Memory.addresses.OAM_START);
    }
}

// Pre-computed masks for audio registers for faster access
const APU_MASKS = [
    0x80,0x3F,0x00,0xFF,0xBF, // NR10-NR15
    0xFF,0x3F,0x00,0xFF,0xBF, // NR20-NR25
    0x7F,0xFF,0x9F,0xFF,0xBF, // NR30-NR35
    0xFF,0xFF,0x00,0x00,0xBF, // NR40-NR45
    0x00,0x00,0x70,           // NR50-NR52
    0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00, // Wave RAM
    0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00
];

// Optimized ExtRam using TypedArray
export class ExtRam {
    constructor() {
        this.ramSize = 0;
        this.ramBank = 0;
        this.gameName = '';
    }

    loadRam(game, size) {
        this.gameName = game;
        this.ramSize = size;
        this.ramBanksize = this.ramSize >= 0x2000 ? 8192 : 2048;

        const key = this.getStorageKey();
        let data = localStorage.getItem(key);
        
        // Use TypedArray for better performance
        if (!data) {
            this.extRam = new Uint8Array(this.ramSize);
        } else {
            try {
                const dataArray = JSON.parse(data);
                this.extRam = new Uint8Array(dataArray);
                
                if (this.extRam.length != size) {
                    console.error('Found RAM data but not matching expected size. Resetting.');
                    this.extRam = new Uint8Array(this.ramSize);
                }
            } catch (e) {
                console.error('Error parsing RAM data:', e);
                this.extRam = new Uint8Array(this.ramSize);
            }
        }
    }

    setRamBank(bank) {
        this.ramBank = bank;
    }

    manageWrite(offset, value) {
        if (offset >= 0 && this.ramBank * 8192 + offset < this.extRam.length) {
            this.extRam[this.ramBank * 8192 + offset] = value;
        }
    }

    manageRead(offset) {
        if (offset >= 0 && this.ramBank * 8192 + offset < this.extRam.length) {
            return this.extRam[this.ramBank * 8192 + offset];
        }
        return 0xFF; // Default to 0xFF for invalid read
    }

    getStorageKey() {
        return this.gameName + '_EXTRAM';
    }
    
    // Save RAM with throttling to avoid frequent writes
    saveRamData() {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
        }
        
        // Debounce save operations to avoid frequent localStorage writes
        this.saveTimeout = setTimeout(() => {
            try {
                localStorage.setItem(this.getStorageKey(), JSON.stringify(Array.from(this.extRam)));
            } catch (e) {
                console.error('Error saving RAM data:', e);
            }
        }, 500);
    }
}

// Memory bank controllers factory
export class MBC {
    // Create an MBC instance depending on the type specified in the cartridge
    static getMbcInstance(memory, type) {
        var instance;
        switch (type) {
            case 0x00:
                instance = new MBC0(memory);
                break;
            case 0x01: case 0x02: case 0x03:
                instance = new MBC1(memory);
                break;
            case 0x0F: case 0x10: case 0x11: case 0x12: case 0x13:
                instance = new MBC3(memory);
                break;
            case 0x19: case 0x1A: case 0x1B: case 0x1C: case 0x1D: case 0x1E:
                instance = new MBC5(memory);
                break;
            default:
                throw new UnimplementedException('MBC type not supported: ' + type.toString(16));
        }

        return instance;
    }
}

// MBC1 implementation
export class MBC1 {
    constructor(memory) {
        this.memory = memory;
        this.romBankNumber = 1;
        this.mode = 0; // mode 0 = ROM, mode 1 = RAM
        this.ramEnabled = true;
        this.extRam = new ExtRam();
    }

    loadRam(game, size) {
        this.extRam.loadRam(game, size);
    }

    manageWrite(addr, value) {
        switch (addr & 0xF000) {
            case 0x0000: case 0x1000: // enable RAM
                this.ramEnabled = (value & 0x0A) ? true : false;
                if (this.ramEnabled) {
                    this.extRam.saveRamData();
                }
                break;
            case 0x2000: case 0x3000: // ROM bank number lower 5 bits
                value &= 0x1F;
                if (value == 0) value = 1;
                var mask = this.mode ? 0 : 0xE0;
                this.romBankNumber = (this.romBankNumber & mask) + value;
                this.memory.loadRomBank(this.romBankNumber);
                break;
            case 0x4000: case 0x5000: // RAM bank or high bits ROM
                value &= 0x03;
                if (this.mode == 0) { // ROM upper bits
                    this.romBankNumber = (this.romBankNumber & 0x1F) | (value << 5);
                    this.memory.loadRomBank(this.romBankNumber);
                } else { // RAM bank
                    this.extRam.setRamBank(value);
                }
                break;
            case 0x6000: case 0x7000: // ROM / RAM mode
                this.mode = value & 1;
                break;
            case 0xA000: case 0xB000:
                this.extRam.manageWrite(addr - 0xA000, value);
                break;
        }
    }
    
    readRam(addr) {
        return this.extRam.manageRead(addr - 0xA000);
    }
}

// MBC3 implementation 
export class MBC3 {
    constructor(memory) {
        this.memory = memory;
        this.romBankNumber = 1;
        this.ramEnabled = true;
        this.extRam = new ExtRam();
        // Add RTC support variables
        this.rtcRegisters = new Uint8Array(5); // 5 RTC registers
        this.rtcLatched = false;
        this.rtcLatchValue = 0;
    }

    loadRam(game, size) {
        this.extRam.loadRam(game, size);
        // Try to load saved RTC data
        const rtcKey = game + '_RTC';
        const savedRTC = localStorage.getItem(rtcKey);
        if (savedRTC) {
            try {
                const rtcData = JSON.parse(savedRTC);
                this.rtcRegisters = new Uint8Array(rtcData);
            } catch (e) {
                console.warn("Could not load RTC data:", e);
            }
        }
    }

    manageWrite(addr, value) {
        switch (addr & 0xF000) {
            case 0x0000: case 0x1000: // enable RAM
                this.ramEnabled = (value & 0x0A) ? true : false;
                if (this.ramEnabled) {
                    this.extRam.saveRamData();
                    // Save RTC data too
                    if (this.rtcRegisters) {
                        const rtcKey = this.extRam.gameName + '_RTC';
                        localStorage.setItem(rtcKey, JSON.stringify(Array.from(this.rtcRegisters)));
                    }
                }
                break;
            case 0x2000: case 0x3000: // ROM bank number
                value &= 0x7F;
                if (value == 0) value = 1;
                this.romBankNumber = value;
                this.memory.loadRomBank(this.romBankNumber);
                break;
            case 0x4000: case 0x5000: // RAM bank or RTC register select
                if (value <= 0x03) {
                    // RAM bank
                    this.extRam.setRamBank(value);
                    this.rtcRegisterSelected = false;
                } else if (value >= 0x08 && value <= 0x0C) {
                    // RTC register
                    this.rtcRegisterSelected = true;
                    this.rtcRegisterIndex = value - 0x08;
                }
                break;
            case 0x6000: case 0x7000: // Latch clock data
                // Instead of throwing an exception, implement a basic latch mechanism
                if (this.rtcLatchValue == 0 && value == 1) {
                    this.rtcLatched = !this.rtcLatched;
                    this.updateRTC(); // Update RTC values when latching
                }
                this.rtcLatchValue = value;
                break;
            case 0xA000: case 0xB000:
                if (this.rtcRegisterSelected && this.rtcRegisterIndex >= 0 && this.rtcRegisterIndex < 5) {
                    // Write to RTC register
                    this.rtcRegisters[this.rtcRegisterIndex] = value;
                } else {
                    // Write to RAM
                    this.extRam.manageWrite(addr - 0xA000, value);
                }
                break;
        }
    }
    
    readRam(addr) {
        if (this.rtcRegisterSelected && this.rtcRegisterIndex >= 0 && this.rtcRegisterIndex < 5) {
            // Read from RTC register
            return this.rtcRegisters[this.rtcRegisterIndex];
        }
        // Read from RAM
        return this.extRam.manageRead(addr - 0xA000);
    }

    // Basic RTC implementation
    updateRTC() {
        // Simple implementation - just increment seconds counter
        // In a full implementation, we would track real time
        if (!this.rtcLatched) {
            const now = new Date();
            // Store seconds (0-59)
            this.rtcRegisters[0] = now.getSeconds();
            // Store minutes (0-59)
            this.rtcRegisters[1] = now.getMinutes();
            // Store hours (0-23)
            this.rtcRegisters[2] = now.getHours();
            // Store day counter lower 8 bits
            this.rtcRegisters[3] = (now.getDate() & 0xFF);
            // Store day counter high bit and flags
            this.rtcRegisters[4] = 0; // Day counter bit 8, Halt flag, Day counter carry bit
        }
    }
}

// MBC5 implementation (derived from MBC3 for compatibility)
export class MBC5 extends MBC3 {
    // MBC5 inherits behavior from MBC3 for now
}

// MBC0 exists for consistency and manages the no-MBC cartriges
export class MBC0 {
    constructor(memory) {
        this.memory = memory;
    }
    
    manageWrite(addr, value) {
        this.memory.loadRomBank(value);
    }
    
    readRam(addr) {
        return 0;
    }
    
    loadRam() {}
}