// gpu.js - Optimized GPU implementation

import { Screen } from './screen.js';
import { Util } from './utils.js';

// Optimized GPU class with performance improvements
export class GPU {
    constructor(screen, cpu) {
        this.cpu = cpu;
        this.screen = screen;

        // Common register addresses
        this.LCDC = 0xFF40;
        this.STAT = 0xFF41;
        this.SCY = 0xFF42;
        this.SCX = 0xFF43;
        this.LY = 0xFF44;
        this.LYC = 0xFF45;
        this.BGP = 0xFF47;
        this.OBP0 = 0xFF48;
        this.OBP1 = 0xFF49;
        this.WY = 0xFF4A;
        this.WX = 0xFF4B;

        this.vram = cpu.memory.vram.bind(cpu.memory);
        
        // OAM constants
        this.OAM_START = 0xFE00;
        this.OAM_END = 0xFE9F;
        
        // Memory accessors
        this.deviceram = cpu.memory.deviceram.bind(cpu.memory);
        this.oamram = cpu.memory.oamram.bind(cpu.memory);
        
        // Timing constants
        this.VBLANK_TIME = 70224;
        this.HBLANK_TIME = 204;
        this.SCANLINE_OAM_TIME = 80;
        this.SCANLINE_VRAM_TIME = 172;
        this.LINE_TIME = 456;
        
        // State variables
        this.clock = 0;
        this.mode = 2;
        this.line = 0;
        this.skipFramesCounter = 0;
        
        // Create buffers using TypedArrays for better performance
        this.buffer = new Uint8Array(Screen.physics.WIDTH * Screen.physics.HEIGHT);
        this.tileBuffer = new Uint8Array(8);
        this.bgTileCache = {};
        
        // Sprite rendering optimizations
        this.spriteCache = new Map();
        this.spriteCacheMaxSize = 256;
        this.spriteOnLine = new Uint8Array(Screen.physics.HEIGHT);
        
        // Pre-computed palettes for efficiency
        this._lastBgPalette = 0;
        this._lastObp0 = 0;
        this._lastObp1 = 0;
        this._bgPaletteArray = [0, 1, 2, 3];
        this._obp0Array = [0, 1, 2, 3];
        this._obp1Array = [0, 1, 2, 3];
        
        // Double buffering for smoother rendering
        this.frontBuffer = new Uint8Array(Screen.physics.WIDTH * Screen.physics.HEIGHT);
        this.backBuffer = new Uint8Array(Screen.physics.WIDTH * Screen.physics.HEIGHT);
        this.bufferReady = false;
        
        // Dirty line tracking
        this.dirtyLines = new Uint8Array(Screen.physics.HEIGHT);
    }

    static get tilemap() {
        return {
            HEIGHT: 32,
            WIDTH: 32,
            START_0: 0x9800,
            START_1: 0x9C00,
            LENGTH: 0x0400 // 1024 bytes = 32*32
        };
    }

    // Main update method - returns true when VBlank occurs
    update(clockElapsed) {
        this.clock += clockElapsed;

        switch (this.mode) {
            case 0: // HBLANK
                if (this.clock >= this.HBLANK_TIME) {
                    this.clock -= this.HBLANK_TIME;
                    this.line++;
                    this.updateLY();
                    
                    if (this.line == 144) {
                        this.setMode(1);
                        this.drawFrame();
                        return true; // VBlank occurred
                    } else {
                        this.setMode(2);
                    }
                }
                break;
                
            case 1: // VBLANK
                if (this.clock >= this.LINE_TIME) {
                    this.clock -= this.LINE_TIME;
                    this.line++;
                    
                    if (this.line > 153) {
                        this.line = 0;
                        this.setMode(2);
                        // Reset sprite-on-line tracking
                        this.spriteOnLine.fill(0);
                    }
                    
                    this.updateLY();
                }
                break;
                
            case 2: // SCANLINE OAM
                if (this.clock >= this.SCANLINE_OAM_TIME) {
                    this.clock -= this.SCANLINE_OAM_TIME;
                    this.setMode(3);
                }
                break;
                
            case 3: // SCANLINE VRAM
                if (this.clock >= this.SCANLINE_VRAM_TIME) {
                    this.clock -= this.SCANLINE_VRAM_TIME;
                    this.drawScanLine(this.line);
                    this.setMode(0);
                }
                break;
        }

        return false; // No VBlank occurred
    }

