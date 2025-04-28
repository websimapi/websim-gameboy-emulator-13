// audio.js - Audio Processing Unit and sound channels implementation

import { APURegisters } from './constants.js';

// Audio Processing unit
// Listens the write accesses to the audio-reserved memory addresses
// and dispatches the data to the sound channels
export class APU {
    constructor(memory) {
        this.memory = memory;
        this.enabled = false;
        this.audioContextStarted = false;

        try {
            window.AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();
            
            // Create master gain node for volume control
            this.masterGain = this.audioContext.createGain();
            this.masterGain.gain.value = 0.2; // Lower overall volume
            this.masterGain.connect(this.audioContext.destination);
            
            this.channel1 = new Channel1(this, 1, this.audioContext, this.masterGain);
            this.channel2 = new Channel1(this, 2, this.audioContext, this.masterGain);
            this.channel3 = new Channel3(this, 3, this.audioContext, this.masterGain);
            this.channel4 = new Channel4(this, 4, this.audioContext, this.masterGain);
            
            // Resume audio context if it was suspended
            if (this.audioContext.state === 'suspended') {
                console.log('Audio context suspended, waiting for user interaction');
            }
        } catch (e) {
            console.error("Web Audio API error:", e);
            this.audioContextStarted = false;
        }
    }

    connect() {
        if (!this.audioContext) return;
        
        // Resume audio context if needed
        if (this.audioContext.state !== 'running') {
            this.audioContext.resume().then(() => {
                console.log('Audio context resumed');
                this.audioContextStarted = true;
                this.channel1.enable();
                this.channel2.enable();
                this.channel3.enable();
                this.channel4.enable();
            }).catch(err => {
                console.error('Failed to resume audio context:', err);
            });
        } else {
            this.audioContextStarted = true;
            this.channel1.enable();
            this.channel2.enable();
            this.channel3.enable();
            this.channel4.enable();
        }
        
        this.enabled = true;
    }

    disconnect() {
        if (!this.audioContext) return;
        
        this.channel1.disable();
        this.channel2.disable();
        this.channel3.disable();
        this.channel4.disable();
        this.enabled = false;
    }

    // Updates the states of each channel given the elapsed time
    // (in instructions) since last update
    update(clockElapsed) {
        if (!this.enabled || !this.audioContextStarted) return;

        // Throttle audio updates to improve performance
        this.updateCounter = (this.updateCounter || 0) + clockElapsed;
        if (this.updateCounter < 64) {  // Only update audio every 64 cycles
            return;
        }
        
        const actualElapsed = this.updateCounter;
        this.updateCounter = 0;

        try {
            this.channel1.update(actualElapsed);
            this.channel2.update(actualElapsed);
            this.channel3.update(actualElapsed);
            this.channel4.update(actualElapsed);
        } catch (e) {
            console.error("Audio update error:", e);
        }
    }

    setSoundFlag(channel, value) {
        var mask = 0xFF - (1 << (channel - 1));
        value = value << (channel - 1)
        var byteValue = this.memory.rb(APURegisters.NR52);
        byteValue &= mask;
        byteValue |= value;
        this.memory[APURegisters.NR52] = byteValue;
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
                // Bits 6-7 for wave duty (square wave)
                this.channel1.dutyCycle = (value & 0xC0) >> 6;
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
                // Bits 6-7 for wave duty (square wave)
                this.channel2.dutyCycle = (value & 0xC0) >> 6;
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
                // Enable/disable wave channel
                this.channel3.enabled = (value & 0x80) ? true : false;
                if (!this.channel3.enabled) {
                    this.channel3.stop();
                }
                break;
            case APURegisters.NR31:
                this.channel3.setLength(value);
                break;
            case APURegisters.NR32:
                // Output level
                this.channel3.volumeCode = (value & 0x60) >> 5;
                this.channel3.updateVolume();
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
                // Volume and envelope
                this.channel4.envelopeSign = (value & 0x08) ? 1 : -1;
                var envelopeVolume = (value & 0xF0) >> 4;
                this.channel4.setEnvelopeVolume(envelopeVolume);
                this.channel4.envelopeStep = (value & 0x07);
                break;
            case APURegisters.NR43:
                // Noise parameters
                this.channel4.shiftFrequency = (value & 0xF0) >> 4;
                this.channel4.counterStep = (value & 0x08) ? 1 : 0;
                this.channel4.divRatio = (value & 0x07);
                this.channel4.updateFrequency();
                break;
            case APURegisters.NR44:
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
            case APURegisters.NR52:
                value &= 0xF0;
                this.memory[addr] = value;
                const wasEnabled = this.enabled;
                this.enabled = (value & 0x80) == 0 ? false : true;
                
                if (!this.enabled && wasEnabled) {
                    for (var i = 0xFF10; i < 0xFF27; i++)
                        this.memory[i] = 0;
                    this.disconnect();
                } else if (this.enabled && !wasEnabled) {
                    this.connect();
                }
                break;
        }
    }
}

