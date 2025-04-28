// audio.js - Audio Processing Unit and sound channels implementation

import { Util } from './utils.js';
import { APURegisters } from './constants.js';

// Audio Processing unit
// Listens the write accesses to the audio-reserved memory addresses
// and dispatches the data to the sound channels
export class APU {
    constructor(memory) {
        this.memory = memory;
        this.enabled = false;
        this.needsUserInteraction = true;
        
        // Create audio context with error handling
        try {
            window.AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();
            
            // Create master volume and panning controls
            this.masterGain = this.audioContext.createGain();
            this.masterGain.gain.value = 0.5; // Default volume
            this.masterGain.connect(this.audioContext.destination);
            
            // Create individual channel gains for panning
            this.leftGain = this.audioContext.createGain();
            this.rightGain = this.audioContext.createGain();
            this.leftGain.connect(this.masterGain);
            this.rightGain.connect(this.masterGain);
            
            // Create audio channels
            this.channel1 = new Channel1(this, 1, this.audioContext);
            this.channel2 = new Channel1(this, 2, this.audioContext); // Channel2 uses Channel1 implementation
            this.channel3 = new Channel3(this, 3, this.audioContext);
            this.channel4 = new Channel4(this, 4, this.audioContext);
            
            // Connect to stereo channels based on initial panning (all channels to both outputs)
            this.updatePanning(0xFF);
        } catch (e) {
            console.warn("Audio initialization failed:", e);
            // Create dummy audio objects for graceful degradation
            this.audioAvailable = false;
            this.audioContext = null;
            this.masterGain = null;
            this.leftGain = null;
            this.rightGain = null;
            
            // Create dummy channel objects
            this.channel1 = new DummyChannel(this, 1);
            this.channel2 = new DummyChannel(this, 2);
            this.channel3 = new DummyChannel(this, 3);
            this.channel4 = new DummyChannel(this, 4);
        }
    }

    // Resume AudioContext after user interaction
    resume() {
        if (this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume().then(() => {
                this.needsUserInteraction = false;
                console.log("AudioContext resumed successfully");
            }).catch(err => {
                console.error("Failed to resume AudioContext:", err);
            });
        } else {
            this.needsUserInteraction = false;
        }
    }

    connect() {
        this.enabled = true;
        this.channel1.enable();
        this.channel2.enable();
        this.channel3.enable();
        this.channel4.enable();
        
        // Try to resume if we haven't already
        if (this.needsUserInteraction) {
            this.resume();
        }
    }

    disconnect() {
        this.enabled = false;
        this.channel1.disable();
        this.channel2.disable();
        this.channel3.disable();
        this.channel4.disable();
    }

    // Updates the states of each channel given the elapsed time
    // (in instructions) since last update
    update(clockElapsed) {
        if (this.enabled === false) return;
        if (this.audioContext && this.audioContext.state === 'suspended') return;

        this.channel1.update(clockElapsed);
        this.channel2.update(clockElapsed);
        this.channel3.update(clockElapsed);
        this.channel4.update(clockElapsed);
    }

    setSoundFlag(channel, value) {
        var mask = 0xFF - (1 << (channel - 1));
        value = value << (channel - 1);
        var byteValue = this.memory.rb(APURegisters.NR52);
        byteValue &= mask;
        byteValue |= value;
        this.memory[APURegisters.NR52] = byteValue;
    }
    
    // Update volume based on NR50 register
    updateVolume(value) {
        if (!this.audioContext) return;
        
        // Bits 0-2: Right channel volume (0-7)
        const rightVolume = (value & 0x07) / 7;
        // Bits 4-6: Left channel volume (0-7)
        const leftVolume = ((value >> 4) & 0x07) / 7;
        
        if (this.leftGain) this.leftGain.gain.value = leftVolume;
        if (this.rightGain) this.rightGain.gain.value = rightVolume;
    }
    
