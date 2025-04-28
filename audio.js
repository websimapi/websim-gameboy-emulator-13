// audio.js - Audio Processing Unit and sound channels implementation

import { Util } from './utils.js';

// Audio Processing unit
// Listens the write accesses to the audio-reserved memory addresses
// and dispatches the data to the sound channels
export class APU {
    constructor(memory) {
        this.memory = memory;
        this.enabled = false;

        window.AudioContext = window.AudioContext || window.webkitAudioContext;
        this.audioContext = new AudioContext();
        
        // Add a master gain node for volume control
        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = 0.5; // Adjust overall volume
        this.masterGain.connect(this.audioContext.destination);
        
        // Add a compressor to improve audio quality
        this.compressor = this.audioContext.createDynamicsCompressor();
        this.compressor.threshold.value = -24;
        this.compressor.knee.value = 30;
        this.compressor.ratio.value = 12;
        this.compressor.attack.value = 0.003;
        this.compressor.release.value = 0.25;
        this.compressor.connect(this.masterGain);

        // Create audio channels
        this.channel1 = new Channel1(this, 1, this.audioContext, this.compressor);
        this.channel2 = new Channel1(this, 2, this.audioContext, this.compressor);
        this.channel3 = new Channel3(this, 3, this.audioContext, this.compressor);
        this.channel4 = new Channel4(this, 4, this.audioContext, this.compressor);
        
        // Batch audio processing for better performance
        this.accumulatedTime = 0;
        this.updateInterval = 4000; // Process audio every 4000 cycles
    }

    connect() {
        this.channel1.enable();
        this.channel2.enable();
        this.channel3.enable();
        this.channel4.enable();
        
        // Resume audio context if suspended
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
    }

    disconnect() {
        this.channel1.disable();
        this.channel2.disable();
        this.channel3.disable();
        this.channel4.disable();
    }

    // Updates the states of each channel given the elapsed time
    // (in instructions) since last update
    update(clockElapsed) {
        if (this.enabled == false) return;

        // Accumulate time and only update audio at specified intervals
        this.accumulatedTime += clockElapsed;
        if (this.accumulatedTime >= this.updateInterval) {
            const timeToProcess = this.accumulatedTime;
            this.accumulatedTime = 0;
            
            // Process all channels
            this.channel1.update(timeToProcess);
            this.channel2.update(timeToProcess);
            this.channel3.update(timeToProcess);
            this.channel4.update(timeToProcess);
        }
    }

    setSoundFlag(channel, value) {
        var mask = 0xFF - (1 << (channel - 1));
        value = value << (channel - 1)
        var byteValue = this.memory.rb(APU.registers.NR52);
        byteValue &= mask;
        byteValue |= value;
        this.memory[APU.registers.NR52] = byteValue;
    }

