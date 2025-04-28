// opcodes.js - Re-exports all opcode mappings from separate files

// Import opcode maps from modular files
import { baseOpcodes } from './opcodes/opcodes-base.js';
import { loadOpcodes } from './opcodes/opcodes-load.js';
import { aluOpcodes } from './opcodes/opcodes-alu.js';
import { controlOpcodes } from './opcodes/opcodes-control.js';
import { cbOpcodes } from './opcodes/opcodes-cb.js';

// Combine all opcodes into the complete opcode map
export const opcodeMap = {
    ...baseOpcodes,      // 0x00-0x3F: Basic, increments, 8-bit operations
    ...loadOpcodes,      // 0x40-0x7F: Load/store operations
    ...aluOpcodes,       // 0x80-0xBF: Arithmetic and logic operations
    ...controlOpcodes,   // 0xC0-0xFF: Control flow, jumps, calls
};

// Export CB prefixed opcodes
export const opcodeCbmap = cbOpcodes;