    // Update panning based on NR51 register
    updatePanning(value) {
        if (!this.audioContext) return;
        
        // Bits 0-3: Channels 1-4 right enable
        // Bits 4-7: Channels 1-4 left enable
        const panningConfig = {
            channel1: {
                left: (value & 0x10) !== 0,
                right: (value & 0x01) !== 0
            },
            channel2: {
                left: (value & 0x20) !== 0,
                right: (value & 0x02) !== 0
            },
            channel3: {
                left: (value & 0x40) !== 0,
                right: (value & 0x04) !== 0
            },
            channel4: {
                left: (value & 0x80) !== 0,
                right: (value & 0x08) !== 0
            }
        };
        
        // Update channel connections
        this.updateChannelPanning(this.channel1, panningConfig.channel1);
        this.updateChannelPanning(this.channel2, panningConfig.channel2);
        this.updateChannelPanning(this.channel3, panningConfig.channel3);
        this.updateChannelPanning(this.channel4, panningConfig.channel4);
    }
    
    // Connect/disconnect a channel to left/right outputs based on panning
    updateChannelPanning(channel, panning) {
        if (!this.audioContext) return;
        
        if (channel.gainNode) {
            try {
                // First disconnect from both
                channel.gainNode.disconnect();
                
                // Then connect to the appropriate outputs
                if (panning.left) {
                    channel.gainNode.connect(this.leftGain);
                }
                if (panning.right) {
                    channel.gainNode.connect(this.rightGain);
                }
            } catch (e) {
                console.warn("Error updating channel panning:", e);
            }
        }
    }

    // Manage writes to audio registers
    // Will update the channels depending on the address
    manageWrite(addr, value) {
        if (this.enabled == false && addr < APURegisters.NR52) {
            return;
        }
        this.memory[addr] = value;

        switch (addr) {
            // Channel 1 addresses
            case APURegisters.NR10:
                this.channel1.clockSweep = 0;
                this.channel1.sweepTime = ((value & 0x70) >> 4);
                this.channel1.sweepSign = (value & 0x08) ? -1 : 1;
                this.channel1.sweepShifts = (value & 0x07);
                this.channel1.sweepCount = this.channel1.sweepShifts;
                break;
            case APURegisters.NR11:
                // Duty pattern (bits 6-7)
                this.channel1.setDuty((value >> 6) & 0x03);
                // Sound length (bits 0-5)
                this.channel1.setLength(value & 0x3F);
                break;
            case APURegisters.NR12:
                this.channel1.envelopeSign = (value & 0x08) ? 1 : -1;
                var envelopeVolume = (value & 0xF0) >> 4;
                this.channel1.setEnvelopeVolume(envelopeVolume);
                this.channel1.envelopeStep = (value & 0x07);
                break;
            case APURegisters.NR13:
                var frequency = this.channel1.getFrequency();
                frequency &= 0xF00;
                frequency |= value;
                this.channel1.setFrequency(frequency);
                break;
            case APURegisters.NR14:
                var frequency = this.channel1.getFrequency();
                frequency &= 0xFF;
                frequency |= (value & 7) << 8;
                this.channel1.setFrequency(frequency);
                this.channel1.lengthCheck = (value & 0x40) ? true : false;
                if (value & 0x80) this.channel1.play();
                break;

            // Channel 2 addresses
            case APURegisters.NR21:
                // Duty pattern (bits 6-7)
                this.channel2.setDuty((value >> 6) & 0x03);
                // Sound length (bits 0-5)
                this.channel2.setLength(value & 0x3F);
                break;
            case APURegisters.NR22:
                this.channel2.envelopeSign = (value & 0x08) ? 1 : -1;
                var envelopeVolume = (value & 0xF0) >> 4;
                this.channel2.setEnvelopeVolume(envelopeVolume);
                this.channel2.envelopeStep = (value & 0x07);
                break;
            case APURegisters.NR23:
                var frequency = this.channel2.getFrequency();
                frequency &= 0xF00;
                frequency |= value;
                this.channel2.setFrequency(frequency);
                break;
            case APURegisters.NR24:
                var frequency = this.channel2.getFrequency();
                frequency &= 0xFF;
                frequency |= (value & 7) << 8;
                this.channel2.setFrequency(frequency);
                this.channel2.lengthCheck = (value & 0x40) ? true : false;
                if (value & 0x80) {
                    this.channel2.play();
                }
                break;

            // Channel 3 addresses
            case APURegisters.NR30:
                // DAC power (bit 7)
                this.channel3.dacPower = (value & 0x80) !== 0;
                if (!this.channel3.dacPower) {
                    this.channel3.stop();
                }
                break;
            case APURegisters.NR31:
                this.channel3.setLength(value);
                break;
            case APURegisters.NR32:
                // Output level (bits 5-6)
                const level = (value >> 5) & 0x03;
                this.channel3.setOutputLevel(level);
                break;
            case APURegisters.NR33:
                var frequency = this.channel3.getFrequency();
                frequency &= 0xF00;
                frequency |= value;
                this.channel3.setFrequency(frequency);
                break;
            case APURegisters.NR34:
                var frequency = this.channel3.getFrequency();
                frequency &= 0xFF;
                frequency |= (value & 7) << 8;
                this.channel3.setFrequency(frequency);
                this.channel3.lengthCheck = (value & 0x40) ? true : false;
                if (value & 0x80) {
                    this.channel3.play();
                }
                break;

            // Channel 4 addresses
            case APURegisters.NR41:
                this.channel4.setLength(value & 0x3F);
                break;
            case APURegisters.NR42:
                // Envelope settings
                this.channel4.envelopeSign = (value & 0x08) ? 1 : -1;
                var envelopeVolume = (value & 0xF0) >> 4;
                this.channel4.setEnvelopeVolume(envelopeVolume);
                this.channel4.envelopeStep = (value & 0x07);
                break;
            case APURegisters.NR43:
                // Frequency and randomness settings
                this.channel4.setNoiseParams(value);
                break;
            case APURegisters.NR44:
                this.channel4.lengthCheck = (value & 0x40) ? true : false;
                if (value & 0x80) {
                    this.channel4.play();
                }
                break;
                
            // Master volume and panning
            case APURegisters.NR50:
                this.updateVolume(value);
                break;
            case APURegisters.NR51:
                this.updatePanning(value);
                break;

            // channel 3 wave bytes
            case 0xFF30: case 0xFF31: case 0xFF32: case 0xFF33: case 0xFF34: case 0xFF35: case 0xFF36: case 0xFF37:
            case 0xFF38: case 0xFF39: case 0xFF3A: case 0xFF3B: case 0xFF3C: case 0xFF3D: case 0xFF3E: case 0xFF3F:
                var index = addr - 0xFF30;
                this.channel3.setWaveBufferByte(index, value);
                // Update the wave buffer if it's already playing
                if (this.channel3.playing) {
                    this.channel3.updateWaveBuffer();
                }
                break;

            // general audio switch
            case APURegisters.NR52:
                value &= 0xF0;
                this.memory[addr] = value;
                const newEnabled = (value & 0x80) !== 0;
                
                // If turning audio on/off
                if (newEnabled !== this.enabled) {
                    this.enabled = newEnabled;
                    if (!this.enabled) {
                        // Clear all registers when powered off
                        for (var i = 0xFF10; i < 0xFF27; i++) {
                            if (i !== APURegisters.NR52) {
                                this.memory[i] = 0;
                            }
                        }
                        // Stop all sounds
                        this.channel1.stop();
                        this.channel2.stop();
                        this.channel3.stop();
                        this.channel4.stop();
                    }
                }
                break;
        }
    }
}

