// utils.js - Utility functions, debug tools, and serial port handlers

// Utility functions
export const Util = {
    // Add to the first argument the properties of all other arguments
    extend: function(target /*, source1, source2, etc. */) {
        var sources = Array.prototype.slice.call(arguments);
        for (var i = 1; i < sources.length; i++) {
            var source = sources[i];
            for (var name in source) {
                target[name] = source[name];
            }
        }
        return target;
    },
    
    testFlag: function(p, cc) {
        var test = 1;
        var mask = 0x10;
        if (cc == 'NZ' || cc == 'NC') test = 0;
        if (cc == 'NZ' || cc == 'Z')  mask = 0x80;
        return (test && p.r.F & mask) || (!test && !(p.r.F & mask));
    },
    
    getRegAddr: function(p, r1, r2) {
        return Util.makeword(p.r[r1], p.r[r2]);
    },

    // make a 16 bits word from 2 bytes
    makeword: function(b1, b2) {
        return (b1 << 8) + b2;
    },

    // return the integer signed value of a given byte
    getSignedValue: function(v) {
        return v & 0x80 ? v - 256 : v;
    },

    // extract a bit from a byte
    readBit: function(byte, index) {
        return (byte >> index) & 1;
    }
};

// Debug tools
export const Debug = {
    // Output a range of 16 memory addresses
    view_memory: function(addr, gameboy) {
        var memory = gameboy.cpu.memory;
        addr = addr & 0xFFF0;
        var pad = '00';
        var str = addr.toString(16) + ':';
        for (var i = addr; i < addr + 0x10; i++) {
            if ((i & 0x1) == 0) {
                str += ' ';
            }
            var val = memory[i] || 0;

            val = val.toString(16);
            str += pad.substring(val.length) + val;
        }

        return str;
    },

    view_tile: function(gameboy, index, dataStart) {
        var memory = gameboy.cpu.memory;
        var screen = gameboy.screen;
        var LCDC = screen.deviceram(screen.LCDC);
        if (typeof dataStart === 'undefined') {
            dataStart = 0x8000;
            if (!Util.readBit(LCDC, 4)) {
                dataStart = 0x8800;
                index = Util.getSignedValue(index) + 128;
            }
        }

        var tileData = screen.readTileData(index, dataStart);

        var pixelData = new Array(8 * 8);
        for (var line = 0; line < 8; line++) {
            var b1 = tileData.shift();
            var b2 = tileData.shift();

            for (var pixel = 0; pixel < 8; pixel++) {
                var mask = (1 << (7-pixel));
                var colorValue = ((b1 & mask) >> (7-pixel)) + ((b2 & mask) >> (7-pixel))*2;
                pixelData[line * 8 + pixel] = colorValue;
            }
        }

        var i = 0;
        while (pixelData.length) {
            console.log(i++ + ' ' + pixelData.splice(0, 8).join(''));
        }
    },

    list_visible_sprites: function(gameboy) {
        var memory = gameboy.cpu.memory;
        var indexes = new Array();
        for (var i = 0xFE00; i < 0xFE9F; i += 4) {
            var x = memory.oamram(i + 1);
            var y = memory.oamram(i);
            var tileIndex = memory.oamram(i + 2);
            if (x == 0 || x >= 168) {
                continue;
            }
            indexes.push({oamIndex:i, x:x, y:y, tileIndex:tileIndex});
        }

        return indexes;
    }
};

// This exception should be thrown whenever a critical feature that
// has not been implemented is requested
export class UnimplementedException extends Error {
    constructor(message, fatal) {
        super(message);
        this.name = "UnimplementedException";
        if (fatal === undefined) {
            fatal = true;
        }
        this.fatal = fatal;
    }
}

// Handlers for the Serial port of the Gameboy

// The ConsoleSerial is an output-only serial port
// designed for debug purposes as some test roms output data on the serial port
//
// Will regularly output the received byte (converted to string) in the console logs
// This handler always push the value 0xFF as an input
export const ConsoleSerial = {
    current: '',
    timeout: null,
    out: function(data) {
        ConsoleSerial.current += String.fromCharCode(data);
        if (data == 10) {
            ConsoleSerial.print();
        } else {
            clearTimeout(ConsoleSerial.timeout);
            ConsoleSerial.timeout = setTimeout(ConsoleSerial.print, 500);
        }
    },
    in: function() {
        return 0xFF;
    },
    print: function() {
        clearTimeout(ConsoleSerial.timeout);
        console.log('serial: ' + ConsoleSerial.current);
        ConsoleSerial.current = '';
    }
};

// A DummySerial outputs nothing and always inputs 0xFF
export const DummySerial = {
    out: function() {},
    in: function() {
        return 0xFF;
    }
};