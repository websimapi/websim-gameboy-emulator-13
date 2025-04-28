// index.js - Main entry point for the GameboyJS emulator
// This file imports all modules and exports the public API

// Import all modules (these will be created in subsequent steps)
import { Gameboy } from './core.js';
import { Memory, MBC } from './memory.js';
import { GPU } from './gpu.js';
import { Screen } from './screen.js';
import { Input, Keyboard, Gamepad } from './input.js';
import { APU, Channel1, Channel3, Channel4 } from './audio.js';
import { Timer } from './timer.js';
import { Rom, RomFileReader, RomDropFileReader, RomAjaxReader } from './rom.js';
import { Util, Debug, UnimplementedException, ConsoleSerial, DummySerial } from './utils.js';
import { opcodeMap, opcodeCbmap } from './constants.js';

// Create the main GameboyJS namespace to maintain compatibility with existing code
const GameboyJS = {
  // Core components
  Gameboy,
  CPU: Gameboy.CPU, // We'll define CPU as part of the Gameboy module
  
  // Memory
  Memory,
  MBC,
  
  // GPU and display
  GPU,
  Screen,
  
  // Input
  Input,
  Keyboard,
  Gamepad,
  
  // Audio
  APU,
  Channel1,
  Channel3,
  Channel4,
  
  // Timer
  Timer,
  
  // ROM handling
  Rom,
  RomFileReader,
  RomDropFileReader,
  RomAjaxReader,
  
  // Utilities
  Util,
  Debug,
  UnimplementedException,
  ConsoleSerial,
  DummySerial,
  
  // OpCode maps
  opcodeMap,
  opcodeCbmap
};

// Export the namespace as default
export default GameboyJS;

// Also export individual components for those who prefer named imports
export {
  Gameboy,
  Memory, MBC,
  GPU, Screen,
  Input, Keyboard, Gamepad,
  APU, Channel1, Channel3, Channel4,
  Timer,
  Rom, RomFileReader, RomDropFileReader, RomAjaxReader,
  Util, Debug, UnimplementedException, ConsoleSerial, DummySerial,
  opcodeMap, opcodeCbmap
};