// Dummy channel for when audio is not available
class DummyChannel {
    constructor(apu, channelNumber) {
        this.apu = apu;
        this.channelNumber = channelNumber;
        this.playing = false;
    }
    
    play() { this.playing = true; this.apu.setSoundFlag(this.channelNumber, 1); }
    stop() { this.playing = false; this.apu.setSoundFlag(this.channelNumber, 0); }
    update() {}
    setFrequency() {}
    getFrequency() { return 0; }
    setLength() {}
    setEnvelopeVolume() {}
    setOutputLevel() {}
    setDuty() {}
    setWaveBufferByte() {}
    updateWaveBuffer() {}
    setNoiseParams() {}
    enable() {}
    disable() {}
}

// Channel 1 implementation (square wave with sweep)
export class Channel1 {
    constructor(apu, channelNumber, audioContext) {
        this.apu = apu;
        this.channelNumber = channelNumber;
        this.playing = false;

        this.soundLengthUnit = 0x4000; // 1 / 256 second of instructions
        this.soundLength = 64; // defaults to 64 periods
        this.lengthCheck = false;

        this.sweepTime = 0; // from 0 to 7
        this.sweepStepLength = 0x8000; // 1 / 128 seconds of instructions
        this.sweepCount = 0;
        this.sweepShifts = 0;
        this.sweepSign = 1; // +1 / -1 for increase / decrease freq

        this.frequency = 0;
        this.duty = 2; // Default duty cycle (50%)

        this.envelopeStep = 0;
        this.envelopeStepLength = 0x10000;// 1 / 64 seconds of instructions
        this.envelopeCheck = false;
        this.envelopeSign = 1;
        this.envelopeVolume = 0;

        this.clockLength = 0;
        this.clockEnvelop = 0;
        this.clockSweep = 0;

        if (!audioContext) {
            // Create dummy properties if audio context is not available
            this.gainNode = null;
            this.oscillator = null;
            this.audioContext = null;
            return;
        }

        // Create audio nodes
        try {
            this.gainNode = audioContext.createGain();
            this.gainNode.gain.value = 0;
            
            this.oscillator = audioContext.createOscillator();
            this.oscillator.type = 'square';
            this.oscillator.frequency.value = 440; // Default frequency
            this.oscillator.connect(this.gainNode);
            this.oscillator.start(0);

            this.audioContext = audioContext;
            
            // Set initial duty cycle
            this.setDuty(this.duty);
        } catch (e) {
            console.warn("Failed to initialize audio channel:", e);
            this.gainNode = null;
            this.oscillator = null;
            this.audioContext = null;
        }
    }

