// GameboyJS - Modular Gameboy Emulator
// Main entry point that exposes the public API

// For now, we're importing from the monolithic gameboy.js
// As we create individual module files, we'll update these imports
import './gameboy.js';

// Create our namespace and expose the public API
const GameboyJS = window.GameboyJS || {};

// Export the main classes
export const Gameboy = GameboyJS.Gameboy;
export const CPU = GameboyJS.CPU;
export const GPU = GameboyJS.GPU;
export const Screen = GameboyJS.Screen;
export const Memory = GameboyJS.Memory;
export const Input = GameboyJS.Input;
export const Keyboard = GameboyJS.Keyboard;
export const Gamepad = GameboyJS.Gamepad;
export const APU = GameboyJS.APU;
export const Timer = GameboyJS.Timer;

// Export ROM-related classes
export const Rom = GameboyJS.Rom;
export const RomFileReader = GameboyJS.RomFileReader;
export const RomDropFileReader = GameboyJS.RomDropFileReader;
export const RomAjaxReader = GameboyJS.RomAjaxReader;

// Export utility classes and functions
export const Util = GameboyJS.Util;
export const Debug = GameboyJS.Debug;

// Export the default object for convenience
export default GameboyJS;