    // Manage writes to audio registers
    // Will update the channels depending on the address
    manageWrite(addr, value) {
        if (this.enabled == false && addr < APU.registers.NR52) {
            return;
        }
        this.memory[addr] = value;

        switch (addr) {
            // Channel 1 addresses
            case 0xFF10:
                this.channel1.clockSweep = 0;
                this.channel1.sweepTime = ((value & 0x70) >> 4);
                this.channel1.sweepSign = (value & 0x08) ? -1 : 1;
                this.channel1.sweepShifts = (value & 0x07);
                this.channel1.sweepCount = this.channel1.sweepShifts;
                break;
            case 0xFF11:
                // todo : bits 6-7
                this.channel1.setLength(value & 0x3F);
                break;
            case 0xFF12:
                this.channel1.envelopeSign = (value & 0x08) ? 1 : -1;
                var envelopeVolume = (value & 0xF0) >> 4;
                this.channel1.setEnvelopeVolume(envelopeVolume);
                this.channel1.envelopeStep = (value & 0x07);
                break;
            case 0xFF13:
                var frequency = this.channel1.getFrequency();
                frequency &= 0xF00;
                frequency |= value;
                this.channel1.setFrequency(frequency);
                break;
            case 0xFF14:
                var frequency = this.channel1.getFrequency();
                frequency &= 0xFF;
                frequency |= (value & 7) << 8;
                this.channel1.setFrequency(frequency);
                this.channel1.lengthCheck = (value & 0x40) ? true : false;
                if (value & 0x80) this.channel1.play();
                break;

            // Channel 2 addresses
            case 0xFF16:
                // todo : bits 6-7
                this.channel2.setLength(value & 0x3F);
                break;
            case 0xFF17:
                this.channel2.envelopeSign = (value & 0x08) ? 1 : -1;
                var envelopeVolume = (value & 0xF0) >> 4;
                this.channel2.setEnvelopeVolume(envelopeVolume);
                this.channel2.envelopeStep = (value & 0x07);
                break;
            case 0xFF18:
                var frequency = this.channel2.getFrequency();
                frequency &= 0xF00;
                frequency |= value;
                this.channel2.setFrequency(frequency);
                break;
            case 0xFF19:
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
            case 0xFF1A:
                // todo
                break;
            case 0xFF1B:
                this.channel3.setLength(value);
                break;
            case 0xFF1C:
                // todo
                break;
            case 0xFF1D:
                var frequency = this.channel3.getFrequency();
                frequency &= 0xF00;
                frequency |= value;
                this.channel3.setFrequency(frequency);
                break;
            case 0xFF1E:
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
            case 0xFF20:
                this.channel4.setLength(value & 0x3F);
                break;
            case 0xFF21:
                // todo
                break;
            case 0xFF22:
                // todo
                break;
            case 0xFF23:
                this.channel4.lengthCheck = (value & 0x40) ? true : false;
                if (value & 0x80) {
                    this.channel4.play();
                }
                break;

            // channel 3 wave bytes
            case 0xFF30: case 0xFF31: case 0xFF32: case 0xFF33: case 0xFF34: case 0xFF35: case 0xFF36: case 0xFF37:
            case 0xFF38: case 0xFF39: case 0xFF3A: case 0xFF3B: case 0xFF3C: case 0xFF3D: case 0xFF3E: case 0xFF3F:
                var index = addr - 0xFF30;
                this.channel3.setWaveBufferByte(index, value);
                break;

            // general audio switch
            case 0xFF26:
                value &= 0xF0;
                this.memory[addr] = value;
                this.enabled = (value & 0x80) == 0 ? false : true;
                if (!this.enabled) {
                    for (var i = 0xFF10; i < 0xFF27; i++)
                        this.memory[i] = 0;
                    // todo stop sound
                }
                break;
        }
    }

    static get registers() {
        return {
            NR10: 0xFF10,
            NR11: 0xFF11,
            NR12: 0xFF12,
            NR13: 0xFF13,
            NR14: 0xFF14,

            NR21: 0xFF16,
            NR22: 0xFF17,
            NR23: 0xFF18,
            NR24: 0xFF19,

            NR30: 0xFF1A,
            NR31: 0xFF1B,
            NR32: 0xFF1C,
            NR33: 0xFF1D,
            NR34: 0xFF1E,

            NR41: 0xFF20,
            NR42: 0xFF21,
            NR43: 0xFF22,
            NR44: 0xFF23,

            NR50: 0xFF24,
            NR51: 0xFF25,
            NR52: 0xFF26
        };
    }
}

// Channel 1 implementation (square wave with sweep)
export class Channel1 {
    constructor(apu, channelNumber, audioContext, destination) {
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

        this.envelopeStep = 0;
        this.envelopeStepLength = 0x10000;// 1 / 64 seconds of instructions
        this.envelopeCheck = false;
        this.envelopeSign = 1;

        this.clockLength = 0;
        this.clockEnvelop = 0;
        this.clockSweep = 0;

        // Improved audio node setup
        var gainNode = audioContext.createGain();
        gainNode.gain.value = 0;
        
        // Add a low-pass filter to reduce high-frequency noise
        var filter = audioContext.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 2000;
        filter.Q.value = 0.7;
        
        var oscillator = audioContext.createOscillator();
        oscillator.type = 'square';
        oscillator.frequency.value = 1000;
        
        // Connect the nodes with the filter
        oscillator.connect(filter);
        filter.connect(gainNode);
        
        // Start the oscillator immediately but keep gain at 0
        oscillator.start(0);

        this.audioContext = audioContext;
        this.gainNode = gainNode;
        this.oscillator = oscillator;
        this.filter = filter;
        this.destination = destination;
        
        // Use AudioParam automation for smoother volume changes
        this.gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
    }