    updateLY() {
        this.deviceram(this.LY, this.line);
        const STAT = this.deviceram(this.STAT);
        
        if (this.deviceram(this.LY) == this.deviceram(this.LYC)) {
            this.deviceram(this.STAT, STAT | (1 << 2));
            if (STAT & (1 << 6)) {
                this.cpu.requestInterrupt(1); // LCDC
            }
        } else {
            this.deviceram(this.STAT, STAT & (0xFF - (1 << 2)));
        }
    }

    setMode(mode) {
        this.mode = mode;
        let newSTAT = this.deviceram(this.STAT);
        newSTAT = (newSTAT & 0xFC) | mode;
        this.deviceram(this.STAT, newSTAT);

        if (mode < 3 && (newSTAT & (1 << (3+mode)))) {
            this.cpu.requestInterrupt(1); // LCDC
        }
    }

    // Push one scanline into the buffer with optimized rendering
    drawScanLine(line) {
        const LCDC = this.deviceram(this.LCDC);
        if (!(Util.readBit(LCDC, 7))) return; // LCD disabled
        
        // Mark this line as dirty for double-buffering
        this.dirtyLines[line] = 1;
        
        // Create line buffer for this scanline
        const lineBuffer = new Uint8Array(Screen.physics.WIDTH);
        
        this.drawBackground(LCDC, line, lineBuffer);
        
        // Only draw sprites if enabled
        if (Util.readBit(LCDC, 1)) {
            this.drawSpritesOnLine(LCDC, line, lineBuffer);
        }
        
        // Copy line to main buffer
        this.copyLineToBuffer(lineBuffer, line);
    }

    // Render the completed frame - only called during VBlank
    drawFrame() {
        const LCDC = this.deviceram(this.LCDC);
        if (!Util.readBit(LCDC, 7)) return; // LCD disabled
        
        // Swap buffers
        if (this.bufferReady) {
            const temp = this.frontBuffer;
            this.frontBuffer = this.backBuffer;
            this.backBuffer = temp;
            this.bufferReady = false;
        }
        
        // Only render the window if it's enabled
        if (Util.readBit(LCDC, 5)) {
            this.drawWindow(LCDC);
        }
        
        // Clear the tile cache to free memory
        this.bgTileCache = {};
        
        // Limit sprite cache size to avoid memory growth
        if (this.spriteCache.size > this.spriteCacheMaxSize) {
            this.spriteCache.clear();
        }
        
        // Render the frame to screen
        this.screen.render(this.frontBuffer);
        
        // Reset dirty line tracking
        this.dirtyLines.fill(0);
        this.bufferReady = true;
    }

    // Optimized background drawing
    drawBackground(LCDC, line, lineBuffer) {
        if (!Util.readBit(LCDC, 0)) {
            lineBuffer.fill(0);
            return;
        }

        const mapStart = Util.readBit(LCDC, 3) ? GPU.tilemap.START_1 : GPU.tilemap.START_0;
        
        let dataStart, signedIndex = false;
        if (Util.readBit(LCDC, 4)) {
            dataStart = 0x8000;
        } else {
            dataStart = 0x8800;
            signedIndex = true;
        }

        const bgx = this.deviceram(this.SCX);
        const bgy = this.deviceram(this.SCY);
        const tileLine = ((line + bgy) & 7);

        // Calculate tile row
        const tileRow = ((((bgy + line) / 8) | 0) & 0x1F);
        let firstTile = ((bgx / 8) | 0) + 32 * tileRow;
        let x = (firstTile & 0x1F) * 8 - bgx;
        
        // Determine how many tiles we need to draw
        const tilesNeeded = Math.ceil((Screen.physics.WIDTH + (bgx & 7)) / 8);
        
        // Loop through tiles for this scanline
        for (let i = 0; i < tilesNeeded; i++) {
            const tileIndex = this.vram(firstTile + i + mapStart);
            
            // Adjust index based on addressing mode
            let adjustedTileIndex = tileIndex;
            if (signedIndex) {
                adjustedTileIndex = Util.getSignedValue(tileIndex) + 128;
            }

            // Get tile data from cache or read from VRAM
            const tileData = this.bgTileCache[adjustedTileIndex] || 
                            (this.bgTileCache[adjustedTileIndex] = this.readTileData(adjustedTileIndex, dataStart));

            // Draw the tile line
            this.drawTileLine(tileData, tileLine);
            
            // Copy tile line to buffer
            this.copyBGTileLine(lineBuffer, this.tileBuffer, x);
            x += 8;
            
            // Handle wrapping around the background
            if ((firstTile + i) % 32 === 31) {
                firstTile -= 32;
            }
        }
    }

