// Entry point for the GameboyJS emulator
// This file will import all modules and export the public API

// Import dependencies
import { Gameboy } from './gameboy.js';
import { RomFileReader, RomDropFileReader } from './rom.js';
import { Keyboard, Gamepad } from './input.js';
import { Util, Debug } from './util.js';

// Re-export public classes and functions
const GameboyJS = {
  // Core
  Gameboy,
  CPU: require('./gameboy.js').CPU,
  
  // ROM
  RomFileReader,
  RomDropFileReader,
  
  // Input
  Keyboard,
  Gamepad,
  
  // Utilities
  Util,
  Debug,
  
  // Add more exports as modules are created
  Screen: require('./screen.js').Screen,
  Memory: require('./memory.js').Memory,
  APU: require('./apu.js').APU,
  Timer: require('./timer.js').Timer,
  Channel1: require('./channel1.js').Channel1,
  Channel3: require('./channel3.js').Channel3,
  Channel4: require('./channel4.js').Channel4,
};

// Export the main namespace
export default GameboyJS;