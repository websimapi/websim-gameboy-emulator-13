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

## Next Files to Work On
1. **core.js** - Extract the core CPU and Gameboy classes
   - Implement the main Gameboy class from existing code
   - Extract the CPU class with core functionality
   - Define CPU operations that will be referenced by opcodes

2. **utils.js** - Extract utility functions and serial handlers
   - Implement the Util helper functions
   - Move exception handling
   - Move debug tools
   - Move serial port handlers

3. **memory.js** - Extract memory and MBC management
   - Implement the Memory class
   - Extract MBC implementations
   - Extract ExtRam handling

## Implementation Strategy
- For each module, we'll extract the relevant code from gameboy.js
- Keep the original functionality intact while moving to a modular structure
- Update references to use imports instead of assuming global namespace
- Fix any circular dependencies that arise during the refactoring

## Notes
- The current implementation relies on importing cpuOps from core.js in constants.js, creating a circular dependency
- This will need to be resolved by either:
  1. Moving CPU operations to constants.js
  2. Restructuring how opcodes access CPU operations
- We may need to temporarily keep gameboy.js in place as we gradually migrate to the new structure