// Channel 1 implementation (square wave with sweep)
export class Channel1 {
    constructor(apu, channelNumber, audioContext, masterGain) {
        this.apu = apu;
        this.channelNumber = channelNumber;
        this.playing = false;
        this.dutyCycle = 2; // Default duty (50%)

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
        this.envelopeVolume = 0;

        this.clockLength = 0;
        this.clockEnvelop = 0;
        this.clockSweep = 0;

        try {
            // Create audio nodes
            this.gainNode = audioContext.createGain();
            this.gainNode.gain.value = 0;
            
            this.oscillator = audioContext.createOscillator();
            this.oscillator.type = 'square';
            this.oscillator.frequency.value = 440; // A4 note
            
            // Connect to master gain
            this.oscillator.connect(this.gainNode);
            this.gainNode.connect(masterGain);
            
            // Start oscillator (it will keep running but with zero gain until needed)
            this.oscillator.start(0);
            
            this.audioContext = audioContext;
        } catch (e) {
            console.error("Error creating Channel1:", e);
        }
    }

    play() {
        if (this.playing) return;
        this.playing = true;
        this.apu.setSoundFlag(this.channelNumber, 1);
        
        // Apply duty cycle
        this.updateDutyCycle();
        
        // Smoothly ramp up volume to avoid clicks
        const now = this.audioContext.currentTime;
        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setValueAtTime(0, now);
        this.gainNode.gain.linearRampToValueAtTime(this.envelopeVolume * 1/100, now + 0.005);
        
        this.clockLength = 0;
        this.clockEnvelop = 0;
        this.clockSweep = 0;
        if (this.sweepShifts > 0) this.checkFreqSweep();
    }

    stop() {
        if (!this.playing) return;
        this.playing = false;
        this.apu.setSoundFlag(this.channelNumber, 0);
        
        // Smoothly ramp down volume to avoid clicks
        const now = this.audioContext.currentTime;
        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
        this.gainNode.gain.linearRampToValueAtTime(0, now + 0.005);
    }