    play() {
        if (this.playing || !this.gainNode) return;
        this.playing = true;
        this.apu.setSoundFlag(this.channelNumber, 1);
        
        // Reset clocks
        this.clockLength = 0;
        this.clockEnvelop = 0;
        this.clockSweep = 0;
        
        // Start sound with envelope volume
        this.gainNode.gain.value = this.envelopeVolume / 15;
        
        // Check sweep frequency if needed
        if (this.sweepShifts > 0 && this.sweepTime > 0) {
            this.checkFreqSweep();
        }
    }

    stop() {
        if (!this.playing) return;
        this.playing = false;
        this.apu.setSoundFlag(this.channelNumber, 0);
        if (this.gainNode) {
            this.gainNode.gain.value = 0;
        }
    }

    checkFreqSweep() {
        if (this.sweepTime === 0) return this.frequency;
        
        var oldFreq = this.getFrequency();
        var newFreq = oldFreq + this.sweepSign * (oldFreq >> this.sweepShifts);
        
        // If frequency would overflow or underflow
        if (newFreq > 0x7FF || newFreq < 0) {
            this.stop();
            return oldFreq;
        }
        
        return newFreq;
    }

    update(clockElapsed) {
        if (!this.playing || !this.gainNode) return;
        
        // Update envelope
        if (this.envelopeStep > 0) {
            this.clockEnvelop += clockElapsed;
            if (this.clockEnvelop >= this.envelopeStepLength) {
                this.clockEnvelop -= this.envelopeStepLength;
                
                // Adjust envelope volume
                var newVolume = this.envelopeVolume + this.envelopeSign;
                if (newVolume >= 0 && newVolume <= 15) {
                    this.setEnvelopeVolume(newVolume);
                } else {
                    // Envelope has completed
                    this.envelopeStep = 0;
                }
            }
        }
        
        // Update sweep
        if (this.sweepTime > 0 && this.sweepShifts > 0) {
            this.clockSweep += clockElapsed;
            if (this.clockSweep >= (this.sweepStepLength * this.sweepTime)) {
                this.clockSweep -= (this.sweepStepLength * this.sweepTime);
                
                // Calculate new frequency
                var newFreq = this.checkFreqSweep();
                if (newFreq !== this.frequency && this.playing) {
                    // Update frequency
                    this.setFrequency(newFreq);
                    
                    // Update registers
                    this.apu.memory[this.channelNumber === 1 ? APURegisters.NR13 : APURegisters.NR23] = newFreq & 0xFF;
                    this.apu.memory[this.channelNumber === 1 ? APURegisters.NR14 : APURegisters.NR24] &= 0xF8;
                    this.apu.memory[this.channelNumber === 1 ? APURegisters.NR14 : APURegisters.NR24] |= (newFreq & 0x700) >> 8;
                    
                    // Check if the new frequency would also overflow
                    this.checkFreqSweep();
                }
            }
        }

        // Update length counter
        if (this.lengthCheck && this.soundLength > 0) {
            this.clockLength += clockElapsed;
            if (this.clockLength >= this.soundLengthUnit) {
                this.soundLength--;
                this.clockLength -= this.soundLengthUnit;
                if (this.soundLength <= 0) {
                    this.stop();
                }
            }
        }
    }

