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

10. **constants.js**
    - OpCode mappings
    - Memory addresses
    - Hardware constants

11. **index.js**
    - Main entry point
    - Import and export all modules
    - Public API definition

## Completed Files
1. **index.js** - Set up the module system and imports/exports
   - Created main entry point for the modular system
   - Set up imports and exports for all modules
   - Made it compatible with ES modules

2. **constants.js** - Created constants and opcode mappings
   - Created placeholder for opcode maps
   - Defined memory addresses
   - Defined screen constants
   - Defined APU registers
   - Defined input keys
   - Defined CPU interrupts

3. **core.js** - Extracted the core CPU and Gameboy classes
   - Implemented the main Gameboy class from existing code
   - Extracted the CPU class with core functionality
   - Defined CPU operations that will be referenced by opcodes
   - Resolved circular dependency by making cpuOps part of core.js

4. **utils.js** - Extracted utility functions and serial handlers
   - Implemented the Util helper functions
   - Moved exception handling
   - Moved debug tools
   - Moved serial port handlers

5. **memory.js** - Extracted memory and MBC management
   - Implemented the Memory class
   - Extracted MBC implementations
   - Extracted ExtRam handling

6. **gpu.js** - Extracted GPU implementation
   - Extracted the GPU class
   - Implemented tile and sprite rendering
   - Implemented background and window handling

7. **screen.js** - Extracted screen rendering
   - Implemented the Screen class
   - Set up canvas manipulation
   - Handled screen scaling

8. **input.js** - Extracted input handling
   - Implemented Input class
   - Extracted Keyboard and Gamepad handlers

## Next Files to Work On
1. **audio.js** - Extract audio processing
   - Implement the APU class
   - Extract sound channel implementations
   - Set up audio context management

2. **timer.js** - Extract timer functionality
   - Implement the Timer class
   - Handle timer registers

3. **rom.js** - Extract ROM handling
   - Implement ROM class and validation
   - Extract ROM readers

## Implementation Strategy
- For each module, we'll extract the relevant code from gameboy.js
- Keep the original functionality intact while moving to a modular structure
- Update references to use imports instead of assuming global namespace
- Fix any circular dependencies that arise during the refactoring

## Progress
- Core functionality has been modularized
- Basic module system is in place with proper imports/exports
- Resolved circular dependency between core.js and constants.js
- HTML has been updated to use ES modules
- Audio initialization has been improved with permission handling
- Graphics and input systems have been modularized