    play() {
        if (this.playing) return;
        this.playing = true;
        this.apu.setSoundFlag(this.channelNumber, 1);
        
        // Connect to the destination (compressor or master gain)
        this.gainNode.connect(this.destination);
        
        // Use ramping for smoother volume transition
        const now = this.audioContext.currentTime;
        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setValueAtTime(0, now);
        this.gainNode.gain.linearRampToValueAtTime(this.envelopeVolume * 1/100, now + 0.01);
        
        this.clockLength = 0;
        this.clockEnvelop = 0;
        this.clockSweep = 0;
        if (this.sweepShifts > 0) this.checkFreqSweep();
    }

    stop() {
        if (!this.playing) return;
        
        // Fade out for smoother sound stopping
        const now = this.audioContext.currentTime;
        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
        this.gainNode.gain.linearRampToValueAtTime(0, now + 0.05);
        
        // Schedule the actual disconnect after the fade
        setTimeout(() => {
            if (!this.playing) {
                this.gainNode.disconnect();
            }
        }, 60);
        
        this.playing = false;
        this.apu.setSoundFlag(this.channelNumber, 0);
    }

    checkFreqSweep() {
        var oldFreq = this.getFrequency();
        var newFreq = oldFreq + this.sweepSign * (oldFreq >> this.sweepShifts);
        if (newFreq > 0x7FF) {
            newFreq = 0;
            this.stop();
        }

        return newFreq;
    }

    update(clockElapsed) {
        if (!this.playing) return;
        
        this.clockEnvelop += clockElapsed;
        this.clockSweep   += clockElapsed;

        if ((this.sweepCount || this.sweepTime) && this.clockSweep > (this.sweepStepLength * this.sweepTime)) {
            this.clockSweep -= (this.sweepStepLength * this.sweepTime);
            this.sweepCount--;

            var newFreq = this.checkFreqSweep(); // process and check new freq

            this.apu.memory[0xFF13] = newFreq & 0xFF;
            this.apu.memory[0xFF14] &= 0xF8;
            this.apu.memory[0xFF14] |= (newFreq & 0x700) >> 8;
            this.setFrequency(newFreq);

            this.checkFreqSweep(); // check again with new value
        }

        if (this.envelopeCheck && this.clockEnvelop > this.envelopeStepLength) {
            this.clockEnvelop -= this.envelopeStepLength;
            this.envelopeStep--;
            this.setEnvelopeVolume(this.envelopeVolume + this.envelopeSign);
            if (this.envelopeStep <= 0) {
                this.envelopeCheck = false;
            }
        }

        if (this.lengthCheck) {
            this.clockLength  += clockElapsed;
            if (this.clockLength > this.soundLengthUnit) {
                this.soundLength--;
                this.clockLength -= this.soundLengthUnit;
                if (this.soundLength == 0) {
                    this.setLength(0);
                    this.stop();
                }
            }
        }
    }

    setFrequency(value) {
        this.frequency = value;
        const gbFreq = 131072 / (2048 - this.frequency);
        
        // Use exponential ramp for smoother frequency changes
        const now = this.audioContext.currentTime;
        this.oscillator.frequency.cancelScheduledValues(now);
        this.oscillator.frequency.setValueAtTime(this.oscillator.frequency.value, now);
        this.oscillator.frequency.exponentialRampToValueAtTime(Math.max(gbFreq, 0.1), now + 0.01);
    }

    getFrequency() {
        return this.frequency;
    }

    setLength(value) {
        this.soundLength = 64 - (value & 0x3F);
    }

    setEnvelopeVolume(volume) {
        this.envelopeCheck = volume > 0 && volume < 16 ? true : false;
        this.envelopeVolume = volume;
        
        // Smooth volume transitions
        if (this.playing) {
            const now = this.audioContext.currentTime;
            this.gainNode.gain.cancelScheduledValues(now);
            this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
            this.gainNode.gain.linearRampToValueAtTime(this.envelopeVolume * 1/100, now + 0.05);
        }
    }

    disable() {
        this.stop();
        this.oscillator.disconnect();
    }