    setFrequency(value) {
        this.frequency = value;
        
        if (!this.oscillator) return;
        
        // Convert Game Boy frequency to actual frequency in Hz
        // Formula: 131072 / (2048 - frequency) Hz
        const realFreq = 131072 / (2048 - (value & 0x7FF));
        this.oscillator.frequency.value = realFreq;
    }

    getFrequency() {
        return this.frequency;
    }

    setLength(value) {
        // In GB, length value counts down from (64-value)
        this.soundLength = 64 - (value & 0x3F);
    }

    setEnvelopeVolume(volume) {
        this.envelopeVolume = volume & 0xF;
        // Only update gain if playing
        if (this.playing && this.gainNode) {
            this.gainNode.gain.value = this.envelopeVolume / 15;
        }
    }
    
    setDuty(dutyValue) {
        this.duty = dutyValue & 0x3;
        
        if (!this.oscillator || !this.audioContext) return;
        
        // Game Boy has 4 duty patterns: 12.5%, 25%, 50%, 75%
        // Web Audio only offers square wave (50%)
        // We can approximate other duty cycles using a custom wave
        
        const dutyCycles = [
            [0, 0, 0, 0, 0, 0, 0, 1], // 12.5%
            [0, 0, 0, 0, 0, 0, 1, 1], // 25%
            [0, 0, 0, 0, 1, 1, 1, 1], // 50%
            [1, 1, 1, 1, 1, 1, 0, 0]  // 75%
        ];
        
        const selectedPattern = dutyCycles[this.duty];
        
        // If the AudioContext supports createPeriodicWave, use it to create a custom wave
        if (this.audioContext.createPeriodicWave) {
            try {
                // Convert pattern to real/imag components (simple approximation)
                const real = new Float32Array([0, ...selectedPattern.map(v => v ? 1 : 0)]);
                const imag = new Float32Array(real.length).fill(0);
                
                const wave = this.audioContext.createPeriodicWave(real, imag);
                this.oscillator.setPeriodicWave(wave);
            } catch (e) {
                // Fallback to square wave if createPeriodicWave fails
                console.warn("Custom waveform not supported, using square wave", e);
                this.oscillator.type = 'square';
            }
        } else {
            // Fallback for browsers without createPeriodicWave
            this.oscillator.type = 'square';
        }
    }

    disable() {
        if (this.oscillator) {
            try {
                this.oscillator.disconnect();
            } catch (e) {
                console.warn("Error disconnecting oscillator:", e);
            }
        }
    }

    enable() {
        if (this.oscillator && this.gainNode) {
            try {
                this.oscillator.connect(this.gainNode);
            } catch (e) {
                console.warn("Error connecting oscillator:", e);
            }
        }
    }
}

// Channel 3 implementation (wave form)
export class Channel3 {
    constructor(apu, channelNumber, audioContext) {
        this.apu = apu;
        this.channelNumber = channelNumber;
        this.playing = false;
        this.dacPower = false;

        this.soundLength = 256; // defaults to 256 periods
        this.soundLengthUnit = 0x4000; // 1 / 256 second of instructions
        this.lengthCheck = false;

        this.clockLength = 0;
        this.outputLevel = 0; // 0=mute, 1=100%, 2=50%, 3=25%
        this.outputVolumes = [0, 1, 0.5, 0.25];

        // Create wave buffer (32 samples)
        this.buffer = new Float32Array(32);
        for (let i = 0; i < 32; i++) {
            this.buffer[i] = 0;
        }

        if (!audioContext) {
            // Create dummy properties if audio context is not available
            this.gainNode = null;
            this.waveBuffer = null;
            this.bufferSource = null;
            this.audioContext = null;
            this.baseSpeed = 65536;
            return;
        }

        // Create audio nodes
        try {
            this.gainNode = audioContext.createGain();
            this.gainNode.gain.value = 0;
            
            // Create wave using AudioBuffer
            this.baseSpeed = 65536; // Base sample rate for wave playback
            this.waveBuffer = audioContext.createBuffer(1, 32, this.baseSpeed);
            
            // Initialize buffer (no sound yet)
            this.updateWaveBuffer();
            
            // Create buffer source
            this.createBufferSource();

            this.audioContext = audioContext;
        } catch (e) {
            console.warn("Failed to initialize wave channel:", e);
            this.gainNode = null;
            this.waveBuffer = null;
            this.bufferSource = null;
            this.audioContext = null;
        }
    }
    