    updateDutyCycle() {
        // Duty cycle values: 0=12.5%, 1=25%, 2=50%, 3=75% 
        // We'll use a custom periodic wave for more accuracy in the future
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

        if ((this.sweepCount || this.sweepTime) && this.clockSweep > (this.sweepStepLength * this.sweepTime) && this.sweepTime > 0) {
            this.clockSweep -= (this.sweepStepLength * this.sweepTime);
            this.sweepCount--;

            var newFreq = this.checkFreqSweep(); // process and check new freq

            this.apu.memory[0xFF13] = newFreq & 0xFF;
            this.apu.memory[0xFF14] &= 0xF8;
            this.apu.memory[0xFF14] |= (newFreq & 0x700) >> 8;
            this.setFrequency(newFreq);

            this.checkFreqSweep(); // check again with new value
        }

        if (this.envelopeCheck && this.clockEnvelop > this.envelopeStepLength && this.envelopeStep > 0) {
            this.clockEnvelop -= this.envelopeStepLength;
            this.envelopeStep--;
            this.setEnvelopeVolume(this.envelopeVolume + this.envelopeSign);
        }

        if (this.lengthCheck && this.soundLength > 0) {
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
        // GB frequency calculation: 131072/(2048-frequency)
        const realFreq = 131072 / (2048 - this.frequency);
        if (this.oscillator && !isNaN(realFreq) && isFinite(realFreq) && realFreq > 0) {
            // Apply smoothing to frequency changes
            const now = this.audioContext.currentTime;
            this.oscillator.frequency.cancelScheduledValues(now);
            this.oscillator.frequency.setValueAtTime(this.oscillator.frequency.value, now);
            this.oscillator.frequency.linearRampToValueAtTime(realFreq, now + 0.005);
        }
    }

    getFrequency() {
        return this.frequency;
    }

    setLength(value) {
        this.soundLength = 64 - (value & 0x3F);
    }

    setEnvelopeVolume(volume) {
        volume = Math.max(0, Math.min(15, volume)); // Clamp between 0-15
        this.envelopeCheck = volume > 0 && volume < 15 && this.envelopeStep > 0;
        this.envelopeVolume = volume;
        
        // Scale volume from 0-15 to a reasonable gain value (0-0.15)
        const scaledVolume = this.envelopeVolume * 1/100;
        
        if (this.gainNode && this.playing) {
            const now = this.audioContext.currentTime;
            this.gainNode.gain.cancelScheduledValues(now);
            this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
            this.gainNode.gain.linearRampToValueAtTime(scaledVolume, now + 0.01);
        }
    }

    disable() {
        this.stop();
    }

    enable() {
        // Just make sure connections are right, don't start playing
        if (this.oscillator && this.gainNode && !this.isConnected) {
            this.oscillator.connect(this.gainNode);
            this.isConnected = true;
        }
    }
}

// Channel 3 implementation (wave form)
export class Channel3 {
    constructor(apu, channelNumber, audioContext, masterGain) {
        this.apu = apu;
        this.channelNumber = channelNumber;
        this.playing = false;
        this.enabled = false;
        this.volumeCode = 0; // 0=mute, 1=100%, 2=50%, 3=25%

        this.soundLength = 0;
        this.soundLengthUnit = 0x4000; // 1 / 256 second of instructions
        this.lengthCheck = false;

        this.clockLength = 0;

        this.buffer = new Float32Array(32);
        for (let i = 0; i < 32; i++) {
            this.buffer[i] = 0;
        }

        try {
            // Create audio nodes
            this.gainNode = audioContext.createGain();
            this.gainNode.gain.value = 0;
            
            this.baseSpeed = 22050; // Lower sample rate for better performance
            this.waveBuffer = audioContext.createBuffer(1, 32, this.baseSpeed);
            
            this.bufferSource = audioContext.createBufferSource();
            this.bufferSource.buffer = this.waveBuffer;
            this.bufferSource.loop = true;
            
            // Connect to master gain
            this.bufferSource.connect(this.gainNode);
            this.gainNode.connect(masterGain);
            
            this.bufferSource.start(0);
            
            this.audioContext = audioContext;
        } catch (e) {
            console.error("Error creating Channel3:", e);
        }
    }

    play() {
        if (this.playing || !this.enabled) return;
        this.playing = true;
        this.apu.setSoundFlag(this.channelNumber, 1);
        
        // Update the audio buffer with the current wave pattern
        this.updateWaveBuffer();
        
        // Set the volume based on volume code
        this.updateVolume();
        
        // Reset the length counter
        this.clockLength = 0;
    }

    stop() {
        if (!this.playing) return;
        this.playing = false;
        this.apu.setSoundFlag(this.channelNumber, 0);
        
        // Fade out to avoid clicks
        const now = this.audioContext.currentTime;
        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
        this.gainNode.gain.linearRampToValueAtTime(0, now + 0.005);
    }