    // Copy a tile line to the line buffer at the specified position
    copyBGTileLine(lineBuffer, tileBuffer, x) {
        const startX = Math.max(0, x);
        const endX = Math.min(Screen.physics.WIDTH, x + 8);
        const tileOffset = startX - x;
        
        // Fast copy using TypedArray set
        if (tileOffset === 0 && endX === x + 8) {
            // Full tile visible - use set for speed
            lineBuffer.set(tileBuffer, startX);
        } else {
            // Partial tile visible - copy pixels one by one
            for (let i = 0; i < endX - startX; i++) {
                lineBuffer[startX + i] = tileBuffer[tileOffset + i];
            }
        }
    }

    // Copy a scanline into the main buffer with palette translation
    copyLineToBuffer(lineBuffer, line) {
        // Get and cache the background palette for better performance
        const bgPaletteValue = this.deviceram(this.BGP);
        
        // Only recompute palette if it changed
        if (this._lastBgPalette !== bgPaletteValue) {
            this._bgPaletteArray = GPU.getPalette(bgPaletteValue);
            this._lastBgPalette = bgPaletteValue;
        }
        
        // Calculate scanline offset in the buffer
        const offset = line * Screen.physics.WIDTH;
        
        // Apply palette to all pixels in the line
        for (let x = 0; x < Screen.physics.WIDTH; x++) {
            const color = lineBuffer[x];
            this.backBuffer[offset + x] = this._bgPaletteArray[color] || 0;
        }
    }

    // Optimized tile line drawing with pre-computation
    drawTileLine(tileData, line, xflip = 0, yflip = 0) {
        const l = yflip ? 7 - line : line;
        const byteIndex = l * 2;
        const b1 = tileData[byteIndex];
        const b2 = tileData[byteIndex + 1];

        // Pre-compute all pixels in one go for better performance
        if (!xflip) {
            // Normal order
            for (let pixel = 0; pixel < 8; pixel++) {
                const mask = 1 << (7 - pixel);
                const colorValue = ((b1 & mask) ? 1 : 0) + ((b2 & mask) ? 2 : 0);
                this.tileBuffer[pixel] = colorValue;
            }
        } else {
            // Flipped horizontally
            for (let pixel = 0; pixel < 8; pixel++) {
                const mask = 1 << pixel;
                const colorValue = ((b1 & mask) ? 1 : 0) + ((b2 & mask) ? 2 : 0);
                this.tileBuffer[7 - pixel] = colorValue;
            }
        }
    }