    createBufferSource() {
        if (!this.audioContext || !this.gainNode || !this.waveBuffer) return;
        
        // Create new buffer source (needed after each stop/start)
        if (this.bufferSource) {
            try {
                this.bufferSource.disconnect();
            } catch (e) {
                // Ignore disconnect errors
            }
        }
        
        try {
            this.bufferSource = this.audioContext.createBufferSource();
            this.bufferSource.buffer = this.waveBuffer;
            this.bufferSource.loop = true;
            this.bufferSource.connect(this.gainNode);
        } catch (e) {
            console.warn("Error creating buffer source:", e);
            this.bufferSource = null;
        }
    }

    play() {
        if (this.playing || !this.dacPower || !this.bufferSource) return;
        
        this.playing = true;
        this.apu.setSoundFlag(this.channelNumber, 1);
        
        // Update wave buffer with current data
        this.updateWaveBuffer();
        
        // Create new buffer source and start it
        this.createBufferSource();
        
        if (this.bufferSource) {
            try {
                this.bufferSource.start(0);
                
                // Set volume based on output level
                this.setOutputLevel(this.outputLevel);
            } catch (e) {
                console.warn("Error starting buffer source:", e);
                this.playing = false;
            }
        }
        
        this.clockLength = 0;
    }

    stop() {
        if (!this.playing) return;
        
        this.playing = false;
        this.apu.setSoundFlag(this.channelNumber, 0);
        
        // Stop buffer source
        if (this.bufferSource) {
            try {
                this.bufferSource.stop(0);
            } catch (e) {
                // Ignore errors from stopping already stopped source
            }
        }
        
        if (this.gainNode) {
            this.gainNode.gain.value = 0;
        }
    }

    update(clockElapsed) {
        if (!this.playing) return;
        
        // Update length counter
        if (this.lengthCheck && this.soundLength > 0) {
            this.clockLength += clockElapsed;
            if (this.clockLength >= this.soundLengthUnit) {
                this.soundLength--;
                this.clockLength -= this.soundLengthUnit;
                if (this.soundLength <= 0) {
                    this.stop();
                }
            }
        }
    }

    setFrequency(value) {
        const frequency = value & 0x7FF;
        
        if (!this.bufferSource) return;
        
        try {
            // Convert GB frequency to playback rate
            // Formula: 65536 / (2048 - frequency) Hz
            const rate = 65536 / (2048 - frequency);
            this.bufferSource.playbackRate.value = rate / this.baseSpeed;
        } catch (e) {
            console.warn("Error setting frequency:", e);
        }
    }

    getFrequency() {
        if (!this.bufferSource) return 0;
        
        try {
            const rate = this.bufferSource.playbackRate.value * this.baseSpeed;
            const freq = 2048 - (65536 / rate);
            
            return Math.max(0, Math.min(0x7FF, Math.round(freq)));
        } catch (e) {
            console.warn("Error getting frequency:", e);
            return 0;
        }
    }

    setLength(value) {
        // Channel 3 length is directly specified (0-255)
        this.soundLength = 256 - value;
    }
    
    setOutputLevel(level) {
        this.outputLevel = level & 0x3;
        
        if (!this.gainNode) return;
        
        // Set gain based on output level
        // 0=mute, 1=100%, 2=50%, 3=25%
        const volume = this.outputVolumes[this.outputLevel];
        
        if (this.playing) {
            this.gainNode.gain.value = volume;
        }
    }

    setWaveBufferByte(index, value) {
        // Each byte in wave RAM contains two 4-bit samples
        const bufferIndex = index * 2;
        
        // Convert 4-bit values to normalized audio values (-1 to 1)
        this.buffer[bufferIndex] = ((value >> 4) & 0xF) / 7.5 - 1;
        this.buffer[bufferIndex + 1] = (value & 0xF) / 7.5 - 1;
    }
    
