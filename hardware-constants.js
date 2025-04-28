// hardware-constants.js - Contains hardware-specific constants

// Memory addresses
export const MemoryAddresses = {
  VRAM_START: 0x8000,
  VRAM_END: 0x9FFF,
  EXTRAM_START: 0xA000,
  EXTRAM_END: 0xBFFF,
  OAM_START: 0xFE00,
  OAM_END: 0xFE9F,
  DEVICE_START: 0xFF00,
  DEVICE_END: 0xFF7F
};

// Screen constants
export const ScreenConstants = {
  WIDTH: 160,
  HEIGHT: 144,
  FREQUENCY: 60
};

// APU registers 
export const APURegisters = {
  NR10: 0xFF10,
  NR11: 0xFF11,
  NR12: 0xFF12,
  NR13: 0xFF13,
  NR14: 0xFF14,
  NR21: 0xFF16,
  NR22: 0xFF17,
  NR23: 0xFF18,
  NR24: 0xFF19,
  NR30: 0xFF1A,
  NR31: 0xFF1B,
  NR32: 0xFF1C,
  NR33: 0xFF1D,
  NR34: 0xFF1E,
  NR41: 0xFF20,
  NR42: 0xFF21,
  NR43: 0xFF22,
  NR44: 0xFF23,
  NR50: 0xFF24,
  NR51: 0xFF25,
  NR52: 0xFF26
};

// Input key codes
export const InputKeys = {
  START: 0x80,
  SELECT: 0x40,
  B: 0x20,
  A: 0x10,
  DOWN: 0x08,
  UP: 0x04,
  LEFT: 0x02,
  RIGHT: 0x01
};

// CPU Interrupts
export const CPUInterrupts = {
  VBLANK: 0,
  LCDC: 1,
  TIMER: 2,
  SERIAL: 3,
  HILO: 4
};