    enable() {
        this.oscillator.connect(this.filter);
    }
}

// Channel 3 implementation (wave form)
export class Channel3 {
    constructor(apu, channelNumber, audioContext, destination) {
        this.apu = apu;
        this.channelNumber = channelNumber;
        this.playing = false;

        this.soundLength = 0;
        this.soundLengthUnit = 0x4000; // 1 / 256 second of instructions
        this.lengthCheck = false;

        this.clockLength = 0;

        this.buffer = new Float32Array(32);

        // Improved audio node setup
        var gainNode = audioContext.createGain();
        gainNode.gain.value = 0.5;
        
        // Add filter for cleaner waveform
        var filter = audioContext.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 4000;
        filter.Q.value = 1.0;

        this.baseSpeed = 65536;
        var waveBuffer = audioContext.createBuffer(1, 32, this.baseSpeed);

        var bufferSource = audioContext.createBufferSource();
        bufferSource.buffer = waveBuffer;
        bufferSource.loop = true;
        
        // Connect with filter
        bufferSource.connect(filter);
        filter.connect(gainNode);
        
        bufferSource.start(0);

        this.audioContext = audioContext;
        this.waveBuffer = waveBuffer;
        this.bufferSource = bufferSource;
        this.gainNode = gainNode;
        this.filter = filter;
        this.destination = destination;
    }

    play() {
        if (this.playing) return;
        this.playing = true;
        this.apu.setSoundFlag(this.channelNumber, 1);
        
        // Copy buffer with improved wave quality
        this.waveBuffer.copyToChannel(this.buffer, 0, 0);

        // Smooth gain connection
        const now = this.audioContext.currentTime;
        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setValueAtTime(0, now);
        this.gainNode.gain.linearRampToValueAtTime(0.5, now + 0.01);
        
        this.gainNode.connect(this.destination);
        this.clockLength = 0;
    }

    stop() {
        if (!this.playing) return;
        
        // Fade out for smoother sound stopping
        const now = this.audioContext.currentTime;
        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
        this.gainNode.gain.linearRampToValueAtTime(0, now + 0.05);
        
        // Schedule the actual disconnect after the fade
        setTimeout(() => {
            if (!this.playing) {
                this.gainNode.disconnect();
            }
        }, 60);
        
        this.playing = false;
        this.apu.setSoundFlag(this.channelNumber, 0);
    }

    update(clockElapsed) {
        if (!this.playing) return;
        
        if (this.lengthCheck){
            this.clockLength  += clockElapsed;
            if (this.clockLength > this.soundLengthUnit) {
                this.soundLength--;
                this.clockLength -= this.soundLengthUnit;
                if (this.soundLength == 0) {
                    this.setLength(0);
                    this.stop();
                }
            }
        }
    }

    setFrequency(value) {
        value = 65536 / (2048  - value);
        const now = this.audioContext.currentTime;
        
        // Use exponential ramp for smoother playback rate changes
        this.bufferSource.playbackRate.cancelScheduledValues(now);
        this.bufferSource.playbackRate.setValueAtTime(this.bufferSource.playbackRate.value, now);
        this.bufferSource.playbackRate.exponentialRampToValueAtTime(
            Math.max(value / this.baseSpeed, 0.01), now + 0.01);
    }

    getFrequency() {
        var freq = 2048 - 65536 / (this.bufferSource.playbackRate.value * this.baseSpeed);
        return freq | 1;
    }

    setLength(value) {
        this.soundLength = 256 - value;
    }

    setWaveBufferByte(index, value) {
        var bufferIndex = index * 2;

        // Improved waveform quality with anti-aliasing
        const highNibble = (value >> 4) / 8 - 1;
        const lowNibble = (value & 0x0F) / 8 - 1;
        
        // Apply a slight smoothing between samples
        if (bufferIndex > 0) {
            const prevVal = this.buffer[bufferIndex - 1];
            this.buffer[bufferIndex] = (highNibble * 0.9 + prevVal * 0.1);
        } else {
            this.buffer[bufferIndex] = highNibble;
        }
        
        if (bufferIndex < 30) {
            const nextVal = index < 15 ? lowNibble : this.buffer[bufferIndex + 2];
            this.buffer[bufferIndex + 1] = (lowNibble * 0.9 + nextVal * 0.1);
        } else {
            this.buffer[bufferIndex + 1] = lowNibble;
        }
        
        // Update the buffer if playing for real-time wave changes
        if (this.playing) {
            this.waveBuffer.copyToChannel(this.buffer, 0, 0);
        }
    }