    updateWaveBuffer() {
        if (!this.waveBuffer) return;
        
        try {
            // Update the actual AudioBuffer with current wave data
            const channelData = this.waveBuffer.getChannelData(0);
            for (let i = 0; i < 32; i++) {
                channelData[i] = this.buffer[i];
            }
        } catch (e) {
            console.warn("Error updating wave buffer:", e);
        }
    }

    disable() {
        if (this.bufferSource) {
            try {
                this.bufferSource.disconnect();
            } catch (e) {
                console.warn("Error disconnecting buffer source:", e);
            }
        }
    }

    enable() {
        if (this.bufferSource && this.gainNode) {
            try {
                this.bufferSource.connect(this.gainNode);
            } catch (e) {
                console.warn("Error connecting buffer source:", e);
            }
        }
    }
}

// Channel 4 implementation (noise)
export class Channel4 {
    constructor(apu, channelNumber, audioContext) {
        this.apu = apu;
        this.channelNumber = channelNumber;
        this.playing = false;

        this.soundLengthUnit = 0x4000; // 1 / 256 second of instructions
        this.soundLength = 64; // defaults to 64 periods
        this.lengthCheck = false;

        this.clockLength = 0;
        
        // Envelope parameters
        this.envelopeVolume = 0;
        this.envelopeStep = 0;
        this.envelopeStepLength = 0x10000; // 1 / 64 seconds of instructions
        this.envelopeSign = 1; // +1 / -1 for increase / decrease volume
        this.clockEnvelop = 0;
        
        // Noise parameters
        this.shiftFrequency = 0;
        this.counterStep = 0; // 0=15 bit, 1=7 bit
        this.dividerRatio = 0;

        if (!audioContext) {
            // Create dummy properties if audio context is not available
            this.gainNode = null;
            this.noiseBuffer = null;
            this.bufferSource = null;
            this.filter = null;
            this.audioContext = null;
            return;
        }
        
        // Create audio nodes
        try {
            this.gainNode = audioContext.createGain();
            this.gainNode.gain.value = 0;
            
            // Create bandpass filter to shape noise
            this.filter = audioContext.createBiquadFilter();
            this.filter.type = 'bandpass';
            this.filter.frequency.value = 1000;
            this.filter.Q.value = 1;
            this.filter.connect(this.gainNode);
            
            this.audioContext = audioContext;
            
            // Generate initial noise buffer
            this.generateNoiseBuffer();
        } catch (e) {
            console.warn("Failed to initialize noise channel:", e);
            this.gainNode = null;
            this.noiseBuffer = null;
            this.bufferSource = null;
            this.filter = null;
            this.audioContext = null;
        }
    }
    
    generateNoiseBuffer() {
        if (!this.audioContext) return;
        
        try {
            // Create a buffer for white noise
            const bufferSize = 2 * this.audioContext.sampleRate;
            this.noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
            
            // Fill buffer with random samples
            const data = this.noiseBuffer.getChannelData(0);
            
            // Generate either 7-bit or 15-bit LFSR noise pattern
            // This is a simplification, but approximates the Game Boy noise
            const lfsr = (1 << 14) - 1; // Start with 15 bits set (except MSB)
            const mask = this.counterStep ? 0x7F : 0x7FFF;
            const xorBits = this.counterStep ? (1 << 6) : (1 << 14);
            
            let lfsr_state = lfsr;
            for (let i = 0; i < bufferSize; i++) {
                // Get least significant bit
                const bit = lfsr_state & 1;
                // Shift register
                const newBit = ((lfsr_state ^ (lfsr_state >> 1)) & 1) << 14;
                // Update LFSR
                lfsr_state = ((lfsr_state >> 1) | newBit) & mask;
                // Convert to audio sample (-1 or 1)
                data[i] = bit ? -0.8 : 0.8;
            }
        } catch (e) {
            console.warn("Error generating noise buffer:", e);
            this.noiseBuffer = null;
        }
    }
    
    createBufferSource() {
        if (!this.audioContext || !this.filter || !this.noiseBuffer) return;
        
        // Create new buffer source (needed after each stop/start)
        if (this.bufferSource) {
            try {
                this.bufferSource.disconnect();
            } catch (e) {
                // Ignore disconnect errors
            }
        }
        
        try {
            this.bufferSource = this.audioContext.createBufferSource();
            this.bufferSource.buffer = this.noiseBuffer;
            this.bufferSource.loop = true;
            this.bufferSource.connect(this.filter);
        } catch (e) {
            console.warn("Error creating noise buffer source:", e);
            this.bufferSource = null;
        }
    }