    updateVolume() {
        let volume = 0;
        // Volume codes: 0=0%, 1=100%, 2=50%, 3=25%
        switch(this.volumeCode) {
            case 0: volume = 0; break;
            case 1: volume = 0.15; break;
            case 2: volume = 0.075; break;
            case 3: volume = 0.0375; break;
        }
        
        if (this.gainNode && this.playing) {
            const now = this.audioContext.currentTime;
            this.gainNode.gain.cancelScheduledValues(now);
            this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
            this.gainNode.gain.linearRampToValueAtTime(volume, now + 0.01);
        }
    }

    updateWaveBuffer() {
        if (!this.waveBuffer) return;
        
        // Transfer the wave pattern to the audio buffer
        this.waveBuffer.copyToChannel(this.buffer, 0, 0);
        
        // Update buffer source if needed
        if (this.bufferSource && this.recreateBufferSource) {
            this.bufferSource.disconnect();
            this.bufferSource = this.audioContext.createBufferSource();
            this.bufferSource.buffer = this.waveBuffer;
            this.bufferSource.loop = true;
            this.bufferSource.playbackRate.value = this.playbackRate || 1;
            this.bufferSource.connect(this.gainNode);
            this.bufferSource.start(0);
            this.recreateBufferSource = false;
        }
    }

    update(clockElapsed) {
        if (!this.playing) return;
        
        if (this.lengthCheck && this.soundLength > 0) {
            this.clockLength += clockElapsed;
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
        // GB frequency calculation: 65536/(2048-frequency)
        const realFreq = 65536 / (2048 - (value & 0x7FF));
        
        // Calculate playback rate based on our buffer's base speed
        this.playbackRate = realFreq / this.baseSpeed;
        
        if (this.bufferSource && !isNaN(this.playbackRate) && isFinite(this.playbackRate) && this.playbackRate > 0) {
            // Apply smoothing to frequency changes
            const now = this.audioContext.currentTime;
            this.bufferSource.playbackRate.cancelScheduledValues(now);
            this.bufferSource.playbackRate.setValueAtTime(this.bufferSource.playbackRate.value, now);
            this.bufferSource.playbackRate.linearRampToValueAtTime(this.playbackRate, now + 0.005);
        }
    }

    getFrequency() {
        return this.frequency || 0;
    }

    setLength(value) {
        this.soundLength = 256 - value;
    }

    setWaveBufferByte(index, value) {
        // Each byte contains two 4-bit samples
        // Convert to values between -1 and 1 for the audio buffer
        const bufferIndex = index * 2;
        
        // High nibble
        this.buffer[bufferIndex] = ((value >> 4) / 7.5) - 1;
        
        // Low nibble
        this.buffer[bufferIndex + 1] = ((value & 0x0F) / 7.5) - 1;
        
        // Mark that we need to update the wave buffer
        this.recreateBufferSource = true;
    }

    disable() {
        this.stop();
    }

    enable() {
        // Just make sure connections are right, don't start playing
        if (this.bufferSource && this.gainNode && !this.isConnected) {
            this.bufferSource.connect(this.gainNode);
            this.isConnected = true;
        }
    }
}

// Channel 4 implementation (noise)
export class Channel4 {
    constructor(apu, channelNumber, audioContext, masterGain) {
        this.apu = apu;
        this.channelNumber = channelNumber;
        this.playing = false;

        this.soundLengthUnit = 0x4000; // 1 / 256 second of instructions
        this.soundLength = 64; // defaults to 64 periods
        this.lengthCheck = false;

        this.envelopeStep = 0;
        this.envelopeStepLength = 0x10000; // 1 / 64 seconds of instructions
        this.envelopeCheck = false;
        this.envelopeSign = 1;
        this.envelopeVolume = 0;

        this.shiftFrequency = 0;
        this.counterStep = 0;
        this.divRatio = 0;

        this.clockLength = 0;
        this.clockEnvelop = 0;

        try {
            // Create audio nodes for noise channel - we'll use a white noise source
            this.gainNode = audioContext.createGain();
            this.gainNode.gain.value = 0;
            
            // Create noise using AudioBufferSourceNode with random samples
            this.noiseLength = 8192;  // Buffer size for noise
            this.noiseBuffer = audioContext.createBuffer(1, this.noiseLength, audioContext.sampleRate);
            
            // Fill buffer with white noise
            this.generateNoiseBuffer();
            
            this.noiseSource = audioContext.createBufferSource();
            this.noiseSource.buffer = this.noiseBuffer;
            this.noiseSource.loop = true;
            
            // Connect to master gain
            this.noiseSource.connect(this.gainNode);
            this.gainNode.connect(masterGain);
            
            this.noiseSource.start(0);
            
            this.audioContext = audioContext;
        } catch (e) {
            console.error("Error creating Channel4:", e);
        }
    }