    // Optimized sprite drawing just for the current scanline
    drawSpritesOnLine(LCDC, line, lineBuffer) {
        const spriteHeight = Util.readBit(LCDC, 2) ? 16 : 8;
        
        // Skip if no sprites on this line
        if (this.spriteOnLine[line] === 0) {
            // Quick scan to see if any sprites are on this line
            let hasSprites = false;
            for (let i = this.OAM_START; i < this.OAM_END; i += 4) {
                const y = this.oamram(i) - 16;
                if (line >= y && line < y + spriteHeight) {
                    hasSprites = true;
                    this.spriteOnLine[line] = 1;
                    break;
                }
            }
            
            if (!hasSprites) return;
        }
        
        // Find sprites on this scanline
        const spriteBuffer = new Uint8Array(Screen.physics.WIDTH).fill(0xFF); // 0xFF means empty
        const spriteInfoBuffer = new Uint8Array(Screen.physics.WIDTH).fill(0);
        
        // Track priorities for sprite stacking (max 10 sprites per line)
        const visibleSprites = [];
        for (let i = this.OAM_START; i < this.OAM_END && visibleSprites.length < 10; i += 4) {
            const y = this.oamram(i);
            const x = this.oamram(i+1);
            
            // Skip if sprite is offscreen
            if (x === 0 || x >= 168 || y === 0 || y >= 160) {
                continue;
            }
            
            // Check if sprite is on this scanline
            if (line >= y - 16 && line < y - 16 + spriteHeight) {
                visibleSprites.push({
                    index: this.oamram(i+2), 
                    x: x - 8, 
                    y: y - 16,
                    tileLine: line - (y - 16),
                    flags: this.oamram(i+3),
                    oamIndex: i
                });
            }
        }
        
        // Sort sprites by x-coordinate (lower coordinate has priority)
        visibleSprites.sort((a, b) => a.x - b.x);
        
        // Draw sprites to the sprite buffer
        for (const sprite of visibleSprites) {
            const paletteNumber = Util.readBit(sprite.flags, 4) ? 1 : 0;
            const xflip = Util.readBit(sprite.flags, 5) ? 1 : 0;
            const yflip = Util.readBit(sprite.flags, 6) ? 1 : 0;
            const behindBg = Util.readBit(sprite.flags, 7) ? 1 : 0;
            
            // Get tile data
            let tileIndex = sprite.index;
            if (spriteHeight === 16) {
                // For 8x16 sprites, the bottom half uses the next tile
                if (sprite.tileLine >= 8) {
                    tileIndex = (tileIndex & 0xFE) + 1;
                }
            }
            
            // Get sprite from cache or read from VRAM
            const spriteKey = tileIndex + (xflip << 8) + (yflip << 9);
            let tileData = this.spriteCache.get(spriteKey);
            if (!tileData) {
                tileData = this.readTileData(tileIndex, 0x8000, spriteHeight === 16 ? 16 : 8);
                this.spriteCache.set(spriteKey, tileData);
            }
            
            // Draw the sprite line
            const tileLine = (sprite.tileLine % 8);
            this.drawTileLine(tileData, tileLine, xflip, yflip);
            
            // Copy sprite pixels to sprite buffer
            const startX = Math.max(0, sprite.x);
            const endX = Math.min(Screen.physics.WIDTH, sprite.x + 8);
            
            for (let x = startX; x < endX; x++) {
                const bufferX = x - sprite.x;
                
                // Only draw non-transparent pixels
                if (this.tileBuffer[bufferX] !== 0) {
                    spriteBuffer[x] = this.tileBuffer[bufferX];
                    // Store palette and priority info
                    spriteInfoBuffer[x] = (paletteNumber << 1) | behindBg;
                }
            }
        }
        
        // Prepare sprite palettes if needed
        const obp0Value = this.deviceram(this.OBP0);
        const obp1Value = this.deviceram(this.OBP1);
        
        if (this._lastObp0 !== obp0Value) {
            this._obp0Array = GPU.getPalette(obp0Value);
            this._lastObp0 = obp0Value;
        }
        
        if (this._lastObp1 !== obp1Value) {
            this._obp1Array = GPU.getPalette(obp1Value);
            this._lastObp1 = obp1Value;
        }
        
        // Merge sprite buffer with background buffer
        for (let x = 0; x < Screen.physics.WIDTH; x++) {
            if (spriteBuffer[x] === 0xFF) continue; // Skip empty pixels
            
            const colorValue = spriteBuffer[x];
            const info = spriteInfoBuffer[x];
            const behindBg = info & 1;
            const paletteNumber = (info >> 1) & 1;
            
            // Apply sprite priority rules
            if (behindBg && lineBuffer[x] !== 0) {
                continue; // Skip drawing sprite if behind background (non-white) pixel
            }
            
            // Get color from appropriate palette
            const paletteArray = paletteNumber ? this._obp1Array : this._obp0Array;
            
            // Copy to line buffer
            lineBuffer[x] = paletteArray[colorValue];
        }
    }