    play() {
        if (this.playing || !this.bufferSource) return;
        
        this.playing = true;
        this.apu.setSoundFlag(this.channelNumber, 1);
        
        // Create new buffer source and start it
        this.createBufferSource();
        
        if (this.bufferSource) {
            try {
                this.bufferSource.start(0);
                
                // Set initial volume based on envelope
                this.setEnvelopeVolume(this.envelopeVolume);
            } catch (e) {
                console.warn("Error starting noise buffer source:", e);
                this.playing = false;
            }
        }
        
        this.clockLength = 0;
        this.clockEnvelop = 0;
    }

    stop() {
        if (!this.playing) return;
        
        this.playing = false;
        this.apu.setSoundFlag(this.channelNumber, 0);
        
        // Stop buffer source
        if (this.bufferSource) {
            try {
                this.bufferSource.stop(0);
            } catch (e) {
                // Ignore errors from stopping already stopped source
            }
        }
        
        if (this.gainNode) {
            this.gainNode.gain.value = 0;
        }
    }

    update(clockElapsed) {
        if (!this.playing) return;
        
        // Update envelope
        if (this.envelopeStep > 0) {
            this.clockEnvelop += clockElapsed;
            if (this.clockEnvelop >= this.envelopeStepLength) {
                this.clockEnvelop -= this.envelopeStepLength;
                
                // Adjust envelope volume
                var newVolume = this.envelopeVolume + this.envelopeSign;
                if (newVolume >= 0 && newVolume <= 15) {
                    this.setEnvelopeVolume(newVolume);
                } else {
                    // Envelope has completed
                    this.envelopeStep = 0;
                }
            }
        }
        
        // Update length counter
        if (this.lengthCheck && this.soundLength > 0) {
            this.clockLength += clockElapsed;
            if (this.clockLength >= this.soundLengthUnit) {
                this.soundLength--;
                this.clockLength -= this.soundLengthUnit;
                if (this.soundLength <= 0) {
                    this.stop();
                }
            }
        }
    }

    setLength(value) {
        // In GB, length value counts down from (64-value)
        this.soundLength = 64 - (value & 0x3F);
    }

    setEnvelopeVolume(volume) {
        this.envelopeVolume = volume & 0xF;
        // Only update gain if playing
        if (this.playing && this.gainNode) {
            this.gainNode.gain.value = this.envelopeVolume / 15;
        }
    }
    
    setNoiseParams(value) {
        // Bits 0-2: Divider ratio
        this.dividerRatio = value & 0x07;
        // Bit 3: Counter step (0=15 bits, 1=7 bits)
        this.counterStep = (value & 0x08) !== 0;
        // Bits 4-7: Shift frequency
        this.shiftFrequency = (value >> 4) & 0x0F;
        
        if (!this.filter) return;
        
        try {
            // Calculate real frequency based on parameters
            // Formula is complex, but we'll approximate it
            let frequency;
            if (this.dividerRatio === 0) {
                frequency = 524288 / (1 << this.shiftFrequency) / 2;
            } else {
                frequency = 524288 / (this.dividerRatio * (1 << this.shiftFrequency)) / 2;
            }
            
            // Limit to reasonable audio range
            frequency = Math.min(20000, Math.max(50, frequency));
            
            // Update filter and playback rate
            this.filter.frequency.value = frequency;
            
            // Regenerate noise buffer with new parameters
            this.generateNoiseBuffer();
            
            if (this.playing) {
                // Restart with new buffer
                this.stop();
                this.play();
            }
        } catch (e) {
            console.warn("Error setting noise parameters:", e);
        }
    }

    disable() {
        if (this.bufferSource) {
            try {
                this.bufferSource.disconnect();
            } catch (e) {
                console.warn("Error disconnecting noise buffer source:", e);
            }
        }
    }

    enable() {
        if (this.bufferSource && this.filter) {
            try {
                this.bufferSource.connect(this.filter);
            } catch (e) {
                console.warn("Error connecting noise buffer source:", e);
            }
        }
    }
}