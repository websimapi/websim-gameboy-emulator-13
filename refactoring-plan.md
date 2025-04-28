# GameboyJS Refactoring Plan

## Proposed File Structure

1. **core.js**
   - Main Gameboy class
   - CPU class and core processing
   - Main execution loop and state management

2. **memory.js**
   - Memory class
   - Memory Bank Controllers (MBC0, MBC1, MBC3, MBC5)
   - External RAM handling

3. **gpu.js**
   - GPU implementation
   - Tile and sprite rendering
   - Background and window handling

4. **screen.js**
   - Canvas rendering
   - Pixel processing
   - Screen scaling

5. **input.js**
   - Input class
   - Keyboard handler
   - Gamepad handler

6. **audio.js**
   - APU (Audio Processing Unit)
   - Sound channels (Channel1, Channel3, Channel4)
   - Audio context management

7. **timer.js**
   - Timer implementation
   - DIV, TIMA, TMA, TAC registers

8. **rom.js**
   - ROM class
   - ROM readers (file, AJAX, drop)
   - ROM validation

9. **utils.js**
   - Utility functions
   - Debug tools
   - Exception handling
   - Serial port handlers

10. **constants.json**
    - OpCode mappings
    - Memory addresses
    - Hardware constants

11. **index.js**
    - Main entry point
    - Import and export all modules
    - Public API definition

## Next Steps

1. First file to work on: **index.js** - Set up the module system and imports/exports
2. Next file to work on: **core.js** - Extract the core CPU and Gameboy classes