    // Optimized window drawing
    drawWindow(LCDC) {
        if (!Util.readBit(LCDC, 5)) return;
        
        // Get window position
        const wx = this.deviceram(this.WX) - 7;
        const wy = this.deviceram(this.WY);
        
        // Skip if window is offscreen
        if (wx >= Screen.physics.WIDTH || wy >= Screen.physics.HEIGHT) return;
        
        const mapStart = Util.readBit(LCDC, 6) ? GPU.tilemap.START_1 : GPU.tilemap.START_0;
        
        let dataStart, signedIndex = false;
        if (Util.readBit(LCDC, 4)) {
            dataStart = 0x8000;
        } else {
            dataStart = 0x8800;
            signedIndex = true;
        }
        
        // Only draw the visible portion of the window
        const startY = Math.max(0, wy);
        const endY = Math.min(Screen.physics.HEIGHT, Screen.physics.HEIGHT);
        const startX = Math.max(0, wx);
        const endX = Math.min(Screen.physics.WIDTH, Screen.physics.WIDTH);
        
        // Get and cache the background palette for better performance
        const bgPalette = this._bgPaletteArray;
        
        for (let y = startY; y < endY; y++) {
            const windowY = y - wy;
            if (windowY < 0) continue;
            
            const tileRow = Math.floor(windowY / 8);
            const tileLine = windowY % 8;
            
            // Calculate offset in backbuffer
            const bufferOffset = y * Screen.physics.WIDTH;
            
            for (let x = startX; x < endX; x++) {
                const windowX = x - wx;
                if (windowX < 0) continue;
                
                const tileCol = Math.floor(windowX / 8);
                const tilePixel = windowX % 8;
                
                // Skip if outside window tilemap
                if (tileRow >= 32 || tileCol >= 32) continue;
                
                // Get tile index
                const tileMapAddr = mapStart + tileRow * 32 + tileCol;
                let tileIndex = this.vram(tileMapAddr);
                
                if (signedIndex) {
                    tileIndex = Util.getSignedValue(tileIndex) + 128;
                }
                
                // Get tile data from cache or read from VRAM
                const tileData = this.bgTileCache[tileIndex] || 
                                (this.bgTileCache[tileIndex] = this.readTileData(tileIndex, dataStart));
                
                // Calculate pixel value
                const byteOffset = tileLine * 2;
                const b1 = tileData[byteOffset];
                const b2 = tileData[byteOffset + 1];
                const mask = 1 << (7 - tilePixel);
                const colorValue = ((b1 & mask) ? 1 : 0) + ((b2 & mask) ? 2 : 0);
                
                // Apply palette and write to buffer
                this.backBuffer[bufferOffset + x] = bgPalette[colorValue];
            }
        }
    }

    // Get tile data with caching
    readTileData(tileIndex, dataStart, tileSize = 16) {
        const cacheKey = `${tileIndex}_${dataStart}_${tileSize}`;
        
        // Return from cache if available
        if (this.bgTileCache[cacheKey]) {
            return this.bgTileCache[cacheKey];
        }
        
        // Otherwise read from VRAM
        const tileData = new Uint8Array(tileSize);
        const tileAddressStart = dataStart + (tileIndex * 0x10);
        
        for (let i = 0; i < tileSize; i++) {
            tileData[i] = this.vram(tileAddressStart + i);
        }
        
        // Store in cache
        this.bgTileCache[cacheKey] = tileData;
        return tileData;
    }

    // Pre-compute palette mapping for better performance
    static getPalette(paletteByte) {
        const palette = [];
        for (let i = 0; i < 8; i += 2) {
            const shade = (paletteByte & (3 << i)) >> i;
            palette.push(shade);
        }
        return palette;
    }
}