    generateNoiseBuffer() {
        // Generate white noise samples
        const data = this.noiseBuffer.getChannelData(0);
        for (let i = 0; i < this.noiseLength; i++) {
            data[i] = Math.random() * 2 - 1;
        }
    }

    updateFrequency() {
        if (!this.noiseSource) return;
        
        // Calculate noise frequency based on GB parameters
        // divRatio: 0-7, shiftFrequency: 0-15
        let divider = this.divRatio ? this.divRatio * 16 : 8;
        let freq = 524288 / divider / Math.pow(2, this.shiftFrequency);
        
        // Update playback rate to change noise frequency
        this.noiseSource.playbackRate.value = freq / 16384;
    }

    play() {
        if (this.playing) return;
        this.playing = true;
        this.apu.setSoundFlag(this.channelNumber, 1);
        
        this.updateFrequency();
        
        // Start with envelope volume
        const now = this.audioContext.currentTime;
        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setValueAtTime(0, now);
        this.gainNode.gain.linearRampToValueAtTime(this.envelopeVolume * 1/100, now + 0.005);
        
        this.clockLength = 0;
        this.clockEnvelop = 0;
    }

    stop() {
        if (!this.playing) return;
        this.playing = false;
        this.apu.setSoundFlag(this.channelNumber, 0);
        
        // Fade out to avoid clicks
        const now = this.audioContext.currentTime;
        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
        this.gainNode.gain.linearRampToValueAtTime(0, now + 0.005);
    }

    update(clockElapsed) {
        if (!this.playing) return;
        
        if (this.envelopeCheck && this.clockEnvelop > this.envelopeStepLength && this.envelopeStep > 0) {
            this.clockEnvelop -= this.envelopeStepLength;
            this.envelopeStep--;
            this.setEnvelopeVolume(this.envelopeVolume + this.envelopeSign);
        }
        
        if (this.lengthCheck && this.soundLength > 0) {
            this.clockLength += clockElapsed;
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

    setEnvelopeVolume(volume) {
        volume = Math.max(0, Math.min(15, volume)); // Clamp between 0-15
        this.envelopeCheck = volume > 0 && volume < 15 && this.envelopeStep > 0;
        this.envelopeVolume = volume;
        
        // Scale volume from 0-15 to a reasonable gain value (0-0.15)
        const scaledVolume = this.envelopeVolume * 1/100;
        
        if (this.gainNode && this.playing) {
            const now = this.audioContext.currentTime;
            this.gainNode.gain.cancelScheduledValues(now);
            this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
            this.gainNode.gain.linearRampToValueAtTime(scaledVolume, now + 0.01);
        }
    }

    enable() {
        // Just make sure connections are right, don't start playing
        if (this.noiseSource && this.gainNode && !this.isConnected) {
            this.noiseSource.connect(this.gainNode);
            this.isConnected = true;
        }
    }

    disable() {
        this.stop();
    }
}