    disable() {
        this.stop();
        this.bufferSource.disconnect();
    }

    enable() {
        this.bufferSource.connect(this.filter);
    }
}

// Channel 4 implementation (noise)
export class Channel4 {
    constructor(apu, channelNumber, audioContext, destination) {
        this.apu = apu;
        this.channelNumber = channelNumber;
        this.playing = false;

        this.soundLengthUnit = 0x4000; // 1 / 256 second of instructions
        this.soundLength = 64; // defaults to 64 periods
        this.lengthCheck = false;

        this.clockLength = 0;
        
        // Add actual noise implementation with Web Audio
        var gainNode = audioContext.createGain();
        gainNode.gain.value = 0;
        
        // Use a buffer source for noise generation
        var noiseBuffer = this.createNoiseBuffer(audioContext);
        var noiseSource = audioContext.createBufferSource();
        noiseSource.buffer = noiseBuffer;
        noiseSource.loop = true;
        
        // Add a bandpass filter for more authentic noise sound
        var filter = audioContext.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 1000;
        filter.Q.value = 1.0;
        
        noiseSource.connect(filter);
        filter.connect(gainNode);
        noiseSource.start(0);

        this.audioContext = audioContext;
        this.gainNode = gainNode;
        this.noiseSource = noiseSource;
        this.filter = filter;
        this.destination = destination;
    }
    
    // Create a noise buffer
    createNoiseBuffer(context) {
        const bufferSize = context.sampleRate * 2; // 2 seconds of noise
        const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
        const output = buffer.getChannelData(0);
        
        // Fill with white noise
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }
        
        return buffer;
    }

    play() {
        if (this.playing) return;
        this.playing = true;
        this.apu.setSoundFlag(this.channelNumber, 1);
        
        // Connect and fade in
        const now = this.audioContext.currentTime;
        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setValueAtTime(0, now);
        this.gainNode.gain.linearRampToValueAtTime(0.15, now + 0.01);
        
        this.gainNode.connect(this.destination);
        this.clockLength = 0;
    }

    stop() {
        if (!this.playing) return;
        
        // Fade out
        const now = this.audioContext.currentTime;
        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
        this.gainNode.gain.linearRampToValueAtTime(0, now + 0.05);
        
        // Disconnect after fade
        setTimeout(() => {
            if (!this.playing) {
                this.gainNode.disconnect();
            }
        }, 60);
        
        this.playing = false;
        this.apu.setSoundFlag(this.channelNumber, 0);
    }

    update(clockElapsed) {
        if (!this.playing) return;
        
        if (this.lengthCheck) {
            this.clockLength  += clockElapsed;
            if (this.clockLength > this.soundLengthUnit) {
                this.soundLength--;
                this.clockLength -= this.soundLengthUnit;
                if (this.soundLength == 0) {
                    this.setLength(0);
                    this.stop();
                }
            }
        }
    }

    setLength(value) {
        this.soundLength = 64 - (value & 0x3F);
    }
    
    // New method to support actually changing the noise properties
    setNoiseProperties(divisor, shortMode, shiftClock) {
        // Adjust filter frequency based on parameters
        const frequencyBase = 1000 / (divisor || 1);
        this.filter.frequency.value = Math.min(frequencyBase * (shiftClock || 1), 8000);
        
        // Recreate noise buffer for short mode if needed
        if (this.shortMode !== shortMode) {
            this.shortMode = shortMode;
            this.noiseSource.disconnect();
            
            const newBuffer = this.createNoiseBuffer(this.audioContext);
            const newSource = this.audioContext.createBufferSource();
            newSource.buffer = newBuffer;
            newSource.loop = true;
            
            newSource.connect(this.filter);
            newSource.start(0);
            this.noiseSource = newSource;
        }
    }
    
    disable() {
        this.stop();
    }
    
    enable() {
        // Ready for playing, but don't actually play
    }
}