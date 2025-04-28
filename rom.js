// rom.js - ROM class, ROM validation, and ROM readers

// ROM class for handling ROM loading and validation
export class Rom {
    constructor(gameboy, romReader) {
        this.gameboy = gameboy;
        if (romReader) {
            this.addReader(romReader);
        }
    }

    addReader(romReader) {
        const self = this;
        romReader.setCallback(function(data) {
            if (!validate(data)) {
                self.gameboy.error('The file is not a valid GameBoy ROM.');
                return;
            }
            self.data = data;
            self.gameboy.startRom(self);
        });
    }
}

// Validate the checksum of the cartridge header
function validate(data) {
    let hash = 0;
    for (let i = 0x134; i <= 0x14C; i++) {
        hash = hash - data[i] - 1;
    }
    return (hash & 0xFF) == data[0x14D];
}

// A RomFileReader is able to load a local file from an input element
export class RomFileReader {
    constructor(el) {
        this.domElement = el || document.getElementById('file');
        if (!this.domElement) {
            throw 'The RomFileReader needs a valid input element.';
        }

        const self = this;
        this.domElement.addEventListener('change', function(e){
            self.loadFromFile(e.target.files[0]);
        });
    }

    // The callback argument will be called when a file is successfully
    // read, with the data as argument (Uint8Array)
    setCallback(onLoadCallback) {
        this.callback = onLoadCallback;
    }

    // Automatically called when the DOM input is provided with a file
    loadFromFile(file) {
        if (file === undefined) {
            return;
        }
        const fr = new FileReader();
        const cb = this.callback;

        fr.onload = function() {
            cb && cb(new Uint8Array(fr.result));
        };
        fr.onerror = function(e) {
            console.log('Error reading the file', e.target.error.code);
        };
        fr.readAsArrayBuffer(file);
    }
}

// A RomDropFileReader is able to load a drag and dropped file
export class RomDropFileReader {
    constructor(el) {
        this.dropElement = el;
        if (!this.dropElement) {
            throw 'The RomDropFileReader needs a drop zone.';
        }

        const self = this;
        this.dropElement.addEventListener('dragenter', function(e) {
            e.preventDefault();
            e.target.classList.add('drag-active');
        });
        this.dropElement.addEventListener('dragleave', function(e) {
            e.preventDefault();
            e.target.classList.remove('drag-active');
        });
        this.dropElement.addEventListener('dragover', function(e) {
            e.preventDefault();
        });
        this.dropElement.addEventListener('drop', function (e) {
            e.target.classList.remove('drag-active');
            if (e.dataTransfer.files.length == 0) {
                return;
            }
            e.preventDefault();
            self.loadFromFile(e.dataTransfer.files[0]);
        });
    }

    // The callback argument will be called when a file is successfully
    // read, with the data as argument (Uint8Array)
    setCallback(onLoadCallback) {
        this.callback = onLoadCallback;
    }

    // The file loading logic is the same as the regular file reader
    loadFromFile(file) {
        if (file === undefined) {
            return;
        }
        const fr = new FileReader();
        const cb = this.callback;

        fr.onload = function() {
            cb && cb(new Uint8Array(fr.result));
        };
        fr.onerror = function(e) {
            console.log('Error reading the file', e.target.error.code);
        };
        fr.readAsArrayBuffer(file);
    }
}

// A RomAjaxReader is able to load a file through an AJAX request
export class RomAjaxReader {
    constructor() {}

    // The callback argument will be called when a file is successfully
    // read, with the data as argument (Uint8Array)
    setCallback(onLoadCallback) {
        this.callback = onLoadCallback;
    }

    // This function should be called by application code
    // and will trigger the AJAX call itself and push data to the ROM object
    loadFromUrl(url) {
        if (!url) {
            throw 'No url has been set in order to load a ROM file.';
        }
        const cb = this.callback;

        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = "arraybuffer";
        xhr.onload = function() {
            const rom = new Uint8Array(xhr.response);
            cb && cb(rom);
        };

        xhr.send();
    }
}